const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const SOURCE_DIR = "C:\\Users\\Hikari\\Downloads\\Compressed\\Văn Học Nhật Bản - hotaru-team";
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
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function toTitleCaseIfAllCaps(title) {
  const clean = title.normalize("NFC").replace(/\s+/g, " ").trim();
  const letters = clean.replace(/[^\p{L}]/gu, "");
  if (!letters || letters !== letters.toUpperCase()) return clean;
  return clean
    .toLowerCase()
    .replace(/(^|\s|[-–—~:(“"'])(\p{L})/gu, (m, sep, ch) => `${sep}${ch.toUpperCase()}`);
}

function cleanAuthor(opfCreator, fallbackFromFilename = "") {
  let raw = decodeHtmlEntities(opfCreator || "").normalize("NFC").trim();
  // Remove "& ... (dịch)" or "& ... (hiệu đính)"
  raw = raw
    .replace(/\s*(?:&|,|;|\bvà\b)\s*[^&,;]*?\((?:dịch|hiệu đính|biên dịch|dịch giả)[^)]*\)/gi, "")
    .trim();
  if (/^\(?.*?(?:dịch|hiệu đính).*?\)?$/i.test(raw) || /\((?:dịch|hiệu đính)\)/i.test(raw)) {
    raw = "";
  }
  if (!raw && fallbackFromFilename) {
    raw = fallbackFromFilename
      .normalize("NFC")
      .replace(/\s*(?:&|,)\s*[^&,]*?\((?:dịch|hiệu đính)[^)]*\)/gi, "")
      .replace(/\s*&\s*[^&]*?\(dịc?[^)]*$/gi, "")
      .replace(/_\d+$/, "")
      .trim();
  }
  return raw || "Khuyết danh";
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
    await sharp(buf)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
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

function extractBlocksFromHtml(html, basePath = "") {
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;

  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Collect images referenced in this HTML fragment
  const imgSrcs = [];
  for (const m of body.matchAll(/<(?:img|image)\b[^>]*?\b(?:src|xlink:href|href)=["']([^"']+)["'][^>]*>/gi)) {
    const resolved = basePath ? resolveHref(basePath, decodeURIComponent(m[1])) : m[1];
    if (resolved && !imgSrcs.includes(resolved)) imgSrcs.push(resolved);
  }
  const mobiRecIndices = [];
  for (const m of body.matchAll(/<img\b[^>]*?\brecindex=["']?(\d+)["']?[^>]*>/gi)) {
    const idx = Number(m[1]);
    if (Number.isFinite(idx) && idx > 0 && !mobiRecIndices.includes(idx)) {
      mobiRecIndices.push(idx);
    }
  }

  // Mark footnotes inside <aside epub:type="footnote">
  body = body.replace(/<aside\b[^>]*epub:type=["']footnote["'][^>]*>([\s\S]*?)<\/aside>/gi, (_, inner) => {
    const txt = decodeHtmlEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return txt ? `\n\n[Chú thích: ${txt}]\n\n` : "\n\n";
  });

  // Replace <hr> with scene break
  body = body.replace(/<hr\b[^>]*\/?>/gi, "\n\n--- ---\n\n");
  // Replace <br> with newline
  body = body.replace(/<br\b[^>]*\/?>/gi, "\n");
  // Insert paragraph breaks around block elements
  body = body.replace(/<\/?(?:p|div|h[1-6]|li|blockquote|section|article|tr| header|footer|aside)\b[^>]*>/gi, "\n\n");

  // Strip remaining tags
  const rawText = decodeHtmlEntities(body.replace(/<[^>]+>/g, ""));
  const lines = rawText
    .normalize("NFC")
    .split(/\n+/)
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean);

  const paragraphs = [];
  for (const line of lines) {
    if (/^(?:ebook\s*©\s*hotaru-team|hotaru-team)$/i.test(line)) continue;
    if (/^(?:[*＊•·◊♦●○❖✦✧~～—–-]\s*){2,}$/.test(line) || /^[*＊◊♦❖✦✧]$/.test(line)) {
      if (paragraphs[paragraphs.length - 1] !== "--- ---") paragraphs.push("--- ---");
      continue;
    }
    paragraphs.push(line);
  }

  return { paragraphs, imgSrcs, mobiRecIndices };
}

function stripDuplicateTitleParagraphs(title, paragraphs) {
  if (!title || !paragraphs.length) return paragraphs;
  const normTitle = normalizeForMatch(title);
  if (!normTitle) return paragraphs;

  const p0 = normalizeForMatch(paragraphs[0].replace(/\*+$/, ""));
  if (p0 === normTitle) {
    return paragraphs.slice(1);
  }
  if (paragraphs.length >= 2) {
    const p01 = normalizeForMatch(`${paragraphs[0]} ${paragraphs[1].replace(/\*+$/, "")}`);
    if (p01 === normTitle) {
      if (/\*+$/.test(paragraphs[1])) {
        return [paragraphs[1], ...paragraphs.slice(2)];
      }
      return paragraphs.slice(2);
    }
  }
  return paragraphs;
}

// ============================================================================
//  EPUB PARSER
// ============================================================================
async function parseEpubVolume(buf, volumeName, seriesOutputDir, fallbackAuthor = "") {
  const zip = await JSZip.loadAsync(buf);
  const containerXml = await zip.file("META-INF/container.xml").async("string");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)[1];
  const opfXml = await zip.file(opfPath).async("string");

  const opfTitle = decodeHtmlEntities(
    (opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim()
  ).normalize("NFC");
  const opfCreator = (opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1] || "")
    .replace(/<[^>]+>/g, "")
    .trim();
  const opfDescRaw = (opfXml.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i)?.[1] || "").trim();
  let opfDesc = decodeHtmlEntities(decodeHtmlEntities(opfDescRaw))
    .replace(/<ul\b[\s\S]*?<\/ul>/gi, "\n")
    .replace(/<hr\b[^>]*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|li|br|blockquote|section)\b[^>]*>/gi, "\n");
  opfDesc = decodeHtmlEntities(opfDesc.replace(/<[^>]+>/g, " "))
    .normalize("NFC")
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/(?:ra\s*epub|ra\s*text|soát\s*text|sửa\s*chính\s*tả|vctvegroup|hotaru-team|Chụp\/Scan|Text\s*(?:và|&|,)\s*epub|Nguồn\s*(?:ebook|eBook|pdf)|^Epub\s*:)/i.test(
          l
        )
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const manifest = new Map();
  const manifestByPath = new Map();
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
      const item = { id, path: resolved, type, props };
      manifest.set(id, item);
      manifestByPath.set(resolved, item);
      if (type === "application/x-dtbncx+xml" || resolved.endsWith(".ncx")) ncxPath = resolved;
      if (props.includes("nav")) navPath = resolved;
      if (props.includes("cover-image") && !coverId) coverId = id;
    }
  }

  // Parse TOC labels from NCX and/or nav.xhtml
  const tocMap = new Map();
  if (ncxPath && zip.file(ncxPath)) {
    const ncxXml = await zip.file(ncxPath).async("string");
    for (const m of ncxXml.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
      const label = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "")).normalize("NFC").replace(/\s+/g, " ").trim();
      const src = resolveHref(ncxPath, decodeURIComponent(m[2]));
      if (label && src && !tocMap.has(src)) tocMap.set(src, label);
    }
  }
  if (navPath && zip.file(navPath) && tocMap.size === 0) {
    const navHtml = await zip.file(navPath).async("string");
    for (const m of navHtml.matchAll(/<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const label = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, "")).normalize("NFC").replace(/\s+/g, " ").trim();
      const src = resolveHref(navPath, decodeURIComponent(m[1]));
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
    const buf = await entry.async("nodebuffer");
    const fileName = `illu_${String(illuFiles.length + 1).padStart(2, "0")}.webp`;
    const ok = await saveWebpImage(buf, path.join(imgDir, fileName));
    if (ok) {
      savedIlluPaths.add(zipImgPath);
      illuFiles.push(fileName);
    }
  }

  // 1. Ensure cover image is first in Minh họa
  if (coverId && manifest.get(coverId)?.type.startsWith("image/")) {
    await addIlluFromZipPath(manifest.get(coverId).path);
  }
  if (illuFiles.length === 0) {
    const coverImgEntry = [...manifest.values()].find(
      (it) => it.type.startsWith("image/") && /cover/i.test(path.posix.basename(it.path))
    );
    if (coverImgEntry) await addIlluFromZipPath(coverImgEntry.path);
  }

  // 2. Walk spine items
  const rawChapters = [];
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    const fileEntry = zip.file(item.path);
    if (!fileEntry) continue;
    const baseName = path.posix.basename(item.path).toLowerCase();
    if (item.path === navPath || /^(?:nav|toc)\d*\.x?html?$/i.test(baseName)) continue;

    const html = await fileEntry.async("string");
    const { paragraphs, imgSrcs } = extractBlocksFromHtml(html, item.path);
    const joinedText = paragraphs.join(" ").trim();
    const tocLabel = tocMap.get(item.path) || "";

    // Pure cover / illustration page
    if ((paragraphs.length === 0 || joinedText.length <= 20 || /^cover$/i.test(joinedText)) && imgSrcs.length > 0) {
      for (const src of imgSrcs) {
        await addIlluFromZipPath(src);
      }
      continue;
    }

    // Skip pure credit / jacket frontmatter pages
    if (/^(?:credit|jacket|titlepage|copyright)\d*\.x?html?$/i.test(baseName) && !tocLabel && joinedText.length < 600) {
      for (const src of imgSrcs) await addIlluFromZipPath(src);
      continue;
    }
    if (!tocLabel && i <= 2 && joinedText.length < 320 && /(?:Người dịch|Phát hành|Tác giả|Bản quyền|hotaru-team)/i.test(joinedText)) {
      for (const src of imgSrcs) await addIlluFromZipPath(src);
      continue;
    }

    if (paragraphs.length === 0 && imgSrcs.length === 0) continue;

    let chTitle = tocLabel;
    if (!chTitle) {
      const hMatch = html.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i);
      const hText = hMatch ? decodeHtmlEntities(hMatch[1].replace(/<[^>]+>/g, " ")).normalize("NFC").replace(/\s+/g, " ").trim() : "";
      if (hText && hText.length <= 120) {
        chTitle = hText;
      } else if (paragraphs[0] && paragraphs[0].length <= 90) {
        chTitle = paragraphs[0];
      } else {
        chTitle = `Phần ${rawChapters.length + 1}`;
      }
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

  // Fallback if cover still wasn't found: grab first image in zip
  if (illuFiles.length === 0) {
    const anyImg = Object.keys(zip.files)
      .filter((k) => !zip.files[k].dir && /\.(jpe?g|png|webp|gif)$/i.test(k))
      .sort()[0];
    if (anyImg) await addIlluFromZipPath(anyImg);
  }

  const finalChapters = [];
  if (illuFiles.length > 0) {
    finalChapters.push({
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    });
  }

  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i];
    const chIdx = finalChapters.length + 1;
    const prefix = `ch${String(chIdx).padStart(2, "0")}`;
    const chImgFiles = [];
    for (const src of ch.imgSrcs) {
      if (savedIlluPaths.has(src)) continue;
      const entry = zip.file(src);
      if (!entry) continue;
      const buf = await entry.async("nodebuffer");
      const fileName = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
      const ok = await saveWebpImage(buf, path.join(imgDir, fileName));
      if (ok) chImgFiles.push(fileName);
    }

    finalChapters.push({
      title: ch.title,
      content: ch.paragraphs.join("\n\n"),
      isIllustration: false,
      ...(chImgFiles.length > 0 ? { images: chImgFiles } : {})
    });
  }

  // Determine description fallback if opfDesc is empty or too short
  let description = opfDesc;
  if (!description || description.length < 50) {
    for (const ch of rawChapters) {
      const candidate = ch.paragraphs
        .filter((p) => p.length > 40 && !p.startsWith("[Chú thích:"))
        .slice(0, 2)
        .join(" ");
      if (candidate.length >= 60) {
        description = candidate.length > 360 ? `${candidate.slice(0, 357).replace(/\s+\S*$/, "")}…` : candidate;
        break;
      }
    }
  }

  return {
    opfTitle: toTitleCaseIfAllCaps(opfTitle),
    author: cleanAuthor(opfCreator, fallbackAuthor),
    description,
    volumeData: {
      volumeName,
      chapters: finalChapters
    }
  };
}

