(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReaderFeatures = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "tenshi-reader-tools-v1";
  const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const regexEscape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const identity = (volume, chapter) => `${volume.dirName}\u001f${chapter.title.normalize("NFC")}`;

  function chapterEntries(series) {
    return (series?.volumesData || []).flatMap((volume, volIdx) => volume.chapters.map((chapter, chapIdx) => ({
      id: identity(volume, chapter), volume, chapter, volIdx, chapIdx
    })));
  }

  function newChapters(series, known) {
    if (!Array.isArray(known)) return [];
    const seen = new Set(known);
    return chapterEntries(series).filter((item) => !item.chapter.isIllustration && !seen.has(item.id));
  }

  function namePattern(names) {
    const terms = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
    return terms.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${terms.map(regexEscape).join("|")})(?![\\p{L}\\p{N}_])`, "giu") : null;
  }

  // Keep a map to the original text so speech word highlighting remains aligned
  // when a pronunciation has a different length from a character's name.
  function applyPronunciation(text, rules) {
    const valid = rules.filter((rule) => rule.name?.trim() && rule.say?.trim());
    const pattern = namePattern(valid.map((rule) => rule.name.trim()));
    if (!pattern) return { text, map: Array.from({ length: text.length + 1 }, (_, i) => i) };
    let spoken = "", cursor = 0;
    const map = [];
    const appendOriginal = (end) => {
      for (; cursor < end; cursor += 1) { spoken += text[cursor]; map.push(cursor); }
    };
    for (const hit of text.matchAll(pattern)) {
      appendOriginal(hit.index);
      const rule = valid.find((item) => item.name.trim().toLocaleLowerCase() === hit[0].toLocaleLowerCase());
      const replacement = rule.say.trim();
      spoken += replacement;
      for (let i = 0; i < replacement.length; i += 1) map.push(hit.index + Math.floor(i * hit[0].length / replacement.length));
      cursor = hit.index + hit[0].length;
    }
    appendOriginal(text.length);
    map.push(text.length);
    return { text: spoken, map };
  }

  function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function goalProgress(goal) {
    if (!goal) return { value: 0, target: 0, reached: false };
    const value = goal.kind === "chapters" ? new Set(goal.chapters || []).size : (goal.seconds || 0) / 60;
    return { value, target: goal.target, reached: value >= goal.target };
  }

  function unlockedCharacters(characters, entries, reached) {
    const highest = entries.reduce((max, entry, index) => reached.includes(entry.id) ? Math.max(max, index) : max, -1);
    return characters.filter((character) => {
      const index = entries.findIndex((entry) => entry.id === character.gate);
      return index >= 0 && index <= highest;
    });
  }

  function mergeCharacterCatalog(saved, defaults, { slug, deleted = [], legacyMigration = false } = {}) {
    const remaining = Array.isArray(saved) ? saved.map((character) => ({ ...character })) : [];
    const removed = new Set(deleted), characters = [];
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const definition of defaults) {
      if (removed.has(definition.key)) continue;
      const index = remaining.findIndex((character) => character.catalogId === definition.key || (!character.catalogId && (
        character.name === definition.name || character.name === definition.legacy?.name ||
        (definition.legacy && character.note === definition.legacy.note && equal(character.aliases, definition.legacy.aliases))
      )));
      const previous = index >= 0 ? remaining.splice(index, 1)[0] : null;
      // The old version always installed its five seeds. A missing legacy seed
      // was removed by the reader; don't bring it back during this upgrade.
      if (!previous && legacyMigration && definition.legacy) { removed.add(definition.key); continue; }
      const snapshot = Object.fromEntries(["name", "aliases", "note", "gate"].map((key) => [key, definition[key]]));
      const baseline = previous?.catalogSnapshot || definition.legacy;
      const character = { ...previous, id: previous?.id || `builtin-${slug}-${definition.key}`, catalogId: definition.key, catalogSnapshot: snapshot };
      for (const key of Object.keys(snapshot)) character[key] = !previous || (baseline && equal(previous[key], baseline[key])) ? snapshot[key] : previous[key];
      characters.push(character);
    }
    return { characters: [...characters, ...remaining], deleted: [...removed] };
  }

  function wrapLines(context, text, width) {
    const lines = [];
    for (const paragraph of text.split(/\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && context.measureText(`${line} ${word}`).width > width) { lines.push(line); line = ""; }
        if (context.measureText(word).width > width) {
          if (line) { lines.push(line); line = ""; }
          for (const char of word) {
            if (line && context.measureText(line + char).width > width) { lines.push(line); line = ""; }
            line += char;
          }
        } else line += `${line ? " " : ""}${word}`;
      }
      lines.push(line);
    }
    return lines;
  }

  function create(options) {
    const $ = (selector) => document.querySelector(selector);
    const message = (text) => {
      const feedback = $("#tools-feedback");
      if (($("#reader-tools-dialog")?.open || $("#workbench-dialog")?.open) && feedback) { feedback.textContent = text; feedback.hidden = false; }
      else options.message(text);
    };
    const read = () => {
      try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY)); return value?.version === 1 ? value : {}; }
      catch (_) { return {}; }
    };
    const loaded = read();
    const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const state = {
      version: 1, catalog: object(loaded.catalog), reached: object(loaded.reached),
      characters: object(loaded.characters), pronunciation: object(loaded.pronunciation),
      characterCatalog: object(loaded.characterCatalog), deletedCharacters: object(loaded.deletedCharacters),
      days: object(loaded.days), quotes: Array.isArray(loaded.quotes) ? loaded.quotes.slice(0, 50) : [],
      goal: loaded.goal && ["minutes", "chapters"].includes(loaded.goal.kind) && Number.isFinite(loaded.goal.target) && loaded.goal.target > 0 ? loaded.goal : null,
      conceal: loaded.conceal === true
    };
    if (state.goal) {
      state.goal.seconds = Number.isFinite(state.goal.seconds) ? Math.max(0, state.goal.seconds) : 0;
      state.goal.chapters = Array.isArray(state.goal.chapters) ? state.goal.chapters.filter((id) => typeof id === "string") : [];
      state.goal.target = Math.min(state.goal.kind === "chapters" ? 50 : 240, state.goal.target);
    }
    for (const [key, day] of Object.entries(state.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day || typeof day !== "object") { delete state.days[key]; continue; }
      day.read = Number.isFinite(day.read) ? Math.max(0, day.read) : 0;
      day.listen = Number.isFinite(day.listen) ? Math.max(0, day.listen) : 0;
      day.completed = Array.isArray(day.completed) ? day.completed : [];
      day.series = object(day.series);
    }
    const seriesList = options.series;
    let storageWarning = false, activeTab = "characters", selectedQuote = null, quoteDraft = null;
    let showAllCharacters = false, characterSearch = "", characterSearchSeries = null;
    let lastActivity = Date.now(), lastTick = Date.now(), dialogOpener = null, savedSelection = "";
    const uid = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const persist = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch (_) { if (!storageWarning) { storageWarning = true; message("Trình duyệt không lưu được tiện ích đọc. Kiểm tra dung lượng hoặc quyền lưu dữ liệu."); } }
    };
    const context = () => options.context();
    const currentSeries = () => context().series;
    const entries = () => chapterEntries(currentSeries());
    const currentEntry = () => entries().find((entry) => entry.volIdx === context().volIdx && entry.chapIdx === context().chapIdx);
    const characters = () => state.characters[currentSeries().slug] || [];
    const visibleCharacters = () => unlockedCharacters(characters(), entries(), state.reached[currentSeries().slug] || []);
    const pronunciationRules = () => state.pronunciation[currentSeries().slug] || [];
    const duration = (seconds) => seconds < 3600 ? `${Math.floor(seconds / 60)} phút` : `${Math.floor(seconds / 3600)} giờ ${Math.floor(seconds % 3600 / 60)} phút`;

    function syncSeries(series, shouldPersist = true) {
      if (!series || !Array.isArray(series.volumesData)) return;
      const all = chapterEntries(series);
      if (!Array.isArray(state.catalog[series.slug])) state.catalog[series.slug] = all.map((entry) => entry.id);
      if (!Array.isArray(state.reached[series.slug])) state.reached[series.slug] = [];
      const old = options.legacyState(series);
      const progressIndex = all.findIndex((item) => item.volIdx === old.progress?.volIdx && item.chapIdx === old.progress?.chapIdx);
      all.forEach((entry, i) => {
        if ((i <= progressIndex || old.chapters?.[`${entry.volIdx}:${entry.chapIdx}`]?.done) && !state.reached[series.slug].includes(entry.id)) state.reached[series.slug].push(entry.id);
      });
      if (shouldPersist) persist();
    }

    for (const series of seriesList) {
      if (!Array.isArray(state.reached[series.slug])) state.reached[series.slug] = [];
      if (Array.isArray(series.volumesData)) syncSeries(series, false);
      const defaults = options.characterCatalog?.series[series.slug] || [];
      const merged = mergeCharacterCatalog(state.characters[series.slug], defaults, {
        slug: series.slug,
        deleted: Array.isArray(state.deletedCharacters[series.slug]) ? state.deletedCharacters[series.slug] : [],
        legacyMigration: Array.isArray(state.characters[series.slug]) && !state.characterCatalog[series.slug]
      });
      state.characters[series.slug] = merged.characters;
      state.deletedCharacters[series.slug] = merged.deleted;
      state.characterCatalog[series.slug] = options.characterCatalog?.revision || 1;
      if (!Array.isArray(state.pronunciation[series.slug])) state.pronunciation[series.slug] = [];
    }
    persist();

    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="reader-tools-dialog" class="tools-dialog" aria-labelledby="tools-title">
        <div class="tools-heading"><div><p class="eyebrow" id="tools-series"></p><h2 id="tools-title">Tiện ích đọc</h2></div><button class="tools-close" type="button" aria-label="Đóng tiện ích">×</button></div>
        <div class="tools-tabs" role="tablist" aria-label="Tiện ích đọc">
          ${[["characters", "Nhân vật"], ["stats", "Thống kê"], ["pronunciation", "Phát âm"], ["quotes", "Trích dẫn"], ["goal", "Mục tiêu"]].map(([id, label]) => `<button type="button" id="tools-tab-${id}" role="tab" data-tools-tab="${id}" aria-controls="tools-panel">${label}</button>`).join("")}
          <button type="button" data-library-action="marks">Đánh dấu & Ghi chú</button><button type="button" data-library-action="layout">Vùng đọc</button><button type="button" data-library-action="toc">Mục lục EPUB</button><button type="button" data-hand-camera hidden>Điều khiển bằng tay <span class="beta-badge">Beta</span></button>
        </div>
        <p id="tools-feedback" class="tools-feedback" role="status" hidden></p>
        <div id="tools-panel" class="tools-panel" role="tabpanel"></div>
      </dialog>
      <div id="reader-selection-tools" class="selection-tools" role="toolbar" aria-label="Đoạn đã chọn" hidden><button type="button" data-library-action="highlight" title="Tô màu hoặc ghi chú đoạn này"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 11-6 6v3h3l6-6"/><path d="m14 6 4 4"/><path d="M9.5 10.5 16 4l4 4-6.5 6.5z"/></svg><span>Tô màu</span></button><button type="button" data-selection-action="quote" title="Tạo ảnh trích dẫn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3"/><path d="M20 7h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3"/></svg><span>Trích dẫn</span></button><button type="button" data-selection-action="character" title="Thêm làm nhân vật"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>Nhân vật</span></button><span id="selection-summary" class="selection-note" hidden>Lấy 600 ký tự đầu</span></div>
    `);
    const dialog = $("#reader-tools-dialog"), panel = $("#tools-panel"), selectionTools = $("#reader-selection-tools");
    let embeddedHost = null;
    const isOpen = () => embeddedHost ? embeddedHost.isOpen() : dialog.open;

    function open(tab = "characters", characterId) {
      if (embeddedHost) { embeddedHost.open(tab, characterId); return; }
      renderEmbedded(tab, characterId);
      if (!dialog.open) { dialogOpener = document.activeElement; dialog.showModal(); }
    }
    function renderEmbedded(tab, characterId) {
      activeTab = tab;
      if (characterId) characterSearch = "";
      if (tab === "quotes" && selectedQuote) { quoteDraft = { ...selectedQuote, theme: context().theme }; selectedQuote = null; }
      $("#tools-series").textContent = currentSeries().titleVi;
      renderPanel();
      selectionTools.hidden = true;
      if (characterId) panel.querySelector(`[data-character-card="${characterId}"]`)?.scrollIntoView({ block: "nearest" });
    }

    function close() { if (embeddedHost) embeddedHost.close(); else dialog.close(); }
    dialog.querySelector(".tools-close").addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    dialog.addEventListener("close", () => { lastActivity = Date.now(); dialogOpener?.focus({ preventScroll: true }); });
    dialog.querySelector(".tools-tabs").addEventListener("click", (event) => { const tab = event.target.closest("[data-tools-tab]"); if (tab) { activeTab = tab.dataset.toolsTab; renderPanel(); } });
    dialog.querySelector(".tools-tabs").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...dialog.querySelectorAll("[data-tools-tab]")];
      const index = tabs.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      activeTab = tabs[next].dataset.toolsTab; renderPanel(); tabs[next].focus();
    });

    function renderPanel() {
      $("#tools-feedback").hidden = true;
      dialog.querySelectorAll("[data-tools-tab]").forEach((tab) => { const active = tab.dataset.toolsTab === activeTab; tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1; });
      panel.setAttribute("aria-labelledby", `tools-tab-${activeTab}`);
      if (activeTab === "characters") renderCharacters();
      if (activeTab === "stats") renderStats();
      if (activeTab === "pronunciation") renderPronunciation();
      if (activeTab === "quotes") renderQuotes();
      if (activeTab === "goal") renderGoal();
    }

    function chapterOptions(selected) {
      return entries().filter((entry) => !entry.chapter.isIllustration).map((entry) => `<option value="${escape(entry.id)}"${entry.id === selected ? " selected" : ""}>${escape(entry.volume.name)} · ${escape(entry.chapter.title)}</option>`).join("");
    }

    function renderCharacters(editId) {
      if (characterSearchSeries !== currentSeries().slug) { characterSearchSeries = currentSeries().slug; characterSearch = ""; }
      const unlocked = visibleCharacters(), visible = showAllCharacters ? characters() : unlocked;
      const editing = characters().find((character) => character.id === editId);
      panel.innerHTML = `<div class="character-controls">
          <div class="character-overview"><p class="character-count">Đã mở <strong>${unlocked.length}/${characters().length}</strong> nhân vật</p><details class="character-guide"><summary>Hướng dẫn</summary><p class="tools-hint">Bấm tên được gạch chân trong truyện để xem ghi chú. Mặc định chỉ hiện nhân vật khi đã đọc tới chương tương ứng.</p></details></div>
          <label class="character-search"><span class="character-search-label">Tìm nhân vật</span><input id="character-search" type="search" value="${escape(characterSearch)}" placeholder="Tìm tên, tên khác hoặc ghi chú…" autocomplete="off"></label>
          <label class="character-show-all"><span><span class="character-switch-title">Hiện toàn bộ nhân vật</span><small id="character-spoiler-note">Có thể lộ tình tiết chưa đọc</small></span><input id="character-show-all" type="checkbox" aria-describedby="character-spoiler-note"${showAllCharacters ? " checked" : ""}></label>
        </div>
        <p id="character-search-empty" class="tools-empty" role="status" hidden>Không tìm thấy nhân vật phù hợp.</p>
        <div class="character-list">${visible.length ? visible.map((character) => `<article class="tool-card" data-character-card="${character.id}"><div class="tool-card-heading"><h3>${escape(character.name)}</h3><button type="button" class="btn-secondary tool-action" data-edit-character="${character.id}" aria-label="Sửa ghi chú ${escape(character.name)}">Sửa</button></div><p>${escape(character.note)}</p>${character.aliases.length ? `<p class="tools-hint">Tên khác: ${escape(character.aliases.join(", "))}</p>` : ""}</article>`).join("") : '<p class="tools-empty">Mở chương đầu để xem các nhân vật. Bạn cũng có thể thêm ghi chú riêng.</p>'}</div>
        <details class="tools-editor"${editing ? " open" : ""}><summary>${editing ? "Sửa ghi chú nhân vật" : "Thêm nhân vật"}</summary>
          <form id="character-form"><input type="hidden" name="id" value="${escape(editing?.id || "")}">
            <label>Tên nhân vật<input name="name" required maxlength="80" value="${escape(editing?.name || "")}"></label>
            <label>Tên khác, cách nhau bằng dấu phẩy<input name="aliases" maxlength="240" value="${escape(editing?.aliases.join(", ") || "")}" placeholder="Amane, Fujimiya"></label>
            <label>Ghi chú<textarea name="note" required maxlength="1200" rows="3">${escape(editing?.note || "")}</textarea></label>
            <label>Chỉ hiện khi đã đọc tới<select name="gate" aria-label="Chỉ hiện khi đã đọc tới">${chapterOptions(editing?.gate || currentEntry()?.id)}</select></label>
            <div class="tools-actions"><button class="btn-primary" type="submit">Lưu nhân vật</button>${editing ? `<button class="btn-secondary ui-danger" type="button" data-delete-character="${editing.id}">Xóa nhân vật</button>` : ""}</div>
          </form></details>`;
      panel.querySelectorAll("[data-edit-character]").forEach((button) => button.addEventListener("click", () => { renderCharacters(button.dataset.editCharacter); panel.querySelector(".tools-editor").scrollIntoView({ block: "nearest" }); panel.querySelector('[name="name"]').focus({ preventScroll: true }); }));
      panel.querySelector("#character-show-all").addEventListener("change", (event) => { showAllCharacters = event.target.checked; renderCharacters(); panel.querySelector("#character-show-all").focus(); });
      const filterCharacters = () => {
        const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase();
        const query = fold(characterSearch.trim());
        const cards = [...panel.querySelectorAll("[data-character-card]")];
        cards.forEach((card) => { card.hidden = !fold(card.textContent).includes(query); });
        panel.querySelector("#character-search-empty").hidden = !query || cards.some((card) => !card.hidden);
      };
      panel.querySelector("#character-search").addEventListener("input", (event) => { characterSearch = event.target.value; filterCharacters(); });
      filterCharacters();
      panel.querySelector("[data-delete-character]")?.addEventListener("click", () => {
        if (editing.catalogId) state.deletedCharacters[currentSeries().slug].push(editing.catalogId);
        state.characters[currentSeries().slug] = characters().filter((character) => character.id !== editId);
        persist(); refreshDecorations(); renderCharacters();
      });
      panel.querySelector("#character-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(event.target), name = data.get("name").trim(), note = data.get("note").trim();
        if (!name || !note) return;
        const character = { ...characters().find((item) => item.id === data.get("id")), id: data.get("id") || uid(), name, note, aliases: [...new Set(data.get("aliases").split(",").map((alias) => alias.trim()).filter(Boolean))].slice(0, 12), gate: data.get("gate") };
        state.characters[currentSeries().slug] = [...characters().filter((item) => item.id !== character.id), character];
        persist(); refreshDecorations(); renderCharacters(); message("Đã lưu ghi chú nhân vật.");
      });
    }

    function decorateChapter(section) {
      section.querySelectorAll(".character-link").forEach((button) => button.replaceWith(document.createTextNode(button.textContent)));
      const available = visibleCharacters(), pattern = namePattern(available.flatMap((character) => [character.name, ...character.aliases]));
      if (!pattern) return;
      const seen = new Set();
      const walker = document.createTreeWalker(section.querySelector(".reader-content"), NodeFilter.SHOW_TEXT);
      const nodes = []; let node;
      while ((node = walker.nextNode())) if (node.parentElement.closest("p[data-p]") && !node.parentElement.closest("button")) nodes.push(node);
      for (const textNode of nodes) {
        const fragment = document.createDocumentFragment(); let cursor = 0, matched = false;
        for (const hit of textNode.data.matchAll(pattern)) {
          const character = available.find((item) => [item.name, ...item.aliases].some((alias) => alias.toLocaleLowerCase() === hit[0].toLocaleLowerCase()));
          if (seen.has(character.id)) continue;
          fragment.append(document.createTextNode(textNode.data.slice(cursor, hit.index)));
          const button = document.createElement("button"); button.type = "button"; button.className = "character-link"; button.dataset.characterId = character.id; button.textContent = hit[0]; button.setAttribute("aria-label", `Xem nhân vật ${character.name}`);
          fragment.append(button); cursor = hit.index + hit[0].length; seen.add(character.id); matched = true;
        }
        if (matched) { fragment.append(document.createTextNode(textNode.data.slice(cursor))); textNode.replaceWith(fragment); }
      }
    }
    function refreshDecorations() { document.querySelectorAll(".reader-frame").forEach(decorateChapter); document.dispatchEvent(new Event("reader-characters-changed")); }

    function renderPronunciation() {
      const rules = pronunciationRules();
      panel.innerHTML = `<p class="tools-hint">Đặt cách đọc tên riêng cho ${escape(currentSeries().titleVi)}. Áp dụng cho cả giọng của máy và Google Dịch.</p>
        <form id="pronunciation-form" class="tools-editor"><label>Tên trong truyện<input name="name" required maxlength="80" placeholder="Mahiru"></label><label>Đọc thành<input name="say" required maxlength="80" placeholder="Ma hi rư"></label><button class="btn-primary" type="submit">Lưu cách đọc</button></form>
        <div class="pronunciation-list">${rules.length ? rules.map((rule, index) => `<div class="tool-card tool-rule"><span><strong>${escape(rule.name)}</strong> → ${escape(rule.say)}</span><button type="button" class="btn-secondary tool-action ui-danger" data-delete-rule="${index}" aria-label="Xóa cách đọc ${escape(rule.name)}">Xóa</button></div>`).join("") : '<p class="tools-empty">Chưa có cách đọc riêng. Thử thêm một tên nghe chưa đúng.</p>'}</div>
        <label class="tools-preview-label">Thử chuyển tên<textarea id="pronunciation-test" rows="2" maxlength="600">${escape(rules.length ? `${rules[0].name} đang kể chuyện.` : "Mahiru và Amane đang trò chuyện.")}</textarea></label><p class="pronunciation-preview" id="pronunciation-preview"></p>`;
      const preview = () => { $("#pronunciation-preview").textContent = applyPronunciation($("#pronunciation-test").value, pronunciationRules()).text; };
      $("#pronunciation-test").addEventListener("input", preview); preview();
      $("#pronunciation-form").addEventListener("submit", (event) => {
        event.preventDefault(); const data = new FormData(event.target), name = data.get("name").trim(), say = data.get("say").trim(); if (!name || !say) return;
        state.pronunciation[currentSeries().slug] = [...rules.filter((rule) => rule.name.toLocaleLowerCase() !== name.toLocaleLowerCase()), { name, say }].slice(-100);
        persist(); options.pronunciationChanged(); renderPronunciation(); message("Đã lưu cách phát âm.");
      });
      panel.querySelectorAll("[data-delete-rule]").forEach((button) => button.addEventListener("click", () => { state.pronunciation[currentSeries().slug] = rules.filter((_, i) => i !== Number(button.dataset.deleteRule)); persist(); options.pronunciationChanged(); renderPronunciation(); }));
    }

    function renderStats() {
      const dates = Array.from({ length: 7 }, (_, i) => { const date = new Date(); date.setDate(date.getDate() - 6 + i); return date; });
      const week = dates.map((date) => ({ date, day: state.days[dayKey(date)] || {} }));
      const total = Object.values(state.days).reduce((sum, day) => sum + (day.read || 0) + (day.listen || 0), 0);
      const weekTotal = week.reduce((sum, { day }) => sum + (day.read || 0) + (day.listen || 0), 0);
      const max = Math.max(60, ...week.map(({ day }) => (day.read || 0) + (day.listen || 0)));
      const completed = seriesList.reduce((sum, series) => sum + options.completed(series), 0);
      panel.innerHTML = `<p class="tools-hint">Hoạt động trên trình duyệt này. Dừng đếm khi chuyển tab, mở tiện ích hoặc không tương tác quá 2 phút.</p>
        <div class="tools-stat-grid"><div><strong>${duration(weekTotal)}</strong><span>7 ngày gần đây</span></div><div><strong>${completed}</strong><span>Chương đã hoàn thành</span></div><div><strong>${duration(total)}</strong><span>Tổng thời gian đã ghi</span></div></div>
        <h3 class="tools-subtitle">Tuần đọc của bạn</h3><div class="reading-chart" role="img" aria-label="Thời gian đọc và nghe trong 7 ngày: ${escape(week.map(({ date, day }) => `${date.getDate()}/${date.getMonth() + 1}: ${duration((day.read || 0) + (day.listen || 0))}`).join("; "))}">${week.map(({ date, day }) => `<div class="reading-day"><span>${Math.floor(((day.read || 0) + (day.listen || 0)) / 60)}′</span><div class="reading-bar"><i style="height:${(day.read || 0) / max * 100}%"></i><b style="height:${(day.listen || 0) / max * 100}%"></b></div><small>${date.getDate()}/${date.getMonth() + 1}</small></div>`).join("")}</div>
        <p class="chart-legend"><span>● Đọc</span><span>● Nghe</span></p>
        <h3 class="tools-subtitle">Theo bộ truyện · 7 ngày</h3>${seriesList.map((series) => { const seconds = week.reduce((sum, { day }) => sum + (day.series?.[series.slug] || 0), 0); return `<div class="tool-card tool-rule"><span>${escape(series.titleVi)}</span><strong>${duration(seconds)}</strong></div>`; }).join("")}`;
    }

    function renderGoal() {
      const goal = state.goal, progress = goalProgress(goal);
      panel.innerHTML = `<p class="tools-hint">Mục tiêu cho phiên đọc/nghe, dùng chung khi chuyển bộ truyện. Khi đạt mục tiêu, lời nhắc sẽ xuất hiện ở cuối chương.</p>
        ${goal ? `<div class="goal-summary"><strong>${goal.notified ? "Đã hoàn thành phiên đọc" : progress.reached ? "Đã đạt mục tiêu · nhắc ở cuối chương" : "Phiên đọc đang diễn ra"}</strong><p>${goal.kind === "chapters" ? `${Math.min(progress.value, progress.target)}/${progress.target} chương` : `${duration(goal.seconds || 0)}/${goal.target} phút`}</p><progress value="${Math.min(progress.value, progress.target)}" max="${progress.target}"></progress><button type="button" class="btn-secondary tool-action" id="goal-stop">Kết thúc phiên</button></div>` : ""}
        <form id="goal-form" class="tools-editor"><label>Đặt mục tiêu<select name="kind" id="goal-kind"><option value="minutes">Thời gian đọc / nghe</option><option value="chapters">Số chương</option></select></label><label id="goal-target-label">Số phút<input name="target" id="goal-target" type="number" min="1" max="240" value="15" required></label><button class="btn-primary" type="submit">${goal ? "Bắt đầu phiên mới" : "Bắt đầu phiên đọc"}</button></form>`;
      $("#goal-kind").addEventListener("change", (event) => { const chapters = event.target.value === "chapters"; $("#goal-target-label").firstChild.textContent = chapters ? "Số chương" : "Số phút"; $("#goal-target").max = chapters ? "50" : "240"; $("#goal-target").value = chapters ? "2" : "15"; });
      $("#goal-form").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.target); state.goal = { kind: data.get("kind"), target: Number(data.get("target")), seconds: 0, chapters: [], startedAt: Date.now(), notified: false }; lastActivity = Date.now(); persist(); renderGoal(); updateGoalButtons(); message("Đã bắt đầu phiên đọc. Lời nhắc sẽ hiện ở cuối chương."); });
      $("#goal-stop")?.addEventListener("click", () => { state.goal = null; persist(); renderGoal(); updateGoalButtons(); });
    }

    function quoteContext(text, article) {
      const entry = entries().find((item) => item.volIdx === Number(article.dataset.vol) && item.chapIdx === Number(article.dataset.chap));
      return { id: uid(), text, slug: currentSeries().slug, title: entry.volume.title || currentSeries().titleVi, author: currentSeries().author, source: `${entry.volume.name} · ${entry.chapter.title}`, theme: context().theme };
    }

    function readSelection() {
      const selection = window.getSelection(), text = selection?.toString().trim();
      if (!text || context().view !== "reader" || isOpen() || context().blocked) { selectionTools.hidden = true; return; }
      const start = selection.anchorNode?.parentElement?.closest(".reader-frame");
      const end = selection.focusNode?.parentElement?.closest(".reader-frame");
      if (!start || start !== end || !selection.anchorNode.parentElement.closest(".reader-content") || !selection.focusNode.parentElement.closest(".reader-content")) { selectionTools.hidden = true; return; }
      selectedQuote = quoteContext(text.slice(0, 600), start); savedSelection = text;
      $("#selection-summary").hidden = text.length <= 600;
      selectionTools.hidden = false;
      placeSelectionTools();
    }

    // With a mouse the bar floats just above the selection (below it when
    // there is no room). On touch screens the system's own copy menu sits
    // there, so the bar stays docked at the bottom (see CSS).
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    function placeSelectionTools() {
      const floating = finePointer.matches;
      selectionTools.classList.toggle("is-floating", floating);
      if (!floating) { selectionTools.style.left = selectionTools.style.top = ""; return; }
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const rects = [...selection.getRangeAt(0).getClientRects()].filter((rect) => rect.width > 0);
      if (!rects.length) return;
      const first = rects[0], last = rects[rects.length - 1];
      const bar = selectionTools.getBoundingClientRect(), gap = 10, edge = 12;
      const above = first.top - bar.height - gap >= (document.querySelector("#header")?.getBoundingClientRect().bottom || 0) + edge;
      const anchor = above ? first : last;
      const centre = anchor.left + anchor.width / 2;
      const left = Math.min(Math.max(centre - bar.width / 2, edge), window.innerWidth - bar.width - edge);
      selectionTools.style.left = `${Math.round(left)}px`;
      selectionTools.style.top = `${Math.round(above ? first.top - bar.height - gap : last.bottom + gap)}px`;
      selectionTools.style.setProperty("--arrow-x", `${Math.round(centre - left)}px`);
      selectionTools.classList.toggle("is-below", !above);
    }
    window.addEventListener("scroll", () => { if (!selectionTools.hidden) placeSelectionTools(); }, { passive: true });
    window.addEventListener("resize", () => { if (!selectionTools.hidden) placeSelectionTools(); });
    document.addEventListener("selectionchange", readSelection);
    selectionTools.addEventListener("mousedown", (event) => event.preventDefault());
    selectionTools.addEventListener("click", (event) => {
      const action = event.target.closest("[data-selection-action]")?.dataset.selectionAction;
      if (action === "quote") open("quotes");
      if (action === "character") {
        if (savedSelection.length > 80) { message("Chọn tên nhân vật ngắn hơn 80 ký tự để thêm ghi chú."); return; }
        open("characters"); panel.querySelector(".tools-editor").open = true; panel.querySelector('[name="name"]').value = savedSelection; panel.querySelector('[name="name"]').focus();
      }
    });

    function makeQuoteImage(draft) {
      const palette = draft.theme === "dark" ? ["#101311", "#eeeee4", "#99a997"] : draft.theme === "light" ? ["#f6f7f2", "#202d25", "#607861"] : ["#eee6d7", "#332d23", "#8b7655"];
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      canvas.width = 1080;
      ctx.font = '38px "Literata", "Times New Roman", serif';
      const text = wrapLines(ctx, draft.text.trim().normalize("NFC"), 880);
      ctx.font = 'bold 25px system-ui, sans-serif';
      const title = wrapLines(ctx, draft.title, 880);
      ctx.font = '22px system-ui, sans-serif';
      const source = wrapLines(ctx, draft.source, 880);
      canvas.height = Math.max(720, 420 + text.length * 58 + title.length * 36 + source.length * 30);
      ctx.fillStyle = palette[0]; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = palette[2]; ctx.lineWidth = 2; ctx.strokeRect(42, 42, 996, canvas.height - 84);
      ctx.fillStyle = palette[2]; ctx.font = '110px Georgia, serif'; ctx.fillText('“', 96, 170);
      ctx.fillStyle = palette[1]; ctx.font = '38px "Literata", "Times New Roman", serif';
      let y = 214; text.forEach((line) => { ctx.fillText(line, 100, y); y += 58; });
      y = Math.max(y + 50, canvas.height - 125 - title.length * 36 - source.length * 30);
      ctx.fillStyle = palette[2]; ctx.fillRect(100, y - 24, 72, 2);
      ctx.fillStyle = palette[1]; ctx.font = 'bold 25px system-ui, sans-serif'; title.forEach((line) => { ctx.fillText(line, 100, y + 16); y += 36; });
      ctx.fillStyle = palette[2]; ctx.font = '22px system-ui, sans-serif'; source.forEach((line) => { ctx.fillText(line, 100, y + 18); y += 30; });
      ctx.font = '18px system-ui, sans-serif'; ctx.fillText(`${draft.author} · Kệ truyện`, 100, canvas.height - 70);
      return canvas;
    }

    function renderQuotes() {
      const entry = currentEntry();
      if (!quoteDraft && context().view === "reader" && entry && !entry.chapter.isIllustration) quoteDraft = quoteContext("", document.querySelector(`.reader-frame[data-vol="${entry.volIdx}"][data-chap="${entry.chapIdx}"]`));
      const draft = quoteDraft;
      panel.innerHTML = `<p class="tools-hint">Bôi đen câu trong chương rồi chọn “Tạo trích dẫn”, hoặc chọn một đoạn bên dưới. Ảnh có tên truyện và chương, lưu được dưới dạng PNG.</p>
        ${draft ? `<div class="quote-editor">${context().view === "reader" && entry && !entry.chapter.isIllustration ? `<label>Chọn đoạn trong chương<select id="quote-paragraph"><option value="">Chọn một đoạn…</option>${options.paragraphs(entry.volIdx, entry.chapIdx).filter((p) => !p.startsWith("---")).map((p, i) => `<option value="${i}">${escape(p.slice(0, 95))}${p.length > 95 ? "…" : ""}</option>`).join("")}</select></label>` : ""}<label>Đoạn trích · tối đa 600 ký tự<textarea id="quote-text" rows="5" maxlength="600">${escape(draft.text)}</textarea></label><p class="tools-hint">${escape(draft.title)} · ${escape(draft.source)}</p><label>Màu thẻ<select id="quote-theme">${[["sepia", "Giấy"], ["light", "Sáng"], ["dark", "Tối"]].map(([value, label]) => `<option value="${value}"${draft.theme === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><img id="quote-preview" class="quote-preview" alt="Xem trước thẻ trích dẫn" hidden><div class="tools-actions"><button id="quote-download" class="btn-primary" type="button">Tải ảnh PNG</button><button id="quote-save" class="btn-secondary" type="button">Lưu trích dẫn</button></div></div>` : '<p class="tools-empty">Mở một chương để chọn câu muốn lưu.</p>'}
        <h3 class="tools-subtitle">Trích dẫn đã lưu</h3><div class="saved-quotes">${state.quotes.length ? state.quotes.map((quote) => `<article class="tool-card"><blockquote>${escape(quote.text)}</blockquote><p class="tools-hint">${escape(quote.title)} · ${escape(quote.source)}</p><div class="tools-actions"><button class="btn-secondary tool-action" type="button" data-open-quote="${quote.id}">Tạo lại ảnh</button><button class="btn-secondary tool-action ui-danger" type="button" data-delete-quote="${quote.id}">Xóa</button></div></article>`).join("") : '<p class="tools-empty">Những câu yêu thích của bạn sẽ ở đây.</p>'}</div>`;
      if (draft) {
        let canvas = null;
        const preview = () => {
          draft.text = $("#quote-text").value.slice(0, 600); draft.theme = $("#quote-theme").value;
          const empty = !draft.text.trim(); $("#quote-preview").hidden = empty; $("#quote-download").disabled = empty; $("#quote-save").disabled = empty;
          if (!empty) { canvas = makeQuoteImage(draft); $("#quote-preview").src = canvas.toDataURL("image/png"); }
        };
        $("#quote-text").addEventListener("input", preview); $("#quote-theme").addEventListener("change", preview);
        $("#quote-paragraph")?.addEventListener("change", (event) => { if (event.target.value === "") return; const text = options.paragraphs(entry.volIdx, entry.chapIdx).filter((p) => !p.startsWith("---"))[Number(event.target.value)]; quoteDraft = { ...quoteContext(text.slice(0, 600), document.querySelector(`.reader-frame[data-vol="${entry.volIdx}"][data-chap="${entry.chapIdx}"]`)), theme: draft.theme }; renderQuotes(); });
        $("#quote-download").addEventListener("click", () => { if (!canvas) return; const link = document.createElement("a"); link.download = `trich-dan-${draft.slug}-${dayKey()}.png`; link.href = canvas.toDataURL("image/png"); link.click(); });
        $("#quote-save").addEventListener("click", () => { state.quotes = [{ ...draft }, ...state.quotes.filter((quote) => quote.id !== draft.id)].slice(0, 50); persist(); renderQuotes(); message("Đã lưu trích dẫn."); });
        preview();
        document.fonts?.ready.then(() => { if (isOpen() && activeTab === "quotes" && quoteDraft === draft) preview(); });
      }
      panel.querySelectorAll("[data-open-quote]").forEach((button) => button.addEventListener("click", () => { quoteDraft = { ...state.quotes.find((quote) => quote.id === button.dataset.openQuote) }; renderQuotes(); panel.scrollTop = 0; }));
      panel.querySelectorAll("[data-delete-quote]").forEach((button) => button.addEventListener("click", () => { state.quotes = state.quotes.filter((quote) => quote.id !== button.dataset.deleteQuote); persist(); renderQuotes(); }));
    }

    function updates(series) { return newChapters(series, state.catalog[series.slug]); }
    function renderUpdateNotice() {
      const notice = $("#series-updates"), fresh = updates(currentSeries());
      notice.hidden = !fresh.length;
      if (fresh.length) { $("#series-updates-text").textContent = `Có ${fresh.length} chương mới kể từ lần mở trước`; notice.querySelector("button").onclick = () => options.openChapter(fresh[0].volIdx, fresh[0].chapIdx); }
    }
    function openedChapter(volIdx, chapIdx) {
      const series = currentSeries(), entry = chapterEntries(series).find((item) => item.volIdx === volIdx && item.chapIdx === chapIdx);
      if (!entry) return;
      let changed = false;
      for (const bucket of [state.reached, state.catalog]) if (!bucket[series.slug].includes(entry.id)) { bucket[series.slug].push(entry.id); changed = true; }
      if (changed) { persist(); refreshDecorations(); }
      renderUpdateNotice(); updateGoalButtons();
    }
    function completeChapter(volIdx, chapIdx) {
      const entry = entries().find((item) => item.volIdx === volIdx && item.chapIdx === chapIdx);
      if (!entry || entry.chapter.isIllustration) return;
      const id = `${currentSeries().slug}\u001f${entry.id}`;
      const day = state.days[dayKey()] ||= { read: 0, listen: 0, completed: [], series: {} };
      let changed = false;
      if (!day.completed.includes(id)) { day.completed.push(id); changed = true; }
      if (state.goal && !state.goal.notified) { if (!state.goal.chapters.includes(id)) { state.goal.chapters.push(id); changed = true; } notifyGoal(); }
      if (changed) persist();
      updateGoalButtons();
    }
    function notifyGoal() {
      if (!state.goal || state.goal.notified || !goalProgress(state.goal).reached) return;
      state.goal.notified = true; persist();
      message(`Đã đạt mục tiêu ${state.goal.target} ${state.goal.kind === "chapters" ? "chương" : "phút"}. Bạn có thể nghỉ một chút.`);
    }
    function updateGoalButtons() {
      const goal = state.goal, progress = goalProgress(goal);
      document.querySelectorAll('[data-reader-feature="goal"]').forEach((button) => { button.textContent = !goal ? "Mục tiêu phiên đọc" : goal.notified ? "Đã đạt mục tiêu" : `${goal.kind === "chapters" ? `${Math.min(progress.value, progress.target)}/${progress.target} chương` : `${Math.floor(goal.seconds / 60)}/${goal.target} phút`}${progress.reached ? " · đã đạt" : ""}`; });
    }

    function tick() {
      const now = Date.now(), delta = Math.max(0, Math.min(10, (now - lastTick) / 1000)); lastTick = now;
      const ctx = context();
      if (ctx.view !== "reader" || document.visibilityState !== "visible" || !document.hasFocus() || dialog.open || ctx.blocked || (!ctx.listening && now - lastActivity > 120000)) return;
      const day = state.days[dayKey()] ||= { read: 0, listen: 0, completed: [], series: {} };
      day[ctx.listening ? "listen" : "read"] += delta; day.series[ctx.series.slug] = (day.series[ctx.series.slug] || 0) + delta;
      if (state.goal && !state.goal.notified) { state.goal.seconds += delta; if (ctx.percent >= 97) notifyGoal(); }
      // Retain one year; private statistics never grow without a bound.
      Object.keys(state.days).sort().slice(0, -366).forEach((key) => delete state.days[key]);
      persist(); updateGoalButtons();
    }
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach((event) => document.addEventListener(event, () => { lastActivity = Date.now(); }, { passive: true }));
    document.addEventListener("visibilitychange", () => { lastTick = Date.now(); if (document.visibilityState === "visible") lastActivity = Date.now(); });
    window.setInterval(tick, 5000);

    function onView() {
      selectionTools.hidden = true; selectedQuote = null; quoteDraft = null; showAllCharacters = false; lastActivity = Date.now(); lastTick = Date.now();
      if (isOpen()) close();
      renderUpdateNotice(); updateGoalButtons();
    }
    function setConceal(value) { state.conceal = value; document.body.dataset.spoilers = value ? "hidden" : "visible"; document.querySelectorAll(".illustration-open").forEach((button) => { button.classList.remove("is-revealed"); button.setAttribute("aria-label", value ? "Hiện ảnh minh họa" : "Phóng to ảnh"); }); persist(); }
    setConceal(state.conceal);
    $("#spoiler-switch").querySelectorAll("button").forEach((button) => { button.setAttribute("aria-pressed", String((button.dataset.spoilerValue === "hide") === state.conceal)); button.addEventListener("click", () => { setConceal(button.dataset.spoilerValue === "hide"); $("#spoiler-switch").querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button))); }); });
    $("#btn-reader-tools").addEventListener("click", () => open(context().view === "shelf" ? "stats" : "characters"));
    $("#btn-check-updates").addEventListener("click", () => { if (!navigator.onLine) message("Cần có mạng để kiểm tra chương mới."); else options.reload(); });
    // Return modal focus to the disclosure summary rather than to a hidden menu button.
    document.addEventListener("click", (event) => {
      document.querySelectorAll(".chapter-tools-more[open]").forEach((menu) => {
        const action = event.target.closest("[data-reader-feature], [data-library-action]");
        if (menu.contains(event.target) && !action) return;
        if (menu.contains(action)) menu.querySelector("summary").focus({ preventScroll: true });
        menu.open = false;
      });
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const menu = document.activeElement?.closest(".chapter-tools-more[open]");
      if (!menu) return;
      menu.open = false; menu.querySelector("summary").focus({ preventScroll: true });
      event.preventDefault(); event.stopPropagation();
    }, true);
    document.addEventListener("click", (event) => {
      const character = event.target.closest("[data-character-id]"); if (character) open("characters", character.dataset.characterId);
      const button = event.target.closest("[data-reader-feature]"); if (button) { if (button.dataset.readerFeature === "quotes") readSelection(); open(button.dataset.readerFeature); }
    });
    return { open, renderEmbedded, attachHost: (host) => { embeddedHost = host; }, characterList: visibleCharacters, reached: () => [...(state.reached[currentSeries().slug] || [])], isOpen, updates, syncSeries, onView, openedChapter, completeChapter, decorateChapter, speech: (text) => applyPronunciation(text, pronunciationRules()) };
  }

  return { create, chapterEntries, newChapters, applyPronunciation, dayKey, goalProgress, unlockedCharacters, mergeCharacterCatalog, wrapLines };
});
