const { test } = require("node:test");
const assert = require("node:assert/strict");
const sync = require("../public/reader-sync");
class Storage {
  constructor(values = {}) { this.map = new Map(Object.entries(values).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i]; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, value); }
  removeItem(key) { this.map.delete(key); }
}
test("concurrent shared goal edits require a version choice and do not upload local utility settings", async () => {
  const server = cloud(), id = "11111111-1111-4111-8111-111111111111";
  const goal = { id, kind: "minutes", target: 15, startedAt: 100 };
  const a = device(server, { "tenshi-cloud-goal-v1": goal }), b = device(server);
  await a.run(); await b.run();
  a.storage.setItem("tenshi-cloud-goal-v1", JSON.stringify({ ...goal, target: 20 }));
  b.storage.setItem("tenshi-cloud-goal-v1", JSON.stringify({ ...goal, target: 30 }));
  await a.run(); const result = await b.run(); assert.equal(result.conflicts, 1);
  assert.equal(b.state.conflicts["goal/current"].value.target, 20);
  assert.equal(JSON.parse(b.storage.getItem("tenshi-cloud-goal-v1")).target, 30);
  assert.equal(b.storage.getItem("tenshi-reader-tools-v1"), null);
});
const position = (chapter, timestamp = 1) => ({ volIdx: 0, chapIdx: chapter, timestamp });
const mark = (id) => ({ id, slug: "book", type: "bookmark", volIdx: 0, chapIdx: 0, anchor: { block: 1, offset: 0 }, note: "Ghi chú riêng" });
function cloud() {
  const rows = new Map();
  return { rows, push: async (changes) => changes.map((change) => {
    const current = rows.get(change.key);
    if ((current?.revision || 0) !== change.expected_revision) return { ...current, applied: false };
    const row = { record_key: change.key, value: structuredClone(change.value), revision: (current?.revision || 0) + 1 };
    rows.set(change.key, row); return { ...row, applied: true };
  }) };
}
function device(server, initial = {}) {
  const storage = new Storage(initial), state = sync.newState("same-user"); let saved;
  const io = { read: () => sync.readLocal(storage), apply: (updates) => sync.applyLocal(storage, updates),
    save: async (value) => { saved = structuredClone(value); }, pull: async () => structuredClone([...server.rows.values()]), push: server.push };
  return { storage, state, io, run: () => sync.synchronize(state, io), saved: () => saved };
}

test("only reading records sync; credentials, camera calibration, ebook blobs and device settings stay local", () => {
  const storage = new Storage({ "ketruyen-auth-v1": "private", "tenshi-hand-camera-v1": { calibration: "device" }, "tenshi-font-size": "22",
    "tenshi-progress": position(2), "tenshi-chapters": { "0:2": { pct: 25, block: 7, offset: .2 } }, "tenshi-history": [position(2)],
    "tenshi-library-v1": { version: 1, books: { book: { favorite: true, status: "reading", groups: ["Nhẹ nhàng"] } }, marks: [mark("note-1")], layout: { width: 800 } } });
  const records = sync.readLocal(storage);
  assert.equal(Object.keys(records).length, 7);
  assert.equal(records["favorite/book"], true); assert.equal(records["mark/note-1"].note, "Ghi chú riêng");
  assert.ok(!JSON.stringify(records).includes("private")); assert.ok(!JSON.stringify(records).includes("calibration"));
  for (const [key, value] of [["progress/tenshi/extra", position(1)], ["favorite/book/extra", true], ["chapter/tenshi/__proto__", {}], ["history/tenshi/1:9", position(1)], ["auth/secret", null], ["favorite/book", undefined]]) assert.equal(sync.validRecord(key, value), false);
  assert.equal(sync.validRecord("favorite/__proto__", true), false);
  assert.throws(() => sync.applyLocal(storage, { "favorite/__proto__": true }), /định dạng/);
  assert.equal(Object.prototype.favorite, undefined);
});

test("two devices merge independent books, fields and notes without overwriting unrelated local layout", async () => {
  const server = cloud();
  const a = device(server, { "tenshi-progress": position(3), "tenshi-library-v1": { version: 1, books: { book: { favorite: true } }, marks: [mark("a")], layout: { width: 600 } } });
  await a.run();
  const b = device(server, { "tenshi-other-progress": position(7), "tenshi-library-v1": { version: 1, books: {}, marks: [mark("b")], layout: { width: 900 } } });
  await b.run(); await a.run();
  assert.deepEqual(sync.readLocal(a.storage), sync.readLocal(b.storage));
  assert.deepEqual(JSON.parse(a.storage.getItem("tenshi-other-progress")), position(7));
  assert.equal(JSON.parse(a.storage.getItem("tenshi-library-v1")).layout.width, 600);
  assert.equal(JSON.parse(b.storage.getItem("tenshi-library-v1")).layout.width, 900);
});

