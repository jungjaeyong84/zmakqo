"use strict";

const { evaluateOpenClawExecutionDecision } = require("./openclawExecutionExecutor");
const { evaluateLiveEntryPolicy } = require("../utils/liveExecutionPolicy");
const {
  evaluateEntryBudgetGuard,
  resolveEntryBudgetGuardFeasibleBand,
} = require("../utils/entryBudgetGuard");
const ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_DEFAULT_MARKETS = Object.freeze(["*"]);
const EPSILON = 1e-9;

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readMarketList(raw, fallback = []) {
  const text = String(raw || "").trim();
  if (!text) return fallback.slice();
  if (text === "*") return ["*"];
  return text
    .split(",")
    .map((item) => upper(item))
    .filter(Boolean);
}

function isEntryBudgetGuardMinQtyFloorEnabled(symbol) {
  const enabled = toBool(process.env.ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_ENABLED, true);
  if (!enabled) return false;
  const allowlist = readMarketList(
    process.env.ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_MARKETS,
    ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_DEFAULT_MARKETS
  );
  if (allowlist.includes("*")) return true;
  return allowlist.includes(upper(symbol));
}

function buildEntryBudgetGuardResultAtQty(entryBudgetGuard, qtyPct) {
  const base = (entryBudgetGuard && typeof entryBudgetGuard === "object") ? { ...entryBudgetGuard } : {};
  const budgetMax = toNum(base.budgetMax);
  const leverage = toNum(base.leverage);
  const minRequiredQuote = toNum(base.minRequiredQuote);
  const notionalQuote = (
    Number.isFinite(budgetMax) &&
    budgetMax > 0 &&
    Number.isFinite(leverage) &&
    leverage > 0 &&
    Number.isFinite(qtyPct) &&
    qtyPct > 0
  ) ? budgetMax * leverage * qtyPct : null;
  const ok = (
    Number.isFinite(minRequiredQuote) &&
    minRequiredQuote > 0 &&
    Number.isFinite(notionalQuote) &&
    notionalQuote + EPSILON >= minRequiredQuote
  );
  return {
    ...base,
    qtyPct,
    applicable: base.applicable !== false,
    ok,
    reason: ok ? "ENTRY_BUDGET_GUARD_OK" : (upper(base.reason) || "MIN_ORDER_EXCEEDS_BUDGET"),
    notionalQuote,
    requiredQtyPct: (
      Number.isFinite(budgetMax) &&
      budgetMax > 0 &&
      Number.isFinite(leverage) &&
      leverage > 0 &&
      Number.isFinite(minRequiredQuote) &&
      minRequiredQuote > 0
    ) ? (minRequiredQuote / (budgetMax * leverage)) : toNum(base.requiredQtyPct),
    requiredBudget: (
      Number.isFinite(qtyPct) &&
      qtyPct > 0 &&
      Number.isFinite(leverage) &&
      leverage > 0 &&
      Number.isFinite(minRequiredQuote) &&
      minRequiredQuote > 0
    ) ? (minRequiredQuote / (qtyPct * leverage)) : toNum(base.requiredBudget),
    shortfallQuote: (
      Number.isFinite(minRequiredQuote) &&
      minRequiredQuote > 0 &&
      Number.isFinite(notionalQuote)
    ) ? Math.max(0, minRequiredQuote - notionalQuote) : toNum(base.shortfallQuote),
  };
}

