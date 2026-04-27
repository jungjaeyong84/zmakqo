"use strict";

const ECONOMIC_STATE = Object.freeze({
  FULL: "FULL",
  RUNNER: "RUNNER",
  FLAT: "FLAT",
});

const EXECUTION_STATE = Object.freeze({
  SYNCED: "SYNCED",
  PENDING_SUBMIT: "PENDING_SUBMIT",
  PENDING_REPLACE: "PENDING_REPLACE",
  RECOVERING: "RECOVERING",
});

const ORDER_ROLE = Object.freeze({
  ENTRY_ORDER: "ENTRY_ORDER",
  TP1_ORDER: "TP1_ORDER",
  ACTIVE_STOP_ORDER: "ACTIVE_STOP_ORDER",
});

const EVENT = Object.freeze({
  ENTRY_FILLED: "ENTRY_FILLED",
  TP1_REACHED: "TP1_REACHED",
  TRAIL_ACTIVATED: "TRAIL_ACTIVATED",
  TRAIL_FINAL_EXIT: "TRAIL_FINAL_EXIT",
  SL_HIT: "SL_HIT",
  FORCE_EXIT_ALL: "FORCE_EXIT_ALL",
  EXTERNAL_CLOSE_SYNC: "EXTERNAL_CLOSE_SYNC",
});

const DEFAULT_TP1_QTY_RATIO = 0.5;
const DEFAULT_TP1_TARGET_PCT = 0.025;
const DEFAULT_FLOOR_LOCK_PCT = 0.0025;
const DEFAULT_TRAIL_PCT = 0.01;
const DEFAULT_SIMPLIFIED_EXIT_V2_ENABLED = true;

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (!text) return fallback;
  return text === "1" || text === "true" || text === "yes" || text === "y" || text === "on";
}

function resolveExecutionMode(input = null) {
  const source = input && typeof input === "object" ? input : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const mode = String(
    source.execution_mode
    || source.executionMode
    || meta.execution_mode
    || meta.executionMode
    || ""
  ).trim().toUpperCase();
  return mode || null;
}

function isSimplifiedExitV2RuntimeEnabled() {
  return toBool(process.env.SIMPLIFIED_EXIT_V2_ENABLED, DEFAULT_SIMPLIFIED_EXIT_V2_ENABLED);
}

function shouldForceSimplifiedExitV2ForLiveRuntime(input = null, env = process.env) {
  const forceEnabled = toBool(env.SIMPLIFIED_EXIT_V2_FORCE_LIVE, true);
  if (forceEnabled !== true) return false;
  const mode = resolveExecutionMode(input);
  return mode === "LIVE" || mode === "LIVE_DRY_RUN";
}

// TP0 retirement policy (2026-04-17): every NEW position meta must be stamped
// with `simplified_exit_v2_enabled: true` at entry time. Existing in-flight
// v1 positions retain their flag (null / false) and continue through the
// legacy fallback path. This helper is the single authorised source used by
// position writers at entry to materialise the policy.
function stampEntryMetaWithSimplifiedExitV2Policy(meta = {}) {
  const base = meta && typeof meta === "object" ? { ...meta } : {};
  base.simplified_exit_v2_enabled = true;
  base.simplifiedExitV2Enabled = true;
  return base;
}

// Runtime guard: refuse to start the live exit path with v2 disabled via env.
// We allow v2 to be turned off for offline tooling (backtests, replay,
// integrity reports) but not for the live paper/real trading executor.
function assertSimplifiedExitV2EnabledForLiveRuntime({
  executionMode = null,
  envValue = process.env.SIMPLIFIED_EXIT_V2_ENABLED,
} = {}) {
  const mode = String(executionMode || "").trim().toUpperCase();
  if (mode !== "LIVE" && mode !== "LIVE_DRY_RUN") return { ok: true };
  const explicit = String(envValue == null ? "" : envValue).trim().toLowerCase();
  if (explicit === "0" || explicit === "false" || explicit === "no" || explicit === "off") {
    const err = new Error("SIMPLIFIED_EXIT_V2_ENABLED_MUST_BE_TRUE_FOR_LIVE_RUNTIME");
    err.code = "SIMPLIFIED_EXIT_V2_ENABLED_MUST_BE_TRUE_FOR_LIVE_RUNTIME";
    err.execution_mode = mode;
    throw err;
  }
  return { ok: true };
}

