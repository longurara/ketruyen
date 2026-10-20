const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const CACHE_DIR =
  "C:\\Users\\Hikari\\.gemini\\antigravity\\brain\\40a658b2-a363-4b57-8766-4f057aa2915d\\scratch\\dtv-hasekura-mikami";
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

  return paragraphs;
}

function readOpfSpineAndToc(zip, opfPath, opfXml) {
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
    return zip
      .file(ncxPath)
      .async("string")
      .then((ncxXml) => {
        for (const m of ncxXml.matchAll(
          /<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*?\bsrc=["']([^"']+)["']/gi
        )) {
          const label = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "")).normalize("NFC").replace(/\s+/g, " ").trim();
          const src = resolveHref(ncxPath, decodeURIComponent(m[2]));
          if (label && src && !tocMap.has(src)) tocMap.set(src, label);
        }
        const spine = [...opfXml.matchAll(/<itemref\b[^>]*?\bidref=["']([^"']+)["']/gi)]
          .map((m) => manifest.get(m[1]))
          .filter(Boolean);
        return { spine, tocMap, navPath };
      });
  }

  const spine = [...opfXml.matchAll(/<itemref\b[^>]*?\bidref=["']([^"']+)["']/gi)]
    .map((m) => manifest.get(m[1]))
    .filter(Boolean);
  return Promise.resolve({ spine, tocMap, navPath });
}

async function extractCoverIllustrations(zip, imgDir) {
  const illuFiles = [];
  const imgEntries = Object.keys(zip.files)
    .filter((k) => !zip.files[k].dir && /\.(jpe?g|png|webp)$/i.test(k) && !/logo-hadu/i.test(k))
    .sort((a, b) => {
      const aCover = /cover|bia/i.test(a) ? 0 : 1;
      const bCover = /cover|bia/i.test(b) ? 0 : 1;
      return aCover - bCover || a.localeCompare(b);
    });

  for (const entryName of imgEntries) {
    const buf = await zip.file(entryName).async("nodebuffer");
    const fileName = `illu_${String(illuFiles.length + 1).padStart(2, "0")}.webp`;
    if (await saveWebpImage(buf, path.join(imgDir, fileName))) {
      illuFiles.push(fileName);
    }
  }
  return illuFiles;
}

// ============================================================================
//  1. SÓI VÀ GIA VỊ (Vols 1-8)
// ============================================================================
async function parseSpiceAndWolfVolume(buf, volumeName, seriesOutputDir) {
  const zip = await JSZip.loadAsync(buf);
  const containerXml = await zip.file("META-INF/container.xml").async("string");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)[1];
  const opfXml = await zip.file(opfPath).async("string");
  const { spine, tocMap, navPath } = await readOpfSpineAndToc(zip, opfPath, opfXml);

  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);
  const illuFiles = await extractCoverIllustrations(zip, imgDir);

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
      /^mục\s*lục$/i.test(tocLabel) ||
      /^tác\s*giả/i.test(tocLabel)
    ) {
      continue;
    }

    const html = await fileEntry.async("string");
    const paragraphs = extractBlocksFromHtml(html);
    if (!paragraphs.length) continue;

    let chTitle = tocLabel || paragraphs[0];
    if (/^Danh\s+sách\s+nhân\s+vật$/i.test(chTitle) && /^Mở\s+đầu$/i.test(paragraphs[0])) {
      chTitle = "Mở đầu";
    }
    let bodyParas = stripDuplicateTitleParagraphs(chTitle, paragraphs);

    if (/^Tập\s*\d+/i.test(chTitle)) {
      chTitle = "Giới thiệu";
    } else {
      // Fix Roman numerals like "Chương Ii", "Chương Iii", "Chương Iv", "Chương Vi"
      chTitle = chTitle.replace(/^(Chương\s+)([ivx]+)\b/i, (_, p1, r) => `${p1}${r.toUpperCase()}`);
    }

    finalChapters.push({
      title: chTitle,
      content: bodyParas.join("\n\n"),
      isIllustration: false
    });
  }

  return { volumeName, chapters: finalChapters };
}

