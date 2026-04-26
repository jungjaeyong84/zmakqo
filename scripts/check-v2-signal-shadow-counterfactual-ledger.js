#!/usr/bin/env node
"use strict";

// F0/F1 signal shadow counterfactual ledger contract gate.
//
// Verifies the standalone module's invariants without touching live
// Firestore or fetching real klines. Designed to be runnable in CI
// (no I/O) before any caller migration.

const ledger = require("../src/v2/signalShadowCounterfactualLedger");

function fail(reason, detail) {
  console.error(JSON.stringify({
    ok: false,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_GATE_FAILED",
    blocker: reason,
    detail: detail || null,
  }));
  process.exit(1);
}

function require_(condition, reason, detail) {
  if (!condition) fail(reason, detail);
}

function assertExports() {
  const expected = [
    "COLLECTION_NAME",
    "DEFAULT_HORIZON_BARS",
    "DEFAULT_BAR_INTERVAL_MS",
    "DEFAULT_MAX_AGE_MS",
    "STATUS_PENDING",
    "STATUS_CLOSED",
    "STATUS_EXPIRED",
    "resolveCounterfactualLedgerPolicy",
    "buildFilterCombinationHash",
    "buildCounterfactualDocId",
    "buildCounterfactualDocPath",
    "extractFilterSetsFromShadowDecision",
    "buildPendingRecord",
    "evaluatePendingExpiry",
    "closeRecordFromKlines",
    "buildExpiredUpdate",
    "recordCounterfactualEvaluation",
    "closeCounterfactualRecord",
    "walkPendingCounterfactuals",
  ];
  for (const key of expected) {
    require_(ledger[key] !== undefined, "MISSING_EXPORT", { key });
  }
}

function assertPolicyDefaults() {
  const p = ledger.resolveCounterfactualLedgerPolicy({});
  require_(p.enabled === false, "DEFAULT_DISABLED");
  require_(p.horizon_bars === 24, "DEFAULT_HORIZON_24");
  require_(p.bar_interval_ms === 15 * 60 * 1000, "DEFAULT_BAR_15M");
  require_(p.max_age_ms === 7 * 24 * 60 * 60 * 1000, "DEFAULT_MAX_AGE_7D");
}

function assertCollectionNamespace() {
  require_(ledger.COLLECTION_NAME === "v2__signal_shadow_counterfactuals", "COLLECTION_NAME");
  const path = ledger.buildCounterfactualDocPath("DOC");
  require_(path === "v2__signal_shadow_counterfactuals/DOC", "DOC_PATH_NAMESPACED");
}

function assertHashOrderIndependence() {
  const a = ledger.buildFilterCombinationHash({
    would_block_filter_set: ["B", "A"],
    would_pass_filter_set: ["X"],
    insufficient_evidence_filter_set: ["Q"],
  });
  const b = ledger.buildFilterCombinationHash({
    would_block_filter_set: ["A", "B"],
    would_pass_filter_set: ["X"],
    insufficient_evidence_filter_set: ["Q"],
  });
  require_(a === b, "HASH_ORDER_INDEPENDENT");
  const c = ledger.buildFilterCombinationHash({
    would_block_filter_set: ["A"],
    would_pass_filter_set: ["X"],
  });
  require_(a !== c, "HASH_DIFFERS_BY_CONTENT");
}

function assertExtractFilterSets() {
  const sets = ledger.extractFilterSetsFromShadowDecision({
    filters: [
      { id: "BTC_1H_TREND_ALT_LONG", status: "WOULD_BLOCK", would_block: true },
      { id: "MULTI_TF_1H_ALIGNMENT", status: "WOULD_PASS", would_block: false },
      { id: "VOLATILITY_CHAOS_30M", status: "INSUFFICIENT_EVIDENCE" },
      { id: "COST_ADJUSTED_EDGE", status: "NOT_APPLICABLE" },
    ],
  });
  require_(
    sets.would_block_filter_set.length === 1
    && sets.would_block_filter_set[0] === "BTC_1H_TREND_ALT_LONG",
    "WOULD_BLOCK_SET"
  );
  require_(
    sets.would_pass_filter_set.length === 1
    && sets.would_pass_filter_set[0] === "MULTI_TF_1H_ALIGNMENT",
    "WOULD_PASS_SET"
  );
  require_(
    sets.insufficient_evidence_filter_set.length === 1
    && sets.insufficient_evidence_filter_set[0] === "VOLATILITY_CHAOS_30M",
    "INSUFFICIENT_SET"
  );
}

