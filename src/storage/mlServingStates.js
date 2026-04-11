"use strict";

const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function servingStateDocId(exchange = null) {
  return `ML_SERVING_STATE__${upper(exchange) || "ALL"}`;
}

async function recordMlServingState({
  exchange = null,
  generatedAt = null,
  state = null,
  source = null,
  artifacts = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    serving_state_id: servingStateDocId(exchange),
    exchange: upper(exchange),
    created_at: nowIso(),
    generated_at: generatedAt || nowIso(),
    source: String(source || "ML_OPS_PIPELINE").trim() || "ML_OPS_PIPELINE",
    state: state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null,
    artifacts: artifacts && typeof artifacts === "object" ? JSON.parse(JSON.stringify(artifacts)) : null,
  };
  await db.collection("ml_serving_states").doc(doc.serving_state_id).set(doc, { merge: true });
  return doc;
}

async function getMlServingState({ exchange = null } = {}) {
  const db = getFirestore();
  const snap = await db.collection("ml_serving_states").doc(servingStateDocId(exchange)).get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

module.exports = {
  recordMlServingState,
  getMlServingState,
  __test: {
    servingStateDocId,
  },
};
