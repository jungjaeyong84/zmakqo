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
// Fix: BE trigger is only emitted when tpP1Done === true. This test
// pins that semantic.

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

// (B) TP1 reached — BE trigger MUST be present (post-TP1 break-even
//     stop semantic).
(function testPostTp1BeTriggerPresent() {
  const triggers = computeExitTriggers({
    pos: buildPos({ tpP1Done: true }),
    rules: buildRules(),
    leverageEff: 3,
    nativeProtectionState: null,
  });
  const kinds = kindsOf(triggers);
  assert.ok(
    kinds.includes("BE"),
    `(B) BE trigger MUST fire after TP1 reached (break-even stop). Got kinds=${JSON.stringify(kinds)}`
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
    kinds.includes("BE"),
    `(C) BE trigger MUST fire on SHORT after TP1 reached. Got kinds=${JSON.stringify(kinds)}`
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

// (E) Source-level pin: the literal `if (tpP1Done) {` must wrap the
//     BE-trigger push so a future regression that drops the guard
//     fails CI.
(function testSourcePin() {
  const fs = require("fs");
  const src = fs.readFileSync(
    path.resolve(__dirname, "..", "services", "binanceTickExit.js"),
    "utf8"
  );
  const beIdx = src.indexOf('out.push({ kind: "BE"');
  assert.ok(beIdx > 0, "(E) BE push site not found in binanceTickExit.js");
  // Walk ~600 chars upward and require an `if (tpP1Done) {` clause
  const upstream = src.slice(Math.max(0, beIdx - 600), beIdx);
  assert.ok(
    /if\s*\(\s*tpP1Done\s*\)\s*\{/.test(upstream),
    "(E) BE trigger push must be guarded by `if (tpP1Done) { ... }`"
  );
})();

console.log("TICK_EXIT_BE_TRIGGER_TPP1_GATE_TEST_OK");
