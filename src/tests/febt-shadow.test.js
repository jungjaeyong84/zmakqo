"use strict";

const assert = require("assert");
const { resolveFebtShadow, buildFebtLegacyWaitComparison } = require("../utils/febtShadow");

function run() {
  const parsed = resolveFebtShadow({
    features_json: {
      febt_mode: "shadow",
      febt_phase: "fire",
      febt_lock_score: "0.74",
      febt_delay_cost: 0.66,
      febt_late_risk: 0.29,
      febt_failure_risk: 0.18,
      febt_edge: 0.37,
      febt_state_valid: "true",
      febt_calc_ok: "1",
      febt_calc_reason: "ok",
      febt_timing_action: "observe",
      febt_authority: "shadow_only",
      febt_same_dir_streak: "3",
      febt_recent_move_1_pct: "0.42",
      febt_break_retention: "0.58",
    },
  });
  assert.strictEqual(parsed.mode, "SHADOW");
  assert.strictEqual(parsed.phase, "FIRE");
  assert.strictEqual(parsed.lockScore, 0.74);
  assert.strictEqual(parsed.delayCost, 0.66);
  assert.strictEqual(parsed.lateRisk, 0.29);
  assert.strictEqual(parsed.failureRisk, 0.18);
  assert.strictEqual(parsed.edge, 0.37);
  assert.strictEqual(parsed.stateValid, true);
  assert.strictEqual(parsed.calcOk, true);
  assert.strictEqual(parsed.calcReason, "OK");
  assert.strictEqual(parsed.timingAction, "OBSERVE");
  assert.strictEqual(parsed.authority, "SHADOW_ONLY");
  assert.strictEqual(parsed.sameDirStreak, 3);
  assert.strictEqual(parsed.recentMove1Pct, 0.42);
  assert.strictEqual(parsed.breakRetention, 0.58);
  assert.strictEqual(parsed.payloadMissing, false);

  const missing = resolveFebtShadow({ features_json: {} });
  assert.strictEqual(missing.payloadMissing, true);
  assert.strictEqual(missing.phase, null);
  assert.strictEqual(missing.calcOk, null);

  const compareWait = buildFebtLegacyWaitComparison({
    input: {
      features_json: {
        febt_phase: "FIRE",
        febt_calc_ok: true,
        febt_calc_reason: "OK",
      },
    },
    legacyWaitAction: "WAIT_ONE_BAR",
    legacyWaitTriggerPath: "BASE",
  });
  assert.strictEqual(compareWait.febt_shadow_verdict, "ALLOW_CANDIDATE");
  assert.strictEqual(compareWait.febt_shadow_disagrees_legacy_wait, true);
  assert.strictEqual(compareWait.febt_shadow_disagreement_reason, "FEBT_ALLOW_LEGACY_WAIT");
  assert.strictEqual(compareWait.febt_shadow_fallback_to_legacy, false);

  const compareFallback = buildFebtLegacyWaitComparison({
    input: { features_json: {} },
    legacyWaitAction: "ALLOW",
    legacyWaitTriggerPath: "UNKNOWN",
  });
  assert.strictEqual(compareFallback.febt_shadow_verdict, "LEGACY_FALLBACK");
  assert.strictEqual(compareFallback.febt_shadow_fallback_to_legacy, true);
  assert.strictEqual(compareFallback.febt_shadow_fallback_reason, "PAYLOAD_MISSING");
  assert.strictEqual(compareFallback.febt_shadow_disagrees_legacy_wait, false);

  console.log("FEBT_SHADOW_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FEBT_SHADOW_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
