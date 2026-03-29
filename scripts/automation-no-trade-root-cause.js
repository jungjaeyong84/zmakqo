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
  PERIOD_KEYS,
  PERIOD_WEIGHTS,
  loadLatestJson,
  resolveRetrospectivePeriods,
  safeTopReasons,
  signedKrw,
  stageLabel,
  sumStageCounts,
  toNum,
} = require("./lib/objective-control");

loadLocalEnv();

const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "no_trade_root_cause_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "no_trade_root_cause_latest.md");
const STAGE_ACTION_HINTS = Object.freeze({
  PINE: "Pine 품질 번들 생성 조건이 너무 엄격한지 먼저 봐야 합니다.",
  OPS: "운영 보호, 데이터 무결성, 웹훅 흐름을 먼저 확인해야 합니다.",
  QUALITY: "Pine 품질 기준과 1차 guard 경계가 과차단인지 확인해야 합니다.",
  AI: "2차 AI usable, missing, block 정책과 데이터 수집 상태를 같이 확인해야 합니다.",
  MARKET: "3차 시황 방향 prior가 과하게 보수적인지 확인해야 합니다.",
  EV: "4차 EV 확률 기준과 수량 밴드가 과하게 높지 않은지 확인해야 합니다.",
  TIMING: "5차 WAIT 타이밍 연기 조건이 과도한지 확인해야 합니다.",
  EXIT: "청산 구조가 지나치게 공격적이거나 보수적인지 확인해야 합니다.",
});

function upper(v) {
  return String(v || "").trim().toUpperCase();
}

function buildStageEntries(period = {}, coverageGuard = {}) {
  const objective = period && period.objective ? period.objective : {};
  const entry = period && period.entry_cohort ? period.entry_cohort : {};
  const drops = period && period.drops ? period.drops : {};
  const counts = drops && drops.counts && typeof drops.counts === "object" ? drops.counts : {};
  const totalDrops = Math.max(0, sumStageCounts(counts));
  const signalsN = Math.max(0, Number(entry.signals_n || 0));
  const executedN = Math.max(0, Number(entry.executed_n || 0));
  const activityFail = objective.activity_pass === false || executedN === 0;
  const entries = [];

  if (signalsN === 0) {
    entries.push({
      stage: "PINE",
      label: stageLabel("PINE"),
      count: 0,
      share: 1,
      score: activityFail ? 3.5 : 1.5,
      trust: true,
      reason: "신호 자체가 거의 생성되지 않아 Pine 품질 기준 또는 Pine 표시 조건이 너무 보수적일 가능성이 큽니다.",
      action_hint: STAGE_ACTION_HINTS.PINE,
    });
  }

  for (const [stage, rawCount] of Object.entries(counts)) {
    const count = Math.max(0, Number(rawCount || 0));
    if (count <= 0) continue;
    const share = totalDrops > 0 ? (count / totalDrops) : 0;
    const stageKey = upper(stage);
    const coveragePass = stageKey === "AI"
      ? Boolean(coverageGuard.ai && coverageGuard.ai.pass === true)
      : stageKey === "MARKET"
        ? Boolean(coverageGuard.market && coverageGuard.market.pass === true)
        : true;
    const trust = stageKey === "AI" || stageKey === "MARKET" ? coveragePass : true;
    const signalWeight = signalsN > 0 ? (count / Math.max(1, signalsN)) : 0;
    const score = Number((share * 1.6) + (signalWeight * 1.4) + (activityFail ? 0.9 : 0.2) + (trust ? 0.1 : -0.2));
    const reason = stageKey === "QUALITY"
      ? "1차 무결성 가드 fallback 차단 비중이 높아, 실제 거래 부족의 직접 원인일 가능성이 큽니다."
      : stageKey === "EV"
        ? "4차 EV에서 TP1 확률 기준으로 많이 걸러져 거래가 줄었을 가능성이 큽니다."
        : stageKey === "MARKET"
          ? "3차 시황 방향 prior에서 막힌 비중이 커 거래가 줄었을 가능성이 큽니다."
          : stageKey === "AI"
            ? "2차 AI usable 또는 missing/block 정책이 거래 부족에 영향을 줬을 가능성이 있습니다."
            : stageKey === "TIMING"
              ? "5차 WAIT 타이밍 연기로 진입이 뒤로 밀렸을 가능성이 있습니다."
              : "운영 보호나 기타 비거래 사유 비중이 높습니다.";
    entries.push({
      stage: stageKey,
      label: stageLabel(stageKey),
      count,
      share,
      score,
      trust,
      reason,
      action_hint: STAGE_ACTION_HINTS[stageKey] || STAGE_ACTION_HINTS.OPS,
    });
  }

  if (signalsN > 0 && executedN === 0 && totalDrops === 0) {
    entries.push({
      stage: "OPS",
      label: stageLabel("OPS"),
      count: 0,
      share: 0,
      score: 2.8,
      trust: true,
      reason: "신호는 있었는데 실행과 드롭 기록이 함께 비어 있어 운영/데이터 흐름 문제 가능성이 큽니다.",
      action_hint: STAGE_ACTION_HINTS.OPS,
    });
  }

  return entries.sort((a, b) => b.score - a.score || b.count - a.count || a.stage.localeCompare(b.stage));
}

