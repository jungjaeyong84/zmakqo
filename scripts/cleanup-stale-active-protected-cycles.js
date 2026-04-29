#!/usr/bin/env node
"use strict";

// 2026-04-30 P0-fix-G — stale ACTIVE_PROTECTED cycle cleanup tool.
//
// Background
//
// The exit-integrity deploy gate (scripts/check-binance-exit-integrity-gate.js)
// blocks production deploys when at least one
// authority_actionable_live_issue_position is present in the live
// authority board. The build for P0-fix-E (commit 6481689d) failed
// 2026-04-29 18:54 UTC because production currently holds 1 such
// position — almost certainly a stale ACTIVE_PROTECTED Firestore
// cycle whose broker side is already FLAT.
//
// Why this happens
//
//   - WS user-data stream lease churn around deploys (LEASE_LOST 167건/24h)
//     means a fill notification can race and miss the cycle's
//     state-machine transition that would have moved status →
//     CLOSED.
//   - The reconciler logs RECONCILER_FLAT_STALE_BREACH every tick
//     for these stuck cycles but has no auto-cleanup path; it is a
//     monitoring-only observer.
//
// Production safety: broker = truth. The broker side being FLAT
// means the position is already closed at Binance; the Firestore
// cycle being ACTIVE_PROTECTED is purely a stale Firestore state
// that survives because nothing wrote a CLOSED transition to it.
// Trade decisions are not affected (other paths gate on broker
// truth via brokerPositionTruth helper, P0-4 ff2f5b00) — but the
// audit gate fail-safes on the Firestore inconsistency.
//
// What this script does
//
//   1. Read every POSITION_CYCLES doc with status="ACTIVE_PROTECTED".
//   2. Fetch the broker-side snapshot via the canonical
//      brokerPositionTruth helper (same TTL cache that the rest of
//      the system uses, so this run does not double-spend Binance
//      weight).
//   3. For each candidate cycle, classify:
//        STALE_BROKER_FLAT  — broker map says isFlat=true (or
//                             symbol absent) AND the cycle was
//                             created more than CYCLE_AGE_FLOOR_MS
//                             ago. Eligible for cleanup.
//        RECENTLY_OPENED    — created in the last CYCLE_AGE_FLOOR_MS.
//                             Skipped (might be in-flight
//                             PROTECTION_PENDING → ACTIVE transition).
//        BROKER_LIVE        — broker map says positionAmt != 0.
//                             Skipped — this is a real live position.
//        UNKNOWN            — no live config / API keys; cannot
//                             verify broker side. Skipped.
//   4. Emit a diagnose report (default --apply=false). Operator
//      reviews then re-runs with --apply=true to actually write.
//   5. (--apply=true) For each STALE_BROKER_FLAT cycle, write a
//      merge patch:
//        status:               "CLOSED"
//        closed_at:            <ISO>
//        closed_reason:        "STALE_BROKER_FLAT_CLEANUP_P0_FIX_G"
//        closed_by_script:     "cleanup-stale-active-protected-cycles.js"
//        closed_evidence:      { broker_position_amt, broker_fetched_at_ms,
//                                source: "broker_position_truth" }
//
// Safety guards
//
//   - --apply=false is the default. Operator must opt in.
//   - Hard limit on writes per run (CLEANUP_MAX_WRITES, default 50)
//     so a misclassification can't nuke an entire ACTIVE_PROTECTED
//     board in one swing.
//   - CYCLE_AGE_FLOOR_MS (default 5 min) — cycles younger than this
//     are NEVER cleaned, even if broker shows FLAT, because they
//     could be a legitimate in-flight protection placement window.
//   - The cleanup writer uses merge:true (preserves the rest of the
//     cycle doc's fields — entry_price, position_side, etc.) so an
//     audit trail of the original cycle is preserved.
//
// CLI
//
//   node scripts/cleanup-stale-active-protected-cycles.js
//     # diagnose only — print classification + counts, no writes
//
//   node scripts/cleanup-stale-active-protected-cycles.js --apply
//     # actually mutate the STALE_BROKER_FLAT cycles
//
// Env override
//
//   CLEANUP_MAX_WRITES         hard write cap (default 50)
//   CLEANUP_CYCLE_AGE_FLOOR_MS minimum cycle age to be eligible
//                              (default 300000 = 5 min)
//   CLEANUP_QUERY_LIMIT        max ACTIVE_PROTECTED cycles to scan
//                              (default 200)

const path = require("path");

const { queryV2DocsByField, putV2Doc } = require("../src/v2/storage");
const { getBrokerPositionSnapshot } = require("../src/services/brokerPositionTruth");
const { resolveBinanceFuturesKeys } = require("../src/utils/binanceKeyResolver");

