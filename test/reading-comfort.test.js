const { test } = require("node:test");
const assert = require("node:assert/strict");
const { preferences, pixelsPerSecond, pageDelay, DEFAULTS } = require("../public/reading-comfort.js");

test("comfort preferences fall back to defaults and stay within range", () => {
  assert.deepEqual(preferences(null), DEFAULTS);
  assert.deepEqual(preferences({ warmth: 250, brightness: 5, letter: -3, word: "12", ruler: "yes", speed: 1000 }),
    { warmth: 100, brightness: 40, letter: 0, word: 12, ruler: false, speed: 80 });
  assert.equal(preferences({ ruler: true }).ruler, true);
});

test("auto-scroll speed is the same in lines whatever the font size", () => {
  // 24 lines a minute of 40 px lines: 16 px a second.
  assert.equal(pixelsPerSecond(24, 40), 16);
  assert.equal(pixelsPerSecond(24, 60) / 60, pixelsPerSecond(24, 40) / 40);
});

test("automatic page turns follow the reading speed but never rush", () => {
  // 20 lines a page at 24 lines a minute: one page every 50 seconds.
  assert.equal(pageDelay(24, 20), 50000);
  assert.equal(pageDelay(80, 4), 4000);
});
