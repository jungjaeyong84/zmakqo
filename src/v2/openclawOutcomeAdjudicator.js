"use strict";

const { buildOpenClawOutcomeAdjudicationDoc } = require("./contracts");
const { putV2Doc } = require("./storage");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractIds({ bundle = null, positionCycle = null, executedEntry = null } = {}) {
  const decision = asObject(asObject(bundle) && bundle.openclawDecision);
  const signal = asObject(asObject(bundle) && bundle.signalIntent);
  const cycle = asObject(positionCycle) || asObject(asObject(executedEntry) && executedEntry.positionCycle);
  return Object.freeze({
    openclawDecisionId: trimOrNull(decision && decision.openclaw_decision_id),
    signalIntentId: trimOrNull(signal && signal.signal_intent_id),
    positionCycleId: trimOrNull(cycle && cycle.position_cycle_id),
  });
}

function classifyOutcome({
  realizedExitEvent = null,
  realizedPnl = null,
  executionOk = true,
  protectionOk = true,
  manualIntervention = false,
  modelApproved = true,
} = {}) {
  const event = upper(realizedExitEvent);
  const pnl = toNumberOrNull(realizedPnl);
  if (manualIntervention === true || event === "MANUAL_CLOSE_SYNC") {
    return Object.freeze({ label: "MANUAL_INTERVENTION", family: "OPERATOR" });
  }
  if (executionOk === false) {
    return Object.freeze({ label: "EXECUTION_ERROR", family: "SYSTEM" });
  }
  if (protectionOk === false) {
    return Object.freeze({ label: "PROTECTION_ERROR", family: "SYSTEM" });
  }
  if (event === "TP1_REACHED" || event === "TRAIL_HIT" || (Number.isFinite(pnl) && pnl > 0)) {
    return Object.freeze({ label: "MODEL_WIN", family: "MODEL" });
  }
  if (event === "SL_HIT" || (Number.isFinite(pnl) && pnl < 0)) {
    return Object.freeze({ label: modelApproved === true ? "MODEL_ERROR" : "EXPECTED_BLOCKED_LOSS", family: "MODEL" });
  }
  if (event === "EXTERNAL_CLOSE_SYNC") {
    return Object.freeze({ label: "EXTERNAL_SYNC", family: "OPERATOR" });
  }
  return Object.freeze({ label: "OUTCOME_UNKNOWN", family: "UNKNOWN" });
}

function adjudicateOpenClawOutcome({
  bundle = null,
  positionCycle = null,
  executedEntry = null,
  realizedExitEvent = null,
  realizedPnl = null,
  executionOk = true,
  protectionOk = true,
  manualIntervention = false,
  modelApproved = true,
  evidence = null,
  adjudicatedAt = null,
} = {}) {
  const ids = extractIds({ bundle, positionCycle, executedEntry });
  if (!ids.openclawDecisionId) throw new Error("OPENCLAW_DECISION_ID_REQUIRED");
  if (!ids.positionCycleId) throw new Error("POSITION_CYCLE_ID_REQUIRED");
  const classification = classifyOutcome({
    realizedExitEvent,
    realizedPnl,
    executionOk,
    protectionOk,
    manualIntervention,
    modelApproved,
  });
  return Object.freeze(buildOpenClawOutcomeAdjudicationDoc({
    openclawDecisionId: ids.openclawDecisionId,
    signalIntentId: ids.signalIntentId,
    positionCycleId: ids.positionCycleId,
    adjudicationLabel: classification.label,
    adjudicationFamily: classification.family,
    realizedExitEvent,
    realizedPnl,
    executionOk,
    protectionOk,
    modelOk: classification.label === "MODEL_WIN" || classification.label === "EXPECTED_BLOCKED_LOSS",
    evidence: evidence || {},
    adjudicatedAt,
  }));
}

async function persistOpenClawOutcomeAdjudication({
  adjudication,
  db = null,
  env = process.env,
  merge = true,
} = {}) {
  const doc = asObject(adjudication);
  if (!doc) throw new Error("OPENCLAW_OUTCOME_ADJUDICATION_REQUIRED");
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "OPENCLAW_OUTCOME_ADJUDICATIONS",
    doc,
    merge,
  });
  return Object.freeze({
    ok: true,
    reason: "OPENCLAW_OUTCOME_ADJUDICATION_LEDGER_WRITTEN",
    openclaw_outcome_adjudication_id: trimOrNull(doc.openclaw_outcome_adjudication_id),
    persisted,
  });
}

module.exports = {
  classifyOutcome,
  adjudicateOpenClawOutcome,
  persistOpenClawOutcomeAdjudication,
  __test: {
    trimOrNull,
    upper,
    asObject,
    toNumberOrNull,
    extractIds,
  },
};
