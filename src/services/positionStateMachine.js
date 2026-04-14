"use strict";

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toUpper(value, fallback = null) {
  const text = String(value || "").trim().toUpperCase();
  return text || fallback;
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return num;
}

function normalizeSnapshot(snapshot = {}) {
  const meta = (snapshot && typeof snapshot.meta === "object") ? snapshot.meta : {};
  const state = toUpper(snapshot.state || snapshot.position_state, "FLAT");
  const positionState = toUpper(snapshot.position_state, state);
  const sizePct = toNum(snapshot.size_pct);
  const qtyBase = toNum(snapshot.qty_base);
  return {
    state,
    position_state: positionState,
    size_pct: sizePct,
    qty_base: qtyBase,
    position_side: toUpper(snapshot.position_side || meta.position_side, null),
    entry_qty_base: toNum(snapshot.entry_qty_base || meta.entry_qty_base),
    tp_p0_done: meta.tp_p0_done === true || snapshot.tpP0Done === true,
    tp_p1_done: meta.tp_p1_done === true || snapshot.tpP1Done === true,
    trail_active: meta.trail_active === true || snapshot.trailActive === true,
    meta,
  };
}

const ALLOWED_POSITION_STATE_TRANSITIONS = Object.freeze({
  UNKNOWN: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  FLAT: new Set(["FLAT", "PROBE", "COMMIT"]),
  PROBE: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  COMMIT: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  SCALE_OUT: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
});

function normalizeExitStage(value) {
  const upper = toUpper(value, "OTHER");
  if (!upper) return "OTHER";
  if (upper === "TP0" || upper === "TP1" || upper === "TRAIL" || upper === "SL") return upper;
  if (upper === "FORCE_EXIT_ALL" || upper === "FORCE_EXIT_HALF") return upper;
  if (upper === "OTHER_EXIT" || upper === "OTHER") return upper;
  return upper;
}

function resolveExitStageAbsoluteContractQtyRatio(stage, rules = {}) {
  const currentStage = normalizeExitStage(stage);
  if (currentStage === "TP0") return clamp01(toNum(rules.TP_P0_QTY) ?? 0.25);
  if (currentStage === "TP1") {
    const tp0 = clamp01(toNum(rules.TP_P0_QTY) ?? 0.25) ?? 0.25;
    const tp1Remaining = clamp01(toNum(rules.TP_P1_QTY) ?? 0.5) ?? 0.5;
    return clamp01(tp1Remaining * Math.max(0, 1 - tp0));
  }
  return null;
}

function buildCanonicalExitChainKey({
  exchange,
  symbol,
  currentStage = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
} = {}) {
  const ex = toUpper(exchange, "UNKNOWN");
  const sym = toUpper(symbol, "UNKNOWN");
  const stage = normalizeExitStage(currentStage);
  const entryKey = String(entryEventId || "").trim();
  if (entryKey) return `${ex}__${sym}__ENTRY__${entryKey}`;
  const signalKey = String(signalDocId || "").trim();
  if (signalKey) return `${ex}__${sym}__SIGNAL__${signalKey}`;
  const orderId = Number(orderMeta && orderMeta.orderId);
  if (Number.isFinite(orderId)) return `${ex}__${sym}__ORDER__${orderId}`;
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim();
  if (clientOrderId) return `${ex}__${sym}__CLIENT__${clientOrderId}`;
  return `${ex}__${sym}__STAGE__${stage}`;
}

function normalizeAuthorityState(state = {}) {
  return {
    tp0: Math.max(0, toNum(state.tp0) ?? 0),
    tp1: Math.max(0, toNum(state.tp1) ?? 0),
    trail: Math.max(0, toNum(state.trail) ?? 0),
    sl: Math.max(0, toNum(state.sl) ?? 0),
    forceExitAll: Math.max(0, toNum(state.forceExitAll) ?? 0),
    forceExitHalf: Math.max(0, toNum(state.forceExitHalf) ?? 0),
    otherExit: Math.max(0, toNum(state.otherExit) ?? 0),
    total: Math.max(0, toNum(state.total) ?? 0),
  };
}

