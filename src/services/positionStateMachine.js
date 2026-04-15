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
    entry_qty_base: snapshot.entry_qty_base == null
      ? (
        meta.entry_qty_base == null
          ? (meta.entry_qty_abs == null ? null : toNum(meta.entry_qty_abs))
          : toNum(meta.entry_qty_base)
      )
      : toNum(snapshot.entry_qty_base),
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

function normalizeTransitionEvent(value) {
  return toUpper(value, null);
}

function trimPctToken(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 1000) / 1000;
  const asInt = Math.round(rounded);
  if (Math.abs(rounded - asInt) < 1e-9) return String(asInt);
  return String(rounded).replace(/\.?0+$/, "");
}

function ratioToPctToken(rawRatio) {
  const n = Number(rawRatio);
  if (!Number.isFinite(n)) return null;
  return trimPctToken(Math.abs(n) * 100);
}

function classifyExitEventStage(event) {
  const ev = toUpper(event, null);
  if (!ev) return null;
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1") || ev.startsWith("EXIT_TP_C")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return null;
}

function buildCanonicalExitEvent({
  stage = null,
  rules = null,
  fallbackEvent = null,
} = {}) {
  const resolvedStage = normalizeExitStage(stage);
  const fallback = toUpper(fallbackEvent, null);
  if (resolvedStage === "TP0") {
    const token = ratioToPctToken(rules && rules.TP_P0);
    if (fallback && fallback.startsWith("EXIT_TP_P0")) return fallback;
    return token ? `EXIT_TP_P0_${token}P` : "EXIT_TP_P0";
  }
  if (resolvedStage === "TP1") {
    const token = ratioToPctToken(rules && rules.TP_P1);
    if (fallback && (fallback.startsWith("EXIT_TP_P1") || fallback.startsWith("EXIT_TP_C"))) return fallback;
    return token ? `EXIT_TP_P1_${token}P` : "EXIT_TP_P1";
  }
  if (resolvedStage === "TRAIL") {
    if (fallback && fallback.startsWith("EXIT_TRAIL")) return fallback;
    const trailR = toNum(rules && rules.TRAIL_R_MULTIPLE);
    if (Number.isFinite(trailR) && trailR > 0) return "EXIT_TRAIL";
    const token = ratioToPctToken(rules && rules.TRAIL_PCT);
    return token ? `EXIT_TRAIL_${token}P` : "EXIT_TRAIL";
  }
  if (resolvedStage === "SL") {
    const token = ratioToPctToken(rules && rules.SL);
    if (fallback && fallback.startsWith("EXIT_SL")) return fallback;
    return token ? `EXIT_SL_${token}P` : "EXIT_SL";
  }
  if (resolvedStage === "FORCE_EXIT_ALL" || resolvedStage === "FORCE_EXIT_HALF") return resolvedStage;
  return fallback;
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
  const runnerAllowedRatio = clamp01(1 - Math.min(1, tp0AllowedRatio + tp1AllowedRatio)) ?? 0;
  const runnerRemainingRatio = clamp01(1 - Math.min(1, tp0ConsumedRatio + tp1ConsumedRatio + trailConsumedRatio)) ?? 0;
  const currentQtyAbs = snapshot.qty_base == null ? null : toNum(snapshot.qty_base);
  let entryQtyAbs = snapshot.entry_qty_base == null ? null : toNum(snapshot.entry_qty_base);
  if (!Number.isFinite(entryQtyAbs) && Number.isFinite(currentQtyAbs) && currentQtyAbs > 0) {
    if (runnerRemainingRatio > 0.000001) {
      entryQtyAbs = currentQtyAbs / runnerRemainingRatio;
    } else if (snapshot.trail_active !== true && snapshot.tp_p1_done !== true && snapshot.tp_p0_done !== true) {
      entryQtyAbs = currentQtyAbs;
    }
  }
  return {
    entry_qty_abs: entryQtyAbs,
    entry_qty_ratio: 1,
    tp0_allowed_ratio: tp0AllowedRatio,
    tp0_consumed_ratio: tp0ConsumedRatio,
    tp1_allowed_ratio: tp1AllowedRatio,
    tp1_consumed_ratio: tp1ConsumedRatio,
    runner_allowed_ratio: runnerAllowedRatio,
    trail_consumed_ratio: trailConsumedRatio,
    total_consumed_ratio: totalConsumedRatio,
    runner_remaining_ratio: runnerRemainingRatio,
    tp0_allowed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp0AllowedRatio : null,
    tp0_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp0ConsumedRatio : null,
    tp1_allowed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp1AllowedRatio : null,
    tp1_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp1ConsumedRatio : null,
    runner_allowed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * runnerAllowedRatio : null,
    trail_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * trailConsumedRatio : null,
    runner_remaining_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * runnerRemainingRatio : null,
  };
}

