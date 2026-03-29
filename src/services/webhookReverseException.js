const { normalizeProviderId } = require("../utils/providerUtils");
const { resolveEntryTimingTier } = require("../utils/liveEntryTaxonomy");
const { normalizePositionSide, sideToPositionDir } = require("../utils/positionSide");

function normalizeBool(v, fallback = false) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined || v === "") return fallback;
  const s = String(v || "").trim().toLowerCase();
  if (!s) return fallback;
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.trunc(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function normalizeReasonCode(raw) {
  return String(raw ?? "").trim().toUpperCase();
}

function isReverseDropReason(raw) {
  const code = normalizeReasonCode(raw);
  return code === "REVERSE_BLOCKED" || code === "REVERSE_COOLDOWN";
}

function isReverseExceptionTierEvent(event, cfg = {}) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  const tier = resolveEntryTimingTier(event);
  if (tier === "EARLY") return cfg.earlyEnabled === true;
  if (tier === "CORE") return cfg.coreEnabled === true;
  if (tier === "PRE_REAL" || tier === "REAL") return false;
  if (ev.startsWith("CORE_")) return cfg.coreEnabled === true;
  if (ev.startsWith("PRE_REAL_") || ev.startsWith("REAL_")) return false;
  if (ev.startsWith("EARLY_")) return cfg.earlyEnabled === true;
  return false;
}

function resolveReverseExceptionConfig(sysCfg = {}, exchange = "") {
  const provider = normalizeProviderId(exchange || "BINANCEFUT");
  const defaultEnabled = provider === "BINANCEFUT" || provider === "BINANCE";
  return {
    enabled: normalizeBool(sysCfg.reverse_exception_enabled, defaultEnabled),
    dropCountMin: clampInt(sysCfg.reverse_exception_drop_count_min, 1, 10, 2),
    maxProfitPct: (() => {
      const n = Number(
        sysCfg.reverse_exception_max_profit_pct ??
        sysCfg.reverse_exception_max_abs_pnl_pct
      );
      return Number.isFinite(n) && n > 0 ? n : 1.5;
    })(),
    coreEnabled: normalizeBool(sysCfg.reverse_exception_core_enabled, true),
    preRealEnabled: normalizeBool(sysCfg.reverse_exception_pre_real_enabled, false),
    realEnabled: normalizeBool(sysCfg.reverse_exception_real_enabled, false),
    earlyEnabled: normalizeBool(sysCfg.reverse_exception_early_enabled, false),
  };
}

function pickDropRawReason(row = {}) {
  const features = row && typeof row.features_json === "object" ? row.features_json : {};
  return normalizeReasonCode(
    features._reason_raw ??
    features._drop_reason_code ??
    row.drop_reason_code ??
    row.reason
  );
}

function summarizeOppositeReverseDrops({
  rows = [],
  exchange,
  symbol,
  tf,
  entryExecBarMs,
  incomingDir,
  currentSignalId = null,
  cfg = {},
} = {}) {
  const ex = String(exchange || "").toUpperCase();
  const sym = String(symbol || "").toUpperCase();
  const timeframe = String(tf || "");
  const dir = normalizePositionSide(incomingDir);
  const entryMs = Number(entryExecBarMs);
  const matches = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    if (String(row.exchange || "").toUpperCase() !== ex) continue;
    if (String(row.symbol_or_pair_id || row.symbol || "").toUpperCase() !== sym) continue;
    if (String(row.tf || "") !== timeframe) continue;
    if (currentSignalId && String(row.signal_id || "") === String(currentSignalId)) continue;
    const barMs = Number(row.bar_close_time_utc_ms);
    if (Number.isFinite(entryMs) && Number.isFinite(barMs) && barMs < entryMs) continue;
    const reverseCode = pickDropRawReason(row);
    if (!isReverseDropReason(reverseCode)) continue;
    if (!isReverseExceptionTierEvent(row.event, cfg)) continue;
    const rowDir = sideToPositionDir(row.side);
    if (dir && rowDir && rowDir !== dir) continue;
    matches.push({
      signal_id: row.signal_id || null,
      event: row.event || null,
      side: row.side || null,
      reason: row.reason || null,
      reverse_code: reverseCode,
      bar_close_time_utc_ms: Number.isFinite(barMs) ? barMs : null,
      created_at: row.created_at || null,
    });
  }
  matches.sort((a, b) => {
    const am = Number(a.bar_close_time_utc_ms || 0);
    const bm = Number(b.bar_close_time_utc_ms || 0);
    return bm - am;
  });
  return {
    count: matches.length,
    matches,
  };
}

