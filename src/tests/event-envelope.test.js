"use strict";

const assert = require("assert");
const { buildEventEnvelope } = require("../utils/eventEnvelope");

(() => {
  const env = buildEventEnvelope({
    requestId: "REQ__1",
    runId: "RUN__1",
    signalId: "SIG__1",
    intentId: "INTENT__1",
    event: "short",
    exchange: "binancefut",
    symbol: "ethusdt",
    tf: "15m",
    decisionReason: "live_policy_ok",
    action: "entry",
    intent: "entry",
    executionMode: "live",
    source: "webhook",
    barCloseMs: 1775114100000,
    createdAt: "2026-04-02T08:00:00.000Z",
  });

  assert.strictEqual(env.request_id, "REQ__1");
  assert.strictEqual(env.schema_version, "EVENT_ENVELOPE_V2");
  assert.strictEqual(env.run_id, "RUN__1");
  assert.strictEqual(env.signal_id, "SIG__1");
  assert.strictEqual(env.intent_id, "INTENT__1");
  assert.strictEqual(env.event, "SHORT");
  assert.strictEqual(env.exchange, "BINANCEFUT");
  assert.strictEqual(env.symbol, "ETHUSDT");
  assert.strictEqual(env.decision_reason, "LIVE_POLICY_OK");
  assert.strictEqual(env.action, "ENTRY");
  assert.strictEqual(env.intent, "ENTRY");
  assert.strictEqual(env.execution_mode, "LIVE");
  assert.strictEqual(env.source, "WEBHOOK");
  assert.strictEqual(env.bar_close_time_utc_ms, 1775114100000);
  assert.strictEqual(env.ts, "2026-04-02T08:00:00.000Z");
  assert.strictEqual(typeof env.idempotency_key, "string");
  assert.strictEqual(env.idempotency_key.length, 40);
  assert.strictEqual(env.reason_family, null);
  assert.strictEqual(env.authority, null);

  console.log("EVENT_ENVELOPE_TEST_OK");
})();
