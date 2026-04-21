#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { auditV2EntryBoundaries } = require("../src/v2/entryBoundaryAudit");

const ROOT = path.resolve(__dirname, "..");
const SRC_V2_DIR = path.join(ROOT, "src", "v2");

function walkJsFiles(dir) {
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rows.push(...walkJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      rows.push(full);
    }
  }
  return rows;
}

function main() {
  const files = walkJsFiles(SRC_V2_DIR).map((filePath) => ({
    path: filePath,
    content: fs.readFileSync(filePath, "utf8"),
  }));
  const audit = auditV2EntryBoundaries({ files, rootDir: ROOT });
  if (!audit.ok) {
    console.error(JSON.stringify(audit, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_ENTRY_BOUNDARY_AUDIT_PASS",
    checked_file_n: audit.checked_file_n,
  }, null, 2));
}

main();
