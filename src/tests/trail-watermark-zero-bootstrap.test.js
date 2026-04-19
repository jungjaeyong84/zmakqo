"use strict";

// 2026-04-19 ROOT-CAUSE REGRESSION (trail bootstrap jam):
//
// Production BTCUSDT SHORT 포지션이 TP1 체결 후 canonical_exit_stage=TRAIL
// 로 정상 전환됐음에도 `tick_exit_trail_updated` 이벤트가 6시간 창에서
// 0건이었다. Cloud Logging 의 `tick_exit_tp1_break_even_stop_decision` 은
// `trail_enabled: true` 를 찍었지만 native stop 은 평단 위쪽의 초기 SL
// 그대로 유지됐다.
//
// 근본 원인: SHORT 경로의 기존 가드
//   `if (!Number.isFinite(prevLow) || price < prevLow)`
// 가 `meta.trail_low === 0` (실사례에서 Firestore 에 0 이 박힌 상태) 일 때
// `Number.isFinite(0) === true` 로 평가되면서 `price < 0` 로 축약되어
// 영영 watermark patch 를 만들지 못했다. 거래 가격은 항상 양수이므로
// 조건이 한 번 0 에 잠기면 복구 불가능.
//
// 이 테스트는 새 helper `computeTrailWatermarkPatch` 의 네 가지 핵심
// 속성을 잠근다:
//   1) SHORT + `trail_low === 0`       → 첫 tick 에서 현재가로 overwrite
//   2) LONG  + `trail_high === 0`      → 첫 tick 에서 현재가로 overwrite
//   3) SHORT + `trail_low === null`    → 첫 tick 에서 현재가로 bootstrap
//   4) SHORT + 기존 유효 prev 개선 판정 → 더 낮은 가격만 patch, 같거나 높으면 null

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

const compute = __test.computeTrailWatermarkPatch;
assert.strictEqual(
  typeof compute,
  "function",
  "computeTrailWatermarkPatch 는 __test 를 통해 노출되어야 한다"
);

// ── 1) SHORT + trail_low === 0 (zero-bootstrap jam 직접 재현) ────────────
{
  const res = compute({
    side: "SHORT",
    meta: { trail_low: 0 },
    price: 75619.5,
    tickNow: 1_700_000_000_000,
  });
  assert.ok(res, "trail_low=0 이면 첫 tick 에서 반드시 patch 가 생성되어야 한다");
  assert.deepStrictEqual(
    res.patch,
    {
      "meta.trail_low": 75619.5,
      "meta.trail_low_at_ms": 1_700_000_000_000,
    },
    "SHORT 첫 tick watermark patch 는 현재가로 채워져야 한다"
  );
  assert.strictEqual(res.field, "trail_low");
  assert.strictEqual(res.next, 75619.5);
  assert.strictEqual(
    res.prev,
    null,
    "prev=0 은 유효 watermark 가 아니므로 prev 필드는 null 이어야 한다"
  );
}

// ── 2) LONG + trail_high === 0 (대칭 회귀) ─────────────────────────────
{
  const res = compute({
    side: "LONG",
    meta: { trail_high: 0 },
    price: 2134.12,
    tickNow: 1_700_000_000_000,
  });
  assert.ok(res, "trail_high=0 이면 LONG 경로도 첫 tick 에서 patch 가 생성되어야 한다");
  assert.deepStrictEqual(res.patch, {
    "meta.trail_high": 2134.12,
    "meta.trail_high_at_ms": 1_700_000_000_000,
  });
  assert.strictEqual(res.field, "trail_high");
  assert.strictEqual(res.prev, null);
}

// ── 3) SHORT + trail_low === null (기존 정상 bootstrap 경로 유지) ─────────
{
  const res = compute({
    side: "SHORT",
    meta: { trail_low: null },
    price: 75619.5,
    tickNow: 1_700_000_000_000,
  });
  assert.ok(res, "trail_low=null 이면 첫 tick 에서 현재가로 bootstrap 되어야 한다");
  assert.strictEqual(res.next, 75619.5);
  assert.strictEqual(res.prev, null);
}

// ── 4a) SHORT + 유효 prev 보다 낮은 가격 → patch 생성 ───────────────────
{
  const res = compute({
    side: "SHORT",
    meta: { trail_low: 75800 },
    price: 75600,
    tickNow: 1_700_000_000_000,
  });
  assert.ok(res, "prev 보다 낮은 가격은 SHORT watermark 를 개선하므로 patch 필요");
  assert.strictEqual(res.patch["meta.trail_low"], 75600);
  assert.strictEqual(res.prev, 75800);
}

