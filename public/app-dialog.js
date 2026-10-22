// Confirmation dialog drawn in the app's own theme, in place of the
// browser's window.confirm(). AppDialog.confirm() resolves true only when
// the person presses the confirm button; Escape, the backdrop and
// "Hủy" all resolve false.
(function (root) {
  "use strict";
  let dialog = null;
  let settle = null;

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "app-confirm";
    dialog.setAttribute("aria-labelledby", "app-confirm-title");
    dialog.setAttribute("aria-describedby", "app-confirm-message");
    dialog.innerHTML = `<form method="dialog" class="app-confirm-body">
      <h2 id="app-confirm-title" class="app-confirm-title"></h2>
      <p id="app-confirm-message" class="app-confirm-message"></p>
      <div class="app-confirm-actions">
        <button type="submit" value="cancel" class="btn-secondary" data-cancel></button>
        <button type="submit" value="confirm" class="btn-primary" data-confirm></button>
      </div>
    </form>`;
    dialog.addEventListener("close", () => {
      const resolve = settle;
      settle = null;
      resolve?.(dialog.returnValue === "confirm");
    });
    // A press on the dimmed backdrop lands on the dialog element itself.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close("cancel");
    });
    document.body.append(dialog);
  }

  function confirm({ title, message = "", confirmLabel = "Đồng ý", cancelLabel = "Hủy", danger = false }) {
    if (!dialog) build();
    if (settle) dialog.close("cancel");
    dialog.querySelector(".app-confirm-title").textContent = title;
    const body = dialog.querySelector(".app-confirm-message");
    body.textContent = message;
    body.hidden = !message;
    const ok = dialog.querySelector("[data-confirm]");
    ok.textContent = confirmLabel;
    ok.classList.toggle("is-danger", danger);
    dialog.querySelector("[data-cancel]").textContent = cancelLabel;
    dialog.returnValue = "cancel";
    return new Promise((resolve) => {
      settle = resolve;
      dialog.showModal();
      // A destructive action starts on "Hủy" so Enter never deletes by accident.
      (danger ? dialog.querySelector("[data-cancel]") : ok).focus();
    });
  }

  // Keyboard shortcut list: rows of [keys, what they do].
  let shortcutDialog = null;
  function shortcuts(rows) {
    if (!shortcutDialog) {
      shortcutDialog = document.createElement("dialog");
      shortcutDialog.className = "app-confirm app-shortcuts";
      shortcutDialog.setAttribute("aria-labelledby", "app-shortcuts-title");
      shortcutDialog.innerHTML = `<form method="dialog" class="app-confirm-body">
        <h2 id="app-shortcuts-title" class="app-confirm-title">Phím tắt</h2>
        <dl class="app-shortcuts-list"></dl>
        <div class="app-confirm-actions"><button type="submit" class="btn-primary">Đã hiểu</button></div>
      </form>`;
      shortcutDialog.addEventListener("click", (event) => {
        if (event.target === shortcutDialog) shortcutDialog.close();
      });
      document.body.append(shortcutDialog);
    }
    const list = shortcutDialog.querySelector(".app-shortcuts-list");
    list.replaceChildren(...rows.flatMap(([keys, label]) => {
      const term = document.createElement("dt");
      keys.split(" ").forEach((key) => {
        const kbd = document.createElement("kbd");
        kbd.textContent = key;
        term.append(kbd);
      });
      const detail = document.createElement("dd");
      detail.textContent = label;
      return [term, detail];
    }));
    shortcutDialog.showModal();
    shortcutDialog.querySelector("button").focus();
  }

  root.AppDialog = { confirm, shortcuts };
})(globalThis);
