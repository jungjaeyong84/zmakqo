"use strict";

const assert = require("assert");
const { buildOperationalGuardState, __test } = require("../services/operationalGuardRuntime");

(() => {
  const state = buildOperationalGuardState({
    summary: {
      generated_at_iso: "2026-04-11T00:00:00.000Z",
      status: "진행",
      mode: "수익 확대 가능",
      error_count: 0,
      active_error_count: 0,
      cost_ratio_pct: 0.1,
      cost_limit_pct: 0.2,
      execution_health: {
        available: true,
        audit_issue_count: 0,
      },
    },
    nowMs: Date.parse("2026-04-11T00:10:00.000Z"),
  });

  assert.strictEqual(state.block_new_entries, false);
  assert.strictEqual(state.reason, null);
  assert.strictEqual(state.active_error_count, 0);
})();

(() => {
  const state = buildOperationalGuardState({
    summary: {
      generated_at_iso: "2026-04-11T00:00:00.000Z",
      status: "보류",
      mode: "비용 차단",
      execution_health: {
        available: true,
        qty_pct_non_positive_count: 1,
      },
    },
    nowMs: Date.parse("2026-04-11T00:10:00.000Z"),
  });

  assert.strictEqual(state.block_new_entries, true);
  assert.strictEqual(state.reason, "OPS_GUARD_HOLD");
})();

(() => {
  const state = buildOperationalGuardState({
    summary: {
      generated_at_iso: "2026-04-11T00:00:00.000Z",
      status: "보류",
      mode: "비용 차단",
      cost_ratio_pct: 0.49,
      cost_limit_pct: 0.4,
      error_count: 3,
      active_error_count: 0,
      execution_health: {
        available: true,
        audit_issue_count: 0,
        qty_pct_non_positive_count: 0,
        duplicate_signal_fill_count: 0,
      },
    },
    nowMs: Date.parse("2026-04-11T00:10:00.000Z"),
  });

  assert.strictEqual(state.block_new_entries, false);
  assert.strictEqual(state.reason, "OPS_GUARD_HOLD_COST_SOFT_SCALE");
  assert.strictEqual(state.soft_scale_only, true);
})();

(() => {
  const state = buildOperationalGuardState({
    summary: {
      generated_at_iso: "2026-04-10T00:00:00.000Z",
      status: "진행",
    },
    nowMs: Date.parse("2026-04-10T07:30:00.000Z"),
    failClosed: true,
    maxAgeMs: 60 * 60 * 1000,
  });

  assert.strictEqual(state.stale, true);
  assert.strictEqual(state.block_new_entries, true);
  assert.strictEqual(state.reason, "OPS_GUARD_STALE");
})();

(() => {
  const state = __test.normalizeLoadedOperationalGuardState({
    status: "진행",
    block_new_entries: false,
    fail_closed: true,
    generated_at_ms: Date.parse("2026-04-11T00:00:00.000Z"),
    max_age_ms: 60 * 60 * 1000,
  }, Date.parse("2026-04-11T00:10:00.000Z"));

  assert.strictEqual(state.stale, false);
  assert.strictEqual(state.block_new_entries, false);
})();

console.log("OPERATIONAL_GUARD_RUNTIME_TEST_OK");
