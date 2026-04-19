"use strict";

// 2026-04-19 PR #10: positionMetaSchema unit tests.
//
// 이 validator 가 막으려는 class 의 버그는 **경계값 0 을 finite 하다는
// 이유로 valid 로 받아들이는 downstream 가드** 들이다.  대표 케이스 두
// 가지:
//
//   • `meta.trail_low === 0`                → PR #8 SHORT trail jam
//   • `meta.native_protection_stop_price === null`
//       → `Number(null) === 0` → PR #9 pin, BE-raise skip
//
// writer 단계에서 schema 로 걸러주면 양쪽 downstream 가드가 올바른
// 도메인 값 (positive finite | null) 만 보게 된다. 테스트는 계약을
// pin 해두어 refactor 시 실수로 경계값이 다시 통과되는 것을 막는다.

const assert = require("assert");

const {
  PRICE_FIELDS,
  VIOLATION_REASONS,
  validatePositionMetaPrices,
  validatePositionMetaPatch,
  describeViolations,
  __test,
} = require("../services/positionMetaSchema");

const { classifyValue } = __test;

// ---------------------------------------------------------------------------
// 1. classifyValue — 계약 핵심
// ---------------------------------------------------------------------------

(function classifyValueAcceptsNullish() {
  // null / undefined 는 "아직 값 없음" 상태로 writer 에서 항상 허용되어야
  // 한다.  meta 초기 부트스트랩 + 포지션 종결 후 정리 단계가 이 상태를
  // 사용한다.
  for (const v of [null, undefined]) {
    const r = classifyValue(v);
    assert.strictEqual(r.ok, true, `nullish (${String(v)}) must be ok`);
    assert.strictEqual(r.reason, null, "nullish must carry no reason");
  }
})();

(function classifyValueAcceptsPositiveFinite() {
  for (const v of [1, 1.5, 100, 1e-6, 1e12, 0.00000001]) {
    const r = classifyValue(v);
    assert.strictEqual(r.ok, true, `positive finite ${v} must be ok`);
  }
})();

(function classifyValueRejectsZero() {
  // ZERO 는 이 validator 의 존재 이유 그 자체.  명시적으로 PIN.
  const r = classifyValue(0);
  assert.strictEqual(r.ok, false, "zero must be rejected");
  assert.strictEqual(r.reason, VIOLATION_REASONS.ZERO,
    "zero reason must be PRICE_ZERO_NOT_ALLOWED");
  // -0 also zero:
  const r2 = classifyValue(-0);
  assert.strictEqual(r2.ok, false, "-0 must also be rejected (=== 0)");
  assert.strictEqual(r2.reason, VIOLATION_REASONS.ZERO);
})();

(function classifyValueRejectsNegative() {
  for (const v of [-0.0001, -1, -100, -1e12]) {
    const r = classifyValue(v);
    assert.strictEqual(r.ok, false, `negative ${v} must be rejected`);
    assert.strictEqual(r.reason, VIOLATION_REASONS.NEGATIVE);
  }
})();

(function classifyValueRejectsNonFinite() {
  for (const v of [NaN, Infinity, -Infinity]) {
    const r = classifyValue(v);
    assert.strictEqual(r.ok, false, `non-finite ${String(v)} must be rejected`);
    assert.strictEqual(r.reason, VIOLATION_REASONS.NOT_FINITE);
  }
})();

(function classifyValueRejectsNonNumericTypes() {
  // 문자열/불리언/객체 등은 writer 단계에서 모두 잘못된 타입.
  // "5.0", true 같은 것도 "숫자로 변환 가능하지만 숫자 아님" 으로 막는다.
  // 타입 엄격도는 downstream 가드가 `typeof === "number"` 에 의존하지
  // 않아도 되도록 writer 에서 불변 조건을 만든다.
  const cases = [
    "5", "5.0", "0", "1e3", true, false, {}, [], () => 1,
  ];
  for (const v of cases) {
    const r = classifyValue(v);
    assert.strictEqual(r.ok, false,
      `non-numeric (${JSON.stringify(v)}) must be rejected`);
    // "5" / "5.0" 같이 finite 로 변환되는 것은 NOT_NUMERIC,
    // {} / [] / true 처럼 finite 가 아닌 것은 NOT_FINITE 로 떨어진다.
    // 둘 중 하나이기만 하면 된다 — 둘 다 reject 상태.
    assert.ok(
      r.reason === VIOLATION_REASONS.NOT_NUMERIC
        || r.reason === VIOLATION_REASONS.NOT_FINITE,
      `reason for ${JSON.stringify(v)} was ${r.reason}`,
    );
  }
})();

// ---------------------------------------------------------------------------
// 2. validatePositionMetaPrices — flat meta 객체 계약
// ---------------------------------------------------------------------------