function buildPeriodRootCause(periodKey, period = {}, coverageGuard = {}) {
  const objective = period && period.objective ? period.objective : {};
  const entry = period && period.entry_cohort ? period.entry_cohort : {};
  const realized = period && period.realized_trades ? period.realized_trades : {};
  const drops = period && period.drops ? period.drops : {};
  const stageEntries = buildStageEntries(period, coverageGuard);
  const primary = stageEntries[0] || null;
  const topReasons = safeTopReasons(drops.top_reasons || [], 5);
  const stageCounts = drops && drops.counts && typeof drops.counts === "object" ? drops.counts : {};
  const totalDrops = Math.max(0, sumStageCounts(stageCounts));
  const signalsN = Math.max(0, Number(entry.signals_n || 0));
  const executedN = Math.max(0, Number(entry.executed_n || 0));
  const targetKrw = toNum(objective.period_target_krw) || 0;
  const actualKrw = toNum(realized.net_pnl_quote) || 0;
  const gapKrw = targetKrw - actualKrw;
  const mode = executedN === 0
    ? "NO_TRADE"
    : (objective.pass === false ? "UNDERPERFORM" : "ON_TRACK");
  return {
    period: upper(periodKey),
    mode,
    objective_verdict: String(objective.verdict || "N/A"),
    executed_n: executedN,
    signals_n: signalsN,
    realized_n: Math.max(0, Number(realized.realized_n || 0)),
    execution_rate: toNum(entry.execution_rate),
    target_krw: targetKrw,
    actual_krw: actualKrw,
    gap_krw: gapKrw,
    drop_total: totalDrops,
    stage_counts: stageCounts,
    primary_stage: primary ? primary.stage : null,
    primary_stage_label: primary ? primary.label : null,
    primary_reason: topReasons[0] ? topReasons[0].reason : null,
    top_reasons: topReasons,
    root_causes: stageEntries,
  };
}

