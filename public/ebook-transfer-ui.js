(function (root) {
  "use strict";
  function create(options) {
    const core = root.EbookTransfer, $ = (id) => document.getElementById(id);
    const panel = $("ebook-transfer-panel"), status = $("ebook-transfer-status"), list = $("ebook-transfer-list");
    let context = null, generation = 0, busy = false, refreshing = false, rows = [];
    let devices = null, offered = null, autoTimer, autoAvailable = null;
    let inventorySnapshot = [], transferSnapshot = [], historyDevices = [], checkedAt = 0, labelsSent = "", labelsAvailable = true;
    const healthErrors = new Map(), healthChanged = () => dispatchEvent(new Event("ketruyen-library-health"));
    const autoPanel = $("ebook-auto-panel"), autoEnabled = $("ebook-auto-enabled"), autoStatus = $("ebook-auto-status"), retryAfter = new Map();
    try { autoEnabled.checked = localStorage.getItem("ketruyen-auto-ebook-v1") !== "off"; } catch (_) {}
    const receiver = document.createElement("select"); receiver.id = "ebook-transfer-recipient"; receiver.setAttribute("aria-label", "Thiết bị nhận ebook"); receiver.hidden = true; $("ebook-transfer-book").after(receiver);
    let device;
    try { device = localStorage.getItem("ketruyen-transfer-device-v1"); } catch (_) {}
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(device || "")) {
      device = crypto.randomUUID();
      try { localStorage.setItem("ketruyen-transfer-device-v1", device); } catch (_) {}
    }
    const report = (text) => { status.textContent = text; };
    function setContext(next) {
      if (context?.owner !== next?.owner || context?.sessionKey !== next?.sessionKey) { generation++; context = next; rows = []; inventorySnapshot = []; transferSnapshot = []; checkedAt = 0; labelsSent = ""; labelsAvailable = true; healthErrors.clear(); autoAvailable = null; retryAfter.clear(); clearTimeout(autoTimer); list.replaceChildren(); report(""); autoStatus.textContent = ""; $("ebook-transfer-open").hidden = true; healthChanged(); }
      else context = next;
      panel.hidden = !context;
      autoPanel.hidden = !context;
    }
    function io() {
      const own = context, token = generation;
      const guard = () => { if (!own || token !== generation || context?.owner !== own.owner || context?.sessionKey !== own.sessionKey) throw new Error("transfer-cancelled"); };
      // A timed-out upload may finish server-side; its reserved metadata lets
      // the scheduled cleanup find it even if the browser has gone away.
      const request = async (query) => {
        guard(); let timer;
        try {
          const result = await Promise.race([query, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Máy chủ phản hồi chậm. Kiểm tra lại danh sách trước khi thử lại.")), 120000); })]);
          guard(); if (result.error) throw result.error; return result.data;
        } finally { clearTimeout(timer); }
      };
      const storage = own?.client.storage.from(core.BUCKET);
      return { owner: own?.owner, client: own?.client, guard, request,
        report: (text) => { guard(); report(text); },
        download: (path) => request(storage.download(path)),
        unpack: (blob) => root.LibraryBackup.readBackup(blob, () => {}, { maxFile: core.MAX_FILE, maxExpanded: core.MAX_EXPANDED, maxBooks: 1 }),
        get: (slug) => root.EbookImport.get(slug), save: (book) => root.EbookImport.save(book),
        onSaved: async (slug) => {
          await options.onReceived(slug); guard();
          $("ebook-transfer-open").href = `/truyen/${slug}`; $("ebook-transfer-open").hidden = false;
        },
        confirm: async (id) => { await request(own.client.rpc("reader_ebook_received", { transfer_id: id })); const row = transferSnapshot.find((r) => r.id === id); if (row) row.received_at = new Date().toISOString(); },
        remove: async (path) => {
          await request(storage.remove([path]));
          // RPC forget verifies actual absence, including when Storage returns
          // an empty success after RLS has filtered an inaccessible object.
        },
        forget: async (id) => { await request(own.client.rpc("reader_ebook_forget", { transfer_id: id })); transferSnapshot = transferSnapshot.filter((r) => r.id !== id); healthErrors.delete(id); healthChanged(); }
      };
    }
    function paint() {
      $("ebook-transfer-send").disabled = busy || !$("ebook-transfer-book").value || (devices !== null && !receiver.value);
      $("ebook-transfer-refresh").disabled = busy || refreshing;
      panel.setAttribute("aria-busy", String(busy));
      autoPanel.setAttribute("aria-busy", String(busy)); $("ebook-auto-retry").disabled = busy;
      $("ebook-transfer-progress").hidden = !busy;
      list.replaceChildren();
      for (const row of rows) {
        const expired = Date.parse(row.expires_at) <= Date.now(), sent = row.sender_device === device;
        const item = document.createElement("div"); item.className = "ebook-transfer-item";
        const copy = document.createElement("div"), title = document.createElement("strong"), hint = document.createElement("p");
        title.textContent = row.title;
        const size = row.bytes < 0.1 * 1024 * 1024 ? "< 0,1" : (row.bytes / 1024 / 1024).toLocaleString("vi", { maximumFractionDigits: 1 });
        hint.textContent = `${size} MB · ${row.received_at ? "Đã nhận · Chờ xóa bản tạm" : expired ? "Đã hết hạn" : !row.ready ? "Tải lên chưa hoàn tất" : sent ? "Chờ máy khác nhận" : `Nhận trước ${new Date(row.expires_at).toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit" })}`}`;
        copy.append(title, hint); item.append(copy);
        if (!sent && !expired && row.ready && !row.received_at) {
          const receive = document.createElement("button"); receive.type = "button"; receive.className = "btn-primary"; receive.textContent = "Nhận sách"; receive.disabled = busy;
          receive.onclick = () => run(async (api) => {
            const result = await core.receive(row, api); api.guard();
            report(result.existing ? "Sách đã có trên máy. Đã xóa bản tạm trên bucket." : "Đã thêm sách vào thư viện và xóa bản tạm trên bucket.");
          }); item.append(receive);
        }
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn-link"; remove.textContent = row.received_at || expired || !row.ready ? "Xóa bản tạm" : sent ? "Hủy gửi" : "Từ chối"; remove.disabled = busy;
        remove.onclick = () => run(async (api) => { await core.cleanup(row, api); report("Đã xóa bản tạm trên bucket. Sách trên thiết bị vẫn được giữ."); }); item.append(remove);
        list.append(item);
      }
      if (!rows.length) { const empty = document.createElement("p"); empty.className = "sync-copy"; empty.textContent = "Chưa có sách chờ chuyển."; list.append(empty); }
    }
    function failure(error) {
      if (error?.message === "transfer-cancelled") return;
      if (error?.code === "PGRST205" || error?.code === "PGRST202" || error?.message?.includes("Bucket not found")) report("Chưa thiết lập chuyển ebook trên Supabase. Cần chạy migration ebook_transfers.");
      else report(`${error?.message || "Chưa chuyển được sách."} Nếu đã lưu sách, bạn có thể bấm Xóa bản tạm để dọn bucket.`);
    }
    async function refresh() {
      if (!context || busy || refreshing || !panel.open || !$("sync-dialog").open || !navigator.onLine) return;
      refreshing = true; const api = io(); paint();
      try {
        const data = await api.request(api.client.from("reader_ebook_transfers").select("*").eq("user_id", api.owner).order("created_at", { ascending: false }).limit(100));
        api.guard(); rows = data.filter((r) => !r.recipient_device || r.sender_device === device || r.recipient_device === device);
        transferSnapshot = rows; checkedAt = Date.now(); healthChanged();
        const books = await root.EbookImport.list(); api.guard();
        const select = $("ebook-transfer-book"), chosen = select.value; select.replaceChildren();
        for (const book of books) { const option = document.createElement("option"); option.value = book.slug; option.textContent = book.titleVi; select.append(option); }
        if (books.some((book) => book.slug === chosen)) select.value = chosen;
        select.hidden = !books.length;
        $("ebook-transfer-book-label").hidden = !books.length;
        $("ebook-transfer-send").hidden = !books.length;
        $("ebook-transfer-empty").hidden = Boolean(books.length);
      } catch (error) { if (context?.owner === api.owner) failure(error); }
      finally { refreshing = false; paint(); }
    }
    async function run(action, propagate = false) {
      if (busy || !context) return;
      busy = true; const api = io(); paint();
      try { await action(api); } catch (error) { if (context?.owner === api.owner) failure(error); if (propagate) throw error; }
      finally { busy = false; paint(); healthChanged(); if (context?.owner === api.owner) await refresh(); }
    }
    async function send(api, slug, target, automatic = false) {
      if (devices !== null && !target) throw new Error("Chọn thiết bị nhận trước khi gửi."); api.report("Đang đóng gói sách…");
      const book = await root.EbookImport.get(slug); api.guard();
      if (!book) throw new Error("Sách không còn trên máy này.");
      // Reuse the validated backup format with exactly one book and no settings
      // or credentials. Rich text, covers and TXT chapter edits travel together.
      const blob = await root.LibraryBackup.exportData(api.report, [book]); api.guard();
      if (blob.size > core.MAX_FILE) throw new Error("Gói sách vượt quá 50 MB. Hãy dùng bản sao lưu để chuyển tệp lớn.");
      root.EbookImport.inspectArchive(new Uint8Array(await blob.arrayBuffer()), core.MAX_EXPANDED, 20000); api.guard();
      const sha256 = await core.digest(blob); api.guard();
      const id = automatic ? await api.request(api.client.rpc("reader_ebook_auto_reserve", { book: slug, label: book.titleVi.slice(0, 250), size: blob.size, digest: sha256, target })) : crypto.randomUUID();
      if (!id) return false;
      const path = core.objectPath(api.owner, id);
      if (!automatic) await api.request(api.client.from("reader_ebook_transfers").insert({ id, sender_device: device, slug, title: book.titleVi.slice(0, 250), bytes: blob.size, sha256, ...(devices !== null ? { recipient_device: target } : {}) }));
      api.report("Đang tải sách lên bucket tạm…");
      try {
        const payload = await blob.arrayBuffer(); api.guard();
        await api.request(api.client.storage.from(core.BUCKET).upload(path, payload, { contentType: "application/zip", cacheControl: "0", upsert: false }));
        const ready = await api.request(api.client.from("reader_ebook_transfers").update({ ready: true }).eq("id", id).select("id"));
        if (!ready?.length) throw new Error("Phiên chuyển sách không còn. Hãy gửi lại.");
      } catch (error) {
        // Keep timed-out uploads reserved: the request may still finish remotely.
        if (automatic && error.message !== "transfer-cancelled" && !error.message?.includes("phản hồi chậm")) {
          try { await core.cleanup({ id, user_id: api.owner, slug, sha256, bytes: blob.size }, api); } catch (_) {}
        }
        throw error;
      }
      if (offered && offered.slug === slug && offered.target === target) { await api.request(api.client.from("reader_book_requests").update({ resolved: true }).eq("id", offered.id)); offered = null; }
      healthErrors.delete(target + "/" + slug);
      api.report(automatic ? "Đã tải lên · Đang chờ máy nhận tự lưu ebook…" : "Đã tải lên. Mở Đồng bộ → Chuyển ebook trên máy khác để nhận trong 30 phút.");
      return true;
    }
    $("ebook-transfer-send").onclick = () => run((api) => send(api, $("ebook-transfer-book").value, receiver.value));

    const ignoredBooks = () => { try { return JSON.parse(localStorage.getItem("ketruyen-ebook-ignored-v1") || "[]").filter((s) => /^ebook-[a-f\d]{24}$/.test(s)); } catch (_) { return []; } };
    function scheduleAuto(delay = 1000) {
      clearTimeout(autoTimer);
      if (context && devices !== null && autoAvailable !== false) autoTimer = setTimeout(autoSync, delay);
    }
    async function autoSync() {
      if (!context || devices === null || document.hidden || !navigator.onLine || autoAvailable === false) return;
      if (busy || refreshing) { scheduleAuto(3000); return; }
      const perform = async () => {
        busy = true; const api = io(); api.report = (text) => { api.guard(); autoStatus.textContent = text; }; api.report("Đang kiểm tra ebook giữa các máy…"); paint();
        try {
          let books = await root.EbookImport.list(); api.guard();
          await api.request(api.client.rpc("reader_ebook_inventory_set", { books: books.map((b) => b.slug), excluded_books: ignoredBooks(), active: autoEnabled.checked }));
          if (labelsAvailable) {
            const labels = Object.fromEntries(books.map((b) => [b.slug, { title: b.titleVi.slice(0, 250), author: String(b.author || "").slice(0, 150) }])), serial = JSON.stringify(labels);
            if (serial !== labelsSent) try { await api.request(api.client.rpc("reader_ebook_inventory_labels", { titles: labels })); labelsSent = serial; }
            catch (error) { api.guard(); if (["PGRST202", "PGRST205", "42P01"].includes(error.code)) labelsAvailable = false; else throw error; }
          }
          autoAvailable = true;
          if (!autoEnabled.checked) {
            inventorySnapshot = await api.request(api.client.from("reader_ebook_inventory").select("*").eq("user_id", api.owner).limit(500));
            transferSnapshot = await api.request(api.client.from("reader_ebook_transfers").select("*").eq("user_id", api.owner).order("created_at", { ascending: false }).limit(100)); checkedAt = Date.now();
            api.report("Đã tạm dừng tự đồng bộ trên máy này. Bạn vẫn có thể gửi và nhận thủ công."); return;
          }
          const incoming = await api.request(api.client.from("reader_ebook_transfers").select("*").eq("user_id", api.owner).order("created_at", { ascending: false }).limit(100));
          transferSnapshot = incoming; checkedAt = Date.now();
          let received = 0, sent = 0, failed = false;
          for (const row of incoming) {
            if (row.recipient_device !== device || !row.automatic || !row.ready || Date.parse(row.expires_at) <= Date.now() || (retryAfter.get(row.id) || 0) > Date.now()) continue;
            try {
              if (row.received_at || ignoredBooks().includes(row.slug)) await core.cleanup(row, api);
              else { await core.receive(row, { ...api, guard: () => { api.guard(); if (ignoredBooks().includes(row.slug)) throw new Error("Sách vừa được xóa khỏi máy này."); } }); received++; }
            } catch (error) { api.guard(); retryAfter.set(row.id, Date.now() + 60000); healthErrors.set(row.id, { slug: row.slug, message: error.message || "Chưa nhận được ebook.", at: Date.now() }); failed = true; api.report(`Chưa tự nhận được ebook: ${error.message || "Kiểm tra kết nối hoặc dung lượng máy."} Sẽ thử lại sau.`); }
          }
          books = await root.EbookImport.list(); api.guard();
          const inventory = await api.request(api.client.from("reader_ebook_inventory").select("*").eq("user_id", api.owner).limit(500));
          inventorySnapshot = inventory;
          const online = new Set(devices.filter((d) => !d.revoked_at && d.online).map((d) => d.device_id));
          books.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
          for (const target of inventory) {
            if (target.device_id === device || !target.enabled || !online.has(target.device_id)) continue;
            for (const book of books) {
              api.guard(); if (!autoEnabled.checked) break;
              const key = target.device_id + "/" + book.slug;
              if (sent >= 4 || target.slugs.includes(book.slug) || target.ignored.includes(book.slug) || incoming.some((r) => r.recipient_device === target.device_id && r.slug === book.slug && !r.received_at) || (retryAfter.get(key) || 0) > Date.now()) continue;
              try { if (await send(api, book.slug, target.device_id, true)) sent++; }
              catch (error) { api.guard(); retryAfter.set(key, Date.now() + 60000); healthErrors.set(key, { slug: book.slug, message: error.message || "Chưa gửi được ebook.", at: Date.now() }); failed = true; api.report(`Chưa tự gửi được ebook: ${error.message || "Kiểm tra kết nối."} Sẽ thử lại sau.`); }
            }
          }
          const waiting = incoming.filter((r) => r.automatic && r.sender_device === device && !r.received_at && Date.parse(r.expires_at) > Date.now()).length;
          if (!failed) api.report(sent || received ? `Đã nhận ${received} ebook · Đã gửi ${sent} ebook. Bản tạm được xóa khi máy nhận lưu xong.` : waiting ? `${waiting} ebook đang chờ máy nhận lưu. Sẽ tự kiểm tra lại.` : online.size ? "Ebook đã khớp với các máy đang mở." : "Sẵn sàng · Mở ứng dụng trên máy khác để tự đồng bộ ebook.");
        } catch (error) {
          if (error.message !== "transfer-cancelled" && context?.owner === api.owner) {
            if (["PGRST202", "PGRST205", "42P01"].includes(error.code)) { autoAvailable = false; autoStatus.textContent = "Cần chạy migration 0005 để bật tự đồng bộ ebook. Chuyển thủ công vẫn dùng được."; }
            else autoStatus.textContent = `Chưa kiểm tra được ebook: ${error.message || "Kiểm tra kết nối."}`;
          }
        } finally { busy = false; paint(); healthChanged(); scheduleAuto(20000); }
      };
      try {
        if (navigator.locks) await navigator.locks.request("ketruyen-ebook-auto", { ifAvailable: true }, (lock) => lock ? perform() : scheduleAuto(20000));
        else await perform();
      } catch (_) { scheduleAuto(20000); }
    }
    autoEnabled.onchange = () => { try { localStorage.setItem("ketruyen-auto-ebook-v1", autoEnabled.checked ? "on" : "off"); } catch (_) {} scheduleAuto(0); };
    $("ebook-auto-retry").onclick = () => { autoAvailable = null; retryAfter.clear(); scheduleAuto(0); };
    addEventListener("ketruyen-ebooks-change", () => scheduleAuto());
    addEventListener("storage", (e) => { if (e.key === "ketruyen-ebooks-change-v1") scheduleAuto(); if (e.key === "ketruyen-auto-ebook-v1") { autoEnabled.checked = e.newValue !== "off"; scheduleAuto(); } });
    addEventListener("online", () => scheduleAuto());
    document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleAuto(); });
    $("ebook-transfer-book").onchange = paint;
    $("ebook-transfer-refresh").onclick = refresh;
    panel.addEventListener("toggle", () => { if (panel.open) refresh(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    addEventListener("online", refresh);
    setInterval(refresh, 10000);
    receiver.onchange = paint;
    function setDevices(rows, allRows = rows) {
      historyDevices = allRows || [];
      devices = rows === null ? null : [...new Map(rows.map((d) => [d.device_id, d])).values()];
      const chosen = receiver.value; receiver.replaceChildren(); receiver.hidden = devices === null;
      if (devices) {
        const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Chọn máy nhận (online hoặc offline)"; receiver.append(placeholder);
        for (const d of devices) { const option = document.createElement("option"); option.value = d.device_id; option.textContent = d.name; receiver.append(option); }
        if (devices.some((d) => d.device_id === chosen)) receiver.value = chosen;
      }
      paint();
      scheduleAuto();
    }
    return { setContext, refresh, setDevices,
      snapshot: () => ({ connected: Boolean(context), device, devices: historyDevices, inventory: inventorySnapshot, transfers: transferSnapshot, checkedAt, errors: [...healthErrors.values()], checking: busy || refreshing, message: autoStatus.textContent }),
      async check() { autoAvailable = null; labelsAvailable = true; retryAfter.clear(); await autoSync(); await refresh(); },
      async receive(id) { const row = transferSnapshot.find((r) => r.id === id); if (!row || busy) throw new Error("Đợi lượt chuyển hiện tại hoàn tất rồi kiểm tra lại."); try { await run((api) => core.receive(row, api), true); } catch (error) { healthErrors.set(id, { slug: row.slug, message: error.message, at: Date.now() }); healthChanged(); throw error; } },
      async offer(slug, target, id) { panel.open = true; await refresh(); $("ebook-transfer-book").value = slug; receiver.value = target; offered = { slug, target, id }; paint(); $("ebook-transfer-send").focus(); report("Kiểm tra sách và máy nhận, rồi bấm Gửi sách để xác nhận."); } };
  }
  root.EbookTransferUI = { create };
})(globalThis);