function resolveEntryBudgetGuardMinQtyFloor({
  symbol = null,
  qtyRequested = null,
  openclawQty = null,
  finalQty = null,
  entryBudgetGuard = null,
} = {}) {
  if (!isEntryBudgetGuardMinQtyFloorEnabled(symbol)) return null;
  if (!entryBudgetGuard || entryBudgetGuard.applicable !== true || entryBudgetGuard.ok === true) return null;
  if (upper(entryBudgetGuard.reason) !== "MIN_ORDER_EXCEEDS_BUDGET") return null;

  const feasibleBand = resolveEntryBudgetGuardFeasibleBand(entryBudgetGuard);
  const requiredQtyPct = toNum(feasibleBand.minTradableQtyPct);
  const finalQtyPct = toNum(finalQty);
  const executorQtyPct = toNum(openclawQty);
  const requestedQtyPct = toNum(qtyRequested);
  const allowSoftReduceBypass = toBool(process.env.ENTRY_BUDGET_GUARD_SOFT_REDUCE_BYPASS_ENABLED, true);

  if (!Number.isFinite(requiredQtyPct) || requiredQtyPct <= 0 || requiredQtyPct > 1 + EPSILON) return null;
  if (!Number.isFinite(finalQtyPct) || finalQtyPct <= 0 || finalQtyPct + EPSILON >= requiredQtyPct) return null;

  const softReduceBypassed = (
    Number.isFinite(requestedQtyPct) &&
    requestedQtyPct > 0 &&
    Number.isFinite(executorQtyPct) &&
    executorQtyPct > 0 &&
    requiredQtyPct > executorQtyPct + EPSILON
  );
  if (softReduceBypassed && !allowSoftReduceBypass) return null;

  let maxSnapQtyPct = softReduceBypassed
    ? requestedQtyPct
    : executorQtyPct;
  if (!Number.isFinite(maxSnapQtyPct) || maxSnapQtyPct <= 0) {
    maxSnapQtyPct = Number.isFinite(requestedQtyPct) && requestedQtyPct > 0
      ? requestedQtyPct
      : null;
  }
  if (!Number.isFinite(maxSnapQtyPct) || maxSnapQtyPct <= 0) return null;
  if (requiredQtyPct > maxSnapQtyPct + EPSILON) return null;

  return {
    applied: true,
    reason: "ENTRY_BUDGET_GUARD_MIN_QTY_FLOOR_APPLIED",
    previousQtyPct: finalQtyPct,
    snappedQtyPct: requiredQtyPct,
    requiredQtyPct,
    maxSnapQtyPct,
    feasibleBand: feasibleBand.band,
    fullOnly: feasibleBand.fullOnly,
    softReduceBypassed,
    snapSource: softReduceBypassed ? "REQUESTED_QTY" : "EXECUTOR_QTY",
  };
}

function patchPolicyEvalQty(policyEval, qtyPctFinal, extraFeatures = {}) {
  const base = (policyEval && typeof policyEval === "object") ? policyEval : {};
  const featuresPatch = (base.featuresPatch && typeof base.featuresPatch === "object")
    ? { ...base.featuresPatch, ...extraFeatures }
    : { ...extraFeatures };
  featuresPatch._qty_pct_final = qtyPctFinal;
  return {
    ...base,
    qtyPctFinal,
    featuresPatch,
  };
}

