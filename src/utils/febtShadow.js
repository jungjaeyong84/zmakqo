"use strict";

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v) {
  if (v === true || v === false) return v;
  const raw = String(v || "").trim().toUpperCase();
  if (!raw) return null;
  if (["TRUE", "1", "YES", "Y", "ON"].includes(raw)) return true;
  if (["FALSE", "0", "NO", "N", "OFF"].includes(raw)) return false;
  return null;
}

function featuresOf(input) {
  if (input && input.features_json && typeof input.features_json === "object") return input.features_json;
  if (input && input.features && typeof input.features === "object") return input.features;
  if (input && typeof input === "object") return input;
  return {};
}

function normalizeEnum(raw, allowed, fallback = null) {
  const value = String(raw || "").trim().toUpperCase();
  if (!value) return fallback;
  return allowed.includes(value) ? value : fallback;
}

function normalizeLegacyWaitAction(raw) {
  return normalizeEnum(raw, ["ALLOW", "WAIT_ONE_BAR", "SKIP"], "UNKNOWN");
}

function normalizeLegacyWaitTriggerPath(raw) {
  return normalizeEnum(raw, ["BASE", "PHYSICS_ASSIST", "PHYSICS_HARD", "UNKNOWN"], "UNKNOWN");
}

function resolveFebtShadowVerdict(shadow = {}) {
  if (!shadow || shadow.payloadMissing === true) {
    return { verdict: "LEGACY_FALLBACK", fallbackToLegacy: true, fallbackReason: "PAYLOAD_MISSING" };
  }
  if (shadow.calcOk !== true) {
    return {
      verdict: "LEGACY_FALLBACK",
      fallbackToLegacy: true,
      fallbackReason: shadow.calcReason || "CALC_FAIL",
    };
  }
  if (shadow.phase === "FIRE") {
    return { verdict: "ALLOW_CANDIDATE", fallbackToLegacy: false, fallbackReason: "NONE" };
  }
  if (shadow.phase === "PREPARE" || shadow.phase === "ARMED") {
    return { verdict: "WAIT_CANDIDATE", fallbackToLegacy: false, fallbackReason: "NONE" };
  }
  if (shadow.phase === "LATE" || shadow.phase === "VOID") {
    return { verdict: "BLOCK_CANDIDATE", fallbackToLegacy: false, fallbackReason: "NONE" };
  }
  return {
    verdict: "LEGACY_FALLBACK",
    fallbackToLegacy: true,
    fallbackReason: shadow.phase === "UNKNOWN" ? "UNKNOWN_PHASE" : "PHASE_UNMAPPED",
  };
}

function buildFebtLegacyWaitComparison({ input = {}, legacyWaitAction = null, legacyWaitTriggerPath = null } = {}) {
  const shadow = resolveFebtShadow(input);
  const legacyAction = normalizeLegacyWaitAction(legacyWaitAction);
  const legacyTrigger = normalizeLegacyWaitTriggerPath(legacyWaitTriggerPath);
  const verdict = resolveFebtShadowVerdict(shadow);

  let disagrees = false;
  let disagreementReason = "NONE";
  if (!verdict.fallbackToLegacy) {
    if (legacyAction === "ALLOW" && verdict.verdict === "WAIT_CANDIDATE") {
      disagrees = true;
      disagreementReason = "FEBT_WAIT_LEGACY_ALLOW";
    } else if (legacyAction === "ALLOW" && verdict.verdict === "BLOCK_CANDIDATE") {
      disagrees = true;
      disagreementReason = "FEBT_BLOCK_LEGACY_ALLOW";
    } else if (legacyAction === "WAIT_ONE_BAR" && verdict.verdict === "ALLOW_CANDIDATE") {
      disagrees = true;
      disagreementReason = "FEBT_ALLOW_LEGACY_WAIT";
    } else if (legacyAction === "WAIT_ONE_BAR" && verdict.verdict === "BLOCK_CANDIDATE") {
      disagrees = true;
      disagreementReason = "FEBT_BLOCK_LEGACY_WAIT";
    } else if (legacyAction === "SKIP" && verdict.verdict !== "LEGACY_FALLBACK") {
      disagreementReason = "LEGACY_SKIP";
    }
  }

  return {
    febt_shadow_verdict: verdict.verdict,
    febt_shadow_fallback_to_legacy: verdict.fallbackToLegacy === true,
    febt_shadow_fallback_reason: verdict.fallbackReason,
    febt_shadow_disagrees_legacy_wait: disagrees,
    febt_shadow_disagreement_reason: disagreementReason,
    febt_shadow_legacy_wait_action: legacyAction,
    febt_shadow_legacy_wait_trigger_path: legacyTrigger,
  };
}

function resolveFebtShadow(input = {}) {
  const f = featuresOf(input);
  const mode = normalizeEnum(f.febt_mode, ["OFF", "SHADOW", "SOFT", "HARD"], null);
  const phase = normalizeEnum(f.febt_phase, ["PREPARE", "ARMED", "FIRE", "LATE", "VOID", "UNKNOWN"], null);
  const calcReason = normalizeEnum(
    f.febt_calc_reason,
    ["OK", "OFF", "SIDE_UNKNOWN", "MISSING_INPUT", "DIV_BY_ZERO_GUARD", "SHADOW_FAILSAFE"],
    null
  );
  const timingAction = normalizeEnum(
    f.febt_timing_action,
    ["OBSERVE", "PASS", "DEFER_HINT", "LATE_WARN", "BLOCK_CANDIDATE", "NO_OP"],
    null
  );
  const authority = normalizeEnum(
    f.febt_authority,
    ["SHADOW_ONLY", "TIMING_ADVISORY", "WAIT_PRIMARY"],
    null
  );
  const stateValid = toBool(f.febt_state_valid);
  const calcOk = toBool(f.febt_calc_ok);
  const lockScore = toNum(f.febt_lock_score);
  const delayCost = toNum(f.febt_delay_cost);
  const lateRisk = toNum(f.febt_late_risk);
  const failureRisk = toNum(f.febt_failure_risk);
  const edge = toNum(f.febt_edge);
  const sameDirStreak = toNum(f.febt_same_dir_streak);
  const recentMove1Pct = toNum(f.febt_recent_move_1_pct);
  const recentMove2Pct = toNum(f.febt_recent_move_2_pct);
  const breakRetention = toNum(f.febt_break_retention);
  const closeControl = toNum(f.febt_close_control);
  const impulseDecay = toNum(f.febt_impulse_decay);
  const counterRejection = toNum(f.febt_counter_rejection);
  const microAbsorption = toNum(f.febt_micro_absorption);
  const payloadPresent = [
    mode,
    phase,
    calcReason,
    timingAction,
    authority,
    stateValid,
    calcOk,
    lockScore,
    delayCost,
    lateRisk,
    failureRisk,
    edge,
  ].some((x) => x !== null && x !== undefined);

  return {
    mode,
    phase,
    calcReason,
    timingAction,
    authority,
    stateValid,
    calcOk,
    lockScore,
    delayCost,
    lateRisk,
    failureRisk,
    edge,
    sameDirStreak,
    recentMove1Pct,
    recentMove2Pct,
    breakRetention,
    closeControl,
    impulseDecay,
    counterRejection,
    microAbsorption,
    payloadMissing: !payloadPresent,
  };
}

module.exports = {
  resolveFebtShadow,
  buildFebtLegacyWaitComparison,
  __test: {
    toNum,
    toBool,
    normalizeEnum,
    normalizeLegacyWaitAction,
    normalizeLegacyWaitTriggerPath,
    resolveFebtShadowVerdict,
  },
};
