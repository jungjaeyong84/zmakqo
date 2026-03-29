#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const {
  summarizeLegacyWaitBaseline,
  summarizeLegacyWaitOverlap,
  summarizeBridgeLatency,
} = require("../src/utils/febtPhase0");
const { summarizePineSignalQuality } = require("../src/services/pineSignalQuality");

loadLocalEnv();

const PROVIDER = String(process.env.FEBT_PHASE0_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.FEBT_PHASE0_TF || "15m").trim();
const WINDOW_DAYS = Math.max(7, Number(process.env.FEBT_PHASE0_WINDOW_DAYS || 7));
const SCAN_LIMIT = Math.max(3000, Number(process.env.FEBT_PHASE0_SCAN_LIMIT || 30000));
const WEEKLY_LATEST_JSON = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n.toFixed(digits)}x`;
}

function pct(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  const raw = (n * 100).toFixed(digits);
  return `${n > 0 ? "+" : ""}${raw}%`;
}

function msStat(stat = {}) {
  if (!stat || Number(stat.n || 0) <= 0) return "N/A";
  return `n=${stat.n} / avg=${Number(stat.avg || 0).toFixed(0)}ms / p50=${Number(stat.p50 || 0).toFixed(0)}ms / p95=${Number(stat.p95 || 0).toFixed(0)}ms / max=${Number(stat.max || 0).toFixed(0)}ms`;
}

function renderWaitBaselineMarkdown(report = {}) {
  const baseline = report && report.legacy_wait_baseline ? report.legacy_wait_baseline : {};
  const lines = [
    "# FEBT Phase 0 Wait Baseline",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- 대상: ${report.provider || "N/A"} ${report.tf || "N/A"}`,
    `- 윈도우: ${report.window && report.window.from_utc || "N/A"} -> ${report.window && report.window.to_utc || "N/A"}`,
    "",
    "## Legacy WAIT Baseline",
    `- candidate signals: ${baseline.candidate_signals_n || 0}`,
    `- executed entry chains: ${baseline.executed_entry_chains_n || 0}`,
    `- wait allow chains: ${baseline.wait_allow_chain_n || 0} / skip ${baseline.wait_skip_chain_n || 0} / unknown ${baseline.wait_unknown_chain_n || 0}`,
    `- legacy wait coverage: ${pct(baseline.legacy_wait_coverage_rate)} / observed chains ${baseline.legacy_wait_observed_chain_n || 0} / exec timing observed ${baseline.entry_exec_timing_observed_chain_n || 0}`,
    `- immediate exec: ${baseline.immediate_exec_n || 0} / realized ${baseline.immediate_realized_n || 0} / win ${pct(baseline.immediate_win_rate)} / avg_ret_net ${signedPct(baseline.immediate_avg_ret_net)}`,
    `- timing drop signals: ${baseline.timing_drop_signal_n || 0} / matured cf ${baseline.timing_drop_counterfactual_matured_n || 0}`,
    `- saved_loss ${pct(baseline.saved_loss_pct)} / missed_gain ${pct(baseline.missed_gain_pct)} / delta ${signedPct(baseline.saved_loss_minus_missed_gain)}`,
    `- timing drop avg horizon ret ${signedPct(baseline.timing_drop_avg_horizon_ret_net)}`,
    `- trigger paths: ${(baseline.wait_trigger_path_breakdown || []).map((row) => `${row.value} ${row.n}`).join(" / ") || "N/A"}`,
    `- market action: ${(baseline.market_action_breakdown || []).map((row) => `${row.value} ${row.n}`).join(" / ") || "N/A"}`,
    `- entry exec timing: ${(baseline.entry_exec_timing_breakdown || []).map((row) => `${row.value} ${row.n}`).join(" / ") || "N/A"}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderOverlapMarkdown(report = {}) {
  const overlap = report && report.legacy_wait_overlap ? report.legacy_wait_overlap : {};
  const lines = [
    "# FEBT Phase 0 Overlap Matrix",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- compared rows: ${overlap.compared_n || 0}`,
    "",
    "## Wait Action Breakdown",
    `- ${(overlap.wait_action_breakdown || []).map((row) => `${row.value} ${row.n}`).join(" / ") || "N/A"}`,
    "",
    "## Wait × Market Action",
    ...((overlap.market_state_action_pairs || []).slice(0, 10).map((row) => `- ${row.wait_action} × ${row.value}: ${row.n}`)),
    "",
    "## Wait × Exec Timing",
    ...((overlap.entry_exec_timing_pairs || []).slice(0, 10).map((row) => `- ${row.wait_action} × ${row.value}: ${row.n}`)),
    "",
    "## Wait × EV Policy Source",
    ...((overlap.ev_policy_source_pairs || []).slice(0, 10).map((row) => `- ${row.wait_action} × ${row.value}: ${row.n}`)),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderLatencyMarkdown(report = {}) {
  const latency = report && report.bridge_latency ? report.bridge_latency : {};
  const lines = [
    "# FEBT Phase 0 Bridge Latency",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- outcome ${latency.outcome_n || 0} / matched intents ${latency.matched_intent_n || 0} / matched fills ${latency.matched_fill_n || 0}`,
    `- duplicate ${latency.duplicate_count || 0} / stale ${latency.stale_count || 0} / reject ${latency.reject_count || 0}`,
    "",
    "## Latency",
    `- bar_close_to_webhook_ms_proxy: ${msStat(latency.bar_close_to_webhook_ms_proxy)}`,
    `- webhook_to_intent_ms: ${msStat(latency.webhook_to_intent_ms)}`,
    `- intent_to_fill_ms: ${msStat(latency.intent_to_fill_ms)}`,
    `- webhook_to_fill_ms: ${msStat(latency.webhook_to_fill_ms)}`,
    "",
    "## Notes",
    "- `bar_close_to_webhook_ms_proxy`는 실제 TradingView emit timestamp가 없어서 bar close 기준 proxy로 계산했습니다.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderMainMarkdown(report = {}) {
  const baseline = report.legacy_wait_baseline || {};
  const overlap = report.legacy_wait_overlap || {};
  const latency = report.bridge_latency || {};
  const lines = [
    "# FEBT Phase 0 Baseline",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- 대상: ${report.provider || "N/A"} ${report.tf || "N/A"}`,
    `- 윈도우: ${report.window && report.window.from_utc || "N/A"} -> ${report.window && report.window.to_utc || "N/A"}`,
    "",
    "## Core",
    `- legacy wait coverage ${pct(baseline.legacy_wait_coverage_rate)} / observed ${baseline.legacy_wait_observed_chain_n || 0} / exec timing observed ${baseline.entry_exec_timing_observed_chain_n || 0}`,
    `- immediate win ${pct(baseline.immediate_win_rate)} / immediate avg_ret_net ${signedPct(baseline.immediate_avg_ret_net)}`,
    `- timing saved_loss ${pct(baseline.saved_loss_pct)} / missed_gain ${pct(baseline.missed_gain_pct)} / delta ${signedPct(baseline.saved_loss_minus_missed_gain)}`,
    `- overlap rows ${overlap.compared_n || 0} / wait action ${(overlap.wait_action_breakdown || []).map((row) => `${row.value} ${row.n}`).join(" / ") || "N/A"}`,
    `- bridge latency webhook->fill ${msStat(latency.webhook_to_fill_ms)}`,
    `- bridge duplicate ${latency.duplicate_count || 0} / stale ${latency.stale_count || 0} / reject ${latency.reject_count || 0}`,
    "",
    "## Files",
    `- wait baseline: ${report.artifacts && report.artifacts.wait_baseline_md || "N/A"}`,
    `- overlap matrix: ${report.artifacts && report.artifacts.overlap_md || "N/A"}`,
    `- bridge latency: ${report.artifacts && report.artifacts.bridge_md || "N/A"}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const weekly = readJsonRawSafe(WEEKLY_LATEST_JSON, null);
  if (!weekly || !weekly.current) {
    throw new Error(`WEEKLY_GOVERNANCE_MISSING:${WEEKLY_LATEST_JSON}`);
  }

  const windowFromMs = toNum(weekly.current && weekly.current.range && weekly.current.range.from_ms)
    || (nowMeta.nowMs - (WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const windowToMs = toNum(weekly.current && weekly.current.range && weekly.current.range.to_ms) || nowMeta.nowMs;

  const [signalsCache, dropsCache, intentsCache, fillsCache, webhookCache] = await Promise.all([
    getCachedRecentByCreatedAt("signals", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("order_intents_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("webhook_ledger", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
  ]);

  const signals = Array.isArray(signalsCache.rows) ? signalsCache.rows : [];
  const drops = Array.isArray(dropsCache.rows) ? dropsCache.rows : [];
  const intents = Array.isArray(intentsCache.rows) ? intentsCache.rows : [];
  const fills = Array.isArray(fillsCache.rows) ? fillsCache.rows : [];
  const webhooks = Array.isArray(webhookCache.rows) ? webhookCache.rows : [];
  const freshQuality = await summarizePineSignalQuality({
    signals,
    fills,
    intents,
    exchange: PROVIDER,
    tf: TF,
    fromMs: windowFromMs,
    toMs: windowToMs,
  });
  const current = {
    ...(weekly.current || {}),
    quality: freshQuality,
  };

  const legacyWaitBaseline = summarizeLegacyWaitBaseline({
    current,
    drops,
  });
  const legacyWaitOverlap = summarizeLegacyWaitOverlap({
    current,
    drops,
  });
  const bridgeLatency = summarizeBridgeLatency({
    webhooks,
    intents,
    fills,
    provider: PROVIDER,
    tf: TF,
    fromMs: windowFromMs,
    toMs: windowToMs,
  });

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const waitBaselineJson = path.join(OPS_DAILY_DIR, `${base}_febt_wait_baseline.json`);
  const waitBaselineMd = path.join(OPS_DAILY_DIR, `${base}_febt_wait_baseline.md`);
  const overlapJson = path.join(OPS_DAILY_DIR, `${base}_febt_overlap_matrix.json`);
  const overlapMd = path.join(OPS_DAILY_DIR, `${base}_febt_overlap_matrix.md`);
  const bridgeJson = path.join(OPS_DAILY_DIR, `${base}_febt_bridge_latency.json`);
  const bridgeMd = path.join(OPS_DAILY_DIR, `${base}_febt_bridge_latency.md`);
  const mainJson = path.join(OPS_DAILY_DIR, `${base}_febt_phase0_baseline.json`);
  const mainMd = path.join(OPS_DAILY_DIR, `${base}_febt_phase0_baseline.md`);

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    tf: TF,
    window: {
      from_ms: windowFromMs,
      to_ms: windowToMs,
      from_utc: new Date(windowFromMs).toISOString(),
      to_utc: new Date(windowToMs).toISOString(),
    },
    legacy_wait_baseline: legacyWaitBaseline,
    legacy_wait_overlap: legacyWaitOverlap,
    bridge_latency: bridgeLatency,
    artifacts: {
      wait_baseline_json: waitBaselineJson,
      wait_baseline_md: waitBaselineMd,
      overlap_json: overlapJson,
      overlap_md: overlapMd,
      bridge_json: bridgeJson,
      bridge_md: bridgeMd,
    },
    sources: {
      weekly_governance_latest: WEEKLY_LATEST_JSON,
      signals_cache: signalsCache.meta && signalsCache.meta.filePath,
      drops_cache: dropsCache.meta && dropsCache.meta.filePath,
      intents_cache: intentsCache.meta && intentsCache.meta.filePath,
      fills_cache: fillsCache.meta && fillsCache.meta.filePath,
      webhook_cache: webhookCache.meta && webhookCache.meta.filePath,
    },
  };

  writeJson(waitBaselineJson, legacyWaitBaseline);
  writeText(waitBaselineMd, renderWaitBaselineMarkdown(report));
  writeJson(overlapJson, legacyWaitOverlap);
  writeText(overlapMd, renderOverlapMarkdown(report));
  writeJson(bridgeJson, bridgeLatency);
  writeText(bridgeMd, renderLatencyMarkdown(report));
  writeJson(mainJson, report);
  writeText(mainMd, renderMainMarkdown(report));

  copyLatest(waitBaselineJson, path.join(OPS_DAILY_DIR, "febt_wait_baseline_latest.json"));
  copyLatest(waitBaselineMd, path.join(OPS_DAILY_DIR, "febt_wait_baseline_latest.md"));
  copyLatest(overlapJson, path.join(OPS_DAILY_DIR, "febt_overlap_matrix_latest.json"));
  copyLatest(overlapMd, path.join(OPS_DAILY_DIR, "febt_overlap_matrix_latest.md"));
  copyLatest(bridgeJson, path.join(OPS_DAILY_DIR, "febt_bridge_latency_latest.json"));
  copyLatest(bridgeMd, path.join(OPS_DAILY_DIR, "febt_bridge_latency_latest.md"));
  copyLatest(mainJson, path.join(OPS_DAILY_DIR, "febt_phase0_baseline_latest.json"));
  copyLatest(mainMd, path.join(OPS_DAILY_DIR, "febt_phase0_baseline_latest.md"));

  console.log(JSON.stringify({
    ok: true,
    provider: PROVIDER,
    tf: TF,
    immediate_win_rate: legacyWaitBaseline.immediate_win_rate,
    timing_saved_loss_delta: legacyWaitBaseline.saved_loss_minus_missed_gain,
    webhook_to_fill_p95_ms: bridgeLatency.webhook_to_fill_ms && bridgeLatency.webhook_to_fill_ms.p95,
    duplicate_count: bridgeLatency.duplicate_count,
    reject_count: bridgeLatency.reject_count,
    main_json: mainJson,
    main_md: mainMd,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("report-febt-phase0-baseline failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      renderWaitBaselineMarkdown,
      renderOverlapMarkdown,
      renderLatencyMarkdown,
      renderMainMarkdown,
      msStat,
      ratio,
    },
  };
}
