const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
async function runUIPolishChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addInitScript(() => { localStorage.setItem("tenshi-eink", "off"); localStorage.setItem("tenshi-progress", JSON.stringify({ volIdx: 0, chapIdx: 1, timestamp: Date.now() })); });
  const capture = async (name) => {
    if (!process.env.UI_POLISH_PREVIEW_DIR) return;
    fs.mkdirSync(process.env.UI_POLISH_PREVIEW_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.UI_POLISH_PREVIEW_DIR, name + ".png"), animations: "disabled" });
  };
  const fits = async (label) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, label + " overflows");
  try {
    await page.goto(base); await page.waitForSelector("#shelf-grid .shelf-card");
    await page.evaluate(async () => { await document.fonts.ready; });
    for (const [name, width, height, limit] of [["mobile",390,844,480],["small",320,568,480],["desktop",1440,900,560]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0,0));
      assert.ok(await page.locator("#shelf-grid .shelf-card").first().evaluate((e) => e.getBoundingClientRect().top) < limit, name + " books are below the agreed fold");
      await fits(name); await capture("shelf-" + name);
    }
    assert.match(await page.locator("#shelf-grid").innerText(), /182 chương · 12 phần minh họa/);
    assert.doesNotMatch(await page.locator("#shelf-grid").innerText(), /194 chương/);
    await page.setViewportSize({ width:390, height:844 });
    await page.locator(".shelf-card-more summary").first().click(); await page.locator("[data-manage]").first().click();
    await page.fill("#book-group-draft", "Đọc mùa thu"); await page.locator("#book-group-draft").press("Enter");
    assert.match(await page.locator(".book-group-chips").innerText(), /Đọc mùa thu/);
    await page.click("#workbench-library-return");
    assert.equal(await page.locator("#book-edit-form").isVisible(), true, "navigation discarded group draft");
    await page.locator('#book-edit-form [type="submit"]').click();
    await page.waitForSelector("#workbench-dialog:not([open])", { state:"attached" });
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).books["thien-su-nha-ben"].groups), ["Đọc mùa thu"]);
    await page.locator(".shelf-card-more summary").first().click(); await page.locator("[data-manage]").first().click();
    await page.locator('.book-group-chips button').click(); await page.locator('[data-draft-cancel]').click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).books["thien-su-nha-ben"].groups), ["Đọc mùa thu"], "cancel saved group changes");
    await page.click("#shelf-journal-open");
    assert.equal(await page.locator(".journal-filters").isHidden(), true);
    await page.click("#journal-write");
    assert.equal(await page.locator(".journal-extra").getAttribute("open"), null);
    await page.fill('#journal-form [name="text"]', "Một cảm nhận tiếng Việt mới.");
    await page.locator('#journal-form [name="rating"]').selectOption("5");
    await page.locator(".journal-extra > summary").click();
    await page.locator('#journal-form [name="started"]').fill("2020-01-01");
    await page.locator(".journal-extra > summary").click();
    assert.equal(await page.locator('#journal-form [name="text"]').inputValue(), "Một cảm nhận tiếng Việt mới.");
    await page.locator('#journal-form [type="submit"]').click();
    await page.waitForSelector("#journal-results [data-journal-edit]");
    await page.click("#journal-filter-toggle"); await page.selectOption("#journal-rating", "5");
    await page.click("#journal-filter-toggle"); assert.equal(await page.locator(".journal-filters").isHidden(), true);
    assert.match(await page.locator("#journal-filter-toggle").innerText(), /1/);
    await page.click("#journal-filter-toggle"); assert.equal(await page.inputValue("#journal-rating"), "5");
    await page.click("#journal-filter-clear"); assert.equal(await page.inputValue("#journal-rating"), "");
    await capture("journal"); await page.click("#journal-close");
    await page.goto(base + "/truyen/thien-su-nha-ben"); await page.waitForSelector("#view-home.active");
    assert.equal(await page.textContent("#stat-chapters"), "182"); assert.equal(await page.locator("#series-info").getAttribute("open"), null);
    assert.equal(await page.locator("#series-title-jp").isVisible(), false);
    await page.locator("#series-info > summary").click(); assert.equal(await page.locator("#series-title-jp").isVisible(), true);
    await page.goto(base + "/truyen/thien-su-nha-ben/tap-1"); await page.waitForSelector("#view-volume.active");
    assert.equal(await page.locator("#btn-filter-story").getAttribute("class").then((c) => c.includes("is-active")), true);
    assert.match(await page.locator("#volume-chapter-count").innerText(), /14 chương · 1 phần minh họa/);
    await capture("volume");
    await page.goto(base + "/truyen/thien-su-nha-ben/tap-1/1"); await page.waitForSelector(".reader-content p");
    const font = await page.locator(".reader-content p").first().evaluate((e) => getComputedStyle(e).fontSize);
    await page.click("#btn-bottom-tools"); await page.waitForSelector("#workbench-home-panel:not([hidden])");
    assert.equal(await page.locator(".workbench-home-quick button").count(), 4);
    await page.fill("#workbench-search", "nhan vat"); await page.click('[data-home-action="characters"]');
    assert.match(await page.locator("#workbench-title").innerText(), /Nhân vật/);
    await page.click("#workbench-library-return"); await page.fill("#workbench-search", "");
    await capture("utilities");
    await page.locator('#workbench-dialog .tools-close').click();
    await page.click("#btn-reader-tools"); assert.match(await page.locator("#workbench-title").innerText(), /Thống kê/);
    await page.locator('#workbench-dialog .tools-close').click();
    await page.click("#btn-settings"); await page.click("#settings-tab-appearance"); await page.locator('#ui-size-switch [data-ui-size="large"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem("tenshi-ui-size-v1")), "large");
    await page.click("#btn-settings-close");
    assert.equal(await page.locator(".reader-content p").first().evaluate((e) => getComputedStyle(e).fontSize), font, "UI size changed reading text");
    assert.equal(await page.evaluate(async () => {
      const blob = await globalThis.LibraryBackup.exportData(() => {}), data = await globalThis.LibraryBackup.readBackup(blob, () => {});
      return data.settings["tenshi-ui-size-v1"];
    }), "large");
    await page.reload(); await page.waitForSelector(".reader-content p");
    assert.equal(await page.getAttribute("body", "data-ui-size"), "large");
    await page.goto(base); await page.waitForSelector("#shelf-grid .shelf-card");
    for (const [theme,width,height] of [["light",320,568],["sepia",390,844],["dark",844,390],["dark",1440,900]]) {
      await page.setViewportSize({width,height}); await page.evaluate((v) => { document.body.dataset.theme = v; }, theme);
      await fits("large-" + theme); await capture("large-" + theme + "-" + width);
    }
    assert.deepEqual(errors, []);
    console.log("  ✔ UI polish: fold budgets, story/image counts, source controls, draft-safe group chips, journal filters/forms, utility search, stable header actions, independent backed-up UI size and responsive large type");
  } finally { await context.close(); }
}
module.exports = { runUIPolishChecks };