test("deleted notes and reset positions propagate as tombstones instead of reappearing on an older device", async () => {
  const server = cloud(), a = device(server, { "tenshi-progress": position(1), "tenshi-library-v1": { version: 1, books: {}, marks: [mark("a")] } }), b = device(server);
  await a.run(); await b.run();
  a.storage.removeItem("tenshi-progress"); a.storage.setItem("tenshi-library-v1", JSON.stringify({ version: 1, books: {}, marks: [] }));
  await a.run(); await b.run(); await b.run();
  assert.equal(b.storage.getItem("tenshi-progress"), null);
  assert.equal(JSON.parse(b.storage.getItem("tenshi-library-v1")).marks.length, 0);
  assert.equal(server.rows.get("mark/a").value, null);
  assert.equal(server.rows.get("mark/a").revision, 2);
});

test("offline note edits stay journaled and require a choice without losing either version", async () => {
  const server = cloud(), key = "mark/a", initial = { "tenshi-library-v1": { version: 1, books: {}, marks: [mark("a")] } }, a = device(server, initial), b = device(server);
  await a.run(); await b.run();
  const edit = (d, note) => { const lib = JSON.parse(d.storage.getItem("tenshi-library-v1")); lib.marks[0].note = note; d.storage.setItem("tenshi-library-v1", JSON.stringify(lib)); };
  edit(b, "Offline B"); const pull = b.io.pull; b.io.pull = async () => { throw new Error("offline"); };
  await assert.rejects(b.run(), /offline/); assert.equal(b.saved().pending[key].value.note, "Offline B");
  edit(a, "Online A"); await a.run(); b.io.pull = pull;
  assert.equal((await b.run()).conflicts, 1); assert.equal(b.state.conflicts[key].value.note, "Online A");
  b.state.baseline[key] = b.state.conflicts[key]; delete b.state.conflicts[key];
  await b.run(); await a.run(); assert.equal(sync.readLocal(a.storage)[key].note, "Offline B");
});

test("a read position changed during network I/O stays pending and is not replaced by an older acknowledgement", async () => {
  const server = cloud(), a = device(server, { "tenshi-progress": position(1) });
  const push = a.io.push;
  a.io.push = async (changes) => { a.storage.setItem("tenshi-progress", JSON.stringify(position(2))); return push(changes); };
  assert.equal((await a.run()).pending, 1);
  assert.equal(a.state.pending["progress/tenshi"].value.chapIdx, 2);
  a.io.push = push; await a.run(); assert.equal(server.rows.get("progress/tenshi").value.chapIdx, 2);
});

test("an RPC race automatically accepts the farther remote position", async () => {
  const server = cloud(), a = device(server, { "tenshi-progress": position(1) });
  a.io.push = async (changes) => { await server.push([{ key: "progress/tenshi", value: position(8), expected_revision: 0 }]); return server.push(changes); };
  assert.equal((await a.run()).conflicts, 0); assert.equal(JSON.parse(a.storage.getItem("tenshi-progress")).chapIdx, 8);
});

test("a farther local position retries CAS instead of asking the reader to choose", async () => {
  const server = cloud(), a = device(server, { "tenshi-progress": position(8) }); let calls = 0;
  a.io.push = async (changes) => { if (!calls++) await server.push([{ key: "progress/tenshi", value: position(2), expected_revision: 0 }]); return server.push(changes); };
  const result = await a.run(); assert.equal(result.conflicts, 0); assert.equal(result.pending, 0); assert.equal(calls, 2); assert.equal(server.rows.get("progress/tenshi").value.chapIdx, 8);
});

test("24% and 28% merge to 28%, with done flags and the winning anchor intact", async () => {
  const server = cloud(), a = device(server, { "tenshi-chapters": { "0:1": { pct: 24, block: 4, textOffset: 7, done: true } } }), b = device(server, { "tenshi-chapters": { "0:1": { pct: 28, block: 5, textOffset: 10 } } });
  await a.run(); assert.equal((await b.run()).conflicts, 0); await a.run();
  for (const d of [a, b]) assert.deepEqual(sync.readLocal(d.storage)["chapter/tenshi/0:1"], { pct: 28, block: 5, textOffset: 10, done: true });
  b.storage.setItem("tenshi-chapters", JSON.stringify({ "0:1": { pct: 12, block: 2 } })); await b.run(); assert.equal(sync.readLocal(b.storage)["chapter/tenshi/0:1"].pct, 28);
});

