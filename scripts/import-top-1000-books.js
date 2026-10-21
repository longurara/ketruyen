const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const SACH10K_ROOT = "E:\\sach_10k";
const CATALOG_10K_PATH = path.join(SACH10K_ROOT, "catalog-10k.json");
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const PUBLIC_IMG_ROOT = path.join(PUBLIC_DIR, "img");
const SERIES_JSON_PATH = path.join(ROOT_DIR, "series.json");

const COVER_WIDTH = 520;
const TARGET_TOTAL = 1000;

// Target quotas across 4 sub-sections of Tủ Sách 1000
const SECTION_QUOTAS = {
  "b1k-lit": 400,       // Văn học & Kinh điển
  "b1k-mystery": 220,   // Trinh thám & Kỳ ảo
  "b1k-knowledge": 200, // Lịch sử, Triết học & Khoa học
  "b1k-life": 180       // Kinh tế & Kỹ năng sống
};

const SECTION_LABELS = {
  "b1k-lit": "Tủ Sách 1000 — Văn học & Kinh điển",
  "b1k-mystery": "Tủ Sách 1000 — Trinh thám & Kỳ ảo",
  "b1k-knowledge": "Tủ Sách 1000 — Lịch sử & Khoa học",
  "b1k-life": "Tủ Sách 1000 — Kinh tế & Kỹ năng"
};

const CATEGORY_TAGS = {
  "01_Tac_Gia_Noi_Tieng": ["Tác giả nổi tiếng", "Văn học"],
  "02_Van_Hoc_Kinh_Dien_The_Gioi": ["Kinh điển", "Văn học thế giới"],
  "03_Hinh_Su_Trinh_Tham_Kinh_Di": ["Trinh thám", "Hình sự", "Bí ẩn"],
  "04_Tieu_Thuyet_Truyen_Dai": ["Tiểu thuyết", "Văn học"],
  "05_Truyen_Ngan_Tan_Van_Tuy_But": ["Truyện ngắn", "Tản văn"],
  "06_Kinh_Te_Kinh_Doanh_Quan_Tri": ["Kinh tế", "Quản trị", "Kinh doanh"],
  "07_Ky_Nang_Song_Tam_Ly": ["Kỹ năng sống", "Tâm lý"],
  "08_Lich_Su_Triet_Hoc_Van_Hoa": ["Lịch sử", "Triết học", "Văn hóa"],
  "09_Khoa_Hoc_Y_Hoc_Kien_Thuc": ["Khoa học", "Kiến thức"],
  "10_Phieu_Luu_Huyen_Ao_Kiem_Hiep": ["Phiêu lưu", "Kỳ ảo"],
  "11_Thieu_Nhi_Tuoi_Hoc_Tro": ["Thiếu nhi", "Tuổi học trò"]
};

const FAMOUS_KEYWORDS = new RegExp(
  [
    "Murakami", "Keigo", "Nguyễn Nhật Ánh", "Nguyen Nhat Anh", "Nguyễn Hiến Lê", "Nguyen Hien Le",
    "Nguyễn Duy Cần", "Nguyen Duy Can", "Kim Dung", "Cổ Long", "Co Long", "Agatha Christie",
    "Conan Doyle", "Sherlock Holmes", "Stephen King", "Osho", "Thích Nhất Hạnh", "Thich Nhat Hanh",
    "Ngô Tất Tố", "Ngo Tat To", "Nam Cao", "Vũ Trọng Phụng", "Vu Trong Phung", "Thạch Lam", "Thach Lam",
    "Tô Hoài", "To Hoai", "Nguyễn Tuân", "Nguyen Tuan", "Bảo Ninh", "Bao Ninh", "Nguyễn Huy Thiệp",
    "Victor Hugo", "Dostoevsky", "Tolstoy", "Kafka", "Marquez", "Hemingway", "Jack London",
    "Mark Twain", "Charles Dickens", "Alexandre Dumas", "Balzac", "Camus", "Sartre", "Hermann Hesse",
    "Dan Brown", "Sidney Sheldon", "Jeffrey Archer", "Mario Puzo", "Thomas Harris", "Franck Thilliez",
    "Seishi Yokomizo", "Minato Kanae", "Tử Kim Trần", "Lôi Mễ", "Quỷ Cổ Nữ", "Chu Dịch",
    "Dale Carnegie", "Napoleon Hill", "Malcolm Gladwell", "Harari", "Kiyosaki", "Stephen Covey",
    "Paulo Coelho", "Khaled Hosseini", "John Steinbeck", "Harper Lee", "George Orwell", "Tolkien",
    "Kẹp Hạt Dẻ", "Đắc Nhân Tâm", "Nhà Giả Kim", "Suối Nguồn", "Bố Già", "Trăm Năm Cô Đơn",
    "Chiến Tranh Tiền Tệ", "Bạch Dạ Hành", "Phía Sau Nghi Can X", "Rừng Na Uy", "1Q84"
  ].join("|"),
  "i"
);

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
    .slice(0, 68)
    .replace(/-+$/g, "");
}

