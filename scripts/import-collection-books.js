const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const SOURCE_DIR = "C:\\Users\\Hikari\\Downloads\\Compressed\\collection";
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

function slugify(str) {
  return str
    .normalize("NFC")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function toTitleCaseIfAllCaps(title) {
  const clean = title.normalize("NFC").replace(/\s+/g, " ").trim();
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

async function saveWebpImage(buf, destPath) {
  if (fs.existsSync(destPath)) return true;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height || meta.width < 60 || meta.height < 60) return false;
    await sharp(buf)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(destPath);
    return true;
  } catch {
    return false;
  }
}

const ONLINE_COVER_OVERRIDES = {
  "Người Tình Sputnik": "https://salt.tikicdn.com/ts/product/33/31/a3/a23e5b45e581abce5d6cabdf6728cf4e.jpg",
  "Không Gia Đình": "https://salt.tikicdn.com/ts/product/89/f3/95/5b82db26df0fc84873a5466241588ed6.jpg",
  "Bốn Cô Con Gái Nhà Bác Sĩ March (Little Women)": "https://salt.tikicdn.com/ts/product/f8/60/71/ccb1bb2fe2830a009ad99325efcd785d.jpg"
};

async function fetchOnlineCoverWebp(title, author, destPath) {
  if (fs.existsSync(destPath)) return true;
  let coverUrl = ONLINE_COVER_OVERRIDES[title] || null;
  if (!coverUrl) {
    const query = `${title} ${author || ""}`.trim();
    const res = await fetch(`https://tiki.vn/api/v2/products?limit=5&q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    if (res.ok) {
      const json = await res.json();
      const first = (json.data || []).find((item) => item?.thumbnail_url);
      if (first) coverUrl = first.thumbnail_url.replace(/\/cache\/[^/]+\//, "/");
    }
  }
  if (!coverUrl) throw new Error(`Could not find online cover for: ${title}`);
  const imgRes = await fetch(coverUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} fetching cover ${coverUrl}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  await sharp(buf).trim({ threshold: 12 }).webp({ quality: 88 }).toFile(destPath);
  return true;
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

function cleanDescription(rawDesc, rawChapters = []) {
  let d = decodeHtmlEntities(decodeHtmlEntities(rawDesc || ""));
  d = d.replace(/<ul\b[\s\S]*?<\/ul>/gi, "\n");
  d = d.replace(/<hr\b[^>]*\/?>/gi, "\n");
  d = d.replace(/<\/?(?:p|div|li|br|blockquote|section)\b[^>]*>/gi, "\n");
  d = decodeHtmlEntities(d.replace(/<[^>]+>/g, " "));

  const lines = d
    .normalize("NFC")
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/(?:ra\s*epub|ra\s*text|soát\s*text|sửa\s*chính\s*tả|vctvegroup|hotaru-team|dtv-ebook|Chụp\/Scan|Text\s*(?:và|&|,)\s*epub|Nguồn\s*(?:ebook|eBook|pdf)|^Epub\s*:)/i.test(
          l
        )
    );

  let cleaned = lines.join(" ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 50 && rawChapters.length > 0) {
    for (const ch of rawChapters) {
      const paras = (ch.paragraphs || [])
        .filter(
          (p) =>
            p.length > 45 &&
            !p.startsWith("[Chú thích:") &&
            !/(?:Người dịch|Phát hành|Tác giả|Bản quyền|dtv-ebook|Nhà xuất bản)/i.test(p)
        );
      const candidate = paras.slice(0, 2).join(" ");
      if (candidate.length >= 60) {
        cleaned = candidate.length > 360 ? `${candidate.slice(0, 357).replace(/\s+\S*$/, "")}…` : candidate;
        break;
      }
    }
  }
  return cleaned;
}

function extractBlocksFromHtml(html, basePath = "") {
  let body = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const imgSrcs = [];
  for (const m of body.matchAll(/<(?:img|image)\b[^>]*?\b(?:src|xlink:href|href)=["']([^"']+)["'][^>]*>/gi)) {
    const rawHref = m[1];
    if (/^kindle:flow:/i.test(rawHref)) continue;
    if (/^kindle:embed:/i.test(rawHref)) continue;
    const resolved = basePath ? resolveHref(basePath, decodeURIComponent(rawHref)) : rawHref;
    if (resolved && !imgSrcs.includes(resolved)) imgSrcs.push(resolved);
  }

  const mobiRecIndices = [];
  for (const m of body.matchAll(/<img\b[^>]*?\brecindex=["']?(\d+)["']?[^>]*>/gi)) {
    const idx = Number(m[1]);
    if (Number.isFinite(idx) && idx > 0 && !mobiRecIndices.includes(idx)) mobiRecIndices.push(idx);
  }
  for (const m of body.matchAll(/<(?:img|image)\b[^>]*?\b(?:src|xlink:href)=["']kindle:embed:([0-9a-f]+)(?:\?[^"']*)?["'][^>]*>/gi)) {
    const idx = parseInt(m[1], 16);
    if (Number.isFinite(idx) && idx > 0 && !mobiRecIndices.includes(idx)) mobiRecIndices.push(idx);
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

  return { paragraphs, imgSrcs, mobiRecIndices };
}

// ============================================================================
//  EPUB PARSER
// ============================================================================
async function parseEpubVolume(buf, volumeName, seriesOutputDir, fallbackTitle = "", fallbackAuthor = "") {
  const zip = await JSZip.loadAsync(buf);
  const containerXml = await zip.file("META-INF/container.xml").async("string");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)[1];
  const opfXml = await zip.file(opfPath).async("string");

  const opfTitle = decodeHtmlEntities(
    (opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim()
  ).normalize("NFC");
  const opfCreator = decodeHtmlEntities(
    (opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim()
  ).normalize("NFC");
  const opfDescRaw = (opfXml.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i)?.[1] || "").trim();

  const manifest = new Map();
  let ncxPath = null;
  let navPath = null;
  let coverId = opfXml.match(/<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i)?.[1]
    || opfXml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']cover["']/i)?.[1]
    || null;

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
      if (props.includes("cover-image") && !coverId) coverId = id;
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

  const savedIlluPaths = new Set();
  const illuFiles = [];

  async function addIlluFromZipPath(zipImgPath) {
    if (!zipImgPath || savedIlluPaths.has(zipImgPath)) return;
    const entry = zip.file(zipImgPath);
    if (!entry) return;
    const bufImg = await entry.async("nodebuffer");
    const fileName = `illu_${String(illuFiles.length + 1).padStart(2, "0")}.webp`;
    const ok = await saveWebpImage(bufImg, path.join(imgDir, fileName));
    if (ok) {
      savedIlluPaths.add(zipImgPath);
      illuFiles.push(fileName);
    }
  }

  if (coverId && manifest.get(coverId)?.type.startsWith("image/")) {
    await addIlluFromZipPath(manifest.get(coverId).path);
  }
  if (illuFiles.length === 0) {
    const coverImgEntry = [...manifest.values()].find(
      (it) => it.type.startsWith("image/") && /cover/i.test(path.posix.basename(it.path))
    );
    if (coverImgEntry) await addIlluFromZipPath(coverImgEntry.path);
  }

  const rawChapters = [];
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    const fileEntry = zip.file(item.path);
    if (!fileEntry) continue;
    const baseName = path.posix.basename(item.path).toLowerCase();
    const tocLabel = tocMap.get(item.path) || "";
    if (item.path === navPath || /^(?:nav|toc|mucluc)\d*\.x?html?$/i.test(baseName) || /^mục\s*lục$/i.test(tocLabel)) {
      continue;
    }

    const html = await fileEntry.async("string");
    const { paragraphs, imgSrcs } = extractBlocksFromHtml(html, item.path);
    const joinedText = paragraphs.join(" ").trim();

    if (/^minh\s*họa$/i.test(tocLabel) || ((paragraphs.length === 0 || joinedText.length <= 20 || /^cover$/i.test(joinedText)) && imgSrcs.length > 0)) {
      for (const src of imgSrcs) await addIlluFromZipPath(src);
      continue;
    }

    if (/^(?:credit|jacket|titlepage|copyright)\d*\.x?html?$/i.test(baseName) && !tocLabel && joinedText.length < 600) {
      for (const src of imgSrcs) await addIlluFromZipPath(src);
      continue;
    }

    if (paragraphs.length === 0 && imgSrcs.length === 0) continue;

    let chTitle = tocLabel;
    if (!chTitle) {
      const hMatch = html.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i);
      const hText = hMatch ? decodeHtmlEntities(hMatch[1].replace(/<[^>]+>/g, " ")).normalize("NFC").replace(/\s+/g, " ").trim() : "";
      chTitle = hText && hText.length <= 120 ? hText : paragraphs[0] && paragraphs[0].length <= 90 ? paragraphs[0] : `Phần ${rawChapters.length + 1}`;
    }

    const cleanedParagraphs = stripDuplicateTitleParagraphs(chTitle, paragraphs);
    if (cleanedParagraphs.length === 0 && imgSrcs.length > 0) {
      for (const src of imgSrcs) await addIlluFromZipPath(src);
      continue;
    }

    rawChapters.push({
      title: chTitle,
      paragraphs: cleanedParagraphs.length > 0 ? cleanedParagraphs : paragraphs,
      imgSrcs
    });
  }

  if (illuFiles.length === 0) {
    const anyImg = Object.keys(zip.files)
      .filter((k) => !zip.files[k].dir && /\.(jpe?g|png|webp|gif)$/i.test(k))
      .sort()[0];
    if (anyImg) await addIlluFromZipPath(anyImg);
  }
  if (illuFiles.length === 0) {
    const fileName = "illu_01.webp";
    await fetchOnlineCoverWebp(fallbackTitle || opfTitle, fallbackAuthor || opfCreator, path.join(imgDir, fileName));
    illuFiles.push(fileName);
  }

  const finalChapters = [
    {
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    }
  ];

  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i];
    const chIdx = finalChapters.length + 1;
    const prefix = `ch${String(chIdx).padStart(2, "0")}`;
    const chImgFiles = [];
    for (const src of ch.imgSrcs) {
      if (savedIlluPaths.has(src)) continue;
      const entry = zip.file(src);
      if (!entry) continue;
      const bufImg = await entry.async("nodebuffer");
      const fileName = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
      const ok = await saveWebpImage(bufImg, path.join(imgDir, fileName));
      if (ok) chImgFiles.push(fileName);
    }

    finalChapters.push({
      title: ch.title,
      content: ch.paragraphs.join("\n\n"),
      isIllustration: false,
      ...(chImgFiles.length > 0 ? { images: chImgFiles } : {})
    });
  }

  return {
    title: fallbackTitle || toTitleCaseIfAllCaps(opfTitle),
    author: fallbackAuthor || opfCreator || "Khuyết danh",
    description: cleanDescription(opfDescRaw, rawChapters),
    volumeData: {
      volumeName,
      chapters: finalChapters
    }
  };
}

// ============================================================================
//  PDB (.AZW3 / .MOBI / .PRC) PARSER (PalmDOC + HUFF/CDIC + PC1 DRM)
// ============================================================================
function pc1(key16, src, decryption = true) {
  let sum1 = 0;
  let sum2 = 0;
  let keyXorVal = 0;
  const wkey = [];
  for (let i = 0; i < 8; i++) {
    wkey.push((key16[i * 2] << 8) | key16[i * 2 + 1]);
  }
  const dst = Buffer.alloc(src.length);
  for (let i = 0; i < src.length; i++) {
    let temp1 = 0;
    let byteXorVal = 0;
    for (let j = 0; j < 8; j++) {
      temp1 ^= wkey[j];
      sum2 = ((sum2 + j) * 20021 + sum1) & 0xffff;
      sum1 = (temp1 * 346) & 0xffff;
      sum2 = (sum2 + sum1) & 0xffff;
      temp1 = (temp1 * 20021 + 1) & 0xffff;
      byteXorVal ^= temp1 ^ sum2;
    }
    let curByte = src[i];
    if (!decryption) keyXorVal = (curByte * 257) & 0xffff;
    curByte = ((curByte ^ (byteXorVal >>> 8)) ^ byteXorVal) & 0xff;
    if (decryption) keyXorVal = (curByte * 257) & 0xffff;
    for (let j = 0; j < 8; j++) {
      wkey[j] = (wkey[j] ^ keyXorVal) & 0xffff;
    }
    dst[i] = curByte;
  }
  return dst;
}

function getMobiDrmKey(rec0) {
  const drmOffset = rec0.readUInt32BE(0xa8);
  const drmCount = rec0.readUInt32BE(0xac);
  const drmSize = rec0.readUInt32BE(0xb0);
  if (!drmCount || drmOffset === 0xffffffff) return null;
  const vec1 = Buffer.from("723833B0B4F2E3CADF0901D6E2E03F96", "hex");
  const drmBuf = rec0.slice(drmOffset, drmOffset + drmSize);
  for (let i = 0; i < drmCount; i++) {
    const entry = drmBuf.slice(i * 48, (i + 1) * 48);
    const dec32 = pc1(vec1, entry.slice(16, 48), true);
    if (dec32.readUInt32BE(0) === entry.readUInt32BE(0)) {
      return dec32.slice(8, 24);
    }
  }
  return null;
}

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

const CHAPTER_HEADING_RE = /^(?:Chương|Phần|Hồi|Quyển|Chapter|Màn|Tập|Book|Part)\s*(?:\d+|[IVXLCDM]+|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\b/i;

function splitParagraphsByHeadings(paragraphs) {
  const result = [];
  let current = null;
  for (const p of paragraphs) {
    if (p.length <= 95 && CHAPTER_HEADING_RE.test(p)) {
      if (current && current.paragraphs.length > 0) result.push(current);
      current = { title: p, paragraphs: [], mobiRecIndices: [] };
    } else {
      if (!current) current = { title: "Mở đầu", paragraphs: [], mobiRecIndices: [] };
      current.paragraphs.push(p);
    }
  }
  if (current && current.paragraphs.length > 0) result.push(current);
  return result;
}

async function parsePdbVolume(filePath, volumeName, seriesOutputDir, fallbackTitle = "", fallbackAuthor = "") {
  const buf = fs.readFileSync(filePath);
  const numRecords = buf.readUInt16BE(76);
  const offsets = [];
  for (let r = 0; r < numRecords; r++) offsets.push(buf.readUInt32BE(78 + r * 8));
  offsets.push(buf.length);

  const rec0 = buf.slice(offsets[0], offsets[1]);
  const compression = rec0.readUInt16BE(0);
  const textRecCount = rec0.readUInt16BE(8);
  const encryptionType = rec0.readUInt16BE(12);
  const mobiHeaderLen = rec0.readUInt32BE(0x14);
  const encoding = rec0.readUInt32BE(0x1c);
  const firstImageIndex = rec0.readUInt32BE(0x6c);
  const exthFlags = rec0.readUInt32BE(0x80);
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

  const drmKey = encryptionType === 2 ? getMobiDrmKey(rec0) : null;
  const huffUnpack = compression === 17480 ? createHuffDecoder(buf, offsets, rec0) : null;

  const chunks = [];
  for (let r = 1; r <= textRecCount; r++) {
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
      if (extraFlags & 1) {
        const mb = (slice[slice.length - 1] & 3) + 1;
        if (mb <= slice.length) slice = slice.slice(0, slice.length - mb);
      }
    }
    if (drmKey) slice = pc1(drmKey, slice, true);
    if (compression === 2) chunks.push(decompressPalmDOC(slice));
    else if (compression === 17480) chunks.push(huffUnpack(slice));
    else chunks.push(slice);
  }

  let rawBytes = Buffer.concat(chunks);

  // Check if KF8 FDST record exists to trim trailing CSS/SVG flows
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

  // Split HTML into sections by <?xml ...?> or <mbp:pagebreak>
  let sections = html.split(/<\?xml\b[^>]*\?>|<mbp:pagebreak\s*\/?>/i).filter((s) => s.trim().length > 0);

  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);

  const seenHashes = new Set();
  const illuFiles = [];

  async function addIlluRecord(recIdx) {
    if (recIdx <= 0 || recIdx >= numRecords) return false;
    const recBuf = buf.slice(offsets[recIdx], offsets[recIdx + 1]);
    if (!recBuf || recBuf.length < 400) return false;
    const sha = crypto.createHash("sha1").update(recBuf).digest("hex");
    if (seenHashes.has(sha)) return true;
    const fileName = `illu_${String(illuFiles.length + 1).padStart(2, "0")}.webp`;
    const ok = await saveWebpImage(recBuf, path.join(imgDir, fileName));
    if (ok) {
      seenHashes.add(sha);
      illuFiles.push(fileName);
      return true;
    }
    return false;
  }

  if (coverOffset !== null && firstImageIndex > 0 && firstImageIndex < numRecords) {
    await addIlluRecord(firstImageIndex + coverOffset);
  }
  if (illuFiles.length === 0 && firstImageIndex > 0 && firstImageIndex < numRecords) {
    for (let r = firstImageIndex; r < Math.min(numRecords, firstImageIndex + 15); r++) {
      if (await addIlluRecord(r)) break;
    }
  }

  const rawChapters = [];
  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const { paragraphs, mobiRecIndices } = extractBlocksFromHtml(sec);
    if (paragraphs.length === 0 && mobiRecIndices.length === 0) continue;

    const firstLine = paragraphs[0] || "";
    const joined = paragraphs.join(" ");

    if (/^(?:Table of Contents|Mục\s*Lục)$/i.test(firstLine) && paragraphs.length < 80) continue;
    if (/^Minh\s*họa$/i.test(firstLine) || (paragraphs.length <= 2 && mobiRecIndices.length > 0 && joined.length < 60)) {
      for (const rIdx of mobiRecIndices) await addIlluRecord(firstImageIndex + rIdx - 1);
      continue;
    }

    // If a single section is very long and has multiple chapter headings inside, split it
    if (sections.length <= 4 && joined.length > 25000) {
      const subChaps = splitParagraphsByHeadings(paragraphs);
      if (subChaps.length >= 3) {
        for (const sub of subChaps) rawChapters.push(sub);
        continue;
      }
    }

    const hMatch = sec.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const hText = hMatch ? decodeHtmlEntities(hMatch[1].replace(/<[^>]+>/g, " ")).normalize("NFC").replace(/\s+/g, " ").trim() : "";
    let chTitle = hText && hText.length <= 110 ? hText : firstLine && firstLine.length <= 100 ? firstLine : `Phần ${rawChapters.length + 1}`;

    const bodyParagraphs = stripDuplicateTitleParagraphs(chTitle, paragraphs);
    if (bodyParagraphs.length === 0 && mobiRecIndices.length === 0) continue;

    rawChapters.push({
      title: chTitle,
      paragraphs: bodyParagraphs.length > 0 ? bodyParagraphs : paragraphs,
      mobiRecIndices
    });
  }

  // Merge tiny 1-2 line frontmatter fragments into the next chapter or skip if pure title/author credit
  const filteredChapters = [];
  for (const ch of rawChapters) {
    const textLen = ch.paragraphs.join(" ").length;
    if (filteredChapters.length === 0 && textLen < 200 && ch.mobiRecIndices.length === 0) {
      continue;
    }
    filteredChapters.push(ch);
  }
  const effectiveChapters = filteredChapters.length > 0 ? filteredChapters : rawChapters;

  const cleanTitle = fallbackTitle || toTitleCaseIfAllCaps(exthTitle);
  const cleanAuth = fallbackAuthor || exthAuthor || "Khuyết danh";

  if (illuFiles.length === 0) {
    const fileName = "illu_01.webp";
    await fetchOnlineCoverWebp(cleanTitle, cleanAuth, path.join(imgDir, fileName));
    illuFiles.push(fileName);
  }

  const finalChapters = [
    {
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    }
  ];

  for (let i = 0; i < effectiveChapters.length; i++) {
    const ch = effectiveChapters[i];
    const chIdx = finalChapters.length + 1;
    const prefix = `ch${String(chIdx).padStart(2, "0")}`;
    const chImgFiles = [];
    for (const rIdx of ch.mobiRecIndices || []) {
      const absRec = firstImageIndex + rIdx - 1;
      if (absRec <= 0 || absRec >= numRecords) continue;
      const recBuf = buf.slice(offsets[absRec], offsets[absRec + 1]);
      if (!recBuf || recBuf.length < 400) continue;
      const sha = crypto.createHash("sha1").update(recBuf).digest("hex");
      if (seenHashes.has(sha)) continue;
      const fileName = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
      const ok = await saveWebpImage(recBuf, path.join(imgDir, fileName));
      if (ok) {
        seenHashes.add(sha);
        chImgFiles.push(fileName);
      }
    }

    finalChapters.push({
      title: ch.title,
      content: ch.paragraphs.join("\n\n"),
      isIllustration: false,
      ...(chImgFiles.length > 0 ? { images: chImgFiles } : {})
    });
  }

  return {
    title: cleanTitle,
    author: cleanAuth,
    description: cleanDescription(exthDesc, effectiveChapters),
    volumeData: {
      volumeName,
      chapters: finalChapters
    }
  };
}

// ============================================================================
//  CURATED METADATA MAP FOR STANDALONE BOOKS IN COLLECTION
// ============================================================================
const STANDALONE_OVERRIDES = {
  "Bo Con Ca Gai - Cho Chang In.azw3": { title: "Bố Con Cá Gai", author: "Cho Chang In", tags: ["Cảm động", "Gia đình", "Văn học Hàn Quốc"] },
  "Ban Tay Cho Em - Ichikawa Takuji.azw3": { title: "Bàn Tay Cho Em", author: "Ichikawa Takuji", tags: ["Romance", "Cảm động", "Văn học Nhật Bản"] },
  "Chuyện về cô gái ấy - Ichikawa Takuji & Mai Mai (dịch).azw3": { title: "Chuyện Về Cô Gái Ấy", author: "Ichikawa Takuji", tags: ["Romance", "Cảm động", "Văn học Nhật Bản"] },
  "Em se den cung con mua - Takuji Ichikawa.prc": { title: "Em Sẽ Đến Cùng Cơn Mưa", author: "Ichikawa Takuji", tags: ["Romance", "Cảm động", "Văn học Nhật Bản"] },
  "Neu gap nguoi ay, cho toi gui l - Ichikama Takuji.prc": { title: "Nếu Gặp Người Ấy, Cho Tôi Gửi Lời Chào", author: "Ichikawa Takuji", tags: ["Romance", "Cảm động", "Văn học Nhật Bản"] },
  "Noi Em Quay Ve Co Toi Dung Doi - Ichikawa Takuji.azw3": { title: "Nơi Em Quay Về Có Tôi Đứng Đợi", author: "Ichikawa Takuji", tags: ["Romance", "Cảm động", "Văn học Nhật Bản"] },
  "Tam Anh Tinh Yeu Va Mot Cau Chuyen Khac - Ichikawa Takuji.azw3": { title: "Tấm Ảnh Tình Yêu Và Một Câu Chuyện Khác", author: "Ichikawa Takuji", tags: ["Romance", "Cảm động", "Văn học Nhật Bản"] },
  "Thế Giới Kết Thúc Dịu Dàng Đến Thế - Ichikawa Takuji & Trần Hà Thương (dịch).azw3": { title: "Thế Giới Kết Thúc Dịu Dàng Đến Thế", author: "Ichikawa Takuji", tags: ["Romance", "Cảm động", "Văn học Nhật Bản"] },
  "Toi Van Nghe Tieng Em Tham Goi - Ichikawa Takuji.azw3": { title: "Tôi Vẫn Nghe Tiếng Em Thầm Gọi", author: "Ichikawa Takuji", tags: ["Romance", "Cảm động", "Văn học Nhật Bản"] },
  "Chien Binh Cau Vong - Andrea Hirata.prc": { title: "Chiến Binh Cầu Vồng", author: "Andrea Hirata", tags: ["Cảm động", "Đời thường", "Tiểu thuyết"] },
  "Chu be mang pyjama soc - John Boyne.prc": { title: "Chú Bé Mang Pyjama Sọc", author: "John Boyne", tags: ["Cảm động", "Lịch sử", "Tiểu thuyết"] },
  "Chuoc Toi - Minato Kanae.azw3": { title: "Chuộc Tội", author: "Minato Kanae", tags: ["Trinh thám", "Tâm lý", "Văn học Nhật Bản"] },
  "Cua Chuot va cua Nguoi - John Steinbeck.epub": { title: "Của Chuột Và Của Người", author: "John Steinbeck", tags: ["Kinh điển", "Cảm động", "Văn học phương Tây"] },
  "Cây Cam Ngọt Của Tôi - José Mauro de Vasconcelos & Nguyễn Bích Lan (dịch) & Tô Yến Ly (dịch).azw3": { title: "Cây Cam Ngọt Của Tôi", author: "José Mauro de Vasconcelos", tags: ["Cảm động", "Kinh điển", "Gia đình"] },
  "Hai Số Phận - Jeffrey Archer & Nguyễn Việt Hải (dịch).azw3": { title: "Hai Số Phận", author: "Jeffrey Archer", tags: ["Kinh điển", "Drama", "Văn học phương Tây"] },
  "Hay Cham Soc Me - Shin Kyung Sook.azw3": { title: "Hãy Chăm Sóc Mẹ", author: "Shin Kyung Sook", tags: ["Cảm động", "Gia đình", "Văn học Hàn Quốc"] },
  "Hoa Tren Mo Algernon - Daniel Keyes.azw3": { title: "Hoa Trên Mộ Algernon", author: "Daniel Keyes", tags: ["Cảm động", "Kinh điển", "Tâm lý"] },
  "Ke Trom Sach - Markus Zusak.azw3": { title: "Kẻ Trộm Sách", author: "Markus Zusak", tags: ["Cảm động", "Lịch sử", "Kinh điển"] },
  "Khi Hoi Tho Hoa Thinh Khong - Paul Kalanithi.azw3": { title: "Khi Hơi Thở Hóa Thinh Không", author: "Paul Kalanithi", tags: ["Hồi ký", "Cảm động", "Y khoa"] },
  "Khi Loi Thuoc Ve Nhung Vi Sao - John Green.azw3": { title: "Khi Lỗi Thuộc Về Những Vì Sao", author: "John Green", tags: ["Romance", "Cảm động", "Tiểu thuyết"] },
  "Khong Gia Dinh Hecto Malot.prc": { title: "Không Gia Đình", author: "Hector Malot", tags: ["Kinh điển", "Cảm động", "Phiêu lưu"] },
  "Little Women.prc": { title: "Bốn Cô Con Gái Nhà Bác Sĩ March (Little Women)", author: "Louisa May Alcott", tags: ["Kinh điển", "Gia đình", "Đời thường"] },
  "Mot lit nuoc mat - Kito Aya.azw3": { title: "Một Lít Nước Mắt", author: "Kito Aya", tags: ["Hồi ký", "Cảm động", "Văn học Nhật Bản"] },
  "Nana Du Ky - Arikawa Hiro.azw3": { title: "Nana Du Ký", author: "Hiro Arikawa", tags: ["Cảm động", "Chữa lành", "Văn học Nhật Bản"] },
  "Ngan Mat Troi Ruc Ro - Khaled Hosseini.azw3": { title: "Ngàn Mặt Trời Rực Rỡ", author: "Khaled Hosseini", tags: ["Cảm động", "Drama", "Tiểu thuyết"] },
  "Nguoi Dan Ong Mang Ten Ove - Fredrik Backman.azw3": { title: "Người Đàn Ông Mang Tên Ove", author: "Fredrik Backman", tags: ["Cảm động", "Chữa lành", "Đời thường"] },
  "Người đua diều - Khaled Hosseini.prc": { title: "Người Đua Diều", author: "Khaled Hosseini", tags: ["Cảm động", "Kinh điển", "Drama"] },
  "Nhung Ky Vong Lon Lao - Charles Dickens.azw3": { title: "Những Kỳ Vọng Lớn Lao", author: "Charles Dickens", tags: ["Kinh điển", "Văn học phương Tây"] },
  "Nhung Nguoi Khon Kho - Victor Hugo.azw3": { title: "Những Người Khốn Khổ", author: "Victor Hugo", tags: ["Kinh điển", "Lịch sử", "Văn học phương Tây"] },
  "Noi Dau Roi Se Qua Di - Laura Tims.azw3": { title: "Nỗi Đau Rồi Sẽ Qua Đi", author: "Laura Tims", tags: ["Cảm động", "Tâm lý", "Tiểu thuyết"] },
  "Rung Na-Uy - Haruki Murakami.prc": { title: "Rừng Na-Uy", author: "Haruki Murakami", tags: ["Romance", "Tâm lý", "Văn học Nhật Bản"] },
  "That Tich Khong Mua - Lau Vu Tinh.azw3": { title: "Thất Tịch Không Mưa", author: "Lâu Vũ Tình", tags: ["Romance", "Cảm động", "Ngôn tình"] },
  "To Muon An Tuy Cua Cau - Sumino Yoru.epub": { title: "Tớ Muốn Ăn Tụy Của Cậu", author: "Yoru Sumino", tags: ["Romance", "Cảm động", "Học đường", "Văn học Nhật Bản"] },
  "Totto-Chan - Ben Cua So - Tetsuko Kuroyanagi (1).azw3": { title: "Totto-Chan Bên Cửa Sổ", author: "Tetsuko Kuroyanagi", tags: ["Cảm động", "Đời thường", "Văn học Nhật Bản"] },
  "Truoc Ngay Em Den - Jojo Moyes.azw3": { title: "Trước Ngày Em Đến", author: "Jojo Moyes", tags: ["Romance", "Cảm động", "Tiểu thuyết"] },
  "Trà Hoa Nữ - Alexandre Dumas.azw3": { title: "Trà Hoa Nữ", author: "Alexandre Dumas con", tags: ["Kinh điển", "Romance", "Văn học phương Tây"] },
  "Tuổi thơ dữ dội - Phùng Quán Tập 1+2.azw3": { title: "Tuổi Thơ Dữ Dội", author: "Phùng Quán", tags: ["Kinh điển", "Lịch sử", "Văn học Việt Nam"] },
  "Vẽ em bằng màu nỗi nhớ - Tam Pham.azw3": { title: "Vẽ Em Bằng Màu Nỗi Nhớ", author: "Tâm Phạm", tags: ["Romance", "Cảm động", "Văn học Việt Nam"] },
  "Xa Ngoài Kia Nơi Loài Tôm Hát - Delia Owens & Trương Hoàng Uyên Phương (dịch).azw3": { title: "Xa Ngoài Kia Nơi Loài Tôm Hát", author: "Delia Owens", tags: ["Cảm động", "Bí ẩn", "Tiểu thuyết"] },
  "Đêm trường tăm tối - Tử Kim Trần.azw3": { title: "Đêm Trường Tăm Tối", author: "Tử Kim Trần", tags: ["Trinh thám", "Tâm lý", "Tiểu thuyết"] },
  "Đại gia Gatsby - F Scott Fitzgerald.prc": { title: "Đại Gia Gatsby", author: "F. Scott Fitzgerald", tags: ["Kinh điển", "Văn học phương Tây"] },
  "Bien nien ky chim van day cot - Haruki Murakami.prc": { title: "Biên Niên Ký Chim Vặn Dây Cót", author: "Haruki Murakami", tags: ["Kỳ ảo", "Tâm lý", "Văn học Nhật Bản"] },
  "Cuoc San Cuu Hoang - Haruki Murakami.prc": { title: "Cuộc Săn Cừu Hoang", author: "Haruki Murakami", tags: ["Kỳ ảo", "Bí ẩn", "Văn học Nhật Bản"] },
  "Giết Chỉ Huy Đội Kỵ Sĩ - Haruki Murakami & Mộc Miên (dịch).azw3": { title: "Giết Chỉ Huy Đội Kỵ Sĩ", author: "Haruki Murakami", tags: ["Kỳ ảo", "Bí ẩn", "Văn học Nhật Bản"] },
  "Kafka ben bo bien - Haruki Murakami.prc": { title: "Kafka Bên Bờ Biển", author: "Haruki Murakami", tags: ["Kỳ ảo", "Tâm lý", "Văn học Nhật Bản"] },
  "Lang nghe gio hat - Haruki Murakami.prc": { title: "Lắng Nghe Gió Hát", author: "Haruki Murakami", tags: ["Đời thường", "Văn học Nhật Bản"] },
  "Một Q Tám Tư - Haruki Murakami.azw3": { title: "1Q84", author: "Haruki Murakami", tags: ["Kỳ ảo", "Romance", "Bí ẩn", "Văn học Nhật Bản"] },
  "Ngam - Haruki Murakami.prc": { title: "Ngầm", author: "Haruki Murakami", tags: ["Tài liệu", "Tâm lý", "Văn học Nhật Bản"] },
  "Ngay Dep Troi De Xem Kangaroo - Haruki Murakami.azw3": { title: "Ngày Đẹp Trời Để Xem Kangaroo", author: "Haruki Murakami", tags: ["Truyện ngắn", "Đời thường", "Văn học Nhật Bản"] },
  "Nguoi tinh Sputnik - Haruki Murakami.prc": { title: "Người Tình Sputnik", author: "Haruki Murakami", tags: ["Romance", "Tâm lý", "Văn học Nhật Bản"] },
  "Nhay nhay nhay - Haruki Murakami.prc": { title: "Nhảy Nhảy Nhảy", author: "Haruki Murakami", tags: ["Kỳ ảo", "Bí ẩn", "Văn học Nhật Bản"] },
  "Phia Nam bien gioi, phia Tay ma - Haruki Murakami.prc": { title: "Phía Nam Biên Giới, Phía Tây Mặt Trời", author: "Haruki Murakami", tags: ["Romance", "Tâm lý", "Văn học Nhật Bản"] },
  "Sau Con Dong Dat - Haruki Murakami.azw3": { title: "Sau Cơn Động Đất", author: "Haruki Murakami", tags: ["Truyện ngắn", "Tâm lý", "Văn học Nhật Bản"] },
  "Toi noi gi khi noi ve chay bo - Murakami, Haruki.prc": { title: "Tôi Nói Gì Khi Nói Về Chạy Bộ", author: "Haruki Murakami", tags: ["Tản văn", "Đời thường", "Văn học Nhật Bản"] },
  "Xu so dieu ky tan bao va chon t - Haruki Murakami.prc": { title: "Xứ Sở Diệu Kỳ Tàn Bạo Và Chốn Tận Cùng Thế Giới", author: "Haruki Murakami", tags: ["Kỳ ảo", "Sci-Fi", "Văn học Nhật Bản"] },
  "Colorful - Mori Eto.azw3": { title: "Colorful", author: "Mori Eto", tags: ["Chữa lành", "Học đường", "Văn học Nhật Bản"] },
  "Cây Vĩ Cầm Ave Maria - Kagawa Yoshiko & Nguyễn Hồng Vân (dịch).azw3": { title: "Cây Vĩ Cầm Ave Maria", author: "Kagawa Yoshiko", tags: ["Cảm động", "Âm nhạc", "Văn học Nhật Bản"] },
  "Dieu Ky Dieu Cua Tiem Tap Hoa Namiya - Higashino Keigo (1).azw3": { title: "Điều Kỳ Diệu Của Tiệm Tạp Hóa Namiya", author: "Higashino Keigo", tags: ["Kỳ ảo", "Chữa lành", "Cảm động", "Văn học Nhật Bản"] },
  "Bên Kia Mây Trời Là Nơi Hẹn Ước - Kanoh Arata & Shinkai Makoto & HẢI HÀ (dịch).azw3": { title: "Bên Kia Mây Trời Là Nơi Hẹn Ước", author: "Shinkai Makoto, Kanoh Arata", tags: ["Romance", "Sci-Fi", "Light Novel"] },
  "Khu Vuon Ngon Tu - Shinkai Makoto.mobi": { title: "Khu Vườn Ngôn Từ", author: "Shinkai Makoto", tags: ["Romance", "Đời thường", "Light Novel"] },
  "Nam centimet tren giay - Shinkai Makoto.prc": { title: "5 Centimet Trên Giây", author: "Shinkai Makoto", tags: ["Romance", "Drama", "Light Novel"] },
  "Nang Va Con Meo Cua Nang - Makoto Shinkai & Naruki Nagasawa.azw3": { title: "Nàng Và Con Mèo Của Nàng", author: "Shinkai Makoto, Naruki Nagasawa", tags: ["Đời thường", "Chữa lành", "Văn học Nhật Bản"] },
  "Những Đứa Trẻ Đuổi Theo Tinh Tú - Asahi Akisaka & Makoto Shinkai & Lan Hương (dịch).azw3": { title: "Những Đứa Trẻ Đuổi Theo Tinh Tú", author: "Shinkai Makoto, Asahi Akisaka", tags: ["Fantasy", "Adventure", "Light Novel"] },
  "Your Name - Shinkai Makoto.azw3": { title: "Your Name - Tên Cậu Là Gì?", author: "Shinkai Makoto", tags: ["Romance", "Fantasy", "Light Novel"] },
  "Tron Thoat Khoi Thuc Tai - Fumio Yamamoto.azw3": { title: "Trốn Thoát Khỏi Thực Tại", author: "Fumio Yamamoto", tags: ["Tâm lý", "Đời thường", "Văn học Nhật Bản"] },
  "Xu Tuyet - Yasunari Kawabata.azw3": { title: "Xứ Tuyết", author: "Yasunari Kawabata", tags: ["Kinh điển", "Romance", "Văn học Nhật Bản"] }
};

const SKIP_DUPLICATE_FILES = new Set([
  "Rung Na-Uy - Haruki Murakami (1).prc",
  "Bên Kia Mây Trời Là Nơi Hẹn Ước - Kanoh Arata & Shinkai Makoto & HẢI HÀ (dịch)(1).azw3"
]);

async function main() {
  console.log("🚀 Starting batch import from C:\\Users\\Hikari\\Downloads\\Compressed\\collection...\n");

  const existingSeries = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8")).slice(0, 66);
  const usedSlugs = new Set(existingSeries.map((s) => s.slug));
  const addedSeries = [];

  // 1. No Game No Life (10 EPUBs)
  {
    const ngnlDir = path.join(SOURCE_DIR, "No Game No Life");
    const epubs = fs.readdirSync(ngnlDir).filter((f) => f.endsWith(".epub")).sort();
    const slug = "no-game-no-life";
    usedSlugs.add(slug);
    const seriesOutDir = path.join(OUTPUT_ROOT, slug);
    ensureDir(seriesOutDir);

    const subtitles = [
      "Anh Em Game Thủ Sẽ Cùng Chinh Phục Thế Giới Thần Tiên",
      "Có Vẻ Anh Em Game Thủ Đã Để Mắt Tới Đất Nước Kemonomimi",
      "Hình Như Một Trong Hai Anh Em Game Thủ Đã Biến Mất...?",
      "Hai Anh Em Game Thủ Đã Chạy Trốn Khỏi Trò Chơi Lãng Mạn Thực Tế",
      "Có Vẻ Như Hai Anh Em Game Thủ Ghét Trò Chơi Mới Này",
      "Có Vẻ Như Cặp Đôi Game Thủ Đã Thách Thức Cả Thế Giới",
      "Hai Anh Em Game Thủ Sẽ Bác Bỏ Cả Thế Giới",
      "Có Vẻ Như Hai Anh Em Game Thủ Sẽ Thừa Kế Chiến Lược",
      "Hình Như Hai Anh Em Game Thủ Nghỉ Ngơi Một Hồi",
      "Có Vẻ Hai Anh Em Game Thủ Phải Trả Giá Cho Quá Khứ"
    ];

    const metadata = [];
    const volumeTitles = {};
    for (let i = 0; i < epubs.length; i++) {
      const volNum = String(i + 1).padStart(2, "0");
      const volumeName = `Tập ${volNum}`;
      const buf = fs.readFileSync(path.join(ngnlDir, epubs[i]));
      const parsed = await parseEpubVolume(buf, volumeName, seriesOutDir, subtitles[i], "Yuu Kamiya");
      metadata.push(parsed.volumeData);
      volumeTitles[sanitizeName(volumeName)] = {
        label: `Tập ${volNum}`,
        title: subtitles[i]
      };
    }

    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
    addedSeries.push({
      slug,
      source: `output/${slug}`,
      titleVi: "No Game No Life",
      volumeTitles,
      titleJp: "No Game No Life (ノーゲーム・ノーライフ)",
      author: "Yuu Kamiya",
      illustrator: "Yuu Kamiya",
      status: "Đang cập nhật",
      description:
        "Hai anh em ruột Sora và Shiro là những game thủ bất khả chiến bại dưới cái tên huyền thoại 『 』 (Trắng). Một ngày nọ, vị thần tự xưng là Tet triệu hồi họ tới Disboard — thế giới nơi mọi cuộc chiến, biên giới và mạng sống đều được quyết định bằng các trò chơi thay vì vũ lực.",
      tags: ["Fantasy", "Game", "Comedy", "Adventure", "Light Novel"]
    });
    console.log(`✔ Built series: No Game No Life (${epubs.length} volumes)`);
  }

  // 2. Trọn bộ Harry Potter (7 volumes)
  {
    const hpDir = path.join(SOURCE_DIR, "Trọn bộ Harry Potter - JK");
    const hpFiles = fs.readdirSync(hpDir).filter((f) => /^Tập\s*[1-7]\b/i.test(f.normalize("NFC"))).sort();
    const slug = "harry-potter";
    usedSlugs.add(slug);
    const seriesOutDir = path.join(OUTPUT_ROOT, slug);
    ensureDir(seriesOutDir);

    const hpSubtitles = [
      "Harry Potter và Hòn Đá Phù Thủy",
      "Harry Potter và Phòng Chứa Bí Mật",
      "Harry Potter và Tên Tù Nhân Ngục Azkaban",
      "Harry Potter và Chiếc Cốc Lửa",
      "Harry Potter và Hội Phượng Hoàng",
      "Harry Potter và Hoàng Tử Lai",
      "Harry Potter và Bảo Bối Tử Thần"
    ];

    const metadata = [];
    const volumeTitles = {};
    for (let i = 0; i < hpFiles.length; i++) {
      const volNum = `0${i + 1}`;
      const volumeName = `Tập ${volNum}`;
      const parsed = await parsePdbVolume(
        path.join(hpDir, hpFiles[i]),
        volumeName,
        seriesOutDir,
        hpSubtitles[i],
        "J. K. Rowling"
      );
      metadata.push(parsed.volumeData);
      volumeTitles[sanitizeName(volumeName)] = {
        label: `Tập ${volNum}`,
        title: hpSubtitles[i]
      };
    }

    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
    addedSeries.push({
      slug,
      source: `output/${slug}`,
      titleVi: "Harry Potter (Trọn Bộ 7 Tập)",
      volumeTitles,
      titleJp: "Harry Potter",
      author: "J. K. Rowling",
      illustrator: "",
      status: "Hoàn thành",
      description:
        "Trọn bộ 7 tập tiểu thuyết huyền thoại về cậu bé phù thủy Harry Potter cùng hai người bạn thân Ron Weasley và Hermione Granger tại Trường Phù thủy và Pháp sư Hogwarts, trong cuộc hành trình đối đầu với Chúa tể Hắc ám Voldemort.",
      tags: ["Fantasy", "Adventure", "Kinh điển", "Văn học phương Tây"]
    });
    console.log(`✔ Built series: Harry Potter (${hpFiles.length} volumes)`);
  }

  // 3. Collect all standalone files from "42 cuốn sách..." and "Văn học Nhật Bản"
  function walkStandalone(dir, list = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "No Game No Life" || e.name.startsWith("Trọn bộ Harry Potter")) continue;
        walkStandalone(full, list);
      } else if (/\.(epub|mobi|prc|azw3)$/i.test(e.name)) {
        const nfcName = e.name.normalize("NFC");
        if (SKIP_DUPLICATE_FILES.has(nfcName)) continue;
        list.push({ full, nfcName });
      }
    }
    return list;
  }

  const standaloneList = walkStandalone(SOURCE_DIR);
  console.log(`\n📖 Processing ${standaloneList.length} standalone books in collection...`);

  for (const item of standaloneList) {
    const override = STANDALONE_OVERRIDES[item.nfcName] || {};
    const titleVi = override.title || item.nfcName.replace(/\.(epub|mobi|prc|azw3)$/i, "");
    const author = override.author || "Khuyết danh";
    const tags = override.tags || ["Tiểu thuyết"];

    let slug = slugify(titleVi);
    if (usedSlugs.has(slug)) slug = `${slug}-2`;
    usedSlugs.add(slug);

    const seriesOutDir = path.join(OUTPUT_ROOT, slug);
    ensureDir(seriesOutDir);

    let parsed;
    if (item.nfcName.toLowerCase().endsWith(".epub")) {
      parsed = await parseEpubVolume(fs.readFileSync(item.full), "Tập 1", seriesOutDir, titleVi, author);
    } else {
      parsed = await parsePdbVolume(item.full, "Tập 1", seriesOutDir, titleVi, author);
    }

    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify([parsed.volumeData], null, 2), "utf8");
    addedSeries.push({
      slug,
      source: `output/${slug}`,
      titleVi,
      volumeTitles: {
        Tập_1: {
          label: "Trọn bộ",
          title: titleVi
        }
      },
      titleJp: "",
      author,
      illustrator: "",
      status: "Hoàn thành",
      description: parsed.description || `${titleVi} — tác phẩm nổi tiếng của ${author}.`,
      tags
    });
  }

  // Sort standalone additions by Vietnamese title while keeping the multi-volume series near the top
  const multiVolAdditions = addedSeries.slice(0, 2);
  const singleVolAdditions = addedSeries.slice(2).sort((a, b) => a.titleVi.localeCompare(b.titleVi, "vi"));
  const finalSeries = [...existingSeries, ...multiVolAdditions, ...singleVolAdditions];

  fs.writeFileSync(SERIES_JSON_PATH, `${JSON.stringify(finalSeries, null, 2)}\n`, "utf8");
  console.log(`\n🎉 Done! Added ${addedSeries.length} new series entries to series.json (total: ${finalSeries.length} series).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
