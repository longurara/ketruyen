// Real Supabase browser SDK with a local HTTP fixture; never sends email or
// creates accounts in the live project. SQL/RLS run separately in Postgres tests.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
function authSession(id = USER) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: id, role: "authenticated", exp: expires })).toString("base64url");
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: "local-fixture", token_type: "bearer", expires_in: 3600, expires_at: expires,
    user: { id, email: "reader@example.test", aud: "authenticated", role: "authenticated" } };
}
async function runSyncChecks(browser, base) {
  const records = new Map(), contexts = [], requests = { signup: 0, recovery: 0, login: 0, update: 0, reads: 0 };
  let readBarrier = null, failRead = false;
  const screenshot = async (page, name) => { if (process.env.SYNC_PREVIEW_DIR) { fs.mkdirSync(process.env.SYNC_PREVIEW_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SYNC_PREVIEW_DIR, name + ".png") }); } };
  const mark = { id: "shared-note", slug: "thien-su-nha-ben", type: "bookmark", volIdx: 0, chapIdx: 1, note: "Ghi chú trên máy A", anchor: { block: 3, offset: 0 }, parts: [] };
  async function device(initial = {}, account = authSession(), linked = "", mobile = false, callback = false) {
    const context = await browser.newContext({ viewport: { width: mobile ? 412 : 1280, height: 850 }, serviceWorkers: "block" }); contexts.push(context);
    await context.route("https://*.supabase.co/**", async (route) => {
      const url = new URL(route.request().url()), body = route.request().postDataJSON();
      if (url.pathname.endsWith("/signup")) { requests.signup++; return route.fulfill({ json: { user: account.user } }); }
      if (url.pathname.endsWith("/recover")) { requests.recovery++; return route.fulfill({ json: {} }); }
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
      if (url.pathname.endsWith("/token")) {
        requests.login++;
        if (body.password === "wrong-password") return route.fulfill({ status: 400, headers: { "X-Supabase-Api-Version": "2024-01-01" }, json: { code: "invalid_credentials", error: "invalid_grant", error_description: "Invalid login credentials" } });
        return route.fulfill({ json: account });
      }
      if (url.pathname.endsWith("/user")) { if (route.request().method() === "PUT") requests.update++; return route.fulfill({ json: account.user }); }
      const rows = records.get(account.user.id) || new Map(); records.set(account.user.id, rows);
      if (url.pathname.endsWith("/reader_sync_records")) {
        requests.reads++;
        if (readBarrier) { const barrier = readBarrier; readBarrier = null; await barrier; }
        if (failRead) { failRead = false; return route.fulfill({ status: 400, json: { code: "PGRST999", message: "Fixture: sync request failed" } }); }
        const offset = Number(url.searchParams.get("offset")) || 0, limit = Number(url.searchParams.get("limit")) || 500;
        return route.fulfill({ json: [...rows.values()].sort((a, b) => a.record_key.localeCompare(b.record_key)).slice(offset, offset + limit) });
      }
      if (url.pathname.endsWith("/rpc/reader_sync_apply")) {
        const result = body.changes.map((change) => {
          const row = rows.get(change.key);
          if ((row?.revision || 0) !== change.expected_revision) return { ...row, applied: false };
          const next = { record_key: change.key, value: change.value, revision: (row?.revision || 0) + 1 }; rows.set(change.key, next); return { ...next, applied: true };
        });
        return route.fulfill({ json: result });
      }
      return route.abort();
    });
    await context.addInitScript(({ initial, account, linked, callback }) => {
      if (!callback) localStorage.setItem("ketruyen-auth-v1", JSON.stringify(account));
      if (linked) localStorage.setItem("ketruyen-sync-link-v1", linked);
      for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, JSON.stringify(value));
    }, { initial, account, linked, callback });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const fragment = new URLSearchParams({ access_token: account.access_token, refresh_token: account.refresh_token, token_type: "bearer", expires_in: "3600", type: callback === "recovery" ? "recovery" : "signup" });
    await page.goto(base + (callback ? `/#${fragment}` : "")); await page.waitForSelector(".ebook-shelf-item");
    if (!callback) await page.click("#btn-sync");
    await page.waitForSelector(callback === "recovery" ? "#sync-dialog[open] #sync-reset:not([hidden])" : "#sync-dialog[open] #sync-account:not([hidden])");
    return { page, context, errors };
  }
  async function flush(page) {
    await page.click("#sync-now");
    await page.waitForFunction(() => !document.getElementById("sync-now").disabled && !document.getElementById("sync-status").textContent.includes("Đang đồng bộ…"));
  }
  try {
    const a = await device({ "tenshi-progress": { volIdx: 0, chapIdx: 1, timestamp: 1 }, "tenshi-b1k-1922-nam-ac-bao-progress": { volIdx: 0, chapIdx: 0, timestamp: 2 }, "tenshi-chapters": { "0:1": { block: 3, offset: .2, pct: 30, v: 2 } },
      "tenshi-library-v1": { version: 1, books: { "thien-su-nha-ben": { favorite: true, status: "reading", groups: ["Đọc tối"] } }, marks: [mark] } });
    assert.equal(requests.reads, 0, "sync ran before opt-in");
    await a.page.click("#sync-connect");
    await a.page.waitForFunction(() => document.getElementById("sync-status").textContent.includes("Đã đồng bộ lúc"));
    assert.equal(await a.page.getAttribute("#sync-feedback", "data-sync-state"), "synced");
    assert.match(await a.page.textContent("#sync-transfer"), /Đã gửi \d+ mục/);
    assert.match(await a.page.textContent("#sync-last-success"), /Lần thành công gần nhất/);
    await screenshot(a.page, "sync-state-success");
    let releaseRead;
    readBarrier = new Promise((resolve) => { releaseRead = resolve; });
    const readsBefore = requests.reads;
    await a.page.click("#sync-now");
    await a.page.waitForSelector('#sync-feedback[data-sync-state="syncing"]');
    assert.equal(await a.page.getAttribute("#sync-feedback", "aria-busy"), "true");
    assert.equal(await a.page.getAttribute("#btn-sync", "data-sync-state"), "syncing");
    assert.equal(await a.page.locator("#sync-feedback .sync-glyph-progress").evaluate((el) => getComputedStyle(el).animationName), "sync-turn");
    await screenshot(a.page, "sync-state-active");
    await a.page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await a.page.locator("#sync-feedback .sync-glyph-progress").evaluate((el) => getComputedStyle(el).animationName), "none");
    await a.page.emulateMedia({ reducedMotion: "no-preference" }); releaseRead();
    await a.page.waitForSelector('#sync-feedback[data-sync-state="synced"]');
    assert.ok(requests.reads > readsBefore, "check sync did not contact the cloud");
    assert.match(await a.page.textContent("#sync-transfer"), /Không có thay đổi mới/);
    const successBeforeError = await a.page.textContent("#sync-last-success");
    failRead = true; await flush(a.page);
    assert.equal(await a.page.getAttribute("#sync-feedback", "data-sync-state"), "error");
    assert.equal(await a.page.textContent("#sync-last-success"), successBeforeError);
    await screenshot(a.page, "sync-state-error");
    await a.context.setOffline(true); await a.page.waitForSelector('#sync-feedback[data-sync-state="offline"]');
    await screenshot(a.page, "sync-state-offline");
    await a.context.setOffline(false); await a.page.waitForSelector('#sync-feedback[data-sync-state="synced"]');
    const b = await device({}, authSession(), "", true);
    await b.page.click("#sync-connect");
    await b.page.waitForFunction(() => JSON.parse(localStorage.getItem("tenshi-progress") || "null")?.chapIdx === 1);
    await b.page.waitForSelector("#shelf-resume .shelf-resume-card", { state: "attached" });
    assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).marks[0].note), mark.note);
    assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).books["thien-su-nha-ben"].favorite), true);
    assert.ok(await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "mobile dialog overflows");
    // Two positions edited against the same baseline; one remains local until
    // the person selects the cloud version in the actual conflict UI.
    await Promise.all([a.page, b.page].map((page, i) => page.evaluate((chapIdx) => {
      localStorage.setItem("tenshi-progress", JSON.stringify({ volIdx: 0, chapIdx, timestamp: Date.now() }));
    }, i + 3)));
    await flush(a.page); await flush(b.page);
    await b.page.waitForSelector(".sync-conflict");
    assert.equal(await b.page.getAttribute("#sync-feedback", "data-sync-state"), "conflict");
    await screenshot(b.page, "sync-state-conflict-mobile");
    assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-progress")).chapIdx), 4);
    await b.page.getByRole("button", { name: "Nhận từ đám mây", exact: true }).click();
    await b.page.waitForFunction(() => JSON.parse(localStorage.getItem("tenshi-progress")).chapIdx === 3);
    await b.page.waitForFunction(() => !document.getElementById("sync-now").disabled);
    await b.page.click("#sync-close");
    await b.page.locator('.shelf-card-more summary').first().click();
    await b.page.locator('.shelf-card-more[open] [data-favorite]').click();
    await b.page.click("#btn-sync"); await flush(b.page); await flush(a.page);
    assert.equal(await a.page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).books["thien-su-nha-ben"].favorite), false);
    await b.page.click("#sync-signout"); await b.page.waitForSelector("#sync-login:not([hidden])");
    assert.equal(await b.page.evaluate(() => localStorage.getItem("ketruyen-sync-link-v1")), null);
    const c = await device({ "tenshi-progress": { volIdx: 0, chapIdx: 9, timestamp: 1 } }, authSession(OTHER), USER);
    assert.equal(await c.page.locator("#sync-connect").isVisible(), true);
    assert.equal(records.get(OTHER)?.size || 0, 0, "a different account inherited automatic upload");
    // Exercise signup, reset request and password login without real email.
    await c.page.click("#sync-signout"); await c.page.waitForSelector("#sync-login:not([hidden])");
    await c.page.fill("#sync-email", "reader@example.test"); await c.page.fill("#sync-password", "Sync-test-2026!"); await c.page.click("#sync-signup");
    await c.page.waitForFunction(() => document.getElementById("sync-status").textContent.includes("email xác nhận đăng ký"));
    await c.page.click("#sync-forgot");
    await c.page.waitForFunction(() => document.getElementById("sync-status").textContent.includes("hướng dẫn đặt lại mật khẩu"));
    await c.page.fill("#sync-password", "wrong-password"); await c.page.click("#sync-send");
    await c.page.waitForFunction(() => document.getElementById("sync-status").textContent.includes("Email hoặc mật khẩu chưa đúng"), null, { timeout: 5000 })
      .catch(async (error) => { throw new Error(`Password login feedback: ${await c.page.textContent("#sync-status")}`, { cause: error }); });
    await c.page.fill("#sync-password", "Sync-test-2026!"); await c.page.click("#sync-send");
    await c.page.waitForSelector("#sync-account:not([hidden])");
    assert.equal(await c.page.inputValue("#sync-password"), "");
    assert.equal(await c.page.evaluate(() => JSON.stringify({ ...localStorage }).includes("Sync-test-2026!")), false);
    assert.equal(requests.signup, 1); assert.equal(requests.recovery, 1); assert.equal(requests.login, 2);
    const callback = await device({}, authSession(), "", false, true);
    assert.equal(await callback.page.evaluate(() => location.hash), "");
    const recovery = await device({}, authSession(), "", true, "recovery");
    await recovery.page.fill("#sync-new-password", "Changed-test-2026!"); await recovery.page.fill("#sync-confirm-password", "Changed-test-2026!");
    await recovery.page.click("#sync-reset-save");
    await recovery.page.waitForFunction(() => document.getElementById("sync-status").textContent.includes("Đã đổi mật khẩu"));
    assert.equal(requests.update, 1);
    for (const item of [a, b, c, callback, recovery]) assert.deepEqual(item.errors, []);
    console.log("sync:\n  ✔ merge, conflicts, accounts and password recovery\n  ✔ actual sync check, transfer receipts, loading/success/error/offline states and reduced motion");
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
module.exports = { runSyncChecks, authSession };
