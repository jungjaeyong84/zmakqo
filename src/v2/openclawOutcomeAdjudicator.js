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

function cloneJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildTimingMeasurement({ criteria = null, evidence = null } = {}) {
  const row = asObject(evidence) || {};
  const crit = asObject(criteria) || {};
  const triggerGate = asObject(crit.trigger_gate) || {};
  const entryGrade = upper(row.entry_grade || crit.entry_grade) || "NONE";
  const triggerType = upper(row.trigger_type || crit.trigger_type || triggerGate.trigger_type) || "NONE";
  const triggerConfirmed = row.trigger_confirmed === true || triggerGate.trigger_confirmed === true;
  const explicitBucket = upper(row.timing_bucket || row.febt_bucket || row.febt_phase);
  const timingBucket = explicitBucket
    || (triggerConfirmed && entryGrade !== "NONE" ? "FIRE" : "VOID");
  return Object.freeze({
    source: "V2_SIGNAL_CRITERIA_TIMING_MEASUREMENT",
    timing_bucket: timingBucket,
    entry_grade: entryGrade,
    trigger_type: triggerType,
    trigger_confirmed: triggerConfirmed,
    signal_score: toNumberOrNull(row.signal_score ?? crit.signal_score),
  });
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

function buildDefaultOutcomeEvidence({
  bundle = null,
  positionCycle = null,
  executedEntry = null,
  evidence = null,
} = {}) {
  const seed = cloneJson(evidence) || {};
  const decision = asObject(asObject(bundle) && bundle.openclawDecision);
  const signal = asObject(asObject(bundle) && bundle.signalIntent);
  const criteria = asObject(asObject(bundle) && bundle.signalCriteria);
  const cycle = asObject(positionCycle) || asObject(asObject(executedEntry) && executedEntry.positionCycle);
  if (!seed.symbol && signal && signal.symbol) seed.symbol = signal.symbol;
  if (!seed.side && signal && signal.side) seed.side = signal.side;
  if (!seed.position_cycle_id && cycle && cycle.position_cycle_id) seed.position_cycle_id = cycle.position_cycle_id;
  if (!seed.openclaw_decision_bundle_hash && bundle && bundle.openclawDecisionBundleHash) {
    seed.openclaw_decision_bundle_hash = bundle.openclawDecisionBundleHash;
  }
  if (!seed.openclaw_decision_id && decision && decision.openclaw_decision_id) {
    seed.openclaw_decision_id = decision.openclaw_decision_id;
  }
  if (!seed.signal_criteria && criteria) {
    seed.signal_criteria = cloneJson(criteria);
  }
  if (!seed.signal_regime_profile && criteria && criteria.regime_profile) {
    seed.signal_regime_profile = cloneJson(criteria.regime_profile);
  }
  if (!seed.expected_edge_model && criteria && criteria.expected_edge_model) {
    seed.expected_edge_model = cloneJson(criteria.expected_edge_model);
  }
  if (!seed.setup_type && criteria && criteria.setup_gate) {
    seed.setup_type = trimOrNull(criteria.setup_gate.setup_type);
  }
  if (!seed.entry_grade && criteria && criteria.entry_grade) seed.entry_grade = criteria.entry_grade;
  if (!seed.trigger_type && criteria && criteria.trigger_type) seed.trigger_type = criteria.trigger_type;
  if (!seed.signal_criteria_profile && criteria && criteria.criteria_profile) seed.signal_criteria_profile = criteria.criteria_profile;
  if (seed.signal_score === undefined && criteria && criteria.signal_score !== undefined) seed.signal_score = criteria.signal_score;
  if (!seed.timing_measurement) {
    seed.timing_measurement = buildTimingMeasurement({ criteria, evidence: seed });
  }
  return seed;
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
  if (event === "TP1_FULL_EXIT" || event === "TP1_REACHED" || event === "TRAIL_HIT" || (Number.isFinite(pnl) && pnl > 0)) {
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
    evidence: buildDefaultOutcomeEvidence({ bundle, positionCycle, executedEntry, evidence }),
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
    cloneJson,
    toNumberOrNull,
    extractIds,
    buildDefaultOutcomeEvidence,
    buildTimingMeasurement,
  },
};
