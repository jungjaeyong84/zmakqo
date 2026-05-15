"use strict";

const { buildV3PaperPerformanceReport } = require("./performanceReport");

function toFiniteNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function upper(value) {
  return String(value == null ? "" : value).trim().toUpperCase() || null;
}

function sortClosedExitRows(exitRows = []) {
  return [...(Array.isArray(exitRows) ? exitRows : [])]
    .filter((row) => upper(row && row.status) === "CLOSED")
    .sort((a, b) => {
      const aMs = Date.parse(String(a && a.closed_at || ""));
      const bMs = Date.parse(String(b && b.closed_at || ""));
      return (Number.isFinite(aMs) ? aMs : 0) - (Number.isFinite(bMs) ? bMs : 0);
    });
}

function summarizeWindow(entryRows, exitRows, now) {
  const report = buildV3PaperPerformanceReport(entryRows, exitRows, { now });
  const metrics = report && report.current_policy_metrics_r
    ? report.current_policy_metrics_r
    : (report && report.all_time_metrics_r ? report.all_time_metrics_r : {});
  return Object.freeze({
    sample_n: Number(metrics.sample_n || 0),
    win_rate_pct: toFiniteNumber(metrics.win_rate_pct, 0),
    expectancy_r: toFiniteNumber(metrics.expectancy, 0),
    net_r: toFiniteNumber(metrics.net, 0),
    profit_factor: metrics.profit_factor,
  });
}

function buildTradeWindows(entryRows, exitRows, now, windowSizes = []) {
  const closedRows = sortClosedExitRows(exitRows);
  return Object.freeze(
    (Array.isArray(windowSizes) ? windowSizes : [])
      .map((size) => Math.trunc(Number(size)))
      .filter((size) => Number.isFinite(size) && size > 0)
      .map((size) => {
        const available = closedRows.length >= size;
        const rows = available ? closedRows.slice(closedRows.length - size) : closedRows;
        const metrics = summarizeWindow(entryRows, rows, now);
        return Object.freeze({
          label: `last_${size}_trades`,
          trade_n: size,
          available,
          metrics,
        });
      })
  );
}

function buildDayWindows(entryRows, exitRows, now, dayWindows = []) {
  const closedRows = sortClosedExitRows(exitRows);
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  return Object.freeze(
    (Array.isArray(dayWindows) ? dayWindows : [])
      .map((days) => Math.trunc(Number(days)))
      .filter((days) => Number.isFinite(days) && days > 0)
      .map((days) => {
        const floorMs = nowMs - days * 24 * 60 * 60 * 1000;
        const rows = closedRows.filter((row) => {
          const closedMs = Date.parse(String(row && row.closed_at || ""));
          return Number.isFinite(closedMs) && closedMs >= floorMs;
        });
        return Object.freeze({
          label: `last_${days}d`,
          day_n: days,
          metrics: summarizeWindow(entryRows, rows, now),
        });
      })
  );
}

function toRecommendationText(code) {
  switch (String(code || "").toUpperCase()) {
    case "READY_FOR_RUNTIME_LANE_REVIEW":
      return "paper 표본이 최소 기준을 통과했습니다. 다음 단계 검토가 가능합니다.";
    case "WAIT_LIVE_SEED_MIX_EXPANSION":
      return "live v3 seed 비중이 아직 낮아 static seed 의존이 큽니다.";
    case "WAIT_PAPER_SAMPLE_ACCUMULATION":
      return "paper closed trade 표본이 아직 부족합니다.";
    case "PAPER_SAMPLE_FAILS_QUALITY":
      return "paper 표본은 쌓였지만 승률/기대값 기준을 아직 못 넘었습니다.";
    case "WAIT_BOOTSTRAP_EXPANSION":
      return "bootstrap retained 표본이 아직 부족하거나 기준 미달입니다.";
    default:
      return "validation 상태를 확인 중입니다.";
  }
}

