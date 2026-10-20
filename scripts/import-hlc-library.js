const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const JSZip = require("../public/vendor/jszip.min.js");

const COMPLETED_DIR = "E:\\lightnovel\\02_Da_Hoan_Thanh";
const MULTIVOL_DIR = "E:\\lightnovel\\03_Truyen_Nhieu_Tap";
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const PUBLIC_IMG_ROOT = path.join(PUBLIC_DIR, "img");
const SERIES_JSON_PATH = path.join(ROOT_DIR, "series.json");
const REF1_PATH = "C:\\Users\\Hikari\\.gemini\\antigravity\\brain\\bd6703b6-3219-4db4-9b25-7ce277a8d619\\.user_uploaded\\media_1792505911717_2ef111de.png";

const READER_WIDTH = 1600;
const COVER_WIDTH = 520;

const ALLOWED_ANIME_DOMAINS = [
  "bookwalker.jp",
  "myanimelist.net",
  "anilist.co",
  "mangadex.org",
  "novelupdates.com",
  "dengekionline.com",
  "kadokawa.co.jp",
  "kimirano.jp",
  "fantasiabunko.jp",
  "sneakerbunko.jp",
  "gagagabunko.jp",
  "ga.sbcr.jp",
  "over-lap.co.jp",
  "hjbunko.com",
  "ichijinsha.co.jp",
  "alphapolis.co.jp",
  "tobooks.jp",
  "natalie.mu",
  "ln-news.com",
  "melonbooks.co.jp",
  "animate-onlineshop.jp",
  "gamers.co.jp",
  "cmoa.jp",
  "pximg.net",
  "pinimg.com",
  "twimg.com",
  "zerochan.net",
  "safebooru.org",
  "wallhaven.cc",
  "alphacoders.com",
  "konachan.net",
  "yande.re",
  "danbooru.donmai.us",
  "myfigurecollection.net",
  "static.wikia.nocookie.net",
  "media.tumblr.com",
  "cloudfront.net"
];

const KEYWORD_MAP = [
  [/bạn thuở nhỏ|thanh mai trúc mã|thời thơ ấu/i, "幼馴染 美少女 制服 ラブコメ"],
  [/hôn thê|vị hôn thê|hôn ước/i, "許嫁 婚約者 お嬢様 ラブコメ"],
  [/tsundere/i, "ツンデレ 美少女 制服 ラブコメ"],
  [/yandere/i, "ヤンデレ 美少女 イラスト"],
  [/ác nữ|phản diện/i, "悪役令嬢 ドレス ファンタジー"],
  [/thánh nữ/i, "聖女 ファンタジー 美少女"],
  [/công chúa|hoàng nữ/i, "王女 姫 ファンタジー 美少女"],
  [/phù thủy|ma nữ/i, "魔女 魔法 ファンタジー 美少女"],
  [/ma cà rồng/i, "吸血鬼 ゴシック 美少女"],
  [/thiên sứ|thiên thần/i, "天使 翼 美少女"],
  [/ác quỷ|con quỷ|ma vương/i, "悪魔 魔王 ファンタジー"],
  [/anh hùng|dũng giả/i, "勇者 冒険 ファンタジー"],
  [/chuyển sinh|dị giới|isekai/i, "異世界 ファンタジー ラノベ"],
  [/mùa hè|hạ/i, "夏 空 海 美少女 青春"],
  [/mùa đông|tuyết/i, "冬 雪 マフラー 美少女"],
  [/mùa thu|lá đỏ|hổ phách/i, "秋 夕暮れ 紅葉 美少女"],
  [/mùa xuân|anh đào|sakura/i, "春 桜 制服 美少女"],
  [/giáng sinh|noel|santa/i, "クリスマス 冬 美少女"],
  [/mưa/i, "雨 傘 制服 美少女"],
  [/biển|đại dương/i, "海 浜辺 夏 美少女"],
  [/đêm|trăng|sao|bầu trời/i, "夜空 星空 月 美少女"],
  [/hoa|bông hoa/i, "花畑 花 少女 イラスト"],
  [/mèo|corgi|chó/i, "猫 少女 可愛い イラスト"],
  [/học đường|lớp|trường|nữ sinh|nam sinh|kouhai|senpai|bàn bên/i, "学園 教室 制服 美少女"],
  [/vợ|chồng|kết hôn|cưới/i, "花嫁 結婚 ラブコメ 美少女"],
  [/chia tay|hối hận|ngoại tình|từ chối|thất tình/i, "切ない 涙 夕焼け 少女"],
  [/chết|tự sát|di chúc|căn bệnh|bệnh viện|thời gian còn lại/i, "儚い 涙 空 少女 感動"],
  [/bánh ngọt|cà phê|tiệm/i, "カフェ スイーツ 美少女"],
  [/âm nhạc|piano|hát|ca sĩ|idol|thần tượng/i, "ピアノ 音楽 少女 イラスト"],
  [/kiếm|chiến tranh|nữ kỵ sĩ/i, "女騎士 剣 ファンタジー"],
  [/rồng|dragon/i, "竜 ドラゴン ファンタジー 少女"],
  [/slime/i, "スライム 異世界 ファンタジー"],
  [/yuri|bách hợp|chị gái|em gái/i, "百合 二人 美少女 イラスト"]
];

