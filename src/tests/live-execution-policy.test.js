const assert = require("assert");
const { evaluateLiveEntryPolicy, __test } = require("../utils/liveExecutionPolicy");

function buildSnapshot({
  allocatorRows = [],
  allocatorSummary = null,
  quarantineRows = [],
  quarantineSummary = null,
  qualityRows = [],
  policyPlanSummary = null,
  policyPlanRows = [],
  objectiveSummary = null,
  lineageSummary = null,
  driftRemediationApply = null,
} = {}) {
  const nowIso = new Date().toISOString();
  return __test.buildSnapshotFromArtifacts({
    allocatorDoc: { summary: { ...(allocatorSummary || {}), by_market: allocatorRows } },
    quarantineDoc: { summary: { ...(quarantineSummary || {}), by_market: quarantineRows } },
    executionQualityDoc: { summary: { by_market: qualityRows } },
    policyParameterPlanDoc: { summary: { ...(policyPlanSummary || {}) }, recommendations: { by_market: policyPlanRows } },
    objectiveSupervisorDoc: { summary: { ...(objectiveSummary || {}) } },
    lineageHealthDoc: {
      generated_at: nowIso,
      summary: {
        intents_signal_doc_id_null_rate: 0,
        fills_signal_doc_id_null_rate: 0,
        fills_intent_id_null_rate: 0,
        entry_fills_intent_id_null_rate: 0,
        ...(lineageSummary || {}),
      },
    },
    driftRemediationApplyDoc: driftRemediationApply,
  });
}

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "AXSUSDT", allocation_score: -8.1, recommended_action: "QUARANTINE" }],
    quarantineRows: [{ market: "AXSUSDT", quarantine_reason: "EXECUTION_QUALITY_PENALTY" }],
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    intent: "ENTRY",
    qtyPct: 0.8,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "LIVE_POLICY_QUARANTINE_HARD_BLOCK");
  assert.strictEqual(res.featuresPatch._live_exec_policy_plan_enabled, true);
  assert.strictEqual(res.featuresPatch._live_exec_policy_plan_status, null);
  assert.strictEqual(res.featuresPatch._live_exec_policy_quarantine_reason, "EXECUTION_QUALITY_PENALTY");
  assert.strictEqual(res.featuresPatch._live_exec_policy_quality_global_status, null);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "AXSUSDT", allocation_score: -8.1, recommended_action: "QUARANTINE" }],
    allocatorSummary: { learning_epoch_active: true },
    quarantineRows: [{ market: "AXSUSDT", quarantine_reason: "EXECUTION_QUALITY_PENALTY" }],
    quarantineSummary: { learning_epoch_active: true },
    qualityRows: [{ market: "AXSUSDT", avg_created_to_fill_ms: 100000, partial_fill_rate_pct: 30, avg_slippage_bps: 1 }],
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    intent: "ENTRY",
    qtyPct: 0.8,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.policy.learning_epoch_exception_release_active, true);
  assert.strictEqual(res.featuresPatch._live_exec_policy_learning_epoch_exception_release_active, true);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "BTCUSDT", allocation_score: 2.0, recommended_action: "INCREASE" }],
    qualityRows: [{ market: "BTCUSDT", avg_created_to_fill_ms: 10000, partial_fill_rate_pct: 99 }],
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ADD",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "EXECUTION_QUALITY_PARTIAL_HARD_BLOCK");
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "AXSUSDT", allocation_score: -8.0, recommended_action: "HOLD" }],
    allocatorSummary: { learning_epoch_active: true },
    quarantineSummary: { learning_epoch_active: true },
    qualityRows: [{ market: "AXSUSDT", avg_created_to_fill_ms: 100000, partial_fill_rate_pct: 30, avg_slippage_bps: 1 }],
    policyPlanSummary: { status: "HOLD", mode: "ADVISORY_ONLY", global_qty_scale: 0.55 },
    policyPlanRows: [{ market: "AXSUSDT", qty_scale: 0, mode: "WATCH_ONLY" }],
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    applyPolicyPlan: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.policy.learning_epoch_exception_release_active, true);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "ETHUSDT", allocation_score: -1.2, recommended_action: "HOLD" }],
    qualityRows: [{ market: "ETHUSDT", avg_created_to_fill_ms: 350000, partial_fill_rate_pct: 68, avg_slippage_bps: 0 }],
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    intent: "ENTRY",
    qtyPct: 1,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.ok(Number.isFinite(Number(res.qtyPctFinal)));
  assert.ok(res.qtyPctFinal > 0 && res.qtyPctFinal < 1);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "ETHUSDT", allocation_score: 0.5, recommended_action: "HOLD" }],
    allocatorSummary: { learning_epoch_active: true },
    quarantineSummary: { learning_epoch_active: true },
    qualityRows: [{ market: "ETHUSDT", avg_created_to_fill_ms: 1000, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }],
    driftRemediationApply: {
      applied: true,
      effective: {
        other_server_policy_watch_only_markets_by_reason: {
          LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: ["ETHUSDT"],
        },
      },
      changes: {
        other_server_policy_watch_only_markets: {
          next: ["ETHUSDT"],
        },
      },
    },
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.policy.learning_epoch_exception_release_active, true);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "BNBUSDT", allocation_score: 5.0, recommended_action: "INCREASE" }],
    qualityRows: [{ market: "BNBUSDT", avg_created_to_fill_ms: 150000, partial_fill_rate_pct: 20, avg_slippage_bps: 2 }],
    policyPlanSummary: { status: "READY", mode: "APPLY_READY", global_qty_scale: 0.55 },
    policyPlanRows: [{ market: "BNBUSDT", qty_scale: 0.8, mode: "ACTIVE" }],
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    applyPolicyPlan: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.ok(res.qtyPctFinal > 0.25 && res.qtyPctFinal < 0.3);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "AXSUSDT", allocation_score: -8.0, recommended_action: "HOLD" }],
    qualityRows: [{ market: "AXSUSDT", avg_created_to_fill_ms: 100000, partial_fill_rate_pct: 30, avg_slippage_bps: 1 }],
    policyPlanSummary: { status: "HOLD", mode: "ADVISORY_ONLY", global_qty_scale: 0.55 },
    policyPlanRows: [{ market: "AXSUSDT", qty_scale: 0, mode: "WATCH_ONLY" }],
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    applyPolicyPlan: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "LIVE_POLICY_PLAN_WATCH_ONLY_BLOCK");
  assert.strictEqual(res.featuresPatch._live_exec_policy_plan_status, "HOLD");
  assert.strictEqual(res.featuresPatch._live_exec_policy_plan_mode, "WATCH_ONLY");
  assert.strictEqual(res.featuresPatch._live_exec_policy_plan_global_scale, 0.55);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "XRPUSDT", allocation_score: -3.0, recommended_action: "REDUCE" }],
    qualityRows: [{ market: "XRPUSDT", avg_created_to_fill_ms: 120000, partial_fill_rate_pct: 20, avg_slippage_bps: 4 }],
    policyPlanSummary: { status: "HOLD", mode: "ADVISORY_ONLY", global_qty_scale: 1 },
    policyPlanRows: [{ market: "XRPUSDT", qty_scale: 0, mode: "ACTIVE" }],
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    applyPolicyPlan: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "LIVE_POLICY_PLAN_HOLD_BLOCK");
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "BTCUSDT", allocation_score: 1.0, recommended_action: "HOLD" }],
    qualityRows: [{ market: "BTCUSDT", avg_created_to_fill_ms: 1000, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }],
    objectiveSummary: { objective_score: -9, objective_verdict: "HOLD", count_floor_pass: false },
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ENTRY",
    qtyPct: 1,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.ok(res.qtyPctFinal > 0 && res.qtyPctFinal < 0.8);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "ETHUSDT", allocation_score: 0.5, recommended_action: "HOLD" }],
    qualityRows: [{ market: "ETHUSDT", avg_created_to_fill_ms: 1000, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }],
    driftRemediationApply: {
      applied: true,
      effective: {
        other_server_policy_watch_only_markets_by_reason: {
          LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: ["ETHUSDT"],
        },
      },
      changes: {
        other_server_policy_watch_only_markets: {
          next: ["ETHUSDT"],
        },
      },
    },
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "LIVE_POLICY_OTHER_SERVER_POLICY_WATCH_ONLY_BLOCK");
  assert.deepStrictEqual(res.policy.other_server_policy_watch_only_reasons, ["LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED"]);
  assert.deepStrictEqual(res.featuresPatch._live_exec_policy_other_server_policy_watch_only_reasons, ["LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED"]);
})();

