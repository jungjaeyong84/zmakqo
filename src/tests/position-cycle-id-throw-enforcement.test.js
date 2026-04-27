"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// position-cycle-id-throw-enforcement.test.js
//
// 2026-04-27 Stage 3b-3 — pin the throw-graduation contract for
// `observePositionCycleIdPresence`.
//
// 분리 이유:
//   `position-cycle-id-presence.test.js` 는 "warn-only kill switch" 계약을
//   검증한다 (THROW=0 일 때 침묵하지 않고 warn 만, throw 안 함).
//   본 테스트는 *gate* 계약: `POSITION_CYCLE_ID_THROW_ENABLED=1` 또는
//   non-prod default 일 때 typed error 가 발생해 transaction 자체가
//   시작되지 못하도록 한다.
//
// Cases:
//   (A) NODE_ENV=production + env unset → no throw (prod safety net 유지).
//       backfill 종료 전에 prod 에 코드만 떨어져도 라이브 차단 없음.
//   (B) THROW=1 + cycle_id 없는 ACTIVE → typed error
//       (.code === "POSITION_CYCLE_ID_VIOLATION", invariantSymbol 등 carry).
//   (C) THROW=1 + cycle_id 있음 → no throw.
//   (D) NODE_ENV=test + env unset → throw (non-prod default 가 on).
//   (E) THROW=0 → no throw (kill switch 동작).
//
// 동시에 Stage 1 (POSITION_INVARIANT_VIOLATION) 와 코드/스코프가 *분리* 됨을
// 확인 — 운영 catch-and-handle 코드가 두 invariant 를 다른 routing 으로
// 처리할 수 있도록.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// 알림 채널 unset → notifyActivePositionInvariantViolation no-op (cycle_id
// 부재는 notify 호출 안 하지만, 일반 invariant 가 우연히 같이 트리거되더라도
// Slack 안 가게).
delete process.env.POSITION_INVARIANT_ALERT_CHANNEL;
delete process.env.POSITION_WRITER_ALERT_CHANNEL;
delete process.env.EXIT_INTEGRITY_ALERT_CHANNEL;

const _priorNodeEnv = process.env.NODE_ENV;

function reload({ throwEnabled, nodeEnv } = {}) {
  if (throwEnabled === undefined) delete process.env.POSITION_CYCLE_ID_THROW_ENABLED;
  else process.env.POSITION_CYCLE_ID_THROW_ENABLED = String(throwEnabled);
  if (nodeEnv === null) delete process.env.NODE_ENV;
  else if (nodeEnv !== undefined) process.env.NODE_ENV = String(nodeEnv);
  const path = require.resolve("../storage/positionsPaper");
  delete require.cache[path];
  return require("../storage/positionsPaper");
}

// 빈 cycle_id 인 ACTIVE 포지션 — 본 검증의 canonical breach.
function buildBreachCall() {
  return {
    scope: "FULL_SNAPSHOT_POST_STAMP",
    meta: { entry_event_id: "EVT|TEST" /* no position_cycle_id */ },
    state: "ACTIVE",
    positionState: "COMMIT",
    positionSide: "LONG",
    sizePct: 1,
    qtyBase: 0.5,
    mutationKind: "POSITION_UPSERT",
    writerScope: "CORE",
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    source: "test.position-cycle-id-throw-enforcement",
    reason: "THROW_TEST",
    runId: "RUN_TEST",
  };
}

function buildOkCall() {
  return {
    ...buildBreachCall(),
    meta: { entry_event_id: "EVT|TEST", position_cycle_id: "pcid_42_EVT" },
    reason: "THROW_TEST_OK",
  };
}

const swallowWarn = () => {
  const orig = console.warn;
  console.warn = () => {};
  return () => { console.warn = orig; };
};

// ── (A) NODE_ENV=production + env unset → no throw ─────────────────────────
{
  const restore = swallowWarn();
  try {
    const reloaded = reload({ throwEnabled: undefined, nodeEnv: "production" });
    const obs = reloaded.__test.observePositionCycleIdPresence;
    let threw = null;
    try { obs(buildBreachCall()); } catch (err) { threw = err; }
    assert.strictEqual(threw, null,
      "(A) NODE_ENV=production default must NOT throw — operator must "
      + "explicitly set POSITION_CYCLE_ID_THROW_ENABLED=1 to graduate prod");
  } finally { restore(); }
}

