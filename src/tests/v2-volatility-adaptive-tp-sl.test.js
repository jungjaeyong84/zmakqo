"use strict";

// 2026-04-27 Stage P — ATR-adaptive TP1/SL multiplier contract.
//   - default OFF (V2_VOLATILITY_ADAPTIVE_TP_SL_ENABLED=0).
//   - missing/invalid ATR → multiplier=1.0 (no-op).
//   - clamp [0.7, 1.5] preserves sane bounds.
//   - observe mode default ON: STATIC vs ADAPTIVE diff emit.
//   - emit failures swallowed.

const assert = require("assert");

const path = require.resolve("../v2/volatilityAdaptiveTpSl");
delete require.cache[path];
const {
  computeAtrMultiplier,
  adaptTpSlPct,
  observeAtrAdaptiveTpSl,
  isAdaptiveEnabled,
  isAdaptiveObserveEnabled,
} = require("../v2/volatilityAdaptiveTpSl");

// (A) computeAtrMultiplier — normal vol → 1.0.
{
  // ATR = 0.5% of price = exact base_atr_ratio.
  const m = computeAtrMultiplier({ atr: 5, entryPrice: 1000 }); // 0.5% atr_ratio
  assert.strictEqual(m, 1.0, "(A) normal vol → 1.0");
}

// (B) low vol → clamp to 0.7.
{
  const m = computeAtrMultiplier({ atr: 1, entryPrice: 1000 }); // 0.1% → raw 0.2 → clamp 0.7
  assert.strictEqual(m, 0.7, "(B) low vol clamped to 0.7");
}

// (C) high vol → clamp to 1.5.
{
  const m = computeAtrMultiplier({ atr: 20, entryPrice: 1000 }); // 2% → raw 4 → clamp 1.5
  assert.strictEqual(m, 1.5, "(C) high vol clamped to 1.5");
}

// (D) mid-range scaling.
{
  // ATR 0.75% → raw 1.5 → at boundary → 1.5.
  const m1 = computeAtrMultiplier({ atr: 7.5, entryPrice: 1000 });
  assert.strictEqual(m1, 1.5);
  // ATR 0.6% → raw 1.2 → 1.2.
  const m2 = computeAtrMultiplier({ atr: 6, entryPrice: 1000 });
  assert.strictEqual(m2, 1.2);
  // ATR 0.4% → raw 0.8 → 0.8.
  const m3 = computeAtrMultiplier({ atr: 4, entryPrice: 1000 });
  assert.strictEqual(m3, 0.8);
}

// (E) ATR 누락 / 비유효 → 1.0 (no-op).
{
  assert.strictEqual(computeAtrMultiplier({}), 1.0);
  assert.strictEqual(computeAtrMultiplier({ atr: null, entryPrice: 1000 }), 1.0);
  assert.strictEqual(computeAtrMultiplier({ atr: 5, entryPrice: 0 }), 1.0);
  assert.strictEqual(computeAtrMultiplier({ atr: -1, entryPrice: 1000 }), 1.0);
  assert.strictEqual(computeAtrMultiplier({ atr: NaN, entryPrice: 1000 }), 1.0);
}

// (F) adaptTpSlPct — normal vol 일 때 base 그대로.
{
  const r = adaptTpSlPct({
    baseTp1Pct: 0.025,
    baseStopLossPct: 0.0165,
    atr: 5,
    entryPrice: 1000,
  });
  assert.strictEqual(r.multiplier, 1.0);
  assert.strictEqual(r.tp1_pct, 0.025);
  assert.strictEqual(r.stop_loss_pct, 0.0165);
  assert.strictEqual(r.adapted, false);
  assert.strictEqual(r.atr_ratio, 0.005);
}

// (G) adaptTpSlPct — high vol 일 때 1.5x.
{
  const r = adaptTpSlPct({
    baseTp1Pct: 0.025,
    baseStopLossPct: 0.0165,
    atr: 10, // 1% atr_ratio → raw 2 → clamp 1.5
    entryPrice: 1000,
  });
  assert.strictEqual(r.multiplier, 1.5);
  assert.strictEqual(r.tp1_pct, 0.0375);  // 2.5% × 1.5 = 3.75%
  assert.strictEqual(r.stop_loss_pct, 0.02475);  // 1.65% × 1.5 = 2.475%
  assert.strictEqual(r.adapted, true);
}

