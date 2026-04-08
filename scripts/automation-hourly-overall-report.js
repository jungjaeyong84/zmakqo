#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const {
  REPO_ROOT,
  OPS_DAILY_DIR,
  ensureDir,
  loadLocalEnv,
  nowKstMeta,
  writeJson,
  writeText,
  copyLatest,
  execJson,
  sendKoreanTelegramSummary,
  readJsonSafe,
  ensureExchangeApiKeys,
} = require("./lib/automation-utils");
const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { auditBinanceExitIntegrity } = require("../src/services/exitIntegrityAudit");

loadLocalEnv();
ensureDir(OPS_DAILY_DIR);

const FALLBACK_USD_KRW = Number(process.env.USD_KRW_FALLBACK || 1480);

function roundAmount(value) {
  const n = Number(value || 0);
  return Math.round(n);
}

function formatSignedRounded(value, unit = "") {
  const n = roundAmount(value);
  return `${n > 0 ? "+" : ""}${n}${unit}`;
}

function formatSignedPp(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%p`;
}

function formatSignedPercent(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isFiniteNullable(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function resolveSymbol(docId, data) {
  const explicit = String(data && data.symbol || "").trim();
  if (explicit) return explicit;
  const id = String(docId || "").trim();
  const parts = id.split("__");
  return parts.length >= 3 ? parts[2] : null;
}

function listOverallReportFiles() {
  try {
    return fs.readdirSync(OPS_DAILY_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}_\d{4}_overall_account_report\.json$/.test(name))
      .sort();
  } catch (_err) {
    return [];
  }
}

function hhmmToMinutes(hhmm) {
  const text = String(hhmm || "").trim();
  if (!/^\d{4}$/.test(text)) return null;
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(2, 4));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function dateKeyDayNumber(dateKey) {
  const parts = String(dateKey || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / (24 * 60 * 60 * 1000));
}

function resolveComparisonLabel({ kind, currentDateKey, currentHhmm, baselineRef } = {}) {
  if (!baselineRef) {
    if (kind === "today_start") return "오늘 첫 보고 대비";
    if (kind === "previous_day_latest") return "전일 마지막 보고 대비";
    return "직전 보고 대비";
  }
  if (kind === "today_start") return "오늘 첫 보고 대비";
  const currentDay = dateKeyDayNumber(currentDateKey);
  const baselineDay = dateKeyDayNumber(baselineRef.dateKey);
  const dayDiff = (Number.isFinite(currentDay) && Number.isFinite(baselineDay)) ? (currentDay - baselineDay) : null;
  if (kind === "previous_day_latest") {
    return dayDiff === 1 ? "전일 마지막 보고 대비" : "직전 보고일 마지막 보고 대비";
  }
  if (baselineRef.dateKey === currentDateKey) {
    const currentMinutes = hhmmToMinutes(currentHhmm);
    const baselineMinutes = hhmmToMinutes(baselineRef.hhmm);
    const minuteDiff = (Number.isFinite(currentMinutes) && Number.isFinite(baselineMinutes))
      ? (currentMinutes - baselineMinutes)
      : null;
    if (Number.isFinite(minuteDiff) && minuteDiff > 0 && minuteDiff <= 90) return "전시간 대비";
    return "직전 보고 대비";
  }
  if (dayDiff === 1) return "전일 마지막 보고 대비";
  return "직전 보고일 마지막 보고 대비";
}

function findPreviousOverallReports(currentDateKey, currentHhmm) {
  const names = listOverallReportFiles();
  const currentKey = `${currentDateKey}_${currentHhmm}`;
  const earlier = [];
  for (const name of names) {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{4})_overall_account_report\.json$/);
    if (!match) continue;
    const dateKey = match[1];
    const hhmm = match[2];
    const key = `${dateKey}_${hhmm}`;
    if (key >= currentKey) continue;
    earlier.push({ name, dateKey, hhmm, path: path.join(OPS_DAILY_DIR, name) });
  }
  const sameDay = earlier.filter((row) => row.dateKey === currentDateKey);
  const previousDays = earlier.filter((row) => row.dateKey !== currentDateKey);
  const previousHour = sameDay.length ? sameDay[sameDay.length - 1] : null;
  const todayStart = sameDay.length ? sameDay[0] : null;
  const previousDayLatest = previousDays.length ? previousDays[previousDays.length - 1] : null;
  return { previousHour, todayStart, previousDayLatest };
}

function buildComparison(currentReport, previousReport, label, baselineRef = null) {
  if (!previousReport || typeof previousReport !== "object") {
    return { available: false, label, path: baselineRef && baselineRef.path ? baselineRef.path : null, reason: "BASELINE_MISSING" };
  }
  const currentEquity = toNumber(currentReport && currentReport.totals && currentReport.totals.total_equity_usdt, NaN);
  const prevEquity = toNumber(previousReport && previousReport.totals && previousReport.totals.total_equity_usdt, NaN);
  const currentNet = toNumber(currentReport && currentReport.pnl_today && currentReport.pnl_today.net_pnl_usdt, NaN);
  const prevNet = toNumber(previousReport && previousReport.pnl_today && previousReport.pnl_today.net_pnl_usdt, NaN);
  const currentNetPct = toNumber(currentReport && currentReport.pnl_today && currentReport.pnl_today.net_pnl_pct, NaN);
  const prevNetPct = toNumber(previousReport && previousReport.pnl_today && previousReport.pnl_today.net_pnl_pct, NaN);
  const currentGross = toNumber(currentReport && currentReport.pnl_today && currentReport.pnl_today.gross_with_unrealized_usdt, NaN);
  const prevGross = toNumber(previousReport && previousReport.pnl_today && previousReport.pnl_today.gross_with_unrealized_usdt, NaN);
  const available = [currentEquity, prevEquity, currentNet, prevNet, currentNetPct, prevNetPct, currentGross, prevGross].every(Number.isFinite);
  if (!available) {
    return { available: false, label, path: baselineRef && baselineRef.path ? baselineRef.path : null, reason: "BASELINE_INVALID" };
  }
  return {
    available: true,
    label,
    path: previousReport.__report_path || null,
    generated_at_kst: previousReport.generated_at_kst || null,
    total_equity_delta_usdt: currentEquity - prevEquity,
    net_pnl_delta_usdt: currentNet - prevNet,
    net_pnl_pct_delta_pp: currentNetPct - prevNetPct,
    gross_pnl_delta_usdt: currentGross - prevGross,
  };
}

function comparisonSummaryLines(comparison, unavailableLabel) {
  if (!comparison || comparison.available !== true) {
    return [unavailableLabel || "기준 데이터 없음"];
  }
  return [
    `총 평가금액 ${formatSignedRounded(comparison.total_equity_delta_usdt, " USDT")}`,
    `순손익 ${formatSignedRounded(comparison.net_pnl_delta_usdt, " USDT")}`,
    `순손익률 ${formatSignedPp(comparison.net_pnl_pct_delta_pp)}`,
    `미실현 포함 총손익 ${formatSignedRounded(comparison.gross_pnl_delta_usdt, " USDT")}`,
  ];
}

function buildEvGateSummary(evRun) {
  const data = evRun && evRun.ok && evRun.data && evRun.data.ok === true ? evRun.data : null;
  const summary = data && data.summary && typeof data.summary === "object" ? data.summary : null;
  if (!summary) {
    return {
      available: false,
      lines: ["EV gate 영향 집계 실패"],
    };
  }
  const evaluated = toNumber(summary.ev_gate_evaluated_entries, 0);
  const observed = toNumber(summary.ev_gate_observed_entries, 0);
  const skipped = toNumber(summary.ev_gate_skipped_entries, 0);
  const totalDrops = toNumber(summary.ev_gate_drops_total, toNumber(summary.ev_gate_prob_drops, 0));
  return {
    available: true,
    lines: [
      `EV 관측 ${observed}건 / 평가 ${evaluated}건 / skip ${skipped}건`,
      `EV 드롭 ${totalDrops}건 / 평가 대비 ${Number.isFinite(Number(summary.ev_drop_rate_of_evaluated_entries)) ? formatSignedPp(Number(summary.ev_drop_rate_of_evaluated_entries) * 100, 2).replace("%p", "%") : "N/A"}`,
    ],
    jsonPath: data.jsonPath || null,
    mdPath: data.mdPath || null,
    summary,
  };
}

async function fetchUsdKrwRate() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const json = await res.json();
    const rate = Number(json && json.rates && json.rates.KRW);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("INVALID_KRW_RATE");
    return { rate, source: "open.er-api.com" };
  } catch (_err) {
    return { rate: FALLBACK_USD_KRW, source: "fallback" };
  }
}

async function readActivePositions() {
  const db = getFirestore();
  const snap = await db
    .collection("positions_paper")
    .where("exchange", "==", "BINANCEFUT")
    .get();

  const rows = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const meta = d.meta || {};
    const state = String(d.state || "").toUpperCase();
    const status = String(d.status || "").toUpperCase();
    const qtyBase = toNumber(d.qty_base, 0);
    const active = (state === "ACTIVE" || status === "ACTIVE") && qtyBase > 0;
    if (!active) return;
    rows.push({
      symbol: resolveSymbol(doc.id, d),
      side: d.position_side || d.side || null,
      qty_base: qtyBase,
      avg_price: toNumber(d.avg_price, null),
      tp_p1_done: Boolean(d.tp_p1_done ?? meta.tp_p1_done),
      trail_active: Boolean(d.trail_active ?? meta.trail_active),
      native_sl: toNumber(d.native_protection_stop_price ?? meta.native_protection_stop_price, null),
      native_tp1: toNumber(d.native_protection_tp_price ?? meta.native_protection_tp_price, null),
      native_tp_qty_base: toNumber(d.native_protection_tp_qty_base ?? meta.native_protection_tp_qty_base, null),
      native_status: String((d.native_protection_refresh_status ?? meta.native_protection_refresh_status) || "").trim() || null,
    });
  });
  rows.sort((a, b) => String(a.symbol || "").localeCompare(String(b.symbol || "")));
  return rows;
}

function positionStatusLabel(row) {
  if (row.status_warning === "ACTIVE_MARKET_MISSING_FROM_POSITION_DOC") return "상태 미동기화";
  if (row.tp_p1_done && row.trail_active) return "TP1 완료 · 트레일링 활성";
  if (row.tp_p1_done) return "TP1 완료";
  if (row.trail_active) return "트레일링 활성";
  return "TP1 전";
}

function summarizeExecutionEngine(sys = {}, exchange = "BINANCEFUT") {
  const ex = String(exchange || "").toUpperCase();
  const execMode = String(sys.execution_mode || (sys.live_dry_run ? "LIVE_DRY_RUN" : "PAPER")).toUpperCase();
  const liveDryRun = Boolean(sys.live_dry_run) || execMode === "LIVE_DRY_RUN";
  const liveEnabled = execMode === "LIVE" && sys.live_enabled === true;
  const providerTradeEnabled = ex.includes("BINANCE")
    ? sys.binance_real_trading_enabled === true
    : true;
  if (execMode !== "LIVE") {
    return {
      label: liveDryRun ? "DRY RUN" : "PAPER",
      execution_mode: execMode,
      live_enabled: liveEnabled,
      provider_trade_enabled: providerTradeEnabled,
    };
  }
  if (!liveEnabled) {
    return {
      label: "OFF",
      execution_mode: execMode,
      live_enabled: false,
      provider_trade_enabled: providerTradeEnabled,
    };
  }
  if (liveDryRun) {
    return {
      label: "DRY RUN",
      execution_mode: execMode,
      live_enabled: true,
      provider_trade_enabled: providerTradeEnabled,
    };
  }
  if (!providerTradeEnabled) {
    return {
      label: "LIVE(주문 OFF)",
      execution_mode: execMode,
      live_enabled: true,
      provider_trade_enabled: false,
    };
  }
  return {
    label: "LIVE",
    execution_mode: execMode,
    live_enabled: true,
    provider_trade_enabled: true,
  };
}

function mergeIntegrityMarketsIntoPositions(positions, integrity) {
  const base = Array.isArray(positions) ? positions.slice() : [];
  const markets = Array.isArray(integrity && integrity.markets) ? integrity.markets : [];
  const seen = new Set(
    base.map((row) => String(row && row.symbol || "").trim().toUpperCase()).filter(Boolean)
  );
  for (const market of markets) {
    const sym = String(market && market.symbol || "").trim().toUpperCase();
    if (!sym) continue;
    if (!(market && (market.internal_active || market.external_active))) continue;
    if (seen.has(sym)) continue;
    base.push({
      symbol: sym,
      side: market.internal_side || market.external_side || null,
      qty_base: null,
      avg_price: null,
      tp_p1_done: false,
      trail_active: false,
      native_sl: null,
      native_tp1: null,
      native_tp_qty_base: null,
      native_status: (Number(market.issue_count) || 0) > 0 ? "WARN" : "SYNC_PENDING",
      status_warning: "ACTIVE_MARKET_MISSING_FROM_POSITION_DOC",
    });
    seen.add(sym);
  }
  base.sort((a, b) => String(a.symbol || "").localeCompare(String(b.symbol || "")));
  return base;
}

async function readRecentTp1FillMap({ exchange = "BINANCEFUT", lookbackMs = 20 * 60 * 1000, limit = 300 } = {}) {
  const db = getFirestore();
  const snap = await db.collection("fills_paper")
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();
  const cutoffMs = Date.now() - Math.max(60 * 1000, Math.floor(Number(lookbackMs) || 0));
  const out = new Map();
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (String(d.exchange || "").toUpperCase() !== String(exchange || "").toUpperCase()) return;
    if (!String(d.event || "").toUpperCase().startsWith("EXIT_TP_P1_")) return;
    const symbol = String(d.symbol_or_pair_id || d.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    const createdAtMs = Date.parse(String(d.created_at || ""));
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoffMs) return;
    const prev = out.get(symbol);
    if (!prev || createdAtMs > prev.createdAtMs) {
      out.set(symbol, {
        createdAt: d.created_at || null,
        createdAtMs,
      });
    }
  });
  return out;
}

async function main() {
  const meta = nowKstMeta();
  await ensureExchangeApiKeys("BINANCEFUT");
  const systemSettings = (await getSystemSettingsForProvider("BINANCEFUT", 5000)).data || {};

  const refresh = execJson("node scripts/refresh-noye-runtime-inputs.js", { cwd: REPO_ROOT });
  if (!refresh.ok || !refresh.data || refresh.data.ok !== true) {
    throw new Error(`NOYE_REFRESH_FAILED:${refresh.error || JSON.stringify(refresh.data || {})}`);
  }

  const snapshotPath = String(refresh.data.snapshot_path || "").trim();
  const reportPath = String(refresh.data.report_path || "").trim();
  if (!snapshotPath || !reportPath) {
    throw new Error("NOYE_REFRESH_OUTPUT_MISSING");
  }

  const opsRun = execJson(
    `node scripts/daily-system-ops-check.js ${JSON.stringify(snapshotPath)} ${JSON.stringify(reportPath)}`,
    { cwd: REPO_ROOT }
  );
  if (!opsRun.ok || !opsRun.data || opsRun.data.ok !== true) {
    throw new Error(`SYSTEM_OPS_CHECK_FAILED:${opsRun.error || JSON.stringify(opsRun.data || {})}`);
  }

  const snapshot = readJsonSafe(snapshotPath, {});
  const ops = readJsonSafe(path.join(REPO_ROOT, "ops", "daily", "system_ops_check_latest.json"), {});
  const evGateRun = execJson("node scripts/report-ev-gate-impact.js --rolling-24h", { cwd: REPO_ROOT });
  const integrity = await auditBinanceExitIntegrity({ includeFlat: false });
  const positionsRaw = await readActivePositions();
  const positions = mergeIntegrityMarketsIntoPositions(positionsRaw, integrity);
  const recentTp1FillMap = await readRecentTp1FillMap({ exchange: "BINANCEFUT" });
  const { rate: usdKrwRate, source: rateSource } = await fetchUsdKrwRate();
  const evGateSummary = buildEvGateSummary(evGateRun);

  for (const row of positions) {
    const recentTp1 = recentTp1FillMap.get(String(row.symbol || "").toUpperCase());
    if (recentTp1 && row.tp_p1_done !== true) {
      row.status_warning = "RECENT_TP1_FILL_NOT_REFLECTED";
      row.status_warning_kst = recentTp1.createdAt || null;
    }
  }

  const totalEquityUsdt = toNumber(snapshot.total_equity);
  const walletBalanceUsdt = toNumber(snapshot.account_reference && snapshot.account_reference.totalWalletBalance);
  const unrealizedUsdt = toNumber(snapshot.account_reference && snapshot.account_reference.totalUnrealizedProfit);
  const realizedUsdt = toNumber(snapshot.realized_pnl);
  const commissionUsdt = toNumber(snapshot.commission);
  const fundingUsdt = toNumber(snapshot.funding);
  const netUsdt = realizedUsdt + commissionUsdt + fundingUsdt;
  const grossUsdt = netUsdt + unrealizedUsdt;

  const previousRefs = findPreviousOverallReports(meta.dateKey, meta.hhmm);

  const report = {
    generated_at_kst: meta.kst,
    snapshot_generated_at_kst: snapshot.generated_at_kst,
    exchange: "BINANCEFUT",
    usd_krw_rate: usdKrwRate,
    usd_krw_rate_source: rateSource,
    totals: {
      total_equity_usdt: totalEquityUsdt,
      total_equity_krw: totalEquityUsdt * usdKrwRate,
      wallet_balance_usdt: walletBalanceUsdt,
      wallet_balance_krw: walletBalanceUsdt * usdKrwRate,
      unrealized_pnl_usdt: unrealizedUsdt,
      unrealized_pnl_krw: unrealizedUsdt * usdKrwRate,
    },
    pnl_today: {
      realized_pnl_usdt: realizedUsdt,
      realized_pnl_krw: realizedUsdt * usdKrwRate,
      commission_usdt: commissionUsdt,
      commission_krw: commissionUsdt * usdKrwRate,
      funding_usdt: fundingUsdt,
      funding_krw: fundingUsdt * usdKrwRate,
      net_pnl_usdt: netUsdt,
      net_pnl_krw: netUsdt * usdKrwRate,
      net_pnl_pct: toNumber(snapshot.derived && snapshot.derived.net_pnl_pct, 0),
      cost_ratio_pct: toNumber(snapshot.derived && snapshot.derived.cost_ratio_pct, 0),
      gross_with_unrealized_usdt: grossUsdt,
      gross_with_unrealized_krw: grossUsdt * usdKrwRate,
    },
    activity: {
      trade_count_today: toNumber(snapshot.derived && snapshot.derived.trade_count_today, 0),
      funding_count_today: toNumber(snapshot.derived && snapshot.derived.funding_count_today, 0),
      symbols: Array.isArray(snapshot.symbols) ? snapshot.symbols : [],
    },
    operations: {
      status: String(ops.status || "").trim() || "N/A",
      mode: String(ops.mode || "").trim() || "N/A",
      reasons: Array.isArray(ops.reasons) ? ops.reasons : [],
      error_count_24h: isFiniteNullable(ops.error_count)
        ? Number(ops.error_count)
        : (isFiniteNullable(snapshot.derived && snapshot.derived.error_count_24h)
          ? Number(snapshot.derived.error_count_24h)
          : null),
      error_source_stale: ops.derived && ops.derived.error_source_stale === true,
      day_over_day: "기준 데이터 없음",
      ev_gate_impact_available: evGateSummary.available,
    },
    execution_engine: summarizeExecutionEngine(systemSettings, "BINANCEFUT"),
    integrity: {
      ok: Boolean(integrity.ok),
      active_market_count: Number.isFinite(Number(integrity.active_market_count)) ? Number(integrity.active_market_count) : positions.length,
      position_doc_count: positionsRaw.length,
      position_display_count: positions.length,
      issue_count: toNumber(integrity.issue_count, 0),
    },
    positions,
  };

  const previousHourReport = previousRefs.previousHour ? readJsonSafe(previousRefs.previousHour.path, null) : null;
  const todayStartReport = previousRefs.todayStart ? readJsonSafe(previousRefs.todayStart.path, null) : null;
  const previousDayReport = previousRefs.previousDayLatest ? readJsonSafe(previousRefs.previousDayLatest.path, null) : null;
  if (previousHourReport) previousHourReport.__report_path = previousRefs.previousHour.path;
  if (todayStartReport) todayStartReport.__report_path = previousRefs.todayStart.path;
  if (previousDayReport) previousDayReport.__report_path = previousRefs.previousDayLatest.path;

  report.comparisons = {
    previous_hour: buildComparison(
      report,
      previousHourReport,
      resolveComparisonLabel({ kind: "previous_hour", currentDateKey: meta.dateKey, currentHhmm: meta.hhmm, baselineRef: previousRefs.previousHour }),
      previousRefs.previousHour
    ),
    today_start: buildComparison(
      report,
      todayStartReport,
      resolveComparisonLabel({ kind: "today_start", currentDateKey: meta.dateKey, currentHhmm: meta.hhmm, baselineRef: previousRefs.todayStart }),
      previousRefs.todayStart
    ),
    previous_day_latest: buildComparison(
      report,
      previousDayReport,
      resolveComparisonLabel({ kind: "previous_day_latest", currentDateKey: meta.dateKey, currentHhmm: meta.hhmm, baselineRef: previousRefs.previousDayLatest }),
      previousRefs.previousDayLatest
    ),
  };
  if (report.comparisons.previous_day_latest.available) {
    report.operations.day_over_day = "전일 마지막 보고 대비 제공";
  } else if (report.comparisons.previous_hour.available || report.comparisons.today_start.available) {
    report.operations.day_over_day = "전시간/당일 누적 비교 제공";
  }

  const baseName = `${meta.dateKey}_${meta.hhmm}_overall_account_report`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${baseName}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${baseName}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "overall_account_report_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "overall_account_report_latest.md");

  writeJson(jsonPath, report);
  writeText(
    mdPath,
    [
      "# 전체 계좌 리포트",
      "",
      `- 작성 시각: ${meta.kst}`,
      `- 계좌 기준: BINANCEFUT LIVE`,
      `- USDT→KRW 환산 기준: 1 USD = ${usdKrwRate.toFixed(4)} KRW (${rateSource})`,
      `- 표시 규칙: 금액 숫자는 반올림 표기`,
      "",
      "## 1. 총액 요약",
      "",
      `- 총 평가금액: \`${roundAmount(totalEquityUsdt)} USDT\``,
      `- 현재 기준 환산 KRW: \`${roundAmount(totalEquityUsdt * usdKrwRate).toLocaleString("ko-KR")} KRW\``,
      `- 지갑 잔고(실현 기준): \`${roundAmount(walletBalanceUsdt)} USDT\``,
      `- 미실현손익: \`${formatSignedRounded(unrealizedUsdt, " USDT")}\` (\`${formatSignedRounded(unrealizedUsdt * usdKrwRate, " KRW")}\`)`,
      "",
      "## 2. 당일 손익 요약",
      "",
      `- 실현손익: \`${formatSignedRounded(realizedUsdt, " USDT")}\` (\`${formatSignedRounded(realizedUsdt * usdKrwRate, " KRW")}\`)`,
      `- 수수료: \`${formatSignedRounded(commissionUsdt, " USDT")}\` (\`${formatSignedRounded(commissionUsdt * usdKrwRate, " KRW")}\`)`,
      `- 펀딩비: \`${formatSignedRounded(fundingUsdt, " USDT")}\` (\`${formatSignedRounded(fundingUsdt * usdKrwRate, " KRW")}\`)`,
      `- 순손익(실현-비용): \`${formatSignedRounded(netUsdt, " USDT")}\` (\`${formatSignedRounded(netUsdt * usdKrwRate, " KRW")}\`)`,
      `- 순손익률: \`${formatSignedPercent(report.pnl_today.net_pnl_pct, 4)}\``,
      `- 비용 비율: \`${report.pnl_today.cost_ratio_pct.toFixed(4)}%\``,
      `- 미실현 포함 총 손익: \`${formatSignedRounded(grossUsdt, " USDT")}\` (\`${formatSignedRounded(grossUsdt * usdKrwRate, " KRW")}\`)`,
      "",
      "## 3. 거래 활동",
      "",
      `- 오늘 체결 수: \`${report.activity.trade_count_today}\``,
      `- 오늘 펀딩 반영 수: \`${report.activity.funding_count_today}\``,
      `- 오늘 거래 심볼 집합: \`${report.activity.symbols.join(", ")}\``,
      "",
      "## 4. 현재 활성 포지션",
      "",
      ...(positions.length
        ? positions.flatMap((row) => [
            `### ${row.symbol}`,
            `- 방향: \`${row.side || "N/A"}\``,
            `- 수량: \`${row.qty_base ?? "N/A"}\``,
            `- 평균단가: \`${row.avg_price ?? "N/A"}\``,
            `- 상태: \`${positionStatusLabel(row)}\``,
            row.status_warning ? `- 상태 경고: \`${row.status_warning}\`${row.status_warning_kst ? ` (${row.status_warning_kst})` : ""}` : null,
            `- 네이티브 SL: \`${row.native_sl ?? "N/A"}\``,
            `- 네이티브 TP1: \`${row.native_tp1 ?? "N/A"}\``,
            row.native_tp_qty_base != null ? `- TP1 수량: \`${row.native_tp_qty_base}\`` : null,
            `- 보호주문 상태: \`${row.native_status || "N/A"}\``,
            "",
          ].filter(Boolean))
        : ["- 현재 활성 포지션 없음", ""]),
      "## 5. 보호주문/청산 무결성",
      "",
      `- 보호주문 무결성 감사 결과: \`${integrity.ok ? "정상" : "이상"}\``,
      `- 활성 포지션 수(감사 기준): \`${report.integrity.active_market_count}\``,
      `- 활성 포지션 수(문서 기준): \`${report.integrity.position_doc_count}\``,
      `- 활성 포지션 수(표시 기준): \`${report.integrity.position_display_count}\``,
      `- 이슈 수: \`${report.integrity.issue_count}\``,
      "",
      "## 6. 운영 판정",
      "",
      `- 실행 엔진: \`${report.execution_engine.label}\``,
      `- 운영 가드 상태: \`${report.operations.status}\``,
      `- 운영 가드 모드: \`${report.operations.mode}\``,
      `- 이유: \`${(report.operations.reasons || []).join(" | ") || "없음"}\``,
      `- 최근 24시간 시스템 오류: \`${isFiniteNullable(report.operations.error_count_24h) ? `${report.operations.error_count_24h}건` : "N/A"}\``,
      "",
      "## 7. EV gate 24시간 영향",
      "",
      ...(evGateSummary.lines.map((line) => `- ${line}`)),
      "",
      "## 8. 비교 지표",
      "",
      `- 비교 상태: \`${report.operations.day_over_day}\``,
      `- ${report.comparisons.previous_hour.label}: ${comparisonSummaryLines(report.comparisons.previous_hour, "기준 데이터 없음").join(" / ")}`,
      `- ${report.comparisons.today_start.label}: ${comparisonSummaryLines(report.comparisons.today_start, "기준 데이터 없음").join(" / ")}`,
      `- ${report.comparisons.previous_day_latest.label}: ${comparisonSummaryLines(report.comparisons.previous_day_latest, "기준 데이터 없음").join(" / ")}`,
      "",
    ].join("\n")
  );
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);

  const alertResult = await sendKoreanTelegramSummary({
    title: "[자산] BINANCEFUT",
    severity: "INFO",
    sections: [
      {
        header: "자산",
        lines: [
          `총 평가금액 ${roundAmount(totalEquityUsdt)} USDT`,
          `현재 환산 약 ${roundAmount(totalEquityUsdt * usdKrwRate).toLocaleString("ko-KR")} KRW`,
          `지갑 잔고 ${roundAmount(walletBalanceUsdt)} USDT / 미실현손익 ${formatSignedRounded(unrealizedUsdt, " USDT")}`,
        ],
      },
      {
        header: "오늘 손익",
        lines: [
          `순손익 ${formatSignedRounded(netUsdt, " USDT")} (${formatSignedPercent(report.pnl_today.net_pnl_pct, 4)})`,
          `실현 ${formatSignedRounded(realizedUsdt, " USDT")} / 수수료 ${formatSignedRounded(commissionUsdt, " USDT")} / 펀딩비 ${formatSignedRounded(fundingUsdt, " USDT")}`,
          `미실현 포함 총 손익 ${formatSignedRounded(grossUsdt, " USDT")}`,
        ],
      },
      {
        header: "포지션",
        lines: positions.length
          ? positions.map((row) => `${row.symbol} ${row.side || ""} · ${positionStatusLabel(row)}${row.status_warning ? " · 상태지연경고" : ""} · 보호주문 ${row.native_status || "N/A"}`.trim())
          : ["현재 활성 포지션 없음"],
      },
      {
        header: "운영 상태",
        lines: [
          `실행 엔진 ${report.execution_engine.label}`,
          `운영 가드 ${report.operations.status} / 모드 ${report.operations.mode} / 최근 오류 ${isFiniteNullable(report.operations.error_count_24h) ? `${report.operations.error_count_24h}건` : "N/A"}`,
          ...evGateSummary.lines.slice(0, 1),
          `${report.comparisons.previous_hour.label} ${comparisonSummaryLines(report.comparisons.previous_hour, "기준 데이터 없음").join(" / ")}`,
        ],
      },
      { header: "보고서", lines: [mdPath] },
    ],
  });

  if (!alertResult || (alertResult.ok !== true && alertResult.skipped !== true)) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alertResult || {})}`);
  }

  console.log(JSON.stringify({ ok: true, jsonPath, mdPath, alert: alertResult }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-hourly-overall-report failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      resolveComparisonLabel,
      buildComparison,
      formatSignedPercent,
      summarizeExecutionEngine,
    },
  };
}
