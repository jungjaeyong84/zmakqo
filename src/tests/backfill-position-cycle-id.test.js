"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// backfill-position-cycle-id.test.js
//
// 2026-04-27 Stage 3b-2 — pin the active-detection helper used by the
// backfill script.  This is the only branch in the script where a wrong
// classification could either *miss* a live ACTIVE position (leaving it
// without cycle_id forever) or *touch* a FLAT row (writing a fabricated
// cycle_id onto a closed cycle, which corrupts history).
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");
const { isActivePosition } = require("../../scripts/backfill-position-cycle-id");

// ── ACTIVE — explicit state + size_pct > 0 ────────────────────────────────
assert.strictEqual(isActivePosition({ state: "ACTIVE", size_pct: 1, qty_base: 0.5 }), true,
  "ACTIVE+size_pct>0 must be detected");

// ── ACTIVE — qty_base only (size_pct missing) ─────────────────────────────
assert.strictEqual(isActivePosition({ state: "ACTIVE", qty_base: 0.1 }), true,
  "ACTIVE+qty_base>0 (size_pct null) must still count as ACTIVE");

// ── ACTIVE via positionState (라이브 데이터 일관성 깨진 케이스) ──────────
assert.strictEqual(isActivePosition({ position_state: "COMMIT", qty_base: 0.1 }), true,
  "position_state=COMMIT 만 있어도 (state 누락) ACTIVE 판정 — 라이브 일관성 깨진 도큐먼트 보호");

// ── FLAT — state=FLAT 면 size 가 양수여도 무시 ────────────────────────────
assert.strictEqual(isActivePosition({ state: "FLAT", size_pct: 1 }), false,
  "state=FLAT 은 size_pct>0 이라도 backfill 대상 아님 (FLAT 직전 잔재 가능)");

// ── FLAT — size 0 + qty 0 ─────────────────────────────────────────────────
assert.strictEqual(isActivePosition({ state: "ACTIVE", size_pct: 0, qty_base: 0 }), false,
  "size 0 / qty 0 는 ACTIVE 라벨이라도 stamp 대상 아님 (실질 FLAT)");

// ── 비어 있는 도큐먼트 ────────────────────────────────────────────────────
assert.strictEqual(isActivePosition({}), false,
  "빈 도큐먼트는 ACTIVE 가 아님");

// ── size_pct 가 문자열로 들어왔을 때 (Firestore 저장 변형) ───────────────
assert.strictEqual(isActivePosition({ state: "ACTIVE", size_pct: "0.5" }), true,
  "문자열 숫자 size_pct 도 toNum 으로 정상 변환");

console.log("BACKFILL_POSITION_CYCLE_ID_TEST_OK");
