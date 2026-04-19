"use strict";

// 2026-04-19 STRUCTURAL FIX (progressive refactor PR #10):
//
// "매번 개별 버그를 가드로 잡느니 writer 단계에서 잘못된 값을 아예 차단하자"
// 는 방향의 첫 스키마 layer. 포지션 meta 의 "가격 성격" 필드들은 공통된
// 도메인 계약을 가진다:
//
//   • `null` / `undefined`                → 허용 (아직 값 없음 = 정상)
//   • `Number.isFinite && > 0`            → 허용 (유효 가격)
//   • 그 외 (0, 음수, NaN, Infinity, 비-숫자) → 위반
//
// 이 계약을 위반하면 downstream 의 여러 가드가 **같은 클래스의 버그** 로
// 반복 재생산된다. 실제 사례:
//
//   • PR #8 — `meta.trail_low === 0` 이 SHORT 포지션의 `price < prevLow`
//     가드를 영구 false 로 만들어 trail watermark 가 영영 업데이트 안 됨.
//   • PR #9 pin — `meta.native_protection_stop_price === null` →
//     `Number(null) === 0` 이 finite 로 평가되면서 SHORT 의
//     `bePrice < 0 - 1e-9` 가 영영 false 가 되어 BE-raise 가 skip.
//
// 두 버그 모두 downstream 에서 **경계값 0** 을 valid 로 잘못 받아들인
// 결과. 본 validator 가 writer 단계에서 걸러주면 이 class 의 버그를
// root-cause 에서 차단할 수 있다.
//
// 현재 이 모듈은 **validator + 진단 metadata** 만 담당. positionsPaper 의
// write 경로에는 warn-only 로 통합되어 있어 실제 쓰기를 막지는 않는다.
// 안정화 (Cloud Logging 의 warn 카운트가 0 에 수렴) 이후 dev/CI 에서
// throw 로 격상, prod 에서도 optional throw 로 이관하는 2단계 cutover
// 가능.

const PRICE_FIELDS = Object.freeze([
  // trail watermark (SHORT/LONG 각각)
  "trail_low",
  "trail_high",
  // native protection SL/TP
  "native_protection_stop_price",
  "native_protection_tp_price",
  // runner floor / trail intent
  "runner_floor_stop",
  // TP0/TP1 실체결 / 목표 가격
  "tp_p0_price",
  "tp_p1_price",
  "tp_p1_target_price",
]);

const PRICE_FIELD_SET = new Set(PRICE_FIELDS);

const VIOLATION_REASONS = Object.freeze({
  ZERO: "PRICE_ZERO_NOT_ALLOWED",
  NEGATIVE: "PRICE_NEGATIVE_NOT_ALLOWED",
  NOT_FINITE: "PRICE_NOT_FINITE",
  NOT_NUMERIC: "PRICE_NOT_NUMERIC",
});

function classifyValue(raw) {
  if (raw === null || raw === undefined) return { ok: true, reason: null };
  const num = typeof raw === "number" ? raw : Number(raw);
  if (typeof raw !== "number" && Number.isFinite(num)) {
    // 문자열 "0", "1.5" 같은 것을 숫자로 수용하는 대신 타입 엄격도를
    // 유지한다. writer 단계에서 meta 는 항상 number|null 이어야 한다.
    return {
      ok: false,
      reason: VIOLATION_REASONS.NOT_NUMERIC,
      normalized: num,
    };
  }
  if (!Number.isFinite(num)) {
    return { ok: false, reason: VIOLATION_REASONS.NOT_FINITE };
  }
  if (num === 0) {
    return { ok: false, reason: VIOLATION_REASONS.ZERO };
  }
  if (num < 0) {
    return { ok: false, reason: VIOLATION_REASONS.NEGATIVE };
  }
  return { ok: true, reason: null };
}

function validatePositionMetaPrices(meta = null) {
  const violations = [];
  if (meta == null || typeof meta !== "object") {
    return { ok: true, violations };
  }
  for (const field of PRICE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(meta, field)) continue;
    const raw = meta[field];
    const cls = classifyValue(raw);
    if (!cls.ok) {
      violations.push({ field, value: raw, reason: cls.reason });
    }
  }
  return { ok: violations.length === 0, violations };
}

// Firestore 의 dotted-path patch (`{ "meta.trail_low": 0 }`) 도 같은
// 계약으로 검증. 위반 시 `key` 에는 원본 dotted path 를, `field` 에는
// `meta.` prefix 를 벗긴 bare field 명을 담아 돌려준다 — 로그/알림에서
// 둘 다 유용하기 때문.
function validatePositionMetaPatch(patch = null) {
  const violations = [];
  if (patch == null || typeof patch !== "object") {
    return { ok: true, violations };
  }
  for (const key of Object.keys(patch)) {
    let field = key;
    if (key.startsWith("meta.")) field = key.slice(5);
    if (!PRICE_FIELD_SET.has(field)) continue;
    const raw = patch[key];
    const cls = classifyValue(raw);
    if (!cls.ok) {
      violations.push({ field, key, value: raw, reason: cls.reason });
    }
  }
  return { ok: violations.length === 0, violations };
}

// 축약 헬퍼: 관측/로그에 넣기 쉬운 요약 문자열.
function describeViolations(violations = []) {
  if (!Array.isArray(violations) || violations.length === 0) return null;
  return violations.map((v) => `${v.field}=${JSON.stringify(v.value)}:${v.reason}`).join("|").slice(0, 500);
}

module.exports = {
  PRICE_FIELDS,
  PRICE_FIELD_SET,
  VIOLATION_REASONS,
  validatePositionMetaPrices,
  validatePositionMetaPatch,
  describeViolations,
  __test: {
    classifyValue,
  },
};
