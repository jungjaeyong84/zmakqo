"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// position-active-position-invariants.test.js
//
// 2026-04-27 P0-A — single write-boundary invariant validator unit tests.
//
// 이 validator 는 positionsPaper write 경로의 **warn-only 관찰 layer**.
// 두 입구 (full snapshot / meta-only patch) 에서 동일한 lineage / lifecycle
// 계약을 검증한다. 본 테스트는 다음을 보장한다:
//
//   (A) 정상 케이스 — active 포지션이 모든 invariant 를 만족하면 ok=true.
//   (B) ACTIVE + size>0 + entry_event_id=null/empty/whitespace
//       → ACTIVE_REQUIRES_ENTRY_EVENT_ID. SYN 폴백 누락 회귀 클래스.
//   (C) ACTIVE + size>0 + position_side=null
//       → ACTIVE_REQUIRES_POSITION_SIDE.
//   (D) FLAT 또는 size=0 면 active-coupled invariant 는 적용 안 됨.
//   (E) tp_p1_done=true + tp_p1_entry_event_id 부재
//       → TP_P1_DONE_REQUIRES_LINEAGE_ID. LINK 회귀 클래스.
//   (F) tp_p1_done=true + tp_p1_entry_event_id 가 entry_event_id 와 다름
//       → TP_P1_LINEAGE_MISMATCH. cross-cycle leak 클래스.
//   (G) tp_p1_done=true + tp_p0_done!=true
//       → TP_P1_REQUIRES_TP_P0. (positionStateMachine 와 중복 경계 검증)
//   (H) tp_p0_done=true + lineage id 부재 → TP_P0_DONE_REQUIRES_LINEAGE_ID.
//   (I) tp_p0_done=true + lineage mismatch → TP_P0_LINEAGE_MISMATCH.
//   (J) trail_active=true + tp_p1_done!=true → TRAIL_REQUIRES_TP_P1_DONE.
//   (K) qty_base>0 인데 sizePct=0 인 케이스도 active 로 인식 (BINANCEFUT
//       라이브 경로는 size_pct=1 고정이지만, 방어적으로 qty_base 도 본다).
//   (L) meta-patch-only 모드는 active-coupled 계약은 건너뛰고 lineage
//       계약만 본다.
//   (M) describeViolations 는 위반 reason 들을 파이프-구분 요약으로 압축.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");
const {
  validateActivePositionInvariants,
  validateMetaPatchInvariants,
  describeViolations,
  VIOLATION_REASONS,
  __test: { isActiveState, nonEmptyId },
} = require("../services/positionActivePositionInvariants");

function violationsByReason(result) {
  return new Set((result.violations || []).map((v) => v.reason));
}

// ── (A) 정상 active 포지션 ──────────────────────────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionState: "COMMIT",
    positionSide: "LONG",
    sizePct: 1,
    qtyBase: 0.5,
    meta: {
      entry_event_id: "BINANCEFUT|BNBUSDT|15m|1776000000000|LONG_ENTRY|LONG_ENTRY",
      tp_p0_done: false,
      tp_p1_done: false,
      trail_active: false,
    },
  });
  assert.strictEqual(res.ok, true, `(A) clean active position must pass; got ${JSON.stringify(res.violations)}`);
}

// ── (B) ACTIVE + size>0 + entry_event_id 부재 ──────────────────────────────
for (const missing of [null, undefined, "", "   "]) {
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionState: "COMMIT",
    positionSide: "LONG",
    sizePct: 1,
    meta: { entry_event_id: missing },
  });
  assert.strictEqual(res.ok, false,
    `(B) entry_event_id=${JSON.stringify(missing)} must violate`);
  assert.ok(violationsByReason(res).has(VIOLATION_REASONS.ACTIVE_REQUIRES_ENTRY_EVENT_ID),
    `(B) reason missing for entry_event_id=${JSON.stringify(missing)}`);
}

// ── (C) ACTIVE + size>0 + position_side 부재 ────────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: null,
    sizePct: 1,
    meta: { entry_event_id: "X" },
  });
  assert.ok(violationsByReason(res).has(VIOLATION_REASONS.ACTIVE_REQUIRES_POSITION_SIDE),
    "(C) ACTIVE_REQUIRES_POSITION_SIDE must trigger");
}

