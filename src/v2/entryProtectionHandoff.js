"use strict";

const { V2_SERVICES } = require("./constants");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function validateRequiredString(name, value) {
  const text = trimOrNull(value);
  if (!text) throw new Error(`${name}_REQUIRED`);
  return text;
}

function validateEntryProtectionInputs({ entryContract, positionCycle, protectionPlan } = {}) {
  const contract = entryContract && typeof entryContract === "object" ? entryContract : null;
  const cycle = positionCycle && typeof positionCycle === "object" ? positionCycle : null;
  const plan = protectionPlan && typeof protectionPlan === "object" ? protectionPlan : null;
  if (!contract) throw new Error("ENTRY_CONTRACT_REQUIRED");
  if (!cycle) throw new Error("POSITION_CYCLE_REQUIRED");
  if (!plan) throw new Error("PROTECTION_PLAN_REQUIRED");
  return Object.freeze({
    entryContract: contract,
    positionCycle: cycle,
    protectionPlan: plan,
  });
}

function buildEntryProtectionPlacementRequest({
  entryContract,
  positionCycle,
  protectionPlan,
  requestedByService = V2_SERVICES.ENTRY_EXECUTOR,
} = {}) {
  const input = validateEntryProtectionInputs({
    entryContract,
    positionCycle,
    protectionPlan,
  });
  const cycle = input.positionCycle;
  const plan = input.protectionPlan;
  return Object.freeze({
    requested_by_service: validateRequiredString("requested_by_service", upper(requestedByService)),
    position_cycle_id: validateRequiredString("position_cycle_id", cycle.position_cycle_id),
    entry_event_id: validateRequiredString("entry_event_id", cycle.entry_event_id),
    entry_order_id: validateRequiredString("entry_order_id", cycle.entry_order_id),
    entry_fill_group_id: validateRequiredString("entry_fill_group_id", cycle.entry_fill_group_id),
    entry_intent_id: validateRequiredString("entry_intent_id", cycle.entry_intent_id || input.entryContract.entry_intent_id),
    signal_intent_id: validateRequiredString("signal_intent_id", cycle.signal_intent_id || input.entryContract.signal_intent_id),
    openclaw_decision_id: validateRequiredString("openclaw_decision_id", cycle.openclaw_decision_id || input.entryContract.openclaw_decision_id),
    signal_source_mode: validateRequiredString("signal_source_mode", upper(input.entryContract.signal_source_mode)),
    decision_mode: validateRequiredString("decision_mode", upper(input.entryContract.decision_mode)),
    policy_scope: validateRequiredString("policy_scope", input.entryContract.policy_scope),
    exchange: validateRequiredString("exchange", upper(cycle.exchange || plan.exchange)),
    symbol: validateRequiredString("symbol", upper(cycle.symbol || plan.symbol)),
    position_side: validateRequiredString("position_side", upper(cycle.position_side || plan.position_side)),
    close_side: validateRequiredString("close_side", upper(plan.close_side)),
    entry_price: toNumberOrNull(cycle.entry_price != null ? cycle.entry_price : plan.entry_price),
    entry_qty_abs: toNumberOrNull(cycle.entry_qty_abs != null ? cycle.entry_qty_abs : plan.entry_qty_abs),
    sl_trigger_price: toNumberOrNull(plan.sl_trigger_price),
    tp1_trigger_price: toNumberOrNull(plan.tp1_trigger_price),
    tp1_qty_abs: toNumberOrNull(plan.tp1_qty_abs),
    runner_remaining_qty_abs: toNumberOrNull(plan.runner_remaining_qty_abs),
  });
}

module.exports = {
  buildEntryProtectionPlacementRequest,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    validateRequiredString,
    validateEntryProtectionInputs,
  },
};