test("volume and chapter order beat timestamps, and old saved conflicts resolve automatically", async () => {
  const server = cloud(), a = device(server, { "tenshi-progress": { volIdx: 1, chapIdx: 2, timestamp: 1 } }), b = device(server, { "tenshi-progress": { volIdx: 0, chapIdx: 20, timestamp: 100 } });
  await a.run(); b.state.conflicts["progress/tenshi"] = server.rows.get("progress/tenshi"); await b.run(); await a.run();
  assert.deepEqual(sync.readLocal(b.storage)["progress/tenshi"], { volIdx: 1, chapIdx: 2, timestamp: 100 }); assert.deepEqual(b.state.conflicts, {});
});

test("an explicit reset wins against stale offline progress and reading may restart after seeing it", async () => {
  const server = cloud(), a = device(server, { "tenshi-progress": position(2) }), b = device(server); await a.run(); await b.run();
  b.storage.setItem("tenshi-progress", JSON.stringify(position(9))); a.storage.removeItem("tenshi-progress"); await a.run(); await b.run();
  assert.equal(b.storage.getItem("tenshi-progress"), null); assert.equal(server.rows.get("progress/tenshi").value, null);
  b.storage.setItem("tenshi-progress", JSON.stringify(position(0))); await b.run(); assert.equal(server.rows.get("progress/tenshi").value.chapIdx, 0);
});

test("clearing reading status is shared without deleting the reading position", async () => {
  const server = cloud(), a = device(server, { "tenshi-progress": position(5), "tenshi-library-v1": { version: 1, books: { book: { status: null } }, marks: [] } }), b = device(server); await a.run(); await b.run();
  assert.equal(JSON.parse(b.storage.getItem("tenshi-library-v1")).books.book.status, null); assert.equal(sync.readLocal(b.storage)["progress/tenshi"].chapIdx, 5);
});

test("a quota error rolls back downloaded records and leaves the merge baseline unchanged", async () => {
  const storage = new Storage({ "tenshi-progress": position(1) });
  const original = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === "tenshi-other-progress") throw new Error("quota"); original(key, value); };
  assert.throws(() => sync.applyLocal(storage, { "progress/tenshi": position(3), "progress/tenshi-other": position(4) }), /quota/);
  assert.deepEqual(JSON.parse(storage.getItem("tenshi-progress")), position(1));
  assert.equal(storage.getItem("tenshi-other-progress"), null);
});

test("downloaded revisions are journaled even if uploading another local record fails", async () => {
  const server = cloud();
  await server.push([{ key: "progress/tenshi", value: position(2), expected_revision: 0 }]);
  const a = device(server, { "tenshi-other-progress": position(4) });
  a.io.push = async () => { throw new Error("connection lost"); };
  await assert.rejects(a.run(), /connection lost/);
  assert.equal(a.saved().baseline["progress/tenshi"].revision, 1);
  assert.equal(a.saved().pending["progress/tenshi-other"].value.chapIdx, 4);
  assert.deepEqual(JSON.parse(a.storage.getItem("tenshi-progress")), position(2));
});

test("sync receipts count confirmed transfers and never mark conflicts or failed checks as a new success", async () => {
  const server = cloud(), a = device(server, { "tenshi-progress": position(1) });
  const first = await a.run();
  assert.equal(first.uploaded, 1); assert.equal(first.downloaded, 0);
  assert.ok(a.saved().lastSyncedAt > 0);
  assert.deepEqual(a.saved().lastTransfer, { uploaded: 1, downloaded: 0 });
  const b = device(server);
  const received = await b.run(); assert.equal(received.downloaded, 1); assert.equal(received.uploaded, 0);
  const checked = await b.run(); assert.equal(checked.downloaded, 0); assert.equal(checked.uploaded, 0);
  a.storage.setItem("tenshi-library-v1", JSON.stringify({ version: 1, books: {}, marks: [mark("note")] })); await a.run(); await b.run();
  const edit = (d, note) => { const lib = JSON.parse(d.storage.getItem("tenshi-library-v1")); lib.marks[0].note = note; d.storage.setItem("tenshi-library-v1", JSON.stringify(lib)); };
  edit(a, "A"); await a.run(); edit(b, "B"); b.state.lastSyncedAt = 123;
  assert.equal((await b.run()).conflicts, 1); assert.equal(b.saved().lastSyncedAt, 123);
  b.io.pull = async () => { throw new Error("offline"); };
  await assert.rejects(b.run(), /offline/); assert.equal(b.saved().lastSyncedAt, 123);
});
