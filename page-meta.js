// Server-side page details for /truyen/<series>/<volume>/<chapter>.
//
// The reader is a single page app, but link previews (Facebook, Zalo,
// Discord…) and search engines only read the HTML the server sends. This
// fills that HTML's title, description, canonical link and preview image in
// for the book, volume or chapter the address points at.
const fs = require("fs");
const path = require("path");

const { ROUTE_PREFIX, volumeSlug } = require("./public/app-routes");
const SITE_NAME = "Kệ truyện";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function shorten(text, limit = 180) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).replace(/\s+\S*$/, "")}…`;
}

// `loadIndex(series)` returns that series' volume list (its index.json), or null.
function describePath(pathname, seriesList, loadIndex) {
  if (!pathname.startsWith(ROUTE_PREFIX)) return null;
  let parts;
  try {
    parts = decodeURIComponent(pathname.slice(ROUTE_PREFIX.length)).split("/").filter(Boolean);
  } catch (_) {
    return { found: false };
  }
  const series = seriesList.find((item) => item.slug === parts[0]);
  if (!series) return { found: false };

  const page = {
    found: true,
    path: `${ROUTE_PREFIX}${series.slug}`,
    title: `${series.titleVi} · ${SITE_NAME}`,
    description: shorten(series.description) || `Đọc ${series.titleVi}${series.author ? ` của ${series.author}` : ""} trên ${SITE_NAME}.`,
    image: series.cover || ""
  };
  if (!parts[1]) return page;

  const volumes = loadIndex(series);
  const volIdx = Array.isArray(volumes) ? volumes.findIndex((volume) => volumeSlug(volume.dirName) === parts[1]) : -1;
  if (volIdx < 0) return page;
  const volume = volumes[volIdx];
  page.path += `/${parts[1]}`;
  page.title = `${volume.name} · ${series.titleVi}`;
  page.description = `${volume.chapters.filter((chapter) => !chapter.isIllustration).length} chương. ${page.description}`;
  if (volume.cover) page.image = volume.cover;
  if (!parts[2]) return page;

  const chapIdx = /^\d+$/.test(parts[2]) ? Number(parts[2]) : -1;
  const chapter = volume.chapters[chapIdx];
  if (!chapter) return page;
  page.path += `/${chapIdx}`;
  page.title = `${chapter.title} · ${series.titleVi}`;
  page.description = `${volume.name}, ${series.titleVi}. ${shorten(series.description, 140)}`.trim();
  return page;
}

function absolute(origin, url) {
  if (!url) return "";
  try { return new URL(url, origin).href; } catch (_) { return ""; }
}

// Rewrites the shell's generic tags. Tags the shell does not have are added
// before </head>.
function renderPage(html, page, origin) {
  if (!page?.found) return html.replace("</head>", '  <meta name="robots" content="noindex">\n</head>');
  const url = absolute(origin, page.path);
  const image = absolute(origin, page.image);
  const title = escapeHtml(page.title), description = escapeHtml(page.description);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(">)/, `$1${description}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, `$1${description}$2`)
    .replace(/(<meta name="twitter:card" content=")[^"]*(">)/, `$1${image ? "summary_large_image" : "summary"}$2`);
  const extra = [
    url && `  <link rel="canonical" href="${escapeHtml(url)}">`,
    url && `  <meta property="og:url" content="${escapeHtml(url)}">`,
    image && `  <meta property="og:image" content="${escapeHtml(image)}">`
  ].filter(Boolean).join("\n");
  if (extra) out = out.replace("</head>", `${extra}\n</head>`);
  return out;
}

// Reads the shell and catalogue from a public/ folder. Each is cached until
// its file changes, so a running dev server picks up edits.
function createRenderer(publicDir) {
  const files = new Map();
  function cached(file, parse) {
    const full = path.join(publicDir, file);
    const stamp = fs.statSync(full).mtimeMs;
    const hit = files.get(file);
    if (hit && hit.stamp === stamp) return hit.value;
    const value = parse(fs.readFileSync(full, "utf8"));
    files.set(file, { stamp, value });
    if (file === "data/series.json") indexes.clear();
    return value;
  }
  const indexes = new Map();
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(publicDir, file), "utf8"));
  function loadIndex(series) {
    if (!indexes.has(series.slug)) {
      let volumes = null;
      try { volumes = readJson(String(series.index || "").replace(/^\//, "")); } catch (_) {}
      indexes.set(series.slug, volumes);
    }
    return indexes.get(series.slug);
  }
  return function render(pathname, origin) {
    const shell = cached("index.html", (text) => text);
    const seriesList = cached("data/series.json", JSON.parse);
    const page = describePath(pathname, seriesList, loadIndex);
    return { status: page && !page.found ? 404 : 200, html: renderPage(shell, page, origin) };
  };
}

module.exports = { ROUTE_PREFIX, describePath, renderPage, createRenderer };
