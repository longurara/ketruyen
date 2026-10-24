// Wording for books: reading time and volume names.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BookFormat = api;
})(globalThis, function () {
  "use strict";

  // Vietnamese words are single syllables; ~280 a minute is an easy
  // silent-reading pace for fiction.
  const READING_PACE = 280;

  function readingMinutes(words) {
    return Math.max(1, Math.round(words / READING_PACE));
  }

  // "~40 phút", "~3 giờ", "~2,5 giờ": whole volumes run to hours.
  function formatReadingTime(words) {
    const minutes = readingMinutes(words);
    if (minutes < 60) return `~${minutes} phút`;
    const hours = Math.round(minutes / 30) / 2;
    return `~${String(hours).replace(".", ",")} giờ`;
  }

  // A volume card already says "Tập 01"; a title like "<series> - Tập 1"
  // would say it twice. Returns only what the title adds, such as the
  // volume's own name, or "" when it adds nothing.
  function volumeSubtitle(volume, seriesTitle) {
    const title = String(volume.title || "").trim();
    if (!title) return "";
    const fold = (text) => text.normalize("NFC").toLocaleLowerCase("vi");
    let rest = title;
    const series = String(seriesTitle || "");
    if (series && fold(rest).startsWith(fold(series))) rest = rest.slice(series.length);
    rest = rest.replace(/^[\s\-–—:·|]+/, "").replace(/^tập\s*[\d.,]+\s*/i, "").replace(/^[\s\-–—:·|]+/, "");
    if (/^\(.*\)$/.test(rest)) rest = rest.slice(1, -1).trim();
    return rest;
  }

  function chapterCounts(book) {
    const pdf = book.sourceFormat === "PDF", volumes = book.volumesData;
    if (Array.isArray(volumes)) {
      const chapters = volumes.flatMap((v) => v.chapters || []);
      const illustrations = pdf ? 0 : chapters.filter((c) => c.isIllustration).length;
      return { chapters: chapters.length - illustrations, illustrations, unit: pdf ? "trang" : "chương" };
    }
    return { chapters: Number.isInteger(book.storyChapters) ? book.storyChapters : null,
      illustrations: Number.isInteger(book.illustrations) ? book.illustrations : null, unit: pdf ? "trang" : "chương" };
  }
  function countLabel(book) {
    const count = chapterCounts(book);
    return [count.chapters !== null && count.chapters > 0 ? `${count.chapters} ${count.unit}` : "",
      count.illustrations ? `${count.illustrations} phần minh họa` : ""].filter(Boolean).join(" · ");
  }
  function readingEntries(book) {
    const entries = (book.volumesData || []).flatMap((v, vi) => (v.chapters || []).map((chapter, ci) => ({ chapter, vi, ci })));
    const story = entries.filter((e) => book.sourceFormat === "PDF" || !e.chapter.isIllustration);
    return story.length ? story : entries;
  }
  function completedProgress(book, flags = {}) {
    const entries = readingEntries(book), total = entries.length;
    const done = entries.filter((e) => flags[`${e.vi}:${e.ci}`]?.done).length;
    const counts = chapterCounts(book);
    return { done, total, percent: total ? Math.round(done / total * 100) : 0, unit: counts.chapters === 0 && counts.illustrations ? "phần minh họa" : counts.unit };
  }
  return { READING_PACE, readingMinutes, formatReadingTime, volumeSubtitle, chapterCounts, countLabel, readingEntries, completedProgress };
});
