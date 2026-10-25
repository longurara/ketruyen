// Real browser and Supabase SDK against local HTTP fixtures only.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { authSession } = require("./sync");
async function runWorkbenchSyncChecks(browser, base) {
  const contexts = [], devices = new Map(), records = new Map(), workbench = new Map(); let installed = true;
  const output = path.join(__dirname, "../../output/playwright/workbench-sync"); fs.mkdirSync(output, { recursive: true });
  const until = async (predicate, message) => { const end = Date.now() + 30000; while (Date.now() < end) { if (await predicate()) return; await new Promise((r) => setTimeout(r, 100)); } assert.fail(message); };
  async function device(mobile = false) {
    const session = authSession(), sid = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url")).session_id;
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: mobile ? 844 : 900 }, serviceWorkers: "block" }); contexts.push(context);
    await context.routeWebSocket("wss://*.supabase.co/**", (ws) => ws.close());
    await context.route("https://*.supabase.co/**", async (route) => {
      const req = route.request(), url = new URL(req.url()), body = req.headers()["content-type"]?.includes("application/json") ? req.postDataJSON() : null;
      const ok = (json) => route.fulfill({ json }), rpc = url.pathname.split("/rpc/")[1];
      if (url.pathname.endsWith("/user")) return ok(session.user);
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
      if (!installed && (rpc === "reader_workbench_apply" || url.pathname.endsWith("/reader_workbench_records"))) return route.fulfill({ status: 404, json: { code: "PGRST205", message: "Migration not installed" } });
      if (rpc === "reader_device_register") { if (!devices.has(sid)) devices.set(sid, { session_id: sid, user_id: session.user.id, device_id: body.installation, name: mobile ? "Điện thoại" : "Máy tính", last_seen: new Date().toISOString(), reading: null }); return ok({ ...devices.get(sid), server_time: new Date().toISOString() }); }
      if (!devices.has(sid)) return route.fulfill({ status: 403, json: { code: "42501", message: "device-revoked" } });
      if (rpc === "reader_require_device" || rpc === "reader_archive_notes" || rpc === "reader_activity_upload" || rpc === "reader_ebook_inventory_set" || rpc === "reader_ebook_inventory_labels" || rpc === "reader_ebook_auto_reserve") return ok(null);
      if (rpc === "reader_device_touch") return ok(new Date().toISOString());
      if (rpc === "reader_sync_apply" || rpc === "reader_workbench_apply" || rpc === "reader_journal_apply") {
        const map = rpc === "reader_workbench_apply" ? workbench : records;
        return ok(body.changes.map((c) => { const previous = map.get(c.key); if ((previous?.revision || 0) !== c.expected_revision) return { ...previous, applied: false }; const row = { record_key: c.key, value: structuredClone(c.value), revision: (previous?.revision || 0) + 1 }; map.set(c.key, row); return { ...row, applied: true }; }));
      }
      if (url.pathname.endsWith("/reader_devices")) return ok([...devices.values()]);
      if (url.pathname.endsWith("/reader_workspace_meta")) return ok(null);
      if (url.pathname.endsWith("/reader_sync_records") || url.pathname.endsWith("/reader_workbench_records")) {
        const rows = [...(url.pathname.endsWith("/reader_workbench_records") ? workbench : records).values()].sort((a, b) => a.record_key.localeCompare(b.record_key));
        const start = Number(url.searchParams.get("offset")) || 0; return ok(rows.slice(start, start + 500));
      }
      if (["reader_journal_records", "reader_ebook_inventory", "reader_ebook_transfers", "reader_activity", "reader_note_versions", "reader_note_purges", "reader_book_requests"].some((t) => url.pathname.endsWith("/" + t))) return ok([]);
      return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Unknown fixture endpoint: " + url.pathname } });
    });
    await context.addInitScript((session) => { if (!localStorage.getItem("fixture-auth-seeded")) { localStorage.setItem("ketruyen-auth-v1", JSON.stringify(session)); localStorage.setItem("ketruyen-sync-link-v1", session.user.id); localStorage.setItem("fixture-auth-seeded", "yes"); } localStorage.setItem("ketruyen-auto-ebook-v1", "off"); }, session);
    const page = await context.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/truyen/thien-su-nha-ben/tap-1/1"); await page.waitForSelector("#reader-chapters .reader-content");
    await until(async () => (await page.textContent("#sync-workbench-status")).startsWith("Đã đồng bộ"), "initial workbench sync failed");
    return { page, context, errors };
  }
  const tool = async (page, name) => {
    if (await page.locator("#workbench-dialog[open]").count()) await page.locator("#workbench-dialog .tools-close").click();
    const button = page.locator('[data-workbench="home"]:visible').first();
    if (await button.count()) await button.click(); else await page.getByRole("button", { name: "Tiện ích đọc", exact: true }).click();
    await page.locator("#workbench-search").fill(name); await page.locator("[data-home-action]").first().click();
  };
  const poke = (page) => page.evaluate(() => dispatchEvent(new Event("ketruyen-workbench-change")));
  const values = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-workbench-v1")));
  const settled = (page) => until(async () => (await page.textContent("#sync-workbench-status")).startsWith("Đã đồng bộ") && !await page.locator("#sync-now").isDisabled(), "workbench did not settle");
  try {
    const a = await device(), b = await device(true);
    await tool(a.page, "Chú giải từ"); await a.page.locator('#glossary-form [name="term"]').fill("Thiên sứ"); await a.page.locator('#glossary-form [name="meaning"]').fill("Người mang lại bình yên <script>window.badWorkbench=true</script>");
    await a.page.locator('#glossary-form button[name="vocab"]').click();
    await until(() => workbench.size === 2, "glossary and vocabulary not uploaded"); await poke(b.page);
    await until(async () => (await values(b.page)).vocabulary.length === 1, "mobile did not receive vocabulary");
    assert.equal(await b.page.evaluate(() => Boolean(window.badWorkbench)), false);
    await tool(b.page, "Sổ từ vựng"); await b.page.locator("#vocab-reveal").click(); await b.page.locator('[data-vocab-rate="good"]').click();
    await until(() => [...workbench.values()].some((r) => r.record_key.startsWith("vocabulary/") && r.value.level === 1), "review schedule not uploaded");
    await poke(a.page); await until(async () => (await values(a.page)).vocabulary[0].level === 1, "review schedule not received");
    // Profile arrival must not change the receiving device's active font setting.
    await tool(a.page, "Hồ sơ đọc"); await a.page.locator('#profile-form [name="name"]').fill("Buổi tối trên máy tính"); await a.page.locator('#profile-form button[type="submit"]').click();
    await until(() => [...workbench.keys()].some((k) => k.startsWith("profile/")), "profile not uploaded");
    const activeFont = await b.page.evaluate(() => localStorage.getItem("tenshi-font-size")); await poke(b.page);
    await until(async () => (await values(b.page)).profiles.length === 1, "profile not received");
    assert.equal(await b.page.evaluate(() => localStorage.getItem("tenshi-font-size")), activeFont);
    await tool(b.page, "Hồ sơ đọc"); await b.page.locator('[data-profile-apply="0"]').click(); assert.ok(await b.page.evaluate(() => localStorage.getItem("tenshi-font-size")));
    // A dirty editor survives incoming updates and saves a separate copy.
    await settled(a.page); await settled(b.page); await tool(b.page, "Chú giải từ"); await b.page.locator('[data-term-edit="0"]').click();
    await b.page.locator('#glossary-form [name="meaning"]').fill("Bản nháp đang gõ trên điện thoại");
    const glossaryKey = [...workbench.keys()].find((k) => k.startsWith("glossary/")), old = workbench.get(glossaryKey);
    workbench.set(glossaryKey, { ...old, value: { ...old.value, meaning: "Bản mới trên máy khác" }, revision: old.revision + 1 }); await poke(b.page);
    await until(async () => (await values(b.page)).glossary[0].meaning === "Bản mới trên máy khác", "incoming glossary not stored");
    assert.equal(await b.page.locator('#glossary-form [name="meaning"]').inputValue(), "Bản nháp đang gõ trên điện thoại");
    await b.page.locator('#glossary-form button[type="submit"]').first().click();
    assert.deepEqual((await values(b.page)).glossary.map((r) => r.meaning).sort(), ["Bản mới trên máy khác", "Bản nháp đang gõ trên điện thoại"].sort());
    await settled(b.page); await poke(a.page); await until(async () => (await values(a.page)).glossary.length === 2, "draft copy not synced");
    // Two offline changes to the same review card require an explicit choice.
    await settled(a.page); await settled(b.page); await a.context.setOffline(true); await b.context.setOffline(true);
    const review = async (page, level) => page.evaluate((level) => { const s = JSON.parse(localStorage.getItem("tenshi-workbench-v1")); s.vocabulary[0].level = level; s.vocabulary[0].due += level * 60000; localStorage.setItem("tenshi-workbench-v1", JSON.stringify(s)); dispatchEvent(new StorageEvent("storage", { key: "tenshi-workbench-v1" })); }, level);
    await review(a.page, 2); await review(b.page, 3); await a.context.setOffline(false); await settled(a.page);
    await b.context.setOffline(false); await tool(b.page, "Sổ từ vựng");
    await until(async () => await b.page.locator("[data-workbench-resolve]").count() === 2, "offline conflict not shown");
    assert.equal((await values(b.page)).vocabulary[0].level, 3);
    await b.page.screenshot({ path: path.join(output, "mobile-conflict.png") });
    const dimensions = await b.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert.ok(dimensions.scroll <= dimensions.width + 1);
    await b.page.locator('[data-workbench-resolve="remote"]').click(); await settled(b.page); assert.equal((await values(b.page)).vocabulary[0].level, 2);
    // Reload retains the outbox baseline and does not resurrect a deleted card.
    await tool(a.page, "Sổ từ vựng"); await a.page.locator("#workbench-panel details summary").click(); await a.page.locator('[data-vocab-delete="0"]').click();
    await until(() => [...workbench.values()].some((r) => r.record_key.startsWith("vocabulary/") && r.value === null), "deletion not uploaded"); await b.page.reload();
    await until(async () => (await values(b.page)).vocabulary.length === 0, "reload resurrected deleted vocabulary");
    // Missing migration degrades only this feature, then recovers on next check.
    installed = false; await poke(b.page); await until(async () => /migration 0007/.test(await b.page.textContent("#sync-workbench-status")), "missing migration status absent");
    assert.equal((await values(b.page)).profiles.length, 1); installed = true; await poke(b.page); await settled(b.page);
    await tool(a.page, "Hồ sơ đọc"); await a.page.screenshot({ path: path.join(output, "desktop-profiles.png") });
    assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
    console.log("  ✔ workbench: two-device glossary/vocabulary/profile sync, review schedule, explicit apply, dirty draft, offline conflict, deletion, reload and migration fallback");
  } finally { for (const context of contexts) await context.close(); }
}
module.exports = { runWorkbenchSyncChecks };
