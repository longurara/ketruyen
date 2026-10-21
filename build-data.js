const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

// Every series in series.json is built from its crawl output (metadata.json
// plus <volume>/images). The app loads data/series.json (the shelf), then a
// series' index.json (titles, pictures, word counts: a few KB) to draw its
// library, then one vol-N.<hash>.json per volume only when a chapter from it
// is opened. The hash in the name lets those files be cached forever;
// index.json always names the current ones.
//
// The first series keeps the paths it had before there were others
// (data/index.json, img/<volume>/...) so bookmarks and saved copies still
// work; the others live under data/<slug>/, img/<slug>/ and images/<slug>/.
const SERIES_PATH = path.join(__dirname, "series.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(PUBLIC_DIR, "data");
const CATALOG_PATH = path.join(DATA_DIR, "series.json");
const LEGACY_DATA_PATH = path.join(PUBLIC_DIR, "data.json");

// Reader images are downscaled WebP copies of the scans (a few MB each as
// PNG); covers get a small thumbnail since they never show wider than 250px.
const READER_WIDTH = 1600;
const COVER_WIDTH = 520;

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_").trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Existing copies are kept (they are committed, and a fresh checkout's mtimes
// say nothing). Delete public/img/<volume> to rebuild one after a re-crawl.
async function optimizeImage(src, dest, width) {
  if (!fs.existsSync(dest)) {
    if (src.toLowerCase().endsWith(".webp") && width === READER_WIDTH) {
      const srcMeta = await sharp(src).metadata();
      if (!srcMeta.width || srcMeta.width <= width) {
        fs.copyFileSync(src, dest);
        return { w: srcMeta.width, h: srcMeta.height };
      }
    }
    await sharp(src)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(dest);
  }
  const { width: w, height: h } = await sharp(dest).metadata();
  return { w, h };
}

// ------------------------------------------------------------
//  Text cleanup
// ------------------------------------------------------------

// Navigation chrome and uploader notes scraped along with some chapters.
const CHROME_PATTERNS = [
  /^Chương\s*(trước|tiếp)$/i,
  /^Chọn chương$/i,
  /^Loading\.*$/i,
  /^Truyện được leak bởi/i,
  /\sChương\s*trước$/, // page header: "<series> Chương N: <title> Chương trước"
  /^c\d+\s*v\d+$/i, // "c14 v4" chapter tags
  /^image$/i
];
const STRAY_HEADING = /^Chương\s*\d+\s*[:：]\s*\S.{0,120}$/i;
const SCENE_BREAK = /^[.•·*\s]+$/;

// A paragraph that stops without closing punctuation continues in the next one
// when that starts in lower case, or with a romanised name ("Mahiru"): the
// source split lines around names. Vietnamese sentence starts carry diacritics
// or follow a full stop, so they are left alone.
function continuesInto(prev, next) {
  if (/,$/.test(prev)) return /^\p{L}/u.test(next);
  if (!/[\p{L}\p{N}]$/u.test(prev)) return false;
  return /^\p{Ll}/u.test(next) || /^[A-Z][a-z]+(?!\p{L})/u.test(next) || /^[“"‘]\p{Ll}/u.test(next);
}

// Some pages were scraped through nested wrappers, so the body appears
// several times in a row. Keep one copy.
function collapseRepeats(paragraphs) {
  const n = paragraphs.length;
  for (let copies = Math.floor(n / 2); copies >= 2; copies -= 1) {
    if (n % copies !== 0) continue;
    const size = n / copies;
    if (paragraphs.every((p, i) => p === paragraphs[i % size])) return paragraphs.slice(0, size);
  }
  return paragraphs;
}

function cleanChapter(title, content) {
  let heading = null;
  // NFC keeps one code unit per letter, so search can map matches in the
  // accent-folded text straight back onto the original.
  let paragraphs = (content || "")
    .normalize("NFC")
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t\r\f\v]*\n[ \t\r\f\v\n]*/g, " ").replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .filter((p) => {
      if (CHROME_PATTERNS.some((re) => re.test(p))) return false;
      if (STRAY_HEADING.test(p)) {
        heading = heading || p;
        return false;
      }
      return true;
    });

  paragraphs = collapseRepeats(paragraphs);

  const merged = [];
  for (const p of paragraphs) {
    const prev = merged[merged.length - 1];
    if (SCENE_BREAK.test(p)) {
      if (prev !== "--- ---") merged.push("--- ---");
    } else if (prev && !prev.startsWith("---") && continuesInto(prev, p)) {
      merged[merged.length - 1] = `${prev} ${p}`;
    } else {
      merged.push(p);
    }
  }

  let cleanTitle = title.normalize("NFC").replace(/\s+/g, " ").trim().replace(/(.{6,})\1$/, "$1");
  if (heading && !/^Chương/i.test(cleanTitle)) cleanTitle = heading;

  return { title: cleanTitle, content: merged.join("\n\n") };
}

