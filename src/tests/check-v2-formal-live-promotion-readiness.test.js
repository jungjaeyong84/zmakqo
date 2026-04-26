"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  evaluateFormalLivePromotionReadiness,
  runCheck,
  readBootstrapPfLowerCi,
  readDrawdownRatio,
} = require("../../scripts/check-v2-formal-live-promotion-readiness");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "formal-live-readiness-"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildPassingSnapshot(overrides = {}) {
  return {
    ok: true,
    blockers: [],
    sample_n_30d: 240,
    profit_factor_30d: 1.22,
    bootstrap_pf_lower_ci: 1.04,
    expectancy_r_30d: 0.03,
    net_pnl_30d_quote: 18.5,
    win_rate_30d: 0.46,
    max_drawdown_30d_pct: -3.2,
    active_protection_streak_days: 31,
    post_fill_critical_30d: 0,
    repair_queue_lag_p95_ms: 41000,
    v1_place_futures_call_n_30d: 0,
    cloud_run_revision_drift_n: 0,
    max_unprotected_position_30d: 0,
    algo_endpoint_degraded_crit_n_30d: 0,
    fee_included: true,
    funding_included: true,
    slippage_included: true,
    symbol_breakdown_present: true,
    regime_breakdown_present: true,
    tail_loss_mae_report_present: true,
    performance_gate_status: "PASS",
    ...overrides,
  };
}

function missingSnapshotBlocksStructured() {
  const result = evaluateFormalLivePromotionReadiness({ snapshot: null, inputFile: "/tmp/missing.json" });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "FORMAL_LIVE_PROMOTION_BLOCKED");
  assert.ok(result.blockers.includes("FORMAL_LIVE_PROMOTION:SNAPSHOT_MISSING"));
}

function currentZeroSampleSnapshotBlocksFormalLive() {
  const result = evaluateFormalLivePromotionReadiness({
    snapshot: buildPassingSnapshot({
      sample_n_30d: 0,
      profit_factor_30d: null,
      bootstrap_pf_lower_ci: null,
      expectancy_r_30d: null,
      net_pnl_30d_quote: 0,
      win_rate_30d: null,
      performance_gate_status: "ACCUMULATING",
    }),
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("FORMAL_LIVE_PROMOTION:SAMPLE_INSUFFICIENT"));
  assert.ok(result.blockers.includes("FORMAL_LIVE_PROMOTION:PROFIT_FACTOR_BELOW_FLOOR"));
  assert.ok(result.blockers.includes("FORMAL_LIVE_PROMOTION:PERFORMANCE_GATE_NOT_PASS"));
}

function passingSnapshotRequiresOperatorApproval() {
  const result = evaluateFormalLivePromotionReadiness({ snapshot: buildPassingSnapshot() });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "FORMAL_LIVE_PROMOTION_READY_REQUIRES_OPERATOR_APPROVAL");
  assert.ok(result.warnings.includes("FORMAL_LIVE_PROMOTION:OPERATOR_MULTI_EYE_APPROVAL_AND_24H_COOLDOWN_REQUIRED"));
}

function costAndBreakdownEvidenceIsRequired() {
  const result = evaluateFormalLivePromotionReadiness({
    snapshot: buildPassingSnapshot({ fee_included: false, symbol_breakdown_present: false, tail_loss_mae_report_present: false }),
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("FORMAL_LIVE_PROMOTION:COST_COMPONENTS_NOT_PROVEN"));
  assert.ok(result.blockers.includes("FORMAL_LIVE_PROMOTION:SYMBOL_BREAKDOWN_MISSING"));
  assert.ok(result.blockers.includes("FORMAL_LIVE_PROMOTION:TAIL_LOSS_MAE_REPORT_MISSING"));
}

function helperParsesAliasFields() {
  assert.strictEqual(readBootstrapPfLowerCi({ profit_factor_bootstrap_lower_ci: 1.02 }), 1.02);
  assert.strictEqual(readDrawdownRatio({ max_drawdown_30d_pct: -4.5 }), 0.045);
  assert.strictEqual(readDrawdownRatio({ max_drawdown_30d_quote: 5, equity_quote: 200 }), 0.025);
}

function runCheckWritesOutput() {
  const tmp = mkTmp();
  const input = path.join(tmp, "snapshot.json");
  const output = path.join(tmp, "readiness.json");
  writeJson(input, buildPassingSnapshot({ sample_n_30d: 10, performance_gate_status: "ACCUMULATING" }));
  const result = runCheck({
    V2_FORMAL_LIVE_PROMOTION_READINESS_INPUT_FILE: input,
    V2_FORMAL_LIVE_PROMOTION_READINESS_OUTPUT_FILE: output,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("FORMAL_LIVE_PROMOTION:SAMPLE_INSUFFICIENT"));
  assert.ok(fs.existsSync(output));
}

missingSnapshotBlocksStructured();
currentZeroSampleSnapshotBlocksFormalLive();
passingSnapshotRequiresOperatorApproval();
costAndBreakdownEvidenceIsRequired();
helperParsesAliasFields();
runCheckWritesOutput();
console.log("CHECK_V2_FORMAL_LIVE_PROMOTION_READINESS_TEST_OK");
