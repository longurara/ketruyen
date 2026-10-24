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
  const svg = (body, fill = "none") => `<svg width="18" height="18" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const STAR = '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"></path>';
  const ICONS = {
    more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"></circle><circle cx="12" cy="12" r="1.3" fill="currentColor"></circle><circle cx="19" cy="12" r="1.3" fill="currentColor"></circle>'),
    star: svg(STAR), starFilled: svg(STAR, "currentColor"),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="m13.5 6.5 4 4"></path>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"></path>')
  };
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
      favorite: row?.favorite === true, status: row?.status === null ? null : ["want", "reading", "done"].includes(row?.status) ? row.status : "",
      groups: (Array.isArray(row?.groups) ? row.groups : []).filter((g) => typeof g === "string").map((g) => g.trim().slice(0, 60)).filter(Boolean).slice(0, 10)
    }]));
    const marks = (Array.isArray(source.marks) ? source.marks : []).filter((m) => m && /^[a-z\d_-]{1,100}$/i.test(m.id) && typeof m.slug === "string" && Number.isInteger(m.volIdx) && Number.isInteger(m.chapIdx) && m.volIdx >= 0 && m.chapIdx >= 0)
      .slice(-5000).map((m) => ({ ...m, type: m.type === "bookmark" ? "bookmark" : "highlight", label: String(m.label || "").slice(0, 160), note: String(m.note || "").slice(0, 4000),
        color: ["yellow", "mint", "pink"].includes(m.color) ? m.color : "yellow",
        parts: (Array.isArray(m.parts) ? m.parts : []).filter((p) => Number.isInteger(p.p) && p.p >= 0 && Number.isInteger(p.start) && Number.isInteger(p.end) && p.start >= 0 && p.end > p.start && typeof p.quote === "string")
          .slice(0, 50).map((p) => ({ p: p.p, start: p.start, end: p.end, quote: p.quote.slice(0, 6000), prefix: String(p.prefix || "").slice(0, 40), suffix: String(p.suffix || "").slice(0, 40) })),
        anchor: { block: Math.floor(clamp(m.anchor?.block, 0, 1000000, 0)), offset: clamp(m.anchor?.offset, 0, 1, 0), ...(Number.isInteger(m.anchor?.textOffset) && m.anchor.textOffset >= 0 ? { textOffset: Math.min(1000000, m.anchor.textOffset) } : {}) } }));
    const versions = (Array.isArray(source.versions) ? source.versions : []).filter((v) => v && /^[a-f\d-]{36}$/i.test(v.id) && Number.isFinite(v.at) && v.at > Date.now() - 30 * 86400000 && v.value?.id === v.markId)
      .slice(-10000).map((v) => ({ ...v, value: normalizeState({ version: 1, marks: [v.value] }).marks[0] })).filter((v) => v.value);
    return { version: 1, books, marks, versions, layout: { width: clamp(source.layout?.width, 460, 1100, 700), margin: clamp(source.layout?.margin, 12, 64, 48), gap: clamp(source.layout?.gap, 0.4, 2, 0.85) } };
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
      const previousVersions = state.versions;
      try {
        const previous = JSON.parse(localStorage.getItem(KEY) || "null");
        const versions = [...state.versions.filter((v) => v.at > Date.now() - 30 * 86400000)];
        const nextMarks = new Map(state.marks.map((m) => [m.id, m]));
        const serialize = globalThis.ReaderSync?.canonical || JSON.stringify;
        for (const old of normalizeState({ version: 1, marks: previous?.marks || [] }).marks) {
          const next = nextMarks.get(old.id);
          if (serialize(old) !== serialize(next)) {
            const id = next?.changeId || crypto.randomUUID();
            if (!versions.some((v) => v.id === id)) versions.push({ id, markId: old.id, value: old, deleted: !next, at: Date.now(), uploaded: false });
          }
        }
        state.versions = versions;
        localStorage.setItem(KEY, JSON.stringify(state)); window.dispatchEvent(new Event("ketruyen-library-change")); return true;
      }
      catch (_) {
        state.versions = previousVersions;
        const message = "Không lưu được thay đổi. Kiểm tra dung lượng hoặc quyền lưu dữ liệu.";
        if (document.querySelector("#library-dialog")?.open || document.querySelector("#workbench-dialog")?.open) feedback(message); else options.message(message);
        return false;
      }
    }
    document.body.insertAdjacentHTML("beforeend", `<dialog id="library-dialog" class="tools-dialog" aria-labelledby="library-title"><div class="tools-heading"><h2 id="library-title"></h2><button type="button" class="tools-close" aria-label="Đóng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg></button></div><div id="library-tools-panel" class="tools-panel"></div><p id="library-feedback" class="tools-feedback" role="status" hidden></p></dialog>`);
    const dialog = $("#library-dialog"), panel = $("#library-tools-panel");
    let embeddedHost = null;
    const isOpen = () => embeddedHost ? embeddedHost.isOpen() : dialog.open;
    function close() { draftDirty = false; if (embeddedHost) embeddedHost.closeLibrary(); else dialog.close(); }
    let opener = null, busy = false, draftDirty = false, markScope = "", pendingSelection = null;
    function feedback(message) { const el = $("#library-feedback"); el.hidden = false; el.textContent = message; }
    function show(title, html) {
      $("#reader-tools-dialog")?.close(); $("#reader-selection-tools").hidden = true;
      $("#library-title").textContent = title; $("#library-feedback").hidden = true;
      panel.innerHTML = html;
      draftDirty = false;
      const form = panel.querySelector("form");
      if (form) { const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn-link"; cancel.dataset.draftCancel = ""; cancel.textContent = "Huỷ thay đổi"; cancel.onclick = () => { if (!busy) close(); }; form.append(cancel); }
      if (embeddedHost) { embeddedHost.show(title); return; }
      if (!dialog.open) { opener = document.activeElement; dialog.showModal(); }
    }
    panel.addEventListener("input", (event) => { if (event.target.closest("form")) draftDirty = true; });
    panel.addEventListener("change", (event) => { if (event.target.closest("form")) draftDirty = true; });
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
      if (row(series).status === null) return "";
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
      // No groups yet: the picker would only offer "all", so leave it out.
      select.closest("label").hidden = !groups.length;
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
    // The library menu and each book's menu: one open at a time, closed by an outside click or Escape.
    const openMenus = () => document.querySelectorAll("#shelf-more[open], .shelf-card-more[open], .shelf-quick-more[open], .shelf-resume-details[open]");
    document.addEventListener("click", (event) => {
      openMenus().forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
    });
    document.addEventListener("toggle", (event) => {
      if (!event.target.matches?.("#shelf-more, .shelf-card-more, .shelf-quick-more, .shelf-resume-details") || !event.target.open) return;
      openMenus().forEach((menu) => { if (menu !== event.target) menu.open = false; });
      event.target.querySelector(".shelf-more-menu button")?.focus({ preventScroll: true });
    }, true);
    document.addEventListener("keydown", (event) => {
      const menu = [...openMenus()].find((open) => open.contains(document.activeElement));
      if (!menu) return;
      if (event.key === "Escape") { menu.open = false; menu.querySelector("summary").focus(); event.preventDefault(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...menu.querySelectorAll(".shelf-more-menu button:not(:disabled)")];
      const next = items[(items.indexOf(document.activeElement) + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next?.focus(); event.preventDefault();
    });
    let suggestionOffset = 0, personalShelf = false, shelfView;
    const VIEW_KEY = "ketruyen-shelf-view-v1";
    try { const saved = localStorage.getItem(VIEW_KEY); if (["mine", "discover"].includes(saved)) shelfView = saved; } catch (_) {}
    function personalBooks(series, savedSlugs = new Set()) {
      const marked = new Set(state.marks.map((m) => m.slug));
      return series.filter((book) => book.personal || savedSlugs.has(book.slug) || row(book).favorite || row(book).groups.length || row(book).status || marked.has(book.slug) || (row(book).status !== null && progress(book).timestamp));
    }
    function setShelfView(value) {
      shelfView = value === "mine" ? "mine" : "discover"; personalShelf = false;
      try { localStorage.setItem(VIEW_KEY, shelfView); } catch (_) {}
      $("#shelf-search").value = ""; $("#shelf-status").value = "all"; $("#shelf-group").value = "";
      options.onShelfViewChange?.(); options.renderShelf();
    }
    const viewTabs = [...document.querySelectorAll("[data-shelf-view]")];
    viewTabs.forEach((button, index) => {
      button.onclick = () => setShelfView(button.dataset.shelfView);
      button.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const target = viewTabs[event.key === "Home" ? 0 : event.key === "End" ? viewTabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + viewTabs.length) % viewTabs.length];
        target.click(); target.focus();
      };
    });
    function updateShelfResume(series) {
      const host = $("#shelf-resume");
      const resumeOpen = host.querySelector(".shelf-resume-details")?.open, otherOpen = host.querySelector(".shelf-other-reading")?.open;
      const recent = series
        .filter((book) => Array.isArray(book.volumesData) && row(book).status !== null)
        .map((book) => ({ book, saved: progress(book) }))
        .filter(({ book, saved }) => Number.isInteger(saved.volIdx) && Number.isInteger(saved.chapIdx) && Number(saved.timestamp) > 0 && book.volumesData?.[saved.volIdx]?.chapters[saved.chapIdx])
        .sort((a, b) => Number(b.saved.timestamp) - Number(a.saved.timestamp))
        .slice(0, 8);
      // Story chapters finished out of the whole book, as on the series page.
      const bookShare = (book) => { let read = {}; try { read = JSON.parse(localStorage.getItem(book.legacyStorage ? "tenshi-chapters" : 'tenshi-' + book.slug + '-chapters')) || {}; } catch (_) {} return BookFormat.completedProgress(book, read); };
      const picks = series.filter((book) => !book.personal && normalizeBookSection(book.section) === "main" && book.volumes === 1 && !progress(book).timestamp && status(book) !== "done");
      // A single-volume recommendation has an explicit reason; it does not
      // repeat the first row of the catalogue or require loading chapter text.
      const suggested = picks.length ? picks[suggestionOffset % picks.length] : series.find((book) => !progress(book).timestamp && status(book) !== "done");
      const cover = (book, className) => book.cover ? `<img class="${className}" src="${escape(book.cover)}" alt="Bìa ${escape(book.titleVi)}" width="150" height="210" decoding="async">` : `<span class="${className} shelf-cover-fallback" aria-hidden="true">${escape(book.titleVi)}</span>`;
      const arrow = '<span aria-hidden="true">↗</span>';
      function recommendation(compact = false) {
        if (!suggested) return "";
        const reason = suggested.volumes === 1 ? "Gọn trong một tập" : "Một lựa chọn từ thư viện";
        const change = picks.length > 1 ? '<button type="button" class="shelf-change-pick" aria-label="Đổi sách gợi ý" title="Đổi gợi ý">↻</button>' : "";
        const art = `<button type="button" class="shelf-feature-art" data-suggest aria-label="Xem ${escape(suggested.titleVi)}">${cover(suggested, "shelf-feature-cover")}</button>`;
        if (compact) return `<article class="shelf-feature is-discovery"><div class="shelf-feature-copy"><p class="shelf-feature-kicker">${reason}</p><h2><button type="button" class="shelf-discovery-title" data-suggest>${escape(suggested.titleVi)} ${arrow}</button></h2><p class="shelf-feature-author">${escape(suggested.author || "")}</p></div>${art}${change}</article>`;
        return `<article class="shelf-feature is-welcome"><div class="shelf-feature-copy"><p class="shelf-feature-kicker">Bắt đầu với một câu chuyện</p><h2>${escape(suggested.titleVi)}</h2><p class="shelf-feature-author">${escape(suggested.author || "")}</p><p class="shelf-feature-reason">${reason}${suggested.tags?.[0] ? ` · ${escape(suggested.tags[0])}` : ""}</p>${suggested.description ? `<p class="shelf-feature-description">${escape(suggested.description)}</p>` : ""}</div>${art}<div class="shelf-feature-actions"><button type="button" class="shelf-suggest-button" data-suggest>Xem sách <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"></path></svg></button>${change}</div></article>`;
      }
      const recommendationHost = $("#shelf-recommendation");
      recommendationHost.hidden = !suggested;
      recommendationHost.innerHTML = suggested ? `<h2 class="shelf-section-title">Một cuốn cho lần đọc tới</h2>${recommendation()}` : "";
      host.hidden = !recent.length;
      host.classList.toggle("has-reading", recent.length > 0);
      let featured = "";
      if (recent.length) {
        const { book, saved } = recent[0], volume = book.volumesData[saved.volIdx], chapter = volume.chapters[saved.chapIdx], share = bookShare(book);
        featured = `<article class="shelf-feature is-reading shelf-resume-inline"><button type="button" class="shelf-inline-cover" data-resume="0" aria-label="Đọc tiếp ${escape(book.titleVi)}">${cover(book, "shelf-feature-cover")}</button><div class="shelf-feature-copy"><h2>${escape(book.titleVi)}</h2><p class="shelf-feature-place">${escape(volume.name || volume.title)} · ${escape(chapter.title)}</p></div><button type="button" class="shelf-feature-button" data-resume="0" aria-label="Đọc tiếp ${escape(book.titleVi)}"><span class="shelf-resume-button-text">Đọc tiếp</span><span aria-hidden="true">→</span></button><details class="shelf-resume-details"><summary aria-label="Chi tiết sách đang đọc">⋯</summary><div class="shelf-more-menu"><p>Đã đọc xong ${share.done}/${share.total} ${share.unit}</p><button type="button" class="shelf-menu-action" data-dismiss-reading="${escape(book.slug)}">Bỏ khỏi Đang đọc…</button></div></details></article>`;
      }
      host.innerHTML = `<div class="shelf-feature-layout">${featured}</div>${recent.length > 1 ? `<details class="shelf-other-reading"><summary>Các sách đang đọc khác (${recent.length - 1})</summary><div class="shelf-resume-row">${recent.slice(1).map(({ book, saved }, offset) => {
        const index = offset + 1;
        const volume = book.volumesData[saved.volIdx], chapter = volume.chapters[saved.chapIdx], share = bookShare(book);
        return `<div class="shelf-resume-entry"><button type="button" class="shelf-resume-card" data-resume="${index}" aria-label="Đọc tiếp ${escape(book.titleVi)}, ${escape(chapter.title)}, đã đọc ${share.done} trên ${share.total} chương">${book.cover ? `<img class="shelf-resume-cover" src="${escape(book.cover)}" alt="" width="104" height="148" loading="lazy" decoding="async">` : '<span class="shelf-resume-cover" aria-hidden="true"></span>'}<span class="shelf-resume-copy"><strong>${escape(book.titleVi)}</strong><span class="shelf-resume-chapter">${escape(volume.name || volume.title)} · ${escape(chapter.title)}</span><span class="shelf-resume-meter" aria-hidden="true"><span style="width:${Math.max(share.percent, share.done ? 2 : 0)}%"></span></span><span class="shelf-resume-share">${share.done}/${share.total}</span></span></button><button type="button" class="shelf-remove-reading" data-dismiss-reading="${escape(book.slug)}" aria-label="Bỏ ${escape(book.titleVi)} khỏi Đang đọc" title="Bỏ khỏi Đang đọc">×</button></div>`;
      }).join("")}</div></details>` : ""}`;
      if (resumeOpen) host.querySelector(".shelf-resume-details")?.setAttribute("open", "");
      if (otherOpen) host.querySelector(".shelf-other-reading")?.setAttribute("open", "");
      host.querySelectorAll("[data-dismiss-reading]").forEach((button) => button.onclick = () => removeReading(series.find((book) => book.slug === button.dataset.dismissReading)));
      host.querySelectorAll("[data-resume]").forEach((button) => {
        const { book, saved } = recent[Number(button.dataset.resume)];
        button.onclick = () => options.openMark(options.series.indexOf(book), { type: "bookmark", volIdx: saved.volIdx, chapIdx: saved.chapIdx });
      });
      recommendationHost.querySelectorAll("[data-suggest]").forEach((button) => {
        button.onclick = () => options.openSeries(options.series.indexOf(suggested), recommendationHost.querySelector("[data-suggest] .shelf-feature-cover"));
      });
      recommendationHost.querySelector(".shelf-change-pick")?.addEventListener("click", () => { suggestionOffset++; updateShelfResume(series); recommendationHost.querySelector(".shelf-change-pick")?.focus({ preventScroll: true }); });
    }
    function updateShortcuts(series) {
      const moreOpen = $("#shelf-shortcuts .shelf-quick-more")?.open;
      const filter = $("#shelf-status").value;
      const counts = { all: series.length, reading: 0, want: 0, favorite: 0, personal: 0 };
      if ($("#view-shelf").dataset.shelfView === "discover") counts.all = series.filter((book) => !book.personal).length;
      for (const book of series) {
        const current = status(book);
        if (current === "reading" || current === "want") counts[current]++;
        if (row(book).favorite) counts.favorite++;
        if (book.personal) counts.personal++;
      }
      const icons = {
        all: svg('<path d="M4 5h6v15H4zM14 5h6v15h-6zM7 8v2M17 8v2"></path>'),
        reading: svg('<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"></path>'),
        want: svg('<path d="M6 4h12v17l-6-4-6 4z"></path>'),
        favorite: ICONS.star, personal: svg('<path d="M4 4h13v16H4zM8 8h5M8 12h5M20 7v13"></path>')
      };
      const shortcut = ([value, label]) => `<button type="button" data-shelf-quick="${value}" aria-pressed="${value === "all" ? !personalShelf && filter === "all" : personalShelf && filter === value}">${icons[value]}<span>${label}</span><span class="shelf-shortcut-count">${counts[value].toLocaleString("vi-VN")}</span></button>`;
      $("#shelf-shortcuts").innerHTML = [["all", "Tất cả"], ["reading", "Đang đọc"], ["favorite", "Yêu thích"]].map(shortcut).join("") + `<details class="shelf-quick-more"><summary>Thêm<span aria-hidden="true">⌄</span></summary><div class="shelf-more-menu">${[["want", "Muốn đọc"], ["personal", "Ebook cá nhân"]].map(shortcut).join("")}<button type="button" data-library-action="marks">${ICONS.edit}<span>Ghi chú</span><span class="shelf-shortcut-count">${state.marks.length}</span></button></div></details>`;

      $("#shelf-shortcuts .shelf-quick-more").open = Boolean(moreOpen);
      $("#shelf-shortcuts").querySelectorAll("[data-shelf-quick]").forEach((button) => button.addEventListener("click", () => {
        const value = button.dataset.shelfQuick;
        if (value !== "all") { shelfView = "mine"; try { localStorage.setItem(VIEW_KEY, shelfView); } catch (_) {} }
        personalShelf = value !== "all";
        $("#shelf-status").value = value;
        $("#shelf-search").value = ""; $("#shelf-group").value = "";
        options.renderShelf();
        $("#shelf-shortcuts").querySelector(`[data-shelf-quick="${value}"]`)?.focus({ preventScroll: true });
      }));
      sectionTabs.hidden = personalShelf;
      $("#shelf-library-title").textContent = personalShelf ? ({ reading: "Sách đang đọc", want: "Dành cho lần đọc tới", favorite: "Những cuốn yêu thích", personal: "Ebook của bạn" }[filter] || "Kệ sách của bạn") : "Khám phá thư viện";
    }
    const VALID_SECTIONS = new Set([
      "main",
      "hlc-all", "hlc-oneshot", "hlc-completed", "hlc-multivol",
      "b1k-all", "b1k-lit", "b1k-mystery", "b1k-knowledge", "b1k-life"
    ]);
    let activeSection = "main";
    let lastHlcSection = "hlc-all";
    let lastB1kSection = "b1k-all";
    const sectionTabs = $("#shelf-section-tabs");
    const hlcSubtabs = $("#shelf-hlc-subtabs");
    const b1kSubtabs = $("#shelf-b1k-subtabs");
    function normalizeBookSection(sec) {
      if (sec === "hlc-ln") return "hlc-oneshot";
      if (sec === "hlc-oneshot" || sec === "hlc-completed" || sec === "hlc-multivol") return sec;
      if (sec === "b1k-lit" || sec === "b1k-mystery" || sec === "b1k-knowledge" || sec === "b1k-life") return sec;
      return "main";
    }
    function normalizeSection(sec) {
      if (sec === "hlc-ln") return "hlc-oneshot";
      if (sec === "hlc") return lastHlcSection || "hlc-all";
      if (sec === "b1k") return lastB1kSection || "b1k-all";
      return VALID_SECTIONS.has(sec) ? sec : "main";
    }
    function setSection(nextSection, shouldRender = false) {
      personalShelf = false;
      const normalized = normalizeSection(nextSection);
      if (normalized.startsWith("hlc-")) lastHlcSection = normalized;
      if (normalized.startsWith("b1k-")) lastB1kSection = normalized;

      activeSection = normalized;
      const isHlc = activeSection.startsWith("hlc-");
      const isB1k = activeSection.startsWith("b1k-");
      const activePrimary = isHlc ? "hlc" : isB1k ? "b1k" : "main";
      if (sectionTabs) {
        for (const pTab of sectionTabs.querySelectorAll("[data-shelf-primary]")) {
          const selected = pTab.dataset.shelfPrimary === activePrimary;
          pTab.classList.toggle("is-active", selected);
          pTab.setAttribute("aria-selected", String(selected));
        }
        for (const sTab of sectionTabs.querySelectorAll("[data-shelf-section]")) {
          const selected = sTab.dataset.shelfSection === activeSection;
          sTab.classList.toggle("is-active", selected);
          sTab.setAttribute("aria-selected", String(selected));
        }
      }
      $("#shelf-source").value = activePrimary;
      const categories = isHlc ? [["hlc-all", "Tất cả"], ["hlc-oneshot", "Một tập"], ["hlc-completed", "Đã hoàn thành"], ["hlc-multivol", "Nhiều tập"]] : [["b1k-all", "Tất cả"], ["b1k-lit", "Văn học"], ["b1k-mystery", "Trinh thám"], ["b1k-knowledge", "Kiến thức"], ["b1k-life", "Đời sống"]];
      $("#shelf-category-label").hidden = !isHlc && !isB1k;
      $("#shelf-category").innerHTML = categories.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
      $("#shelf-category").value = activeSection;
      if (hlcSubtabs) hlcSubtabs.hidden = !isHlc;
      if (b1kSubtabs) b1kSubtabs.hidden = !isB1k;
      // On phones each tab row scrolls sideways: keep the chosen tab in view.
      sectionTabs?.querySelectorAll(".filter-btn.is-active").forEach((tab) => {
        const row = tab.parentElement;
        if (row.scrollWidth > row.clientWidth) row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
        markTabOverflow(row);
      });
      if (shouldRender) options.renderShelf();
    }
    // Fade the edge a tab row can still scroll towards, so hidden tabs show.
    function markTabOverflow(row) {
      row.classList.toggle("has-more-start", row.scrollLeft > 2);
      row.classList.toggle("has-more-end", row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
    }
    if (sectionTabs) {
      sectionTabs.querySelectorAll(".toolbar-group").forEach((row) => {
        row.addEventListener("scroll", () => markTabOverflow(row), { passive: true });
        markTabOverflow(row);
      });
      window.addEventListener("resize", () => sectionTabs.querySelectorAll(".toolbar-group").forEach(markTabOverflow));
      sectionTabs.addEventListener("click", (event) => {
        const primaryBtn = event.target.closest("[data-shelf-primary]");
        if (primaryBtn) {
          const p = primaryBtn.dataset.shelfPrimary;
          setSection(p === "hlc" ? lastHlcSection : p === "b1k" ? lastB1kSection : "main", true);
          return;
        }
        const subBtn = event.target.closest("[data-shelf-section]");
        if (subBtn) setSection(subBtn.dataset.shelfSection, true);
      });
    }
    $("#shelf-source").onchange = (event) => setSection(event.target.value === "hlc" ? lastHlcSection : event.target.value === "b1k" ? lastB1kSection : "main", true);
    $("#shelf-category").onchange = (event) => setSection(event.target.value, true);
    function updateSectionCounts(series) {
      const counts = {
        main: 0,
        "hlc-oneshot": 0, "hlc-completed": 0, "hlc-multivol": 0,
        "b1k-lit": 0, "b1k-mystery": 0, "b1k-knowledge": 0, "b1k-life": 0
      };
      for (const book of series) {
        const sec = normalizeBookSection(book.section);
        counts[sec] = (counts[sec] || 0) + 1;
      }
      const hlcTotal = counts["hlc-oneshot"] + counts["hlc-completed"] + counts["hlc-multivol"];
      const b1kTotal = counts["b1k-lit"] + counts["b1k-mystery"] + counts["b1k-knowledge"] + counts["b1k-life"];
      const map = {
        "#shelf-count-main": counts.main,
        "#shelf-count-hlc-total": hlcTotal,
        "#shelf-count-hlc-all": hlcTotal,
        "#shelf-count-hlc-oneshot": counts["hlc-oneshot"],
        "#shelf-count-hlc-completed": counts["hlc-completed"],
        "#shelf-count-hlc-multivol": counts["hlc-multivol"],
        "#shelf-count-b1k-total": b1kTotal,
        "#shelf-count-b1k-all": b1kTotal,
        "#shelf-count-b1k-lit": counts["b1k-lit"],
        "#shelf-count-b1k-mystery": counts["b1k-mystery"],
        "#shelf-count-b1k-knowledge": counts["b1k-knowledge"],
        "#shelf-count-b1k-life": counts["b1k-life"]
      };
      for (const [sel, val] of Object.entries(map)) {
        const el = $(sel);
        if (el) el.textContent = val ? val.toLocaleString("vi-VN") : "";
      }
    }
    function filterSeries(series, { onDevice = false, savedSlugs = new Set() } = {}) {
      const mine = personalBooks(series, savedSlugs);
      if (!shelfView) { shelfView = mine.length ? "mine" : "discover"; try { localStorage.setItem(VIEW_KEY, shelfView); } catch (_) {} }
      const effectiveView = onDevice ? "mine" : shelfView;
      const shown = effectiveView === "mine" && !onDevice ? mine : series.filter((book) => !book.personal || onDevice);
      viewTabs.forEach((button) => { const selected = button.dataset.shelfView === effectiveView; button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; });
      $("#shelf-content").setAttribute("aria-labelledby", `shelf-view-${effectiveView}`);
      $("#view-shelf").dataset.shelfView = effectiveView;
      if ($("#shelf-status").value === "all") personalShelf = false;
      updateFilterSummary(); updateShelfResume(series); updateSectionCounts(series); updateShortcuts(effectiveView === "mine" ? shown : series);
      if (effectiveView === "mine") { sectionTabs.hidden = true; if (!personalShelf) $("#shelf-library-title").textContent = "Kệ của tôi"; }
      if (onDevice) { sectionTabs.hidden = true; if (!personalShelf) $("#shelf-library-title").textContent = "Sách có trên máy"; }
      const query = fold($("#shelf-search").value), filter = $("#shelf-status").value, group = $("#shelf-group").value, sort = $("#shelf-sort").value;
      const result = shown.filter((book) => {
        const bookSec = normalizeBookSection(book.section);
        if (!personalShelf && !onDevice && effectiveView === "discover") {
          if (activeSection === "main" && bookSec !== "main") return false;
          if (activeSection === "hlc-all" && !bookSec.startsWith("hlc-")) return false;
          if (activeSection === "b1k-all" && !bookSec.startsWith("b1k-")) return false;
          if (activeSection !== "main" && activeSection !== "hlc-all" && activeSection !== "b1k-all" && bookSec !== activeSection) return false;
        }
        if (query) {
          if (!book._searchFold) book._searchFold = fold([book.titleVi, book.titleJp, book.author, ...(book.tags || [])].join(" "));
          const groupsFold = row(book).groups.length ? " " + fold(row(book).groups.join(" ")) : "";
          if (!(book._searchFold + groupsFold).includes(query)) return false;
        }
        if (group && !row(book).groups.includes(group)) return false;
        if (filter !== "all") {
          if (filter === "favorite" && !row(book).favorite) return false;
          if (filter === "personal" && !book.personal) return false;
          if (filter !== "favorite" && filter !== "personal" && status(book) !== filter) return false;
        }
        return true;
      });
      $("#shelf-library-title").classList.toggle("shelf-heading-hidden", filter === "all" && !group && !query);
      $("#shelf-result-count").textContent = `${result.length.toLocaleString("vi-VN")} cuốn sách`;
      if (sort === "title") return result.sort((a, b) => a.titleVi.localeCompare(b.titleVi, "vi"));
      if (sort === "author") return result.sort((a, b) => (a.author || "").localeCompare(b.author || "", "vi"));
      if (sort === "newest") return result.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
      const tsMap = new Map(result.map((b) => [b, progress(b).timestamp || 0]));
      return result.sort((a, b) => tsMap.get(b) - tsMap.get(a));
    }
    // List (cover, blurb, actions) or a dense grid of covers for browsing large shelves.
    const DENSITY_KEY = "tenshi-shelf-density", densityButtons = document.querySelectorAll("[data-shelf-density]");
    function setDensity(value) {
      const density = value === "grid" ? "grid" : "list";
      $("#shelf-grid").classList.toggle("is-covers", density === "grid");
      densityButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.shelfDensity === density)));
      return density;
    }
    let savedDensity = "list"; try { savedDensity = localStorage.getItem(DENSITY_KEY) || "list"; } catch (_) {}
    setDensity(savedDensity);
    densityButtons.forEach((button) => button.addEventListener("click", () => {
      const density = setDensity(button.dataset.shelfDensity);
      try { localStorage.setItem(DENSITY_KEY, density); } catch (_) {}
    }));
    ["shelf-search", "shelf-status", "shelf-group", "shelf-sort"].forEach((id) => $(`#${id}`).addEventListener(id === "shelf-search" ? "input" : "change", options.renderShelf));
    updateGroups();
    function shelfItem(series, card) {
      const item = document.createElement("div"); item.className = "ebook-shelf-item"; item.dataset.book = series.slug;
      if (row(series).status === null) { delete card.dataset.resume; card.querySelector(".shelf-card-action").textContent = "Mở sách →"; }
      const favorite = row(series).favorite;
      // Per-book actions live in one overflow menu so the grid reads as books, not toolbars.
      const actions = document.createElement("details"); actions.className = "shelf-card-more";
      actions.innerHTML = `<summary aria-label="Thao tác cho ${escape(series.titleVi)}" title="Thao tác">${ICONS.more}</summary><div class="shelf-more-menu" role="menu"><button type="button" class="shelf-menu-action" role="menuitem" data-favorite aria-pressed="${favorite}">${favorite ? ICONS.starFilled : ICONS.star}<span>${favorite ? "Bỏ yêu thích" : "Thêm vào yêu thích"}</span></button><button type="button" class="shelf-menu-action" role="menuitem" data-manage>${ICONS.edit}<span>Trạng thái &amp; nhóm…</span></button>${(status(series) === "reading" || progress(series).timestamp) && row(series).status !== null ? `<button type="button" class="shelf-menu-action" role="menuitem" data-dismiss>${ICONS.trash}<span>Bỏ khỏi Đang đọc…</span></button>` : ""}${series.personal ? `<button type="button" class="shelf-menu-action is-danger" role="menuitem" data-delete>${ICONS.trash}<span>Xóa khỏi thiết bị…</span></button>` : ""}</div>`;
      const closeMenu = () => { actions.open = false; };
      actions.querySelector("[data-favorite]").onclick = () => {
        const old = state.books[series.slug]; state.books[series.slug] = { ...row(series), favorite: !row(series).favorite };
        if (!persist()) { if (old) state.books[series.slug] = old; else delete state.books[series.slug]; return; }
        closeMenu(); options.renderShelf();
        options.message(row(series).favorite ? "Đã thêm vào yêu thích." : "Đã bỏ khỏi yêu thích.");
      };
      const dismiss = actions.querySelector("[data-dismiss]"); if (dismiss) dismiss.onclick = () => { closeMenu(); removeReading(series); };
      const journal = document.createElement("button"); journal.type = "button"; journal.className = "shelf-menu-action"; journal.setAttribute("role", "menuitem"); journal.textContent = "Nhật ký đọc"; journal.onclick = () => { closeMenu(); options.openJournal(series); }; actions.querySelector("[data-manage]").after(journal);
      actions.querySelector("[data-manage]").onclick = () => { closeMenu(); manageBook(series); };
      if (series.personal) actions.querySelector("[data-delete]").onclick = () => { closeMenu(); options.deleteBook(series); };
      if (favorite) {
        const badge = document.createElement("span"); badge.className = "shelf-favorite-badge"; badge.innerHTML = ICONS.starFilled;
        badge.setAttribute("role", "img"); badge.setAttribute("aria-label", "Yêu thích");
        card.querySelector(".shelf-card-title").prepend(badge);
      }
      // A card that already says "Đang đọc dở · Tập N" needs no "Đang đọc" tag.
      const label = { want: "Muốn đọc", reading: card.dataset.resume ? "" : "Đang đọc", done: "" }[status(series)];
      if (label || row(series).groups.length) {
        const tags = document.createElement("span"); tags.className = "shelf-book-tags";
        tags.textContent = [label, ...row(series).groups].filter(Boolean).join(" · "); card.querySelector(".shelf-card-action").before(tags);
      }
      const saved = progress(series), position = document.createElement("span"); position.className = "shelf-book-position";
      const active = row(series).status !== null && Number.isInteger(saved.volIdx) && Number.isInteger(saved.chapIdx);
      const volume = series.volumesData?.[saved.volIdx], chapter = volume?.chapters[saved.chapIdx];
      position.textContent = active ? chapter ? `${volume.name || `Tập ${saved.volIdx + 1}`} · ${chapter.title}` : `Tập ${saved.volIdx + 1} · Vị trí đã lưu` : status(series) === "done" ? "Đã đọc" : status(series) === "reading" ? "Chưa có vị trí đọc" : "Chưa bắt đầu";
      position.title = position.textContent;
      card.querySelector(".shelf-card-action").before(position);
      if (active && Array.isArray(series.volumesData)) {
        let chapters = {}; try { chapters = JSON.parse(localStorage.getItem(series.legacyStorage ? "tenshi-chapters" : `tenshi-${series.slug}-chapters`)) || {}; } catch (_) {}
        const { done, total, unit } = BookFormat.completedProgress(series, chapters);
        if (total) {
          const meter = document.createElement("span"); meter.className = "shelf-book-progress"; meter.setAttribute("role", "progressbar"); meter.setAttribute("aria-label", "Đã đọc xong"); meter.setAttribute("aria-valuetext", `${done}/${total} ${unit}`); meter.setAttribute("aria-valuemin", "0"); meter.setAttribute("aria-valuemax", String(total)); meter.setAttribute("aria-valuenow", String(done));
          meter.innerHTML = `<span style="width:${Math.round(done / total * 100)}%"></span>`; position.before(meter);
          const caption = document.createElement("span"); caption.className = "shelf-book-completion"; caption.textContent = `Đã đọc xong ${done}/${total} ${unit}`; position.before(caption);
        }
      }
      item.append(card, actions); return item;
    }
    function dismissReading(series, undo = true) {
      const previous = state.books[series.slug], previousStatus = row(series).status;
      state.books[series.slug] = { ...row(series), status: null };
      if (!persist()) { if (previous) state.books[series.slug] = previous; else delete state.books[series.slug]; return false; }
      if (isOpen()) close(); options.renderShelf();
      options.message("Đã bỏ sách khỏi Đang đọc. Tiến độ và ghi chú vẫn được giữ.", undo ? { label: "Hoàn tác", run() {
        const before = state.books[series.slug]; state.books[series.slug] = { ...row(series), status: previousStatus };
        if (!persist()) { state.books[series.slug] = before; return; } options.renderShelf();
      } } : undefined);
      return true;
    }
    function removeReading(series) {
      if (!series) return;
      if (!series.personal) { dismissReading(series); return; }
      show("Bỏ ebook khỏi Đang đọc", `<p class="tools-hint">${escape(series.titleVi)}</p><p>Giữ ebook để đọc sau, hoặc xóa tệp khỏi thiết bị này. Tiến độ và ghi chú vẫn được giữ.</p><div class="tools-actions"><button id="reading-keep-ebook" type="button" class="btn-primary">Chỉ bỏ trạng thái · Giữ ebook</button><button id="reading-delete-ebook" type="button" class="btn-secondary">Xóa ebook khỏi máy</button><button id="reading-cancel" type="button" class="btn-link">Hủy</button></div>`);
      $("#reading-keep-ebook").onclick = () => dismissReading(series);
      $("#reading-cancel").onclick = close;
      $("#reading-delete-ebook").onclick = () => { close(); options.deleteBook(series, { confirmed: true, onDeleted: () => dismissReading(series, false) }); };
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
    function mountGroupPicker(form, initial) {
      let selected = [...initial]; const original = form.elements.groups, label = original.closest("label"); original.type = "hidden";
      const picker = document.createElement("fieldset"); picker.className = "book-group-picker";
      picker.innerHTML = '<legend>Nhóm sách</legend><div class="book-group-chips"></div><label>Chọn hoặc tạo nhóm<input id="book-group-draft" maxlength="600" autocomplete="off" placeholder="Nhập tên rồi nhấn Enter"></label><div class="book-group-suggestions"></div><p class="tools-hint" role="status"></p>';
      label.replaceWith(picker); picker.append(original);
      const input = picker.querySelector("input:not([type=hidden])"), chips = picker.querySelector(".book-group-chips"), suggestions = picker.querySelector(".book-group-suggestions"), hint = picker.querySelector("p");
      const known = [...new Set(Object.values(state.books).flatMap((book) => book.groups))].sort((a, b) => a.localeCompare(b, "vi"));
      function paint() {
        original.value = selected.join(", "); chips.replaceChildren();
        selected.forEach((name) => { const button = document.createElement("button"); button.type = "button"; button.textContent = name + " ×"; button.setAttribute("aria-label", "Xóa nhóm " + name); button.onclick = () => { draftDirty = true; selected = selected.filter((v) => v !== name); paint(); input.focus(); }; chips.append(button); });
        suggestions.replaceChildren(); known.filter((name) => !selected.includes(name) && fold(name).includes(fold(input.value))).slice(0, 12).forEach((name) => { const button = document.createElement("button"); button.type = "button"; button.textContent = name; button.onclick = () => { input.value = name; commit(); input.focus(); }; suggestions.append(button); });
        hint.textContent = `${selected.length}/10 nhóm · Mỗi nhóm tối đa 60 ký tự.`;
      }
      function commit() {
        const added = input.value.split(",").map((v) => v.trim()).filter(Boolean), next = [...new Set([...selected, ...added])];
        if (next.length > 10 || added.some((v) => v.length > 60)) { hint.textContent = "Chọn tối đa 10 nhóm, mỗi nhóm tối đa 60 ký tự."; input.focus(); return false; }
        if (added.length) draftDirty = true; selected = next; input.value = ""; paint(); return true;
      }
      input.oninput = paint;
      input.onkeydown = (event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commit(); } };
      form.addEventListener("submit", (event) => { if (!commit()) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
      paint();
    }
    function manageBook(series) {
      const current = row(series);
      show("Quản lý sách", `<form id="book-edit-form"><label>Trạng thái<select name="status">${[["", "Tự nhận diện theo tiến độ"], ["cleared", "Không nằm trong Đang đọc"], ["want", "Muốn đọc"], ["reading", "Đang đọc"], ["done", "Đã đọc"]].map(([v, label]) => `<option value="${v}"${(current.status === null ? "cleared" : current.status) === v ? " selected" : ""}>${label}</option>`).join("")}</select></label><label>Nhóm · phân cách bằng dấu phẩy<input name="groups" maxlength="600" value="${escape(current.groups.join(", "))}" placeholder="Light novel, Đọc cuối tuần"></label>${series.personal ? `<label>Tên sách<input name="title" maxlength="250" required value="${escape(series.titleVi)}"></label><label>Tác giả<input name="author" maxlength="150" value="${escape(series.author)}"></label><img class="book-edit-cover" src="${escape(series.cover)}" alt="Bìa hiện tại"><label>Đổi bìa<input name="cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><label class="library-check"><input name="resetCover" type="checkbox">Dùng bìa chữ theo tên sách</label>` : `<p class="tools-hint">${escape(series.titleVi)}</p>`}<button class="btn-primary" type="submit">Lưu thay đổi</button></form>`);
      mountGroupPicker($("#book-edit-form"), current.groups);
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
          state.books[series.slug] = { ...current, status: data.get("status") === "cleared" ? null : String(data.get("status")), groups: [...new Set(String(data.get("groups")).split(",").map((g) => g.trim().slice(0, 60)).filter(Boolean))].slice(0, 10) };
          if (!persist()) { state.books[series.slug] = current; throw new Error("Không lưu được nhóm sách."); }
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
        if (mark.id && JSON.stringify(saved) !== JSON.stringify(mark)) saved.changeId = crypto.randomUUID();
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
    function showVersions(markId) {
      // Reload first: another tab or the cloud may have added a revision.
      Object.assign(state, normalizeState(JSON.parse(localStorage.getItem(KEY) || "null")));
      const versions = state.versions.filter((v) => markId ? v.markId === markId : !state.marks.some((m) => m.id === v.markId)).sort((a, b) => b.at - a.at);
      const displayed = markId ? versions : [...new Map(versions.map((v) => [v.markId, v])).keys()].map((id) => versions.find((v) => v.markId === id));
      show(markId ? "Lịch sử chỉnh sửa" : "Thùng rác", `<p class="tools-hint">Giữ 30 ngày kể từ khi lưu hoặc xóa. Lịch sử bắt đầu từ lần nâng cấp này.</p><button type="button" class="btn-link" id="versions-back">Về ghi chú</button>${displayed.map((v) => `<article class="tool-card"><h3>${escape(v.value.label || "Ghi chú")}</h3><p class="tools-hint">${escape(new Date(v.at).toLocaleString("vi"))} · ${v.deleted ? "Đã xóa" : "Bản trước khi lưu"}</p><p>${escape(v.value.note || v.value.parts?.map((p) => p.quote).join(" ") || "Vị trí đã đánh dấu")}</p><div class="tools-actions"><button type="button" class="btn-secondary" data-restore-version="${escape(v.id)}">Khôi phục bản này</button>${!markId ? `<button type="button" class="btn-link" data-purge-version="${escape(v.id)}">Xóa vĩnh viễn</button><button type="button" class="btn-link" data-versions-mark="${escape(v.markId)}">Lịch sử chỉnh sửa</button>` : ""}</div></article>`).join("") || '<p class="tools-empty">Chưa có phiên bản lưu trữ.</p>'}`);
      $("#versions-back").onclick = showMarks;
      panel.querySelectorAll("[data-versions-mark]").forEach((b) => b.onclick = () => showVersions(b.dataset.versionsMark));
      async function action(button, purge) {
        const version = versions.find((v) => v.id === (purge ? button.dataset.purgeVersion : button.dataset.restoreVersion));
        if (!version) return;
        if (purge && !await globalThis.AppDialog.confirm({ title: "Xóa vĩnh viễn ghi chú và toàn bộ lịch sử? Không thể hoàn tác.", danger: true })) return;
        const before = JSON.parse(localStorage.getItem(KEY) || "null"), current = before?.marks?.find((m) => m.id === version.markId);
        if (current && !await globalThis.AppDialog.confirm({ title: "Khôi phục sẽ thay thế ghi chú hiện tại bằng phiên bản đã chọn. Giữ phiên bản này?", danger: true })) return;
        button.disabled = true;
        try {
          const cloud = await globalThis.ReaderWorkspace?.noteAction?.(purge ? "purge" : "restore", version);
          if (cloud === "queued") { feedback("Đã xếp hàng xóa vĩnh viễn. Cần kết nối để kiểm tra xung đột và hoàn tất."); return; }
          Object.assign(state, normalizeState(JSON.parse(localStorage.getItem(KEY) || "null")));
          if (!cloud && purge) { state.versions = state.versions.filter((v) => v.markId !== version.markId); if (!persist()) { Object.assign(state, normalizeState(before)); return; } }
          else if (!cloud) {
            const restored = { ...version.value, changeId: crypto.randomUUID() }; state.marks = [...state.marks.filter((m) => m.id !== restored.id), restored];
            const old = state.versions;
            state.versions = [...old, { id: crypto.randomUUID(), markId: restored.id, value: restored, deleted: false, at: Date.now(), uploaded: false }];
            if (!persist()) { Object.assign(state, normalizeState(before)); return; }
          } else if (purge) { state.versions = state.versions.filter((v) => v.markId !== version.markId); localStorage.setItem(KEY, JSON.stringify(state)); }
          decorateAll(); showVersions(markId); options.message(purge ? "Đã xóa vĩnh viễn." : "Đã khôi phục ghi chú và vị trí đánh dấu.");
        } catch (error) { feedback(error.code === "40001" ? "Ghi chú đã đổi trên máy khác. Kiểm tra đồng bộ, chọn bản cần giữ rồi thử lại." : error.message); }
        finally { button.disabled = false; }
      }
      panel.querySelectorAll("[data-restore-version]").forEach((b) => b.onclick = () => action(b, false));
      panel.querySelectorAll("[data-purge-version]").forEach((b) => b.onclick = () => action(b, true));
    }
    function showMarks() {
      const current = ctx(), available = state.marks.filter((mark) => !markScope || mark.slug === markScope).sort((a, b) => b.createdAt - a.createdAt);
      show("Đánh dấu & Ghi chú", `<div class="tools-actions"><button type="button" id="bookmark-position" class="btn-primary"${current.view !== "reader" ? " disabled" : ""}>Lưu vị trí đang đọc</button><button type="button" id="marks-trash" class="btn-secondary">Thùng rác</button></div><label>Sách<select id="marks-scope"><option value="">Tất cả sách</option>${options.series.map((book) => `<option value="${escape(book.slug)}"${book.slug === markScope ? " selected" : ""}>${escape(book.titleVi)}</option>`).join("")}</select></label><div class="saved-annotations">${available.length ? available.map((mark) => {
        const book = options.series.find((s) => s.slug === mark.slug), chapter = book?.volumesData?.[mark.volIdx]?.chapters[mark.chapIdx];
        return `<article class="tool-card"><h3>${mark.type === "bookmark" ? "🔖 " : ""}${escape(mark.label || "Đoạn đã tô màu")}</h3><p class="tools-hint">${escape(book?.titleVi || "Sách chưa có trên kệ")} · ${escape(chapter?.title || "")}</p>${mark.parts.length ? `<blockquote>${escape(mark.parts.map((p) => p.quote).join("\n").slice(0, 250))}</blockquote>` : ""}${mark.note ? `<p>${escape(mark.note)}</p>` : ""}<div class="tools-actions"><button type="button" class="btn-link" data-open-mark="${escape(mark.id)}"${chapter ? "" : " disabled"}>Đến vị trí</button><button type="button" class="btn-link" data-edit-mark="${escape(mark.id)}">Sửa / Xóa</button><button type="button" class="btn-link" data-history-mark="${escape(mark.id)}">Lịch sử chỉnh sửa</button></div></article>`;
      }).join("") : '<p class="tools-empty">Chưa có đánh dấu. Bôi đen câu để tô màu hoặc lưu vị trí đang đọc.</p>'}</div>`);
      $("#bookmark-position").onclick = bookmark;
      $("#marks-trash").onclick = () => showVersions();
      panel.querySelectorAll("[data-history-mark]").forEach((b) => b.onclick = () => showVersions(b.dataset.historyMark));
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
    return { filterSeries, setSection, setShelfView, shelfView: () => shelfView, shelfItem, decorate, quickBookmark, openMarks: () => { markScope = ctx().view === "reader" ? ctx().series.slug : ""; showMarks(); }, openLayout: showLayout, openToc: showToc,
      reload: () => { const next = normalizeState(JSON.parse(localStorage.getItem(KEY) || "null")); Object.assign(state, next); updateGroups(); },
      attachHost: (host) => { embeddedHost = host; }, canClose: () => { if (busy) return false; if (draftDirty) { feedback("Bản nháp vẫn ở đây. Hãy lưu hoặc huỷ thay đổi trước khi chuyển mục."); return false; } return true; },
      resumeReading(series) { if (row(series).status !== null) return; const previous = state.books[series.slug]; state.books[series.slug] = { ...row(series), status: "reading" }; if (!persist()) state.books[series.slug] = previous; },
      getMarks: () => state.marks.filter((m) => m.slug === ctx().series.slug), getLayout: () => ({ ...state.layout }),
      setLayout: (layout) => { state.layout = normalizeState({ ...state, layout }).layout; persist(); options.preservePosition(applyLayout); },
      isOpen, onView() { pendingSelection = null; if (isOpen() && !busy) close(); } };
  }
  return { create, normalizeState, locatePart, fold, highlightRange };
});
