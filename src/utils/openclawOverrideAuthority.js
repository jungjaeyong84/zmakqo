"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampIntEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = toNum(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumEnv(name, fallback, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const value = toNum(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function stableSignature(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map((item) => stableSignature(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSignature(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeBounds() {
  return {
    max_market_overrides_per_cycle: clampIntEnv("OPENCLAW_MAX_MARKET_OVERRIDES_PER_CYCLE", 2, 1, 10),
    ev_gate_tp1_prob_min_step_max: clampNumEnv("OPENCLAW_EV_GATE_TP1_PROB_MIN_STEP_MAX", 0.02, 0.001, 0.1),
    ev_gate_tp1_prob_full_step_max: clampNumEnv("OPENCLAW_EV_GATE_TP1_PROB_FULL_STEP_MAX", 0.02, 0.001, 0.1),
    ev_gate_tp1_prob_kill_step_max: clampNumEnv("OPENCLAW_EV_GATE_TP1_PROB_KILL_STEP_MAX", 0.01, 0.001, 0.1),
    ev_gate_qty_scale_step_max: clampNumEnv("OPENCLAW_EV_GATE_QTY_SCALE_STEP_MAX", 0.10, 0.01, 0.5),
    wait_same_dir_streak_step_max: clampIntEnv("OPENCLAW_WAIT_SAME_DIR_STREAK_STEP_MAX", 1, 1, 3),
    wait_chase_ratio_step_max: clampNumEnv("OPENCLAW_WAIT_CHASE_RATIO_STEP_MAX", 0.20, 0.01, 1),
    wait_last_close_control_step_max: clampNumEnv("OPENCLAW_WAIT_LAST_CLOSE_CONTROL_STEP_MAX", 0.08, 0.01, 0.3),
    wait_last_dir_body_step_max: clampNumEnv("OPENCLAW_WAIT_LAST_DIR_BODY_STEP_MAX", 0.10, 0.01, 0.3),
    wait_last_opposite_wick_step_max: clampNumEnv("OPENCLAW_WAIT_LAST_OPPOSITE_WICK_STEP_MAX", 0.08, 0.01, 0.3),
    wait_recent_move1_pct_step_max: clampNumEnv("OPENCLAW_WAIT_RECENT_MOVE1_PCT_STEP_MAX", 0.20, 0.01, 1),
    wait_counter_dir_bars_step_max: clampIntEnv("OPENCLAW_WAIT_COUNTER_DIR_BARS_STEP_MAX", 1, 1, 3),
    risk_override_enabled: String(process.env.OPENCLAW_RISK_OVERRIDE_ENABLED || "").trim() === "1",
  };
}

function collectPriorityMarkets({ marketObjectiveScore = null, serverVsPinePerformanceDelta = null, dropValidation = null } = {}) {
  const scores = new Map();
  const addScore = (market, score, reason) => {
    const key = String(market || "").trim().toUpperCase();
    if (!key) return;
    const current = scores.get(key) || { market: key, score: 0, reasons: [] };
    current.score += Number.isFinite(score) ? score : 0;
    if (reason) current.reasons.push(reason);
    scores.set(key, current);
  };

  const marketObjectiveSummary = readSummary(marketObjectiveScore);
  const recoveryRows = Array.isArray(marketObjectiveSummary.top_recovery_markets) ? marketObjectiveSummary.top_recovery_markets : [];
  for (const row of recoveryRows.slice(0, 5)) addScore(row && row.market, 3, "MARKET_OBJECTIVE_RECOVERY");
  const dragRows = Array.isArray(marketObjectiveSummary.top_drag_markets) ? marketObjectiveSummary.top_drag_markets : [];
  for (const row of dragRows.slice(0, 5)) addScore(row && row.market, 1, "MARKET_OBJECTIVE_DRAG");

  const deltaSummary = readSummary(serverVsPinePerformanceDelta);
  const shadowGapRows = Array.isArray(deltaSummary.top_shadow_gap_markets) ? deltaSummary.top_shadow_gap_markets : [];
  for (const row of shadowGapRows.slice(0, 5)) addScore(row && row.market, 2, "SERVER_VS_PINE_SHADOW_GAP");

  const dropSummary = readSummary(dropValidation);
  const watchRows = Array.isArray(dropSummary.top_watch_markets) ? dropSummary.top_watch_markets : [];
  for (const row of watchRows.slice(0, 5)) addScore(row && row.market, 2, "DROP_VALIDATION_WATCH");
  const rescueMarket = String(dropSummary.top_rescue_market || "").trim().toUpperCase();
  if (rescueMarket) addScore(rescueMarket, 3, "DROP_VALIDATION_TOP_RESCUE");

  return Array.from(scores.values())
    .sort((a, b) => (b.score - a.score) || a.market.localeCompare(b.market))
    .map((row) => ({ market: row.market, score: row.score, reasons: Array.from(new Set(row.reasons)) }));
}