const CLEANUP_MAX_WRITES = (() => {
  const raw = Number(process.env.CLEANUP_MAX_WRITES);
  if (Number.isFinite(raw) && raw > 0) return Math.min(500, Math.floor(raw));
  return 50;
})();
const CLEANUP_CYCLE_AGE_FLOOR_MS = (() => {
  const raw = Number(process.env.CLEANUP_CYCLE_AGE_FLOOR_MS);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return 5 * 60 * 1000;
})();
const CLEANUP_QUERY_LIMIT = (() => {
  const raw = Number(process.env.CLEANUP_QUERY_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return Math.min(1000, Math.floor(raw));
  return 200;
})();

function parseArgs(argv = process.argv.slice(2)) {
  const flags = { apply: false };
  for (const arg of argv) {
    if (arg === "--apply" || arg === "--apply=true") flags.apply = true;
    if (arg === "--apply=false") flags.apply = false;
  }
  return flags;
}

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function resolveCycleAgeMs(cycle, nowMs) {
  // Try several timestamp fields in priority order. We accept any
  // of them as "cycle was created at" for the age-floor guard.
  const candidates = [
    cycle && cycle.entry_bootstrap_committed_at,
    cycle && cycle.activated_at,
    cycle && cycle.opened_at,
    cycle && cycle.created_at,
  ];
  for (const c of candidates) {
    const t = trimOrNull(c);
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) return nowMs - ms;
  }
  // No usable timestamp → refuse to classify as stale (must be
  // skipped via UNKNOWN_AGE).
  return null;
}

function classifyCycle({ cycle, brokerByMap, nowMs }) {
  const symbol = trimOrNull(cycle && cycle.symbol);
  const positionCycleId = trimOrNull(cycle && cycle.position_cycle_id);
  const ageMs = resolveCycleAgeMs(cycle, nowMs);

  if (!symbol || !positionCycleId) {
    return { classification: "MISSING_FIELDS", reason: "symbol or position_cycle_id missing", brokerEntry: null, ageMs };
  }
  if (ageMs == null) {
    return { classification: "UNKNOWN_AGE", reason: "no usable timestamp on cycle doc", brokerEntry: null, ageMs };
  }
  if (ageMs < CLEANUP_CYCLE_AGE_FLOOR_MS) {
    return { classification: "RECENTLY_OPENED", reason: `age_ms=${ageMs} < floor=${CLEANUP_CYCLE_AGE_FLOOR_MS}`, brokerEntry: null, ageMs };
  }
  if (!brokerByMap) {
    return { classification: "UNKNOWN", reason: "broker snapshot unavailable", brokerEntry: null, ageMs };
  }
  const brokerEntry = brokerByMap.get(symbol) || null;
  // No entry in broker map = no position at broker = effectively FLAT.
  if (!brokerEntry || brokerEntry.isFlat === true) {
    return { classification: "STALE_BROKER_FLAT", reason: brokerEntry ? `positionAmt=${brokerEntry.positionAmt}` : "symbol absent from broker positions", brokerEntry, ageMs };
  }
  return { classification: "BROKER_LIVE", reason: `positionAmt=${brokerEntry.positionAmt} positionSide=${brokerEntry.positionSide}`, brokerEntry, ageMs };
}

async function loadActiveProtectedCycles({ env = process.env } = {}) {
  const result = await queryV2DocsByField({
    env,
    collectionKey: "POSITION_CYCLES",
    field: "status",
    value: "ACTIVE_PROTECTED",
    limit: CLEANUP_QUERY_LIMIT,
  });
  return Array.isArray(result && result.rows) ? result.rows : [];
}

