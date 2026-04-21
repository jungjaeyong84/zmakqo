"use strict";

const assert = require("assert");

const writer = require("../v2/openclawShadowWriter");

function buildFakeDb(store, calls) {
  return {
    collection(name) {
      if (!store[name]) store[name] = {};
      return {
        doc(id) {
          return {
            async set(payload) {
              calls.push({ collection: name, docId: id });
              store[name][id] = payload;
            },
          };
        },
      };
    },
  };
}

(async function disabledWriterSkipsWithoutTouchingDb() {
  const store = {};
  const calls = [];
  const result = await writer.writeOpenClawShadowDecision({
    db: buildFakeDb(store, calls),
    env: {
      DONBEOLJA_V2_ENABLED: "0",
      DONBEOLJA_V2_SHADOW_SIGNAL_WRITE_ENABLED: "1",
      DONBEOLJA_V2_DRY_RUN: "0",
    },
    input: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      side: "LONG",
      signalTf: "15m",
      nowMs: 1713571200000,
    },
    ruleResult: {
      ok: true,
      reason: "OPENCLAW_EXECUTOR_OK",
      qtyPctFinal: 0.5,
    },
    composite: {
      accept: true,
      scale: 1,
      reason_trace: ["RULE:OPENCLAW_EXECUTOR_OK"],
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_DISABLED");
  assert.strictEqual(calls.length, 0);
})();

(async function webhookShadowWriterPersistsIntentAndDecision() {
  const store = {};
  const calls = [];
  const env = {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_SHADOW_SIGNAL_WRITE_ENABLED: "1",
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
  };
  const result = await writer.writeOpenClawShadowDecision({
    db: buildFakeDb(store, calls),
    env,
    input: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      side: "BUY",
      signalTf: "15m",
      event: "LONG",
      nowMs: 1713571200000,
      features: {
        signal_bar_close_time_utc_ms: 1713571200000,
      },
    },
    ruleResult: {
      ok: true,
      reason: "OPENCLAW_EXECUTOR_OK",
      qtyPctFinal: 0.5,
      decision: {
        confidence: 0.73,
      },
      authority: {
        entryBudgetGuard: {
          applicable: true,
          ok: true,
          reason: "ENTRY_BUDGET_GUARD_OK",
        },
      },
    },
    composite: {
      accept: true,
      scale: 1,
      reason_trace: ["RULE:OPENCLAW_EXECUTOR_OK"],
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  assert.strictEqual(result.reason, "V2_SHADOW_SIGNAL_WRITE_OK");
  assert.strictEqual(calls.length, 2);

  const intents = store["dbjv2__signal_intents_v2"];
  const decisions = store["dbjv2__openclaw_decisions_v2"];
  const intent = intents[result.signal_intent_id];
  const decision = decisions[result.openclaw_decision_id];
  assert.ok(intent);
  assert.ok(decision);
  assert.strictEqual(intent.signal_source_mode, "WEBHOOK_ASSISTED");
  assert.strictEqual(intent.decision_status, "SHADOW_ONLY");
  assert.strictEqual(intent.side, "LONG");
  assert.strictEqual(intent.budget_check_result, "PASS");
  assert.strictEqual(decision.decision_mode, "SHADOW");
  assert.strictEqual(decision.recommended_action, "APPROVE_ENTRY");
  assert.strictEqual(decision.strategy_filter_verdict, "SHADOW");
})();

(async function serverNativeWriterFailsClosedWhenMlEvidenceIncomplete() {
  const store = {};
  const calls = [];
  const env = {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_SHADOW_SIGNAL_WRITE_ENABLED: "1",
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
  };
  const result = await writer.writeOpenClawShadowDecision({
    db: buildFakeDb(store, calls),
    env,
    input: {
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      side: "SELL",
      signalSourceMode: "SERVER_NATIVE_ML_AI",
      signalTf: "15m",
      nowMs: 1713571200000,
      features: {},
    },
    ruleResult: {
      ok: true,
      reason: "OPENCLAW_EXECUTOR_OK",
      qtyPctFinal: 0.25,
    },
    composite: {
      accept: true,
      scale: 1,
      reason_trace: ["RULE:OPENCLAW_EXECUTOR_OK"],
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.reason, "FEATURE_SNAPSHOT_REQUIRED");
  assert.strictEqual(calls.length, 0);
})();

console.log("V2_OPENCLAW_SHADOW_WRITER_TEST_OK");
