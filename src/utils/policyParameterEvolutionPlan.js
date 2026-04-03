"use strict";

const { deriveObjectiveScoreSnapshot } = require("./objectiveScoreSnapshot");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
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

function readRows(value, key = "by_market") {
  const raw = unwrapRawReport(value) || {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  if (Array.isArray(summary[key])) return summary[key];
  if (Array.isArray(raw[key])) return raw[key];
  return [];
}

function normalizeListMap(raw = null) {
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
    if (!key) continue;
    const values = Array.from(new Set((Array.isArray(v) ? v : []).map((value) => upper(value)).filter(Boolean)));
    if (values.length > 0) out[key] = values;
  }
  return out;
}

function baseScaleByAction(action) {
  const normalized = upper(action);
  if (normalized === "INCREASE") return 1.1;
  if (normalized === "REDUCE") return 0.75;
  if (normalized === "QUARANTINE") return 0;
  if (normalized === "EXPLORE_LIGHT") return 0.6;
  return 1.0;
}

function deriveQualityPenalty(row = {}) {
  const partial = toNum(row.partial_fill_rate_pct) || 0;
  const latency = toNum(row.avg_created_to_fill_ms) || 0;
  const slippage = toNum(row.avg_slippage_bps) || 0;
  let penalty = 0;
  if (partial >= 70) penalty += 0.2;
  else if (partial >= 55) penalty += 0.1;
  if (latency >= 700000) penalty += 0.15;
  else if (latency >= 500000) penalty += 0.05;
  if (slippage >= 50) penalty += 0.15;
  else if (slippage >= 20) penalty += 0.07;
  return Number(penalty.toFixed(4));
}

function deriveEvPolicyAction({ governor = {}, recoveryEffect = {} } = {}) {
  const governorEv = upper(governor.drop_validation_ev_policy_action);
  const higherDeltaCandidateId = upper(recoveryEffect.higher_delta_candidate_id);
  if (higherDeltaCandidateId === "EV_TP1_THRESHOLD_TUNE") {
    return "PRIORITIZE_EV_TP1_THRESHOLD_TUNE";
  }
  if (governorEv === "RELAX_EV_POLICY_REVIEW") {
    return "REVIEW_RELAX_EV_TP1_MIN";
  }
  if (governorEv === "TIGHTEN_EV_POLICY_REVIEW") {
    return "REVIEW_TIGHTEN_EV_TP1_MIN";
  }
  return "HOLD_EV_POLICY";
}

function deriveGlobalQtyScale({
  governor = {},
  recoveryEffect = {},
  executionQuality = {},
  quarantineRows = [],
  explorationApply = {},
} = {}) {
  let scale = 1.0;
  if (governor.recovery_required === true) scale -= 0.05;
  if ((toNum(recoveryEffect.current_objective_score) || 0) < 0) scale -= 0.05;
  if (recoveryEffect.projected_on_track === false && (toNum(recoveryEffect.gap_closure_rate) || 0) < 0.35) scale -= 0.1;
  if (upper(executionQuality.status) === "EXECUTION_QUALITY_REVIEW") scale -= 0.1;
  if (String(upper(governor.governor_status) || "").includes("BLOCKED")) scale -= 0.1;
  if ((Array.isArray(quarantineRows) ? quarantineRows.length : 0) > 0) scale -= 0.05;
  if (explorationApply.auto_apply_allowed === true && explorationApply.manual_confirm_required !== true && recoveryEffect.projected_on_track === true) {
    scale += 0.05;
  }
  return Number(clamp(scale, 0.55, 1.1).toFixed(4));
}

