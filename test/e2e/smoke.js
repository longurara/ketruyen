// Browser smoke test: starts server.js and walks the main pages in Chromium
// at desktop and phone size. Run with `npm run test:e2e` (needs
// `npx playwright install chromium` once).
//
// Pictures may be missing (CI checks out the code without public/img), so
// failed resource loads are ignored; script errors are not.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");

const PORT = Number(process.env.E2E_PORT) || 3123;
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(__dirname, "..", "..", "e2e-screenshots");

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { ...devices["Pixel 7"] }
};

async function startServer() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, "..", ".."),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server.js did not start within 15s")), 15000);
    server.stdout.on("data", (chunk) => { if (String(chunk).includes(`localhost:${PORT}`)) { clearTimeout(timer); resolve(); } });
    server.on("exit", (code) => reject(new Error(`server.js exited with ${code}`)));
  });
  return server;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function noSidewaysScroll(page, where) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  check(scroll <= width + 1, `${where}: page scrolls sideways (${scroll}px content in ${width}px)`);
}

// Opens a page by its address, the way a shared link would.
async function open(page, pathname) {
  await page.goto(`${BASE}${pathname}`, { waitUntil: "domcontentloaded" });
}

async function run(name, context) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) errors.push(`console: ${message.text()}`);
  });
  // E-ink page turns only slow the walk down.
  await page.addInitScript(() => { try { localStorage.setItem("tenshi-eink", "off"); } catch (_) {} });
  const steps = [];
  const step = async (label, body) => {
    try {
      await body();
      steps.push(`  ✔ ${label}`);
    } catch (error) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${name}-${label.replace(/\W+/g, "-")}.png`), fullPage: false }).catch(() => {});
      throw new Error(`[${name}] ${label}: ${error.message}`, { cause: error });
    } finally {
      console.log(steps.splice(0).join("\n") || "");
    }
  };

  await step("shelf loads", async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ebook-shelf-item", { timeout: 20000 });
    check(await page.locator(".ebook-shelf-item").count() > 0, "no books on the shelf");
    await noSidewaysScroll(page, "shelf");
  });

  await step("shelf tabs switch collections", async () => {
    await page.click("#tab-shelf-b1k");
    await page.waitForSelector("#shelf-b1k-subtabs:not([hidden])");
    const first = await page.locator(".ebook-shelf-item").first().getAttribute("data-book");
    check(first?.startsWith("b1k-"), `Tủ Sách 1000 tab shows ${first}`);
    await noSidewaysScroll(page, "Tủ Sách 1000 tab");
    await page.click("#tab-shelf-main");
  });

  await step("search with no results offers to clear it", async () => {
    await page.fill("#shelf-search", "zzzxqq không có sách này");
    await page.waitForSelector(".shelf-empty button");
    await page.click(".shelf-empty button");
    await page.waitForSelector(".ebook-shelf-item");
    check(await page.inputValue("#shelf-search") === "", "search box was not cleared");
  });

  await step("book menu: favourite and keyboard", async () => {
    await page.locator(".shelf-card-more summary").first().click();
    await page.waitForSelector(".shelf-card-more[open] [data-favorite]");
    // The menu moves focus to its first item once it has opened.
    await page.waitForFunction(() => document.activeElement?.matches(".shelf-more-menu button"), null, { timeout: 2000 });
    await page.keyboard.press("Escape");
    check(await page.locator(".shelf-card-more[open]").count() === 0, "Escape left the menu open");
    await page.locator(".shelf-card-more summary").first().click();
    await page.click(".shelf-card-more[open] [data-favorite]");
    await page.waitForSelector(".shelf-favorite-badge");
    await page.locator(".shelf-card-more summary").first().click();
    await page.click(".shelf-card-more[open] [data-favorite]");
    await page.waitForFunction(() => !document.querySelector(".shelf-favorite-badge"));
  });

  await step("cover grid view", async () => {
    await page.click('[data-shelf-density="grid"]');
    check(await page.locator("#shelf-grid.is-covers").count() === 1, "grid view did not switch");
    await noSidewaysScroll(page, "cover grid");
    await page.click('[data-shelf-density="list"]');
    check(await page.locator("#shelf-grid.is-covers").count() === 0, "list view did not switch back");
  });

  await step("new reader sees suggestions", async () => {
    check(/Bắt đầu với/.test(await page.textContent("#shelf-resume")), "no suggestions for a first visit");
    const title = await page.textContent(".shelf-feature h2");
    await page.click(".shelf-change-pick");
    check(await page.textContent(".shelf-feature h2") !== title, "changing the recommendation kept the same book");
    check(/Gọn trong một tập/.test(await page.textContent(".shelf-feature-reason")), "recommendation has no reason");
    await noSidewaysScroll(page, "featured book");
  });

  await step("personal shortcuts find books across collections", async () => {
    await page.click("#tab-shelf-b1k");
    const slug = await page.locator(".ebook-shelf-item").first().getAttribute("data-book");
    await page.locator(".shelf-card-more summary").first().click();
    await page.click(".shelf-card-more[open] [data-favorite]");
    await page.click('[data-shelf-quick="all"]');
    await page.click("#tab-shelf-main");
    await page.click('[data-shelf-quick="favorite"]');
    check(await page.locator(".ebook-shelf-item").count() === 1, "favorites includes unselected books");
    check(await page.locator(".ebook-shelf-item").first().getAttribute("data-book") === slug, "favorite from another collection was hidden");
    check(await page.locator('[data-shelf-quick="favorite"]').getAttribute("aria-pressed") === "true", "favorite shortcut is not selected");
    await page.locator(".shelf-card-more summary").first().click();
    await page.click(".shelf-card-more[open] [data-favorite]");
    await page.waitForSelector(".shelf-empty");
    await noSidewaysScroll(page, "empty personal shelf");
    await page.click('[data-shelf-quick="all"]');
    await page.click('#shelf-shortcuts [data-library-action="marks"]');
    await page.waitForSelector("#workbench-dialog[open]");
    check(/Đánh dấu & Ghi chú/.test(await page.textContent("#workbench-dialog")), "notes shortcut did not open annotations");
    await page.keyboard.press("Escape");
  });

  if (name === "desktop") {
    await step("keyboard shortcuts", async () => {
      await page.locator("body").click({ position: { x: 4, y: 400 } });
      await page.keyboard.press("?");
      await page.waitForSelector(".app-shortcuts[open]");
      await page.keyboard.press("Escape");
      await page.keyboard.press("/");
      check(await page.evaluate(() => document.activeElement?.id) === "shelf-search", "/ did not focus the search box");
      await page.keyboard.press("Escape");
    });
  }

  await step("series page", async () => {
    await open(page, "/truyen/thien-su-nha-ben");
    await page.waitForSelector("#view-home.active");
    check((await page.textContent("#series-title-vi")).trim() === "Thiên Sứ Nhà Bên", "wrong series title");
    check((await page.textContent("#series-kind")).trim() === "Light novel", "wrong series label");
    await noSidewaysScroll(page, "series page");
  });

  await step("volume contents", async () => {
    await open(page, "/truyen/thien-su-nha-ben/tap-1");
    await page.waitForSelector("#view-volume.active");
    await noSidewaysScroll(page, "volume page");
  });

  await step("reader shows chapter text", async () => {
    await open(page, "/truyen/thien-su-nha-ben/tap-1/1");
    await page.waitForSelector("#view-reader.active .reader-content p", { timeout: 20000 });
    check(await page.locator(".reader-content p").count() > 5, "chapter has almost no paragraphs");
    await noSidewaysScroll(page, "reader");
  });

  await step("featured resume returns to the saved chapter", async () => {
    await open(page, "/");
    await page.waitForSelector(".shelf-feature.is-reading");
    check(/Thiên Sứ Nhà Bên/.test(await page.textContent(".is-reading h2")), "featured resume shows another book");
    check(await page.locator('.is-reading [role="progressbar"]').count() === 1, "resume is missing its progress");
    await noSidewaysScroll(page, "featured resume");
    await page.click('.is-reading .shelf-feature-button');
    await page.waitForSelector("#view-reader.active .reader-content p");
    check(await page.evaluate(() => location.pathname) === "/truyen/thien-su-nha-ben/tap-1/1", "resume did not return to the saved chapter");
  });

  await step("text alignment setting", async () => {
    await page.evaluate(() => document.querySelector("#btn-settings").click());
    await page.waitForSelector("#text-align-switch");
    await page.evaluate(() => document.querySelector('#text-align-switch [data-align-value="start"]').click());
    check(await page.$eval(".reader-content p:nth-of-type(3)", (p) => getComputedStyle(p).textAlign) === "start", "Căn trái did not apply");
    await page.evaluate(() => document.querySelector("#btn-text-reset").click());
    check(await page.evaluate(() => document.documentElement.dataset.textAlign) === "auto", "reset did not restore Tự động");
    await page.keyboard.press("Escape");
  });

  await step("auto-scroll moves the page and stops", async () => {
    await page.evaluate(() => scrollTo(0, 0));
    const before = await page.evaluate(() => scrollY);
    await page.evaluate(() => document.querySelector("#settings-panel [data-auto-start]").click());
    await page.waitForSelector("#auto-scroll-bar:not([hidden])");
    await page.waitForFunction((start) => scrollY > start + 5, before, { timeout: 8000 });
    await page.click('[data-auto="stop"]');
    check(await page.locator("#auto-scroll-bar[hidden]").count() === 1, "auto-scroll bar stayed open");
  });

  await step("page mode turns whole pages", async () => {
    await page.evaluate(() => { scrollTo(0, 0); document.querySelector('#page-mode-switch [data-page-value="on"]').click(); });
    check(await page.evaluate(() => getComputedStyle(document.documentElement).overflow) === "hidden", "page still scrolls freely");
    const before = await page.evaluate(() => scrollY);
    if (name === "desktop") await page.keyboard.press("ArrowRight");
    else await page.touchscreen.tap(Math.round(page.viewportSize().width * 0.9), 420);
    await page.waitForFunction((start) => scrollY > start + 200, before, { timeout: 5000 });
    check(/Trang 2 \//.test(await page.textContent("#page-indicator")), "page number did not advance");
    await page.evaluate(() => document.querySelector('#page-mode-switch [data-page-value="off"]').click());
    check(await page.evaluate(() => getComputedStyle(document.documentElement).overflow) !== "hidden", "scroll mode did not come back");
  });

  if (name === "mobile") {
    await step("swipe moves to the next chapter", async () => {
      const cdp = await context.newCDPSession(page);
      const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: 420 }] });
      await touch("touchStart", 320);
      for (let i = 1; i <= 5; i++) await touch("touchMove", 320 - i * 45);
      await touch("touchEnd", 95);
      await page.waitForFunction(() => location.pathname.endsWith("/tap-1/2"), null, { timeout: 5000 });
    });
  }

  await step("resetting progress can be undone", async () => {
    await open(page, "/truyen/thien-su-nha-ben/tap-1");
    await page.waitForSelector("#btn-reset-volume:not([hidden])");
    const before = await page.evaluate(() => localStorage.getItem("tenshi-chapters"));
    await page.click("#btn-reset-volume");
    await page.waitForSelector("#app-toast:not([hidden]) button");
    await page.click("#app-toast button");
    await page.waitForFunction(() => /khôi phục/.test(document.querySelector("#app-toast").textContent));
    check(await page.evaluate(() => localStorage.getItem("tenshi-chapters")) === before, "undo did not restore chapter progress");
  });

  await step("old #/ links open the page at its new address", async () => {
    await open(page, "/#/thien-su-nha-ben/tap-1");
    await page.waitForSelector("#view-volume.active");
    check(await page.evaluate(() => location.pathname + location.hash) === "/truyen/thien-su-nha-ben/tap-1", "address was not rewritten");
  });

  await step("bad link falls back and says so", async () => {
    await open(page, "/truyen/khong-co-sach-nay");
    await page.waitForSelector("#view-shelf.active");
    await page.waitForSelector("#app-toast:not([hidden])");
    check(/Không tìm thấy/.test(await page.textContent("#app-toast")), "no not-found message");
  });

  await step("Tủ Sách 1000 page shows its topic", async () => {
    await open(page, "/truyen/b1k-1922-nam-ac-bao");
    await page.waitForSelector("#view-home.active");
    check((await page.textContent("#series-kind")).trim() !== "Light novel", "Tủ Sách 1000 book labelled Light novel");
  });

  check(!errors.length, `[${name}] script errors:\n    ${errors.join("\n    ")}`);
  await page.close();
}

// Shared links: the server names the book in the page itself.
async function checkLinkPreviews() {
  const res = await fetch(`${BASE}/truyen/thien-su-nha-ben/tap-1`);
  const html = await res.text();
  check(res.status === 200, `book page answered ${res.status}`);
  check(/<title>Tập 1 · Thiên Sứ Nhà Bên<\/title>/.test(html), "book page has the generic title");
  check(/<link rel="canonical" href="[^"]+\/truyen\/thien-su-nha-ben\/tap-1">/.test(html), "book page has no canonical link");
  check((await fetch(`${BASE}/truyen/khong-co-sach-nay`)).status === 404, "missing book is not a 404");
  console.log("link previews:\n  ✔ book pages carry their own title and address");
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  let failed = false;
  try {
    try {
      await checkLinkPreviews();
    } catch (error) {
      failed = true;
      console.error(`✖ link previews: ${error.message}`);
    }
    for (const [name, options] of Object.entries(VIEWPORTS)) {
      console.log(`${name}:`);
      const context = await browser.newContext({ ...options, serviceWorkers: "block" });
      try {
        await run(name, context);
      } catch (error) {
        failed = true;
        console.error(`✖ ${error.message}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failed ? 1 : 0);
})();
