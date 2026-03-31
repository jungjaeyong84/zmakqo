#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const { __test: evGateTest } = require("../src/engine/paperUpbitRunner");

const SIGNAL_DROPS_CACHE_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json");
const WEEKLY_GOVERNANCE_LATEST_PATH = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");

function get(obj, key) {
  return String(key || "").split(".").reduce((acc, token) => (acc == null ? undefined : acc[token]), obj);
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 2) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(value, digits = 2) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function marketOf(row = {}) {
  const direct = row.market || row.symbol || get(row, "features_json.market") || get(row, "features_json.symbol");
  if (direct) return String(direct).trim().toUpperCase();
  const signalId = String(row.signal_id || "").trim();
  const match = signalId.match(/^SIG__[^_]+__([^_]+)__/);
  return match ? String(match[1]).trim().toUpperCase() : "UNKNOWN";
}

function sideOf(row = {}) {
  const raw = String(row.event || get(row, "features_json.event") || "").trim().toUpperCase();
  if (raw === "LONG") return "LONG";
  if (raw === "SHORT") return "SHORT";
  return raw || "UNKNOWN";
}

function executionModeOf(row = {}) {
  return String(row.mode || row.execution_mode || get(row, "features_json.mode") || get(row, "features_json.execution_mode") || "").trim().toUpperCase();
}

function extractEstimate(row = {}) {
  return {
    probability: toNum(row.ev_gate_tp1_reach_prob) ?? toNum(get(row, "features_json.ev_gate_tp1_reach_prob")) ?? toNum(get(row, "features_json.ev_gate_components.tp1_reach_prob")),
    lowerBound: toNum(row.ev_gate_tp1_reach_prob_lower_bound) ?? toNum(get(row, "features_json.ev_gate_tp1_reach_prob_lower_bound")) ?? toNum(get(row, "features_json.ev_gate_components.tp1_reach_prob_lower_bound")),
  };
}

function extractTier(row = {}) {
  const grade = String(get(row, "features_json.entry_grade") || row.entry_grade || "").trim().toUpperCase();
  if (grade === "EARLY" || grade === "CORE") return grade;
  return null;
}

function resolveEvGateRowConfig(row = {}) {
  const features = row.features_json && typeof row.features_json === "object" ? row.features_json : {};
  const exchange = String(row.exchange || features.exchange || "BINANCEFUT").trim().toUpperCase();
  const cfg = evGateTest.resolveEvGateConfig({}, exchange);
  const mergeNum = (sourceKey, targetKey) => {
    const value = toNum(features[sourceKey]);
    if (Number.isFinite(value)) cfg[targetKey] = value;
  };
  const mergeBool = (sourceKey, targetKey) => {
    if (features[sourceKey] === true || features[sourceKey] === false) cfg[targetKey] = features[sourceKey] === true;
  };
  mergeNum("ev_gate_tp1_prob_min", "tp1ProbMin");
  mergeNum("ev_gate_tp1_prob_min_early", "tp1ProbMinEarly");
  mergeNum("ev_gate_tp1_prob_min_core", "tp1ProbMinCore");
  mergeNum("ev_gate_tp1_prob_full", "tp1ProbFull");
  mergeNum("ev_gate_tp1_prob_kill", "tp1ProbKill");
  mergeNum("ev_gate_qty_scale_mid", "qtyScaleMid");
  mergeNum("ev_gate_qty_scale_low", "qtyScaleLow");
  mergeNum("ev_gate_qty_scale_kill_rescue", "qtyScaleKillRescue");
  mergeNum("ev_gate_point_pass_kill_rescue_margin", "pointPassKillRescueMargin");
  mergeBool("ev_gate_point_pass_kill_rescue_enabled", "pointPassKillRescueEnabled");
  return cfg;
}

