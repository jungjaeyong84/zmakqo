#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

function toNum(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function classifyHigherWorse(value, warn, hold, block) {
  if (!Number.isFinite(value)) return "UNKNOWN";
  if (value >= block) return "BLOCK";
  if (value >= hold) return "HOLD";
  if (value >= warn) return "WARN";
  return "PASS";
}

function classifyLowerWorse(value, warn, hold, block) {
  if (!Number.isFinite(value)) return "UNKNOWN";
  if (value <= block) return "BLOCK";
  if (value <= hold) return "HOLD";
  if (value <= warn) return "WARN";
  return "PASS";
}

function chooseDecision(levels) {
  if (levels.includes("BLOCK")) return "중단";
  if (levels.includes("HOLD")) return "보류";
  if (levels.includes("WARN")) return "경고";
  if (levels.every((lv) => lv === "PASS")) return "정상";
  return "점검필요";
}

function pickLatestMetricPath(opsDir) {
  if (!fs.existsSync(opsDir)) return null;
  const names = fs
    .readdirSync(opsDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}_performance_metrics_jihye\.json$/.test(name));
  if (!names.length) return null;

  let latestPath = null;
  let latestMtime = -Infinity;
  for (const name of names) {
    const absPath = path.join(opsDir, name);
    let mtimeMs = null;
    try {
      mtimeMs = fs.statSync(absPath).mtimeMs;
    } catch (_err) {
      continue;
    }
    if (mtimeMs > latestMtime) {
      latestMtime = mtimeMs;
      latestPath = absPath;
    }
  }
  return latestPath;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const opsDir = path.join(repoRoot, "ops", "daily");
  const todayKey = kstDateKey(new Date().toISOString());
  const todayMetricPath = todayKey ? path.join(opsDir, `${todayKey}_performance_metrics_jihye.json`) : null;
  const latestMetricPath = pickLatestMetricPath(opsDir);
  const fallbackMetricPath = path.join(repoRoot, "ops", "daily", "2026-02-25_performance_metrics_jihye.json");
  const metricPath = process.argv[2]
    || (todayMetricPath && fs.existsSync(todayMetricPath) ? todayMetricPath : null)
    || latestMetricPath
    || fallbackMetricPath;
  const opsPath = process.argv[3] || path.join(repoRoot, "ops", "daily", "system_ops_check_latest.json");

  const metric = JSON.parse(fs.readFileSync(metricPath, "utf8"));
  const ops = JSON.parse(fs.readFileSync(opsPath, "utf8"));

  const dateKey = metric.date_key || kstDateKey(new Date().toISOString());
  if (!dateKey) {
    throw new Error("date_key 계산 실패");
  }

  const equity = toNum(metric.performance && metric.performance.equity_end_usdt, null);
  const requiredDailyPct = toNum(metric.performance && metric.performance.required_daily_pct, 0.1667);
  const netPnlUsdt = toNum(metric.performance && metric.performance.net_pnl_usdt, null);
  const netPnlPct = toNum(metric.performance && metric.performance.net_pnl_pct, null);
  const realizedPnlUsdt = toNum(metric.costs && metric.costs.realized_pnl_usdt, null);
  const totalCostUsdt = toNum(metric.costs && metric.costs.total_cost_usdt, null);
  const costRatioPct = toNum(metric.costs && metric.costs.cost_ratio_pct, null);
  const commissionRatioPct = toNum(metric.costs && metric.costs.commission_ratio_pct, null);
  const fundingRatioPct = toNum(metric.costs && metric.costs.funding_ratio_pct, null);
  const mddPct = toNum(metric.performance && metric.performance.mdd_pct, null);
  const winRatePct = toNum(metric.performance && metric.performance.interval_win_rate_pct, null);
  const profitFactor = toNum(metric.performance && metric.performance.interval_profit_factor, null);
  const volatilityPct = toNum(metric.performance && metric.performance.interval_volatility_pct, null);
  const errorCount = toNum(metric.latest_error_count_24h, toNum(ops.error_count, null));
  const sampleIntervals = toNum(metric.sample_counts && metric.sample_counts.intervals, 0);
  const minIntervalsForWinPf = toNum(process.env.PERF_MIN_INTERVALS, 5);
  const winPfSampleGateTriggered = Number.isFinite(sampleIntervals)
    && Number.isFinite(minIntervalsForWinPf)
    && sampleIntervals < minIntervalsForWinPf;

  const thresholds = {
    cost_ratio_pct: { warn: 0.16, hold: 0.2, block: 0.24, direction: "higher_worse" },
    mdd_pct: { warn: -1.2, hold: -1.5, block: -2.0, direction: "lower_worse" },
    win_rate_pct: { warn: 48, hold: 45, block: 40, direction: "lower_worse" },
    profit_factor: { warn: 1.1, hold: 1.0, block: 0.9, direction: "lower_worse" },
    error_count_24h: { warn: 1, hold: 2, block: 3, direction: "higher_worse" },
  };

  const status = {
    cost_ratio_pct: classifyHigherWorse(costRatioPct, thresholds.cost_ratio_pct.warn, thresholds.cost_ratio_pct.hold, thresholds.cost_ratio_pct.block),
    mdd_pct: classifyLowerWorse(mddPct, thresholds.mdd_pct.warn, thresholds.mdd_pct.hold, thresholds.mdd_pct.block),
    win_rate_pct: winPfSampleGateTriggered
      ? "HOLD"
      : classifyLowerWorse(winRatePct, thresholds.win_rate_pct.warn, thresholds.win_rate_pct.hold, thresholds.win_rate_pct.block),
    profit_factor: winPfSampleGateTriggered
      ? "HOLD"
      : classifyLowerWorse(profitFactor, thresholds.profit_factor.warn, thresholds.profit_factor.hold, thresholds.profit_factor.block),
    error_count_24h: classifyHigherWorse(errorCount, thresholds.error_count_24h.warn, thresholds.error_count_24h.hold, thresholds.error_count_24h.block),
  };

  const scenarioCuts = [10, 20, 30, 40].map((pctCut) => {
    const projectedCost = Number.isFinite(totalCostUsdt) ? totalCostUsdt * (1 - (pctCut / 100)) : null;
    const projectedNet = Number.isFinite(realizedPnlUsdt) && Number.isFinite(projectedCost)
      ? realizedPnlUsdt + projectedCost
      : null;
    const projectedNetPct = Number.isFinite(equity) && equity !== 0 && Number.isFinite(projectedNet)
      ? (projectedNet / equity) * 100
      : null;
    const projectedCostRatio = Number.isFinite(equity) && equity !== 0 && Number.isFinite(projectedCost)
      ? (Math.abs(projectedCost) / equity) * 100
      : null;
    return {
      cost_cut_pct: pctCut,
      projected_cost_usdt: round(projectedCost, 6),
      projected_cost_ratio_pct: round(projectedCostRatio, 4),
      projected_net_pnl_usdt: round(projectedNet, 6),
      projected_net_pnl_pct: round(projectedNetPct, 4),
      gap_vs_required_daily_pctp: Number.isFinite(projectedNetPct)
        ? round(projectedNetPct - requiredDailyPct, 4)
        : null,
    };
  });

  const costLimitUsdt = Number.isFinite(equity) ? ((equity * thresholds.cost_ratio_pct.hold) / 100) : null;
  const currentCostAbs = Number.isFinite(totalCostUsdt) ? Math.abs(totalCostUsdt) : null;
  const needCostReductionToHoldUsdt = Number.isFinite(currentCostAbs) && Number.isFinite(costLimitUsdt)
    ? Math.max(0, currentCostAbs - costLimitUsdt)
    : null;

  const targetNetUsdt = Number.isFinite(equity) ? (equity * requiredDailyPct) / 100 : null;
  const needNetUpliftToTargetUsdt = Number.isFinite(targetNetUsdt) && Number.isFinite(netPnlUsdt)
    ? targetNetUsdt - netPnlUsdt
    : null;
  const breakEvenUpliftUsdt = Number.isFinite(netPnlUsdt) ? Math.max(0, -netPnlUsdt) : null;
  const requiredCostForTargetUsdt = Number.isFinite(targetNetUsdt) && Number.isFinite(realizedPnlUsdt)
    ? targetNetUsdt - realizedPnlUsdt
    : null;
  const costOnlyTargetFeasible = Number.isFinite(requiredCostForTargetUsdt)
    ? requiredCostForTargetUsdt <= 0
    : null;

  const buckets = Array.isArray(metric.decomposition && metric.decomposition.by_time_bucket)
    ? metric.decomposition.by_time_bucket
    : [];
  const bucketEfficiency = buckets.map((b) => {
    const delta = toNum(b.delta_total_usdt, null);
    const cost = toNum(b.cost_increase_usdt, null);
    const netEff = Number.isFinite(delta) && Number.isFinite(cost) ? (delta - cost) : null;
    const costPer100 = Number.isFinite(delta) && delta > 0 && Number.isFinite(cost)
      ? (cost / delta) * 100
      : null;
    return {
      bucket: b.bucket,
      intervals: toNum(b.intervals, 0),
      delta_total_usdt: round(delta, 6),
      cost_increase_usdt: round(cost, 6),
      net_efficiency_usdt: round(netEff, 6),
      cost_per_100_usdt_return: round(costPer100, 4),
    };
  });

  const priorityOrder = bucketEfficiency
    .slice()
    .sort((a, b) => {
      const an = toNum(a.net_efficiency_usdt, -1e9);
      const bn = toNum(b.net_efficiency_usdt, -1e9);
      if (an !== bn) return an - bn;
      return String(a.bucket).localeCompare(String(b.bucket));
    })
    .map((row) => row.bucket);

  const levels = Object.values(status);
  const decision = chooseDecision(levels);
  const actionQueue = [];
  if (winPfSampleGateTriggered) {
    actionQueue.push({
      priority: 1,
      action: `표본 구간 ${sampleIntervals}개로 승률/PF 판정 신뢰도 낮음 -> 최소 ${minIntervalsForWinPf}개까지 데이터 확충`,
      owner: "보고 동기화/시스템 담당",
    });
  }
  actionQueue.push(
    {
      priority: actionQueue.length + 1,
      action: "비용 비율 0.24% 이상 구간 즉시 신규진입 차단",
      owner: "시스템 개발 담당",
    },
    {
      priority: actionQueue.length + 2,
      action: "순효율 최하위 시간대(09-16) 진입 조건 강화 A/B 테스트",
      owner: "퀀트 트레이너",
    },
    {
      priority: actionQueue.length + 3,
      action: "슬리피지와 주문 실패율을 5분 리포트 고정 필드로 추가",
      owner: "품질 관리자",
    },
  );

  const output = {
    generated_at_iso: new Date().toISOString(),
    generated_at_kst: toKstString(new Date().toISOString(), { fallbackToString: true }),
    date_key: dateKey,
    objective: {
      monthly_target_pct: 5,
      required_daily_pct: round(requiredDailyPct, 4),
      decision,
    },
    latest_metrics: {
      equity_usdt: round(equity, 6),
      net_pnl_usdt: round(netPnlUsdt, 6),
      net_pnl_pct: round(netPnlPct, 4),
      realized_pnl_usdt: round(realizedPnlUsdt, 6),
      total_cost_usdt: round(totalCostUsdt, 6),
      cost_ratio_pct: round(costRatioPct, 4),
      commission_ratio_pct: round(commissionRatioPct, 4),
      funding_ratio_pct: round(fundingRatioPct, 4),
      mdd_pct: round(mddPct, 4),
      win_rate_pct: round(winRatePct, 4),
      profit_factor: round(profitFactor, 4),
      volatility_pct: round(volatilityPct, 4),
      error_count_24h: errorCount,
    },
    kpi_thresholds: thresholds,
    kpi_status: status,
    data_quality: {
      sample_intervals: sampleIntervals,
      min_intervals_for_win_pf: minIntervalsForWinPf,
      win_pf_sample_gate_triggered: winPfSampleGateTriggered,
      win_pf_judgement_rule: winPfSampleGateTriggered
        ? "표본 미달로 HOLD 고정"
        : "임계값 기반 분류",
    },
    scenario_cost_cut: scenarioCuts,
    required_uplift: {
      to_hold_cost_limit_usdt: round(needCostReductionToHoldUsdt, 6),
      to_break_even_net_usdt: round(breakEvenUpliftUsdt, 6),
      to_target_daily_net_usdt: round(needNetUpliftToTargetUsdt, 6),
      required_cost_usdt_for_target_if_realized_fixed: round(requiredCostForTargetUsdt, 6),
      cost_only_target_feasible: costOnlyTargetFeasible,
    },
    decomposition_support: {
      by_time_bucket_efficiency: bucketEfficiency,
      priority_order: priorityOrder,
    },
    action_queue: actionQueue,
  };

  const outputPath = path.join(repoRoot, "ops", "daily", `${dateKey}_performance_decision_support_jihye.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  const timeBucketPath = path.join(repoRoot, "ops", "daily", `${dateKey}_time_bucket_efficiency_jihye.json`);
  const timeBucketPayload = {
    generated_at_kst: output.generated_at_kst,
    basis_file: path.relative(repoRoot, metricPath),
    definition: {
      net_efficiency_usdt: "구간손익(delta_total) - 비용증가(cost_increase)",
      cost_per_100_usdt_return: "해당 시간대 손익 100 USDT를 만들 때 든 비용(절대값 기준)",
    },
    rows: bucketEfficiency,
    priority_order: priorityOrder,
  };
  fs.writeFileSync(timeBucketPath, `${JSON.stringify(timeBucketPayload, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    output_path: outputPath,
    time_bucket_output_path: timeBucketPath,
    decision: output.objective.decision,
    kpi_status: output.kpi_status,
    win_pf_sample_gate_triggered: output.data_quality.win_pf_sample_gate_triggered,
    need_cost_reduction_to_hold_usdt: output.required_uplift.to_hold_cost_limit_usdt,
    need_uplift_to_target_usdt: output.required_uplift.to_target_daily_net_usdt,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("performance-decision-support failed:", err && err.message ? err.message : err);
  process.exit(1);
}
