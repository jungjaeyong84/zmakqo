"use strict";

const assert = require("assert");
const {
  buildTrailAuthorityFeedbackState,
  renderTrailAuthorityFeedbackMarkdown,
  __test,
} = require("../services/trailAuthorityFeedback");

function run() {
  const nowMs = Date.parse("2026-04-11T08:00:00.000Z");
  const events = [
    {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "TRAIL_TRIGGER_BLOCKED",
      ts_ms: nowMs - (10 * 60 * 1000),
      run_id: "RUN1",
      payload: { reason: "SYSTEM_ANOMALY_CIRCUIT_BREAKER_OPEN", status: "BLOCK" },
    },
    {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "TRAIL_TRIGGER_ENQUEUED",
      ts_ms: nowMs - (9 * 60 * 1000),
      run_id: "RUN1",
      payload: { reason: "TRAIL_AUTHORITY_OK", status: "CLEAR" },
    },
    {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "TRAIL_TRIGGER_COMPLETED",
      ts_ms: nowMs - (8 * 60 * 1000),
      run_id: "RUN1",
      payload: { reason: "TRAIL_AUTHORITY_OK", status: "CLEAR" },
    },
    {
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      event: "TRAIL_TRIGGER_ENQUEUED",
      ts_ms: nowMs - (5 * 60 * 1000),
      run_id: "RUN2",
      payload: { reason: "TRAIL_AUTHORITY_OK", status: "CLEAR" },
    },
    {
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      event: "TRAIL_TRIGGER_COMPLETED",
      ts_ms: nowMs - (4 * 60 * 1000),
      run_id: "RUN2",
      payload: { reason: "TRAIL_AUTHORITY_OK", status: "CLEAR" },
    },
  ];
  const grouped = __test.groupTrailSessions(events);
  assert.strictEqual(grouped.counts.blocked_n, 1);
  assert.strictEqual(grouped.counts.enqueued_n, 2);
  assert.strictEqual(grouped.counts.completed_n, 2);
  assert.strictEqual(grouped.false_positive_candidates.length, 1);

  const state = buildTrailAuthorityFeedbackState({
    exchange: "BINANCEFUT",
    events,
    nowMs,
    executionQuality: {
      summary: {
        adverse_slippage_p95_bps: 121,
        partial_fill_rate_pct: 72,
        created_to_fill_p95_ms: 120000,
      },
    },
  });
  assert.strictEqual(state.status, "REVIEW");
  assert.strictEqual(state.reason, "TRAIL_AUTHORITY_FALSE_POSITIVE_REVIEW_REQUIRED");
  assert.strictEqual(state.tuning.regime, "SEVERE");
  assert.ok(state.tuning.near_pct_multiplier_bias > 1);
  assert.strictEqual(state.tuning.force_fast_lane_on_warn, true);
  assert.strictEqual(state.summary.false_positive_candidate_n, 1);
  const md = renderTrailAuthorityFeedbackMarkdown({
    generated_at_kst: "2026-04-11 16:00:00 KST",
    exchange: "BINANCEFUT",
    state,
  });
  assert.ok(md.includes("Trail Authority Feedback"));
  assert.ok(md.includes("false_positive_candidate_n: 1"));
}

try {
  run();
  console.log("TRAIL_AUTHORITY_FEEDBACK_TEST_OK");
} catch (err) {
  console.error("TRAIL_AUTHORITY_FEEDBACK_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
