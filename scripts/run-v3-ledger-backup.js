#!/usr/bin/env node
"use strict";

// scripts/run-v3-ledger-backup.js — ledger snapshot (2026-07-16).
//
// The ledgers under ops/runtime are the system's entire memory (900+ paper
// trades of evidence, the live record) and are gitignored — they exist on
// exactly one disk. This snapshots *.jsonl (ops/runtime) + *.json artifacts
// (ops/daily) into a tar.gz with a sha256 manifest, keeps the newest
// V3_BACKUP_KEEP_N (default 14), and mirrors to a second directory when one
// is available:
//   V3_BACKUP_EXTRA_DIR env if set, else iCloud Drive (~/Library/Mobile
//   Documents/com~apple~CloudDocs/donbeolja-backups) when it exists.
// Same-disk copies protect against corruption/accidental deletion; the
// mirror is what protects against disk death.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BACKUP_DIR = path.join(ROOT, "ops/backup");
const PREFIX = "v3-ledgers-";

function keepN() {
  const raw = Number(process.env.V3_BACKUP_KEEP_N);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 14;
}

function resolveExtraDir() {
  const explicit = String(process.env.V3_BACKUP_EXTRA_DIR || "").trim();
  if (explicit) return explicit;
  const icloud = path.join(os.homedir(), "Library/Mobile Documents/com~apple~CloudDocs");
  if (fs.existsSync(icloud)) return path.join(icloud, "donbeolja-backups");
  return null;
}

// pure, tested indirectly: which backup files to delete under retention N
function pruneList(names = [], keep = 14) {
  const backups = names.filter((n) => n.startsWith(PREFIX) && n.endsWith(".tar.gz")).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

// What to back up: ops/runtime *.jsonl is the system's actual memory (every
// ledger and feed — irreplaceable); ops/daily is restricted to *_latest.json
// because the historical per-run snapshots there number in the tens of
// thousands (30k+ observed), are derivable, and blew past ARG_MAX (E2BIG)
// when passed as tar args. The list is fed to tar via -T (files-from), so
// even a large ledger set can never hit the argv limit again.
function collectSources() {
  const out = [];
  const rt = path.join(ROOT, "ops/runtime");
  if (fs.existsSync(rt)) {
    for (const f of fs.readdirSync(rt)) if (f.endsWith(".jsonl")) out.push(path.join("ops/runtime", f));
  }
  const daily = path.join(ROOT, "ops/daily");
  if (fs.existsSync(daily)) {
    for (const f of fs.readdirSync(daily)) if (f.endsWith("_latest.json")) out.push(path.join("ops/daily", f));
  }
  return out;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function main() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13); // YYYYMMDDTHH
  const name = `${PREFIX}${stamp}.tar.gz`;
  const outFile = path.join(BACKUP_DIR, name);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const sources = collectSources();
  if (!sources.length) {
    console.log(JSON.stringify({ ok: false, reason: "NO_SOURCES" }));
    process.exit(1);
  }

  // -T files-from keeps argv tiny no matter how many ledgers accumulate
  const listFile = path.join(os.tmpdir(), `v3-backup-list-${process.pid}.txt`);
  fs.writeFileSync(listFile, sources.join("\n") + "\n");
  const tar = spawnSync("tar", ["-czf", outFile, "-C", ROOT, "-T", listFile], { encoding: "utf8" });
  try { fs.unlinkSync(listFile); } catch (_) {}
  if (tar.status !== 0) {
    console.log(JSON.stringify({ ok: false, reason: "TAR_FAILED", status: tar.status, stderr: (tar.stderr || "").slice(0, 300), error: tar.error && tar.error.message }));
    process.exit(1);
  }
  const digest = sha256(outFile);
  fs.appendFileSync(path.join(BACKUP_DIR, "manifest.jsonl"),
    JSON.stringify({ file: name, sha256: digest, files_n: sources.length, created_at: new Date().toISOString() }) + "\n");

  // retention (primary)
  for (const stale of pruneList(fs.readdirSync(BACKUP_DIR), keepN())) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, stale)); } catch (_) {}
  }

  // mirror (best effort — never fails the backup)
  let mirrored = null;
  const extra = resolveExtraDir();
  if (extra) {
    try {
      fs.mkdirSync(extra, { recursive: true });
      fs.copyFileSync(outFile, path.join(extra, name));
      for (const stale of pruneList(fs.readdirSync(extra), keepN())) {
        try { fs.unlinkSync(path.join(extra, stale)); } catch (_) {}
      }
      mirrored = extra;
    } catch (_) { mirrored = null; }
  }

  console.log(JSON.stringify({
    ok: true, backup: outFile, sha256: digest, files_n: sources.length,
    size_bytes: fs.statSync(outFile).size, mirrored_to: mirrored, keep_n: keepN(),
  }));
}

if (require.main === module) main();
module.exports = { __test: { pruneList, resolveExtraDir } };
