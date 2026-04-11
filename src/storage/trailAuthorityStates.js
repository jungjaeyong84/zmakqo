"use strict";

const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function trailAuthorityStateDocId(exchange = null, symbol = null) {
  return `TRAIL_AUTHORITY_STATE__${upper(exchange) || "ALL"}__${upper(symbol) || "ALL"}`;
}

async function recordTrailAuthorityState({
  exchange = null,
  symbol = null,
  generatedAt = null,
  state = null,
  source = null,
  artifacts = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    trail_authority_state_id: trailAuthorityStateDocId(exchange, symbol),
    exchange: upper(exchange),
    symbol: upper(symbol),
    generated_at: generatedAt || new Date().toISOString(),
    source: String(source || "BINANCE_TICK_EXIT").trim().toUpperCase() || "BINANCE_TICK_EXIT",
    state: state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null,
    artifacts: artifacts && typeof artifacts === "object" ? JSON.parse(JSON.stringify(artifacts)) : null,
    updated_at: new Date().toISOString(),
  };
  await db.collection("trail_authority_states").doc(doc.trail_authority_state_id).set(doc, { merge: true });
  return doc;
}

async function getTrailAuthorityState({ exchange = null, symbol = null } = {}) {
  const db = getFirestore();
  const snap = await db.collection("trail_authority_states").doc(trailAuthorityStateDocId(exchange, symbol)).get();
  return snap.exists ? (snap.data() || null) : null;
}

module.exports = {
  recordTrailAuthorityState,
  getTrailAuthorityState,
  __test: {
    trailAuthorityStateDocId,
  },
};
