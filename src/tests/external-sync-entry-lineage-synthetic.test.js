"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// external-sync-entry-lineage-synthetic.test.js
//
// 2026-04-27 senior-audit P0 regression follow-up.
//
// scripts/_active-tp1-audit.js surfaced 3 active BINANCEFUT positions whose
// TP/SL were correctly placed on the exchange but whose
// positions_paper.meta.entry_event_id was null. requiresCanonicalExitEntryLineage
// then suppressed the Telegram TP1-protection-armed alert for these
// positions, which the user observed as "TP1 not set" even though TP1 was
// armed exchange-side.
//
// Root cause: resolveActiveEntryLineageForSync returned entry_event_id=null
// when externalEntryTransition=true and recoverRecentEntryLineage produced
// no usable id. The opening-fill path (buildOpeningFillMetaPatch) already
// has a deterministic SYN| fallback for the same gap; the external-sync
// path was missing it. The fix mirrors that fallback.
//
// This test guards:
//   (A) When externalEntryTransition=true and no recovered lineage is
//       supplied, the helper still returns a non-null SYN|-prefixed id with
//       origin=SYNTHETIC_SYNC and a default signal type of SYN_OPENING.
//   (B) Recovered lineage with an id wins over the synthetic fallback —
//       no behavioural change for the recovery-success path.
//   (C) When raw material is insufficient (no exchange/symbol/syncEventMs)
//       the helper returns entry_event_id=null and origin=MISSING so the
//       live gap remains observable rather than hidden.
//   (D) The non-transition path (externalEntryTransition=false) is
//       unaffected — persisted lineage still wins when present.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");
const {
  __test: {
    resolveActiveEntryLineageForSync,
    SYNTHETIC_OPENING_ENTRY_EVENT_ID_PREFIX,
    SYNTHETIC_OPENING_ENTRY_SIGNAL_TYPE,
  },
} = require("../engine/paperBinanceRunner");

assert.strictEqual(typeof resolveActiveEntryLineageForSync, "function",
  "resolveActiveEntryLineageForSync export missing");

// ── (A) external transition + no recovered lineage → SYN| fallback ──────────
{
  const out = resolveActiveEntryLineageForSync({
    externalEntryTransition: true,
    persistedEntryLineage: null,
    recoveredEntryLineage: null,
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    side: "LONG",
    syncEventMs: 1777000060000,
    signalTfMs: 900000,
  });
  assert.ok(
    typeof out.entry_event_id === "string"
    && out.entry_event_id.startsWith(`${SYNTHETIC_OPENING_ENTRY_EVENT_ID_PREFIX}|`),
    `external sync without recovery must stamp SYN| id, got ${out.entry_event_id}`);
  assert.strictEqual(out.entry_signal_type, SYNTHETIC_OPENING_ENTRY_SIGNAL_TYPE,
    "synthetic-sync path must default signal type to SYN_OPENING");
  assert.strictEqual(out.entry_lineage_origin, "SYNTHETIC_SYNC",
    "origin marker must identify the external-sync synthetic fallback");
  assert.strictEqual(out.entry_exec_bar_ms, 1777000060000,
    "lineageExecMs must fall through to syncEventMs when recovered exec is null");
}

// Determinism: same inputs → byte-identical id (idempotent re-syncs).
{
  const a = resolveActiveEntryLineageForSync({
    externalEntryTransition: true,
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    side: "LONG",
    syncEventMs: 1777000120000,
    signalTfMs: 900000,
  });
  const b = resolveActiveEntryLineageForSync({
    externalEntryTransition: true,
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    side: "LONG",
    syncEventMs: 1777000120000,
    signalTfMs: 900000,
  });
  assert.strictEqual(a.entry_event_id, b.entry_event_id,
    "synthetic id must be deterministic for idempotent re-syncs");
}

// ── (B) recovered lineage wins ──────────────────────────────────────────────
{
  const recovered = {
    entry_event_id: "BINANCEFUT|BNBUSDT|15m|1776000000000|LONG_ENTRY|LONG_ENTRY",
    entry_signal_type: "LONG_ENTRY",
    entry_grade: "A",
    entry_qty_profile: "STANDARD",
    entry_signal_bar_ms: 1776000000000,
    entry_exec_bar_ms: 1776000060000,
  };
  const out = resolveActiveEntryLineageForSync({
    externalEntryTransition: true,
    persistedEntryLineage: null,
    recoveredEntryLineage: recovered,
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    side: "LONG",
    syncEventMs: 1777000060000,
    signalTfMs: 900000,
  });
  assert.strictEqual(out.entry_event_id, recovered.entry_event_id,
    "recovered id must beat the synthetic fallback");
  assert.strictEqual(out.entry_signal_type, "LONG_ENTRY");
}

// ── (C) insufficient raw material → null + origin=MISSING ───────────────────
{
  const out = resolveActiveEntryLineageForSync({
    externalEntryTransition: true,
    exchange: null,
    symbol: null,
    side: "LONG",
    syncEventMs: null,
    signalTfMs: null,
  });
  assert.strictEqual(out.entry_event_id, null,
    "without exchange/symbol/syncEventMs we must NOT fabricate — null preserves visibility");
  assert.strictEqual(out.entry_lineage_origin, "MISSING",
    "origin=MISSING flags the live gap for observability");
}

// ── (D) non-transition path unaffected — persisted lineage still wins ───────
{
  const persisted = {
    entry_event_id: "BINANCEFUT|BNBUSDT|15m|1775000000000|LONG_ENTRY|LONG_ENTRY",
    entry_signal_type: "LONG_ENTRY",
    entry_grade: null,
    entry_qty_profile: null,
    entry_signal_bar_ms: 1775000000000,
    entry_exec_bar_ms: 1775000060000,
  };
  const out = resolveActiveEntryLineageForSync({
    externalEntryTransition: false,
    persistedEntryLineage: persisted,
    recoveredEntryLineage: null,
    // raw material supplied but must be ignored on non-transition path
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    side: "LONG",
    syncEventMs: 1777000060000,
  });
  assert.strictEqual(out.entry_event_id, persisted.entry_event_id,
    "non-transition path must still prefer persisted lineage");
  // origin marker must NOT be set on the non-transition path — only the
  // synthetic-sync branch tags it. Persisted return is the normalized object.
  assert.notStrictEqual(out.entry_lineage_origin, "SYNTHETIC_SYNC",
    "non-transition path must not falsely tag SYNTHETIC_SYNC");
}

console.log("EXTERNAL_SYNC_ENTRY_LINEAGE_SYNTHETIC_TEST_OK");
