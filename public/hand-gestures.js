(function (root, factory) {
  const tracking = typeof module === "object" && module.exports ? require("./hand-tracking") : root.HandTracking;
  const calibrationTools = typeof module === "object" && module.exports ? require("./hand-calibration") : root.HandCalibration;
  const api = factory(tracking, calibrationTools);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HandGestures = api;
})(globalThis, function (tracking, calibrationTools) {
  "use strict";
  const STORAGE = "tenshi-hand-camera-v1";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const PINCH_CLOSE_RATIO = 0.16, PINCH_RELEASE_RATIO = 0.24, PINCH_HOLD_MS = 160;
  const CALIBRATION_VERSION = 3;
  const GEOMETRY_METRICS = ["image2d"];

  function preferences(value) {
    const calibration = value?.calibration;
    const valid = calibration?.version === CALIBRATION_VERSION && GEOMETRY_METRICS.includes(calibration.metric) && Number.isFinite(calibration?.close) && Number.isFinite(calibration?.release) && calibration.close >= 0.07 && calibration.close <= 0.22 && calibration.release >= calibration.close + 0.04 && calibration.release <= 0.38;
    return { sensitivity: clamp(Math.round(Number(value?.sensitivity) || 3), 1, 5), amount: value?.amount === 1 ? 1 : 0.5,
      mode: ["drag", "swipe", "chapters", "auto", "pointer"].includes(value?.mode) ? value.mode : "drag",
      speed: clamp(Number(value?.speed) || 180, 40, 600), bookmark: value?.bookmark !== false, pause: value?.pause !== false,
      calibration: valid ? { version: CALIBRATION_VERSION, metric: calibration.metric, close: calibration.close, release: calibration.release } : null };
  }
  function sampleHand(points, hand = "", metadata = {}) {
    if (!Array.isArray(points) || points.length !== 21 || points.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) return null;
    const ratio = Number(metadata?.width) / Number(metadata?.height);
    const aspect = Number.isFinite(ratio) && ratio >= 0.25 && ratio <= 4 ? ratio : 1;
    const hasDepth = points.every((p) => Number.isFinite(p.z));
    // Image z has the same scale as normalized x. Express image geometry in
    // height units, while screen centers remain normalized for UI movement.
    const image = points.map((p) => ({ x: p.x * aspect, y: p.y, z: hasDepth ? p.z * aspect : 0 }));
    const distanceIn = (row, a, b) => Math.hypot(row[a].x - row[b].x, row[a].y - row[b].y, row[a].z - row[b].z);
    const fingers = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
    const world = metadata?.worldLandmarks;
    const worldValid = Array.isArray(world) && world.length === 21 && world.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.z)) &&
      distanceIn(world, 0, 9) > 1e-6 && [...fingers, [1, 2, 3, 4]].every((chain) => chain.slice(1).every((i, j) => distanceIn(world, chain[j], i) > 1e-6));
    const geometry = worldValid ? world : image;
    const distance = (a, b) => distanceIn(geometry, a, b);
    const imageDistance = (a, b) => Math.hypot(image[a].x - image[b].x, image[a].y - image[b].y);
    const size = imageDistance(0, 9);
    const palmSize = distance(0, 9);
    const center = [0, 5, 9, 13, 17].reduce((sum, i) => ({ x: sum.x + points[i].x / 5, y: sum.y + points[i].y / 5 }), { x: 0, y: 0 });
    if (size < 0.035 || size > 0.65 || palmSize < 1e-6 || center.x < 0.06 || center.x > 0.94 || center.y < 0.06 || center.y > 0.94) return null;
    const vector = (a, b) => ({ x: geometry[b].x - geometry[a].x, y: geometry[b].y - geometry[a].y, z: geometry[b].z - geometry[a].z });
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const length = (v) => Math.hypot(v.x, v.y, v.z);
    const angle = (a, b, c) => {
      const first = vector(b, a), second = vector(b, c), denominator = length(first) * length(second);
      return denominator < 1e-12 ? null : Math.acos(clamp(dot(first, second) / denominator, -1, 1)) * 180 / Math.PI;
    };
    const palmDirection = vector(0, 9);
    const alongPalm = (a, b) => dot(vector(a, b), palmDirection) / palmSize;
    const shapes = fingers.map(([base, pip, dip, tip]) => {
      const pipAngle = angle(base, pip, dip), dipAngle = angle(pip, dip, tip);
      const chainLength = distance(base, pip) + distance(pip, dip) + distance(dip, tip);
      const valid = pipAngle !== null && dipAngle !== null && chainLength > 1e-6;
      const extended = valid && pipAngle >= 150 && dipAngle >= 145 && distance(base, tip) / chainLength >= 0.86 && alongPalm(base, tip) > palmSize * 0.25;
      const curled = valid && !extended && Math.min(pipAngle, dipAngle) < 135 && distance(base, tip) < palmSize * 0.75;
      return { extended, curled };
    });
    const extended = shapes.map((shape) => shape.extended);
    const open = extended.filter(Boolean).length >= 3;
    // The close/release thresholds were tuned for visible fingertip separation.
    // Estimated depth can separate touching fingertips drastically, especially
    // when they occlude one another. Keep pinch geometry in aspect-corrected 2D;
    // joint poses may still use the estimated 3D geometry above.
    const pinch = { x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2,
      ratio: imageDistance(4, 8) / size, metric: "image2d", usable: imageDistance(0, 8) > size * 0.9 && imageDistance(0, 4) > size * 0.75 };
    const curled = shapes.every((shape) => shape.curled);
    const thumbAngle = angle(2, 3, 4), thumbLength = distance(2, 3) + distance(3, 4);
    const thumbUp = curled && thumbAngle !== null && thumbAngle >= 150 && thumbLength > 1e-6 && distance(2, 4) / thumbLength >= 0.88 &&
      alongPalm(2, 4) > distance(2, 4) * 0.55 && distance(0, 4) > palmSize * 1.25 && image[4].y < image[2].y - size * 0.2;
    const fist = curled && !thumbUp && (distance(4, 9) < palmSize * 0.9 || distance(0, 4) < palmSize * 1.25);
    return { ...center, size, open, hand, pinch, thumbUp, fist, pointing: extended[0] && extended.slice(1).every((v) => !v), pointer: points[8] };
  }

  // A stable, visible hand must arm each swipe. Cooldown + re-arming prevents
  // its return movement from becoming an accidental swipe in the other direction.
  function createSwipeDetector(sensitivity = 3, axis = "y") {
    let trail = [], armed = false, until = 0, previous = null, interval = 80;
    function reset() { trail = []; armed = false; previous = null; }
    function push(sample, time) {
      if (!sample?.open || !Number.isFinite(time)) { reset(); return 0; }
      if (previous && (time <= previous.time || time - previous.time > 250 || sample.hand !== previous.hand ||
        Math.hypot(sample.x - previous.x, sample.y - previous.y) > 0.3 || sample.size / previous.size > 1.55 || sample.size / previous.size < 0.65)) reset();
      interval = previous ? time - previous.time : 80;
      previous = { ...sample, time };
      if (time < until) { trail = []; armed = false; return 0; }
      trail.push({ ...sample, time });
      trail = trail.filter((p) => time - p.time <= 650);
      if (!armed) {
        // Three observations also fit at 5–8 FPS; duration and stability still
        // guard against arming from a single frame or from the swipe itself.
        const stable = trail.filter((p) => time - p.time <= clamp(interval * 2 + 20, 220, 520));
        if (stable.length >= 3 && time - stable[0].time >= 140 &&
          Math.max(...stable.map((p) => p.y)) - Math.min(...stable.map((p) => p.y)) < 0.025 &&
          Math.max(...stable.map((p) => p.x)) - Math.min(...stable.map((p) => p.x)) < 0.035) {
          armed = true; trail = [stable[stable.length - 1]];
        }
        return 0;
      }
      const start = trail[0], dy = sample[axis] - start[axis], dx = sample[axis === "y" ? "x" : "y"] - start[axis === "y" ? "x" : "y"], elapsed = time - start.time;
      const threshold = Math.max(0.05, Math.min(0.18, sample.size * (0.85 - clamp(sensitivity, 1, 5) * 0.1)));
      if (elapsed >= 100 && elapsed <= 650 && Math.abs(dy) >= threshold && Math.abs(dy) > Math.abs(dx) * 1.6 && Math.abs(dy) / elapsed > 0.00012) {
        const direction = dy < 0 ? 1 : -1;
        until = time + 850; reset(); return direction;
      }
      return 0;
    }
    return { push, reset, setSensitivity(value) { sensitivity = clamp(value, 1, 5); reset(); } };
  }

  function createPinchDetector(calibration = null) {
    let previous = null, candidateAt = null, closeSamples = 0, dragging = false, anchorY = 0;
    function reset() { previous = null; candidateAt = null; closeSamples = 0; dragging = false; }
    function push(sample, time) {
      const idle = { pinched: false, dragging: false, delta: 0 };
      if (!sample?.pinch?.usable || !Number.isFinite(sample.pinch.ratio) || sample.pinch.ratio < 0 || !Number.isFinite(time)) { reset(); return idle; }
      if (previous && (time <= previous.time || time - previous.time > 300 || sample.hand !== previous.hand ||
        sample.pinch.metric !== previous.pinch.metric ||
        Math.hypot((sample.pinch.rawX ?? sample.pinch.x) - (previous.pinch.rawX ?? previous.pinch.x),
          (sample.pinch.rawY ?? sample.pinch.y) - (previous.pinch.rawY ?? previous.pinch.y)) > 0.18 ||
        sample.size / previous.size > 1.55 || sample.size / previous.size < 0.65)) reset();
      previous = { ...sample, time };
      // Require close fingertips throughout confirmation. A slightly wider release
      // threshold only applies after the grab, so it cannot arm a loose pinch.
      const fitted = !sample.pinch.metric || sample.pinch.metric === calibration?.metric ? calibration : null;
      if (sample.pinch.ratio > (dragging ? fitted?.release || PINCH_RELEASE_RATIO : fitted?.close || PINCH_CLOSE_RATIO)) { reset(); return idle; }
      if (candidateAt === null) {
        candidateAt = time; closeSamples = 1;
        return { pinched: true, dragging: false, delta: 0 };
      }
      if (!dragging) {
        closeSamples++;
        if (time - candidateAt < PINCH_HOLD_MS || closeSamples < 3) return { pinched: true, dragging: false, delta: 0 };
        // Start at confirmation, without scrolling movement made while closing.
        dragging = true; anchorY = sample.pinch.y;
        return { pinched: true, dragging: true, delta: 0 };
      }
      const delta = anchorY - sample.pinch.y;
      if (Math.abs(delta) < 0.004) return { pinched: true, dragging, delta: 0 };
      anchorY = sample.pinch.y;
      return { pinched: true, dragging, delta: clamp(delta, -0.12, 0.12) };
    }
    return { push, reset, calibrate(value) { calibration = preferences({ calibration: value }).calibration; reset(); } };
  }

  function fitPinchCalibration(closed, opened, { metric = "image2d" } = {}) {
    if (!GEOMETRY_METRICS.includes(metric)) return null;
    if (![closed, opened].every((row) => Array.isArray(row) && row.length >= 10 && row.every((n) => Number.isFinite(n) && n >= 0 && n <= 2))) return null;
    const percentile = (row, fraction) => {
      const sorted = [...row].sort((a, b) => a - b), index = fraction * (sorted.length - 1), low = Math.floor(index);
      return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
    };
    const close = percentile(closed, 0.95), open = percentile(opened, 0.05);
    if (close > 0.25 || open - close < 0.18 || [closed, opened].some((row) => Math.max(...row) - Math.min(...row) > 0.12)) return null;
    const threshold = clamp(close + 0.04, 0.07, 0.22);
    const release = clamp(threshold + Math.min(0.1, (open - close) / 3), threshold + 0.05, 0.38);
    // Every collected closed pose must fit, even after the safety cap. Don't
    // report success with a threshold below the very pose just calibrated.
    if (threshold < Math.max(...closed) + 0.015 || release > Math.min(...opened) - 0.02) return null;
    return { version: CALIBRATION_VERSION, metric, close: threshold, release };
  }
  function createPoseDetector() {
    let pose = "", since = 0, last = null, hand = "", fired = false, samples = 0, anchor = null;
    function reset() { pose = ""; last = null; fired = false; samples = 0; }
    function push(sample, time) {
      const next = sample?.thumbUp ? "bookmark" : sample?.fist ? "pause" : sample?.open ? "resume" : "";
      if (!next || !Number.isFinite(time)) { reset(); return ""; }
      if (next !== pose || sample.hand !== hand || last === null || time <= last || time - last > 300 ||
        (anchor && (Math.hypot(sample.x - anchor.x, sample.y - anchor.y) > 0.065 || sample.size / anchor.size > 1.35 || sample.size / anchor.size < 0.75))) {
        pose = next; hand = sample.hand; since = time; samples = 0; fired = false; anchor = sample;
      }
      last = time; samples++;
      if (!fired && samples >= 5 && time - since >= 700) { fired = true; return pose; }
      return "";
    }
    return { push, reset };
  }
  function autoScrollSpeed(sample, maximum = 180) {
    if (!sample?.open || !Number.isFinite(sample.y)) return 0;
    const offset = sample.y - 0.5;
    return Math.abs(offset) <= 0.08 ? 0 : Math.sign(offset) * clamp((Math.abs(offset) - 0.08) / 0.25, 0, 1) * maximum;
  }
  function createPointer(options) {
    let position = null, target = null, since = 0, clicked = false;
    const xFilter = tracking.createAdaptiveFilter({ minCutoff: 3, beta: 12 }), yFilter = tracking.createAdaptiveFilter({ minCutoff: 3, beta: 12 });
    function reset() { position = target = null; since = 0; clicked = false; xFilter.reset(); yFilter.reset(); options.render(null, null); }
    function push(sample, drag, time) {
      if (!sample || (!sample.pointing && !drag.pinched)) { reset(); return; }
      if (!drag.pinched) {
        clicked = false;
        const width = options.width(), height = options.height();
        position = { x: xFilter.push(clamp((1 - sample.pointer.x - 0.12) / 0.76, 0, 1), time) * width,
          y: yFilter.push(clamp((sample.pointer.y - 0.08) / 0.52, 0, 1), time) * height };
      }
      if (!position) return;
      const hit = options.target(position);
      if (hit !== target) { target = hit; since = time; }
      options.render(position, target);
      if (drag.dragging && !clicked) {
        clicked = true;
        if (target && time - since >= 350) options.click(target);
      }
    }
    return { push, reset };
  }

  function createSmoothScroll(options) {
    let target = null, position = null, frame = null, lastTime = null, lastWritten = null;
    function cancel() {
      if (frame !== null) options.cancelFrame(frame);
      target = position = frame = lastTime = lastWritten = null;
    }
    function step(time) {
      frame = null;
      if (target === null) return;
      if (!options.canScroll() || Math.abs(options.read() - lastWritten) > 2) { cancel(); return; }
      const elapsed = lastTime === null ? 16 : clamp(time - lastTime, 1, 64);
      lastTime = time; target = clamp(target, 0, options.max());
      // Keep a fractional position so small frames survive browser pixel rounding.
      position += (target - position) * (1 - Math.exp(-elapsed / 55));
      if (Math.abs(target - position) < 0.5) position = target;
      options.write(position); lastWritten = options.read();
      if (position === target) cancel();
      else frame = options.requestFrame(step);
    }
    function add(amount) {
      if (!Number.isFinite(amount) || !amount || !options.canScroll()) return;
      const actual = options.read();
      if (options.reducedMotion()) { cancel(); options.write(clamp(actual + amount, 0, options.max())); return; }
      if (target === null || Math.abs(actual - lastWritten) > 2) {
        cancel(); target = position = lastWritten = actual;
      }
      target = clamp(target + amount, 0, options.max());
      if (frame === null) frame = options.requestFrame(step);
    }
    return { add, cancel };
  }

  function create(options) {
    const $ = (selector) => document.querySelector(selector);
    let saved; try { saved = JSON.parse(localStorage.getItem(STORAGE)); } catch (_) {}
    let prefs = preferences(saved), swipe = createSwipeDetector(prefs.sensitivity), horizontal = createSwipeDetector(prefs.sensitivity, "x"), pinch = createPinchDetector(prefs.calibration);
    const poses = createPoseDetector();
    const continuity = tracking.createHandContinuity(), frameGate = tracking.createFrameGate({ maxAgeMs: 300 });
    const videoFrames = tracking.createVideoFrameSource({ maxAgeMs: 300 });
    const motionFilters = Object.fromEntries(["x", "y", "pinchX", "pinchY"].map((key) => [key, tracking.createAdaptiveFilter({ minCutoff: 4, beta: 12 })]));
    let metric = null, obsoleteCalibration = Boolean(saved?.calibration && !prefs.calibration);
    let pointer, paused = false, autoSince = null, bookmarkAt = -Infinity, calibration = null, calibrationTimer = null, lastResultAt = 0;
    function resetMovement() { swipe.reset(); horizontal.reset(); pinch.reset(); pointer?.reset(); autoSince = null; Object.values(motionFilters).forEach((filter) => filter.reset()); options.stopDrag(); options.autoScroll(0); }
    function resetGestures() { resetMovement(); poses.reset(); continuity.reset(); metric = null; }
    function smoothSample(sample, time) {
      if (!sample) return null;
      return { ...sample, x: motionFilters.x.push(sample.x, time), y: motionFilters.y.push(sample.y, time),
        pinch: { ...sample.pinch, rawX: sample.pinch.x, rawY: sample.pinch.y,
          x: motionFilters.pinchX.push(sample.pinch.x, time), y: motionFilters.pinchY.push(sample.pinch.y, time) } };
    }
    let stream = null, worker = null, generation = 0, timer = null, readyTimer = null, frameTimer = null;
    let videoFrameCallback = null, latestVideoFrame = null, nextFrameId = 0, inFlight = null, cameraMuted = false;
    let active = false, starting = false, frameBusy = false, blockedLast = false, ignoreBefore = 0, lastFeedback = 0;
    let finishReady = null;
    const desktopLayout = window.matchMedia("(min-width: 1081px)");
    const mobileDevice = Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const available = () => desktopLayout.matches && !mobileDevice;
    const sidebar = $(".reader-sidebar");
    const panel = document.createElement("section");
    panel.id = "hand-camera-panel"; panel.className = "hand-camera-panel"; panel.tabIndex = -1;
    panel.setAttribute("aria-labelledby", "hand-camera-title");
    panel.innerHTML = `<div class="hand-camera-heading"><h3 id="hand-camera-title">Điều khiển bằng tay <span class="beta-badge">Beta</span></h3><button id="hand-camera-stop" type="button" hidden>Tắt camera</button></div>
      <div class="hand-camera-preview" hidden><video id="hand-camera-video" autoplay muted playsinline aria-label="Khung webcam để căn bàn tay"></video><canvas id="hand-camera-overlay" aria-hidden="true"></canvas></div>
      <p id="hand-camera-status" role="status" aria-live="polite"></p>
      <button id="hand-camera-start" class="btn-primary" type="button">Bật camera</button>
      <button id="hand-camera-preview-toggle" type="button" aria-expanded="true" aria-controls="hand-camera-video" hidden>Thu gọn camera</button>
      <div class="hand-camera-actions"><button id="hand-camera-pause" type="button" disabled>Tạm dừng cử chỉ</button><button id="hand-camera-bookmark" type="button" disabled>Lưu vị trí</button></div>
      <div id="hand-camera-calibration" hidden><p id="hand-camera-calibration-status" role="status"></p><button id="hand-camera-calibration-next" type="button" hidden>Tiếp: mở hai ngón</button><button id="hand-camera-calibration-cancel" type="button">Hủy hiệu chỉnh</button></div>
      <details id="hand-camera-config"><summary>Cài đặt &amp; hướng dẫn</summary><div class="hand-camera-settings">
      <p>Đặt máy ổn định, đưa tay vào khung webcam.</p>
      <label>Chế độ điều khiển<select id="hand-camera-mode"><option value="drag">Chụm kéo + phất dọc</option><option value="swipe">Phất dọc để cuộn</option><option value="chapters">Phất ngang để chuyển chương</option><option value="auto">Tự cuộn theo vị trí tay</option><option value="pointer">Con trỏ bằng ngón trỏ</option></select></label>
      <p data-hand-modes="drag"><strong>Kéo trang:</strong> chụm sát đầu ngón cái và ngón trỏ, giữ một nhịp đến khi hiện vòng tròn xanh rồi kéo lên/xuống. Mở hai ngón để thả.</p>
      <p data-hand-modes="drag swipe"><strong>Phất tay:</strong> mở bàn tay, giữ một nhịp rồi phất lên để cuộn xuống, phất xuống để cuộn lên.</p>
      <label for="hand-camera-sensitivity" data-hand-modes="drag swipe chapters">Độ nhạy phất tay <output id="hand-camera-sensitivity-value"></output><input id="hand-camera-sensitivity" type="range" min="1" max="5" step="1"></label>
      <label for="hand-camera-amount" data-hand-modes="drag swipe">Khoảng cuộn<select id="hand-camera-amount"><option value="0.5">Nửa màn hình</option><option value="1">Một màn hình</option></select></label>
      <label data-hand-modes="auto">Tốc độ tự cuộn tối đa <output id="hand-camera-speed-value"></output><input id="hand-camera-speed" type="range" min="40" max="600" step="20"></label>
      <label class="hand-camera-check"><input id="hand-camera-bookmark-enabled" type="checkbox"> Giơ ngón cái để lưu vị trí</label>
      <label class="hand-camera-check"><input id="hand-camera-pause-enabled" type="checkbox"> Nắm tay để dừng, mở tay để tiếp tục</label>
      <p data-hand-modes="chapters"><strong>Chuyển chương:</strong> mở tay, giữ một nhịp rồi phất sang phải trong khung xem trước để tới chương sau, sang trái để về chương trước.</p>
      <p data-hand-modes="auto"><strong>Tự cuộn:</strong> mở tay ở giữa khung để dừng; đưa xuống để cuộn xuống, lên để cuộn lên. Càng xa giữa khung càng nhanh. Mất dấu tay sẽ dừng.</p>
      <p data-hand-modes="pointer"><strong>Con trỏ:</strong> chỉ duỗi ngón trỏ để trỏ vào nút đọc; giữ trên nút một nhịp rồi chụm ngón để bấm. Mở ngón trước lần bấm tiếp theo.</p>
      <p>Giơ ngón cái hoặc nắm/mở tay ổn định khoảng một giây để xác nhận. Các chế độ riêng tránh thao tác trùng nhau.</p>
      <button id="hand-camera-calibrate" type="button" disabled>Hiệu chỉnh ngón chụm / mở</button><button id="hand-camera-calibrate-reset" type="button">Dùng ngưỡng mặc định</button><p id="hand-camera-calibration-saved"></p>
      <p>Hình ảnh xử lý ngay trên máy, không lưu hoặc gửi đi. Bản Beta chỉ hỗ trợ máy tính.</p></div></details>`;
    // A Beta extra: it sits below the everyday reading controls and stays a
    // single compact row until the camera is switched on.
    sidebar.append(panel);
    const video = $("#hand-camera-video"), overlay = $("#hand-camera-overlay");
    const status = $("#hand-camera-status"), settings = $("#hand-camera-config"), preview = panel.querySelector(".hand-camera-preview");
    const startButton = $("#hand-camera-start"), stopButton = $("#hand-camera-stop"), previewToggle = $("#hand-camera-preview-toggle");
    const sensitivity = $("#hand-camera-sensitivity"), amount = $("#hand-camera-amount");
    document.body.insertAdjacentHTML("beforeend", '<div id="hand-camera-pointer" class="hand-camera-pointer" hidden aria-hidden="true"></div>');
    const cursor = $("#hand-camera-pointer"); let hovered = null;
    const pointerTargets = '#btn-reader-prev,#btn-reader-next,#btn-reader-list,#btn-reader-listen,#btn-reader-settings,#btn-settings,#btn-reader-tools,#listen-toggle,#listen-prev,#listen-next,#listen-close,#listen-sleep,#listen-rate,#hand-camera-stop,#hand-camera-pause,#hand-camera-bookmark,#btn-reader-top,#btn-prev-inline,#btn-next-inline,#app-toast button';
    pointer = createPointer({ width: () => window.innerWidth, height: () => window.innerHeight,
      target: (point) => { const el = document.elementFromPoint(point.x, point.y)?.closest(pointerTargets); return el && !el.disabled && el.getClientRects().length ? el : null; },
      render: (point, target) => { hovered?.classList.remove("hand-camera-hover"); hovered = target; hovered?.classList.add("hand-camera-hover"); cursor.hidden = !point; if (point) { cursor.style.left = `${point.x}px`; cursor.style.top = `${point.y}px`; } },
      click: (target) => { target.click(); lastFeedback = performance.now(); setStatus("Đã bấm nút bằng ngón chụm."); }
    });

    function setStatus(value) { if (status.textContent !== value) status.textContent = value; }
    function modePrompt() {
      return { drag: "Chụm ngón để kéo trang, hoặc mở tay và phất để cuộn.", swipe: "Mở tay, giữ một nhịp rồi phất dọc để cuộn.",
        chapters: "Mở tay, giữ một nhịp rồi phất ngang để chuyển chương.", auto: "Mở tay để tự cuộn · Giữa khung để dừng.",
        pointer: "Duỗi ngón trỏ để trỏ nút · Giữ một nhịp rồi chụm để bấm." }[prefs.mode];
    }
    function refresh() {
      const supported = available();
      panel.hidden = !supported;
      $("#hand-camera-entry").hidden = !supported;
      document.querySelectorAll("[data-hand-camera]").forEach((button) => { button.hidden = !supported; });
      sensitivity.value = prefs.sensitivity; amount.value = prefs.amount;
      $("#hand-camera-mode").value = prefs.mode; $("#hand-camera-speed").value = prefs.speed;
      panel.querySelectorAll("[data-hand-modes]").forEach((el) => { el.hidden = !el.dataset.handModes.split(" ").includes(prefs.mode); });
      $("#hand-camera-speed-value").textContent = `${prefs.speed} px/giây`;
      $("#hand-camera-bookmark-enabled").checked = prefs.bookmark; $("#hand-camera-pause-enabled").checked = prefs.pause;
      $("#hand-camera-pause").disabled = !active; $("#hand-camera-bookmark").disabled = !active;
      $("#hand-camera-pause").textContent = paused ? "Tiếp tục cử chỉ" : "Tạm dừng cử chỉ";
      $("#hand-camera-calibrate").disabled = !active || Boolean(calibration);
      $("#hand-camera-calibration-saved").textContent = prefs.calibration ? "Đang dùng hiệu chỉnh cá nhân." : obsoleteCalibration ? "Cách đo đã được cải thiện. Hãy hiệu chỉnh lại ngón chụm; hiện đang dùng ngưỡng mặc định." : "Đang dùng ngưỡng mặc định.";
      $("#hand-camera-sensitivity-value").textContent = ["", "Thấp", "Hơi thấp", "Vừa", "Hơi cao", "Cao"][prefs.sensitivity];
      startButton.disabled = starting || active;
      startButton.hidden = active;
      startButton.textContent = starting ? "Đang bật…" : "Bật camera";
      stopButton.hidden = !starting && !active;
      preview.hidden = !stream;
      previewToggle.hidden = !stream;
      panel.classList.toggle("is-idle", !starting && !active && !calibration);
    }
    function save() {
      const next = preferences({ ...prefs, sensitivity: Number(sensitivity.value), amount: Number(amount.value), mode: $("#hand-camera-mode").value,
        speed: Number($("#hand-camera-speed").value), bookmark: $("#hand-camera-bookmark-enabled").checked, pause: $("#hand-camera-pause-enabled").checked });
      cancelCalibration(); prefs = next;
      swipe.setSensitivity(prefs.sensitivity); horizontal.setSensitivity(prefs.sensitivity); resetGestures(); ignoreBefore = performance.now() + 600;
      try { localStorage.setItem(STORAGE, JSON.stringify(prefs)); } catch (_) { options.message("Không lưu được cài đặt điều khiển bằng tay."); }
      if (!paused) setStatus(modePrompt());
      refresh();
    }
    function show() {
      if (!available()) { options.message("Điều khiển bằng tay Beta chỉ hỗ trợ máy tính có thanh bên trái."); return; }
      if (options.context().view !== "reader") { options.message("Mở một chương để dùng điều khiển bằng tay ở thanh bên trái."); return; }
      options.closeSettings(); refresh();
      resetGestures();
      sidebar.scrollTop += panel.getBoundingClientRect().top - sidebar.getBoundingClientRect().top - 12;
      panel.focus({ preventScroll: true });
    }
    function stop(message = "Camera đã tắt.") {
      generation++; active = false; starting = false; frameBusy = false;
      clearTimeout(timer); clearTimeout(readyTimer); clearTimeout(frameTimer);
      if (videoFrameCallback !== null) video.cancelVideoFrameCallback?.(videoFrameCallback);
      videoFrameCallback = latestVideoFrame = inFlight = null; nextFrameId = 0; cameraMuted = false; frameGate.reset(); videoFrames.reset();
      if (finishReady) { finishReady(new Error("cancelled")); finishReady = null; }
      if (worker) { worker.terminate(); worker = null; }
      if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }
      video.pause(); video.srcObject = null;
      cancelCalibration(); paused = false; resetGestures(); setStatus(message); refresh();
    }
    function fail(message) { stop(message); options.message(message); }
    function blocked() {
      return options.context().blocked || (settings.open && !calibration) || Boolean(String(window.getSelection?.() || ""));
    }
    function cancelCalibration() { clearTimeout(calibrationTimer); calibration = null; $("#hand-camera-calibration").hidden = true; refresh(); }
    function calibrationTimeout() { clearTimeout(calibrationTimer); calibrationTimer = setTimeout(() => { cancelCalibration(); setStatus("Hiệu chỉnh hết thời gian. Đưa tay rõ vào khung rồi thử lại."); }, 20000); }
    function beginCalibration() {
      if (!active) return; paused = false; resetGestures(); calibration = calibrationTools.createCollector({ fit: fitPinchCalibration });
      $("#hand-camera-calibration").hidden = false; $("#hand-camera-calibration-next").hidden = true;
      $("#hand-camera-calibration-status").textContent = "Bước 1/2: chụm sát đầu ngón cái và ngón trỏ, giữ yên đến khi xác nhận (khoảng 1–2 giây).";
      calibrationTimeout(); refresh();
    }
    function collectCalibration(sample, time) {
      const result = calibration.push(sample, time);
      if (result.event === "restart") {
        $("#hand-camera-calibration-next").hidden = true;
        $("#hand-camera-calibration-status").textContent = "Tay hoặc cách đo đã thay đổi. Bước 1/2: chụm sát hai đầu ngón và giữ yên để đo lại.";
        return;
      }
      if (result.event === "closed") {
        $("#hand-camera-calibration-status").textContent = "Đã đo ngón chụm. Mở hai ngón rồi bấm Tiếp."; $("#hand-camera-calibration-next").hidden = false; calibrationTimeout();
      } else if (result.event === "done") {
        const fitted = result.fitted;
        prefs = preferences({ ...prefs, calibration: fitted }); pinch.calibrate(fitted); obsoleteCalibration = false;
        try { localStorage.setItem(STORAGE, JSON.stringify(prefs)); } catch (_) { options.message("Không lưu được hiệu chỉnh camera."); }
        cancelCalibration(); resetGestures(); ignoreBefore = time + 700; settings.open = false; setStatus("Đã hiệu chỉnh ngón chụm / mở theo tay của bạn.");
      }
    }
    function setPaused(value) { paused = value; resetMovement(); refresh(); if (!value) ignoreBefore = performance.now() + 600; setStatus(value ? "Đã tạm dừng · Mở bàn tay một giây để tiếp tục." : "Đã tiếp tục điều khiển bằng tay."); }
    function draw(points, grabbing = false) {
      const width = video.videoWidth || 640, height = video.videoHeight || 480;
      if (overlay.width !== width) overlay.width = width;
      if (overlay.height !== height) overlay.height = height;
      const context = overlay.getContext("2d"); context.clearRect(0, 0, width, height);
      if (!points) return;
      const xs = points.map((p) => (1 - p.x) * width), ys = points.map((p) => p.y * height);
      context.strokeStyle = "#73e1b3"; context.lineWidth = 3;
      context.strokeRect(Math.min(...xs) - 8, Math.min(...ys) - 8, Math.max(...xs) - Math.min(...xs) + 16, Math.max(...ys) - Math.min(...ys) + 16);
      if (grabbing) {
        context.beginPath(); context.arc((xs[4] + xs[8]) / 2, (ys[4] + ys[8]) / 2, 9, 0, Math.PI * 2); context.stroke();
      }
    }
    function receive(data, session) {
      if (session !== generation || data.type !== "result") return;
      // Only the matching reply releases the single frame in flight. Results
      // captured before a stall never resume scrolling or confirm a gesture.
      if (!inFlight || data.frameId !== inFlight.id || data.timestamp !== inFlight.timestamp) return;
      frameBusy = false; inFlight = null; clearTimeout(frameTimer);
      if (!active) return;
      if (options.context().view !== "reader") { stop(); return; }
      const now = performance.now();
      if (cameraMuted || !frameGate.accept({ id: data.frameId, timestamp: data.timestamp }, now)) {
        resetGestures(); draw(null);
        if (calibration) collectCalibration(null, now);
        setStatus("Hình camera đang chậm hoặc bị ngắt · Giữ tay ổn định để nhận diện lại."); return;
      }
      lastResultAt = now;
      const rawSample = sampleHand(data.landmarks, data.hand, { width: data.width, height: data.height, worldLandmarks: data.worldLandmarks });
      if (calibration && !options.context().blocked && !String(window.getSelection?.() || "")) {
        draw(data.landmarks); collectCalibration(rawSample, data.timestamp); if (calibration) setStatus("Đang hiệu chỉnh · Làm theo hướng dẫn ở thanh bên."); return;
      }
      if (blocked() || data.timestamp < ignoreBefore) {
        draw(data.landmarks);
        resetGestures(); blockedLast = true;
        setStatus("Tạm dừng khi mở bảng điều khiển hoặc chọn chữ."); return;
      }
      if (blockedLast) { resetGestures(); blockedLast = false; }
      if (!rawSample) {
        resetGestures(); draw(data.landmarks);
        setStatus(!data.landmarks ? "Camera đang nhận hình nhưng chưa thấy bàn tay · Đưa cả bàn tay vào nơi đủ sáng."
          : "Đã thấy tay · Đưa tay vào giữa khung và giữ cách camera vừa phải.");
        return;
      }
      const continuous = continuity.push(rawSample, data.timestamp);
      if (!continuous || rawSample?.pinch.metric !== metric) { resetMovement(); poses.reset(); }
      metric = rawSample?.pinch.metric ?? null;
      const sample = smoothSample(rawSample, data.timestamp);
      const pose = poses.push(sample, data.timestamp);
      if (pose === "pause" && prefs.pause && !paused) { setPaused(true); draw(data.landmarks); return; }
      if (pose === "resume" && prefs.pause && paused) { setPaused(false); draw(data.landmarks); return; }
      if (paused) { resetMovement(); draw(data.landmarks); setStatus("Đã tạm dừng · Mở bàn tay một giây để tiếp tục."); return; }
      if (pose === "bookmark" && prefs.bookmark && data.timestamp - bookmarkAt >= 2500) { bookmarkAt = data.timestamp; resetMovement(); const saved = options.bookmark(); lastFeedback = performance.now(); setStatus(saved ? "Đã lưu vị trí đọc · Có thể hoàn tác trong thông báo." : "Chưa lưu được vị trí. Kiểm tra thông báo."); return; }
      if (sample?.thumbUp || sample?.fist) { resetMovement(); draw(data.landmarks); return; }
      if (prefs.mode === "auto") {
        draw(data.landmarks); options.stopDrag();
        if (!sample?.open) { autoSince = null; options.autoScroll(0); }
        else { if (autoSince === null) autoSince = data.timestamp; options.autoScroll(data.timestamp - autoSince >= 350 ? autoScrollSpeed(sample, prefs.speed) : 0); }
        setStatus(!sample?.open ? "Mở tay để tự cuộn · Giữa khung để dừng." : "Di chuyển tay ↑ / ↓ để chỉnh hướng và tốc độ tự cuộn."); return;
      }
      options.autoScroll(0);
      const drag = prefs.mode === "drag" || prefs.mode === "pointer" ? pinch.push(sample, data.timestamp) : { pinched: false, dragging: false, delta: 0 };
      if (!drag.dragging) options.stopDrag();
      draw(data.landmarks, drag.dragging);
      if (prefs.mode === "pointer") { options.stopDrag(); pointer.push(sample, drag, data.timestamp); if (performance.now() - lastFeedback > 1000) setStatus("Duỗi ngón trỏ để trỏ nút · Giữ một nhịp rồi chụm để bấm."); return; }
      if (drag.pinched) {
        swipe.reset(); lastFeedback = -Infinity;
        if (drag.delta) options.drag(drag.delta);
        setStatus(drag.dragging ? "Đang giữ trang · Kéo tay ↑ / ↓ · Mở ngón để thả" : "Chụm sát hai đầu ngón và giữ một nhịp…");
        return;
      }
      const direction = prefs.mode === "chapters" ? horizontal.push(sample, data.timestamp) : swipe.push(sample, data.timestamp);
      if (direction) {
        if (prefs.mode === "chapters") options.chapter(direction); else options.scroll(direction, prefs.amount);
        lastFeedback = performance.now();
        setStatus(prefs.mode === "chapters" ? (direction > 0 ? "Đã yêu cầu chương sau" : "Đã yêu cầu chương trước") : direction > 0 ? "↓ Đã cuộn xuống" : "↑ Đã cuộn lên");
      } else if (performance.now() - lastFeedback > 1000) {
        setStatus(prefs.mode === "chapters" ? "Mở tay, giữ một nhịp rồi phất ngang để chuyển chương." : "Chụm ngón để kéo · Mở tay và phất để cuộn");
      }
    }
    function watchVideoFrames(session) {
      if (typeof video.requestVideoFrameCallback !== "function") return;
      videoFrameCallback = video.requestVideoFrameCallback((now, metadata) => {
        videoFrameCallback = null;
        if (!active || session !== generation) return;
        latestVideoFrame = { mediaTime: metadata.mediaTime, timestamp: now };
        watchVideoFrames(session);
      });
    }
    async function tick(session) {
      if (!active || session !== generation) return;
      if (options.context().view !== "reader" || document.visibilityState !== "visible") { stop(); return; }
      const now = performance.now();
      if (now - lastResultAt > 450) {
        resetGestures(); draw(null);
        if (calibration) collectCalibration(null, now);
      }
      if (cameraMuted) {
        resetGestures(); setStatus("Camera đang mất hình · Chờ kết nối lại.");
      } else if (blocked()) {
        resetGestures(); blockedLast = true;
        setStatus("Tạm dừng khi mở bảng điều khiển hoặc chọn chữ.");
      } else if (video.readyState >= 2 && !frameBusy) {
        const frame = videoFrames.read(video.currentTime, latestVideoFrame, now);
        if (!frame) {
          if (now - lastResultAt > 1500) setStatus("Camera chưa cung cấp hình mới · Thử tắt và bật lại camera.");
          timer = setTimeout(() => tick(session), 80); return;
        }
        const timestamp = frame.timestamp, id = ++nextFrameId;
        frameBusy = true;
        let bitmap;
        try {
          bitmap = await createImageBitmap(video);
          if (!active || session !== generation || blocked() || cameraMuted || performance.now() - timestamp > 300) { bitmap.close(); if (session === generation) frameBusy = false; }
          else {
            inFlight = { id, timestamp };
            worker.postMessage({ type: "frame", bitmap, timestamp, frameId: id }, [bitmap]);
            bitmap = null;
            frameTimer = setTimeout(() => { if (session === generation) fail("Nhận diện không phản hồi. Hãy thử bật lại camera."); }, 10000);
          }
        } catch (_) { bitmap?.close(); if (session === generation) fail("Không đọc được hình từ camera. Hãy thử lại trên Chrome hoặc Safari."); }
      }
      if (session === generation && active) timer = setTimeout(() => tick(session), 80);
    }
    async function start() {
      if (active || starting) return;
      if (!available()) { setStatus("Điều khiển bằng tay Beta chỉ hỗ trợ máy tính có thanh bên trái."); return; }
      if (options.context().view !== "reader") { setStatus("Mở một chương để bật điều khiển bằng tay."); return; }
      if (!window.isSecureContext) { setStatus("Camera cần kết nối HTTPS. Hãy mở địa chỉ HTTPS của trang."); return; }
      if (!navigator.mediaDevices?.getUserMedia || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
        setStatus("Trình duyệt chưa hỗ trợ tính năng này. Hãy thử Chrome hoặc Edge mới hơn."); return;
      }
      const session = ++generation; starting = true; refresh(); setStatus("Đang xin quyền camera…");
      try {
        const requested = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } } });
        if (session !== generation) { requested.getTracks().forEach((track) => track.stop()); return; }
        stream = requested;
        cameraMuted = stream.getVideoTracks().some((track) => track.muted);
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", () => { if (session === generation) stop("Camera đã ngắt. Bấm bật để kết nối lại."); });
          track.addEventListener("mute", () => {
            if (session !== generation) return;
            cameraMuted = true; latestVideoFrame = null; resetGestures(); draw(null);
            if (calibration) collectCalibration(null, performance.now());
          });
          track.addEventListener("unmute", () => {
            if (session !== generation) return;
            cameraMuted = stream.getVideoTracks().some((item) => item.muted);
            latestVideoFrame = null; videoFrames.reset(); resetGestures(); ignoreBefore = performance.now() + 300;
          });
        });
        video.srcObject = stream; video.muted = true; panel.classList.remove("is-compact");
        previewToggle.textContent = "Thu gọn camera"; previewToggle.setAttribute("aria-expanded", "true");
        refresh();
        setStatus("Đang chuẩn bị nhận diện bàn tay…");
        await video.play();
        if (session !== generation) return;
        worker = new Worker(new URL("hand-camera-worker.js", document.baseURI), { type: "module" });
        await new Promise((resolve, reject) => {
          finishReady = (error) => { clearTimeout(readyTimer); finishReady = null; error ? reject(error) : resolve(); };
          readyTimer = setTimeout(() => finishReady?.(new Error("model")), 45000);
          worker.onmessage = ({ data }) => {
            if (session !== generation) return;
            if (data.type === "ready") finishReady?.();
            else if (data.type === "error") {
              if (finishReady) finishReady(new Error("model"));
              else fail("Không nhận diện được bàn tay. Hãy thử bật lại camera.");
            } else receive(data, session);
          };
          worker.onerror = () => {
            if (session !== generation) return;
            if (finishReady) finishReady(new Error("model"));
            else fail("Nhận diện đã dừng. Hãy thử bật lại camera.");
          };
          worker.postMessage({ type: "init" });
        });
        if (session !== generation) return;
        starting = false; active = true; paused = false; blockedLast = false; lastResultAt = performance.now(); frameGate.reset(); videoFrames.reset(); resetGestures(); refresh();
        settings.open = false;
        setStatus("Đưa bàn tay vào khung camera."); watchVideoFrames(session); tick(session);
      } catch (error) {
        if (session !== generation) return;
        const message = error.name === "NotAllowedError" ? "Chưa được cấp quyền camera. Cho phép camera trong trình duyệt rồi thử lại."
          : error.name === "NotFoundError" ? "Không tìm thấy camera trên thiết bị."
          : error.name === "NotReadableError" ? "Camera đang bận hoặc không mở được. Đóng ứng dụng đang dùng camera rồi thử lại."
          : "Không bật được nhận diện. Kiểm tra kết nối lần đầu hoặc thử Chrome/Edge mới hơn.";
        stop(message);
      }
    }
    startButton.onclick = start;
    stopButton.onclick = () => stop();
    $("#btn-hand-camera-settings").onclick = show;
    previewToggle.onclick = () => {
      const compact = panel.classList.toggle("is-compact");
      previewToggle.textContent = compact ? "Hiện camera" : "Thu gọn camera";
      previewToggle.setAttribute("aria-expanded", String(!compact));
    };
    settings.addEventListener("toggle", () => { resetGestures(); ignoreBefore = performance.now() + 300; });
    sensitivity.oninput = save; amount.onchange = save;
    for (const id of ["mode", "speed", "bookmark-enabled", "pause-enabled"]) $("#hand-camera-" + id).onchange = save;
    $("#hand-camera-pause").onclick = () => setPaused(!paused); $("#hand-camera-bookmark").onclick = () => options.bookmark();
    $("#hand-camera-calibrate").onclick = beginCalibration;
    $("#hand-camera-calibration-cancel").onclick = () => { cancelCalibration(); resetGestures(); setStatus("Đã hủy hiệu chỉnh."); };
    $("#hand-camera-calibration-next").onclick = () => { if (calibration?.stage !== "waiting") return; calibration.next(); $("#hand-camera-calibration-next").hidden = true; $("#hand-camera-calibration-status").textContent = "Bước 2/2: giữ cùng bàn tay, mở rõ hai ngón đến khi xác nhận (khoảng 1–2 giây)."; calibrationTimeout(); };
    $("#hand-camera-calibrate-reset").onclick = () => { cancelCalibration(); prefs.calibration = null; obsoleteCalibration = false; pinch.calibrate(null); resetGestures(); try { localStorage.setItem(STORAGE, JSON.stringify(prefs)); } catch (_) { options.message("Không lưu được cài đặt camera."); } refresh(); };
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-hand-camera]");
      if (!button) return;
      button.closest("dialog")?.close();
      show();
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible" && (active || starting)) stop("Camera đã tắt khi chuyển ứng dụng. Bật lại để tiếp tục."); });
    window.addEventListener("pagehide", () => stop());
    window.addEventListener("orientationchange", () => { resetGestures(); ignoreBefore = performance.now() + 900; });
    function manualScroll() { if (active) { resetGestures(); ignoreBefore = performance.now() + 400; } }
    window.addEventListener("wheel", manualScroll, { passive: true });
    document.addEventListener("pointerdown", manualScroll, { passive: true });
    document.addEventListener("keydown", (event) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) manualScroll(); });
    desktopLayout.addEventListener("change", () => {
      if (!available() && (active || starting)) stop("Camera đã tắt khi chuyển sang giao diện nhỏ.");
      refresh();
    });
    setStatus(modePrompt());
    refresh();
    return { onView() { resetGestures(); ignoreBefore = performance.now() + 300; if (options.context().view !== "reader") { stop(); settings.open = false; } refresh(); }, isOpen: () => options.context().view === "reader" && !panel.hidden && settings.open, isBlocked: blocked };
  }
  return { CALIBRATION_VERSION, preferences, sampleHand, createSwipeDetector, createPinchDetector, fitPinchCalibration, createPoseDetector, autoScrollSpeed, createPointer, createSmoothScroll, create };
});
