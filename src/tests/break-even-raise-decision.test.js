"use strict";

// 2026-04-19 REFACTOR (pure-helper extraction, PR #9) + PR #11 ROOT-CAUSE FIX.
//
// `computeBreakEvenRaiseDecision` 은 `runTickExitBurst` 의 BE-raise 블록에서
// "순수 계산" 만 뽑아낸 helper 다. 이 테스트는 추출 전후로 변하면 안 되는
// invariant 를 잠근다. 커버리지:
//
//   1) LONG/SHORT 대칭 bePrice 공식 (RUNNER_MIN_PROFIT_PCT 기반)
//   2) inputs_valid 불변식 — avg/lev/floor 가 모두 finite && > 0 이어야 하고
//      side 는 LONG/SHORT 중 하나여야 한다
//   3a) currentStop === NaN/undefined/string → 무조건 `shouldRaiseStop === true`
//   3b) PR #11: currentStop === null → currentStop=null (미보호) → 무조건 raise
//       (과거 Number(null)===0 finite 로 전락해 SHORT 가 skip 되던 버그 해소)
//   3c) PR #11: currentStop <= 0 (모든 형태) → null 정규화 + 무조건 raise
//   3d) PR #11: positive finite stop 은 그대로 통과 — 과도한 정규화 금지
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

// ── 3b) PR #11 UNPIN: `currentStop === null` 은 `Number(null) === 0` 으로
//   전락하던 과거 동작이 SHORT 에서 `bePrice < 0 - 1e-9` 거짓 → raise skip
//   버그를 냈다.  PR #11 은 `stop<=0` 을 "미보호" (NaN 등가) 로 coerce 해
//   LONG/SHORT 모두 `shouldRaiseStop === true` 가 되도록 근본을 바꾼다.
//   `currentStop` 결과 필드도 null (=미보호) 로 돌려준다.
{
  const resLong = compute({ side: "LONG", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: null });
  assert.strictEqual(
    resLong.currentStop,
    null,
    "PR #11: currentStop=null 은 '미보호' 로 정규화되어 결과도 null"
  );
  assert.strictEqual(
    resLong.shouldRaiseStop,
    true,
    "LONG unprotected → 무조건 raise (PR #11 이전부터 맞게 동작하던 케이스)"
  );
  const resShort = compute({ side: "SHORT", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: null });
  assert.strictEqual(
    resShort.currentStop,
    null,
    "PR #11: SHORT 도 null-stop → currentStop=null (미보호)"
  );
  assert.strictEqual(
    resShort.shouldRaiseStop,
    true,
    "PR #11 ROOT-CAUSE FIX: SHORT null-stop 은 이제 무조건 raise (과거 skip 이 정상화)"
  );
}

// ── 3c) PR #11 신규 pin: `currentStop <= 0` 의 모든 형태가 "미보호" 로
//   정규화되어야 한다.  역사적으로 Firestore 잔류값 / `Number(null)===0`
//   / 잘못된 write 경로에서 0 이나 음수가 흘러들어온 전례가 있다.
//   이 테스트는 그 모든 경로가 동일하게 raise 로 결정되는지를 잠근다.
{
  for (const stopCandidate of [0, -0, -1, -1e-9, Number.NEGATIVE_INFINITY]) {
    const resLong = compute({
      side: "LONG",
      avgPrice: 100,
      leverage: 2,
      floorPct: 0.01,
      currentStop: stopCandidate,
    });
    assert.strictEqual(
      resLong.currentStop,
      null,
      `LONG stopCandidate=${String(stopCandidate)} → currentStop null (미보호 정규화)`
    );
    assert.strictEqual(
      resLong.shouldRaiseStop,
      true,
      `LONG stopCandidate=${String(stopCandidate)} → 무조건 raise`
    );
    const resShort = compute({
      side: "SHORT",
      avgPrice: 100,
      leverage: 2,
      floorPct: 0.01,
      currentStop: stopCandidate,
    });
    assert.strictEqual(
      resShort.currentStop,
      null,
      `SHORT stopCandidate=${String(stopCandidate)} → currentStop null`
    );
    assert.strictEqual(
      resShort.shouldRaiseStop,
      true,
      `SHORT stopCandidate=${String(stopCandidate)} → 무조건 raise (PR #11 이 잠근 root-cause 수정)`
    );
  }
}