function resolveTp1ProbMin(row = {}, cfg = {}) {
  const features = row.features_json && typeof row.features_json === "object" ? row.features_json : {};
  const explicit = toNum(features.ev_gate_tp1_prob_min);
  if (Number.isFinite(explicit)) return explicit;
  const tier = extractTier(row);
  if (tier === "EARLY") return Number(cfg.tp1ProbMinEarly);
  if (tier === "CORE") return Number(cfg.tp1ProbMinCore);
  return Number(cfg.tp1ProbMin);
}

function classifyCounterfactual(row = null) {
  if (!row) return "NO_COUNTERFACTUAL";
  const matured = Number(row.matured_n || 0);
  const avgRet = toNum(row.avg_horizon_ret_net);
  const tp1Rate = toNum(row.tp1_first_rate);
  const slRate = toNum(row.sl_first_rate);
  if (matured < 5) return "HOLD_SAMPLE";
  if (Number.isFinite(avgRet) && avgRet > 0 && Number.isFinite(tp1Rate) && Number.isFinite(slRate) && tp1Rate >= slRate) return "FAVOR_RESCUE";
  if (Number.isFinite(avgRet) && avgRet < 0 && Number.isFinite(slRate) && slRate >= 0.5) return "KEEP_DROP";
  return "MIXED";
}

