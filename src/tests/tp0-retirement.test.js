"use strict";

// Regression tests for the TP0 retirement policy (2026-04-17) and the
// C19 openclaw executor fail-closed default surfaced by the Phase 3
// re-audit.

const assert = require("assert");

const {
  stampEntryMetaWithSimplifiedExitV2Policy,
  assertSimplifiedExitV2EnabledForLiveRuntime,
  isSimplifiedExitV2Active,
} = require("../services/simplifiedExitV2");
const {
  resolveCanonicalExitAuthorityDecision,
  resolveCanonicalPositionExitStage,
} = require("../services/positionStateMachine");
const { resolveExitRulesForPosition } = require("../engine/signalEngine");
const { __test: tradeAlertTest } = require("../services/tradeExecutionAlert");
const fillsSync = require("../services/binanceFuturesFillsSync");
const { __test: paperRunnerTest } = require("../engine/paperBinanceRunner");

// ---------- Entry stamp helper ------------------------------------------
(() => {
  const stamped = stampEntryMetaWithSimplifiedExitV2Policy({ execution_mode: "LIVE" });
  assert.strictEqual(stamped.simplified_exit_v2_enabled, true);
  assert.strictEqual(stamped.simplifiedExitV2Enabled, true);
  assert.strictEqual(stamped.execution_mode, "LIVE", "other fields must pass through");

  // idempotent even when the caller already set the flag to a different shape.
  const twice = stampEntryMetaWithSimplifiedExitV2Policy({
    simplified_exit_v2_enabled: false,
  });
  assert.strictEqual(twice.simplified_exit_v2_enabled, true, "policy must override legacy false");
})();