// ── (D) FLAT 면 active-coupled 면제 ─────────────────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "FLAT",
    positionState: "FLAT",
    positionSide: null,
    sizePct: 0,
    qtyBase: 0,
    meta: { entry_event_id: null },
  });
  assert.strictEqual(res.ok, true,
    `(D) FLAT must skip active-coupled invariants; got ${JSON.stringify(res.violations)}`);
}

// size=0 만으로도 active-coupled 면제 (state 가 ACTIVE 라도)
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionState: "ACTIVE",
    positionSide: null,
    sizePct: 0,
    qtyBase: 0,
    meta: { entry_event_id: null },
  });
  assert.strictEqual(res.ok, true,
    "(D2) size=0 + qty=0 must skip active-coupled invariants regardless of state");
}

// ── (E) tp_p1_done=true + tp_p1 lineage 부재 ───────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: "LONG",
    sizePct: 1,
    meta: {
      entry_event_id: "X|cycle-2",
      tp_p0_done: true,
      tp_p0_entry_event_id: "X|cycle-2",
      tp_p1_done: true,
      tp_p1_entry_event_id: null, // ← LINK 회귀: 이전 사이클에서 leak
    },
  });
  assert.ok(violationsByReason(res).has(VIOLATION_REASONS.TP_P1_DONE_REQUIRES_LINEAGE_ID),
    "(E) TP_P1_DONE_REQUIRES_LINEAGE_ID must trigger");
}

// ── (F) tp_p1_done=true + lineage mismatch (cross-cycle leak) ───────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: "LONG",
    sizePct: 1,
    meta: {
      entry_event_id: "X|cycle-2",
      tp_p0_done: true,
      tp_p0_entry_event_id: "X|cycle-2",
      tp_p1_done: true,
      tp_p1_entry_event_id: "X|cycle-1", // ← 직전 사이클 값이 leak
    },
  });
  assert.ok(violationsByReason(res).has(VIOLATION_REASONS.TP_P1_LINEAGE_MISMATCH),
    "(F) TP_P1_LINEAGE_MISMATCH must trigger");
  // mismatch 와 lineage-id-부재는 동시에 발화하지 않음 (분기 분리 검증)
  assert.ok(!violationsByReason(res).has(VIOLATION_REASONS.TP_P1_DONE_REQUIRES_LINEAGE_ID),
    "(F2) when id is present-but-mismatched, the 'missing id' reason must NOT also fire");
}

// ── (G) tp_p1_done=true + tp_p0_done!=true ──────────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: "LONG",
    sizePct: 1,
    meta: {
      entry_event_id: "X|cycle-2",
      tp_p0_done: false,
      tp_p1_done: true,
      tp_p1_entry_event_id: "X|cycle-2",
    },
  });
  assert.ok(violationsByReason(res).has(VIOLATION_REASONS.TP_P1_REQUIRES_TP_P0),
    "(G) TP_P1_REQUIRES_TP_P0 must trigger");
}

// ── (G2) V2 simplified exit 은 TP0 retired 이므로 TP1_DONE 이 TP0 를 요구하지 않음 ──
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: "SHORT",
    sizePct: 1,
    meta: {
      entry_event_id: "ENTRYV2__ETHUSDT__SHORT__8389766168172990000",
      position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__SHORT__a97c11bc8741",
      simplified_exit_v2_enabled: true,
      tp_p0_done: false,
      tp_p1_done: true,
      tp_p1_entry_event_id: "ENTRYV2__ETHUSDT__SHORT__8389766168172990000",
      trail_active: true,
    },
  });
  assert.ok(!violationsByReason(res).has(VIOLATION_REASONS.TP_P1_REQUIRES_TP_P0),
    "(G2) V2 simplified exit must not require retired TP0 before TP1");
  assert.strictEqual(res.ok, true, `(G2) V2 simplified TP1/trail metadata must pass; got ${JSON.stringify(res.violations)}`);
}

// ── (H) tp_p0_done=true + tp_p0 lineage 부재 ───────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: "LONG",
    sizePct: 1,
    meta: {
      entry_event_id: "X|cycle-2",
      tp_p0_done: true,
      tp_p0_entry_event_id: null,
      tp_p1_done: false,
    },
  });
  assert.ok(violationsByReason(res).has(VIOLATION_REASONS.TP_P0_DONE_REQUIRES_LINEAGE_ID),
    "(H) TP_P0_DONE_REQUIRES_LINEAGE_ID must trigger");
}