// Resolve the simplified-exit-v2 flag strictly from the position/meta snapshot.
// This is the production path for live trading; the env default is used only as a
// last resort for brand-new positions at entry time.
// Returns null when the snapshot carries no explicit decision and env fallback is
// suppressed by the caller.
function resolveSimplifiedExitV2FlagFromSnapshot(input = null) {
  const source = input && typeof input === "object" ? input : null;
  if (!source) return null;
  if (shouldForceSimplifiedExitV2ForLiveRuntime(source)) return true;
  if (source.simplifiedExitV2Enabled !== undefined && source.simplifiedExitV2Enabled !== null && source.simplifiedExitV2Enabled !== "") {
    return toBool(source.simplifiedExitV2Enabled, false);
  }
  if (source.simplified_exit_v2_enabled !== undefined && source.simplified_exit_v2_enabled !== null && source.simplified_exit_v2_enabled !== "") {
    return toBool(source.simplified_exit_v2_enabled, false);
  }
  const meta = source.meta && typeof source.meta === "object" ? source.meta : source;
  if (meta && typeof meta === "object") {
    if (shouldForceSimplifiedExitV2ForLiveRuntime({ ...source, meta })) return true;
    if (meta.simplified_exit_v2_enabled !== undefined && meta.simplified_exit_v2_enabled !== null && meta.simplified_exit_v2_enabled !== "") {
      return toBool(meta.simplified_exit_v2_enabled, false);
    }
    if (meta.simplifiedExitV2Enabled !== undefined && meta.simplifiedExitV2Enabled !== null && meta.simplifiedExitV2Enabled !== "") {
      return toBool(meta.simplifiedExitV2Enabled, false);
    }
  }
  return null;
}

// Backward-compatible resolver. When a snapshot lacks an explicit flag the
// runtime env is consulted; this is required during the v1→v2 migration window
// because many in-flight positions were opened before the flag became mandatory.
//
// Strict callers (e.g. order creation) should use `requireSimplifiedExitV2Flag`
// which throws instead of silently defaulting, making env drift impossible.
function isSimplifiedExitV2Active(input = null) {
  const resolved = resolveSimplifiedExitV2FlagFromSnapshot(input);
  if (resolved === true || resolved === false) return resolved;
  return isSimplifiedExitV2RuntimeEnabled();
}

function requireSimplifiedExitV2Flag(input = null, { context = "unspecified" } = {}) {
  const resolved = resolveSimplifiedExitV2FlagFromSnapshot(input);
  if (resolved === true || resolved === false) return resolved;
  const err = new Error(`SIMPLIFIED_EXIT_V2_FLAG_MISSING:${context}`);
  err.code = "SIMPLIFIED_EXIT_V2_FLAG_MISSING";
  err.context = context;
  throw err;
}

function normalizeSide(side) {
  const upper = toUpper(side);
  if (upper === "LONG" || upper === "BUY") return "LONG";
  if (upper === "SHORT" || upper === "SELL") return "SHORT";
  return null;
}

function countStepDecimals(stepSize) {
  const step = Number(stepSize);
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  if (text.includes("e-")) {
    const parts = text.split("e-");
    return Number(parts[1]) || 0;
  }
  const dot = text.indexOf(".");
  return dot >= 0 ? text.length - dot - 1 : 0;
}

function normalizeStepValue(value, stepSize) {
  const decimals = countStepDecimals(stepSize);
  return Number(Number(value).toFixed(decimals));
}

