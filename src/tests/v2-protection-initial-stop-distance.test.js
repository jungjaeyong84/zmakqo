"use strict";

// 2026-04-27 Stage E hardening — V2 protection plan 이 SL trigger price 를
// 계산할 때, 동시에 정규화된 `initial_stop_price` 와 `entry_r_distance` 를
// surface 에 명시한다. 향후 trail meta (entry_r_distance / initial_stop_price)
// 가 V1 fallback (signalEngine.resolveEntryRDistance:781 의 sl/lev 재계산) 에
// 의존하지 않고 V2 가 단일 출처로 stamp 할 수 있도록 single source of truth
// 를 잡는다.
//
// 안전 계약:
//   - leverage 정규화 on (Stage D) 시 initial_stop_price = sl_trigger_price (정규화).
//   - entry_r_distance = |sl_trigger_price - entry_price| (정규화 거리).
//   - leverage 미제공 / normalize off → raw 거리 (V2 origin 기존 동작).
//   - exit_runtime_projection_id 의 surface 에도 두 필드 forward.

const assert = require("assert");

const _priorNormalize = process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;

function reload() {
  const path = require.resolve("../v2/protectionModel");
  delete require.cache[path];
  return require("../v2/protectionModel");
}

function reloadBootstrap() {
  const p1 = require.resolve("../v2/protectionModel");
  const p2 = require.resolve("../v2/entryBootstrap");
  delete require.cache[p1];
  delete require.cache[p2];
  return require("../v2/entryBootstrap");
}

const baseArgs = {
  symbol: "ETHUSDT",
  positionSide: "LONG",
  entryPrice: 2000,
  entryQtyAbs: 1,
  stopLossPct: 0.0165,
  tp1TargetPct: 0.025,
};

// (A) leverage 미제공 / normalize off → raw 거리 33.
{
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({ ...baseArgs });
  assert.strictEqual(plan.sl_trigger_price, 1967, "(A) raw SL");
  assert.strictEqual(plan.initial_stop_price, 1967, "(A) initial_stop_price = SL trigger");
  assert.strictEqual(plan.entry_r_distance, 33, "(A) raw r_distance");
}

// (B) leverage=2 + normalize on → 정규화 SL=1983.5, 거리=16.5.
{
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    ...baseArgs,
    leverage: 2,
    protectionLeverageNormalize: true,
  });
  assert.strictEqual(plan.sl_trigger_price, 1983.5, "(B) normalized SL");
  assert.strictEqual(plan.initial_stop_price, 1983.5, "(B) initial_stop_price = normalized SL");
  assert.strictEqual(plan.entry_r_distance, 16.5, "(B) normalized r_distance");
}

// (C) SHORT 도 정상 — leverage=2, normalize on, entry=2000, SL=2000*(1+0.00825)=2016.5, dist=16.5.
{
  const { buildInitialProtectionPlan } = reload();
  const plan = buildInitialProtectionPlan({
    ...baseArgs,
    positionSide: "SHORT",
    leverage: 2,
    protectionLeverageNormalize: true,
  });
  assert.strictEqual(plan.sl_trigger_price, 2016.5, "(C) SHORT normalized SL");
  assert.strictEqual(plan.initial_stop_price, 2016.5);
  assert.strictEqual(plan.entry_r_distance, 16.5);
}

// (D) entryBootstrap 통합 — projection doc 에 두 필드 forward.
{
  const { buildV2EntryBootstrap } = reloadBootstrap();
  const bootstrap = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__INIT_STOP",
    entryOrderId: "ORDER__BTC__INIT_STOP",
    entryFillGroupId: "FILL_GROUP__BTC__INIT_STOP",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.02,
    leverage: 2,
    protectionLeverageNormalize: true,
  });
  // 100000 * (1 - 0.0165/2) = 100000 * (1 - 0.00825) = 99175.
  assert.strictEqual(bootstrap.protectionPlan.sl_trigger_price, 99175, "(D) plan SL normalized");
  assert.strictEqual(bootstrap.protectionPlan.initial_stop_price, 99175);
  assert.strictEqual(bootstrap.protectionPlan.entry_r_distance, 825);
  assert.strictEqual(bootstrap.projection.initial_stop_price, 99175, "(D) projection forwards initial_stop_price");
  assert.strictEqual(bootstrap.projection.entry_r_distance, 825, "(D) projection forwards entry_r_distance");
}

// (E) signalEngine.resolveEntryRDistance 가 plan.initial_stop_price 를 우선 사용하는지 호환성 확인.
{
  const path = require.resolve("../engine/signalEngine");
  delete require.cache[path];
  const signalEngine = require("../engine/signalEngine");
  if (typeof signalEngine.__test === "object" && typeof signalEngine.__test.resolveEntryRDistance === "function") {
    const dist = signalEngine.__test.resolveEntryRDistance({
      avg: 100000,
      leverageEff: 2,
      side: "LONG",
      meta: { initial_stop_price: 99175 },
      rules: { SL: 0.0165 },
    });
    assert.strictEqual(dist, 825, "(E) signalEngine 가 initial_stop_price 를 받으면 정규화 거리 그대로");
  }
}

// Restore env.
if (_priorNormalize === undefined) delete process.env.V2_PROTECTION_LEVERAGE_NORMALIZE;
else process.env.V2_PROTECTION_LEVERAGE_NORMALIZE = _priorNormalize;

console.log("V2_PROTECTION_INITIAL_STOP_DISTANCE_TEST_OK");
