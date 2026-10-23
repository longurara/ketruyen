const { test } = require("node:test");
const assert = require("node:assert/strict");
const { CALIBRATION_VERSION, sampleHand, preferences, createSwipeDetector, createPinchDetector, fitPinchCalibration, createPoseDetector, autoScrollSpeed, createPointer } = require("../public/hand-gestures");
const sample = (extra = {}) => ({ x: .5, y: .5, size: .2, hand: "Right", open: true, ...extra });
function landmarkHand(open = true) {
  const points = Array.from({ length: 21 }, () => ({ x: .5, y: .6 }));
  points[0] = { x: .5, y: .8 }; points[1] = { x: .46, y: .72 };
  points[2] = { x: .45, y: .65 }; points[3] = { x: .44, y: .61 }; points[4] = { x: .45, y: .63 };
  for (const [base, pip, dip, tip, x] of [[5, 6, 7, 8, .4], [9, 10, 11, 12, .5], [13, 14, 15, 16, .6], [17, 18, 19, 20, .7]]) {
    points[base] = { x, y: .6 }; points[pip] = { x, y: .5 };
    points[dip] = { x, y: open ? .4 : .55 }; points[tip] = { x, y: open ? .3 : .64 };
  }
  return points;
}
test("horizontal waves need a stable hand and do not accept vertical waves", () => {
  const d = createSwipeDetector(3, "x"); for (const time of [0, 80, 160]) d.push(sample(), time);
  assert.equal(d.push(sample({ x: .36 }), 320), 1);
  d.reset(); for (const time of [1400, 1480, 1560]) d.push(sample(), time);
  assert.equal(d.push(sample({ y: .35 }), 1720), 0);
});
test("personal calibration rejects shaky or indistinct poses and remains strict", () => {
  const fitted = fitPinchCalibration(Array(12).fill(.06), Array(12).fill(.6));
  assert.equal(fitted.version, CALIBRATION_VERSION); assert.equal(fitted.metric, "image2d");
  assert.ok(Math.abs(fitted.close - .1) < 1e-8); assert.ok(fitted.release > fitted.close);
  assert.equal(fitPinchCalibration(Array(12).fill(.3), Array(12).fill(.6)), null);
  assert.equal(fitPinchCalibration(Array(12).fill(.1), Array(12).fill(.2)), null);
  assert.equal(preferences({ calibration: { close: .7, release: .9 } }).calibration, null);
  const d = createPinchDetector(fitted); const p = sample({ pinch: { x: .5, y: .5, ratio: .13, usable: true } });
  assert.equal(d.push(p, 0).pinched, false); d.calibrate(null); assert.equal(d.push(p, 80).pinched, true);
});
test("thumbs-up, fist, open hand and index pointer are distinguishable in landmarks", () => {
  const points = landmarkHand(false);
  points[2] = { x: .45, y: .58 }; points[3] = { x: .45, y: .45 }; points[4] = { x: .45, y: .25 };
  assert.equal(sampleHand(points).thumbUp, true); assert.equal(sampleHand(points).fist, false);
  points[4] = { x: .45, y: .63 }; assert.equal(sampleHand(points).fist, true);
  points[7] = { x: .4, y: .4 }; points[8] = { x: .4, y: .3 }; assert.equal(sampleHand(points).pointing, true);
  for (const [dip, tip] of [[11, 12], [15, 16], [19, 20]]) { points[dip] = { ...points[dip], y: .4 }; points[tip] = { ...points[tip], y: .3 }; }
  assert.equal(sampleHand(points).open, true); assert.equal(sampleHand(points).pointing, false);
});
test("pinch geometry accounts for camera aspect without treating estimated depth as fingertip separation", () => {
  const points = landmarkHand(); points[4] = { x: .4275, y: .3 };
  assert.ok(sampleHand(points).pinch.ratio < .16);
  const corrected = sampleHand(points, "Right", { width: 640, height: 480 });
  assert.ok(Math.abs(corrected.pinch.ratio - .1833333333333333) < 1e-9);
  assert.equal(corrected.size, sampleHand(points).size);
  assert.equal(corrected.pinch.metric, "image2d");
  assert.equal(sampleHand(points, "Right", { width: NaN, height: 0 }).pinch.ratio, sampleHand(points).pinch.ratio);
  const deep = points.map((p) => ({ ...p, z: 0 })); deep[4].z = -.2; deep[8].z = .2;
  const depthSample = sampleHand(deep, "Right", { width: 640, height: 480 });
  assert.equal(depthSample.pinch.metric, "image2d"); assert.equal(depthSample.pinch.ratio, corrected.pinch.ratio);
  const world = deep.map((p) => ({ x: (p.x - .5) * .3, y: (p.y - .6) * .3, z: p.z * .3 }));
  const worldSample = sampleHand(points, "Right", { width: 640, height: 480, worldLandmarks: world });
  assert.equal(worldSample.pinch.metric, "image2d"); assert.equal(worldSample.pinch.ratio, corrected.pinch.ratio);
  assert.equal(worldSample.size, corrected.size);
  assert.equal(sampleHand(deep, "Right", { worldLandmarks: world.map(() => ({ x: 0, y: 0, z: 0 })) }).pinch.metric, "image2d");
  world[7].z = NaN;
  assert.equal(sampleHand(deep, "Right", { worldLandmarks: world }).pinch.metric, "image2d");
});