function buildReport({ dropsWrapper = {}, governance = {}, nowMeta = nowKstMeta(), cycleMeta = null } = {}) {
  const docs = Array.isArray(dropsWrapper.docs) ? dropsWrapper.docs : [];
  const filtered = docs.filter((row) => {
    const reason = String(row.reason || row.drop_reason_code || "").trim().toUpperCase();
    return reason === "DROP_EV_GATE_TP1_PROB" && ["LONG", "SHORT"].includes(sideOf(row)) && executionModeOf(row) === "LIVE";
  });

  const governanceRaw = governance && governance.raw && typeof governance.raw === "object" ? governance.raw : {};
  const dropCf = governanceRaw.current && governanceRaw.current.drop_counterfactual && typeof governanceRaw.current.drop_counterfactual === "object"
    ? governanceRaw.current.drop_counterfactual
    : {};
  const overallCf = Array.isArray(dropCf.top_reasons)
    ? dropCf.top_reasons.find((row) => String(row.reason || "").trim().toUpperCase() === "DROP_EV_GATE_TP1_PROB") || null
    : null;
  const cfByMarketMap = new Map(
    (Array.isArray(dropCf.by_reason_market) ? dropCf.by_reason_market : [])
      .filter((row) => String(row.reason || "").trim().toUpperCase() === "DROP_EV_GATE_TP1_PROB")
      .map((row) => [String(row.market || "UNKNOWN").trim().toUpperCase(), row])
  );

  let rescueCount = 0;
  let hardDropCount = 0;
  let pointPassLowerFailCount = 0;
  let pointFailCount = 0;
  const perMarketMap = new Map();
  const perEventMap = new Map();
  const rescueExamples = [];

  for (const row of filtered) {
    const market = marketOf(row);
    const event = sideOf(row);
    const estimate = extractEstimate(row);
    const cfg = resolveEvGateRowConfig(row);
    const tp1ProbMin = resolveTp1ProbMin(row, cfg);
    const decision = evGateTest.resolveEvGateDecision({ estimate, cfg, tp1ProbMin });
    const point = toNum(estimate.probability);
    const lower = toNum(estimate.lowerBound);
    const rescued = decision && decision.ok === true && decision.action === "REDUCE_RESCUE";
    const pointPassLowerFail = decision && decision.pointPass === true && Number.isFinite(lower) && lower < Number(cfg.tp1ProbKill);
    const pointFailed = Number.isFinite(point) && point < Number(tp1ProbMin);
    if (rescued) rescueCount += 1;
    else hardDropCount += 1;
    if (pointPassLowerFail) pointPassLowerFailCount += 1;
    if (pointFailed) pointFailCount += 1;

    const marketRow = perMarketMap.get(market) || {
      market,
      total: 0,
      rescue: 0,
      hard_drop: 0,
      point_pass_lower_fail: 0,
      point_fail: 0,
    };
    marketRow.total += 1;
    if (rescued) marketRow.rescue += 1;
    else marketRow.hard_drop += 1;
    if (pointPassLowerFail) marketRow.point_pass_lower_fail += 1;
    if (pointFailed) marketRow.point_fail += 1;
    perMarketMap.set(market, marketRow);

    const eventRow = perEventMap.get(event) || {
      event,
      total: 0,
      rescue: 0,
      hard_drop: 0,
      point_pass_lower_fail: 0,
      point_fail: 0,
    };
    eventRow.total += 1;
    if (rescued) eventRow.rescue += 1;
    else eventRow.hard_drop += 1;
    if (pointPassLowerFail) eventRow.point_pass_lower_fail += 1;
    if (pointFailed) eventRow.point_fail += 1;
    perEventMap.set(event, eventRow);

    if (rescued && rescueExamples.length < 10) {
      rescueExamples.push({
        signal_id: String(row.signal_id || "").trim() || null,
        market,
        event,
        point_probability: point,
        lower_bound: lower,
        tp1_prob_min: tp1ProbMin,
        tp1_prob_kill: Number(cfg.tp1ProbKill),
        rescue_floor: toNum(decision && decision.rescueFloor),
        qty_scale: toNum(decision && decision.qtyScale),
        created_at: row.created_at || null,
      });
    }
  }

  const byMarket = Array.from(perMarketMap.values())
    .map((row) => {
      const cfRow = cfByMarketMap.get(row.market) || null;
      return {
        ...row,
        rescue_rate: row.total > 0 ? row.rescue / row.total : null,
        actual_matured_n: toNum(cfRow && cfRow.matured_n),
        actual_tp1_first_rate: toNum(cfRow && cfRow.tp1_first_rate),
        actual_sl_first_rate: toNum(cfRow && cfRow.sl_first_rate),
        actual_horizon_pos_rate: toNum(cfRow && cfRow.horizon_pos_rate),
        actual_avg_horizon_ret_net: toNum(cfRow && cfRow.avg_horizon_ret_net),
        actual_verdict: classifyCounterfactual(cfRow),
      };
    })
    .sort((a, b) => b.rescue - a.rescue || b.total - a.total || a.market.localeCompare(b.market));

  const byEvent = Array.from(perEventMap.values())
    .map((row) => ({ ...row, rescue_rate: row.total > 0 ? row.rescue / row.total : null }))
    .sort((a, b) => b.rescue - a.rescue || a.event.localeCompare(b.event));

  return {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta && cycleMeta.cycle_id ? cycleMeta.cycle_id : null,
    generation_id: cycleMeta && cycleMeta.generation_id ? cycleMeta.generation_id : null,
    total_live_active_ev_tp1_drops: filtered.length,
    rescue_count: rescueCount,
    hard_drop_count: hardDropCount,
    rescue_rate: filtered.length > 0 ? rescueCount / filtered.length : null,
    point_pass_lower_fail_count: pointPassLowerFailCount,
    point_fail_count: pointFailCount,
    counterfactual_reason_overall: overallCf ? {
      reason: overallCf.reason,
      matured_n: toNum(overallCf.matured_n),
      tp1_first_rate: toNum(overallCf.tp1_first_rate),
      sl_first_rate: toNum(overallCf.sl_first_rate),
      horizon_pos_rate: toNum(overallCf.horizon_pos_rate),
      avg_horizon_ret_net: toNum(overallCf.avg_horizon_ret_net),
      verdict: classifyCounterfactual(overallCf),
    } : null,
    by_market: byMarket,
    by_event: byEvent,
    rescue_examples: rescueExamples,
    cache_meta: {
      path: SIGNAL_DROPS_CACHE_PATH,
      updated_at: dropsWrapper.updated_at || null,
      latest_created_at: dropsWrapper.latest_created_at || null,
    },
    governance_meta: {
      path: WEEKLY_GOVERNANCE_LATEST_PATH,
      generated_at_kst: governanceRaw.generated_at_kst || null,
      counterfactual_by_reason_market_n: Array.isArray(dropCf.by_reason_market) ? dropCf.by_reason_market.length : 0,
    },
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# BEST Self-Evolution EV Gate Rescue",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- total/rescue/hard_drop: ${report.total_live_active_ev_tp1_drops != null ? report.total_live_active_ev_tp1_drops : "N/A"} / ${report.rescue_count != null ? report.rescue_count : "N/A"} / ${report.hard_drop_count != null ? report.hard_drop_count : "N/A"}`,
    `- rescue_rate: ${pct(report.rescue_rate)}`,
    `- point_pass_lower_fail/point_fail: ${report.point_pass_lower_fail_count != null ? report.point_pass_lower_fail_count : "N/A"} / ${report.point_fail_count != null ? report.point_fail_count : "N/A"}`,
    `- counterfactual_overall: ${report.counterfactual_reason_overall ? `${report.counterfactual_reason_overall.reason} / matured ${report.counterfactual_reason_overall.matured_n} / tp1 ${pct(report.counterfactual_reason_overall.tp1_first_rate)} / sl ${pct(report.counterfactual_reason_overall.sl_first_rate)} / horizon_win ${pct(report.counterfactual_reason_overall.horizon_pos_rate)} / avg_ret ${signedPct(report.counterfactual_reason_overall.avg_horizon_ret_net)} / ${report.counterfactual_reason_overall.verdict}` : "N/A"}`,
    "",
    "## By Event",
    ...((Array.isArray(report.by_event) && report.by_event.length)
      ? report.by_event.map((row) => `- ${row.event}: total ${row.total} / rescue ${row.rescue} (${pct(row.rescue_rate)}) / hard ${row.hard_drop} / point_pass_lower_fail ${row.point_pass_lower_fail} / point_fail ${row.point_fail}`)
      : ["- none"]),
    "",
    "## By Market",
    ...((Array.isArray(report.by_market) && report.by_market.length)
      ? report.by_market.map((row) => `- ${row.market}: total ${row.total} / rescue ${row.rescue} (${pct(row.rescue_rate)}) / hard ${row.hard_drop} / point_pass_lower_fail ${row.point_pass_lower_fail} / point_fail ${row.point_fail} / actual matured ${row.actual_matured_n != null ? row.actual_matured_n : "N/A"} / tp1 ${pct(row.actual_tp1_first_rate)} / sl ${pct(row.actual_sl_first_rate)} / horizon_win ${pct(row.actual_horizon_pos_rate)} / avg_ret ${signedPct(row.actual_avg_horizon_ret_net)} / ${row.actual_verdict || "N/A"}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const dropsWrapper = readJsonRawSafe(SIGNAL_DROPS_CACHE_PATH, {}) || {};
  const governance = readJsonRawSafe(WEEKLY_GOVERNANCE_LATEST_PATH, {}) || {};
  const report = buildReport({ dropsWrapper, governance, nowMeta, cycleMeta });
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_ev_gate_rescue.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_ev_gate_rescue.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_rescue_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_ev_gate_rescue_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("ev_gate_rescue_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("ev_gate_rescue_latest.md");
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  if (selfEvolutionLatestJson) copySelfEvolutionLatest(jsonPath, selfEvolutionLatestJson);
  if (selfEvolutionLatestMd) copySelfEvolutionLatest(mdPath, selfEvolutionLatestMd);
  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    rescue_count: report.rescue_count,
    total_live_active_ev_tp1_drops: report.total_live_active_ev_tp1_drops,
    rescue_rate: report.rescue_rate,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EV_GATE_RESCUE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    marketOf,
    sideOf,
    executionModeOf,
    extractEstimate,
    resolveEvGateRowConfig,
    resolveTp1ProbMin,
    classifyCounterfactual,
    buildReport,
    renderMarkdown,
  },
};
