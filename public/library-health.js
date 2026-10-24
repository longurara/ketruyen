(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LibraryHealth = api;
})(globalThis, function (root) {
  "use strict";
  function describe(books, snapshot, now = Date.now()) {
    const current = new Map(books.map((b) => [b.slug, b])), slugs = new Set(current.keys()), inventory = snapshot.inventory || [], transfers = snapshot.transfers || [], devices = snapshot.devices || [];
    for (const i of inventory) for (const slug of i.slugs || []) slugs.add(slug);
    for (const row of transfers) slugs.add(row.slug);
    for (const e of snapshot.errors || []) if (e.slug) slugs.add(e.slug);
    return [...slugs].map((slug) => {
      const local = current.get(slug), copies = inventory.filter((i) => i.device_id !== snapshot.device && i.slugs?.includes(slug)).map((i) => {
        const d = devices.find((v) => v.device_id === i.device_id);
        return { name: d?.name || "Thiết bị khác", at: i.confirmed_at || i.updated_at, revoked: Boolean(d?.revoked_at), online: Boolean(d?.online), device: i.device_id };
      });
      const label = inventory.find((i) => i.labels?.[slug])?.labels[slug], pending = transfers.filter((r) => r.slug === slug).map((r) => ({ ...r, expired: !Number.isFinite(Date.parse(r.expires_at)) || Date.parse(r.expires_at) <= now, incoming: r.recipient_device === snapshot.device }));
      return { slug, title: local?.titleVi || label?.title || pending[0]?.title || "Ebook " + slug.slice(-8), local: Boolean(local), copies, pending, errors: (snapshot.errors || []).filter((e) => e.slug === slug) };
    }).sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || a.title.localeCompare(b.title, "vi"));
  }
  function create(options) {
    const $ = (id) => document.getElementById(id), esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    document.body.insertAdjacentHTML("beforeend", '<dialog id="library-health-dialog" class="tools-dialog journal-dialog" aria-labelledby="library-health-title"><header class="tools-heading"><h2 id="library-health-title">Tình trạng thư viện</h2><button id="library-health-close" class="tools-close" type="button" aria-label="Đóng tình trạng thư viện"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg></button></header><div class="journal-body"><p class="tools-hint">Xem ebook trên máy này và lần các máy khác xác nhận có sách. Bản trên đám mây chỉ dùng để chuyển tạm.</p><div class="journal-toolbar"><button id="library-health-refresh" class="btn-primary" type="button">Kiểm tra lại</button><button id="library-health-backup" class="btn-secondary" type="button">Tạo bản sao lưu ZIP</button></div><p id="library-health-account" class="tools-hint"></p><p id="library-health-storage" class="tools-hint"></p><label>Tìm ebook<input id="library-health-search" type="search" placeholder="Tên sách…"></label><p id="library-health-status" class="tools-feedback" role="status"></p><div id="library-health-list"></div></div></dialog>');
    const dialog = $("library-health-dialog"); options.surfaces.attach(dialog); let painting = false, local = [];
    const size = (n) => `${(n / 1024 / 1024).toLocaleString("vi", { maximumFractionDigits: 1 })} MB`;
    function paint() {
      const state = options.snapshot(); $("library-health-account").textContent = state.connected ? `${state.checkedAt ? "Lần kiểm tra gần nhất: " + new Date(state.checkedAt).toLocaleString("vi") : "Đang chờ kiểm tra ebook."} Máy offline có thể đã thay đổi sách sau lần xác nhận cuối.` : "Chưa bật đồng bộ cho máy này. Danh sách dưới đây chỉ xác nhận sách đang lưu cục bộ.";
      $("library-health-status").textContent = state.checking ? "Đang kiểm tra / chuyển ebook…" : state.errors?.length ? `${state.errors.length} ebook cần kiểm tra · ${state.errors[0].message}` : state.message || (state.connected ? "Sẵn sàng kiểm tra ebook." : "Bạn vẫn có thể tạo bản sao lưu trên máy.");
      const needle = $("library-health-search").value.trim().toLocaleLowerCase("vi"), list = describe(local, state).filter((r) => r.title.toLocaleLowerCase("vi").includes(needle));
      $("library-health-list").innerHTML = list.map((b) => `<article class="journal-card" data-health-book="${esc(b.slug)}"><h3>${esc(b.title)}</h3><p class="library-health-local">${b.local ? "✓ Có trên máy này" : "Chưa có trên máy này"}</p>${b.copies.map((c) => `<p class="tools-hint">${esc(c.name)}${c.revoked ? " · Đã thu hồi quyền cloud" : ""}: đã xác nhận có sách${c.at && Number.isFinite(Date.parse(c.at)) ? ` lúc ${esc(new Date(c.at).toLocaleString("vi"))}` : ""}.</p>`).join("")}${b.pending.map((r) => `<p>${r.received_at ? "Đã nhận · Chờ dọn bản tạm" : r.expired ? "Phiên chuyển đã hết hạn" : !r.ready ? "Đang tải lên / chưa tải xong" : r.incoming ? "Đang chờ lưu vào máy này" : "Đã gửi · Chờ máy nhận lưu"}</p>${r.incoming && r.ready && !r.received_at && !r.expired ? `<button class="btn-secondary" type="button" data-health-receive="${esc(r.id)}">Nhận sách này</button>` : ""}`).join("")}${b.errors.map((e) => `<p class="tools-feedback">${esc(e.message)}</p>`).join("")}${b.errors.length ? '<button type="button" class="btn-secondary" data-health-retry>Thử lại</button>' : ""}${!b.local && !b.pending.some((r) => !r.expired) ? '<p class="tools-hint">Giữ ứng dụng mở trên máy đang có sách để tự chuyển về, hoặc gửi thủ công từ máy đó.</p>' : ""}${b.local ? `<button class="btn-link" type="button" data-health-open="${esc(b.slug)}">Mở sách</button>` : ""}</article>`).join("") || '<p class="tools-empty">Chưa có ebook phù hợp. Ebook nhập trên máy sẽ hiện tại đây.</p>';
      $("library-health-list").querySelectorAll("[data-health-retry]").forEach((b) => b.onclick = async () => {
        const book = list.find((r) => r.slug === b.closest("[data-health-book]").dataset.healthBook), incoming = book?.pending.find((r) => r.incoming && r.ready && !r.received_at && !r.expired);
        if (!incoming) { await check(); return; }
        b.disabled = true; try { await options.receive(incoming.id); await refresh(); } catch (e) { $("library-health-status").textContent = e.message; } finally { b.disabled = false; }
      });
      $("library-health-list").querySelectorAll("[data-health-receive]").forEach((b) => b.onclick = async () => { b.disabled = true; try { await options.receive(b.dataset.healthReceive); await refresh(); } catch (e) { $("library-health-status").textContent = e.message; } finally { b.disabled = false; } });
      $("library-health-list").querySelectorAll("[data-health-open]").forEach((b) => b.onclick = () => { options.surfaces.close(dialog); options.openBook(b.dataset.healthOpen); });
    }
    async function refresh() {
      if (painting) return; painting = true;
      try {
        local = await root.EbookImport.list(); if (!dialog.open) return; paint();
        const [estimate, persistent] = await Promise.all([navigator.storage?.estimate?.().catch(() => null), navigator.storage?.persisted?.().catch(() => null)]);
        if (dialog.open) $("library-health-storage").textContent = `${local.length} ebook trên máy này${estimate ? ` · Website đang dùng ${size(estimate.usage || 0)}${estimate.quota ? ` / ${size(estimate.quota)}` : ""}` : ""}${persistent === true ? " · Đã được cấp chế độ giữ dữ liệu offline" : ""}. Bản sao lưu ZIP giúp bạn mang theo cả dữ liệu đọc và ebook.`;
      } catch (e) { $("library-health-status").textContent = e.message || "Không đọc được thư viện trên máy."; } finally { painting = false; }
    }
    async function check() { $("library-health-status").textContent = navigator.onLine ? "Đang kiểm tra sách giữa các máy…" : "Đang offline · Vẫn xem được sách trên máy này."; await options.check(); await refresh(); }
    function open() { options.closeSettings(); document.querySelector("#shelf-more")?.removeAttribute("open"); if ($("sync-dialog").open) options.surfaces.close($("sync-dialog")); options.surfaces.open(dialog); refresh(); }
    $("library-health-close").onclick = () => options.surfaces.close(dialog); $("library-health-search").oninput = paint; $("library-health-refresh").onclick = check;
    $("library-health-backup").onclick = () => { options.surfaces.close(dialog); options.backup(); };
    document.querySelectorAll("[data-open-library-health]").forEach((b) => b.onclick = open);
    addEventListener("ketruyen-library-health", () => { if (dialog.open) refresh(); }); addEventListener("ketruyen-ebooks-change", () => { if (dialog.open) refresh(); });
    return { open, refresh };
  }
  return { describe, create };
});
