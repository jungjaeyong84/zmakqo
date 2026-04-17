"use strict";

// C2 — persistent store for exit-authority qty accumulators.
//
// Previously the per-chain-key state (tp0, tp1, trail, sl, total) lived in a
// plain `Map` that was constructed at the start of every fills-sync run and
// discarded at the end.  On process restart or deep backfill, Binance may
// re-deliver the same fills through the `GET /fapi/v1/userTrades` endpoint;
// without a durable cap the second pass treats qty as fresh and silently
// double-consumes the TP1 contract slot.
//
// This module provides a minimal Firestore-backed key/value store keyed by the
// canonical `chainKey` built by `positionStateMachine.buildCanonicalExitChainKey`.
// Callers should:
//   1. `loadExitAuthorityStates(db, chainKeys)` before processing a batch.
//   2. Merge the loaded values into the in-memory `Map` before cap checks.
//   3. `persistExitAuthorityStates(db, patches)` after the batch.
//
// If the caller passes a falsy `db` handle, all functions short-circuit to
// the legacy pure-in-memory behaviour, keeping unit tests deterministic and
// keeping the backfill scripts operable without Firestore access.

const COLLECTION = "position_exit_authority_state";
const SCHEMA_VERSION = 1;

function normalizeKey(chainKey) {
  return String(chainKey || "").trim();
}

function sanitizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeState(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    tp0: sanitizeNumber(source.tp0),
    tp1: sanitizeNumber(source.tp1),
    trail: sanitizeNumber(source.trail),
    sl: sanitizeNumber(source.sl),
    forceExitAll: sanitizeNumber(source.forceExitAll ?? source.force_exit_all),
    forceExitHalf: sanitizeNumber(source.forceExitHalf ?? source.force_exit_half),
    otherExit: sanitizeNumber(source.otherExit ?? source.other_exit),
    total: sanitizeNumber(source.total),
  };
}

function mergeStates(prior = {}, fresh = {}) {
  const a = normalizeState(prior);
  const b = normalizeState(fresh);
  return {
    tp0: Math.max(a.tp0, b.tp0),
    tp1: Math.max(a.tp1, b.tp1),
    trail: Math.max(a.trail, b.trail),
    sl: Math.max(a.sl, b.sl),
    forceExitAll: Math.max(a.forceExitAll, b.forceExitAll),
    forceExitHalf: Math.max(a.forceExitHalf, b.forceExitHalf),
    otherExit: Math.max(a.otherExit, b.otherExit),
    total: Math.max(a.total, b.total),
  };
}

async function loadExitAuthorityStates(db = null, chainKeys = []) {
  const out = new Map();
  if (!db) return out;
  const keys = (Array.isArray(chainKeys) ? chainKeys : [])
    .map(normalizeKey)
    .filter((key) => key.length > 0);
  if (!keys.length) return out;
  await Promise.all(keys.map(async (key) => {
    try {
      const snap = await db.collection(COLLECTION).doc(key).get();
      if (!snap || !snap.exists) return;
      const data = snap.data() || {};
      out.set(key, normalizeState(data.state || data));
    } catch (_err) {
      // Failure to load is non-fatal — legacy in-memory cap still applies.
    }
  }));
  return out;
}

async function persistExitAuthorityStates(db = null, patches = []) {
  if (!db) return { persisted: 0, skipped: true };
  const rows = Array.isArray(patches) ? patches : [];
  if (!rows.length) return { persisted: 0, skipped: false };
  const nowIso = new Date().toISOString();
  let persisted = 0;
  await Promise.all(rows.map(async (row) => {
    const key = normalizeKey(row && row.chainKey);
    if (!key) return;
    const state = normalizeState(row && row.state);
    try {
      await db.collection(COLLECTION).doc(key).set({
        chain_key: key,
        exchange: String((row && row.exchange) || "").toUpperCase() || null,
        symbol: String((row && row.symbol) || "").toUpperCase() || null,
        entry_event_id: row && row.entryEventId ? String(row.entryEventId) : null,
        state,
        schema_version: SCHEMA_VERSION,
        updated_at: nowIso,
      }, { merge: true });
      persisted += 1;
    } catch (_err) {
      // Non-fatal — legacy in-memory cap continues to protect the run.
    }
  }));
  return { persisted, skipped: false };
}

module.exports = {
  COLLECTION,
  SCHEMA_VERSION,
  normalizeState,
  mergeStates,
  loadExitAuthorityStates,
  persistExitAuthorityStates,
};
