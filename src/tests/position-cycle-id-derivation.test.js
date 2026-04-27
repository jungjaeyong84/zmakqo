"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// position-cycle-id-derivation.test.js
//
// 2026-04-27 Stage 3a — pin the pure derivation rules for
// `meta.position_cycle_id` stamped by upsertPosition / upsertPositionMetaOnly.
//
// 이 테스트는 Firestore 트랜잭션을 거치지 않고, helper (derivePositionCycleId
// / deriveMetaOnlyPositionCycleId / generatePositionCycleId) 의 순수 결과만
// 검증한다.  helper 가 결정성/멱등성/사이클 리셋/preservation 의 4가지
// 계약을 동시에 지키는지 보는 것이 목적이며, transaction 통합은 별도
// 회귀 (positions-paper.test.js / position-invariant-alert-ratelimit.test.js)
// 에서 본다.
//
// Cases:
//   (1) FLAT 으로 가는 write (sizePct <= 0)         → null 반환
//   (2) caller 가 explicit cycle_id 명시            → 그 값 그대로
//   (3) prev ACTIVE + cycle_id 보유 + 같은 사이클   → preserve
//   (4) FLAT→ACTIVE 진입 (prev 가 FLAT)             → 새로 generate, seed=entry_event_id
//   (5) ACTIVE 인데 prev 에 cycle_id 가 빈 backfill → 새로 generate
//   (6) FLAT→ACTIVE→FLAT→ACTIVE 사이클 시퀀스       → 두 번째 ACTIVE 는 다른 cycle_id
//   (7) META-only: prev cycle 보유                   → preserve
//   (8) META-only: prev 없고 explicit override       → explicit 사용
//   (9) META-only: prev 없고 explicit 없음           → null (cycle 생성 금지)
//  (10) generatePositionCycleId 형식                 → "pcid_<14d>_<tag>" lex-sortable
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// Force NODE_ENV=test before module load — Stage 1 throw-graduation default
// is on for non-prod, but we never call observeActivePositionInvariants here
// (helpers are pure) so this just keeps env consistent with other tests.
process.env.NODE_ENV = "test";

const {
  __test: {
    generatePositionCycleId,
    derivePositionCycleId,
    deriveMetaOnlyPositionCycleId,
  },
} = require("../storage/positionsPaper");

assert.strictEqual(typeof generatePositionCycleId, "function",
  "generatePositionCycleId export missing");
assert.strictEqual(typeof derivePositionCycleId, "function",
  "derivePositionCycleId export missing");
assert.strictEqual(typeof deriveMetaOnlyPositionCycleId, "function",
  "deriveMetaOnlyPositionCycleId export missing");

// ── (1) FLAT target → null ────────────────────────────────────────────────
{
  const out = derivePositionCycleId({
    prev: { size_pct: 1, meta: { position_cycle_id: "pcid_xxx" } },
    incomingMeta: { entry_event_id: "EVT|FOO" },
    sizePct: 0,
  });
  assert.strictEqual(out, null,
    "(1) sizePct=0 must clear cycle_id (FLAT target ends the cycle)");
}
{
  const out = derivePositionCycleId({
    prev: { size_pct: 1, meta: { position_cycle_id: "pcid_xxx" } },
    incomingMeta: {},
    sizePct: -0.5,
  });
  assert.strictEqual(out, null,
    "(1b) negative sizePct also treated as FLAT-target");
}

// ── (2) explicit cycle_id wins ────────────────────────────────────────────
{
  const out = derivePositionCycleId({
    prev: { size_pct: 1, meta: { position_cycle_id: "pcid_old" } },
    incomingMeta: { position_cycle_id: "pcid_v2_owned_42" },
    sizePct: 1,
  });
  assert.strictEqual(out, "pcid_v2_owned_42",
    "(2) caller-supplied cycle_id (e.g. V2 entry kernel) must win over prev");
}

// ── (3) prev ACTIVE + cycle_id → preserve ─────────────────────────────────
{
  const out = derivePositionCycleId({
    prev: { size_pct: 1, meta: { position_cycle_id: "pcid_keep_me" } },
    incomingMeta: { entry_event_id: "EVT|SAME" },
    sizePct: 1,
  });
  assert.strictEqual(out, "pcid_keep_me",
    "(3) ACTIVE→ACTIVE within a cycle preserves prev cycle_id");
}

// ── (4) FLAT→ACTIVE → generate, seed embedded ─────────────────────────────
{
  const out = derivePositionCycleId({
    prev: { size_pct: 0, meta: {} },
    incomingMeta: { entry_event_id: "EVT|BTC|123" },
    sizePct: 1,
  });
  assert.ok(/^pcid_\d{14}_/.test(out),
    `(4) FLAT→ACTIVE must produce pcid_<14ts>_<tag> form. Got: ${out}`);
  assert.ok(out.endsWith("_EVTBTC123"),
    `(4) seed should be derived from entry_event_id (alphanum-only). Got: ${out}`);
}

