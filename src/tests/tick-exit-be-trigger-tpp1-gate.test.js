"use strict";

// 2026-04-28 — BE trigger root-cause regression test.
//
// Before this guard, computeExitTriggers always pushed
// { kind: "BE", price: ... } regardless of whether TP1 had been
// reached. With the default bePct (= -(fee+slip)*2*lev/10000) the
// BE price sits a few ticks on the loss side of entry, so any
// unfavorable tick immediately after entry triggered the fast-lane
// BE close and the position was chopped within seconds.
//
// Fix: BE is never emitted as a direct market-close trigger. BE is enforced
// only by native STOP management after TP1. This test pins that semantic.

const assert = require("assert");
const path = require("path");

const { __test } = require("../services/binanceTickExit");
const { computeExitTriggers } = __test;

assert.strictEqual(typeof computeExitTriggers, "function", "computeExitTriggers must be exported via __test");

function buildRules() {
  return {
    SL: -0.10,
    TP_P1: 0.025,
    TP_C: 0.05,
    BE_ENABLE: true,
    BE_PCT: -0.005,
  };
}

function buildPos({ tpP1Done = false, tpP1Pending = false, side = "LONG", avg = 100 } = {}) {
  return {
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    avg_price: avg,
    side,
    position_side: side,
    state: "ACTIVE",
    size_pct: 1.0,
    qty_base: 0.01,
    meta: {
      tp_p1_done: tpP1Done,
      tp_p1_pending: tpP1Pending,
      runner_stage_active: tpP1Done,
    },
  };
}

function kindsOf(triggers) {
  return triggers.map((t) => t && t.kind).filter(Boolean);
}

// (A) Fresh entry, no TP1 — BE trigger MUST be absent.
(function testFreshEntryNoBeTrigger() {
  const triggers = computeExitTriggers({
    pos: buildPos({ tpP1Done: false }),
    rules: buildRules(),
    leverageEff: 3,
    nativeProtectionState: null,
  });
  const kinds = kindsOf(triggers);
  assert.ok(
    !kinds.includes("BE"),
    `(A) BE trigger must NOT fire on a fresh entry (no TP1). Got kinds=${JSON.stringify(kinds)}`
  );
  // Sanity: SL and TP_P1 should still be present.
  assert.ok(kinds.includes("SL"), `(A) SL trigger should still be present, got ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes("TP_P1"), `(A) TP_P1 trigger should still be present, got ${JSON.stringify(kinds)}`);
})();

// (B) TP1 reached — BE trigger must still be absent from direct dispatch.
//     Native STOP refresh owns break-even enforcement.
(function testPostTp1BeTriggerAbsent() {
  const triggers = computeExitTriggers({
    pos: buildPos({ tpP1Done: true }),
    rules: buildRules(),
    leverageEff: 3,
    nativeProtectionState: null,
  });
  const kinds = kindsOf(triggers);
  assert.ok(
    !kinds.includes("BE"),
    `(B) BE trigger must NOT enter direct dispatch after TP1. Got kinds=${JSON.stringify(kinds)}`
  );
})();

// (C) TP1 reached on SHORT — same invariant.
(function testPostTp1Short() {
  const triggers = computeExitTriggers({
    pos: buildPos({ tpP1Done: true, side: "SHORT", avg: 50000 }),
    rules: buildRules(),
    leverageEff: 5,
    nativeProtectionState: null,
  });
  const kinds = kindsOf(triggers);
  assert.ok(
    !kinds.includes("BE"),
    `(C) BE trigger must NOT enter direct dispatch on SHORT after TP1. Got kinds=${JSON.stringify(kinds)}`
  );
})();

// (D) BE_ENABLE: false — BE trigger MUST NOT fire even after TP1.
(function testBeDisabledByRule() {
  const rules = { ...buildRules(), BE_ENABLE: false, BE_PCT: null };
  const triggers = computeExitTriggers({
    pos: buildPos({ tpP1Done: true }),
    rules,
    leverageEff: 3,
    nativeProtectionState: null,
  });
  const kinds = kindsOf(triggers);
  assert.ok(
    !kinds.includes("BE"),
    `(D) BE trigger must NOT fire when rules.BE_ENABLE=false. Got kinds=${JSON.stringify(kinds)}`
  );
})();

// (E) Source-level pin: no direct BE push site may exist. Break-even is
//     native STOP management only.
(function testSourcePin() {
  const fs = require("fs");
  const src = fs.readFileSync(
    path.resolve(__dirname, "..", "services", "binanceTickExit.js"),
    "utf8"
  );
  const beIdx = src.indexOf('out.push({ kind: "BE"');
  assert.strictEqual(beIdx, -1, "(E) BE direct trigger push must not exist in binanceTickExit.js");
})();

console.log("TICK_EXIT_BE_TRIGGER_TPP1_GATE_TEST_OK");
