"use strict";

const { getFirestore } = require("./firestore");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function feedbackStateDocId(exchange = null) {
  return `TRAIL_AUTHORITY_FEEDBACK_STATE__${upper(exchange) || "ALL"}`;
}

async function recordTrailAuthorityFeedbackState({
  exchange = null,
  generatedAt = null,
  state = null,
  source = null,
  artifacts = null,
} = {}) {
  const db = getFirestore();
  const doc = {
    feedback_state_id: feedbackStateDocId(exchange),
    exchange: upper(exchange),
    generated_at: generatedAt || new Date().toISOString(),
    source: String(source || "TRAIL_AUTHORITY_FEEDBACK").trim().toUpperCase() || "TRAIL_AUTHORITY_FEEDBACK",
    state: state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null,
    artifacts: artifacts && typeof artifacts === "object" ? JSON.parse(JSON.stringify(artifacts)) : null,
    updated_at: new Date().toISOString(),
  };
  await db.collection("trail_authority_feedback_states").doc(doc.feedback_state_id).set(doc, { merge: true });
  return doc;
}

async function getTrailAuthorityFeedbackState({ exchange = null } = {}) {
  const db = getFirestore();
  const snap = await db.collection("trail_authority_feedback_states").doc(feedbackStateDocId(exchange)).get();
  return snap.exists ? (snap.data() || null) : null;
}

module.exports = {
  recordTrailAuthorityFeedbackState,
  getTrailAuthorityFeedbackState,
  __test: {
    feedbackStateDocId,
  },
};
