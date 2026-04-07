const { getFirestore } = require("./firestore");
const { defaultMarketsFromEnv, defaultTfAllowlistFromEnv, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { normalizeProviderId, pickProviderEntry } = require("../utils/providerUtils");

let cache = {
  riskBudget: null,
  system: null,
  ai: null,
  exchanges: null,
  aiAllocation: null,
  aiGuard: null,
  fetchedAtMs: {
    riskBudget: 0,
    system: 0,
    ai: 0,
    aiAllocation: 0,
    exchanges: 0,
    aiGuard: 0,
  },
};

function nowMs() {
  return Date.now();
}

// normalizeProviderId / pickProviderEntry are centralized in providerUtils.

function mergeSystemSettings(base, override) {
  const out = { ...base };
  if (!override || typeof override !== "object") return out;
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function stripLegacyEvSettings(data = {}) {
  const out = { ...data };
  const legacyKeys = [
    "bar_context_gate_enabled",
    "bar_context_gate_core_enabled",
    "bar_context_gate_pre_real_enabled",
    "bar_context_gate_real_enabled",
    "bar_context_gate_early_enabled",
    "bar_context_gate_lookback_bars",
    "bar_context_gate_move_bars",
    "bar_context_gate_min_consecutive_bars",
    "bar_context_gate_max_move_pct",
    "bar_context_gate_max_move_range_mult",
    "ev_gate_gain_pct",
    "ev_gate_loss_pct",
    "ev_gate_cost_pct",
    "ev_gate_edge_min",
    "ev_gate_skip_missing_posterior",
  ];
  for (const key of legacyKeys) delete out[key];
  return out;
}

function applyGateAliasDefaults(data = {}) {
  const out = { ...data };
  const pairs = [
    ["gate_enabled", "short_gate_enabled", true],
    ["gate_trend_only", "short_gate_trend_only", true],
    ["gate_core_enabled", "short_gate_core_enabled", true],
    ["gate_pre_real_enabled", "short_gate_pre_real_enabled", false],
    ["gate_real_enabled", "short_gate_real_enabled", false],
    ["gate_early_enabled", "short_gate_early_enabled", false],
    ["gate_core_score_abs", "short_gate_core_score_abs", 35],
    ["gate_pre_real_score_abs", "short_gate_pre_real_score_abs", 40],
    ["gate_real_score_abs", "short_gate_real_score_abs", 45],
    ["gate_early_score_abs", "short_gate_early_score_abs", 25],
    ["gate_conf_min", "short_gate_conf_min", 0.55],
    ["gate_wave_conf_min", "short_gate_wave_conf_min", 0.6],
    ["gate_block_conflict", "short_gate_block_conflict", true],
  ];
  for (const [key, legacyKey, fallback] of pairs) {
    if (out[key] === undefined || out[key] === null || out[key] === "") {
      if (out[legacyKey] !== undefined && out[legacyKey] !== null && out[legacyKey] !== "") {
        out[key] = out[legacyKey];
      } else if (fallback !== null) {
        out[key] = fallback;
      }
    }
  }
  if (out.gate_transition_exception_enabled === undefined || out.gate_transition_exception_enabled === null || out.gate_transition_exception_enabled === "") {
    out.gate_transition_exception_enabled = true;
  }
  if (out.gate_transition_exception_core_enabled === undefined || out.gate_transition_exception_core_enabled === null || out.gate_transition_exception_core_enabled === "") {
    out.gate_transition_exception_core_enabled = true;
  }
  if (out.gate_transition_exception_pre_real_enabled === undefined || out.gate_transition_exception_pre_real_enabled === null || out.gate_transition_exception_pre_real_enabled === "") {
    out.gate_transition_exception_pre_real_enabled = false;
  }
  if (out.gate_transition_exception_real_enabled === undefined || out.gate_transition_exception_real_enabled === null || out.gate_transition_exception_real_enabled === "") {
    out.gate_transition_exception_real_enabled = false;
  }
  if (out.gate_transition_exception_early_enabled === undefined || out.gate_transition_exception_early_enabled === null || out.gate_transition_exception_early_enabled === "") {
    out.gate_transition_exception_early_enabled = false;
  }
  if (out.gate_transition_exception_score_abs === undefined || out.gate_transition_exception_score_abs === null || out.gate_transition_exception_score_abs === "") {
    out.gate_transition_exception_score_abs = 40;
  }
  if (out.gate_transition_exception_wave_conf_min === undefined || out.gate_transition_exception_wave_conf_min === null || out.gate_transition_exception_wave_conf_min === "") {
    out.gate_transition_exception_wave_conf_min = 0.6;
  }
  // Legacy mirrors are still populated for callers not yet migrated.
  out.short_gate_enabled = out.gate_enabled;
  out.short_gate_trend_only = out.gate_trend_only;
  out.short_gate_core_enabled = out.gate_core_enabled;
  out.short_gate_pre_real_enabled = out.gate_pre_real_enabled;
  out.short_gate_real_enabled = out.gate_real_enabled;
  out.short_gate_early_enabled = out.gate_early_enabled;
  out.short_gate_core_score_abs = out.gate_core_score_abs;
  out.short_gate_pre_real_score_abs = out.gate_pre_real_score_abs;
  out.short_gate_real_score_abs = out.gate_real_score_abs;
  out.short_gate_early_score_abs = out.gate_early_score_abs;
  out.short_gate_conf_min = out.gate_conf_min;
  out.short_gate_wave_conf_min = out.gate_wave_conf_min;
  out.short_gate_block_conflict = out.gate_block_conflict;
  return out;
}

function applyAiBiasDefaultsForProvider(data = {}, provider = "BINANCEFUT") {
  const out = { ...data };
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const defaultEnabled = p === "BINANCEFUT" || p === "BINANCE";
  if (out.ai_bias_gate_enabled === undefined || out.ai_bias_gate_enabled === null || out.ai_bias_gate_enabled === "") {
    out.ai_bias_gate_enabled = defaultEnabled;
  }
  if (!out.ai_bias_gate_neutral_policy) out.ai_bias_gate_neutral_policy = "allow";
  if (out.ai_bias_gate_score_threshold === undefined || out.ai_bias_gate_score_threshold === null || out.ai_bias_gate_score_threshold === "") {
    out.ai_bias_gate_score_threshold = 0.01;
  }
  if (out.ai_bias_gate_conf_min === undefined || out.ai_bias_gate_conf_min === null || out.ai_bias_gate_conf_min === "") {
    out.ai_bias_gate_conf_min = 0;
  }
  if (out.ai_bias_gate_core_enabled === undefined || out.ai_bias_gate_core_enabled === null || out.ai_bias_gate_core_enabled === "") {
    out.ai_bias_gate_core_enabled = true;
  }
  if (out.ai_bias_gate_pre_real_enabled === undefined || out.ai_bias_gate_pre_real_enabled === null || out.ai_bias_gate_pre_real_enabled === "") {
    out.ai_bias_gate_pre_real_enabled = false;
  }
  if (out.ai_bias_gate_real_enabled === undefined || out.ai_bias_gate_real_enabled === null || out.ai_bias_gate_real_enabled === "") {
    out.ai_bias_gate_real_enabled = false;
  }
  if (out.ai_bias_gate_early_enabled === undefined || out.ai_bias_gate_early_enabled === null || out.ai_bias_gate_early_enabled === "") {
    out.ai_bias_gate_early_enabled = false;
  }
  if (out.ai_bias_gate_emo_enabled === undefined || out.ai_bias_gate_emo_enabled === null || out.ai_bias_gate_emo_enabled === "") {
    out.ai_bias_gate_emo_enabled = false;
  }
  if (out.ai_bias_gate_neutral_mult === undefined || out.ai_bias_gate_neutral_mult === null || out.ai_bias_gate_neutral_mult === "") {
    out.ai_bias_gate_neutral_mult = 0.5;
  }
  if (out.ai_bias_gate_opposite_mult === undefined || out.ai_bias_gate_opposite_mult === null || out.ai_bias_gate_opposite_mult === "") {
    out.ai_bias_gate_opposite_mult = 0.35;
  }
  if (out.ai_bias_gate_strong_opposite_score === undefined || out.ai_bias_gate_strong_opposite_score === null || out.ai_bias_gate_strong_opposite_score === "") {
    out.ai_bias_gate_strong_opposite_score = 0.2;
  }
  if (out.ai_bias_gate_strong_opposite_conf === undefined || out.ai_bias_gate_strong_opposite_conf === null || out.ai_bias_gate_strong_opposite_conf === "") {
    out.ai_bias_gate_strong_opposite_conf = 0.55;
  }
  return out;
}

function applyAiMissingDefaultsForProvider(data = {}, provider = "BINANCEFUT") {
  const out = { ...data };
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const defaultPolicy = p === "BINANCEFUT" || p === "BINANCE" ? "ALLOW" : "ALLOW";
  const rawPolicy = String(out.ai_missing_policy || "").trim().toUpperCase();
  out.ai_missing_policy = (rawPolicy === "ALLOW" || rawPolicy === "REDUCE" || rawPolicy === "BLOCK")
    ? rawPolicy
    : defaultPolicy;
  const rawReduce = Number(out.ai_missing_reduce_pct);
  out.ai_missing_reduce_pct = Number.isFinite(rawReduce)
    ? Math.min(1, Math.max(0, rawReduce))
    : 0.5;
  return out;
}

function applyEvGateDefaultsForProvider(data = {}, provider = "BINANCEFUT") {
  const out = { ...data };
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const defaultEnabled = p === "BINANCEFUT" || p === "BINANCE";
  if (out.ev_gate_enabled === undefined || out.ev_gate_enabled === null || out.ev_gate_enabled === "") out.ev_gate_enabled = defaultEnabled;
  if (out.ev_gate_core_enabled === undefined || out.ev_gate_core_enabled === null || out.ev_gate_core_enabled === "") out.ev_gate_core_enabled = true;
  if (out.ev_gate_pre_real_enabled === undefined || out.ev_gate_pre_real_enabled === null || out.ev_gate_pre_real_enabled === "") out.ev_gate_pre_real_enabled = false;
  if (out.ev_gate_real_enabled === undefined || out.ev_gate_real_enabled === null || out.ev_gate_real_enabled === "") out.ev_gate_real_enabled = false;
  if (out.ev_gate_early_enabled === undefined || out.ev_gate_early_enabled === null || out.ev_gate_early_enabled === "") out.ev_gate_early_enabled = true;
  if (out.ev_gate_tp1_prob_min === undefined || out.ev_gate_tp1_prob_min === null || out.ev_gate_tp1_prob_min === "") out.ev_gate_tp1_prob_min = 0.55;
  if (out.ev_gate_tp1_prob_min_early === undefined || out.ev_gate_tp1_prob_min_early === null || out.ev_gate_tp1_prob_min_early === "") out.ev_gate_tp1_prob_min_early = out.ev_gate_tp1_prob_min;
  if (out.ev_gate_tp1_prob_min_core === undefined || out.ev_gate_tp1_prob_min_core === null || out.ev_gate_tp1_prob_min_core === "") out.ev_gate_tp1_prob_min_core = out.ev_gate_tp1_prob_min;
  if (out.ev_gate_tp1_prob_min_pre_real === undefined || out.ev_gate_tp1_prob_min_pre_real === null || out.ev_gate_tp1_prob_min_pre_real === "") out.ev_gate_tp1_prob_min_pre_real = out.ev_gate_tp1_prob_min;
  if (out.ev_gate_tp1_prob_min_real === undefined || out.ev_gate_tp1_prob_min_real === null || out.ev_gate_tp1_prob_min_real === "") out.ev_gate_tp1_prob_min_real = out.ev_gate_tp1_prob_min;
  const tp1ProbMinCandidates = [
    out.ev_gate_tp1_prob_min,
    out.ev_gate_tp1_prob_min_early,
    out.ev_gate_tp1_prob_min_core,
    out.ev_gate_tp1_prob_min_pre_real,
    out.ev_gate_tp1_prob_min_real,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (tp1ProbMinCandidates.length > 0) {
    const normalizedMin = Math.min(...tp1ProbMinCandidates);
    out.ev_gate_tp1_prob_min = normalizedMin;
    out.ev_gate_tp1_prob_min_early = Math.min(Number(out.ev_gate_tp1_prob_min_early), normalizedMin) || normalizedMin;
    out.ev_gate_tp1_prob_min_core = Math.min(Number(out.ev_gate_tp1_prob_min_core), normalizedMin) || normalizedMin;
    out.ev_gate_tp1_prob_min_pre_real = Math.min(Number(out.ev_gate_tp1_prob_min_pre_real), normalizedMin) || normalizedMin;
    out.ev_gate_tp1_prob_min_real = Math.min(Number(out.ev_gate_tp1_prob_min_real), normalizedMin) || normalizedMin;
  }
  if (out.ev_gate_tp1_prob_full === undefined || out.ev_gate_tp1_prob_full === null || out.ev_gate_tp1_prob_full === "") out.ev_gate_tp1_prob_full = 0.60;
  if (out.ev_gate_tp1_prob_kill === undefined || out.ev_gate_tp1_prob_kill === null || out.ev_gate_tp1_prob_kill === "") out.ev_gate_tp1_prob_kill = 0.50;
  out.ev_gate_tp1_prob_full = Math.max(Number(out.ev_gate_tp1_prob_min), Number(out.ev_gate_tp1_prob_full));
  out.ev_gate_tp1_prob_kill = Math.min(Number(out.ev_gate_tp1_prob_min), Number(out.ev_gate_tp1_prob_kill));
  if (out.ev_gate_qty_scale_mid === undefined || out.ev_gate_qty_scale_mid === null || out.ev_gate_qty_scale_mid === "") out.ev_gate_qty_scale_mid = 0.70;
  if (out.ev_gate_qty_scale_low === undefined || out.ev_gate_qty_scale_low === null || out.ev_gate_qty_scale_low === "") out.ev_gate_qty_scale_low = 0.40;
  if (out.ev_gate_lookback_bars === undefined || out.ev_gate_lookback_bars === null || out.ev_gate_lookback_bars === "") out.ev_gate_lookback_bars = 12;
  if (out.ev_gate_atr_bars === undefined || out.ev_gate_atr_bars === null || out.ev_gate_atr_bars === "") out.ev_gate_atr_bars = 8;
  if (out.ev_gate_default_tp1_pct === undefined || out.ev_gate_default_tp1_pct === null || out.ev_gate_default_tp1_pct === "") out.ev_gate_default_tp1_pct = 3.25;
  if (out.ev_gate_default_sl_pct === undefined || out.ev_gate_default_sl_pct === null || out.ev_gate_default_sl_pct === "") out.ev_gate_default_sl_pct = 1.65;
  if (out.ev_gate_skip_missing_bars === undefined || out.ev_gate_skip_missing_bars === null || out.ev_gate_skip_missing_bars === "") out.ev_gate_skip_missing_bars = true;
  if (out.ev_gate_unknown_gen_relax_enabled === undefined || out.ev_gate_unknown_gen_relax_enabled === null || out.ev_gate_unknown_gen_relax_enabled === "") out.ev_gate_unknown_gen_relax_enabled = false;
  if (out.ev_gate_unknown_gen_relax_tp1_prob_min_delta === undefined || out.ev_gate_unknown_gen_relax_tp1_prob_min_delta === null || out.ev_gate_unknown_gen_relax_tp1_prob_min_delta === "") out.ev_gate_unknown_gen_relax_tp1_prob_min_delta = 0.04;
  if (out.ev_gate_unknown_gen_relax_tp1_prob_full_delta === undefined || out.ev_gate_unknown_gen_relax_tp1_prob_full_delta === null || out.ev_gate_unknown_gen_relax_tp1_prob_full_delta === "") out.ev_gate_unknown_gen_relax_tp1_prob_full_delta = 0.03;
  if (out.ev_gate_unknown_gen_relax_tp1_prob_kill_delta === undefined || out.ev_gate_unknown_gen_relax_tp1_prob_kill_delta === null || out.ev_gate_unknown_gen_relax_tp1_prob_kill_delta === "") out.ev_gate_unknown_gen_relax_tp1_prob_kill_delta = 0.02;
  if (out.ev_gate_unknown_gen_relax_window_hours === undefined || out.ev_gate_unknown_gen_relax_window_hours === null || out.ev_gate_unknown_gen_relax_window_hours === "") out.ev_gate_unknown_gen_relax_window_hours = 6;
  if (out.ev_gate_unknown_gen_relax_review_after_hours === undefined || out.ev_gate_unknown_gen_relax_review_after_hours === null || out.ev_gate_unknown_gen_relax_review_after_hours === "") out.ev_gate_unknown_gen_relax_review_after_hours = 4;
  if (out.ev_gate_unknown_gen_relax_rollback_after_hours === undefined || out.ev_gate_unknown_gen_relax_rollback_after_hours === null || out.ev_gate_unknown_gen_relax_rollback_after_hours === "") out.ev_gate_unknown_gen_relax_rollback_after_hours = 4;
  if (out.ev_gate_unknown_gen_relax_started_at === undefined) out.ev_gate_unknown_gen_relax_started_at = null;
  if (out.wait_one_bar_enabled === undefined || out.wait_one_bar_enabled === null || out.wait_one_bar_enabled === "") out.wait_one_bar_enabled = defaultEnabled;
  if (out.wait_one_bar_core_enabled === undefined || out.wait_one_bar_core_enabled === null || out.wait_one_bar_core_enabled === "") out.wait_one_bar_core_enabled = true;
  if (out.wait_one_bar_pre_real_enabled === undefined || out.wait_one_bar_pre_real_enabled === null || out.wait_one_bar_pre_real_enabled === "") out.wait_one_bar_pre_real_enabled = false;
  if (out.wait_one_bar_real_enabled === undefined || out.wait_one_bar_real_enabled === null || out.wait_one_bar_real_enabled === "") out.wait_one_bar_real_enabled = false;
  if (out.wait_one_bar_early_enabled === undefined || out.wait_one_bar_early_enabled === null || out.wait_one_bar_early_enabled === "") out.wait_one_bar_early_enabled = true;
  if (out.wait_one_bar_same_dir_streak_min === undefined || out.wait_one_bar_same_dir_streak_min === null || out.wait_one_bar_same_dir_streak_min === "") out.wait_one_bar_same_dir_streak_min = 3;
  if (out.wait_one_bar_chase_ratio_min === undefined || out.wait_one_bar_chase_ratio_min === null || out.wait_one_bar_chase_ratio_min === "") out.wait_one_bar_chase_ratio_min = 1.75;
  if (out.wait_one_bar_last_close_control_min === undefined || out.wait_one_bar_last_close_control_min === null || out.wait_one_bar_last_close_control_min === "") out.wait_one_bar_last_close_control_min = 0.80;
  if (out.wait_one_bar_last_dir_body_min === undefined || out.wait_one_bar_last_dir_body_min === null || out.wait_one_bar_last_dir_body_min === "") out.wait_one_bar_last_dir_body_min = 0.45;
  if (out.wait_one_bar_last_opposite_wick_max === undefined || out.wait_one_bar_last_opposite_wick_max === null || out.wait_one_bar_last_opposite_wick_max === "") out.wait_one_bar_last_opposite_wick_max = 0.18;
  if (out.wait_one_bar_recent_move1_pct_min === undefined || out.wait_one_bar_recent_move1_pct_min === null || out.wait_one_bar_recent_move1_pct_min === "") out.wait_one_bar_recent_move1_pct_min = 0.45;
  if (out.wait_one_bar_counter_dir_bars_max === undefined || out.wait_one_bar_counter_dir_bars_max === null || out.wait_one_bar_counter_dir_bars_max === "") out.wait_one_bar_counter_dir_bars_max = 0;
  return out;
}

function normalizeCanonicalEngineSourceMode(raw, fallback = "PINE_PRIMARY") {
  const value = String(raw || "").trim().toUpperCase();
  if (value === "PINE_PRIMARY" || value === "SERVER_SHADOW" || value === "SERVER_PRIMARY") return value;
  return fallback;
}

function normalizeCanonicalEngineMarketOverrides(raw = null) {
  let source = raw;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch (_err) {
      return {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const out = {};
  for (const [market, value] of Object.entries(source)) {
    const key = String(market || "").trim().toUpperCase().replace(/\.P$/, "");
    if (!key) continue;
    const row = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : { core_score_abs: value };
    const normalized = {};
    if (row.enabled !== undefined) normalized.enabled = normalizeBool(row.enabled, true);
    if (row.shadow_enabled !== undefined) normalized.shadow_enabled = normalizeBool(row.shadow_enabled, true);
    if (row.source_mode !== undefined) normalized.source_mode = normalizeCanonicalEngineSourceMode(row.source_mode, "PINE_PRIMARY");
    const coreScoreAbs = Number(row.core_score_abs);
    const transitionCoreScoreAbs = Number(row.transition_core_score_abs);
    if (Number.isFinite(coreScoreAbs)) normalized.core_score_abs = Math.min(100, Math.max(0, coreScoreAbs));
    if (Number.isFinite(transitionCoreScoreAbs)) normalized.transition_core_score_abs = Math.min(100, Math.max(0, transitionCoreScoreAbs));
    if (Object.keys(normalized).length) out[key] = normalized;
  }
  return out;
}

function applyCanonicalEngineDefaultsForProvider(data = {}) {
  const out = { ...data };
  if (out.canonical_engine_enabled === undefined || out.canonical_engine_enabled === null || out.canonical_engine_enabled === "") {
    out.canonical_engine_enabled = true;
  }
  if (out.canonical_engine_shadow_enabled === undefined || out.canonical_engine_shadow_enabled === null || out.canonical_engine_shadow_enabled === "") {
    out.canonical_engine_shadow_enabled = true;
  }
  out.canonical_engine_source_mode = normalizeCanonicalEngineSourceMode(out.canonical_engine_source_mode, "PINE_PRIMARY");
  const coreScoreAbs = Number(out.canonical_engine_core_score_abs);
  out.canonical_engine_core_score_abs = Number.isFinite(coreScoreAbs) ? Math.min(100, Math.max(0, coreScoreAbs)) : 33;
  const transitionCoreScoreAbs = Number(out.canonical_engine_transition_core_score_abs);
  out.canonical_engine_transition_core_score_abs = Number.isFinite(transitionCoreScoreAbs) ? Math.min(100, Math.max(0, transitionCoreScoreAbs)) : 29;
  out.canonical_engine_market_overrides = normalizeCanonicalEngineMarketOverrides(out.canonical_engine_market_overrides);
  return out;
}

function applyReverseExceptionDefaultsForProvider(data = {}, provider = "BINANCEFUT") {
  const out = { ...data };
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const defaultEnabled = p === "BINANCEFUT" || p === "BINANCE";
  if (out.reverse_exception_enabled === undefined || out.reverse_exception_enabled === null || out.reverse_exception_enabled === "") {
    out.reverse_exception_enabled = defaultEnabled;
  }
  if (out.reverse_exception_drop_count_min === undefined || out.reverse_exception_drop_count_min === null || out.reverse_exception_drop_count_min === "") {
    out.reverse_exception_drop_count_min = 2;
  }
  if (out.reverse_exception_max_profit_pct === undefined || out.reverse_exception_max_profit_pct === null || out.reverse_exception_max_profit_pct === "") {
    out.reverse_exception_max_profit_pct =
      (out.reverse_exception_max_abs_pnl_pct === undefined || out.reverse_exception_max_abs_pnl_pct === null || out.reverse_exception_max_abs_pnl_pct === "")
        ? 1.5
        : out.reverse_exception_max_abs_pnl_pct;
  }
  if (out.reverse_exception_core_enabled === undefined || out.reverse_exception_core_enabled === null || out.reverse_exception_core_enabled === "") {
    out.reverse_exception_core_enabled = true;
  }
  if (out.reverse_exception_pre_real_enabled === undefined || out.reverse_exception_pre_real_enabled === null || out.reverse_exception_pre_real_enabled === "") {
    out.reverse_exception_pre_real_enabled = false;
  }
  if (out.reverse_exception_real_enabled === undefined || out.reverse_exception_real_enabled === null || out.reverse_exception_real_enabled === "") {
    out.reverse_exception_real_enabled = false;
  }
  if (out.reverse_exception_early_enabled === undefined || out.reverse_exception_early_enabled === null || out.reverse_exception_early_enabled === "") {
    out.reverse_exception_early_enabled = true;
  }
  return out;
}

function coerceBps(raw, fallback) {
  if (raw === "" || raw === null || raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function applyExecutionDefaults(provider, data = {}) {
  const p = normalizeProviderId(provider || data.provider || "BINANCEFUT");
  const defaults = (p === "BINANCEFUT")
    ? { fee_bps: 4, slippage_bps: 5, slippage_model: "FIXED" }
    : (p === "KIWOOM")
      ? { fee_bps: 5, slippage_bps: 10, slippage_model: "FIXED" }
      : { fee_bps: 5, slippage_bps: 10, slippage_model: "FIXED" };

  const out = { ...data };
  out.fee_bps = coerceBps(out.fee_bps, defaults.fee_bps);
  out.slippage_bps = coerceBps(out.slippage_bps, defaults.slippage_bps);
  if (!out.slippage_model || typeof out.slippage_model !== "string") {
    out.slippage_model = defaults.slippage_model;
  }
  return out;
}

async function getSettingsDocCached(key, ttlMs, fallback) {
  const t = nowMs();
  const cached = cache[key];
  const last = cache.fetchedAtMs[key] || 0;
  if (cached && (t - last) <= ttlMs) {
    return { ok: true, source: "cache", data: cached };
  }

  const db = getFirestore();
  const snap = await db.collection("settings").doc(key).get();
  const d = snap.exists ? (snap.data() || {}) : (fallback || null);
  cache[key] = d;
  cache.fetchedAtMs[key] = t;

  return { ok: true, source: "firestore", data: d };
}

async function getRiskBudgetCached(ttlMs = 30_000) {
  return getSettingsDocCached("risk_budget", ttlMs, null);
}

async function getSystemSettingsCached(ttlMs = 30_000) {
  const fallback = {
    scheduler_enabled: true,
    scheduler_interval_sec: 900,
    timezone: "Asia/Seoul",
    retry_max: 0,
    log_level: "INFO",
    alert_channel: "",
    data_retention_days: 30,
    auto_backfill_enabled: false,
    auto_backfill_days: 0,
    fee_bps: 0,
    slippage_bps: 0,
    slippage_model: "FIXED",
    slippage_bps_min: 0,
    slippage_bps_max: 0,
    slippage_volatility_factor: 0.1,
    fee_bps_by_market: {},
    slippage_bps_by_market: {},
    intent_ttl_ms: null,
    intent_ttl_bars: 2,
    execution_mode: "PAPER",
    phase0_paper_only: false,
    live_enabled: false,
    live_dry_run: false,
    live_min_order_krw: 5000,
    live_max_order_krw: 0,
    live_allowed_markets: [],
    live_confirm_required: true,
    reinvest_enabled: false,
    reinvest_ratio: 0.5,
    futures_leverage: 2,
    futures_margin_type: "ISOLATED",
    futures_exit_profile_mode: "BASE",
    signal_overlap_enabled: true,
    signal_overlap_bars: 2,
    signal_queue_enabled: true,
    signal_queue_max_late_bars: 1,
    tradeable_signal_types: [],
    binance_real_trading_enabled: false,
    force_all_signals_add: false,
    rescue_add_enabled: false,
    rescue_add_tiers: ["EARLY", "CORE"],
    rescue_add_sides: ["LONG", "SHORT"],
    rescue_add_size: 1.0,
    rescue_add_min_loss_pct: 0.1,
    rescue_add_max_loss_pct: 1.4,
    rescue_add_max_adds: 1,
    rescue_add_same_bar_block: true,
    rescue_add_pre_tp1_only: true,
    rescue_add_block_opposite_transition: true,
    rescue_add_min_stop_distance_pct: null,
    add_guard_enabled: true,
    add_guard_soft_drawdown_pct: -0.006,
    add_guard_hard_drawdown_pct: -0.016,
    add_guard_soft_scale: 0.6,
    add_guard_hard_scale: 0.35,
    add_guard_min_qty_fraction: 0.003,
    add_guard_max_loss_streak: 0,
    add_guard_day_loss_cap_krw: null,
    add_guard_block_hard_drawdown: true,
    same_direction_trail_profit_cooldown_enabled: false,
    same_direction_trail_profit_cooldown_ms: 4 * 60 * 60 * 1000,
    max_hold_bars: 12,
    opposite_signal_cooldown_bars: 3,
    opposite_transition_enabled: true,
    opposite_transition_reduce_fraction: 0.5,
    opposite_transition_confirm_bars: 2,
    opposite_transition_core_real_only: true,
    gate_enabled: true,
    gate_trend_only: true,
    gate_core_enabled: true,
    gate_pre_real_enabled: false,
    gate_real_enabled: false,
    gate_early_enabled: false,
    gate_core_score_abs: 35,
    canonical_engine_enabled: true,
    canonical_engine_shadow_enabled: true,
    canonical_engine_source_mode: "PINE_PRIMARY",
    canonical_engine_core_score_abs: 33,
    canonical_engine_transition_core_score_abs: 29,
    canonical_engine_market_overrides: {},
    gate_pre_real_score_abs: 40,
    gate_real_score_abs: 45,
    gate_early_score_abs: 25,
    gate_conf_min: 0.50,
    gate_wave_conf_min: 0.6,
    gate_block_conflict: true,
    ai_bias_gate_enabled: true,
    ai_bias_gate_neutral_policy: "allow",
    ai_bias_gate_score_threshold: 0.01,
    ai_bias_gate_conf_min: 0,
    ai_bias_gate_core_enabled: true,
    ai_bias_gate_pre_real_enabled: false,
    ai_bias_gate_real_enabled: false,
    ai_bias_gate_early_enabled: false,
    ai_bias_gate_emo_enabled: false,
    ai_bias_gate_neutral_mult: 0.5,
    ai_bias_gate_opposite_mult: 0.35,
    ai_bias_gate_strong_opposite_score: 0.2,
    ai_bias_gate_strong_opposite_conf: 0.55,
    ev_gate_enabled: true,
    ev_gate_core_enabled: true,
    ev_gate_pre_real_enabled: false,
    ev_gate_real_enabled: false,
    ev_gate_early_enabled: true,
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_min_early: 0.55,
    ev_gate_tp1_prob_min_core: 0.55,
    ev_gate_tp1_prob_min_pre_real: 0.55,
    ev_gate_tp1_prob_min_real: 0.55,
    ev_gate_tp1_prob_full: 0.60,
    ev_gate_tp1_prob_kill: 0.50,
    ev_gate_qty_scale_mid: 0.70,
    ev_gate_qty_scale_low: 0.40,
    ev_gate_lookback_bars: 12,
    ev_gate_atr_bars: 8,
    ev_gate_default_tp1_pct: 3.25,
    ev_gate_default_sl_pct: 1.65,
    ev_gate_skip_missing_bars: true,
    ev_gate_unknown_gen_relax_enabled: false,
    ev_gate_unknown_gen_relax_tp1_prob_min_delta: 0.04,
    ev_gate_unknown_gen_relax_tp1_prob_full_delta: 0.03,
    ev_gate_unknown_gen_relax_tp1_prob_kill_delta: 0.02,
    ev_gate_unknown_gen_relax_window_hours: 6,
    ev_gate_unknown_gen_relax_review_after_hours: 4,
    ev_gate_unknown_gen_relax_rollback_after_hours: 4,
    ev_gate_unknown_gen_relax_started_at: null,
    tp1_ladder_enabled: true,
    tp1_ladder_stage1_realized_n_min: 8,
    tp1_ladder_stage1_tp0_hit_rate_min: 0.55,
    tp1_ladder_stage1_tp0_to_tp1_conversion_min: 0.20,
    tp1_ladder_stage1_fee_adjusted_expectancy_min: -0.0005,
    tp1_ladder_stage2_realized_n_min: 16,
    tp1_ladder_stage2_tp0_hit_rate_min: 0.60,
    tp1_ladder_stage2_tp1_hit_rate_min: 0.30,
    tp1_ladder_stage2_tp0_to_tp1_conversion_min: 0.35,
    tp1_ladder_stage2_fee_adjusted_expectancy_min: 0,
    wait_one_bar_enabled: true,
    wait_one_bar_core_enabled: true,
    wait_one_bar_pre_real_enabled: false,
    wait_one_bar_real_enabled: false,
    wait_one_bar_early_enabled: true,
    wait_one_bar_same_dir_streak_min: 3,
    wait_one_bar_chase_ratio_min: 1.75,
    wait_one_bar_last_close_control_min: 0.80,
    wait_one_bar_last_dir_body_min: 0.45,
    wait_one_bar_last_opposite_wick_max: 0.18,
    wait_one_bar_recent_move1_pct_min: 0.45,
    wait_one_bar_counter_dir_bars_max: 0,
    reverse_exception_enabled: true,
    reverse_exception_drop_count_min: 1,
    reverse_exception_max_profit_pct: 3.0,
    reverse_exception_core_enabled: true,
    reverse_exception_pre_real_enabled: false,
    reverse_exception_real_enabled: false,
    reverse_exception_early_enabled: true,
    // Legacy mirrors
    short_gate_enabled: true,
    short_gate_trend_only: true,
    short_gate_core_enabled: true,
    short_gate_pre_real_enabled: false,
    short_gate_real_enabled: false,
    short_gate_early_enabled: false,
    short_gate_core_score_abs: 35,
    short_gate_pre_real_score_abs: 40,
    short_gate_real_score_abs: 45,
    short_gate_early_score_abs: 25,
    short_gate_conf_min: 0.50,
    short_gate_wave_conf_min: 0.6,
    short_gate_block_conflict: true,
    signal_spike_lock_enabled: true,
    signal_spike_tf: "15m",
    signal_spike_pct: 0.02,
    signal_spike_lock_bars: 2,
    auto_score_enabled: false,
    auto_score_freeze: false,
    auto_score_base: 0,
    auto_score_target_win_rate: 0.55,
    auto_score_delta_max: 0.05,
    auto_score_gain: 0.5,
    auto_score_min: 0,
    auto_score_max: 1,
    entry_immediate_core_conf_min: 0.65,
    entry_immediate_real_conf_min: 0.7,
    entry_immediate_wave_conf_min: 0.7,
  };
  return getSettingsDocCached("system", ttlMs, fallback);
}

async function getSystemSettingsForProvider(provider, ttlMs = 30_000) {
  const res = await getSystemSettingsCached(ttlMs);
  const base = res && res.data ? res.data : {};
  const target = normalizeProviderId(provider || base.provider || "BINANCEFUT");
  const providers = (base && typeof base.providers === "object") ? base.providers
    : ((base && typeof base.by_provider === "object") ? base.by_provider : null);
  const entry = pickProviderEntry(providers, target);
  const merged = stripLegacyEvSettings(mergeSystemSettings(base, entry));
  const withGateAlias = applyGateAliasDefaults(merged);
  const withAiMissingDefaults = applyAiMissingDefaultsForProvider(withGateAlias, target);
  const withAiDefaults = applyAiBiasDefaultsForProvider(withAiMissingDefaults, target);
  const withEvDefaults = applyEvGateDefaultsForProvider(withAiDefaults, target);
  const withCanonicalDefaults = applyCanonicalEngineDefaultsForProvider(withEvDefaults, target);
  const withReverseDefaults = applyReverseExceptionDefaultsForProvider(withCanonicalDefaults, target);
  const normalized = applyExecutionDefaults(target, withReverseDefaults);
  return {
    ok: true,
    source: res && res.source ? res.source : "unknown",
    provider: target,
    data: { ...normalized, provider: target },
  };
}

async function getAiSettingsCached(ttlMs = 30_000) {
  const fallback = {
    language: "ko",
    summary_length: "medium",
    report_emphasis: "EV",
    warnings_enabled: true,
    table_ratio: 60,
  };
  return getSettingsDocCached("ai", ttlMs, fallback);
}

async function getAiSettingsForProvider(provider, ttlMs = 30_000) {
  const res = await getAiSettingsCached(ttlMs);
  const base = res && res.data ? res.data : {};
  const target = normalizeProviderId(provider || base.provider || "BINANCEFUT");
  const providers = (base && typeof base.providers === "object") ? base.providers : null;
  const entry = pickProviderEntry(providers, target);
  const defaults = {
    language: "ko",
    summary_length: "medium",
    report_emphasis: "EV",
    warnings_enabled: true,
    table_ratio: 60,
  };
  const merged = entry ? { ...defaults, ...entry } : { ...defaults, ...base };
  return { ok: true, source: res && res.source ? res.source : "unknown", provider: target, data: { ...merged, provider: target } };
}

async function getAiAllocationSettingsCached(ttlMs = 30_000) {
  return getSettingsDocCached("ai_allocation", ttlMs, null);
}

async function getAiGuardSettingsCached(ttlMs = 30_000) {
  return getSettingsDocCached("ai_guard", ttlMs, null);
}

async function getAiAllocationSettingsForProvider(provider, ttlMs = 30_000) {
  const res = await getAiAllocationSettingsCached(ttlMs);
  const base = res && res.data ? res.data : {};
  const target = normalizeProviderId(provider || base.provider || "BINANCEFUT");
  const providers = (base && typeof base.providers === "object") ? base.providers : null;
  const entry = pickProviderEntry(providers, target);
  const merged = entry ? { ...base, ...entry } : { ...base };
  return { ok: true, source: res && res.source ? res.source : "unknown", provider: target, data: { ...merged, provider: target } };
}

async function getExchangesSettingsCached(ttlMs = 30_000) {
  const fallback = {
    provider: "BINANCEFUT",
    enabled: true,
    markets: defaultMarketsFromEnv(),
    tf_allowlist: defaultTfAllowlistFromEnv(),
    exec_tf: defaultExecTfFromEnv(),
  };
  return getSettingsDocCached("exchanges", ttlMs, fallback);
}

function invalidateRiskBudgetCache() {
  cache.riskBudget = null;
  cache.fetchedAtMs.riskBudget = 0;
}

function invalidateSettingsCache(key) {
  if (!key) return;
  if (cache[key] !== undefined) cache[key] = null;
  if (cache.fetchedAtMs[key] !== undefined) cache.fetchedAtMs[key] = 0;
}

module.exports = {
  getRiskBudgetCached,
  getSystemSettingsCached,
  getSystemSettingsForProvider,
  getAiSettingsCached,
  getAiSettingsForProvider,
  getAiAllocationSettingsCached,
  getAiAllocationSettingsForProvider,
  getAiGuardSettingsCached,
  getExchangesSettingsCached,
  invalidateRiskBudgetCache,
  invalidateSettingsCache,
  __test: {
    applyEvGateDefaultsForProvider,
  },
};
