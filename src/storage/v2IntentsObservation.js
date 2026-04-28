"use strict";

// 2026-04-28 V2 frontend migration audit Step B — V2 signal intent
// observation helper.
//
// State page (`/dashboard/trading`) currently reads `order_intents_paper`
// directly (28 V1 refs in state.routes.js). Under V2 cutover the V1
// paper engine is disabled (DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1),
// so V2 entries write only to `${prefix}signal_intents_v2` and the
// state page would show 0 intents. As a minimal observability bridge
// we surface V2 signal-intent counts on the state page so operators
// can see V2 traffic flow even before the full V1→V2 read migration
// lands.
//
// This is observation-only: never blocks/throws, returns zeros on any
// failure (including missing collection).

const { getFirestore } = require("./firestore");

const DEFAULT_V2_COLLECTION_PREFIX = "donbeolja_v2__";

function resolveCollectionPrefix(env = process.env) {
  const raw = (env && env.DONBEOLJA_V2_COLLECTION_PREFIX) || "";
  const trimmed = String(raw).trim();
  return trimmed.length ? trimmed : DEFAULT_V2_COLLECTION_PREFIX;
}

function resolveSignalIntentsCollectionName(env = process.env) {
  return `${resolveCollectionPrefix(env)}signal_intents_v2`;
}

// Best-effort fetch — returns { ok, count, recent_n, latest_at_ms,
// error } even on failure so the caller can include the result in a
// dashboard payload without try/catch noise.
async function observeRecentV2SignalIntents({
  exchange = "BINANCEFUT",
  symbol = null,
  limit = 200,
  recentWindowMs = 24 * 60 * 60 * 1000,
  env = process.env,
  db = null,
} = {}) {
  const collectionName = resolveSignalIntentsCollectionName(env);
  const out = {
    ok: true,
    collection_name: collectionName,
    count: 0,
    recent_n: 0,
    latest_at_ms: null,
    error: null,
  };
  try {
    const firestore = db || getFirestore();
    if (!firestore || typeof firestore.collection !== "function") {
      out.ok = false;
      out.error = "FIRESTORE_UNAVAILABLE";
      return out;
    }
    const exchangeUpper = String(exchange || "").trim().toUpperCase();
    const symbolUpper = String(symbol || "").trim().toUpperCase();

    let query = firestore.collection(collectionName);
    if (exchangeUpper) query = query.where("exchange", "==", exchangeUpper);
    if (symbolUpper) query = query.where("symbol", "==", symbolUpper);
    query = query.orderBy("created_at", "desc").limit(Math.max(1, Math.floor(limit)));

    const snap = await query.get();
    if (!snap || snap.empty) return out;

    out.count = snap.size;
    const cutoffMs = Date.now() - Math.max(0, Number(recentWindowMs) || 0);
    let latestMs = null;
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const created = data.created_at;
      const ms = created ? Date.parse(String(created)) : NaN;
      if (Number.isFinite(ms)) {
        if (latestMs === null || ms > latestMs) latestMs = ms;
        if (ms >= cutoffMs) out.recent_n += 1;
      }
    });
    out.latest_at_ms = latestMs;
    return out;
  } catch (err) {
    out.ok = false;
    out.error = (err && err.message) ? err.message : String(err);
    return out;
  }
}

module.exports = {
  resolveCollectionPrefix,
  resolveSignalIntentsCollectionName,
  observeRecentV2SignalIntents,
};