function derivePolicyParameterEvolutionPlan({
  objective = null,
  objectiveSupervisor = null,
  autonomyContract = null,
  objectiveRecoveryGovernor = null,
  objectiveRecoveryEffect = null,
  executionQuality = null,
  serverMarketCapitalAllocator = null,
  serverMarketQuarantine = null,
  explorationApplyCandidate = null,
  serverSignalDriftRemediationPlan = null,
} = {}) {
  const governor = readSummary(objectiveRecoveryGovernor);
  const recoveryEffect = readSummary(objectiveRecoveryEffect);
  const objectiveScoreSnapshot = deriveObjectiveScoreSnapshot({
    objective,
    objectiveSupervisor,
    autonomyContract,
    objectiveRecoveryGovernor,
    objectiveRecoveryEffect,
  });
  const executionSummary = readSummary(executionQuality);
  const allocatorRows = readRows(serverMarketCapitalAllocator, "by_market");
  const quarantineRows = readRows(serverMarketQuarantine, "by_market");
  const explorationApply = readSummary(explorationApplyCandidate);
  const driftRemediation = unwrapRawReport(serverSignalDriftRemediationPlan) || {};
  const driftPatch = driftRemediation.recommendations && typeof driftRemediation.recommendations === "object"
    ? (driftRemediation.recommendations.settings_patch || {})
    : {};
  const driftWatchByFamily = driftPatch && typeof driftPatch.watch_only_review_markets_by_family === "object"
    ? driftPatch.watch_only_review_markets_by_family
    : {};
  const driftWatchBySubreason = driftPatch && typeof driftPatch.watch_only_review_markets_by_subreason === "object"
    ? driftPatch.watch_only_review_markets_by_subreason
    : {};
  const driftOtherWatchByReason = normalizeListMap(driftWatchBySubreason.OTHER_SERVER_POLICY);
  const driftOtherWatchOnlyMarkets = Array.from(new Set(
    [
      ...(Array.isArray(driftWatchByFamily.OTHER_SERVER_POLICY) ? driftWatchByFamily.OTHER_SERVER_POLICY : []),
      ...Object.values(driftOtherWatchByReason).flat(),
    ]
      .map((value) => upper(value))
      .filter(Boolean)
  ));
  const qualityRows = readRows(executionQuality, "by_market");
  const qualityByMarket = new Map(
    qualityRows
      .map((row) => [upper(row && row.market), row])
      .filter((row) => row[0])
  );
  const quarantineSet = new Set(quarantineRows.map((row) => upper(row && row.market)).filter(Boolean));
  const driftOtherWatchOnlySet = new Set(driftOtherWatchOnlyMarkets);

  const marketActions = allocatorRows
    .filter((row) => row && row.active === true && upper(row.market))
    .map((row) => {
      const market = upper(row.market);
      const action = upper(row.recommended_action) || "HOLD";
      const qualityRow = qualityByMarket.get(market) || {};
      const qualityPenalty = deriveQualityPenalty(qualityRow);
      const baseScale = baseScaleByAction(action);
      const forceZero = action === "QUARANTINE" || quarantineSet.has(market);
      const recommendedScale = forceZero ? 0 : clamp(baseScale - qualityPenalty, 0.25, 1.2);
      return {
        market,
        allocator_action: action,
        in_quarantine: forceZero,
        base_scale: Number(baseScale.toFixed(4)),
        quality_penalty: qualityPenalty,
        recommended_qty_scale: Number(recommendedScale.toFixed(4)),
        quality_partial_fill_rate_pct: toNum(qualityRow.partial_fill_rate_pct),
        quality_avg_created_to_fill_ms: toNum(qualityRow.avg_created_to_fill_ms),
      };
    })
    .sort((a, b) => {
      const gapA = Math.abs((a.recommended_qty_scale ?? 1) - 1);
      const gapB = Math.abs((b.recommended_qty_scale ?? 1) - 1);
      return gapB - gapA || String(a.market).localeCompare(String(b.market));
    });

  const actionByMarket = new Map(
    marketActions.map((row) => [upper(row.market), row])
  );
  for (const market of driftOtherWatchOnlyMarkets) {
    if (!market) continue;
    const existing = actionByMarket.get(market);
    if (existing) {
      existing.in_quarantine = true;
      existing.allocator_action = "OTHER_SERVER_POLICY_REVIEW";
      existing.base_scale = 0;
      existing.recommended_qty_scale = 0;
      continue;
    }
    marketActions.push({
      market,
      allocator_action: "OTHER_SERVER_POLICY_REVIEW",
      in_quarantine: true,
      base_scale: 0,
      quality_penalty: 0,
      recommended_qty_scale: 0,
      quality_partial_fill_rate_pct: null,
      quality_avg_created_to_fill_ms: null,
    });
    actionByMarket.set(market, marketActions[marketActions.length - 1]);
  }

  marketActions.sort((a, b) => {
    const gapA = Math.abs((a.recommended_qty_scale ?? 1) - 1);
    const gapB = Math.abs((b.recommended_qty_scale ?? 1) - 1);
    return gapB - gapA || String(a.market).localeCompare(String(b.market));
  });

  const globalQtyScale = deriveGlobalQtyScale({
    governor,
    recoveryEffect,
    executionQuality: executionSummary,
    quarantineRows,
    explorationApply,
  });

  const blockers = [];
  if (governor.memory_blocked === true) blockers.push("MEMORY_BLOCKED");
  if (String(upper(governor.governor_status) || "").includes("BLOCKED")) blockers.push("GOVERNOR_BLOCKED");
  if (explorationApply.manual_confirm_required === true && explorationApply.auto_apply_allowed !== true) blockers.push("MANUAL_CONFIRM_REQUIRED");
  if (governor.degraded_authority_enabled === true && governor.degraded_authority_eligible !== true) blockers.push("DEGRADED_AUTHORITY_NOT_ELIGIBLE");

  const status = blockers.length ? "HOLD" : "READY";
  const mode = blockers.length ? "ADVISORY_ONLY" : "APPLY_READY";
  const evPolicyAction = deriveEvPolicyAction({ governor, recoveryEffect });

  const topMarketActions = marketActions.slice(0, 12);
  const quarantined = Array.from(quarantineSet);
  const watchOnlyReviewMarkets = Array.from(new Set([
    ...quarantined,
    ...driftOtherWatchOnlyMarkets,
  ]));
  const watchOnlyReviewOverlapMarkets = quarantined.filter((market) => driftOtherWatchOnlySet.has(market));

  return {
    summary: {
      status,
      mode,
      blocker_n: blockers.length,
      blockers,
      global_qty_scale: globalQtyScale,
      ev_policy_action: evPolicyAction,
      recovery_required: governor.recovery_required === true,
      governor_status: upper(governor.governor_status),
      governor_reason: upper(governor.governor_reason),
      projected_on_track: recoveryEffect.projected_on_track === true,
      current_objective_score: objectiveScoreSnapshot.objective_score,
      current_objective_score_source: objectiveScoreSnapshot.objective_score_source,
      projected_objective_score: toNum(recoveryEffect.projected_objective_score),
      execution_quality_status: upper(executionSummary.status),
      quarantine_market_n: quarantined.length,
      watch_only_review_market_n: watchOnlyReviewMarkets.length,
      watch_only_review_overlap_market_n: watchOnlyReviewOverlapMarkets.length,
      top_quarantine_markets: quarantined.slice(0, 6),
      top_watch_only_review_markets: watchOnlyReviewMarkets.slice(0, 6),
      other_server_policy_watch_only_market_n: driftOtherWatchOnlyMarkets.length,
      other_server_policy_watch_only_reason_n: Object.keys(driftOtherWatchByReason).length,
      top_other_server_policy_watch_only_reasons: Object.entries(driftOtherWatchByReason)
        .slice(0, 6)
        .map(([reason, markets]) => ({ reason, markets: markets.slice(0, 6) })),
      top_other_server_policy_watch_only_markets: driftOtherWatchOnlyMarkets.slice(0, 6),
      market_action_n: marketActions.length,
      top_market_actions: topMarketActions,
      next_actions: [
        `Apply global qty scale ${globalQtyScale} in report-only mode first, then live apply after one cycle verification.`,
        evPolicyAction === "HOLD_EV_POLICY"
          ? "Keep EV TP1 policy unchanged; continue monitoring recovery effect."
          : `Set EV policy to ${evPolicyAction} and track objective delta impact.`,
        quarantined.length
          ? `Keep quarantine/watch-only for ${quarantined.join("|")} until objective+quality recovers.`
          : "No quarantine override markets right now.",
        watchOnlyReviewMarkets.length
          ? `Combined watch-only review markets: ${watchOnlyReviewMarkets.join("|")} (overlap=${watchOnlyReviewOverlapMarkets.length}).`
          : "No watch-only review market now.",
        driftOtherWatchOnlyMarkets.length
          ? `Force WATCH_ONLY for OTHER_SERVER_POLICY review markets: ${driftOtherWatchOnlyMarkets.join("|")}.`
          : "No OTHER_SERVER_POLICY watch-only review market now.",
        Object.keys(driftOtherWatchByReason).length
          ? `OTHER_SERVER_POLICY sub-reasons in WATCH_ONLY: ${Object.keys(driftOtherWatchByReason).join("|")}.`
          : "No OTHER_SERVER_POLICY watch-only sub-reason now.",
      ],
    },
    recommendations: {
      global: [
        {
          key: "RISK_GUARD_V2_QTY_SCALE_GLOBAL",
          recommended_value: globalQtyScale,
          reason: "objective + execution quality + governor status composite",
        },
        {
          key: "EV_TP1_POLICY_ACTION",
          recommended_value: evPolicyAction,
          reason: "drop-validation + recovery-effect candidate priority",
        },
      ],
      by_market: topMarketActions.map((row) => ({
        market: row.market,
        qty_scale: row.recommended_qty_scale,
        mode: row.in_quarantine ? "WATCH_ONLY" : "ACTIVE",
        source_action: row.allocator_action,
        quality_penalty: row.quality_penalty,
      })),
    },
  };
}

module.exports = {
  derivePolicyParameterEvolutionPlan,
};
