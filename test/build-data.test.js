const test = require("node:test"), assert = require("node:assert/strict");
const { cleanChapter } = require("../build-data");

test("chapter text gains the space a source dropped after a comma, leaving numbers alone", () => {
  const { content } = cleanChapter("Chương 1", "Chỉ là cách nói ví von,song cô ấy thật đẹp.\n\nGiá 1,5 triệu;còn lại để sau.");
  assert.equal(content, "Chỉ là cách nói ví von, song cô ấy thật đẹp.\n\nGiá 1,5 triệu; còn lại để sau.");
});

test("chapter text drops the space typed before punctuation, keeping spaced ellipses and times", () => {
  const { content } = cleanChapter("Chương 1", "Cô khiêm nhường , việc được yêu mến là dễ hiểu .\n\nThành tích cấp S . Thật sao ?!\n\nCậu . . . không biết. Hẹn lúc 10 : 30 nhé.\n\n“Ừ” , cô nói : thôi.");
  assert.equal(content, "Cô khiêm nhường, việc được yêu mến là dễ hiểu.\n\nThành tích cấp S. Thật sao?!\n\nCậu . . . không biết. Hẹn lúc 10 : 30 nhé.\n\n“Ừ”, cô nói: thôi.");
});