function normalizeMatchKey(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function hasVietnameseDiacritics(str) {
  return /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(str || "");
}

function decodeHtmlEntities(str) {
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
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return code > 0 ? String.fromCodePoint(code) : "";
    });
}

function toTitleCaseIfAllCaps(title) {
  const clean = String(title || "").normalize("NFC").replace(/\s+/g, " ").trim();
  const letters = clean.replace(/[^\p{L}]/gu, "");
  if (!letters || letters !== letters.toUpperCase()) return clean;
  return clean
    .toLowerCase()
    .replace(/(^|\s|[-–—~:(“"'])(\p{L})/gu, (m, sep, ch) => `${sep}${ch.toUpperCase()}`);
}

function resolveHref(base, href) {
  if (!href) return "";
  const clean = href.split("#")[0];
  if (!clean) return base;
  const dir = path.posix.dirname(base);
  return dir === "." ? clean : path.posix.join(dir, clean);
}

function mapCategoryToSubSection(category) {
  switch (category) {
    case "01_Tac_Gia_Noi_Tieng":
    case "02_Van_Hoc_Kinh_Dien_The_Gioi":
    case "04_Tieu_Thuyet_Truyen_Dai":
    case "05_Truyen_Ngan_Tan_Van_Tuy_But":
    case "11_Thieu_Nhi_Tuoi_Hoc_Tro":
      return "b1k-lit";
    case "03_Hinh_Su_Trinh_Tham_Kinh_Di":
    case "10_Phieu_Luu_Huyen_Ao_Kiem_Hiep":
      return "b1k-mystery";
    case "08_Lich_Su_Triet_Hoc_Van_Hoa":
    case "09_Khoa_Hoc_Y_Hoc_Kien_Thuc":
      return "b1k-knowledge";
    case "06_Kinh_Te_Kinh_Doanh_Quan_Tri":
    case "07_Ky_Nang_Song_Tam_Ly":
      return "b1k-life";
    default:
      return "b1k-lit";
  }
}

function parseFilenameTitleAuthor(fileName) {
  let base = fileName
    .replace(/\.kepub\.epub$/i, "")
    .replace(/\.[^.]+$/, "")
    .replace(/_converted$/i, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/[_]+/g, " ")
    .trim();

  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].replace(/\s*\([^)]*dịch[^)]*\)/gi, "").trim();
    const titlePart = parts.slice(0, -1).join(" - ").trim();
    return { title: toTitleCaseIfAllCaps(titlePart), author: toTitleCaseIfAllCaps(last) };
  }
  return { title: toTitleCaseIfAllCaps(base), author: "" };
}

function extractBlocksFromHtml(html) {
  let body = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  body = body.replace(/<hr\b[^>]*\/?>/gi, "\n\n--- ---\n\n");
  body = body.replace(/<br\b[^>]*\/?>/gi, "\n");
  body = body.replace(/<\/?(?:p|div|h[1-6]|li|blockquote|section|article|tr|header|footer|aside|center)\b[^>]*>/gi, "\n\n");

  const rawText = decodeHtmlEntities(body.replace(/<[^>]+>/g, ""));
  const lines = rawText
    .normalize("NFC")
    .split(/\n+/)
    .map((l) => l.replace(/[ \t\r\f\v\u00a0]+/g, " ").trim())
    .filter(Boolean);

  const paragraphs = [];
  for (const line of lines) {
    if (/^(?:ebook\s*©|hotaru-team|dtv-ebook\.com|www\.dtv-ebook\.com|tve-4u\.org|sachvui\.com)/i.test(line)) continue;
    if (/^(?:[*＊•·◊♦●○❖✦✧~～—–-]\s*){2,}$/.test(line) || /^[*＊◊♦❖✦✧]$/.test(line)) {
      if (paragraphs[paragraphs.length - 1] !== "--- ---") paragraphs.push("--- ---");
      continue;
    }
    paragraphs.push(line);
  }
  return paragraphs;
}

