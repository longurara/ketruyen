const { test } = require("node:test"), assert = require("node:assert/strict");
const core = require("../public/workbench-sync"), sync = require("../public/reader-sync"), wb = require("../public/reader-workbench");
class Storage {
  constructor(state = {}) { this.value = JSON.stringify(wb.normalizeState(state)); }
  getItem(key) { return key === core.KEY ? this.value : null; }
  setItem(key, value) { assert.equal(key, core.KEY); this.value = value; }
}
const term = (id = "word") => ({ id, slug: "book", term: "天使", meaning: "Thiên sứ", sentence: "Câu gốc tiếng Việt.", volIdx: 0, chapIdx: 2, p: 3 });
const vocab = (id = "word") => ({ ...term(id), level: 2, due: 123456, added: 100 });
const profile = (id = "night") => ({ id, name: "Đọc buổi tối", settings: wb.profileSettings({ theme: "dark", fontSize: 24 }) });
function server() {
  const rows = new Map();
  return { rows, push: async (changes) => changes.map((c) => {
    const old = rows.get(c.key);
    if ((old?.revision || 0) !== c.expected_revision) return { ...structuredClone(old), applied: false };
    const row = { record_key: c.key, value: structuredClone(c.value), revision: (old?.revision || 0) + 1 }; rows.set(c.key, row); return { ...row, applied: true };
  }) };
}
function device(remote, initial = {}) {
  const storage = new Storage(initial), state = sync.newState("owner"); let saved;
  const io = { valid: core.valid, merge: () => undefined, read: () => core.read(storage), apply: (updates) => core.apply(storage, updates),
    save: async (v) => { saved = structuredClone(v); }, pull: async () => structuredClone([...remote.rows.values()]), push: remote.push };
  return { storage, state, io, run: () => sync.synchronize(state, io), saved: () => saved };
}
test("workbench sync validates every record field and excludes active device settings", () => {
  const storage = new Storage({ glossary: [term()], vocabulary: [vocab()], profiles: [profile()], inline: true, quick: ["map"] });
  assert.equal(Object.keys(core.read(storage)).length, 3);
  for (const [key, value] of Object.entries(core.read(storage))) assert.equal(core.valid(key, value), true);
  for (const [key, value] of [["profile/night/extra", profile()], ["profile/__proto__", null], ["glossary/word", { ...term(), token: "secret" }],
    ["vocabulary/word", { ...vocab(), due: Infinity }], ["vocabulary/word", { ...vocab(), level: 1.5 }], ["glossary/word", { ...term(), id: "other" }],
    ["profile/night", { ...profile(), settings: { ...profile().settings, camera: {} } }], ["inline/current", true], ["profile/night", undefined]]) assert.equal(core.valid(key, value), false, key);
});
test("upgrading legacy IDs is stable across reloads and refuses to discard invalid or overflowing entries", () => {
  const storage = new Storage({ glossary: [term(""), term("")], profiles: [{ ...profile(), id: "" }] });
  const upgraded = core.initialize(storage, wb.normalizeState); assert.equal(new Set(upgraded.glossary.map((v) => v.id)).size, 2);
  assert.ok(upgraded.profiles[0].id); assert.deepEqual(core.initialize(storage, wb.normalizeState), upgraded);
  for (const glossary of [[{ ...term(), meaning: "" }], Array.from({ length: 1001 }, (_, i) => term("w" + i))]) {
    storage.value = JSON.stringify({ version: 1, glossary, vocabulary: [], profiles: [] }); const original = storage.value;
    assert.throws(() => core.initialize(storage, wb.normalizeState), /kiểm tra/); assert.equal(storage.value, original);
  }
});
test("independent records merge across devices, review schedules survive, profile download does not apply settings", async () => {
  const remote = server(), a = device(remote, { glossary: [term()], vocabulary: [vocab()], profiles: [profile()] }), b = device(remote, { glossary: [term("other")], inline: true, quick: ["preview"] });
  await a.run(); await b.run(); await a.run();
  assert.equal(Object.keys(core.read(a.storage)).length, 4); assert.deepEqual(core.read(b.storage)["vocabulary/word"], vocab());
  const bState = JSON.parse(b.storage.value); assert.equal(bState.inline, true); assert.deepEqual(bState.quick, ["preview"]);
  assert.equal(b.storage.getItem("tenshi-font-size"), null);
});
test("offline edits stay durable, concurrent edit/delete asks for choice, tombstones prevent resurrection", async () => {
  const remote = server(), a = device(remote, { glossary: [term()] }), b = device(remote);
  await a.run(); await b.run();
  core.apply(b.storage, { "glossary/word": { ...term(), meaning: "Viết khi offline" } });
  const pull = b.io.pull; b.io.pull = async () => { throw new Error("offline"); };
  await assert.rejects(b.run(), /offline/); assert.equal(b.saved().pending["glossary/word"].value.meaning, "Viết khi offline");
  core.apply(a.storage, { "glossary/word": null }); await a.run(); b.io.pull = pull;
  assert.equal((await b.run()).conflicts, 1); assert.equal(b.state.conflicts["glossary/word"].value, null);
  core.apply(b.storage, { "glossary/word": null }); b.state.baseline["glossary/word"] = b.state.conflicts["glossary/word"]; delete b.state.conflicts["glossary/word"];
  await b.run(); assert.equal(core.read(b.storage)["glossary/word"], undefined); assert.equal((await a.run()).pending, 0);
});
test("competing vocabulary reviews require a choice instead of arbitrarily merging due dates", async () => {
  const remote = server(), a = device(remote, { vocabulary: [vocab()] }), b = device(remote);
  await a.run(); await b.run();
  core.apply(a.storage, { "vocabulary/word": { ...vocab(), level: 3, due: 300000 } });
  core.apply(b.storage, { "vocabulary/word": { ...vocab(), level: 0, due: 200000 } });
  await a.run(); assert.equal((await b.run()).conflicts, 1); assert.equal(core.read(b.storage)["vocabulary/word"].level, 0);
});
test("saving a form merges independent incoming items and preserves a concurrent writing draft as a copy", () => {
  const storage = new Storage({ glossary: [term()] }), before = JSON.parse(storage.value), next = structuredClone(before);
  core.apply(storage, { "glossary/other": term("other"), "glossary/word": { ...term(), meaning: "Nghĩa từ máy khác" } });
  next.glossary[0].meaning = "Bản đang gõ";
  const result = core.commit(storage, before, next); assert.equal(result.copied, true);
  const values = Object.values(core.read(storage)); assert.equal(values.length, 3);
  assert.ok(values.some((v) => v.meaning === "Bản đang gõ")); assert.equal(core.read(storage)["glossary/word"].meaning, "Nghĩa từ máy khác");
  next.glossary = []; assert.throws(() => core.commit(storage, before, next), /thay đổi/);
});
test("quota errors and union capacity errors do not truncate or acknowledge incoming data", async () => {
  const remote = server(), a = device(remote, { profiles: [profile()] }), b = device(remote, { profiles: Array.from({ length: 12 }, (_, i) => profile("p" + i)) });
  await a.run(); const before = b.storage.value;
  await assert.rejects(b.run(), /giới hạn/); assert.equal(b.storage.value, before); assert.equal(b.state.baseline["profile/night"], undefined);
  const c = device(remote); c.storage.setItem = () => { throw new Error("quota"); };
  await assert.rejects(c.run(), /quota/); assert.deepEqual(c.state.baseline, {});
});
test("a review made while an upload is pending stays queued after the older acknowledgement", async () => {
  const remote = server(), a = device(remote, { vocabulary: [vocab()] }), push = a.io.push;
  a.io.push = async (changes) => { core.apply(a.storage, { "vocabulary/word": { ...vocab(), level: 3, due: 900000 } }); return push(changes); };
  assert.equal((await a.run()).pending, 1); assert.equal(a.saved().pending["vocabulary/word"].value.level, 3);
});
function controller(storage = new Storage({ glossary: [term()] })) {
  const states = new Map(); let deferred;
  const journal = async (key, value) => { if (deferred) await deferred; if (value) states.set(key, structuredClone(value)); return structuredClone(states.get(key)); };
  const service = core.create({ storage, journal }); service.setContext("a", "session-a");
  const api = { owner: "a", guard() {}, client: { from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, range() { return this; } }), rpc: (name, body) => ({ name, body }) }, request: async () => [] };
  return { service, api, states, storage, defer: (value) => { deferred = value; } };
}
test("a missing migration keeps its durable outbox and reports local-only fallback", async () => {
  const c = controller(); c.api.request = async () => { throw Object.assign(new Error("missing table"), { code: "PGRST205" }); };
  const result = await c.service.flush(c.api); assert.equal(result.unavailable, true); assert.equal(result.pending, 1);
  assert.match(c.service.snapshot().message, /migration 0007/); assert.equal(c.states.get("a:workbench").pending["glossary/word"].value.term, "天使");
});
test("account switch cancels a deferred load without exposing the old account conflicts", async () => {
  const c = controller(); c.states.set("a:workbench", { ...sync.newState("a"), conflicts: { "glossary/word": { value: term(), revision: 1 } } });
  let release; c.defer(new Promise((resolve) => { release = resolve; }));
  const pending = c.service.flush(c.api); c.service.setContext("b", "session-b"); release(); await pending;
  assert.deepEqual(c.service.snapshot().conflicts, {}); assert.equal(c.service.snapshot().owner, "b");
});
test("account switch during a response prevents applying data from the old session", async () => {
  const c = controller(new Storage()); let release, entered;
  const requestStarted = new Promise((resolve) => { entered = resolve; });
  c.api.request = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
  const pending = c.service.flush(c.api); await requestStarted; c.service.setContext("", "");
  release([{ record_key: "glossary/word", value: term(), revision: 1 }]); await pending;
  assert.deepEqual(core.read(c.storage), {}); assert.deepEqual(c.service.snapshot().conflicts, {});
});