(function metaPricesEmptyOrNullIsOk() {
  assert.deepStrictEqual(validatePositionMetaPrices(null),
    { ok: true, violations: [] });
  assert.deepStrictEqual(validatePositionMetaPrices(undefined),
    { ok: true, violations: [] });
  assert.deepStrictEqual(validatePositionMetaPrices({}),
    { ok: true, violations: [] });
  // 스칼라는 object 가 아니므로 통과 (writer 에서 쓰이지 않는 케이스).
  assert.deepStrictEqual(validatePositionMetaPrices(42),
    { ok: true, violations: [] });
})();

(function metaPricesAcceptsValidFields() {
  const meta = {
    trail_low: 1.234,
    trail_high: null,          // null 은 허용
    native_protection_stop_price: 100,
    native_protection_tp_price: undefined, // undefined 도 허용
    runner_floor_stop: 0.5,
    tp_p0_price: 0.99,
    tp_p1_price: 1.01,
    tp_p1_target_price: 1.02,
    unrelated_field: 0,        // 가격 필드 아니면 무시
    another: "anything",
  };
  const res = validatePositionMetaPrices(meta);
  assert.strictEqual(res.ok, true,
    `valid meta should pass; violations=${JSON.stringify(res.violations)}`);
  assert.strictEqual(res.violations.length, 0);
})();

(function metaPricesPinsKnownBugClasses() {
  // PR #8 원인 재현:
  const shortJam = validatePositionMetaPrices({ trail_low: 0 });
  assert.strictEqual(shortJam.ok, false);
  assert.strictEqual(shortJam.violations.length, 1);
  assert.deepStrictEqual(shortJam.violations[0], {
    field: "trail_low",
    value: 0,
    reason: VIOLATION_REASONS.ZERO,
  }, "PR #8 class must be caught: trail_low=0 → ZERO violation");

  // PR #9 pin (추후 별도 PR 에서 BE helper 수정) 관점의 경계값:
  // writer 단계에서 0 자체도 차단 → downstream `Number(null)===0` 이
  // 애초에 발생할 여지를 줄인다 (null 은 여전히 통과; downstream 쪽 fix
  // 는 별개 PR 이지만 이 schema 는 최소한 0 이 meta 에 쓰이는 경로는
  // 모두 봉쇄함을 pin).
  const stopZero = validatePositionMetaPrices({
    native_protection_stop_price: 0,
  });
  assert.strictEqual(stopZero.ok, false);
  assert.strictEqual(stopZero.violations[0].reason, VIOLATION_REASONS.ZERO);
})();

(function metaPricesCollectsAllViolations() {
  const meta = {
    trail_low: 0,                        // ZERO
    trail_high: -1,                      // NEGATIVE
    native_protection_stop_price: NaN,   // NOT_FINITE
    native_protection_tp_price: "5.0",   // NOT_NUMERIC
    runner_floor_stop: 1.0,              // ok
    tp_p0_price: null,                   // ok
  };
  const res = validatePositionMetaPrices(meta);
  assert.strictEqual(res.ok, false);
  // 4 violations — 이 validator 는 첫 위반에서 멈추지 않고 전부 모은다.
  // 이렇게 해야 로그 한 줄로 전체 contract 위반 상태를 관찰 가능.
  assert.strictEqual(res.violations.length, 4,
    `expected 4 violations, got ${res.violations.length}: `
    + JSON.stringify(res.violations));

  const byField = Object.fromEntries(res.violations.map((v) => [v.field, v.reason]));
  assert.strictEqual(byField.trail_low, VIOLATION_REASONS.ZERO);
  assert.strictEqual(byField.trail_high, VIOLATION_REASONS.NEGATIVE);
  assert.strictEqual(byField.native_protection_stop_price, VIOLATION_REASONS.NOT_FINITE);
  // "5.0" 은 NOT_NUMERIC 으로 떨어져야 한다 (Number("5.0")=5 is finite).
  assert.strictEqual(byField.native_protection_tp_price, VIOLATION_REASONS.NOT_NUMERIC);
})();

(function metaPricesIgnoresAbsentFields() {
  // 필드가 아예 없으면 hasOwnProperty 체크로 넘어가야 한다.
  // (undefined 값이 명시적으로 있는 것과 동치로 취급해도 OK.)
  const res = validatePositionMetaPrices({ foo: "bar" });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.violations.length, 0);
})();

// ---------------------------------------------------------------------------
// 3. validatePositionMetaPatch — Firestore dotted-path 계약
// ---------------------------------------------------------------------------

(function patchEmptyIsOk() {
  assert.deepStrictEqual(validatePositionMetaPatch(null),
    { ok: true, violations: [] });
  assert.deepStrictEqual(validatePositionMetaPatch({}),
    { ok: true, violations: [] });
})();