// ── (I) tp_p0 lineage mismatch ─────────────────────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: "LONG",
    sizePct: 1,
    meta: {
      entry_event_id: "X|cycle-2",
      tp_p0_done: true,
      tp_p0_entry_event_id: "X|cycle-1",
      tp_p1_done: false,
    },
  });
  assert.ok(violationsByReason(res).has(VIOLATION_REASONS.TP_P0_LINEAGE_MISMATCH),
    "(I) TP_P0_LINEAGE_MISMATCH must trigger");
}

// ── (J) trail_active=true + tp_p1_done 미충족 ──────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: "LONG",
    sizePct: 1,
    meta: {
      entry_event_id: "X|cycle-2",
      tp_p1_done: false,
      trail_active: true, // ← 선행 invariant 위반
    },
  });
  assert.ok(violationsByReason(res).has(VIOLATION_REASONS.TRAIL_REQUIRES_TP_P1_DONE),
    "(J) TRAIL_REQUIRES_TP_P1_DONE must trigger");
}

// ── (K) qty_base>0 도 active 로 인식 ───────────────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: null, // ← 위반 트리거용
    sizePct: 0, // BINANCEFUT 가 size_pct=1 고정이라도 안전망 차원
    qtyBase: 0.5,
    meta: { entry_event_id: null },
  });
  assert.ok(
    violationsByReason(res).has(VIOLATION_REASONS.ACTIVE_REQUIRES_ENTRY_EVENT_ID)
    && violationsByReason(res).has(VIOLATION_REASONS.ACTIVE_REQUIRES_POSITION_SIDE),
    "(K) qty_base>0 must trigger active-coupled invariants even when sizePct=0");
}

// ── (L) meta-patch-only 모드 ────────────────────────────────────────────────
{
  // active-coupled 계약은 패치 단독으로는 검증 불가 — skip.
  const lineageOnly = validateMetaPatchInvariants({
    tp_p1_done: true,
    tp_p1_entry_event_id: null,
  });
  assert.ok(violationsByReason(lineageOnly).has(VIOLATION_REASONS.TP_P1_DONE_REQUIRES_LINEAGE_ID),
    "(L) meta-patch-only must still catch lineage invariants");
  // active-coupled invariant 가 patch-only 에서 false-positive 로 안 튀어야 함
  assert.ok(!violationsByReason(lineageOnly).has(VIOLATION_REASONS.ACTIVE_REQUIRES_ENTRY_EVENT_ID),
    "(L2) meta-patch-only must NOT raise ACTIVE_REQUIRES_ENTRY_EVENT_ID");
  assert.ok(!violationsByReason(lineageOnly).has(VIOLATION_REASONS.ACTIVE_REQUIRES_POSITION_SIDE),
    "(L3) meta-patch-only must NOT raise ACTIVE_REQUIRES_POSITION_SIDE");

  // null/undefined patch 는 ok
  assert.strictEqual(validateMetaPatchInvariants(null).ok, true);
  assert.strictEqual(validateMetaPatchInvariants(undefined).ok, true);
}

// ── (M) describeViolations ─────────────────────────────────────────────────
{
  const res = validateActivePositionInvariants({
    state: "ACTIVE",
    positionSide: null,
    sizePct: 1,
    meta: { entry_event_id: null, tp_p1_done: true, tp_p1_entry_event_id: null },
  });
  const summary = describeViolations(res.violations);
  assert.ok(typeof summary === "string" && summary.length > 0,
    "(M) describeViolations must produce a non-empty string for violations");
  assert.ok(summary.includes(VIOLATION_REASONS.ACTIVE_REQUIRES_ENTRY_EVENT_ID),
    "(M2) summary must include the ACTIVE_REQUIRES_ENTRY_EVENT_ID reason");
  assert.strictEqual(describeViolations([]), null,
    "(M3) describeViolations on empty must be null");
}

// ── helpers (sanity) ────────────────────────────────────────────────────────
assert.strictEqual(isActiveState("active"), true);
assert.strictEqual(isActiveState("ACTIVE"), true);
assert.strictEqual(isActiveState("FLAT"), false);
assert.strictEqual(isActiveState(null), false);
assert.strictEqual(nonEmptyId("  X  "), "X");
assert.strictEqual(nonEmptyId(null), "");
assert.strictEqual(nonEmptyId(undefined), "");

console.log("POSITION_ACTIVE_POSITION_INVARIANTS_TEST_OK");
