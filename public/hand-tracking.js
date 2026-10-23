(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HandTracking = api;
})(globalThis, function () {
  "use strict";
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

  function createAdaptiveFilter(options = {}) {
    const minCutoff = positive(options.minCutoff, 1.5);
    const beta = Number.isFinite(options.beta) && options.beta >= 0 ? options.beta : 1;
    const derivativeCutoff = positive(options.derivativeCutoff, 1);
    const maxGapMs = positive(options.maxGapMs, 350);
    let previous = null, filtered = null, derivative = 0, lastTime = null;
    const alpha = (cutoff, seconds) => 1 / (1 + 1 / (2 * Math.PI * cutoff * seconds));
    function reset() { previous = filtered = lastTime = null; derivative = 0; }
    function seed(value, time) { previous = filtered = value; lastTime = time; derivative = 0; return value; }
    function push(value, timeMs) {
      if (!Number.isFinite(value) || !Number.isFinite(timeMs)) { reset(); return null; }
      const elapsed = timeMs - lastTime;
      if (lastTime === null || !Number.isFinite(elapsed) || elapsed <= 0 || elapsed > maxGapMs) return seed(value, timeMs);
      const seconds = elapsed / 1000, velocity = (value - previous) / seconds;
      if (!Number.isFinite(velocity)) return seed(value, timeMs);
      // Speed-dependent low-pass filtering: https://gery.casiez.net/1euro/
      // A low cutoff suppresses tremor; speed raises it to follow motion.
      // Both filters use the actual frame interval.
      const derivativeAlpha = alpha(derivativeCutoff, seconds);
      derivative = derivativeAlpha * velocity + (1 - derivativeAlpha) * derivative;
      const valueAlpha = alpha(minCutoff + beta * Math.abs(derivative), seconds);
      filtered = valueAlpha * value + (1 - valueAlpha) * filtered;
      previous = value; lastTime = timeMs;
      return filtered;
    }
    return { push, reset };
  }

  function createHandContinuity(options = {}) {
    const maxGapMs = positive(options.maxGapMs, 350), maxJump = positive(options.maxJump, 0.18);
    const minSizeRatio = Math.min(1, positive(options.minSizeRatio, 0.65));
    const maxSizeRatio = Math.max(1, positive(options.maxSizeRatio, 1.55));
    let previous = null;
    function reset() { previous = null; }
    function push(sample, timeMs) {
      if (!sample || !Number.isFinite(timeMs) || !Number.isFinite(sample.x) || !Number.isFinite(sample.y) || !Number.isFinite(sample.size) || sample.size <= 0) { reset(); return false; }
      const current = { x: sample.x, y: sample.y, size: sample.size, hand: typeof sample.hand === "string" ? sample.hand : "", time: timeMs };
      const elapsed = previous ? timeMs - previous.time : 0;
      const sizeRatio = previous ? sample.size / previous.size : 1;
      const continuous = Boolean(previous && elapsed > 0 && elapsed <= maxGapMs && current.hand === previous.hand &&
        Math.hypot(sample.x - previous.x, sample.y - previous.y) <= maxJump && sizeRatio >= minSizeRatio && sizeRatio <= maxSizeRatio);
      previous = current;
      return continuous;
    }
    return { push, reset };
  }

  function createVideoFrameSource(options = {}) {
    const maxAgeMs = positive(options.maxAgeMs, 300);
    let lastMediaTime = -Infinity;
    function reset() { lastMediaTime = -Infinity; }
    function read(mediaTime, callback, nowMs) {
      if (!Number.isFinite(nowMs) || nowMs < 0) return null;
      // Some browsers expose requestVideoFrameCallback without delivering it
      // reliably. Fall back to the video clock only when the callback is stale.
      const fresh = callback && Number.isFinite(callback.mediaTime) && callback.mediaTime >= 0 &&
        Number.isFinite(callback.timestamp) && callback.timestamp <= nowMs && nowMs - callback.timestamp <= maxAgeMs;
      const key = fresh ? callback.mediaTime : mediaTime;
      if (!Number.isFinite(key) || key < 0 || key <= lastMediaTime) return null;
      lastMediaTime = key;
      return { key, timestamp: fresh ? callback.timestamp : nowMs };
    }
    return { read, reset };
  }

  function createFrameGate(options = {}) {
    const maxAgeMs = positive(options.maxAgeMs, 300);
    let lastId = -1, lastTimestamp = -Infinity;
    function reset() { lastId = -1; lastTimestamp = -Infinity; }
    function accept(frame, nowMs) {
      if (!frame || !Number.isSafeInteger(frame.id) || frame.id < 0 || !Number.isFinite(frame.timestamp) || frame.timestamp < 0 || !Number.isFinite(nowMs) || nowMs < 0 || frame.id <= lastId) return false;
      // Consume even rejected IDs: a late frame cannot be replayed with a
      // fresher timestamp, nor can an older result resume a cancelled gesture.
      lastId = frame.id;
      const age = nowMs - frame.timestamp;
      if (age < 0 || age > maxAgeMs || frame.timestamp <= lastTimestamp) return false;
      lastTimestamp = frame.timestamp;
      return true;
    }
    return { accept, reset };
  }

  return { createAdaptiveFilter, createHandContinuity, createVideoFrameSource, createFrameGate };
});
