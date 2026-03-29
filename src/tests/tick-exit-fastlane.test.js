"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function run() {
  const rules = {
    SL: -0.0165,
    TP_P1: 0.0325,
    TRAIL_PCT: 0.01,
    BE_ENABLE: true,
  };

  const shortPos = {
    exchange: "BINANCEFUT",
    avg_price: 100,
    position_side: "SHORT",
    meta: {
      tp_p1_done: true,
      trail_active: true,
      trail_low: 90,
    },
  };
  const shortTriggers = __test.computeExitTriggers({ pos: shortPos, rules, leverageEff: 2 });
  assert.strictEqual(
    __test.shouldActivateFastLane({
      pos: shortPos,
      price: 90.95,
      triggers: shortTriggers,
      fastLanePct: 0.003,
      side: "SHORT",
    }),
    true,
    "short trailing near trigger must activate fast lane"
  );
  assert.strictEqual(
    __test.shouldActivateFastLane({
      pos: shortPos,
      price: 90.2,
      triggers: shortTriggers,
      fastLanePct: 0.003,
      side: "SHORT",
    }),
    false,
    "short trailing far from trigger must not activate fast lane"
  );

  const longPos = {
    exchange: "BINANCEFUT",
    avg_price: 100,
    position_side: "LONG",
    meta: {
      tp_p1_done: true,
      trail_active: true,
      trail_high: 110,
    },
  };
  const longTriggers = __test.computeExitTriggers({ pos: longPos, rules, leverageEff: 2 });
  assert.strictEqual(
    __test.shouldActivateFastLane({
      pos: longPos,
      price: 108.95,
      triggers: longTriggers,
      fastLanePct: 0.003,
      side: "LONG",
    }),
    true,
    "long trailing near trigger must activate fast lane"
  );

  const noTrailPos = {
    exchange: "BINANCEFUT",
    avg_price: 100,
    position_side: "LONG",
    meta: {
      tp_p1_done: false,
      trail_active: false,
      trail_high: 110,
    },
  };
  const noTrailTriggers = __test.computeExitTriggers({ pos: noTrailPos, rules, leverageEff: 2 });
  assert.strictEqual(
    __test.shouldActivateFastLane({
      pos: noTrailPos,
      price: 108.95,
      triggers: noTrailTriggers,
      fastLanePct: 0.003,
      side: "LONG",
    }),
    false,
    "positions without active trailing must not activate fast lane"
  );

  assert.strictEqual(
    __test.resolvePositionSignalTf({
      pos: { meta: { entry_exec_tf_ms: 15 * 60 * 1000 } },
      exCfg: { tf_allowlist: ["60m", "15m"] },
    }),
    "15m",
    "position-specific tf must override allowlist head"
  );

  assert.strictEqual(
    __test.shouldBypassNativeProtectionCache({
      cached: {
        checkedAt: Date.parse("2026-03-19T01:00:00Z"),
        expiresAt: Date.parse("2026-03-19T01:00:10Z"),
      },
      refreshAtMs: Date.parse("2026-03-19T01:00:11Z"),
      now: Date.parse("2026-03-19T01:00:05Z"),
    }),
    true,
    "fresh native protection refresh must invalidate stale verification cache"
  );
}

try {
  run();
  console.log("TICK_EXIT_FASTLANE_TEST_OK");
} catch (err) {
  console.error("TICK_EXIT_FASTLANE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
