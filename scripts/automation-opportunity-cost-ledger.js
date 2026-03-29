#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  loadLatestJson,
  pct,
  signedPct,
  stageLabel,
  toNum,
} = require("./lib/objective-control");

loadLocalEnv();

const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "opportunity_cost_ledger_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "opportunity_cost_ledger_latest.md");
const MIN_STAGE_SAMPLE = Math.max(12, Number(process.env.OPPORTUNITY_LEDGER_MIN_STAGE_SAMPLE || 12));
const MIN_EV_SAMPLE = Math.max(20, Number(process.env.OPPORTUNITY_LEDGER_MIN_EV_SAMPLE || 20));
const MIN_WAIT_TRIGGER_SAMPLE = Math.max(6, Number(process.env.OPPORTUNITY_LEDGER_MIN_WAIT_TRIGGER_SAMPLE || 6));

function roundTo(v, digits = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function buildCounterfactualStageRows(byStage = {}) {
  return Object.entries(byStage || {}).map(([stage, row]) => {
    const maturedN = Number(row && row.matured_n || 0);
    const tp1Rate = toNum(row && row.tp1_first_rate);
    const slRate = toNum(row && row.sl_first_rate);
    const avgRet = toNum(row && row.avg_horizon_ret_net);
    const relaxPressure = Number.isFinite(tp1Rate) && Number.isFinite(slRate) ? Math.max(0, tp1Rate - slRate) : 0;
    const tightenPressure = Number.isFinite(tp1Rate) && Number.isFinite(slRate) ? Math.max(0, slRate - tp1Rate) : 0;
    const opportunityScore = Number.isFinite(avgRet) ? roundTo(avgRet * maturedN, 4) : null;
    let verdict = "KEEP";
    if (maturedN < MIN_STAGE_SAMPLE) verdict = "HOLD_SAMPLE";
    else if (Number.isFinite(avgRet) && avgRet > 0.001 && relaxPressure >= 0.05) verdict = "SOFTEN_PRESSURE";
    else if (Number.isFinite(avgRet) && avgRet < -0.001 && tightenPressure >= 0.05) verdict = "TIGHTEN_PRESSURE";
    return {
      stage,
      label: stageLabel(stage),
      matured_n: maturedN,
      tp1_first_rate: tp1Rate,
      sl_first_rate: slRate,
      avg_horizon_ret_net: avgRet,
      relax_pressure: roundTo(relaxPressure, 4),
      tighten_pressure: roundTo(tightenPressure, 4),
      opportunity_score: opportunityScore,
      verdict,
      note: verdict === "SOFTEN_PRESSURE"
        ? "막힌 뒤 후속 수익이 더 좋아 과차단 가능성이 있습니다."
        : verdict === "TIGHTEN_PRESSURE"
          ? "막힌 뒤 후속 손실이 더 커 현재 차단이 방어적으로 맞았을 가능성이 큽니다."
          : (verdict === "HOLD_SAMPLE" ? "표본이 아직 적습니다." : "즉시 수정 근거가 약합니다."),
    };
  }).sort((a, b) => {
    const sa = Math.abs(Number(a.opportunity_score || 0));
    const sb = Math.abs(Number(b.opportunity_score || 0));
    return sb - sa || a.stage.localeCompare(b.stage);
  });
}

function buildQualityReasonRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice(0, 12).map((row) => {
    const maturedN = Number(row && row.matured_n || 0);
    const avgRet = toNum(row && row.avg_horizon_ret_net);
    const tp1Rate = toNum(row && row.tp1_first_rate);
    const slRate = toNum(row && row.sl_first_rate);
    return {
      reason: String(row && row.reason || "").trim().toUpperCase(),
      matured_n: maturedN,
      avg_horizon_ret_net: avgRet,
      tp1_first_rate: tp1Rate,
      sl_first_rate: slRate,
      matched_avg_mfe: toNum(row && row.matched_avg_mfe),
      matched_avg_mae: toNum(row && row.matched_avg_mae),
      verdict: String(row && row.verdict || "KEEP").toUpperCase(),
    };
  });
}

