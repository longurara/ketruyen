const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const destination = path.join(root, "public/vendor/supabase");
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(path.join(root, "node_modules/@supabase/supabase-js/dist/umd/supabase.js"), path.join(destination, "supabase.js"));
fs.copyFileSync(path.join(root, "node_modules/@supabase/supabase-js/LICENSE"), path.join(destination, "LICENSE"));
