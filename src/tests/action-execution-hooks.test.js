"use strict";

const assert = require("assert");
const { runActionPreHooks } = require("../utils/actionExecutionHooks");

function buildSnapshot({
  allocatorRows = [],
  quarantineRows = [],
  qualityRows = [],
} = {}) {
  const toMap = (rows) => new Map(
    rows.map((row) => [String(row.market || "").toUpperCase(), row])
  );
  return {
    allocator: { by_market: allocatorRows },
    quarantine: { by_market: quarantineRows },
    quality: { by_market: qualityRows },
    allocatorByMarket: toMap(allocatorRows),
    quarantineByMarket: toMap(quarantineRows),
    qualityByMarket: toMap(qualityRows),
  };
}

(() => {
  const events = [];
  const writer = (event, payload) => events.push({ event, payload });

  const blocked = runActionPreHooks({
    action: "TRADING_MANUAL_RETRY_ENTRY",
    runId: "RUN__1",
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    tf: "15m",
    signalEvent: "SHORT",
    decisionReason: "MANUAL_RETRY_BY_USER",
    source: "TEST",
    executionMode: "LIVE",
    intent: "ENTRY",
    qtyPct: 1,
    writer,
    persist: false,
    snapshotOverride: buildSnapshot({
      quarantineRows: [{ market: "AXSUSDT", quarantine_reason: "EXECUTION_QUALITY_PENALTY" }],
    }),
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.blocked, true);
  assert.strictEqual(blocked.reason, "LIVE_POLICY_QUARANTINE_HARD_BLOCK");
  assert.strictEqual(blocked.envelope.run_id, "RUN__1");
  assert.strictEqual(blocked.envelope.symbol, "AXSUSDT");
  assert.strictEqual(events[0].event, "action_pre_blocked");

  const passed = runActionPreHooks({
    action: "TRADING_FORCE_EXIT",
    runId: "RUN__2",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    signalEvent: "FORCE_EXIT_ALL",
    decisionReason: "FORCE_EXIT_UI",
    source: "TEST",
    executionMode: "LIVE",
    intent: "EXIT",
    qtyPct: 1,
    writer,
    persist: false,
  });
  assert.strictEqual(passed.ok, true);
  assert.strictEqual(passed.blocked, false);
  assert.strictEqual(passed.reason, "ACTION_PRE_HOOK_SKIPPED");
  assert.strictEqual(passed.envelope.action, "TRADING_FORCE_EXIT");

  console.log("ACTION_EXECUTION_HOOKS_TEST_OK");
})();
