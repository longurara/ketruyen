const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { volumeSlug, locationParts, parseRoute, routePath } = require("../public/app-routes.js");
const { formatReadingTime, volumeSubtitle } = require("../public/book-format.js");
const { describePath, renderPage, createRenderer } = require("../page-meta.js");

const chapters = (n) => Array.from({ length: n }, (_, i) => ({ title: `Chương ${i}`, isIllustration: i === 0 }));
const SERIES = [
  { slug: "thien-su-nha-ben", titleVi: "Thiên Sứ Nhà Bên", legacyStorage: true, volumesData: [{ name: "Tập 1", dirName: "Tập_1", chapters: chapters(4) }] },
  { slug: "hanh-trinh-cua-elaina", titleVi: "Hành Trình Của Elaina", description: "Một cô phù thủy nhỏ ngao du thiên hạ.", cover: "/img/elaina.webp", volumesData: [
    { name: "Tập 01", title: "Hành Trình Của Elaina - Tập 1", dirName: "Tập_01", cover: "/img/elaina-1.webp", chapters: chapters(3) }
  ] },
  { slug: "chua-tai", titleVi: "Chưa tải", volumesData: null }
];

test("volume folders become ASCII slugs", () => {
  assert.equal(volumeSlug("Tập_01"), "tap-01");
  assert.equal(volumeSlug("Ngoại Truyện Tập 5.5 (Bản đặc biệt)"), "ngoai-truyen-tap-5-5-ban-dac-biet");
});

test("pages are read from /truyen/ paths and from old #/ links", () => {
  assert.deepEqual(locationParts({ pathname: "/truyen/hanh-trinh-cua-elaina/tap-01/2", hash: "" }), ["hanh-trinh-cua-elaina", "tap-01", "2"]);
  assert.deepEqual(locationParts({ pathname: "/", hash: "#/hanh-trinh-cua-elaina" }), ["hanh-trinh-cua-elaina"]);
  assert.deepEqual(locationParts({ pathname: "/", hash: "" }), []);
  assert.deepEqual(locationParts({ pathname: "/truyen/%E0%A4%A", hash: "" }), []);
});

test("routes resolve to the shelf, a series, a volume or a chapter", () => {
  assert.deepEqual(parseRoute([], SERIES), { view: "shelf" });
  assert.deepEqual(parseRoute(["hanh-trinh-cua-elaina"], SERIES), { view: "home", seriesIdx: 1 });
  assert.deepEqual(parseRoute(["hanh-trinh-cua-elaina", "tap-01"], SERIES), { view: "volume", seriesIdx: 1, volIdx: 0, notFound: false });
  assert.deepEqual(parseRoute(["hanh-trinh-cua-elaina", "tap-01", "2"], SERIES), { view: "reader", seriesIdx: 1, volIdx: 0, chapIdx: 2 });
  assert.deepEqual(parseRoute(["hanh-trinh-cua-elaina", "tap-01", "9"], SERIES), { view: "volume", seriesIdx: 1, volIdx: 0, notFound: true });
  assert.deepEqual(parseRoute(["hanh-trinh-cua-elaina", "tap-99"], SERIES), { view: "home", seriesIdx: 1, notFound: true });
  assert.deepEqual(parseRoute(["chua-tai", "tap-1"], SERIES), { view: "home", seriesIdx: 2 });
  assert.deepEqual(parseRoute(["khong-co"], SERIES), { view: "shelf", notFound: true });
  // Old #/tap-1/2 links open the first series.
  assert.deepEqual(parseRoute(["tap-1", "2"], SERIES), { view: "reader", seriesIdx: 0, volIdx: 0, chapIdx: 2 });
});

test("routes turn back into the same paths", () => {
  for (const parts of [["hanh-trinh-cua-elaina"], ["hanh-trinh-cua-elaina", "tap-01"], ["hanh-trinh-cua-elaina", "tap-01", "2"]]) {
    assert.equal(routePath(parseRoute(parts, SERIES), SERIES), `/truyen/${parts.join("/")}`);
  }
  assert.equal(routePath({ view: "shelf" }, SERIES), "/");
});

test("reading time and volume subtitles", () => {
  assert.equal(formatReadingTime(280 * 40), "~40 phút");
  assert.equal(formatReadingTime(280 * 150), "~2,5 giờ");
  assert.equal(volumeSubtitle({ title: "Hành Trình Của Elaina - Tập 1" }, "Hành Trình Của Elaina"), "");
  assert.equal(volumeSubtitle({ title: "Thiên Sứ Nhà Bên - Tập 5.5 (Bản đặc biệt)" }, "Thiên Sứ Nhà Bên"), "Bản đặc biệt");
  assert.equal(volumeSubtitle({ title: "Tro tàn" }, "Hành Trình Của Elaina"), "Tro tàn");
});

test("server pages carry the book's title, description and cover", () => {
  const load = (series) => series.volumesData;
  const chapter = describePath("/truyen/hanh-trinh-cua-elaina/tap-01/2", SERIES, load);
  assert.equal(chapter.title, "Chương 2 · Hành Trình Của Elaina");
  assert.equal(chapter.image, "/img/elaina-1.webp");
  assert.equal(chapter.path, "/truyen/hanh-trinh-cua-elaina/tap-01/2");
  assert.equal(describePath("/truyen/khong-co", SERIES, load).found, false);
  assert.equal(describePath("/", SERIES, load), null);

  const shell = '<head><title>Kệ truyện</title><meta name="description" content="x"><meta property="og:title" content="x"><meta property="og:description" content="x"><meta name="twitter:card" content="summary"></head>';
  const html = renderPage(shell, { ...chapter, title: 'Tên <"lạ">' }, "https://example.test");
  assert.match(html, /<title>Tên &lt;&quot;lạ&quot;&gt;<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example.test\/truyen\/hanh-trinh-cua-elaina\/tap-01\/2">/);
  assert.match(html, /og:image" content="https:\/\/example.test\/img\/elaina-1.webp"/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.match(renderPage(shell, { found: false }, "https://example.test"), /noindex/);

  const render = createRenderer(path.join(__dirname, "..", "public", "index.html"));
  const live = render("/truyen/thien-su-nha-ben/tap-1", "https://example.test");
  assert.equal(live.status, 200);
  assert.match(live.html, /<title>Tập 1 · Thiên Sứ Nhà Bên<\/title>/);
});