// ============================================================================
//  MOBI PARSER (High School DxD 22 Volumes)
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
    } else {
      out.push(32, c ^ 0x80);
    }
  }
  return Buffer.from(out);
}

async function parseMobiVolume(filePath, volumeName, seriesOutputDir) {
  const buf = fs.readFileSync(filePath);
  const numRecords = buf.readUInt16BE(76);
  const offsets = [];
  for (let r = 0; r < numRecords; r++) offsets.push(buf.readUInt32BE(78 + r * 8));
  offsets.push(buf.length);

  const rec0 = buf.slice(offsets[0], offsets[1]);
  const compression = rec0.readUInt16BE(0);
  const textRecCount = rec0.readUInt16BE(8);
  const mobiHeaderLen = rec0.readUInt32BE(0x14);
  const firstImageIndex = rec0.readUInt32BE(0x6c);
  const exthFlags = rec0.readUInt32BE(0x80);
  const extraFlags = rec0.length >= 0xf4 ? rec0.readUInt16BE(0xf2) : 0;

  let coverOffset = null;
  if (exthFlags & 0x40) {
    const exthStart = 16 + mobiHeaderLen;
    const exthCount = rec0.readUInt32BE(exthStart + 8);
    let pos = exthStart + 12;
    for (let i = 0; i < exthCount; i++) {
      const type = rec0.readUInt32BE(pos);
      const len = rec0.readUInt32BE(pos + 4);
      if (type === 201 && len >= 12) coverOffset = rec0.readUInt32BE(pos + 8);
      pos += len;
    }
  }

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
    chunks.push(compression === 2 ? decompressPalmDOC(slice) : slice);
  }

  const html = Buffer.concat(chunks).toString("utf8");
  const sections = html.split(/<mbp:pagebreak\s*\/?>/i);

  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutputDir, volDirName, "images");
  ensureDir(imgDir);

  const seenHashes = new Set();
  const illuFiles = [];

  async function addIlluRecord(recIdx) {
    if (recIdx < 0 || recIdx >= numRecords) return;
    const recBuf = buf.slice(offsets[recIdx], offsets[recIdx + 1]);
    if (!recBuf || recBuf.length < 64) return;
    const sha = crypto.createHash("sha1").update(recBuf).digest("hex");
    if (seenHashes.has(sha)) return;
    const fileName = `illu_${String(illuFiles.length + 1).padStart(2, "0")}.webp`;
    const ok = await saveWebpImage(recBuf, path.join(imgDir, fileName));
    if (ok) {
      seenHashes.add(sha);
      illuFiles.push(fileName);
    }
  }

  // 1. Cover image from EXTH coverOffset
  if (coverOffset !== null) {
    await addIlluRecord(firstImageIndex + coverOffset);
  }

  // 2. Walk sections
  const rawChapters = [];
  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const { paragraphs, mobiRecIndices } = extractBlocksFromHtml(sec);
    if (paragraphs.length === 0 && mobiRecIndices.length === 0) continue;

    const firstLine = paragraphs[0] || "";
    const joined = paragraphs.join(" ");

    // Skip front TOC / title page or trailing Table of Contents
    if (s === 0 && /Mục Lục/i.test(joined) && paragraphs.length < 40) continue;
    if (/^(?:Table of Contents|Mục Lục)/i.test(firstLine) && paragraphs.length < 50) continue;

    // Illustration section
    if (/^Minh\s*họa$/i.test(firstLine) || (paragraphs.length <= 2 && mobiRecIndices.length > 0 && joined.length < 60)) {
      for (const rIdx of mobiRecIndices) {
        await addIlluRecord(firstImageIndex + rIdx - 1);
      }
      continue;
    }

    let chTitle = firstLine;
    if (!chTitle || chTitle.length > 110) {
      chTitle = `Phần ${rawChapters.length + 1}`;
    }
    const bodyParagraphs = stripDuplicateTitleParagraphs(chTitle, paragraphs);
    if (bodyParagraphs.length === 0 && mobiRecIndices.length === 0) continue;

    rawChapters.push({
      title: chTitle,
      paragraphs: bodyParagraphs.length > 0 ? bodyParagraphs : paragraphs,
      mobiRecIndices
    });
  }

  // Fallback cover if still empty
  if (illuFiles.length === 0) {
    await addIlluRecord(firstImageIndex);
  }

  const finalChapters = [];
  if (illuFiles.length > 0) {
    finalChapters.push({
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    });
  }

  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i];
    const chIdx = finalChapters.length + 1;
    const prefix = `ch${String(chIdx).padStart(2, "0")}`;
    const chImgFiles = [];
    for (const rIdx of ch.mobiRecIndices) {
      const absRec = firstImageIndex + rIdx - 1;
      if (absRec < 0 || absRec >= numRecords) continue;
      const recBuf = buf.slice(offsets[absRec], offsets[absRec + 1]);
      if (!recBuf || recBuf.length < 64) continue;
      const fileName = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
      const ok = await saveWebpImage(recBuf, path.join(imgDir, fileName));
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
    volumeName,
    chapters: finalChapters
  };
}

