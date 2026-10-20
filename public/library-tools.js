(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LibraryTools = api;
})(globalThis, function () {
  "use strict";
  const KEY = "tenshi-library-v1";
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fold = (value) => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  function locatePart(text, part) {
    if (!part.quote) return null;
    if (text.slice(part.start, part.end) === part.quote) return { start: part.start, end: part.end };
    let index = text.indexOf(part.quote), best = null, score = -Infinity;
    while (index >= 0) {
      const current = (part.prefix && text.slice(Math.max(0, index - part.prefix.length), index) === part.prefix ? 100000 : 0)
        + (part.suffix && text.slice(index + part.quote.length, index + part.quote.length + part.suffix.length) === part.suffix ? 100000 : 0) - Math.abs(index - part.start);
      if (current > score) { score = current; best = { start: index, end: index + part.quote.length }; }
      index = text.indexOf(part.quote, index + 1);
    }
    return best;
  }
  function normalizeState(value) {
    const source = value?.version === 1 ? value : {};
    const books = Object.fromEntries(Object.entries(source.books || {}).filter(([key]) => /^[a-z\d_-]{1,100}$/i.test(key)).map(([key, row]) => [key, {
      favorite: row?.favorite === true, status: ["want", "reading", "done"].includes(row?.status) ? row.status : "",
      groups: (Array.isArray(row?.groups) ? row.groups : []).filter((g) => typeof g === "string").map((g) => g.trim().slice(0, 60)).filter(Boolean).slice(0, 10)
    }]));
    const marks = (Array.isArray(source.marks) ? source.marks : []).filter((m) => m && /^[a-z\d_-]{1,100}$/i.test(m.id) && typeof m.slug === "string" && Number.isInteger(m.volIdx) && Number.isInteger(m.chapIdx) && m.volIdx >= 0 && m.chapIdx >= 0)
      .slice(-5000).map((m) => ({ ...m, type: m.type === "bookmark" ? "bookmark" : "highlight", label: String(m.label || "").slice(0, 160), note: String(m.note || "").slice(0, 4000),
        color: ["yellow", "mint", "pink"].includes(m.color) ? m.color : "yellow",
        parts: (Array.isArray(m.parts) ? m.parts : []).filter((p) => Number.isInteger(p.p) && p.p >= 0 && Number.isInteger(p.start) && Number.isInteger(p.end) && p.start >= 0 && p.end > p.start && typeof p.quote === "string")
          .slice(0, 50).map((p) => ({ p: p.p, start: p.start, end: p.end, quote: p.quote.slice(0, 6000), prefix: String(p.prefix || "").slice(0, 40), suffix: String(p.suffix || "").slice(0, 40) })),
        anchor: { block: Math.floor(clamp(m.anchor?.block, 0, 1000000, 0)), offset: clamp(m.anchor?.offset, 0, 1, 0), ...(Number.isInteger(m.anchor?.textOffset) && m.anchor.textOffset >= 0 ? { textOffset: Math.min(1000000, m.anchor.textOffset) } : {}) } }));
    return { version: 1, books, marks, layout: { width: clamp(source.layout?.width, 460, 1100, 700), margin: clamp(source.layout?.margin, 12, 64, 48), gap: clamp(source.layout?.gap, 0.4, 2, 0.85) } };
  }
  function highlightRange(element, from, to, attributes) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = []; let node, offset = 0;
    while ((node = walker.nextNode())) { nodes.push({ node, start: offset }); offset += node.length; }
    for (const entry of nodes) {
      const start = Math.max(0, from - entry.start), end = Math.min(entry.node.length, to - entry.start);
      if (start >= end) continue;
      const range = document.createRange(); range.setStart(entry.node, start); range.setEnd(entry.node, end);
      const highlight = document.createElement("mark");
      if (attributes.className) highlight.className = attributes.className;
      if (attributes.id) { highlight.dataset.readerMark = attributes.id; highlight.dataset.color = attributes.color; highlight.title = attributes.title; }
      range.surroundContents(highlight);
    }
  }

  function create(options) {
    const $ = (selector) => document.querySelector(selector);
    let stored; try { stored = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
    const state = normalizeState(stored);
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
      catch (_) {
        const message = "Không lưu được thay đổi. Kiểm tra dung lượng hoặc quyền lưu dữ liệu.";
        if (document.querySelector("#library-dialog")?.open || document.querySelector("#workbench-dialog")?.open) feedback(message); else options.message(message);
        return false;
      }
    }
    document.body.insertAdjacentHTML("beforeend", `<dialog id="library-dialog" class="tools-dialog" aria-labelledby="library-title"><div class="tools-heading"><h2 id="library-title"></h2><button type="button" class="tools-close" aria-label="Đóng">×</button></div><div id="library-tools-panel" class="tools-panel"></div><p id="library-feedback" class="tools-feedback" role="status" hidden></p></dialog>`);
    const dialog = $("#library-dialog"), panel = $("#library-tools-panel");
    let embeddedHost = null;
    const isOpen = () => embeddedHost ? embeddedHost.isOpen() : dialog.open;
    function close() { if (embeddedHost) embeddedHost.close(); else dialog.close(); }
    let opener = null, busy = false, markScope = "", pendingSelection = null;
    function feedback(message) { const el = $("#library-feedback"); el.hidden = false; el.textContent = message; }
    function show(title, html) {
      $("#reader-tools-dialog")?.close(); $("#reader-selection-tools").hidden = true;
      $("#library-title").textContent = title; $("#library-feedback").hidden = true;
      panel.innerHTML = html;
      if (embeddedHost) { embeddedHost.show(title); return; }
      if (!dialog.open) { opener = document.activeElement; dialog.showModal(); }
    }
    dialog.querySelector(".tools-close").addEventListener("click", () => { if (!busy) dialog.close(); });
    dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => opener?.focus({ preventScroll: true }));
    const ctx = () => options.context();
    const row = (series) => state.books[series.slug] || { favorite: false, status: "", groups: [] };
    function progress(series) {
      try { return JSON.parse(localStorage.getItem(series.legacyStorage ? "tenshi-progress" : `tenshi-${series.slug}-progress`)) || {}; }
      catch (_) { return {}; }
    }
    function status(series) {
      if (row(series).status) return row(series).status;
      try {
        const chapters = JSON.parse(localStorage.getItem(series.legacyStorage ? "tenshi-chapters" : `tenshi-${series.slug}-chapters`)) || {};
        const entries = (series.volumesData || []).flatMap((v, vi) => v.chapters.map((c, ci) => ({ c, id: `${vi}:${ci}` }))).filter((entry) => !entry.c.isIllustration);
        if (entries.length && entries.every((entry) => chapters[entry.id]?.done)) return "done";
      } catch (_) {}
      return progress(series).timestamp ? "reading" : "";
    }
    function updateGroups() {
      const select = $("#shelf-group"), previous = select.value;
      const groups = [...new Set(Object.values(state.books).flatMap((item) => item.groups))].sort((a, b) => a.localeCompare(b, "vi"));
      select.innerHTML = '<option value="">Tất cả nhóm</option>' + groups.map((g) => `<option value="${escape(g)}">${escape(g)}</option>`).join("");
      if (groups.includes(previous)) select.value = previous;
    }
    const filterToggle = $("#shelf-filter-toggle"), advancedFilters = $("#shelf-advanced-filters"), shelfMore = $("#shelf-more");
    filterToggle.addEventListener("click", () => {
      const expanded = filterToggle.getAttribute("aria-expanded") !== "true";
      filterToggle.setAttribute("aria-expanded", String(expanded));
      advancedFilters.classList.toggle("is-expanded", expanded);
    });
    function updateFilterSummary() {
      const active = Number($("#shelf-status").value !== "all") + Number(Boolean($("#shelf-group").value)) + Number($("#shelf-sort").value !== "recent");
      filterToggle.querySelector("span").textContent = active ? `Lọc (${active})` : "Lọc";
      filterToggle.classList.toggle("has-active-filters", Boolean(active));
      filterToggle.setAttribute("aria-label", active ? `Lọc và sắp xếp, ${active} tùy chọn đang áp dụng` : "Lọc và sắp xếp sách");
    }
    shelfMore.addEventListener("click", (event) => {
      if (event.target.closest("button")) { shelfMore.open = false; shelfMore.querySelector("summary").focus({ preventScroll: true }); }
    }, true);
    document.addEventListener("click", (event) => {
      if (shelfMore.open && !shelfMore.contains(event.target)) shelfMore.open = false;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && shelfMore.open && shelfMore.contains(document.activeElement)) {
        shelfMore.open = false; shelfMore.querySelector("summary").focus(); event.preventDefault();
      }
    });
    function updateShelfResume(series) {
      const host = $("#shelf-resume");
      const recent = series.map((book) => ({ book, saved: progress(book) }))
        .filter(({ book, saved }) => Number.isInteger(saved.volIdx) && Number.isInteger(saved.chapIdx) && Number(saved.timestamp) > 0 && book.volumesData?.[saved.volIdx]?.chapters[saved.chapIdx])
        .sort((a, b) => Number(b.saved.timestamp) - Number(a.saved.timestamp))[0];
      host.hidden = !recent;
      if (!recent) { host.replaceChildren(); return; }
      const { book, saved } = recent, volume = book.volumesData[saved.volIdx], chapter = volume.chapters[saved.chapIdx];
      host.innerHTML = `<button type="button" class="shelf-resume-card" aria-label="Đọc tiếp ${escape(book.titleVi)}, ${escape(chapter.title)}">${book.cover ? `<img class="shelf-resume-cover" src="${escape(book.cover)}" alt="">` : ""}<span class="shelf-resume-copy"><span class="shelf-resume-label">Đọc tiếp</span><strong>${escape(book.titleVi)}</strong><span class="shelf-resume-chapter">${escape(volume.name || volume.title)} · ${escape(chapter.title)}</span></span><span class="shelf-resume-arrow" aria-hidden="true">→</span></button>`;
      host.querySelector("button").onclick = () => options.openMark(options.series.indexOf(book), { type: "bookmark", volIdx: saved.volIdx, chapIdx: saved.chapIdx });
    }
    let activeSection = "main";
    const sectionTabs = $("#shelf-section-tabs");
    function setSection(nextSection, shouldRender = false) {
      const normalized = nextSection === "hlc-ln" ? "hlc-ln" : "main";
      if (normalized === activeSection && !shouldRender) return;
      activeSection = normalized;
      if (sectionTabs) {
        for (const tab of sectionTabs.querySelectorAll("[data-shelf-section]")) {
          const selected = tab.dataset.shelfSection === activeSection;
          tab.classList.toggle("is-active", selected);
          tab.setAttribute("aria-selected", String(selected));
        }
      }
      if (shouldRender) options.renderShelf();
    }
    if (sectionTabs) {
      sectionTabs.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-shelf-section]");
        if (btn) setSection(btn.dataset.shelfSection, true);
      });
    }
    function updateSectionCounts(series) {
      const mainCountEl = $("#shelf-count-main");
      const hlcCountEl = $("#shelf-count-hlc");
      if (!mainCountEl && !hlcCountEl) return;
      let mainCount = 0;
      let hlcCount = 0;
      for (const book of series) {
        if (book.section === "hlc-ln") hlcCount++;
        else mainCount++;
      }
      if (mainCountEl) mainCountEl.textContent = mainCount ? String(mainCount) : "";
      if (hlcCountEl) hlcCountEl.textContent = hlcCount ? String(hlcCount) : "";
    }
    function filterSeries(series) {
      updateFilterSummary(); updateShelfResume(series); updateSectionCounts(series);
      const query = fold($("#shelf-search").value), filter = $("#shelf-status").value, group = $("#shelf-group").value, sort = $("#shelf-sort").value;
      const result = series.filter((book) => ((book.section || "main") === activeSection)
        && (!query || fold([book.titleVi, book.author, ...row(book).groups, ...(book.tags || [])].join(" ")).includes(query))
        && (!group || row(book).groups.includes(group)) && (filter === "all" || (filter === "favorite" ? row(book).favorite : filter === "personal" ? book.personal : status(book) === filter)));
      return result.sort((a, b) => sort === "title" ? a.titleVi.localeCompare(b.titleVi, "vi") : sort === "author" ? a.author.localeCompare(b.author, "vi") : sort === "newest" ? (b.importedAt || 0) - (a.importedAt || 0) : (progress(b).timestamp || 0) - (progress(a).timestamp || 0));
    }
    ["shelf-search", "shelf-status", "shelf-group", "shelf-sort"].forEach((id) => $(`#${id}`).addEventListener(id === "shelf-search" ? "input" : "change", options.renderShelf));
    updateGroups();
    function shelfItem(series, card) {
      const item = document.createElement("div"); item.className = "ebook-shelf-item"; item.dataset.book = series.slug;
      const actions = document.createElement("div"); actions.className = "shelf-card-controls";
      actions.innerHTML = `<button type="button" class="btn-link" data-favorite aria-pressed="${row(series).favorite}" aria-label="Yêu thích ${escape(series.titleVi)}">${row(series).favorite ? "★ Yêu thích" : "☆ Yêu thích"}</button><button type="button" class="btn-link" data-manage aria-label="Quản lý ${escape(series.titleVi)}">Quản lý</button>${series.personal ? `<button type="button" class="btn-link ui-danger" data-delete aria-label="Xóa ebook ${escape(series.titleVi)}">Xóa</button>` : ""}`;
      actions.querySelector("[data-favorite]").onclick = () => {
        const old = state.books[series.slug]; state.books[series.slug] = { ...row(series), favorite: !row(series).favorite };
        if (!persist()) { if (old) state.books[series.slug] = old; else delete state.books[series.slug]; }
        options.renderShelf();
      };
      actions.querySelector("[data-manage]").onclick = () => manageBook(series);
      if (series.personal) actions.querySelector("[data-delete]").onclick = () => options.deleteBook(series);
      const label = { want: "Muốn đọc", reading: "Đang đọc", done: "Đã đọc" }[status(series)];
      if (label || row(series).groups.length) {
        const tags = document.createElement("span"); tags.className = "shelf-book-tags";
        tags.textContent = [label, ...row(series).groups].filter(Boolean).join(" · "); card.querySelector(".shelf-card-action").before(tags);
      }
      item.append(card, actions); return item;
    }
    async function coverBlob(file) {
      if (file.size > 8 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) throw new Error("Chọn ảnh PNG/JPG/WebP/GIF tối đa 8 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (EbookImport.rasterType(bytes) !== file.type) throw new Error("Ảnh bìa không hợp lệ.");
      const dimensions = EbookImport.rasterDimensions(bytes, file.type);
      if (!dimensions || dimensions[0] * dimensions[1] > 40000000) throw new Error("Ảnh bìa không hợp lệ hoặc quá lớn.");
      const bitmap = await createImageBitmap(file), canvas = document.createElement("canvas");
      const scale = Math.min(520 / bitmap.width, 736 / bitmap.height, 1);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      return { blob: await new Promise((resolve) => canvas.toBlob(resolve, "image/png")), w: canvas.width, h: canvas.height };
    }
    function manageBook(series) {
      const current = row(series);
      show("Quản lý sách", `<form id="book-edit-form"><label>Trạng thái<select name="status">${[["", "Tự nhận diện theo tiến độ"], ["want", "Muốn đọc"], ["reading", "Đang đọc"], ["done", "Đã đọc"]].map(([v, label]) => `<option value="${v}"${current.status === v ? " selected" : ""}>${label}</option>`).join("")}</select></label><label>Nhóm · phân cách bằng dấu phẩy<input name="groups" maxlength="600" value="${escape(current.groups.join(", "))}" placeholder="Light novel, Đọc cuối tuần"></label>${series.personal ? `<label>Tên sách<input name="title" maxlength="250" required value="${escape(series.titleVi)}"></label><label>Tác giả<input name="author" maxlength="150" value="${escape(series.author)}"></label><img class="book-edit-cover" src="${escape(series.cover)}" alt="Bìa hiện tại"><label>Đổi bìa<input name="cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><label class="library-check"><input name="resetCover" type="checkbox">Dùng bìa chữ theo tên sách</label>` : `<p class="tools-hint">${escape(series.titleVi)}</p>`}<button class="btn-primary" type="submit">Lưu thay đổi</button></form>`);
      $("#book-edit-form").onsubmit = async (event) => {
        event.preventDefault(); if (busy) return;
        const form = event.target, data = new FormData(form), button = form.querySelector('button[type="submit"]');
        busy = true; button.disabled = true;
        try {
          if (series.personal) {
            const book = await EbookImport.get(series.slug); if (!book) throw new Error("Ebook đã bị xóa.");
            book.titleVi = String(data.get("title")).trim() || book.titleVi; book.author = String(data.get("author")).trim();
            book.volumesData[0].title = book.titleVi; book.volumesData[0].name = book.titleVi;
            const file = form.elements.cover.files[0];
            if (file) {
              const cover = await coverBlob(file); book.assets = book.assets.filter((asset) => asset.key !== "custom-cover");
              book.assets.push({ key: "custom-cover", ...cover }); book.coverAsset = "custom-cover";
            } else if (data.get("resetCover") || book.coverAsset === "fallback-cover") {
              book.assets = book.assets.filter((asset) => asset.key !== "fallback-cover");
              book.assets.push({ key: "fallback-cover", blob: await EbookImport.fallbackCover(book.titleVi), w: 520, h: 736 }); book.coverAsset = "fallback-cover";
            }
            await EbookImport.save(book);
          }
          state.books[series.slug] = { ...current, status: String(data.get("status")), groups: [...new Set(String(data.get("groups")).split(",").map((g) => g.trim().slice(0, 60)).filter(Boolean))].slice(0, 10) };
          if (!persist()) throw new Error("Không lưu được nhóm sách.");
          if (series.personal) location.reload(); else { close(); updateGroups(); options.renderShelf(); }
        } catch (error) { feedback(error.message || "Không lưu được sách."); }
        finally { busy = false; button.disabled = false; }
      };
    }

    function selection() {
      const selected = window.getSelection(); if (!selected?.rangeCount || selected.isCollapsed) return null;
      const range = selected.getRangeAt(0), start = selected.anchorNode?.parentElement?.closest(".reader-frame"), end = selected.focusNode?.parentElement?.closest(".reader-frame");
      if (!start || start !== end) return null;
      const parts = [];
      for (const paragraph of start.querySelectorAll(".reader-content p[data-p]")) {
        if (!range.intersectsNode(paragraph)) continue;
        const local = document.createRange(); local.selectNodeContents(paragraph);
        if (paragraph.contains(range.startContainer)) local.setStart(range.startContainer, range.startOffset);
        if (paragraph.contains(range.endContainer)) local.setEnd(range.endContainer, range.endOffset);
        const quote = local.toString(); if (!quote) continue;
        const prefixRange = document.createRange(); prefixRange.selectNodeContents(paragraph); prefixRange.setEnd(local.startContainer, local.startOffset);
        const offset = prefixRange.toString().length, full = paragraph.textContent;
        parts.push({ p: Number(paragraph.dataset.p), start: offset, end: offset + quote.length, quote, prefix: full.slice(Math.max(0, offset - 40), offset), suffix: full.slice(offset + quote.length, offset + quote.length + 40) });
      }
      if (!parts.length || parts.length > 50 || parts.reduce((sum, part) => sum + part.quote.length, 0) > 6000) return null;
      return { slug: ctx().series.slug, volIdx: Number(start.dataset.vol), chapIdx: Number(start.dataset.chap), parts };
    }
    document.addEventListener("selectionchange", () => { const value = selection(); if (value) pendingSelection = value; });
    function editMark(mark) {
      show(mark.type === "bookmark" ? "Lưu vị trí đọc" : "Tô màu và ghi chú", `<form id="mark-form"><label>Tên đánh dấu<input name="label" maxlength="160" value="${escape(mark.label || "")}" placeholder="Đoạn muốn đọc lại"></label>${mark.parts?.length ? `<blockquote class="annotation-quote">${escape(mark.parts.map((p) => p.quote).join("\n").slice(0, 6000))}</blockquote><label>Màu<select name="color">${[["yellow", "Vàng"], ["mint", "Xanh"], ["pink", "Hồng"]].map(([v, label]) => `<option value="${v}"${mark.color === v ? " selected" : ""}>${label}</option>`).join("")}</select></label>` : ""}<label>Ghi chú<textarea name="note" maxlength="4000" rows="5">${escape(mark.note || "")}</textarea></label><div class="tools-actions"><button type="submit" class="btn-primary">Lưu đánh dấu</button>${mark.id ? '<button id="mark-delete" type="button" class="btn-secondary">Xóa đánh dấu</button>' : ""}</div></form>`);
      $("#mark-form").onsubmit = (event) => {
        event.preventDefault(); const data = new FormData(event.target), previous = state.marks;
        const saved = { ...mark, id: mark.id || crypto.randomUUID(), label: String(data.get("label")).trim().slice(0, 160), note: String(data.get("note")).trim().slice(0, 4000), color: String(data.get("color") || "yellow"), createdAt: mark.createdAt || Date.now() };
        if (!mark.id && state.marks.length >= 5000) { feedback("Đã đạt 5.000 đánh dấu. Xóa bớt trước khi thêm."); return; }
        state.marks = [...state.marks.filter((item) => item.id !== saved.id), saved];
        if (!persist()) { state.marks = previous; return; }
        decorateAll(); close(); window.getSelection()?.removeAllRanges(); pendingSelection = null;
        options.message("Đã lưu đánh dấu.");
      };
      if (mark.id) $("#mark-delete").onclick = () => {
        const previous = state.marks; state.marks = state.marks.filter((item) => item.id !== mark.id);
        if (!persist()) { state.marks = previous; return; }
        decorateAll(); showMarks();
      };
    }
    function bookmark() {
      const current = ctx(); if (current.view !== "reader") { options.message("Mở chương cần đánh dấu trước."); return; }
      const chapter = current.series.volumesData[current.volIdx].chapters[current.chapIdx];
      editMark({ type: "bookmark", slug: current.series.slug, volIdx: current.volIdx, chapIdx: current.chapIdx,
        anchor: options.capturePosition() || { block: 0, offset: 0 }, label: chapter.title, parts: [] });
    }
    function quickBookmark() {
      const current = ctx(); if (current.view !== "reader") return false;
      if (state.marks.length >= 5000) { options.message("Đã đạt 5.000 đánh dấu. Xóa bớt trước khi thêm."); return false; }
      const chapter = current.series.volumesData[current.volIdx]?.chapters[current.chapIdx];
      if (!chapter) return false;
      const mark = { id: crypto.randomUUID(), type: "bookmark", slug: current.series.slug, volIdx: current.volIdx, chapIdx: current.chapIdx,
        anchor: options.capturePosition() || { block: 0, offset: 0 }, label: chapter.title, note: "", color: "yellow", parts: [], createdAt: Date.now() };
      const previous = state.marks; state.marks = [...state.marks, mark];
      if (!persist()) { state.marks = previous; return false; }
      options.message("Đã lưu vị trí đọc.", { label: "Hoàn tác", run() {
        const before = state.marks; state.marks = state.marks.filter((item) => item.id !== mark.id);
        if (!persist()) { state.marks = before; return; }
        options.message("Đã hoàn tác đánh dấu.");
      } });
      return true;
    }
    function showMarks() {
      const current = ctx(), available = state.marks.filter((mark) => !markScope || mark.slug === markScope).sort((a, b) => b.createdAt - a.createdAt);
      show("Đánh dấu & Ghi chú", `<div class="tools-actions"><button type="button" id="bookmark-position" class="btn-primary"${current.view !== "reader" ? " disabled" : ""}>Lưu vị trí đang đọc</button></div><label>Sách<select id="marks-scope"><option value="">Tất cả sách</option>${options.series.map((book) => `<option value="${escape(book.slug)}"${book.slug === markScope ? " selected" : ""}>${escape(book.titleVi)}</option>`).join("")}</select></label><div class="saved-annotations">${available.length ? available.map((mark) => {
        const book = options.series.find((s) => s.slug === mark.slug), chapter = book?.volumesData?.[mark.volIdx]?.chapters[mark.chapIdx];
        return `<article class="tool-card"><h3>${mark.type === "bookmark" ? "🔖 " : ""}${escape(mark.label || "Đoạn đã tô màu")}</h3><p class="tools-hint">${escape(book?.titleVi || "Sách chưa có trên kệ")} · ${escape(chapter?.title || "")}</p>${mark.parts.length ? `<blockquote>${escape(mark.parts.map((p) => p.quote).join("\n").slice(0, 250))}</blockquote>` : ""}${mark.note ? `<p>${escape(mark.note)}</p>` : ""}<div class="tools-actions"><button type="button" class="btn-link" data-open-mark="${escape(mark.id)}"${chapter ? "" : " disabled"}>Đến vị trí</button><button type="button" class="btn-link" data-edit-mark="${escape(mark.id)}">Sửa / Xóa</button></div></article>`;
      }).join("") : '<p class="tools-empty">Chưa có đánh dấu. Bôi đen câu để tô màu hoặc lưu vị trí đang đọc.</p>'}</div>`);
      $("#bookmark-position").onclick = bookmark;
      $("#marks-scope").onchange = (event) => { markScope = event.target.value; showMarks(); };
      panel.querySelectorAll("[data-edit-mark]").forEach((button) => button.onclick = () => editMark(state.marks.find((m) => m.id === button.dataset.editMark)));
      panel.querySelectorAll("[data-open-mark]").forEach((button) => button.onclick = () => {
        const mark = state.marks.find((m) => m.id === button.dataset.openMark), index = options.series.findIndex((s) => s.slug === mark.slug);
        close(); options.openMark(index, mark);
      });
    }
    function decorate(section) {
      section.querySelectorAll("mark[data-reader-mark]").forEach((mark) => { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); parent.normalize(); });
      const marks = state.marks.filter((mark) => mark.type === "highlight" && mark.slug === ctx().series.slug && mark.volIdx === Number(section.dataset.vol) && mark.chapIdx === Number(section.dataset.chap));
      for (const mark of marks) for (const part of mark.parts) {
        const paragraph = section.querySelector(`p[data-p="${part.p}"]`); if (!paragraph) continue;
        const hit = locatePart(paragraph.textContent, part); if (!hit) continue;
        highlightRange(paragraph, hit.start, hit.end, { id: mark.id, color: mark.color, title: mark.note || mark.label || "Sửa ghi chú" });
      }
    }
    function decorateAll() { options.preservePosition(() => document.querySelectorAll(".reader-frame").forEach(decorate)); }
    document.addEventListener("reader-characters-changed", decorateAll);
    function applyLayout() {
      const style = document.documentElement.style;
      style.setProperty("--reader-width", `${state.layout.width}px`); style.setProperty("--reading-margin", `${state.layout.margin}px`); style.setProperty("--reading-gap", `${state.layout.gap}em`);
    }
    function showLayout() {
      show("Vùng đọc", `<p class="tools-hint">Áp dụng cho mọi sách; vị trí đọc được giữ khi thay đổi.</p><form id="layout-form">${[["width", "Độ rộng trang", 460, 1100, 20, "px"], ["margin", "Lề hai bên", 12, 64, 2, "px"], ["gap", "Khoảng cách đoạn", 0.4, 2, 0.05, "em"]].map(([key, label, min, max, step, unit]) => `<label>${label} <output id="layout-${key}-value">${state.layout[key]} ${unit}</output><input name="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${state.layout[key]}" data-unit="${unit}"></label>`).join("")}<button type="button" id="layout-reset" class="btn-secondary">Khôi phục mặc định</button></form>`);
      panel.querySelectorAll('input[type="range"]').forEach((input) => input.oninput = () => {
        state.layout[input.name] = Number(input.value); $(`#layout-${input.name}-value`).textContent = `${input.value} ${input.dataset.unit}`;
        options.preservePosition(applyLayout); persist();
      });
      $("#layout-reset").onclick = () => { state.layout = { width: 700, margin: 48, gap: 0.85 }; options.preservePosition(applyLayout); persist(); showLayout(); };
    }
    function showToc() {
      const book = ctx().series, toc = book.toc || [];
      show("Mục lục EPUB", toc.length ? `<nav class="ebook-toc" aria-label="Mục lục EPUB">${toc.map((item, i) => `<button type="button" class="btn-link" data-toc="${i}" style="padding-left:${Math.min(8, item.depth) * 16}px">${escape(item.title)}</button>`).join("")}</nav>` : '<p class="tools-empty">Sách này dùng danh sách chương thông thường. Mục lục nhiều cấp có trong EPUB đã nhập bằng phiên bản mới.</p>');
      panel.querySelectorAll("[data-toc]").forEach((button) => button.onclick = () => { const item = toc[Number(button.dataset.toc)]; close(); options.openChapter(0, item.chapIdx, { hit: { p: item.p } }); });
    }
    function showBackup() {
      show("Sao lưu / Khôi phục", `<p class="tools-hint">Bản sao lưu gồm toàn bộ ebook cá nhân, tiến độ, đánh dấu, ghi chú và cài đặt. Các bản tải offline của truyện có sẵn có thể tải lại sau.</p><button type="button" id="backup-export" class="btn-primary">Tải bản sao lưu ZIP</button><label class="backup-file-label">Khôi phục từ bản sao lưu<input type="file" id="backup-file" accept=".zip,application/zip"></label><div id="backup-preview"></div><p id="backup-status" role="status" aria-live="polite"></p>`);
      const status = $("#backup-status"), file = $("#backup-file"), exportButton = $("#backup-export");
      exportButton.onclick = async () => {
        busy = true; file.disabled = true; exportButton.disabled = true; options.capturePosition();
        try {
          status.textContent = "Đang gom dữ liệu…";
          const blob = await LibraryBackup.exportData((value) => { status.textContent = value; });
          const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `ke-truyen-${ReaderFeatures.dayKey()}.zip`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000); status.textContent = "Đã tạo bản sao lưu.";
        } catch (error) { status.textContent = error.message || "Không tạo được bản sao lưu. Kiểm tra dung lượng rồi thử lại."; }
        finally { busy = false; file.disabled = false; exportButton.disabled = false; }
      };
      file.onchange = async () => {
        if (!file.files[0]) return; busy = true; file.disabled = true; exportButton.disabled = true; $("#backup-preview").innerHTML = "";
        try {
          const data = await LibraryBackup.readBackup(file.files[0], (value) => { status.textContent = value; });
          status.textContent = `Đã kiểm tra: ${data.books.length} ebook, ${Object.keys(data.settings).length} mục dữ liệu.`;
          $("#backup-preview").innerHTML = '<p class="tools-hint">Ebook cùng mã và dữ liệu đọc sẽ được cập nhật từ bản sao lưu. Các sách khác trên máy được giữ.</p><button id="backup-restore" class="btn-primary" type="button">Khôi phục dữ liệu</button>';
          $("#backup-restore").onclick = async (event) => {
            busy = true; event.target.disabled = true; file.disabled = true; exportButton.disabled = true; status.textContent = "Đang khôi phục…";
            try { await LibraryBackup.restore(data); location.reload(); }
            catch (_) { status.textContent = "Không khôi phục được. Dữ liệu cũ được giữ; kiểm tra chỗ trống rồi thử lại."; busy = false; event.target.disabled = false; file.disabled = false; exportButton.disabled = false; }
          };
        } catch (error) { status.textContent = error.message || "Bản sao lưu không hợp lệ."; }
        finally { busy = false; file.disabled = false; exportButton.disabled = false; }
      };
    }
    $("#btn-library-backup").onclick = showBackup;
    document.addEventListener("click", (event) => {
      const note = event.target.closest("[data-footnote]");
      if (note) { const value = ctx().series.footnotes?.[note.dataset.footnote]; show("Chú thích", `<p class="footnote-text">${escape(value || "Không tìm thấy nội dung chú thích trong ebook.")}</p>`); return; }
      const marked = event.target.closest("mark[data-reader-mark]");
      if (marked) { const mark = state.marks.find((m) => m.id === marked.dataset.readerMark); if (mark) editMark(mark); return; }
      const action = event.target.closest("[data-library-action]")?.dataset.libraryAction;
      if (action === "marks") { markScope = ctx().view === "reader" ? ctx().series.slug : ""; showMarks(); }
      if (action === "bookmark") bookmark();
      if (action === "highlight") {
        const selected = selection() || pendingSelection;
        if (!selected || selected.slug !== ctx().series.slug || ctx().view !== "reader") { options.message("Chọn tối đa 6.000 ký tự trong chương để tô màu."); return; }
        editMark({ ...selected, type: "highlight", label: "", note: "", color: "yellow" });
      }
      if (action === "layout") showLayout();
      if (action === "toc") showToc();
    });
    applyLayout();
    return { filterSeries, setSection, shelfItem, decorate, quickBookmark, openMarks: () => { markScope = ctx().view === "reader" ? ctx().series.slug : ""; showMarks(); }, openLayout: showLayout, openToc: showToc,
      attachHost: (host) => { embeddedHost = host; }, canClose: () => !busy,
      getMarks: () => state.marks.filter((m) => m.slug === ctx().series.slug), getLayout: () => ({ ...state.layout }),
      setLayout: (layout) => { state.layout = normalizeState({ ...state, layout }).layout; persist(); options.preservePosition(applyLayout); },
      isOpen, onView() { pendingSelection = null; if (isOpen() && !busy) close(); } };
  }
  return { create, normalizeState, locatePart, fold, highlightRange };
});