(() => {
  const nowMs = Date.now();
  const snap = __test.buildSnapshotFromArtifacts({
    allocatorDoc: { summary: { by_market: [{ market: "BTCUSDT", allocation_score: 1, recommended_action: "HOLD" }] } },
    quarantineDoc: { summary: { by_market: [] } },
    executionQualityDoc: { summary: { by_market: [{ market: "BTCUSDT", avg_created_to_fill_ms: 100, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }] } },
    lineageHealthDoc: {
      generated_at: new Date(nowMs - (5 * 60 * 60 * 1000)).toISOString(),
      summary: {
        intents_signal_doc_id_null_rate: 0.4,
        fills_signal_doc_id_null_rate: 0,
        fills_intent_id_null_rate: 0,
      },
    },
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.ok(String(res.reason || "").startsWith("LINEAGE_SLO_"));
  assert.strictEqual(res.policy.lineage_report_path, "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/signal_lineage_health_latest.json");
  assert.ok(Number.isFinite(Number(res.policy.lineage_report_age_ms)));
  assert.strictEqual(typeof res.policy.lineage_report_generated_at_kst, "string");
  assert.strictEqual(res.policy.lineage_report_source, "ARTIFACT_TIMESTAMP");
  assert.strictEqual(res.featuresPatch._live_exec_policy_lineage_report_path, "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/signal_lineage_health_latest.json");
  assert.ok(Number.isFinite(Number(res.featuresPatch._live_exec_policy_lineage_report_age_ms)));
  assert.strictEqual(typeof res.featuresPatch._live_exec_policy_lineage_report_generated_at_kst, "string");
  assert.strictEqual(res.featuresPatch._live_exec_policy_lineage_report_source, "ARTIFACT_TIMESTAMP");
  assert.strictEqual(res.featuresPatch._live_exec_policy_lineage_report_missing, false);
})();

(() => {
  const snap = __test.buildSnapshotFromArtifacts({
    allocatorDoc: { summary: { by_market: [{ market: "BTCUSDT", allocation_score: 1, recommended_action: "HOLD" }] } },
    quarantineDoc: { summary: { by_market: [] } },
    executionQualityDoc: { summary: { by_market: [{ market: "BTCUSDT", avg_created_to_fill_ms: 100, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }] } },
    lineageHealthDoc: {
      summary: {
        intents_signal_doc_id_null_rate: 0,
        fills_signal_doc_id_null_rate: 0,
        fills_intent_id_null_rate: 0,
      },
    },
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "LINEAGE_SLO_REPORT_MISSING");
  assert.strictEqual(res.policy.lineage_report_missing, true);
  assert.strictEqual(res.policy.lineage_report_source, null);
  assert.strictEqual(res.featuresPatch._live_exec_policy_lineage_report_missing, true);
  assert.strictEqual(res.featuresPatch._live_exec_policy_lineage_report_source, null);
})();

(() => {
  const nowMs = Date.now();
  const snap = __test.buildSnapshotFromArtifacts({
    allocatorDoc: { summary: { by_market: [{ market: "BTCUSDT", allocation_score: 1, recommended_action: "HOLD" }] } },
    quarantineDoc: { summary: { by_market: [] } },
    executionQualityDoc: { summary: { by_market: [{ market: "BTCUSDT", avg_created_to_fill_ms: 100, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }] } },
    lineageHealthMtimeMs: nowMs - (60 * 1000),
    lineageHealthDoc: {
      summary: {
        intents_signal_doc_id_null_rate: 0,
        fills_signal_doc_id_null_rate: 0,
        fills_intent_id_null_rate: 0,
      },
    },
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
})();

(() => {
  const nowMs = Date.now();
  const snap = __test.buildSnapshotFromArtifacts({
    allocatorDoc: { summary: { by_market: [{ market: "BTCUSDT", allocation_score: 1, recommended_action: "HOLD" }] } },
    quarantineDoc: { summary: { by_market: [] } },
    executionQualityDoc: { summary: { by_market: [{ market: "BTCUSDT", avg_created_to_fill_ms: 100, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }] } },
    lineageHealthMtimeMs: nowMs - (5 * 60 * 60 * 1000),
    lineageHealthDoc: {
      generated_at: new Date(nowMs - (5 * 60 * 60 * 1000)).toISOString(),
      summary: {
        intents_signal_doc_id_null_rate: 0,
        fills_signal_doc_id_null_rate: 0,
        fills_intent_id_null_rate: 0,
      },
    },
    lineageHealthSource: "FILE_MTIME",
    lineageSharedRefreshPending: true,
    lineageSharedSnapshotAvailable: false,
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.featuresPatch._live_exec_policy_lineage_shared_refresh_pending, true);
  assert.strictEqual(res.policy.lineage_shared_refresh_pending, true);
})();

(() => {
  const olderLocalIso = new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString();
  const newerSharedIso = new Date(Date.now() - (5 * 60 * 1000)).toISOString();
  const selected = __test.selectPreferredLineageInput({
    localDoc: { generated_at: olderLocalIso, summary: { fills_intent_id_null_rate: 0.03 } },
    localMtimeMs: Date.parse(olderLocalIso),
    sharedSnapshot: __test.normalizeSharedLineageSnapshot({
      updated_at: newerSharedIso,
      report: {
        generated_at: newerSharedIso,
        summary: {
          intents_signal_doc_id_null_rate: 0,
          fills_signal_doc_id_null_rate: 0,
          fills_intent_id_null_rate: 0.01,
        },
      },
    }),
  });
  assert.strictEqual(selected.path, "firestore:report_latest/LATEST__signal_lineage_health__GLOBAL");
  assert.strictEqual(selected.source, "FIRESTORE_REPORT_LATEST");
  assert.strictEqual(selected.mtimeMs, null);
  assert.strictEqual(selected.doc.summary.fills_intent_id_null_rate, 0.01);
})();

(() => {
  const nowMs = Date.now();
  const snap = __test.buildSnapshotFromArtifacts({
    allocatorDoc: { summary: { by_market: [{ market: "BTCUSDT", allocation_score: 1, recommended_action: "HOLD" }] } },
    quarantineDoc: { summary: { by_market: [] } },
    executionQualityDoc: { summary: { by_market: [{ market: "BTCUSDT", avg_created_to_fill_ms: 100, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }] } },
    lineageHealthMtimeMs: nowMs - (60 * 1000),
    lineageHealthDoc: {
      generated_at: new Date(nowMs - (60 * 1000)).toISOString(),
      summary: {
        intents_signal_doc_id_null_rate: 0,
        fills_signal_doc_id_null_rate: 0,
        fills_intent_id_null_rate: 0.2,
        entry_fills_intent_id_null_rate: 0,
        exit_fills_intent_id_null_rate: 1,
        external_reconciled_fills_intent_id_null_rate: 1,
      },
    },
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.reason, "LIVE_POLICY_OK");
})();

(() => {
  const nowMs = Date.now();
  const snap = __test.buildSnapshotFromArtifacts({
    allocatorDoc: { summary: { by_market: [{ market: "BTCUSDT", allocation_score: 1, recommended_action: "HOLD" }] } },
    quarantineDoc: { summary: { by_market: [] } },
    executionQualityDoc: { summary: { by_market: [{ market: "BTCUSDT", avg_created_to_fill_ms: 100, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }] } },
    lineageHealthMtimeMs: nowMs - (60 * 1000),
    lineageHealthDoc: {
      generated_at: new Date(nowMs - (60 * 1000)).toISOString(),
      summary: {
        intents_signal_doc_id_null_rate: 0,
        fills_signal_doc_id_null_rate: 0,
        fills_intent_id_null_rate: 0,
        entry_fills_intent_id_null_rate: 0.2,
      },
    },
  });
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: {},
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "LINEAGE_SLO_FILL_INTENT_NULL_RATE");
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "XRPUSDT", allocation_score: 1.0, recommended_action: "HOLD" }],
    qualityRows: [{ market: "XRPUSDT", avg_created_to_fill_ms: 1000, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }],
  });
  snap.activePositionsSnapshot = __test.buildActivePositionsSnapshot([
    { id: "POS__BINANCEFUT__DOGEUSDT", data: { pos_id: "POS__BINANCEFUT__DOGEUSDT", exchange: "BINANCEFUT", symbol_or_pair_id: "DOGEUSDT", position_side: "LONG", state: "COMMIT", size_pct: 0.4 } },
    { id: "POS__BINANCEFUT__SOLUSDT", data: { pos_id: "POS__BINANCEFUT__SOLUSDT", exchange: "BINANCEFUT", symbol_or_pair_id: "SOLUSDT", position_side: "LONG", state: "COMMIT", size_pct: 0.4 } },
  ]);
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    intent: "ENTRY",
    qtyPct: 0.4,
    features: { event: "LONG", side: "BUY" },
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.reason, "LIVE_POLICY_OK");
  assert.strictEqual(res.featuresPatch._live_exec_policy_portfolio_cluster_reduce, true);
  assert.strictEqual(res.featuresPatch._live_exec_policy_portfolio_cluster_same_side_after, 3);
  assert.strictEqual(res.featuresPatch._live_exec_policy_portfolio_cluster_correlated_same_side_after, 3);
  assert.ok(Number(res.featuresPatch._live_exec_policy_portfolio_cluster_scale) < 1);
  assert.ok(Number(res.qtyPctFinal) < 1);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "AXSUSDT", allocation_score: 1.0, recommended_action: "HOLD" }],
    qualityRows: [{ market: "AXSUSDT", avg_created_to_fill_ms: 1000, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }],
  });
  snap.activePositionsSnapshot = __test.buildActivePositionsSnapshot([
    { id: "POS__BINANCEFUT__BTCUSDT", data: { pos_id: "POS__BINANCEFUT__BTCUSDT", exchange: "BINANCEFUT", symbol_or_pair_id: "BTCUSDT", position_side: "LONG", state: "COMMIT", size_pct: 1 } },
    { id: "POS__BINANCEFUT__ETHUSDT", data: { pos_id: "POS__BINANCEFUT__ETHUSDT", exchange: "BINANCEFUT", symbol_or_pair_id: "ETHUSDT", position_side: "LONG", state: "COMMIT", size_pct: 1 } },
    { id: "POS__BINANCEFUT__SOLUSDT", data: { pos_id: "POS__BINANCEFUT__SOLUSDT", exchange: "BINANCEFUT", symbol_or_pair_id: "SOLUSDT", position_side: "LONG", state: "COMMIT", size_pct: 1 } },
  ]);
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    intent: "ENTRY",
    qtyPct: 0.5,
    features: { event: "LONG", side: "BUY" },
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "LIVE_POLICY_PORTFOLIO_CLUSTER_CAP_BLOCK");
  assert.strictEqual(res.policy.portfolio_cluster_same_side_after, 4);
  assert.strictEqual(res.policy.portfolio_cluster_correlated_same_side_after, 4);
})();

