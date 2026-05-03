"use strict";

const DEFAULT_MIN_WIN_RATE = 0.60;
const DEFAULT_MIN_MONTHLY_NET_KRW = 150_000;
const DEFAULT_MONTHLY_WINDOW_DAYS = 28;
const DEFAULT_MONTH_DAYS = 30;
const DEFAULT_MIN_ACTIVITY_COUNT = 1;
const DEFAULT_DAILY_REALIZED_MIN_SAMPLE = 1;
const DEFAULT_WEEKLY_REALIZED_MIN_SAMPLE = 3;
const DEFAULT_MONTHLY_REALIZED_MIN_SAMPLE = 8;

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundTo(v, digits = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function monthlyRunRateKrw(netPnlKrw, observedDays = DEFAULT_MONTHLY_WINDOW_DAYS, monthDays = DEFAULT_MONTH_DAYS) {
  const net = toNum(netPnlKrw);
  const days = toNum(observedDays);
  const month = toNum(monthDays);
  if (!Number.isFinite(net) || !Number.isFinite(days) || days <= 0 || !Number.isFinite(month) || month <= 0) return null;
  return roundTo(net * (month / days), 2);
}

function periodTargetKrw(periodKey, {
  minMonthlyNetKrw = DEFAULT_MIN_MONTHLY_NET_KRW,
  monthDays = DEFAULT_MONTH_DAYS,
} = {}) {
  const target = Number(minMonthlyNetKrw || DEFAULT_MIN_MONTHLY_NET_KRW);
  const days = Number(monthDays || DEFAULT_MONTH_DAYS);
  const period = String(periodKey || "MONTHLY").trim().toUpperCase();
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(days) || days <= 0) return null;
  if (period === "DAILY") return roundTo(target / days, 0);
  if (period === "WEEKLY") return roundTo((target / days) * 7, 0);
  return roundTo(target, 0);
}

function defaultRealizedMinSampleForPeriod(periodKey) {
  const period = String(periodKey || "MONTHLY").trim().toUpperCase();
  if (period === "DAILY") return DEFAULT_DAILY_REALIZED_MIN_SAMPLE;
  if (period === "WEEKLY") return DEFAULT_WEEKLY_REALIZED_MIN_SAMPLE;
  return DEFAULT_MONTHLY_REALIZED_MIN_SAMPLE;
}

function buildObjectiveVerdict(overall = {}, {
  realizedMinSample = 8,
  minWinRate = DEFAULT_MIN_WIN_RATE,
  minMonthlyNetKrw = DEFAULT_MIN_MONTHLY_NET_KRW,
  monthlyNetPnlKrw = null,
  monthlyObservedDays = DEFAULT_MONTHLY_WINDOW_DAYS,
  monthDays = DEFAULT_MONTH_DAYS,
  tradeCount = null,
  minActivityCount = DEFAULT_MIN_ACTIVITY_COUNT,
} = {}) {
  const realizedN = Number(overall.realized_n || 0);
  const executedN = Number(
    tradeCount != null
      ? tradeCount
      : (overall.executed_n != null ? overall.executed_n : realizedN)
  ) || 0;
  const winRate = toNum(overall.win_rate);
  const avgRetNet = toNum(overall.avg_ret_net);
  const netPnlKrw = toNum(overall.net_pnl_quote);
  const monthlyNet = toNum(monthlyNetPnlKrw);
  const monthlyRunRate = monthlyRunRateKrw(monthlyNet, monthlyObservedDays, monthDays);
  const enoughSample = realizedN >= Number(realizedMinSample || 0);
  const activityPass = executedN >= Number(minActivityCount || DEFAULT_MIN_ACTIVITY_COUNT);
  const winPass = Number.isFinite(winRate) && winRate >= Number(minWinRate || DEFAULT_MIN_WIN_RATE);
  const netPass = Number.isFinite(netPnlKrw) && netPnlKrw > 0;
  const evPass = Number.isFinite(avgRetNet) && avgRetNet > 0;
  const monthlyPass = Number.isFinite(monthlyRunRate) && monthlyRunRate >= Number(minMonthlyNetKrw || DEFAULT_MIN_MONTHLY_NET_KRW);
  const failedChecks = [];
  if (!activityPass) failedChecks.push("NO_TRADE_ACTIVITY");
  if (!enoughSample) failedChecks.push("INSUFFICIENT_SAMPLE");
  if (realizedN > 0 && !winPass) failedChecks.push("WIN_RATE_BELOW_TARGET");
  if (!netPass) failedChecks.push(executedN === 0 ? "ZERO_KRW_IDLE" : "NET_NOT_POSITIVE");
  if (realizedN > 0 && !evPass) failedChecks.push("EXPECTANCY_NOT_POSITIVE");
  if (!monthlyPass) failedChecks.push("MONTHLY_TARGET_NOT_MET");
  return {
    executed_n: executedN,
    min_activity_count: Number(minActivityCount || DEFAULT_MIN_ACTIVITY_COUNT),
    activity_pass: activityPass,
    enough_sample: enoughSample,
    realized_n: realizedN,
    min_win_rate: Number(minWinRate || DEFAULT_MIN_WIN_RATE),
    min_monthly_net_krw: Number(minMonthlyNetKrw || DEFAULT_MIN_MONTHLY_NET_KRW),
    month_days: Number(monthDays || DEFAULT_MONTH_DAYS),
    monthly_observed_days: Number(monthlyObservedDays || DEFAULT_MONTHLY_WINDOW_DAYS),
    monthly_net_pnl_krw: monthlyNet,
    monthly_run_rate_krw: monthlyRunRate,
    win_pass: winPass,
    net_pass: netPass,
    ev_pass: evPass,
    monthly_pass: monthlyPass,
    pass: activityPass && enoughSample && winPass && netPass && evPass && monthlyPass,
    verdict: (!activityPass || !netPass) ? "FAIL" : (!enoughSample ? "INSUFFICIENT_SAMPLE" : (failedChecks.length === 0 ? "PASS" : "FAIL")),
    failed_checks: failedChecks,
  };
}

