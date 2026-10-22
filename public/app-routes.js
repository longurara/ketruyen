// Addresses of the app's pages, shared by the browser (app.js) and the
// server (page-meta.js):
//   /                                  the shelf
//   /truyen/<series>                   a series page
//   /truyen/<series>/<volume>          a volume's contents
//   /truyen/<series>/<volume>/<n>      chapter n of that volume
// Links from before used #/<series>/... (and #/tap-1 for the first series);
// they still open the same pages.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AppRoutes = api;
})(globalThis, function () {
  "use strict";
  const ROUTE_PREFIX = "/truyen/";

  // Vietnamese text folded to plain lowercase ASCII letters for matching.
  function fold(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();
  }

  // "Tập_01" → "tap-01".
  function volumeSlug(dirName) {
    return fold(dirName).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // The path segments a location points at, from /truyen/... or an old #/... link.
  function locationParts(location) {
    let raw = "";
    if (location.pathname.startsWith(ROUTE_PREFIX)) raw = location.pathname.slice(ROUTE_PREFIX.length);
    else if (/^#\/?[^/]/.test(location.hash || "")) raw = location.hash.replace(/^#\/?/, "");
    try {
      return decodeURIComponent(raw).split("/").filter(Boolean);
    } catch (_) {
      // Malformed escape in a hand-edited URL: treat as the shelf.
      return [];
    }
  }

  // series: the catalogue, each with slug, volumesData (or null until its
  // index is loaded) and legacyStorage (the first series, which old #/tap-1
  // links point into).
  function parseRoute(parts, series) {
    if (!parts.length) return { view: "shelf" };
    let seriesIdx = series.findIndex((item) => item.slug === parts[0]);
    let volumePart = parts[1];
    let chapterPart = parts[2];
    if (seriesIdx < 0) {
      const legacySeries = series.findIndex((item) => item.legacyStorage);
      if (legacySeries < 0) return { view: "shelf", notFound: true };
      const legacyIdx = (series[legacySeries].volumesData || []).findIndex((volume) => volumeSlug(volume.dirName) === parts[0]);
      if (legacyIdx < 0) return { view: "shelf", notFound: true };
      seriesIdx = legacySeries;
      volumePart = parts[0];
      chapterPart = parts[1];
    }
    if (!volumePart) return { view: "home", seriesIdx };
    const volumes = series[seriesIdx].volumesData;
    if (!Array.isArray(volumes)) return { view: "home", seriesIdx };
    const volIdx = volumes.findIndex((volume) => volumeSlug(volume.dirName) === volumePart);
    if (volIdx < 0) return { view: "home", seriesIdx, notFound: true };
    const chapIdx = /^\d+$/.test(chapterPart || "") ? parseInt(chapterPart, 10) : -1;
    if (!volumes[volIdx].chapters[chapIdx]) return { view: "volume", seriesIdx, volIdx, notFound: Boolean(chapterPart) };
    return { view: "reader", seriesIdx, volIdx, chapIdx };
  }

  function routePath(route, series) {
    if (route.view === "shelf") return "/";
    const book = series[route.seriesIdx];
    const base = `${ROUTE_PREFIX}${book.slug}`;
    const volume = () => volumeSlug(book.volumesData?.[route.volIdx]?.dirName);
    if (route.view === "volume") return `${base}/${volume()}`;
    if (route.view === "reader") return `${base}/${volume()}/${route.chapIdx}`;
    return base;
  }

  return { ROUTE_PREFIX, fold, volumeSlug, locationParts, parseRoute, routePath };
});
