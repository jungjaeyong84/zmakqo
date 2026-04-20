"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// opening-fill-entry-event-id-guaranteed.test.js
//
// 2026-04-20 senior-audit P0 BLOCKER regression.
//
// Root cause of the TP1 Telegram silent-drop incident:
//   1. buildEntryEventId() returns null whenever any of
//      (exchange, symbol, tf, signalBarCloseMs, event) is missing.
//   2. buildOpeningFillMetaPatch() historically stored that null verbatim
//      into positions_paper.meta.entry_event_id.
//   3. requiresCanonicalExitEntryLineage() treats TP0/TP1/TRAIL as requiring
//      a non-empty lineage id.
//   4. resolveCanonicalExitWritePayload() emits transitionEvents=[] when the
//      id is missing, which trips MISSING_CANONICAL_EXIT_TRANSITION in
//      tradeExecutionAlert.js and silently skips the Telegram dispatch.
//
// The EXIT_TP_P1_RECOVERY path in paperBinanceRunner.js is a band-aid that
// hardcodes the canonical transition to sneak past the same gate. The fix
// here is at the *write boundary*: opening-fill meta must never persist
// null for entry_event_id. A deterministic synthetic id replaces the null
// and is marked in meta.entry_lineage_origin for audit.
//
// This test guards:
//   (A) When intent provides entryEventIdFromIntent, the write keeps that id
//       verbatim and marks origin=INTENT. (no behavioural regression)
//   (B) When intent is missing it entirely, the write produces a
//       SYN|-prefixed synthetic id, marks origin=SYNTHETIC, and supplies a
//       non-null entry_signal_type default (SYN_OPENING).
//   (C) The synthetic id is deterministic — same raw inputs must produce
//       byte-identical ids. This is what makes re-syncs idempotent.
//   (D) When raw material is insufficient (missing execBarCloseMs) the
//       function does NOT fabricate — it returns null and marks
//       origin=MISSING so the live gap is observable rather than hidden.
//   (E) Synthetic ids are distinguishable from real ids by prefix, so audit
//       pipelines can tell which positions opened without intent-sourced
//       lineage.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");
const {
  __test: {
    buildOpeningFillMetaPatch,
    buildSyntheticOpeningEntryEventId,
    SYNTHETIC_OPENING_ENTRY_EVENT_ID_PREFIX,
    SYNTHETIC_OPENING_ENTRY_SIGNAL_TYPE,
  },
} = require("../engine/paperBinanceRunner");

assert.strictEqual(typeof buildOpeningFillMetaPatch, "function",
  "buildOpeningFillMetaPatch export missing");
assert.strictEqual(typeof buildSyntheticOpeningEntryEventId, "function",
  "buildSyntheticOpeningEntryEventId export missing");
assert.strictEqual(SYNTHETIC_OPENING_ENTRY_EVENT_ID_PREFIX, "SYN",
  "synthetic prefix must be stable — audit pipelines depend on it");
assert.strictEqual(SYNTHETIC_OPENING_ENTRY_SIGNAL_TYPE, "SYN_OPENING",
  "synthetic signal type must be stable");

// ── (A) INTENT path — unchanged when intent supplies the id ─────────────────
{
  const patch = buildOpeningFillMetaPatch({
    leverageValue: 5,
    signalTfMs: 60000,
    newSize: 0.5,
    features: {},
    entryEventIdFromIntent: "BINANCEFUT|BNBUSDT|15m|1776000000000|LONG_ENTRY|LONG_ENTRY",
    entrySignalTypeFromIntent: "LONG_ENTRY",
    signalBarCloseTimeUtcMs: 1776000000000,
    execBarCloseMs: 1776000060000,
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    metaSide: "LONG",
  });
  assert.strictEqual(
    patch.entry_event_id,
    "BINANCEFUT|BNBUSDT|15m|1776000000000|LONG_ENTRY|LONG_ENTRY",
    "INTENT path must keep the intent-supplied id verbatim");
  assert.strictEqual(patch.entry_signal_type, "LONG_ENTRY",
    "INTENT path must keep the intent-supplied signal type verbatim");
  assert.strictEqual(patch.entry_lineage_origin, "INTENT",
    "origin marker must identify the intent-sourced path");
  // Origin mirror field must also be populated (for recovery lookups).
  assert.strictEqual(
    patch.origin_entry_event_id,
    "BINANCEFUT|BNBUSDT|15m|1776000000000|LONG_ENTRY|LONG_ENTRY",
    "origin_entry_event_id must mirror entry_event_id");
}

// ── (B) SYNTHETIC path — intent id missing, raw material present ────────────
{
  const patch = buildOpeningFillMetaPatch({
    leverageValue: 5,
    signalTfMs: 60000,
    newSize: 0.5,
    features: {},
    entryEventIdFromIntent: null,
    entrySignalTypeFromIntent: null,
    signalBarCloseTimeUtcMs: null,
    execBarCloseMs: 1776000060000,
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    metaSide: "LONG",
  });
  assert.ok(patch.entry_event_id, "synthetic fallback must populate entry_event_id");
  assert.ok(
    patch.entry_event_id.startsWith("SYN|"),
    `synthetic id must start with SYN| prefix — got ${patch.entry_event_id}`);
  // Full shape check: SYN|EXCHANGE|SYMBOL|60000ms|execMs|OPENING_LONG|OPENING_LONG
  assert.strictEqual(
    patch.entry_event_id,
    "SYN|BINANCEFUT|BNBUSDT|60000ms|1776000060000|OPENING_LONG|OPENING_LONG",
    "synthetic id must match the documented 7-field pipe layout");
  assert.strictEqual(patch.entry_lineage_origin, "SYNTHETIC",
    "origin marker must identify the synthetic path so audits can separate");
  assert.strictEqual(patch.entry_signal_type, "SYN_OPENING",
    "synthetic path must fall back to SYN_OPENING signal type");
  // The origin mirror fields must also receive the synthetic id — otherwise
  // canonical-transition lookup that goes through posMeta.origin_* would
  // still see null and the bug would re-appear at TP1 time.
  assert.strictEqual(patch.origin_entry_event_id, patch.entry_event_id,
    "origin_entry_event_id must mirror synthetic entry_event_id");
  assert.strictEqual(patch.origin_entry_signal_type, "SYN_OPENING",
    "origin_entry_signal_type must mirror synthetic value");
}

