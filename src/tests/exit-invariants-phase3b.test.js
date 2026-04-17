"use strict";

// Regression tests for the Phase 3-B tickets P3-03, P3-04, P3-10 (verified),
// and the P3-01 pilot subscript migration.

const assert = require("assert");

const positionStateMachine = require("../services/positionStateMachine");
const reconciler = require("../services/binancePositionReconciler");
const fillsSync = require("../services/binanceFuturesFillsSync");
const duplicationReport = require("../../scripts/report-fill-sync-alert-duplication");

// ---------- P3-03 chainKey confidence telemetry ---------------------------
(() => {
  const PSM = positionStateMachine;
  // Strong: entry_event_id present → ENTRY confidence.
  const entry = PSM.resolveCanonicalExitChainKey({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__abc__1",
  });
  assert.strictEqual(entry.confidence, "ENTRY");
  assert.ok(entry.chainKey.startsWith("BINANCEFUT__BTCUSDT__ENTRY__"));

  // SIGNAL fallback.
  const signal = PSM.resolveCanonicalExitChainKey({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    signalDocId: "SIG__xyz",
  });
  assert.strictEqual(signal.confidence, "SIGNAL");

  // ORDER fallback.
  const order = PSM.resolveCanonicalExitChainKey({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    orderMeta: { orderId: 12345 },
  });
  assert.strictEqual(order.confidence, "ORDER");

  // CLIENT fallback.
  const client = PSM.resolveCanonicalExitChainKey({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    orderMeta: { clientOrderId: "dbj_live_xyz" },
  });
  assert.strictEqual(client.confidence, "CLIENT");

  // STAGE (weakest) fallback.
  const stageOnly = PSM.resolveCanonicalExitChainKey({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    currentStage: "TRAIL",
  });
  assert.strictEqual(stageOnly.confidence, "STAGE");

  // buildCanonicalExitChainKey still returns a string (backward compat).
  assert.strictEqual(typeof PSM.buildCanonicalExitChainKey({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "E1",
  }), "string");

  // The confidence labels are exported as a frozen enum.
  assert.strictEqual(PSM.CANONICAL_CHAIN_KEY_CONFIDENCE.ENTRY, "ENTRY");
  assert.strictEqual(PSM.CANONICAL_CHAIN_KEY_CONFIDENCE.STAGE, "STAGE");

  // fillsSync observes and counts low-confidence fallbacks; stage fallbacks
  // also emit a structured warn line (once per unique chainKey).
  const T = fillsSync.__test;
  T.resetFillSyncChainKeyConfidenceForTest();

  const logged = [];
  const origWarn = console.warn;
  console.warn = (...args) => logged.push(args.join(" "));
  try {
    T.observeExitAuthorityChainKeyConfidence({
      symbol: "BTCUSDT",
      event: "EXIT_TP_P1_3P",
      confidence: "ENTRY",
      chainKey: "BINANCEFUT__BTCUSDT__ENTRY__A",
    });
    T.observeExitAuthorityChainKeyConfidence({
      symbol: "BTCUSDT",
      event: "EXIT_TP_P1_3P",
      confidence: "STAGE",
      chainKey: "BINANCEFUT__BTCUSDT__STAGE__TP1",
    });
    T.observeExitAuthorityChainKeyConfidence({
      symbol: "BTCUSDT",
      event: "EXIT_TP_P1_3P",
      confidence: "STAGE",
      chainKey: "BINANCEFUT__BTCUSDT__STAGE__TP1",
    });
  } finally {
    console.warn = origWarn;
  }
  const counts = T.getFillSyncChainKeyConfidenceCounts();
  assert.strictEqual(counts.ENTRY, 1);
  assert.strictEqual(counts.STAGE, 2);
  const stageWarnings = logged.filter((l) => l.includes("FILL_SYNC_CHAIN_KEY_LOW_CONFIDENCE"));
  assert.strictEqual(stageWarnings.length, 1, "stage fallback must dedupe logs per chainKey");
  T.resetFillSyncChainKeyConfidenceForTest();
})();

