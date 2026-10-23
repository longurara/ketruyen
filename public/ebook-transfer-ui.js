(function (root) {
  "use strict";
  function create(options) {
    const core = root.EbookTransfer, $ = (id) => document.getElementById(id);
    const panel = $("ebook-transfer-panel"), status = $("ebook-transfer-status"), list = $("ebook-transfer-list");
    let context = null, generation = 0, busy = false, refreshing = false, rows = [];
    let device;
    try { device = localStorage.getItem("ketruyen-transfer-device-v1"); } catch (_) {}
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(device || "")) {
      device = crypto.randomUUID();
      try { localStorage.setItem("ketruyen-transfer-device-v1", device); } catch (_) {}
    }
    const report = (text) => { status.textContent = text; };
    function setContext(next) {
      if (context?.owner !== next?.owner) { generation++; context = next; rows = []; list.replaceChildren(); report(""); $("ebook-transfer-open").hidden = true; }
      else context = next;
      panel.hidden = !context;
    }
    function io() {
      const own = context, token = generation;
      const guard = () => { if (!own || token !== generation || context?.owner !== own.owner) throw new Error("transfer-cancelled"); };
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
        confirm: (id) => request(own.client.rpc("reader_ebook_received", { transfer_id: id })),
        remove: async (path) => {
          await request(storage.remove([path]));
          // RPC forget verifies actual absence, including when Storage returns
          // an empty success after RLS has filtered an inaccessible object.
        },
        forget: (id) => request(own.client.rpc("reader_ebook_forget", { transfer_id: id }))
      };
    }
    function paint() {
      $("ebook-transfer-send").disabled = busy || !$("ebook-transfer-book").value;
      $("ebook-transfer-refresh").disabled = busy || refreshing;
      panel.setAttribute("aria-busy", String(busy));
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
        const data = await api.request(api.client.from("reader_ebook_transfers").select("id,user_id,sender_device,slug,title,bytes,sha256,ready,expires_at,received_at").eq("user_id", api.owner).order("created_at", { ascending: false }).limit(100));
        api.guard(); rows = data;
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
    async function run(action) {
      if (busy || !context) return;
      busy = true; const api = io(); paint();
      try { await action(api); } catch (error) { if (context?.owner === api.owner) failure(error); }
      finally { busy = false; paint(); if (context?.owner === api.owner) await refresh(); }
    }
    $("ebook-transfer-send").onclick = () => run(async (api) => {
      const slug = $("ebook-transfer-book").value; api.report("Đang đóng gói sách…");
      const book = await root.EbookImport.get(slug); api.guard();
      if (!book) throw new Error("Sách không còn trên máy này.");
      // Reuse the validated backup format with exactly one book and no settings
      // or credentials. Rich text, covers and TXT chapter edits travel together.
      const blob = await root.LibraryBackup.exportData(api.report, [book]); api.guard();
      if (blob.size > core.MAX_FILE) throw new Error("Gói sách vượt quá 50 MB. Hãy dùng bản sao lưu để chuyển tệp lớn.");
      root.EbookImport.inspectArchive(new Uint8Array(await blob.arrayBuffer()), core.MAX_EXPANDED, 20000); api.guard();
      const sha256 = await core.digest(blob); api.guard();
      const id = crypto.randomUUID(), path = core.objectPath(api.owner, id);
      await api.request(api.client.from("reader_ebook_transfers").insert({ id, sender_device: device, slug, title: book.titleVi.slice(0, 250), bytes: blob.size, sha256 }));
      api.report("Đang tải sách lên bucket tạm…");
      const payload = await blob.arrayBuffer(); api.guard();
      await api.request(api.client.storage.from(core.BUCKET).upload(path, payload, { contentType: "application/zip", cacheControl: "0", upsert: false }));
      const ready = await api.request(api.client.from("reader_ebook_transfers").update({ ready: true }).eq("id", id).select("id"));
      if (!ready?.length) throw new Error("Phiên chuyển sách không còn. Hãy gửi lại.");
      api.report("Đã tải lên. Mở Đồng bộ → Chuyển ebook trên máy khác để nhận trong 30 phút.");
    });
    $("ebook-transfer-book").onchange = paint;
    $("ebook-transfer-refresh").onclick = refresh;
    panel.addEventListener("toggle", () => { if (panel.open) refresh(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    addEventListener("online", refresh);
    setInterval(refresh, 10000);
    return { setContext, refresh };
  }
  root.EbookTransferUI = { create };
})(globalThis);
