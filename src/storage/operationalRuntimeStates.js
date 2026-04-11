"use strict";

const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function runtimeStateDocId(exchange = null) {
  return `OPERATIONAL_RUNTIME_STATE__${upper(exchange) || "ALL"}`;
}

async function recordOperationalRuntimeState({
  exchange = null,
  generatedAt = null,
  state = null,
  source = null,
  artifacts = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    runtime_state_id: runtimeStateDocId(exchange),
    exchange: upper(exchange),
    generated_at: generatedAt || new Date().toISOString(),
    source: String(source || "").trim().toUpperCase() || null,
    state: state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null,
    artifacts: artifacts && typeof artifacts === "object" ? JSON.parse(JSON.stringify(artifacts)) : null,
    updated_at: new Date().toISOString(),
  };
  await db.collection("operational_runtime_states").doc(doc.runtime_state_id).set(doc, { merge: true });
  return doc;
}

async function getOperationalRuntimeState({ exchange = null } = {}) {
  const db = getFirestore();
  const snap = await db.collection("operational_runtime_states").doc(runtimeStateDocId(exchange)).get();
  return snap.exists ? (snap.data() || null) : null;
}

module.exports = {
  recordOperationalRuntimeState,
  getOperationalRuntimeState,
  __test: {
    runtimeStateDocId,
  },
};