function roundDownToStep(value, stepSize) {
  const num = Number(value);
  const step = Number(stepSize);
  if (!Number.isFinite(num)) return null;
  if (!Number.isFinite(step) || step <= 0) return num;
  const quotient = Math.floor((num + (step * 1e-9)) / step);
  return normalizeStepValue(quotient * step, step);
}

function almostGte(left, right, epsilon = 1e-9) {
  return Number(left) + Number(epsilon) >= Number(right);
}

function buildIssue(code, details = {}) {
  return { code, ...details };
}

function isBlockingIssue(code) {
  return (
    code === "INVALID_SIDE" ||
    code === "INVALID_ENTRY_PRICE" ||
    code === "INVALID_ENTRY_QTY_ABS" ||
    code === "INVALID_TP1_QTY_RATIO" ||
    code === "INVALID_TP1_TARGET_PCT" ||
    code === "INVALID_STOP_LOSS_PCT" ||
    code === "INVALID_TRAIL_PCT" ||
    code === "TP1_TARGET_QTY_BELOW_MIN_QTY" ||
    code === "TP1_TARGET_NOTIONAL_BELOW_MIN_NOTIONAL" ||
    code === "RUNNER_QTY_BELOW_MIN_QTY" ||
    code === "RUNNER_NOTIONAL_BELOW_MIN_NOTIONAL"
  );
}

function resolveDirectionalPrice(entryPrice, pct, side, kind) {
  if (side === "LONG") {
    if (kind === "TP1") return entryPrice * (1 + pct);
    if (kind === "STOP") return entryPrice * (1 - pct);
    if (kind === "FLOOR") return entryPrice * (1 + pct);
  }
  if (side === "SHORT") {
    if (kind === "TP1") return entryPrice * (1 - pct);
    if (kind === "STOP") return entryPrice * (1 + pct);
    if (kind === "FLOOR") return entryPrice * (1 - pct);
  }
  return null;
}

