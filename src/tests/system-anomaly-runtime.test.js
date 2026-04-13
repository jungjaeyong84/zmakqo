"use strict";

const assert = require("assert");
const { buildSystemAnomalyState, __test } = require("../services/systemAnomalyRuntime");

function run() {
  const nowMs = Date.parse("2026-04-11T09:00:00.000Z");
  const clear = buildSystemAnomalyState({
    exchange: "BINANCEFUT",
    systemSlo: {
      status: "PASS",
      reason: "SYSTEM_SLO_HEALTHY",
      block_new_entries: false,
    },
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
      audit_issue_count: 0,
      qty_pct_non_positive_count: 0,
      error_count: 0,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 900,
        partial_fill_rate_pct: 12,
      },
    },
    nowMs,
  });
  assert.strictEqual(clear.status, "CLEAR");
  assert.strictEqual(clear.circuit_breaker_open, false);
  assert.deepStrictEqual(clear.issues, []);

  const blocked = buildSystemAnomalyState({
    exchange: "BINANCEFUT",
    systemSlo: {
      status: "BLOCK",
      reason: "OPS_GUARD_BLOCK",
      block_new_entries: true,
    },
    operationalGuard: {
      status: "WARN",
      reason: "AUDIT_ISSUE",
      block_new_entries: false,
      audit_issue_count: 2,
      qty_pct_non_positive_count: 0,
      error_count: 0,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 900,
        partial_fill_rate_pct: 12,
      },
    },
    nowMs,
  });
  assert.strictEqual(blocked.status, "BLOCK");
  assert.strictEqual(blocked.reason, "ANOMALY_SYSTEM_SLO_BLOCK");
  assert.strictEqual(blocked.circuit_breaker_open, true);
  assert.strictEqual(blocked.guard_action, "BLOCK_NEW_ENTRIES");
  assert.strictEqual(blocked.rollback_action, "REQUEST_ML_ROLLBACK");
  assert.ok(blocked.issues.includes("ANOMALY_AUDIT_ISSUE_PRESENT"));

  const held = buildSystemAnomalyState({
    exchange: "BINANCEFUT",
    systemSlo: {
      status: "WARN",
      reason: "OPS_GUARD_HOLD",
      block_new_entries: true,
    },
    operationalGuard: {
      status: "보류",
      reason: "OPS_GUARD_HOLD",
      block_new_entries: true,
      audit_issue_count: 0,
      qty_pct_non_positive_count: 0,
      error_count: 2,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 900,
        partial_fill_rate_pct: 12,
      },
    },
    nowMs,
  });
  assert.strictEqual(held.status, "WARN");
  assert.strictEqual(held.reason, "ANOMALY_SYSTEM_SLO_HOLD");
  assert.strictEqual(held.circuit_breaker_open, false);
  assert.strictEqual(held.guard_action, "WARN_ONLY");
  assert.ok(held.issues.includes("ANOMALY_OPS_GUARD_HOLD"));

  const softScaled = buildSystemAnomalyState({
    exchange: "BINANCEFUT",
    systemSlo: {
      status: "PASS",
      reason: "SYSTEM_SLO_HEALTHY",
      block_new_entries: false,
    },
    operationalGuard: {
      status: "보류",
      reason: "OPS_GUARD_HOLD_COST_SOFT_SCALE",
      block_new_entries: false,
      audit_issue_count: 0,
      qty_pct_non_positive_count: 0,
      error_count: 3,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 900,
        partial_fill_rate_pct: 12,
      },
    },
    nowMs,
  });
  assert.strictEqual(softScaled.status, "WARN");
  assert.strictEqual(softScaled.reason, "ANOMALY_RUNTIME_ERROR_BURST");
  assert.strictEqual(softScaled.circuit_breaker_open, false);
  assert.ok(!softScaled.issues.includes("ANOMALY_OPS_GUARD_HOLD"));

  const staleOnlyTotalErrors = buildSystemAnomalyState({
    exchange: "BINANCEFUT",
    systemSlo: {
      status: "PASS",
      reason: "SYSTEM_SLO_HEALTHY",
      block_new_entries: false,
    },
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
      audit_issue_count: 0,
      qty_pct_non_positive_count: 0,
      error_count: 3,
      active_error_count: 0,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 900,
        partial_fill_rate_pct: 12,
      },
    },
    nowMs,
  });
  assert.strictEqual(staleOnlyTotalErrors.status, "CLEAR");
  assert.ok(!staleOnlyTotalErrors.issues.includes("ANOMALY_RUNTIME_ERROR_BURST"));

  const trailGap = buildSystemAnomalyState({
    exchange: "BINANCEFUT",
    systemSlo: {
      status: "WARN",
      reason: "NATIVE_TRAIL_PROTECTION_GAP",
      block_new_entries: true,
    },
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
      audit_issue_count: 0,
      qty_pct_non_positive_count: 0,
      error_count: 0,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_OK",
        created_to_fill_p95_ms: 900,
        partial_fill_rate_pct: 12,
      },
    },
    nativeTrailProtection: {
      gap_count: 2,
    },
    nowMs,
  });
  assert.strictEqual(trailGap.status, "BLOCK");
  assert.strictEqual(trailGap.reason, "ANOMALY_SYSTEM_SLO_HOLD");
  assert.strictEqual(trailGap.circuit_breaker_open, true);
  assert.ok(trailGap.issues.includes("ANOMALY_NATIVE_TRAIL_PROTECTION_GAP"));

  const legacyLatencyAllowed = buildSystemAnomalyState({
    exchange: "BINANCEFUT",
    systemSlo: {
      status: "PASS",
      reason: "SYSTEM_SLO_HEALTHY",
      block_new_entries: false,
    },
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
      audit_issue_count: 0,
      qty_pct_non_positive_count: 0,
      error_count: 0,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_REVIEW",
        guard_created_to_fill_p95_ms: 3979,
        webhook_to_fill_p95_ms: 3979,
        partial_fill_rate_pct: 12,
        top_operational_webhook_delay_cause: "LEGACY_WEBHOOK_OUTCOME_ONLY",
        top_operational_immediate_intent_delay_group: null,
        review_reasons: ["LEGACY_LATENCY_GUARD_FALLBACK_ACTIVE"],
      },
    },
    nowMs,
  });
  assert.strictEqual(legacyLatencyAllowed.status, "CLEAR");
  assert.ok(!legacyLatencyAllowed.issues.includes("ANOMALY_LATENCY_P95_HIGH"));
  assert.strictEqual(legacyLatencyAllowed.components.execution_quality_latency_p95_budget_ms, 5000);
  assert.strictEqual(legacyLatencyAllowed.components.execution_quality_latency_legacy_fallback, true);

  const immediateLatencyWarn = buildSystemAnomalyState({
    exchange: "BINANCEFUT",
    systemSlo: {
      status: "PASS",
      reason: "SYSTEM_SLO_HEALTHY",
      block_new_entries: false,
    },
    operationalGuard: {
      status: "PASS",
      reason: "OPS_GUARD_OK",
      block_new_entries: false,
      audit_issue_count: 0,
      qty_pct_non_positive_count: 0,
      error_count: 0,
    },
    mlServing: {
      status: "PASS",
      reason: "ML_SERVING_OK",
      block_new_entries: false,
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_REVIEW",
        guard_created_to_fill_p95_ms: 3979,
        partial_fill_rate_pct: 12,
        top_operational_webhook_delay_cause: "IMMEDIATE_INTENT_DELAY",
        top_operational_immediate_intent_delay_group: "CREATE_TO_ORDER_ACK",
        review_reasons: [],
      },
    },
    nowMs,
  });
  assert.strictEqual(immediateLatencyWarn.status, "WARN");
  assert.ok(immediateLatencyWarn.issues.includes("ANOMALY_LATENCY_P95_HIGH"));
  assert.strictEqual(immediateLatencyWarn.components.execution_quality_latency_p95_budget_ms, 3000);
  assert.strictEqual(immediateLatencyWarn.components.execution_quality_latency_legacy_fallback, false);

  const staleLoaded = __test.normalizeLoadedSystemAnomalyState({
    status: "CLEAR",
    reason: "SYSTEM_ANOMALY_CLEAR",
    circuit_breaker_open: false,
    generated_at_ms: nowMs - (7 * 60 * 60 * 1000),
    max_age_ms: 6 * 60 * 60 * 1000,
  }, nowMs);
  assert.strictEqual(staleLoaded.status, "BLOCK");
  assert.strictEqual(staleLoaded.reason, "SYSTEM_ANOMALY_STATE_STALE");
  assert.strictEqual(staleLoaded.circuit_breaker_open, true);
}

try {
  run();
  console.log("SYSTEM_ANOMALY_RUNTIME_TEST_OK");
} catch (err) {
  console.error("SYSTEM_ANOMALY_RUNTIME_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