function assertPendingRecordContract() {
  const t0 = 1_700_000_000_000;
  const out = ledger.buildPendingRecord({
    symbol: "btcusdt",
    side: "buy",
    candle_close_ms: t0,
    ref_price: 50000,
    signal_verdict: "PASS",
    shadow_filter_decision: {
      shadow_verdict: "WOULD_PASS",
      filters: [{ id: "MULTI_TF_1H_ALIGNMENT", status: "WOULD_PASS", would_block: false }],
    },
    horizon_bars: 24,
    bar_interval_ms: 15 * 60 * 1000,
    now_ms: t0,
  });
  require_(out.record.symbol === "BTCUSDT", "SYMBOL_NORMALIZED");
  require_(out.record.side === "LONG", "SIDE_NORMALIZED");
  require_(out.record.status === "PENDING", "STATUS_PENDING");
  require_(out.record.horizon_close_ms === t0 + 24 * 15 * 60 * 1000, "HORIZON_COMPUTED");
  require_(out.doc_path === `v2__signal_shadow_counterfactuals/${out.doc_id}`, "DOC_PATH");
}

function assertExpiryDecisionContract() {
  const t0 = 1_700_000_000_000;
  const horizon = t0 + 24 * 15 * 60 * 1000;
  const wait = ledger.evaluatePendingExpiry({
    pending: { status: "PENDING", horizon_close_ms: horizon, created_at_ms: t0 },
    now_ms: t0 + 60_000,
  });
  require_(wait.action === "WAIT", "BEFORE_HORIZON_WAIT");
  const close = ledger.evaluatePendingExpiry({
    pending: { status: "PENDING", horizon_close_ms: horizon, created_at_ms: t0 },
    now_ms: horizon + 1,
  });
  require_(close.action === "CLOSE", "HORIZON_CLOSE");
  const expire = ledger.evaluatePendingExpiry({
    pending: { status: "PENDING", horizon_close_ms: horizon, created_at_ms: t0 },
    now_ms: t0 + 8 * 24 * 60 * 60 * 1000,
    max_age_ms: 7 * 24 * 60 * 60 * 1000,
  });
  require_(expire.action === "EXPIRE", "MAX_AGE_EXPIRE");
  const skip = ledger.evaluatePendingExpiry({
    pending: { status: "CLOSED", horizon_close_ms: horizon, created_at_ms: t0 },
    now_ms: horizon + 1,
  });
  require_(skip.action === "SKIP", "CLOSED_SKIP");
}

function assertCloseFromKlinesContract() {
  const t0 = 1_700_000_000_000;
  const longPending = {
    side: "LONG",
    ref_price: 100,
    candle_close_ms: t0,
    horizon_close_ms: t0 + 4 * 15 * 60 * 1000,
    bar_interval_ms: 15 * 60 * 1000,
  };
  const klines = [
    [t0, 100, 110, 99, 108],
    [t0 + 15 * 60 * 1000, 108, 109, 95, 96],
  ];
  const update = ledger.closeRecordFromKlines({ pending: longPending, klines, now_ms: t0 + 4 * 15 * 60 * 1000 });
  require_(update.status === "CLOSED", "STATUS_CLOSED");
  require_(update.bar_n_observed === 2, "BAR_N");
  require_(Math.abs(update.mfe_pct - 0.10) < 1e-9, "MFE_LONG_10PCT", { mfe_pct: update.mfe_pct });
  require_(Math.abs(update.mae_pct - 0.05) < 1e-9, "MAE_LONG_5PCT", { mae_pct: update.mae_pct });
  require_(Math.abs(update.exit_close_pct - (-0.04)) < 1e-9, "EXIT_LONG_NEG4", { exit_close_pct: update.exit_close_pct });
}

(async () => {
  assertExports();
  assertPolicyDefaults();
  assertCollectionNamespace();
  assertHashOrderIndependence();
  assertExtractFilterSets();
  assertPendingRecordContract();
  assertExpiryDecisionContract();
  assertCloseFromKlinesContract();
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_GATE_PASS",
    check_n: 8,
  }));
})().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_GATE_THROWN",
    error_message: error && error.message ? error.message : String(error),
  }));
  process.exit(1);
});
