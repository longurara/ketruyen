const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const CACHE_DIR =
  "C:\\Users\\Hikari\\.gemini\\antigravity\\brain\\40a658b2-a363-4b57-8766-4f057aa2915d\\scratch\\dtv-nomura-mizuki";
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

function extractBlocksFromHtml(html, basePath = "") {
  let body = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div\b[^>]*class=["'](?:header|author)["'][^>]*>[\s\S]*?<\/div>/gi, "");

  const imgSrcs = [];
  for (const m of body.matchAll(/<(?:img|image)\b[^>]*?\b(?:src|xlink:href|href)=["']([^"']+)["'][^>]*>/gi)) {
    const rawHref = m[1];
    const resolved = basePath ? resolveHref(basePath, decodeURIComponent(rawHref)) : decodeURIComponent(rawHref);
    if (resolved && !/01\.png$/i.test(resolved) && !/image[23]\.gif$/i.test(resolved) && !imgSrcs.includes(resolved)) {
      imgSrcs.push(resolved);
    }
  }

  body = body.replace(/<aside\b[^>]*epub:type=["']footnote["'][^>]*>([\s\S]*?)<\/aside>/gi, (_, inner) => {
    const txt = decodeHtmlEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return txt ? `\n\n[Chú thích: ${txt}]\n\n` : "\n\n";
  });

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

  return { paragraphs, imgSrcs };
}

async function parseCgvcVol1(buf, volumeName, seriesOutputDir) {
  const zip = await JSZip.loadAsync(buf);
  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);

  const illuFiles = [];
  const coverBuf = await zip.file("cover.jpeg").async("nodebuffer");
  if (await saveWebpImage(coverBuf, path.join(imgDir, "illu_01.webp"))) {
    illuFiles.push("illu_01.webp");
  }

  const h1 = await zip.file("index_split_001.html").async("string");
  const h2 = await zip.file("index_split_002.html").async("string");
  const h3 = await zip.file("index_split_003.html").async("string");
  const combined = [h1, h2, h3]
    .map((h) => h.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, ""))
    .join("\n");

  const parts = combined.split(/(?=<p\s+class="block_(?:14|17)"[^>]*>)/i);
  const monologue = extractBlocksFromHtml(parts[0]).paragraphs;

  const finalChapters = [
    {
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    }
  ];

  for (let i = 1; i < parts.length; i++) {
    const { paragraphs, imgSrcs } = extractBlocksFromHtml(parts[i]);
    if (!paragraphs.length) continue;
    const chTitle = paragraphs[0];
    let bodyParas = paragraphs.slice(1);
    if (i === 1 && monologue.length > 0) {
      bodyParas = [...monologue, "--- ---", ...bodyParas];
    }

    const chIdx = finalChapters.length + 1;
    const prefix = `ch${String(chIdx).padStart(2, "0")}`;
    const chImgFiles = [];
    for (const src of imgSrcs) {
      const entry = zip.file(src);
      if (!entry) continue;
      const bufImg = await entry.async("nodebuffer");
      const fileName = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
      if (await saveWebpImage(bufImg, path.join(imgDir, fileName))) {
        chImgFiles.push(fileName);
      }
    }

    finalChapters.push({
      title: chTitle,
      content: bodyParas.join("\n\n"),
      isIllustration: false,
      ...(chImgFiles.length > 0 ? { images: chImgFiles } : {})
    });
  }

  return { volumeName, chapters: finalChapters };
}

