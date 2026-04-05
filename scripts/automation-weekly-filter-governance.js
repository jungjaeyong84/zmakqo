#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { summarizePineSignalQuality } = require("../src/services/pineSignalQuality");
const { classifySignalReasonStage } = require("../src/utils/signalReasonView");
const { resolveRegimeRecord } = require("../src/utils/regime");
const { buildFilterFeatureSignature } = require("../src/utils/filterFeatureBuckets");
const { displayStage1IntegrityReason } = require("../src/utils/stage1IntegrityReason");
const { tierMapToRows, wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const {
  isEntryTierEvent,
  resolveEntryTimingTier,
  resolveEntrySide,
} = require("../src/utils/liveEntryTaxonomy");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { buildCoverageGuard } = require("./lib/stage-outcome-ledgers");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const {
  buildObjectiveVerdict,
  monthlyRunRateKrw,
} = require("./lib/objective-policy");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonSafe,
  readJsonRawSafe,
  sendKoreanTelegramSummary,
  toIso,
  writeJson,
  writeText,
  kstStartOfTodayUtcMs,
} = require("./lib/automation-utils");
const { deriveBestFebtTuningContract } = require("./lib/best-febt-supervisor");

const PROVIDER = String(process.env.WEEKLY_FILTER_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.WEEKLY_FILTER_TF || "15m").trim();
const WINDOW_DAYS = Math.max(7, Number(process.env.WEEKLY_FILTER_WINDOW_DAYS || 7));
const SCAN_LIMIT = Math.max(3000, Number(process.env.WEEKLY_FILTER_SCAN_LIMIT || 30000));
const OBJECTIVE_MIN_WIN_RATE = Number(process.env.WEEKLY_FILTER_MIN_WIN_RATE || 0.60);
const OBJECTIVE_MIN_MONTHLY_NET_KRW = Math.max(0, Number(
  process.env.WEEKLY_FILTER_MIN_MONTHLY_NET_KRW
  || process.env.OBJECTIVE_MIN_MONTHLY_NET_KRW
  || 1_500_000
));
const OBJECTIVE_MONTHLY_WINDOW_DAYS = Math.max(28, Number(process.env.WEEKLY_FILTER_MONTHLY_WINDOW_DAYS || 28));
const OBJECTIVE_MONTH_DAYS = 30;
const REALIZED_MIN_SAMPLE = Math.max(6, Number(process.env.WEEKLY_FILTER_MIN_REALIZED_SAMPLE || 8));
const COUNTERFACTUAL_HOURS = Math.max(6, Number(process.env.WEEKLY_FILTER_COUNTERFACTUAL_HOURS || 12));
const COUNTERFACTUAL_HORIZON_MS = COUNTERFACTUAL_HOURS * 60 * 60 * 1000;
const PINE_FOLLOW_HOURS = Math.max(6, Number(process.env.WEEKLY_FILTER_PINE_FOLLOW_HOURS || 12));
const PINE_FOLLOW_HORIZON_MS = PINE_FOLLOW_HOURS * 60 * 60 * 1000;
const SURVIVAL_CHECKPOINT_HOURS = [2, 4, 8, 12];
const SUFFICIENCY_WINDOWS = [7, 14, 28, 56];
const SUFFICIENCY_THRESHOLDS = Object.freeze({
  PINE_REALIZED: 24,
  QUALITY_DROPS: 60,
  AI_DROPS: 20,
  MARKET_DROPS: 20,
  EV_EVALUATED: 20,
  TIMING_DROPS: 12,
});
const STAGE_KEYS = ["OPS", "QUALITY", "AI", "MARKET", "EV", "TIMING"];
const LIVE_ENTRY_SCOPE = "LONG_SHORT_SINGLE";
const LIVE_ENTRY_LABEL = "LONG/SHORT";
const FEBT_PHASE0_LATEST_JSON = path.join(OPS_DAILY_DIR, "febt_phase0_baseline_latest.json");
const FEBT_PHASE0_LATEST_MD = path.join(OPS_DAILY_DIR, "febt_phase0_baseline_latest.md");
const STAGE_LABELS = {
  OPS: "0차 운영/보호",
  QUALITY: "1차 상태/무결성",
  AI: "2차 진입 품질",
  MARKET: "3차 상태 기반 Soft Sizing",
  EV: "4차 EV/시간가치층",
  TIMING: "5차 WAIT 타이밍층",
};

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function ratioX(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n.toFixed(digits)}x`;
}

function formatBool(v) {
  return v ? "ON" : "OFF";
}

function buildUserFacingSettingsSnapshot(settings = {}) {
  return [
    { label: "1차 상태/무결성 사용", value: formatBool(settings.gate_enabled) },
    { label: "1차 추세 전용", value: formatBool(settings.gate_trend_only) },
    { label: "LONG/SHORT 기본 진입 점수 기준", value: settings.gate_early_score_abs },
    { label: "LONG/SHORT 확장 진입 점수 기준", value: settings.gate_core_score_abs },
    { label: "LONG/SHORT 공통 confidence 최소값", value: settings.gate_conf_min },
    { label: "LONG/SHORT 공통 wave confidence 최소값", value: settings.gate_wave_conf_min },
    {
      label: "1차 예외 진입",
      value: `enabled ${formatBool(settings.gate_transition_exception_enabled)} / score ${settings.gate_transition_exception_score_abs} / wave ${pct(settings.gate_transition_exception_wave_conf_min)}`,
    },
    {
      label: "2차 진입 품질 기본 정책",
      value: `enabled ${formatBool(settings.ai_bias_gate_enabled)} / neutral ${settings.ai_bias_gate_neutral_policy} / score ${pct(settings.ai_bias_gate_score_threshold)} / conf ${pct(settings.ai_bias_gate_conf_min)}`,
    },
    {
      label: "4차 EV/시간가치층 복합 기대값 하한 threshold",
      value: `${pct(settings.ev_gate_tp1_prob_min)} / live ${pct(settings.ev_gate_tp1_prob_min_early)}`,
    },
    {
      label: "4차 EV/시간가치층 복합 기대값 size band",
      value: `full ${pct(settings.ev_gate_tp1_prob_full)} / kill ${pct(settings.ev_gate_tp1_prob_kill)} / mid ${pct(settings.ev_gate_qty_scale_mid)} / low ${pct(settings.ev_gate_qty_scale_low)}`,
    },
    {
      label: "5차 WAIT 타이밍층",
      value: `streak ${settings.wait_one_bar_same_dir_streak_min} / chase ${ratioX(settings.wait_one_bar_chase_ratio_min)} / close ${pct(settings.wait_one_bar_last_close_control_min)} / body ${pct(settings.wait_one_bar_last_dir_body_min)} / wick ${pct(settings.wait_one_bar_last_opposite_wick_max)} / move1 ${pct(settings.wait_one_bar_recent_move1_pct_min)} / counter ${settings.wait_one_bar_counter_dir_bars_max}`,
    },
  ];
}

function summarizeNamedBreakdown(rows = [], field, limit = 4) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = row && row[field];
    const value = String(raw || "").trim().toUpperCase() || "UNKNOWN";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, n]) => ({ value, n }))
    .sort((a, b) => (b.n - a.n) || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function formatNamedBreakdown(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return "N/A";
  return items.map((row) => `${row.value} ${row.n}`).join(" / ");
}

function formatPairBreakdown(rows = [], limit = 3) {
  const items = (Array.isArray(rows) ? rows : []).slice(0, limit);
  if (!items.length) return "N/A";
  return items.map((row) => `${row.wait_action} x ${row.value} ${row.n}`).join(" / ");
}

function summarizeFebtShadowReplacement(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  let disagreeN = 0;
  let fallbackN = 0;
  let candidateRecoveredN = 0;
  let candidateBlockedN = 0;
  let candidateWaitN = 0;
  for (const row of items) {
    const disagree = row && row.febt_shadow_disagrees_legacy_wait === true;
    const fallback = row && row.febt_shadow_fallback_to_legacy === true;
    const reason = String(row && row.febt_shadow_disagreement_reason || "").trim().toUpperCase() || "UNKNOWN";
    if (disagree) {
      disagreeN += 1;
      if (reason === "FEBT_ALLOW_LEGACY_WAIT") candidateRecoveredN += 1;
      else if (reason === "FEBT_BLOCK_LEGACY_ALLOW") candidateBlockedN += 1;
      else if (reason === "FEBT_WAIT_LEGACY_ALLOW") candidateWaitN += 1;
    }
    if (fallback) fallbackN += 1;
  }
  const sampledN = items.length;
  return {
    sampled_n: sampledN,
    disagree_n: disagreeN,
    disagree_rate: sampledN > 0 ? (disagreeN / sampledN) : null,
    fallback_n: fallbackN,
    fallback_rate: sampledN > 0 ? (fallbackN / sampledN) : null,
    candidate_recovered_n: candidateRecoveredN,
    candidate_blocked_n: candidateBlockedN,
    candidate_wait_n: candidateWaitN,
    projected_net_signal_delta_n: candidateRecoveredN - candidateBlockedN,
    projected_count_ratio: sampledN > 0 ? ((sampledN - candidateBlockedN + candidateRecoveredN) / sampledN) : null,
    projected_replacement_ratio: candidateBlockedN > 0 ? (candidateRecoveredN / candidateBlockedN) : null,
    by_reason: summarizeNamedBreakdown(items.filter((row) => row && row.febt_shadow_disagrees_legacy_wait === true), "febt_shadow_disagreement_reason"),
    by_verdict: summarizeNamedBreakdown(items, "febt_shadow_verdict"),
    by_legacy_wait_action: summarizeNamedBreakdown(items, "febt_shadow_legacy_wait_action"),
    by_trigger_path: summarizeNamedBreakdown(items, "febt_shadow_legacy_wait_trigger_path"),
  };
}

function summarizeFebtPhase0Overlap(phase0 = null) {
  const overlap = phase0 && phase0.legacy_wait_overlap && typeof phase0.legacy_wait_overlap === "object"
    ? phase0.legacy_wait_overlap
    : {};
  return {
    compared_n: Number(overlap.compared_n || 0),
    wait_action_breakdown: Array.isArray(overlap.wait_action_breakdown) ? overlap.wait_action_breakdown.slice(0, 4) : [],
    market_action_pairs: Array.isArray(overlap.market_state_action_pairs) ? overlap.market_state_action_pairs.slice(0, 4) : [],
    entry_exec_timing_pairs: Array.isArray(overlap.entry_exec_timing_pairs) ? overlap.entry_exec_timing_pairs.slice(0, 4) : [],
    ev_policy_source_pairs: Array.isArray(overlap.ev_policy_source_pairs) ? overlap.ev_policy_source_pairs.slice(0, 4) : [],
  };
}

function summarizeCounterfactualFeatureBreakdown(rows = []) {
  const matured = (Array.isArray(rows) ? rows : []).filter((row) => row && row.ok === true);
  return {
    market_state: summarizeNamedBreakdown(matured, "market_state_summary_state"),
    market_action: summarizeNamedBreakdown(matured, "market_state_summary_action"),
    wait_action: summarizeNamedBreakdown(matured, "wait_one_bar_market_state_action"),
    ev_policy_version: summarizeNamedBreakdown(matured, "ev_gate_policy_version"),
    ev_policy_source: summarizeNamedBreakdown(matured, "ev_gate_policy_source"),
  };
}

function buildCounterfactualFeatureSummaryLines(summary = {}) {
  const breakdown = summary && summary.feature_breakdown ? summary.feature_breakdown : {};
  return [
    `market state ${formatNamedBreakdown(breakdown.market_state)}`,
    `market action ${formatNamedBreakdown(breakdown.market_action)} / wait action ${formatNamedBreakdown(breakdown.wait_action)}`,
    `ev policy ${formatNamedBreakdown(breakdown.ev_policy_version)} / source ${formatNamedBreakdown(breakdown.ev_policy_source)}`,
  ];
}

function stripSummaryPrefix(line, prefix) {
  const raw = String(line || "");
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

function buildWeeklyTelegramLayerLines({ current = {}, recommendations = {}, settings = {}, phase0 = null, bestFebtContract = null } = {}) {
  const featureLines = buildCounterfactualFeatureSummaryLines(current.drop_counterfactual || {});
  const marketState = stripSummaryPrefix(featureLines[0], "market state ");
  const marketAction = stripSummaryPrefix(featureLines[1], "market action ");
  const evPolicy = stripSummaryPrefix(featureLines[2], "ev policy ");
  const chainRows = current && current.quality && Array.isArray(current.quality.chain_rows)
    ? current.quality.chain_rows
    : [];
  const febtShadow = summarizeFebtShadowReplacement(chainRows);
  const phase0Overlap = summarizeFebtPhase0Overlap(phase0);
  const lines = [
    `1차 상태/무결성 ${recommendations.QUALITY && recommendations.QUALITY.action || "N/A"} / ${recommendations.QUALITY && recommendations.QUALITY.reason || "N/A"}`,
    `2차 진입 품질 ${recommendations.AI && recommendations.AI.action || "N/A"} / ${recommendations.AI && recommendations.AI.reason || "N/A"}`,
    `2차 진입 품질 세부(AI bias) neutral ${pct(settings.ai_bias_gate_neutral_mult)} / opposite ${pct(settings.ai_bias_gate_opposite_mult)} / strong score ${pct(settings.ai_bias_gate_strong_opposite_score)} / strong conf ${pct(settings.ai_bias_gate_strong_opposite_conf)}`,
    `3차 상태 기반 Soft Sizing ${recommendations.MARKET && recommendations.MARKET.action || "N/A"} / ${recommendations.MARKET && recommendations.MARKET.reason || "N/A"}`,
    `3차 상태 분포 ${marketState || "N/A"}`,
    `3차 상태 action ${marketAction || "N/A"}`,
    `4차 EV/시간가치층 복합 기대값 하한 기본 ${pct(settings.ev_gate_tp1_prob_min)} / ${LIVE_ENTRY_LABEL} ${pct(settings.ev_gate_tp1_prob_min_early)}`,
    `4차 EV/시간가치층 복합 기대값 band full ${pct(settings.ev_gate_tp1_prob_full)} / kill ${pct(settings.ev_gate_tp1_prob_kill)} / mid ${pct(settings.ev_gate_qty_scale_mid)} / low ${pct(settings.ev_gate_qty_scale_low)}`,
    `4차 EV/시간가치층 policy ${evPolicy || "N/A"}`,
    `5차 WAIT 타이밍층 streak ${settings.wait_one_bar_same_dir_streak_min} / chase ${ratioX(settings.wait_one_bar_chase_ratio_min)} / close ${pct(settings.wait_one_bar_last_close_control_min)} / body ${pct(settings.wait_one_bar_last_dir_body_min)} / wick ${pct(settings.wait_one_bar_last_opposite_wick_max)} / move1 ${pct(settings.wait_one_bar_recent_move1_pct_min)} / counter ${settings.wait_one_bar_counter_dir_bars_max}${febtShadow.sampled_n > 0 ? ` / disagree ${febtShadow.disagree_n} / fallback ${febtShadow.fallback_n}` : ""}`,
  ];
  if (febtShadow.sampled_n > 0) {
    lines.push(
      `FEBT shadow sampled ${febtShadow.sampled_n} / disagree ${febtShadow.disagree_n} / fallback ${febtShadow.fallback_n} / reason ${formatNamedBreakdown(febtShadow.by_reason)} / verdict ${formatNamedBreakdown(febtShadow.by_verdict)}`
    );
    lines.push(
      `FEBT replacement proxy recovered ${febtShadow.candidate_recovered_n} / blocked ${febtShadow.candidate_blocked_n} / wait ${febtShadow.candidate_wait_n} / replacement ${ratioX(febtShadow.projected_replacement_ratio)} / count ${ratioX(febtShadow.projected_count_ratio)} / delta ${signedNum(febtShadow.projected_net_signal_delta_n, 0)}`
    );
  }
  if (phase0 && phase0.legacy_wait_baseline) {
    const baseline = phase0.legacy_wait_baseline || {};
    const latency = phase0.bridge_latency || {};
    lines.push(
      `FEBT Phase0 coverage ${pct(baseline.legacy_wait_coverage_rate)} / observed ${baseline.legacy_wait_observed_chain_n || 0}`
    );
    lines.push(
      `FEBT Phase0 immediate win ${pct(baseline.immediate_win_rate)} / saved_loss ${pct(baseline.saved_loss_pct)} / missed_gain ${pct(baseline.missed_gain_pct)} / delta ${signedPct(baseline.saved_loss_minus_missed_gain)}`
    );
    lines.push(
      `FEBT Phase0 bridge p95 ${latency.webhook_to_fill_ms && Number.isFinite(Number(latency.webhook_to_fill_ms.p95)) ? `${Number(latency.webhook_to_fill_ms.p95).toFixed(0)}ms` : "N/A"} / dup ${latency.duplicate_count || 0} / reject ${latency.reject_count || 0}`
    );
  }
  if (phase0Overlap.compared_n > 0) {
    lines.push(
      `FEBT overlap compared ${phase0Overlap.compared_n} / wait ${formatNamedBreakdown(phase0Overlap.wait_action_breakdown)}`
    );
    lines.push(
      `FEBT overlap wait x market ${formatPairBreakdown(phase0Overlap.market_action_pairs)} / wait x timing ${formatPairBreakdown(phase0Overlap.entry_exec_timing_pairs)}`
    );
  }
  if (bestFebtContract && typeof bestFebtContract === "object") {
    lines.push(
      `BEST/FEBT 공통 계약 ${bestFebtContract.mode || "N/A"} / tightening ${bestFebtContract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${bestFebtContract.recovery_priority ? "FIRST" : "NORMAL"} / replacement ${ratioX(bestFebtContract.projected_replacement_ratio)} / count ${ratioX(bestFebtContract.projected_count_ratio_global)} / delta ${signedNum(bestFebtContract.projected_net_signal_delta_n, 0)}`
    );
  }
  return lines;
}

function tfIntervalMs(tf) {
  const raw = String(tf || "").trim().toLowerCase();
  if (raw === "15m") return 15 * 60 * 1000;
  if (raw === "60m" || raw === "1h") return 60 * 60 * 1000;
  return 15 * 60 * 1000;
}

function signedPct(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  const s = (n * 100).toFixed(digits);
  return `${n > 0 ? "+" : ""}${s}%`;
}

function signedNum(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function resolveTier(rowOrEvent) {
  return resolveEntryTimingTier(rowOrEvent);
}

function resolveSide(row) {
  return resolveEntrySide(row && row.event, row && (row.side || row.action));
}

function resolveFeatures(row) {
  if (row && row.features_json && typeof row.features_json === "object") return row.features_json;
  if (row && row.features && typeof row.features === "object") return row.features;
  return {};
}

function resolveRegime(row) {
  return resolveRegimeRecord(row) || "unknown";
}

function makeEntryRowKey(row) {
  const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
  const tf = String(row && row.tf || "").trim();
  const event = String(row && row.event || "").trim().toUpperCase();
  const ms = resolveDocMs(row);
  if (!market || !tf || !event || !Number.isFinite(ms)) return null;
  return `${market}__${tf}__${ms}__${event}`;
}

function resolveDocMs(doc) {
  return (
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.bar_close_time_utc_ms) ??
    Date.parse(String((doc && (doc.created_at || doc.updated_at || doc.ts)) || ""))
  );
}

function resolveFillMs(doc) {
  return (
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.bar_close_time_utc_ms) ??
    Date.parse(String((doc && (doc.created_at || doc.updated_at || doc.ts)) || ""))
  );
}

function filterRows(rows, { exchange, tf, fromMs, toMs, drops = false } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const event = String(row && row.event || "").trim().toUpperCase();
    const ms = resolveDocMs(row);
    if (exchange && ex !== exchange) return false;
    if (tf && rowTf && rowTf !== tf) return false;
    if (!isEntryTierEvent(event)) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) return false;
    if (drops !== true && String(row && row.status || "").trim().toUpperCase() === "DROP") return false;
    return true;
  });
}

function stageCountsTemplate() {
  return Object.fromEntries(STAGE_KEYS.map((key) => [key, 0]));
}

function summarizeDropStages(rows = []) {
  const counts = stageCountsTemplate();
  const reasons = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const reason = String(row.drop_reason_code || row.reason || "").trim().toUpperCase();
    if (!reason) continue;
    const stage = classifySignalReasonStage(reason);
    const key = String(stage && stage.key || "OPS").toUpperCase();
    counts[key] = (counts[key] || 0) + 1;
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  const total = Object.values(counts).reduce((acc, n) => acc + Number(n || 0), 0);
  return {
    total,
    counts,
    top_reasons: Array.from(reasons.entries())
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason))
      .slice(0, 10),
  };
}

function summarizeRegimeCoverage(rows = [], { label = "" } = {}) {
  let scoped = 0;
  let missing = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    scoped += 1;
    if (resolveRegime(row) === "unknown") missing += 1;
  }
  return {
    label,
    scoped_n: scoped,
    missing_n: missing,
    missing_rate: scoped > 0 ? (missing / scoped) : null,
  };
}

function aggregateOverallFromQuality(summary = {}) {
  const chainRows = Array.isArray(summary.chain_rows) ? summary.chain_rows : [];
  const byTier = summary.by_tier && typeof summary.by_tier === "object" ? summary.by_tier : {};
  const executedN = chainRows.length;
  const tp1HitN = chainRows.filter((row) => row && row.tp1_hit === true).length;
  const realized = chainRows.filter((row) => row && row.realized === true && Number.isFinite(toNum(row.realized_ret_net)));
  const realizedN = realized.length;
  const winN = realized.filter((row) => Number(row.realized_ret_net) > 0).length;
  const netPnlQuote = realized.reduce((acc, row) => acc + (Number(row.realized_pnl_quote) || 0), 0);
  const avgRetNet = realizedN > 0
    ? realized.reduce((acc, row) => acc + Number(row.realized_ret_net || 0), 0) / realizedN
    : null;
  const signalsN = Object.values(byTier).reduce((acc, row) => acc + Number(row && row.signals_n || 0), 0);
  const executedByTier = Object.values(byTier).reduce((acc, row) => acc + Number(row && row.executed_n || 0), 0);
  return {
    signals_n: signalsN,
    executed_n: executedByTier || executedN,
    execution_rate: signalsN > 0 ? ((executedByTier || executedN) / signalsN) : null,
    tp1_hit_n: tp1HitN,
    tp1_hit_rate: executedN > 0 ? (tp1HitN / executedN) : null,
    realized_n: realizedN,
    win_n: winN,
    win_rate: realizedN > 0 ? (winN / realizedN) : null,
    avg_ret_net: avgRetNet,
    net_pnl_quote: realizedN > 0 ? netPnlQuote : null,
    avg_entropy_score: avgRows(chainRows, "entropy_score"),
    avg_coherence_score: avgRows(chainRows, "coherence_score"),
    avg_transition_risk: avgRows(chainRows, "transition_risk"),
    avg_field_alignment: avgRows(chainRows, "field_alignment"),
    avg_domain_wall_density: avgRows(chainRows, "domain_wall_density"),
    avg_susceptibility: avgRows(chainRows, "susceptibility"),
    avg_free_energy: avgRows(chainRows, "free_energy"),
  };
}

function deltaNum(current, previous) {
  const a = Number(current);
  const b = Number(previous);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a - b;
}

function pickStageRecommendation({ stageKey, current, previous, objective, settings } = {}) {
  const currentDrops = current && current.drops ? current.drops : current;
  const previousDrops = previous && previous.drops ? previous.drops : previous;
  const totalDrops = Number(currentDrops && currentDrops.total || 0);
  const stageDrops = Number(currentDrops && currentDrops.counts && currentDrops.counts[stageKey] || 0);
  const share = totalDrops > 0 ? (stageDrops / totalDrops) : 0;
  const prevStageDrops = Number(previousDrops && previousDrops.counts && previousDrops.counts[stageKey] || 0);
  const deltaDrops = stageDrops - prevStageDrops;
  const neutralPolicy = String(settings && settings.ai_bias_gate_neutral_policy || "allow").trim().toLowerCase();

  if (!objective || objective.enough_sample !== true) {
    return { action: "HOLD", reason: "표본이 부족해 자동 판단을 보류합니다." };
  }

  if (stageKey === "QUALITY") {
    const executionRate = Number(current && current.overall && current.overall.execution_rate);
    if (objective.pass !== true && Number.isFinite(executionRate) && executionRate > 0.35 && share < 0.30) {
      return { action: "REVIEW_TIGHTEN", reason: "성과가 목표 미달인데 1차 상태/무결성 드롭 비중이 낮아 Pine 번들 fallback 경계가 너무 느슨한지 검토할 필요가 있습니다." };
    }
    if (objective.pass === true && Number.isFinite(executionRate) && executionRate < 0.15 && share > 0.55) {
      return { action: "REVIEW_LOOSEN", reason: "성과는 유지되는데 1차 상태/무결성 드롭 비중이 과도해 Pine fallback 경계가 너무 빡빡한지 검토할 필요가 있습니다." };
    }
    return { action: "KEEP", reason: "1차 상태/무결성은 현재 주간 성과와 fallback 드롭 분포 기준으로 즉시 수정 근거가 약합니다." };
  }

  if (stageKey === "AI") {
    const aiMissing = (currentDrops.top_reasons || []).find((row) => String(row.reason || "").startsWith("DROP_AI_MISSING"));
    if (aiMissing && Number(aiMissing.n || 0) > 0) {
      return { action: "REVIEW_DATA", reason: "2차 진입 품질 드롭의 핵심이 AI missing이라 threshold보다 데이터/수집 안정화가 우선입니다." };
    }
    if (objective.pass === true && share > 0.35) {
      return { action: "REVIEW_LOOSEN", reason: "성과는 목표를 만족하지만 2차 진입 품질 드롭 비중이 높아 AI 기본 차단이 과도할 수 있습니다." };
    }
    return { action: "KEEP", reason: "2차 진입 품질 판단 필터는 현재 지표 기준으로 유지가 타당합니다." };
  }

  if (stageKey === "MARKET") {
    const neutralBlocked = (currentDrops.top_reasons || []).find((row) => String(row.reason || "") === "DROP_AI_BIAS_NEUTRAL_BLOCK");
    if (objective.pass === true && share > 0.30) {
      return { action: "REVIEW_SOFTEN", reason: "성과는 목표를 만족하는데 3차 상태 기반 Soft Sizing 드롭 비중이 높아 수량 기반 soft 정책 검토 가치가 있습니다." };
    }
    if (neutralPolicy === "block" && neutralBlocked && Number(neutralBlocked.n || 0) >= 3) {
      return { action: "REVIEW_NEUTRAL_POLICY", reason: "중립 차단이 반복되어 neutral policy 재검토가 필요합니다." };
    }
    if (deltaDrops >= 5 && objective.pass !== true) {
      return { action: "REVIEW_TIGHTEN", reason: "3차 상태 기반 Soft Sizing 드롭이 늘고 성과도 목표 미달이라 bias 정책을 더 보수적으로 볼 근거가 있습니다." };
    }
    return { action: "KEEP", reason: "3차 상태 기반 Soft Sizing 필터는 현재 주간 분포 기준으로 즉시 수정 근거가 약합니다." };
  }

  return { action: "KEEP", reason: "유지" };
}

function buildSettingsSnapshot(sys = {}) {
  return {
    gate_enabled: sys.gate_enabled,
    gate_trend_only: sys.gate_trend_only,
    gate_early_score_abs: sys.gate_early_score_abs,
    gate_core_score_abs: sys.gate_core_score_abs,
    gate_pre_real_score_abs: sys.gate_pre_real_score_abs,
    gate_conf_min: sys.gate_conf_min,
    gate_wave_conf_min: sys.gate_wave_conf_min,
    gate_transition_exception_enabled: sys.gate_transition_exception_enabled,
    gate_transition_exception_core_enabled: sys.gate_transition_exception_core_enabled,
    gate_transition_exception_pre_real_enabled: sys.gate_transition_exception_pre_real_enabled,
    gate_transition_exception_score_abs: sys.gate_transition_exception_score_abs,
    gate_transition_exception_wave_conf_min: sys.gate_transition_exception_wave_conf_min,
    ai_bias_gate_enabled: sys.ai_bias_gate_enabled,
    ai_bias_gate_neutral_policy: sys.ai_bias_gate_neutral_policy,
    ai_bias_gate_score_threshold: sys.ai_bias_gate_score_threshold,
    ai_bias_gate_conf_min: sys.ai_bias_gate_conf_min,
    ai_bias_gate_core_enabled: sys.ai_bias_gate_core_enabled,
    ai_bias_gate_pre_real_enabled: sys.ai_bias_gate_pre_real_enabled,
    ai_bias_gate_real_enabled: sys.ai_bias_gate_real_enabled,
    ai_bias_gate_early_enabled: sys.ai_bias_gate_early_enabled,
    ai_bias_gate_neutral_mult: sys.ai_bias_gate_neutral_mult,
    ai_bias_gate_opposite_mult: sys.ai_bias_gate_opposite_mult,
    ai_bias_gate_strong_opposite_score: sys.ai_bias_gate_strong_opposite_score,
    ai_bias_gate_strong_opposite_conf: sys.ai_bias_gate_strong_opposite_conf,
    ev_gate_tp1_prob_min: sys.ev_gate_tp1_prob_min,
    ev_gate_tp1_prob_min_early: sys.ev_gate_tp1_prob_min_early,
    ev_gate_tp1_prob_min_core: sys.ev_gate_tp1_prob_min_core,
    ev_gate_tp1_prob_min_pre_real: sys.ev_gate_tp1_prob_min_pre_real,
    ev_gate_tp1_prob_min_real: sys.ev_gate_tp1_prob_min_real,
    ev_gate_tp1_prob_full: sys.ev_gate_tp1_prob_full,
    ev_gate_tp1_prob_kill: sys.ev_gate_tp1_prob_kill,
    ev_gate_qty_scale_mid: sys.ev_gate_qty_scale_mid,
    ev_gate_qty_scale_low: sys.ev_gate_qty_scale_low,
    wait_one_bar_same_dir_streak_min: sys.wait_one_bar_same_dir_streak_min,
    wait_one_bar_chase_ratio_min: sys.wait_one_bar_chase_ratio_min,
    wait_one_bar_last_close_control_min: sys.wait_one_bar_last_close_control_min,
    wait_one_bar_last_dir_body_min: sys.wait_one_bar_last_dir_body_min,
    wait_one_bar_last_opposite_wick_max: sys.wait_one_bar_last_opposite_wick_max,
    wait_one_bar_recent_move1_pct_min: sys.wait_one_bar_recent_move1_pct_min,
    wait_one_bar_counter_dir_bars_max: sys.wait_one_bar_counter_dir_bars_max,
  };
}

function findLatestFile(pattern) {
  const dir = OPS_DAILY_DIR;
  if (!fs.existsSync(dir)) return null;
  const rows = fs.readdirSync(dir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(dir, name);
      const st = fs.statSync(filePath);
      return { name, filePath, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows[0] || null;
}

function buildSequentialChangeGuard(historyPath) {
  const data = readJsonSafe(historyPath, null);
  const weeks = Array.isArray(data && data.weeks) ? data.weeks : [];
  const recent = weeks.slice(-4).reverse();
  let adverseStreak = 0;
  for (const row of recent) {
    const qaPass = row && row.qa_pass === true;
    const assessment = String(row && row.assessment || "").trim().toLowerCase();
    const positive = qaPass && assessment === "effective";
    if (positive) break;
    adverseStreak += 1;
  }
  const patchBudgetVars = adverseStreak >= 2 ? 0 : (adverseStreak === 1 ? 1 : 2);
  const verdict = adverseStreak >= 2 ? "HARD_HOLD" : (adverseStreak === 1 ? "CONSERVATIVE_ONLY" : "NORMAL");
  return {
    weeks_considered_n: recent.length,
    adverse_streak_n: adverseStreak,
    patch_budget_vars: patchBudgetVars,
    verdict,
    recent_assessments: recent.map((row) => ({
      week_key: row && row.week_key || null,
      qa_pass: row && row.qa_pass === true,
      assessment: row && row.assessment || null,
      recommended_patch_id: row && row.recommended_patch_id || null,
    })),
  };
}

function readHistory(filePath, key) {
  const data = readJsonSafe(filePath, {});
  if (!data || typeof data !== "object") return [];
  return Array.isArray(data[key]) ? data[key] : [];
}

function weightedAvgRows(rows = [], field, weightField = "executed_n") {
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => Number(row && row[weightField] || 0) > 0 && Number.isFinite(toNum(row && row[field])));
  if (!scoped.length) return null;
  const totalWeight = scoped.reduce((acc, row) => acc + Number(row[weightField] || 0), 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  return scoped.reduce((acc, row) => acc + (Number(row[field] || 0) * Number(row[weightField] || 0)), 0) / totalWeight;
}

function avgRows(rows = [], field) {
  const scoped = (Array.isArray(rows) ? rows : []).map((row) => toNum(row && row[field])).filter((v) => Number.isFinite(v));
  if (!scoped.length) return null;
  return scoped.reduce((acc, v) => acc + v, 0) / scoped.length;
}

function collectPhysicsAverages(rows = [], weightField = "executed_n") {
  return {
    avg_entropy_score: weightedAvgRows(rows, "avg_entropy_score", weightField),
    avg_coherence_score: weightedAvgRows(rows, "avg_coherence_score", weightField),
    avg_transition_risk: weightedAvgRows(rows, "avg_transition_risk", weightField),
    avg_field_alignment: weightedAvgRows(rows, "avg_field_alignment", weightField),
    avg_domain_wall_density: weightedAvgRows(rows, "avg_domain_wall_density", weightField),
    avg_susceptibility: weightedAvgRows(rows, "avg_susceptibility", weightField),
    avg_free_energy: weightedAvgRows(rows, "avg_free_energy", weightField),
  };
}

function formatPhysicsSummary(row = {}) {
  return [
    `entropy=${pct(row.avg_entropy_score)}`,
    `coherence=${pct(row.avg_coherence_score)}`,
    `transition_risk=${pct(row.avg_transition_risk)}`,
    `field_alignment=${pct(row.avg_field_alignment)}`,
    `domain_wall=${pct(row.avg_domain_wall_density)}`,
    `susceptibility=${pct(row.avg_susceptibility)}`,
    `free_energy=${pct(row.avg_free_energy)}`,
  ].join(" / ");
}

function combineSurvivalRows(rows = []) {
  const byHours = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const curve = Array.isArray(row && row.survival) ? row.survival : [];
    for (const point of curve) {
      const h = Number(point && point.hours);
      const n = Number(point && point.n);
      if (!Number.isFinite(h) || !Number.isFinite(n) || n <= 0) continue;
      if (!byHours.has(h)) byHours.set(h, { hours: h, n: 0, tp1: 0, sl: 0 });
      const bucket = byHours.get(h);
      bucket.n += n;
      bucket.tp1 += Number(point.tp1_rate || 0) * n;
      bucket.sl += Number(point.sl_rate || 0) * n;
    }
  }
  return Array.from(byHours.values())
    .sort((a, b) => a.hours - b.hours)
    .map((row) => ({
      hours: row.hours,
      n: row.n,
      tp1_rate: row.n > 0 ? (row.tp1 / row.n) : null,
      sl_rate: row.n > 0 ? (row.sl / row.n) : null,
    }));
}

function combineCompetingRiskRows(rows = []) {
  const byHours = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const curve = Array.isArray(row && row.competing_risk) ? row.competing_risk : [];
    for (const point of curve) {
      const h = Number(point && point.hours);
      const n = Number(point && point.n);
      if (!Number.isFinite(h) || !Number.isFinite(n) || n <= 0) continue;
      if (!byHours.has(h)) {
        byHours.set(h, {
          hours: h,
          n: 0,
          risk_set_n: 0,
          tp1_cum: 0,
          sl_cum: 0,
          both_cum: 0,
          unresolved: 0,
          tp1_hazard: 0,
          sl_hazard: 0,
          both_hazard: 0,
        });
      }
      const bucket = byHours.get(h);
      bucket.n += n;
      bucket.risk_set_n += Number(point.risk_set_n || 0);
      bucket.tp1_cum += Number(point.tp1_cum_rate || 0) * n;
      bucket.sl_cum += Number(point.sl_cum_rate || 0) * n;
      bucket.both_cum += Number(point.both_cum_rate || 0) * n;
      bucket.unresolved += Number(point.unresolved_rate || 0) * n;
      const riskSetN = Number(point.risk_set_n || 0);
      if (riskSetN > 0) {
        bucket.tp1_hazard += Number(point.tp1_interval_hazard || 0) * riskSetN;
        bucket.sl_hazard += Number(point.sl_interval_hazard || 0) * riskSetN;
        bucket.both_hazard += Number(point.both_interval_hazard || 0) * riskSetN;
      }
    }
  }
  return Array.from(byHours.values())
    .sort((a, b) => a.hours - b.hours)
    .map((row) => ({
      hours: row.hours,
      n: row.n,
      risk_set_n: row.risk_set_n,
      tp1_cum_rate: row.n > 0 ? (row.tp1_cum / row.n) : null,
      sl_cum_rate: row.n > 0 ? (row.sl_cum / row.n) : null,
      both_cum_rate: row.n > 0 ? (row.both_cum / row.n) : null,
      unresolved_rate: row.n > 0 ? (row.unresolved / row.n) : null,
      tp1_interval_hazard: row.risk_set_n > 0 ? (row.tp1_hazard / row.risk_set_n) : null,
      sl_interval_hazard: row.risk_set_n > 0 ? (row.sl_hazard / row.risk_set_n) : null,
      both_interval_hazard: row.risk_set_n > 0 ? (row.both_hazard / row.risk_set_n) : null,
    }));
}

function combineLiveEntryQualityRow(byTier = {}) {
  const rows = [byTier && byTier.EARLY, byTier && byTier.CORE].filter(Boolean);
  if (!rows.length) return {};
  const signalsN = rows.reduce((acc, row) => acc + Number(row.signals_n || 0), 0);
  const executedN = rows.reduce((acc, row) => acc + Number(row.executed_n || 0), 0);
  const tp1HitN = rows.reduce((acc, row) => acc + Number(row.tp1_hit_n || 0), 0);
  const realizedN = rows.reduce((acc, row) => acc + Number(row.realized_chains_n || 0), 0);
  const winN = rows.reduce((acc, row) => acc + Number(row.win_n || 0), 0);
  return {
    signals_n: signalsN,
    executed_n: executedN,
    execution_rate: signalsN > 0 ? (executedN / signalsN) : null,
    tp1_hit_rate: executedN > 0 ? (tp1HitN / executedN) : null,
    win_rate: realizedN > 0 ? (winN / realizedN) : null,
    avg_ret_net: weightedAvgRows(rows, "avg_ret_net", "realized_chains_n"),
    ...collectPhysicsAverages(rows),
  };
}

function combineLiveFollowThroughRow(byTier = {}) {
  const rows = [byTier && byTier.EARLY, byTier && byTier.CORE].filter(Boolean);
  if (!rows.length) return null;
  const executedN = rows.reduce((acc, row) => acc + Number(row.executed_n || 0), 0);
  return {
    executed_n: executedN,
    avg_time_to_tp1_h: weightedAvgRows(rows, "avg_time_to_tp1_h"),
    median_time_to_tp1_h: weightedAvgRows(rows, "median_time_to_tp1_h"),
    avg_time_to_sl_h: weightedAvgRows(rows, "avg_time_to_sl_h"),
    median_time_to_sl_h: weightedAvgRows(rows, "median_time_to_sl_h"),
    avg_time_to_first_exit_h: weightedAvgRows(rows, "avg_time_to_first_exit_h"),
    median_time_to_first_exit_h: weightedAvgRows(rows, "median_time_to_first_exit_h"),
    avg_mfe: weightedAvgRows(rows, "avg_mfe"),
    median_mfe: weightedAvgRows(rows, "median_mfe"),
    avg_mae: weightedAvgRows(rows, "avg_mae"),
    median_mae: weightedAvgRows(rows, "median_mae"),
    ...collectPhysicsAverages(rows),
    survival: combineSurvivalRows(rows),
    competing_risk: combineCompetingRiskRows(rows),
  };
}

function renderTierLines(byTier = {}) {
  const live = combineLiveEntryQualityRow(byTier);
  const rows = Object.values(byTier || {}).filter((row) => row && typeof row === "object");
  const febtExecuted = rows.reduce((acc, row) => acc + Number(row.executed_n || 0), 0);
  const febtCalcOk = rows.reduce((acc, row) => acc + Number(row.febt_calc_ok_n || 0), 0);
  const febtPhaseKnown = rows.reduce((acc, row) => acc + Number(row.febt_phase_known_n || 0), 0);
  const febtFire = rows.reduce((acc, row) => acc + Number(row.febt_fire_n || 0), 0);
  const febtLate = rows.reduce((acc, row) => acc + Number(row.febt_late_n || 0), 0);
  const febtVoid = rows.reduce((acc, row) => acc + Number(row.febt_void_n || 0), 0);
  const febtMissing = rows.reduce((acc, row) => acc + Number(row.febt_payload_missing_n || 0), 0);
  const febtDisagree = rows.reduce((acc, row) => acc + Number(row.febt_disagreement_n || 0), 0);
  const febtFallback = rows.reduce((acc, row) => acc + Number(row.febt_fallback_legacy_n || 0), 0);
  const febtCalcOkRate = febtExecuted > 0 ? (febtCalcOk / febtExecuted) : null;
  const febtPayloadMissingRate = febtExecuted > 0 ? (febtMissing / febtExecuted) : null;
  const febtSummary = febtExecuted > 0
    ? ` / FEBT calc=${pct(febtCalcOkRate)} phase_known=${febtPhaseKnown} fire=${febtFire} late=${febtLate} void=${febtVoid} disagree=${febtDisagree} fallback=${febtFallback} missing=${pct(febtPayloadMissingRate)}`
    : "";
  return [
    `- ${LIVE_ENTRY_LABEL}: signals=${live.signals_n || 0}, executed=${live.executed_n || 0}, execution=${pct(live.execution_rate)}, tp1_hit=${pct(live.tp1_hit_rate)}, win=${pct(live.win_rate)}, avg_ret_net=${signedPct(live.avg_ret_net)} / ${formatPhysicsSummary(live)}${febtSummary}`,
  ];
}

function resolveLiveFollowThroughRow(pineFollow = {}) {
  const byTier = pineFollow && pineFollow.by_tier ? pineFollow.by_tier : {};
  return combineLiveFollowThroughRow(byTier);
}

function displayCandidateId(row = {}) {
  const family = String(row.reason_family || "QUALITY").trim().toUpperCase();
  const direction = String(row.direction || "REVIEW").trim().toUpperCase();
  return `AUTO_LONG_SHORT_${family}_${direction}`;
}

function displayStageReasonForUser(reason, stage = "") {
  if (String(stage || "").trim().toUpperCase() === "QUALITY") {
    return displayStage1IntegrityReason(reason);
  }
  return String(reason || "").trim() || "N/A";
}

function resolveStageKey(stageOrReason) {
  if (stageOrReason && typeof stageOrReason === "object") {
    return String(stageOrReason.key || "").trim().toUpperCase();
  }
  return String(stageOrReason || "").trim().toUpperCase();
}

function summarizeEvEvaluatedEntries(intents = [], drops = [], { exchange, tf, fromMs, toMs } = {}) {
  let evaluatedN = 0;
  for (const row of Array.isArray(intents) ? intents : []) {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const event = String(row && row.event || "").trim().toUpperCase();
    const ms = toNum(row && row.signal_bar_close_time_utc_ms) ?? resolveDocMs(row);
    const f = resolveFeatures(row);
    if (exchange && ex !== exchange) continue;
    if (tf && rowTf && rowTf !== tf) continue;
    if (!isEntryTierEvent(event)) continue;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) continue;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) continue;
    if (
      f.ev_gate_tp1_reach_prob !== undefined
      || f.ev_gate_tp1_reach_prob_lower_bound !== undefined
      || f.ev_gate_exit_value_prob !== undefined
      || f.ev_gate_exit_value_prob_lower_bound !== undefined
      || f.ev_gate_action !== undefined
    ) {
      evaluatedN += 1;
    }
  }
  for (const row of Array.isArray(drops) ? drops : []) {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const event = String(row && row.event || "").trim().toUpperCase();
    const ms = resolveDocMs(row);
    const reason = String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase();
    if (exchange && ex !== exchange) continue;
    if (tf && rowTf && rowTf !== tf) continue;
    if (!isEntryTierEvent(event)) continue;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) continue;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) continue;
    if (reason.startsWith("DROP_EV_GATE_")) evaluatedN += 1;
  }
  return evaluatedN;
}

function buildSufficiencyRows({ windows = [] } = {}) {
  return (Array.isArray(windows) ? windows : []).map((row) => {
    const realized = Number(row && row.overall && row.overall.realized_n || 0);
    const windowExitFills = Number(row && row.window_exit_fills_n || 0);
    const qualityDrops = Number(row && row.drops && row.drops.counts && row.drops.counts.QUALITY || 0);
    const aiDrops = Number(row && row.drops && row.drops.counts && row.drops.counts.AI || 0);
    const marketDrops = Number(row && row.drops && row.drops.counts && row.drops.counts.MARKET || 0);
    const evEvaluated = Number(row && row.ev_evaluated_n || 0);
    const timingDrops = Number(row && row.drops && row.drops.counts && row.drops.counts.TIMING || 0);
    return {
      days: row.days,
      pine_realized_n: realized,
      window_exit_fills_n: windowExitFills,
      quality_drops_n: qualityDrops,
      ai_drops_n: aiDrops,
      market_drops_n: marketDrops,
      ev_evaluated_n: evEvaluated,
      timing_drops_n: timingDrops,
      pine_enough: realized >= SUFFICIENCY_THRESHOLDS.PINE_REALIZED,
      quality_enough: qualityDrops >= SUFFICIENCY_THRESHOLDS.QUALITY_DROPS,
      ai_enough: aiDrops >= SUFFICIENCY_THRESHOLDS.AI_DROPS,
      market_enough: marketDrops >= SUFFICIENCY_THRESHOLDS.MARKET_DROPS,
      ev_enough: evEvaluated >= SUFFICIENCY_THRESHOLDS.EV_EVALUATED,
      timing_enough: timingDrops >= SUFFICIENCY_THRESHOLDS.TIMING_DROPS,
    };
  });
}

function pctFromPriceMove({ entryPrice, refPrice, side, leverage }) {
  const entry = Number(entryPrice);
  const ref = Number(refPrice);
  const lev = Number(leverage);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(ref) || ref <= 0) return null;
  const raw = side === "SHORT" ? ((entry - ref) / entry) : ((ref - entry) / entry);
  const levEff = Number.isFinite(lev) && lev > 0 ? lev : 1;
  return raw * levEff;
}

function pnlToPrice({ avg, pnlPct, side, leverage }) {
  const avgNum = Number(avg);
  const pnlNum = Number(pnlPct);
  const lev = Number(leverage);
  if (!Number.isFinite(avgNum) || avgNum <= 0 || !Number.isFinite(pnlNum)) return null;
  const levEff = Number.isFinite(lev) && lev > 0 ? lev : 1;
  const rawPct = pnlNum / levEff;
  if (String(side || "").toUpperCase() === "SHORT") return avgNum * (1 - rawPct);
  return avgNum * (1 + rawPct);
}

function parseBarSnapshot(doc) {
  const data = doc && typeof doc.data === "function" ? doc.data() : doc;
  const ohlcv = data && data.ohlcv_json && typeof data.ohlcv_json === "object" ? data.ohlcv_json : {};
  const open = toNum(ohlcv.open ?? data.open);
  const high = toNum(ohlcv.high ?? data.high);
  const low = toNum(ohlcv.low ?? data.low);
  const close = toNum(ohlcv.close ?? data.close);
  const timestamp = toNum(data && data.bar_close_time_utc_ms);
  if (![open, high, low, close, timestamp].every((x) => Number.isFinite(x))) return null;
  return { open, high, low, close, timestamp };
}

function computeMfeMae({ entry, bars, side }) {
  const entryNum = Number(entry);
  const sideUpper = String(side || "").toUpperCase();
  if (!Number.isFinite(entryNum) || !Array.isArray(bars) || !bars.length || !["LONG", "SHORT"].includes(sideUpper)) {
    return { mfe: null, mae: null };
  }
  let mfe = null;
  let mae = null;
  for (const bar of bars) {
    const high = Number(bar && bar.high);
    const low = Number(bar && bar.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    if (sideUpper === "LONG") {
      const gain = (high - entryNum) / entryNum;
      const loss = (low - entryNum) / entryNum;
      mfe = mfe === null || gain > mfe ? gain : mfe;
      mae = mae === null || loss < mae ? loss : mae;
    } else {
      const gain = (entryNum - low) / entryNum;
      const loss = (entryNum - high) / entryNum;
      mfe = mfe === null || gain > mfe ? gain : mfe;
      mae = mae === null || loss < mae ? loss : mae;
    }
  }
  return { mfe, mae };
}

function median(values = []) {
  const nums = (Array.isArray(values) ? values : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

function avg(values = []) {
  const nums = (Array.isArray(values) ? values : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function hoursBetween(laterMs, earlierMs) {
  const a = Number(laterMs);
  const b = Number(earlierMs);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < b) return null;
  return (a - b) / (60 * 60 * 1000);
}

function betaPosteriorMean(successN, totalN, priorMean = 0.5, priorStrength = 8) {
  const k = Number(successN);
  const n = Number(totalN);
  const mean = Number(priorMean);
  const strength = Number(priorStrength);
  if (!Number.isFinite(k) || !Number.isFinite(n) || n < 0) return null;
  if (!Number.isFinite(mean) || mean < 0 || mean > 1) return null;
  if (!Number.isFinite(strength) || strength <= 0) return null;
  const alpha = mean * strength;
  const beta = (1 - mean) * strength;
  return (k + alpha) / (n + alpha + beta);
}

function sameOrAdjacentBucket(a, b, order = []) {
  const aa = String(a || "");
  const bb = String(b || "");
  if (!aa || !bb || aa === "unknown" || bb === "unknown") return false;
  if (aa === bb) return true;
  const ia = order.indexOf(aa);
  const ib = order.indexOf(bb);
  if (ia < 0 || ib < 0) return false;
  return Math.abs(ia - ib) <= 1;
}

const SCORE_BUCKET_ORDER = ["<25", "25-34", "35-44", "45-54", "55+"];
const CONF_BUCKET_ORDER = ["<0.40", "0.40-0.49", "0.50-0.54", "0.55-0.59", "0.60+"];
const WAVE_BUCKET_ORDER = ["<0.60", "0.60-0.64", "0.65-0.69", "0.70+"];
const VOL_BUCKET_ORDER = ["<0.5%", "0.5-0.99%", "1.0-1.49%", "1.5%+"];
const ENTROPY_BUCKET_ORDER = ["<0.35", "0.35-0.54", "0.55-0.69", "0.70+"];
const COHERENCE_BUCKET_ORDER = ["<0.35", "0.35-0.49", "0.50-0.64", "0.65+"];
const TRANSITION_BUCKET_ORDER = ["<0.30", "0.30-0.49", "0.50-0.69", "0.70+"];
const FIELD_ALIGNMENT_BUCKET_ORDER = ["<0.35", "0.35-0.49", "0.50-0.64", "0.65+"];
const DOMAIN_WALL_BUCKET_ORDER = ["<0.25", "0.25-0.44", "0.45-0.59", "0.60+"];
const SUSCEPTIBILITY_BUCKET_ORDER = ["<0.30", "0.30-0.49", "0.50-0.64", "0.65+"];
const FREE_ENERGY_BUCKET_ORDER = ["<0.35", "0.35-0.54", "0.55-0.69", "0.70+"];

function similarityScore(a = {}, b = {}) {
  let score = 0;
  if (String(a.side || "") === String(b.side || "")) score += 4;
  if (String(a.tier || "") === String(b.tier || "")) score += 4;
  if (String(a.regime || "") === String(b.regime || "")) score += 4;
  if (String(a.stat_phys_state || "") === String(b.stat_phys_state || "")) score += 2;
  if (String(a.session_bucket || "") === String(b.session_bucket || "")) score += 2;
  if (String(a.late_bucket || "") === String(b.late_bucket || "")) score += 1;
  if (sameOrAdjacentBucket(a.score_bucket, b.score_bucket, SCORE_BUCKET_ORDER)) score += 3;
  if (sameOrAdjacentBucket(a.conf_bucket, b.conf_bucket, CONF_BUCKET_ORDER)) score += 3;
  if (sameOrAdjacentBucket(a.wave_bucket, b.wave_bucket, WAVE_BUCKET_ORDER)) score += 2;
  if (sameOrAdjacentBucket(a.volatility_bucket, b.volatility_bucket, VOL_BUCKET_ORDER)) score += 1;
  if (sameOrAdjacentBucket(a.entropy_bucket, b.entropy_bucket, ENTROPY_BUCKET_ORDER)) score += 2;
  if (sameOrAdjacentBucket(a.coherence_bucket, b.coherence_bucket, COHERENCE_BUCKET_ORDER)) score += 2;
  if (sameOrAdjacentBucket(a.transition_bucket, b.transition_bucket, TRANSITION_BUCKET_ORDER)) score += 2;
  if (sameOrAdjacentBucket(a.field_alignment_bucket, b.field_alignment_bucket, FIELD_ALIGNMENT_BUCKET_ORDER)) score += 2;
  if (sameOrAdjacentBucket(a.domain_wall_bucket, b.domain_wall_bucket, DOMAIN_WALL_BUCKET_ORDER)) score += 2;
  if (sameOrAdjacentBucket(a.susceptibility_bucket, b.susceptibility_bucket, SUSCEPTIBILITY_BUCKET_ORDER)) score += 1;
  if (sameOrAdjacentBucket(a.free_energy_bucket, b.free_energy_bucket, FREE_ENERGY_BUCKET_ORDER)) score += 2;
  return score;
}

function buildSurvivalCurve(rows = [], checkpoints = SURVIVAL_CHECKPOINT_HOURS) {
  const matured = (Array.isArray(rows) ? rows : []).filter((row) => row && row.ok === true);
  return (Array.isArray(checkpoints) ? checkpoints : [])
    .map((hours) => {
      const h = Number(hours);
      if (!Number.isFinite(h) || h <= 0) return null;
      let tp1N = 0;
      let slN = 0;
      for (const row of matured) {
        const tp1Time = toNum(row && row.tp1_time_h);
        const slTime = toNum(row && row.sl_time_h);
        if (Number.isFinite(tp1Time) && tp1Time <= h) tp1N += 1;
        if (Number.isFinite(slTime) && slTime <= h) slN += 1;
      }
      return {
        hours: h,
        n: matured.length,
        tp1_rate: matured.length > 0 ? (tp1N / matured.length) : null,
        sl_rate: matured.length > 0 ? (slN / matured.length) : null,
      };
    })
    .filter(Boolean);
}

function resolveFirstCompetingEvent(row = {}) {
  const tp1Time = toNum(row && row.tp1_time_h);
  const slTime = toNum(row && row.sl_time_h);
  if (Number.isFinite(tp1Time) && Number.isFinite(slTime)) {
    if (Math.abs(tp1Time - slTime) < 1e-9) return { event: "BOTH", time_h: tp1Time };
    return tp1Time < slTime ? { event: "TP1", time_h: tp1Time } : { event: "SL", time_h: slTime };
  }
  if (Number.isFinite(tp1Time)) return { event: "TP1", time_h: tp1Time };
  if (Number.isFinite(slTime)) return { event: "SL", time_h: slTime };
  return { event: "NONE", time_h: null };
}

function buildCompetingRiskCurve(rows = [], checkpoints = SURVIVAL_CHECKPOINT_HOURS) {
  const matured = (Array.isArray(rows) ? rows : []).filter((row) => row && row.ok === true);
  const events = matured.map((row) => resolveFirstCompetingEvent(row));
  const hoursList = (Array.isArray(checkpoints) ? checkpoints : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  let prevHours = 0;
  return hoursList.map((hours) => {
    let tp1CumN = 0;
    let slCumN = 0;
    let bothCumN = 0;
    let riskSetN = 0;
    let tp1IntervalN = 0;
    let slIntervalN = 0;
    let bothIntervalN = 0;
    for (const ev of events) {
      const timeH = toNum(ev && ev.time_h);
      const event = String(ev && ev.event || "NONE").toUpperCase();
      if (!Number.isFinite(timeH) || timeH > prevHours) riskSetN += 1;
      if (Number.isFinite(timeH) && timeH <= hours) {
        if (event === "TP1") tp1CumN += 1;
        else if (event === "SL") slCumN += 1;
        else if (event === "BOTH") bothCumN += 1;
      }
      if (Number.isFinite(timeH) && timeH > prevHours && timeH <= hours) {
        if (event === "TP1") tp1IntervalN += 1;
        else if (event === "SL") slIntervalN += 1;
        else if (event === "BOTH") bothIntervalN += 1;
      }
    }
    const totalN = matured.length;
    const unresolvedN = Math.max(0, totalN - tp1CumN - slCumN - bothCumN);
    const out = {
      hours,
      n: totalN,
      risk_set_n: riskSetN,
      tp1_cum_rate: totalN > 0 ? (tp1CumN / totalN) : null,
      sl_cum_rate: totalN > 0 ? (slCumN / totalN) : null,
      both_cum_rate: totalN > 0 ? (bothCumN / totalN) : null,
      unresolved_rate: totalN > 0 ? (unresolvedN / totalN) : null,
      tp1_interval_hazard: riskSetN > 0 ? (tp1IntervalN / riskSetN) : null,
      sl_interval_hazard: riskSetN > 0 ? (slIntervalN / riskSetN) : null,
      both_interval_hazard: riskSetN > 0 ? (bothIntervalN / riskSetN) : null,
    };
    prevHours = hours;
    return out;
  });
}

function formatCompetingRiskCurve(curve = []) {
  return (Array.isArray(curve) ? curve : [])
    .map((row) =>
      `${row.hours}h TP1 ${pct(row.tp1_cum_rate)} / SL ${pct(row.sl_cum_rate)} / unresolved ${pct(row.unresolved_rate)} ` +
      `(hz TP1 ${pct(row.tp1_interval_hazard)} / SL ${pct(row.sl_interval_hazard)})`
    )
    .join(" / ");
}

async function fetchBarsRange({ exchange, symbol, tf, fromMs, toMs, limitN = 8000 } = {}) {
  const db = getFirestore();
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const timeframe = String(tf || "").trim();
  if (!ex || !sym || !timeframe || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];
  const prefix = `${ex}__${sym}__${timeframe}__`;
  const startKey = `${prefix}${Math.max(0, Math.floor(fromMs))}`;
  const endKey = `${prefix}${Math.max(0, Math.floor(toMs))}\uf8ff`;
  const snap = await db.collection("bars_snapshots")
    .orderBy("__name__")
    .startAt(startKey)
    .endAt(endKey)
    .limit(limitN)
    .get();
  const out = [];
  snap.forEach((d) => {
    const row = parseBarSnapshot(d);
    if (row) out.push(row);
  });
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

async function loadBarsForDropCounterfactual(rows = [], { exchange, tf, horizonMs } = {}) {
  const perMarket = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const stage = classifySignalReasonStage(String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase());
    if (String(stage && stage.key || "").toUpperCase() === "OPS") continue;
    const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
    const ms = resolveDocMs(row);
    if (!market || !Number.isFinite(ms)) continue;
    const cur = perMarket.get(market) || { fromMs: ms, toMs: ms };
    cur.fromMs = Math.min(cur.fromMs, ms);
    cur.toMs = Math.max(cur.toMs, ms + horizonMs);
    perMarket.set(market, cur);
  }
  const entries = Array.from(perMarket.entries());
  const results = await Promise.all(entries.map(async ([market, range]) => {
    const bars = await fetchBarsRange({
      exchange,
      symbol: market,
      tf,
      fromMs: range.fromMs,
      toMs: range.toMs,
    });
    return [market, bars];
  }));
  return new Map(results);
}

async function loadBarsForPineFollowThrough(chainRows = [], { exchange, tf, horizonMs } = {}) {
  const perMarket = new Map();
  for (const row of Array.isArray(chainRows) ? chainRows : []) {
    const market = String(row && row.market || "").trim().toUpperCase();
    const ms = toNum(row && row.entry_bar_ms);
    if (!market || !Number.isFinite(ms)) continue;
    const cur = perMarket.get(market) || { fromMs: ms, toMs: ms };
    cur.fromMs = Math.min(cur.fromMs, ms);
    cur.toMs = Math.max(cur.toMs, ms + horizonMs);
    perMarket.set(market, cur);
  }
  const results = await Promise.all(Array.from(perMarket.entries()).map(async ([market, range]) => {
    const bars = await fetchBarsRange({
      exchange,
      symbol: market,
      tf,
      fromMs: range.fromMs,
      toMs: range.toMs,
    });
    return [market, bars];
  }));
  return new Map(results);
}

function resolveDropLeverage(row, sysCfg = {}) {
  const f = resolveFeatures(row);
  return (
    toNum(f.leverage) ??
    toNum(f.futures_leverage) ??
    toNum(f.external_leverage) ??
    toNum(row && row.leverage) ??
    toNum(sysCfg && sysCfg.futures_leverage) ??
    2
  );
}

function resolveDropRules(row, sysCfg = {}, exchange = PROVIDER) {
  const f = resolveFeatures(row);
  const exitProfileMode = String(
    f.exit_profile
    || f.exitProfile
    || sysCfg.futures_exit_profile_mode
    || "BASE"
  ).trim().toUpperCase();
  const rules = resolveExitRulesForPosition({ exchange, exitProfileMode });
  const nextRules = { ...rules };
  const dynTp1 = toNum(f.exit_policy_tp1_pct ?? f.exitPolicyTp1Pct);
  if (Number.isFinite(dynTp1) && dynTp1 > 0) nextRules.TP_P1 = dynTp1 / 100;
  return nextRules;
}

function evaluateDropCounterfactual(row, bars = [], { sysCfg = {}, exchange = PROVIDER, horizonMs = COUNTERFACTUAL_HORIZON_MS, nowMs = Date.now() } = {}) {
  const side = resolveSide(row);
  const stage = classifySignalReasonStage(String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase());
  const barMs = resolveDocMs(row);
  const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
  if (!market || !Number.isFinite(barMs) || !side) return { ok: false, skip_reason: "BAD_ROW" };
  if (String(stage && stage.key || "").toUpperCase() === "OPS") return { ok: false, skip_reason: "OPS_STAGE" };
  const horizonEndMs = barMs + horizonMs;
  if (!Number.isFinite(nowMs) || nowMs < horizonEndMs) return { ok: false, skip_reason: "IMMATURE" };
  const entryBar = (Array.isArray(bars) ? bars : []).find((x) => Number(x.timestamp) === Number(barMs));
  if (!entryBar || !Number.isFinite(entryBar.close)) return { ok: false, skip_reason: "ENTRY_BAR_MISSING" };
  const futureBars = (Array.isArray(bars) ? bars : []).filter((x) => Number(x.timestamp) > Number(barMs) && Number(x.timestamp) <= horizonEndMs);
  if (!futureBars.length) return { ok: false, skip_reason: "HORIZON_BARS_MISSING" };
  const rules = resolveDropRules(row, sysCfg, exchange);
  const leverage = resolveDropLeverage(row, sysCfg);
  const tpPx = pnlToPrice({ avg: entryBar.close, pnlPct: Number(rules.TP_P1), side, leverage });
  const slPx = pnlToPrice({ avg: entryBar.close, pnlPct: Number(rules.SL), side, leverage });
  const featureSig = buildFilterFeatureSignature(row);
  let outcome = "HOLD";
  let exitBarMs = null;
  let tp1Ms = null;
  let slMs = null;
  for (const bar of futureBars) {
    const tpHit = side === "LONG" ? (bar.high >= tpPx) : (bar.low <= tpPx);
    const slHit = side === "LONG" ? (bar.low <= slPx) : (bar.high >= slPx);
    if (tpHit && slHit) {
      outcome = "AMBIGUOUS_BOTH";
      exitBarMs = bar.timestamp;
      tp1Ms = bar.timestamp;
      slMs = bar.timestamp;
      break;
    }
    if (tpHit) {
      outcome = "TP1_FIRST";
      exitBarMs = bar.timestamp;
      tp1Ms = bar.timestamp;
      break;
    }
    if (slHit) {
      outcome = "SL_FIRST";
      exitBarMs = bar.timestamp;
      slMs = bar.timestamp;
      break;
    }
  }
  const horizonClose = futureBars[futureBars.length - 1].close;
  const horizonRetNet = pctFromPriceMove({ entryPrice: entryBar.close, refPrice: horizonClose, side, leverage });
  const mm = computeMfeMae({ entry: entryBar.close, bars: futureBars, side });
  return {
    ok: true,
    market,
    stage_key: String(stage && stage.key || "OPS").toUpperCase(),
    reason: String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase(),
    side,
    tier: resolveTier(row && row.event),
    regime: resolveRegime(row),
    bar_ms: barMs,
    outcome,
    exit_bar_ms: exitBarMs,
    tp1_time_h: hoursBetween(tp1Ms, barMs),
    sl_time_h: hoursBetween(slMs, barMs),
    tp_price: tpPx,
    sl_price: slPx,
    leverage,
    horizon_ret_net: horizonRetNet,
    mfe: mm.mfe,
    mae: mm.mae,
    score_abs: featureSig.score_abs,
    confidence: featureSig.confidence,
    wave_conf: featureSig.wave_conf,
    volatility: featureSig.volatility,
    entropy_score: featureSig.entropy_score,
    coherence_score: featureSig.coherence_score,
    transition_risk: featureSig.transition_risk,
    field_alignment: featureSig.field_alignment,
    domain_wall_density: featureSig.domain_wall_density,
    susceptibility: featureSig.susceptibility,
    free_energy: featureSig.free_energy,
    stat_phys_state: featureSig.stat_phys_state,
    market_state_summary_state: featureSig.market_state_summary_state,
    market_state_summary_action: featureSig.market_state_summary_action,
    wait_one_bar_market_state_action: featureSig.wait_one_bar_market_state_action,
    ev_gate_policy_version: featureSig.ev_gate_policy_version,
    ev_gate_policy_source: featureSig.ev_gate_policy_source,
    late_by_bars: featureSig.late_by_bars,
    score_bucket: featureSig.score_bucket,
    conf_bucket: featureSig.conf_bucket,
    wave_bucket: featureSig.wave_bucket,
    volatility_bucket: featureSig.volatility_bucket,
    entropy_bucket: featureSig.entropy_bucket,
    coherence_bucket: featureSig.coherence_bucket,
    transition_bucket: featureSig.transition_bucket,
    field_alignment_bucket: featureSig.field_alignment_bucket,
    domain_wall_bucket: featureSig.domain_wall_bucket,
    susceptibility_bucket: featureSig.susceptibility_bucket,
    free_energy_bucket: featureSig.free_energy_bucket,
    late_bucket: featureSig.late_bucket,
    session_bucket: featureSig.session_bucket,
  };
}

function createCfStats() {
  return {
    matured_n: 0,
    tp1_first_n: 0,
    sl_first_n: 0,
    ambiguous_both_n: 0,
    hold_n: 0,
    horizon_pos_n: 0,
    horizon_neg_n: 0,
    avg_horizon_ret_net_sum: 0,
    avg_horizon_ret_net_n: 0,
  };
}

function finalizeCfStats(stats) {
  const out = { ...stats };
  out.tp1_first_rate = out.matured_n > 0 ? (out.tp1_first_n / out.matured_n) : null;
  out.sl_first_rate = out.matured_n > 0 ? (out.sl_first_n / out.matured_n) : null;
  out.ambiguous_both_rate = out.matured_n > 0 ? (out.ambiguous_both_n / out.matured_n) : null;
  out.hold_rate = out.matured_n > 0 ? (out.hold_n / out.matured_n) : null;
  out.horizon_pos_rate = out.matured_n > 0 ? (out.horizon_pos_n / out.matured_n) : null;
  out.avg_horizon_ret_net = out.avg_horizon_ret_net_n > 0 ? (out.avg_horizon_ret_net_sum / out.avg_horizon_ret_net_n) : null;
  return out;
}

function wilsonInterval(successN, totalN, z = 1.96) {
  const k = Number(successN);
  const n = Number(totalN);
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0) return { lower: null, upper: null };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + (z2 / n);
  const center = (p + (z2 / (2 * n))) / denom;
  const margin = (z / denom) * Math.sqrt(((p * (1 - p)) / n) + (z2 / (4 * n * n)));
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

function createMatchedPathStats() {
  return {
    support_n: 0,
    pool_total_n: 0,
    realized_n: 0,
    win_n: 0,
    tp1_hit_n: 0,
    avg_ret_net_sum: 0,
    avg_ret_net_n: 0,
    avg_mfe_sum: 0,
    avg_mfe_n: 0,
    avg_mae_sum: 0,
    avg_mae_n: 0,
    avg_tp1_time_h_sum: 0,
    avg_tp1_time_h_n: 0,
    avg_sl_time_h_sum: 0,
    avg_sl_time_h_n: 0,
  };
}

function finalizeMatchedPathStats(stats = {}) {
  return {
    matched_support_n: Number(stats.support_n || 0),
    matched_pool_avg_n: Number(stats.support_n || 0) > 0 ? (Number(stats.pool_total_n || 0) / Number(stats.support_n || 0)) : null,
    matched_realized_n: Number(stats.realized_n || 0),
    matched_win_rate: Number(stats.realized_n || 0) > 0 ? (Number(stats.win_n || 0) / Number(stats.realized_n || 0)) : null,
    matched_tp1_hit_rate: Number(stats.support_n || 0) > 0 ? (Number(stats.tp1_hit_n || 0) / Number(stats.support_n || 0)) : null,
    matched_avg_ret_net: Number(stats.avg_ret_net_n || 0) > 0 ? (Number(stats.avg_ret_net_sum || 0) / Number(stats.avg_ret_net_n || 0)) : null,
    matched_avg_mfe: Number(stats.avg_mfe_n || 0) > 0 ? (Number(stats.avg_mfe_sum || 0) / Number(stats.avg_mfe_n || 0)) : null,
    matched_avg_mae: Number(stats.avg_mae_n || 0) > 0 ? (Number(stats.avg_mae_sum || 0) / Number(stats.avg_mae_n || 0)) : null,
    matched_avg_time_to_tp1_h: Number(stats.avg_tp1_time_h_n || 0) > 0 ? (Number(stats.avg_tp1_time_h_sum || 0) / Number(stats.avg_tp1_time_h_n || 0)) : null,
    matched_avg_time_to_sl_h: Number(stats.avg_sl_time_h_n || 0) > 0 ? (Number(stats.avg_sl_time_h_sum || 0) / Number(stats.avg_sl_time_h_n || 0)) : null,
  };
}

function mergeMatchedPathStats(target, incoming = {}) {
  target.support_n += Number(incoming.support_n || 0);
  target.pool_total_n += Number(incoming.pool_total_n || 0);
  target.realized_n += Number(incoming.realized_n || 0);
  target.win_n += Number(incoming.win_n || 0);
  target.tp1_hit_n += Number(incoming.tp1_hit_n || 0);
  target.avg_ret_net_sum += Number(incoming.avg_ret_net_sum || 0);
  target.avg_ret_net_n += Number(incoming.avg_ret_net_n || 0);
  target.avg_mfe_sum += Number(incoming.avg_mfe_sum || 0);
  target.avg_mfe_n += Number(incoming.avg_mfe_n || 0);
  target.avg_mae_sum += Number(incoming.avg_mae_sum || 0);
  target.avg_mae_n += Number(incoming.avg_mae_n || 0);
  target.avg_tp1_time_h_sum += Number(incoming.avg_tp1_time_h_sum || 0);
  target.avg_tp1_time_h_n += Number(incoming.avg_tp1_time_h_n || 0);
  target.avg_sl_time_h_sum += Number(incoming.avg_sl_time_h_sum || 0);
  target.avg_sl_time_h_n += Number(incoming.avg_sl_time_h_n || 0);
}

function buildExecutedPathIndex(executedChains = []) {
  const byStageKey = new Map();
  for (const row of Array.isArray(executedChains) ? executedChains : []) {
    const key = [
      String(row && row.side || "UNKNOWN"),
      String(row && row.tier || "UNKNOWN"),
      String(row && row.regime || "unknown"),
    ].join("__");
    if (!byStageKey.has(key)) byStageKey.set(key, []);
    byStageKey.get(key).push(row);
  }
  return byStageKey;
}

function matchExecutedPathBaseline(dropRow, executedPathIndex = new Map()) {
  const stageKey = [
    String(dropRow && dropRow.side || "UNKNOWN"),
    String(dropRow && dropRow.tier || "UNKNOWN"),
    String(dropRow && dropRow.regime || "unknown"),
  ].join("__");
  const candidates = Array.isArray(executedPathIndex.get(stageKey)) ? executedPathIndex.get(stageKey) : [];
  if (!candidates.length) return createMatchedPathStats();
  const ranked = candidates
    .map((row) => ({
      row,
      score: similarityScore(dropRow, row),
      scoreGap: Math.abs(Number(row && row.score_abs || 0) - Number(dropRow && dropRow.score_abs || 0)),
    }))
    .sort((a, b) => (b.score - a.score) || (a.scoreGap - b.scoreGap));
  const viable = ranked.filter((x) => x.score >= 10);
  const pool = (viable.length >= 3 ? viable : ranked.slice(0, Math.min(8, ranked.length))).map((x) => x.row);
  const stats = createMatchedPathStats();
  if (!pool.length) return stats;
  stats.support_n += 1;
  stats.pool_total_n += pool.length;
  for (const row of pool) {
    if (row && row.tp1_hit === true) stats.tp1_hit_n += 1 / pool.length;
    const realizedRet = toNum(row && row.realized_ret_net);
    if (Number.isFinite(realizedRet)) {
      stats.realized_n += 1 / pool.length;
      if (realizedRet > 0) stats.win_n += 1 / pool.length;
      stats.avg_ret_net_sum += realizedRet / pool.length;
      stats.avg_ret_net_n += 1 / pool.length;
    }
    const mfe = toNum(row && row.mfe);
    if (Number.isFinite(mfe)) {
      stats.avg_mfe_sum += mfe / pool.length;
      stats.avg_mfe_n += 1 / pool.length;
    }
    const mae = toNum(row && row.mae);
    if (Number.isFinite(mae)) {
      stats.avg_mae_sum += mae / pool.length;
      stats.avg_mae_n += 1 / pool.length;
    }
    const tp1Time = toNum(row && row.tp1_time_h);
    if (Number.isFinite(tp1Time)) {
      stats.avg_tp1_time_h_sum += tp1Time / pool.length;
      stats.avg_tp1_time_h_n += 1 / pool.length;
    }
    const slTime = toNum(row && row.sl_time_h);
    if (Number.isFinite(slTime)) {
      stats.avg_sl_time_h_sum += slTime / pool.length;
      stats.avg_sl_time_h_n += 1 / pool.length;
    }
  }
  return stats;
}

function summarizeDropCounterfactual(rows = []) {
  const overall = createCfStats();
  const byStage = {};
  const byReasonMap = new Map();
  const byMarketMap = new Map();
  const byReasonMarketMap = new Map();
  const stageRows = {};
  const maturedRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.ok !== true) continue;
    maturedRows.push(row);
    const stageKey = String(row.stage_key || "OPS").toUpperCase();
    if (!byStage[stageKey]) byStage[stageKey] = createCfStats();
    if (!stageRows[stageKey]) stageRows[stageKey] = [];
    stageRows[stageKey].push(row);
    const stage = byStage[stageKey];
    const buckets = [overall, stage];
    const reasonKey = String(row.reason || "UNKNOWN");
    let reasonStats = byReasonMap.get(reasonKey);
    if (!reasonStats) {
      reasonStats = createCfStats();
      byReasonMap.set(reasonKey, reasonStats);
    }
    buckets.push(reasonStats);
    const marketKey = String(row.market || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    let marketStats = byMarketMap.get(marketKey);
    if (!marketStats) {
      marketStats = createCfStats();
      byMarketMap.set(marketKey, marketStats);
    }
    buckets.push(marketStats);
    const reasonMarketKey = `${reasonKey}__${marketKey}`;
    let reasonMarketStats = byReasonMarketMap.get(reasonMarketKey);
    if (!reasonMarketStats) {
      reasonMarketStats = createCfStats();
      byReasonMarketMap.set(reasonMarketKey, reasonMarketStats);
    }
    buckets.push(reasonMarketStats);
    for (const bucket of buckets) {
      bucket.matured_n += 1;
      if (row.outcome === "TP1_FIRST") bucket.tp1_first_n += 1;
      else if (row.outcome === "SL_FIRST") bucket.sl_first_n += 1;
      else if (row.outcome === "AMBIGUOUS_BOTH") bucket.ambiguous_both_n += 1;
      else bucket.hold_n += 1;
      const ret = Number(row.horizon_ret_net);
      if (Number.isFinite(ret)) {
        if (ret > 0) bucket.horizon_pos_n += 1;
        else if (ret < 0) bucket.horizon_neg_n += 1;
        bucket.avg_horizon_ret_net_sum += ret;
        bucket.avg_horizon_ret_net_n += 1;
      }
    }
  }
  return {
    overall: {
      ...finalizeCfStats(overall),
      survival: buildSurvivalCurve(rows),
      competing_risk: buildCompetingRiskCurve(rows),
    },
    by_stage: Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, {
      ...finalizeCfStats(v),
      survival: buildSurvivalCurve(stageRows[k] || []),
      competing_risk: buildCompetingRiskCurve(stageRows[k] || []),
    }])),
    top_reasons: Array.from(byReasonMap.entries())
      .map(([reason, stats]) => ({ reason, ...finalizeCfStats(stats) }))
      .sort((a, b) => (b.tp1_first_n - a.tp1_first_n) || (b.matured_n - a.matured_n) || a.reason.localeCompare(b.reason))
      .slice(0, 8),
    by_market: Array.from(byMarketMap.entries())
      .map(([market, stats]) => ({ market, ...finalizeCfStats(stats) }))
      .sort((a, b) => (b.matured_n - a.matured_n) || ((b.horizon_pos_rate || 0) - (a.horizon_pos_rate || 0)) || a.market.localeCompare(b.market))
      .slice(0, 16),
    by_reason_market: Array.from(byReasonMarketMap.entries())
      .map(([key, stats]) => {
        const splitIdx = key.lastIndexOf("__");
        const reason = splitIdx >= 0 ? key.slice(0, splitIdx) : key;
        const market = splitIdx >= 0 ? key.slice(splitIdx + 2) : "UNKNOWN";
        return { reason, market, ...finalizeCfStats(stats) };
      })
      .sort((a, b) => (b.matured_n - a.matured_n) || ((b.horizon_pos_rate || 0) - (a.horizon_pos_rate || 0)) || a.reason.localeCompare(b.reason) || a.market.localeCompare(b.market))
      .slice(0, 32),
    feature_breakdown: summarizeCounterfactualFeatureBreakdown(maturedRows),
  };
}

function buildQualityDeepDive({ drops = [], cfRows = [], executedChains = [] } = {}) {
  const qualityDrops = (Array.isArray(drops) ? drops : []).filter((row) => {
    const stage = classifySignalReasonStage(String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase());
    return String(stage && stage.key || "").toUpperCase() === "QUALITY";
  });
  const qualityCf = (Array.isArray(cfRows) ? cfRows : []).filter((row) => String(row && row.stage_key || "").toUpperCase() === "QUALITY");
  const matured = qualityCf.filter((row) => row && row.ok === true);
  const skipped = qualityCf.filter((row) => !row || row.ok !== true);

  const skipReasons = new Map();
  for (const row of skipped) {
    const reason = String(row && row.skip_reason || "UNKNOWN");
    skipReasons.set(reason, (skipReasons.get(reason) || 0) + 1);
  }

  const reasonMap = new Map();
  const comboMap = new Map();
  const executedPathIndex = buildExecutedPathIndex(executedChains);
  function getBucket(map, key, seed = {}) {
    if (!map.has(key)) {
      map.set(key, {
        matured_n: 0,
        tp1_first_n: 0,
        sl_first_n: 0,
        hold_n: 0,
        horizon_pos_n: 0,
        avg_horizon_ret_net_sum: 0,
        avg_horizon_ret_net_n: 0,
        matched_path: createMatchedPathStats(),
        ...seed,
      });
    }
    return map.get(key);
  }
  for (const row of matured) {
    const reason = String(row.reason || "UNKNOWN");
    const reasonBucket = getBucket(reasonMap, reason, { reason });
    const comboKey = [
      reason,
      String(row.side || "UNKNOWN"),
      String(row.tier || "UNKNOWN"),
      String(row.regime || "unknown"),
    ].join("__");
    const comboBucket = getBucket(comboMap, comboKey, {
      reason,
      side: String(row.side || "UNKNOWN"),
      tier: String(row.tier || "UNKNOWN"),
      regime: String(row.regime || "unknown"),
    });
    const matchedPath = matchExecutedPathBaseline(row, executedPathIndex);
    for (const bucket of [reasonBucket, comboBucket]) {
      bucket.matured_n += 1;
      if (row.outcome === "TP1_FIRST") bucket.tp1_first_n += 1;
      else if (row.outcome === "SL_FIRST") bucket.sl_first_n += 1;
      else bucket.hold_n += 1;
      if (Number(row.horizon_ret_net) > 0) bucket.horizon_pos_n += 1;
      if (Number.isFinite(Number(row.horizon_ret_net))) {
        bucket.avg_horizon_ret_net_sum += Number(row.horizon_ret_net);
        bucket.avg_horizon_ret_net_n += 1;
      }
      mergeMatchedPathStats(bucket.matched_path, matchedPath);
    }
  }

  function finalizeBucket(row) {
    const maturedN = Number(row.matured_n || 0);
    const tp1Rate = maturedN > 0 ? row.tp1_first_n / maturedN : null;
    const slRate = maturedN > 0 ? row.sl_first_n / maturedN : null;
    const horizonWinRate = maturedN > 0 ? row.horizon_pos_n / maturedN : null;
    const avgRet = row.avg_horizon_ret_net_n > 0 ? row.avg_horizon_ret_net_sum / row.avg_horizon_ret_net_n : null;
    const overallTp1Rate = matured.length > 0 ? (qualityCf.filter((x) => x && x.ok === true && x.outcome === "TP1_FIRST").length / matured.length) : 0.30;
    const overallSlRate = matured.length > 0 ? (qualityCf.filter((x) => x && x.ok === true && x.outcome === "SL_FIRST").length / matured.length) : 0.60;
    const tp1Smoothed = betaPosteriorMean(row.tp1_first_n, maturedN, overallTp1Rate, 8);
    const slSmoothed = betaPosteriorMean(row.sl_first_n, maturedN, overallSlRate, 8);
    const tp1Ci = wilsonInterval(row.tp1_first_n, maturedN);
    const slCi = wilsonInterval(row.sl_first_n, maturedN);
    let verdict = "KEEP";
    if (maturedN < 10) verdict = "HOLD_SAMPLE";
    else if (Number.isFinite(avgRet) && avgRet > 0 && Number.isFinite(tp1Smoothed) && tp1Smoothed >= 0.45 && Number.isFinite(slSmoothed) && slSmoothed <= 0.45) verdict = "REVIEW_SOFTEN";
    else if (Number.isFinite(avgRet) && avgRet < -0.005 && Number.isFinite(slSmoothed) && slSmoothed >= 0.60) verdict = "KEEP_OR_TIGHTEN";
    return {
      ...row,
      tp1_first_rate: tp1Rate,
      sl_first_rate: slRate,
      tp1_first_rate_smoothed: tp1Smoothed,
      sl_first_rate_smoothed: slSmoothed,
      horizon_win_rate: horizonWinRate,
      avg_horizon_ret_net: avgRet,
      tp1_ci_low: tp1Ci.lower,
      tp1_ci_high: tp1Ci.upper,
      sl_ci_low: slCi.lower,
      sl_ci_high: slCi.upper,
      ...finalizeMatchedPathStats(row.matched_path),
      verdict,
    };
  }

  return {
    total_quality_drops_n: qualityDrops.length,
    matured_n: matured.length,
    skipped_n: skipped.length,
    skip_reasons: Array.from(skipReasons.entries())
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => (b.n - a.n) || a.reason.localeCompare(b.reason)),
    by_reason: Array.from(reasonMap.values())
      .map(finalizeBucket)
      .sort((a, b) => (b.matured_n - a.matured_n) || ((a.avg_horizon_ret_net || 0) - (b.avg_horizon_ret_net || 0)) || String(a.reason).localeCompare(String(b.reason))),
    by_reason_side_tier_regime: Array.from(comboMap.values())
      .map(finalizeBucket)
      .sort((a, b) => (b.matured_n - a.matured_n) || ((a.avg_horizon_ret_net || 0) - (b.avg_horizon_ret_net || 0)) || String(a.reason).localeCompare(String(b.reason))),
  };
}

function summarizePineFollowThrough({ quality = {}, barsByMarket = new Map(), tf = TF, horizonMs = PINE_FOLLOW_HORIZON_MS } = {}) {
  const chainRows = Array.isArray(quality && quality.chain_rows) ? quality.chain_rows : [];
  const tierBuckets = new Map();
  const intervalMs = tfIntervalMs(tf);
  const enrichedRows = [];
  function bucketFor(tier) {
    const key = String(tier || "UNKNOWN");
    if (!tierBuckets.has(key)) {
      tierBuckets.set(key, {
        executed_n: 0,
        tp1_time_h: [],
        sl_time_h: [],
        first_exit_time_h: [],
        mfe: [],
        mae: [],
        entropy_score: [],
        coherence_score: [],
        transition_risk: [],
        field_alignment: [],
        domain_wall_density: [],
        susceptibility: [],
        free_energy: [],
        path_rows: [],
      });
    }
    return tierBuckets.get(key);
  }

  for (const row of chainRows) {
    const tier = String(row && row.tier || "UNKNOWN");
    const entryBarMs = toNum(row && row.entry_bar_ms);
    const entryPrice = toNum(row && row.entry_price);
    const side = String(row && row.side || "").toUpperCase();
    const market = String(row && row.market || "").trim().toUpperCase();
    if (!Number.isFinite(entryBarMs) || !Number.isFinite(entryPrice) || !market || !["LONG", "SHORT"].includes(side)) continue;
    const bucket = bucketFor(tier);
    bucket.executed_n += 1;
    const tp1H = hoursBetween(row && row.tp1_ms, entryBarMs);
    const slH = hoursBetween(row && row.sl_ms, entryBarMs);
    const firstExitH = hoursBetween(row && row.first_exit_ms, entryBarMs);
    if (Number.isFinite(tp1H)) bucket.tp1_time_h.push(tp1H);
    if (Number.isFinite(slH)) bucket.sl_time_h.push(slH);
    if (Number.isFinite(firstExitH)) bucket.first_exit_time_h.push(firstExitH);

    const bars = Array.isArray(barsByMarket.get(market)) ? barsByMarket.get(market) : [];
    const endMs = Math.min(
      Number.isFinite(toNum(row && row.first_exit_ms)) ? Number(row.first_exit_ms) : (entryBarMs + horizonMs),
      entryBarMs + horizonMs,
    );
    const pathBars = bars.filter((bar) => Number(bar && bar.timestamp) > entryBarMs && Number(bar && bar.timestamp) <= endMs + intervalMs);
    const mm = computeMfeMae({ entry: entryPrice, bars: pathBars, side });
    if (Number.isFinite(mm.mfe)) bucket.mfe.push(mm.mfe);
    if (Number.isFinite(mm.mae)) bucket.mae.push(mm.mae);
    if (Number.isFinite(toNum(row && row.entropy_score))) bucket.entropy_score.push(Number(row.entropy_score));
    if (Number.isFinite(toNum(row && row.coherence_score))) bucket.coherence_score.push(Number(row.coherence_score));
    if (Number.isFinite(toNum(row && row.transition_risk))) bucket.transition_risk.push(Number(row.transition_risk));
    if (Number.isFinite(toNum(row && row.field_alignment))) bucket.field_alignment.push(Number(row.field_alignment));
    if (Number.isFinite(toNum(row && row.domain_wall_density))) bucket.domain_wall_density.push(Number(row.domain_wall_density));
    if (Number.isFinite(toNum(row && row.susceptibility))) bucket.susceptibility.push(Number(row.susceptibility));
    if (Number.isFinite(toNum(row && row.free_energy))) bucket.free_energy.push(Number(row.free_energy));
    bucket.path_rows.push({
      ok: true,
      tp1_time_h: tp1H,
      sl_time_h: slH,
    });
    enrichedRows.push({
      ...row,
      tp1_time_h: tp1H,
      sl_time_h: slH,
      first_exit_time_h: firstExitH,
      mfe: mm.mfe,
      mae: mm.mae,
    });
  }

  const byTier = {};
  for (const [tier, row] of tierBuckets.entries()) {
    byTier[tier] = {
      executed_n: row.executed_n,
      avg_time_to_tp1_h: avg(row.tp1_time_h),
      median_time_to_tp1_h: median(row.tp1_time_h),
      avg_time_to_sl_h: avg(row.sl_time_h),
      median_time_to_sl_h: median(row.sl_time_h),
      avg_time_to_first_exit_h: avg(row.first_exit_time_h),
      median_time_to_first_exit_h: median(row.first_exit_time_h),
      avg_mfe: avg(row.mfe),
      median_mfe: median(row.mfe),
      avg_mae: avg(row.mae),
      median_mae: median(row.mae),
      avg_entropy_score: avg(row.entropy_score),
      avg_coherence_score: avg(row.coherence_score),
      avg_transition_risk: avg(row.transition_risk),
      avg_field_alignment: avg(row.field_alignment),
      avg_domain_wall_density: avg(row.domain_wall_density),
      avg_susceptibility: avg(row.susceptibility),
      avg_free_energy: avg(row.free_energy),
      survival: buildSurvivalCurve(row.path_rows),
      competing_risk: buildCompetingRiskCurve(row.path_rows),
    };
  }
  return {
    horizon_hours: horizonMs / (60 * 60 * 1000),
    by_tier: byTier,
    enriched_rows: enrichedRows,
  };
}

function buildPineQualityLinkage({ pineFollow = {}, qualityDeep = {} } = {}) {
  const lines = [];
  const byTier = pineFollow && pineFollow.by_tier ? pineFollow.by_tier : {};
  const combos = Array.isArray(qualityDeep && qualityDeep.by_reason_side_tier_regime) ? qualityDeep.by_reason_side_tier_regime : [];
  for (const row of combos.slice(0, 12)) {
    const tierFollow = byTier[row.tier] || {};
    const matchedRet = Number(row.matched_avg_ret_net);
    const droppedRet = Number(row.avg_horizon_ret_net);
    const matchedMfe = Number(row.matched_avg_mfe);
    const matchedMae = Number(row.matched_avg_mae);
    const matchedTp1H = Number(row.matched_avg_time_to_tp1_h);
    const matchedSlH = Number(row.matched_avg_time_to_sl_h);
    let verdict = "KEEP";
    if (row.matured_n >= 10) {
      if (
        Number.isFinite(droppedRet) &&
        Number.isFinite(matchedRet) &&
        droppedRet > matchedRet - 0.001 &&
        droppedRet > -0.002 &&
        Number.isFinite(matchedMfe) &&
        matchedMfe >= 0.01
      ) {
        verdict = "REVIEW_SOFTEN";
      } else if (
        Number.isFinite(droppedRet) &&
        droppedRet < -0.005 &&
        (
          (Number.isFinite(matchedMfe) && Number.isFinite(matchedMae) && matchedMae < -0.008 && matchedMfe < 0.015) ||
          (Number.isFinite(matchedSlH) && matchedSlH < 4)
        )
      ) {
        verdict = "KEEP_OR_TIGHTEN";
      }
    }
    lines.push({
      reason: row.reason,
      side: row.side,
      tier: row.tier,
      regime: row.regime,
      analyzed_n: row.matured_n,
      dropped_avg_ret_net: row.avg_horizon_ret_net,
      matched_support_n: row.matched_support_n,
      matched_pool_avg_n: row.matched_pool_avg_n,
      matched_avg_ret_net: row.matched_avg_ret_net,
      matched_win_rate: row.matched_win_rate,
      matched_avg_mfe: row.matched_avg_mfe,
      matched_avg_mae: row.matched_avg_mae,
      matched_avg_time_to_tp1_h: row.matched_avg_time_to_tp1_h,
      matched_avg_time_to_sl_h: row.matched_avg_time_to_sl_h,
      tier_avg_mfe: tierFollow.avg_mfe ?? null,
      tier_avg_mae: tierFollow.avg_mae ?? null,
      tier_survival: Array.isArray(tierFollow.survival) ? tierFollow.survival : [],
      tier_competing_risk: Array.isArray(tierFollow.competing_risk) ? tierFollow.competing_risk : [],
      verdict,
    });
  }
  return lines
    .sort((a, b) => (b.analyzed_n - a.analyzed_n) || ((a.dropped_avg_ret_net || 0) - (b.dropped_avg_ret_net || 0)));
}

function reasonFamily(reason) {
  const raw = String(reason || "").trim().toUpperCase();
  if (raw.endsWith("_CONF")) return "CONF";
  if (raw.endsWith("_SCORE")) return "SCORE";
  if (raw.endsWith("_REGIME")) return "REGIME";
  return "OTHER";
}

function curvePoint(curve = [], hours = 4) {
  return (Array.isArray(curve) ? curve : []).find((row) => Number(row && row.hours) === Number(hours)) || null;
}

function buildCandidateHints({ tier, family, direction }) {
  const tighten = direction === "TIGHTEN";
  const dirLabel = tighten ? "상향/강화" : "하향/완화";
  const stage1Map = {
    CONF: {
      axis: "shared_confidence_posterior_floor",
      delta: tighten ? +0.02 : -0.02,
      unit: "abs_prob",
      pine_hint: `${LIVE_ENTRY_LABEL} 공용 confidence/probability floor ${dirLabel}`,
    },
    SCORE: {
      axis: tier === "CORE" ? "shared_core_score_floor" : "shared_early_score_floor",
      delta: tighten ? +2 : -2,
      unit: "score_points",
      pine_hint: `${LIVE_ENTRY_LABEL} 공용 score/quality floor ${dirLabel}`,
    },
    REGIME: {
      axis: "shared_regime_transition_confirmation",
      delta: tighten ? +2 : -2,
      unit: "score_points",
      pine_hint: `${LIVE_ENTRY_LABEL} 공용 trend/transition confirmation ${dirLabel}`,
    },
  };
  const hint = stage1Map[family] || {
    axis: "shared_quality_floor",
    delta: tighten ? +0.02 : -0.02,
    unit: "abs_prob",
    pine_hint: `${LIVE_ENTRY_LABEL} 공용 conservative quality floor ${dirLabel}`,
  };
  return {
    pine_component: "PINE_FULL_QUALITY_BUNDLE",
    pine_quality_scope: "REGIME_SCORE_CONF_POSTERIOR_WAVE_EV_V2",
    pine_patch_axis: hint.axis,
    pine_patch_delta: hint.delta,
    pine_patch_unit: hint.unit,
    pine_hint: hint.pine_hint,
    server_stage1_mode: "INTEGRITY_GUARD_ONLY",
    server_stage1_expectation: "NO_SEMANTIC_THRESHOLD_CHANGE",
  };
}

function buildPineStage1PatchCandidates({ current = {}, settings = {} } = {}) {
  const guard = current.sequential_guard || {};
  const linkageRows = Array.isArray(current.pine_quality_linkage) ? current.pine_quality_linkage : [];
  const objective = current.objective || {};
  const patchBudgetVars = Number.isFinite(Number(guard.patch_budget_vars)) ? Number(guard.patch_budget_vars) : 0;
  const guardVerdict = String(guard.verdict || "N/A").toUpperCase();
  const patchReady = objective.enough_sample === true && objective.pass === false && guardVerdict === "NORMAL" && patchBudgetVars > 0;

  if (!linkageRows.length) {
    return {
      verdict: "HOLD",
      ready_for_weekly_patch: false,
      reason: "NO_LINKAGE_EVIDENCE",
      patch_budget_vars: patchBudgetVars,
      candidates: [],
    };
  }

  const groups = new Map();
  for (const row of linkageRows) {
    const family = reasonFamily(row.reason);
    if (!["CONF", "SCORE", "REGIME"].includes(family)) continue;
    const tier = String(row.tier || "UNKNOWN");
    if (!["CORE", "EARLY"].includes(tier)) continue;
    const key = `${tier}__${family}`;
    if (!groups.has(key)) {
      groups.set(key, {
        tier,
        family,
        analyzed_n: 0,
        tighten_votes: 0,
        soften_votes: 0,
        keep_votes: 0,
        dropped_avg_ret_sum: 0,
        dropped_avg_ret_n: 0,
        tp1_4h_sum: 0,
        tp1_4h_n: 0,
        sl_4h_sum: 0,
        sl_4h_n: 0,
        unresolved_4h_sum: 0,
        unresolved_4h_n: 0,
      });
    }
    const bucket = groups.get(key);
    const analyzed = Number(row.analyzed_n || 0);
    bucket.analyzed_n += analyzed;
    if (String(row.verdict || "").toUpperCase() === "KEEP_OR_TIGHTEN") bucket.tighten_votes += analyzed;
    else if (String(row.verdict || "").toUpperCase() === "REVIEW_SOFTEN") bucket.soften_votes += analyzed;
    else bucket.keep_votes += analyzed;
    const droppedRet = toNum(row.dropped_avg_ret_net);
    if (Number.isFinite(droppedRet)) {
      bucket.dropped_avg_ret_sum += droppedRet * Math.max(1, analyzed);
      bucket.dropped_avg_ret_n += Math.max(1, analyzed);
    }
    const p4 = curvePoint(row.tier_competing_risk, 4);
    const tp1_4h = toNum(p4 && p4.tp1_cum_rate);
    const sl_4h = toNum(p4 && p4.sl_cum_rate);
    const unresolved_4h = toNum(p4 && p4.unresolved_rate);
    if (Number.isFinite(tp1_4h)) {
      bucket.tp1_4h_sum += tp1_4h * Math.max(1, analyzed);
      bucket.tp1_4h_n += Math.max(1, analyzed);
    }
    if (Number.isFinite(sl_4h)) {
      bucket.sl_4h_sum += sl_4h * Math.max(1, analyzed);
      bucket.sl_4h_n += Math.max(1, analyzed);
    }
    if (Number.isFinite(unresolved_4h)) {
      bucket.unresolved_4h_sum += unresolved_4h * Math.max(1, analyzed);
      bucket.unresolved_4h_n += Math.max(1, analyzed);
    }
  }

  const candidates = [];
  for (const bucket of groups.values()) {
    const analyzedN = Number(bucket.analyzed_n || 0);
    if (analyzedN < 10) continue;
    const tightenRatio = analyzedN > 0 ? (bucket.tighten_votes / analyzedN) : 0;
    const softenRatio = analyzedN > 0 ? (bucket.soften_votes / analyzedN) : 0;
    const avgDroppedRet = bucket.dropped_avg_ret_n > 0 ? (bucket.dropped_avg_ret_sum / bucket.dropped_avg_ret_n) : null;
    const tp1_4h = bucket.tp1_4h_n > 0 ? (bucket.tp1_4h_sum / bucket.tp1_4h_n) : null;
    const sl_4h = bucket.sl_4h_n > 0 ? (bucket.sl_4h_sum / bucket.sl_4h_n) : null;
    const unresolved_4h = bucket.unresolved_4h_n > 0 ? (bucket.unresolved_4h_sum / bucket.unresolved_4h_n) : null;

    let direction = null;
    let priorityScore = 0;
    if (tightenRatio >= 0.60 && Number.isFinite(avgDroppedRet) && avgDroppedRet <= -0.008) {
      direction = "TIGHTEN";
      priorityScore = analyzedN * Math.max(0.001, Math.abs(avgDroppedRet)) * (1 + Math.max(0, (sl_4h || 0) - (tp1_4h || 0)));
    } else if (softenRatio >= 0.60 && Number.isFinite(avgDroppedRet) && avgDroppedRet >= 0.002 && Number.isFinite(tp1_4h) && Number.isFinite(sl_4h) && tp1_4h >= sl_4h + 0.08) {
      direction = "SOFTEN";
      priorityScore = analyzedN * Math.max(0.001, avgDroppedRet) * (1 + Math.max(0, tp1_4h - sl_4h));
    }
    if (!direction) continue;

    const hints = buildCandidateHints({ tier: bucket.tier, family: bucket.family, direction });
    const actionable = patchReady === true && patchBudgetVars >= 1;
    const status = actionable ? `REVIEW_${direction}` : `WATCHLIST_${direction}`;
    candidates.push({
      candidate_id: `AUTO_${bucket.tier}_${bucket.family}_${direction}`,
      display_candidate_id: `AUTO_LONG_SHORT_${bucket.family}_${direction}`,
      status,
      direction,
      ready_for_weekly_patch: actionable,
      symmetry: "LONG_SHORT_SHARED",
      live_entry_scope: LIVE_ENTRY_SCOPE,
      tier: bucket.tier,
      reason_family: bucket.family,
      analyzed_n: analyzedN,
      tighten_ratio: tightenRatio,
      soften_ratio: softenRatio,
      avg_dropped_ret_net: avgDroppedRet,
      tp1_4h,
      sl_4h,
      unresolved_4h,
      patch_budget_vars_cap: Math.max(0, Math.min(2, patchBudgetVars)),
      pine_component: hints.pine_component,
      pine_quality_scope: hints.pine_quality_scope,
      pine_patch_axis: hints.pine_patch_axis,
      pine_patch_delta: hints.pine_patch_delta,
      pine_patch_unit: hints.pine_patch_unit,
      pine_hint: hints.pine_hint,
      server_stage1_mode: hints.server_stage1_mode,
      server_stage1_expectation: hints.server_stage1_expectation,
      rationale: direction === "TIGHTEN"
        ? `${LIVE_ENTRY_LABEL} 단일 진입 경로에서 ${bucket.family} 계열 드롭 후 후속 수익이 음수라 Pine full-quality bundle 강화 근거가 우세합니다.`
        : `${LIVE_ENTRY_LABEL} 단일 진입 경로에서 ${bucket.family} 계열 드롭 후 후속 수익이 양수이고 초기 TP1 경향이 SL보다 우세해 Pine full-quality bundle 완화 watchlist 근거가 있습니다.`,
      priority_score: priorityScore,
    });
  }

  candidates.sort((a, b) => (Number(b.priority_score || 0) - Number(a.priority_score || 0)) || (Number(b.analyzed_n || 0) - Number(a.analyzed_n || 0)) || String(a.candidate_id).localeCompare(String(b.candidate_id)));
  const limited = candidates.slice(0, Math.max(0, Math.min(3, patchBudgetVars > 0 ? 3 : 1)));

  if (!limited.length) {
    return {
      verdict: "HOLD",
      ready_for_weekly_patch: false,
      reason: patchReady ? "NO_ACTIONABLE_SYMMETRIC_CANDIDATE" : "WATCHLIST_ONLY",
      patch_budget_vars: patchBudgetVars,
      candidates: [],
    };
  }

  return {
    verdict: limited.some((row) => row.ready_for_weekly_patch) ? "ACTIONABLE" : "WATCHLIST_ONLY",
    ready_for_weekly_patch: limited.some((row) => row.ready_for_weekly_patch),
    reason: limited.some((row) => row.ready_for_weekly_patch) ? "SYMMETRIC_CANDIDATES_READY" : "SAMPLE_OR_GUARD_NOT_READY",
    patch_budget_vars: patchBudgetVars,
    candidates: limited,
  };
}

function renderPineStage1PatchCandidatesMarkdown(report = {}) {
  const lines = [
    "# Pine Full-Quality Patch Candidates",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- 대상: ${report.provider || "N/A"} ${report.tf || "N/A"}`,
    `- verdict: ${report.verdict || "N/A"}`,
    `- ready_for_weekly_patch: ${report.ready_for_weekly_patch === true ? "YES" : "NO"}`,
    `- reason: ${report.reason || "N/A"}`,
    `- patch_budget_vars: ${report.patch_budget_vars != null ? report.patch_budget_vars : "N/A"}`,
    "",
    "## Candidates",
  ];
  const rows = Array.isArray(report.candidates) ? report.candidates : [];
  if (!rows.length) {
    lines.push("- hold");
  } else {
    for (const row of rows) {
      lines.push(
        `- ${row.display_candidate_id || displayCandidateId(row)}: ${row.status} / entry=${row.live_entry_scope || LIVE_ENTRY_SCOPE} / family=${row.reason_family} / analyzed=${row.analyzed_n} / ` +
        `avg_ret_net=${signedPct(row.avg_dropped_ret_net)} / 4h TP1=${pct(row.tp1_4h)} / 4h SL=${pct(row.sl_4h)} / 4h unresolved=${pct(row.unresolved_4h)}`
      );
      lines.push(`  - symmetry: ${row.symmetry}`);
      lines.push(`  - pine component: ${row.pine_component} / scope=${row.pine_quality_scope}`);
      lines.push(`  - pine patch: ${row.pine_patch_axis} ${row.pine_patch_delta > 0 ? "+" : ""}${row.pine_patch_delta} ${row.pine_patch_unit}`);
      lines.push(`  - pine hint: ${row.pine_hint}`);
      lines.push(`  - 1차 server mode: ${row.server_stage1_mode} / ${row.server_stage1_expectation}`);
      lines.push(`  - rationale: ${row.rationale}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function readLatestJsonArtifact(fileName) {
  const filePath = path.join(OPS_DAILY_DIR, fileName);
  return {
    filePath,
    data: readJsonRawSafe(filePath, null),
  };
}

function summarizeCanaryGuard(data = {}) {
  const goldenDrift = Number(data && data.golden && data.golden.summary && data.golden.summary.drift || 0);
  const shadowDrift = Number(data && data.shadow && data.shadow.summary && data.shadow.summary.drift || 0);
  return {
    pass: goldenDrift === 0 && shadowDrift === 0,
    golden_drift: goldenDrift,
    shadow_drift: shadowDrift,
  };
}

function readCandidateHistory(filePath) {
  const raw = readJsonRawSafe(filePath, {});
  return Array.isArray(raw && raw.runs) ? raw.runs : [];
}

function writeCandidateHistory(filePath, nextRow) {
  const rows = readCandidateHistory(filePath)
    .filter((row) => row && row.window_key !== nextRow.window_key);
  rows.push(nextRow);
  rows.sort((a, b) => String(a.window_key || "").localeCompare(String(b.window_key || "")));
  writeJson(filePath, { runs: rows });
  return rows;
}

function topCandidateId(autoPatch = {}) {
  return Array.isArray(autoPatch.candidates) && autoPatch.candidates[0]
    ? String(autoPatch.candidates[0].candidate_id || "").trim()
    : "";
}

function topCandidateDisplayId(autoPatch = {}) {
  return Array.isArray(autoPatch.candidates) && autoPatch.candidates[0]
    ? String(autoPatch.candidates[0].display_candidate_id || displayCandidateId(autoPatch.candidates[0]) || "").trim()
    : "";
}

function topCandidateStreak(rows = [], candidateId) {
  const target = String(candidateId || "").trim();
  if (!target) return 0;
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (String(row && row.top_candidate_id || "").trim() !== target) break;
    streak += 1;
  }
  return streak;
}

function findRollbackTarget(weeklyRows = [], {
  currentAppliedStrategyId = null,
  currentPreparedStrategyId = null,
  currentPreparedFilePath = null,
} = {}) {
  const rows = Array.isArray(weeklyRows) ? weeklyRows.slice().reverse() : [];
  const appliedStrategyId = String(currentAppliedStrategyId || "").trim() || null;
  const preparedStrategyId = String(currentPreparedStrategyId || "").trim() || null;
  const preparedFilePath = String(currentPreparedFilePath || "").trim() || null;
  const latestPatched = (
    appliedStrategyId
      ? rows.find((row) =>
        row
        && row.recommended_patch_id
        && row.recommended_patch_id !== "hold"
        && row.created_file_path
        && String(row.created_strategy_id || "").trim() === appliedStrategyId
      )
      : null
  ) || rows.find((row) => row && row.recommended_patch_id && row.recommended_patch_id !== "hold" && row.created_file_path);
  if (!latestPatched) {
    return {
      ready: false,
      reason: "NO_PATCHED_HISTORY",
      rollback_file_path: null,
      based_on_week_key: null,
      based_on_patch_id: null,
    };
  }
  const previousSafe = rows.find((row) =>
    row &&
    row.week_key !== latestPatched.week_key &&
    row.recommended_patch_id &&
    row.recommended_patch_id !== "hold" &&
    row.created_file_path &&
    (!appliedStrategyId || String(row.created_strategy_id || "").trim() !== appliedStrategyId) &&
    (!preparedStrategyId || String(row.created_strategy_id || "").trim() !== preparedStrategyId) &&
    (!preparedFilePath || String(row.created_file_path || "").trim() !== preparedFilePath)
  );
  if (!previousSafe) {
    return {
      ready: false,
      reason: "NO_PREVIOUS_SAFE_FILE",
      rollback_file_path: null,
      based_on_week_key: latestPatched.week_key,
      based_on_patch_id: latestPatched.recommended_patch_id,
    };
  }
  const rollbackPath = String(previousSafe.created_file_path || "").trim();
  return {
    ready: !!(rollbackPath && fs.existsSync(rollbackPath)),
    reason: rollbackPath && fs.existsSync(rollbackPath) ? "ROLLBACK_FILE_READY" : "ROLLBACK_FILE_MISSING",
    rollback_file_path: rollbackPath || null,
    based_on_week_key: latestPatched.week_key,
    based_on_patch_id: latestPatched.recommended_patch_id,
    target_week_key: previousSafe.week_key,
  };
}

function buildPineStage1ChangeControl({ current = {}, nowMeta, mlPolicyReport = null } = {}) {
  const autoPatch = current.pine_stage1_patch_candidates || {};
  const sequentialGuard = current.sequential_guard || {};
  const candidateHistoryPath = path.join(OPS_DAILY_DIR, "pine_stage1_patch_candidates_history.json");
  const canaryArtifact = readLatestJsonArtifact("filter_shadow_canary_latest.json");
  const stageCoverageArtifact = readLatestJsonArtifact("stage_coverage_guard_latest.json");
  const selfEvolutionRuntime = readLatestJsonArtifact("self_evolution_manual_paste_ack_latest.json");
  const weeklyHistory = readHistory(path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json"), "weeks");
  const coverageGuard = stageCoverageArtifact.data && stageCoverageArtifact.data.guard
    ? stageCoverageArtifact.data.guard
    : buildCoverageGuard(mlPolicyReport && mlPolicyReport.data ? mlPolicyReport.data : {});
  const canaryGuard = summarizeCanaryGuard(canaryArtifact.data || {});
  const historyRow = {
    window_key: `${current && current.range && current.range.from_utc || "N/A"}__${current && current.range && current.range.to_utc || "N/A"}`,
    generated_at_kst: nowMeta.kst,
    verdict: autoPatch.verdict || "HOLD",
    ready_for_weekly_patch: autoPatch.ready_for_weekly_patch === true,
    top_candidate_id: topCandidateId(autoPatch),
    candidate_ids: Array.isArray(autoPatch.candidates) ? autoPatch.candidates.map((row) => row.candidate_id) : [],
  };
  const candidateHistoryRows = writeCandidateHistory(candidateHistoryPath, historyRow);
  const streak = topCandidateStreak(candidateHistoryRows, historyRow.top_candidate_id);
  const budget = Number.isFinite(Number(sequentialGuard.patch_budget_vars)) ? Number(sequentialGuard.patch_budget_vars) : 0;
  const guardNormal = String(sequentialGuard.verdict || "").toUpperCase() === "NORMAL";
  const promotionReady = Boolean(
    historyRow.top_candidate_id &&
    historyRow.ready_for_weekly_patch === true &&
    streak >= 2 &&
    guardNormal &&
    budget > 0 &&
    coverageGuard.pass === true &&
    canaryGuard.pass === true
  );
  let promotionReason = "PROMOTION_READY";
  if (!historyRow.top_candidate_id) promotionReason = "NO_TOP_CANDIDATE";
  else if (historyRow.ready_for_weekly_patch !== true) promotionReason = "CANDIDATE_NOT_READY";
  else if (streak < 2) promotionReason = "CANDIDATE_STREAK_SHORT";
  else if (!guardNormal) promotionReason = "SEQUENTIAL_GUARD_BLOCK";
  else if (!(budget > 0)) promotionReason = "PATCH_BUDGET_EXHAUSTED";
  else if (coverageGuard.pass !== true) promotionReason = "COVERAGE_GUARD_BLOCK";
  else if (canaryGuard.pass !== true) promotionReason = "CANARY_GUARD_BLOCK";

  const rollbackBase = findRollbackTarget(weeklyHistory, {
    currentAppliedStrategyId: selfEvolutionRuntime.data && selfEvolutionRuntime.data.applied_strategy_id,
    currentPreparedStrategyId: selfEvolutionRuntime.data && selfEvolutionRuntime.data.prepared_strategy_id,
    currentPreparedFilePath: selfEvolutionRuntime.data && selfEvolutionRuntime.data.prepared_file_path,
  });
  const adverseStreak = Number(sequentialGuard.adverse_streak_n || 0);
  const rollbackReady = rollbackBase.ready === true && (String(sequentialGuard.verdict || "").toUpperCase() === "HOLD" || adverseStreak >= 2);
  const rollbackReason = rollbackReady ? "AUTO_ROLLBACK_READY" : rollbackBase.reason;

  return {
    generated_at_kst: nowMeta.kst,
    verdict: promotionReady ? "PROMOTE_READY" : (rollbackReady ? "ROLLBACK_READY" : "HOLD"),
    candidate_history_path: candidateHistoryPath,
    candidate_history_streak: streak,
    patch_budget_vars: budget,
    canary_guard: canaryGuard,
    coverage_guard: coverageGuard,
    auto_promotion: {
      ready: promotionReady,
      reason: promotionReason,
      candidate_id: historyRow.top_candidate_id || null,
      display_candidate_id: topCandidateDisplayId(autoPatch) || null,
      streak_required: 2,
      streak_current: streak,
    },
    auto_rollback: {
      ready: rollbackReady,
      reason: rollbackReason,
      rollback_file_path: rollbackBase.rollback_file_path,
      based_on_week_key: rollbackBase.based_on_week_key,
      based_on_patch_id: rollbackBase.based_on_patch_id,
      target_week_key: rollbackBase.target_week_key || null,
    },
    artifacts: {
      canary_report: canaryArtifact.filePath,
      stage_coverage_guard: stageCoverageArtifact.filePath,
      weekly_pine_history: path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json"),
    },
  };
}

function renderPineStage1ChangeControlMarkdown(report = {}) {
  const lines = [
    "# Pine Full-Quality ↔ 1차 Guard Change Control",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- verdict: ${report.verdict || "N/A"}`,
    `- patch_budget_vars: ${report.patch_budget_vars != null ? report.patch_budget_vars : "N/A"}`,
    `- candidate streak: ${report.candidate_history_streak != null ? report.candidate_history_streak : "N/A"}`,
    "",
    "## Promotion",
    `- ready: ${report.auto_promotion && report.auto_promotion.ready ? "YES" : "NO"}`,
    `- reason: ${report.auto_promotion && report.auto_promotion.reason || "N/A"}`,
    `- candidate: ${report.auto_promotion && (report.auto_promotion.display_candidate_id || report.auto_promotion.candidate_id) || "N/A"}`,
    "",
    "## Rollback",
    `- ready: ${report.auto_rollback && report.auto_rollback.ready ? "YES" : "NO"}`,
    `- reason: ${report.auto_rollback && report.auto_rollback.reason || "N/A"}`,
    `- rollback_file_path: ${report.auto_rollback && report.auto_rollback.rollback_file_path || "N/A"}`,
    "",
    "## Guards",
    `- canary: ${report.canary_guard && report.canary_guard.pass ? "PASS" : "BLOCK"} / golden=${report.canary_guard && report.canary_guard.golden_drift != null ? report.canary_guard.golden_drift : "N/A"} / shadow=${report.canary_guard && report.canary_guard.shadow_drift != null ? report.canary_guard.shadow_drift : "N/A"}`,
    `- 2차 진입 품질 coverage: ${report.coverage_guard && report.coverage_guard.ai && report.coverage_guard.ai.pass ? "PASS" : "BLOCK"} / sample=${report.coverage_guard && report.coverage_guard.ai && report.coverage_guard.ai.sample_n || 0}`,
    `- 3차 상태 기반 Soft Sizing coverage: ${report.coverage_guard && report.coverage_guard.market && report.coverage_guard.market.pass ? "PASS" : "BLOCK"} / sample=${report.coverage_guard && report.coverage_guard.market && report.coverage_guard.market.sample_n || 0} / ai_bias=${pct(report.coverage_guard && report.coverage_guard.market && report.coverage_guard.market.ai_bias_coverage)}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function summarizeSizingPerformance(chainRows = [], intents = []) {
  const intentMap = new Map();
  for (const row of Array.isArray(intents) ? intents : []) {
    const key = String(row && (row.intent_id || row.entry_event_id) || "").trim();
    if (!key) continue;
    intentMap.set(key, row);
  }
  function emptyRow() {
    return {
      executed_n: 0,
      realized_n: 0,
      win_n: 0,
      avg_ret_net_sum: 0,
      avg_ret_net_n: 0,
      net_pnl_quote: 0,
      fullsize_proxy_pnl_quote: 0,
      saved_loss_quote: 0,
      missed_gain_quote: 0,
    };
  }
  function push(map, key, chain, stageMult, finalMult) {
    if (!map.has(key)) map.set(key, emptyRow());
    const row = map.get(key);
    row.executed_n += 1;
    const realized = chain && chain.realized === true && Number.isFinite(Number(chain.realized_pnl_quote));
    if (!realized) return;
    const pnl = Number(chain.realized_pnl_quote);
    const ret = Number(chain.realized_ret_net);
    row.realized_n += 1;
    if (Number.isFinite(ret)) {
      row.avg_ret_net_sum += ret;
      row.avg_ret_net_n += 1;
      if (ret > 0) row.win_n += 1;
    }
    row.net_pnl_quote += pnl;
    if (Number.isFinite(stageMult) && stageMult > 0) {
      const proxy = pnl / stageMult;
      row.fullsize_proxy_pnl_quote += proxy;
      if (pnl < 0 && proxy < pnl) row.saved_loss_quote += Math.abs(proxy - pnl);
      if (pnl > 0 && proxy > pnl) row.missed_gain_quote += (proxy - pnl);
    }
    if (Number.isFinite(finalMult) && finalMult > 0) {
      // no-op: final mult is carried by dedicated group key only
    }
  }
  const byMarket = new Map();
  const byEv = new Map();
  const byFinal = new Map();
  for (const chain of Array.isArray(chainRows) ? chainRows : []) {
    const intent = intentMap.get(String(chain && chain.entry_event_id || "").trim());
    const feat = resolveFeatures(intent || {});
    const marketMult = toNum(feat.market_bias_mult) ?? 1;
    const evMult = toNum(feat.ev_mult) ?? 1;
    const finalMult = toNum(feat.market_ev_final_mult) ?? (Number.isFinite(marketMult) && Number.isFinite(evMult) ? (marketMult * evMult) : 1);
    push(byMarket, `${((marketMult || 0) * 100).toFixed(0)}%`, chain, marketMult, finalMult);
    push(byEv, `${((evMult || 0) * 100).toFixed(0)}%`, chain, evMult, finalMult);
    push(byFinal, `${((finalMult || 0) * 100).toFixed(0)}%`, chain, finalMult, finalMult);
  }
  const finish = (map) => Array.from(map.entries()).map(([bucket, row]) => ({
    bucket,
    executed_n: row.executed_n,
    realized_n: row.realized_n,
    win_rate: row.realized_n > 0 ? (row.win_n / row.realized_n) : null,
    avg_ret_net: row.avg_ret_net_n > 0 ? (row.avg_ret_net_sum / row.avg_ret_net_n) : null,
    net_pnl_quote: row.realized_n > 0 ? row.net_pnl_quote : null,
    fullsize_proxy_pnl_quote: row.realized_n > 0 ? row.fullsize_proxy_pnl_quote : null,
    saved_loss_quote: row.saved_loss_quote || null,
    missed_gain_quote: row.missed_gain_quote || null,
  })).sort((a, b) => Number(b.executed_n || 0) - Number(a.executed_n || 0) || a.bucket.localeCompare(b.bucket));
  return {
    market_bias: finish(byMarket),
    ev_band: finish(byEv),
    final_mult: finish(byFinal),
  };
}

function buildWeeklyFebtShadowSummary({ current = {}, phase0 = null } = {}) {
  const chainRows = current && current.quality && Array.isArray(current.quality.chain_rows)
    ? current.quality.chain_rows
    : [];
  return {
    shadow: summarizeFebtShadowReplacement(chainRows),
    phase0_overlap: summarizeFebtPhase0Overlap(phase0),
  };
}

function summarizeSideTierRegime({ signals = [], drops = [], quality = {} } = {}) {
  const agg = new Map();
  const ensure = (key, meta) => {
    if (!agg.has(key)) {
      agg.set(key, {
        ...meta,
        candidate_n: 0,
        dropped_n: 0,
        executed_n: 0,
        realized_n: 0,
        win_n: 0,
        avg_ret_net_sum: 0,
        avg_ret_net_n: 0,
      });
    }
    return agg.get(key);
  };
  const signalKeyMeta = new Map();
  for (const row of Array.isArray(signals) ? signals : []) {
    const key = makeEntryRowKey(row);
    const side = resolveSide(row);
    const tier = resolveTier(row && row.event);
    const regime = resolveRegime(row);
    if (!key || !side || !tier) continue;
    signalKeyMeta.set(key, { side, tier, regime });
    const bucket = ensure(`${side}__${tier}__${regime}`, { side, tier, regime });
    bucket.candidate_n += 1;
    bucket.executed_n += 1;
  }
  for (const row of Array.isArray(drops) ? drops : []) {
    const side = resolveSide(row);
    const tier = resolveTier(row && row.event);
    const regime = resolveRegime(row);
    if (!side || !tier) continue;
    const bucket = ensure(`${side}__${tier}__${regime}`, { side, tier, regime });
    bucket.candidate_n += 1;
    bucket.dropped_n += 1;
  }
  for (const row of Array.isArray(quality.chain_rows) ? quality.chain_rows : []) {
    const matchKey = `${String(row.market || "").trim().toUpperCase()}__${String(row.tf || "").trim()}__${Number(row.entry_bar_ms || 0)}__${String(row.entry_signal_type || "").trim().toUpperCase()}`;
    const meta = signalKeyMeta.get(matchKey);
    if (!meta) continue;
    const bucket = ensure(`${meta.side}__${meta.tier}__${meta.regime}`, meta);
    if (row.realized === true && Number.isFinite(toNum(row.realized_ret_net))) {
      bucket.realized_n += 1;
      if (Number(row.realized_ret_net) > 0) bucket.win_n += 1;
      bucket.avg_ret_net_sum += Number(row.realized_ret_net);
      bucket.avg_ret_net_n += 1;
    }
  }
  return Array.from(agg.values())
    .map((row) => ({
      side: row.side,
      tier: row.tier,
      regime: row.regime,
      candidate_n: row.candidate_n,
      dropped_n: row.dropped_n,
      executed_n: row.executed_n,
      realized_n: row.realized_n,
      win_rate: row.realized_n > 0 ? (row.win_n / row.realized_n) : null,
      avg_ret_net: row.avg_ret_net_n > 0 ? (row.avg_ret_net_sum / row.avg_ret_net_n) : null,
    }))
    .sort((a, b) => Number(b.candidate_n || 0) - Number(a.candidate_n || 0) || `${a.side}/${a.tier}/${a.regime}`.localeCompare(`${b.side}/${b.tier}/${b.regime}`))
    .slice(0, 20);
}

function renderMarkdown({ nowMeta, current, previous, recommendations, settings, artifacts, provider, tf, bestFebtContract = null }) {
  const lines = [];
  lines.push("# Weekly Filter Governance");
  lines.push("");
  lines.push(`- 실행 시각: ${nowMeta.kst}`);
  lines.push(`- 대상: ${provider} ${tf}`);
  lines.push(`- 현재 윈도우: ${current.range.from_utc} -> ${current.range.to_utc}`);
  lines.push(`- 직전 윈도우: ${previous.range.from_utc} -> ${previous.range.to_utc}`);
  lines.push("");
  lines.push("## 목표 함수 판정");
  lines.push("- 주의: realized/win/net/avg_ret_net은 `윈도우 안에 진입한 entry cohort` 중 `윈도우 종료 시점까지 실현 완료된 체인` 기준입니다.");
  lines.push(`- 목표: win ${pct(OBJECTIVE_MIN_WIN_RATE)} / net 양수 / expectancy 양수 / 월간 순수익 ${signedNum(OBJECTIVE_MIN_MONTHLY_NET_KRW, 0)} KRW 이상`);
  lines.push(`- 현재: ${current.objective.verdict} / entry-cohort realized=${current.overall.realized_n} / win=${pct(current.overall.win_rate)} / net=${signedNum(current.overall.net_pnl_quote, 2)} / avg_ret_net=${signedPct(current.overall.avg_ret_net)} / 월간페이스=${signedNum(current.objective.monthly_run_rate_krw, 0)} KRW (${current.objective.monthly_source_days}d 기준)`);
  lines.push(`- 직전: ${previous.objective.verdict} / entry-cohort realized=${previous.overall.realized_n} / win=${pct(previous.overall.win_rate)} / net=${signedNum(previous.overall.net_pnl_quote, 2)} / avg_ret_net=${signedPct(previous.overall.avg_ret_net)} / 월간페이스=${signedNum(previous.objective.monthly_run_rate_krw, 0)} KRW (${previous.objective.monthly_source_days}d 기준)`);
  lines.push(`- delta: win=${signedPct(deltaNum(current.overall.win_rate, previous.overall.win_rate))} / net=${signedNum(deltaNum(current.overall.net_pnl_quote, previous.overall.net_pnl_quote), 2)} / avg_ret_net=${signedPct(deltaNum(current.overall.avg_ret_net, previous.overall.avg_ret_net))} / 월간페이스=${signedNum(deltaNum(current.objective.monthly_run_rate_krw, previous.objective.monthly_run_rate_krw), 0)}`);
  lines.push(`- 현재 월간 목표: ${current.objective.monthly_pass ? "PASS" : "FAIL"} / source realized=${current.objective.monthly_source_realized_n}`);
  lines.push(`- 현재 window exit fills=${current.window_exit_fills_n} / 직전 window exit fills=${previous.window_exit_fills_n}`);
  lines.push("");
  lines.push("## 드롭 단계 분포(현재)");
  for (const key of STAGE_KEYS) {
    lines.push(`- ${STAGE_LABELS[key]}: ${current.drops.counts[key] || 0}`);
  }
  lines.push("");
  lines.push("## 드롭 상위 사유(현재)");
  for (const row of current.drops.top_reasons.slice(0, 8)) {
    const stageKey = resolveStageKey(row.stage || classifySignalReasonStage(row.reason));
    lines.push(`- ${displayStageReasonForUser(row.reason, stageKey)}${stageKey === "QUALITY" ? ` (${row.reason})` : ""}: ${row.n}`);
  }
  lines.push("");
  lines.push("## 라이브 엔트리 품질 요약(현재)");
  lines.push(...renderTierLines(current.quality.by_tier));
  lines.push("");
  lines.push("## Pine 후속 품질 심화(현재)");
  lines.push(`- horizon: ${current.pine_follow_through && current.pine_follow_through.horizon_hours ? current.pine_follow_through.horizon_hours : (PINE_FOLLOW_HOURS)}시간`);
  const liveFollow = resolveLiveFollowThroughRow(current.pine_follow_through || {});
  if (liveFollow) {
    lines.push(
      `- ${LIVE_ENTRY_LABEL}: executed=${liveFollow.executed_n} / ` +
      `time_to_tp1 avg ${signedNum(liveFollow.avg_time_to_tp1_h, 2)}h median ${signedNum(liveFollow.median_time_to_tp1_h, 2)}h / ` +
      `time_to_sl avg ${signedNum(liveFollow.avg_time_to_sl_h, 2)}h median ${signedNum(liveFollow.median_time_to_sl_h, 2)}h / ` +
      `first_exit avg ${signedNum(liveFollow.avg_time_to_first_exit_h, 2)}h / ` +
      `MFE avg ${signedPct(liveFollow.avg_mfe)} median ${signedPct(liveFollow.median_mfe)} / ` +
      `MAE avg ${signedPct(liveFollow.avg_mae)} median ${signedPct(liveFollow.median_mae)} / ` +
      formatPhysicsSummary(liveFollow)
    );
    if (Array.isArray(liveFollow.survival) && liveFollow.survival.length) {
      lines.push(`  - survival: ${liveFollow.survival.map((p) => `${p.hours}h TP1 ${pct(p.tp1_rate)} / SL ${pct(p.sl_rate)}`).join(" / ")}`);
    }
    if (Array.isArray(liveFollow.competing_risk) && liveFollow.competing_risk.length) {
      lines.push(`  - competing-risk: ${formatCompetingRiskCurve(liveFollow.competing_risk)}`);
    }
  }
  lines.push("");
  lines.push("## 표본 충분성(7/14/28/56일)");
  for (const row of current.sufficiency_rows || []) {
    lines.push(
      `- ${row.days}d: entry-cohort realized=${row.pine_realized_n} (${row.pine_enough ? "충분" : "부족"}) / ` +
      `window exit fills=${row.window_exit_fills_n} / ` +
      `1차 drops=${row.quality_drops_n} (${row.quality_enough ? "충분" : "부족"}) / ` +
      `2차 drops=${row.ai_drops_n} (${row.ai_enough ? "충분" : "부족"}) / ` +
      `3차 drops=${row.market_drops_n} (${row.market_enough ? "충분" : "부족"}) / ` +
      `4차 eval=${row.ev_evaluated_n} (${row.ev_enough ? "충분" : "부족"}) / ` +
      `5차 wait=${row.timing_drops_n} (${row.timing_enough ? "충분" : "부족"})`
    );
  }
  lines.push("");
  lines.push("## regime 저장 누락률(현재)");
  lines.push(`- signals: missing=${current.regime_missing.signals.missing_n}/${current.regime_missing.signals.scoped_n} (${pct(current.regime_missing.signals.missing_rate)})`);
  lines.push(`- signals_dropped: missing=${current.regime_missing.drops.missing_n}/${current.regime_missing.drops.scoped_n} (${pct(current.regime_missing.drops.missing_rate)})`);
  lines.push(`- order_intents_paper: missing=${current.regime_missing.intents.missing_n}/${current.regime_missing.intents.scoped_n} (${pct(current.regime_missing.intents.missing_rate)})`);
  lines.push("");
  lines.push(`## 드롭 반사실 검증(현재, ${COUNTERFACTUAL_HOURS}시간)`);
  const cf = current.drop_counterfactual && current.drop_counterfactual.overall ? current.drop_counterfactual.overall : {};
  lines.push(`- analyzed=${cf.matured_n || 0} / TP1_first=${pct(cf.tp1_first_rate)} / SL_first=${pct(cf.sl_first_rate)} / both=${pct(cf.ambiguous_both_rate)} / hold=${pct(cf.hold_rate)} / horizon_win=${pct(cf.horizon_pos_rate)} / avg_ret_net=${signedPct(cf.avg_horizon_ret_net)}`);
  for (const line of buildCounterfactualFeatureSummaryLines(current.drop_counterfactual || {})) {
    lines.push(`- ${line}`);
  }
  if (Array.isArray(cf.survival) && cf.survival.length) {
    lines.push(`- survival: ${cf.survival.map((p) => `${p.hours}h TP1 ${pct(p.tp1_rate)} / SL ${pct(p.sl_rate)}`).join(" / ")}`);
  }
  if (Array.isArray(cf.competing_risk) && cf.competing_risk.length) {
    lines.push(`- competing-risk: ${formatCompetingRiskCurve(cf.competing_risk)}`);
  }
  for (const key of ["QUALITY", "AI", "MARKET", "EV", "TIMING"]) {
    const row = current.drop_counterfactual && current.drop_counterfactual.by_stage && current.drop_counterfactual.by_stage[key];
    if (!row || !row.matured_n) continue;
    lines.push(`- ${STAGE_LABELS[key]}: analyzed=${row.matured_n} / TP1_first=${pct(row.tp1_first_rate)} / SL_first=${pct(row.sl_first_rate)} / horizon_win=${pct(row.horizon_pos_rate)} / avg_ret_net=${signedPct(row.avg_horizon_ret_net)}`);
    if (Array.isArray(row.survival) && row.survival.length) {
      lines.push(`  - survival: ${row.survival.map((p) => `${p.hours}h TP1 ${pct(p.tp1_rate)} / SL ${pct(p.sl_rate)}`).join(" / ")}`);
    }
    if (Array.isArray(row.competing_risk) && row.competing_risk.length) {
      lines.push(`  - competing-risk: ${formatCompetingRiskCurve(row.competing_risk)}`);
    }
  }
  if (Array.isArray(current.drop_counterfactual && current.drop_counterfactual.top_reasons) && current.drop_counterfactual.top_reasons.length) {
    lines.push("- 상위 사유:");
    for (const row of current.drop_counterfactual.top_reasons.slice(0, 6)) {
      const stageKey = resolveStageKey(row.stage || classifySignalReasonStage(row.reason));
      lines.push(`  - ${displayStageReasonForUser(row.reason, stageKey)}${stageKey === "QUALITY" ? ` (${row.reason})` : ""}: analyzed=${row.matured_n} / TP1_first=${pct(row.tp1_first_rate)} / SL_first=${pct(row.sl_first_rate)}`);
    }
  }
  lines.push("");
  lines.push("## 1차 상태/무결성 심화(현재)");
  const qualityDeep = current.quality_deep_dive || {};
  lines.push(`- total quality drops=${qualityDeep.total_quality_drops_n || 0} / matured=${qualityDeep.matured_n || 0} / skipped=${qualityDeep.skipped_n || 0}`);
  if (Array.isArray(qualityDeep.skip_reasons) && qualityDeep.skip_reasons.length) {
    lines.push(`- skip reasons: ${qualityDeep.skip_reasons.slice(0, 6).map((row) => `${row.reason} ${row.n}`).join(" / ")}`);
  }
  lines.push("- reason별:");
  for (const row of (qualityDeep.by_reason || []).slice(0, 8)) {
    lines.push(
      `  - ${displayStageReasonForUser(row.reason, "QUALITY")} (${row.reason}): analyzed=${row.matured_n} / TP1_first=${pct(row.tp1_first_rate)} [${pct(row.tp1_ci_low)}~${pct(row.tp1_ci_high)}] / ` +
      `SL_first=${pct(row.sl_first_rate)} [${pct(row.sl_ci_low)}~${pct(row.sl_ci_high)}] / smoothed TP1=${pct(row.tp1_first_rate_smoothed)} / smoothed SL=${pct(row.sl_first_rate_smoothed)} / ` +
      `horizon_win=${pct(row.horizon_win_rate)} / avg_ret_net=${signedPct(row.avg_horizon_ret_net)} / 판정=${row.verdict}`
    );
  }
  lines.push("- reason × side × live-scope × regime:");
  for (const row of (qualityDeep.by_reason_side_tier_regime || []).slice(0, 10)) {
    lines.push(
      `  - ${displayStageReasonForUser(row.reason, "QUALITY")} (${row.reason}) / ${row.side} / ${LIVE_ENTRY_SCOPE} / ${row.regime}: analyzed=${row.matured_n} / TP1_first=${pct(row.tp1_first_rate)} / ` +
      `SL_first=${pct(row.sl_first_rate)} / horizon_win=${pct(row.horizon_win_rate)} / avg_ret_net=${signedPct(row.avg_horizon_ret_net)} / ` +
      `matched_support=${row.matched_support_n} / matched_pool_avg=${row.matched_pool_avg_n === null || row.matched_pool_avg_n === undefined ? "N/A" : Number(row.matched_pool_avg_n).toFixed(2)} / matched_win=${pct(row.matched_win_rate)} / matched_avg_ret_net=${signedPct(row.matched_avg_ret_net)} / ` +
      `matched_MFE=${signedPct(row.matched_avg_mfe)} / matched_MAE=${signedPct(row.matched_avg_mae)} / matched_tp1_t=${signedNum(row.matched_avg_time_to_tp1_h, 2)}h / matched_sl_t=${signedNum(row.matched_avg_time_to_sl_h, 2)}h / 판정=${row.verdict}`
    );
  }
  lines.push("");
  lines.push("## Pine ↔ 1차 상태/무결성 연동 판단(현재)");
  for (const row of (current.pine_quality_linkage || []).slice(0, 10)) {
    lines.push(
      `- ${displayStageReasonForUser(row.reason, "QUALITY")} (${row.reason}) / ${row.side} / ${LIVE_ENTRY_SCOPE} / ${row.regime}: analyzed=${row.analyzed_n} / dropped_avg_ret_net=${signedPct(row.dropped_avg_ret_net)} / ` +
      `matched_support=${row.matched_support_n} / matched_pool_avg=${row.matched_pool_avg_n === null || row.matched_pool_avg_n === undefined ? "N/A" : Number(row.matched_pool_avg_n).toFixed(2)} / matched_avg_ret_net=${signedPct(row.matched_avg_ret_net)} / matched_win=${pct(row.matched_win_rate)} / ` +
      `matched_MFE=${signedPct(row.matched_avg_mfe)} / matched_MAE=${signedPct(row.matched_avg_mae)} / matched_tp1_t=${signedNum(row.matched_avg_time_to_tp1_h, 2)}h / matched_sl_t=${signedNum(row.matched_avg_time_to_sl_h, 2)}h / ` +
      `live_avg_mfe=${signedPct(row.tier_avg_mfe)} / live_avg_mae=${signedPct(row.tier_avg_mae)} / 판정=${row.verdict}`
    );
    if (Array.isArray(row.tier_survival) && row.tier_survival.length) {
      lines.push(`  - live survival: ${row.tier_survival.map((p) => `${p.hours}h TP1 ${pct(p.tp1_rate)} / SL ${pct(p.sl_rate)}`).join(" / ")}`);
    }
    if (Array.isArray(row.tier_competing_risk) && row.tier_competing_risk.length) {
      lines.push(`  - tier competing-risk: ${formatCompetingRiskCurve(row.tier_competing_risk)}`);
    }
  }
  lines.push("");
  lines.push("## Pine 변경 예산 및 연속 가드");
  lines.push(`- verdict=${current.sequential_guard && current.sequential_guard.verdict || "N/A"} / adverse_streak=${current.sequential_guard && current.sequential_guard.adverse_streak_n || 0} / patch_budget_vars=${current.sequential_guard && current.sequential_guard.patch_budget_vars != null ? current.sequential_guard.patch_budget_vars : "N/A"}`);
  if (Array.isArray(current.sequential_guard && current.sequential_guard.recent_assessments)) {
    for (const row of current.sequential_guard.recent_assessments.slice(0, 4)) {
      lines.push(`- ${row.week_key || "N/A"} / qa=${row.qa_pass === true ? "PASS" : "FAIL"} / assessment=${row.assessment || "N/A"} / patch=${row.recommended_patch_id || "N/A"}`);
    }
  }
  lines.push("");
  lines.push("## Pine Full-Quality 자동 패치 후보(1차 guard 연계)");
  const autoPatch = current.pine_stage1_patch_candidates || {};
  lines.push(`- verdict=${autoPatch.verdict || "N/A"} / ready=${autoPatch.ready_for_weekly_patch === true ? "YES" : "NO"} / reason=${autoPatch.reason || "N/A"} / budget=${autoPatch.patch_budget_vars != null ? autoPatch.patch_budget_vars : "N/A"}`);
  if (Array.isArray(autoPatch.candidates) && autoPatch.candidates.length) {
    for (const row of autoPatch.candidates) {
      lines.push(
        `- ${row.display_candidate_id || displayCandidateId(row)}: ${row.status} / entry=${row.live_entry_scope || LIVE_ENTRY_SCOPE} / family=${row.reason_family} / analyzed=${row.analyzed_n} / ` +
        `avg_ret_net=${signedPct(row.avg_dropped_ret_net)} / 4h TP1=${pct(row.tp1_4h)} / 4h SL=${pct(row.sl_4h)} / 4h unresolved=${pct(row.unresolved_4h)}`
      );
      lines.push(`  - pine component: ${row.pine_component} / scope=${row.pine_quality_scope}`);
      lines.push(`  - pine patch: ${row.pine_patch_axis} ${row.pine_patch_delta > 0 ? "+" : ""}${row.pine_patch_delta} ${row.pine_patch_unit}`);
      lines.push(`  - pine hint: ${row.pine_hint}`);
      lines.push(`  - 1차 server mode: ${row.server_stage1_mode} / ${row.server_stage1_expectation}`);
      lines.push(`  - symmetry: ${row.symmetry} / rationale: ${row.rationale}`);
    }
  } else {
    lines.push("- hold");
  }
  lines.push("");
  lines.push("## Pine Full-Quality ↔ 1차 Guard Change Control");
  const changeControl = current.pine_stage1_change_control || {};
  lines.push(`- verdict=${changeControl.verdict || "N/A"} / patch_budget=${changeControl.patch_budget_vars != null ? changeControl.patch_budget_vars : "N/A"} / streak=${changeControl.candidate_history_streak != null ? changeControl.candidate_history_streak : "N/A"}`);
  lines.push(`- auto_promotion=${changeControl.auto_promotion && changeControl.auto_promotion.ready ? "YES" : "NO"} / reason=${changeControl.auto_promotion && changeControl.auto_promotion.reason || "N/A"} / candidate=${changeControl.auto_promotion && (changeControl.auto_promotion.display_candidate_id || changeControl.auto_promotion.candidate_id) || "N/A"}`);
  lines.push(`- auto_rollback=${changeControl.auto_rollback && changeControl.auto_rollback.ready ? "YES" : "NO"} / reason=${changeControl.auto_rollback && changeControl.auto_rollback.reason || "N/A"} / target=${changeControl.auto_rollback && changeControl.auto_rollback.rollback_file_path || "N/A"}`);
  lines.push(`- canary=${changeControl.canary_guard && changeControl.canary_guard.pass ? "PASS" : "BLOCK"} / coverage=${changeControl.coverage_guard && changeControl.coverage_guard.pass ? "PASS" : "BLOCK"}`);
  lines.push("");
  lines.push("## side × live-scope × regime 분해(현재)");
  for (const row of (current.side_tier_regime || []).slice(0, 12)) {
    lines.push(`- ${row.side}/${LIVE_ENTRY_SCOPE}/${row.regime}: candidates=${row.candidate_n} / dropped=${row.dropped_n} / executed=${row.executed_n} / entry-cohort realized=${row.realized_n} / win=${pct(row.win_rate)} / avg_ret_net=${signedPct(row.avg_ret_net)}`);
  }
  lines.push("");
  lines.push("## 주간 권고 및 운영값(1~5차)");
  lines.push(`- 1차 상태/무결성: ${recommendations.QUALITY.action} / ${recommendations.QUALITY.reason}`);
  lines.push(`- 2차 진입 품질: ${recommendations.AI.action} / ${recommendations.AI.reason}`);
  lines.push(`- 3차 상태 기반 Soft Sizing: ${recommendations.MARKET.action} / ${recommendations.MARKET.reason}`);
  lines.push(`- 4차 EV/시간가치층 참조: 복합 기대값 하한 기본 ${pct(settings.ev_gate_tp1_prob_min)} / ${LIVE_ENTRY_LABEL} threshold ${pct(settings.ev_gate_tp1_prob_min_early)}`);
  lines.push(`- 3차 상태 기반 Soft Sizing 세부: neutral ${pct(settings.ai_bias_gate_neutral_mult)} / opposite ${pct(settings.ai_bias_gate_opposite_mult)} / strong score ${pct(settings.ai_bias_gate_strong_opposite_score)} / strong conf ${pct(settings.ai_bias_gate_strong_opposite_conf)}`);
  lines.push(`- 4차 EV/시간가치층 복합 기대값 band: full ${pct(settings.ev_gate_tp1_prob_full)} / kill ${pct(settings.ev_gate_tp1_prob_kill)} / mid ${pct(settings.ev_gate_qty_scale_mid)} / low ${pct(settings.ev_gate_qty_scale_low)}`);
  lines.push(`- 5차 WAIT 타이밍층: streak ${settings.wait_one_bar_same_dir_streak_min} / chase ${ratioX(settings.wait_one_bar_chase_ratio_min)} / close ${pct(settings.wait_one_bar_last_close_control_min)} / body ${pct(settings.wait_one_bar_last_dir_body_min)} / wick ${pct(settings.wait_one_bar_last_opposite_wick_max)} / move1 ${pct(settings.wait_one_bar_recent_move1_pct_min)} / counter ${settings.wait_one_bar_counter_dir_bars_max}`);
  if (artifacts.febt_phase0_summary) {
    lines.push(`- FEBT Phase0: coverage ${pct(artifacts.febt_phase0_summary.legacy_wait_coverage_rate)} / observed ${artifacts.febt_phase0_summary.legacy_wait_observed_chain_n || 0} / immediate win ${pct(artifacts.febt_phase0_summary.immediate_win_rate)} / saved_loss ${pct(artifacts.febt_phase0_summary.saved_loss_pct)} / missed_gain ${pct(artifacts.febt_phase0_summary.missed_gain_pct)} / delta ${signedPct(artifacts.febt_phase0_summary.saved_loss_minus_missed_gain)}`);
    lines.push(`- FEBT bridge: webhook->fill p95 ${artifacts.febt_phase0_summary.webhook_to_fill_p95_ms != null ? `${Number(artifacts.febt_phase0_summary.webhook_to_fill_p95_ms).toFixed(0)}ms` : "N/A"} / dup ${artifacts.febt_phase0_summary.duplicate_count || 0} / reject ${artifacts.febt_phase0_summary.reject_count || 0}`);
    lines.push(`- FEBT overlap: compared ${artifacts.febt_phase0_summary.overlap_compared_n || 0} / wait ${formatNamedBreakdown(artifacts.febt_phase0_summary.overlap_wait_action_breakdown || [])}`);
    lines.push(`- FEBT overlap top: wait x market ${formatPairBreakdown(artifacts.febt_phase0_summary.overlap_market_action_pairs || [])} / wait x timing ${formatPairBreakdown(artifacts.febt_phase0_summary.overlap_entry_exec_timing_pairs || [])}`);
  }
  if (current.febt_shadow) {
    lines.push(`- FEBT shadow: sampled ${current.febt_shadow.sampled_n || 0} / disagree ${current.febt_shadow.disagree_n || 0} / fallback ${current.febt_shadow.fallback_n || 0} / reason ${formatNamedBreakdown(current.febt_shadow.by_reason || [])} / verdict ${formatNamedBreakdown(current.febt_shadow.by_verdict || [])}`);
    lines.push(`- FEBT replacement proxy: recovered ${current.febt_shadow.candidate_recovered_n || 0} / blocked ${current.febt_shadow.candidate_blocked_n || 0} / wait ${current.febt_shadow.candidate_wait_n || 0} / replacement ${ratioX(current.febt_shadow.projected_replacement_ratio)} / count ${ratioX(current.febt_shadow.projected_count_ratio)} / delta ${signedNum(current.febt_shadow.projected_net_signal_delta_n, 0)}`);
  }
  if (bestFebtContract && typeof bestFebtContract === "object") {
    lines.push(`- BEST/FEBT contract: ${bestFebtContract.mode || "N/A"} / tightening ${bestFebtContract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${bestFebtContract.recovery_priority ? "FIRST" : "NORMAL"} / replacement ${ratioX(bestFebtContract.projected_replacement_ratio)} / count ${ratioX(bestFebtContract.projected_count_ratio_global)} / delta ${signedNum(bestFebtContract.projected_net_signal_delta_n, 0)}`);
  }
  lines.push("");
  lines.push("## 3차/4차 실제 성과 분해(현재)");
  lines.push("- 주의: 아래 realized/actual/fullsize_proxy는 `현재 윈도우 entry cohort 중 이미 실현 완료된 체인`만 집계합니다.");
  lines.push("- 3차 상태 기반 Soft Sizing:");
  for (const row of (current.sizing && current.sizing.market_bias || []).slice(0, 8)) {
    lines.push(`  - ${row.bucket}: entry-cohort realized=${row.realized_n} / win=${pct(row.win_rate)} / avg_ret_net=${signedPct(row.avg_ret_net)} / actual=${signedNum(row.net_pnl_quote, 2)} / fullsize_proxy=${signedNum(row.fullsize_proxy_pnl_quote, 2)} / saved_loss=${signedNum(row.saved_loss_quote, 2)} / missed_gain=${signedNum(row.missed_gain_quote, 2)}`);
  }
  lines.push("- 4차 EV/시간가치층 band:");
  for (const row of (current.sizing && current.sizing.ev_band || []).slice(0, 8)) {
    lines.push(`  - ${row.bucket}: entry-cohort realized=${row.realized_n} / win=${pct(row.win_rate)} / avg_ret_net=${signedPct(row.avg_ret_net)} / actual=${signedNum(row.net_pnl_quote, 2)} / fullsize_proxy=${signedNum(row.fullsize_proxy_pnl_quote, 2)} / saved_loss=${signedNum(row.saved_loss_quote, 2)} / missed_gain=${signedNum(row.missed_gain_quote, 2)}`);
  }
  lines.push("- 5차 WAIT 타이밍층:");
  lines.push(`  - streak=${settings.wait_one_bar_same_dir_streak_min} / chase=${ratioX(settings.wait_one_bar_chase_ratio_min)} / close=${pct(settings.wait_one_bar_last_close_control_min)} / body=${pct(settings.wait_one_bar_last_dir_body_min)} / wick=${pct(settings.wait_one_bar_last_opposite_wick_max)} / move1=${pct(settings.wait_one_bar_recent_move1_pct_min)} / counter=${settings.wait_one_bar_counter_dir_bars_max}`);
  lines.push("");
  lines.push("## 로컬 증분 캐시");
  lines.push(`- signals: ${artifacts.cache.signals.filePath} / cached=${artifacts.cache.signals.count} / new=${artifacts.cache.signals.fetched_new} / overlap=${artifacts.cache.signals.overlap_fetched}`);
  lines.push(`- signals_dropped: ${artifacts.cache.drops.filePath} / cached=${artifacts.cache.drops.count} / new=${artifacts.cache.drops.fetched_new} / overlap=${artifacts.cache.drops.overlap_fetched}`);
  lines.push(`- fills_paper: ${artifacts.cache.fills.filePath} / cached=${artifacts.cache.fills.count} / new=${artifacts.cache.fills.fetched_new} / overlap=${artifacts.cache.fills.overlap_fetched}`);
  lines.push(`- order_intents_paper: ${artifacts.cache.intents.filePath} / cached=${artifacts.cache.intents.count} / new=${artifacts.cache.intents.fetched_new} / overlap=${artifacts.cache.intents.overlap_fetched}`);
  lines.push("");
  lines.push("## 현재 운영값 스냅샷");
  for (const row of buildUserFacingSettingsSnapshot(settings)) {
    lines.push(`- ${row.label}: ${row.value}`);
  }
  lines.push("");
  lines.push("## 연계 보고서");
  lines.push(`- 주간 Pine: ${artifacts.weekly_pine_report || "N/A"}`);
  lines.push(`- EV 자동보정: ${artifacts.ev_tune_report || "N/A"}`);
  lines.push(`- WAIT 자동보정: ${artifacts.wait_tune_report || "N/A"}`);
  lines.push(`- ML 정책: ${artifacts.ml_policy_report || "N/A"}`);
  lines.push(`- FEBT Phase 0: ${artifacts.febt_phase0_report || "N/A"}`);
  lines.push(`- Pine full-quality 후보: ${artifacts.pine_quality_patch_candidates_md || artifacts.pine_stage1_patch_candidates_md || "N/A"}`);
  lines.push(`- Pine full-quality change control: ${artifacts.pine_quality_change_control_md || artifacts.pine_stage1_change_control_md || "N/A"}`);
  lines.push(`- JSON: ${artifacts.jsonPath}`);
  return `${lines.join("\n")}\n`;
}

async function buildWindowSummary({ signals, fills, drops, intents = [], fromMs, toMs, provider, tf, sysCfg = {}, includeExtended = false, nowMs = Date.now() }) {
  const filteredSignals = filterRows(signals, { exchange: provider, tf, fromMs, toMs, drops: false });
  const filteredFillsWindow = (Array.isArray(fills) ? fills : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const ms = resolveFillMs(row);
    if (ex !== provider) return false;
    if (tf && rowTf && rowTf !== tf) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) return false;
    return true;
  });
  const qualityFills = (Array.isArray(fills) ? fills : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const ms = resolveFillMs(row);
    if (ex !== provider) return false;
    if (tf && rowTf && rowTf !== tf) return false;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) return false;
    return true;
  });
  const filteredDrops = filterRows(drops, { exchange: provider, tf, fromMs, toMs, drops: true });
  const filteredIntents = (Array.isArray(intents) ? intents : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const event = String(row && row.event || "").trim().toUpperCase();
    const ms = toNum(row && row.signal_bar_close_time_utc_ms) ?? resolveDocMs(row);
    if (provider && ex !== provider) return false;
    if (tf && rowTf && rowTf !== tf) return false;
    if (!isEntryTierEvent(event)) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) return false;
    return true;
  });
  const quality = await summarizePineSignalQuality({
    signals: filteredSignals,
    fills: qualityFills,
    intents: filteredIntents,
    exchange: provider,
    tf,
    fromMs,
    toMs,
  });
  const overall = aggregateOverallFromQuality(quality);
  const observedDays = Math.max(1, Math.round((Math.max(toMs, fromMs) - fromMs) / (24 * 60 * 60 * 1000)));
  const objective = buildObjectiveVerdict(overall, {
    realizedMinSample: REALIZED_MIN_SAMPLE,
    minWinRate: OBJECTIVE_MIN_WIN_RATE,
    minMonthlyNetKrw: OBJECTIVE_MIN_MONTHLY_NET_KRW,
    monthlyNetPnlKrw: overall.net_pnl_quote,
    monthlyObservedDays: observedDays,
    monthDays: OBJECTIVE_MONTH_DAYS,
  });
  const dropsSummary = summarizeDropStages(filteredDrops);
  const evEvaluatedN = summarizeEvEvaluatedEntries(intents, filteredDrops, { exchange: provider, tf, fromMs, toMs });
  const regimeMissing = {
    signals: summarizeRegimeCoverage(filteredSignals, { label: "signals" }),
    drops: summarizeRegimeCoverage(filteredDrops, { label: "signals_dropped" }),
    intents: summarizeRegimeCoverage(filteredIntents, { label: "order_intents_paper" }),
  };
  const windowExitFillsN = filteredFillsWindow.filter((row) => String(row && row.event || "").trim().toUpperCase().startsWith("EXIT_")).length;
  let dropCounterfactual = null;
  let qualityDeepDive = null;
  let pineFollowThrough = null;
  let pineQualityLinkage = [];
  let sideTierRegime = [];
  let sizing = { market_bias: [], ev_band: [], final_mult: [] };
  if (includeExtended) {
    const barsByMarket = await loadBarsForDropCounterfactual(filteredDrops, {
      exchange: provider,
      tf,
      horizonMs: COUNTERFACTUAL_HORIZON_MS,
    });
    const cfRows = filteredDrops.map((row) => {
      const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
      return evaluateDropCounterfactual(row, barsByMarket.get(market) || [], {
        sysCfg,
        exchange: provider,
        horizonMs: COUNTERFACTUAL_HORIZON_MS,
        nowMs,
      });
    });
    dropCounterfactual = summarizeDropCounterfactual(cfRows);
    const pineBarsByMarket = await loadBarsForPineFollowThrough(quality.chain_rows, {
      exchange: provider,
      tf,
      horizonMs: PINE_FOLLOW_HORIZON_MS,
    });
    pineFollowThrough = summarizePineFollowThrough({
      quality,
      barsByMarket: pineBarsByMarket,
      tf,
      horizonMs: PINE_FOLLOW_HORIZON_MS,
    });
    qualityDeepDive = buildQualityDeepDive({
      drops: filteredDrops,
      cfRows,
      executedChains: Array.isArray(pineFollowThrough && pineFollowThrough.enriched_rows)
        ? pineFollowThrough.enriched_rows
        : quality.chain_rows,
    });
    pineQualityLinkage = buildPineQualityLinkage({ pineFollow: pineFollowThrough, qualityDeep: qualityDeepDive });
    sideTierRegime = summarizeSideTierRegime({ signals: filteredSignals, drops: filteredDrops, quality });
    sizing = summarizeSizingPerformance(quality.chain_rows, filteredIntents);
  }
  return {
    range: { from_ms: fromMs, to_ms: toMs, from_utc: toIso(fromMs), to_utc: toIso(toMs) },
    signals_n: filteredSignals.length,
    fills_n: filteredFillsWindow.length,
    drops_n: filteredDrops.length,
    quality,
    overall,
    objective,
    drops: dropsSummary,
    ev_evaluated_n: evEvaluatedN,
    regime_missing: regimeMissing,
    window_exit_fills_n: windowExitFillsN,
    drop_counterfactual: dropCounterfactual,
    quality_deep_dive: qualityDeepDive,
    pine_follow_through: pineFollowThrough,
    pine_quality_linkage: pineQualityLinkage,
    side_tier_regime: sideTierRegime,
    sizing,
    febt_shadow: buildWeeklyFebtShadowSummary({ current: { quality }, phase0: null }).shadow,
  };
}

