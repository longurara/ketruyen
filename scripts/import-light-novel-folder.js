const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const LN_ROOT = "C:\\Users\\Hikari\\Downloads\\Compressed\\collection\\Light_novel";
const DL_DIR = path.join(LN_ROOT, "downloads");
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

function resolveHref(base, href) {
  if (!href) return "";
  const clean = href.split("#")[0];
  if (!clean) return base;
  const dir = path.posix.dirname(base);
  return dir === "." ? clean : path.posix.join(dir, clean);
}

async function saveWebpImage(buf, destPath) {
  if (fs.existsSync(destPath)) return true;
  if (!buf || buf.length < 500) return false;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height || meta.width < 80 || meta.height < 80) return false;
    await sharp(buf)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(destPath);
    return true;
  } catch {
    return false;
  }
}

function escapeXml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapTextLines(text, maxCharsPerLine = 20, maxLines = 5) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (test.length <= maxCharsPerLine || !current) {
      current = test;
    } else {
      lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    const consumedWords = lines.join(" ").split(/\s+/).filter(Boolean).length + current.split(/\s+/).filter(Boolean).length;
    if (consumedWords < words.length) {
      const rest = words.slice(lines.join(" ").split(/\s+/).filter(Boolean).length).join(" ");
      lines.push(rest.length > maxCharsPerLine + 4 ? `${rest.slice(0, maxCharsPerLine + 1).replace(/\s+\S*$/, "")}…` : rest);
    } else {
      lines.push(current);
    }
  }
  return lines;
}

const ANILIST_QUERY_OVERRIDES = {
  "Berserker of Gluttony": "Boushoku no Berserk",
  "Kami-sama no Memochou": "Kamisama no Memochou",
  "Akuyaku Reijo Ni Koi Wo Shite": "Akuyaku Reijou ni Koi wo Shite",
  "Kenkyo, Kenjitsu o Motto ni Ikite Orimasu": "Kenkyo Kenjitsu wo Motto ni Ikite Orimasu",
  "Bí mật của Phù Thủy Tĩnh Lặng": "Silent Witch Chinmoku no Majo no Kakushigoto",
  "Làm Lại Cuộc Đời~ Sau khi bị cắm sừng và vu oan, tôi trở nên thân thiết với nữ thần xinh đẹp nhất trường": "Osananajimi no Kanojo ni Uragirareta Ore",
  "Cô Gái Người Anh Xinh Đẹp Được Mệnh Danh là Đóa Hoa Cô Độc, Muốn Được Nuông Chiều Sau Khi Trở Thành Em Kế Của Tôi": "Kokou no Hana to Yobareru Eikoku Bishoujo",
  "Học Viện Cô Dâu Dành Cho Vị Anh Hùng Cuối Cùng": "Saigo no Yuusha no Hanayome Gakuen"
};

const coverCache = new Map();

async function fetchAnilistCoverBuffer(title) {
  const q = ANILIST_QUERY_OVERRIDES[title] || title.replace(/[-_~]+/g, " ").trim();
  if (coverCache.has(q)) return coverCache.get(q);

  // Only query AniList if the title looks like a Japanese/English/Korean LN or is in overrides
  const gql = `
    query ($search: String) {
      Media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
        coverImage { extraLarge large }
      }
    }
  `;
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: gql, variables: { search: q } })
    });
    if (res.ok) {
      const json = await res.json();
      const imgUrl = json?.data?.Media?.coverImage?.extraLarge || json?.data?.Media?.coverImage?.large;
      if (imgUrl) {
        const imgRes = await fetch(imgUrl);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          if (buf.length > 1000) {
            coverCache.set(q, buf);
            return buf;
          }
        }
      }
    }
  } catch {
    // ignore network failure and fall back to stylized SVG cover
  }
  coverCache.set(q, null);
  return null;
}

const PALETTES = [
  ["#1a1f3c", "#2d3561", "#f3a683"],
  ["#1e272e", "#3c40c6", "#ffd32a"],
  ["#2c2c54", "#474787", "#ffb142"],
  ["#0c2461", "#1e3799", "#82ccdd"],
  ["#3d1e6d", "#88304e", "#f7d794"],
  ["#133b5c", "#1e5f74", "#fcdab7"],
  ["#2b2e4a", "#53354a", "#e84545"],
  ["#1b262c", "#0f4c75", "#bbe1fa"]
];