function buildEvStageRow(evSummary = {}) {
  const resolvedN = Number(evSummary && evSummary.resolved_n || 0);
  const dropN = Number(evSummary && evSummary.ev_drop_n || 0);
  const executedN = Number(evSummary && evSummary.executed_entry_n || 0);
  const tp1Rate = resolvedN > 0 ? (Number(evSummary.tp1_hit_n || 0) / resolvedN) : null;
  const avgRet = toNum(evSummary && evSummary.avg_ret_net);
  let verdict = "KEEP";
  if (resolvedN < MIN_EV_SAMPLE) verdict = "HOLD_SAMPLE";
  else if (Number.isFinite(avgRet) && avgRet > 0 && dropN > (executedN * 3)) verdict = "SOFTEN_PRESSURE";
  return {
    stage: "EV_LEDGER",
    label: "4차 EV/시간가치층 실제 결과",
    resolved_n: resolvedN,
    ev_drop_n: dropN,
    executed_entry_n: executedN,
    tp1_hit_rate: tp1Rate,
    avg_ret_net: avgRet,
    verdict,
    note: verdict === "SOFTEN_PRESSURE"
      ? "실제 EV 표본 수익은 양수인데 드롭이 많아 기준 완화 검토 가치가 있습니다."
      : (verdict === "HOLD_SAMPLE" ? "4차 EV/시간가치층 실표본이 아직 적습니다." : "즉시 조정 근거가 약합니다."),
  };
}

function buildWaitStageRow(waitSummary = {}) {
  const triggerN = Number(waitSummary && waitSummary.wait_trigger_n || 0);
  const beneficialN = Number(waitSummary && waitSummary.beneficial_wait_n || 0);
  const harmfulN = Number(waitSummary && waitSummary.harmful_wait_n || 0);
  const avgDelta = toNum(waitSummary && waitSummary.avg_delta_ret_net);
  const beneficialRate = triggerN > 0 ? (beneficialN / triggerN) : null;
  const harmfulRate = triggerN > 0 ? (harmfulN / triggerN) : null;
  let verdict = "KEEP";
  if (triggerN < MIN_WAIT_TRIGGER_SAMPLE) verdict = "HOLD_SAMPLE";
  else if (Number.isFinite(avgDelta) && avgDelta > 0 && Number(beneficialRate || 0) > Number(harmfulRate || 0)) verdict = "SOFTEN_PRESSURE";
  else if (Number.isFinite(avgDelta) && avgDelta < 0 && Number(harmfulRate || 0) >= Number(beneficialRate || 0)) verdict = "TIGHTEN_PRESSURE";
  return {
    stage: "WAIT_LEDGER",
    label: "5차 WAIT 타이밍층 실제 결과",
    trigger_n: triggerN,
    beneficial_rate: beneficialRate,
    harmful_rate: harmfulRate,
    avg_delta_ret_net: avgDelta,
    verdict,
    note: verdict === "SOFTEN_PRESSURE"
      ? "기다린 쪽이 더 나은 비중이 높아 WAIT 완화보다 활용 가치가 있습니다."
      : verdict === "TIGHTEN_PRESSURE"
        ? "WAIT이 오히려 손해라 타이밍 연기 조건을 보수화할 근거가 있습니다."
        : (verdict === "HOLD_SAMPLE" ? "5차 WAIT 타이밍층 발동 표본이 아직 적습니다." : "즉시 조정 근거가 약합니다."),
  };
}

