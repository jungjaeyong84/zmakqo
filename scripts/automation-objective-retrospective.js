#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  docCreatedMs,
  ensureDir,
  kstStartOfTodayUtcMs,
  loadLocalEnv,
  nowKstMeta,
  readJsonSafe,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  DEFAULT_MIN_MONTHLY_NET_KRW,
  DEFAULT_MIN_WIN_RATE,
  buildPeriodObjectiveVerdict,
  periodTargetKrw,
} = require("./lib/objective-policy");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const { summarizePineSignalQuality } = require("../src/services/pineSignalQuality");
const { buildTradesFromFillsWithFunding } = require("../src/services/tradesFromFills");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");
const { isEntryTierEvent } = require("../src/utils/liveEntryTaxonomy");
const { tierMapToRows, wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const { displayStage1IntegrityReason } = require("../src/utils/stage1IntegrityReason");

loadLocalEnv();
ensureDir(OPS_DAILY_DIR);

const PROVIDER = String(process.env.OBJECTIVE_RETRO_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.OBJECTIVE_RETRO_TF || "15m").trim();
const MONTH_DAYS = Math.max(28, Number(process.env.OBJECTIVE_MONTH_DAYS || 30));
const TARGET_MONTHLY_KRW = Math.max(100_000, Number(process.env.OBJECTIVE_MIN_MONTHLY_NET_KRW || DEFAULT_MIN_MONTHLY_NET_KRW));
const TARGET_DAILY_KRW = Number(periodTargetKrw("DAILY", { minMonthlyNetKrw: TARGET_MONTHLY_KRW, monthDays: MONTH_DAYS }));
const TARGET_WEEKLY_KRW = Number(periodTargetKrw("WEEKLY", { minMonthlyNetKrw: TARGET_MONTHLY_KRW, monthDays: MONTH_DAYS }));
const SCAN_LIMIT = Math.max(4000, Number(process.env.OBJECTIVE_RETRO_SCAN_LIMIT || 16000));
const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "objective_retrospective_latest.md");
const RETROSPECTIVE_DOC_PATH = path.join("/Users/jeongjaeyong/Projects/donbeolja/docs", "OBJECTIVE_RETROSPECTIVE_POLICY.md");

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function signedKrw(v, digits = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits })} KRW`;
}

function resolveBarMs(row) {
  return (
    toNum(row && row.signal_bar_close_time_utc_ms) ??
    toNum(row && row.bar_close_time_utc_ms) ??
    toNum(row && row.exec_bar_close_time_utc_ms) ??
    docCreatedMs(row)
  );
}

function classifyDropStage(reason) {
  const raw = String(reason || "").trim().toUpperCase();
  if (raw.startsWith("DROP_WAIT_ONE_BAR")) return "TIMING";
  if (raw.startsWith("DROP_EV_GATE")) return "EV";
  if (raw.startsWith("DROP_AI_BIAS")) return "MARKET";
  if (raw.startsWith("DROP_AI_") || raw === "AI_BLOCK") return "AI";
  if (
    raw.startsWith("DROP_LONG_GATE_")
    || raw.startsWith("DROP_SHORT_GATE_")
    || raw.startsWith("DROP_ENTRY_QUALITY_")
    || raw === "DROP_LOW_SCORE"
  ) return "QUALITY";
  return "OPS";
}

function stageLabel(stage) {
  const key = String(stage || "OPS").toUpperCase();
  if (key === "QUALITY") return "1차 상태/무결성";
  if (key === "AI") return "2차 진입 품질";
  if (key === "MARKET") return "3차 상태 기반 Soft Sizing";
  if (key === "EV") return "4차 EV/시간가치층";
  if (key === "TIMING") return "5차 WAIT 타이밍층";
  return "0차 운영/보호";
}

function aggregateOverallFromQuality(summary = {}) {
  const chainRows = Array.isArray(summary.chain_rows) ? summary.chain_rows : [];
  const byTier = summary.by_tier && typeof summary.by_tier === "object" ? summary.by_tier : {};
  const executedN = chainRows.length;
  const realized = chainRows.filter((row) => row && row.realized === true && Number.isFinite(toNum(row.realized_ret_net)));
  const realizedN = realized.length;
  const winN = realized.filter((row) => Number(row.realized_ret_net) > 0).length;
  const netPnlQuote = realized.reduce((acc, row) => acc + (Number(row.realized_pnl_quote) || 0), 0);
  const avgRetNet = realizedN > 0
    ? realized.reduce((acc, row) => acc + Number(row.realized_ret_net || 0), 0) / realizedN
    : null;
  const signalsN = Object.values(byTier).reduce((acc, row) => acc + Number(row && row.signals_n || 0), 0);
  const executedByTier = Object.values(byTier).reduce((acc, row) => acc + Number(row && row.executed_n || 0), 0);
  return {
    signals_n: signalsN,
    executed_n: executedByTier || executedN,
    execution_rate: signalsN > 0 ? ((executedByTier || executedN) / signalsN) : null,
    realized_n: realizedN,
    win_n: winN,
    win_rate: realizedN > 0 ? (winN / realizedN) : null,
    avg_ret_net: avgRetNet,
    net_pnl_quote: realizedN > 0 ? netPnlQuote : 0,
  };
}

function summarizeRealizedTrades(trades = [], { fromMs, toMs } = {}) {
  const rows = (Array.isArray(trades) ? trades : []).filter((row) => {
    const closeMs = Number(row && row.close_ms);
    return Number.isFinite(closeMs) && closeMs >= fromMs && closeMs < toMs;
  });
  const realizedN = rows.length;
  const winN = rows.filter((row) => Number(row && row.pnl_krw) > 0).length;
  const netPnl = rows.reduce((acc, row) => acc + (Number(row && row.pnl_krw) || 0), 0);
  const avgRet = realizedN > 0
    ? rows.reduce((acc, row) => acc + (Number(row && row.pnl_pct) || 0), 0) / realizedN
    : null;
  return {
    realized_n: realizedN,
    win_n: winN,
    win_rate: realizedN > 0 ? (winN / realizedN) : null,
    avg_ret_net: avgRet,
    net_pnl_quote: netPnl,
    trades: rows,
  };
}

function filterSignals(rows = [], { fromMs, toMs, provider, tf } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!isLiveDocForExchange(provider, row)) return false;
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    if (provider && ex && ex !== provider) return false;
    const rowTf = String(row && row.tf || "").trim();
    if (tf && rowTf && rowTf !== tf) return false;
    if (!isEntryTierEvent(row && row.event)) return false;
    const ms = resolveBarMs(row);
    return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
  });
}

function filterDrops(rows = [], { fromMs, toMs, provider, tf } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!isLiveDocForExchange(provider, row)) return false;
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    if (provider && ex && ex !== provider) return false;
    const rowTf = String(row && row.tf || "").trim();
    if (tf && rowTf && rowTf !== tf) return false;
    const ms = docCreatedMs(row) ?? resolveBarMs(row);
    return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
  });
}

function summarizeDrops(rows = []) {
  const counts = { OPS: 0, QUALITY: 0, AI: 0, MARKET: 0, EV: 0, TIMING: 0 };
  const reasons = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const reason = String(row && row.reason || "").trim().toUpperCase() || "UNKNOWN";
    const stage = classifyDropStage(reason);
    counts[stage] = (counts[stage] || 0) + 1;
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  return {
    total: (Array.isArray(rows) ? rows.length : 0),
    counts,
    top_reasons: Array.from(reasons.entries())
      .map(([reason, n]) => ({ reason, n, stage: classifyDropStage(reason) }))
      .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason))
      .slice(0, 5),
  };
}

function resolveWorstTier(byTier = {}) {
  const rows = Object.entries(byTier || {}).map(([tier, stats]) => ({ tier, ...stats }));
  rows.sort((a, b) => {
    const aRet = Number.isFinite(Number(a.avg_ret_net)) ? Number(a.avg_ret_net) : 999;
    const bRet = Number.isFinite(Number(b.avg_ret_net)) ? Number(b.avg_ret_net) : 999;
    if (aRet !== bRet) return aRet - bRet;
    return Number(b.executed_n || 0) - Number(a.executed_n || 0);
  });
  return rows[0] || null;
}

function inferTradeSymbol(row = {}) {
  const direct = [
    row.symbol,
    row.market,
    row.asset,
    row.ticker,
  ].map((v) => String(v || "").trim().toUpperCase()).find(Boolean);
  if (direct) return direct;
  const sourceTradeId = String(row && row.source_trade_id || "").trim();
  const fillId = String(row && row.fill_id || "").trim();
  const joined = `${sourceTradeId} ${fillId}`;
  const match = joined.match(/(?:^|__|\s)([A-Z0-9]+USDT)(?:__|\s|$)/);
  return match ? match[1] : "UNKNOWN";
}

function summarizeTradesByMarket(trades = []) {
  const byMarket = new Map();
  for (const row of Array.isArray(trades) ? trades : []) {
    const symbol = inferTradeSymbol(row);
    const current = byMarket.get(symbol) || { symbol, trade_n: 0, win_n: 0, net_pnl_krw: 0, avg_ret_net_sum: 0, avg_ret_net_n: 0 };
    current.trade_n += 1;
    const pnl = Number(row && row.pnl_krw);
    if (Number.isFinite(pnl)) current.net_pnl_krw += pnl;
    if (pnl > 0) current.win_n += 1;
    const ret = Number(row && row.pnl_pct);
    if (Number.isFinite(ret)) {
      current.avg_ret_net_sum += ret;
      current.avg_ret_net_n += 1;
    }
    byMarket.set(symbol, current);
  }
  return Array.from(byMarket.values())
    .map((row) => ({
      symbol: row.symbol,
      trade_n: row.trade_n,
      win_n: row.win_n,
      win_rate: row.trade_n > 0 ? (row.win_n / row.trade_n) : null,
      net_pnl_krw: row.net_pnl_krw,
      avg_ret_net: row.avg_ret_net_n > 0 ? (row.avg_ret_net_sum / row.avg_ret_net_n) : null,
    }))
    .sort((a, b) => Number(b.net_pnl_krw || 0) - Number(a.net_pnl_krw || 0) || a.symbol.localeCompare(b.symbol));
}

function buildDailyTradeEvaluation({ daily, weekly, monthly } = {}) {
  const trades = Array.isArray(daily && daily.realized_trades && daily.realized_trades.trades)
    ? daily.realized_trades.trades
    : [];
  const byMarket = summarizeTradesByMarket(trades);
  const bestMarket = byMarket[0] || null;
  const worstMarket = byMarket.length ? byMarket.slice().sort((a, b) => Number(a.net_pnl_krw || 0) - Number(b.net_pnl_krw || 0) || a.symbol.localeCompare(b.symbol))[0] : null;
  const activeMarkets = byMarket.filter((row) => Number(row.trade_n || 0) > 0).map((row) => row.symbol);
  const topDrop = Array.isArray(daily && daily.drops && daily.drops.top_reasons) ? daily.drops.top_reasons[0] || null : null;
  const lines = [
    `오늘 실현 거래는 ${daily && daily.realized_trades && daily.realized_trades.trade_n || 0}건이고 순손익은 ${signedKrw(daily && daily.realized_trades && daily.realized_trades.net_pnl_quote, 0)} 입니다.`,
    `오늘 서버 신호 ${daily && daily.entry_cohort && daily.entry_cohort.signals_n || 0}건 중 실제 진입은 ${daily && daily.entry_cohort && daily.entry_cohort.executed_n || 0}건이었고, 실행률은 ${pct(daily && daily.entry_cohort && daily.entry_cohort.execution_rate)} 입니다.`,
    activeMarkets.length ? `오늘 실제 거래한 시장은 ${activeMarkets.length}개(${activeMarkets.join(", ")}) 입니다.` : "오늘 실제 거래된 시장은 없습니다.",
  ];
  if (bestMarket) {
    lines.push(`수익 기여 1위는 ${bestMarket.symbol} (${signedKrw(bestMarket.net_pnl_krw, 0)}, 승률 ${pct(bestMarket.win_rate)}) 입니다.`);
  }
  if (worstMarket) {
    lines.push(`손실 기여 1위는 ${worstMarket.symbol} (${signedKrw(worstMarket.net_pnl_krw, 0)}, 승률 ${pct(worstMarket.win_rate)}) 입니다.`);
  }
  if (topDrop) {
    lines.push(`오늘 가장 많이 버린 신호는 ${topDrop.reason} ${topDrop.n}건이며 계층은 ${stageLabel(topDrop.stage)} 입니다.`);
  }
  lines.push(`주간 손익은 ${signedKrw(weekly && weekly.realized_trades && weekly.realized_trades.net_pnl_quote, 0)}, 월간 손익은 ${signedKrw(monthly && monthly.realized_trades && monthly.realized_trades.net_pnl_quote, 0)} 입니다.`);
  return {
    best_market: bestMarket,
    worst_market: worstMarket,
    active_markets: activeMarkets,
    by_market: byMarket.slice(0, 5),
    lines,
  };
}

function describeTierForUser(tier) {
  const key = String(tier || "").trim().toUpperCase();
  if (key === "EARLY") return "LONG/SHORT 기본 진입";
  if (key === "CORE") return "내부 진단 중간 밴드";
  if (key === "PRE_REAL") return "내부 진단 강화 밴드";
  if (key === "REAL") return "내부 진단 최종 밴드";
  return key || "알 수 없는 밴드";
}

function buildReflection({ periodLabel, objective, entryOverall, realizedOverall, dropSummary, quality } = {}) {
  const lines = [];
  const failed = Array.isArray(objective && objective.failed_checks) ? objective.failed_checks : [];
  const topStage = Object.entries(dropSummary && dropSummary.counts || {})
    .map(([stage, n]) => ({ stage, n: Number(n || 0) }))
    .sort((a, b) => b.n - a.n || a.stage.localeCompare(b.stage))[0] || null;
  const topReason = Array.isArray(dropSummary && dropSummary.top_reasons)
    ? dropSummary.top_reasons.find((row) => String(row && row.stage || "").toUpperCase() === String(topStage && topStage.stage || "").toUpperCase()) || null
    : null;
  const worstTier = resolveWorstTier(quality && quality.by_tier);

  if (failed.includes("NO_TRADE_ACTIVITY")) {
    lines.push(`${periodLabel}에는 신규 진입이 ${entryOverall && entryOverall.executed_n || 0}건이었습니다. 0원은 안전이 아니라 기회 손실이므로 실패로 간주합니다.`);
  }
  if (failed.includes("ZERO_KRW_IDLE")) {
    lines.push(`${periodLabel} 실현 순수익이 0 KRW였습니다. 무거래 또는 실현 지연 상태로 목표 관점에서는 미달입니다.`);
  }
  if (failed.includes("PERIOD_TARGET_NOT_MET")) {
    lines.push(`${periodLabel} 순수익 ${signedKrw(realizedOverall && realizedOverall.net_pnl_quote, 0)}가 기간 목표 ${signedKrw(objective && objective.period_target_krw, 0)}를 넘지 못했습니다.`);
  }
  if (failed.includes("WIN_RATE_BELOW_TARGET")) {
    lines.push(`${periodLabel} 승률 ${pct(realizedOverall && realizedOverall.win_rate)}가 목표 60%를 밑돌았습니다.`);
  }
  if (failed.includes("EXPECTANCY_NOT_POSITIVE")) {
    lines.push(`${periodLabel} 평균 기대수익 ${signedPct(realizedOverall && realizedOverall.avg_ret_net)}가 양수가 아닙니다.`);
  }
  if (Number(entryOverall && entryOverall.executed_n || 0) > 0 && Number(realizedOverall && realizedOverall.realized_n || 0) === 0) {
    lines.push(`${periodLabel}에는 진입은 있었지만 실현된 거래가 0건입니다. 청산/보유 구조 때문에 평가가 뒤로 밀리고 있습니다.`);
  }
  if (topStage && topStage.n > 0) {
    const reasonText = topReason
      ? (String(topStage.stage || "").toUpperCase() === "QUALITY"
        ? displayStage1IntegrityReason(topReason.reason)
        : topReason.reason)
      : "";
    lines.push(`${periodLabel} 차단의 중심은 ${stageLabel(topStage.stage)} ${topStage.n}건이었습니다${reasonText ? ` (주요 사유 ${reasonText})` : ""}.`);
  }
  if (worstTier && Number(worstTier.executed_n || 0) > 0) {
    lines.push(`${periodLabel} Pine follow-through가 가장 약한 구간은 ${describeTierForUser(worstTier.tier)}이며 avg_ret_net=${signedPct(worstTier.avg_ret_net)} 입니다.`);
  }
  if (topStage && topStage.stage === "QUALITY") lines.push("다음 수정에서는 Pine full-quality bundle과 1차 상태/무결성 fallback 경계가 과차단인지 먼저 검토해야 합니다.");
  if (topStage && topStage.stage === "AI") lines.push("다음 수정에서는 2차 진입 품질의 AI usable coverage와 missing/block 정책부터 점검해야 합니다.");
  if (topStage && topStage.stage === "MARKET") lines.push("다음 수정에서는 3차 상태 기반 Soft Sizing의 bias neutral/opposite sizing이 과한지 확인해야 합니다.");
  if (topStage && topStage.stage === "EV") lines.push("다음 수정에서는 4차 EV/시간가치층 threshold/band가 목표 대비 과도하게 경직됐는지 확인해야 합니다.");
  if (topStage && topStage.stage === "TIMING") lines.push("다음 수정에서는 5차 WAIT 타이밍층 defer가 과민한지 확인해야 합니다.");
  return lines;
}

function buildSelfCritique({ failedPeriods = [], daily, weekly, monthly } = {}) {
  const lines = [];
  const failedSet = new Set(Array.isArray(failedPeriods) ? failedPeriods : []);
  const topDrop = Array.isArray(daily && daily.drops && daily.drops.top_reasons) ? daily.drops.top_reasons[0] || null : null;
  const bestMarket = daily && daily.daily_trade_evaluation ? daily.daily_trade_evaluation.best_market : null;
  const worstMarket = daily && daily.daily_trade_evaluation ? daily.daily_trade_evaluation.worst_market : null;

  if (!failedSet.size) {
    return ["오늘 목표는 충족했습니다. 다만 서버 신호 학습 단계인 만큼 내일도 시장별 편차를 계속 점검해야 합니다."];
  }

  if (failedSet.has("DAILY")) {
    lines.push(`오늘 나는 일간 목표 ${signedKrw(daily && daily.objective && daily.objective.period_target_krw, 0)}를 달성하지 못했고 결과는 ${signedKrw(daily && daily.realized_trades && daily.realized_trades.net_pnl_quote, 0)}에 그쳤다.`);
  }
  if (failedSet.has("WEEKLY")) {
    lines.push(`주간 누적도 ${signedKrw(weekly && weekly.realized_trades && weekly.realized_trades.net_pnl_quote, 0)}로 회복 기준을 넘지 못했다.`);
  }
  if (failedSet.has("MONTHLY")) {
    lines.push(`월간 런레이트 역시 목표 ${signedKrw(monthly && monthly.objective && monthly.objective.period_target_krw, 0)} 대비 부족하다.`);
  }
  if (worstMarket) {
    lines.push(`오늘 손실 기여 1위는 ${worstMarket.symbol}였고, 나는 이 시장의 서버 정책이 아직 목표 달성 속도에 맞게 정렬되지 않았다는 점을 인정해야 한다.`);
  }
  if (topDrop) {
    lines.push(`오늘 가장 많이 막은 계층은 ${stageLabel(topDrop.stage)}였고, ${topDrop.reason} ${topDrop.n}건은 과보수인지 재검증이 필요하다.`);
  }
  if (bestMarket) {
    lines.push(`반대로 ${bestMarket.symbol}는 오늘 가장 좋은 기여를 냈는데, 승자 시장을 충분히 증폭하지 못했다.`);
  }
  lines.push("나는 파인이 아니라 서버 신호를 기준으로 판단해야 하며, 목표 미달 원인을 시장별 정책과 실행 품질에서 다시 찾겠다.");
  return lines;
}

function buildTomorrowStrategy({ failedPeriods = [], daily, weekly, monthly, quality } = {}) {
  const lines = [];
  const failed = Array.isArray(failedPeriods) && failedPeriods.length > 0;
  const topDrop = Array.isArray(daily && daily.drops && daily.drops.top_reasons) ? daily.drops.top_reasons[0] || null : null;
  const bestMarket = daily && daily.daily_trade_evaluation ? daily.daily_trade_evaluation.best_market : null;
  const worstMarket = daily && daily.daily_trade_evaluation ? daily.daily_trade_evaluation.worst_market : null;
  const worstTier = resolveWorstTier(quality && quality.by_tier);

  if (!failed) {
    return [
      "내일 전략은 서버 신호 기준 production 시장을 유지하고, exploration 시장은 소규모로만 검증한다.",
      "목표 달성 상태라도 execution quality와 reverse 리뷰 시장은 계속 감시한다.",
    ];
  }

  lines.push("내일도 전체 시장을 계속 학습하되, 판단과 수정은 전부 서버 신호 기준으로 진행한다.");
  if (topDrop && topDrop.stage === "EV") lines.push("1순위는 4차 EV/시간가치층 재조정이다. 과차단을 줄이되 본선 적용은 production 우선 시장부터 반영한다.");
  if (topDrop && topDrop.stage === "TIMING") lines.push("1순위는 5차 WAIT 타이밍층 민감도 점검이다. defer가 과민하면 진입 누락을 바로 줄인다.");
  if (topDrop && topDrop.stage === "QUALITY") lines.push("1순위는 1차 상태/무결성 경계 재검토다. integrity 과차단이면 서버 신호 학습이 왜곡된다.");
  if (bestMarket) lines.push(`승자 시장 ${bestMarket.symbol}는 production 우선순위를 유지하고 서버 정책 증폭 후보로 둔다.`);
  if (worstMarket) lines.push(`부진 시장 ${worstMarket.symbol}는 배제하지 않고 watch 상태로 두되, 실행 품질과 reverse 경로를 분리해서 본다.`);
  if (worstTier) lines.push(`가장 약한 tier는 ${describeTierForUser(worstTier.tier)} 이므로 내일 전략은 이 구간의 서버 신호 품질을 우선 보정한다.`);
  lines.push(`단기 목표는 일간 ${signedKrw(daily && daily.objective && daily.objective.period_target_krw, 0)}, 중간 목표는 주간 ${signedKrw(weekly && weekly.objective && weekly.objective.period_target_krw, 0)}, 최종 목표는 월간 ${signedKrw(monthly && monthly.objective && monthly.objective.period_target_krw, 0)} 회복이다.`);
  return lines;
}

function periodRanges(nowMs) {
  const todayStart = kstStartOfTodayUtcMs(nowMs);
  return {
    DAILY: { fromMs: todayStart, toMs: nowMs, observedDays: 1, targetKrw: TARGET_DAILY_KRW },
    WEEKLY: { fromMs: todayStart - (6 * DAY_MS), toMs: nowMs, observedDays: 7, targetKrw: TARGET_WEEKLY_KRW },
    MONTHLY: { fromMs: todayStart - (29 * DAY_MS), toMs: nowMs, observedDays: 30, targetKrw: TARGET_MONTHLY_KRW },
  };
}

async function buildPeriodReport(period, range, context = {}) {
  const filteredSignals = filterSignals(context.signals, { ...range, provider: PROVIDER, tf: TF });
  const filteredDrops = filterDrops(context.drops, { ...range, provider: PROVIDER, tf: TF });
  const quality = await summarizePineSignalQuality({
    signals: filteredSignals,
    fills: context.fills,
    exchange: PROVIDER,
    tf: TF,
    fromMs: range.fromMs,
    toMs: range.toMs,
  });
  const entryOverall = aggregateOverallFromQuality(quality);
  const realizedOverall = summarizeRealizedTrades(context.trades, { fromMs: range.fromMs, toMs: range.toMs });
  const objective = buildPeriodObjectiveVerdict(period, {
    executed_n: entryOverall.executed_n,
    realized_n: realizedOverall.realized_n,
    win_rate: realizedOverall.win_rate,
    avg_ret_net: realizedOverall.avg_ret_net,
    net_pnl_quote: realizedOverall.net_pnl_quote,
  }, {
    observedDays: range.observedDays,
    minWinRate: DEFAULT_MIN_WIN_RATE,
    minMonthlyNetKrw: TARGET_MONTHLY_KRW,
    targetNetKrw: range.targetKrw,
    tradeCount: entryOverall.executed_n,
    realizedMinSample: period === "DAILY" ? 1 : (period === "WEEKLY" ? 3 : 8),
  });
  const dropSummary = summarizeDrops(filteredDrops);
  const reflection = objective.pass === true ? [] : buildReflection({
    periodLabel: period === "DAILY" ? "당일" : (period === "WEEKLY" ? "주간" : "월간"),
    objective,
    entryOverall,
    realizedOverall,
    dropSummary,
    quality,
  });
  return {
    period,
    range: {
      from_ms: range.fromMs,
      to_ms: range.toMs,
      from_utc: new Date(range.fromMs).toISOString(),
      to_utc: new Date(range.toMs).toISOString(),
      observed_days: range.observedDays,
    },
    objective,
    entry_cohort: entryOverall,
    realized_trades: {
      ...realizedOverall,
      trade_n: realizedOverall.realized_n,
    },
    drops: dropSummary,
    quality_by_tier: quality.by_tier,
    reflection,
  };
}

function renderPeriodMarkdown(row = {}) {
  const title = row.period === "DAILY" ? "일간" : (row.period === "WEEKLY" ? "주간" : "월간");
  const lines = [
    `## ${title}`,
    `- verdict: ${row.objective && row.objective.verdict || "N/A"}`,
    `- failed_checks: ${Array.isArray(row.objective && row.objective.failed_checks) && row.objective.failed_checks.length ? row.objective.failed_checks.join(", ") : "none"}`,
    `- target_krw: ${signedKrw(row.objective && row.objective.period_target_krw, 0)}`,
    `- realized: trades=${row.realized_trades && row.realized_trades.trade_n != null ? row.realized_trades.trade_n : "N/A"} / win=${pct(row.realized_trades && row.realized_trades.win_rate)} / avg_ret_net=${signedPct(row.realized_trades && row.realized_trades.avg_ret_net)} / net=${signedKrw(row.realized_trades && row.realized_trades.net_pnl_quote, 0)}`,
    `- activity: signals=${row.entry_cohort && row.entry_cohort.signals_n != null ? row.entry_cohort.signals_n : "N/A"} / executed=${row.entry_cohort && row.entry_cohort.executed_n != null ? row.entry_cohort.executed_n : "N/A"} / execution_rate=${pct(row.entry_cohort && row.entry_cohort.execution_rate)}`,
    `- monthly_run_rate_krw: ${signedKrw(row.objective && row.objective.monthly_run_rate_krw, 0)}`,
    `- drops: total=${row.drops && row.drops.total != null ? row.drops.total : 0} / ops=${row.drops && row.drops.counts ? row.drops.counts.OPS : 0} / integrity=${row.drops && row.drops.counts ? row.drops.counts.QUALITY : 0} / ai=${row.drops && row.drops.counts ? row.drops.counts.AI : 0} / market=${row.drops && row.drops.counts ? row.drops.counts.MARKET : 0} / ev=${row.drops && row.drops.counts ? row.drops.counts.EV : 0} / timing=${row.drops && row.drops.counts ? row.drops.counts.TIMING : 0}`,
  ];
  if (Array.isArray(row.reflection) && row.reflection.length) {
    lines.push("", "### 반성문", ...row.reflection.map((line) => `- ${line}`));
  }
  return lines.join("\n");
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Objective Retrospective",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- provider/tf: ${report.provider || "N/A"} / ${report.tf || "N/A"}`,
    `- 목표: 승률 ${(Number(report.objective && report.objective.min_win_rate || DEFAULT_MIN_WIN_RATE) * 100).toFixed(0)}%+, 기대값+, 순수익+, 월간 ${Number(report.objective && report.objective.min_monthly_net_krw || TARGET_MONTHLY_KRW).toLocaleString("ko-KR")} KRW+`,
    `- 일간 목표: ${Number(report.objective && report.objective.daily_target_krw || TARGET_DAILY_KRW).toLocaleString("ko-KR")} KRW`,
    `- 주간 목표: ${Number(report.objective && report.objective.weekly_target_krw || TARGET_WEEKLY_KRW).toLocaleString("ko-KR")} KRW`,
    `- 월간 목표: ${Number(report.objective && report.objective.monthly_target_krw || TARGET_MONTHLY_KRW).toLocaleString("ko-KR")} KRW`,
    "",
    renderPeriodMarkdown(report.periods && report.periods.DAILY || {}),
    "",
    renderPeriodMarkdown(report.periods && report.periods.WEEKLY || {}),
    "",
    renderPeriodMarkdown(report.periods && report.periods.MONTHLY || {}),
    "",
    "## 당일 전체 거래 평가",
    ...((report.daily_trade_evaluation && report.daily_trade_evaluation.lines) || []).map((line) => `- ${line}`),
    "",
    "## OpenClaw 반성문",
    ...((report.self_critique && report.self_critique.lines) || []).map((line) => `- ${line}`),
    "",
    "## 내일 전략",
    ...((report.next_day_strategy && report.next_day_strategy.lines) || []).map((line) => `- ${line}`),
    "",
    "## References",
    `- governance: ${report.references && report.references.governance || "N/A"}`,
    `- objective_supervisor: ${report.references && report.references.objective_supervisor || "N/A"}`,
    `- stage_autopilot: ${report.references && report.references.stage_autopilot || "N/A"}`,
    `- policy_doc: ${report.references && report.references.policy_doc || "N/A"}`,
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const meta = nowKstMeta();
  const ranges = periodRanges(meta.nowMs);
  const [signalsRes, dropsRes, fillsRes] = await Promise.all([
    getCachedRecentByCreatedAt("signals", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 800, pageSize: 1000, refresh: true }),
  ]);

  const signals = signalsRes.rows;
  const drops = dropsRes.rows;
  const fills = fillsRes.rows.filter((row) => isLiveDocForExchange(PROVIDER, row));
  const { trades } = await buildTradesFromFillsWithFunding(fills, { exchange: PROVIDER });

  const daily = await buildPeriodReport("DAILY", ranges.DAILY, { signals, drops, fills, trades });
  const weekly = await buildPeriodReport("WEEKLY", ranges.WEEKLY, { signals, drops, fills, trades });
  const monthly = await buildPeriodReport("MONTHLY", ranges.MONTHLY, { signals, drops, fills, trades });

  const failedPeriods = [daily, weekly, monthly].filter((row) => row && row.objective && row.objective.pass !== true).map((row) => row.period);
  const dailyTradeEvaluation = buildDailyTradeEvaluation({ daily, weekly, monthly });
  daily.daily_trade_evaluation = dailyTradeEvaluation;
  const reflectionLines = [daily, weekly, monthly]
    .flatMap((row) => (Array.isArray(row.reflection) ? row.reflection.map((line) => `${row.period}: ${line}`) : []))
    .slice(0, 8);
  const selfCritiqueLines = buildSelfCritique({ failedPeriods, daily, weekly, monthly });
  const nextDayStrategyLines = buildTomorrowStrategy({ failedPeriods, daily, weekly, monthly, quality: daily });
  const report = {
    generated_at_kst: meta.kst,
    provider: PROVIDER,
    tf: TF,
    objective: {
      min_win_rate: DEFAULT_MIN_WIN_RATE,
      min_monthly_net_krw: TARGET_MONTHLY_KRW,
      daily_target_krw: TARGET_DAILY_KRW,
      weekly_target_krw: TARGET_WEEKLY_KRW,
      monthly_target_krw: TARGET_MONTHLY_KRW,
      zero_trade_is_failure: true,
      zero_krw_is_failure: true,
    },
    periods: {
      DAILY: daily,
      WEEKLY: weekly,
      MONTHLY: monthly,
    },
    reflection_summary: {
      failed_periods: failedPeriods,
      lines: reflectionLines,
    },
    daily_trade_evaluation: dailyTradeEvaluation,
    self_critique: {
      lines: selfCritiqueLines,
    },
    next_day_strategy: {
      lines: nextDayStrategyLines,
    },
    references: {
      governance: path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.md"),
      objective_supervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.md"),
      stage_autopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.md"),
      policy_doc: RETROSPECTIVE_DOC_PATH,
    },
  };
  for (const key of ["DAILY", "WEEKLY", "MONTHLY"]) {
    const period = report.periods && report.periods[key];
    if (period && period.quality_by_tier) {
      period.quality_by_tier_rows = tierMapToRows(period.quality_by_tier);
    }
  }

  const base = `${meta.dateKey}_${meta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_objective_retrospective.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_objective_retrospective.md`);
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const alert = await sendKoreanTelegramSummary({
    title: `[회고] ${failedPeriods.length ? failedPeriods.join("/") : "PASS"}`,
    severity: failedPeriods.length ? "WARN" : "INFO",
    dedupeKey: `objective_retrospective:${failedPeriods.join("_") || "PASS"}:${daily.entry_cohort.executed_n || 0}:${daily.realized_trades.trade_n || 0}`,
    dedupeWindowSec: 18 * 60 * 60,
    dedupeFingerprint: JSON.stringify({
      failedPeriods,
      dailyExecuted: daily.entry_cohort.executed_n || 0,
      dailyRealized: daily.realized_trades.trade_n || 0,
      dailyNet: daily.realized_trades.net_pnl_quote || 0,
      weeklyNet: weekly.realized_trades.net_pnl_quote || 0,
      monthlyNet: monthly.realized_trades.net_pnl_quote || 0,
    }),
    sections: [
      {
        header: "당일 전체 평가",
        lines: dailyTradeEvaluation.lines.slice(0, 5),
      },
      {
        header: "기간 상태",
        lines: [
          `당일 ${signedKrw(daily.realized_trades.net_pnl_quote, 0)} / 목표 ${signedKrw(daily.objective.period_target_krw, 0)}`,
          `주간 ${signedKrw(weekly.realized_trades.net_pnl_quote, 0)} / 목표 ${signedKrw(weekly.objective.period_target_krw, 0)}`,
          `월간 ${signedKrw(monthly.realized_trades.net_pnl_quote, 0)} / 목표 ${signedKrw(monthly.objective.period_target_krw, 0)}`,
        ],
      },
      {
        header: "반성문",
        lines: selfCritiqueLines,
      },
      {
        header: "내일 전략",
        lines: nextDayStrategyLines,
      },
    ],
  });
  if (!alert || (alert.ok !== true && alert.skipped !== true)) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
  }

  console.log(JSON.stringify({
    ok: true,
    provider: PROVIDER,
    failed_periods: failedPeriods,
    jsonPath,
    mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-objective-retrospective failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      classifyDropStage,
      aggregateOverallFromQuality,
      summarizeRealizedTrades,
      buildReflection,
      summarizeTradesByMarket,
      buildDailyTradeEvaluation,
      buildSelfCritique,
      buildTomorrowStrategy,
      periodRanges,
    },
  };
}