function buildV3PaperValidationReport({
  bootstrap = {},
  entryRows = [],
  exitRows = [],
  now = new Date(),
  thresholds = {},
} = {}) {
  const retainedSampleMin = Math.max(1, Math.trunc(Number(thresholds.min_retained_sample_n || 50)));
  const paperClosedTradeMin = Math.max(1, Math.trunc(Number(thresholds.min_closed_trade_n || 30)));
  const paperWinRateMin = Number.isFinite(Number(thresholds.min_paper_win_rate_pct))
    ? Number(thresholds.min_paper_win_rate_pct)
    : 52;
  const paperExpectancyMin = Number.isFinite(Number(thresholds.min_paper_expectancy_r))
    ? Number(thresholds.min_paper_expectancy_r)
    : 0;
  const liveSeedActivationMin = Math.max(1, Math.trunc(Number(thresholds.min_live_seed_activation_n || 5)));
  const liveSeedMatureTarget = Math.max(
    liveSeedActivationMin,
    Math.trunc(Number(thresholds.min_live_seed_mature_n || 10))
  );
  const liveSeedShareMinPct = Number.isFinite(Number(thresholds.min_live_seed_share_pct))
    ? Number(thresholds.min_live_seed_share_pct)
    : 10;
  const staticReferenceCapN = Math.max(
    1,
    Math.trunc(Number(thresholds.live_seed_static_reference_cap_n || 50))
  );
  const tradeWindows = Array.isArray(thresholds.trade_windows) && thresholds.trade_windows.length
    ? thresholds.trade_windows
    : [10, 20, 30];
  const dayWindows = Array.isArray(thresholds.day_windows) && thresholds.day_windows.length
    ? thresholds.day_windows
    : [7, 14, 30];

  const allTime = summarizeWindow(entryRows, exitRows, now);
  const rollingTradeWindows = buildTradeWindows(entryRows, exitRows, now, tradeWindows);
  const rollingDayWindows = buildDayWindows(entryRows, exitRows, now, dayWindows);

  const retainedSampleN = Number(bootstrap && bootstrap.retained_sample_n || 0);
  const gateBreakdown = bootstrap && typeof bootstrap.gate_breakdown === "object" ? bootstrap.gate_breakdown : null;
  const staticGate = gateBreakdown && gateBreakdown.static_usdt ? gateBreakdown.static_usdt : {};
  const liveGate = gateBreakdown && gateBreakdown.live_r ? gateBreakdown.live_r : {};
  const staticWinRatePct = toFiniteNumber(staticGate.win_rate_pct, 0);
  const staticExpectancyUsdt = toFiniteNumber(staticGate.expectancy_usdt, 0);
  const staticSampleN = Number(staticGate.sample_n || 0);
  const staticGateHit = staticGate.hit === true;
  const staticGatePositive = staticGate.positive === true;
  const liveBootstrapWinRatePct = toFiniteNumber(liveGate.win_rate_pct, 0);
  const liveBootstrapExpectancyR = toFiniteNumber(liveGate.expectancy_r, 0);
  const liveBootstrapSampleN = Number(liveGate.sample_n || 0);
  const liveBootstrapGateHit = liveGate.hit === true;
  const liveBootstrapGatePositive = liveGate.positive === true;
  const bootstrapWinRatePct = toFiniteNumber(bootstrap && bootstrap.retained_metrics && bootstrap.retained_metrics.win_rate_pct, 0);
  const bootstrapExpectancyUsdt = staticExpectancyUsdt;
  const bootstrapTargetHit = bootstrap && bootstrap.target_hit === true;
  const bootstrapPositiveExpectancy = staticGatePositive;
  const seedMix = bootstrap && typeof bootstrap.seed_mix === "object" ? bootstrap.seed_mix : {};
  const liveSeedSourceN = Number(seedMix.live_seed_source_n != null ? seedMix.live_seed_source_n : (bootstrap && bootstrap.live_seed_source_n) || 0);
  const staticSeedSourceN = Number(seedMix.static_seed_source_n != null ? seedMix.static_seed_source_n : (bootstrap && bootstrap.static_seed_source_n) || 0);
  const effectiveStaticReferenceN = Number.isFinite(Number(seedMix.effective_static_reference_n))
    ? Number(seedMix.effective_static_reference_n)
    : Math.min(staticSeedSourceN, staticReferenceCapN);
  const effectiveLiveSeedSharePct = Number.isFinite(Number(seedMix.effective_live_seed_share_pct))
    ? Number(seedMix.effective_live_seed_share_pct)
    : (() => {
        const denominator = liveSeedSourceN + effectiveStaticReferenceN;
        return denominator > 0 ? (liveSeedSourceN / denominator) * 100 : 0;
      })();
  const liveSeedGateActive = liveSeedSourceN >= liveSeedActivationMin;
  const liveSeedGateMature = liveSeedSourceN >= liveSeedMatureTarget;
  const liveSeedGateOk = !liveSeedGateActive || effectiveLiveSeedSharePct >= liveSeedShareMinPct;
  const retainedLiveMetricsR = bootstrap && typeof bootstrap === "object" ? (bootstrap.retained_live_metrics_r || {}) : {};
  const bootstrapLiveSampleN = liveBootstrapSampleN || Number(retainedLiveMetricsR.sample_n || 0);
  const bootstrapLiveExpectancyR = liveBootstrapExpectancyR || toFiniteNumber(retainedLiveMetricsR.expectancy_r, 0);
  const bootstrapLivePositiveExpectancy = liveBootstrapGatePositive && (
    !liveSeedGateActive || bootstrapLiveSampleN >= liveSeedActivationMin
  );
  const bootstrapGateOk = (
    retainedSampleN >= retainedSampleMin
    && bootstrapTargetHit
    && bootstrapPositiveExpectancy
    && bootstrapLivePositiveExpectancy
    && staticGateHit
    && liveBootstrapGateHit
  );

  const paperSampleN = Number(allTime.sample_n || 0);
  const paperSampleOk = paperSampleN >= paperClosedTradeMin;
  const paperQualityOk = allTime.win_rate_pct >= paperWinRateMin && allTime.expectancy_r > paperExpectancyMin;
  const stableTradeWindows = rollingTradeWindows.filter((row) => row.available);
  const rollingGateOk = stableTradeWindows.length > 0
    ? stableTradeWindows.every((row) => row.metrics.expectancy_r > paperExpectancyMin)
    : false;

  let readiness = "WAIT_BOOTSTRAP_EXPANSION";
  if (bootstrapGateOk) {
    if (liveSeedGateActive && !liveSeedGateOk) readiness = "WAIT_LIVE_SEED_MIX_EXPANSION";
    else if (!paperSampleOk) readiness = "WAIT_PAPER_SAMPLE_ACCUMULATION";
    else if (!paperQualityOk || !rollingGateOk) readiness = "PAPER_SAMPLE_FAILS_QUALITY";
    else readiness = "READY_FOR_RUNTIME_LANE_REVIEW";
  }

  const summaryLines = [];
  if (!bootstrapGateOk) {
    const shortfall = Math.max(0, retainedSampleMin - retainedSampleN);
    if (shortfall > 0) {
      summaryLines.push(`bootstrap retained sample ${shortfall}건 추가 필요`);
    }
    if (!staticGateHit) {
      summaryLines.push(`bootstrap static USDT WR ${round(staticWinRatePct, 2)}% (n=${staticSampleN})로 목표 55% 미달`);
    }
    if (!liveBootstrapGateHit) {
      summaryLines.push(`bootstrap live R WR ${round(liveBootstrapWinRatePct, 2)}% (n=${liveBootstrapSampleN})로 목표 55% 미달`);
    }
    if (!staticGatePositive) {
      summaryLines.push(`bootstrap static expectancy ${round(staticExpectancyUsdt, 4)} USDT로 양수 아님`);
    }
    if (!liveBootstrapGatePositive) {
      summaryLines.push(`bootstrap live expectancy ${round(liveBootstrapExpectancyR, 4)}R로 양수 아님`);
    }
  }
  if (liveSeedSourceN > 0 && !liveSeedGateMature) {
    summaryLines.push(`live seed ${Math.max(0, liveSeedMatureTarget - liveSeedSourceN)}건 추가 누적 필요`);
  }
  if (liveSeedGateActive && !liveSeedGateOk) {
    summaryLines.push(`live seed 비중 ${round(effectiveLiveSeedSharePct, 2)}% / 최소 ${round(liveSeedShareMinPct, 2)}%`);
  }
  if (!paperSampleOk) {
    summaryLines.push(`paper closed trade ${Math.max(0, paperClosedTradeMin - paperSampleN)}건 추가 필요`);
  } else if (!paperQualityOk) {
    summaryLines.push(`paper current-policy win rate ${round(allTime.win_rate_pct, 2)}% / expectancy ${round(allTime.expectancy_r, 4)}R`);
  }
  if (paperSampleOk && stableTradeWindows.length && !rollingGateOk) {
    const failing = stableTradeWindows.find((row) => row.metrics.expectancy_r <= paperExpectancyMin);
    if (failing) {
      summaryLines.push(`${failing.label} window expectancy ${round(failing.metrics.expectancy_r, 4)}R`);
    }
  }
  if (!summaryLines.length) {
    summaryLines.push(toRecommendationText(readiness));
  }

  return Object.freeze({
    ok: true,
    readiness,
    recommendation_text: toRecommendationText(readiness),
    bootstrap_gate: Object.freeze({
      ok: bootstrapGateOk,
      retained_sample_n: retainedSampleN,
      min_required_n: retainedSampleMin,
      remaining_to_min_n: Math.max(0, retainedSampleMin - retainedSampleN),
      win_rate_pct: round(bootstrapWinRatePct, 2),
      expectancy_usdt: round(bootstrapExpectancyUsdt, 4),
      live_sample_n: bootstrapLiveSampleN,
      live_expectancy_r: round(bootstrapLiveExpectancyR, 4),
      target_hit: bootstrapTargetHit,
      positive_expectancy: bootstrapPositiveExpectancy,
      live_positive_expectancy: bootstrapLivePositiveExpectancy,
      static_gate: Object.freeze({
        sample_n: staticSampleN,
        win_rate_pct: round(staticWinRatePct, 2),
        expectancy_usdt: round(staticExpectancyUsdt, 4),
        hit: staticGateHit,
        positive: staticGatePositive,
      }),
      live_gate: Object.freeze({
        sample_n: liveBootstrapSampleN,
        win_rate_pct: round(liveBootstrapWinRatePct, 2),
        expectancy_r: round(liveBootstrapExpectancyR, 4),
        hit: liveBootstrapGateHit,
        positive: liveBootstrapGatePositive,
      }),
      both_required: true,
    }),
    seed_mix_gate: Object.freeze({
      active: liveSeedGateActive,
      ok: liveSeedGateOk,
      mature: liveSeedGateMature,
      live_seed_source_n: liveSeedSourceN,
      static_seed_source_n: staticSeedSourceN,
      effective_static_reference_n: effectiveStaticReferenceN,
      effective_live_seed_share_pct: round(effectiveLiveSeedSharePct, 2),
      min_live_seed_share_pct: round(liveSeedShareMinPct, 2),
      activation_min_n: liveSeedActivationMin,
      mature_target_n: liveSeedMatureTarget,
      remaining_to_activation_n: Math.max(0, liveSeedActivationMin - liveSeedSourceN),
      remaining_to_mature_n: Math.max(0, liveSeedMatureTarget - liveSeedSourceN),
    }),
    paper_gate: Object.freeze({
      ok: paperSampleOk && paperQualityOk && rollingGateOk,
      sample_ok: paperSampleOk,
      quality_ok: paperQualityOk,
      rolling_ok: rollingGateOk,
      closed_trade_n: paperSampleN,
      min_required_n: paperClosedTradeMin,
      remaining_to_min_n: Math.max(0, paperClosedTradeMin - paperSampleN),
      win_rate_pct: round(allTime.win_rate_pct, 2),
      expectancy_r: round(allTime.expectancy_r, 4),
      net_r: round(allTime.net_r, 4),
      min_win_rate_pct: round(paperWinRateMin, 2),
      min_expectancy_r: round(paperExpectancyMin, 4),
    }),
    rolling_trade_windows: rollingTradeWindows,
    rolling_day_windows: rollingDayWindows,
    summary_lines: Object.freeze(summaryLines),
  });
}

module.exports = Object.freeze({
  buildV3PaperValidationReport,
  __test: {
    sortClosedExitRows,
    buildTradeWindows,
    buildDayWindows,
  },
});
