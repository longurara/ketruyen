(function (root) {
  "use strict";
  const KEY = "tenshi-ui-size-v1";
  let preserve = (change) => change();
  const valid = (v) => v === "large" ? "large" : "standard";
  let size = "standard"; try { size = valid(localStorage.getItem(KEY)); } catch (_) {}
  const section = document.createElement("section"); section.className = "settings-section";
  section.dataset.settingsSection = "appearance";
  section.innerHTML = '<h4 class="settings-section-title">Cỡ chữ giao diện</h4><p class="settings-hint">Áp dụng cho menu và nút bấm. Cỡ chữ truyện được chỉnh riêng.</p><div class="segmented" id="ui-size-switch" role="group" aria-label="Cỡ chữ giao diện"><button type="button" data-ui-size="standard">Tiêu chuẩn</button><button type="button" data-ui-size="large">Lớn</button></div><p id="ui-size-feedback" role="status" hidden></p>';
  document.getElementById("settings-progress-section").before(section);
  function apply(next) {
    size = valid(next); document.body.dataset.uiSize = size;
    section.querySelectorAll("[data-ui-size]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.uiSize === size)));
  }
  section.querySelectorAll("[data-ui-size]").forEach((button) => button.onclick = () => {
    const feedback = document.getElementById("ui-size-feedback");
    try { localStorage.setItem(KEY, button.dataset.uiSize); preserve(() => apply(button.dataset.uiSize)); feedback.hidden = true; }
    catch (_) { feedback.hidden = false; feedback.textContent = "Chưa lưu được lựa chọn. Kiểm tra dung lượng lưu trữ của trình duyệt."; }
  });
  addEventListener("storage", (event) => { if (event.key === KEY) preserve(() => apply(event.newValue)); });
  apply(size);
  root.UIAppearance = { setPreserver(fn) { preserve = fn; } };
})(globalThis);
