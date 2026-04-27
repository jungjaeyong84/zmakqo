"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// 2026-04-27 STRUCTURAL FIX (P0-A — single write-boundary invariant validator).
//
// "매번 개별 버그를 가드로 잡느니 writer 단계에서 잘못된 값을 아예 차단하자"
// 의 두 번째 layer. positionMetaSchema 가 *가격 필드*의 도메인 계약을
// 검증한다면, 이 모듈은 *액티브 포지션의 lineage / 라이프사이클* 계약을
// 검증한다.
//
// 발견된 클래스 (모두 다른 패치, 같은 구조적 결함):
//
//   • 2026-04-26 LINK 회귀 — `tp_p1_done=true` 가 직전 사이클 값이 새
//     사이클로 leak. 새 사이클의 `tp_p1_entry_event_id` 가 null 인데도
//     downstream gate 가 통과해 TP1 가 "이미 처리됨" 으로 인식.
//
//   • 2026-04-27 SYN 폴백 누락 — external sync 경로에서
//     `meta.entry_event_id=null` 인 채로 active position 이 저장됨.
//     canonical exit lineage gate / Telegram dispatch 가 침묵.
//
//   • SCALE_OUT 인데 `tp_p1_done` 이 false 인 케이스 — positionStateMachine
//     에서 잡히지만 그 검증은 derivePositionState 의 결과를 인자로 받는
//     "next state" 단계라, meta 자체의 inter-field 일관성은 별도.
//
// 이 validator 는 두 가지 view 를 제공한다:
//
//   (1) `validateActivePositionInvariants(snapshot)` — full snapshot
//       (state/sizePct/positionSide/meta) 을 받아 lineage/lifecycle 계약을
//       전수 검증. upsertPosition write boundary 용.
//
//   (2) `validateMetaPatchInvariants(meta)` — meta 패치 단독으로 검증
//       가능한 *meta-internal* 계약만. upsertPositionMetaOnly 용 (해당
//       경로는 state/sizePct 를 직접 받지 않고 prev snapshot 위에 merge).
//
// 두 함수 모두 stateless / pure / 의존성 없음 → unit test 화 100%.
//
// 현 단계는 **warn-only 관찰**. 위반 시 throw 하지 않고 결과만 리턴한다.
// positionsPaper 의 write 경로에서는 `observeMetaPriceSchema` 와 동일
// 패턴으로 structuredLog 만 발화. Cloud Logging 의
// `position_active_invariant_violation` warn 카운트가 0 에 수렴한 뒤
// dev/CI 에서 strict throw 로 격상하는 2-단계 cutover.
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_POSITION_STATES = Object.freeze(new Set([
  "ACTIVE",
  "COMMIT",
  "PROBE",
  "SCALE_OUT",
]));

const VIOLATION_REASONS = Object.freeze({
  ACTIVE_REQUIRES_ENTRY_EVENT_ID: "ACTIVE_REQUIRES_ENTRY_EVENT_ID",
  ACTIVE_REQUIRES_POSITION_SIDE: "ACTIVE_REQUIRES_POSITION_SIDE",
  TP_P1_DONE_REQUIRES_LINEAGE_ID: "TP_P1_DONE_REQUIRES_LINEAGE_ID",
  TP_P1_LINEAGE_MISMATCH: "TP_P1_LINEAGE_MISMATCH",
  TP_P1_REQUIRES_TP_P0: "TP_P1_REQUIRES_TP_P0",
  TP_P0_DONE_REQUIRES_LINEAGE_ID: "TP_P0_DONE_REQUIRES_LINEAGE_ID",
  TP_P0_LINEAGE_MISMATCH: "TP_P0_LINEAGE_MISMATCH",
  TRAIL_REQUIRES_TP_P1_DONE: "TRAIL_REQUIRES_TP_P1_DONE",
});

function isActiveState(stateOrPositionState) {
  const s = String(stateOrPositionState || "").trim().toUpperCase();
  return ACTIVE_POSITION_STATES.has(s);
}

function nonEmptyId(raw) {
  return String(raw == null ? "" : raw).trim();
}

function pushViolation(violations, field, reason, value) {
  violations.push({ field, reason, value: value === undefined ? null : value });
}

function checkLineageInvariantsOnMeta(meta, violations) {
  if (meta == null || typeof meta !== "object") return;

  // tp_p1_done=true ⇒ tp_p1_entry_event_id 비공백 + entry_event_id 일치.
  // 이 invariant 를 두 갈래 (lineage 부재 / lineage mismatch) 로 분리해
  // alert 시 정확한 root cause 가 보이도록 한다. 하나의 reason 으로
  // 묶으면 LINK-class (lineage 없음) 와 cross-cycle (lineage 다름) 이
  // 한 버킷에 섞여 디버깅이 어려워짐.
  if (meta.tp_p1_done === true) {
    const tp1Id = nonEmptyId(meta.tp_p1_entry_event_id);
    const entryId = nonEmptyId(meta.entry_event_id);
    if (!tp1Id) {
      pushViolation(violations, "tp_p1_entry_event_id",
        VIOLATION_REASONS.TP_P1_DONE_REQUIRES_LINEAGE_ID, meta.tp_p1_entry_event_id);
    } else if (entryId && tp1Id !== entryId) {
      pushViolation(violations, "tp_p1_entry_event_id",
        VIOLATION_REASONS.TP_P1_LINEAGE_MISMATCH,
        { tp_p1_entry_event_id: tp1Id, entry_event_id: entryId });
    }
    if (meta.tp_p0_done !== true) {
      pushViolation(violations, "tp_p0_done",
        VIOLATION_REASONS.TP_P1_REQUIRES_TP_P0, meta.tp_p0_done);
    }
  }

  // tp_p0_done 도 같은 lineage 계약. tp_p1 보다 약하지만 LINK-class 의
  // 어머니 — tp_p0 lineage 가 leak 하면 그 위의 tp_p1 자동승계가 같이
  // 망가진다. 적어도 lineage id 가 비공백인지는 강제.
  if (meta.tp_p0_done === true) {
    const tp0Id = nonEmptyId(meta.tp_p0_entry_event_id);
    const entryId = nonEmptyId(meta.entry_event_id);
    if (!tp0Id) {
      pushViolation(violations, "tp_p0_entry_event_id",
        VIOLATION_REASONS.TP_P0_DONE_REQUIRES_LINEAGE_ID, meta.tp_p0_entry_event_id);
    } else if (entryId && tp0Id !== entryId) {
      pushViolation(violations, "tp_p0_entry_event_id",
        VIOLATION_REASONS.TP_P0_LINEAGE_MISMATCH,
        { tp_p0_entry_event_id: tp0Id, entry_event_id: entryId });
    }
  }

  if (meta.trail_active === true && meta.tp_p1_done !== true) {
    pushViolation(violations, "trail_active",
      VIOLATION_REASONS.TRAIL_REQUIRES_TP_P1_DONE,
      { trail_active: true, tp_p1_done: meta.tp_p1_done });
  }
}

