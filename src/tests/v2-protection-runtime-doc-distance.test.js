"use strict";

// 2026-04-27 Stage G — V2 protection_runtime_v2 doc 도 normalized
// initial_stop_price / entry_r_distance 를 single source of truth 로 보유.
// Stage E 에서 protectionPlan + projection 에는 surface 추가 됐지만
// protection_runtime_doc (실제 V2 collection 의 protection runtime row) 에는
// 들어가지 않아 trail engine 통합 시 fallback 만 의존하는 fragility 가 있었다.
//
// 안전 계약:
//   - initialStopPrice / entryRDistance 둘 다 optional (기존 caller 영향 0).
//   - 미제공 시 null 로 stamp (회귀 0).
//   - openclawShadowPositionWriter 가 bootstrap.protectionPlan 에서 두 필드를
//     forward → V2 collection 의 protection_runtime_v2 에 함께 write.

const assert = require("assert");

function reload() {
  const path = require.resolve("../v2/contracts");
  delete require.cache[path];
  return require("../v2/contracts");
}

// (A) optional — 미제공 시 null.
{
  const { buildProtectionRuntimeDoc } = reload();
  const doc = buildProtectionRuntimeDoc({
    positionCycleId: "PCY__TEST__A",
    nativeRefreshStatus: "OK",
  });
  assert.strictEqual(doc.initial_stop_price, null, "(A) 미제공 → null");
  assert.strictEqual(doc.entry_r_distance, null);
}

// (B) 명시적 forward — 정규화 SL trigger 와 그 거리 stamp.
{
  const { buildProtectionRuntimeDoc } = reload();
  const doc = buildProtectionRuntimeDoc({
    positionCycleId: "PCY__TEST__B",
    nativeRefreshStatus: "OK",
    initialStopPrice: 99175,
    entryRDistance: 825,
  });
  assert.strictEqual(doc.initial_stop_price, 99175, "(B) initial_stop_price 명시 stamp");
  assert.strictEqual(doc.entry_r_distance, 825, "(B) entry_r_distance 명시 stamp");
}

// (C) string number 도 정상 (toNumberOrNull).
{
  const { buildProtectionRuntimeDoc } = reload();
  const doc = buildProtectionRuntimeDoc({
    positionCycleId: "PCY__TEST__C",
    nativeRefreshStatus: "OK",
    initialStopPrice: "1983.5",
    entryRDistance: "16.5",
  });
  assert.strictEqual(doc.initial_stop_price, 1983.5);
  assert.strictEqual(doc.entry_r_distance, 16.5);
}

// (D) 비유효 값 → null (NaN, undefined, "")
{
  const { buildProtectionRuntimeDoc } = reload();
  for (const bad of [NaN, undefined, "", "abc"]) {
    const doc = buildProtectionRuntimeDoc({
      positionCycleId: "PCY__TEST__D",
      nativeRefreshStatus: "OK",
      initialStopPrice: bad,
      entryRDistance: bad,
    });
    assert.strictEqual(doc.initial_stop_price, null);
    assert.strictEqual(doc.entry_r_distance, null);
  }
}

// (E) Integration — entryBootstrap → openclawShadowPositionWriter →
//     buildProtectionRuntimeDoc 호출 시 두 필드 forward 검증 (직접 호출 mock).
{
  const path = require.resolve("../v2/entryBootstrap");
  delete require.cache[path];
  const { buildV2EntryBootstrap } = require(path);

  const bootstrap = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__G",
    entryOrderId: "ORDER__ETH__G",
    entryFillGroupId: "FILL_GROUP__ETH__G",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
    leverage: 2,
    protectionLeverageNormalize: true,
  });
  // plan: SL = 2000*(1-0.0165/2) = 1983.5, distance = 16.5.
  assert.strictEqual(bootstrap.protectionPlan.initial_stop_price, 1983.5);
  assert.strictEqual(bootstrap.protectionPlan.entry_r_distance, 16.5);

  const { buildProtectionRuntimeDoc } = reload();
  const protectionRuntime = buildProtectionRuntimeDoc({
    positionCycleId: bootstrap.positionCycle.position_cycle_id,
    slOrderId: "STOP__ETH__G",
    tp1OrderId: "TP1__ETH__G",
    nativeStopPrice: 1983.5,
    nativeTp1Price: 2016.8,
    nativeRefreshStatus: "OK",
    initialStopPrice: bootstrap.protectionPlan.initial_stop_price,
    entryRDistance: bootstrap.protectionPlan.entry_r_distance,
  });
  assert.strictEqual(protectionRuntime.initial_stop_price, 1983.5, "(E) plan → runtime forward");
  assert.strictEqual(protectionRuntime.entry_r_distance, 16.5);
  assert.ok(typeof protectionRuntime.protection_runtime_id === "string");
}

// (F) writeOpenClawShadowEntryBootstrap 의 buildProtectionRuntimeDoc 호출이
//     bootstrap.protectionPlan 의 두 필드를 forward 하는지 — 모듈 단위 직접 검증.
{
  const writerPath = require.resolve("../v2/openclawShadowPositionWriter");
  const writerSource = require("fs").readFileSync(writerPath, "utf-8");
  // Stage G 변경의 anchor: caller 가 protectionPlan 에서 두 필드 forward 하는지.
  assert.ok(
    writerSource.includes("initialStopPrice: bootstrap.protectionPlan && bootstrap.protectionPlan.initial_stop_price")
    || writerSource.includes("initialStopPrice: bootstrap.protectionPlan?.initial_stop_price"),
    "(F) openclawShadowPositionWriter 가 bootstrap.protectionPlan 의 initial_stop_price forward"
  );
  assert.ok(
    writerSource.includes("entryRDistance: bootstrap.protectionPlan && bootstrap.protectionPlan.entry_r_distance")
    || writerSource.includes("entryRDistance: bootstrap.protectionPlan?.entry_r_distance"),
    "(F) openclawShadowPositionWriter 가 bootstrap.protectionPlan 의 entry_r_distance forward"
  );
}

console.log("V2_PROTECTION_RUNTIME_DOC_DISTANCE_TEST_OK");