// ============================================================================
//  2. TIỆM SÁCH CŨ BIBLIA (Vols 1-8) & HIỆU ẢNH NISHIURA Ở ENOSHIMA
// ============================================================================
async function parseBibliaVolume(buf, volumeName, seriesOutputDir) {
  const zip = await JSZip.loadAsync(buf);
  const containerXml = await zip.file("META-INF/container.xml").async("string");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)[1];
  const opfXml = await zip.file(opfPath).async("string");
  const { spine, tocMap, navPath } = await readOpfSpineAndToc(zip, opfPath, opfXml);

  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);
  const illuFiles = await extractCoverIllustrations(zip, imgDir);

  const finalChapters = [
    {
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    }
  ];

  let currentGroupedChapter = null;
  function flushGrouped() {
    if (currentGroupedChapter && currentGroupedChapter.paragraphs.length > 0) {
      finalChapters.push({
        title: currentGroupedChapter.title,
        content: currentGroupedChapter.paragraphs.join("\n\n"),
        isIllustration: false
      });
      currentGroupedChapter = null;
    }
  }

  for (const item of spine) {
    const fileEntry = zip.file(item.path);
    if (!fileEntry) continue;
    const baseName = path.posix.basename(item.path).toLowerCase();
    const tocLabel = tocMap.get(item.path) || "";
    if (
      item.path === navPath ||
      /^(?:nav|toc|mucluc|cover|jacket|titlepage)\d*\.x?html?$/i.test(baseName) ||
      /^mục\s*lục$/i.test(tocLabel) ||
      /^tác\s*giả/i.test(tocLabel)
    ) {
      continue;
    }

    const html = await fileEntry.async("string");
    const paragraphs = extractBlocksFromHtml(html);
    if (!paragraphs.length) continue;

    let chTitle = tocLabel || paragraphs[0];
    if (/^Danh\s+sách\s+nhân\s+vật$/i.test(chTitle) && /^Mở\s+đầu$/i.test(paragraphs[0])) {
      chTitle = "Mở đầu";
    }

    // Check if this is a 2-line story header page in Biblia Vol 6/7 (e.g. ["Chuyện thứ nhất", "“Chạy đi, Moerus!”"])
    if (paragraphs.length === 2 && /^Chuyện\s+thứ\s+/i.test(paragraphs[0]) && paragraphs[1].length < 100) {
      flushGrouped();
      currentGroupedChapter = {
        title: `${paragraphs[0]}: ${paragraphs[1]}`,
        paragraphs: []
      };
      continue;
    }

    // Check if this is a numbered sub-section ("1", "2", ..., "9") belonging to currentGroupedChapter
    if (currentGroupedChapter && /^\d+$/.test(chTitle.trim())) {
      const subNum = chTitle.trim();
      const subParas = stripDuplicateTitleParagraphs(subNum, paragraphs);
      if (currentGroupedChapter.paragraphs.length > 0) {
        currentGroupedChapter.paragraphs.push("--- ---");
      }
      currentGroupedChapter.paragraphs.push(`Phần ${subNum}`, ...subParas);
      continue;
    }

    flushGrouped();

    let bodyParas = stripDuplicateTitleParagraphs(chTitle, paragraphs);

    if (
      /^Tập\s*\d+/i.test(chTitle) ||
      /^Start$/i.test(chTitle) ||
      (chTitle === "Mở đầu" && /^Để tranh đoạt bản in đầu tiên/i.test(paragraphs[0])) ||
      /^Câu chuyện về mối ràng buộc với sách cũ/i.test(paragraphs[0])
    ) {
      if (/^Tập\s*\d+\s*:/i.test(paragraphs[0])) bodyParas = paragraphs.slice(1);
      else bodyParas = paragraphs;
      chTitle = "Giới thiệu";
    } else if (/^Tác\s*giả$/i.test(chTitle)) {
      continue;
    } else if (
      /^(?:Chuyện\s+thứ\s+\S+|Mở\s+đầu|Phần\s+kết|Giao\s+đoạn\s+\d+)$/i.test(chTitle) &&
      bodyParas.length > 0
    ) {
      if (/^(?:Chuyện\s+thứ|Mở\s+đầu|Phần\s+kết|Giao\s+đoạn)(?:\s|:).*[:：]/i.test(bodyParas[0]) && bodyParas[0].length <= 140) {
        chTitle = bodyParas[0];
        bodyParas = bodyParas.slice(1);
        if (bodyParas.length > 0 && /^\(.*phát hành\)$/i.test(bodyParas[0])) {
          chTitle = `${chTitle} ${bodyParas[0]}`;
          bodyParas = bodyParas.slice(1);
        }
      } else if (/^Chuyện\s+thứ\s+/i.test(chTitle) && bodyParas[0].length <= 110 && !/[.!?]$/.test(bodyParas[0])) {
        // Biblia Vol 8 where p0 after "Chuyện thứ nhất" is the book title
        chTitle = `${chTitle}: ${bodyParas[0]}`;
        bodyParas = bodyParas.slice(1);
      }
    }

    finalChapters.push({
      title: chTitle,
      content: bodyParas.join("\n\n"),
      isIllustration: false
    });
  }

  flushGrouped();

  return { volumeName, chapters: finalChapters };
}

