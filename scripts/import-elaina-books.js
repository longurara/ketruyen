const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const CACHE_DIR =
  "C:\\Users\\Hikari\\.gemini\\antigravity\\brain\\40a658b2-a363-4b57-8766-4f057aa2915d\\scratch\\dtv-elaina";
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const SERIES_JSON_PATH = path.join(ROOT_DIR, "series.json");
const MAX_IMAGE_WIDTH = 1600;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_").trim();
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return code > 0 ? String.fromCodePoint(code) : "";
    });
}

function resolveHref(base, href) {
  if (!href) return "";
  const clean = href.split("#")[0];
  if (!clean) return base;
  const dir = path.posix.dirname(base);
  return dir === "." ? clean : path.posix.join(dir, clean);
}

async function saveWebpImage(buf, destPath) {
  if (fs.existsSync(destPath)) return true;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height || meta.width < 120 || meta.height < 120) return false;
    await sharp(buf)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(destPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeForMatch(s) {
  return (s || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function stripDuplicateTitleParagraphs(title, paragraphs) {
  if (!title || !paragraphs.length) return paragraphs;
  const normTitle = normalizeForMatch(title);
  if (!normTitle) return paragraphs;
  const p0 = normalizeForMatch(paragraphs[0].replace(/\*+$/, ""));
  if (p0 === normTitle) return paragraphs.slice(1);
  if (paragraphs.length >= 2) {
    const p01 = normalizeForMatch(`${paragraphs[0]} ${paragraphs[1].replace(/\*+$/, "")}`);
    if (p01 === normTitle) return paragraphs.slice(2);
  }
  return paragraphs;
}

function extractBlocksFromHtml(html) {
  let body = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div\b[^>]*class=["'](?:header|author)["'][^>]*>[\s\S]*?<\/div>/gi, "");

  body = body.replace(/<hr\b[^>]*\/?>/gi, "\n\n--- ---\n\n");
  body = body.replace(/<br\b[^>]*\/?>/gi, "\n");
  body = body.replace(/<\/?(?:p|div|h[1-6]|li|blockquote|section|article|tr|header|footer|aside|center)\b[^>]*>/gi, "\n\n");

  const rawText = decodeHtmlEntities(body.replace(/<[^>]+>/g, ""));
  const lines = rawText
    .normalize("NFC")
    .split(/\n+/)
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean);

  const paragraphs = [];
  for (const line of lines) {
    if (/^(?:ebook\s*©\s*hotaru-team|hotaru-team|dtv-ebook\.com|www\.dtv-ebook\.com)$/i.test(line)) continue;
    if (/^(?:[*＊•·◊♦●○❖✦✧~～—–-]\s*){2,}$/.test(line) || /^[*＊◊♦❖✦✧]$/.test(line)) {
      if (paragraphs[paragraphs.length - 1] !== "--- ---") paragraphs.push("--- ---");
      continue;
    }
    paragraphs.push(line);
  }

  return paragraphs;
}

async function parseElainaVolume(buf, volumeName, seriesOutputDir) {
  const zip = await JSZip.loadAsync(buf);
  const containerXml = await zip.file("META-INF/container.xml").async("string");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)[1];
  const opfXml = await zip.file(opfPath).async("string");

  const manifest = new Map();
  let ncxPath = null;
  let navPath = null;
  for (const m of opfXml.matchAll(/<item\b([^>]+?)\/?>/gi)) {
    const attrs = m[1];
    const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const type = attrs.match(/\bmedia-type=["']([^"']+)["']/i)?.[1] || "";
    const props = attrs.match(/\bproperties=["']([^"']+)["']/i)?.[1] || "";
    if (id && href) {
      const resolved = resolveHref(opfPath, decodeURIComponent(href));
      manifest.set(id, { id, path: resolved, type, props });
      if (type === "application/x-dtbncx+xml" || resolved.endsWith(".ncx")) ncxPath = resolved;
      if (props.includes("nav")) navPath = resolved;
    }
  }

  const tocMap = new Map();
  if (ncxPath && zip.file(ncxPath)) {
    const ncxXml = await zip.file(ncxPath).async("string");
    for (const m of ncxXml.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
      const label = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "")).normalize("NFC").replace(/\s+/g, " ").trim();
      const src = resolveHref(ncxPath, decodeURIComponent(m[2]));
      if (label && src && !tocMap.has(src)) tocMap.set(src, label);
    }
  }

  const spine = [...opfXml.matchAll(/<itemref\b[^>]*?\bidref=["']([^"']+)["']/gi)]
    .map((m) => manifest.get(m[1]))
    .filter(Boolean);

  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);

  const illuFiles = [];
  const imgEntries = Object.keys(zip.files)
    .filter((k) => !zip.files[k].dir && /\.(jpe?g|png|webp)$/i.test(k))
    .sort();
  if (imgEntries.length > 0) {
    const coverBuf = await zip.file(imgEntries[0]).async("nodebuffer");
    if (await saveWebpImage(coverBuf, path.join(imgDir, "illu_01.webp"))) {
      illuFiles.push("illu_01.webp");
    }
  }

  const finalChapters = [
    {
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    }
  ];

  for (const item of spine) {
    const fileEntry = zip.file(item.path);
    if (!fileEntry) continue;
    const baseName = path.posix.basename(item.path).toLowerCase();
    const tocLabel = tocMap.get(item.path) || "";
    if (
      item.path === navPath ||
      /^(?:nav|toc|mucluc|cover|jacket|titlepage)\d*\.x?html?$/i.test(baseName) ||
      /^mục\s*lục$/i.test(tocLabel)
    ) {
      continue;
    }

    const html = await fileEntry.async("string");
    const paragraphs = extractBlocksFromHtml(html);
    if (!paragraphs.length) continue;

    const hMatch = html.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i);
    const hText = hMatch
      ? decodeHtmlEntities(hMatch[1].replace(/<[^>]+>/g, " ")).normalize("NFC").replace(/\s+/g, " ").trim()
      : "";
    let chTitle = tocLabel || hText || paragraphs[0];
    let bodyParas = stripDuplicateTitleParagraphs(chTitle, paragraphs);

    // Skip empty volume divider pages ("Tập 1", "Tập 2")
    if (bodyParas.length === 0 && /^Tập\s*\d+$/i.test(chTitle)) {
      continue;
    }

    // Upgrade generic "Chương N" to full "Chương N: ..." from first paragraph
    if (/^Chương\s*\d+$/i.test(chTitle) && bodyParas.length > 0 && /^Chương\s*\d+\s*[:：]/i.test(bodyParas[0])) {
      chTitle = bodyParas[0];
      bodyParas = bodyParas.slice(1);
    }

    // Normalize "Chương N Tên chương" (Vol 3) -> "Chương N: Tên chương"
    chTitle = chTitle.replace(/^(Chương\s+\d+)\s+(?![:：])/i, "$1: ");

    finalChapters.push({
      title: chTitle,
      content: bodyParas.join("\n\n"),
      isIllustration: false
    });
  }

  return { volumeName, chapters: finalChapters };
}

