"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// position-cycle-id-presence.test.js
//
// 2026-04-27 Stage 3b-1 — pin the warn-only observer for
// `meta.position_cycle_id` 부재.
//
// Stage 3a 가 모든 신규 ACTIVE write 에서 cycle_id 를 stamp 하지만, 라이브
// 에서 이미 ACTIVE 로 떠 있는 *기존* 포지션은 cycle_id 가 비어 있을 수
// 있다.  이 테스트는 두 가지 계약을 핀:
//
//   (A) `validatePositionCycleIdPresence` 는 ACTIVE 인데 cycle_id 가 없으면
//       위반을 리턴, 그 외엔 ok.
//   (B) `observePositionCycleIdPresence` 는 위반 시 structuredLog 발화 ↑,
//       위반 없을 시 침묵 — POSITION_CYCLE_ID_THROW_ENABLED=0 (kill switch)
//       경로에서 throw 하지 않음을 핀.  Stage 3b-3 에서 throw 가 default
//       이지만, 운영 backfill 미완료 상태에서 prod 가 즉시 throw 하지
//       않도록 kill-switch 경로 자체가 살아 있어야 함.
//
// throw 쪽 contract 는 별도 테스트
// (position-cycle-id-throw-enforcement.test.js) 가 책임짐.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

process.env.NODE_ENV = "test";
// Stage 3b-3 가 cycle_id 부재를 throw 격상시키지만, 본 테스트는 warn-only
// 계약을 검증하므로 throw 플래그를 명시적으로 끈다.  (test 프로세스는
// per-test fresh process — 이 mutation 은 다른 테스트에 새지 않음.)
process.env.POSITION_CYCLE_ID_THROW_ENABLED = "0";

const {
  validatePositionCycleIdPresence,
  CYCLE_ID_VIOLATION_REASONS,
} = require("../services/positionActivePositionInvariants");

assert.strictEqual(typeof validatePositionCycleIdPresence, "function",
  "validatePositionCycleIdPresence export missing");
assert.strictEqual(CYCLE_ID_VIOLATION_REASONS.ACTIVE_REQUIRES_POSITION_CYCLE_ID,
  "ACTIVE_REQUIRES_POSITION_CYCLE_ID",
  "ACTIVE_REQUIRES_POSITION_CYCLE_ID reason enum must be exported and stable");

// ── (A1) ACTIVE + sizePct>0 + cycle_id 없음 → 위반 ─────────────────────────
{
  const res = validatePositionCycleIdPresence({
    state: "ACTIVE",
    positionState: "COMMIT",
    sizePct: 1,
    qtyBase: 0.5,
    meta: { entry_event_id: "EVT|TEST" /* no cycle_id */ },
  });
  assert.strictEqual(res.ok, false, "(A1) ACTIVE + cycle_id 없음 must be a violation");
  assert.strictEqual(res.violations.length, 1);
  assert.strictEqual(res.violations[0].field, "position_cycle_id");
  assert.strictEqual(res.violations[0].reason, "ACTIVE_REQUIRES_POSITION_CYCLE_ID");
}

// ── (A2) ACTIVE + cycle_id 있음 → ok ──────────────────────────────────────
{
  const res = validatePositionCycleIdPresence({
    state: "ACTIVE",
    positionState: "COMMIT",
    sizePct: 1,
    qtyBase: 0.5,
    meta: { entry_event_id: "EVT|TEST", position_cycle_id: "pcid_123_EVT" },
  });
  assert.strictEqual(res.ok, true, "(A2) ACTIVE + cycle_id 있음 must pass");
  assert.strictEqual(res.violations.length, 0);
}

// ── (A3) FLAT (sizePct=0) → 검증 대상 아님 ────────────────────────────────
{
  const res = validatePositionCycleIdPresence({
    state: "FLAT",
    positionState: "FLAT",
    sizePct: 0,
    qtyBase: 0,
    meta: {},
  });
  assert.strictEqual(res.ok, true,
    "(A3) FLAT 포지션은 cycle_id 검증 대상 외 (cycle 자체가 종료됨)");
}