function validateActivePositionInvariants({
  state = null,
  positionState = null,
  positionSide = null,
  sizePct = null,
  qtyBase = null,
  meta = null,
} = {}) {
  const violations = [];
  const active = isActiveState(state) || isActiveState(positionState);
  const size = Number(sizePct);
  const qty = Number(qtyBase);
  const hasSize = (Number.isFinite(size) && size > 0) || (Number.isFinite(qty) && qty > 0);

  if (active && hasSize) {
    const entryId = nonEmptyId(meta && meta.entry_event_id);
    if (!entryId) {
      pushViolation(violations, "entry_event_id",
        VIOLATION_REASONS.ACTIVE_REQUIRES_ENTRY_EVENT_ID, meta && meta.entry_event_id);
    }
    const side = nonEmptyId(positionSide);
    if (!side) {
      pushViolation(violations, "position_side",
        VIOLATION_REASONS.ACTIVE_REQUIRES_POSITION_SIDE, positionSide);
    }
  }

  checkLineageInvariantsOnMeta(meta, violations);

  return { ok: violations.length === 0, violations };
}

function validateMetaPatchInvariants(meta = null) {
  const violations = [];
  if (meta == null || typeof meta !== "object") {
    return { ok: true, violations };
  }
  checkLineageInvariantsOnMeta(meta, violations);
  return { ok: violations.length === 0, violations };
}

function describeViolations(violations = []) {
  if (!Array.isArray(violations) || violations.length === 0) return null;
  return violations
    .map((v) => `${v.field}:${v.reason}`)
    .join("|")
    .slice(0, 500);
}

// 2026-04-27 Stage 3b-1 — position_cycle_id presence (warn-only).
//
// Stage 3a 가 upsertPosition 의 write boundary 에서 모든 신규 ACTIVE write
// 에 `meta.position_cycle_id` 를 stamp 하도록 만들었다. 그러나 이미 라이브
// 에서 ACTIVE 상태로 떠 있는 기존 포지션은 cycle_id 가 비어 있을 수 있고,
// META-only write 만 들어오면 그대로 유지된다 (CORE 가 사이클 생성 권한자).
//
// 따라서 cycle_id 부재를 *일반 invariant 로 묶어 throw 시키면* backfill 이
// 끝나기 전까지 라이브 정상 트래픽까지 차단되는 부작용이 생긴다.
//
// 이 단계 (Stage 3b-1) 의 목표:
//   • cycle_id 부재를 *별도 함수* 로 분리해서 warn-only 관찰 가능하게.
//   • Stage 1 에서 만든 `POSITION_INVARIANT_THROW_ENABLED` 격상 경로를
//     건드리지 않음 (그게 격상되는 invariant 와 별도 cutover).
//   • backfill 스크립트가 실제 라이브를 정리한 뒤 (Stage 3b-3) 일반
//     invariant 에 통합해 throw 격상.
//
// reason 은 enum 으로 export 해서 alert/log 양쪽에서 같은 식별자를 사용.
const CYCLE_ID_VIOLATION_REASONS = Object.freeze({
  ACTIVE_REQUIRES_POSITION_CYCLE_ID: "ACTIVE_REQUIRES_POSITION_CYCLE_ID",
});

function validatePositionCycleIdPresence({
  state = null,
  positionState = null,
  sizePct = null,
  qtyBase = null,
  meta = null,
} = {}) {
  const violations = [];
  const active = isActiveState(state) || isActiveState(positionState);
  const size = Number(sizePct);
  const qty = Number(qtyBase);
  const hasSize = (Number.isFinite(size) && size > 0) || (Number.isFinite(qty) && qty > 0);
  if (!active || !hasSize) return { ok: true, violations };
  const cycleId = nonEmptyId(meta && meta.position_cycle_id);
  if (!cycleId) {
    pushViolation(
      violations,
      "position_cycle_id",
      CYCLE_ID_VIOLATION_REASONS.ACTIVE_REQUIRES_POSITION_CYCLE_ID,
      meta && meta.position_cycle_id
    );
  }
  return { ok: violations.length === 0, violations };
}

module.exports = {
  ACTIVE_POSITION_STATES,
  VIOLATION_REASONS,
  CYCLE_ID_VIOLATION_REASONS,
  validateActivePositionInvariants,
  validateMetaPatchInvariants,
  validatePositionCycleIdPresence,
  describeViolations,
  __test: {
    isActiveState,
    nonEmptyId,
    checkLineageInvariantsOnMeta,
  },
};
