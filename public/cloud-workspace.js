(function (root) {
  "use strict";
  function create(options) {
    const core = root.ReaderWorkspace, $ = (id) => document.getElementById(id), esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let context = null, epoch = 0, registered = false, available = false, channel = null, devices = [], presence = new Set(), lastTouch = 0, lastPosition = "", offset = 0, heartbeatBusy = false;
    let device = localStorage.getItem("ketruyen-transfer-device-v1");
    if (!core.UUID.test(device || "")) { device = crypto.randomUUID(); localStorage.setItem("ketruyen-transfer-device-v1", device); }
    const defaultName = /Android/i.test(navigator.userAgent) ? "Điện thoại Android" : /iPhone|iPad/i.test(navigator.userAgent) ? "iPhone / iPad" : /Windows/i.test(navigator.userAgent) ? "Máy tính Windows" : /Macintosh/i.test(navigator.userAgent) ? "Máy Mac" : "Trình duyệt";
    const sid = (session) => { try { return JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id || ""; } catch (_) { return ""; } };
    const tabs = document.createElement("div"); tabs.className = "sync-tabs"; tabs.hidden = true; tabs.setAttribute("aria-label", "Tài khoản");
    tabs.innerHTML = '<button type="button" data-panel="sync" aria-pressed="true">Đồng bộ</button><button type="button" data-panel="devices" aria-pressed="false">Thiết bị</button><button type="button" data-panel="security" aria-pressed="false">Bảo mật</button>';
    // Signed in, the dialog reads top-down: who you are, how sync is doing
    // (and any conflicts to settle), then the tabs.
    $("sync-account").after($("sync-feedback"), $("sync-conflict-heading"), $("sync-conflicts"), tabs);
    const syncPanel = document.createElement("section"); syncPanel.dataset.accountPanel = "sync"; $("ebook-auto-panel").before(syncPanel); syncPanel.append($("ebook-auto-panel"), $("ebook-transfer-panel"));
    const syncActions = document.createElement("div"); syncActions.className = "sync-actions"; syncActions.append($("sync-connect"), $("sync-now"));
    syncPanel.prepend($("sync-account-hint"), syncActions);
    $("sync-account").classList.add("workspace-account"); $("sync-account").replaceChildren($("sync-email-label"), $("sync-signout"));
    syncPanel.insertAdjacentHTML("beforeend", '<section class="workspace-card" id="workspace-baseline" hidden><h3>Thống kê cũ</h3><p id="workspace-import-status" class="sync-copy" role="status"></p><button type="button" class="btn-secondary" id="workspace-import">Nhập từ máy này</button><details id="workspace-import-help" class="sync-help"><summary>Cách nhập</summary><p class="sync-copy">Chọn máy có thống kê cũ cần giữ. Mỗi tài khoản chỉ nhập một lần; thống kê cũ từ các máy khác không được cộng thêm.</p></details></section><div id="workspace-requests"></div>');
    const devicePanel = document.createElement("section"); devicePanel.dataset.accountPanel = "devices"; devicePanel.hidden = true;
    devicePanel.innerHTML = '<h3>Thiết bị của bạn</h3><p class="sync-copy">Mỗi trình duyệt/PWA có một phiên riêng. Thu hồi chặn truy cập đám mây; sách đã lưu offline trên máy đó vẫn còn.</p><div id="workspace-devices"></div><button type="button" class="btn-secondary" id="workspace-signout-others">Đăng xuất các phiên khác</button>';
    syncPanel.after(devicePanel);
    const securityPanel = document.createElement("section"); securityPanel.dataset.accountPanel = "security"; securityPanel.hidden = true;
    securityPanel.innerHTML = '<h3>Bảo mật tài khoản</h3><p id="workspace-email-current" class="sync-copy"></p><form id="workspace-password" class="workspace-form"><label>Mật khẩu mới<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="256"></label><label>Nhập lại mật khẩu<input name="confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="256"></label><label id="workspace-nonce-label" hidden>Mã xác minh trong email<input name="nonce" inputmode="numeric" autocomplete="one-time-code" maxlength="16"></label><button class="btn-secondary" type="submit">Đổi mật khẩu</button><button class="btn-link" type="button" id="workspace-reauth">Gửi mã xác minh</button></form><form id="workspace-email" class="workspace-form"><label>Email mới<input name="email" type="email" autocomplete="email" required maxlength="254"></label><button class="btn-secondary" type="submit">Đổi email</button></form><p id="workspace-security-status" role="status"></p>';
    devicePanel.after(securityPanel);
    const feedback = document.createElement("p"); feedback.id = "workspace-status"; feedback.className = "sync-copy"; feedback.setAttribute("role", "status"); securityPanel.after(feedback);
    const handoff = $("shelf-device-reading");
    const panels = [syncPanel, devicePanel, securityPanel]; let selected = "sync";
    tabs.onclick = (event) => { const button = event.target.closest("[data-panel]"); if (button) { selected = button.dataset.panel; paintTabs(); } };
    function paintTabs() {
      const session = options.session(); tabs.hidden = !session; panels.forEach((p) => p.hidden = !session || p.dataset.accountPanel !== selected);
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.panel === selected)));
      $("workspace-email-current").textContent = session ? `Email hiện tại: ${session.user.email}${session.user.new_email ? ` · Đang chờ xác nhận: ${session.user.new_email}` : ""}` : "";
    }
    function setContext(next) {
      const key = next ? next.owner + ":" + sid(next.session) : "";
      if ((context?.key || "") !== key) {
        epoch++; if (channel) context.client.removeChannel(channel); channel = null; registered = available = false; devices = []; presence.clear(); lastTouch = 0; lastPosition = "";
        context = next ? { ...next, key, sid: sid(next.session) } : null; core.setOwner(next?.owner || null); handoff.hidden = true; options.transfers.setDevices(null);
      } else if (next) context = { ...context, ...next };
      paintTabs();
    }
    function api() {
      const own = context, token = epoch;
      const guard = () => { if (!own || token !== epoch || own.key !== context?.key) throw new Error("sync-cancelled"); };
      const request = async (query) => { guard(); const result = await options.request(query); guard(); if (result.error) throw result.error; return result.data; };
      return { ...own, guard, request };
    }
    function report(error) {
      if (error?.message === "sync-cancelled") return;
      if (/device-revoked/.test(error?.message || "")) { setContext(null); options.revoked(); return; }
      // The sync card already shows a failed sync's message; don't repeat it.
      if (error?.message && error.message === $("sync-status").textContent) return;
      $("workspace-status").textContent = error?.code === "40001" ? "Mục này đã thay đổi trên máy khác. Kiểm tra đồng bộ và chọn bản cần giữ trước khi thử lại." : error?.message || "Chưa cập nhật được thiết bị.";
    }
    async function ensure() {
      if (!context) return false;
      if (registered) return available;
      const a = api();
      try {
        const result = await a.request(a.client.rpc("reader_device_register", { installation: device, label: defaultName }));
        offset = Date.parse(result.server_time) - Date.now(); registered = available = true; core.setOwner(a.owner);
        const cached = await core.journal(a.owner); a.guard(); core.setSummary(core.aggregate(Object.values(cached.events), cached.meta?.legacy, cached.meta?.cutover_ms || 0));
        subscribe(); return true;
      } catch (error) {
        if (["PGRST202", "PGRST205", "42P01"].includes(error.code)) { registered = true; available = false; $("workspace-status").textContent = "Máy chủ chưa hỗ trợ quản lý thiết bị, thống kê và lịch sử ghi chú. Đồng bộ đọc vẫn hoạt động bình thường."; return false; }
        report(error); throw error;
      }
    }
    function subscribe() {
      if (!context || channel) return;
      const a = api(); channel = a.client.channel("reader:" + a.owner, { config: { private: true, presence: { key: a.sid } } })
        .on("postgres_changes", { event: "*", schema: "public", table: "reader_signals", filter: "user_id=eq." + a.owner }, () => { if (context?.key === a.key) options.schedule(750); })
        .on("presence", { event: "sync" }, () => { if (context?.key !== a.key) return; presence = new Set(Object.values(channel.presenceState()).flat().map((p) => p.device)); paintDevices(); })
        .subscribe((state) => { if (context?.key !== a.key) return; if (state === "SUBSCRIBED") channel.track({ device }); else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state)) { presence.clear(); paintDevices(); } });
    }
    async function touch() {
      if (!available || !context || heartbeatBusy || document.hidden || !navigator.onLine) return;
      const position = options.capture?.() || null, serial = JSON.stringify(position), now = Date.now();
      if (now - lastTouch < 5000 || serial === lastPosition && now - lastTouch < 30000) return;
      heartbeatBusy = true; const a = api();
      try { await a.request(a.client.rpc("reader_device_touch", { reading_position: position })); lastTouch = now; lastPosition = serial; }
      catch (error) { report(error); } finally { heartbeatBusy = false; }
    }
    async function all(a, table, columns = "*", configure = (q) => q) {
      const rows = [];
      for (let from = 0; ; from += 500) { const data = await a.request(configure(a.client.from(table).select(columns).eq("user_id", a.owner)).range(from, from + 499)); rows.push(...data); if (data.length < 500) return rows; }
    }
    async function flush() {
      if (!await ensure()) return;
      const a = api(); await touch(); a.guard();
      let journal = await core.journal(a.owner); a.guard();
      const events = Object.values(journal.pending);
      for (let i = 0; i < events.length; i += 100) {
        const batch = events.slice(i, i + 100); await a.request(a.client.rpc("reader_activity_upload", { events: batch }));
        await core.journal(a.owner, (s) => { for (const e of batch) if (s.pending[e.id]?.end === e.end) delete s.pending[e.id]; }); a.guard();
      }
      await archive(a);
      const meta = await a.request(a.client.from("reader_workspace_meta").select("*").eq("user_id", a.owner).maybeSingle());
      // Read through a fixed watermark, so a concurrent upload cannot be skipped.
      const high = meta?.activity_revision || 0;
      const activity = await all(a, "reader_activity", "id,value,revision", (q) => q.gt("revision", journal.revision).lte("revision", high).order("revision").order("id"));
      journal = await core.journal(a.owner, (s) => { for (const e of activity) if (!s.pending[e.id] || s.pending[e.id].end <= e.value.end) s.events[e.id] = e.value; s.meta = meta; s.revision = high; for (const [id, e] of Object.entries(s.events)) if (e.end < Date.now() - 366 * core.DAY && !s.pending[id]) delete s.events[id]; }); a.guard();
      core.setSummary(core.aggregate(Object.values(journal.events), meta?.legacy, meta?.cutover_ms || 0));
      const versions = await all(a, "reader_note_versions", "id,mark_id,value,deleted,recorded_at", (q) => q.order("id"));
      const purges = await all(a, "reader_note_purges", "mark_id,purged_at", (q) => q.order("mark_id"));
      mergeVersions(versions, purges); await processPurges(a);
      devices = await all(a, "reader_devices", "*", (q) => q.order("last_seen", { ascending: false })); paintDevices();
      const transferDevices = devices.filter((d) => d.device_id !== device).map((d) => ({ ...d, online: !d.revoked_at && Date.now() + offset - Date.parse(d.last_seen) < 90000 }));
      options.transfers.setDevices(transferDevices.filter((d) => !d.revoked_at), transferDevices);
      const requests = await all(a, "reader_book_requests", "*", (q) => q.eq("source_session", a.sid).eq("resolved", false).order("id")); paintRequests(requests);
      $("workspace-baseline").hidden = false; $("workspace-import").hidden = Boolean(meta?.legacy);
      $("workspace-import-help").hidden = Boolean(meta?.legacy);
      $("workspace-import-status").textContent = meta?.legacy ? "Đã nhập vào tổng thống kê." : "Chưa nhập thống kê cũ.";
    }
    async function archive(a) {
      const local = JSON.parse(localStorage.getItem("tenshi-library-v1") || "null"), pending = (local?.versions || []).filter((v) => !v.uploaded);
      for (let i = 0; i < pending.length; i += 100) {
        const batch = pending.slice(i, i + 100); await a.request(a.client.rpc("reader_archive_notes", { entries: batch }));
        const fresh = JSON.parse(localStorage.getItem("tenshi-library-v1") || "null"); if (!fresh) continue;
        for (const v of fresh.versions || []) if (batch.some((e) => e.id === v.id)) v.uploaded = true;
        localStorage.setItem("tenshi-library-v1", JSON.stringify(fresh));
      }
    }
    function mergeVersions(rows, purges) {
      const local = JSON.parse(localStorage.getItem("tenshi-library-v1") || "null") || { version: 1, books: {}, marks: [] };
      const versions = new Map((local.versions || []).map((v) => [v.id, v]));
      for (const v of rows) versions.set(v.id, { id: v.id, markId: v.mark_id, value: v.value, deleted: v.deleted, at: Date.parse(v.recorded_at), uploaded: true });
      local.versions = [...versions.values()].filter((v) => v.at > Date.now() - 30 * core.DAY && !purges.some((p) => p.mark_id === v.markId && (Date.parse(p.purged_at) >= v.at || !local.marks.some((m) => m.id === v.markId))));
      localStorage.setItem("tenshi-library-v1", JSON.stringify(local)); options.reloadNotes();
    }
    function online(d) { return core.isOnline(d, presence, Date.now() + offset); }
    function paintDevices() {
      if (!context) return;
      const list = $("workspace-devices");
      if (!list.contains(document.activeElement) || !document.activeElement.matches("input")) {
        list.innerHTML = devices.filter((d, i) => devices.findIndex((v) => v.device_id === d.device_id) === i).map((d) => `<section class="workspace-card"><strong>${esc(d.name)}${d.session_id === context.sid ? " · Máy này" : ""}</strong><p class="sync-copy">${d.revoked_at ? "Đã thu hồi" : online(d) ? "Đang online" : "Offline"} · ${esc(new Date(d.last_seen).toLocaleString("vi"))}</p>${!d.revoked_at ? `<form data-rename="${esc(d.session_id)}" class="workspace-rename"><input name="name" aria-label="Tên thiết bị" value="${esc(d.name)}" required maxlength="80"><button class="btn-secondary" type="submit">Đổi tên</button></form><button type="button" class="btn-link" data-revoke="${esc(d.session_id)}">Thu hồi quyền truy cập</button>` : ""}</section>`).join("") || '<p class="sync-copy">Bật đồng bộ để đăng ký máy này.</p>';
        list.querySelectorAll("[data-rename]").forEach((f) => f.onsubmit = (e) => { e.preventDefault(); manage(f.dataset.rename, "rename", f.elements.name.value); });
        list.querySelectorAll("[data-revoke]").forEach((b) => b.onclick = async () => { if (await root.AppDialog.confirm({ title: "Thu hồi quyền truy cập đám mây của thiết bị này? Dữ liệu đã lưu offline vẫn được giữ.", danger: true })) manage(b.dataset.revoke, "revoke"); });
      }
      const reading = devices.find((d) => d.device_id !== device && online(d) && Date.now() + offset - Date.parse(d.last_seen) < 90000 && d.reading);
      if (handoff.contains(document.activeElement)) return;
      handoff.replaceChildren(); handoff.hidden = !reading;
      if (!reading) return;
      const icon = document.createElement("span"); icon.className = "device-reading-icon"; icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="13" height="11" rx="2"/><path d="M6 18h7M9 14v4"/><rect x="16" y="9" width="5" height="12" rx="1.5"/></svg>';
      const copy = document.createElement("div"); copy.className = "device-reading-copy";
      const label = document.createElement("p"); label.className = "device-reading-label"; label.textContent = `Đang đọc trên ${reading.name}`;
      const title = document.createElement("p"); title.className = "device-reading-title"; title.textContent = options.bookName(reading.reading.slug) || "Ebook cá nhân";
      copy.append(label, title);
      const button = document.createElement("button"); button.type = "button"; button.className = "device-reading-action"; button.textContent = "Đọc tiếp ở đây";
      const arrow = document.createElement("span"); arrow.setAttribute("aria-hidden", "true"); arrow.textContent = " →"; button.append(arrow);
      button.onclick = async () => {
        try { if (await options.resume(reading.reading)) return; if (await root.AppDialog.confirm({ title: "Máy này chưa có ebook. Gửi yêu cầu nhận sách đến máy nguồn?", danger: true })) { const a = api(); await a.request(a.client.rpc("reader_book_request", { source: reading.session_id, book: reading.reading.slug })); $("workspace-status").textContent = "Đã gửi yêu cầu. Máy nguồn cần xác nhận gửi sách."; options.open(); } }
        catch (error) { report(error); }
      }; handoff.append(icon, copy, button);
    }
    function paintRequests(requests) {
      const list = $("workspace-requests"); list.replaceChildren();
      for (const r of requests) {
        const card = document.createElement("section"); card.className = "workspace-card";
        const text = document.createElement("p"); text.textContent = `${devices.find((d) => d.device_id === r.target_device)?.name || "Máy khác"} muốn nhận ${options.bookName(r.slug) || "ebook"}.`;
        const button = document.createElement("button"); button.type = "button"; button.className = "btn-secondary"; button.textContent = "Chọn sách để gửi"; button.onclick = () => options.transfers.offer(r.slug, r.target_device, r.id);
        card.append(text, button); list.append(card);
      }
    }
    async function manage(target, action, label = null) {
      if (!context || !await ensure()) return; const a = api();
      try { await a.request(a.client.rpc("reader_device_manage", { target, action, label })); if (target === a.sid && action === "revoke") { setContext(null); options.revoked(); } else options.schedule(0); } catch (error) { report(error); }
    }
    $("workspace-signout-others").onclick = async () => { if (await root.AppDialog.confirm({ title: "Đăng xuất và thu hồi các phiên khác?", danger: true })) { await manage(null, "revoke_others"); const result = await options.client().auth.signOut({ scope: "others" }); if (result.error) report(result.error); } };
    $("workspace-import").onclick = async () => {
      if (!context || !await ensure() || !await root.AppDialog.confirm({ title: "Chỉ nhập một lần. Dùng thống kê cũ của máy này làm dữ liệu gốc cho tài khoản?", danger: true })) return;
      const a = api(); try { const snapshot = JSON.parse(localStorage.getItem("ketruyen-legacy-stats-v1") || '{"at":0,"days":{}}'); await a.request(a.client.rpc("reader_import_legacy", { snapshot, cutoff: snapshot.at })); options.schedule(0); } catch (error) { report(error); }
    };
    async function processPurges(a) {
      const s = await core.journal(a.owner);
      for (const [id, entry] of Object.entries(s.purges || {})) {
        try { await a.request(a.client.rpc("reader_note_purge", { note_id: id, expected: entry.expected })); await core.journal(a.owner, (v) => delete v.purges[id]); }
        catch (error) { if (error.code !== "40001") throw error; $("workspace-status").textContent = "Một ghi chú chờ xóa đã đổi trên máy khác. Mở thùng rác sau khi xử lý xung đột để chọn lại."; }
      }
    }
    async function noteAction(action, version) {
      if (!context) return false;
      const a = api(), key = "mark/" + version.markId, syncState = options.state();
      if (!navigator.onLine && action === "restore") return false;
      if (!syncState || syncState.owner !== a.owner || navigator.onLine && (syncState.pending[key] || syncState.conflicts[key])) throw new Error("Kiểm tra đồng bộ và chọn bản ghi chú cần giữ trước khi thực hiện.");
      const expected = syncState.baseline[key]?.revision || 0;
      if (action === "purge" && !navigator.onLine) { await core.journal(a.owner, (s) => { (s.purges ||= {})[version.markId] = { expected: expected + (syncState.baseline[key]?.value ? 1 : 0) }; }); return "queued"; }
      if (!navigator.onLine) return false;
      await ensure(); if (!available) throw new Error("Cần cập nhật migration trước khi khôi phục/xóa trên tài khoản.");
      await archive(a);
      const row = await a.request(a.client.rpc(action === "restore" ? "reader_note_restore" : "reader_note_purge", action === "restore" ? { version_id: version.id, expected } : { note_id: version.markId, expected }));
      if (row) { root.ReaderSync.applyLocal(localStorage, { [key]: row.value }); syncState.baseline[key] = row; await options.saveState(a.owner, syncState); }
      else { syncState.baseline[key] = { record_key: key, value: null, revision: expected + 1 }; await options.saveState(a.owner, syncState); }
      if (action === "purge") await core.journal(a.owner, (s) => { if (s.purges) delete s.purges[version.markId]; });
      options.schedule(0); return true;
    }
    core.noteAction = (...args) => options.exclusive(() => noteAction(...args));
    async function security(action) {
      const status = $("workspace-security-status"), client = options.client(); if (!client || !options.session()) return;
      const buttons = securityPanel.querySelectorAll("button"); buttons.forEach((b) => b.disabled = true);
      try { await action(client); } catch (error) { if (["reauthentication_needed", "reauthentication_not_valid"].includes(error.code)) { $("workspace-nonce-label").hidden = false; status.textContent = "Cần xác minh lại. Bấm Gửi mã xác minh rồi nhập mã nhận qua email."; } else status.textContent = error.message || "Chưa cập nhật được tài khoản."; }
      finally { buttons.forEach((b) => b.disabled = false); }
    }
    $("workspace-password").onsubmit = (e) => {
      e.preventDefault(); const form = e.target, password = form.elements.password.value;
      if (password !== form.elements.confirm.value) { $("workspace-security-status").textContent = "Hai mật khẩu chưa khớp."; return; }
      if (new TextEncoder().encode(password).length > 72) { $("workspace-security-status").textContent = "Mật khẩu vượt giới hạn 72 byte."; return; }
      security(async (c) => { const { error } = await c.auth.updateUser({ password, ...(form.elements.nonce.value.trim() ? { nonce: form.elements.nonce.value.trim() } : {}) }); if (error) throw error; form.reset(); $("workspace-nonce-label").hidden = true; $("workspace-security-status").textContent = "Đã đổi mật khẩu."; });
    };
    $("workspace-reauth").onclick = () => security(async (c) => { const { error } = await c.auth.reauthenticate(); if (error) throw error; $("workspace-nonce-label").hidden = false; $("workspace-security-status").textContent = "Đã yêu cầu mã xác minh. Kiểm tra email của bạn."; });
    $("workspace-email").onsubmit = (e) => { e.preventDefault(); const email = e.target.elements.email.value.trim(); security(async (c) => { const { error } = await c.auth.updateUser({ email }, { emailRedirectTo: location.origin + "/sync-auth.html" }); if (error) throw error; $("workspace-security-status").textContent = `Đang chờ xác nhận ${email}. Khi Secure email change được bật, hãy xác nhận trong cả hộp thư cũ và mới.`; }); };
    setInterval(touch, 5000); setInterval(paintDevices, 15000);
    return { setContext, ensure, flush, report, sessionKey: sid, async beforeSync() { if (await ensure()) { const a = api(); await a.request(a.client.rpc("reader_require_device")); await archive(a); } }, mutationId(key, value) { if (!key.startsWith("mark/")) return undefined; const local = JSON.parse(localStorage.getItem("tenshi-library-v1") || "null"); return value?.changeId || [...(local?.versions || [])].reverse().find((v) => v.markId === key.slice(5) && v.deleted)?.id; } };
  }
  root.CloudWorkspace = { create };
})(globalThis);