// ── (C) Determinism — same inputs must give the same id ─────────────────────
{
  const mk = () => buildSyntheticOpeningEntryEventId({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    signalTfMs: 60000,
    side: "LONG",
    execBarCloseMs: 1776000060000,
  });
  const a = mk();
  const b = mk();
  assert.strictEqual(a, b,
    "synthetic id must be deterministic — resync after a crash must produce "
    + "the same id, otherwise canonical_exit_transition dedupe breaks");
  // Spot-check determinism across string-case tolerance: lowercase inputs
  // must normalise to the same id (prevents accidental twin ids).
  const c = buildSyntheticOpeningEntryEventId({
    exchange: "binancefut",
    symbol: "bnbusdt",
    signalTfMs: 60000,
    side: "long",
    execBarCloseMs: 1776000060000,
  });
  assert.strictEqual(a, c,
    "synthetic id must be case-insensitive on exchange/symbol/side — any "
    + "case drift upstream must not produce a duplicate lineage record");
}

// ── (D) Insufficient raw material — function must refuse, not invent ────────
{
  // Missing execBarCloseMs — the only structurally-required field.
  const patch = buildOpeningFillMetaPatch({
    leverageValue: 5,
    signalTfMs: 60000,
    newSize: 0.5,
    features: {},
    entryEventIdFromIntent: null,
    entrySignalTypeFromIntent: null,
    signalBarCloseTimeUtcMs: null,
    execBarCloseMs: null,
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    metaSide: "LONG",
  });
  assert.strictEqual(patch.entry_event_id, null,
    "without execBarCloseMs the function must NOT fabricate an id — the "
    + "gap should remain observable so the live path can be fixed");
  assert.strictEqual(patch.entry_lineage_origin, "MISSING",
    "MISSING origin must be explicit so ops can query for it in Firestore");
  // Also assert that the standalone synthetic builder rejects the same input.
  assert.strictEqual(
    buildSyntheticOpeningEntryEventId({
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      signalTfMs: 60000,
      side: "LONG",
      execBarCloseMs: null,
    }),
    null,
    "builder must return null without execBarCloseMs");
  assert.strictEqual(
    buildSyntheticOpeningEntryEventId({
      exchange: null,
      symbol: "BNBUSDT",
      signalTfMs: 60000,
      side: "LONG",
      execBarCloseMs: 1776000060000,
    }),
    null,
    "builder must return null without exchange");
  assert.strictEqual(
    buildSyntheticOpeningEntryEventId({
      exchange: "BINANCEFUT",
      symbol: null,
      signalTfMs: 60000,
      side: "LONG",
      execBarCloseMs: 1776000060000,
    }),
    null,
    "builder must return null without symbol");
}

// ── (E) Synthetic id shape — parser-friendly fallbacks ──────────────────────
{
  // Missing signalTfMs — the id still materialises (it is not structurally
  // required) and uses NA as a visible marker so audits can see "tf was
  // unknown at write time" without having to cross-reference.
  const id = buildSyntheticOpeningEntryEventId({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    signalTfMs: null,
    side: "LONG",
    execBarCloseMs: 1776000060000,
  });
  assert.strictEqual(
    id,
    "SYN|BINANCEFUT|BNBUSDT|NA|1776000060000|OPENING_LONG|OPENING_LONG",
    "missing tf must surface as NA token, not collapse or crash");
  // Missing side — same treatment.
  const idNoSide = buildSyntheticOpeningEntryEventId({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    signalTfMs: 60000,
    side: null,
    execBarCloseMs: 1776000060000,
  });
  assert.ok(idNoSide.endsWith("OPENING_NA|OPENING_NA"),
    "missing side must surface as OPENING_NA, preserving field count");
}

// ── (F) Intent id "takes precedence" even when synthetic is available ───────
// Regression guard: if the intent supplies a real id, we must NEVER
// substitute a synthetic one (that would silently double-author lineage).
{
  const patch = buildOpeningFillMetaPatch({
    leverageValue: 5,
    signalTfMs: 60000,
    newSize: 0.5,
    features: {},
    entryEventIdFromIntent: "BINANCEFUT|BNBUSDT|15m|1234|REAL|REAL",
    entrySignalTypeFromIntent: "REAL",
    signalBarCloseTimeUtcMs: 1234,
    execBarCloseMs: 5678,
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    metaSide: "LONG",
  });
  assert.strictEqual(patch.entry_event_id, "BINANCEFUT|BNBUSDT|15m|1234|REAL|REAL",
    "intent-supplied id must take absolute precedence over the synthetic");
  assert.strictEqual(patch.entry_lineage_origin, "INTENT",
    "origin marker must reflect the actual source");
  assert.ok(!patch.entry_event_id.startsWith("SYN|"),
    "real id must not be overwritten with a SYN| id — that would lose "
    + "provenance and break cross-reference with signals_live");
}

console.log("OPENING_FILL_ENTRY_EVENT_ID_GUARANTEED_TEST_OK");
