const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const ONESHOT_DIR = "E:\\lightnovel\\01_Oneshot";
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const PUBLIC_IMG_ROOT = path.join(ROOT_DIR, "public", "img");
const SERIES_JSON_PATH = path.join(ROOT_DIR, "series.json");

const READER_WIDTH = 1600;
const COVER_WIDTH = 520;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_").trim();
}

function slugify(str) {
  return String(str || "")
    .normalize("NFC")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
}

function decodeEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return code > 0 ? String.fromCodePoint(code) : "";
    });
}

function cleanText(raw) {
  return decodeEntities(String(raw || "").replace(/<[^>]+>/g, " "))
    .replace(/[\u2000-\u200f\u2028-\u202f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function saveReaderAndPublicImage(buf, srcImgPath, optImgPath, coverOptPath = null) {
  try {
    if (!fs.existsSync(srcImgPath) || !fs.existsSync(optImgPath)) {
      const webpBuf = await sharp(buf)
        .resize({ width: READER_WIDTH, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      ensureDir(path.dirname(srcImgPath));
      ensureDir(path.dirname(optImgPath));
      fs.writeFileSync(srcImgPath, webpBuf);
      fs.writeFileSync(optImgPath, webpBuf);
    }
    if (coverOptPath && !fs.existsSync(coverOptPath)) {
      ensureDir(path.dirname(coverOptPath));
      await sharp(buf)
        .resize({ width: COVER_WIDTH, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(coverOptPath);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function parseChapterHtml(html) {
  let title = "";
  const titleMatch = html.match(/<h4[^>]*\bclass=["'][^"']*title-item1[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i);
  if (titleMatch) {
    title = cleanText(titleMatch[1]);
  }

  let bodyHtml = html;
  const contentIdx = html.search(/id=["']chapter-content["']/i);
  if (contentIdx >= 0) {
    const tagEnd = html.indexOf(">", contentIdx);
    const bodyEnd = html.lastIndexOf("</body>");
    if (tagEnd >= 0) {
      bodyHtml = html.slice(tagEnd + 1, bodyEnd > tagEnd ? bodyEnd : html.length);
    }
  }

  const images = [];
  for (const m of bodyHtml.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const src = decodeURIComponent(m[1].split("#")[0].trim());
    if (src && !images.includes(src)) images.push(src);
  }

  const textHtml = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  const paragraphs = decodeEntities(textHtml)
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean);

  return { title, content: paragraphs.join("\n\n"), paragraphs, images };
}

function parseIndexHtml(indexHtml, fallbackTitle) {
  let titleVi = fallbackTitle;
  const titleMatch = indexHtml.match(/<a\b[^>]*\bhref=["']index\.html["'][^>]*>([\s\S]*?)<\/a>/i);
  if (titleMatch) {
    const t = cleanText(titleMatch[1]);
    if (t) titleVi = t;
  }

  let titleJp = "";
  const altIdx = indexHtml.indexOf("Tên khác:");
  if (altIdx >= 0) {
    const altChunk = indexHtml.slice(altIdx, altIdx + 1800);
    const altMatches = [...altChunk.matchAll(/<div class="col">([^<]+)<\/div>/gi)]
      .map((m) => cleanText(m[1]))
      .filter((t) => t && t !== "Tên khác:");
    if (altMatches.length > 0) {
      titleJp = altMatches[0];
    }
  }

  const tags = [];
  for (const m of indexHtml.matchAll(/href=["']https?:\/\/[^"']*\/the-loai\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const g = cleanText(m[1]);
    if (g && !tags.includes(g)) tags.push(g);
  }
  if (!tags.some((t) => /one\s*shot/i.test(t))) tags.unshift("One shot");

  let author = "Khuyết danh";
  const authorMatch = indexHtml.match(/href=["']https?:\/\/[^"']*\/tac-gia\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  if (authorMatch && cleanText(authorMatch[1])) {
    author = cleanText(authorMatch[1]);
  }

  let illustrator = "";
  const illuMatch = indexHtml.match(/href=["']https?:\/\/[^"']*\/hoa-si\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  if (illuMatch && cleanText(illuMatch[1])) {
    illustrator = cleanText(illuMatch[1]);
  }

  let status = "Đã hoàn thành";
  const statusMatch = indexHtml.match(/href=["']https?:\/\/[^"']*\/truyen-[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  if (statusMatch && cleanText(statusMatch[1])) {
    status = cleanText(statusMatch[1]);
  }

  let description = "";
  const descMatch = indexHtml.match(/<h4[^>]*>\s*Tóm tắt\s*<\/h4>\s*<div[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) {
    description = cleanText(descMatch[1]);
  }

  const chapterLinks = [];
  for (const m of indexHtml.matchAll(/<a\b[^>]*\bhref=["'](c\d+[^"']*\.html)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    const label = cleanText(m[2]);
    if (!chapterLinks.some((c) => c.href === href)) {
      chapterLinks.push({ href, label });
    }
  }

  return { titleVi, titleJp, author, illustrator, status, tags, description, chapterLinks };
}

async function processOneshotFolder(folderName, usedSlugs) {
  const fullDir = path.join(ONESHOT_DIR, folderName);
  const epubs = fs
    .readdirSync(fullDir)
    .filter((f) => f.endsWith(".epub"))
    .sort((a, b) => fs.statSync(path.join(fullDir, b)).size - fs.statSync(path.join(fullDir, a)).size);

  if (epubs.length === 0) return null;

  const epubPath = path.join(fullDir, epubs[0]);
  const zip = await JSZip.loadAsync(fs.readFileSync(epubPath));

  const indexEntry = zip.file("index.html") || zip.file("OEBPS/index.html");
  const indexHtml = indexEntry ? await indexEntry.async("string") : "";
  const meta = parseIndexHtml(indexHtml, folderName);

  let baseSlug = "hlc-" + (slugify(meta.titleVi) || slugify(folderName) || path.parse(epubs[0]).name);
  let slug = baseSlug;
  let counter = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${counter++}`;
  }
  usedSlugs.add(slug);

  const volName = "Oneshot";
  const volDirName = sanitizeName(volName);
  const outSeriesDir = path.join(OUTPUT_ROOT, slug);
  const srcImgDir = path.join(outSeriesDir, volDirName, "images");
  const optImgDir = path.join(PUBLIC_IMG_ROOT, slug, volDirName);
  ensureDir(srcImgDir);
  ensureDir(optImgDir);

  // Locate cover image inside EPUB
  const allZipFiles = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
  const coverKey =
    allZipFiles.find((k) => /(?:^|\/)cover\.(?:jpe?g|png|webp)$/i.test(k)) ||
    allZipFiles.find((k) => /\.(?:jpe?g|png|webp)$/i.test(k));

  const illuChapter = {
    title: "Minh họa",
    content: "",
    images: [],
    isIllustration: true
  };
  let illuCount = 0;

  if (coverKey) {
    const buf = await zip.file(coverKey).async("nodebuffer");
    illuCount++;
    const base = `illu_${String(illuCount).padStart(2, "0")}`;
    const ok = await saveReaderAndPublicImage(
      buf,
      path.join(srcImgDir, `${base}.webp`),
      path.join(optImgDir, `${base}.webp`),
      path.join(optImgDir, `${base}.cover.webp`)
    );
    if (ok) illuChapter.images.push(`${base}.webp`);
  }

  // Ordered chapter files
  let chapterRefs = meta.chapterLinks;
  if (chapterRefs.length === 0) {
    chapterRefs = allZipFiles
      .filter((k) => /(?:^|\/)c\d+[^/]*\.x?html?$/i.test(k))
      .map((k) => ({ href: k, label: "" }));
  }

  const storyChapters = [];
  for (const ref of chapterRefs) {
    const entry = zip.file(ref.href) || zip.file(path.posix.basename(ref.href));
    if (!entry) continue;
    const html = await entry.async("string");
    const parsed = parseChapterHtml(html);
    const chTitle = parsed.title || ref.label || "Oneshot";

    const isIlluOnly =
      (/^minh\s*họa/i.test(chTitle) && parsed.content.length < 120) ||
      (parsed.content.length === 0 && parsed.images.length > 0);

    if (isIlluOnly) {
      for (const imgHref of parsed.images) {
        const imgEntry = zip.file(imgHref) || zip.file(path.posix.basename(imgHref));
        if (!imgEntry) continue;
        const buf = await imgEntry.async("nodebuffer");
        illuCount++;
        const base = `illu_${String(illuCount).padStart(2, "0")}`;
        const coverPath = illuCount === 1 ? path.join(optImgDir, `${base}.cover.webp`) : null;
        const ok = await saveReaderAndPublicImage(
          buf,
          path.join(srcImgDir, `${base}.webp`),
          path.join(optImgDir, `${base}.webp`),
          coverPath
        );
        if (ok) illuChapter.images.push(`${base}.webp`);
      }
      continue;
    }

    storyChapters.push({
      title: chTitle,
      content: parsed.content,
      paragraphs: parsed.paragraphs,
      rawImages: parsed.images,
      isIllustration: false
    });
  }

  // Fallback if all chapters were treated as illustration-only
  if (storyChapters.length === 0 && chapterRefs.length > 0) {
    const entry = zip.file(chapterRefs[0].href);
    if (entry) {
      const parsed = parseChapterHtml(await entry.async("string"));
      storyChapters.push({
        title: parsed.title || chapterRefs[0].label || "Oneshot",
        content: parsed.content || meta.description || meta.titleVi,
        paragraphs: parsed.paragraphs,
        rawImages: [],
        isIllustration: false
      });
    }
  }

  const finalChapters = [illuChapter];
  for (let i = 0; i < storyChapters.length; i++) {
    const ch = storyChapters[i];
    const chapNum = i + 2; // Since index 0 is illuChapter (chap 1), story chapters start at index 1 -> ch02
    const prefix = `ch${String(chapNum).padStart(2, "0")}`;
    const savedImgs = [];
    let imgCounter = 0;

    for (const imgHref of ch.rawImages) {
      if (coverKey && imgHref === coverKey) continue;
      const imgEntry = zip.file(imgHref) || zip.file(path.posix.basename(imgHref));
      if (!imgEntry) continue;
      const buf = await imgEntry.async("nodebuffer");
      imgCounter++;
      const base = `${prefix}_${String(imgCounter).padStart(2, "0")}`;
      const ok = await saveReaderAndPublicImage(
        buf,
        path.join(srcImgDir, `${base}.webp`),
        path.join(optImgDir, `${base}.webp`),
        null
      );
      if (ok) savedImgs.push(`${base}.webp`);
    }

    finalChapters.push({
      title: ch.title,
      content: ch.content,
      images: savedImgs,
      isIllustration: false
    });
  }

  // Fallback description from first story chapter if summary is short
  let description = meta.description;
  if (!description || description.length < 25) {
    const firstParas = (storyChapters[0]?.paragraphs || []).filter((p) => p.length > 30);
    const joined = firstParas.slice(0, 2).join(" ");
    if (joined) {
      description = joined.length > 320 ? `${joined.slice(0, 317).replace(/\s+\S*$/, "")}…` : joined;
    }
  }

  if (illuChapter.images.length === 0) {
    console.warn(`⚠️ Missing cover for: ${meta.titleVi} (${folderName})`);
  }

  const metadataJson = [
    {
      volumeName: volName,
      chapters: finalChapters
    }
  ];
  fs.writeFileSync(path.join(outSeriesDir, "metadata.json"), JSON.stringify(metadataJson, null, 2), "utf8");

  return {
    slug,
    source: `output/${slug}`,
    section: "hlc-ln",
    collection: "Light novel _ Hội Lẩu Chay",
    titleVi: meta.titleVi,
    titleJp: meta.titleJp,
    author: meta.author,
    illustrator: meta.illustrator,
    status: meta.status,
    description,
    tags: meta.tags.slice(0, 6)
  };
}

async function main() {
  const existingSeries = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8")).filter(
    (s) => s.section !== "hlc-ln"
  );
  const usedSlugs = new Set(existingSeries.map((s) => s.slug));

  const folders = fs
    .readdirSync(ONESHOT_DIR)
    .filter((f) => fs.statSync(path.join(ONESHOT_DIR, f)).isDirectory())
    .sort((a, b) => a.localeCompare(b, "vi"));

  console.log(`📚 Importing ${folders.length} oneshots from ${ONESHOT_DIR}...`);

  const imported = new Array(folders.length);
  let cursor = 0;
  let done = 0;
  const CONCURRENCY = 8;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= folders.length) break;
      const item = await processOneshotFolder(folders[i], usedSlugs);
      imported[i] = item;
      done++;
      if (done % 50 === 0 || done === folders.length) {
        console.log(`  Processed ${done}/${folders.length}: ${item?.titleVi || folders[i]}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const validImported = imported.filter(Boolean);
  const nextSeries = [...existingSeries, ...validImported];
  fs.writeFileSync(SERIES_JSON_PATH, JSON.stringify(nextSeries, null, 2), "utf8");
  console.log(`✅ Added ${validImported.length} oneshots to series.json (total: ${nextSeries.length} series)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
