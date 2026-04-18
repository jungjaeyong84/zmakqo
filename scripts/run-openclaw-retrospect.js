#!/usr/bin/env node
"use strict";

// Phase D — OpenClaw Retrospect Loop.
//
// Every 4h (recommended cron cadence) this script:
//   1. Pulls the last N realized trades from Firestore (or a local fixture
//      via `--fixture <path>` for CI / dry-run).
//   2. Feeds them to the narrative reasoner (RETROSPECT role).
//   3. Writes a structured retrospect artifact at
//      ops/daily/openclaw_retrospect_latest.json.
//   4. Writes an evidence ledger record so future calibration can
//      correlate retrospect proposals to realized policy drift.
//
// Safety:
//   - Shadow-only by default — the retrospect emits recommendations but
//     does NOT auto-apply them. Operators review the artifact.
//   - Every proposal must reduce risk (tighter SL / smaller qty / skip
//     regime). Looser-risk proposals are filtered out by the parser.
//   - Missing Firestore / narrative fallback → empty recommendations.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OUTPUT_PATH = path.join(OPS_DAILY, "openclaw_retrospect_latest.json");

const narrativeReasoner = require("../src/services/openclawNarrativeReasoner");
const evidenceLedger = require("../src/services/openclawEvidenceLedger");

function iso() { return new Date().toISOString(); }
function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val == null || String(val).startsWith("--")) { out[key] = true; continue; }
    out[key] = val;
    i += 1;
  }
  return out;
}

async function loadTradesFromFirestore(lookbackHours, limit) {
  try {
    const { getFirestore } = require("../src/storage/firestore");
    const db = getFirestore();
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
    const snap = await db.collection("fills_paper")
      .where("created_at", ">=", since)
      .orderBy("created_at", "desc")
      .limit(limit)
      .get();
    const rows = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const ev = String(d.event || "").toUpperCase();
      if (!ev.startsWith("EXIT_")) return;
      rows.push({
        symbol: d.symbol || d.symbol_or_pair_id || null,
        side: d.side || null,
        outcome: ev.startsWith("EXIT_TP_P1") ? "TP1_FIRST"
          : ev.startsWith("EXIT_SL") ? "SL_FIRST"
          : ev.startsWith("EXIT_TRAIL") ? "TRAIL_FINAL"
          : ev,
        realised_ret_net: toNum(d.realized_pnl_pct_net) || toNum(d.realized_ret_net),
        regime: d.regime || null,
      });
    });
    return rows;
  } catch (_) {
    return null;
  }
}

function loadTradesFromFixture(fixturePath) {
  const abs = path.isAbsolute(fixturePath) ? fixturePath : path.join(REPO_ROOT, fixturePath);
  const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  return Array.isArray(raw) ? raw : (raw.trades || []);
}

function filterRiskReducingProposals(proposals) {
  return (proposals || []).filter((p) => {
    const dir = String(p && p.direction || "").toLowerCase();
    return dir === "tighter" || dir === "smaller" || dir === "skip_regime";
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lookbackHours = Number(args.lookback_hours || process.env.OPENCLAW_RETROSPECT_LOOKBACK_HOURS || 24);
  const limit = Number(args.limit || process.env.OPENCLAW_RETROSPECT_LIMIT || 50);
  const trades = args.fixture
    ? loadTradesFromFixture(String(args.fixture))
    : (await loadTradesFromFirestore(lookbackHours, limit)) || [];

  const narrative = await narrativeReasoner.reasonAboutFailurePatterns({ trades })
    .catch((err) => ({ disabled: true, live_failed: true, live_reason: err && err.message ? err.message : String(err) }));

  const hypotheses = narrative && narrative.response && Array.isArray(narrative.response.hypotheses)
    ? narrative.response.hypotheses
    : [];
  const proposals = filterRiskReducingProposals(narrative && narrative.response && narrative.response.proposals);

  const payload = {
    ok: true,
    generated_at: iso(),
    mode: args.fixture ? "FIXTURE" : "FIRESTORE",
    fixture_path: args.fixture ? String(args.fixture) : null,
    shadow_only: true,
    lookback_hours: lookbackHours,
    trade_n: trades.length,
    narrative_disabled: narrative && narrative.disabled === true,
    narrative_live_failed: narrative && narrative.live_failed === true,
    narrative_live_reason: narrative && narrative.live_reason ? narrative.live_reason : null,
    hypotheses,
    proposals,
  };

  try {
    fs.mkdirSync(OPS_DAILY, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    // Surface on stderr so launchd's StandardErrorPath captures it. Silent
    // catch previously hid disk/permission errors and made the dashboard
    // falsely drop to "missing" status while stdout still said ok:true.
    console.error("[openclaw_retrospect] FAILED to write artifact", OUTPUT_PATH, err && err.message ? err.message : err);
  }

  await evidenceLedger.writeEvidenceRecord({
    kind: evidenceLedger.KINDS.RETROSPECT,
    inputs: { trade_n: trades.length, lookback_hours: lookbackHours },
    predictions: { narrative: narrative || null },
    composite: { hypotheses, proposals, shadow_only: true },
  }).catch(() => null);

  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("RUN_OPENCLAW_RETROSPECT_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    filterRiskReducingProposals,
    loadTradesFromFixture,
    __test: { filterRiskReducingProposals },
  };
}