function summarizeOpenclawOverrideAuthority({ currentSys = {}, marketObjectiveScore = null, serverVsPinePerformanceDelta = null, dropValidation = null } = {}) {
  const bounds = normalizeBounds();
  const priorityMarkets = collectPriorityMarkets({ marketObjectiveScore, serverVsPinePerformanceDelta, dropValidation });
  return {
    status: "BOUNDED_AUTHORITY_ACTIVE",
    risk_override_enabled: bounds.risk_override_enabled,
    max_market_overrides_per_cycle: bounds.max_market_overrides_per_cycle,
    bounds,
    priority_markets: priorityMarkets,
    top_priority_markets: priorityMarkets.slice(0, bounds.max_market_overrides_per_cycle),
    current_source_mode: String(currentSys && currentSys.canonical_engine_source_mode || "").trim().toUpperCase() || null,
  };
}

function computeMarketOverrideTouched({ currentSys = {}, nextSettings = {} } = {}) {
  const current = currentSys && currentSys.canonical_engine_market_overrides && typeof currentSys.canonical_engine_market_overrides === "object"
    ? currentSys.canonical_engine_market_overrides
    : {};
  const next = nextSettings && nextSettings.canonical_engine_market_overrides && typeof nextSettings.canonical_engine_market_overrides === "object"
    ? nextSettings.canonical_engine_market_overrides
    : {};
  const touched = [];
  for (const [market, nextRow] of Object.entries(next)) {
    const currentRow = current[market] && typeof current[market] === "object" ? current[market] : {};
    if (stableSignature(currentRow) !== stableSignature(nextRow || {})) touched.push(String(market || "").trim().toUpperCase());
  }
  return touched.filter(Boolean).sort();
}

function pushDeltaIfExceeded(blockers, key, before, after, limit) {
  const prev = toNum(before);
  const next = toNum(after);
  if (!Number.isFinite(prev) || !Number.isFinite(next) || !Number.isFinite(limit)) return;
  const delta = Math.abs(next - prev);
  if (delta > limit + 1e-9) blockers.push(`${key}_STEP_LIMIT_EXCEEDED`);
}

