// Exercise the real SDK + archive + IndexedDB across isolated browser devices.
// All Supabase HTTP is mocked: no live account, bucket or email is changed.
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { authSession } = require("./sync");
async function runEbookTransferChecks(browser, base, automatic = false) {
  const contexts = [], registry = new Map(), rows = new Map(), files = new Map(), receipts = [], inventory = new Map(), uploads = [];
  let failDelete = false, corruptDownload = false;
  async function device(mobile = false) {
    const session = authSession(), sid = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url")).session_id;
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 900 }, serviceWorkers: "block" }); contexts.push(context);
    await context.routeWebSocket("wss://*.supabase.co/**", (ws) => ws.close());
    await context.route("https://*.supabase.co/**", async (route) => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const body = request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : null;
      if (url.pathname.endsWith("/reader_journal_records") || url.pathname.endsWith("/rpc/reader_ebook_inventory_labels")) return route.fulfill({ status: 404, json: { code: "PGRST205", message: "Additive journal migration not installed in legacy fixture" } });
      if (url.pathname.endsWith("/user")) return route.fulfill({ json: session.user });
      if (url.pathname.endsWith("/rpc/reader_device_register")) { const d = registry.get(sid) || { user_id: session.user.id, session_id: sid, device_id: body.installation, name: mobile ? "Điện thoại nhận" : "Máy gửi", last_seen: new Date().toISOString() }; registry.set(sid, d); return route.fulfill({ json: { ...d, server_time: new Date().toISOString() } }); }
      if (url.pathname.endsWith("/rpc/reader_require_device")) return route.fulfill({ json: null });
      if (url.pathname.endsWith("/rpc/reader_device_touch")) return route.fulfill({ json: new Date().toISOString() });
      if (automatic && url.pathname.endsWith("/rpc/reader_ebook_inventory_set")) {
        const id = registry.get(sid).device_id; inventory.set(id, { device_id: id, slugs: body.books, ignored: body.excluded_books, enabled: body.active }); return route.fulfill({ json: null });
      }
      if (automatic && url.pathname.endsWith("/reader_ebook_inventory")) return route.fulfill({ json: [...inventory.values()] });
      if (automatic && url.pathname.endsWith("/rpc/reader_ebook_auto_reserve")) {
        const target = inventory.get(body.target), duplicate = [...rows.values()].some((r) => r.slug === body.book && r.recipient_device === body.target && !r.received_at);
        if (!target?.enabled || target.slugs.includes(body.book) || target.ignored.includes(body.book) || duplicate) return route.fulfill({ json: null });
        const id = randomUUID(); rows.set(id, { id, user_id: session.user.id, sender_device: registry.get(sid).device_id, recipient_device: body.target, slug: body.book, title: body.label, bytes: body.size, sha256: body.digest, automatic: true, ready: false, received_at: null, expires_at: new Date(Date.now() + 1800000).toISOString() }); return route.fulfill({ json: id });
      }
      if (url.pathname.endsWith("/reader_devices")) return route.fulfill({ json: [...registry.values()] });
      if (url.pathname.endsWith("/reader_workspace_meta")) return route.fulfill({ json: null });
      if (["reader_activity", "reader_note_versions", "reader_note_purges", "reader_book_requests"].some((name) => url.pathname.endsWith("/" + name))) return route.fulfill({ json: [] });
      if (url.pathname.endsWith("/reader_sync_records")) return route.fulfill({ json: [] });
      if (url.pathname.endsWith("/rpc/reader_sync_apply")) return route.fulfill({ json: body.changes.map((r) => ({ record_key: r.key, value: r.value, revision: 1, applied: true })) });
      if (url.pathname.endsWith("/reader_ebook_transfers")) {
        if (method === "POST") { rows.set(body.id, { ...body, user_id: session.user.id, ready: false, received_at: null, expires_at: new Date(Date.now() + 1800000).toISOString() }); return route.fulfill({ status: 201, json: null }); }
        if (method === "PATCH") { const id = url.searchParams.get("id").slice(3); Object.assign(rows.get(id), body); return route.fulfill({ json: [{ id }] }); }
        return route.fulfill({ json: [...rows.values()].filter((r) => r.sender_device === registry.get(sid)?.device_id || r.recipient_device === registry.get(sid)?.device_id) });
      }
      if (url.pathname.endsWith("/rpc/reader_ebook_received")) { receipts.push(body.transfer_id); const row = rows.get(body.transfer_id); row.received_at = new Date().toISOString(); if (automatic) { const own = inventory.get(registry.get(sid).device_id); if (!own.slugs.includes(row.slug)) own.slugs.push(row.slug); } return route.fulfill({ json: null }); }
      if (url.pathname.endsWith("/rpc/reader_ebook_forget")) {
        const key = `${session.user.id}/${body.transfer_id}/book.zip`;
        if (files.has(key)) return route.fulfill({ status: 403, json: { code: "42501", message: "Remove the temporary object first" } });
        rows.delete(body.transfer_id); return route.fulfill({ json: null });
      }
      const prefix = "/storage/v1/object/ebook-transfers/", download = "/storage/v1/object/authenticated/ebook-transfers/";
      if (method === "POST" && url.pathname.startsWith(prefix)) {
        const key = decodeURIComponent(url.pathname.slice(prefix.length)); files.set(key, request.postDataBuffer()); uploads.push(key);
        return route.fulfill({ json: { Key: "ebook-transfers/" + key, Id: "fixture" } });
      }
      if (method === "GET" && (url.pathname.startsWith(download) || url.pathname.startsWith(prefix))) {
        const data = files.get(decodeURIComponent(url.pathname.slice(url.pathname.startsWith(download) ? download.length : prefix.length)));
        return data ? route.fulfill({ body: corruptDownload ? Buffer.from("truncated") : data, contentType: "application/zip" }) : route.fulfill({ status: 404, json: { message: "not found" } });
      }
      if (method === "DELETE" && url.pathname.endsWith("/object/ebook-transfers")) {
        if (failDelete) { failDelete = false; return route.fulfill({ status: 503, json: { message: "Fixture delete failed" } }); }
        for (const key of body.prefixes) files.delete(key);
        return route.fulfill({ json: body.prefixes.map((name) => ({ name })) });
      }
      if (url.pathname.endsWith("/rpc/reader_ebook_inventory_set")) return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Legacy fixture" } });
      return route.abort();
    });
    await context.addInitScript((session) => { localStorage.setItem("ketruyen-auth-v1", JSON.stringify(session)); localStorage.setItem("ketruyen-sync-link-v1", session.user.id); }, session);
    const page = await context.newPage(), errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base); await page.waitForSelector(".ebook-shelf-item"); await page.click("#btn-sync");
    await page.waitForSelector("#ebook-transfer-panel:not([hidden])");
    await page.click("#ebook-transfer-panel summary");
    await page.waitForFunction(() => !document.getElementById("ebook-transfer-refresh").disabled);
    await page.waitForSelector('#sync-feedback[data-sync-state="synced"]');
    return { page, context, errors, device: registry.get(sid).device_id };
  }
  const finished = (page) => page.waitForFunction(() => document.getElementById("ebook-transfer-panel").getAttribute("aria-busy") === "false" && !document.getElementById("ebook-transfer-refresh").disabled);
  try {
    const a = await device(), b = await device(true);
    if (automatic) {
      await a.page.click("#sync-close"); await b.page.click("#sync-close");
      const importBook = (page, title) => page.evaluate(async (title) => {
        const book = await globalThis.EbookImport.parseFile(new File(["Chương 1\n\n" + title + "\n\nNội dung ebook tự đồng bộ."], title + ".txt", { type: "text/plain" }));
        book.titleVi = title; await globalThis.EbookImport.save(book); return book.slug;
      }, title);
      const hasBook = async (page, slug) => {
        const until = Date.now() + 35000;
        while (Date.now() < until) { if (await page.evaluate(async (slug) => Boolean(await globalThis.EbookImport.get(slug)), slug)) return; await new Promise((r) => setTimeout(r, 150)); }
        assert.fail("Ebook did not arrive: " + await page.textContent("#ebook-auto-status"));
      };
      const first = await importBook(a.page, "Tự chuyển từ A");
      await hasBook(b.page, first);
      await b.page.waitForFunction(() => document.getElementById("ebook-transfer-panel").getAttribute("aria-busy") === "false");
      assert.equal(receipts.length, 1, await b.page.textContent("#ebook-auto-status")); assert.equal(files.size, 0); assert.equal(rows.size, 0);
      assert.equal(uploads.length, 1, "automatic sync uploaded the same ebook twice");
      const second = await importBook(b.page, "Tự chuyển từ B"); await hasBook(a.page, second);
      await a.page.waitForFunction(() => document.getElementById("ebook-transfer-panel").getAttribute("aria-busy") === "false");
      assert.equal(receipts.length, 2); assert.equal(files.size, 0); assert.equal(rows.size, 0); assert.equal(uploads.length, 2);
      assert.equal(new URL(a.page.url()).pathname, "/"); assert.equal(new URL(b.page.url()).pathname, "/");
      assert.equal(await a.page.locator("#sync-dialog").evaluate((d) => d.open), false, "automatic transfer opened a modal");
      await b.page.evaluate((slug) => globalThis.EbookImport.remove(slug), first);
      await b.page.waitForFunction(() => /khớp|Sẵn sàng/.test(document.getElementById("ebook-auto-status").textContent));
      await b.page.click("#btn-sync"); await b.page.click("#ebook-auto-retry");
      await b.page.waitForFunction(() => document.getElementById("ebook-transfer-panel").getAttribute("aria-busy") === "false" && /khớp/.test(document.getElementById("ebook-auto-status").textContent));
      assert.ok(inventory.get(b.device).ignored.includes(first));
      if (process.env.SYNC_PREVIEW_DIR) { fs.mkdirSync(process.env.SYNC_PREVIEW_DIR, { recursive: true }); await b.page.screenshot({ path: path.join(process.env.SYNC_PREVIEW_DIR, "auto-ebook-mobile.png") }); }
      await a.page.click("#btn-sync"); await a.page.click("#ebook-auto-retry");
      await a.page.waitForFunction(() => document.getElementById("ebook-transfer-panel").getAttribute("aria-busy") === "false" && /khớp/.test(document.getElementById("ebook-auto-status").textContent));
      assert.equal(await b.page.evaluate((slug) => globalThis.EbookImport.get(slug), first), undefined, "automatic sync restored a locally deleted ebook");
      await b.page.uncheck("#ebook-auto-enabled");
      await b.page.waitForFunction(() => /tạm dừng/.test(document.getElementById("ebook-auto-status").textContent));
      const third = await importBook(a.page, "Không chuyển đến máy tạm dừng");
      await a.page.click("#ebook-auto-retry");
      await a.page.waitForFunction(() => document.getElementById("ebook-transfer-panel").getAttribute("aria-busy") === "false" && /khớp/.test(document.getElementById("ebook-auto-status").textContent));
      assert.equal(await b.page.evaluate((slug) => globalThis.EbookImport.get(slug), third), undefined);
      await b.page.check("#ebook-auto-enabled");
      await b.page.evaluate(() => { window.originalEbookSave = globalThis.EbookImport.save; globalThis.EbookImport.save = async () => { throw new Error("QuotaExceededError"); }; });
      await a.page.click("#ebook-auto-retry");
      await b.page.waitForFunction(() => /QuotaExceeded/.test(document.getElementById("ebook-auto-status").textContent), null, { timeout: 35000 });
      assert.equal(receipts.length, 2); assert.equal(files.size, 1, "failed auto save prematurely deleted the temporary object");
      await b.page.evaluate(() => { globalThis.EbookImport.save = window.originalEbookSave; }); await b.page.click("#ebook-auto-retry"); await hasBook(b.page, third);
      await b.page.waitForFunction(() => document.getElementById("ebook-transfer-panel").getAttribute("aria-busy") === "false");
      assert.equal(receipts.length, 3); assert.equal(files.size, 0); assert.equal(rows.size, 0);
      assert.ok(await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
      console.log("automatic ebooks:\n  ✔ bidirectional imports without send/receive clicks, closed dialogs, durable receipt, no duplicate upload, local deletion exclusion, pause, quota retry and bucket cleanup");
      return;
    }
    await a.page.click("#sync-now"); await a.page.waitForFunction(() => !document.getElementById("sync-now").disabled);
    await a.page.selectOption("#ebook-transfer-recipient", b.device);
    await b.context.setOffline(true);
    const slug = await a.page.evaluate(async () => {
      const book = await globalThis.EbookImport.parseFile(new File(["Chương 1\n\nNội dung kiểm tra chuyển ebook.\n\nĐoạn hai."], "Sach chuyen may.txt", { type: "text/plain" }));
      book.titleVi = "Sách chuyển máy"; await globalThis.EbookImport.save(book); return book.slug;
    });
    await a.page.click("#ebook-transfer-refresh"); await finished(a.page);
    await a.page.click("#ebook-transfer-send"); await finished(a.page);
    assert.equal(rows.size, 1); assert.equal(files.size, 1); assert.equal([...rows.values()][0].recipient_device, b.device);
    await b.context.setOffline(false);
    await b.page.click("#ebook-transfer-refresh"); await finished(b.page);
    if (process.env.SYNC_PREVIEW_DIR) { fs.mkdirSync(process.env.SYNC_PREVIEW_DIR, { recursive: true }); await b.page.screenshot({ path: path.join(process.env.SYNC_PREVIEW_DIR, "ebook-transfer-mobile.png") }); }
    corruptDownload = true;
    await b.page.getByRole("button", { name: "Nhận sách", exact: true }).click(); await finished(b.page);
    assert.match(await b.page.textContent("#ebook-transfer-status"), /bị hỏng/); assert.equal(receipts.length, 0); assert.equal(files.size, 1);
    corruptDownload = false;
    await b.page.evaluate(() => { window.originalEbookSave = globalThis.EbookImport.save; globalThis.EbookImport.save = async () => { throw new Error("QuotaExceededError"); }; });
    await b.page.getByRole("button", { name: "Nhận sách", exact: true }).click(); await finished(b.page);
    assert.match(await b.page.textContent("#ebook-transfer-status"), /QuotaExceeded/); assert.equal(receipts.length, 0); assert.equal(files.size, 1);
    await b.page.evaluate(() => { globalThis.EbookImport.save = window.originalEbookSave; });
    failDelete = true;
    await b.page.getByRole("button", { name: "Nhận sách", exact: true }).click(); await finished(b.page);
    assert.equal(receipts.length, 1); assert.equal(files.size, 1); assert.equal(rows.size, 1);
    const saved = await b.page.evaluate(async (slug) => { const book = await globalThis.EbookImport.get(slug); return { title: book.titleVi, content: book.volumesData[0].chapters[0].content, assets: book.assets.length }; }, slug);
    assert.equal(saved.title, "Sách chuyển máy"); assert.match(saved.content, /Nội dung kiểm tra/); assert.ok(saved.assets > 0);
    assert.equal(await b.page.locator('[data-shelf-quick="personal"] .shelf-shortcut-count').textContent(), "1", "received book was not added to shelf");
    assert.equal(await b.page.getAttribute("#ebook-transfer-open", "href"), `/truyen/${slug}`);
    await b.page.getByRole("button", { name: "Xóa bản tạm", exact: true }).click(); await finished(b.page);
    assert.equal(files.size, 0); assert.equal(rows.size, 0); assert.match(await b.page.textContent("#ebook-transfer-status"), /Đã xóa bản tạm/);
    assert.ok(await a.page.evaluate(async (slug) => Boolean(await globalThis.EbookImport.get(slug)), slug), "sender book removed");
    assert.ok(await b.page.evaluate(async (slug) => Boolean(await globalThis.EbookImport.get(slug)), slug), "receiver book removed");
    // A second send to a device which already has the book preserves edits,
    // and exercises successful automatic deletion without the retry button.
    await b.page.evaluate(async (slug) => { const book = await globalThis.EbookImport.get(slug); book.titleVi = "Tên riêng trên máy nhận"; await globalThis.EbookImport.save(book); }, slug);
    await a.page.click("#ebook-transfer-send"); await finished(a.page);
    await b.page.click("#ebook-transfer-refresh"); await finished(b.page);
    await b.page.getByRole("button", { name: "Nhận sách", exact: true }).click(); await finished(b.page);
    assert.equal(files.size, 0); assert.equal(rows.size, 0); assert.equal(receipts.length, 2);
    assert.equal(await b.page.evaluate(async (slug) => (await globalThis.EbookImport.get(slug)).titleVi, slug), "Tên riêng trên máy nhận");
    assert.match(await b.page.textContent("#ebook-transfer-status"), /Đã xóa bản tạm trên bucket/);
    assert.ok(await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile transfer panel overflows");
    assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
    console.log("ebook handoff:\n  ✔ selected offline recipient, two devices, real ZIP/assets + IndexedDB, corrupt download, quota failure, cleanup retry and automatic bucket deletion");
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
module.exports = { runEbookTransferChecks, runAutoEbookSyncChecks: (browser, base) => runEbookTransferChecks(browser, base, true) };
