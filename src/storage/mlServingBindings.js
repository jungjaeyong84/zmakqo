"use strict";

const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function normalizeArtifactId(value) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function bindingDocId({ exchange = null, artifactId = null } = {}) {
  const artifact = normalizeArtifactId(artifactId);
  if (artifact) return `ML_SERVING_BINDING__ARTIFACT__${artifact}`;
  return `ML_SERVING_BINDING__EXCHANGE__${upper(exchange) || "ALL"}`;
}

async function recordMlServingBinding({
  exchange = null,
  artifactId = null,
  binding = null,
  source = null,
  generatedAt = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    binding_id: bindingDocId({ exchange, artifactId }),
    exchange: upper(exchange),
    artifact_id: normalizeArtifactId(artifactId),
    source: String(source || "").trim().toUpperCase() || null,
    generated_at: generatedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    binding: binding && typeof binding === "object" ? JSON.parse(JSON.stringify(binding)) : null,
  };
  await db.collection("ml_serving_bindings").doc(doc.binding_id).set(doc, { merge: true });
  return doc;
}

async function getMlServingBinding({
  exchange = null,
  artifactId = null,
} = {}) {
  const db = getFirestore();
  const artifact = normalizeArtifactId(artifactId);
  if (artifact) {
    const snap = await db.collection("ml_serving_bindings").doc(bindingDocId({ artifactId: artifact })).get();
    if (snap.exists) return snap.data() || null;
  }
  const exchangeSnap = await db.collection("ml_serving_bindings").doc(bindingDocId({ exchange })).get();
  return exchangeSnap.exists ? (exchangeSnap.data() || null) : null;
}

module.exports = {
  recordMlServingBinding,
  getMlServingBinding,
  __test: {
    bindingDocId,
  },
};
