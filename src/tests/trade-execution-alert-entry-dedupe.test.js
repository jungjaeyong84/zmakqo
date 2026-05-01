"use strict";

const assert = require("assert");
const { __test } = require("../services/tradeExecutionAlert");

function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(
    typeof __test.resolveStableEntryAlertDedupeKey,
    "function",
    "resolveStableEntryAlertDedupeKey export missing"
  );

  const basePayload = {
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "ENTRY_LONG",
    intent: "ENTRY",
    signalId: "SIG__BINANCEFUT__SOLUSDT__15m__1777094100000__LONG",
    runId: "RUN__A",
  };

  const first = __test.resolveTradeAlertDedupeKey(basePayload);
  const second = __test.resolveTradeAlertDedupeKey({
    ...basePayload,
    execPrice: 83.82,
    execQty: 1.43,
    notional: 119.86,
    note: "producer-specific text must not affect entry alert idempotency",
  });
  assert.strictEqual(first, second, "entry alert dedupe must ignore producer-specific payload noise");
  assert.ok(first.includes("SOLUSDT"), "dedupe key must include symbol");
  assert.ok(first.includes("__ENTRY__"), "dedupe key must bind to the entry alert family");
  assert.ok(first.includes(basePayload.signalId), "dedupe key must bind to signal id");

  const noIntentButEntryEvent = __test.resolveTradeAlertDedupeKey({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "ENTRY_LONG",
    signalId: basePayload.signalId,
  });
  assert.strictEqual(
    noIntentButEntryEvent,
    first,
    "ENTRY_LONG/ENTRY_SHORT event must synthesize durable dedupe even when intent is omitted"
  );

  const differentSignal = __test.resolveTradeAlertDedupeKey({
    ...basePayload,
    signalId: "SIG__BINANCEFUT__SOLUSDT__15m__1777095000000__LONG",
  });
  assert.notStrictEqual(first, differentSignal, "different signal id must produce a different entry alert dedupe key");

  const explicit = __test.resolveTradeAlertDedupeKey({
    ...basePayload,
    tradeAlertDedupeKey: "SOLUSDT__ENTRY__SIG__EXPLICIT",
  });
  assert.strictEqual(explicit, "SOLUSDT__ENTRY__SIG__EXPLICIT", "explicit producer key must still be preserved");

  const explicitWithCycle = __test.resolveTradeAlertDedupeKey({
    ...basePayload,
    tradeAlertDedupeKey: "SOLUSDT__ENTRY__SIG__EXPLICIT",
    entryEventId: "ENTRY__SOL__1",
  });
  assert.strictEqual(
    explicitWithCycle,
    "SOLUSDT__ENTRY__SIG__EXPLICIT::CYCLE_ENTRY__SOL__1",
    "explicit producer key must be cycle-augmented when cycle evidence exists"
  );

  const noIdentity = __test.resolveTradeAlertDedupeKey({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "ENTRY_LONG",
    intent: "ENTRY",
  });
  assert.strictEqual(noIdentity, null, "entry alert without stable identity must not invent a weak dedupe key");

  const exitPayload = __test.resolveTradeAlertDedupeKey({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_2.5P",
    intent: "EXIT",
    signalId: basePayload.signalId,
  });
  assert.strictEqual(exitPayload, null, "entry-only fallback must not change exit alert dedupe semantics");

  console.log("TRADE_EXECUTION_ALERT_ENTRY_DEDUPE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TRADE_EXECUTION_ALERT_ENTRY_DEDUPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
