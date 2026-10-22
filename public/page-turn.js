// Page changes. With the e-ink effect on, the old page lingers as a fading
// "ghost" while the screen flashes, like an e-paper refresh. With it off,
// the browser cross-fades between pages (View Transitions), optionally
// carrying one element, such as a book cover, into its new place.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PageTurn = api;
})(globalThis, function () {
  "use strict";

  // options: ghostLayer, header, main (elements); einkEnabled() and ready()
  // say whether the effect is on and whether the app has finished loading.
  function create(options) {
    const { ghostLayer, header, main } = options;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let refreshTimer = null, ghostTimer = null, applyTimer = null, token = 0;

    function sanitize(node) {
      node.removeAttribute?.("id");
      node.querySelectorAll("[id]").forEach((child) => child.removeAttribute("id"));
      node.querySelectorAll("button, a, input, select, textarea").forEach((child) => {
        child.setAttribute("tabindex", "-1");
        child.setAttribute("aria-hidden", "true");
      });
    }

    function captureGhost() {
      if (!ghostLayer) return;
      const ghostHeader = header.cloneNode(true);
      const ghostMain = main.cloneNode(true);
      sanitize(ghostHeader);
      sanitize(ghostMain);
      ghostHeader.classList.add("ghost-header");
      ghostMain.classList.add("ghost-main");
      ghostMain.style.transform = `translateY(${-window.scrollY}px)`;
      ghostLayer.replaceChildren(ghostHeader, ghostMain);
      ghostLayer.classList.remove("is-active");
      void ghostLayer.offsetWidth;
      ghostLayer.classList.add("is-active");
    }

    function clearGhost() {
      if (!ghostLayer) return;
      ghostLayer.classList.remove("is-active");
      ghostLayer.replaceChildren();
    }

    // The screen flash on its own, for setting changes that keep the page.
    function refresh(duration) {
      if (!options.ready() || !options.einkEnabled()) return;
      clearTimeout(refreshTimer);
      document.body.classList.remove("is-eink-refreshing");
      void document.body.offsetWidth;
      document.body.classList.add("is-eink-refreshing");
      refreshTimer = window.setTimeout(() => document.body.classList.remove("is-eink-refreshing"), duration || 360);
    }

    function crossFade(applyChange, morph) {
      const name = "book-cover";
      if (morph?.from) morph.from.style.viewTransitionName = name;
      const transition = document.startViewTransition(async () => {
        if (morph?.from) morph.from.style.viewTransitionName = "";
        applyChange();
        const to = morph?.to?.();
        if (!to) return;
        to.style.viewTransitionName = name;
        // Snapshot the new cover once it has a picture, but never wait long.
        const img = to.querySelector("img");
        if (img?.decode) await Promise.race([img.decode().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 160))]);
      });
      transition.finished.finally(() => {
        const to = morph?.to?.();
        if (to) to.style.viewTransitionName = "";
      });
    }

    // turn: { lagMs, totalMs, morph: { from: element, to: () => element } }
    function run(applyChange, turn) {
      if (!options.ready() || !options.einkEnabled()) {
        if (options.ready() && typeof document.startViewTransition === "function" && !reducedMotion.matches && !document.hidden) {
          crossFade(applyChange, turn?.morph);
          return;
        }
        applyChange();
        return;
      }
      if (document.body.classList.contains("is-eink-busy")) return;

      const lagMs = turn?.lagMs ?? 80;
      const totalMs = turn?.totalMs ?? 440;
      const current = ++token;
      clearTimeout(applyTimer);
      clearTimeout(ghostTimer);
      captureGhost();
      document.body.classList.add("is-eink-busy");
      refresh(totalMs);
      applyTimer = window.setTimeout(() => {
        if (current === token) applyChange();
      }, lagMs);
      ghostTimer = window.setTimeout(() => {
        if (current !== token) return;
        clearGhost();
        document.body.classList.remove("is-eink-busy");
      }, totalMs);
    }

    function cancel() {
      token += 1;
      clearTimeout(applyTimer);
      clearTimeout(ghostTimer);
      clearGhost();
      document.body.classList.remove("is-eink-busy");
    }

    return { run, cancel, refresh };
  }

  return { create };
});