function evaluateOpenclawOverrideAuthority({ stage = null, currentSys = {}, nextSettings = {}, authoritySummary = null } = {}) {
  const summary = authoritySummary && typeof authoritySummary === "object" ? authoritySummary : summarizeOpenclawOverrideAuthority({ currentSys });
  const bounds = summary.bounds || normalizeBounds();
  const blockers = [];
  const touchedMarkets = computeMarketOverrideTouched({ currentSys, nextSettings });
  if (touchedMarkets.length > bounds.max_market_overrides_per_cycle) blockers.push("MARKET_OVERRIDE_LIMIT_EXCEEDED");

  const riskKeys = Object.keys(nextSettings || {}).filter((key) =>
    /^risk_/i.test(key)
    || /budget/i.test(key)
    || /exposure/i.test(key)
  );
  if (riskKeys.length && bounds.risk_override_enabled !== true) blockers.push("RISK_OVERRIDE_DISABLED");

  pushDeltaIfExceeded(blockers, "EV_GATE_TP1_PROB_MIN", currentSys && currentSys.ev_gate_tp1_prob_min, nextSettings && nextSettings.ev_gate_tp1_prob_min, bounds.ev_gate_tp1_prob_min_step_max);
  pushDeltaIfExceeded(blockers, "EV_GATE_TP1_PROB_FULL", currentSys && currentSys.ev_gate_tp1_prob_full, nextSettings && nextSettings.ev_gate_tp1_prob_full, bounds.ev_gate_tp1_prob_full_step_max);
  pushDeltaIfExceeded(blockers, "EV_GATE_TP1_PROB_KILL", currentSys && currentSys.ev_gate_tp1_prob_kill, nextSettings && nextSettings.ev_gate_tp1_prob_kill, bounds.ev_gate_tp1_prob_kill_step_max);
  pushDeltaIfExceeded(blockers, "EV_GATE_QTY_SCALE_MID", currentSys && currentSys.ev_gate_qty_scale_mid, nextSettings && nextSettings.ev_gate_qty_scale_mid, bounds.ev_gate_qty_scale_step_max);
  pushDeltaIfExceeded(blockers, "EV_GATE_QTY_SCALE_LOW", currentSys && currentSys.ev_gate_qty_scale_low, nextSettings && nextSettings.ev_gate_qty_scale_low, bounds.ev_gate_qty_scale_step_max);

  pushDeltaIfExceeded(blockers, "WAIT_ONE_BAR_SAME_DIR_STREAK", currentSys && currentSys.wait_one_bar_same_dir_streak_min, nextSettings && nextSettings.wait_one_bar_same_dir_streak_min, bounds.wait_same_dir_streak_step_max);
  pushDeltaIfExceeded(blockers, "WAIT_ONE_BAR_CHASE_RATIO", currentSys && currentSys.wait_one_bar_chase_ratio_min, nextSettings && nextSettings.wait_one_bar_chase_ratio_min, bounds.wait_chase_ratio_step_max);
  pushDeltaIfExceeded(blockers, "WAIT_ONE_BAR_LAST_CLOSE_CONTROL", currentSys && currentSys.wait_one_bar_last_close_control_min, nextSettings && nextSettings.wait_one_bar_last_close_control_min, bounds.wait_last_close_control_step_max);
  pushDeltaIfExceeded(blockers, "WAIT_ONE_BAR_LAST_DIR_BODY", currentSys && currentSys.wait_one_bar_last_dir_body_min, nextSettings && nextSettings.wait_one_bar_last_dir_body_min, bounds.wait_last_dir_body_step_max);
  pushDeltaIfExceeded(blockers, "WAIT_ONE_BAR_LAST_OPPOSITE_WICK", currentSys && currentSys.wait_one_bar_last_opposite_wick_max, nextSettings && nextSettings.wait_one_bar_last_opposite_wick_max, bounds.wait_last_opposite_wick_step_max);
  pushDeltaIfExceeded(blockers, "WAIT_ONE_BAR_RECENT_MOVE1_PCT", currentSys && currentSys.wait_one_bar_recent_move1_pct_min, nextSettings && nextSettings.wait_one_bar_recent_move1_pct_min, bounds.wait_recent_move1_pct_step_max);
  pushDeltaIfExceeded(blockers, "WAIT_ONE_BAR_COUNTER_DIR_BARS", currentSys && currentSys.wait_one_bar_counter_dir_bars_max, nextSettings && nextSettings.wait_one_bar_counter_dir_bars_max, bounds.wait_counter_dir_bars_step_max);

  return {
    allowed: blockers.length === 0,
    blockers,
    touched_markets: touchedMarkets,
    touched_market_n: touchedMarkets.length,
    top_priority_markets: Array.isArray(summary.top_priority_markets) ? summary.top_priority_markets : [],
    bounds,
    stage: String(stage || "").trim().toUpperCase() || null,
  };
}

module.exports = {
  summarizeOpenclawOverrideAuthority,
  evaluateOpenclawOverrideAuthority,
};
