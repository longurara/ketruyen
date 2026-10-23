const js = require("@eslint/js");
const globals = require("globals");

// The page loads public/*.js as plain <script> tags, so each one sees the
// globals the others define. The same files export to Node for the tests.
const PAGE_MODULES = {
  AppDialog: "readonly",
  CloudSync: "readonly",
  AppRoutes: "readonly",
  BookFormat: "readonly",
  PageTurn: "readonly",
  EbookImport: "readonly",
  HandCalibration: "readonly",
  HandGestures: "readonly",
  HandTracking: "readonly",
  LibraryBackup: "readonly",
  LibraryTools: "readonly",
  MotionControls: "readonly",
  PdfReader: "readonly",
  ReaderCharacters: "readonly",
  ReaderFeatures: "readonly",
  ReaderSurfaces: "readonly",
  ReaderWorkbench: "readonly",
  ReaderJournal: "readonly",
  JournalUI: "readonly",
  ReadingComfort: "readonly",
  UiControls: "readonly",
  JSZip: "readonly",
  pdfjsLib: "readonly"
};

module.exports = [
  { ignores: ["node_modules/", "output/", "public/vendor/", ".playwright-cli/"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "commonjs", globals: { ...globals.node } },
    // Errors fail CI. Style-level findings already in the code stay warnings
    // so they show up without blocking; fix them, then promote to errors.
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-control-regex": "off",
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn"
    }
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, ...PAGE_MODULES, module: "readonly", globalThis: "readonly" } }
  },
  {
    files: ["public/hand-camera-worker.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.worker } }
  },
  {
    // page.evaluate() callbacks run in the browser.
    files: ["test/e2e/**/*.js"],
    languageOptions: { globals: { ...globals.browser } }
  }
];
