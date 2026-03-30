"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-stage-autopilot");

(() => {
  const aiCandidate = __test.buildAiStageCandidate({
    data: {
      generated_at_kst: "2026-03-28 10:00:00 KST",
      self_validation: { ok: true },
      stage_samples: { ai_n: 64 },
      recommendations: {
        AI: {
          action: "REVIEW_UPDATE",
          key: "ai_missing_policy",
          next: "REDUCE",
          next_reduce_pct: 0.35,
          reason: "tighten ai missing",
          support_n: 24,
          support_rate: 0.41,
        },
      },
    },
  }, {
    ai_missing_policy: "ALLOW",
    ai_missing_reduce_pct: 0.5,
  }, {
    objective: { enough_sample: true },
  });
  assert.strictEqual(aiCandidate.actionable, true);
  assert.strictEqual(aiCandidate.nextSettings.ai_missing_policy, "REDUCE");
  assert.strictEqual(aiCandidate.nextSettings.ai_missing_reduce_pct, 0.35);

  const marketCandidate = __test.buildMarketStageCandidate({
    data: {
      self_validation: { ok: true },
      stage_samples: { market_n: 40 },
      coverage: { ai_bias_rate: 0.12 },
      recommendations: {
        MARKET: {
          action: "REVIEW_TIGHTEN",
          key: "ai_bias_gate_opposite_mult",
          next: 0.30,
          reason: "tighten opposite mult",
        },
      },
    },
  }, {
    ai_bias_gate_opposite_mult: 0.35,
  }, {
    objective: { enough_sample: true },
    guards: { market_coverage_pass: true },
  });
  assert.strictEqual(marketCandidate.actionable, true);
  assert.strictEqual(marketCandidate.nextSettings.ai_bias_gate_opposite_mult, 0.30);

  const pinePromote = __test.buildPineCandidate(
    { data: { verdict: "PATCH_CANDIDATE", promotion: { candidate_id: "AUTO_CORE_SCORE_TIGHTEN" }, codex_authority: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN" }, reason: "AUTO_PROMOTION_READY" } },
    { data: { verdict: "PROMOTE" }, fresh: true },
    { data: {} },
  );
  assert.strictEqual(pinePromote.actionable, true);
  assert.strictEqual(pinePromote.kind, "PROMOTE");

  const pineRecoveryPromote = __test.buildPineCandidate(
    { data: { verdict: "PATCH_CANDIDATE", promotion: { candidate_id: "AUTO_CORE_SCORE_TIGHTEN", display_candidate_id: "AUTO_LONG_SHORT_SCORE_TIGHTEN", recovery_mode: true }, codex_authority: { status: "FRESH", verdict: "HOLD" }, reason: "AUTONOMOUS_RECOVERY_PROMOTION_READY" } },
    { data: { verdict: "HOLD" }, fresh: true },
    { data: {} },
  );
  assert.strictEqual(pineRecoveryPromote.actionable, true);
  assert.strictEqual(pineRecoveryPromote.kind, "PROMOTE");
  assert.strictEqual(pineRecoveryPromote.signature, "AUTO_CORE_SCORE_TIGHTEN");
  assert.strictEqual(pineRecoveryPromote.display_signature, "AUTO_LONG_SHORT_SCORE_TIGHTEN");

  const pineRollbackBlocked = __test.buildPineCandidate(
    { data: { verdict: "ROLLBACK_CANDIDATE", rollback: { rollback_file_path: "/tmp/rb.pine" }, reason: "AUTO_ROLLBACK_READY" } },
    { data: { verdict: "HOLD" }, fresh: true },
    { data: {} },
  );
  assert.strictEqual(pineRollbackBlocked.actionable, false);
  assert.strictEqual(pineRollbackBlocked.kind, "ROLLBACK");

  const pendingLoopMonitor = __test.buildLoopMonitorView({
    cycleMeta: { cycle_id: "cycle-new" },
    objectiveArtifact: {
      data: {
        cycle_id: "cycle-old",
        self_evolution_loop_monitor: {
          cycle_id: "cycle-old",
          overall_status: "BLOCKED",
          cycle_consistent: false,
          stale_artifact_n: 1,
          critical_blockers: ["SELF_EVOLUTION_CYCLE_MISMATCH"],
        },
      },
    },
  });
  assert.strictEqual(pendingLoopMonitor.available, false);
  assert.strictEqual(pendingLoopMonitor.source, "PENDING_FINAL_LOOP_MONITOR");
  assert.strictEqual(pendingLoopMonitor.cycle_id, "cycle-new");
  assert.strictEqual(pendingLoopMonitor.cycle_consistent, null);

  const budgetBlocked = __test.stageChangeBudgetOk([
    { stage: "AI", action: "AUTO_APPLY", ts_ms: 1_000_000 },
  ], 1_000_000 + (12 * 60 * 60 * 1000), "AI");
  assert.strictEqual(budgetBlocked, false);

  const stableSig = __test.stableSignature({ b: 2, a: 1 });
  assert.strictEqual(stableSig, 'a=1|b=2');

  assert.strictEqual(__test.isAiAutopilotTightening(
    { ai_missing_policy: "ALLOW", ai_missing_reduce_pct: 0.5 },
    { ai_missing_policy: "REDUCE", ai_missing_reduce_pct: 0.35 }
  ), true);
  assert.strictEqual(__test.isAiAutopilotTightening(
    { ai_missing_policy: "REDUCE", ai_missing_reduce_pct: 0.35 },
    { ai_missing_policy: "REDUCE", ai_missing_reduce_pct: 0.45 }
  ), false);

  const aiGuard = __test.bestFebtAutopilotGuard({
    stage: "AI",
    candidate: {
      actionable: true,
      nextSettings: { ai_missing_policy: "REDUCE", ai_missing_reduce_pct: 0.35 },
    },
    currentSys: { ai_missing_policy: "ALLOW", ai_missing_reduce_pct: 0.5 },
    bestFebtContract: { tightening_allowed: false, recovery_priority: false },
  });
  assert.strictEqual(aiGuard.blocked, true);
  assert.strictEqual(aiGuard.reason, "BEST_FEBT_COUNT_GUARD_BLOCK");

  const pineGuard = __test.bestFebtAutopilotGuard({
    stage: "PINE",
    candidate: { actionable: true, kind: "PROMOTE" },
    currentSys: {},
    bestFebtContract: { tightening_allowed: true, recovery_priority: true },
  });
  assert.strictEqual(pineGuard.blocked, true);
  assert.strictEqual(pineGuard.reason, "BEST_FEBT_RECOVERY_GUARD_BLOCK");

  console.log("STAGE_AUTOPILOT_TEST_OK");
})();
