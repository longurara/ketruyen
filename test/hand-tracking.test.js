const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAdaptiveFilter, createHandContinuity, createVideoFrameSource, createFrameGate } = require("../public/hand-tracking");
const hand = (extra = {}) => ({ x: 0.5, y: 0.5, size: 0.2, hand: "Right", ...extra });

test("adaptive filtering suppresses stationary tremor and follows motion faster when beta rises", () => {
  const steady = createAdaptiveFilter({ minCutoff: 1, beta: 0 });
  const input = [], output = [];
  steady.push(0.5, 0);
  for (let index = 1; index <= 120; index++) {
    const value = 0.5 + Math.sin(index * Math.PI / 6) * 0.01;
    input.push(Math.abs(value - 0.5)); output.push(Math.abs(steady.push(value, index * 1000 / 60) - 0.5));
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(mean(output) < mean(input) * 0.4);
  const fixed = createAdaptiveFilter({ minCutoff: 1, beta: 0 }), adaptive = createAdaptiveFilter({ minCutoff: 1, beta: 12 });
  fixed.push(0, 0); adaptive.push(0, 0);
  assert.ok(adaptive.push(1, 80) > fixed.push(1, 80) + 0.25);
});

test("filtering comparable motion stays consistent across 15, 30 and 60 FPS", () => {
  function run(fps) {
    const filter = createAdaptiveFilter({ minCutoff: 4, beta: 12 });
    const values = [];
    for (let index = 0; index <= fps * 2; index++) {
      const seconds = index / fps;
      const value = filter.push(seconds * 0.2, seconds * 1000);
      if (index % (fps / 5) === 0) values.push(value);
    }
    return values;
  }
  const reference = run(60);
  for (const fps of [15, 30]) run(fps).forEach((value, index) => assert.ok(Math.abs(value - reference[index]) < 0.004, `${fps} FPS differed at ${index}: ${value} vs ${reference[index]}`));
});

test("filter delta follows elapsed time, and gaps/backwards/invalid input reseed instead of moving toward an old hand", () => {
  const quick = createAdaptiveFilter({ beta: 0 }), slow = createAdaptiveFilter({ beta: 0 });
  quick.push(0, 0); slow.push(0, 0);
  assert.ok(slow.push(1, 100) > quick.push(1, 20));
  assert.equal(quick.push(0.8, 500), 0.8);
  assert.equal(quick.push(0.3, 400), 0.3);
  assert.equal(quick.push(0.9, 400), 0.9);
  assert.equal(quick.push(NaN, 480), null);
  assert.equal(quick.push(0.7, 560), 0.7);
  assert.equal(quick.push(0.7, Infinity), null);
  assert.equal(quick.push(0.2, 600), 0.2);
  quick.reset(); assert.equal(quick.push(0.6, 700), 0.6);
  const robust = createAdaptiveFilter({ minCutoff: -1, beta: Infinity, derivativeCutoff: NaN, maxGapMs: -1 });
  assert.equal(robust.push(0.1, 0), 0.1); assert.ok(Number.isFinite(robust.push(0.2, 80)));
});

test("continuity rejects hand switches, position/scale jumps and non-monotonic frames, then starts a fresh baseline", () => {
  const cases = [
    [hand({ hand: "Left" }), 80], [hand({ y: 0.8 }), 80], [hand({ size: 0.4 }), 80],
    [hand({ size: 0.1 }), 80], [hand(), 351], [hand(), 0], [hand(), -1]
  ];
  for (const [sample, time] of cases) {
    const continuity = createHandContinuity();
    assert.equal(continuity.push(hand(), 0), false);
    assert.equal(continuity.push(sample, time), false);
    assert.equal(continuity.push(sample, time + 80), true);
  }
});

test("continuity uses only center/size/hand and preserves a private baseline across mutated samples", () => {
  const continuity = createHandContinuity();
  const sample = hand();
  assert.equal(continuity.push(sample, 0), false);
  sample.y = 0.9;
  assert.equal(continuity.push(hand({ score: 0.1, world: null, open: false }), 80), true);
  assert.equal(continuity.push(hand({ x: 0.51, size: 0.21, score: NaN }), 160), true);
  assert.equal(continuity.push(null, 240), false);
  assert.equal(continuity.push(hand(), 320), false);
  assert.equal(continuity.push(hand({ x: NaN }), 400), false);
  assert.equal(continuity.push(hand(), 480), false);
  assert.equal(continuity.push(hand(), Infinity), false);
  continuity.reset(); assert.equal(continuity.push(hand(), 560), false);
});

test("frame gate rejects old/duplicate/out-of-order captures and allows fresh recovery", () => {
  const gate = createFrameGate();
  assert.equal(gate.accept({ id: 0, timestamp: 0 }, 100), true);
  assert.equal(gate.accept({ id: 0, timestamp: 10 }, 110), false);
  assert.equal(gate.accept({ id: 1, timestamp: 10 }, 311), false);
  assert.equal(gate.accept({ id: 1, timestamp: 200 }, 220), false);
  assert.equal(gate.accept({ id: 2, timestamp: 400 }, 450), true);
  assert.equal(gate.accept({ id: 3, timestamp: 400 }, 450), false);
  assert.equal(gate.accept({ id: 4, timestamp: 390 }, 450), false);
  assert.equal(gate.accept({ id: 5, timestamp: 800 }, 790), false);
  assert.equal(gate.accept({ id: 6, timestamp: 500 }, 550), true);
  gate.reset(); assert.equal(gate.accept({ id: 0, timestamp: 0 }, 0), true);
});

test("frame freshness accepts its limit and refuses malformed metadata", () => {
  const gate = createFrameGate({ maxAgeMs: 200 });
  for (const frame of [null, {}, { id: 1.5, timestamp: 0 }, { id: -1, timestamp: 0 }, { id: Infinity, timestamp: 0 }, { id: 1, timestamp: NaN }, { id: 1, timestamp: -1 }]) assert.equal(gate.accept(frame, 100), false);
  assert.equal(gate.accept({ id: 1, timestamp: 0 }, NaN), false);
  assert.equal(gate.accept({ id: 1, timestamp: 0 }, -1), false);
  assert.equal(gate.accept({ id: 1, timestamp: 0 }, 200), true);
  assert.equal(gate.accept({ id: 2, timestamp: 1 }, 202), false);
});

test("video frames recover when a supported presentation callback never fires or stops firing", () => {
  const source = createVideoFrameSource();
  assert.deepEqual(source.read(0, null, 0), { key: 0, timestamp: 0 });
  assert.deepEqual(source.read(.08, null, 80), { key: .08, timestamp: 80 });
  const callback = { mediaTime: .16, timestamp: 160 };
  assert.deepEqual(source.read(.17, callback, 180), { key: .16, timestamp: 160 });
  assert.equal(source.read(.24, callback, 240), null);
  assert.deepEqual(source.read(.48, callback, 480), { key: .48, timestamp: 480 });
  assert.equal(source.read(.48, { mediaTime: .48, timestamp: 490 }, 500), null);
  assert.deepEqual(source.read(.56, { mediaTime: .56, timestamp: 560 }, 570), { key: .56, timestamp: 560 });
});

test("video clock fallback cannot replay a frozen frame or a delayed callback", () => {
  const source = createVideoFrameSource();
  assert.deepEqual(source.read(1, null, 100), { key: 1, timestamp: 100 });
  for (const now of [180, 500, 2000]) assert.equal(source.read(1, null, now), null);
  assert.equal(source.read(1, { mediaTime: .9, timestamp: 2100 }, 2100), null);
  assert.equal(source.read(.8, null, 2500), null);
  for (const value of [NaN, Infinity, -1]) assert.equal(source.read(value, null, 2600), null);
  assert.equal(source.read(2, null, NaN), null);
  source.reset();
  assert.deepEqual(source.read(0, null, 2700), { key: 0, timestamp: 2700 });
});
