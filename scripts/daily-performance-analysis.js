#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");
const { parseErrorCount } = require("./lib/report-metrics");

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function pct(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return (value / base) * 100;
}

function stddev(values) {
  const arr = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  if (!arr.length) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function extractSigned(text, re) {
  const m = String(text || "").match(re);
  if (!m) return null;
  const raw = String(m[1] || "").replace(/,/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseTelegramRows(logText, dateKey) {
  const lines = String(logText || "").split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    const m = line.match(/^\[(.*?)\]\s+rc=\d+\s+(\{.*\})$/);
    if (!m) continue;
    const ts = m[1];
    if (!String(ts).startsWith(dateKey)) continue;

    let parsed = null;
    try {
      parsed = JSON.parse(m[2]);
    } catch {
      continue;
    }

    const text = String(parsed && parsed.result && parsed.result.text ? parsed.result.text : "");
    if (!text.includes("선물 총액:")) continue;

    const totalUsdt = extractSigned(text, /선물 총액:\s*([+\-]?[0-9,]+)\s*USDT/);
    if (!Number.isFinite(totalUsdt)) continue;

    const row = {
      ts,
      total_usdt: totalUsdt,
      interval_return_pct: extractSigned(text, /수익률\(이전 실행 대비\):\s*([+\-]?[0-9.]+)%/),
      realized_usdt: extractSigned(text, /수익\(실현,\s*오늘\):\s*([+\-]?[0-9,]+)\s*USDT/),
      cost_usdt: extractSigned(text, /비용\(수수료\+펀딩,\s*오늘\):\s*([+\-]?[0-9,]+)\s*USDT/),
      error_count_24h: extractSigned(text, /Errors \(24h\):\s*([0-9]+)/),
    };
    rows.push(row);
  }

  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return rows;
}

function timeBucket(ts) {
  const hour = Number(String(ts || "").slice(11, 13));
  if (!Number.isFinite(hour)) return "unknown";
  if (hour <= 8) return "00-08";
  if (hour <= 16) return "09-16";
  return "17-24";
}

function formatSnapshotTs(snapshotEnd) {
  const kst = toKstString(snapshotEnd, { fallbackToString: true });
  return String(kst || "").replace(" KST", "");
}

function computeDrawdown(points) {
  let peak = null;
  let peakTs = null;
  let mddPct = 0;
  let mddPeakTs = null;
  let mddTroughTs = null;

  for (const p of points) {
    if (!Number.isFinite(p.total_usdt)) continue;
    if (peak == null || p.total_usdt > peak) {
      peak = p.total_usdt;
      peakTs = p.ts;
    }
    if (Number.isFinite(peak) && peak > 0) {
      const dd = ((p.total_usdt - peak) / peak) * 100;
      if (dd < mddPct) {
        mddPct = dd;
        mddPeakTs = peakTs;
        mddTroughTs = p.ts;
      }
    }
  }

  return {
    mdd_pct: round(mddPct, 4),
    peak_ts: mddPeakTs,
    trough_ts: mddTroughTs,
  };
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const snapshotPath = process.argv[2] || path.join(repoRoot, "noye", "binance_snapshot_latest.json");
  const reportPath = process.argv[3] || path.join(repoRoot, "noye", "report.md");
  const telegramLogPath = process.argv[4] || path.join(repoRoot, "noye", "telegram_send.log");

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const reportText = fs.readFileSync(reportPath, "utf8");
  const telegramLog = fs.readFileSync(telegramLogPath, "utf8");

  const nowIso = new Date().toISOString();
  const dateKey = kstDateKey(snapshot.end_kst || nowIso) || kstDateKey(nowIso);
  if (!dateKey) {
    throw new Error("dateKey 계산 실패");
  }

  const rows = parseTelegramRows(telegramLog, dateKey);
  if (!rows.length) {
    throw new Error(`telegram_send.log에서 ${dateKey} 데이터 미발견`);
  }

  const snapshotEndTs = formatSnapshotTs(snapshot.end_kst);
  const timeline = rows.map((r) => ({
    ts: r.ts,
    total_usdt: r.total_usdt,
    realized_usdt: r.realized_usdt,
    cost_usdt: r.cost_usdt,
    source: "telegram",
  }));

  const lastRow = rows[rows.length - 1];
  const snapshotTotal = toNum(snapshot.total_equity, null);
  const snapshotRealized = toNum(snapshot.realized_pnl, null);
  const snapshotCost = toNum(snapshot.commission, 0) + toNum(snapshot.funding, 0);
  const needSnapshotPoint = Number.isFinite(snapshotTotal)
    && (Math.abs(snapshotTotal - toNum(lastRow.total_usdt, 0)) > 0.2 || snapshotEndTs !== lastRow.ts);

  if (needSnapshotPoint) {
    timeline.push({
      ts: snapshotEndTs,
      total_usdt: snapshotTotal,
      realized_usdt: snapshotRealized,
      cost_usdt: snapshotCost,
      source: "snapshot",
    });
  }

  timeline.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

  const intervals = [];
  const returns = [];
  let positiveIntervals = 0;
  let negativeIntervals = 0;
  let flatIntervals = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let winSum = 0;
  let lossAbsSum = 0;

  const bucketMap = {};
  const stateMap = {
    high_volatility: { intervals: 0, delta_total_usdt: 0, cost_increase_usdt: 0 },
    low_volatility: { intervals: 0, delta_total_usdt: 0, cost_increase_usdt: 0 },
  };

  for (let i = 1; i < timeline.length; i += 1) {
    const prev = timeline[i - 1];
    const curr = timeline[i];
    if (!Number.isFinite(prev.total_usdt) || !Number.isFinite(curr.total_usdt)) continue;

    const deltaTotal = curr.total_usdt - prev.total_usdt;
    const retPct = pct(deltaTotal, prev.total_usdt);
    const deltaRealized = Number.isFinite(prev.realized_usdt) && Number.isFinite(curr.realized_usdt)
      ? curr.realized_usdt - prev.realized_usdt
      : null;
    const deltaCost = Number.isFinite(prev.cost_usdt) && Number.isFinite(curr.cost_usdt)
      ? curr.cost_usdt - prev.cost_usdt
      : null;
    const costIncrease = Number.isFinite(deltaCost) && deltaCost < 0 ? Math.abs(deltaCost) : 0;

    intervals.push({
      start_ts: prev.ts,
      end_ts: curr.ts,
      delta_total_usdt: round(deltaTotal, 6),
      return_pct: round(retPct, 4),
      delta_realized_usdt: round(deltaRealized, 6),
      cost_increase_usdt: round(costIncrease, 6),
    });

    if (Number.isFinite(retPct)) returns.push(retPct);

    if (deltaTotal > 0) {
      positiveIntervals += 1;
      grossProfit += deltaTotal;
      winSum += deltaTotal;
    } else if (deltaTotal < 0) {
      negativeIntervals += 1;
      grossLossAbs += Math.abs(deltaTotal);
      lossAbsSum += Math.abs(deltaTotal);
    } else {
      flatIntervals += 1;
    }

    const bucket = timeBucket(curr.ts);
    if (!bucketMap[bucket]) {
      bucketMap[bucket] = { bucket, intervals: 0, delta_total_usdt: 0, cost_increase_usdt: 0 };
    }
    bucketMap[bucket].intervals += 1;
    bucketMap[bucket].delta_total_usdt += deltaTotal;
    bucketMap[bucket].cost_increase_usdt += costIncrease;

    const stateKey = Math.abs(toNum(retPct, 0)) >= 0.5 ? "high_volatility" : "low_volatility";
    stateMap[stateKey].intervals += 1;
    stateMap[stateKey].delta_total_usdt += deltaTotal;
    stateMap[stateKey].cost_increase_usdt += costIncrease;
  }

  const startTotal = toNum(timeline[0].total_usdt, null);
  const endTotal = toNum(timeline[timeline.length - 1].total_usdt, null);
  const totalReturnPct = pct(endTotal - startTotal, startTotal);

  const drawdown = computeDrawdown(timeline);
  const volatility = stddev(returns);
  const winRatePct = pct(positiveIntervals, positiveIntervals + negativeIntervals);
  const avgWin = positiveIntervals > 0 ? (winSum / positiveIntervals) : null;
  const avgLossAbs = negativeIntervals > 0 ? (lossAbsSum / negativeIntervals) : null;
  const riskReward = Number.isFinite(avgWin) && Number.isFinite(avgLossAbs) && avgLossAbs > 0
    ? (avgWin / avgLossAbs)
    : null;
  const profitFactor = grossLossAbs > 0 ? (grossProfit / grossLossAbs) : null;

  const equity = toNum(snapshot.total_equity, null);
  const realizedPnl = toNum(snapshot.realized_pnl, null);
  const commission = toNum(snapshot.commission, null);
  const funding = toNum(snapshot.funding, null);
  const costTotal = Number.isFinite(commission) && Number.isFinite(funding) ? (commission + funding) : null;
  const costTotalAbs = Number.isFinite(costTotal) ? Math.abs(costTotal) : null;
  const commissionAbs = Number.isFinite(commission) ? Math.abs(commission) : null;
  const fundingAbs = Number.isFinite(funding) ? Math.abs(funding) : null;

  const monthlyTargetPct = toNum(process.env.MONTHLY_TARGET_PCT, 5);
  const requiredDailyPct = monthlyTargetPct / 30;
  const netPnlUsdt = Number.isFinite(realizedPnl) && Number.isFinite(costTotal) ? realizedPnl + costTotal : null;
  const netPnlPct = pct(netPnlUsdt, equity);
  const gapPct = Number.isFinite(netPnlPct) ? netPnlPct - requiredDailyPct : null;
  const reportErrorCount = parseErrorCount(reportText);

  const topCostWindows = intervals
    .filter((it) => Number.isFinite(it.cost_increase_usdt) && it.cost_increase_usdt > 0)
    .sort((a, b) => b.cost_increase_usdt - a.cost_increase_usdt)
    .slice(0, 3);

  const byTimeBucket = Object.values(bucketMap)
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))
    .map((item) => ({
      bucket: item.bucket,
      intervals: item.intervals,
      delta_total_usdt: round(item.delta_total_usdt, 6),
      cost_increase_usdt: round(item.cost_increase_usdt, 6),
    }));

  const byMarketState = [
    {
      market_state: "고변동(구간 수익률 절대값 >= 0.5%)",
      intervals: stateMap.high_volatility.intervals,
      delta_total_usdt: round(stateMap.high_volatility.delta_total_usdt, 6),
      cost_increase_usdt: round(stateMap.high_volatility.cost_increase_usdt, 6),
    },
    {
      market_state: "저변동(구간 수익률 절대값 < 0.5%)",
      intervals: stateMap.low_volatility.intervals,
      delta_total_usdt: round(stateMap.low_volatility.delta_total_usdt, 6),
      cost_increase_usdt: round(stateMap.low_volatility.cost_increase_usdt, 6),
    },
  ];

  const riskFlags = [];
  const costRatioPct = pct(costTotalAbs, equity);
  const commissionRatioPct = pct(commissionAbs, equity);
  const fundingRatioPct = pct(fundingAbs, equity);
  if (Number.isFinite(costRatioPct) && costRatioPct > 0.2) {
    riskFlags.push("비용 비율 상한(0.20%) 초과");
  }
  if (Number.isFinite(drawdown.mdd_pct) && drawdown.mdd_pct <= -1.5) {
    riskFlags.push("시계열 기준 MDD -1.5% 이하");
  }
  if (Number.isFinite(winRatePct) && winRatePct < 45) {
    riskFlags.push("구간 승률 45% 미만");
  }
  if (Number.isFinite(profitFactor) && profitFactor < 1) {
    riskFlags.push("구간 Profit Factor 1 미만");
  }
  if (Number.isFinite(reportErrorCount) && reportErrorCount >= 1) {
    riskFlags.push("24시간 오류 1건 이상");
  }

  const output = {
    generated_at_iso: nowIso,
    generated_at_kst: toKstString(nowIso, { fallbackToString: true }),
    date_key: dateKey,
    decision: "보류",
    assumptions: [
      "승률/손익비는 체결 1건 단위가 아니라 시계열 구간(메시지 간격) 기준 proxy 입니다.",
      "비용 상위 시간대는 텔레그램 누적 비용 변화(정수 반올림 포함) 기준입니다.",
      "MDD는 당일 시계열 관측점 기준이며 틱 단위 최저점은 반영되지 않았습니다.",
    ],
    source_files: {
      snapshot: path.relative(repoRoot, snapshotPath),
      report: path.relative(repoRoot, reportPath),
      telegram_log: path.relative(repoRoot, telegramLogPath),
    },
    sample_counts: {
      telegram_rows: rows.length,
      timeline_points: timeline.length,
      intervals: intervals.length,
    },
    performance: {
      equity_start_usdt: round(startTotal, 6),
      equity_end_usdt: round(endTotal, 6),
      total_return_pct: round(totalReturnPct, 4),
      net_pnl_usdt: round(netPnlUsdt, 6),
      net_pnl_pct: round(netPnlPct, 4),
      required_daily_pct: round(requiredDailyPct, 4),
      gap_vs_target_pctp: round(gapPct, 4),
      mdd_pct: drawdown.mdd_pct,
      mdd_window: {
        peak_ts: drawdown.peak_ts,
        trough_ts: drawdown.trough_ts,
      },
      interval_volatility_pct: round(volatility, 4),
      interval_win_rate_pct: round(winRatePct, 4),
      interval_profit_factor: round(profitFactor, 4),
      interval_risk_reward: round(riskReward, 4),
      positive_intervals: positiveIntervals,
      negative_intervals: negativeIntervals,
      flat_intervals: flatIntervals,
    },
    costs: {
      realized_pnl_usdt: round(realizedPnl, 6),
      commission_usdt: round(commission, 6),
      funding_usdt: round(funding, 6),
      total_cost_usdt: round(costTotal, 6),
      cost_ratio_pct: round(costRatioPct, 4),
      commission_ratio_pct: round(commissionRatioPct, 4),
      funding_ratio_pct: round(fundingRatioPct, 4),
      commission_share_of_cost_pct: round(pct(commissionAbs, costTotalAbs), 4),
      funding_share_of_cost_pct: round(pct(fundingAbs, costTotalAbs), 4),
      cost_to_realized_ratio: round(
        Number.isFinite(costTotalAbs) && Number.isFinite(realizedPnl) && Math.abs(realizedPnl) > 0
          ? (costTotalAbs / Math.abs(realizedPnl))
          : null,
        4
      ),
      top_cost_windows: topCostWindows,
    },
    decomposition: {
      by_time_bucket: byTimeBucket,
      by_market_state: byMarketState,
    },
    risk_flags: riskFlags,
    latest_error_count_24h: Number.isFinite(reportErrorCount) ? reportErrorCount : null,
    intervals,
  };

  const outputPath = path.join(repoRoot, "ops", "daily", `${dateKey}_performance_metrics_jihye.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    output_path: outputPath,
    decision: output.decision,
    cost_ratio_pct: output.costs.cost_ratio_pct,
    mdd_pct: output.performance.mdd_pct,
    win_rate_pct: output.performance.interval_win_rate_pct,
    profit_factor: output.performance.interval_profit_factor,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("daily-performance-analysis failed:", err && err.message ? err.message : err);
  process.exit(1);
}
