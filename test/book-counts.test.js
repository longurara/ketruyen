const test = require("node:test"), assert = require("node:assert/strict");
const format = require("../public/book-format"), backup = require("../public/library-backup");
const volumesData = [{ chapters: [{ title: "Tranh", isIllustration: true }, { title: "Chương một" }, { title: "Chương hai" }] }];
test("story counts and completion exclude illustration sections without renumbering stored positions", () => {
  const book = { volumesData };
  assert.deepEqual(format.chapterCounts(book), { chapters: 2, illustrations: 1, unit: "chương" });
  assert.equal(format.countLabel(book), "2 chương · 1 phần minh họa");
  const flags = { "0:0": { done: true }, "0:1": { done: true } };
  assert.deepEqual(format.completedProgress(book, flags), { done: 1, total: 2, percent: 50, unit: "chương" });
  assert.deepEqual(format.readingEntries(book).map((e) => e.ci), [1, 2]);
  assert.equal(flags["0:0"].done, true);
});
test("PDF and illustration-only volumes retain meaningful page/image completion", () => {
  const pdf = { volumesData, sourceFormat: "PDF" };
  assert.equal(format.chapterCounts(pdf).chapters, 3); assert.equal(format.chapterCounts(pdf).unit, "trang");
  assert.equal(format.completedProgress(pdf, { "0:0": { done: true } }).total, 3);
  const illustrations = { volumesData: [{ chapters: [volumesData[0].chapters[0]] }] };
  assert.equal(format.countLabel(illustrations), "1 phần minh họa");
  assert.deepEqual(format.completedProgress(illustrations, { "0:0": { done: true } }), { done: 1, total: 1, percent: 100, unit: "phần minh họa" });
});
test("old catalogues never present their raw mixed count as story chapters", () => {
  assert.equal(format.countLabel({ chapters: 194 }), "");
  assert.equal(format.countLabel({ chapters: 194, storyChapters: 182, illustrations: 12 }), "182 chương · 12 phần minh họa");
  assert.equal(format.completedProgress({ volumesData: [] }).percent, 0);
});
test("UI size is portable in backups with only supported values", () => {
  assert.equal(backup.validateSettings({ "tenshi-ui-size-v1": "large" })["tenshi-ui-size-v1"], "large");
  assert.throws(() => backup.validateSettings({ "tenshi-ui-size-v1": "500%" }));
});
