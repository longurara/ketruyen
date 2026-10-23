(function () {
  "use strict";

  let SERIES = [];
  let activeSeriesIdx = 0;
  let SERIES_META = null;
  let DATA = [];
  let currentView = "shelf";
  let currentVolIdx = -1;
  let currentChapIdx = -1;
  let fontSize = 20;
  let lineHeight = 2.02;
  let fontFamily = "serif";
  let textAlign = "auto";
  let pageModeEnabled = false;
  let theme = "sepia";
  let imageMode = "color";
  // The e-ink look (stepped motion, a flash on page turns) is opt-in.
  let einkEnabled = false;
  let continuousEnabled = true;
  let tapPagingEnabled = true;
  let wakeLockEnabled = true;
  let chapterSort = "asc";
  let chapterFilter = "all";
  let readingProgress = null;
  let readingHistory = [];
  // Per-chapter reading state, keyed "volIdx:chapIdx":
  // { block, offset } = paragraph anchor, pct = scroll %, done = reached the end,
  // v = ANCHOR_VERSION the anchor was saved under.
  let chapterState = {};
  let readerFeatures = null;
  let readerWorkbench = null;
  let readingJournal = null;
  let readerSurfaces = null;
  let readingComfort = null;
  let settingsOpener = null;
  let stableReaderPosition = null;
  let returnReaderPosition = null;
  let lastReaderPosition = null;
  let handCamera = null;
  let motionControls = null;
  // Bump when the chapter text is re-split into different paragraphs: older
  // anchors then point at the wrong block, so those fall back to pct.
  const ANCHOR_VERSION = 2;
  let pendingAnchor = null;
  let pendingAnchorTimer = null;
  let lastChromeScrollY = 0;
  let toastTimer = null;
  let lightboxImages = [];
  let lightboxIndex = 0;
  let lightboxPushed = false;
  let lightboxTouch = null;
  let isReadyForRefresh = false;

  const $ = (selector) => document.querySelector(selector);

  const { readingMinutes, formatReadingTime } = BookFormat;

  // Short facts joined by dots; each one stays on a line of its own
  // when the row wraps, so "1 bộ / minh họa" never splits.
  function metaLine(parts) {
    return parts
      .filter(Boolean)
      .map((part) => `<span class="nowrap">${escapeHtml(part)}</span>`)
      .join(" · ");
  }

  const loadingScreen = $("#loading-screen");
  const header = $("#header");
  const headerTitle = $("#header-title");
  const btnBack = $("#btn-back");
  const btnLogo = $("#btn-logo");
  const btnFontUp = $("#btn-font-up");
  const btnFontDown = $("#btn-font-down");
  const btnSettings = $("#btn-settings");
  const settingsOverlay = $("#settings-overlay");
  const settingsPanel = $("#settings-panel");
  const btnSettingsClose = $("#btn-settings-close");
  const themeSwitch = $("#theme-switch");
  const lineHeightSwitch = $("#line-height-switch");
  const fontFamilySwitch = $("#font-family-switch");
  const textAlignSwitch = $("#text-align-switch");
  const pageModeSwitch = $("#page-mode-switch");
  const imageModeSwitch = $("#image-mode-switch");
  const einkSwitch = $("#eink-switch");
  const continuousSwitch = $("#continuous-switch");
  const tapPageSwitch = $("#tap-page-switch");
  const wakeLockSwitch = $("#wake-lock-switch");
  const wakeLockGroup = $("#wake-lock-group");
  const fontSizeValue = $("#font-size-value");
  const main = $("#main");
  const ghostLayer = $("#eink-ghost");
  const progressBar = $("#progress-bar");
  const progressFill = $("#progress-fill");
  const pageTurn = PageTurn.create({ ghostLayer, header, main, einkEnabled: () => einkEnabled, ready: () => isReadyForRefresh });

  // While a page's own large title is on screen the header would repeat it,
  // so its title only fades in once that heading scrolls away.
  if (typeof IntersectionObserver === "function") {
    const pageTitles = new IntersectionObserver((entries) => {
      entries.forEach((entry) => document.body.classList.toggle(entry.target.dataset.titleFlag, entry.isIntersecting));
    }, { rootMargin: "-64px 0px 0px 0px" });
    [[".shelf-title", "shelf-title-in-view"], ["#series-title-vi", "hero-title-in-view"]].forEach(([selector, flag]) => {
      const heading = $(selector);
      if (!heading) return;
      heading.dataset.titleFlag = flag;
      pageTitles.observe(heading);
    });
  }

  const viewShelf = $("#view-shelf");
  const shelfGrid = $("#shelf-grid");
  const viewHome = $("#view-home");
  const viewVolume = $("#view-volume");
  const viewReader = $("#view-reader");

  const seriesHero = $("#series-hero");
  const homeGrid = $("#home-grid");
  const seriesCover = $("#series-cover");
  const seriesBackdrop = $("#series-backdrop");
  const seriesTitleVi = $("#series-title-vi");
  const seriesTitleJp = $("#series-title-jp");
  const seriesDescription = $("#series-description");
  const seriesDescriptionToggle = $("#series-description-toggle");
  const seriesTags = $("#series-tags");
  const statVolumes = $("#stat-volumes");
  const statChapters = $("#stat-chapters");
  const statIllustrations = $("#stat-illustrations");
  const metaAuthor = $("#meta-author");
  const metaIllustrator = $("#meta-illustrator");
  const metaStatus = $("#meta-status");
  const metaIllustratorWrap = $("#meta-illustrator-wrap");
  const metaStatusWrap = $("#meta-status-wrap");
  const btnStartReading = $("#btn-start-reading");
  const recentChapterList = $("#recent-chapter-list");
  const volumeGrid = $("#volume-grid");
  const searchInput = $("#search-input");
  const searchResults = $("#search-results");

  const continueCard = $("#reading-progress-card");
  const continueInfo = $("#continue-info");
  const btnContinue = $("#btn-continue");

  const volumeCover = $("#volume-cover");
  const volumeBackdrop = $("#volume-backdrop");
  const volumeKicker = $("#volume-kicker");
  const volumeTitle = $("#volume-title");
  const volumeChapterCount = $("#volume-chapter-count");
  const volumeSummary = $("#volume-summary");
  const chapterList = $("#chapter-list");
  const btnOpenFirstChapter = $("#btn-open-first-chapter");
  const btnOpenLatestChapter = $("#btn-open-latest-chapter");
  const btnSaveOffline = $("#btn-save-offline");
  const btnSaveAll = $("#btn-save-all");
  const homeMain = $(".home-main");
  const libraryTabs = $("#library-tabs");
  const tabLibraryAll = $("#tab-library-all");
  const tabLibrarySaved = $("#tab-library-saved");
  const savedCount = $("#saved-count");
  const libraryPanel = $("#library-panel");
  const downloadsPanel = $("#downloads-panel");
  const downloadsSummary = $("#downloads-summary");
  const downloadsList = $("#downloads-list");
  const btnDownloadsAll = $("#btn-downloads-all");
  const btnDownloadsClear = $("#btn-downloads-clear");
  const btnResetVolume = $("#btn-reset-volume");
  const volumeMore = $("#volume-more");
  const btnResetProgress = $("#btn-reset-progress");
  const settingsProgressSection = $("#settings-progress-section");
  const btnSortChapters = $("#btn-sort-chapters");
  const sortLabel = btnSortChapters.querySelector(".sort-label");
  const btnFilterAll = $("#btn-filter-all");
  const btnFilterStory = $("#btn-filter-story");
  const btnFilterIllustration = $("#btn-filter-illustration");

  const readerVolumeCover = $("#reader-volume-cover");
  const readerSidebarTitle = $("#reader-sidebar-title");
  const readerSidebarVolume = $("#reader-sidebar-volume");
  const readerChapterSelect = $("#reader-chapter-select");
  const readerProgressText = $("#reader-progress-text");
  const readerTimeLeft = $("#reader-time-left");
  const readerProgressFill = $("#reader-progress-fill");
  const btnReaderSettings = $("#btn-reader-settings");
  const readerChapters = $("#reader-chapters");
  const chapterIndicator = $("#chapter-indicator");
  const btnReaderPrev = $("#btn-reader-prev");
  const btnReaderList = $("#btn-reader-list");
  const btnReaderNext = $("#btn-reader-next");
  const btnPrevInline = $("#btn-prev-inline");
  const btnBackToVolume = $("#btn-back-to-volume");
  const btnNextInline = $("#btn-next-inline");
  const prevInlineTitle = $("#prev-inline-title");
  const nextInlineTitle = $("#next-inline-title");
  const readerToast = $("#reader-toast");
  const appToast = $("#app-toast");
  const btnToastTop = $("#btn-toast-top");
  const btnReaderTop = $("#btn-reader-top");
  const lightbox = $("#lightbox");
  const lightboxStage = $("#lightbox-stage");
  const lightboxImg = $("#lightbox-img");
  const lightboxCount = $("#lightbox-count");
  const lightboxClose = $("#lightbox-close");
  const lightboxPrev = $("#lightbox-prev");
  const lightboxNext = $("#lightbox-next");
  const btnBottomSettings = $("#btn-bottom-settings");
  const btnBottomTools = $("#btn-bottom-tools");
  const btnBottomList = $("#btn-bottom-list");
  const readerBottomNav = $("#reader-bottom-nav");
  const btnBottomListen = $("#btn-bottom-listen");
  const btnReaderListen = $("#btn-reader-listen");
  const listenBar = $("#listen-bar");
  const listenWhere = $("#listen-where");
  const listenState = $("#listen-state");
  const listenTitle = $("#listen-title");
  const listenClose = $("#listen-close");
  const listenSleep = $("#listen-sleep");
  const listenSleepLabel = $("#listen-sleep-label");
  const listenPrev = $("#listen-prev");
  const listenToggle = $("#listen-toggle");
  const listenNext = $("#listen-next");
  const listenRate = $("#listen-rate");
  const listenVoiceGroup = $("#listen-voice-group");
  const listenVoiceSelect = $("#listen-voice");
  const listenVoiceHint = $("#listen-voice-hint");

  const seriesIndexRequests = new Map();

  function ensureSeriesIndex(series) {
    if (!series || series.personal || Array.isArray(series.volumesData)) {
      return Promise.resolve(series);
    }
    if (!seriesIndexRequests.has(series.slug)) {
      const request = fetch(series.index, { cache: "no-cache" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${series.index}`);
          return res.json();
        })
        .then((volumesData) => {
          series.volumesData = volumesData;
          readerFeatures?.syncSeries?.(series);
          return series;
        });
      request.catch(() => {
        if (seriesIndexRequests.get(series.slug) === request) seriesIndexRequests.delete(series.slug);
      });
      seriesIndexRequests.set(series.slug, request);
    }
    return seriesIndexRequests.get(series.slug);
  }

  function shouldPreloadSeriesIndex(series, index, activeSlugs) {
    if (index === 0 || activeSlugs.has(series.slug)) return true;
    const prefix = series.legacyStorage ? "tenshi" : `tenshi-${series.slug}`;
    return Boolean(localStorage.getItem(`${prefix}-progress`) || localStorage.getItem(`${prefix}-chapters`));
  }

  async function loadData() {
    try {
      const [catalog, ebooks] = await Promise.allSettled([
        (async () => {
          const res = await fetch("/data/series.json", { cache: "no-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const seriesList = await res.json();
          const activeSlugs = new Set();
          try {
            const linked = locationParts();
            if (linked[0]) activeSlugs.add(linked[0]);
          } catch (_) {}
          try {
            const lib = JSON.parse(localStorage.getItem("tenshi-library-v1"));
            if (Array.isArray(lib?.marks)) lib.marks.forEach((m) => { if (m?.slug) activeSlugs.add(m.slug); });
          } catch (_) {}
          seriesList.forEach((series, index) => {
            series.volumesData = null;
            series.legacyStorage = index === 0;
          });
          await Promise.allSettled(
            seriesList
              .filter((series, index) => shouldPreloadSeriesIndex(series, index, activeSlugs))
              .map((series) => ensureSeriesIndex(series))
          );
          if (seriesList[0] && !Array.isArray(seriesList[0].volumesData)) {
            await ensureSeriesIndex(seriesList[0]);
          }
          return seriesList;
        })(),
        EbookImport.list()
      ]);
      SERIES = catalog.status === "fulfilled" ? catalog.value : [];
      if (ebooks.status === "fulfilled") SERIES.push(...ebooks.value.sort((a, b) => b.importedAt - a.importedAt).map(EbookImport.hydrate));
      if (!SERIES.length) throw new Error("Không có dữ liệu truyện.");
      SERIES_META = SERIES[0];
      DATA = SERIES_META.volumesData;
      await init();
      ebookUI = EbookImport.attachUI({
        onSaved(slug) { location.href = `${ROUTE_PREFIX}${slug}`; },
        message: showMessage
      });
      if (ebooks.status === "rejected") showMessage("Không truy cập được ebook đã nhập. Kiểm tra quyền lưu trữ của trình duyệt.");
    } catch (error) {
      console.error(error);
      document.body.classList.remove("is-shelf-boot");
      loadingScreen.querySelector("p").textContent = "Không tải được dữ liệu truyện. Kiểm tra kết nối mạng rồi tải lại trang.";
    }
  }

  // The first series keeps its original keys so existing readers retain
  // their bookmarks. New series receive independent reading state.
  function seriesStorageKey(kind) {
    return SERIES_META.legacyStorage ? `tenshi-${kind}` : `tenshi-${SERIES_META.slug}-${kind}`;
  }

  let ebookUI = null;
  let libraryTools = null;

  function activateSeries(seriesIdx) {
    if (seriesIdx === activeSeriesIdx) return;
    if (currentView === "reader") recordReadingPosition();
    if (listen.active) closeListening();
    EbookImport.release(SERIES_META);
    currentView = "shelf";
    activeSeriesIdx = seriesIdx;
    SERIES_META = SERIES[seriesIdx];
    DATA = SERIES_META.volumesData;
    libraryTools?.setSection?.(SERIES_META.section || "main");
    currentVolIdx = -1;
    currentChapIdx = -1;
    pendingOpenToken += 1;
    document.body.classList.remove("is-fetching");
    volumeTextRequests.clear();
    loadedVolumes.clear();
    readingProgress = null;
    readingHistory = [];
    chapterState = {};
    loadReadingProgress();
    loadReadingHistory();
    loadChapterState();
    hydrateSeriesMeta();
    updateContinueUI();
    renderVolumeGrid();
    renderRecentChapters();
    updateSaveAllButton();
    if (libraryTab === "saved") renderDownloads();
    searchInput.value = "";
    searchResults.style.display = "none";
    volumeGrid.style.display = "";
  }

  const SHELF_BATCH_SIZE = 60;
  let shelfObserver = null;

  function createShelfNode(series) {
    const seriesIdx = SERIES.indexOf(series);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "shelf-card";
    const progressKey = series.legacyStorage ? "tenshi-progress" : `tenshi-${series.slug}-progress`;
    let progress = null;
    try { progress = JSON.parse(localStorage.getItem(progressKey)); } catch (error) {}
    const volume = progress && series.volumesData?.[progress.volIdx];
    const chapter = volume && volume.chapters[progress.chapIdx];
    const resume = chapter ? volume.name : "";
    const updates = readerFeatures ? readerFeatures.updates(series).length : 0;
    card.innerHTML = `
      <span class="book shelf-cover">${series.cover ? `<img src="${escapeHtml(series.cover)}" alt="Bìa ${escapeHtml(series.titleVi)}" width="520" height="728" loading="lazy" decoding="async">` : ""}</span>
      <span class="shelf-copy">
        <span class="shelf-card-title${series.titleVi.length > 32 ? " is-long" : ""}">${escapeHtml(series.titleVi)}</span>
        <span class="shelf-card-author">${escapeHtml(series.author || "")}</span>
        <span class="shelf-card-meta">${series.personal ? `${escapeHtml(series.sourceFormat)} · Ebook cá nhân` : `${series.volumes} tập`} · ${series.chapters} chương</span>
        ${updates ? `<span class="chapter-update-badge">${updates} chương mới</span>` : ""}
        ${series.description ? `<span class="shelf-card-description">${escapeHtml(series.description)}</span>` : ""}
        <span class="shelf-card-action">${resume ? `Đang đọc dở · ${escapeHtml(resume)}` : series.personal ? "Mở sách" : "Xem bộ truyện"} <span aria-hidden="true">→</span></span>
      </span>
    `;
    if (resume) card.dataset.resume = "1";
    card.addEventListener("click", () => openSeries(seriesIdx, card.querySelector(".shelf-cover")));
    if (libraryTools) {
      return libraryTools.shelfItem(series, card);
    }
    if (series.personal) {
      const item = document.createElement("div");
      item.className = "ebook-shelf-item";
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "btn-link ebook-delete";
      remove.textContent = "Xóa ebook"; remove.setAttribute("aria-label", `Xóa ebook ${series.titleVi}`);
      remove.addEventListener("click", () => ebookUI?.deleteBook(series));
      item.append(card, remove);
      return item;
    }
    return card;
  }

  function renderShelf() {
    if (shelfObserver) {
      shelfObserver.disconnect();
      shelfObserver = null;
    }
    shelfGrid.innerHTML = "";
    const ordered = libraryTools ? libraryTools.filterSeries(SERIES) : SERIES;
    if (!ordered.length) {
      const query = $("#shelf-search").value.trim();
      const filtered = $("#shelf-status").value !== "all" || $("#shelf-group").value;
      shelfGrid.innerHTML = `<div class="shelf-empty" role="status"><p class="shelf-empty-title">${query ? `Không có sách nào khớp “${escapeHtml(query)}”` : "Không có sách phù hợp"}</p><p class="tools-empty">${filtered ? "Thử bỏ bớt bộ lọc trạng thái hoặc nhóm, hoặc tìm ở một kệ khác." : "Thử từ khóa ngắn hơn, tên tác giả, hoặc tìm ở một kệ khác."}</p><button type="button" class="btn-secondary">Xóa tìm kiếm và bộ lọc</button></div>`;
      shelfGrid.querySelector(".shelf-empty button").addEventListener("click", () => {
        $("#shelf-search").value = "";
        $("#shelf-status").value = "all";
        $("#shelf-group").value = "";
        renderShelf();
        $("#shelf-search").focus();
      });
      return;
    }
    let renderedCount = 0;
    const appendNextBatch = () => {
      const slice = ordered.slice(renderedCount, renderedCount + SHELF_BATCH_SIZE);
      if (!slice.length) return;
      const frag = document.createDocumentFragment();
      slice.forEach((series, index) => {
        const node = createShelfNode(series);
        // Only the first screenful is staggered; later batches load off screen.
        if (!renderedCount && index < 12) {
          node.classList.add("is-entering");
          node.style.setProperty("--enter", index);
          node.addEventListener("animationend", () => node.classList.remove("is-entering"), { once: true });
        }
        frag.appendChild(node);
      });
      renderedCount += slice.length;
      const sentinel = shelfGrid.querySelector(".shelf-load-sentinel");
      if (sentinel) shelfGrid.insertBefore(frag, sentinel);
      else shelfGrid.appendChild(frag);
      if (renderedCount >= ordered.length && sentinel) {
        if (shelfObserver) {
          shelfObserver.disconnect();
          shelfObserver = null;
        }
        sentinel.remove();
      }
    };
    appendNextBatch();
    if (renderedCount < ordered.length && typeof IntersectionObserver === "function") {
      const sentinel = document.createElement("div");
      sentinel.className = "shelf-load-sentinel";
      sentinel.setAttribute("aria-hidden", "true");
      sentinel.style.height = "1px";
      sentinel.style.gridColumn = "1 / -1";
      shelfGrid.appendChild(sentinel);
      shelfObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) appendNextBatch();
      }, { rootMargin: "600px 0px" });
      shelfObserver.observe(sentinel);
    } else if (renderedCount < ordered.length) {
      while (renderedCount < ordered.length) appendNextBatch();
    }
  }

  // `fromCover`: the shelf cover that was pressed. Without the e-ink effect
  // it grows into the series page's cover.
  function openSeries(seriesIdx, fromCover) {
    const series = SERIES[seriesIdx];
    if (!series) return;
    const turn = { lagMs: 70, totalMs: 420, morph: fromCover && { from: fromCover, to: () => $("#series-hero .hero-book") } };
    if (Array.isArray(series.volumesData)) {
      runEinkPageTurn(() => {
        activateSeries(seriesIdx);
        showView("home");
      }, turn);
      return;
    }
    const token = ++pendingOpenToken;
    document.body.classList.add("is-fetching");
    ensureSeriesIndex(series)
      .then(() => {
        if (token !== pendingOpenToken) return;
        runEinkPageTurn(() => {
          activateSeries(seriesIdx);
          showView("home");
        }, turn);
      })
      .catch(() => {
        if (token === pendingOpenToken) showMessage("Không tải được mục lục truyện. Kiểm tra kết nối mạng rồi thử lại.");
      })
      .finally(() => {
        if (token === pendingOpenToken) document.body.classList.remove("is-fetching");
      });
  }

  // ------------------------------------------------------------
  //  Chapter text lives in one file per volume, fetched the first time a
  //  chapter from that volume is needed (see build-data.js).
  // ------------------------------------------------------------

  const volumeTextRequests = new Map();
  const loadedVolumes = new Set();
  let pendingOpenToken = 0;

  function loadVolumeText(volIdx) {
    if (SERIES_META.personal) {
      if (!volumeTextRequests.has(volIdx)) {
        const book = SERIES_META, seriesIdx = activeSeriesIdx;
        const request = EbookImport.load(book).then(() => {
          if (seriesIdx === activeSeriesIdx) loadedVolumes.add(volIdx);
          else EbookImport.release(book);
        });
        request.catch(() => { if (volumeTextRequests.get(volIdx) === request) volumeTextRequests.delete(volIdx); });
        volumeTextRequests.set(volIdx, request);
      }
      return volumeTextRequests.get(volIdx);
    }
    if (!volumeTextRequests.has(volIdx)) {
      const volume = DATA[volIdx];
      const seriesIdx = activeSeriesIdx;
      const request = fetch(volume.text)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((texts) => {
          volume.chapters.forEach((chapter, chapIdx) => {
            chapter.content = texts[chapIdx] || "";
          });
          if (seriesIdx === activeSeriesIdx) loadedVolumes.add(volIdx);
        });
      // A failed fetch (offline, say) may be retried on the next open.
      request.catch(() => {
        if (volumeTextRequests.get(volIdx) === request) volumeTextRequests.delete(volIdx);
      });
      volumeTextRequests.set(volIdx, request);
    }
    return volumeTextRequests.get(volIdx);
  }

  // Runs `then` once the volume's text is available. Only the latest request
  // wins, so tapping two chapters quickly opens the second one.
  function withVolumeText(volIdx, then, onError) {
    if (loadedVolumes.has(volIdx)) {
      then();
      return;
    }

    const token = ++pendingOpenToken;
    document.body.classList.add("is-fetching");
    loadVolumeText(volIdx)
      .then(() => {
        if (token === pendingOpenToken) then();
      })
      .catch(() => {
        if (token === pendingOpenToken) {
          if (onError) onError();
          showMessage("Không tải được chương này. Kiểm tra kết nối mạng rồi thử lại.");
        }
      })
      .finally(() => {
        if (token === pendingOpenToken) document.body.classList.remove("is-fetching");
      });
  }

  // ------------------------------------------------------------
  //  Offline: sw.js keeps every chapter and picture that has been opened;
  //  "Tải về đọc offline" fetches a whole volume ahead of time. The cache
  //  names must match sw.js.
  // ------------------------------------------------------------

  const TEXT_CACHE = "tenshi-text-v1";
  const IMAGE_CACHE = "tenshi-img-v1";
  // What is being saved for offline reading: a volume's index, "all", or null.
  let offlineSaving = null;
  let offlineSavingSeriesIdx = -1;
  // The library shows every volume ("all") or what is on the device ("saved").
  let libraryTab = "all";

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Service worker not registered", error));
  }

  function volumeFiles(volIdx) {
    const volume = DATA[volIdx];
    const images = volume.chapters.flatMap((chapter) => chapter.images.map((image) => image.src));
    return [volume.text, ...(volume.cover ? [volume.cover] : []), ...images];
  }

  function cacheFor(url) {
    return caches.open(url.startsWith("/data/") ? TEXT_CACHE : IMAGE_CACHE);
  }

  function canSaveOffline() {
    return "caches" in window && "serviceWorker" in navigator;
  }

  function allFiles() {
    return [...new Set(DATA.flatMap((_, volIdx) => volumeFiles(volIdx)))];
  }

  // Download size, from build-data.js.
  function volumeBytes(volIdxs) {
    return volIdxs.reduce((sum, volIdx) => sum + (DATA[volIdx].bytes || 0), 0);
  }

  // "32 MB", "2,4 MB"
  function formatMegabytes(bytes) {
    const mb = bytes / 1048576;
    return `${mb >= 10 ? Math.round(mb) : String(Math.round(mb * 10) / 10).replace(".", ",")} MB`;
  }

  async function missingFiles(files) {
    const found = await Promise.all(files.map(async (url) => Boolean(await (await cacheFor(url)).match(url))));
    return files.filter((_, i) => !found[i]);
  }

  async function isVolumeSaved(volIdx) {
    return (await missingFiles(volumeFiles(volIdx))).length === 0;
  }

  // Puts files into the caches the service worker reads from, skipping the
  // ones already there (so an interrupted download carries on where it
  // stopped); `progress(done, total)` after each. A file that fails is left
  // for the next try while the rest carry on; resolves to how many failed.
  async function saveFiles(files, progress) {
    const queue = await missingFiles(files);
    let done = files.length - queue.length;
    let failed = 0;
    progress(done, files.length);
    // A few at a time: quick on a good connection, gentle on a poor one.
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const url = queue.shift();
        try {
          await (await cacheFor(url)).add(url);
          done += 1;
          progress(done, files.length);
        } catch (error) {
          failed += 1;
        }
      }
    }));
    // Ask the browser not to evict what the reader chose to keep.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return failed;
  }

  function setOfflineButton(label, disabled) {
    btnSaveOffline.textContent = label;
    btnSaveOffline.disabled = disabled;
  }

  function updateOfflineButton(volIdx) {
    if (SERIES_META.personal) {
      btnSaveOffline.hidden = false;
      setOfflineButton("✓ Ebook đã lưu trên thiết bị", true);
      return;
    }
    const seriesIdx = activeSeriesIdx;
    btnSaveOffline.hidden = !canSaveOffline();
    if (btnSaveOffline.hidden || (offlineSaving === volIdx && offlineSavingSeriesIdx === seriesIdx)) return;
    if (offlineSaving !== null) {
      setOfflineButton(offlineSavingSeriesIdx === seriesIdx ? "Đang tải truyện…" : "Đang tải bộ truyện khác…", true);
      return;
    }

    const size = DATA[volIdx].bytes ? ` (${formatMegabytes(DATA[volIdx].bytes)})` : "";
    setOfflineButton(`Tải về đọc offline${size}`, false);
    isVolumeSaved(volIdx)
      .then((saved) => {
        if (saved && activeSeriesIdx === seriesIdx && currentVolIdx === volIdx && offlineSaving === null) setOfflineButton("✓ Đã lưu để đọc offline", true);
      })
      .catch(() => {});
  }

  async function saveVolumeOffline(volIdx) {
    if (SERIES_META.personal || offlineSaving !== null) return;
    const seriesIdx = activeSeriesIdx;
    offlineSaving = volIdx;
    offlineSavingSeriesIdx = seriesIdx;
    renderDownloadButtons();
    const failed = await saveFiles(volumeFiles(volIdx), (done, total) => {
      if (activeSeriesIdx === seriesIdx && currentVolIdx === volIdx) setOfflineButton(`Đang tải… ${done}/${total}`, true);
      const meta = activeSeriesIdx === seriesIdx && downloadsList.querySelector(`[data-vol="${volIdx}"] .download-meta`);
      if (meta) meta.textContent = `Đang tải… ${done}/${total}`;
    }).catch(() => -1);
    offlineSaving = null;
    offlineSavingSeriesIdx = -1;
    if (failed === 0) {
      if (activeSeriesIdx === seriesIdx && currentVolIdx === volIdx) setOfflineButton("✓ Đã lưu để đọc offline", true);
    } else {
      if (activeSeriesIdx === seriesIdx && currentVolIdx === volIdx) setOfflineButton("Chưa tải xong, bấm để tải tiếp", false);
      showMessage("Không tải được hết tập này. Kiểm tra kết nối mạng rồi thử lại.");
    }
    refreshOfflineViews();
  }

  // Both "download everything" buttons: the link over the library, and the
  // button in the "Đã tải về" tab, which takes the shorter wording.
  function setSaveAllButton(label, disabled, shortLabel = label) {
    btnSaveAll.textContent = label;
    btnDownloadsAll.textContent = shortLabel;
    btnSaveAll.disabled = disabled;
    btnDownloadsAll.disabled = disabled;
  }

  // How much of each volume is on this device. A volume counts as started
  // once its text is (reading any chapter saves it); pictures may be missing.
  async function offlineState() {
    return Promise.all(DATA.map(async (_, volIdx) => {
      const files = volumeFiles(volIdx);
      const text = DATA[volIdx].text;
      const missing = await missingFiles(files);
      return {
        volIdx,
        full: missing.length === 0,
        started: !missing.includes(text),
        missingPictures: missing.filter((url) => url !== text).length
      };
    }));
  }

  // The whole series at once: "(32 MB)" before anything is saved, only the
  // volumes still missing once some are. Also counts saved volumes on the tab.
  function updateSaveAllButton() {
    if (SERIES_META.personal) {
      btnSaveAll.hidden = true; libraryTabs.hidden = true;
      if (libraryTab !== "all") setLibraryTab("all");
      return;
    }
    const seriesIdx = activeSeriesIdx;
    const supported = canSaveOffline();
    btnSaveAll.hidden = !supported;
    libraryTabs.hidden = !supported;
    if (!supported) return;
    if (offlineSaving !== null) {
      setSaveAllButton(offlineSavingSeriesIdx === seriesIdx ? "Đang tải truyện…" : "Đang tải bộ truyện khác…", true);
      return;
    }

    const size = formatMegabytes(volumeBytes(DATA.map((_, i) => i)));
    setSaveAllButton(`Tải toàn bộ truyện để đọc offline (${size})`, false, `Tải toàn bộ truyện (${size})`);
    offlineState()
      .then((state) => {
        if (activeSeriesIdx !== seriesIdx) return;
        showSavedCount(state);
        if (offlineSaving !== null) return;
        const missing = state.filter((s) => !s.full).map((s) => s.volIdx);
        const rest = formatMegabytes(volumeBytes(missing));
        if (!missing.length) setSaveAllButton("✓ Đã tải toàn bộ truyện, đọc được khi không có mạng", true, "✓ Đã tải toàn bộ truyện");
        else if (missing.length < DATA.length) setSaveAllButton(`Tải nốt ${missing.length} tập còn lại để đọc offline (${rest})`, false, `Tải nốt ${missing.length} tập (${rest})`);
      })
      .catch(() => {});
  }

  function showSavedCount(state) {
    const saved = state.filter((s) => s.full).length;
    savedCount.textContent = saved ? String(saved) : "";
    btnDownloadsClear.hidden = !state.some((s) => s.started || s.full);
  }

  function refreshOfflineViews() {
    updateSaveAllButton();
    if (currentVolIdx >= 0) updateOfflineButton(currentVolIdx);
    if (libraryTab === "saved") renderDownloads();
  }

  function setLibraryTab(tab) {
    libraryTab = tab;
    const saved = tab === "saved";
    tabLibraryAll.classList.toggle("is-active", !saved);
    tabLibrarySaved.classList.toggle("is-active", saved);
    tabLibraryAll.setAttribute("aria-selected", String(!saved));
    tabLibrarySaved.setAttribute("aria-selected", String(saved));
    libraryPanel.hidden = saved;
    downloadsPanel.hidden = !saved;
    homeMain.classList.toggle("is-saved", saved);
    if (saved) renderDownloads();
  }

  // "850 MB", "1,2 GB"
  function formatStorage(bytes) {
    return bytes >= 1024 ** 3
      ? `${String(Math.round((bytes / 1024 ** 3) * 10) / 10).replace(".", ",")} GB`
      : formatMegabytes(bytes);
  }

  // The "Đã tải về" tab: what is on the device, volume by volume.
  async function renderDownloads() {
    const seriesIdx = activeSeriesIdx;
    const [state, estimate] = await Promise.all([
      offlineState(),
      navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(() => null) : null
    ]);
    if (activeSeriesIdx !== seriesIdx) return;
    showSavedCount(state);
    const shown = state.filter((s) => s.started || s.full);
    const full = state.filter((s) => s.full);

    // Sizes from build-data.js: the browser's own usage figure lags behind
    // a deletion by a while.
    const savedBytes = volumeBytes(full.map((s) => s.volIdx));
    const summary = [`${full.length}/${DATA.length} tập đã lưu đủ${savedBytes ? ` (khoảng ${formatMegabytes(savedBytes)})` : ""}`];
    if (estimate && estimate.quota) summary.push(`máy còn trống ${formatStorage(estimate.quota - estimate.usage)}`);
    downloadsSummary.textContent = `${summary.join(" · ")}.`;

    downloadsList.innerHTML = "";
    if (!shown.length) {
      downloadsList.innerHTML = `<p class="downloads-empty">Chưa có tập nào trên máy. Tải về để đọc cả khi không có mạng: cả bộ khoảng ${formatMegabytes(volumeBytes(DATA.map((_, i) => i)))}.</p>`;
    }

    shown.forEach(({ volIdx, full: isFull, missingPictures }) => {
      const volume = DATA[volIdx];
      const total = volumeFiles(volIdx).length;
      const row = document.createElement("div");
      row.className = `download-row${isFull ? " is-full" : ""}`;
      row.dataset.vol = volIdx;
      const meta = isFull
        ? metaLine([formatMegabytes(volume.bytes || 0), "Đọc được offline"])
        : metaLine(["Đã lưu chữ", `thiếu ${missingPictures} ảnh`]);
      row.innerHTML = `
        <button class="download-open" type="button">
          <span class="book download-cover">${renderCoverMarkup(volume)}</span>
          <span class="download-copy">
            <span class="download-title">${escapeHtml(volume.name)}</span>
            ${volume.title ? `<span class="download-subtitle">${escapeHtml(volume.title)}</span>` : ""}
            <span class="download-meta">${meta}</span>
            ${isFull ? "" : `<span class="download-track"><span style="width:${Math.round(((total - missingPictures) / total) * 100)}%"></span></span>`}
          </span>
        </button>
        ${isFull ? "" : '<button class="btn-secondary download-finish" type="button">Tải nốt</button>'}
        <button class="download-delete" type="button" aria-label="Xóa bản tải ${escapeHtml(volume.name)}" title="Xóa bản tải">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"></path></svg>
        </button>
      `;
      row.querySelector(".download-open").addEventListener("click", () => openVolume(volIdx));
      const finish = row.querySelector(".download-finish");
      if (finish) finish.addEventListener("click", () => saveVolumeOffline(volIdx));
      row.querySelector(".download-delete").addEventListener("click", () => deleteVolumeOffline(volIdx));
      downloadsList.appendChild(row);
    });
    renderDownloadButtons();
  }

  // Nothing to start or delete while a download is running.
  function renderDownloadButtons() {
    downloadsList.querySelectorAll(".download-finish, .download-delete").forEach((button) => {
      button.disabled = offlineSaving !== null;
    });
    btnDownloadsClear.disabled = offlineSaving !== null;
  }

  async function deleteVolumeOffline(volIdx) {
    const volume = DATA[volIdx];
    if (offlineSaving !== null) return;
    const confirmed = await AppDialog.confirm({ title: `Xóa bản tải ${volume.name}?`, message: "Đọc lại tập này sẽ cần có mạng. Tiến độ đọc vẫn được giữ.", confirmLabel: "Xóa bản tải", danger: true });
    if (!confirmed || offlineSaving !== null) return;
    await Promise.all(volumeFiles(volIdx).map(async (url) => (await cacheFor(url)).delete(url)));
    showMessage(`Đã xóa bản tải ${volume.name}.`);
    refreshOfflineViews();
  }

  async function clearAllOffline() {
    if (SERIES_META.personal) return;
    if (offlineSaving !== null) return;
    const confirmed = await AppDialog.confirm({ title: `Xóa mọi bản tải của ${SERIES_META.titleVi}?`, message: "Đọc lại sẽ cần có mạng. Tiến độ đọc vẫn được giữ.", confirmLabel: "Xóa bản tải", danger: true });
    if (!confirmed || offlineSaving !== null) return;
    const files = allFiles();
    await Promise.all(files.map(async (url) => (await cacheFor(url)).delete(url)));
    showMessage("Đã xóa tất cả bản tải.");
    refreshOfflineViews();
  }

  async function saveAllOffline() {
    if (SERIES_META.personal || offlineSaving !== null) return;
    const seriesIdx = activeSeriesIdx;
    const files = allFiles();
    const bytes = volumeBytes(DATA.map((_, i) => i));
    // Room for it? The cache keeps a little more than the files themselves.
    if (navigator.storage && navigator.storage.estimate) {
      const { quota, usage } = await navigator.storage.estimate().catch(() => ({}));
      if (activeSeriesIdx !== seriesIdx) return;
      if (quota && quota - usage < bytes * 1.2) {
        showMessage("Máy không còn đủ chỗ trống để lưu toàn bộ truyện.");
        return;
      }
    }

    offlineSaving = "all";
    offlineSavingSeriesIdx = seriesIdx;
    if (currentVolIdx >= 0) updateOfflineButton(currentVolIdx);
    renderDownloadButtons();
    const failed = await saveFiles(files, (done, total) => {
      const percent = Math.floor((done / total) * 100);
      if (activeSeriesIdx === seriesIdx) setSaveAllButton(`Đang tải toàn bộ truyện… ${percent}%`, true, `Đang tải… ${percent}%`);
    }).catch(() => -1);
    offlineSaving = null;
    offlineSavingSeriesIdx = -1;
    if (activeSeriesIdx !== seriesIdx) {
      refreshOfflineViews();
      return;
    }
    if (failed === 0) {
      setSaveAllButton("✓ Đã tải toàn bộ truyện, đọc được khi không có mạng", true, "✓ Đã tải toàn bộ truyện");
      showMessage("Đã tải xong toàn bộ truyện, giờ đọc được cả khi không có mạng.");
    } else {
      setSaveAllButton(
        failed > 0 ? `Còn ${failed} tệp chưa tải được, bấm để tải tiếp` : "Chưa tải xong, bấm để tải tiếp",
        false,
        failed > 0 ? `Tải tiếp (còn ${failed} tệp)` : "Tải tiếp"
      );
      showMessage("Chưa tải được hết truyện. Kiểm tra kết nối mạng rồi bấm để tải tiếp.");
    }
    if (currentVolIdx >= 0) updateOfflineButton(currentVolIdx);
    if (libraryTab === "saved") renderDownloads();
    // Refresh the saved count, without overwriting the result shown above.
    offlineState().then(showSavedCount).catch(() => {});
  }

  let messageTimer = null;

  // A toast slides away before it is hidden; showing another cancels that.
  function dismissToast(toast, done) {
    toast.classList.add("is-leaving");
    clearTimeout(toast.leaveTimer);
    toast.leaveTimer = window.setTimeout(() => {
      toast.hidden = true;
      toast.classList.remove("is-leaving");
      done?.();
    }, 220);
  }

  function presentToast(toast) {
    clearTimeout(toast.leaveTimer);
    toast.classList.remove("is-leaving");
    toast.hidden = false;
  }

  function showMessage(text, action) {
    appToast.textContent = text;
    document.body.classList.add("has-toast");
    if (action) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = action.label;
      button.onclick = () => { button.disabled = true; action.run(); }; appToast.append(button);
    }
    presentToast(appToast);
    clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => dismissToast(appToast, () => document.body.classList.remove("has-toast")), action ? 10000 : 5000);
  }

  async function init() {
    const savedSize = parseInt(localStorage.getItem("tenshi-font-size"), 10);
    if (!Number.isNaN(savedSize)) {
      fontSize = clamp(savedSize, 16, 28);
    }

    const savedLineHeight = parseFloat(localStorage.getItem("tenshi-line-height"));
    if (!Number.isNaN(savedLineHeight)) {
      lineHeight = savedLineHeight;
    }

    const savedFontFamily = localStorage.getItem("tenshi-font-family");
    if (savedFontFamily === "serif" || savedFontFamily === "sans" || savedFontFamily === "system") {
      fontFamily = savedFontFamily;
    }

    pageModeEnabled = localStorage.getItem("tenshi-page-mode") === "on";

    const savedTextAlign = localStorage.getItem("tenshi-text-align");
    if (TEXT_ALIGNS.includes(savedTextAlign)) {
      textAlign = savedTextAlign;
    }

    const savedTheme = localStorage.getItem("tenshi-theme");
    if (savedTheme === "light" || savedTheme === "sepia" || savedTheme === "dark") {
      theme = savedTheme;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    }

    const savedImageMode = localStorage.getItem("tenshi-image-mode");
    if (savedImageMode === "color" || savedImageMode === "mono") {
      imageMode = savedImageMode;
    }

    const savedContinuous = localStorage.getItem("tenshi-continuous");
    if (savedContinuous === "on" || savedContinuous === "off") {
      continuousEnabled = savedContinuous === "on";
    }

    const savedTapPaging = localStorage.getItem("tenshi-tap-page");
    if (savedTapPaging === "on" || savedTapPaging === "off") {
      tapPagingEnabled = savedTapPaging === "on";
    }

    const savedWakeLock = localStorage.getItem("tenshi-wake-lock");
    if (savedWakeLock === "on" || savedWakeLock === "off") {
      wakeLockEnabled = savedWakeLock === "on";
    }

    const savedRate = parseFloat(localStorage.getItem("tenshi-listen-rate"));
    if (LISTEN_RATES.includes(savedRate)) listen.rate = savedRate;
    listen.voiceURI = localStorage.getItem("tenshi-listen-voice") || "";

    const savedEink = localStorage.getItem("tenshi-eink");
    if (savedEink === "on" || savedEink === "off") {
      einkEnabled = savedEink === "on";
    }

    applyFontSize();
    applyLineHeight();
    applyFontFamily();
    applyTextAlign();
    applyPageMode();
    applyTheme();
    applyImageMode();
    applyEink();
    applyContinuous();
    applyTapPaging();
    applyWakeLock();
    initListening();
    hydrateSeriesMeta();
    loadReadingProgress();
    loadReadingHistory();
    loadChapterState();
    readerFeatures = ReaderFeatures.create({
      series: SERIES,
      characterCatalog: ReaderCharacters,
      context: () => ({
        series: SERIES_META, view: currentView, volIdx: currentVolIdx, chapIdx: currentChapIdx, theme,
        listening: listen.active && listen.playing,
        blocked: settingsPanel.classList.contains("is-open") || !lightbox.hidden || readerSurfaces?.isLocked() || libraryTools?.isOpen() || readerWorkbench?.isOpen() || handCamera?.isOpen() || $("#ebook-import-dialog").open,
        percent: currentView === "reader" && sectionFor(currentVolIdx, currentChapIdx)
          ? chapterPercent(sectionFor(currentVolIdx, currentChapIdx)) : 0
      }),
      legacyState: savedSeriesState,
      completed: (series) => {
        if (!Array.isArray(series.volumesData)) return 0;
        const chapters = series === SERIES_META ? chapterState : savedSeriesState(series).chapters;
        return series.volumesData.reduce((sum, volume, volIdx) => sum + volume.chapters.filter((chapter, chapIdx) => !chapter.isIllustration && chapters[`${volIdx}:${chapIdx}`]?.done).length, 0);
      },
      paragraphs: (volIdx, chapIdx) => chapterParagraphs(DATA[volIdx].chapters[chapIdx]),
      message: showMessage,
      openChapter,
      reload: () => { recordReadingPosition(); location.reload(); },
      pronunciationChanged: () => {
        listen.audioText = null;
        listen.clips.forEach(resetClip);
        if (listen.playing) speakCurrent();
      }
    });
    libraryTools = LibraryTools.create({
      series: SERIES, context: () => ({ series: SERIES_META, view: currentView, volIdx: currentVolIdx, chapIdx: currentChapIdx }),
      message: showMessage, renderShelf, openChapter, openSeries,
      openMark: async (seriesIdx, mark) => { if (seriesIdx < 0 || !SERIES[seriesIdx]) return; try { await ensureSeriesIndex(SERIES[seriesIdx]); } catch (_) { showMessage("Không tải được mục lục truyện."); return; } if (mark.type !== "bookmark") returnReaderPosition ||= captureReaderPosition(); activateSeries(seriesIdx); openChapter(mark.volIdx, mark.chapIdx, mark.type === "bookmark" ? { anchor: mark.anchor } : { hit: { p: mark.parts[0]?.p || 0 } }); },
      capturePosition: () => { recordReadingPosition(); return captureReaderPosition()?.anchor || null; },
      deleteBook: (book, settings) => ebookUI?.deleteBook(book, settings),
      openJournal: (book) => readingJournal?.open(book.slug),
      preservePosition: preserveReaderPosition
    });
    readerSurfaces = ReaderSurfaces.create({ capture: captureReaderPosition, restore: restoreReaderSnapshot });
    readingJournal = JournalUI.create({ series: SERIES, surfaces: readerSurfaces, message: showMessage, closeSettings,
      context: () => ({ series: SERIES_META, view: currentView, volIdx: currentVolIdx, chapIdx: currentChapIdx }),
      ensureBook: async (book) => { const actual = SERIES.find((b) => b.slug === book.slug); if (actual) { await ensureSeriesIndex(actual); Object.assign(book, actual); } },
      openSource: async (source) => { const index = SERIES.findIndex((b) => b.slug === source.slug); if (index < 0) { showMessage("Ebook gốc không còn trên máy. Nội dung đính kèm trong nhật ký vẫn được giữ."); return; } try { await ensureSeriesIndex(SERIES[index]); if (!SERIES[index].volumesData?.[source.volIdx]?.chapters[source.chapIdx]) throw new Error("Chương gốc không còn trong mục lục."); activateSeries(index); openChapter(source.volIdx, source.chapIdx, { hit: { p: source.p || 0 } }); } catch (error) { showMessage(error.message); } }
    });
    readingComfort = ReadingComfort.create({
      isReader: () => currentView === "reader",
      linePixels: () => fontSize * lineHeight,
      linesPerPage: () => { const area = pageArea(); return Math.max(4, Math.floor((area.bottom - area.top) / (fontSize * lineHeight))); },
      pageMode: () => pageModeEnabled,
      canMove: () => currentView === "reader" && document.visibilityState === "visible" && !readerSurfaces.isLocked()
        && !settingsPanel.classList.contains("is-open") && lightbox.hidden && !document.querySelector("dialog[open]") && !String(window.getSelection() || ""),
      turnPage: (direction) => turnReaderPage(direction),
      hasMore: () => {
        const sections = chapterSections(), last = sections[sections.length - 1];
        return continuousEnabled && Boolean(last && getAdjacentChapter(1, { volIdx: Number(last.dataset.vol), chapIdx: Number(last.dataset.chap) }));
      },
      closePanels: () => { closeSettings(); const sheet = $("#reader-aa-dialog"); if (sheet.open) readerSurfaces.close(sheet); },
      preservePosition: preserveReaderPosition,
      message: showMessage
    });
    readerWorkbench = ReaderWorkbench.create({
      journal: readingJournal,
      features: readerFeatures, library: libraryTools, surfaces: readerSurfaces,
      context: () => ({ series: SERIES_META, view: currentView, volIdx: currentVolIdx, chapIdx: currentChapIdx, percent: sectionFor(currentVolIdx, currentChapIdx) ? chapterPercent(sectionFor(currentVolIdx, currentChapIdx)) : 0 }),
      message: showMessage, loadVolume: loadVolumeText, openChapter, closeSettings, openSettings,
      paragraphs: (volIdx, chapIdx) => chapterParagraphs(DATA[volIdx].chapters[chapIdx]),
      characters: () => readerFeatures.characterList(), reached: () => readerFeatures.reached(),
      marks: () => libraryTools.getMarks(), progress: () => chapterState, bookmark: () => libraryTools.quickBookmark(), openMarks: () => libraryTools.openMarks(),
      canReturn: () => Boolean(returnReaderPosition), returnToReadingPosition,
      openSource: async (term) => { const seriesIdx = SERIES.findIndex((s) => s.slug === term.slug); if (seriesIdx < 0) { showMessage("Sách hoặc chương gốc không còn trên kệ."); return; } try { await ensureSeriesIndex(SERIES[seriesIdx]); } catch (_) { showMessage("Không tải được mục lục truyện."); return; } if (!SERIES[seriesIdx].volumesData?.[term.volIdx]?.chapters[term.chapIdx]) { showMessage("Sách hoặc chương gốc không còn trên kệ."); return; } returnReaderPosition ||= captureReaderPosition(); activateSeries(seriesIdx); openChapter(term.volIdx, term.chapIdx, { hit: { p: term.p } }); },
      preservePosition: preserveReaderPosition,
      getSettings: () => ({ fontSize, lineHeight, fontFamily, theme, imageMode, eink: einkEnabled, continuous: continuousEnabled, tap: tapPagingEnabled, layout: libraryTools.getLayout() }),
      applySettings: (settings) => { fontSize = settings.fontSize; localStorage.setItem("tenshi-font-size", String(fontSize)); applyFontSize(); setLineHeight(settings.lineHeight); setFontFamily(settings.fontFamily); setTheme(settings.theme); setImageMode(settings.imageMode); setEink(settings.eink ? "on" : "off"); setTapPaging(settings.tap ? "on" : "off"); setContinuous(settings.continuous ? "on" : "off"); libraryTools.setLayout(settings.layout); }
    });
    PdfReader.create({ preservePosition: preserveReaderPosition, refresh: () => { if (currentView === "reader") renderChapterView(currentVolIdx, currentChapIdx); }, message: showMessage });
    const gestureBlocked = () => settingsPanel.classList.contains("is-open") || !lightbox.hidden || Boolean(document.querySelector("dialog[open]")) || Boolean(String(window.getSelection() || ""));
    const sensorScroll = MotionControls.createAutoScroll({
      read: () => window.scrollY, write: (top) => { pendingAnchor = null; if (listen.active) listen.followPausedAt = Date.now(); noteReaderActivity(); window.scrollTo({ top, behavior: "instant" }); },
      max: () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight), requestFrame: (callback) => requestAnimationFrame(callback), cancelFrame: (id) => cancelAnimationFrame(id),
      canScroll: () => currentView === "reader" && document.visibilityState === "visible" && !gestureBlocked()
    });
    motionControls = MotionControls.create({
      context: () => ({ view: currentView, blocked: gestureBlocked() }), message: showMessage,
      velocity: (speed) => sensorScroll.set(speed), page: (direction) => { sensorScroll.stop(); pendingAnchor = null; noteReaderActivity(); turnPage(direction); },
      bookmark: () => libraryTools.quickBookmark(), listening: () => ({ playing: listen.active && listen.playing, remaining: Math.max(0, listen.sleepUntil - Date.now()) }),
      pause: () => { sensorScroll.stop(); if (listen.active && listen.playing) setListenPlaying(false); showMessage("Đã tạm dừng khi úp máy."); },
      extend: (minutes) => { if (!listen.active || !listen.playing || !listen.sleepUntil) return; setListenSleep(listen.sleep, listen.sleepUntil + minutes * 60000); showMessage(`Đã gia hạn hẹn giờ thêm ${minutes} phút.`); }
    });
    const cameraScroll = HandGestures.createSmoothScroll({
      read: () => window.scrollY,
      write: (top) => window.scrollTo({ top, behavior: "instant" }),
      max: () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
      reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      canScroll: () => currentView === "reader" && document.visibilityState === "visible" && !handCamera?.isBlocked()
    });
    const handAutoScroll = MotionControls.createAutoScroll({
      read: () => window.scrollY, write: (top) => { pendingAnchor = null; if (listen.active) listen.followPausedAt = Date.now(); noteReaderActivity(); window.scrollTo({ top, behavior: "instant" }); },
      max: () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight), requestFrame: (callback) => requestAnimationFrame(callback), cancelFrame: (id) => cancelAnimationFrame(id),
      canScroll: () => currentView === "reader" && document.visibilityState === "visible" && !handCamera?.isBlocked()
    });
    handCamera = HandGestures.create({
      context: () => ({ view: currentView,
        blocked: settingsPanel.classList.contains("is-open") || !lightbox.hidden || Boolean(document.querySelector("dialog[open]")) }),
      closeSettings, message: showMessage,
      autoScroll: (speed) => { if (speed) sensorScroll.stop(); handAutoScroll.set(speed); },
      bookmark: () => libraryTools.quickBookmark(),
      chapter: (direction) => {
        const button = direction > 0 ? $("#btn-reader-next") : $("#btn-reader-prev");
        if (button.disabled) { showMessage(direction > 0 ? "Đã đến chương cuối." : "Đang ở chương đầu."); return; }
        cameraScroll.cancel(); handAutoScroll.stop(); button.click();
      },
      stopDrag: () => cameraScroll.cancel(),
      scroll: (direction, amount) => {
        cameraScroll.cancel();
        pendingAnchor = null;
        if (listen.active) listen.followPausedAt = Date.now();
        noteReaderActivity(); turnPage(direction, amount);
      },
      drag: (delta) => {
        pendingAnchor = null;
        if (listen.active) listen.followPausedAt = Date.now();
        noteReaderActivity();
        chromeLockedUntil = Date.now() + 800;
        if (delta > 0) setChromeHidden(true);
        cameraScroll.add(delta * window.innerHeight * 1.6);
      }
    });
    renderShelf();
    updateContinueUI();
    renderVolumeGrid();
    renderRecentChapters();
    attachEvents();
    await restoreRoute();
    CloudSync.create({ surfaces: readerSurfaces, closeSettings, journal: readingJournal,
      capture: () => { if (currentView !== "reader") return null; const p = captureReaderPosition(); return p ? { slug: p.slug, volIdx: p.volIdx, chapIdx: p.chapIdx, anchor: p.anchor } : null; },
      resume: async (position) => { const index = SERIES.findIndex((s) => s.slug === position.slug); if (index < 0) return false; await ensureSeriesIndex(SERIES[index]); if (!SERIES[index].volumesData?.[position.volIdx]?.chapters[position.chapIdx]) throw new Error("Chương nguồn không còn trong mục lục."); activateSeries(index); openChapter(position.volIdx, position.chapIdx, { anchor: position.anchor }); return true; },
      reloadNotes: () => libraryTools.reload(),
      bookName: (id) => SERIES.find((s) => id === s.slug || id === (s.legacyStorage ? "tenshi" : `tenshi-${s.slug}`))?.titleVi,
      onEbookReceived: async (slug) => {
        if (!SERIES.some((book) => book.slug === slug)) {
          const book = (await EbookImport.list()).find((item) => item.slug === slug);
          if (book) SERIES.push(EbookImport.hydrate(book));
        }
        renderShelf();
      },
      onApplied: () => {
        libraryTools.reload(); readerFeatures.reloadCloud(); readingProgress = null; readingHistory = []; chapterState = {};
        loadReadingProgress(); loadChapterState(); loadReadingHistory();
        renderShelf(); renderVolumeGrid(); renderChapterList(); renderRecentChapters();
        preserveReaderPosition(() => document.querySelectorAll(".reader-frame").forEach((element) => libraryTools.decorate(element)));
        const recent = SERIES.filter((book) => !Array.isArray(book.volumesData) && savedSeriesState(book).progress)
          .sort((a, b) => savedSeriesState(b).progress.timestamp - savedSeriesState(a).progress.timestamp).slice(0, 8);
        if (recent.length) Promise.allSettled(recent.map(ensureSeriesIndex)).then(() => renderShelf());
      }
    });
    isReadyForRefresh = true;
    registerServiceWorker();
    updateSaveAllButton();
    // Opened without a connection: lead with what can be read.
    if (navigator.onLine === false && canSaveOffline() && !SERIES_META.personal) setLibraryTab("saved");

    shelfGrid.removeAttribute("aria-busy");
    document.body.classList.remove("is-shelf-boot");
    loadingScreen.classList.add("hidden");
    setTimeout(() => {
      loadingScreen.style.display = "none";
    }, 350);
  }

  function attachEvents() {
    setupSettingsUI();
    btnBack.addEventListener("click", goBack);
    btnLogo.addEventListener("click", goShelf);
    btnFontUp.addEventListener("click", () => changeFontSize(1));
    btnFontDown.addEventListener("click", () => changeFontSize(-1));

    btnSettings.addEventListener("click", openSettings);
    btnReaderSettings.addEventListener("click", openSettings);
    btnSettingsClose.addEventListener("click", closeSettings);
    settingsOverlay.addEventListener("click", closeSettings);
    settingsPanel.addEventListener("cancel", (event) => { event.preventDefault(); closeSettings(); });
    settingsPanel.addEventListener("close", closeSettings);
    settingsPanel.addEventListener("click", (event) => {
      if (event.target !== settingsPanel) return;
      const rect = settingsPanel.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSettings();
    });

    themeSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setTheme(btn.dataset.themeValue));
    });

    lineHeightSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setLineHeight(parseFloat(btn.dataset.lineValue)));
    });

    fontFamilySwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setFontFamily(btn.dataset.fontValue));
    });

    textAlignSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setTextAlign(btn.dataset.alignValue));
    });

    pageModeSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setPageMode(btn.dataset.pageValue));
    });

    $("#btn-text-reset").addEventListener("click", resetTextSettings);

    imageModeSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setImageMode(btn.dataset.imageValue));
    });

    einkSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setEink(btn.dataset.einkValue));
    });

    continuousSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setContinuous(btn.dataset.continuousValue));
    });

    tapPageSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setTapPaging(btn.dataset.tapValue));
    });

    wakeLockSwitch.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setWakeLock(btn.dataset.wakeValue));
    });

    searchInput.addEventListener("input", () => runSearch(searchInput.value));
    searchResults.addEventListener("click", handleSearchResultClick);

    btnContinue.addEventListener("click", continueReading);
    btnStartReading.addEventListener("click", startReading);

    // Mid-volume these read "Đọc tiếp" / "Đọc từ đầu", as on the home page.
    btnOpenFirstChapter.addEventListener("click", () => {
      if (resumesVolume(currentVolIdx)) {
        continueReading();
        return;
      }
      const target = getFirstReadableChapter(currentVolIdx);
      if (target) openChapter(target.volIdx, target.chapIdx, { fromTop: true });
    });

    btnOpenLatestChapter.addEventListener("click", () => {
      if (resumesVolume(currentVolIdx)) {
        const first = getFirstReadableChapter(currentVolIdx);
        if (first) openChapter(first.volIdx, first.chapIdx, { fromTop: true });
        return;
      }
      const target = getLastReadableChapter(currentVolIdx);
      if (target) openChapter(target.volIdx, target.chapIdx);
    });

    btnSortChapters.addEventListener("click", toggleChapterSort);
    btnSaveOffline.addEventListener("click", () => saveVolumeOffline(currentVolIdx));
    btnSaveAll.addEventListener("click", saveAllOffline);
    btnDownloadsAll.addEventListener("click", saveAllOffline);
    btnDownloadsClear.addEventListener("click", clearAllOffline);
    tabLibraryAll.addEventListener("click", () => setLibraryTab("all"));
    tabLibrarySaved.addEventListener("click", () => setLibraryTab("saved"));
    btnResetVolume.addEventListener("click", () => {
      volumeMore.open = false;
      const volume = DATA[currentVolIdx];
      if (!volume) return;
      resetReadingProgressUndoably(currentVolIdx, `Đã đặt lại tiến độ ${volume.name}.`);
      btnOpenFirstChapter.focus({ preventScroll: true });
    });
    volumeMore.addEventListener("toggle", () => { if (volumeMore.open) btnResetVolume.focus({ preventScroll: true }); });
    volumeMore.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && volumeMore.open) {
        event.preventDefault(); event.stopPropagation(); volumeMore.open = false;
        volumeMore.querySelector("summary").focus({ preventScroll: true });
      }
    });
    document.addEventListener("click", (event) => {
      if (volumeMore.open && !volumeMore.contains(event.target)) volumeMore.open = false;
    });
    btnResetProgress.addEventListener("click", () => {
      closeSettings();
      resetReadingProgressUndoably(null, `Đã xóa tiến độ ${SERIES_META.titleVi}.`);
    });
    btnFilterAll.addEventListener("click", () => setChapterFilter("all"));
    btnFilterStory.addEventListener("click", () => setChapterFilter("story"));
    btnFilterIllustration.addEventListener("click", () => setChapterFilter("illustration"));

    btnReaderPrev.addEventListener("click", () => navigateChapter(-1));
    btnReaderNext.addEventListener("click", () => navigateChapter(1));
    btnPrevInline.addEventListener("click", () => navigateChapter(-1));
    btnNextInline.addEventListener("click", () => navigateChapter(1));
    btnReaderList.addEventListener("click", goBack);
    btnBackToVolume.addEventListener("click", goBack);
    btnBottomList.addEventListener("click", () => readerWorkbench.open("contents"));
    btnBottomSettings.addEventListener("click", openQuickSettings);
    btnBottomTools.addEventListener("click", () => readerWorkbench.open());
    setupQuickSettings();
    setupReaderViewport();

    readerChapterSelect.addEventListener("change", (event) => {
      const nextIndex = parseInt(event.target.value, 10);
      if (!Number.isNaN(nextIndex)) {
        openChapter(currentVolIdx, nextIndex, { replace: true });
      }
    });

    window.addEventListener("scroll", () => {
      if (readerSurfaces?.isLocked()) return;
      updateScrollProgress();
      updateChromeVisibility();
      rememberReaderPosition();
      if (pageModeEnabled) updatePageChrome();
      if (currentView === "reader") noteReaderActivity();
    }, { passive: true });

    // Any deliberate input ends the "keep the restored paragraph in place" window.
    ["wheel", "touchstart", "keydown", "mousedown"].forEach((type) => {
      window.addEventListener(type, (event) => {
        if (event.target.closest?.("dialog, #settings-panel") || readerSurfaces?.isLocked()) return;
        pendingAnchor = null;
        if (currentView === "reader") noteReaderActivity();
        // The reader moving the page themselves: stop following the voice
        // for a while so it does not yank them back.
        if (listen.active && !listenBar.contains(event.target)) listen.followPausedAt = Date.now();
      }, { passive: true });
    });

    // Late-loading images or fonts above the restored paragraph would push it down.
    readerChapters.addEventListener("load", reapplyPendingAnchor, true);

    window.addEventListener("pagehide", () => {
      recordReadingPosition();
      if (speech) speech.cancel();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") recordReadingPosition();
      // The browser drops the screen lock whenever the tab is hidden.
      syncWakeLock();
      if (document.visibilityState === "visible") nudgeListening();
    });

    readerChapters.addEventListener("click", (event) => {
      const opener = event.target.closest(".illustration-open");
      if (opener) {
        if (document.body.dataset.spoilers === "hidden" && !opener.classList.contains("is-revealed")) {
          opener.classList.add("is-revealed");
          opener.setAttribute("aria-label", "Phóng to ảnh");
          return;
        }
        openLightbox(opener.querySelector("img"));
        return;
      }

      // Touch readers: tap low on the page to turn forward, high to turn
      // back, and in the middle to show or hide the header and bottom bar.
      if (!window.matchMedia("(hover: none)").matches) return;
      if (String(window.getSelection ? window.getSelection() : "")) return;
      if (event.target.closest("a, button, [role=button], input, select, textarea, .pdf-viewport")) return;
      if (readerSurfaces?.isLocked()) return;

      if (isPaged()) {
        const side = event.clientX < window.innerWidth * 0.3 ? -1 : event.clientX > window.innerWidth * 0.7 ? 1 : 0;
        if (side) turnReaderPage(side);
        else setChromeHidden(!document.body.classList.contains("is-chrome-hidden"));
        return;
      }
      const zone = tapPagingEnabled ? tapZone(event.clientY) : 0;
      if (zone) turnPage(zone);
      else setChromeHidden(!document.body.classList.contains("is-chrome-hidden"));
    });

    // Touch readers: a quick, clearly sideways swipe moves to the next or
    // previous chapter. Swipes from the screen edges are left to the system's
    // own back gesture.
    let chapterSwipe = null;
    viewReader.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      const edge = 24;
      chapterSwipe = event.touches.length === 1 && touch.clientX > edge && touch.clientX < window.innerWidth - edge
        && !event.target.closest("input, select, textarea, .pdf-viewport, .reader-sidebar")
        ? { x: touch.clientX, y: touch.clientY, at: Date.now() }
        : null;
    }, { passive: true });
    viewReader.addEventListener("touchend", (event) => {
      if (!chapterSwipe) return;
      const dx = event.changedTouches[0].clientX - chapterSwipe.x;
      const dy = event.changedTouches[0].clientY - chapterSwipe.y;
      const quick = Date.now() - chapterSwipe.at < 600;
      chapterSwipe = null;
      if (String(window.getSelection ? window.getSelection() : "")) return;
      if (readerSurfaces?.isLocked() || document.body.classList.contains("is-eink-busy")) return;
      if (isPaged()) {
        // Sideways or upward swipes turn forward, the opposite turn back.
        if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) turnReaderPage(dx < 0 ? 1 : -1);
        else if (Math.abs(dy) >= 60 && Math.abs(dy) > Math.abs(dx) * 1.5) turnReaderPage(dy < 0 ? 1 : -1);
        return;
      }
      if (!quick || Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 2) return;
      navigateChapter(dx < 0 ? 1 : -1);
    }, { passive: true });

    btnToastTop.addEventListener("click", scrollToChapterTop);
    btnReaderTop.addEventListener("click", scrollToChapterTop);
    readerChapters.addEventListener("click", (event) => {
      if (!event.target.closest("[data-reader-return]")) return;
      returnToReadingPosition();
    });

    lightboxClose.addEventListener("click", closeLightbox);
    lightboxPrev.addEventListener("click", () => stepLightbox(-1));
    lightboxNext.addEventListener("click", () => stepLightbox(1));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox || event.target === lightboxStage) closeLightbox();
    });
    lightbox.addEventListener("touchstart", (event) => {
      lightboxTouch = event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
        : null;
    }, { passive: true });
    lightbox.addEventListener("touchend", (event) => {
      if (!lightboxTouch) return;
      const dx = event.changedTouches[0].clientX - lightboxTouch.x;
      const dy = event.changedTouches[0].clientY - lightboxTouch.y;
      lightboxTouch = null;

      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        stepLightbox(dx < 0 ? 1 : -1);
      } else if (dy > 90 && dy > Math.abs(dx) * 1.5) {
        closeLightbox();
      }
    });
    window.addEventListener("popstate", async () => {
      if (!lightbox.hidden) {
        lightboxPushed = false;
        hideLightbox();
        return;
      }
      // Back/forward overrides a chapter still waiting on its text.
      const token = ++pendingOpenToken;
      document.body.classList.remove("is-fetching");
      const route = await resolveRoute(locationParts());
      if (token !== pendingOpenToken) return;
      if (route.notFound) {
        reportMissingRoute(route);
        applyRoute(route, { history: "replace" });
        return;
      }
      // An old #/ link typed or pasted in: show it at its /truyen/ address.
      applyRoute(route, location.hash ? { history: "replace" } : undefined);
    });

    document.addEventListener("keydown", (event) => {
      if (document.querySelector("dialog[open]")) return;
      // Letters and arrows belong to whatever field has focus.
      const typing = event.target.closest?.("input, textarea, select, [contenteditable='true']");
      if (typing && event.key !== "Escape") return;
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && handleShortcut(event)) {
        event.preventDefault();
        return;
      }
      if (!lightbox.hidden) {
        if (event.key === "Escape") closeLightbox();
        if (event.key === "ArrowLeft") stepLightbox(-1);
        if (event.key === "ArrowRight") stepLightbox(1);
        return;
      }

      if (event.key === "Escape" && settingsPanel.classList.contains("is-open")) {
        closeSettings();
        return;
      }

      if (currentView !== "reader") return;
      if (document.body.classList.contains("is-eink-busy")) return;
      if (settingsPanel.classList.contains("is-open")) return;

      if (isPaged()) {
        const forward = ["ArrowRight", "ArrowDown", "PageDown"].includes(event.key) || (event.key === " " && !event.shiftKey);
        const back = ["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey);
        if (forward || back) { event.preventDefault(); turnReaderPage(forward ? 1 : -1); }
        return;
      }

      if (event.key === "ArrowLeft") {
        navigateChapter(-1);
      }

      if (event.key === "ArrowRight") {
        navigateChapter(1);
      }
    });
  }

  const SHORTCUTS = [
    ["?", "Xem bảng phím tắt"],
    ["/", "Tìm sách trên kệ, hoặc tìm trong bộ truyện đang mở"],
    ["← →", "Chương trước / chương sau (khi đang đọc)"],
    ["Space", "Xuống một màn hình"],
    ["B", "Lưu vị trí đang đọc"],
    ["A", "Bật / tắt tự cuộn"],
    ["Esc", "Đóng bảng đang mở"]
  ];

  // Single-key shortcuts outside text fields. Returns true when it handled the key.
  function handleShortcut(event) {
    if (event.key === "?") {
      AppDialog.shortcuts(SHORTCUTS);
      return true;
    }
    if (event.key === "/") {
      const field = currentView === "shelf" ? $("#shelf-search") : currentView === "home" ? searchInput : null;
      if (!field) return false;
      field.focus();
      field.select();
      return true;
    }
    if ((event.key === "a" || event.key === "A") && currentView === "reader" && readingComfort) {
      readingComfort.toggleAuto();
      return true;
    }
    if ((event.key === "b" || event.key === "B") && currentView === "reader" && libraryTools) {
      libraryTools.quickBookmark();
      return true;
    }
    return false;
  }

  // What sort of book this is, for the line above the title.
  function seriesKind(series) {
    const tags = series.tags || [];
    if (series.personal) return { label: "Ebook cá nhân", translated: false };
    if (series.section?.startsWith("b1k")) return { label: (series.collection || "").split(" — ")[1] || "Tủ Sách 1000", translated: false };
    if (series.section?.startsWith("hlc") || tags.some((tag) => /light novel/i.test(tag))) return { label: "Light novel", translated: true };
    if (tags.includes("Văn học Nhật Bản")) return { label: "Văn học Nhật Bản", translated: true };
    return { label: "Tiểu thuyết", translated: false };
  }

  // Long blurbs show their first lines with "Xem thêm"; short ones show whole.
  // Measured once the series page is on screen, since a hidden one has no size.
  function clampDescription() {
    seriesDescription.classList.add("is-clamped");
    seriesDescriptionToggle.setAttribute("aria-expanded", "false");
    seriesDescriptionToggle.textContent = "Xem thêm";
    requestAnimationFrame(() => {
      const overflows = seriesDescription.scrollHeight > seriesDescription.clientHeight + 2;
      seriesDescription.classList.toggle("is-clamped", overflows);
      seriesDescriptionToggle.hidden = !overflows;
    });
  }

  seriesDescriptionToggle.addEventListener("click", () => {
    const expanded = seriesDescriptionToggle.getAttribute("aria-expanded") !== "true";
    seriesDescription.classList.toggle("is-clamped", !expanded);
    seriesDescriptionToggle.setAttribute("aria-expanded", String(expanded));
    seriesDescriptionToggle.textContent = expanded ? "Thu gọn" : "Xem thêm";
  });

  let descriptionResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(descriptionResizeTimer);
    descriptionResizeTimer = setTimeout(() => {
      if (currentView === "home" && seriesDescriptionToggle.getAttribute("aria-expanded") !== "true") clampDescription();
    }, 150);
  });

  // series.json carries only the start of long blurbs; the rest is fetched
  // the first time a series page needs it.
  let fullDescriptions = null;
  function loadFullDescription(series) {
    if (!series.descriptionTruncated) return;
    fullDescriptions ||= fetch("/data/descriptions.json")
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .catch(() => { fullDescriptions = null; return {}; });
    fullDescriptions.then((all) => {
      if (SERIES_META === series && all[series.slug]) {
        seriesDescription.textContent = all[series.slug];
        clampDescription();
      }
    });
  }

  function hydrateSeriesMeta() {
    const totals = getSeriesTotals();
    const kind = seriesKind(SERIES_META);
    $("#series-kind").textContent = kind.label;
    $("#series-kind-extra").hidden = !kind.translated;
    seriesTitleVi.textContent = SERIES_META.titleVi; seriesTitleVi.classList.toggle("is-long", SERIES_META.titleVi.length > 32);
    seriesTitleJp.textContent = SERIES_META.titleJp;
    seriesDescription.textContent = SERIES_META.description || "";
    seriesDescription.hidden = !SERIES_META.description;
    clampDescription();
    loadFullDescription(SERIES_META);
    metaAuthor.textContent = SERIES_META.author;
    metaIllustrator.textContent = SERIES_META.illustrator;
    metaStatus.textContent = SERIES_META.status;
    metaIllustratorWrap.hidden = !SERIES_META.illustrator;
    metaStatusWrap.hidden = !SERIES_META.status;
    seriesTitleJp.hidden = !SERIES_META.titleJp;
    $("#settings-progress-book-name").textContent = SERIES_META.titleVi;
    statVolumes.textContent = totals.volumes;
    statChapters.textContent = totals.chapters;
    statIllustrations.textContent = totals.illustrations;
    $("#stat-illustrations-card").hidden = !totals.illustrations;
    seriesCover.src = getSeriesCover();
    seriesBackdrop.src = getSeriesCover();
    seriesCover.alt = `Bìa ${SERIES_META.titleVi}`;

    seriesTags.innerHTML = "";
    SERIES_META.tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = tag;
      seriesTags.appendChild(chip);
    });
  }

  function getSeriesTotals() {
    return DATA.reduce(
      (acc, volume) => {
        acc.volumes += 1;
        // Picture sets are counted on their own, so "chương" means story chapters.
        const pictures = volume.chapters.filter((chapter) => chapter.isIllustration).length;
        acc.chapters += volume.chapters.length - pictures;
        acc.illustrations += pictures;
        return acc;
      },
      { volumes: 0, chapters: 0, illustrations: 0 }
    );
  }

  function getSeriesCover() {
    return getVolumeCover(DATA[0]);
  }

  function getVolumeCover(volume) {
    return (volume && volume.cover) || "";
  }

  // Volumes without scanned art (e.g. the special-edition side stories) get
  // a typeset cover instead of borrowing another volume's artwork.
  function renderCoverMarkup(volume) {
    const src = getVolumeCover(volume);

    if (src) {
      return `<img src="${src}" alt="Bìa ${escapeHtml(volume.name)}" loading="lazy">`;
    }

    const [, mainName, edition] = volume.name.match(/^(.*?)\s*(?:\((.+)\))?$/);

    return `
      <span class="cover-fallback">
        <span class="cover-fallback-series">${escapeHtml(SERIES_META.titleVi)}</span>
        <span class="cover-fallback-title">
          ${escapeHtml(mainName)}
          ${edition ? `<span class="cover-fallback-edition">${escapeHtml(edition)}</span>` : ""}
        </span>
        <span class="cover-fallback-mark" aria-hidden="true">天</span>
      </span>
    `;
  }

  // Raw titles look like "Chương 3: Lời sẻ chia của thiên sứ", "illu vol 1",
  // or a bare title. Split them into a short label and a display title.
  // Bare titles get no label: their volumes are not numbered by chapter,
  // so `num` is only the entry's position in the list.
  function getChapterLabel(volume, chapIdx) {
    const chapter = volume.chapters[chapIdx];
    if (SERIES_META.sourceFormat === "PDF") return { kicker: "PDF", title: chapter.title, num: chapIdx + 1 };

    if (chapter.isIllustration) {
      return { kicker: "Minh họa", title: "Tranh minh họa", num: null };
    }

    const storyIndex = volume.chapters
      .slice(0, chapIdx + 1)
      .filter((item) => !item.isIllustration).length;
    const numbered = chapter.title.match(/^Chương\s*(\d+)(?:\s*[:：\-–—.]\s*|\s+)(.+)$/i);
    const lifeMatch = chapter.title.match(/^(Life\s*-?\d+(?:\.\d+)?|New\s+Life|Extra\s+Life)(?:\s*[:：\-–—.]\s*(.+))?$/i);
    const prefixed = chapter.title.match(/^((?:Chương\s+mở\s+đầu|Lời\s+mở\s+đầu|Chương\s+đầu|Mở\s+đầu|Chương\s+kết|Phần\s+kết|Chương\s+bổ\s+sung|Ngoại\s+truyện[^:：\-–—]*?|Lời\s+bạt[^:：\-–—]*?))\s*[:：\-–—]\s*(.+)$/i);
    const ssMatch = chapter.title.match(/^(SS\s*\d+)\s*[:：\-–—]?\s+(.+)$/i);
    const volBonusMatch = chapter.title.match(/^Volume\s+(\d+(?:\.\d+)?)\s+Bonus\s+Short\s+Story\s*[:：\-–—]\s*(.+)$/i);
    const fairBonusMatch = chapter.title.match(/^(Fair\s+bonus\s+ss|Phiên\s+bản\s+độc\s+quyền[^:：\-–—]*?)\s*[:：\-–—]\s*(.+)$/i);
    const afterword = chapter.title.match(/^Lời\s+bạt(?:\s+của\s+tác\s+giả)?$/i);

    if (numbered) {
      const chapterNum = parseInt(numbered[1], 10);
      return { kicker: `Chương ${chapterNum}`, title: numbered[2].trim(), num: chapterNum };
    }

    if (prefixed) {
      return { kicker: prefixed[1].trim(), title: prefixed[2].trim(), num: "✦" };
    }
    if (ssMatch) return { kicker: ssMatch[1].toUpperCase().replace(/\s+/g, ""), title: ssMatch[2].trim(), num: storyIndex };
    if (lifeMatch) return { kicker: lifeMatch[1].replace(/\s+/g, " "), title: (lifeMatch[2] || lifeMatch[1]).trim(), num: storyIndex };
    if (volBonusMatch) return { kicker: `Ngoại truyện Tập ${volBonusMatch[1]}`, title: volBonusMatch[2].trim(), num: storyIndex };
    if (fairBonusMatch) return { kicker: fairBonusMatch[1].trim(), title: fairBonusMatch[2].trim(), num: storyIndex };
    if (afterword) {
      return { kicker: "Lời bạt", title: chapter.title.trim(), num: "✦" };
    }

    return { kicker: null, title: chapter.title.trim(), num: storyIndex };
  }

  function formatChapterPlace(volume, label) {
    return [volume.name, hasDistinctKicker(label) ? label.kicker : null].filter(Boolean).join(" · ");
  }

  function hasDistinctKicker(label) {
    return Boolean(label.kicker && !label.title.toLowerCase().startsWith(label.kicker.toLowerCase()));
  }

  function getVolumeProgress(volIdx) {
    return countFinishedChapters(volIdx) / DATA[volIdx].chapters.length;
  }

  function renderVolumeGrid() {
    volumeGrid.innerHTML = "";

    DATA.forEach((volume, volIdx) => {
      const isResume = readingProgress && readingProgress.volIdx === volIdx;
      const isRead = isVolumeRead(volIdx);
      const progress = getVolumeProgress(volIdx);
      const card = document.createElement("button");

      card.type = "button";
      card.className = `volume-card${isResume ? " is-resume" : ""}${isRead ? " is-read" : ""}`;
      // Where the reader is goes under the title, not over the cover art.
      let meta = buildVolumeExcerpt(volume);
      if (isResume) {
        const label = getChapterLabel(volume, readingProgress.chapIdx);
        meta = `<span class="volume-card-status">Đang đọc</span>${label.kicker ? ` · ${escapeHtml(label.kicker)}` : ""}`;
      } else if (isRead) {
        meta = "Đã đọc xong";
      }

      card.innerHTML = `
        <span class="book">
          ${renderCoverMarkup(volume)}
        </span>
        ${progress > 0 ? `<span class="volume-progress"><span style="width:${Math.round(progress * 100)}%"></span></span>` : ""}
        <span class="volume-card-title">${escapeHtml(volume.name)}</span>
        ${volumeSubtitle(volume) ? `<span class="volume-card-subtitle">${escapeHtml(volumeSubtitle(volume))}</span>` : ""}
        <span class="volume-card-meta">${meta}</span>
      `;

      card.addEventListener("click", () => openVolume(volIdx));
      volumeGrid.appendChild(card);
    });
  }

  function volumeSubtitle(volume) {
    return BookFormat.volumeSubtitle(volume, SERIES_META.titleVi);
  }

  function volumeWords(volume) {
    return volume.chapters.reduce((sum, chapter) => sum + (chapter.words || 0), 0);
  }

  function buildVolumeExcerpt(volume) {
    const storyCount = volume.chapters.filter((chapter) => !chapter.isIllustration).length;
    const words = volumeWords(volume);

    return metaLine([`${storyCount} chương`, words ? `${formatReadingTime(words)} đọc` : ""]);
  }

  // The data has no publish dates, so the sidebar shows the reader's own
  // history. The newest entry is already the hero's "continue" block.
  function renderRecentChapters() {
    const entries = readingHistory
      .filter((entry) => !(
        readingProgress &&
        entry.volIdx === readingProgress.volIdx &&
        entry.chapIdx === readingProgress.chapIdx
      ))
      .slice(0, 5);

    recentChapterList.innerHTML = "";
    homeGrid.classList.toggle("has-sidebar", entries.length > 0);

    entries.forEach((entry) => {
      const volume = DATA[entry.volIdx];
      const label = getChapterLabel(volume, entry.chapIdx);
      const partial = getPartialPercent(entry.volIdx, entry.chapIdx);
      let status = "";
      if (isChapterRead(entry.volIdx, entry.chapIdx)) status = "Đã đọc xong · ";
      else if (partial) status = `Đã đọc ${partial}% · `;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "recent-item";
      button.innerHTML = `
        <span class="recent-volume">${escapeHtml(formatChapterPlace(volume, label))}</span>
        <span class="recent-title">${escapeHtml(label.title)}</span>
        <span class="recent-time">${status}${formatTimeAgo(entry.timestamp)}</span>
      `;
      button.addEventListener("click", () => openChapter(entry.volIdx, entry.chapIdx));
      recentChapterList.appendChild(button);
    });
  }

  function loadReadingHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(seriesStorageKey("history")));
      if (Array.isArray(saved)) {
        readingHistory = saved.filter(
          (entry) => entry && DATA[entry.volIdx] && DATA[entry.volIdx].chapters[entry.chapIdx]
        );
      }
    } catch (error) {
      console.warn("Could not parse reading history", error);
    }
  }

  function savedSeriesState(series) {
    const prefix = series.legacyStorage ? "tenshi" : `tenshi-${series.slug}`;
    try {
      return {
        progress: JSON.parse(localStorage.getItem(`${prefix}-progress`)),
        chapters: JSON.parse(localStorage.getItem(`${prefix}-chapters`)) || {}
      };
    } catch (error) { return { progress: null, chapters: {} }; }
  }

  function recordReadingHistory(volIdx, chapIdx) {
    readingHistory = [
      { volIdx, chapIdx, timestamp: Date.now() },
      ...readingHistory.filter((entry) => !(entry.volIdx === volIdx && entry.chapIdx === chapIdx))
    ].slice(0, 8);

    localStorage.setItem(seriesStorageKey("history"), JSON.stringify(readingHistory));
  }

  const relativeTime = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
  const TIME_UNITS = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];

  function formatTimeAgo(timestamp) {
    const seconds = Math.round((timestamp - Date.now()) / 1000);

    for (const [unit, size] of TIME_UNITS) {
      if (Math.abs(seconds) >= size) {
        const text = relativeTime.format(Math.round(seconds / size), unit);
        return text.charAt(0).toUpperCase() + text.slice(1);
      }
    }

    return "Vừa xong";
  }

  function chapterKey(volIdx, chapIdx) {
    return `${volIdx}:${chapIdx}`;
  }

  function getChapterState(volIdx, chapIdx) {
    return chapterState[chapterKey(volIdx, chapIdx)] || null;
  }

  function isChapterRead(volIdx, chapIdx) {
    const state = getChapterState(volIdx, chapIdx);
    return Boolean(state && state.done);
  }

  function countFinishedChapters(volIdx) {
    return DATA[volIdx].chapters.filter((_, chapIdx) => isChapterRead(volIdx, chapIdx)).length;
  }

  function isVolumeRead(volIdx) {
    return countFinishedChapters(volIdx) === DATA[volIdx].chapters.length;
  }

  // Percent read of a chapter that was started but not finished, else 0.
  function getPartialPercent(volIdx, chapIdx) {
    const state = getChapterState(volIdx, chapIdx);
    return state && !state.done && state.pct > 2 ? state.pct : 0;
  }

  function loadChapterState() {
    try {
      const saved = JSON.parse(localStorage.getItem(seriesStorageKey("chapters")));
      if (saved && typeof saved === "object") {
        chapterState = saved;
        return;
      }
    } catch (error) {
      console.warn("Could not parse chapter state", error);
    }

    // First visit with per-chapter tracking: carry over the old read marks
    // (everything before the bookmark) so returning readers keep their ticks.
    if (!readingProgress) return;

    DATA.forEach((volume, volIdx) => {
      volume.chapters.forEach((_, chapIdx) => {
        const isBefore =
          volIdx < readingProgress.volIdx ||
          (volIdx === readingProgress.volIdx && chapIdx < readingProgress.chapIdx);
        if (isBefore) chapterState[chapterKey(volIdx, chapIdx)] = { done: true, pct: 100 };
      });
    });
    saveChapterState();
  }

  function saveChapterState() {
    localStorage.setItem(seriesStorageKey("chapters"), JSON.stringify(chapterState));
    window.dispatchEvent(new Event("ketruyen-library-change"));
  }

  // Accent-folded, lower-case copy used for matching. The text is NFC
  // (build-data.js), so this keeps one character per character and a
  // match's offsets also locate it in the original.
  function normalizeText(text) {
    return AppRoutes.fold(text);
  }

  // The chapter split into paragraphs, as the reader shows them. Empty until
  // the volume's text has been fetched.
  function chapterParagraphs(chapter) {
    if (chapter.content === undefined) return [];
    if (!chapter.paragraphs) {
      chapter.paragraphs = chapter.content.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
    }
    return chapter.paragraphs;
  }

  function foldedParagraphs(chapter) {
    if (!chapter.folded) chapter.folded = chapterParagraphs(chapter).map(normalizeText);
    return chapter.folded;
  }

  const CONTENT_SEARCH_LIMIT = 40;
  let contentSearchTimer = null;
  let contentSearchToken = 0;

  function runSearch(rawQuery) {
    const query = rawQuery.trim();
    clearTimeout(contentSearchTimer);
    contentSearchToken += 1;

    if (!query) {
      searchResults.style.display = "none";
      searchResults.innerHTML = "";
      volumeGrid.style.display = "";
      return;
    }

    const needle = normalizeText(query);
    volumeGrid.style.display = "none";
    searchResults.style.display = "grid";

    const volumeMatches = DATA
      .map((volume, volIdx) => ({ volume, volIdx }))
      .filter(({ volume }) => normalizeText(volume.name).includes(needle));

    const chapterMatches = [];
    DATA.forEach((volume, volIdx) => {
      volume.chapters.forEach((chapter, chapIdx) => {
        if (normalizeText(chapter.title).includes(needle)) {
          chapterMatches.push({ volume, volIdx, chapter, chapIdx });
        }
      });
    });

    let html = "";
    const titleCount = volumeMatches.length + chapterMatches.length;
    if (titleCount) {
      const shown = Math.min(volumeMatches.length, 6) + Math.min(chapterMatches.length, 24);
      html += `<p class="search-section">Tên tập và chương · ${titleCount} kết quả cho “${escapeHtml(query)}”${titleCount > shown ? `, hiện ${shown} kết quả đầu` : ""}</p>`;
    }

    volumeMatches.slice(0, 6).forEach(({ volume, volIdx }) => {
      html += `
        <button type="button" class="search-result-item" data-type="volume" data-vol="${volIdx}">
          <span class="search-result-volume">Tập truyện · ${buildVolumeExcerpt(volume)}</span>
          <span class="search-result-title">${markMatch(volume.name, needle)}</span>
        </button>
      `;
    });

    chapterMatches.slice(0, 24).forEach(({ volume, volIdx, chapIdx }) => {
      const label = getChapterLabel(volume, chapIdx);
      html += `
        <button type="button" class="search-result-item" data-type="chapter" data-vol="${volIdx}" data-chap="${chapIdx}">
          <span class="search-result-volume">${escapeHtml(formatChapterPlace(volume, label))}</span>
          <span class="search-result-title">${markMatch(label.title, needle)}</span>
        </button>
      `;
    });

    const hasTitleMatches = html !== "";
    const searchesContent = needle.length >= 2;
    html += '<div class="search-content"></div>';
    searchResults.innerHTML = html;

    const contentBox = searchResults.querySelector(".search-content");
    if (!searchesContent) {
      if (!hasTitleMatches) contentBox.innerHTML = `<p class="search-empty">Không tìm thấy kết quả cho "${escapeHtml(query)}".</p>`;
      return;
    }

    contentBox.innerHTML = '<p class="search-note">Đang tìm trong nội dung truyện…</p>';
    const token = contentSearchToken;
    contentSearchTimer = window.setTimeout(() => {
      searchContent(needle, query, hasTitleMatches, contentBox, token);
    }, 250);
  }

  // Full-text search needs every volume's text; fetch whatever is missing
  // (once), then search what arrived.
  async function searchContent(needle, query, hasTitleMatches, contentBox, token) {
    const loads = await Promise.allSettled(DATA.map((_, volIdx) => loadVolumeText(volIdx)));
    if (token !== contentSearchToken) return;

    const missing = loads.filter((result) => result.status === "rejected").length;
    const hits = [];
    let total = 0;

    DATA.forEach((volume, volIdx) => {
      if (!loadedVolumes.has(volIdx)) return;
      volume.chapters.forEach((chapter, chapIdx) => {
        if (chapter.isIllustration) return;
        foldedParagraphs(chapter).forEach((folded, p) => {
          const start = folded.indexOf(needle);
          if (start < 0) return;
          total += 1;
          if (hits.length < CONTENT_SEARCH_LIMIT) hits.push({ volIdx, chapIdx, p, start, len: needle.length });
        });
      });
    });

    let html = "";
    if (hits.length) {
      html += `<p class="search-section">Trong nội dung · ${total} đoạn${total > hits.length ? `, hiện ${hits.length} đoạn đầu` : ""}</p>`;
      hits.forEach((hit) => {
        const volume = DATA[hit.volIdx];
        const label = getChapterLabel(volume, hit.chapIdx);
        const text = chapterParagraphs(volume.chapters[hit.chapIdx])[hit.p];
        html += `
          <button type="button" class="search-result-item" data-type="hit" data-vol="${hit.volIdx}" data-chap="${hit.chapIdx}" data-p="${hit.p}" data-start="${hit.start}" data-len="${hit.len}">
            <span class="search-result-volume">${escapeHtml(formatChapterPlace(volume, label))} · ${escapeHtml(label.title)}</span>
            <span class="search-snippet">${renderSnippet(text, hit.start, hit.len)}</span>
          </button>
        `;
      });
    } else if (!hasTitleMatches) {
      html += `<p class="search-empty">Không tìm thấy kết quả cho "${escapeHtml(query)}".</p>`;
    }

    if (missing) {
      html += `<p class="search-note">Chưa tải được ${missing} tập nên chưa tìm trong các tập đó. Kiểm tra kết nối mạng.</p>`;
    }

    contentBox.innerHTML = html;
  }

  // The text with the part matching a folded search term marked. Folding
  // drops accents one-for-one, so positions line up with the NFC text.
  function markMatch(text, needle) {
    const plain = String(text || "").normalize("NFC");
    const folded = normalizeText(plain);
    const start = folded.length === plain.length ? folded.indexOf(needle) : -1;
    if (start < 0) return escapeHtml(plain);
    return `${escapeHtml(plain.slice(0, start))}<mark class="search-hit">${escapeHtml(plain.slice(start, start + needle.length))}</mark>${escapeHtml(plain.slice(start + needle.length))}`;
  }

  // A line of context around a match, cut at word boundaries.
  function renderSnippet(text, start, len) {
    let from = Math.max(0, start - 60);
    let to = Math.min(text.length, start + len + 110);
    if (from > 0) from = text.indexOf(" ", from) + 1 || from;
    if (to < text.length) to = text.lastIndexOf(" ", to) > start + len ? text.lastIndexOf(" ", to) : to;

    return `${from > 0 ? "…" : ""}${escapeHtml(text.slice(from, start))}<mark class="search-hit">${escapeHtml(text.slice(start, start + len))}</mark>${escapeHtml(text.slice(start + len, to))}${to < text.length ? "…" : ""}`;
  }

  function handleSearchResultClick(event) {
    const btn = event.target.closest(".search-result-item");
    if (!btn) return;

    const volIdx = parseInt(btn.dataset.vol, 10);
    const chapIdx = parseInt(btn.dataset.chap, 10);
    if (btn.dataset.type === "volume") {
      openVolume(volIdx);
    } else if (btn.dataset.type === "hit") {
      const hit = { p: parseInt(btn.dataset.p, 10), start: parseInt(btn.dataset.start, 10), len: parseInt(btn.dataset.len, 10) };
      openChapter(volIdx, chapIdx, { hit });
    } else {
      openChapter(volIdx, chapIdx);
    }
  }

  // Opens a chapter on a search match (or any paragraph, when `hit` has no
  // `len`): the paragraph goes to the top of the screen, matched words marked.
  function revealSearchHit(volIdx, chapIdx, hit) {
    const section = sectionFor(volIdx, chapIdx);
    const el = section && section.querySelector(`.reader-content [data-p="${hit.p}"]`);
    if (!el) return;

    const text = chapterParagraphs(DATA[volIdx].chapters[chapIdx])[hit.p];
    if (hit.len && el.textContent === text) {
      LibraryTools.highlightRange(el, hit.start, hit.start + hit.len, { className: "search-hit" });
    }

    const content = section.querySelector(".reader-content"), blocks = [...content.children];
    let outer = el; while (outer.parentElement !== content) outer = outer.parentElement;
    const bounds = outer.getBoundingClientRect(), target = el.getBoundingClientRect();
    holdAnchor(section, { block: blocks.indexOf(outer), offset: bounds.height ? (target.top - bounds.top) / bounds.height : 0 });
  }

  // `historyMode`: "push" (default) adds a browser history entry for the new
  // view, "replace" swaps the current one, "none" leaves history alone.
  function showView(name, historyMode) {
    if (currentView === "reader" && name !== "reader") lastReaderPosition = captureReaderPosition();
    // Leaving the reader: the page still shows the chapter, so save where we were.
    if (currentView === "reader" && name !== "reader") recordReadingPosition();

    [viewShelf, viewHome, viewVolume, viewReader].forEach((view) => view.classList.remove("active"));
    currentView = name;
    document.body.dataset.view = name;
    settingsProgressSection.hidden = name === "shelf";
    document.documentElement.classList.toggle("is-paged", pageModeEnabled && name === "reader");
    readingComfort?.onView();
    if (name === "reader" && pageModeEnabled) requestAnimationFrame(() => { alignPageTop(); updatePageChrome(); });
    else updatePageChrome();
    // On the shelf this header button opens reading statistics; elsewhere, the book's tools.
    const toolsLabel = name === "shelf" ? "Thống kê đọc" : "Tiện ích đọc";
    $("#btn-reader-tools").setAttribute("aria-label", toolsLabel);
    $("#btn-reader-tools").title = toolsLabel;

    if (name === "shelf") {
      viewShelf.classList.add("active");
      headerTitle.textContent = "Kệ truyện";
      btnBack.style.display = "none";
      progressBar.style.display = "none";
      document.title = "Kệ truyện";
      renderShelf();
    } else if (name === "home") {
      viewHome.classList.add("active");
      headerTitle.textContent = SERIES_META.titleVi;
      btnBack.style.display = "inline-flex";
      progressBar.style.display = "none";
      document.title = SERIES_META.titleVi;
      clampDescription();
      renderVolumeGrid();
      updateContinueUI();
      renderRecentChapters();
    } else if (name === "volume") {
      viewVolume.classList.add("active");
      btnBack.style.display = "inline-flex";
      progressBar.style.display = "none";
      headerTitle.textContent = DATA[currentVolIdx]?.name || SERIES_META.titleVi;
      const volume = DATA[currentVolIdx];
      document.title = `${volume?.name || SERIES_META.titleVi} | ${volume?.title || SERIES_META.titleVi}`;
      renderVolumeGrid();
    } else {
      viewReader.classList.add("active");
      btnBack.style.display = "inline-flex";
      progressBar.style.display = "block";
      document.title = chapterDocTitle();
    }

    closeSettings();
    hideToast();
    pendingAnchor = null;
    window.scrollTo({ top: 0, behavior: "auto" });
    lastChromeScrollY = 0;
    setChromeHidden(false);
    if (name === "volume") revealResumeChapter();
    updateScrollProgress();
    syncHistory(historyMode || "push");
    if (name === "reader") noteReaderActivity();
    else syncWakeLock();
    readerFeatures?.onView();
    readerWorkbench?.onView();
    libraryTools?.onView();
    handCamera?.onView();
    motionControls?.onView();
  }

  // Long volumes (the side-story book has 37 entries) would otherwise open
  // their contents far above the chapter being read.
  function revealResumeChapter() {
    const item = chapterList.querySelector(".chapter-item.is-resume");
    if (!item) return;

    const rect = item.getBoundingClientRect();
    if (rect.bottom <= window.innerHeight - 24) return;
    window.scrollTo({ top: rect.top + window.scrollY - window.innerHeight / 3, behavior: "auto" });
  }

  // ------------------------------------------------------------
  //  Routing: /truyen/series-slug, /truyen/series-slug/tap-1, and its
  //  chapter (see app-routes.js). Old #/ links still open the same pages.
  //  Each view gets a history entry, so the phone's back gesture walks
  //  chapter → contents → home instead of leaving the site, and a chapter
  //  link can be bookmarked or shared.
  // ------------------------------------------------------------

  // Page addresses and their parsing live in app-routes.js, shared with the
  // server; these bind them to the loaded catalogue.
  const ROUTE_PREFIX = AppRoutes.ROUTE_PREFIX;

  function locationParts() {
    return AppRoutes.locationParts(location);
  }

  function routePath(route) {
    return AppRoutes.routePath({ ...route, seriesIdx: route.seriesIdx ?? activeSeriesIdx }, SERIES);
  }

  function parseRoute(parts) {
    return AppRoutes.parseRoute(parts, SERIES);
  }

  async function resolveRoute(parts) {
    if (parts.length) {
      const matched = SERIES.find((series) => series.slug === parts[0]);
      if (matched && !Array.isArray(matched.volumesData)) {
        try { await ensureSeriesIndex(matched); } catch (_) {}
      }
    }
    return parseRoute(parts);
  }

  function currentRoute() {
    return { view: currentView, seriesIdx: activeSeriesIdx, volIdx: currentVolIdx, chapIdx: currentChapIdx };
  }

  function syncHistory(mode) {
    if (mode === "none") return;

    const route = routePath(currentRoute());
    const current = window.history.state;
    // An old #/ link is rewritten to its /truyen/ address even when the page is the same.
    if (current && current.route === route && !location.hash) return;

    const url = `${route}${location.search}`;
    if (mode === "replace") {
      window.history.replaceState({ route, prev: current ? current.prev : undefined }, "", url);
    } else {
      window.history.pushState({ route, prev: current ? current.route : undefined }, "", url);
    }
  }

  // Show whatever the URL points at (back/forward, or the first load).
  function applyRoute(route, options) {
    if (routePath(route) === routePath(currentRoute())) return;
    if (route.view !== "shelf" && !Array.isArray(SERIES[route.seriesIdx]?.volumesData)) {
      const token = ++pendingOpenToken;
      document.body.classList.add("is-fetching");
      ensureSeriesIndex(SERIES[route.seriesIdx])
        .then(() => {
          if (token === pendingOpenToken) applyRoute(route, options);
        })
        .catch(() => {
          if (token === pendingOpenToken) showMessage("Không tải được mục lục truyện. Kiểm tra kết nối mạng rồi thử lại.");
        })
        .finally(() => {
          if (token === pendingOpenToken) document.body.classList.remove("is-fetching");
        });
      return;
    }
    if (route.view !== "shelf") activateSeries(route.seriesIdx);

    if (route.view === "reader" && !loadedVolumes.has(route.volIdx)) {
      withVolumeText(route.volIdx, () => applyRoute(route, options), () => {
        renderVolumeView(route.volIdx);
        showView("volume", "replace");
      });
      return;
    }

    const change = () => {
      if (route.view === "reader") {
        renderChapterView(route.volIdx, route.chapIdx);
        showView("reader", options?.history || "none");
        restoreReadingPosition(route.volIdx, route.chapIdx, options);
      } else if (route.view === "volume") {
        renderVolumeView(route.volIdx);
        showView("volume", options?.history || "none");
      } else if (route.view === "home") {
        showView("home", options?.history || "none");
      } else {
        showView("shelf", options?.history || "none");
      }
    };

    // A history move must land even mid page-turn, or the URL and the page
    // would disagree.
    if (document.body.classList.contains("is-eink-busy")) {
      cancelEinkPageTurn();
      change();
      return;
    }

    runEinkPageTurn(change, { lagMs: 70, totalMs: 420 });
  }

  async function restoreRoute() {
    window.history.scrollRestoration = "manual";
    let route = await resolveRoute(locationParts());
    if (route.view !== "shelf") activateSeries(route.seriesIdx);

    // Fetch a linked chapter's text behind the loading screen; if that fails
    // (offline and never read), fall back to the volume's contents.
    if (route.view === "reader") {
      try {
        await loadVolumeText(route.volIdx);
      } catch (error) {
        route = { view: "volume", seriesIdx: route.seriesIdx, volIdx: route.volIdx };
        showMessage("Không tải được chương này. Kiểm tra kết nối mạng rồi thử lại.");
      }
    }

    if (route.notFound) reportMissingRoute(route);
    if (route.view === "shelf") {
      showView("shelf", "replace");
    } else {
      applyRoute(route, { history: "replace", exact: true });
    }
  }

  // A link to a book, volume or chapter that no longer exists: say so, and
  // put the address of the page actually shown in the URL bar.
  function reportMissingRoute(route) {
    showMessage(route.view === "shelf" ? "Không tìm thấy sách này trên kệ." : route.view === "home" ? "Không tìm thấy tập này, đã mở trang bộ truyện." : "Không tìm thấy chương này, đã mở mục lục tập.");
    if (routePath(route) === routePath(currentRoute())) syncHistory("replace");
  }

  function goHome() {
    if (currentView === "home") {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    runEinkPageTurn(() => {
      showView("home");
    }, { lagMs: 70, totalMs: 420 });
  }

  function goShelf() {
    if (currentView === "shelf") {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    runEinkPageTurn(() => showView("shelf"), { lagMs: 70, totalMs: 420 });
  }

  // Up one level: chapter → contents → home. When that level is the page we
  // came from, step back through history rather than stacking a new entry.
  function goBack() {
    if (currentView === "shelf") return;
    const parent = currentView === "reader"
      ? { view: "volume", seriesIdx: activeSeriesIdx, volIdx: currentVolIdx }
      : currentView === "volume"
        ? { view: "home", seriesIdx: activeSeriesIdx }
        : { view: "shelf" };

    if (window.history.state && window.history.state.prev === routePath(parent)) {
      window.history.back();
    } else if (parent.view === "volume") {
      openVolume(parent.volIdx);
    } else if (parent.view === "home") {
      goHome();
    } else {
      goShelf();
    }
  }

  function openVolume(volIdx) {
    runEinkPageTurn(() => {
      renderVolumeView(volIdx);
      showView("volume");
    }, { lagMs: 70, totalMs: 420 });
  }

  function renderVolumeView(volIdx) {
    recordReadingPosition();
    currentVolIdx = volIdx;
    const volume = DATA[volIdx];
    const resuming = resumesVolume(volIdx);

    // The series name goes small above; the big title is the volume itself
    // ("Tập 01"), or its own name when it has one.
    const ownName = SERIES_META.personal ? "" : volumeSubtitle(volume);
    if (SERIES_META.personal) {
      volumeKicker.textContent = "Mục lục";
      volumeTitle.textContent = volume.title || volume.name;
    } else {
      volumeKicker.textContent = `${SERIES_META.titleVi} · ${ownName ? volume.name : "Mục lục"}`;
      volumeTitle.textContent = ownName || volume.name;
    }
    volumeChapterCount.innerHTML = buildVolumeExcerpt(volume);
    btnOpenFirstChapter.textContent = resuming ? "Đọc tiếp" : "Đọc từ chương đầu";
    btnOpenLatestChapter.textContent = resuming ? "Đọc từ đầu" : "Chương cuối tập";
    volumeSummary.textContent = createVolumeSummary(volume, volIdx);
    volumeCover.innerHTML = renderCoverMarkup(volume);
    volumeBackdrop.src = getVolumeCover(volume);

    renderChapterList();
    updateOfflineButton(volIdx);
    volumeMore.open = false;
    volumeMore.hidden = btnResetVolume.hidden = !hasVolumeProgress(volIdx);
  }

  function resumesVolume(volIdx) {
    return Boolean(readingProgress && readingProgress.volIdx === volIdx);
  }

  function hasVolumeProgress(volIdx) {
    return resumesVolume(volIdx) || Object.keys(chapterState).some((key) => key.startsWith(`${volIdx}:`));
  }

  // Forgets what has been read, in one volume or (volIdx null) everywhere:
  // read marks, places in chapters, the bookmark and the history.
  function resetReadingProgress(volIdx) {
    const inScope = (v) => volIdx == null || v === volIdx;
    Object.keys(chapterState).forEach((key) => {
      if (inScope(Number(key.split(":")[0]))) delete chapterState[key];
    });
    saveChapterState();
    readingHistory = readingHistory.filter((entry) => !inScope(entry.volIdx));
    localStorage.setItem(seriesStorageKey("history"), JSON.stringify(readingHistory));
    if (readingProgress && inScope(readingProgress.volIdx)) {
      readingProgress = null;
      localStorage.removeItem(seriesStorageKey("progress"));
    }

    updateContinueUI();
    renderVolumeGrid();
    renderRecentChapters();
    if (currentView === "volume" && currentVolIdx >= 0) renderVolumeView(currentVolIdx);
  }

  // Resetting is immediate; the toast offers to put everything back as it was.
  function resetReadingProgressUndoably(volIdx, message) {
    const series = SERIES_META;
    const before = { chapters: { ...chapterState }, history: [...readingHistory], progress: readingProgress };
    resetReadingProgress(volIdx);
    showMessage(message, { label: "Hoàn tác", run() {
      if (SERIES_META !== series) return;
      chapterState = before.chapters;
      saveChapterState();
      readingHistory = before.history;
      localStorage.setItem(seriesStorageKey("history"), JSON.stringify(readingHistory));
      readingProgress = before.progress;
      if (readingProgress) localStorage.setItem(seriesStorageKey("progress"), JSON.stringify(readingProgress));
      updateContinueUI();
      renderVolumeGrid();
      renderRecentChapters();
      if (currentView === "volume" && currentVolIdx >= 0) renderVolumeView(currentVolIdx);
      showMessage("Đã khôi phục tiến độ đọc.");
    } });
  }

  function createVolumeSummary(volume, volIdx) {
    const finished = countFinishedChapters(volIdx);
    if (finished === volume.chapters.length) return "Bạn đã đọc hết tập này.";

    if (readingProgress && readingProgress.volIdx === volIdx) {
      const label = getChapterLabel(volume, readingProgress.chapIdx);
      return `Đang đọc dở: ${(hasDistinctKicker(label) ? [label.kicker, label.title] : [label.title]).filter(Boolean).join(" — ")}`;
    }

    return finished > 0 ? `Đã đọc ${finished}/${volume.chapters.length} mục.` : "";
  }

  function renderChapterList() {
    if (currentVolIdx < 0) return;

    const volume = DATA[currentVolIdx];
    const entries = volume.chapters.map((chapter, chapIdx) => ({ chapter, chapIdx }));
    const filtered = entries.filter(({ chapter }) => {
      if (chapterFilter === "story") return !chapter.isIllustration;
      if (chapterFilter === "illustration") return chapter.isIllustration;
      return true;
    });

    if (chapterSort === "desc") {
      filtered.reverse();
    }

    chapterList.innerHTML = "";

    if (filtered.length === 0) {
      chapterList.innerHTML = '<p class="chapter-empty">Tập này không có mục nào thuộc loại này.</p>';
      return;
    }

    filtered.forEach(({ chapter, chapIdx }) => {
      const isResume =
        readingProgress &&
        readingProgress.volIdx === currentVolIdx &&
        readingProgress.chapIdx === chapIdx;
      const isRead = !isResume && isChapterRead(currentVolIdx, chapIdx);
      const partial = getPartialPercent(currentVolIdx, chapIdx);
      const label = getChapterLabel(volume, chapIdx);
      const imageCount = chapter.images ? chapter.images.length : 0;
      const num = chapter.isIllustration
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="1.6"></circle><path d="m21 16-5-5-9 9"></path></svg>'
        : label.num;
      const meta = [];

      if (!chapter.isIllustration && hasDistinctKicker(label) && !/^Chương\s+\d+$/i.test(label.kicker)) meta.push(escapeHtml(label.kicker));
      if (!chapter.isIllustration && chapter.words) meta.push(`~${readingMinutes(chapter.words)} phút`);
      if (imageCount > 0) meta.push(chapter.isIllustration ? `${imageCount} ảnh` : `${imageCount} ảnh minh họa`);
      if (isResume && partial) meta.push(`đã đọc ${partial}%`);

      let state = "";
      if (isResume) state = '<span class="state-pill">Đang đọc</span>';
      else if (partial) state = `<span class="state-progress" title="Đã đọc ${partial}%">${partial}%</span>`;
      else if (isRead) state = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Đã đọc"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';

      const item = document.createElement("button");
      item.type = "button";
      item.className = `chapter-item${chapter.isIllustration ? " is-illustration" : ""}${isResume ? " is-resume" : ""}${isRead ? " is-read" : ""}`;
      item.innerHTML = `
        <span class="chapter-num">${num}</span>
        <span class="chapter-copy">
          <span class="chapter-title">${escapeHtml(label.title)}</span>
          ${meta.length ? `<span class="chapter-meta">${meta.join(" · ")}</span>` : ""}
        </span>
        <span class="chapter-state">${state}</span>
      `;

      item.addEventListener("click", () => openChapter(currentVolIdx, chapIdx));
      chapterList.appendChild(item);
    });
  }

  // options.fromTop: ignore the saved position; options.replace: moving
  // between chapters swaps the history entry, so back returns to the contents;
  // options.hit: a search match to scroll to and highlight.
  function openChapter(volIdx, chapIdx, options) {
    if (options?.hit && !returnReaderPosition) returnReaderPosition = captureReaderPosition() || (lastReaderPosition?.slug === SERIES_META.slug ? lastReaderPosition : null);
    withVolumeText(volIdx, () => runEinkPageTurn(() => {
      renderChapterView(volIdx, chapIdx);
      showView("reader", options?.replace ? "replace" : "push");
      if (options?.hit) revealSearchHit(volIdx, chapIdx, options.hit);
      else if (options?.anchor) holdAnchor(sectionFor(volIdx, chapIdx), options.anchor);
      else if (!options?.fromTop) restoreReadingPosition(volIdx, chapIdx);
    }, { lagMs: 90, totalMs: 480 }));
  }

  function renderChapterView(volIdx, chapIdx) {
    recordReadingPosition();
    hideToast();

    readerChapters.innerHTML = "";
    readerChapters.appendChild(renderChapterSection(volIdx, chapIdx, "h1"));
    setCurrentChapter(volIdx, chapIdx);
    showListeningParagraph(false);
  }

  // One chapter as a page of the book. Chapters appended below in continuous
  // mode get an h2 so the page keeps a single h1.
  function renderChapterSection(volIdx, chapIdx, headingTag) {
    const volume = DATA[volIdx];
    const chapter = volume.chapters[chapIdx];
    const label = getChapterLabel(volume, chapIdx);

    let html = "";

    if (SERIES_META.sourceFormat === "PDF") {
      html += PdfReader.renderChapter(chapter, volume.chapters[chapIdx + 1], (paragraphs) => renderTextContent(paragraphs));
    } else if (chapter.isIllustration) {
      html += renderIllustrations(chapter.images);
    } else if (chapter.blocks) {
      const paragraphs = chapterParagraphs(chapter);
      html += EbookImport.renderBlocks(chapter.blocks,
        (block) => renderTextContent([paragraphs[block.p]], block.p, chapter.rich?.[block.p], block),
        (block) => renderIllustration(chapter.images[block.image], `Minh họa ${chapter.title}`));
    } else {
      html += renderTextContent(chapterParagraphs(chapter));

      if (chapter.images && chapter.images.length > 0) {
        html += chapter.images
          .map((image) => renderIllustration(image, `Minh họa ${chapter.title}`))
          .join("");
      }
    }

    const section = document.createElement("article");
    section.className = "reader-frame";
    section.dataset.vol = String(volIdx);
    section.dataset.chap = String(chapIdx);
    section.innerHTML = `
      <header class="reader-head">
        <p class="reader-breadcrumb">${escapeHtml(formatChapterPlace(volume, label))}</p>
        <${headingTag} class="reader-stage-title${label.title.length > 48 ? " is-long" : ""}">${escapeHtml(label.title)}</${headingTag}>
        <p class="reader-meta">${SERIES_META.sourceFormat === "PDF" ? `PDF · ${chapIdx + 1}/${volume.chapters.length} trang` : chapter.isIllustration
          ? `${chapter.images.length} ảnh minh họa`
          : `Khoảng ${readingMinutes(chapter.words)} phút đọc`}</p>
        <div class="reader-ornament" aria-hidden="true"><span></span><i>✦</i><span></span></div>
        <div class="chapter-tools" aria-label="Tiện ích chương">
          <button type="button" data-reader-feature="characters"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.2a3 3 0 0 1 0 5.6M17.5 14.2A5.5 5.5 0 0 1 20.5 19"></path></svg><span>Nhân vật</span></button>
          <button type="button" data-library-action="bookmark" aria-label="Đánh dấu vị trí"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10v16l-5-3.5L7 20z"></path></svg><span>Đánh dấu</span></button>
          <details class="chapter-tools-more">
            <summary aria-label="Thao tác chương"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1.2" fill="currentColor"></circle><circle cx="12" cy="12" r="1.2" fill="currentColor"></circle><circle cx="19" cy="12" r="1.2" fill="currentColor"></circle></svg><span>Thêm</span></summary>
            <div class="chapter-tools-menu">
              <button type="button" data-library-action="marks">Ghi chú</button>
              ${chapter.isIllustration ? "" : '<button type="button" data-reader-feature="quotes">Tạo trích dẫn</button>'}
              <button type="button" data-reader-feature="goal">Mục tiêu phiên đọc</button>
            </div>
          </details>
        </div>
        ${returnReaderPosition ? '<button type="button" class="btn-secondary reader-return-location" data-reader-return>← Về chỗ vừa đọc</button>' : ""}
      </header>
      <div class="reader-content">${html}</div>
      <div class="reader-fin" aria-hidden="true"><span></span>Hết chương<span></span></div>
    `;
    readerFeatures?.decorateChapter(section);
    libraryTools?.decorate(section);
    readerWorkbench?.decorateSection(section);
    if (SERIES_META.sourceFormat === "PDF") PdfReader.attachSection(section);
    return section;
  }

  // Points the header, sidebar, chapter picker and saved progress at the
  // chapter being read.
  function setCurrentChapter(volIdx, chapIdx) {
    currentVolIdx = volIdx;
    currentChapIdx = chapIdx;

    const volume = DATA[volIdx];
    const label = getChapterLabel(volume, chapIdx);

    headerTitle.textContent = label.title;
    readerSidebarTitle.textContent = label.title;
    readerSidebarVolume.textContent = volume.name;
    const coverKey = `${SERIES_META.slug}:${volIdx}`;
    if (readerVolumeCover.dataset.vol !== coverKey) {
      readerVolumeCover.innerHTML = renderCoverMarkup(volume);
      readerVolumeCover.dataset.vol = coverKey;
    }

    populateReaderSelect(volIdx, chapIdx);
    updateNavButtons();
    saveReadingProgress(volIdx, chapIdx);
    readerFeatures?.openedChapter(volIdx, chapIdx);
    readerWorkbench?.updateStatus();
  }

  function chapterDocTitle() {
    const volume = DATA[currentVolIdx];
    return `${getChapterLabel(volume, currentChapIdx).title} | ${volume.title || SERIES_META.titleVi}`;
  }

  function chapterSections() {
    return [...readerChapters.children];
  }

  function sectionFor(volIdx, chapIdx) {
    return chapterSections().find(
      (section) => Number(section.dataset.vol) === volIdx && Number(section.dataset.chap) === chapIdx
    ) || null;
  }

  function scrollToChapterTop() {
    if (currentView !== "reader") return;
    trackCurrentChapter();
    const section = sectionFor(currentVolIdx, currentChapIdx);
    if (!section) return;

    hideToast();
    pendingAnchor = null;
    if (listen.active) listen.followPausedAt = Date.now();
    setChromeHidden(false);
    chromeLockedUntil = Date.now() + 800;
    const top = section.getBoundingClientRect().top + window.scrollY - header.offsetHeight - 12;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, top), behavior: einkEnabled || reducedMotion ? "auto" : "smooth" });
  }

  // The line just under the header (or the top edge while it is hidden) that
  // counts as "where the reader is".
  function readingLine() {
    return Math.max(0, header.getBoundingClientRect().bottom);
  }

  // How far the reader is through a chapter: 100 once its last line has come
  // into view at the bottom of the screen.
  function chapterPercent(section) {
    const rect = section.getBoundingClientRect();
    const line = readingLine();
    const span = rect.height - (window.innerHeight - line);
    if (span <= 0) return rect.bottom <= window.innerHeight ? 100 : 0;
    return clamp(((line - rect.top) / span) * 100, 0, 100);
  }

  // Continuous mode: whichever chapter is under the reading line becomes the
  // current one, so the header, URL and saved progress follow the scroll.
  function trackCurrentChapter() {
    const line = readingLine();
    const sections = chapterSections();
    // At the very top the line sits above the first chapter's page; that
    // chapter is still the one on screen. In the gap between two pages,
    // keep whichever was current.
    const section = sections.find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.top <= line && rect.bottom > line;
    }) || (sections[0] && sections[0].getBoundingClientRect().top > line ? sections[0] : null);
    if (!section) return;

    const volIdx = Number(section.dataset.vol);
    const chapIdx = Number(section.dataset.chap);
    if (volIdx === currentVolIdx && chapIdx === currentChapIdx) return;

    // Saves the chapter being left; one scrolled past records as finished.
    recordReadingPosition();
    setCurrentChapter(volIdx, chapIdx);
    document.title = chapterDocTitle();
    syncHistory("replace");
  }

  // Continuous mode: once the last chapter on the page is within a couple of
  // screens of running out, put the next one underneath it.
  function maybeAppendNextChapter() {
    if (!continuousEnabled) return;

    for (let added = 0; added < 3; added += 1) {
      const sections = chapterSections();
      const last = sections[sections.length - 1];
      if (!last || last.getBoundingClientRect().bottom > window.innerHeight * 3) return;

      const next = getAdjacentChapter(1, { volIdx: Number(last.dataset.vol), chapIdx: Number(last.dataset.chap) });
      if (!next) return;

      // Next volume's text not here yet: fetch it and try again once it is.
      if (!loadedVolumes.has(next.volIdx)) {
        loadVolumeText(next.volIdx)
          .then(() => { if (currentView === "reader") maybeAppendNextChapter(); })
          .catch(() => {});
        return;
      }

      readerChapters.appendChild(renderChapterSection(next.volIdx, next.chapIdx, "h2"));
      showListeningParagraph(false);
    }
  }

  // Which paragraph of a chapter sits at the top of the viewport, and how far into it.
  function getReadingAnchor(section) {
    const top = readingLine();
    const blocks = section.querySelector(".reader-content").children;

    for (let i = 0; i < blocks.length; i += 1) {
      const rect = blocks[i].getBoundingClientRect();
      if (rect.bottom > top) {
        const anchor = { block: i, offset: rect.height ? clamp((top - rect.top) / rect.height, 0, 1) : 0 };
        if (blocks[i].matches("p[data-p]")) {
          try {
            const x = rect.left + Math.min(24, rect.width / 4), y = Math.max(rect.top + 2, top + 2);
            const caret = document.caretPositionFromPoint?.(x, y);
            const range = caret ? document.createRange() : document.caretRangeFromPoint?.(x, y);
            if (caret) { range.setStart(caret.offsetNode, caret.offset); range.collapse(true); }
            if (range && blocks[i].contains(range.startContainer)) {
              const prefix = document.createRange(); prefix.selectNodeContents(blocks[i]); prefix.setEnd(range.startContainer, range.startOffset); anchor.textOffset = prefix.toString().length;
            }
          } catch (_) { /* Paragraph fraction is available in browsers without caret lookup. */ }
        }
        return anchor;
      }
    }

    return { block: Math.max(blocks.length - 1, 0), offset: 1 };
  }

  function scrollToAnchor(section, anchor) {
    if (!section || !anchor) return false;
    const block = section.querySelector(".reader-content").children[anchor.block];
    if (!block) return false;

    const rect = block.getBoundingClientRect();
    let lineTop = rect.top + anchor.offset * rect.height;
    if (Number.isInteger(anchor.textOffset) && block.matches("p[data-p]")) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let node, remaining = anchor.textOffset;
      while ((node = walker.nextNode())) {
        if (remaining < node.length) {
          try { const range = document.createRange(); range.setStart(node, Math.min(remaining, node.length)); range.setEnd(node, Math.min(remaining + 1, node.length)); const line = range.getBoundingClientRect(); if (line.height) lineTop = line.top; } catch (_) {}
          break;
        }
        remaining -= node.length;
      }
    }
    const targetLine = document.body.classList.contains("is-chrome-hidden") ? 0 : header.offsetHeight;
    const target = lineTop + window.scrollY - targetLine;
    window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
    lastChromeScrollY = window.scrollY;
    updateScrollProgress();
    return true;
  }

  // Reopens a chapter where the reader stopped. Without `exact` (a normal
  // open rather than a page refresh), only a mid-chapter position counts:
  // a chapter left at the very start or end opens from the top.
  function restoreReadingPosition(volIdx, chapIdx, options) {
    const state = getChapterState(volIdx, chapIdx);
    const section = sectionFor(volIdx, chapIdx);
    if (!state || !section) return false;
    if (!options?.exact && (state.pct <= 2 || state.pct >= 95)) return false;

    let anchor;
    if (state.v === ANCHOR_VERSION && state.block != null) {
      anchor = { block: state.block, offset: state.offset || 0, ...(Number.isInteger(state.textOffset) ? { textOffset: state.textOffset } : {}) };
    } else if (state.pct > 0) {
      const rect = section.getBoundingClientRect();
      const line = readingLine();
      const span = Math.max(0, rect.height - (window.innerHeight - line));
      window.scrollTo({ top: rect.top + window.scrollY - line + (state.pct / 100) * span, behavior: "auto" });
      anchor = getReadingAnchor(section);
    } else {
      return false;
    }

    if (!holdAnchor(section, anchor)) return false;

    if (!options?.exact) showToast();
    return true;
  }

  // Scrolls to an anchor and keeps it in place for a few seconds while late
  // fonts or pictures above it settle.
  function holdAnchor(section, anchor) {
    if (!section || !anchor) return false;
    if (readerSurfaces?.isLocked()) { readerSurfaces.updateAnchor({ slug: SERIES_META.slug, volIdx: Number(section.dataset.vol), chapIdx: Number(section.dataset.chap), anchor }); return true; }
    if (!scrollToAnchor(section, anchor)) return false;

    pendingAnchor = { section, ...anchor };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(reapplyPendingAnchor);
    }
    clearTimeout(pendingAnchorTimer);
    pendingAnchorTimer = window.setTimeout(() => { pendingAnchor = null; }, 4000);
    return true;
  }

  function reapplyPendingAnchor() {
    if (!readerSurfaces?.isLocked() && pendingAnchor && currentView === "reader" && pendingAnchor.section.isConnected) {
      scrollToAnchor(pendingAnchor.section, pendingAnchor);
    }
  }

  function recordReadingPosition() {
    if (readerSurfaces?.isLocked() || document.querySelector("dialog[open]")) return;
    if (currentView !== "reader" || currentVolIdx < 0 || currentChapIdx < 0) return;
    if (pendingAnchor) return;

    const section = sectionFor(currentVolIdx, currentChapIdx);
    if (!section) return;

    const pct = Math.round(chapterPercent(section));
    const key = chapterKey(currentVolIdx, currentChapIdx);
    const next = { ...chapterState[key], ...getReadingAnchor(section), pct, v: ANCHOR_VERSION };

    if (pct >= 97) {
      next.done = true;
      readerFeatures?.completeChapter(currentVolIdx, currentChapIdx);
    }
    chapterState[key] = next;
    saveChapterState();
    if (pct >= 97) readingJournal?.observe(SERIES_META, currentVolIdx, chapterState, { volIdx: currentVolIdx, chapIdx: currentChapIdx });
  }

  function populateReaderSelect(volIdx, activeIndex) {
    const volume = DATA[volIdx];
    readerChapterSelect.innerHTML = "";

    volume.chapters.forEach((chapter, chapIdx) => {
      const option = document.createElement("option");
      const label = getChapterLabel(volume, chapIdx);
      option.value = String(chapIdx);
      if (chapter.isIllustration) option.textContent = label.title;
      else if (hasDistinctKicker(label)) option.textContent = `${label.kicker}: ${label.title}`; else if (label.kicker) option.textContent = label.title;
      else option.textContent = `${label.num}. ${label.title}`;
      option.selected = chapIdx === activeIndex;
      readerChapterSelect.appendChild(option);
    });
  }

  // data-p ties each element back to its paragraph, for search matches.
  function renderTextContent(paragraphs, firstIndex = 0, rich, block) {
    if (!paragraphs.length) {
      return "<p><em>Chưa có nội dung cho chương này.</em></p>";
    }

    return paragraphs
      .map((paragraph, p) => {
        p += firstIndex;
        if (paragraph.startsWith("---") && paragraph.endsWith("---")) {
          const heading = paragraph.replace(/^-+\s*/, "").replace(/\s*-+$/, "");
          if (!heading) return `<div class="section-break" data-p="${p}">• • •</div>`;
          return `<div class="section-break">• • •</div><p class="section-heading-inline" data-p="${p}">${escapeHtml(heading)}</p>`;
        }

        const isDialogue = /^["“‘「『]/.test(paragraph);
        const classes = [isDialogue ? "dialogue" : "", rich ? "ebook-text" : "", block?.list ? "ebook-list-item" : ""].filter(Boolean).join(" ");
        const list = block?.list ? ` data-list="${escapeHtml(block.list)}" data-level="${Math.min(5, block.level || 0)}"` : "";
        return `<p class="${classes}" data-p="${p}"${list}>${rich ? EbookImport.renderRich(rich) : escapeHtml(paragraph)}</p>`;
      })
      .join("");
  }

  function renderIllustrations(images) {
    if (!images || images.length === 0) {
      return "<p>Chưa có ảnh minh họa cho mục này.</p>";
    }

    return images.map((image) => renderIllustration(image, "Minh họa")).join("");
  }

  // width/height reserve the picture's space before it loads, so the text
  // below it does not jump while the reader is partway down the page.
  function renderIllustration(image, alt) {
    return `
      <div class="illustration-container">
        <button type="button" class="illustration-open" aria-label="${document.body.dataset.spoilers === "hidden" ? "Hiện ảnh minh họa" : "Phóng to ảnh"}">
          <img src="${image.src}" width="${image.w}" height="${image.h}" alt="${escapeHtml(alt)}" class="illustration-img" loading="lazy" decoding="async">
          <span class="illustration-reveal" aria-hidden="true">Ảnh minh họa · bấm để hiện</span>
        </button>
      </div>
    `;
  }

  function updateNavButtons() {
    const prevTarget = getAdjacentChapter(-1);
    const nextTarget = getAdjacentChapter(1);
    const volume = DATA[currentVolIdx];

    btnReaderPrev.disabled = !prevTarget;
    btnReaderNext.disabled = !nextTarget;
    btnPrevInline.disabled = !prevTarget;
    btnNextInline.disabled = !nextTarget;

    prevInlineTitle.textContent = prevTarget ? describeTarget(prevTarget) : "Đây là chương đầu tiên";
    nextInlineTitle.textContent = nextTarget ? describeTarget(nextTarget) : "Bạn đã đọc đến chương mới nhất";

    chapterIndicator.textContent = `${currentChapIdx + 1} / ${volume.chapters.length}`;
  }

  function describeTarget(target) {
    const volume = DATA[target.volIdx];
    const title = getChapterLabel(volume, target.chapIdx).title;
    return target.volIdx === currentVolIdx ? title : `${volume.name} · ${title}`;
  }

  // The chapter before/after `from` (default: the current one), crossing
  // into the neighbouring volume at either end.
  function getAdjacentChapter(direction, from) {
    const start = from || { volIdx: currentVolIdx, chapIdx: currentChapIdx };
    if (start.volIdx < 0 || start.chapIdx < 0) return null;

    let volIdx = start.volIdx;
    let chapIdx = start.chapIdx + direction;

    while (volIdx >= 0 && volIdx < DATA.length) {
      const volume = DATA[volIdx];

      if (chapIdx >= 0 && chapIdx < volume.chapters.length) {
        return { volIdx, chapIdx };
      }

      volIdx += direction > 0 ? 1 : -1;

      if (volIdx < 0 || volIdx >= DATA.length) {
        return null;
      }

      chapIdx = direction > 0 ? 0 : DATA[volIdx].chapters.length - 1;
    }

    return null;
  }

  function navigateChapter(direction) {
    const target = getAdjacentChapter(direction);
    if (target) {
      openChapter(target.volIdx, target.chapIdx, { replace: true });
    }
  }

  function setChapterFilter(filter) {
    chapterFilter = filter;
    btnFilterAll.classList.toggle("is-active", filter === "all");
    btnFilterStory.classList.toggle("is-active", filter === "story");
    btnFilterIllustration.classList.toggle("is-active", filter === "illustration");
    renderChapterList();
    triggerEinkRefresh(240);
  }

  function toggleChapterSort() {
    chapterSort = chapterSort === "asc" ? "desc" : "asc";
    btnSortChapters.dataset.order = chapterSort;
    sortLabel.textContent = chapterSort === "asc" ? "Cũ → mới" : "Mới → cũ";
    renderChapterList();
    triggerEinkRefresh(240);
  }

  function startReading() {
    const firstTarget = getFirstReadableChapter(0) || { volIdx: 0, chapIdx: 0 };
    openChapter(firstTarget.volIdx, firstTarget.chapIdx, { fromTop: true });
  }

  function getFirstReadableChapter(volIdx) {
    const volume = DATA[volIdx];
    if (!volume) return null;

    const chapIdx = volume.chapters.findIndex((chapter) => !chapter.isIllustration);
    return { volIdx, chapIdx: chapIdx >= 0 ? chapIdx : 0 };
  }

  function getLastReadableChapter(volIdx) {
    const volume = DATA[volIdx];
    if (!volume) return null;

    for (let i = volume.chapters.length - 1; i >= 0; i -= 1) {
      if (!volume.chapters[i].isIllustration) {
        return { volIdx, chapIdx: i };
      }
    }

    return { volIdx, chapIdx: Math.max(volume.chapters.length - 1, 0) };
  }

  function updateScrollProgress() {
    if (readerSurfaces?.isLocked()) return;
    if (currentView !== "reader") return;

    trackCurrentChapter();
    maybeAppendNextChapter();

    const section = sectionFor(currentVolIdx, currentChapIdx);
    const progress = section ? chapterPercent(section) : 0;

    progressFill.style.width = `${progress}%`;
    readerProgressFill.style.width = `${progress}%`;
    readerProgressText.textContent = `${Math.round(progress)}%`;

    const left = minutesLeft(DATA[currentVolIdx].chapters[currentChapIdx], progress);
    // Time left lives in the status bar (phones) or the sidebar (desktop),
    // not under the header title as well.
    readerTimeLeft.textContent = left === null ? "—" : left === 0 ? "Sắp hết" : `~${left} phút`;
    readerWorkbench?.updateStatus();
    schedulePositionSave();
  }

  // Minutes of reading left in a chapter: null for picture pages, 0 once
  // the end is in sight.
  function minutesLeft(chapter, progress) {
    if (chapter.isIllustration || !chapter.words) return null;
    if (progress >= 97) return 0;
    return readingMinutes(chapter.words * (1 - progress / 100));
  }

  let positionSaveScheduled = false;

  function schedulePositionSave() {
    if (positionSaveScheduled) return;
    positionSaveScheduled = true;
    window.setTimeout(() => {
      positionSaveScheduled = false;
      recordReadingPosition();
    }, 150);
  }

  function changeFontSize(direction) {
    preserveReaderPosition(() => {
      fontSize = clamp(fontSize + direction * 2, 16, 28);
      localStorage.setItem("tenshi-font-size", String(fontSize)); applyFontSize();
    });
    triggerEinkRefresh(260);
  }

  function applyFontSize() {
    document.documentElement.style.setProperty("--reader-font-size", `${fontSize}px`);
    fontSizeValue.textContent = `${fontSize}px`;
    btnFontDown.disabled = fontSize <= 16;
    btnFontUp.disabled = fontSize >= 28;
  }

  function setLineHeight(value) {
    if (Number.isNaN(value)) return;
    preserveReaderPosition(() => { lineHeight = value; localStorage.setItem("tenshi-line-height", String(lineHeight)); applyLineHeight(); });
    triggerEinkRefresh(260);
  }

  function applyLineHeight() {
    document.documentElement.style.setProperty("--reader-line-height", String(lineHeight));
    lineHeightSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", parseFloat(btn.dataset.lineValue) === lineHeight);
    });
  }

  function setFontFamily(value) {
    if (value !== "serif" && value !== "sans" && value !== "system") return;
    preserveReaderPosition(() => { fontFamily = value; localStorage.setItem("tenshi-font-family", fontFamily); applyFontFamily(); });
    triggerEinkRefresh(260);
  }

  function applyFontFamily() {
    document.documentElement.style.setProperty("--reader-font-family", `var(--font-${fontFamily})`);
    fontFamilySwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.fontValue === fontFamily);
    });
  }

  // "auto" justifies on wide screens only; see .reader-content p in style.css.
  const TEXT_ALIGNS = ["auto", "justify", "start"];

  function setTextAlign(value) {
    if (!TEXT_ALIGNS.includes(value)) return;
    preserveReaderPosition(() => { textAlign = value; localStorage.setItem("tenshi-text-align", textAlign); applyTextAlign(); });
    triggerEinkRefresh(260);
  }

  function applyTextAlign() {
    document.documentElement.dataset.textAlign = textAlign;
    textAlignSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.alignValue === textAlign);
    });
  }

  function resetTextSettings() {
    preserveReaderPosition(() => {
      fontSize = 20;
      lineHeight = 2.02;
      fontFamily = "serif";
      textAlign = "auto";
      ["tenshi-font-size", "tenshi-line-height", "tenshi-font-family", "tenshi-text-align"].forEach((key) => localStorage.removeItem(key));
      readingComfort?.reset(["letter", "word"]);
      applyFontSize();
      applyLineHeight();
      applyFontFamily();
      applyTextAlign();
    });
    triggerEinkRefresh(260);
    showMessage("Đã khôi phục cỡ chữ, giãn dòng, phông, căn lề và khoảng cách mặc định.");
  }

  function setTheme(value) {
    if (value !== "light" && value !== "sepia" && value !== "dark") return;
    theme = value;
    localStorage.setItem("tenshi-theme", theme);
    applyTheme();
    triggerEinkRefresh(360);
  }

  function applyTheme() {
    document.body.dataset.theme = theme;
    themeSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.themeValue === theme);
    });

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = getComputedStyle(document.body).getPropertyValue("--bg").trim();
    }
  }

  function setImageMode(value) {
    if (value !== "color" && value !== "mono") return;
    imageMode = value;
    localStorage.setItem("tenshi-image-mode", imageMode);
    applyImageMode();
    triggerEinkRefresh(360);
  }

  function applyImageMode() {
    document.body.dataset.images = imageMode;
    imageModeSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.imageValue === imageMode);
    });
  }

  function setContinuous(value) {
    if (value !== "on" && value !== "off") return;
    continuousEnabled = value === "on";
    localStorage.setItem("tenshi-continuous", value);
    applyContinuous();

    // Switching to one chapter per page: drop the chapters stacked around the
    // one being read and put the reader back on the same paragraph.
    if (currentView === "reader" && !continuousEnabled && chapterSections().length > 1) {
      preserveReaderPosition(() => renderChapterView(currentVolIdx, currentChapIdx));
    }

    updateScrollProgress();
    triggerEinkRefresh(260);
  }

  function setTapPaging(value) {
    if (value !== "on" && value !== "off") return;
    tapPagingEnabled = value === "on";
    localStorage.setItem("tenshi-tap-page", value);
    applyTapPaging();
    triggerEinkRefresh(260);
  }

  function applyTapPaging() {
    tapPageSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", (btn.dataset.tapValue === "on") === tapPagingEnabled);
    });
  }

  function setWakeLock(value) {
    if (value !== "on" && value !== "off") return;
    wakeLockEnabled = value === "on";
    localStorage.setItem("tenshi-wake-lock", value);
    applyWakeLock();
    syncWakeLock();
    triggerEinkRefresh(260);
  }

  function applyWakeLock() {
    wakeLockGroup.hidden = !("wakeLock" in navigator);
    wakeLockSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", (btn.dataset.wakeValue === "on") === wakeLockEnabled);
    });
  }

  function applyContinuous() {
    continuousSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", (btn.dataset.continuousValue === "on") === continuousEnabled);
    });
  }

  function setEink(value) {
    if (value !== "on" && value !== "off") return;
    einkEnabled = value === "on";
    localStorage.setItem("tenshi-eink", value);
    applyEink();
    triggerEinkRefresh(360);
  }

  function applyEink() {
    document.body.dataset.eink = einkEnabled ? "on" : "off";
    einkSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", (btn.dataset.einkValue === "on") === einkEnabled);
    });
  }

  function setChromeHidden(hidden) {
    document.body.classList.toggle("is-chrome-hidden", hidden);
  }

  // Reader only: scrolling down into the text hides the header and bottom
  // bar; scrolling up, reaching either end, or opening settings shows them.
  function updateChromeVisibility() {
    if (readerSurfaces?.isLocked()) return;
    const y = window.scrollY;

    // A tap-turned page scrolls on its own; it should not pop the bars back.
    if (Date.now() < chromeLockedUntil) {
      lastChromeScrollY = y;
      return;
    }

    if (currentView !== "reader" || settingsPanel.classList.contains("is-open")) {
      setChromeHidden(false);
      lastChromeScrollY = y;
      return;
    }

    const nearBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 120;
    if (y < 80 || nearBottom) {
      setChromeHidden(false);
      lastChromeScrollY = y;
      return;
    }

    const delta = y - lastChromeScrollY;
    if (Math.abs(delta) < 12) return;

    setChromeHidden(delta > 0);
    lastChromeScrollY = y;
  }

  // ------------------------------------------------------------
  //  Tap to turn the page (touch screens).
  // ------------------------------------------------------------

  let chromeLockedUntil = 0;

  // Lower third of the screen turns forward, the top quarter back.
  function tapZone(y) {
    if (y > window.innerHeight * 0.67) return 1;
    if (y < window.innerHeight * 0.25) return -1;
    return 0;
  }

  // Moves one screenful of text, keeping about a line of overlap so the eye
  // can find its place. Turning forward also tucks the bars away.
  function turnPage(direction, fraction = 1) {
    if (isPaged()) { turnReaderPage(direction); return; }
    const chromeShown = !document.body.classList.contains("is-chrome-hidden");
    const nav = chromeShown && getComputedStyle(readerBottomNav).display !== "none"
      ? readerBottomNav.getBoundingClientRect().top
      : window.innerHeight;
    const visibleTop = readingLine();
    const overlap = fontSize * lineHeight * 1.2;
    const distance = direction > 0 ? nav - overlap : -(nav - overlap - visibleTop);

    chromeLockedUntil = Date.now() + 800;
    if (direction > 0) setChromeHidden(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: distance * fraction, behavior: einkEnabled || reducedMotion ? "auto" : "smooth" });
    triggerEinkRefresh(260);
  }

  // ------------------------------------------------------------
  //  Page mode: a chapter is read a screen at a time, like a book. The page
  //  does not scroll freely; taps at the sides, swipes, the wheel and the
  //  arrow keys turn it. Each page starts on a whole line, and a line cut
  //  off at the bottom is covered until the next page shows it whole.
  // ------------------------------------------------------------

  let lastPageTurnAt = 0;
  let pageSettleTimer = null;

  function isPaged() {
    return pageModeEnabled && currentView === "reader";
  }

  function setPageMode(value) {
    if (value !== "on" && value !== "off") return;
    preserveReaderPosition(() => {
      pageModeEnabled = value === "on";
      localStorage.setItem("tenshi-page-mode", value);
      applyPageMode();
    });
    if (isPaged()) { alignPageTop(); updatePageChrome(); }
    triggerEinkRefresh(260);
  }

  function applyPageMode() {
    document.body.dataset.pageMode = pageModeEnabled ? "on" : "off";
    document.documentElement.classList.toggle("is-paged", isPaged());
    pageModeSwitch.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", (btn.dataset.pageValue === "on") === pageModeEnabled);
    });
    const quick = $("#reader-aa-page");
    if (quick) quick.value = pageModeEnabled ? "on" : "off";
    readingComfort?.onModeChange();
    updatePageChrome();
  }

  // The band of the screen that shows text: under the header, above the
  // bottom bar. Taken from whether the bars are meant to be shown, not where
  // they are, since they slide in and out over a few frames.
  function pageArea() {
    const chromeShown = !document.body.classList.contains("is-chrome-hidden");
    const top = chromeShown ? header.offsetHeight : 0;
    const bottom = chromeShown && getComputedStyle(readerBottomNav).display !== "none"
      ? window.innerHeight - readerBottomNav.offsetHeight
      : window.innerHeight;
    return { top, bottom };
  }

  // Top edge (on screen) of the line of text that crosses height y, or null
  // between paragraphs. Pictures and headings count as one tall "line".
  function lineTopAt(y) {
    const column = readerChapters.getBoundingClientRect();
    const target = document.elementFromPoint(column.left + column.width / 2, y);
    const block = target?.closest(".reader-content > *, .reader-head, .reader-fin, .reader-end");
    if (!block || !readerChapters.contains(block)) return null;
    const range = document.createRange();
    range.selectNodeContents(block);
    for (const rect of range.getClientRects()) {
      if (rect.height && rect.top <= y && rect.bottom > y) return rect.top;
    }
    const box = block.getBoundingClientRect();
    return box.top <= y && box.bottom > y && box.height < window.innerHeight * 0.6 ? box.top : null;
  }

  // A line half hidden under the header moves down to be the page's first.
  function alignPageTop() {
    if (!isPaged()) return;
    const area = pageArea();
    // Probe a little below the edge: the thin progress bar sits on it.
    const top = lineTopAt(area.top + 4);
    if (top !== null && top < area.top) window.scrollBy({ top: top - area.top - 6, behavior: "instant" });
  }

  // Returns false at the very end (or start) of what can be read.
  function turnReaderPage(direction) {
    if (Date.now() - lastPageTurnAt < 120) return true;
    const area = pageArea();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (direction > 0 && window.scrollY >= max - 2) {
      const sections = chapterSections(), last = sections[sections.length - 1];
      const next = last && getAdjacentChapter(1, { volIdx: Number(last.dataset.vol), chapIdx: Number(last.dataset.chap) });
      if (!next) { showMessage("Đã đến trang cuối."); return false; }
      if (continuousEnabled) maybeAppendNextChapter();
      else navigateChapter(1);
      return true;
    }
    if (direction < 0 && window.scrollY <= 1) return false;
    lastPageTurnAt = Date.now();
    if (direction > 0) {
      // The line cut off at the bottom opens the next page. The bars tuck
      // away first, so the new page is laid out for the space it will have.
      const cut = lineTopAt(area.bottom - 1);
      if (!document.body.classList.contains("is-chrome-hidden")) { chromeLockedUntil = Date.now() + 800; setChromeHidden(true); }
      const next = pageArea();
      const step = cut !== null && cut - area.top > (area.bottom - area.top) * 0.3
        ? cut - next.top - 6
        : area.bottom - area.top - fontSize * lineHeight;
      window.scrollBy({ top: step, behavior: "instant" });
    } else {
      window.scrollBy({ top: -(area.bottom - area.top - fontSize * lineHeight), behavior: "instant" });
      alignPageTop();
    }
    if (einkEnabled) triggerEinkRefresh(260);
    else {
      readerChapters.classList.remove("is-turning-next", "is-turning-back");
      void readerChapters.offsetWidth;
      readerChapters.classList.add(direction > 0 ? "is-turning-next" : "is-turning-back");
    }
    updatePageChrome();
    // Fonts or pictures settling can still nudge the text: tidy up once the
    // bars have finished moving.
    clearTimeout(pageSettleTimer);
    pageSettleTimer = setTimeout(() => { alignPageTop(); updatePageChrome(); }, 360);
    return true;
  }

  // The cover over a cut-off last line, the page number and, with a mouse,
  // the arrows beside the text.
  function updatePageChrome() {
    const curtain = $("#page-curtain"), indicator = $("#page-indicator");
    const arrows = [$("#page-turn-prev"), $("#page-turn-next")];
    if (!isPaged()) {
      curtain.hidden = true; indicator.hidden = true; arrows.forEach((arrow) => { arrow.hidden = true; });
      return;
    }
    const area = pageArea(), height = area.bottom - area.top;
    const column = readerChapters.getBoundingClientRect();
    const cut = lineTopAt(area.bottom - 1);
    curtain.hidden = cut === null || cut <= area.top + 20;
    if (!curtain.hidden) {
      const frame = document.elementFromPoint(column.left + column.width / 2, area.bottom - 1)?.closest(".reader-frame");
      curtain.style.top = `${cut}px`;
      curtain.style.height = `${area.bottom - cut}px`;
      // Cover just the chapter's card, not the margins beside it.
      const box = (frame || readerChapters).getBoundingClientRect();
      curtain.style.left = `${box.left}px`;
      curtain.style.width = `${box.width}px`;
      const fill = frame && getComputedStyle(frame).backgroundColor;
      curtain.style.background = fill && fill !== "rgba(0, 0, 0, 0)" ? fill : getComputedStyle(document.body).backgroundColor;
    }
    const section = sectionFor(currentVolIdx, currentChapIdx);
    if (section && height > 0) {
      // A page advances by its height less the line carried over.
      const rect = section.getBoundingClientRect();
      const step = Math.max(1, height - fontSize * lineHeight);
      const page = Math.max(1, Math.round((area.top - rect.top) / step) + 1);
      const total = Math.max(page, Math.ceil(Math.max(0, rect.height - height) / step) + 1);
      indicator.textContent = `Trang ${page} / ${total}`;
      indicator.hidden = false;
    } else indicator.hidden = true;
    const mouse = window.matchMedia("(hover: hover)").matches;
    arrows.forEach((arrow, index) => {
      arrow.hidden = !mouse;
      arrow.style.left = index ? `${Math.min(window.innerWidth - 52, column.right + 12)}px` : `${Math.max(8, column.left - 56)}px`;
    });
  }

  // The wheel turns pages too, one per notch-ish flick.
  let wheelTotal = 0, wheelAt = 0, wheelTurnAt = 0;
  window.addEventListener("wheel", (event) => {
    if (!isPaged() || event.ctrlKey || event.target.closest?.(".reader-sidebar, dialog, #settings-panel, .listen-bar, .auto-scroll-bar")) return;
    event.preventDefault();
    if (Date.now() - wheelAt > 250) wheelTotal = 0;
    wheelAt = Date.now();
    wheelTotal += event.deltaY;
    if (Math.abs(wheelTotal) >= 40 && Date.now() - wheelTurnAt > 380) {
      turnReaderPage(Math.sign(wheelTotal));
      wheelTotal = 0;
      wheelTurnAt = Date.now();
    }
  }, { passive: false });
  window.addEventListener("resize", () => { if (isPaged()) { alignPageTop(); updatePageChrome(); } });
  $("#page-turn-prev").addEventListener("click", () => turnReaderPage(-1));
  $("#page-turn-next").addEventListener("click", () => turnReaderPage(1));

  // ------------------------------------------------------------
  //  Keep the screen on while reading. The lock lapses after ten idle
  //  minutes, so a phone left face-up still goes to sleep.
  // ------------------------------------------------------------

  const WAKE_IDLE_MS = 10 * 60 * 1000;
  let wakeLock = null;
  let wakeLockRequest = null;
  let wakeIdle = false;
  let wakeIdleTimer = null;
  let lastActivityAt = 0;

  // While a device voice reads the screen stays on regardless: browsers stop
  // speaking once it goes off. The online voice plays on with it off.
  function wantsWakeLock() {
    if (document.visibilityState !== "visible") return false;
    if (listen.playing && listen.engine === "device") return true;
    return wakeLockEnabled && !wakeIdle && currentView === "reader";
  }

  function syncWakeLock() {
    if (!("wakeLock" in navigator)) return;
    if (!wantsWakeLock()) {
      releaseWakeLock();
      return;
    }
    if (wakeLock || wakeLockRequest) return;

    wakeLockRequest = navigator.wakeLock.request("screen")
      .then((lock) => {
        wakeLock = lock;
        lock.addEventListener("release", () => {
          if (wakeLock === lock) wakeLock = null;
        });
        if (!wantsWakeLock()) releaseWakeLock();
      })
      .catch(() => {})
      .finally(() => { wakeLockRequest = null; });
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }

  function noteReaderActivity() {
    const now = Date.now();
    // Restarting the idle timer on every scroll event is wasteful; every few
    // seconds is plenty against a ten-minute timeout.
    if (wakeIdle || !wakeIdleTimer || now - lastActivityAt > 5000) {
      lastActivityAt = now;
      wakeIdle = false;
      clearTimeout(wakeIdleTimer);
      wakeIdleTimer = window.setTimeout(() => {
        wakeIdle = true;
        syncWakeLock();
      }, WAKE_IDLE_MS);
    }
    syncWakeLock();
  }

  // ------------------------------------------------------------
  //  Nghe truyện: the device's own text-to-speech voice reads the story
  //  aloud. It runs from the story data rather than the page, so it keeps
  //  going chapter after chapter (and into the next volume) wherever the
  //  reader is in the app; the paragraph being read is highlighted, and
  //  followed, whenever it is on screen.
  // ------------------------------------------------------------

  const speech = "speechSynthesis" in window ? window.speechSynthesis : null;
  // Two ways to read aloud: the device's own voice (Web Speech API), or the
  // voice behind translate.google.com's speaker button, fetched as audio a
  // sentence at a time. The online one works in every browser and keeps
  // playing with the screen off, but it is unofficial: Google may throttle
  // or change it, so a failure falls back to the device voice.
  const ONLINE_VOICE = "online:google";
  const LISTEN_RATES = [0.75, 1, 1.25, 1.5];
  const LISTEN_SLEEP = [0, 15, 30, 60, "chapter"];
  // Chrome silently drops an utterance that runs past ~15 seconds, so text
  // is spoken in sentence-sized pieces.
  const LISTEN_CHUNK = 160;
  // Google's clips: silence before and after the voice, and its usual pace
  // in speechTiming units (measured on its Vietnamese voice).
  const ONLINE_LEAD = 0.12;
  const ONLINE_TAIL = 0.85;
  const ONLINE_PACE = 0.058;
  // Google's audio cannot be cached or read by the page, so the next pieces
  // are each loaded into an <audio> element of their own, ready to play.
  // Google shuts out a network that asks too much at once: never more than
  // two requests in flight, the piece playing included.
  const PREFETCH_AHEAD = 6;
  const ONLINE_MAX_REQUESTS = 2;
  // After a refusal, no prefetching for a while: only the piece being
  // played is asked for, with a longer wait before each new try.
  const PREFETCH_COOLDOWN_MS = 60000;
  const ONLINE_RETRY_MS = [1000, 4000, 10000];
  // Google's voice answers at two addresses; when it shuts one out (its
  // "unusual traffic" page), the other may still answer.
  const ONLINE_HOSTS = ["https://translate.google.com", "https://translate.googleapis.com"];
  const FOLLOW_PAUSE_MS = 8000;
  // CSS Custom Highlight API: marks the sentence and word being spoken
  // without touching the page's markup.
  const canHighlightSpeech = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";

  const listen = {
    active: false,
    playing: false,
    volIdx: -1,
    chapIdx: -1,
    queue: [],
    i: 0,
    token: 0,
    errors: 0,
    lastEventAt: 0,
    followPausedAt: 0,
    rate: 1,
    voiceURI: "",
    speakingEl: null,
    engine: "device",
    onlineFailed: false,
    // The element playing the online voice (and the piece it holds), the
    // ones loading the next pieces ({ audio, text, state, load }), and the
    // last element seen playing (iOS may refuse to start the others).
    audio: null,
    audioText: null,
    clips: [],
    trusted: null,
    clipsBlocked: false,
    prefetchPausedUntil: 0,
    host: 0,
    nextQueue: null,
    nextTextRetryAt: 0,
    mediaKey: null,
    // Word timing: real boundary events where the voice sends them,
    // otherwise an estimate from how fast earlier pieces were spoken
    // (in speechTiming units: device voices in ms, Google's in seconds).
    realBoundaries: false,
    msPerUnit: 62,
    onlinePace: ONLINE_PACE,
    wordTimer: null,
    sleep: 0,
    sleepTimer: null,
    sleepTicker: null,
    sleepUntil: 0
  };

  function initListening() {
    [btnBottomListen, btnReaderListen].forEach((btn) => {
      btn.addEventListener("click", listenFromReader);
    });

    renderVoiceOptions();
    if (speech) {
      speech.addEventListener("voiceschanged", renderVoiceOptions);
      // Not every browser announces voices that arrive late.
      [300, 1000, 3000].forEach((ms) => window.setTimeout(renderVoiceOptions, ms));
    }
    listenVoiceSelect.addEventListener("change", () => {
      listen.voiceURI = listenVoiceSelect.value;
      listen.realBoundaries = false;
      listen.onlineFailed = false;
      localStorage.setItem("tenshi-listen-voice", listen.voiceURI);
      renderVoiceOptions();
      if (listen.playing) speakCurrent();
    });

    // Lock-screen and headset controls (they act on the online voice, which
    // plays through an <audio> element).
    if ("mediaSession" in navigator) {
      const actions = {
        play: () => setListenPlaying(true),
        pause: () => setListenPlaying(false),
        previoustrack: () => stepListening(-1),
        nexttrack: () => stepListening(1),
        stop: closeListening
      };
      Object.entries(actions).forEach(([action, handler]) => {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch (error) {
          // Action not supported by this browser.
        }
      });
    }

    listenToggle.addEventListener("click", () => setListenPlaying(!listen.playing));
    listenPrev.addEventListener("click", () => stepListening(-1));
    listenNext.addEventListener("click", () => stepListening(1));
    listenRate.addEventListener("click", cycleListenRate);
    listenSleep.addEventListener("click", cycleListenSleep);
    listenClose.addEventListener("click", closeListening);
    listenWhere.addEventListener("click", revealListening);

    // Some voices stall without an error; restart the current piece if
    // nothing has been heard for a while (or give up on a stuck download).
    window.setInterval(() => {
      if (!listen.playing) return;
      const idle = Date.now() - listen.lastEventAt;
      if (listen.engine === "online") {
        if (idle > 20000 && listen.audio && (listen.audio.paused || listen.audio.readyState < 3)) onlineFailure();
      } else if ((idle > 8000 && !speech.speaking && !speech.pending) || idle > 20000) {
        speakCurrent();
      }
    }, 4000);
  }

  function vietnameseVoices() {
    return speech ? speech.getVoices().filter((voice) => /^vi([-_]|$)/i.test(voice.lang)) : [];
  }

  // Neural/online voices (Edge's HoaiMy and NamMinh, Android's "Google Tiếng
  // Việt … (Natural)") sound far better than the older on-device ones.
  function voiceScore(voice) {
    let score = 0;
    if (/natural|online|neural|premium|enhanced/i.test(voice.name)) score += 4;
    if (/hoaimy|namminh|google/i.test(voice.name)) score += 2;
    return score;
  }

  function listenVoice() {
    const voices = vietnameseVoices();
    return voices.find((voice) => voice.voiceURI === listen.voiceURI)
      || voices.slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0]
      || null;
  }

  function renderVoiceOptions() {
    const voices = vietnameseVoices();
    listenVoiceSelect.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Tự chọn";
    listenVoiceSelect.appendChild(auto);
    const online = document.createElement("option");
    online.value = ONLINE_VOICE;
    online.textContent = "Google Dịch (trực tuyến)";
    listenVoiceSelect.appendChild(online);
    voices.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = voice.name.replace(/\s*-\s*Vietnamese \(Vietnam\)/i, "");
      listenVoiceSelect.appendChild(option);
    });
    const known = listen.voiceURI === ONLINE_VOICE || voices.some((voice) => voice.voiceURI === listen.voiceURI);
    listenVoiceSelect.value = known ? listen.voiceURI : "";

    const onlineNote = "Google Dịch: dùng được trên mọi máy và nghe được cả khi tắt màn hình, cần có mạng (dịch vụ không chính thức, nếu lỗi sẽ tự chuyển sang giọng của máy).";
    listenVoiceHint.textContent = voices.length
      ? `${onlineNote} Giọng của máy: không cần mạng nhưng màn hình phải luôn sáng; hay nhất là Edge (HoaiMy, NamMinh) và Android (Google Tiếng Việt).`
      : `${onlineNote} Máy này chưa có giọng tiếng Việt riêng để đọc khi mất mạng. ${voiceInstallHint()}`;
  }

  // Which voice reads: the one chosen in settings; on "Tự chọn", a neural
  // device voice on a computer (Edge's HoaiMy sounds best and the screen is
  // on anyway), otherwise the online voice, which keeps playing with a
  // phone's screen off. Falls back to any device voice once online fails.
  function chooseListenEngine() {
    const device = listenVoice();
    if (listen.voiceURI === ONLINE_VOICE) return !listen.onlineFailed ? "online" : device ? "device" : null;
    if (listen.voiceURI && device && device.voiceURI === listen.voiceURI) return "device";

    const onComputer = !window.matchMedia("(hover: none)").matches;
    if (device && onComputer && voiceScore(device) >= 4) return "device";
    if (!listen.onlineFailed) return "online";
    return device ? "device" : null;
  }

  // Where to get a Vietnamese voice on this device. Websites only get the
  // voices the operating system provides (plus Edge's online ones): Chrome's
  // own Google voices have no Vietnamese on a laptop, so there Edge is
  // usually the easy answer.
  function voiceInstallHint() {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) {
      return "Android: Cài đặt › Chuyển văn bản thành giọng nói › tải giọng Tiếng Việt, rồi mở lại trình duyệt.";
    }
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
      return "iPhone/iPad: Cài đặt › Trợ năng › Nội dung được đọc › Giọng nói › Tiếng Việt, rồi mở lại Safari.";
    }
    if (/Edg\//.test(ua)) {
      return "Giọng HoaiMy và NamMinh của Edge cần có mạng: kiểm tra kết nối rồi tải lại trang.";
    }
    if (/Windows/i.test(ua)) {
      return "Trên Windows, dễ nhất là mở trang bằng Microsoft Edge (có sẵn giọng HoaiMy, NamMinh rất hay). Hoặc cài giọng cho Windows: Cài đặt › Thời gian và ngôn ngữ › Giọng nói › Thêm giọng nói › Tiếng Việt, rồi mở lại trình duyệt.";
    }
    if (/Macintosh/.test(ua)) {
      return "Trên Mac: Cài đặt hệ thống › Trợ năng › Nội dung được đọc › Giọng hệ thống › Quản lý giọng nói › Tiếng Việt, rồi mở lại trình duyệt. Hoặc mở trang bằng Microsoft Edge.";
    }
    return "Hãy mở trang bằng Microsoft Edge trên máy tính, hoặc Chrome trên Android.";
  }

  // What gets spoken for a chapter: its title, then every paragraph in
  // pieces of a sentence or two.
  function buildListenQueue(volIdx, chapIdx) {
    const volume = DATA[volIdx];
    const label = getChapterLabel(volume, chapIdx);
    const queue = [{ p: -1, text: `${[label.kicker, label.title].filter(Boolean).join(". ")}.`, start: null }];

    chapterParagraphs(volume.chapters[chapIdx]).forEach((paragraph, p) => {
      if (paragraph.startsWith("---") && paragraph.endsWith("---")) {
        const heading = paragraph.replace(/^-+\s*/, "").replace(/\s*-+$/, "");
        if (heading) splitForSpeech(heading).forEach((piece) => queue.push({ p, ...piece }));
        return;
      }
      splitForSpeech(paragraph).forEach((piece) => queue.push({ p, ...piece }));
    });
    return queue;
  }

  // Pieces of a sentence or two, each with its [start, end) in the
  // paragraph so the words can be marked as they are spoken. The spoken text
  // keeps the paragraph's length (symbols become spaces), so a voice's
  // character offsets map straight back onto the page.
  function splitForSpeech(paragraph) {
    const sentences = [];
    const sentencePattern = /[^.!?…]+(?:[.!?…]+["”’»)]*|$)/g;
    let match;
    while ((match = sentencePattern.exec(paragraph))) sentences.push([match.index, match.index + match[0].length]);
    if (!sentences.length) sentences.push([0, paragraph.length]);

    // Trim, and break any sentence too long for one utterance at a comma,
    // else a space.
    const pieces = [];
    sentences.forEach(([from, to]) => {
      let start = from;
      let end = to;
      while (start < end && /\s/.test(paragraph[start])) start += 1;
      while (end > start && /\s/.test(paragraph[end - 1])) end -= 1;
      while (end - start > LISTEN_CHUNK) {
        const span = paragraph.slice(start, start + LISTEN_CHUNK);
        let cut = span.lastIndexOf(",");
        if (cut < LISTEN_CHUNK / 2) cut = span.lastIndexOf(" ");
        if (cut <= 0) cut = LISTEN_CHUNK - 1;
        pieces.push([start, start + cut + 1]);
        start += cut + 1;
        while (start < end && /\s/.test(paragraph[start])) start += 1;
      }
      if (end > start) pieces.push([start, end]);
    });

    // Then pack short sentences together: fewer gaps between utterances.
    const chunks = [];
    pieces
      .filter(([start, end]) => /[\p{L}\p{N}]/u.test(paragraph.slice(start, end)))
      .forEach(([start, end]) => {
        const last = chunks[chunks.length - 1];
        if (last && end - last[0] <= LISTEN_CHUNK) last[1] = end;
        else chunks.push([start, end]);
      });

    return chunks.map(([start, end]) => ({
      start,
      end,
      text: paragraph.slice(start, end).replace(/[*_~「」『』[\]]/g, " ")
    }));
  }

  // Starts from the paragraph at the top of the screen (or the chapter title
  // when the reader has not scrolled into the chapter yet).
  function listenFromReader() {
    // Pressing "Nghe" again gives the online voice another chance.
    listen.onlineFailed = false;

    // No usable voice (a foreign device voice would mangle the text): show
    // how to get one instead.
    if (!chooseListenEngine()) {
      renderVoiceOptions();
      openSettings("listen");
      listenVoiceGroup.scrollIntoView({ block: "center" });
      return;
    }

    const section = sectionFor(currentVolIdx, currentChapIdx);
    let startP = null;
    if (section && section.getBoundingClientRect().top < readingLine() - 40) {
      const anchor = getReadingAnchor(section);
      const blocks = section.querySelector(".reader-content").children;
      for (let b = anchor.block; b < blocks.length; b += 1) {
        if (blocks[b].dataset.p != null) {
          startP = Number(blocks[b].dataset.p);
          break;
        }
      }
    }

    startListening(currentVolIdx, currentChapIdx, startP);
  }

  function startListening(volIdx, chapIdx, startP) {
    // Warm up the connection to the online voice.
    const host = ONLINE_HOSTS[listen.host];
    if (!document.querySelector(`link[href="${host}"]`)) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = host;
      document.head.appendChild(link);
    }
    prepareListenAudio();
    listen.active = true;
    listen.playing = true;
    listen.errors = 0;
    listen.followPausedAt = 0;
    listenBar.hidden = false;
    document.body.classList.add("is-listening");
    setListenChapter(volIdx, chapIdx, startP);

    // Must speak straight away: iOS only allows speech started by a tap.
    if (DATA[volIdx].chapters[chapIdx].isIllustration) finishListenChapter();
    else speakCurrent();
    syncWakeLock();
  }

  function setListenChapter(volIdx, chapIdx, startP) {
    listen.volIdx = volIdx;
    listen.chapIdx = chapIdx;
    listen.queue = buildListenQueue(volIdx, chapIdx);
    if (startP == null) {
      listen.i = 0;
    } else {
      const index = listen.queue.findIndex((item) => item.p >= startP);
      listen.i = index < 0 ? listen.queue.length : index;
    }
    renderListenBar();
  }

  function speakCurrent() {
    const item = listen.queue[listen.i];
    if (!item) {
      finishListenChapter();
      return;
    }

    const token = ++listen.token;
    const busy = Boolean(speech && (speech.speaking || speech.pending));
    stopAllSpeech();

    listen.engine = chooseListenEngine();
    if (!listen.engine) {
      setListenPlaying(false);
      showMessage("Máy chưa có giọng đọc tiếng Việt. Xem cách cài trong Cài đặt đọc.");
      return;
    }

    if (listen.engine === "online") speakOnline(item, token);
    else speakOnDevice(item, token, busy);

    showListeningParagraph(true);
    renderListenBar();
    syncWakeLock();
  }

  function speakOnDevice(item, token, busy) {
    // Only ever a real Vietnamese voice: left to itself, Safari reads the
    // text with the default (English) voice.
    const voice = listenVoice();
    if (!voice) {
      setListenPlaying(false);
      showMessage("Máy chưa có giọng đọc tiếng Việt. Chọn giọng Google Dịch trong Cài đặt đọc.");
      return;
    }

    const spoken = readerFeatures.speech(item.text);
    const utterance = new SpeechSynthesisUtterance(spoken.text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = listen.rate;

    let startedAt = 0;
    let boundaries = 0;
    const heard = () => {
      if (token !== listen.token) return;
      listen.lastEventAt = Date.now();
      listen.errors = 0;
    };
    utterance.onstart = () => {
      if (token !== listen.token) return;
      heard();
      startedAt = Date.now();
      estimateWords(item, token, startedAt);
    };
    utterance.onboundary = (event) => {
      if (token !== listen.token) return;
      heard();
      if (event.name && event.name !== "word") return;
      // A voice that reports words: trust it from now on (one stray event
      // at the start is not enough).
      boundaries += 1;
      if (boundaries >= 2) {
        listen.realBoundaries = true;
        stopWordEstimate();
      }
      const index = spoken.map[Math.min(event.charIndex || 0, spoken.text.length)];
      const end = spoken.map[Math.min((event.charIndex || 0) + (event.charLength || 1), spoken.text.length)];
      markSpokenWord(index, event.charLength ? Math.max(1, end - index) : undefined);
    };
    utterance.onend = () => {
      if (token !== listen.token) return;
      heard();
      stopWordEstimate();
      // Learn this voice's pace for the estimated word marking.
      const took = Date.now() - startedAt;
      if (startedAt && took > 400 && item.text.length > 20) {
        listen.msPerUnit = listen.msPerUnit * 0.7 + ((took * listen.rate) / speechTiming(item.text).units) * 0.3;
      }
      listen.i += 1;
      if (listen.playing) speakCurrent();
    };
    utterance.onerror = (event) => {
      if (token !== listen.token) return;
      // Our own cancel() when skipping or pausing.
      if (event.error === "interrupted" || event.error === "canceled") return;
      listen.errors += 1;
      // Needs a fresh tap (iOS after the tab was hidden), or the voice keeps
      // failing: stop rather than race through the book.
      if (event.error === "not-allowed" || listen.errors >= 3) {
        setListenPlaying(false);
        if (event.error !== "not-allowed") showMessage("Giọng đọc đang gặp lỗi. Thử chọn giọng khác trong Cài đặt đọc.");
        return;
      }
      listen.i += 1;
      if (listen.playing) speakCurrent();
    };

    listen.lastEventAt = Date.now();
    // Safari can drop an utterance queued in the same tick as cancel().
    if (busy) {
      window.setTimeout(() => {
        if (token === listen.token) speech.speak(utterance);
      }, 60);
    } else {
      speech.speak(utterance);
    }
  }

  function newListenAudio() {
    const audio = new Audio();
    audio.preload = "auto";
    return audio;
  }

  // Runs in the tap that starts listening: iOS lets an element start on its
  // own later only if it was touched during a tap.
  function prepareListenAudio() {
    if (!listen.audio) listen.audio = newListenAudio();
    while (listen.clips.length < PREFETCH_AHEAD) {
      const clip = { audio: newListenAudio(), text: null, state: "idle", load: 0 };
      clip.audio.load();
      listen.clips.push(clip);
    }
  }

  function nextListenChapter() {
    let next = getAdjacentChapter(1, { volIdx: listen.volIdx, chapIdx: listen.chapIdx });
    while (next && DATA[next.volIdx].chapters[next.chapIdx].isIllustration) next = getAdjacentChapter(1, next);
    return next;
  }

  // The pieces to have ready: the rest of this chapter, then the start of
  // the next one (fetching its text if need be).
  function upcomingTexts() {
    const texts = listen.queue.slice(listen.i + 1, listen.i + 1 + PREFETCH_AHEAD).map((item) => item.text);
    const next = texts.length < PREFETCH_AHEAD && listen.sleep !== "chapter" && nextListenChapter();
    if (next && !loadedVolumes.has(next.volIdx)) {
      if (Date.now() > listen.nextTextRetryAt) {
        loadVolumeText(next.volIdx).then(prefetchAhead, () => {
          listen.nextTextRetryAt = Date.now() + 30000;
        });
      }
    } else if (next) {
      const key = chapterKey(next.volIdx, next.chapIdx);
      if (!listen.nextQueue || listen.nextQueue.key !== key) {
        listen.nextQueue = { key, queue: buildListenQueue(next.volIdx, next.chapIdx) };
      }
      listen.nextQueue.queue.slice(0, PREFETCH_AHEAD - texts.length).forEach((item) => texts.push(item.text));
    }
    return texts;
  }

  // Keeps the next pieces loading, nearest first, within the request limit;
  // not for a while after Google has refused something.
  function prefetchAhead() {
    if (!listen.active || listen.engine !== "online" || listen.clipsBlocked) {
      listen.clips.forEach(resetClip);
      return;
    }

    const wanted = upcomingTexts();
    listen.clips.forEach((clip) => {
      if (clip.text !== null && !wanted.includes(clip.text)) resetClip(clip);
    });
    // In the background the playing element loads each piece itself.
    if (document.hidden || Date.now() < listen.prefetchPausedUntil) return;

    // The playing piece counts while it is still coming in (readyState
    // drops back at once when its src is set; networkState lags).
    const player = listen.audio;
    const playerLoading = player && listen.audioText && !player.error
      && (player.networkState === HTMLMediaElement.NETWORK_LOADING || player.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA);
    let loading = (playerLoading ? 1 : 0) + listen.clips.filter((clip) => clip.state === "loading").length;
    for (const text of wanted) {
      let clip = listen.clips.find((c) => c.text === text);
      if (!clip) {
        clip = listen.clips.find((c) => c.state === "idle");
        if (!clip) break;
        clip.text = text;
        clip.state = "waiting";
      }
      if (clip.state === "waiting" && loading < ONLINE_MAX_REQUESTS) {
        loadClip(clip);
        loading += 1;
      }
    }
  }

  function loadClip(clip) {
    const load = ++clip.load;
    const audio = clip.audio;
    clip.state = "loading";
    audio.oncanplaythrough = () => {
      if (load !== clip.load || clip.state !== "loading") return;
      clip.state = "ready";
      prefetchAhead();
    };
    // Most likely Google refusing: trying again at once would only keep the
    // door shut longer. The piece is asked for (and retried) in its turn.
    audio.onerror = () => {
      if (load === clip.load && clip.state === "loading") pausePrefetch();
    };
    audio.src = onlineSpeechUrl(clip.text);
    audio.load();
  }

  // Pieces already loaded are kept; the rest stop.
  function pausePrefetch() {
    listen.prefetchPausedUntil = Date.now() + PREFETCH_COOLDOWN_MS;
    listen.clips.forEach((clip) => {
      if (clip.state !== "ready") resetClip(clip);
    });
  }

  function resetClip(clip) {
    if (clip.state !== "idle") emptyClip(clip);
  }

  function emptyClip(clip) {
    Object.assign(clip, { text: null, state: "idle", load: clip.load + 1 });
    const audio = clip.audio;
    audio.onplaying = audio.onended = audio.onerror = audio.oncanplaythrough = null;
    audio.removeAttribute("src");
    audio.load();
  }

  // Swaps a loaded (or loading) piece in as the playing element; the one
  // that just finished takes its place in the pool. Not while the page is in
  // the background, where iOS may refuse to start a different element: the
  // playing element simply loads the next piece then, as it always did.
  function takeClip(text) {
    if (document.hidden || listen.clipsBlocked) return false;
    const clip = listen.clips.find((c) => c.text === text && (c.state === "loading" || c.state === "ready"));
    if (!clip) return false;
    swapClip(clip);
    return true;
  }

  function swapClip(clip) {
    const audio = clip.audio;
    const text = clip.text;
    audio.oncanplaythrough = audio.onerror = null;
    listen.audio.pause();
    clip.audio = listen.audio;
    emptyClip(clip);
    listen.audio = audio;
    listen.audioText = text;
  }

  function onlineSpeechUrl(text) {
    return `${ONLINE_HOSTS[listen.host]}/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=${encodeURIComponent(readerFeatures.speech(text).text)}`;
  }

  // One piece through Google Dịch's voice. Plain audio, so it keeps playing
  // in the background, and its own clock drives the word marking.
  function speakOnline(item, token) {
    if (!listen.audio) prepareListenAudio();
    const prefetched = takeClip(item.text);
    const audio = listen.audio;
    // Paused partway, or the speed changed: carry on from there instead of
    // asking Google for the piece again.
    const resume = !prefetched && listen.audioText === item.text && audio.readyState >= 2 && !audio.ended && !audio.error;
    audio.onplaying = () => {
      if (token !== listen.token) return;
      listen.lastEventAt = Date.now();
      listen.errors = 0;
      listen.trusted = audio;
      followAudioWords(item, token, audio);
    };
    audio.onended = () => {
      if (token !== listen.token) return;
      stopWordEstimate();
      // Learn the voice's pace, for clips whose length is not known up front.
      const spoken = audio.currentTime - ONLINE_LEAD - ONLINE_TAIL;
      if (spoken > 1 && item.text.length > 20) {
        listen.onlinePace = listen.onlinePace * 0.5 + (spoken / speechTiming(item.text).units) * 0.5;
      }
      listen.i += 1;
      if (listen.playing) speakCurrent();
    };
    audio.onerror = () => {
      if (token === listen.token) onlineFailure();
    };

    listen.lastEventAt = Date.now();
    if (!prefetched && !resume) {
      audio.src = onlineSpeechUrl(item.text);
      listen.audioText = item.text;
    }
    audio.defaultPlaybackRate = listen.rate;
    audio.playbackRate = listen.rate;
    audio.play().catch((error) => {
      if (token !== listen.token || error.name === "AbortError") return;
      if (error.name === "NotAllowedError") {
        // iOS would not start a prefetched element: go back to the one that
        // has been playing and stop prefetching.
        const trusted = listen.clips.find((clip) => clip.audio === listen.trusted);
        if (prefetched && trusted) {
          listen.clipsBlocked = true;
          swapClip(trusted);
          speakCurrent();
          return;
        }
        // Autoplay refused (needs a tap): wait for the reader.
        setListenPlaying(false);
      } else {
        onlineFailure();
      }
    });
    prefetchAhead();
  }

  // Try the piece again after a growing pause, alternating between Google's
  // two addresses, then fall back to the device voice for the rest of the
  // session (or pause when there is none).
  function onlineFailure() {
    listen.errors += 1;
    pausePrefetch();
    listen.host = (listen.host + 1) % ONLINE_HOSTS.length;
    if (listen.errors <= ONLINE_RETRY_MS.length) {
      const token = ++listen.token;
      stopAllSpeech();
      listen.lastEventAt = Date.now();
      if (listen.errors > 1) showMessage("Google Dịch chưa trả lời, đang thử lại…");
      window.setTimeout(() => {
        if (token === listen.token && listen.playing) speakCurrent();
      }, ONLINE_RETRY_MS[listen.errors - 1]);
      return;
    }

    listen.errors = 0;
    listen.onlineFailed = true;
    if (chooseListenEngine() === "device") {
      showMessage("Google Dịch đang tạm chặn, chuyển sang giọng có sẵn trên máy.");
      speakCurrent();
    } else {
      setListenPlaying(false);
      showMessage(navigator.onLine === false
        ? "Mất kết nối mạng. Kết nối lại rồi bấm phát."
        : "Google Dịch đang tạm chặn vì nhận nhiều yêu cầu từ mạng của bạn. Thử lại sau một lúc, hoặc cài giọng tiếng Việt cho máy (xem Cài đặt đọc).");
    }
  }

  // Google's clips open with about 0.1 s of silence and end with close to a
  // second of it, and the voice rests at commas and full stops. Spreading
  // the words evenly over the whole clip left the mark two or three words
  // behind the voice, catching up only in the silence at the end; so time
  // them over the spoken part, with the rests counted in.
  function followAudioWords(item, token, audio) {
    stopWordEstimate();
    if (!canHighlightSpeech || item.start == null) return;

    const timing = speechTiming(item.text);
    if (!timing.words.length) return;
    listen.wordTimer = window.setInterval(() => {
      if (token !== listen.token) {
        stopWordEstimate();
        return;
      }
      // The clip streams in; until its length is known, go by the pace so far.
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : ONLINE_LEAD + ONLINE_TAIL + timing.units * listen.onlinePace;
      const spoken = Math.max(duration - ONLINE_LEAD - ONLINE_TAIL, 0.1);
      const progress = Math.min(Math.max((audio.currentTime - ONLINE_LEAD) / spoken, 0), 1);
      markTimedWord(timing, progress * timing.units);
    }, 90);
  }

  function stopAllSpeech() {
    if (speech && (speech.speaking || speech.pending)) speech.cancel();
    if (listen.audio && !listen.audio.paused) listen.audio.pause();
    stopWordEstimate();
  }

  function setListenPlaying(playing) {
    if (!listen.active) return;
    listen.playing = playing;
    if (playing) {
      listen.errors = 0;
      listen.onlineFailed = false;
      speakCurrent();
    } else {
      listen.token += 1;
      stopAllSpeech();
      if (canHighlightSpeech) CSS.highlights.delete("tts-word");
      renderListenBar();
    }
    syncWakeLock();
  }

  // The chapter has been read out: mark it finished and carry on with the
  // next chapter that has text (picture pages are skipped).
  function finishListenChapter() {
    const key = chapterKey(listen.volIdx, listen.chapIdx);
    chapterState[key] = { ...chapterState[key], done: true, pct: 100 };
    saveChapterState();

    readerFeatures?.completeChapter(listen.volIdx, listen.chapIdx);
    readingJournal?.observe(SERIES_META, listen.volIdx, chapterState, { volIdx: listen.volIdx, chapIdx: listen.chapIdx });

    if (listen.sleep === "chapter") {
      setListenSleep(0);
      setListenPlaying(false);
      showMessage("Đã dừng ở cuối chương theo hẹn giờ.");
      return;
    }

    const next = nextListenChapter();
    if (!next) {
      closeListening();
      showMessage("Đã nghe hết các chương hiện có.");
      return;
    }

    const token = ++listen.token;
    loadVolumeText(next.volIdx)
      .then(() => {
        if (token !== listen.token || !listen.active) return;
        setListenChapter(next.volIdx, next.chapIdx, null);
        if (currentView === "reader") followListenChapter();
        else saveReadingProgress(next.volIdx, next.chapIdx);
        if (listen.playing) speakCurrent();
      })
      .catch(() => {
        if (token !== listen.token) return;
        setListenPlaying(false);
        showMessage("Không tải được chương sau. Kiểm tra kết nối mạng rồi thử lại.");
      });
  }

  // In the reader, bring the chapter being read out onto the page, unless
  // the reader is busy looking elsewhere.
  function followListenChapter() {
    if (Date.now() - listen.followPausedAt < FOLLOW_PAUSE_MS) return;
    if (sectionFor(listen.volIdx, listen.chapIdx)) return;
    openChapter(listen.volIdx, listen.chapIdx, { replace: true, fromTop: true });
  }

  // Previous: back to the start of this paragraph, or the one before if
  // already there. Next: on to the following paragraph (or chapter).
  function stepListening(direction) {
    if (!listen.active) return;
    const current = listen.queue[listen.i];
    listen.followPausedAt = 0;

    if (direction > 0) {
      const index = current ? listen.queue.findIndex((item) => item.p > current.p) : -1;
      if (index < 0) {
        listen.i = listen.queue.length;
        if (listen.playing) speakCurrent();
        else finishListenChapter();
        return;
      }
      listen.i = index;
    } else {
      const p = current ? current.p : listen.queue[listen.queue.length - 1].p;
      const start = listen.queue.findIndex((item) => item.p === p);
      if (listen.i > start) {
        listen.i = start;
      } else {
        const before = listen.queue[Math.max(0, start - 1)].p;
        listen.i = listen.queue.findIndex((item) => item.p === before);
      }
    }

    if (listen.playing) speakCurrent();
    else {
      showListeningParagraph(true);
      renderListenBar();
    }
  }

  function cycleListenRate() {
    listen.rate = LISTEN_RATES[(LISTEN_RATES.indexOf(listen.rate) + 1) % LISTEN_RATES.length];
    localStorage.setItem("tenshi-listen-rate", String(listen.rate));
    if (listen.playing) speakCurrent();
    else renderListenBar();
  }

  function cycleListenSleep() {
    setListenSleep(LISTEN_SLEEP[(LISTEN_SLEEP.indexOf(listen.sleep) + 1) % LISTEN_SLEEP.length]);
  }

  function setListenSleep(value, until) {
    listen.sleep = value;
    clearTimeout(listen.sleepTimer);
    clearInterval(listen.sleepTicker);
    listen.sleepUntil = 0;

    if (typeof value === "number" && value > 0) {
      listen.sleepUntil = until || Date.now() + value * 60000;
      listen.sleepTimer = window.setTimeout(() => {
        setListenSleep(0);
        setListenPlaying(false);
        showMessage("Đã tạm dừng theo hẹn giờ.");
      }, Math.max(0, listen.sleepUntil - Date.now()));
      listen.sleepTicker = window.setInterval(renderListenBar, 20000);
    }
    renderListenBar();
  }

  function closeListening() {
    listen.active = false;
    listen.playing = false;
    listen.token += 1;
    stopAllSpeech();
    listen.clips.forEach(resetClip);
    setListenSleep(0);
    listenBar.hidden = true;
    document.body.classList.remove("is-listening");
    showListeningParagraph(false);
    if ("mediaSession" in navigator) {
      listen.mediaKey = null;
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
    syncWakeLock();
  }

  // Back from another tab or app: some browsers stopped speaking meanwhile.
  function nudgeListening() {
    if (listen.playing && listen.engine === "device" && speech && !speech.speaking && !speech.pending) speakCurrent();
    if (listen.playing && listen.engine === "online") prefetchAhead();
  }

  // Marks the paragraph being read; with `follow`, also scrolls it into view
  // unless the reader recently moved the page themselves.
  function showListeningParagraph(follow) {
    document.querySelectorAll(".is-speaking").forEach((el) => el.classList.remove("is-speaking"));
    if (canHighlightSpeech) {
      CSS.highlights.delete("tts-sentence");
      CSS.highlights.delete("tts-word");
    }
    listen.speakingEl = null;
    if (!listen.active) return;

    const item = listen.queue[listen.i];
    const section = item && sectionFor(listen.volIdx, listen.chapIdx);
    if (!section) return;

    const el = item.p < 0
      ? section.querySelector(".reader-stage-title")
      : section.querySelector(`.reader-content [data-p="${item.p}"]`);
    if (!el) return;

    el.classList.add("is-speaking");
    listen.speakingEl = el;
    const sentence = item.start == null ? null : textRange(el, item.start, item.end);
    if (sentence && canHighlightSpeech) CSS.highlights.set("tts-sentence", new Highlight(sentence));

    if (follow && currentView === "reader" && Date.now() - listen.followPausedAt > FOLLOW_PAUSE_MS) {
      // Follow the sentence, so long paragraphs scroll along as they are read.
      keepInView((sentence || el).getBoundingClientRect());
    }
  }

  // A DOM Range over [start, end) of an element's text, across the text
  // nodes a search mark may have split it into.
  function textRange(el, start, end) {
    if (!el.isConnected) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let pos = 0;
    let started = false;
    let node;
    while ((node = walker.nextNode())) {
      const length = node.data.length;
      if (!started && start <= pos + length) {
        range.setStart(node, start - pos);
        started = true;
      }
      if (started && end <= pos + length) {
        range.setEnd(node, end - pos);
        return range;
      }
      pos += length;
    }
    return null;
  }

  // Where each word falls in a spoken piece, in units of one character,
  // plus a rest after a comma or a full stop (on Google's voice about 0.4 s
  // and 0.5 to 0.9 s: some 6 and 10 characters' worth).
  function speechTiming(text) {
    const words = [];
    let units = 0;
    for (const match of text.matchAll(/\S+/g)) {
      units += match[0].length + 1;
      if (/[.!?…]["”’»)]*$/.test(match[0])) units += 10;
      else if (/[,;:]["”’»)]*$/.test(match[0])) units += 6;
      words.push({ index: match.index, length: match[0].length, end: units });
    }
    return { words, units };
  }

  // A word stays marked through the rest that follows it.
  function markTimedWord(timing, at) {
    const word = timing.words.find((w) => w.end > at) || timing.words[timing.words.length - 1];
    markSpokenWord(word.index, word.length);
  }

  function markSpokenWord(charIndex, charLength) {
    const item = listen.queue[listen.i];
    const el = listen.speakingEl;
    if (!canHighlightSpeech || !item || item.start == null || !el || charIndex == null) return;

    let length = charLength;
    if (!length) {
      const word = /^\S+/.exec(item.text.slice(charIndex));
      length = word ? word[0].length : 1;
    }
    const from = item.start + charIndex;
    const range = textRange(el, from, Math.min(from + length, item.end));
    if (range) CSS.highlights.set("tts-word", new Highlight(range));
  }

  // For voices that never report word boundaries (Android's Google voices,
  // mostly): step through the words at the pace this voice has shown so far.
  function estimateWords(item, token, startedAt) {
    stopWordEstimate();
    if (!canHighlightSpeech || listen.realBoundaries || item.start == null) return;

    const timing = speechTiming(item.text);
    if (!timing.words.length) return;
    const msPerUnit = listen.msPerUnit / listen.rate;
    listen.wordTimer = window.setInterval(() => {
      if (token !== listen.token || listen.realBoundaries) {
        stopWordEstimate();
        return;
      }
      markTimedWord(timing, (Date.now() - startedAt) / msPerUnit);
    }, 90);
  }

  function stopWordEstimate() {
    clearInterval(listen.wordTimer);
    listen.wordTimer = null;
  }

  function keepInView(rect) {
    const top = readingLine();
    const bottom = listenBar.hidden ? window.innerHeight : listenBar.getBoundingClientRect().top;
    // Fine while its first line sits in the upper part of the free space.
    if (rect.top >= top && rect.top <= top + (bottom - top) * 0.6) return;

    chromeLockedUntil = Date.now() + 800;
    window.scrollBy({ top: rect.top - (top + (bottom - top) * 0.2), behavior: einkEnabled ? "auto" : "smooth" });
  }

  // The player's title: go to what is being read.
  function revealListening() {
    listen.followPausedAt = 0;
    const item = listen.queue[listen.i];
    const p = item ? Math.max(0, item.p) : 0;

    if (currentView === "reader" && sectionFor(listen.volIdx, listen.chapIdx)) {
      const el = item && item.p >= 0
        ? sectionFor(listen.volIdx, listen.chapIdx).querySelector(`.reader-content [data-p="${p}"]`)
        : sectionFor(listen.volIdx, listen.chapIdx).querySelector(".reader-stage-title");
      if (el) {
        chromeLockedUntil = Date.now() + 800;
        const rect = el.getBoundingClientRect();
        window.scrollBy({ top: rect.top - readingLine() - 24, behavior: einkEnabled ? "auto" : "smooth" });
      }
      return;
    }

    openChapter(listen.volIdx, listen.chapIdx, { hit: { p } });
  }

  function renderListenBar() {
    if (!listen.active) return;
    const volume = DATA[listen.volIdx];
    const label = getChapterLabel(volume, listen.chapIdx);

    listenState.textContent = `${listen.playing ? "Đang nghe" : "Tạm dừng"} · ${formatChapterPlace(volume, label)}`;
    listenTitle.textContent = label.title;
    listenToggle.classList.toggle("is-playing", listen.playing);
    listenToggle.setAttribute("aria-label", listen.playing ? "Tạm dừng" : "Nghe tiếp");
    listenRate.textContent = `${String(listen.rate).replace(".", ",")}×`;

    let sleepLabel = "Hẹn giờ";
    if (listen.sleep === "chapter") sleepLabel = "Hết chương";
    else if (listen.sleepUntil) sleepLabel = `${Math.max(1, Math.ceil((listen.sleepUntil - Date.now()) / 60000))} phút`;
    listenSleepLabel.textContent = sleepLabel;
    listenSleep.classList.toggle("is-on", Boolean(listen.sleep));

    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      const key = chapterKey(listen.volIdx, listen.chapIdx);
      if (listen.mediaKey !== key || !navigator.mediaSession.metadata) {
        listen.mediaKey = key;
        navigator.mediaSession.metadata = new MediaMetadata({
          title: label.title,
          artist: formatChapterPlace(volume, label),
          album: SERIES_META.titleVi,
          artwork: volume.cover
            ? [{ src: volume.cover, sizes: "520x736", type: "image/webp" }]
            : [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }]
        });
      }
      navigator.mediaSession.playbackState = listen.playing ? "playing" : "paused";
    }
  }

  function showToast() {
    clearTimeout(toastTimer);
    presentToast(readerToast);
    toastTimer = window.setTimeout(hideToast, 6000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    if (!readerToast.hidden) dismissToast(readerToast);
  }

  function openLightbox(img) {
    if (!img) return;

    lightboxImages = [...img.closest(".reader-content").querySelectorAll(".illustration-img")];
    lightboxIndex = Math.max(0, lightboxImages.indexOf(img));
    showLightboxImage();

    lightbox.hidden = false;
    document.body.classList.add("is-lightbox-open");

    // A history entry lets the phone's back gesture close the viewer
    // instead of leaving the site.
    history.pushState({ lightbox: true }, "");
    lightboxPushed = true;
    lightboxClose.focus();
  }

  function showLightboxImage() {
    const source = lightboxImages[lightboxIndex];
    const total = lightboxImages.length;

    lightboxImg.src = source.currentSrc || source.src;
    lightboxImg.alt = source.alt;
    lightboxCount.textContent = `${lightboxIndex + 1} / ${total}`;
    lightbox.classList.toggle("is-single", total < 2);
    lightboxPrev.disabled = lightboxIndex === 0;
    lightboxNext.disabled = lightboxIndex === total - 1;

    const upcoming = lightboxImages[lightboxIndex + 1];
    if (upcoming) new Image().src = upcoming.currentSrc || upcoming.src;
  }

  function stepLightbox(direction) {
    const next = lightboxIndex + direction;
    if (next < 0 || next >= lightboxImages.length) return;
    lightboxIndex = next;
    showLightboxImage();
  }

  function closeLightbox() {
    if (lightboxPushed) {
      lightboxPushed = false;
      history.back();
      return;
    }
    hideLightbox();
  }

  function hideLightbox() {
    const opener = lightboxImages[lightboxIndex]?.closest(".illustration-open");

    lightbox.hidden = true;
    lightboxImg.removeAttribute("src");
    document.body.classList.remove("is-lightbox-open");
    if (opener) opener.focus({ preventScroll: true });
  }

  function setupSettingsUI() {
    const nav = document.createElement("div");
    nav.className = "settings-categories";
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "Nhóm cài đặt");
    const content = document.createElement("div"); content.className = "settings-body";
    const groups = [["text", "Chữ"], ["appearance", "Hiển thị"], ["reading", "Khi đọc"], ["controls", "Điều khiển"], ["listen", "Nghe"], ["data", "Dữ liệu"]];
    const panels = new Map();
    groups.forEach(([key, title]) => {
      const button = document.createElement("button"); button.type = "button"; button.id = `settings-tab-${key}`; button.dataset.settingsCategory = key;
      button.textContent = title; button.setAttribute("role", "tab"); button.setAttribute("aria-controls", `settings-category-${key}`);
      nav.append(button);
      const panel = document.createElement("div"); panel.id = `settings-category-${key}`; panel.className = "settings-category";
      panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", button.id); panels.set(key, panel); content.append(panel);
      button.onclick = () => selectSettingsCategory(key);
    });
    // Keep moved controls connected so their existing ID-based handlers work.
    settingsPanel.querySelector(".settings-head").after(nav, content);
    settingsPanel.querySelectorAll(":scope > .settings-section").forEach((section) => panels.get(section.dataset.settingsSection || "data").append(section));
    const controls = document.createElement("section"); controls.className = "settings-section";
    controls.innerHTML = '<h4 class="settings-section-title">Điều khiển</h4>';
    const motion = $("#motion-settings");
    if (motion) {
      const disclosure = document.createElement("details"); disclosure.className = "settings-disclosure";
      disclosure.innerHTML = '<summary><span>Cảm biến chuyển động<small>Nghiêng, lắc và úp máy</small></span></summary><div class="settings-disclosure-body"></div>';
      disclosure.querySelector(".settings-disclosure-body").append(motion); controls.append(disclosure);
    }
    controls.append($("#hand-camera-entry")); panels.get("controls").append(controls);
    const listening = document.createElement("section"); listening.className = "settings-section";
    listening.innerHTML = '<h4 class="settings-section-title">Nghe đọc</h4><p class="settings-hint">Chọn giọng tại đây. Tốc độ, hẹn giờ và vị trí nghe nằm trên thanh Nghe khi mở chương.</p>';
    listenVoiceGroup.hidden = false; listening.append(listenVoiceGroup); panels.get("listen").append(listening);
    readerSurfaces.attach(settingsPanel);
    settingsPanel.querySelector(".reader-sheet-handle").setAttribute("aria-label", "Mở rộng hoặc thu gọn cài đặt");
    nav.addEventListener("keydown", (event) => {
      const buttons = [...nav.querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      if (event.key === "ArrowLeft") next = (index + buttons.length - 1) % buttons.length;
      if (event.key === "ArrowDown") next = (index + 3) % buttons.length;
      if (event.key === "ArrowUp") next = (index + buttons.length - 3) % buttons.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = buttons.length - 1;
      if (next === undefined) return;
      event.preventDefault(); selectSettingsCategory(buttons[next].dataset.settingsCategory); buttons[next].focus();
    });
    settingsPanel.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const targets = [...settingsPanel.querySelectorAll("button, input, select, textarea, a[href], summary, [tabindex]")]
        .filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
      const first = targets[0], last = targets[targets.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    selectSettingsCategory("text");
  }

  function selectSettingsCategory(key) {
    const selected = settingsPanel.querySelector(`[data-settings-category="${key}"]`); if (!selected) return;
    settingsPanel.querySelectorAll("[data-settings-category]").forEach((button) => {
      const active = button === selected; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
    });
    settingsPanel.querySelectorAll(".settings-category").forEach((panel) => { panel.hidden = panel.id !== selected.getAttribute("aria-controls"); });
    settingsPanel.querySelector(".settings-body").scrollTop = 0;
  }

  function openSettings(category) {
    if (settingsPanel.open) return;
    if (speech) renderVoiceOptions();
    settingsOpener = document.activeElement;
    readerSurfaces?.lockExternal();
    setChromeHidden(false);
    settingsPanel.classList.add("is-open");
    settingsPanel.inert = false;
    settingsPanel.setAttribute("aria-hidden", "false");
    if (typeof category === "string") selectSettingsCategory(category);
    settingsPanel.showModal();
    btnSettingsClose.focus({ preventScroll: true });
  }

  function captureReaderPosition() {
    if (readerSurfaces?.isLocked()) return readerSurfaces.snapshot();
    if (currentView !== "reader") return null;
    const section = sectionFor(currentVolIdx, currentChapIdx); if (!section) return null;
    const anchor = pendingAnchor?.section === section ? { block: pendingAnchor.block, offset: pendingAnchor.offset, ...(Number.isInteger(pendingAnchor.textOffset) ? { textOffset: pendingAnchor.textOffset } : {}) } : getReadingAnchor(section);
    const content = section.querySelector(".reader-content"), rect = content.children[anchor.block]?.getBoundingClientRect();
    const first = content.firstElementChild?.getBoundingClientRect(), line = readingLine();
    return { slug: SERIES_META.slug, volIdx: currentVolIdx, chapIdx: currentChapIdx, anchor,
      chromeHidden: document.body.classList.contains("is-chrome-hidden"), width: window.innerWidth, scrollY: window.scrollY,
      geometry: rect ? { top: rect.top + window.scrollY, height: rect.height, sectionHeight: section.offsetHeight } : null,
      ...(first && first.top > line ? { headOffset: line - section.getBoundingClientRect().top } : {}) };
  }
  function restoreReaderSnapshot(position) {
    if (!position || currentView !== "reader" || position.slug !== SERIES_META.slug || position.volIdx !== currentVolIdx || position.chapIdx !== currentChapIdx) return false;
    setChromeHidden(position.chromeHidden);
    const section = sectionFor(position.volIdx, position.chapIdx), rect = section?.querySelector(".reader-content").children[position.anchor.block]?.getBoundingClientRect();
    const sameLayout = rect && position.geometry && position.width === window.innerWidth
      && Math.abs(rect.top + window.scrollY - position.geometry.top) < 1 && Math.abs(rect.height - position.geometry.height) < 1
      && section.offsetHeight === position.geometry.sectionHeight;
    // A text caret rounds to a line. Keep exact scrolling when there was no
    // reflow, and keep the chapter heading visible when it was above the text.
    if (section && (Number.isFinite(position.headOffset) || (sameLayout && Number.isFinite(position.scrollY)))) {
      pendingAnchor = null; clearTimeout(pendingAnchorTimer);
      const top = Number.isFinite(position.headOffset) ? section.getBoundingClientRect().top + window.scrollY + position.headOffset - readingLine() : position.scrollY;
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" }); lastChromeScrollY = window.scrollY;
      updateScrollProgress(); rememberReaderPosition(); return true;
    }
    const restored = holdAnchor(section, position.anchor);
    rememberReaderPosition(); return restored;
  }
  async function returnToReadingPosition() {
    const position = returnReaderPosition; if (!position) return;
    const seriesIdx = SERIES.findIndex((series) => series.slug === position.slug);
    if (seriesIdx < 0) { showMessage("Sách gốc không còn trên kệ."); return; }
    try { await ensureSeriesIndex(SERIES[seriesIdx]); } catch (_) { showMessage("Không tải được mục lục truyện."); return; }
    returnReaderPosition = null;
    activateSeries(seriesIdx);
    openChapter(position.volIdx, position.chapIdx, { anchor: position.anchor });
  }
  function preserveReaderPosition(action) {
    const position = captureReaderPosition(); action(); if (position) restoreReaderSnapshot(position);
  }
  function rememberReaderPosition() {
    if (readerSurfaces?.isLocked() || document.querySelector("dialog[open]") || settingsPanel.classList.contains("is-open")) return;
    const position = captureReaderPosition(); if (position) { stableReaderPosition = position; lastReaderPosition = position; }
  }
  function setupReaderViewport() {
    let width = window.innerWidth, timer;
    const resize = () => {
      if (Math.abs(window.innerWidth - width) < 2) return;
      const position = stableReaderPosition; width = window.innerWidth;
      clearTimeout(timer); timer = setTimeout(() => { if (!readerSurfaces.isLocked() && position) restoreReaderSnapshot(position); }, 120);
    };
    window.addEventListener("resize", resize);
    const statusFooter = $("#reader-status-footer"), quickMenu = $("#reader-quick-menu");
    const observer = new ResizeObserver(() => {
      const style = document.documentElement.style;
      style.setProperty("--reader-dock-height", `${readerBottomNav.offsetHeight}px`);
      style.setProperty("--reader-status-height", `${statusFooter?.offsetHeight || 0}px`);
      style.setProperty("--reader-quick-height", `${quickMenu?.offsetHeight || 0}px`);
    });
    observer.observe(readerBottomNav);
    if (statusFooter) observer.observe(statusFooter);
    if (quickMenu) observer.observe(quickMenu);
  }
  function syncQuickSettings() {
    $("#reader-aa-size").value = fontSize; $("#reader-aa-size-value").textContent = `${fontSize}px`;
    const lines = $("#reader-aa-line"); lines.querySelector('[data-custom-line]')?.remove();
    if (![...lines.options].some((o) => Number(o.value) === lineHeight)) { const option = new Option(String(lineHeight), String(lineHeight)); option.dataset.customLine = "true"; lines.add(option); }
    lines.value = String(lineHeight); $("#reader-aa-font").value = fontFamily; $("#reader-aa-align").value = textAlign; $("#reader-aa-page").value = pageModeEnabled ? "on" : "off";
    const margin = libraryTools.getLayout().margin; $("#reader-aa-margin").value = margin; $("#reader-aa-margin-value").textContent = `${margin}px`;
    document.querySelectorAll("[data-aa-theme]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.aaTheme === theme)));
  }
  function openQuickSettings() { syncQuickSettings(); readerSurfaces.open($("#reader-aa-dialog")); }
  function setupQuickSettings() {
    const dialog = $("#reader-aa-dialog"); readerSurfaces.attach(dialog);
    $("#reader-aa-close").onclick = () => readerSurfaces.close(dialog);
    $("#reader-aa-size").oninput = (ev) => { changeFontSize((Number(ev.target.value) - fontSize) / 2); syncQuickSettings(); };
    $("#reader-aa-line").onchange = (ev) => { setLineHeight(Number(ev.target.value)); syncQuickSettings(); };
    $("#reader-aa-font").onchange = (ev) => { setFontFamily(ev.target.value); syncQuickSettings(); };
    $("#reader-aa-align").onchange = (ev) => { setTextAlign(ev.target.value); syncQuickSettings(); };
    $("#reader-aa-page").onchange = (ev) => { setPageMode(ev.target.value); syncQuickSettings(); };
    $("#reader-aa-margin").oninput = (ev) => { libraryTools.setLayout({ ...libraryTools.getLayout(), margin: Number(ev.target.value) }); syncQuickSettings(); };
    document.querySelectorAll("[data-aa-theme]").forEach((b) => b.onclick = () => { setTheme(b.dataset.aaTheme); syncQuickSettings(); });
    $("#reader-aa-all").onclick = () => { dialog.close(); openSettings(); };
    dialog.addEventListener("close", () => { if (!settingsPanel.classList.contains("is-open")) btnBottomSettings.focus({ preventScroll: true }); });
  }

  function closeSettings() {
    const wasOpen = settingsPanel.open || settingsPanel.classList.contains("is-open");
    settingsPanel.classList.remove("is-open");
    settingsPanel.inert = true;
    settingsOverlay.classList.remove("is-open");
    settingsPanel.setAttribute("aria-hidden", "true");
    if (settingsPanel.open) settingsPanel.close();
    if (wasOpen) readerSurfaces?.unlockExternal();
    if (wasOpen && !document.querySelector("dialog[open]")) {
      const opener = settingsOpener?.isConnected && settingsOpener.getClientRects().length ? settingsOpener : btnSettings;
      opener.focus({ preventScroll: true }); settingsOpener = null;
    }
  }

  function saveReadingProgress(volIdx, chapIdx) {
    readingProgress = {
      volIdx,
      chapIdx,
      timestamp: Date.now()
    };

    localStorage.setItem(seriesStorageKey("progress"), JSON.stringify(readingProgress));
    libraryTools?.resumeReading(SERIES_META);
    readingJournal?.observe(SERIES_META, volIdx, chapterState);
    recordReadingHistory(volIdx, chapIdx);
    window.dispatchEvent(new Event("ketruyen-library-change"));
    updateContinueUI();
    renderChapterList();
    renderVolumeGrid();
    renderRecentChapters();
  }

  function loadReadingProgress() {
    const raw = localStorage.getItem(seriesStorageKey("progress"));

    if (!raw) {
      updateContinueUI();
      return;
    }

    try {
      const saved = JSON.parse(raw);
      const volume = DATA[saved.volIdx];

      if (volume && volume.chapters[saved.chapIdx]) {
        readingProgress = saved;
      }
    } catch (error) {
      console.warn("Could not parse saved progress", error);
    }

    updateContinueUI();
  }

  function updateContinueUI() {
    const volume = readingProgress && DATA[readingProgress.volIdx];
    const chapter = volume && volume.chapters[readingProgress.chapIdx];
    const isReturning = Boolean(chapter);

    seriesHero.classList.toggle("is-returning", isReturning);
    continueCard.style.display = isReturning ? "" : "none";
    btnContinue.style.display = isReturning ? "" : "none";
    btnStartReading.className = isReturning ? "btn-secondary" : "btn-primary";

    if (!isReturning) {
      continueInfo.textContent = "";
      return;
    }

    const label = getChapterLabel(volume, readingProgress.chapIdx);
    // Progress through the whole series, in story chapters.
    let done = 0, total = 0;
    DATA.forEach((item, volIdx) => item.chapters.forEach((entry, chapIdx) => {
      if (entry.isIllustration) return;
      total += 1;
      if (isChapterRead(volIdx, chapIdx)) done += 1;
    }));
    const share = total ? Math.round((done / total) * 100) : 0;
    continueInfo.innerHTML = `
      <span class="continue-kicker">Đang đọc dở</span>
      <span class="continue-title">${escapeHtml(label.title)}</span>
      <span class="continue-volume">${metaLine([volume.name, label.kicker])}</span>
      ${total ? `
        <span class="continue-progress">
          <span class="continue-track" role="progressbar" aria-label="Tiến độ cả bộ" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}"><span style="width:${Math.max(share, done ? 2 : 0)}%"></span></span>
          <span class="continue-percent">${done}/${total} chương</span>
        </span>` : ""}
    `;
  }

  function continueReading() {
    if (!readingProgress) return;
    openChapter(readingProgress.volIdx, readingProgress.chapIdx);
  }

  // Page changes and the e-ink flash: see page-turn.js.
  function runEinkPageTurn(applyChange, options) {
    pageTurn.run(applyChange, options);
  }

  function cancelEinkPageTurn() {
    pageTurn.cancel();
  }

  function triggerEinkRefresh(duration) {
    pageTurn.refresh(duration);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  loadData();
})();
