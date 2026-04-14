"use strict";

const { evaluateOpenClawExecutionDecision } = require("./openclawExecutionExecutor");
const { evaluateLiveEntryPolicy } = require("../utils/liveExecutionPolicy");
const { evaluateEntryBudgetGuard } = require("../utils/entryBudgetGuard");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mergeAuthorityFeatures({
  baseFeatures = null,
  openclawEval = null,
  policyEval = null,
  entryBudgetGuard = null,
  stage = null,
  qtyRequested = null,
} = {}) {
  const base = (baseFeatures && typeof baseFeatures === "object") ? { ...baseFeatures } : {};
  const openclawPatch = (openclawEval && openclawEval.featuresPatch && typeof openclawEval.featuresPatch === "object")
    ? openclawEval.featuresPatch
    : {};
  const policyPatch = (policyEval && policyEval.featuresPatch && typeof policyEval.featuresPatch === "object")
    ? policyEval.featuresPatch
    : {};
  const openclawQty = toNum(openclawEval && openclawEval.qtyPctFinal);
  const finalQty = toNum(policyEval && policyEval.qtyPctFinal);
  const openclawReason = upper(openclawEval && openclawEval.reason) || null;
  const policyReason = upper(policyEval && policyEval.reason) || null;
  const entryBudgetReason = upper(entryBudgetGuard && entryBudgetGuard.reason) || null;
  const blockingLayer = openclawEval && openclawEval.ok !== true
    ? "OPENCLAW_EXECUTOR"
    : (policyEval && policyEval.ok !== true
      ? "LIVE_ENTRY_POLICY"
      : (entryBudgetGuard && entryBudgetGuard.ok !== true ? "ENTRY_BUDGET_GUARD" : "NONE"));
  const finalReason = blockingLayer === "OPENCLAW_EXECUTOR"
    ? (openclawReason || "OPENCLAW_EXECUTOR_BLOCK")
    : (blockingLayer === "LIVE_ENTRY_POLICY"
      ? (policyReason || openclawReason || "LIVE_POLICY_BLOCK")
      : (entryBudgetReason || policyReason || openclawReason || "OPENCLAW_EXECUTION_AUTHORITY_OK"));
  return {
    ...base,
    ...openclawPatch,
    ...policyPatch,
    _openclaw_authority_enabled: true,
    _openclaw_authority_stage: upper(stage),
    _openclaw_authority_final_decider: "OPENCLAW_EXECUTION_AUTHORITY",
    _openclaw_authority_blocking_layer: blockingLayer,
    _openclaw_authority_reason: finalReason,
    _openclaw_authority_openclaw_reason: openclawReason,
    _openclaw_authority_live_policy_reason: policyReason,
    _openclaw_authority_entry_budget_guard_reason: entryBudgetReason,
    _openclaw_authority_qty_requested: toNum(qtyRequested),
    _openclaw_authority_qty_after_openclaw: openclawQty,
    _openclaw_authority_qty_final: finalQty,
    _openclaw_authority_openclaw_ok: openclawEval ? openclawEval.ok === true : null,
    _openclaw_authority_live_policy_ok: policyEval ? policyEval.ok === true : null,
    _openclaw_authority_entry_budget_guard_ok: entryBudgetGuard ? entryBudgetGuard.ok === true : null,
    _openclaw_authority_entry_budget_guard_active: entryBudgetGuard ? entryBudgetGuard.applicable === true : null,
    _openclaw_authority_entry_budget_guard_notional_quote: toNum(entryBudgetGuard && entryBudgetGuard.notionalQuote),
    _openclaw_authority_entry_budget_guard_min_required_quote: toNum(entryBudgetGuard && entryBudgetGuard.minRequiredQuote),
    _openclaw_authority_entry_budget_guard_budget_max: toNum(entryBudgetGuard && entryBudgetGuard.budgetMax),
    _openclaw_authority_entry_budget_guard_leverage: toNum(entryBudgetGuard && entryBudgetGuard.leverage),
    _openclaw_authority_entry_budget_guard_required_qty_pct: toNum(entryBudgetGuard && entryBudgetGuard.requiredQtyPct),
    _openclaw_authority_entry_budget_guard_required_budget: toNum(entryBudgetGuard && entryBudgetGuard.requiredBudget),
    _openclaw_authority_entry_budget_guard_shortfall_quote: toNum(entryBudgetGuard && entryBudgetGuard.shortfallQuote),
  };
}