// ---------- Live runtime env guard --------------------------------------
(() => {
  const prev = process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  try {
    process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
    assert.doesNotThrow(() => assertSimplifiedExitV2EnabledForLiveRuntime({
      executionMode: "PAPER",
    }), "offline modes may still disable v2 (backtest, replay)");

    assert.throws(() => assertSimplifiedExitV2EnabledForLiveRuntime({
      executionMode: "LIVE",
    }), (err) => {
      assert.strictEqual(err.code, "SIMPLIFIED_EXIT_V2_ENABLED_MUST_BE_TRUE_FOR_LIVE_RUNTIME");
      return true;
    });

    assert.throws(() => assertSimplifiedExitV2EnabledForLiveRuntime({
      executionMode: "LIVE_DRY_RUN",
    }), /SIMPLIFIED_EXIT_V2_ENABLED_MUST_BE_TRUE_FOR_LIVE_RUNTIME/);

    process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
    assert.doesNotThrow(() => assertSimplifiedExitV2EnabledForLiveRuntime({
      executionMode: "LIVE",
    }));

    delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
    assert.doesNotThrow(() => assertSimplifiedExitV2EnabledForLiveRuntime({
      executionMode: "LIVE",
    }), "unset env defaults to enabled via DEFAULT_SIMPLIFIED_EXIT_V2_ENABLED");
  } finally {
    if (prev == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
    else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prev;
  }
})();

// ---------- Stage hint does not stamp tp_p0_done on v2 positions ---------
(() => {
  const buildStageHintedMeta = fillsSync.__test && fillsSync.__test.buildStageHintedMeta;
  if (typeof buildStageHintedMeta !== "function") {
    console.log("SKIP buildStageHintedMeta not exported; test relaxed");
    return;
  }
  // v2 position: EXIT_TP_P0 arrives (legacy or misrouted event). tp_p0_done
  // must stay false.
  const v2Meta = { simplified_exit_v2_enabled: true };
  const afterTp0 = buildStageHintedMeta(v2Meta, "EXIT_TP_P0_50P", { time: 1, price: 100 });
  assert.strictEqual(afterTp0.tp_p0_done, undefined,
    "v2 position must not stamp tp_p0_done on EXIT_TP_P0 fill");

  // EXIT_TP_P1 still promotes tp_p1 + trail, but tp_p0_done stays untouched.
  const afterTp1 = buildStageHintedMeta(v2Meta, "EXIT_TP_P1_3P", { time: 2, price: 105 });
  assert.strictEqual(afterTp1.tp_p1_done, true);
  assert.strictEqual(afterTp1.trail_active, true);
  assert.strictEqual(afterTp1.tp_p0_done, undefined,
    "v2 position must not back-fill tp_p0_done even on TP1 event");

  // Legacy v1 position still gets tp_p0_done stamped (migration compatibility).
  const v1Meta = { simplified_exit_v2_enabled: false };
  const legacyAfterTp0 = buildStageHintedMeta(v1Meta, "EXIT_TP_P0_50P", { time: 3, price: 110 });
  assert.strictEqual(legacyAfterTp0.tp_p0_done, true,
    "legacy v1 position still stamps tp_p0_done for backward-compat audit");
})();

// ---------- merge-recent hints also respect v2 policy --------------------
(() => {
  const mergeRecentExitHintsIntoMeta = fillsSync.__test && fillsSync.__test.mergeRecentExitHintsIntoMeta;
  if (typeof mergeRecentExitHintsIntoMeta !== "function") {
    console.log("SKIP mergeRecentExitHintsIntoMeta not exported");
    return;
  }
  const v2Meta = { simplified_exit_v2_enabled: true };
  const merged = mergeRecentExitHintsIntoMeta(v2Meta, {
    recentTp0: { event: "EXIT_TP_P0_50P" },
    recentTp1: { event: "EXIT_TP_P1_3P" },
    recentTrail: { event: "EXIT_TRAIL_1P" },
  });
  assert.strictEqual(merged.tp_p0_done, undefined, "v2 must not stamp tp_p0_done via recent cache");
  assert.strictEqual(merged.tp_p1_done, true);
  assert.strictEqual(merged.trail_active, true);
})();

// ---------- isSimplifiedExitV2Active: snapshot overrides env -------------
(() => {
  const prev = process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  try {
    process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
    assert.strictEqual(
      isSimplifiedExitV2Active({ simplified_exit_v2_enabled: true }),
      true,
      "explicit true beats env=0"
    );
    assert.strictEqual(
      isSimplifiedExitV2Active({}),
      false,
      "empty snapshot follows env when unspecified"
    );
  } finally {
    if (prev == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
    else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prev;
  }
})();

// ---------- v2 live positions strip TP0 from resolved rules --------------
(() => {
  const rules = resolveExitRulesForPosition({
    exchange: "BINANCEFUT",
    position: {
      execution_mode: "LIVE",
      meta: {
        simplified_exit_v2_enabled: false,
        TP_P0: 0.008,
      },
    },
  });
  assert.strictEqual(rules.TP_P0, 0, "live runtime must not carry a TP0 target under v2");
  assert.strictEqual(rules.TP_P0_QTY, 0, "live runtime must not carry a TP0 qty under v2");
  assert.strictEqual(rules.TP_P0_ATR_MULTIPLE, 0, "live runtime must not carry a TP0 ATR multiple under v2");
})();

// ---------- alert layer infers v2 from live payload/rules ----------------
(() => {
  assert.strictEqual(tradeAlertTest.isSimplifiedExitV2Enabled({
    executionMode: "LIVE",
    exitRules: {
      TP_P0: 0,
      TP_P0_QTY: 0,
      TP_P1: 0.0168,
    },
  }), true, "trade alert layer must infer v2 when TP0 is retired from the live contract");
})();

// ---------- executor removes TP0 exit intent at runtime ------------------
(() => {
  assert.strictEqual(paperRunnerTest.isForbiddenTp0ExitIntent({
    currentMeta: { simplified_exit_v2_enabled: true },
    event: "EXIT_TP_P0_0.8P",
  }), true, "runtime must never execute TP0 exit intents anymore");

  assert.strictEqual(paperRunnerTest.isForbiddenTp0ExitIntent({
    currentMeta: { simplified_exit_v2_enabled: true },
    event: "EXIT_TP_P1_1.68P",
  }), false);

  assert.strictEqual(paperRunnerTest.isForbiddenTp0ExitIntent({
    currentMeta: { simplified_exit_v2_enabled: false },
    event: "EXIT_TP_P0_0.8P",
  }), true, "legacy runtime intent도 더 이상 TP0를 실행하면 안 된다");
})();

// ---------- canonical stage authority also retires TP0 in runtime --------
(() => {
  const decision = resolveCanonicalExitAuthorityDecision({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    currentStage: "TP0",
    entryEventId: "ENTRY__ETH__RUNTIME",
    positionSnapshot: {
      execution_mode: "PAPER",
      qty_base: 0.5,
      meta: {
        simplified_exit_v2_enabled: false,
        tp_p0_done: false,
        tp_p1_done: false,
        trail_active: false,
      },
    },
    authorityState: { tp0: 0, tp1: 0, trail: 0, total: 0 },
    recentStages: {},
    rules: { TP_P0_QTY: 0.25, TP_P1_QTY: 0.5 },
  });
  assert.strictEqual(decision.stage, "TP1");
  assert.strictEqual(decision.reason, "TP0_RETIRED_RUNTIME_REMAPPED_TO_TP1");

  const positionStage = resolveCanonicalPositionExitStage({
    positionSnapshot: {
      execution_mode: "PAPER",
      qty_base: 1,
      meta: {
        simplified_exit_v2_enabled: false,
        tp_p0_done: true,
        tp_p1_done: false,
        trail_active: false,
      },
    },
  });
  assert.strictEqual(positionStage.stage, null);
  assert.strictEqual(positionStage.source, "POSITION_STATE_MACHINE_TP0_RETIRED_PRE_TP1");
})();

// ---------- fill sync runtime never reconstructs TP0 exits --------------
(async () => {
  const resolveExternalExitEvent = fillsSync.__test && fillsSync.__test.resolveExternalExitEvent;
  assert.strictEqual(typeof resolveExternalExitEvent, "function");

  const liveTp0EvidenceNormalizedToTp1 = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P0_0.8P" },
    trade: { symbol: "ETHUSDT", qty: 0.5, realizedPnl: 1.2, side: "SELL", time: Date.now() },
    orderMeta: { orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, orderId: 991 },
    positionCtx: {
      executionMode: "LIVE",
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
      qtyBase: 1,
    },
    recentTp1: null,
    recentTp0: null,
    rules: { TP_P0: 0.008, TP_P1: 0.0168, TP_P1_QTY: 0.5 },
    qtyPct: 0.5,
  });
  assert.strictEqual(liveTp0EvidenceNormalizedToTp1, "EXIT_TP_P1_1.68P");

  console.log("TP0_RETIREMENT_TEST_OK");
})().catch((err) => {
  console.error("TP0_RETIREMENT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
