const assert = require("node:assert/strict");
async function runRemoveReadingChecks(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
  async function reveal(slug) {
    const target = page.locator('[data-dismiss-reading="' + slug + '"]'); await target.waitFor({state:'attached'});
    if (await target.isVisible()) return;
    const other = page.locator('.shelf-other-reading');
    if (await other.count() && await other.locator('[data-dismiss-reading="' + slug + '"]').count()) await other.locator(':scope > summary').click();
    else await page.locator('.shelf-resume-details > summary').click();
  }
  try {
    await page.goto(base); await page.waitForSelector(".ebook-shelf-item");
    const { slug, volume } = await page.evaluate(async () => {
      const book = await globalThis.EbookImport.parseFile(new File(["Chương 1\n\nNội dung thử bỏ sách khỏi Đang đọc.\n\nĐoạn hai."], "Giữ tiến độ.txt", { type: "text/plain" }));
      await globalThis.EbookImport.save(book);
      const saved = { volIdx: 0, chapIdx: 0, timestamp: Date.now() };
      localStorage.setItem(`tenshi-${book.slug}-progress`, JSON.stringify(saved)); localStorage.setItem("tenshi-progress", JSON.stringify({ ...saved, timestamp: saved.timestamp - 1 }));
      return { slug: book.slug, volume: globalThis.AppRoutes.volumeSlug(book.volumesData[0].dirName) };
    });
    await page.reload(); await page.waitForSelector(`[data-dismiss-reading="${slug}"]`, {state:"attached"});
    await reveal("thien-su-nha-ben"); await page.locator('[data-dismiss-reading="thien-su-nha-ben"]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-library-v1")).books["thien-su-nha-ben"].status), null);
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("tenshi-progress")).timestamp));
    assert.equal(await page.locator('[data-dismiss-reading="thien-su-nha-ben"]').count(), 0);
    await reveal(slug); await page.locator(`[data-dismiss-reading="${slug}"]`).click();
    await page.click("#reading-cancel");
    assert.equal(await page.locator(`[data-dismiss-reading="${slug}"]`).count(), 1, "cancel removed reading state");
    await reveal(slug); await page.locator(`[data-dismiss-reading="${slug}"]`).click(); await page.click("#reading-keep-ebook");
    assert.equal(await page.locator(`[data-dismiss-reading="${slug}"]`).count(), 0);
    assert.ok(await page.evaluate(async (slug) => Boolean(await globalThis.EbookImport.get(slug)), slug));
    assert.ok(await page.evaluate((slug) => JSON.parse(localStorage.getItem(`tenshi-${slug}-progress`)).timestamp, slug));
    await page.reload(); await page.waitForSelector(".ebook-shelf-item");
    assert.equal(await page.locator(`[data-dismiss-reading="${slug}"]`).count(), 0, "cleared state disappeared after reload");
    await page.goto(`${base}/truyen/${slug}/${volume}/0`); await page.waitForSelector('body[data-view="reader"]');
    assert.equal(await page.evaluate((slug) => JSON.parse(localStorage.getItem("tenshi-library-v1")).books[slug].status, slug), "reading", "opening the ebook did not resume reading state");
    await page.goto(base); await page.waitForSelector(`[data-dismiss-reading="${slug}"]`, {state:"attached"});
    await reveal(slug); await page.locator(`[data-dismiss-reading="${slug}"]`).click();
    await Promise.all([page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()), page.click("#reading-delete-ebook")]);
    await page.waitForSelector(".ebook-shelf-item");
    assert.equal(await page.evaluate((slug) => JSON.parse(localStorage.getItem("tenshi-library-v1")).books[slug].status, slug), null);
    assert.equal(await page.evaluate((slug) => globalThis.EbookImport.get(slug), slug), undefined);
    assert.ok(await page.evaluate((slug) => JSON.parse(localStorage.getItem(`tenshi-${slug}-progress`)).timestamp, slug));
    assert.ok(await page.evaluate((slug) => JSON.parse(localStorage.getItem("ketruyen-ebook-ignored-v1")).includes(slug), slug));
    assert.deepEqual(errors, []);
    console.log("reading shelf:\n  ✔ online status only, ebook keep/delete choices, cancel, persistence, preserved progress and resume on reopening");
  } finally { await context.close(); }
}
module.exports = { runRemoveReadingChecks };
