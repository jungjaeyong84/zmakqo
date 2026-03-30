"use strict";

const assert = require("assert");
const createWebhookRoutes = require("../../src/routes/webhook.routes");

const { buildRuntimeStrategyGate, parseAllowedStrategyIds } = createWebhookRoutes.__test;

(() => {
  const ids = parseAllowedStrategyIds("donbeolja_v6.0.3.0,donbeolja_v6.0.3.0,STRAT_v010");
  assert.deepStrictEqual(ids, ["donbeolja_v6.0.3.0", "STRAT_v010"]);

  const runtime = buildRuntimeStrategyGate({
    envDefaultStrategyId: "donbeolja_v6.0.3.0",
    envAllowedStrategyIds: ["donbeolja_v6.0.3.0", "STRAT_v010"],
    manualPasteAck: {
      acknowledged: true,
      applied_strategy_id: "donbeolja_v6.0.3.1",
    },
    deploymentSummary: {
      manual_paste_acknowledged: true,
      live_signal_confirmation_pending: true,
      live_signal_confirmed: false,
      applied_strategy_id: "donbeolja_v6.0.3.1",
    },
  });

  assert.strictEqual(runtime.defaultStrategyId, "donbeolja_v6.0.3.1");
  assert.ok(runtime.allowedStrategySet.has("donbeolja_v6.0.3.1"));
  assert.ok(runtime.allowedStrategySet.has("donbeolja_v6.0.3.0"));
  assert.strictEqual(runtime.source.manual_paste_acknowledged, true);
  assert.strictEqual(runtime.source.live_signal_confirmation_pending, true);

  const preparedRuntime = buildRuntimeStrategyGate({
    envDefaultStrategyId: "donbeolja_v6.0.3.1",
    envAllowedStrategyIds: ["donbeolja_v6.0.3.1", "STRAT_v010"],
    manualPasteAck: {
      acknowledged: false,
      applied_strategy_id: "donbeolja_v6.0.3.1",
    },
    deploymentSummary: {
      plan_status: "READY_FOR_MANUAL_PASTE",
      prepared_stage_ready: true,
      prepared_strategy_id: "donbeolja_v6.0.3.2",
      applied_strategy_id: "donbeolja_v6.0.3.1",
    },
  });
  assert.strictEqual(preparedRuntime.defaultStrategyId, "donbeolja_v6.0.3.1");
  assert.ok(preparedRuntime.allowedStrategySet.has("donbeolja_v6.0.3.2"));
  assert.strictEqual(preparedRuntime.source.prepared_strategy_id, "donbeolja_v6.0.3.2");

  console.log("WEBHOOK_STRATEGY_GATE_TEST_OK");
})();