async function main() {
  console.log("🚀 Importing Hành Trình Của Elaina (Vols 1-3) from dtv-ebook.com.vn...\n");

  const slug = "hanh-trinh-cua-elaina";
  const seriesOutDir = path.join(OUTPUT_ROOT, slug);
  fs.rmSync(seriesOutDir, { recursive: true, force: true });
  ensureDir(seriesOutDir);

  const volumes = [
    { file: "elaina-01.epub", volName: "Tập 01", label: "Tập 01", title: "Hành Trình Của Elaina - Tập 1" },
    { file: "elaina-02.epub", volName: "Tập 02", label: "Tập 02", title: "Hành Trình Của Elaina - Tập 2" },
    { file: "elaina-03.epub", volName: "Tập 03", label: "Tập 03", title: "Hành Trình Của Elaina - Tập 3" }
  ];

  const metadata = [];
  const volumeTitles = {};

  for (const v of volumes) {
    const buf = fs.readFileSync(path.join(CACHE_DIR, v.file));
    const volData = await parseElainaVolume(buf, v.volName, seriesOutDir);
    metadata.push(volData);
    volumeTitles[sanitizeName(v.volName)] = {
      label: v.label,
      title: v.title
    };
    console.log(`✔ Parsed ${v.volName}: ${volData.chapters.length} chapters`);
    volData.chapters.forEach((ch, idx) => {
      console.log(`   ${idx + 1}. ${ch.title} (${(ch.content || "").length} chars)`);
    });
  }

  fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  const seriesList = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8")).filter((s) => s.slug !== slug);
  const elainaEntry = {
    slug,
    source: `output/${slug}`,
    titleVi: "Hành Trình Của Elaina",
    volumeTitles,
    titleJp: "Majo no Tabitabi (魔女の旅々)",
    author: "Jougi Shiraishi",
    illustrator: "Azure",
    status: "Đang cập nhật",
    description:
      "Ở một xứ sở nọ có một cô phù thủy nhỏ yêu thích ngao du thiên hạ. Khoác lên mình tấm áo choàng đen lấp lánh huy hiệu trên ngực cùng mái tóc màu xám tro bay trong gió, “Phù thủy Tro Tàn” Elaina đi qua biết bao vùng đất kỳ lạ, gặp gỡ vô vàn con người và ghi lại những câu chuyện vừa dịu dàng vừa chất chứa suy tư trên hành trình bất tận của mình.",
    tags: ["Fantasy", "Adventure", "Đời thường", "Light Novel"]
  };

  // Insert among multi-volume Light Novel series near the top
  const insertIdx = seriesList.findIndex((s) => s.slug === "co-gai-van-chuong");
  if (insertIdx >= 0) {
    seriesList.splice(insertIdx + 1, 0, elainaEntry);
  } else {
    seriesList.unshift(elainaEntry);
  }

  fs.writeFileSync(SERIES_JSON_PATH, `${JSON.stringify(seriesList, null, 2)}\n`, "utf8");
  console.log(`\n🎉 Updated series.json with Hành Trình Của Elaina (total: ${seriesList.length} series).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
