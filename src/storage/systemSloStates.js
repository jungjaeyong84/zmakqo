"use strict";

const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function sloStateDocId(exchange = null) {
  return `SYSTEM_SLO_STATE__${upper(exchange) || "ALL"}`;
}

async function recordSystemSloState({
  exchange = null,
  generatedAt = null,
  state = null,
  source = null,
  artifacts = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    slo_state_id: sloStateDocId(exchange),
    exchange: upper(exchange),
    created_at: new Date().toISOString(),
    generated_at: generatedAt || new Date().toISOString(),
    source: String(source || "SYSTEM_RUNTIME_GUARDS").trim().toUpperCase() || "SYSTEM_RUNTIME_GUARDS",
    state: state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null,
    artifacts: artifacts && typeof artifacts === "object" ? JSON.parse(JSON.stringify(artifacts)) : null,
  };
  await db.collection("system_slo_states").doc(doc.slo_state_id).set(doc, { merge: true });
  return doc;
}

async function getSystemSloState({ exchange = null } = {}) {
  const db = getFirestore();
  const snap = await db.collection("system_slo_states").doc(sloStateDocId(exchange)).get();
  return snap.exists ? (snap.data() || null) : null;
}

module.exports = {
  recordSystemSloState,
  getSystemSloState,
  __test: {
    sloStateDocId,
  },
};