// ── (B) THROW=1 + breach → typed error ─────────────────────────────────────
{
  const restore = swallowWarn();
  try {
    const reloaded = reload({ throwEnabled: "1", nodeEnv: "production" });
    const obs = reloaded.__test.observePositionCycleIdPresence;
    let threw = null;
    try { obs(buildBreachCall()); } catch (err) { threw = err; }
    assert.ok(threw instanceof Error, "(B) THROW=1 + breach must raise an Error");
    assert.strictEqual(threw.code, "POSITION_CYCLE_ID_VIOLATION",
      "(B) error.code must be POSITION_CYCLE_ID_VIOLATION (별도 routing)");
    assert.notStrictEqual(threw.code, "POSITION_INVARIANT_VIOLATION",
      "(B) Stage 1 의 POSITION_INVARIANT_VIOLATION 와 분리되어야 함");
    assert.strictEqual(threw.invariantScope, "FULL_SNAPSHOT_POST_STAMP",
      "(B) scope tag carry");
    assert.strictEqual(threw.invariantSymbol, "LINKUSDT");
    assert.strictEqual(threw.invariantExchange, "BINANCEFUT");
    assert.ok(Array.isArray(threw.invariantViolations) && threw.invariantViolations.length > 0,
      "(B) invariantViolations[] must carry the violation list");
    const reasons = threw.invariantViolations.map((v) => v && v.reason);
    assert.ok(reasons.includes("ACTIVE_REQUIRES_POSITION_CYCLE_ID"),
      `(B) violation list must include ACTIVE_REQUIRES_POSITION_CYCLE_ID. Got: ${JSON.stringify(reasons)}`);
    assert.ok(threw.message.includes("[POSITION_CYCLE_ID_VIOLATION]"),
      "(B) error.message must carry the [POSITION_CYCLE_ID_VIOLATION] prefix for log scanners");
    assert.ok(threw.message.includes("LINKUSDT"),
      "(B) error.message must include symbol so operator sees position at a glance");
  } finally { restore(); }
}

// ── (C) THROW=1 + cycle_id 있음 → no throw ─────────────────────────────────
{
  const restore = swallowWarn();
  try {
    const reloaded = reload({ throwEnabled: "1", nodeEnv: "production" });
    const obs = reloaded.__test.observePositionCycleIdPresence;
    let threw = null;
    try { obs(buildOkCall()); } catch (err) { threw = err; }
    assert.strictEqual(threw, null,
      "(C) THROW=1 with cycle_id present must NOT throw — only breach gates trigger");
  } finally { restore(); }
}

// ── (D) NODE_ENV=test + env unset → throw via non-prod default ─────────────
{
  const restore = swallowWarn();
  try {
    const reloaded = reload({ throwEnabled: undefined, nodeEnv: "test" });
    const obs = reloaded.__test.observePositionCycleIdPresence;
    let threw = null;
    try { obs(buildBreachCall()); } catch (err) { threw = err; }
    assert.ok(threw instanceof Error,
      "(D) NODE_ENV=test with env unset must throw — non-prod default is on (mirrors Stage 1)");
    assert.strictEqual(threw.code, "POSITION_CYCLE_ID_VIOLATION");
  } finally { restore(); }
}

// ── (E) THROW=0 → no throw (kill switch) ───────────────────────────────────
{
  const restore = swallowWarn();
  try {
    const reloaded = reload({ throwEnabled: "0", nodeEnv: "test" });
    const obs = reloaded.__test.observePositionCycleIdPresence;
    let threw = null;
    try { obs(buildBreachCall()); } catch (err) { threw = err; }
    assert.strictEqual(threw, null,
      "(E) THROW=0 must restore warn-only behaviour — kill switch contract for prod backfill window");
  } finally { restore(); }
}

// Cleanup
delete process.env.POSITION_CYCLE_ID_THROW_ENABLED;
if (_priorNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = _priorNodeEnv;

console.log("POSITION_CYCLE_ID_THROW_ENFORCEMENT_TEST_OK");
