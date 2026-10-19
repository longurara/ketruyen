// Converts a folder of Light Novel volume PDFs into output/<slug>/metadata.json
// plus extracted JPEG illustrations in output/<slug>/<volume>/images, matching
// the exact structure expected by build-data.js.
//
//   node import-pdf.js [slug] [pdf-folder]

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const OUTPUT_DIR = path.join(__dirname, "output");
const DEFAULT_SLUG = "arya-ban-ben";

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_").trim();
}

const VOWELS =
  "aàáảãạăằắẳẵặâầấẩẫậeèéẻẽẹêềếểễệiìíỉĩịoòóỏõọôồốổỗộơờớởỡợuùúủũụưừứửữựyỳýỷỹỵ" +
  "AÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬEÈÉẺẼẸÊỀẾỂỄỆIÌÍỈĨỊOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢUÙÚỦŨỤƯỪỨỬỮỰYỲÝỶỸỴ";
const TONED_VOWELS =
  "àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ" +
  "ÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ";

const validGlide = {
  a: "iouy",
  ă: "",
  â: "uy",
  e: "o",
  ê: "u",
  i: "au",
  o: "iae",
  ô: "i",
  ơ: "i",
  u: "aiy",
  ư: "aiu",
  y: "a"
};

const baseMap = {};
const groups = {
  a: "àáảãạÀÁẢÃẠ",
  ă: "ằắẳẵặẰẮẲẴẶ",
  â: "ầấẩẫậẦẤẨẪẬ",
  e: "èéẻẽẹÈÉẺẼẸ",
  ê: "ềếểễệỀẾỂỄỆ",
  i: "ìíỉĩịÌÍỈĨỊ",
  o: "òóỏõọÒÓỎÕỌ",
  ô: "ồốổỗộỒỐỔỖỘ",
  ơ: "ờớởỡợỜỚỞỠỢ",
  u: "ùúủũụÙÚỦŨỤ",
  ư: "ừứửữựỪỨỬỮỰ",
  y: "ỳýỷỹỵỲÝỶỸỴ"
};
for (const [base, chars] of Object.entries(groups)) {
  for (const c of chars) baseMap[c] = base;
}

const onsetVowelRe = new RegExp(
  `([${TONED_VOWELS}])(ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|[bcdđghklmnprstvx])(?=[${VOWELS}])`,
  "giu"
);
const vowelPairRe = new RegExp(`([${TONED_VOWELS}])([${VOWELS}])`, "gu");

function fixVietnameseText(text) {
  let cur = (text || "").normalize("NFC");
  // Fix split codas after ị / ỉ (Vol 11 font metric quirk) and uppercase RỒ I (Vol 1)
  cur = cur.replace(/([ịỉÌÍỈĨỊ])\s+(ch|nh|n|m|p|t|u|a)(?=[^\p{L}]|$)/gu, "$1$2");
  cur = cur.replace(/([ịỉÌÍỈĨỊ])\s+([?!,.;:])/gu, "$1$2");
  cur = cur.replace(/RỒ\s+I/g, "RỒI");
  cur = cur.replace(/\bCo\s+ee\b/g, "Coffee");

  // Fix missing spaces after fallback-font toned vowels (Vol 10 font metric quirk)
  for (let pass = 0; pass < 4; pass++) {
    const prev = cur;
    cur = cur.replace(onsetVowelRe, "$1 $2");
    cur = cur.replace(vowelPairRe, (m, v1, v2) => {
      const b1 = baseMap[v1];
      const allowed = validGlide[b1] || "";
      if (allowed.includes(v2)) return m;
      return `${v1} ${v2}`;
    });
    if (cur === prev) break;
  }
  return cur.replace(/\s+/g, " ").trim();
}

function joinRowItems(items) {
  items.sort((a, b) => a.x - b.x);
  let out = "";
  let prevEnd = null;
  for (const it of items) {
    if (!it.str) continue;
    if (prevEnd !== null && !out.endsWith(" ") && !it.str.startsWith(" ")) {
      const gap = it.x - prevEnd;
      if (gap > 2.5 && !/^[,.;:!?)\]】』」”’]/.test(it.str)) {
        out += " ";
      }
    }
    out += it.str;
    prevEnd = it.x + (it.w || 0);
  }
  return fixVietnameseText(out);
}

