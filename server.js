const express = require("express");
const path = require("path");
const fs = require("fs");
const { createRenderer } = require("./page-meta");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const renderPage = createRenderer(path.join(__dirname, "public"));

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

app.get("/images/:slug/:volume/:file", (req, res) => {
  const filePath = path.join(__dirname, "output", req.params.slug, req.params.volume, "images", req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Image not found");
});

app.get("/api/images/:slug/:volume", (req, res) => {
  const imgDir = path.join(__dirname, "output", req.params.slug, req.params.volume, "images");
  if (fs.existsSync(imgDir)) res.json(fs.readdirSync(imgDir).sort());
  else res.json([]);
});

// Serve volume images: /images/Tập_1/illu_02.webp
app.get("/images/:volume/:file", (req, res) => {
  const filePath = path.join(
    __dirname,
    "output",
    req.params.volume,
    "images",
    req.params.file
  );
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("Image not found");
  }
});

// API: list all image files for a volume
app.get("/api/images/:volume", (req, res) => {
  const imgDir = path.join(
    __dirname,
    "output",
    req.params.volume,
    "images"
  );
  if (fs.existsSync(imgDir)) {
    const files = fs.readdirSync(imgDir).sort();
    res.json(files);
  } else {
    res.json([]);
  }
});

// Book, volume and chapter pages: the app shell with that page's title,
// description and preview image filled in (see page-meta.js).
app.get(/^\/truyen\//, (req, res) => {
  const { status, html } = renderPage(req.path, `${req.protocol}://${req.get("host")}`);
  res.status(status).type("html").send(html);
});

app.listen(PORT, () => {
  console.log(`\n📚 Kệ Truyện — Reader`);
  console.log(`   http://localhost:${PORT}\n`);
});