// (H) adaptTpSlPct — low vol 일 때 0.7x.
{
  const r = adaptTpSlPct({
    baseTp1Pct: 0.025,
    baseStopLossPct: 0.0165,
    atr: 2, // 0.2% atr_ratio → raw 0.4 → clamp 0.7
    entryPrice: 1000,
  });
  assert.strictEqual(r.multiplier, 0.7);
  assert.strictEqual(r.tp1_pct, 0.0175);  // 2.5% × 0.7 = 1.75%
  assert.strictEqual(r.stop_loss_pct, 0.01155);
  assert.strictEqual(r.adapted, true);
}

// (I) adaptTpSlPct — base pct 비유효 → multiplier 1.0 + adapted=false.
{
  const r = adaptTpSlPct({ baseTp1Pct: 0, baseStopLossPct: 0.0165, atr: 5, entryPrice: 1000 });
  assert.strictEqual(r.multiplier, 1.0);
  assert.strictEqual(r.adapted, false);
}

// (J) isAdaptiveEnabled — default OFF.
{
  assert.strictEqual(isAdaptiveEnabled({}), false, "(J) default OFF");
  assert.strictEqual(isAdaptiveEnabled({ V2_VOLATILITY_ADAPTIVE_TP_SL_ENABLED: "0" }), false);
  assert.strictEqual(isAdaptiveEnabled({ V2_VOLATILITY_ADAPTIVE_TP_SL_ENABLED: "1" }), true);
}

// (K) isAdaptiveObserveEnabled — default ON.
{
  assert.strictEqual(isAdaptiveObserveEnabled({}), true, "(K) default ON");
  assert.strictEqual(isAdaptiveObserveEnabled({ V2_VOLATILITY_ADAPTIVE_TP_SL_OBSERVE: "0" }), false);
}

// (L) observeAtrAdaptiveTpSl — atr 있으면 emit, mode=STATIC (flag off).
{
  const captured = [];
  const ev = observeAtrAdaptiveTpSl({
    baseTp1Pct: 0.025,
    baseStopLossPct: 0.0165,
    atr: 6,
    entryPrice: 1000,
    symbol: "btcusdt",
    positionSide: "long",
    positionCycleId: "PCY__TEST",
    enabled: false,
    env: {},
    emit: (p) => captured.push(p),
  });
  assert.ok(ev);
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].event, "v2_volatility_adaptive_tp_sl_diff");
  assert.strictEqual(captured[0].mode, "STATIC");
  assert.strictEqual(captured[0].symbol, "BTCUSDT");
  assert.strictEqual(captured[0].position_side, "LONG");
  assert.strictEqual(captured[0].multiplier, 1.2);
  assert.strictEqual(captured[0].adapted_tp1_pct, 0.03);
  assert.strictEqual(captured[0].adapted_stop_loss_pct, 0.0198);
  assert.strictEqual(captured[0].atr_ratio, 0.006);
}

// (M) observeAtrAdaptiveTpSl — flag on → mode=ADAPTIVE.
{
  const captured = [];
  observeAtrAdaptiveTpSl({
    baseTp1Pct: 0.025,
    baseStopLossPct: 0.0165,
    atr: 6,
    entryPrice: 1000,
    enabled: true,
    env: {},
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured[0].mode, "ADAPTIVE");
}

// (N) ATR 누락 → 0건 emit.
{
  const captured = [];
  const ret = observeAtrAdaptiveTpSl({
    baseTp1Pct: 0.025,
    baseStopLossPct: 0.0165,
    entryPrice: 1000,
    env: {},
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(ret, null);
  assert.strictEqual(captured.length, 0);
}

// (O) observe kill switch.
{
  const captured = [];
  const ret = observeAtrAdaptiveTpSl({
    baseTp1Pct: 0.025,
    baseStopLossPct: 0.0165,
    atr: 6,
    entryPrice: 1000,
    env: { V2_VOLATILITY_ADAPTIVE_TP_SL_OBSERVE: "0" },
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(ret, null);
  assert.strictEqual(captured.length, 0);
}

// (P) emit throw 해도 swallow.
{
  const ret = observeAtrAdaptiveTpSl({
    baseTp1Pct: 0.025,
    baseStopLossPct: 0.0165,
    atr: 6,
    entryPrice: 1000,
    env: {},
    emit: () => { throw new Error("emit blew up"); },
  });
  assert.ok(ret, "(P) emit throw 무시, payload 정상 반환");
}

console.log("V2_VOLATILITY_ADAPTIVE_TP_SL_TEST_OK");