test("touching fingertips can grab, drag and release despite incorrect or disappearing depth estimates", () => {
  const points = landmarkHand().map((p) => ({ ...p, z: 0 }));
  points[4] = { x: .41, y: .3, z: -.2 };
  points[8].z = .2;
  const world = points.map((p) => ({ x: p.x * .3, y: p.y * .3, z: p.z * .3 }));
  const detector = createPinchDetector();
  for (const [time, worldLandmarks] of [[0, world], [80, null], [160, world]]) {
    const hand = sampleHand(points, "Right", { width: 640, height: 480, worldLandmarks });
    assert.equal(hand.pinch.usable, true);
    assert.ok(hand.pinch.ratio < .16);
    const result = detector.push(hand, time);
    assert.equal(result.pinched, true);
    assert.equal(result.dragging, time === 160);
  }
  const moved = points.map((p) => ({ ...p, y: p.y - .05 }));
  assert.ok(detector.push(sampleHand(moved, "Right", { width: 640, height: 480, worldLandmarks: world }), 240).delta > 0);
  moved[4].x = .6;
  assert.deepEqual(detector.push(sampleHand(moved, "Right", { width: 640, height: 480, worldLandmarks: world }), 320), { pinched: false, dragging: false, delta: 0 });
});
test("joint geometry rejects a bent open pose and accepts tilted thumbs-up but not thumbs-down", () => {
  const bent = landmarkHand();
  for (const [pip, dip, tip] of [[6, 7, 8], [10, 11, 12], [14, 15, 16], [18, 19, 20]]) {
    bent[dip] = { x: bent[pip].x + .075, y: .475 }; bent[tip] = { x: bent[pip].x + .15, y: .45 };
  }
  assert.equal(sampleHand(bent).open, false); assert.equal(sampleHand(bent).fist, false);
  const thumb = landmarkHand(false); thumb[2] = { x: .45, y: .58 }; thumb[3] = { x: .45, y: .45 }; thumb[4] = { x: .45, y: .25 };
  const rotate = (degrees) => thumb.map((p) => {
    const angle = degrees * Math.PI / 180, x = p.x - .5, y = p.y - .6;
    return { x: .5 + x * Math.cos(angle) - y * Math.sin(angle), y: .6 + x * Math.sin(angle) + y * Math.cos(angle) };
  });
  for (const angle of [-60, -30, 0, 30, 60]) assert.equal(sampleHand(rotate(angle)).thumbUp, true);
  for (const angle of [90, 180]) assert.equal(sampleHand(rotate(angle)).thumbUp, false);
  const nonFlat = landmarkHand().map((p) => ({ ...p, z: 0 }));
  for (const [pip, dip, tip] of [[6, 7, 8], [10, 11, 12], [14, 15, 16], [18, 19, 20]]) {
    nonFlat[pip].z = -.02; nonFlat[dip].z = -.04; nonFlat[tip].z = -.06;
  }
  assert.equal(sampleHand(nonFlat).open, true);
});
test("calibration version and geometry metric prevent reuse of old distance thresholds", () => {
  const values = { close: .1, release: .2 };
  assert.equal(preferences({ calibration: values }).calibration, null);
  assert.equal(preferences({ calibration: { ...values, version: CALIBRATION_VERSION - 1, metric: "image2d" } }).calibration, null);
  assert.equal(preferences({ calibration: { ...values, version: CALIBRATION_VERSION, metric: "unknown" } }).calibration, null);
  for (const metric of ["world3d", "image3d"]) {
    assert.equal(preferences({ calibration: { ...values, version: CALIBRATION_VERSION, metric } }).calibration, null);
    assert.equal(fitPinchCalibration(Array(12).fill(.06), Array(12).fill(.6), { metric }), null);
  }
  const valid = { ...values, version: CALIBRATION_VERSION, metric: "image2d" };
  assert.deepEqual(preferences({ calibration: valid }).calibration, valid);
  assert.equal(fitPinchCalibration(Array(12).fill(.06), Array(12).fill(.6), { metric: "invalid" }), null);
});
test("calibration never succeeds with thresholds that reject its own closed/open samples", () => {
  assert.equal(fitPinchCalibration(Array(12).fill(.24), Array(12).fill(.6)), null);
  assert.equal(fitPinchCalibration(Array.from({ length: 12 }, (_, i) => i % 2 ? .2 : .02), Array(12).fill(.6)), null);
  for (const ratio of [.02, .06, .1, .16, .19, .205]) {
    const closed = Array(12).fill(ratio), opened = Array(12).fill(.6);
    const fitted = fitPinchCalibration(closed, opened, { metric: "image2d" });
    assert.ok(fitted); assert.ok(closed.every((value) => value < fitted.close)); assert.ok(opened.every((value) => value > fitted.release));
    assert.equal(fitted.metric, "image2d");
  }
});
test("held poses trigger once, reject moving hands and can re-arm after release", () => {
  const d = createPoseDetector(); let events = [];
  for (let t = 0; t < 3000; t += 80) { const event = d.push(sample({ open: false, thumbUp: true }), t); if (event) events.push(event); }
  assert.deepEqual(events, ["bookmark"]); d.push(null, 3100);
  for (let t = 3200; t < 4100; t += 80) { const event = d.push(sample({ open: false, fist: true }), t); if (event) events.push(event); }
  assert.deepEqual(events, ["bookmark", "pause"]);
  d.reset(); for (let t = 0; t < 1500; t += 80) assert.equal(d.push(sample({ thumbUp: true, x: .2 + t / 4000 }), t), "");
});
test("auto-scroll has a neutral zone, signed capped speed and stops when the hand closes", () => {
  assert.equal(autoScrollSpeed(sample({ y: .54 })), 0);
  assert.equal(autoScrollSpeed(sample({ y: .9 }), 300), 300);
  assert.equal(autoScrollSpeed(sample({ y: .1 }), 300), -300);
  assert.equal(autoScrollSpeed(sample({ y: .8, open: false })), 0);
});
test("virtual pointer requires dwell and confirms only one click per held pinch", () => {
  let clicks = 0, shown = null; const target = {};
  const d = createPointer({ width: () => 1000, height: () => 800, target: () => target, render: (p) => { shown = p; }, click: () => clicks++ });
  const p = sample({ pointing: true, pointer: { x: .6, y: .4 } });
  d.push(p, { pinched: false }, 0); assert.ok(shown.x < 500);
  d.push(p, { pinched: true, dragging: true }, 200); assert.equal(clicks, 0);
  d.push(p, { pinched: false }, 300); d.push(p, { pinched: true, dragging: true }, 600); assert.equal(clicks, 1);
  d.push(p, { pinched: true, dragging: true }, 1000); assert.equal(clicks, 1);
  d.push(null, { pinched: false }, 1100); assert.equal(shown, null);
});