(function patchAcceptsValidDottedPaths() {
  const patch = {
    "meta.trail_low": 1.5,
    "meta.native_protection_stop_price": null,
    "meta.tp_p1_price": 100,
    // 가격 필드 아닌 path 는 무시되어야 한다.
    "meta.last_update_ms": 1700000000000,
    "meta.side": "SHORT",
    "status": "OPEN",
  };
  const res = validatePositionMetaPatch(patch);
  assert.strictEqual(res.ok, true,
    `valid patch should pass; violations=${JSON.stringify(res.violations)}`);
})();

(function patchAcceptsBareFieldNames() {
  // 일부 write 경로는 dotted-path 가 아닌 bare field 이름으로도 부른다
  // (positionsPaper 내부에서 이미 `meta.` prefix 를 떼어낸 뒤 재검증).
  // 두 형태 모두 지원해야 한다.
  const patch = { trail_low: 2.0, tp_p0_price: null };
  const res = validatePositionMetaPatch(patch);
  assert.strictEqual(res.ok, true);
})();

(function patchCatchesZeroOnDottedPath() {
  // PR #8 같은 케이스가 실제 writer 에서 어떻게 생겼는지:
  // upsertPositionMetaOnly(docId, { "meta.trail_low": 0, ... })
  const patch = { "meta.trail_low": 0 };
  const res = validatePositionMetaPatch(patch);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.violations.length, 1);
  const v = res.violations[0];
  // key 는 원본 dotted path, field 는 bare — 둘 다 있어야 로그/알림에서
  // 쓸모 있다.
  assert.strictEqual(v.field, "trail_low");
  assert.strictEqual(v.key, "meta.trail_low");
  assert.strictEqual(v.value, 0);
  assert.strictEqual(v.reason, VIOLATION_REASONS.ZERO);
})();

(function patchCollectsMultipleViolations() {
  const patch = {
    "meta.trail_low": 0,
    "meta.trail_high": -5,
    "meta.native_protection_tp_price": Infinity,
    "meta.runner_floor_stop": "not-a-number",
    "meta.tp_p0_price": 1.5,    // ok
    "meta.side": "LONG",        // 가격 아님
  };
  const res = validatePositionMetaPatch(patch);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.violations.length, 4,
    `expected 4 violations, got ${res.violations.length}`);
  const keys = res.violations.map((v) => v.key).sort();
  assert.deepStrictEqual(keys, [
    "meta.native_protection_tp_price",
    "meta.runner_floor_stop",
    "meta.trail_high",
    "meta.trail_low",
  ]);
})();

(function patchIgnoresNonPriceFields() {
  // exit_stage, side, last_update_ms 등은 스키마 적용 대상 아님.
  // (그들은 별도 컨트랙트 — 이 validator 의 scope 밖.)
  const patch = {
    "meta.exit_stage": "TP1",
    "meta.side": "SHORT",
    "meta.last_update_ms": 0,   // 0 이어도 타임스탬프 필드는 ok (가격 아님)
    "meta.some_counter": 0,
  };
  const res = validatePositionMetaPatch(patch);
  assert.strictEqual(res.ok, true,
    `non-price fields must not trigger violations; got `
    + JSON.stringify(res.violations));
})();

// ---------------------------------------------------------------------------
// 4. PRICE_FIELDS contract — writer 통합 시 의존할 불변 목록
// ---------------------------------------------------------------------------

(function priceFieldsListIsStable() {
  // positionsPaper writer 통합 + downstream observability 가 이 목록에
  // 의존한다.  새 필드 추가/제거는 의도적인 변경이므로 테스트로 PIN.
  assert.ok(Array.isArray(PRICE_FIELDS) && Object.isFrozen(PRICE_FIELDS),
    "PRICE_FIELDS must be a frozen array");
  const expected = [
    "trail_low",
    "trail_high",
    "native_protection_stop_price",
    "native_protection_tp_price",
    "runner_floor_stop",
    "tp_p0_price",
    "tp_p1_price",
    "tp_p1_target_price",
  ].sort();
  assert.deepStrictEqual([...PRICE_FIELDS].sort(), expected,
    "PRICE_FIELDS 목록은 의도적 변경 전에는 고정");
})();

// ---------------------------------------------------------------------------
// 5. describeViolations — 로그 요약 포맷
// ---------------------------------------------------------------------------

(function describeViolationsEmpty() {
  assert.strictEqual(describeViolations([]), null);
  assert.strictEqual(describeViolations(null), null);
  assert.strictEqual(describeViolations(undefined), null);
})();

