const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const GENERIC_LIST_PATH = "C:\\Users\\Hikari\\.gemini\\antigravity\\brain\\bd6703b6-3219-4db4-9b25-7ce277a8d619\\scratch\\generic-covers.json";
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

async function isAnimeIllustrationBuffer(buf) {
  // Trim any tiny solid border first
  let workingBuf = buf;
  try {
    workingBuf = await sharp(buf).trim({ threshold: 10 }).toBuffer();
  } catch (_) {
    workingBuf = buf;
  }

  const meta = await sharp(workingBuf).metadata();
  if (!meta.width || !meta.height) return null;
  if (meta.width < 320 || meta.height < 450) return null;
  const ratio = meta.height / meta.width;
  if (ratio < 1.2 || ratio > 1.82) return null;

  // Check color & saturation statistics on a 32x32 RGB sample to reject B&W manga pages or plain white text covers
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
    if (maxC - minC >= 22) colorfulPixels++;
  }

  // Reject plain white text book covers (>35% pure white) or monochrome manga pages (<18% colorful pixels)
  if (pureWhitePixels / totalPixels > 0.35) return null;
  if (pureBlackPixels / totalPixels > 0.45) return null;
  if (colorfulPixels / totalPixels < 0.18) return null;

  return workingBuf;
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

async function writeCoverFiles(slug, buf) {
  const srcImgPath = path.join(OUTPUT_DIR, slug, "Oneshot", "images", "illu_01.webp");
  const optImgPath = path.join(PUBLIC_DIR, "img", slug, "Oneshot", "illu_01.webp");
  const coverOptPath = path.join(PUBLIC_DIR, "img", slug, "Oneshot", "illu_01.cover.webp");

  const readerWebp = await sharp(buf)
    .resize({ width: READER_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const coverWebp = await sharp(buf)
    .resize({ width: COVER_WIDTH, withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();

  fs.mkdirSync(path.dirname(srcImgPath), { recursive: true });
  fs.mkdirSync(path.dirname(optImgPath), { recursive: true });
  fs.writeFileSync(srcImgPath, readerWebp);
  fs.writeFileSync(optImgPath, readerWebp);
  fs.writeFileSync(coverOptPath, coverWebp);
}

async function main() {
  const genericList = JSON.parse(fs.readFileSync(GENERIC_LIST_PATH, "utf8"));
  const catalog = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "data", "series.json"), "utf8"));

  const ref1 = await getThumbVecFromFile(REF1_PATH);
  const genericRefs = [ref1];

  const genericSlugs = new Set(genericList.map((g) => g.slug));
  const existingVecs = [];
  const usedUrls = new Set();

  for (const s of catalog) {
    if (genericSlugs.has(s.slug)) continue;
    const cp = path.join(PUBLIC_DIR, s.cover.replace(/^\//, ""));
    if (fs.existsSync(cp)) {
      try {
        existingVecs.push(await getThumbVecFromFile(cp));
      } catch (_) {}
    }
  }

  console.log(`🎨 Strict Anime/LN Cover Replacement for ${genericList.length} books...`);

  let cursor = 0;
  let done = 0;
  let fromEmbedded = 0;
  let fromOnline = 0;
  const CONCURRENCY = 6;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= genericList.length) break;
      const item = genericList[idx];

      // 1. Check embedded illustrations inside the EPUB
      const imgDir = path.join(OUTPUT_DIR, item.slug, "Oneshot", "images");
      const otherFiles = fs.existsSync(imgDir)
        ? fs.readdirSync(imgDir).filter((f) => f !== "illu_01.webp" && f.endsWith(".webp"))
        : [];

      let replaced = false;
      for (const other of otherFiles) {
        try {
          const buf = fs.readFileSync(path.join(imgDir, other));
          const cleanBuf = await isAnimeIllustrationBuffer(buf);
          if (cleanBuf) {
            const vec = await getThumbVecFromBuffer(cleanBuf);
            if (genericRefs.every((r) => l1Dist(r, vec) >= 26)) {
              await writeCoverFiles(item.slug, cleanBuf);
              existingVecs.push(vec);
              fromEmbedded++;
              replaced = true;
              break;
            }
          }
        } catch (_) {}
      }

      // 2. Search strict Anime / Light Novel domains
      if (!replaced) {
        const queries = buildSearchQueries(item, idx);
        for (const q of queries) {
          if (replaced) break;
          const urls = await searchBingImages(q);
          for (const u of urls.slice(0, 20)) {
            if (usedUrls.has(u)) continue;
            const res = await downloadAndValidateCover(u, genericRefs, existingVecs);
            if (res) {
              usedUrls.add(u);
              existingVecs.push(res.vec);
              await writeCoverFiles(item.slug, res.buf);
              fromOnline++;
              replaced = true;
              break;
            }
          }
        }
      }

      if (!replaced) {
        console.warn(`⚠️ Still need cover for: ${item.slug} (${item.titleVi})`);
      }

      done++;
      if (done % 15 === 0 || done === genericList.length) {
        console.log(`  [${done}/${genericList.length}] Replaced (embedded=${fromEmbedded}, online=${fromOnline}) — Latest: ${item.titleVi.slice(0, 55)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\n✅ Done! Replaced ${fromEmbedded + fromOnline}/${genericList.length} covers (embedded=${fromEmbedded}, online=${fromOnline}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