const CHAPTER_HEADING_RE = /^(?:Chương|Phần|Hồi|Quyển|Chapter|Màn|Tập|Book|Part|Lời\s+mở\s+đầu|Mở\s+đầu|Lời\s+bạt|Phụ\s+lục)\s*(?:\d+|[IVXLCDM]+|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|:|\b)/i;

function splitParagraphsIntoChapters(paragraphs) {
  const result = [];
  let current = null;
  for (const p of paragraphs) {
    if (p.length <= 95 && CHAPTER_HEADING_RE.test(p)) {
      if (current && current.paragraphs.length > 0) result.push(current);
      current = { title: p, paragraphs: [] };
    } else {
      if (!current) current = { title: "Mở đầu", paragraphs: [] };
      current.paragraphs.push(p);
    }
  }
  if (current && current.paragraphs.length > 0) result.push(current);

  // If still 1 huge chapter (> 400 paragraphs), chunk into readable parts of ~120 paragraphs
  if (result.length === 1 && result[0].paragraphs.length > 360) {
    const allParas = result[0].paragraphs;
    const chunked = [];
    const chunkSize = 120;
    for (let i = 0; i < allParas.length; i += chunkSize) {
      chunked.push({
        title: `Phần ${chunked.length + 1}`,
        paragraphs: allParas.slice(i, i + chunkSize)
      });
    }
    return chunked;
  }
  return result;
}

function cleanDescription(rawDesc, chapters) {
  let d = decodeHtmlEntities(decodeHtmlEntities(rawDesc || ""));
  d = d.replace(/<[^>]+>/g, " ").normalize("NFC").replace(/\s+/g, " ").trim();
  if (d.length >= 45 && !/(?:dtv-ebook|sachvui|tve-4u|calibre)/i.test(d)) {
    return d.length > 340 ? `${d.slice(0, 337).replace(/\s+\S*$/, "")}…` : d;
  }
  for (const ch of chapters) {
    const paras = (ch.paragraphs || []).filter(
      (p) =>
        p.length > 45 &&
        !/(?:Người dịch|Phát hành|Tác giả|Bản quyền|dtv-ebook|Nhà xuất bản|Mục lục|Table of Contents)/i.test(p)
    );
    const joined = paras.slice(0, 2).join(" ");
    if (joined.length >= 60) {
      return joined.length > 340 ? `${joined.slice(0, 337).replace(/\s+\S*$/, "")}…` : joined;
    }
  }
  return "";
}

async function validateCoverBuffer(buf) {
  if (!buf || buf.length < 3500) return null;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    if (meta.width < 130 || meta.height < 170) return null;
    const ratio = meta.height / meta.width;
    if (ratio < 1.05 || ratio > 2.2) return null;
    return buf;
  } catch (_) {
    return null;
  }
}