function buildSimplifiedExitPlan({
  side,
  entryPrice,
  entryQtyAbs,
  qtyStep = 0,
  minQty = 0,
  minNotional = 0,
  tp1QtyRatio = DEFAULT_TP1_QTY_RATIO,
  tp1TargetPct = DEFAULT_TP1_TARGET_PCT,
  stopLossPct,
  floorLockPct = 0,
  trailPct,
} = {}) {
  const issues = [];
  const normalizedSide = normalizeSide(side);
  const normalizedEntryPrice = toNum(entryPrice);
  const normalizedEntryQtyAbs = roundDownToStep(entryQtyAbs, qtyStep);
  const normalizedMinQty = Math.max(0, toNum(minQty) || 0);
  const normalizedMinNotional = Math.max(0, toNum(minNotional) || 0);
  const normalizedTp1QtyRatio = toNum(tp1QtyRatio);
  const normalizedTp1TargetPct = toNum(tp1TargetPct);
  const normalizedStopLossPct = toNum(stopLossPct);
  const normalizedFloorLockPct = Math.max(0, toNum(floorLockPct) || 0);
  const normalizedTrailPct = toNum(trailPct);

  if (!normalizedSide) issues.push(buildIssue("INVALID_SIDE", { side }));
  if (!(normalizedEntryPrice > 0)) issues.push(buildIssue("INVALID_ENTRY_PRICE", { entryPrice }));
  if (!(normalizedEntryQtyAbs > 0)) issues.push(buildIssue("INVALID_ENTRY_QTY_ABS", { entryQtyAbs }));
  if (!(normalizedTp1QtyRatio > 0 && normalizedTp1QtyRatio < 1)) {
    issues.push(buildIssue("INVALID_TP1_QTY_RATIO", { tp1QtyRatio }));
  }
  if (!(normalizedTp1TargetPct > 0)) {
    issues.push(buildIssue("INVALID_TP1_TARGET_PCT", { tp1TargetPct }));
  }
  if (!(normalizedStopLossPct > 0)) {
    issues.push(buildIssue("INVALID_STOP_LOSS_PCT", { stopLossPct }));
  }
  if (!(normalizedTrailPct > 0)) {
    issues.push(buildIssue("INVALID_TRAIL_PCT", { trailPct }));
  }

  if (issues.some((issue) => isBlockingIssue(issue.code))) {
    return {
      ok: false,
      issues,
      blocking_issues: issues.filter((issue) => isBlockingIssue(issue.code)),
    };
  }

  const tp1TargetQtyAbs = roundDownToStep(normalizedEntryQtyAbs * normalizedTp1QtyRatio, qtyStep);
  const runnerQtyAbs = Number.isFinite(Number(qtyStep)) && Number(qtyStep) > 0
    ? normalizeStepValue(normalizedEntryQtyAbs - tp1TargetQtyAbs, qtyStep)
    : (normalizedEntryQtyAbs - tp1TargetQtyAbs);
  const tp1TargetPrice = resolveDirectionalPrice(normalizedEntryPrice, normalizedTp1TargetPct, normalizedSide, "TP1");
  const initialStopPrice = resolveDirectionalPrice(normalizedEntryPrice, normalizedStopLossPct, normalizedSide, "STOP");
  const runnerFloorStop = resolveDirectionalPrice(normalizedEntryPrice, normalizedFloorLockPct, normalizedSide, "FLOOR");
  const tp1Notional = tp1TargetQtyAbs * tp1TargetPrice;
  const runnerNotional = runnerQtyAbs * normalizedEntryPrice;

  if (tp1TargetQtyAbs < normalizedMinQty) {
    issues.push(buildIssue("TP1_TARGET_QTY_BELOW_MIN_QTY", {
      tp1TargetQtyAbs,
      minQty: normalizedMinQty,
    }));
  }
  if (normalizedMinNotional > 0 && tp1Notional < normalizedMinNotional) {
    issues.push(buildIssue("TP1_TARGET_NOTIONAL_BELOW_MIN_NOTIONAL", {
      tp1Notional,
      minNotional: normalizedMinNotional,
    }));
  }
  if (runnerQtyAbs < normalizedMinQty) {
    issues.push(buildIssue("RUNNER_QTY_BELOW_MIN_QTY", {
      runnerQtyAbs,
      minQty: normalizedMinQty,
    }));
  }
  if (normalizedMinNotional > 0 && runnerNotional < normalizedMinNotional) {
    issues.push(buildIssue("RUNNER_NOTIONAL_BELOW_MIN_NOTIONAL", {
      runnerNotional,
      minNotional: normalizedMinNotional,
    }));
  }

  return {
    ok: !issues.some((issue) => isBlockingIssue(issue.code)),
    issues,
    blocking_issues: issues.filter((issue) => isBlockingIssue(issue.code)),
    side: normalizedSide,
    entry_price: normalizedEntryPrice,
    entry_qty_abs: normalizedEntryQtyAbs,
    tp1_qty_ratio: normalizedTp1QtyRatio,
    tp1_target_pct: normalizedTp1TargetPct,
    tp1_target_price: tp1TargetPrice,
    tp1_target_qty_abs: tp1TargetQtyAbs,
    tp1_notional: tp1Notional,
    runner_qty_abs: runnerQtyAbs,
    runner_notional: runnerNotional,
    stop_loss_pct: normalizedStopLossPct,
    initial_stop_price: initialStopPrice,
    floor_lock_pct: normalizedFloorLockPct,
    runner_floor_stop: runnerFloorStop,
    trail_pct: normalizedTrailPct,
  };
}

function mapEconomicStateToCanonicalStage(economicState) {
  if (economicState === ECONOMIC_STATE.RUNNER) return "TRAIL";
  if (economicState === ECONOMIC_STATE.FLAT) return "FLAT";
  return "FULL";
}

