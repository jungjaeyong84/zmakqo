#!/usr/bin/env node
"use strict";

// P3-06 opt-in migration — retire `meta.authoritative_exit_stage` from
// position docs that already carry a non-null `meta.canonical_exit_stage`.
//
// This script is intentionally opt-in:
//   • DRY_RUN defaults to "1" — no writes happen unless the operator passes
//     DRY_RUN=0 explicitly.
//   • It only rewrites position meta whose `canonical_exit_stage` is already
//     populated, so the legacy fallback in resolveStoredCanonicalExitStage
//     still works for positions that have not been migrated yet.
//   • Only new writes from liveTrailingStageRepair stop populating
//     authoritative_exit_stage (C17). Old docs carry the legacy field until
//     this script sweeps them. We target a 14-day soak window after the C17
//     deploy before running this for real.
//
// Usage (read-only preview):
//   node scripts/migrate-retire-authoritative-exit-stage.js
//
// Usage (apply, after the 14-day soak):
//   DRY_RUN=0 node scripts/migrate-retire-authoritative-exit-stage.js
//
// The migration is idempotent: a second run finds zero remaining docs.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

const EXCHANGE = String(process.env.EXCHANGE || "BINANCEFUT").toUpperCase();
const DRY_RUN = String(process.env.DRY_RUN || "1").trim().toLowerCase() !== "0";
const PAGE_SIZE = Math.max(50, Number(process.env.PAGE_SIZE || 250));
const OUT_DIR = path.join(process.cwd(), "ops", "daily");

function isoNow() {
  return new Date().toISOString();
}

function shouldMigrate(meta) {
  if (!meta || typeof meta !== "object") return false;
  const legacy = String(meta.authoritative_exit_stage || "").trim();
  if (!legacy) return false;
  const canonical = String(meta.canonical_exit_stage || "").trim();
  if (!canonical) return false;
  // Do not touch a position whose legacy + canonical fields disagree. That is
  // a diagnostic signal, not a cleanup target.
  return canonical.toUpperCase() === legacy.toUpperCase();
}

async function main() {
  const db = getFirestore();
  let scanned = 0;
  let migrated = 0;
  let skipped_disagreement = 0;
  let skipped_no_legacy = 0;
  const samples = [];

  let last = null;
  for (;;) {
    let query = db.collection("positions_paper")
      .where("exchange", "==", EXCHANGE)
      .limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchWrites = 0;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data() || {};
      const meta = (data.meta && typeof data.meta === "object") ? data.meta : {};
      const legacy = String(meta.authoritative_exit_stage || "").trim();
      if (!legacy) {
        skipped_no_legacy += 1;
        continue;
      }
      const canonical = String(meta.canonical_exit_stage || "").trim();
      if (canonical && canonical.toUpperCase() !== legacy.toUpperCase()) {
        skipped_disagreement += 1;
        continue;
      }
      if (!shouldMigrate(meta)) continue;

      migrated += 1;
      if (samples.length < 10) {
        samples.push({
          id: doc.id,
          canonical,
          legacy,
        });
      }
      if (!DRY_RUN) {
        batch.set(doc.ref, {
          meta: {
            ...meta,
            authoritative_exit_stage: null,
            retired_authoritative_exit_stage_at: isoNow(),
          },
          updated_at: isoNow(),
        }, { merge: true });
        batchWrites += 1;
      }
    }

    if (!DRY_RUN && batchWrites > 0) {
      await batch.commit();
    }

    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }

  const report = {
    ok: true,
    generated_at: isoNow(),
    exchange: EXCHANGE,
    dry_run: DRY_RUN,
    scanned,
    migrated,
    skipped_disagreement,
    skipped_no_legacy,
    samples,
  };

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = path.join(OUT_DIR, "migrate_retire_authoritative_exit_stage_latest.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  } catch (_) {
    // Non-fatal — still print to stdout.
  }

  console.log(JSON.stringify(report));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("MIGRATE_RETIRE_AUTHORITATIVE_EXIT_STAGE_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      shouldMigrate,
    },
  };
}
