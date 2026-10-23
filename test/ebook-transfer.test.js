const { test } = require("node:test"), assert = require("node:assert/strict");
const transfer = require("../public/ebook-transfer");
const OWNER = "11111111-1111-4111-8111-111111111111", ID = "33333333-3333-4333-8333-333333333333";
async function fixture() {
  const blob = new Blob(["fixture ebook archive"]), book = { slug: "ebook-" + "a".repeat(24), digest: "a".repeat(64) };
  const row = { id: ID, user_id: OWNER, slug: book.slug, sha256: await transfer.digest(blob), bytes: blob.size, ready: true, received_at: null, expires_at: new Date(Date.now() + 60000).toISOString() };
  const calls = [], local = new Map();
  const io = { owner: OWNER, guard() {}, report() {}, download: async () => { calls.push("download"); return blob; },
    unpack: async () => ({ books: [book], settings: {} }), get: async (slug) => local.get(slug),
    save: async (value) => { calls.push("save"); local.set(value.slug, value); },
    onSaved: async () => calls.push("visible"), confirm: async () => calls.push("receipt"),
    remove: async () => calls.push("remove"), forget: async () => calls.push("forget") };
  return { row, io, book, local, calls, blob };
}
test("handoff saves durably, makes book visible, acknowledges, then removes object and metadata", async () => {
  const f = await fixture();
  assert.deepEqual(await transfer.receive(f.row, f.io), { slug: f.book.slug, existing: false });
  assert.deepEqual(f.calls, ["download", "save", "visible", "receipt", "remove", "forget"]);
});
test("download corruption and quota failures retain the remote object without receipt", async () => {
  for (const failure of ["hash", "quota", "uncommitted"]) {
    const f = await fixture();
    if (failure === "hash") f.io.download = async () => new Blob(["corrupt"]);
    if (failure === "quota") f.io.save = async () => { throw new Error("QuotaExceededError"); };
    if (failure === "uncommitted") f.io.save = async () => {};
    await assert.rejects(transfer.receive(f.row, f.io));
    assert.ok(!f.calls.includes("receipt")); assert.ok(!f.calls.includes("remove"));
  }
});
test("failed deletion retains a durable local copy and can be retried without another import", async () => {
  const f = await fixture();
  f.io.remove = async () => { throw new Error("network"); };
  await assert.rejects(transfer.receive(f.row, f.io), /network/);
  assert.ok(f.local.has(f.book.slug)); assert.ok(f.calls.includes("receipt")); assert.ok(!f.calls.includes("forget"));
  f.io.remove = async () => f.calls.push("remove"); await transfer.cleanup(f.row, f.io);
  assert.deepEqual(f.calls.slice(-2), ["remove", "forget"]);
});
test("expired sessions, cross-account data and settings-bearing packages cannot be imported", async () => {
  for (const failure of ["expired", "owner", "settings", "slug", "not-ready", "received"]) {
    const f = await fixture();
    if (failure === "expired") f.row.expires_at = new Date(0).toISOString();
    if (failure === "owner") f.row.user_id = ID;
    if (failure === "settings") f.io.unpack = async () => ({ books: [f.book], settings: { "tenshi-font": "bad" } });
    if (failure === "slug") f.io.unpack = async () => ({ books: [{ ...f.book, slug: "other" }], settings: {} });
    if (failure === "not-ready") f.row.ready = false;
    if (failure === "received") f.row.received_at = new Date().toISOString();
    await assert.rejects(transfer.receive(f.row, f.io)); assert.equal(f.local.size, 0); assert.ok(!f.calls.includes("receipt"));
  }
});
test("an existing local book is preserved, and account changes stop before saving", async () => {
  const f = await fixture(); const original = { ...f.book, titleVi: "Local edits" }; f.local.set(f.book.slug, original);
  assert.equal((await transfer.receive(f.row, f.io)).existing, true); assert.equal(f.local.get(f.book.slug), original); assert.ok(!f.calls.includes("save"));
  const g = await fixture(); let cancelled = false;
  g.io.guard = () => { if (cancelled) throw new Error("transfer-cancelled"); };
  g.io.unpack = async () => { cancelled = true; return { books: [g.book], settings: {} }; };
  await assert.rejects(transfer.receive(g.row, g.io), /transfer-cancelled/); assert.equal(g.local.size, 0); assert.ok(!g.calls.includes("remove"));
});
