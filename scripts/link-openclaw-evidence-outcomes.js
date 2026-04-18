#!/usr/bin/env node
"use strict";

// Phase B — OpenClaw outcome-linker.
//
// Joins evidence-ledger records (`openclaw_evidence_ledger`) to realized
// trade outcomes so the calibration report can later compute
// per-source hit rates. One-shot command; meant to be run by a cron every
// ~15min in production and once manually in staging.
//
// Scope:
//   - For each evidence doc with outcome=null, try to find the realized
//     result in `fills_paper` (matching symbol + market + bar window) and
//     `best_self_evolution_provisional_realized_outcome_latest.json`.
//   - Write `outcome: { realized_at, tp1_first, sl_first, realised_ret_net,
//     source }` back to the evidence doc.
//   - Print a summary JSON so the calibration script can read from stdout
//     or the latest artifact.
//
// Safety:
//   - Never mutates the `inputs` / `predictions` of an evidence doc — only
//     fills the `outcome` field.
//   - `DRY_RUN=1` default: no writes, just diagnostics.
//   - Runs against the evidence ledger collection directly; when Firestore
//     is unreachable it exits 0 with `skipped: true`.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OUTPUT_PATH = path.join(OPS_DAILY, "openclaw_evidence_linker_latest.json");
const DRY_RUN = String(process.env.DRY_RUN || "1").trim() !== "0";
const LEDGER_COLLECTION = "openclaw_evidence_ledger";
const FILLS_COLLECTION = "fills_paper";
const LOOKBACK_DAYS = (() => {
  const n = Number(process.env.OPENCLAW_EVIDENCE_LINKER_LOOKBACK_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 7;
})();

function iso() { return new Date().toISOString(); }
function sinceIso(ms) {
  return new Date(Date.now() - Math.max(0, Number(ms) || 0)).toISOString();
}
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

async function loadUnlinkedEvidence(db) {
  const since = sinceIso(LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = [];
  const query = db.collection(LEDGER_COLLECTION)
    .where("at", ">=", since)
    .where("kind", "==", "SIGNAL_DECIDER")
    .limit(500);
  const snap = await query.get();
  snap.forEach((doc) => {
    const data = doc.data() || {};
    if (data.outcome && data.outcome !== null) return;
    rows.push({ id: doc.id, ...data });
  });
  return rows;
}

function classifyFill(row) {
  const ev = String(row && row.event || "").trim().toUpperCase();
  if (ev.startsWith("EXIT_TP_P1") || ev.startsWith("EXIT_TP_C")) return { tp1_first: true, label: "TP1_FIRST" };
  if (ev.startsWith("EXIT_SL")) return { sl_first: true, label: "SL_FIRST" };
  if (ev.startsWith("EXIT_TRAIL")) return { label: "TRAIL_FINAL" };
  return { label: ev || "UNKNOWN" };
}

async function findRealizedOutcome(db, evidence) {
  const symbol = String(evidence.symbol || evidence.market || "").toUpperCase();
  if (!symbol) return null;
  const afterMs = Date.parse(evidence.at) || 0;
  const afterIso = new Date(afterMs).toISOString();
  try {
    const snap = await db.collection(FILLS_COLLECTION)
      .where("symbol", "==", symbol)
      .where("created_at", ">=", afterIso)
      .orderBy("created_at", "asc")
      .limit(20)
      .get();
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      const classification = classifyFill(row);
      if (classification.label === "TP1_FIRST" || classification.label === "SL_FIRST"
        || classification.label === "TRAIL_FINAL") {
        return {
          realized_at: row.created_at,
          fill_id: row.fill_id || row.id || doc.id,
          tp1_first: classification.tp1_first === true,
          sl_first: classification.sl_first === true,
          realised_ret_net: toNum(row.realized_pnl_pct_net) || toNum(row.realized_ret_net),
          source: "FILLS_PAPER",
          label: classification.label,
        };
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function main() {
  const { getFirestore } = (() => {
    try { return require("../src/storage/firestore"); } catch (_) { return {}; }
  })();
  if (typeof getFirestore !== "function") {
    const payload = { ok: true, skipped: true, reason: "FIRESTORE_UNREACHABLE", generated_at: iso() };
    console.log(JSON.stringify(payload));
    return payload;
  }
  let db;
  try { db = getFirestore(); } catch (_) {
    const payload = { ok: true, skipped: true, reason: "FIRESTORE_INIT_FAILED", generated_at: iso() };
    console.log(JSON.stringify(payload));
    return payload;
  }

  const unlinked = await loadUnlinkedEvidence(db).catch(() => []);
  let linked = 0;
  let stillUnlinked = 0;
  const samples = [];
  for (const evidence of unlinked) {
    const outcome = await findRealizedOutcome(db, evidence);
    if (!outcome) { stillUnlinked += 1; continue; }
    linked += 1;
    if (samples.length < 10) samples.push({ decision_id: evidence.decision_id || evidence.id, ...outcome });
    if (!DRY_RUN) {
      try {
        await db.collection(LEDGER_COLLECTION).doc(evidence.id).set({ outcome }, { merge: true });
      } catch (_) { /* silent */ }
    }
  }
  const payload = {
    ok: true,
    generated_at: iso(),
    dry_run: DRY_RUN,
    unlinked_n: unlinked.length,
    linked_n: linked,
    still_unlinked_n: stillUnlinked,
    lookback_days: LOOKBACK_DAYS,
    samples,
  };
  try {
    fs.mkdirSync(OPS_DAILY, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    // Surface on stderr so launchd's StandardErrorPath captures it. The
    // prior silent catch hid real permission / ENOSPC / EROFS issues so the
    // stdout log said ok:true while the dashboard flipped to RED because no
    // file landed on disk.
    console.error("[openclaw_linker] FAILED to write artifact", OUTPUT_PATH, err && err.message ? err.message : err);
  }
  console.log(JSON.stringify(payload));
  return payload;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("LINK_OPENCLAW_EVIDENCE_OUTCOMES_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = { main, classifyFill, __test: { classifyFill } };
}