function validateExitQuantityContractLedger({
  ledger = null,
  positionSnapshot = null,
} = {}) {
  const source = ledger && typeof ledger === "object" ? ledger : {};
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const issues = [];
  const tp0AllowedRatio = toNum(source.tp0_allowed_ratio);
  const tp1AllowedRatio = toNum(source.tp1_allowed_ratio);
  const runnerAllowedRatio = toNum(source.runner_allowed_ratio);
  const tp0ConsumedRatio = toNum(source.tp0_consumed_ratio);
  const tp1ConsumedRatio = toNum(source.tp1_consumed_ratio);
  const trailConsumedRatio = toNum(source.trail_consumed_ratio);
  const totalConsumedRatio = toNum(source.total_consumed_ratio);
  const runnerRemainingRatio = toNum(source.runner_remaining_ratio);
  const entryQtyAbs = toNum(source.entry_qty_abs);
  const tp0AllowedAbs = toNum(source.tp0_allowed_abs);
  const tp0ConsumedAbs = toNum(source.tp0_consumed_abs);
  const tp1AllowedAbs = toNum(source.tp1_allowed_abs);
  const tp1ConsumedAbs = toNum(source.tp1_consumed_abs);
  const runnerAllowedAbs = toNum(source.runner_allowed_abs);
  const trailConsumedAbs = toNum(source.trail_consumed_abs);
  const totalConsumedAbs = Number.isFinite(entryQtyAbs) && Number.isFinite(totalConsumedRatio)
    ? entryQtyAbs * totalConsumedRatio
    : null;
  const currentQtyAbs = toNum(snapshot.qty_base);
  const runnerRemainingAbs = toNum(source.runner_remaining_abs);
  const hasExposure = (
    (Number.isFinite(snapshot.size_pct) && snapshot.size_pct > 0)
    || (Number.isFinite(snapshot.qty_base) && snapshot.qty_base > 0)
  );
  const ratioTolerance = 0.03;
  const absTolerance = Number.isFinite(entryQtyAbs)
    ? Math.max(Math.abs(entryQtyAbs) * 0.03, 1e-8)
    : 1e-8;

  if (hasExposure && !Number.isFinite(entryQtyAbs)) {
    issues.push({
      code: snapshot.tp_p0_done === true || snapshot.tp_p1_done === true || snapshot.trail_active === true
        ? "ENTRY_QTY_ABS_REQUIRED"
        : "ENTRY_QTY_ABS_MISSING",
      severity: snapshot.tp_p0_done === true || snapshot.tp_p1_done === true || snapshot.trail_active === true
        ? "critical"
        : "warn",
      message: snapshot.tp_p0_done === true || snapshot.tp_p1_done === true || snapshot.trail_active === true
        ? "Absolute qty contract cannot be audited after TP milestones without entry_qty_abs."
        : "Active exposure is missing entry_qty_abs, so absolute contract auditing is degraded.",
    });
  }

  const allowedRatioTotal = [
    tp0AllowedRatio,
    tp1AllowedRatio,
    runnerAllowedRatio,
  ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  if (Number.isFinite(allowedRatioTotal) && Math.abs(allowedRatioTotal - 1) > ratioTolerance) {
    issues.push({
      code: "EXIT_ALLOWED_RATIO_SUM_MISMATCH",
      severity: "critical",
      message: `tp0/tp1/runner allowed ratios must sum to 1. observed=${allowedRatioTotal}`,
    });
  }
  if (
    Number.isFinite(tp0AllowedRatio)
    && Number.isFinite(tp0ConsumedRatio)
    && tp0ConsumedRatio > (tp0AllowedRatio + ratioTolerance)
  ) {
    issues.push({
      code: "TP0_CONSUMED_EXCEEDS_ALLOWED",
      severity: "critical",
      message: `tp0 consumed ratio exceeded allowed contract. consumed=${tp0ConsumedRatio} allowed=${tp0AllowedRatio}`,
    });
  }
  if (
    Number.isFinite(tp1AllowedRatio)
    && Number.isFinite(tp1ConsumedRatio)
    && tp1ConsumedRatio > (tp1AllowedRatio + ratioTolerance)
  ) {
    issues.push({
      code: "TP1_CONSUMED_EXCEEDS_ALLOWED",
      severity: "critical",
      message: `tp1 consumed ratio exceeded allowed contract. consumed=${tp1ConsumedRatio} allowed=${tp1AllowedRatio}`,
    });
  }
  if (
    Number.isFinite(runnerAllowedRatio)
    && Number.isFinite(trailConsumedRatio)
    && trailConsumedRatio > (runnerAllowedRatio + ratioTolerance)
  ) {
    issues.push({
      code: "TRAIL_CONSUMED_EXCEEDS_RUNNER",
      severity: "critical",
      message: `trail consumed ratio exceeded runner contract. consumed=${trailConsumedRatio} allowed=${runnerAllowedRatio}`,
    });
  }
  if (Number.isFinite(totalConsumedRatio) && totalConsumedRatio > (1 + ratioTolerance)) {
    issues.push({
      code: "EXIT_TOTAL_CONSUMED_EXCEEDS_ENTRY",
      severity: "critical",
      message: `total consumed ratio cannot exceed 1. observed=${totalConsumedRatio}`,
    });
  }
  if (
    Number.isFinite(totalConsumedRatio)
    && Number.isFinite(runnerRemainingRatio)
    && Math.abs((totalConsumedRatio + runnerRemainingRatio) - 1) > ratioTolerance
  ) {
    issues.push({
      code: "RUNNER_REMAINING_MISMATCH",
      severity: "critical",
      message: `runner remaining ratio must complement total consumed ratio. observed=${totalConsumedRatio + runnerRemainingRatio}`,
    });
  }
  if (
    hasExposure
    && Number.isFinite(currentQtyAbs)
    && Number.isFinite(runnerRemainingAbs)
    && runnerRemainingAbs > 0
  ) {
    const qtyTolerance = Math.max(Math.abs(runnerRemainingAbs) * 0.03, 1e-8);
    if (Math.abs(currentQtyAbs - runnerRemainingAbs) > qtyTolerance) {
      issues.push({
        code: "RUNNER_REMAINING_QTY_MISMATCH",
        severity: "critical",
        message: `current qty must match runner remaining abs. qty=${currentQtyAbs} runner_remaining=${runnerRemainingAbs}`,
      });
    }
  }
  if (
    Number.isFinite(entryQtyAbs)
    && Number.isFinite(tp0AllowedAbs)
    && Number.isFinite(tp1AllowedAbs)
    && Number.isFinite(runnerAllowedAbs)
    && Math.abs((tp0AllowedAbs + tp1AllowedAbs + runnerAllowedAbs) - entryQtyAbs) > absTolerance
  ) {
    issues.push({
      code: "EXIT_ALLOWED_ABS_SUM_MISMATCH",
      severity: "critical",
      message: `tp0/tp1/runner allowed abs must sum to entry_qty_abs. observed=${tp0AllowedAbs + tp1AllowedAbs + runnerAllowedAbs} entry=${entryQtyAbs}`,
    });
  }
  if (
    Number.isFinite(tp0AllowedAbs)
    && Number.isFinite(tp0ConsumedAbs)
    && tp0ConsumedAbs > (tp0AllowedAbs + absTolerance)
  ) {
    issues.push({
      code: "TP0_CONSUMED_ABS_EXCEEDS_ALLOWED",
      severity: "critical",
      message: `tp0 consumed abs exceeded allowed contract. consumed=${tp0ConsumedAbs} allowed=${tp0AllowedAbs}`,
    });
  }
  if (
    Number.isFinite(tp1AllowedAbs)
    && Number.isFinite(tp1ConsumedAbs)
    && tp1ConsumedAbs > (tp1AllowedAbs + absTolerance)
  ) {
    issues.push({
      code: "TP1_CONSUMED_ABS_EXCEEDS_ALLOWED",
      severity: "critical",
      message: `tp1 consumed abs exceeded allowed contract. consumed=${tp1ConsumedAbs} allowed=${tp1AllowedAbs}`,
    });
  }
  if (
    Number.isFinite(runnerAllowedAbs)
    && Number.isFinite(trailConsumedAbs)
    && trailConsumedAbs > (runnerAllowedAbs + absTolerance)
  ) {
    issues.push({
      code: "TRAIL_CONSUMED_ABS_EXCEEDS_RUNNER",
      severity: "critical",
      message: `trail consumed abs exceeded runner contract. consumed=${trailConsumedAbs} allowed=${runnerAllowedAbs}`,
    });
  }
  if (
    Number.isFinite(entryQtyAbs)
    && Number.isFinite(totalConsumedAbs)
    && totalConsumedAbs > (entryQtyAbs + absTolerance)
  ) {
    issues.push({
      code: "EXIT_TOTAL_CONSUMED_ABS_EXCEEDS_ENTRY",
      severity: "critical",
      message: `total consumed abs cannot exceed entry qty. consumed=${totalConsumedAbs} entry=${entryQtyAbs}`,
    });
  }
  if (
    Number.isFinite(entryQtyAbs)
    && Number.isFinite(totalConsumedAbs)
    && Number.isFinite(runnerRemainingAbs)
    && Math.abs((totalConsumedAbs + runnerRemainingAbs) - entryQtyAbs) > absTolerance
  ) {
    issues.push({
      code: "RUNNER_REMAINING_ABS_MISMATCH",
      severity: "critical",
      message: `runner remaining abs must complement consumed abs. observed=${totalConsumedAbs + runnerRemainingAbs} entry=${entryQtyAbs}`,
    });
  }
  if (Number.isFinite(runnerRemainingRatio) && runnerRemainingRatio < -ratioTolerance) {
    issues.push({
      code: "RUNNER_REMAINING_NEGATIVE",
      severity: "critical",
      message: `runner remaining ratio cannot be negative. observed=${runnerRemainingRatio}`,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
    issues,
    blocked: issues.some((issue) => issue.severity === "critical"),
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

function resolveCanonicalAlertExitStage({
  primaryTransitionEvent = null,
  transitionEvents = null,
  fallbackStage = null,
} = {}) {
  const events = Array.isArray(transitionEvents)
    ? transitionEvents.map((item) => normalizeTransitionEvent(item)).filter(Boolean)
    : [];
  const primary = normalizeTransitionEvent(primaryTransitionEvent);
  const ordered = primary ? [primary, ...events.filter((item) => item !== primary)] : events;

  if (ordered.includes("TRAIL_FINAL_EXIT") || ordered.includes("TRAIL_PARTIAL")) return "TRAIL";
  if (ordered.includes("TP1_REACHED")) return "TP1";
  if (ordered.includes("TP0_REACHED")) return "TP0";
  if (ordered.includes("TRAIL_ACTIVE") || ordered.includes("TRAIL_ACTIVATED")) return "TRAIL";
  return null;
}

function resolveCanonicalPositionExitStage({
  positionSnapshot = null,
  fallbackStage = null,
} = {}) {
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const meta = snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
  const fallback = normalizeExitStage(
    fallbackStage
    || meta.authoritative_exit_stage
    || meta.canonical_exit_stage
  );
  if (snapshot.trail_active === true) {
    return {
      stage: "TRAIL",
      source: "POSITION_STATE_MACHINE_TRAIL_ACTIVE",
    };
  }
  if (snapshot.tp_p1_done === true) {
    return {
      stage: "TP1",
      source: "POSITION_STATE_MACHINE_TP1_DONE",
    };
  }
  if (snapshot.tp_p0_done === true) {
    return {
      stage: "TP0",
      source: "POSITION_STATE_MACHINE_TP0_DONE",
    };
  }
  if (fallback && fallback !== "OTHER" && fallback !== "OTHER_EXIT") {
    return { stage: fallback, source: "POSITION_STATE_MACHINE_CANONICAL_META" };
  }
  return { stage: null, source: null };
}

function resolveCanonicalExitStageFromCycleEvidence({
  cycleTrades = null,
  positionQty = null,
  tp0QtyRatio = 0.25,
  tp1QtyRatio = 0.5,
} = {}) {
  if (!Array.isArray(cycleTrades) || cycleTrades.length === 0) {
    return { stage: "UNKNOWN", reason: "CYCLE_EMPTY" };
  }
  const entries = cycleTrades.filter((trade) => Number(trade && trade.signedQty) > 0);
  const exits = cycleTrades.filter((trade) => Number(trade && trade.signedQty) < 0);
  const totalEntryQty = entries.reduce((sum, trade) => sum + (toNum(trade && trade.qty) || 0), 0);
  const remainingQty = toNum(positionQty);
  if (!Number.isFinite(totalEntryQty) || totalEntryQty <= 0 || !Number.isFinite(remainingQty) || remainingQty <= 0) {
    return { stage: "UNKNOWN", reason: "QTY_INVALID" };
  }
  const remainingRatio = remainingQty / totalEntryQty;
  const tp0RemainingRatio = Math.max(0, 1 - (toNum(tp0QtyRatio) ?? 0.25));
  const tp1AbsRatio = resolveExitStageAbsoluteContractQtyRatio("TP1", {
    TP_P0_QTY: tp0QtyRatio,
    TP_P1_QTY: tp1QtyRatio,
  }) ?? 0.375;
  const trailRemainingRatio = Math.max(0, 1 - ((toNum(tp0QtyRatio) ?? 0.25) + tp1AbsRatio));
  if (exits.length >= 2 && Math.abs(remainingRatio - trailRemainingRatio) <= 0.04) {
    return { stage: "TRAIL", entries, exits, totalEntryQty, remainingQty, remainingRatio, expectedAfterTp1: trailRemainingRatio };
  }
  if (exits.length >= 1 && Math.abs(remainingRatio - tp0RemainingRatio) <= 0.04) {
    return { stage: "TP0", entries, exits, totalEntryQty, remainingQty, remainingRatio, expectedAfterTp0: tp0RemainingRatio };
  }
  return {
    stage: "UNKNOWN",
    entries,
    exits,
    totalEntryQty,
    remainingQty,
    remainingRatio,
    expectedAfterTp0: tp0RemainingRatio,
    expectedAfterTp1: trailRemainingRatio,
  };
}

function resolveCanonicalExitWritePayload({
  exchange,
  symbol,
  event = null,
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
  const rawEvent = toUpper(event, null);
  const rawStage = normalizeExitStage(currentStage || classifyExitEventStage(rawEvent));
  const decision = resolveCanonicalExitAuthorityDecision({
    exchange,
    symbol,
    currentStage: rawStage,
    chainKey,
    entryEventId,
    signalDocId,
    orderMeta,
    positionSnapshot,
    authorityState,
    recentStages,
    rules,
    observedQtyRatio,
    fullExit,
  });
  return {
    rawEvent,
    rawStage,
    event: buildCanonicalExitEvent({
      stage: decision.stage,
      rules,
      fallbackEvent: decision.stage === rawStage ? rawEvent : null,
    }) || rawEvent,
    stage: decision.stage,
    chainKey: decision.chainKey,
    reason: decision.reason,
    stageRelocked: decision.stageRelocked === true,
    ledgerBlockedInvariant: decision.ledgerBlockedInvariant === true,
    blockedInvariant: decision.blockedInvariant === true,
    ledger: decision.ledger || null,
    ledgerValidation: decision.ledgerValidation || null,
    transitionEvents: Array.isArray(decision.transitionEvents) ? decision.transitionEvents : [],
    primaryTransitionEvent: decision.primaryTransitionEvent || null,
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
  const ledgerValidation = validateExitQuantityContractLedger({
    ledger,
    positionSnapshot: snapshot,
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

  const stageRelocked = resolvedStage !== stage && reason !== "PASS_THROUGH";
  const ledgerBlockedInvariant = ledgerValidation.blocked === true;
  const transition = ledgerBlockedInvariant
    ? { transitionEvents: [], primaryTransitionEvent: null }
    : resolveCanonicalExitTransitionEvents({
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
    stageRelocked,
    ledgerBlockedInvariant,
    blockedInvariant: stageRelocked || ledgerBlockedInvariant,
    ledger,
    ledgerValidation,
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
  resolveCanonicalAlertExitStage,
  resolveCanonicalPositionExitStage,
  resolveCanonicalExitStageFromCycleEvidence,
  resolveCanonicalExitWritePayload,
  buildExitQuantityContractLedger,
  validateExitQuantityContractLedger,
  buildCanonicalExitChainKey,
  buildCanonicalExitEvent,
  classifyExitEventStage,
  __test: {
    normalizeSnapshot,
    normalizeExitStage,
    normalizeTransitionEvent,
    resolveExitStageAbsoluteContractQtyRatio,
    resolveCanonicalExitAuthorityDecision,
    resolveCanonicalExitTransitionEvents,
    resolveCanonicalAlertExitStage,
    resolveCanonicalPositionExitStage,
    resolveCanonicalExitStageFromCycleEvidence,
    resolveCanonicalExitWritePayload,
    buildExitQuantityContractLedger,
    validateExitQuantityContractLedger,
    buildCanonicalExitChainKey,
    buildCanonicalExitEvent,
    classifyExitEventStage,
    ALLOWED_POSITION_STATE_TRANSITIONS,
  },
};
