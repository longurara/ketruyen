(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./reader-journal") : root.ReaderJournal);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LibraryBackup = api;
})(globalThis, function (journalCore) {
  "use strict";
  const MAX_BACKUP = 512 * 1024 * 1024, MAX_EXPANDED = 1024 * 1024 * 1024;
  const text = (value, max = 1000) => typeof value === "string" ? value.slice(0, max) : "";
  const fail = () => { throw new Error("Bản sao lưu bị hỏng hoặc không đúng định dạng."); };
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);

  function validateSettings(value) {
    if (!object(value) || Object.keys(value).length > 20000) fail();
    const settings = {};
    for (const [key, item] of Object.entries(value)) {
      if (!/^tenshi-[a-z\d_-]{1,100}$/i.test(key) || typeof item !== "string" || item.length > 5 * 1024 * 1024) fail();
      if (key === "tenshi-ui-size-v1" && !["standard", "large"].includes(item)) fail();
      if (key.startsWith("tenshi-journal-")) { let record; try { record = JSON.parse(item); } catch (_) { fail(); } if (!journalCore?.valid(key.slice(journalCore.PREFIX.length), record)) fail(); }
      if (key === "tenshi-reader-tools-v1") {
        let state; try { state = JSON.parse(item); } catch (_) { fail(); }
        if (!object(state) || state.version !== 1) fail();
        for (const list of Object.values(state.characters || {})) {
          if (!Array.isArray(list) || list.some((entry) => !/^[a-z\d_-]{1,150}$/i.test(entry?.id) || typeof entry.name !== "string" || typeof entry.note !== "string" || !Array.isArray(entry.aliases) || entry.aliases.some((alias) => typeof alias !== "string"))) fail();
        }
        if (state.quotes && (!Array.isArray(state.quotes) || state.quotes.some((entry) => !/^[a-z\d_-]{1,150}$/i.test(entry?.id) || typeof entry.text !== "string" || entry.text.length > 600))) fail();
      }
      if (/(?:progress|chapters|history|reader-tools-v1|library-v1)$/.test(key)) {
        try { const parsed = JSON.parse(item); if (parsed !== null && typeof parsed !== "object") fail(); } catch (_) { fail(); }
      }
      settings[key] = item;
    }
    return settings;
  }

  function validateBook(value) {
    if (!object(value) || !/^ebook-[a-f\d]{24}$/.test(value.slug) || !/^[a-f\d]{64}$/.test(value.digest) || value.slug !== `ebook-${value.digest.slice(0, 24)}` || !Array.isArray(value.assets) || value.assets.length > 10000 || !Array.isArray(value.volumesData) || value.volumesData.length !== 1) fail();
    const assets = value.assets.map((asset) => {
      if (!object(asset) || !/^[\w-]{1,100}$/.test(asset.key) || !(asset.blob instanceof Blob) || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(asset.blob.type) || asset.blob.size > 20 * 1024 * 1024) fail();
      if (!Number.isFinite(asset.w) || !Number.isFinite(asset.h) || asset.w <= 0 || asset.h <= 0 || asset.w * asset.h > 40000000) fail();
      return { key: asset.key, blob: asset.blob, w: asset.w, h: asset.h };
    });
    if (new Set(assets.map((asset) => asset.key)).size !== assets.length) fail();
    const volume = value.volumesData[0];
    if (!object(volume) || !Array.isArray(volume.chapters) || !volume.chapters.length || volume.chapters.length > 3000) fail();
    const chapters = volume.chapters.map((chapter) => {
      if (!object(chapter) || typeof chapter.content !== "string" || chapter.content.length > 75000000) fail();
      const paragraphs = chapter.paragraphs || chapter.content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      if (!Array.isArray(paragraphs) || paragraphs.some((p) => typeof p !== "string") || paragraphs.join("\n\n") !== chapter.content) fail();
      const images = (chapter.images || []).map((image) => {
        const asset = assets.find((entry) => entry.key === image.asset); if (!asset) fail();
        return { asset: asset.key, w: asset.w, h: asset.h };
      });
      const blocks = chapter.blocks?.map((block) => {
        if (Number.isInteger(block.p) && block.p >= 0 && block.p < paragraphs.length) {
          return { p: block.p, ...(block.list === "ol" || block.list === "ul" ? { list: block.list, level: Math.max(0, Math.min(5, Number(block.level) || 0)), ordinal: Math.max(1, Number(block.ordinal) || 1) } : {}) };
        }
        if (Number.isInteger(block.image) && block.image >= 0 && block.image < images.length) return { image: block.image };
        fail();
      });
      const rich = chapter.rich?.map((runs, index) => {
        if (!Array.isArray(runs) || runs.map((run) => run.text).join("") !== paragraphs[index]) fail();
        return runs.map((run) => ({ text: text(run.text, 75000000), marks: (Array.isArray(run.marks) ? run.marks : []).filter((mark) => ["strong", "em", "u", "s", "code", "sup", "sub"].includes(mark)), ...(run.note ? { note: text(run.note, 1000) } : {}) }));
      });
      return { title: text(chapter.title, 250) || "Chương", content: chapter.content, paragraphs,
        words: paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length, images,
        isIllustration: value.sourceFormat !== "PDF" && !paragraphs.length && images.length > 0, ...(blocks ? { blocks } : {}), ...(rich ? { rich } : {}) };
    });
    const toc = (Array.isArray(value.toc) ? value.toc : []).slice(0, 10000).filter((item) => Number.isInteger(item.chapIdx) && chapters[item.chapIdx])
      .map((item) => ({ title: text(item.title, 250), chapIdx: item.chapIdx, p: Math.max(0, Math.min(chapters[item.chapIdx].paragraphs.length - 1, Number(item.p) || 0)), depth: Math.max(0, Math.min(8, Number(item.depth) || 0)) }));
    const footnotes = Object.fromEntries(Object.entries(object(value.footnotes) ? value.footnotes : {}).slice(0, 10000).map(([key, note]) => [text(key, 1000), text(note, 8 * 1024 * 1024)]));
    return { slug: value.slug, digest: value.digest, personal: true, titleVi: text(value.titleVi, 250) || "Ebook",
      titleJp: "", author: text(value.author, 150), illustrator: "", status: "Lưu trên thiết bị",
      tags: [text(value.sourceFormat, 10), "Ebook cá nhân"], description: text(value.description, 4000),
      sourceFilename: text(value.sourceFilename, 250), sourceFormat: text(value.sourceFormat, 10),
      importedAt: Number(value.importedAt) || Date.now(), sourceBytes: Number(value.sourceBytes) || 0,
      volumes: 1, chapters: chapters.length, assets, coverAsset: assets.some((a) => a.key === value.coverAsset) ? value.coverAsset : assets[0]?.key,
      toc, footnotes, warnings: "", volumesData: [{ name: text(value.titleVi, 250), title: text(value.titleVi, 250), dirName: "ebook", bytes: Number(value.sourceBytes) || 0, words: chapters.reduce((sum, c) => sum + c.words, 0), chapters }] };
  }

  function readEntry(zip, path, limit, budget) {
    if (!zip.file(path)) fail();
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [], stream = zip.file(path).internalStream("uint8array");
      stream.on("data", (chunk) => {
        size += chunk.length; budget.bytes += chunk.length;
        if (size > limit || budget.bytes > (budget.limit || MAX_EXPANDED)) { stream.pause(); reject(new Error("Bản sao lưu vượt quá dung lượng cho phép.")); }
        else chunks.push(chunk);
      }).on("error", reject).on("end", () => {
        const data = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        resolve(data);
      }).resume();
    });
  }
  async function exportData(report = () => {}, selectedBooks) {
    const JSZip = await EbookImport.loadZip(), zip = new JSZip(), books = selectedBooks || await EbookImport.all(), settings = {};
    for (let i = 0; !selectedBooks && i < localStorage.length; i++) {
      const key = localStorage.key(i); if (key.startsWith("tenshi-")) settings[key] = localStorage.getItem(key);
    }
    let expanded = 0, entries = 1;
    if (books.length > 1000) throw new Error("Một bản sao lưu hỗ trợ tối đa 1.000 ebook.");
    for (const book of books) {
      const assets = [];
      for (let i = 0; i < book.assets.length; i++) {
        const asset = book.assets[i], path = `assets/${book.slug}/${i}`;
        expanded += asset.blob.size; entries++;
        if (expanded > MAX_EXPANDED || entries > 20000) throw new Error("Thư viện vượt giới hạn sao lưu: 1 GB nội dung hoặc 20.000 tệp.");
        zip.file(path, await asset.blob.arrayBuffer());
        assets.push({ key: asset.key, type: asset.blob.type, w: asset.w, h: asset.h, path });
      }
      const json = JSON.stringify({ ...book, assets });
      expanded += new TextEncoder().encode(json).length; entries++;
      if (expanded > MAX_EXPANDED || entries > 20000) throw new Error("Thư viện vượt giới hạn sao lưu: 1 GB nội dung hoặc 20.000 tệp.");
      zip.file(`books/${book.slug}.json`, json);
    }
    zip.file("library.json", JSON.stringify({ format: "tenshi-library", version: 1, createdAt: new Date().toISOString(), books: books.map((book) => book.slug), settings }));
    const result = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } }, (meta) => report(`Đang tạo bản sao lưu… ${Math.round(meta.percent)}%`));
    if (result.size > MAX_BACKUP) throw new Error("Tệp sao lưu vượt quá 512 MB.");
    return result;
  }
  async function readBackup(file, report = () => {}, limits = {}) {
    if (!file.size || file.size > (limits.maxFile || MAX_BACKUP)) throw new Error("Bản sao lưu vượt quá dung lượng cho phép.");
    const bytes = new Uint8Array(await file.arrayBuffer()); EbookImport.inspectArchive(bytes, limits.maxExpanded || MAX_EXPANDED, 20000);
    const JSZip = await EbookImport.loadZip(), zip = await JSZip.loadAsync(bytes), budget = { bytes: 0, limit: limits.maxExpanded || MAX_EXPANDED };
    const json = async (path, cap) => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEntry(zip, path, cap, budget))); } catch (_) { fail(); } };
    const manifest = await json("library.json", 10 * 1024 * 1024);
    if (manifest.format !== "tenshi-library" || manifest.version !== 1 || !Array.isArray(manifest.books) || manifest.books.length > (limits.maxBooks || 1000) || new Set(manifest.books).size !== manifest.books.length) fail();
    const settings = validateSettings(manifest.settings), books = [];
    for (const slug of manifest.books) {
      if (!/^ebook-[a-f\d]{24}$/.test(slug)) fail();
      report(`Đang kiểm tra sách… ${books.length + 1}/${manifest.books.length}`);
      const raw = await json(`books/${slug}.json`, MAX_EXPANDED);
      if (raw.slug !== slug || !Array.isArray(raw.assets)) fail();
      for (let i = 0; i < raw.assets.length; i++) {
        const asset = raw.assets[i]; if (asset.path !== `assets/${slug}/${i}`) fail();
        const data = await readEntry(zip, asset.path, 20 * 1024 * 1024, budget);
        if (EbookImport.rasterType(data) !== asset.type) fail();
        const size = EbookImport.rasterDimensions(data, asset.type);
        if (!size || size[0] !== asset.w || size[1] !== asset.h) fail();
        asset.blob = new Blob([data], { type: asset.type });
      }
      books.push(validateBook(raw));
    }
    return { books, settings, createdAt: text(manifest.createdAt, 100) };
  }
  async function restore(data) {
    const previous = new Map(Object.keys(data.settings).map((key) => [key, localStorage.getItem(key)]));
    try {
      for (const [key, value] of Object.entries(data.settings)) localStorage.setItem(key, value);
      await EbookImport.saveMany(data.books);
    } catch (error) {
      // Free the changed keys first: restoring a larger old value must not
      // temporarily exceed quota while another changed key is still large.
      for (const key of previous.keys()) localStorage.removeItem(key);
      for (const [key, value] of previous) if (value !== null) localStorage.setItem(key, value);
      throw error;
    }
  }
  return { exportData, readBackup, restore, validateBook, validateSettings };
});