(function describeViolationsBuildsCompactString() {
  const s = describeViolations([
    { field: "trail_low", value: 0, reason: "PRICE_ZERO_NOT_ALLOWED" },
    { field: "trail_high", value: -1, reason: "PRICE_NEGATIVE_NOT_ALLOWED" },
  ]);
  assert.ok(typeof s === "string");
  assert.ok(s.includes("trail_low=0:PRICE_ZERO_NOT_ALLOWED"));
  assert.ok(s.includes("trail_high=-1:PRICE_NEGATIVE_NOT_ALLOWED"));
  assert.ok(s.includes("|"), "multiple violations must be pipe-separated");
})();

(function describeViolationsCapsLength() {
  // 병적인 케이스로 500 자 이상 생성 후 cap 확인.
  const bloated = Array.from({ length: 200 }, (_, i) => ({
    field: `trail_low_${i}`,
    value: 0,
    reason: "PRICE_ZERO_NOT_ALLOWED",
  }));
  const s = describeViolations(bloated);
  assert.ok(s.length <= 500,
    `describeViolations must cap to <=500, got length ${s.length}`);
})();

// ---------------------------------------------------------------------------
// 6. positionsPaper writer integration — warn-only contract
// ---------------------------------------------------------------------------
//
// 실제 writer (upsertPosition / upsertPositionMetaOnly) 는 Firestore RTT
// 가 필요해서 순수 단위 테스트로 부르기 어렵다. 대신 writer 내부가 호출
// 하는 얇은 observer helper `observeMetaPriceSchema` 를 직접 찔러서
// 계약을 pin 한다:
//
//   • meta 가 clean 이면 warn 이 한 번도 안 나와야 한다.
//   • meta 에 PR #8/#9 class 위반이 있으면
//     `position_meta_price_schema_violation` 이름으로 warn 하고,
//     payload 에 violations + mutation_kind + writer_scope 등 진단
//     컨텍스트가 실려야 한다.
//   • warn-only 이므로 throw 하지 않는다 (리턴값도 undefined).

(function observerIsWarnOnlyAndCarriesDiagnostics() {
  const { __test } = require("../storage/positionsPaper");
  const { observeMetaPriceSchema } = __test;

  const warns = [];
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = (...args) => warns.push(args);
  console.log = () => {}; // 다른 이벤트 노이즈 차단

  let thrown = null;
  try {
    // 1) clean meta → 아무 것도 안 나와야 함.
    observeMetaPriceSchema({
      meta: { trail_low: 1.5, native_protection_stop_price: null },
      mutationKind: "POSITION_META_UPSERT",
      writerScope: "META",
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      source: "PAPER_RUNNER",
    });
    assert.strictEqual(warns.length, 0,
      `clean meta must not warn; got ${warns.length} warns`);

    // 2) PR #8 repro — trail_low=0.
    const ret = observeMetaPriceSchema({
      meta: { trail_low: 0, trail_high: -1 },
      mutationKind: "POSITION_META_UPSERT",
      writerScope: "META",
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      source: "TICK_EXIT",
      reason: "TRAIL_WATERMARK_UPDATE",
      requestId: "req-42",
      traceId: "trace-42",
      runId: "run-42",
    });
    // warn-only 계약: void return.
    assert.strictEqual(ret, undefined, "observer must not return a value");
    assert.strictEqual(warns.length, 1,
      `one violation batch → one warn; got ${warns.length}`);

    // console.warn 로 들어간 것은 JSON.stringify 된 한 줄.
    const [line] = warns[0];
    const rec = JSON.parse(line);
    assert.strictEqual(rec.event, "position_meta_price_schema_violation");
    assert.strictEqual(rec.exchange, "BINANCEFUT");
    assert.strictEqual(rec.symbol, "DOGEUSDT");
    assert.strictEqual(rec.mutation_kind, "POSITION_META_UPSERT");
    assert.strictEqual(rec.writer_scope, "META");
    assert.strictEqual(rec.source, "TICK_EXIT");
    assert.strictEqual(rec.reason, "TRAIL_WATERMARK_UPDATE");
    assert.strictEqual(rec.request_id, "req-42");
    assert.strictEqual(rec.trace_id, "trace-42");
    assert.strictEqual(rec.run_id, "run-42");
    assert.strictEqual(rec.violation_n, 2);
    assert.ok(Array.isArray(rec.violations));
    const fields = rec.violations.map((v) => v.field).sort();
    assert.deepStrictEqual(fields, ["trail_high", "trail_low"]);
    assert.ok(typeof rec.summary === "string" && rec.summary.length > 0);
  } catch (err) {
    thrown = err;
  } finally {
    console.warn = origWarn;
    console.log = origLog;
  }
  if (thrown) throw thrown;
})();

console.log("PASS position-meta-price-schema");
