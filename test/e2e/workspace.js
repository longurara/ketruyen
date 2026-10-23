// Real browser + Supabase SDK; every cloud and email endpoint is a fixture.
const assert = require("node:assert/strict"), { randomUUID } = require("node:crypto"), { authSession } = require("./sync");
const fs = require("node:fs"), path = require("node:path");
async function runWorkspaceChecks(browser, base) {
  const devices = new Map(), records = new Map(), activity = new Map(), versions = new Map(), purges = new Map(), contexts = [], requests = [];
  const meta = { activity_revision: 0, legacy: null }, owner = authSession().user.id; let reauth = 0, updates = 0;
  const mark = { id: "workspace-note", slug: "thien-su-nha-ben", type: "bookmark", volIdx: 0, chapIdx: 1, label: "Đọc tiếp", note: "Phiên bản gốc", anchor: { block: 4, offset: 0, textOffset: 7 }, parts: [], createdAt: Date.now() };
  const snapshot = async (page, name) => { if (process.env.WORKSPACE_PREVIEW_DIR) { fs.mkdirSync(process.env.WORKSPACE_PREVIEW_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.WORKSPACE_PREVIEW_DIR, name + ".png"), fullPage: false, animations: "disabled" }); } };
  const archive = (entry) => { if (!versions.has(entry.id)) versions.set(entry.id, { id: entry.id, mark_id: entry.markId, value: entry.value, deleted: entry.deleted, recorded_at: new Date(entry.at).toISOString() }); };
  async function device(name, mobile = false) {
    const sessionId = randomUUID(), account = authSession(owner, sessionId), context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 850 }, serviceWorkers: "block" }); contexts.push(context);
    await context.routeWebSocket("wss://*.supabase.co/**", (ws) => ws.close());
    await context.route("https://*.supabase.co/**", async (route) => {
      const request = route.request(), url = new URL(request.url()), method = request.method(), body = request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : null;
      const ok = (json) => route.fulfill({ json }), error = (code, message, status = 400) => route.fulfill({ status, headers: { "X-Supabase-Api-Version": "2024-01-01", "Access-Control-Expose-Headers": "X-Supabase-Api-Version" }, json: { code, message } });
      const d = devices.get(sessionId), rpc = url.pathname.split("/rpc/")[1];
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
      if (url.pathname.endsWith("/reauthenticate")) { reauth++; return ok({}); }
      if (url.pathname.endsWith("/user")) {
        if (method === "PUT") {
          updates++;
          if (body.password && !body.nonce) return error("reauthentication_needed", "Reauthentication required");
          if (body.email) account.user.new_email = body.email;
        }
        return ok(account.user);
      }
      if (rpc === "reader_device_register") {
        if (d?.revoked_at) return error("42501", "device-revoked", 403);
        if (!d) devices.set(sessionId, { user_id: owner, session_id: sessionId, device_id: body.installation, name, last_seen: new Date().toISOString(), reading: null, revoked_at: null });
        return ok({ ...devices.get(sessionId), server_time: new Date().toISOString() });
      }
      if (!d || d.revoked_at) return error("42501", "device-revoked", 403);
      if (rpc === "reader_require_device") return ok(null);
      if (rpc === "reader_device_touch") { Object.assign(d, { last_seen: new Date().toISOString(), reading: body.reading_position }); return ok(d.last_seen); }
      if (rpc === "reader_device_manage") { if (body.action === "rename") devices.get(body.target).name = body.label; else for (const [id, dev] of devices) if (body.action === "revoke_others" ? id !== sessionId : id === body.target) dev.revoked_at = new Date().toISOString(); return ok(null); }
      if (rpc === "reader_sync_apply") return ok(body.changes.map((c) => {
        const old = records.get(c.key); if ((old?.revision || 0) !== c.expected_revision) return { ...old, applied: false };
        if (c.key.startsWith("mark/") && old?.value && JSON.stringify(old.value) !== JSON.stringify(c.value)) archive({ id: c.mutation_id || randomUUID(), markId: c.key.slice(5), value: old.value, deleted: !c.value, at: Date.now() });
        const row = { record_key: c.key, value: c.value, revision: (old?.revision || 0) + 1 }; records.set(c.key, row); return { ...row, applied: true };
      }));
      if (rpc === "reader_activity_upload") { meta.activity_revision++; for (const value of body.events) activity.set(value.id, { id: value.id, value, revision: meta.activity_revision }); return ok(meta.activity_revision); }
      if (rpc === "reader_archive_notes") { body.entries.forEach(archive); return ok(null); }
      if (rpc === "reader_import_legacy") { if (meta.legacy) return error("40001", "legacy-already-imported"); Object.assign(meta, { legacy: body.snapshot, cutover_ms: body.cutoff }); return ok(null); }
      if (rpc === "reader_note_restore" || rpc === "reader_note_purge") {
        const v = versions.get(body.version_id), id = v?.mark_id || body.note_id, key = "mark/" + id, old = records.get(key);
        if ((old?.revision || 0) !== body.expected) return error("40001", "note-conflict");
        const row = { record_key: key, value: v?.value || null, revision: body.expected + 1 }; records.set(key, row);
        if (!v) { for (const [id, e] of versions) if (e.mark_id === body.note_id) versions.delete(id); purges.set(body.note_id, { mark_id: body.note_id, purged_at: new Date().toISOString() }); }
        return ok(v ? row : null);
      }
      if (rpc === "reader_book_request") { requests.push(body); return ok(null); }
      if (url.pathname.endsWith("/reader_sync_records")) return ok([...records.values()]);
      if (url.pathname.endsWith("/reader_workspace_meta")) return ok(meta);
      if (url.pathname.endsWith("/reader_activity")) return ok([...activity.values()].filter((e) => e.revision > Number(url.searchParams.get("revision")?.slice(3) || 0)));
      if (url.pathname.endsWith("/reader_note_versions")) return ok([...versions.values()]);
      if (url.pathname.endsWith("/reader_note_purges")) return ok([...purges.values()]);
      if (url.pathname.endsWith("/reader_devices")) return ok([...devices.values()]);
      if (url.pathname.endsWith("/reader_book_requests") || url.pathname.endsWith("/reader_ebook_transfers")) return ok([]);
      return error("PGRST999", "Unexpected fixture route " + url.pathname);
    });
    await context.addInitScript(({ account, mark }) => { localStorage.setItem("ketruyen-auth-v1", JSON.stringify(account)); localStorage.setItem("ketruyen-sync-link-v1", account.user.id); if (!localStorage.getItem("tenshi-library-v1")) localStorage.setItem("tenshi-library-v1", JSON.stringify({ version: 1, books: {}, marks: [mark] })); }, { account, mark });
    const page = await context.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base); await page.waitForSelector(".ebook-shelf-item"); await page.click("#btn-sync"); await page.waitForSelector('#sync-feedback[data-sync-state="synced"]');
    return { page, context, sessionId, errors };
  }
  const flush = async (page) => { await page.click("#sync-now"); await page.waitForFunction(() => !document.getElementById("sync-now").disabled && document.getElementById("sync-feedback").dataset.syncState !== "syncing"); assert.equal(await page.getAttribute("#sync-feedback", "data-sync-state"), "synced", await page.textContent("#sync-status")); };
  const tab = (page, name) => page.click(`.sync-tabs [data-panel="${name}"]`);
  const confirm = async (page) => { await page.waitForSelector(".app-confirm[open]"); assert.ok((await page.textContent("#app-confirm-title")).length); await page.click(".app-confirm [data-confirm]"); };
  try {
    const a = await device("Máy tính của tôi"), b = await device("Điện thoại", true); await flush(a.page);
    await tab(a.page, "devices"); assert.equal(await a.page.locator("#workspace-devices .workspace-card").count(), 2);
    const rename = a.page.locator(`[data-rename="${a.sessionId}"]`); await rename.locator("input").fill("Máy đọc truyện"); await rename.locator("button").click();
    await a.page.waitForFunction(() => document.querySelector("#workspace-devices").textContent.includes("Máy đọc truyện")); await snapshot(a.page, "devices-desktop");
    await tab(b.page, "devices"); await snapshot(b.page, "devices-mobile");
    await tab(b.page, "security"); await b.page.fill('#workspace-password [name="password"]', "a-new-password"); await b.page.fill('#workspace-password [name="confirm"]', "different-password"); await b.page.click('#workspace-password [type="submit"]'); assert.equal(updates, 0);
    await b.page.fill('#workspace-password [name="confirm"]', "a-new-password"); await b.page.click('#workspace-password [type="submit"]'); await b.page.waitForSelector("#workspace-nonce-label:not([hidden])");
    await b.page.click("#workspace-reauth"); await b.page.waitForFunction(() => document.getElementById("workspace-security-status").textContent.includes("Đã yêu cầu mã")); assert.equal(reauth, 1);
    await b.page.fill('#workspace-password [name="nonce"]', "123456"); await b.page.click('#workspace-password [type="submit"]'); await b.page.waitForFunction(() => document.getElementById("workspace-security-status").textContent === "Đã đổi mật khẩu.");
    await b.page.fill('#workspace-email [name="email"]', "new@example.test"); await b.page.click('#workspace-email [type="submit"]'); await b.page.waitForFunction(() => document.getElementById("workspace-security-status").textContent.includes("cả hộp thư cũ và mới")); await snapshot(b.page, "security-mobile");
    const start = Date.now() - 600000;
    for (const page of [a.page, b.page]) await page.evaluate(async (start) => { for (let i = 0; i < 20; i++) await window.ReaderWorkspace.record({ id: crypto.randomUUID(), kind: "read", slug: "thien-su-nha-ben", start: start + i * 30000, end: start + (i + 1) * 30000, interaction: start }); }, start);
    await tab(a.page, "sync"); await tab(b.page, "sync"); await flush(a.page); await flush(b.page); await flush(a.page);
    assert.equal(await a.page.evaluate(() => window.ReaderWorkspace.summary().total), 600); assert.equal(activity.size, 40);
    await flush(b.page); assert.equal(activity.size, 40, "retry duplicates activity");
    // Handoff never navigates until the button is pressed; mobile restores a text anchor.
    const remote = devices.get(a.sessionId); remote.reading = { slug: "thien-su-nha-ben", volIdx: 0, chapIdx: 1, anchor: { block: 4, offset: 0, textOffset: 7 } };
    await flush(b.page); assert.match(b.page.url(), /\/$/); await b.page.click("#sync-close");
    assert.equal(await b.page.locator("#shelf-device-reading").evaluate((el) => el.closest("#view-shelf") !== null && getComputedStyle(el).position === "static"), true);
    assert.ok(await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "handoff card overflows mobile");
    await snapshot(b.page, "handoff-shelf-mobile");
    await b.page.locator("#shelf-device-reading button").click(); await b.page.waitForSelector("#view-reader.active .reader-content p[data-p]"); assert.match(b.page.url(), /tap-1\/1$/);
    assert.equal(await b.page.locator("#shelf-device-reading").isVisible(), false, "handoff card interrupts reader");
    remote.reading = { ...remote.reading, slug: "ebook-" + "a".repeat(24) }; await b.page.click("#btn-sync"); await flush(b.page); await b.page.click("#sync-close");
    assert.equal(await b.page.locator("#shelf-device-reading").isVisible(), false, "another book on a shared account interrupts reading");
    assert.match(b.page.url(), /tap-1\/1$/);
    await b.page.goBack(); await b.page.waitForSelector("#view-shelf.active");
    await b.page.locator("#shelf-device-reading button").click(); await confirm(b.page); await b.page.waitForFunction(() => document.getElementById("workspace-status").textContent.includes("Đã gửi yêu cầu")); assert.equal(requests[0].source, a.sessionId);
    // Actual local edit / deletion / restore UI preserves identity and position.
    await a.page.click("#sync-close"); await a.page.click('#shelf-shortcuts [data-library-action="marks"]'); await a.page.click('[data-edit-mark="workspace-note"]'); await a.page.fill('#mark-form [name="note"]', "Bản mới đã lưu"); await a.page.click('#mark-form [type="submit"]');
    await a.page.click("#btn-sync"); await flush(a.page); assert.ok(versions.size >= 1); await a.page.click("#sync-close");
    await a.page.click('#shelf-shortcuts [data-library-action="marks"]'); await a.page.click('[data-history-mark="workspace-note"]'); assert.match(await a.page.textContent("#library-tools-panel"), /Phiên bản gốc/); await a.page.click("#versions-back"); await a.page.click('[data-edit-mark="workspace-note"]'); await a.page.click("#mark-delete"); await a.page.locator("#workbench-dialog .tools-close").click();
    await a.page.click("#btn-sync"); await flush(a.page); await a.page.click("#sync-close"); await a.page.click('#shelf-shortcuts [data-library-action="marks"]'); await a.page.click("#marks-trash"); await snapshot(a.page, "notes-trash"); await a.page.locator("[data-restore-version]").first().click(); await a.page.waitForFunction(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).marks.length === 1);
    const restored = await a.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).marks[0]); assert.equal(restored.id, mark.id); assert.equal(restored.anchor.textOffset, mark.anchor.textOffset);
    await a.page.locator("#workbench-dialog .tools-close").click(); await a.page.click("#btn-sync"); await flush(a.page);
    await b.page.goto(base); await b.page.waitForSelector(".ebook-shelf-item"); await b.page.click("#btn-sync"); await flush(b.page); await b.page.click("#sync-close");
    await b.context.setOffline(true); await b.page.click('#shelf-shortcuts [data-library-action="marks"]'); await b.page.click('[data-edit-mark="workspace-note"]');
    const versionsBefore = await b.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).versions.length);
    await b.page.fill('#mark-form [name="note"]', "Bản lưu offline");
    assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).versions.length), versionsBefore, "typing creates history");
    await b.page.evaluate(() => { window.originalWorkspaceSet = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === "tenshi-library-v1") throw new Error("QuotaExceededError"); return window.originalWorkspaceSet.call(this, key, value); }; });
    await b.page.click('#mark-form [type="submit"]'); assert.match(await b.page.textContent("#library-feedback"), /Không lưu được/); assert.notEqual(await b.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).marks[0].note), "Bản lưu offline");
    await b.page.evaluate(() => { Storage.prototype.setItem = window.originalWorkspaceSet; }); await b.page.click('#mark-form [type="submit"]');
    await a.page.click("#sync-close"); await a.page.click('#shelf-shortcuts [data-library-action="marks"]'); await a.page.click('[data-edit-mark="workspace-note"]'); await a.page.fill('#mark-form [name="note"]', "Bản cloud mới"); await a.page.click('#mark-form [type="submit"]'); await a.page.click("#btn-sync"); await flush(a.page);
    await b.page.click("#btn-sync"); await b.context.setOffline(false); await b.page.waitForSelector(".sync-conflict"); await b.page.getByRole("button", { name: "Nhận từ đám mây", exact: true }).click(); await b.page.waitForFunction(() => !document.getElementById("sync-now").disabled);
    assert.ok(await b.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).versions.some((v) => v.value.note === "Bản lưu offline")), "discarded local edit missing from history");
    await a.page.click("#sync-close"); await a.page.click("#btn-reader-tools"); await a.page.waitForSelector(".reading-calendar"); assert.equal(await a.page.locator(".reading-calendar button").count(), 366); await snapshot(a.page, "stats-calendar"); await a.page.locator("#workbench-dialog .tools-close").click();
    await a.page.click("#btn-sync"); await flush(a.page); await a.page.click("#workspace-import"); await confirm(a.page); await a.page.waitForSelector("#workspace-import[hidden]", { state: "attached" }); assert.ok(meta.legacy);
    await tab(a.page, "devices"); await a.page.click(`[data-revoke="${b.sessionId}"]`); await confirm(a.page); await b.page.click("#sync-now"); await b.page.waitForSelector("#sync-login:not([hidden])"); // Revocation signs out locally.
    assert.equal(await b.page.evaluate(() => window.ReaderWorkspace.owner()), null);
    assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
    console.log("workspace:\n  ✔ device rename/revocation, password reauthentication, email change, overlapping activity, handoff, source requests, offline note conflicts/history/restore/quota, calendar and one-time legacy source");
  } catch (error) { for (const c of contexts) for (const p of c.pages()) console.error(await p.locator("#workspace-security-status, #workspace-status, #sync-status").allTextContents()); throw error; } finally { for (const context of contexts) await context.close(); }
}
module.exports = { runWorkspaceChecks };
