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

async function go(page, hash) {
  await page.evaluate((target) => { location.hash = target; }, hash);
  await page.waitForTimeout(400);
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

  await step("series page", async () => {
    await go(page, "#/thien-su-nha-ben");
    await page.waitForSelector("#view-home.active");
    check((await page.textContent("#series-title-vi")).trim() === "Thiên Sứ Nhà Bên", "wrong series title");
    check((await page.textContent("#series-kind")).trim() === "Light novel", "wrong series label");
    await noSidewaysScroll(page, "series page");
  });

  await step("volume contents", async () => {
    await go(page, "#/thien-su-nha-ben/tap-1");
    await page.waitForSelector("#view-volume.active");
    await noSidewaysScroll(page, "volume page");
  });

  await step("reader shows chapter text", async () => {
    await go(page, "#/thien-su-nha-ben/tap-1/1");
    await page.waitForSelector("#view-reader.active .reader-content p", { timeout: 20000 });
    check(await page.locator(".reader-content p").count() > 5, "chapter has almost no paragraphs");
    await noSidewaysScroll(page, "reader");
  });

  await step("bad link falls back and says so", async () => {
    await go(page, "#/khong-co-sach-nay");
    await page.waitForSelector("#view-shelf.active");
    await page.waitForSelector("#app-toast:not([hidden])");
    check(/Không tìm thấy/.test(await page.textContent("#app-toast")), "no not-found message");
  });

  await step("Tủ Sách 1000 page shows its topic", async () => {
    await go(page, "#/b1k-1922-nam-ac-bao");
    await page.waitForSelector("#view-home.active");
    check((await page.textContent("#series-kind")).trim() !== "Light novel", "Tủ Sách 1000 book labelled Light novel");
  });

  check(!errors.length, `[${name}] script errors:\n    ${errors.join("\n    ")}`);
  await page.close();
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  let failed = false;
  try {
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
