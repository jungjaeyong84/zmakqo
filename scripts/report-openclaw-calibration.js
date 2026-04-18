#!/usr/bin/env node
"use strict";

// Phase B — per-source calibration report for the OpenClaw Decision Agent.
//
// Reads linked evidence (outcome != null) from `openclaw_evidence_ledger`
// and computes hit rates per source (rule / ml / narrative). The output
// backs the "trust weights" the agent's composite uses in Phase D+. When
// a source's realized accuracy drifts below the calibration floor the
// agent auto-demotes it (future work; this report is the data layer).
//
// Output:
//   ops/daily/openclaw_calibration_latest.json
//     { generated_at, window_hours, per_source: { rule, ml, narrative },
//       trust_weights, recommendations: [...] }
//
// Input knobs:
//   OPENCLAW_CALIBRATION_LOOKBACK_HOURS (default 168 = 7 days)
//   OPENCLAW_CALIBRATION_MIN_SAMPLE (default 20 per source)
//   OPENCLAW_CALIBRATION_TRUST_FLOOR (default 0.3; below → demote)
//
// No production side-effect — read-only.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OUTPUT_PATH = path.join(OPS_DAILY, "openclaw_calibration_latest.json");
const LEDGER_COLLECTION = "openclaw_evidence_ledger";

function iso() { return new Date().toISOString(); }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

const LOOKBACK_HOURS = (() => {
  const n = Number(process.env.OPENCLAW_CALIBRATION_LOOKBACK_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 168;
})();
const MIN_SAMPLE = (() => {
  const n = Number(process.env.OPENCLAW_CALIBRATION_MIN_SAMPLE);
  return Number.isFinite(n) && n > 0 ? n : 20;
})();
const TRUST_FLOOR = (() => {
  const n = Number(process.env.OPENCLAW_CALIBRATION_TRUST_FLOOR);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.3;
})();

function computePerSourceHitRate(records = [], source) {
  let predicted_accept_n = 0;
  let predicted_reject_n = 0;
  let tp1_given_accept_n = 0;
  let sl_given_accept_n = 0;
  let realized_accept_n = 0;
  for (const r of records) {
    const pred = r.predictions && r.predictions[source];
    if (!pred) continue;
    const accept = (pred.accept === true) || (Number(pred.scale) > 0) || (Number(pred.tp1_probability) >= 0);
    if (accept) predicted_accept_n += 1; else predicted_reject_n += 1;
    if (accept && r.outcome && (r.outcome.tp1_first || r.outcome.sl_first || r.outcome.label)) {
      realized_accept_n += 1;
      if (r.outcome.tp1_first === true) tp1_given_accept_n += 1;
      if (r.outcome.sl_first === true) sl_given_accept_n += 1;
    }
  }
  const tp1_rate = realized_accept_n > 0 ? tp1_given_accept_n / realized_accept_n : null;
  const sl_rate = realized_accept_n > 0 ? sl_given_accept_n / realized_accept_n : null;
  return {
    predicted_accept_n,
    predicted_reject_n,
    realized_accept_n,
    tp1_given_accept_n,
    sl_given_accept_n,
    tp1_given_accept_rate: tp1_rate,
    sl_given_accept_rate: sl_rate,
  };
}

function scoreTrustFromCalibration(hit) {
  if (!hit || !Number.isFinite(Number(hit.tp1_given_accept_rate))) return 0.5;
  // Higher TP1 hit rate among accepted → higher trust.
  // Cap between 0 and 1, with a minimum sample requirement.
  if ((hit.realized_accept_n || 0) < MIN_SAMPLE) return 0.5;
  return Math.max(0, Math.min(1, hit.tp1_given_accept_rate));
}

async function loadLinkedEvidence(db, lookbackMs) {
  const since = new Date(Date.now() - lookbackMs).toISOString();
  const rows = [];
  try {
    const snap = await db.collection(LEDGER_COLLECTION)
      .where("at", ">=", since)
      .limit(1000)
      .get();
    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (!data.outcome) return; // unlinked
      rows.push(data);
    });
  } catch (_) { /* silent — we report skipped */ }
  return rows;
}

function buildRecommendations(perSource) {
  const recs = [];
  for (const [source, hit] of Object.entries(perSource)) {
    if (!hit) continue;
    if ((hit.realized_accept_n || 0) < MIN_SAMPLE) {
      recs.push({ source, severity: "INFO", action: `Collect more samples (have ${hit.realized_accept_n}, need ${MIN_SAMPLE})` });
      continue;
    }
    const rate = Number(hit.tp1_given_accept_rate);
    if (!Number.isFinite(rate)) continue;
    if (rate < TRUST_FLOOR) {
      recs.push({
        source,
        severity: "HIGH",
        action: `Demote ${source}: realized TP1 rate ${rate.toFixed(3)} below floor ${TRUST_FLOOR}. Reduce trust weight or disable.`,
      });
    } else if (rate < TRUST_FLOOR + 0.1) {
      recs.push({ source, severity: "MEDIUM", action: `${source} trust weak (${rate.toFixed(3)}); monitor closely.` });
    } else {
      recs.push({ source, severity: "OK", action: `${source} calibration healthy (${rate.toFixed(3)}).` });
    }
  }
  return recs;
}

async function main() {
  const { getFirestore } = (() => {
    try { return require("../src/storage/firestore"); } catch (_) { return {}; }
  })();
  const payloadBase = {
    ok: true,
    generated_at: iso(),
    lookback_hours: LOOKBACK_HOURS,
    min_sample: MIN_SAMPLE,
    trust_floor: TRUST_FLOOR,
  };
  if (typeof getFirestore !== "function") {
    const payload = { ...payloadBase, skipped: true, reason: "FIRESTORE_UNREACHABLE" };
    console.log(JSON.stringify(payload));
    return payload;
  }
  let db;
  try { db = getFirestore(); } catch (_) {
    const payload = { ...payloadBase, skipped: true, reason: "FIRESTORE_INIT_FAILED" };
    console.log(JSON.stringify(payload));
    return payload;
  }

  const records = await loadLinkedEvidence(db, LOOKBACK_HOURS * 60 * 60 * 1000);
  const perSource = {
    rule: computePerSourceHitRate(records, "rule"),
    ml: computePerSourceHitRate(records, "ml"),
    narrative: computePerSourceHitRate(records, "narrative"),
  };
  const trust_weights = {
    rule: scoreTrustFromCalibration(perSource.rule),
    ml: scoreTrustFromCalibration(perSource.ml),
    narrative: scoreTrustFromCalibration(perSource.narrative),
  };
  const recommendations = buildRecommendations(perSource);
  const payload = {
    ...payloadBase,
    linked_n: records.length,
    per_source: perSource,
    trust_weights,
    recommendations,
  };
  try {
    fs.mkdirSync(OPS_DAILY, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    // Surface on stderr so launchd's StandardErrorPath captures it. Silent
    // catch previously hid disk/permission errors and made the dashboard
    // falsely GREEN-then-RED as a result.
    console.error("[openclaw_calibration] FAILED to write artifact", OUTPUT_PATH, err && err.message ? err.message : err);
  }
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_OPENCLAW_CALIBRATION_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    computePerSourceHitRate,
    scoreTrustFromCalibration,
    buildRecommendations,
  };
}
