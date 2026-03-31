"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/lib/stage-autopilot");

(() => {
  const appended = __test.appendStageHistory([
    { stage: "AI", run_key: "a", signature: "sig-a", action: "WATCH" },
  ], {
    stage: "MARKET",
    run_key: "b",
    signature: "sig-b",
    action: "WATCH",
  });
  assert.strictEqual(appended.length, 2);
  assert.strictEqual(appended[0].stage, "AI");
  assert.strictEqual(appended[1].stage, "MARKET");

  const none = __test.shouldAutoRollback({
    stageState: {
      applied_signature: null,
      pre_apply_snapshot: null,
      adverse_streak_n: 0,
    },
    objectiveSupervisor: {},
    canaryPass: true,
    selfEvolutionRollbackReady: false,
  });
  assert.strictEqual(none.rollback, false);
  assert.strictEqual(none.adverse, false);

  const selfEvolutionAdverse = __test.shouldAutoRollback({
    stageState: {
      applied_signature: "SIG_1",
      pre_apply_snapshot: { foo: 1 },
      adverse_streak_n: 1,
    },
    objectiveSupervisor: {
      objective: {
        enough_sample: true,
        pass: true,
        monthly_pass: true,
      },
    },
    canaryPass: true,
    selfEvolutionRollbackReady: true,
  });
  assert.strictEqual(selfEvolutionAdverse.adverse, true);
  assert.strictEqual(selfEvolutionAdverse.nextAdverseStreak, 2);
  assert.strictEqual(selfEvolutionAdverse.rollback, true);

  console.log("STAGE_AUTOPILOT_LIB_TEST_OK");
})();
