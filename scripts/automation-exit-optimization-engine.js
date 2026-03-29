#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
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
  resolveRetrospectivePeriods,
  signedKrw,
  signedPct,
  toNum,
  weightedAverage,
} = require("./lib/objective-control");

loadLocalEnv();

const PROVIDER = String(process.env.EXIT_OPT_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "exit_optimization_engine_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "exit_optimization_engine_latest.md");
const MIN_WEEKLY_REALIZED = Math.max(8, Number(process.env.EXIT_OPT_MIN_WEEKLY_REALIZED || 12));
const MIN_MONTHLY_REALIZED = Math.max(12, Number(process.env.EXIT_OPT_MIN_MONTHLY_REALIZED || 20));
const MIN_MONTHLY_WIN_RATE = Number(process.env.EXIT_OPT_MIN_WIN_RATE || 0.60);

function resolveSurvivalRate(survival = [], hours = 12, key = "tp1_rate") {
  const row = (Array.isArray(survival) ? survival : []).find((item) => Number(item && item.hours) === Number(hours));
  return toNum(row && row[key]);
}

function aggregateFollowThrough(byTier = {}) {
  const rows = Object.entries(byTier || {}).map(([tier, stats]) => ({ tier, ...(stats || {}) }));
  const totalExecuted = rows.reduce((acc, row) => acc + (Number(row.executed_n || 0) || 0), 0);
  return {
    executed_n: totalExecuted,
    tp1_12h_rate: weightedAverage(rows.map((row) => ({
      executed_n: Number(row.executed_n || 0),
      tp1_rate: resolveSurvivalRate(row.survival, 12, "tp1_rate"),
    })), "executed_n", "tp1_rate"),
    sl_12h_rate: weightedAverage(rows.map((row) => ({
      executed_n: Number(row.executed_n || 0),
      sl_rate: resolveSurvivalRate(row.survival, 12, "sl_rate"),
    })), "executed_n", "sl_rate"),
    avg_mfe: weightedAverage(rows, "executed_n", "avg_mfe"),
    avg_mae: weightedAverage(rows, "executed_n", "avg_mae"),
    avg_time_to_tp1_h: weightedAverage(rows, "executed_n", "avg_time_to_tp1_h"),
    avg_time_to_sl_h: weightedAverage(rows, "executed_n", "avg_time_to_sl_h"),
  };
}

function evaluateExitProfile({ currentProfile, weekly = {}, monthly = {}, follow = {}, objective = {} } = {}) {
  const weeklyRealized = Number(weekly.realized_n || 0);
  const monthlyRealized = Number(monthly.realized_n || 0);
  const sampleSufficient = weeklyRealized >= MIN_WEEKLY_REALIZED && monthlyRealized >= MIN_MONTHLY_REALIZED;
  const monthlyWinRate = toNum(monthly.win_rate);
  const monthlyAvgRet = toNum(monthly.avg_ret_net);
  const monthlyNet = toNum(monthly.net_pnl_quote);
  const monthlyTargetPass = Boolean(objective.monthly && objective.monthly.objective && objective.monthly.objective.target_pass === true);
  const followTp = toNum(follow.tp1_12h_rate);
  const followSl = toNum(follow.sl_12h_rate);
  const avgMfe = toNum(follow.avg_mfe);
  const avgMae = toNum(follow.avg_mae);
  const current = String(currentProfile || "BASE").trim().toUpperCase() === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";

  let action = "KEEP";
  let nextProfile = current;
  let reason = "EXIT_PROFILE_KEEP";

  const aggressiveSupport = (Number.isFinite(followTp) && Number.isFinite(followSl) && followTp >= (followSl - 0.05))
    || (Number.isFinite(avgMfe) && Number.isFinite(avgMae) && avgMfe >= Math.abs(avgMae) * 0.7);
  const baseSupport = (Number.isFinite(monthlyAvgRet) && monthlyAvgRet > 0)
    || (Number.isFinite(monthlyWinRate) && monthlyWinRate >= MIN_MONTHLY_WIN_RATE && Number.isFinite(monthlyNet) && monthlyNet > 0);

  if (!sampleSufficient) {
    reason = "EXIT_SAMPLE_NOT_READY";
  } else if (current === "BASE") {
    if (monthlyTargetPass !== true && Number.isFinite(monthlyWinRate) && monthlyWinRate < MIN_MONTHLY_WIN_RATE && aggressiveSupport) {
      action = "REVIEW_UPDATE";
      nextProfile = "AGGRESSIVE";
      reason = "WIN_RATE_RECOVERY_NEEDS_AGGRESSIVE";
    }
  } else if (current === "AGGRESSIVE") {
    if ((Number.isFinite(monthlyAvgRet) && monthlyAvgRet < 0)
      || (Number.isFinite(monthlyWinRate) && monthlyWinRate >= MIN_MONTHLY_WIN_RATE && baseSupport)
      || (Number.isFinite(monthlyNet) && monthlyNet < 0)) {
      action = "REVIEW_UPDATE";
      nextProfile = "BASE";
      reason = "EXPECTANCY_RECOVERY_NEEDS_BASE";
    }
  }

  const challengerBeatsCurrent = action === "REVIEW_UPDATE" && nextProfile !== current;
  return {
    action,
    current_profile: current,
    next_profile: nextProfile,
    reason,
    sample_sufficient: sampleSufficient,
    challenger_beats_current: challengerBeatsCurrent,
    objective_alignment: monthlyTargetPass !== true || (Number.isFinite(monthlyNet) && monthlyNet <= 0),
    metrics: {
      weekly_realized_n: weeklyRealized,
      monthly_realized_n: monthlyRealized,
      monthly_win_rate: monthlyWinRate,
      monthly_avg_ret_net: monthlyAvgRet,
      monthly_net_pnl_quote: monthlyNet,
      follow_tp1_12h_rate: followTp,
      follow_sl_12h_rate: followSl,
      follow_avg_mfe: avgMfe,
      follow_avg_mae: avgMae,
      follow_avg_time_to_tp1_h: toNum(follow.avg_time_to_tp1_h),
      follow_avg_time_to_sl_h: toNum(follow.avg_time_to_sl_h),
    },
  };
}

function renderMarkdown(report = {}) {
  const d = report.decision || {};
  const m = d.metrics || {};
  return [
    "# Exit Optimization Engine",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- provider: ${report.provider || "N/A"}`,
    `- current_profile: ${d.current_profile || "N/A"}`,
    `- action: ${d.action || "N/A"}`,
    `- next_profile: ${d.next_profile || "N/A"}`,
    `- reason: ${d.reason || "N/A"}`,
    `- sample_sufficient: ${d.sample_sufficient ? "YES" : "NO"}`,
    "",
    "## Metrics",
    `- weekly realized: ${m.weekly_realized_n || 0}`,
    `- monthly realized: ${m.monthly_realized_n || 0}`,
    `- monthly win_rate: ${pct(m.monthly_win_rate)}`,
    `- monthly avg_ret_net: ${signedPct(m.monthly_avg_ret_net)}`,
    `- monthly net: ${signedKrw(m.monthly_net_pnl_quote)}`,
    `- follow TP1 12h: ${pct(m.follow_tp1_12h_rate)}`,
    `- follow SL 12h: ${pct(m.follow_sl_12h_rate)}`,
    `- follow avg_mfe: ${signedPct(m.follow_avg_mfe)}`,
    `- follow avg_mae: ${signedPct(m.follow_avg_mae)}`,
  ].join("\n") + "\n";
}

async function main() {
  const nowMeta = nowKstMeta();
  const sysRes = await getSystemSettingsForProvider(PROVIDER, 0);
  const sys = sysRes && sysRes.data ? sysRes.data : {};
  const retrospective = loadLatestJson("objective_retrospective_latest.json", null);
  const governance = loadLatestJson("weekly_filter_governance_latest.json", null);
  const periods = resolveRetrospectivePeriods(retrospective.data);
  const weekly = periods.WEEKLY && periods.WEEKLY.realized_trades ? periods.WEEKLY.realized_trades : {};
  const monthly = periods.MONTHLY && periods.MONTHLY.realized_trades ? periods.MONTHLY.realized_trades : {};
  const follow = aggregateFollowThrough(governance.data && governance.data.current && governance.data.current.pine_follow_through && governance.data.current.pine_follow_through.by_tier
    ? governance.data.current.pine_follow_through.by_tier
    : {});
  const currentProfile = String(sys.futures_exit_profile_mode || "BASE").trim().toUpperCase() || "BASE";
  const decision = evaluateExitProfile({
    currentProfile,
    weekly,
    monthly,
    follow,
    objective: periods,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    decision,
    artifacts: {
      retrospective: retrospective.filePath,
      governance: governance.filePath,
    },
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_exit_optimization_engine.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_exit_optimization_engine.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const alert = await sendKoreanTelegramSummary({
    title: `[청산 최적화] ${decision.action}`,
    severity: decision.action === "REVIEW_UPDATE" ? "INFO" : "INFO",
    dedupeKey: `exit_optimization:${decision.current_profile}:${decision.next_profile}:${decision.reason}`,
    dedupeWindowSec: 6 * 60 * 60,
    dedupeFingerprint: JSON.stringify(decision),
    sections: [
      {
        header: "현재 판단",
        lines: [
          `현재 청산 프로필은 ${decision.current_profile} 입니다.`,
          `다음 권고는 ${decision.next_profile} / 사유는 ${decision.reason} 입니다.`,
        ],
      },
      {
        header: "근거",
        lines: [
          `주간 실현 ${decision.metrics.weekly_realized_n}건 / 월간 실현 ${decision.metrics.monthly_realized_n}건`,
          `월간 승률 ${pct(decision.metrics.monthly_win_rate)} / 평균 기대수익 ${signedPct(decision.metrics.monthly_avg_ret_net)} / 월간 손익 ${signedKrw(decision.metrics.monthly_net_pnl_quote)}`,
          `12시간 follow-through TP1 ${pct(decision.metrics.follow_tp1_12h_rate)} / SL ${pct(decision.metrics.follow_sl_12h_rate)}`,
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
    action: decision.action,
    current_profile: decision.current_profile,
    next_profile: decision.next_profile,
    reason: decision.reason,
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
    aggregateFollowThrough,
    evaluateExitProfile,
  },
};