async function main() {
  console.log("🚀 Importing Hasekura Isuna & Mikami En works from dtv-ebook.com.vn...\n");

  // 1. Sói và Gia Vị (8 volumes)
  const svgvSlug = "soi-va-gia-vi";
  const svgvOutDir = path.join(OUTPUT_ROOT, svgvSlug);
  fs.rmSync(svgvOutDir, { recursive: true, force: true });
  ensureDir(svgvOutDir);

  const svgvVolumes = [
    { file: "svgv-01.epub", volName: "Tập 01", label: "Tập 01", title: "Sói và Gia Vị - Tập 1" },
    { file: "svgv-02.epub", volName: "Tập 02", label: "Tập 02", title: "Sói và Gia Vị - Tập 2" },
    { file: "svgv-03.epub", volName: "Tập 03", label: "Tập 03", title: "Sói và Gia Vị - Tập 3" },
    { file: "svgv-04.epub", volName: "Tập 04", label: "Tập 04", title: "Sói và Gia Vị - Tập 4" },
    { file: "svgv-05.epub", volName: "Tập 05", label: "Tập 05", title: "Sói và Gia Vị - Tập 5" },
    { file: "svgv-06.epub", volName: "Tập 06", label: "Tập 06", title: "Sói và Gia Vị - Tập 6" },
    { file: "svgv-07.epub", volName: "Tập 07", label: "Tập 07", title: "Những Thanh Sắc Ven Đường (Side Colors)" },
    { file: "svgv-08.epub", volName: "Tập 08", label: "Tập 08", title: "Thị Trấn Đối Lập (Phần Đầu)" }
  ];

  const svgvMetadata = [];
  const svgvVolumeTitles = {};

  for (const v of svgvVolumes) {
    const buf = fs.readFileSync(path.join(CACHE_DIR, v.file));
    const volData = await parseSpiceAndWolfVolume(buf, v.volName, svgvOutDir);
    svgvMetadata.push(volData);
    svgvVolumeTitles[sanitizeName(v.volName)] = {
      label: v.label,
      title: v.title
    };
    console.log(`✔ [Sói và Gia Vị] ${v.volName} (${v.title}): ${volData.chapters.length} chapters`);
  }
  fs.writeFileSync(path.join(svgvOutDir, "metadata.json"), JSON.stringify(svgvMetadata, null, 2), "utf8");

  // 2. Tiệm Sách Cũ Biblia (8 volumes)
  const bibliaSlug = "tiem-sach-cu-biblia";
  const bibliaOutDir = path.join(OUTPUT_ROOT, bibliaSlug);
  fs.rmSync(bibliaOutDir, { recursive: true, force: true });
  ensureDir(bibliaOutDir);

  const bibliaVolumes = [
    { file: "biblia-01.epub", volName: "Tập 01", label: "Tập 01", title: "Shioriko Và Những Vị Khách Kì Lạ" },
    { file: "biblia-02.epub", volName: "Tập 02", label: "Tập 02", title: "Shioriko Và Đời Thường Bí Ẩn" },
    { file: "biblia-03.epub", volName: "Tập 03", label: "Tập 03", title: "Shioriko Và Những Lời Chưa Ngỏ" },
    { file: "biblia-04.epub", volName: "Tập 04", label: "Tập 04", title: "Shioriko Và Dung Nhan Hai Mặt" },
    { file: "biblia-05.epub", volName: "Tập 05", label: "Tập 05", title: "Shioriko Và Cuộc Hội Ngộ Trong Câu Đố" },
    { file: "biblia-06.epub", volName: "Tập 06", label: "Tập 06", title: "Shioriko Và Định Mệnh Xoay Vòng" },
    { file: "biblia-07.epub", volName: "Tập 07", label: "Tập 07", title: "Shioriko Và Sân Khấu Bất Tận" },
    { file: "biblia-08.epub", volName: "Tập 08", label: "Tập 08 (Ngoại truyện)", title: "Tobirako Và Những Vị Khách Kỳ Lạ" }
  ];

  const bibliaMetadata = [];
  const bibliaVolumeTitles = {};

  for (const v of bibliaVolumes) {
    const buf = fs.readFileSync(path.join(CACHE_DIR, v.file));
    const volData = await parseBibliaVolume(buf, v.volName, bibliaOutDir);
    bibliaMetadata.push(volData);
    bibliaVolumeTitles[sanitizeName(v.volName)] = {
      label: v.label,
      title: v.title
    };
    console.log(`✔ [Tiệm Sách Cũ Biblia] ${v.volName} (${v.title}): ${volData.chapters.length} chapters`);
    volData.chapters.forEach((ch, idx) => {
      console.log(`   ${idx + 1}. ${ch.title} (${(ch.content || "").length} chars)`);
    });
  }
  fs.writeFileSync(path.join(bibliaOutDir, "metadata.json"), JSON.stringify(bibliaMetadata, null, 2), "utf8");

  // 3. Hiệu Ảnh Nishiura ở Enoshima
  const nishiuraSlug = "hieu-anh-nishiura-o-enoshima";
  const nishiuraOutDir = path.join(OUTPUT_ROOT, nishiuraSlug);
  fs.rmSync(nishiuraOutDir, { recursive: true, force: true });
  ensureDir(nishiuraOutDir);

  const nishiuraVol = await parseBibliaVolume(
    fs.readFileSync(path.join(CACHE_DIR, "nishiura.epub")),
    "Tập 1",
    nishiuraOutDir
  );
  fs.writeFileSync(path.join(nishiuraOutDir, "metadata.json"), JSON.stringify([nishiuraVol], null, 2), "utf8");
  console.log(`✔ [Hiệu Ảnh Nishiura ở Enoshima]: ${nishiuraVol.chapters.length} chapters`);
  nishiuraVol.chapters.forEach((ch, idx) => {
    console.log(`   ${idx + 1}. ${ch.title} (${(ch.content || "").length} chars)`);
  });

  // Update series.json
  const seriesList = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8")).filter(
    (s) => ![svgvSlug, bibliaSlug, nishiuraSlug].includes(s.slug)
  );

  const svgvEntry = {
    slug: svgvSlug,
    source: `output/${svgvSlug}`,
    titleVi: "Sói Và Gia Vị",
    volumeTitles: svgvVolumeTitles,
    titleJp: "Ookami to Koushinryou (狼と香辛料 / Spice and Wolf)",
    author: "Hasekura Isuna",
    illustrator: "Juu Ayakura",
    status: "Đang cập nhật",
    description:
      "Chàng thương nhân rong Kraft Lawrence tình cờ gặp gỡ Holo — nữ thần sói thông thái trông coi mùa màng suốt hàng trăm năm dưới hình hài một thiếu nữ mang đôi tai và chiếc đuôi sói. Cùng nhau rong ruổi trên chiếc xe ngựa chất đầy hàng hóa qua những đô thị trung cổ sầm uất để tìm đường về phương Bắc Yoitsu, cả hai bước vào những thương vụ gay cấn ngập tràn mưu lược và tình cảm ấm áp.",
    tags: ["Fantasy", "Adventure", "Romance", "Kinh tế", "Light Novel"]
  };

  const bibliaEntry = {
    slug: bibliaSlug,
    source: `output/${bibliaSlug}`,
    titleVi: "Tiệm Sách Cũ Biblia",
    volumeTitles: bibliaVolumeTitles,
    titleJp: "Biblia Koshodou no Jiken Techou (ビブリア古書堂の事件手帖)",
    author: "Mikami En",
    illustrator: "Nakano",
    status: "Hoàn thành",
    description:
      "Nép mình nơi góc phố yên bình ở Kamakura là tiệm sách cũ Biblia của cô chủ trẻ Shinokawa Shioriko — người vốn nhút nhát, kiệm lời nhưng lại sở hữu kiến thức uyên bác cùng niềm đam mê mãnh liệt dành cho sách cổ. Cùng chàng nhân viên Goura Daisuke mắc chứng không thể đọc sách, Shioriko lần giở từng trang sách cũ để giải mã những bí mật và tâm tư sâu kín của những vị khách ghé thăm.",
    tags: ["Mystery", "Đời thường", "Romance", "Văn học Nhật Bản"]
  };

  const nishiuraEntry = {
    slug: nishiuraSlug,
    source: `output/${nishiuraSlug}`,
    titleVi: "Hiệu Ảnh Nishiura Ở Enoshima",
    volumeTitles: {
      Tập_1: {
        label: "Trọn bộ",
        title: "Hiệu Ảnh Nishiura Ở Enoshima"
      }
    },
    titleJp: "Enoshima Nishiura Shashinkan (江ノ島西浦写真館)",
    author: "Mikami En",
    illustrator: "",
    status: "Hoàn thành",
    description:
      "Sau khi người bà qua đời, Katsuragi Mayu tìm đến hiệu ảnh Nishiura hơn một trăm năm tuổi nằm trên hòn đảo Enoshima để thu dọn di vật. Những bức ảnh cũ còn lưu lại trong tiệm dần hé mở những câu chuyện bí ẩn, dịu dàng và đầy hoài niệm vượt qua dòng thời gian.",
    tags: ["Mystery", "Đời thường", "Chữa lành", "Văn học Nhật Bản"]
  };

  const elainaIdx = seriesList.findIndex((s) => s.slug === "hanh-trinh-cua-elaina");
  if (elainaIdx >= 0) {
    seriesList.splice(elainaIdx + 1, 0, svgvEntry, bibliaEntry);
  } else {
    seriesList.unshift(svgvEntry, bibliaEntry);
  }
  seriesList.push(nishiuraEntry);

  fs.writeFileSync(SERIES_JSON_PATH, `${JSON.stringify(seriesList, null, 2)}\n`, "utf8");
  console.log(`\n🎉 Updated series.json with 3 new series (total: ${seriesList.length} series).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
