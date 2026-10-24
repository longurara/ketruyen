const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");

async function runShelfUIChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addInitScript(() => localStorage.setItem("tenshi-eink", "off"));
  let releaseIndex, failIndex = true;
  const indexGate = new Promise((resolve) => { releaseIndex = resolve; });
  const indexPath = "/data/b1k-1922-nam-ac-bao/index.json";
  await context.route("**" + indexPath, async (route) => { if (failIndex) { await indexGate; return route.abort(); } return route.continue(); });
  const shot = async (name) => {
    if (!process.env.SHELF_UI_PREVIEW_DIR) return;
    fs.mkdirSync(process.env.SHELF_UI_PREVIEW_DIR, { recursive: true });
    await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(process.env.SHELF_UI_PREVIEW_DIR, name + ".png"), fullPage: false, animations: "disabled" });
  };
  try {
    await page.goto(base); await page.waitForSelector("#shelf-grid .shelf-card");
    assert.equal(await page.locator("#shelf-view-discover").getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#shelf-grid .shelf-card").count(), 24);
    assert.equal(await page.locator("#shelf-resume").isVisible(), false);
    assert.equal(await page.locator("#shelf-journal.is-compact").count(), 1);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector("#shelf-grid").compareDocumentPosition(document.querySelector("#shelf-recommendation")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    await page.click("#shelf-load-more"); assert.equal(await page.locator("#shelf-grid .shelf-card").count(), 48);
    await page.click("#shelf-view-mine"); await page.waitForSelector(".shelf-empty");
    assert.match(await page.locator(".shelf-empty").innerText(), /Một kệ sách dành riêng/);
    await page.click(".shelf-empty button");
    assert.equal(await page.locator("#shelf-view-discover").getAttribute("aria-selected"), "true");
    await page.click("#tab-shelf-b1k");
    const item = page.locator('[data-book="b1k-1922-nam-ac-bao"]');
    await item.locator(".shelf-card").click();
    await page.waitForFunction(() => document.querySelector('[data-book="b1k-1922-nam-ac-bao"] .shelf-card')?.getAttribute("aria-busy") === "true");
    assert.equal(await item.locator(".shelf-card").isDisabled(), true);
    assert.equal(await page.locator("#shelf-search").isEnabled(), true, "one book load blocked library controls");
    releaseIndex(); await item.locator(".shelf-card-feedback button").waitFor();
    assert.match(await item.locator(".shelf-card-feedback").innerText(), /Chưa tải được mục lục/);
    failIndex = false; await item.locator(".shelf-card-feedback button").click(); await page.waitForSelector("#view-home.active");
    await page.goto(base); await page.waitForSelector("#shelf-grid .shelf-card"); await page.click("#tab-shelf-b1k");
    await item.locator(".shelf-card-more summary").click(); await item.locator("[data-favorite]").click();
    await page.click("#shelf-view-mine");
    assert.equal(await page.locator("#shelf-grid .shelf-card").count(), 1, "personal shelf included unrelated catalog books");
    assert.equal(await item.count(), 1, "favorite from another source disappeared");
    assert.equal(await page.locator("#shelf-section-tabs").isVisible(), false);
    await page.reload(); await page.waitForSelector("#shelf-grid .shelf-card");
    assert.equal(await page.locator("#shelf-view-mine").getAttribute("aria-selected"), "true", "view choice was not remembered");
    const ebook = await page.evaluate(async () => {
      const book = await globalThis.EbookImport.parseFile(new File(["Chương 1\n\nDấu tiếng Việt và chỗ dừng được giữ nguyên."], "Một cuốn sách với tựa đề rất dài để kiểm tra đầy đủ dấu tiếng Việt trên điện thoại.txt", { type: "text/plain" }));
      await globalThis.EbookImport.save(book);
      localStorage.setItem("tenshi-progress", JSON.stringify({ volIdx: 0, chapIdx: 1, timestamp: Date.now() }));
      localStorage.setItem("tenshi-chapters", JSON.stringify({ "0:1": { done: true, pct: 100 } }));
      return book.slug;
    });
    await page.reload(); await page.waitForSelector(".shelf-feature.is-reading");
    await page.waitForFunction((slug) => document.querySelector(`[data-book="${slug}"] .shelf-device-badge`)?.textContent.includes("Trên máy"), ebook);
    assert.equal(await page.locator("#shelf-resume .shelf-feature").count(), 1);
    assert.equal(await page.locator("#shelf-grid .shelf-card").count(), 3);
    assert.equal(await page.locator('[data-book="thien-su-nha-ben"] .shelf-book-progress').count(), 1);
    assert.match(await page.locator('[data-book="thien-su-nha-ben"] .shelf-book-position').innerText(), /Tập 1 · Chương 1\s*:\s*Gặp Gỡ Thiên Sứ/);
    await shot("mine-desktop");
    for (const [name, viewport, theme] of [["mine-mobile", { width: 390, height: 844 }, "light"], ["mine-mobile-dark", { width: 390, height: 844 }, "dark"], ["mine-landscape", { width: 844, height: 390 }, "dark"]]) {
      await page.setViewportSize(viewport); await page.evaluate((t) => { document.body.dataset.theme = t; }, theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, name + " overflows horizontally");
      await shot(name);
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#shelf-view-mine").focus(); await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#shelf-view-discover").getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(`[data-book="${ebook}"]`).count(), 0, "personal ebook leaked into discovery catalog");
    // Failure to fetch the catalog retains local ebooks and offers a local retry.
    let failCatalog = true;
    await context.route("**/data/series.json", (route) => failCatalog ? route.abort() : route.continue());
    await page.reload(); await page.waitForSelector("#shelf-source-status:not([hidden])");
    await page.click("#shelf-view-mine"); await page.locator(`[data-book="${ebook}"]`).waitFor();
    await page.click("#shelf-view-discover"); failCatalog = false;
    await page.click("#shelf-source-retry"); await page.waitForSelector("#shelf-source-status[hidden]", { state: "attached" });
    await page.waitForSelector("#shelf-grid .shelf-card");
    await page.click("#shelf-view-mine"); assert.equal(await page.locator(`[data-book="${ebook}"]`).count(), 1);
    assert.deepEqual(errors, []);
    console.log("  ✔ shelf UI: personal/discovery boundaries, remembered view, compact journal/hero, pagination, local book retry, progress/status, responsive Vietnamese, keyboard and catalog recovery");
  } finally { releaseIndex(); await context.close(); }
}
module.exports = { runShelfUIChecks };
