"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// position-invariant-alert-ratelimit.test.js
//
// 2026-04-27 P0-C — invariant violation Slack alert ratelimit unit tests.
//
// 이 테스트는 새 helper `shouldSendPositionInvariantAlert` 의 dedupe / cooldown
// 동작과 fire-and-forget notify helper 의 안전한 no-op 동작을 검증한다.
// 실제 Slack 알림은 호출하지 않는다 (테스트 환경엔 CHANNEL 미설정 → no-op).
//
// 검증 항목:
//   (A) 같은 (exchange, symbol, scope, reason) 키는 cooldown 안에서 dedupe.
//   (B) 같은 symbol 이라도 reason 이 다르면 별도 카운트 — 클래스별 알림.
//   (C) 같은 reason 이라도 symbol 이 다르면 별도 카운트 — multi-symbol 회귀
//       감지 시 모든 영향 symbol 이 알림 받아야 함.
//   (D) cooldown 초과 후엔 다시 발화 허용.
//   (E) cooldownMs=0 인 경우 항상 허용 (디버깅 옵션).
//   (F) notifyActivePositionInvariantViolation 은 CHANNEL 미설정 환경에서
//       throw 하지 않고 false 반환 (안전한 no-op).
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// 테스트 의존성: 채널이 설정되어 있으면 실제 sendAlert 가 호출될 수 있다.
// 의도하지 않은 외부 호출 방지를 위해 require 전에 환경변수 비움.
delete process.env.POSITION_INVARIANT_ALERT_CHANNEL;
delete process.env.POSITION_WRITER_ALERT_CHANNEL;
delete process.env.EXIT_INTEGRITY_ALERT_CHANNEL;

const {
  __test: {
    shouldSendPositionInvariantAlert,
    notifyActivePositionInvariantViolation,
    positionInvariantAlertState,
  },
} = require("../storage/positionsPaper");

assert.strictEqual(typeof shouldSendPositionInvariantAlert, "function",
  "shouldSendPositionInvariantAlert export missing");
assert.strictEqual(typeof notifyActivePositionInvariantViolation, "function",
  "notifyActivePositionInvariantViolation export missing");

function clearState() {
  // 모듈-수준 Map 을 직접 비워서 테스트 격리. 다른 테스트가 같은 프로세스에서
  // 먼저 호출돼도 영향 없도록.
  if (positionInvariantAlertState && typeof positionInvariantAlertState.clear === "function") {
    positionInvariantAlertState.clear();
  }
}

// ── (A) 같은 키는 cooldown 안에서 dedupe ────────────────────────────────────
clearState();
{
  const t0 = 1_700_000_000_000;
  const a = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    invariantScope: "FULL_SNAPSHOT",
    reason: "ACTIVE_REQUIRES_ENTRY_EVENT_ID",
    nowMs: t0,
    cooldownMs: 30 * 60 * 1000,
  });
  const b = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    invariantScope: "FULL_SNAPSHOT",
    reason: "ACTIVE_REQUIRES_ENTRY_EVENT_ID",
    nowMs: t0 + 60_000, // 1 min later — still inside 30 min cooldown
    cooldownMs: 30 * 60 * 1000,
  });
  assert.strictEqual(a, true, "(A) first call must allow");
  assert.strictEqual(b, false, "(A) duplicate within cooldown must dedupe");
}

// ── (B) 같은 symbol, 다른 reason → 별도 카운트 ──────────────────────────────
clearState();
{
  const t0 = 1_700_000_000_000;
  const a = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    invariantScope: "FULL_SNAPSHOT",
    reason: "ACTIVE_REQUIRES_ENTRY_EVENT_ID",
    nowMs: t0,
    cooldownMs: 30 * 60 * 1000,
  });
  const b = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    invariantScope: "FULL_SNAPSHOT",
    reason: "TP_P1_DONE_REQUIRES_LINEAGE_ID",
    nowMs: t0 + 1_000,
    cooldownMs: 30 * 60 * 1000,
  });
  assert.strictEqual(a, true, "(B) first reason must allow");
  assert.strictEqual(b, true, "(B) different reason must NOT be deduped by first");
}

// ── (C) 다른 symbol → 별도 카운트 ───────────────────────────────────────────
clearState();
{
  const t0 = 1_700_000_000_000;
  const symbols = ["LINKUSDT", "BNBUSDT", "ETHUSDT"];
  for (const sym of symbols) {
    const ok = shouldSendPositionInvariantAlert({
      exchange: "BINANCEFUT",
      symbol: sym,
      invariantScope: "FULL_SNAPSHOT",
      reason: "ACTIVE_REQUIRES_ENTRY_EVENT_ID",
      nowMs: t0,
      cooldownMs: 30 * 60 * 1000,
    });
    assert.strictEqual(ok, true, `(C) symbol=${sym} must allow (multi-symbol regression)`);
  }
}

// ── (D) cooldown 초과 후 재발화 ────────────────────────────────────────────
clearState();
{
  const t0 = 1_700_000_000_000;
  const cooldownMs = 5 * 60 * 1000; // 5 min
  const a = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    invariantScope: "FULL_SNAPSHOT",
    reason: "ACTIVE_REQUIRES_ENTRY_EVENT_ID",
    nowMs: t0,
    cooldownMs,
  });
  const inside = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    invariantScope: "FULL_SNAPSHOT",
    reason: "ACTIVE_REQUIRES_ENTRY_EVENT_ID",
    nowMs: t0 + cooldownMs - 1,
    cooldownMs,
  });
  const after = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    invariantScope: "FULL_SNAPSHOT",
    reason: "ACTIVE_REQUIRES_ENTRY_EVENT_ID",
    nowMs: t0 + cooldownMs + 1,
    cooldownMs,
  });
  assert.strictEqual(a, true);
  assert.strictEqual(inside, false, "(D) inside cooldown must dedupe");
  assert.strictEqual(after, true, "(D) past cooldown must re-allow");
}

// ── (E) cooldownMs=0 → 항상 허용 ────────────────────────────────────────────
clearState();
{
  const t0 = 1_700_000_000_000;
  const a = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT", symbol: "X", invariantScope: "FULL_SNAPSHOT",
    reason: "R", nowMs: t0, cooldownMs: 0,
  });
  const b = shouldSendPositionInvariantAlert({
    exchange: "BINANCEFUT", symbol: "X", invariantScope: "FULL_SNAPSHOT",
    reason: "R", nowMs: t0 + 1, cooldownMs: 0,
  });
  assert.strictEqual(a, true);
  assert.strictEqual(b, true, "(E) cooldown=0 must always allow");
}

// ── (F) channel 미설정 → notify helper 안전한 no-op ────────────────────────
(async () => {
  clearState();
  const result = await notifyActivePositionInvariantViolation({
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    invariantScope: "FULL_SNAPSHOT",
    mutationKind: "POSITION_UPSERT",
    source: "BINANCE_FUTURES_POSITION_SYNC",
    state: "ACTIVE",
    positionState: "COMMIT",
    positionSide: "LONG",
    sizePct: 1,
    qtyBase: 0.5,
    violations: [
      { field: "entry_event_id", reason: "ACTIVE_REQUIRES_ENTRY_EVENT_ID", value: null },
    ],
  });
  assert.strictEqual(result, false,
    "(F) channel 미설정 시 notify 는 false 반환 (no-op, throw 금지)");
  console.log("POSITION_INVARIANT_ALERT_RATELIMIT_TEST_OK");
})();