async function parseCgvcVol2(buf, volumeName, seriesOutputDir) {
  const zip = await JSZip.loadAsync(buf);
  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);

  const illuFiles = [];
  const coverBuf = await zip.file("cover.jpeg").async("nodebuffer");
  if (await saveWebpImage(coverBuf, path.join(imgDir, "illu_01.webp"))) {
    illuFiles.push("illu_01.webp");
  }

  // Extract opening monologue from the end of index_split_000.html
  const h0 = await zip.file("index_split_000.html").async("string");
  const h0Paras = extractBlocksFromHtml(h0).paragraphs;
  const monoIdx = h0Paras.findIndex((p) => /^Phải giết cô ấy thôi/i.test(p));
  const monologue = monoIdx >= 0 ? h0Paras.slice(monoIdx) : [];

  const finalChapters = [
    {
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    }
  ];

  for (let s = 1; s <= 11; s++) {
    const fileName = `index_split_${String(s).padStart(3, "0")}.html`;
    const html = await zip.file(fileName).async("string");
    const { paragraphs, imgSrcs } = extractBlocksFromHtml(html);
    if (!paragraphs.length) continue;

    const chTitle = paragraphs[0].replace(/\s+\?$/, "?");
    let bodyParas = paragraphs.slice(1);
    if (s === 1 && monologue.length > 0) {
      bodyParas = [...monologue, "--- ---", ...bodyParas];
    }

    const chIdx = finalChapters.length + 1;
    const prefix = `ch${String(chIdx).padStart(2, "0")}`;
    const chImgFiles = [];
    for (const src of imgSrcs) {
      const entry = zip.file(src);
      if (!entry) continue;
      const bufImg = await entry.async("nodebuffer");
      const imgFile = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
      if (await saveWebpImage(bufImg, path.join(imgDir, imgFile))) {
        chImgFiles.push(imgFile);
      }
    }

    finalChapters.push({
      title: chTitle,
      content: bodyParas.join("\n\n"),
      isIllustration: false,
      ...(chImgFiles.length > 0 ? { images: chImgFiles } : {})
    });
  }

  return { volumeName, chapters: finalChapters };
}

async function parseStandardCgvcVolume(buf, volumeName, seriesOutputDir) {
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

  let pendingSectionPrefix = "";

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
    const { paragraphs } = extractBlocksFromHtml(html, item.path);
    if (!paragraphs.length) continue;

    const hMatch = html.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i);
    const hText = hMatch
      ? decodeHtmlEntities(hMatch[1].replace(/<[^>]+>/g, " ")).normalize("NFC").replace(/\s+/g, " ").trim()
      : "";
    let chTitle = tocLabel || hText || paragraphs[0];
    let bodyParas = stripDuplicateTitleParagraphs(chTitle, paragraphs);

    // Handle 1-line section divider pages in cgvc-12 (e.g. "Tâm tư của từng người")
    if (bodyParas.length === 0 && chTitle.length < 60) {
      pendingSectionPrefix = chTitle;
      continue;
    }

    if (pendingSectionPrefix) {
      chTitle = `${pendingSectionPrefix} — ${chTitle}`;
      pendingSectionPrefix = "";
    }

    // Rename volume title heading on intro/blurb pages to "Giới thiệu" or "Mở đầu"
    if (/^(?:Tập\s*\d+|Ngoại\s*truyện\s*\d+)\s*:/i.test(chTitle)) {
      const monoStart = bodyParas.findIndex((p) =>
        /^(?:Đó là vào những ngày|Từ lâu tôi đã nhận ra|Ban đầu tôi rất sợ hãi|Thời khắc từ biệt, em đứng trước tôi)/.test(p)
      );
      if (monoStart > 0) {
        bodyParas.splice(monoStart, 0, "--- ---");
        chTitle = "Mở đầu";
      } else {
        chTitle = "Giới thiệu";
      }
    }

    // If chapter title is generic ("Chương Mở Đầu", "Chương Cuối", "Chương Kết"), check for full title line inside bodyParas
    if (/^Chương\s*(?:mở\s*đầu|cuối|kết)$/i.test(chTitle)) {
      const fullIdx = bodyParas.findIndex(
        (p, idx) => idx < 15 && /^Chương\s*(?:mở\s*đầu|cuối|kết)\s*[:：]/i.test(p) && p.length <= 130
      );
      if (fullIdx === 0) {
        chTitle = bodyParas[0];
        bodyParas = bodyParas.slice(1);
      } else if (fullIdx > 0) {
        chTitle = bodyParas[fullIdx];
        bodyParas[fullIdx] = "--- ---";
      }
    }

    finalChapters.push({
      title: chTitle,
      content: bodyParas.join("\n\n"),
      isIllustration: false
    });
  }

  return { volumeName, chapters: finalChapters };
}

