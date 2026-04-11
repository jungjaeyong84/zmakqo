"use strict";

const assert = require("assert");
const { __test } = require("../services/mlServingActuator");

(() => {
  const promote = __test.buildMlServingActuation({
    exchange: "BINANCEFUT",
    servingState: {
      live_serving_allowed: true,
      block_new_entries: false,
      preferred_model_artifact_id: "MODEL__2",
      promotion_action: {
        action: "PROMOTE_PREFERRED_ARTIFACT",
        target_artifact_id: "MODEL__2",
      },
    },
    exchangeBindingDoc: {
      active_artifact_id: "MODEL__1",
      previous_artifact_id: null,
      binding: { provider_mode: "CLAUDE_PRIMARY" },
    },
    recentActions: [],
    targetBindingDoc: {
      artifact_id: "MODEL__2",
      binding: { provider_mode: "OPENAI_PRIMARY" },
    },
  });
  assert.strictEqual(promote.apply, true);
  assert.strictEqual(promote.active_model_artifact_id, "MODEL__2");
  assert.strictEqual(promote.previous_live_artifact_id, "MODEL__1");
  assert.strictEqual(promote.verification.rollback_cooldown_active, false);
})();

(() => {
  const rollback = __test.buildMlServingActuation({
    exchange: "BINANCEFUT",
    servingState: {
      live_serving_allowed: false,
      block_new_entries: true,
      previous_live_artifact_id: "MODEL__1",
      promotion_action: {
        action: "ROLLBACK_AND_BLOCK",
      },
    },
    exchangeBindingDoc: {
      active_artifact_id: "MODEL__2",
      previous_artifact_id: "MODEL__1",
      binding: { provider_mode: "OPENAI_PRIMARY" },
    },
    recentActions: [],
    rollbackBindingDoc: {
      artifact_id: "MODEL__1",
      binding: { provider_mode: "CLAUDE_PRIMARY" },
    },
  });
  assert.strictEqual(rollback.apply, true);
  assert.strictEqual(rollback.active_model_artifact_id, "MODEL__1");
  assert.strictEqual(rollback.block_new_entries, true);
})();

(() => {
  const blocked = __test.buildMlServingActuation({
    exchange: "BINANCEFUT",
    servingState: {
      live_serving_allowed: true,
      block_new_entries: false,
      preferred_model_artifact_id: "MODEL__2",
      promotion_action: {
        action: "PROMOTE_PREFERRED_ARTIFACT",
        target_artifact_id: "MODEL__2",
      },
    },
    exchangeBindingDoc: {
      active_artifact_id: "MODEL__1",
      previous_artifact_id: "MODEL__1",
      binding: { provider_mode: "CLAUDE_PRIMARY" },
    },
    targetBindingDoc: {
      artifact_id: "MODEL__2",
      binding: { provider_mode: "OPENAI_PRIMARY" },
    },
    recentActions: [
      {
        action: "ROLLBACK_AND_BLOCK",
        generated_at: new Date().toISOString(),
        payload: { status: "APPLIED" },
      },
    ],
  });
  assert.strictEqual(blocked.apply, false);
  assert.strictEqual(blocked.status, "BLOCKED");
  assert.strictEqual(blocked.reason, "RECENT_ROLLBACK_COOLDOWN_ACTIVE");
})();

console.log("ML_SERVING_ACTUATOR_TEST_OK");
