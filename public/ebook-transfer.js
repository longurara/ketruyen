(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EbookTransfer = api;
})(globalThis, function () {
  "use strict";
  const BUCKET = "ebook-transfers", MAX_FILE = 50 * 1024 * 1024, MAX_EXPANDED = 150 * 1024 * 1024;
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  function objectPath(owner, id) {
    if (!UUID.test(owner) || !UUID.test(id)) throw new Error("Mã phiên chuyển sách không hợp lệ.");
    return `${owner}/${id}/book.zip`;
  }
  async function digest(blob) {
    return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function validate(row, owner) {
    objectPath(owner, row?.id);
    if (row.user_id !== owner || !/^ebook-[a-f\d]{24}$/.test(row.slug) || !/^[a-f\d]{64}$/.test(row.sha256) || !Number.isInteger(row.bytes) || row.bytes < 1 || row.bytes > MAX_FILE) throw new Error("Thông tin chuyển sách không hợp lệ.");
  }
  // The receipt is sent only after the local transaction commits. Cleanup is
  // deliberately separate, so failed deletion can be retried without reimport.
  async function receive(row, io) {
    io.guard(); validate(row, io.owner);
    if (!row.ready || row.received_at || Date.parse(row.expires_at) <= Date.now() || !Number.isFinite(Date.parse(row.expires_at))) throw new Error("Phiên chuyển sách đã kết thúc hoặc hết hạn.");
    io.report("Đang tải sách về…");
    const blob = await io.download(objectPath(io.owner, row.id)); io.guard();
    if (blob.size !== row.bytes || await digest(blob) !== row.sha256) throw new Error("Tệp tải chưa đầy đủ hoặc bị hỏng. Bản trên bucket được giữ để thử lại.");
    io.guard(); io.report("Đang kiểm tra nội dung…");
    const data = await io.unpack(blob); io.guard();
    if (data.books.length !== 1 || data.books[0].slug !== row.slug || Object.keys(data.settings).length) throw new Error("Gói chuyển sách không hợp lệ.");
    const book = data.books[0], existing = await io.get(row.slug); io.guard();
    if (existing && existing.digest !== book.digest) throw new Error("Sách trên máy có mã nội dung khác. Chưa thay đổi dữ liệu.");
    if (!existing) {
      io.report("Đang lưu sách trên thiết bị…");
      await io.save(book); io.guard();
    }
    const saved = await io.get(row.slug); io.guard();
    if (!saved || saved.digest !== book.digest) throw new Error("Chưa xác nhận được sách đã lưu trên máy. Bản trên bucket vẫn được giữ.");
    if (io.onSaved) { await io.onSaved(book.slug); io.guard(); }
    io.report("Đã lưu sách · Đang xóa bản tạm…");
    await io.confirm(row.id); io.guard();
    await cleanup(row, io);
    return { slug: book.slug, existing: Boolean(existing) };
  }
  async function cleanup(row, io) {
    io.guard(); validate(row, io.owner);
    await io.remove(objectPath(io.owner, row.id)); io.guard();
    await io.forget(row.id); io.guard();
  }
  return { BUCKET, MAX_FILE, MAX_EXPANDED, objectPath, digest, validate, receive, cleanup };
});
