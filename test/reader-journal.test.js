const { test } = require("node:test"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const core = require("../public/reader-journal"), sync = require("../public/reader-sync"), backup = require("../public/library-backup"), { describe } = require("../public/library-health");
class Storage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i]; }
  getItem(k) { return this.map.get(k) ?? null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
const book = { slug: "book", titleVi: "Cảm nhận tiếng Việt", author: "Tác giả", volumesData: [{ name: "Tập 1" }] };
const run = (now = Date.parse("2026-10-23T00:00:00Z")) => core.newRun(book, "book", null, randomUUID(), 1, now);
const entry = (r) => ({ id: randomUUID(), kind: "entry", slug: r.slug, title: r.title, author: r.author, scope: r.scope, volIdx: r.volIdx, volume: r.volume,
  runId: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, on: "2026-10-23", phase: "finished", rating: 5, text: "Ấm áp và đáng nhớ.", moods: ["Ấm áp"], location: null,
  attachments: [{ type: "quote", label: "Câu đã lưu", text: "Ký ức của tôi", volIdx: 0, chapIdx: 0 }] });
test("diary ids are stable across devices; validation and backup retain old writing independently of ebook files", async () => {
  const id = await core.defaultId(book.slug, "book", null); assert.equal(id, await core.defaultId(book.slug, "book", null)); assert.ok(core.UUID.test(id));
  assert.notEqual(id, await core.defaultId(book.slug, "volume", 0));
  const r = run(Date.parse("2001-01-01T00:00:00Z")), e = entry(r), store = new Storage();
  core.apply(store, { ["journal/" + r.id]: r, ["journal/" + e.id]: e }); assert.equal(core.values(store).length, 2);
  const settings = Object.fromEntries(store.map); assert.deepEqual(backup.validateSettings(settings), settings);
  assert.equal(core.valid(e.id, { ...e, rating: 6 }), false); assert.equal(core.valid(r.id, { ...r, completedOn: "2000-12-31" }), false);
  assert.equal(core.date("2026-02-29"), false); assert.equal(core.valid(e.id, { ...e, attachments: new Array(13).fill(e.attachments[0]) }), false);
  assert.throws(() => backup.validateSettings({ [core.PREFIX + e.id]: JSON.stringify({ ...e, rating: 9 }) }), /hỏng/);
  assert.deepEqual(sync.readLocal(store), {}, "diary leaked into the legacy reading sync table");
  core.apply(store, { ["journal/" + e.id]: null }); assert.equal(core.records(store)["journal/" + e.id], null, "deletion lost its tombstone");
});
test("a quota failure rolls back a whole diary save and never deletes unrelated library data", () => {
  const store = new Storage(), r = run(), e = entry(r); store.setItem("tenshi-progress", "kept"); core.apply(store, { ["journal/" + r.id]: r });
  const original = store.setItem.bind(store); store.setItem = (k, v) => { if (k === core.PREFIX + e.id) throw new Error("quota"); original(k, v); };
  assert.throws(() => core.apply(store, { ["journal/" + r.id]: { ...r, status: "paused" }, ["journal/" + e.id]: e }), /quota/);
  assert.equal(core.values(store)[0].status, "reading"); assert.equal(store.getItem("tenshi-progress"), "kept"); assert.equal(store.getItem(core.PREFIX + e.id), null);
});
test("automatic run milestones merge earliest starts and completed chapter sets without discarding divergent reasons", () => {
  const base = run(), later = { ...base, startedOn: "2026-10-24", createdAt: base.createdAt + 10000 }, merged = core.mergeRun("journal/" + base.id, base, later);
  assert.equal(merged.startedOn, "2026-10-23"); assert.equal(merged.createdAt, base.createdAt);
  const a = { ...base, completed: ["0:1"], updatedAt: base.updatedAt + 1 }, b = { ...base, completed: ["0:2"], updatedAt: base.updatedAt + 2 };
  assert.deepEqual(core.mergeRun("journal/" + base.id, a, b, base).completed, ["0:1", "0:2"]);
  assert.equal(core.mergeRun("journal/" + base.id, { ...base, reason: "Máy A" }, { ...base, reason: "Máy B" }, base), undefined);
});
test("journal synchronization preserves offline edits, CAS conflicts, deletions and independent entries", async () => {
  const rows = new Map(), r = run(), e = entry(r);
  const device = () => {
    const store = new Storage(), state = sync.newState("owner");
    const io = { merge: core.mergeRun, read: () => core.records(store), apply: (u) => core.apply(store, u), save: async () => {}, pull: async () => structuredClone([...rows.values()]),
      push: async (changes) => changes.map((c) => { const old = rows.get(c.key); if ((old?.revision || 0) !== c.expected_revision) return { ...old, applied: false }; const saved = { record_key: c.key, value: structuredClone(c.value), revision: (old?.revision || 0) + 1 }; rows.set(c.key, saved); return { ...saved, applied: true }; }) };
    return { store, state, run: () => sync.synchronize(state, io) };
  };
  const a = device(), b = device(); core.apply(a.store, { ["journal/" + r.id]: r, ["journal/" + e.id]: e }); await a.run(); await b.run();
  core.apply(a.store, { ["journal/" + e.id]: { ...e, text: "Cảm nhận A" } }); core.apply(b.store, { ["journal/" + e.id]: { ...e, text: "Cảm nhận B" } });
  await a.run(); assert.equal((await b.run()).conflicts, 1); assert.equal(core.values(b.store).find((v) => v.id === e.id).text, "Cảm nhận B");
  assert.equal(b.state.conflicts["journal/" + e.id].value.text, "Cảm nhận A");
  const independent = entry(r); core.apply(b.store, { ["journal/" + independent.id]: independent }); await b.run(); assert.ok(rows.has("journal/" + independent.id));
  core.apply(a.store, { ["journal/" + e.id]: null }); await a.run(); const fresh = device(); await fresh.run(); assert.equal(core.records(fresh.store)["journal/" + e.id], null);
});
test("Vietnam dates, rereads, anniversary memories and reports remain useful after old activity has expired", () => {
  assert.equal(core.dayKey(Date.parse("2026-10-22T18:00:00Z")), "2026-10-23");
  const r = { ...run(), completedOn: "2026-10-23", status: "completed" }, volume = { ...r, id: randomUUID(), scope: "volume", volIdx: 0 }, reread = { ...r, id: randomUUID(), round: 2 }, e = entry(r);
  const report = core.summary([r, volume, reread, e], "2026"); assert.equal(report.books, 2); assert.equal(report.volumes, 1); assert.equal(report.rating, 5); assert.equal(report.quotes[0].text, "Ký ức của tôi");
  assert.ok(core.timeline([r, reread, e]).some((v) => v.event === "reread"));
  const leap = { ...e, on: "2024-02-29" }; assert.equal(core.memories([leap], Date.parse("2025-03-01T00:00:00Z")).length, 1);
  assert.equal(core.memories([leap], Date.parse("2028-03-01T00:00:00Z")).length, 0);
});
test("exports include only selected entries and attachments require explicit inclusion", () => {
  const r = run(), selected = entry(r), other = { ...entry(r), text: "Private unrelated entry" };
  assert.ok(other.text); assert.doesNotMatch(core.markdown([selected]), /Ký ức của tôi|Private unrelated entry/);
  assert.match(core.markdown([selected], { attachments: true }), /Ký ức của tôi/);
});
test("rereads need newly completed chapters; old progress, illustrations and opening a chapter cannot finish a new run", () => {
  const b = { ...book, volumesData: [{ chapters: [{}, {}, { isIllustration: true }] }] }, old = { "0:0": { done: true }, "0:1": { done: true } }, first = run(), second = { ...first, id: randomUUID(), round: 2 };
  assert.equal(core.advanceRun(first, b, old, []), first);
  assert.equal(core.advanceRun(first, b, old, ["0:1"]).status, "completed");
  const one = core.advanceRun(second, b, old, ["0:0"]); assert.equal(one.status, "reading"); assert.deepEqual(one.completed, ["0:0"]);
  assert.equal(core.advanceRun(one, b, old, ["0:1"]).status, "completed");
  const paused = { ...second, status: "paused" }; assert.equal(core.advanceRun(paused, b, old, ["0:0", "0:1"]), paused);
});
test("pause, abandonment and return remain distinct dated milestones after a run changes status", () => {
  const r = run(), event = { id: randomUUID(), kind: "event", slug: r.slug, title: r.title, author: r.author, scope: r.scope, volIdx: r.volIdx, volume: r.volume, runId: r.id,
    event: "paused", on: "2026-10-23", reason: "Đợi tập tiếp theo", createdAt: r.createdAt, updatedAt: r.updatedAt };
  assert.ok(core.valid(event.id, event)); const returned = { ...event, id: randomUUID(), event: "resumed", on: "2026-10-24", reason: "Đã có tập mới" };
  const history = core.timeline([{ ...r, status: "reading", reason: "Đã có tập mới" }, event, returned]);
  assert.equal(history.filter((v) => ["paused", "resumed"].includes(v.event)).length, 2); assert.equal(history.find((v) => v.event === "paused").reason, "Đợi tập tiếp theo");
});
test("library health distinguishes actual local files from stale peer confirmations and expired temporary transfers", () => {
  const slug = "ebook-" + "a".repeat(24), now = Date.now(), confirmed = new Date(now - 86400000).toISOString();
  const state = { device: "here", devices: [{ device_id: "there", name: "iPhone", revoked_at: new Date(now).toISOString() }],
    inventory: [{ device_id: "there", slugs: [slug], confirmed_at: confirmed, labels: { [slug]: { title: "Tên sách đã xóa khỏi máy này" } } }],
    transfers: [{ id: "transfer", slug, title: "Book", recipient_device: "here", expires_at: new Date(now - 1).toISOString() }], errors: [{ slug, message: "QuotaExceededError" }] };
  const row = describe([], state, now)[0]; assert.equal(row.local, false); assert.equal(row.copies[0].at, confirmed); assert.equal(row.copies[0].revoked, true); assert.equal(row.pending[0].expired, true); assert.equal(row.pending[0].incoming, true);
  assert.match(row.title, /Tên sách/); assert.equal(describe([{ slug, titleVi: "Có trên máy" }], state, now)[0].local, true);
});
