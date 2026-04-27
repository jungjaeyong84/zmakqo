"use strict";

const { buildV2EntryBootstrap } = require("./entryBootstrap");
const {
  V2_DECISION_MODES,
  V2_SIGNAL_SOURCE_MODES,
} = require("./constants");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function validateExecutableEntryIntent(entryIntent) {
  const intent = entryIntent && typeof entryIntent === "object" ? entryIntent : null;
  if (!intent) throw new Error("ENTRY_INTENT_REQUIRED");

  const entryIntentId = trimOrNull(intent.entry_intent_id);
  const signalIntentId = trimOrNull(intent.signal_intent_id);
  const openclawDecisionId = trimOrNull(intent.openclaw_decision_id);
  const signalSourceMode = upper(intent.signal_source_mode);
  const symbol = upper(intent.symbol);
  const side = upper(intent.side);
  const decisionMode = upper(intent.decision_mode);
  const policyScope = trimOrNull(intent.policy_scope);

  if (!entryIntentId) throw new Error("ENTRY_INTENT_ID_REQUIRED");
  if (!signalIntentId) throw new Error("SIGNAL_INTENT_ID_REQUIRED");
  if (!openclawDecisionId) throw new Error("OPENCLAW_DECISION_ID_REQUIRED");
  if (!signalSourceMode) throw new Error("SIGNAL_SOURCE_MODE_REQUIRED");
  if (!V2_SIGNAL_SOURCE_MODES.includes(signalSourceMode)) throw new Error("SIGNAL_SOURCE_MODE_INVALID");
  if (!symbol) throw new Error("SYMBOL_REQUIRED");
  if (side !== "LONG" && side !== "SHORT") throw new Error("POSITION_SIDE_REQUIRED");
  if (!decisionMode) throw new Error("DECISION_MODE_REQUIRED");
  if (!V2_DECISION_MODES.includes(decisionMode)) throw new Error("DECISION_MODE_INVALID");
  if (!["CANARY", "LIVE"].includes(decisionMode)) {
    throw new Error("ENTRY_INTENT_DECISION_MODE_NOT_EXECUTABLE");
  }
  if (!policyScope) throw new Error("POLICY_SCOPE_REQUIRED");

  return Object.freeze({
    entry_intent_id: entryIntentId,
    signal_intent_id: signalIntentId,
    openclaw_decision_id: openclawDecisionId,
    signal_source_mode: signalSourceMode,
    symbol,
    side,
    decision_mode: decisionMode,
    policy_scope: policyScope,
    quality_score: Number(intent.quality_score),
  });
}

function buildV2ExecutedEntryFromIntent({
  entryIntent,
  exchange = "BINANCEFUT",
  entryEventId,
  entryOrderId,
  entryFillGroupId,
  entryPrice,
  entryQtyAbs,
  stopLossPct = 0.0165,
  tp1TargetPct = 0.0168,
  tp1QtyRatio = 0.5,
  leverage = null,
  protectionLeverageNormalize = undefined,
} = {}) {
  const intent = validateExecutableEntryIntent(entryIntent);
  const bootstrap = buildV2EntryBootstrap({
    exchange,
    symbol: intent.symbol,
    entryEventId,
    entryOrderId,
    entryFillGroupId,
    entryIntentId: intent.entry_intent_id,
    signalIntentId: intent.signal_intent_id,
    openclawDecisionId: intent.openclaw_decision_id,
    positionSide: intent.side,
    entryPrice,
    entryQtyAbs,
    stopLossPct,
    tp1TargetPct,
    tp1QtyRatio,
    leverage,
    ...(protectionLeverageNormalize !== undefined ? { protectionLeverageNormalize } : {}),
  });
  return Object.freeze({
    entryContract: intent,
    ...bootstrap,
  });
}

module.exports = {
  validateExecutableEntryIntent,
  buildV2ExecutedEntryFromIntent,
  __test: {
    trimOrNull,
    upper,
    validateExecutableEntryIntent,
  },
};