// ============================================================================
//  EPUB EXTRACTOR
// ============================================================================
async function extractEpub(filePath) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const containerEntry = zip.file("META-INF/container.xml");
  if (!containerEntry) return null;
  const containerXml = await containerEntry.async("string");
  const opfMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
  if (!opfMatch) return null;
  const opfPath = opfMatch[1];
  const opfEntry = zip.file(opfPath);
  if (!opfEntry) return null;
  const opfXml = await opfEntry.async("string");

  const opfTitle = decodeHtmlEntities(
    (opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim()
  ).normalize("NFC");
  const opfCreator = decodeHtmlEntities(
    (opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim()
  ).normalize("NFC");
  const opfDesc = (opfXml.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i)?.[1] || "").trim();

  const manifest = new Map();
  let ncxPath = null;
  let coverId =
    opfXml.match(/<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    opfXml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']cover["']/i)?.[1] ||
    null;

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
      if (props.includes("cover-image") && !coverId) coverId = id;
    }
  }

  // Extract cover
  let coverBuf = null;
  const candidateCoverPaths = [];
  if (coverId && manifest.get(coverId)) candidateCoverPaths.push(manifest.get(coverId).path);
  for (const it of manifest.values()) {
    if (it.type.startsWith("image/") && /cover|bia/i.test(it.path)) candidateCoverPaths.push(it.path);
  }
  for (const it of manifest.values()) {
    if (it.type.startsWith("image/")) candidateCoverPaths.push(it.path);
  }

  for (const cp of candidateCoverPaths.slice(0, 8)) {
    const entry = zip.file(cp) || zip.file(path.posix.basename(cp));
    if (!entry) continue;
    const valid = await validateCoverBuffer(await entry.async("nodebuffer"));
    if (valid) {
      coverBuf = valid;
      break;
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

  const rawChapters = [];
  for (const item of spine) {
    const entry = zip.file(item.path);
    if (!entry) continue;
    const baseName = path.posix.basename(item.path).toLowerCase();
    const tocLabel = tocMap.get(item.path) || "";
    if (/^(?:nav|toc|mucluc|cover|titlepage|copyright)\d*\.x?html?$/i.test(baseName) || /^mục\s*lục$/i.test(tocLabel)) {
      continue;
    }
    const html = await entry.async("string");
    const paragraphs = extractBlocksFromHtml(html);
    if (paragraphs.length === 0) continue;
    const textLen = paragraphs.join(" ").length;
    if (rawChapters.length === 0 && textLen < 120) continue;

    let chTitle = tocLabel;
    if (!chTitle) {
      const hMatch = html.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i);
      const hText = hMatch ? decodeHtmlEntities(hMatch[1].replace(/<[^>]+>/g, " ")).normalize("NFC").replace(/\s+/g, " ").trim() : "";
      chTitle = hText && hText.length <= 110 ? hText : paragraphs[0] && paragraphs[0].length <= 90 ? paragraphs[0] : `Chương ${rawChapters.length + 1}`;
    }
    rawChapters.push({ title: chTitle, paragraphs });
  }

  let finalChapters = rawChapters;
  if (finalChapters.length === 1 && finalChapters[0].paragraphs.length > 80) {
    finalChapters = splitParagraphsIntoChapters(finalChapters[0].paragraphs);
  }

  const totalChars = finalChapters.reduce((s, c) => s + c.paragraphs.join(" ").length, 0);
  if (totalChars < 3000 || finalChapters.length === 0) return null;

  return {
    metaTitle: opfTitle,
    metaAuthor: opfCreator,
    description: cleanDescription(opfDesc, finalChapters),
    chapters: finalChapters.map((c) => ({
      title: c.title,
      content: c.paragraphs.join("\n\n"),
      images: [],
      isIllustration: false
    })),
    coverBuf
  };
}

// ============================================================================
//  PDB (.MOBI / .AZW3 / .PRC) EXTRACTOR
// ============================================================================
function decompressPalmDOC(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const c = buf[i++];
    if (c === 0) out.push(0);
    else if (c >= 1 && c <= 8) {
      for (let j = 0; j < c && i < buf.length; j++) out.push(buf[i++]);
    } else if (c >= 9 && c <= 0x7f) out.push(c);
    else if (c >= 0x80 && c <= 0xbf) {
      if (i >= buf.length) break;
      const next = buf[i++];
      const pair = (c << 8) | next;
      const dist = (pair >> 3) & 0x07ff;
      const len = (pair & 0x07) + 3;
      const start = out.length - dist;
      for (let j = 0; j < len; j++) out.push(start + j >= 0 ? out[start + j] : 32);
    } else out.push(32, c ^ 0x80);
  }
  return Buffer.from(out);
}

