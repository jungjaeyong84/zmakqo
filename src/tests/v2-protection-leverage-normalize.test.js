"use strict";

// 2026-04-27 Stage A — V2 protection plan leverage 정규화 회복 contract.
//
// V1 의 `pnlToPrice({avg, pnlPct: SL/lev, side})` 와 정렬되도록 protectionModel
// 의 SL/TP1 가격 환산이 옵션으로 leverage 정규화 (`pct/leverage`) 를 적용한다.
//
// Stage A 안전망:
//   - default off (env unset / flag off / leverage 미제공) → 기존 V2 raw 동작 유지.
//   - flag on **AND** leverage > 0 → underlying pct = pct/leverage 로 환산.
//
// 본 테스트는 prod default off 가정 — 회귀 fix 가 *opt-in* 임을 강제한다.
// Stage D (prod env flip) 시점이 와야 prod 동작이 바뀐다.

const assert = require("assert");

const _priorEnv = process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
const _priorNodeEnv = process.env.NODE_ENV;
delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
process.env.NODE_ENV = "test";

function reload() {
  const path = require.resolve("../v2/protectionModel");
  delete require.cache[path];
  return require("../v2/protectionModel");
}

// (A) flag default off + leverage 미제공 → V2 raw (회귀 path 그대로).
{
  delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
  });
  assert.strictEqual(plan.sl_trigger_price, 1967,
    "(A) default off → underlying 1.65% raw 적용 (= 2000 * 0.9835).");
  assert.strictEqual(plan.tp1_trigger_price, 2050,
    "(A) default off → underlying 1.68% raw 적용 (= 2000 * 1.0168).");
}

// (B) flag default off + leverage 명시 → V2 raw 유지 (flag off 우선).
{
  delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
    leverage: 2,
  });
  assert.strictEqual(plan.sl_trigger_price, 1967,
    "(B) flag off 시 leverage 무시 — Stage D flip 전까지 prod 동작 변경 없음.");
}

// (C) flag on + leverage=2 (LONG) → underlying 0.825% / 0.84% 적용.
{
  process.env.V2_PROTECTION_LEVERAGE_NORMALIZE = "1";
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
    leverage: 2,
  });
  // SL: 2000 * (1 - 0.0165/2) = 2000 * 0.99175 = 1983.5
  assert.strictEqual(plan.sl_trigger_price, 1983.5,
    "(C) flag on + lev=2 → SL underlying 0.825% (V1 정렬).");
  // TP1: 2000 * (1 + 0.025/2) = 2000 * 1.0084 = 2025
  assert.strictEqual(plan.tp1_trigger_price, 2025,
    "(C) flag on + lev=2 → TP1 underlying 0.84% (V1 정렬).");
}

// (D) flag on + leverage=2 (SHORT) → 대칭.
{
  process.env.V2_PROTECTION_LEVERAGE_NORMALIZE = "1";
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "SHORT",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
    leverage: 2,
  });
  assert.strictEqual(plan.sl_trigger_price, 2016.5,
    "(D) SHORT SL: 2000 * (1 + 0.0165/2) = 2016.5.");
  assert.strictEqual(plan.tp1_trigger_price, 1975,
    "(D) SHORT TP1: 2000 * (1 - 0.025/2) = 1975.");
}

// (E) flag on + leverage 미제공 → V2 raw fallback (silent 회귀 fix는 caller 책임).
//     Stage A 는 partial wiring 단계. caller chain 이 leverage 를 항상 채워주는
//     것은 Stage C 의 정정 backfill 후에 강제. 그 전까지는 보수적 fallback.
{
  process.env.V2_PROTECTION_LEVERAGE_NORMALIZE = "1";
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
  });
  assert.strictEqual(plan.sl_trigger_price, 1967,
    "(E) flag on but leverage 미제공 → V2 raw fallback (전 caller 일괄 wiring 완료 전 안전망).");
}

// (F) explicit `protectionLeverageNormalize=true` 인자 → env 무시 강제 적용.
//     entrySubmitter caller 가 env 와 무관하게 정규화를 강제하고 싶을 때.
{
  delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
    leverage: 2,
    protectionLeverageNormalize: true,
  });
  assert.strictEqual(plan.sl_trigger_price, 1983.5,
    "(F) explicit param=true 시 env 무관 정규화 적용.");
}

// (G) explicit `protectionLeverageNormalize=false` 인자 → env=1 무시 강제 OFF.
{
  process.env.V2_PROTECTION_LEVERAGE_NORMALIZE = "1";
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    symbol: "ETHUSDT",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
    stopLossPct: 0.0165,
    tp1TargetPct: 0.025,
    tp1QtyRatio: 0.5,
    leverage: 2,
    protectionLeverageNormalize: false,
  });
  assert.strictEqual(plan.sl_trigger_price, 1967,
    "(G) explicit param=false 시 env=1 무시하고 raw 유지 — kill switch 경로.");
}

// Restore env.
if (_priorEnv === undefined) delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
else process.env.V2_PROTECTION_LEVERAGE_NORMALIZE = _priorEnv;
if (_priorNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = _priorNodeEnv;

console.log("V2_PROTECTION_LEVERAGE_NORMALIZE_TEST_OK");