// ── 3d) PR #11 회귀 방지: 양수 finite stop 은 여전히 있는 그대로 통과해야
//   한다.  "모든 것을 미보호 로 취급" 하면 안 되므로 명시적으로 pin.
{
  const res = compute({
    side: "SHORT",
    avgPrice: 100,
    leverage: 2,
    floorPct: 0.01,
    currentStop: 105,
  });
  assert.strictEqual(res.currentStop, 105,
    "positive finite stop 은 그대로 통과 — '미보호 정규화' 가 과도하게 작동하지 않음");
  assert.strictEqual(res.shouldRaiseStop, true,
    "105 > bePrice(99.5) + 1e-9 → SHORT raise");
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
// ── 7a) TP1 직후 현재가가 BE 후보와 너무 가까우면 raise 금지 ───────────
// 3x leverage, floor=2.0%, buffer=0.1% => LONG BE price is only +0.7%
// above entry. If TP1 is +0.833% and price has already pulled back near
// BE, placing a new STOP_MARKET can be immediately-triggered by Binance
// and fail-closed into full runner liquidation. The helper must inhibit
// that refresh until price is safely beyond BE by minMarketGapPct.
{
  const res = compute({
    side: "LONG",
    avgPrice: 100,
    leverage: 3,
    floorPct: 0.02,
    bufferPct: 0.001,
    currentPrice: 100.75,
    minMarketGapPct: 0.001,
    currentStop: 98,
  });
  assert.strictEqual(res.inputsValid, true);
  assert.strictEqual(res.marketSafelyPastBe, false);
  assert.strictEqual(res.shouldRaiseStop, false);
  assert.strictEqual(res.inhibitReason, "BE_MARKET_ALREADY_CROSSED_OR_TOO_CLOSE");
}

// ── 7b) 가격이 충분히 BE 위/아래로 지나간 경우에만 raise 허용 ─────────
{
  const resLong = compute({
    side: "LONG",
    avgPrice: 100,
    leverage: 3,
    floorPct: 0.02,
    bufferPct: 0.001,
    currentPrice: 101,
    minMarketGapPct: 0.001,
    currentStop: 98,
  });
  assert.strictEqual(resLong.marketSafelyPastBe, true);
  assert.strictEqual(resLong.shouldRaiseStop, true);

  const resShort = compute({
    side: "SHORT",
    avgPrice: 100,
    leverage: 3,
    floorPct: 0.02,
    bufferPct: 0.001,
    currentPrice: 99.25,
    minMarketGapPct: 0.001,
    currentStop: 102,
  });
  assert.strictEqual(resShort.marketSafelyPastBe, false);
  assert.strictEqual(resShort.shouldRaiseStop, false);
  assert.strictEqual(resShort.inhibitReason, "BE_MARKET_ALREADY_CROSSED_OR_TOO_CLOSE");
}

// ── 8) 출력 필드 shape 계약 ────────────────────────────────────────────
// 2026-04-29 — 새 BE noise-buffer 도입으로 결과 객체에 `bufferPct` 와
// `totalFloorPct` 두 키가 추가됐다. 호출부의 기존 사용 (avg / bePrice /
// floorPct / shouldRaiseStop / inputsValid / currentStop / leverage /
// side) 은 모두 유지되며, 새 키들은 옵저버빌리티/로그 surface 용으로만
// 호출부에서 읽힌다. 시그니처 호환성: bufferPct 는 기본값 0 이라 옛
// caller 가 그대로 호출해도 동일한 bePrice 가 나온다.
{
  const res = compute({ side: "LONG", avgPrice: 100, leverage: 2, floorPct: 0.01, currentStop: 95 });
  assert.deepStrictEqual(
    Object.keys(res).sort(),
    [
      "avg", "bePrice", "bufferPct", "currentPrice", "currentStop",
      "floorPct", "inhibitReason", "inputsValid", "leverage",
      "marketSafelyPastBe", "minMarketGapPct", "shouldRaiseStop",
      "side", "totalFloorPct",
    ].sort(),
    "결과 객체는 정해진 키 집합만 노출한다 (호출부가 의존하는 계약)"
  );
  // 옛 caller 가 bufferPct 를 안 넘겼을 때 bePrice 는 변하지 않는지 회귀 보호.
  assert.ok(almostEqual(res.bePrice, 100 * (1 + 0.01 / 2)),
    "bufferPct 미지정 시 bePrice 는 옛 공식 그대로");
  assert.strictEqual(res.bufferPct, 0, "bufferPct 미지정 시 0");
  assert.ok(almostEqual(res.totalFloorPct, 0.01),
    "bufferPct 미지정 시 totalFloorPct = floorPct");
}

console.log("BREAK_EVEN_RAISE_DECISION_TEST_OK");
