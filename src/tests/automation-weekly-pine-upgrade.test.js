"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-weekly-pine-upgrade");

(() => {
  const candidate = __test.buildSelfEvolutionRecoveryWeeklyCandidate({
    objectiveSupervisor: {
      verdict: "PATCH_CANDIDATE",
      reason: "AUTONOMOUS_RECOVERY_PROMOTION_READY",
      promotion: {
        ready: true,
        recovery_mode: true,
        reason: "AUTONOMOUS_RECOVERY_PROMOTION",
        candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      },
    },
    candidatesReport: {
      rows: [
        {
          candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          display_candidate_id: "AUTO_LONG_SHORT_REGIME_TIGHTEN",
          source: "PINE_PATCH_CANDIDATE",
          changes: [
            {
              key: "shared_regime_transition_confirmation",
              current: 1,
              next: 2,
            },
          ],
        },
      ],
    },
  });
  assert.strictEqual(candidate.patch_id, "AUTO_LONG_SHORT_REGIME_TIGHTEN");
  assert.strictEqual(candidate.safe, true);
  assert.strictEqual(candidate.changes[0].old_value, 1);
  assert.strictEqual(candidate.changes[0].new_value, 2);

  const abstractPatched = __test.applyInputChange(
    [
      'bf_core_score_min  = input.int(33, "CORE 점수 최소", minval = 0, maxval = 100, group = grp_binancef)',
      'bf_early_score_min = input.int(18, "LONG/SHORT 기본 점수 최소", minval = 0, maxval = 100, group = grp_binancef)',
      'bool _regime_ok_core = _regime_for_core == "trend" or (_regime_for_core == "transition" and math.abs(score) >= 25)',
    ].join("\n"),
    { key: "shared_regime_transition_confirmation", new_value: 2 },
    new Map()
  );
  assert.match(abstractPatched, /math\.abs\(score\) >= 27/);

  const corePatched = __test.applyInputChange(
    'bf_core_score_min  = input.int(33, "CORE 점수 최소", minval = 0, maxval = 100, group = grp_binancef)',
    { key: "entry_core_score_abs", new_value: 1 },
    new Map()
  );
  assert.match(corePatched, /input\.int\(34, "CORE 점수 최소"/);

  const none = __test.buildSelfEvolutionRecoveryWeeklyCandidate({
    objectiveSupervisor: {
      verdict: "HOLD",
      promotion: { ready: false, recovery_mode: false, candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
    },
    candidatesReport: { rows: [] },
  });
  assert.strictEqual(none, null);

  console.log("AUTOMATION_WEEKLY_PINE_UPGRADE_TEST_OK");
})();
