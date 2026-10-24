(function (root) {
  "use strict";
  function create(options) {
    const core = root.ReaderSync, config = root.ReaderSyncConfig, $ = (id) => document.getElementById(id);
    const dialog = $("sync-dialog"), status = $("sync-status"), saveJournal = core.journal();
    let client, loading, session = null, linked = "", busy = false, generation = 0, timer, state;
    let showAfterLogin = new URLSearchParams(location.search).has("auth_complete");
    let recovery = sessionStorage.getItem("ketruyen-password-recovery") === "1";
    let phase = "idle", syncing = false, dirty = false;
    const transfers = root.EbookTransferUI.create({ onReceived: options.onEbookReceived, onState: options.onEbookState });
    root.LibraryHealth.create({ surfaces: options.surfaces, snapshot: transfers.snapshot, check: transfers.check, receive: transfers.receive, closeSettings: options.closeSettings,
      backup: () => document.getElementById("btn-library-backup").click(), openBook: (slug) => options.resume({ slug, volIdx: 0, chapIdx: 0, anchor: { block: 0, offset: 0 } }) });
    const workspace = root.CloudWorkspace.create({ transfers, session: () => recovery ? null : session, client: () => client, request,
      state: () => state, saveState: saveJournal, schedule, exclusive, bookName: options.bookName, capture: options.capture, resume: options.resume, open,
      reloadNotes: options.reloadNotes,
      revoked: () => { generation++; linked = ""; localStorage.removeItem(core.LINK_KEY); transfers.setContext(null); client?.auth.signOut({ scope: "local" }); session = null; render(); message("Quyền truy cập đám mây của phiên này đã bị thu hồi. Đăng nhập lại để tạo phiên mới.", "error"); }
    });
    try { linked = localStorage.getItem(core.LINK_KEY) || ""; } catch (_) {}
    options.surfaces.attach(dialog);
    const message = (text, next = phase) => { phase = next; status.textContent = text; paintStatus(); };
    function paintStatus() {
      const enabled = Boolean(session && linked === session.user.id), own = state?.owner === session?.user?.id ? state : null;
      const conflicts = Object.keys(own?.conflicts || {}).length, pending = Object.keys(own?.pending || {}).length;
      const current = !navigator.onLine ? "offline" : phase === "pending" && conflicts ? "conflict" : phase;
      const labels = { idle: !session ? "Chưa đăng nhập" : enabled ? "Sẵn sàng đồng bộ" : "Chưa bật đồng bộ", syncing: "Đang kiểm tra và đồng bộ", working: "Đang xử lý…", synced: "Đã đồng bộ", pending: "Chờ kiểm tra thay đổi", offline: "Đang offline", conflict: "Có thay đổi cần chọn", error: "Chưa thực hiện được" };
      const title = labels[current];
      $("sync-feedback").dataset.syncState = current;
      $("sync-feedback").setAttribute("aria-busy", String(current === "syncing" || current === "working"));
      $("sync-state-label").textContent = title;
      $("btn-sync").dataset.syncState = enabled || current === "offline" ? current : "idle";
      $("btn-sync").title = `Đồng bộ giữa các máy · ${enabled || current === "offline" ? title : "Chưa bật đồng bộ"}`;
      $("btn-sync").setAttribute("aria-label", $("btn-sync").title);
      const notice = $("shelf-sync-notice");
      notice.hidden = !enabled || !["error", "conflict"].includes(current);
      $("shelf-sync-notice-copy").textContent = current === "conflict" ? `${conflicts} thay đổi cần kiểm tra. Các mục khác vẫn đồng bộ.` : "Có dữ liệu chưa đồng bộ. Bản trên máy vẫn được giữ.";
      const now = $("sync-now"); now.textContent = syncing ? "Đang đồng bộ…" : "Kiểm tra đồng bộ";
      $("sync-last-success").hidden = !enabled;
      $("sync-last-success").textContent = own?.lastSyncedAt ? `Lần thành công gần nhất: ${new Date(own.lastSyncedAt).toLocaleString("vi", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Chưa có lần đồng bộ thành công trên máy này.";
      const transfer = own?.lastTransfer;
      $("sync-transfer").hidden = !enabled || !transfer || current !== "synced";
      $("sync-transfer").textContent = transfer ? transfer.uploaded || transfer.downloaded ? `Đã gửi ${transfer.uploaded} mục · Đã nhận ${transfer.downloaded} mục` : "Không có thay đổi mới · Dữ liệu đã khớp với đám mây." : "";
      $("sync-pending").hidden = !enabled || (!pending && !dirty);
      $("sync-pending").textContent = pending ? [pending > conflicts ? `${pending - conflicts} mục chờ gửi` : "", conflicts ? `${conflicts} mục cần chọn bản giữ lại` : ""].filter(Boolean).join(" · ") : "Có thay đổi trên máy · Chờ kiểm tra.";
    }
    function render() {
      $("sync-login").hidden = Boolean(session);
      $("sync-account").hidden = !session || recovery;
      $("sync-reset").hidden = !session || !recovery;
      $("sync-email-label").textContent = session?.user?.email || "";
      $("sync-reset-email").value = session?.user?.email || "";
      const enabled = Boolean(session && linked === session.user.id);
      workspace.setContext(enabled && !recovery ? { owner: session.user.id, client, session } : null);
      transfers.setContext(enabled && !recovery ? { owner: session.user.id, client, sessionKey: workspace.sessionKey(session) } : null);
      options.journal?.setContext(enabled && !recovery ? session.user.id : "", session ? workspace.sessionKey(session) : "");
      $("sync-account-hint").textContent = enabled ? "Thiết bị này đã bật đồng bộ. Tiến độ tự giữ vị trí đọc xa hơn; ebook tự chuyển khi các máy đang mở." : "Bật đồng bộ để kết hợp thư viện trên máy này với tài khoản và chuyển ebook giữa các máy.";
      $("sync-connect").hidden = enabled; $("sync-now").hidden = !enabled;
      for (const id of ["sync-send", "sync-signup", "sync-forgot", "sync-reset-save", "sync-connect", "sync-now", "sync-signout"]) $(id).disabled = busy;
      $("btn-sync").classList.toggle("is-connected", enabled);
      paintStatus();
      $("sync-conflicts").replaceChildren();
      $("sync-conflict-heading").hidden = true;
      if (!enabled || !state || state.owner !== session.user.id) return;
      const entries = Object.entries(state.conflicts);
      $("sync-conflict-heading").hidden = !entries.length;
      $("sync-conflict-heading").textContent = `${entries.length} thay đổi cần chọn bản giữ lại`;
      for (const [key, remote] of entries.slice(0, 10)) {
        const row = document.createElement("section"); row.className = "sync-conflict";
        const title = document.createElement("h4"); title.textContent = label(key); row.append(title);
        const detail = document.createElement("p"); detail.textContent = `Máy này: ${describe(key, state.pending[key]?.value)} · Đám mây: ${describe(key, remote.value)}`; row.append(detail);
        for (const [choice, text] of [["local", "Giữ trên máy này"], ["remote", "Nhận từ đám mây"]]) {
          const button = document.createElement("button"); button.className = "btn-secondary"; button.type = "button"; button.textContent = text; button.disabled = busy;
          button.onclick = () => sync({ key, choice }); row.append(button);
        }
        $("sync-conflicts").append(row);
      }
    }
    function label(key) {
      const [type, id, chapter] = key.split("/");
      const names = { progress: "Vị trí đọc", chapter: "Tiến độ chương", history: "Lịch sử đọc", favorite: "Yêu thích", status: "Trạng thái sách", groups: "Nhóm sách", mark: "Đánh dấu & ghi chú", goal: "Mục tiêu phiên đọc" };
      return `${names[type]}${type !== "mark" ? ` · ${options.bookName(id) || "Sách"}` : ""}${chapter && type === "chapter" ? ` · Chương ${Number(chapter.split(":")[1]) + 1}` : ""}`;
    }
    function describe(key, value) {
      if (value === null || value === undefined) return "Đã xóa";
      const type = key.split("/")[0];
      if (type === "goal") return `${value.target} ${value.kind === "minutes" ? "phút" : "chương"}`;
      if (type === "favorite") return value ? "Yêu thích" : "Bỏ yêu thích";
      if (type === "status") return ({ "": "Chưa đặt", want: "Muốn đọc", reading: "Đang đọc", done: "Đã đọc" })[value];
      if (type === "groups") return value.join(", ") || "Chưa có nhóm";
      if (type === "mark") return String(value.note || value.label || value.parts?.[0]?.quote || "Đánh dấu").slice(0, 100);
      if (type === "chapter") return value.done ? "Đã đọc xong" : `${Math.round(value.pct || 0)}%`;
      return `Tập ${value.volIdx + 1}, chương ${value.chapIdx + 1}`;
    }
    function failure(error) {
      if (error?.message === "sync-cancelled") return;
      phase = !navigator.onLine || /fetch|network/i.test(error?.message || "") ? "offline" : "error";
      if (error?.message === "sync-timeout") { message("Máy chủ phản hồi chậm · Bạn có thể thử kiểm tra đồng bộ lại."); return; }
      if (error?.code === "invalid_credentials" || /invalid login credentials/i.test(error?.message || "")) { message("Email hoặc mật khẩu chưa đúng."); return; }
      if (error?.code === "email_not_confirmed") { message("Hãy xác nhận email trước khi đăng nhập."); return; }
      if (error?.code === "same_password") { message("Hãy chọn mật khẩu khác mật khẩu cũ."); return; }
      if (error?.code === "PGRST205" || error?.code === "PGRST202" || error?.code === "42P01") message("Chưa thiết lập bảng đồng bộ trên Supabase. Hãy chạy migration trong hướng dẫn của dự án.");
      else if (!navigator.onLine || /fetch|network/i.test(error?.message || "")) message("Đang offline · Thay đổi vẫn lưu trên máy và sẽ gửi khi có mạng.");
      else if (error?.status === 429) message("Đã gửi nhiều yêu cầu. Đợi một lúc rồi thử lại.");
      else if (error?.status === 401 || error?.status === 403) message("Phiên đăng nhập đã hết hạn hoặc chưa có quyền đồng bộ. Hãy đăng nhập lại.");
      else message(error?.message || "Chưa đồng bộ được. Dữ liệu trên máy vẫn được giữ.");
    }
    async function setup() {
      if (client) return client;
      if (loading) return loading;
      loading = (async () => {
        if (!root.supabase) await new Promise((resolve, reject) => {
          const script = document.createElement("script"); script.src = "/vendor/supabase/supabase.js"; script.onload = resolve;
          script.onerror = () => { script.remove(); reject(new Error("Không tải được phần đăng nhập. Kiểm tra kết nối rồi thử lại.")); }; document.head.append(script);
        });
        client = root.supabase.createClient(config.url, config.key, { auth: { storageKey: core.AUTH_KEY, flowType: "implicit", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
        client.auth.onAuthStateChange((_event, next) => { setTimeout(() => account(next), 0); });
        const result = await client.auth.getSession(); if (result.error) throw result.error;
        account(result.data.session); return client;
      })();
      try { return await loading; } finally { loading = null; }
    }
    function account(next) {
      const sessionId = (value) => { try { return JSON.parse(atob(value.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id; } catch (_) { return null; } };
      const changed = session?.user?.id !== next?.user?.id || sessionId(session) !== sessionId(next);
      if (changed) { generation++; state = null; phase = "idle"; dirty = false; }
      session = next; render();
      if (session && showAfterLogin) {
        showAfterLogin = false; options.surfaces.open(dialog);
        const url = new URL(location.href); url.searchParams.delete("auth_complete"); history.replaceState(history.state, "", url);
        message(recovery ? "Nhập mật khẩu mới để khôi phục tài khoản." : "Đã xác nhận email. Bạn có thể bật đồng bộ cho máy này.");
      }
      if (changed && session && linked === session.user.id) schedule(100);
    }
    async function sync(resolution) {
      if (busy || recovery || !session || linked !== session.user.id) return;
      if (!navigator.onLine) { message("Đang offline · Thay đổi đã lưu trên máy và sẽ gửi khi có mạng.", "offline"); return; }
      const owner = session.user.id, token = generation;
      const guard = () => { if (token !== generation || session?.user?.id !== owner || linked !== owner) throw new Error("sync-cancelled"); };
      busy = true; syncing = true; render(); message("Đang đồng bộ…", "syncing");
      try {
        const run = async () => {
          guard(); await workspace.beforeSync(); guard(); state = (await saveJournal(owner)) || core.newState(owner); guard();
          paintStatus();
          if (state.owner !== owner) throw new Error("Nhật ký đồng bộ không khớp tài khoản.");
          if (resolution && state.conflicts[resolution.key]) {
            core.stage(state, core.readLocal(localStorage));
            const remote = state.conflicts[resolution.key];
            if (remote) {
              if (resolution.choice === "remote") { core.applyLocal(localStorage, { [resolution.key]: remote.value }, { [resolution.key]: state.pending[resolution.key]?.value }); options.onApplied(); }
              state.baseline[resolution.key] = remote; delete state.conflicts[resolution.key];
            }
          }
          const result = await core.synchronize(state, {
            read: () => { guard(); return core.readLocal(localStorage); },
            save: (value) => { guard(); return saveJournal(owner, value); },
            apply: (updates) => { guard(); if (core.applyLocal(localStorage, updates)) options.onApplied(); },
            pull: async () => {
              const rows = [];
              for (let offset = 0; ; offset += 500) {
                guard(); const response = await request(client.from("reader_sync_records").select("record_key,value,revision").eq("user_id", owner).order("record_key").range(offset, offset + 499));
                guard(); if (response.error) throw response.error; rows.push(...response.data);
                if (response.data.length < 500) return rows;
              }
            },
            push: async (changes) => { guard(); const response = await request(client.rpc("reader_sync_apply", { changes: changes.map((c) => ({ ...c, mutation_id: workspace.mutationId(c.key, c.value) })) })); guard(); if (response.error) throw response.error; return response.data; }
          });
          guard();
          await workspace.flush(); guard();
          await options.journal?.flush({ owner, client, guard, request: async (query) => { guard(); const result = await request(query); guard(); if (result.error) throw result.error; return result.data; } }); guard();
          dirty = result.pending > 0;
          message(result.conflicts ? "Có thay đổi trên cả hai máy. Chọn bản cần giữ bên dưới; các mục khác vẫn đồng bộ."
            : result.pending ? "Còn thay đổi chờ gửi · Sẽ thử lại tự động." : `Đã đồng bộ lúc ${new Date(state.lastCheckedAt).toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`, result.conflicts ? "conflict" : result.pending ? "pending" : "synced");
        };
        if (navigator.locks) await navigator.locks.request("ketruyen-reader-sync", { ifAvailable: true }, async (lock) => { if (lock) await run(); else message("Đang đồng bộ ở tab khác.", "pending"); });
        else await run();
      } catch (error) { workspace.report(error); if (!/device-revoked/.test(error?.message || "")) failure(error); }
      finally { busy = false; syncing = false; render(); }
    }
    async function request(query) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
      try { const result = await query.abortSignal(controller.signal); if (controller.signal.aborted) throw new Error("sync-timeout"); return result; }
      finally { clearTimeout(timeout); }
    }
    async function exclusive(action) {
      if (busy) throw new Error("Đang đồng bộ. Đợi kiểm tra hoàn tất rồi thử lại.");
      busy = true; render();
      try { return navigator.locks ? await navigator.locks.request("ketruyen-reader-sync", action) : await action(); }
      finally { busy = false; render(); schedule(); }
    }
    function schedule(delay = 1000) { clearTimeout(timer); timer = setTimeout(() => sync(), delay); }
    function changed() {
      if (session && linked === session.user.id && !syncing && !recovery) { dirty = true; message("Thay đổi đã lưu trên máy. Đang chờ kiểm tra với đám mây.", "pending"); }
      schedule();
    }
    async function open() {
      document.querySelector("#shelf-more")?.removeAttribute("open");
      options.closeSettings(); options.surfaces.open(dialog);
      if (!session || linked !== session.user.id) message(recovery ? "Nhập mật khẩu mới để khôi phục tài khoản." : "Đăng nhập cùng một tài khoản trên các máy để đọc tiếp.", "idle");
      render();
      try { await setup(); render(); transfers.refresh(); if (session && linked === session.user.id) schedule(0); } catch (error) { failure(error); }
    }
    document.querySelectorAll("[data-open-sync]").forEach((button) => button.onclick = open);
    $("sync-close").onclick = () => options.surfaces.close(dialog);
    function passwordValid(input) {
      input.setCustomValidity(input.value.length < 8 ? "Mật khẩu cần ít nhất 8 ký tự." : new TextEncoder().encode(input.value).length > 72 ? "Mật khẩu dài quá giới hạn 72 byte." : "");
      return input.reportValidity();
    }
    $("sync-password").oninput = () => $("sync-password").setCustomValidity("");
    $("sync-new-password").oninput = () => $("sync-new-password").setCustomValidity("");
    $("sync-login").onsubmit = async (event) => {
      event.preventDefault(); busy = true; message("Đang đăng nhập…", "working"); render();
      try {
        await setup();
        const { data, error } = await client.auth.signInWithPassword({ email: $("sync-email").value.trim(), password: $("sync-password").value });
        if (error) throw error; $("sync-password").value = ""; account(data.session);
        message("Đã đăng nhập. Bật đồng bộ cho máy này để đọc tiếp.", "idle");
      } catch (error) { failure(error); } finally { busy = false; render(); }
    };
    $("sync-signup").onclick = async () => {
      if (!$("sync-login").reportValidity() || !passwordValid($("sync-password"))) return;
      busy = true; message("Đang tạo tài khoản…", "working"); render();
      try {
        await setup();
        const { data, error } = await client.auth.signUp({ email: $("sync-email").value.trim(), password: $("sync-password").value, options: { emailRedirectTo: location.origin + "/sync-auth.html" } });
        if (error) throw error; $("sync-password").value = "";
        if (data.session) { account(data.session); message("Đã tạo tài khoản. Bạn có thể bật đồng bộ.", "idle"); }
        else message("Đã gửi email xác nhận đăng ký. Xác nhận email rồi đăng nhập bằng mật khẩu vừa tạo.", "idle");
      } catch (error) { failure(error); } finally { busy = false; render(); }
    };
    $("sync-forgot").onclick = async () => {
      if (!$("sync-email").reportValidity()) return;
      busy = true; message("Đang gửi yêu cầu khôi phục…", "working"); render();
      try { await setup(); const { error } = await client.auth.resetPasswordForEmail($("sync-email").value.trim(), { redirectTo: location.origin + "/sync-auth.html" }); if (error) throw error; message("Nếu email có tài khoản, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu.", "idle"); }
      catch (error) { failure(error); } finally { busy = false; render(); }
    };
    $("sync-reset").onsubmit = async (event) => {
      event.preventDefault(); if (!passwordValid($("sync-new-password"))) return;
      if ($("sync-new-password").value !== $("sync-confirm-password").value) { message("Hai mật khẩu chưa khớp."); return; }
      busy = true; message("Đang lưu mật khẩu mới…", "working"); render();
      try {
        const { error } = await client.auth.updateUser({ password: $("sync-new-password").value }); if (error) throw error;
        $("sync-new-password").value = $("sync-confirm-password").value = ""; recovery = false; sessionStorage.removeItem("ketruyen-password-recovery");
        message("Đã đổi mật khẩu. Bạn có thể bật đồng bộ hoặc đăng nhập trên máy khác.", "idle");
      } catch (error) { failure(error); } finally { busy = false; render(); }
    };
    $("sync-connect").onclick = () => { linked = session.user.id; generation++; localStorage.setItem(core.LINK_KEY, linked); sync(); };
    $("sync-now").onclick = () => sync();
    $("shelf-sync-review").onclick = () => open();
    $("sync-signout").onclick = async () => {
      generation++; linked = ""; localStorage.removeItem(core.LINK_KEY); clearTimeout(timer); render();
      try { const { error } = await client.auth.signOut({ scope: "local" }); if (error) throw error; session = null; recovery = false; dirty = false; sessionStorage.removeItem("ketruyen-password-recovery"); message("Đã đăng xuất. Bản đọc trên máy vẫn được giữ.", "idle"); }
      catch (error) { failure(error); } finally { render(); }
    };
    addEventListener("ketruyen-library-change", changed);
    addEventListener("ketruyen-journal-change", changed);
    addEventListener("ketruyen-workspace-change", () => schedule());
    addEventListener("storage", (event) => { if (event.key?.startsWith("tenshi-")) { options.onApplied(); changed(); } });
    addEventListener("online", () => { if (session && linked === session.user.id) message("Đã có mạng · Đang chờ kiểm tra lại dữ liệu.", "pending"); else paintStatus(); schedule(0); });
    addEventListener("offline", () => message("Thay đổi vẫn lưu trên máy và sẽ gửi khi có mạng trở lại.", "offline"));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(0); });
    setInterval(() => { if (document.visibilityState === "visible") sync(); }, 20000);
    if (localStorage.getItem(core.AUTH_KEY) || showAfterLogin) setup().catch(failure);
    paintStatus();
    options.journal?.connect({ schedule, exclusive });
    return { open, sync };
  }
  root.CloudSync = { create };
})(globalThis);
