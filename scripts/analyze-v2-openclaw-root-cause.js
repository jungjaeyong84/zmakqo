#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { collectOutcomes } = require("./generate-v2-openclaw-daily-performance-report");
const { isPerformanceEligibleOutcome } = require("../src/v2/openclawDailyPerformanceReport");
const { extractOutcomeContext } = require("../src/v2/signalCohortReport");

const OUTPUT_JSON = "v2_openclaw_root_cause_analysis_latest.json";
const OUTPUT_MD = "v2_openclaw_root_cause_analysis_latest.md";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function round(value, digits = 4) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function stats(rows) {
  const n = rows.length;
  let win = 0;
  let loss = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let netPnl = 0;
  for (const row of rows) {
    const pnl = toNumber(row.realized_pnl, 0);
    netPnl += pnl;
    if (pnl > 0) {
      win += 1;
      grossProfit += pnl;
    } else if (pnl < 0) {
      loss += 1;
      grossLossAbs += Math.abs(pnl);
    }
  }
  return Object.freeze({
    n,
    win_n: win,
    loss_n: loss,
    win_rate_pct: n > 0 ? (win / n) * 100 : null,
    gross_profit_usdt: grossProfit,
    gross_loss_abs_usdt: grossLossAbs,
    net_pnl_usdt: netPnl,
    expectancy_usdt: n > 0 ? netPnl / n : null,
    profit_factor: grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? Infinity : null),
  });
}

function groupRows(rows, keyFn, { minN = 1 } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = trimOrNull(keyFn(row)) || "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => Object.freeze({ key, ...stats(group) }))
    .filter((row) => row.n >= minN)
    .sort((a, b) => Number(a.net_pnl_usdt || 0) - Number(b.net_pnl_usdt || 0) || String(a.key).localeCompare(String(b.key)));
}

function projectionIfRemoved(total, bucket) {
  const keptN = total.n - bucket.n;
  const keptPnl = total.net_pnl_usdt - bucket.net_pnl_usdt;
  const keptGrossProfit = total.gross_profit_usdt - bucket.gross_profit_usdt;
  const keptGrossLossAbs = total.gross_loss_abs_usdt - bucket.gross_loss_abs_usdt;
  return Object.freeze({
    removed_key: bucket.key,
    removed_n: bucket.n,
    removed_net_pnl_usdt: bucket.net_pnl_usdt,
    kept_n: keptN,
    kept_net_pnl_usdt: keptPnl,
    kept_expectancy_usdt: keptN > 0 ? keptPnl / keptN : null,
    kept_profit_factor: keptGrossLossAbs > 0 ? keptGrossProfit / keptGrossLossAbs : (keptGrossProfit > 0 ? Infinity : null),
  });
}

function formatMetric(row) {
  return {
    key: row.key,
    n: row.n,
    win_n: row.win_n,
    loss_n: row.loss_n,
    win_rate_pct: round(row.win_rate_pct, 2),
    net_pnl_usdt: round(row.net_pnl_usdt, 4),
    expectancy_usdt: round(row.expectancy_usdt, 4),
    profit_factor: row.profit_factor === Infinity ? "INF" : round(row.profit_factor, 4),
  };
}

function markdownTable(rows) {
  const header = "| key | n | win% | pnl | exp | PF |";
  const sep = "|---|---:|---:|---:|---:|---:|";
  const body = rows.map((row) => {
    const pf = row.profit_factor === Infinity ? "INF" : round(row.profit_factor, 3);
    return `| ${String(row.key).replace(/\|/g, "\\|")} | ${row.n} | ${round(row.win_rate_pct, 1)} | ${round(row.net_pnl_usdt, 3)} | ${round(row.expectancy_usdt, 3)} | ${pf} |`;
  });
  return [header, sep, ...body].join("\n");
}

function rootCauseFindings({ total, groups }) {
  const findings = [];
  const addWorst = (id, title, groupName, minN = 10, { includeUnknown = false } = {}) => {
    const row = (groups[groupName] || []).find((candidate) => {
      if (!includeUnknown && String(candidate.key || "").includes("UNKNOWN")) return false;
      return candidate.n >= minN && candidate.net_pnl_usdt < 0;
    });
    if (!row) return;
    findings.push(Object.freeze({
      id,
      severity: row.net_pnl_usdt <= -10 || row.profit_factor < 0.25 ? "HIGH" : "MEDIUM",
      title,
      group: groupName,
      evidence: formatMetric(row),
      if_removed: projectionIfRemoved(total, row),
    }));
  };
  const addSpecific = (id, title, groupName, key, minN = 10) => {
    const row = (groups[groupName] || []).find((candidate) => candidate.key === key && candidate.n >= minN && candidate.net_pnl_usdt < 0);
    if (!row) return;
    findings.push(Object.freeze({
      id,
      severity: row.net_pnl_usdt <= -10 || row.profit_factor < 0.25 ? "HIGH" : "MEDIUM",
      title,
      group: groupName,
      evidence: formatMetric(row),
      if_removed: projectionIfRemoved(total, row),
    }));
  };

  addWorst("PULLBACK_RECLAIM_DECAY", "PULLBACK/RECLAIM setup is negative and should be recalibrated before more exposure", "by_setup_type");
  addWorst("SHORT_DECAY", "SHORT entries underperform LONG entries and need separate calibration", "by_side");
  addWorst("EDGE_LABEL_INVERSION", "Edge/grade labels are not monotonic with realized PnL", "by_edge_cohort");
  addSpecific("SCORE_INVERSION", "High score bucket does not imply higher realized edge", "by_signal_score_bucket", "QUALIFIED");
  addWorst("BTC_ALIGNMENT_UNKNOWN", "BTC 1h alignment is missing/unknown for too many outcomes", "by_btc_1h_alignment", 30, { includeUnknown: true });
  addWorst("MICROSTRUCTURE_UNKNOWN", "Market microstructure fields are missing/unknown in outcome rows", "by_market_quality_bucket", 30, { includeUnknown: true });

  return findings;
}