function buildAggregateRootCause(periodRows = {}) {
  const scores = new Map();
  for (const key of PERIOD_KEYS) {
    const row = periodRows[key];
    const weight = PERIOD_WEIGHTS[key] || 1;
    for (const cause of Array.isArray(row && row.root_causes) ? row.root_causes : []) {
      const next = (scores.get(cause.stage) || 0) + (Number(cause.score || 0) * weight);
      scores.set(cause.stage, next);
    }
  }
  const ranked = Array.from(scores.entries())
    .map(([stage, score]) => ({ stage, label: stageLabel(stage), score }))
    .sort((a, b) => b.score - a.score || a.stage.localeCompare(b.stage));
  const anyNoTrade = PERIOD_KEYS.some((key) => String(periodRows[key] && periodRows[key].mode || "") === "NO_TRADE");
  return {
    verdict: anyNoTrade ? "NO_TRADE_PRESSURE" : "UNDERPERFORMANCE_PRESSURE",
    primary_stage: ranked[0] ? ranked[0].stage : null,
    primary_stage_label: ranked[0] ? ranked[0].label : null,
    ranked_stages: ranked,
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# No Trade Root Cause",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- verdict: ${report.summary && report.summary.verdict || "N/A"}`,
    `- primary: ${report.summary && report.summary.primary_stage_label || "N/A"}`,
    "",
  ];
  for (const key of PERIOD_KEYS) {
    const row = report.periods && report.periods[key] ? report.periods[key] : null;
    if (!row) continue;
    lines.push(`## ${key}`);
    lines.push(`- mode: ${row.mode}`);
    lines.push(`- signals/executed/realized: ${row.signals_n}/${row.executed_n}/${row.realized_n}`);
    lines.push(`- target vs actual: ${signedKrw(row.target_krw)} / ${signedKrw(row.actual_krw)} / gap=${signedKrw(row.gap_krw)}`);
    lines.push(`- primary stage: ${row.primary_stage_label || "N/A"}`);
    lines.push(`- primary reason: ${row.primary_reason || "N/A"}`);
    const topCause = Array.isArray(row.root_causes) ? row.root_causes.slice(0, 3) : [];
    for (const cause of topCause) {
      lines.push(`- ${cause.label}: count=${cause.count || 0} / share=${((Number(cause.share || 0)) * 100).toFixed(1)}% / trust=${cause.trust ? "YES" : "LOW"}`);
      lines.push(`  - ${cause.reason}`);
      lines.push(`  - 조치 힌트: ${cause.action_hint}`);
    }
    lines.push("");
  }
  lines.push("## Aggregate");
  for (const row of report.summary && Array.isArray(report.summary.ranked_stages) ? report.summary.ranked_stages.slice(0, 5) : []) {
    lines.push(`- ${row.label}: score=${row.score.toFixed(2)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const retrospective = loadLatestJson("objective_retrospective_latest.json", null);
  const governance = loadLatestJson("weekly_filter_governance_latest.json", null);
  const coverage = loadLatestJson("stage_coverage_guard_latest.json", null);
  const periods = resolveRetrospectivePeriods(retrospective.data);
  const coverageGuard = coverage.data && coverage.data.guard ? coverage.data.guard : {};

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    periods: {},
    summary: null,
    artifacts: {
      retrospective: retrospective.filePath,
      governance: governance.filePath,
      coverage: coverage.filePath,
    },
  };

  for (const key of PERIOD_KEYS) {
    report.periods[key] = buildPeriodRootCause(key, periods[key] || {}, coverageGuard);
  }
  report.summary = buildAggregateRootCause(report.periods);

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_no_trade_root_cause.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_no_trade_root_cause.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const daily = report.periods.DAILY;
  const weekly = report.periods.WEEKLY;
  const monthly = report.periods.MONTHLY;
  const alert = await sendKoreanTelegramSummary({
    title: `[무거래 원인 분해] ${report.summary.verdict}`,
    severity: String(daily && daily.mode || "") === "NO_TRADE" ? "WARN" : "INFO",
    dedupeKey: `no_trade_root_cause:${report.summary.verdict}:${daily && daily.primary_stage || "NONE"}`,
    dedupeWindowSec: 6 * 60 * 60,
    dedupeFingerprint: JSON.stringify({
      daily: daily && daily.primary_stage,
      weekly: weekly && weekly.primary_stage,
      monthly: monthly && monthly.primary_stage,
    }),
    sections: [
      {
        header: "당일",
        lines: [
          `실행 ${daily.executed_n}건 / 신호 ${daily.signals_n}건 / 목표 gap ${signedKrw(daily.gap_krw)}`,
          `주된 원인: ${daily.primary_stage_label || "정보 없음"} / ${daily.primary_reason || "정보 없음"}`,
        ],
      },
      {
        header: "주간",
        lines: [
          `실행 ${weekly.executed_n}건 / 목표 gap ${signedKrw(weekly.gap_krw)}`,
          `주된 원인: ${weekly.primary_stage_label || "정보 없음"}`,
        ],
      },
      {
        header: "월간",
        lines: [
          `실행 ${monthly.executed_n}건 / 목표 gap ${signedKrw(monthly.gap_krw)}`,
          `주된 원인: ${monthly.primary_stage_label || "정보 없음"}`,
        ],
      },
      {
        header: "종합",
        lines: [
          `가장 강한 압박 단계: ${report.summary.primary_stage_label || "정보 없음"}`,
          mdPath,
        ],
      },
    ],
  });
  if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "DEDUPED"))) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
  }

  console.log(JSON.stringify({
    ok: true,
    verdict: report.summary.verdict,
    primary_stage: report.summary.primary_stage,
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
    buildPeriodRootCause,
    buildAggregateRootCause,
  },
};