function buildExitQuantityContractLedger({
  positionSnapshot = null,
  authorityState = null,
  rules = null,
} = {}) {
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const state = normalizeAuthorityState(authorityState || {});
  const tp0AllowedRatio = resolveExitStageAbsoluteContractQtyRatio("TP0", rules || {}) ?? 0.25;
  const tp1AllowedRatio = resolveExitStageAbsoluteContractQtyRatio("TP1", rules || {}) ?? 0.375;
  const tp0ConsumedRatio = clamp01(Math.max(
    state.tp0,
    snapshot.tp_p0_done ? tp0AllowedRatio : 0
  )) ?? 0;
  const tp1ConsumedRatio = clamp01(Math.max(
    state.tp1,
    snapshot.tp_p1_done ? tp1AllowedRatio : 0
  )) ?? 0;
  const trailConsumedRatio = clamp01(state.trail) ?? 0;
  const lowerBoundTotal = tp0ConsumedRatio + tp1ConsumedRatio + trailConsumedRatio;
  const totalConsumedRatio = clamp01(Math.max(state.total, lowerBoundTotal)) ?? 0;
  const runnerRemainingRatio = clamp01(1 - Math.min(1, tp0ConsumedRatio + tp1ConsumedRatio + trailConsumedRatio)) ?? 0;
  const entryQtyAbs = toNum(snapshot.entry_qty_base);
  return {
    entry_qty_abs: entryQtyAbs,
    entry_qty_ratio: 1,
    tp0_allowed_ratio: tp0AllowedRatio,
    tp0_consumed_ratio: tp0ConsumedRatio,
    tp1_allowed_ratio: tp1AllowedRatio,
    tp1_consumed_ratio: tp1ConsumedRatio,
    trail_consumed_ratio: trailConsumedRatio,
    total_consumed_ratio: totalConsumedRatio,
    runner_remaining_ratio: runnerRemainingRatio,
    tp0_allowed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp0AllowedRatio : null,
    tp0_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp0ConsumedRatio : null,
    tp1_allowed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp1AllowedRatio : null,
    tp1_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp1ConsumedRatio : null,
    trail_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * trailConsumedRatio : null,
    runner_remaining_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * runnerRemainingRatio : null,
  };
}

function resolveCanonicalExitTransitionEvents({
  resolvedStage,
  positionSnapshot = null,
  recentStages = null,
  ledger = null,
  observedQtyRatio = null,
  fullExit = false,
} = {}) {
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const stage = normalizeExitStage(resolvedStage);
  const recent = recentStages && typeof recentStages === "object" ? recentStages : {};
  const events = [];
  if (stage === "TP0") {
    if (snapshot.tp_p0_done !== true) events.push("TP0_REACHED");
  } else if (stage === "TP1") {
    if (snapshot.tp_p1_done !== true) events.push("TP1_REACHED");
    if (snapshot.trail_active !== true) events.push("TRAIL_ACTIVE");
  } else if (stage === "TRAIL") {
    const recentTrail = normalizeExitStage(recent.trail) === "TRAIL";
    if (snapshot.trail_active !== true && !recentTrail) events.push("TRAIL_ACTIVE");
    const observed = clamp01(observedQtyRatio);
    const remaining = ledger && Number.isFinite(Number(ledger.runner_remaining_ratio))
      ? Number(ledger.runner_remaining_ratio)
      : null;
    const likelyFinal = fullExit === true
      || (Number.isFinite(observed) && Number.isFinite(remaining) && observed >= Math.max(0, remaining - 0.03));
    events.push(likelyFinal ? "TRAIL_FINAL_EXIT" : "TRAIL_PARTIAL");
  }
  return {
    transitionEvents: events,
    primaryTransitionEvent: events.length ? events[events.length - 1] : null,
  };
}