function shouldReviveReverseDrop({
  cfg = {},
  reasonRaw,
  intentBeforeOverride,
  posSnap,
  event,
  side,
  priorDropCount = 0,
  effectivePnlPct = null,
} = {}) {
  const intentRaw = String(intentBeforeOverride || "").trim().toUpperCase();
  if (cfg.enabled !== true) return { ok: false, reason: "REVERSE_EXCEPTION_DISABLED" };
  if (!isReverseDropReason(reasonRaw)) return { ok: false, reason: "REVERSE_EXCEPTION_REASON_MISMATCH" };
  if (intentRaw !== "ENTRY" && intentRaw !== "ADD") return { ok: false, reason: "REVERSE_EXCEPTION_INTENT_MISMATCH" };
  if (!posSnap || posSnap.active !== true || !posSnap.side) return { ok: false, reason: "REVERSE_EXCEPTION_NO_POSITION" };
  const incomingDir = sideToPositionDir(side);
  if (!incomingDir || incomingDir === posSnap.side) return { ok: false, reason: "REVERSE_EXCEPTION_NOT_OPPOSITE" };
  if (!isReverseExceptionTierEvent(event, cfg)) return { ok: false, reason: "REVERSE_EXCEPTION_TIER_BLOCKED" };
  if (!(Number.isFinite(effectivePnlPct) && effectivePnlPct < Number(cfg.maxProfitPct))) {
    return {
      ok: false,
      reason: "REVERSE_EXCEPTION_PROFIT_CAP_BLOCKED",
      detail: {
        effective_pnl_pct: Number.isFinite(effectivePnlPct) ? Number(effectivePnlPct.toFixed(4)) : null,
        max_profit_pct: Number.isFinite(Number(cfg.maxProfitPct)) ? Number(cfg.maxProfitPct) : null,
      },
    };
  }
  const totalDropCount = Math.max(0, Number.isFinite(Number(priorDropCount)) ? Math.trunc(Number(priorDropCount)) : 0) + 1;
  if (totalDropCount < cfg.dropCountMin) {
    return {
      ok: false,
      reason: "REVERSE_EXCEPTION_DROP_COUNT_LOW",
      detail: {
        prior_drop_count: Math.max(0, Number.isFinite(Number(priorDropCount)) ? Math.trunc(Number(priorDropCount)) : 0),
        total_drop_count: totalDropCount,
        min_drop_count: cfg.dropCountMin,
        effective_pnl_pct: Number.isFinite(effectivePnlPct) ? Number(effectivePnlPct.toFixed(4)) : null,
      },
    };
  }
  return {
    ok: true,
    detail: {
      prior_drop_count: Math.max(0, Number.isFinite(Number(priorDropCount)) ? Math.trunc(Number(priorDropCount)) : 0),
      total_drop_count: totalDropCount,
      min_drop_count: cfg.dropCountMin,
      effective_pnl_pct: Number.isFinite(effectivePnlPct) ? Number(effectivePnlPct.toFixed(4)) : null,
      position_side: posSnap.side,
      incoming_dir: incomingDir,
    },
  };
}

module.exports = {
  normalizeReasonCode,
  sideToPositionDir,
  isReverseDropReason,
  isReverseExceptionTierEvent,
  resolveReverseExceptionConfig,
  summarizeOppositeReverseDrops,
  shouldReviveReverseDrop,
};