function createHuffDecoder(buf, offsets, rec0) {
  const huffRecIndex = rec0.readUInt32BE(0x70);
  const huffRecCount = rec0.readUInt32BE(0x74);
  const huffBuf = buf.slice(offsets[huffRecIndex], offsets[huffRecIndex + 1]);
  const off1 = huffBuf.readUInt32BE(8);
  const off2 = huffBuf.readUInt32BE(12);
  const dict1 = [];
  for (let i = 0; i < 256; i++) {
    const v = huffBuf.readUInt32BE(off1 + i * 4);
    const codelen = v & 0x1f;
    const term = Boolean(v & 0x80);
    let maxcode = v >>> 8;
    if (codelen === 0) dict1.push({ codelen: 0, term: false, maxcode: 0 });
    else {
      maxcode = ((maxcode + 1) << (32 - codelen)) - 1;
      dict1.push({ codelen, term, maxcode: maxcode >>> 0 });
    }
  }
  const mincodes = [0];
  const maxcodes = [0];
  for (let codelen = 1; codelen <= 32; codelen++) {
    const min = huffBuf.readUInt32BE(off2 + (codelen - 1) * 8);
    const max = huffBuf.readUInt32BE(off2 + (codelen - 1) * 8 + 4);
    mincodes.push((min << (32 - codelen)) >>> 0);
    maxcodes.push((((max + 1) << (32 - codelen)) - 1) >>> 0);
  }
  const dictionary = [];
  for (let r = 1; r < huffRecCount; r++) {
    const cdic = buf.slice(offsets[huffRecIndex + r], offsets[huffRecIndex + r + 1]);
    const phrases = cdic.readUInt32BE(8);
    const bits = cdic.readUInt32BE(12);
    const n = Math.min(1 << bits, phrases - dictionary.length);
    for (let i = 0; i < n; i++) {
      const off = cdic.readUInt16BE(16 + i * 2);
      const blen = cdic.readUInt16BE(16 + off);
      const flag = Boolean(blen & 0x8000);
      const slice = cdic.slice(18 + off, 18 + off + (blen & 0x7fff));
      dictionary.push({ slice, flag });
    }
  }
  function unpack(data, depth = 0) {
    if (depth > 32) throw new Error("Max recursion in HUFF unpack");
    const out = [];
    let bitsLeft = data.length * 8;
    const padded = Buffer.concat([data, Buffer.alloc(8)]);
    let pos = 0;
    while (bitsLeft > 0) {
      const bytePos = pos >>> 3;
      const bitOff = pos & 7;
      const b0 = padded.readUInt32BE(bytePos);
      const b1 = padded.readUInt8(bytePos + 4);
      const code = (((b0 << bitOff) | (b1 >>> (8 - bitOff))) >>> 0);
      let { codelen, term, maxcode } = dict1[code >>> 24];
      if (!term) {
        while (code < mincodes[codelen]) codelen += 1;
        maxcode = maxcodes[codelen];
      }
      pos += codelen;
      bitsLeft -= codelen;
      if (bitsLeft < 0) break;
      const r = ((maxcode - code) >>> (32 - codelen)) >>> 0;
      const entry = dictionary[r];
      if (!entry) break;
      if (!entry.flag) {
        dictionary[r].slice = unpack(entry.slice, depth + 1);
        dictionary[r].flag = true;
      }
      out.push(dictionary[r].slice);
    }
    return Buffer.concat(out);
  }
  return unpack;
}

