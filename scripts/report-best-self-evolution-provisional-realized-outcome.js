#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { buildProvisionalRealizedOutcomeLedger } = require("./lib/stage-outcome-ledgers");

loadLocalEnv();

const PROVIDER = String(process.env.PROVISIONAL_REALIZED_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.PROVISIONAL_REALIZED_TF || "15m").trim();
const WINDOW_DAYS = Math.max(3, Number(process.env.PROVISIONAL_REALIZED_WINDOW_DAYS || 7) || 7);
const MATURITY_HOURS = Math.max(6, Number(process.env.PROVISIONAL_REALIZED_MATURITY_HOURS || 12) || 12);

const INTENTS_LATEST_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "order_intents_paper.json");
const FILLS_LATEST_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "fills_paper.json");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 2) {
  const n = toNum(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "N/A";
}

function signedNum(value, digits = 2) {
  const n = toNum(value);
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(digits)}` : "N/A";
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.by_market) ? report.by_market : [];
  const lines = [
    "# BEST Self-Evolution Provisional Realized Outcome",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- provider/tf: ${report.provider || "N/A"} / ${report.tf || "N/A"}`,
    `- window_days: ${report.window_days ?? "N/A"} / maturity_hours: ${report.maturity_hours ?? "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- total/final/provisional/effective: ${summary.total_entry_n ?? 0} / ${summary.final_realized_n ?? 0} / ${summary.provisional_realized_n ?? 0} / ${summary.effective_realized_n ?? 0}`,
    `- unresolved_open/stale: ${summary.unresolved_open_n ?? 0} / ${summary.unresolved_stale_n ?? 0}`,
    `- effective win/avg_ret/net_pnl_krw: ${pct(summary.effective_win_rate)} / ${pct(summary.effective_avg_ret_net)} / ${signedNum(summary.effective_net_pnl_krw, 0)}`,
    `- top provisional market: ${summary.top_provisional_market || "N/A"}`,
    "",
    "## By Market",
    ...rows.slice(0, 12).map((row) => `- ${row.market}: final ${row.final_realized_n ?? 0} / provisional ${row.provisional_n ?? 0} / effective ${row.effective_realized_n ?? 0} / unresolved_open ${row.unresolved_open_n ?? 0} / unresolved_stale ${row.unresolved_stale_n ?? 0} / avg_ret ${pct(row.effective_avg_ret_net)} / net_pnl_krw ${signedNum(row.effective_net_pnl_krw, 0)}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const intentsCache = readJsonRawSafe(INTENTS_LATEST_PATH, null);
  const fillsCache = readJsonRawSafe(FILLS_LATEST_PATH, null);
  if (!intentsCache) throw new Error(`ORDER_INTENTS_CACHE_MISSING:${INTENTS_LATEST_PATH}`);
  if (!fillsCache) throw new Error(`FILLS_CACHE_MISSING:${FILLS_LATEST_PATH}`);

  const sysCfgRes = await getSystemSettingsForProvider(PROVIDER, 0);
  const sysCfg = sysCfgRes && sysCfgRes.data && typeof sysCfgRes.data === "object" ? sysCfgRes.data : {};
  const nowMs = Date.now();
  const fromMs = nowMs - (WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const ledger = await buildProvisionalRealizedOutcomeLedger({
    provider: PROVIDER,
    tf: TF,
    fromMs,
    toMs: nowMs,
    nowMs,
    maturityHours: MATURITY_HOURS,
    intents: Array.isArray(intentsCache.docs) ? intentsCache.docs : [],
    fills: Array.isArray(fillsCache.docs) ? fillsCache.docs : [],
    sysCfg,
  });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    provider: PROVIDER,
    tf: TF,
    window_days: WINDOW_DAYS,
    maturity_hours: MATURITY_HOURS,
    inputs: {
      intents_latest_path: INTENTS_LATEST_PATH,
      fills_latest_path: FILLS_LATEST_PATH,
    },
    summary: ledger.summary,
    by_market: ledger.by_market,
    rows: ledger.rows,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_provisional_realized_outcome.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_provisional_realized_outcome.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_provisional_realized_outcome_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_provisional_realized_outcome_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("provisional_realized_outcome_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("provisional_realized_outcome_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  if (selfEvolutionLatestJson) copySelfEvolutionLatest(jsonPath, selfEvolutionLatestJson);
  if (selfEvolutionLatestMd) copySelfEvolutionLatest(mdPath, selfEvolutionLatestMd);
  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: report.summary && report.summary.status,
    effective_realized_n: report.summary && report.summary.effective_realized_n,
    provisional_realized_n: report.summary && report.summary.provisional_realized_n,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_PROVISIONAL_REALIZED_OUTCOME_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
};
