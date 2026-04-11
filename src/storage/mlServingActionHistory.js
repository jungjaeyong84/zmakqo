"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toTimeMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildActionHistoryId({
  exchange = null,
  action = null,
  generatedAt = null,
  activeArtifactId = null,
} = {}) {
  const base = [
    upper(exchange) || "ALL",
    upper(action) || "HOLD",
    toTimeMs(generatedAt) || Date.now(),
    String(activeArtifactId || "").trim() || "NONE",
  ].join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

async function recordMlServingActionHistory({
  exchange = null,
  generatedAt = null,
  action = null,
  payload = null,
} = {}) {
  const db = getFirestore();
  const item = payload && typeof payload === "object" ? JSON.parse(JSON.stringify(payload)) : null;
  const doc = {
    ml_serving_action_id: buildActionHistoryId({
      exchange,
      action,
      generatedAt,
      activeArtifactId: item && item.active_model_artifact_id,
    }),
    exchange: upper(exchange),
    created_at: new Date().toISOString(),
    generated_at: generatedAt || new Date().toISOString(),
    action: upper(action),
    payload: item,
  };
  await db.collection("ml_serving_action_history").doc(doc.ml_serving_action_id).set(doc, { merge: false });
  return doc;
}

async function listRecentMlServingActions({
  exchange = null,
  limit = 20,
} = {}) {
  const db = getFirestore();
  const ex = upper(exchange);
  try {
    const snap = await db.collection("ml_serving_action_history")
      .where("exchange", "==", ex)
      .orderBy("generated_at", "desc")
      .limit(Math.max(1, Math.trunc(Number(limit) || 20)))
      .get();
    return snap.docs.map((doc) => doc.data() || {});
  } catch (_) {
    const snap = await db.collection("ml_serving_action_history").get();
    return snap.docs
      .map((doc) => doc.data() || {})
      .filter((row) => upper(row.exchange) === ex)
      .sort((a, b) => Number(toTimeMs(b.generated_at) || 0) - Number(toTimeMs(a.generated_at) || 0))
      .slice(0, Math.max(1, Math.trunc(Number(limit) || 20)));
  }
}

module.exports = {
  recordMlServingActionHistory,
  listRecentMlServingActions,
  __test: {
    buildActionHistoryId,
  },
};