async function extractPdb(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 100) return null;
  const numRecords = buf.readUInt16BE(76);
  if (numRecords <= 1 || 78 + numRecords * 8 > buf.length) return null;

  const offsets = [];
  for (let r = 0; r < numRecords; r++) offsets.push(buf.readUInt32BE(78 + r * 8));
  offsets.push(buf.length);

  const rec0 = buf.slice(offsets[0], offsets[1]);
  if (rec0.length < 0x78) return null;
  const compression = rec0.readUInt16BE(0);
  const textRecCount = rec0.readUInt16BE(8);
  const encryptionType = rec0.readUInt16BE(12);
  if (encryptionType !== 0) return null; // Skip DRM-locked files

  const mobiHeaderLen = rec0.readUInt32BE(0x14);
  const encoding = rec0.readUInt32BE(0x1c);
  const firstImageIndex = rec0.readUInt32BE(0x6c);
  const exthFlags = rec0.length >= 0x84 ? rec0.readUInt32BE(0x80) : 0;
  const extraFlags = mobiHeaderLen >= 0xe4 && rec0.length >= 0xf4 ? rec0.readUInt16BE(0xf2) : 0;

  let coverOffset = null;
  let exthTitle = "";
  let exthAuthor = "";
  let exthDesc = "";
  if (exthFlags & 0x40) {
    const exthStart = 16 + mobiHeaderLen;
    if (exthStart + 12 <= rec0.length && rec0.toString("ascii", exthStart, exthStart + 4) === "EXTH") {
      const exthCount = rec0.readUInt32BE(exthStart + 8);
      let pos = exthStart + 12;
      for (let i = 0; i < exthCount && pos + 8 <= rec0.length; i++) {
        const type = rec0.readUInt32BE(pos);
        const len = rec0.readUInt32BE(pos + 4);
        if (len < 8 || pos + len > rec0.length) break;
        if (type === 201 && len >= 12) coverOffset = rec0.readUInt32BE(pos + 8);
        else if (type === 100 && !exthAuthor) exthAuthor = rec0.slice(pos + 8, pos + len).toString("utf8").trim();
        else if (type === 103 && !exthDesc) exthDesc = rec0.slice(pos + 8, pos + len).toString("utf8").trim();
        else if (type === 503 && !exthTitle) exthTitle = rec0.slice(pos + 8, pos + len).toString("utf8").trim();
        pos += len;
      }
    }
  }

  // Extract cover first so we can fast-check if the book has a valid embedded cover
  let coverBuf = null;
  if (firstImageIndex > 0 && firstImageIndex < numRecords) {
    const tryIndices = [];
    if (coverOffset !== null && firstImageIndex + coverOffset < numRecords) {
      tryIndices.push(firstImageIndex + coverOffset);
    }
    for (let r = firstImageIndex; r < Math.min(numRecords, firstImageIndex + 10); r++) {
      if (!tryIndices.includes(r)) tryIndices.push(r);
    }
    for (const rIdx of tryIndices) {
      const recBuf = buf.slice(offsets[rIdx], offsets[rIdx + 1]);
      const valid = await validateCoverBuffer(recBuf);
      if (valid) {
        coverBuf = valid;
        break;
      }
    }
  }

  const huffUnpack = compression === 17480 ? createHuffDecoder(buf, offsets, rec0) : null;
  const maxRec = Math.min(textRecCount, numRecords - 1);
  const chunks = [];

  for (let r = 1; r <= maxRec; r++) {
    let slice = buf.slice(offsets[r], offsets[r + 1]);
    if (extraFlags) {
      for (let b = 15; b >= 1; b--) {
        if (extraFlags & (1 << b)) {
          let size = 0;
          let shift = 0;
          let pos = slice.length - 1;
          while (pos >= 0) {
            const byte = slice[pos--];
            size |= (byte & 0x7f) << shift;
            shift += 7;
            if (byte & 0x80) break;
          }
          if (size > 0 && size <= slice.length) slice = slice.slice(0, slice.length - size);
        }
      }
      if (extraFlags & 1 && slice.length > 0) {
        const mb = (slice[slice.length - 1] & 3) + 1;
        if (mb <= slice.length) slice = slice.slice(0, slice.length - mb);
      }
    }
    if (compression === 2) chunks.push(decompressPalmDOC(slice));
    else if (compression === 17480 && huffUnpack) chunks.push(huffUnpack(slice));
    else if (compression === 1) chunks.push(slice);
  }

  if (chunks.length === 0) return null;
  let rawBytes = Buffer.concat(chunks);

  if (mobiHeaderLen >= 0xe4 && rec0.length >= 0xc8) {
    const fdstRec = rec0.readUInt32BE(0xc0);
    const fdstCnt = rec0.readUInt32BE(0xc4);
    if (fdstRec > 0 && fdstRec < numRecords && fdstCnt > 1) {
      const fdstBuf = buf.slice(offsets[fdstRec], offsets[fdstRec + 1]);
      if (fdstBuf.length >= 20 && fdstBuf.toString("ascii", 0, 4) === "FDST") {
        const flow0End = fdstBuf.readUInt32BE(16);
        if (flow0End > 0 && flow0End <= rawBytes.length) {
          rawBytes = rawBytes.slice(0, flow0End);
        }
      }
    }
  }

  let html = rawBytes.toString("utf8");
  if (encoding === 1252 && html.includes("\uFFFD")) {
    html = new TextDecoder("windows-1252").decode(rawBytes);
  }

  const sections = html.split(/<\?xml\b[^>]*\?>|<mbp:pagebreak\s*\/?>/i).filter((s) => s.trim().length > 0);
  const rawChapters = [];

  for (const sec of sections) {
    const paragraphs = extractBlocksFromHtml(sec);
    if (paragraphs.length === 0) continue;
    const firstLine = paragraphs[0] || "";
    const joined = paragraphs.join(" ");
    if (/^(?:Table of Contents|Mục\s*Lục)$/i.test(firstLine) && paragraphs.length < 80) continue;
    if (rawChapters.length === 0 && joined.length < 180) continue;

    if (sections.length <= 4 && joined.length > 25000) {
      const subChaps = splitParagraphsIntoChapters(paragraphs);
      if (subChaps.length >= 2) {
        rawChapters.push(...subChaps);
        continue;
      }
    }

    const hMatch = sec.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i);
    const hText = hMatch ? decodeHtmlEntities(hMatch[1].replace(/<[^>]+>/g, " ")).normalize("NFC").replace(/\s+/g, " ").trim() : "";
    const chTitle = hText && hText.length <= 110 ? hText : firstLine && firstLine.length <= 95 ? firstLine : `Chương ${rawChapters.length + 1}`;
    rawChapters.push({ title: chTitle, paragraphs });
  }

  let finalChapters = rawChapters;
  if (finalChapters.length === 1 && finalChapters[0].paragraphs.length > 80) {
    finalChapters = splitParagraphsIntoChapters(finalChapters[0].paragraphs);
  }

  const totalChars = finalChapters.reduce((s, c) => s + c.paragraphs.join(" ").length, 0);
  if (totalChars < 3000 || finalChapters.length === 0) return null;

  return {
    metaTitle: exthTitle,
    metaAuthor: exthAuthor,
    description: cleanDescription(exthDesc, finalChapters),
    chapters: finalChapters.map((c) => ({
      title: c.title,
      content: c.paragraphs.join("\n\n"),
      images: [],
      isIllustration: false
    })),
    coverBuf
  };
}

