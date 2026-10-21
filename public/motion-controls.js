(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MotionControls = api;
})(globalThis, function () {
  "use strict";
  const KEY = "tenshi-motion-v1";
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const angleDelta = (a, b) => ((a - b + 540) % 360) - 180;
  function preferences(value) {
    return { mode: ["scroll", "page", "off"].includes(value?.mode) ? value.mode : "scroll",
      sensitivity: clamp(Number(value?.sensitivity) || 3, 1, 5), speed: clamp(Number(value?.speed) || 180, 40, 600),
      bookmark: value?.bookmark !== false, faceDown: value?.faceDown !== false,
      extend: value?.extend !== false, minutes: [5, 10, 15, 30].includes(Number(value?.minutes)) ? Number(value.minutes) : 10,
      depth: value?.depth === true };
  }
  function axes(beta, gamma, angle = 0) {
    const r = angle * Math.PI / 180;
    return { pitch: beta * Math.cos(r) + gamma * Math.sin(r), roll: gamma * Math.cos(r) - beta * Math.sin(r),
      down: Math.cos(beta * Math.PI / 180) * Math.cos(gamma * Math.PI / 180) < -0.85 };
  }
  function createTiltDetector(value) {
    let prefs = preferences(value), base = null, filtered = null, last = null, stable = [], latched = false, neutralAt = null, faceAt = null, faceLatched = false;
    function reset() { base = filtered = last = null; stable = []; latched = false; neutralAt = faceAt = null; faceLatched = false; }
    function push(beta, gamma, angle, time) {
      const idle = { calibrating: true, velocity: 0, page: 0, pause: false, x: 0, y: 0 };
      if (![beta, gamma, angle, time].every(Number.isFinite)) return idle;
      if (last !== null && (time <= last || time - last > 600)) reset();
      const dt = last === null ? 0 : time - last; last = time;
      const raw = axes(beta, gamma, angle);
      const blend = 1 - Math.exp(-dt / 140);
      if (!filtered) filtered = raw;
      else filtered = { pitch: filtered.pitch + angleDelta(raw.pitch, filtered.pitch) * blend,
        roll: filtered.roll + angleDelta(raw.roll, filtered.roll) * blend, down: raw.down };
      if (raw.down) {
        if (faceAt === null) faceAt = time;
        if (!faceLatched && time - faceAt >= 850) { faceLatched = true; idle.pause = prefs.faceDown; }
        return idle;
      }
      faceAt = null; faceLatched = false;
      if (!base) {
        stable.push({ ...raw, time }); stable = stable.filter((p) => time - p.time <= 900);
        if (stable.length >= 4 && time - stable[0].time >= 650 &&
          stable.every((p) => Math.abs(angleDelta(p.pitch, raw.pitch)) < 3 && Math.abs(angleDelta(p.roll, raw.roll)) < 3)) {
          base = { pitch: raw.pitch, roll: raw.roll }; filtered = raw;
        }
        return idle;
      }
      const pitch = angleDelta(filtered.pitch, base.pitch), roll = angleDelta(filtered.roll, base.roll);
      const dead = 9 - prefs.sensitivity, threshold = 29 - prefs.sensitivity * 3;
      let page = 0;
      if (Math.abs(roll) < dead && Math.abs(pitch) < dead) {
        if (neutralAt === null) neutralAt = time;
        if (time - neutralAt >= 300) latched = false;
      } else neutralAt = null;
      if (!latched && Math.abs(roll) >= threshold && Math.abs(roll) > Math.abs(pitch) * 1.3) { page = Math.sign(roll); latched = true; }
      const velocity = Math.abs(pitch) <= dead ? 0 : Math.sign(pitch) * clamp((Math.abs(pitch) - dead) / 25, 0, 1) * prefs.speed;
      return { calibrating: false, velocity: prefs.mode === "scroll" ? velocity : 0,
        page: prefs.mode === "page" ? page : 0, pause: false, x: clamp(roll / 25, -1, 1), y: clamp(pitch / 25, -1, 1) };
    }
    return { push, reset, configure(value) { prefs = preferences(value); reset(); } };
  }
  function createShakeDetector(sensitivity = 3) {
    let gravity = null, previous = null, peaks = [], until = 0, lastPeak = -Infinity;
    function reset() { gravity = previous = null; peaks = []; lastPeak = -Infinity; }
    function push(event, time) {
      const direct = event.acceleration, source = direct && [direct.x, direct.y, direct.z].every(Number.isFinite) ? direct : event.accelerationIncludingGravity;
      if (!source || ![source.x, source.y, source.z, time].every(Number.isFinite)) { reset(); return false; }
      if (previous !== null && (time <= previous || time - previous > 350)) reset();
      const dt = previous === null ? 0 : time - previous; previous = time;
      const vector = [source.x, source.y, source.z];
      let linear = vector;
      if (source !== direct) {
        if (!gravity) { gravity = vector; return false; }
        const alpha = 1 - Math.exp(-dt / 300);
        gravity = gravity.map((g, i) => g + (vector[i] - g) * alpha);
        linear = vector.map((v, i) => v - gravity[i]);
      }
      if (time < until || time - lastPeak < 100) return false;
      const axis = linear.reduce((best, v, i) => Math.abs(v) > Math.abs(linear[best]) ? i : best, 0);
      if (Math.abs(linear[axis]) < 15 - clamp(sensitivity, 1, 5) * 1.4) return false;
      const sign = Math.sign(linear[axis]);
      peaks = peaks.filter((p) => time - p.time <= 800);
      if (peaks.length && (peaks.at(-1).axis !== axis || peaks.at(-1).sign === sign)) peaks = [];
      peaks.push({ axis, sign, time }); lastPeak = time;
      if (peaks.length < 3) return false;
      until = time + 2200; peaks = []; return true;
    }
    return { push, reset, configure(value) { sensitivity = value; reset(); } };
  }
  function shakeAction(prefs, listening) {
    if (prefs.extend && listening.playing && listening.remaining > 0 && listening.remaining <= 120000) return "extend";
    return prefs.bookmark ? "bookmark" : "";
  }
  function createAutoScroll(options) {
    let velocity = 0, frame = null, previous = null, actual = null, position = 0;
    function stop() { velocity = 0; previous = actual = null; if (frame !== null) options.cancelFrame(frame); frame = null; }
    function tick(time) {
      frame = null;
      if (!velocity || !options.canScroll()) { stop(); return; }
      const top = options.read();
      if (actual !== null && Math.abs(top - actual) > 3) { stop(); return; }
      if (previous !== null) {
        const next = clamp(position + velocity * Math.min(time - previous, 50) / 1000, 0, options.max());
        position = next;
        options.write(next); actual = options.read();
        if (next === 0 || next === options.max()) { stop(); return; }
      } else { actual = top; position = top; }
      previous = time; frame = options.requestFrame(tick);
    }
    return { stop, set(value) { velocity = Number.isFinite(value) ? value : 0; if (!velocity) stop(); else if (frame === null) frame = options.requestFrame(tick); } };
  }
  function create(options) {
    const $ = (s) => document.querySelector(s);
    let saved; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
    let prefs = preferences(saved), active = false, starting = false, generation = 0, timeout = null, watchdog = null;
    let orientationAt = 0, motionAt = 0, wasBlocked = false, paused = false, ignoreBefore = 0;
    const tilt = createTiltDetector(prefs), shake = createShakeDetector(prefs.sensitivity);
    $("#hand-camera-entry").insertAdjacentHTML("beforebegin", `<div class="settings-group motion-settings" id="motion-settings">
      <span class="settings-label">Điều khiển bằng chuyển động</span>
      <p class="settings-hint">Dành cho điện thoại có cảm biến. Giữ máy yên một nhịp để lấy tư thế cầm làm mốc. Mỗi lần đọc, bấm bật để sử dụng.</p>
      <p id="motion-status" role="status">Đang tắt.</p>
      <div class="tools-actions"><button id="motion-toggle" type="button" class="btn-secondary">Bật cảm biến</button><button id="motion-calibrate" type="button" class="btn-secondary" disabled>Lấy lại mốc / Tiếp tục</button></div>
      <label class="motion-field"><span>Chế độ nghiêng</span><select id="motion-mode"><option value="scroll">Nghiêng trước/sau để tự cuộn</option><option value="page">Nghiêng trái/phải để lật trang</option><option value="off">Tắt điều khiển bằng nghiêng</option></select></label>
      <label class="motion-field"><span>Độ nhạy</span><output id="motion-sensitivity-value" for="motion-sensitivity"></output><input id="motion-sensitivity" type="range" aria-label="Độ nhạy" min="1" max="5" step="1"></label>
      <label class="motion-field"><span>Tốc độ cuộn tối đa</span><output id="motion-speed-value" for="motion-speed"></output><input id="motion-speed" type="range" aria-label="Tốc độ cuộn tối đa" min="40" max="600" step="20"></label>
      <div class="motion-switches">
        <label class="motion-switch"><span>Lắc để lưu vị trí đọc<small>Có thể hoàn tác sau khi lưu.</small></span><input id="motion-bookmark" type="checkbox" role="switch"></label>
        <label class="motion-switch"><span>Úp máy để tạm dừng<small>Dừng nghe và tự cuộn.</small></span><input id="motion-face-down" type="checkbox" role="switch"></label>
        <label class="motion-switch"><span>Lắc để gia hạn hẹn giờ<small>Khi đang nghe và còn dưới 2 phút.</small></span><input id="motion-extend" type="checkbox" role="switch"></label>
      </div>
      <label class="motion-field"><span>Thời gian gia hạn</span><select id="motion-minutes"><option value="5">5 phút</option><option value="10">10 phút</option><option value="15">15 phút</option><option value="30">30 phút</option></select></label>
      <div class="motion-switches">
        <label class="motion-switch"><span>Chiều sâu cho minh họa<small>Ảnh chuyển động nhẹ theo hướng máy.</small></span><input id="motion-depth" type="checkbox" role="switch"></label>
      </div>
      <p class="settings-hint">Đưa máy về mốc để dừng cuộn hoặc chuẩn bị lật trang tiếp. Lắc qua lại rõ 3 nhịp để đánh dấu. Tự dừng khi chọn chữ, mở bảng cài đặt hoặc chuyển ứng dụng; âm thanh không tự phát lại khi ngửa máy.</p></div>`);
    document.body.insertAdjacentHTML("beforeend", '<button id="motion-active" class="motion-active" type="button" hidden aria-label="Tắt điều khiển bằng chuyển động">Cảm biến đang bật · Tắt</button>');
    const status = $("#motion-status"), toggle = $("#motion-toggle"), badge = $("#motion-active");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    function message(text) { status.textContent = text; }
    function clearDepth() { document.querySelectorAll(".motion-depth").forEach((el) => { el.classList.remove("motion-depth"); el.style.removeProperty("--motion-x"); el.style.removeProperty("--motion-y"); }); }
    function reset() { tilt.reset(); shake.reset(); options.velocity(0); clearDepth(); }
    function blocked() { return document.visibilityState !== "visible" || options.context().blocked || Boolean(String(window.getSelection?.() || "")); }
    function updateSlider(input) {
      const fraction = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
      input.style.setProperty("--motion-fill", `${clamp(fraction, 0, 1) * 100}%`);
      if (input.id === "motion-sensitivity") $("#motion-sensitivity-value").textContent = ["", "Thấp", "Hơi thấp", "Vừa", "Hơi cao", "Cao"][Number(input.value)];
      else $("#motion-speed-value").textContent = `${input.value} px/giây`;
    }
    function refresh() {
      toggle.textContent = active || starting ? "Tắt cảm biến" : "Bật cảm biến";
      badge.hidden = !active; $("#motion-calibrate").disabled = !active;
      $("#motion-mode").value = prefs.mode; $("#motion-sensitivity").value = prefs.sensitivity; $("#motion-speed").value = prefs.speed;
      updateSlider($("#motion-sensitivity")); updateSlider($("#motion-speed"));
      for (const [key, id] of [["bookmark", "bookmark"], ["faceDown", "face-down"], ["extend", "extend"], ["depth", "depth"]]) $("#motion-" + id).checked = prefs[key];
      $("#motion-minutes").value = prefs.minutes;
    }
    function stop(text = "Đang tắt.") {
      generation++; active = starting = false; clearTimeout(timeout); clearInterval(watchdog);
      window.removeEventListener("deviceorientation", orientation); window.removeEventListener("devicemotion", motion);
      reset(); paused = false; message(text); refresh();
    }
    function orientation(event) {
      if (!active || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
      const now = performance.now(); orientationAt = now;
      // Calibration can run inside settings; it never performs reader actions there.
      if (blocked()) { if (!wasBlocked) reset(); wasBlocked = true; tilt.push(event.beta, event.gamma, screen.orientation?.angle || window.orientation || 0, now); options.velocity(0); return; }
      if (wasBlocked) { reset(); wasBlocked = false; }
      if (now < ignoreBefore) return;
      const result = tilt.push(event.beta, event.gamma, screen.orientation?.angle || window.orientation || 0, now);
      if (result.pause) { options.pause(); options.velocity(0); paused = true; message("Đã dừng khi úp máy. Bấm Lấy lại mốc / Tiếp tục để cuộn lại."); }
      if (paused) return;
      options.velocity(result.velocity);
      if (result.page) options.page(result.page);
      if (prefs.depth && !reduced.matches && !result.calibrating) document.querySelectorAll('.reader-frame img, #reader-volume-cover img').forEach((el) => {
        el.classList.add("motion-depth"); el.style.setProperty("--motion-x", `${result.x * 4}px`); el.style.setProperty("--motion-y", `${result.y * 4}px`);
      }); else clearDepth();
      message(result.calibrating ? "Giữ máy yên để lấy mốc…" : "Đang bật · Đưa máy về tư thế ban đầu để dừng cuộn.");
    }
    function motion(event) {
      if (!active) return;
      const direct = event.acceleration;
      const vector = direct && [direct.x, direct.y, direct.z].every(Number.isFinite) ? direct : event.accelerationIncludingGravity;
      if (!vector || ![vector.x, vector.y, vector.z].every(Number.isFinite)) return;
      const now = performance.now(); motionAt = now;
      if (blocked() || now < ignoreBefore) { shake.reset(); return; }
      if (!shake.push(event, now)) return;
      const action = shakeAction(prefs, options.listening());
      if (action === "extend") options.extend(prefs.minutes);
      else if (action === "bookmark") options.bookmark();
    }
    async function start() {
      if (active || starting) { stop(); return; }
      if (options.context().view !== "reader") { message("Mở một chương trước khi bật cảm biến."); return; }
      if (!window.isSecureContext) { message("Cảm biến cần địa chỉ HTTPS."); return; }
      const apis = [window.DeviceOrientationEvent, window.DeviceMotionEvent].filter(Boolean);
      if (!apis.length) { message("Thiết bị hoặc trình duyệt không hỗ trợ cảm biến chuyển động."); return; }
      const session = ++generation; starting = true; message("Đang xin quyền cảm biến…"); refresh();
      try {
        // Call both APIs during the same click, before awaiting permission.
        const grants = await Promise.all(apis.map((api) => typeof api.requestPermission === "function" ? api.requestPermission() : "granted"));
        if (session !== generation) return;
        if (grants.some((grant) => grant !== "granted")) { stop("Quyền cảm biến bị từ chối. Cho phép trong trình duyệt rồi thử lại."); return; }
        if (document.visibilityState !== "visible" || options.context().view !== "reader") { stop(); return; }
        active = true; starting = false; orientationAt = motionAt = 0; paused = false; wasBlocked = false; ignoreBefore = performance.now() + 1000; reset();
        window.addEventListener("deviceorientation", orientation); window.addEventListener("devicemotion", motion);
        timeout = setTimeout(() => {
          if (!orientationAt && !motionAt) stop("Không nhận được dữ liệu cảm biến. Thử trên điện thoại và kiểm tra quyền trình duyệt.");
          else if (!orientationAt) message("Chỉ nhận được cảm biến lắc; nghiêng/úp máy chưa khả dụng.");
          else if (!motionAt) message("Chỉ nhận được góc nghiêng; lắc chưa khả dụng.");
        }, 5000);
        watchdog = setInterval(() => { if (performance.now() - orientationAt > 500 || blocked()) options.velocity(0); }, 200);
        message("Giữ máy yên để lấy mốc. Đóng cài đặt để bắt đầu."); refresh();
      } catch (_) { if (session === generation) stop("Không truy cập được cảm biến. Kiểm tra quyền rồi bấm bật lại."); }
    }
    function calibrate() { if (!active) return; reset(); paused = false; ignoreBefore = performance.now() + 800; message("Giữ máy ở tư thế đọc để lấy lại mốc…"); }
    toggle.onclick = start; badge.onclick = () => stop(); $("#motion-calibrate").onclick = calibrate;
    $("#motion-settings").addEventListener("input", (event) => { if (event.target.matches('input[type="range"]')) updateSlider(event.target); });
    $("#motion-settings").addEventListener("change", (event) => {
      if (!event.target.matches("input,select")) return;
      prefs = preferences({ mode: $("#motion-mode").value, sensitivity: $("#motion-sensitivity").value, speed: $("#motion-speed").value,
        bookmark: $("#motion-bookmark").checked, faceDown: $("#motion-face-down").checked, extend: $("#motion-extend").checked,
        depth: $("#motion-depth").checked, minutes: $("#motion-minutes").value });
      tilt.configure(prefs); shake.configure(prefs.sensitivity); reset();
      try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) { options.message("Không lưu được cài đặt cảm biến."); }
      refresh();
    });
    reduced.addEventListener("change", clearDepth);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") stop("Đã tắt cảm biến khi chuyển ứng dụng. Bấm bật để tiếp tục."); });
    window.addEventListener("pagehide", () => stop());
    if (screen.orientation?.addEventListener) screen.orientation.addEventListener("change", calibrate);
    else window.addEventListener("orientationchange", calibrate);
    function manual() { if (active) { options.velocity(0); tilt.reset(); shake.reset(); ignoreBefore = performance.now() + 1000; } }
    window.addEventListener("touchstart", manual, { passive: true }); window.addEventListener("wheel", manual, { passive: true });
    refresh();
    return { onView() { if (options.context().view !== "reader") stop(); else if (active) calibrate(); }, stop };
  }
  return { preferences, axes, createTiltDetector, createShakeDetector, shakeAction, createAutoScroll, create };
});
