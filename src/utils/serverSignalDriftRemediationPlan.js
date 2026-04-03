"use strict";

function toNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function clamp(n, min, max) {
  if (!Number.isFinite(Number(n))) return min;
  return Math.max(min, Math.min(max, Number(n)));
}

function normalizeMarketMap(raw = null, { min = null, max = null, asInt = false } = {}) {
  let src = raw;
  if (typeof src === "string") {
    const s = String(src || "").trim();
    if (!s) return {};
    try {
      src = JSON.parse(s);
    } catch (_err) {
      return {};
    }
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) return {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const key = upper(k);
    const n = toNum(v);
    if (!key || !Number.isFinite(n)) continue;
    let val = n;
    if (Number.isFinite(min)) val = Math.max(min, val);
    if (Number.isFinite(max)) val = Math.min(max, val);
    if (asInt) val = Math.max(0, Math.round(val));
    out[key] = val;
  }
  return out;
}

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  if (value.summary && typeof value.summary === "object") return value.summary;
  return value;
}

function countByMarket(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const market = upper(row && (row.market || row.symbol));
    if (!market) continue;
    map.set(market, Number(map.get(market) || 0) + 1);
  }
  return map;
}

function topMap(map, limit = 8) {
  return Array.from(map.entries())
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, Math.max(1, Number(limit) || 8))
    .map(([market, n]) => ({ market, n: Number(n) }));
}

function otherServerPolicyActionForReason(reason, mismatchN) {
  const key = upper(reason);
  const count = Math.max(0, Number(mismatchN) || 0);
  if (key === "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED") return count >= 2 ? "WATCH_ONLY_REVIEW" : "MONITOR_ONLY";
  if (key === "LIVE_RESCUE_ADD_POST_TP1_BLOCKED") return "MONITOR_POST_TP1_GUARD";
  return count >= 3 ? "WATCH_ONLY_REVIEW" : "MONITOR_ONLY";
}

