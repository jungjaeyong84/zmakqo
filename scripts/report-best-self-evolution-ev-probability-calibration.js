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
const { buildTp1CalibrationReport } = require("../src/utils/evTp1ProbabilityCalibration");

const EV_LEDGER_LATEST_PATH = path.join(OPS_DAILY_DIR, "ev_resolved_ledger_latest.json");

function toNum(v) {
  const n = Number(v);
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

function renderMarkdown(report) {
  const lines = [];
  lines.push("# EV Probability Calibration");
  lines.push("");
  lines.push(`- 실행 시각: ${report.generated_at_kst}`);
  lines.push(`- 대상: ${report.provider} ${report.tf}`);
  lines.push(`- model: ${report.model}`);
  lines.push(`- resolved: ${report.summary.resolved_n}`);
  lines.push(`- global tp1: ${pct(report.summary.tp1_hit_rate)}`);
  lines.push(`- global avg_ret: ${signedPct(report.summary.avg_ret_net)}`);
  lines.push(`- bucket size: ${report.summary.bucket_size}`);
  lines.push(`- monotonicity violations: ${report.summary.monotonicity_violations}`);
  lines.push(`- recommended action: ${report.summary.recommended_action}`);
  lines.push("");
  lines.push("## Buckets");
  for (const row of report.buckets || []) {
    lines.push(`- ${row.bucket_min.toFixed(2)}~${row.bucket_max.toFixed(2)}: n=${row.n} / tp1=${pct(row.tp1_hit_rate)} / avg_ret=${signedPct(row.avg_ret_net)} / posterior=${pct(row.posterior_tp1_hit_rate)} / ceiling=${pct(row.calibration_lower_bound_ceiling)} / apply=${row.apply_recommended ? "YES" : "NO"} / source_n=${row.calibration_source_n}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ defaultPrefix: "best_self_evolution" });
  const ledgerWrapper = readJsonRawSafe(EV_LEDGER_LATEST_PATH, null);
  if (!ledgerWrapper) {
    throw new Error(`Missing EV resolved ledger: ${EV_LEDGER_LATEST_PATH}`);
  }
  const ledger = ledgerWrapper.raw || ledgerWrapper;
  const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
  const calibration = buildTp1CalibrationReport(rows);
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycleId,
    generation_id: cycleMeta.generationId,
    provider: ledger.provider || (ledger.display && ledger.display.provider) || "BINANCEFUT",
    tf: ledger.tf || (ledger.display && ledger.display.tf) || "15m",
    model: ledger.model || (ledger.display && ledger.display.model) || "TP1_REACH_RECENT_BARS_V1",
    source_path: EV_LEDGER_LATEST_PATH,
    summary: calibration.summary,
    buckets: calibration.buckets,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_ev_probability_calibration.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_ev_probability_calibration.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_ev_probability_calibration_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_ev_probability_calibration_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("ev_probability_calibration_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("ev_probability_calibration_latest.md");

  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionLatestJson);
  copySelfEvolutionLatest(mdPath, selfEvolutionLatestMd);

  console.log(JSON.stringify({
    ok: true,
    generated_at_kst: report.generated_at_kst,
    recommended_action: report.summary.recommended_action,
    resolved_n: report.summary.resolved_n,
    monotonicity_violations: report.summary.monotonicity_violations,
    latest_json: latestJsonPath,
  }));
}

main();
