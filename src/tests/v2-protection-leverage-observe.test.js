"use strict";

// 2026-04-27 Stage B — V2 protection plan 의 raw vs leverage-normalized 가격을
// 매 entry 시점에 한 줄짜리 structured warn 으로 동시 산출해, Stage D (prod
// flip) 전에 두 모드가 얼마나 떨어지는지 prod 데이터로 검증할 수 있도록 한다.
//
// 안전 계약:
//   - leverage 미제공 / leverage<=1 → silent (caller chain 의 leverage wiring 이
//     완료되기 전 Stage A 직후에는 noise 0).
//   - `V2_PROTECTION_LEVERAGE_OBSERVE=0` kill switch.
//   - flag(`V2_PROTECTION_LEVERAGE_NORMALIZE`) on/off 와 무관히 *둘 다* 산출.
//     `mode=RAW|NORMALIZED` 필드로 라이브 plan 이 어느 쪽을 썼는지 표시.

const assert = require("assert");

const _priorObserve = process.env.V2_PROTECTION_LEVERAGE_OBSERVE;
const _priorNormalize = process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
delete process.env.V2_PROTECTION_LEVERAGE_OBSERVE;
delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;

function reload() {
  const path = require.resolve("../v2/protectionModel");
  delete require.cache[path];
  return require("../v2/protectionModel");
}

const baseArgs = {
  entryPrice: 2000,
  positionSide: "LONG",
  stopLossPct: 0.0165,
  tp1TargetPct: 0.025,
};

// (A) computeProtectionLeverageDiagnostics — 두 모드 가격 + delta 정확.
{
  const { computeProtectionLeverageDiagnostics } = reload();
  const diag = computeProtectionLeverageDiagnostics({ ...baseArgs, leverage: 2 });
  assert.ok(diag, "(A) leverage>1 → diagnostics 산출");
  assert.strictEqual(diag.leverage, 2);
  assert.strictEqual(diag.sl_price_raw, 1967, "(A) SL raw = 2000 * (1 - 0.0165)");
  assert.strictEqual(diag.sl_price_normalized, 1983.5, "(A) SL norm = 2000 * (1 - 0.00825)");
  assert.strictEqual(diag.sl_price_delta_abs, 16.5, "(A) SL delta abs");
  assert.strictEqual(diag.sl_price_delta_pct, 0.00825, "(A) SL delta pct of entry");
  assert.strictEqual(diag.tp1_price_raw, 2050);
  assert.strictEqual(diag.tp1_price_normalized, 2025);
  assert.strictEqual(diag.tp1_price_delta_abs, -25);
  assert.strictEqual(diag.tp1_price_delta_pct, -0.0125);
}

// (B) leverage<=1 → null (정규화해도 raw 와 일치, 비교 의미 없음).
{
  const { computeProtectionLeverageDiagnostics } = reload();
  assert.strictEqual(computeProtectionLeverageDiagnostics({ ...baseArgs, leverage: 1 }), null);
  assert.strictEqual(computeProtectionLeverageDiagnostics({ ...baseArgs, leverage: 0 }), null);
  assert.strictEqual(computeProtectionLeverageDiagnostics({ ...baseArgs, leverage: null }), null);
  assert.strictEqual(computeProtectionLeverageDiagnostics({ ...baseArgs }), null);
}