const NOISE_LINE_PATTERNS = [
  /^\d+\s*Bình luận\s*-\s*Độ dài:/i,
  /^「\s*bản dịch.*Ha Trung Kien\s*」$/i,
  /^Lưu Gia Huy đã phản ứng bằng/i,
  /^[-_]{5,}$/
];

function isNoiseLine(text, lineIdx, totalLines) {
  if (!text) return true;
  if (NOISE_LINE_PATTERNS.some((re) => re.test(text))) return true;
  if (/^\d{1,3}$/.test(text) && (lineIdx === 0 || lineIdx === totalLines - 1)) return true;
  return false;
}

function isHeadingLine(text, h, lineIdx, totalLines, volNum) {
  if (!text || text.length > 130) return false;
  if (/\s\d+$/.test(text) && /^(SS\d|Phiên bản|Fair bonus|Volume \d)/i.test(text)) return false;
  if (/^Chương mở đầu\.$/i.test(text) && lineIdx > 5) return false;

  if (volNum === 9.5) {
    return (
      /^(SS\d\b|Phiên bản độc quyền|Fair bonus ss:|Volume \d+ Bonus Short Story)/i.test(text) &&
      (h >= 13 || lineIdx === 0)
    );
  }

  // Require uppercase start so mid-sentence lowercase "chương 3..." is never matched
  if (!/^[CLMP]/.test(text)) return false;
  if (/^(Chương\s*trình|Phần\s*kết\s*luận|Phần\s*thắng|Phần\s*mở\s*đầu\s*bất\s*ngờ|Phần\s*tiếp\s*theo)/i.test(text)) {
    return false;
  }

  if (
    /^(Chương\s*(mở\s*đầu|đầu|kết|bổ\s*sung|\d+)\s*[:\-–—]|C[34]\s*-\s*\S|Lời\s*mở\s*đầu\s*[:\-–—]|Lời\s*bạt(\s*của\s*tác\s*giả)?$|Mở\s*đầu\s*[:\-–—]|Phần\s*kết\s*[:\-–—])/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

const SCENE_BREAK_RE = /^[⭑★☆•·*◇❖✦✧\-—~_\s]+$/;
function isSceneBreak(text) {
  if (!SCENE_BREAK_RE.test(text)) return false;
  return /[⭑★☆•·*◇❖✦✧]/.test(text) || /^[-—~_\s]{3,}$/.test(text);
}

function linesToParagraphs(lines) {
  if (!lines.length) return "";
  // Compute typical left/right margins and line spacing
  const minXs = lines.map((l) => l.minX).sort((a, b) => a - b);
  const maxXs = lines.map((l) => l.maxX).sort((a, b) => a - b);
  const leftMargin = minXs[Math.floor(minXs.length * 0.15)] || 72;
  const rightMargin = maxXs[Math.floor(maxXs.length * 0.85)] || 500;

  const dys = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].page === lines[i - 1].page) {
      const dy = lines[i - 1].y - lines[i].y;
      if (dy > 5 && dy < 40) dys.push(dy);
    }
  }
  dys.sort((a, b) => a - b);
  const baseDy = dys[Math.floor(dys.length * 0.35)] || 18;

  const paragraphs = [];
  let prev = null;

  for (const line of lines) {
    const text = line.text;
    if (isSceneBreak(text)) {
      if (paragraphs[paragraphs.length - 1] !== "--- ---") {
        paragraphs.push("--- ---");
      }
      prev = null;
      continue;
    }

    if (!prev) {
      paragraphs.push(text);
      prev = line;
      continue;
    }

    const samePage = line.page === prev.page;
    const dy = samePage ? prev.y - line.y : baseDy;
    const largeGap = samePage && dy > baseDy * 1.32;
    const indented = line.minX > leftMargin + 3.5;
    const startsQuoteOrBracket = /^[“"‘'「『（(\[【]/.test(text);
    const prevShortLine = prev.maxX < rightMargin - 42;
    const prevEndsTerminal = /[.!?…—”"’'」』）)\]】]$/.test(prev.text);

    const shouldMerge =
      !largeGap &&
      !indented &&
      !startsQuoteOrBracket &&
      (!prevShortLine || !prevEndsTerminal);

    if (shouldMerge) {
      paragraphs[paragraphs.length - 1] += " " + text;
    } else {
      paragraphs.push(text);
    }
    prev = line;
  }

  return paragraphs.join("\n\n");
}

async function getObjAsync(page, name) {
  const pool = name.startsWith("g_") ? page.commonObjs : page.objs;
  if (pool.has(name)) return pool.get(name);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    pool.get(name, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function saveRawImage(obj, destPath) {
  if (fs.existsSync(destPath)) return;
  const channels = obj.kind === 3 ? 4 : 3;
  const buf = Buffer.from(obj.data.buffer, obj.data.byteOffset, obj.data.byteLength);
  await sharp(buf, {
    raw: { width: obj.width, height: obj.height, channels }
  })
    .jpeg({ quality: 92 })
    .toFile(destPath);
}

async function processVolume(pdfjs, filePath, volNum, volumeName, seriesDir) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;

  const pageData = [];
  const md5Counts = new Map();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = it.transform[5];
      const x = it.transform[4];
      const w = it.width || 0;
      const h = it.height || Math.abs(it.transform[3]);
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) {
        row = { y, maxH: h, items: [] };
        rows.push(row);
      } else if (h > row.maxH) {
        row.maxH = h;
      }
      row.items.push({ x, endX: x + w, w, h, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y);

    const rawLines = rows
      .map((r) => {
        r.items.sort((a, b) => a.x - b.x);
        const minX = r.items[0]?.x || 0;
        const maxX = r.items[r.items.length - 1]?.endX || 0;
        return {
          page: p,
          y: r.y,
          minX,
          maxX,
          h: Math.round(r.maxH * 10) / 10,
          text: joinRowItems(r.items)
        };
      })
      .filter((l) => l.text);

    // Extract images on page
    const opList = await page.getOperatorList();
    const images = [];
    const seenOnPage = new Set();
    for (let i = 0; i < opList.fnArray.length; i++) {
      if (opList.fnArray[i] === pdfjs.OPS.paintImageXObject) {
        const name = opList.argsArray[i][0];
        if (seenOnPage.has(name)) continue;
        seenOnPage.add(name);
        const obj = await getObjAsync(page, name);
        if (!obj || !obj.data || obj.width < 160 || obj.height < 160) continue;
        if (obj.kind !== 2 && obj.kind !== 3) continue;
        const md5 = crypto.createHash("md5").update(obj.data).digest("hex");
        md5Counts.set(md5, (md5Counts.get(md5) || 0) + 1);
        images.push({ page: p, width: obj.width, height: obj.height, kind: obj.kind, data: obj.data, md5 });
      }
    }

    pageData.push({ page: p, lines: rawLines, images });
  }

  // Filter out template/background images that repeat >= 3 times across the volume
  for (const pd of pageData) {
    pd.images = pd.images.filter((img) => (md5Counts.get(img.md5) || 0) < 3);
  }

  // Identify chapters and assign lines + images
  const storyChapters = [];
  let currentChapter = null;

  for (const pd of pageData) {
    const lines = pd.lines;
    // Skip dedicated TOC page in Vol 7, 8, 9
    if (lines.length && /^Mục\s*Lục$/i.test(lines[0].text)) {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (isNoiseLine(l.text, i, lines.length)) continue;

      if (isHeadingLine(l.text, l.h, i, lines.length, volNum)) {
        let title = l.text;
        let nextIdx = i + 1;
        while (nextIdx < lines.length) {
          const nl = lines[nextIdx];
          if (/^\d{1,3}$/.test(nl.text)) {
            nextIdx++;
            continue;
          }
          const sameBigFont =
            l.h >= 17 &&
            Math.abs(nl.h - l.h) <= 0.5 &&
            nl.text.length < 65 &&
            !/^[“"‘'「(]/.test(nl.text) &&
            !isHeadingLine(nl.text, nl.h, nextIdx, lines.length, volNum);
          const wrappedShort =
            l.h < 15 &&
            nextIdx === i + 1 &&
            nl.text.length < 35 &&
            /^[a-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/u.test(nl.text);

          if (sameBigFont || wrappedShort) {
            title += " " + nl.text;
            i = nextIdx;
            nextIdx++;
          } else {
            break;
          }
        }
        title = title.replace(/^C(\d+)\s*-\s*/, "Chương $1 - ").replace(/\s+/g, " ").trim();
        currentChapter = {
          title,
          titleH: l.h,
          startPage: pd.page,
          lines: [],
          imageObjs: []
        };
        storyChapters.push(currentChapter);
      } else if (currentChapter) {
        if (
          currentChapter.lines.length === 0 &&
          currentChapter.titleH >= 20 &&
          Math.abs(l.h - currentChapter.titleH) <= 0.5 &&
          l.text.length < 50 &&
          !/^[“"‘'「(]/.test(l.text)
        ) {
          currentChapter.title += " " + l.text;
        } else {
          currentChapter.lines.push(l);
        }
      }
    }
  }

  // Assign images to front illustrations ("Minh họa") vs story chapters
  const firstStoryPage = storyChapters.length ? storyChapters[0].startPage : Infinity;
  const frontImageObjs = [];

  for (const pd of pageData) {
    if (!pd.images.length) continue;
    if (pd.page < firstStoryPage) {
      frontImageObjs.push(...pd.images);
    } else {
      // Find the last chapter that started on or before pd.page
      let target = storyChapters[0];
      for (const ch of storyChapters) {
        if (ch.startPage <= pd.page) target = ch;
        else break;
      }
      if (target) target.imageObjs.push(...pd.images);
    }
  }

  // Prepare output chapters array (starting with "Minh họa" if frontImageObjs exist)
  const volDirName = sanitizeName(volumeName);
  const imagesDir = path.join(seriesDir, volDirName, "images");
  fs.mkdirSync(imagesDir, { recursive: true });

  const outChapters = [];
  if (frontImageObjs.length > 0) {
    const imgNames = [];
    for (let j = 0; j < frontImageObjs.length; j++) {
      const filename = `illu_${String(j + 1).padStart(2, "0")}.jpg`;
      await saveRawImage(frontImageObjs[j], path.join(imagesDir, filename));
      imgNames.push(filename);
    }
    outChapters.push({
      title: "Minh họa",
      content: "",
      images: imgNames,
      isIllustration: true
    });
  }

  for (const ch of storyChapters) {
    // Index in outChapters determines the chNN prefix expected by build-data.js (idx + 1)
    const idx = outChapters.length;
    const prefix = `ch${String(idx + 1).padStart(2, "0")}`;
    const imgNames = [];
    for (let j = 0; j < ch.imageObjs.length; j++) {
      const filename = `${prefix}_${String(j + 1).padStart(2, "0")}.jpg`;
      await saveRawImage(ch.imageObjs[j], path.join(imagesDir, filename));
      imgNames.push(filename);
    }
    const content = linesToParagraphs(ch.lines);
    outChapters.push({
      title: ch.title,
      content,
      images: imgNames,
      isIllustration: false
    });
  }

  const totalImgs = frontImageObjs.length + storyChapters.reduce((s, c) => s + c.imageObjs.length, 0);
  const totalChars = outChapters.reduce((s, c) => s + c.content.length, 0);
  console.log(
    `✅ ${volumeName}: ${outChapters.length} mục (${storyChapters.length} chương + Minh họa), ${(totalChars / 1000).toFixed(1)}k ký tự, ${totalImgs} ảnh`
  );

  return {
    volumeName,
    chapters: outChapters
  };
}

async function main() {
  const slug = process.argv[2] || DEFAULT_SLUG;
  const pdfDir = process.argv[3];
  if (!pdfDir) {
    console.error('Usage: node import-pdf.js <slug> "<pdf-folder>"');
    process.exit(1);
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const files = fs
    .readdirSync(pdfDir)
    .filter((f) => f.toLowerCase().endsWith("pdf"))
    .sort((a, b) => parseFloat(a.match(/\d+(\.\d+)?/)[0]) - parseFloat(b.match(/\d+(\.\d+)?/)[0]));

  const seriesDir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(seriesDir, { recursive: true });

  console.log(`📚 Đang chuyển đổi ${files.length} tập PDF từ "${pdfDir}" -> output/${slug}...\n`);
  const metadata = [];

  for (const file of files) {
    const volNumStr = file.match(/\d+(\.\d+)?/)[0];
    const volNum = parseFloat(volNumStr);
    const volumeName = `Tập ${volNumStr}`;
    const volMeta = await processVolume(pdfjs, path.join(pdfDir, file), volNum, volumeName, seriesDir);
    metadata.push(volMeta);
  }

  const metaPath = path.join(seriesDir, "metadata.json");
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
  console.log(`\n🎉 Đã lưu ${path.relative(__dirname, metaPath)} (${metadata.length} tập)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
