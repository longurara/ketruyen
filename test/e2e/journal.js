// Real browser/SDK with local HTTP fixtures; never changes a live account.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { randomUUID } = require("node:crypto"), { authSession } = require("./sync");
async function runJournalChecks(browser, base) {
  const contexts = [], devices = new Map(), records = new Map(), journals = new Map(), inventory = new Map(), transfers = new Map(); let downloads = 0;
  const output = process.env.JOURNAL_PREVIEW_DIR || path.join(__dirname, "../../e2e-screenshots/journal"); fs.mkdirSync(output, { recursive: true });
  const until = async (predicate, message, timeout = 35000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await new Promise((r) => setTimeout(r, 100)); } assert.fail(message); };
  async function device(mobile = false) {
    const session = authSession(), sid = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url")).session_id, context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: mobile ? 844 : 900 }, serviceWorkers: "block" }); contexts.push(context);
    await context.routeWebSocket("wss://*.supabase.co/**", (ws) => ws.close());
    await context.route("https://*.supabase.co/**", async (route) => {
      const req = route.request(), url = new URL(req.url()), method = req.method(), body = req.headers()["content-type"]?.includes("application/json") ? req.postDataJSON() : null;
      const ok = (json) => route.fulfill({ json }), fail = (message) => route.fulfill({ status: 403, json: { code: "42501", message } }), rpc = url.pathname.split("/rpc/")[1];
      if (url.pathname.endsWith("/user")) return ok(session.user);
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
      if (rpc === "reader_device_register") { if (!devices.has(sid)) devices.set(sid, { session_id: sid, user_id: session.user.id, device_id: body.installation, name: mobile ? "iPhone thử nghiệm" : "Máy tính thử nghiệm", last_seen: new Date().toISOString(), reading: null }); return ok({ ...devices.get(sid), server_time: new Date().toISOString() }); }
      const dev = devices.get(sid); if (!dev) return fail("device-revoked");
      if (rpc === "reader_require_device") return ok(null);
      if (rpc === "reader_device_touch") { dev.last_seen = new Date().toISOString(); return ok(dev.last_seen); }
      if (rpc === "reader_archive_notes" || rpc === "reader_activity_upload") return ok(null);
      if (rpc === "reader_sync_apply" || rpc === "reader_journal_apply") {
        const map = rpc === "reader_journal_apply" ? journals : records;
        return ok(body.changes.map((c) => { const previous = map.get(c.key); if ((previous?.revision || 0) !== c.expected_revision) return { ...previous, applied: false }; const row = { record_key: c.key, value: structuredClone(c.value), revision: (previous?.revision || 0) + 1 }; map.set(c.key, row); return { ...row, applied: true }; }));
      }
      if (rpc === "reader_ebook_inventory_set") { inventory.set(dev.device_id, { device_id: dev.device_id, slugs: body.books, ignored: body.excluded_books, enabled: body.active, labels: inventory.get(dev.device_id)?.labels || {}, confirmed_at: new Date().toISOString() }); return ok(null); }
      if (rpc === "reader_ebook_inventory_labels") { inventory.get(dev.device_id).labels = body.titles; return ok(null); }
      if (rpc === "reader_ebook_auto_reserve") return ok(null);
      if (url.pathname.endsWith("/reader_devices")) return ok([...devices.values()]);
      if (url.pathname.endsWith("/reader_workspace_meta")) return ok(null);
      if (url.pathname.endsWith("/reader_sync_records") || url.pathname.endsWith("/reader_journal_records")) {
        const rows = [...(url.pathname.endsWith("/reader_journal_records") ? journals : records).values()].sort((a, b) => a.record_key.localeCompare(b.record_key));
        const start = Number(req.headers().range?.split("-")[0] || 0); return ok(rows.slice(start, start + 500));
      }
      if (url.pathname.endsWith("/reader_ebook_inventory")) return ok([...inventory.values()]);
      if (url.pathname.endsWith("/reader_ebook_transfers")) return ok([...transfers.values()]);
      if (["reader_activity", "reader_note_versions", "reader_note_purges", "reader_book_requests"].some((t) => url.pathname.endsWith("/" + t))) return ok([]);
      if (method === "GET" && url.pathname.includes("/storage/v1/object/")) { downloads++; return route.fulfill({ body: Buffer.from("corrupt"), contentType: "application/zip" }); }
      return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Unknown fixture endpoint: " + url.pathname } });
    });
    await context.addInitScript((session) => { localStorage.setItem("ketruyen-auth-v1", JSON.stringify(session)); localStorage.setItem("ketruyen-sync-link-v1", session.user.id); localStorage.setItem("ketruyen-auto-ebook-v1", "off"); window.print = () => { window.fixturePrinted = true; }; }, session);
    const page = await context.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.goto(base); await page.waitForSelector("#shelf-journal-open");
    await page.waitForFunction(() => document.getElementById("sync-feedback").dataset.syncState === "synced");
    return { page, context, errors, device: devices.get(sid).device_id };
  }
  const entries = (page) => page.evaluate(() => globalThis.ReaderJournal.values(localStorage).filter((r) => r.kind === "entry"));
  const poke = (page) => page.evaluate(() => dispatchEvent(new Event("ketruyen-journal-change")));
  try {
    const a = await device(), b = await device(true);
    await a.page.evaluate(() => {
      const lib = { version: 1, books: {}, marks: [{ id: "journal-quote", slug: "thien-su-nha-ben", type: "highlight", volIdx: 0, chapIdx: 0, createdAt: Date.now(), label: "Câu nhớ mãi", note: "Ghi chú đính kèm", parts: [{ p: 0, start: 0, end: 3, quote: "Một câu riêng tư để thử đính kèm." }] }] };
      localStorage.setItem("tenshi-library-v1", JSON.stringify(lib));
    });
    await a.page.click("#shelf-journal-open"); await a.page.click("#journal-write");
    await a.page.locator(".journal-extra > summary").click();
    await a.page.locator('#journal-form [name="phase"]').selectOption("expectation"); await a.page.locator('#journal-form [name="started"]').fill("2020-01-01");
    await a.page.locator('#journal-form [name="rating"]').selectOption("5"); await a.page.locator('#journal-form [name="moods"]').fill("Ấm áp, Muốn đọc lại");
    await a.page.locator('#journal-form [name="text"]').fill("Cảm nhận tiếng Việt. <script>window.badJournal=true</script>\nDòng thứ hai không bị mất.");
    await a.page.locator('.journal-attachment-picker input[type="checkbox"]').first().check(); await a.page.locator('#journal-form button[type="submit"]').click();
    const first = (await entries(a.page))[0]; assert.equal(first.rating, 5); assert.equal(first.attachments.length, 1); assert.equal(await a.page.evaluate(() => Boolean(window.badJournal)), false);
    await until(() => journals.get("journal/" + first.id)?.value?.text === first.text, "new diary did not sync");
    await poke(b.page); await until(async () => (await entries(b.page)).some((v) => v.id === first.id), "second device did not receive diary");
    await b.page.click("#shelf-journal-open"); assert.match(await b.page.textContent("#journal-results"), /Dòng thứ hai/);
    await a.page.waitForFunction(() => document.getElementById("journal-sync-status").textContent.startsWith("Đã đồng bộ nhật ký") && !document.getElementById("sync-now").disabled);
    await b.page.waitForFunction(() => document.getElementById("journal-sync-status").textContent.startsWith("Đã đồng bộ nhật ký") && !document.getElementById("sync-now").disabled);
    // Offline concurrent writing preserves both versions before resolving CAS.
    await a.context.setOffline(true); await b.context.setOffline(true);
    for (const [d, text] of [[a, "Sửa riêng trên máy A"], [b, "Sửa riêng trên máy B"]]) { await d.page.click(`[data-journal-edit="${first.id}"]`); await d.page.locator('#journal-form [name="text"]').fill(text); await d.page.locator('#journal-form button[type="submit"]').click(); }
    await a.context.setOffline(false); await poke(a.page); await until(() => journals.get("journal/" + first.id)?.value?.text === "Sửa riêng trên máy A", "offline A edit did not sync").catch(async (error) => { throw new Error(JSON.stringify({ message: error.message, entries: await entries(a.page), sync: await a.page.textContent("#journal-sync-status"), feedback: await a.page.textContent("#journal-feedback") }), { cause: error }); });
    await b.context.setOffline(false); await poke(b.page); await b.page.waitForSelector('.journal-conflicts [data-choice="remote"]');
    await b.page.locator('.journal-conflicts [data-choice="remote"]').click();
    await until(async () => { const rows = await entries(b.page); return rows.some((v) => v.text === "Sửa riêng trên máy A") && rows.some((v) => v.text === "Sửa riêng trên máy B" && v.id !== first.id); }, "resolving a journal conflict lost a version");
    // A new reading round keeps the old review and has its own dates/status.
    await b.page.click("#journal-new-run"); await b.page.locator('#journal-round-form button[type="submit"]').click();
    await b.page.locator('#journal-form [name="text"]').fill("Lượt đọc thứ hai đem lại cảm giác khác."); await b.page.locator(".journal-extra > summary").click(); await b.page.locator('#journal-form [name="phase"]').selectOption("expectation");
    await b.page.locator('#journal-form [name="status"]').selectOption("paused"); await b.page.locator('#journal-form [name="reason"]').fill("Đợi tập tiếp theo"); await b.page.locator('#journal-form button[type="submit"]').click();
    assert.match(await b.page.textContent("#journal-results"), /Lượt 2/); assert.match(await b.page.textContent("#journal-results"), /Đợi tập tiếp theo/);
    await b.page.click("#journal-filter-toggle");
    await b.page.selectOption("#journal-rating", "5"); assert.equal(await b.page.locator('#journal-results [data-journal-edit]').count(), 2); await b.page.selectOption("#journal-rating", "");
    await b.page.fill("#journal-search", "thứ hai"); assert.equal(await b.page.locator('#journal-results [data-journal-edit]').count(), 1); await b.page.fill("#journal-search", "");
    await b.page.click('[data-journal-tab="summary"]'); assert.match(await b.page.textContent("#journal-results"), /Tổng kết/); assert.match(await b.page.textContent("#journal-results"), /Ấm áp/); await b.page.click('[data-journal-tab="timeline"]');
    // Export only the chosen review, with private attachments excluded by default.
    await b.page.click(`[data-journal-share="${first.id}"]`);
    const mdEvent = b.page.waitForEvent("download"); await b.page.click("#journal-md"); const md = await mdEvent; await md.saveAs(path.join(output, "selected.md"));
    const exported = fs.readFileSync(path.join(output, "selected.md"), "utf8"); assert.match(exported, /Sửa riêng trên máy A/); assert.doesNotMatch(exported, /Sửa riêng trên máy B|câu riêng tư|Lượt đọc thứ hai/);
    const pngEvent = b.page.waitForEvent("download"); await b.page.click("#journal-card"); const png = await pngEvent; await png.saveAs(path.join(output, "journal-card.png"));
    const data = fs.readFileSync(path.join(output, "journal-card.png")); assert.equal(data.readUInt32BE(16), 1080); assert.equal(data.readUInt32BE(20), 1350);
    const popupEvent = b.page.waitForEvent("popup"); await b.page.click("#journal-pdf"); const printed = await popupEvent; await printed.waitForLoadState("domcontentloaded");
    assert.match(await printed.textContent("body"), /Sửa riêng trên máy A/); assert.doesNotMatch(await printed.textContent("body"), /Sửa riêng trên máy B|câu riêng tư/); await printed.close();
    await b.page.click("#journal-export-back"); await b.page.screenshot({ path: path.join(output, "journal-mobile.png") });
    assert.ok(await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const height = await b.page.locator("#journal-dialog .journal-body").evaluate((el) => el.scrollHeight - el.clientHeight); assert.ok(height > 100);
    await b.page.locator("#journal-dialog .journal-body").evaluate((el) => { el.scrollTop = el.scrollHeight; }); await b.page.locator("#journal-dialog .journal-body").evaluate((el) => { el.scrollTop = 0; });
    // Real ebook deletion leaves the durable diary and attachment snapshots intact.
    await a.page.click("#journal-close");
    const ebook = await a.page.evaluate(async () => { const book = await globalThis.EbookImport.parseFile(new File(["Chương 1\n\nMột.\n\nChương 2\n\nHai."], "Nhật ký ebook.txt", { type: "text/plain" })); await globalThis.EbookImport.save(book); return { slug: book.slug, volume: globalThis.AppRoutes.volumeSlug(book.volumesData[0].dirName) }; });
    await a.page.goto(`${base}/truyen/${ebook.slug}/${ebook.volume}/0`); await a.page.waitForSelector('body[data-view="reader"]');
    await until(async () => a.page.evaluate((slug) => globalThis.ReaderJournal.values(localStorage).some((r) => r.kind === "run" && r.slug === slug), ebook.slug), "opening an ebook did not record a start milestone");
    await a.page.evaluate(async (slug) => { await globalThis.EbookImport.remove(slug); }, ebook.slug); await a.page.goto(base); await a.page.waitForSelector("#shelf-journal-open");
    assert.ok(await a.page.evaluate((slug) => globalThis.ReaderJournal.values(localStorage).some((r) => r.slug === slug), ebook.slug));
    await a.page.click("#shelf-journal-open"); await a.page.click("#journal-write"); await a.page.locator('#journal-form [name="book"]').selectOption(ebook.slug);
    await a.page.locator('#journal-form [name="text"]').fill("Tệp đã xóa nhưng cảm nhận vẫn còn."); await a.page.locator('#journal-form button[type="submit"]').click();
    assert.match(await a.page.textContent("#journal-results"), /Tệp đã xóa/); await a.page.click("#journal-close");
    // Inventory reports a historical peer confirmation, never a current cloud backup.
    await b.page.click("#journal-close"); await b.context.setOffline(true);
    const remoteSlug = "ebook-" + "f".repeat(24), date = new Date(Date.now() - 86400000).toISOString(), transferId = randomUUID();
    inventory.set(b.device, { device_id: b.device, slugs: [remoteSlug], ignored: [], enabled: false, confirmed_at: date, labels: { [remoteSlug]: { title: "Sách chỉ xác nhận trên iPhone", author: "" } } });
    transfers.set(transferId, { id: transferId, user_id: authSession().user.id, sender_device: b.device, recipient_device: a.device, slug: remoteSlug, title: "Sách chỉ xác nhận trên iPhone", sha256: "a".repeat(64), bytes: 10, ready: true, received_at: null, expires_at: new Date(Date.now() + 1800000).toISOString() });
    await a.page.locator("#shelf-more summary").click(); await a.page.locator('#shelf-more [data-open-library-health]').click(); await a.page.click("#library-health-refresh");
    await a.page.waitForSelector(`[data-health-book="${remoteSlug}"]`); const health = a.page.locator(`[data-health-book="${remoteSlug}"]`);
    assert.match(await health.textContent(), /Chưa có trên máy này/); assert.match(await health.textContent(), /iPhone thử nghiệm: đã xác nhận có sách lúc/);
    await health.locator("[data-health-receive]").click(); await until(async () => /bị hỏng/.test(await a.page.textContent("#library-health-status")), "failed receive was not surfaced in health center");
    assert.ok(downloads > 0); assert.ok(transfers.has(transferId)); await a.page.screenshot({ path: path.join(output, "library-health.png") });
    await a.page.click("#library-health-close");
    const deletedRun = await a.page.evaluate(async (slug) => { const id = await globalThis.ReaderJournal.defaultId(slug, "book", null); globalThis.ReaderJournal.apply(localStorage, { ["journal/" + id]: null }); dispatchEvent(new Event("ketruyen-journal-change")); return id; }, ebook.slug);
    await a.page.click("#shelf-journal-open"); await a.page.click("#journal-write"); await a.page.locator('#journal-form [name="book"]').selectOption(ebook.slug);
    await a.page.locator('#journal-form [name="text"]').fill("Bài mới vẫn giữ tombstone của lượt đã xóa."); await a.page.locator('#journal-form button[type="submit"]').click();
    assert.equal(await a.page.evaluate((id) => globalThis.ReaderJournal.records(localStorage)["journal/" + id], deletedRun), null);
    assert.ok((await entries(a.page)).some((v) => v.text.startsWith("Bài mới vẫn giữ") && v.runId !== deletedRun));
    assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
    console.log("journal and library health:\n  ✔ private diary, optional fields/attachments, offline CAS conflict preservation, reading rounds, filters, summaries, selected Markdown/PDF/PNG, deleted ebook retention, historical inventory and failed receipt");
  } finally { await Promise.all(contexts.map((c) => c.close())); }
}
module.exports = { runJournalChecks };