// (C) observeProtectionLeveragePlan — leverage 미제공 시 emit 안 함.
{
  const { observeProtectionLeveragePlan } = reload();
  const captured = [];
  const result = observeProtectionLeveragePlan({
    ...baseArgs,
    plan: { sl_trigger_price: 1967, tp1_trigger_price: 2050 },
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(result, null, "(C) leverage 미제공 → null 반환");
  assert.strictEqual(captured.length, 0, "(C) emit 0 회");
}

// (D) flag off + leverage 명시 → mode=RAW 로 emit.
{
  delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
  const { observeProtectionLeveragePlan } = reload();
  const captured = [];
  observeProtectionLeveragePlan({
    ...baseArgs,
    plan: { sl_trigger_price: 1967, tp1_trigger_price: 2050 },
    leverage: 2,
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    positionCycleId: "PCYC__TEST__D",
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1, "(D) leverage 제공 + observe on → 1회 emit");
  const ev = captured[0];
  assert.strictEqual(ev.event, "v2_protection_leverage_normalize_diff");
  assert.strictEqual(ev.mode, "RAW", "(D) flag off → mode=RAW");
  assert.strictEqual(ev.exchange, "BINANCEFUT");
  assert.strictEqual(ev.symbol, "ETHUSDT");
  assert.strictEqual(ev.position_cycle_id, "PCYC__TEST__D");
  assert.strictEqual(ev.leverage, 2);
  assert.strictEqual(ev.sl_price_raw, 1967);
  assert.strictEqual(ev.sl_price_normalized, 1983.5);
  assert.strictEqual(ev.live_plan_sl_trigger_price, 1967, "(D) live plan = raw 와 일치");
  assert.strictEqual(ev.tp1_price_raw, 2050);
  assert.strictEqual(ev.tp1_price_normalized, 2025);
  assert.ok(typeof ev.observed_at === "string" && ev.observed_at.length > 0);
}

// (E) flag on + leverage 명시 → mode=NORMALIZED.
{
  process.env.V2_PROTECTION_LEVERAGE_NORMALIZE = "1";
  const { observeProtectionLeveragePlan } = reload();
  const captured = [];
  observeProtectionLeveragePlan({
    ...baseArgs,
    plan: { sl_trigger_price: 1983.5, tp1_trigger_price: 2025 },
    leverage: 2,
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].mode, "NORMALIZED", "(E) flag on → mode=NORMALIZED");
  assert.strictEqual(captured[0].live_plan_sl_trigger_price, 1983.5);
}

// (F) explicit `protectionLeverageNormalize=true` → env 와 무관히 mode=NORMALIZED.
{
  delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
  const { observeProtectionLeveragePlan } = reload();
  const captured = [];
  observeProtectionLeveragePlan({
    ...baseArgs,
    plan: { sl_trigger_price: 1983.5, tp1_trigger_price: 2025 },
    leverage: 2,
    protectionLeverageNormalize: true,
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].mode, "NORMALIZED");
}

// (G) `V2_PROTECTION_LEVERAGE_OBSERVE=0` kill switch → emit 안 함.
{
  process.env.V2_PROTECTION_LEVERAGE_OBSERVE = "0";
  delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
  const { observeProtectionLeveragePlan } = reload();
  const captured = [];
  const ret = observeProtectionLeveragePlan({
    ...baseArgs,
    plan: { sl_trigger_price: 1967, tp1_trigger_price: 2050 },
    leverage: 2,
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(ret, null);
  assert.strictEqual(captured.length, 0, "(G) observe=0 kill switch 동작");
  delete process.env.V2_PROTECTION_LEVERAGE_OBSERVE;
}

// (H) entryBootstrap 통합 — leverage 미제공 시 console.warn 발화 안 함 (회귀 검증).
{
  const path = require.resolve("../v2/entryBootstrap");
  delete require.cache[path];
  const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
  const captured = [];
  const origWarn = console.warn;
  console.warn = (...args) => { captured.push(args.join(" ")); };
  try {
    buildV2EntryBootstrap({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entryEventId: "ENTRY__BTC__OBS_NO_LEV",
      entryOrderId: "ORDER__BTC__OBS_NO_LEV",
      entryFillGroupId: "FILL_GROUP__BTC__OBS_NO_LEV",
      positionSide: "LONG",
      entryPrice: 100000,
      entryQtyAbs: 0.02,
    });
  } finally {
    console.warn = origWarn;
  }
  assert.strictEqual(
    captured.filter((line) => line.includes("v2_protection_leverage_normalize_diff")).length,
    0,
    "(H) leverage 미제공 entry → diff log 발화 안 함 (Stage C 전 noise 0)"
  );
}

// (I) entryBootstrap 통합 — leverage>1 명시 시 정확히 1회 발화.
{
  const path = require.resolve("../v2/entryBootstrap");
  delete require.cache[path];
  const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
  const captured = [];
  const origWarn = console.warn;
  console.warn = (...args) => { captured.push(args.join(" ")); };
  try {
    buildV2EntryBootstrap({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      entryEventId: "ENTRY__BTC__OBS_LEV",
      entryOrderId: "ORDER__BTC__OBS_LEV",
      entryFillGroupId: "FILL_GROUP__BTC__OBS_LEV",
      positionSide: "LONG",
      entryPrice: 100000,
      entryQtyAbs: 0.02,
      leverage: 2,
    });
  } finally {
    console.warn = origWarn;
  }
  const matched = captured
    .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
    .filter((row) => row && row.event === "v2_protection_leverage_normalize_diff");
  assert.strictEqual(matched.length, 1, "(I) leverage 제공 entry → diff log 1회");
  assert.strictEqual(matched[0].symbol, "BTCUSDT");
  assert.strictEqual(matched[0].leverage, 2);
  assert.ok(matched[0].position_cycle_id, "(I) position_cycle_id 포함");
}

// Restore env.
if (_priorObserve === undefined) delete process.env.V2_PROTECTION_LEVERAGE_OBSERVE;
else process.env.V2_PROTECTION_LEVERAGE_OBSERVE = _priorObserve;
if (_priorNormalize === undefined) delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
else process.env.V2_PROTECTION_LEVERAGE_NORMALIZE = _priorNormalize;

console.log("V2_PROTECTION_LEVERAGE_OBSERVE_TEST_OK");
