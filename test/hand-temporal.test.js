const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSwipeDetector, createPinchDetector, createPointer, fitPinchCalibration } = require("../public/hand-gestures");
const sample = (extra = {}) => ({ x: .5, y: .5, size: .2, hand: "Right", open: true, ...extra });

test("stable swipes arm at 5, 8 and 12.5 FPS without reducing evidence", () => {
  for (const interval of [200, 125, 80]) {
    for (const [axis, direction] of [["y", 1], ["x", -1]]) {
      const detector = createSwipeDetector(3, axis);
      for (let i = 0; i < 3; i++) assert.equal(detector.push(sample(), i * interval), 0);
      const movement = direction === 1 ? -.14 : .14;
      const result = detector.push(sample({ [axis]: .5 + movement }), 2 * interval + Math.max(160, interval));
      assert.equal(result, direction, `${axis} at ${1000 / interval} FPS`);
    }
    const unarmed = createSwipeDetector();
    assert.equal(unarmed.push(sample(), 0), 0);
    assert.equal(unarmed.push(sample(), interval), 0);
    assert.equal(unarmed.push(sample({ y: .36 }), interval * 2), 0);
  }
});

test("low FPS jitter, movement during confirmation and dropped tracking cannot trigger a swipe", () => {
  const detector = createSwipeDetector();
  for (let t = 0; t <= 1600; t += 200) assert.equal(detector.push(sample({ y: .5 + Math.sin(t) * .008 }), t), 0);
  detector.push(null, 1800);
  for (let t = 2000; t <= 2600; t += 200) assert.equal(detector.push(sample({ y: .7 - (t - 2000) / 2000 }), t), 0);
  detector.reset();
  for (const t of [3000, 3200, 3400]) detector.push(sample(), t);
  assert.equal(detector.push(sample({ y: .36 }), 3800), 0);
});

test("personal thresholds are only used with the metric that was calibrated", () => {
  const fitted = fitPinchCalibration(Array(12).fill(.06), Array(12).fill(.6), { metric: "image2d" });
  const detector = createPinchDetector(fitted);
  const pinch = (metric) => sample({ pinch: { x: .5, y: .5, ratio: .13, usable: true, metric } });
  assert.equal(detector.push(pinch("image2d"), 0).pinched, false);
  assert.equal(detector.push(pinch("world3d"), 80).pinched, true);
});

test("pointer filtering follows elapsed time across camera frame rates", () => {
  const positions = [];
  for (const fps of [5, 10, 20]) {
    let shown;
    const pointer = createPointer({ width: () => 1000, height: () => 800, target: () => null,
      render: (point) => { shown = point; }, click: () => assert.fail("No pinch was confirmed") });
    for (let i = 0; i <= fps; i++) {
      const time = i * 1000 / fps;
      pointer.push(sample({ pointing: true, pointer: { x: .6 - .2 * time / 1000, y: .4 } }), { pinched: false }, time);
    }
    positions.push(shown.x);
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) < 12, `FPS-dependent spread: ${positions}`);
});

test("opening fingers releases immediately instead of retaining filtered motion", () => {
  const detector = createPinchDetector();
  const p = (ratio, y = .5) => sample({ pinch: { x: .5, y, ratio, usable: true } });
  for (const t of [0, 80, 160]) detector.push(p(.1), t);
  assert.equal(detector.push(p(.1, .45), 240).dragging, true);
  assert.deepEqual(detector.push(p(.3, .4), 320), { pinched: false, dragging: false, delta: 0 });
  assert.equal(detector.push(p(.1, .4), 400).delta, 0);
});

test("motion filtering cannot hide a raw fingertip tracking jump", () => {
  const detector = createPinchDetector();
  const p = (y, rawY) => sample({ pinch: { x: .5, y, rawX: .5, rawY, ratio: .1, usable: true } });
  for (const time of [0, 80, 160]) detector.push(p(.5, .5), time);
  const moved = detector.push(p(.6, .9), 240);
  assert.equal(moved.dragging, false);
  assert.equal(moved.delta, 0);
});
