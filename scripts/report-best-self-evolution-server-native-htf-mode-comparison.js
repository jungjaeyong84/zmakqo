#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { queryBars } = require("../src/storage/barsSnapshots");
const { getExchangesSettingsCached } = require("../src/storage/settings");
const {
  __test,
} = require("../src/services/serverNativeInitialSignal");
const {
  OPS_DAILY_DIR,
  loadLocalEnv,
  nowKstMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
  copyLatest,
  copySelfEvolutionLatest,
} = require("./lib/automation-utils");

loadLocalEnv();

function loadAdcQuotaProject() {
  try {
    const adcPath = path.join(process.env.HOME || "", ".config", "gcloud", "application_default_credentials.json");
    if (!adcPath || !fs.existsSync(adcPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(adcPath, "utf8"));
    return String(parsed && parsed.quota_project_id || "").trim() || null;
  } catch (_) {
    return null;
  }
}

if (!process.env.GOOGLE_CLOUD_PROJECT) {
  const quotaProject = loadAdcQuotaProject();
  if (quotaProject) process.env.GOOGLE_CLOUD_PROJECT = quotaProject;
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickMarkets(exchangeData = {}) {
  const markets = Array.isArray(exchangeData.markets) ? exchangeData.markets : [];
  return markets.map((v) => String(v || "").trim().toUpperCase()).filter(Boolean);
}

function summarizeRow(symbol, row = {}) {
  const emitted = Array.isArray(row.emitted) ? row.emitted : [];
  return {
    symbol,
    bar_close_time_utc_ms: toNum(row.diagnostics && row.diagnostics.timestamp),
    market_state: row.marketState || null,
    htf_mode: row.htfMode || null,
    htf_bias_selected: row.htfBias || null,
    htf_bias_pine_parity: row.htfBiasParity || (row.diagnostics && row.diagnostics.htfBiasParity) || null,
    htf_bias_full_history: row.htfBiasFullHistory || (row.diagnostics && row.diagnostics.htfBiasFullHistory) || null,
    selected_signal: emitted.map((sig) => `${sig.event}:${sig.features.entry_grade}`),
    long_opportunity: toNum(row.longOpportunity),
    short_opportunity: toNum(row.shortOpportunity),
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Server Native HTF Mode Comparison",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- 상태: ${report.status || "N/A"}`,
    `- selected_mode: ${report.selected_mode || "N/A"}`,
    `- compare_window_bars: ${report.compare_window_bars != null ? report.compare_window_bars : "N/A"}`,
    `- divergence_bar_n: ${report.divergence_bar_n != null ? report.divergence_bar_n : "N/A"}`,
    "",
    "## Recent Divergences",
  ];
  const rows = Array.isArray(report.top_divergences) ? report.top_divergences : [];
  if (!rows.length) lines.push("- none");
  for (const row of rows) {
    lines.push(`- ${row.symbol || "N/A"} / ${row.bar_close_time_utc_ms || "N/A"} / selected=${row.htf_bias_selected || "N/A"} / parity=${row.htf_bias_pine_parity || "N/A"} / full=${row.htf_bias_full_history || "N/A"} / selected_signal=${(row.selected_signal || []).join("|") || "-"}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const exchanges = await getExchangesSettingsCached(5_000);
  const exchangeData = exchanges && exchanges.data ? exchanges.data : {};
  const provider = String(exchangeData.provider || "BINANCEFUT").toUpperCase();
  const tf = String(exchangeData.exec_tf || (Array.isArray(exchangeData.tf_allowlist) && exchangeData.tf_allowlist[0]) || "15m");
  const markets = pickMarkets(exchangeData);
  const compareWindowBars = Math.max(12, Number(process.env.SERVER_NATIVE_HTF_COMPARISON_WINDOW_BARS || 96));
  const barsLimit = Math.max(1400, compareWindowBars + 1200);
  const selectedMode = __test.currentHtfMode();

  const divergences = [];
  let comparedBarN = 0;

  for (const symbol of markets) {
    const bars = await queryBars({ exchange: provider, symbol, tf, limit: barsLimit });
    if (!Array.isArray(bars) || bars.length < 120) continue;
    const evaluated = __test.evaluateSignalsForBars({ exchange: provider, symbol, tf, bars, htfBars: [] });
    const recent = evaluated.slice(-compareWindowBars);
    for (const row of recent) {
      if (!row || !row.diagnostics) continue;
      comparedBarN += 1;
      const parity = row.htfBiasParity || row.diagnostics.htfBiasParity || null;
      const full = row.htfBiasFullHistory || row.diagnostics.htfBiasFullHistory || null;
      if (parity === full) continue;
      divergences.push(summarizeRow(symbol, row));
    }
  }

  divergences.sort((a, b) => Number(b.bar_close_time_utc_ms || 0) - Number(a.bar_close_time_utc_ms || 0));

  const report = {
    generated_at: new Date().toISOString(),
    generated_at_kst: nowMeta.display,
    status: "SERVER_NATIVE_HTF_MODE_COMPARISON_ACTIVE",
    provider,
    tf,
    selected_mode: selectedMode,
    compare_window_bars: compareWindowBars,
    compared_bar_n: comparedBarN,
    divergence_bar_n: divergences.length,
    summary: {
      status: "SERVER_NATIVE_HTF_MODE_COMPARISON_ACTIVE",
      selected_mode: selectedMode,
      compare_window_bars: compareWindowBars,
      compared_bar_n: comparedBarN,
      divergence_bar_n: divergences.length,
      top_divergence_symbol: divergences[0] && divergences[0].symbol || null,
      latest_divergence_bar_close_time_utc_ms: divergences[0] && divergences[0].bar_close_time_utc_ms || null,
    },
    top_divergences: divergences.slice(0, 20),
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_server_native_htf_mode_comparison`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_native_htf_mode_comparison_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_native_htf_mode_comparison_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("server_native_htf_mode_comparison_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("server_native_htf_mode_comparison_latest.md"));

  console.log(JSON.stringify(report));
}

main().catch((err) => {
  console.error("BEST_SELF_EVOLUTION_SERVER_NATIVE_HTF_MODE_COMPARISON_FAILED", err && err.stack ? err.stack : err);
  process.exit(1);
});