const FALLBACK_THEMES = [
  "電撃文庫 ラノベ カバー イラスト 美少女",
  "スニーカー文庫 ラノベ 表紙 イラスト 美少女",
  "ガガガ文庫 青春 ラノベ イラスト 美少女",
  "ファンタジア文庫 ラノベ イラスト 美少女",
  "GA文庫 ラブコメ ラノベ イラスト 美少女",
  "MF文庫J ラノベ 表紙 イラスト 美少女",
  "オーバーラップ文庫 ラノベ イラスト 美少女",
  "講談社ラノベ文庫 イラスト 美少女"
];

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

async function getThumbVecFromBuffer(buf) {
  const { data } = await sharp(buf)
    .resize(16, 16, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Array.from(data);
}

async function getThumbVecFromFile(filePath) {
  return getThumbVecFromBuffer(fs.readFileSync(filePath));
}

function l1Dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

async function isAnimeIllustrationBuffer(buf) {
  let workingBuf = buf;
  try {
    workingBuf = await sharp(buf).trim({ threshold: 10 }).toBuffer();
  } catch (_) {
    workingBuf = buf;
  }

  const meta = await sharp(workingBuf).metadata();
  if (!meta.width || !meta.height) return null;
  if (meta.width < 280 || meta.height < 400) return null;
  const ratio = meta.height / meta.width;
  if (ratio < 1.18 || ratio > 1.85) return null;

  const { data } = await sharp(workingBuf)
    .resize(32, 32, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let pureWhitePixels = 0;
  let pureBlackPixels = 0;
  let colorfulPixels = 0;
  const totalPixels = 32 * 32;

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 245 && g > 245 && b > 245) pureWhitePixels++;
    if (r < 12 && g < 12 && b < 12) pureBlackPixels++;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    if (maxC - minC >= 20) colorfulPixels++;
  }

  if (pureWhitePixels / totalPixels > 0.38) return null;
  if (pureBlackPixels / totalPixels > 0.48) return null;
  if (colorfulPixels / totalPixels < 0.16) return null;

  return workingBuf;
}