// ── 4b) SHORT + 유효 prev 와 같거나 높은 가격 → null (watermark 후퇴 금지) ──
{
  assert.strictEqual(
    compute({
      side: "SHORT",
      meta: { trail_low: 75800 },
      price: 75800,
      tickNow: 1_700_000_000_000,
    }),
    null,
    "SHORT watermark 는 같은 가격으로 재-patch 되지 않아야 한다"
  );
  assert.strictEqual(
    compute({
      side: "SHORT",
      meta: { trail_low: 75800 },
      price: 75810,
      tickNow: 1_700_000_000_000,
    }),
    null,
    "SHORT watermark 는 더 높은 가격(후퇴)으로 갱신되지 않아야 한다"
  );
}

// ── 5a) LONG + 유효 prev 보다 높은 가격 → patch 생성 ─────────────────────
{
  const res = compute({
    side: "LONG",
    meta: { trail_high: 2100 },
    price: 2145,
    tickNow: 1_700_000_000_000,
  });
  assert.ok(res, "prev 보다 높은 가격은 LONG watermark 를 개선하므로 patch 필요");
  assert.strictEqual(res.patch["meta.trail_high"], 2145);
  assert.strictEqual(res.prev, 2100);
}

// ── 5b) LONG + 유효 prev 와 같거나 낮은 가격 → null ─────────────────────
{
  assert.strictEqual(
    compute({
      side: "LONG",
      meta: { trail_high: 2100 },
      price: 2100,
      tickNow: 1_700_000_000_000,
    }),
    null,
    "LONG watermark 는 같은 가격으로 재-patch 되지 않아야 한다"
  );
  assert.strictEqual(
    compute({
      side: "LONG",
      meta: { trail_high: 2100 },
      price: 2050,
      tickNow: 1_700_000_000_000,
    }),
    null,
    "LONG watermark 는 더 낮은 가격(후퇴)으로 갱신되지 않아야 한다"
  );
}

// ── 6) 방어적 가드: 잘못된 입력은 null 반환 ──────────────────────────────
{
  assert.strictEqual(
    compute({ side: "UNKNOWN", meta: {}, price: 100, tickNow: 1 }),
    null,
    "알 수 없는 side 는 null 을 돌려주어야 한다"
  );
  assert.strictEqual(
    compute({ side: "LONG", meta: {}, price: 0, tickNow: 1 }),
    null,
    "가격 0 은 유효하지 않으므로 null"
  );
  assert.strictEqual(
    compute({ side: "LONG", meta: {}, price: -1, tickNow: 1 }),
    null,
    "음수 가격은 유효하지 않으므로 null"
  );
  assert.strictEqual(
    compute({ side: "LONG", meta: {}, price: 100, tickNow: Number.NaN }),
    null,
    "유효하지 않은 tickNow 는 null"
  );
  // meta=null 은 호출부에서 발생하지 않지만 helper 는 방어적으로 동작해야
  // 한다. meta 를 빈 객체로 취급해 SHORT 첫 tick bootstrap 경로를 탄다.
  {
    const defensive = compute({ side: "SHORT", meta: null, price: 75600, tickNow: 1 });
    assert.ok(defensive, "meta=null 이어도 throw 없이 bootstrap patch 를 만들어야 한다");
    assert.strictEqual(defensive.next, 75600);
    assert.strictEqual(defensive.prev, null);
  }
}

// ── 7) meta 가 undefined 여도 SHORT/LONG 첫 tick bootstrap 은 가능해야 함 ─
//   호출부에서는 항상 meta 를 넘기지만, helper 자체는 meta 가 비어도 안전하게
//   동작해야 한다 (방어적).
{
  const res = compute({
    side: "SHORT",
    meta: {},
    price: 75600,
    tickNow: 1_700_000_000_000,
  });
  assert.ok(res, "meta 빈 객체여도 SHORT 첫 tick bootstrap 은 patch 를 만들어야 한다");
  assert.strictEqual(res.next, 75600);
  assert.strictEqual(res.prev, null);
}

console.log("TRAIL_WATERMARK_ZERO_BOOTSTRAP_TEST_OK");