function resolveRequestedQtyPct({
  requestedQtyPct = null,
  qtyPct = null,
  features = null,
} = {}) {
  const featureBag = (features && typeof features === "object") ? features : {};
  const candidates = [
    requestedQtyPct,
    featureBag._openclaw_authority_qty_requested,
    featureBag._entry_budget_signal_floor_prev_qty_pct,
    featureBag._entry_budget_signal_floor_qty_pct,
    featureBag._signal_requested_qty_pct,
    featureBag.qty_requested_pct,
    featureBag.requestedQtyPct,
    featureBag._rescue_add_requested_qty_pct,
    qtyPct,
  ];
  for (const candidate of candidates) {
    const value = toNum(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
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
  const feasibleBand = resolveEntryBudgetGuardFeasibleBand(entryBudgetGuard);
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
    _openclaw_authority_entry_budget_guard_min_tradable_qty_pct: toNum(feasibleBand.minTradableQtyPct),
    _openclaw_authority_entry_budget_guard_feasible_band: feasibleBand.band,
    _openclaw_authority_entry_budget_guard_full_only: feasibleBand.fullOnly,
    _openclaw_authority_entry_budget_guard_required_budget: toNum(entryBudgetGuard && entryBudgetGuard.requiredBudget),
    _openclaw_authority_entry_budget_guard_shortfall_quote: toNum(entryBudgetGuard && entryBudgetGuard.shortfallQuote),
    _openclaw_authority_entry_budget_guard_floor_applied: policyPatch._openclaw_authority_entry_budget_guard_floor_applied === true,
    _openclaw_authority_entry_budget_guard_floor_previous_qty_pct: toNum(policyPatch._openclaw_authority_entry_budget_guard_floor_previous_qty_pct),
    _openclaw_authority_entry_budget_guard_floor_qty_pct: toNum(policyPatch._openclaw_authority_entry_budget_guard_floor_qty_pct),
    _openclaw_authority_entry_budget_guard_floor_max_snap_qty_pct: toNum(policyPatch._openclaw_authority_entry_budget_guard_floor_max_snap_qty_pct),
    _openclaw_authority_entry_budget_guard_floor_reason: upper(policyPatch._openclaw_authority_entry_budget_guard_floor_reason) || null,
    _openclaw_authority_entry_budget_guard_floor_soft_reduce_bypassed: policyPatch._openclaw_authority_entry_budget_guard_floor_soft_reduce_bypassed === true,
    _openclaw_authority_entry_budget_guard_floor_snap_source: upper(policyPatch._openclaw_authority_entry_budget_guard_floor_snap_source) || null,
  };
}

async function evaluateOpenClawExecutionAuthority({
  exchange = null,
  symbol = null,
  intent = null,
  event = null,
  side = null,
  qtyPct = null,
  requestedQtyPct = null,
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
  const baseFeatures = (features && typeof features === "object") ? { ...features } : {};
  const qtyRequested = resolveRequestedQtyPct({
    requestedQtyPct,
    qtyPct,
    features: baseFeatures,
  });

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

  let effectivePolicyEval = policyEval;
  let entryBudgetGuard = entryBudgetGuardOverride || await evaluateEntryBudgetGuard({
    exchange,
    symbol,
    intent,
    qtyPct: finalQty,
  });
  const floorAdjustment = resolveEntryBudgetGuardMinQtyFloor({
    symbol,
    qtyRequested,
    openclawQty,
    finalQty,
    entryBudgetGuard,
  });
  if (floorAdjustment && floorAdjustment.applied === true) {
    effectivePolicyEval = patchPolicyEvalQty(policyEval, floorAdjustment.snappedQtyPct, {
      _openclaw_authority_entry_budget_guard_floor_applied: true,
      _openclaw_authority_entry_budget_guard_floor_previous_qty_pct: floorAdjustment.previousQtyPct,
      _openclaw_authority_entry_budget_guard_floor_qty_pct: floorAdjustment.snappedQtyPct,
      _openclaw_authority_entry_budget_guard_floor_max_snap_qty_pct: floorAdjustment.maxSnapQtyPct,
      _openclaw_authority_entry_budget_guard_floor_reason: floorAdjustment.reason,
      _openclaw_authority_entry_budget_guard_floor_soft_reduce_bypassed: floorAdjustment.softReduceBypassed === true,
      _openclaw_authority_entry_budget_guard_floor_snap_source: floorAdjustment.snapSource,
    });
    entryBudgetGuard = entryBudgetGuardOverride
      ? buildEntryBudgetGuardResultAtQty(entryBudgetGuardOverride, floorAdjustment.snappedQtyPct)
      : await evaluateEntryBudgetGuard({
        exchange,
        symbol,
        intent,
        qtyPct: floorAdjustment.snappedQtyPct,
      });
  }
  const guardedFeaturesPatch = mergeAuthorityFeatures({
    baseFeatures,
    openclawEval,
    policyEval: effectivePolicyEval,
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
    reason: upper(effectivePolicyEval && effectivePolicyEval.reason) || upper(openclawEval && openclawEval.reason) || "OPENCLAW_EXECUTION_AUTHORITY_OK",
    qtyPctFinal: toNum(effectivePolicyEval && effectivePolicyEval.qtyPctFinal) || finalQty,
    exitProfileMode: openclawEval && openclawEval.exitProfileMode ? String(openclawEval.exitProfileMode).toUpperCase() : null,
    featuresPatch: guardedFeaturesPatch,
    decision: openclawEval && openclawEval.decision ? openclawEval.decision : null,
    policy: effectivePolicyEval && effectivePolicyEval.policy ? effectivePolicyEval.policy : null,
    authority: {
      stage: upper(stage),
      requestedQtyPct: qtyRequested,
      finalQtyPct: toNum(effectivePolicyEval && effectivePolicyEval.qtyPctFinal) || finalQty,
      blockingLayer: "NONE",
      openclaw: openclawEval || null,
      livePolicy: effectivePolicyEval || null,
      entryBudgetGuard,
      entryBudgetFloor: floorAdjustment,
    },
  };
}

module.exports = {
  evaluateOpenClawExecutionAuthority,
  __test: {
    buildEntryBudgetGuardResultAtQty,
    resolveEntryBudgetGuardFeasibleBand,
    isEntryBudgetGuardMinQtyFloorEnabled,
    mergeAuthorityFeatures,
    patchPolicyEvalQty,
    resolveEntryBudgetGuardMinQtyFloor,
    resolveRequestedQtyPct,
  },
};