async function main() {
  // 1. Clean up redundant illu_01.webp in existing hlc-completed & hlc-multivol so public/img stays lean
  const existingSeries = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8")).filter(
    (s) => !String(s.section || "").startsWith("b1k-")
  );
  let cleanedDupImgs = 0;
  for (const s of existingSeries) {
    if (s.section === "hlc-completed" || s.section === "hlc-multivol") {
      const dupReaderImg = path.join(PUBLIC_IMG_ROOT, s.slug, "Tập_01", "illu_01.webp");
      const keepCoverImg = path.join(PUBLIC_IMG_ROOT, s.slug, "Tập_01", "illu_01.cover.webp");
      if (fs.existsSync(dupReaderImg) && fs.existsSync(keepCoverImg)) {
        fs.rmSync(dupReaderImg, { force: true });
        cleanedDupImgs++;
      }
    }
  }
  if (cleanedDupImgs > 0) {
    console.log(`🧹 Cleaned ${cleanedDupImgs} redundant full-size cover duplicates from hlc-completed/hlc-multivol.`);
  }

  const usedSlugs = new Set(existingSeries.map((s) => s.slug));
  const usedTitleKeys = new Set(existingSeries.map((s) => normalizeMatchKey(s.titleVi)));

  // 2. Load catalog-10k.json and rank candidates
  const catalog10k = JSON.parse(fs.readFileSync(CATALOG_10K_PATH, "utf8"));
  const candidates = catalog10k
    .filter((item) => {
      if (item.ext === ".pdf") return false; // Prefer clean reflowable ebooks (.epub, .azw3, .mobi, .prc)
      const folderStr = (item.folderPath || []).join(" ");
      if (/Tiếng Anh|TIENG ANH|English/i.test(folderStr)) return false;
      const diskPath = path.join(SACH10K_ROOT, item.category, item.name);
      if (!fs.existsSync(diskPath)) return false;
      item.diskPath = diskPath;
      item.subSection = mapCategoryToSubSection(item.category);
      const isFamous = FAMOUS_KEYWORDS.test(item.name) || FAMOUS_KEYWORDS.test(folderStr);
      const hasVietName = hasVietnameseDiacritics(item.name);
      item.rankScore =
        (item.score || 50) +
        (isFamous ? 120 : 0) +
        (hasVietName ? 45 : 0) +
        (item.ext === ".epub" ? 30 : item.ext === ".azw3" ? 20 : 0);
      return true;
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  console.log(`📚 Scanning ${candidates.length} candidate ebooks from ${SACH10K_ROOT} to select ${TARGET_TOTAL} best books...`);

  const sectionCounts = {
    "b1k-lit": 0,
    "b1k-mystery": 0,
    "b1k-knowledge": 0,
    "b1k-life": 0
  };
  const importedSeries = [];

  for (let i = 0; i < candidates.length; i++) {
    if (importedSeries.length >= TARGET_TOTAL) break;
    const item = candidates[i];
    const subSec = item.subSection;

    // Enforce balanced quotas first; if near the end of candidates, allow overflow
    if (sectionCounts[subSec] >= SECTION_QUOTAS[subSec] && candidates.length - i > 600) {
      continue;
    }

    const fallback = parseFilenameTitleAuthor(item.name);
    let extracted = null;
    try {
      if (item.ext === ".epub") {
        extracted = await extractEpub(item.diskPath);
      } else {
        extracted = await extractPdb(item.diskPath);
      }
    } catch (_) {
      extracted = null;
    }

    if (!extracted || !extracted.coverBuf) continue;

    // Choose best title & author (prefer one with Vietnamese diacritics)
    let titleVi = fallback.title;
    if (
      extracted.metaTitle &&
      extracted.metaTitle.length >= 2 &&
      extracted.metaTitle.length <= 140 &&
      !/^(?:unknown|untitled|index|ebook)$/i.test(extracted.metaTitle)
    ) {
      if (hasVietnameseDiacritics(extracted.metaTitle) || !hasVietnameseDiacritics(titleVi)) {
        titleVi = toTitleCaseIfAllCaps(extracted.metaTitle);
      }
    }

    let author = fallback.author;
    if (
      extracted.metaAuthor &&
      extracted.metaAuthor.length >= 2 &&
      extracted.metaAuthor.length <= 90 &&
      !/^(?:unknown|calibre|admin|vctvegroup|dtv-ebook)$/i.test(extracted.metaAuthor)
    ) {
      if (hasVietnameseDiacritics(extracted.metaAuthor) || !author || !hasVietnameseDiacritics(author)) {
        author = toTitleCaseIfAllCaps(extracted.metaAuthor);
      }
    }
    if (!author) author = "Khuyết danh";

    // Must have Vietnamese diacritics in either title, author, or description so no raw unaccented/English titles slip in
    if (!hasVietnameseDiacritics(titleVi) && !hasVietnameseDiacritics(extracted.description)) {
      continue;
    }

    const titleKey = normalizeMatchKey(titleVi);
    if (!titleKey || titleKey.length < 3 || usedTitleKeys.has(titleKey)) continue;
    usedTitleKeys.add(titleKey);

    let baseSlug = "b1k-" + (slugify(titleVi) || slugify(item.name) || "book");
    let slug = baseSlug;
    let counter = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }
    usedSlugs.add(slug);

    const volName = "Tập 01";
    const volDirName = sanitizeName(volName);
    const optImgDir = path.join(PUBLIC_IMG_ROOT, slug, volDirName);
    ensureDir(optImgDir);

    // Save cover only (illu_01.cover.webp) to keep file count minimal
    try {
      await sharp(extracted.coverBuf)
        .resize({ width: COVER_WIDTH, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(path.join(optImgDir, "illu_01.cover.webp"));
    } catch (_) {
      continue;
    }

    const outSeriesDir = path.join(OUTPUT_ROOT, slug);
    ensureDir(outSeriesDir);
    const metadataJson = [
      {
        volumeName: volName,
        chapters: extracted.chapters
      }
    ];
    fs.writeFileSync(path.join(outSeriesDir, "metadata.json"), JSON.stringify(metadataJson), "utf8");

    const tags = [...(CATEGORY_TAGS[item.category] || ["Sách chọn lọc"])];
    importedSeries.push({
      slug,
      source: `output/${slug}`,
      section: subSec,
      collection: SECTION_LABELS[subSec],
      titleVi,
      titleJp: "",
      author,
      illustrator: "",
      status: "Đã hoàn thành",
      description: extracted.description || `${titleVi} — Tác giả: ${author}.`,
      tags
    });

    sectionCounts[subSec]++;
    if (importedSeries.length % 50 === 0 || importedSeries.length === TARGET_TOTAL) {
      console.log(
        `  [${importedSeries.length}/${TARGET_TOTAL}] Added "${titleVi}" (${author}) -> ${subSec}`,
        sectionCounts
      );
    }
  }

  const finalSeries = [...existingSeries, ...importedSeries];
  fs.writeFileSync(SERIES_JSON_PATH, JSON.stringify(finalSeries, null, 2), "utf8");
  console.log(`\n🎉 Successfully imported ${importedSeries.length} famous books into series.json (Total: ${finalSeries.length} series)!`);
  console.log("📊 Sub-section breakdown:", sectionCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
