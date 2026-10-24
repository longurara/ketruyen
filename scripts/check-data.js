// Checks that what the site serves from public/data hangs together:
// series.json against the source list, every series index, and every file
// they point at. Run with `npm run check-data`.
//
// File existence is checked against `git ls-files`, so CI can run this on a
// sparse checkout that leaves the images (most of the repo) out.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const BookFormat = require("../public/book-format");
const { splitDescriptions } = require("../build-data.js");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
// What the shelf downloads before anything shows; keep it from creeping back up.
const CATALOG_BUDGET = 3.5 * 1024 * 1024;

const problems = [];
const fail = (message) => problems.push(message);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    fail(`${path.relative(ROOT, file)}: ${error.message}`);
    return null;
  }
}

function trackedFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "public"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return new Set(out.toString("utf-8").split("\0").filter(Boolean).map((file) => file.normalize("NFC")));
  } catch (_) {
    return null;
  }
}

const tracked = trackedFiles();
// "/img/Tập_1/a.webp" → is public/img/Tập_1/a.webp in the repo?
function exists(url) {
  const rel = `public${url}`.normalize("NFC");
  return tracked ? tracked.has(rel) : fs.existsSync(path.join(ROOT, rel));
}

const catalogPath = path.join(PUBLIC, "data", "series.json");
const catalog = readJson(catalogPath);
const source = readJson(path.join(ROOT, "series.json"));
const descriptions = readJson(path.join(PUBLIC, "data", "descriptions.json"));
if (!catalog || !source || !descriptions) {
  problems.forEach((problem) => console.error(`✖ ${problem}`));
  process.exit(1);
}

const size = fs.statSync(catalogPath).size;
if (size > CATALOG_BUDGET) fail(`data/series.json is ${(size / 1048576).toFixed(2)} MB, over the ${(CATALOG_BUDGET / 1048576).toFixed(1)} MB budget`);

// The catalog is built from series.json in the same order.
if (catalog.length !== source.length) fail(`data/series.json has ${catalog.length} series, series.json has ${source.length}`);
source.forEach((entry, i) => {
  if (catalog[i]?.slug !== entry.slug) fail(`series #${i}: data/series.json has "${catalog[i]?.slug}", series.json has "${entry.slug}"`);
});

const seen = new Set();
for (const series of catalog) {
  const name = series.slug || "(no slug)";
  for (const field of ["slug", "titleVi", "index"]) {
    if (typeof series[field] !== "string" || !series[field]) fail(`${name}: missing ${field}`);
  }
  if (seen.has(series.slug)) fail(`${name}: duplicate slug`);
  seen.add(series.slug);
  if (!Array.isArray(series.tags)) fail(`${name}: tags is not a list`);
}

// Blurbs: what build-data.js would write from the current series.json.
const expected = splitDescriptions(source.map((entry) => ({ slug: entry.slug, description: entry.description })));
expected.shelf.forEach((entry, i) => {
  const actual = catalog[i];
  if (!actual) return;
  if (actual.description !== entry.description || Boolean(actual.descriptionTruncated) !== Boolean(entry.descriptionTruncated)) {
    fail(`${entry.slug}: blurb in data/series.json is out of date (run npm run build-data)`);
  }
});
const expectedFull = Object.keys(expected.full);
const actualFull = Object.keys(descriptions);
if (expectedFull.length !== actualFull.length || expectedFull.some((slug) => descriptions[slug] !== expected.full[slug])) {
  fail(`data/descriptions.json is out of date (run npm run build-data)`);
}

let volumes = 0;
let chapters = 0;
for (const series of catalog) {
  const name = series.slug;
  if (series.cover && !exists(series.cover)) fail(`${name}: cover ${series.cover} is not in the repo`);
  if (!exists(series.index)) { fail(`${name}: index ${series.index} is not in the repo`); continue; }
  const index = readJson(path.join(PUBLIC, series.index));
  if (!Array.isArray(index)) { fail(`${name}: ${series.index} is not a list of volumes`); continue; }
  const counts = BookFormat.chapterCounts({ volumesData: index });
  if (series.storyChapters !== counts.chapters || series.illustrations !== counts.illustrations) fail(`${name}: reading counts differ from its index`);
  const chapterCount = index.reduce((sum, volume) => sum + (volume.chapters?.length || 0), 0);
  if (index.length !== series.volumes) fail(`${name}: series.json says ${series.volumes} volumes, index has ${index.length}`);
  if (chapterCount !== series.chapters) fail(`${name}: series.json says ${series.chapters} chapters, index has ${chapterCount}`);
  index.forEach((volume, volIdx) => {
    if (!volume.text || !exists(volume.text)) fail(`${name} volume ${volIdx}: text ${volume.text} is not in the repo`);
    if (volume.cover && !exists(volume.cover)) fail(`${name} volume ${volIdx}: cover ${volume.cover} is not in the repo`);
    (volume.chapters || []).forEach((chapter, chapIdx) => {
      if (typeof chapter.title !== "string") fail(`${name} ${volIdx}:${chapIdx}: chapter has no title`);
      for (const image of chapter.images || []) {
        if (!exists(image.src)) fail(`${name} ${volIdx}:${chapIdx}: picture ${image.src} is not in the repo`);
      }
    });
  });
  volumes += index.length;
  chapters += chapterCount;
}

if (problems.length) {
  problems.slice(0, 200).forEach((problem) => console.error(`✖ ${problem}`));
  if (problems.length > 200) console.error(`… and ${problems.length - 200} more`);
  console.error(`\n${problems.length} problem(s) in the site data.`);
  process.exit(1);
}
console.log(`✔ ${catalog.length} series, ${volumes} volumes, ${chapters} chapters; data/series.json ${(size / 1048576).toFixed(2)} MB`);
