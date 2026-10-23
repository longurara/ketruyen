// Exercise the real SDK + archive + IndexedDB across isolated browser devices.
// All Supabase HTTP is mocked: no live account, bucket or email is changed.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { authSession } = require("./sync");
async function runEbookTransferChecks(browser, base) {
  const session = authSession(), contexts = [], rows = new Map(), files = new Map(), receipts = [];
  let failDelete = false, corruptDownload = false;
  async function device(mobile = false) {
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 900 }, serviceWorkers: "block" }); contexts.push(context);
    await context.route("https://*.supabase.co/**", async (route) => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const body = request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : null;
      if (url.pathname.endsWith("/user")) return route.fulfill({ json: session.user });
      if (url.pathname.endsWith("/reader_sync_records")) return route.fulfill({ json: [] });
      if (url.pathname.endsWith("/rpc/reader_sync_apply")) return route.fulfill({ json: body.changes.map((r) => ({ record_key: r.key, value: r.value, revision: 1, applied: true })) });
      if (url.pathname.endsWith("/reader_ebook_transfers")) {
        if (method === "POST") { rows.set(body.id, { ...body, user_id: session.user.id, ready: false, received_at: null, expires_at: new Date(Date.now() + 1800000).toISOString() }); return route.fulfill({ status: 201, json: null }); }
        if (method === "PATCH") { const id = url.searchParams.get("id").slice(3); Object.assign(rows.get(id), body); return route.fulfill({ json: [{ id }] }); }
        return route.fulfill({ json: [...rows.values()] });
      }
      if (url.pathname.endsWith("/rpc/reader_ebook_received")) { receipts.push(body.transfer_id); rows.get(body.transfer_id).received_at = new Date().toISOString(); return route.fulfill({ json: null }); }
      if (url.pathname.endsWith("/rpc/reader_ebook_forget")) {
        const key = `${session.user.id}/${body.transfer_id}/book.zip`;
        if (files.has(key)) return route.fulfill({ status: 403, json: { code: "42501", message: "Remove the temporary object first" } });
        rows.delete(body.transfer_id); return route.fulfill({ json: null });
      }
      const prefix = "/storage/v1/object/ebook-transfers/", download = "/storage/v1/object/authenticated/ebook-transfers/";
      if (method === "POST" && url.pathname.startsWith(prefix)) {
        const key = decodeURIComponent(url.pathname.slice(prefix.length)); files.set(key, request.postDataBuffer());
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
      return route.abort();
    });
    await context.addInitScript((session) => { localStorage.setItem("ketruyen-auth-v1", JSON.stringify(session)); localStorage.setItem("ketruyen-sync-link-v1", session.user.id); }, session);
    const page = await context.newPage(), errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base); await page.waitForSelector(".ebook-shelf-item"); await page.click("#btn-sync");
    await page.waitForSelector("#ebook-transfer-panel:not([hidden])");
    await page.click("#ebook-transfer-panel summary");
    await page.waitForFunction(() => !document.getElementById("ebook-transfer-refresh").disabled);
    return { page, errors };
  }
  const finished = (page) => page.waitForFunction(() => document.getElementById("ebook-transfer-panel").getAttribute("aria-busy") === "false" && !document.getElementById("ebook-transfer-refresh").disabled);
  try {
    const a = await device(), b = await device(true);
    const slug = await a.page.evaluate(async () => {
      const book = await globalThis.EbookImport.parseFile(new File(["Chương 1\n\nNội dung kiểm tra chuyển ebook.\n\nĐoạn hai."], "Sach chuyen may.txt", { type: "text/plain" }));
      book.titleVi = "Sách chuyển máy"; await globalThis.EbookImport.save(book); return book.slug;
    });
    await a.page.click("#ebook-transfer-refresh"); await finished(a.page);
    await a.page.click("#ebook-transfer-send"); await finished(a.page);
    assert.equal(rows.size, 1); assert.equal(files.size, 1);
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
    console.log("ebook handoff:\n  ✔ two devices, real ZIP/assets + IndexedDB, corrupt download, quota failure, cleanup retry and automatic bucket deletion");
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
module.exports = { runEbookTransferChecks };
