"use strict";

// 2026-04-18 regression guard for the three TP1-recovery fixes:
//   Fix #1: recovery path emits a late trade-execution alert (dispatched
//           from paperBinanceRunner; not covered here — integration-level).
//   Fix #2: recovery seeds trail_high (LONG) / trail_low (SHORT) from the
//           current mark price so the next tick starts trailing from a
//           real waterline instead of null.
//   Fix #3: BE floor condition in tick-exit dropped the `!_trailEnabled`
//           gate — verified indirectly via buildSimplifiedExitShadowView
//           behaviour and the runner-floor signalEngine tests.
//
// This file focuses on Fix #2 because it's pure and can be tested without
// standing up Binance / Firestore.

const assert = require("assert");
const reconciler = require("../services/binancePositionReconciler");
const recoverSimplifiedExitV2RunnerMetaFromQtyReduction =
  (reconciler.__test && reconciler.__test.recoverSimplifiedExitV2RunnerMetaFromQtyReduction)
  || reconciler.recoverSimplifiedExitV2RunnerMetaFromQtyReduction;

function baseInput(overrides = {}) {
  // Qty numbers chosen so the shadow plan agrees with the observed
  // drop: entry 1.56 × TP1_QTY 0.5 = TP1 fill 0.78, leaving runner 0.78.
  // If you change TP_P1_QTY below, recompute: fill = entry × ratio.
  return {
    meta: {
      simplified_exit_v2_enabled: true,
      entry_qty_base: 1.56,
      entry_qty_abs: 1.56,
      exit_rules_override: {
        SL: -0.0165,
        TP_P1: 0.0165,
        TP_P1_QTY: 0.5,
        RUNNER_MIN_PROFIT_PCT: 0.003,
        TRAIL_PCT: 0.01,
      },
      canonical_exit_stage: "BREAKEVEN",
    },
    positionSide: "LONG",
    qtyBase: 0.78,
    previousQtyBase: 1.56,
    entryPrice: 643.04,
    stopOrder: { orderId: "S1", triggerPrice: 637.74 },
    tpOrder: null, // crucial — once TP1 fills, the TP order is gone
    ...overrides,
  };
}

(function run() {
  // ── Fix #2a: LONG recovery seeds trail_high from currentMarkPrice ─
  {
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...baseInput(),
      currentMarkPrice: 648.28,
    });
    assert.ok(out && out.meta, "recovery must return meta on qualifying qty drop");
    assert.strictEqual(out.meta.tp_p1_done, true);
    assert.strictEqual(out.meta.trail_active, true);
    assert.strictEqual(out.meta.tp_p1_source, "EXCHANGE_QTY_REDUCTION_RECOVERY");
    assert.strictEqual(out.meta.trail_high, 648.28,
      "LONG trail_high must be seeded from currentMarkPrice");
    assert.strictEqual(out.meta.trail_low, null,
      "SHORT-only field stays null for LONG position");
    assert.ok(Number.isFinite(out.meta.trail_high_at_ms),
      "trail_high_at_ms must be set when seed fires");
    assert.strictEqual(out.meta.tp_p1_recovery_trigger,
      "EXCHANGE_QTY_REDUCTION_RECOVERY",
      "recovery marker must be set so downstream alert dispatcher can detect");
    assert.strictEqual(out.meta.tp_p1_recovery_seeded_price, 648.28);
  }

  // ── Fix #2b: SHORT recovery seeds trail_low ──────────────────────
  {
    const shortInput = baseInput({ positionSide: "SHORT" });
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...shortInput,
      currentMarkPrice: 640.00,
    });
    assert.ok(out && out.meta);
    assert.strictEqual(out.meta.trail_low, 640.00,
      "SHORT trail_low must be seeded from currentMarkPrice");
    assert.strictEqual(out.meta.trail_high, null,
      "LONG-only field stays null for SHORT position");
  }

  // ── Fix #2c: missing mark price falls back to entry price ────────
  {
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...baseInput(),
      currentMarkPrice: null,
    });
    assert.ok(out && out.meta);
    assert.strictEqual(out.meta.trail_high, 643.04,
      "LONG trail_high falls back to entry price when mark price missing");
    assert.strictEqual(out.meta.tp_p1_recovery_seeded_price, 643.04);
  }

  // ── Fix #2d: non-recovery case (already done) returns null ───────
  {
    const doneInput = baseInput({
      meta: {
        ...baseInput().meta,
        tp_p1_done: true, // already flagged — recovery must no-op
      },
    });
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...doneInput,
      currentMarkPrice: 648.28,
    });
    assert.strictEqual(out, null,
      "recovery must return null when tp_p1_done is already true");
  }

  // ── Fix #2e: existing trail_high is not lowered by a stale seed ──
  // If a prior tick established trail_high=650 and now mark price dips
  // to 648, the recovery helper must NOT lower the watermark.
  {
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...baseInput({
        meta: { ...baseInput().meta, trail_high: 650.0 },
      }),
      currentMarkPrice: 648.28,
    });
    assert.ok(out && out.meta);
    assert.strictEqual(out.meta.trail_high, 650.0,
      "trail_high must not regress below a previously recorded watermark");
  }

  console.log("RECOVERY_TRAIL_SEED_AND_ALERT_TEST_OK");
})();
