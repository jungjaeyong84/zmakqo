"use strict";

const assert = require("assert");
const { buildSystemSloState, __test } = require("../services/systemSloRuntime");

function run() {
  const nowMs = Date.parse("2026-04-11T09:00:00.000Z");
  const healthy = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 1200,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    nowMs,
  });
  assert.strictEqual(healthy.status, "PASS");
  assert.strictEqual(healthy.block_new_entries, false);
  assert.deepStrictEqual(healthy.issues, []);
  assert.ok(healthy.slo_budget);
  assert.ok(healthy.slo_budget_burn);

  const blocked = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "BLOCK",
      reason: "OPS_GUARD_BLOCK",
      block_new_entries: true,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 1200,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    nowMs,
  });
  assert.strictEqual(blocked.status, "BLOCK");
  assert.strictEqual(blocked.reason, "OPS_GUARD_STOP");
  assert.strictEqual(blocked.block_new_entries, true);

  const held = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "보류",
      reason: "OPS_GUARD_HOLD",
      block_new_entries: true,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 1200,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    nowMs,
  });
  assert.strictEqual(held.status, "WARN");
  assert.strictEqual(held.reason, "OPS_GUARD_HOLD");
  assert.strictEqual(held.block_new_entries, true);

  const softScaled = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "보류",
      reason: "OPS_GUARD_HOLD_COST_SOFT_SCALE",
      block_new_entries: false,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 1200,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    nowMs,
  });
  assert.strictEqual(softScaled.status, "PASS");
  assert.strictEqual(softScaled.reason, "SYSTEM_SLO_HEALTHY");
  assert.strictEqual(softScaled.block_new_entries, false);

  const trailGap = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 1200,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    nativeTrailProtection: {
      gap_count: 1,
      top_symbols: [{ symbol: "ETHUSDT", count: 1 }],
    },
    nowMs,
  });
  assert.strictEqual(trailGap.status, "WARN");
  assert.strictEqual(trailGap.reason, "NATIVE_TRAIL_PROTECTION_GAP");
  assert.strictEqual(trailGap.block_new_entries, true);
  assert.ok(trailGap.issues.includes("NATIVE_TRAIL_PROTECTION_GAP"));
  assert.strictEqual(trailGap.components.native_trail_protection_gap_count, 1);

  const legacyFallbackAllowed = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_REVIEW",
        guard_created_to_fill_p95_ms: 3979,
        webhook_to_fill_p95_ms: 3979,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
        top_operational_webhook_delay_cause: "LEGACY_WEBHOOK_OUTCOME_ONLY",
        top_operational_immediate_intent_delay_group: null,
        review_reasons: ["LEGACY_LATENCY_GUARD_FALLBACK_ACTIVE"],
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    nowMs,
  });
  assert.strictEqual(legacyFallbackAllowed.status, "PASS");
  assert.ok(!legacyFallbackAllowed.issues.includes("EXECUTION_LATENCY_P95_HIGH"));
  assert.strictEqual(legacyFallbackAllowed.components.execution_quality_latency_p95_budget_ms, 5000);
  assert.strictEqual(legacyFallbackAllowed.components.execution_quality_latency_legacy_fallback, true);

  const realLatencyWarn = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_REVIEW",
        guard_created_to_fill_p95_ms: 3979,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
        top_operational_webhook_delay_cause: "IMMEDIATE_INTENT_DELAY",
        top_operational_immediate_intent_delay_group: "CREATE_TO_ORDER_ACK",
        review_reasons: [],
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    nowMs,
  });
  assert.strictEqual(realLatencyWarn.status, "WARN");
  assert.ok(realLatencyWarn.issues.includes("EXECUTION_LATENCY_P95_HIGH"));
  assert.strictEqual(realLatencyWarn.components.execution_quality_latency_p95_budget_ms, 3000);
  assert.strictEqual(realLatencyWarn.components.execution_quality_latency_legacy_fallback, false);

  const legacyFallbackStillWarnsWhenTooHigh = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_REVIEW",
        guard_created_to_fill_p95_ms: 5100,
        webhook_to_fill_p95_ms: 5100,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
        top_operational_webhook_delay_cause: "LEGACY_WEBHOOK_OUTCOME_ONLY",
        top_operational_immediate_intent_delay_group: null,
        review_reasons: ["LEGACY_LATENCY_GUARD_FALLBACK_ACTIVE"],
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    nowMs,
  });
  assert.strictEqual(legacyFallbackStillWarnsWhenTooHigh.status, "WARN");
  assert.ok(legacyFallbackStillWarnsWhenTooHigh.issues.includes("EXECUTION_LATENCY_P95_HIGH"));

  const outboxLineageSoftWarn = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 1200,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    tradeAlertOutboxLineage: {
      ok: false,
      reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_BLOCKED",
      issue_row_n: 1,
      checked_row_n: 7,
    },
    nowMs,
  });
  assert.strictEqual(outboxLineageSoftWarn.status, "WARN");
  assert.strictEqual(outboxLineageSoftWarn.block_new_entries, false);
  assert.ok(outboxLineageSoftWarn.issues.includes("TRADE_ALERT_OUTBOX_SCHEMA_WARN"));
  assert.strictEqual(outboxLineageSoftWarn.components.trade_alert_outbox_lineage_issue_row_n, 1);

  const originalOutboxHardBlock = process.env.SYSTEM_SLO_TRADE_ALERT_OUTBOX_LINEAGE_HARD_BLOCK;
  process.env.SYSTEM_SLO_TRADE_ALERT_OUTBOX_LINEAGE_HARD_BLOCK = "1";
  const outboxLineageHardBlock = buildSystemSloState({
    exchange: "BINANCEFUT",
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        generated_at: "2026-04-11T08:30:00.000Z",
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 1200,
        partial_fill_rate_pct: 12,
        adverse_slippage_p95_bps: 8,
      },
    },
    lineageHealth: {
      summary: {
        generated_at: "2026-04-11T08:31:00.000Z",
        intents_signal_doc_id_null_rate: 0.001,
        fills_signal_doc_id_null_rate: 0.001,
        entry_fills_intent_id_null_rate: 0.001,
      },
    },
    tradeAlertOutboxLineage: {
      ok: false,
      reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_BLOCKED",
      issue_row_n: 1,
      checked_row_n: 7,
    },
    nowMs,
  });
  if (originalOutboxHardBlock === undefined) delete process.env.SYSTEM_SLO_TRADE_ALERT_OUTBOX_LINEAGE_HARD_BLOCK;
  else process.env.SYSTEM_SLO_TRADE_ALERT_OUTBOX_LINEAGE_HARD_BLOCK = originalOutboxHardBlock;
  assert.strictEqual(outboxLineageHardBlock.status, "BLOCK");
  assert.strictEqual(outboxLineageHardBlock.block_new_entries, true);
  assert.ok(outboxLineageHardBlock.issues.includes("TRADE_ALERT_OUTBOX_LINEAGE_MISMATCH"));

  const staleLoaded = __test.normalizeLoadedSystemSloState({
    status: "PASS",
    reason: "SYSTEM_SLO_HEALTHY",
    block_new_entries: false,
    generated_at_ms: nowMs - (7 * 60 * 60 * 1000),
    max_age_ms: 6 * 60 * 60 * 1000,
  }, nowMs);
  assert.strictEqual(staleLoaded.status, "BLOCK");
  assert.strictEqual(staleLoaded.reason, "SYSTEM_SLO_STATE_STALE");
  assert.strictEqual(staleLoaded.block_new_entries, true);
}

try {
  run();
  console.log("SYSTEM_SLO_RUNTIME_TEST_OK");
} catch (err) {
  console.error("SYSTEM_SLO_RUNTIME_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
