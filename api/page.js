// Vercel function for /truyen/* (see the rewrite in vercel.json): serves the
// app shell with the page's own title and preview tags, like server.js does.
// Point at index.html rather than the public/ folder so Vercel's file tracer
// does not bundle the entire 3 GB static directory into the function.
const path = require("path");
const { ROUTE_PREFIX, createRenderer } = require("../page-meta");

const render = createRenderer(path.join(__dirname, "..", "public", "index.html"));

module.exports = (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const rest = url.searchParams.get("p");
  const pathname = rest !== null ? `${ROUTE_PREFIX}${rest}` : url.pathname;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const { status, html } = render(pathname, `${proto}://${req.headers.host}`);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  res.end(html);
};