// ── (5) ACTIVE backfill (prev ACTIVE but cycle_id empty) → generate ────────
{
  const out = derivePositionCycleId({
    prev: { size_pct: 1, meta: { entry_event_id: "EVT|OLD" /* no cycle_id */ } },
    incomingMeta: { entry_event_id: "EVT|OLD" },
    sizePct: 1,
  });
  assert.ok(/^pcid_\d{14}_EVTOLD$/.test(out),
    `(5) ACTIVE-without-cycle backfill must generate. Got: ${out}`);
}

// ── (6) FLAT→ACTIVE→FLAT→ACTIVE sequence — two distinct cycle_ids ─────────
{
  // First cycle.
  const cycle1 = derivePositionCycleId({
    prev: { size_pct: 0, meta: {} },
    incomingMeta: { entry_event_id: "EVT|A" },
    sizePct: 1,
  });
  // After exit (prev now ACTIVE w/ cycle1), going to FLAT.
  const flatAfter = derivePositionCycleId({
    prev: { size_pct: 1, meta: { position_cycle_id: cycle1, entry_event_id: "EVT|A" } },
    incomingMeta: {},
    sizePct: 0,
  });
  assert.strictEqual(flatAfter, null,
    "(6a) ACTIVE→FLAT must clear");
  // Re-entry from FLAT (after a 1ms-or-greater gap so timestamp differs).
  const sleepMs = 2;
  const wait = Date.now() + sleepMs;
  while (Date.now() < wait) { /* spin */ }
  const cycle2 = derivePositionCycleId({
    prev: { size_pct: 0, meta: {} },
    incomingMeta: { entry_event_id: "EVT|B" },
    sizePct: 1,
  });
  assert.notStrictEqual(cycle1, cycle2,
    "(6b) RE_OPEN after FLAT must produce a distinct cycle_id — this is "
    + "the *whole point* of cycle_id (vulnerability B): preventing "
    + "tp_p1_done from a previous cycle being silently reused.");
  assert.ok(/^pcid_\d{14}_EVTA$/.test(cycle1));
  assert.ok(/^pcid_\d{14}_EVTB$/.test(cycle2));
}

// ── (7) META-only: prev cycle preserved ───────────────────────────────────
{
  const out = deriveMetaOnlyPositionCycleId({
    prev: { meta: { position_cycle_id: "pcid_meta_keep" } },
    incomingMeta: { trail_low: 0.5 },
  });
  assert.strictEqual(out, "pcid_meta_keep",
    "(7) META patch must NOT strip cycle_id — preserve from prev");
}

// ── (8) META-only: explicit override ──────────────────────────────────────
{
  const out = deriveMetaOnlyPositionCycleId({
    prev: { meta: { position_cycle_id: "pcid_old" } },
    incomingMeta: { position_cycle_id: "pcid_override" },
  });
  assert.strictEqual(out, "pcid_override",
    "(8) META patch with explicit cycle_id must win over prev");
}

// ── (9) META-only: no prev, no explicit → null (no creation) ──────────────
{
  const out = deriveMetaOnlyPositionCycleId({
    prev: { meta: {} },
    incomingMeta: { trail_low: 0.5 },
  });
  assert.strictEqual(out, null,
    "(9) META path must NEVER create cycle_id — that's CORE's job. "
    + "Otherwise meta-only writes could spawn ghost cycles.");
}

// ── (10) generatePositionCycleId format check ─────────────────────────────
{
  const a = generatePositionCycleId("EVT|FOO|123");
  assert.ok(/^pcid_\d{14}_EVTFOO123$/.test(a),
    `(10a) format must be pcid_<14digit-ts>_<seed-alphanum>. Got: ${a}`);
  const b = generatePositionCycleId();
  assert.ok(/^pcid_\d{14}_[a-z0-9]+$/.test(b),
    `(10b) format must fall back to random tag when no seed. Got: ${b}`);
  // Lex-sortability: timestamp prefix means later cycles sort after earlier.
  // We can't reliably observe this in a single-ms test on fast hardware
  // (Date.now() granularity), but we can confirm prefix length is fixed at
  // 14 → padStart works correctly even if Date.now < 1e13 in some weird env.
  const tsStr = a.split("_")[1];
  assert.strictEqual(tsStr.length, 14,
    "(10c) timestamp segment must be padded to 14 digits for lex-sort stability");
}

console.log("POSITION_CYCLE_ID_DERIVATION_TEST_OK");
