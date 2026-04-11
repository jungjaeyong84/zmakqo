"use strict";

const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function remediationStateDocId(exchange = null) {
  return `SYSTEM_ANOMALY_REMEDIATION_STATE__${upper(exchange) || "ALL"}`;
}

async function recordSystemAnomalyRemediationState({
  exchange = null,
  generatedAt = null,
  remediation = null,
  source = null,
  artifacts = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    anomaly_remediation_state_id: remediationStateDocId(exchange),
    exchange: upper(exchange),
    created_at: new Date().toISOString(),
    generated_at: generatedAt || new Date().toISOString(),
    source: String(source || "SYSTEM_RUNTIME_GUARDS").trim().toUpperCase() || "SYSTEM_RUNTIME_GUARDS",
    remediation: remediation && typeof remediation === "object" ? JSON.parse(JSON.stringify(remediation)) : null,
    artifacts: artifacts && typeof artifacts === "object" ? JSON.parse(JSON.stringify(artifacts)) : null,
  };
  await db.collection("system_anomaly_remediation_states").doc(doc.anomaly_remediation_state_id).set(doc, { merge: true });
  return doc;
}

async function getSystemAnomalyRemediationState({ exchange = null } = {}) {
  const db = getFirestore();
  const snap = await db.collection("system_anomaly_remediation_states").doc(remediationStateDocId(exchange)).get();
  return snap.exists ? (snap.data() || null) : null;
}

module.exports = {
  recordSystemAnomalyRemediationState,
  getSystemAnomalyRemediationState,
  __test: {
    remediationStateDocId,
  },
};