async function evaluateOpenClawExecutionAuthority({
  exchange = null,
  symbol = null,
  intent = null,
  event = null,
  side = null,
  qtyPct = null,
  features = null,
  stage = "UNKNOWN",
  applyScale = true,
  nowMs = Date.now(),
  signalTf = null,
  cohort = null,
  positionViews = null,
  recentTimelineRows = null,
  capitalAllocatorSnapshot = null,
  snapshotOverride = null,
  failOpenOnExecutorError = true,
  entryBudgetGuardOverride = null,
} = {}) {
  const qtyRequested = toNum(qtyPct);
  const baseFeatures = (features && typeof features === "object") ? { ...features } : {};

  let openclawEval;
  try {
    openclawEval = await evaluateOpenClawExecutionDecision({
      exchange,
      symbol,
      intent,
      event,
      side,
      qtyPct,
      features: baseFeatures,
      stage,
      applyScale,
      nowMs,
      signalTf,
      cohort,
      positionViews,
      recentTimelineRows,
      capitalAllocatorSnapshot,
    });
  } catch (err) {
    if (failOpenOnExecutorError !== true) throw err;
    const msg = err && err.message ? String(err.message) : String(err);
    openclawEval = {
      ok: true,
      reason: "OPENCLAW_EXECUTOR_FAIL_OPEN",
      qtyPctFinal: qtyRequested,
      scaleApplied: 1,
      exitProfileMode: null,
      decision: {
        enabled: true,
        executor_error: msg,
        fail_open: true,
        stage: upper(stage),
      },
      featuresPatch: {
        ...baseFeatures,
        _openclaw_executor_reason: "OPENCLAW_EXECUTOR_FAIL_OPEN",
        _openclaw_executor_error: msg,
      },
    };
  }

  const openclawQty = toNum(openclawEval && openclawEval.qtyPctFinal);
  if (!openclawEval || openclawEval.ok !== true || !Number.isFinite(openclawQty) || openclawQty <= 0) {
    const featuresPatch = mergeAuthorityFeatures({
      baseFeatures,
      openclawEval,
      policyEval: null,
      entryBudgetGuard: null,
      stage,
      qtyRequested,
    });
    return {
      ok: false,
      reason: upper(openclawEval && openclawEval.reason) || "OPENCLAW_EXECUTOR_BLOCK",
      qtyPctFinal: 0,
      exitProfileMode: openclawEval && openclawEval.exitProfileMode ? String(openclawEval.exitProfileMode).toUpperCase() : null,
      featuresPatch,
      decision: openclawEval && openclawEval.decision ? openclawEval.decision : null,
      policy: null,
      authority: {
        stage: upper(stage),
        requestedQtyPct: qtyRequested,
        finalQtyPct: 0,
        blockingLayer: "OPENCLAW_EXECUTOR",
        openclaw: openclawEval || null,
        livePolicy: null,
      },
    };
  }

  const policyEval = evaluateLiveEntryPolicy({
    exchange,
    symbol,
    intent,
    qtyPct: openclawQty,
    features: openclawEval && openclawEval.featuresPatch && typeof openclawEval.featuresPatch === "object"
      ? openclawEval.featuresPatch
      : baseFeatures,
    stage,
    applyScale,
    snapshotOverride,
  });
  const finalQty = toNum(policyEval && policyEval.qtyPctFinal);
  const featuresPatch = mergeAuthorityFeatures({
    baseFeatures,
    openclawEval,
    policyEval,
    entryBudgetGuard: null,
    stage,
    qtyRequested,
  });

  if (!policyEval || policyEval.ok !== true || !Number.isFinite(finalQty) || finalQty <= 0) {
    return {
      ok: false,
      reason: upper(policyEval && policyEval.reason) || "LIVE_POLICY_BLOCK",
      qtyPctFinal: 0,
      exitProfileMode: openclawEval && openclawEval.exitProfileMode ? String(openclawEval.exitProfileMode).toUpperCase() : null,
      featuresPatch,
      decision: openclawEval && openclawEval.decision ? openclawEval.decision : null,
      policy: policyEval && policyEval.policy ? policyEval.policy : null,
      authority: {
        stage: upper(stage),
        requestedQtyPct: qtyRequested,
        finalQtyPct: 0,
        blockingLayer: "LIVE_ENTRY_POLICY",
        openclaw: openclawEval || null,
        livePolicy: policyEval || null,
      },
    };
  }

  const entryBudgetGuard = entryBudgetGuardOverride || await evaluateEntryBudgetGuard({
    exchange,
    symbol,
    intent,
    qtyPct: finalQty,
  });
  const guardedFeaturesPatch = mergeAuthorityFeatures({
    baseFeatures,
    openclawEval,
    policyEval,
    entryBudgetGuard,
    stage,
    qtyRequested,
  });

  if (entryBudgetGuard && entryBudgetGuard.applicable === true && entryBudgetGuard.ok !== true) {
    return {
      ok: false,
      reason: upper(entryBudgetGuard.reason) || "MIN_ORDER_EXCEEDS_BUDGET",
      qtyPctFinal: 0,
      exitProfileMode: openclawEval && openclawEval.exitProfileMode ? String(openclawEval.exitProfileMode).toUpperCase() : null,
      featuresPatch: guardedFeaturesPatch,
      decision: openclawEval && openclawEval.decision ? openclawEval.decision : null,
      policy: policyEval && policyEval.policy ? policyEval.policy : null,
      authority: {
        stage: upper(stage),
        requestedQtyPct: qtyRequested,
        finalQtyPct: 0,
        blockingLayer: "ENTRY_BUDGET_GUARD",
        openclaw: openclawEval || null,
        livePolicy: policyEval || null,
        entryBudgetGuard,
      },
    };
  }

  return {
    ok: true,
    reason: upper(policyEval && policyEval.reason) || upper(openclawEval && openclawEval.reason) || "OPENCLAW_EXECUTION_AUTHORITY_OK",
    qtyPctFinal: finalQty,
    exitProfileMode: openclawEval && openclawEval.exitProfileMode ? String(openclawEval.exitProfileMode).toUpperCase() : null,
    featuresPatch: guardedFeaturesPatch,
    decision: openclawEval && openclawEval.decision ? openclawEval.decision : null,
    policy: policyEval && policyEval.policy ? policyEval.policy : null,
    authority: {
      stage: upper(stage),
      requestedQtyPct: qtyRequested,
      finalQtyPct: finalQty,
      blockingLayer: "NONE",
      openclaw: openclawEval || null,
      livePolicy: policyEval || null,
      entryBudgetGuard,
    },
  };
}

module.exports = {
  evaluateOpenClawExecutionAuthority,
  __test: {
    mergeAuthorityFeatures,
  },
};