function buildAnalysis({ rows, generatedAt = null } = {}) {
  const eligible = rows.filter(isPerformanceEligibleOutcome);
  const enriched = eligible.map((row) => ({ ...row, context: extractOutcomeContext(row) }));
  const total = stats(enriched);
  const groups = {
    by_symbol: groupRows(enriched, (row) => row.context.symbol),
    by_side: groupRows(enriched, (row) => row.context.side),
    by_setup_type: groupRows(enriched, (row) => row.context.setup_type),
    by_trigger_type: groupRows(enriched, (row) => row.context.trigger_type),
    by_edge_cohort: groupRows(enriched, (row) => row.context.edge_cohort),
    by_entry_grade: groupRows(enriched, (row) => row.context.entry_grade),
    by_signal_score_bucket: groupRows(enriched, (row) => row.context.signal_score_bucket),
    by_regime_cohort: groupRows(enriched, (row) => row.context.regime_cohort),
    by_btc_1h_alignment: groupRows(enriched, (row) => row.context.btc_1h_alignment),
    by_mtf_1h_alignment: groupRows(enriched, (row) => row.context.mtf_1h_alignment),
    by_market_quality_bucket: groupRows(enriched, (row) => row.context.market_quality_bucket),
    by_spread_bucket: groupRows(enriched, (row) => row.context.spread_bucket),
    by_funding_rate_bucket: groupRows(enriched, (row) => row.context.funding_rate_bucket),
    by_open_interest_delta_bucket: groupRows(enriched, (row) => row.context.open_interest_delta_bucket),
    by_liquidation_notional_5m_bucket: groupRows(enriched, (row) => row.context.liquidation_notional_5m_bucket),
    by_setup_edge_side: groupRows(enriched, (row) => `${row.context.setup_type}|${row.context.edge_cohort}|${row.context.side}`, { minN: 3 }),
    by_symbol_setup: groupRows(enriched, (row) => `${row.context.symbol}|${row.context.setup_type}`, { minN: 3 }),
    by_evidence_completeness: groupRows(enriched, (row) => row.context.evidence_completeness),
  };
  return Object.freeze({
    ok: true,
    reason: "V2_OPENCLAW_ROOT_CAUSE_ANALYSIS_GENERATED",
    generated_at: generatedAt || new Date().toISOString(),
    sample_n: total.n,
    total,
    root_cause_findings: rootCauseFindings({ total, groups }),
    groups,
  });
}

function renderMarkdown(analysis) {
  const lines = [];
  lines.push("# V2 OpenClaw Root Cause Analysis");
  lines.push("");
  lines.push(`generated_at: ${analysis.generated_at}`);
  lines.push(`sample_n: ${analysis.sample_n}`);
  lines.push(`win_rate_pct: ${round(analysis.total.win_rate_pct, 2)}`);
  lines.push(`profit_factor: ${round(analysis.total.profit_factor, 4)}`);
  lines.push(`expectancy_usdt: ${round(analysis.total.expectancy_usdt, 4)}`);
  lines.push(`net_pnl_usdt: ${round(analysis.total.net_pnl_usdt, 4)}`);
  lines.push("");
  lines.push("## Findings");
  for (const finding of analysis.root_cause_findings) {
    lines.push(`- [${finding.severity}] ${finding.id}: ${finding.title}`);
    lines.push(`  - evidence: ${JSON.stringify(finding.evidence)}`);
    lines.push(`  - if_removed: ${JSON.stringify({ kept_n: finding.if_removed.kept_n, kept_net_pnl_usdt: round(finding.if_removed.kept_net_pnl_usdt, 4), kept_profit_factor: round(finding.if_removed.kept_profit_factor, 4) })}`);
  }
  for (const [name, rows] of Object.entries(analysis.groups)) {
    lines.push("");
    lines.push(`## ${name}`);
    lines.push(markdownTable(rows.slice(0, 20)));
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function resolveOutputDir(env = process.env) {
  return path.resolve(trimOrNull(env.V2_OPENCLAW_ROOT_CAUSE_OUTPUT_DIR) || path.join("ops", "daily"));
}

async function main(env = process.env) {
  const rows = await collectOutcomes({ env });
  const analysis = buildAnalysis({ rows });
  const outputDir = resolveOutputDir(env);
  ensureDir(outputDir);
  const jsonFile = path.join(outputDir, OUTPUT_JSON);
  const mdFile = path.join(outputDir, OUTPUT_MD);
  fs.writeFileSync(jsonFile, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdFile, renderMarkdown(analysis), "utf8");
  console.log(JSON.stringify({
    ok: true,
    reason: analysis.reason,
    output_file: jsonFile,
    markdown_file: mdFile,
    sample_n: analysis.sample_n,
    profit_factor: analysis.total.profit_factor,
    expectancy_usdt: analysis.total.expectancy_usdt,
    finding_n: analysis.root_cause_findings.length,
  }));
  return analysis;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, reason: "V2_OPENCLAW_ROOT_CAUSE_ANALYSIS_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  });
} else {
  module.exports = {
    buildAnalysis,
    renderMarkdown,
    __test: { stats, groupRows, projectionIfRemoved, formatMetric },
  };
}
