// Reading comfort: warm light and dimming, letter and word spacing, a
// reading ruler, and auto-scroll (or, in page mode, automatic page turns).
// Preferences are kept per browser under one key.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReadingComfort = api;
})(globalThis, function () {
  "use strict";
  const KEY = "tenshi-comfort-v1";
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const DEFAULTS = { warmth: 0, brightness: 100, letter: 0, word: 0, ruler: false, speed: 24 };

  // Stored values are checked and clamped; anything unknown falls back.
  function preferences(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      warmth: clamp(source.warmth, 0, 100, DEFAULTS.warmth),
      brightness: clamp(source.brightness, 40, 100, DEFAULTS.brightness),
      letter: clamp(source.letter, 0, 10, DEFAULTS.letter),
      word: clamp(source.word, 0, 40, DEFAULTS.word),
      ruler: source.ruler === true,
      speed: clamp(source.speed, 6, 80, DEFAULTS.speed)
    };
  }

  // Auto-scroll speed is set in lines a minute so it means the same at any
  // font size; the scroller works in pixels a second.
  function pixelsPerSecond(linesPerMinute, linePixels) {
    return (linesPerMinute * linePixels) / 60;
  }

  // In page mode the same speed turns a page once its lines would have
  // scrolled past: never faster than every 4 seconds.
  function pageDelay(linesPerMinute, linesPerPage) {
    return Math.max(4000, Math.round((linesPerPage / linesPerMinute) * 60000));
  }

  function create(options) {
    const $ = (selector) => document.querySelector(selector);
    let stored; try { stored = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
    let prefs = preferences(stored);
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {} };

    // ---- Warm light and dimming: tinted layers over the whole page. ----
    document.body.insertAdjacentHTML("beforeend", '<div id="comfort-warm" class="comfort-layer comfort-warm" aria-hidden="true"></div><div id="comfort-dim" class="comfort-layer comfort-dim" aria-hidden="true"></div><div id="reading-ruler" class="reading-ruler" aria-hidden="true" hidden></div>');
    const warmLayer = $("#comfort-warm"), dimLayer = $("#comfort-dim"), ruler = $("#reading-ruler");

    function apply() {
      warmLayer.style.opacity = String((prefs.warmth / 100) * 0.42);
      dimLayer.style.opacity = String(((100 - prefs.brightness) / 100) * 0.9);
      const style = document.documentElement.style;
      style.setProperty("--reader-letter-spacing", `${prefs.letter / 100}em`);
      style.setProperty("--reader-word-spacing", `${prefs.word / 100}em`);
      document.body.classList.toggle("has-reading-ruler", prefs.ruler);
      placeRuler();
      sync();
    }

    // Controls in the settings panel and the quick "Chữ" sheet share values.
    function sync() {
      document.querySelectorAll("[data-comfort]").forEach((input) => {
        const key = input.dataset.comfort;
        if (input.type === "checkbox") input.checked = Boolean(prefs[key]);
        else if (String(input.value) !== String(prefs[key])) input.value = prefs[key];
        const output = input.closest("label")?.querySelector("output");
        if (output) output.textContent = describe(key, prefs[key]);
      });
    }

    function describe(key, value) {
      if (key === "warmth") return value ? `${value}%` : "Tắt";
      if (key === "brightness") return `${value}%`;
      if (key === "letter" || key === "word") return value ? `+${value}` : "Mặc định";
      if (key === "speed") return `${value} dòng/phút`;
      return "";
    }

    function set(key, value) {
      const before = { ...prefs };
      prefs = preferences({ ...prefs, [key]: value });
      persist();
      // Spacing reflows the text; keep the reader's place while it does.
      if ((key === "letter" || key === "word") && before[key] !== prefs[key]) options.preservePosition(apply);
      else apply();
      if (key === "speed" && auto.active) auto.restart();
    }

    document.addEventListener("input", (event) => {
      const key = event.target.dataset?.comfort;
      if (!key) return;
      set(key, event.target.type === "checkbox" ? event.target.checked : Number(event.target.value));
    });
    document.addEventListener("change", (event) => {
      const key = event.target.dataset?.comfort;
      if (key && event.target.type === "checkbox") set(key, event.target.checked);
    });

    // ---- Reading ruler: a clear band two lines tall, the rest dimmed. ----
    // With a mouse it follows the pointer; on touch screens it sits a third
    // of the way down, where the eye usually reads.
    let rulerY = null;
    function placeRuler() {
      const show = prefs.ruler && options.isReader();
      ruler.hidden = !show;
      if (!show) return;
      const line = options.linePixels();
      const height = Math.round(line * 2 + 8);
      const fallback = window.innerHeight * 0.36;
      const centre = rulerY ?? fallback;
      const top = Math.max(0, Math.min(window.innerHeight - height, centre - height / 2));
      ruler.style.height = `${height}px`;
      ruler.style.transform = `translateY(${Math.round(top)}px)`;
    }
    if (window.matchMedia("(hover: hover)").matches) {
      document.addEventListener("pointermove", (event) => {
        if (!prefs.ruler || event.pointerType !== "mouse") return;
        rulerY = event.clientY;
        placeRuler();
      }, { passive: true });
    }
    window.addEventListener("resize", placeRuler);

    // ---- Auto-scroll -----------------------------------------------------
    // Scrolls smoothly at the chosen speed; in page mode it turns a page at
    // the same pace instead. Any touch, wheel or key the reader makes pauses
    // it, so the page never moves under someone who is busy with it.
    document.body.insertAdjacentHTML("beforeend", `<div id="auto-scroll-bar" class="auto-scroll-bar" role="region" aria-label="Tự cuộn" hidden>
      <button type="button" class="auto-scroll-icon" data-auto="toggle" aria-label="Tạm dừng tự cuộn"><svg class="icon-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"></path></svg><svg class="icon-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg></button>
      <button type="button" class="auto-scroll-icon" data-auto="slower" aria-label="Chậm hơn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"></path></svg></button>
      <span class="auto-scroll-speed" id="auto-scroll-speed" aria-live="polite"></span>
      <button type="button" class="auto-scroll-icon" data-auto="faster" aria-label="Nhanh hơn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></button>
      <button type="button" class="auto-scroll-icon" data-auto="stop" aria-label="Tắt tự cuộn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>
    </div>`);
    const bar = $("#auto-scroll-bar");

    const auto = {
      active: false, playing: false, frame: null, timer: null, last: null, position: 0, expected: null,
      start() {
        if (!options.isReader()) { options.message("Mở một chương để tự cuộn."); return; }
        this.active = true;
        bar.hidden = false;
        document.body.classList.add("is-auto-scrolling");
        this.play();
        options.message(options.pageMode() ? "Tự lật trang đã bật. Chạm vào trang để tạm dừng." : "Tự cuộn đã bật. Chạm vào trang để tạm dừng.");
      },
      play() {
        if (!this.active) return;
        this.playing = true;
        this.halt();
        if (options.pageMode()) {
          const tick = () => {
            if (!this.playing) return;
            if (!options.canMove()) { this.timer = setTimeout(tick, 500); return; }
            if (!options.turnPage(1)) { this.end("Đã đến cuối truyện."); return; }
            this.timer = setTimeout(tick, pageDelay(prefs.speed, options.linesPerPage()));
          };
          this.timer = setTimeout(tick, pageDelay(prefs.speed, options.linesPerPage()));
        } else {
          this.last = null; this.expected = null;
          const step = (time) => {
            this.frame = null;
            if (!this.playing) return;
            if (options.canMove()) {
              const top = window.scrollY;
              // Someone scrolled by hand: let them, and pause.
              if (this.expected !== null && Math.abs(top - this.expected) > 3) { this.pause(); return; }
              if (this.last === null) this.position = top;
              else this.position += pixelsPerSecond(prefs.speed, options.linePixels()) * Math.min(time - this.last, 50) / 1000;
              const max = document.documentElement.scrollHeight - window.innerHeight;
              const next = Math.min(this.position, max);
              window.scrollTo({ top: next, behavior: "instant" });
              this.expected = window.scrollY;
              this.last = time;
              if (next >= max - 1 && !options.hasMore()) { this.end("Đã cuộn đến cuối chương."); return; }
            } else {
              this.last = null; this.expected = null;
            }
            this.frame = requestAnimationFrame(step);
          };
          this.frame = requestAnimationFrame(step);
        }
        render();
      },
      pause() {
        if (!this.playing) return;
        this.playing = false;
        this.halt();
        render();
      },
      restart() { if (this.playing) this.play(); else render(); },
      halt() {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        clearTimeout(this.timer);
        this.frame = null; this.timer = null;
      },
      end(message) {
        this.stop();
        if (message) options.message(message);
      },
      stop() {
        this.active = false;
        this.playing = false;
        this.halt();
        bar.hidden = true;
        document.body.classList.remove("is-auto-scrolling");
        render();
      }
    };

    function render() {
      bar.classList.toggle("is-paused", !auto.playing);
      bar.querySelector('[data-auto="toggle"]').setAttribute("aria-label", auto.playing ? "Tạm dừng tự cuộn" : "Tiếp tục tự cuộn");
      $("#auto-scroll-speed").textContent = describe("speed", prefs.speed);
      document.querySelectorAll("[data-auto-start]").forEach((button) => {
        button.textContent = auto.active ? "Tắt tự cuộn" : options.pageMode() ? "Bắt đầu tự lật trang" : "Bắt đầu tự cuộn";
        button.setAttribute("aria-pressed", String(auto.active));
      });
    }

    bar.addEventListener("click", (event) => {
      const action = event.target.closest("[data-auto]")?.dataset.auto;
      if (action === "toggle") { if (auto.playing) auto.pause(); else auto.play(); }
      if (action === "slower") set("speed", prefs.speed - (prefs.speed > 20 ? 4 : 2));
      if (action === "faster") set("speed", prefs.speed + (prefs.speed >= 20 ? 4 : 2));
      if (action === "stop") auto.stop();
    });
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-auto-start]")) { if (auto.active) auto.stop(); else { options.closePanels(); auto.start(); } }
    });
    // The reader's own touch, wheel or keys pause it; the bar resumes it.
    const pauseFromReader = (event) => {
      if (!auto.playing || event.target.closest?.("#auto-scroll-bar")) return;
      if (event.type === "keydown" && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", " ", "Home", "End"].includes(event.key)) return;
      auto.pause();
    };
    ["wheel", "touchstart", "keydown"].forEach((type) => document.addEventListener(type, pauseFromReader, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", () => { if (document.hidden) auto.pause(); });

    apply();
    render();
    return {
      preferences: () => ({ ...prefs }),
      reset(keys) { prefs = preferences({ ...prefs, ...Object.fromEntries(keys.map((key) => [key, DEFAULTS[key]])) }); persist(); options.preservePosition(apply); },
      onView() { if (!options.isReader() && auto.active) auto.stop(); placeRuler(); },
      onModeChange() { if (auto.active) auto.restart(); render(); placeRuler(); },
      toggleAuto() { if (auto.active) auto.stop(); else auto.start(); },
      isAuto: () => auto.active,
      placeRuler
    };
  }

  return { preferences, pixelsPerSecond, pageDelay, create, DEFAULTS };
});