async function savePublicCoverOnly(buf, optImgDir) {
  try {
    ensureDir(optImgDir);
    const optImgPath = path.join(optImgDir, "illu_01.webp");
    const coverOptPath = path.join(optImgDir, "illu_01.cover.webp");

    const readerWebp = await sharp(buf)
      .resize({ width: READER_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const coverWebp = await sharp(buf)
      .resize({ width: COVER_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    fs.writeFileSync(optImgPath, readerWebp);
    fs.writeFileSync(coverOptPath, coverWebp);
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

function parseMultiVolumeIndexHtml(indexHtml, fallbackTitle) {
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

  let status = "Đang tiến hành";
  const statusMatch = indexHtml.match(/href=["']https?:\/\/[^"']*\/truyen-[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  if (statusMatch && cleanText(statusMatch[1])) {
    status = cleanText(statusMatch[1]);
  }

  let description = "";
  const descMatch = indexHtml.match(/<h4[^>]*>\s*Tóm tắt\s*<\/h4>\s*<div[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) {
    description = cleanText(descMatch[1]);
  }

  const volumes = [];
  const volParts = indexHtml.split(/<header\b[^>]*\bid=["']volume_\d+["'][^>]*>/i);
  if (volParts.length > 1) {
    for (let i = 1; i < volParts.length; i++) {
      const block = volParts[i];
      const vTitleMatch =
        block.match(/<a\b[^>]*\bhref=["']#;?["'][^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/<span\b[^>]*\bclass=["'][^"']*sect-title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      const volTitle = vTitleMatch ? cleanText(vTitleMatch[1]) : `Tập ${i}`;
      const chs = [];
      for (const m of block.matchAll(/<a\b[^>]*\bhref=["'](c\d+[^"']*\.x?html?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const href = m[1].trim();
        const label = cleanText(m[2]);
        if (!chs.some((c) => c.href === href)) {
          chs.push({ href, label });
        }
      }
      if (chs.length > 0) {
        volumes.push({ volTitle, chapterLinks: chs });
      }
    }
  }

  if (volumes.length === 0) {
    const chs = [];
    for (const m of indexHtml.matchAll(/<a\b[^>]*\bhref=["'](c\d+[^"']*\.x?html?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = m[1].trim();
      const label = cleanText(m[2]);
      if (!chs.some((c) => c.href === href)) {
        chs.push({ href, label });
      }
    }
    if (chs.length > 0) {
      volumes.push({ volTitle: "Tập 01", chapterLinks: chs });
    }
  }

  return { titleVi, titleJp, author, illustrator, status, tags, description, volumes };
}

async function selectBestEpub(fullDir, epubFiles) {
  if (epubFiles.length === 1) {
    const p = path.join(fullDir, epubFiles[0]);
    const zip = await JSZip.loadAsync(fs.readFileSync(p));
    return { epubFile: epubFiles[0], zip };
  }

  let best = null;
  for (const f of epubFiles) {
    try {
      const p = path.join(fullDir, f);
      const statSize = fs.statSync(p).size;
      const zip = await JSZip.loadAsync(fs.readFileSync(p));
      const idxEntry = zip.file("index.html") || zip.file("OEBPS/index.html");
      const idxHtml = idxEntry ? await idxEntry.async("string") : "";
      const chCount = [...idxHtml.matchAll(/<a\b[^>]*\bhref=["']c\d+[^"']*\.x?html?["']/gi)].length;
      if (
        !best ||
        chCount > best.chCount ||
        (chCount === best.chCount && statSize > best.statSize)
      ) {
        best = { epubFile: f, zip, chCount, statSize };
      }
    } catch (_) {}
  }
  return best;
}

function findZipEntry(zip, href) {
  if (!href) return null;
  return (
    zip.file(href) ||
    zip.file(path.posix.basename(href)) ||
    zip.file(href.replace(/\.x?html?$/i, "_split_000.html")) ||
    zip.file(path.posix.basename(href).replace(/\.x?html?$/i, "_split_000.html"))
  );
}

async function processSeriesFolder(baseDir, folderName, section, collection, defaultStatus, usedSlugs, genericRefs) {
  const fullDir = path.join(baseDir, folderName);
  const epubs = fs.readdirSync(fullDir).filter((f) => f.toLowerCase().endsWith(".epub"));
  if (epubs.length === 0) return null;

  const selected = await selectBestEpub(fullDir, epubs);
  if (!selected || !selected.zip) return null;
  const { zip, epubFile } = selected;

  const indexEntry = zip.file("index.html") || zip.file("OEBPS/index.html");
  const indexHtml = indexEntry ? await indexEntry.async("string") : "";
  const meta = parseMultiVolumeIndexHtml(indexHtml, folderName);
  if (defaultStatus && (!meta.status || meta.status === "Đang tiến hành")) {
    meta.status = defaultStatus;
  }

  let baseSlug = "hlc-" + (slugify(meta.titleVi) || slugify(folderName) || slugify(path.parse(epubFile).name) || "series");
  let slug = baseSlug;
  let counter = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${counter++}`;
  }
  usedSlugs.add(slug);

  const allZipFiles = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
  let rawVolumes = meta.volumes;
  if (rawVolumes.length === 0) {
    const fallbackChs = allZipFiles
      .filter((k) => /(?:^|\/)c\d+[^/]*\.x?html?$/i.test(k))
      .filter((k) => !/_split_0*(?:[1-9]|\d{2,})\.x?html?$/i.test(k))
      .map((k) => ({ href: k, label: "" }));
    if (fallbackChs.length > 0) {
      rawVolumes = [{ volTitle: "Tập 01", chapterLinks: fallbackChs }];
    }
  }
  if (rawVolumes.length === 0) return null;

  const allLinkedHrefs = new Set();
  for (const v of rawVolumes) {
    for (const c of v.chapterLinks) {
      allLinkedHrefs.add(c.href);
      allLinkedHrefs.add(path.posix.basename(c.href));
    }
  }

  const candidateCoverHrefs = [];
  const builtVolumes = [];
  const volumeTitles = {};
  let firstStoryParagraphs = [];

  for (let vIdx = 0; vIdx < rawVolumes.length; vIdx++) {
    const rawVol = rawVolumes[vIdx];
    const storyChapters = [];

    for (const ref of rawVol.chapterLinks) {
      const entry = findZipEntry(zip, ref.href);
      if (!entry) continue;

      const html = await entry.async("string");
      const parsed = parseChapterHtml(html);
      let paragraphs = [...parsed.paragraphs];
      let images = [...parsed.images];

      // Merge Calibre _split_001.html, _split_002.html, ... if present and not linked separately
      const entryName = entry.name;
      const splitBase = entryName.match(/^(.*)_split_000(\.x?html?)$/i);
      const plainBase = !splitBase ? entryName.match(/^(.*?)(\.x?html?)$/i) : null;
      const prefix = splitBase ? splitBase[1] : plainBase ? plainBase[1] : null;
      const ext = splitBase ? splitBase[2] : plainBase ? plainBase[2] : ".html";

      if (prefix) {
        for (let sIdx = 1; sIdx <= 50; sIdx++) {
          const splitName = `${prefix}_split_${String(sIdx).padStart(3, "0")}${ext}`;
          if (allLinkedHrefs.has(splitName) || allLinkedHrefs.has(path.posix.basename(splitName))) {
            break;
          }
          const splitEntry = zip.file(splitName) || zip.file(path.posix.basename(splitName));
          if (!splitEntry) break;
          const splitParsed = parseChapterHtml(await splitEntry.async("string"));
          if (splitParsed.paragraphs.length > 0) {
            paragraphs.push(...splitParsed.paragraphs);
          }
          for (const img of splitParsed.images) {
            if (!images.includes(img)) images.push(img);
          }
        }
      }

      const content = paragraphs.join("\n\n");
      const chTitle = parsed.title || ref.label || `Chương ${storyChapters.length + 1}`;

      const isIlluOnly =
        (/^minh\s*họa/i.test(chTitle) && content.length < 120) ||
        (content.length === 0 && images.length > 0);

      if (isIlluOnly) {
        for (const img of images) {
          if (!candidateCoverHrefs.includes(img)) candidateCoverHrefs.push(img);
        }
        continue;
      }

      if (firstStoryParagraphs.length === 0 && paragraphs.length > 0) {
        firstStoryParagraphs = paragraphs;
      }

      storyChapters.push({
        title: chTitle,
        content,
        images: [],
        isIllustration: false
      });
    }

    if (storyChapters.length === 0 && vIdx === 0 && rawVolumes.length === 1) {
      storyChapters.push({
        title: rawVol.chapterLinks[0]?.label || "Chương 1",
        content: meta.description || meta.titleVi,
        images: [],
        isIllustration: false
      });
    }

    if (storyChapters.length > 0) {
      const num = builtVolumes.length + 1;
      const volName = `Tập ${String(num).padStart(2, "0")}`;
      const volDirName = sanitizeName(volName);
      if (rawVol.volTitle && rawVol.volTitle !== volName && rawVol.volTitle !== `Tập ${num}`) {
        volumeTitles[volDirName] = {
          label: volName,
          title: rawVol.volTitle
        };
      }
      builtVolumes.push({
        volumeName: volName,
        volDirName,
        chapters: storyChapters
      });
    }
  }

  if (builtVolumes.length === 0) return null;

  // Handle cover image for Tập 01
  const firstVol = builtVolumes[0];
  const optImgDir = path.join(PUBLIC_IMG_ROOT, slug, firstVol.volDirName);

  const coverKey =
    allZipFiles.find((k) => /(?:^|\/)cover\.(?:jpe?g|png|webp)$/i.test(k)) ||
    allZipFiles.find((k) => /\.(?:jpe?g|png|webp)$/i.test(k));

  let chosenCoverBuf = null;
  let chosenCoverVec = null;
  let isGenericOrMissing = true;

  if (coverKey) {
    try {
      const rawBuf = await zip.file(coverKey).async("nodebuffer");
      const metaImg = await sharp(rawBuf).metadata();
      if (metaImg.width >= 120 && metaImg.height >= 150) {
        const vec = await getThumbVecFromBuffer(rawBuf);
        const matchesGeneric = genericRefs.some((r) => l1Dist(r, vec) < 26);
        chosenCoverBuf = rawBuf;
        chosenCoverVec = vec;
        if (!matchesGeneric) {
          isGenericOrMissing = false;
        }
      }
    } catch (_) {}
  }

  // If cover.jpg is generic Hako placeholder or missing, check embedded images inside EPUB
  if (isGenericOrMissing) {
    const allImageKeys = [
      ...candidateCoverHrefs,
      ...allZipFiles.filter((k) => k !== coverKey && /\.(?:jpe?g|png|webp)$/i.test(k))
    ];
    const seenKeys = new Set();
    for (const imgHref of allImageKeys) {
      const entry = zip.file(imgHref) || zip.file(path.posix.basename(imgHref));
      if (!entry || seenKeys.has(entry.name)) continue;
      seenKeys.add(entry.name);
      if (seenKeys.size > 18) break;
      try {
        const rawBuf = await entry.async("nodebuffer");
        if (rawBuf.length < 15 * 1024) continue;
        const cleanBuf = await isAnimeIllustrationBuffer(rawBuf);
        if (!cleanBuf) continue;
        const vec = await getThumbVecFromBuffer(cleanBuf);
        if (genericRefs.every((r) => l1Dist(r, vec) >= 26)) {
          chosenCoverBuf = cleanBuf;
          chosenCoverVec = vec;
          isGenericOrMissing = false;
          break;
        }
      } catch (_) {}
    }
  }

  let hasSavedCover = false;
  if (chosenCoverBuf) {
    hasSavedCover = await savePublicCoverOnly(chosenCoverBuf, optImgDir);
  }

  firstVol.chapters.unshift({
    title: "Minh họa",
    content: "",
    images: hasSavedCover ? ["illu_01.webp"] : [],
    isIllustration: true
  });

  // Fallback description
  let description = meta.description;
  if (!description || description.length < 25) {
    const firstParas = firstStoryParagraphs.filter((p) => p.length > 30);
    const joined = firstParas.slice(0, 2).join(" ");
    if (joined) {
      description = joined.length > 320 ? `${joined.slice(0, 317).replace(/\s+\S*$/, "")}…` : joined;
    }
  }

  const outSeriesDir = path.join(OUTPUT_ROOT, slug);
  ensureDir(outSeriesDir);
  const metadataJson = builtVolumes.map((v) => ({
    volumeName: v.volumeName,
    chapters: v.chapters
  }));
  fs.writeFileSync(path.join(outSeriesDir, "metadata.json"), JSON.stringify(metadataJson), "utf8");

  const seriesEntry = {
    slug,
    source: `output/${slug}`,
    section,
    collection,
    titleVi: meta.titleVi,
    titleJp: meta.titleJp,
    author: meta.author,
    illustrator: meta.illustrator,
    status: meta.status,
    description,
    tags: meta.tags.slice(0, 6),
    ...(Object.keys(volumeTitles).length > 0 ? { volumeTitles } : {})
  };

  return {
    seriesEntry,
    firstVolDirName: firstVol.volDirName,
    coverVec: chosenCoverVec,
    needsOnlineCover: isGenericOrMissing || !hasSavedCover
  };
}

function buildSearchQueries(entry, index) {
  const queries = [];
  const jp = (entry.titleJp || "").trim();
  const vi = (entry.titleVi || "").replace(/^\[oneshot\]\s*/i, "").trim();
  const tags = Array.isArray(entry.tags) ? entry.tags : [];

  const matchedThemes = [];
  for (const [re, kw] of KEYWORD_MAP) {
    if (re.test(vi) || re.test(jp) || tags.some((t) => re.test(t))) {
      matchedThemes.push(kw);
    }
  }

  const tagKeywords = [];
  if (tags.includes("Fantasy")) tagKeywords.push("ファンタジー 異世界 美少女");
  if (tags.includes("Romance")) tagKeywords.push("恋愛 ラブコメ 美少女");
  if (tags.includes("School Life")) tagKeywords.push("学園 制服 美少女");
  if (tags.includes("Tragedy") || tags.includes("Drama")) tagKeywords.push("青春 感動 切ない 少女");
  if (tags.includes("Mystery") || tags.includes("Horror")) tagKeywords.push("ミステリー 幻想 少女");
  if (tags.includes("Yuri") || tags.includes("Shoujo Ai")) tagKeywords.push("百合 少女 二人");

  const themeStr = matchedThemes.slice(0, 2).join(" ") || tagKeywords.slice(0, 2).join(" ") || "青春 ラブコメ 美少女";
  const imprint = FALLBACK_THEMES[index % FALLBACK_THEMES.length];

  if (jp && jp.length >= 3) {
    const shortJp = jp.slice(0, 40);
    queries.push(`${shortJp} ラノベ イラスト 美少女 anime`);
  }

  queries.push(`ラノベ イラスト ${themeStr} site:pinimg.com OR site:bookwalker.jp OR site:dengekionline.com`);
  queries.push(`${imprint} ${themeStr}`);
  queries.push(`light novel cover illustration anime girl ${themeStr}`);
  queries.push(`ラノベ 表紙 イラスト ${themeStr} ${FALLBACK_THEMES[(index + 3) % FALLBACK_THEMES.length]}`);

  return [...new Set(queries)];
}

async function searchBingImages(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:aspect-tall&form=IRFLTR&first=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "ja,en-US;q=0.9"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const preferred = [];
    for (const m of html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/gi)) {
      const u = m[1];
      const lower = u.toLowerCase();
      if (ALLOWED_ANIME_DOMAINS.some((d) => lower.includes(d))) {
        preferred.push(u);
      }
    }
    return preferred;
  } catch (_) {
    return [];
  }
}

async function downloadAndValidateCover(url, genericRefs, existingVecs) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct && !ct.startsWith("image/") && !ct.includes("octet-stream")) return null;

    const rawBuf = Buffer.from(await res.arrayBuffer());
    if (rawBuf.length < 18 * 1024) return null;

    const cleanBuf = await isAnimeIllustrationBuffer(rawBuf);
    if (!cleanBuf) return null;

    const vec = await getThumbVecFromBuffer(cleanBuf);
    for (const ref of genericRefs) {
      if (l1Dist(ref, vec) < 26) return null;
    }
    for (const used of existingVecs) {
      if (l1Dist(used, vec) < 10) return null;
    }

    return { buf: cleanBuf, vec };
  } catch (_) {
    return null;
  }
}

async function main() {
  const ref1 = await getThumbVecFromFile(REF1_PATH);
  const genericRefs = [ref1];

  const allSeries = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const keptSeries = [];
  const usedSlugs = new Set();

  // 1. Keep main series and update existing HLC oneshots to section: "hlc-oneshot"
  for (const s of allSeries) {
    if (s.section === "hlc-completed" || s.section === "hlc-multivol") {
      continue;
    }
    if (s.section === "hlc-ln" || s.section === "hlc-oneshot") {
      s.section = "hlc-oneshot";
      s.collection = "Hội Lẩu Chay — OneShot";
      // Remove duplicate output/<slug>/Oneshot/images directory if present (public/img/<slug>/Oneshot has them)
      const dupImgDir = path.join(OUTPUT_ROOT, s.slug, "Oneshot", "images");
      if (fs.existsSync(dupImgDir)) {
        fs.rmSync(dupImgDir, { recursive: true, force: true });
      }
    }
    keptSeries.push(s);
    usedSlugs.add(s.slug);
  }

  console.log(`📌 Retained ${keptSeries.length} existing series (including 436 HLC Oneshots).`);

  // 2. Import 02_Da_Hoan_Thanh and 03_Truyen_Nhieu_Tap
  const importTasks = [];
  const completedFolders = fs
    .readdirSync(COMPLETED_DIR)
    .filter((f) => fs.statSync(path.join(COMPLETED_DIR, f)).isDirectory())
    .sort((a, b) => a.localeCompare(b, "vi"));

  for (const folder of completedFolders) {
    importTasks.push({
      baseDir: COMPLETED_DIR,
      folder,
      section: "hlc-completed",
      collection: "Hội Lẩu Chay — Đã Hoàn Thành",
      defaultStatus: "Đã hoàn thành"
    });
  }

  const multivolFolders = fs
    .readdirSync(MULTIVOL_DIR)
    .filter((f) => fs.statSync(path.join(MULTIVOL_DIR, f)).isDirectory())
    .sort((a, b) => a.localeCompare(b, "vi"));

  for (const folder of multivolFolders) {
    importTasks.push({
      baseDir: MULTIVOL_DIR,
      folder,
      section: "hlc-multivol",
      collection: "Hội Lẩu Chay — Truyện nhiều tập",
      defaultStatus: null
    });
  }

  console.log(`📚 Importing ${completedFolders.length} Đã Hoàn Thành + ${multivolFolders.length} Truyện nhiều tập (${importTasks.length} total)...`);

  const results = new Array(importTasks.length);
  let cursor = 0;
  let done = 0;
  const CONCURRENCY = 8;

  async function importWorker() {
    while (true) {
      const idx = cursor++;
      if (idx >= importTasks.length) break;
      const t = importTasks[idx];
      try {
        results[idx] = await processSeriesFolder(
          t.baseDir,
          t.folder,
          t.section,
          t.collection,
          t.defaultStatus,
          usedSlugs,
          genericRefs
        );
      } catch (err) {
        console.error(`  ❌ Error in ${t.folder}:`, err.message);
        results[idx] = null;
      }
      done++;
      if (done % 100 === 0 || done === importTasks.length) {
        console.log(`  Processed ${done}/${importTasks.length}: ${results[idx]?.seriesEntry?.titleVi || t.folder}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => importWorker()));

  const validResults = results.filter(Boolean);
  console.log(`✅ Extracted ${validResults.length}/${importTasks.length} series from EPUBs.`);

  // 3. Detect any cover shared identically across >= 3 series (automatic placeholder detection)
  const vecItems = validResults.filter((r) => r.coverVec && !r.needsOnlineCover);
  for (let i = 0; i < vecItems.length; i++) {
    let dupCount = 1;
    for (let j = 0; j < vecItems.length; j++) {
      if (i !== j && l1Dist(vecItems[i].coverVec, vecItems[j].coverVec) < 6) {
        dupCount++;
        if (dupCount >= 3) break;
      }
    }
    if (dupCount >= 3) {
      vecItems[i].needsOnlineCover = true;
    }
  }

  const needsOnline = validResults.filter((r) => r.needsOnlineCover);
  const existingVecs = validResults.filter((r) => !r.needsOnlineCover && r.coverVec).map((r) => r.coverVec);

  console.log(`🎨 Replacing ${needsOnline.length} generic/missing covers with real Anime/LN covers...`);

  if (needsOnline.length > 0) {
    let coverCursor = 0;
    let coverDone = 0;
    let coverReplaced = 0;
    const usedUrls = new Set();

    async function coverWorker() {
      while (true) {
        const idx = coverCursor++;
        if (idx >= needsOnline.length) break;
        const item = needsOnline[idx];
        const queries = buildSearchQueries(item.seriesEntry, idx);
        let replaced = false;

        for (const q of queries) {
          if (replaced) break;
          const urls = await searchBingImages(q);
          for (const u of urls.slice(0, 20)) {
            if (usedUrls.has(u)) continue;
            const res = await downloadAndValidateCover(u, genericRefs, existingVecs);
            if (res) {
              usedUrls.add(u);
              existingVecs.push(res.vec);
              const optImgDir = path.join(PUBLIC_IMG_ROOT, item.seriesEntry.slug, item.firstVolDirName);
              await savePublicCoverOnly(res.buf, optImgDir);
              // Ensure metadata.json has illu_01.webp in first volume's first chapter
              const metaPath = path.join(OUTPUT_ROOT, item.seriesEntry.slug, "metadata.json");
              const metaJson = JSON.parse(fs.readFileSync(metaPath, "utf8"));
              if (metaJson[0]?.chapters?.[0]?.isIllustration) {
                metaJson[0].chapters[0].images = ["illu_01.webp"];
                fs.writeFileSync(metaPath, JSON.stringify(metaJson), "utf8");
              }
              coverReplaced++;
              replaced = true;
              break;
            }
          }
        }

        coverDone++;
        if (coverDone % 20 === 0 || coverDone === needsOnline.length) {
          console.log(`  [Cover ${coverDone}/${needsOnline.length}] Replaced=${coverReplaced} — ${item.seriesEntry.titleVi.slice(0, 50)}`);
        }
      }
    }

    await Promise.all(Array.from({ length: 6 }, () => coverWorker()));
    console.log(`✅ Online cover replacement complete: ${coverReplaced}/${needsOnline.length}`);
  }

  const finalSeries = [...keptSeries, ...validResults.map((r) => r.seriesEntry)];
  fs.writeFileSync(SERIES_JSON_PATH, JSON.stringify(finalSeries, null, 2), "utf8");
  console.log(`🎉 Updated series.json with ${finalSeries.length} total series!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
