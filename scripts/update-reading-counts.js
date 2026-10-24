// Update catalogue counts from existing indexes, without touching text/images.
const fs = require("node:fs"), path = require("node:path"), format = require("../public/book-format");
const root = path.join(__dirname, "../public"), filename = path.join(root, "data/series.json");
const books = JSON.parse(fs.readFileSync(filename, "utf8"));
for (const book of books) {
  const volumesData = JSON.parse(fs.readFileSync(path.join(root, book.index), "utf8"));
  const counts = format.chapterCounts({ ...book, volumesData });
  book.storyChapters = counts.chapters; book.illustrations = counts.illustrations;
}
const output = JSON.stringify(books);
if (process.argv.includes("--check")) {
  if (output !== fs.readFileSync(filename, "utf8").trim()) throw new Error("Catalogue chapter counts are out of date");
} else fs.writeFileSync(filename, output);
console.log(`Reading counts verified: ${books.length} books`);
