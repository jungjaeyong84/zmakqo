"use strict";

// 2026-04-28 F2 Phase 3 — Cooldown state storage for V2 server-native
// ENTRY signal generator. Lives in Firestore so the cooldown survives
// Cloud Run revision restarts / autoscale instance churn.
//
// Document key: `${exchange}__${symbol}__${tf}` under collection
// `v2_server_entry_cooldown`. Each doc holds:
//   - last_long_signal_bar_close_ms / last_long_trigger
//   - last_short_signal_bar_close_ms / last_short_trigger
//   - updated_at
//
// API stays minimal — just get/set. Caller (paperBinanceRunner) is
// responsible for round-tripping the value through generateV2EntrySignals.

const { getFirestore } = require("./firestore");

const COLLECTION = "v2_server_entry_cooldown";

function buildCooldownDocId({ exchange, symbol, tf } = {}) {
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const t = String(tf || "").trim();
  if (!ex || !sym || !t) return null;
  return `${ex}__${sym}__${t}`;
}

async function getV2ServerEntryCooldownState({ exchange, symbol, tf } = {}) {
  const id = buildCooldownDocId({ exchange, symbol, tf });
  if (!id) return null;
  try {
    const snap = await getFirestore().collection(COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
      last_long_signal_bar_close_ms:
        Number.isFinite(Number(data.last_long_signal_bar_close_ms))
          ? Number(data.last_long_signal_bar_close_ms)
          : null,
      last_long_trigger:
        typeof data.last_long_trigger === "string" && data.last_long_trigger
          ? data.last_long_trigger
          : null,
      last_short_signal_bar_close_ms:
        Number.isFinite(Number(data.last_short_signal_bar_close_ms))
          ? Number(data.last_short_signal_bar_close_ms)
          : null,
      last_short_trigger:
        typeof data.last_short_trigger === "string" && data.last_short_trigger
          ? data.last_short_trigger
          : null,
    };
  } catch (_) {
    return null;
  }
}

async function setV2ServerEntryCooldownState({
  exchange,
  symbol,
  tf,
  state,
} = {}) {
  const id = buildCooldownDocId({ exchange, symbol, tf });
  if (!id) return null;
  if (!state || typeof state !== "object") return null;
  const payload = {
    cooldown_id: id,
    exchange: String(exchange || "").trim().toUpperCase(),
    symbol: String(symbol || "").trim().toUpperCase(),
    tf: String(tf || "").trim(),
    last_long_signal_bar_close_ms:
      Number.isFinite(Number(state.last_long_signal_bar_close_ms))
        ? Number(state.last_long_signal_bar_close_ms)
        : null,
    last_long_trigger:
      typeof state.last_long_trigger === "string" && state.last_long_trigger
        ? state.last_long_trigger
        : null,
    last_short_signal_bar_close_ms:
      Number.isFinite(Number(state.last_short_signal_bar_close_ms))
        ? Number(state.last_short_signal_bar_close_ms)
        : null,
    last_short_trigger:
      typeof state.last_short_trigger === "string" && state.last_short_trigger
        ? state.last_short_trigger
        : null,
    updated_at: new Date().toISOString(),
  };
  try {
    await getFirestore().collection(COLLECTION).doc(id).set(payload, { merge: true });
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = {
  COLLECTION,
  buildCooldownDocId,
  getV2ServerEntryCooldownState,
  setV2ServerEntryCooldownState,
};
