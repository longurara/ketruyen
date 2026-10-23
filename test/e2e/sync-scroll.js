const assert = require("node:assert/strict");
const { authSession } = require("./sync");

async function runSyncScrollChecks(browser, base) {
  const session = authSession(), engine = browser.browserType().name();
  const rows = Array.from({ length: 10 }, (_, i) => ({ record_key: `mark/scroll-${i}`, value: { id: `scroll-${i}`, slug: "thien-su-nha-ben", volIdx: 0, chapIdx: 1, note: "Ghi chú trên cloud" }, revision: 1 }));
  // WebKit does not support wheel input in its mobile emulation; use its
  // responsive viewport for native wheel checks, and Chromium for touch swipes.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: engine === "chromium", hasTouch: engine === "chromium", serviceWorkers: "block" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await context.route("https://*.supabase.co/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/user")) return route.fulfill({ json: session.user });
      if (url.pathname.endsWith("/rpc/reader_device_register")) return route.fulfill({ status: 404, json: { code: "PGRST202" } });
      if (url.pathname.endsWith("/reader_sync_records")) return route.fulfill({ json: rows });
      if (url.pathname.endsWith("/rpc/reader_sync_apply")) return route.fulfill({ json: [] });
      return route.abort();
    });
    await context.addInitScript((session) => {
      localStorage.setItem("ketruyen-auth-v1", JSON.stringify(session));
      localStorage.setItem("ketruyen-sync-link-v1", session.user.id);
      localStorage.setItem("tenshi-eink", "off");
      localStorage.setItem("tenshi-library-v1", JSON.stringify({ version: 1, books: {}, marks: Array.from({ length: 10 }, (_, i) => ({ id: `scroll-${i}`, slug: "thien-su-nha-ben", volIdx: 0, chapIdx: 1, note: "Ghi chú trên máy" })) }));
    }, session);
    await page.goto(base); await page.waitForSelector(".ebook-shelf-item");
    await page.evaluate(() => window.scrollTo(0, 350));
    await page.click("#btn-sync"); await page.waitForSelector('#sync-feedback[data-sync-state="conflict"]');
    // Ten real CAS conflicts keep the fixture stable across background renders.
    async function scrollBothWays(label) {
      const geometry = await page.locator(".sync-body").evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, overflow: getComputedStyle(el).overflowY, touch: getComputedStyle(el).touchAction }));
      assert.equal(geometry.overflow, "auto", `${engine}/${label}: content has no scroll container`);
      assert.ok(geometry.scroll > geometry.client + 200, `${engine}/${label}: fixture is not long enough`);
      assert.ok(geometry.touch.includes("pan-y"));
      await page.locator(".sync-body").evaluate((el) => { el.scrollTop = 0; });
      const box = await page.locator(".sync-body").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(100, box.height / 2));
      await page.mouse.wheel(0, 450);
      await page.waitForFunction(() => document.querySelector(".sync-body").scrollTop > 50);
      const down = await page.locator(".sync-body").evaluate((el) => el.scrollTop);
      await page.mouse.wheel(0, -300);
      await page.waitForFunction((down) => document.querySelector(".sync-body").scrollTop < down - 30, down);
      await page.locator(".sync-body").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForFunction(() => { const el = document.querySelector(".sync-conflict:last-child button:last-child"), box = el?.getBoundingClientRect(); return box && box.top >= 0 && box.bottom <= innerHeight; });
      const last = await page.locator(".sync-conflict:last-child button:last-child").boundingBox();
      assert.ok(last.y >= 0 && last.y + last.height <= page.viewportSize().height, `${engine}/${label}: final action is clipped`);
      assert.equal(await page.locator("body").evaluate((el) => el.style.position), "fixed", "background reader was unlocked to enable scrolling");
    }
    await scrollBothWays("portrait");
    if (engine === "chromium") {
      const cdp = await context.newCDPSession(page);
      await page.locator(".sync-body").evaluate((el) => { el.scrollTop = 0; });
      const box = await page.locator(".sync-body").boundingBox(), x = box.x + box.width / 2, y = box.y + box.height * .75;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 12; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 16 }] });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForFunction(() => document.querySelector(".sync-body").scrollTop > 50);
      await cdp.detach();
    }
    await page.locator("#sync-close").click();
    assert.equal(await page.locator("body").evaluate((el) => el.style.position), "");
    await page.click("#btn-sync");
    await page.locator("#sync-dialog .reader-sheet-handle").click();
    await scrollBothWays("expanded");
    await page.setViewportSize({ width: 844, height: 390 });
    await scrollBothWays("landscape");
    assert.deepEqual(errors, []);
    console.log(`sync scrolling (${engine}):\n  ✔ portrait/expanded/landscape, up/down, final conflict action, locked background and close`);
  } finally { await context.close(); }
}
module.exports = { runSyncScrollChecks };