function resolveCanonicalExitAuthorityDecision({
  exchange,
  symbol,
  currentStage = null,
  chainKey = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
  positionSnapshot = null,
  authorityState = null,
  recentStages = null,
  rules = null,
  observedQtyRatio = null,
  fullExit = false,
} = {}) {
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const stage = normalizeExitStage(currentStage);
  const resolvedChainKey = String(chainKey || "").trim() || buildCanonicalExitChainKey({
    exchange,
    symbol,
    currentStage: stage,
    entryEventId,
    signalDocId,
    orderMeta,
  });
  const ledger = buildExitQuantityContractLedger({
    positionSnapshot: snapshot,
    authorityState,
    rules,
  });
  const recent = recentStages && typeof recentStages === "object" ? recentStages : {};
  const recentTrail = normalizeExitStage(recent.trail) === "TRAIL";
  const recentTp0 = normalizeExitStage(recent.tp0) === "TP0";
  const tp0AllowedRatio = resolveExitStageAbsoluteContractQtyRatio("TP0", rules || {}) ?? 0.25;
  const tp1AllowedRatio = resolveExitStageAbsoluteContractQtyRatio("TP1", rules || {}) ?? 0.375;
  const tp0Locked = Number(ledger.tp0_consumed_ratio || 0) >= Math.max(0, tp0AllowedRatio - 0.03);
  const tp1Locked = Number(ledger.tp1_consumed_ratio || 0) >= Math.max(0, tp1AllowedRatio - 0.03);
  const postTp1Locked = snapshot.tp_p1_done === true || snapshot.trail_active === true || tp1Locked || recentTrail;
  let resolvedStage = stage;
  let reason = "PASS_THROUGH";

  if (stage === "TP0" || stage === "TP1") {
    if (postTp1Locked) {
      resolvedStage = "TRAIL";
      reason = snapshot.tp_p1_done === true || snapshot.trail_active === true
        ? "POST_TP1_STAGE_LOCK"
        : "AUTHORITY_TP1_LOCKED";
    } else if (stage === "TP0" && (snapshot.tp_p0_done === true || tp0Locked || recentTp0)) {
      resolvedStage = "TP1";
      reason = "POST_TP0_STAGE_LOCK";
    }
  }

  const transition = resolveCanonicalExitTransitionEvents({
    resolvedStage,
    positionSnapshot: snapshot,
    recentStages: recent,
    ledger,
    observedQtyRatio,
    fullExit,
  });

  return {
    chainKey: resolvedChainKey,
    currentStage: stage,
    stage: resolvedStage,
    reason,
    blockedInvariant: postTp1Locked && (stage === "TP0" || stage === "TP1") && resolvedStage === "TRAIL",
    ledger,
    transitionEvents: transition.transitionEvents,
    primaryTransitionEvent: transition.primaryTransitionEvent,
  };
}

function validatePositionSnapshotTransition({ prev = null, next = null } = {}) {
  const previous = normalizeSnapshot(prev || {});
  const current = normalizeSnapshot(next || {});
  const issues = [];

  const hasExposure = (Number.isFinite(current.size_pct) && current.size_pct > 0)
    || (Number.isFinite(current.qty_base) && current.qty_base > 0);

  if (current.state === "FLAT" && hasExposure) {
    issues.push({
      code: "FLAT_WITH_EXPOSURE",
      severity: "critical",
      message: "FLAT state cannot retain positive size or qty.",
    });
  }
  if (current.state !== "FLAT" && !hasExposure) {
    issues.push({
      code: "ACTIVE_WITHOUT_EXPOSURE",
      severity: "critical",
      message: "Active state requires positive size or qty.",
    });
  }
  if (current.position_state === "SCALE_OUT" && current.tp_p1_done !== true) {
    issues.push({
      code: "SCALE_OUT_WITHOUT_TP1",
      severity: "critical",
      message: "SCALE_OUT requires tp_p1_done=true.",
    });
  }
  if (current.tp_p1_done === true && current.tp_p0_done !== true) {
    issues.push({
      code: "TP1_WITHOUT_TP0",
      severity: "critical",
      message: "tp_p1_done=true requires tp_p0_done=true.",
    });
  }
  if (current.trail_active === true && current.tp_p1_done !== true) {
    issues.push({
      code: "TRAIL_WITHOUT_TP1",
      severity: "critical",
      message: "trail_active requires tp_p1_done=true.",
    });
  }
  if (current.trail_active === true && current.tp_p0_done !== true) {
    issues.push({
      code: "TRAIL_WITHOUT_TP0",
      severity: "critical",
      message: "trail_active=true requires tp_p0_done=true.",
    });
  }

  const fromState = previous.position_state || "UNKNOWN";
  const toState = current.position_state || "UNKNOWN";
  const allowed = ALLOWED_POSITION_STATE_TRANSITIONS[fromState] || ALLOWED_POSITION_STATE_TRANSITIONS.UNKNOWN;
  if (!allowed.has(toState)) {
    issues.push({
      code: "POSITION_STATE_TRANSITION_UNDECLARED",
      severity: "warn",
      message: `${fromState} -> ${toState} is outside the declared transition table.`,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
    issues,
    prev: previous,
    next: current,
  };
}

module.exports = {
  validatePositionSnapshotTransition,
  resolveCanonicalExitAuthorityDecision,
  resolveCanonicalExitTransitionEvents,
  buildExitQuantityContractLedger,
  buildCanonicalExitChainKey,
  __test: {
    normalizeSnapshot,
    normalizeExitStage,
    resolveExitStageAbsoluteContractQtyRatio,
    resolveCanonicalExitAuthorityDecision,
    resolveCanonicalExitTransitionEvents,
    buildExitQuantityContractLedger,
    buildCanonicalExitChainKey,
    ALLOWED_POSITION_STATE_TRANSITIONS,
  },
};