// ============================================================================
//  MAIN BATCH IMPORT
// ============================================================================
async function main() {
  console.log("🚀 Starting batch import from Văn Học Nhật Bản - hotaru-team...\n");

  const rootFiles = fs.readdirSync(SOURCE_DIR);
  const byNFC = new Map();
  for (const f of rootFiles) {
    byNFC.set(f.normalize("NFC"), path.join(SOURCE_DIR, f));
  }

  const usedNFC = new Set();
  const newSeriesConfigs = [];

  async function buildMultiVolumeEpubSeries({
    slug,
    titleVi,
    titleJp = "",
    author,
    illustrator = "",
    status = "Hoàn thành",
    description = "",
    tags = ["Văn học Nhật Bản", "Tiểu thuyết"],
    volumes // [{ fileNFC?, buffer?, volumeName, label, title }]
  }) {
    const seriesOutDir = path.join(OUTPUT_ROOT, slug);
    ensureDir(seriesOutDir);
    const metadata = [];
    const volumeTitles = {};
    let autoDesc = description;

    for (const v of volumes) {
      const buf = v.buffer || fs.readFileSync(byNFC.get(v.fileNFC));
      if (v.fileNFC) usedNFC.add(v.fileNFC);
      const parsed = await parseEpubVolume(buf, v.volumeName, seriesOutDir, author);
      metadata.push(parsed.volumeData);
      const volDirName = sanitizeName(v.volumeName);
      volumeTitles[volDirName] = {
        label: v.label,
        ...(v.title ? { title: v.title } : {})
      };
      if (!autoDesc && parsed.description) autoDesc = parsed.description;
    }

    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
    newSeriesConfigs.push({
      slug,
      source: `output/${slug}`,
      titleVi,
      volumeTitles,
      titleJp,
      author,
      illustrator,
      status,
      description: autoDesc,
      tags
    });
    console.log(`✔ Built series: ${titleVi} (${volumes.length} volumes)`);
  }

  // 1. High School DxD (22 MOBI files)
  {
    const dxdSlug = "high-school-dxd";
    const dxdDir = byNFC.get("High School DxD");
    usedNFC.add("High School DxD");
    const mobiFiles = fs.readdirSync(dxdDir).filter((f) => f.endsWith(".mobi")).sort();
    const seriesOutDir = path.join(OUTPUT_ROOT, dxdSlug);
    ensureDir(seriesOutDir);
    const metadata = [];
    const volumeTitles = {};

    for (let i = 0; i < mobiFiles.length; i++) {
      const f = mobiFiles[i].normalize("NFC");
      const volNum = String(i + 1).padStart(2, "0");
      const volumeName = `Tập ${volNum}`;
      const subMatch = f.match(/vol\s*\d+\s*[-–—]\s*(.+?)\s*[-–—]\s*Ichiei Ishibumi/i);
      const subTitle = subMatch ? subMatch[1].replace(/\.$/, "").trim() : "";
      const volData = await parseMobiVolume(path.join(dxdDir, mobiFiles[i]), volumeName, seriesOutDir);
      metadata.push(volData);
      volumeTitles[sanitizeName(volumeName)] = {
        label: `Tập ${volNum}`,
        ...(subTitle ? { title: subTitle } : {})
      };
    }

    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
    newSeriesConfigs.push({
      slug: dxdSlug,
      source: `output/${dxdSlug}`,
      titleVi: "High School DxD",
      volumeTitles,
      titleJp: "High School DxD (ハイスクールD×D)",
      author: "Ichiei Ishibumi",
      illustrator: "Miyama-Zero",
      status: "Hoàn thành",
      description:
        "Hyoudou Issei, một nam sinh trung học bình thường, bị sát hại ngay trong buổi hẹn hò đầu tiên bởi một thiên thần sa ngã. Cậu được Rias Gremory — đàn chị tóc đỏ xinh đẹp nhất trường kiêm chủ nhân gia tộc ác quỷ cấp cao Gremory — hồi sinh thành ác quỷ quyến thuộc của cô, mở đầu những trận chiến nảy lửa giữa Ác quỷ, Thiên thần và Thiên thần sa ngã.",
      tags: ["Action", "Fantasy", "Comedy", "Romance", "Học đường", "Light Novel"]
    });
    console.log(`✔ Built series: High School DxD (${mobiFiles.length} volumes)`);
  }

  // 2. Grimgar - Ảo Ảnh Và Tro Tàn (14 EPUBs)
  {
    const grimgarNFCs = [...byNFC.keys()]
      .filter((k) => k.startsWith("Grimgar level "))
      .sort((a, b) => {
        const na = Number(a.match(/level\s*(\d+)/i)?.[1] || 0);
        const nb = Number(b.match(/level\s*(\d+)/i)?.[1] || 0);
        return na - nb;
      });
    const volumes = grimgarNFCs.map((f, idx) => {
      const num = String(idx + 1).padStart(2, "0");
      const sub = f.replace(/^Grimgar level \d+\.\s*/i, "").replace(/\.epub$/i, "").trim();
      return {
        fileNFC: f,
        volumeName: `Tập ${num}`,
        label: `Level ${num}`,
        title: sub
      };
    });
    await buildMultiVolumeEpubSeries({
      slug: "grimgar-ao-anh-va-tro-tan",
      titleVi: "Grimgar - Ảo Ảnh Và Tro Tàn",
      titleJp: "Hai to Gensou no Grimgar",
      author: "Ao Jyumonji",
      illustrator: "Eiri Shirai",
      status: "Đang cập nhật",
      description:
        "Khi Haruhiro tỉnh dậy trong bóng tối, cậu không nhớ mình là ai, đến từ đâu hay vì sao lại ở thế giới mang tên Grimgar này. Cùng những người bạn đồng cảnh ngộ yếu ớt nhất, cậu phải lập thành một tổ đội lính tình nguyện tập sự và chật vật chiến đấu giành giật sự sống qua từng ngày.",
      tags: ["Fantasy", "Adventure", "Action", "Drama", "Light Novel"],
      volumes
    });
  }

  // 3. Khi Hikaru Còn Trên Thế Gian Này... (10 EPUBs inside ZIP)
  {
    const zipNFC = [...byNFC.keys()].find((k) => k.startsWith("Khi Hikaru") && k.endsWith(".zip"));
    usedNFC.add(zipNFC);
    const outerZip = await JSZip.loadAsync(fs.readFileSync(byNFC.get(zipNFC)));
    const entryNames = Object.keys(outerZip.files)
      .filter((k) => k.endsWith(".epub"))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)\./)?.[1] || 0);
        const nb = Number(b.match(/(\d+)\./)?.[1] || 0);
        return na - nb;
      });
    const volumes = [];
    for (let i = 0; i < entryNames.length; i++) {
      const entryName = entryNames[i];
      const num = String(i + 1).padStart(2, "0");
      const sub = entryName.match(/\d+\.\s*([^.]+)\.epub$/i)?.[1]?.trim() || "";
      volumes.push({
        buffer: await outerZip.file(entryName).async("nodebuffer"),
        volumeName: `Tập ${num}`,
        label: `Tập ${num}`,
        title: sub
      });
    }
    await buildMultiVolumeEpubSeries({
      slug: "khi-hikaru-con-tren-the-gian-nay",
      titleVi: "Khi Hikaru Còn Trên Thế Gian Này...",
      titleJp: "Hikaru ga Chikyuu ni Itakoro......",
      author: "Nomura Mizuki",
      illustrator: "Takeoka Miho",
      status: "Hoàn thành",
      description:
        "Koremitsu Akagi vốn có vẻ ngoài dữ dằn khiến ai nấy đều xa lánh. Người bạn duy nhất bắt chuyện với cậu là “Hoàng tử” hào hoa Mikado Hikaru lại đột ngột qua đời, rồi biến thành hồn ma chỉ mình Koremitsu nhìn thấy và nhờ cậu hoàn thành những tâm nguyện còn dang dở với các cô gái Hikaru từng hứa hẹn.",
      tags: ["Romance", "Mystery", "Học đường", "Drama", "Light Novel"],
      volumes
    });
  }

  // 4. Cổ Điển Bộ - Hyouka (6 EPUBs)
  {
    const hyoukaOrder = [
      { file: "Kem da - Honobu Yonezawa.epub", title: "Kem Đá" },
      { file: "Thang Kho - Honobu Yonezawa.epub", title: "Thằng Khờ" },
      { file: "Trinh tu Kudryavka - Honobu Yonezawa.epub", title: "Trình Tự Kudryavka" },
      { file: "Bup be di duong vong - Honobu Yonezawa.epub", title: "Búp Bê Đi Đường Vòng" },
      { file: "Khoang Cach Giua Hai Nguoi - Honobu Yonezawa.epub", title: "Khoảng Cách Giữa Hai Người" },
      { file: "Du duoc ban doi canh - Honobu Yonezawa.epub", title: "Dù Được Ban Đôi Cánh" }
    ];
    await buildMultiVolumeEpubSeries({
      slug: "co-dien-bo-hyouka",
      titleVi: "Cổ Điển Bộ (Hyouka)",
      titleJp: "Koten-bu Series (Hyouka)",
      author: "Honobu Yonezawa",
      status: "Đang cập nhật",
      description:
        "Oreki Houtarou — nam sinh tôn thờ phương châm tiết kiệm năng lượng “Việc gì không cần làm thì không làm, việc gì phải làm thì làm cho nhanh” — gia nhập Câu lạc bộ Cổ Điển theo lời chị gái. Tại đây, cậu gặp gỡ cô tiểu thư giàu trí tò mò Chitanda Eru cùng câu nói quen thuộc “Mình tò mò lắm!”, cuốn cậu vào những bí ẩn đời thường đầy cuốn hút nơi trường học.",
      tags: ["Mystery", "Đời thường", "Học đường", "Văn học Nhật Bản"],
      volumes: hyoukaOrder.map((item, idx) => ({
        fileNFC: item.file,
        volumeName: `Tập 0${idx + 1}`,
        label: `Tập 0${idx + 1}`,
        title: item.title
      }))
    });
  }

  // 5. Holmes Ở Kyoto (6 EPUBs)
  {
    const holmesNFCs = [...byNFC.keys()]
      .filter((k) => k.startsWith("Holmes ở Kyoto"))
      .sort((a, b) => {
        const na = Number(a.match(/Kyoto\s*(\d+)/i)?.[1] || 0);
        const nb = Number(b.match(/Kyoto\s*(\d+)/i)?.[1] || 0);
        return na - nb;
      });
    await buildMultiVolumeEpubSeries({
      slug: "holmes-o-kyoto",
      titleVi: "Holmes Ở Kyoto",
      titleJp: "Kyoto Teramachi Sanjou no Holmes",
      author: "Mai Mochizuki",
      status: "Đang cập nhật",
      tags: ["Mystery", "Romance", "Đời thường", "Văn học Nhật Bản"],
      volumes: holmesNFCs.map((f, idx) => {
        const sub = f.replace(/^Holmes ở Kyoto\s*\d+\.?\s*/i, "").replace(/\.epub$/i, "").trim();
        return {
          fileNFC: f,
          volumeName: `Tập 0${idx + 1}`,
          label: `Tập 0${idx + 1}`,
          title: sub || `Tập ${idx + 1}`
        };
      })
    });
  }

  // 6. Dược Sư Tự Sự (5 EPUBs)
  {
    const duocSuNFCs = [...byNFC.keys()]
      .filter((k) => k.startsWith("Dược sư tự sự"))
      .sort((a, b) => {
        const na = Number(a.match(/tự sự\s*(\d+)/i)?.[1] || 0);
        const nb = Number(b.match(/tự sự\s*(\d+)/i)?.[1] || 0);
        return na - nb;
      });
    await buildMultiVolumeEpubSeries({
      slug: "duoc-su-tu-su",
      titleVi: "Dược Sư Tự Sự",
      titleJp: "Kusuriya no Hitorigoto",
      author: "Natsu Hyuuga",
      illustrator: "Touko Shino",
      status: "Đang cập nhật",
      tags: ["Mystery", "Historical", "Drama", "Romance", "Light Novel"],
      volumes: duocSuNFCs.map((f, idx) => ({
        fileNFC: f,
        volumeName: `Tập 0${idx + 1}`,
        label: `Tập 0${idx + 1}`,
        title: `Dược Sư Tự Sự - Tập ${idx + 1}`
      }))
    });
  }

  // 7. Bệnh Án Của Thần Linh (2 EPUBs)
  {
    const benhAnNFCs = [
      "BỆNH ÁN CỦA THẦN LINH - Natsukawa Sosuke & Quỳnh Quỳnh (dịch).epub",
      "BỆNH ÁN CỦA THẦN LINH 2 - Natsukawa Sosuke & Quỳnh Quỳnh (dịch).epub"
    ];
    await buildMultiVolumeEpubSeries({
      slug: "benh-an-cua-than-linh",
      titleVi: "Bệnh Án Của Thần Linh",
      titleJp: "Kamisama no Karute",
      author: "Natsukawa Sosuke",
      tags: ["Đời thường", "Drama", "Y khoa", "Văn học Nhật Bản"],
      volumes: benhAnNFCs.map((f, idx) => ({
        fileNFC: f,
        volumeName: `Tập 0${idx + 1}`,
        label: `Tập 0${idx + 1}`,
        title: `Bệnh Án Của Thần Linh ${idx + 1}`
      }))
    });
  }

  // 8. Hanzawa Naoki (2 EPUBs)
  {
    await buildMultiVolumeEpubSeries({
      slug: "hanzawa-naoki",
      titleVi: "Hanzawa Naoki",
      author: "Ikeido Jun",
      tags: ["Drama", "Trinh thám", "Thương trường", "Văn học Nhật Bản"],
      volumes: [
        { fileNFC: "Hanzawa Naoki 1.epub", volumeName: "Tập 01", label: "Tập 01", title: "Hanzawa Naoki 1" },
        { fileNFC: "Hanzawa Naoki 2.epub", volumeName: "Tập 02", label: "Tập 02", title: "Hanzawa Naoki 2" }
      ]
    });
  }

  // 9. Nhà Trọ Chim Hoàng Yến (2 EPUBs)
  {
    const nhaTroNFCs = [...byNFC.keys()].filter((k) => k.startsWith("Nhà Trọ Chim Hoàng Yến")).sort();
    await buildMultiVolumeEpubSeries({
      slug: "nha-tro-chim-hoang-yen",
      titleVi: "Nhà Trọ Chim Hoàng Yến",
      author: "Saki Murayama",
      tags: ["Đời thường", "Chữa lành", "Văn học Nhật Bản"],
      volumes: [
        {
          fileNFC: nhaTroNFCs[0],
          volumeName: "Tập 01",
          label: "Tập 01",
          title: "Bầy Chim Nơi Khu Vườn Hoang Phế"
        },
        {
          fileNFC: nhaTroNFCs[1],
          volumeName: "Tập 02",
          label: "Tập 02",
          title: "Đôi Cánh Hướng Tới Những Vì Sao"
        }
      ]
    });
  }

  // 10. Điềm Tĩnh Và Nồng Nhiệt (2 EPUBs)
  {
    await buildMultiVolumeEpubSeries({
      slug: "diem-tinh-va-nong-nhiet",
      titleVi: "Điềm Tĩnh Và Nồng Nhiệt",
      titleJp: "Reisei toounetsu no Aida",
      author: "Ekuni Kaori, Tsuji Hitonari",
      tags: ["Romance", "Drama", "Văn học Nhật Bản"],
      volumes: [
        {
          fileNFC: "Điềm Tĩnh Và Nồng Nhiệt ~ Đỏ - Ekuni Kaori.epub",
          volumeName: "Tập 01",
          label: "Bản Đỏ",
          title: "Điềm Tĩnh Và Nồng Nhiệt ~ Đỏ (Ekuni Kaori)"
        },
        {
          fileNFC: "Điềm Tĩnh Và Nồng Nhiệt ~ Lam - Tsuji Hitonari.epub",
          volumeName: "Tập 02",
          label: "Bản Lam",
          title: "Điềm Tĩnh Và Nồng Nhiệt ~ Lam (Tsuji Hitonari)"
        }
      ]
    });
  }

  // 11. Giữa Lúc Tận Cùng Cô Đơn (2 EPUBs)
  {
    await buildMultiVolumeEpubSeries({
      slug: "giua-luc-tan-cung-co-don",
      titleVi: "Giữa Lúc Tận Cùng Cô Đơn",
      author: "Koto Takimori",
      tags: ["Đời thường", "Chữa lành", "Drama", "Văn học Nhật Bản"],
      volumes: [
        {
          fileNFC: "Giữa Lúc Tận Cùng Cô Đơn, Chú Chó Đã Chỉ Cho Tôi Những Điều Quý Giá! - Koto Takimori.epub",
          volumeName: "Tập 01",
          label: "Tập 01",
          title: "Chú Chó Đã Chỉ Cho Tôi Những Điều Quý Giá!"
        },
        {
          fileNFC: "Giữa Lúc Tận Cùng Cô Đơn, Chú Mèo Đã Chỉ Cho Tôi Những Điều Quý Giá! - Koto Takimori.epub",
          volumeName: "Tập 02",
          label: "Tập 02",
          title: "Chú Mèo Đã Chỉ Cho Tôi Những Điều Quý Giá!"
        }
      ]
    });
  }

  // 12. Nhắn Gửi Tất Cả Các Em / Một Tôi (2 EPUBs)
  {
    await buildMultiVolumeEpubSeries({
      slug: "nhan-gui-nguoi-toi-da-yeu",
      titleVi: "Nhắn Gửi Người Tôi Đã Yêu",
      titleJp: "Boku ga Aishita Subete no Kimi e / Kimi wo Aishita Hitori no Boku e",
      author: "Otono Yomoji",
      tags: ["Romance", "Sci-Fi", "Drama", "Light Novel"],
      volumes: [
        {
          fileNFC: "Nhắn Gửi Tất Cả Các Em, Những Người Tôi Đã Yêu - Otono Yomoji.epub",
          volumeName: "Tập 01",
          label: "Tập 01",
          title: "Nhắn Gửi Tất Cả Các Em, Những Người Tôi Đã Yêu"
        },
        {
          fileNFC: "Nhắn gửi một tôi, người đã yêu em - Otono Yomoji.epub",
          volumeName: "Tập 02",
          label: "Tập 02",
          title: "Nhắn Gửi Một Tôi, Người Đã Yêu Em"
        }
      ]
    });
  }

  // 13. All remaining standalone EPUBs (53 books)
  const standaloneNFCs = [...byNFC.keys()]
    .filter((k) => k.endsWith(".epub") && !usedNFC.has(k))
    .sort((a, b) => a.localeCompare(b, "vi"));

  console.log(`\n📖 Processing ${standaloneNFCs.length} standalone novels...`);
  const usedSlugs = new Set(newSeriesConfigs.map((c) => c.slug));

  for (const fileNFC of standaloneNFCs) {
    const fullPath = byNFC.get(fileNFC);
    const baseNoExt = fileNFC.replace(/\.epub$/i, "").replace(/_\d+$/, "").trim();
    const dashParts = baseNoExt.split(/\s+[-–—]\s+/);
    const fileTitlePart = dashParts[0].trim();
    const fileAuthorPart = dashParts.length > 1 ? dashParts.slice(1).join(" - ").trim() : "";

    // Temp parse to get clean OPF title/author
    const buf = fs.readFileSync(fullPath);
    let tempSlug = slugify(fileTitlePart);
    if (usedSlugs.has(tempSlug)) tempSlug = `${tempSlug}-2`;
    usedSlugs.add(tempSlug);

    const seriesOutDir = path.join(OUTPUT_ROOT, tempSlug);
    ensureDir(seriesOutDir);

    const parsed = await parseEpubVolume(buf, "Tập 1", seriesOutDir, fileAuthorPart);
    const titleVi = parsed.opfTitle || toTitleCaseIfAllCaps(fileTitlePart);

    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify([parsed.volumeData], null, 2), "utf8");
    newSeriesConfigs.push({
      slug: tempSlug,
      source: `output/${tempSlug}`,
      titleVi,
      volumeTitles: {
        Tập_1: {
          label: "Trọn bộ",
          title: titleVi
        }
      },
      titleJp: "",
      author: parsed.author,
      illustrator: "",
      status: "Hoàn thành",
      description: parsed.description || `${titleVi} — tác phẩm văn học Nhật Bản của ${parsed.author}.`,
      tags: ["Văn học Nhật Bản", "Tiểu thuyết"]
    });
  }

  // Preserve the original 3 series in series.json and append the 65 new ones
  const existingSeries = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8")).slice(0, 3);
  const combinedSeries = [...existingSeries, ...newSeriesConfigs];
  fs.writeFileSync(SERIES_JSON_PATH, `${JSON.stringify(combinedSeries, null, 2)}\n`, "utf8");

  console.log(`\n🎉 Done! Added ${newSeriesConfigs.length} new series entries to series.json (total: ${combinedSeries.length} series).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
