const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const ALLOWLIST = new Set([
  path.join(SRC_DIR, "utils", "timeKst.js"),
]);

const TARGETS = [
  { name: "toKst", re: /function\s+toKst\b/ },
  { name: "kstDateParts", re: /function\s+kstDateParts\b/ },
  { name: "kstStartOfDay", re: /function\s+kstStartOfDay\b/ },
  { name: "kstStartOfDayMs", re: /function\s+kstStartOfDayMs\b/ },
  { name: "toKstStringFromMs", re: /function\s+toKstStringFromMs\b/ },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.isFile() && full.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (ALLOWLIST.has(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const hits = [];
  for (const t of TARGETS) {
    if (t.re.test(text)) hits.push({ name: t.name, file: rel });
  }
  return hits;
}

function main() {
  const files = walk(SRC_DIR);
  const hits = [];
  for (const file of files) {
    hits.push(...scanFile(file));
  }

  if (hits.length === 0) {
    console.log("OK: no duplicate helper definitions found.");
    return;
  }

  console.error("Duplicate helper definitions detected:");
  for (const h of hits) {
    console.error(`- ${h.name}: ${h.file}`);
  }
  process.exit(1);
}

main();