function accumulateAbsoluteFillQty(currentFilledQtyAbs, fillQtyAbs) {
  const current = Math.max(0, toNum(currentFilledQtyAbs) || 0);
  const delta = Math.max(0, toNum(fillQtyAbs) || 0);
  return current + delta;
}

function resolveTp1Completion({
  tp1FilledQtyAbs,
  tp1TargetQtyAbs,
  epsilonAbs = 1e-9,
} = {}) {
  const filled = Math.max(0, toNum(tp1FilledQtyAbs) || 0);
  const target = Math.max(0, toNum(tp1TargetQtyAbs) || 0);
  const tp1Complete = target > 0 && almostGte(filled, target, epsilonAbs);
  return {
    tp1_complete: tp1Complete,
    remaining_qty_abs: Math.max(0, target - filled),
    next_economic_state: tp1Complete ? ECONOMIC_STATE.RUNNER : ECONOMIC_STATE.FULL,
  };
}

function classifySimplifiedExitEvent({
  fillOrderId = null,
  tp1OrderId = null,
  activeStopOrderId = null,
  economicState = null,
  forceExit = false,
  externalClose = false,
} = {}) {
  if (forceExit) return EVENT.FORCE_EXIT_ALL;
  if (externalClose) return EVENT.EXTERNAL_CLOSE_SYNC;
  const currentEconomicState = toUpper(economicState);
  if (fillOrderId != null && tp1OrderId != null && String(fillOrderId) === String(tp1OrderId)) {
    return EVENT.TP1_REACHED;
  }
  if (fillOrderId != null && activeStopOrderId != null && String(fillOrderId) === String(activeStopOrderId)) {
    return currentEconomicState === ECONOMIC_STATE.RUNNER
      ? EVENT.TRAIL_FINAL_EXIT
      : EVENT.SL_HIT;
  }
  return EVENT.EXTERNAL_CLOSE_SYNC;
}

function computeSimplifiedTrailingStop({
  side,
  entryPrice,
  currentPrice,
  trailPct,
  floorLockPct = 0,
  trailHighPrice = null,
  trailLowPrice = null,
  currentStopPrice = null,
} = {}) {
  const normalizedSide = normalizeSide(side);
  const normalizedEntryPrice = toNum(entryPrice);
  const normalizedCurrentPrice = toNum(currentPrice);
  const normalizedTrailPct = toNum(trailPct);
  const normalizedFloorLockPct = Math.max(0, toNum(floorLockPct) || 0);
  const normalizedCurrentStopPrice = toNum(currentStopPrice);

  if (!normalizedSide || !(normalizedEntryPrice > 0) || !(normalizedCurrentPrice > 0) || !(normalizedTrailPct > 0)) {
    return null;
  }

  if (normalizedSide === "LONG") {
    const watermarkPrice = Math.max(
      normalizedCurrentPrice,
      toNum(trailHighPrice) || normalizedCurrentPrice
    );
    const runnerFloorStop = resolveDirectionalPrice(normalizedEntryPrice, normalizedFloorLockPct, normalizedSide, "FLOOR");
    const trailStop = watermarkPrice * (1 - normalizedTrailPct);
    const finalEffectiveStop = Math.max(runnerFloorStop, trailStop);
    const chosenStopSource = trailStop >= runnerFloorStop ? "TRAIL" : "FLOOR";
    const shouldReplaceStop = !Number.isFinite(normalizedCurrentStopPrice) || finalEffectiveStop > normalizedCurrentStopPrice + 1e-9;
    return {
      side: normalizedSide,
      trail_high_price: watermarkPrice,
      trail_low_price: null,
      runner_floor_stop: runnerFloorStop,
      trail_stop: trailStop,
      final_effective_stop: finalEffectiveStop,
      chosen_stop_source: chosenStopSource,
      should_replace_stop: shouldReplaceStop,
    };
  }

  const watermarkPrice = Math.min(
    normalizedCurrentPrice,
    toNum(trailLowPrice) || normalizedCurrentPrice
  );
  const runnerFloorStop = resolveDirectionalPrice(normalizedEntryPrice, normalizedFloorLockPct, normalizedSide, "FLOOR");
  const trailStop = watermarkPrice * (1 + normalizedTrailPct);
  const finalEffectiveStop = Math.min(runnerFloorStop, trailStop);
  const chosenStopSource = trailStop <= runnerFloorStop ? "TRAIL" : "FLOOR";
  const shouldReplaceStop = !Number.isFinite(normalizedCurrentStopPrice) || finalEffectiveStop < normalizedCurrentStopPrice - 1e-9;
  return {
    side: normalizedSide,
    trail_high_price: null,
    trail_low_price: watermarkPrice,
    runner_floor_stop: runnerFloorStop,
    trail_stop: trailStop,
    final_effective_stop: finalEffectiveStop,
    chosen_stop_source: chosenStopSource,
    should_replace_stop: shouldReplaceStop,
  };
}

