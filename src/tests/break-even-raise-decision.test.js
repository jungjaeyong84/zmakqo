"use strict";

// 2026-04-19 REFACTOR (pure-helper extraction, PR #9):
//
// `computeBreakEvenRaiseDecision` 은 `runTickExitBurst` 의 BE-raise 블록에서
// "순수 계산" 만 뽑아낸 helper 다. 이 테스트는 추출 전후로 변하면 안 되는
// invariant 를 잠근다. 커버리지:
//
//   1) LONG/SHORT 대칭 bePrice 공식 (RUNNER_MIN_PROFIT_PCT 기반)
//   2) inputs_valid 불변식 — avg/lev/floor 가 모두 finite && > 0 이어야 하고
//      side 는 LONG/SHORT 중 하나여야 한다
//   3) currentStop === NaN (=미보호) → 무조건 `shouldRaiseStop === true`
//   4) ±1e-9 허용오차 한계 (동일 가격 재-raise 금지)
//   5) raise 방향 불변식 (LONG: bePrice > currentStop, SHORT: 반대)
//
// 이 helper 는 결코 I/O (Firestore / Binance / 전역 cooldown state) 를
// 건드리지 않으므로 입력 → 출력만으로 완전 결정된다.

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

const compute = __test.computeBreakEvenRaiseDecision;
assert.strictEqual(
  typeof compute,
  "function",
  "computeBreakEvenRaiseDecision 는 __test 를 통해 노출되어야 한다"
);

function almostEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

// ── 1a) LONG 기본 공식: bePrice = avg * (1 + floor / lev) ─────────────────
{
  const res = compute({
    side: "LONG",
    avgPrice: 100,
    leverage: 2,
    floorPct: 0.01,
    currentStop: 95,
  });
  assert.strictEqual(res.inputsValid, true);
  assert.strictEqual(res.side, "LONG");
  assert.ok(almostEqual(res.bePrice, 100 * (1 + 0.01 / 2)), `LONG bePrice=${res.bePrice}`);
  assert.strictEqual(res.shouldRaiseStop, true, "95 -> 100.5 은 LONG 에서 stop 을 위로 올리는 방향");
}

// ── 1b) SHORT 기본 공식: bePrice = avg * (1 - floor / lev) ────────────────
{
  const res = compute({
    side: "SHORT",
    avgPrice: 100,
    leverage: 2,
    floorPct: 0.01,
    currentStop: 105,
  });
  assert.strictEqual(res.inputsValid, true);
  assert.strictEqual(res.side, "SHORT");
  assert.ok(almostEqual(res.bePrice, 100 * (1 - 0.01 / 2)), `SHORT bePrice=${res.bePrice}`);
  assert.strictEqual(res.shouldRaiseStop, true, "105 -> 99.5 은 SHORT 에서 stop 을 아래로 내리는 방향");
}

// ── 2a) inputs_valid: avgPrice = 0 → false ─────────────────────────────
{
  const res = compute({ side: "LONG", avgPrice: 0, leverage: 2, floorPct: 0.01, currentStop: 95 });
  assert.strictEqual(res.inputsValid, false, "avg=0 은 inputsValid false");
  assert.strictEqual(res.bePrice, null);
  assert.strictEqual(res.shouldRaiseStop, false);
}

// ── 2b) inputs_valid: leverage NaN → false ─────────────────────────────
{
  const res = compute({ side: "LONG", avgPrice: 100, leverage: null, floorPct: 0.01, currentStop: 95 });
  assert.strictEqual(res.inputsValid, false);
  assert.strictEqual(res.leverage, null, "leverage=null 은 null 로 정규화");
}

// ── 2c) inputs_valid: floorPct undefined → false ───────────────────────
{
  const res = compute({ side: "LONG", avgPrice: 100, leverage: 2 });
  assert.strictEqual(res.inputsValid, false);
  assert.strictEqual(res.floorPct, null);
}

