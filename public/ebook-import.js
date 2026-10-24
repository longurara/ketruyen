(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EbookImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_FILE = 50 * 1024 * 1024;
  const MAX_EXPANDED = 150 * 1024 * 1024;
  const MAX_ENTRIES = 5000;
  const MAX_CHAPTERS = 3000;
  const DB_NAME = "tenshi-ebooks-v1";
  // Original bytes and layout are draft-only: never enter IndexedDB, backups,
  // or the temporary ebook bucket.
  const pdfDrafts = new WeakMap();
  const words = (text) => text.trim() ? text.trim().split(/\s+/u).length : 0;
  const clean = (text) => String(text || "").replace(/\u0000/g, "").trim();
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MARKS = new Set(["strong", "em", "u", "s", "code", "sup", "sub"]);
  function renderRich(runs) {
    return runs.map((run) => {
      let html = escape(run.text);
      for (const mark of (run.marks || []).filter((value) => MARKS.has(value))) html = `<${mark}>${html}</${mark}>`;
      return run.note ? `<button type="button" class="ebook-noteref" data-footnote="${escape(run.note)}" aria-label="Đọc chú thích ${escape(run.text)}">${html}</button>` : html;
    }).join("");
  }
  function renderBlocks(blocks, paragraph, image) {
    let html = ""; const stack = [];
    const close = () => { const item = stack.pop(); html += `</li></${item.type}>`; };
    for (const block of blocks) {
      if (block.list === "ol" || block.list === "ul") {
        const level = Math.min(Math.max(0, block.level || 0), stack.length);
        while (stack.length > level + 1) close();
        if (stack[level] && stack[level].type !== block.list) close();
        if (!stack[level]) {
          html += `<${block.list} class="ebook-list"${block.list === "ol" ? ` start="${Math.max(1, Number(block.ordinal) || 1)}"` : ""}><li>`;
          stack.push({ type: block.list, ordinal: block.ordinal });
        } else if (stack[level].ordinal !== block.ordinal) { html += "</li><li>"; stack[level].ordinal = block.ordinal; }
        html += paragraph(block);
      } else {
        while (stack.length) close();
        html += block.image !== undefined ? image(block) : paragraph(block);
      }
    }
    while (stack.length) close();
    return html;
  }

  // Resolve references inside the archive only. No imported URL is fetched.
  function archivePath(base, href) {
    let value = String(href || "").split(/[?#]/)[0];
    if (!value) return base;
    try { value = decodeURIComponent(value); } catch (_) { throw new Error("Đường dẫn trong EPUB không hợp lệ."); }
    if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//") || /[\\\u0000]/.test(value)) return null;
    const parts = value.startsWith("/") ? [] : base.split("/").slice(0, -1);
    for (const part of value.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else parts.push(part);
    }
    return parts.join("/");
  }

  function decodeText(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let encoding = "utf-8";
    if (data[0] === 0xff && data[1] === 0xfe) encoding = "utf-16le";
    if (data[0] === 0xfe && data[1] === 0xff) encoding = "utf-16be";
    try { return clean(new TextDecoder(encoding, { fatal: true }).decode(data)).replace(/\r\n?/g, "\n"); }
    catch (_) { throw new Error("Không đọc được mã hóa văn bản. Hãy lưu TXT bằng UTF-8 hoặc UTF-16."); }
  }

  function textChapters(text, title, mode = "auto") {
    const chapters = [];
    let name = title, lines = [];
    const finish = () => {
      const content = clean(lines.join("\n"));
      if (content) chapters.push(makeChapter(name, content.split(/\n\s*\n/).map(clean).filter(Boolean)));
      lines = [];
    };
    for (const line of text.split("\n")) {
      const heading = clean(line);
      const isHeading = mode === "numbered" ? /^\d+[.)]\s+\S/u.test(heading)
        : mode === "markdown" ? /^#{1,3}\s+\S/u.test(heading)
        : /^(?:(?:chương|chapter|phần|part)\s+(?:\d+[a-z]?|[ivxlcdm]+)(?=$|[\s.:：–—-])|(?:lời mở đầu|lời kết|prologue|epilogue)$)/iu.test(heading);
      if (mode !== "single" && heading.length < 160 && isHeading) {
        finish(); name = heading;
      } else lines.push(line);
    }
    finish();
    if (!chapters.length) throw new Error("Tệp TXT không có nội dung để đọc.");
    if (chapters.length > MAX_CHAPTERS) throw new Error("Ebook có quá nhiều chương (tối đa 3.000).");
    return chapters;
  }

  function updateChapters(book, chapters) {
    book.volumesData[0].chapters = chapters;
    book.volumesData[0].words = chapters.reduce((sum, chapter) => sum + chapter.words, 0);
    book.chapters = chapters.length;
    book.toc = [];
  }

  function mergeTextChapters(chapters, index) {
    if (index < 0 || index >= chapters.length - 1) return chapters;
    const joined = makeChapter(chapters[index].title, [...chapters[index].paragraphs,
      `--- ${chapters[index + 1].title} ---`, ...chapters[index + 1].paragraphs]);
    return [...chapters.slice(0, index), joined, ...chapters.slice(index + 2)];
  }

  function splitTextChapter(chapters, index, paragraph) {
    const chapter = chapters[index];
    if (!chapter || paragraph < 1 || paragraph >= chapter.paragraphs.length) return chapters;
    return [...chapters.slice(0, index), makeChapter(chapter.title, chapter.paragraphs.slice(0, paragraph)),
      makeChapter(`${chapter.title} · Phần 2`, chapter.paragraphs.slice(paragraph)), ...chapters.slice(index + 1)];
  }

  function makeChapter(title, paragraphs, images = [], blocks) {
    return { title: clean(title) || "Chương", content: paragraphs.join("\n\n"), paragraphs,
      words: words(paragraphs.join(" ")), isIllustration: !paragraphs.length && images.length > 0,
      images, ...(blocks ? { blocks } : {}) };
  }

  // Read dimensions before decoding to reject small files with huge canvases.
  function rasterType(data) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
    if (String.fromCharCode(...data.slice(0, 4)) === "RIFF" && String.fromCharCode(...data.slice(8, 12)) === "WEBP") return "image/webp";
    return "";
  }
  function rasterDimensions(data, type) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (type === "image/png" && data.length >= 24) return [view.getUint32(16), view.getUint32(20)];
    if (type === "image/gif" && data.length >= 10) return [view.getUint16(6, true), view.getUint16(8, true)];
    if (type === "image/webp" && data.length >= 30) {
      const kind = String.fromCharCode(...data.slice(12, 16));
      const uint24 = (offset) => data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
      if (kind === "VP8X") return [1 + uint24(24), 1 + uint24(27)];
      if (kind === "VP8 ") return [view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383];
      if (kind === "VP8L") return [1 + (data[21] | ((data[22] & 63) << 8)), 1 + ((data[22] >> 6) | (data[23] << 2) | ((data[24] & 15) << 10))];
    }
    if (type === "image/jpeg") {
      let offset = 2;
      while (offset + 4 < data.length && data[offset] === 255) {
        while (data[offset] === 255) offset++;
        const marker = data[offset++];
        if (offset + 7 > data.length) break;
        const length = view.getUint16(offset);
        if (length < 2) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
          return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
        }
        offset += length;
      }
    }
    return null;
  }

  // Check declared expansion before inflating; entry streams also enforce real sizes.
  function inspectArchive(bytes, maxExpanded = MAX_EXPANDED, maxEntries = MAX_ENTRIES) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let end = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === data.length) { end = i; break; }
    }
    if (end < 0) throw new Error("Tệp EPUB bị hỏng hoặc không phải EPUB.");
    const count = view.getUint16(end + 10, true);
    const size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535 || count > maxEntries || start + size > end) {
      throw new Error("EPUB quá lớn hoặc dùng cấu trúc ZIP không hỗ trợ.");
    }
    let offset = start, expanded = 0;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Cấu trúc EPUB bị hỏng.");
      if (view.getUint16(offset + 8, true) & 1) throw new Error("EPUB có mật khẩu/mã hóa không được hỗ trợ.");
      expanded += view.getUint32(offset + 24, true);
      if (expanded > maxExpanded) throw new Error(`Nội dung sau giải nén vượt quá ${Math.round(maxExpanded / 1024 / 1024)} MB.`);
      offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      if (offset > start + size) throw new Error("Cấu trúc EPUB bị hỏng.");
    }
    return { entries: count, expanded };
  }

  function xml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Thông tin EPUB bị hỏng.");
    return doc;
  }
  const elements = (node, name) => [...node.getElementsByTagNameNS("*", name)];
  const firstText = (node, name) => clean(elements(node, name)[0]?.textContent);

  // The ZIP reader (~95 KB) is only needed for EPUB files and backups, so it
  // loads the first time one of those is opened rather than with the page.
  let zipRequest = null;
  function loadZip() {
    if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
    if (typeof document === "undefined") return Promise.reject(new Error("Chưa tải được bộ đọc ZIP."));
    zipRequest ||= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/jszip.min.js";
      script.onload = () => globalThis.JSZip ? resolve(globalThis.JSZip) : reject(new Error("Chưa tải được bộ đọc ZIP."));
      script.onerror = () => { zipRequest = null; script.remove(); reject(new Error("Chưa tải được bộ đọc EPUB. Kiểm tra kết nối mạng rồi thử lại.")); };
      document.head.append(script);
    });
    return zipRequest;
  }

  async function parseEpub(bytes, report) {
    inspectArchive(bytes);
    const JSZip = await loadZip();
    const zip = await JSZip.loadAsync(bytes);
    const reads = new Map();
    let totalRead = 0;
    const read = (path, limit = 8 * 1024 * 1024) => {
      if (!zip.file(path)) throw new Error(`EPUB thiếu tệp: ${path}`);
      if (!reads.has(path)) reads.set(path, new Promise((resolve, reject) => {
        const chunks = []; let size = 0, failed = false;
        const stream = zip.file(path).internalStream("uint8array");
        stream.on("data", (chunk) => {
          size += chunk.length; totalRead += chunk.length;
          if (size > limit || totalRead > MAX_EXPANDED) {
            failed = true; stream.pause(); reject(new Error("Nội dung EPUB quá lớn để nhập."));
          } else chunks.push(chunk);
        }).on("error", reject).on("end", () => {
          if (failed) return;
          const out = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
          resolve(out);
        }).resume();
      }));
      return reads.get(path);
    };
    const readText = async (path) => decodeText(await read(path));
    const container = xml(await readText("META-INF/container.xml"));
    const packagePath = archivePath("", elements(container, "rootfile")[0]?.getAttribute("full-path"));
    if (!packagePath) throw new Error("Không tìm thấy nội dung chính của EPUB.");
    const opf = xml(await readText(packagePath));
    const metadata = elements(opf, "metadata")[0] || opf;
    const manifest = new Map(elements(opf, "item").map((item) => [item.getAttribute("id"), {
      path: archivePath(packagePath, item.getAttribute("href")),
      type: item.getAttribute("media-type"), props: (item.getAttribute("properties") || "").split(/\s+/)
    }]));
    const spine = elements(opf, "itemref").map((item) => manifest.get(item.getAttribute("idref")))
      .filter((item) => !item?.props.includes("nav"));
    if (!spine.length || spine.length > MAX_CHAPTERS || spine.some((item) => !item?.path || !/^(application\/xhtml\+xml|text\/html)$/.test(item.type))) {
      throw new Error("EPUB không có mục lục nội dung hợp lệ hoặc dùng định dạng không hỗ trợ.");
    }
    if (zip.file("META-INF/encryption.xml")) {
      const encryption = xml(await readText("META-INF/encryption.xml"));
      if (elements(encryption, "EncryptionMethod").some((item) => !["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"].includes(item.getAttribute("Algorithm")))) {
        throw new Error("EPUB có DRM/mã hóa không được hỗ trợ.");
      }
    }
    const labels = new Map(), navigation = [];
    const reference = (base, href) => {
      const path = archivePath(base, href); let fragment = "";
      try { fragment = decodeURIComponent(String(href || "").split("#").slice(1).join("#")); } catch (_) {}
      return { path, fragment, key: `${path}#${fragment}` };
    };
    const nav = [...manifest.values()].find((item) => item.props.includes("nav"));
    const ncx = manifest.get(elements(opf, "spine")[0]?.getAttribute("toc"));
    if (nav?.path && zip.file(nav.path)) {
      const template = document.createElement("template"); template.innerHTML = await readText(nav.path);
      const tocNav = [...template.content.querySelectorAll("nav")].find((node) => (node.getAttribute("epub:type") || "").split(/\s+/).includes("toc") || node.getAttribute("role") === "doc-toc") || template.content;
      for (const a of tocNav.querySelectorAll("a[href]")) {
        const ref = reference(nav.path, a.getAttribute("href")), path = ref.path;
        if (path && !labels.has(path)) labels.set(path, clean(a.textContent));
        let depth = -1, parent = a.parentElement;
        while (parent) { if (parent.localName === "li") depth++; parent = parent.parentElement; }
        if (path) navigation.push({ ...ref, title: clean(a.textContent), depth: Math.max(0, depth) });
      }
    } else if (ncx?.path && zip.file(ncx.path)) {
      for (const point of elements(xml(await readText(ncx.path)), "navPoint")) {
        const ref = reference(ncx.path, elements(point, "content")[0]?.getAttribute("src")), path = ref.path;
        if (path && !labels.has(path)) labels.set(path, firstText(point, "text"));
        let depth = 0, parent = point.parentElement;
        while (parent) { if (parent.localName === "navPoint") depth++; parent = parent.parentElement; }
        if (path) navigation.push({ ...ref, title: firstText(point, "text"), depth });
      }
    }
    const assets = [], assetMap = new Map();
    let skippedImages = 0;
    async function image(path) {
      if (!path || !zip.file(path)) { skippedImages++; return null; }
      if (assetMap.has(path)) return assetMap.get(path);
      const data = await read(path, 20 * 1024 * 1024);
      let type = "";
      if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) type = "image/png";
      else if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) type = "image/jpeg";
      else if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) type = "image/gif";
      else if (String.fromCharCode(...data.slice(0, 4)) === "RIFF" && String.fromCharCode(...data.slice(8, 12)) === "WEBP") type = "image/webp";
      if (!type) { skippedImages++; assetMap.set(path, null); return null; }
      const dimensions = rasterDimensions(data, type);
      if (!dimensions || dimensions.some((value) => !value)) { skippedImages++; assetMap.set(path, null); return null; }
      if (dimensions[0] * dimensions[1] > 40000000) throw new Error("Ảnh minh họa trong EPUB có kích thước quá lớn.");
      const blob = new Blob([data], { type });
      let bitmap;
      try { bitmap = await createImageBitmap(blob); } catch (_) { skippedImages++; assetMap.set(path, null); return null; }
      const w = bitmap.width, h = bitmap.height; bitmap.close();
      if (w * h > 40000000) throw new Error("Ảnh minh họa trong EPUB có kích thước quá lớn.");
      const asset = { key: `image-${assets.length}`, blob, w, h };
      assets.push(asset); assetMap.set(path, asset);
      return asset;
    }
    const coverId = elements(opf, "meta").find((item) => item.getAttribute("name") === "cover")?.getAttribute("content");
    const coverItem = [...manifest.values()].find((item) => item.props.includes("cover-image")) || manifest.get(coverId);
    let cover = coverItem ? await image(coverItem.path) : null;
    const chapters = [], footnotes = Object.create(null), noteRefs = new Set(), positions = new Map();
    const isNote = (node) => /(?:^|\s)(?:footnote|endnote)(?:\s|$)/.test(node.getAttribute?.("epub:type") || "") || ["doc-footnote", "doc-endnote"].includes(node.getAttribute?.("role"));
    function collectNotes(body, path) {
      for (const node of body.querySelectorAll("[id]")) if (isNote(node)) footnotes[`${path}#${node.id}`] = clean(node.textContent);
    }
    for (let i = 0; i < spine.length; i++) {
      report(`Đang đọc EPUB… ${i + 1}/${spine.length}`);
      const item = spine[i], template = document.createElement("template");
      // Keep all untrusted markup in an inert template. Only escaped plain text
      // and locally decoded image blobs enter the reader.
      template.innerHTML = await readText(item.path);
      const body = template.content.querySelector("body") || template.content;
      collectNotes(body, item.path);
      const firstHeading = body.querySelector("h1, h2, h3");
      const title = clean(firstHeading?.textContent) || labels.get(item.path) || `Chương ${i + 1}`;
      const paragraphs = [], images = [], blocks = [], rich = [], anchors = Object.create(null);
      let runs = [], paragraphMeta = {};
      const append = (value, marks = [], note, list = {}) => {
        let text = value.replace(/[ \t\r\f\n]+/g, " ");
        if (!runs.length || /\s$/.test(runs.at(-1).text)) text = text.replace(/^\s+/, "");
        if (text) { runs.push({ text, marks, ...(note ? { note } : {}) }); paragraphMeta = list; }
      };
      const flush = () => {
        if (runs.length) runs.at(-1).text = runs.at(-1).text.trimEnd();
        runs = runs.filter((run) => run.text);
        const text = runs.map((run) => run.text).join("");
        if (text) { blocks.push({ p: paragraphs.length, ...paragraphMeta }); paragraphs.push(text); rich.push(runs); }
        runs = []; paragraphMeta = {};
      };
      const skip = new Set(["script", "style", "head", "title", "link", "meta", "base", "iframe", "object", "embed", "form", "audio", "video", "noscript"]);
      const blockTags = new Set(["p", "div", "section", "article", "li", "blockquote", "table", "tr", "figure", "figcaption", "pre"]);
      async function walk(node, marks = [], note, list = {}) {
        if (node.nodeType === 3) { append(node.textContent, marks, note, list); return; }
        if (node.nodeType !== 1 && node.nodeType !== 11) return;
        const tag = node.localName?.toLowerCase();
        if (skip.has(tag) || isNote(node) || node.getAttribute?.("aria-hidden") === "true" || node.hasAttribute?.("hidden")) return;
        if (node.id) anchors[node.id] = paragraphs.length;
        if (/^h[1-6]$/.test(tag)) {
          flush(); if (node.id) anchors[node.id] = paragraphs.length;
          if (node !== firstHeading) { append(`--- ${clean(node.textContent)} ---`); flush(); } return;
        }
        if (tag === "img" || tag === "image") {
          flush(); const src = node.getAttribute("src") || node.getAttribute("href") || node.getAttribute("xlink:href");
          const asset = await image(archivePath(item.path, src));
          if (asset) { blocks.push({ image: images.length }); images.push({ asset: asset.key, w: asset.w, h: asset.h }); }
          return;
        }
        if (tag === "br") { runs.push({ text: "\n", marks }); return; }
        if (tag === "hr") { flush(); append("------"); flush(); return; }
        if (blockTags.has(tag)) flush();
        if (node.id) anchors[node.id] = paragraphs.length;
        const mark = { b: "strong", i: "em", del: "s" }[tag] || (MARKS.has(tag) ? tag : "");
        const nextMarks = mark ? [...marks, mark] : marks;
        let nextNote = note, nextList = list;
        if (tag === "a" && ((node.getAttribute("epub:type") || "").includes("noteref") || node.getAttribute("role") === "doc-noteref")) {
          const ref = reference(item.path, node.getAttribute("href"));
          if (ref.path && ref.fragment) { nextNote = ref.key; noteRefs.add(ref.key); }
        }
        if (tag === "li") {
          const parent = node.parentElement; let level = -1, ancestor = parent;
          while (ancestor) { if (["ul", "ol"].includes(ancestor.localName)) level++; ancestor = ancestor.parentElement; }
          nextList = { list: parent?.localName === "ol" ? "ol" : "ul", level: Math.max(0, level), ordinal: [...(parent?.children || [])].filter((child) => child.localName === "li").indexOf(node) + (Number(parent?.getAttribute("start")) || 1) };
        }
        for (const child of node.childNodes) await walk(child, nextMarks, nextNote, nextList);
        if (blockTags.has(tag)) flush();
      }
      await walk(body); flush();
      if (paragraphs.length || images.length) {
        positions.set(item.path, { chapIdx: chapters.length, anchors });
        chapters.push({ ...makeChapter(title, paragraphs, images, blocks), rich });
      }
    }
    if (!chapters.length) throw new Error("EPUB không có văn bản hoặc ảnh có thể đọc.");
    if (!cover && assets.length) cover = assets[0];
    const noteDocuments = new Map();
    for (const key of noteRefs) if (!footnotes[key]) {
      const split = key.lastIndexOf("#"), path = key.slice(0, split), id = key.slice(split + 1);
      if (!zip.file(path)) continue;
      if (!noteDocuments.has(path)) { const template = document.createElement("template"); template.innerHTML = await readText(path); noteDocuments.set(path, template.content); }
      const node = [...noteDocuments.get(path).querySelectorAll("[id]")].find((node) => node.id === id);
      if (node) footnotes[key] = clean(node.textContent);
    }
    const toc = navigation.filter((entry) => positions.has(entry.path)).map((entry) => ({ title: entry.title,
      chapIdx: positions.get(entry.path).chapIdx, p: positions.get(entry.path).anchors[entry.fragment] || 0, depth: entry.depth }));
    return { title: firstText(metadata, "title"), author: firstText(metadata, "creator"),
      description: firstText(metadata, "description").replace(/<[^>]*>/g, ""), chapters, assets,
      toc, footnotes,
      coverAsset: cover?.key, warnings: skippedImages ? "Một số ảnh SVG, ảnh lỗi hoặc ảnh ngoài tệp không được nhập." : "" };
  }

  function fallbackCover(title) {
    const canvas = document.createElement("canvas"); canvas.width = 520; canvas.height = 736;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#283d41"; ctx.fillRect(0, 0, 520, 736);
    ctx.strokeStyle = "#92b1a3"; ctx.strokeRect(28, 28, 464, 680);
    ctx.fillStyle = "#e9ede4"; ctx.font = "bold 36px Georgia";
    const lines = []; let line = "";
    for (const word of title.split(/\s+/)) {
      if (ctx.measureText(`${line} ${word}`).width > 410 && line) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    lines.slice(0, 10).forEach((value, i) => ctx.fillText(value, 55, 170 + i * 48, 410));
    ctx.font = "20px sans-serif"; ctx.fillText("EBOOK CÁ NHÂN", 55, 660);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  function rebuildPdf(book, options = {}) {
    const source = pdfDrafts.get(book); if (!source) throw new Error("Hãy chọn lại tệp PDF để thay đổi chuyển đổi.");
    const settings = { ...source.settings, ...options, title:book.titleVi };
    const result = globalThis.PdfText.build(source.pages, source.outline, settings);
    let chapters = result.chapters;
    if (book.txtMode && !["pdf", "pdf-pages", "single"].includes(book.txtMode)) chapters = textChapters(result.text,book.titleVi,book.txtMode);
    if (chapters.length > MAX_CHAPTERS) throw new Error("Ebook có quá nhiều chương (tối đa 3.000).");
    source.settings=settings; source.result=result; source.edited=false;
    updateChapters(book,chapters); book.txtSource=result.text; book.warnings=result.warnings.join(" ");
    book.pdfConversion = { version:1, pages:source.pages.length, joinLines:settings.joinLines !== false, removeRepeated:settings.removeRepeated !== false, chapterMode:book.txtMode || "pdf" };
    return result;
  }
  async function parseFile(file, report = () => {}, options = {}) {
    const extension = file.name.split(".").pop().toLowerCase();
    if (!["epub", "txt", "pdf"].includes(extension)) throw new Error("Chỉ hỗ trợ tệp EPUB, TXT và PDF.");
    if (!file.size || file.size > MAX_FILE) throw new Error("Chọn ebook có dung lượng từ 1 byte đến 50 MB.");
    report("Đang đọc tệp…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
    options.signal?.throwIfAborted();
    const pdfText = extension === "pdf" && options.pdfMode === "text";
    const converted = pdfText ? await PdfReader.extractText(bytes.slice(), report, options.signal) : null;
    const convertedText = converted ? globalThis.PdfText.build(converted.pages,converted.outline,{title:converted.title}) : null;
    const defaultTitle = clean(file.name.replace(/\.[^.]+$/, "").replace(/[_]/g, " ")) || "Ebook";
    const txtSource = extension === "txt" ? decodeText(bytes) : "";
    const parsed = converted ? { ...converted, chapters:convertedText.chapters, assets:[], warnings:convertedText.warnings.join(" ") } : extension === "epub" ? await parseEpub(bytes, report) : extension === "pdf" ? await PdfReader.parse(bytes, report, options.signal) : {
      title: defaultTitle, author: "", chapters: textChapters(txtSource, defaultTitle), assets: []
    };
    const title = parsed.title || defaultTitle;
    if (!parsed.coverAsset) {
      const blob = await fallbackCover(title);
      if (blob) { parsed.assets.push({ key: "fallback-cover", blob, w: 520, h: 736 }); parsed.coverAsset = "fallback-cover"; }
    }
    const count = parsed.chapters.length;
    const bookDigest = pdfText ? [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`pdf-text-v1:${digest}`)))].map((n) => n.toString(16).padStart(2,"0")).join("") : digest;
    const book = { slug: `ebook-${bookDigest.slice(0, 24)}`, digest:bookDigest, personal: true, titleVi: title, titleJp: "",
      author: parsed.author || "", illustrator: "", status: "Lưu trên thiết bị", tags: [extension.toUpperCase(), "Ebook cá nhân"],
      description: parsed.description || "Ebook do bạn nhập, được lưu riêng trong trình duyệt này.",
      sourceFilename: file.name, sourceFormat: pdfText ? "PDF-TEXT" : extension.toUpperCase(), importedAt: Date.now(),
      sourceBytes: file.size, volumes: 1, chapters: count, assets: parsed.assets, coverAsset: parsed.coverAsset,
      toc: parsed.toc || [], footnotes: parsed.footnotes || {}, txtSource,
      warnings: parsed.warnings || "", volumesData: [{ name: title, title, dirName: "ebook", bytes: file.size,
        words: parsed.chapters.reduce((sum, chapter) => sum + chapter.words, 0), chapters: parsed.chapters }] };
    if (converted) {
      book.sourceDigest=digest; book.txtMode="pdf";
      pdfDrafts.set(book,{ ...converted, bytes, settings:{joinLines:true,removeRepeated:true,chapterMode:"auto"}, result:convertedText, edited:false });
      rebuildPdf(book);
    }
    options.signal?.throwIfAborted(); return book;
  }

  async function openDB() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error("Trình duyệt không hỗ trợ lưu ebook.")); return; }
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "slug" });
        const summaries = db.createObjectStore("summaries", { keyPath: "slug" });
        const cursor = request.transaction.objectStore("books").openCursor();
        cursor.onsuccess = () => { const entry = cursor.result; if (entry) { summaries.put(summary(entry.value)); entry.continue(); } };
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Hãy đóng các tab đọc truyện khác rồi thử lại."));
    });
  }
  async function transaction(mode, operation, stores = ["books"]) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result;
      const request = operation(tx.objectStore(stores[0]), tx);
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || request.error || new Error("Không lưu được ebook.")); };
    });
  }
  function summary(book) {
    const { assets, volumesData, footnotes, txtSource, ...meta } = book;
    return { ...meta, coverBlob: assets.find((asset) => asset.key === book.coverAsset)?.blob,
      volumesData: volumesData.map((volume) => ({ ...volume, chapters: volume.chapters.map((chapter) => ({
        title: chapter.title, words: chapter.words, isIllustration: chapter.isIllustration,
        images: (chapter.images || []).map(({ asset, w, h }) => ({ asset, w, h }))
      })) })) };
  }
  const list = () => transaction("readonly", (store) => store.getAll(), ["summaries"]);
  const all = () => transaction("readonly", (store) => store.getAll());
  const get = (slug) => transaction("readonly", (store) => store.get(slug));
  function changed(detail) {
    const change = { ...detail, nonce: crypto.randomUUID() };
    try {
      const ignored = new Set(JSON.parse(localStorage.getItem("ketruyen-ebook-ignored-v1") || "[]"));
      if (detail.removed) ignored.add(detail.removed);
      for (const slug of detail.saved || []) ignored.delete(slug);
      localStorage.setItem("ketruyen-ebook-ignored-v1", JSON.stringify([...ignored].slice(-10000)));
    } catch (_) {}
    try { localStorage.setItem("ketruyen-ebooks-change-v1", JSON.stringify(change)); } catch (_) {}
    dispatchEvent(new CustomEvent("ketruyen-ebooks-change", { detail: change }));
  }
  const save = async (book) => { const result = await transaction("readwrite", (store, tx) => {
    const { txtSource, ...stored } = book;
    tx.objectStore("summaries").put(summary(stored));
    return store.put(stored);
  }, ["books", "summaries"]); changed({ saved: [book.slug] }); return result; };
  const remove = async (slug) => { const result = await transaction("readwrite", (store, tx) => {
    tx.objectStore("summaries").delete(slug); return store.delete(slug);
  }, ["books", "summaries"]); changed({ removed: slug }); return result; };
  const saveMany = async (books) => { const result = await transaction("readwrite", (store, tx) => {
    for (const book of books) { store.put(book); tx.objectStore("summaries").put(summary(book)); }
    return store.count();
  }, ["books", "summaries"]); changed({ saved: books.map((b) => b.slug) }); return result; };
  const urls = new Set();
  function hydrate(book) {
    if (!book.assets) {
      book.cover = book.coverBlob ? URL.createObjectURL(book.coverBlob) : "";
      if (book.cover) urls.add(book.cover);
      for (const volume of book.volumesData) volume.cover = book.cover;
      return book;
    }
    const assets = new Map(book.assets.map((asset) => {
      const url = URL.createObjectURL(asset.blob); urls.add(url); return [asset.key, url];
    }));
    book.cover = assets.get(book.coverAsset) || "";
    for (const volume of book.volumesData) {
      volume.cover = book.cover;
      for (const chapter of volume.chapters) for (const image of chapter.images) image.src = assets.get(image.asset) || "";
    }
    return book;
  }
  const loadingBooks = new Map();
  function load(book) {
    if (loadingBooks.has(book.slug)) return loadingBooks.get(book.slug);
    const request = loadBook(book).finally(() => loadingBooks.delete(book.slug));
    loadingBooks.set(book.slug, request); return request;
  }
  async function loadBook(book) {
    if (book.loaded) return;
    const full = await get(book.slug);
    if (!full) throw new Error("Ebook đã bị xóa khỏi thiết bị.");
    const imageUrls = new Map(full.assets.filter((asset) => asset.key !== full.coverAsset).map((asset) => {
      const url = URL.createObjectURL(asset.blob); urls.add(url); return [asset.key, url];
    }));
    imageUrls.set(full.coverAsset, book.cover);
    full.volumesData.forEach((volume, index) => volume.chapters.forEach((chapter, chapterIndex) => {
      for (const image of chapter.images || []) image.src = imageUrls.get(image.asset) || "";
      Object.assign(book.volumesData[index].chapters[chapterIndex], chapter);
    }));
    book.footnotes = full.footnotes || {}; book.loaded = true; book.imageUrls = imageUrls;
  }
  function release(book) {
    if (!book?.personal || !book.loaded) return;
    for (const url of book.imageUrls.values()) if (url && url !== book.cover) { URL.revokeObjectURL(url); urls.delete(url); }
    for (const volume of book.volumesData) for (const chapter of volume.chapters) {
      for (const key of ["content", "paragraphs", "folded", "rich", "blocks"]) delete chapter[key];
      for (const image of chapter.images) delete image.src;
    }
    delete book.footnotes; delete book.imageUrls; book.loaded = false;
  }
  if (globalThis.addEventListener) globalThis.addEventListener("pagehide", (event) => {
    if (!event.persisted) { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
  });

  function attachUI({ onSaved, message }) {
    const dialog = document.querySelector("#ebook-import-dialog");
    const input = document.querySelector("#ebook-file"), submit = document.querySelector("#ebook-save");
    const preview = document.querySelector("#ebook-preview"), status = document.querySelector("#ebook-status");
    const title = document.querySelector("#ebook-title"), author = document.querySelector("#ebook-author");
    const queue = document.querySelector("#ebook-queue"), drop = document.querySelector("#ebook-drop");
    const chapterSelect = document.querySelector("#ebook-txt-chapter"), mode = document.querySelector("#ebook-txt-mode");
    const pdfMode = document.querySelector("#ebook-pdf-mode"), cancelRead = document.querySelector("#ebook-cancel-read");
    const pdfJoin = document.querySelector("#ebook-pdf-join"), pdfClean = document.querySelector("#ebook-pdf-clean"), pdfPage = document.querySelector("#ebook-pdf-page");
    const pdfEdit = document.querySelector("#ebook-pdf-edit");
    let readController = null, previewController = null;
    let draft = null, drafts = [], rows = [], active = 0, token = 0, busy = false, lastSaved = null;
    document.querySelector("#btn-import-ebook").addEventListener("click", () => dialog.showModal());
    document.querySelector("#btn-import-ebook").disabled=false;
    document.querySelector("#ebook-close").addEventListener("click", () => { if (!busy) dialog.close(); });
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    dialog.addEventListener("click", (event) => {
      if (busy || event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => {
      readController?.abort(); previewController?.abort(); document.querySelector("#ebook-pdf-canvas").width=1;
      token++; draft = null; drafts = []; rows = []; queue.innerHTML = ""; preview.hidden = true; input.value = ""; status.textContent = ""; submit.disabled = true;
      if (lastSaved) { const slug = lastSaved; lastSaved = null; onSaved(slug); }
    });
    const setBusy = (value) => { busy = value; input.disabled = value; pdfMode.disabled=value; submit.disabled = value || !draft;
      preview.inert=value;
      document.querySelector("#ebook-close").disabled = value; dialog.setAttribute("aria-busy", String(value)); };
    function writeDraft() {
      if (!draft) return;
      commitPdfEdit();
      draft.titleVi = clean(title.value) || draft.titleVi; draft.author = clean(author.value);
      draft.volumesData[0].name = draft.titleVi; draft.volumesData[0].title = draft.titleVi;
    }
    function renderQueue() {
      queue.innerHTML = rows.map((row, index) => `<div class="ebook-queue-row"><span>${escape(row.name)}</span><span>${escape(row.status)}</span>${row.draft ? `<button type="button" class="btn-link" data-draft="${drafts.indexOf(row.draft)}"${busy ? " disabled" : ""}>${row.draft === draft ? "Đang sửa" : "Xem / Sửa"}</button>` : row.slug ? `<button type="button" class="btn-link" data-open-book="${index}"${busy ? " disabled" : ""}>Mở sách</button>` : ""}</div>`).join("");
      queue.querySelectorAll("[data-draft]").forEach((button) => button.onclick = () => { writeDraft(); selectDraft(Number(button.dataset.draft)); });
      queue.querySelectorAll("[data-open-book]").forEach((button) => button.onclick = () => onSaved(rows[Number(button.dataset.openBook)].slug));
      submit.textContent = drafts.length > 1 ? `Thêm ${drafts.length} sách vào kệ` : "Thêm vào kệ";
    }
    function txtPreview() {
      if (!draft || !["TXT","PDF-TEXT"].includes(draft.sourceFormat)) return;
      const chapters = draft.volumesData[0].chapters;
      const index = Math.max(0, Math.min(chapters.length - 1, Number(chapterSelect.value) || 0));
      chapterSelect.innerHTML = chapters.map((chapter, i) => `<option value="${i}">${i + 1}. ${escape(chapter.title)}</option>`).join(""); chapterSelect.value = String(index);
      const chapter = chapters[index];
      document.querySelector("#ebook-txt-name").value = chapter.title;
      document.querySelector("#ebook-txt-preview").textContent = chapter.content.slice(0, 4000);
      pdfEdit.value = chapter.content; pdfEdit.dataset.chapter=String(index); pdfEdit.dataset.dirty="false";
      document.querySelector("#ebook-txt-paragraph").innerHTML = chapter.paragraphs.slice(1).map((p, i) => `<option value="${i + 1}">Trước đoạn ${i + 2}: ${escape(p.slice(0, 65))}</option>`).join("");
      document.querySelector("#ebook-txt-merge").disabled = index >= chapters.length - 1;
      document.querySelector("#ebook-txt-split").disabled = chapter.paragraphs.length < 2 || chapters.length >= MAX_CHAPTERS;
      document.querySelector("#ebook-summary").textContent = `${draft.chapters} chương · ${draft.volumesData[0].words.toLocaleString("vi")} từ`;
    }
    function selectDraft(index) {
      previewController?.abort(); document.querySelector("#ebook-pdf-canvas").hidden=true;
      active = index; draft = drafts[index] || null; preview.hidden = !draft;
      if (draft) {
        title.value = draft.titleVi; author.value = draft.author;
        document.querySelector("#ebook-summary").textContent = `${draft.chapters} ${draft.sourceFormat === "PDF" ? "trang" : "chương"} · ${draft.volumesData[0].words.toLocaleString("vi")} từ`;
        const isPdf = draft.sourceFormat === "PDF-TEXT";
        document.querySelector("#ebook-txt-tools").hidden = !["TXT","PDF-TEXT"].includes(draft.sourceFormat);
        document.querySelector("#ebook-pdf-tools").hidden = !isPdf;
        document.querySelector("#ebook-pdf-editor").hidden = !isPdf;
        for (const option of mode.options) if (option.value.startsWith("pdf")) option.hidden=!isPdf;
        if (isPdf) paintPdf();
        mode.value = draft.txtMode || "auto"; chapterSelect.value = "0"; txtPreview();
      }
      renderQueue(); submit.disabled = busy || !draft;
    }
    async function readFiles(files) {
      if (busy || !files.length) return;
      if (files.length > 30 || files.reduce((sum, file) => sum + file.size, 0) > MAX_EXPANDED) { status.textContent = "Mỗi lần tối đa 30 tệp, tổng dung lượng tối đa 150 MB."; return; }
      const ownToken = ++token; draft = null; drafts = []; rows = []; preview.hidden = true; readController=new AbortController(); cancelRead.hidden=false; setBusy(true);
      try {
        const existing = await list();
        for (const file of files) {
          if (readController.signal.aborted) break;
          const row = { name: file.name, status: "Đang đọc…" }; rows.push(row); renderQueue();
          try {
            const parsed = await parseFile(file, (value) => { status.textContent = `${file.name} · ${value}`; }, {pdfMode:pdfMode.value,signal:readController.signal});
            if (ownToken !== token) return;
            const duplicate = existing.find((book) => book.digest === parsed.digest) || drafts.find((book) => book.digest === parsed.digest);
            if (duplicate) { row.status = "Đã có / trùng tệp"; if (existing.includes(duplicate)) row.slug = duplicate.slug; }
            else { row.draft = parsed; row.status = parsed.warnings || "Sẵn sàng"; drafts.push(parsed); }
          } catch (error) { row.status = error.name === "AbortError" ? "Đã hủy xử lý" : error.message || "Không đọc được tệp"; }
          renderQueue();
        }
        selectDraft(0);
        status.textContent = readController.signal.aborted ? "Đã hủy xử lý. Các bản nháp hoàn tất vẫn ở đây; chưa lưu sách mới vào kệ." : drafts.length ? `Đã đọc ${drafts.length} sách. Bạn có thể sửa từng sách trước khi thêm.` : "Không có sách mới để nhập. Xem kết quả từng tệp ở trên.";
      } catch (_) { status.textContent = "Không truy cập được kệ ebook. Kiểm tra quyền lưu trữ rồi thử lại."; }
      finally { if (ownToken === token) { readController=null; cancelRead.hidden=true; setBusy(false); renderQueue(); } }
    }
    cancelRead.onclick = () => { readController?.abort(); };
    function commitPdfEdit() {
      if (!draft || draft.sourceFormat !== "PDF-TEXT" || pdfEdit.dataset.dirty !== "true") return;
      const index=Number(pdfEdit.dataset.chapter), chapter=draft.volumesData[0].chapters[index]; if (!chapter) return;
      const paragraphs=pdfEdit.value.replace(/\r\n?/g,"\n").normalize("NFC").split(/\n\s*\n/).map(clean).filter(Boolean);
      if (!paragraphs.length) { status.textContent="Chương không được để trống. Nội dung trước đó vẫn được giữ."; pdfEdit.value=chapter.content; }
      else { draft.volumesData[0].chapters[index]=makeChapter(chapter.title,paragraphs); updateChapters(draft,draft.volumesData[0].chapters); pdfDrafts.get(draft).edited=true; }
      pdfEdit.dataset.dirty="false";
    }
    pdfEdit.oninput = () => { pdfEdit.dataset.dirty="true"; };
    pdfEdit.onchange = () => { commitPdfEdit(); txtPreview(); };
    function paintPdf() {
      const source=pdfDrafts.get(draft); if (!source) return;
      pdfJoin.checked=source.settings.joinLines; pdfClean.checked=source.settings.removeRepeated;
      const result=source.result;
      document.querySelector("#ebook-pdf-report").textContent=`${source.pages.length} trang · ${result.removed.length} dòng đầu/chân trang đã bỏ · ${result.chapterMethod === "pages" ? "Chưa xác định chương, đang chia theo trang." : result.chapterMethod === "single" ? "Gộp thành một chương." : "Đã nhận diện chương."} ${draft.warnings}`;
      const current=pdfPage.value; pdfPage.innerHTML=source.pages.map((_,i)=>`<option value="${i}">Trang ${i+1}${source.pages[i].lines.length ? "" : " · Không có chữ"}</option>`).join(""); pdfPage.value=Number(current) < source.pages.length ? current || "0" : "0"; // another draft may have fewer pages
      paintPdfPageText();
    }
    function paintPdfPageText() {
      const source=pdfDrafts.get(draft); document.querySelector("#ebook-pdf-page-text").textContent=source?.result.pageTexts[Number(pdfPage.value)] || "Trang này không có chữ trích xuất.";
      document.querySelector("#ebook-pdf-canvas").hidden=true; document.querySelector("#ebook-pdf-page-status").textContent=""; previewController?.abort();
    }
    pdfPage.onchange=paintPdfPageText;
    document.querySelector("#ebook-pdf-compare").onclick=async () => {
      const source=pdfDrafts.get(draft); if (!source || busy) return;
      previewController?.abort(); const controller=new AbortController(); previewController=controller;
      const canvas=document.querySelector("#ebook-pdf-canvas"), label=document.querySelector("#ebook-pdf-page-status"); label.textContent="Đang mở trang gốc…";
      try { await PdfReader.previewPage(source.bytes.slice(),Number(pdfPage.value),canvas,controller.signal); if (!controller.signal.aborted) { canvas.hidden=false; label.textContent="Trang gốc và chữ trích xuất để đối chiếu."; } }
      catch (_) { if (!controller.signal.aborted) label.textContent="Không mở được ảnh trang gốc. Chữ trong bản nháp vẫn được giữ."; }
    };
    async function rebuildPdfUI() {
      if (!pdfDrafts.has(draft)) return;
      commitPdfEdit(); const source=pdfDrafts.get(draft);
      if (source.edited && !await AppDialog.confirm({title:"Dựng lại bản chữ?",message:"Các tên chương, tách/gộp và chữ bạn đã sửa trong bản nháp sẽ được thay bằng kết quả chuyển đổi mới.",confirmLabel:"Dựng lại"})) { mode.value=draft.txtMode; pdfJoin.checked=source.settings.joinLines; pdfClean.checked=source.settings.removeRepeated; return; }
      const oldMode=draft.txtMode;
      try { draft.txtMode=mode.value; rebuildPdf(draft,{joinLines:pdfJoin.checked,removeRepeated:pdfClean.checked,chapterMode:mode.value === "pdf-pages" ? "pages" : mode.value === "single" ? "single" : "auto"}); chapterSelect.value="0"; paintPdf(); txtPreview(); }
      catch(error) { draft.txtMode=oldMode; mode.value=oldMode; pdfJoin.checked=source.settings.joinLines; pdfClean.checked=source.settings.removeRepeated; status.textContent=error.message; }
    }
    pdfJoin.onchange=pdfClean.onchange=rebuildPdfUI;
    document.querySelector("#ebook-pdf-download").onclick=() => {
      if (!draft || draft.sourceFormat !== "PDF-TEXT" || busy) return; writeDraft();
      const text=draft.volumesData[0].chapters.map((c)=>`${c.title}\n\n${c.content}`).join("\n\n");
      const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"})), link=document.createElement("a");
      link.href=url; link.download=(draft.titleVi.replace(/[<>:"/\\|?*]/g,"_") || "sach")+".txt"; link.click(); setTimeout(()=>URL.revokeObjectURL(url),60000);
    };
    input.addEventListener("change", () => readFiles([...input.files]));
    drop.onclick = () => { if (!busy) input.click(); };
    drop.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (!busy) input.click(); } };
    drop.ondragover = (event) => { event.preventDefault(); drop.classList.add("is-dragging"); };
    drop.ondragleave = () => drop.classList.remove("is-dragging");
    drop.ondrop = (event) => { event.preventDefault(); drop.classList.remove("is-dragging"); readFiles([...event.dataTransfer.files]); };
    mode.onchange = () => {
      if (draft?.sourceFormat === "PDF-TEXT") return rebuildPdfUI();
      if (!draft?.txtSource) return;
      try { draft.txtMode = mode.value; updateChapters(draft, textChapters(draft.txtSource, draft.titleVi, mode.value)); chapterSelect.value = "0"; txtPreview(); }
      catch (error) { status.textContent = error.message; }
    };
    chapterSelect.onchange = txtPreview;
    document.querySelector("#ebook-txt-name").oninput = (event) => {
      if (!draft) return; const index = Number(chapterSelect.value);
      draft.volumesData[0].chapters[index].title = clean(event.target.value) || "Chương";
      chapterSelect.options[index].textContent = `${index + 1}. ${draft.volumesData[0].chapters[index].title}`;
      if (pdfDrafts.has(draft)) pdfDrafts.get(draft).edited=true;
    };
    document.querySelector("#ebook-txt-merge").onclick = () => { commitPdfEdit(); updateChapters(draft, mergeTextChapters(draft.volumesData[0].chapters, Number(chapterSelect.value))); if (pdfDrafts.has(draft)) pdfDrafts.get(draft).edited=true; txtPreview(); };
    document.querySelector("#ebook-txt-split").onclick = () => { commitPdfEdit(); updateChapters(draft, splitTextChapter(draft.volumesData[0].chapters, Number(chapterSelect.value), Number(document.querySelector("#ebook-txt-paragraph").value))); if (pdfDrafts.has(draft)) pdfDrafts.get(draft).edited=true; txtPreview(); };
    document.querySelector("#ebook-import-form").addEventListener("submit", async (event) => {
      event.preventDefault(); if (!drafts.length || busy) return;
      writeDraft();
      setBusy(true); status.textContent = "Đang lưu ebook…";
      const failed = [];
      for (const book of drafts) {
        const row = rows.find((row) => row.draft === book);
        try {
          if (book.coverAsset === "fallback-cover") book.assets.find((item) => item.key === "fallback-cover").blob = await fallbackCover(book.titleVi);
          await save(book); lastSaved = book.slug; row.status = "Đã thêm vào kệ"; delete row.draft;
        } catch (error) { failed.push(book); row.status = error.name === "QuotaExceededError" ? "Bộ nhớ đã đầy" : "Không lưu được, có thể thử lại"; }
        renderQueue();
      }
      drafts = failed;
      if (!failed.length && lastSaved) {
        if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
        onSaved(lastSaved);
      } else {
        setBusy(false); selectDraft(0);
        status.textContent = `Còn ${failed.length} sách chưa lưu được. Kiểm tra chỗ trống/quyền lưu trữ rồi thử lại, hoặc đóng để xem các sách đã thêm.`;
      }
    });
    return { async deleteBook(book, settings = {}) {
      const confirmed = settings.confirmed || await AppDialog.confirm({ title: `Xóa “${book.titleVi}” khỏi thiết bị này?`, message: "Tệp ebook sẽ bị xóa khỏi trình duyệt. Ghi chú và tiến độ đọc vẫn được giữ để bạn nhập lại sau.", confirmLabel: "Xóa ebook", danger: true });
      if (!confirmed) return;
      try { await remove(book.slug); settings.onDeleted?.(); location.href = "/"; }
      catch (_) { message("Không xóa được ebook. Hãy thử lại."); }
    } };
  }

  return { loadZip, archivePath, decodeText, textChapters, inspectArchive, rasterDimensions, rasterType, parseFile, list, all, get, save, saveMany, remove, hydrate, load, release, attachUI, summary, fallbackCover, updateChapters, mergeTextChapters, splitTextChapter, renderRich, renderBlocks };
});
