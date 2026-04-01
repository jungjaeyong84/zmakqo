"use strict";

const assert = require("assert");
const createWebhookRoutes = require("../../src/routes/webhook.routes");

const {
  buildRuntimeStrategyGate,
  parseAllowedStrategyIds,
  resolvePayloadStrategyIdentity,
  repairMalformedWebhookJson,
  parseWebhookBody,
} = createWebhookRoutes.__test;

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

  const preparedFromRuntimeState = buildRuntimeStrategyGate({
    envDefaultStrategyId: "donbeolja_v6.0.3.1",
    envAllowedStrategyIds: ["donbeolja_v6.0.3.1"],
    manualPasteAck: {
      acknowledged: true,
      applied_strategy_id: "donbeolja_v6.0.3.1",
      prepared_stage_ready: true,
      ready_for_manual_paste: true,
      plan_status: "READY_FOR_MANUAL_PASTE",
      prepared_strategy_id: "donbeolja_v6.0.3.2",
    },
    deploymentSummary: null,
  });
  assert.ok(preparedFromRuntimeState.allowedStrategySet.has("donbeolja_v6.0.3.2"));
  assert.strictEqual(preparedFromRuntimeState.source.prepared_strategy_id, "donbeolja_v6.0.3.2");

  const nestedCanonical = resolvePayloadStrategyIdentity({
    payload: {
      strategy_name: "DONBEOLJA_LIVE_ALIAS",
      features: {
        strategy_id: "donbeolja_v6.0.3.2",
      },
    },
    featureObj: {
      strategy_id: "donbeolja_v6.0.3.2",
    },
    defaultStrategyId: "donbeolja_v6.0.3.1",
  });
  assert.strictEqual(nestedCanonical.present, true);
  assert.strictEqual(nestedCanonical.canonicalId, "donbeolja_v6.0.3.2");
  assert.strictEqual(nestedCanonical.aliasId, "DONBEOLJA_LIVE_ALIAS");
  assert.strictEqual(nestedCanonical.effectiveStrategyId, "donbeolja_v6.0.3.2");

  const aliasOnly = resolvePayloadStrategyIdentity({
    payload: {
      strategy_name: "donbeolja_v6.0.3.1",
    },
    defaultStrategyId: "donbeolja_v6.0.3.0",
  });
  assert.strictEqual(aliasOnly.present, true);
  assert.strictEqual(aliasOnly.canonicalId, null);
  assert.strictEqual(aliasOnly.aliasId, "donbeolja_v6.0.3.1");
  assert.strictEqual(aliasOnly.effectiveStrategyId, "donbeolja_v6.0.3.1");

  const malformed = '{,"exchange":"BINANCEFUT","tf":"15""strategy_id":"donbeolja_v6.1.1.0"}';
  assert.strictEqual(
    repairMalformedWebhookJson(malformed),
    '{"exchange":"BINANCEFUT","tf":"15","strategy_id":"donbeolja_v6.1.1.0"}'
  );
  const parsedMalformed = parseWebhookBody(malformed);
  assert.strictEqual(parsedMalformed.repaired, true);
  assert.strictEqual(parsedMalformed.parseError, null);
  assert.strictEqual(parsedMalformed.parsed.exchange, "BINANCEFUT");
  assert.strictEqual(parsedMalformed.parsed.tf, "15");
  assert.strictEqual(parsedMalformed.parsed.strategy_id, "donbeolja_v6.1.1.0");

  console.log("WEBHOOK_STRATEGY_GATE_TEST_OK");
})();
