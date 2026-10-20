const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chapterEntries, newChapters, applyPronunciation, unlockedCharacters, mergeCharacterCatalog, goalProgress, wrapLines } = require("../public/reader-features");
const characterCatalog = require("../public/reader-characters");

const series = (chapters) => ({ slug: "example", volumesData: [{ name: "Tập 1", dirName: "Tap_1", chapters: chapters.map((title) => ({ title, isIllustration: title === "Minh họa" })) }] });

test("first visits establish a baseline; only new story chapters trigger badges", () => {
  const original = series(["Minh họa", "Chương 1", "Chương 2"]);
  assert.deepEqual(newChapters(original, undefined), []);
  const known = chapterEntries(original).map((chapter) => chapter.id);
  const updated = series(["Minh họa", "Chương 1", "Chương mới xen giữa", "Chương 2"]);
  assert.deepEqual(newChapters(updated, known).map((chapter) => chapter.chapter.title), ["Chương mới xen giữa"]);
  assert.deepEqual(newChapters(series(["Chương 2", "Minh họa", "Chương 1"]), known), []);
});

test("pronunciation replaces whole names without changing surrounding Vietnamese words", () => {
  const result = applyPronunciation("Mahiru, MAHIRU và xMahiru, Mahiruđ, Amane!", [{ name: "Mahiru", say: "Ma hi rư" }, { name: "Amane", say: "A ma nê" }]);
  assert.equal(result.text, "Ma hi rư, Ma hi rư và xMahiru, Mahiruđ, A ma nê!");
  assert.equal(result.map.length, result.text.length + 1);
  assert.equal(result.map[result.map.length - 1], "Mahiru, MAHIRU và xMahiru, Mahiruđ, Amane!".length);
  assert.ok(result.map.every((offset, index) => index === 0 || offset >= result.map[index - 1]));
});

test("longer aliases win; pronunciation output is not recursively replaced", () => {
  const rules = [{ name: "A+B", say: "A plus B" }, { name: "Shiina Mahiru", say: "Shi i na" }, { name: "Mahiru", say: "Ma hi rư" }, { name: "Ma", say: "Mã" }];
  assert.equal(applyPronunciation("A+B và Shiina Mahiru gặp Mahiru.", rules).text, "A plus B và Shi i na gặp Ma hi rư.");
});

test("word highlights after an expanded name map back to the original text", () => {
  const original = "Amane gặp Mahiru.";
  const result = applyPronunciation(original, [{ name: "Amane", say: "A ma nê" }]);
  const offset = result.text.indexOf("gặp");
  assert.equal(original.slice(result.map[offset], result.map[offset + 3]), "gặp");
});

test("future character notes stay locked; previously reached notes remain visible", () => {
  const entries = chapterEntries(series(["Chương 1", "Chương 2", "Chương 3"]));
  const characters = [{ name: "A", gate: entries[0].id }, { name: "B", gate: entries[2].id }, { name: "Removed", gate: "missing" }];
  assert.deepEqual(unlockedCharacters(characters, entries, []).map((item) => item.name), []);
  assert.deepEqual(unlockedCharacters(characters, entries, [entries[1].id]).map((item) => item.name), ["A"]);
  assert.deepEqual(unlockedCharacters(characters, entries, [entries[2].id, entries[0].id]).map((item) => item.name), ["A", "B"]);
});

test("goals count distinct chapters and exact elapsed minutes", () => {
  assert.equal(goalProgress({ kind: "chapters", target: 2, chapters: ["a", "a"] }).reached, false);
  assert.equal(goalProgress({ kind: "chapters", target: 2, chapters: ["a", "b", "a"] }).reached, true);
  assert.equal(goalProgress({ kind: "minutes", target: 15, seconds: 899 }).reached, false);
  assert.equal(goalProgress({ kind: "minutes", target: 15, seconds: 900 }).reached, true);
});

test("quote cards wrap long words and preserve paragraph breaks without truncation", () => {
  const context = { measureText: (text) => ({ width: [...text].length * 10 }) };
  const original = "Một câu chuyện\n\nabcdefghijklmno";
  const lines = wrapLines(context, original, 60);
  assert.ok(lines.every((line) => context.measureText(line).width <= 60));
  assert.ok(lines.includes(""));
  assert.equal(lines.join("").replace(/\s/g, ""), original.replace(/\s/g, ""));
});