async function parseRikuVaChise(buf, volumeName, seriesOutputDir) {
  const zip = await JSZip.loadAsync(buf);
  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);

  const illuFiles = [];
  for (const imgPath of ["OEBPS/Images/bia_riku.jpg", "OEBPS/Images/poster-riku.jpg", "OEBPS/Images/img009.jpg"]) {
    const entry = zip.file(imgPath);
    if (!entry) continue;
    const bufImg = await entry.async("nodebuffer");
    const fileName = `illu_${String(illuFiles.length + 1).padStart(2, "0")}.webp`;
    if (await saveWebpImage(bufImg, path.join(imgDir, fileName))) {
      illuFiles.push(fileName);
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

  // Merge Section11 into Section10 (Epilogue)
  const sections = [
    { files: ["OEBPS/Text/Section04.xhtml"], title: "Mở đầu" },
    { files: ["OEBPS/Text/Section05.xhtml"], title: "Chương 1: Kỳ nghỉ hè cô độc" },
    { files: ["OEBPS/Text/Section06.xhtml"], title: "Chương 2: Dưới bầu trời tháng Tám, mình nghĩ đến cậu..." },
    { files: ["OEBPS/Text/Section07.xhtml"], title: "Chương 3: Sắc trời bao la..." },
    { files: ["OEBPS/Text/Section08.xhtml"], title: "Chương 4: Chàng trai xa lạ" },
    { files: ["OEBPS/Text/Section09.xhtml"], title: "Chương 5: Tạm biệt tuổi mười lăm" },
    { files: ["OEBPS/Text/Section10.xhtml", "OEBPS/Text/Section11.xhtml"], title: "Lời kết: Ước hẹn" },
    { files: ["OEBPS/Text/Section12.xhtml", "OEBPS/Text/Section13.xhtml"], title: "Lời bạt" }
  ];

  for (const sec of sections) {
    let allParas = [];
    const allImgs = [];
    for (const f of sec.files) {
      const html = await zip.file(f).async("string");
      const { paragraphs, imgSrcs } = extractBlocksFromHtml(html, f);
      const cleaned = stripDuplicateTitleParagraphs(sec.title.replace(/^Chương\s*\d+\s*:\s*/i, ""), paragraphs);
      const cleaned2 = stripDuplicateTitleParagraphs(sec.title, cleaned);
      if (allParas.length > 0 && cleaned2.length > 0) allParas.push("--- ---");
      allParas.push(...cleaned2);
      for (const s of imgSrcs) if (!allImgs.includes(s)) allImgs.push(s);
    }

    const chIdx = finalChapters.length + 1;
    const prefix = `ch${String(chIdx).padStart(2, "0")}`;
    const chImgFiles = [];
    for (const src of allImgs) {
      const entry = zip.file(src);
      if (!entry) continue;
      const bufImg = await entry.async("nodebuffer");
      const fileName = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
      if (await saveWebpImage(bufImg, path.join(imgDir, fileName))) {
        chImgFiles.push(fileName);
      }
    }

    finalChapters.push({
      title: sec.title,
      content: allParas.join("\n\n"),
      isIllustration: false,
      ...(chImgFiles.length > 0 ? { images: chImgFiles } : {})
    });
  }

  return { volumeName, chapters: finalChapters };
}

async function parseChangThamDinhVien(buf, volumeName, seriesOutputDir) {
  const zip = await JSZip.loadAsync(buf);
  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);

  const illuFiles = [];
  const coverBuf = await zip.file("OEBPS/Images/chang-tham-dinh-vien.jpg").async("nodebuffer");
  if (await saveWebpImage(coverBuf, path.join(imgDir, "illu_01.webp"))) {
    illuFiles.push("illu_01.webp");
  }

  const finalChapters = [
    {
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    }
  ];

  const sections = [
    { file: "OEBPS/Text/Section02.xhtml", rawHeading: "1 Công việc tuyệt vời nhất thế gian", title: "Chương 1: Công việc tuyệt vời nhất thế gian" },
    { file: "OEBPS/Text/Section03.xhtml", rawHeading: "2 Lý do cô ấy viết", title: "Chương 2: Lý do cô ấy viết" },
    { file: "OEBPS/Text/Section04.xhtml", rawHeading: "3 Sự cô độc của cá mập vây diều", title: "Chương 3: Sự cô độc của cá mập vây diều" },
    { file: "OEBPS/Text/Section05.xhtml", rawHeading: "4 Những điều phiền nhiễu hàng ngày, ngọt ngào mà ngốc nghếch", title: "Chương 4: Những điều phiền nhiễu hàng ngày, ngọt ngào mà ngốc nghếch" },
    { file: "OEBPS/Text/Section06.xhtml", rawHeading: "5 Người đối xử dịu dàng với tôi ngày hôm ấy", title: "Chương 5: Người đối xử dịu dàng với tôi ngày hôm ấy" },
    { file: "OEBPS/Text/Section07.xhtml", rawHeading: "6 Cuộc chia li cuối Hạ", title: "Chương 6: Cuộc chia li cuối Hạ" },
    { file: "OEBPS/Text/Section08.xhtml", rawHeading: "Chương kết", title: "Chương kết" },
    { file: "OEBPS/Text/Section09.xhtml", rawHeading: "Lời bạt", title: "Lời bạt" }
  ];

  for (const sec of sections) {
    const html = await zip.file(sec.file).async("string");
    const { paragraphs } = extractBlocksFromHtml(html, sec.file);
    const bodyParas = stripDuplicateTitleParagraphs(sec.rawHeading, paragraphs);
    finalChapters.push({
      title: sec.title,
      content: bodyParas.join("\n\n"),
      isIllustration: false
    });
  }

  return { volumeName, chapters: finalChapters };
}

