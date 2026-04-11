"use strict";

const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function gateDocId(exchange = null) {
  return `SHADOW_CANARY_GATE__${upper(exchange) || "ALL"}`;
}

async function recordShadowCanaryGate({
  exchange = null,
  generatedAt = null,
  window = null,
  summary = null,
  gate = null,
  sample = null,
  artifacts = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    gate_id: gateDocId(exchange),
    exchange: upper(exchange),
    created_at: nowIso(),
    generated_at: generatedAt || nowIso(),
    window: window && typeof window === "object" ? JSON.parse(JSON.stringify(window)) : null,
    summary: summary && typeof summary === "object" ? JSON.parse(JSON.stringify(summary)) : null,
    gate: gate && typeof gate === "object" ? JSON.parse(JSON.stringify(gate)) : null,
    sample: Array.isArray(sample) ? JSON.parse(JSON.stringify(sample.slice(0, 50))) : [],
    artifacts: artifacts && typeof artifacts === "object" ? JSON.parse(JSON.stringify(artifacts)) : null,
  };
  await db.collection("shadow_canary_gates").doc(doc.gate_id).set(doc, { merge: true });
  return doc;
}

async function getShadowCanaryGate({ exchange = null } = {}) {
  const db = getFirestore();
  const snap = await db.collection("shadow_canary_gates").doc(gateDocId(exchange)).get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

module.exports = {
  recordShadowCanaryGate,
  getShadowCanaryGate,
  __test: {
    gateDocId,
  },
};