async function generateStylizedCoverWebp(title, author, destPath) {
  if (fs.existsSync(destPath)) return true;
  const hash = crypto.createHash("md5").update(title).digest();
  const [c1, c2, accent] = PALETTES[hash[0] % PALETTES.length];
  const lines = wrapTextLines(title, 18, 5);
  const authorLine = (author || "Light Novel").slice(0, 36);

  const startY = 440 - (lines.length - 1) * 42;
  const titleTspans = lines
    .map((line, idx) => `<tspan x="400" y="${startY + idx * 84}">${escapeXml(line)}</tspan>`)
    .join("");

  const svg = `<svg width="800" height="1200" viewBox="0 0 800 1200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="800" height="1200" fill="url(#bg)"/>
    <circle cx="680" cy="180" r="240" fill="${accent}" fill-opacity="0.08"/>
    <circle cx="120" cy="1020" r="280" fill="${accent}" fill-opacity="0.07"/>
    <rect x="44" y="44" width="712" height="1112" rx="16" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="3"/>
    <rect x="60" y="60" width="680" height="1080" rx="10" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1.5"/>
    <rect x="270" y="130" width="260" height="44" rx="22" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-opacity="0.6" stroke-width="1.5"/>
    <text x="400" y="159" text-anchor="middle" fill="${accent}" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="3">LIGHT NOVEL</text>
    <text text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="700">${titleTspans}</text>
    <line x1="260" y1="920" x2="540" y2="920" stroke="${accent}" stroke-opacity="0.6" stroke-width="2"/>
    <text x="400" y="985" text-anchor="middle" fill="#e2e8f0" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="500">${escapeXml(authorLine)}</text>
  </svg>`;

  await sharp(Buffer.from(svg)).webp({ quality: 86 }).toFile(destPath);
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

function extractBlocksFromHtml(html, basePath = "") {
  let body = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Remove epub-gen author line and hidden duplicate chapter title paragraph
    .replace(/<p\b[^>]*class=["'][^"']*epub-author[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, "")
    .replace(/<p\b[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, "")
    // Remove Hako promotional banner links
    .replace(/<a\b[^>]*href=["']\/truyen\/[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");

  const imgSrcs = [];
  for (const m of body.matchAll(/<(?:img|image)\b([^>]*?)>/gi)) {
    const attrs = m[1];
    if (/\balt=["']image-placeholder["']/i.test(attrs)) continue;
    const hrefMatch = attrs.match(/\b(?:src|xlink:href|href)=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const rawHref = hrefMatch[1];
    const resolved = basePath ? resolveHref(basePath, decodeURIComponent(rawHref)) : rawHref;
    if (resolved && !imgSrcs.includes(resolved)) imgSrcs.push(resolved);
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

function cleanChapterTitle(rawTitle, volumeStem = "") {
  let t = decodeHtmlEntities(rawTitle || "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (volumeStem) {
    const cleanVol = volumeStem.normalize("NFC").replace(/\s+/g, " ").trim();
    // Strip exact "<volumeStem> - " prefix (case-insensitive)
    const esc = cleanVol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${esc}\\s*[-–—:]\\s*`, "i");
    if (re.test(t)) {
      const stripped = t.replace(re, "").trim();
      if (stripped) t = stripped;
    }
  }
  // Also strip generic "Tập X - " or "Web Novel * - " if redundant
  t = t.replace(/^Web\s*Novel\s*\*?\s*[-–—:]\s*/i, "").trim();
  return t;
}

function buildDescriptionFromChapters(titleVi, author, volumes) {
  for (const vol of volumes) {
    for (const ch of vol.chapters) {
      if (ch.isIllustration || !ch.content) continue;
      const paras = ch.content
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(
          (p) =>
            p.length > 45 &&
            !p.startsWith("---") &&
            !p.startsWith("[") &&
            !/(?:Trans\s*Note|Người\s*dịch|Biên\s*tập|Nguồn\s*:)/i.test(p)
        );
      const candidate = paras.slice(0, 2).join(" ");
      if (candidate.length >= 60) {
        return candidate.length > 360 ? `${candidate.slice(0, 357).replace(/\s+\S*$/, "")}…` : candidate;
      }
    }
  }
  return `${titleVi} — tiểu thuyết Light Novel của tác giả ${author || "Khuyết danh"}.`;
}

// Build a lookup map of chapter key -> array of valid image buffers from an omnibus EPUB
async function buildOmnibusImageMap(omniPath) {
  const map = new Map();
  if (!omniPath || !fs.existsSync(omniPath)) return map;
  try {
    const buf = fs.readFileSync(omniPath);
    const zip = await JSZip.loadAsync(buf);
    for (const [k, v] of Object.entries(zip.files)) {
      if (v.dir || !/\.x?html?$/i.test(k)) continue;
      const base = path.posix.basename(k);
      if (/^(?:toc|nav)\./i.test(base)) continue;
      const slugKey = base.replace(/^\d+_/, "").toLowerCase();
      const html = await v.async("string");
      const { imgSrcs } = extractBlocksFromHtml(html, k);
      const validBufs = [];
      for (const src of imgSrcs) {
        const entry = zip.file(src);
        if (!entry) continue;
        const b = await entry.async("nodebuffer");
        if (b && b.length > 500) validBufs.push(b);
      }
      if (validBufs.length > 0) {
        map.set(slugKey, validBufs);
      }
    }
  } catch {
    // ignore
  }
  return map;
}

async function parseEpubToVolume(epubPath, volumeName, volumeStem, seriesOutDir, omniImageMap = null) {
  const buf = fs.readFileSync(epubPath);
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

  const manifest = new Map();
  let ncxPath = null;
  let navPath = null;
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
      if (props.includes("nav")) navPath = resolved;
      if ((props.includes("cover-image") || id === "image_cover") && !coverId) coverId = id;
    }
  }

  const tocMap = new Map();
  if (ncxPath && zip.file(ncxPath)) {
    const ncxXml = await zip.file(ncxPath).async("string");
    for (const m of ncxXml.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
      let label = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "")).normalize("NFC").replace(/\s+/g, " ").trim();
      label = label.replace(/^\d+\.\s*/, "");
      const src = resolveHref(ncxPath, decodeURIComponent(m[2]));
      if (label && src && !tocMap.has(src)) tocMap.set(src, label);
    }
  }

  const spine = [...opfXml.matchAll(/<itemref\b[^>]*?\bidref=["']([^"']+)["']/gi)]
    .map((m) => manifest.get(m[1]))
    .filter(Boolean);

  const volDirName = sanitizeName(volumeName);
  const imgDir = path.join(seriesOutDir, volDirName, "images");
  ensureDir(imgDir);

  const savedHashes = new Set();
  const illuFiles = [];

  async function addIlluFromBuffer(bufImg) {
    if (!bufImg || bufImg.length < 500) return false;
    const h = crypto.createHash("sha1").update(bufImg).digest("hex");
    if (savedHashes.has(h)) return true;
    const fileName = `illu_${String(illuFiles.length + 1).padStart(2, "0")}.webp`;
    const ok = await saveWebpImage(bufImg, path.join(imgDir, fileName));
    if (ok) {
      savedHashes.add(h);
      illuFiles.push(fileName);
      return true;
    }
    return false;
  }

  async function getImageBuffersForChapter(itemPath, imgSrcs) {
    const bufs = [];
    let missingCount = 0;
    for (const src of imgSrcs) {
      const entry = zip.file(src);
      if (entry) {
        const b = await entry.async("nodebuffer");
        if (b && b.length > 500) {
          bufs.push(b);
          continue;
        }
      }
      missingCount++;
    }
    if (missingCount > 0 && omniImageMap) {
      const slugKey = path.posix.basename(itemPath).replace(/^\d+_/, "").toLowerCase();
      const fallbackBufs = omniImageMap.get(slugKey);
      if (fallbackBufs && fallbackBufs.length > bufs.length) {
        return fallbackBufs;
      }
    }
    return bufs;
  }

  if (coverId && manifest.get(coverId)?.type.startsWith("image/")) {
    const entry = zip.file(manifest.get(coverId).path);
    if (entry) await addIlluFromBuffer(await entry.async("nodebuffer"));
  }

  const rawChapters = [];
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    const fileEntry = zip.file(item.path);
    if (!fileEntry) continue;
    const baseName = path.posix.basename(item.path).toLowerCase();
    const rawTocLabel = tocMap.get(item.path) || "";
    if (item.path === navPath || /^(?:nav|toc|mucluc)\d*\.x?html?$/i.test(baseName) || /^mục\s*lục$/i.test(rawTocLabel)) {
      continue;
    }

    const html = await fileEntry.async("string");
    const { paragraphs, imgSrcs } = extractBlocksFromHtml(html, item.path);

    let chTitle = cleanChapterTitle(rawTocLabel, volumeStem);
    if (!chTitle) {
      const hMatch = html.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i);
      const hText = hMatch ? cleanChapterTitle(hMatch[1].replace(/<[^>]+>/g, " "), volumeStem) : "";
      chTitle = hText && hText.length <= 140 ? hText : paragraphs[0] && paragraphs[0].length <= 90 ? paragraphs[0] : `Chương ${rawChapters.length + 1}`;
    }

    const bodyParagraphs = stripDuplicateTitleParagraphs(chTitle, paragraphs);
    const joinedText = bodyParagraphs.join(" ").trim();
    const chapterImgBufs = await getImageBuffersForChapter(item.path, imgSrcs);

    if (
      /^(?:minh\s*h[oọ][aạ]|illustrations?|art\s*\d+|minh\s*h[oọ][aạ]\s*tập\s*\d+)$/i.test(chTitle) ||
      (joinedText.length <= 40 && chapterImgBufs.length > 0)
    ) {
      for (const b of chapterImgBufs) await addIlluFromBuffer(b);
      continue;
    }

    if (bodyParagraphs.length === 0 && chapterImgBufs.length === 0) continue;

    rawChapters.push({
      title: chTitle,
      paragraphs: bodyParagraphs.length > 0 ? bodyParagraphs : paragraphs,
      imgBufs: chapterImgBufs
    });
  }

  const finalChapters = [
    {
      title: "Minh họa",
      content: "",
      isIllustration: true,
      images: illuFiles
    }
  ];

  let firstSavedChapterImage = null;

  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i];
    const chIdx = finalChapters.length + 1;
    const prefix = `ch${String(chIdx).padStart(2, "0")}`;
    const chImgFiles = [];
    for (const bufImg of ch.imgBufs) {
      const h = crypto.createHash("sha1").update(bufImg).digest("hex");
      if (savedHashes.has(h)) continue;
      const fileName = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
      const destFile = path.join(imgDir, fileName);
      const ok = await saveWebpImage(bufImg, destFile);
      if (ok) {
        savedHashes.add(h);
        chImgFiles.push(fileName);
        if (!firstSavedChapterImage) firstSavedChapterImage = destFile;
      }
    }

    finalChapters.push({
      title: ch.title,
      content: ch.paragraphs.join("\n\n"),
      isIllustration: false,
      ...(chImgFiles.length > 0 ? { images: chImgFiles } : {})
    });
  }

  // If Minh họa has no images yet, but a chapter had an image, copy the first chapter image to illu_01.webp so cover generation is guaranteed
  if (illuFiles.length === 0 && firstSavedChapterImage && fs.existsSync(firstSavedChapterImage)) {
    const illu01Path = path.join(imgDir, "illu_01.webp");
    fs.copyFileSync(firstSavedChapterImage, illu01Path);
    illuFiles.push("illu_01.webp");
  }

  return {
    opfTitle,
    opfCreator,
    volumeData: {
      volumeName,
      chapters: finalChapters
    }
  };
}

function cleanStem(filename) {
  return filename.replace(/\.epub$/i, "").replace(/\.+$/, "").trim().normalize("NFC");
}

function getSortPriority(stem) {
  const s = stem.toLowerCase();
  if (/^(?:tiền\s*truyện|phần\s*mở\s*đầu|mở\s*đầu|khởi\s*hành|phần\s*đầu|quyển\s*thượng)\b/i.test(s)) {
    return { group: 1, num: 0, sub: s };
  }
  let m = s.match(/^(?:\[ln\]\s*)?(?:tập|tâp|vol\.?|volume|quyển|arc)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (m) {
    return { group: 2, num: parseFloat(m[1]), sub: s };
  }
  m = s.match(/arc\s+(i{1,3}|iv|v|vi{0,3}|ix|x)\b/i);
  if (m) {
    const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    return { group: 2, num: roman[m[1].toLowerCase()] || 99, sub: s };
  }
  m = s.match(/(?:chương\s*|web\s*novel\s*\(\s*)?(\d+)\s*-\s*(\d+)/i);
  if (m) {
    return { group: 2, num: parseInt(m[1], 10), sub: s };
  }
  if (/^(?:bộ\s*truyện\s*chính|phần\s*sau|quyển\s*hạ|thành\s*phố\s*mê\s*cung|in\s*the\s*game)\b/i.test(s)) {
    return { group: 3, num: 0, sub: s };
  }
  if (/another/i.test(s)) {
    const p = s.match(/phần\s*(\d+)/i);
    return { group: 4, num: p ? parseInt(p[1], 10) : 1, sub: s };
  }
  if (/^(?:ngoại\s*truyện|cốt\s*truyện\s*phụ|manga\s*special)/i.test(s)) {
    return { group: 5, num: 0, sub: s };
  }
  if (/^(?:minh\s*ho[ạa]|nhân\s*vật|artist\s*corner)/i.test(s)) {
    return { group: 6, num: 0, sub: s };
  }
  return { group: 3, num: 50, sub: s };
}

function deriveVolumeLabelAndTitle(stem, index, totalVols) {
  const s = stem.normalize("NFC").replace(/\s+/g, " ").trim();

  // "[LN] Vol.1"
  let m = s.match(/^\[LN\]\s*Vol\.?\s*(\d+)$/i);
  if (m) {
    const num = String(m[1]).padStart(2, "0");
    return { volumeName: `Tập ${num}`, label: `Tập ${num}`, title: "" };
  }

  // "Tập X - Subtitle" or "Tập X" or "Tâp X" or "Vol X: Subtitle" or "Volume X- Subtitle" or "Quyển X ~ Subtitle ~"
  m = s.match(/^(?:Tập|Tâp|Vol\.?|Volume|Quyển)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:[-–—:~.]+\s*(.*))?$/i);
  if (m) {
    const rawNum = m[1];
    const num = rawNum.includes(".") ? rawNum : String(parseInt(rawNum, 10)).padStart(2, "0");
    const sub = (m[2] || "").replace(/^[-–—:~\s]+|[-–—:~\s]+$/g, "").trim();
    const isQuyen = /^quyển/i.test(s);
    const label = isQuyen ? `Quyển ${num}` : `Tập ${num}`;
    return { volumeName: label, label, title: sub };
  }

  // "ARC X- Subtitle"
  m = s.match(/^Arc\s*(\d+)\s*(?:[-–—:]+\s*(.*))?$/i);
  if (m) {
    const num = String(parseInt(m[1], 10)).padStart(2, "0");
    const sub = (m[2] || "").replace(/^[-–—:\s]+|[-–—:\s]+$/g, "").trim();
    return { volumeName: `Arc ${num}`, label: `Arc ${num}`, title: sub };
  }

  // "Web Novel - Arc I- Subtitle"
  m = s.match(/^Web\s*Novel\s*[-–—]\s*Arc\s*([IVX]+)\s*[-–—:]\s*(.*)$/i);
  if (m) {
    return { volumeName: `Arc ${m[1]}`, label: `Arc ${m[1]}`, title: m[2].trim() };
  }

  // Chapter ranges: "Chương 1 - 50", "51-100"
  m = s.match(/^(?:Chương\s*)?(\d+)\s*-\s*(\d+)$/i);
  if (m) {
    const label = `Chương ${m[1]}–${m[2]}`;
    return { volumeName: label, label, title: "" };
  }

  // Single volume "Web Novel", "Oneshot", etc.
  if (totalVols === 1) {
    if (/^web\s*novel$/i.test(s)) {
      return { volumeName: "Web Novel", label: "Web Novel", title: "" };
    }
    if (/^oneshot$/i.test(s)) {
      return { volumeName: "Oneshot", label: "Oneshot", title: "" };
    }
    return { volumeName: "Tập 01", label: "Tập 01", title: s };
  }

  // General fallback for named arcs/side stories
  const parts = s.split(/\s*[-–—:]\s*/);
  if (parts.length >= 2 && parts[0].length <= 28) {
    return {
      volumeName: parts[0].trim(),
      label: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim()
    };
  }

  const fallbackVol = `Phần ${String(index + 1).padStart(2, "0")}`;
  return { volumeName: fallbackVol, label: fallbackVol, title: s };
}

async function ensureSeriesCovers(seriesOutDir, metadata, titleVi, author, fallbackImgPath = null) {
  // Check if any volume already has an illu_01.webp
  let existingCoverPath = fallbackImgPath && fs.existsSync(fallbackImgPath) ? fallbackImgPath : null;
  if (!existingCoverPath) {
    for (const vol of metadata) {
      const volDirName = sanitizeName(vol.volumeName);
      const p = path.join(seriesOutDir, volDirName, "images", "illu_01.webp");
      if (fs.existsSync(p)) {
        existingCoverPath = p;
        break;
      }
    }
  }

  // If no volume in the entire series has a cover yet, try AniList first, then stylized SVG cover
  let fetchedBuf = null;
  if (!existingCoverPath) {
    fetchedBuf = await fetchAnilistCoverBuffer(titleVi);
  }

  for (const vol of metadata) {
    const illuChap = vol.chapters.find((c) => c.isIllustration);
    if (!illuChap) continue;
    const volDirName = sanitizeName(vol.volumeName);
    const imgDir = path.join(seriesOutDir, volDirName, "images");
    ensureDir(imgDir);
    const destIllu01 = path.join(imgDir, "illu_01.webp");

    if (illuChap.images.length === 0 || !fs.existsSync(destIllu01)) {
      if (existingCoverPath && fs.existsSync(existingCoverPath)) {
        if (existingCoverPath !== destIllu01) fs.copyFileSync(existingCoverPath, destIllu01);
      } else if (fetchedBuf) {
        const ok = await saveWebpImage(fetchedBuf, destIllu01);
        if (!ok) await generateStylizedCoverWebp(titleVi, author, destIllu01);
        existingCoverPath = destIllu01;
      } else {
        await generateStylizedCoverWebp(titleVi, author, destIllu01);
        existingCoverPath = destIllu01;
      }
      if (!illuChap.images.includes("illu_01.webp")) {
        illuChap.images.unshift("illu_01.webp");
      }
    }
  }
}

async function importHieuThuocODiGioi(seriesMap, usedSlugs) {
  const epubPath = path.join(LN_ROOT, "Hiệu thuốc ở Dị Giới.epub");
  const slug = "hieu-thuoc-o-di-gioi";
  usedSlugs.add(slug);
  const seriesOutDir = path.join(OUTPUT_ROOT, slug);
  ensureDir(seriesOutDir);

  const buf = fs.readFileSync(epubPath);
  const zip = await JSZip.loadAsync(buf);
  const opfXml = await zip.file("OEBPS/content.opf").async("string");
  const ncxXml = await zip.file("OEBPS/toc.ncx").async("string");

  const manifest = new Map();
  for (const m of opfXml.matchAll(/<item\b([^>]+?)\/?>/gi)) {
    const attrs = m[1];
    const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (id && href) manifest.set(id, `OEBPS/${decodeURIComponent(href)}`);
  }

  const tocMap = new Map();
  for (const m of ncxXml.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*?\bsrc=["']([^"']+)["']/gi)) {
    const label = decodeHtmlEntities(m[1]).replace(/^\d+\.\s*/, "").trim();
    const src = `OEBPS/${decodeURIComponent(m[2])}`;
    tocMap.set(src, label);
  }

  const coverBuf = zip.file("OEBPS/cover.jpeg") ? await zip.file("OEBPS/cover.jpeg").async("nodebuffer") : null;
  const spine = [...opfXml.matchAll(/<itemref\b[^>]*?\bidref=["']([^"']+)["']/gi)]
    .map((m) => manifest.get(m[1]))
    .filter(Boolean);

  const volGroups = new Map();
  for (const itemPath of spine) {
    if (/toc\.xhtml$/i.test(itemPath)) continue;
    const rawLabel = tocMap.get(itemPath) || "";
    const html = await zip.file(itemPath).async("string");
    const { paragraphs, imgSrcs } = extractBlocksFromHtml(html, itemPath);

    const m = rawLabel.match(/^Vol\s*(\d+)\s*:\s*(.*?)\s*-\s*(Chương\s*\d+[\s\S]*)$/i);
    const volNum = m ? String(m[1]).padStart(2, "0") : "04";
    const volSub = m ? m[2].trim() : "";
    const chTitle = m ? m[3].trim() : rawLabel || `Chương`;
    const volKey = `Tập ${volNum}`;

    if (!volGroups.has(volKey)) {
      volGroups.set(volKey, { volumeName: volKey, subtitle: volSub, rawChapters: [] });
    }
    const bodyParagraphs = stripDuplicateTitleParagraphs(chTitle, paragraphs);
    const imgBufs = [];
    for (const src of imgSrcs) {
      const e = zip.file(src);
      if (!e) continue;
      const b = await e.async("nodebuffer");
      if (b && b.length > 500) imgBufs.push(b);
    }
    volGroups.get(volKey).rawChapters.push({
      title: chTitle,
      paragraphs: bodyParagraphs.length > 0 ? bodyParagraphs : paragraphs,
      imgBufs
    });
  }

  const metadata = [];
  const volumeTitles = {};
  for (const [volName, group] of volGroups.entries()) {
    const volDirName = sanitizeName(volName);
    const imgDir = path.join(seriesOutDir, volDirName, "images");
    ensureDir(imgDir);

    const illuFiles = [];
    if (coverBuf) {
      const ok = await saveWebpImage(coverBuf, path.join(imgDir, "illu_01.webp"));
      if (ok) illuFiles.push("illu_01.webp");
    }

    const finalChapters = [
      { title: "Minh họa", content: "", isIllustration: true, images: illuFiles }
    ];

    const savedHashes = new Set();
    for (const ch of group.rawChapters) {
      const chIdx = finalChapters.length + 1;
      const prefix = `ch${String(chIdx).padStart(2, "0")}`;
      const chImgFiles = [];
      for (const b of ch.imgBufs) {
        const h = crypto.createHash("sha1").update(b).digest("hex");
        if (savedHashes.has(h)) continue;
        const fName = `${prefix}_${String(chImgFiles.length + 1).padStart(2, "0")}.webp`;
        if (await saveWebpImage(b, path.join(imgDir, fName))) {
          savedHashes.add(h);
          chImgFiles.push(fName);
        }
      }
      finalChapters.push({
        title: ch.title,
        content: ch.paragraphs.join("\n\n"),
        isIllustration: false,
        ...(chImgFiles.length > 0 ? { images: chImgFiles } : {})
      });
    }

    metadata.push({ volumeName: volName, chapters: finalChapters });
    volumeTitles[volDirName] = { label: volName, title: group.subtitle };
  }

  fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  seriesMap.set(slug, {
    slug,
    source: `output/${slug}`,
    titleVi: "Hiệu Thuốc Ở Dị Giới",
    volumeTitles,
    titleJp: "Isekai Yakkyoku (異世界薬局)",
    author: "Takayama Liz",
    illustrator: "Keepout",
    status: "Đang cập nhật",
    description: buildDescriptionFromChapters("Hiệu Thuốc Ở Dị Giới", "Takayama Liz", metadata),
    tags: ["Isekai", "Fantasy", "Y khoa", "Đời thường", "Light Novel"]
  });
  console.log(`✔ Built series: Hiệu Thuốc Ở Dị Giới (${metadata.length} volumes)`);
}

async function updateHighSchoolDxD(seriesMap) {
  const existing = seriesMap.get("high-school-dxd");
  if (!existing) return;
  const seriesOutDir = path.join(ROOT_DIR, existing.source);
  const metadataPath = path.join(seriesOutDir, "metadata.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const existingVolNames = new Set(metadata.map((v) => v.volumeName));
  const fallbackCover = path.join(seriesOutDir, "Tập_01", "images", "illu_01.webp");

  const dxdDir = path.join(DL_DIR, "High School DxD");
  const newVolSpecs = [
    { file: "Tập 23 – Giải đấu bóng của Joker.epub", volumeName: "Tập 23", label: "Tập 23", title: "Giải đấu bóng của Joker" },
    { file: "Tập 24 – Buổi học ngoài trường của Tử Thần.epub", volumeName: "Tập 24", label: "Tập 24", title: "Buổi học ngoài trường của Tử Thần" },
    { file: "Tập 25 - Khóa học hè của Yggdrasil.epub", volumeName: "Tập 25", label: "Tập 25", title: "Khóa học hè của Yggdrasil" },
    { file: "Shin Tập 1 - Học kỳ mới của Welsh Dragon.epub", volumeName: "Shin Tập 01", label: "Shin Tập 01", title: "Học kỳ mới của Welsh Dragon" },
    { file: "Shin Tập 2 - Bài kiểm tra năng lực của Ruin Princess.epub", volumeName: "Shin Tập 02", label: "Shin Tập 02", title: "Bài kiểm tra năng lực của Ruin Princess" },
    { file: "Shin Tập 3 - Mưa bóng mây trong chuyến tham quan của trường.epub", volumeName: "Shin Tập 03", label: "Shin Tập 03", title: "Mưa bóng mây trong chuyến tham quan của trường" },
    { file: "Shin Tập 4 - Vương quốc của trận quyết chiến du học.epub", volumeName: "Shin Tập 04", label: "Shin Tập 04", title: "Vương quốc của trận quyết chiến du học" },
    { file: "High School DxD EX.epub", volumeName: "High School DxD EX", label: "Ngoại truyện EX", title: "High School DxD EX" },
    { file: "High School DxD Zero.epub", volumeName: "High School DxD Zero", label: "Ngoại truyện Zero", title: "High School DxD Zero" }
  ];

  const omniMap = await buildOmnibusImageMap(path.join(dxdDir, "High School DxD.epub"));
  let addedCount = 0;

  for (const spec of newVolSpecs) {
    if (existingVolNames.has(spec.volumeName)) continue;
    const epubPath = path.join(dxdDir, spec.file);
    if (!fs.existsSync(epubPath)) continue;
    const stem = cleanStem(spec.file);
    const parsed = await parseEpubToVolume(epubPath, spec.volumeName, stem, seriesOutDir, omniMap);
    metadata.push(parsed.volumeData);
    existing.volumeTitles = existing.volumeTitles || {};
    existing.volumeTitles[sanitizeName(spec.volumeName)] = {
      label: spec.label,
      title: spec.title
    };
    addedCount++;
  }

  await ensureSeriesCovers(seriesOutDir, metadata, existing.titleVi, existing.author, fallbackCover);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  console.log(`✔ Updated series: High School DxD (+${addedCount} new volumes, total ${metadata.length} volumes)`);
}

function cleanDisplayTitle(folderName, opfTitle, firstVolStem = "") {
  if (folderName.includes("Hanbun no Tsuki ga Noboru Sora")) {
    return "Hanbun no Tsuki ga Noboru Sora (Nửa Vầng Trăng Lên)";
  }
  let t = (opfTitle || folderName || "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (firstVolStem) {
    const cleanVol = firstVolStem.normalize("NFC").replace(/\s+/g, " ").trim();
    const idx = t.toLowerCase().lastIndexOf(` - ${cleanVol.toLowerCase()}`);
    if (idx > 0) {
      t = t.slice(0, idx).trim();
    }
  }
  // Also strip any trailing " - <Volume/Arc/Web Novel/Chapter pattern>" that came from volume 1's dc:title
  t = t
    .replace(
      /\s+-\s+(?:\[LN\]\s*Vol\.?\s*\d+|(?:Tập|Tâp|Vol\.?|Volume|Quyển|Arc|Phần)\s*[\dIVX]+.*|Web\s*Novel.*|Oneshot|Chương\s*\d+.*|\d+\s*-\s*\d+|Bộ\s*truyện\s*chính|Tiền\s*truyện.*)$/i,
      ""
    )
    .trim();
  if (t.includes(" - ")) {
    const [a, b] = t.split(/\s+-\s+/);
    if (a && b && a.toLowerCase() === b.toLowerCase()) t = a.trim();
  }
  // If opfTitle still has a volume suffix that wasn't in folderName, prefer cleaned folderName
  const cleanFolder = folderName
    .normalize("NFC")
    .replace(/_/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > cleanFolder.length + 4 && t.toLowerCase().startsWith(cleanFolder.slice(0, 12).toLowerCase())) {
    if (!/[?"]/.test(t) || !cleanFolder.endsWith("-")) {
      return t.split(/\s+-\s+/)[0].trim();
    }
  }
  return t || cleanFolder;
}

async function main() {
  console.log("🚀 Importing all Light Novel series from C:\\Users\\Hikari\\Downloads\\Compressed\\collection\\Light_novel...\n");

  const existingList = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesMap = new Map();
  const usedSlugs = new Set();
  for (const s of existingList) {
    seriesMap.set(s.slug, s);
    usedSlugs.add(s.slug);
  }

  // 1. Top-level: Hiệu thuốc ở Dị Giới.epub (4 volumes: Vol 4..7)
  await importHieuThuocODiGioi(seriesMap, usedSlugs);

  // 2. Top-level: Overlord.epub
  {
    const epubPath = path.join(LN_ROOT, "Overlord.epub");
    const slug = "overlord";
    usedSlugs.add(slug);
    const seriesOutDir = path.join(OUTPUT_ROOT, slug);
    ensureDir(seriesOutDir);
    const parsed = await parseEpubToVolume(epubPath, "Tập 01", "Tập 1 - The Undead King", seriesOutDir);
    await ensureSeriesCovers(seriesOutDir, [parsed.volumeData], "Overlord", "Maruyama Kugane");
    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify([parsed.volumeData], null, 2), "utf8");
    seriesMap.set(slug, {
      slug,
      source: `output/${slug}`,
      titleVi: "Overlord",
      volumeTitles: {
        Tập_01: { label: "Tập 01", title: "The Undead King (Vua Bất Tử)" }
      },
      titleJp: "Overlord (オーバーロード)",
      author: "Maruyama Kugane",
      illustrator: "so-bin",
      status: "Đang cập nhật",
      description: buildDescriptionFromChapters("Overlord", "Maruyama Kugane", [parsed.volumeData]),
      tags: ["Isekai", "Fantasy", "Dark Fantasy", "Action", "Adventure", "Light Novel"]
    });
    console.log("✔ Built series: Overlord (1 volume)");
  }

  // 3. Top-level: Sự trở lại của anh hùng yếu nhất.epub
  {
    const epubPath = path.join(LN_ROOT, "Sự trở lại của anh hùng yếu nhất.epub");
    const slug = "su-tro-lai-cua-anh-hung-yeu-nhat";
    usedSlugs.add(slug);
    const seriesOutDir = path.join(OUTPUT_ROOT, slug);
    ensureDir(seriesOutDir);
    const parsed = await parseEpubToVolume(epubPath, "Web Novel", "Web Novel *", seriesOutDir);
    await ensureSeriesCovers(seriesOutDir, [parsed.volumeData], "Sự Trở Lại Của Anh Hùng Yếu Nhất", parsed.opfCreator);
    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify([parsed.volumeData], null, 2), "utf8");
    seriesMap.set(slug, {
      slug,
      source: `output/${slug}`,
      titleVi: "Sự Trở Lại Của Anh Hùng Yếu Nhất",
      volumeTitles: {
        Web_Novel: { label: "Web Novel", title: "Sự Trở Lại Của Anh Hùng Yếu Nhất" }
      },
      titleJp: "",
      author: parsed.opfCreator || "나비계곡",
      illustrator: "",
      status: "Đang cập nhật",
      description: buildDescriptionFromChapters("Sự Trở Lại Của Anh Hùng Yếu Nhất", parsed.opfCreator, [parsed.volumeData]),
      tags: ["Fantasy", "Action", "Adventure", "Web Novel", "Light Novel"]
    });
    console.log("✔ Built series: Sự Trở Lại Của Anh Hùng Yếu Nhất (1 volume)");
  }

  // 4. Update existing High School DxD with new volumes from downloads/High School DxD
  await updateHighSchoolDxD(seriesMap);

  // 5. Process all folders in downloads/
  const dlFolders = fs
    .readdirSync(DL_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_batch_reports")
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, "vi"));

  for (const folderName of dlFolders) {
    // Skip exact duplicate folder with trailing underscore, High School DxD (already updated), and Hachinan WN (merged into Hachi-nan)
    if (
      folderName.endsWith("Seiyuu no Onna no Ko ni Kubi wo Shimerareteiru_") ||
      folderName === "High School DxD" ||
      folderName === "Hachinan tte, Sore wa Nai Deshou!"
    ) {
      continue;
    }

    const dir = path.join(DL_DIR, folderName);
    const rawFiles = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".epub"));
    if (rawFiles.length === 0) continue;

    const omniName = `${folderName.normalize("NFC").toLowerCase()}.epub`;
    let omniFile = null;
    const byCleanStem = new Map();

    for (const rf of rawFiles) {
      if (rf.normalize("NFC").toLowerCase() === omniName) {
        omniFile = rf;
        continue;
      }
      const st = cleanStem(rf);
      if (!byCleanStem.has(st) || !rf.endsWith("..epub")) {
        byCleanStem.set(st, path.join(dir, rf));
      }
    }

    // If folder only has the omnibus file (e.g. "Búp bê cầu nắng"), use it as the single volume
    if (byCleanStem.size === 0 && omniFile) {
      byCleanStem.set(cleanStem(omniFile), path.join(dir, omniFile));
    }

    const omniPath = omniFile ? path.join(dir, omniFile) : null;
    const omniMap = await buildOmnibusImageMap(omniPath);

    // Special merge: include Web Novel from "Hachinan tte, Sore wa Nai Deshou!" into "Hachi-nan tte, Sore wa Nai deshou!"
    let extraWnOmniMap = null;
    if (folderName === "Hachi-nan tte, Sore wa Nai deshou!") {
      const wnDir = path.join(DL_DIR, "Hachinan tte, Sore wa Nai Deshou!");
      const wnFile = path.join(wnDir, "Web Novel.epub");
      const wnOmni = path.join(wnDir, "Hachinan tte, Sore wa Nai Deshou!.epub");
      if (fs.existsSync(wnFile)) {
        byCleanStem.set("Web Novel", wnFile);
        extraWnOmniMap = await buildOmnibusImageMap(wnOmni);
      }
    }

    const volEntries = [...byCleanStem.entries()]
      .map(([stem, fullPath]) => ({ stem, fullPath, prio: getSortPriority(stem) }))
      .sort((a, b) => {
        if (a.prio.group !== b.prio.group) return a.prio.group - b.prio.group;
        if (a.prio.num !== b.prio.num) return a.prio.num - b.prio.num;
        return a.stem.localeCompare(b.stem, "vi", { numeric: true, sensitivity: "base" });
      });

    let slug = slugify(folderName);
    if (!slug) slug = `ln-${crypto.createHash("md5").update(folderName).digest("hex").slice(0, 8)}`;

    const seriesOutDir = path.join(OUTPUT_ROOT, slug);
    ensureDir(seriesOutDir);

    const metadata = [];
    const volumeTitles = {};
    const usedVolNames = new Set();
    let seriesTitle = "";
    let seriesAuthor = "";

    for (let i = 0; i < volEntries.length; i++) {
      const entry = volEntries[i];
      const info = deriveVolumeLabelAndTitle(entry.stem, i, volEntries.length);
      let volName = info.volumeName;
      if (usedVolNames.has(volName)) {
        volName = `${volName} (${i + 1})`;
      }
      usedVolNames.add(volName);

      const activeOmniMap =
        entry.stem === "Web Novel" && extraWnOmniMap ? extraWnOmniMap : omniMap;

      const parsed = await parseEpubToVolume(
        entry.fullPath,
        volName,
        entry.stem,
        seriesOutDir,
        activeOmniMap
      );

      if (!seriesTitle && parsed.opfTitle) seriesTitle = parsed.opfTitle;
      if (!seriesAuthor && parsed.opfCreator) seriesAuthor = parsed.opfCreator;

      metadata.push(parsed.volumeData);
      volumeTitles[sanitizeName(volName)] = {
        label: info.label,
        title: info.title
      };
    }

    const displayTitle = cleanDisplayTitle(folderName, seriesTitle, volEntries[0]?.stem || "");
    const displayAuthor = seriesAuthor || "Khuyết danh";

    await ensureSeriesCovers(seriesOutDir, metadata, displayTitle, displayAuthor);
    fs.writeFileSync(path.join(seriesOutDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

    seriesMap.set(slug, {
      slug,
      source: `output/${slug}`,
      titleVi: displayTitle,
      volumeTitles,
      titleJp: "",
      author: displayAuthor,
      illustrator: "",
      status: "Đang cập nhật",
      description: buildDescriptionFromChapters(displayTitle, displayAuthor, metadata),
      tags: ["Light Novel", "Fantasy"]
    });

    console.log(`✔ Built series: ${displayTitle} (${metadata.length} volumes)`);
  }

  const finalSeries = [...seriesMap.values()];
  fs.writeFileSync(SERIES_JSON_PATH, `${JSON.stringify(finalSeries, null, 2)}\n`, "utf8");
  console.log(`\n🎉 Done! series.json now has ${finalSeries.length} series.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