function buildSimplifiedExitShadowView({
  side,
  entryPrice,
  entryQtyAbs,
  currentQtyAbs = null,
  closePrice = null,
  tp1FilledQtyAbs = null,
  tp1Done = false,
  trailHighPrice = null,
  trailLowPrice = null,
  currentStopPrice = null,
  stopLossPct,
  floorLockPct = DEFAULT_FLOOR_LOCK_PCT,
  trailPct = DEFAULT_TRAIL_PCT,
  tp1QtyRatio = DEFAULT_TP1_QTY_RATIO,
  tp1TargetPct = DEFAULT_TP1_TARGET_PCT,
  qtyStep = 0,
  minQty = 0,
  minNotional = 0,
  legacyCanonicalStage = null,
  legacyTp0Done = false,
} = {}) {
  const plan = buildSimplifiedExitPlan({
    side,
    entryPrice,
    entryQtyAbs,
    qtyStep,
    minQty,
    minNotional,
    tp1QtyRatio,
    tp1TargetPct,
    stopLossPct,
    floorLockPct,
    trailPct,
  });
  const divergenceCodes = [];
  const issues = Array.isArray(plan.issues) ? [...plan.issues] : [];
  if (!plan.ok) {
    return {
      available: false,
      issues,
      divergence_codes: divergenceCodes,
      legacy_canonical_stage: toUpper(legacyCanonicalStage) || null,
      legacy_tp0_done: legacyTp0Done === true,
    };
  }

  const normalizedCurrentQtyAbs = Math.max(0, toNum(currentQtyAbs) || 0);
  const inferredTp1FilledQtyAbs = Math.max(
    0,
    tp1Done === true
      ? (toNum(tp1FilledQtyAbs) ?? plan.tp1_target_qty_abs)
      : (toNum(tp1FilledQtyAbs) ?? 0)
  );
  const tp1 = resolveTp1Completion({
    tp1FilledQtyAbs: inferredTp1FilledQtyAbs,
    tp1TargetQtyAbs: plan.tp1_target_qty_abs,
  });
  let economicState = tp1.next_economic_state;
  if (!(normalizedCurrentQtyAbs > 0)) {
    economicState = ECONOMIC_STATE.FLAT;
  }
  const trailing = economicState === ECONOMIC_STATE.RUNNER
    ? computeSimplifiedTrailingStop({
        side,
        entryPrice,
        currentPrice: closePrice,
        trailPct,
        floorLockPct,
        trailHighPrice,
        trailLowPrice,
        currentStopPrice,
      })
    : null;
  const expectedRunnerRemainingQtyAbs = economicState === ECONOMIC_STATE.RUNNER
    ? normalizedCurrentQtyAbs
    : (economicState === ECONOMIC_STATE.FLAT ? 0 : plan.runner_qty_abs);
  const legacyStage = toUpper(legacyCanonicalStage) || null;
  const shadowStage = mapEconomicStateToCanonicalStage(economicState);

  if (legacyTp0Done === true) {
    divergenceCodes.push("LEGACY_TP0_PRESENT");
  }
  if (legacyStage && legacyStage !== shadowStage) {
    divergenceCodes.push("LEGACY_STAGE_MISMATCH");
  }
  if (economicState === ECONOMIC_STATE.FULL && normalizedCurrentQtyAbs > 0 && plan.entry_qty_abs - normalizedCurrentQtyAbs > 1e-9) {
    divergenceCodes.push("PRE_TP1_QTY_REDUCED");
  }
  if (economicState === ECONOMIC_STATE.RUNNER && normalizedCurrentQtyAbs - plan.runner_qty_abs > 1e-9) {
    divergenceCodes.push("RUNNER_QTY_EXCEEDS_PLAN");
  }
  if (economicState === ECONOMIC_STATE.RUNNER && plan.runner_qty_abs - normalizedCurrentQtyAbs > 1e-9) {
    divergenceCodes.push("RUNNER_QTY_BELOW_PLAN");
  }
  if (tp1Done === true && !tp1.tp1_complete) {
    divergenceCodes.push("TP1_DONE_FLAG_WITHOUT_TARGET_FILL");
  }

  return {
    available: true,
    issues,
    divergence_codes: divergenceCodes,
    economic_state: economicState,
    canonical_stage: shadowStage,
    legacy_canonical_stage: legacyStage,
    legacy_tp0_done: legacyTp0Done === true,
    entry_price: plan.entry_price,
    entry_qty_abs: plan.entry_qty_abs,
    observed_current_qty_abs: normalizedCurrentQtyAbs > 0 ? normalizedCurrentQtyAbs : 0,
    tp1_target_pct: plan.tp1_target_pct,
    tp1_target_price: plan.tp1_target_price,
    tp1_target_qty_abs: plan.tp1_target_qty_abs,
    tp1_filled_qty_abs: inferredTp1FilledQtyAbs,
    tp1_complete: tp1.tp1_complete,
    tp1_remaining_qty_abs: tp1.remaining_qty_abs,
    runner_qty_abs: plan.runner_qty_abs,
    runner_remaining_qty_abs: expectedRunnerRemainingQtyAbs,
    stop_loss_pct: plan.stop_loss_pct,
    initial_stop_price: plan.initial_stop_price,
    floor_lock_pct: plan.floor_lock_pct,
    runner_floor_stop: trailing ? trailing.runner_floor_stop : plan.runner_floor_stop,
    trail_pct: plan.trail_pct,
    trail_stop: trailing ? trailing.trail_stop : null,
    final_effective_stop: trailing ? trailing.final_effective_stop : null,
    chosen_stop_source: trailing ? trailing.chosen_stop_source : null,
    should_replace_stop: trailing ? trailing.should_replace_stop : false,
  };
}

module.exports = {
  ECONOMIC_STATE,
  EXECUTION_STATE,
  ORDER_ROLE,
  EVENT,
  DEFAULT_TP1_QTY_RATIO,
  DEFAULT_TP1_TARGET_PCT,
  DEFAULT_FLOOR_LOCK_PCT,
  DEFAULT_TRAIL_PCT,
  isSimplifiedExitV2RuntimeEnabled,
  isSimplifiedExitV2Active,
  resolveSimplifiedExitV2FlagFromSnapshot,
  resolveExecutionMode,
  shouldForceSimplifiedExitV2ForLiveRuntime,
  requireSimplifiedExitV2Flag,
  stampEntryMetaWithSimplifiedExitV2Policy,
  assertSimplifiedExitV2EnabledForLiveRuntime,
  roundDownToStep,
  buildSimplifiedExitPlan,
  accumulateAbsoluteFillQty,
  resolveTp1Completion,
  classifySimplifiedExitEvent,
  computeSimplifiedTrailingStop,
  buildSimplifiedExitShadowView,
  __test: {
    normalizeSide,
    countStepDecimals,
    resolveDirectionalPrice,
    mapEconomicStateToCanonicalStage,
  },
};