// ── 2d) inputs_valid: side 가 LONG/SHORT 이 아님 → false (방어적 강화) ─
{
  const res = compute({ side: "UNKNOWN", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: 95 });
  assert.strictEqual(
    res.inputsValid,
    false,
    "helper 는 side 가 LONG/SHORT 가 아니면 inputsValid=false 로 거절한다 (방어적 강화)"
  );
  assert.strictEqual(res.side, null);
}

// ── 3a) currentStop 이 `NaN` 형태(undefined / NaN / 문자열) 이면 무조건 raise ─
//   (원본 코드: `!Number.isFinite(_currentStop)` 가드). helper 는 finite-이 아닌
//   값을 전부 `null` 로 정규화해 호출부의 `Number.isFinite(null) === false`
//   디시전 로그 규약과 일치시킨다.
{
  for (const stopCandidate of [undefined, Number.NaN, "not-a-number"]) {
    const res = compute({
      side: "LONG",
      avgPrice: 100,
      leverage: 2,
      floorPct: 0.01,
      currentStop: stopCandidate,
    });
    assert.strictEqual(res.inputsValid, true);
    assert.strictEqual(res.currentStop, null, `stopCandidate=${String(stopCandidate)} → currentStop null`);
    assert.strictEqual(
      res.shouldRaiseStop,
      true,
      `currentStop=${String(stopCandidate)} 는 미보호 상태이므로 무조건 raise`
    );
  }
}

// ── 3b) 원본 동작 보존: `currentStop = null` 은 `Number(null) === 0` 이 되어
//   finite 로 평가된다. 이 PR 의 리팩터링은 **동작 보존** 이 목표이므로 0 으로
//   그대로 통과시킨다. (이 경계값 자체의 의미론적 버그 — SHORT 에서
//   `bePrice < 0 - 1e-9` 가 영영 false 가 되어 raise 가 skip 됨 — 은 PR #8
//   의 trail watermark zero-bootstrap 과 같은 클래스이며 후속 PR 에서 별도로
//   schema 단계에서 차단될 예정이다. 이 테스트는 그 버그가 아직 존재한다는
//   사실을 명시적으로 "pin" 해서 리팩터링이 동작을 바꾸지 않았음을 입증한다.)
{
  const resLong = compute({ side: "LONG", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: null });
  assert.strictEqual(resLong.currentStop, 0, "Number(null) === 0 은 finite 로 취급 — 원본 동작 보존");
  assert.strictEqual(
    resLong.shouldRaiseStop,
    true,
    "LONG 은 bePrice(>0) > 0 + 1e-9 이라 raise 가 fire — 원본 동작과 동일"
  );
  const resShort = compute({ side: "SHORT", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: null });
  assert.strictEqual(resShort.currentStop, 0);
  assert.strictEqual(
    resShort.shouldRaiseStop,
    false,
    "SHORT 경계값 버그(pin): bePrice(>0) < 0 - 1e-9 는 거짓이라 raise 가 skip — 원본 동작과 동일. 후속 PR 에서 schema 단계에서 차단될 예정."
  );
}

// ── 4a) ±1e-9 허용오차: 같은 가격 재-raise 금지 (LONG) ──────────────────
{
  const avg = 100;
  const lev = 2;
  const floor = 0.01;
  const bePrice = avg * (1 + floor / lev);
  // currentStop === bePrice 정확히 → raise 금지
  const resEq = compute({ side: "LONG", avgPrice: avg, leverage: lev, floorPct: floor, currentStop: bePrice });
  assert.strictEqual(resEq.shouldRaiseStop, false, "동일 가격 재-raise 금지");
  // currentStop = bePrice - 0.5e-9 → `1e-9` 허용오차 안이라 raise 안 함
  const resEps = compute({ side: "LONG", avgPrice: avg, leverage: lev, floorPct: floor, currentStop: bePrice - 0.5e-9 });
  assert.strictEqual(resEps.shouldRaiseStop, false, "±1e-9 허용오차 안쪽은 raise 금지");
  // currentStop = bePrice - 1 → raise 필요
  const resLo = compute({ side: "LONG", avgPrice: avg, leverage: lev, floorPct: floor, currentStop: bePrice - 1 });
  assert.strictEqual(resLo.shouldRaiseStop, true, "허용오차 밖이면 raise");
}