function buildSummary(stageRows = [], evRow = null, waitRow = null) {
  const soften = stageRows.filter((row) => row.verdict === "SOFTEN_PRESSURE");
  const tighten = stageRows.filter((row) => row.verdict === "TIGHTEN_PRESSURE");
  const topSoften = soften.sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))[0] || null;
  const topTighten = tighten.sort((a, b) => Math.abs(Number(b.opportunity_score || 0)) - Math.abs(Number(a.opportunity_score || 0)))[0] || null;
  return {
    primary_soften_stage: topSoften ? topSoften.stage : null,
    primary_soften_label: topSoften ? topSoften.label : null,
    primary_tighten_stage: topTighten ? topTighten.stage : null,
    primary_tighten_label: topTighten ? topTighten.label : null,
    ev_verdict: evRow ? evRow.verdict : "N/A",
    wait_verdict: waitRow ? waitRow.verdict : "N/A",
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Opportunity Cost Ledger",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- soften focus: ${report.summary && report.summary.primary_soften_label || "N/A"}`,
    `- tighten focus: ${report.summary && report.summary.primary_tighten_label || "N/A"}`,
    `- EV ledger: ${report.summary && report.summary.ev_verdict || "N/A"}`,
    `- WAIT ledger: ${report.summary && report.summary.wait_verdict || "N/A"}`,
    "",
    "## Stage Counterfactual",
  ];
  for (const row of report.stage_rows || []) {
    lines.push(`- ${row.label}: ${row.verdict} / matured=${row.matured_n} / TP1=${pct(row.tp1_first_rate)} / SL=${pct(row.sl_first_rate)} / avg_ret=${signedPct(row.avg_horizon_ret_net)} / score=${row.opportunity_score != null ? row.opportunity_score.toFixed(4) : "N/A"}`);
    lines.push(`  - ${row.note}`);
  }
  lines.push("", "## EV / WAIT");
  if (report.ev_row) lines.push(`- ${report.ev_row.label}: ${report.ev_row.verdict} / resolved=${report.ev_row.resolved_n} / drop=${report.ev_row.ev_drop_n} / avg_ret=${signedPct(report.ev_row.avg_ret_net)}`);
  if (report.wait_row) lines.push(`- ${report.wait_row.label}: ${report.wait_row.verdict} / trigger=${report.wait_row.trigger_n} / beneficial=${pct(report.wait_row.beneficial_rate)} / harmful=${pct(report.wait_row.harmful_rate)} / avg_delta=${signedPct(report.wait_row.avg_delta_ret_net)}`);
  lines.push("", "## Quality Reasons");
  for (const row of report.quality_rows || []) {
    lines.push(`- ${row.reason}: ${row.verdict} / matured=${row.matured_n} / TP1=${pct(row.tp1_first_rate)} / SL=${pct(row.sl_first_rate)} / avg_ret=${signedPct(row.avg_horizon_ret_net)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const governance = loadLatestJson("weekly_filter_governance_latest.json", null);
  const evLedger = loadLatestJson("ev_resolved_ledger_latest.json", null);
  const waitLedger = loadLatestJson("wait_state_machine_latest.json", null);
  const current = governance.data && governance.data.current ? governance.data.current : {};
  const dropCounterfactual = current.drop_counterfactual && current.drop_counterfactual.by_stage ? current.drop_counterfactual.by_stage : {};
  const qualityDeepDive = current.quality_deep_dive && Array.isArray(current.quality_deep_dive.by_reason) ? current.quality_deep_dive.by_reason : [];
  const stageRows = buildCounterfactualStageRows(dropCounterfactual);
  const qualityRows = buildQualityReasonRows(qualityDeepDive);
  const evRow = buildEvStageRow(evLedger.data && evLedger.data.summary ? evLedger.data.summary : {});
  const waitRow = buildWaitStageRow(waitLedger.data && waitLedger.data.summary ? waitLedger.data.summary : {});
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    stage_rows: stageRows,
    quality_rows: qualityRows,
    ev_row: evRow,
    wait_row: waitRow,
    summary: buildSummary(stageRows, evRow, waitRow),
    artifacts: {
      governance: governance.filePath,
      ev_ledger: evLedger.filePath,
      wait_ledger: waitLedger.filePath,
    },
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_opportunity_cost_ledger.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_opportunity_cost_ledger.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const alert = await sendKoreanTelegramSummary({
    title: `[기회손실 점검] ${report.summary.primary_soften_label || "유지"}`,
    severity: report.summary.primary_soften_stage ? "WARN" : "INFO",
    dedupeKey: `opportunity_cost:${report.summary.primary_soften_stage || "NONE"}:${report.summary.primary_tighten_stage || "NONE"}`,
    dedupeWindowSec: 6 * 60 * 60,
    dedupeFingerprint: JSON.stringify({
      soften: report.summary.primary_soften_stage,
      tighten: report.summary.primary_tighten_stage,
      ev: report.summary.ev_verdict,
      wait: report.summary.wait_verdict,
    }),
    sections: [
      {
        header: "완화 압박",
        lines: [
          report.summary.primary_soften_label
            ? `${report.summary.primary_soften_label} 쪽에서 기회손실 압박이 가장 큽니다.`
            : "지금은 뚜렷한 완화 압박이 없습니다.",
        ],
      },
      {
        header: "강화 압박",
        lines: [
          report.summary.primary_tighten_label
            ? `${report.summary.primary_tighten_label} 쪽은 오히려 현재 차단이 방어적으로 맞을 가능성이 큽니다.`
            : "지금은 뚜렷한 강화 압박이 없습니다.",
        ],
      },
      {
        header: "4차/5차 계층 실제 결과",
        lines: [
          `4차 EV/시간가치층 ${evRow.verdict} / resolved ${evRow.resolved_n} / avg_ret ${signedPct(evRow.avg_ret_net)}`,
          `5차 WAIT 타이밍층 ${waitRow.verdict} / trigger ${waitRow.trigger_n} / avg_delta ${signedPct(waitRow.avg_delta_ret_net)}`,
        ],
      },
      {
        header: "보고서",
        lines: [mdPath],
      },
    ],
  });
  if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "DEDUPED"))) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
  }

  console.log(JSON.stringify({
    ok: true,
    soften: report.summary.primary_soften_stage,
    tighten: report.summary.primary_tighten_stage,
    ev: report.summary.ev_verdict,
    wait: report.summary.wait_verdict,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    buildCounterfactualStageRows,
    buildEvStageRow,
    buildWaitStageRow,
    buildSummary,
  },
};