// ------------------------------------------------------------
//  Build
// ------------------------------------------------------------

function countWords(text) {
  const words = text.match(/\S+/g);
  return words ? words.length : 0;
}

async function buildSeries(config) {
  const OUTPUT_DIR = path.join(__dirname, config.source);
  const sub = config.legacyPaths ? "" : config.slug;
  const IMG_DEST = path.join(PUBLIC_DIR, "images", sub);
  const OPT_DEST = path.join(PUBLIC_DIR, "img", sub);
  const seriesDataDir = path.join(DATA_DIR, sub);
  const urlBase = (dir) => (sub ? `/${dir}/${sub}` : `/${dir}`);
  const metadataPath = path.join(OUTPUT_DIR, "metadata.json");
  const indexPath = path.join(seriesDataDir, "index.json");

  if ((!fs.existsSync(metadataPath) || process.env.VERCEL) && fs.existsSync(indexPath)) {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    const totalChapters = data.reduce((s, v) => s + v.chapters.length, 0);
    const { source, legacyPaths, volumeTitles, ...meta } = config;
    return {
      ...meta,
      index: `${urlBase("data")}/index.json`,
      cover: data.find((volume) => volume.cover)?.cover || "",
      volumes: data.length,
      chapters: totalChapters,
      bytes: data.reduce((s, v) => s + (v.bytes || 0), 0)
    };
  }

  const raw = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  let totalImages = 0;
  const data = [];
  const texts = [];

  for (const vol of raw) {
    const volDirName = sanitizeName(vol.volumeName);
    const srcImgDir = path.join(OUTPUT_DIR, volDirName, "images");
    const destImgDir = path.join(IMG_DEST, volDirName);
    const optDir = path.join(OPT_DEST, volDirName);

    // Scan & copy originals (legacy series only), then make reader-size WebP copies.
    const activeImgDir = fs.existsSync(srcImgDir) ? srcImgDir : optDir;
    const imageFiles = fs.existsSync(activeImgDir)
      ? fs.readdirSync(activeImgDir).filter((f) => !f.endsWith(".cover.webp")).sort()
      : [];
    const imageInfo = {};
    if (imageFiles.length) {
      if (config.legacyPaths) ensureDir(destImgDir);
      ensureDir(optDir);
    }

    for (const file of imageFiles) {
      const src = path.join(activeImgDir, file);
      if (config.legacyPaths) {
        const dest = path.join(destImgDir, file);
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
      }

      const base = path.parse(file).name;
      const size = await optimizeImage(src, path.join(optDir, `${base}.webp`), READER_WIDTH);
      imageInfo[file] = { src: `${urlBase("img")}/${volDirName}/${base}.webp`, ...size };
    }
    totalImages += imageFiles.length;

    const chapters = vol.chapters
      .map((ch, idx) => {
        // Find images for this chapter
        const prefix = ch.isIllustration
          ? "illu"
          : `ch${String(idx + 1).padStart(2, "0")}`;
        const chImages = imageFiles.filter((f) =>
          ch.isIllustration
            ? f.startsWith("illu")
            : f.startsWith(`${prefix}_`) || f.startsWith(`${prefix}.`)
        );
        const text = ch.isIllustration
          ? { title: ch.title, content: "" }
          : cleanChapter(ch.title, ch.content);

        return {
          title: text.title,
          content: text.content,
          isIllustration: ch.isIllustration || false,
          images: chImages.map((f) => imageInfo[f])
        };
      })
      .filter((ch, _, arr) => !ch.isIllustration || ch.images.length > 0 || arr.length === 1);

    // The first picture in the volume doubles as its cover.
    let cover = "";
    const coverChapter = chapters.findIndex((ch) => ch.images.length > 0);
    if (coverChapter >= 0) {
      const first = chapters[coverChapter].images[0];
      const file = imageFiles.find((f) => imageInfo[f] === first);
      const base = path.parse(file).name;
      await optimizeImage(path.join(activeImgDir, file), path.join(optDir, `${base}.cover.webp`), COVER_WIDTH);
      cover = `${urlBase("img")}/${volDirName}/${base}.cover.webp`;
    } else if (fs.existsSync(path.join(optDir, "illu_01.cover.webp"))) {
      cover = `${urlBase("img")}/${volDirName}/illu_01.cover.webp`;
    }

    texts.push(chapters.map((ch) => ch.content));
    const display = config.volumeTitles?.[volDirName];
    data.push({
      name: display?.label || vol.volumeName,
      ...(display?.title ? { title: display.title } : {}),
      dirName: volDirName,
      cover,
      chapters: chapters.map(({ content, ...rest }) => ({ ...rest, words: countWords(content) }))
    });
  }

  ensureDir(seriesDataDir);
  for (const existing of fs.readdirSync(seriesDataDir)) {
    if (/^vol-\d+\.[0-9a-f]+\.json$/i.test(existing)) {
      fs.rmSync(path.join(seriesDataDir, existing), { force: true });
    }
  }
  let textBytes = 0;
  data.forEach((volume, volIdx) => {
    const json = JSON.stringify(texts[volIdx]);
    const hash = crypto.createHash("sha1").update(json).digest("hex").slice(0, 10);
    const file = `vol-${volIdx}.${hash}.json`;
    fs.writeFileSync(path.join(seriesDataDir, file), json, "utf-8");
    volume.text = `${urlBase("data")}/${file}`;
    textBytes += Buffer.byteLength(json);

    // What saving the volume for offline reading downloads: its text, cover
    // and pictures (the app shows it on the download buttons).
    const pictures = [volume.cover, ...volume.chapters.flatMap((ch) => ch.images.map((image) => image.src))].filter(Boolean);
    volume.bytes = Buffer.byteLength(json)
      + pictures.reduce((sum, src) => sum + fs.statSync(path.join(PUBLIC_DIR, src)).size, 0);
  });

  fs.writeFileSync(indexPath, JSON.stringify(data), "utf-8");

  const indexKB = (fs.statSync(indexPath).size / 1024).toFixed(0);
  const totalChapters = data.reduce((s, v) => s + v.chapters.length, 0);
  const offlineMB = (data.reduce((s, v) => s + v.bytes, 0) / 1024 / 1024).toFixed(1);

  console.log(`✅ ${config.titleVi} → ${path.relative(PUBLIC_DIR, indexPath)}: ${indexKB} KB, chapter text: ${(textBytes / 1024 / 1024).toFixed(2)} MB in ${data.length} files`);
  console.log(`   ${data.length} volumes, ${totalChapters} chapters`);
  console.log(`   ${totalImages} images, WebP copies in ${path.relative(__dirname, OPT_DEST) || "public/img"}`);
  console.log(`   the whole series for offline reading: ${offlineMB} MB\n`);

  // The shelf entry: what the home page needs before opening the series.
  const { source, legacyPaths, volumeTitles, ...meta } = config;
  return {
    ...meta,
    index: `${urlBase("data")}/index.json`,
    cover: data.find((volume) => volume.cover)?.cover || "",
    volumes: data.length,
    chapters: totalChapters,
    bytes: data.reduce((s, v) => s + v.bytes, 0)
  };
}

async function main() {
  console.log("📦 Building data/ + images for static deployment...\n");
  const seriesList = JSON.parse(fs.readFileSync(SERIES_PATH, "utf-8"));

  ensureDir(DATA_DIR);
  if (fs.existsSync(LEGACY_DATA_PATH)) fs.rmSync(LEGACY_DATA_PATH);

  const catalog = new Array(seriesList.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= seriesList.length) break;
      catalog[i] = await buildSeries(seriesList[i]);
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog), "utf-8");
  console.log(`📚 data/series.json: ${catalog.length} series`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
