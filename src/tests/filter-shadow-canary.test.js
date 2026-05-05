"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-filter-shadow-canary");

function run() {
  assert.strictEqual(__test.approxEqual(0.3, 0.3000000001), true);
  assert.strictEqual(__test.approxEqual(0.3, 0.3001), false);

  const same = __test.compareCanaryOutcome(
    { ok: true, action: "ALLOW", reason: null, qtyScale: 0.7, lowerBound: 0.55123456789 },
    { ok: true, action: "ALLOW", reason: null, qtyScale: 0.7 + 1e-10, lowerBound: 0.551234567891 },
    { stage: "EV" },
  );
  assert.strictEqual(same.ok, true);

  const diff = __test.compareCanaryOutcome(
    { ok: true, action: "ALLOW", reason: null, qtyScale: 0.7, lowerBound: 0.55 },
    { ok: false, action: "DROP", reason: "DROP_EV_GATE_TP1_PROB", qtyScale: 0, lowerBound: 0.49 },
    { stage: "EV" },
  );
  assert.strictEqual(diff.ok, false);
  assert.ok(diff.mismatches.some((row) => row.key === "action"));

  assert.strictEqual(__test.parseIsoMs(""), null);
  assert.strictEqual(__test.parseIsoMs("not-a-date"), null);
  assert.ok(Number.isFinite(__test.parseIsoMs("2026-03-26T02:00:00.000Z")));

  const createdMs = __test.resolveCreatedMs({
    created_at: "",
    updated_at: "",
    signal_bar_close_time_utc_ms: 1774486800000,
  });
  assert.strictEqual(createdMs, 1774486800000);

  const aiCfg = __test.inferAiBiasCfgFromFeatures({
    ai_bias_gate_neutral_mult: 0.45,
    ai_bias_gate_opposite_mult: 0.25,
    ai_bias_gate_strong_opposite_score: 0.3,
    ai_bias_gate_strong_opposite_conf: 0.66,
  }, "PRE_REAL_LONG");
  assert.strictEqual(aiCfg.neutralMult, 0.45);
  assert.strictEqual(aiCfg.oppositeMult, 0.25);
  assert.strictEqual(aiCfg.strongOppositeScore, 0.3);
  assert.strictEqual(aiCfg.strongOppositeConf, 0.66);

  assert.strictEqual(__test.resolveAiShadowExpectationMode({
    SIGNAL_AI_ENABLED: "0",
    ML_LIVE_SERVING_ARMED: "0",
    OPENCLAW_AGENT_APPLY_ENABLED: "0",
    DONBEOLJA_V2_OPENCLAW_DECISION_GATE_MODE: "BLOCK_ONLY",
    OPENCLAW_NARRATIVE_PROVIDER_MODE: "CODEX_CLI_ONLY",
    DONBEOLJA_PAID_AI_API_DISABLED: "1",
  }), "CURRENT");
  assert.strictEqual(__test.resolveAiShadowExpectationMode({
    SIGNAL_AI_ENABLED: "1",
    ML_LIVE_SERVING_ARMED: "1",
    OPENCLAW_AGENT_APPLY_ENABLED: "1",
    DONBEOLJA_V2_OPENCLAW_DECISION_GATE_MODE: "APPLY",
  }), "HISTORICAL_DROP");

  const advisoryAiCase = __test.buildShadowAiCase({
    id: "drop1",
    signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1__LONG",
    symbol: "ETHUSDT",
    qty_pct: 1,
    drop_reason_code: "AI_BLOCK",
    features_json: { ai_signal: { verdict: "BLOCK" } },
  }, {
    env: {
      SIGNAL_AI_ENABLED: "0",
      ML_LIVE_SERVING_ARMED: "0",
      OPENCLAW_AGENT_APPLY_ENABLED: "0",
      DONBEOLJA_V2_OPENCLAW_DECISION_GATE_MODE: "BLOCK_ONLY",
      OPENCLAW_NARRATIVE_PROVIDER_MODE: "CODEX_CLI_ONLY",
      DONBEOLJA_PAID_AI_API_DISABLED: "1",
    },
  });
  assert.strictEqual(advisoryAiCase.sourceDoc.ai_expectation_mode, "CURRENT");
  assert.strictEqual(advisoryAiCase.expected.drop, false);
  assert.strictEqual(advisoryAiCase.expected.reason, null);
  assert.strictEqual(advisoryAiCase.expected.qtyFraction, 1);
  assert.strictEqual(advisoryAiCase.input.features.ai_signal, undefined);

  const strictAiCase = __test.buildShadowAiCase({
    id: "drop2",
    signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__2__LONG",
    symbol: "ETHUSDT",
    qty_pct: 1,
    drop_reason_code: "AI_BLOCK",
    features_json: { ai_missing_policy: "BLOCK" },
  }, {
    env: {
      SIGNAL_AI_ENABLED: "1",
      ML_LIVE_SERVING_ARMED: "1",
      OPENCLAW_AGENT_APPLY_ENABLED: "1",
      DONBEOLJA_V2_OPENCLAW_DECISION_GATE_MODE: "APPLY",
    },
  });
  assert.strictEqual(strictAiCase.sourceDoc.ai_expectation_mode, "HISTORICAL_DROP");
  assert.strictEqual(strictAiCase.expected.drop, true);
  assert.strictEqual(strictAiCase.expected.reason, "AI_BLOCK");

  const waitCfg = __test.inferWaitCfgFromFeatures({
    wait_one_bar_same_dir_streak_min: 2,
    wait_one_bar_chase_ratio_min: 1.6,
    wait_one_bar_last_close_control_min: 0.72,
    wait_one_bar_last_dir_body_min: 0.38,
    wait_one_bar_last_opposite_wick_max: 0.12,
    wait_one_bar_recent_move1_pct_min: 0.33,
    wait_one_bar_counter_dir_bars_max: 1,
  }, "CORE_LONG");
  assert.strictEqual(waitCfg.sameDirStreakMin, 2);
  assert.strictEqual(waitCfg.chaseRatioMin, 1.6);
  assert.strictEqual(waitCfg.lastCloseControlMin, 0.72);
  assert.strictEqual(waitCfg.counterDirBarsMax, 1);

  const summary = __test.summarizeStageResult("PIPELINE", {
    ok: true,
    action: "ALLOW",
    droppedStage: null,
    reason: null,
    baseQty: 0.22,
    marketBiasMult: 0.5,
    evMult: 0.7,
    finalQty: 0.077,
    waitAction: "ALLOW",
    lowerBound: 0.58,
  });
  assert.strictEqual(summary.finalQty, 0.077);
  assert.strictEqual(summary.marketBiasMult, 0.5);
  assert.strictEqual(summary.evMult, 0.7);

  console.log("FILTER_SHADOW_CANARY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FILTER_SHADOW_CANARY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
