"use strict";

const toBool = (v, def = false) => {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (!s) return def;
  return ["1", "true", "yes", "y", "on"].includes(s);
};

const toNum = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: toNum(process.env.PORT, 3000),
  baseUrl: process.env.BASE_URL || "http://localhost:3000",

  scheduler: {
    token: process.env.SCHEDULER_TOKEN || "",
    pollMs: toNum(process.env.SCHEDULER_POLL_MS, 300000),
    graceMs: toNum(process.env.SCHEDULER_GRACE_MS, 15000),
    autostart: toBool(process.env.SCHEDULER_AUTOSTART, false),
  },

  auto: {
    weeklyClose: toBool(process.env.AUTO_WEEKLY_CLOSE, false),
    weeklyCloseCheckMs: toNum(process.env.AUTO_WEEKLY_CLOSE_CHECK_MS, 60 * 60 * 1000),
    weeklyCloseWindowMin: toNum(process.env.AUTO_WEEKLY_CLOSE_WINDOW_MIN, 5),
    weeklyCloseWindowMax: toNum(process.env.AUTO_WEEKLY_CLOSE_WINDOW_MAX, 25),
    evalLatest: toBool(process.env.AUTO_EVAL_LATEST, true),
    evalLatestCheckMs: toNum(process.env.AUTO_EVAL_LATEST_CHECK_MS, 6 * 60 * 60 * 1000),
    evalLatestMaxAgeMs: toNum(process.env.AUTO_EVAL_LATEST_MAX_AGE_MS, 24 * 60 * 60 * 1000),
    selfEvolution: toBool(process.env.AUTO_SELF_EVOLUTION, false),
    selfEvolutionCheckMs: toNum(process.env.AUTO_SELF_EVOLUTION_CHECK_MS, 15 * 60 * 1000),
    selfEvolutionMaxAgeMs: toNum(process.env.AUTO_SELF_EVOLUTION_MAX_AGE_MS, 4 * 60 * 60 * 1000),
    selfEvolutionLockStaleMs: toNum(process.env.AUTO_SELF_EVOLUTION_LOCK_STALE_MS, 2 * 60 * 60 * 1000),
    aiAllocation: toBool(process.env.AUTO_AI_ALLOCATION, false),
    aiAllocationCheckMs: toNum(process.env.AUTO_AI_ALLOCATION_CHECK_MS, 12 * 60 * 60 * 1000),
  },

  paper: {
    enabled: toBool(process.env.PAPER_TRADING || process.env.PAPER_ENABLED || "1", true),
    maxKrw: toNum(process.env.PAPER_MAX_KRW, 100000),
    rules: (process.env.PAPER_RULES || "R1_BASE")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  fees: {
    bps: toNum(process.env.FEE_BPS, 5),
    slippageBps: toNum(process.env.SLIPPAGE_BPS, 10),
  },

  gate: {
    maxLagMs: toNum(process.env.MAX_LAG_MS, 360000),
    barsLimit: toNum(process.env.GATE_BARS_LIMIT, 200),
    minStableBars: toNum(process.env.MIN_STABLE_BARS, 1),
  },

  webhook: {
    token: process.env.WEBHOOK_TOKEN || "",
  },

  reinvest: {
    bootLimit: toNum(process.env.REINVEST_BOOT_LIMIT, 5000),
    scanLimit: toNum(process.env.REINVEST_SCAN_LIMIT, 600),
  },

  bars: {
    snapshotRefresh: toBool(process.env.BARS_SNAPSHOT_REFRESH, true),
    snapshotRefreshCount: toNum(process.env.BARS_SNAPSHOT_REFRESH_COUNT, 3),
    exitBackfillEnabled: toBool(process.env.EXIT_BACKFILL_ENABLED, true),
    exitBackfillMaxBars: toNum(process.env.EXIT_BACKFILL_MAX_BARS, 12),
    exitBackfillAllowEntryBars: toNum(process.env.EXIT_BACKFILL_ALLOW_ENTRY_BARS, 0),
  },

  tickExit: {
    enabled: toBool(process.env.TICK_EXIT_ENABLED, false),
    intervalMs: toNum(process.env.TICK_EXIT_INTERVAL_MS, 5000),
    symbolCooldownMs: toNum(process.env.TICK_EXIT_SYMBOL_COOLDOWN_MS, 10000),
    nearPct: toNum(process.env.TICK_EXIT_NEAR_PCT, 0.006),
    fastLaneEnabled: toBool(process.env.TICK_EXIT_FASTLANE_ENABLED, true),
    fastLaneIntervalMs: toNum(process.env.TICK_EXIT_FASTLANE_INTERVAL_MS, 1000),
    fastLanePct: toNum(process.env.TICK_EXIT_FASTLANE_PCT, 0.003),
  },

  signals: {
    fallbackScanLimit: toNum(process.env.SIGNALS_FALLBACK_SCAN_LIMIT, 500),
    fallbackMaxCallsPerMin: toNum(process.env.SIGNALS_FALLBACK_MAX_CALLS_PER_MIN, 30),
    fallbackCooldownMs: toNum(process.env.SIGNALS_FALLBACK_COOLDOWN_MS, 900000),
    fallbackAlertMinIntervalMs: toNum(process.env.SIGNALS_FALLBACK_ALERT_MIN_INTERVAL_MS, 300000),
    fallbackForceOpen: toBool(process.env.SIGNALS_FALLBACK_FORCE_OPEN, false),
  },

  allowReplaySameBar: toBool(process.env.ALLOW_REPLAY_SAME_BAR, false),
};
