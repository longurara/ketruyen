(function () {
  "use strict";
  const rangeSelector = ":is(.reader-aa-controls, .tools-panel, .workbench-panel, .hand-camera-settings, .settings-range) input[type='range']";
  const scopeSelector = ".reader-aa-controls, .tools-panel, .workbench-panel, .hand-camera-settings, .settings-range";

  function updateRange(input) {
    const min = input.min === "" ? 0 : Number(input.min);
    const max = input.max === "" ? 100 : Number(input.max);
    const value = Number(input.value);
    const fraction = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
    const fill = `${Math.round(fraction * 10000) / 100}%`;
    if (input.style.getPropertyValue("--control-fill") !== fill) input.style.setProperty("--control-fill", fill);
  }
  function updateWithin(element) {
    if (element.matches?.(rangeSelector)) updateRange(element);
    element.querySelectorAll?.(rangeSelector).forEach(updateRange);
  }
  function initialize() {
    updateWithin(document);
    function onInput(event) { if (event.target.matches?.(rangeSelector)) updateRange(event.target); }
    document.addEventListener("input", onInput);
    document.addEventListener("change", onInput);
    // Panels render on demand. Their output text and open/hidden changes also
    // refresh fills after app code assigns .value without dispatching input.
    const observer = new MutationObserver((records) => {
      const scopes = new Set();
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        const scope = target?.closest(scopeSelector);
        if (scope) scopes.add(scope);
        if (record.type === "attributes") updateWithin(target);
        else for (const node of record.addedNodes) if (node instanceof Element) updateWithin(node);
      }
      scopes.forEach(updateWithin);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["value", "min", "max", "open", "hidden"] });
  }
  // Tab rows (role="tablist"): arrow keys, Home and End move to a sibling tab
  // and select it, as in the WAI-ARIA tabs pattern. Lists with their own
  // handler call preventDefault first and are left alone.
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tab = event.target.closest?.('[role="tab"]');
    const list = tab?.closest('[role="tablist"]');
    if (!list) return;
    const tabs = [...list.querySelectorAll('[role="tab"]')].filter((item) => !item.disabled && item.getClientRects().length && item.closest('[role="tablist"]') === list);
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  });

  // Tab rows and segmented choices: one indicator slides to the chosen
  // button instead of each button switching its own background.
  const SLIDER_GROUPS = ".segmented, .toolbar-group";
  const isChosen = (button) => button.matches(".is-active, [aria-selected='true'], [aria-pressed='true']");
  const sliders = new Set();
  function placeSlider(group, animate) {
    const indicator = group.querySelector(":scope > .slide-indicator");
    const chosen = [...group.children].find((child) => child.tagName === "BUTTON" && isChosen(child));
    if (!indicator) return;
    if (!chosen || !chosen.offsetWidth) { indicator.style.opacity = "0"; return; }
    const moveFrom = indicator.style.opacity === "0";
    indicator.classList.toggle("is-instant", !animate || moveFrom);
    indicator.style.opacity = "1";
    indicator.style.width = `${chosen.offsetWidth}px`;
    indicator.style.height = `${chosen.offsetHeight}px`;
    indicator.style.transform = `translate(${chosen.offsetLeft}px, ${chosen.offsetTop}px)`;
    indicator.style.borderRadius = getComputedStyle(chosen).borderRadius;
    if (!animate || moveFrom) requestAnimationFrame(() => indicator.classList.remove("is-instant"));
  }
  // A button can change size on its own (a count filled in, fonts loading),
  // so the buttons are watched as well as the row.
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
    new Set(entries.map((entry) => sliders.has(entry.target) ? entry.target : entry.target.parentElement)).forEach((group) => placeSlider(group, false));
  }) : null;
  function attachSlider(group) {
    if (sliders.has(group)) return;
    sliders.add(group);
    const indicator = document.createElement("span");
    indicator.className = "slide-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.style.opacity = "0";
    group.prepend(indicator);
    group.classList.add("has-slider");
    resized?.observe(group);
    [...group.children].forEach((child) => { if (child.tagName === "BUTTON") resized?.observe(child); });
    placeSlider(group, false);
  }
  function initializeSliders() {
    document.querySelectorAll(SLIDER_GROUPS).forEach(attachSlider);
    new MutationObserver((records) => {
      const moved = new Set();
      for (const record of records) {
        if (record.type === "childList") {
          record.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (node.matches(SLIDER_GROUPS)) attachSlider(node);
            node.querySelectorAll?.(SLIDER_GROUPS).forEach(attachSlider);
          });
        }
        if (record.target.classList?.contains("slide-indicator")) continue;
        // Any change inside a row (choice, label, count) can move or resize the choice.
        const group = record.target instanceof Element ? record.target.closest(SLIDER_GROUPS) : null;
        if (group && sliders.has(group)) moved.add(group);
      }
      moved.forEach((group) => placeSlider(group, true));
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-selected", "aria-pressed", "hidden"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeSliders, { once: true });
  else initializeSliders();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