async function main() {
  loadLocalEnv();
  const nowMeta = nowKstMeta();
  const todayStartMs = kstStartOfTodayUtcMs(nowMeta.nowMs);
  const currentFromMs = todayStartMs - (WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const previousFromMs = todayStartMs - (WINDOW_DAYS * 2 * 24 * 60 * 60 * 1000);
  const previousToMs = currentFromMs;
  const currentToMs = todayStartMs;
  const previousMonthlyFromMs = previousToMs - (OBJECTIVE_MONTHLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [sysRes, signalsRes, dropsRes, fillsRes, intentsRes] = await Promise.all([
    getSystemSettingsForProvider(PROVIDER, 0),
    getCachedRecentByCreatedAt("signals", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("order_intents_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
  ]);
  const sysCfg = sysRes && sysRes.data ? sysRes.data : {};
  const signals = signalsRes.rows;
  const drops = dropsRes.rows;
  const fills = fillsRes.rows;
  const intents = intentsRes.rows;

  const current = await buildWindowSummary({
    signals, fills, drops, intents,
    fromMs: currentFromMs,
    toMs: currentToMs,
    provider: PROVIDER,
    tf: TF,
    sysCfg,
    includeExtended: true,
    nowMs: nowMeta.nowMs,
  });
  const previous = await buildWindowSummary({
    signals, fills, drops, intents,
    fromMs: previousFromMs,
    toMs: previousToMs,
    provider: PROVIDER,
    tf: TF,
    sysCfg,
  });
  const sufficiencyWindows = [];
  for (const days of SUFFICIENCY_WINDOWS) {
    const fromMs = todayStartMs - (days * 24 * 60 * 60 * 1000);
    const row = await buildWindowSummary({
      signals, fills, drops, intents,
      fromMs,
      toMs: currentToMs,
      provider: PROVIDER,
      tf: TF,
      sysCfg,
      includeExtended: false,
      nowMs: nowMeta.nowMs,
    });
    row.days = days;
    sufficiencyWindows.push(row);
  }
  const currentMonthlyWindow = sufficiencyWindows.find((row) => Number(row.days) === OBJECTIVE_MONTHLY_WINDOW_DAYS) || null;
  const previousMonthly = await buildWindowSummary({
    signals, fills, drops, intents,
    fromMs: previousMonthlyFromMs,
    toMs: previousToMs,
    provider: PROVIDER,
    tf: TF,
    sysCfg,
    includeExtended: false,
    nowMs: nowMeta.nowMs,
  });
  current.objective = buildObjectiveVerdict(current.overall, {
    realizedMinSample: REALIZED_MIN_SAMPLE,
    minWinRate: OBJECTIVE_MIN_WIN_RATE,
    minMonthlyNetKrw: OBJECTIVE_MIN_MONTHLY_NET_KRW,
    monthlyNetPnlKrw: currentMonthlyWindow && currentMonthlyWindow.overall
      ? currentMonthlyWindow.overall.net_pnl_quote
      : current.overall.net_pnl_quote,
    monthlyObservedDays: currentMonthlyWindow ? OBJECTIVE_MONTHLY_WINDOW_DAYS : WINDOW_DAYS,
    monthDays: OBJECTIVE_MONTH_DAYS,
  });
  previous.objective = buildObjectiveVerdict(previous.overall, {
    realizedMinSample: REALIZED_MIN_SAMPLE,
    minWinRate: OBJECTIVE_MIN_WIN_RATE,
    minMonthlyNetKrw: OBJECTIVE_MIN_MONTHLY_NET_KRW,
    monthlyNetPnlKrw: previousMonthly && previousMonthly.overall
      ? previousMonthly.overall.net_pnl_quote
      : previous.overall.net_pnl_quote,
    monthlyObservedDays: OBJECTIVE_MONTHLY_WINDOW_DAYS,
    monthDays: OBJECTIVE_MONTH_DAYS,
  });
  current.objective.monthly_source_days = currentMonthlyWindow ? OBJECTIVE_MONTHLY_WINDOW_DAYS : WINDOW_DAYS;
  current.objective.monthly_source_realized_n = currentMonthlyWindow && currentMonthlyWindow.overall
    ? Number(currentMonthlyWindow.overall.realized_n || 0)
    : Number(current.overall.realized_n || 0);
  previous.objective.monthly_source_days = OBJECTIVE_MONTHLY_WINDOW_DAYS;
  previous.objective.monthly_source_realized_n = previousMonthly && previousMonthly.overall
    ? Number(previousMonthly.overall.realized_n || 0)
    : Number(previous.overall.realized_n || 0);
  current.sufficiency_rows = buildSufficiencyRows({ windows: sufficiencyWindows });
  current.sequential_guard = buildSequentialChangeGuard(path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json"));

  const settings = buildSettingsSnapshot(sysCfg);
  const recommendations = {
    QUALITY: pickStageRecommendation({ stageKey: "QUALITY", current, previous, objective: current.objective, settings }),
    AI: pickStageRecommendation({ stageKey: "AI", current, previous, objective: current.objective, settings }),
    MARKET: pickStageRecommendation({ stageKey: "MARKET", current, previous, objective: current.objective, settings }),
  };
  current.pine_stage1_patch_candidates = buildPineStage1PatchCandidates({ current, settings });
  const mlPolicyJson = readLatestJsonArtifact("ml_filter_policy_latest.json");
  current.pine_stage1_change_control = buildPineStage1ChangeControl({
    current,
    nowMeta,
    mlPolicyReport: mlPolicyJson,
  });
  if (!(current.pine_stage1_change_control.coverage_guard && current.pine_stage1_change_control.coverage_guard.ai && current.pine_stage1_change_control.coverage_guard.ai.pass)) {
    recommendations.AI = { action: "HOLD", reason: "AI_COVERAGE_BLOCK" };
  }
  if (!(current.pine_stage1_change_control.coverage_guard && current.pine_stage1_change_control.coverage_guard.market && current.pine_stage1_change_control.coverage_guard.market.pass)) {
    recommendations.MARKET = { action: "HOLD", reason: "MARKET_COVERAGE_BLOCK" };
  }

  const weeklyPineReport = findLatestFile(/_weekly_pine_upgrade\.md$/);
  const evCompositeTuneLatestMd = path.join(OPS_DAILY_DIR, "ev_composite_threshold_tune_latest.md");
  const evLegacyTuneLatestMd = path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.md");
  const evTuneReport = fs.existsSync(evCompositeTuneLatestMd)
    ? { filePath: evCompositeTuneLatestMd }
    : (fs.existsSync(evLegacyTuneLatestMd)
      ? { filePath: evLegacyTuneLatestMd }
      : findLatestFile(/_ev_(tp1|composite)_threshold_tune\.md$/));
  const waitTuneReport = fs.existsSync(path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.md"))
    ? { filePath: path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.md") }
    : findLatestFile(/_wait_one_bar_tune\.md$/);
  const mlPolicyReport = fs.existsSync(path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.md"))
    ? { filePath: path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.md") }
    : findLatestFile(/_ml_filter_policy\.md$/);
  const febtPhase0Report = fs.existsSync(FEBT_PHASE0_LATEST_MD)
    ? { filePath: FEBT_PHASE0_LATEST_MD }
    : findLatestFile(/_febt_phase0_baseline\.md$/);
  const febtPhase0Latest = readJsonRawSafe(FEBT_PHASE0_LATEST_JSON, null);
  const febtPhase0Summary = febtPhase0Latest && febtPhase0Latest.legacy_wait_baseline
    ? {
      legacy_wait_coverage_rate: toNum(febtPhase0Latest.legacy_wait_baseline.legacy_wait_coverage_rate),
      legacy_wait_observed_chain_n: toNum(febtPhase0Latest.legacy_wait_baseline.legacy_wait_observed_chain_n),
      immediate_win_rate: toNum(febtPhase0Latest.legacy_wait_baseline.immediate_win_rate),
      saved_loss_pct: toNum(febtPhase0Latest.legacy_wait_baseline.saved_loss_pct),
      missed_gain_pct: toNum(febtPhase0Latest.legacy_wait_baseline.missed_gain_pct),
      saved_loss_minus_missed_gain: toNum(febtPhase0Latest.legacy_wait_baseline.saved_loss_minus_missed_gain),
      webhook_to_fill_p95_ms: toNum(febtPhase0Latest.bridge_latency && febtPhase0Latest.bridge_latency.webhook_to_fill_ms && febtPhase0Latest.bridge_latency.webhook_to_fill_ms.p95),
      duplicate_count: toNum(febtPhase0Latest.bridge_latency && febtPhase0Latest.bridge_latency.duplicate_count) || 0,
      reject_count: toNum(febtPhase0Latest.bridge_latency && febtPhase0Latest.bridge_latency.reject_count) || 0,
      overlap_compared_n: toNum(febtPhase0Latest.legacy_wait_overlap && febtPhase0Latest.legacy_wait_overlap.compared_n) || 0,
      overlap_wait_action_breakdown: Array.isArray(febtPhase0Latest.legacy_wait_overlap && febtPhase0Latest.legacy_wait_overlap.wait_action_breakdown)
        ? febtPhase0Latest.legacy_wait_overlap.wait_action_breakdown.slice(0, 4)
        : [],
      overlap_market_action_pairs: Array.isArray(febtPhase0Latest.legacy_wait_overlap && febtPhase0Latest.legacy_wait_overlap.market_state_action_pairs)
        ? febtPhase0Latest.legacy_wait_overlap.market_state_action_pairs.slice(0, 4)
        : [],
      overlap_entry_exec_timing_pairs: Array.isArray(febtPhase0Latest.legacy_wait_overlap && febtPhase0Latest.legacy_wait_overlap.entry_exec_timing_pairs)
        ? febtPhase0Latest.legacy_wait_overlap.entry_exec_timing_pairs.slice(0, 4)
        : [],
      overlap_ev_policy_source_pairs: Array.isArray(febtPhase0Latest.legacy_wait_overlap && febtPhase0Latest.legacy_wait_overlap.ev_policy_source_pairs)
        ? febtPhase0Latest.legacy_wait_overlap.ev_policy_source_pairs.slice(0, 4)
        : [],
    }
    : null;

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    tf: TF,
    objective: {
      min_win_rate: OBJECTIVE_MIN_WIN_RATE,
      net_positive_required: true,
      ev_positive_required: true,
      min_monthly_net_krw: OBJECTIVE_MIN_MONTHLY_NET_KRW,
      monthly_window_days: OBJECTIVE_MONTHLY_WINDOW_DAYS,
      realized_min_sample: REALIZED_MIN_SAMPLE,
    },
    current,
    previous,
    settings_snapshot: settings,
    settings_snapshot_rows: buildUserFacingSettingsSnapshot(settings),
    recommendations,
    artifacts: {
      weekly_pine_report: weeklyPineReport ? weeklyPineReport.filePath : null,
      ev_tune_report: evTuneReport ? evTuneReport.filePath : null,
      wait_tune_report: waitTuneReport ? waitTuneReport.filePath : null,
      ml_policy_report: mlPolicyReport ? mlPolicyReport.filePath : null,
      febt_phase0_report: febtPhase0Report ? febtPhase0Report.filePath : null,
      febt_phase0_summary: febtPhase0Summary,
      cache: {
        signals: signalsRes.meta,
        drops: dropsRes.meta,
        fills: fillsRes.meta,
        intents: intentsRes.meta,
      },
    },
  };
  const weeklyFebtShadowSummary = buildWeeklyFebtShadowSummary({ current, phase0: febtPhase0Latest });
  report.current.febt_shadow = weeklyFebtShadowSummary.shadow;
  report.artifacts.febt_overlap_summary = weeklyFebtShadowSummary.phase0_overlap;
  const latestObjectiveSupervisor = readJsonRawSafe(path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"), null);
  report.current.best_febt_tuning_contract = deriveBestFebtTuningContract({
    governance: report,
    objectiveSupervisor: latestObjectiveSupervisor,
  });
  report.artifacts.objective_supervisor_report = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");
  if (report.current && report.current.quality && report.current.quality.by_tier) {
    report.current.quality.by_tier_rows = tierMapToRows(report.current.quality.by_tier);
  }
  if (report.previous && report.previous.quality && report.previous.quality.by_tier) {
    report.previous.quality.by_tier_rows = tierMapToRows(report.previous.quality.by_tier);
  }
  if (report.current && report.current.pine_follow_through && report.current.pine_follow_through.by_tier) {
    report.current.pine_follow_through.by_tier_rows = tierMapToRows(report.current.pine_follow_through.by_tier);
  }
  const liveFollowSummary = resolveLiveFollowThroughRow(current.pine_follow_through || {});

  const jsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_weekly_filter_governance.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_weekly_filter_governance.md`);
  const patchCandidatesJsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_pine_stage1_patch_candidates.json`);
  const patchCandidatesMdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_pine_stage1_patch_candidates.md`);
  const changeControlJsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_pine_stage1_change_control.json`);
  const changeControlMdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_pine_stage1_change_control.md`);
  const pineQualityPatchCandidatesJsonLatest = path.join(OPS_DAILY_DIR, "pine_quality_patch_candidates_latest.json");
  const pineQualityPatchCandidatesMdLatest = path.join(OPS_DAILY_DIR, "pine_quality_patch_candidates_latest.md");
  const pineQualityChangeControlJsonLatest = path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.json");
  const pineQualityChangeControlMdLatest = path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.md");
  report.artifacts.jsonPath = jsonPath;
  report.artifacts.pine_stage1_patch_candidates_json = patchCandidatesJsonPath;
  report.artifacts.pine_stage1_patch_candidates_md = patchCandidatesMdPath;
  report.artifacts.pine_stage1_change_control_json = changeControlJsonPath;
  report.artifacts.pine_stage1_change_control_md = changeControlMdPath;
  report.artifacts.pine_quality_patch_candidates_json = pineQualityPatchCandidatesJsonLatest;
  report.artifacts.pine_quality_patch_candidates_md = pineQualityPatchCandidatesMdLatest;
  report.artifacts.pine_quality_change_control_json = pineQualityChangeControlJsonLatest;
  report.artifacts.pine_quality_change_control_md = pineQualityChangeControlMdLatest;
  const reportWithDisplay = wrapDisplayAndRawReport(report);
  const patchCandidatesReport = wrapDisplayAndRawReport({
    generated_at_kst: report.generated_at_kst,
    provider: report.provider,
    tf: report.tf,
    verdict: current.pine_stage1_patch_candidates.verdict,
    ready_for_weekly_patch: current.pine_stage1_patch_candidates.ready_for_weekly_patch,
    reason: current.pine_stage1_patch_candidates.reason,
    patch_budget_vars: current.pine_stage1_patch_candidates.patch_budget_vars,
    candidates: current.pine_stage1_patch_candidates.candidates,
  });
  const changeControlReport = wrapDisplayAndRawReport(current.pine_stage1_change_control);
  writeJson(jsonPath, reportWithDisplay);
  writeJson(patchCandidatesJsonPath, patchCandidatesReport);
  writeText(patchCandidatesMdPath, renderPineStage1PatchCandidatesMarkdown({
    generated_at_kst: report.generated_at_kst,
    provider: report.provider,
    tf: report.tf,
    verdict: current.pine_stage1_patch_candidates.verdict,
    ready_for_weekly_patch: current.pine_stage1_patch_candidates.ready_for_weekly_patch,
    reason: current.pine_stage1_patch_candidates.reason,
    patch_budget_vars: current.pine_stage1_patch_candidates.patch_budget_vars,
    candidates: current.pine_stage1_patch_candidates.candidates,
  }));
  writeJson(changeControlJsonPath, changeControlReport);
  writeText(changeControlMdPath, renderPineStage1ChangeControlMarkdown(current.pine_stage1_change_control));
  writeText(mdPath, renderMarkdown({
    nowMeta,
    current,
    previous,
    recommendations,
    settings,
    artifacts: {
      weekly_pine_report: report.artifacts.weekly_pine_report,
      ev_tune_report: report.artifacts.ev_tune_report,
      wait_tune_report: report.artifacts.wait_tune_report,
      ml_policy_report: report.artifacts.ml_policy_report,
      febt_phase0_report: report.artifacts.febt_phase0_report,
      febt_phase0_summary: report.artifacts.febt_phase0_summary,
      pine_stage1_patch_candidates_md: patchCandidatesMdPath,
      pine_stage1_change_control_md: changeControlMdPath,
      pine_quality_patch_candidates_md: pineQualityPatchCandidatesMdLatest,
      pine_quality_change_control_md: pineQualityChangeControlMdLatest,
      cache: report.artifacts.cache,
      jsonPath,
    },
    provider: PROVIDER,
    tf: TF,
    bestFebtContract: report.current.best_febt_tuning_contract,
  }));
  copyLatest(jsonPath, path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json"));
  copyLatest(mdPath, path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.md"));
  copyLatest(patchCandidatesJsonPath, path.join(OPS_DAILY_DIR, "pine_stage1_patch_candidates_latest.json"));
  copyLatest(patchCandidatesMdPath, path.join(OPS_DAILY_DIR, "pine_stage1_patch_candidates_latest.md"));
  copyLatest(changeControlJsonPath, path.join(OPS_DAILY_DIR, "pine_stage1_change_control_latest.json"));
  copyLatest(changeControlMdPath, path.join(OPS_DAILY_DIR, "pine_stage1_change_control_latest.md"));
  copyLatest(patchCandidatesJsonPath, pineQualityPatchCandidatesJsonLatest);
  copyLatest(patchCandidatesMdPath, pineQualityPatchCandidatesMdLatest);
  copyLatest(changeControlJsonPath, pineQualityChangeControlJsonLatest);
  copyLatest(changeControlMdPath, pineQualityChangeControlMdLatest);

  const weeklyPinePath = report.artifacts.weekly_pine_report || "N/A";
  const evTunePath = report.artifacts.ev_tune_report || "N/A";
  const waitTunePath = report.artifacts.wait_tune_report || "N/A";
  const mlPolicyPath = report.artifacts.ml_policy_report || "N/A";
  const patchCandidatePath = patchCandidatesMdPath;
  const changeControlPath = changeControlMdPath;
  const layerLines = buildWeeklyTelegramLayerLines({
    current,
    recommendations,
    settings,
    phase0: febtPhase0Latest,
    bestFebtContract: report.current.best_febt_tuning_contract,
  });
  if (String(process.env.WEEKLY_FILTER_GOVERNANCE_SKIP_TELEGRAM || "0").trim() !== "1") {
    await sendKoreanTelegramSummary({
      title: `[주간 전략 점검] ${PROVIDER}`,
      severity: current.objective.pass ? "INFO" : (current.objective.enough_sample ? "WARN" : "INFO"),
      provider: PROVIDER,
      sections: [
      {
        header: "이번 주 목표 점검",
        lines: [
          `목표 win ${pct(OBJECTIVE_MIN_WIN_RATE)} / net 양수 / expectancy 양수 / 월간 ${signedNum(OBJECTIVE_MIN_MONTHLY_NET_KRW, 0)} KRW+`,
          `현재 ${current.objective.verdict} / entry-cohort realized ${current.overall.realized_n} / window exits ${current.window_exit_fills_n} / win ${pct(current.overall.win_rate)} / net ${signedNum(current.overall.net_pnl_quote, 2)} / avg_ret_net ${signedPct(current.overall.avg_ret_net)} / 월간페이스 ${signedNum(current.objective.monthly_run_rate_krw, 0)} KRW`,
          `직전 ${previous.objective.verdict} / entry-cohort realized ${previous.overall.realized_n} / window exits ${previous.window_exit_fills_n} / win ${pct(previous.overall.win_rate)} / net ${signedNum(previous.overall.net_pnl_quote, 2)} / avg_ret_net ${signedPct(previous.overall.avg_ret_net)} / 월간페이스 ${signedNum(previous.objective.monthly_run_rate_krw, 0)} KRW`,
          `delta win ${signedPct(deltaNum(current.overall.win_rate, previous.overall.win_rate))} / net ${signedNum(deltaNum(current.overall.net_pnl_quote, previous.overall.net_pnl_quote), 2)} / avg_ret_net ${signedPct(deltaNum(current.overall.avg_ret_net, previous.overall.avg_ret_net))} / 월간페이스 ${signedNum(deltaNum(current.objective.monthly_run_rate_krw, previous.objective.monthly_run_rate_krw), 0)} KRW`,
        ],
      },
      {
        header: "드롭 단계",
        lines: [
          `${STAGE_LABELS.QUALITY} ${current.drops.counts.QUALITY || 0}건`,
          `${STAGE_LABELS.AI} ${current.drops.counts.AI || 0}건`,
          `${STAGE_LABELS.MARKET} ${current.drops.counts.MARKET || 0}건`,
          `${STAGE_LABELS.EV} ${current.drops.counts.EV || 0}건`,
          `${STAGE_LABELS.TIMING} ${current.drops.counts.TIMING || 0}건`,
        ],
      },
      {
        header: "현재 필터 계층",
        lines: [
          ...layerLines,
          `Pine full-quality 후보 ${current.pine_stage1_patch_candidates && current.pine_stage1_patch_candidates.verdict || "N/A"} / ${current.pine_stage1_patch_candidates && Array.isArray(current.pine_stage1_patch_candidates.candidates) && current.pine_stage1_patch_candidates.candidates[0] ? (current.pine_stage1_patch_candidates.candidates[0].display_candidate_id || displayCandidateId(current.pine_stage1_patch_candidates.candidates[0])) : "hold"}`,
        ],
      },
      {
        header: "표본과 드롭 검증",
        lines: [
          `7d entry-cohort realized ${current.sufficiency_rows[0].pine_realized_n} / window exit fills ${current.window_exit_fills_n} / 1차 ${current.sufficiency_rows[0].quality_drops_n} / 2차 ${current.sufficiency_rows[0].ai_drops_n} / 3차 ${current.sufficiency_rows[0].market_drops_n} / 4차 eval ${current.sufficiency_rows[0].ev_evaluated_n} / 5차 wait ${current.sufficiency_rows[0].timing_drops_n}`,
          `드롭 반사실 analyzed ${current.drop_counterfactual && current.drop_counterfactual.overall ? current.drop_counterfactual.overall.matured_n : 0} / TP1_first ${pct(current.drop_counterfactual && current.drop_counterfactual.overall && current.drop_counterfactual.overall.tp1_first_rate)} / SL_first ${pct(current.drop_counterfactual && current.drop_counterfactual.overall && current.drop_counterfactual.overall.sl_first_rate)}`,
          ...buildCounterfactualFeatureSummaryLines(current.drop_counterfactual || {}),
          `1차 무결성 심화 matured ${current.quality_deep_dive ? current.quality_deep_dive.matured_n : 0} / skipped ${current.quality_deep_dive ? current.quality_deep_dive.skipped_n : 0} / top ${current.quality_deep_dive && current.quality_deep_dive.by_reason && current.quality_deep_dive.by_reason[0] ? `${current.quality_deep_dive.by_reason[0].reason} ${current.quality_deep_dive.by_reason[0].verdict}` : "N/A"}`,
          `Pine 후속 ${LIVE_ENTRY_LABEL} MFE ${pct(liveFollowSummary && liveFollowSummary.avg_mfe)} / MAE ${pct(liveFollowSummary && liveFollowSummary.avg_mae)} / ${formatPhysicsSummary(liveFollowSummary || {})} / survival 4h ${pct(liveFollowSummary && Array.isArray(liveFollowSummary.survival) ? (liveFollowSummary.survival.find((x) => Number(x.hours) === 4) || {}).tp1_rate : null)}`,
          `Pine↔1차 guard ${current.sequential_guard ? current.sequential_guard.verdict : "N/A"} / budget ${current.sequential_guard && current.sequential_guard.patch_budget_vars != null ? current.sequential_guard.patch_budget_vars : "N/A"}변수`,
          `regime 누락 signals ${pct(current.regime_missing && current.regime_missing.signals && current.regime_missing.signals.missing_rate)} / drops ${pct(current.regime_missing && current.regime_missing.drops && current.regime_missing.drops.missing_rate)} / intents ${pct(current.regime_missing && current.regime_missing.intents && current.regime_missing.intents.missing_rate)}`,
          `FEBT shadow sampled ${current.febt_shadow ? current.febt_shadow.sampled_n : 0} / disagree ${current.febt_shadow ? current.febt_shadow.disagree_n : 0} / fallback ${current.febt_shadow ? current.febt_shadow.fallback_n : 0} / reason ${formatNamedBreakdown(current.febt_shadow && current.febt_shadow.by_reason || [])}`,
          `FEBT replacement recovered ${current.febt_shadow ? current.febt_shadow.candidate_recovered_n : 0} / blocked ${current.febt_shadow ? current.febt_shadow.candidate_blocked_n : 0} / wait ${current.febt_shadow ? current.febt_shadow.candidate_wait_n : 0} / replacement ${ratioX(current.febt_shadow && current.febt_shadow.projected_replacement_ratio)} / count ${ratioX(current.febt_shadow && current.febt_shadow.projected_count_ratio)}`,
          `BEST/FEBT contract ${current.best_febt_tuning_contract ? current.best_febt_tuning_contract.mode : "N/A"} / tightening ${current.best_febt_tuning_contract && current.best_febt_tuning_contract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${current.best_febt_tuning_contract && current.best_febt_tuning_contract.recovery_priority ? "FIRST" : "NORMAL"}`,
        ],
      },
      {
        header: "승격/롤백 가드",
        lines: [
          `promotion ${current.pine_stage1_change_control && current.pine_stage1_change_control.auto_promotion && current.pine_stage1_change_control.auto_promotion.ready ? "READY" : "HOLD"} / ${current.pine_stage1_change_control && current.pine_stage1_change_control.auto_promotion && current.pine_stage1_change_control.auto_promotion.reason || "N/A"} / candidate ${current.pine_stage1_change_control && current.pine_stage1_change_control.auto_promotion && (current.pine_stage1_change_control.auto_promotion.display_candidate_id || current.pine_stage1_change_control.auto_promotion.candidate_id) || "N/A"}`,
          `rollback ${current.pine_stage1_change_control && current.pine_stage1_change_control.auto_rollback && current.pine_stage1_change_control.auto_rollback.ready ? "READY" : "HOLD"} / ${current.pine_stage1_change_control && current.pine_stage1_change_control.auto_rollback && current.pine_stage1_change_control.auto_rollback.reason || "N/A"}`,
          `canary ${current.pine_stage1_change_control && current.pine_stage1_change_control.canary_guard && current.pine_stage1_change_control.canary_guard.pass ? "PASS" : "BLOCK"} / coverage ${current.pine_stage1_change_control && current.pine_stage1_change_control.coverage_guard && current.pine_stage1_change_control.coverage_guard.pass ? "PASS" : "BLOCK"}`,
        ],
      },
      {
        header: "연계 보고서",
        lines: [weeklyPinePath, evTunePath, waitTunePath, mlPolicyPath, report.artifacts.febt_phase0_report || "N/A", patchCandidatePath, changeControlPath, mdPath, jsonPath],
      },
      ],
    });
  }

  console.log(JSON.stringify({
    ok: true,
    generated_at_kst: report.generated_at_kst,
    provider: report.provider,
    tf: report.tf,
    current_verdict: report.current && report.current.objective && report.current.objective.verdict,
    previous_verdict: report.previous && report.previous.objective && report.previous.objective.verdict,
    current_realized_n: report.current && report.current.overall && report.current.overall.realized_n,
    current_window_exit_fills_n: report.current && report.current.window_exit_fills_n,
    current_quality_drops_n: report.current && report.current.drops && report.current.drops.counts && report.current.drops.counts.QUALITY,
    current_ai_drops_n: report.current && report.current.drops && report.current.drops.counts && report.current.drops.counts.AI,
    current_market_drops_n: report.current && report.current.drops && report.current.drops.counts && report.current.drops.counts.MARKET,
    current_ev_drops_n: report.current && report.current.drops && report.current.drops.counts && report.current.drops.counts.EV,
    current_timing_drops_n: report.current && report.current.drops && report.current.drops.counts && report.current.drops.counts.TIMING,
    ml_policy_report: report.artifacts && report.artifacts.ml_policy_report,
    json_path: jsonPath,
    md_path: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-weekly-filter-governance failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      summarizeDropStages,
      aggregateOverallFromQuality,
      buildObjectiveVerdict,
      pickStageRecommendation,
      resolveFillMs,
      evaluateDropCounterfactual,
      summarizeDropCounterfactual,
      buildQualityDeepDive,
      summarizePineFollowThrough,
      buildPineQualityLinkage,
      buildPineStage1PatchCandidates,
      buildCompetingRiskCurve,
      wilsonInterval,
      summarizeSizingPerformance,
      summarizeFebtShadowReplacement,
      summarizeFebtPhase0Overlap,
      buildWeeklyFebtShadowSummary,
      summarizeEvEvaluatedEntries,
      buildSufficiencyRows,
      summarizeCounterfactualFeatureBreakdown,
      buildCounterfactualFeatureSummaryLines,
      buildWeeklyTelegramLayerLines,
      findRollbackTarget,
      ratioX,
    },
  };
}