function deriveServerSignalDriftRemediationPlan({
  parity = null,
  evGateRescue = null,
  systemSettings = null,
} = {}) {
  const parityRows = Array.isArray(parity && parity.rows) ? parity.rows : [];
  const evRows = parityRows.filter((row) =>
    row
    && row.parity_match === false
    && upper(row.actual_drop_reason_family) === "EV_POLICY"
    && upper(row.actual_drop_reason) === "DROP_EV_GATE_TP1_PROB"
  );
  const cooldownRows = parityRows.filter((row) =>
    row
    && row.parity_match === false
    && upper(row.actual_drop_reason_family) === "COOLDOWN_POLICY"
    && upper(row.actual_drop_reason) === "DROP_OPPOSITE_COOLDOWN"
  );
  const otherServerPolicyRows = parityRows.filter((row) =>
    row
    && row.parity_match === false
    && upper(row.actual_drop_reason_family) === "OTHER_SERVER_POLICY"
  );

  const evByMarket = countByMarket(evRows);
  const cooldownByMarket = countByMarket(cooldownRows);
  const otherServerPolicyByMarket = countByMarket(otherServerPolicyRows);
  const otherServerPolicyByReason = new Map();
  const otherServerPolicyReasonMarkets = new Map();
  const otherServerPolicyMarketReasons = new Map();
  for (const row of otherServerPolicyRows) {
    const reason = upper(row && row.actual_drop_reason) || "UNKNOWN";
    const market = upper(row && (row.market || row.symbol)) || "UNKNOWN";
    otherServerPolicyByReason.set(reason, Number(otherServerPolicyByReason.get(reason) || 0) + 1);
    if (!otherServerPolicyReasonMarkets.has(reason)) otherServerPolicyReasonMarkets.set(reason, new Map());
    otherServerPolicyReasonMarkets.get(reason).set(market, Number(otherServerPolicyReasonMarkets.get(reason).get(market) || 0) + 1);
    if (!otherServerPolicyMarketReasons.has(market)) otherServerPolicyMarketReasons.set(market, new Map());
    otherServerPolicyMarketReasons.get(market).set(reason, Number(otherServerPolicyMarketReasons.get(market).get(reason) || 0) + 1);
  }

  const rescueByMarketRows = Array.isArray(evGateRescue && evGateRescue.by_market)
    ? evGateRescue.by_market
    : [];
  const rescueByMarket = new Map();
  for (const row of rescueByMarketRows) {
    const market = upper(row && row.market);
    if (!market) continue;
    rescueByMarket.set(market, {
      rescue_rate: toNum(row && row.rescue_rate),
      point_pass_lower_fail: toNum(row && row.point_pass_lower_fail),
      point_fail: toNum(row && row.point_fail),
    });
  }

  const sys = systemSettings && typeof systemSettings === "object" ? systemSettings : {};
  const globalEvMin = clamp(toNum(sys.ev_gate_tp1_prob_min) || 0.55, 0, 1);
  const globalEvKill = clamp(toNum(sys.ev_gate_tp1_prob_kill) || 0.50, 0, 1);
  const evFloorMargin = clamp(toNum(process.env.SERVER_SIGNAL_DRIFT_PLAN_EV_MIN_FLOOR_MARGIN) || 0.001, 0, 0.02);
  const globalEvFloor = clamp(globalEvKill + evFloorMargin, 0, 1);
  const globalOppCooldownBars = Math.max(0, Math.round(toNum(sys.opposite_signal_cooldown_bars) || 3));
  const evMinByMarketCurrent = normalizeMarketMap(sys.ev_gate_tp1_prob_min_by_market, { min: 0, max: 1 });
  const oppCooldownByMarketCurrent = normalizeMarketMap(sys.opposite_signal_cooldown_bars_by_market, { min: 0, max: 100, asInt: true });

  const evMinByMarketPatch = {};
  const evRowsOut = [];
  for (const [market, mismatchN] of Array.from(evByMarket.entries()).sort((a, b) => Number(b[1]) - Number(a[1]))) {
    const current = Number.isFinite(toNum(evMinByMarketCurrent[market])) ? Number(evMinByMarketCurrent[market]) : globalEvMin;
    let step = 0.008;
    if (mismatchN >= 2) step += 0.006;
    if (mismatchN >= 3) step += 0.006;
    if (mismatchN >= 5) step += 0.006;
    const rescue = rescueByMarket.get(market) || null;
    if (
      rescue
      && Number.isFinite(rescue.point_pass_lower_fail)
      && Number.isFinite(rescue.point_fail)
      && rescue.point_pass_lower_fail > rescue.point_fail
    ) step += 0.004;
    if (rescue && Number.isFinite(rescue.rescue_rate) && rescue.rescue_rate >= 0.30) step += 0.004;
    step = clamp(step, 0.004, 0.05);

    // Never raise current threshold in remediation path.
    const minFloor = Math.min(current, Math.max(0.40, globalEvFloor));
    const proposed = clamp(current - step, minFloor, globalEvMin);
    const changed = proposed < (current - 1e-9);
    if (changed) evMinByMarketPatch[market] = Number(proposed.toFixed(4));
    evRowsOut.push({
      market,
      mismatch_n: Number(mismatchN),
      current_min: Number(current.toFixed(4)),
      proposed_min: Number(proposed.toFixed(4)),
      delta: Number((proposed - current).toFixed(4)),
      rescue_rate: rescue && Number.isFinite(rescue.rescue_rate) ? Number(rescue.rescue_rate.toFixed(4)) : null,
      point_pass_lower_fail: rescue && Number.isFinite(rescue.point_pass_lower_fail) ? Number(rescue.point_pass_lower_fail) : null,
      point_fail: rescue && Number.isFinite(rescue.point_fail) ? Number(rescue.point_fail) : null,
      changed,
    });
  }

  const oppositeCooldownByMarketPatch = {};
  const cooldownRowsOut = [];
  for (const [market, mismatchN] of Array.from(cooldownByMarket.entries()).sort((a, b) => Number(b[1]) - Number(a[1]))) {
    const current = Number.isFinite(toNum(oppCooldownByMarketCurrent[market]))
      ? Math.max(0, Math.round(Number(oppCooldownByMarketCurrent[market])))
      : globalOppCooldownBars;
    const proposed = Math.max(1, current - 1);
    const changed = proposed < current;
    if (changed) oppositeCooldownByMarketPatch[market] = proposed;
    cooldownRowsOut.push({
      market,
      mismatch_n: Number(mismatchN),
      current_bars: current,
      proposed_bars: proposed,
      delta: proposed - current,
      changed,
    });
  }

  const evMktPatchN = Object.keys(evMinByMarketPatch).length;
  const cooldownMktPatchN = Object.keys(oppositeCooldownByMarketPatch).length;
  const otherServerPolicyReasonRowsOut = Array.from(otherServerPolicyByReason.entries())
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 16)
    .map(([reason, mismatchN]) => ({
      reason,
      mismatch_n: Number(mismatchN),
      recommended_action: otherServerPolicyActionForReason(reason, mismatchN),
      top_markets: topMap(otherServerPolicyReasonMarkets.get(reason) || new Map(), 8),
    }));
  const otherServerPolicyWatchByReasonPatch = {};
  for (const row of otherServerPolicyReasonRowsOut) {
    if (row.recommended_action !== "WATCH_ONLY_REVIEW") continue;
    otherServerPolicyWatchByReasonPatch[row.reason] = row.top_markets.map((marketRow) => marketRow.market);
  }
  const otherServerPolicyRowsOut = Array.from(otherServerPolicyByMarket.entries())
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 16)
    .map(([market, mismatchN]) => {
      const reasonCounts = otherServerPolicyMarketReasons.get(market) || new Map();
      const dominantReasonRow = Array.from(reasonCounts.entries())
        .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))[0] || null;
      const dominantReason = dominantReasonRow ? dominantReasonRow[0] : "UNKNOWN";
      const dominantReasonMismatchN = dominantReasonRow ? Number(dominantReasonRow[1]) || 0 : 0;
      const recommendedAction = otherServerPolicyActionForReason(dominantReason, dominantReasonMismatchN);
      return {
        market,
        mismatch_n: Number(mismatchN),
        dominant_reason: dominantReason,
        dominant_reason_mismatch_n: dominantReasonMismatchN,
        recommended_mode: recommendedAction,
        changed: recommendedAction === "WATCH_ONLY_REVIEW",
      };
    });
  const otherServerPolicyPatchMarkets = otherServerPolicyRowsOut
    .filter((row) => row.recommended_mode === "WATCH_ONLY_REVIEW")
    .map((row) => row.market);
  const summary = {
    status: (evMktPatchN > 0 || cooldownMktPatchN > 0 || otherServerPolicyPatchMarkets.length > 0) ? "PLAN_READY" : "NO_CHANGE",
    ev_policy_mismatch_n: evRows.length,
    cooldown_policy_mismatch_n: cooldownRows.length,
    other_server_policy_mismatch_n: otherServerPolicyRows.length,
    ev_policy_market_patch_n: evMktPatchN,
    cooldown_policy_market_patch_n: cooldownMktPatchN,
    other_server_policy_watch_only_market_n: otherServerPolicyPatchMarkets.length,
    other_server_policy_reason_n: otherServerPolicyReasonRowsOut.length,
    global_ev_gate_tp1_prob_min: globalEvMin,
    global_ev_gate_tp1_prob_kill: globalEvKill,
    global_ev_gate_tp1_prob_floor: globalEvFloor,
    ev_floor_margin: evFloorMargin,
    global_opposite_signal_cooldown_bars: globalOppCooldownBars,
    next_actions: [
      "Apply ev_gate_tp1_prob_min_by_market patch in REPORT_ONLY first and verify parity mismatch delta.",
      "Apply opposite_signal_cooldown_bars_by_market patch only for listed cooldown mismatch markets.",
      otherServerPolicyPatchMarkets.length > 0
        ? `Apply WATCH_ONLY review for OTHER_SERVER_POLICY markets: ${otherServerPolicyPatchMarkets.join("|")}.`
        : "No OTHER_SERVER_POLICY watch-only review market now.",
      "Re-run canonical parity + cutover readiness after one cycle and compare blocker delta.",
    ],
    top_ev_policy_mismatch_markets: topMap(evByMarket, 8),
    top_cooldown_mismatch_markets: topMap(cooldownByMarket, 8),
    top_other_server_policy_mismatch_markets: topMap(otherServerPolicyByMarket, 8),
    top_other_server_policy_reasons: otherServerPolicyReasonRowsOut.slice(0, 6).map((row) => ({
      reason: row.reason,
      mismatch_n: row.mismatch_n,
      recommended_action: row.recommended_action,
    })),
  };

  return {
    summary,
    recommendations: {
      settings_patch: {
        ev_gate_tp1_prob_min_by_market: evMinByMarketPatch,
        opposite_signal_cooldown_bars_by_market: oppositeCooldownByMarketPatch,
        watch_only_review_markets_by_family: {
          OTHER_SERVER_POLICY: otherServerPolicyPatchMarkets,
        },
        watch_only_review_markets_by_subreason: {
          OTHER_SERVER_POLICY: otherServerPolicyWatchByReasonPatch,
        },
      },
      ev_policy_by_market: evRowsOut,
      cooldown_policy_by_market: cooldownRowsOut,
      other_server_policy_by_reason: otherServerPolicyReasonRowsOut,
      other_server_policy_by_market: otherServerPolicyRowsOut,
    },
  };
}

module.exports = {
  deriveServerSignalDriftRemediationPlan,
  __test: {
    normalizeMarketMap,
  },
};