test("existing seed lists receive the full cast while keeping personal notes and IDs", () => {
  for (const [slug, defaults] of Object.entries(characterCatalog.series)) {
    const legacy = defaults.filter((definition) => definition.legacy).map((definition) => ({ id: `old-${definition.key}`, ...definition.legacy }));
    legacy[0].note = "Ghi chú riêng của tôi";
    legacy.push({ id: "custom", name: "Nhân vật riêng", aliases: [], note: "Giữ lại", gate: defaults[0].gate });
    const merged = mergeCharacterCatalog(legacy, defaults, { slug, legacyMigration: true });
    assert.equal(merged.characters.length, defaults.length + 1);
    assert.equal(merged.characters[0].id, legacy[0].id);
    assert.equal(merged.characters[0].note, "Ghi chú riêng của tôi");
    assert.ok(merged.characters.some((character) => character.id === "custom"));
    const twice = mergeCharacterCatalog(merged.characters, defaults, { slug, deleted: merged.deleted });
    assert.deepEqual(twice, merged);
  }
  const defaults = characterCatalog.series["tinh-yeu-vo-hinh"];
  const oldNarumi = defaults.find((character) => character.key === "narumi").legacy;
  const updated = mergeCharacterCatalog([{ id: "narumi", ...oldNarumi }], defaults, { slug: "tinh-yeu-vo-hinh" });
  assert.equal(updated.characters.find((character) => character.id === "narumi").name, "Ushio Narumi");
});

test("catalog refreshes preserve edits and intentional deletions", () => {
  const defaults = characterCatalog.series["thien-su-nha-ben"];
  const initial = mergeCharacterCatalog(null, defaults, { slug: "thien-su-nha-ben" });
  const edited = initial.characters.filter((character) => character.catalogId !== "itsuki");
  edited[0].name = "Tên tự sửa";
  edited[0].aliases = ["Tên khác riêng"];
  edited[0].note = "Ghi chú tự sửa";
  edited[0].gate = defaults.at(-1).gate;
  const revised = defaults.map((definition) => ({ ...definition, note: `${definition.note} Bản cập nhật.` }));
  const merged = mergeCharacterCatalog(edited, revised, { slug: "thien-su-nha-ben", deleted: ["itsuki"] });
  assert.equal(merged.characters.length, defaults.length - 1);
  assert.equal(merged.characters[0].name, "Tên tự sửa");
  assert.deepEqual(merged.characters[0].aliases, ["Tên khác riêng"]);
  assert.equal(merged.characters[0].note, "Ghi chú tự sửa");
  assert.equal(merged.characters[0].gate, defaults.at(-1).gate);
  assert.equal(merged.characters[1].note, revised[1].note);
  const legacyRemoved = mergeCharacterCatalog([], defaults, { slug: "thien-su-nha-ben", legacyMigration: true });
  assert.deepEqual(legacyRemoved.deleted, ["amane", "mahiru"]);
});

test("all built-in characters have valid story gates and future notes remain locked", () => {
  const fs = require("node:fs"), path = require("node:path");
  const publicPath = path.join(__dirname, "../public");
  const shelf = JSON.parse(fs.readFileSync(path.join(publicPath, "data/series.json"), "utf8"));
  const catalogSeries = shelf.filter((series) => characterCatalog.series[series.slug]);
  assert.ok(catalogSeries.length >= 3);
  for (const series of catalogSeries) {
    const defaults = characterCatalog.series[series.slug];
    const volumesData = JSON.parse(fs.readFileSync(path.join(publicPath, series.index), "utf8"));
    const entries = chapterEntries({ ...series, volumesData });
    assert.equal(new Set(defaults.map((character) => character.key)).size, defaults.length);
    for (const definition of defaults) {
      const entry = entries.find((chapter) => chapter.id === definition.gate);
      assert.ok(entry, `Invalid gate for ${definition.name}`);
      assert.equal(entry.chapter.isIllustration, false);
    }
    const first = entries.find((entry) => !entry.chapter.isIllustration);
    const visible = unlockedCharacters(defaults, entries, [first.id]);
    assert.equal(visible.length, series.slug === "tinh-yeu-vo-hinh" ? 4 : 2);
    assert.equal(unlockedCharacters(defaults, entries, [entries.at(-1).id]).length, defaults.length);
  }
});