// ── (A4) state=null 이지만 positionState=ACTIVE — 같이 잡아야 ────────────
{
  const res = validatePositionCycleIdPresence({
    state: null,
    positionState: "PROBE",
    sizePct: 0.3,
    qtyBase: 0.1,
    meta: {},
  });
  assert.strictEqual(res.ok, false,
    "(A4) state 가 비어도 positionState 가 active 이면 검증 대상 (라이브 데이터에 둘 다 일관되지 않은 케이스 존재)");
  assert.strictEqual(res.violations[0].reason, "ACTIVE_REQUIRES_POSITION_CYCLE_ID");
}

// ── (A5) cycle_id 가 공백 문자열 → 위반 (nonEmpty 가드) ───────────────────
{
  const res = validatePositionCycleIdPresence({
    state: "ACTIVE",
    positionState: "COMMIT",
    sizePct: 1,
    meta: { position_cycle_id: "   " },
  });
  assert.strictEqual(res.ok, false,
    "(A5) 공백만 있는 cycle_id 는 부재로 취급 — 검증의 의미가 트리밍된 식별자라");
}

// ── (B) observePositionCycleIdPresence — 위반 시 structuredLog warn 발화 ──
{
  // structuredLog 가 console.warn 로 JSON 을 dump 하므로 capture
  const captured = [];
  const origWarn = console.warn;
  console.warn = (...args) => { captured.push(args.join(" ")); };
  try {
    const { __test } = require("../storage/positionsPaper");
    assert.strictEqual(typeof __test.observePositionCycleIdPresence, "function",
      "observePositionCycleIdPresence must be exposed via __test");
    __test.observePositionCycleIdPresence({
      scope: "FULL_SNAPSHOT_POST_STAMP",
      meta: { entry_event_id: "EVT|FOO" }, // no cycle_id
      state: "ACTIVE",
      positionState: "COMMIT",
      positionSide: "LONG",
      sizePct: 1,
      qtyBase: 0.5,
      mutationKind: "POSITION_UPSERT",
      writerScope: "CORE",
      exchange: "BINANCEFUT",
      symbol: "FOOUSDT",
      source: "test.position-cycle-id-presence",
      reason: "PRESENCE_TEST",
      runId: "RUN_TEST",
    });
    assert.ok(captured.length === 1,
      "(B1) cycle_id 부재 시 structuredLog 가 warn 한 번 발화해야 함");
    const rec = JSON.parse(captured[0]);
    assert.strictEqual(rec.event, "position_cycle_id_missing");
    assert.strictEqual(rec.exchange, "BINANCEFUT");
    assert.strictEqual(rec.symbol, "FOOUSDT");
    assert.strictEqual(rec.invariant_scope, "FULL_SNAPSHOT_POST_STAMP");
    assert.strictEqual(rec.writer_scope, "CORE");
    assert.strictEqual(rec.violation_n, 1);
    assert.strictEqual(rec.violations[0].reason, "ACTIVE_REQUIRES_POSITION_CYCLE_ID");
  } finally {
    console.warn = origWarn;
  }
}

// ── (B2) observe 가 throw 하지 않음 (kill switch / cutover 안전성) ────────
{
  const { __test } = require("../storage/positionsPaper");
  let threw = null;
  const origWarn = console.warn;
  console.warn = () => { /* swallow */ };
  try {
    __test.observePositionCycleIdPresence({
      meta: {},
      state: "ACTIVE",
      sizePct: 1,
    });
  } catch (err) {
    threw = err;
  } finally {
    console.warn = origWarn;
  }
  assert.strictEqual(threw, null,
    "(B2) Stage 3b-1 observer 는 절대 throw 하지 않음 — backfill 전 라이브 차단 금지");
}

// ── (B3) cycle_id 있을 시 침묵 ────────────────────────────────────────────
{
  const captured = [];
  const origWarn = console.warn;
  console.warn = (...args) => { captured.push(args.join(" ")); };
  try {
    const { __test } = require("../storage/positionsPaper");
    __test.observePositionCycleIdPresence({
      meta: { position_cycle_id: "pcid_42_EVT" },
      state: "ACTIVE",
      sizePct: 1,
    });
  } finally {
    console.warn = origWarn;
  }
  assert.strictEqual(captured.length, 0,
    "(B3) cycle_id 있을 시 observer 는 침묵 (false-positive 노이즈 금지)");
}

console.log("POSITION_CYCLE_ID_PRESENCE_TEST_OK");