async function main({ env = process.env, argv = process.argv.slice(2) } = {}) {
  const flags = parseArgs(argv);
  const nowMs = Date.now();

  const cycles = await loadActiveProtectedCycles({ env });

  // Resolve broker snapshot once. This populates the same TTL cache
  // that the rest of the system shares (no double weight cost).
  let brokerSnapshot = null;
  try {
    const keys = await resolveBinanceFuturesKeys({ ttlMs: 5000 });
    if (keys && keys.apiKey && keys.apiSecret) {
      brokerSnapshot = await getBrokerPositionSnapshot({
        liveCfg: { apiKey: keys.apiKey, apiSecret: keys.apiSecret },
        nowMs,
      });
    }
  } catch (e) {
    // Fall through with broker null. The classifier will mark every
    // cycle UNKNOWN; the script will not write anything.
    process.stderr.write(`[broker_snapshot_unavailable] ${e && e.message ? e.message : String(e)}\n`);
  }
  const brokerByMap = brokerSnapshot && brokerSnapshot.byMap instanceof Map ? brokerSnapshot.byMap : null;
  const brokerFetchedAtMs = brokerSnapshot && Number.isFinite(brokerSnapshot.fetchedAt) ? brokerSnapshot.fetchedAt : null;

  // Classify every cycle.
  const classified = cycles.map((cycle) => {
    const c = classifyCycle({ cycle, brokerByMap, nowMs });
    return {
      position_cycle_id: trimOrNull(cycle && cycle.position_cycle_id),
      symbol: trimOrNull(cycle && cycle.symbol),
      position_side: trimOrNull(cycle && cycle.position_side),
      status: trimOrNull(cycle && cycle.status),
      age_ms: c.ageMs,
      classification: c.classification,
      reason: c.reason,
      broker_position_amt: c.brokerEntry ? Number(c.brokerEntry.positionAmt) : null,
      broker_position_side: c.brokerEntry ? c.brokerEntry.positionSide : null,
    };
  });

  // Bucket the report.
  const buckets = {
    STALE_BROKER_FLAT: [],
    RECENTLY_OPENED: [],
    BROKER_LIVE: [],
    UNKNOWN: [],
    UNKNOWN_AGE: [],
    MISSING_FIELDS: [],
  };
  for (const row of classified) {
    const arr = buckets[row.classification] || (buckets[row.classification] = []);
    arr.push(row);
  }

  const stale = buckets.STALE_BROKER_FLAT;
  const willWriteN = Math.min(stale.length, CLEANUP_MAX_WRITES);
  const overflowN = Math.max(0, stale.length - CLEANUP_MAX_WRITES);

  let writes = [];
  if (flags.apply && willWriteN > 0) {
    const closeAtIso = new Date(nowMs).toISOString();
    for (let i = 0; i < willWriteN; i += 1) {
      const row = stale[i];
      const sourceCycle = cycles.find((c) =>
        trimOrNull(c && c.position_cycle_id) === row.position_cycle_id
      ) || {};
      // Merge patch — only flip status + add provenance.
      // The rest of the cycle doc is preserved by Firestore's
      // merge:true semantics (the storage helper sets merge=true
      // when we pass merge:true).
      const patch = {
        ...sourceCycle,
        position_cycle_id: row.position_cycle_id,
        status: "CLOSED",
        closed_at: closeAtIso,
        closed_reason: "STALE_BROKER_FLAT_CLEANUP_P0_FIX_G",
        closed_by_script: "cleanup-stale-active-protected-cycles.js",
        closed_evidence: {
          broker_position_amt: row.broker_position_amt,
          broker_fetched_at_ms: brokerFetchedAtMs,
          source: "broker_position_truth",
          symbol: row.symbol,
          age_ms: row.age_ms,
        },
      };
      try {
        await putV2Doc({
          env,
          collectionKey: "POSITION_CYCLES",
          doc: patch,
          merge: true,
        });
        writes.push({ ok: true, position_cycle_id: row.position_cycle_id, symbol: row.symbol });
      } catch (e) {
        writes.push({
          ok: false,
          position_cycle_id: row.position_cycle_id,
          symbol: row.symbol,
          error: e && e.message ? e.message : String(e),
        });
      }
    }
  }

  const report = {
    ok: true,
    apply: flags.apply,
    generated_at_iso: new Date(nowMs).toISOString(),
    config: {
      cleanup_max_writes: CLEANUP_MAX_WRITES,
      cleanup_cycle_age_floor_ms: CLEANUP_CYCLE_AGE_FLOOR_MS,
      cleanup_query_limit: CLEANUP_QUERY_LIMIT,
    },
    broker_snapshot: {
      available: !!brokerByMap,
      fetched_at_ms: brokerFetchedAtMs,
      symbol_n: brokerByMap ? brokerByMap.size : 0,
    },
    summary: {
      active_protected_cycle_n: classified.length,
      stale_broker_flat_n: stale.length,
      stale_broker_flat_writeable_n: willWriteN,
      stale_broker_flat_overflow_n: overflowN,
      recently_opened_n: buckets.RECENTLY_OPENED.length,
      broker_live_n: buckets.BROKER_LIVE.length,
      unknown_n: buckets.UNKNOWN.length,
      unknown_age_n: buckets.UNKNOWN_AGE.length,
      missing_fields_n: buckets.MISSING_FIELDS.length,
    },
    stale_broker_flat_rows: stale,
    write_n: writes.length,
    writes,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!flags.apply && stale.length > 0) {
    console.error(`[cleanup_diagnose] ${stale.length} STALE_BROKER_FLAT candidate(s). Re-run with --apply to write.`);
  }
  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  __test: {
    classifyCycle,
    parseArgs,
    resolveCycleAgeMs,
  },
};