function buildPeriodObjectiveVerdict(periodKey, overall = {}, {
  observedDays = null,
  realizedMinSample = null,
  minWinRate = DEFAULT_MIN_WIN_RATE,
  minMonthlyNetKrw = DEFAULT_MIN_MONTHLY_NET_KRW,
  monthDays = DEFAULT_MONTH_DAYS,
  targetNetKrw = null,
  minActivityCount = DEFAULT_MIN_ACTIVITY_COUNT,
  tradeCount = null,
} = {}) {
  const period = String(periodKey || "MONTHLY").trim().toUpperCase();
  const daysObserved = Number(observedDays) || (period === "DAILY" ? 1 : (period === "WEEKLY" ? 7 : DEFAULT_MONTH_DAYS));
  const target = toNum(targetNetKrw) ?? periodTargetKrw(period, { minMonthlyNetKrw, monthDays });
  const base = buildObjectiveVerdict(overall, {
    realizedMinSample: realizedMinSample != null ? realizedMinSample : defaultRealizedMinSampleForPeriod(period),
    minWinRate,
    minMonthlyNetKrw,
    monthlyNetPnlKrw: overall && overall.net_pnl_quote,
    monthlyObservedDays: daysObserved,
    monthDays,
    tradeCount,
    minActivityCount,
  });
  const netPnlKrw = toNum(overall && overall.net_pnl_quote);
  const targetPass = Number.isFinite(netPnlKrw) && Number.isFinite(target) && netPnlKrw >= target;
  const failedChecks = Array.from(base.failed_checks || []);
  if (!targetPass) failedChecks.push("PERIOD_TARGET_NOT_MET");
  const hardFail = failedChecks.includes("NO_TRADE_ACTIVITY")
    || failedChecks.includes("ZERO_KRW_IDLE")
    || failedChecks.includes("NET_NOT_POSITIVE")
    || failedChecks.includes("PERIOD_TARGET_NOT_MET");
  return {
    ...base,
    period,
    observed_days: daysObserved,
    period_target_krw: target,
    target_pass: targetPass,
    monthly_run_rate_krw: monthlyRunRateKrw(netPnlKrw, daysObserved, monthDays),
    pass: base.pass && targetPass,
    verdict: hardFail ? "FAIL" : (!base.enough_sample ? "INSUFFICIENT_SAMPLE" : (base.pass && targetPass ? "PASS" : "FAIL")),
    failed_checks: Array.from(new Set(failedChecks)),
  };
}

module.exports = {
  DEFAULT_MIN_WIN_RATE,
  DEFAULT_MIN_MONTHLY_NET_KRW,
  DEFAULT_MONTHLY_WINDOW_DAYS,
  DEFAULT_MONTH_DAYS,
  DEFAULT_MIN_ACTIVITY_COUNT,
  DEFAULT_DAILY_REALIZED_MIN_SAMPLE,
  DEFAULT_WEEKLY_REALIZED_MIN_SAMPLE,
  DEFAULT_MONTHLY_REALIZED_MIN_SAMPLE,
  buildObjectiveVerdict,
  buildPeriodObjectiveVerdict,
  defaultRealizedMinSampleForPeriod,
  monthlyRunRateKrw,
  periodTargetKrw,
};
