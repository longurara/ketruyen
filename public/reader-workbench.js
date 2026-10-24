(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReaderWorkbench = api;
})(globalThis, function () {
  "use strict";
  const KEY = "tenshi-workbench-v1";
  const ACTIONS = { map: "Bản đồ sách", preview: "Lật xem trước", xray: "Lần xuất hiện", words: "Chú giải từ", vocabulary: "Sổ từ vựng", profiles: "Hồ sơ đọc", bookmark: "Đánh dấu", marks: "Ghi chú", settings: "Cài đặt", journal: "Nhật ký đọc" };
  const GROUPS = { read: { label: "Đọc", tabs: ["contents", "map", "preview", "stats", "goal", "journal", "profiles", "layout", "options"] }, lookup: { label: "Tra cứu", tabs: ["characters", "xray", "toc"] }, notes: { label: "Ghi chú", tabs: ["marks", "quotes"] }, learn: { label: "Học từ", tabs: ["words", "vocabulary", "pronunciation"] } };
  const LABELS = { ...ACTIONS, contents: "Mục lục", characters: "Nhân vật", stats: "Thống kê", goal: "Mục tiêu", pronunciation: "Phát âm", quotes: "Trích dẫn", layout: "Vùng đọc", toc: "Mục lục EPUB", options: "Tùy chỉnh" };
  const FEATURE_TABS = ["characters", "stats", "goal", "pronunciation", "quotes"];
  const clean = (v, n = 200) => typeof v === "string" ? v.trim().slice(0, n) : "";
  const clamp = (v, lo, hi, fallback = lo) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fallback;
  const escape = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => crypto.randomUUID();
  function profileSettings(v = {}) {
    const choice = (key, values, fallback) => values.includes(v[key]) ? v[key] : fallback;
    return { fontSize: clamp(v.fontSize, 16, 28, 20), lineHeight: clamp(v.lineHeight, 1.4, 2.6, 2.02),
      fontFamily: choice("fontFamily", ["serif", "sans", "system"], "serif"), theme: choice("theme", ["light", "sepia", "dark"], "sepia"),
      imageMode: choice("imageMode", ["color", "mono"], "color"), eink: Boolean(v.eink), continuous: Boolean(v.continuous), tap: Boolean(v.tap),
      layout: { width: clamp(v.layout?.width, 460, 1100, 700), margin: clamp(v.layout?.margin, 12, 64, 48), gap: clamp(v.layout?.gap, 0.4, 2, 0.85) } };
  }
  function normalizeState(input) {
    const v = input && typeof input === "object" ? input : {};
    const terms = (items, vocabulary) => (Array.isArray(items) ? items : []).slice(0, 1000).filter((t) => t && clean(t.term, 80) && clean(t.meaning, 1000) && clean(t.slug, 100)).map((t) => ({
      id: /^[a-z\d_-]{1,80}$/i.test(t.id) ? t.id : "", slug: clean(t.slug, 100), term: clean(t.term, 80), meaning: clean(t.meaning, 1000),
      sentence: clean(t.sentence, 1200), volIdx: Math.floor(clamp(t.volIdx, 0, 3000)), chapIdx: Math.floor(clamp(t.chapIdx, 0, 3000)), p: Math.floor(clamp(t.p, 0, 100000)),
      ...(vocabulary ? { level: Math.floor(clamp(t.level, 0, 6)), due: clamp(t.due, 0, 1e15), added: clamp(t.added, 0, 1e15) } : {})
    }));
    return { version: 1, inline: Boolean(v.inline), glossary: terms(v.glossary, false), vocabulary: terms(v.vocabulary, true),
      quick: [...new Set((Array.isArray(v.quick) ? v.quick : ["map", "preview", "bookmark", "vocabulary"]).filter((a) => Object.hasOwn(ACTIONS, a)))].slice(0, 8),
      footer: { book: v.footer?.book !== false, chapter: v.footer?.chapter !== false, time: v.footer?.time !== false, hidden: Boolean(v.footer?.hidden) },
      profiles: (Array.isArray(v.profiles) ? v.profiles : []).slice(0, 12).filter((p) => p && clean(p.name, 60)).map((p) => ({ id: clean(p.id, 80), name: clean(p.name, 60), settings: profileSettings(p.settings) })) };
  }
  function bookPosition(entries, index, fraction) {
    const weights = entries.map((e) => Math.max(1, Number(e.chapter.words) || 0));
    const total = weights.reduce((a, b) => a + b, 0);
    return total ? (weights.slice(0, index).reduce((a, b) => a + b, 0) + (weights[index] || 0) * clamp(fraction, 0, 1)) / total : 0;
  }
  function positionTarget(entries, fraction) {
    const weights = entries.map((e) => Math.max(1, Number(e.chapter.words) || 0)), total = weights.reduce((a, b) => a + b, 0);
    let remaining = clamp(fraction, 0, 1) * total;
    for (let index = 0; index < weights.length; index++) {
      if (remaining < weights[index] || index === weights.length - 1) return { index, fraction: clamp(remaining / weights[index], 0, 1) };
      remaining -= weights[index];
    }
    return { index: 0, fraction: 0 };
  }
  function termMatches(text, names) {
    if (!names.length) return [];
    const unique = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${unique.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
    return [...text.matchAll(pattern)].map((m) => ({ start: m.index, end: m.index + m[0].length, term: m[0] }));
  }
  function create(options) {
    const $ = (s) => document.querySelector(s), ctx = options.context;
    let state; try { state = normalizeState(JSON.parse(localStorage.getItem(KEY))); } catch (_) { state = normalizeState(); }
    let committed = JSON.stringify(state), generation = 0, activeTab = "home", opener = null, selection = null, target = null;
    const entries = () => ReaderFeatures.chapterEntries(ctx().series);
    const currentIndex = (items = entries()) => Math.max(0, items.findIndex((e) => e.volIdx === ctx().volIdx && e.chapIdx === ctx().chapIdx));
    const persist = () => {
      try { const serialized = JSON.stringify(state); localStorage.setItem(KEY, serialized); committed = serialized; return true; }
      catch (_) { state = normalizeState(JSON.parse(committed)); options.message("Không đủ chỗ lưu tiện ích. Hãy sao lưu rồi giải phóng dung lượng."); return false; }
    };
    document.body.insertAdjacentHTML("beforeend", `<dialog id="workbench-dialog" class="tools-dialog workbench-dialog" aria-labelledby="workbench-title"><header class="tools-header"><div><p class="tools-eyebrow" id="workbench-book"></p><h2 id="workbench-title">Tiện ích sách</h2></div><button type="button" class="tools-close" aria-label="Đóng tiện ích sách"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg></button></header><section id="workbench-home-panel" class="workbench-home-panel"><label>Tìm chức năng<input id="workbench-search" type="search" placeholder="Ghi chú, nhân vật, cỡ chữ…"></label><div id="workbench-home-results"></div></section><div id="workbench-panel" class="workbench-panel"></div></dialog><aside id="reader-quick-menu" class="reader-quick-menu" hidden><button id="reader-quick-toggle" type="button" class="btn-secondary" aria-expanded="false" aria-controls="reader-quick-actions"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"></path></svg>Tiện ích</button><div id="reader-quick-actions" hidden></div></aside><div id="reader-status-footer" class="reader-status-footer" hidden></div>`);
    const dialog = $("#workbench-dialog"), panel = $("#workbench-panel"), quick = $("#reader-quick-menu"), quickActions = $("#reader-quick-actions"), footer = $("#reader-status-footer");
    let featureArgument = null, libraryActive = false;
    $("#workbench-title").textContent = "Tiện ích đọc";
    panel.insertAdjacentHTML("beforebegin", '<button type="button" class="btn-link workbench-return" id="workbench-library-return" hidden>← Về tiện ích</button>');
    panel.insertAdjacentHTML("afterend", '<div id="workbench-feature-slot" class="workbench-external" hidden></div><div id="workbench-library-slot" class="workbench-external" hidden></div>');
    const featureSlot = $("#workbench-feature-slot"), librarySlot = $("#workbench-library-slot");
    featureSlot.append($("#tools-feedback"), $("#tools-panel")); librarySlot.append($("#library-feedback"), $("#library-tools-panel"));
    $("#reader-tools-dialog").hidden = true; $("#library-dialog").hidden = true;
    options.features.attachHost({ open: (tab, argument) => open(tab, argument), close, isOpen: () => dialog.open && FEATURE_TABS.includes(activeTab) && !libraryActive });
    options.library.attachHost({ show: showLibrary, close, closeLibrary: () => options.surfaces.close(dialog), isOpen: () => dialog.open && libraryActive });
    options.surfaces.attach(dialog, { canClose: () => !libraryActive || options.library.canClose() });
    $("#workbench-library-return").onclick = () => render("home");
    const dockMedia = matchMedia("(max-width: 1080px)");
    function updateDock() { if (dockMedia.matches) $("#reader-bottom-nav").prepend(footer); else document.body.append(footer); }
    dockMedia.addEventListener("change", updateDock); updateDock();
    const settings = document.createElement("section"); settings.className = "settings-section";
    settings.innerHTML = '<h4 class="settings-section-title">Tiện ích sách</h4><p class="settings-hint">Bản đồ sách, xem trước, chú giải, sổ từ và hồ sơ đọc.</p><button type="button" class="btn-secondary settings-action" data-workbench="options">Tùy chỉnh tiện ích</button>';
    $("#settings-progress-section").before(settings);
    $("#selection-summary").insertAdjacentHTML("beforebegin", '<button type="button" data-workbench-selection="words" title="Chú giải hoặc lưu vào sổ từ"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 8h7M9 12h5"/></svg><span>Chú giải</span></button>');
    const sideButton = document.createElement("button"); sideButton.type = "button"; sideButton.className = "side-settings-btn"; sideButton.dataset.workbench = "home"; sideButton.innerHTML = '<span class="side-settings-glyph" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h7v16H4zM14 4h6v16h-6zM7 8h1M7 12h1M17 8h1M17 12h1"></path></svg></span>Tiện ích đọc';
    $("#btn-reader-listen").after(sideButton);
    function close() { if (!libraryActive || options.library.canClose()) options.surfaces.close(dialog); }
    dialog.querySelector(".tools-close").onclick = close;
    dialog.addEventListener("close", () => { generation++; opener?.focus({ preventScroll: true }); });
    dialog.querySelectorAll("[data-workbench-tab]").forEach((b) => b.onclick = () => render(b.dataset.workbenchTab));
    function open(tab = activeTab, argument) {
      options.closeSettings(); quickActions.hidden = true; $("#reader-quick-toggle").setAttribute("aria-expanded", "false");
      if (!dialog.open) opener = document.activeElement?.closest("#reader-quick-actions") ? $("#reader-quick-toggle") : document.activeElement;
      $("#workbench-book").textContent = ctx().series.titleVi; target = null; featureArgument = argument;
      if (!dialog.open) options.surfaces.open(dialog); updateStatus(); render(tab);
    }
    function updateNavigation() {
      $("#workbench-home-panel").hidden = activeTab !== "home" || libraryActive;
      $("#workbench-library-return").hidden = activeTab === "home" && !libraryActive;
      $("#workbench-library-return").disabled = libraryActive && !options.library.canClose();
    }
    function renderHome() {
      const fold = (v) => v.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").toLowerCase();
      const registry = Object.entries(GROUPS).flatMap(([group, data]) => data.tabs.map((id) => ({ id, group, name: LABELS[id] }))).concat([{id:"bookmark",group:"read",name:LABELS.bookmark},{id:"settings",group:"read",name:LABELS.settings}]);
      const search = $("#workbench-search"), host = $("#workbench-home-results");
      const button = (id) => `<button type="button" class="workbench-home-action" data-home-action="${id}">${escape(LABELS[id])}<span aria-hidden="true">→</span></button>`;
      const list = () => {
        const query = fold(search.value.trim()), matches = registry.filter((r) => fold(r.name + " " + GROUPS[r.group].label + " " + ({ words: "chu giai word wise", xray: "x ray", settings: "co chu font", profiles: "cai dat" }[r.id] || "")).includes(query));
        host.innerHTML = query ? matches.map((r) => button(r.id)).join("") || '<p class="tools-empty">Không tìm thấy chức năng phù hợp.</p>' : '<h3>Hay dùng</h3><div class="workbench-home-quick">' + state.quick.map(button).join("") + '</div><details id="workbench-all"><summary>Tất cả tiện ích (' + registry.length + ')</summary>' + Object.entries(GROUPS).map(([id, group]) => '<section><h3>' + group.label + '</h3>' + registry.filter((r) => r.group === id).map((r) => button(r.id)).join("") + '</section>').join("") + '</details>';
        host.querySelectorAll("[data-home-action]").forEach((b) => b.onclick = () => act(b.dataset.homeAction));
      };
      search.oninput = list; list();
    }
    function openHome() { open("home"); }
    function showLibrary(title) {
      if (!dialog.open) { opener = document.activeElement; options.closeSettings(); options.surfaces.open(dialog); }
      libraryActive = true; generation++; panel.hidden = true; featureSlot.hidden = true; librarySlot.hidden = false;
      $("#workbench-title").textContent = title; $("#workbench-library-return").hidden = false; updateNavigation();
    }
    function render(tab) {
      if (libraryActive && !options.library.canClose()) return;
      activeTab = tab; libraryActive = false; generation++; panel.scrollTop = 0;
      $("#workbench-title").textContent = LABELS[tab] || "Tiện ích đọc";
      panel.hidden = FEATURE_TABS.includes(tab); featureSlot.hidden = !panel.hidden; librarySlot.hidden = true; updateNavigation();
      if (tab === "home") { panel.hidden = true; renderHome(); return; }
      if (FEATURE_TABS.includes(tab)) { options.features.renderEmbedded(tab, featureArgument); featureArgument = null; return; }
      if (tab === "marks") { options.library.openMarks(); return; }
      if (tab === "journal") { options.journal.open(ctx().series.slug); return; }
      if (tab === "layout") { options.library.openLayout(); return; }
      if (tab === "toc") { options.library.openToc(); return; }
      if (tab === "contents") renderContents();
      if (tab === "map") renderMap();
      if (tab === "preview") renderPreview();
      if (tab === "xray") renderXray();
      if (tab === "words") renderWords();
      if (tab === "vocabulary") renderVocabulary();
      if (tab === "profiles") renderProfiles();
      if (tab === "options") renderOptions();
    }
    function renderContents() {
      const items = entries(), current = currentIndex(items);
      panel.innerHTML = '<label>Tìm chương<input id="workbench-chapter-search" type="search" placeholder="Tên tập hoặc chương"></label><div class="tools-actions"><button id="workbench-chapter-prev" type="button" class="btn-secondary">← Chương trước</button><button id="workbench-chapter-next" type="button" class="btn-secondary">Chương sau →</button></div><nav id="workbench-chapters" class="book-map" aria-label="Chương trong sách"></nav>';
      if (options.canReturn()) {
        panel.insertAdjacentHTML("afterbegin", '<button id="workbench-reader-return" type="button" class="btn-secondary">← Về chỗ vừa đọc</button>');
        $("#workbench-reader-return").onclick = () => { close(); options.returnToReadingPosition(); };
      }
      const list = () => {
        const query = $("#workbench-chapter-search").value.trim().toLocaleLowerCase();
        $("#workbench-chapters").innerHTML = items.map((entry, i) => ({ entry, i })).filter(({ entry }) => `${entry.volume.name} ${entry.chapter.title}`.toLocaleLowerCase().includes(query)).map(({ entry, i }) => `<button type="button" data-contents-chapter="${i}"${i === current && ctx().view === "reader" ? ' aria-current="location"' : ""}><span>${escape(entry.volume.name)} · ${escape(entry.chapter.title)}</span></button>`).join("") || '<p class="tools-empty">Không có chương khớp.</p>';
        panel.querySelectorAll("[data-contents-chapter]").forEach((b) => b.onclick = () => jump(Number(b.dataset.contentsChapter)));
      };
      const jump = (index) => { const entry = items[index]; if (!entry) return; close(); if (index !== current || ctx().view !== "reader") options.openChapter(entry.volIdx, entry.chapIdx); };
      $("#workbench-chapter-search").oninput = list; list();
      $("#workbench-chapter-prev").disabled = current === 0; $("#workbench-chapter-next").disabled = current === items.length - 1;
      $("#workbench-chapter-prev").onclick = () => jump(current - 1); $("#workbench-chapter-next").onclick = () => jump(current + 1);
    }
    function renderMap() {
      const items = entries(), marks = options.marks(), progress = options.progress(), max = Math.max(1, ...items.map((e) => e.chapter.words || 1));
      panel.innerHTML = `<p class="tools-hint">Độ dài thanh tương ứng số từ. Phần tô là tiến độ đã đọc; ◆ có bookmark, ✎ có ghi chú. Bấm chương để xem trước mà vẫn giữ chỗ đang đọc.</p><div class="book-map">${items.map((e, i) => {
        const saved = progress[`${e.volIdx}:${e.chapIdx}`], percent = i === currentIndex(items) ? ctx().percent : saved?.done ? 100 : saved?.pct || 0;
        const inChapter = marks.filter((m) => m.volIdx === e.volIdx && m.chapIdx === e.chapIdx);
        return `<button type="button" data-map="${i}" ${i === currentIndex(items) ? 'aria-current="location"' : ""}><span>${escape(e.volume.name)} · ${escape(e.chapter.title)}</span><span class="book-map-track" style="width:${Math.max(8, (e.chapter.words || 1) / max * 100)}%"><i style="width:${clamp(percent, 0, 100)}%"></i></span><small>${Math.round(percent)}% ${inChapter.some((m) => m.type === "bookmark") ? "◆" : ""} ${inChapter.some((m) => m.type === "highlight") ? "✎" : ""}</small></button>`;
      }).join("")}</div>`;
      panel.querySelectorAll("[data-map]").forEach((b) => b.onclick = () => { target = { index: Number(b.dataset.map), fraction: 0 }; render("preview"); });
    }
    function renderPreview() {
      const items = entries(); if (!items.length) { panel.textContent = "Sách chưa có chương."; return; }
      target ||= { index: currentIndex(items), fraction: ctx().percent / 100 };
      target.index = Math.floor(clamp(target.index, 0, items.length - 1));
      panel.innerHTML = `<p class="tools-hint">Lật xem trước không đổi tiến độ. “Về chỗ đang đọc” đóng khung này; “Đọc từ đây” mới chuyển vị trí.</p><div class="skim-controls"><button type="button" id="skim-prev" class="btn-secondary" aria-label="Xem chương trước">←</button><select id="skim-chapter" aria-label="Chương xem trước">${items.map((e, i) => `<option value="${i}"${i === target.index ? " selected" : ""}>${escape(e.volume.name)} · ${escape(e.chapter.title)}</option>`).join("")}</select><button type="button" id="skim-next" class="btn-secondary" aria-label="Xem chương sau">→</button></div><label class="skim-label">Vị trí trong sách <output id="skim-percent"></output><input id="skim-range" type="range" min="0" max="1000" value="${Math.round(bookPosition(items, target.index, target.fraction) * 1000)}"></label><label class="skim-label">Bookmark / ghi chú<select id="skim-mark"><option value="">Chọn vị trí đã lưu…</option>${options.marks().map((m, i) => `<option value="${i}">${escape(m.label || (m.type === "bookmark" ? "Bookmark" : "Ghi chú"))} · ${escape(items.find((e) => e.volIdx === m.volIdx && e.chapIdx === m.chapIdx)?.chapter.title || "")}</option>`).join("")}</select></label><div class="tools-actions"><button type="button" id="skim-return" class="btn-secondary">Về chỗ đang đọc</button><button type="button" id="skim-read" class="btn-primary" disabled>Đọc từ đây</button></div><div id="page-flip-preview" class="page-flip-preview" aria-live="polite"></div>`;
      const changeChapter = (index) => { target = { index: clamp(index, 0, items.length - 1), fraction: 0 }; renderPreview(); };
      $("#skim-prev").disabled = target.index === 0; $("#skim-next").disabled = target.index === items.length - 1;
      $("#skim-prev").onclick = () => changeChapter(target.index - 1); $("#skim-next").onclick = () => changeChapter(target.index + 1);
      $("#skim-chapter").onchange = (ev) => changeChapter(Number(ev.target.value));
      let debounce;
      $("#skim-range").oninput = (ev) => { target = positionTarget(items, Number(ev.target.value) / 1000); $("#skim-percent").textContent = `${Math.round(Number(ev.target.value) / 10)}%`; clearTimeout(debounce); debounce = setTimeout(() => { if (dialog.open && activeTab === "preview") renderPreview(); }, 140); };
      $("#skim-mark").onchange = (ev) => {
        const mark = options.marks()[Number(ev.target.value)]; if (ev.target.value === "" || !mark) return;
        const index = items.findIndex((e) => e.volIdx === mark.volIdx && e.chapIdx === mark.chapIdx);
        if (index < 0) return; target = { index, fraction: 0, p: mark.type === "bookmark" ? mark.anchor?.block : mark.parts[0]?.p, anchor: mark.type === "bookmark" ? mark.anchor : null }; renderPreview();
      };
      $("#skim-percent").textContent = `${Math.round(bookPosition(items, target.index, target.fraction) * 100)}%`;
      $("#skim-return").onclick = close;
      const token = ++generation, series = ctx().series, chosen = { ...target }, preview = $("#page-flip-preview"); preview.textContent = "Đang tải phần xem trước…";
      options.loadVolume(items[chosen.index].volIdx).then(() => {
        if (token !== generation || ctx().series !== series || !dialog.open) return;
        const entry = items[chosen.index], paragraphs = options.paragraphs(entry.volIdx, entry.chapIdx);
        const p = Math.floor(clamp(chosen.p ?? chosen.fraction * paragraphs.length, 0, Math.max(0, paragraphs.length - 1)));
        preview.innerHTML = `<h3>${escape(entry.chapter.title)}</h3>${entry.chapter.images?.map((img) => `<img loading="lazy" src="${escape(img.src)}" width="${img.w}" height="${img.h}" alt="Trang / minh họa ${escape(entry.chapter.title)}">`).join("") || ""}${paragraphs.slice(p, p + 16).map((text) => `<p>${escape(text)}</p>`).join("")}${p + 16 < paragraphs.length ? '<p class="tools-hint">Còn nội dung phía sau. Kéo thanh vị trí để xem tiếp.</p>' : ""}`;
        $("#skim-read").disabled = false;
        $("#skim-read").onclick = () => { close(); options.openChapter(entry.volIdx, entry.chapIdx, chosen.anchor ? { anchor: chosen.anchor } : { hit: { p }, fromTop: p === 0 }); };
      }).catch(() => { if (token === generation) preview.textContent = "Không tải được chương. Kiểm tra kết nối hoặc bản offline rồi thử lại."; });
    }
    async function renderXray() {
      const chars = options.characters(), items = entries(), reached = new Set(options.reached());
      const highest = items.reduce((last, e, i) => reached.has(e.id) ? i : last, -1);
      if (!chars.length) { panel.innerHTML = '<p class="tools-empty">Chưa có nhân vật được mở khóa. Thêm nhân vật trong “Tiện ích đọc” để tìm các lần xuất hiện.</p>'; return; }
      panel.innerHTML = `<p class="tools-hint">Chỉ tìm đến chương xa nhất bạn đã mở. Không hiển thị lần xuất hiện trong các chương phía sau.</p><label>Nhân vật<select id="xray-character">${chars.map((c, i) => `<option value="${i}">${escape(c.name)}</option>`).join("")}</select></label><p id="xray-summary" role="status"></p><div id="xray-results"></div>`;
      const scan = async () => {
        const token = ++generation, series = ctx().series, character = chars[Number($("#xray-character").value)], results = $("#xray-results"), summary = $("#xray-summary");
        results.innerHTML = ""; summary.textContent = "Đang tìm trong những chương đã mở khóa…";
        let chapters = 0, occurrences = 0, unavailable = 0;
        for (const entry of items.slice(0, highest + 1)) {
          if (token !== generation || ctx().series !== series || !dialog.open) return;
          try { await options.loadVolume(entry.volIdx); } catch (_) { unavailable++; continue; }
          if (token !== generation || ctx().series !== series || !dialog.open) return;
          const found = options.paragraphs(entry.volIdx, entry.chapIdx).map((text, p) => ({ text, p, hits: termMatches(text, [character.name, ...(character.aliases || [])]) })).filter((p) => p.hits.length);
          if (found.length) {
            chapters++; occurrences += found.reduce((n, p) => n + p.hits.length, 0);
            const card = document.createElement("article"); card.className = "tool-card";
            card.innerHTML = `<h3>${escape(entry.volume.name)} · ${escape(entry.chapter.title)}</h3>${found.slice(0, 3).map((f, i) => `<p>${escape(f.text.slice(Math.max(0, f.hits[0].start - 90), f.hits[0].start + 220))}</p><button type="button" class="btn-secondary" data-xray-hit="${i}">Đọc đoạn này</button>`).join("")}`;
            card.querySelectorAll("[data-xray-hit]").forEach((b) => b.onclick = () => { close(); options.openChapter(entry.volIdx, entry.chapIdx, { hit: { p: found[Number(b.dataset.xrayHit)].p } }); }); results.append(card);
          }
        }
        if (token === generation) summary.textContent = `${occurrences} lần trong ${chapters} chương.${unavailable ? ` ${unavailable} chương chưa tải được; kết quả chưa đầy đủ.` : ""}`;
      };
      $("#xray-character").onchange = scan; await scan();
    }
    function selectedSource() {
      const selected = window.getSelection(); if (!selected?.rangeCount || selected.isCollapsed) return null;
      const range = selected.getRangeAt(0), element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const paragraph = element.closest("p[data-p]"), frame = element.closest(".reader-frame");
      if (!frame || !paragraph || !paragraph.contains(range.endContainer)) return null;
      const term = String(selected).trim(); if (!term || term.length > 80) return null;
      return { term, meaning: "", slug: ctx().series.slug, sentence: paragraph.textContent.slice(0, 1200), volIdx: Number(frame.dataset.vol), chapIdx: Number(frame.dataset.chap), p: Number(paragraph.dataset.p) };
    }
    document.addEventListener("selectionchange", () => { const source = selectedSource(); if (source) selection = source; });
    document.addEventListener("pointerdown", (event) => { if (event.target.closest("[data-workbench-selection]")) selection = selectedSource() || selection; }, { capture: true });
    function renderWords() {
      const book = ctx().series, terms = state.glossary.filter((t) => t.slug === book.slug), draft = selection?.slug === book.slug ? selection : {};
      panel.innerHTML = `<p class="tools-hint">Ghi nghĩa ngắn cho từ khó hoặc tên riêng. Bôi đen một từ trong truyện để lấy kèm câu gốc. Mọi dữ liệu chỉ lưu trên thiết bị này.</p><label class="workbench-switch"><span class="workbench-switch-copy"><strong>Hiện chú giải trong trang đọc</strong><span>Nghĩa ngắn hiện ngay phía trên từ trong truyện.</span></span><input id="word-wise-on" type="checkbox" role="switch"${state.inline ? " checked" : ""}></label><form id="glossary-form" class="tools-editor"><label>Từ / tên<input name="term" maxlength="80" required placeholder="Ví dụ: Phù thủy Tro Tàn" value="${escape(draft.term || "")}"></label><label>Nghĩa / chú giải<textarea name="meaning" maxlength="1000" required rows="2" placeholder="Một dòng ngắn gọn, hiện phía trên từ khi đọc">${escape(draft.meaning || "")}</textarea></label>${draft.sentence ? `<p class="tools-hint">${escape(draft.sentence)}</p>` : ""}<div class="tools-actions"><button class="btn-primary" type="submit">Lưu chú giải</button><button class="btn-secondary" type="submit" name="vocab" value="yes">Lưu chú giải & học từ</button></div></form><div>${terms.map((t, i) => `<article class="tool-card"><strong>${escape(t.term)}</strong><p>${escape(t.meaning)}</p><div class="tools-actions"><button type="button" class="btn-secondary" data-term-edit="${i}">Sửa</button><button type="button" class="btn-secondary" data-term-learn="${i}">Lưu học từ</button><button type="button" class="btn-secondary ui-danger" data-term-delete="${i}">Xóa</button></div></article>`).join("") || '<p class="tools-empty">Chưa có chú giải trong sách này.</p>'}</div>`;
      $("#word-wise-on").onchange = (ev) => { state.inline = ev.target.checked; persist(); decorateAll(); };
      $("#glossary-form").onsubmit = (ev) => {
        ev.preventDefault(); const form = new FormData(ev.target), term = clean(form.get("term"), 80), meaning = clean(form.get("meaning"), 1000); if (!term || !meaning) return;
        if (state.glossary.length >= 1000 && !state.glossary.some((t) => t.slug === book.slug && t.term.toLocaleLowerCase() === term.toLocaleLowerCase())) { options.message("Đã đạt giới hạn 1.000 chú giải."); return; }
        const value = { ...draft, id: draft.id || uid(), slug: book.slug, term, meaning, volIdx: draft.volIdx ?? ctx().volIdx, chapIdx: draft.chapIdx ?? ctx().chapIdx, p: draft.p || 0 };
        state.glossary = [...state.glossary.filter((t) => t.id !== value.id && !(t.slug === value.slug && t.term.toLocaleLowerCase() === term.toLocaleLowerCase())), value];
        if (ev.submitter?.name === "vocab") addVocabulary(value, false);
        if (persist()) { selection = null; decorateAll(); renderWords(); }
      };
      panel.querySelectorAll("[data-term-edit]").forEach((b) => b.onclick = () => { selection = { ...terms[Number(b.dataset.termEdit)] }; renderWords(); });
      panel.querySelectorAll("[data-term-learn]").forEach((b) => b.onclick = () => addVocabulary(terms[Number(b.dataset.termLearn)]));
      panel.querySelectorAll("[data-term-delete]").forEach((b) => b.onclick = () => { const term = terms[Number(b.dataset.termDelete)]; state.glossary = state.glossary.filter((t) => t !== term); persist(); decorateAll(); renderWords(); });
    }
    function addVocabulary(value, save = true) {
      const old = state.vocabulary.find((t) => t.slug === value.slug && t.term.toLocaleLowerCase() === value.term.toLocaleLowerCase());
      if (!old && state.vocabulary.length >= 1000) { options.message("Đã đạt giới hạn 1.000 từ vựng."); return; }
      if (old) Object.assign(old, { meaning: value.meaning, sentence: value.sentence || old.sentence });
      else state.vocabulary.push({ ...value, id: uid(), level: 0, due: 0, added: Date.now() });
      if (save && persist()) options.message("Đã lưu vào sổ từ vựng.");
    }
    function renderVocabulary() {
      const now = Date.now(), due = state.vocabulary.filter((t) => t.due <= now), cards = state.vocabulary, term = due[0];
      panel.innerHTML = `<p class="tools-hint">${cards.length} từ đã lưu · ${due.length} từ đến lượt ôn. Câu gốc giúp nhớ cách dùng. Bôi đen từ rồi chọn “Chú giải / Lưu từ” để thêm.</p>${term ? `<article class="vocabulary-card"><h3>${escape(term.term)}</h3><p>${escape(term.sentence || "Chưa lưu câu gốc.")}</p><button type="button" id="vocab-reveal" class="btn-primary">Hiện nghĩa</button><div id="vocab-answer" hidden><p>${escape(term.meaning)}</p><div class="tools-actions"><button type="button" data-vocab-rate="again" class="btn-secondary">Ôn lại sau 10 phút</button><button type="button" data-vocab-rate="good" class="btn-primary">Đã nhớ</button></div></div></article>` : '<p class="tools-empty">Chưa có từ cần ôn lúc này.</p>'}<details><summary>Danh sách từ đã lưu</summary>${cards.map((t, i) => `<article class="tool-card"><strong>${escape(t.term)}</strong><p>${escape(t.meaning)}</p><p class="tools-hint">${escape(t.sentence)} · Ôn ${new Date(t.due || now).toLocaleDateString("vi-VN")}</p><div class="tools-actions"><button type="button" class="btn-secondary" data-vocab-source="${i}">Câu gốc</button><button type="button" class="btn-secondary ui-danger" data-vocab-delete="${i}">Xóa từ</button></div></article>`).join("")}</details>`;
      if (term) {
        $("#vocab-reveal").onclick = (ev) => { ev.target.hidden = true; $("#vocab-answer").hidden = false; };
        panel.querySelectorAll("[data-vocab-rate]").forEach((b) => b.onclick = () => {
          if (b.dataset.vocabRate === "again") { term.level = 0; term.due = now + 10 * 60000; }
          else { term.level = Math.min(6, term.level + 1); term.due = now + [1, 1, 3, 7, 14, 30, 60][term.level] * 86400000; }
          persist(); renderVocabulary();
        });
      }
      panel.querySelectorAll("[data-vocab-delete]").forEach((b) => b.onclick = () => { state.vocabulary.splice(Number(b.dataset.vocabDelete), 1); persist(); renderVocabulary(); });
      panel.querySelectorAll("[data-vocab-source]").forEach((b) => b.onclick = () => {
        const t = cards[Number(b.dataset.vocabSource)]; if (!t.sentence) { options.message("Từ này chưa có câu gốc."); return; }
        close(); options.openSource(t);
      });
    }
    function decorateSection(section) {
      section.querySelectorAll(".word-wise-term").forEach((node) => {
        if (node.matches("button.character-link")) { node.classList.remove("word-wise-term"); delete node.dataset.term; delete node.dataset.definition; node.removeAttribute("title"); }
        else node.replaceWith(...node.childNodes);
      });
      section.querySelectorAll("p[data-p]").forEach((p) => p.normalize());
      if (!state.inline) return;
      const terms = state.glossary.filter((t) => t.slug === ctx().series.slug); if (!terms.length) return;
      const lookup = new Map(terms.map((t) => [t.term.toLocaleLowerCase(), t]));
      section.querySelectorAll("button.character-link").forEach((node) => {
        const term = lookup.get(node.textContent.toLocaleLowerCase());
        if (term) { node.classList.add("word-wise-term"); node.dataset.term = term.id; node.dataset.definition = term.meaning.slice(0, 36); node.title = term.meaning; }
      });
      section.querySelectorAll("p[data-p]").forEach((p) => {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nodes = []; let node;
        while ((node = walker.nextNode())) if (!node.parentElement.closest("button,a,mark,.word-wise-term")) nodes.push(node);
        for (const text of nodes) {
          const hits = termMatches(text.data, terms.map((t) => t.term)); if (!hits.length) continue;
          const fragment = document.createDocumentFragment(); let offset = 0;
          for (const hit of hits) {
            const term = lookup.get(hit.term.toLocaleLowerCase()); if (!term) continue;
            fragment.append(document.createTextNode(text.data.slice(offset, hit.start)));
            const word = document.createElement("span"); word.className = "word-wise-term"; word.dataset.term = term.id; word.dataset.definition = term.meaning.slice(0, 36); word.setAttribute("title", term.meaning); word.setAttribute("role", "button"); word.tabIndex = 0; word.textContent = text.data.slice(hit.start, hit.end); fragment.append(word); offset = hit.end;
          }
          fragment.append(document.createTextNode(text.data.slice(offset))); text.replaceWith(fragment);
        }
      });
    }
    function decorateAll() { options.preservePosition(() => document.querySelectorAll(".reader-frame").forEach(decorateSection)); }
    document.addEventListener("reader-characters-changed", decorateAll);
    function renderProfiles() {
      panel.innerHTML = `<p class="tools-hint">Lưu cỡ chữ, giãn dòng, phông, giao diện, ảnh, E-Ink, đọc liên tục, chạm lật trang và vùng đọc. Áp dụng hồ sơ giữ vị trí hiện tại.</p><form id="profile-form" class="tools-editor"><label>Tên hồ sơ<input name="name" required maxlength="60" placeholder="Đọc buổi tối"></label><button class="btn-primary" type="submit">Lưu cài đặt hiện tại</button></form>${state.profiles.map((p, i) => `<article class="tool-card"><h3>${escape(p.name)}</h3><p class="tools-hint">${p.settings.fontSize}px · ${p.settings.lineHeight} · ${escape(p.settings.theme)}</p><div class="tools-actions"><button type="button" class="btn-primary" data-profile-apply="${i}">Áp dụng</button><button type="button" class="btn-secondary" data-profile-update="${i}">Cập nhật từ hiện tại</button><button type="button" class="btn-secondary ui-danger" data-profile-delete="${i}">Xóa</button></div></article>`).join("")}`;
      $("#profile-form").onsubmit = (ev) => { ev.preventDefault(); if (state.profiles.length >= 12) { options.message("Tối đa 12 hồ sơ đọc."); return; } state.profiles.push({ id: uid(), name: clean(new FormData(ev.target).get("name"), 60), settings: profileSettings(options.getSettings()) }); persist(); renderProfiles(); };
      panel.querySelectorAll("[data-profile-apply]").forEach((b) => b.onclick = () => { options.preservePosition(() => options.applySettings(state.profiles[Number(b.dataset.profileApply)].settings)); options.message("Đã áp dụng hồ sơ đọc."); });
      panel.querySelectorAll("[data-profile-update]").forEach((b) => b.onclick = () => { state.profiles[Number(b.dataset.profileUpdate)].settings = profileSettings(options.getSettings()); persist(); renderProfiles(); });
      panel.querySelectorAll("[data-profile-delete]").forEach((b) => b.onclick = () => { state.profiles.splice(Number(b.dataset.profileDelete), 1); persist(); renderProfiles(); });
    }
    function renderOptions() {
      panel.innerHTML = `<h3>Menu nhanh</h3><p class="tools-hint">Chọn tối đa tám nút hiện trong menu “Tiện ích” khi đọc.</p><div class="workbench-options">${Object.entries(ACTIONS).map(([a, label]) => `<label class="workbench-check"><input type="checkbox" data-quick-option="${a}"${state.quick.includes(a) ? " checked" : ""}> ${escape(label)}</label>`).join("")}</div><h3>Thanh trạng thái</h3><div class="workbench-options">${[["book", "Vị trí trong toàn sách"], ["chapter", "Tiến độ chương"], ["time", "Thời gian còn lại trong chương"], ["hidden", "Ẩn thanh trạng thái"]].map(([key, label]) => `<label class="workbench-check"><input type="checkbox" data-footer-option="${key}"${state.footer[key] ? " checked" : ""}> ${label}</label>`).join("")}</div>`;
      panel.querySelectorAll("[data-quick-option]").forEach((b) => b.onchange = () => { state.quick = [...panel.querySelectorAll("[data-quick-option]:checked")].map((e) => e.dataset.quickOption).slice(0, 8); persist(); renderQuick(); renderOptions(); });
      panel.querySelectorAll("[data-footer-option]").forEach((b) => b.onchange = () => { state.footer[b.dataset.footerOption] = b.checked; persist(); updateStatus(); });
    }
    function renderQuick() {
      quickActions.innerHTML = state.quick.map((a) => `<button type="button" class="btn-secondary" data-quick-action="${a}">${escape(ACTIONS[a])}</button>`).join("") + '<button type="button" class="btn-secondary" data-quick-action="options">Tùy chỉnh</button>';
    }
    function act(action) {
      if (action === "bookmark") options.bookmark();
      else if (action === "marks") options.openMarks();
      else if (action === "settings") { close(); options.openSettings(); }
      else open(action);
      quickActions.hidden = true; $("#reader-quick-toggle").setAttribute("aria-expanded", "false");
    }
    $("#reader-quick-toggle").onclick = (ev) => { quickActions.hidden = !quickActions.hidden; ev.currentTarget.setAttribute("aria-expanded", String(!quickActions.hidden)); };
    document.addEventListener("click", (ev) => {
      const action = ev.target.closest("[data-workbench]")?.dataset.workbench || ev.target.closest("[data-quick-action]")?.dataset.quickAction;
      if (action) act(action);
      if (ev.target.closest("[data-workbench-selection]")) { $("#reader-selection-tools").hidden = true; open("words"); }
      if (!ev.target.closest("#reader-quick-menu")) { quickActions.hidden = true; $("#reader-quick-toggle").setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("click", (ev) => {
      const node = ev.target.closest(".word-wise-term"); if (!node) return;
      const term = state.glossary.find((t) => t.id === node.dataset.term); if (!term) return;
      ev.preventDefault(); ev.stopPropagation(); selection = { ...term, ...selectedTermSource(node, term) }; open("words");
    }, { capture: true });
    function selectedTermSource(node, term) { const p = node.closest("p[data-p]"), frame = node.closest(".reader-frame"); return { term: term.term, sentence: p?.textContent.slice(0, 1200) || "", p: Number(p?.dataset.p || 0), volIdx: Number(frame?.dataset.vol || 0), chapIdx: Number(frame?.dataset.chap || 0) }; }
    document.addEventListener("keydown", (ev) => { if (ev.target.matches?.(".word-wise-term") && ["Enter", " "].includes(ev.key)) { ev.preventDefault(); ev.target.click(); } });
    function updateStatus() {
      if (options.surfaces.isLocked()) return;
      const reader = ctx().view === "reader"; quick.hidden = !reader; footer.hidden = !reader || state.footer.hidden;
      if (!reader) return;
      const items = entries(), index = currentIndex(items), entry = items[index], percent = clamp(ctx().percent, 0, 100);
      // The desktop sidebar shows the whole-book position in place of the status bar.
      const sidebarBook = $("#reader-book-progress");
      if (sidebarBook) sidebarBook.textContent = `${Math.round(bookPosition(items, index, percent / 100) * 100)}%`;
      if (state.footer.hidden) return;
      const parts = [];
      if (state.footer.book) parts.push(`Sách ${Math.round(bookPosition(items, index, percent / 100) * 100)}%`);
      if (state.footer.chapter) parts.push(`Chương ${Math.round(percent)}%`);
      if (state.footer.time && entry?.chapter.words) parts.push(`Còn ~${Math.ceil(entry.chapter.words * (1 - percent / 100) / 280)} phút`);
      const text = parts.join(" · "); if (footer.textContent !== text) footer.textContent = text; footer.hidden ||= !parts.length;
    }
    let frame = 0;
    window.addEventListener("scroll", () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateStatus(); }); }, { passive: true });
    window.addEventListener("resize", updateStatus);
    renderQuick(); updateStatus();
    return { open, openHome, decorateSection, isOpen: () => dialog.open, updateStatus, onView() { generation++; selection = null; if (dialog.open) close(); quickActions.hidden = true; $("#reader-quick-toggle").setAttribute("aria-expanded", "false"); updateStatus(); } };
  }
  return { create, normalizeState, profileSettings, bookPosition, positionTarget, termMatches };
});
