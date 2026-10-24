const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { volumeSlug } = require("../../public/app-routes");

// Exercise the real service worker and network loss, not a mocked onLine flag.
async function runOfflineShelfChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addInitScript(() => localStorage.setItem("tenshi-eink", "off"));
  const json = async (url) => { const r = await fetch(base + url); assert.equal(r.status, 200); return r.json(); };
  try {
    const catalog = await json("/data/series.json");
    const books = [catalog[0], catalog.find((b) => b.slug === "b1k-1922-nam-ac-bao")];
    const saved = await Promise.all(books.map(async (book) => {
      const index = await json(book.index);
      return { book, index, text: await json(index[0].text) };
    }));
    // Start on a non-app document to seed the previous deploy's caches.
    await page.goto(base + "/icons/icon.svg");
    await page.evaluate(async (rows) => {
      const old = await caches.open("tenshi-shell-offline-fixture"), texts = await caches.open("tenshi-text-v1");
      for (const row of rows) {
        await old.put(row.book.index, new Response(JSON.stringify(row.index), { headers: { "Content-Type": "application/json" } }));
        await texts.put(row.index[0].text, new Response(JSON.stringify(row.text), { headers: { "Content-Type": "application/json" } }));
      }
      const images = await caches.open("tenshi-img-v1");
      await images.put("/img/offline-fixture.png", new Response(Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII="), (c) => c.charCodeAt(0)), { headers: { "Content-Type": "image/png" } }));
    }, saved);
    await page.goto(base);
    await page.waitForSelector("body:not(.is-shelf-boot) .shelf-card");
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 45000 });
    // A document can obtain a controller while the activation waitUntil task
    // is still copying caches. Wait for that task's observable completion.
    await page.waitForFunction(async () => {
      const names = await caches.keys();
      return !names.includes("tenshi-shell-offline-fixture") && !names.includes("tenshi-img-v1");
    }, null, { timeout: 45000 });
    const upgraded = await page.evaluate(async (index) => {
      const names = await caches.keys(), shell = await caches.open(names.find((n) => /^tenshi-shell-v\d+$/.test(n)));
      return { oldShellRemoved: !names.includes("tenshi-shell-offline-fixture"), oldImagesRemoved: !names.includes("tenshi-img-v1"), indexKept: Boolean(await shell.match(index)), imageKept: Boolean(await (await caches.open("tenshi-img-v2")).match("/img/offline-fixture.png")) };
    }, books[1].index);
    assert.deepEqual(upgraded, { oldShellRemoved: true, oldImagesRemoved: true, indexKept: true, imageKept: true }, "upgrade discarded cached book indexes or downloaded pictures");
    const ebook = await page.evaluate(async () => {
      const book = await globalThis.EbookImport.parseFile(new File(["Chương 1\n\nNội dung ebook đọc khi mất mạng."], "Sách offline riêng.txt", { type: "text/plain" }));
      await globalThis.EbookImport.save(book); return { slug: book.slug, volume: globalThis.AppRoutes.volumeSlug(book.volumesData[0].dirName) };
    });
    await page.reload(); await page.waitForSelector("body:not(.is-shelf-boot) .shelf-card");
    await page.waitForFunction(() => document.querySelector("#shelf-on-device-count").textContent === "3");
    assert.equal(await page.locator("#shelf-offline-status").isVisible(), false);
    await page.click("#shelf-view-mine");
    assert.equal(await page.locator("#shelf-grid .shelf-card").count(), 3, "personal shelf omitted downloaded books without reading progress");
    if (await page.locator("#shelf-filter-toggle").getAttribute("aria-expanded") === "false") await page.locator("#shelf-filter-toggle").click();
    await page.locator("#shelf-on-device").click();
    assert.equal(await page.locator("#shelf-grid .shelf-card").count(), 3, "filter omitted cached book from another source");
    assert.equal(await page.locator("#shelf-section-tabs").isVisible(), false);
    assert.match(await page.locator("#shelf-grid").innerText(), /1\/13 tập/);
    assert.match(await page.locator('[data-book="thien-su-nha-ben"] .shelf-device-badge').innerText(), /Chưa tải đủ/);
    await page.locator("#shelf-on-device").click();
    await context.setOffline(true);
    await page.waitForSelector("#shelf-offline-status:not([hidden])");
    await page.waitForFunction(() => document.querySelector("#shelf-on-device").getAttribute("aria-pressed") === "true");
    assert.equal(await page.locator("#shelf-grid .shelf-card").count(), 3);
    await page.locator("#shelf-search").fill("Sách offline riêng");
    assert.equal(await page.locator("#shelf-grid .shelf-card").count(), 1);
    await page.locator("#shelf-search").fill("");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const output = process.env.OFFLINE_PREVIEW_DIR;
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); for (const a of document.getAnimations()) if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish(); });
      await page.screenshot({ path: path.join(output, "offline-mobile.png"), fullPage: true });
    }
    await page.locator("#shelf-grid .shelf-card").filter({ hasText: books[1].titleVi }).click();
    await page.waitForSelector("#view-home.active");
    assert.equal(await page.locator("#tab-library-saved").getAttribute("aria-selected"), "true");
    await page.waitForSelector(".download-open");
    // Both the saved online book and imported ebook must open on a fresh load.
    for (const route of [`/truyen/${books[1].slug}/${volumeSlug(saved[1].index[0].dirName)}/0`, `/truyen/${ebook.slug}/${ebook.volume}/0`]) {
      await page.goto(base + route); await page.waitForSelector('body[data-view="reader"] .reader-content p');
      assert.ok((await page.locator(".reader-content").first().innerText()).trim().length > 10);
      assert.equal(await page.locator("#shelf-offline-status").isVisible(), false, "offline shelf notice leaked into reader");
    }
    await page.goto(base); await page.waitForSelector("#shelf-offline-status:not([hidden])");
    await page.waitForFunction(() => document.querySelectorAll("#shelf-grid .shelf-card").length === 3);
    // Removing local content must not keep a stale promise of offline access.
    await page.evaluate(async (slug) => {
      await globalThis.EbookImport.remove(slug); await caches.delete("tenshi-text-v1");
    }, ebook.slug);
    await page.reload(); await page.waitForFunction(() => document.querySelector(".shelf-empty-title")?.textContent === "Chưa có sách đọc offline trên máy này");
    assert.match(await page.locator(".shelf-empty").innerText(), /Chưa có sách đọc offline/);
    await page.locator(".shelf-empty button").click();
    assert.equal(await page.locator("#shelf-on-device").getAttribute("aria-pressed"), "false");
    await context.setOffline(false);
    await page.waitForSelector("#shelf-offline-status[hidden]", { state: "attached" });
    assert.equal(await page.locator("#shelf-on-device").getAttribute("aria-pressed"), "false", "reconnection changed user's filter");
    assert.deepEqual(errors, []);
    console.log("  ✔ offline shelf: real SW upgrade, local filter across sources, cached book + ebook reload, empty state and reconnect");
  } finally { await context.close(); }
}
module.exports = { runOfflineShelfChecks };
