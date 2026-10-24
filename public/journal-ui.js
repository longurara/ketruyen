(function (root) {
  "use strict";
  function create(options) {
    const core = root.ReaderJournal, $ = (id) => document.getElementById(id), esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const journal = root.ReaderSync.journal(); let owner = "", session = "", epoch = 0, syncState = null, syncBusy = false, cloud = null, editing = false, dirty = false, suggested = null, observing = false; const pendingObservations = new Map();
    let summaryYear = core.dayKey().slice(0, 4), tab = "timeline", selectedBook = "", selectedMonth = "", selectedRating = "", selectedMood = "", selectedScope = "", query = "", syncMessage = "Nhật ký lưu trên máy. Bật đồng bộ để mang sang thiết bị khác.";
    document.body.insertAdjacentHTML("beforeend", '<dialog id="journal-dialog" class="tools-dialog journal-dialog" aria-labelledby="journal-title"><header class="tools-heading"><h2 id="journal-title">Nhật ký hành trình đọc</h2><button id="journal-close" class="tools-close" type="button" aria-label="Đóng nhật ký">×</button></header><div class="journal-body"><p class="tools-hint">Cảm nhận của bạn, từ những trang đầu đến lần đọc lại.</p><p id="journal-sync-status" class="tools-hint" role="status"></p><div id="journal-content"></div><p id="journal-feedback" class="tools-feedback" role="status" hidden></p></div></dialog>');
    const dialog = $("journal-dialog"), panel = $("journal-content"); options.surfaces.attach(dialog, { canClose: () => !dirty });
    const feedback = (message) => { $("journal-feedback").hidden = !message; $("journal-feedback").textContent = message; };
    let recordsCache = null, filtersOpen = false;
    const all = () => { try { return recordsCache ||= core.values(localStorage); } catch (error) { feedback(error.message); return []; } };
    const write = (updates) => { core.apply(localStorage, updates); dispatchEvent(new Event("ketruyen-journal-change")); };
    const save = (v) => write({ ["journal/" + v.id]: v });
    const scopeText = (r) => `${r.volume} · Lượt ${r.round || all().find((v) => v.id === r.runId)?.round || 1}`;
    const showDate = (s) => s ? s.split("-").reverse().join("/") : "Chưa đặt ngày";
    async function close() { if (dirty && !await root.AppDialog.confirm({ title: "Bỏ các thay đổi chưa lưu trong nhật ký?", confirmLabel: "Bỏ thay đổi" })) return; editing = dirty = false; options.surfaces.close(dialog); }
    $("journal-close").onclick = close; dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    function setContext(id, key = "") { if (id !== owner || key !== session) { owner = id || ""; session = key; epoch++; syncState = null; syncMessage = owner ? "Đang chờ kiểm tra đồng bộ nhật ký…" : "Nhật ký lưu trên máy. Bật đồng bộ để mang sang thiết bị khác."; paintSync(); } }
    function paintSync() { $("journal-sync-status").textContent = syncMessage; }
    async function flush(api) {
      const token = epoch, own = owner; if (!own || api.owner !== own) return { pending: 0, conflicts: 0 };
      const guard = () => { api.guard(); if (token !== epoch || owner !== own) throw new Error("sync-cancelled"); };
      syncBusy = true;
      try {
        syncState = await journal(own + ":reading-journal") || root.ReaderSync.newState(own); guard();
        const result = await root.ReaderSync.synchronize(syncState, {
          read: () => { guard(); return core.records(localStorage); }, merge: core.mergeRun,
          save: (state) => { guard(); return journal(own + ":reading-journal", state); },
          apply: (updates) => { guard(); core.apply(localStorage, updates); changed(false); },
          pull: async () => { const rows = []; for (let from = 0; ; from += 500) { const data = await api.request(api.client.from("reader_journal_records").select("record_key,value,revision").eq("user_id", own).order("record_key").range(from, from + 499)); guard(); rows.push(...data); if (data.length < 500) return rows; } },
          push: async (changes) => { const data = await api.request(api.client.rpc("reader_journal_apply", { changes })); guard(); return data; }
        });
        guard(); syncMessage = result.conflicts ? `${result.conflicts} mục nhật ký có hai bản sửa. Chọn bản giữ lại trong Nhật ký; nội dung còn lại được lưu thành bản riêng.` : result.pending ? "Nhật ký còn thay đổi chờ gửi." : `Đã đồng bộ nhật ký · ${new Date().toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit" })}`;
        return result;
      } catch (error) {
        if (token !== epoch || error.message === "sync-cancelled") return { pending: 0, conflicts: 0 };
        if (error.message?.includes("device-revoked")) throw error;
        syncMessage = ["PGRST202", "PGRST205", "42P01"].includes(error.code) ? "Nhật ký đã lưu trên máy. Máy chủ chưa bật đồng bộ nhật ký; dữ liệu đọc khác vẫn đồng bộ." : `Nhật ký đã lưu trên máy · ${error.message || "Sẽ thử đồng bộ lại khi có mạng."}`;
        return { pending: 0, conflicts: 0 };
      } finally { if (token === epoch) { syncBusy = false; paintSync(); if (dialog.open && !editing) render(); } }
    }
    async function resolve(key, remoteChoice) {
      try {
        await cloud.exclusive(async () => {
          const token = epoch, id = owner, remote = syncState?.conflicts[key]; if (!remote) return;
          const local = core.records(localStorage)[key] ?? null, losing = remoteChoice ? local : remote.value;
          // Keep divergent writing as a separate entry before acknowledging a choice.
          if (losing?.kind === "entry" && JSON.stringify(local) !== JSON.stringify(remote.value)) save({ ...losing, id: crypto.randomUUID(), updatedAt: Date.now() });
          if (losing?.kind === "run" && JSON.stringify(local) !== JSON.stringify(remote.value)) {
            const now = Date.now(); save({ id: crypto.randomUUID(), kind: "entry", runId: losing.id, slug: losing.slug, title: losing.title, author: losing.author, scope: losing.scope, volIdx: losing.volIdx, volume: losing.volume,
              on: core.dayKey(), phase: "during", rating: null, moods: [], attachments: [], location: null, createdAt: now, updatedAt: now,
              text: `Bản lưu khi chọn mốc đọc:\nLượt ${losing.round} · ${core.STATES[losing.status]}\nBắt đầu: ${losing.startedOn || "Chưa đặt"}\nHoàn thành: ${losing.completedOn || "Chưa đặt"}\n${losing.reason}` });
          }
          if (remoteChoice) write({ [key]: remote.value });
          if (token !== epoch || owner !== id) throw new Error("sync-cancelled");
          syncState.baseline[key] = remote; delete syncState.conflicts[key]; root.ReaderSync.stage(syncState, core.records(localStorage));
          await journal(id + ":reading-journal", syncState);
        });
        cloud.schedule(0); render();
      } catch (error) { feedback(error.message || "Chưa chọn được bản nhật ký."); }
    }
    function changed(notify = true) { recordsCache = null; renderHome(); if (dialog.open && !editing) render(); if (notify) cloud?.schedule(); }
    function bookList() {
      const list = new Map(options.series.map((b) => [b.slug, { ...b }]));
      for (const v of all()) if (!list.has(v.slug)) list.set(v.slug, { slug: v.slug, titleVi: v.title, author: v.author, volumesData: null });
      return [...list.values()];
    }
    function filtered(items) {
      const needle = query.trim().toLocaleLowerCase("vi");
      return core.timeline(items).filter((v) => (!selectedBook || v.slug === selectedBook) && (!selectedMonth || v.on.startsWith(selectedMonth)) && (!selectedScope || v.scope === selectedScope)
        && (!selectedRating || v.kind === "entry" && String(v.rating) === selectedRating) && (!selectedMood || v.kind === "entry" && v.moods.includes(selectedMood))
        && (!needle || [v.title, v.text, v.reason, ...(v.moods || []), ...(v.attachments || []).map((a) => a.text)].join(" ").toLocaleLowerCase("vi").includes(needle)));
    }
    function updateFilterButton() {
      const count = [selectedBook, selectedMonth, selectedScope, selectedRating, selectedMood].filter(Boolean).length;
      if ($("journal-filter-toggle")) $("journal-filter-toggle").textContent = count ? 'Lọc (' + count + ')' : 'Lọc';
    }
    function compactFilters() {
      const fields = panel.querySelector('.journal-filters'), label = $("journal-search").closest('label');
      fields.id = 'journal-filter-fields'; fields.hidden = !filtersOpen;
      const controls = document.createElement('div'); controls.className = 'journal-filter-controls';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.id = 'journal-filter-toggle'; toggle.className = 'btn-secondary'; toggle.setAttribute('aria-controls', fields.id); toggle.setAttribute('aria-expanded', String(filtersOpen));
      toggle.onclick = () => { filtersOpen = !filtersOpen; fields.hidden = !filtersOpen; toggle.setAttribute('aria-expanded', String(filtersOpen)); };
      controls.append(label, toggle); fields.before(controls);
      const clear = document.createElement('button'); clear.type = 'button'; clear.id = 'journal-filter-clear'; clear.className = 'btn-link'; clear.textContent = 'Xóa bộ lọc';
      clear.onclick = () => { selectedBook = selectedMonth = selectedScope = selectedRating = selectedMood = ''; render(); $("journal-filter-toggle").focus(); };
      fields.append(clear); updateFilterButton();
    }
    function render() {
      if (editing) return; paintSync(); const items = all(), conflicts = Object.entries(syncState?.conflicts || {}), moods = [...new Set(items.flatMap((v) => v.moods || []))].sort();
      panel.innerHTML = `<div class="journal-toolbar"><button id="journal-write" class="btn-primary" type="button">Viết cảm nhận</button><button id="journal-new-run" class="btn-secondary" type="button">Lượt đọc mới</button><button id="journal-export" class="btn-link" type="button">Xuất nhật ký</button></div><nav class="journal-tabs" aria-label="Xem nhật ký"><button type="button" data-journal-tab="timeline" aria-pressed="${tab === "timeline"}">Dòng thời gian</button><button type="button" data-journal-tab="summary" aria-pressed="${tab === "summary"}">Tổng kết</button></nav><div class="journal-filters"><label>Sách<select id="journal-book"><option value="">Tất cả sách</option>${[...new Map(items.map((v) => [v.slug, v.title])).entries()].map(([slug, title]) => `<option value="${esc(slug)}"${slug === selectedBook ? " selected" : ""}>${esc(title)}</option>`).join("")}</select></label><label>Tháng<input id="journal-month" type="month" value="${esc(selectedMonth)}"></label><label>Phạm vi<select id="journal-scope"><option value="">Bộ và tập</option><option value="book"${selectedScope === "book" ? " selected" : ""}>Cả bộ</option><option value="volume"${selectedScope === "volume" ? " selected" : ""}>Từng tập</option></select></label><label>Đánh giá<select id="journal-rating"><option value="">Mọi đánh giá</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${String(n) === selectedRating ? " selected" : ""}>${n} sao</option>`).join("")}</select></label><label>Cảm xúc<select id="journal-mood"><option value="">Mọi cảm xúc</option>${moods.map((m) => `<option${m === selectedMood ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></label><label>Tìm cảm nhận<input id="journal-search" type="search" value="${esc(query)}" placeholder="Nội dung, trích dẫn…"></label></div><div id="journal-results"></div>${conflicts.length ? `<section class="journal-conflicts"><h3>Các bản nhật ký cần chọn</h3>${conflicts.map(([key, remote], i) => `<article class="journal-card"><strong>${esc(remote.value?.title || "Mục đã xóa")}</strong><p>Máy này: ${esc((core.records(localStorage)[key]?.text || core.records(localStorage)[key]?.status || "Đã xóa").slice(0, 160))}</p><p>Đám mây: ${esc((remote.value?.text || remote.value?.status || "Đã xóa").slice(0, 160))}</p><button type="button" data-journal-resolve="${i}" data-choice="local" class="btn-secondary"${syncBusy ? " disabled" : ""}>Giữ bản trên máy</button><button type="button" data-journal-resolve="${i}" data-choice="remote" class="btn-secondary"${syncBusy ? " disabled" : ""}>Giữ bản đám mây</button></article>`).join("")}</section>` : ""}`;
      compactFilters();
      for (const id of ["journal-rating", "journal-mood", "journal-search"]) $(id).closest("label").hidden = tab === "summary";
      $("journal-write").onclick = () => edit(); $("journal-new-run").onclick = () => newRound(); $("journal-export").onclick = exports;
      panel.querySelectorAll("[data-journal-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.journalTab; render(); });
      for (const [id, assign] of [["journal-book", (v) => selectedBook = v], ["journal-month", (v) => selectedMonth = v], ["journal-scope", (v) => selectedScope = v], ["journal-rating", (v) => selectedRating = v], ["journal-mood", (v) => selectedMood = v]]) $(id).onchange = (e) => { assign(e.target.value); renderResults(); updateFilterButton(); };
      $("journal-search").oninput = (e) => { query = e.target.value; renderResults(); };
      panel.querySelectorAll("[data-journal-resolve]").forEach((b) => b.onclick = () => resolve(conflicts[Number(b.dataset.journalResolve)][0], b.dataset.choice === "remote")); renderResults();
    }
    function renderResults() {
      const host = $("journal-results"); if (!host) return; const rows = filtered(all());
      if (tab === "summary") { renderSummary(host); return; }
      host.innerHTML = rows.length ? rows.slice(0, 100).map((v) => v.kind === "entry" ? `<article class="journal-card"><p class="journal-date">${showDate(v.on)} · ${core.PHASES[v.phase]}</p><h3>${esc(v.title)}</h3><p class="tools-hint">${esc(scopeText(v))}${v.rating ? ` · ${v.rating}/5 sao` : ""}</p>${v.moods.length ? `<p class="journal-moods">${v.moods.map(esc).join(" · ")}</p>` : ""}<p class="journal-prose">${esc(v.text)}</p>${v.attachments.map((a, i) => `<details class="journal-attachment"><summary>${esc(a.label)}</summary><p class="journal-prose">${esc(a.text)}</p>${a.volIdx !== null && a.chapIdx !== null ? `<button type="button" class="btn-link" data-journal-source="${v.id}" data-attachment="${i}">Mở đoạn gốc</button>` : ""}</details>`).join("")}<div class="journal-toolbar"><button type="button" class="btn-link" data-journal-edit="${v.id}">Sửa</button><button type="button" class="btn-link" data-journal-share="${v.id}">Xuất / Chia sẻ</button><button type="button" class="btn-link ui-danger" data-journal-delete="${v.id}">Xóa</button>${v.location ? `<button type="button" class="btn-link" data-journal-source="${v.id}">Về chương đã ghi</button>` : ""}</div></article>` : `<article class="journal-milestone"><p class="journal-date">${showDate(v.on)} · ${({ start: "Bắt đầu đọc", reread: "Bắt đầu đọc lại", complete: "Đọc xong", paused: "Tạm dừng", abandoned: "Bỏ dở", resumed: "Quay lại đọc" })[v.event]}</p><strong>${esc(v.title)}</strong><p>${esc(scopeText(v))}${v.reason ? ` · ${esc(v.reason)}` : ""}</p><button type="button" class="btn-link" data-journal-run="${v.kind === "event" ? v.runId : v.id}">Cảm nhận / Sửa mốc</button></article>`).join("") + (rows.length > 100 ? '<p class="tools-hint">Đang hiện 100 mốc mới nhất. Lọc theo sách hoặc tháng để xem các mốc cũ.</p>' : "") : '<p class="tools-empty">Chưa có nhật ký phù hợp. Bạn có thể ghi cảm nhận cho một cuốn đã đọc, hoặc mở sách để bắt đầu hành trình mới.</p>';
      host.querySelectorAll("[data-journal-edit]").forEach((b) => b.onclick = () => edit(b.dataset.journalEdit));
      host.querySelectorAll("[data-journal-run]").forEach((b) => b.onclick = () => edit(null, b.dataset.journalRun));
      host.querySelectorAll("[data-journal-share]").forEach((b) => b.onclick = () => exports(b.dataset.journalShare));
      host.querySelectorAll("[data-journal-delete]").forEach((b) => b.onclick = async () => { if (await root.AppDialog.confirm({ title: "Xóa bài nhật ký này?", message: "Các ghi chú và trích dẫn gốc vẫn được giữ.", danger: true, confirmLabel: "Xóa bài" })) { try { write({ ["journal/" + b.dataset.journalDelete]: null }); } catch (error) { feedback(error.message); } } });
      host.querySelectorAll("[data-journal-source]").forEach((b) => b.onclick = async () => {
        const v = all().find((r) => r.id === b.dataset.journalSource), a = b.hasAttribute("data-attachment") ? v.attachments[Number(b.dataset.attachment)] : v.location;
        if (!a) return; editing = dirty = false; options.surfaces.close(dialog); await options.openSource({ slug: v.slug, volIdx: a.volIdx, chapIdx: a.chapIdx, p: a.p || 0 });
      });
    }
    function renderSummary(host) {
      const year = selectedMonth?.slice(0, 4) || summaryYear, period = selectedMonth || year, scoped = all().filter((v) => (!selectedBook || v.slug === selectedBook) && (!selectedScope || v.scope === selectedScope)), report = core.summary(scoped, period);
      host.innerHTML = `<section class="journal-card"><h3>Tổng kết ${esc(period)}</h3><label>Năm<input id="journal-year" type="number" min="1900" max="2200" value="${year}"></label><p>${report.books} lượt đọc xong cả bộ · ${report.volumes} lượt đọc xong tập · ${report.entries.length} bài cảm nhận</p><p>${report.rating === null ? "Chưa có điểm đánh giá" : `Đánh giá trung bình: ${report.rating.toLocaleString("vi", { maximumFractionDigits: 1 })}/5 sao`}</p><p>Cảm xúc trong nhật ký: ${report.moods.length ? report.moods.map(([m, n]) => `${esc(m)} (${n})`).join(" · ") : "Chưa ghi"}</p><h4>Những cuốn đáng nhớ</h4>${[...report.entries].filter((e) => e.rating >= 4).sort((a, b) => b.rating - a.rating).slice(0, 8).map((e) => `<p>${esc(e.title)} · ${e.rating}/5</p>`).join("") || '<p class="tools-hint">Những bài đánh giá từ 4 sao sẽ xuất hiện tại đây.</p>'}<h4>Trích dẫn đã chọn</h4>${report.quotes.slice(0, 12).map((q) => `<blockquote class="journal-prose">${esc(q.text)}<footer>${esc(q.title)}</footer></blockquote>`).join("") || '<p class="tools-hint">Đính kèm trích dẫn vào bài nhật ký để lưu vào tổng kết.</p>'}<button type="button" id="journal-summary-export" class="btn-secondary">Xuất các bài trong kỳ</button></section>`;
      $("journal-year").onchange = (e) => { if (e.target.reportValidity()) { summaryYear = e.target.value; selectedMonth = ""; $("journal-month").value = ""; renderSummary(host); } }; $("journal-summary-export").onclick = () => exports(null, report.entries.map((e) => e.id));
    }
    function attachments(slug) {
      const lib = JSON.parse(localStorage.getItem("tenshi-library-v1") || "null"), tools = JSON.parse(localStorage.getItem("tenshi-reader-tools-v1") || "null"), book = options.series.find((b) => b.slug === slug);
      const list = (lib?.marks || []).filter((m) => m.slug === slug).map((m) => ({ type: m.parts?.length ? "quote" : "note", label: String(m.label || (m.parts?.length ? "Đoạn đã tô màu" : "Ghi chú")).slice(0, 160), text: [m.parts?.map((p) => p.quote).join("\n"), m.note].filter(Boolean).join("\n").slice(0, 2000), volIdx: m.volIdx, chapIdx: m.chapIdx, p: m.parts?.[0]?.p || m.anchor?.block || 0 }));
      for (const q of tools?.quotes || []) if (q.slug === slug) list.push({ type: "quote", label: "Trích dẫn đã lưu", text: String(q.text || "").slice(0, 2000), volIdx: Number.isInteger(q.volIdx) ? q.volIdx : null, chapIdx: Number.isInteger(q.chapIdx) ? q.chapIdx : null });
      if (book) for (const c of root.ReaderFeatures.unlockedCharacters(tools?.characters?.[slug] || [], root.ReaderFeatures.chapterEntries(book), tools?.reached?.[slug] || [])) list.push({ type: "character", label: String(c.name).slice(0, 160), text: String(c.note || "Nhân vật yêu thích").slice(0, 2000), volIdx: null, chapIdx: null });
      return list;
    }
    async function ensureRun(book, scope, volIdx, manual = false) {
      const active = all().filter((v) => v.kind === "run" && v.slug === book.slug && v.scope === scope && v.volIdx === (scope === "book" ? null : volIdx)).sort((a, b) => b.round - a.round || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      if (active.length) return active[0];
      let id = await core.defaultId(book.slug, scope, volIdx); const stored = localStorage.getItem(core.PREFIX + id);
      if (stored) { const value = JSON.parse(stored); if (value?.kind === "run") return value; if (!manual) return null; id = crypto.randomUUID(); }
      const run = core.newRun(book, scope, volIdx, id); save(run); return run;
    }
    async function edit(entryId, runId) {
      try {
        feedback(""); const items = all(), existing = items.find((v) => v.id === entryId), current = options.context(); let run = items.find((v) => v.id === (runId || existing?.runId));
        const chosen = run?.slug || existing?.slug || selectedBook || suggested?.slug || current.series?.slug || options.series[0]?.slug;
        let book = bookList().find((b) => b.slug === chosen); if (!book) throw new Error("Chọn một cuốn sách để ghi nhật ký.");
        if (!run) { await options.ensureBook(book).catch(() => {}); run = await ensureRun(book, "book", null, true); }
        editing = true; dirty = false; const available = attachments(run.slug), chosenAttachments = [...(existing?.attachments || [])];
        for (const a of chosenAttachments) if (!available.some((v) => JSON.stringify(v) === JSON.stringify(a))) available.push(a);
        const initialLocation = existing?.location || (current.view === "reader" && current.series.slug === run.slug ? { volIdx: current.volIdx, chapIdx: current.chapIdx, p: 0 } : null);
        panel.innerHTML = `<button id="journal-form-back" type="button" class="btn-link">← Về nhật ký</button><form id="journal-form"><label>Sách<select name="book">${bookList().map((b) => `<option value="${esc(b.slug)}"${b.slug === run.slug ? " selected" : ""}>${esc(b.titleVi)}</option>`).join("")}</select></label><label>Lượt nhật ký<select name="run">${all().filter((v) => v.kind === "run" && v.slug === run.slug).sort((a, b) => b.round - a.round).map((r) => `<option value="${r.id}"${r.id === run.id ? " selected" : ""}>${esc(scopeText(r))}</option>`).join("")}</select></label><div class="journal-form-grid"><label>Trạng thái<select name="status">${Object.entries(core.STATES).map(([v, label]) => `<option value="${v}"${run.status === v ? " selected" : ""}>${label}</option>`).join("")}</select></label><label>Loại cảm nhận<select name="phase">${Object.entries(core.PHASES).map(([v, label]) => `<option value="${v}"${(existing?.phase || (run.status === "completed" ? "finished" : "during")) === v ? " selected" : ""}>${label}</option>`).join("")}</select></label><label>Ngày bắt đầu<input name="started" type="date" value="${esc(run.startedOn)}"></label><label>Ngày hoàn thành<input name="completed" type="date" value="${esc(run.completedOn)}"></label><label>Ngày ghi cảm nhận<input name="on" type="date" required value="${existing?.on || core.dayKey()}"></label><label>Đánh giá<select name="rating"><option value="">Chưa đánh giá</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${existing?.rating === n ? " selected" : ""}>${n} sao</option>`).join("")}</select></label></div><label>Lý do tạm dừng / bỏ dở / quay lại<input name="reason" maxlength="2000" value="${esc(run.reason)}" placeholder="Có thể để trống"></label><label>Cảm xúc · phân cách bằng dấu phẩy<input name="moods" maxlength="328" value="${esc(existing?.moods.join(", "))}" placeholder="Ấm áp, Muốn đọc lại…"></label><label>Cảm nhận<textarea name="text" rows="7" maxlength="12000" placeholder="Điều gì khiến bạn nhớ đến cuốn sách này?">${esc(existing?.text)}</textarea></label><fieldset class="journal-attachment-picker"><legend>Đính kèm từ những gì đã lưu · tối đa 12 mục</legend>${available.map((a, i) => `<label class="journal-check"><input type="checkbox" name="attachments" value="${i}"${chosenAttachments.some((v) => JSON.stringify(a) === JSON.stringify(v)) ? " checked" : ""}><span><strong>${esc(a.label)}</strong><span>${esc(a.text.slice(0, 120))}</span></span></label>`).join("") || '<p class="tools-hint">Chưa có trích dẫn, ghi chú hoặc nhân vật đã mở khóa cho sách này.</p>'}</fieldset>${initialLocation ? '<label class="journal-check"><input name="location" type="checkbox" checked>Lưu liên kết về chương này</label>' : ""}<p class="tools-hint">Chỉ tài khoản của bạn xem nhật ký. Tệp ebook có thể được xóa riêng mà vẫn giữ cảm nhận.</p><button type="submit" class="btn-primary">Lưu nhật ký</button></form>`;
        const form = $("journal-form");
        const bookLabel = form.elements.book.closest('label'), textLabel = form.elements.text.closest('label'), ratingLabel = form.elements.rating.closest('label'), moodLabel = form.elements.moods.closest('label'), submit = form.querySelector('[type="submit"]');
        const rest = [...form.children].filter((node) => ![bookLabel, textLabel, ratingLabel, moodLabel, submit].includes(node));
        const extra = document.createElement('details'); extra.className = 'journal-extra'; extra.innerHTML = '<summary>Thông tin bổ sung, ngày tháng và đính kèm</summary>'; extra.append(...rest);
        form.replaceChildren(bookLabel, textLabel, ratingLabel, moodLabel, extra, submit);
        form.addEventListener('invalid', (event) => { if (extra.contains(event.target)) extra.open = true; }, true);
        const completionField = () => { form.elements.completed.disabled = form.elements.status.value !== "completed"; if (!form.elements.completed.disabled && !form.elements.completed.value) form.elements.completed.value = core.dayKey(); };
        form.elements.status.onchange = completionField; completionField();
        form.oninput = (e) => { if (!["book", "run"].includes(e.target.name)) dirty = true; };
        $("journal-form-back").onclick = async () => { if (dirty && !await root.AppDialog.confirm({ title: "Bỏ thay đổi chưa lưu?", confirmLabel: "Bỏ thay đổi" })) return; editing = dirty = false; render(); };
        form.elements.book.onchange = async (e) => { if (dirty && !await root.AppDialog.confirm({ title: "Đổi sách và bỏ thay đổi chưa lưu?", confirmLabel: "Đổi sách" })) { e.target.value = run.slug; return; } selectedBook = e.target.value; editing = dirty = false; edit(); };
        form.elements.run.onchange = (e) => { if (dirty) { e.target.value = run.id; feedback("Lưu hoặc quay về nhật ký trước khi đổi lượt."); return; } editing = false; edit(null, e.target.value); };
        form.onsubmit = (event) => {
          event.preventDefault(); if (!form.reportValidity()) return;
          try {
            const data = new FormData(form), now = Date.now(), updatedRun = { ...run, status: data.get("status"), reason: String(data.get("reason")).trim(), startedOn: String(data.get("started")), completedOn: String(data.get("completed")), updatedAt: now };
            if (updatedRun.status === "completed" && !updatedRun.completedOn) updatedRun.completedOn = core.dayKey();
            if (updatedRun.status !== "completed") updatedRun.completedOn = "";
            const record = { id: existing?.id || crypto.randomUUID(), kind: "entry", slug: run.slug, title: run.title, author: run.author, scope: run.scope, volIdx: run.volIdx, volume: run.volume, runId: run.id, createdAt: existing?.createdAt || now, updatedAt: now, on: String(data.get("on")), phase: data.get("phase"), rating: data.get("rating") ? Number(data.get("rating")) : null, text: String(data.get("text")).trim(), moods: [...new Set(String(data.get("moods")).split(",").map((s) => s.trim()).filter(Boolean))], attachments: data.getAll("attachments").map((i) => available[Number(i)]), location: data.has("location") ? initialLocation : null };
            if (record.moods.length > 8 || record.moods.some((m) => m.length > 40)) throw new Error("Chọn tối đa 8 cảm xúc, mỗi cảm xúc không quá 40 ký tự.");
            if (record.attachments.length > 12) throw new Error("Chọn tối đa 12 nội dung đính kèm.");
            if (updatedRun.startedOn && updatedRun.completedOn && updatedRun.completedOn < updatedRun.startedOn) throw new Error("Ngày hoàn thành cần bằng hoặc sau ngày bắt đầu.");
            const freshRun = all().find((r) => r.id === run.id), mergedRun = freshRun ? core.mergeRun("journal/" + run.id, updatedRun, freshRun, run) : null;
            if (!mergedRun) throw new Error("Mốc đọc đã thay đổi trên máy khác. Bản đang viết vẫn ở đây; quay lại nhật ký để xem mốc mới trước khi sửa.");
            const currentEntry = existing && core.records(localStorage)["journal/" + existing.id];
            const concurrent = existing && JSON.stringify(existing) !== JSON.stringify(currentEntry);
            if (concurrent) record.id = crypto.randomUUID();
            const updates = { ["journal/" + run.id]: mergedRun, ["journal/" + record.id]: record };
            const event = ["paused", "abandoned"].includes(mergedRun.status) && (freshRun.status !== mergedRun.status || freshRun.reason !== mergedRun.reason) ? mergedRun.status : mergedRun.status === "reading" && ["paused", "abandoned"].includes(freshRun.status) ? "resumed" : null;
            if (event) { const id = crypto.randomUUID(); updates["journal/" + id] = { id, kind: "event", slug: run.slug, title: run.title, author: run.author, scope: run.scope, volIdx: run.volIdx, volume: run.volume, runId: run.id, event, on: core.dayKey(), reason: mergedRun.reason, createdAt: now, updatedAt: now }; }
            write(updates); editing = dirty = false; render(); dialog.querySelector(".journal-body").scrollTop = 0; feedback(concurrent ? "Bài cũ đã thay đổi trên máy khác. Đã giữ cảm nhận bạn vừa viết thành bài riêng." : "Đã lưu nhật ký trên máy.");
          } catch (error) { feedback(error.name === "QuotaExceededError" ? "Bộ nhớ đã đầy. Chưa lưu thay đổi; bạn có thể xuất nhật ký để sao lưu." : error.message); }
        };
        dialog.querySelector(".journal-body").scrollTop = 0; panel.querySelector('textarea[name="text"]').focus({ preventScroll: true });
      } catch (error) { editing = false; feedback(error.message || "Chưa mở được nhật ký."); }
    }
    async function newRound() {
      editing = true; dirty = false; const books = bookList(), selected = selectedBook || options.context().series?.slug || books[0]?.slug;
      panel.innerHTML = `<button id="journal-round-back" class="btn-link" type="button">← Về nhật ký</button><form id="journal-round-form"><h3>Bắt đầu lượt nhật ký</h3><label>Sách<select name="book">${books.map((b) => `<option value="${esc(b.slug)}"${b.slug === selected ? " selected" : ""}>${esc(b.titleVi)}</option>`).join("")}</select></label><label>Phạm vi<select name="scope"><option value="book">Cả bộ</option><option value="volume">Một tập</option></select></label><label>Tập<select name="volume"></select></label><p class="tools-hint">Lượt nhật ký mới giữ các cảm nhận cũ. Tiến độ đọc sách được giữ nguyên.</p><button class="btn-primary" type="submit">Bắt đầu</button></form>`;
      $("journal-round-back").onclick = () => { editing = false; render(); }; const form = $("journal-round-form"); let selectedMeta;
      const volumes = async () => { form.querySelector('button[type="submit"]').disabled = true; selectedMeta = books.find((b) => b.slug === form.elements.book.value); await options.ensureBook(selectedMeta).catch(() => {}); form.elements.volume.innerHTML = (selectedMeta.volumesData || []).map((v, i) => `<option value="${i}">${esc(v.name || v.title)}</option>`).join(""); form.elements.volume.disabled = form.elements.scope.value !== "volume"; form.querySelector('button[type="submit"]').disabled = false; };
      form.elements.book.onchange = volumes; form.elements.scope.onchange = volumes; await volumes();
      form.onsubmit = async (e) => { e.preventDefault(); try { const scope = form.elements.scope.value, vi = scope === "volume" ? Number(form.elements.volume.value) : null; if (scope === "volume" && !form.elements.volume.value) throw new Error("Máy này chưa có mục lục tập. Chọn nhật ký cả bộ hoặc mở sách trước."); const previous = all().filter((v) => v.kind === "run" && v.slug === selectedMeta.slug && v.scope === scope && v.volIdx === vi); const run = core.newRun(selectedMeta, scope, vi, crypto.randomUUID(), Math.max(0, ...previous.map((v) => v.round)) + 1); save(run); editing = false; edit(null, run.id); } catch (error) { feedback(error.message); } };
    }
    function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    function exports(entryId, ids) {
      const entries = all().filter((v) => v.kind === "entry" && (!entryId || v.id === entryId) && (!ids || ids.includes(v.id)) && (entryId || ids || filtered(all()).some((r) => r.id === v.id)));
      editing = true; dirty = false;
      panel.innerHTML = `<button id="journal-export-back" class="btn-link" type="button">← Về nhật ký</button><h3>Chọn nội dung xuất / chia sẻ</h3><p class="tools-hint">Chỉ các bài được chọn bên dưới được đưa vào tệp. Ứng dụng không tự công khai nhật ký.</p><div class="journal-export-picker">${entries.map((e) => `<label class="journal-check"><input type="checkbox" name="entry" value="${e.id}" checked><span>${esc(e.title)} · ${showDate(e.on)} · ${esc(e.volume)}</span></label>`).join("") || '<p class="tools-empty">Chưa có bài cảm nhận để xuất.</p>'}</div><label class="journal-check"><input id="journal-export-attachments" type="checkbox">Kèm các trích dẫn / ghi chú / nhân vật đính kèm</label><div class="journal-toolbar"><button id="journal-md" type="button" class="btn-primary">Tải Markdown</button><button id="journal-pdf" type="button" class="btn-secondary">In / Lưu PDF</button><button id="journal-card" type="button" class="btn-secondary">Tạo thẻ PNG</button></div><div id="journal-card-preview"></div>`;
      $("journal-export-back").onclick = () => { editing = false; render(); };
      const chosen = () => entries.filter((e) => [...panel.querySelectorAll('input[name="entry"]:checked')].some((i) => i.value === e.id));
      const get = () => { const items = chosen(); if (!items.length) throw new Error("Chọn ít nhất một bài nhật ký."); return items; };
      $("journal-md").onclick = () => { try { download(new Blob([core.markdown(get(), { attachments: $("journal-export-attachments").checked })], { type: "text/markdown;charset=utf-8" }), "nhat-ky-doc.md"); } catch (e) { feedback(e.message); } };
      $("journal-pdf").onclick = () => {
        try { const selected = get(), win = window.open("about:blank", "_blank"); if (!win) throw new Error("Cho phép mở cửa sổ để in hoặc lưu PDF."); win.opener = null;
          win.document.write(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Nhật ký đọc</title><style>body{font:16px/1.8 Arial,sans-serif;max-width:760px;margin:32px auto;padding:20px;color:#20291f}article{break-inside:avoid;margin-bottom:40px}p,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}h1,h2{line-height:1.5}@page{margin:20mm}</style><h1>Nhật ký đọc · Kệ truyện</h1>${selected.map((e) => `<article><h2>${esc(e.title)} · ${esc(e.volume)}</h2><p>${showDate(e.on)} · ${core.PHASES[e.phase]}${e.rating ? ` · ${e.rating}/5 sao` : ""}</p><p>${esc(e.moods.join(" · "))}</p><p>${esc(e.text)}</p>${$("journal-export-attachments").checked ? e.attachments.map((a) => `<h3>${esc(a.label)}</h3><blockquote>${esc(a.text)}</blockquote>`).join("") : ""}</article>`).join("")}<script>window.onload=()=>window.print();</script></html>`); win.document.close();
        } catch (e) { feedback(e.message); }
      };
      $("journal-card").onclick = async () => {
        try { const selected = get(); if (selected.length !== 1) throw new Error("Chọn đúng một bài để tạo thẻ cảm nhận."); const e = selected[0]; await document.fonts.ready;
          const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1350; const ctx = canvas.getContext("2d"); ctx.fillStyle = "#f6f1e7"; ctx.fillRect(0, 0, 1080, 1350); ctx.fillStyle = "#273728";
          const wrap = (text, x, y, font, lineHeight, maxLines) => { ctx.font = font; const words = String(text).split(/\s+/), lines = []; let line = ""; for (const w of words) { const next = line ? line + " " + w : w; if (ctx.measureText(next).width > 900 && line) { lines.push(line); line = w; } else line = next; } if (line) lines.push(line); lines.slice(0, maxLines).forEach((s, i) => ctx.fillText(s + (i === maxLines - 1 && lines.length > maxLines ? "…" : ""), x, y + i * lineHeight, 900)); return y + Math.min(lines.length, maxLines) * lineHeight; };
          ctx.font = '600 24px "Be Vietnam Pro",Arial,sans-serif'; ctx.fillText("NHẬT KÝ ĐỌC · KỆ TRUYỆN", 90, 120); let y = wrap(e.title, 90, 230, '600 48px "Be Vietnam Pro",Arial,sans-serif', 72, 3);
          y = wrap(`${e.volume} · ${showDate(e.on)}${e.rating ? ` · ${e.rating}/5 sao` : ""}`, 90, y + 30, '28px "Be Vietnam Pro",Arial,sans-serif', 44, 2);
          wrap([e.text || e.moods.join(" · "), ...($("journal-export-attachments").checked ? e.attachments.map((a) => a.text) : [])].join("\n\n"), 90, y + 70, '32px "Be Vietnam Pro",Arial,sans-serif', 54, Math.max(1, Math.floor((1160 - y - 70) / 54))); ctx.font = '24px "Be Vietnam Pro",Arial,sans-serif'; ctx.fillText("Một khoảng lặng, một cuốn sách.", 90, 1250);
          const preview = $("journal-card-preview"); preview.replaceChildren(canvas); const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png")); download(blob, "cam-nhan-sach.png");
        } catch (e) { feedback(e.message); }
      };
    }
    async function observe(book, vi, chapters, finished = null) {
      const pending = pendingObservations.get(`${book.slug}:${vi}`) || { book, vi, chapters, finished: new Set() };
      pending.vi = vi; pending.chapters = chapters;
      if (finished) pending.finished.add(`${finished.volIdx}:${finished.chapIdx}`);
      pendingObservations.set(`${book.slug}:${vi}`, pending);
      if (observing) return; observing = true;
      try {
        while (pendingObservations.size) {
          const [slug, pending] = pendingObservations.entries().next().value;
          pendingObservations.delete(slug); const { book: b, vi: v, chapters: read, finished: done } = pending;
          for (const scope of ["volume", "book"]) {
            const run = await ensureRun(b, scope, scope === "book" ? null : v);
            if (!run) continue;
            const fresh = all().find((r) => r.id === run.id); if (!fresh) continue;
            const next = core.advanceRun(fresh, b, read, [...done]);
            if (next !== fresh) save(next);
            if (!fresh.completedOn && next.completedOn && scope === "volume") { suggested = { slug: b.slug, runId: run.id }; renderHome(); }
          }
        }
      } catch (error) { options.message(error.name === "QuotaExceededError" ? "Chưa lưu được mốc nhật ký vì bộ nhớ đã đầy." : error.message); }
      finally { observing = false; }
    }
    // With nothing to show, the journal shrinks to a button in the shelf
    // heading instead of taking a row above the books.
    const journalAnchor = document.createComment("shelf-journal");
    $("shelf-journal")?.before(journalAnchor);
    function renderHome() {
      const host = $("shelf-journal"); if (!host) return;
      const compactSlot = document.querySelector(".shelf-heading .shelf-actions");
      const items = all(), entries = items.filter((v) => v.kind === "entry").sort((a, b) => b.on.localeCompare(a.on)), memory = core.memories(items)[0];
      host.classList.toggle("is-compact", !suggested && !memory);
      if (!suggested && !memory) {
        host.hidden = false;
        if (compactSlot && host.parentElement !== compactSlot) compactSlot.prepend(host);
        const label = entries.length ? `Mở nhật ký đọc, ${entries.length.toLocaleString("vi-VN")} cảm nhận` : "Viết nhật ký đọc";
        host.innerHTML = `<button type="button" id="shelf-journal-open" class="btn-secondary" aria-label="${label}" title="${label}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"></path><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"></path></svg><span>Nhật ký</span></button>`;
        $("shelf-journal-open").onclick = () => open(); return;
      }
      if (host.parentElement === compactSlot) journalAnchor.after(host);
      host.hidden = false; host.innerHTML = `<div><p class="shelf-feature-kicker">Nhật ký của bạn</p><h2>${suggested ? "Một tập vừa khép lại" : memory ? "Ngày này trong ký ức đọc" : entries.length ? "Những trang đã để lại điều gì?" : "Giữ lại cảm nhận sau mỗi cuốn"}</h2><p>${esc(suggested ? options.series.find((b) => b.slug === suggested.slug)?.titleVi || "Sách vừa đọc xong" : memory ? `${memory.title} · ${showDate(memory.on)}` : entries[0] ? `${entries[0].title} · ${entries[0].text.slice(0, 110) || "Một cảm nhận đã được lưu"}` : "Từ một trích dẫn đến một lần đọc lại, mọi cảm nhận đều có chỗ để trở về.")}</p></div><button type="button" id="shelf-journal-open" class="btn-secondary">${suggested ? "Ghi lại cảm nhận?" : "Mở nhật ký"}</button>${suggested ? '<button type="button" id="shelf-journal-dismiss" class="btn-link">Để sau</button>' : ""}`;
      $("shelf-journal-open").onclick = () => { open(suggested?.slug); if (suggested) edit(null, suggested.runId); };
      if ($("shelf-journal-dismiss")) $("shelf-journal-dismiss").onclick = () => { suggested = null; renderHome(); };
    }
    function open(slug) { if (editing && dialog.open) return; for (const id of ["workbench-dialog", "reader-tools-dialog", "sync-dialog"]) if ($(id)?.open) options.surfaces.close($(id)); options.closeSettings(); selectedBook = typeof slug === "string" ? slug : ""; editing = dirty = false; feedback(""); render(); options.surfaces.open(dialog); }
    document.querySelectorAll("[data-open-journal]").forEach((b) => b.onclick = () => open());
    addEventListener("ketruyen-journal-change", () => changed()); addEventListener("storage", (e) => { if (e.key?.startsWith(core.PREFIX)) changed(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) renderHome(); });
    renderHome();
    return { open, observe, setContext, flush, renderHome, connect(controller) { cloud = controller; } };
  }
  root.JournalUI = { create };
})(globalThis);
