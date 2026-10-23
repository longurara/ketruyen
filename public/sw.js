// Offline reading.
//
// The page shell and series indexes go network-first, so a new deploy shows
// up straight away, with the cached copy as the fallback when offline.
// Chapter text (data/vol-N.<hash>.json) and pictures never change under a
// given URL, so they come from the cache once fetched: every chapter opened
// and picture seen stays readable offline. app.js uses the same cache names
// for "Tải về đọc offline".

const SHELL_CACHE = "tenshi-shell-v40";
const INDEX_PATTERN = /^\/data\/(?:[^/]+\/)?index\.json$/;
const TEXT_CACHE = "tenshi-text-v1";
const IMAGE_CACHE = "tenshi-img-v2";
const FONT_CACHE = "tenshi-fonts-v1";
const CAMERA_CACHE = "tenshi-camera-v1";
const PDF_CACHE = "tenshi-pdf-v1";
const OWN_CACHES = [SHELL_CACHE, TEXT_CACHE, IMAGE_CACHE, FONT_CACHE, CAMERA_CACHE, PDF_CACHE];

const SHELL = [
  "/",
  "/style.css",
  "/app.js",
  "/ebook-import.js",
  "/library-tools.js",
  "/library-backup.js",
  "/reader-sync.js",
  "/reader-journal.js",
  "/journal-ui.js",
  "/library-health.js",
  "/journal.css",
  "/ebook-transfer.js",
  "/ebook-transfer-ui.js",
  "/sync-ui.js",
  "/reader-workspace.js",
  "/cloud-workspace.js",
  "/sync-config.js",
  "/sync.css",
  "/sync-auth.html",
  "/sync-auth.js",
  "/vendor/supabase/supabase.js",
  "/library-tools.css",
  "/hand-gestures.js",
  "/hand-tracking.js",
  "/hand-calibration.js",
  "/motion-controls.js",
  "/motion-controls.css",
  "/reader-workbench.js",
  "/reader-workbench.css",
  "/reader-surfaces.js",
  "/reader-mobile.css",
  "/settings-ui.css",
  "/ui-controls.css",
  "/motion.css",
  "/reading-comfort.css",
  "/reading-comfort.js",
  "/ui-controls.js",
  "/pdf-reader.js",
  "/pdf-reader.css",
  "/hand-camera.css",
  "/hand-camera-worker.js",
  "/vendor/jszip.min.js",
  "/app-dialog.js",
  "/app-routes.js",
  "/book-format.js",
  "/page-turn.js",
  "/reader-characters.js",
  "/reader-features.js",
  "/reader-features.css",
  "/data/series.json",
  "/data/index.json",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    upgradeCaches()
      .then(() => self.clients.claim())
  );
});

async function upgradeCaches() {
  const keys = await caches.keys(), shell = await caches.open(SHELL_CACHE);
  // Keep cached book indexes across deploys, otherwise the chapter text can
  // survive while its book becomes impossible to open without a connection.
  for (const key of keys.filter((name) => name.startsWith("tenshi-shell-") && name !== SHELL_CACHE).reverse()) {
    const previous = await caches.open(key);
    for (const request of await previous.keys()) {
      if (INDEX_PATTERN.test(new URL(request.url).pathname) && !await shell.match(request)) {
        const response = await previous.match(request);
        if (response) await shell.put(request, response);
      }
    }
  }
  // Earlier download buttons used v1 while the reader used v2. Retain those
  // explicitly downloaded pictures and use the same cache from now on.
  if (keys.includes("tenshi-img-v1")) {
    const previous = await caches.open("tenshi-img-v1"), images = await caches.open(IMAGE_CACHE);
    for (const request of await previous.keys()) {
      if (!await images.match(request)) {
        const response = await previous.match(request);
        if (response) await images.put(request, response);
      }
    }
  }
  await Promise.all(keys.filter((key) => key.startsWith("tenshi-") && !OWN_CACHES.includes(key)).map((key) => caches.delete(key)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/vendor/pdfjs/")) {
      event.respondWith(cacheFirst(request, PDF_CACHE));
    } else if (url.pathname.startsWith("/vendor/mediapipe/")) {
      // Fetch the recognition runtime/model only when Beta is activated.
      event.respondWith(cacheFirst(request, CAMERA_CACHE));
    } else if (/^\/data\/(?:[^/]+\/)?vol-[^/]+\.json$/.test(url.pathname)) {
      event.respondWith(cacheFirst(request, TEXT_CACHE));
    } else if (url.pathname.startsWith("/img/") || url.pathname.startsWith("/icons/")) {
      event.respondWith(cacheFirst(request, IMAGE_CACHE));
    } else if (INDEX_PATTERN.test(url.pathname)) {
      // Prune only after all cached indexes have been considered.
      const fetched = networkFirst(request, SHELL_CACHE);
      event.respondWith(fetched);
      event.waitUntil(fetched.then(() => pruneText()).catch(() => {}));
    } else if (request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html")) {
      event.respondWith(networkFirst(request, SHELL_CACHE, "/"));
    } else if (request.mode === "navigate" && url.pathname.startsWith("/truyen/")) {
      // A book page is the same app shell; offline, the cached shell opens it.
      event.respondWith(fetch(request).catch(async () => (await caches.match("/", { cacheName: SHELL_CACHE })) || Response.error()));
    } else if (SHELL.includes(url.pathname) || url.pathname === "/data/descriptions.json") {
      // Full blurbs are not precached (a few MB); the first series page fetch keeps a copy.
      event.respondWith(networkFirst(request, SHELL_CACHE));
    }
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
  }
});

async function networkFirst(request, cacheName, key = request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

async function pruneText() {
  const shell = await caches.open(SHELL_CACHE);
  const catalogRes = await shell.match("/data/series.json");
  if (!catalogRes) return;
  const catalog = await catalogRes.json();
  const indexes = await Promise.all(catalog.map((s) => shell.match(s.index)));
  if (indexes.some((response) => !response)) return;
  const volumes = (await Promise.all(indexes.map((response) => response.json()))).flat();
  const keep = new Set(volumes.map((volume) => new URL(volume.text, self.location.origin).href));
  const cache = await caches.open(TEXT_CACHE);
  const requests = await cache.keys();
  await Promise.all(requests.filter((req) => !keep.has(req.url)).map((req) => cache.delete(req)));
}
