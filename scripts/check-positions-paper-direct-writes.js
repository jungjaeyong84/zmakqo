"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// scripts/check-positions-paper-direct-writes.js
//
// 2026-04-27 Stage 2 — vulnerability A defense-in-depth (static guard).
//
// What this enforces:
//   The Firestore `positions_paper` collection is owned by two helper
//   modules:
//     - src/storage/positionsPaper.js  (V2 simplified-exit, with invariant
//                                       validator + writer-lease)
//     - src/paper/engine.js            (V1 legacy paper engine, with its
//                                       own namespace guard + sentinel)
//
//   Any other source file that performs a Firestore mutation (.set/.update/
//   .create/.delete) on a `positions_paper` reference is a *new* writer
//   path — by definition it bypasses the V2 invariant validator, the
//   writer-lease, and the V1 sentinel/namespace-guard. That is a
//   regression of the architectural vulnerability we just fixed.
//
//   This script greps src/ for the dangerous pattern and exits non-zero
//   if any unapproved writer is found. Run from CI to lock the contract.
//
// Allow-list: the two helper files above. Anything else is a hard fail.
//
// Usage:
//   node scripts/check-positions-paper-direct-writes.js
// Exit codes:
//   0 — clean (no unapproved writers).
//   1 — at least one offender found (path:line:snippet printed).
//
// Heuristics — line-based since AST parsing every file is expensive and
// the false-positive surface is small:
//   - "positions_paper"   appears as a literal string  → candidate.
//   - The same line (or one of the next ~5 lines) contains a Firestore
//     mutation token: .set( | .update( | .create( | .delete(.
//   We collapse to a single match per (file, line) pair.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");

const ALLOWED = new Set([
  path.join(SRC_DIR, "storage", "positionsPaper.js"),
  path.join(SRC_DIR, "paper", "engine.js"),
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "tests", "test", "__tests__", "fixtures",
]);

const MUTATION_TOKEN = /\.(set|update|create|delete)\(/;
const POSITIONS_PAPER_TOKEN = /["']positions_paper["']/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function scanFile(filePath) {
  if (ALLOWED.has(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!POSITIONS_PAPER_TOKEN.test(line)) continue;
    // Look for a mutation token on this line or up to 5 lines forward.
    const window = lines.slice(i, Math.min(lines.length, i + 6)).join("\n");
    if (!MUTATION_TOKEN.test(window)) continue;
    offenders.push({
      file: filePath,
      line: i + 1,
      snippet: line.trim(),
    });
  }
  return offenders;
}

function main() {
  const files = walk(SRC_DIR);
  const allOffenders = [];
  for (const f of files) {
    allOffenders.push(...scanFile(f));
  }
  if (allOffenders.length === 0) {
    console.log(
      "[check-positions-paper-direct-writes] OK — no unapproved writers in src/"
    );
    process.exit(0);
  }
  console.error(
    "[check-positions-paper-direct-writes] FAIL — "
    + `${allOffenders.length} unapproved writer line(s) found.`
  );
  for (const o of allOffenders) {
    const rel = path.relative(REPO_ROOT, o.file);
    console.error(`  ${rel}:${o.line}: ${o.snippet}`);
  }
  console.error(
    "\nAllowed writers: " + Array.from(ALLOWED).map((p) => path.relative(REPO_ROOT, p)).join(", ")
  );
  console.error(
    "If a new module legitimately needs to write positions_paper, route it "
    + "through src/storage/positionsPaper.js helpers (upsertPosition / "
    + "upsertPositionMetaOnly). Adding to the allow-list requires a senior "
    + "review and an updated invariant validator."
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { scanFile, walk, ALLOWED };
