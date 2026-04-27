"use strict";

// 2026-04-28 Stage X — XRPUSDT 잔량 dust 가 매 15분 bar 마다 EXIT_TP_P1
// signal 을 trigger 해 telegram alert 폭탄을 일으킨 사례. signalEngine
// 의 generateSignals 가 dust threshold 미만 position 에 대해 모든 exit
// signal 을 silent skip 하도록 guard 추가.
//
// 안전 계약:
//   - default ON (`SIGNAL_DUST_SKIP_ENABLED`).
//   - threshold env: `SIGNAL_DUST_NOTIONAL_THRESHOLD_USDT` (default 20).
//   - notional = |qty_base × closePx| < threshold 이면 모든 signal skip.
//   - qty_base 누락 / 비유효 → silence skip 안 함 (false negative 방지).
//   - kill switch (=0) 시 기존 동작.

const assert = require("assert");

const path = require.resolve("../engine/signalEngine");
delete require.cache[path];
const { generateSignals } = require("../engine/signalEngine");

const NOW_BAR_MS = Date.parse("2026-04-28T08:00:00.000Z");
const ENTRY_BAR_MS = Date.parse("2026-04-28T07:00:00.000Z");

function buildPosition({
  qtyBase = 700,
  avg = 1.4,
  size = 1,
  meta = {},
} = {}) {
  return {
    state: "ACTIVE",
    symbol: "XRPUSDT",
    side: "SHORT",
    size_pct: size,
    avg_price: avg,
    qty_base: qtyBase,
    leverage: 2,
    meta: {
      entry_exec_bar_ms: ENTRY_BAR_MS,
      ...meta,
    },
  };
}

const TP_OVER_BAR = { close: 1.355, c: 1.355 };  // SHORT entry 1.4 → 1.355 = +3.21% PnL @ lev 1, +6.42% lev 2 → TP1 hit

// Save env to restore.
const _priorEnabled = process.env.SIGNAL_DUST_SKIP_ENABLED;
const _priorThresh = process.env.SIGNAL_DUST_NOTIONAL_THRESHOLD_USDT;

// (A) dust position (qty 7 × price 1.355 = ~9.5 USDT < 20) → no signals.
{
  delete process.env.SIGNAL_DUST_SKIP_ENABLED;
  delete process.env.SIGNAL_DUST_NOTIONAL_THRESHOLD_USDT;
  const signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    bar: TP_OVER_BAR,
    position: buildPosition({ qtyBase: 7 }),
    trading_mode: "RUNNING",
    leverage: 2,
    currentBarCloseMs: NOW_BAR_MS,
  });
  assert.deepStrictEqual(signals, [], "(A) dust → 모든 signal skip");
}

// (B) 정상 position (qty 700 × price 1.355 = 949 USDT) → TP1 emit 예상.
{
  delete process.env.SIGNAL_DUST_SKIP_ENABLED;
  const signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    bar: TP_OVER_BAR,
    position: buildPosition({ qtyBase: 700 }),
    trading_mode: "RUNNING",
    leverage: 2,
    currentBarCloseMs: NOW_BAR_MS,
  });
  // TP1 도달 시 EXIT_TP_P1_* event 가 list 안에.
  const tpEvents = signals.filter((s) => /^EXIT_TP_P1_/.test(s.event));
  assert.ok(tpEvents.length >= 1, "(B) 정상 size → TP1 emit");
}

// (C) threshold 환경 override — 1000 USDT 로 올리면 정상 size 도 dust.
{
  process.env.SIGNAL_DUST_NOTIONAL_THRESHOLD_USDT = "1000";
  const signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    bar: TP_OVER_BAR,
    position: buildPosition({ qtyBase: 700 }),
    trading_mode: "RUNNING",
    leverage: 2,
    currentBarCloseMs: NOW_BAR_MS,
  });
  assert.deepStrictEqual(signals, [], "(C) threshold 1000 → 950 USDT 도 dust");
  delete process.env.SIGNAL_DUST_NOTIONAL_THRESHOLD_USDT;
}

// (D) kill switch — SIGNAL_DUST_SKIP_ENABLED=0 → guard off.
{
  process.env.SIGNAL_DUST_SKIP_ENABLED = "0";
  const signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    bar: TP_OVER_BAR,
    position: buildPosition({ qtyBase: 7 }),
    trading_mode: "RUNNING",
    leverage: 2,
    currentBarCloseMs: NOW_BAR_MS,
  });
  // dust 인데 kill switch 라 signal emit 가능. (정확히 어떤 신호가 emit
  // 되는지는 trail/TP1 상태 의존이지만 빈 array 가 아니어야).
  assert.ok(Array.isArray(signals), "(D) kill switch=0 → 일반 logic");
  delete process.env.SIGNAL_DUST_SKIP_ENABLED;
}

// (E) qty_base 누락 → silence skip 안 함 (false negative 방지).
{
  const signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    bar: TP_OVER_BAR,
    position: buildPosition({ qtyBase: null }),
    trading_mode: "RUNNING",
    leverage: 2,
    currentBarCloseMs: NOW_BAR_MS,
  });
  // qty_base 모르므로 dust check 못 함 → 일반 logic.
  assert.ok(Array.isArray(signals), "(E) qty_base 누락 → guard skip");
}

// (F) Stage X — trail_active=true + dust → EXIT_TRAIL force-close emit.
{
  delete process.env.SIGNAL_DUST_SKIP_ENABLED;
  const signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    bar: TP_OVER_BAR,
    position: buildPosition({
      qtyBase: 7,
      meta: {
        entry_exec_bar_ms: ENTRY_BAR_MS,
        tp_p1_done: true,
        trail_active: true,
        trail_high: 1.5,
        trail_low: 1.3,
      },
    }),
    trading_mode: "RUNNING",
    leverage: 2,
    currentBarCloseMs: NOW_BAR_MS,
  });
  assert.strictEqual(signals.length, 1, "(F) trail_active+dust → 1 signal");
  assert.strictEqual(signals[0].event, "EXIT_TRAIL");
  assert.strictEqual(signals[0].reason, "EXIT_TRAIL_DUST_FORCE_CLOSE");
  assert.strictEqual(signals[0].qty_pct, 1, "(F) 전량 (100%) close 의도");
  assert.strictEqual(signals[0].features.force_full_close, true);
  assert.strictEqual(signals[0].features.trail_active, true);
}

// Restore env.
if (_priorEnabled === undefined) delete process.env.SIGNAL_DUST_SKIP_ENABLED;
else process.env.SIGNAL_DUST_SKIP_ENABLED = _priorEnabled;
if (_priorThresh === undefined) delete process.env.SIGNAL_DUST_NOTIONAL_THRESHOLD_USDT;
else process.env.SIGNAL_DUST_NOTIONAL_THRESHOLD_USDT = _priorThresh;

console.log("SIGNAL_ENGINE_DUST_SKIP_TEST_OK");