// ---------- P3-04 reconciler FLAT trail context preservation -------------
(() => {
  const R = reconciler.__test;

  // No trail context on meta → no frozen mirror.
  const flatNoTrail = R.buildFlatMetaProjection({
    tp_p1_done: false,
    trail_active: false,
    canonical_exit_stage: null,
  });
  assert.strictEqual(flatNoTrail.frozen_trail_active, undefined,
    "no trail_active → no frozen mirror");

  // Trail was active → frozen mirror + alert on FLAT projection.
  const logged = [];
  const origWarn = console.warn;
  console.warn = (...args) => logged.push(args.join(" "));
  let flatWithTrail;
  try {
    flatWithTrail = R.buildFlatMetaProjection({
      tp_p0_done: true,
      tp_p1_done: true,
      trail_active: true,
      canonical_exit_stage: "TRAIL",
      canonical_exit_chain_key: "BINANCEFUT__BTCUSDT__ENTRY__X",
      trail_high: 101.5,
      runner_remaining_qty_abs: 0.5,
    });
  } finally {
    console.warn = origWarn;
  }
  // The flat projection still writes the zeroed fields.
  assert.strictEqual(flatWithTrail.trail_active, false);
  assert.strictEqual(flatWithTrail.canonical_exit_stage, null);
  // But the frozen mirror preserves the prior canonical context.
  assert.strictEqual(flatWithTrail.frozen_canonical_exit_stage, "TRAIL");
  assert.strictEqual(flatWithTrail.frozen_canonical_exit_chain_key, "BINANCEFUT__BTCUSDT__ENTRY__X");
  assert.strictEqual(flatWithTrail.frozen_trail_active, true);
  assert.ok(Number.isFinite(flatWithTrail.frozen_trail_high));
  assert.strictEqual(flatWithTrail.frozen_runner_remaining_qty_abs, 0.5);
  assert.ok(typeof flatWithTrail.frozen_trail_context_at === "string");

  // A structured alert was emitted.
  assert.ok(
    logged.some((l) => l.includes("RECONCILER_FLAT_PROJECTION_TRAIL_CONTEXT_LOST")),
    "FLAT projection with active trail must emit a trail-context-lost alert"
  );
})();

// ---------- P3-10 tick-exit writer single-source invariant ---------------
(() => {
  const paperRunner = require("../engine/paperBinanceRunner");
  const tickExitSource = "BINANCE_TICK_EXIT";
  // Authorised source passes the gate.
  assert.strictEqual(
    paperRunner.__test.isAuthorizedBinanceNativeStopWriter(tickExitSource),
    true,
    "tick-exit must be the authorised writer source"
  );
  // Every other source including fast-lane variants is refused upstream.
  for (const source of ["TICK_EXIT_FAST_LANE", "LIVE_EXECUTOR", "WATCHDOG", "REPAIR", ""]) {
    assert.strictEqual(
      paperRunner.__test.isAuthorizedBinanceNativeStopWriter(source),
      false,
      `unexpected source must not write native stop: ${source}`
    );
  }
  // refreshBinanceNativeProtectionWithRetry refuses a non-authority caller and
  // does NOT consume a lease when the writerSource gate fails — that was the
  // key property P3-10 pins.
  (async () => {
    const res = await paperRunner.refreshBinanceNativeProtectionWithRetry({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      writerSource: "FAST_LANE",
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(res.reason, "NATIVE_STOP_WRITE_NON_AUTHORITY_LAYER");
    // attempts=0 proves we did not even try to acquire the lease or place
    // an order; the gate bailed out before any external side effect.
    assert.strictEqual(res.attempts, 0);
  })().catch((err) => {
    console.error("P3_10_ASYNC_FAIL", err);
    process.exit(1);
  });
})();

// ---------- P3-01 pilot: subscript uses shared cache when fresh ---------
(() => {
  const S = duplicationReport.__test;
  const sinceIso = new Date(Date.now() - 60_000).toISOString();
  // Cache row shape matches what the shared cache writer produces (rows are
  // {__id, ...doc_data}).
  const cache = {
    __path: "/tmp/cache.json",
    __mtime_ms: Date.now(),
    lookback_ms: 48 * 60 * 60 * 1000,
    collections: {
      fills_paper: {
        rows: [
          { __id: "EXT__A", created_at: new Date().toISOString(), event: "EXIT_TP_P1_3P" },
          { __id: "LOCAL__B", created_at: new Date().toISOString(), event: "EXIT_TP_P1_3P" },
          { __id: "EXT__C", created_at: new Date().toISOString(), event: "ENTRY_LONG_REAL" },
        ],
      },
    },
  };
  const result = S.scanCachedExternalExitFills(cache, sinceIso);
  assert.ok(result, "cache-based scan must return rows");
  assert.strictEqual(result.rows.length, 1, "only EXT__ exit-like fills survive the filter");
  assert.strictEqual(result.rows[0].id, "EXT__A");

  const empty = S.scanCachedExternalExitFills(
    { __path: null, __mtime_ms: null, lookback_ms: 0, collections: {} },
    sinceIso
  );
  assert.strictEqual(empty, null, "missing cache rows → null (caller falls back)");
})();

console.log("EXIT_INVARIANTS_PHASE3B_TEST_OK");