(() => {
  const snap = buildSnapshot({
    allocatorRows: [{ market: "DOGEUSDT", allocation_score: 1.0, recommended_action: "HOLD" }],
    qualityRows: [{ market: "DOGEUSDT", avg_created_to_fill_ms: 1000, partial_fill_rate_pct: 1, avg_slippage_bps: 1 }],
  });
  snap.activePositionsSnapshot = __test.buildActivePositionsSnapshot([
    { id: "POS__BINANCEFUT__BTCUSDT", data: { pos_id: "POS__BINANCEFUT__BTCUSDT", exchange: "BINANCEFUT", symbol_or_pair_id: "BTCUSDT", position_side: "LONG", state: "COMMIT", size_pct: 0.9 } },
    { id: "POS__BINANCEFUT__ETHUSDT", data: { pos_id: "POS__BINANCEFUT__ETHUSDT", exchange: "BINANCEFUT", symbol_or_pair_id: "ETHUSDT", position_side: "LONG", state: "COMMIT", size_pct: 0.8 } },
  ]);
  const res = evaluateLiveEntryPolicy({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    intent: "ENTRY",
    qtyPct: 1,
    features: { event: "LONG", side: "BUY" },
    stage: "TEST",
    applyScale: true,
    snapshotOverride: snap,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.reason, "LIVE_POLICY_OK");
  assert.strictEqual(res.featuresPatch._live_exec_policy_portfolio_cluster_reduce, true);
  assert.strictEqual(res.featuresPatch._live_exec_policy_reason, undefined);
  assert.strictEqual(res.policy.reason, undefined);
  assert.ok(Number(res.featuresPatch._live_exec_policy_portfolio_cluster_scale) < 0.35);
  assert.ok(Number(res.featuresPatch._live_exec_policy_portfolio_cluster_same_side_exposure_after) > 2.5);
})();

console.log("LIVE_EXECUTION_POLICY_TEST_OK");
