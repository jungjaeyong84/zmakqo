"use strict";

const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function anomalyStateDocId(exchange = null) {
  return `SYSTEM_ANOMALY_STATE__${upper(exchange) || "ALL"}`;
}

async function recordSystemAnomalyState({
  exchange = null,
  generatedAt = null,
  state = null,
  source = null,
  artifacts = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    anomaly_state_id: anomalyStateDocId(exchange),
    exchange: upper(exchange),
    created_at: new Date().toISOString(),
    generated_at: generatedAt || new Date().toISOString(),
    source: String(source || "SYSTEM_RUNTIME_GUARDS").trim().toUpperCase() || "SYSTEM_RUNTIME_GUARDS",
    state: state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null,
    artifacts: artifacts && typeof artifacts === "object" ? JSON.parse(JSON.stringify(artifacts)) : null,
  };
  await db.collection("system_anomaly_states").doc(doc.anomaly_state_id).set(doc, { merge: true });
  return doc;
}

async function getSystemAnomalyState({ exchange = null } = {}) {
  const db = getFirestore();
  const snap = await db.collection("system_anomaly_states").doc(anomalyStateDocId(exchange)).get();
  return snap.exists ? (snap.data() || null) : null;
}

module.exports = {
  recordSystemAnomalyState,
  getSystemAnomalyState,
  __test: {
    anomalyStateDocId,
  },
};
