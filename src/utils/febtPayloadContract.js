"use strict";

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function pick(obj, keys = []) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (!hasOwn(obj, key)) continue;
    const value = obj[key];
    if (value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "")) {
      return value;
    }
  }
  return null;
}

function toFiniteNumberOrNull(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseBooleanOrNull(raw) {
  if (raw === true || raw === false) return raw;
  if (raw === 1 || raw === "1") return true;
  if (raw === 0 || raw === "0") return false;
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["true", "t", "yes", "y", "on"].includes(s)) return true;
  if (["false", "f", "no", "n", "off"].includes(s)) return false;
  return null;
}

function normalizeString(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

const STRING_FIELDS = {
  febt_mode: ["febt_mode", "febtMode"],
  febt_phase: ["febt_phase", "febtPhase"],
  febt_calc_reason: ["febt_calc_reason", "febtCalcReason"],
  febt_timing_action: ["febt_timing_action", "febtTimingAction"],
  febt_authority: ["febt_authority", "febtAuthority"],
};

const BOOLEAN_FIELDS = {
  febt_calc_ok: ["febt_calc_ok", "febtCalcOk"],
  febt_state_valid: ["febt_state_valid", "febtStateValid"],
};

const NUMBER_FIELDS = {
  febt_lock_score: ["febt_lock_score", "febtLockScore"],
  febt_delay_cost: ["febt_delay_cost", "febtDelayCost"],
  febt_late_risk: ["febt_late_risk", "febtLateRisk"],
  febt_failure_risk: ["febt_failure_risk", "febtFailureRisk"],
  febt_edge: ["febt_edge", "febtEdge"],
  febt_same_dir_streak: ["febt_same_dir_streak", "febtSameDirStreak"],
  febt_recent_move_1_pct: ["febt_recent_move_1_pct", "febtRecentMove1Pct"],
  febt_recent_move_2_pct: ["febt_recent_move_2_pct", "febtRecentMove2Pct"],
  febt_break_retention: ["febt_break_retention", "febtBreakRetention"],
  febt_close_control: ["febt_close_control", "febtCloseControl"],
  febt_impulse_decay: ["febt_impulse_decay", "febtImpulseDecay"],
  febt_counter_rejection: ["febt_counter_rejection", "febtCounterRejection"],
  febt_micro_absorption: ["febt_micro_absorption", "febtMicroAbsorption"],
};

const CORE_FEBT_FIELDS = [
  "febt_mode",
  "febt_phase",
  "febt_calc_ok",
  "febt_calc_reason",
  "febt_timing_action",
  "febt_authority",
];

function hasFebtContract(features = {}) {
  return CORE_FEBT_FIELDS.some((key) => features[key] !== undefined && features[key] !== null && !(typeof features[key] === "string" && features[key].trim() === ""));
}

function mergeFebtPayloadContract({ payload = {}, features = {} } = {}) {
  const next = { ...(features && typeof features === "object" ? features : {}) };
  const backfilled = [];

  for (const [field, keys] of Object.entries(STRING_FIELDS)) {
    if (normalizeString(next[field])) continue;
    const value = normalizeString(pick(payload, keys));
    if (value != null) {
      next[field] = value;
      backfilled.push(field);
    }
  }

  for (const [field, keys] of Object.entries(BOOLEAN_FIELDS)) {
    if (typeof next[field] === "boolean") continue;
    const value = parseBooleanOrNull(pick(payload, keys));
    if (value !== null) {
      next[field] = value;
      backfilled.push(field);
    }
  }

  for (const [field, keys] of Object.entries(NUMBER_FIELDS)) {
    if (Number.isFinite(Number(next[field]))) continue;
    const value = toFiniteNumberOrNull(pick(payload, keys));
    if (value !== null) {
      next[field] = value;
      backfilled.push(field);
    }
  }

  const traceVersion = normalizeString(next.trace_payload_version)
    || normalizeString(pick(payload, ["trace_payload_version", "tracePayloadVersion"]));
  if (traceVersion && !next.trace_payload_version) next.trace_payload_version = traceVersion;
  if (traceVersion && /^TPTR_V2$/i.test(traceVersion) && !hasFebtContract(next)) {
    next._febt_trace_contract_missing = true;
    next._febt_trace_contract_version = traceVersion;
  }
  if (backfilled.length > 0) {
    next._febt_backfilled_from_top_level = true;
    next._febt_backfilled_fields = backfilled.slice();
  }

  return {
    features: next,
    backfilled_fields: backfilled,
    trace_contract_missing: next._febt_trace_contract_missing === true,
    febt_contract_present: hasFebtContract(next),
  };
}

module.exports = {
  mergeFebtPayloadContract,
  hasFebtContract,
  __test: {
    pick,
    toFiniteNumberOrNull,
    parseBooleanOrNull,
    normalizeString,
    CORE_FEBT_FIELDS,
  },
};