async function main() {
  console.log("🚀 Importing Nomura Mizuki works from dtv-ebook.com.vn...\n");

  // 1. Cô Gái Văn Chương (16 volumes)
  const cgvcSlug = "co-gai-van-chuong";
  const cgvcOutDir = path.join(OUTPUT_ROOT, cgvcSlug);
  fs.rmSync(cgvcOutDir, { recursive: true, force: true });
  ensureDir(cgvcOutDir);

  const cgvcVolumes = [
    { file: "cgvc-01.epub", volName: "Tập 01", label: "Tập 01", title: "Cô Gái Văn Chương và Tên Hề Thích Chết" },
    { file: "cgvc-02.epub", volName: "Tập 02", label: "Tập 02", title: "Cô Gái Văn Chương và Hồn Ma Đói Khát" },
    { file: "cgvc-03.epub", volName: "Tập 03", label: "Tập 03", title: "Cô Gái Văn Chương và Gã Khờ Bị Trói Buộc" },
    { file: "cgvc-04.epub", volName: "Tập 04", label: "Tập 04", title: "Cô Gái Văn Chương và Thiên Thần Sa Ngã" },
    { file: "cgvc-05.epub", volName: "Tập 05", label: "Tập 05", title: "Cô Gái Văn Chương và Người Hành Hương Than Khóc" },
    { file: "cgvc-06.epub", volName: "Tập 06", label: "Tập 06", title: "Cô Gái Văn Chương và Tinh Linh Nước Mang Hoa Mặt Trăng" },
    { file: "cgvc-07.epub", volName: "Tập 07", label: "Tập 07", title: "Cô Gái Văn Chương và Nhà Văn Hướng Về Chúa Trời (Phần 1)" },
    { file: "cgvc-08.epub", volName: "Tập 08", label: "Tập 08", title: "Cô Gái Văn Chương và Nhà Văn Hướng Về Chúa Trời (Phần 2)" },
    { file: "cgvc-09.epub", volName: "Tập 09", label: "Tuyển tập 01", title: "Cô Gái Văn Chương và Tuyển Tập Tình Yêu - Tập 1" },
    { file: "cgvc-10.epub", volName: "Tập 10", label: "Tuyển tập 02", title: "Cô Gái Văn Chương và Tuyển Tập Tình Yêu - Tập 2" },
    { file: "cgvc-11.epub", volName: "Tập 11", label: "Tuyển tập 03", title: "Cô Gái Văn Chương và Tuyển Tập Tình Yêu - Tập 3" },
    { file: "cgvc-12.epub", volName: "Tập 12", label: "Tuyển tập 04", title: "Cô Gái Văn Chương và Tuyển Tập Tình Yêu - Tập 4" },
    { file: "cgvc-13.epub", volName: "Tập 13", label: "Tập sự 01", title: "Tình Đầu Của Cô Gái Văn Chương Tập Sự" },
    { file: "cgvc-14.epub", volName: "Tập 14", label: "Tập sự 02", title: "Sự Tổn Thương Của Cô Gái Văn Chương Tập Sự" },
    { file: "cgvc-15.epub", volName: "Tập 15", label: "Tập sự 03", title: "Lễ Tốt Nghiệp Của Cô Gái Văn Chương Tập Sự" },
    { file: "cgvc-16.epub", volName: "Tập 16", label: "Hậu truyện", title: "Cô Gái Văn Chương - Nhà Văn Mới Nổi Và Biên Tập Viên" }
  ];

  const cgvcMetadata = [];
  const cgvcVolumeTitles = {};

  for (const v of cgvcVolumes) {
    const buf = fs.readFileSync(path.join(CACHE_DIR, v.file));
    let volData;
    if (v.file === "cgvc-01.epub") {
      volData = await parseCgvcVol1(buf, v.volName, cgvcOutDir);
    } else if (v.file === "cgvc-02.epub") {
      volData = await parseCgvcVol2(buf, v.volName, cgvcOutDir);
    } else {
      volData = await parseStandardCgvcVolume(buf, v.volName, cgvcOutDir);
    }
    cgvcMetadata.push(volData);
    cgvcVolumeTitles[sanitizeName(v.volName)] = {
      label: v.label,
      title: v.title
    };
    console.log(`✔ Parsed ${v.volName} (${v.title}): ${volData.chapters.length} chapters`);
  }

  fs.writeFileSync(path.join(cgvcOutDir, "metadata.json"), JSON.stringify(cgvcMetadata, null, 2), "utf8");

  // 2. Riku Và Chise
  const rikuSlug = "riku-va-chise";
  const rikuOutDir = path.join(OUTPUT_ROOT, rikuSlug);
  fs.rmSync(rikuOutDir, { recursive: true, force: true });
  ensureDir(rikuOutDir);
  const rikuVol = await parseRikuVaChise(
    fs.readFileSync(path.join(CACHE_DIR, "riku-va-chise.epub")),
    "Tập 1",
    rikuOutDir
  );
  fs.writeFileSync(path.join(rikuOutDir, "metadata.json"), JSON.stringify([rikuVol], null, 2), "utf8");
  console.log(`✔ Parsed Riku Và Chise: ${rikuVol.chapters.length} chapters`);

  // 3. Chàng Thẩm Định Viên Và Nữ Tác Giả Tập Sự
  const ctdvSlug = "chang-tham-dinh-vien-va-nu-tac-gia-tap-su";
  const ctdvOutDir = path.join(OUTPUT_ROOT, ctdvSlug);
  fs.rmSync(ctdvOutDir, { recursive: true, force: true });
  ensureDir(ctdvOutDir);
  const ctdvVol = await parseChangThamDinhVien(
    fs.readFileSync(path.join(CACHE_DIR, "chang-tham-dinh-vien.epub")),
    "Tập 1",
    ctdvOutDir
  );
  fs.writeFileSync(path.join(ctdvOutDir, "metadata.json"), JSON.stringify([ctdvVol], null, 2), "utf8");
  console.log(`✔ Parsed Chàng Thẩm Định Viên Và Nữ Tác Giả Tập Sự: ${ctdvVol.chapters.length} chapters`);

  // Update series.json
  const seriesList = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8")).filter(
    (s) => ![cgvcSlug, rikuSlug, ctdvSlug].includes(s.slug)
  );

  const cgvcEntry = {
    slug: cgvcSlug,
    source: `output/${cgvcSlug}`,
    titleVi: "Cô Gái Văn Chương",
    volumeTitles: cgvcVolumeTitles,
    titleJp: "Bungaku Shoujo (”文学少女”シリーズ)",
    author: "Nomura Mizuki",
    illustrator: "Takeoka Miho",
    status: "Hoàn thành",
    description:
      "Amano Tooko — chủ nhiệm câu lạc bộ Văn học tự nhận mình là “Cô gái văn chương”, một yêu tinh sách có thể ăn-tươi-nuốt-sống các trang giấy và cảm nhận hương vị của từng câu chuyện — cùng nam sinh đàn em Inoue Konoha lần mở những bí ẩn đẫm tâm tư ẩn sau các kiệt tác văn học kinh điển. Trọn bộ 16 tập gồm 8 tập chính truyện, 4 tập Tuyển tập Tình yêu, 3 tập Cô gái văn chương Tập sự và tập hậu truyện.",
    tags: ["Mystery", "Romance", "Drama", "Học đường", "Light Novel"]
  };

  const rikuEntry = {
    slug: rikuSlug,
    source: `output/${rikuSlug}`,
    titleVi: "Riku Và Chise - Chàng Trai Phân Chia Thế Giới Và Cô Gái Trong Biệt Thự",
    volumeTitles: {
      Tập_1: {
        label: "Trọn bộ",
        title: "Chàng Trai Phân Chia Thế Giới Và Cô Gái Trong Biệt Thự"
      }
    },
    titleJp: "Riku to Chise: Sekai wo Wakatsu Shounen to Bessou no Shoujo",
    author: "Nomura Mizuki",
    illustrator: "Takeoka Miho",
    status: "Hoàn thành",
    description:
      "Mùa hè năm mười lăm tuổi, vì biến cố ly hôn của cha mẹ, Chise được gửi tới một căn biệt thự yên tĩnh vùng thôn quê. Tại đây, cô tiểu thư luôn giấu nỗi cô đơn sau nụ cười phải lòng Riku — chàng trai có ánh mắt sắc lạnh mưu sinh bằng đủ nghề trong làng và luôn vạch rõ ranh giới giữa hai thế giới.",
    tags: ["Romance", "Drama", "Đời thường", "Light Novel"]
  };

  const ctdvEntry = {
    slug: ctdvSlug,
    source: `output/${ctdvSlug}`,
    titleVi: "Chàng Thẩm Định Viên Và Nữ Tác Giả Tập Sự",
    volumeTitles: {
      Tập_1: {
        label: "Trọn bộ",
        title: "Chàng Thẩm Định Viên Và Nữ Tác Giả Tập Sự"
      }
    },
    titleJp: "Sorezore no Kanteishi to Toukousha",
    author: "Nomura Mizuki",
    illustrator: "Eihi",
    status: "Hoàn thành",
    description:
      "Dù chỉ là một nam sinh cấp ba bình thường, Ao còn làm công việc thẩm định viên đọc duyệt bản thảo dự thi giải thưởng tiểu thuyết mới. Nhờ một sự tình cờ nơi hiệu sách, cậu nhận ra cô bạn cùng lớp rụt rè Hiyuki chính là tác giả của những bản thảo ngập tràn đam mê đã luôn gửi tới suốt bảy năm qua.",
    tags: ["Romance", "Đời thường", "Học đường", "Light Novel"]
  };

  // Insert Cô Gái Văn Chương right next to Khi Hikaru Còn Trên Thế Gian Này...
  const hikaruIdx = seriesList.findIndex((s) => s.slug === "khi-hikaru-con-tren-the-gian-nay");
  if (hikaruIdx >= 0) {
    seriesList.splice(hikaruIdx, 0, cgvcEntry);
  } else {
    seriesList.unshift(cgvcEntry);
  }

  seriesList.push(ctdvEntry, rikuEntry);
  fs.writeFileSync(SERIES_JSON_PATH, `${JSON.stringify(seriesList, null, 2)}\n`, "utf8");
  console.log(`\n🎉 Updated series.json with 3 new Nomura Mizuki entries (total: ${seriesList.length} series).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
