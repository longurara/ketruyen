const test = require("node:test"), assert = require("node:assert/strict");
const { cleanChapter } = require("../build-data");

test("chapter text gains the space a source dropped after a comma, leaving numbers alone", () => {
  const { content } = cleanChapter("Chương 1", "Chỉ là cách nói ví von,song cô ấy thật đẹp.\n\nGiá 1,5 triệu;còn lại để sau.");
  assert.equal(content, "Chỉ là cách nói ví von, song cô ấy thật đẹp.\n\nGiá 1,5 triệu; còn lại để sau.");
});
