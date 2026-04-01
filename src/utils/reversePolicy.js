"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function normalizeVenue(row = null) {
  return toUpper(row && (row.exchange || row.provider || row.market_source)) || null;
}

function isBinanceFutures(row = null) {
  return normalizeVenue(row) === "BINANCEFUT";
}

function readReverseReason(row = null) {
  return toUpper(
    (row && row.features_json && row.features_json._reason_raw)
    || (row && row.drop_reason_code)
    || (row && row.reason)
  );
}

function summarizeReversePolicy({
  droppedSignals = [],
  signals = [],
  currentSys = null,
} = {}) {
  const drops = (Array.isArray(droppedSignals) ? droppedSignals : []).filter((row) => isBinanceFutures(row));
  const liveSignals = (Array.isArray(signals) ? signals : []).filter((row) => isBinanceFutures(row));

  const reverseDrops = [];
  const byMarket = new Map();
  for (const row of drops) {
    const reverseReason = readReverseReason(row);
    if (reverseReason !== "REVERSE_BLOCKED" && reverseReason !== "REVERSE_COOLDOWN") continue;
    const market = toUpper(row && (row.symbol_or_pair_id || row.symbol)) || "UNKNOWN";
    reverseDrops.push(row);
    const bucket = byMarket.get(market) || {
      market,
      reverse_drop_n: 0,
      reverse_blocked_n: 0,
      reverse_cooldown_n: 0,
      reverse_revive_n: 0,
    };
    bucket.reverse_drop_n += 1;
    if (reverseReason === "REVERSE_BLOCKED") bucket.reverse_blocked_n += 1;
    if (reverseReason === "REVERSE_COOLDOWN") bucket.reverse_cooldown_n += 1;
    byMarket.set(market, bucket);
  }

  let reverseAppliedN = 0;
  for (const row of liveSignals) {
    if (!(row && row.features_json && row.features_json._reverse_exception_applied === true)) continue;
    reverseAppliedN += 1;
    const market = toUpper(row && (row.symbol_or_pair_id || row.symbol)) || "UNKNOWN";
    const bucket = byMarket.get(market) || {
      market,
      reverse_drop_n: 0,
      reverse_blocked_n: 0,
      reverse_cooldown_n: 0,
      reverse_revive_n: 0,
    };
    bucket.reverse_revive_n += 1;
    byMarket.set(market, bucket);
  }

  const rows = Array.from(byMarket.values()).map((row) => {
    const reverseReviveRate = row.reverse_drop_n > 0
      ? row.reverse_revive_n / row.reverse_drop_n
      : null;
    let verdict = "MONITOR";
    let recommendedAction = "MONITOR_REVERSE_POLICY";
    if (row.reverse_drop_n >= 8 && row.reverse_revive_n === 0) {
      verdict = "REVIEW_REVERSE_EXCEPTION_PATH";
      recommendedAction = "REVIEW_REVERSE_EXCEPTION_PATH";
    } else if (row.reverse_cooldown_n >= 4) {
      verdict = "REVIEW_REVERSE_COOLDOWN_POLICY";
      recommendedAction = "REVIEW_REVERSE_COOLDOWN_POLICY";
    }
    return {
      ...row,
      reverse_revive_rate: reverseReviveRate,
      dominant_reverse_reason: row.reverse_blocked_n >= row.reverse_cooldown_n ? "REVERSE_BLOCKED" : "REVERSE_COOLDOWN",
      verdict,
      recommended_action: recommendedAction,
    };
  }).sort((a, b) =>
    (b.reverse_drop_n - a.reverse_drop_n)
    || (a.reverse_revive_n - b.reverse_revive_n)
    || a.market.localeCompare(b.market)
  );

  const topWatch = rows.slice(0, 8).map((row) => ({
    market: row.market,
    reverse_drop_n: row.reverse_drop_n,
    reverse_revive_n: row.reverse_revive_n,
    dominant_reverse_reason: row.dominant_reverse_reason,
    verdict: row.verdict,
    recommended_action: row.recommended_action,
  }));

  const summary = {
    status: rows.some((row) => row.verdict !== "MONITOR") ? "REVERSE_POLICY_REVIEW" : "REVERSE_POLICY_STABLE",
    reverse_drop_n: reverseDrops.length,
    reverse_blocked_n: reverseDrops.filter((row) => readReverseReason(row) === "REVERSE_BLOCKED").length,
    reverse_cooldown_n: reverseDrops.filter((row) => readReverseReason(row) === "REVERSE_COOLDOWN").length,
    reverse_revive_n: reverseAppliedN,
    reverse_revive_rate: reverseDrops.length > 0 ? reverseAppliedN / reverseDrops.length : null,
    reverse_exception_enabled: currentSys && currentSys.reverse_exception_enabled === true,
    reverse_exception_drop_count_min: toNum(currentSys && currentSys.reverse_exception_drop_count_min),
    reverse_exception_max_profit_pct: toNum(currentSys && currentSys.reverse_exception_max_profit_pct),
    reverse_exception_core_enabled: currentSys && currentSys.reverse_exception_core_enabled === true,
    reverse_exception_early_enabled: currentSys && currentSys.reverse_exception_early_enabled === true,
    top_watch_markets: topWatch,
    top_watch_market: topWatch[0] ? topWatch[0].market : null,
    top_watch_reason: topWatch[0] ? topWatch[0].dominant_reverse_reason : null,
    top_watch_action: topWatch[0] ? topWatch[0].recommended_action : null,
  };

  return {
    summary,
    by_market: rows,
  };
}

module.exports = {
  summarizeReversePolicy,
};
