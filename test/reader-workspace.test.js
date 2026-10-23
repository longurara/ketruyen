const { test } = require("node:test"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto"), core = require("../public/reader-workspace"), sync = require("../public/reader-sync");
const now = Date.parse("2026-10-23T12:00:00Z");
const event = (start, end, extra = {}) => ({ id: randomUUID(), kind: "read", slug: "book", start, end, interaction: start, ...extra });
test("a device is offline after 90 seconds without heartbeat and presence; revocation overrides presence", () => {
  const d = { device_id: randomUUID(), last_seen: new Date(now - 89999).toISOString() }, presence = new Set([d.device_id]);
  assert.equal(core.isOnline(d, new Set(), now), true); assert.equal(core.isOnline(d, new Set(), now + 1), false);
  assert.equal(core.isOnline(d, presence, now + 100000), true); assert.equal(core.isOnline({ ...d, revoked_at: new Date(now).toISOString() }, presence, now), false);
});
test("two machines reading the same ten minutes count once; offline retries are idempotent", () => {
  const input = [];
  for (let t = now - 600000; t < now; t += 30000) input.push(event(t, t + 30000), event(t, t + 30000, { kind: "listen", interaction: t + 1 }));
  const s = core.aggregate([...input, ...input], null, 0, now);
  assert.equal(s.total, 600); assert.equal(s.days[core.dayKey(now)].listen, 600); assert.equal(s.days[core.dayKey(now)].read, 0);
  assert.equal(s.streak, 1);
});
test("overlap goes to latest interaction then stable ID, regardless of arrival order", () => {
  const goalA = randomUUID(), goalB = randomUUID();
  const a = event(now - 30000, now, { goalId: goalA }), b = event(now - 20000, now - 10000, { goalId: goalB, interaction: now });
  const first = core.aggregate([a, b], null, 0, now), second = core.aggregate([b, a], null, 0, now);
  assert.deepEqual(first, second); assert.equal(first.goals[goalA].seconds, 20); assert.equal(first.goals[goalB].seconds, 10);
  const tied = { ...b, start: a.start, end: a.end, interaction: a.interaction };
  assert.deepEqual(core.aggregate([a, tied], null, 0, now), core.aggregate([tied, a], null, 0, now));
});
test("Vietnam midnight splits time and a streak requires at least a minute per day", () => {
  const midnight = Date.parse("2026-10-22T17:00:00Z"), input = [];
  for (let t = midnight - 60000; t < midnight + 60000; t += 30000) input.push(event(t, t + 30000));
  const s = core.aggregate(input, null, 0, midnight + 60000);
  assert.equal(s.days["2026-10-22"].read, 60); assert.equal(s.days["2026-10-23"].read, 60); assert.equal(s.streak, 2);
  assert.equal(core.aggregate([event(midnight, midnight + 30000)], null, 0, midnight + 60000).streak, 0);
});
test("legacy cutover never adds the pre-sync intervals twice and chapter goals use unique identities", () => {
  const g = randomUUID(), chapter = event(now, now, { kind: "chapter", chapter: "book\u001fvol\u001fchapter", goalId: g });
  const s = core.aggregate([event(now - 30000, now), event(now - 20000, now), chapter, { ...chapter, id: randomUUID() }], { days: { "2026-10-23": { read: 60 } } }, now - 10000, now);
  assert.equal(s.total, 70); assert.equal(s.goals[g].chapters.length, 1); assert.equal(s.completed, 1);
});
test("only the shared goal definition joins reading records; device-local tool state stays local", () => {
  const g = { id: randomUUID(), kind: "minutes", target: 15, startedAt: now };
  assert.equal(sync.validRecord("goal/current", g), true); assert.equal(sync.validRecord("goal/current", { ...g, target: 500 }), false);
  assert.equal(sync.validRecord("goal/current", null), true);
});