// ── 4b) ±1e-9 허용오차: 같은 가격 재-raise 금지 (SHORT) ─────────────────
{
  const avg = 100;
  const lev = 2;
  const floor = 0.01;
  const bePrice = avg * (1 - floor / lev);
  const resEq = compute({ side: "SHORT", avgPrice: avg, leverage: lev, floorPct: floor, currentStop: bePrice });
  assert.strictEqual(resEq.shouldRaiseStop, false, "SHORT 동일 가격 재-raise 금지");
  const resEps = compute({ side: "SHORT", avgPrice: avg, leverage: lev, floorPct: floor, currentStop: bePrice + 0.5e-9 });
  assert.strictEqual(resEps.shouldRaiseStop, false, "SHORT ±1e-9 허용오차");
  const resHi = compute({ side: "SHORT", avgPrice: avg, leverage: lev, floorPct: floor, currentStop: bePrice + 1 });
  assert.strictEqual(resHi.shouldRaiseStop, true, "SHORT 허용오차 밖이면 raise");
}

// ── 5a) LONG raise 방향 불변식: bePrice < currentStop → raise 금지 ───────
{
  const res = compute({ side: "LONG", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: 200 });
  assert.strictEqual(res.shouldRaiseStop, false, "LONG 에서 currentStop > bePrice 이면 이미 더 보호 → raise 금지");
}

// ── 5b) SHORT raise 방향 불변식: bePrice > currentStop → raise 금지 ──────
{
  const res = compute({ side: "SHORT", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: 50 });
  assert.strictEqual(res.shouldRaiseStop, false, "SHORT 에서 currentStop < bePrice 이면 이미 더 보호 → raise 금지");
}

// ── 6) 실전 재현: BTCUSDT 2026-04-18T20:17 decision 로그 값 ──────────────
//   trail_enabled=true, decision_stage=ERROR 이었던 순간.
//   당시 로그: current_stop 76722.4, be_price 75461.8, should_raise_stop True, side SHORT
//   → helper 가 같은 shouldRaiseStop 을 산출하는지 재확인 (기존 동작 보존 검증).
{
  // be_price = avg * (1 - floor/lev) = 75461.8 → avg * (1 - floor/lev) = 75461.8
  // 75461.8 = avg * (1 - floor/lev). RUNNER_MIN_PROFIT_PCT 와 레버리지는 정확히
  // 모르지만 대표적인 BINANCEFUT 라이브 설정 (`floor=0.01`, `lev=2`) 을 쓰면
  // avg = 75461.8 / (1 - 0.005) = 75461.8 / 0.995 ≈ 75840.00
  // 그럼 bePrice 재계산: 75840 * 0.995 ≈ 75461.8 (허용오차 내).
  const avg = 75461.8 / (1 - 0.005);
  const res = compute({
    side: "SHORT",
    avgPrice: avg,
    leverage: 2,
    floorPct: 0.01,
    currentStop: 76722.4,
  });
  assert.strictEqual(res.side, "SHORT");
  assert.ok(
    almostEqual(res.bePrice, 75461.8, 1e-6),
    `bePrice 재계산 ≈ 75461.8 (실제=${res.bePrice})`
  );
  assert.strictEqual(
    res.shouldRaiseStop,
    true,
    "SHORT currentStop=76722.4 는 bePrice=75461.8 보다 높음 → stop 을 아래로 raise 필요"
  );
}

// ── 7) 출력 필드 shape 계약 ────────────────────────────────────────────
{
  const res = compute({ side: "LONG", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: 95 });
  assert.deepStrictEqual(
    Object.keys(res).sort(),
    ["avg", "bePrice", "currentStop", "floorPct", "inputsValid", "leverage", "shouldRaiseStop", "side"].sort(),
    "결과 객체는 정해진 키 집합만 노출한다 (호출부가 의존하는 계약)"
  );
}

console.log("BREAK_EVEN_RAISE_DECISION_TEST_OK");
