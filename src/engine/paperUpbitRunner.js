// src/engine/paperUpbitRunner.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  generateSignals,
  resolveExitRulesForPosition,
  evaluateTp1LadderStage,
  applyTp1LadderPolicy,
} = require("./signalEngine");
const { computeFillPrice, computeFeeValue } = require("./paperExecution");

const { listPendingIntentsForExec, listPendingIntentsOverdue, cancelExpiredPendingIntents, markIntentStatus, upsertIntent, patchIntent } = require("../storage/orderIntentsPaper");
const { upsertFill } = require("../storage/fillsPaper");
const { getPosition, upsertPosition } = require("../storage/positionsPaper");
const { buildTradeId, upsertTradeEvent } = require("../storage/tradesPaper");
const { upsertSignal } = require("../storage/signals");
const { markSignalConsumed, tryLockSignal } = require("../storage/signalsConsume");
const { getSignalsForBar } = require("../storage/signalsQuery");
const { queryBars } = require("../storage/barsSnapshots");
const { recordSignalDrops } = require("../storage/signalDrops");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { getExchangeSettingsForProvider, getRiskBudgetForProvider } = require("../utils/exchangeSettings");
const { getFirestore } = require("../storage/firestore");
const { tfToMs, normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { normalizeEvalExchange, evalLatestId, matchesEvalTf } = require("../utils/evalDoc");
const { deriveSignalDocId } = require("../utils/signalDocId");
const { buildExitStageView } = require("../utils/exitStageView");
const { resolveBinanceFuturesKeys } = require("../utils/binanceKeyResolver");
const { normalizePositionSide } = require("../utils/positionSide");
const {
  resolveEntryTimingTier,
  resolveEntryQtyProfile,
} = require("../utils/liveEntryTaxonomy");
const {
  normalizeSignalStateToken: normalizeSignalStateTokenShared,
  resolveRegimeRecord,
} = require("../utils/regime");
const { resolveMarketStateSummary } = require("../utils/marketStateSummary");
const { evaluateLiveEntryPolicy } = require("../utils/liveExecutionPolicy");
const { resolveEventMapping } = require("../services/signalMapping");
const { normalizeEvent, deriveGroupSubtype } = require("../services/signalStandard");
const {
  evaluateCanonicalDecision,
  resolveCanonicalEngineConfig: resolveCanonicalEngineConfigShared,
} = require("../services/canonicalEngine");
const { sendTradeExecutionAlert, sendTradeExecutionFailureAlert } = require("../services/tradeExecutionAlert");
const { sendSignalReceivedAlert, sendSignalProgressAlert } = require("../services/signalLifecycleAlert");
const { sendAlert } = require("../utils/alerts");
const { estimateTp1ReachProbability } = require("../services/evTp1Probability");
const { resolveWaitOneBarConfig, evaluateWaitOneBarTiming } = require("../services/waitOneBarPolicy");
const {
  buildServerNativeInitialSignals,
  HTF_TF: SERVER_NATIVE_HTF_TF,
  minBaseBarsForDerivedHtf,
} = require("../services/serverNativeInitialSignal");
const { placeMarketBuy, placeMarketSell, fetchOrder, calcAveragePrice: calcUpbitAveragePrice } = require("../exchanges/upbitPrivate");
const { placeOrder: placeKiwoomOrder, fetchAccount: fetchKiwoomAccount } = require("../exchanges/kiwoomRest");
const { isKrxMarketOpenKst } = require("../utils/krxCalendar");
const { getBinanceFuturesAccountSummary } = require("../services/binanceFuturesAccountSummary");
const { fetchRecentNewFills, buildTradesFromFills } = require("../services/tradesFromFills");
const {
  fetchFuturesExchangeInfo,
  placeFuturesMarketOrder,
  placeFuturesStopMarketOrder,
  placeFuturesTakeProfitMarketOrder,
  cancelFuturesOpenOrders,
  fetchFuturesOrder,
  fetchBinanceFuturesAccount,
  setFuturesLeverage,
  setFuturesMarginType,
  fetchFuturesPositionMode,
  calcAveragePrice: calcBinanceAveragePrice
} = require("../exchanges/binanceFuturesPrivate");
const { triggerExitWorkerRun } = require("../services/exitWorkerClient");

const POS_SIZE_EPSILON = (() => {
  const raw = Number(process.env.POS_SIZE_EPSILON);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 0.0001;
})();

const TP_P1_FILL_CACHE_TTL_MS = 10 * 1000;
const TP_P1_FILL_CACHE_LIMIT = 200;
const recentFillsCache = {
  ts: 0,
  rows: [],
};
const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");
const OPENCLAW_MARKET_REGIME_BOARD_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_market_regime_board_latest.json");
const PERFORMANCE_KPI_UPGRADE_CONTRACT_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_performance_kpi_upgrade_contract_latest.json");
const OPENCLAW_MARKET_REGIME_CACHE_TTL_MS = 15 * 1000;
const openclawMarketRegimeCache = {
  ts: 0,
  mtimeMs: null,
  byMarket: new Map(),
};
const TP1_LADDER_KPI_CACHE_TTL_MS = 15 * 1000;
const tp1LadderKpiCache = {
  ts: 0,
  mtimeMs: null,
  value: null,
};

const TP_P1_SKIP_REASONS = new Set([
  "ORDER_TOO_SMALL",
  "POSITION_TOO_SMALL",
  "MIN_ORDER_EXCEEDS_BUDGET",
  "TP_P1_PARTIAL_BELOW_MIN_NOTIONAL",
  "TP_P1_REMAINDER_BELOW_MIN_NOTIONAL",
  "TP_P1_PARTIAL_BELOW_MIN_QTY",
  "TP_P1_REMAINDER_BELOW_MIN_QTY",
  "MARGIN_TYPE_SET_FAILED",
]);

function normalizeOpenClawCohort(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "KEEP_DROP" || upper === "HOLD_SAMPLE") return upper;
  return null;
}

function normalizeTp1LadderProfile(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "BASE") return upper;
  return null;
}

function resolveCooldownProfileFromMeta(posMeta = null) {
  const metaSafe = posMeta && typeof posMeta === "object" ? posMeta : {};
  const cohort = normalizeOpenClawCohort(
    metaSafe.openclaw_market_regime_cohort || metaSafe.market_regime_cohort
  );
  if (cohort === "RESCUE") return "RESCUE";
  if (cohort === "MIXED") return "MIXED";
  return "BASE";
}

function resolveOppositeCooldownWindow({ sysCfg = {}, posMeta = null } = {}) {
  const cohort = normalizeOpenClawCohort(
    posMeta && (posMeta.openclaw_market_regime_cohort || posMeta.market_regime_cohort)
  );
  const profile = resolveCooldownProfileFromMeta(posMeta);
  const defaultBars = Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_signal_cooldown_bars, 3));
  const defaultMs = Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_time_cooldown_ms, 300000));
  if (profile === "RESCUE") {
    return {
      cohort: cohort || "BASE",
      profile,
      bars: Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_signal_cooldown_bars_rescue, 0)),
      timeMs: Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_time_cooldown_ms_rescue, 0)),
    };
  }
  if (profile === "MIXED") {
    return {
      cohort: cohort || "BASE",
      profile,
      bars: Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_signal_cooldown_bars_mixed, 1)),
      timeMs: Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_time_cooldown_ms_mixed, 60000)),
    };
  }
  return {
    cohort: cohort || "BASE",
    profile: "BASE",
    bars: defaultBars,
    timeMs: defaultMs,
  };
}

function resolveOppositeCooldownWindowFromPosition({ sysCfg = {}, position = null } = {}) {
  const posMeta = (position && typeof position.meta === "object") ? position.meta : null;
  return resolveOppositeCooldownWindow({ sysCfg, posMeta });
}

function resolveLiveMarketRegimeCohort({ symbol = "", posMeta = null } = {}) {
  const marketRegimeRow = readOpenClawMarketRegimeRow(symbol);
  return normalizeOpenClawCohort(
    (marketRegimeRow && marketRegimeRow.cohort)
    || (posMeta && posMeta.openclaw_market_regime_cohort)
    || (posMeta && posMeta.market_regime_cohort)
  );
}

function loadOpenClawMarketRegimeBoard(force = false) {
  const now = Date.now();
  if (!force && openclawMarketRegimeCache.ts && (now - openclawMarketRegimeCache.ts) < OPENCLAW_MARKET_REGIME_CACHE_TTL_MS) {
    return openclawMarketRegimeCache.byMarket;
  }
  try {
    const stat = fs.statSync(OPENCLAW_MARKET_REGIME_BOARD_PATH);
    const mtimeMs = Number(stat.mtimeMs || 0);
    if (!force && openclawMarketRegimeCache.mtimeMs && openclawMarketRegimeCache.mtimeMs === mtimeMs) {
      openclawMarketRegimeCache.ts = now;
      return openclawMarketRegimeCache.byMarket;
    }
    const parsed = JSON.parse(fs.readFileSync(OPENCLAW_MARKET_REGIME_BOARD_PATH, "utf8"));
    const rows = Array.isArray(parsed && parsed.by_market) ? parsed.by_market : [];
    const map = new Map();
    for (const row of rows) {
      const market = String(row && row.market || "").trim().toUpperCase();
      if (!market) continue;
      map.set(market, row);
    }
    openclawMarketRegimeCache.ts = now;
    openclawMarketRegimeCache.mtimeMs = mtimeMs;
    openclawMarketRegimeCache.byMarket = map;
    return map;
  } catch (_) {
    openclawMarketRegimeCache.ts = now;
    if (!openclawMarketRegimeCache.byMarket) openclawMarketRegimeCache.byMarket = new Map();
    return openclawMarketRegimeCache.byMarket;
  }
}

function unwrapSummaryRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.summary && typeof raw.summary === "object") return raw.summary;
  return raw;
}

function normalizeTp1LadderKpiRecord(raw = null) {
  const safe = unwrapSummaryRecord(raw) || raw;
  if (!safe || typeof safe !== "object") return null;
  const snapshot = {
    status: String(safe.status || "").trim().toUpperCase() || null,
    realized_n: Number(safe.realized_trade_n ?? safe.realized_n),
    tp0_hit_rate: Number(safe.tp0_hit_rate),
    tp1_hit_rate: Number(safe.tp1_hit_rate),
    tp0_to_tp1_conversion: Number(safe.tp0_to_tp1_conversion_rate ?? safe.tp0_to_tp1_conversion),
    fee_adjusted_expectancy: Number(safe.fee_adjusted_expectancy),
  };
  return snapshot;
}

function buildTp1LadderKpiScopeMap(raw = null, scope = "MARKET") {
  const result = new Map();
  const addEntry = (scopeKey, record) => {
    const normalizedKey = scope === "MARKET"
      ? String(scopeKey || "").trim().toUpperCase()
      : normalizeOpenClawCohort(scopeKey);
    if (!normalizedKey) return;
    const normalizedRecord = normalizeTp1LadderKpiRecord(record);
    if (!normalizedRecord) return;
    result.set(normalizedKey, normalizedRecord);
  };
  if (!raw || typeof raw !== "object") return result;
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      addEntry(scope === "MARKET" ? row.market : row.cohort, row);
    }
    return result;
  }
  for (const [key, value] of Object.entries(raw)) {
    addEntry(key, value);
  }
  return result;
}

function resolveTp1LadderKpiForContext(snapshot = null, { market = null, cohort = null } = {}) {
  const safe = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!safe) return { scope: "GLOBAL", kpi: null };
  const marketKey = String(market || "").trim().toUpperCase();
  if (marketKey && safe.byMarket instanceof Map) {
    const marketSnapshot = safe.byMarket.get(marketKey);
    if (marketSnapshot) return { scope: "MARKET", kpi: marketSnapshot };
  }
  const cohortKey = normalizeOpenClawCohort(cohort);
  if (cohortKey && safe.byCohort instanceof Map) {
    const cohortSnapshot = safe.byCohort.get(cohortKey);
    if (cohortSnapshot) return { scope: "COHORT", kpi: cohortSnapshot };
  }
  return { scope: "GLOBAL", kpi: safe.global || null };
}

function loadTp1LadderKpiSnapshot(force = false) {
  const now = Date.now();
  if (!force && tp1LadderKpiCache.ts && (now - tp1LadderKpiCache.ts) < TP1_LADDER_KPI_CACHE_TTL_MS) {
    return tp1LadderKpiCache.value;
  }
  try {
    const stat = fs.statSync(PERFORMANCE_KPI_UPGRADE_CONTRACT_PATH);
    const mtimeMs = Number(stat.mtimeMs || 0);
    if (!force && tp1LadderKpiCache.mtimeMs && tp1LadderKpiCache.mtimeMs === mtimeMs) {
      tp1LadderKpiCache.ts = now;
      return tp1LadderKpiCache.value;
    }
    const raw = JSON.parse(fs.readFileSync(PERFORMANCE_KPI_UPGRADE_CONTRACT_PATH, "utf8"));
    const summary = unwrapSummaryRecord(raw) || {};
    const snapshot = {
      status: String(summary.status || raw.status || "").trim().toUpperCase() || null,
      global: normalizeTp1LadderKpiRecord(summary || raw),
      byMarket: buildTp1LadderKpiScopeMap(
        summary.by_market || summary.byMarket || raw.by_market || raw.byMarket,
        "MARKET"
      ),
      byCohort: buildTp1LadderKpiScopeMap(
        summary.by_cohort || summary.byCohort || raw.by_cohort || raw.byCohort,
        "COHORT"
      ),
    };
    tp1LadderKpiCache.ts = now;
    tp1LadderKpiCache.mtimeMs = mtimeMs;
    tp1LadderKpiCache.value = snapshot;
    return snapshot;
  } catch (_) {
    tp1LadderKpiCache.ts = now;
    tp1LadderKpiCache.value = null;
    return null;
  }
}

function resolveTp1LadderConfig(sysCfg) {
  return {
    enabled: normalizeBool(sysCfg && sysCfg.tp1_ladder_enabled, true),
    stage1RealizedNMin: Math.max(1, normalizeInt(sysCfg && sysCfg.tp1_ladder_stage1_realized_n_min, 8)),
    stage1Tp0HitRateMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage1_tp0_hit_rate_min, 0.55), 0, 1),
    stage1Tp0ToTp1ConversionMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage1_tp0_to_tp1_conversion_min, 0.20), 0, 1),
    stage1FeeAdjustedExpectancyMin: normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage1_fee_adjusted_expectancy_min, -0.0005),
    stage2RealizedNMin: Math.max(1, normalizeInt(sysCfg && sysCfg.tp1_ladder_stage2_realized_n_min, 16)),
    stage2Tp0HitRateMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage2_tp0_hit_rate_min, 0.60), 0, 1),
    stage2Tp1HitRateMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage2_tp1_hit_rate_min, 0.30), 0, 1),
    stage2Tp0ToTp1ConversionMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage2_tp0_to_tp1_conversion_min, 0.35), 0, 1),
    stage2FeeAdjustedExpectancyMin: normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage2_fee_adjusted_expectancy_min, 0),
  };
}

function resolveTp1LadderRuntimeState({ sysCfg, cohort, market } = {}) {
  const config = resolveTp1LadderConfig(sysCfg || {});
  const snapshot = loadTp1LadderKpiSnapshot();
  const selected = resolveTp1LadderKpiForContext(snapshot, { market, cohort });
  return {
    ...evaluateTp1LadderStage({
      cohort: cohort || "BASE",
      kpi: selected.kpi,
      config,
    }),
    kpi: selected.kpi,
    kpi_scope: selected.scope,
  };
}

function readOpenClawMarketRegimeRow(market) {
  const key = String(market || "").trim().toUpperCase();
  if (!key) return null;
  const map = loadOpenClawMarketRegimeBoard(false);
  return map.get(key) || null;
}

// --- Commission Gate v2 (ENFORCE) + MDD reduction gate ---
const PERF_GATE_TTL_MS = 60_000;
const PERF_GATE_LOOKBACK_MS = 48 * 3600 * 1000;
const COMMISSION_RATIO_THRESHOLD = Number(process.env.COMMISSION_RATIO_THRESHOLD || 0.15);
const COMMISSION_RATIO_MULTIPLIER = Number(process.env.COMMISSION_RATIO_MULTIPLIER || 3);
const MDD_THRESHOLD = Number(process.env.MDD_THRESHOLD || -0.05);
const MDD_REDUCE_FACTOR = Number(process.env.MDD_REDUCE_FACTOR || 0.5);
const COMMISSION_GATE_ENABLED = String(process.env.COMMISSION_GATE_ENABLED || "1") !== "0";
// ENFORCE: 에러 시 차단 (fail-closed). false면 에러 시 통과 (fail-open)
const COMMISSION_GATE_ENFORCE = COMMISSION_GATE_ENABLED
  && String(process.env.COMMISSION_GATE_ENFORCE || "1") !== "0";
const AI_FAIL_MODE = String(process.env.SIGNAL_AI_FAIL_MODE || "ALLOW").trim().toUpperCase();
const AI_MISSING_REDUCE_PCT = (() => {
  const raw = Number(process.env.SIGNAL_AI_MISSING_REDUCE_PCT);
  if (Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
  return 0.5;
})();
const perfGateCache = new Map();

async function loadPerformanceGate(exchange) {
  if (!COMMISSION_GATE_ENABLED) {
    return {
      commissionRatio: 0,
      commissionBlocked: false,
      mdd: 0,
      mddBlocked: false,
      mddReduceFactor: 1.0,
      totalFee: 0,
      totalPnl: 0,
      tradeCount: 0,
      fillCount: 0,
      threshold: COMMISSION_RATIO_THRESHOLD,
      enforce: false,
      disabled: true,
      dataSource: "DISABLED",
      lookbackMs: PERF_GATE_LOOKBACK_MS,
    };
  }
  const now = Date.now();
  const cacheKey = String(exchange || "").toUpperCase().trim();
  const cached = perfGateCache.get(cacheKey);
  if (cached && cached.data && (now - cached.ts) < PERF_GATE_TTL_MS) {
    return cached.data;
  }
  try {
    const db = getFirestore();
    const since = new Date(now - PERF_GATE_LOOKBACK_MS).toISOString();
    const exKey = String(exchange || "").toUpperCase();
    let snap;
    if (exKey) {
      snap = await db.collection("fills_paper")
        .where("exchange", "==", exKey)
        .where("created_at", ">=", since)
        .orderBy("created_at", "asc")
        .limit(500)
        .get();
    } else {
      snap = await db.collection("fills_paper")
        .where("created_at", ">=", since)
        .orderBy("created_at", "asc")
        .limit(500)
        .get();
    }
    const fills = snap.docs.map(d => d.data());

    let totalFee = 0;
    let totalPnl = 0;
    const pnls = [];
    const entryMap = new Map();

    for (const f of fills) {
      const ev = String(f.event || "").toUpperCase();
      const sym = String(f.symbol_or_pair_id || f.symbol || "");
      const fee = Number(f.fee_value) || 0;
      totalFee += Math.abs(fee);
      const isEntry = isPrimaryLongShortEventName(ev) || ev.startsWith("CORE_") || ev.startsWith("PRE_REAL_") || ev.startsWith("REAL_") || ev.startsWith("EARLY_") || ev.startsWith("EMO_");
      const isExit = ev.startsWith("EXIT_");
      if (isEntry && sym) {
        entryMap.set(sym, {
          price: Number(f.exec_price) || 0,
          side: ev.includes("SHORT") ? "SHORT" : "LONG",
          notional: Number(f.notional) || 0,
        });
      }
      if (isExit && sym && entryMap.has(sym)) {
        const entry = entryMap.get(sym);
        const exitPx = Number(f.exec_price) || 0;
        if (entry.price > 0 && exitPx > 0 && entry.notional > 0) {
          const dir = entry.side === "SHORT" ? -1 : 1;
          const pnlPct = dir * (exitPx - entry.price) / entry.price;
          const pnlAmt = pnlPct * entry.notional;
          totalPnl += pnlAmt;
          pnls.push(pnlPct);
        }
        entryMap.delete(sym);
      }
    }

    const commissionRatio = (totalPnl !== 0) ? (totalFee / Math.abs(totalPnl)) : (totalFee > 0 ? 1 : 0);

    let mdd = 0;
    if (pnls.length > 0) {
      let equity = 1.0;
      let peak = 1.0;
      for (const r of pnls) {
        equity *= (1 + r);
        if (equity > peak) peak = equity;
        const dd = (equity - peak) / peak;
        if (dd < mdd) mdd = dd;
      }
    }

    const result = {
      commissionRatio,
      commissionBlocked: commissionRatio > COMMISSION_RATIO_THRESHOLD,
      mdd,
      mddBlocked: mdd < MDD_THRESHOLD,
      mddReduceFactor: mdd < MDD_THRESHOLD ? MDD_REDUCE_FACTOR : 1.0,
      totalFee,
      totalPnl,
      tradeCount: pnls.length,
      fillCount: fills.length,
      threshold: COMMISSION_RATIO_THRESHOLD,
      enforce: COMMISSION_GATE_ENFORCE,
      dataSource: "fills_paper",
      lookbackMs: PERF_GATE_LOOKBACK_MS,
    };
    perfGateCache.set(cacheKey, { ts: now, data: result });
    return result;
  } catch (e) {
    // ENFORCE 모드: 에러 시 차단 (fail-closed) — 데이터 없이 주문 허용 금지
    console.error("[COMMISSION_GATE][ERROR] 게이트 데이터 로드 실패 — ENFORCE 모드에서 차단", {
      exchange, error: e.message, enforce: COMMISSION_GATE_ENFORCE,
    });
    return {
      commissionRatio: -1, commissionBlocked: COMMISSION_GATE_ENFORCE,
      mdd: 0, mddBlocked: false, mddReduceFactor: 1.0,
      totalFee: 0, totalPnl: 0, tradeCount: 0, fillCount: 0,
      threshold: COMMISSION_RATIO_THRESHOLD,
      enforce: COMMISSION_GATE_ENFORCE,
      error: e.message,
      errorBlocked: COMMISSION_GATE_ENFORCE,
    };
  }
}
// ── Commission Gate v2 증빙 로그 (3줄 세트: JUDGE → BLOCK/ALLOW → ORDER_SKIPPED/PROCEED) ──
function _gateId() {
  return `CGV2__${Date.now()}__${Math.random().toString(36).slice(2, 8)}`;
}
function _kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " KST");
}
function logCommissionGateEvidence({ phase, exchange, symbol, event, perfGate, intentId }) {
  if (!COMMISSION_GATE_ENABLED) {
    return { gateId: null, blocked: false, disabled: true };
  }
  const gateId = _gateId();
  const tsKst = _kstNow();
  const ratioPct = perfGate.commissionRatio >= 0 ? (perfGate.commissionRatio * 100).toFixed(1) : "ERR";
  const thresholdPct = ((perfGate.threshold || COMMISSION_RATIO_THRESHOLD) * 100).toFixed(0);
  const blocked = perfGate.commissionBlocked;
  const gateMode = COMMISSION_GATE_ENFORCE ? "ENFORCE" : "MONITOR";
  const oid = intentId || null;
  // ① 게이트 판정 로그
  console.log(JSON.stringify({
    tag: "[COMMISSION_GATE][JUDGE]", gate_id: gateId, phase, exchange, symbol, event, ts_kst: tsKst,
    gate_mode: gateMode, order_intent_id: oid,
    commission_ratio_pct: ratioPct, threshold_pct: thresholdPct, enforce: !!perfGate.enforce,
    total_fee: perfGate.totalFee, total_pnl: perfGate.totalPnl,
    trade_count: perfGate.tradeCount, fill_count: perfGate.fillCount,
    data_source: perfGate.dataSource || "fills_paper", error: perfGate.error || null,
  }));
  if (blocked) {
    // ② 차단 로그 — 필수 8필드: ts_kst, exchange, symbol, gate_mode, decision, reason, fee_ratio_24h, order_intent_id
    const blockReason = perfGate.error ? "GATE_ERROR_ENFORCE" : "RATIO_EXCEEDED";
    console.log(JSON.stringify({
      tag: "[COMMISSION_GATE][BLOCK]", gate_id: gateId,
      ts_kst: tsKst, exchange, symbol,
      gate: "commission_gate_v2", gate_mode: gateMode, decision: "BLOCKED",
      reason: blockReason, fee_ratio_24h: ratioPct, order_intent_id: oid,
      event, commission_ratio_pct: ratioPct, threshold_pct: thresholdPct,
    }));
    // ③ 주문 스킵 로그
    console.log(JSON.stringify({
      tag: "[COMMISSION_GATE][ORDER_SKIPPED]", gate_id: gateId,
      ts_kst: tsKst, exchange, symbol,
      gate: "commission_gate_v2", gate_mode: gateMode, decision: "BLOCKED",
      order_intent_id: oid, event, order_skipped: true, reason: "BLOCKED_BY_COMMISSION_GATE",
    }));
  } else {
    // ② 허용 로그 — 필수 8필드 포함
    console.log(JSON.stringify({
      tag: "[COMMISSION_GATE][ALLOW]", gate_id: gateId,
      ts_kst: tsKst, exchange, symbol,
      gate: "commission_gate_v2", gate_mode: gateMode, decision: "ALLOWED",
      fee_ratio_24h: ratioPct, order_intent_id: oid, event,
      commission_ratio_pct: ratioPct, threshold_pct: thresholdPct,
    }));
    // ③ 주문 진행 로그
    console.log(JSON.stringify({
      tag: "[COMMISSION_GATE][ORDER_PROCEED]", gate_id: gateId,
      ts_kst: tsKst, exchange, symbol,
      gate: "commission_gate_v2", gate_mode: gateMode, decision: "ALLOWED",
      order_intent_id: oid, event, order_skipped: false,
    }));
  }
  return { gateId, blocked };
}

function resolveCommissionSoftScale(perfGate) {
  if (!COMMISSION_GATE_ENABLED) {
    return { blocked: false, scale: 1, rawScale: 1, minScale: 1 };
  }
  const ratio = Number(perfGate && perfGate.commissionRatio);
  const threshold = Number((perfGate && perfGate.threshold) || COMMISSION_RATIO_THRESHOLD);
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(threshold) || threshold <= 0) {
    return { blocked: false, scale: 1, rawScale: 1, minScale: 1 };
  }
  const blocked = ratio > threshold;
  const rawScale = blocked ? (threshold / ratio) : 1;
  const minScale = 1 / Math.max(1, Number.isFinite(COMMISSION_RATIO_MULTIPLIER) ? COMMISSION_RATIO_MULTIPLIER : 3);
  const scale = blocked ? Math.max(minScale, Math.min(1, rawScale)) : 1;
  return { blocked, scale, rawScale, minScale };
}
// --- End Commission Gate v2 (ENFORCE) + MDD reduction gate ---

const KEY_CACHE = {
  BINANCEFUT: { apiKey: null, apiSecret: null, at: 0 },
  UPBIT: { accessKey: null, secretKey: null, at: 0 },
  KIWOOM: { appKey: null, secretKey: null, at: 0 },
};

function resolveTpP1PendingHoldMs() {
  const envRaw = Number(process.env.TP_P1_PENDING_HOLD_MS);
  if (Number.isFinite(envRaw) && envRaw > 0) return Math.round(envRaw);
  return 5 * 60 * 1000;
}

function buildIntentScopeKey(exchange, symbol, tf) {
  return `${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${String(tf || "")}`;
}

async function hasActiveTpP1PendingIntent({ exchange, symbol, tf, nowMs, scanLimit = 120 } = {}) {
  try {
    const scope = buildIntentScopeKey(exchange, symbol, tf);
    if (!scope) return false;
    const db = getFirestore();
    const checkPendingInSnap = (snap) => {
      if (!snap || snap.empty) return false;
      let found = false;
      snap.forEach((d) => {
        if (found) return;
        const x = d.data() || {};
        if (String(x.intent_scope || "") !== scope) return;
        if (String(x.status || "").toUpperCase() !== "PENDING") return;
        const ev = String(x.event || "").toUpperCase();
        if (!(ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_"))) return;
        const expMs = Number(x.expires_at_ms);
        if (Number.isFinite(expMs) && expMs <= Number(nowMs || Date.now())) return;
        found = true;
      });
      return found;
    };

    try {
      const pendingSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .where("status", "==", "PENDING")
        .limit(40)
        .get();
      if (checkPendingInSnap(pendingSnap)) return true;
    } catch (_) {}

    try {
      const scopeScan = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .orderBy("updated_at", "desc")
        .limit(Math.max(40, Number(scanLimit) || 120))
        .get();
      if (checkPendingInSnap(scopeScan)) return true;
    } catch (_) {}

    const fullScan = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, (Number(scanLimit) || 120) * 4))
      .get();
    return checkPendingInSnap(fullScan);
  } catch (_) {
    return false;
  }
}

function collectActivePendingAddIntentState(rows, {
  scope,
  nowMs,
  positionSide = null,
} = {}) {
  const refMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const normalizedSide = normalizePositionSide(positionSide);
  const docs = Array.isArray(rows) ? rows : [];
  let count = 0;
  let lastSignalBarMs = null;
  for (const row of docs) {
    const x = row && typeof row === "object" ? row : {};
    if (scope && String(x.intent_scope || "") !== scope) continue;
    if (String(x.status || "").toUpperCase() !== "PENDING") continue;
    const expMs = Number(x.expires_at_ms);
    if (Number.isFinite(expMs) && expMs <= refMs) continue;
    const intent = intentFromSignal({
      event: x.event,
      side: x.side,
      features: x.features_json,
    });
    if (intent !== "ADD") continue;
    const intentDir = directionFromSignal({ event: x.event, side: x.side });
    if (normalizedSide && intentDir && normalizedSide !== intentDir) continue;
    count += 1;
    const signalBarMs = Number(x.signal_bar_close_time_utc_ms);
    if (Number.isFinite(signalBarMs)) {
      lastSignalBarMs = Number.isFinite(lastSignalBarMs)
        ? Math.max(lastSignalBarMs, signalBarMs)
        : signalBarMs;
    }
  }
  return { count, lastSignalBarMs };
}

async function getActivePendingAddIntentState({
  exchange,
  symbol,
  tf,
  positionSide = null,
  nowMs,
  scanLimit = 120,
} = {}) {
  try {
    const scope = buildIntentScopeKey(exchange, symbol, tf);
    if (!scope) return { count: 0, lastSignalBarMs: null };
    const db = getFirestore();
    const collectState = (snap) => {
      if (!snap || snap.empty) return { count: 0, lastSignalBarMs: null };
      return collectActivePendingAddIntentState(
        snap.docs.map((d) => d.data() || {}),
        { scope, nowMs, positionSide }
      );
    };

    try {
      const pendingSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .where("status", "==", "PENDING")
        .limit(40)
        .get();
      const state = collectState(pendingSnap);
      if (state.count > 0) return state;
    } catch (_) {}

    try {
      const scopeScan = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .orderBy("updated_at", "desc")
        .limit(Math.max(40, Number(scanLimit) || 120))
        .get();
      const state = collectState(scopeScan);
      if (state.count > 0) return state;
    } catch (_) {}

    const fullScan = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, (Number(scanLimit) || 120) * 4))
      .get();
    return collectState(fullScan);
  } catch (_) {
    return { count: 0, lastSignalBarMs: null };
  }
}

async function getTpP1PendingState({
  exchange,
  symbol,
  tf,
  posMeta,
  tpP1PendingHoldMs,
  nowMs,
} = {}) {
  const refMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const pendingAtMsRaw = Number(posMeta && posMeta.tp_p1_pending_at_ms);
  const pendingUntilMsRaw = Number(posMeta && posMeta.tp_p1_pending_until_ms);
  const fallbackPendingUntilMs = Number.isFinite(pendingAtMsRaw)
    ? (pendingAtMsRaw + Number(tpP1PendingHoldMs || 0))
    : NaN;
  const pendingUntilMsEff = Number.isFinite(pendingUntilMsRaw) ? pendingUntilMsRaw : fallbackPendingUntilMs;
  const activeByTime = Number.isFinite(pendingUntilMsEff) ? (refMs <= pendingUntilMsEff) : false;
  let activeByIntent = false;
  if (!activeByTime) {
    activeByIntent = await hasActiveTpP1PendingIntent({ exchange, symbol, tf, nowMs: refMs });
  }
  return {
    active: activeByTime || activeByIntent,
    activeByIntent,
    pendingAtMs: Number.isFinite(pendingAtMsRaw) ? pendingAtMsRaw : null,
    pendingUntilMs: Number.isFinite(pendingUntilMsEff) ? pendingUntilMsEff : null,
  };
}

function addMs(ms, deltaMs) {
  return Number(ms) + Number(deltaMs);
}

function msToUtcZ(ms) {
  return new Date(Number(ms)).toISOString();
}

async function consumeDroppedSignals({ drops, runId, execBarCloseMs, execBarCloseUtc } = {}) {
  if (!Array.isArray(drops) || drops.length === 0) return;
  const consumedAtIso = new Date().toISOString();
  for (const d of drops) {
    if (!d || !d.signal_id) continue;
    try {
      const lock = await tryLockSignal({ signalId: d.signal_id, runId });
      if (lock && lock.ok) {
        await markSignalConsumed({
          signalId: d.signal_id,
          runId,
          consumedAtIso,
          execBarCloseMs,
          execBarCloseUtc,
          reason: d.drop_reason_code || d.reason || "DROP",
        });
      }
    } catch (_) {}
  }
}

function buildEntryEventId({ exchange, symbol, tf, signalBarCloseMs, event }) {
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim();
  const tf0 = String(tf || "").trim();
  const ms = Number(signalBarCloseMs);
  const ev = normalizeEvent(event);
  if (!ex || !sym || !tf0 || !Number.isFinite(ms) || !ev) return null;
  return `${ex}|${sym}|${tf0}|${ms}|${ev}|${ev}`;
}

function resolveSignalDocIdForIntent({ exchange, symbol, tf, barCloseMs, event, signalId, features }) {
  const docId = deriveSignalDocId({
    exchange,
    symbol,
    tf,
    barCloseMs,
    event,
    signalId,
  });
  if (docId && features && !features.signal_doc_id) {
    features.signal_doc_id = docId;
  }
  return docId;
}

function computeTrailingMetaUpdate({ exchange, bar, position, posMeta, positionSideFallback }) {
  if (!position || String(position.state || "").toUpperCase() !== "ACTIVE") return null;
  if (!posMeta || posMeta.tp_p1_done !== true) return null;
  const posWithMeta = { ...(position || {}), meta: posMeta };
  const rules = resolveExitRulesForPosition({ exchange, position: posWithMeta });
  if (
    !Number.isFinite(Number(rules && rules.TRAIL_R_MULTIPLE))
    && !Number.isFinite(Number(rules && rules.TRAIL_PCT))
  ) return null;
  const closePx = Number(bar && (bar.close ?? bar.closePrice ?? bar.c));
  if (!Number.isFinite(closePx)) return null;
  const side = String(
    position.position_side ||
    position.positionSide ||
    position.side ||
    positionSideFallback ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side)) ||
    "LONG"
  ).toUpperCase();
  const updates = {};
  if (side === "SHORT") {
    const prevLow = Number(posMeta.trail_low);
    const nextLow = Number.isFinite(prevLow) ? Math.min(prevLow, closePx) : closePx;
    if (!Number.isFinite(prevLow) || nextLow !== prevLow) updates.trail_low = nextLow;
  } else {
    const prevHigh = Number(posMeta.trail_high);
    const nextHigh = Number.isFinite(prevHigh) ? Math.max(prevHigh, closePx) : closePx;
    if (!Number.isFinite(prevHigh) || nextHigh !== prevHigh) updates.trail_high = nextHigh;
  }
  if (!posMeta.trail_active) updates.trail_active = true;
  if (!Object.keys(updates).length) return null;
  return updates;
}

function pickMarketOverride(map, symbol, fallback) {
  if (!map || typeof map !== "object") return fallback;
  if (symbol && map[symbol] != null) return Number(map[symbol]);
  return fallback;
}

function clamp(num, min, max) {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeFuturesLeverage(raw, maxLev = 3) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  const rounded = Math.round(n);
  return clamp(rounded, 1, Number.isFinite(maxLev) && maxLev > 0 ? maxLev : 2) || 1;
}

function parseUpperList(raw, fallback = []) {
  const src = raw == null ? fallback : raw;
  const list = Array.isArray(src) ? src : String(src || "").split(/[,\s]+/);
  const out = [];
  for (const v of list) {
    const s = String(v || "").trim().toUpperCase();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function parseChannelList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function filterTelegramChannels(raw) {
  return parseChannelList(raw)
    .filter((v) => /^telegram:|^tg:|^telegram:\/\//i.test(String(v || "").trim()))
    .join(",");
}

function formatAlertNumber(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "NA";
  const abs = Math.abs(n);
  const precision = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : digits;
  return n.toFixed(precision).replace(/\.?0+$/, "");
}

function formatRatioPctToken(value, { abs = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = (abs ? Math.abs(n) : n) * 100;
  const fixed = pct >= 10 ? pct.toFixed(2) : pct.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
}

function formatExitRulesCompactLocal(exitRules) {
  if (!exitRules || typeof exitRules !== "object") return null;
  const parts = [];
  const sl = formatRatioPctToken(exitRules.SL, { abs: true });
  const tp1 = formatRatioPctToken(exitRules.TP_P1);
  const trailR = Number(exitRules.TRAIL_R_MULTIPLE);
  const trail = Number.isFinite(trailR) && trailR > 0
    ? `${String(trailR).replace(/\.?0+$/, "")}R`
    : formatRatioPctToken(exitRules.TRAIL_PCT);
  const runnerMin = formatRatioPctToken(exitRules.RUNNER_MIN_PROFIT_PCT);
  const be = formatRatioPctToken(exitRules.BE_PCT);
  if (sl) parts.push(`SL_${sl}`);
  if (tp1) parts.push(`TP1_${tp1}`);
  if (trail) parts.push(`TRAIL_${trail}`);
  if (runnerMin) parts.push(`RUNNER_MIN_${runnerMin}`);
  if (be) parts.push(`BE_${be}`);
  return parts.length ? parts.join(" / ") : null;
}

function sleepMs(ms) {
  const waitMs = Number(ms);
  if (!Number.isFinite(waitMs) || waitMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function normalizeFuturesSymbolKey(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  return s.replace(/\.P$/, "");
}

function isPrimaryLongShortEventName(event) {
  const ev = String(event || "").toUpperCase();
  return ev === "LONG" || ev === "SHORT";
}

function buildEntryTierContext(event, features) {
  return {
    event,
    features: (features && typeof features === "object") ? features : {},
  };
}

function isPreRealEventName(event) {
  const ev = String(event || "").toUpperCase();
  return ev.startsWith("PRE_REAL_");
}

function resolveSignalQtyProfile(event, features) {
  const qtyProfile = resolveEntryQtyProfile(buildEntryTierContext(event, features));
  return qtyProfile || null;
}

function isFixedQtyProfileSignal(event, features) {
  return resolveSignalQtyProfile(event, features) === "FIXED";
}

function applyEvQtyScale({
  qtyFraction,
  evScale,
  intent,
  event,
  features,
} = {}) {
  const baseQtyFraction = Number(qtyFraction);
  const suggestedScale = Number(evScale);
  const entryIntent = String(intent || "").toUpperCase();
  const qtyProfile = resolveSignalQtyProfile(event, features);
  const scaleReducing = Number.isFinite(suggestedScale) && suggestedScale > 0 && suggestedScale < 0.9999;
  if (!scaleReducing || !Number.isFinite(baseQtyFraction) || baseQtyFraction <= 0) {
    return {
      qtyFraction: baseQtyFraction,
      appliedScale: 1,
      suggestedScale,
      suggestedQtyFraction: baseQtyFraction,
      suppressedForFixed: false,
      qtyProfile,
    };
  }
  const suggestedQtyFraction = baseQtyFraction * suggestedScale;
  const suppressForFixed = (entryIntent === "ENTRY" || entryIntent === "ADD")
    && qtyProfile === "FIXED";
  return {
    qtyFraction: suppressForFixed ? baseQtyFraction : suggestedQtyFraction,
    appliedScale: suppressForFixed ? 1 : suggestedScale,
    suggestedScale,
    suggestedQtyFraction,
    suppressedForFixed: suppressForFixed,
    qtyProfile,
  };
}

function restoreFixedEntryQtyFraction({
  qtyFraction,
  intent,
  event,
  features,
} = {}) {
  const entryIntent = String(intent || "").toUpperCase();
  const currentQtyFraction = Number(qtyFraction);
  const qtyProfile = resolveSignalQtyProfile(event, features);
  if ((entryIntent !== "ENTRY" && entryIntent !== "ADD") || qtyProfile !== "FIXED") {
    return {
      qtyFraction: currentQtyFraction,
      restored: false,
      originalQtyFraction: currentQtyFraction,
      qtyProfile,
    };
  }
  const evBaseQtyFraction = Number(
    (features && (features.ev_gate_qty_before ?? features.market_ev_base_qty))
  );
  if (!Number.isFinite(evBaseQtyFraction) || evBaseQtyFraction <= 0) {
    return {
      qtyFraction: currentQtyFraction,
      restored: false,
      originalQtyFraction: currentQtyFraction,
      qtyProfile,
    };
  }
  if (Number.isFinite(currentQtyFraction) && evBaseQtyFraction <= currentQtyFraction) {
    return {
      qtyFraction: currentQtyFraction,
      restored: false,
      originalQtyFraction: currentQtyFraction,
      qtyProfile,
    };
  }
  return {
    qtyFraction: normalizeQtyFraction(evBaseQtyFraction),
    restored: true,
    originalQtyFraction: currentQtyFraction,
    qtyProfile,
  };
}

function isPreRealQtyProfileEvent(event, features) {
  return false;
}

function isEarlyEventName(event, features) {
  const ev = String(event || "").toUpperCase();
  if (isPrimaryLongShortEventName(ev)) {
    return resolveEntryTimingTier(buildEntryTierContext(ev, features)) === "EARLY";
  }
  return ev.startsWith("EARLY_");
}

function isEmoEventName(event) {
  const ev = String(event || "").toUpperCase();
  return ev.startsWith("EMO_");
}

function isPreRealOrEarlyEventName(event, features) {
  return isEarlyEventName(event, features);
}

function resolveSignalTier(event, features) {
  const tier = resolveEntryTimingTier(buildEntryTierContext(event, features));
  if (tier) return tier;
  if (isEmoEventName(event)) return "EMO";
  return null;
}

function resolvePositionLeverage({ position, fallback = 1 } = {}) {
  const pos = position || {};
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const lev = Number(
    meta.leverage ??
    meta.external_leverage ??
    pos.leverage ??
    (pos.meta && pos.meta.futures_leverage) ??
    fallback
  );
  return normalizeFuturesLeverage(lev, 3);
}

function resolveBudgetUsedFromNotional({ notional, leverage } = {}) {
  const notionalNum = Number(notional);
  if (!Number.isFinite(notionalNum) || notionalNum <= 0) return 0;
  const lev = normalizeFuturesLeverage(Number(leverage), 3);
  return notionalNum / (Number.isFinite(lev) && lev > 0 ? lev : 1);
}

function resolveBinanceBudgetUsedKrw({ position, riskBudget, notionalFallback = null, priceFallback = null, qtyBaseFallback = null } = {}) {
  const pos = position || {};
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const qtyBase = Number.isFinite(Number(qtyBaseFallback)) && Number(qtyBaseFallback) > 0
    ? Number(qtyBaseFallback)
    : Number(pos.qty_base ?? meta.qty_base ?? meta.external_qty_base);
  const priceRef = Number.isFinite(Number(priceFallback)) && Number(priceFallback) > 0
    ? Number(priceFallback)
    : Number(pos.avg_price ?? meta.external_entry_price ?? meta.external_mark_price);
  const leverage = resolvePositionLeverage({ position: pos, fallback: 1 });
  const notional = Number.isFinite(Number(notionalFallback)) && Number(notionalFallback) > 0
    ? Number(notionalFallback)
    : ((Number.isFinite(qtyBase) && qtyBase > 0 && Number.isFinite(priceRef) && priceRef > 0) ? (qtyBase * priceRef) : null);
  if (Number.isFinite(notional) && notional > 0) {
    return resolveBudgetUsedFromNotional({ notional, leverage });
  }

  const symbol = String(pos.symbol_or_pair_id || pos.symbol || "").toUpperCase();
  const perMarketMax = Number(
    pos.budget_max_krw ??
    (riskBudget && riskBudget.byMarket && riskBudget.byMarket[symbol]) ??
    (riskBudget && riskBudget.maxKrw) ??
    0
  );
  const stored = Number(pos.budget_used_krw);
  if (Number.isFinite(stored) && stored > 0) {
    if (!Number.isFinite(perMarketMax) || perMarketMax <= 0 || stored <= (perMarketMax * 1.05)) {
      return stored;
    }
  }
  const sizePct = Number(pos.size_pct);
  if (Number.isFinite(sizePct) && sizePct > 0 && Number.isFinite(perMarketMax) && perMarketMax > 0) {
    return Math.min(perMarketMax, Math.max(0, sizePct) * perMarketMax);
  }
  return 0;
}

function resolveTfFromMs(ms) {
  const tfNum = Number(ms);
  if (!Number.isFinite(tfNum) || tfNum <= 0) return null;
  const known = ["15m", "30m", "60m"];
  for (const tf of known) {
    if (tfToMs(tf) === tfNum) return tf;
  }
  return null;
}

function pickSignalPosterior(features, dir) {
  if (!features || typeof features !== "object") return null;
  const side = String(dir || "").toUpperCase();
  const longKeys = ["zz_post_prob_long", "post_prob_long", "posterior_long", "posterior_long_prob"];
  const shortKeys = ["zz_post_prob_short", "post_prob_short", "posterior_short", "posterior_short_prob"];
  const genericKeys = ["posterior", "post_prob", "posterior_prob"];
  const keys = side === "SHORT" ? shortKeys : longKeys;

  const parse01 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n >= 0 && n <= 1) return n;
    if (n >= 0 && n <= 100) return n / 100;
    return null;
  };

  for (const k of [...keys, ...genericKeys]) {
    const n = parse01(features[k]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function computePnlStats(trades, sinceMs) {
  const rows = Array.isArray(trades) ? trades : [];
  let pnl = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let tradesN = 0;
  for (const t of rows) {
    const closeMs = Number(t && t.close_ms);
    if (!Number.isFinite(closeMs) || closeMs < sinceMs) continue;
    const v = Number(t && t.pnl_krw);
    if (!Number.isFinite(v)) continue;
    tradesN += 1;
    pnl += v;
    if (v > 0) grossProfit += v;
    else if (v < 0) grossLossAbs += Math.abs(v);
  }
  let pf = 0;
  if (grossLossAbs > 0) pf = grossProfit / grossLossAbs;
  else if (grossProfit > 0) pf = 99;
  return { trades: tradesN, pnl, pf, grossProfit, grossLossAbs };
}

const FUTURES_DYNAMIC_3X_ENABLED = String(process.env.FUTURES_DYNAMIC_3X_ENABLED || "1") !== "0";
const FUTURES_BASE_LEVERAGE = normalizeFuturesLeverage(Number(process.env.FUTURES_BASE_LEVERAGE || 2), 3);
// Active runtime is LONG/SHORT + FIXED qty. Legacy tier budget auto-scaling stays disabled.
const FUTURES_ENTRY_TIER_BUDGET_AUTO_SCALE = false;
const FUTURES_ENTRY_TIER_TARGET_MODE = "FIXED";
const FUTURES_ACTIVE_FIXED_MARGIN_TARGET = Number.isFinite(Number(process.env.FUTURES_ACTIVE_FIXED_MARGIN_TARGET))
  ? Number(process.env.FUTURES_ACTIVE_FIXED_MARGIN_TARGET)
  : 1000;
const FUTURES_3X_BASE_WHITELIST = new Set(parseUpperList(
  process.env.FUTURES_3X_BASE_WHITELIST,
  ["BNBUSDT", "SOLUSDT"]
).map(normalizeFuturesSymbolKey));
const FUTURES_3X_REAL_CONF_MIN = Number.isFinite(Number(process.env.FUTURES_3X_REAL_CONF_MIN))
  ? Number(process.env.FUTURES_3X_REAL_CONF_MIN)
  : 0.70;
const FUTURES_3X_REAL_POST_MIN = Number.isFinite(Number(process.env.FUTURES_3X_REAL_POST_MIN))
  ? Number(process.env.FUTURES_3X_REAL_POST_MIN)
  : 0.62;
const FUTURES_3X_CORE_CONF_MIN = Number.isFinite(Number(process.env.FUTURES_3X_CORE_CONF_MIN))
  ? Number(process.env.FUTURES_3X_CORE_CONF_MIN)
  : 0.78;
const FUTURES_3X_CORE_POST_MIN = Number.isFinite(Number(process.env.FUTURES_3X_CORE_POST_MIN))
  ? Number(process.env.FUTURES_3X_CORE_POST_MIN)
  : 0.66;
const FUTURES_3X_KILL_PF_MIN_7D = Number.isFinite(Number(process.env.FUTURES_3X_KILL_PF_MIN_7D))
  ? Number(process.env.FUTURES_3X_KILL_PF_MIN_7D)
  : 1.0;
const FUTURES_3X_RECOVER_PF_MIN_7D = Number.isFinite(Number(process.env.FUTURES_3X_RECOVER_PF_MIN_7D))
  ? Number(process.env.FUTURES_3X_RECOVER_PF_MIN_7D)
  : 1.0;
const FUTURES_3X_PROMOTE_TRADES_MIN_14D = Math.max(1, Math.floor(Number(process.env.FUTURES_3X_PROMOTE_TRADES_MIN_14D || 10)));
const FUTURES_3X_PROMOTE_PF_MIN_14D = Number.isFinite(Number(process.env.FUTURES_3X_PROMOTE_PF_MIN_14D))
  ? Number(process.env.FUTURES_3X_PROMOTE_PF_MIN_14D)
  : 1.2;
const FUTURES_3X_PROMOTE_PF_MIN_7D = Number.isFinite(Number(process.env.FUTURES_3X_PROMOTE_PF_MIN_7D))
  ? Number(process.env.FUTURES_3X_PROMOTE_PF_MIN_7D)
  : 1.05;
const FUTURES_3X_STREAK_REQUIRED = Math.max(1, Math.floor(Number(process.env.FUTURES_3X_STREAK_REQUIRED || 2)));
const FUTURES_3X_STREAK_MIN_INTERVAL_MS = Math.max(60 * 1000, Math.floor(Number(process.env.FUTURES_3X_STREAK_MIN_INTERVAL_MS || (2 * 60 * 60 * 1000))));
const FUTURES_3X_COOLDOWN_MS = Math.max(60 * 1000, Math.floor(Number(process.env.FUTURES_3X_COOLDOWN_MS || (72 * 60 * 60 * 1000))));
const FUTURES_3X_STATS_LOOKBACK_DAYS = Math.max(7, Math.floor(Number(process.env.FUTURES_3X_STATS_LOOKBACK_DAYS || 14)));
const FUTURES_3X_STATS_LIMIT = Math.max(500, Math.floor(Number(process.env.FUTURES_3X_STATS_LIMIT || 5000)));
const FUTURES_3X_STATS_HARD_MAX = Math.max(FUTURES_3X_STATS_LIMIT, Math.floor(Number(process.env.FUTURES_3X_STATS_HARD_MAX || 12000)));
const FUTURES_3X_STATS_CACHE_TTL_MS = Math.max(30 * 1000, Math.floor(Number(process.env.FUTURES_3X_STATS_CACHE_TTL_MS || (10 * 60 * 1000))));
const FUTURES_DYNAMIC_EXIT_PROFILE_ENABLED = String(process.env.FUTURES_DYNAMIC_EXIT_PROFILE_ENABLED || "1") !== "0";
const FUTURES_EXIT_PROFILE_BASE = Object.freeze({
  key: "BASE",
  rules: {
    SL: -0.0165,
    TP_P1: 0.0325,
    TP_P1_QTY: 0.5,
    TP_C: null,
    BE_ENABLE: true,
    BE_PCT: 0.0025,
    TRAIL_PCT: 0.01,
    RUNNER_MIN_PROFIT_PCT: 0.02,
  },
});
const FUTURES_EXIT_PROFILE_AGGRESSIVE = Object.freeze({
  key: "AGGRESSIVE",
  rules: {
    SL: -0.02,
    TP_P1: 0.03,
    TP_P1_QTY: 0.5,
    TP_C: null,
    BE_ENABLE: true,
    BE_PCT: 0.0025,
    TRAIL_PCT: 0.015,
    RUNNER_MIN_PROFIT_PCT: 0.02,
  },
});
const FUTURES_EXIT_PROFILE_REAL_CONF_MIN = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_REAL_CONF_MIN))
  ? Number(process.env.FUTURES_EXIT_PROFILE_REAL_CONF_MIN)
  : FUTURES_3X_REAL_CONF_MIN;
const FUTURES_EXIT_PROFILE_REAL_POST_MIN = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_REAL_POST_MIN))
  ? Number(process.env.FUTURES_EXIT_PROFILE_REAL_POST_MIN)
  : FUTURES_3X_REAL_POST_MIN;
const FUTURES_EXIT_PROFILE_CORE_CONF_MIN = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_CORE_CONF_MIN))
  ? Number(process.env.FUTURES_EXIT_PROFILE_CORE_CONF_MIN)
  : FUTURES_3X_CORE_CONF_MIN;
const FUTURES_EXIT_PROFILE_CORE_POST_MIN = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_CORE_POST_MIN))
  ? Number(process.env.FUTURES_EXIT_PROFILE_CORE_POST_MIN)
  : FUTURES_3X_CORE_POST_MIN;
const FUTURES_EXIT_PROFILE_ROLLBACK_ENABLED = String(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_ENABLED || "1") !== "0";
const FUTURES_EXIT_PROFILE_ROLLBACK_MIN_TRADES_3D = Math.max(1, Math.floor(Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_MIN_TRADES_3D || 3)));
const FUTURES_EXIT_PROFILE_ROLLBACK_PNL_MIN_3D = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_PNL_MIN_3D))
  ? Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_PNL_MIN_3D)
  : 0;
const FUTURES_EXIT_PROFILE_ROLLBACK_PF_MIN_3D = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_PF_MIN_3D))
  ? Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_PF_MIN_3D)
  : 0.95;
const FUTURES_EXIT_PROFILE_RECOVER_MIN_TRADES_3D = Math.max(1, Math.floor(Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_MIN_TRADES_3D || 3)));
const FUTURES_EXIT_PROFILE_RECOVER_PNL_MIN_3D = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_PNL_MIN_3D))
  ? Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_PNL_MIN_3D)
  : 0;
const FUTURES_EXIT_PROFILE_RECOVER_PF_MIN_3D = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_PF_MIN_3D))
  ? Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_PF_MIN_3D)
  : 1.02;
const FUTURES_EXIT_PROFILE_ROLLBACK_COOLDOWN_MS = Math.max(10 * 60 * 1000, Math.floor(Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_COOLDOWN_MS || (72 * 60 * 60 * 1000))));
const BINANCE_NATIVE_PROTECTION_ENABLED = String(process.env.BINANCE_NATIVE_PROTECTION_ENABLED || "1") !== "0";
const BINANCE_NATIVE_TP_ENABLED = String(process.env.BINANCE_NATIVE_TP_ENABLED || "1") !== "0";
const BINANCE_NATIVE_WORKING_TYPE = String(process.env.BINANCE_NATIVE_WORKING_TYPE || "MARK_PRICE").trim() || "MARK_PRICE";
const BINANCE_NATIVE_PRICE_PROTECT = String(process.env.BINANCE_NATIVE_PRICE_PROTECT || "1") !== "0";
const BINANCE_NATIVE_PROTECTION_RETRY_COUNT = Math.max(0, Math.min(5, Math.floor(Number(process.env.BINANCE_NATIVE_PROTECTION_RETRY_COUNT || 1))));
const BINANCE_NATIVE_PROTECTION_RETRY_DELAY_MS = Math.max(0, Math.floor(Number(process.env.BINANCE_NATIVE_PROTECTION_RETRY_DELAY_MS || 1200)));
const BINANCE_NATIVE_ALERT_ENABLED = String(process.env.BINANCE_NATIVE_ALERT_ENABLED || "1") !== "0";
const BINANCE_NATIVE_ALERT_TELEGRAM_ONLY = String(process.env.BINANCE_NATIVE_ALERT_TELEGRAM_ONLY || "1") !== "0";
const BINANCE_NATIVE_ALERT_CHANNEL_CACHE_MS = Math.max(5000, Math.floor(Number(process.env.BINANCE_NATIVE_ALERT_CHANNEL_CACHE_MS || 30000)));
const BINANCE_NATIVE_ALERT_COOLDOWN_MS = Math.max(10000, Math.floor(Number(process.env.BINANCE_NATIVE_ALERT_COOLDOWN_MS || 60000)));
const futures3xStatsCache = new Map();
const futures3xState = new Map();
const futuresExitProfileState = new Map();
const nativeProtectionAlertChannelCache = new Map();
const nativeProtectionAlertCooldownMap = new Map();

function cloneExitRules(rules) {
  return { ...(rules && typeof rules === "object" ? rules : {}) };
}

function resolveStructureInitialStopPrice({ avgPrice, side, features, nativeProtectionStopPrice } = {}) {
  const avg = Number(avgPrice);
  const sideUpper = String(side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const f = (features && typeof features === "object") ? features : {};
  const featureStop = Number(
    f.stop_price
    ?? f.stopPrice
    ?? f.entry_stop_price
    ?? f.entryStopPrice
  );
  const nativeStop = Number(nativeProtectionStopPrice);
  const candidates = [featureStop, nativeStop];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate) || !Number.isFinite(avg) || avg <= 0) continue;
    if (sideUpper === "SHORT" && candidate > avg) return candidate;
    if (sideUpper === "LONG" && candidate < avg) return candidate;
  }
  return null;
}

function resolveInitialStopSource({ avgPrice, side, features, nativeProtectionStopPrice } = {}) {
  const structureStop = resolveStructureInitialStopPrice({ avgPrice, side, features, nativeProtectionStopPrice });
  if (!Number.isFinite(structureStop)) return "LEVERAGED_SL_FALLBACK";
  const featureStop = Number(
    features && (
      features.stop_price
      ?? features.stopPrice
      ?? features.entry_stop_price
      ?? features.entryStopPrice
    )
  );
  if (Number.isFinite(featureStop) && Math.abs(featureStop - structureStop) <= 1e-9) return "STRUCTURE_STOP_FEATURE";
  const nativeStop = Number(nativeProtectionStopPrice);
  if (Number.isFinite(nativeStop) && Math.abs(nativeStop - structureStop) <= 1e-9) return "STRUCTURE_STOP_NATIVE";
  return "LEVERAGED_SL_FALLBACK";
}

function isExitMetaLinkedToEntry({
  entryEventId = null,
  exitEntryEventId = null,
  entryExecMs = null,
  exitEntryExecMs = null,
  exitAtMs = null,
} = {}) {
  const entryId = String(entryEventId || "").trim();
  const exitEntryId = String(exitEntryEventId || "").trim();
  const entryMs = Number(entryExecMs);
  const linkedEntryMs = Number(exitEntryExecMs);
  const exitMs = Number(exitAtMs);
  let linkedToEntry = true;
  if (entryId && exitEntryId && entryId !== exitEntryId) linkedToEntry = false;
  if (linkedToEntry && Number.isFinite(entryMs)) {
    if (Number.isFinite(linkedEntryMs)) {
      if (Math.abs(linkedEntryMs - entryMs) > 1000) linkedToEntry = false;
    } else if (Number.isFinite(exitMs) && (exitMs + 30000) < entryMs) {
      linkedToEntry = false;
    }
  }
  return linkedToEntry;
}

function computeExitTriggerPrice({ avgPrice, leverage, side, pnlPct } = {}) {
  const px = Number(avgPrice);
  const levRaw = Number(leverage);
  const lev = Number.isFinite(levRaw) && levRaw > 0 ? levRaw : 1;
  const pct = Number(pnlPct);
  const sideUpper = String(side || "").toUpperCase();
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(pct)) return null;
  const move = pct / lev;
  if (sideUpper === "SHORT") {
    const den = 1 + move;
    return den > 0 ? (px / den) : null;
  }
  return px * (1 + move);
}

function computeTpP1TargetPrice({ exchange, position, posMeta, fillPrice } = {}) {
  const rules = resolveExitRulesForPosition({
    exchange,
    position: position || { meta: posMeta || {} },
  });
  const side = normalizePositionSide(
    (position && (position.position_side || position.side))
    || (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  ) || "LONG";
  const entryPrice = Number(
    (position && position.avg_price)
    ?? (posMeta && (posMeta.external_entry_price ?? posMeta.entry_price))
  );
  const leverage = resolvePositionLeverage({ position, fallback: posMeta && posMeta.external_leverage });
  const targetPrice = computeExitTriggerPrice({
    avgPrice: entryPrice,
    leverage,
    side,
    pnlPct: Number(rules && rules.TP_P1),
  });
  return Number.isFinite(targetPrice) ? targetPrice : (Number.isFinite(Number(fillPrice)) ? Number(fillPrice) : null);
}

function computeInitialStopPriceForEntry({ avgPrice, leverage, side, slRatio, features, nativeProtectionStopPrice } = {}) {
  const structureStop = resolveStructureInitialStopPrice({
    avgPrice,
    side,
    features,
    nativeProtectionStopPrice,
  });
  if (Number.isFinite(structureStop)) return structureStop;
  const avg = Number(avgPrice);
  const lev = Number(leverage);
  const sl = Number(slRatio);
  const sideUpper = String(side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(lev) || lev <= 0 || !Number.isFinite(sl)) return null;
  const pnlPct = sl / lev;
  if (sideUpper === "SHORT") return avg * (1 - pnlPct);
  return avg * (1 + pnlPct);
}

function buildExitProfileDecision(profile, reason, extra = {}) {
  const base = profile && profile.rules ? profile : FUTURES_EXIT_PROFILE_BASE;
  return {
    profile: base.key,
    reason,
    rules: cloneExitRules(base.rules),
    ...extra,
  };
}

function applySignalExitPolicyOverrides(exitRules, features) {
  const nextRules = cloneExitRules(exitRules);
  const f = (features && typeof features === "object") ? features : {};
  const exitPolicySrc = String(f.exit_policy_source || "").trim().toUpperCase();
  if (!exitPolicySrc || exitPolicySrc === "BINANCE_DEFAULT") return nextRules;
  const dynSl = Number(f.exit_policy_sl_pct);
  const dynTp1 = Number(f.exit_policy_tp1_pct);
  const dynBe = Number(f.exit_policy_be_pct);
  const dynTrail = Number(f.exit_policy_trail_pct);
  const dynTrailR = Number(f.exit_policy_trail_r_multiple);
  const dynRunnerMin = Number(
    f.exit_policy_runner_min_profit_pct ??
    f.exit_policy_runner_floor_pct ??
    f.exit_policy_runner_min_pct
  );
  if (Number.isFinite(dynSl) && dynSl > 0) {
    nextRules.SL = -(dynSl / 100);
  }
  if (Number.isFinite(dynTp1) && dynTp1 > 0) {
    nextRules.TP_P1 = dynTp1 / 100;
  }
  if (Number.isFinite(dynBe) && dynBe >= 0) {
    nextRules.BE_ENABLE = true;
    nextRules.BE_PCT = dynBe / 100;
  }
  if (Number.isFinite(dynTrail) && dynTrail > 0) {
    nextRules.TRAIL_PCT = dynTrail / 100;
  }
  if (Number.isFinite(dynTrailR) && dynTrailR > 0) {
    nextRules.TRAIL_R_MULTIPLE = dynTrailR;
  }
  if (Number.isFinite(dynRunnerMin) && dynRunnerMin > 0) {
    nextRules.RUNNER_MIN_PROFIT_PCT = dynRunnerMin / 100;
  }
  return nextRules;
}

function applyEntryExitRuleRuntimeAdjustments({
  rules = null,
  features = null,
  positionMeta = null,
  sysCfg = null,
  cohort = null,
  market = null,
} = {}) {
  let appliedExitRules = cloneExitRules(rules || FUTURES_EXIT_PROFILE_BASE.rules);
  const f = (features && typeof features === "object") ? features : {};
  const metaSafe = (positionMeta && typeof positionMeta === "object") ? positionMeta : {};
  const exitPolicySrc = String(f.exit_policy_source || metaSafe.exit_policy_source || "").trim().toUpperCase();
  const hasExplicitExitPolicy = !!(exitPolicySrc && exitPolicySrc !== "BINANCE_DEFAULT");
  let tp1LadderState = null;

  if (hasExplicitExitPolicy) {
    const dynSl = Number(f.exit_policy_sl_pct);
    const dynTp1 = Number(f.exit_policy_tp1_pct);
    const dynBe = Number(f.exit_policy_be_pct);
    const dynTrail = Number(f.exit_policy_trail_pct);
    const dynTrailR = Number(f.exit_policy_trail_r_multiple);
    const dynRunnerMin = Number(
      f.exit_policy_runner_min_profit_pct
      ?? f.exit_policy_runner_floor_pct
      ?? f.exit_policy_runner_min_pct
    );
    if (Number.isFinite(dynSl) && dynSl > 0) {
      appliedExitRules.SL = -(dynSl / 100);
    }
    if (Number.isFinite(dynTp1) && dynTp1 > 0) {
      appliedExitRules.TP_P1 = dynTp1 / 100;
    }
    if (Number.isFinite(dynBe) && dynBe >= 0) {
      appliedExitRules.BE_ENABLE = true;
      appliedExitRules.BE_PCT = dynBe / 100;
    }
    if (Number.isFinite(dynTrail) && dynTrail > 0) {
      appliedExitRules.TRAIL_PCT = dynTrail / 100;
    }
    if (Number.isFinite(dynTrailR) && dynTrailR > 0) {
      appliedExitRules.TRAIL_R_MULTIPLE = dynTrailR;
    }
    if (Number.isFinite(dynRunnerMin) && dynRunnerMin > 0) {
      appliedExitRules.RUNNER_MIN_PROFIT_PCT = dynRunnerMin / 100;
    }
  } else {
    const resolvedCohort = normalizeOpenClawCohort(
      cohort
      || f.openclaw_market_regime_cohort
      || f.market_regime_cohort
      || metaSafe.openclaw_market_regime_cohort
      || metaSafe.market_regime_cohort
    ) || "BASE";
    tp1LadderState = resolveTp1LadderRuntimeState({
      sysCfg,
      cohort: resolvedCohort,
      market: market || f.symbol || f.market || metaSafe.symbol || metaSafe.market || null,
    });
    if (tp1LadderState) {
      appliedExitRules = applyTp1LadderPolicy({
        rules: appliedExitRules,
        cohort: resolvedCohort,
        ladderState: tp1LadderState,
      });
    }
  }

  return {
    exitPolicySrc: exitPolicySrc || null,
    hasExplicitExitPolicy,
    tp1LadderState,
    appliedExitRules,
  };
}

function shouldRepairActiveExitRuntimeState({
  positionSide = null,
  entryPrice = null,
  posMeta = null,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const side = normalizePositionSide(positionSide || metaSafe.position_side || metaSafe.external_side || metaSafe.native_protection_side);
  if (!side) return false;
  const nativeSide = normalizePositionSide(metaSafe.native_protection_side);
  if (nativeSide && nativeSide !== side) return true;

  const avgPrice = Number(entryPrice);
  const nativeEntryPrice = Number(metaSafe.native_protection_entry_price);
  if (Number.isFinite(avgPrice) && avgPrice > 0 && Number.isFinite(nativeEntryPrice) && nativeEntryPrice > 0) {
    const relDiff = Math.abs(nativeEntryPrice - avgPrice) / avgPrice;
    if (relDiff > 0.0005) return true;
  }

  const rules = (metaSafe.exit_rules_override && typeof metaSafe.exit_rules_override === "object")
    ? metaSafe.exit_rules_override
    : null;
  if (collectCriticalExitRuleViolations({ rules }).length > 0) return true;

  return false;
}

function collectCriticalExitRuleViolations({ rules = null } = {}) {
  const ruleSafe = (rules && typeof rules === "object") ? rules : {};
  const violations = [];
  const tp0 = Number(ruleSafe.TP_P0);
  const tp0Qty = Number(ruleSafe.TP_P0_QTY);
  const tp1 = Number(ruleSafe.TP_P1);
  const tp1Qty = Number(ruleSafe.TP_P1_QTY);
  const sl = Number(ruleSafe.SL);
  const beEnabled = ruleSafe.BE_ENABLE !== false;
  const bePct = Number(ruleSafe.BE_PCT);
  const trailPct = Number(ruleSafe.TRAIL_PCT);
  const trailR = Number(ruleSafe.TRAIL_R_MULTIPLE);

  if (!(Number.isFinite(tp0) && tp0 > 0)) violations.push("TP0_MISSING");
  if (!(Number.isFinite(tp0Qty) && tp0Qty > 0 && tp0Qty <= 1)) violations.push("TP0_QTY_INVALID");
  if (!(Number.isFinite(tp1) && tp1 > 0)) violations.push("TP1_MISSING");
  if (!(Number.isFinite(tp1Qty) && tp1Qty > 0 && tp1Qty <= 1)) violations.push("TP1_QTY_INVALID");
  if (!(Number.isFinite(sl) && sl < 0)) violations.push("SL_INVALID");
  if (beEnabled && !(Number.isFinite(bePct) && bePct >= 0)) violations.push("BE_INVALID");
  if (!((Number.isFinite(trailPct) && trailPct > 0) || (Number.isFinite(trailR) && trailR > 0))) {
    violations.push("TRAIL_INVALID");
  }
  return violations;
}

function shouldRepairEntryRuntimeExitState({
  appliedExitRules = null,
  posMeta = null,
  features = null,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const feat = (features && typeof features === "object") ? features : {};
  const exitPolicySrc = String(feat.exit_policy_source || metaSafe.exit_policy_source || "").trim().toUpperCase();
  if (exitPolicySrc && exitPolicySrc !== "BINANCE_DEFAULT") return false;

  const rules = (appliedExitRules && typeof appliedExitRules === "object")
    ? appliedExitRules
    : ((metaSafe.exit_rules_override && typeof metaSafe.exit_rules_override === "object") ? metaSafe.exit_rules_override : null);
  return collectCriticalExitRuleViolations({ rules }).length > 0;
}

async function repairActivePositionExitRuntimeState({
  exchange,
  symbol,
  positionSide,
  entryPrice,
  leverage,
  liveCfg,
  posMeta = null,
  cohort = null,
  sysCfg = null,
  execBarCloseMs = null,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const explicitExitPolicySrc = String(metaSafe.exit_policy_source || "").trim().toUpperCase();
  const preserveExplicitExitPolicy = !!(explicitExitPolicySrc && explicitExitPolicySrc !== "BINANCE_DEFAULT");
  const repairSeedMeta = preserveExplicitExitPolicy
    ? metaSafe
    : mergeMeta(metaSafe, {
        exit_rules_override: null,
        exit_policy_source: null,
        openclaw_market_regime_cohort: cohort || metaSafe.openclaw_market_regime_cohort || metaSafe.market_regime_cohort || null,
      });
  const canonicalRuntimeRules = resolveExitRulesForPosition({
    exchange,
    position: { meta: repairSeedMeta },
  });
  const adjustment = applyEntryExitRuleRuntimeAdjustments({
    rules: canonicalRuntimeRules,
    positionMeta: repairSeedMeta,
    sysCfg: sysCfg || {},
    cohort,
    market: symbol,
  });
  let nextMeta = mergeMeta(metaSafe, {
    exit_rules_override: cloneExitRules(adjustment.appliedExitRules),
    exit_profile: canonicalRuntimeRules && canonicalRuntimeRules.exit_profile
      ? String(canonicalRuntimeRules.exit_profile).toUpperCase()
      : (metaSafe.exit_profile || null),
    exit_profile_reason: preserveExplicitExitPolicy
      ? (metaSafe.exit_profile_reason || null)
      : "ACTIVE_POSITION_RUNTIME_REPAIR",
    tp1_ladder_enabled: adjustment.tp1LadderState ? adjustment.tp1LadderState.enabled !== false : null,
    tp1_ladder_stage: adjustment.tp1LadderState ? adjustment.tp1LadderState.stage : null,
    tp1_ladder_profile: adjustment.tp1LadderState ? adjustment.tp1LadderState.profile : null,
    tp1_ladder_reason: adjustment.tp1LadderState ? adjustment.tp1LadderState.reason : null,
    tp1_ladder_realized_n: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.realized_n : null,
    tp1_ladder_tp0_hit_rate: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.tp0_hit_rate : null,
    tp1_ladder_tp1_hit_rate: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.tp1_hit_rate : null,
    tp1_ladder_tp0_to_tp1_conversion: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.tp0_to_tp1_conversion : null,
    tp1_ladder_fee_adjusted_expectancy: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.fee_adjusted_expectancy : null,
    exit_policy_source: preserveExplicitExitPolicy ? (adjustment.exitPolicySrc || explicitExitPolicySrc) : null,
    runtime_exit_repair_applied: true,
    runtime_exit_repair_reason: "ACTIVE_POSITION_EXIT_META_MISMATCH",
    runtime_exit_repair_at_ms: Date.now(),
  });

  const fallbackSide = String(positionSide || "").toUpperCase() === "SHORT" ? "SELL" : "BUY";
  if (liveCfg && liveCfg.apiKey && liveCfg.apiSecret && Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0) {
    try {
      const nativeProtection = await refreshBinanceNativeProtectionWithRetry({
        liveCfg,
        exchange,
        symbol,
        fallbackSide,
        fallbackEntryPrice: Number(entryPrice),
        fallbackLeverage: Number.isFinite(Number(leverage)) && Number(leverage) > 0 ? Number(leverage) : FUTURES_BASE_LEVERAGE,
        exitRulesOverride: adjustment.appliedExitRules,
      });
      const nativePatch = buildNativeProtectionMetaPatch({
        nativeProtection,
        intent: "ENTRY",
        execBarCloseMs,
      });
      if (nativePatch) nextMeta = mergeMeta(nextMeta, nativePatch);
    } catch (_) {}
  }
  return nextMeta;
}

async function enforceEntryRuntimeExitState({
  exchange,
  symbol,
  appliedExitRules = null,
  posMeta = null,
  features = null,
  cohort = null,
  sysCfg = null,
  entryPrice = null,
  leverage = null,
  execBarCloseMs = null,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  if (!shouldRepairEntryRuntimeExitState({ appliedExitRules, posMeta: metaSafe, features })) {
    return {
      repaired: false,
      meta: metaSafe,
      appliedExitRules: cloneExitRules(appliedExitRules || metaSafe.exit_rules_override || FUTURES_EXIT_PROFILE_BASE.rules),
    };
  }

  const repairedMeta = await repairActivePositionExitRuntimeState({
    exchange,
    symbol,
    positionSide: metaSafe.position_side || metaSafe.external_side || null,
    entryPrice,
    leverage,
    liveCfg: null,
    posMeta: mergeMeta(metaSafe, {
      exit_rules_override: cloneExitRules(appliedExitRules || metaSafe.exit_rules_override || FUTURES_EXIT_PROFILE_BASE.rules),
    }),
    cohort,
    sysCfg,
    execBarCloseMs,
  });

  return {
    repaired: true,
    meta: mergeMeta(repairedMeta, {
      runtime_exit_invariant_repaired: true,
      runtime_exit_invariant_reason: "ENTRY_RUNTIME_EXIT_RULES_INVALID",
      runtime_exit_invariant_at_ms: Date.now(),
    }),
    appliedExitRules: cloneExitRules(repairedMeta.exit_rules_override || appliedExitRules || FUTURES_EXIT_PROFILE_BASE.rules),
  };
}

async function loadFutures3xStats({ exchange, symbol, tf, nowMs }) {
  const ex = String(exchange || "").toUpperCase();
  const symbolRaw = String(symbol || "").trim().toUpperCase();
  const symNorm = normalizeFuturesSymbolKey(symbolRaw);
  const sym = symbolRaw || symNorm;
  const tfKey = String(tf || defaultExecTfFromEnv() || "15m");
  const cacheKey = `${ex}:${symNorm}:${tfKey}`;
  const cached = futures3xStatsCache.get(cacheKey);
  if (cached && (nowMs - cached.at) <= FUTURES_3X_STATS_CACHE_TTL_MS) return cached.data;

  const lookbackMs = FUTURES_3X_STATS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const fromMs = nowMs - lookbackMs;
  let fills = await fetchRecentNewFills({
    exchange: ex,
    symbol: sym,
    tf: tfKey,
    limitN: FUTURES_3X_STATS_LIMIT,
    fromMs,
    hardMaxDocs: FUTURES_3X_STATS_HARD_MAX,
  });
  if ((!Array.isArray(fills) || fills.length === 0) && symNorm && symNorm !== sym) {
    fills = await fetchRecentNewFills({
      exchange: ex,
      symbol: symNorm,
      tf: tfKey,
      limitN: FUTURES_3X_STATS_LIMIT,
      fromMs,
      hardMaxDocs: FUTURES_3X_STATS_HARD_MAX,
    });
  }
  const realFills = fills.filter((f) => String(f && f.event || "").toUpperCase().startsWith("REAL_"));
  const coreFills = fills.filter((f) => String(f && f.event || "").toUpperCase().startsWith("CORE_"));
  const mode = String(process.env.FUTURES_3X_PNL_MODE || "EACH_SELL").toUpperCase();
  const realTrades = buildTradesFromFills(realFills, { mode });
  const coreTrades = buildTradesFromFills(coreFills, { mode });
  const since3d = nowMs - (3 * 24 * 60 * 60 * 1000);
  const since7d = nowMs - (7 * 24 * 60 * 60 * 1000);
  const since14d = nowMs - (14 * 24 * 60 * 60 * 1000);
  const data = {
    real: {
      d3: computePnlStats(realTrades, since3d),
      d7: computePnlStats(realTrades, since7d),
      d14: computePnlStats(realTrades, since14d),
    },
    core: {
      d3: computePnlStats(coreTrades, since3d),
      d7: computePnlStats(coreTrades, since7d),
      d14: computePnlStats(coreTrades, since14d),
    },
  };
  futures3xStatsCache.set(cacheKey, { at: nowMs, data });
  return data;
}

function shouldPromote3x(real7, real14) {
  return Number(real14 && real14.trades) >= FUTURES_3X_PROMOTE_TRADES_MIN_14D
    && Number(real14 && real14.pnl) > 0
    && Number(real14 && real14.pf) >= FUTURES_3X_PROMOTE_PF_MIN_14D
    && Number(real7 && real7.pnl) > 0
    && Number(real7 && real7.pf) >= FUTURES_3X_PROMOTE_PF_MIN_7D;
}

function eval3xSymbolState({ symbol, stats, nowMs }) {
  const sym = normalizeFuturesSymbolKey(symbol);
  const baseWhitelisted = FUTURES_3X_BASE_WHITELIST.has(sym);
  const key = sym;
  const prev = futures3xState.get(key) || {
    streak: 0,
    promoted: false,
    lastStreakUpdateMs: 0,
    cooldownUntilMs: 0,
  };

  const real7 = stats && stats.real && stats.real.d7 ? stats.real.d7 : { trades: 0, pnl: 0, pf: 0 };
  const real14 = stats && stats.real && stats.real.d14 ? stats.real.d14 : { trades: 0, pnl: 0, pf: 0 };
  const killNow = Number(real7.pnl) <= 0 || Number(real7.pf) < FUTURES_3X_KILL_PF_MIN_7D;
  let streak = prev.streak || 0;
  let promoted = !!prev.promoted;
  let lastStreakUpdateMs = Number(prev.lastStreakUpdateMs || 0);
  let cooldownUntilMs = Number(prev.cooldownUntilMs || 0);

  if (killNow) {
    promoted = false;
    streak = 0;
    cooldownUntilMs = nowMs + FUTURES_3X_COOLDOWN_MS;
  } else {
    const passPromote = shouldPromote3x(real7, real14);
    if (passPromote) {
      if ((nowMs - lastStreakUpdateMs) >= FUTURES_3X_STREAK_MIN_INTERVAL_MS) {
        streak += 1;
        lastStreakUpdateMs = nowMs;
      }
      if (streak >= FUTURES_3X_STREAK_REQUIRED) promoted = true;
    } else {
      streak = 0;
    }
  }

  const cooldownActive = nowMs < cooldownUntilMs;
  const recovered = Number(real7.pnl) > 0 && Number(real7.pf) >= FUTURES_3X_RECOVER_PF_MIN_7D;
  const whitelistAuto = promoted || baseWhitelisted;
  const canUse3x = whitelistAuto && !cooldownActive && recovered && !killNow;

  const next = {
    streak,
    promoted,
    lastStreakUpdateMs,
    cooldownUntilMs,
    baseWhitelisted,
  };
  futures3xState.set(key, next);

  return {
    ...next,
    killNow,
    recovered,
    cooldownActive,
    whitelistAuto,
    canUse3x,
  };
}

async function resolveAdaptiveFuturesLeverage({
  liveCfg,
  exchange,
  symbol,
  tf,
  intent,
  event,
  side,
  features,
  nowMs,
} = {}) {
  const baseLeverage = FUTURES_BASE_LEVERAGE;
  if (!FUTURES_DYNAMIC_3X_ENABLED) return { leverage: baseLeverage, reason: "DYNAMIC_3X_DISABLED" };
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { leverage: baseLeverage, reason: "NOT_BINANCE" };
  const intentUpper = String(intent || "").toUpperCase();
  if (intentUpper !== "ENTRY" && intentUpper !== "ADD") return { leverage: baseLeverage, reason: "NON_ENTRY_INTENT" };

  const tier = resolveSignalTier(event, features);
  if (tier !== "CORE" && tier !== "REAL") return { leverage: baseLeverage, reason: "NON_CORE_TIER_EVENT", tier };

  const regime = pickSignalRegime(features);
  if (regime !== "trend") return { leverage: baseLeverage, reason: "REGIME_NOT_TREND" };

  const intentDir = directionFromSignal({ event, side });
  const confidenceRaw = pickSignalConfidence(features);
  const waveConfRaw = pickSignalWaveConf(features);
  const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : waveConfRaw;
  const posterior = pickSignalPosterior(features, intentDir);
  const confMin = tier === "CORE" ? FUTURES_3X_CORE_CONF_MIN : FUTURES_3X_REAL_CONF_MIN;
  const postMin = tier === "CORE" ? FUTURES_3X_CORE_POST_MIN : FUTURES_3X_REAL_POST_MIN;
  if (!Number.isFinite(confidence) || confidence < confMin) {
    return { leverage: baseLeverage, reason: "CONFIDENCE_BELOW_THRESHOLD", confidence, confMin };
  }
  if (!Number.isFinite(posterior) || posterior < postMin) {
    return { leverage: baseLeverage, reason: "POSTERIOR_BELOW_THRESHOLD", posterior, postMin };
  }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let stats = null;
  try {
    stats = await loadFutures3xStats({ exchange: ex, symbol, tf, nowMs: now });
  } catch (e) {
    return { leverage: baseLeverage, reason: "STATS_LOAD_FAILED", error: e && e.message ? e.message : String(e) };
  }
  const state = eval3xSymbolState({ symbol, stats, nowMs: now });
  if (!state.whitelistAuto) return { leverage: baseLeverage, reason: "NOT_IN_DYNAMIC_WHITELIST", state, stats };
  if (state.cooldownActive) return { leverage: baseLeverage, reason: "KILL_SWITCH_COOLDOWN", state, stats };
  if (!state.recovered) return { leverage: baseLeverage, reason: "RECOVERY_NOT_MET", state, stats };
  if (tier === "CORE") {
    const core7 = stats && stats.core && stats.core.d7 ? stats.core.d7 : null;
    const core14 = stats && stats.core && stats.core.d14 ? stats.core.d14 : null;
    const coreOk = core7
      && core14
      && Number(core7.trades) >= 3
      && Number(core7.pnl) > 0
      && Number(core7.pf) >= 1.0
      && Number(core14.pnl) > 0;
    if (!coreOk) {
      return { leverage: baseLeverage, reason: "CORE_STATS_NOT_READY", state, stats };
    }
  }

  return {
    leverage: 3,
    reason: `${tier}_3X_ENABLED`,
    tier,
    confidence,
    posterior,
    state,
    stats,
  };
}

function getExitProfileSymbolState(symbol) {
  const key = normalizeFuturesSymbolKey(symbol);
  const raw = futuresExitProfileState.get(key);
  const prevObj = (raw && typeof raw === "object") ? raw : {};
  const prev = {
    rollbackUntilMs: Number.isFinite(Number(prevObj.rollbackUntilMs)) ? Number(prevObj.rollbackUntilMs) : 0,
    lastRollbackAtMs: Number.isFinite(Number(prevObj.lastRollbackAtMs)) ? Number(prevObj.lastRollbackAtMs) : 0,
    rollbackReason: prevObj.rollbackReason ? String(prevObj.rollbackReason) : null,
  };
  return { key, prev };
}

function evaluateExitProfileRollback({ symbol, stats, nowMs }) {
  const { key, prev } = getExitProfileSymbolState(symbol);
  const real3 = stats && stats.real && stats.real.d3 ? stats.real.d3 : { trades: 0, pnl: 0, pf: 0 };
  const trades3 = Number(real3.trades || 0);
  const pnl3 = Number(real3.pnl || 0);
  const pf3 = Number(real3.pf || 0);

  let rollbackUntilMs = Number(prev.rollbackUntilMs || 0);
  let rollbackReason = prev.rollbackReason || null;
  const rollbackActive = nowMs < rollbackUntilMs;
  const killEligible = trades3 >= FUTURES_EXIT_PROFILE_ROLLBACK_MIN_TRADES_3D;
  const recoverEligible = trades3 >= FUTURES_EXIT_PROFILE_RECOVER_MIN_TRADES_3D;
  const killNow = killEligible && (pnl3 <= FUTURES_EXIT_PROFILE_ROLLBACK_PNL_MIN_3D || pf3 < FUTURES_EXIT_PROFILE_ROLLBACK_PF_MIN_3D);
  const recoverNow = recoverEligible && (pnl3 > FUTURES_EXIT_PROFILE_RECOVER_PNL_MIN_3D && pf3 >= FUTURES_EXIT_PROFILE_RECOVER_PF_MIN_3D);

  if (killNow) {
    rollbackUntilMs = nowMs + FUTURES_EXIT_PROFILE_ROLLBACK_COOLDOWN_MS;
    rollbackReason = "ROLLBACK_3D_TRIGGER";
  } else if (rollbackActive && recoverNow) {
    rollbackUntilMs = 0;
    rollbackReason = "ROLLBACK_RECOVERED";
  }

  const next = {
    rollbackUntilMs,
    lastRollbackAtMs: killNow ? nowMs : Number(prev.lastRollbackAtMs || 0),
    rollbackReason,
  };
  futuresExitProfileState.set(key, next);

  return {
    rollbackActive: nowMs < rollbackUntilMs,
    rollbackUntilMs,
    rollbackReason,
    killNow,
    recoverNow,
    real3,
  };
}

async function resolveAdaptiveFuturesExitProfile({
  exchange,
  symbol,
  tf,
  intent,
  event,
  side,
  features,
  nowMs,
  leverageDecision,
  manualProfileMode,
} = {}) {
  const base = buildExitProfileDecision(FUTURES_EXIT_PROFILE_BASE, "BASE_PROFILE");
  const forcedMode = normalizeFuturesExitProfileMode(manualProfileMode, "BASE");
  if (forcedMode === "BASE") {
    return { ...base, reason: "MANUAL_BASE_PROFILE" };
  }
  if (forcedMode === "AGGRESSIVE") {
    return buildExitProfileDecision(FUTURES_EXIT_PROFILE_AGGRESSIVE, "MANUAL_AGGRESSIVE_PROFILE");
  }
  if (!FUTURES_DYNAMIC_EXIT_PROFILE_ENABLED) {
    return { ...base, reason: "DYNAMIC_EXIT_PROFILE_DISABLED" };
  }
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { ...base, reason: "NOT_BINANCE" };
  const intentUpper = String(intent || "").toUpperCase();
  if (intentUpper !== "ENTRY" && intentUpper !== "ADD") return { ...base, reason: "NON_ENTRY_INTENT" };

  const tier = resolveSignalTier(event, features);
  if (tier !== "CORE" && tier !== "REAL") return { ...base, reason: "NON_CORE_TIER_EVENT", tier };

  const regime = pickSignalRegime(features);
  if (regime !== "trend") return { ...base, reason: "REGIME_NOT_TREND", tier };

  const intentDir = directionFromSignal({ event, side });
  const confidenceRaw = pickSignalConfidence(features);
  const waveConfRaw = pickSignalWaveConf(features);
  const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : waveConfRaw;
  const posterior = pickSignalPosterior(features, intentDir);
  const confMin = tier === "CORE" ? FUTURES_EXIT_PROFILE_CORE_CONF_MIN : FUTURES_EXIT_PROFILE_REAL_CONF_MIN;
  const postMin = tier === "CORE" ? FUTURES_EXIT_PROFILE_CORE_POST_MIN : FUTURES_EXIT_PROFILE_REAL_POST_MIN;
  if (!Number.isFinite(confidence) || confidence < confMin) {
    return { ...base, reason: "CONFIDENCE_BELOW_THRESHOLD", tier, confidence, confMin };
  }
  if (!Number.isFinite(posterior) || posterior < postMin) {
    return { ...base, reason: "POSTERIOR_BELOW_THRESHOLD", tier, posterior, postMin };
  }

  const wantsAggressiveBy3x = !!(
    leverageDecision
    && Number(leverageDecision.leverage) >= 3
    && /_3X_ENABLED$/.test(String(leverageDecision.reason || ""))
  );

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let stats = leverageDecision && leverageDecision.stats ? leverageDecision.stats : null;
  let state = leverageDecision && leverageDecision.state ? leverageDecision.state : null;
  if (!stats || !state) {
    try {
      stats = await loadFutures3xStats({ exchange: ex, symbol, tf, nowMs: now });
      state = eval3xSymbolState({ symbol, stats, nowMs: now });
    } catch (e) {
      return { ...base, reason: "STATS_LOAD_FAILED", tier, error: e && e.message ? e.message : String(e) };
    }
  }
  if (!state || !state.canUse3x) {
    return { ...base, reason: "DYNAMIC_STATE_BLOCKED", tier, state };
  }
  if (tier === "CORE") {
    const core7 = stats && stats.core && stats.core.d7 ? stats.core.d7 : null;
    const core14 = stats && stats.core && stats.core.d14 ? stats.core.d14 : null;
    const coreOk = core7
      && core14
      && Number(core7.trades) >= 3
      && Number(core7.pnl) > 0
      && Number(core7.pf) >= 1.0
      && Number(core14.pnl) > 0;
    if (!coreOk) return { ...base, reason: "CORE_STATS_NOT_READY", tier, state, stats };
  }

  if (FUTURES_EXIT_PROFILE_ROLLBACK_ENABLED) {
    const rollback = evaluateExitProfileRollback({ symbol, stats, nowMs: now });
    if (rollback.killNow || rollback.rollbackActive) {
      const reason = rollback.killNow ? "EXIT_PROFILE_ROLLBACK_3D" : "EXIT_PROFILE_ROLLBACK_COOLDOWN";
      return { ...base, reason, tier, state, stats, rollback };
    }
  }

  const finalReason = wantsAggressiveBy3x ? "SYNC_WITH_3X" : `${tier}_EXIT_PROFILE_AGGRESSIVE`;
  return buildExitProfileDecision(FUTURES_EXIT_PROFILE_AGGRESSIVE, finalReason, {
    tier,
    confidence,
    posterior,
    state,
    stats,
  });
}

function normalizeFuturesMarginType(raw, fallback = "ISOLATED") {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "CROSSED" || v === "ISOLATED") return v;
  return fallback;
}

function isBinanceMultiAssetsIsolatedMarginBlocked(err, marginType) {
  const type = normalizeFuturesMarginType(marginType, "");
  if (type !== "ISOLATED") return false;
  const code = Number(err && err.code);
  const body = String(err && err.body || "");
  const msg = String(err && err.message || err || "");
  const combined = `${msg} ${body}`;
  if (Number.isFinite(code) && code === -4168) return true;
  if (combined.includes("-4168")) return true;
  return /Unable to adjust to isolated-margin mode under the Multi-Assets mode/i.test(combined);
}

function isBinanceMarginTypeOpenOrdersConflict(err) {
  const code = Number(err && err.code);
  const body = String(err && err.body || "");
  const msg = String(err && err.message || err || "");
  const combined = `${msg} ${body}`;
  if (Number.isFinite(code) && code === -4067) return true;
  if (combined.includes("-4067")) return true;
  return /cannot be changed if there exists open orders/i.test(combined)
    || /open orders/i.test(combined);
}

function normalizeFuturesExitProfileMode(raw, fallback = "BASE") {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "BASE" || v === "AGGRESSIVE") return v;
  return String(fallback || "BASE").trim().toUpperCase() || "BASE";
}

function resolvePositionExitProfile({ posMeta, fallbackMode } = {}) {
  const meta = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const rawFallbackProfile = String(fallbackMode || "").trim().toUpperCase();
  const forcedProfile = (rawFallbackProfile === "BASE" || rawFallbackProfile === "AGGRESSIVE")
    ? rawFallbackProfile
    : "";
  if (forcedProfile) {
    const presetForced = forcedProfile === "AGGRESSIVE" ? FUTURES_EXIT_PROFILE_AGGRESSIVE : FUTURES_EXIT_PROFILE_BASE;
    return {
      profile: forcedProfile,
      reason: forcedProfile === "AGGRESSIVE" ? "MANUAL_AGGRESSIVE_PROFILE" : "MANUAL_BASE_PROFILE",
      rules: cloneExitRules(presetForced.rules),
      hasOverride: false,
    };
  }
  const hasOverride = !!(meta.exit_rules_override && typeof meta.exit_rules_override === "object");
  const rawMetaProfile = String(meta.exit_profile || "").trim().toUpperCase();
  const metaProfile = (rawMetaProfile === "BASE" || rawMetaProfile === "AGGRESSIVE") ? rawMetaProfile : "";
  const fallbackProfile = normalizeFuturesExitProfileMode(fallbackMode, "BASE");
  const profile = metaProfile || fallbackProfile || "BASE";
  const preset = profile === "AGGRESSIVE" ? FUTURES_EXIT_PROFILE_AGGRESSIVE : FUTURES_EXIT_PROFILE_BASE;
  const reason = String(meta.exit_profile_reason || "").trim()
    || (profile === "AGGRESSIVE" ? "MANUAL_AGGRESSIVE_PROFILE" : "BASE_PROFILE");
  const rules = cloneExitRules(hasOverride ? meta.exit_rules_override : preset.rules);
  return {
    profile,
    reason,
    rules,
    hasOverride,
  };
}

function resolveSignalTierFromEvent(event, features) {
  const tier = resolveSignalTier(event, features);
  if (tier === "EMO") return 0;
  if (tier === "EARLY") return 1;
  if (tier === "CORE") return 2;
  if (tier === "PRE_REAL") return 3;
  if (tier === "REAL") return 4;
  return null;
}

const futuresLeverageCache = new Map();
const futuresMarginCache = new Map();
const FUTURES_LEVERAGE_TTL_MS = 60 * 60 * 1000;
const FUTURES_MARGIN_TTL_MS = 60 * 60 * 1000;
const FUTURES_POSITION_TTL_MS = 10 * 1000;
const FUTURES_EXTERNAL_FLAT_ENTRY_GRACE_MS = Number(process.env.FUTURES_EXTERNAL_FLAT_ENTRY_GRACE_MS || 30 * 1000);
const futuresPositionCache = { at: 0, positions: null };
const FUTURES_POSITION_MODE_TTL_MS = 10 * 1000;
const futuresPositionModeCache = { at: 0, value: null, keyHint: null };
const FUTURES_FORCE_REFRESH_MS = Number(process.env.FUTURES_FORCE_REFRESH_MS || 5 * 60 * 1000);
const futuresForceRefresh = new Map();

async function resolveExecutionProfile({ symbol, bar, exchange } = {}) {
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const cfg = (sys && sys.data) ? sys.data : {};

  const baseFee = Number(cfg.fee_bps ?? process.env.FEE_BPS ?? 0);
  const baseSlip = Number(cfg.slippage_bps ?? process.env.SLIPPAGE_BPS ?? 0);

  let feeBps = pickMarketOverride(cfg.fee_bps_by_market, symbol, baseFee);
  let slippageBps = pickMarketOverride(cfg.slippage_bps_by_market, symbol, baseSlip);

  const model = String(cfg.slippage_model || "FIXED").toUpperCase();
  if (model === "VOLATILITY" && bar) {
    const high = Number(bar.high ?? bar.h);
    const low = Number(bar.low ?? bar.l);
    const close = Number(bar.close ?? bar.c);
    if (Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close) && close > 0) {
      const rangePct = Math.abs(high - low) / close;
      const rangeBps = rangePct * 10000;
      const factor = Number(cfg.slippage_volatility_factor ?? 0.1);
      if (Number.isFinite(rangeBps) && Number.isFinite(factor)) {
        slippageBps = Number(slippageBps || 0) + rangeBps * factor;
      }
    }
  }

  const minSlip = clamp(cfg.slippage_bps_min, 0, 10_000);
  const maxSlip = clamp(cfg.slippage_bps_max, 0, 10_000);
  if (Number.isFinite(minSlip)) slippageBps = Math.max(Number(slippageBps || 0), minSlip);
  if (Number.isFinite(maxSlip)) slippageBps = Math.min(Number(slippageBps || 0), maxSlip);

  return {
    feeBps: Number.isFinite(Number(feeBps)) ? Number(feeBps) : 0,
    slippageBps: Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : 0,
    intentTtlMs: Number.isFinite(Number(cfg.intent_ttl_ms)) ? Number(cfg.intent_ttl_ms) : null,
    intentTtlBars: Number.isFinite(Number(cfg.intent_ttl_bars)) ? Number(cfg.intent_ttl_bars) : null,
  };
}

function shouldForceFuturesRefresh(symbol) {
  const key = String(symbol || "").toUpperCase();
  if (!key) return false;
  const exp = futuresForceRefresh.get(key);
  if (!Number.isFinite(exp)) return false;
  if (Date.now() >= exp) {
    futuresForceRefresh.delete(key);
    return false;
  }
  return true;
}

function allowByTradingMode(tradingMode, side) {
  if (tradingMode === "RUNNING") return true;
  if (tradingMode === "EXIT_ONLY") return side === "SELL";
  return false;
}

function normalizeSideValue(side) {
  const s = String(side || "").toUpperCase();
  if (s === "LONG") return "BUY";
  if (s === "SHORT") return "SELL";
  if (s === "BUY" || s === "SELL") return s;
  return "HOLD";
}

function normalizeActionValue(action) {
  const s = String(action || "").toUpperCase();
  if (!s) return null;
  if (s === "ENTRY" || s === "ADD" || s === "EXIT" || s === "DROP") return s;
  return s;
}

function actionAllowsEntry(action) {
  return action === "ENTRY" || action === "ADD";
}

function isManualRetryFeatures(features) {
  const f = (features && typeof features === "object") ? features : {};
  return normalizeBool(f._manual_retry_by_user, false) || normalizeBool(f.manual_retry_by_user, false);
}

function resolveManualRetryQtyBase(features) {
  const f = (features && typeof features === "object") ? features : {};
  const n = Number(f._manual_retry_qty_base ?? f.manual_retry_qty_base);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveLogicalAddCapState({
  posSizePct,
  position,
  posMeta,
  stagedAddCount = 0,
} = {}) {
  const baseQtyPctMeta = Number(posMeta && posMeta.add_chain_base_qty_pct);
  const currentQtyPctRaw = Number.isFinite(Number(posSizePct))
    ? Number(posSizePct)
    : Number(position && position.size_pct);
  const persistedAddCountRaw = Number(posMeta && posMeta.add_chain_count);
  const persistedAddCount = Number.isFinite(persistedAddCountRaw) ? Math.max(0, Math.trunc(persistedAddCountRaw)) : 0;
  const effectiveAddCount = persistedAddCount + (
    Number.isFinite(Number(stagedAddCount)) ? Math.max(0, Math.trunc(Number(stagedAddCount))) : 0
  );
  const currentQtyPct = (
    Number.isFinite(currentQtyPctRaw)
    && currentQtyPctRaw >= (1 - POS_SIZE_EPSILON)
    && Number.isFinite(baseQtyPctMeta)
    && baseQtyPctMeta > POS_SIZE_EPSILON
    && baseQtyPctMeta < (1 - POS_SIZE_EPSILON)
  )
    ? Math.min(1, baseQtyPctMeta * (1 + effectiveAddCount))
    : currentQtyPctRaw;
  const baseQtyPct = Number.isFinite(baseQtyPctMeta) && baseQtyPctMeta > POS_SIZE_EPSILON
    ? baseQtyPctMeta
    : (
      Number.isFinite(currentQtyPct)
        ? currentQtyPct
        : Number(position && position.size_pct)
    );
  return {
    baseQtyPct,
    currentQtyPct,
    currentQtyPctRaw,
    persistedAddCount,
    effectiveAddCount,
  };
}

function ensureLogicalAddCapState(state, {
  posSizePct,
  position,
} = {}) {
  if (state && typeof state === "object") return state;
  const fallbackQtyPctRaw = Number.isFinite(Number(posSizePct))
    ? Number(posSizePct)
    : Number(position && position.size_pct);
  const fallbackQtyPct = Number.isFinite(fallbackQtyPctRaw) ? fallbackQtyPctRaw : 0;
  return {
    baseQtyPct: fallbackQtyPct,
    currentQtyPct: fallbackQtyPct,
    currentQtyPctRaw: fallbackQtyPct,
    persistedAddCount: 0,
    effectiveAddCount: 0,
  };
}

function resolveCurrentQtyPctForCap(state, fallbackQtyPct = 0) {
  if (state && typeof state === "object") {
    const qtyPct = Number(state.currentQtyPct);
    if (Number.isFinite(qtyPct)) return qtyPct;
  }
  const fallback = Number(fallbackQtyPct);
  return Number.isFinite(fallback) ? fallback : 0;
}

function resolveLogicalCurrentQtyPctForBudget({
  budgetMaxKrw,
  budgetUsedKrw,
} = {}) {
  const max = Number(budgetMaxKrw);
  const used = Number(budgetUsedKrw);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(used) || used <= 0) return null;
  return clamp(used / max, 0, 1);
}

function resolveSyncedAddChainBaseQtyPct({
  active,
  posMeta,
  budgetMaxKrw,
  budgetUsedKrw,
} = {}) {
  if (!active) return null;
  const currentQtyPct = resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw, budgetUsedKrw });
  if (!Number.isFinite(currentQtyPct) || currentQtyPct <= POS_SIZE_EPSILON) return null;
  const addCountRaw = Number(posMeta && posMeta.add_chain_count);
  const addCount = Number.isFinite(addCountRaw) ? Math.max(0, Math.trunc(addCountRaw)) : 0;
  const baseQtyPct = currentQtyPct / (1 + addCount);
  if (!Number.isFinite(baseQtyPct) || baseQtyPct <= POS_SIZE_EPSILON) return null;
  return Math.min(1, baseQtyPct);
}

function normalizeSignalTypeList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x || "").toUpperCase()).filter(Boolean);
  if (typeof raw === "string") {
    return raw.split(/[,\s]+/).map((x) => String(x || "").toUpperCase()).filter(Boolean);
  }
  return [];
}

function normalizeTpP1EventForExchange(eventRaw, exchange) {
  const ev = String(eventRaw || "").trim().toUpperCase();
  const ex = String(exchange || "").toUpperCase();
  if (ex.includes("BINANCE") && ev === "EXIT_TP_P1_5P") return "EXIT_TP_P1_3P";
  return ev;
}

function filterOutRealSignalTypes(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => {
    const v = String(x || "").toUpperCase();
    if (!v) return false;
    return v !== "REAL" && v !== "REAL_LONG" && v !== "REAL_SHORT";
  });
}

function resolveBinanceRealTradingEnabled(sysCfg) {
  const envRaw = process.env.BINANCE_REAL_TRADING_ENABLED;
  if (envRaw !== undefined) return normalizeBool(envRaw, false);
  return normalizeBool(sysCfg && sysCfg.binance_real_trading_enabled, false);
}

function resolveTradeableSignalTypes(sysCfg, exchange) {
  const ex = String(exchange || "").toUpperCase();
  const isBinanceFut = ex.includes("BINANCEFUT");
  const allowRealOnBinance = isBinanceFut ? resolveBinanceRealTradingEnabled(sysCfg) : true;
  const defaultBinanceListWithReal = [
    "LONG",
    "SHORT",
    "EMO_LONG",
    "EMO_SHORT",
    "TD9P_BUY",
    "TD9P_SELL",
  ];
  const defaultBinanceListWithoutReal = filterOutRealSignalTypes(defaultBinanceListWithReal);
  const raw = sysCfg && sysCfg.tradeable_signal_types;
  const list = normalizeSignalTypeList(raw);
  if (list.length) {
    if (isBinanceFut && !allowRealOnBinance) {
      const filtered = filterOutRealSignalTypes(list);
      return filtered.length ? filtered : defaultBinanceListWithoutReal;
    }
    return list;
  }
  if (isBinanceFut) {
    return allowRealOnBinance ? defaultBinanceListWithReal : defaultBinanceListWithoutReal;
  }
  return null;
}

function isCoreOrRealEvent(event) {
  const ev = String(event || "").toUpperCase();
  return isPrimaryLongShortEventName(ev) || ev.startsWith("CORE_") || isPreRealEventName(ev) || ev.startsWith("REAL_");
}

function resolveOppositeTransitionConfig(sysCfg, exchange) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCEFUT")) {
    return { enabled: false, reduceFraction: 1, confirmBars: 0, coreRealOnly: true };
  }
  const enabled = normalizeBool(
    sysCfg && sysCfg.opposite_transition_enabled,
    true
  );
  const reduceRaw = Number(sysCfg && sysCfg.opposite_transition_reduce_fraction);
  const reduceFraction = Number.isFinite(reduceRaw)
    ? Math.max(0.1, Math.min(1, reduceRaw))
    : 0.5;
  const confirmBarsRaw = normalizeInt(sysCfg && sysCfg.opposite_transition_confirm_bars, 2);
  const confirmBars = Math.max(1, Number.isFinite(confirmBarsRaw) ? confirmBarsRaw : 2);
  const coreRealOnly = normalizeBool(sysCfg && sysCfg.opposite_transition_core_real_only, true);
  return { enabled, reduceFraction, confirmBars, coreRealOnly };
}

function canonicalTradeableEvent(eventUpper, intentDir) {
  const ev = String(eventUpper || "").toUpperCase();
  const dir = String(intentDir || "").toUpperCase();
  if (!ev) return null;
  if (isPrimaryLongShortEventName(ev)) return ev;
  if (ev.startsWith("REAL_") || isPreRealEventName(ev) || ev.startsWith("CORE_") || ev.startsWith("EARLY_")) {
    return dir === "SHORT" ? "SHORT" : "LONG";
  }
  if (isEmoEventName(ev)) return dir === "SHORT" ? "EMO_SHORT" : "EMO_LONG";
  if (ev.startsWith("TD9P_")) return dir === "SHORT" ? "TD9P_SELL" : "TD9P_BUY";
  return ev;
}

function isTradeableEventAllowed({ eventUpper, intentDir, allowlist } = {}) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  const ev = String(eventUpper || "").toUpperCase();
  const dir = String(intentDir || "").toUpperCase();
  if (!ev) return false;
  if (allowlist.includes(ev)) return true;
  const canonical = canonicalTradeableEvent(ev, intentDir);
  if (canonical && allowlist.includes(canonical)) return true;
  if (isPrimaryLongShortEventName(ev)) return allowlist.includes(ev);
  if (ev.startsWith("REAL_")) return allowlist.includes("REAL") || allowlist.includes(dir === "SHORT" ? "SHORT" : "LONG");
  if (ev.startsWith("CORE_")) return allowlist.includes("CORE") || allowlist.includes(dir === "SHORT" ? "SHORT" : "LONG");
  if (isPreRealEventName(ev)) {
    if (allowlist.includes("PRE_REAL")) return true;
    if (allowlist.includes(dir === "SHORT" ? "SHORT" : "LONG")) return true;
    if (allowlist.includes(dir === "SHORT" ? "EARLY_SHORT" : "EARLY_LONG")) return true;
    return allowlist.includes("EARLY");
  }
  if (isEarlyEventName(ev)) {
    if (allowlist.includes(dir === "SHORT" ? "SHORT" : "LONG")) return true;
    return allowlist.includes("EARLY");
  }
  if (isEmoEventName(ev)) return allowlist.includes("EMO");
  if (ev.startsWith("TD9P_")) return allowlist.includes("TD9P");
  return false;
}

function resolveImmediateDefaultsForExchange(sysCfg, exchange) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCEFUT")) return sysCfg;
  const out = { ...sysCfg };
  const coreMin = Number.isFinite(out.entry_immediate_core_conf_min) ? out.entry_immediate_core_conf_min : 0.65;
  const realMin = Number.isFinite(out.entry_immediate_real_conf_min) ? out.entry_immediate_real_conf_min : 0.7;
  const waveMin = Number.isFinite(out.entry_immediate_wave_conf_min) ? out.entry_immediate_wave_conf_min : 0.7;
  out.entry_immediate_core_conf_min = Math.max(0.65, coreMin);
  out.entry_immediate_real_conf_min = Math.max(0.7, realMin);
  out.entry_immediate_wave_conf_min = Math.max(0.7, waveMin);
  return out;
}

function computeUnrealizedPnlPct({ position, bar, positionSide }) {
  const pos = position || {};
  const avg = Number(pos.avg_price);
  const closePx = Number(bar && (bar.close ?? bar.c ?? bar.closePrice));
  if (!Number.isFinite(avg) || !Number.isFinite(closePx) || avg === 0) return null;
  const side = normalizePositionSide(positionSide) || "LONG";
  return side === "SHORT" ? (avg - closePx) / avg : (closePx - avg) / avg;
}

function parseReplayRescueSet(raw, fallback = []) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || "").split(",");
  const normalized = list
    .map((x) => String(x || "").trim().toUpperCase())
    .filter(Boolean);
  if (normalized.length) return new Set(normalized);
  return new Set((fallback || []).map((x) => String(x || "").trim().toUpperCase()).filter(Boolean));
}

function resolveLiveRescueAddConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const enabledSource = process.env.RESCUE_ADD_ENABLED !== undefined
    ? process.env.RESCUE_ADD_ENABLED
    : sysCfg.rescue_add_enabled;
  const enabled = ex.includes("BINANCEFUT") && normalizeBool(enabledSource, false);
  if (!enabled) return { enabled: false };

  const addFractionRaw = normalizeNumber(
    process.env.RESCUE_ADD_SIZE !== undefined ? process.env.RESCUE_ADD_SIZE : sysCfg.rescue_add_size,
    1.0
  );
  const addFraction = Number.isFinite(addFractionRaw)
    ? clamp(addFractionRaw, 0, 2)
    : 1.0;
  const minLossPctRaw = normalizeNumber(
    process.env.RESCUE_ADD_MIN_LOSS_PCT !== undefined ? process.env.RESCUE_ADD_MIN_LOSS_PCT : sysCfg.rescue_add_min_loss_pct,
    0.1
  );
  const maxLossPctRaw = normalizeNumber(
    process.env.RESCUE_ADD_MAX_LOSS_PCT !== undefined ? process.env.RESCUE_ADD_MAX_LOSS_PCT : sysCfg.rescue_add_max_loss_pct,
    1.4
  );
  const minLossPct = Number.isFinite(minLossPctRaw) ? Math.max(0, minLossPctRaw) : 0.1;
  const maxLossPct = Number.isFinite(maxLossPctRaw) ? Math.max(minLossPct, maxLossPctRaw) : Math.max(minLossPct, 1.4);
  const minStopDistancePctRaw = normalizeNumber(
    process.env.RESCUE_ADD_MIN_STOP_DISTANCE_PCT !== undefined ? process.env.RESCUE_ADD_MIN_STOP_DISTANCE_PCT : sysCfg.rescue_add_min_stop_distance_pct,
    null
  );
  const minStopDistancePct = Number.isFinite(minStopDistancePctRaw) ? Math.max(0, minStopDistancePctRaw) : null;
  const maxAddsRaw = normalizeInt(
    process.env.RESCUE_ADD_MAX_ADDS !== undefined ? process.env.RESCUE_ADD_MAX_ADDS : sysCfg.rescue_add_max_adds,
    1
  );
  const maxAdds = Number.isFinite(maxAddsRaw) ? Math.max(0, maxAddsRaw) : 1;
  const allowedTiers = parseReplayRescueSet(
    process.env.RESCUE_ADD_TIERS !== undefined ? process.env.RESCUE_ADD_TIERS : sysCfg.rescue_add_tiers,
    ["EARLY", "CORE"]
  );
  const allowedSides = parseReplayRescueSet(
    process.env.RESCUE_ADD_SIDES !== undefined ? process.env.RESCUE_ADD_SIDES : sysCfg.rescue_add_sides,
    ["LONG", "SHORT"]
  );
  const preTp1Only = normalizeBool(
    process.env.RESCUE_ADD_PRE_TP1_ONLY !== undefined ? process.env.RESCUE_ADD_PRE_TP1_ONLY : sysCfg.rescue_add_pre_tp1_only,
    true
  );
  const sameBarBlock = normalizeBool(
    process.env.RESCUE_ADD_SAME_BAR_BLOCK !== undefined ? process.env.RESCUE_ADD_SAME_BAR_BLOCK : sysCfg.rescue_add_same_bar_block,
    true
  );
  const blockOppositeTransition = normalizeBool(
    process.env.RESCUE_ADD_BLOCK_OPPOSITE_TRANSITION !== undefined ? process.env.RESCUE_ADD_BLOCK_OPPOSITE_TRANSITION : sysCfg.rescue_add_block_opposite_transition,
    true
  );
  const scenarioKey = String(sysCfg.rescue_add_scenario || "").trim() || "LIVE_RESCUE_ADD";
  return {
    enabled: true,
    addFraction,
    minLossPct,
    maxLossPct,
    minStopDistancePct,
    maxAdds,
    allowedTiers,
    allowedSides,
    preTp1Only,
    sameBarBlock,
    blockOppositeTransition,
    scenarioKey,
  };
}

function resolveReplayRescueAddConfig(features) {
  const f = (features && typeof features === "object") ? features : {};
  const enabled = normalizeBool(f._replay_rescue_add_enabled, false);
  if (!enabled) return { enabled: false };

  const addFractionRaw = normalizeNumber(f._replay_rescue_add_size, null);
  const addFraction = Number.isFinite(addFractionRaw)
    ? clamp(addFractionRaw, 0, 2)
    : null;
  const minLossPctRaw = normalizeNumber(f._replay_rescue_add_min_loss_pct, 1.0);
  const maxLossPctRaw = normalizeNumber(f._replay_rescue_add_max_loss_pct, 1.2);
  const minLossPct = Number.isFinite(minLossPctRaw) ? Math.max(0, minLossPctRaw) : 1.0;
  const maxLossPct = Number.isFinite(maxLossPctRaw) ? Math.max(minLossPct, maxLossPctRaw) : Math.max(minLossPct, 1.2);
  const minStopDistancePctRaw = normalizeNumber(f._replay_rescue_add_min_stop_distance_pct, null);
  const minStopDistancePct = Number.isFinite(minStopDistancePctRaw) ? Math.max(0, minStopDistancePctRaw) : null;
  const maxAddsRaw = normalizeInt(f._replay_rescue_add_max_adds, 1);
  const maxAdds = Number.isFinite(maxAddsRaw) ? Math.max(0, maxAddsRaw) : 1;
  const allowRange = normalizeBool(f._replay_rescue_add_allow_range, false);
  const allowedTiers = parseReplayRescueSet(f._replay_rescue_add_tiers, ["EARLY", "CORE"]);
  const allowedSides = parseReplayRescueSet(f._replay_rescue_add_sides, ["LONG", "SHORT"]);
  const preTp1Only = normalizeBool(f._replay_rescue_add_pre_tp1_only, true);
  const sameBarBlock = normalizeBool(f._replay_rescue_add_same_bar_block, true);
  const blockOppositeTransition = normalizeBool(f._replay_rescue_add_block_opposite_transition, true);
  const scenarioKey = String(f._replay_rescue_add_scenario || "").trim() || null;

  return {
    enabled: true,
    addFraction,
    minLossPct,
    maxLossPct,
    minStopDistancePct,
    maxAdds,
    allowRange,
    allowedTiers,
    allowedSides,
    preTp1Only,
    sameBarBlock,
    blockOppositeTransition,
    scenarioKey,
  };
}

function resolveSameDirectionTrailProfitCooldownConfig(sysCfg = {}) {
  const enabled = normalizeBool(sysCfg.same_direction_trail_profit_cooldown_enabled, false);
  const cooldownMsRaw = normalizeInt(sysCfg.same_direction_trail_profit_cooldown_ms, 4 * 60 * 60 * 1000);
  const cooldownMs = Number.isFinite(cooldownMsRaw) ? Math.max(0, cooldownMsRaw) : (4 * 60 * 60 * 1000);
  return {
    enabled,
    cooldownMs,
  };
}

function buildSameDirectionTrailProfitCooldownMetaPatch({
  event,
  realizedPnlQuote,
  positionSide,
  exitWallMs,
  source = "INTENT_FILL",
} = {}) {
  const ev = String(event || "").trim().toUpperCase();
  const pnl = Number(realizedPnlQuote);
  const dir = normalizePositionSide(positionSide);
  const refMs = Number(exitWallMs);
  if (!ev.startsWith("EXIT_TRAIL")) return null;
  if (!Number.isFinite(pnl) || pnl <= 0) return null;
  if (!dir || !Number.isFinite(refMs) || refMs <= 0) return null;
  return {
    same_direction_trail_profit_exit_dir: dir,
    same_direction_trail_profit_exit_wall_ms: refMs,
    same_direction_trail_profit_exit_event: ev,
    same_direction_trail_profit_exit_realized_pnl: pnl,
    same_direction_trail_profit_exit_source: String(source || "INTENT_FILL").trim().slice(0, 80) || "INTENT_FILL",
  };
}

function resolveSameDirectionTrailProfitCooldownBlock({
  cfg,
  posMeta,
  intentDir,
  eventRefMs,
} = {}) {
  const cooldownCfg = (cfg && typeof cfg === "object") ? cfg : {};
  if (cooldownCfg.enabled !== true) return null;
  const cooldownMs = Number(cooldownCfg.cooldownMs);
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) return null;
  const nextDir = normalizePositionSide(intentDir);
  const exitDir = normalizePositionSide(posMeta && posMeta.same_direction_trail_profit_exit_dir);
  const exitWallMs = Number(posMeta && posMeta.same_direction_trail_profit_exit_wall_ms);
  const refMs = Number(eventRefMs);
  if (!nextDir || !exitDir || nextDir !== exitDir) return null;
  if (!Number.isFinite(exitWallMs) || !Number.isFinite(refMs) || refMs < exitWallMs) return null;
  const elapsedMs = refMs - exitWallMs;
  if (elapsedMs < 0 || elapsedMs >= cooldownMs) return null;
  return {
    exit_dir: exitDir,
    exit_wall_ms: exitWallMs,
    exit_event: String(posMeta && posMeta.same_direction_trail_profit_exit_event || "").trim().toUpperCase() || null,
    realized_pnl: Number.isFinite(Number(posMeta && posMeta.same_direction_trail_profit_exit_realized_pnl))
      ? Number(posMeta.same_direction_trail_profit_exit_realized_pnl)
      : null,
    elapsed_ms: elapsedMs,
    cooldown_ms: cooldownMs,
    source: String(posMeta && posMeta.same_direction_trail_profit_exit_source || "").trim().toUpperCase() || null,
  };
}

function computeReplayStopDistancePct({ position, bar, positionSide, rules } = {}) {
  const pos = position || {};
  const avg = Number(pos.avg_price);
  const closePx = Number(bar && (bar.close ?? bar.c ?? bar.closePrice));
  const side = normalizePositionSide(positionSide);
  const slPct = Number(rules && rules.SL);
  if (!Number.isFinite(avg) || !Number.isFinite(closePx) || closePx <= 0) return null;
  if (!side || !Number.isFinite(slPct)) return null;
  const stopPx = side === "SHORT"
    ? (avg * (1 - slPct))
    : (avg * (1 + slPct));
  if (!Number.isFinite(stopPx)) return null;
  return side === "SHORT"
    ? (((stopPx - closePx) / closePx) * 100)
    : (((closePx - stopPx) / closePx) * 100);
}

function resolveEventRefMs(...candidates) {
  for (const candidate of candidates) {
    const ms = Number(candidate);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return Date.now();
}

function shouldBypassOppositeEntryCooldown({ features, intentDir, posMeta } = {}) {
  const featureMap = (features && typeof features === "object") ? features : {};
  const allowOppositeAfterExit = normalizeBool(featureMap._allow_opposite_after_exit, false);
  const flipConfirmed = normalizeBool(featureMap._flip_confirmed, false)
    || Number(featureMap._flip_stage) >= 2
    || String(featureMap.opposite_transition || "").toUpperCase() === "CONFIRM_EXIT";
  const lastExitDir = String(posMeta && posMeta.last_exit_dir || "").toUpperCase();
  const nextDir = String(intentDir || "").toUpperCase();
  return allowOppositeAfterExit === true
    && flipConfirmed === true
    && !!lastExitDir
    && !!nextDir
    && lastExitDir !== nextDir;
}

function shouldBlockSignalOverlap({
  pos = null,
  lastBarMs = NaN,
  effectiveBarMs = NaN,
  signalTfMs = NaN,
  signalOverlapBars = 0,
  allowOverlapUpgrade = false,
} = {}) {
  const positionState = String(pos && (pos.position_state || pos.state) || "").toUpperCase();
  if (positionState === "FLAT") return false;
  if (!Number.isFinite(lastBarMs)) return false;
  const barsSince = Math.round((effectiveBarMs - lastBarMs) / signalTfMs);
  return Number.isFinite(barsSince)
    && barsSince >= 0
    && barsSince <= signalOverlapBars
    && !allowOverlapUpgrade;
}

function evaluateLiveRescueAdd({
  cfg,
  event,
  features,
  position,
  posMeta,
  posSide,
  posSizePct,
  bar,
  signalBarCloseMs,
  useBudget,
  pendingAddCount = 0,
  pendingAddSignalBarMs = null,
} = {}) {
  const resolvedCfg = (cfg && typeof cfg === "object" && cfg.enabled === true) ? cfg : { enabled: false };
  if (resolvedCfg.enabled !== true) return { enabled: false, ok: true };

  const tier = resolveEntryQualityTier(event, features);
  if (!tier || !resolvedCfg.allowedTiers.has(tier)) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_TIER_BLOCKED",
      detail: { tier: tier || null, allowed_tiers: Array.from(resolvedCfg.allowedTiers) },
    };
  }

  const side = normalizePositionSide(
    posSide ||
    (position && (position.position_side || position.side)) ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  );
  if (!side || !resolvedCfg.allowedSides.has(side)) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_SIDE_BLOCKED",
      detail: { side: side || null, allowed_sides: Array.from(resolvedCfg.allowedSides) },
    };
  }

  if (resolvedCfg.preTp1Only && posMeta && (posMeta.tp_p1_done === true || posMeta.trail_active === true || posMeta.tp_p1_pending === true)) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_POST_TP1_BLOCKED",
      detail: {
        tp_p1_done: posMeta.tp_p1_done === true,
        trail_active: posMeta.trail_active === true,
        tp_p1_pending: posMeta.tp_p1_pending === true,
      },
    };
  }

  const stagedAddCount = Number.isFinite(Number(pendingAddCount)) ? Math.max(0, Math.trunc(Number(pendingAddCount))) : 0;
  const addCapState = ensureLogicalAddCapState(resolveLogicalAddCapState({
    posSizePct,
    position,
    posMeta,
    stagedAddCount,
  }), { posSizePct, position });
  const safeAddCapState = (addCapState && typeof addCapState === "object")
    ? addCapState
    : ensureLogicalAddCapState(null, { posSizePct, position });
  const baseQtyPct = Number.isFinite(Number(safeAddCapState.baseQtyPct))
    ? Number(safeAddCapState.baseQtyPct)
    : null;
  const currentQtyPct = Number.isFinite(Number(safeAddCapState.currentQtyPct))
    ? Number(safeAddCapState.currentQtyPct)
    : 0;
  const addCount = addCapState.persistedAddCount;
  const effectiveAddCount = addCapState.effectiveAddCount;
  if (effectiveAddCount >= resolvedCfg.maxAdds) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_LIMIT_BLOCKED",
      detail: { add_count: effectiveAddCount, persisted_add_count: addCount, max_adds: resolvedCfg.maxAdds },
    };
  }

  const signalMs = Number.isFinite(Number(signalBarCloseMs)) ? Number(signalBarCloseMs) : null;
  if (resolvedCfg.sameBarBlock && Number.isFinite(signalMs)) {
    const entryExecMs = Number(posMeta && posMeta.entry_exec_bar_ms);
    const lastAddSignalMs = Number(posMeta && (posMeta.add_chain_last_signal_bar_ms ?? posMeta.add_chain_last_ms));
    const stagedSignalMs = Number.isFinite(Number(pendingAddSignalBarMs)) ? Number(pendingAddSignalBarMs) : null;
    const sameBarEntry = Number.isFinite(entryExecMs) && signalMs === entryExecMs;
    const sameBarPersistedAdd = Number.isFinite(lastAddSignalMs) && signalMs === lastAddSignalMs;
    const sameBarPendingAdd = Number.isFinite(stagedSignalMs) && signalMs === stagedSignalMs;
    if (sameBarEntry || sameBarPersistedAdd || sameBarPendingAdd) {
      return {
        enabled: true,
        ok: false,
        reason: "LIVE_RESCUE_ADD_SAME_BAR_BLOCKED",
        detail: {
          signal_bar_ms: signalMs,
          entry_exec_bar_ms: Number.isFinite(entryExecMs) ? entryExecMs : null,
          last_add_signal_bar_ms: Number.isFinite(lastAddSignalMs) ? lastAddSignalMs : null,
          pending_add_signal_bar_ms: Number.isFinite(stagedSignalMs) ? stagedSignalMs : null,
        },
      };
    }
  }

  if (resolvedCfg.blockOppositeTransition) {
    const transitionDir = String(posMeta && posMeta.opposite_transition_dir || "").toUpperCase();
    const transitionUntilMs = Number(posMeta && posMeta.opposite_transition_until_ms);
    const transitionActive = !!transitionDir
      && (!Number.isFinite(signalMs) || !Number.isFinite(transitionUntilMs) || signalMs <= transitionUntilMs);
    if (transitionActive) {
      return {
        enabled: true,
        ok: false,
        reason: "LIVE_RESCUE_ADD_OPPOSITE_TRANSITION_BLOCKED",
        detail: {
          opposite_transition_dir: transitionDir,
          opposite_transition_until_ms: Number.isFinite(transitionUntilMs) ? transitionUntilMs : null,
        },
      };
    }
  }

  if (!Number.isFinite(resolvedCfg.addFraction) || resolvedCfg.addFraction <= 0) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_DISABLED",
      detail: {
        scenario: resolvedCfg.scenarioKey,
        add_fraction: Number.isFinite(resolvedCfg.addFraction) ? resolvedCfg.addFraction : null,
      },
    };
  }

  const leverageEff = resolvePositionLeverage({ position, fallback: 1 });
  const rawUpnlFrac = computeUnrealizedPnlPct({ position, bar, positionSide: side });
  const upnlFrac = Number.isFinite(rawUpnlFrac)
    ? (rawUpnlFrac * (Number.isFinite(leverageEff) && leverageEff > 0 ? leverageEff : 1))
    : null;
  const lossPct = Number.isFinite(upnlFrac) ? Math.max(0, -upnlFrac * 100) : null;
  if (!Number.isFinite(lossPct) || lossPct < resolvedCfg.minLossPct || lossPct > resolvedCfg.maxLossPct) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED",
      detail: {
        upnl_pct: Number.isFinite(upnlFrac) ? Number((upnlFrac * 100).toFixed(4)) : null,
        loss_pct: Number.isFinite(lossPct) ? Number(lossPct.toFixed(4)) : null,
        min_loss_pct: resolvedCfg.minLossPct,
        max_loss_pct: resolvedCfg.maxLossPct,
      },
    };
  }

  const exitProfile = resolvePositionExitProfile({ posMeta, fallbackMode: null });
  const stopDistancePct = computeReplayStopDistancePct({
    position,
    bar,
    positionSide: side,
    rules: exitProfile && exitProfile.rules,
  });
  if (Number.isFinite(resolvedCfg.minStopDistancePct) && (!Number.isFinite(stopDistancePct) || stopDistancePct < resolvedCfg.minStopDistancePct)) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_STOP_GAP_BLOCKED",
      detail: {
        stop_distance_pct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(4)) : null,
        min_stop_distance_pct: resolvedCfg.minStopDistancePct,
      },
    };
  }

  const requestedAddQtyPct = Number.isFinite(baseQtyPct) ? (baseQtyPct * resolvedCfg.addFraction) : null;
  const remainingCapQtyPct = useBudget ? Math.max(0, 1 - (Number.isFinite(currentQtyPct) ? currentQtyPct : 0)) : null;
  let addQtyPct = requestedAddQtyPct;
  if (useBudget && Number.isFinite(remainingCapQtyPct)) {
    addQtyPct = Math.min(requestedAddQtyPct, remainingCapQtyPct);
  }
  const autoShrunk = Number.isFinite(requestedAddQtyPct)
    && Number.isFinite(addQtyPct)
    && addQtyPct + POS_SIZE_EPSILON < requestedAddQtyPct;
  if (!Number.isFinite(addQtyPct) || addQtyPct <= POS_SIZE_EPSILON) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_POSITION_FULL",
      detail: {
        base_qty_pct: Number.isFinite(baseQtyPct) ? Number(baseQtyPct.toFixed(6)) : null,
        requested_add_qty_pct: Number.isFinite(requestedAddQtyPct) ? Number(requestedAddQtyPct.toFixed(6)) : null,
        remaining_cap_qty_pct: Number.isFinite(remainingCapQtyPct) ? Number(remainingCapQtyPct.toFixed(6)) : null,
      },
    };
  }

  return {
    enabled: true,
    ok: true,
    addQtyPct,
    detail: {
      scenario: resolvedCfg.scenarioKey,
      tier,
      side,
      add_fraction: resolvedCfg.addFraction,
      base_qty_pct: Number.isFinite(baseQtyPct) ? Number(baseQtyPct.toFixed(6)) : null,
      current_qty_pct_effective: Number.isFinite(currentQtyPct) ? Number(currentQtyPct.toFixed(6)) : null,
      requested_add_qty_pct: Number.isFinite(requestedAddQtyPct) ? Number(requestedAddQtyPct.toFixed(6)) : null,
      add_qty_pct: Number(addQtyPct.toFixed(6)),
      remaining_cap_qty_pct: Number.isFinite(remainingCapQtyPct) ? Number(remainingCapQtyPct.toFixed(6)) : null,
      auto_shrunk: autoShrunk,
      loss_pct: Number(lossPct.toFixed(4)),
      upnl_pct: Number((upnlFrac * 100).toFixed(4)),
      stop_distance_pct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(4)) : null,
      add_count: effectiveAddCount,
      max_adds: resolvedCfg.maxAdds,
      signal_bar_ms: signalMs,
    },
  };
}

function evaluateReplayRescueAdd({
  event,
  features,
  position,
  posMeta,
  posSide,
  posSizePct,
  bar,
  signalBarCloseMs,
  pendingAddCount = 0,
  pendingAddSignalBarMs = null,
} = {}) {
  const cfg = resolveReplayRescueAddConfig(features);
  if (cfg.enabled !== true) return { enabled: false, ok: true };

  const tier = resolveEntryQualityTier(event, features);
  if (!tier || !cfg.allowedTiers.has(tier)) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_TIER_BLOCKED",
      detail: { tier: tier || null, allowed_tiers: Array.from(cfg.allowedTiers) },
    };
  }

  const side = normalizePositionSide(
    posSide ||
    (position && (position.position_side || position.side)) ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  );
  if (!side || !cfg.allowedSides.has(side)) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_SIDE_BLOCKED",
      detail: { side: side || null, allowed_sides: Array.from(cfg.allowedSides) },
    };
  }

  if (cfg.preTp1Only && posMeta && (posMeta.tp_p1_done === true || posMeta.trail_active === true || posMeta.tp_p1_pending === true)) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_POST_TP1_BLOCKED",
      detail: {
        tp_p1_done: posMeta.tp_p1_done === true,
        trail_active: posMeta.trail_active === true,
        tp_p1_pending: posMeta.tp_p1_pending === true,
      },
    };
  }

  const stagedAddCount = Number.isFinite(Number(pendingAddCount)) ? Math.max(0, Math.trunc(Number(pendingAddCount))) : 0;
  const addCapState = ensureLogicalAddCapState(resolveLogicalAddCapState({
    posSizePct,
    position,
    posMeta,
    stagedAddCount,
  }), { posSizePct, position });
  const safeAddCapState = (addCapState && typeof addCapState === "object")
    ? addCapState
    : ensureLogicalAddCapState(null, { posSizePct, position });
  const currentQtyPct = Number.isFinite(Number(safeAddCapState.currentQtyPct))
    ? Number(safeAddCapState.currentQtyPct)
    : 0;
  const baseQtyPct = Number.isFinite(Number(safeAddCapState.baseQtyPct))
    ? Number(safeAddCapState.baseQtyPct)
    : null;
  const addCount = addCapState.persistedAddCount;
  const effectiveAddCount = addCapState.effectiveAddCount;
  if (effectiveAddCount >= cfg.maxAdds) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_LIMIT_BLOCKED",
      detail: { add_count: effectiveAddCount, persisted_add_count: addCount, max_adds: cfg.maxAdds },
    };
  }

  if (!Number.isFinite(cfg.addFraction) || cfg.addFraction <= 0) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_DISABLED",
      detail: {
        scenario: cfg.scenarioKey,
        add_fraction: Number.isFinite(cfg.addFraction) ? cfg.addFraction : null,
      },
    };
  }

  const regime = pickSignalRegime(features);
  if (!cfg.allowRange && regime === "range") {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_RANGE_BLOCKED",
      detail: { regime },
    };
  }

  const signalMs = Number.isFinite(Number(signalBarCloseMs)) ? Number(signalBarCloseMs) : null;
  if (cfg.sameBarBlock && Number.isFinite(signalMs)) {
    const entryExecMs = Number(posMeta && posMeta.entry_exec_bar_ms);
    const lastAddSignalMs = Number(posMeta && (posMeta.add_chain_last_signal_bar_ms ?? posMeta.add_chain_last_ms));
    const stagedSignalMs = Number.isFinite(Number(pendingAddSignalBarMs)) ? Number(pendingAddSignalBarMs) : null;
    const sameBarEntry = Number.isFinite(entryExecMs) && signalMs === entryExecMs;
    const sameBarPersistedAdd = Number.isFinite(lastAddSignalMs) && signalMs === lastAddSignalMs;
    const sameBarPendingAdd = Number.isFinite(stagedSignalMs) && signalMs === stagedSignalMs;
    if (sameBarEntry || sameBarPersistedAdd || sameBarPendingAdd) {
      return {
        enabled: true,
        ok: false,
        reason: "REPLAY_RESCUE_ADD_SAME_BAR_BLOCKED",
        detail: {
          signal_bar_ms: signalMs,
          entry_exec_bar_ms: Number.isFinite(entryExecMs) ? entryExecMs : null,
          last_add_signal_bar_ms: Number.isFinite(lastAddSignalMs) ? lastAddSignalMs : null,
          pending_add_signal_bar_ms: Number.isFinite(stagedSignalMs) ? stagedSignalMs : null,
        },
      };
    }
  }

  if (cfg.blockOppositeTransition) {
    const transitionDir = String(posMeta && posMeta.opposite_transition_dir || "").toUpperCase();
    const transitionUntilMs = Number(posMeta && posMeta.opposite_transition_until_ms);
    const transitionActive = !!transitionDir
      && (!Number.isFinite(signalMs) || !Number.isFinite(transitionUntilMs) || signalMs <= transitionUntilMs);
    if (transitionActive) {
      return {
        enabled: true,
        ok: false,
        reason: "REPLAY_RESCUE_ADD_OPPOSITE_TRANSITION_BLOCKED",
        detail: {
          opposite_transition_dir: transitionDir,
          opposite_transition_until_ms: Number.isFinite(transitionUntilMs) ? transitionUntilMs : null,
        },
      };
    }
  }

  const leverageEff = resolvePositionLeverage({ position, fallback: 1 });
  const rawUpnlFrac = computeUnrealizedPnlPct({ position, bar, positionSide: side });
  const upnlFrac = Number.isFinite(rawUpnlFrac)
    ? (rawUpnlFrac * (Number.isFinite(leverageEff) && leverageEff > 0 ? leverageEff : 1))
    : null;
  const lossPct = Number.isFinite(upnlFrac) ? Math.max(0, -upnlFrac * 100) : null;
  if (!Number.isFinite(lossPct) || lossPct < cfg.minLossPct || lossPct > cfg.maxLossPct) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_LOSS_WINDOW_BLOCKED",
      detail: {
        upnl_pct: Number.isFinite(upnlFrac) ? Number((upnlFrac * 100).toFixed(4)) : null,
        loss_pct: Number.isFinite(lossPct) ? Number(lossPct.toFixed(4)) : null,
        min_loss_pct: cfg.minLossPct,
        max_loss_pct: cfg.maxLossPct,
      },
    };
  }

  const exitProfile = resolvePositionExitProfile({ posMeta, fallbackMode: null });
  const stopDistancePct = computeReplayStopDistancePct({
    position,
    bar,
    positionSide: side,
    rules: exitProfile && exitProfile.rules,
  });
  if (Number.isFinite(cfg.minStopDistancePct) && (!Number.isFinite(stopDistancePct) || stopDistancePct < cfg.minStopDistancePct)) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_STOP_GAP_BLOCKED",
      detail: {
        stop_distance_pct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(4)) : null,
        min_stop_distance_pct: cfg.minStopDistancePct,
      },
    };
  }

  const requestedAddQtyPct = Number.isFinite(baseQtyPct) ? (baseQtyPct * cfg.addFraction) : null;
  const remainingCapQtyPct = Math.max(0, 1 - (Number.isFinite(currentQtyPct) ? currentQtyPct : 0));
  const addQtyPct = Number.isFinite(requestedAddQtyPct)
    ? Math.min(requestedAddQtyPct, remainingCapQtyPct)
    : null;
  if (!Number.isFinite(addQtyPct) || addQtyPct <= POS_SIZE_EPSILON || !Number.isFinite(cfg.addFraction) || cfg.addFraction <= 0) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_QTY_INVALID",
      detail: {
        base_qty_pct: Number.isFinite(baseQtyPct) ? baseQtyPct : null,
        requested_add_qty_pct: Number.isFinite(requestedAddQtyPct) ? requestedAddQtyPct : null,
        remaining_cap_qty_pct: Number.isFinite(remainingCapQtyPct) ? remainingCapQtyPct : null,
        add_fraction: Number.isFinite(cfg.addFraction) ? cfg.addFraction : null,
      },
    };
  }

  return {
    enabled: true,
    ok: true,
    addQtyPct,
    detail: {
      scenario: cfg.scenarioKey,
      tier,
      side,
      add_fraction: cfg.addFraction,
      base_qty_pct: Number(baseQtyPct.toFixed(6)),
      requested_add_qty_pct: Number(requestedAddQtyPct.toFixed(6)),
      add_qty_pct: Number(addQtyPct.toFixed(6)),
      remaining_cap_qty_pct: Number(remainingCapQtyPct.toFixed(6)),
      auto_shrunk: requestedAddQtyPct > addQtyPct + POS_SIZE_EPSILON,
      loss_pct: Number(lossPct.toFixed(4)),
      upnl_pct: Number((upnlFrac * 100).toFixed(4)),
      stop_distance_pct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(4)) : null,
      regime: regime || null,
      add_count: effectiveAddCount,
      persisted_add_count: addCount,
      max_adds: cfg.maxAdds,
      signal_bar_ms: signalMs,
    },
  };
}

function inferEntryMetaDirection(posMeta) {
  const signalType = String(posMeta && posMeta.entry_signal_type || "").toUpperCase();
  if (signalType.includes("SHORT") || signalType.includes("SELL")) return "SHORT";
  if (signalType.includes("LONG") || signalType.includes("BUY")) return "LONG";

  const entryEventId = String(posMeta && posMeta.entry_event_id || "").toUpperCase();
  if (entryEventId.includes("SHORT") || entryEventId.includes("SELL")) return "SHORT";
  if (entryEventId.includes("LONG") || entryEventId.includes("BUY")) return "LONG";
  return null;
}

function buildTimeStopExitSignal({ position, bar, posMeta, barCloseMs, signalTfMs, maxHoldBars }) {
  if (!Number.isFinite(signalTfMs) || signalTfMs <= 0) return null;
  if (!Number.isFinite(maxHoldBars) || maxHoldBars <= 0) return null;
  const pos = position || {};
  const state = String(pos.state || "").toUpperCase();
  const size = Number(pos.size_pct || 0);
  if (state !== "ACTIVE" || !Number.isFinite(size) || size <= 0) return null;
  const entryMs = Number(posMeta && posMeta.entry_exec_bar_ms);
  if (!Number.isFinite(entryMs) || entryMs <= 0) return null;
  const positionSide = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  ) || "LONG";
  const entryMetaDir = inferEntryMetaDirection(posMeta);
  if (entryMetaDir && entryMetaDir !== positionSide) return null;
  const rules = resolveExitRulesForPosition({
    exchange: pos.exchange || "BINANCEFUT",
    position: { ...pos, meta: posMeta || {} },
  });
  const preTp1Done = posMeta && posMeta.tp_p1_done === true;
  const rawEntryGrade = String(posMeta && (posMeta.entry_grade || posMeta.entry_timing_tier || posMeta.entry_tier) || "").trim().toUpperCase();
  const entryGrade = rawEntryGrade === "CORE" ? "CORE" : "EARLY";
  const preTp1MaxHoldBars = Number(
    entryGrade === "CORE"
      ? rules && rules.PRE_TP1_TIME_STOP_BARS_CORE
      : rules && rules.PRE_TP1_TIME_STOP_BARS_EARLY
  );
  const progressFraction = Number(rules && rules.PRE_TP1_TIME_STOP_PROGRESS_FRACTION);
  const leverageEff = resolvePositionLeverage({ position: pos, fallback: 1 });
  const requiredHoldBars = (preTp1Done !== true && Number.isFinite(preTp1MaxHoldBars) && preTp1MaxHoldBars > 0)
    ? preTp1MaxHoldBars
    : maxHoldBars;
  const barsHeld = Math.floor((Number(barCloseMs) - entryMs) / signalTfMs);
  if (!Number.isFinite(barsHeld) || barsHeld < requiredHoldBars) return null;
  const pnlPctRaw = computeUnrealizedPnlPct({ position: pos, bar, positionSide });
  if (!Number.isFinite(pnlPctRaw)) return null;
  const pnlPct = pnlPctRaw * (Number.isFinite(leverageEff) && leverageEff > 0 ? leverageEff : 1);
  const preTp1TimeStopActive = preTp1Done !== true
    && Number.isFinite(preTp1MaxHoldBars)
    && preTp1MaxHoldBars > 0
    && barsHeld >= preTp1MaxHoldBars;
  if (!preTp1TimeStopActive && pnlPct > 0) return null;
  let preTp1ProgressRequired = null;
  if (preTp1TimeStopActive) {
    const tp1Pct = Number(rules && rules.TP_P1);
    preTp1ProgressRequired = Number.isFinite(tp1Pct) && tp1Pct > 0 && Number.isFinite(progressFraction) && progressFraction > 0
      ? tp1Pct * progressFraction
      : null;
    if (Number.isFinite(preTp1ProgressRequired) && pnlPct >= preTp1ProgressRequired) return null;
  } else if (pnlPct > 0) {
    return null;
  }
  const exitSide = positionSide === "SHORT" ? "BUY" : "SELL";
  return {
    event: `EXIT_TIME_STOP_${requiredHoldBars}B`,
    side: exitSide,
    qty_pct: size,
    reason: preTp1TimeStopActive ? "EXIT_TIME_STOP_PRE_TP1" : "EXIT_TIME_STOP",
    features: {
      bars_held: barsHeld,
      max_hold_bars: requiredHoldBars,
      pnl_pct: pnlPct,
      pnl_pct_raw: pnlPctRaw,
      avg_px: Number(pos.avg_price),
      ref_px: Number(bar && (bar.close ?? bar.c ?? bar.closePrice)),
      position_side: positionSide,
      time_stop_scope: preTp1TimeStopActive ? "PRE_TP1" : "STANDARD",
      pre_tp1_time_stop: preTp1TimeStopActive,
      pre_tp1_time_stop_entry_grade: preTp1TimeStopActive ? entryGrade : null,
      pre_tp1_time_stop_max_hold_bars: preTp1TimeStopActive ? preTp1MaxHoldBars : null,
      pre_tp1_progress_fraction_required: preTp1TimeStopActive && Number.isFinite(progressFraction) ? progressFraction : null,
      pre_tp1_progress_pct_required: preTp1TimeStopActive && Number.isFinite(preTp1ProgressRequired) ? preTp1ProgressRequired : null,
      pre_tp1_progress_pct_actual: preTp1TimeStopActive ? pnlPct : null,
      openclaw_market_regime_cohort: normalizeOpenClawCohort(posMeta && posMeta.openclaw_market_regime_cohort),
    },
  };
}

function canEvaluateInternalExitSignalsForBar({ posMeta, barCloseMs }) {
  const entryExecMs = Number(posMeta && posMeta.entry_exec_bar_ms);
  const currentBarMs = Number(barCloseMs);
  if (!Number.isFinite(entryExecMs) || entryExecMs <= 0) return true;
  if (!Number.isFinite(currentBarMs)) return true;
  return currentBarMs > entryExecMs;
}

function finalizeInternalSignals({ signals, posMeta, barCloseMs, fallbackUtc, exchange, symbol }) {
  const list = Array.isArray(signals) ? signals : [];
  const currentBarMs = Number(barCloseMs);
  const currentBarUtc = Number.isFinite(currentBarMs) ? msToUtcZ(currentBarMs) : (fallbackUtc || null);
  return list.reduce((acc, s) => {
    const intent = intentFromSignal({ event: s && s.event, side: s && s.side, features: s && s.features });
    if (intent === "EXIT" && !canEvaluateInternalExitSignalsForBar({ posMeta, barCloseMs: currentBarMs })) {
      console.warn("[INTERNAL_EXIT_STALE_BAR_SKIP]", {
        exchange,
        symbol,
        event: s && s.event,
        bar_close_ms: Number.isFinite(currentBarMs) ? currentBarMs : null,
        entry_exec_bar_ms: Number(posMeta && posMeta.entry_exec_bar_ms) || null,
      });
      return acc;
    }
    acc.push({
      ...s,
      signal_bar_close_time_utc_ms: Number.isFinite(currentBarMs) ? currentBarMs : null,
      signal_bar_close_time_utc: currentBarUtc,
    });
    return acc;
  }, []);
}

async function loadServerNativeInitialSignals({ exchange, symbol, signalTf, barCloseMs } = {}) {
  if (!symbol || !signalTf || !Number.isFinite(Number(barCloseMs))) return [];
  try {
    let [bars, htfBars] = await Promise.all([
      queryBars({ exchange, symbol, tf: signalTf, limit: 220 }),
      queryBars({ exchange, symbol, tf: SERVER_NATIVE_HTF_TF, limit: 120 }),
    ]);
    if (!Array.isArray(htfBars) || !htfBars.length) {
      const requiredBaseBars = minBaseBarsForDerivedHtf({ sourceTf: signalTf });
      if (requiredBaseBars > 220) {
        const expandedBars = await queryBars({ exchange, symbol, tf: signalTf, limit: requiredBaseBars });
        if (Array.isArray(expandedBars) && expandedBars.length > bars.length) bars = expandedBars;
      }
    }
    return buildServerNativeInitialSignals({
      exchange,
      symbol,
      tf: signalTf,
      bars,
      htfBars,
      barCloseMs: Number(barCloseMs),
    });
  } catch (e) {
    console.warn("[SERVER_NATIVE_INITIAL_SIGNAL_FAIL]", {
      exchange,
      symbol,
      tf: signalTf,
      bar_close_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
      error: e && e.message ? e.message : String(e),
    });
    return [];
  }
}

function dedupeEntrySignalsByFamily(signals = []) {
  const rows = Array.isArray(signals) ? signals : [];
  const seen = new Set();
  const out = [];
  for (const s of rows) {
    const intent = intentFromSignal({ event: s && s.event, side: s && s.side, features: s && s.features });
    if (intent === "ENTRY" || intent === "ADD") {
      const dir = directionFromSignal({ event: s && s.event, side: s && s.side });
      const tier = resolveEntryQualityTier(String(s && s.event || "").toUpperCase(), s && s.features);
      const family = `${intent}__${dir || "NA"}__${tier || "NA"}`;
      if (seen.has(family)) continue;
      seen.add(family);
    }
    out.push(s);
  }
  return out;
}

function hasPositionSize(sizePct) {
  const n = Number(sizePct);
  if (!Number.isFinite(n)) return false;
  return n > POS_SIZE_EPSILON;
}

function mergeMeta(base, patch) {
  const out = (base && typeof base === "object") ? { ...base } : {};
  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      out[k] = v;
    }
  }
  return out;
}

function isTpP1EventLocal(ev) {
  const e = String(ev || "").toUpperCase();
  return e === "EXIT_TP_P1" || e.startsWith("EXIT_TP_P1_");
}

function isTpP0EventLocal(ev) {
  const e = String(ev || "").toUpperCase();
  return e === "EXIT_TP_P0" || e.startsWith("EXIT_TP_P0_");
}

function resolveTrailDelayConfigForMeta({ exchange = null, pos = null, posMeta = null } = {}) {
  const mergedMeta = posMeta && typeof posMeta === "object"
    ? posMeta
    : ((pos && typeof pos.meta === "object") ? pos.meta : {});
  const rules = resolveExitRulesForPosition({
    exchange,
    position: pos && typeof pos === "object"
      ? { ...pos, meta: mergedMeta }
      : { meta: mergedMeta },
  });
  return {
    barsRequired: Number.isFinite(Number(rules && rules.TRAIL_DELAY_BARS))
      ? Math.max(0, Math.round(Number(rules.TRAIL_DELAY_BARS)))
      : null,
    mfePctRequired: Number.isFinite(Number(rules && rules.TRAIL_DELAY_MFE_PCT))
      ? Math.max(0, Number(rules.TRAIL_DELAY_MFE_PCT))
      : null,
  };
}

async function loadRecentFillsCache(db) {
  const now = Date.now();
  if (recentFillsCache.ts && (now - recentFillsCache.ts) < TP_P1_FILL_CACHE_TTL_MS) {
    return recentFillsCache.rows || [];
  }
  const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(TP_P1_FILL_CACHE_LIMIT).get();
  const rows = [];
  snap.forEach((d) => rows.push(d.data() || {}));
  recentFillsCache.ts = now;
  recentFillsCache.rows = rows;
  return rows;
}

function pickLatestTpP1Fill(rows, exchange, symbol) {
  const ex = String(exchange || "").toUpperCase();
  const sym = String(symbol || "");
  let best = null;
  let bestMs = null;
  for (const r of rows || []) {
    if (!r) continue;
    if (String(r.exchange || "").toUpperCase() !== ex) continue;
    const rSym = String(r.symbol || r.symbol_or_pair_id || r.market || "");
    if (rSym !== sym) continue;
    if (!isTpP1EventLocal(r.event)) continue;
    const ms = Number(r.exec_bar_close_time_utc_ms) || Date.parse(String(r.created_at || ""));
    if (!Number.isFinite(ms)) continue;
    if (!best || ms > bestMs) {
      best = r;
      bestMs = ms;
    }
  }
  return best;
}

function reconcileTpP1MetaFromFill({ posMeta, pos, fill } = {}) {
  if (!fill || !posMeta || posMeta.tp_p1_done === true) return posMeta;
  if (posMeta.tp_p1_pending !== true) return posMeta;
  const fillEntry = fill.entry_event_id || fill.entryEventId || null;
  const metaEntry = posMeta.entry_event_id || null;
  if (fillEntry && metaEntry && fillEntry !== metaEntry) return posMeta;
  const entryExecMs = Number(posMeta.entry_exec_bar_ms);
  const fillMs = Number(fill.exec_bar_close_time_utc_ms) || Date.parse(String(fill.created_at || ""));
  if (Number.isFinite(entryExecMs) && Number.isFinite(fillMs) && (fillMs + 30000) < entryExecMs) {
    return posMeta;
  }
  const execPrice = Number(fill.exec_price);
  const trailDelayCfg = resolveTrailDelayConfigForMeta({
    exchange: pos && pos.exchange ? pos.exchange : (posMeta && posMeta.exchange ? posMeta.exchange : null),
    pos,
    posMeta,
  });
  const side = String(
    (pos && (pos.position_side || pos.side)) ||
    posMeta.position_side ||
    posMeta.external_side ||
    posMeta.external_position_side ||
    "LONG"
  ).toUpperCase();
  const patch = {
    tp_p1_done: true,
    tp_p1_price: Number.isFinite(execPrice) ? execPrice : (posMeta.tp_p1_price ?? null),
    tp_p1_target_price: Number.isFinite(Number(posMeta.tp_p1_target_price))
      ? Number(posMeta.tp_p1_target_price)
      : computeTpP1TargetPrice({
          exchange: pos && pos.exchange,
          position: pos,
          posMeta,
          fillPrice: execPrice,
        }),
    trail_active: false,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_bar_ms: Number.isFinite(fillMs) ? fillMs : null,
    tp_p1_at: fill.created_at || new Date().toISOString(),
    tp_p1_source: "FILL_RECONCILE",
    tp_p1_entry_event_id: metaEntry || fillEntry || null,
    tp_p1_entry_exec_bar_ms: Number.isFinite(entryExecMs) ? entryExecMs : null,
    trail_delay_bars_required: trailDelayCfg.barsRequired,
    trail_delay_mfe_pct_required: trailDelayCfg.mfePctRequired,
    trail_delay_release_reason: null,
    trail_delay_release_at: null,
    trail_delay_mode: "ONE_BAR_OR_MFE",
  };
  if (side === "SHORT") {
    if (Number.isFinite(execPrice)) patch.trail_low = execPrice;
  } else if (Number.isFinite(execPrice)) {
    patch.trail_high = execPrice;
  }
  return mergeMeta(posMeta, patch);
}

async function applyTpP1SkipOnCancel({
  exchange,
  symbol,
  pos,
  posMeta,
  event,
  reason,
  note,
  bar,
  runId,
  executionMode,
} = {}) {
  const ev = String(event || "").toUpperCase();
  if (!(ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_"))) return posMeta;
  const reasonKey = String(reason || "").toUpperCase();
  if (!TP_P1_SKIP_REASONS.has(reasonKey)) return posMeta;
  const state = String(pos && pos.state || "").toUpperCase();
  if (state !== "ACTIVE") return posMeta;
  if (posMeta && posMeta.tp_p1_done === true) return posMeta;
  const keepFullAndTrail = reasonKey.startsWith("TP_P1_");
  const entryEventId = String((posMeta && posMeta.entry_event_id) || "").trim() || null;
  const entryExecMs = Number(posMeta && posMeta.entry_exec_bar_ms);
  const nowIso = new Date().toISOString();
  const side = normalizePositionSide(
    (pos && (pos.position_side || pos.side)) ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  ) || "LONG";
  const refPx = Number(
    (bar && (bar.close ?? bar.c ?? bar.open ?? bar.o)) ??
    (pos && pos.avg_price) ??
    NaN
  );
  const prevTrailHigh = Number(posMeta && posMeta.trail_high);
  const prevTrailLow = Number(posMeta && posMeta.trail_low);
  const trailHigh = side === "SHORT"
    ? null
    : (Number.isFinite(refPx) ? refPx : (Number.isFinite(prevTrailHigh) ? prevTrailHigh : null));
  const trailLow = side === "SHORT"
    ? (Number.isFinite(refPx) ? refPx : (Number.isFinite(prevTrailLow) ? prevTrailLow : null))
    : null;
  const trailDelayCfg = keepFullAndTrail
    ? resolveTrailDelayConfigForMeta({ exchange, pos, posMeta })
    : { barsRequired: null, mfePctRequired: null };

  const merged = mergeMeta(posMeta, {
    tp_p1_done: true,
    tp_p1_price: keepFullAndTrail && Number.isFinite(refPx) ? refPx : null,
    tp_p1_target_price: keepFullAndTrail
      ? computeTpP1TargetPrice({
          exchange,
          position: pos,
          posMeta,
          fillPrice: refPx,
        })
      : null,
    trail_high: keepFullAndTrail ? trailHigh : null,
    trail_low: keepFullAndTrail ? trailLow : null,
    trail_active: false,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_bar_ms: Number(bar && (bar.bar_close_time_utc_ms || bar.bar_close_time_utc || bar.t)) || null,
    tp_p1_at: keepFullAndTrail ? nowIso : null,
    tp_p1_source: keepFullAndTrail ? "TP1_SKIP_PROTECT" : null,
    tp_p1_entry_event_id: keepFullAndTrail ? entryEventId : null,
    tp_p1_entry_exec_bar_ms: keepFullAndTrail && Number.isFinite(entryExecMs) ? entryExecMs : null,
    trail_delay_bars_required: trailDelayCfg.barsRequired,
    trail_delay_mfe_pct_required: trailDelayCfg.mfePctRequired,
    trail_delay_release_reason: null,
    trail_delay_release_at: null,
    trail_delay_mode: keepFullAndTrail ? "ONE_BAR_OR_MFE" : null,
    tp_p1_skip_reason: reasonKey,
    tp_p1_skip_note: note || null,
    tp_p1_skip_at: nowIso,
  });

  await upsertPosition({
    exchange,
    symbol,
    state: pos.state,
    positionSide: pos.position_side || null,
    sizePct: pos.size_pct,
    avgPrice: pos.avg_price,
    qtyBase: pos.qty_base ?? null,
    runId,
    executionMode: executionMode || null,
    budgetMaxKrw: pos.budget_max_krw ?? null,
    budgetUsedKrw: pos.budget_used_krw ?? null,
    budgetSource: pos.budget_source ?? null,
    meta: merged,
  });

  return merged;
}

function normalizeBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return fallback;
}

function resolveForceAllSignalsAdd(sysCfg = {}, exchange = "") {
  if (resolveLiveRescueAddConfig(sysCfg, exchange).enabled === true) return false;
  const envRaw = process.env.FORCE_ALL_SIGNALS_ADD;
  if (envRaw !== undefined) return normalizeBool(envRaw, false);
  if (Object.prototype.hasOwnProperty.call(sysCfg || {}, "force_all_signals_add")) {
    return normalizeBool(sysCfg.force_all_signals_add, false);
  }
  const ex = String(exchange || "").toUpperCase();
  // LONG/SHORT 단일 진입 구조에서는 동일방향 재신호를 자동 ADD로 승격하지 않는다.
  // ADD는 rescue add 조건을 충족한 경우에만 명시적으로 허용한다.
  if (ex.includes("BINANCEFUT")) return false;
  return normalizeBool((sysCfg || {}).force_all_signals_add, false);
}

function hasAiSignal(features) {
  if (!features || typeof features !== "object") return false;
  const ai = features.ai_signal;
  if (!ai || typeof ai !== "object") return false;
  return Object.keys(ai).length > 0;
}

function isAiRequired(exchange) {
  if (!normalizeBool(process.env.SIGNAL_AI_ENABLED, false)) return false;
  const ex = String(exchange || "").toUpperCase();
  return ex.includes("BINANCE");
}

function resolveAiMissingPolicy({ qtyFraction, features, sysCfg } = {}) {
  const rawPolicy = String(
    (sysCfg && sysCfg.ai_missing_policy) ||
    AI_FAIL_MODE ||
    "ALLOW"
  ).trim().toUpperCase();
  const policy = rawPolicy === "ALLOW" || rawPolicy === "REDUCE" || rawPolicy === "BLOCK"
    ? rawPolicy
    : "ALLOW";
  const configuredReducePct = Number(sysCfg && sysCfg.ai_missing_reduce_pct);
  const reducePct = Number.isFinite(configuredReducePct)
    ? Math.min(1, Math.max(0, configuredReducePct))
    : AI_MISSING_REDUCE_PCT;
  const featureBase = {
    ...(features || {}),
    ai_required: true,
    ai_missing_policy: policy,
    ai_missing_reduce_pct: reducePct,
  };

  if (policy === "REDUCE") {
    const reducedQty = Number(qtyFraction) * reducePct;
    if (!Number.isFinite(reducedQty) || reducedQty <= 0) {
      return {
        drop: true,
        reason: "DROP_AI_MISSING_ZERO_QTY",
        features: {
          ...featureBase,
          ai_missing_fallback: "REDUCE",
          ai_missing_reduce_pct: reducePct,
        },
      };
    }
    return {
      drop: false,
      qtyFraction: reducedQty,
      features: {
        ...featureBase,
        ai_missing_fallback: "REDUCE",
        ai_missing_reduce_pct: reducePct,
      },
    };
  }

  if (policy === "ALLOW") {
    return {
      drop: false,
      qtyFraction,
      features: {
        ...featureBase,
        ai_missing_fallback: "ALLOW",
      },
    };
  }

  return {
    drop: true,
    reason: "DROP_AI_MISSING",
    features: featureBase,
  };
}

function normalizeInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function scaleBaseBarCountByTf(baseBars, signalTfMs) {
  const base = normalizeInt(baseBars, 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(signalTfMs) || signalTfMs <= 0) return base;
  const tf60mMs = 60 * 60 * 1000;
  const scaled = Math.round(base * (tf60mMs / signalTfMs));
  return Math.max(1, scaled);
}

function resolveBinanceMaxHoldBars(sysCfg, signalTfMs) {
  const envDefault = normalizeInt(process.env.BINANCE_MAX_HOLD_BARS, 12);
  const fallback = Number.isFinite(envDefault) && envDefault > 0 ? envDefault : 12;
  const configured = Math.max(0, normalizeInt(sysCfg && sysCfg.max_hold_bars, fallback));
  return scaleBaseBarCountByTf(configured, signalTfMs);
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveSignalScaledFlags(features) {
  const f = (features && typeof features === "object") ? features : {};
  const commissionScale = normalizeNumber(f.commission_scale, 1);
  const mddReduceFactor = normalizeNumber(f.mdd_reduce_factor, 1);
  const commissionScaledInSignal = normalizeBool(f.commission_scaled_in_signal, false) === true
    || (Number.isFinite(commissionScale) && commissionScale > 0 && commissionScale < 0.9999);
  const mddScaledInSignal = normalizeBool(f.mdd_scaled_in_signal, false) === true
    || (Number.isFinite(mddReduceFactor) && mddReduceFactor > 0 && mddReduceFactor < 0.9999);
  return {
    commissionScaledInSignal,
    mddScaledInSignal,
    commissionScale: Number.isFinite(commissionScale) ? commissionScale : 1,
    mddReduceFactor: Number.isFinite(mddReduceFactor) ? mddReduceFactor : 1,
  };
}

function pickSignalScore(features) {
  if (!features || typeof features !== "object") return null;
  const keys = ["score", "score_norm", "signal_strength", "strength"];
  for (const key of keys) {
    const v = Number(features[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function pickSignalScoreExtended(features) {
  const base = pickSignalScore(features);
  if (Number.isFinite(base)) return base;
  if (!features || typeof features !== "object") return null;
  const line = features.pro_score_line || features.score_line || features.score_text || null;
  if (!line) return null;
  const m = String(line).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function pickSignalConfidence(features) {
  if (!features || typeof features !== "object") return null;
  const n = Number(features.confidence ?? features.signal_confidence ?? features.conf);
  return Number.isFinite(n) ? n : null;
}

function pickSignalWaveConf(features) {
  if (!features || typeof features !== "object") return null;
  const n = Number(features.zz_wave_conf ?? features.wave_conf ?? features.wave_confidence);
  return Number.isFinite(n) ? n : null;
}

function pickSignalConflict(features) {
  if (!features || typeof features !== "object") return null;
  if (features.pro_conflict != null) return normalizeBool(features.pro_conflict, null);
  if (features.conflict != null) return normalizeBool(features.conflict, null);
  return null;
}

function normalizeSignalStateToken(raw) {
  return normalizeSignalStateTokenShared(raw);
}

function pickSignalRegime(features) {
  if (!features || typeof features !== "object") return null;
  return resolveRegimeRecord({ features_json: features });
}

function resolveEntryStructureSnapshot({ features, intentDir, eventUpper } = {}) {
  const featureObj = (features && typeof features === "object") ? features : {};
  const dir = String(intentDir || "").toUpperCase();
  const tier = resolveEntryQualityTier(eventUpper, featureObj);
  const pineBundle = resolvePineStage1BundleMeta(featureObj);
  const regime = pickSignalRegime(featureObj);
  const score = pickSignalScoreExtended(featureObj);
  const confidence = pickSignalConfidence(featureObj);
  const waveConf = pickSignalWaveConf(featureObj);
  const posterior = pickSignalPosterior(featureObj, dir);
  const conflictLong = normalizeBool(featureObj.pro_conflict_long ?? featureObj.conflict_long, false);
  const conflictShort = normalizeBool(featureObj.pro_conflict_short ?? featureObj.conflict_short, false);
  const conflictAny = normalizeBool(featureObj.pro_conflict ?? featureObj.conflict, false);
  const conflictDir = dir === "LONG" ? conflictLong : dir === "SHORT" ? conflictShort : false;
  const scoreDirOk = dir === "LONG"
    ? Number.isFinite(score) ? score >= 0 : true
    : dir === "SHORT"
      ? Number.isFinite(score) ? score <= 0 : true
      : true;
  return {
    featureObj,
    dir,
    tier,
    pineBundle,
    regime,
    score,
    confidence,
    waveConf,
    posterior,
    conflictLong,
    conflictShort,
    conflictAny,
    conflictDir,
    scoreDirOk,
  };
}

function resolvePineStage1BundleMeta(features) {
  const f = (features && typeof features === "object") ? features : {};
  const owner = String(f.pine_stage1_bundle_owner || "").trim().toUpperCase();
  const version = String(f.pine_stage1_bundle_version || "").trim();
  const enabled = normalizeBool(f.pine_stage1_bundle_enabled, false);
  const owned = normalizeBool(f.pine_stage1_bundle_owned, false);
  const stagePass = normalizeBool(f.pine_stage1_bundle_stage_pass, false);
  const qualityRuntime = normalizeBool(f.pine_stage1_bundle_quality_filter_runtime, false);
  const trustedVersion = version === "REGIME_SCORE_CONF_POSTERIOR_WAVE_EV_V2";
  const declaredOwned = enabled === true && owner === "PINE" && owned === true;
  return {
    owner,
    version,
    enabled,
    owned,
    stagePass,
    qualityRuntime,
    declaredOwned,
    trustedVersion,
    trusted: declaredOwned && stagePass === true && qualityRuntime === true && trustedVersion === true,
  };
}

function pickSignalVolRank(features) {
  if (!features || typeof features !== "object") return null;
  const txt = String(features.pro_vol_td_txt_full || features.pro_vol_td_txt || features.vol_td_txt || "").trim();
  if (!txt) return null;
  const lower = txt.toLowerCase();
  if (lower.includes("ultra") || txt.includes("🔥")) return "ultra";
  if (lower.includes("strong") || txt.includes("💚")) return "strong";
  if (lower.includes("weak") || txt.includes("❤️")) return "weak";
  return null;
}

function resolveSignalAssetType({ exchange, features } = {}) {
  const txt = String(features && (features.pro_asset_txt || features.asset_type_txt || features.pro_market_txt) || "");
  if (txt.includes("코인") || txt.includes("Crypto") || txt.includes("Binance") || txt.includes("Upbit")) return "coin";
  if (txt.includes("주식") || txt.includes("ETF") || txt.includes("지수") || txt.includes("FX")) return "stock";
  const ex = String(exchange || "").toUpperCase();
  if (ex.includes("UPBIT") || ex.includes("BINANCE")) return "coin";
  if (ex.includes("KIWOOM") || ex.includes("KRX") || ex.includes("KOSPI") || ex.includes("KOSDAQ")) return "stock";
  return "coin";
}

function resolveScoreLevels({ exchange, features } = {}) {
  const asset = resolveSignalAssetType({ exchange, features });
  const coreBuy = asset === "coin" ? 60 : 55;
  const realBuy = asset === "coin" ? 80 : 75;
  return {
    coreBuy,
    realBuy,
    coreSell: -coreBuy,
    realSell: -realBuy,
  };
}

function resolveImmediateEntryConfig(sysCfg = {}) {
  const lookaheadBarsRaw = Math.floor(normalizeNumber(sysCfg.entry_immediate_lookahead_bars, 1));
  const lookaheadBars = Math.max(0, Math.min(1, Number.isFinite(lookaheadBarsRaw) ? lookaheadBarsRaw : 1));
  const coreFraction = clamp(normalizeNumber(sysCfg.entry_immediate_core_fraction, 0.3), 0.05, 0.95);
  return {
    enabled: normalizeBool(sysCfg.entry_immediate_enabled, true),
    lookaheadBars,
    realEnabled: normalizeBool(sysCfg.entry_immediate_real_enabled, true),
    preRealEnabled: normalizeBool(sysCfg.entry_immediate_pre_real_enabled, true),
    coreEnabled: normalizeBool(sysCfg.entry_immediate_core_enabled, true),
    earlyEnabled: normalizeBool(sysCfg.entry_immediate_early_enabled, true),
    coreFraction: Number.isFinite(coreFraction) ? coreFraction : 0.3,
    realScoreMargin: normalizeNumber(sysCfg.entry_immediate_real_score_margin, 5),
    preRealScoreMargin: normalizeNumber(sysCfg.entry_immediate_pre_real_score_margin, 2),
    coreScoreMargin: normalizeNumber(sysCfg.entry_immediate_core_score_margin, 5),
    earlyScoreAbs: Math.max(0, normalizeNumber(sysCfg.entry_immediate_early_score_abs, 20)),
    minRealConf: normalizeNumber(sysCfg.entry_immediate_real_conf_min, 0.65),
    minPreRealConf: normalizeNumber(sysCfg.entry_immediate_pre_real_conf_min, 0.58),
    minCoreConf: normalizeNumber(sysCfg.entry_immediate_core_conf_min, 0.55),
    minEarlyConf: normalizeNumber(sysCfg.entry_immediate_early_conf_min, 0.45),
    minWaveConf: normalizeNumber(sysCfg.entry_immediate_wave_conf_min, 0.65),
    minPreRealWaveConf: normalizeNumber(sysCfg.entry_immediate_pre_real_wave_conf_min, 0.60),
    minEarlyWaveConf: normalizeNumber(sysCfg.entry_immediate_early_wave_conf_min, 0.55),
  };
}

function pickGateSetting(sysCfg, key, legacyKey, fallback = undefined) {
  const cfg = (sysCfg && typeof sysCfg === "object") ? sysCfg : {};
  const vNew = cfg[key];
  if (vNew !== undefined && vNew !== null && vNew !== "") return vNew;
  if (legacyKey) {
    const vLegacy = cfg[legacyKey];
    if (vLegacy !== undefined && vLegacy !== null && vLegacy !== "") return vLegacy;
  }
  return fallback;
}

const ENTRY_TIMING_TIERS = Object.freeze(["EARLY", "CORE", "PRE_REAL", "REAL"]);

function buildTierNumberMap(values = {}, fallback = null) {
  const out = {};
  for (const tier of ENTRY_TIMING_TIERS) {
    const n = Number(values[tier]);
    out[tier] = Number.isFinite(n) ? n : fallback;
  }
  return out;
}

function pickTierNumber(map, tier, fallback = null) {
  const key = String(tier || "").toUpperCase();
  if (map && Object.prototype.hasOwnProperty.call(map, key)) {
    const n = Number(map[key]);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function resolveShortEntryGateConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCE");
  const confMin = clamp(normalizeNumber(pickGateSetting(sysCfg, "gate_conf_min", "short_gate_conf_min", 0.55), 0.55), 0, 1);
  const waveConfMin = clamp(normalizeNumber(pickGateSetting(sysCfg, "gate_wave_conf_min", "short_gate_wave_conf_min", 0.6), 0.6), 0, 1);
  const scoreAbsByTier = buildTierNumberMap({
    EARLY: Math.max(0, normalizeNumber(pickGateSetting(sysCfg, "gate_early_score_abs", "short_gate_early_score_abs", 25), 25)),
    CORE: Math.max(0, normalizeNumber(pickGateSetting(sysCfg, "gate_core_score_abs", "short_gate_core_score_abs", 35), 35)),
    PRE_REAL: Math.max(0, normalizeNumber(pickGateSetting(sysCfg, "gate_pre_real_score_abs", "short_gate_pre_real_score_abs", 40), 40)),
    REAL: Math.max(0, normalizeNumber(pickGateSetting(sysCfg, "gate_real_score_abs", "short_gate_real_score_abs", 45), 45)),
  }, 0);
  return {
    enabled: normalizeBool(pickGateSetting(sysCfg, "gate_enabled", "short_gate_enabled", defaultEnabled), defaultEnabled),
    trendOnly: normalizeBool(pickGateSetting(sysCfg, "gate_trend_only", "short_gate_trend_only", true), true),
    applyCore: normalizeBool(pickGateSetting(sysCfg, "gate_core_enabled", "short_gate_core_enabled", true), true),
    applyPreReal: false,
    applyReal: false,
    applyEarly: normalizeBool(pickGateSetting(sysCfg, "gate_early_enabled", "short_gate_early_enabled", false), false),
    scoreAbsByTier,
    minCoreScoreAbs: scoreAbsByTier.CORE,
    minPreRealScoreAbs: scoreAbsByTier.PRE_REAL,
    minRealScoreAbs: scoreAbsByTier.REAL,
    minEarlyScoreAbs: scoreAbsByTier.EARLY,
    minConfidence: Number.isFinite(confMin) ? confMin : 0.55,
    minWaveConf: Number.isFinite(waveConfMin) ? waveConfMin : 0.6,
    blockConflict: normalizeBool(pickGateSetting(sysCfg, "gate_block_conflict", "short_gate_block_conflict", true), true),
    transitionExceptionEnabled: normalizeBool(sysCfg.gate_transition_exception_enabled, true),
    transitionExceptionCoreEnabled: normalizeBool(sysCfg.gate_transition_exception_core_enabled, true),
    transitionExceptionPreRealEnabled: false,
    transitionExceptionRealEnabled: false,
    transitionExceptionEarlyEnabled: normalizeBool(sysCfg.gate_transition_exception_early_enabled, false),
    transitionExceptionScoreAbs: Math.max(0, normalizeNumber(sysCfg.gate_transition_exception_score_abs, 40)),
    transitionExceptionWaveConfMin: Number.isFinite(clamp(normalizeNumber(sysCfg.gate_transition_exception_wave_conf_min, 0.6), 0, 1))
      ? clamp(normalizeNumber(sysCfg.gate_transition_exception_wave_conf_min, 0.6), 0, 1)
      : 0.6,
  };
}

function shouldApplyGateTransitionExceptionByEvent(eventUpper, cfg, features) {
  const tier = resolveEntryQualityTier(eventUpper, features);
  if (tier === "REAL" || tier === "PRE_REAL") return false;
  if (tier === "CORE") return cfg.transitionExceptionCoreEnabled;
  if (tier === "EARLY") return cfg.transitionExceptionEarlyEnabled;
  return false;
}

function normalizeAiNeutralPolicy(raw, fallback = "allow") {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "allow" || v === "block" || v === "long_only" || v === "short_only") return v;
  return fallback;
}

function resolveAiBiasEntryGateConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCE");
  const scoreThreshold = Math.max(0, normalizeNumber(sysCfg.ai_bias_gate_score_threshold, 0.01));
  const confMin = clamp(normalizeNumber(sysCfg.ai_bias_gate_conf_min, 0), 0, 1);
  const neutralMult = clamp(normalizeNumber(sysCfg.ai_bias_gate_neutral_mult, 0.5), 0, 1);
  const oppositeMult = clamp(normalizeNumber(sysCfg.ai_bias_gate_opposite_mult, 0.35), 0, 1);
  const strongOppositeScore = clamp(normalizeNumber(sysCfg.ai_bias_gate_strong_opposite_score, 0.2), 0, 1);
  const strongOppositeConf = clamp(normalizeNumber(sysCfg.ai_bias_gate_strong_opposite_conf, 0.55), 0, 1);
  return {
    enabled: normalizeBool(sysCfg.ai_bias_gate_enabled, defaultEnabled),
    neutralPolicy: normalizeAiNeutralPolicy(sysCfg.ai_bias_gate_neutral_policy, "allow"),
    applyCore: normalizeBool(sysCfg.ai_bias_gate_core_enabled, true),
    applyPreReal: false,
    applyReal: false,
    applyEarly: normalizeBool(sysCfg.ai_bias_gate_early_enabled, false),
    applyEmo: normalizeBool(sysCfg.ai_bias_gate_emo_enabled, false),
    scoreThreshold: Number.isFinite(scoreThreshold) ? scoreThreshold : 0.01,
    confMin: Number.isFinite(confMin) ? confMin : 0,
    neutralMult: Number.isFinite(neutralMult) ? neutralMult : 0.5,
    oppositeMult: Number.isFinite(oppositeMult) ? oppositeMult : 0.35,
    strongOppositeScore: Number.isFinite(strongOppositeScore) ? strongOppositeScore : 0.2,
    strongOppositeConf: Number.isFinite(strongOppositeConf) ? strongOppositeConf : 0.55,
  };
}

function shouldApplyAiBiasEntryGateByEvent(eventUpper, cfg, features) {
  const tier = resolveEntryQualityTier(eventUpper, features);
  if (tier === "REAL" || tier === "PRE_REAL") return false;
  if (tier === "CORE") return cfg.applyCore;
  if (tier === "EARLY") return cfg.applyEarly;
  if (isEmoEventName(eventUpper)) return cfg.applyEmo;
  return false;
}

function deriveAiBiasDirection(sideAllocation, cfg) {
  const side = (sideAllocation && typeof sideAllocation === "object") ? sideAllocation : null;
  const score = Number(side && side.biasScore);
  const confidence = Number(side && side.biasConfidence);
  const rawDir = String(side && side.biasDirection || "").toUpperCase();
  const threshold = Number.isFinite(cfg && cfg.scoreThreshold) ? Math.max(0, cfg.scoreThreshold) : 0;
  const confMin = Number.isFinite(cfg && cfg.confMin) ? Math.max(0, cfg.confMin) : 0;

  if (confMin > 0 && Number.isFinite(confidence) && confidence < confMin) {
    return { dir: "NEUTRAL", score: Number.isFinite(score) ? score : null, confidence: Number.isFinite(confidence) ? confidence : null };
  }
  if (rawDir === "LONG" || rawDir === "SHORT") {
    return { dir: rawDir, score: Number.isFinite(score) ? score : null, confidence: Number.isFinite(confidence) ? confidence : null };
  }
  if (!Number.isFinite(score)) {
    return { dir: "NEUTRAL", score: null, confidence: Number.isFinite(confidence) ? confidence : null };
  }
  if (threshold > 0 && score >= threshold) return { dir: "LONG", score, confidence: Number.isFinite(confidence) ? confidence : null };
  if (threshold > 0 && score <= -threshold) return { dir: "SHORT", score, confidence: Number.isFinite(confidence) ? confidence : null };
  return { dir: "NEUTRAL", score, confidence: Number.isFinite(confidence) ? confidence : null };
}

function evaluateAiBiasEntryGate({ intent, intentDir, eventUpper, features, cfg, riskBudget } = {}) {
  if (!cfg || cfg.enabled !== true) return { ok: true, action: "ALLOW", qtyScale: 1 };
  if (intent !== "ENTRY" && intent !== "ADD") return { ok: true, action: "ALLOW", qtyScale: 1 };
  const dir = String(intentDir || "").toUpperCase();
  if (dir !== "LONG" && dir !== "SHORT") return { ok: true, action: "ALLOW", qtyScale: 1 };
  if (!shouldApplyAiBiasEntryGateByEvent(eventUpper, cfg, features)) return { ok: true, action: "ALLOW", qtyScale: 1 };

  const ai = deriveAiBiasDirection(riskBudget && riskBudget.sideAllocation, cfg);
  const marketState = resolveMarketStateSummary(features);
  const entropy = marketState.entropy;
  const coherence = marketState.coherence;
  const transitionRisk = marketState.transitionRisk;
  const fieldAlignment = marketState.fieldAlignment;
  const domainWallDensity = marketState.domainWallDensity;
  const susceptibility = marketState.susceptibility;
  const freeEnergy = marketState.freeEnergy;
  let reason = null;
  let qtyScale = 1;
  let action = "ALLOW";
  const absScore = Math.abs(Number(ai.score));
  const conf = Number(ai.confidence);
  const strongOpposite = Number.isFinite(absScore)
    && absScore >= Number(cfg.strongOppositeScore)
    && Number.isFinite(conf)
    && conf >= Number(cfg.strongOppositeConf);

  if (ai.dir === "LONG" && dir === "SHORT") {
    reason = strongOpposite ? "DROP_AI_BIAS_OPPOSITE_LONG" : null;
    qtyScale = strongOpposite ? 0 : Number(cfg.oppositeMult);
    action = strongOpposite ? "DROP" : "REDUCE";
  } else if (ai.dir === "SHORT" && dir === "LONG") {
    reason = strongOpposite ? "DROP_AI_BIAS_OPPOSITE_SHORT" : null;
    qtyScale = strongOpposite ? 0 : Number(cfg.oppositeMult);
    action = strongOpposite ? "DROP" : "REDUCE";
  }
  else if (ai.dir === "NEUTRAL") {
    if (cfg.neutralPolicy === "block") reason = "DROP_AI_BIAS_NEUTRAL_BLOCK";
    else if (cfg.neutralPolicy === "long_only" && dir === "SHORT") reason = "DROP_AI_BIAS_NEUTRAL_LONG_ONLY";
    else if (cfg.neutralPolicy === "short_only" && dir === "LONG") reason = "DROP_AI_BIAS_NEUTRAL_SHORT_ONLY";
    else {
      qtyScale = Number(cfg.neutralMult);
      action = qtyScale < 0.9999 ? "REDUCE" : "ALLOW";
    }
  }

  let physicsScale = 1;
  let physicsAction = "ALLOW";
  if (!reason) {
    physicsScale = Number.isFinite(Number(marketState.physicsQtyScale))
      ? Math.max(0, Math.min(1, Number(marketState.physicsQtyScale)))
      : 1;
    physicsAction = marketState.physicsAction || "ALLOW";
    if (marketState.physicsDrop === true || physicsAction === "DROP" || physicsScale <= 0) {
      reason = "DROP_MARKET_PHYSICS_DISORDER";
      physicsAction = "DROP";
    }
  }

  qtyScale = Math.max(0, Math.min(Number.isFinite(qtyScale) ? qtyScale : 1, physicsScale));
  if (!reason) {
    if (qtyScale <= 0) action = "DROP";
    else if (qtyScale < 0.9999 || physicsAction === "REDUCE") action = "REDUCE";
  }

  if (!reason) {
    return {
      ok: true,
      action,
      qtyScale: Number.isFinite(qtyScale) ? Math.max(0, qtyScale) : 1,
      detail: {
        ai_bias_dir: ai.dir,
        ai_bias_score: ai.score,
        ai_bias_confidence: ai.confidence,
        ai_bias_gate_action: action,
        ai_bias_gate_qty_scale: Number.isFinite(qtyScale) ? Math.max(0, qtyScale) : 1,
        ai_bias_gate_neutral_mult: cfg.neutralMult,
        ai_bias_gate_opposite_mult: cfg.oppositeMult,
        ai_bias_gate_strong_opposite_score: cfg.strongOppositeScore,
        ai_bias_gate_strong_opposite_conf: cfg.strongOppositeConf,
        sp_entropy_score: Number.isFinite(entropy) ? entropy : null,
        sp_coherence_score: Number.isFinite(coherence) ? coherence : null,
        sp_transition_risk: Number.isFinite(transitionRisk) ? transitionRisk : null,
        sp_field_alignment: Number.isFinite(fieldAlignment) ? fieldAlignment : null,
        sp_domain_wall_density: Number.isFinite(domainWallDensity) ? domainWallDensity : null,
        sp_susceptibility: Number.isFinite(susceptibility) ? susceptibility : null,
        sp_free_energy: Number.isFinite(freeEnergy) ? freeEnergy : null,
        sp_state: marketState.state || null,
        market_state_regime: marketState.regime,
        market_state_summary_state: marketState.state || null,
        market_state_summary_action: marketState.physicsAction,
        market_state_summary_qty_scale: marketState.physicsQtyScale,
        market_state_structural_critical: marketState.structuralCritical === true,
        market_physics_qty_scale: physicsScale,
        market_physics_action: physicsAction,
      },
    };
  }

  return {
    ok: false,
    action: "DROP",
    qtyScale: 0,
    reason,
    detail: {
      ai_bias_dir: ai.dir,
      ai_bias_score: ai.score,
      ai_bias_confidence: ai.confidence,
      ai_bias_policy: cfg.neutralPolicy,
      ai_bias_conf_min: cfg.confMin,
      ai_bias_score_threshold: cfg.scoreThreshold,
      ai_bias_gate_action: "DROP",
      ai_bias_gate_qty_scale: 0,
      ai_bias_gate_neutral_mult: cfg.neutralMult,
      ai_bias_gate_opposite_mult: cfg.oppositeMult,
      ai_bias_gate_strong_opposite_score: cfg.strongOppositeScore,
      ai_bias_gate_strong_opposite_conf: cfg.strongOppositeConf,
      sp_entropy_score: Number.isFinite(entropy) ? entropy : null,
      sp_coherence_score: Number.isFinite(coherence) ? coherence : null,
      sp_transition_risk: Number.isFinite(transitionRisk) ? transitionRisk : null,
      sp_field_alignment: Number.isFinite(fieldAlignment) ? fieldAlignment : null,
      sp_domain_wall_density: Number.isFinite(domainWallDensity) ? domainWallDensity : null,
      sp_susceptibility: Number.isFinite(susceptibility) ? susceptibility : null,
      sp_free_energy: Number.isFinite(freeEnergy) ? freeEnergy : null,
      sp_state: marketState.state || null,
      market_state_regime: marketState.regime,
      market_state_summary_state: marketState.state || null,
      market_state_summary_action: marketState.physicsAction,
      market_state_summary_qty_scale: marketState.physicsQtyScale,
      market_state_structural_critical: marketState.structuralCritical === true,
      market_physics_qty_scale: physicsScale,
      market_physics_action: physicsAction,
    },
  };
}

function resolveAddRiskConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCEFUT");
  const enabled = normalizeBool(sysCfg.add_guard_enabled, defaultEnabled);
  const softDrawdownRaw = normalizeNumber(sysCfg.add_guard_soft_drawdown_pct, -0.004);
  const hardDrawdownRaw = normalizeNumber(sysCfg.add_guard_hard_drawdown_pct, -0.01);
  const softDrawdownPct = softDrawdownRaw > 0 ? -softDrawdownRaw : softDrawdownRaw;
  const hardDrawdownPct = hardDrawdownRaw > 0 ? -hardDrawdownRaw : hardDrawdownRaw;
  const softScaleRaw = clamp(normalizeNumber(sysCfg.add_guard_soft_scale, 0.75), 0.05, 1.0);
  const hardScaleRaw = clamp(normalizeNumber(sysCfg.add_guard_hard_scale, 0.50), 0.05, 1.0);
  const softScale = Number.isFinite(softScaleRaw) ? softScaleRaw : 0.75;
  const hardScale = Number.isFinite(hardScaleRaw) ? hardScaleRaw : 0.50;
  const minQtyRaw = clamp(normalizeNumber(sysCfg.add_guard_min_qty_fraction, 0.003), 0.0001, 1.0);
  const minQtyFraction = Number.isFinite(minQtyRaw) ? minQtyRaw : 0.003;
  const maxLossStreakRaw = normalizeInt(sysCfg.add_guard_max_loss_streak, null);
  const maxLossStreak = Number.isFinite(maxLossStreakRaw) && maxLossStreakRaw > 0
    ? Math.max(1, maxLossStreakRaw)
    : null;
  const dayLossCapRaw = normalizeNumber(sysCfg.add_guard_day_loss_cap_krw, null);
  const dayLossCapKrw = Number.isFinite(dayLossCapRaw) && dayLossCapRaw > 0 ? dayLossCapRaw : null;
  const blockHardDrawdown = normalizeBool(sysCfg.add_guard_block_hard_drawdown, false);
  return {
    enabled,
    softDrawdownPct,
    hardDrawdownPct,
    softScale,
    hardScale,
    minQtyFraction,
    maxLossStreak,
    dayLossCapKrw,
    blockHardDrawdown,
  };
}

function toUtcDayKey(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function resolveAddGuardState(posMeta, barCloseMs) {
  const meta = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const dayKey = toUtcDayKey(barCloseMs) || String(meta.add_guard_day_key || "") || null;
  const storedDayKey = String(meta.add_guard_day_key || "");
  const dayChanged = !!dayKey && storedDayKey !== dayKey;
  const basePnl = Number(meta.add_guard_day_pnl_krw);
  const baseLossStreak = Number(meta.add_guard_day_loss_streak);
  const baseRealizedN = Number(meta.add_guard_day_realized_n);
  const addChainCountRaw = Number(meta.add_chain_count);
  return {
    dayKey,
    dayChanged,
    dayPnl: dayChanged ? 0 : (Number.isFinite(basePnl) ? basePnl : 0),
    lossStreak: dayChanged ? 0 : (Number.isFinite(baseLossStreak) ? Math.max(0, Math.trunc(baseLossStreak)) : 0),
    realizedN: dayChanged ? 0 : (Number.isFinite(baseRealizedN) ? Math.max(0, Math.trunc(baseRealizedN)) : 0),
    addChainCount: Number.isFinite(addChainCountRaw) ? Math.max(0, Math.trunc(addChainCountRaw)) : 0,
  };
}

function evaluateAddIntentRiskGuard({
  cfg,
  intent,
  position,
  posMeta,
  bar,
  barCloseMs,
  qtyFraction,
} = {}) {
  if (!cfg || cfg.enabled !== true || intent !== "ADD") return { ok: true, qtyScale: 1 };
  const pos = position || {};
  const size = Number(pos.size_pct || 0);
  if (!Number.isFinite(size) || size <= POS_SIZE_EPSILON) return { ok: true, qtyScale: 1 };
  const state = resolveAddGuardState(posMeta, barCloseMs);
  if (Number.isFinite(cfg.dayLossCapKrw) && state.dayPnl <= -cfg.dayLossCapKrw) {
    return {
      ok: false,
      reason: "DROP_ADD_DAY_LOSS_CAP",
      detail: { day_pnl_krw: state.dayPnl, day_loss_cap_krw: cfg.dayLossCapKrw },
    };
  }
  if (Number.isFinite(cfg.maxLossStreak) && state.lossStreak >= cfg.maxLossStreak) {
    return {
      ok: false,
      reason: "DROP_ADD_DAY_STREAK",
      detail: { day_loss_streak: state.lossStreak, max_loss_streak: cfg.maxLossStreak },
    };
  }
  const side = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
  ) || "LONG";
  const leverageEff = resolvePositionLeverage({ position: pos, fallback: 1 });
  const rawUpnlPct = computeUnrealizedPnlPct({ position: pos, bar, positionSide: side });
  const upnlPct = Number.isFinite(rawUpnlPct)
    ? (rawUpnlPct * (Number.isFinite(leverageEff) && leverageEff > 0 ? leverageEff : 1))
    : null;
  let qtyScale = 1;
  if (Number.isFinite(upnlPct)) {
    if (upnlPct <= cfg.hardDrawdownPct) {
      if (cfg.blockHardDrawdown) {
        return {
          ok: false,
          reason: "DROP_ADD_DRAWDOWN_HARD",
          detail: { upnl_pct: upnlPct, hard_drawdown_pct: cfg.hardDrawdownPct },
        };
      }
      qtyScale = Math.min(qtyScale, cfg.hardScale);
    } else if (upnlPct <= cfg.softDrawdownPct) {
      qtyScale = Math.min(qtyScale, cfg.softScale);
    }
  }
  const scaledQty = Number(qtyFraction) * qtyScale;
  if (!Number.isFinite(scaledQty) || scaledQty <= 0) {
    return {
      ok: false,
      reason: "DROP_ADD_QTY_INVALID",
      detail: { qty_fraction: qtyFraction, qty_scale: qtyScale },
    };
  }
  if (scaledQty < cfg.minQtyFraction) {
    return {
      ok: false,
      reason: "DROP_ADD_QTY_TOO_SMALL",
      detail: { scaled_qty: scaledQty, min_qty_fraction: cfg.minQtyFraction, upnl_pct: upnlPct },
    };
  }
  return {
    ok: true,
    qtyScale,
    upnlPct: Number.isFinite(upnlPct) ? upnlPct : null,
    rawUpnlPct: Number.isFinite(rawUpnlPct) ? rawUpnlPct : null,
    leverageEff: Number.isFinite(leverageEff) ? leverageEff : null,
    dayPnl: state.dayPnl,
    lossStreak: state.lossStreak,
  };
}

function applyAddRiskMetaOnFill({
  posMeta,
  intent,
  event,
  barCloseMs,
  realizedPnlQuote,
  opening,
  closing,
} = {}) {
  let next = (posMeta && typeof posMeta === "object") ? { ...posMeta } : {};
  const state = resolveAddGuardState(next, barCloseMs);
  if (state.dayKey) {
    next = mergeMeta(next, {
      add_guard_day_key: state.dayKey,
      add_guard_day_pnl_krw: state.dayPnl,
      add_guard_day_loss_streak: state.lossStreak,
      add_guard_day_realized_n: state.realizedN,
    });
  }

  if (intent === "ENTRY" && opening) {
    next = mergeMeta(next, {
      add_chain_count: 0,
      add_chain_active: false,
      add_chain_last_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
      add_chain_last_event: null,
    });
  } else if (intent === "ADD") {
    const addCount = Number(next.add_chain_count);
    next = mergeMeta(next, {
      add_chain_count: (Number.isFinite(addCount) ? Math.max(0, Math.trunc(addCount)) : 0) + 1,
      add_chain_active: true,
      add_chain_last_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
      add_chain_last_event: String(event || "").toUpperCase() || null,
    });
  }

  if (intent === "EXIT" && Number.isFinite(realizedPnlQuote)) {
    const chainCount = Number(next.add_chain_count);
    const fromAddChain = Number.isFinite(chainCount) && chainCount > 0;
    if (fromAddChain) {
      const s = resolveAddGuardState(next, barCloseMs);
      const dayPnl = s.dayPnl + Number(realizedPnlQuote);
      const realizedN = s.realizedN + 1;
      const lossStreak = Number(realizedPnlQuote) < 0 ? (s.lossStreak + 1) : 0;
      next = mergeMeta(next, {
        add_guard_day_key: s.dayKey,
        add_guard_day_pnl_krw: dayPnl,
        add_guard_day_loss_streak: lossStreak,
        add_guard_day_realized_n: realizedN,
        add_guard_last_realized_krw: Number(realizedPnlQuote),
        add_guard_last_realized_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
      });
    }
  }

  if (closing) {
    next = mergeMeta(next, {
      add_chain_count: 0,
      add_chain_active: false,
      add_chain_last_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
    });
  }
  return next;
}

function applyAddAndProtectionMetaOnFill({
  posMeta,
  intent,
  event,
  barCloseMs,
  realizedPnlQuote,
  opening,
  closing,
  signalBarCloseMs,
  intentId,
  signalId,
  avgBefore,
  avgAfter,
  sizeBefore,
  sizeAfter,
  qtyPct,
  qtyBase,
  lossPct,
  nativeProtectionMetaPatch,
} = {}) {
  let nextMeta = applyAddRiskMetaOnFill({
    posMeta,
    intent,
    event,
    barCloseMs,
    realizedPnlQuote,
    opening,
    closing,
  });
  if (intent === "ADD") {
    nextMeta = mergeMeta(nextMeta, {
      add_chain_last_signal_bar_ms: Number.isFinite(Number(signalBarCloseMs)) ? Number(signalBarCloseMs) : Number(barCloseMs),
      add_chain_last_intent_id: intentId || null,
      add_chain_last_signal_id: signalId || null,
      add_chain_last_avg_before: Number.isFinite(Number(avgBefore)) ? Number(avgBefore) : null,
      add_chain_last_avg_after: Number.isFinite(Number(avgAfter)) ? Number(avgAfter) : null,
      add_chain_last_size_before: Number.isFinite(Number(sizeBefore)) ? Number(sizeBefore) : null,
      add_chain_last_size_after: Number.isFinite(Number(sizeAfter)) ? Number(sizeAfter) : null,
      add_chain_last_qty_pct: Number.isFinite(Number(qtyPct)) ? Number(qtyPct) : null,
      add_chain_last_qty_base: Number.isFinite(Number(qtyBase)) ? Number(qtyBase) : null,
      add_chain_last_loss_pct: Number.isFinite(Number(lossPct)) ? Number(lossPct) : null,
    });
  }
  if (nativeProtectionMetaPatch) {
    nextMeta = mergeMeta(nextMeta, nativeProtectionMetaPatch);
  }
  return nextMeta;
}

function evaluateCommittedRescueAddGate({
  applied,
  pendingAddCount,
  pendingAddSignalBarMs,
  signalBarCloseMs,
  maxAdds,
  sameBarBlock,
  replay = false,
} = {}) {
  if (applied !== true) return { ok: true };
  const prefix = replay ? "REPLAY_RESCUE_ADD" : "LIVE_RESCUE_ADD";
  const effectiveAddCount = Number.isFinite(Number(pendingAddCount))
    ? Math.max(0, Math.trunc(Number(pendingAddCount)))
    : 0;
  const resolvedMaxAdds = Number.isFinite(Number(maxAdds))
    ? Math.max(0, Math.trunc(Number(maxAdds)))
    : 1;
  if (effectiveAddCount >= resolvedMaxAdds) {
    return {
      ok: false,
      reason: `${prefix}_LIMIT_BLOCKED`,
      detail: {
        add_count: effectiveAddCount,
        max_adds: resolvedMaxAdds,
      },
    };
  }
  const signalMs = Number(signalBarCloseMs);
  const pendingMs = Number(pendingAddSignalBarMs);
  if (sameBarBlock === true && Number.isFinite(signalMs) && Number.isFinite(pendingMs) && signalMs === pendingMs) {
    return {
      ok: false,
      reason: `${prefix}_SAME_BAR_BLOCKED`,
      detail: {
        add_count: effectiveAddCount,
        max_adds: resolvedMaxAdds,
        pending_signal_bar_ms: pendingMs,
      },
    };
  }
  return { ok: true };
}

function shouldApplyShortEntryGateByEvent(eventUpper, cfg, features) {
  const tier = resolveEntryQualityTier(eventUpper, features);
  if (tier === "REAL" || tier === "PRE_REAL") return false;
  if (tier === "CORE") return cfg.applyCore;
  if (tier === "EARLY") return cfg.applyEarly;
  return false;
}

function evaluateShortEntryGate({ intent, intentDir, eventUpper, features, cfg } = {}) {
  if (!cfg || !cfg.enabled) return { ok: true };
  if (intent !== "ENTRY" && intent !== "ADD") return { ok: true };
  const dir = String(intentDir || "").toUpperCase();
  if (dir !== "SHORT" && dir !== "LONG") return { ok: true };
  if (!shouldApplyShortEntryGateByEvent(eventUpper, cfg, features)) return { ok: true };

  const structure = resolveEntryStructureSnapshot({ features, intentDir: dir, eventUpper });
  if (structure.pineBundle.trusted) {
    return {
      ok: true,
      detail: {
        pine_stage1_bundle_trusted: true,
        pine_stage1_bundle_owner: structure.pineBundle.owner,
        pine_stage1_bundle_version: structure.pineBundle.version,
      },
    };
  }
  const reasonPrefix = dir === "LONG" ? "DROP_LONG_GATE" : "DROP_SHORT_GATE";

  if (cfg.trendOnly && structure.regime && structure.regime !== "trend") {
    const transitionAllowed =
      cfg.transitionExceptionEnabled === true &&
      structure.regime === "transition" &&
      shouldApplyGateTransitionExceptionByEvent(eventUpper, cfg, features) &&
      structure.scoreDirOk &&
      Number.isFinite(structure.score) &&
      Math.abs(structure.score) >= cfg.transitionExceptionScoreAbs &&
      Number.isFinite(structure.waveConf) &&
      structure.waveConf >= cfg.transitionExceptionWaveConfMin;
    if (transitionAllowed) {
      return {
        ok: true,
        detail: {
          gate_transition_exception: true,
          gate_transition_exception_dir: dir,
          gate_transition_exception_regime: structure.regime,
          gate_transition_exception_reason: `${reasonPrefix}_TRANSITION_EXCEPTION`,
        },
      };
    }
    return {
      ok: false,
      reason: `${reasonPrefix}_REGIME`,
      detail: { regime: structure.regime, required: "trend" },
    };
  }

  if (cfg.blockConflict && (structure.conflictDir === true || structure.conflictAny === true)) {
    return {
      ok: false,
      reason: `${reasonPrefix}_CONFLICT`,
      detail: {
        conflict_long: structure.conflictLong,
        conflict_short: structure.conflictShort,
        conflict_any: structure.conflictAny,
      },
    };
  }

  const scoreAbsMin = pickTierNumber(cfg.scoreAbsByTier, structure.tier, 0);

  if ((Number.isFinite(structure.score) && Math.abs(structure.score) < scoreAbsMin) || !structure.scoreDirOk) {
    return {
      ok: false,
      reason: `${reasonPrefix}_SCORE`,
      detail: { score: structure.score, min_score_abs: scoreAbsMin, dir },
    };
  }

  if (Number.isFinite(structure.confidence) && structure.confidence < cfg.minConfidence) {
    return {
      ok: false,
      reason: `${reasonPrefix}_CONF`,
      detail: { confidence: structure.confidence, min_confidence: cfg.minConfidence },
    };
  }

  if (Number.isFinite(structure.waveConf) && structure.waveConf < cfg.minWaveConf) {
    return {
      ok: false,
      reason: `${reasonPrefix}_WAVE`,
      detail: { wave_conf: structure.waveConf, min_wave_conf: cfg.minWaveConf },
    };
  }

  return { ok: true };
}

function resolveEntryQualityGateConfig(sysCfg = {}, exchange = "") {
  const defaultEnabled = false;
  const enabled = normalizeBool(sysCfg.entry_quality_gate_enabled, defaultEnabled);
  const requireTrend = normalizeBool(sysCfg.entry_quality_gate_require_trend, false);
  const disallowRange = normalizeBool(sysCfg.entry_quality_gate_disallow_range, true);
  const blockConflict = normalizeBool(sysCfg.entry_quality_gate_block_conflict, true);
  const requirePosterior = normalizeBool(sysCfg.entry_quality_gate_require_posterior, false);
  const requireConfidence = normalizeBool(sysCfg.entry_quality_gate_require_confidence, false);
  const requireWaveConf = normalizeBool(sysCfg.entry_quality_gate_require_wave_conf, false);
  const scoreAbsByTier = buildTierNumberMap({
    EARLY: Math.max(0, normalizeNumber(sysCfg.entry_quality_min_score_early, 16)),
    CORE: Math.max(0, normalizeNumber(sysCfg.entry_quality_min_score_core, 24)),
    PRE_REAL: Math.max(0, normalizeNumber(sysCfg.entry_quality_min_score_pre_real, 30)),
    REAL: Math.max(0, normalizeNumber(sysCfg.entry_quality_min_score_real, 36)),
  }, 0);
  const posteriorByTier = buildTierNumberMap({
    EARLY: clamp(normalizeNumber(sysCfg.entry_quality_min_posterior_early, 0.52), 0, 1),
    CORE: clamp(normalizeNumber(sysCfg.entry_quality_min_posterior_core, 0.55), 0, 1),
    PRE_REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_posterior_pre_real, 0.58), 0, 1),
    REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_posterior_real, 0.60), 0, 1),
  }, null);
  const confidenceByTier = buildTierNumberMap({
    EARLY: clamp(normalizeNumber(sysCfg.entry_quality_min_confidence_early, 0.50), 0, 1),
    CORE: clamp(normalizeNumber(sysCfg.entry_quality_min_confidence_core, 0.55), 0, 1),
    PRE_REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_confidence_pre_real, 0.58), 0, 1),
    REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_confidence_real, 0.62), 0, 1),
  }, null);
  const waveConfByTier = buildTierNumberMap({
    EARLY: clamp(normalizeNumber(sysCfg.entry_quality_min_wave_conf_early, 0.52), 0, 1),
    CORE: clamp(normalizeNumber(sysCfg.entry_quality_min_wave_conf_core, 0.56), 0, 1),
    PRE_REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_wave_conf_pre_real, 0.60), 0, 1),
    REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_wave_conf_real, 0.64), 0, 1),
  }, null);
  return {
    enabled,
    requireTrend,
    disallowRange,
    blockConflict,
    requirePosterior,
    requireConfidence,
    requireWaveConf,
    scoreAbsByTier,
    posteriorByTier,
    confidenceByTier,
    waveConfByTier,
    minScoreAbsEarly: scoreAbsByTier.EARLY,
    minScoreAbsCore: scoreAbsByTier.CORE,
    minScoreAbsPreReal: scoreAbsByTier.PRE_REAL,
    minScoreAbsReal: scoreAbsByTier.REAL,
    minPosteriorEarly: posteriorByTier.EARLY,
    minPosteriorCore: posteriorByTier.CORE,
    minPosteriorPreReal: posteriorByTier.PRE_REAL,
    minPosteriorReal: posteriorByTier.REAL,
    minConfidenceEarly: confidenceByTier.EARLY,
    minConfidenceCore: confidenceByTier.CORE,
    minConfidencePreReal: confidenceByTier.PRE_REAL,
    minConfidenceReal: confidenceByTier.REAL,
    minWaveConfEarly: waveConfByTier.EARLY,
    minWaveConfCore: waveConfByTier.CORE,
    minWaveConfPreReal: waveConfByTier.PRE_REAL,
    minWaveConfReal: waveConfByTier.REAL,
  };
}

function resolveEntryQualityTier(eventUpper, features) {
  // Tier semantics SSOT:
  // /Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_TIER_DEFINITION.md
  // Keep Pine and server tier meaning aligned before changing this mapping.
  const tier = resolveSignalTier(eventUpper, features);
  if (tier) return tier;
  // EMO also uses score/posterior/wave quality gates (EARLY tier threshold).
  if (isEmoEventName(eventUpper)) return "EARLY";
  return null;
}

function normalizeMarketProbMap(raw = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [market, value] of Object.entries(raw)) {
    const key = String(market || "").trim().toUpperCase();
    const n = clamp(normalizeNumber(value, null), 0, 1);
    if (!key || !Number.isFinite(n)) continue;
    out[key] = n;
  }
  return out;
}

function parseTimeMs(raw) {
  if (raw == null || raw === "") return null;
  if (Number.isFinite(Number(raw))) return Number(raw);
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

function readJsonSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function resolveEvGateUnknownGenRelaxMode(sysCfg = {}) {
  const enabled = normalizeBool(sysCfg.ev_gate_unknown_gen_relax_enabled, false);
  const startMs = parseTimeMs(sysCfg.ev_gate_unknown_gen_relax_started_at_ms || sysCfg.ev_gate_unknown_gen_relax_started_at);
  const windowHours = clamp(normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_window_hours, 6), 1, 24);
  const reviewAfterHours = clamp(
    normalizeNumber(
      sysCfg.ev_gate_unknown_gen_relax_review_after_hours,
      normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_rollback_after_hours, 4)
    ),
    1,
    windowHours
  );
  const minDelta = clamp(normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_tp1_prob_min_delta, 0.04), 0, 0.20);
  const fullDelta = clamp(normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_tp1_prob_full_delta, 0.03), 0, 0.20);
  const killDelta = clamp(normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_tp1_prob_kill_delta, 0.02), 0, 0.20);
  const nowMs = Date.now();
  const ageHours = Number.isFinite(startMs) ? ((nowMs - startMs) / 3600000) : null;
  const windowActive = enabled && Number.isFinite(startMs) && ageHours < windowHours;
  const reviewDue = enabled && Number.isFinite(ageHours) && ageHours >= reviewAfterHours;
  let status = "DISABLED";
  if (enabled && !Number.isFinite(startMs)) status = "PENDING_START";
  else if (enabled && reviewDue) status = "MANUAL_REVIEW_DUE";
  else if (enabled && windowActive) status = "ACTIVE";
  else if (enabled && Number.isFinite(startMs) && ageHours >= windowHours) status = "MONITOR_WINDOW_ELAPSED";
  else if (enabled) status = "IDLE";
  return {
    enabled,
    status,
    active: enabled,
    enforcementMode: enabled ? "REPORT_ONLY" : "DISABLED",
    startMs,
    ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(4)) : null,
    windowHours,
    reviewAfterHours,
    minDelta,
    fullDelta,
    killDelta,
    reviewDue,
    autoRollbackEnabled: false,
  };
}

function pickFirstUpper(source = {}, keys = []) {
  for (const key of keys) {
    const value = String(source && source[key] || "").trim().toUpperCase();
    if (value) return value;
  }
  return null;
}

function resolveEvGateConfig(sysCfg = {}, exchange = "", market = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCE");
  const marketKey = String(market || "").trim().toUpperCase();
  const globalReportOnlyEnabled = normalizeBool(sysCfg.ev_gate_global_report_only_enabled, true);
  const tp1ProbMinGlobal = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min, 0.55), 0, 1);
  const tp1ProbMinByMarket = normalizeMarketProbMap(sysCfg.ev_gate_tp1_prob_min_by_market);
  const tp1ProbMinByMarketReportOnly = normalizeMarketProbMap(sysCfg.ev_gate_tp1_prob_min_by_market_report_only);
  const reportOnlyEnabled = normalizeBool(sysCfg.ev_gate_tp1_prob_min_by_market_report_only_enabled, false);
  const cohortReportOnlyEnabled = normalizeBool(sysCfg.ev_gate_tp1_prob_min_report_only_cohort_enabled, false);
  const cohortReportOnlyThreshold = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_report_only_cohort, null), 0, 1);
  const marketOverrideActive = marketKey && Number.isFinite(tp1ProbMinByMarket[marketKey]);
  const marketReportOnlyOverrideActive = !marketOverrideActive && reportOnlyEnabled && marketKey && Number.isFinite(tp1ProbMinByMarketReportOnly[marketKey]);
  const cohortReportOnlyActive = !marketOverrideActive
    && !marketReportOnlyOverrideActive
    && cohortReportOnlyEnabled
    && Number.isFinite(cohortReportOnlyThreshold);
  const tp1ProbMin = marketOverrideActive
    ? tp1ProbMinByMarket[marketKey]
    : (
      marketReportOnlyOverrideActive
        ? tp1ProbMinByMarketReportOnly[marketKey]
        : (
          cohortReportOnlyActive
            ? Math.min(tp1ProbMinGlobal, cohortReportOnlyThreshold)
            : tp1ProbMinGlobal
        )
    );
  const tierEarly = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_early, tp1ProbMin), 0, 1);
  const tierCore = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_core, tp1ProbMin), 0, 1);
  const tierPreReal = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_pre_real, tp1ProbMin), 0, 1);
  const tierReal = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_real, tp1ProbMin), 0, 1);
  const effectiveThresholdOverrideActive = marketOverrideActive || marketReportOnlyOverrideActive || cohortReportOnlyActive;
  const tp1ProbMinEarly = effectiveThresholdOverrideActive ? Math.min(tierEarly, tp1ProbMin) : tierEarly;
  const tp1ProbMinCore = effectiveThresholdOverrideActive ? Math.min(tierCore, tp1ProbMin) : tierCore;
  const tp1ProbMinPreReal = effectiveThresholdOverrideActive ? Math.min(tierPreReal, tp1ProbMin) : tierPreReal;
  const tp1ProbMinReal = effectiveThresholdOverrideActive ? Math.min(tierReal, tp1ProbMin) : tierReal;
  const tp1ProbFull = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_full, Math.max(0.60, tp1ProbMin)), 0, 1);
  const tp1ProbKill = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_kill, 0.50), 0, 1);
  const qtyScaleMid = clamp(normalizeNumber(sysCfg.ev_gate_qty_scale_mid, 0.70), 0, 1);
  const qtyScaleLow = clamp(normalizeNumber(sysCfg.ev_gate_qty_scale_low, 0.40), 0, 1);
  const pointPassKillRescueEnabled = normalizeBool(sysCfg.ev_gate_point_pass_kill_rescue_enabled, true);
  const pointPassKillRescueMargin = clamp(normalizeNumber(sysCfg.ev_gate_point_pass_kill_rescue_margin, 0.06), 0, 0.25);
  const qtyScaleKillRescueRaw = clamp(normalizeNumber(sysCfg.ev_gate_qty_scale_kill_rescue, Math.min(qtyScaleLow, 0.25)), 0, 1);
  const qtyScaleKillRescue = Math.min(qtyScaleLow, qtyScaleKillRescueRaw);
  const lookbackBars = Math.max(8, Math.min(24, normalizeInt(sysCfg.ev_gate_lookback_bars, 12)));
  const atrBars = Math.max(4, Math.min(lookbackBars - 1, normalizeInt(sysCfg.ev_gate_atr_bars, 8)));
  const defaultTp0Pct = Math.max(0.1, normalizeNumber(sysCfg.ev_gate_default_tp0_pct, 0.8));
  const defaultTp0QtyRatio = clamp(normalizeNumber(sysCfg.ev_gate_default_tp0_qty_ratio, 0.25), 0, 1);
  const defaultTp1Pct = Math.max(0.1, normalizeNumber(sysCfg.ev_gate_default_tp1_pct, 3.25));
  const defaultSlPct = Math.max(0.1, normalizeNumber(sysCfg.ev_gate_default_sl_pct, 1.65));
  const unknownGenRelaxMode = resolveEvGateUnknownGenRelaxMode(sysCfg);
  return {
    enabled: normalizeBool(sysCfg.ev_gate_enabled, defaultEnabled),
    globalReportOnlyEnabled,
    applyCore: normalizeBool(sysCfg.ev_gate_core_enabled, true),
    applyPreReal: false,
    applyReal: false,
    applyEarly: normalizeBool(sysCfg.ev_gate_early_enabled, true),
    tp1ProbMin: Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55,
    tp1ProbMinGlobal: Number.isFinite(tp1ProbMinGlobal) ? tp1ProbMinGlobal : 0.55,
    tp1ProbMinMarketOverride: marketOverrideActive ? tp1ProbMinByMarket[marketKey] : null,
    tp1ProbMinMarketReportOnlyOverride: marketReportOnlyOverrideActive ? tp1ProbMinByMarketReportOnly[marketKey] : null,
    tp1ProbMinCohortReportOnlyOverride: cohortReportOnlyActive ? Math.min(tp1ProbMinGlobal, cohortReportOnlyThreshold) : null,
    tp1ProbMinByMarket,
    tp1ProbMinByMarketReportOnly,
    tp1ProbMinReportOnlyEnabled: reportOnlyEnabled,
    tp1ProbMinReportOnlyCohortEnabled: cohortReportOnlyEnabled,
    tp1ProbMinEarly: Number.isFinite(tp1ProbMinEarly) ? tp1ProbMinEarly : (Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55),
    tp1ProbMinCore: Number.isFinite(tp1ProbMinCore) ? tp1ProbMinCore : (Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55),
    tp1ProbMinPreReal: Number.isFinite(tp1ProbMinCore) ? tp1ProbMinCore : (Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55),
    tp1ProbMinReal: Number.isFinite(tp1ProbMinCore) ? tp1ProbMinCore : (Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55),
    tp1ProbFull: Number.isFinite(tp1ProbFull) ? Math.max(tp1ProbMin, tp1ProbFull) : Math.max(tp1ProbMin, 0.60),
    tp1ProbKill: Number.isFinite(tp1ProbKill) ? Math.min(tp1ProbMin, tp1ProbKill) : Math.min(tp1ProbMin, 0.50),
    qtyScaleMid: Number.isFinite(qtyScaleMid) ? qtyScaleMid : 0.70,
    qtyScaleLow: Number.isFinite(qtyScaleLow) ? qtyScaleLow : 0.40,
    pointPassKillRescueEnabled,
    pointPassKillRescueMargin,
    qtyScaleKillRescue: Number.isFinite(qtyScaleKillRescue) ? qtyScaleKillRescue : Math.min(Number.isFinite(qtyScaleLow) ? qtyScaleLow : 0.40, 0.25),
    lookbackBars,
    atrBars,
    defaultTp0Pct,
    defaultTp0QtyRatio,
    defaultTp1Pct,
    defaultSlPct,
    unknownGenRelaxEnabled: unknownGenRelaxMode.enabled,
    unknownGenRelaxStatus: unknownGenRelaxMode.status,
    unknownGenRelaxActive: unknownGenRelaxMode.active,
    unknownGenRelaxEnforcementMode: unknownGenRelaxMode.enforcementMode,
    unknownGenRelaxStartMs: unknownGenRelaxMode.startMs,
    unknownGenRelaxAgeHours: unknownGenRelaxMode.ageHours,
    unknownGenRelaxWindowHours: unknownGenRelaxMode.windowHours,
    unknownGenRelaxReviewAfterHours: unknownGenRelaxMode.reviewAfterHours,
    unknownGenRelaxMinDelta: unknownGenRelaxMode.minDelta,
    unknownGenRelaxFullDelta: unknownGenRelaxMode.fullDelta,
    unknownGenRelaxKillDelta: unknownGenRelaxMode.killDelta,
    unknownGenRelaxReviewDue: unknownGenRelaxMode.reviewDue,
    unknownGenRelaxAutoRollbackEnabled: unknownGenRelaxMode.autoRollbackEnabled,
    skipMissingBars: normalizeBool(
      sysCfg.ev_gate_skip_missing_bars === undefined ? true : sysCfg.ev_gate_skip_missing_bars,
      true
    ),
  };
}

function resolveEvGateTp1ProbMinForTier(cfg = {}, tier = null) {
  const t = String(tier || "").toUpperCase();
  if (t === "EARLY") return Number(cfg.tp1ProbMinEarly);
  if (t === "CORE") return Number(cfg.tp1ProbMinCore);
  if (t === "PRE_REAL" || t === "REAL") return Number(cfg.tp1ProbMinCore);
  return Number(cfg.tp1ProbMin);
}

function shouldApplyEvGateByEvent(eventUpper, cfg, features) {
  const tier = resolveEntryQualityTier(eventUpper, features);
  if (tier === "REAL" || tier === "PRE_REAL") return false;
  if (tier === "CORE") return cfg.applyCore;
  if (tier === "EARLY" || isEmoEventName(eventUpper)) return cfg.applyEarly;
  return false;
}

function shouldBypassEvEntryGate({ intent, features } = {}) {
  return String(intent || "").toUpperCase() === "ENTRY" && isManualRetryFeatures(features);
}

function buildSignalStageFeatures(signal = {}, intent = null) {
  const base = (signal && signal.features && typeof signal.features === "object") ? { ...signal.features } : {};
  const eventGroup = String(signal && signal.event_group || "").trim().toUpperCase() || null;
  const eventSubtype = String(signal && signal.event_subtype || "").trim().toUpperCase() || null;
  const eventIntent = String(
    signal && (signal.event_intent || signal.intent || intent) || ""
  ).trim().toUpperCase() || null;
  if (eventGroup && !base.event_group && !base.signal_group && !base._event_group) base.event_group = eventGroup;
  if (eventSubtype && !base.event_subtype && !base.signal_subtype && !base._event_subtype) base.event_subtype = eventSubtype;
  if (eventIntent && !base.event_intent && !base._event_intent) base.event_intent = eventIntent;
  return base;
}

function resolveEvGateUnknownGenRelaxContext({ eventUpper, intent, features, cfg, tier } = {}) {
  const f = (features && typeof features === "object") ? features : {};
  const derived = deriveGroupSubtype(eventUpper);
  const explicitSignalGroup = pickFirstUpper(f, ["event_group", "signal_group", "_event_group"]);
  const explicitSignalSubtype = pickFirstUpper(f, ["event_subtype", "signal_subtype", "_event_subtype"]);
  const signalGroup = explicitSignalGroup || derived.group || null;
  const signalSubtype = explicitSignalSubtype || derived.subtype || null;
  const eventIntent = pickFirstUpper(f, ["event_intent", "_event_intent"]) || String(intent || "").trim().toUpperCase() || null;
  const marketState = pickFirstUpper(f, [
    "market_state_summary_state",
    "market_state_state",
    "market_state",
    "sp_state",
    "market_physics_state",
  ]);
  const baseTp1ProbMin = resolveEvGateTp1ProbMinForTier(cfg, tier);
  const isEntryLikeSignal = eventIntent === "ENTRY" || signalGroup === "ENTRY";
  const hasExplicitStageMetadata = !!(explicitSignalGroup || explicitSignalSubtype);
  const isExplicitGenSignal = signalSubtype === "GEN";
  const isUnknownGenLikeSignal = isExplicitGenSignal || !hasExplicitStageMetadata;
  const applies = cfg
    && cfg.unknownGenRelaxActive === true
    && isEntryLikeSignal
    && isUnknownGenLikeSignal
    && (
      isExplicitGenSignal
      || !marketState
      || marketState === "UNKNOWN"
    );
  const tp1ProbMin = applies
    ? Number(Math.max(0.30, Number(baseTp1ProbMin || 0) - Number(cfg.unknownGenRelaxMinDelta || 0)).toFixed(4))
    : baseTp1ProbMin;
  const tp1ProbFull = applies
    ? Number(Math.max(0.35, Number(cfg.tp1ProbFull || 0) - Number(cfg.unknownGenRelaxFullDelta || 0)).toFixed(4))
    : Number(cfg && cfg.tp1ProbFull);
  const tp1ProbKill = applies
    ? Number(Math.max(0.25, Number(cfg.tp1ProbKill || 0) - Number(cfg.unknownGenRelaxKillDelta || 0)).toFixed(4))
    : Number(cfg && cfg.tp1ProbKill);
  return {
    eventIntent,
    explicitSignalGroup: explicitSignalGroup || null,
    explicitSignalSubtype: explicitSignalSubtype || null,
    hasExplicitStageMetadata,
    signalGroup,
    signalSubtype,
    marketState: marketState || "UNKNOWN",
    applies,
    baseTp1ProbMin,
    tp1ProbMin,
    tp1ProbFull,
    tp1ProbKill,
  };
}

function resolveEvGateDecision({ estimate, cfg, tp1ProbMin } = {}) {
  const killThreshold = Number(cfg && cfg.tp1ProbKill);
  const fullThreshold = Number(cfg && cfg.tp1ProbFull);
  const probMin = Number(tp1ProbMin);
  const pointProbability = Number(estimate && (estimate.exit_value_probability != null ? estimate.exit_value_probability : estimate.probability));
  const lowerBound = Number(estimate && (estimate.exit_value_lower_bound != null ? estimate.exit_value_lower_bound : estimate.lowerBound));
  const pointPass = Number.isFinite(pointProbability) && Number.isFinite(probMin) && pointProbability >= probMin;
  const rescueMargin = Math.max(0, Number(cfg && cfg.pointPassKillRescueMargin) || 0);
  const rescueFloor = Number.isFinite(killThreshold) ? Math.max(0, killThreshold - rescueMargin) : null;
  const rescueScale = Number(cfg && cfg.qtyScaleKillRescue);
  const lowScale = Number(cfg && cfg.qtyScaleLow);
  const midScale = Number(cfg && cfg.qtyScaleMid);

  if (Number.isFinite(killThreshold) && Number.isFinite(lowerBound) && lowerBound < killThreshold) {
    const rescueEligible = cfg && cfg.pointPassKillRescueEnabled === true
      && pointPass
      && Number.isFinite(rescueFloor)
      && lowerBound >= rescueFloor
      && Number.isFinite(rescueScale)
      && rescueScale > 0;
    if (rescueEligible) {
      return {
        ok: true,
        action: "REDUCE_RESCUE",
        qtyScale: rescueScale,
        reason: null,
        pointPass,
        rescueFloor,
        pointPassKillRescueApplied: true,
      };
    }
    return {
      ok: false,
      action: "DROP",
      qtyScale: 0,
      reason: "DROP_EV_GATE_TP1_PROB",
      pointPass,
      rescueFloor,
      pointPassKillRescueApplied: false,
    };
  }

  if (Number.isFinite(lowerBound) && Number.isFinite(probMin) && lowerBound < probMin) {
    return {
      ok: true,
      action: "REDUCE_LOW",
      qtyScale: Number.isFinite(lowScale) ? lowScale : 0.40,
      reason: null,
      pointPass,
      rescueFloor,
      pointPassKillRescueApplied: false,
    };
  }
  if (Number.isFinite(lowerBound) && Number.isFinite(fullThreshold) && lowerBound < fullThreshold) {
    return {
      ok: true,
      action: "REDUCE_MID",
      qtyScale: Number.isFinite(midScale) ? midScale : 0.70,
      reason: null,
      pointPass,
      rescueFloor,
      pointPassKillRescueApplied: false,
    };
  }
  return {
    ok: true,
    action: "ALLOW",
    qtyScale: 1,
    reason: null,
    pointPass,
    rescueFloor,
    pointPassKillRescueApplied: false,
  };
}

function resolveEvGateTradePlan({ cfg, exitRules, features } = {}) {
  const fallback = {
    tp0Pct: Math.max(0, Number(cfg && cfg.defaultTp0Pct)),
    tp1Pct: Math.max(0, Number(cfg && cfg.defaultTp1Pct)),
    slPct: Math.max(0, Number(cfg && cfg.defaultSlPct)),
    source: "config",
    tp0QtyRatio: Number.isFinite(Number(cfg && cfg.defaultTp0QtyRatio)) ? clamp(Number(cfg.defaultTp0QtyRatio), 0, 1) : 0.25,
    tp1QtyRatio: null,
    bePct: null,
    trailPct: null,
    trailRMultiple: null,
    runnerMinProfitPct: null,
  };
  if (!exitRules || typeof exitRules !== "object") return fallback;
  const rules = applySignalExitPolicyOverrides(exitRules, features);
  const tp0Abs = Math.abs(Number(rules.TP_P0));
  const slAbs = Math.abs(Number(rules.SL));
  const tp1Abs = Math.abs(Number(rules.TP_P1));
  const tp0QtyRatio = clamp(normalizeNumber(rules.TP_P0_QTY, 0.25), 0, 1);
  const tp1QtyRatio = clamp(normalizeNumber(rules.TP_P1_QTY, 1), 0, 1);
  const beEnabled = normalizeBool(rules.BE_ENABLE, false);
  const beAbs = Math.abs(Number(rules.BE_PCT));
  const trailAbs = Math.abs(Number(rules.TRAIL_PCT));
  const trailRMultiple = normalizeNumber(rules.TRAIL_R_MULTIPLE, null);
  const runnerMinAbs = Math.abs(Number(rules.RUNNER_MIN_PROFIT_PCT));
  if (!Number.isFinite(slAbs) || slAbs <= 0 || !Number.isFinite(tp1Abs) || tp1Abs <= 0) {
    return fallback;
  }
  return {
    tp0Pct: Number.isFinite(tp0Abs) && tp0Abs > 0 ? (tp0Abs * 100) : null,
    tp1Pct: tp1Abs * 100,
    slPct: slAbs * 100,
    source: "exit_rules",
    tp0QtyRatio,
    tp1QtyRatio,
    bePct: beEnabled && Number.isFinite(beAbs) ? (beAbs * 100) : null,
    trailPct: Number.isFinite(trailAbs) && trailAbs > 0 ? (trailAbs * 100) : null,
    trailRMultiple: Number.isFinite(trailRMultiple) && trailRMultiple > 0 ? trailRMultiple : null,
    runnerMinProfitPct: Number.isFinite(runnerMinAbs) && runnerMinAbs > 0 ? (runnerMinAbs * 100) : null,
  };
}

async function evaluateEvEntryGate({
  exchange,
  symbol,
  tf,
  barCloseMs,
  intent,
  intentDir,
  eventUpper,
  features,
  cfg,
  exitRules,
  exitProfile,
  exitProfileReason,
  bars,
} = {}) {
  if (!cfg || cfg.enabled !== true) return { ok: true, action: "ALLOW", qtyScale: 1 };
  if (String(intent || "").toUpperCase() !== "ENTRY") return { ok: true, action: "ALLOW", qtyScale: 1 };
  const dir = String(intentDir || "").toUpperCase();
  if (dir !== "LONG" && dir !== "SHORT") return { ok: true, action: "ALLOW", qtyScale: 1 };
  if (!shouldApplyEvGateByEvent(eventUpper, cfg, features)) return { ok: true, action: "ALLOW", qtyScale: 1 };

  const tier = resolveEntryQualityTier(eventUpper, features);
  const f = (features && typeof features === "object") ? features : {};
  const plan = resolveEvGateTradePlan({ cfg, exitRules, features: f });
  const tp0Pct = Number(plan.tp0Pct);
  const tp1Pct = Number(plan.tp1Pct);
  const slPct = Number(plan.slPct);
  const relaxContext = resolveEvGateUnknownGenRelaxContext({ eventUpper, intent, features: f, cfg, tier });
  const tp1ProbMin = relaxContext.tp1ProbMin;

  const baseDetail = {
    ev_gate_enabled: true,
    ev_gate_global_report_only_enabled: cfg.globalReportOnlyEnabled === true,
    ev_gate_source: "TP_COMPOSITE_EXIT_VALUE_V1",
    ev_gate_plan_source: plan.source,
    ev_gate_tier: tier,
    ev_gate_dir: dir,
    ev_gate_tp1_prob_min_global: Number(cfg.tp1ProbMin),
    ev_gate_tp1_prob_min_base: relaxContext.baseTp1ProbMin,
    ev_gate_tp1_prob_min: tp1ProbMin,
    ev_gate_tp1_prob_full_base: Number(cfg.tp1ProbFull),
    ev_gate_tp1_prob_kill_base: Number(cfg.tp1ProbKill),
    ev_gate_tp1_prob_full: relaxContext.tp1ProbFull,
    ev_gate_tp1_prob_kill: relaxContext.tp1ProbKill,
    ev_gate_qty_scale_mid: Number(cfg.qtyScaleMid),
    ev_gate_qty_scale_low: Number(cfg.qtyScaleLow),
    ev_gate_qty_scale_kill_rescue: Number(cfg.qtyScaleKillRescue),
    ev_gate_point_pass_kill_rescue_enabled: cfg.pointPassKillRescueEnabled === true,
    ev_gate_point_pass_kill_rescue_margin: Number(cfg.pointPassKillRescueMargin),
    ev_gate_tp0_pct: Number.isFinite(tp0Pct) ? tp0Pct : null,
    ev_gate_tp1_pct: Number.isFinite(tp1Pct) ? tp1Pct : null,
    ev_gate_sl_pct: Number.isFinite(slPct) ? slPct : null,
    ev_gate_tp0_qty_ratio: Number.isFinite(Number(plan.tp0QtyRatio)) ? Number(plan.tp0QtyRatio) : null,
    ev_gate_tp1_qty_ratio: Number.isFinite(Number(plan.tp1QtyRatio)) ? Number(plan.tp1QtyRatio) : null,
    ev_gate_be_pct: Number.isFinite(Number(plan.bePct)) ? Number(plan.bePct) : null,
    ev_gate_trail_pct: Number.isFinite(Number(plan.trailPct)) ? Number(plan.trailPct) : null,
    ev_gate_trail_r_multiple: Number.isFinite(Number(plan.trailRMultiple)) ? Number(plan.trailRMultiple) : null,
    ev_gate_runner_min_profit_pct: Number.isFinite(Number(plan.runnerMinProfitPct)) ? Number(plan.runnerMinProfitPct) : null,
    ev_gate_exit_profile: exitProfile ? String(exitProfile).toUpperCase() : null,
    ev_gate_exit_profile_reason: exitProfileReason ? String(exitProfileReason) : null,
    ev_gate_lookback_bars: Number(cfg.lookbackBars) || null,
    ev_gate_atr_bars: Number(cfg.atrBars) || null,
    ev_gate_signal_group: relaxContext.signalGroup,
    ev_gate_event_intent: relaxContext.eventIntent,
    ev_gate_signal_group_explicit: relaxContext.explicitSignalGroup,
    ev_gate_signal_subtype_explicit: relaxContext.explicitSignalSubtype,
    ev_gate_signal_stage_metadata_present: relaxContext.hasExplicitStageMetadata,
    ev_gate_signal_subtype: relaxContext.signalSubtype,
    ev_gate_market_state: relaxContext.marketState,
    ev_gate_unknown_gen_relax_enabled: cfg.unknownGenRelaxEnabled === true,
    ev_gate_unknown_gen_relax_status: cfg.unknownGenRelaxStatus || "DISABLED",
    ev_gate_unknown_gen_relax_active: cfg.unknownGenRelaxActive === true,
    ev_gate_unknown_gen_relax_enforcement_mode: cfg.unknownGenRelaxEnforcementMode || "DISABLED",
    ev_gate_unknown_gen_relax_applied: relaxContext.applies === true,
    ev_gate_unknown_gen_relax_window_hours: Number(cfg.unknownGenRelaxWindowHours) || null,
    ev_gate_unknown_gen_relax_review_after_hours: Number(cfg.unknownGenRelaxReviewAfterHours) || null,
    ev_gate_unknown_gen_relax_age_hours: Number.isFinite(Number(cfg.unknownGenRelaxAgeHours)) ? Number(cfg.unknownGenRelaxAgeHours) : null,
    ev_gate_unknown_gen_relax_min_delta: Number(cfg.unknownGenRelaxMinDelta) || 0,
    ev_gate_unknown_gen_relax_full_delta: Number(cfg.unknownGenRelaxFullDelta) || 0,
    ev_gate_unknown_gen_relax_kill_delta: Number(cfg.unknownGenRelaxKillDelta) || 0,
    ev_gate_unknown_gen_relax_review_due: cfg.unknownGenRelaxReviewDue === true,
    ev_gate_unknown_gen_relax_auto_rollback_enabled: cfg.unknownGenRelaxAutoRollbackEnabled === true,
  };

  if (!Number.isFinite(tp1Pct) || tp1Pct <= 0 || !Number.isFinite(slPct) || slPct <= 0) {
    const detail = {
      ...baseDetail,
      ev_gate_skipped: true,
      ev_gate_skip_reason: "INVALID_TARGET_PLAN",
      ev_gate_action: "SKIP",
      ev_gate_qty_scale: 1,
    };
    return { ok: true, action: "SKIP", qtyScale: 1, detail };
  }

  const loadedBars = Array.isArray(bars)
    ? bars
    : await queryBars({
      exchange,
      symbol,
      tf,
      limit: Math.max(14, Number(cfg.lookbackBars || 12) + 2),
    });
  const estimate = estimateTp1ReachProbability({
    bars: loadedBars,
    dir,
    tp0Pct,
    tp1Pct,
    slPct,
    tp0QtyRatio: plan.tp0QtyRatio,
    tp1QtyRatio: plan.tp1QtyRatio,
    runnerMinProfitPct: plan.runnerMinProfitPct,
    barCloseMs,
    lookbackBars: cfg.lookbackBars,
    atrBars: cfg.atrBars,
  });
  if (!estimate || estimate.ok !== true) {
    const detail = {
      ...baseDetail,
      ev_gate_skipped: true,
      ev_gate_skip_reason: estimate && estimate.skipReason ? String(estimate.skipReason) : "MODEL_UNAVAILABLE",
      ev_gate_bars_seen: estimate && estimate.barsSeen != null ? estimate.barsSeen : null,
      ev_gate_action: "SKIP",
      ev_gate_qty_scale: 1,
    };
    if (cfg.skipMissingBars) return { ok: true, action: "SKIP", qtyScale: 1, detail };
    return { ok: false, action: "DROP", qtyScale: 0, reason: "DROP_EV_GATE_BARS_MISSING", detail };
  }

  const decisionCfg = relaxContext.applies
    ? {
      ...cfg,
      tp1ProbFull: relaxContext.tp1ProbFull,
      tp1ProbKill: relaxContext.tp1ProbKill,
    }
    : cfg;
  const decision = resolveEvGateDecision({ estimate, cfg: decisionCfg, tp1ProbMin });
  const action = decision.action;
  const qtyScale = decision.qtyScale;
  const dropReason = decision.reason;
  const reportOnlyApplied = cfg.globalReportOnlyEnabled === true
    || (relaxContext.applies === true && cfg.unknownGenRelaxEnforcementMode === "REPORT_ONLY");
  const effectiveAction = reportOnlyApplied ? "REPORT_ONLY" : action;
  const effectiveQtyScale = reportOnlyApplied ? 1 : qtyScale;
  const effectiveDropReason = reportOnlyApplied ? null : dropReason;
  const reportOnlyScope = cfg.globalReportOnlyEnabled === true
    ? "GLOBAL"
    : (reportOnlyApplied ? "UNKNOWN_GEN" : null);

  const detail = {
    ...baseDetail,
    ev_gate_action: effectiveAction,
    ev_gate_qty_scale: effectiveQtyScale,
    ev_gate_raw_action: action,
    ev_gate_raw_qty_scale: qtyScale,
    ev_gate_raw_reason: dropReason || null,
    ev_gate_report_only_applied: reportOnlyApplied,
    ev_gate_report_only_scope: reportOnlyScope,
    ev_gate_report_only_would_drop: reportOnlyApplied && action === "DROP",
    ev_gate_report_only_would_reduce: reportOnlyApplied && action !== "DROP" && Number.isFinite(qtyScale) && qtyScale > 0 && qtyScale < 0.9999,
    ev_gate_tp0_reach_prob: estimate.tp0_probability,
    ev_gate_tp0_reach_prob_lower_bound: estimate.tp0_lower_bound,
    ev_gate_tp1_reach_prob: estimate.probability,
    ev_gate_tp1_reach_prob_lower_bound: estimate.lowerBound,
    ev_gate_exit_value_prob: estimate.exit_value_probability,
    ev_gate_exit_value_prob_lower_bound: estimate.exit_value_lower_bound,
    ev_gate_tp0_to_tp1_conversion_prob: estimate.tp0_to_tp1_conversion_probability,
    ev_gate_pre_tp1_time_stop_risk: estimate.pre_tp1_time_stop_risk,
    ev_gate_expected_exit_value_pct: estimate.expected_exit_value_pct,
    ev_gate_expected_exit_value_r: estimate.expected_exit_value_r,
    ev_gate_probability_stderr: estimate.stderr,
    ev_gate_effective_n: estimate.effectiveN,
    ev_gate_exit_value_stderr: estimate.exit_value_stderr,
    ev_gate_exit_value_effective_n: estimate.exit_value_effective_n,
    ev_gate_confidence_z: estimate.confidenceZ,
    ev_gate_bars_seen: estimate.barsSeen,
    ev_gate_atr_pct: estimate.atrPct,
    ev_gate_target_atr: estimate.targetAtr,
    ev_gate_stop_atr: estimate.stopAtr,
    ev_gate_recent_move_3_pct: estimate.recentMove3Pct,
    ev_gate_recent_move_1_pct: estimate.recentMove1Pct,
    ev_gate_chase_ratio: estimate.chaseRatio,
    ev_gate_same_dir_streak: estimate.sameDirStreak,
    ev_gate_counter_dir_bars: estimate.counterDirBars,
    ev_gate_point_pass: decision.pointPass,
    ev_gate_point_pass_kill_rescue_applied: decision.pointPassKillRescueApplied,
    ev_gate_point_pass_kill_rescue_floor: decision.rescueFloor,
    ev_gate_avg_close_control: estimate.avgCloseControl,
    ev_gate_avg_opposite_wick: estimate.avgOppWick,
    ev_gate_avg_dir_body: estimate.avgDirBody,
    ev_gate_last_close_control: estimate.lastCloseControl,
    ev_gate_last_opposite_wick: estimate.lastOppWick,
    ev_gate_last_dir_body: estimate.lastDirBody,
    ev_gate_prev_close_control: estimate.prevCloseControl,
    ev_gate_prev_opposite_wick: estimate.prevOppWick,
    ev_gate_prev_dir_body: estimate.prevDirBody,
    ev_gate_policy_version: estimate.policy_version || null,
    ev_gate_policy_basis: estimate.policy_basis || null,
    ev_gate_policy_source: estimate.policy_source || null,
    ev_gate_component_weights: estimate.componentWeights || null,
    ev_gate_components: estimate.components,
    ev_gate_exit_value_components: estimate.exit_value_components || null,
  };

  if (effectiveDropReason) return { ok: false, action: effectiveAction, qtyScale: effectiveQtyScale, reason: effectiveDropReason, detail };

  return { ok: true, action: effectiveAction, qtyScale: effectiveQtyScale, detail };
}

function evaluateEntryQualityGate({ intent, intentDir, eventUpper, features, cfg } = {}) {
  if (!cfg || cfg.enabled !== true) return { ok: true };
  if (intent !== "ENTRY" && intent !== "ADD") return { ok: true };
  const dir = String(intentDir || "").toUpperCase();
  const structure = resolveEntryStructureSnapshot({ features, intentDir: dir, eventUpper });
  if (!structure.tier) return { ok: true };
  if (structure.pineBundle.trusted) {
    return {
      ok: true,
      detail: {
        pine_stage1_bundle_trusted: true,
        pine_stage1_bundle_owner: structure.pineBundle.owner,
        pine_stage1_bundle_version: structure.pineBundle.version,
      },
    };
  }
  const minScoreAbs = pickTierNumber(cfg.scoreAbsByTier, structure.tier, 0);
  const minPosterior = pickTierNumber(cfg.posteriorByTier, structure.tier, null);
  const minConfidence = pickTierNumber(cfg.confidenceByTier, structure.tier, null);
  const minWaveConf = pickTierNumber(cfg.waveConfByTier, structure.tier, null);

  if (cfg.blockConflict && (structure.conflictAny === true || structure.conflictDir === true)) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_CONFLICT", detail: { conflict_any: structure.conflictAny, conflict_dir: structure.conflictDir } };
  }
  if (cfg.disallowRange && structure.regime === "range") {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_RANGE", detail: { regime: structure.regime } };
  }
  if (cfg.requireTrend && structure.regime && structure.regime !== "trend") {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_TREND_ONLY", detail: { regime: structure.regime } };
  }
  if (Number.isFinite(structure.score)) {
    if (Math.abs(structure.score) < minScoreAbs) {
      return { ok: false, reason: "DROP_ENTRY_QUALITY_SCORE", detail: { score: structure.score, min_score_abs: minScoreAbs, tier: structure.tier } };
    }
    if (dir === "LONG" && structure.score < 0) {
      return { ok: false, reason: "DROP_ENTRY_QUALITY_SCORE_DIR", detail: { score: structure.score, dir } };
    }
    if (dir === "SHORT" && structure.score > 0) {
      return { ok: false, reason: "DROP_ENTRY_QUALITY_SCORE_DIR", detail: { score: structure.score, dir } };
    }
  }
  if (cfg.requirePosterior && !Number.isFinite(structure.posterior)) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_POSTERIOR_MISSING", detail: { tier: structure.tier } };
  }
  if (Number.isFinite(structure.posterior) && structure.posterior < minPosterior) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_POSTERIOR", detail: { posterior: structure.posterior, min_posterior: minPosterior, tier: structure.tier } };
  }
  if (cfg.requireConfidence && !Number.isFinite(structure.confidence)) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_CONF_MISSING", detail: { tier: structure.tier } };
  }
  if (Number.isFinite(structure.confidence) && structure.confidence < minConfidence) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_CONF", detail: { confidence: structure.confidence, min_confidence: minConfidence, tier: structure.tier } };
  }
  if (cfg.requireWaveConf && !Number.isFinite(structure.waveConf)) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_WAVE_MISSING", detail: { tier: structure.tier } };
  }
  if (Number.isFinite(structure.waveConf) && structure.waveConf < minWaveConf) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_WAVE", detail: { wave_conf: structure.waveConf, min_wave_conf: minWaveConf, tier: structure.tier } };
  }
  return { ok: true };
}

function resolveCanonicalEntryConfig(sysCfg = {}, market = "") {
  return resolveCanonicalEngineConfigShared(sysCfg, { market });
}

function applyCanonicalSourceProvenanceDefaults({ intent, features, sysCfg, market, eventUpper, intentDir, tf } = {}) {
  const entryIntent = String(intent || "").toUpperCase();
  if (entryIntent !== "ENTRY" && entryIntent !== "ADD") return features;
  const featureObj = (features && typeof features === "object") ? features : {};
  if (featureObj.canonical_engine_actual_source_decision != null && featureObj.canonical_engine_decision_id != null) return featureObj;
  const resolvedCfg = resolveCanonicalEntryConfig(sysCfg, market);
  if (!resolvedCfg || resolvedCfg.enabled !== true) return featureObj;
  const decision = evaluateCanonicalDecision({
    features: featureObj,
    event: eventUpper,
    side: intentDir,
    market,
    tf,
    config: resolvedCfg,
    pineShadowDecision: "PASS",
  });
  return {
    ...featureObj,
    ...(decision && decision.detail ? decision.detail : {}),
  };
}

function evaluateCanonicalEntryGate({ intent, intentDir, eventUpper, features, sysCfg, cfg, market, tf } = {}) {
  const entryIntent = String(intent || "").toUpperCase();
  if (entryIntent !== "ENTRY" && entryIntent !== "ADD") return { ok: true };
  const resolvedCfg = cfg || resolveCanonicalEntryConfig(sysCfg, market);
  if (!resolvedCfg || resolvedCfg.enabled !== true) return { ok: true };
  const decision = evaluateCanonicalDecision({
    features,
    event: eventUpper,
    side: intentDir,
    market,
    tf,
    config: resolvedCfg,
  });
  if (!decision.ok) {
    return {
      ok: false,
      reason: decision.reason || "DROP_CANONICAL_ENGINE",
      detail: decision.detail || {},
    };
  }
  return {
    ok: true,
    detail: decision.detail || {},
  };
}

function mergeCanonicalDecisionDetail(features = {}, detail = {}) {
  return {
    ...((features && typeof features === "object") ? features : {}),
    ...((detail && typeof detail === "object") ? detail : {}),
  };
}

function getCoreProbeMeta(posMeta, intentDir) {
  if (!posMeta || !intentDir) return null;
  const dir = String(intentDir).toLowerCase();
  const base = `core_probe_${dir}`;
  const remaining = Number(posMeta[`${base}_remaining_pct`]);
  const barMs = Number(posMeta[`${base}_bar_ms`]);
  const expiresMs = Number(posMeta[`${base}_expires_ms`]);
  return { base, remaining, barMs, expiresMs };
}

function computeWeightedWinRate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let nTotal = 0;
  let acc = 0;
  for (const row of rows) {
    const n = Number(row && row.n);
    const wr = Number(row && row.win_rate);
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(wr)) continue;
    nTotal += n;
    acc += wr * n;
  }
  if (nTotal <= 0) return null;
  return acc / nTotal;
}

const autoScoreCache = new Map();
const AUTO_SCORE_CACHE_TTL_MS = 3 * 60 * 1000;

async function loadEvalLatestWinRate(exchange) {
  const exchangeKey = normalizeEvalExchange(exchange);
  const exCfg = await getExchangeSettingsForProvider(exchangeKey, 2000);
  const expectedTf = normalizeTf((exCfg && exCfg.exec_tf) || "15m") || "15m";
  const cacheKey = `${exchangeKey}__${expectedTf}`;
  const cached = autoScoreCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.at) <= AUTO_SCORE_CACHE_TTL_MS) return cached.winRate;
  try {
    const db = getFirestore();
    const snap = await db.collection("eval_latest").doc(evalLatestId(exchangeKey)).get();
    if (!snap.exists) {
      autoScoreCache.set(cacheKey, { at: now, winRate: null });
      return null;
    }
    const data = snap.data() || {};
    if (!matchesEvalTf(data, expectedTf)) {
      autoScoreCache.set(cacheKey, { at: now, winRate: null });
      return null;
    }
    const rows = Array.isArray(data.signal_kpi_A) ? data.signal_kpi_A : [];
    const winRate = computeWeightedWinRate(rows);
    autoScoreCache.set(cacheKey, { at: now, winRate });
    return winRate;
  } catch (_) {
    autoScoreCache.set(cacheKey, { at: now, winRate: null });
    return null;
  }
}

async function resolveAutoScoreMin({ exchange, sysCfg } = {}) {
  const cfg = (sysCfg && typeof sysCfg === "object") ? sysCfg : {};
  const enabled = normalizeBool(cfg.auto_score_enabled, false);
  if (!enabled) return { enabled: false };
  if (normalizeBool(cfg.auto_score_freeze, false)) return { enabled: false, frozen: true };

  const base = normalizeNumber(cfg.auto_score_base, null);
  if (!Number.isFinite(base)) return { enabled: false };

  const target = normalizeNumber(cfg.auto_score_target_win_rate, 0.55);
  const deltaMax = Math.abs(normalizeNumber(cfg.auto_score_delta_max, 0.05));
  const gain = normalizeNumber(cfg.auto_score_gain, 0.5);
  const minClamp = normalizeNumber(cfg.auto_score_min, null);
  const maxClamp = normalizeNumber(cfg.auto_score_max, null);

  const winRate = await loadEvalLatestWinRate(exchange);
  if (!Number.isFinite(winRate)) {
    const scoreMinFallback = Number.isFinite(minClamp) ? Math.max(base, minClamp) : base;
    return { enabled: true, scoreMin: scoreMinFallback, base, winRate: null, target };
  }

  let delta = (target - winRate) * gain;
  if (Number.isFinite(deltaMax)) delta = clamp(delta, -deltaMax, deltaMax) || 0;
  let scoreMin = base + delta;
  if (Number.isFinite(minClamp)) scoreMin = Math.max(scoreMin, minClamp);
  if (Number.isFinite(maxClamp)) scoreMin = Math.min(scoreMin, maxClamp);
  return { enabled: true, scoreMin, base, winRate, target, delta };
}

async function resolveSignalSpikeLock({ exchange, symbol, barCloseMs, pos, sysCfg } = {}) {
  const cfg = (sysCfg && typeof sysCfg === "object") ? sysCfg : {};
  const enabled = normalizeBool(cfg.signal_spike_lock_enabled, true);
  if (!enabled) return { active: false };
  const tf = String(cfg.signal_spike_tf || "15m");
  const tfMs = tfToMs(tf);
  const spikePct = normalizeNumber(cfg.signal_spike_pct, 0.02);
  const lockBars = Math.max(1, normalizeInt(cfg.signal_spike_lock_bars, 2));
  if (!Number.isFinite(tfMs) || !Number.isFinite(spikePct) || spikePct <= 0) return { active: false };

  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const lockUntil = Number(meta.spike_lock_until_ms);
  if (Number.isFinite(lockUntil) && Number(barCloseMs) < lockUntil) {
    return { active: true, tf, untilMs: lockUntil, reason: "SPIKE_LOCK_ACTIVE" };
  }

  const bars = await queryBars({ exchange, symbol, tf, limit: 3 });
  const filtered = bars
    .map((b) => ({ ...b, _t: Number(b && (b.closeTimeUtcMs ?? b.timestamp ?? b.t)) }))
    .filter((b) => Number.isFinite(b._t) && b._t <= Number(barCloseMs))
    .sort((a, b) => a._t - b._t);
  if (filtered.length < 2) return { active: false, reason: "SPIKE_INSUFFICIENT_BARS" };
  const last = filtered[filtered.length - 1];
  const prev = filtered[filtered.length - 2];
  const lastClose = Number(last && (last.close ?? last.c));
  const prevClose = Number(prev && (prev.close ?? prev.c));
  if (!Number.isFinite(lastClose) || !Number.isFinite(prevClose) || prevClose <= 0) return { active: false, reason: "SPIKE_BAD_CLOSE" };

  const movePct = Math.abs(lastClose - prevClose) / prevClose;
  if (!Number.isFinite(movePct) || movePct < spikePct) return { active: false, reason: "SPIKE_BELOW_THRESHOLD", movePct };

  const untilMs = addMs(Number(barCloseMs), tfMs * lockBars);
  return { active: true, tf, untilMs, reason: "SPIKE_DETECTED", movePct };
}

async function resolveFuturesRiskConfig(exchange) {
  const maxLev = Number(process.env.FUTURES_LEVERAGE_MAX || 3);
  const ex = String(exchange || "").toUpperCase();
  let levRaw = FUTURES_BASE_LEVERAGE;
  if (ex.includes("BINANCE")) {
    levRaw = Number(process.env.FUTURES_LEVERAGE || FUTURES_BASE_LEVERAGE);
    const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
    const cfg = (sys && sys.data) ? sys.data : {};
    if (cfg.futures_leverage != null) levRaw = Number(cfg.futures_leverage);
  }
  const leverage = normalizeFuturesLeverage(levRaw, maxLev);
  const bufferRaw = Number(process.env.FUTURES_LIQUIDATION_BUFFER_PCT || 0.02);
  const bufferPct = clamp(bufferRaw, 0.001, 0.2) || 0.02;
  return { leverage, bufferPct };
}

function normalizeExecutionMode(raw) {
  const mode = String(raw || "PAPER").toUpperCase();
  if (mode === "LIVE" || mode === "LIVE_DRY_RUN") return mode;
  return "PAPER";
}

async function resolveUpbitKeys() {
  const envKey = String(process.env.UPBIT_ACCESS_KEY || "");
  const envSecret = String(process.env.UPBIT_SECRET_KEY || "");
  if (envKey && envSecret) {
    KEY_CACHE.UPBIT = { accessKey: envKey, secretKey: envSecret, at: Date.now() };
    return { accessKey: envKey, secretKey: envSecret, source: "env" };
  }
  const data = await getExchangeSettingsForProvider("UPBIT", 5000);
  const apiKey = String((data && data.api_key) || "");
  const apiSecret = String((data && data.api_secret) || "");
  if (apiKey && apiSecret) {
    if (!envKey && !envSecret) {
      process.env.UPBIT_ACCESS_KEY = apiKey;
      process.env.UPBIT_SECRET_KEY = apiSecret;
    }
    KEY_CACHE.UPBIT = { accessKey: apiKey, secretKey: apiSecret, at: Date.now() };
    return { accessKey: apiKey, secretKey: apiSecret, source: "settings" };
  }
  if (KEY_CACHE.UPBIT.accessKey && KEY_CACHE.UPBIT.secretKey) {
    return { accessKey: KEY_CACHE.UPBIT.accessKey, secretKey: KEY_CACHE.UPBIT.secretKey, source: "cache" };
  }
  return { accessKey: "", secretKey: "", source: "missing" };
}

async function resolveBinanceKeys() {
  const keys = await resolveBinanceFuturesKeys({ ttlMs: 5000 });
  const apiKey = String(keys && keys.apiKey || "");
  const apiSecret = String(keys && keys.apiSecret || "");
  if (apiKey && apiSecret) {
    KEY_CACHE.BINANCEFUT = { apiKey, apiSecret, at: Date.now() };
    return { apiKey, apiSecret, source: (keys && keys.source) || "shared" };
  }
  if (KEY_CACHE.BINANCEFUT.apiKey && KEY_CACHE.BINANCEFUT.apiSecret) {
    return { apiKey: KEY_CACHE.BINANCEFUT.apiKey, apiSecret: KEY_CACHE.BINANCEFUT.apiSecret, source: "cache" };
  }
  return { apiKey: "", apiSecret: "", source: "missing" };
}

async function resolveKiwoomKeys() {
  const envKey = String(process.env.KIWOOM_APP_KEY || "");
  const envSecret = String(process.env.KIWOOM_APP_SECRET || "");
  if (envKey && envSecret) {
    KEY_CACHE.KIWOOM = { appKey: envKey, secretKey: envSecret, at: Date.now() };
    return { appKey: envKey, secretKey: envSecret, source: "env" };
  }
  const data = await getExchangeSettingsForProvider("KIWOOM", 5000);
  const appKey = String((data && data.api_key) || "");
  const secretKey = String((data && data.api_secret) || "");
  if (appKey && secretKey) {
    if (!envKey && !envSecret) {
      process.env.KIWOOM_APP_KEY = appKey;
      process.env.KIWOOM_APP_SECRET = secretKey;
    }
    KEY_CACHE.KIWOOM = { appKey, secretKey, at: Date.now() };
    return { appKey, secretKey, source: "settings" };
  }
  if (KEY_CACHE.KIWOOM.appKey && KEY_CACHE.KIWOOM.secretKey) {
    return { appKey: KEY_CACHE.KIWOOM.appKey, secretKey: KEY_CACHE.KIWOOM.secretKey, source: "cache" };
  }
  return { appKey: "", secretKey: "", source: "missing" };
}

async function resolveLiveConfig({ exchange, symbol } = {}) {
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const cfg = sys && sys.data ? sys.data : {};
  const execMode = normalizeExecutionMode(cfg.execution_mode);
  const allowList = Array.isArray(cfg.live_allowed_markets) ? cfg.live_allowed_markets : [];
  const minOrderKrw = Number(cfg.live_min_order_krw ?? 5000);
  const maxOrderKrw = Number(cfg.live_max_order_krw ?? 0);
  const executionMode = execMode;
  const liveDryRun = Boolean(cfg.live_dry_run) || execMode === "LIVE_DRY_RUN";
  let liveEnabled = executionMode === "LIVE" && cfg.live_enabled === true;
  let reason = null;

  const ex = String(exchange || "").toUpperCase();
  if (!ex || ex.includes("BINANCE")) {
    liveEnabled = false;
    reason = "EXCHANGE_NOT_UPBIT";
  }

  if (allowList.length && !allowList.includes(String(symbol || ""))) {
    liveEnabled = false;
    reason = "MARKET_NOT_ALLOWED";
  }

  const keys = await resolveUpbitKeys();
  if (!keys.accessKey || !keys.secretKey) {
    liveEnabled = false;
    if (!reason) reason = "UPBIT_KEYS_MISSING";
  }

  return {
    executionMode,
    liveEnabled,
    liveDryRun,
    minOrderKrw: Number.isFinite(minOrderKrw) ? minOrderKrw : 5000,
    maxOrderKrw: Number.isFinite(maxOrderKrw) ? maxOrderKrw : 0,
    accessKey: keys.accessKey,
    secretKey: keys.secretKey,
    reason,
    provider: "UPBIT",
  };
}

async function resolveLiveKiwoomConfig({ exchange, symbol } = {}) {
  const sys = await getSystemSettingsForProvider(exchange || "KIWOOM", 5000);
  const cfg = sys && sys.data ? sys.data : {};
  const execMode = normalizeExecutionMode(cfg.execution_mode);
  const allowList = Array.isArray(cfg.live_allowed_markets) ? cfg.live_allowed_markets : [];
  const minOrderKrw = Number(cfg.live_min_order_krw ?? 1000);
  const maxOrderKrw = Number(cfg.live_max_order_krw ?? 0);
  const executionMode = execMode;
  const liveDryRun = Boolean(cfg.live_dry_run) || execMode === "LIVE_DRY_RUN";
  let liveEnabled = executionMode === "LIVE" && cfg.live_enabled === true;
  let reason = null;

  const ex = String(exchange || "").toUpperCase();
  if (!ex || !ex.includes("KIWOOM")) {
    liveEnabled = false;
    reason = "EXCHANGE_NOT_KIWOOM";
  }

  if (allowList.length && !allowList.includes(String(symbol || ""))) {
    liveEnabled = false;
    reason = "MARKET_NOT_ALLOWED";
  }

  const keys = await resolveKiwoomKeys();
  if (!keys.appKey || !keys.secretKey) {
    liveEnabled = false;
    if (!reason) reason = "KIWOOM_KEYS_MISSING";
  }

  return {
    executionMode,
    liveEnabled,
    liveDryRun,
    minOrderKrw: Number.isFinite(minOrderKrw) ? minOrderKrw : 1000,
    maxOrderKrw: Number.isFinite(maxOrderKrw) ? maxOrderKrw : 0,
    appKey: keys.appKey,
    secretKey: keys.secretKey,
    route: String(cfg.kiwoom_route || "KRX").toUpperCase(),
    reason,
    provider: "KIWOOM",
  };
}

async function resolveLiveFuturesConfig({ exchange, symbol } = {}) {
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const cfg = (sys && sys.data) ? sys.data : {};
  const execMode = normalizeExecutionMode(cfg.execution_mode);
  const allowList = Array.isArray(cfg.live_allowed_markets) ? cfg.live_allowed_markets : [];
  const minOrderQuote = Number(cfg.live_min_order_krw ?? 5);
  const maxOrderQuote = Number(cfg.live_max_order_krw ?? 0);
  const executionMode = execMode;
  const liveDryRun = Boolean(cfg.live_dry_run) || execMode === "LIVE_DRY_RUN";
  let liveEnabled = executionMode === "LIVE" && cfg.live_enabled === true;
  let reason = null;

  const ex = String(exchange || "").toUpperCase();
  if (!ex || !ex.includes("BINANCE")) {
    liveEnabled = false;
    reason = "EXCHANGE_NOT_BINANCE";
  }

  if (allowList.length && !allowList.includes(String(symbol || ""))) {
    liveEnabled = false;
    reason = "MARKET_NOT_ALLOWED";
  }

  const keys = await resolveBinanceKeys();
  if (!keys.apiKey || !keys.apiSecret) {
    liveEnabled = false;
    if (!reason) reason = "BINANCEFUT_KEYS_MISSING";
  }

  const levRaw = Number(cfg.futures_leverage ?? process.env.FUTURES_LEVERAGE ?? FUTURES_BASE_LEVERAGE);
  const leverage = normalizeFuturesLeverage(levRaw, 3);
  const marginType = normalizeFuturesMarginType(cfg.futures_margin_type ?? process.env.FUTURES_MARGIN_TYPE ?? "CROSSED");
  const exitProfileMode = normalizeFuturesExitProfileMode(
    cfg.futures_exit_profile_mode ?? process.env.FUTURES_EXIT_PROFILE_MODE ?? "BASE",
    "BASE"
  );

  return {
    executionMode,
    liveEnabled,
    liveDryRun,
    minOrderQuote: Number.isFinite(minOrderQuote) ? minOrderQuote : 5,
    maxOrderQuote: Number.isFinite(maxOrderQuote) ? maxOrderQuote : 0,
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    leverage,
    marginType,
    exitProfileMode,
    reason,
  };
}

async function getBinanceFuturesPositionMode({ apiKey, apiSecret } = {}) {
  const now = Date.now();
  const keyHint = String(apiKey || "").slice(-4);
  if (
    futuresPositionModeCache.value &&
    (now - futuresPositionModeCache.at) < FUTURES_POSITION_MODE_TTL_MS &&
    futuresPositionModeCache.keyHint === keyHint
  ) {
    return futuresPositionModeCache.value;
  }
  const res = await fetchFuturesPositionMode({ apiKey, apiSecret });
  futuresPositionModeCache.value = res;
  futuresPositionModeCache.at = now;
  futuresPositionModeCache.keyHint = keyHint;
  return res;
}

async function ensureFuturesMarginType({ liveCfg, symbol } = {}) {
  const type = normalizeFuturesMarginType(liveCfg && liveCfg.marginType);
  if (!type) return { ok: true, skipped: true };
  const sym = String(symbol || "").trim().toUpperCase();
  const cached = futuresMarginCache.get(sym);
  const now = Date.now();
  if (cached && cached.type === type && (now - cached.at) < FUTURES_MARGIN_TTL_MS) {
    return { ok: true, skipped: true, note: "CACHED" };
  }
  try {
    await setFuturesMarginType({
      apiKey: liveCfg.apiKey,
      apiSecret: liveCfg.apiSecret,
      symbol: sym,
      marginType: type,
    });
    futuresMarginCache.set(sym, { type, at: now });
    return { ok: true };
  } catch (e) {
    const body = e && e.body ? String(e.body) : "";
    const msg = e && e.message ? String(e.message) : String(e);
    if (body.includes("No need to change margin type") || msg.includes("No need to change margin type") || body.includes("-4046")) {
      return { ok: true, skipped: true };
    }
    if (isBinanceMultiAssetsIsolatedMarginBlocked(e, type)) {
      futuresMarginCache.set(sym, { type, at: now, effectiveType: "CROSSED", note: "MULTI_ASSETS_ISOLATED_BLOCKED" });
      console.warn(
        `[margin_type_skip_multi_assets] ex=BINANCEFUT sym=${sym} requested=${type} effective=CROSSED reason=MULTI_ASSETS_ISOLATED_BLOCKED`
      );
      return {
        ok: true,
        skipped: true,
        note: "MULTI_ASSETS_ISOLATED_BLOCKED",
        effective_margin_type: "CROSSED",
      };
    }
    if (isBinanceMarginTypeOpenOrdersConflict(e)) {
      console.warn(
        `[margin_type_skip_open_orders] ex=BINANCEFUT sym=${sym} requested=${type} reason=OPEN_ORDERS_CONFLICT`
      );
      return {
        ok: true,
        skipped: true,
        note: "OPEN_ORDERS_CONFLICT",
      };
    }
    try {
      const positions = await getBinancePositionsSnapshot({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
      });
      const pos = positions && positions.get(String(symbol || "").toUpperCase());
      const current = String(pos && pos.marginType || "").toUpperCase();
      if (current && current === type) {
        futuresMarginCache.set(sym, { type, at: now });
        return { ok: true, skipped: true, note: "ALREADY_MATCHED" };
      }
      return { ok: false, error: msg, current_margin_type: current || null };
    } catch (_) {
      return { ok: false, error: msg };
    }
  }
}

async function getBinancePositionsSnapshot({ apiKey, apiSecret, forceRefresh } = {}) {
  const now = Date.now();
  if (!forceRefresh && futuresPositionCache.positions && (now - futuresPositionCache.at) < FUTURES_POSITION_TTL_MS) {
    return futuresPositionCache.positions;
  }
  const account = await fetchBinanceFuturesAccount({ apiKey, apiSecret });
  const positions = Array.isArray(account && account.positions) ? account.positions : [];
  const toAmt = (row) => {
    const n = Number(row && row.positionAmt);
    return Number.isFinite(n) ? n : 0;
  };
  const sideRank = (row) => {
    const s = String(row && row.positionSide || "").toUpperCase();
    if (s === "LONG" || s === "SHORT") return 2;
    if (s === "BOTH") return 1;
    return 0;
  };
  const pickPreferredRow = (cur, next) => {
    if (!cur) return next;
    const a = toAmt(cur);
    const b = toAmt(next);
    const aActive = a !== 0;
    const bActive = b !== 0;
    if (aActive !== bActive) return bActive ? next : cur;
    const absA = Math.abs(a);
    const absB = Math.abs(b);
    if (absA !== absB) return absB > absA ? next : cur;
    const rankA = sideRank(cur);
    const rankB = sideRank(next);
    if (rankA !== rankB) return rankB > rankA ? next : cur;
    const updA = Number(cur && cur.updateTime);
    const updB = Number(next && next.updateTime);
    if (Number.isFinite(updA) && Number.isFinite(updB) && updA !== updB) {
      return updB > updA ? next : cur;
    }
    return next;
  };
  const map = new Map();
  for (const p of positions) {
    const sym = String(p && p.symbol || "").toUpperCase();
    if (!sym) continue;
    map.set(sym, pickPreferredRow(map.get(sym), p));
  }
  futuresPositionCache.positions = map;
  futuresPositionCache.at = now;
  return map;
}

function resolveRecentExternalFlatSyncGuard({
  active = false,
  prevActive = false,
  prevPos = null,
  prevMeta = null,
  syncEventMs = null,
  graceMs = FUTURES_EXTERNAL_FLAT_ENTRY_GRACE_MS,
  nowMs = Date.now(),
} = {}) {
  if (active || !prevActive) return { defer: false, reason: "NOT_EXTERNAL_FLAT" };
  const graceWindowMs = Number.isFinite(Number(graceMs)) && Number(graceMs) > 0
    ? Number(graceMs)
    : FUTURES_EXTERNAL_FLAT_ENTRY_GRACE_MS;
  const meta = (prevMeta && typeof prevMeta === "object") ? prevMeta : {};
  const updatedAtMs = Date.parse(String(prevPos && prevPos.updated_at || ""));
  const refreshAtMs = Number(meta.native_protection_refresh_at_ms);
  const entryRefMs = Number.isFinite(refreshAtMs) && refreshAtMs > 0 ? refreshAtMs : updatedAtMs;
  if (!Number.isFinite(entryRefMs) || entryRefMs <= 0) {
    return { defer: false, reason: "NO_RECENT_ENTRY_REF" };
  }
  const ageMs = Math.max(0, nowMs - entryRefMs);
  if (ageMs > graceWindowMs) {
    return { defer: false, reason: "ENTRY_GRACE_EXPIRED", ageMs, graceWindowMs };
  }
  const recentEntryLike = (
    String(meta.intent || "").toUpperCase() === "ENTRY"
    || String(meta.native_protection_refresh_context || "").toUpperCase() === "ENTRY"
    || String(meta.native_protection_refresh_status || "").toUpperCase() === "OK"
    || !!String(meta.last_fill_intent || "").trim()
  );
  if (!recentEntryLike) {
    return { defer: false, reason: "NO_RECENT_ENTRY_SIGNAL", ageMs, graceWindowMs };
  }
  return {
    defer: true,
    reason: "RECENT_ENTRY_GRACE",
    ageMs,
    graceWindowMs,
    entryRefMs,
    syncEventMs: Number.isFinite(Number(syncEventMs)) ? Number(syncEventMs) : nowMs,
  };
}

function normalizeEntryLineage(meta = {}) {
  const state = (meta && typeof meta === "object") ? meta : {};
  const entryEventId = String(
    state.entry_event_id
    || state.origin_entry_event_id
    || state.tp_p1_entry_event_id
    || ""
  ).trim() || null;
  const entrySignalType = String(
    state.entry_signal_type
    || state.origin_entry_signal_type
    || ""
  ).trim().toUpperCase() || null;
  const entryGrade = String(
    state.entry_grade
    || state.origin_entry_grade
    || ""
  ).trim().toUpperCase() || null;
  const entryQtyProfile = String(
    state.entry_qty_profile
    || state.origin_entry_qty_profile
    || ""
  ).trim().toUpperCase() || null;
  const entrySignalBarMs = Number(state.entry_signal_bar_ms ?? state.origin_entry_signal_bar_ms);
  const entryExecBarMs = Number(state.entry_exec_bar_ms ?? state.origin_entry_exec_bar_ms);
  return {
    entry_event_id: entryEventId,
    entry_signal_type: entrySignalType,
    entry_grade: entryGrade,
    entry_qty_profile: entryQtyProfile,
    entry_signal_bar_ms: Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null,
    entry_exec_bar_ms: Number.isFinite(entryExecBarMs) ? entryExecBarMs : null,
  };
}

function buildEntryLineageMetaPatch(lineage = {}, {
  includeCurrent = true,
  includeOrigin = true,
} = {}) {
  const patch = {};
  const entryEventId = String(lineage.entry_event_id || "").trim() || null;
  const entrySignalType = String(lineage.entry_signal_type || "").trim().toUpperCase() || null;
  const entryGrade = String(lineage.entry_grade || "").trim().toUpperCase() || null;
  const entryQtyProfile = String(lineage.entry_qty_profile || "").trim().toUpperCase() || null;
  const entrySignalBarMs = Number(lineage.entry_signal_bar_ms);
  const entryExecBarMs = Number(lineage.entry_exec_bar_ms);
  if (includeCurrent) {
    patch.entry_event_id = entryEventId;
    patch.entry_signal_type = entrySignalType;
    patch.entry_grade = entryGrade;
    patch.entry_qty_profile = entryQtyProfile;
    patch.entry_signal_bar_ms = Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null;
    patch.entry_exec_bar_ms = Number.isFinite(entryExecBarMs) ? entryExecBarMs : null;
  }
  if (includeOrigin) {
    patch.origin_entry_event_id = entryEventId;
    patch.origin_entry_signal_type = entrySignalType;
    patch.origin_entry_grade = entryGrade;
    patch.origin_entry_qty_profile = entryQtyProfile;
    patch.origin_entry_signal_bar_ms = Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null;
    patch.origin_entry_exec_bar_ms = Number.isFinite(entryExecBarMs) ? entryExecBarMs : null;
  }
  return patch;
}

function resolveEntryLineageForFill({
  opening = false,
  entryEventIdFromIntent = null,
  entrySignalTypeFromIntent = null,
  intentEntryEventId = null,
  intentEntrySignalType = null,
  posMeta = null,
} = {}) {
  if (opening) {
    return {
      entryEventId: String(entryEventIdFromIntent || "").trim() || null,
      entrySignalType: String(entrySignalTypeFromIntent || "").trim().toUpperCase() || null,
    };
  }
  const persisted = normalizeEntryLineage(posMeta);
  return {
    entryEventId: String(intentEntryEventId || persisted.entry_event_id || "").trim() || null,
    entrySignalType: String(intentEntrySignalType || persisted.entry_signal_type || "").trim().toUpperCase() || null,
  };
}

function extractEntryLineageCandidate(row = {}, {
  exchange = null,
  symbol = null,
  side = null,
} = {}) {
  const raw = (row && typeof row === "object") ? row : {};
  const ex = String(exchange || "").toUpperCase();
  const sym = String(symbol || "").toUpperCase();
  const rowExchange = String(raw.exchange || "").toUpperCase();
  const rowSymbol = String(raw.symbol || raw.symbol_or_pair_id || raw.market || "").toUpperCase();
  if (ex && rowExchange && rowExchange !== ex) return null;
  if (sym && rowSymbol && rowSymbol !== sym) return null;
  const ev = String(raw.event || "").toUpperCase();
  if (!ev || ev.startsWith("EXIT_")) return null;
  const rowDir = directionFromSignal({ event: raw.event, side: raw.side });
  if (side && rowDir && String(side).toUpperCase() !== rowDir) return null;
  const entryEventId = String(
    raw.entry_event_id
    || raw.entryEventId
    || (raw.features_json && raw.features_json.entry_event_id)
    || ""
  ).trim() || null;
  const entrySignalType = String(
    raw.entry_signal_type
    || raw.entrySignalType
    || (raw.features_json && raw.features_json.entry_signal_type)
    || normalizeEvent(raw.event)
    || ""
  ).trim().toUpperCase() || null;
  if (!entryEventId && !entrySignalType) return null;
  const entryGrade = String(
    raw.entry_grade
    || (raw.features_json && (raw.features_json.entry_grade || raw.features_json.entry_timing_tier || raw.features_json.entry_tier))
    || ""
  ).trim().toUpperCase() || null;
  const entryQtyProfile = String(
    raw.entry_qty_profile
    || (raw.features_json && (raw.features_json.entry_qty_profile || raw.features_json.entry_qty_tier || raw.features_json.qty_profile))
    || ""
  ).trim().toUpperCase() || null;
  const entrySignalBarMs = Number(raw.signal_bar_close_time_utc_ms || raw.bar_close_time_utc_ms);
  const entryExecBarMs = Number(raw.exec_bar_close_time_utc_ms);
  const createdAtMs = Date.parse(String(raw.created_at || raw.updated_at || ""));
  return {
    entry_event_id: entryEventId,
    entry_signal_type: entrySignalType,
    entry_grade: entryGrade,
    entry_qty_profile: entryQtyProfile,
    entry_signal_bar_ms: Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null,
    entry_exec_bar_ms: Number.isFinite(entryExecBarMs) ? entryExecBarMs : null,
    created_at_ms: Number.isFinite(createdAtMs) ? createdAtMs : null,
    source_event: ev || null,
  };
}

async function recoverRecentEntryLineage({
  exchange,
  symbol,
  side,
  lookbackMs = 48 * 3600 * 1000,
  scanLimit = 240,
  nowMs = Date.now(),
} = {}) {
  try {
    const db = getFirestore();
    const refMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const cutoffMs = refMs - (Number.isFinite(Number(lookbackMs)) ? Number(lookbackMs) : (48 * 3600 * 1000));
    const maxRows = Math.max(40, Number(scanLimit) || 240);
    const collectBest = (rows) => {
      let best = null;
      let bestMs = -Infinity;
      for (const row of rows || []) {
        const candidate = extractEntryLineageCandidate(row, { exchange, symbol, side });
        if (!candidate) continue;
        const candidateMs = Number(candidate.entry_exec_bar_ms ?? candidate.entry_signal_bar_ms ?? candidate.created_at_ms);
        if (!Number.isFinite(candidateMs) || candidateMs < cutoffMs) continue;
        if (!best || candidateMs > bestMs) {
          best = candidate;
          bestMs = candidateMs;
        }
      }
      return best;
    };

    const fillsSnap = await db.collection("fills_paper")
      .orderBy("created_at", "desc")
      .limit(maxRows)
      .get();
    const bestFill = collectBest(fillsSnap.docs.map((d) => d.data() || {}));
    if (bestFill) return bestFill;

    const tradesSnap = await db.collection("trades_paper")
      .orderBy("created_at", "desc")
      .limit(maxRows)
      .get();
    const bestTrade = collectBest(tradesSnap.docs.map((d) => d.data() || {}));
    if (bestTrade) return bestTrade;

    const intentsSnap = await db.collection("order_intents_paper")
      .orderBy("created_at", "desc")
      .limit(maxRows)
      .get();
    return collectBest(intentsSnap.docs.map((d) => d.data() || {}));
  } catch (_) {
    return null;
  }
}

async function syncBinanceFuturesPosition({ runId, exchange, symbol, riskBudget, liveCfg, forceRefresh } = {}) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { ok: false, skipped: true };
  if (!liveCfg || (!liveCfg.apiKey || !liveCfg.apiSecret)) {
    return { ok: false, reason: "BINANCEFUT_KEYS_MISSING" };
  }
  const prevPos = await getPosition({ exchange, symbol });
  const prevMeta = (prevPos && typeof prevPos.meta === "object") ? prevPos.meta : null;
  const prevState = String(prevPos && (prevPos.position_state || prevPos.state) || "").toUpperCase();
  const prevSizePct = Number(prevPos && prevPos.size_pct);
  const prevQtyBase = Number(prevPos && prevPos.qty_base);
  const prevSide = normalizePositionSide(
    prevPos && (
      prevPos.position_side ||
      prevPos.side ||
      (prevMeta && (prevMeta.position_side || prevMeta.external_side || prevMeta.external_position_side))
    )
  );
  const prevActive = (prevState === "ACTIVE" || prevState === "COMMIT" || prevState === "PROBE" || prevState === "SCALE_OUT")
    && (hasPositionSize(prevSizePct) || (Number.isFinite(prevQtyBase) && prevQtyBase > 0));

  const positions = await getBinancePositionsSnapshot({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    forceRefresh: !!forceRefresh,
  });
  const posRaw = positions.get(String(symbol || "").toUpperCase());
  const amt = Number(posRaw && posRaw.positionAmt);
  const qtyBase = Number.isFinite(amt) ? Math.abs(amt) : 0;
  const entryPrice = Number(posRaw && posRaw.entryPrice);
  const markPrice = Number(posRaw && posRaw.markPrice);
  const priceRef = Number.isFinite(entryPrice) && entryPrice > 0
    ? entryPrice
    : (Number.isFinite(markPrice) && markPrice > 0 ? markPrice : null);
  const leverageRaw = Number(posRaw && posRaw.leverage);
  const maxLev = Number(process.env.FUTURES_LEVERAGE_MAX || 3);
  const leverage = normalizeFuturesLeverage(
    Number.isFinite(leverageRaw) ? leverageRaw : liveCfg.leverage,
    Number.isFinite(maxLev) ? maxLev : 3
  );
  const posSideRaw = String(posRaw && posRaw.positionSide || "").toUpperCase();
  const side = posSideRaw === "SHORT"
    ? "SHORT"
    : posSideRaw === "LONG"
      ? "LONG"
      : ((Number.isFinite(amt) && amt < 0) ? "SHORT" : "LONG");
  const active = Number.isFinite(amt) && amt !== 0;
  const notional = (active && Number.isFinite(priceRef)) ? (qtyBase * priceRef) : 0;

  // BINANCEFUT 라이브 포지션은 qty_base(실제 코인 수량)로 수량을 관리하므로
  // size_pct는 항상 1.0(= qty_base 전량 활성)으로 고정한다.
  // 기존 방식(notional / maxKrw * leverage)은 예산 비율로 계산해 BINANCEFUT 청산 수량
  // posQtyBase * size_pct가 극소값(~0.005)이 되는 구조적 버그를 일으킨다.
  const sizePct = active ? 1 : 0;

  const state = active ? "ACTIVE" : "FLAT";
  const syncUpdateMsRaw = Number(posRaw && posRaw.updateTime);
  const syncEventMs = Number.isFinite(syncUpdateMsRaw) && syncUpdateMsRaw > 0 ? syncUpdateMsRaw : Date.now();
  const externalFlatSyncGuard = resolveRecentExternalFlatSyncGuard({
    active,
    prevActive,
    prevPos,
    prevMeta,
    syncEventMs,
  });
  const budgetMaxKrw = (riskBudget && riskBudget.enabled) ? riskBudget.maxKrw : null;
  const budgetUsedKrw = (riskBudget && riskBudget.enabled)
    ? (active
      ? resolveBinanceBudgetUsedKrw({
        position: prevPos,
        riskBudget,
        notionalFallback: notional,
        priceFallback: priceRef,
        qtyBaseFallback: qtyBase,
      })
      : 0)
    : null;
  if (externalFlatSyncGuard.defer) {
    const deferMeta = mergeMeta(prevMeta, {
      external_flat_sync_deferred: true,
      external_flat_sync_deferred_reason: externalFlatSyncGuard.reason,
      external_flat_sync_deferred_at_ms: syncEventMs,
      external_flat_sync_deferred_age_ms: externalFlatSyncGuard.ageMs,
      external_flat_sync_deferred_grace_ms: externalFlatSyncGuard.graceWindowMs,
      external_flat_sync_snapshot_qty_base: qtyBase,
      external_flat_sync_snapshot_entry_price: Number.isFinite(entryPrice) ? entryPrice : null,
      external_flat_sync_snapshot_mark_price: Number.isFinite(markPrice) ? markPrice : null,
    });
    const payload = await upsertPosition({
      exchange,
      symbol,
      state: prevPos && prevPos.state ? prevPos.state : (prevState || "ACTIVE"),
      positionSide: prevSide || (prevPos && prevPos.position_side) || null,
      sizePct: Number.isFinite(prevSizePct) ? prevSizePct : 1,
      avgPrice: prevPos && prevPos.avg_price != null ? prevPos.avg_price : null,
      qtyBase: Number.isFinite(prevQtyBase) ? prevQtyBase : null,
      runId,
      executionMode: liveCfg.executionMode || "LIVE",
      budgetMaxKrw: prevPos && prevPos.budget_max_krw != null ? prevPos.budget_max_krw : budgetMaxKrw,
      budgetUsedKrw: prevPos && prevPos.budget_used_krw != null ? prevPos.budget_used_krw : budgetUsedKrw,
      budgetSource: prevPos && prevPos.budget_source != null ? prevPos.budget_source : ((riskBudget && riskBudget.enabled) ? riskBudget.source : null),
      meta: deferMeta,
    });
    return { ok: true, position: payload, active: true, deferredFlatSync: true };
  }
  const syncedAddChainBaseQtyPct = resolveSyncedAddChainBaseQtyPct({
    active,
    posMeta: prevMeta,
    budgetMaxKrw,
    budgetUsedKrw,
  });
  const metaPatch = {
    external_sync: true,
    external_source: "BINANCEFUT",
    external_synced_at: new Date().toISOString(),
    external_qty_base: qtyBase,
    external_side: active ? side : null,
    external_entry_price: Number.isFinite(entryPrice) ? entryPrice : null,
    external_mark_price: Number.isFinite(markPrice) ? markPrice : null,
    external_leverage: Number.isFinite(leverageRaw) ? leverageRaw : null,
  };
  if (!active) {
    metaPatch.tp_p0_done = false;
    metaPatch.tp_p0_price = null;
    metaPatch.tp_p0_at = null;
    metaPatch.tp_p0_source = null;
    metaPatch.tp_p0_qty_ratio = null;
    metaPatch.tp_p0_entry_event_id = null;
    metaPatch.tp_p0_entry_exec_bar_ms = null;
    metaPatch.tp_p1_done = false;
    metaPatch.tp_p1_price = null;
    metaPatch.tp_p1_target_price = null;
    metaPatch.trail_high = null;
    metaPatch.trail_low = null;
    metaPatch.trail_active = false;
    metaPatch.tp_p1_pending = false;
    metaPatch.tp_p1_pending_at_ms = null;
    metaPatch.tp_p1_pending_until_ms = null;
    metaPatch.tp_p1_pending_event = null;
    metaPatch.tp_p1_bar_ms = null;
    metaPatch.tp_p1_at = null;
    metaPatch.tp_p1_source = null;
    metaPatch.tp_p1_entry_event_id = null;
    metaPatch.tp_p1_entry_exec_bar_ms = null;
    metaPatch.tp_p1_skip_reason = null;
    metaPatch.tp_p1_skip_note = null;
    metaPatch.tp_p1_skip_at = null;
    metaPatch.trail_delay_bars_required = null;
    metaPatch.trail_delay_mfe_pct_required = null;
    metaPatch.trail_delay_release_reason = null;
    metaPatch.trail_delay_release_at = null;
    metaPatch.trail_delay_mode = null;
    metaPatch.opposite_transition_dir = null;
    metaPatch.opposite_transition_event = null;
    metaPatch.opposite_transition_until_ms = null;
    metaPatch.opposite_transition_stage = null;
    metaPatch.opposite_transition_seen_ms = null;
    metaPatch.position_side = null;
    metaPatch.intent = "EXIT";
    metaPatch.entry_exec_bar_ms = null;
    metaPatch.entry_exec_tf_ms = null;
    metaPatch.entry_event_id = null;
    metaPatch.entry_signal_type = null;
    metaPatch.entry_grade = null;
    metaPatch.entry_qty_profile = null;
    metaPatch.entry_signal_bar_ms = null;
    metaPatch.exit_profile = null;
    metaPatch.exit_profile_reason = null;
    metaPatch.exit_rules_override = null;
    metaPatch.exit_profile_rollback_active = false;
    metaPatch.exit_profile_rollback_until_ms = null;
    metaPatch.exit_profile_rollback_reason = null;
    metaPatch.exit_policy_source = null;
    metaPatch.add_chain_count = 0;
    metaPatch.add_chain_active = false;
    metaPatch.add_chain_last_ms = null;
    metaPatch.add_chain_last_event = null;
    metaPatch.add_chain_last_signal_bar_ms = null;
    metaPatch.add_chain_last_intent_id = null;
    metaPatch.add_chain_last_signal_id = null;
    metaPatch.add_chain_last_avg_before = null;
    metaPatch.add_chain_last_avg_after = null;
    metaPatch.add_chain_last_size_before = null;
    metaPatch.add_chain_last_size_after = null;
    metaPatch.add_chain_last_qty_pct = null;
    metaPatch.add_chain_last_qty_base = null;
    metaPatch.add_chain_last_loss_pct = null;
    metaPatch.add_chain_base_qty_pct = null;
    if (prevActive) {
      metaPatch.last_exit_bar_ms = syncEventMs;
      metaPatch.last_exit_dir = prevSide || null;
      metaPatch.last_exit_wall_ms = syncEventMs;
    }
  }
  let meta = mergeMeta(prevMeta, metaPatch);
  const syncMarketRegimeRow = active ? readOpenClawMarketRegimeRow(symbol) : null;
  const syncMarketRegimeCohort = normalizeOpenClawCohort(
    (syncMarketRegimeRow && syncMarketRegimeRow.cohort)
    || (prevMeta && prevMeta.openclaw_market_regime_cohort)
  );
  if (active && (syncMarketRegimeCohort || syncMarketRegimeRow || (prevMeta && prevMeta.openclaw_market_regime_cohort))) {
    meta = mergeMeta(meta, {
      openclaw_market_regime_cohort: syncMarketRegimeCohort || null,
      openclaw_market_regime_objective_score: syncMarketRegimeRow && Number.isFinite(Number(syncMarketRegimeRow.objective_score))
        ? Number(syncMarketRegimeRow.objective_score)
        : (Number.isFinite(Number(prevMeta && prevMeta.openclaw_market_regime_objective_score))
          ? Number(prevMeta.openclaw_market_regime_objective_score)
          : null),
      openclaw_market_regime_drop_verdict: syncMarketRegimeRow
        ? (String(syncMarketRegimeRow.drop_verdict || "").trim().toUpperCase() || null)
        : (prevMeta && prevMeta.openclaw_market_regime_drop_verdict
          ? String(prevMeta.openclaw_market_regime_drop_verdict).trim().toUpperCase() || null
          : null),
    });
  }
  const externalEntryTransition = active && (!prevActive || (prevSide && side && prevSide !== side));
  const persistedEntryLineage = normalizeEntryLineage(prevMeta);
  const recoveredEntryLineage = externalEntryTransition
    ? await recoverRecentEntryLineage({ exchange, symbol, side, nowMs: syncEventMs })
    : null;
  const activeEntryLineage = (
    (persistedEntryLineage && persistedEntryLineage.entry_event_id)
      ? persistedEntryLineage
      : (recoveredEntryLineage || persistedEntryLineage)
  );
  if (externalEntryTransition) {
    meta = mergeMeta(meta, {
      tp_p0_done: false,
      tp_p0_price: null,
      tp_p0_at: null,
      tp_p0_source: null,
      tp_p0_qty_ratio: null,
      tp_p0_entry_event_id: null,
      tp_p0_entry_exec_bar_ms: null,
      tp_p1_done: false,
      tp_p1_price: null,
      tp_p1_target_price: null,
      trail_high: null,
      trail_low: null,
      trail_active: false,
      tp_p1_pending: false,
      tp_p1_pending_at_ms: null,
      tp_p1_pending_until_ms: null,
      tp_p1_pending_event: null,
      tp_p1_bar_ms: null,
      tp_p1_at: null,
      tp_p1_source: null,
      tp_p1_entry_event_id: null,
      tp_p1_entry_exec_bar_ms: null,
      trail_delay_bars_required: null,
      trail_delay_mfe_pct_required: null,
      trail_delay_release_reason: null,
      trail_delay_release_at: null,
      trail_delay_mode: null,
      tp_p1_skip_reason: null,
      tp_p1_skip_note: null,
      tp_p1_skip_at: null,
      opposite_transition_dir: null,
      opposite_transition_event: null,
      opposite_transition_until_ms: null,
      opposite_transition_stage: null,
      opposite_transition_seen_ms: null,
      position_side: side,
      intent: "ENTRY",
      entry_exec_tf_ms: null,
      last_exit_bar_ms: null,
      last_exit_dir: null,
      last_exit_wall_ms: null,
      add_chain_count: 0,
      add_chain_active: false,
      add_chain_last_ms: null,
      add_chain_last_event: null,
      add_chain_last_signal_bar_ms: null,
      add_chain_last_intent_id: null,
      add_chain_last_signal_id: null,
      add_chain_last_avg_before: null,
      add_chain_last_avg_after: null,
      add_chain_last_size_before: null,
      add_chain_last_size_after: null,
      add_chain_last_qty_pct: null,
      add_chain_last_qty_base: null,
      add_chain_last_loss_pct: null,
      add_chain_base_qty_pct: Number.isFinite(syncedAddChainBaseQtyPct) ? syncedAddChainBaseQtyPct : null,
      ...buildEntryLineageMetaPatch({
        ...activeEntryLineage,
        entry_exec_bar_ms: Number.isFinite(Number(activeEntryLineage && activeEntryLineage.entry_exec_bar_ms))
          ? Number(activeEntryLineage.entry_exec_bar_ms)
          : syncEventMs,
      }),
    });
  }
  if (active && !externalEntryTransition && activeEntryLineage && activeEntryLineage.entry_event_id && !String(meta.entry_event_id || "").trim()) {
    meta = mergeMeta(meta, buildEntryLineageMetaPatch(activeEntryLineage, { includeOrigin: true }));
  }
  if (
    active
    && !externalEntryTransition
    && Number.isFinite(syncedAddChainBaseQtyPct)
    && (
      !Number.isFinite(Number(meta && meta.add_chain_base_qty_pct))
      || Number(meta && meta.add_chain_base_qty_pct) <= POS_SIZE_EPSILON
    )
  ) {
    meta = mergeMeta(meta, {
      add_chain_base_qty_pct: syncedAddChainBaseQtyPct,
    });
  }
  if (active && meta.tp_p0_done === true) {
    const linkedTp0 = isExitMetaLinkedToEntry({
      entryEventId: meta.entry_event_id,
      exitEntryEventId: meta.tp_p0_entry_event_id,
      entryExecMs: meta.entry_exec_bar_ms,
      exitEntryExecMs: meta.tp_p0_entry_exec_bar_ms,
      exitAtMs: Date.parse(String(meta.tp_p0_at || "")),
    });
    if (!linkedTp0) {
      meta = mergeMeta(meta, {
        tp_p0_done: false,
        tp_p0_price: null,
        tp_p0_at: null,
        tp_p0_source: null,
        tp_p0_qty_ratio: null,
        tp_p0_entry_event_id: null,
        tp_p0_entry_exec_bar_ms: null,
      });
    }
  }
  if (active && meta.tp_p1_done === true) {
    const linkedToEntry = isExitMetaLinkedToEntry({
      entryEventId: meta.entry_event_id,
      exitEntryEventId: meta.tp_p1_entry_event_id,
      entryExecMs: meta.entry_exec_bar_ms,
      exitEntryExecMs: meta.tp_p1_entry_exec_bar_ms,
      exitAtMs: Date.parse(String(meta.tp_p1_at || "")),
    });
    if (!linkedToEntry) {
      meta = mergeMeta(meta, {
        tp_p0_done: false,
        tp_p0_price: null,
        tp_p0_at: null,
        tp_p0_source: null,
        tp_p0_qty_ratio: null,
        tp_p0_entry_event_id: null,
        tp_p0_entry_exec_bar_ms: null,
        tp_p1_done: false,
        tp_p1_price: null,
        tp_p1_target_price: null,
        trail_high: null,
        trail_low: null,
        trail_active: false,
        tp_p1_pending: false,
        tp_p1_pending_at_ms: null,
        tp_p1_pending_until_ms: null,
        tp_p1_pending_event: null,
        tp_p1_bar_ms: null,
        tp_p1_at: null,
        tp_p1_source: null,
        tp_p1_entry_event_id: null,
        tp_p1_entry_exec_bar_ms: null,
        trail_delay_bars_required: null,
        trail_delay_mfe_pct_required: null,
        trail_delay_release_reason: null,
        trail_delay_release_at: null,
        trail_delay_mode: null,
        opposite_transition_dir: null,
        opposite_transition_event: null,
        opposite_transition_until_ms: null,
        opposite_transition_stage: null,
        opposite_transition_seen_ms: null,
        origin_entry_event_id: null,
        origin_entry_signal_type: null,
        origin_entry_grade: null,
        origin_entry_qty_profile: null,
        origin_entry_signal_bar_ms: null,
        origin_entry_exec_bar_ms: null,
      });
    }
  }
  if (active && meta.tp_p1_done !== true && meta.tp_p1_pending === true) {
    try {
      const exCfg = await getExchangeSettingsForProvider(exchange, 0);
      const pendingTf = resolveTfFromMs(meta.entry_exec_tf_ms)
        || String((exCfg && exCfg.exec_tf) || (exCfg && Array.isArray(exCfg.tf_allowlist) && exCfg.tf_allowlist[0]) || defaultExecTfFromEnv() || "15m");
      const db = getFirestore();
      const recentFills = await loadRecentFillsCache(db);
      const lastTpP1Fill = pickLatestTpP1Fill(recentFills, exchange, symbol);
      if (lastTpP1Fill) {
        meta = reconcileTpP1MetaFromFill({ posMeta: meta, pos: prevPos, fill: lastTpP1Fill });
      } else {
        const pendingState = await getTpP1PendingState({
          exchange,
          symbol,
          tf: pendingTf,
          posMeta: meta,
          tpP1PendingHoldMs: resolveTpP1PendingHoldMs(),
          nowMs: Date.now(),
        });
        if (!pendingState.active) {
          meta = mergeMeta(meta, {
            tp_p1_pending: false,
            tp_p1_pending_at_ms: null,
            tp_p1_pending_until_ms: null,
            tp_p1_pending_event: null,
            tp_p1_pending_cleared_at: new Date().toISOString(),
            tp_p1_pending_cleared_reason: "PENDING_EXPIRED_NO_ACTIVE_INTENT",
          });
        }
      }
    } catch (_) {}
  }
  if (active && shouldRepairActiveExitRuntimeState({ positionSide: side, entryPrice: priceRef, posMeta: meta })) {
    meta = await repairActivePositionExitRuntimeState({
      exchange,
      symbol,
      positionSide: side,
      entryPrice: priceRef,
      leverage,
      liveCfg,
      posMeta: meta,
      cohort: syncMarketRegimeCohort,
      sysCfg: {},
      execBarCloseMs: syncEventMs,
    });
  }

  const payload = await upsertPosition({
    exchange,
    symbol,
    state,
    positionSide: active ? side : null,
    sizePct,
    avgPrice: Number.isFinite(priceRef) ? priceRef : null,
    qtyBase: qtyBase || 0,
    runId,
    executionMode: liveCfg.executionMode || "LIVE",
    budgetMaxKrw,
    budgetUsedKrw,
    budgetSource: (riskBudget && riskBudget.enabled) ? riskBudget.source : null,
    meta,
  });

  return { ok: true, position: payload, active };
}

async function syncFuturesPositionOnly({ runId, exchange, symbol } = {}) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { ok: false, skipped: true, reason: "EXCHANGE_NOT_BINANCE" };
  const liveCfg = await resolveLiveFuturesConfig({ exchange, symbol });
  if (!liveCfg || (!liveCfg.apiKey || !liveCfg.apiSecret)) {
    return { ok: false, skipped: true, reason: "BINANCEFUT_KEYS_MISSING" };
  }
  const riskBudget = await resolveRiskBudget(symbol, exchange);
  return syncBinanceFuturesPosition({
    runId,
    exchange,
    symbol,
    riskBudget,
    liveCfg,
    // Avoid unconditional refresh on every market/tick; only force when explicitly marked.
    forceRefresh: shouldForceFuturesRefresh(symbol),
  });
}

function qtyPrecision(step) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const str = String(s);
  const idx = str.indexOf(".");
  return idx === -1 ? 0 : (str.length - idx - 1);
}

function roundQtyToStep(qty, step) {
  const q = Number(qty);
  const s = Number(step);
  if (!Number.isFinite(q) || !Number.isFinite(s) || s <= 0) return null;
  const floored = Math.floor(q / s) * s;
  const precision = qtyPrecision(s);
  return Number(floored.toFixed(precision));
}

function ceilQtyToStep(qty, step) {
  const q = Number(qty);
  const s = Number(step);
  if (!Number.isFinite(q) || !Number.isFinite(s) || s <= 0) return null;
  const ceiled = Math.ceil((q / s) - 1e-12) * s;
  const precision = qtyPrecision(s);
  return Number(ceiled.toFixed(precision));
}

async function computeFuturesOrderQty({ symbol, priceRef, notionalQuote, reduceOnly, info, skipMinNotional, qtyBase } = {}) {
  if (!Number.isFinite(priceRef) || priceRef <= 0) return { ok: false, reason: "BAD_PRICE" };
  if (!Number.isFinite(notionalQuote) || notionalQuote <= 0) return { ok: false, reason: "BAD_NOTIONAL" };

  const data = info || await fetchFuturesExchangeInfo(symbol);
  const step = data.stepSize || 0;
  const qtyRaw = (Number.isFinite(Number(qtyBase)) && Number(qtyBase) > 0)
    ? Number(qtyBase)
    : (notionalQuote / priceRef);
  let qty = roundQtyToStep(qtyRaw, step);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: "ORDER_TOO_SMALL" };

  const minQty = Number(data.minQty);
  const minNotional = Number(data.minNotional);
  if (!reduceOnly) {
    if (Number.isFinite(minQty) && minQty > 0 && qty < minQty) {
      const bumpedByMinQty = ceilQtyToStep(minQty, step);
      if (Number.isFinite(bumpedByMinQty) && bumpedByMinQty > 0) qty = bumpedByMinQty;
    }
    if (!skipMinNotional && Number.isFinite(minNotional) && minNotional > 0 && (priceRef * qty) < minNotional) {
      const minQtyByNotional = ceilQtyToStep(minNotional / priceRef, step);
      if (Number.isFinite(minQtyByNotional) && minQtyByNotional > 0 && minQtyByNotional > qty) {
        qty = minQtyByNotional;
      }
    }
  }
  if (Number.isFinite(minQty) && minQty > 0 && qty < minQty) return { ok: false, reason: "ORDER_TOO_SMALL" };

  const maxQty = Number(data.maxQty);
  if (Number.isFinite(maxQty) && maxQty > 0 && qty > maxQty) {
    qty = roundQtyToStep(maxQty, step);
  }

  if (!skipMinNotional && Number.isFinite(minNotional) && priceRef * qty < minNotional) {
    return { ok: false, reason: "ORDER_TOO_SMALL", minNotional };
  }

  return { ok: true, qty, minNotional };
}

function resolvePosQtyBase(pos) {
  const base = Number(pos && (pos.qty_base ?? (pos.meta && (pos.meta.qty_base ?? pos.meta.external_qty_base))));
  if (Number.isFinite(base) && base > 0) return base;
  const used = Number(pos && pos.budget_used_krw);
  const avg = Number(pos && pos.avg_price);
  if (Number.isFinite(used) && Number.isFinite(avg) && avg > 0) return used / avg;
  return 0;
}

async function waitUpbitOrder({ accessKey, secretKey, uuid } = {}) {
  if (!uuid) return null;
  let last = null;
  for (let i = 0; i < 3; i += 1) {
    last = await fetchOrder({ accessKey, secretKey, uuid });
    if (last && (last.state === "done" || last.state === "cancel")) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}

async function executeLiveOrder({
  liveCfg,
  symbol,
  side,
  qtyFraction,
  riskBudget,
  pos,
  bar,
  slippageBps,
} = {}) {
  if (liveCfg && String(liveCfg.provider || "").toUpperCase() === "KIWOOM") {
    return executeLiveKiwoomOrder({ liveCfg, symbol, side, qtyFraction, riskBudget, pos, bar, slippageBps });
  }
  if (!liveCfg || (!liveCfg.liveEnabled && !liveCfg.liveDryRun)) {
    return { ok: false, mode: "PAPER" };
  }
  if (!liveCfg.accessKey || !liveCfg.secretKey) {
    if (!liveCfg.liveDryRun) {
      return { ok: false, mode: "LIVE", reason: "UPBIT_KEYS_MISSING" };
    }
  }

  const minOrder = liveCfg.minOrderKrw || 0;
  const maxOrder = liveCfg.maxOrderKrw || 0;
  const sideUpper = String(side || "").toUpperCase();

  if (sideUpper === "BUY") {
    if (!riskBudget || !riskBudget.enabled || !riskBudget.maxKrw) {
      return { ok: false, mode: "LIVE", reason: "RISK_BUDGET_DISABLED" };
    }
    let qtyFractionUsed = qtyFraction;
    let orderKrw = riskBudget.maxKrw * qtyFractionUsed;
    if (maxOrder > 0 && orderKrw > maxOrder) {
      orderKrw = maxOrder;
      qtyFractionUsed = orderKrw / riskBudget.maxKrw;
    }
    if (orderKrw <= 0 || (minOrder > 0 && orderKrw < minOrder)) {
      return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL" };
    }
    if (liveCfg.liveDryRun) {
      const nextOpen = Number(bar && (bar.open ?? bar.o));
      const fillPrice = computeFillPrice({ side, nextOpen, slippageBps });
      const qtyBase = orderKrw / fillPrice;
      return {
        ok: true,
        mode: "LIVE_DRY_RUN",
        execPrice: fillPrice,
        execQtyBase: qtyBase,
        notionalKrw: orderKrw,
        qtyFractionUsed,
        execPriceSource: "LIVE_DRY_RUN",
      };
    }
    const order = await placeMarketBuy({
      accessKey: liveCfg.accessKey,
      secretKey: liveCfg.secretKey,
      market: symbol,
      priceKrw: Math.floor(orderKrw),
    });
    const detail = await waitUpbitOrder({ accessKey: liveCfg.accessKey, secretKey: liveCfg.secretKey, uuid: order.uuid });
    const avg = calcUpbitAveragePrice(detail || order);
    const execPrice = Number.isFinite(avg) ? avg : Number(order.price);
    const execVol = Number(detail && detail.executed_volume) || Number(order.executed_volume);
    const qtyBase = Number.isFinite(execVol) && execVol > 0 ? execVol : (orderKrw / execPrice);
    return {
      ok: true,
      mode: "LIVE",
      execPrice,
      execQtyBase: qtyBase,
      notionalKrw: qtyBase * execPrice,
      qtyFractionUsed,
      execPriceSource: "UPBIT_ORDER",
      liveOrderId: order.uuid || null,
    };
  }

  let qtyFractionUsed = qtyFraction;
  const posQtyBase = resolvePosQtyBase(pos);
  const posSize = Number(pos && pos.size_pct) || 0;
  if (posQtyBase <= 0 || posSize <= 0) {
    return { ok: false, mode: "LIVE", reason: "NO_POSITION" };
  }
  const ratio = posSize > 0 ? Math.min(1, qtyFractionUsed / posSize) : 1;
  let sellVolume = posQtyBase * ratio;
  const refPx = Number(bar && (bar.open ?? bar.close ?? bar.c)) || Number(pos.avg_price) || 0;
  if (minOrder > 0 && refPx > 0 && sellVolume * refPx < minOrder) {
    return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL" };
  }

  if (liveCfg.liveDryRun) {
    const nextOpen = Number(bar && (bar.open ?? bar.o));
    const fillPrice = computeFillPrice({ side, nextOpen, slippageBps });
    return {
      ok: true,
      mode: "LIVE_DRY_RUN",
      execPrice: fillPrice,
      execQtyBase: sellVolume,
      notionalKrw: sellVolume * fillPrice,
      qtyFractionUsed,
      execPriceSource: "LIVE_DRY_RUN",
    };
  }

  const order = await placeMarketSell({
    accessKey: liveCfg.accessKey,
    secretKey: liveCfg.secretKey,
    market: symbol,
    volume: sellVolume,
  });
  const detail = await waitUpbitOrder({ accessKey: liveCfg.accessKey, secretKey: liveCfg.secretKey, uuid: order.uuid });
  const avg = calcUpbitAveragePrice(detail || order);
  const execPrice = Number.isFinite(avg) ? avg : Number(order.price);
  const execVol = Number(detail && detail.executed_volume) || Number(order.executed_volume);
  const qtyBase = Number.isFinite(execVol) && execVol > 0 ? execVol : sellVolume;
  return {
    ok: true,
    mode: "LIVE",
    execPrice,
    execQtyBase: qtyBase,
    notionalKrw: qtyBase * execPrice,
    qtyFractionUsed,
    execPriceSource: "UPBIT_ORDER",
    liveOrderId: order.uuid || null,
  };
}

async function executeLiveKiwoomOrder({
  liveCfg,
  symbol,
  side,
  qtyFraction,
  riskBudget,
  pos,
  bar,
  slippageBps,
} = {}) {
  if (!liveCfg || (!liveCfg.liveEnabled && !liveCfg.liveDryRun)) {
    return { ok: false, mode: "PAPER" };
  }
  if (!liveCfg.appKey || !liveCfg.secretKey) {
    if (!liveCfg.liveDryRun) {
      return { ok: false, mode: "LIVE", reason: "KIWOOM_KEYS_MISSING" };
    }
  }
  const priceRef = Number(bar && (bar.open ?? bar.close ?? bar.c));
  if (!Number.isFinite(priceRef) || priceRef <= 0) {
    return { ok: false, mode: "LIVE", reason: "BAD_PRICE" };
  }
  if (!isKrxMarketOpenKst()) {
    return { ok: false, mode: "LIVE", reason: "MARKET_CLOSED" };
  }

  const minOrder = Number(liveCfg.minOrderKrw || 0);
  const maxOrder = Number(liveCfg.maxOrderKrw || 0);
  const sideUpper = String(side || "").toUpperCase();
  let qtyFractionUsed = qtyFraction;

  if (sideUpper === "BUY") {
    if (!riskBudget || !riskBudget.enabled || !Number.isFinite(riskBudget.maxKrw) || riskBudget.maxKrw <= 0) {
      return { ok: false, mode: "LIVE", reason: "RISK_BUDGET_DISABLED" };
    }
    let orderKrw = riskBudget.maxKrw * qtyFractionUsed;
    if (maxOrder > 0 && orderKrw > maxOrder) {
      orderKrw = maxOrder;
      qtyFractionUsed = orderKrw / riskBudget.maxKrw;
    }
    if (minOrder > 0 && orderKrw < minOrder) {
      const bumped = minOrder;
      if (maxOrder > 0 && bumped > maxOrder) {
        return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL" };
      }
      const bumpedFraction = bumped / riskBudget.maxKrw;
      if (!Number.isFinite(bumpedFraction) || bumpedFraction <= 0 || bumpedFraction > 1) {
        return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL" };
      }
      orderKrw = bumped;
      qtyFractionUsed = bumpedFraction;
    }
    if (orderKrw <= 0 || (minOrder > 0 && orderKrw < minOrder)) {
      return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL" };
    }
    let qty = Math.floor(orderKrw / priceRef);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL" };
    }

    if (liveCfg.liveDryRun) {
      const fillPrice = computeFillPrice({ side, nextOpen: priceRef, slippageBps });
      return {
        ok: true,
        mode: "LIVE_DRY_RUN",
        execPrice: fillPrice,
        execQtyBase: qty,
        notionalKrw: qty * fillPrice,
        qtyFractionUsed,
        execPriceSource: "KIWOOM_DRY_RUN",
      };
    }

    const order = await placeKiwoomOrder({
      dmst_stex_tp: liveCfg.route || "KRX",
      symbol,
      side: "BUY",
      order_type: "MARKET",
      qty,
      min_notional_krw: minOrder || null,
      auto_adjust_min_notional: false,
      reference_price: priceRef,
      block_if_closed: true,
      appkey: liveCfg.appKey,
      secretkey: liveCfg.secretKey,
    });
    if (!order || !order.ok) {
      return { ok: false, mode: "LIVE", reason: order && order.error ? order.error : "ORDER_REJECTED" };
    }
    const execPrice = computeFillPrice({ side, nextOpen: priceRef, slippageBps });
    return {
      ok: true,
      mode: "LIVE",
      execPrice,
      execQtyBase: qty,
      notionalKrw: qty * execPrice,
      qtyFractionUsed,
      execPriceSource: "KIWOOM_ORDER_EST",
      liveOrderId: order.provider_order_id || null,
    };
  }

  const posQtyBase = resolvePosQtyBase(pos);
  const posSize = Number(pos && pos.size_pct) || 0;
  if (posQtyBase <= 0 || posSize <= 0) {
    return { ok: false, mode: "LIVE", reason: "NO_POSITION" };
  }
  const ratio = posSize > 0 ? Math.min(1, qtyFractionUsed / posSize) : 1;
  let sellQty = Math.floor(posQtyBase * ratio);
  if (!Number.isFinite(sellQty) || sellQty <= 0) {
    return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL" };
  }
  if (minOrder > 0 && sellQty * priceRef < minOrder) {
    return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL" };
  }

  if (liveCfg.liveDryRun) {
    const fillPrice = computeFillPrice({ side, nextOpen: priceRef, slippageBps });
    return {
      ok: true,
      mode: "LIVE_DRY_RUN",
      execPrice: fillPrice,
      execQtyBase: sellQty,
      notionalKrw: sellQty * fillPrice,
      qtyFractionUsed,
      execPriceSource: "KIWOOM_DRY_RUN",
    };
  }

  const order = await placeKiwoomOrder({
    dmst_stex_tp: liveCfg.route || "KRX",
    symbol,
    side: "SELL",
    order_type: "MARKET",
    qty: sellQty,
    min_notional_krw: minOrder || null,
    auto_adjust_min_notional: false,
    reference_price: priceRef,
    block_if_closed: true,
    appkey: liveCfg.appKey,
    secretkey: liveCfg.secretKey,
  });
  if (!order || !order.ok) {
    return { ok: false, mode: "LIVE", reason: order && order.error ? order.error : "ORDER_REJECTED" };
  }
  const execPrice = computeFillPrice({ side, nextOpen: priceRef, slippageBps });
  return {
    ok: true,
    mode: "LIVE",
    execPrice,
    execQtyBase: sellQty,
    notionalKrw: sellQty * execPrice,
    qtyFractionUsed,
    execPriceSource: "KIWOOM_ORDER_EST",
    liveOrderId: order.provider_order_id || null,
  };
}

async function resolveBinancePositionContext({ liveCfg, symbol } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret || !sym) return null;
  const positions = await getBinancePositionsSnapshot({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    forceRefresh: true,
  });
  const row = positions && positions.get(sym);
  if (!row) return null;
  const amt = Number(row && row.positionAmt);
  const qtyBase = Number.isFinite(amt) ? Math.abs(amt) : 0;
  const active = Number.isFinite(amt) && amt !== 0 && qtyBase > 0;
  const entryPriceRaw = Number(row && row.entryPrice);
  const markPriceRaw = Number(row && row.markPrice);
  const leverageRaw = Number(row && row.leverage);
  const posSideRaw = String(row && row.positionSide || "").toUpperCase();
  const positionSide = posSideRaw === "SHORT"
    ? "SHORT"
    : posSideRaw === "LONG"
      ? "LONG"
      : (Number.isFinite(amt) && amt < 0 ? "SHORT" : "LONG");
  return {
    active,
    qtyBase,
    positionSide,
    entryPrice: (Number.isFinite(entryPriceRaw) && entryPriceRaw > 0) ? entryPriceRaw : null,
    markPrice: (Number.isFinite(markPriceRaw) && markPriceRaw > 0) ? markPriceRaw : null,
    leverage: (Number.isFinite(leverageRaw) && leverageRaw > 0) ? leverageRaw : null,
  };
}

function computeBinanceNativeProtectionPrices({ positionSide, entryPrice, leverage, rules } = {}) {
  const side = String(positionSide || "").toUpperCase();
  const px = Number(entryPrice);
  const levRaw = Number(leverage);
  const lev = Number.isFinite(levRaw) && levRaw > 0 ? levRaw : 1;
  const slPct = Number(rules && rules.SL);
  const tp0Pct = Number(rules && rules.TP_P0);
  const tpPct = Number(rules && rules.TP_P1);
  const tp0QtyRatioRaw = Number(rules && rules.TP_P0_QTY);
  const tpQtyRatioRaw = Number(rules && rules.TP_P1_QTY);
  const tp0QtyRatio = Number.isFinite(tp0QtyRatioRaw) && tp0QtyRatioRaw > 0
    ? Math.min(1, Math.max(POS_SIZE_EPSILON, tp0QtyRatioRaw))
    : 0.25;
  const tpQtyRatio = Number.isFinite(tpQtyRatioRaw) && tpQtyRatioRaw > 0
    ? Math.min(1, Math.max(POS_SIZE_EPSILON, tpQtyRatioRaw))
    : 0.5;
  if (!Number.isFinite(px) || px <= 0 || (side !== "LONG" && side !== "SHORT")) return null;
  if (!Number.isFinite(slPct) || !Number.isFinite(tpPct)) return null;
  const slMove = slPct / lev;
  const tp0Move = Number.isFinite(tp0Pct) ? (tp0Pct / lev) : null;
  const tpMove = tpPct / lev;
  let stopTriggerPx = null;
  let tp0TriggerPx = null;
  let tpTriggerPx = null;
  if (side === "LONG") {
    stopTriggerPx = px * (1 + slMove);
    tp0TriggerPx = Number.isFinite(tp0Move) ? (px * (1 + tp0Move)) : null;
    tpTriggerPx = px * (1 + tpMove);
  } else {
    const slDen = 1 + slMove;
    const tp0Den = Number.isFinite(tp0Move) ? (1 + tp0Move) : null;
    const tpDen = 1 + tpMove;
    if (slDen > 0) stopTriggerPx = px / slDen;
    if (Number.isFinite(tp0Den) && tp0Den > 0) tp0TriggerPx = px / tp0Den;
    if (tpDen > 0) tpTriggerPx = px / tpDen;
  }
  if (!Number.isFinite(stopTriggerPx) || stopTriggerPx <= 0) return null;
  if (!Number.isFinite(tp0TriggerPx) || tp0TriggerPx <= 0) tp0TriggerPx = null;
  if (!Number.isFinite(tpTriggerPx) || tpTriggerPx <= 0) tpTriggerPx = null;
  return {
    closeSide: side === "SHORT" ? "BUY" : "SELL",
    stopTriggerPx,
    tp0TriggerPx,
    tpTriggerPx,
    tp0QtyRatio,
    tpQtyRatio,
  };
}

function resolveNativeProtectionAlertReason(result) {
  const reason = String(result && result.reason ? result.reason : "").trim();
  if (reason) return reason;
  if (result && result.skipped === true) return "SKIPPED";
  return "UNKNOWN";
}

function isRetryableNativeProtectionReason(reason) {
  const code = String(reason || "").toUpperCase();
  return code === "POSITION_CONTEXT_FETCH_FAIL"
    || code === "NATIVE_CANCEL_FAIL"
    || code === "NATIVE_PLACE_FAIL"
    || code === "NATIVE_PRICE_COMPUTE_FAIL";
}

async function resolveNativeProtectionAlertChannel(exchange = "BINANCEFUT") {
  const envChannel = String(process.env.BINANCE_NATIVE_ALERT_CHANNEL || "").trim();
  if (envChannel) {
    return BINANCE_NATIVE_ALERT_TELEGRAM_ONLY ? filterTelegramChannels(envChannel) : envChannel;
  }
  const ex = String(exchange || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
  const now = Date.now();
  const cached = nativeProtectionAlertChannelCache.get(ex);
  if (cached && Number.isFinite(cached.ts) && (now - cached.ts) < BINANCE_NATIVE_ALERT_CHANNEL_CACHE_MS) {
    return cached.channel || "";
  }
  const sys = await getSystemSettingsForProvider(ex, 5000);
  const sysChannel = String(sys && sys.data && sys.data.alert_channel || "").trim();
  const resolved = BINANCE_NATIVE_ALERT_TELEGRAM_ONLY ? filterTelegramChannels(sysChannel) : sysChannel;
  nativeProtectionAlertChannelCache.set(ex, { ts: now, channel: resolved });
  return resolved;
}

async function sendRescueAddRepriceAlert({
  exchange = "BINANCEFUT",
  symbol,
  event,
  executionMode = "LIVE",
  position,
  avgBefore,
  avgAfter,
  addQtyPct,
  addQtyBase,
  fillPrice,
  exitRules,
  nativeProtectionMeta,
  alertFn,
  channelResolver,
} = {}) {
  const mode = String(executionMode || "").trim().toUpperCase();
  if (mode !== "LIVE") return { ok: false, skipped: true, reason: "NON_LIVE_MODE" };
  const rawChannel = String(process.env.RESCUE_ADD_AUDIT_ALERT_CHANNEL || "").trim();
  let channel = rawChannel ? filterTelegramChannels(rawChannel) : "";
  if (!channel) {
    const resolveChannel = typeof channelResolver === "function"
      ? channelResolver
      : resolveNativeProtectionAlertChannel;
    channel = await resolveChannel(exchange);
  }
  if (!channel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  const pos = position && typeof position === "object" ? position : null;
  const stage = pos ? buildExitStageView({
    exchange,
    position: pos,
    closePrice: Number.isFinite(Number(fillPrice)) ? Number(fillPrice) : Number(pos.avg_price),
    leverageFallback: resolvePositionLeverage({ position: pos, fallback: 1 }),
  }) : null;
  const nativeMeta = nativeProtectionMeta && typeof nativeProtectionMeta === "object" ? nativeProtectionMeta : {};
  const nativeStatus = String(nativeMeta.native_protection_refresh_status || "NA").toUpperCase() || "NA";
  const nativeReason = String(nativeMeta.native_protection_refresh_reason || "").trim();
  const nativeTpStatus = String(nativeMeta.native_protection_tp_status || "").trim().toUpperCase();
  const nativeTpReason = String(nativeMeta.native_protection_tp_reason || "").trim();
  const nativeTpQtyRatio = Number(nativeMeta.native_protection_tp_qty_ratio);
  const rulesTxt = formatExitRulesCompactLocal(exitRules || (pos && pos.meta && pos.meta.exit_rules_override) || null);
  const title = `${String(symbol || "").toUpperCase() || "UNKNOWN"} ADD 평단/보호주문 재설정`;
  const lines = [
    `이벤트: ${String(event || "ADD").toUpperCase()}`,
    `평단: ${formatAlertNumber(avgBefore)} -> ${formatAlertNumber(avgAfter)}`,
    `ADD 수량: ${formatAlertNumber(addQtyPct, 4)} / ${formatAlertNumber(addQtyBase, 6)}`,
    `체결가: ${formatAlertNumber(fillPrice)}`,
  ];
  if (rulesTxt) lines.push(`청산규칙: ${rulesTxt}`);
  if (stage) {
    lines.push(`내부 SL: ${formatAlertNumber(stage.sl_price)} / TP1: ${formatAlertNumber(stage.tp1_price)}`);
    lines.push(`내부 BE: ${formatAlertNumber(stage.be_price)} / Trail: ${formatAlertNumber(stage.trail_stop)}`);
  }
  lines.push(
    `네이티브 보호주문: ${nativeStatus}` +
    (nativeReason ? ` (${nativeReason})` : "") +
    ` / SL: ${formatAlertNumber(nativeMeta.native_protection_stop_price)}`
  );
  if (Number.isFinite(Number(nativeMeta.native_protection_tp_price))) {
    lines[lines.length - 1] += ` / TP: ${formatAlertNumber(nativeMeta.native_protection_tp_price)}`;
  }
  if (nativeTpStatus) {
    lines[lines.length - 1] += ` / TP1상태: ${nativeTpStatus}`;
    if (Number.isFinite(nativeTpQtyRatio)) {
      lines[lines.length - 1] += ` ${Math.round(nativeTpQtyRatio * 100)}%`;
    }
    if (nativeTpReason) {
      lines[lines.length - 1] += ` (${nativeTpReason})`;
    }
  }
  const notify = typeof alertFn === "function" ? alertFn : sendAlert;
  return notify({
    channel,
    title,
    body: lines.join("\n"),
    severity: "INFO",
  });
}

function shouldSendNativeProtectionAlert({ symbol, reason } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const why = String(reason || "").trim().toUpperCase() || "UNKNOWN";
  const key = `${sym || "UNKNOWN"}:${why}`;
  const now = Date.now();
  const last = Number(nativeProtectionAlertCooldownMap.get(key));
  if (Number.isFinite(last) && (now - last) < BINANCE_NATIVE_ALERT_COOLDOWN_MS) {
    return false;
  }
  nativeProtectionAlertCooldownMap.set(key, now);
  return true;
}

async function sendNativeProtectionWarningAlert({
  symbol,
  reason,
  error,
  attempts,
  exchange = "BINANCEFUT",
  liveMode = "LIVE",
} = {}) {
  if (!BINANCE_NATIVE_ALERT_ENABLED) return { ok: false, skipped: true, reason: "ALERT_DISABLED" };
  if (!shouldSendNativeProtectionAlert({ symbol, reason })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  try {
    const channel = await resolveNativeProtectionAlertChannel(exchange);
    if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
    const title = `${String(symbol || "").toUpperCase() || "UNKNOWN"} native protection 경고`;
    const lines = [
      `reason: ${String(reason || "UNKNOWN")}`,
      `attempts: ${Number.isFinite(Number(attempts)) ? Number(attempts) : 1}`,
      `mode: ${String(liveMode || "LIVE")}`,
    ];
    if (error) lines.push(`error: ${String(error).slice(0, 240)}`);
    return sendAlert({
      channel,
      title,
      body: lines.join("\n"),
      severity: "WARN",
    });
  } catch (e) {
    console.warn("[BINANCE_NATIVE_ALERT_FAIL]", e && e.message ? e.message : String(e));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

function isExitFailureAlertEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  return ev.startsWith("EXIT_SL")
    || ev.startsWith("EXIT_TP_P1")
    || ev.startsWith("EXIT_TP_C")
    || ev.startsWith("EXIT_TRAIL");
}

function resolveFailureAlertPositionSide(pos) {
  return normalizePositionSide(
    pos && (
      pos.position_side ||
      pos.side ||
      (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
    )
  );
}

function resolveFailureAlertCloseRatio({ pos, qtyFraction } = {}) {
  const prevSize = Number(pos && pos.size_pct);
  const qty = Number(qtyFraction);
  if (!Number.isFinite(prevSize) || prevSize <= 0) return null;
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return Math.max(0, Math.min(1, qty / prevSize));
}

function notifyTradeExitFailureAlert(payload = {}) {
  if (String(payload.intent || "").toUpperCase() !== "EXIT") return;
  if (!isExitFailureAlertEvent(payload.event)) return;
  sendTradeExecutionFailureAlert(payload).catch((e) => {
    console.warn("[TRADE_EXEC_FAIL_ALERT_FAIL]", e && e.message ? e.message : String(e));
  });
}

async function refreshBinanceNativeProtectionWithRetry({
  liveCfg,
  exchange,
  symbol,
  fallbackSide,
  fallbackEntryPrice,
  fallbackLeverage,
  exitRulesOverride,
} = {}) {
  const totalAttempts = BINANCE_NATIVE_PROTECTION_RETRY_COUNT + 1;
  let lastResult = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const result = await refreshBinanceNativeProtection({
      liveCfg,
      exchange,
      symbol,
      fallbackSide,
      fallbackEntryPrice,
      fallbackLeverage,
      exitRulesOverride,
    });
    const enriched = {
      ...(result && typeof result === "object" ? result : {}),
      attempts: attempt,
      max_attempts: totalAttempts,
    };
    if (enriched.ok === true) return enriched;
    lastResult = enriched;
    const reason = resolveNativeProtectionAlertReason(enriched);
    if (attempt >= totalAttempts || !isRetryableNativeProtectionReason(reason)) break;
    if (BINANCE_NATIVE_PROTECTION_RETRY_DELAY_MS > 0) {
      await sleepMs(BINANCE_NATIVE_PROTECTION_RETRY_DELAY_MS);
    }
  }
  return lastResult || { ok: false, reason: "UNKNOWN", attempts: totalAttempts, max_attempts: totalAttempts };
}

function isBinanceImmediateTriggerError(error) {
  const text = String(error && error.message ? error.message : error || "").toUpperCase();
  return text.includes("CODE\":-2021") || text.includes("ORDER WOULD IMMEDIATELY TRIGGER");
}

async function placeNativeTpMarketFallback({
  liveCfg,
  exchange,
  symbol,
  positionSide,
  closeSide,
  entryPrice,
  leverage,
  triggerPrice,
  quantity,
} = {}) {
  const tpIdempotencyKey = buildBinanceNativeProtectionIdempotencyKey({
    exchange,
    symbol,
    positionSide,
    closeSide,
    entryPrice,
    leverage,
    triggerPrice,
    kind: "TP1_MARKET",
  });
  const marketOrder = await placeFuturesMarketOrder({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    symbol,
    side: closeSide,
    quantity,
    reduceOnly: true,
    idempotencyKey: tpIdempotencyKey,
  });
  return {
    order: marketOrder,
    client_order_mode: "MARKET_FALLBACK",
  };
}

function buildNativeProtectionMetaPatch({
  nativeProtection,
  intent,
  execBarCloseMs,
} = {}) {
  const intentUpper = String(intent || "").toUpperCase();
  if (!nativeProtection || (intentUpper !== "ENTRY" && intentUpper !== "ADD")) return null;
  const refreshAtMs = Date.now();
  const status = nativeProtection.ok === true
    ? "OK"
    : (nativeProtection.skipped === true ? "SKIPPED" : "FAILED");
  const reason = nativeProtection.ok === true
    ? null
    : resolveNativeProtectionAlertReason(nativeProtection);
  const basePatch = {
    native_protection_refresh_status: status,
    native_protection_refresh_reason: reason,
    native_protection_refresh_context: intentUpper,
    native_protection_refresh_at_ms: refreshAtMs,
    native_protection_refresh_bar_ms: Number.isFinite(Number(execBarCloseMs)) ? Number(execBarCloseMs) : null,
    native_protection_stale: nativeProtection.ok === true ? false : true,
    native_protection_attempts: Number.isFinite(Number(nativeProtection.attempts)) ? Number(nativeProtection.attempts) : null,
    native_protection_max_attempts: Number.isFinite(Number(nativeProtection.max_attempts)) ? Number(nativeProtection.max_attempts) : null,
  };
  if (nativeProtection.ok === true) {
    return {
      ...basePatch,
      native_protection_stop_order_id: nativeProtection.stop_order_id || null,
      native_protection_tp0_order_id: nativeProtection.tp0_order_id || null,
      native_protection_tp_order_id: nativeProtection.tp_order_id || null,
      native_protection_stop_price: Number.isFinite(Number(nativeProtection.stop_price)) ? Number(nativeProtection.stop_price) : null,
      native_protection_tp0_price: Number.isFinite(Number(nativeProtection.tp0_price)) ? Number(nativeProtection.tp0_price) : null,
      native_protection_tp_price: Number.isFinite(Number(nativeProtection.tp_price)) ? Number(nativeProtection.tp_price) : null,
      native_protection_tp0_qty_base: Number.isFinite(Number(nativeProtection.tp0_qty_base)) ? Number(nativeProtection.tp0_qty_base) : null,
      native_protection_tp_qty_base: Number.isFinite(Number(nativeProtection.tp_qty_base)) ? Number(nativeProtection.tp_qty_base) : null,
      native_protection_tp0_qty_ratio: Number.isFinite(Number(nativeProtection.tp0_qty_ratio)) ? Number(nativeProtection.tp0_qty_ratio) : null,
      native_protection_tp_qty_ratio: Number.isFinite(Number(nativeProtection.tp_qty_ratio)) ? Number(nativeProtection.tp_qty_ratio) : null,
      native_protection_tp0_status: nativeProtection.tp0_status || null,
      native_protection_tp_status: nativeProtection.tp_status || null,
      native_protection_tp0_reason: nativeProtection.tp0_reason || null,
      native_protection_tp_reason: nativeProtection.tp_reason || null,
      native_protection_entry_price: Number.isFinite(Number(nativeProtection.entry_price)) ? Number(nativeProtection.entry_price) : null,
      native_protection_side: nativeProtection.position_side || null,
    };
  }
  return {
    ...basePatch,
    native_protection_stop_order_id: nativeProtection.stop_order_id ? String(nativeProtection.stop_order_id) : undefined,
    native_protection_tp0_order_id: nativeProtection.tp0_order_id ? String(nativeProtection.tp0_order_id) : undefined,
    native_protection_tp_order_id: nativeProtection.tp_order_id ? String(nativeProtection.tp_order_id) : undefined,
    native_protection_stop_price: Number.isFinite(Number(nativeProtection.stop_price)) ? Number(nativeProtection.stop_price) : undefined,
    native_protection_tp0_price: Number.isFinite(Number(nativeProtection.tp0_price)) ? Number(nativeProtection.tp0_price) : undefined,
    native_protection_tp_price: Number.isFinite(Number(nativeProtection.tp_price)) ? Number(nativeProtection.tp_price) : undefined,
    native_protection_tp0_qty_base: Number.isFinite(Number(nativeProtection.tp0_qty_base)) ? Number(nativeProtection.tp0_qty_base) : undefined,
    native_protection_tp_qty_base: Number.isFinite(Number(nativeProtection.tp_qty_base)) ? Number(nativeProtection.tp_qty_base) : undefined,
    native_protection_tp0_qty_ratio: Number.isFinite(Number(nativeProtection.tp0_qty_ratio)) ? Number(nativeProtection.tp0_qty_ratio) : undefined,
    native_protection_tp_qty_ratio: Number.isFinite(Number(nativeProtection.tp_qty_ratio)) ? Number(nativeProtection.tp_qty_ratio) : undefined,
    native_protection_tp0_status: nativeProtection.tp0_status ? String(nativeProtection.tp0_status) : undefined,
    native_protection_tp_status: nativeProtection.tp_status ? String(nativeProtection.tp_status) : undefined,
    native_protection_tp0_reason: nativeProtection.tp0_reason ? String(nativeProtection.tp0_reason) : undefined,
    native_protection_tp_reason: nativeProtection.tp_reason ? String(nativeProtection.tp_reason) : undefined,
    native_protection_entry_price: Number.isFinite(Number(nativeProtection.entry_price)) ? Number(nativeProtection.entry_price) : undefined,
    native_protection_side: nativeProtection.position_side ? String(nativeProtection.position_side) : undefined,
  };
}

async function refreshBinanceNativeProtection({
  liveCfg,
  exchange,
  symbol,
  fallbackSide,
  fallbackEntryPrice,
  fallbackLeverage,
  exitRulesOverride,
} = {}) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { ok: false, skipped: true, reason: "NOT_BINANCE" };
  if (!BINANCE_NATIVE_PROTECTION_ENABLED) return { ok: false, skipped: true, reason: "NATIVE_PROTECTION_DISABLED" };
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) return { ok: false, skipped: true, reason: "BINANCEFUT_KEYS_MISSING" };

  let context = null;
  try {
    context = await resolveBinancePositionContext({ liveCfg, symbol });
  } catch (e) {
    return { ok: false, skipped: true, reason: "POSITION_CONTEXT_FETCH_FAIL", error: e && e.message ? e.message : String(e) };
  }

  if (!context || !context.active) {
    try {
      await cancelFuturesOpenOrders({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
        symbol,
      });
      return { ok: true, state: "FLAT", canceled: true };
    } catch (e) {
      return { ok: false, state: "FLAT", canceled: false, reason: "CANCEL_OPEN_ORDERS_FAIL", error: e && e.message ? e.message : String(e) };
    }
  }

  const fallbackPosSide = String(fallbackSide || "").toUpperCase() === "SELL" ? "SHORT" : "LONG";
  const entryPrice = Number.isFinite(Number(context.entryPrice)) && Number(context.entryPrice) > 0
    ? Number(context.entryPrice)
    : Number(fallbackEntryPrice);
  const leverage = Number.isFinite(Number(context.leverage)) && Number(context.leverage) > 0
    ? Number(context.leverage)
    : Number(fallbackLeverage);
  const positionSide = String(context.positionSide || fallbackPosSide).toUpperCase();
  const rules = resolveExitRulesForPosition({
    exchange,
    position: { meta: { exit_rules_override: exitRulesOverride || null } },
  });
  const prices = computeBinanceNativeProtectionPrices({
    positionSide,
    entryPrice,
    leverage,
    rules,
  });
  if (!prices) {
    return { ok: false, skipped: true, reason: "NATIVE_PRICE_COMPUTE_FAIL", positionSide, entryPrice, leverage };
  }

  try {
    await cancelFuturesOpenOrders({
      apiKey: liveCfg.apiKey,
      apiSecret: liveCfg.apiSecret,
      symbol,
    });
  } catch (e) {
    return { ok: false, reason: "NATIVE_CANCEL_FAIL", error: e && e.message ? e.message : String(e) };
  }

  try {
    const stopIdempotencyKey = buildBinanceNativeProtectionIdempotencyKey({
      exchange,
      symbol,
      positionSide,
      closeSide: prices.closeSide,
      entryPrice,
      leverage,
      triggerPrice: prices.stopTriggerPx,
      kind: "STOP",
    });
    const stopOrder = await placeFuturesStopMarketOrder({
      apiKey: liveCfg.apiKey,
      apiSecret: liveCfg.apiSecret,
      symbol,
      side: prices.closeSide,
      stopPrice: prices.stopTriggerPx,
      closePosition: true,
      workingType: BINANCE_NATIVE_WORKING_TYPE,
      priceProtect: BINANCE_NATIVE_PRICE_PROTECT,
      idempotencyKey: stopIdempotencyKey,
    });
    let tp0Order = null;
    let tpOrder = null;
    let tp0QtyBase = null;
    let tpQtyBase = null;
    let tp0QtyRatio = null;
    let tpQtyRatio = null;
    let desiredTp0QtyPlaced = null;
    let desiredTpQtyPlaced = null;
    let tp0Status = BINANCE_NATIVE_TP_ENABLED ? "SKIPPED" : "DISABLED";
    let tp0Reason = BINANCE_NATIVE_TP_ENABLED ? "TP0_TRIGGER_INVALID" : "NATIVE_TP_DISABLED";
    let tpStatus = BINANCE_NATIVE_TP_ENABLED ? "SKIPPED" : "DISABLED";
    let tpReason = BINANCE_NATIVE_TP_ENABLED ? "TP_TRIGGER_INVALID" : "NATIVE_TP_DISABLED";
    if (BINANCE_NATIVE_TP_ENABLED && Number.isFinite(prices.tp0TriggerPx) && prices.tp0TriggerPx > 0) {
      try {
        const exchangeInfo = await fetchFuturesExchangeInfo(symbol);
        const desiredTp0QtyBase = Number(context.qtyBase) * Number(prices.tp0QtyRatio || 0.25);
        const tp0QtyInfo = await computeFuturesOrderQty({
          symbol,
          priceRef: prices.tp0TriggerPx,
          notionalQuote: desiredTp0QtyBase * prices.tp0TriggerPx,
          reduceOnly: true,
          info: exchangeInfo,
          qtyBase: desiredTp0QtyBase,
        });
        if (!tp0QtyInfo.ok || !Number.isFinite(tp0QtyInfo.qty) || tp0QtyInfo.qty <= 0) {
          tp0Status = "SKIPPED";
          tp0Reason = tp0QtyInfo.reason || "TP0_QTY_INVALID";
        } else if (tp0QtyInfo.qty + POS_SIZE_EPSILON >= Number(context.qtyBase)) {
          tp0Status = "SKIPPED";
          tp0Reason = "TP0_QTY_FULL_POSITION";
        } else {
          desiredTp0QtyPlaced = tp0QtyInfo.qty;
          const tp0IdempotencyKey = buildBinanceNativeProtectionIdempotencyKey({
            exchange,
            symbol,
            positionSide,
            closeSide: prices.closeSide,
            entryPrice,
            leverage,
            triggerPrice: prices.tp0TriggerPx,
            kind: "TP0",
          });
          tp0Order = await placeFuturesTakeProfitMarketOrder({
            apiKey: liveCfg.apiKey,
            apiSecret: liveCfg.apiSecret,
            symbol,
            side: prices.closeSide,
            stopPrice: prices.tp0TriggerPx,
            closePosition: false,
            quantity: tp0QtyInfo.qty,
            reduceOnly: true,
            workingType: BINANCE_NATIVE_WORKING_TYPE,
            priceProtect: BINANCE_NATIVE_PRICE_PROTECT,
            idempotencyKey: tp0IdempotencyKey,
          });
          tp0QtyBase = tp0QtyInfo.qty;
          tp0QtyRatio = Number(context.qtyBase) > 0 ? Math.min(1, tp0QtyInfo.qty / Number(context.qtyBase)) : null;
          tp0Status = "OK";
          tp0Reason = null;
        }
      } catch (tp0Err) {
        if (isBinanceImmediateTriggerError(tp0Err) && Number.isFinite(desiredTp0QtyPlaced) && desiredTp0QtyPlaced > 0) {
          try {
            const fallback = await placeNativeTpMarketFallback({
              liveCfg,
              exchange,
              symbol,
              positionSide,
              closeSide: prices.closeSide,
              entryPrice,
              leverage,
              triggerPrice: prices.tp0TriggerPx,
              quantity: desiredTp0QtyPlaced,
            });
            tp0Order = fallback.order;
            tp0QtyBase = desiredTp0QtyPlaced;
            tp0QtyRatio = Number(context.qtyBase) > 0 ? Math.min(1, desiredTp0QtyPlaced / Number(context.qtyBase)) : null;
            tp0Status = "OK";
            tp0Reason = "MARKET_FALLBACK";
          } catch (fallbackErr) {
            tp0Status = "FAILED";
            tp0Reason = fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr);
          }
        } else {
          tp0Status = "FAILED";
          tp0Reason = tp0Err && tp0Err.message ? tp0Err.message : String(tp0Err);
        }
      }
    }
    if (BINANCE_NATIVE_TP_ENABLED && Number.isFinite(prices.tpTriggerPx) && prices.tpTriggerPx > 0) {
      try {
        const exchangeInfo = await fetchFuturesExchangeInfo(symbol);
        const desiredTpQtyBase = Number(context.qtyBase) * Number(prices.tpQtyRatio || 0.5);
        const tpQtyInfo = await computeFuturesOrderQty({
          symbol,
          priceRef: prices.tpTriggerPx,
          notionalQuote: desiredTpQtyBase * prices.tpTriggerPx,
          reduceOnly: true,
          info: exchangeInfo,
          qtyBase: desiredTpQtyBase,
        });
        if (!tpQtyInfo.ok || !Number.isFinite(tpQtyInfo.qty) || tpQtyInfo.qty <= 0) {
          tpStatus = "SKIPPED";
          tpReason = tpQtyInfo.reason || "TP_QTY_INVALID";
        } else if (tpQtyInfo.qty + POS_SIZE_EPSILON >= Number(context.qtyBase)) {
          tpStatus = "SKIPPED";
          tpReason = "TP_QTY_FULL_POSITION";
        } else {
          desiredTpQtyPlaced = tpQtyInfo.qty;
          const tpIdempotencyKey = buildBinanceNativeProtectionIdempotencyKey({
            exchange,
            symbol,
            positionSide,
            closeSide: prices.closeSide,
            entryPrice,
            leverage,
            triggerPrice: prices.tpTriggerPx,
            kind: "TP1",
          });
          tpOrder = await placeFuturesTakeProfitMarketOrder({
            apiKey: liveCfg.apiKey,
            apiSecret: liveCfg.apiSecret,
            symbol,
            side: prices.closeSide,
            stopPrice: prices.tpTriggerPx,
            closePosition: false,
            quantity: tpQtyInfo.qty,
            reduceOnly: true,
            workingType: BINANCE_NATIVE_WORKING_TYPE,
            priceProtect: BINANCE_NATIVE_PRICE_PROTECT,
            idempotencyKey: tpIdempotencyKey,
          });
          tpQtyBase = tpQtyInfo.qty;
          tpQtyRatio = Number(context.qtyBase) > 0 ? Math.min(1, tpQtyInfo.qty / Number(context.qtyBase)) : null;
          tpStatus = "OK";
          tpReason = null;
        }
      } catch (tpErr) {
        if (isBinanceImmediateTriggerError(tpErr) && Number.isFinite(desiredTpQtyPlaced) && desiredTpQtyPlaced > 0) {
          try {
            const fallback = await placeNativeTpMarketFallback({
              liveCfg,
              exchange,
              symbol,
              positionSide,
              closeSide: prices.closeSide,
              entryPrice,
              leverage,
              triggerPrice: prices.tpTriggerPx,
              quantity: desiredTpQtyPlaced,
            });
            tpOrder = fallback.order;
            tpQtyBase = desiredTpQtyPlaced;
            tpQtyRatio = Number(context.qtyBase) > 0 ? Math.min(1, desiredTpQtyPlaced / Number(context.qtyBase)) : null;
            tpStatus = "OK";
            tpReason = "MARKET_FALLBACK";
          } catch (fallbackErr) {
            tpStatus = "FAILED";
            tpReason = fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr);
          }
        } else {
          tpStatus = "FAILED";
          tpReason = tpErr && tpErr.message ? tpErr.message : String(tpErr);
        }
      }
    }
    return {
      ok: true,
      state: "ACTIVE",
      position_side: positionSide,
      entry_price: entryPrice,
      leverage,
      close_side: prices.closeSide,
      stop_price: prices.stopTriggerPx,
      tp0_price: prices.tp0TriggerPx,
      tp_price: prices.tpTriggerPx,
      tp0_qty_base: Number.isFinite(tp0QtyBase) ? tp0QtyBase : null,
      tp_qty_base: Number.isFinite(tpQtyBase) ? tpQtyBase : null,
      tp0_qty_ratio: Number.isFinite(tp0QtyRatio) ? tp0QtyRatio : null,
      tp_qty_ratio: Number.isFinite(tpQtyRatio) ? tpQtyRatio : null,
      tp0_status: tp0Status,
      tp_status: tpStatus,
      tp0_reason: tp0Reason,
      tp_reason: tpReason,
      stop_order_id: stopOrder && stopOrder.orderId ? String(stopOrder.orderId) : null,
      tp0_order_id: tp0Order && tp0Order.orderId ? String(tp0Order.orderId) : null,
      tp_order_id: tpOrder && tpOrder.orderId ? String(tpOrder.orderId) : null,
    };
  } catch (e) {
    return { ok: false, reason: "NATIVE_PLACE_FAIL", error: e && e.message ? e.message : String(e) };
  }
}

function sanitizeBinanceKeyPart(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/g, "")
    .slice(0, 60);
}

async function notifyNativeProtectionResult({
  nativeProtection,
  symbol,
  exchange,
  liveMode = "LIVE",
  alertFn,
} = {}) {
  if (!nativeProtection) return { ok: true, skipped: true };
  if (nativeProtection.ok === true) {
    if (String(nativeProtection.tp_status || "").toUpperCase() === "FAILED") {
      const reason = String(nativeProtection.tp_reason || "").trim() || "TP_PARTIAL_PLACE_FAIL";
      console.warn(
        `[BINANCE_NATIVE_PROTECT_WARN] ${String(symbol || "").toUpperCase()} TP_PARTIAL_PLACE_FAIL ` +
        `${reason}`.trim()
      );
      try {
        const notify = typeof alertFn === "function" ? alertFn : sendNativeProtectionWarningAlert;
        await notify({
          symbol,
          reason: "TP_PARTIAL_PLACE_FAIL",
          error: reason,
          attempts: nativeProtection.attempts,
          exchange,
          liveMode,
        });
      } catch (alertErr) {
        console.warn("[BINANCE_NATIVE_PROTECT_ALERT_FAIL]", alertErr && alertErr.message ? alertErr.message : String(alertErr));
      }
      return { ok: false, reason: "TP_PARTIAL_PLACE_FAIL" };
    }
    return { ok: true, skipped: true };
  }
  const npReason = resolveNativeProtectionAlertReason(nativeProtection);
  console.warn(
    `[BINANCE_NATIVE_PROTECT_WARN] ${String(symbol || "").toUpperCase()} ${npReason} ` +
    `${nativeProtection.error || ""}`.trim()
  );
  try {
    const notify = typeof alertFn === "function" ? alertFn : sendNativeProtectionWarningAlert;
    await notify({
      symbol,
      reason: npReason,
      error: nativeProtection.error || null,
      attempts: nativeProtection.attempts,
      exchange,
      liveMode,
    });
  } catch (alertErr) {
    console.warn("[BINANCE_NATIVE_PROTECT_ALERT_FAIL]", alertErr && alertErr.message ? alertErr.message : String(alertErr));
  }
  return { ok: false, reason: npReason };
}

function buildBinanceOrderIdempotencyKey({
  intentId,
  exchange,
  symbol,
  side,
  intent,
  event,
  barCloseMs,
  qty,
  reduceOnly,
  tag = "main",
} = {}) {
  const keyBase = [
    sanitizeBinanceKeyPart(intentId || ""),
    sanitizeBinanceKeyPart(exchange || ""),
    sanitizeBinanceKeyPart(symbol || ""),
    sanitizeBinanceKeyPart(side || ""),
    sanitizeBinanceKeyPart(intent || ""),
    sanitizeBinanceKeyPart(event || ""),
    String(Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : ""),
    String(Number.isFinite(Number(qty)) ? Number(qty).toFixed(8) : ""),
    reduceOnly ? "1" : "0",
    sanitizeBinanceKeyPart(tag || "main"),
  ].join("|");
  const digest = crypto.createHash("sha256").update(keyBase).digest("hex").slice(0, 24);
  return `fut_${digest}`;
}

function buildBinanceNativeProtectionIdempotencyKey({
  exchange,
  symbol,
  positionSide,
  closeSide,
  entryPrice,
  leverage,
  triggerPrice,
  kind,
} = {}) {
  const keyBase = [
    sanitizeBinanceKeyPart(exchange || "BINANCEFUT"),
    sanitizeBinanceKeyPart(symbol || ""),
    sanitizeBinanceKeyPart(positionSide || ""),
    sanitizeBinanceKeyPart(closeSide || ""),
    sanitizeBinanceKeyPart(kind || "NATIVE"),
    String(Number.isFinite(Number(entryPrice)) ? Number(entryPrice).toFixed(8) : ""),
    String(Number.isFinite(Number(leverage)) ? Number(leverage).toFixed(4) : ""),
    String(Number.isFinite(Number(triggerPrice)) ? Number(triggerPrice).toFixed(8) : ""),
  ].join("|");
  const digest = crypto.createHash("sha256").update(keyBase).digest("hex").slice(0, 24);
  return `native_${digest}`;
}

async function executeLiveFuturesOrder({
  liveCfg,
  exchange,
  symbol,
  tf,
  side,
  qtyFraction,
  maxFractionAllowed,
  riskBudget,
  budgetMaxOverride,
  leverageResolvedOverride,
  manualRetry,
  manualQtyBaseOverride,
  posQtyBase,
  intentId,
  intent,
  event,
  features,
  positionMeta,
  marketRegimeCohort,
  sysCfg,
  bar,
  barCloseMs,
  slippageBps,
} = {}) {
  if (!liveCfg || (!liveCfg.liveEnabled && !liveCfg.liveDryRun)) {
    return { ok: false, mode: "PAPER" };
  }
  if (!liveCfg.apiKey || !liveCfg.apiSecret) {
    if (!liveCfg.liveDryRun) {
      return { ok: false, mode: "LIVE", reason: "BINANCEFUT_KEYS_MISSING" };
    }
  }

  if (!liveCfg.liveDryRun) {
    const mode = await getBinanceFuturesPositionMode({ apiKey: liveCfg.apiKey, apiSecret: liveCfg.apiSecret });
    if (mode && mode.dualSidePosition === true) {
      return { ok: false, mode: "LIVE", reason: "HEDGE_MODE_ON" };
    }
  }

  const priceRef = Number(bar && (bar.open ?? bar.close ?? bar.c));
  if (!Number.isFinite(priceRef) || priceRef <= 0) {
    return { ok: false, mode: "LIVE", reason: "BAD_PRICE" };
  }

  const isExit = String(intent || "").toUpperCase() === "EXIT";
  const isTpP1Exit = isExit && isTpP1EventLocal(event);
  const manualRetryEntry = !isExit && (manualRetry === true || isManualRetryFeatures(features));
  const orderIntentId = String(intentId || "").trim() || null;
  const manualQtyBase = manualRetryEntry
    ? resolveManualRetryQtyBase({ ...(features || {}), _manual_retry_qty_base: manualQtyBaseOverride })
    : null;
  const budgetBaseRaw = Number.isFinite(Number(budgetMaxOverride)) && Number(budgetMaxOverride) > 0
    ? Number(budgetMaxOverride)
    : Number(riskBudget && riskBudget.maxKrw);
  if (!isExit && !manualRetryEntry && (!riskBudget || !riskBudget.enabled || !Number.isFinite(budgetBaseRaw) || budgetBaseRaw <= 0)) {
    return { ok: false, mode: "LIVE", reason: "RISK_BUDGET_DISABLED" };
  }
  if (isExit && (!Number.isFinite(posQtyBase) || posQtyBase <= 0)) {
    return { ok: false, mode: "LIVE", reason: "NO_POSITION" };
  }
  if (!isExit && !liveCfg.liveDryRun) {
    triggerExitWorkerRun({
      reason: `ENTRY_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}`,
    }).catch((e) => {
      const errText = e && e.message ? e.message : String(e);
      console.warn("[EXIT_WORKER_SCALE_ON_FAIL]", errText);
      sendNativeProtectionWarningAlert({
        symbol,
        reason: "EXIT_WORKER_SCALE_ON_FAIL",
        error: errText,
        attempts: 1,
        exchange,
        liveMode: "LIVE",
      }).catch((alertErr) => {
        console.warn("[EXIT_WORKER_SCALE_ALERT_FAIL]", alertErr && alertErr.message ? alertErr.message : String(alertErr));
      });
    });
  }
  const leverageResolved = (
    leverageResolvedOverride &&
    Number.isFinite(Number(leverageResolvedOverride.leverage)) &&
    Number(leverageResolvedOverride.leverage) > 0
  )
    ? leverageResolvedOverride
    : await resolveAdaptiveFuturesLeverage({
      liveCfg,
      exchange,
      symbol,
      tf,
      intent,
      event,
      side,
      features,
      nowMs: Number(barCloseMs),
    });
  const leverageMult = Number.isFinite(Number(leverageResolved && leverageResolved.leverage))
    ? Number(leverageResolved.leverage)
    : FUTURES_BASE_LEVERAGE;
  const intentUpper = String(intent || "").toUpperCase();
  const metaForProfile = (positionMeta && typeof positionMeta === "object") ? positionMeta : {};
  let exitProfileResolved = null;
  if (intentUpper === "ENTRY" || intentUpper === "ADD") {
    exitProfileResolved = await resolveAdaptiveFuturesExitProfile({
      exchange,
      symbol,
      tf,
      intent,
      event,
      side,
      features,
      nowMs: Number(barCloseMs),
      leverageDecision: leverageResolved,
      manualProfileMode: liveCfg && liveCfg.exitProfileMode,
    });
  } else if (metaForProfile.exit_rules_override && typeof metaForProfile.exit_rules_override === "object") {
    const profileFromMeta = String(metaForProfile.exit_profile || "BASE").toUpperCase();
    exitProfileResolved = buildExitProfileDecision(
      profileFromMeta === "AGGRESSIVE" ? FUTURES_EXIT_PROFILE_AGGRESSIVE : FUTURES_EXIT_PROFILE_BASE,
      "FOLLOW_POSITION_META",
      { profile: profileFromMeta, rules: cloneExitRules(metaForProfile.exit_rules_override) }
    );
  } else {
    const positionProfile = resolvePositionExitProfile({
      posMeta: metaForProfile,
      fallbackMode: liveCfg && liveCfg.exitProfileMode,
    });
    exitProfileResolved = buildExitProfileDecision(
      positionProfile.profile === "AGGRESSIVE" ? FUTURES_EXIT_PROFILE_AGGRESSIVE : FUTURES_EXIT_PROFILE_BASE,
      positionProfile.reason,
      { profile: positionProfile.profile, rules: cloneExitRules(positionProfile.rules) }
    );
  }
  let exitRulesOverride = cloneExitRules(
    exitProfileResolved && exitProfileResolved.rules
      ? exitProfileResolved.rules
      : FUTURES_EXIT_PROFILE_BASE.rules
  );
  if (intentUpper === "ENTRY" || intentUpper === "ADD") {
    const runtimeExitAdjustment = applyEntryExitRuleRuntimeAdjustments({
      rules: exitRulesOverride,
      features,
      positionMeta: metaForProfile,
      sysCfg,
      cohort: marketRegimeCohort,
      market: symbol,
    });
    exitRulesOverride = cloneExitRules(runtimeExitAdjustment.appliedExitRules);
  }
  const exitProfileRollbackRaw = (exitProfileResolved && exitProfileResolved.rollback && typeof exitProfileResolved.rollback === "object")
    ? exitProfileResolved.rollback
    : null;
  const exitProfileRollback = exitProfileRollbackRaw
    ? {
        rollbackActive: exitProfileRollbackRaw.rollbackActive === true,
        rollbackUntilMs: Number.isFinite(Number(exitProfileRollbackRaw.rollbackUntilMs))
          ? Number(exitProfileRollbackRaw.rollbackUntilMs)
          : null,
        rollbackReason: exitProfileRollbackRaw.rollbackReason ? String(exitProfileRollbackRaw.rollbackReason) : null,
      }
    : {
        rollbackActive: false,
        rollbackUntilMs: null,
        rollbackReason: null,
      };
  if (Number(leverageMult) >= 3 && leverageResolved && /_3X_ENABLED$/.test(String(leverageResolved.reason || ""))) {
    console.log(
      `[adaptive_3x] ex=${String(exchange || "").toUpperCase()} sym=${symbol} ev=${event} intent=${intent} lev=${leverageMult} reason=${leverageResolved.reason}`
    );
  }
  if (exitProfileResolved && exitProfileResolved.profile === "AGGRESSIVE") {
    console.log(
      `[adaptive_exit_profile] ex=${String(exchange || "").toUpperCase()} sym=${symbol} ev=${event} intent=${intent} profile=${exitProfileResolved.profile} reason=${exitProfileResolved.reason}`
    );
  }
  const info = await fetchFuturesExchangeInfo(symbol);
  const minNotional = Number(info && info.minNotional);
  const minQty = Number(info && info.minQty);
  const minOrderQuote = Number(liveCfg.minOrderQuote || 0);
  const minRequiredQuote = Math.max(
    Number.isFinite(minNotional) ? minNotional : 0,
    Number.isFinite(minOrderQuote) ? minOrderQuote : 0
  );

  const budgetMax = Number.isFinite(budgetBaseRaw) && budgetBaseRaw > 0 ? budgetBaseRaw : null;
  const posNotional = Number.isFinite(posQtyBase) ? (posQtyBase * priceRef) : null;
  if (isExit && Number.isFinite(minQty) && minQty > 0 && Number.isFinite(posQtyBase) && posQtyBase > 0 && posQtyBase < minQty) {
    return { ok: false, mode: "LIVE", reason: "POSITION_TOO_SMALL", note: `pos_qty=${posQtyBase}, min_qty=${minQty}` };
  }
  let notionalQuote = isExit
    ? ((Number.isFinite(posNotional) ? posNotional : 0) * Number(qtyFraction || 0))
    : (manualRetryEntry && Number.isFinite(manualQtyBase) && manualQtyBase > 0
      ? (manualQtyBase * priceRef)
      : (budgetMax * Number(qtyFraction || 0) * leverageMult));
  if (!Number.isFinite(notionalQuote) || notionalQuote <= 0) {
    return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL", note: "notional<=0" };
  }

  if (!isExit && !manualRetryEntry) {
    // Entry/ADD budget cap is managed on capital(margin) basis, while order size is notional.
    const marketCapBudget = Number.isFinite(budgetMax) && budgetMax > 0 ? budgetMax : null;
    const currentPosNotional = Number.isFinite(posNotional) && posNotional > 0 ? posNotional : 0;
    const currentPosLeverageRaw = Number(
      positionMeta && (
        positionMeta.leverage ??
        positionMeta.external_leverage ??
        positionMeta.futures_leverage
      )
    );
    const currentPosLeverage = normalizeFuturesLeverage(
      Number.isFinite(currentPosLeverageRaw) && currentPosLeverageRaw > 0
        ? currentPosLeverageRaw
        : leverageMult,
      3
    );
    const currentPosBudgetUsed = (
      currentPosNotional > 0 &&
      Number.isFinite(currentPosLeverage) &&
      currentPosLeverage > 0
    )
      ? (currentPosNotional / currentPosLeverage)
      : 0;
    let maxEntryNotional = Number.POSITIVE_INFINITY;
    if (Number.isFinite(liveCfg.maxOrderQuote) && liveCfg.maxOrderQuote > 0) {
      maxEntryNotional = Math.min(maxEntryNotional, liveCfg.maxOrderQuote);
    }
    if (Number.isFinite(marketCapBudget) && marketCapBudget > 0) {
      const remainingByMarketBudget = Math.max(0, marketCapBudget - currentPosBudgetUsed);
      maxEntryNotional = Math.min(maxEntryNotional, remainingByMarketBudget * leverageMult);
    }
    if (Number.isFinite(maxEntryNotional)) {
      if (maxEntryNotional <= 0) {
        return {
          ok: false,
          mode: "LIVE",
          reason: "POSITION_FULL",
          note: `market_cap_budget=${marketCapBudget}, pos_budget_used=${currentPosBudgetUsed}, pos_notional=${currentPosNotional}`,
        };
      }
      if (notionalQuote > maxEntryNotional) {
        notionalQuote = maxEntryNotional;
      }
    }
  }

  if (isTpP1Exit && Number.isFinite(posQtyBase) && posQtyBase > 0) {
    let forceFullExitReason = null;
    const plannedFraction = Math.max(0, Math.min(1, Number(qtyFraction || 0)));
    const plannedQty = posQtyBase * plannedFraction;
    const remainingQty = posQtyBase * Math.max(0, 1 - plannedFraction);
    const plannedNotional = Number.isFinite(posNotional) ? (posNotional * plannedFraction) : null;
    const remainingNotional = Number.isFinite(posNotional) ? (posNotional * Math.max(0, 1 - plannedFraction)) : null;

    if (Number.isFinite(minRequiredQuote) && minRequiredQuote > 0) {
      if (Number.isFinite(plannedNotional) && plannedNotional > 0 && plannedNotional < minRequiredQuote) {
        forceFullExitReason = `PARTIAL_BELOW_MIN_NOTIONAL planned=${plannedNotional}, min_required=${minRequiredQuote}`;
      }
      if (!forceFullExitReason && Number.isFinite(remainingNotional) && remainingNotional > 0 && remainingNotional < minRequiredQuote) {
        forceFullExitReason = `REMAINDER_BELOW_MIN_NOTIONAL remaining=${remainingNotional}, min_required=${minRequiredQuote}`;
      }
    }
    if (Number.isFinite(minQty) && minQty > 0) {
      if (!forceFullExitReason && plannedQty > 0 && plannedQty < minQty) {
        forceFullExitReason = `PARTIAL_BELOW_MIN_QTY planned_qty=${plannedQty}, min_qty=${minQty}`;
      }
      if (!forceFullExitReason && remainingQty > 0 && remainingQty < minQty) {
        forceFullExitReason = `REMAINDER_BELOW_MIN_QTY remaining_qty=${remainingQty}, min_qty=${minQty}`;
      }
    }
    if (forceFullExitReason) {
      qtyFraction = 1;
      if (Number.isFinite(posNotional) && posNotional > 0) {
        notionalQuote = posNotional;
      }
      console.warn(`[TP_P1_FORCE_FULL_EXIT] ex=${String(exchange || "").toUpperCase()} sym=${symbol} reason=${forceFullExitReason}`);
    }
  }

  // 최소 주문 금액 보정
  let allowBelowMinNotional = false;
  if (Number.isFinite(minRequiredQuote) && minRequiredQuote > 0 && notionalQuote < minRequiredQuote) {
    if (isExit && Number.isFinite(posNotional) && posNotional > 0 && posNotional < minRequiredQuote) {
      // 포지션 자체가 최소 주문 금액보다 작으면 전량 청산 우선(감소 전용)
      qtyFraction = 1;
      notionalQuote = posNotional;
      allowBelowMinNotional = true;
    }
    if (!isExit) {
      // 진입/추가: 예산 내에서 최소 금액까지 자동 보정
      const baseBudget = budgetMax * leverageMult;
      const requiredFraction = (Number.isFinite(baseBudget) && baseBudget > 0)
        ? (minRequiredQuote / baseBudget)
        : null;
      const maxAllowed = Number.isFinite(maxFractionAllowed) ? maxFractionAllowed : Number(qtyFraction || 0);
      if (Number.isFinite(requiredFraction) && requiredFraction > 0 && requiredFraction <= maxAllowed) {
        notionalQuote = minRequiredQuote;
      } else {
        return {
          ok: false,
          mode: "LIVE",
          reason: "MIN_ORDER_EXCEEDS_BUDGET",
          note: `min_required=${minRequiredQuote}, notional=${notionalQuote}, max_allowed=${maxAllowed}`,
        };
      }
    } else {
      // 청산(부분익절/손절): 포지션 내에서 최소 금액 충족하도록 자동 증액
      if (Number.isFinite(posQtyBase) && posQtyBase > 0) {
        const targetFraction = minRequiredQuote / (posQtyBase * priceRef);
        const adjustedFraction = Math.min(1, targetFraction);
        if (adjustedFraction > Number(qtyFraction || 0)) {
          qtyFraction = adjustedFraction;
          notionalQuote = posQtyBase * priceRef * qtyFraction;
        }
      }
      // 그래도 부족하면 실패
      if (!allowBelowMinNotional && notionalQuote < minRequiredQuote) {
        return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL", note: `min_required=${minRequiredQuote}, notional=${notionalQuote}` };
      }
    }
  }
  if (isExit && Number.isFinite(posQtyBase) && posQtyBase > 0 && Number.isFinite(minRequiredQuote) && minRequiredQuote > 0) {
    const posNotional = posQtyBase * priceRef;
    const remainingNotional = posNotional * Math.max(0, 1 - Number(qtyFraction || 0));
    if (remainingNotional > 0 && remainingNotional < minRequiredQuote) {
      qtyFraction = 1;
      notionalQuote = posNotional;
    }
  }
  if (isExit && Number.isFinite(minQty) && minQty > 0 && Number.isFinite(posQtyBase) && posQtyBase > 0) {
    const minFracByQty = minQty / posQtyBase;
    if (minFracByQty > Number(qtyFraction || 0)) {
      qtyFraction = Math.min(1, minFracByQty);
      const posNotionalByQty = posQtyBase * priceRef;
      if (Number.isFinite(posNotionalByQty) && posNotionalByQty > 0) {
        notionalQuote = posNotionalByQty * qtyFraction;
        if (Number.isFinite(minRequiredQuote) && minRequiredQuote > 0 && notionalQuote < minRequiredQuote) {
          qtyFraction = 1;
          notionalQuote = posNotionalByQty;
        }
      }
    }
  }
  const qtyOverride = (!isExit && manualRetryEntry && Number.isFinite(manualQtyBase) && manualQtyBase > 0)
    ? manualQtyBase
    : ((isExit && Number.isFinite(posQtyBase) && posQtyBase > 0)
      ? (posQtyBase * Number(qtyFraction || 0))
      : null);
  const qtyInfo = await computeFuturesOrderQty({
    symbol,
    priceRef,
    notionalQuote,
    reduceOnly: isExit,
    info,
    skipMinNotional: allowBelowMinNotional && isExit,
    qtyBase: qtyOverride,
  });
  if (!qtyInfo.ok || !Number.isFinite(qtyInfo.qty)) {
    return { ok: false, mode: "LIVE", reason: qtyInfo.reason || "ORDER_TOO_SMALL" };
  }

  const reduceOnly = isExit;
  if (!liveCfg.liveDryRun && !isExit) {
    const margin = await ensureFuturesMarginType({ liveCfg, symbol });
    if (!margin.ok) {
      return { ok: false, mode: "LIVE", reason: "MARGIN_TYPE_SET_FAILED", error: margin.error };
    }
  }
  if (liveCfg.liveDryRun) {
    const execPrice = computeFillPrice({ side, nextOpen: priceRef, slippageBps });
    const execQtyBase = qtyInfo.qty;
    const filledNotional = execQtyBase * execPrice;
    const qtyFractionUsed = (isExit && Number.isFinite(posQtyBase) && posQtyBase > 0)
      ? (execQtyBase / posQtyBase)
      : (manualRetryEntry
        ? ((Number.isFinite(Number(qtyFraction)) && Number(qtyFraction) > 0) ? Number(qtyFraction) : 1)
        : (filledNotional / (budgetMax * leverageMult)));
    return {
      ok: true,
      mode: "LIVE_DRY_RUN",
      execPrice,
      execPriceSource: "BINANCE_DRY_RUN",
      execQtyBase,
      notionalKrw: filledNotional,
      qtyFractionUsed,
      budgetMaxUsed: budgetMax,
      liveOrderId: null,
      appliedLeverage: leverageMult,
      leverageReason: leverageResolved && leverageResolved.reason,
      appliedExitProfile: exitProfileResolved && exitProfileResolved.profile ? String(exitProfileResolved.profile).toUpperCase() : "BASE",
      exitProfileReason: exitProfileResolved && exitProfileResolved.reason ? String(exitProfileResolved.reason) : "BASE_PROFILE",
      appliedExitRules: exitRulesOverride,
      exitProfileRollbackActive: exitProfileRollback.rollbackActive === true,
      exitProfileRollbackUntilMs: Number.isFinite(Number(exitProfileRollback.rollbackUntilMs))
        ? Number(exitProfileRollback.rollbackUntilMs)
        : null,
      exitProfileRollbackReason: exitProfileRollback.rollbackReason || null,
      nativeProtection: null,
    };
  }

  if (Number.isFinite(leverageMult) && leverageMult > 0) {
    const sym = String(symbol || "").trim().toUpperCase();
    const cache = futuresLeverageCache.get(sym);
    const now = Date.now();
    const apiLev = Math.round(leverageMult);
    if (!cache || cache.value !== apiLev || (now - cache.at) > FUTURES_LEVERAGE_TTL_MS) {
      try {
        await setFuturesLeverage({
          apiKey: liveCfg.apiKey,
          apiSecret: liveCfg.apiSecret,
          symbol: sym,
          leverage: apiLev,
        });
        futuresLeverageCache.set(sym, { value: apiLev, at: now });
        if (Math.abs(apiLev - leverageMult) > 0.0001) {
          console.warn(`[BINANCEFUT] leverage rounded: ${leverageMult} -> ${apiLev} (${sym})`);
        }
      } catch (e) {
        return { ok: false, mode: "LIVE", reason: "LEVERAGE_SET_FAILED", error: e && e.message ? e.message : String(e) };
      }
    }
  }

  const mainOrderIdempotencyKey = buildBinanceOrderIdempotencyKey({
    intentId: orderIntentId,
    exchange,
    symbol,
    side,
    intent,
    event,
    barCloseMs,
    qty: qtyInfo.qty,
    reduceOnly,
    tag: reduceOnly ? "exit" : "entry",
  });
  const order = await placeFuturesMarketOrder({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    symbol,
    side,
    quantity: qtyInfo.qty,
    reduceOnly,
    idempotencyKey: mainOrderIdempotencyKey,
  });

  let detail = order;
  let execPrice = calcBinanceAveragePrice(detail);
  if (!Number.isFinite(execPrice)) {
    try {
      const fetched = await fetchFuturesOrder({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
        symbol,
        orderId: order && order.orderId,
      });
      detail = fetched || detail;
      execPrice = calcBinanceAveragePrice(detail);
    } catch (_) {}
  }

  const execQtyBase = Number(detail && (detail.executedQty ?? detail.executed_qty ?? detail.origQty ?? detail.orig_qty)) || qtyInfo.qty;
  const filledNotional = (Number.isFinite(execPrice) ? execPrice : priceRef) * execQtyBase;
  const qtyFractionUsed = (isExit && Number.isFinite(posQtyBase) && posQtyBase > 0)
    ? (execQtyBase / posQtyBase)
    : (manualRetryEntry
      ? ((Number.isFinite(Number(qtyFraction)) && Number(qtyFraction) > 0) ? Number(qtyFraction) : 1)
      : (filledNotional / (budgetMax * leverageMult)));
  let nativeProtection = null;

  if (isExit && !liveCfg.liveDryRun && Number.isFinite(posQtyBase) && posQtyBase > 0) {
    const step = Number(info && info.stepSize);
    const minQty = Number(info && info.minQty);
    const remainingRaw = Math.max(0, posQtyBase - execQtyBase);
    const remaining = roundQtyToStep(remainingRaw, step);
    const px = Number.isFinite(execPrice) ? execPrice : priceRef;
    const remainingNotional = (Number.isFinite(px) && Number.isFinite(remaining)) ? remaining * px : null;
    const dustByQty = Number.isFinite(minQty) && Number.isFinite(remaining) && remaining > 0 && remaining <= minQty;
    const dustByNotional = Number.isFinite(minRequiredQuote) && Number.isFinite(remainingNotional) && remainingNotional > 0 && remainingNotional < minRequiredQuote;
    if (Number.isFinite(remaining) && remaining > 0 && (dustByQty || dustByNotional)) {
      if (!Number.isFinite(minQty) || remaining >= minQty) {
        try {
          console.warn(`[BINANCEFUT_DUST_CLOSE] ${symbol} qty=${remaining} notional=${remainingNotional ?? "NA"}`);
          await placeFuturesMarketOrder({
            apiKey: liveCfg.apiKey,
            apiSecret: liveCfg.apiSecret,
            symbol,
            side,
            quantity: remaining,
            reduceOnly: true,
            idempotencyKey: buildBinanceOrderIdempotencyKey({
              intentId: orderIntentId,
              exchange,
              symbol,
              side,
              intent,
              event,
              barCloseMs,
              qty: remaining,
              reduceOnly: true,
              tag: "dust",
            }),
          });
        } catch (e) {
          console.warn("[BINANCEFUT_DUST_CLOSE_FAIL]", e && e.message ? e.message : String(e));
        }
      }
    }
  }

  if (!liveCfg.liveDryRun) {
    try {
      nativeProtection = await refreshBinanceNativeProtectionWithRetry({
        liveCfg,
        exchange,
        symbol,
        fallbackSide: side,
        fallbackEntryPrice: Number.isFinite(execPrice) ? execPrice : priceRef,
        fallbackLeverage: leverageMult,
        exitRulesOverride,
      });
    } catch (nativeErr) {
      nativeProtection = {
        ok: false,
        reason: "NATIVE_PROTECTION_RUNTIME_FAIL",
        error: nativeErr && nativeErr.message ? nativeErr.message : String(nativeErr),
        attempts: 1,
      };
    }
    await notifyNativeProtectionResult({
      nativeProtection,
      symbol,
      exchange,
      liveMode: "LIVE",
    });
  }

  const exitProfileRollbackUntilMsRaw = Number(exitProfileRollback.rollbackUntilMs);

  return {
    ok: true,
    mode: "LIVE",
    execPrice: Number.isFinite(execPrice) ? execPrice : priceRef,
    execPriceSource: "BINANCE_ORDER",
    execQtyBase,
    notionalKrw: filledNotional,
    qtyFractionUsed,
    budgetMaxUsed: budgetMax,
    liveOrderId: order && order.orderId ? String(order.orderId) : null,
    appliedLeverage: leverageMult,
    leverageReason: leverageResolved && leverageResolved.reason,
    appliedExitProfile: exitProfileResolved && exitProfileResolved.profile ? String(exitProfileResolved.profile).toUpperCase() : "BASE",
    exitProfileReason: exitProfileResolved && exitProfileResolved.reason ? String(exitProfileResolved.reason) : "BASE_PROFILE",
    appliedExitRules: exitRulesOverride,
    exitProfileRollbackActive: exitProfileRollback.rollbackActive === true,
    exitProfileRollbackUntilMs: Number.isFinite(exitProfileRollbackUntilMsRaw)
      ? exitProfileRollbackUntilMsRaw
      : null,
    exitProfileRollbackReason: exitProfileRollback.rollbackReason,
    nativeProtection,
  };
}

function buildLiquidationExitSignal({ position, bar, leverage, bufferPct }) {
  const pos = position || {};
  const state = String(pos.state || "").toUpperCase();
  const size = Number(pos.size_pct || 0);
  const side = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
  ) || "LONG";
  const avg = Number(pos.avg_price);
  const closePx = Number(bar && (bar.close ?? bar.c ?? bar.closePrice));
  if (state !== "ACTIVE" || size <= 0) return null;
  if (!Number.isFinite(avg) || !Number.isFinite(closePx)) return null;
  if (!Number.isFinite(leverage) || leverage <= 1) return null;

  const liqPx = (side === "SHORT")
    ? avg * (1 + 1 / leverage)
    : avg * (1 - 1 / leverage);
  if (!Number.isFinite(liqPx) || liqPx <= 0) return null;

  const dist = (side === "SHORT")
    ? (liqPx - closePx) / liqPx
    : (closePx - liqPx) / liqPx;
  if (!Number.isFinite(dist) || dist > bufferPct) return null;

  const exitSide = side === "SHORT" ? "BUY" : "SELL";
  return {
    event: "EXIT_LIQUIDATION_RISK",
    side: exitSide,
    qty_pct: size,
    reason: "LIQUIDATION_RISK",
    features: { position_side: side, liq_px: liqPx, ref_px: closePx, buffer_pct: bufferPct },
  };
}

function intentFromSignal({ event, side, features } = {}) {
  const hinted = String(features && features._event_intent || "").toUpperCase();
  if (hinted === "ENTRY" || hinted === "ADD" || hinted === "EXIT") return hinted;
  const mapping = resolveEventMapping({ event, side });
  return mapping.intent || null;
}

function directionFromSignal({ event, side } = {}) {
  const e = String(event || "").toUpperCase();
  if (e.includes("SHORT")) return "SHORT";
  if (e.includes("LONG")) return "LONG";
  if (e.includes("_SELL") || e.endsWith("_SELL")) return "SHORT";
  if (e.includes("_BUY") || e.endsWith("_BUY")) return "LONG";
  const s = normalizeSideValue(side);
  if (s === "BUY") return "LONG";
  if (s === "SELL") return "SHORT";
  return null;
}

function intentExecutionPriority(intentDoc) {
  const intent = intentFromSignal({
    event: intentDoc && intentDoc.event,
    side: intentDoc && intentDoc.side,
    features: intentDoc && intentDoc.features_json,
  });
  if (intent === "EXIT") return 0;
  const ev = String(intentDoc && intentDoc.event || "").toUpperCase();
  const features = intentDoc && intentDoc.features_json;
  const tier = resolveSignalTier(ev, features);
  if (tier === "REAL") return 1;
  if (tier === "PRE_REAL") return 2;
  if (tier === "CORE") return 3;
  if (tier === "EARLY") return 4;
  if (ev.startsWith("TD9P_")) return 5;
  return 6;
}

function sortIntentsForExecution(list) {
  const rows = Array.isArray(list) ? list.slice() : [];
  rows.sort((a, b) => {
    const pa = intentExecutionPriority(a);
    const pb = intentExecutionPriority(b);
    if (pa !== pb) return pa - pb;
    const sa = Number(a && a.scheduled_exec_bar_close_time_utc_ms);
    const sb = Number(b && b.scheduled_exec_bar_close_time_utc_ms);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
    const ca = Date.parse(String(a && a.created_at || ""));
    const cb = Date.parse(String(b && b.created_at || ""));
    if (Number.isFinite(ca) && Number.isFinite(cb) && ca !== cb) return ca - cb;
    return String(a && (a.intent_id || a.id || "")).localeCompare(String(b && (b.intent_id || b.id || "")));
  });
  return rows;
}

function normalizeSideAllocation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const longScaleRaw = clamp(Number(raw.long_scale), 0.1, 3.0);
  const shortScaleRaw = clamp(Number(raw.short_scale), 0.1, 3.0);
  const longScale = Number.isFinite(longScaleRaw) ? longScaleRaw : 1;
  const shortScale = Number.isFinite(shortScaleRaw) ? shortScaleRaw : 1;
  const enabled = raw.enabled !== false;
  const biasDirectionRaw = String(raw.bias_direction || "").toUpperCase();
  const biasDirection = (biasDirectionRaw === "LONG" || biasDirectionRaw === "SHORT")
    ? biasDirectionRaw
    : "NEUTRAL";
  const biasScore = Number(raw.bias_score);
  const biasConfidence = Number(raw.bias_confidence);
  return {
    enabled,
    longScale,
    shortScale,
    biasDirection,
    biasScore: Number.isFinite(biasScore) ? biasScore : 0,
    biasConfidence: Number.isFinite(biasConfidence) ? biasConfidence : null,
    source: raw.source ? String(raw.source) : null,
    updatedAt: raw.updated_at || null,
  };
}

function applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget }) {
  const qty = Number(qtyFraction);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  if (!riskBudget || riskBudget.enabled !== true) {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  const intentTag = String(intent || "").toUpperCase();
  if (intentTag !== "ENTRY" && intentTag !== "ADD") {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  const sideAlloc = riskBudget && riskBudget.sideAllocation;
  if (!sideAlloc || sideAlloc.enabled !== true) {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  const dir = String(intentDir || "").toUpperCase();
  const scale = dir === "SHORT"
    ? Number(sideAlloc.shortScale)
    : dir === "LONG"
      ? Number(sideAlloc.longScale)
      : 1;
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  return {
    qtyFraction: qty * scale,
    applied: true,
    scale,
    biasDirection: sideAlloc.biasDirection,
    biasScore: sideAlloc.biasScore,
  };
}

function extractEntrySignalTypeFromMeta(posMeta) {
  if (!posMeta || typeof posMeta !== "object") return null;
  const direct = posMeta.entry_signal_type || posMeta.entry_event || posMeta.entry_signal;
  if (direct) return String(direct).toUpperCase();
  const entryId = posMeta.entry_event_id;
  if (!entryId) return null;
  const parts = String(entryId).split("|").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  return last ? String(last).toUpperCase() : null;
}

function allowEntryDuringTrail({ event, features, posMeta } = {}) {
  const ev = String(event || "").toUpperCase();
  const timingTier = resolveSignalTier(ev, features);
  const qtyProfile = resolveSignalQtyProfile(ev, features);
  if (!(timingTier === "EARLY" || timingTier === "CORE" || qtyProfile === "FIXED")) return false;
  const entryType = extractEntrySignalTypeFromMeta(posMeta);
  const entryTier = resolveSignalTier(entryType, {
    entry_grade: posMeta && (posMeta.entry_grade || posMeta.entry_timing_tier || posMeta.entry_tier),
  });
  const entryQtyProfile = resolveSignalQtyProfile(entryType, {
    entry_qty_profile: posMeta && (posMeta.entry_qty_profile || posMeta.entry_qty_tier || posMeta.qty_profile),
  });
  if (!entryType && !entryTier && !entryQtyProfile) return false;
  if (qtyProfile === "FIXED") return true;
  if (entryQtyProfile === "FIXED") return true;
  return false;
}

function allowByTradingModeIntent(tradingMode, intent) {
  if (tradingMode === "RUNNING") return true;
  if (tradingMode === "EXIT_ONLY") return intent === "EXIT";
  return false;
}

function normalizeQtyFraction(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return n; // treated as "exceed" when budget is enabled
}

function resolveEntryTierBudgetMax({
  intent,
  event,
  features,
  side,
  qtyFraction,
  budgetMax,
  baseLeverage = FUTURES_BASE_LEVERAGE,
} = {}) {
  const ev = String(event || "").toUpperCase();
  const base = Number(budgetMax);
  const lev = normalizeFuturesLeverage(Number(baseLeverage), FUTURES_BASE_LEVERAGE);
  let tier = null;
  const qtyProfile = resolveSignalQtyProfile(ev, features);
  if (qtyProfile === "FIXED") {
    const fixedTier = resolveSignalTier(ev, features) || "FIXED";
    const targetMargin = Number.isFinite(FUTURES_ACTIVE_FIXED_MARGIN_TARGET) && FUTURES_ACTIVE_FIXED_MARGIN_TARGET > 0
      ? FUTURES_ACTIVE_FIXED_MARGIN_TARGET
      : null;
    const applied = Number.isFinite(base) && base > 0 && Number.isFinite(targetMargin) && targetMargin > base;
    return {
      applied,
      tier: fixedTier,
      budgetMax: applied ? targetMargin : Number(budgetMax),
      targetMode: FUTURES_ENTRY_TIER_TARGET_MODE,
      targetNotional: (Number.isFinite(targetMargin) && targetMargin > 0 && Number.isFinite(lev) && lev > 0)
        ? (targetMargin * lev)
        : null,
      dynamicPreRealTarget: null,
      requiredBudget: Number.isFinite(targetMargin) && targetMargin > 0 ? targetMargin : null,
      qtyFraction: Number(qtyFraction),
      fixedQty: true,
      targetMargin,
      reason: applied ? "FIXED_MARGIN_TARGET_OVERRIDE" : "FIXED_MARGIN_TARGET_OK",
    };
  }
  if (isEarlyEventName(ev, features)) tier = "EARLY";
  else if (ev.startsWith("CORE_")) tier = "CORE";
  else if (qtyProfile === "PRE_REAL" || isPreRealEventName(ev)) tier = "PRE_REAL";
  const out = {
    applied: false,
    tier,
    budgetMax: Number(budgetMax),
    targetMode: FUTURES_ENTRY_TIER_TARGET_MODE,
    dynamicPreRealTarget: null,
    targetNotional: null,
    requiredBudget: null,
    reason: "SKIP",
  };
  if (!FUTURES_ENTRY_TIER_BUDGET_AUTO_SCALE) {
    out.reason = "DISABLED";
    return out;
  }
  if (!tier) {
    out.reason = "NON_TARGET_TIER";
    return out;
  }
  if (!Number.isFinite(out.targetNotional) || out.targetNotional <= 0) {
    out.reason = "TARGET_DISABLED";
    return out;
  }
  const intentUpper = String(intent || "").toUpperCase();
  if (!(intentUpper === "ENTRY" || intentUpper === "ADD")) {
    out.reason = "NON_ENTRY";
    return out;
  }
  if (!Number.isFinite(base) || base <= 0) {
    out.reason = "NO_BASE_BUDGET";
    return out;
  }
  const q = Number(qtyFraction);
  if (!Number.isFinite(q) || q <= 0) {
    out.reason = "BAD_QTY";
    return out;
  }
  if (!Number.isFinite(lev) || lev <= 0) {
    out.reason = "BAD_BASE_LEVERAGE";
    return out;
  }
  const required = out.targetNotional / (q * lev);
  out.requiredBudget = required;
  if (!Number.isFinite(required) || required <= 0) {
    out.reason = "BAD_REQUIRED_BUDGET";
    return out;
  }
  if (required <= base) {
    out.reason = "BASE_BUDGET_OK";
    return out;
  }
  out.applied = true;
  out.budgetMax = required;
  out.reason = "AUTO_BUMP_TO_TARGET_NOTIONAL";
  return out;
}

function formatLiveExceptionNote(err) {
  const msg = String(err && err.message ? err.message : err || "").trim();
  const parts = [];
  if (msg) parts.push(`msg=${msg}`);
  const requestId = String(err && (err.requestId || err.request_id) || "").trim();
  if (requestId) parts.push(`request_id=${requestId}`);
  const provider = String(err && err.provider || "").trim();
  if (provider) parts.push(`provider=${provider}`);
  const action = String(err && err.action || "").trim();
  if (action) parts.push(`action=${action}`);
  const code = String(err && err.code || "").trim();
  if (code) parts.push(`code=${code}`);
  const timeoutMs = Number(err && err.timeoutMs);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) parts.push(`timeout_ms=${timeoutMs}`);
  const note = parts.join(" | ");
  if (!note) return "LIVE_EXCEPTION";
  return note.slice(0, 900);
}

async function resolveRiskBudget(symbol, exchange) {
  try {
    const rb = await getRiskBudgetForProvider(exchange || "BINANCEFUT", 5000);
    const cfg = rb && rb.data ? rb.data : null;
    const sideAllocation = normalizeSideAllocation(cfg && cfg.side_allocation);
    if (!cfg) return { enabled: false, sideAllocation };
    const configuredEnabled = cfg.enabled === true;
    let maxKrw = Number((cfg.by_market && cfg.by_market[symbol]) || cfg.default_max_krw || 0);
    const onExceed = String(cfg.on_exceed || "CLAMP").toUpperCase();
    let totalMaxKrw = Number(cfg.total_max_krw ?? cfg.total_budget_krw ?? cfg.total_krw ?? 0) || 0;
    const ex = String(exchange || "").toUpperCase();
    const totalMaxSource = String(cfg.total_max_source || "").toLowerCase();
    const configuredAccountTotal = Number(
      cfg.account_total_value ??
      cfg.account_total_krw ??
      cfg.total_account_value ??
      0
    ) || 0;
    const replayForcedTotalRaw = Number(
      process.env.REPLAY_FORCE_TOTAL_MAX_USDT ||
      process.env.REPLAY_FORCE_TOTAL_MAX_KRW ||
      0
    );
    const replayForcedTotal = Number.isFinite(replayForcedTotalRaw) && replayForcedTotalRaw > 0
      ? replayForcedTotalRaw
      : null;
    if (ex.includes("_REPLAY_") && Number.isFinite(replayForcedTotal) && replayForcedTotal > 0) {
      totalMaxKrw = replayForcedTotal;
    } else if (
      ex.includes("BINANCE") &&
      totalMaxSource === "account_total" &&
      Number.isFinite(configuredAccountTotal) &&
      configuredAccountTotal > 0
    ) {
      totalMaxKrw = configuredAccountTotal;
    } else if (ex.includes("BINANCE")) {
      try {
        const keys = await resolveBinanceKeys();
        if (keys.apiKey && keys.apiSecret) {
          const summary = await getBinanceFuturesAccountSummary({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
          const totalValue = Number(summary && summary.total_value);
          if (Number.isFinite(totalValue) && totalValue > 0) {
            totalMaxKrw = totalValue;
          }
        }
      } catch (acctErr) {
        console.warn(
          `[RISK_BUDGET_ACCOUNT_FETCH_FAIL] BINANCE ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
          `${acctErr && acctErr.message ? acctErr.message : String(acctErr)}`
        );
      }
    }
    if (ex.includes("KIWOOM")) {
      try {
        const keys = await resolveKiwoomKeys();
        if (keys.appKey && keys.secretKey) {
          const summary = await fetchKiwoomAccount({ appkey: keys.appKey, secretkey: keys.secretKey });
          if (summary && summary.ok) {
            const cash = Number(summary.cash_krw);
            const holdings = Array.isArray(summary.holdings) ? summary.holdings : [];
            let holdingsValue = 0;
            for (const h of holdings) {
              const qty = Number(h.qty);
              const last = Number(h.last_price);
              if (Number.isFinite(qty) && Number.isFinite(last)) {
                holdingsValue += qty * last;
              }
            }
            const totalValue = (Number.isFinite(cash) ? cash : 0) + holdingsValue;
            if (Number.isFinite(totalValue) && totalValue > 0) {
              totalMaxKrw = totalValue;
              if (!Number.isFinite(maxKrw) || maxKrw <= 0) {
                maxKrw = totalValue;
              }
            }
          }
        }
      } catch (acctErr) {
        console.warn(
          `[RISK_BUDGET_ACCOUNT_FETCH_FAIL] KIWOOM ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
          `${acctErr && acctErr.message ? acctErr.message : String(acctErr)}`
        );
      }
    }
    const hasMarketOrDefaultBudget = Number.isFinite(maxKrw) && maxKrw > 0;
    const hasTotalBudget = Number.isFinite(totalMaxKrw) && totalMaxKrw > 0;
    const effectiveEnabled = configuredEnabled || hasMarketOrDefaultBudget || hasTotalBudget;
    if (!effectiveEnabled || !hasMarketOrDefaultBudget) {
      return {
        enabled: false,
        configuredEnabled,
        sideAllocation,
        totalMaxKrw: hasTotalBudget ? totalMaxKrw : null,
        source: rb.source || "unknown",
      };
    }
    return {
      enabled: true,
      configuredEnabled,
      maxKrw,
      totalMaxKrw: hasTotalBudget ? totalMaxKrw : null,
      defaultMaxKrw: Number(cfg.default_max_krw || 0) || 0,
      byMarket: (cfg.by_market && typeof cfg.by_market === "object") ? cfg.by_market : {},
      onExceed: (onExceed === "SKIP") ? "SKIP" : "CLAMP",
      source: rb.source || "unknown",
      unit: String(cfg.unit || (String(exchange || "").toUpperCase().includes("BINANCE") ? "USDT" : "KRW")).toUpperCase(),
      sideAllocation,
    };
  } catch (e) {
    return { enabled: false, error: (e && e.message) ? e.message : String(e) };
  }
}

async function computeTotalBudgetUsage(riskBudget, exchange) {
  if (!riskBudget || !riskBudget.enabled || !riskBudget.totalMaxKrw) {
    return { totalMaxKrw: null, totalUsedKrw: null };
  }
  const db = getFirestore();
  const snap = await db.collection("positions_paper").get();
  let totalUsed = 0;
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    const target = String(exchange || "").toUpperCase();
    if (target && ex && ex !== target) return;
    const posId = String(x.pos_id || d.id || "");
    if (!posId.startsWith("POS__")) return;
    const mk = x.symbol_or_pair_id || x.symbol;
    if (!mk) return;
    const state = String(x.state || "").toUpperCase();
    const size = Number(x.size_pct);
    if (state === "FLAT") return;
    if (Number.isFinite(size) && size <= POS_SIZE_EPSILON) return;

    let used;
    if (target.includes("BINANCE")) {
      used = resolveBinanceBudgetUsedKrw({ position: x, riskBudget });
    } else {
      used = Number(x.budget_used_krw);
      if (!Number.isFinite(used)) {
        const size = Number(x.size_pct);
        const maxKrw = Number((riskBudget.byMarket && riskBudget.byMarket[mk]) || riskBudget.defaultMaxKrw || 0);
        if (Number.isFinite(size) && size > 0 && Number.isFinite(maxKrw) && maxKrw > 0) {
          used = size * maxKrw;
        } else {
          used = 0;
        }
      }
    }
    totalUsed += used;
  });
  return { totalMaxKrw: riskBudget.totalMaxKrw, totalUsedKrw: totalUsed };
}

async function runPaperUpbitForBar({
  runId,
  exchange,
  symbol,
  tf,
  execTf,
  barCloseUtc,
  barCloseMs,
  bar,
  gate,
  trading_mode,
  backfillExitOnly,
  backfillAllowEntry,
} = {}) {
  const signalTf = String(tf || defaultExecTfFromEnv() || "15m");
  const execTfFinal = String(execTf || signalTf);
  const signalTfMs = tfToMs(signalTf);
  const execTfMs = tfToMs(execTfFinal);
  const tpP1PendingHoldMs = resolveTpP1PendingHoldMs();
  const execProfile = await resolveExecutionProfile({ symbol, bar, exchange });
  const { feeBps, slippageBps } = execProfile;
  const riskBudget = await resolveRiskBudget(symbol, exchange);
  const useBudget = riskBudget && riskBudget.enabled === true;
  const { leverage, bufferPct } = await resolveFuturesRiskConfig(exchange);
  const exUpper = String(exchange || "").toUpperCase();
  const liveCfg = exUpper.includes("KIWOOM")
    ? await resolveLiveKiwoomConfig({ exchange, symbol })
    : await resolveLiveConfig({ exchange, symbol });
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const sysCfg = (sys && sys.data) ? sys.data : {};
  const sysCfgEffective = resolveImmediateDefaultsForExchange(sysCfg, exchange);
  const forceAllSignalsAdd = resolveForceAllSignalsAdd(sysCfgEffective, exchange);
  const autoScore = await resolveAutoScoreMin({ exchange, sysCfg: sysCfgEffective });
  const signalOverlapEnabled = forceAllSignalsAdd ? false : normalizeBool(sysCfg.signal_overlap_enabled, true);
  const signalOverlapBars = forceAllSignalsAdd ? 0 : Math.max(0, normalizeInt(sysCfg.signal_overlap_bars, 2));
  const signalQueueEnabled = normalizeBool(sysCfg.signal_queue_enabled, true);
  const defaultLateBars = exUpper.includes("BINANCEFUT") ? 6 : 1;
  const configuredLateBars = normalizeInt(sysCfg.signal_queue_max_late_bars, defaultLateBars);
  const signalQueueMaxLateBars = Math.max(defaultLateBars, Math.max(0, configuredLateBars));
  const exitImmediateEnabled = normalizeBool(
    process.env.EXIT_IMMEDIATE_ENABLED,
    normalizeBool(sysCfg.exit_immediate_enabled, true)
  );
  const immediateCfg = resolveImmediateEntryConfig(sysCfgEffective);
  const shortGateCfg = resolveShortEntryGateConfig(sysCfgEffective, exchange);
  const aiBiasGateCfg = resolveAiBiasEntryGateConfig(sysCfgEffective, exchange);
  const evGateCfg = resolveEvGateConfig(sysCfgEffective, exchange, symbol);
  const waitOneBarCfg = resolveWaitOneBarConfig(sysCfgEffective, exchange);
  const entryQualityCfg = resolveEntryQualityGateConfig(sysCfgEffective, exchange);
  const addRiskCfgRaw = resolveAddRiskConfig(sysCfgEffective, exchange);
  const addRiskCfg = forceAllSignalsAdd ? { ...addRiskCfgRaw, enabled: false } : addRiskCfgRaw;
  const tradeableSignalTypes = resolveTradeableSignalTypes(sysCfgEffective, exchange);
  const binanceFutOnly = exUpper.includes("BINANCEFUT");
  const maxHoldBars = binanceFutOnly ? resolveBinanceMaxHoldBars(sysCfgEffective, signalTfMs) : 0;
  const sameDirectionTrailProfitCooldownCfg = resolveSameDirectionTrailProfitCooldownConfig(sysCfgEffective);

  // 1) 포지션 로드
  let pos = await getPosition({ exchange, symbol });
  let posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
  const oppositeCooldownWindow = binanceFutOnly
    ? resolveOppositeCooldownWindowFromPosition({ sysCfg: sysCfgEffective, position: pos })
    : { bars: 0, timeMs: 0, cohort: null };
  const oppositeCooldownBars = binanceFutOnly ? oppositeCooldownWindow.bars : 0;
  const oppositeTimeCooldownMs = binanceFutOnly ? oppositeCooldownWindow.timeMs : 0;
  let posQtyBase = resolvePosQtyBase(pos);
  const spikeLock = await resolveSignalSpikeLock({ exchange, symbol, barCloseMs, pos, sysCfg });
  let pendingMetaPatch = null;
  if (spikeLock && spikeLock.active && Number.isFinite(spikeLock.untilMs)) {
    const prevUntil = Number(posMeta.spike_lock_until_ms);
    if (!Number.isFinite(prevUntil) || spikeLock.untilMs > prevUntil) {
      pendingMetaPatch = mergeMeta(pendingMetaPatch, {
        spike_lock_until_ms: spikeLock.untilMs,
        spike_lock_set_ms: Number(barCloseMs),
        spike_lock_reason: spikeLock.reason || "SPIKE_DETECTED",
        spike_lock_move_pct: spikeLock.movePct ?? null,
        spike_lock_tf: spikeLock.tf || null,
      });
    }
  }
  if (pendingMetaPatch) posMeta = mergeMeta(posMeta, pendingMetaPatch);

  // 2) (A) exec: 이번 봉 open으로 이전 봉 intent 실행
  const execBarCloseMs = Number(barCloseMs);
  const execBarCloseUtc = barCloseUtc;

  try {
    const { cancelExpiredPendingIntents } = require("../storage/orderIntentsPaper");
    await cancelExpiredPendingIntents({ exchange, symbol, tf: signalTf, lookbackLimit: 600 });
  } catch (e) {
    console.warn("[INTENT_EXPIRE_CANCEL_FAIL]", {
      exchange,
      symbol,
      tf: signalTf,
      error: e && e.message ? e.message : String(e),
    });
  }

  let intents = await listPendingIntentsForExec({
    exchange,
    symbol,
    tf: signalTf,
    execBarCloseMs,
    limitN: 50,
  });
  try {
    const { listPendingIntentsOverdue } = require("../storage/orderIntentsPaper");
    const overdue = await listPendingIntentsOverdue({
      exchange,
      symbol,
      tf: signalTf,
      execBarCloseMs,
      limitN: 20,
      lookbackLimit: 600,
    });
    if (Array.isArray(overdue) && overdue.length) {
      const seen = new Set(intents.map((x) => x.intent_id || x.id));
      overdue.forEach((x) => {
        const id = x.intent_id || x.id;
        if (id && !seen.has(id)) intents.push(x);
      });
    }
  } catch (e) {
    console.warn("[INTENT_OVERDUE_FETCH_FAIL]", {
      exchange,
      symbol,
      tf: signalTf,
      error: e && e.message ? e.message : String(e),
    });
  }

  const budgetTotals = useBudget ? await computeTotalBudgetUsage(riskBudget, exchange) : { totalMaxKrw: null, totalUsedKrw: null };
  const totalMaxKrw = budgetTotals.totalMaxKrw;
  let totalUsedKrw = budgetTotals.totalUsedKrw;

  let fillsExecuted = 0;

  const attemptAt = new Date().toISOString();
  const executeIntentList = async (intentsList) => {
    for (const it of intentsList) {
    const schedMs = Number(it.scheduled_exec_bar_close_time_utc_ms);
    const isOverdue = Number.isFinite(schedMs) && Number.isFinite(execBarCloseMs) && schedMs < execBarCloseMs;
    await patchIntent(it.intent_id, {
      last_attempt_at: attemptAt,
      last_attempt_bar_close_time_utc: execBarCloseUtc,
      last_attempt_bar_close_time_utc_ms: execBarCloseMs,
      ...(isOverdue ? { pending_reason: "LATE_EXEC", pending_note: `late_exec_from=${msToUtcZ(schedMs)}` } : {}),
    });

    const intent = intentFromSignal({ event: it.event, side: it.side, features: it.features_json });
    it.features_json = buildSignalStageFeatures({ ...(it || {}), features: it.features_json }, intent);
    const intentIsEntry = intent === "ENTRY" || intent === "ADD";
    const manualRetryIntent = intentIsEntry && isManualRetryFeatures(it.features_json);
    const manualRetryQtyBase = manualRetryIntent ? resolveManualRetryQtyBase(it.features_json) : null;
    let preQtyScale = 1;
    if (backfillExitOnly && intentIsEntry) {
      if (String(trading_mode || "").toUpperCase() === "EXIT_ONLY") {
        // Tick-exit loop must not consume/cancel entry intents; leave them for normal RUN cycle.
        continue;
      }
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BACKFILL_SKIP_ENTRY", status_reason: "BACKFILL_SKIP_ENTRY" });
      continue;
    }
    const allowTrailEntry = forceAllSignalsAdd || allowEntryDuringTrail({ event: it.event, features: it.features_json, posMeta });
    if (intentIsEntry && (posMeta && (posMeta.trail_active === true || posMeta.tp_p1_done === true)) && !allowTrailEntry) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_TRAIL_ACTIVE_NO_ADD", status_reason: "DROP_TRAIL_ACTIVE_NO_ADD" });
      continue;
    }
    if (!allowByTradingModeIntent(trading_mode, intent)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: `MODE_${trading_mode}`, status_reason: "TRADING_MODE" });
      continue;
    }
    const eventUpper = String(it.event || "").toUpperCase();
    const actionTag = normalizeActionValue(it.features_json && it.features_json.action);
    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: it.event })
      : directionFromSignal({ event: it.event, side: it.side });
    if (intentIsEntry && !actionAllowsEntry(actionTag)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_ACTION_FILTER", status_reason: "DROP_ACTION_FILTER" });
      continue;
    }
    if (intentIsEntry && !isTradeableEventAllowed({ eventUpper, intentDir, allowlist: tradeableSignalTypes })) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_TRADEABLE_SIGNAL_TYPES", status_reason: "DROP_TRADEABLE_SIGNAL_TYPES" });
      continue;
    }
    if (intentIsEntry) {
      const canonical = evaluateCanonicalEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: it.features_json,
        sysCfg: sysCfgEffective,
        market: it.symbol_or_pair_id || symbol,
        tf: signalTf,
      });
      if (!canonical.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          status_reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          cancel_note: canonical.detail ? JSON.stringify(canonical.detail) : undefined,
        });
        continue;
      }
      if (canonical.detail) {
        it.features_json = { ...(it.features_json || {}), ...(canonical.detail || {}) };
      }
      const quality = evaluateEntryQualityGate({
        intent,
        intentDir,
        eventUpper,
        features: it.features_json,
        cfg: entryQualityCfg,
      });
      if (!quality.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: quality.reason || "DROP_ENTRY_QUALITY",
          status_reason: quality.reason || "DROP_ENTRY_QUALITY",
          cancel_note: quality.detail ? JSON.stringify(quality.detail) : undefined,
        });
        continue;
      }
    }
    // Commission Gate v2 soft mode + MDD gate — intent execution
    if (intentIsEntry && !manualRetryIntent) {
      try {
        const signalScaleFlags = resolveSignalScaledFlags(it.features_json);
        const perfGate = await loadPerformanceGate(exchange);
        const gateEvidence = logCommissionGateEvidence({ phase: "intent_exec", exchange, symbol, event: it.event, perfGate, intentId: it.intent_id });
        const commScale = resolveCommissionSoftScale(perfGate);
        if (commScale.blocked && commScale.scale < 0.9999) {
          if (signalScaleFlags.commissionScaledInSignal) {
            console.log(`[COMMISSION_GATE][DEDUPE] intent ${exchange} ${symbol} ${it.event} | skip_signal_applied=true signal_scale=${signalScaleFlags.commissionScale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
          } else {
            preQtyScale = preQtyScale * commScale.scale;
            console.warn(`[COMMISSION_GATE][SOFT_REDUCE] intent ${exchange} ${symbol} ${it.event} | ratio=${(perfGate.commissionRatio * 100).toFixed(1)}% threshold=${((perfGate.threshold || COMMISSION_RATIO_THRESHOLD) * 100).toFixed(0)}% | scale=${commScale.scale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
          }
        }
        if (perfGate.mddBlocked && perfGate.mddReduceFactor < 1) {
          if (signalScaleFlags.mddScaledInSignal) {
            console.log(`[MDD_REDUCE][DEDUPE] intent ${exchange} ${symbol} ${it.event} | skip_signal_applied=true signal_factor=${signalScaleFlags.mddReduceFactor.toFixed(4)}`);
          } else {
            preQtyScale = preQtyScale * perfGate.mddReduceFactor;
            console.log(`[MDD_REDUCE] intent ${exchange} ${symbol} ${it.event} | mdd=${(perfGate.mdd * 100).toFixed(2)}% | factor=${perfGate.mddReduceFactor}`);
          }
        }
      } catch (gateErr) {
        console.error("[COMMISSION_GATE][EXCEPTION]", { phase: "intent_exec", exchange, symbol, event: it.event, error: gateErr.message, enforce: COMMISSION_GATE_ENFORCE });
        if (COMMISSION_GATE_ENFORCE) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_COMMISSION_GATE_ERROR", status_reason: "DROP_COMMISSION_GATE_ERROR" });
          continue;
        }
      }
    }
    const bypassOppositeEntryCooldown = intentIsEntry
      && shouldBypassOppositeEntryCooldown({ features: it.features_json, intentDir, posMeta });
    if (intentIsEntry && oppositeCooldownBars > 0 && !bypassOppositeEntryCooldown) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const lastExitMs = Number(posMeta && posMeta.last_exit_bar_ms);
        const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
        const intentBarMs = Number(it.signal_bar_close_time_utc_ms) || Number(execBarCloseMs);
        if (Number.isFinite(lastExitMs) && lastExitDir && Number.isFinite(signalTfMs)) {
          const barsSinceExit = Math.floor((intentBarMs - lastExitMs) / signalTfMs);
          if (Number.isFinite(barsSinceExit) && barsSinceExit >= 0 && barsSinceExit <= oppositeCooldownBars) {
            if (intentDir && lastExitDir && intentDir !== lastExitDir) {
              await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_OPPOSITE_COOLDOWN", status_reason: "DROP_OPPOSITE_COOLDOWN" });
              continue;
            }
          }
        }
      }
    }
    // ── 시간 기반 절대 쿨다운: 방향 반전 시 최소 대기 시간 (타임프레임 무관) ──
    if (intentIsEntry && oppositeTimeCooldownMs > 0 && !bypassOppositeEntryCooldown) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const lastExitWallMs = Number(posMeta && posMeta.last_exit_wall_ms);
        const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
        if (Number.isFinite(lastExitWallMs) && lastExitDir && intentDir && lastExitDir !== intentDir) {
          const elapsedMs = resolveEventRefMs(it.signal_bar_close_time_utc_ms, execBarCloseMs) - lastExitWallMs;
          if (elapsedMs >= 0 && elapsedMs < oppositeTimeCooldownMs) {
            console.log(`[OPPOSITE_TIME_COOLDOWN] BLOCKED ${exchange} ${symbol} ${it.event} | dir=${intentDir} vs lastExit=${lastExitDir} | elapsed=${Math.floor(elapsedMs / 1000)}s < cooldown=${Math.floor(oppositeTimeCooldownMs / 1000)}s`);
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_OPPOSITE_TIME_COOLDOWN", status_reason: "DROP_OPPOSITE_TIME_COOLDOWN" });
            continue;
          }
        }
      }
    }
    if (intentIsEntry && sameDirectionTrailProfitCooldownCfg.enabled) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const sameDirectionCooldown = resolveSameDirectionTrailProfitCooldownBlock({
          cfg: sameDirectionTrailProfitCooldownCfg,
          posMeta,
          intentDir,
          eventRefMs: resolveEventRefMs(it.signal_bar_close_time_utc_ms, execBarCloseMs),
        });
        if (sameDirectionCooldown) {
          console.log(
            `[SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN] BLOCKED ${exchange} ${symbol} ${it.event} ` +
            `| dir=${intentDir} | elapsed=${Math.floor(sameDirectionCooldown.elapsed_ms / 1000)}s ` +
            `< cooldown=${Math.floor(sameDirectionCooldown.cooldown_ms / 1000)}s`
          );
          await markIntentStatus(it.intent_id, "CANCELED", {
            cancel_reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
            status_reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          });
          continue;
        }
      }
    }
    if (intent === "EXIT") {
      const hasPosition = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPosition) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
    }

    let qtyFraction = useBudget ? normalizeQtyFraction(it.qty_pct) : Number(it.qty_pct);
    const fixedQtyRestore = restoreFixedEntryQtyFraction({
      qtyFraction,
      intent,
      event: it.event,
      features: it.features_json,
    });
    if (fixedQtyRestore.restored) {
      qtyFraction = fixedQtyRestore.qtyFraction;
      it.features_json = {
        ...(it.features_json || {}),
        fixed_qty_ev_scale_restored: true,
        fixed_qty_original_qty_fraction: fixedQtyRestore.originalQtyFraction,
        fixed_qty_restored_qty_fraction: fixedQtyRestore.qtyFraction,
      };
    }
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_QTY", status_reason: "BAD_QTY" });
      continue;
    }
    const sideScaled = applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget });
    qtyFraction = sideScaled.qtyFraction;
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_QTY", status_reason: "BAD_QTY" });
      continue;
    }
    if (intentIsEntry && Number.isFinite(preQtyScale) && preQtyScale > 0 && preQtyScale < 0.9999) {
      qtyFraction = qtyFraction * preQtyScale;
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_COMMISSION_GATE_ZERO_QTY", status_reason: "DROP_COMMISSION_GATE_ZERO_QTY" });
        continue;
      }
    }
    if (intent === "ADD") {
      const addGuard = evaluateAddIntentRiskGuard({
        cfg: addRiskCfg,
        intent,
        position: pos,
        posMeta,
        bar,
        barCloseMs: execBarCloseMs,
        qtyFraction,
      });
      if (!addGuard.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: addGuard.reason || "DROP_ADD_GUARD",
          status_reason: addGuard.reason || "DROP_ADD_GUARD",
          cancel_note: addGuard.detail ? JSON.stringify(addGuard.detail) : undefined,
        });
        continue;
      }
      if (Number.isFinite(addGuard.qtyScale) && addGuard.qtyScale > 0 && addGuard.qtyScale < 0.9999) {
        qtyFraction *= addGuard.qtyScale;
      }
      if (useBudget) qtyFraction = normalizeQtyFraction(qtyFraction);
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_ADD_QTY_INVALID", status_reason: "DROP_ADD_QTY_INVALID" });
        continue;
      }
    }
    let maxFractionAllowed = qtyFraction;
    if (useBudget && qtyFraction > 1) {
      if (riskBudget.onExceed === "SKIP") {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "RISK_EXCEED_POLICY_SKIP", status_reason: "BUDGET_POLICY_SKIP" });
        continue;
      }
      qtyFraction = 1;
    }

    if (it.side === "SELL") {
      const available = Number(pos.size_pct || 0);
      const sellQty = Math.min(qtyFraction, available);
      if (sellQty <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
      qtyFraction = sellQty;
    }

    if (it.side === "BUY" && useBudget) {
      const curSize = Number(pos.size_pct || 0);
      const remaining = Math.max(0, 1 - curSize);
      if (remaining <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }
      if (qtyFraction > remaining) qtyFraction = remaining;

      let maxByTotal = null;
      if (Number.isFinite(totalMaxKrw) && totalMaxKrw > 0 && Number.isFinite(totalUsedKrw)) {
        const remainingTotal = Math.max(0, totalMaxKrw - totalUsedKrw);
        if (remainingTotal <= 0) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
          continue;
        }
        maxByTotal = remainingTotal / riskBudget.maxKrw;
        if (qtyFraction > maxByTotal) {
          if (riskBudget.onExceed === "SKIP") {
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
            continue;
          }
          qtyFraction = maxByTotal;
        }
      }

      // 최소 주문 금액 미만이면 자동 보정(가능한 범위 내)
      const minOrderKrw = Number(liveCfg.minOrderKrw || 0);
      const liveMode = liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN";
      if (liveMode && minOrderKrw > 0 && Number.isFinite(riskBudget.maxKrw) && riskBudget.maxKrw > 0) {
        const minQtyFraction = minOrderKrw / riskBudget.maxKrw;
        const maxAllowed = Number.isFinite(maxByTotal)
          ? Math.min(remaining, maxByTotal)
          : remaining;
        if (minQtyFraction <= maxAllowed) {
          if (qtyFraction < minQtyFraction) {
            qtyFraction = minQtyFraction;
            await patchIntent(it.intent_id, {
              pending_reason: "ORDER_TOO_SMALL_AUTO_BUMP",
              pending_note: `min_order_krw=${Math.trunc(minOrderKrw)}`,
            });
          }
        } else if (qtyFraction < minQtyFraction) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "ORDER_TOO_SMALL", status_reason: "ORDER_TOO_SMALL" });
          continue;
        }
      }

      if (qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }
    }

    if (intentIsEntry) {
      const policyEval = evaluateLiveEntryPolicy({
        exchange,
        symbol,
        intent,
        qtyPct: qtyFraction,
        features: it.features_json,
        stage: "RUNNER_INTENT_EXEC",
        applyScale: false,
      });
      if (policyEval && policyEval.featuresPatch && typeof policyEval.featuresPatch === "object") {
        it.features_json = policyEval.featuresPatch;
      }
      if (!policyEval || policyEval.ok !== true) {
        const reason = String(policyEval && policyEval.reason || "LIVE_POLICY_BLOCK").trim().toUpperCase() || "LIVE_POLICY_BLOCK";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: reason, status_reason: reason });
        continue;
      }
    }

    const nextOpen = Number(bar.open);
    let fillPrice = null;
    let execPriceSource = "BAR_OPEN";
    let executionMode = "PAPER";
    let liveOrderId = null;
    let execQtyBase = null;
    let liveNotionalKrw = null;
    let avgPrevNotional = null;
    let avgNeedsUpdate = false;
    let liveAdjusted = false;
    let notionalKrw = useBudget ? (riskBudget.maxKrw * qtyFraction) : null;

    const isLiveExecution = liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN";
    if (!isLiveExecution && (intent === "ENTRY" || intent === "ADD") && String(exchange || "").toUpperCase().includes("BINANCE")) {
      try {
        const paperExitProfile = await resolveAdaptiveFuturesExitProfile({
          exchange,
          symbol,
          tf: signalTf,
          intent,
          event: it.event,
          side: actionSide,
          features: it.features_json,
          nowMs: Number(execBarCloseMs),
          manualProfileMode: liveCfg && liveCfg.exitProfileMode,
        });
        if (paperExitProfile && paperExitProfile.profile) {
          appliedExitProfile = String(paperExitProfile.profile).toUpperCase() === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
        }
        if (paperExitProfile && paperExitProfile.reason) appliedExitProfileReason = String(paperExitProfile.reason);
        if (paperExitProfile && paperExitProfile.rules && typeof paperExitProfile.rules === "object") {
          appliedExitRules = cloneExitRules(paperExitProfile.rules);
        }
      } catch (paperExitErr) {
        console.warn(
          `[PAPER_EXIT_PROFILE_RESOLVE_FAIL] ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
          `${paperExitErr && paperExitErr.message ? paperExitErr.message : String(paperExitErr)}`
        );
      }
    }
    let nativeProtectionMetaPatch = null;
    const liveMarketRegimeCohort = resolveLiveMarketRegimeCohort({ symbol, posMeta });
    if (isLiveExecution) {
      if (liveCfg.executionMode === "LIVE" && !liveCfg.liveEnabled) {
        const liveReason = liveCfg.reason || "LIVE_DISABLED";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: liveReason, status_reason: "LIVE_DISABLED" });
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: it.side,
          intent,
          executionMode: "LIVE",
          reason: liveReason,
          qtyPct: qtyFraction,
          closeRatio: resolveFailureAlertCloseRatio({ pos, qtyFraction }),
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          exitRules: (pos && pos.meta && pos.meta.exit_rules_override) || pos.exit_rules_override || null,
        });
        continue;
      }
      const liveResult = await executeLiveOrder({
        liveCfg,
        symbol,
        side: it.side,
        qtyFraction,
        riskBudget,
        pos,
        bar,
        slippageBps,
      });
      if (!liveResult.ok) {
        const liveReason = liveResult.reason || "LIVE_FAILED";
        const cancelPatch = {
          cancel_reason: liveReason,
          status_reason: liveReason,
        };
        if (liveResult.note || liveResult.error) cancelPatch.cancel_note = liveResult.note || liveResult.error;
        if (liveResult.error) cancelPatch.last_error = liveResult.error;
        await markIntentStatus(it.intent_id, "CANCELED", cancelPatch);
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: it.side,
          intent,
          executionMode: liveCfg.executionMode,
          reason: liveReason,
          note: liveResult.note || null,
          error: liveResult.error || null,
          qtyPct: qtyFraction,
          closeRatio: resolveFailureAlertCloseRatio({ pos, qtyFraction }),
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          exitRules: (pos && pos.meta && pos.meta.exit_rules_override) || pos.exit_rules_override || null,
        });
        continue;
      }
      fillPrice = liveResult.execPrice;
      execPriceSource = liveResult.execPriceSource || "UPBIT_ORDER";
      executionMode = liveResult.mode || "LIVE";
      liveOrderId = liveResult.liveOrderId || null;
      execQtyBase = liveResult.execQtyBase;
      if (Number.isFinite(liveResult.qtyFractionUsed)) qtyFraction = liveResult.qtyFractionUsed;
      if (Number.isFinite(liveResult.notionalKrw)) notionalKrw = liveResult.notionalKrw;
    } else {
      fillPrice = computeFillPrice({ side: it.side, nextOpen, slippageBps });
      executionMode = "PAPER";
    }

    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_FILL_PRICE", status_reason: "BAD_FILL_PRICE" });
      continue;
    }

    // 포지션 갱신
    let newSize = Number(pos.size_pct || 0);
    let newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
    let newQtyBase = Number.isFinite(posQtyBase) ? posQtyBase : 0;
    const prevSize = Number(pos.size_pct || 0);

    if (it.side === "BUY") {
      const addCapState = (intent === "ADD")
        ? ensureLogicalAddCapState(resolveLogicalAddCapState({
          posSizePct: newSize,
          position: pos,
          posMeta,
          stagedAddCount: 0,
        }), { posSizePct: newSize, position: pos })
        : null;
      const currentSizeForCap = resolveCurrentQtyPctForCap(addCapState, newSize);
      const remaining = Math.max(0, 1 - currentSizeForCap);
      if (useBudget && remaining <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }

      let add = qtyFraction;
      if (useBudget && add > remaining) add = remaining;
      if (useBudget && Number.isFinite(totalMaxKrw) && totalMaxKrw > 0 && Number.isFinite(totalUsedKrw)) {
        const remainingTotal = Math.max(0, totalMaxKrw - totalUsedKrw);
        if (remainingTotal <= 0) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
          continue;
        }
        const maxByTotal = remainingTotal / riskBudget.maxKrw;
        if (add > maxByTotal) {
          if (riskBudget.onExceed === "SKIP") {
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
            continue;
          }
          add = maxByTotal;
        }
      }
      if (add <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }
      qtyFraction = add;
      const prevNotional = newSize;
      const nextNotional = newSize + add;

      if (nextNotional <= 0) {
        newSize = 0;
        newAvg = null;
        newQtyBase = 0;
      } else {
        if (newAvg === null) newAvg = fillPrice;
        else newAvg = (newAvg * prevNotional + fillPrice * add) / nextNotional;
        newSize = nextNotional;
        const addQtyBase = Number.isFinite(execQtyBase) && execQtyBase > 0
          ? execQtyBase
          : ((notionalKrw != null && Number.isFinite(fillPrice) && fillPrice > 0) ? (notionalKrw / fillPrice) : 0);
        newQtyBase = Math.max(0, newQtyBase + addQtyBase);
      }
    } else {
      const sub = Math.min(qtyFraction, newSize);
      if (sub <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
      qtyFraction = sub;
      const nextNotional = newSize - sub;
      if (nextNotional <= 0) {
        newSize = 0;
        newAvg = null;
        newQtyBase = 0;
      } else {
        newSize = nextNotional;
        const ratio = prevSize > 0 ? (sub / prevSize) : 1;
        const subQtyBase = Number.isFinite(execQtyBase) && execQtyBase > 0
          ? execQtyBase
          : (newQtyBase * ratio);
        newQtyBase = Math.max(0, newQtyBase - subQtyBase);
      }
    }

    const newState = newSize <= 0 ? "FLAT" : "ACTIVE";

    notionalKrw = useBudget ? (riskBudget.maxKrw * qtyFraction) : notionalKrw;
    if (!Number.isFinite(notionalKrw) || notionalKrw <= 0) {
      const baseQty = Number.isFinite(execQtyBase) && execQtyBase > 0
        ? execQtyBase
        : (!useBudget && Number.isFinite(qtyFraction) && qtyFraction > 0 ? qtyFraction : null);
      if (Number.isFinite(baseQty) && Number.isFinite(fillPrice) && fillPrice > 0) {
        notionalKrw = baseQty * fillPrice;
      }
    }
    const notional = Number.isFinite(notionalKrw) ? notionalKrw : 1.0;
    const feeValue = computeFeeValue({ notional, feeBps });

    const signalPrice = Number(it.signal_price);
    const signalPriceDiff = Number.isFinite(signalPrice) ? (fillPrice - signalPrice) : null;
    const signalPriceDiffPct = (Number.isFinite(signalPrice) && signalPrice !== 0) ? (signalPriceDiff / signalPrice) : null;
    const opening = prevSize <= 0 && newSize > 0;
    const positionSideBefore = normalizePositionSide(
      pos.position_side ||
      pos.side ||
      (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
    );
    const execQtyBaseForPnl = Number.isFinite(execQtyBase) && execQtyBase > 0
      ? Number(execQtyBase)
      : (Number.isFinite(notionalKrw) && Number.isFinite(fillPrice) && fillPrice > 0 ? (notionalKrw / fillPrice) : null);
    let realizedPnlQuote = null;
    if (intent === "EXIT") {
      const avgBefore = Number(pos.avg_price);
      const sideBefore = positionSideBefore || (String(it.side || "").toUpperCase() === "SELL" ? "LONG" : "SHORT");
      if (Number.isFinite(avgBefore) && Number.isFinite(execQtyBaseForPnl) && execQtyBaseForPnl > 0) {
        const gross = (sideBefore === "SHORT")
          ? ((avgBefore - fillPrice) * execQtyBaseForPnl)
          : ((fillPrice - avgBefore) * execQtyBaseForPnl);
        realizedPnlQuote = gross - (Number.isFinite(feeValue) ? feeValue : 0);
      }
    }
    const closeRatio = (intent === "EXIT" && Number.isFinite(prevSize) && prevSize > 0)
      ? Math.max(0, Math.min(1, qtyFraction / prevSize))
      : null;
    const appliedLeverage = resolvePositionLeverage({ position: pos, fallback: leverage });
    const appliedLeverageReason = String(
      (posMeta && posMeta.leverage_reason) ||
      (posMeta && posMeta.leverage_source) ||
      ""
    ).trim() || null;
    const exitProfileSnapshot = resolvePositionExitProfile({
      posMeta,
      fallbackMode: liveCfg && liveCfg.exitProfileMode,
    });
    const appliedExitProfile = exitProfileSnapshot.profile === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
    const appliedExitProfileReason = exitProfileSnapshot.reason;
    const appliedExitRules = cloneExitRules(exitProfileSnapshot.rules);
    const intentSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
    const intentSignalDocId = it.signal_doc_id ||
      (it.features_json && it.features_json.signal_doc_id) ||
      deriveSignalDocId({
        exchange,
        symbol,
        tf,
        barCloseMs: it.signal_bar_close_time_utc_ms || it.exec_bar_close_time_utc_ms,
        event: it.event,
        signalId: intentSignalId,
      });
    const entryEventIdFromIntent = buildEntryEventId({
      exchange,
      symbol,
      tf,
      signalBarCloseMs: it.signal_bar_close_time_utc_ms,
      event: it.event,
    });
    const entrySignalTypeFromIntent = normalizeEvent(it.event) || null;
    const entryGradeFromIntent = String(
      (it.features_json && (it.features_json.entry_grade || it.features_json.entry_timing_tier || it.features_json.entry_tier)) || ""
    ).toUpperCase() || null;
    const entryQtyProfileFromIntent = String(
      (it.features_json && (it.features_json.entry_qty_profile || it.features_json.entry_qty_tier || it.features_json.qty_profile)) || ""
    ).toUpperCase() || null;
    const intentEntryEventId = String(
      (it.entry_event_id || (it.features_json && it.features_json.entry_event_id) || "")
    ).trim() || null;
    const intentEntrySignalType = String(
      (it.entry_signal_type || (it.features_json && it.features_json.entry_signal_type) || "")
    ).toUpperCase() || null;
    const fillEntryLineage = resolveEntryLineageForFill({
      opening,
      entryEventIdFromIntent,
      entrySignalTypeFromIntent,
      intentEntryEventId,
      intentEntrySignalType,
      posMeta,
    });
    const entryEventIdForFill = fillEntryLineage.entryEventId;
    const entrySignalTypeForFill = fillEntryLineage.entrySignalType;
    const tradeExecMs = (() => {
      const n = Date.parse(String(it.created_at || ""));
      return Number.isFinite(n) ? n : null;
    })();
    const linkedTradeId = buildTradeId({
      exchange,
      symbol,
      event: it.event,
      execBarCloseMs: execBarCloseMs,
      execMs: tradeExecMs,
    });

    const fillWrite = await upsertFill({
      intentId: it.intent_id,
      tradeId: linkedTradeId,
      runId,
      exchange,
      symbol,
      tf,
      execBarCloseTimeUtc: execBarCloseUtc,
      execBarCloseTimeUtcMs: execBarCloseMs,
      side: it.side,
      event: it.event,
      qtyPct: qtyFraction,
      execPrice: fillPrice,
      feeBps,
      slippageBps,
      feeValue,
      notional,
      notionalKrw,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: notionalKrw,
      qtyFraction: useBudget ? qtyFraction : null,
      execPriceSource,
      executionMode,
      liveOrderId,
      execQtyBase,
      signalId: intentSignalId,
      signalDocId: intentSignalDocId,
      signalPrice: Number.isFinite(signalPrice) ? signalPrice : null,
      signalPriceDiff,
      signalPriceDiffPct,
      signalPriceSource: it.signal_price_source || null,
      entryEventId: entryEventIdForFill,
      entrySignalType: entrySignalTypeForFill,
      leverageApplied: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
      leverageReason: appliedLeverageReason,
      featuresJson: it.features_json && typeof it.features_json === "object" ? it.features_json : null,
      exitProfile: appliedExitProfile || null,
      exitProfileReason: appliedExitProfileReason || null,
      decisionReason: it.reason || it.event || null,
    });
    sendTradeExecutionAlert({
      exchange,
      symbol,
      event: it.event,
      side: it.side,
      intent,
      executionMode,
      notional,
      execQtyBase,
      execPrice: fillPrice,
      closeRatio,
      fullExit: intent === "EXIT" && newState === "FLAT",
      realizedPnl: realizedPnlQuote,
      positionSideBefore,
      positionSideAfter: newState === "FLAT" ? null : positionSideBefore,
      appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
      leverageReason: appliedLeverageReason,
      exitProfile: appliedExitProfile || null,
      exitProfileReason: appliedExitProfileReason || null,
      exitRules: appliedExitRules || null,
      features: it.features_json || {},
      runId,
    }).catch((e) => {
      console.warn("[TRADE_EXEC_ALERT_FAIL]", e && e.message ? e.message : String(e));
    });

    await markIntentStatus(it.intent_id, "FILLED", {
      filled_at: new Date().toISOString(),
      exec_price: fillPrice,
      status_reason: "FILLED",
    });

    if (useBudget && Number.isFinite(totalUsedKrw) && Number.isFinite(totalMaxKrw)) {
      if (it.side === "BUY") totalUsedKrw += Number(notionalKrw || 0);
      else if (it.side === "SELL") totalUsedKrw = Math.max(0, totalUsedKrw - Number(notionalKrw || 0));
    }

    const ev = String(it.event || "").toUpperCase();
    const closing = newState === "FLAT";
    const openingOrAdd = (intent === "ENTRY" || intent === "ADD") && newState === "ACTIVE";
    const metaSide = String(pos.position_side || "LONG").toUpperCase();
    const marketRegimeRow = opening ? readOpenClawMarketRegimeRow(symbol) : null;
    const marketRegimeCohort = normalizeOpenClawCohort(marketRegimeRow && marketRegimeRow.cohort);
    let nextMeta = mergeMeta(posMeta, {
      last_fill_intent: it.intent_id,
      last_fill_side: it.side,
    });

    if (opening || closing) {
      nextMeta = mergeMeta(nextMeta, {
        tp_p0_done: false,
        tp_p0_price: null,
        tp_p0_at: null,
        tp_p0_source: null,
        tp_p0_qty_ratio: null,
        tp_p0_entry_event_id: null,
        tp_p0_entry_exec_bar_ms: null,
        tp_p1_done: false,
        tp_p1_price: null,
        tp_p1_target_price: null,
        trail_high: null,
        trail_low: null,
        trail_active: false,
        initial_stop_price: null,
        entry_r_distance: null,
        trail_r_multiple: null,
        tp_p1_pending: false,
        tp_p1_pending_at_ms: null,
        tp_p1_pending_until_ms: null,
        tp_p1_pending_event: null,
        tp_p1_bar_ms: null,
        tp_p1_at: null,
        tp_p1_source: null,
        tp_p1_entry_event_id: null,
        tp_p1_entry_exec_bar_ms: null,
        trail_delay_bars_required: null,
        trail_delay_mfe_pct_required: null,
        trail_delay_release_reason: null,
        trail_delay_release_at: null,
        trail_delay_mode: null,
        tp_p1_skip_reason: null,
        tp_p1_skip_note: null,
        tp_p1_skip_at: null,
        opposite_transition_dir: null,
        opposite_transition_event: null,
        opposite_transition_until_ms: null,
        opposite_transition_stage: null,
        opposite_transition_seen_ms: null,
        add_chain_last_signal_bar_ms: null,
        add_chain_last_intent_id: null,
        add_chain_last_signal_id: null,
        add_chain_last_avg_before: null,
        add_chain_last_avg_after: null,
        add_chain_last_size_before: null,
        add_chain_last_size_after: null,
        add_chain_last_qty_pct: null,
        add_chain_last_qty_base: null,
        add_chain_last_loss_pct: null,
        add_chain_base_qty_pct: closing ? null : undefined,
        native_protection_refresh_status: closing ? null : undefined,
        native_protection_refresh_reason: closing ? null : undefined,
        native_protection_refresh_context: closing ? null : undefined,
        native_protection_refresh_at_ms: closing ? null : undefined,
        native_protection_refresh_bar_ms: closing ? null : undefined,
        native_protection_stale: closing ? false : undefined,
        native_protection_attempts: closing ? null : undefined,
        native_protection_max_attempts: closing ? null : undefined,
        native_protection_stop_order_id: closing ? null : undefined,
        native_protection_tp0_order_id: closing ? null : undefined,
        native_protection_tp_order_id: closing ? null : undefined,
        native_protection_stop_price: closing ? null : undefined,
        native_protection_tp0_price: closing ? null : undefined,
        native_protection_tp_price: closing ? null : undefined,
        native_protection_tp0_qty_base: closing ? null : undefined,
        native_protection_tp_qty_base: closing ? null : undefined,
        native_protection_tp0_qty_ratio: closing ? null : undefined,
        native_protection_tp_qty_ratio: closing ? null : undefined,
        native_protection_tp0_status: closing ? null : undefined,
        native_protection_tp_status: closing ? null : undefined,
        native_protection_tp0_reason: closing ? null : undefined,
        native_protection_tp_reason: closing ? null : undefined,
        native_protection_entry_price: closing ? null : undefined,
        native_protection_side: closing ? null : undefined,
      });
    }
    if (openingOrAdd) {
      const entryExitAdjustment = applyEntryExitRuleRuntimeAdjustments({
        rules: appliedExitRules,
        features: it.features_json,
        sysCfg,
        cohort: marketRegimeCohort,
        market: symbol,
      });
      const exitPolicySrc = entryExitAdjustment.exitPolicySrc;
      const tp1LadderState = entryExitAdjustment.tp1LadderState;
      appliedExitRules = cloneExitRules(entryExitAdjustment.appliedExitRules);
      nextMeta = mergeMeta(nextMeta, {
        exit_profile: appliedExitProfile || "BASE",
        exit_profile_reason: (exitPolicySrc && exitPolicySrc !== "BINANCE_DEFAULT")
          ? `${appliedExitProfileReason || "BASE_PROFILE"}+${exitPolicySrc}`
          : (appliedExitProfileReason || null),
        exit_rules_override: cloneExitRules(appliedExitRules),
        tp1_ladder_enabled: tp1LadderState ? tp1LadderState.enabled !== false : null,
        tp1_ladder_stage: tp1LadderState ? tp1LadderState.stage : null,
        tp1_ladder_profile: tp1LadderState ? tp1LadderState.profile : null,
        tp1_ladder_reason: tp1LadderState ? tp1LadderState.reason : null,
        tp1_ladder_realized_n: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.realized_n : null,
        tp1_ladder_tp0_hit_rate: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp0_hit_rate : null,
        tp1_ladder_tp1_hit_rate: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp1_hit_rate : null,
        tp1_ladder_tp0_to_tp1_conversion: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp0_to_tp1_conversion : null,
        tp1_ladder_fee_adjusted_expectancy: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.fee_adjusted_expectancy : null,
        exit_policy_source: exitPolicySrc || null,
      });
      const runtimeExitInvariant = await enforceEntryRuntimeExitState({
        exchange,
        symbol,
        appliedExitRules,
        posMeta: nextMeta,
        features: it.features_json,
        cohort: marketRegimeCohort,
        sysCfg,
        entryPrice: fillPrice,
        leverage,
        execBarCloseMs,
      });
      if (runtimeExitInvariant.repaired) {
        appliedExitRules = cloneExitRules(runtimeExitInvariant.appliedExitRules);
        nextMeta = runtimeExitInvariant.meta;
      }
    }
    if (opening) {
      nextMeta = mergeMeta(nextMeta, {
        leverage,
        entry_exec_tf_ms: Number.isFinite(signalTfMs) ? signalTfMs : null,
        last_exit_bar_ms: null,
        last_exit_dir: null,
        last_exit_wall_ms: null,
        add_chain_base_qty_pct: Number.isFinite(newSize) ? Number(newSize) : null,
        ev_gate_atr_pct: Number.isFinite(Number(it.features_json && it.features_json.ev_gate_atr_pct))
          ? Number(it.features_json.ev_gate_atr_pct)
          : null,
        openclaw_market_regime_cohort: marketRegimeCohort || null,
        openclaw_market_regime_objective_score: marketRegimeRow && Number.isFinite(Number(marketRegimeRow.objective_score))
          ? Number(marketRegimeRow.objective_score)
          : null,
        openclaw_market_regime_drop_verdict: marketRegimeRow ? String(marketRegimeRow.drop_verdict || "").trim().toUpperCase() || null : null,
        ...buildEntryLineageMetaPatch({
          entry_event_id: entryEventIdFromIntent || null,
          entry_signal_type: entrySignalTypeFromIntent || null,
          entry_grade: entryGradeFromIntent || null,
          entry_qty_profile: entryQtyProfileFromIntent || null,
          entry_signal_bar_ms: Number(it.signal_bar_close_time_utc_ms) || null,
          entry_exec_bar_ms: Number(execBarCloseMs) || null,
        }),
      });
    }
    if (closing) {
      nextMeta = mergeMeta(nextMeta, {
        last_exit_bar_ms: Number(execBarCloseMs) || null,
        last_exit_dir: metaSide || null,
        last_exit_wall_ms: resolveEventRefMs(execBarCloseMs),
        entry_exec_bar_ms: null,
        entry_exec_tf_ms: null,
        entry_event_id: null,
        entry_signal_type: null,
        entry_grade: null,
        entry_qty_profile: null,
        entry_signal_bar_ms: null,
        origin_entry_event_id: null,
        origin_entry_signal_type: null,
        origin_entry_grade: null,
        origin_entry_qty_profile: null,
        origin_entry_signal_bar_ms: null,
        origin_entry_exec_bar_ms: null,
        openclaw_market_regime_cohort: null,
        openclaw_market_regime_objective_score: null,
        openclaw_market_regime_drop_verdict: null,
        exit_profile: null,
        exit_profile_reason: null,
        exit_rules_override: null,
        exit_policy_source: null,
      });
      const profitableTrailCooldownMeta = buildSameDirectionTrailProfitCooldownMetaPatch({
        event: ev,
        realizedPnlQuote,
        positionSide: metaSide,
        exitWallMs: resolveEventRefMs(execBarCloseMs),
        source: "INTENT_FILL",
      });
      if (profitableTrailCooldownMeta) {
        nextMeta = mergeMeta(nextMeta, profitableTrailCooldownMeta);
      }
    }
    if (isTpP0EventLocal(ev) && newState === "ACTIVE") {
      nextMeta = mergeMeta(nextMeta, {
        tp_p0_done: true,
        tp_p0_price: fillPrice,
        tp_p0_at: new Date().toISOString(),
        tp_p0_source: "INTENT_FILL",
        tp_p0_qty_ratio: qtyFraction,
        tp_p0_entry_event_id: (entryEventIdForFill || nextMeta.entry_event_id || null),
        tp_p0_entry_exec_bar_ms: Number(nextMeta.entry_exec_bar_ms || execBarCloseMs) || null,
      });
    }
    if ((ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_")) && newState === "ACTIVE") {
      const trailDelayCfg = resolveTrailDelayConfigForMeta({
        exchange,
        pos: { ...pos, meta: nextMeta },
        posMeta: nextMeta,
      });
      const nextTrailHigh = metaSide === "SHORT"
        ? null
        : (Number.isFinite(fillPrice) ? fillPrice : null);
      const nextTrailLow = metaSide === "SHORT"
        ? (Number.isFinite(fillPrice) ? fillPrice : null)
        : null;
      nextMeta = mergeMeta(nextMeta, {
        tp_p0_done: nextMeta.tp_p0_done === true,
        tp_p1_done: true,
        tp_p1_price: fillPrice,
        tp_p1_target_price: computeTpP1TargetPrice({
          exchange,
          position: pos,
          posMeta: nextMeta,
          fillPrice,
        }),
        trail_high: nextTrailHigh,
        trail_low: nextTrailLow,
        trail_active: false,
        tp_p1_pending: false,
        tp_p1_pending_at_ms: null,
        tp_p1_pending_until_ms: null,
        tp_p1_pending_event: null,
        tp_p1_bar_ms: Number(execBarCloseMs) || null,
        tp_p1_at: new Date().toISOString(),
        tp_p1_source: "INTENT_FILL",
        tp_p1_entry_event_id: (entryEventIdForFill || nextMeta.entry_event_id || null),
        tp_p1_entry_exec_bar_ms: Number(nextMeta.entry_exec_bar_ms || execBarCloseMs) || null,
        trail_delay_bars_required: trailDelayCfg.barsRequired,
        trail_delay_mfe_pct_required: trailDelayCfg.mfePctRequired,
        trail_delay_release_reason: null,
        trail_delay_release_at: null,
        trail_delay_mode: "ONE_BAR_OR_MFE",
        tp_p1_skip_reason: null,
        tp_p1_skip_note: null,
        tp_p1_skip_at: null,
        opposite_transition_dir: null,
        opposite_transition_event: null,
        opposite_transition_until_ms: null,
        opposite_transition_stage: null,
        opposite_transition_seen_ms: null,
      });
      console.warn(
        `[TP1_TRAIL_ARMED] ${symbol} side=${metaSide || "UNKNOWN"} source=INTENT_FILL ` +
        `event=${ev} fill_price=${fillPrice ?? "NA"} trail_high=${nextTrailHigh ?? "NA"} ` +
        `trail_low=${nextTrailLow ?? "NA"} intent_id=${it.intent_id || "NA"}`
      );
      triggerExitWorkerRun({
        reason: `TP1_TRAIL_ARMED_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}`,
      }).catch((e) => {
        console.warn("[EXIT_WORKER_SCALE_ON_FAIL][TP1_INTENT_FILL]", e && e.message ? e.message : String(e));
      });
    }

    nextMeta = applyAddAndProtectionMetaOnFill({
      posMeta: nextMeta,
      intent,
      event: it.event,
      barCloseMs: execBarCloseMs,
      realizedPnlQuote,
      opening,
      closing,
      signalBarCloseMs: it.signal_bar_close_time_utc_ms,
      intentId: it.intent_id,
      signalId: intentSignalId,
      avgBefore: pos.avg_price,
      avgAfter: newAvg,
      sizeBefore: prevSize,
      sizeAfter: newSize,
      qtyPct: qtyFraction,
      qtyBase: qtyBaseDelta,
      lossPct: it.features_json && it.features_json._rescue_add_loss_pct,
    });
    nextMeta = mergeMeta(nextMeta, { qty_base: newQtyBase });

    await upsertPosition({
      exchange,
      symbol,
      state: newState,
      positionSide: newState === "ACTIVE" ? "LONG" : null,
      sizePct: newSize,
      avgPrice: newAvg,
      qtyBase: newQtyBase,
      runId,
      executionMode,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: useBudget ? (riskBudget.maxKrw * newSize) : null,
      budgetSource: useBudget ? riskBudget.source : null,
      meta: nextMeta,
    });

    pos = { ...pos, state: newState, size_pct: newSize, avg_price: newAvg, position_side: newState === "ACTIVE" ? "LONG" : null, meta: nextMeta, qty_base: newQtyBase };
    posMeta = nextMeta;
    posQtyBase = newQtyBase;

    await upsertTradeEvent({
      runId,
      exchange,
      symbol,
      tf,
      event: it.event,
      side: it.side,
      execBarCloseTimeUtc: execBarCloseUtc,
      execBarCloseTimeUtcMs: execBarCloseMs,
      execMs: tradeExecMs,
      intentId: it.intent_id,
      fillId: fillWrite && fillWrite.fill_id,
      signalId: intentSignalId,
      signalDocId: intentSignalDocId,
      entryEventId: entryEventIdForFill,
      entrySignalType: entrySignalTypeForFill,
      execPrice: fillPrice,
      qtyPct: qtyFraction,
      feeValue,
      note: `FILLED_INTENT:${it.intent_id}`,
      pnl: null,
      notionalKrw,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: notionalKrw,
      qtyFraction: useBudget ? qtyFraction : null,
      meta: { trading_mode, execution_mode: executionMode },
      executionMode,
      featuresJson: it.features_json && typeof it.features_json === "object" ? it.features_json : null,
      requestId: it.request_id || null,
      decisionReason: it.decision_reason || it.reason || it.event || null,
    });

      fillsExecuted += 1;
    }
  };

  await executeIntentList(sortIntentsForExecution(intents));

  // ✅ fill 이후 포지션 재조회
  pos = await getPosition({ exchange, symbol });
  posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : posMeta;
  posSide = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
  ) || posSide;
  posQtyBase = resolvePosQtyBase(pos) || posQtyBase;
  posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : posMeta;
  posQtyBase = resolvePosQtyBase(pos);

  // 3) (B) signals 생성/수집 → 다음 봉 intent 예약
  const nextExecMs = Number.isFinite(execTfMs) ? addMs(barCloseMs, execTfMs) : addMs(barCloseMs, 60 * 60 * 1000);
  const nextExecUtc = msToUtcZ(nextExecMs);
  const alignedSignalBar = Number.isFinite(signalTfMs) && Number.isFinite(barCloseMs) && (Number(barCloseMs) % signalTfMs === 0);
  const fallbackSignalBarMs = (Number.isFinite(signalTfMs) && Number.isFinite(barCloseMs))
    ? Math.floor(Number(barCloseMs) / signalTfMs) * signalTfMs
    : null;
  const signalBarCloseMs = alignedSignalBar
    ? Number(barCloseMs)
    : (Number.isFinite(fallbackSignalBarMs) ? fallbackSignalBarMs : null);
  const signalBarCloseUtc = Number.isFinite(signalBarCloseMs) ? msToUtcZ(signalBarCloseMs) : null;
  const nativeInitialSignals = Number.isFinite(signalBarCloseMs)
    ? await loadServerNativeInitialSignals({
      exchange,
      symbol,
      signalTf,
      barCloseMs: signalBarCloseMs,
    })
    : [];

  // 내부 신호(현재 NO_SIGNAL)
  const allowInternalExitSignals = canEvaluateInternalExitSignalsForBar({ posMeta, barCloseMs });
  const liqSignal = allowInternalExitSignals
    ? buildLiquidationExitSignal({ position: pos, bar, leverage, bufferPct })
    : null;
  const timeStopSignal = (allowInternalExitSignals && exUpper.includes("BINANCE"))
    ? buildTimeStopExitSignal({ position: pos, bar, posMeta, barCloseMs, signalTfMs, maxHoldBars })
    : null;
  const internalSignalsRaw = [
    ...nativeInitialSignals,
    ...generateSignals({
      exchange,
      symbol,
      tf,
      bar,
      gate,
      position: pos,
      trading_mode,
      leverage,
      exitProfileMode: liveCfg && liveCfg.exitProfileMode,
      currentBarCloseMs: Number(barCloseMs),
    }),
    ...(liqSignal ? [liqSignal] : []),
    ...(timeStopSignal ? [timeStopSignal] : []),
  ];
  const internalSignals = finalizeInternalSignals({
    signals: internalSignalsRaw,
    posMeta,
    barCloseMs,
    fallbackUtc: signalBarCloseUtc,
    exchange,
    symbol,
  });

  // 외부 신호(signals 컬렉션)
  const externalSignalsRaw = Number.isFinite(signalBarCloseMs)
    ? await getSignalsForBar({
      exchange,
      symbol,
      tf: signalTf,
      barCloseMs: signalBarCloseMs,
      limitN: 200,
      maxLookbackBars: signalQueueEnabled ? signalQueueMaxLateBars : undefined,
      caller: "paperUpbitRunner:runPaperUpbitForBar",
    })
    : [];

  const ttlMs = Number.isFinite(execProfile.intentTtlMs) ? execProfile.intentTtlMs
    : (Number.isFinite(execProfile.intentTtlBars) && Number.isFinite(execTfMs) ? (execTfMs * execProfile.intentTtlBars) : null);
  let lateSignals = 0;

  const externalSignals = externalSignalsRaw.map((s) => {
    const signalBarMs = Number(s.bar_close_time_utc_ms);
    const signalDocId = String(s.signal_doc_id || (String(s.signal_id || "").startsWith("SIG__") ? s.signal_id : "") || "").trim() || null;
    let lateByBars = 0;
    if (Number.isFinite(signalTfMs) && Number.isFinite(signalBarMs)) {
      const delta = barCloseMs - signalBarMs;
      if (delta >= signalTfMs / 2) lateByBars = Math.max(0, Math.round(delta / signalTfMs));
    }
    const features = { ...(s.features_json || {}) };
    if (signalDocId && !features.signal_doc_id) features.signal_doc_id = signalDocId;
    if (s.signal_id && !features.signal_id) features.signal_id = s.signal_id;
    if (Number.isFinite(Number(s.price)) && !Number.isFinite(Number(features.signal_price))) features.signal_price = Number(s.price);
    if (lateByBars > 0) {
      lateSignals += 1;
      features._late_by_bars = lateByBars;
      features._late_by_ms = Number(barCloseMs) - Number(signalBarMs);
      features._late_origin_bar_close_time_utc_ms = Number(signalBarMs);
    }

    return {
      signal_id: s.signal_id,
      signal_doc_id: signalDocId,
      event: s.event,
      side: s.side,
      qty_pct: s.qty_pct,
      reason: s.reason || "TV_WEBHOOK",
      signal_bar_close_time_utc_ms: Number.isFinite(signalBarMs) ? signalBarMs : null,
      signal_bar_close_time_utc: s.bar_close_time_utc || null,
      signal_price: Number.isFinite(Number(s.price)) ? Number(s.price) : null,
      features,
    };
  });

  const signals = dedupeEntrySignalsByFamily([...internalSignals, ...externalSignals]);
  const signalDrops = [];
  const metaUpdates = pendingMetaPatch ? { ...pendingMetaPatch } : {};
  const posSideNow = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  );
  const intentExecutionMode = (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")
    ? liveCfg.executionMode
    : "PAPER";

  let intentsCreated = 0;
  let immediateIntentsCreated = 0;
  for (const s of signals) {
    s.features = buildSignalStageFeatures(s, null);
    const intent = intentFromSignal({ event: s.event, side: s.side, features: s.features });
    const intentIsEntry = intent === "ENTRY" || intent === "ADD";
    if (intentIsEntry) {
      s.features = applyCanonicalSourceProvenanceDefaults({
        intent,
        features: s.features,
        sysCfg: sysCfgEffective,
        market: s.symbol_or_pair_id || symbol,
        eventUpper: String(s.event || "").trim().toUpperCase(),
        intentDir: directionFromSignal({ event: s.event, side: s.side }),
        tf: signalTf,
      });
    }
    const manualRetryIntent = intentIsEntry && isManualRetryFeatures(s.features);
    let preQtyScale = 1;
    const effectiveBarMs = Number(s && s.features && s.features._late_origin_bar_close_time_utc_ms) || Number(barCloseMs);
    const signalBarMsRaw = s && s.signal_bar_close_time_utc_ms;
    const signalBarMsParsed = (signalBarMsRaw === null || signalBarMsRaw === undefined) ? null : Number(signalBarMsRaw);
    const signalBarCloseMsForIntent = Number.isFinite(signalBarMsParsed) ? signalBarMsParsed : effectiveBarMs;
    const signalBarCloseUtcForIntent = Number.isFinite(signalBarCloseMsForIntent)
      ? msToUtcZ(signalBarCloseMsForIntent)
      : (s.signal_bar_close_time_utc || barCloseUtc);
    if (backfillExitOnly && intentIsEntry && backfillAllowEntry !== true) {
      if (String(trading_mode || "").toUpperCase() === "EXIT_ONLY") {
        // EXIT_ONLY pass should not consume live entry signals.
        continue;
      }
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: s.qty_pct,
        reason: "BACKFILL_SKIP_ENTRY",
        drop_reason_code: "BACKFILL_SKIP_ENTRY",
        features_json: { ...(s.features || {}), backfill_exit_only: true },
        event_intent: intent,
      });
      continue;
    }
    if (!allowByTradingModeIntent(trading_mode, intent)) continue;

    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: s.event })
      : directionFromSignal({ event: s.event, side: s.side });
    let qtyFraction = useBudget ? normalizeQtyFraction(s.qty_pct) : Number(s.qty_pct);
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) continue;
    const sideScaled = applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget });
    qtyFraction = sideScaled.qtyFraction;
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) continue;
    if (useBudget && qtyFraction > 1) {
      if (riskBudget.onExceed === "SKIP") continue;
      qtyFraction = 1;
    }

    const normalizedEvent = normalizeTpP1EventForExchange(s.event, exchange);
    if (normalizedEvent && normalizedEvent !== s.event) s.event = normalizedEvent;
    const eventUpper = String(normalizedEvent || s.event || "").toUpperCase();
    const actionTag = normalizeActionValue(s.features && s.features.action);
    const allowTrailEntry = forceAllSignalsAdd || allowEntryDuringTrail({ event: s.event, features: s.features, posMeta });
    if (intentIsEntry && (posMeta && (posMeta.trail_active === true || posMeta.tp_p1_done === true)) && !allowTrailEntry) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: Number(barCloseMs),
        qty_pct: qtyFraction,
        reason: "DROP_TRAIL_ACTIVE_NO_ADD",
        drop_reason_code: "DROP_TRAIL_ACTIVE_NO_ADD",
        features_json: { ...(s.features || {}), trail_active: posMeta.trail_active ?? null, tp_p1_done: posMeta.tp_p1_done ?? null },
        event_intent: intent,
      });
      continue;
    }
    if (intentIsEntry && !actionAllowsEntry(actionTag)) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: Number(barCloseMs),
        qty_pct: qtyFraction,
        reason: "DROP_ACTION_FILTER",
        drop_reason_code: "DROP_ACTION_FILTER",
        features_json: { ...(s.features || {}), action: actionTag },
        event_intent: intent,
      });
      continue;
    }
    if (intentIsEntry && !isTradeableEventAllowed({ eventUpper, intentDir, allowlist: tradeableSignalTypes })) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: Number(barCloseMs),
        qty_pct: qtyFraction,
        reason: "DROP_TRADEABLE_SIGNAL_TYPES",
        drop_reason_code: "DROP_TRADEABLE_SIGNAL_TYPES",
        features_json: { ...(s.features || {}), allowlist: tradeableSignalTypes },
        event_intent: intent,
      });
      continue;
    }
    const bypassOppositeEntryCooldown = intentIsEntry
      && shouldBypassOppositeEntryCooldown({ features: s.features, intentDir, posMeta });
    if (intentIsEntry && oppositeCooldownBars > 0 && !hasPositionSize(pos.size_pct) && !bypassOppositeEntryCooldown) {
      const lastExitMs = Number(posMeta && posMeta.last_exit_bar_ms);
      const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
      if (Number.isFinite(lastExitMs) && lastExitDir && Number.isFinite(signalTfMs)) {
        const barsSinceExit = Math.floor((effectiveBarMs - lastExitMs) / signalTfMs);
        if (Number.isFinite(barsSinceExit) && barsSinceExit >= 0 && barsSinceExit <= oppositeCooldownBars) {
          if (intentDir && lastExitDir && intentDir !== lastExitDir) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: effectiveBarMs,
              qty_pct: qtyFraction,
              reason: "DROP_OPPOSITE_COOLDOWN",
              drop_reason_code: "DROP_OPPOSITE_COOLDOWN",
              features_json: {
                ...(s.features || {}),
                last_exit_bar_ms: lastExitMs,
                last_exit_dir: lastExitDir,
                bars_since_exit: barsSinceExit,
                cooldown_bars: oppositeCooldownBars,
              },
              event_intent: intent,
            });
            continue;
          }
        }
      }
    }
    // ── 시간 기반 절대 쿨다운: 방향 반전 시 최소 대기 시간 (타임프레임 무관) ──
    if (intentIsEntry && oppositeTimeCooldownMs > 0 && !hasPositionSize(pos.size_pct) && !bypassOppositeEntryCooldown) {
      const lastExitWallMs = Number(posMeta && posMeta.last_exit_wall_ms);
      const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
      if (Number.isFinite(lastExitWallMs) && lastExitDir && intentDir && lastExitDir !== intentDir) {
        const elapsedMs = resolveEventRefMs(effectiveBarMs, s.bar_close_time_utc_ms) - lastExitWallMs;
        if (elapsedMs >= 0 && elapsedMs < oppositeTimeCooldownMs) {
          console.log(`[OPPOSITE_TIME_COOLDOWN] DROP signal ${exchange} ${symbol} ${s.event} | dir=${intentDir} vs lastExit=${lastExitDir} | elapsed=${Math.floor(elapsedMs / 1000)}s < cooldown=${Math.floor(oppositeTimeCooldownMs / 1000)}s`);
          signalDrops.push({
            ...s,
            bar_close_time_utc_ms: effectiveBarMs,
            qty_pct: qtyFraction,
            reason: "DROP_OPPOSITE_TIME_COOLDOWN",
            drop_reason_code: "DROP_OPPOSITE_TIME_COOLDOWN",
            features_json: {
              ...(s.features || {}),
              last_exit_wall_ms: lastExitWallMs,
              last_exit_dir: lastExitDir,
              elapsed_sec: Math.floor(elapsedMs / 1000),
              cooldown_sec: Math.floor(oppositeTimeCooldownMs / 1000),
            },
            event_intent: intent,
          });
          continue;
        }
      }
    }
    if (intentIsEntry && sameDirectionTrailProfitCooldownCfg.enabled && !hasPositionSize(pos.size_pct)) {
      const sameDirectionCooldown = resolveSameDirectionTrailProfitCooldownBlock({
        cfg: sameDirectionTrailProfitCooldownCfg,
        posMeta,
        intentDir,
        eventRefMs: resolveEventRefMs(effectiveBarMs, s.bar_close_time_utc_ms),
      });
      if (sameDirectionCooldown) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          drop_reason_code: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          features_json: {
            ...(s.features || {}),
            same_direction_trail_profit_exit_dir: sameDirectionCooldown.exit_dir,
            same_direction_trail_profit_exit_wall_ms: sameDirectionCooldown.exit_wall_ms,
            same_direction_trail_profit_exit_event: sameDirectionCooldown.exit_event,
            same_direction_trail_profit_exit_realized_pnl: sameDirectionCooldown.realized_pnl,
            elapsed_sec: Math.floor(sameDirectionCooldown.elapsed_ms / 1000),
            cooldown_sec: Math.floor(sameDirectionCooldown.cooldown_ms / 1000),
          },
          event_intent: intent,
        });
        continue;
      }
    }
    const lateByBars = Number(s && s.features && s.features._late_by_bars);
    const signalDocId = resolveSignalDocIdForIntent({
      exchange,
      symbol,
      tf,
      barCloseMs: signalBarCloseMsForIntent,
      event: s.event,
      signalId: s.signal_id || (s.features && s.features.signal_id),
      features: s.features,
    });
    if (signalDocId) s.signal_doc_id = signalDocId;
    if (signalQueueEnabled && Number.isFinite(lateByBars) && lateByBars > signalQueueMaxLateBars) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_STALE_SIGNAL",
        drop_reason_code: "DROP_STALE_SIGNAL",
        features_json: { ...(s.features || {}), late_by_bars: lateByBars, max_late_bars: signalQueueMaxLateBars },
        event_intent: intent,
      });
      continue;
    }

    if (spikeLock && spikeLock.active && (intent === "ENTRY" || intent === "ADD")) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_SPIKE_LOCK",
        drop_reason_code: "DROP_SPIKE_LOCK",
        features_json: { ...(s.features || {}), spike_lock_until_ms: spikeLock.untilMs ?? null, spike_lock_tf: spikeLock.tf || null, spike_lock_move_pct: spikeLock.movePct ?? null },
        event_intent: intent,
      });
      continue;
    }

    if (signalOverlapEnabled && (intent === "ENTRY" || intent === "ADD") && intentDir && Number.isFinite(signalTfMs) && signalOverlapBars > 0) {
      const lastKey = `last_entry_bar_ms_${String(intentDir).toLowerCase()}`;
      const lastBarMs = Number(posMeta && posMeta[lastKey]);
      const currentTier = resolveSignalTierFromEvent(s.event, s.features);
      const lastTierKey = `last_entry_tier_${String(intentDir).toLowerCase()}`;
      const lastTier = Number(posMeta && posMeta[lastTierKey]);
      const isCoreRealOrEarlyEvent = String(s.event || "").toUpperCase().startsWith("CORE_")
        || String(s.event || "").toUpperCase().startsWith("REAL_")
        || isPreRealOrEarlyEventName(s.event, s.features);
      const allowOverlapUpgrade = (Number.isFinite(currentTier) && Number.isFinite(lastTier) && currentTier > lastTier)
        || isCoreRealOrEarlyEvent;
      if (shouldBlockSignalOverlap({ pos, lastBarMs, effectiveBarMs, signalTfMs, signalOverlapBars, allowOverlapUpgrade })) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_OVERLAP",
          drop_reason_code: "DROP_OVERLAP",
          features_json: { ...(s.features || {}), overlap_bars: signalOverlapBars, last_entry_bar_ms: lastBarMs },
          event_intent: intent,
        });
        continue;
      }
    }

    if (autoScore && autoScore.enabled && Number.isFinite(autoScore.scoreMin) && (intent === "ENTRY" || intent === "ADD")) {
      const score = pickSignalScore(s.features);
      if (Number.isFinite(score) && score < autoScore.scoreMin) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_LOW_SCORE",
          drop_reason_code: "DROP_LOW_SCORE",
          features_json: { ...(s.features || {}), score, score_min: autoScore.scoreMin, score_base: autoScore.base ?? null, score_target_wr: autoScore.target ?? null, score_win_rate: autoScore.winRate ?? null },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry && shortGateCfg && shortGateCfg.enabled) {
      const shortGate = evaluateShortEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: shortGateCfg,
      });
      if (!shortGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: shortGate.reason || "DROP_SHORT_GATE",
          drop_reason_code: shortGate.reason || "DROP_SHORT_GATE",
          features_json: { ...(s.features || {}), ...(shortGate.detail || {}), gate_enabled: true, short_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      if (shortGate.detail && shortGate.detail.gate_transition_exception) {
        s.features = { ...(s.features || {}), ...(shortGate.detail || {}), gate_enabled: true, short_gate_enabled: true };
      }
    }

    const features = (s.features && typeof s.features === "object") ? { ...s.features } : {};
    if (intentIsEntry && !manualRetryIntent) {
      const canonical = evaluateCanonicalEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        sysCfg: sysCfgEffective,
        market: s.symbol_or_pair_id || symbol,
        tf: signalTf,
      });
      if (!canonical.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          drop_reason_code: canonical.reason || "DROP_CANONICAL_ENGINE",
          features_json: { ...(s.features || {}), ...(canonical.detail || {}) },
          event_intent: intent,
        });
        continue;
      }
      if (canonical.detail) {
        s.features = mergeCanonicalDecisionDetail(s.features, canonical.detail);
        Object.assign(features, canonical.detail || {});
      }
      const quality = evaluateEntryQualityGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: entryQualityCfg,
      });
      if (!quality.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: quality.reason || "DROP_ENTRY_QUALITY",
          drop_reason_code: quality.reason || "DROP_ENTRY_QUALITY",
          features_json: { ...(s.features || {}), ...(quality.detail || {}) },
          event_intent: intent,
        });
        continue;
      }
    }

    // Commission Gate v2 soft mode + MDD reduction gate — signal processing
    if (intentIsEntry) {
      try {
        const perfGate = await loadPerformanceGate(exchange);
        const gateEvidence = logCommissionGateEvidence({ phase: "signal_proc", exchange, symbol, event: s.event, perfGate, intentId: s.signal_id || s.id });
        const commScale = resolveCommissionSoftScale(perfGate);
        if (commScale.blocked && commScale.scale < 0.9999) {
          const before = qtyFraction;
          qtyFraction = qtyFraction * commScale.scale;
          if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: effectiveBarMs,
              qty_pct: before,
              reason: "DROP_COMMISSION_GATE_ZERO_QTY",
              drop_reason_code: "DROP_COMMISSION_GATE_ZERO_QTY",
              features_json: { ...(s.features || {}), gate_id: gateEvidence.gateId, commission_ratio: perfGate.commissionRatio, commission_threshold: COMMISSION_RATIO_THRESHOLD, commission_scale: commScale.scale, total_fee: perfGate.totalFee, total_pnl: perfGate.totalPnl },
              event_intent: intent,
            });
            continue;
          }
          s.features = {
            ...(s.features || {}),
            gate_id: gateEvidence.gateId,
            commission_ratio: perfGate.commissionRatio,
            commission_threshold: COMMISSION_RATIO_THRESHOLD,
            commission_scale: commScale.scale,
            commission_scaled_in_signal: true,
            total_fee: perfGate.totalFee,
            total_pnl: perfGate.totalPnl,
          };
          console.warn(`[COMMISSION_GATE][SOFT_REDUCE] signal ${exchange} ${symbol} ${s.event} | qty ${before.toFixed(4)} -> ${qtyFraction.toFixed(4)} | scale=${commScale.scale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
        }
        if (perfGate.mddBlocked && perfGate.mddReduceFactor < 1) {
          const before = qtyFraction;
          qtyFraction = qtyFraction * perfGate.mddReduceFactor;
          s.features = {
            ...(s.features || {}),
            mdd: perfGate.mdd,
            mdd_threshold: MDD_THRESHOLD,
            mdd_reduce_factor: perfGate.mddReduceFactor,
            mdd_scaled_in_signal: true,
          };
          console.log(`[MDD_REDUCE] ${exchange} ${symbol} ${s.event} | mdd=${(perfGate.mdd * 100).toFixed(2)}% < ${(MDD_THRESHOLD * 100).toFixed(0)}% | qty ${before.toFixed(4)} → ${qtyFraction.toFixed(4)} (x${perfGate.mddReduceFactor})`);
        }
      } catch (gateErr) {
        console.error("[COMMISSION_GATE][EXCEPTION]", { phase: "signal_proc", exchange, symbol, event: s.event, error: gateErr.message, enforce: COMMISSION_GATE_ENFORCE });
        if (COMMISSION_GATE_ENFORCE) {
          signalDrops.push({
            ...s, bar_close_time_utc_ms: effectiveBarMs, qty_pct: qtyFraction,
            reason: "DROP_COMMISSION_GATE_ERROR", drop_reason_code: "DROP_COMMISSION_GATE_ERROR",
            features_json: { ...(s.features || {}), gate_error: gateErr.message },
            event_intent: intent,
          });
          continue;
        }
      }
    }

    let immediateEntry = false;
    let immediateReason = null;
    let coreProbePatch = null;
    let coreProbeClear = null;
    if (signalDocId && !features.signal_doc_id) {
      features.signal_doc_id = signalDocId;
    }
    const isTpP1Event = eventUpper === "EXIT_TP_P1" || eventUpper.startsWith("EXIT_TP_P1_");
    if (isTpP1Event && posMeta && posMeta.tp_p1_done === true) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_TP_P1_ALREADY_DONE",
        drop_reason_code: "DROP_TP_P1_ALREADY_DONE",
        features_json: { ...(s.features || {}), tp_p1_done: true },
        event_intent: intent,
      });
      continue;
    }
    if (isTpP1Event && posMeta && posMeta.tp_p1_pending === true) {
      const pendingRefMs = Date.now();
      const pendingState = await getTpP1PendingState({
        exchange,
        symbol,
        tf: signalTf,
        posMeta,
        tpP1PendingHoldMs,
        nowMs: pendingRefMs,
      });
      if (pendingState.active) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_TP_P1_PENDING",
          drop_reason_code: "DROP_TP_P1_PENDING",
          features_json: {
            ...(s.features || {}),
            tp_p1_pending: true,
            tp_p1_pending_at_ms: pendingState.pendingAtMs,
            tp_p1_pending_until_ms: pendingState.pendingUntilMs,
            tp_p1_pending_active_by_intent: pendingState.activeByIntent,
          },
          event_intent: intent,
        });
        continue;
      }
      metaUpdates.tp_p1_pending = false;
      metaUpdates.tp_p1_pending_at_ms = null;
      metaUpdates.tp_p1_pending_until_ms = null;
      metaUpdates.tp_p1_pending_event = null;
    }
    const signalTimingTier = resolveSignalTier(eventUpper, s.features);
    const isRealEvent = signalTimingTier === "REAL";
    const isPreRealEvent = signalTimingTier === "PRE_REAL";
    const isCoreEvent = signalTimingTier === "CORE";
    const isEarlyEvent = signalTimingTier === "EARLY";
    if (intentIsEntry && isAiRequired(exchange) && !hasAiSignal(s.features)) {
      const aiMissing = resolveAiMissingPolicy({ qtyFraction, features: s.features, sysCfg });
      if (aiMissing.drop) {
        const reason = aiMissing.reason || "DROP_AI_MISSING";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: aiMissing.features,
          event_intent: intent,
        });
        continue;
      }
      const prevQty = qtyFraction;
      qtyFraction = Number(aiMissing.qtyFraction);
      s.features = aiMissing.features;
      if (Number.isFinite(prevQty) && Number.isFinite(qtyFraction) && qtyFraction < prevQty) {
        console.warn(
          `[AI_MISSING][REDUCE] ${exchange} ${symbol} ${s.event} | qty ${prevQty.toFixed(4)} -> ${qtyFraction.toFixed(4)} | scale=${Number(aiMissing.features && aiMissing.features.ai_missing_reduce_pct || AI_MISSING_REDUCE_PCT).toFixed(4)}`
        );
      }
    }

    if (intentIsEntry && aiBiasGateCfg && aiBiasGateCfg.enabled) {
      const aiBiasGate = evaluateAiBiasEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: aiBiasGateCfg,
        riskBudget,
      });
      if (aiBiasGate.detail) {
        s.features = { ...(s.features || {}), ...(aiBiasGate.detail || {}), ai_bias_gate_enabled: true };
        Object.assign(features, aiBiasGate.detail || {});
      }
      if (!aiBiasGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: aiBiasGate.reason || "DROP_AI_BIAS_GATE",
          drop_reason_code: aiBiasGate.reason || "DROP_AI_BIAS_GATE",
          features_json: { ...(s.features || {}), ...(aiBiasGate.detail || {}), ai_bias_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      const aiBiasScale = Number(aiBiasGate.qtyScale);
      if (Number.isFinite(aiBiasScale) && aiBiasScale > 0 && aiBiasScale < 0.9999) {
        const before = qtyFraction;
        qtyFraction = qtyFraction * aiBiasScale;
        s.features = {
          ...(s.features || {}),
          ai_bias_gate_qty_before: before,
          ai_bias_gate_qty_after: qtyFraction,
          market_bias_mult: aiBiasScale,
        };
        Object.assign(features, {
          ai_bias_gate_qty_before: before,
          ai_bias_gate_qty_after: qtyFraction,
          market_bias_mult: aiBiasScale,
        });
      }
    }

    const evGateBypass = shouldBypassEvEntryGate({ intent, features: s.features });
    if (intentIsEntry && evGateCfg && evGateCfg.enabled && evGateBypass) {
      const evGateDetail = {
        ev_gate_enabled: true,
        ev_gate_skipped: true,
        ev_gate_skip_reason: "MANUAL_RETRY_OVERRIDE",
        ev_gate_action: "SKIP",
        ev_gate_qty_scale: 1,
      };
      s.features = { ...(s.features || {}), ...evGateDetail };
      Object.assign(features, evGateDetail);
    }
    if (intentIsEntry && evGateCfg && evGateCfg.enabled && !evGateBypass) {
      let evExitProfile = null;
      try {
        evExitProfile = await resolveAdaptiveFuturesExitProfile({
          exchange,
          symbol,
          tf: signalTf,
          intent,
          event: s.event,
          side: s.side,
          features: s.features,
          nowMs: Number(effectiveBarMs),
          manualProfileMode: liveCfg && liveCfg.exitProfileMode,
        });
      } catch (evExitProfileErr) {
        const evGateDetail = {
          ev_gate_enabled: true,
          ev_gate_exit_profile_resolve_failed: true,
          ev_gate_exit_profile_error: evExitProfileErr && evExitProfileErr.message
            ? String(evExitProfileErr.message)
            : String(evExitProfileErr),
        };
        s.features = { ...(s.features || {}), ...evGateDetail };
        Object.assign(features, evGateDetail);
      }
      const evGateBaseQty = qtyFraction;
      const evExitRulesAdjustment = applyEntryExitRuleRuntimeAdjustments({
        rules: evExitProfile && evExitProfile.rules,
        features: s.features,
        sysCfg,
        cohort: resolveLiveMarketRegimeCohort({ symbol, posMeta }),
        market: symbol,
      });
      const evGate = await evaluateEvEntryGate({
        exchange,
        symbol,
        tf: signalTf,
        barCloseMs: effectiveBarMs,
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: evGateCfg,
        exitRules: evExitRulesAdjustment.appliedExitRules,
        exitProfile: evExitProfile && evExitProfile.profile,
        exitProfileReason: evExitProfile && evExitProfile.reason,
      });
      if (evGate.detail) {
        s.features = { ...(s.features || {}), ...(evGate.detail || {}), ev_gate_enabled: true };
        Object.assign(features, evGate.detail || {});
      }
      if (!evGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: evGate.reason || "DROP_EV_GATE",
          drop_reason_code: evGate.reason || "DROP_EV_GATE",
          features_json: { ...(s.features || {}), ...(evGate.detail || {}), ev_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      const evScale = Number(evGate.qtyScale);
      if (Number.isFinite(evScale) && evScale > 0 && evScale < 0.9999) {
        const evQtyScaleResult = applyEvQtyScale({
          qtyFraction,
          evScale,
          intent,
          event: s.event,
          features: s.features,
        });
        qtyFraction = evQtyScaleResult.qtyFraction;
        s.features = {
          ...(s.features || {}),
          ev_gate_qty_before: evGateBaseQty,
          ev_gate_qty_after: qtyFraction,
          ev_gate_qty_after_suggested: evQtyScaleResult.suggestedQtyFraction,
          ev_gate_qty_scale_applied: evQtyScaleResult.appliedScale,
          ev_gate_qty_scale_suggested: evQtyScaleResult.suggestedScale,
          ev_gate_qty_scale_suppressed_for_fixed: evQtyScaleResult.suppressedForFixed,
          ev_gate_qty_profile: evQtyScaleResult.qtyProfile,
          ev_mult: evQtyScaleResult.appliedScale,
        };
        Object.assign(features, {
          ev_gate_qty_before: evGateBaseQty,
          ev_gate_qty_after: qtyFraction,
          ev_gate_qty_after_suggested: evQtyScaleResult.suggestedQtyFraction,
          ev_gate_qty_scale_applied: evQtyScaleResult.appliedScale,
          ev_gate_qty_scale_suggested: evQtyScaleResult.suggestedScale,
          ev_gate_qty_scale_suppressed_for_fixed: evQtyScaleResult.suppressedForFixed,
          ev_gate_qty_profile: evQtyScaleResult.qtyProfile,
          ev_mult: evQtyScaleResult.appliedScale,
        });
      }
      s.features = {
        ...(s.features || {}),
        market_ev_base_qty: evGateBaseQty,
        market_ev_final_qty: qtyFraction,
        market_ev_final_mult: Number.isFinite(evGateBaseQty) && evGateBaseQty > 0 ? (qtyFraction / evGateBaseQty) : null,
      };
      Object.assign(features, {
        market_ev_base_qty: evGateBaseQty,
        market_ev_final_qty: qtyFraction,
        market_ev_final_mult: Number.isFinite(evGateBaseQty) && evGateBaseQty > 0 ? (qtyFraction / evGateBaseQty) : null,
      });
    }

    if (intentIsEntry && waitOneBarCfg && waitOneBarCfg.enabled) {
      const waitOneBar = evaluateWaitOneBarTiming({
        intent,
        intentDir,
        eventUpper,
        cfg: waitOneBarCfg,
        features: s.features,
      });
      if (waitOneBar.detail) {
        s.features = { ...(s.features || {}), ...(waitOneBar.detail || {}), wait_one_bar_enabled: true };
        Object.assign(features, waitOneBar.detail || {});
      }
      if (!waitOneBar.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          drop_reason_code: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          features_json: { ...(s.features || {}), ...(waitOneBar.detail || {}), wait_one_bar_enabled: true },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry) {
      const policyEval = evaluateLiveEntryPolicy({
        exchange,
        symbol,
        intent,
        qtyPct: qtyFraction,
        features: s.features,
        stage: "RUNNER_SIGNAL",
        applyScale: true,
      });
      if (policyEval && policyEval.featuresPatch && typeof policyEval.featuresPatch === "object") {
        s.features = policyEval.featuresPatch;
        Object.assign(features, policyEval.featuresPatch);
      }
      if (!policyEval || policyEval.ok !== true || !Number.isFinite(Number(policyEval.qtyPctFinal)) || Number(policyEval.qtyPctFinal) <= 0) {
        const reason = String(policyEval && policyEval.reason || "DROP_LIVE_POLICY_BLOCK").trim().toUpperCase() || "DROP_LIVE_POLICY_BLOCK";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: { ...(s.features || {}) },
          event_intent: intent,
        });
        continue;
      }
      qtyFraction = Number(policyEval.qtyPctFinal);
    }

    if (intentIsEntry && immediateCfg.enabled && (isRealEvent || isPreRealEvent || isCoreEvent || isEarlyEvent)) {
      const { coreBuy, realBuy, coreSell, realSell } = resolveScoreLevels({ exchange, features });
      const score = pickSignalScoreExtended(features);
      const confidence = pickSignalConfidence(features);
      const waveConf = pickSignalWaveConf(features);
      const conflict = pickSignalConflict(features);
      const regime = pickSignalRegime(features);
      const volRank = pickSignalVolRank(features);
      const volStrong = volRank === "ultra" || volRank === "strong";
      const dir = intentDir;

      if (isCoreEvent && dir) {
        const probe = getCoreProbeMeta(posMeta, dir);
        if (probe && Number.isFinite(probe.remaining) && probe.remaining > 0) {
          const expired = Number.isFinite(probe.expiresMs) && Number.isFinite(effectiveBarMs) && effectiveBarMs > probe.expiresMs;
          if (expired) {
            coreProbeClear = probe;
          } else if (Number.isFinite(signalTfMs) && Number.isFinite(probe.barMs) && Number.isFinite(effectiveBarMs)) {
            const barsSince = Math.round((effectiveBarMs - probe.barMs) / signalTfMs);
            if (barsSince >= 0 && barsSince <= 1) {
              qtyFraction = Math.min(qtyFraction, probe.remaining);
              coreProbeClear = probe;
              features._core_probe_confirm = true;
              immediateReason = "CORE_CONFIRM_NEXT_BAR";
            }
          }
        }
      }

      if (!immediateReason && isRealEvent && immediateCfg.realEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= (realBuy + immediateCfg.realScoreMargin) : score <= (realSell - immediateCfg.realScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minRealConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minWaveConf : false;
        const regimeOk = regime ? regime === "trend" : false;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && volStrong && conflictOk) {
          immediateEntry = true;
          immediateReason = "REAL_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }

      if (!immediateReason && isPreRealEvent && immediateCfg.preRealEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY"
            ? score >= (coreBuy + immediateCfg.preRealScoreMargin)
            : score <= (coreSell - immediateCfg.preRealScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minPreRealConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minPreRealWaveConf : false;
        const regimeOk = regime ? regime !== "range" : true;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && conflictOk) {
          immediateEntry = true;
          immediateReason = "PRE_REAL_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }

      if (!immediateEntry && !immediateReason && isCoreEvent && immediateCfg.coreEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= (coreBuy + immediateCfg.coreScoreMargin) : score <= (coreSell - immediateCfg.coreScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minCoreConf : false;
        const regimeOk = regime ? regime !== "range" : false;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && regimeOk && volStrong && conflictOk) {
          const fraction = immediateCfg.coreFraction;
          const immediateQty = qtyFraction * fraction;
          const remainingQty = qtyFraction - immediateQty;
          if (Number.isFinite(immediateQty) && immediateQty > 0 && Number.isFinite(remainingQty) && remainingQty > 0) {
            qtyFraction = immediateQty;
            immediateEntry = true;
            immediateReason = "CORE_IMMEDIATE_PROBE";
            coreProbePatch = {
              remaining: remainingQty,
              barMs: Number.isFinite(effectiveBarMs) ? effectiveBarMs : null,
              expiresMs: Number.isFinite(signalTfMs) && Number.isFinite(effectiveBarMs)
                ? (effectiveBarMs + signalTfMs)
                : null,
            };
            features._core_probe_fraction = fraction;
            features._entry_exec_timing = "IMMEDIATE";
          }
        }
      }

      if (!immediateEntry && !immediateReason && isEarlyEvent && immediateCfg.earlyEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= immediateCfg.earlyScoreAbs : score <= -immediateCfg.earlyScoreAbs)
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minEarlyConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minEarlyWaveConf : false;
        const regimeOk = regime ? regime !== "range" : true;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && conflictOk) {
          immediateEntry = true;
          immediateReason = "EARLY_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }
    }

    if (coreProbeClear && coreProbeClear.base) {
      metaUpdates[`${coreProbeClear.base}_remaining_pct`] = 0;
      metaUpdates[`${coreProbeClear.base}_bar_ms`] = null;
      metaUpdates[`${coreProbeClear.base}_expires_ms`] = null;
    }

    if (coreProbePatch && intentDir) {
      const base = `core_probe_${String(intentDir).toLowerCase()}`;
      metaUpdates[`${base}_remaining_pct`] = coreProbePatch.remaining;
      metaUpdates[`${base}_bar_ms`] = coreProbePatch.barMs;
      metaUpdates[`${base}_expires_ms`] = coreProbePatch.expiresMs;
    }

    if (intentDir && (intent === "ENTRY" || intent === "ADD") && Number.isFinite(effectiveBarMs)) {
      const lastKey = `last_entry_bar_ms_${String(intentDir).toLowerCase()}`;
      metaUpdates[lastKey] = effectiveBarMs;
      const tier = resolveSignalTierFromEvent(s.event, s.features);
      if (Number.isFinite(tier)) {
        const tierKey = `last_entry_tier_${String(intentDir).toLowerCase()}`;
        const prevTier = Number(posMeta && posMeta[tierKey]);
        metaUpdates[tierKey] = Number.isFinite(prevTier) ? Math.max(prevTier, tier) : tier;
      }
    }

    // 서버 내부 최초 신호는 같은 바의 외부 webhook이 있어도 authoritative로 승격한다.
    if (!s.signal_id) {
      const savedSignal = await upsertSignal({
        exchange,
        symbol,
        tf,
        barCloseTimeUtc: signalBarCloseUtcForIntent,
        barCloseTimeUtcMs: signalBarCloseMsForIntent,
        event: s.event,
        side: s.side,
        qtyPct: qtyFraction,
        reason: s.reason || "INTERNAL_SIGNAL",
        features,
        executionMode: intentExecutionMode,
        source: "SERVER",
        authoritative: true,
        runId,
        decisionReason: s.reason || "INTERNAL_SIGNAL",
      });
      if (savedSignal && savedSignal.signal_id) {
        s.signal_id = savedSignal.signal_id;
        if (!s.signal_doc_id) s.signal_doc_id = savedSignal.signal_id;
        if (!features.signal_id) features.signal_id = savedSignal.signal_id;
        if (!features.signal_doc_id) features.signal_doc_id = s.signal_doc_id;
      }
      if (savedSignal && savedSignal.signal_id && (savedSignal.decision === "CREATED" || savedSignal.decision === "UPDATED_CHANGED")) {
        sendSignalReceivedAlert({
          exchange,
          symbol,
          tf,
          event: s.event,
          side: s.side,
          qtyPct: qtyFraction,
          reason: s.reason || "INTERNAL_SIGNAL",
          signalId: savedSignal.signal_id,
          executionMode: intentExecutionMode,
          source: "SERVER",
          authoritative: true,
        }).catch((err) => {
          console.warn("[SIGNAL_RECEIVED_ALERT_FAIL]", err?.message || err);
        });
      }
    }

    const isImmediateExit = exitImmediateEnabled && intent === "EXIT";
    const isExternalSignal = !!s.signal_id;
    const execOnCurrentBar = intentIsEntry && isExternalSignal && Number.isFinite(effectiveBarMs) && Number.isFinite(execBarCloseMs)
      && effectiveBarMs <= execBarCloseMs;
    const isImmediateEntry = immediateEntry === true || execOnCurrentBar;
    if (execOnCurrentBar && features._entry_exec_timing == null) {
      features._entry_exec_timing = "EXEC_CURRENT_BAR";
    }
    const nextExecMsFromSignal = (Number.isFinite(execTfMs) && Number.isFinite(signalBarCloseMsForIntent))
      ? addMs(signalBarCloseMsForIntent, execTfMs)
      : nextExecMs;
    const execBarCloseMsForIntent = (isImmediateExit || isImmediateEntry)
      ? execBarCloseMs
      : (Number.isFinite(nextExecMsFromSignal) ? Math.max(nextExecMsFromSignal, execBarCloseMs) : nextExecMs);
    const execBarCloseUtcForIntent = Number.isFinite(execBarCloseMsForIntent)
      ? msToUtcZ(execBarCloseMsForIntent)
      : execBarCloseUtc;
    // EXIT_ONLY tick loop retries must not reuse a canceled hourly intent id.
    const intentSignalBarCloseMs = (isImmediateExit && backfillExitOnly === true && Number.isFinite(execBarCloseMsForIntent))
      ? Number(execBarCloseMsForIntent)
      : signalBarCloseMsForIntent;
    const intentSignalBarCloseUtc = Number.isFinite(intentSignalBarCloseMs)
      ? msToUtcZ(intentSignalBarCloseMs)
      : signalBarCloseUtcForIntent;
    const pendingReason = isImmediateExit
      ? "IMMEDIATE_EXEC"
      : (isImmediateEntry ? (execOnCurrentBar ? "EXEC_CURRENT_BAR" : (immediateReason || "IMMEDIATE_ENTRY")) : "WAIT_NEXT_BAR");
    const pendingNote = (isImmediateExit || isImmediateEntry)
      ? `immediate_exec=${execBarCloseUtcForIntent}`
      : `next_exec=${execBarCloseUtcForIntent}`;
    if (intent === "EXIT") {
      const linkedEntryEventId = String(
        (features.entry_event_id || posMeta.entry_event_id || "")
      ).trim();
      const linkedEntrySignalType = String(
        (features.entry_signal_type || posMeta.entry_signal_type || "")
      ).toUpperCase();
      const linkedEntryGrade = String(
        (features.entry_grade || posMeta.entry_grade || posMeta.entry_timing_tier || "")
      ).toUpperCase();
      const linkedEntryQtyProfile = String(
        (features.entry_qty_profile || posMeta.entry_qty_profile || posMeta.entry_qty_tier || "")
      ).toUpperCase();
      if (linkedEntryEventId && !features.entry_event_id) features.entry_event_id = linkedEntryEventId;
      if (linkedEntrySignalType && !features.entry_signal_type) features.entry_signal_type = linkedEntrySignalType;
      if (linkedEntryGrade && !features.entry_grade) features.entry_grade = linkedEntryGrade;
      if (linkedEntryQtyProfile && !features.entry_qty_profile) features.entry_qty_profile = linkedEntryQtyProfile;
    }

    if (isTpP1Event && intent === "EXIT") {
      const pendingAtMs = Date.now();
      metaUpdates.tp_p1_pending = true;
      metaUpdates.tp_p1_pending_at_ms = Number.isFinite(pendingAtMs) ? pendingAtMs : null;
      metaUpdates.tp_p1_pending_until_ms = Number.isFinite(pendingAtMs) ? (pendingAtMs + tpP1PendingHoldMs) : null;
      metaUpdates.tp_p1_pending_event = s.event;
    }

    if (isImmediateEntry || immediateReason === "CORE_CONFIRM_NEXT_BAR") {
      console.log(
        `[immediate_entry] ex=${exchange} sym=${symbol} tf=${tf} ev=${s.event} side=${s.side} qty=${qtyFraction} reason=${execOnCurrentBar ? "EXEC_CURRENT_BAR" : (immediateReason || "IMMEDIATE_ENTRY")} sched=${execBarCloseUtcForIntent}`
      );
    }
    if (!isImmediateExit && !isImmediateEntry && isExternalSignal && intentIsEntry) {
      console.log(
        `[intent_scheduled] ex=${exchange} sym=${symbol} tf=${tf} ev=${s.event} side=${s.side} qty=${qtyFraction} reason=${pendingReason} sched=${execBarCloseUtcForIntent}`
      );
    }

    await upsertIntent({
      exchange,
      symbol,
      tf,
      signalBarCloseTimeUtc: intentSignalBarCloseUtc,
      signalBarCloseTimeUtcMs: intentSignalBarCloseMs,
      scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
      scheduledExecBarCloseUtcMs: execBarCloseMsForIntent,
      event: s.event,
      side: s.side,
      qtyPct: qtyFraction,
      reason: s.reason || "SIGNAL",
      features,
      signalId: s.signal_id || (features && features.signal_id) || null,
      runId,
      executionMode: intentExecutionMode,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: useBudget ? (riskBudget.maxKrw * qtyFraction) : null,
      qtyFraction: useBudget ? qtyFraction : null,
      signalPrice: Number(bar && (bar.close ?? bar.c)),
      signalDocId,
      pendingReason,
      pendingNote,
      ttlMs,
      execTf: execTfFinal,
      decisionReason: s.reason || "INTENT_CREATED",
    });

    sendSignalProgressAlert({
      exchange,
      symbol,
      tf,
      event: s.event,
      side: s.side,
      qtyPct: qtyFraction,
      signalId: s.signal_id || (features && features.signal_id) || null,
      executionMode: intentExecutionMode,
      source: "SERVER",
      authoritative: true,
      progressReason: "INTENT_CREATED",
      pendingReason,
      scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
    }).catch((err) => {
      console.warn("[SIGNAL_PROGRESS_ALERT_FAIL]", err?.message || err);
    });

    // external signal consumed mark (operational-B)
    if (s.signal_id) {
      const lock = await tryLockSignal({ signalId: s.signal_id, runId });
      if (lock && lock.ok) {
        await markSignalConsumed({
          signalId: s.signal_id,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs: execBarCloseMsForIntent,
          execBarCloseUtc: execBarCloseUtcForIntent,
          reason: "INTENT_CREATED",
          meta: { intent: intent || null },
        });
      }
    }


    intentsCreated += 1;
    if (isImmediateEntry) immediateIntentsCreated += 1;
  }
  if (signalDrops.length) {
    await recordSignalDrops({
      exchange,
      symbol,
      tf: signalTf,
      runId,
      drops: signalDrops.map((d) => ({
        ...d,
        execution_mode: intentExecutionMode,
        signal_id: d.signal_id || (d.features_json && d.features_json.signal_id) || (d.features && d.features.signal_id) || null,
        signal_doc_id: d.signal_doc_id || (d.features_json && d.features_json.signal_doc_id) || (d.features && d.features.signal_doc_id) || null,
      })),
    });
    await consumeDroppedSignals({
      drops: signalDrops,
      runId,
      execBarCloseMs,
      execBarCloseUtc,
    });
  }

  if (Object.keys(metaUpdates).length) {
    const merged = mergeMeta(posMeta, metaUpdates);
    await upsertPosition({
      exchange,
      symbol,
      state: pos.state,
      positionSide: pos.position_side || posSideNow || null,
      sizePct: pos.size_pct,
      avgPrice: pos.avg_price,
      qtyBase: pos.qty_base ?? null,
      runId,
      executionMode: intentExecutionMode,
      budgetMaxKrw: pos.budget_max_krw ?? null,
      budgetUsedKrw: pos.budget_used_krw ?? null,
      budgetSource: pos.budget_source ?? null,
      meta: merged,
    });
    posMeta = merged;
  }

  if (exitImmediateEnabled || immediateIntentsCreated > 0) {
    const immediateIntents = await listPendingIntentsForExec({
      exchange,
      symbol,
      tf: signalTf,
      execBarCloseMs,
      limitN: 50,
    });
    if (Array.isArray(immediateIntents) && immediateIntents.length) {
      await executeIntentList(sortIntentsForExecution(immediateIntents));
      pos = await getPosition({ exchange, symbol });
      posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : posMeta;
      posQtyBase = resolvePosQtyBase(pos);
    }
  }

  const trailUpdates = computeTrailingMetaUpdate({ exchange, bar, position: pos, posMeta, positionSideFallback: posSideNow });
  if (trailUpdates) {
    const merged = mergeMeta(posMeta, trailUpdates);
    await upsertPosition({
      exchange,
      symbol,
      state: pos.state,
      positionSide: pos.position_side || posSideNow || null,
      sizePct: pos.size_pct,
      avgPrice: pos.avg_price,
      qtyBase: pos.qty_base ?? null,
      runId,
      executionMode: intentExecutionMode,
      budgetMaxKrw: pos.budget_max_krw ?? null,
      budgetUsedKrw: pos.budget_used_krw ?? null,
      budgetSource: pos.budget_source ?? null,
      meta: merged,
    });
    posMeta = merged;
  }

  return {
    fills_executed: fillsExecuted,
    intents_created: intentsCreated,
    signals_seen: signals.length,
    signals_external: externalSignals.length,
    signals_internal: internalSignals.length,
    signals_external_late: lateSignals,
    signal_drop_n: signalDrops.length,
    signal_drop_reason_counts: signalDrops.reduce((acc, row) => {
      const reason = String(row && (row.drop_reason_code || row.reason) || "UNKNOWN");
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {}),
    top_signal_drop_reason: signalDrops.length
      ? Object.entries(signalDrops.reduce((acc, row) => {
        const reason = String(row && (row.drop_reason_code || row.reason) || "UNKNOWN");
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {})).sort((a, b) => b[1] - a[1])[0][0]
      : null,
  };
}

async function runPaperFuturesForBar({
  runId,
  exchange,
  symbol,
  tf,
  execTf,
  barCloseUtc,
  barCloseMs,
  bar,
  gate,
  trading_mode,
  backfillExitOnly,
  backfillAllowEntry,
} = {}) {
  const signalTf = String(tf || defaultExecTfFromEnv() || "15m");
  const execTfFinal = String(execTf || signalTf);
  const signalTfMs = tfToMs(signalTf);
  const execTfMs = tfToMs(execTfFinal);
  const tpP1PendingHoldMs = resolveTpP1PendingHoldMs();
  const execProfile = await resolveExecutionProfile({ symbol, bar, exchange });
  const { feeBps, slippageBps } = execProfile;
  const riskBudget = await resolveRiskBudget(symbol, exchange);
  const useBudget = riskBudget && riskBudget.enabled === true;
  const exUpper = String(exchange || "").toUpperCase();
  const liveCfg = await resolveLiveFuturesConfig({ exchange, symbol });
  const leverage = FUTURES_BASE_LEVERAGE;
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const sysCfg = (sys && sys.data) ? sys.data : {};
  const sysCfgEffective = resolveImmediateDefaultsForExchange(sysCfg, exchange);
  const rescueAddCfg = resolveLiveRescueAddConfig(sysCfgEffective, exchange);
  const forceAllSignalsAdd = resolveForceAllSignalsAdd(sysCfgEffective, exchange);
  const autoScore = await resolveAutoScoreMin({ exchange, sysCfg: sysCfgEffective });
  const signalOverlapEnabled = forceAllSignalsAdd ? false : normalizeBool(sysCfg.signal_overlap_enabled, true);
  const signalOverlapBars = forceAllSignalsAdd ? 0 : Math.max(0, normalizeInt(sysCfg.signal_overlap_bars, 2));
  const signalQueueEnabled = normalizeBool(sysCfg.signal_queue_enabled, true);
  const defaultLateBars = exUpper.includes("BINANCEFUT") ? 6 : 1;
  const configuredLateBars = normalizeInt(sysCfg.signal_queue_max_late_bars, defaultLateBars);
  const signalQueueMaxLateBars = Math.max(defaultLateBars, Math.max(0, configuredLateBars));
  const exitImmediateEnabled = normalizeBool(
    process.env.EXIT_IMMEDIATE_ENABLED,
    normalizeBool(sysCfg.exit_immediate_enabled, true)
  );
  const immediateCfg = resolveImmediateEntryConfig(sysCfgEffective);
  const shortGateCfg = resolveShortEntryGateConfig(sysCfgEffective, exchange);
  const aiBiasGateCfg = resolveAiBiasEntryGateConfig(sysCfgEffective, exchange);
  const evGateCfg = resolveEvGateConfig(sysCfgEffective, exchange, symbol);
  const waitOneBarCfg = resolveWaitOneBarConfig(sysCfgEffective, exchange);
  const entryQualityCfg = resolveEntryQualityGateConfig(sysCfgEffective, exchange);
  const addRiskCfgRaw = resolveAddRiskConfig(sysCfgEffective, exchange);
  const addRiskCfg = forceAllSignalsAdd ? { ...addRiskCfgRaw, enabled: false } : addRiskCfgRaw;
  const tradeableSignalTypes = resolveTradeableSignalTypes(sysCfgEffective, exchange);
  const binanceFutOnly = exUpper.includes("BINANCEFUT");
  const hasImmediateStage =
    immediateCfg.realEnabled || immediateCfg.preRealEnabled || immediateCfg.coreEnabled || immediateCfg.earlyEnabled;
  const signalQueueLookaheadBars = (binanceFutOnly && immediateCfg.enabled && hasImmediateStage)
    ? Math.max(0, Math.min(1, Number(immediateCfg.lookaheadBars) || 0))
    : 0;
  const maxHoldBars = binanceFutOnly ? resolveBinanceMaxHoldBars(sysCfgEffective, signalTfMs) : 0;
  const sameDirectionTrailProfitCooldownCfg = resolveSameDirectionTrailProfitCooldownConfig(sysCfgEffective);

  let pos = await getPosition({ exchange, symbol });
  if (liveCfg && (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")) {
    try {
      const forceRefresh = shouldForceFuturesRefresh(symbol);
      const sync = await syncBinanceFuturesPosition({
        runId,
        exchange,
        symbol,
        riskBudget,
        liveCfg,
        forceRefresh,
      });
      if (sync && sync.ok && sync.position) {
        pos = sync.position;
      }
    } catch (e) {
      console.warn("[FUT_POS_SYNC_FAIL]", {
        exchange,
        symbol,
        mode: liveCfg.executionMode,
        error: e && e.message ? e.message : String(e),
      });
    }
  }
  let posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
  const oppositeCooldownWindow = binanceFutOnly
    ? resolveOppositeCooldownWindowFromPosition({ sysCfg: sysCfgEffective, position: pos })
    : { bars: 0, timeMs: 0, cohort: null };
  const oppositeCooldownBars = binanceFutOnly ? oppositeCooldownWindow.bars : 0;
  const oppositeTimeCooldownMs = binanceFutOnly ? oppositeCooldownWindow.timeMs : 0;
  let posSide = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
  );
  if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
  let posQtyBase = resolvePosQtyBase(pos);
  const spikeLock = await resolveSignalSpikeLock({ exchange, symbol, barCloseMs, pos, sysCfg });
  let pendingMetaPatch = null;
  if (spikeLock && spikeLock.active && Number.isFinite(spikeLock.untilMs)) {
    const prevUntil = Number(posMeta.spike_lock_until_ms);
    if (!Number.isFinite(prevUntil) || spikeLock.untilMs > prevUntil) {
      pendingMetaPatch = mergeMeta(pendingMetaPatch, {
        spike_lock_until_ms: spikeLock.untilMs,
        spike_lock_set_ms: Number(barCloseMs),
        spike_lock_reason: spikeLock.reason || "SPIKE_DETECTED",
        spike_lock_move_pct: spikeLock.movePct ?? null,
        spike_lock_tf: spikeLock.tf || null,
      });
    }
  }
  if (pendingMetaPatch) posMeta = mergeMeta(posMeta, pendingMetaPatch);

  const execBarCloseMs = Number(barCloseMs);
  const execBarCloseUtc = barCloseUtc;

  try {
    await cancelExpiredPendingIntents({ exchange, symbol, tf: signalTf, lookbackLimit: 600 });
  } catch (e) {
    console.warn("[INTENT_EXPIRE_CANCEL_FAIL_FUT]", {
      exchange,
      symbol,
      tf: signalTf,
      error: e && e.message ? e.message : String(e),
    });
  }

  let intents = await listPendingIntentsForExec({
    exchange,
    symbol,
    tf: signalTf,
    execBarCloseMs,
    limitN: 50,
  });
  try {
    const overdue = await listPendingIntentsOverdue({
      exchange,
      symbol,
      tf: signalTf,
      execBarCloseMs,
      limitN: 20,
      lookbackLimit: 600,
    });
    if (Array.isArray(overdue) && overdue.length) {
      const seen = new Set(intents.map((x) => x.intent_id || x.id));
      overdue.forEach((x) => {
        const id = x.intent_id || x.id;
        if (id && !seen.has(id)) intents.push(x);
      });
    }
  } catch (e) {
    console.warn("[INTENT_OVERDUE_FETCH_FAIL_FUT]", {
      exchange,
      symbol,
      tf: signalTf,
      error: e && e.message ? e.message : String(e),
    });
  }

  const budgetTotals = useBudget ? await computeTotalBudgetUsage(riskBudget, exchange) : { totalMaxKrw: null, totalUsedKrw: null };
  const totalMaxKrw = budgetTotals.totalMaxKrw;
  let totalUsedKrw = budgetTotals.totalUsedKrw;

  let fillsExecuted = 0;
  const attemptAt = new Date().toISOString();

  const executeIntentList = async (intentsList) => {
    for (const it of intentsList) {
    const schedMs = Number(it.scheduled_exec_bar_close_time_utc_ms);
    const isOverdue = Number.isFinite(schedMs) && Number.isFinite(execBarCloseMs) && schedMs < execBarCloseMs;
    await patchIntent(it.intent_id, {
      last_attempt_at: attemptAt,
      last_attempt_bar_close_time_utc: execBarCloseUtc,
      last_attempt_bar_close_time_utc_ms: execBarCloseMs,
      ...(isOverdue ? { pending_reason: "LATE_EXEC", pending_note: `late_exec_from=${msToUtcZ(schedMs)}` } : {}),
    });

    const intent = intentFromSignal({ event: it.event, side: it.side, features: it.features_json });
    if (!intent) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "UNKNOWN_INTENT", status_reason: "UNKNOWN_INTENT" });
      continue;
    }

    const intentIsEntry = intent === "ENTRY" || intent === "ADD";
    const manualRetryIntent = intentIsEntry && isManualRetryFeatures(it.features_json);
    const manualRetryQtyBase = manualRetryIntent ? resolveManualRetryQtyBase(it.features_json) : null;
    let preQtyScale = 1;
    if (backfillExitOnly && intentIsEntry) {
      if (String(trading_mode || "").toUpperCase() === "EXIT_ONLY") {
        // Tick-exit loop must not consume/cancel entry intents; leave them for normal RUN cycle.
        continue;
      }
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BACKFILL_SKIP_ENTRY", status_reason: "BACKFILL_SKIP_ENTRY" });
      continue;
    }
    const allowTrailEntry = forceAllSignalsAdd || allowEntryDuringTrail({ event: it.event, features: it.features_json, posMeta });
    if (intentIsEntry && (posMeta && (posMeta.trail_active === true || posMeta.tp_p1_done === true)) && !allowTrailEntry) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_TRAIL_ACTIVE_NO_ADD", status_reason: "DROP_TRAIL_ACTIVE_NO_ADD" });
      continue;
    }
    if (!allowByTradingModeIntent(trading_mode, intent)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: `MODE_${trading_mode}`, status_reason: "TRADING_MODE" });
      continue;
    }
    // Commission Gate v2 soft mode — 시그널 품질 필터 이전에 평가 (intent execution)
    if (intentIsEntry) {
      try {
        const signalScaleFlags = resolveSignalScaledFlags(it.features_json);
        const perfGate = await loadPerformanceGate(exchange);
        const gateEvidence = logCommissionGateEvidence({ phase: "intent_exec_fut", exchange, symbol, event: it.event, perfGate, intentId: it.intent_id });
        const commScale = resolveCommissionSoftScale(perfGate);
        if (commScale.blocked && commScale.scale < 0.9999) {
          if (signalScaleFlags.commissionScaledInSignal) {
            console.log(`[COMMISSION_GATE][DEDUPE] intent_fut ${exchange} ${symbol} ${it.event} | skip_signal_applied=true signal_scale=${signalScaleFlags.commissionScale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
          } else {
            preQtyScale = preQtyScale * commScale.scale;
            console.warn(`[COMMISSION_GATE][SOFT_REDUCE] intent_fut ${exchange} ${symbol} ${it.event} | ratio=${(perfGate.commissionRatio * 100).toFixed(1)}% threshold=${((perfGate.threshold || COMMISSION_RATIO_THRESHOLD) * 100).toFixed(0)}% | scale=${commScale.scale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
          }
        }
        if (perfGate.mddBlocked && perfGate.mddReduceFactor < 1) {
          if (signalScaleFlags.mddScaledInSignal) {
            console.log(`[MDD_REDUCE][DEDUPE] intent_fut ${exchange} ${symbol} ${it.event} | skip_signal_applied=true signal_factor=${signalScaleFlags.mddReduceFactor.toFixed(4)}`);
          } else {
            preQtyScale = preQtyScale * perfGate.mddReduceFactor;
            console.log(`[MDD_REDUCE] intent_fut ${exchange} ${symbol} ${it.event} | mdd=${(perfGate.mdd * 100).toFixed(2)}% | factor=${perfGate.mddReduceFactor}`);
          }
        }
      } catch (gateErr) {
        console.error("[COMMISSION_GATE][EXCEPTION]", { phase: "intent_exec_fut", exchange, symbol, event: it.event, error: gateErr.message, enforce: COMMISSION_GATE_ENFORCE });
        if (COMMISSION_GATE_ENFORCE) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_COMMISSION_GATE_ERROR", status_reason: "DROP_COMMISSION_GATE_ERROR" });
          continue;
        }
      }
    }
    const eventUpper = String(it.event || "").toUpperCase();
    const actionTag = normalizeActionValue(it.features_json && it.features_json.action);
    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: it.event })
      : directionFromSignal({ event: it.event, side: it.side });
    if (intentIsEntry && !actionAllowsEntry(actionTag)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_ACTION_FILTER", status_reason: "DROP_ACTION_FILTER" });
      continue;
    }
    if (intentIsEntry && !isTradeableEventAllowed({ eventUpper, intentDir, allowlist: tradeableSignalTypes })) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_TRADEABLE_SIGNAL_TYPES", status_reason: "DROP_TRADEABLE_SIGNAL_TYPES" });
      continue;
    }
    const features = (it.features_json && typeof it.features_json === "object") ? { ...it.features_json } : {};
    if (intentIsEntry) {
      const canonical = evaluateCanonicalEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: it.features_json,
        sysCfg: sysCfgEffective,
        market: it.symbol_or_pair_id || symbol,
        tf: signalTf,
      });
      if (!canonical.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          status_reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          cancel_note: canonical.detail ? JSON.stringify(canonical.detail) : undefined,
        });
        continue;
      }
      if (canonical.detail) {
        it.features_json = { ...(it.features_json || {}), ...(canonical.detail || {}) };
      }
      const quality = evaluateEntryQualityGate({
        intent,
        intentDir,
        eventUpper,
        features: it.features_json,
        cfg: entryQualityCfg,
      });
      if (!quality.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: quality.reason || "DROP_ENTRY_QUALITY",
          status_reason: quality.reason || "DROP_ENTRY_QUALITY",
          cancel_note: quality.detail ? JSON.stringify(quality.detail) : undefined,
        });
        continue;
      }
    }
    const bypassOppositeEntryCooldown = intentIsEntry
      && shouldBypassOppositeEntryCooldown({ features: it.features_json, intentDir, posMeta });
    if (intentIsEntry && oppositeCooldownBars > 0 && !bypassOppositeEntryCooldown) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const lastExitMs = Number(posMeta && posMeta.last_exit_bar_ms);
        const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
        const intentBarMs = Number(it.signal_bar_close_time_utc_ms) || Number(execBarCloseMs);
        if (Number.isFinite(lastExitMs) && lastExitDir && Number.isFinite(signalTfMs)) {
          const barsSinceExit = Math.floor((intentBarMs - lastExitMs) / signalTfMs);
          if (Number.isFinite(barsSinceExit) && barsSinceExit >= 0 && barsSinceExit <= oppositeCooldownBars) {
            if (intentDir && lastExitDir && intentDir !== lastExitDir) {
              await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_OPPOSITE_COOLDOWN", status_reason: "DROP_OPPOSITE_COOLDOWN" });
              continue;
            }
          }
        }
      }
    }
    // ── 시간 기반 절대 쿨다운: 방향 반전 시 최소 대기 시간 (타임프레임 무관) ──
    if (intentIsEntry && oppositeTimeCooldownMs > 0 && !bypassOppositeEntryCooldown) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const lastExitWallMs = Number(posMeta && posMeta.last_exit_wall_ms);
        const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
        if (Number.isFinite(lastExitWallMs) && lastExitDir && intentDir && lastExitDir !== intentDir) {
          const elapsedMs = resolveEventRefMs(it.signal_bar_close_time_utc_ms, execBarCloseMs) - lastExitWallMs;
          if (elapsedMs >= 0 && elapsedMs < oppositeTimeCooldownMs) {
            console.log(`[OPPOSITE_TIME_COOLDOWN] BLOCKED ${exchange} ${symbol} ${it.event} | dir=${intentDir} vs lastExit=${lastExitDir} | elapsed=${Math.floor(elapsedMs / 1000)}s < cooldown=${Math.floor(oppositeTimeCooldownMs / 1000)}s`);
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_OPPOSITE_TIME_COOLDOWN", status_reason: "DROP_OPPOSITE_TIME_COOLDOWN" });
            continue;
          }
        }
      }
    }
    if (intentIsEntry && sameDirectionTrailProfitCooldownCfg.enabled) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const sameDirectionCooldown = resolveSameDirectionTrailProfitCooldownBlock({
          cfg: sameDirectionTrailProfitCooldownCfg,
          posMeta,
          intentDir,
          eventRefMs: resolveEventRefMs(it.signal_bar_close_time_utc_ms, execBarCloseMs),
        });
        if (sameDirectionCooldown) {
          console.log(
            `[SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN] BLOCKED ${exchange} ${symbol} ${it.event} ` +
            `| dir=${intentDir} | elapsed=${Math.floor(sameDirectionCooldown.elapsed_ms / 1000)}s ` +
            `< cooldown=${Math.floor(sameDirectionCooldown.cooldown_ms / 1000)}s`
          );
          await markIntentStatus(it.intent_id, "CANCELED", {
            cancel_reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
            status_reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          });
          continue;
        }
      }
    }

    let qtyFraction = useBudget ? normalizeQtyFraction(it.qty_pct) : Number(it.qty_pct);
    const fixedQtyRestore = restoreFixedEntryQtyFraction({
      qtyFraction,
      intent,
      event: it.event,
      features: it.features_json,
    });
    if (fixedQtyRestore.restored) {
      qtyFraction = fixedQtyRestore.qtyFraction;
      it.features_json = {
        ...(it.features_json || {}),
        fixed_qty_ev_scale_restored: true,
        fixed_qty_original_qty_fraction: fixedQtyRestore.originalQtyFraction,
        fixed_qty_restored_qty_fraction: fixedQtyRestore.qtyFraction,
      };
    }
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_QTY", status_reason: "BAD_QTY" });
      continue;
    }
    const sideScaled = applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget });
    qtyFraction = sideScaled.qtyFraction;
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_QTY", status_reason: "BAD_QTY" });
      continue;
    }
    if (intentIsEntry && Number.isFinite(preQtyScale) && preQtyScale > 0 && preQtyScale < 0.9999) {
      qtyFraction = qtyFraction * preQtyScale;
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_COMMISSION_GATE_ZERO_QTY", status_reason: "DROP_COMMISSION_GATE_ZERO_QTY" });
        continue;
      }
    }
    if (intent === "ADD") {
      const addGuard = evaluateAddIntentRiskGuard({
        cfg: addRiskCfg,
        intent,
        position: pos,
        posMeta,
        bar,
        barCloseMs: execBarCloseMs,
        qtyFraction,
      });
      if (!addGuard.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: addGuard.reason || "DROP_ADD_GUARD",
          status_reason: addGuard.reason || "DROP_ADD_GUARD",
          cancel_note: addGuard.detail ? JSON.stringify(addGuard.detail) : undefined,
        });
        continue;
      }
      if (Number.isFinite(addGuard.qtyScale) && addGuard.qtyScale > 0 && addGuard.qtyScale < 0.9999) {
        qtyFraction *= addGuard.qtyScale;
      }
      if (useBudget) qtyFraction = normalizeQtyFraction(qtyFraction);
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_ADD_QTY_INVALID", status_reason: "DROP_ADD_QTY_INVALID" });
        continue;
      }
    }
    if (useBudget && qtyFraction > 1) {
      if (riskBudget.onExceed === "SKIP") {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "RISK_EXCEED_POLICY_SKIP", status_reason: "BUDGET_POLICY_SKIP" });
        continue;
      }
      qtyFraction = 1;
    }

    if (intentIsEntry) {
      const policyEval = evaluateLiveEntryPolicy({
        exchange,
        symbol,
        intent,
        qtyPct: qtyFraction,
        features: it.features_json,
        stage: "RUNNER_INTENT_EXEC",
        applyScale: false,
      });
      if (policyEval && policyEval.featuresPatch && typeof policyEval.featuresPatch === "object") {
        it.features_json = policyEval.featuresPatch;
      }
      if (!policyEval || policyEval.ok !== true) {
        const reason = String(policyEval && policyEval.reason || "LIVE_POLICY_BLOCK").trim().toUpperCase() || "LIVE_POLICY_BLOCK";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: reason, status_reason: reason });
        continue;
      }
    }

    let actionSide = null;
    let nextPosSide = posSide;
    let newSize = Number(pos.size_pct || 0);
    let newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
    let prevSize = newSize;
    const nextOpen = Number(bar.open);
    let fillPrice = null;
    let execPriceSource = "BAR_OPEN";
    let executionMode = "PAPER";
    let liveOrderId = null;
    let execQtyBase = null;
    let liveNotionalKrw = null;
    let avgPrevNotional = null;
    let avgNeedsUpdate = false;
    let liveAdjusted = false;
    let appliedLeverage = FUTURES_BASE_LEVERAGE;
    let appliedLeverageReason = null;
    const exitProfileSnapshot = resolvePositionExitProfile({
      posMeta,
      fallbackMode: liveCfg && liveCfg.exitProfileMode,
    });
    let appliedExitProfile = exitProfileSnapshot.profile === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
    let appliedExitProfileReason = exitProfileSnapshot.reason;
    let appliedExitRollbackActive = !!(posMeta && posMeta.exit_profile_rollback_active === true);
    let appliedExitRollbackUntilMs = Number.isFinite(Number(posMeta && posMeta.exit_profile_rollback_until_ms))
      ? Number(posMeta.exit_profile_rollback_until_ms)
      : null;
    let appliedExitRollbackReason = String((posMeta && posMeta.exit_profile_rollback_reason) || "").trim() || null;
    let appliedExitRules = cloneExitRules(exitProfileSnapshot.rules);
    let maxFractionAllowed = qtyFraction;
    let budgetMaxForIntent = Number(riskBudget && riskBudget.maxKrw);
    let leverageDecisionForIntent = null;
    let tierLeverageForBudget = FUTURES_BASE_LEVERAGE;

    if (intent === "ENTRY" || intent === "ADD") {
      const targetSide = intentDir || posSide;
      if (!targetSide) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "UNKNOWN_DIRECTION", status_reason: "UNKNOWN_DIRECTION" });
        continue;
      }
      if (posSide && posSide !== targetSide && newSize > 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_SIDE_CONFLICT", status_reason: "POSITION_SIDE_CONFLICT" });
        continue;
      }
      nextPosSide = targetSide;
      actionSide = targetSide === "SHORT" ? "SELL" : "BUY";
      fillPrice = computeFillPrice({ side: actionSide, nextOpen, slippageBps });
      if (String(exchange || "").toUpperCase().includes("BINANCE")) {
        try {
          leverageDecisionForIntent = await resolveAdaptiveFuturesLeverage({
            liveCfg,
            exchange,
            symbol,
            tf: signalTf,
            intent,
            event: it.event,
            side: actionSide,
            features: it.features_json,
            nowMs: Number(execBarCloseMs),
          });
          const lev = Number(leverageDecisionForIntent && leverageDecisionForIntent.leverage);
          if (Number.isFinite(lev) && lev > 0) tierLeverageForBudget = lev;
        } catch (levErr) {
          console.warn(
            `[ADAPTIVE_LEVERAGE_PRECHECK_FAIL] ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
            `${levErr && levErr.message ? levErr.message : String(levErr)}`
          );
        }
      }
      if (!manualRetryIntent) {
        const tierBudget = resolveEntryTierBudgetMax({
          intent,
          event: it.event,
          features: it.features_json,
          side: actionSide,
          qtyFraction,
          budgetMax: budgetMaxForIntent,
          baseLeverage: tierLeverageForBudget,
        });
        if (tierBudget.applied && Number.isFinite(tierBudget.budgetMax) && tierBudget.budgetMax > 0) {
          budgetMaxForIntent = tierBudget.budgetMax;
          console.log(
            `[ENTRY_TIER_BUDGET_AUTO_SCALE] ex=${String(exchange || "").toUpperCase()} sym=${String(symbol || "").toUpperCase()} ` +
            `event=${String(it.event || "").toUpperCase()} qty=${Number(qtyFraction || 0).toFixed(4)} ` +
            `tier=${String(tierBudget.tier || "-")} mode=${String(tierBudget.targetMode || "-")} lev=${Number(tierLeverageForBudget || 0).toFixed(2)} ` +
            `target=${Number(tierBudget.targetNotional || 0).toFixed(2)} dynamic_prl=${Number(tierBudget.dynamicPreRealTarget || 0).toFixed(2)} ` +
            `base=${Number(riskBudget && riskBudget.maxKrw || 0).toFixed(2)} next=${Number(budgetMaxForIntent).toFixed(2)} ` +
            `required=${Number(tierBudget.requiredBudget || 0).toFixed(2)}`
          );
        }
      }
      if (!manualRetryIntent && (!Number.isFinite(budgetMaxForIntent) || budgetMaxForIntent <= 0)) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "RISK_BUDGET_DISABLED", status_reason: "RISK_BUDGET_DISABLED" });
        continue;
      }

      const addCapState = (intent === "ADD")
        ? ensureLogicalAddCapState(resolveLogicalAddCapState({
          posSizePct: newSize,
          position: pos,
          posMeta,
          stagedAddCount: 0,
        }), { posSizePct: newSize, position: pos })
        : null;
      const currentSizeForCap = resolveCurrentQtyPctForCap(addCapState, newSize);
      const remaining = Math.max(0, 1 - currentSizeForCap);
      if (useBudget && remaining <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }

      let add = qtyFraction;
      if (useBudget) {
        maxFractionAllowed = remaining;
      }
      if (useBudget && add > remaining) add = remaining;
      if (useBudget && !manualRetryIntent && Number.isFinite(totalMaxKrw) && totalMaxKrw > 0 && Number.isFinite(totalUsedKrw)) {
        const remainingTotal = Math.max(0, totalMaxKrw - totalUsedKrw);
        if (remainingTotal <= 0) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
          continue;
        }
        const maxByTotal = remainingTotal / budgetMaxForIntent;
        if (useBudget) {
          maxFractionAllowed = Math.min(maxFractionAllowed, maxByTotal);
        }
        if (add > maxByTotal) {
          if (riskBudget.onExceed === "SKIP") {
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
            continue;
          }
          add = maxByTotal;
        }
      }
      if (add <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }
      qtyFraction = add;

      const prevNotional = newSize;
      const nextNotional = newSize + add;
      avgPrevNotional = prevNotional;
      avgNeedsUpdate = true;

      if (nextNotional <= 0) {
        newSize = 0;
        newAvg = null;
        nextPosSide = null;
        avgNeedsUpdate = false;
      } else {
        newSize = nextNotional;
      }
    } else if (intent === "EXIT") {
      if (!posSide && it.side) {
        const exitSide = normalizeSideValue(it.side);
        if (exitSide === "BUY") posSide = "SHORT";
        if (exitSide === "SELL") posSide = "LONG";
      }
      const isBinanceLiveExit = String(exchange || "").toUpperCase().includes("BINANCE")
        && liveCfg
        && (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN");
      if (isBinanceLiveExit) {
        try {
          const sync = await syncBinanceFuturesPosition({
            runId,
            exchange,
            symbol,
            riskBudget,
            liveCfg,
            forceRefresh: true,
          });
          if (sync && sync.ok && sync.position) {
            pos = sync.position;
            posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
            posSide = normalizePositionSide(
              pos.position_side ||
              pos.side ||
              (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
            );
            if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
            posQtyBase = resolvePosQtyBase(pos);
            newSize = Number(pos.size_pct || 0);
            newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
            prevSize = newSize;
          }
        } catch (_) {}
      }
      if ((!posSide || newSize <= 0) && String(exchange || "").toUpperCase().includes("BINANCE")) {
        if (liveCfg && (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")) {
          try {
            const sync = await syncBinanceFuturesPosition({
              runId,
              exchange,
              symbol,
              riskBudget,
              liveCfg,
              forceRefresh: true,
            });
            if (sync && sync.ok && sync.position) {
              pos = sync.position;
              posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
              posSide = normalizePositionSide(
                pos.position_side ||
                pos.side ||
                (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
              );
              if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
              posQtyBase = resolvePosQtyBase(pos);
              newSize = Number(pos.size_pct || 0);
              newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
              prevSize = newSize;
            }
          } catch (_) {}
        }
      }
      if ((!posQtyBase || posQtyBase <= 0) && String(exchange || "").toUpperCase().includes("BINANCE")) {
        if (liveCfg && (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")) {
          try {
            const sync = await syncBinanceFuturesPosition({
              runId,
              exchange,
              symbol,
              riskBudget,
              liveCfg,
              forceRefresh: true,
            });
            if (sync && sync.ok && sync.position) {
              pos = sync.position;
              posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
              posSide = normalizePositionSide(
                pos.position_side ||
                pos.side ||
                (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
              );
              if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
              posQtyBase = resolvePosQtyBase(pos);
              newSize = Number(pos.size_pct || 0);
              newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
              prevSize = newSize;
            }
          } catch (_) {}
        }
      }
      if (!posSide || newSize <= 0) {
        futuresForceRefresh.set(String(symbol || "").toUpperCase(), Date.now() + FUTURES_FORCE_REFRESH_MS);
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
      if (intentDir && intentDir !== posSide) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_SIDE_MISMATCH", status_reason: "POSITION_SIDE_MISMATCH" });
        continue;
      }
      actionSide = posSide === "SHORT" ? "BUY" : "SELL";
      fillPrice = computeFillPrice({ side: actionSide, nextOpen, slippageBps });

      const sub = Math.min(qtyFraction, newSize);
      if (sub <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
      qtyFraction = sub;
      const nextNotional = newSize - sub;
      if (nextNotional <= 0) {
        newSize = 0;
        newAvg = null;
        nextPosSide = null;
      } else {
        newSize = nextNotional;
      }
    } else {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "UNKNOWN_INTENT", status_reason: "UNKNOWN_INTENT" });
      continue;
    }

    if (intentIsEntry && useBudget) {
      const nextBudgetUsedKrw = Number.isFinite(budgetMaxForIntent) && Number.isFinite(qtyFraction)
        ? (budgetMaxForIntent * qtyFraction)
        : null;
      const qtyChanged = Math.abs(Number(it.qty_pct || 0) - Number(qtyFraction || 0)) > 1e-9;
      const budgetChanged = Math.abs(Number(it.budget_max_krw || 0) - Number(budgetMaxForIntent || 0)) > 1e-9;
      const budgetUsedChanged = Math.abs(Number(it.budget_used_krw || 0) - Number(nextBudgetUsedKrw || 0)) > 1e-9;
      if (qtyChanged || budgetChanged || budgetUsedChanged || fixedQtyRestore.restored) {
        await patchIntent(it.intent_id, {
          qty_pct: qtyFraction,
          qty_fraction: qtyFraction,
          budget_max_krw: budgetMaxForIntent,
          budget_used_krw: nextBudgetUsedKrw,
          features_json: it.features_json,
        });
        it.qty_pct = qtyFraction;
        it.qty_fraction = qtyFraction;
        it.budget_max_krw = budgetMaxForIntent;
        it.budget_used_krw = nextBudgetUsedKrw;
      }
    }

    const isLiveExecution = liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN";
    if (!isLiveExecution && intentIsEntry) {
      try {
        const paperExitProfile = await resolveAdaptiveFuturesExitProfile({
          exchange,
          symbol,
          tf: signalTf,
          intent,
          event: it.event,
          side: actionSide,
          features: it.features_json,
          nowMs: Number(execBarCloseMs),
          manualProfileMode: liveCfg && liveCfg.exitProfileMode,
        });
        if (paperExitProfile && paperExitProfile.profile) {
          const profile = String(paperExitProfile.profile).toUpperCase();
          appliedExitProfile = profile === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
        }
        if (paperExitProfile && paperExitProfile.reason) {
          appliedExitProfileReason = String(paperExitProfile.reason);
        }
        if (paperExitProfile && paperExitProfile.rules && typeof paperExitProfile.rules === "object") {
          appliedExitRules = cloneExitRules(paperExitProfile.rules);
        }
        const rollback = (paperExitProfile && paperExitProfile.rollback && typeof paperExitProfile.rollback === "object")
          ? paperExitProfile.rollback
          : null;
        const rollbackUntilMsRaw = Number(rollback ? rollback.rollbackUntilMs : NaN);
        appliedExitRollbackActive = !!(rollback && rollback.rollbackActive);
        appliedExitRollbackUntilMs = Number.isFinite(rollbackUntilMsRaw)
          ? rollbackUntilMsRaw
          : null;
        appliedExitRollbackReason = rollback && rollback.rollbackReason
          ? String(rollback.rollbackReason)
          : null;
      } catch (paperExitErr) {
        console.warn(
          `[PAPER_EXIT_PROFILE_RESOLVE_FAIL] ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
          `${paperExitErr && paperExitErr.message ? paperExitErr.message : String(paperExitErr)}`
        );
      }
    }

    const liveMarketRegimeCohort = resolveLiveMarketRegimeCohort({ symbol, posMeta });
    if (isLiveExecution) {
      if (liveCfg.executionMode === "LIVE" && !liveCfg.liveEnabled) {
        const liveReason = liveCfg.reason || "LIVE_DISABLED";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: liveReason, status_reason: "LIVE_DISABLED" });
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: actionSide,
          intent,
          executionMode: "LIVE",
          reason: liveReason,
          qtyPct: qtyFraction,
          closeRatio: resolveFailureAlertCloseRatio({ pos, qtyFraction }),
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
          leverageReason: appliedLeverageReason,
          exitRules: appliedExitRules || null,
        });
        continue;
      }
      var nativeProtectionMetaPatch = null;
      let liveQtyFraction = qtyFraction;
      let liveMaxFractionAllowed = maxFractionAllowed;
      if (intent === "EXIT" && useBudget && Number.isFinite(prevSize) && prevSize > 0) {
        liveQtyFraction = Math.min(1, qtyFraction / prevSize);
        liveMaxFractionAllowed = Number.isFinite(maxFractionAllowed) ? Math.min(1, maxFractionAllowed / prevSize) : liveQtyFraction;
      }
      let liveResult = null;
      try {
        liveResult = await executeLiveFuturesOrder({
          liveCfg,
          exchange,
          symbol,
          tf: signalTf,
          side: actionSide,
          qtyFraction: liveQtyFraction,
          maxFractionAllowed: liveMaxFractionAllowed,
          riskBudget,
          budgetMaxOverride: budgetMaxForIntent,
          leverageResolvedOverride: leverageDecisionForIntent,
          manualRetry: manualRetryIntent,
          manualQtyBaseOverride: manualRetryQtyBase,
          posQtyBase,
          intentId: it.intent_id,
          intent,
          event: it.event,
          features: it.features_json,
          positionMeta: posMeta,
          marketRegimeCohort: liveMarketRegimeCohort,
          sysCfg,
          bar,
          barCloseMs: execBarCloseMs,
          slippageBps,
        });
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        const cancelNote = formatLiveExceptionNote(err);
        console.warn(
          `[LIVE_EXCEPTION] ex=${String(exchange || "").toUpperCase()} sym=${String(symbol || "").toUpperCase()} ` +
          `intent=${String(intent || "")} event=${String(it.event || "")} intent_id=${String(it.intent_id || "")} ` +
          `${cancelNote}`
        );
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: "LIVE_EXCEPTION",
          status_reason: "LIVE_EXCEPTION",
          cancel_note: cancelNote || errMsg,
          last_error: errMsg,
        });
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: actionSide,
          intent,
          executionMode: liveCfg.executionMode,
          reason: "LIVE_EXCEPTION",
          note: cancelNote || errMsg,
          qtyPct: qtyFraction,
          closeRatio: resolveFailureAlertCloseRatio({ pos, qtyFraction }),
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
          leverageReason: appliedLeverageReason,
          exitRules: appliedExitRules || null,
        });
        continue;
      }
      if (!liveResult.ok) {
        if (liveResult.reason === "NO_POSITION") {
          futuresForceRefresh.set(String(symbol || "").toUpperCase(), Date.now() + FUTURES_FORCE_REFRESH_MS);
        }
        if (String(liveResult.reason || "").toUpperCase().startsWith("TP_P1_")) {
          console.warn(`[TP_P1_SKIP] ex=${exchange} sym=${symbol} reason=${liveResult.reason} note=${liveResult.note || "NA"}`);
        }
        const cancelPatch = { cancel_reason: liveResult.reason || "LIVE_FAILED", status_reason: "LIVE_FAILED" };
        if (liveResult.note || liveResult.error) cancelPatch.cancel_note = liveResult.note || liveResult.error;
        if (liveResult.error) cancelPatch.last_error = liveResult.error;
        await markIntentStatus(it.intent_id, "CANCELED", cancelPatch);
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: actionSide,
          intent,
          executionMode: liveCfg.executionMode,
          reason: liveResult.reason || "LIVE_FAILED",
          note: liveResult.note || null,
          error: liveResult.error || null,
          qtyPct: qtyFraction,
          closeRatio: resolveFailureAlertCloseRatio({ pos, qtyFraction }),
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
          leverageReason: appliedLeverageReason,
          exitRules: appliedExitRules || null,
        });
        if (intent === "EXIT") {
          posMeta = await applyTpP1SkipOnCancel({
            exchange,
            symbol,
            pos,
            posMeta,
            event: it.event,
            reason: liveResult.reason,
            note: liveResult.note,
            bar,
            runId,
            executionMode: liveCfg.executionMode,
          });
        }
        continue;
      }
      fillPrice = liveResult.execPrice;
      execPriceSource = liveResult.execPriceSource || "BINANCE_ORDER";
      executionMode = liveResult.mode || "LIVE";
      liveOrderId = liveResult.liveOrderId || null;
      execQtyBase = liveResult.execQtyBase;
      liveNotionalKrw = Number.isFinite(liveResult.notionalKrw) ? liveResult.notionalKrw : null;
      if (Number.isFinite(Number(liveResult.appliedLeverage)) && Number(liveResult.appliedLeverage) > 0) {
        appliedLeverage = Number(liveResult.appliedLeverage);
      }
      if (liveResult.leverageReason) appliedLeverageReason = String(liveResult.leverageReason);
      if (liveResult.appliedExitProfile) {
        const profile = String(liveResult.appliedExitProfile).toUpperCase();
        appliedExitProfile = profile === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
      }
      if (liveResult.exitProfileReason) appliedExitProfileReason = String(liveResult.exitProfileReason);
      if (liveResult.appliedExitRules && typeof liveResult.appliedExitRules === "object") {
        appliedExitRules = cloneExitRules(liveResult.appliedExitRules);
      }
      if (liveResult.exitProfileRollbackActive != null) {
        appliedExitRollbackActive = liveResult.exitProfileRollbackActive === true;
      }
      if (liveResult.exitProfileRollbackUntilMs != null) {
        appliedExitRollbackUntilMs = Number.isFinite(Number(liveResult.exitProfileRollbackUntilMs))
          ? Number(liveResult.exitProfileRollbackUntilMs)
          : null;
      }
      if (liveResult.exitProfileRollbackReason != null) {
        appliedExitRollbackReason = String(liveResult.exitProfileRollbackReason || "").trim() || null;
      }
      if (Number.isFinite(liveResult.qtyFractionUsed)) {
        if (intent === "EXIT" && useBudget && Number.isFinite(prevSize) && prevSize > 0) {
          qtyFraction = Math.min(prevSize, liveResult.qtyFractionUsed * prevSize);
        } else {
          qtyFraction = liveResult.qtyFractionUsed;
        }
        liveAdjusted = true;
      }
      if (Number.isFinite(Number(liveResult.budgetMaxUsed)) && Number(liveResult.budgetMaxUsed) > 0) {
        budgetMaxForIntent = Number(liveResult.budgetMaxUsed);
      }
      nativeProtectionMetaPatch = buildNativeProtectionMetaPatch({
        nativeProtection: liveResult && liveResult.nativeProtection,
        intent,
        execBarCloseMs,
      });
    }

    if (!Number.isFinite(fillPrice)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_FILL_PRICE", status_reason: "BAD_FILL_PRICE" });
      continue;
    }
    if (liveAdjusted) {
      if (intent === "ENTRY" || intent === "ADD") {
        const nextNotional = Number(avgPrevNotional || 0) + qtyFraction;
        if (nextNotional <= 0) {
          newSize = 0;
          newAvg = null;
          nextPosSide = null;
          avgNeedsUpdate = false;
        } else {
          newSize = nextNotional;
        }
      } else if (intent === "EXIT") {
        const nextNotional = Math.max(0, prevSize - qtyFraction);
        if (nextNotional <= 0) {
          newSize = 0;
          newAvg = null;
          nextPosSide = null;
        } else {
          newSize = nextNotional;
        }
      }
    }
    if (avgNeedsUpdate && Number.isFinite(avgPrevNotional)) {
      const nextNotional = Number(avgPrevNotional || 0) + qtyFraction;
      if (nextNotional > 0) {
        if (newAvg === null) newAvg = fillPrice;
        else newAvg = (newAvg * avgPrevNotional + fillPrice * qtyFraction) / nextNotional;
      }
    }
    const newState = newSize <= 0 ? "FLAT" : "ACTIVE";
    const sizeDelta = newSize - prevSize;

    let notionalKrw = useBudget
      ? (liveNotionalKrw != null ? liveNotionalKrw : (budgetMaxForIntent * qtyFraction))
      : null;
    if (!Number.isFinite(notionalKrw) || notionalKrw <= 0) {
      const baseQty = Number.isFinite(execQtyBase) && execQtyBase > 0
        ? execQtyBase
        : (!useBudget && Number.isFinite(qtyFraction) && qtyFraction > 0 ? qtyFraction : null);
      if (Number.isFinite(baseQty) && Number.isFinite(fillPrice) && fillPrice > 0) {
        notionalKrw = baseQty * fillPrice;
      }
    }
    const notional = Number.isFinite(notionalKrw) ? notionalKrw : 1.0;
    const feeValue = computeFeeValue({ notional, feeBps });

    const qtyBaseDelta = Number.isFinite(execQtyBase)
      ? Number(execQtyBase)
      : (Number.isFinite(notionalKrw) && Number.isFinite(fillPrice) && fillPrice > 0 ? (notionalKrw / fillPrice) : null);
    let newQtyBase = Number.isFinite(posQtyBase) ? posQtyBase : 0;
    if (Number.isFinite(qtyBaseDelta)) {
      if (intent === "ENTRY" || intent === "ADD") newQtyBase += qtyBaseDelta;
      else if (intent === "EXIT") newQtyBase = Math.max(0, newQtyBase - qtyBaseDelta);
    }

    const signalPrice = Number(it.signal_price);
    const signalPriceDiff = Number.isFinite(signalPrice) ? (fillPrice - signalPrice) : null;
    const signalPriceDiffPct = (Number.isFinite(signalPrice) && signalPrice !== 0) ? (signalPriceDiff / signalPrice) : null;
    const opening = prevSize <= 0 && newSize > 0;
    const positionSideBefore = normalizePositionSide(
      posSide ||
      pos.position_side ||
      pos.side ||
      (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
    );
    const execQtyBaseForPnl = Number.isFinite(execQtyBase) && execQtyBase > 0
      ? Number(execQtyBase)
      : (Number.isFinite(notionalKrw) && Number.isFinite(fillPrice) && fillPrice > 0 ? (notionalKrw / fillPrice) : null);
    let realizedPnlQuote = null;
    if (intent === "EXIT") {
      const avgBefore = Number(pos.avg_price);
      const sideBefore = positionSideBefore || (String(actionSide || "").toUpperCase() === "BUY" ? "SHORT" : "LONG");
      if (Number.isFinite(avgBefore) && Number.isFinite(execQtyBaseForPnl) && execQtyBaseForPnl > 0) {
        const gross = (sideBefore === "SHORT")
          ? ((avgBefore - fillPrice) * execQtyBaseForPnl)
          : ((fillPrice - avgBefore) * execQtyBaseForPnl);
        realizedPnlQuote = gross - (Number.isFinite(feeValue) ? feeValue : 0);
      }
    }
    const closeRatio = (intent === "EXIT" && Number.isFinite(prevSize) && prevSize > 0)
      ? Math.max(0, Math.min(1, qtyFraction / prevSize))
      : null;
    const intentSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
    const intentSignalDocId = it.signal_doc_id ||
      (it.features_json && it.features_json.signal_doc_id) ||
      deriveSignalDocId({
        exchange,
        symbol,
        tf,
        barCloseMs: it.signal_bar_close_time_utc_ms || it.exec_bar_close_time_utc_ms,
        event: it.event,
        signalId: intentSignalId,
      });
    const entryEventIdFromIntent = buildEntryEventId({
      exchange,
      symbol,
      tf,
      signalBarCloseMs: it.signal_bar_close_time_utc_ms,
      event: it.event,
    });
    const entrySignalTypeFromIntent = normalizeEvent(it.event) || null;
    const entryGradeFromIntent = String(
      (it.features_json && (it.features_json.entry_grade || it.features_json.entry_timing_tier || it.features_json.entry_tier)) || ""
    ).toUpperCase() || null;
    const entryQtyProfileFromIntent = String(
      (it.features_json && (it.features_json.entry_qty_profile || it.features_json.entry_qty_tier || it.features_json.qty_profile)) || ""
    ).toUpperCase() || null;
    const intentEntryEventId = String(
      (it.entry_event_id || (it.features_json && it.features_json.entry_event_id) || "")
    ).trim() || null;
    const intentEntrySignalType = String(
      (it.entry_signal_type || (it.features_json && it.features_json.entry_signal_type) || "")
    ).toUpperCase() || null;
    const fillEntryLineage = resolveEntryLineageForFill({
      opening,
      entryEventIdFromIntent,
      entrySignalTypeFromIntent,
      intentEntryEventId,
      intentEntrySignalType,
      posMeta,
    });
    const entryEventIdForFill = fillEntryLineage.entryEventId;
    const entrySignalTypeForFill = fillEntryLineage.entrySignalType;
    const tradeExecMs = (() => {
      const n = Date.parse(String(it.created_at || ""));
      return Number.isFinite(n) ? n : null;
    })();
    const linkedTradeId = buildTradeId({
      exchange,
      symbol,
      event: it.event,
      execBarCloseMs: execBarCloseMs,
      execMs: tradeExecMs,
    });

    const fillWrite = await upsertFill({
      intentId: it.intent_id,
      tradeId: linkedTradeId,
      runId,
      exchange,
      symbol,
      tf,
      execBarCloseTimeUtc: execBarCloseUtc,
      execBarCloseTimeUtcMs: execBarCloseMs,
      side: actionSide,
      event: it.event,
      qtyPct: qtyFraction,
      execPrice: fillPrice,
      feeBps,
      slippageBps,
      feeValue,
      notional,
      notionalKrw,
      budgetMaxKrw: useBudget ? budgetMaxForIntent : null,
      budgetUsedKrw: notionalKrw,
      qtyFraction: useBudget ? qtyFraction : null,
      execPriceSource: execPriceSource || "BAR_OPEN",
      executionMode,
      liveOrderId,
      execQtyBase,
      signalId: intentSignalId,
      signalDocId: intentSignalDocId,
      signalPrice: Number.isFinite(signalPrice) ? signalPrice : null,
      signalPriceDiff,
      signalPriceDiffPct,
      signalPriceSource: it.signal_price_source || null,
      entryEventId: entryEventIdForFill,
      entrySignalType: entrySignalTypeForFill,
      leverageApplied: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
      leverageReason: appliedLeverageReason,
      featuresJson: it.features_json && typeof it.features_json === "object" ? it.features_json : null,
      exitProfile: appliedExitProfile || null,
      exitProfileReason: appliedExitProfileReason || null,
      decisionReason: it.reason || it.event || null,
    });
    sendTradeExecutionAlert({
      exchange,
      symbol,
      event: it.event,
      side: actionSide,
      intent,
      executionMode,
      notional,
      execQtyBase,
      execPrice: fillPrice,
      closeRatio,
      fullExit: intent === "EXIT" && newState === "FLAT",
      realizedPnl: realizedPnlQuote,
      positionSideBefore,
      positionSideAfter: newState === "FLAT" ? null : nextPosSide || positionSideBefore,
      appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
      leverageReason: appliedLeverageReason,
      exitProfile: appliedExitProfile || null,
      exitProfileReason: appliedExitProfileReason || null,
      exitRules: appliedExitRules || null,
      features: it.features_json || {},
      runId,
    }).catch((e) => {
      console.warn("[TRADE_EXEC_ALERT_FAIL]", e && e.message ? e.message : String(e));
    });

    await markIntentStatus(it.intent_id, "FILLED", {
      filled_at: new Date().toISOString(),
      exec_price: fillPrice,
      status_reason: "FILLED",
      exec_side: actionSide,
    });

    if (useBudget && Number.isFinite(totalUsedKrw) && Number.isFinite(totalMaxKrw)) {
      totalUsedKrw = Math.max(0, Number(totalUsedKrw) + (sizeDelta * budgetMaxForIntent));
    }

    const ev = String(it.event || "").toUpperCase();
    const closing = newState === "FLAT";
    const openingOrAdd = (intent === "ENTRY" || intent === "ADD") && newState === "ACTIVE";
    const metaSide = String(posSide || nextPosSide || "LONG").toUpperCase();
    const marketRegimeRow = opening ? readOpenClawMarketRegimeRow(symbol) : null;
    const marketRegimeCohort = normalizeOpenClawCohort(marketRegimeRow && marketRegimeRow.cohort);
    let nextMeta = mergeMeta(posMeta, {
      last_fill_intent: it.intent_id,
      last_fill_side: actionSide,
      position_side: nextPosSide,
      intent,
    });
    if (opening || closing) {
      nextMeta = mergeMeta(nextMeta, {
        tp_p0_done: false,
        tp_p0_price: null,
        tp_p0_at: null,
        tp_p0_source: null,
        tp_p0_qty_ratio: null,
        tp_p0_entry_event_id: null,
        tp_p0_entry_exec_bar_ms: null,
        tp_p1_done: false,
        tp_p1_price: null,
        tp_p1_target_price: null,
        trail_high: null,
        trail_low: null,
        trail_active: false,
        tp_p1_pending: false,
        tp_p1_pending_at_ms: null,
        tp_p1_pending_until_ms: null,
        tp_p1_pending_event: null,
        tp_p1_bar_ms: null,
        tp_p1_at: null,
        tp_p1_source: null,
        tp_p1_entry_event_id: null,
        tp_p1_entry_exec_bar_ms: null,
        trail_delay_bars_required: null,
        trail_delay_mfe_pct_required: null,
        trail_delay_release_reason: null,
        trail_delay_release_at: null,
        trail_delay_mode: null,
        tp_p1_skip_reason: null,
        tp_p1_skip_note: null,
        tp_p1_skip_at: null,
        opposite_transition_dir: null,
        opposite_transition_event: null,
        opposite_transition_until_ms: null,
        opposite_transition_stage: null,
        opposite_transition_seen_ms: null,
        add_chain_last_signal_bar_ms: null,
        add_chain_last_intent_id: null,
        add_chain_last_signal_id: null,
        add_chain_last_avg_before: null,
        add_chain_last_avg_after: null,
        add_chain_last_size_before: null,
        add_chain_last_size_after: null,
        add_chain_last_qty_pct: null,
        add_chain_last_qty_base: null,
        add_chain_last_loss_pct: null,
        add_chain_base_qty_pct: closing ? null : undefined,
        native_protection_refresh_status: closing ? null : undefined,
        native_protection_refresh_reason: closing ? null : undefined,
        native_protection_refresh_context: closing ? null : undefined,
        native_protection_refresh_at_ms: closing ? null : undefined,
        native_protection_refresh_bar_ms: closing ? null : undefined,
        native_protection_stale: closing ? false : undefined,
        native_protection_attempts: closing ? null : undefined,
        native_protection_max_attempts: closing ? null : undefined,
        native_protection_stop_order_id: closing ? null : undefined,
        native_protection_tp0_order_id: closing ? null : undefined,
        native_protection_tp_order_id: closing ? null : undefined,
        native_protection_stop_price: closing ? null : undefined,
        native_protection_tp0_price: closing ? null : undefined,
        native_protection_tp_price: closing ? null : undefined,
        native_protection_tp0_qty_base: closing ? null : undefined,
        native_protection_tp_qty_base: closing ? null : undefined,
        native_protection_tp0_qty_ratio: closing ? null : undefined,
        native_protection_tp_qty_ratio: closing ? null : undefined,
        native_protection_tp0_status: closing ? null : undefined,
        native_protection_tp_status: closing ? null : undefined,
        native_protection_tp0_reason: closing ? null : undefined,
        native_protection_tp_reason: closing ? null : undefined,
        native_protection_entry_price: closing ? null : undefined,
        native_protection_side: closing ? null : undefined,
      });
    }
    if (openingOrAdd) {
      const entryExitAdjustment = applyEntryExitRuleRuntimeAdjustments({
        rules: appliedExitRules,
        features: it.features_json,
        sysCfg,
        cohort: marketRegimeCohort,
        market: symbol,
      });
      const exitPolicySrc = entryExitAdjustment.exitPolicySrc;
      const tp1LadderState = entryExitAdjustment.tp1LadderState;
      appliedExitRules = cloneExitRules(entryExitAdjustment.appliedExitRules);
      nextMeta = mergeMeta(nextMeta, {
        exit_profile: appliedExitProfile || "BASE",
        exit_profile_reason: (exitPolicySrc && exitPolicySrc !== "BINANCE_DEFAULT")
          ? `${appliedExitProfileReason || "BASE_PROFILE"}+${exitPolicySrc}`
          : (appliedExitProfileReason || null),
        exit_rules_override: cloneExitRules(appliedExitRules),
        tp1_ladder_enabled: tp1LadderState ? tp1LadderState.enabled !== false : null,
        tp1_ladder_stage: tp1LadderState ? tp1LadderState.stage : null,
        tp1_ladder_profile: tp1LadderState ? tp1LadderState.profile : null,
        tp1_ladder_reason: tp1LadderState ? tp1LadderState.reason : null,
        tp1_ladder_realized_n: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.realized_n : null,
        tp1_ladder_tp0_hit_rate: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp0_hit_rate : null,
        tp1_ladder_tp1_hit_rate: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp1_hit_rate : null,
        tp1_ladder_tp0_to_tp1_conversion: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp0_to_tp1_conversion : null,
        tp1_ladder_fee_adjusted_expectancy: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.fee_adjusted_expectancy : null,
        exit_profile_rollback_active: appliedExitRollbackActive === true,
        exit_profile_rollback_until_ms: Number.isFinite(appliedExitRollbackUntilMs) ? appliedExitRollbackUntilMs : null,
        exit_profile_rollback_reason: appliedExitRollbackReason || null,
        exit_policy_source: exitPolicySrc || null,
      });
      const runtimeExitInvariant = await enforceEntryRuntimeExitState({
        exchange,
        symbol,
        appliedExitRules,
        posMeta: nextMeta,
        features: it.features_json,
        cohort: marketRegimeCohort,
        sysCfg,
        entryPrice: fillPrice,
        leverage: appliedLeverage,
        execBarCloseMs,
      });
      if (runtimeExitInvariant.repaired) {
        appliedExitRules = cloneExitRules(runtimeExitInvariant.appliedExitRules);
        nextMeta = runtimeExitInvariant.meta;
      }
    }
    if (opening) {
      const initialStopPrice = computeInitialStopPriceForEntry({
        avgPrice: fillPrice,
        leverage: appliedLeverage,
        side: nextPosSide,
        slRatio: appliedExitRules && appliedExitRules.SL,
        features: it.features_json,
        nativeProtectionStopPrice: it && it.features_json && it.features_json.stop_price,
      });
      const initialStopSource = resolveInitialStopSource({
        avgPrice: fillPrice,
        side: nextPosSide,
        features: it.features_json,
        nativeProtectionStopPrice: it && it.features_json && it.features_json.stop_price,
      });
      const entryRDistance = (Number.isFinite(initialStopPrice) && Number.isFinite(fillPrice))
        ? Math.abs(Number(initialStopPrice) - Number(fillPrice))
        : null;
      nextMeta = mergeMeta(nextMeta, {
        leverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
        leverage_reason: appliedLeverageReason || null,
        entry_exec_tf_ms: Number.isFinite(signalTfMs) ? signalTfMs : null,
        initial_stop_price: Number.isFinite(initialStopPrice) ? initialStopPrice : null,
        initial_stop_source: initialStopSource || null,
        entry_r_distance: Number.isFinite(entryRDistance) ? entryRDistance : null,
        ev_gate_atr_pct: Number.isFinite(Number(it.features_json && it.features_json.ev_gate_atr_pct))
          ? Number(it.features_json.ev_gate_atr_pct)
          : null,
        trail_r_multiple: Number.isFinite(Number(appliedExitRules && appliedExitRules.TRAIL_R_MULTIPLE))
          ? Number(appliedExitRules.TRAIL_R_MULTIPLE)
          : null,
        add_chain_base_qty_pct: Number.isFinite(newSize) ? Number(newSize) : null,
        last_exit_bar_ms: null,
        last_exit_dir: null,
        last_exit_wall_ms: null,
        openclaw_market_regime_cohort: marketRegimeCohort || null,
        openclaw_market_regime_objective_score: marketRegimeRow && Number.isFinite(Number(marketRegimeRow.objective_score))
          ? Number(marketRegimeRow.objective_score)
          : null,
        openclaw_market_regime_drop_verdict: marketRegimeRow ? String(marketRegimeRow.drop_verdict || "").trim().toUpperCase() || null : null,
        ...buildEntryLineageMetaPatch({
          entry_event_id: entryEventIdFromIntent || null,
          entry_signal_type: entrySignalTypeFromIntent || null,
          entry_grade: entryGradeFromIntent || null,
          entry_qty_profile: entryQtyProfileFromIntent || null,
          entry_signal_bar_ms: Number(it.signal_bar_close_time_utc_ms) || null,
          entry_exec_bar_ms: Number(execBarCloseMs) || null,
        }),
      });
    }
    if (closing) {
      nextMeta = mergeMeta(nextMeta, {
        last_exit_bar_ms: Number(execBarCloseMs) || null,
        last_exit_dir: metaSide || null,
        last_exit_wall_ms: resolveEventRefMs(execBarCloseMs),
        entry_exec_bar_ms: null,
        entry_exec_tf_ms: null,
        entry_event_id: null,
        entry_signal_type: null,
        entry_grade: null,
        entry_qty_profile: null,
        entry_signal_bar_ms: null,
        origin_entry_event_id: null,
        origin_entry_signal_type: null,
        origin_entry_grade: null,
        origin_entry_qty_profile: null,
        origin_entry_signal_bar_ms: null,
        origin_entry_exec_bar_ms: null,
        openclaw_market_regime_cohort: null,
        openclaw_market_regime_objective_score: null,
        openclaw_market_regime_drop_verdict: null,
        exit_profile: null,
        exit_profile_reason: null,
        exit_rules_override: null,
        exit_profile_rollback_active: false,
        exit_profile_rollback_until_ms: null,
        exit_profile_rollback_reason: null,
        exit_policy_source: null,
      });
      const profitableTrailCooldownMeta = buildSameDirectionTrailProfitCooldownMetaPatch({
        event: ev,
        realizedPnlQuote,
        positionSide: metaSide,
        exitWallMs: resolveEventRefMs(execBarCloseMs),
        source: "INTENT_FILL",
      });
      if (profitableTrailCooldownMeta) {
        nextMeta = mergeMeta(nextMeta, profitableTrailCooldownMeta);
      }
    }
    if (isTpP0EventLocal(ev) && newState === "ACTIVE") {
      nextMeta = mergeMeta(nextMeta, {
        tp_p0_done: true,
        tp_p0_price: fillPrice,
        tp_p0_at: new Date().toISOString(),
        tp_p0_source: "INTENT_FILL",
        tp_p0_qty_ratio: qtyFraction,
        tp_p0_entry_event_id: (entryEventIdForFill || nextMeta.entry_event_id || null),
        tp_p0_entry_exec_bar_ms: Number(nextMeta.entry_exec_bar_ms || execBarCloseMs) || null,
      });
    }
    if ((ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_")) && newState === "ACTIVE") {
      const trailDelayCfg = resolveTrailDelayConfigForMeta({
        exchange,
        pos: { ...pos, meta: nextMeta },
        posMeta: nextMeta,
      });
      const nextTrailHigh = metaSide === "SHORT"
        ? null
        : (Number.isFinite(fillPrice) ? fillPrice : null);
      const nextTrailLow = metaSide === "SHORT"
        ? (Number.isFinite(fillPrice) ? fillPrice : null)
        : null;
      nextMeta = mergeMeta(nextMeta, {
        tp_p0_done: nextMeta.tp_p0_done === true,
        tp_p1_done: true,
        tp_p1_price: fillPrice,
        tp_p1_target_price: computeTpP1TargetPrice({
          exchange,
          position: pos,
          posMeta: nextMeta,
          fillPrice,
        }),
        trail_high: nextTrailHigh,
        trail_low: nextTrailLow,
        trail_active: false,
        tp_p1_pending: false,
        tp_p1_pending_at_ms: null,
        tp_p1_pending_until_ms: null,
        tp_p1_pending_event: null,
        tp_p1_bar_ms: Number(execBarCloseMs) || null,
        tp_p1_at: new Date().toISOString(),
        tp_p1_source: "INTENT_FILL",
        tp_p1_entry_event_id: (entryEventIdForFill || nextMeta.entry_event_id || null),
        tp_p1_entry_exec_bar_ms: Number(nextMeta.entry_exec_bar_ms || execBarCloseMs) || null,
        trail_delay_bars_required: trailDelayCfg.barsRequired,
        trail_delay_mfe_pct_required: trailDelayCfg.mfePctRequired,
        trail_delay_release_reason: null,
        trail_delay_release_at: null,
        trail_delay_mode: "ONE_BAR_OR_MFE",
        tp_p1_skip_reason: null,
        tp_p1_skip_note: null,
        tp_p1_skip_at: null,
        opposite_transition_dir: null,
        opposite_transition_event: null,
        opposite_transition_until_ms: null,
        opposite_transition_stage: null,
        opposite_transition_seen_ms: null,
      });
      console.warn(
        `[TP1_TRAIL_ARMED] ${symbol} side=${metaSide || "UNKNOWN"} source=INTENT_FILL ` +
        `event=${ev} fill_price=${fillPrice ?? "NA"} trail_high=${nextTrailHigh ?? "NA"} ` +
        `trail_low=${nextTrailLow ?? "NA"} intent_id=${it.intent_id || "NA"}`
      );
      triggerExitWorkerRun({
        reason: `TP1_TRAIL_ARMED_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}`,
      }).catch((e) => {
        console.warn("[EXIT_WORKER_SCALE_ON_FAIL][TP1_INTENT_FILL]", e && e.message ? e.message : String(e));
      });
    }

    nextMeta = applyAddAndProtectionMetaOnFill({
      posMeta: nextMeta,
      intent,
      event: it.event,
      barCloseMs: execBarCloseMs,
      realizedPnlQuote,
      opening,
      closing,
      signalBarCloseMs: it.signal_bar_close_time_utc_ms,
      intentId: it.intent_id,
      signalId: intentSignalId,
      avgBefore: pos.avg_price,
      avgAfter: newAvg,
      sizeBefore: prevSize,
      sizeAfter: newSize,
      qtyPct: qtyFraction,
      qtyBase: qtyBaseDelta,
      lossPct: it.features_json && it.features_json._rescue_add_loss_pct,
      nativeProtectionMetaPatch,
    });

    let budgetUsedForPosition = useBudget ? (budgetMaxForIntent * newSize) : null;
    if (useBudget && String(exchange || "").toUpperCase().includes("BINANCE")) {
      const marketKey = String(symbol || "").toUpperCase();
      const riskBudgetForPosition = {
        ...(riskBudget || {}),
        maxKrw: budgetMaxForIntent,
        byMarket: {
          ...((riskBudget && riskBudget.byMarket) || {}),
          [marketKey]: budgetMaxForIntent,
        },
      };
      budgetUsedForPosition = resolveBinanceBudgetUsedKrw({
        position: {
          ...pos,
          symbol_or_pair_id: marketKey,
          symbol: marketKey,
          state: newState,
          size_pct: newSize,
          avg_price: newAvg,
          qty_base: Number.isFinite(newQtyBase) ? newQtyBase : (pos.qty_base ?? null),
          budget_max_krw: budgetMaxForIntent,
          budget_used_krw: null,
          meta: nextMeta,
        },
        riskBudget: riskBudgetForPosition,
        priceFallback: newAvg,
        qtyBaseFallback: Number.isFinite(newQtyBase) ? newQtyBase : null,
      });
    }

    await upsertPosition({
      exchange,
      symbol,
      state: newState,
      positionSide: nextPosSide,
      sizePct: newSize,
      avgPrice: newAvg,
      qtyBase: Number.isFinite(newQtyBase) ? newQtyBase : (pos.qty_base ?? null),
      runId,
      executionMode,
      budgetMaxKrw: useBudget ? budgetMaxForIntent : null,
      budgetUsedKrw: useBudget ? budgetUsedForPosition : null,
      budgetSource: useBudget ? riskBudget.source : null,
      meta: nextMeta,
    });

    pos = { ...pos, state: newState, size_pct: newSize, avg_price: newAvg, position_side: nextPosSide, meta: nextMeta, qty_base: Number.isFinite(newQtyBase) ? newQtyBase : pos.qty_base };
    posMeta = nextMeta;
    posSide = nextPosSide;
    posQtyBase = Number.isFinite(newQtyBase) ? newQtyBase : posQtyBase;
    if (intent === "ADD" && executionMode === "LIVE") {
      sendRescueAddRepriceAlert({
        exchange,
        symbol,
        event: it.event,
        executionMode,
        position: pos,
        avgBefore: Number.isFinite(Number(nextMeta.add_chain_last_avg_before)) ? Number(nextMeta.add_chain_last_avg_before) : Number(pos.avg_price),
        avgAfter: Number.isFinite(Number(newAvg)) ? Number(newAvg) : Number(pos.avg_price),
        addQtyPct: Number.isFinite(Number(nextMeta.add_chain_last_qty_pct)) ? Number(nextMeta.add_chain_last_qty_pct) : qtyFraction,
        addQtyBase: Number.isFinite(Number(nextMeta.add_chain_last_qty_base)) ? Number(nextMeta.add_chain_last_qty_base) : qtyBaseDelta,
        fillPrice,
        exitRules: appliedExitRules || null,
        nativeProtectionMeta: nextMeta,
      }).catch((e) => {
        console.warn("[RESCUE_ADD_REPRICE_ALERT_FAIL]", e && e.message ? e.message : String(e));
      });
    }

    await upsertTradeEvent({
      runId,
      exchange,
      symbol,
      tf,
      event: it.event,
      side: actionSide,
      execBarCloseTimeUtc: execBarCloseUtc,
      execBarCloseTimeUtcMs: execBarCloseMs,
      execMs: tradeExecMs,
      intentId: it.intent_id,
      fillId: fillWrite && fillWrite.fill_id,
      signalId: intentSignalId,
      signalDocId: intentSignalDocId,
      entryEventId: entryEventIdForFill,
      entrySignalType: entrySignalTypeForFill,
      execPrice: fillPrice,
      qtyPct: qtyFraction,
      feeValue,
      note: `FILLED_INTENT:${it.intent_id}`,
      pnl: null,
      notionalKrw,
      budgetMaxKrw: useBudget ? budgetMaxForIntent : null,
      budgetUsedKrw: notionalKrw,
      qtyFraction: useBudget ? qtyFraction : null,
      meta: {
        trading_mode,
        position_side: nextPosSide,
        intent,
        execution_mode: executionMode,
        leverage_applied: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
        leverage_reason: appliedLeverageReason || null,
        exit_profile: appliedExitProfile || "BASE",
        exit_profile_reason: appliedExitProfileReason || null,
      },
      executionMode,
      featuresJson: it.features_json && typeof it.features_json === "object" ? it.features_json : null,
      requestId: it.request_id || null,
      decisionReason: it.decision_reason || it.reason || it.event || null,
    });

      fillsExecuted += 1;
    }
  };

  await executeIntentList(sortIntentsForExecution(intents));

  pos = await getPosition({ exchange, symbol });

  const nextExecMs = Number.isFinite(execTfMs) ? addMs(barCloseMs, execTfMs) : addMs(barCloseMs, 60 * 60 * 1000);
  const nextExecUtc = msToUtcZ(nextExecMs);
  const alignedSignalBar = Number.isFinite(signalTfMs) && Number.isFinite(barCloseMs) && (Number(barCloseMs) % signalTfMs === 0);
  const fallbackSignalBarMs = (Number.isFinite(signalTfMs) && Number.isFinite(barCloseMs))
    ? Math.floor(Number(barCloseMs) / signalTfMs) * signalTfMs
    : null;
  const signalBarCloseMs = alignedSignalBar
    ? Number(barCloseMs)
    : (Number.isFinite(fallbackSignalBarMs) ? fallbackSignalBarMs : null);
  const signalBarCloseUtc = Number.isFinite(signalBarCloseMs) ? msToUtcZ(signalBarCloseMs) : null;
  const nativeInitialSignals = Number.isFinite(signalBarCloseMs)
    ? await loadServerNativeInitialSignals({
      exchange,
      symbol,
      signalTf,
      barCloseMs: signalBarCloseMs,
    })
    : [];

  const allowInternalExitSignals = canEvaluateInternalExitSignalsForBar({ posMeta, barCloseMs });
  const timeStopSignal = (allowInternalExitSignals && exUpper.includes("BINANCE"))
    ? buildTimeStopExitSignal({ position: pos, bar, posMeta, barCloseMs, signalTfMs, maxHoldBars })
    : null;
  const signalLeverage = resolvePositionLeverage({ position: pos, fallback: leverage });
  const internalSignalsRaw = [
    ...nativeInitialSignals,
    ...generateSignals({
      exchange,
      symbol,
      tf,
      bar,
      gate,
      position: pos,
      trading_mode,
      leverage: signalLeverage,
      exitProfileMode: liveCfg && liveCfg.exitProfileMode,
      currentBarCloseMs: Number(barCloseMs),
    }),
    ...(timeStopSignal ? [timeStopSignal] : []),
  ];
  const internalSignals = finalizeInternalSignals({
    signals: internalSignalsRaw,
    posMeta,
    barCloseMs,
    fallbackUtc: signalBarCloseUtc,
    exchange,
    symbol,
  });

  const externalSignalsRaw = Number.isFinite(signalBarCloseMs)
    ? await getSignalsForBar({
      exchange,
      symbol,
      tf: signalTf,
      barCloseMs: signalBarCloseMs,
      limitN: 200,
      maxLookbackBars: signalQueueEnabled ? signalQueueMaxLateBars : undefined,
      maxLookaheadBars: signalQueueLookaheadBars,
      caller: "paperUpbitRunner:runPaperFuturesForBar",
    })
    : [];

  const ttlMs = Number.isFinite(execProfile.intentTtlMs) ? execProfile.intentTtlMs
    : (Number.isFinite(execProfile.intentTtlBars) && Number.isFinite(execTfMs) ? (execTfMs * execProfile.intentTtlBars) : null);
  let lateSignals = 0;

  const externalSignals = externalSignalsRaw.map((s) => {
    const signalBarMs = Number(s.bar_close_time_utc_ms);
    const signalDocId = String(s.signal_doc_id || (String(s.signal_id || "").startsWith("SIG__") ? s.signal_id : "") || "").trim() || null;
    let lateByBars = 0;
    if (Number.isFinite(signalTfMs) && Number.isFinite(signalBarMs)) {
      const delta = barCloseMs - signalBarMs;
      if (delta >= signalTfMs / 2) lateByBars = Math.max(0, Math.round(delta / signalTfMs));
    }
    const features = { ...(s.features_json || {}) };
    if (signalDocId && !features.signal_doc_id) features.signal_doc_id = signalDocId;
    if (s.signal_id && !features.signal_id) features.signal_id = s.signal_id;
    if (Number.isFinite(Number(s.price)) && !Number.isFinite(Number(features.signal_price))) features.signal_price = Number(s.price);
    if (lateByBars > 0) {
      lateSignals += 1;
      features._late_by_bars = lateByBars;
      features._late_by_ms = Number(barCloseMs) - Number(signalBarMs);
      features._late_origin_bar_close_time_utc_ms = Number(signalBarMs);
    }

    return {
      signal_id: s.signal_id,
      signal_doc_id: signalDocId,
      event: s.event,
      side: s.side,
      qty_pct: s.qty_pct,
      reason: s.reason || "TV_WEBHOOK",
      signal_bar_close_time_utc_ms: Number.isFinite(signalBarMs) ? signalBarMs : null,
      signal_bar_close_time_utc: s.bar_close_time_utc || null,
      signal_price: Number.isFinite(Number(s.price)) ? Number(s.price) : null,
      features,
    };
  });

  const rawSignals = dedupeEntrySignalsByFamily([...internalSignals, ...externalSignals]);
  const signals = [];
  const signalDrops = [];
  const metaUpdates = pendingMetaPatch ? { ...pendingMetaPatch } : {};
  let injectedOppExit = false;
  const posSizeNowRaw = Number(pos.size_pct || 0);
  const posSizeNow = Number.isFinite(posSizeNowRaw) ? posSizeNowRaw : 0;
  const posSizeNowActive = hasPositionSize(pos.size_pct);
  const hasPositionNow = !!posSide && (posSizeNowActive || (Number.isFinite(posQtyBase) && posQtyBase > 0));
  const pendingAddState = hasPositionNow
    ? await getActivePendingAddIntentState({
      exchange,
      symbol,
      tf,
      positionSide: posSide,
      nowMs: resolveEventRefMs(signalBarCloseMs, barCloseMs),
    })
    : { count: 0, lastSignalBarMs: null };
  let pendingRescueAddCount = Number.isFinite(Number(pendingAddState.count))
    ? Math.max(0, Math.trunc(Number(pendingAddState.count)))
    : 0;
  let pendingRescueAddSignalBarMs = Number.isFinite(Number(pendingAddState.lastSignalBarMs))
    ? Number(pendingAddState.lastSignalBarMs)
    : null;
  let committedRescueAddCount = pendingRescueAddCount;
  let committedRescueAddSignalBarMs = pendingRescueAddSignalBarMs;
  const oppositeTransitionCfg = resolveOppositeTransitionConfig(sysCfgEffective, exchange);
  const transitionDirCurrent = String(posMeta.opposite_transition_dir || "").toUpperCase();
  const transitionUntilCurrent = Number(posMeta.opposite_transition_until_ms);
  if (transitionDirCurrent && Number.isFinite(transitionUntilCurrent) && Number.isFinite(signalBarCloseMs) && signalBarCloseMs > transitionUntilCurrent) {
    metaUpdates.opposite_transition_dir = null;
    metaUpdates.opposite_transition_event = null;
    metaUpdates.opposite_transition_until_ms = null;
    metaUpdates.opposite_transition_stage = null;
    metaUpdates.opposite_transition_seen_ms = null;
  }

  for (const s0 of rawSignals) {
    const s = { ...s0, features: { ...(s0.features || {}) } };
    const intent = intentFromSignal({ event: s.event, side: s.side, features: s.features });
    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: s.event })
      : directionFromSignal({ event: s.event, side: s.side });

    if ((intent === "ENTRY" || intent === "ADD") && hasPositionNow) {
      if (intentDir && intentDir !== posSide) {
        const normalizedEvent = normalizeTpP1EventForExchange(s.event, exchange);
        if (normalizedEvent && normalizedEvent !== s.event) s.event = normalizedEvent;
        const eventUpper = String(normalizedEvent || s.event || "").toUpperCase();
        const transitionApplicable = oppositeTransitionCfg.enabled && (!oppositeTransitionCfg.coreRealOnly || isCoreOrRealEvent(eventUpper));
        const signalMsForStage = Number(s.signal_bar_close_time_utc_ms);
        const stageBarMs = Number.isFinite(signalMsForStage) ? signalMsForStage : (Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : Number(barCloseMs));
        if (transitionApplicable) {
          const pendingDir = String((metaUpdates.opposite_transition_dir ?? posMeta.opposite_transition_dir) || "").toUpperCase();
          const pendingUntil = Number(metaUpdates.opposite_transition_until_ms ?? posMeta.opposite_transition_until_ms);
          const pendingActive = pendingDir && pendingDir === intentDir && Number.isFinite(pendingUntil)
            && (!Number.isFinite(stageBarMs) || stageBarMs <= pendingUntil);
          const exitSide = posSide === "SHORT" ? "BUY" : "SELL";

          if (!pendingActive) {
            if (!injectedOppExit) {
              const reduceQty = Math.max(POS_SIZE_EPSILON, Math.min(posSizeNow, posSizeNow * oppositeTransitionCfg.reduceFraction));
              console.log(
                `[inject_exit_opposite_reduce] ex=${exchange} sym=${symbol} tf=${signalTf} posSide=${posSide} posSizePct=${posSizeNow} reduceQty=${reduceQty} incoming=${s.event}:${s.side} intentDir=${intentDir}`
              );
              signals.push({
                event: "EXIT_OPPOSITE_SIGNAL",
                side: exitSide,
                qty_pct: reduceQty,
                reason: "EXIT_OPPOSITE_REDUCE",
                signal_bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : null,
                signal_bar_close_time_utc: signalBarCloseUtc,
                features: {
                  position_side: posSide,
                  ref_px: Number(bar && (bar.close ?? bar.c)),
                  opposite_transition: "REDUCE",
                  opposite_transition_dir: intentDir,
                },
              });
              injectedOppExit = true;
            }
            const stageUntilMs = Number.isFinite(signalTfMs) && Number.isFinite(stageBarMs)
              ? (stageBarMs + signalTfMs * oppositeTransitionCfg.confirmBars)
              : null;
            metaUpdates.opposite_transition_dir = intentDir;
            metaUpdates.opposite_transition_event = eventUpper || null;
            metaUpdates.opposite_transition_until_ms = stageUntilMs;
            metaUpdates.opposite_transition_stage = 1;
            metaUpdates.opposite_transition_seen_ms = Number.isFinite(stageBarMs) ? stageBarMs : null;
            continue;
          }

          if (!injectedOppExit) {
            console.log(
              `[inject_exit_opposite_confirm] ex=${exchange} sym=${symbol} tf=${signalTf} posSide=${posSide} posSizePct=${posSizeNow} incoming=${s.event}:${s.side} intentDir=${intentDir}`
            );
            signals.push({
              event: "EXIT_OPPOSITE_SIGNAL",
              side: exitSide,
              qty_pct: posSizeNow,
              reason: "EXIT_OPPOSITE_CONFIRM",
              signal_bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : null,
              signal_bar_close_time_utc: signalBarCloseUtc,
              features: {
                position_side: posSide,
                ref_px: Number(bar && (bar.close ?? bar.c)),
                opposite_transition: "CONFIRM_EXIT",
                opposite_transition_dir: intentDir,
              },
            });
            injectedOppExit = true;
          }
          s.features._flip_confirmed = true;
          s.features._flip_stage = 2;
          s.features._allow_opposite_after_exit = true;
          s.reason = s.reason ? `${s.reason}|FLIP_CONFIRM` : "FLIP_CONFIRM";
          metaUpdates.opposite_transition_dir = null;
          metaUpdates.opposite_transition_event = null;
          metaUpdates.opposite_transition_until_ms = null;
          metaUpdates.opposite_transition_stage = null;
          metaUpdates.opposite_transition_seen_ms = null;
          signals.push(s);
          continue;
        }
        if (!injectedOppExit) {
          const exitSide = posSide === "SHORT" ? "BUY" : "SELL";
          console.log(
            `[inject_exit_opposite] ex=${exchange} sym=${symbol} tf=${signalTf} posSide=${posSide} posSizePct=${posSizeNow} posQtyBase=${posQtyBase ?? "NA"} eps=${POS_SIZE_EPSILON} incoming=${s.event}:${s.side} intentDir=${intentDir}`
          );
          signals.push({
            event: "EXIT_OPPOSITE_SIGNAL",
            side: exitSide,
            qty_pct: posSizeNow,
            reason: "EXIT_OPPOSITE_SIGNAL",
            signal_bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : null,
            signal_bar_close_time_utc: signalBarCloseUtc,
            features: { position_side: posSide, ref_px: Number(bar && (bar.close ?? bar.c)) },
          });
          injectedOppExit = true;
        }
        continue;
      }
      if (intentDir && intentDir === posSide && String((metaUpdates.opposite_transition_dir ?? posMeta.opposite_transition_dir) || "")) {
        metaUpdates.opposite_transition_dir = null;
        metaUpdates.opposite_transition_event = null;
        metaUpdates.opposite_transition_until_ms = null;
        metaUpdates.opposite_transition_stage = null;
        metaUpdates.opposite_transition_seen_ms = null;
      }
      if (intent === "ENTRY" || intent === "ADD") {
        const signalBarMsForAdd = Number.isFinite(Number(s.signal_bar_close_time_utc_ms))
          ? Number(s.signal_bar_close_time_utc_ms)
          : (Number.isFinite(signalBarCloseMs) ? Number(signalBarCloseMs) : Number(barCloseMs));
        const replayRescueAdd = evaluateReplayRescueAdd({
          event: s.event,
          features: s.features,
          position: pos,
          posMeta,
          posSide,
          posSizePct: posSizeNow,
          bar,
          signalBarCloseMs: signalBarMsForAdd,
          pendingAddCount: pendingRescueAddCount,
          pendingAddSignalBarMs: pendingRescueAddSignalBarMs,
        });
        if (replayRescueAdd.enabled === true) {
          if (!replayRescueAdd.ok) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : Number(barCloseMs),
              qty_pct: s.qty_pct,
              reason: replayRescueAdd.reason || "REPLAY_RESCUE_ADD_BLOCKED",
              drop_reason_code: replayRescueAdd.reason || "REPLAY_RESCUE_ADD_BLOCKED",
              features_json: {
                ...(s.features || {}),
                replay_rescue_add: replayRescueAdd.detail || null,
              },
              event_intent: "ADD",
            });
            continue;
          }
          s.qty_pct = replayRescueAdd.addQtyPct;
          s.features._event_intent = "ADD";
          s.features._in_position_add = true;
          s.features._replay_rescue_add_applied = true;
          s.features._replay_rescue_add_base_qty_pct = replayRescueAdd.detail && replayRescueAdd.detail.base_qty_pct;
          s.features._replay_rescue_add_qty_pct = replayRescueAdd.detail && replayRescueAdd.detail.add_qty_pct;
          s.features._replay_rescue_add_loss_pct = replayRescueAdd.detail && replayRescueAdd.detail.loss_pct;
          s.features._replay_rescue_add_stop_distance_pct = replayRescueAdd.detail && replayRescueAdd.detail.stop_distance_pct;
          s.features._replay_rescue_add_max_adds = replayRescueAdd.detail && replayRescueAdd.detail.max_adds;
          s.features._replay_rescue_add_same_bar_block = replayRescueAdd.detail && replayRescueAdd.detail.same_bar_block === true;
          s.reason = s.reason ? `${s.reason}|REPLAY_RESCUE_ADD` : "REPLAY_RESCUE_ADD";
          signals.push(s);
          continue;
        }
        if (rescueAddCfg.enabled === true) {
          const liveRescueAdd = evaluateLiveRescueAdd({
            cfg: rescueAddCfg,
            event: s.event,
            features: s.features,
            position: pos,
            posMeta,
            posSide,
            posSizePct: posSizeNow,
            bar,
            signalBarCloseMs: signalBarMsForAdd,
            useBudget,
            pendingAddCount: pendingRescueAddCount,
            pendingAddSignalBarMs: pendingRescueAddSignalBarMs,
          });
          if (!liveRescueAdd.ok) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : Number(barCloseMs),
              qty_pct: s.qty_pct,
              reason: liveRescueAdd.reason || "LIVE_RESCUE_ADD_BLOCKED",
              drop_reason_code: liveRescueAdd.reason || "LIVE_RESCUE_ADD_BLOCKED",
              features_json: {
                ...(s.features || {}),
                live_rescue_add: liveRescueAdd.detail || null,
              },
              event_intent: "ADD",
            });
            continue;
          }
          s.qty_pct = liveRescueAdd.addQtyPct;
          s.features._event_intent = "ADD";
          s.features._in_position_add = true;
          s.features._rescue_add_applied = true;
          s.features._rescue_add_base_qty_pct = liveRescueAdd.detail && liveRescueAdd.detail.base_qty_pct;
          s.features._rescue_add_requested_qty_pct = liveRescueAdd.detail && liveRescueAdd.detail.requested_add_qty_pct;
          s.features._rescue_add_qty_pct = liveRescueAdd.detail && liveRescueAdd.detail.add_qty_pct;
          s.features._rescue_add_loss_pct = liveRescueAdd.detail && liveRescueAdd.detail.loss_pct;
          s.features._rescue_add_stop_distance_pct = liveRescueAdd.detail && liveRescueAdd.detail.stop_distance_pct;
          s.features._rescue_add_remaining_cap_qty_pct = liveRescueAdd.detail && liveRescueAdd.detail.remaining_cap_qty_pct;
          s.features._rescue_add_auto_shrunk = liveRescueAdd.detail && liveRescueAdd.detail.auto_shrunk === true;
          s.features._rescue_add_max_adds = liveRescueAdd.detail && liveRescueAdd.detail.max_adds;
          s.features._rescue_add_same_bar_block = liveRescueAdd.detail && liveRescueAdd.detail.same_bar_block === true;
          s.reason = s.reason ? `${s.reason}|LIVE_RESCUE_ADD` : "LIVE_RESCUE_ADD";
          signals.push(s);
          continue;
        }
        if (!forceAllSignalsAdd) {
          signalDrops.push({
            ...s,
            bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : Number(barCloseMs),
            qty_pct: s.qty_pct,
            reason: "DROP_IN_POSITION_NO_ADD",
            drop_reason_code: "DROP_IN_POSITION_NO_ADD",
            features_json: { ...(s.features || {}), in_position_side: posSide || null },
            event_intent: intent,
          });
          continue;
        }
        s.features._event_intent = "ADD";
        s.features._in_position_add = true;
        s.reason = s.reason ? `${s.reason}|IN_POSITION_ADD` : "IN_POSITION_ADD";
      }
    }

    signals.push(s);
  }
  let intentsCreated = 0;
  let immediateIntentsCreated = 0;
  const intentExecutionMode = (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")
    ? liveCfg.executionMode
    : "PAPER";
  for (const s of signals) {
    s.features = buildSignalStageFeatures(s, null);
    const intent = intentFromSignal({ event: s.event, side: s.side, features: s.features });
    const intentIsEntry = intent === "ENTRY" || intent === "ADD";
    if (intentIsEntry) {
      s.features = applyCanonicalSourceProvenanceDefaults({
        intent,
        features: s.features,
        sysCfg: sysCfgEffective,
        market: s.symbol_or_pair_id || symbol,
        eventUpper: String(s.event || "").trim().toUpperCase(),
        intentDir: directionFromSignal({ event: s.event, side: s.side }),
        tf: signalTf,
      });
    }
    const effectiveBarMs = Number(s && s.features && s.features._late_origin_bar_close_time_utc_ms) || Number(barCloseMs);
    const signalBarMsRaw = s && s.signal_bar_close_time_utc_ms;
    const signalBarMsParsed = (signalBarMsRaw === null || signalBarMsRaw === undefined) ? null : Number(signalBarMsRaw);
    const signalBarCloseMsForIntent = Number.isFinite(signalBarMsParsed) ? signalBarMsParsed : effectiveBarMs;
    const signalBarCloseUtcForIntent = Number.isFinite(signalBarCloseMsForIntent)
      ? msToUtcZ(signalBarCloseMsForIntent)
      : (s.signal_bar_close_time_utc || barCloseUtc);
    if (backfillExitOnly && intentIsEntry && backfillAllowEntry !== true) {
      if (String(trading_mode || "").toUpperCase() === "EXIT_ONLY") {
        // EXIT_ONLY pass should not consume live entry signals.
        continue;
      }
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: s.qty_pct,
        reason: "BACKFILL_SKIP_ENTRY",
        drop_reason_code: "BACKFILL_SKIP_ENTRY",
        features_json: { ...(s.features || {}), backfill_exit_only: true },
        event_intent: intent,
      });
      continue;
    }
    if (!allowByTradingModeIntent(trading_mode, intent)) continue;

    // Commission Gate v2 soft mode — 시그널 품질 필터 이전에 평가하여 모든 진입 시그널에 대해 증빙 생성
    let _commGateResult = null;
    if (intentIsEntry) {
      try {
        const perfGate = await loadPerformanceGate(exchange);
        const gateEvidence = logCommissionGateEvidence({ phase: "signal_proc_fut", exchange, symbol, event: s.event, perfGate, intentId: s.signal_id || s.id });
        const commScale = resolveCommissionSoftScale(perfGate);
        _commGateResult = { perfGate, commScale, gateId: gateEvidence.gateId };
      } catch (gateErr) {
        console.error("[COMMISSION_GATE][EXCEPTION]", { phase: "signal_proc_fut", exchange, symbol, event: s.event, error: gateErr.message, enforce: COMMISSION_GATE_ENFORCE });
        if (COMMISSION_GATE_ENFORCE) {
          signalDrops.push({
            ...s, bar_close_time_utc_ms: effectiveBarMs, qty_pct: s.qty_pct,
            reason: "DROP_COMMISSION_GATE_ERROR", drop_reason_code: "DROP_COMMISSION_GATE_ERROR",
            features_json: { ...(s.features || {}), gate_error: gateErr.message },
            event_intent: intent,
          });
          continue;
        }
      }
    }

    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: s.event })
      : directionFromSignal({ event: s.event, side: s.side });
    const lateByBars = Number(s && s.features && s.features._late_by_bars);
    if (signalQueueEnabled && Number.isFinite(lateByBars) && lateByBars > signalQueueMaxLateBars) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: s.qty_pct,
        reason: "DROP_STALE_SIGNAL",
        drop_reason_code: "DROP_STALE_SIGNAL",
        features_json: { ...(s.features || {}), late_by_bars: lateByBars, max_late_bars: signalQueueMaxLateBars },
        event_intent: intent,
      });
      continue;
    }

    if (spikeLock && spikeLock.active && (intent === "ENTRY" || intent === "ADD")) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: s.qty_pct,
        reason: "DROP_SPIKE_LOCK",
        drop_reason_code: "DROP_SPIKE_LOCK",
        features_json: { ...(s.features || {}), spike_lock_until_ms: spikeLock.untilMs ?? null, spike_lock_tf: spikeLock.tf || null, spike_lock_move_pct: spikeLock.movePct ?? null },
        event_intent: intent,
      });
      continue;
    }

    if (signalOverlapEnabled && (intent === "ENTRY" || intent === "ADD") && intentDir && Number.isFinite(signalTfMs) && signalOverlapBars > 0) {
      const lastKey = `last_entry_bar_ms_${String(intentDir).toLowerCase()}`;
      const lastBarMs = Number(posMeta && posMeta[lastKey]);
      const currentTier = resolveSignalTierFromEvent(s.event, s.features);
      const lastTierKey = `last_entry_tier_${String(intentDir).toLowerCase()}`;
      const lastTier = Number(posMeta && posMeta[lastTierKey]);
      const isCoreRealOrEarlyEvent = String(s.event || "").toUpperCase().startsWith("CORE_")
        || String(s.event || "").toUpperCase().startsWith("REAL_")
        || isPreRealOrEarlyEventName(s.event, s.features);
      const allowOverlapUpgrade = (Number.isFinite(currentTier) && Number.isFinite(lastTier) && currentTier > lastTier)
        || isCoreRealOrEarlyEvent;
      if (shouldBlockSignalOverlap({ pos, lastBarMs, effectiveBarMs, signalTfMs, signalOverlapBars, allowOverlapUpgrade })) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: s.qty_pct,
          reason: "DROP_OVERLAP",
          drop_reason_code: "DROP_OVERLAP",
          features_json: { ...(s.features || {}), overlap_bars: signalOverlapBars, last_entry_bar_ms: lastBarMs },
          event_intent: intent,
        });
        continue;
      }
    }

    let qtyFraction = useBudget ? normalizeQtyFraction(s.qty_pct) : Number(s.qty_pct);
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) continue;
    const sideScaled = applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget });
    qtyFraction = sideScaled.qtyFraction;
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) continue;
    if (useBudget && qtyFraction > 1) {
      if (riskBudget.onExceed === "SKIP") continue;
      qtyFraction = 1;
    }
    const normalizedEvent = normalizeTpP1EventForExchange(s.event, exchange);
    if (normalizedEvent && normalizedEvent !== s.event) s.event = normalizedEvent;
    const eventUpper = String(normalizedEvent || s.event || "").toUpperCase();
    const actionTag = normalizeActionValue(s.features && s.features.action);
    const allowTrailEntry = forceAllSignalsAdd || allowEntryDuringTrail({ event: s.event, features: s.features, posMeta });
    if (intentIsEntry && (posMeta && (posMeta.trail_active === true || posMeta.tp_p1_done === true)) && !allowTrailEntry) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_TRAIL_ACTIVE_NO_ADD",
        drop_reason_code: "DROP_TRAIL_ACTIVE_NO_ADD",
        features_json: { ...(s.features || {}), trail_active: posMeta.trail_active ?? null, tp_p1_done: posMeta.tp_p1_done ?? null },
        event_intent: intent,
      });
      continue;
    }
    if (intentIsEntry && !actionAllowsEntry(actionTag)) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_ACTION_FILTER",
        drop_reason_code: "DROP_ACTION_FILTER",
        features_json: { ...(s.features || {}), action: actionTag },
        event_intent: intent,
      });
      continue;
    }
    if (intentIsEntry && !isTradeableEventAllowed({ eventUpper, intentDir, allowlist: tradeableSignalTypes })) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_TRADEABLE_SIGNAL_TYPES",
        drop_reason_code: "DROP_TRADEABLE_SIGNAL_TYPES",
        features_json: { ...(s.features || {}), allowlist: tradeableSignalTypes },
        event_intent: intent,
      });
      continue;
    }
    const bypassOppositeEntryCooldown = intentIsEntry
      && shouldBypassOppositeEntryCooldown({ features: s.features, intentDir, posMeta });
    if (intentIsEntry && oppositeCooldownBars > 0 && !hasPositionNow && !bypassOppositeEntryCooldown) {
      const lastExitMs = Number(posMeta && posMeta.last_exit_bar_ms);
      const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
      if (Number.isFinite(lastExitMs) && lastExitDir && Number.isFinite(signalTfMs)) {
        const barsSinceExit = Math.floor((effectiveBarMs - lastExitMs) / signalTfMs);
        if (Number.isFinite(barsSinceExit) && barsSinceExit >= 0 && barsSinceExit <= oppositeCooldownBars) {
          if (intentDir && lastExitDir && intentDir !== lastExitDir) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: effectiveBarMs,
              qty_pct: qtyFraction,
              reason: "DROP_OPPOSITE_COOLDOWN",
              drop_reason_code: "DROP_OPPOSITE_COOLDOWN",
              features_json: {
                ...(s.features || {}),
                last_exit_bar_ms: lastExitMs,
                last_exit_dir: lastExitDir,
                bars_since_exit: barsSinceExit,
                cooldown_bars: oppositeCooldownBars,
              },
              event_intent: intent,
            });
            continue;
          }
        }
      }
    }
    // ── 시간 기반 절대 쿨다운: 방향 반전 시 최소 대기 시간 (타임프레임 무관) ──
    if (intentIsEntry && oppositeTimeCooldownMs > 0 && !hasPositionNow && !bypassOppositeEntryCooldown) {
      const lastExitWallMs = Number(posMeta && posMeta.last_exit_wall_ms);
      const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
      if (Number.isFinite(lastExitWallMs) && lastExitDir && intentDir && lastExitDir !== intentDir) {
        const elapsedMs = resolveEventRefMs(effectiveBarMs, s.bar_close_time_utc_ms) - lastExitWallMs;
        if (elapsedMs >= 0 && elapsedMs < oppositeTimeCooldownMs) {
          console.log(`[OPPOSITE_TIME_COOLDOWN] DROP signal ${exchange} ${symbol} ${s.event} | dir=${intentDir} vs lastExit=${lastExitDir} | elapsed=${Math.floor(elapsedMs / 1000)}s < cooldown=${Math.floor(oppositeTimeCooldownMs / 1000)}s`);
          signalDrops.push({
            ...s,
            bar_close_time_utc_ms: effectiveBarMs,
            qty_pct: qtyFraction,
            reason: "DROP_OPPOSITE_TIME_COOLDOWN",
            drop_reason_code: "DROP_OPPOSITE_TIME_COOLDOWN",
            features_json: {
              ...(s.features || {}),
              last_exit_wall_ms: lastExitWallMs,
              last_exit_dir: lastExitDir,
              elapsed_sec: Math.floor(elapsedMs / 1000),
              cooldown_sec: Math.floor(oppositeTimeCooldownMs / 1000),
            },
            event_intent: intent,
          });
          continue;
        }
      }
    }
    if (intentIsEntry && sameDirectionTrailProfitCooldownCfg.enabled && !hasPositionNow) {
      const sameDirectionCooldown = resolveSameDirectionTrailProfitCooldownBlock({
        cfg: sameDirectionTrailProfitCooldownCfg,
        posMeta,
        intentDir,
        eventRefMs: resolveEventRefMs(effectiveBarMs, s.bar_close_time_utc_ms),
      });
      if (sameDirectionCooldown) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          drop_reason_code: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          features_json: {
            ...(s.features || {}),
            same_direction_trail_profit_exit_dir: sameDirectionCooldown.exit_dir,
            same_direction_trail_profit_exit_wall_ms: sameDirectionCooldown.exit_wall_ms,
            same_direction_trail_profit_exit_event: sameDirectionCooldown.exit_event,
            same_direction_trail_profit_exit_realized_pnl: sameDirectionCooldown.realized_pnl,
            elapsed_sec: Math.floor(sameDirectionCooldown.elapsed_ms / 1000),
            cooldown_sec: Math.floor(sameDirectionCooldown.cooldown_ms / 1000),
          },
          event_intent: intent,
        });
        continue;
      }
    }
    const isTpP1Event = eventUpper === "EXIT_TP_P1" || eventUpper.startsWith("EXIT_TP_P1_");
    if (isTpP1Event && posMeta && posMeta.tp_p1_done === true) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_TP_P1_ALREADY_DONE",
        drop_reason_code: "DROP_TP_P1_ALREADY_DONE",
        features_json: { ...(s.features || {}), tp_p1_done: true },
        event_intent: intent,
      });
      continue;
    }
    if (isTpP1Event && posMeta && posMeta.tp_p1_pending === true) {
      const pendingRefMs = Date.now();
      const pendingState = await getTpP1PendingState({
        exchange,
        symbol,
        tf: signalTf,
        posMeta,
        tpP1PendingHoldMs,
        nowMs: pendingRefMs,
      });
      if (pendingState.active) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_TP_P1_PENDING",
          drop_reason_code: "DROP_TP_P1_PENDING",
          features_json: {
            ...(s.features || {}),
            tp_p1_pending: true,
            tp_p1_pending_at_ms: pendingState.pendingAtMs,
            tp_p1_pending_until_ms: pendingState.pendingUntilMs,
            tp_p1_pending_active_by_intent: pendingState.activeByIntent,
          },
          event_intent: intent,
        });
        continue;
      }
      metaUpdates.tp_p1_pending = false;
      metaUpdates.tp_p1_pending_at_ms = null;
      metaUpdates.tp_p1_pending_until_ms = null;
      metaUpdates.tp_p1_pending_event = null;
    }

    if (autoScore && autoScore.enabled && Number.isFinite(autoScore.scoreMin) && (intent === "ENTRY" || intent === "ADD")) {
      const score = pickSignalScore(s.features);
      if (Number.isFinite(score) && score < autoScore.scoreMin) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_LOW_SCORE",
          drop_reason_code: "DROP_LOW_SCORE",
          features_json: { ...(s.features || {}), score, score_min: autoScore.scoreMin, score_base: autoScore.base ?? null, score_target_wr: autoScore.target ?? null, score_win_rate: autoScore.winRate ?? null },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry && shortGateCfg && shortGateCfg.enabled) {
      const shortGate = evaluateShortEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: shortGateCfg,
      });
      if (!shortGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: shortGate.reason || "DROP_SHORT_GATE",
          drop_reason_code: shortGate.reason || "DROP_SHORT_GATE",
          features_json: { ...(s.features || {}), ...(shortGate.detail || {}), gate_enabled: true, short_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      if (shortGate.detail && shortGate.detail.gate_transition_exception) {
        s.features = { ...(s.features || {}), ...(shortGate.detail || {}), gate_enabled: true, short_gate_enabled: true };
      }
    }

    const features = (s.features && typeof s.features === "object") ? { ...s.features } : {};
    if (intentIsEntry) {
      const canonical = evaluateCanonicalEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        sysCfg: sysCfgEffective,
        market: s.symbol_or_pair_id || symbol,
        tf: signalTf,
      });
      if (!canonical.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          drop_reason_code: canonical.reason || "DROP_CANONICAL_ENGINE",
          features_json: { ...(s.features || {}), ...(canonical.detail || {}) },
          event_intent: intent,
        });
        continue;
      }
      if (canonical.detail) {
        s.features = mergeCanonicalDecisionDetail(s.features, canonical.detail);
        Object.assign(features, canonical.detail || {});
      }
      const quality = evaluateEntryQualityGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: entryQualityCfg,
      });
      if (!quality.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: quality.reason || "DROP_ENTRY_QUALITY",
          drop_reason_code: quality.reason || "DROP_ENTRY_QUALITY",
          features_json: { ...(s.features || {}), ...(quality.detail || {}) },
          event_intent: intent,
        });
        continue;
      }
    }

    // Commission/MDD soft reduction gate — 커미션 게이트 캐시 결과 사용
    if (intentIsEntry && _commGateResult) {
      const { perfGate, commScale, gateId } = _commGateResult;
      if (commScale && commScale.blocked && commScale.scale < 0.9999) {
        const before = qtyFraction;
        qtyFraction = qtyFraction * commScale.scale;
        if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
          signalDrops.push({
            ...s,
            bar_close_time_utc_ms: effectiveBarMs,
            qty_pct: before,
            reason: "DROP_COMMISSION_GATE_ZERO_QTY",
            drop_reason_code: "DROP_COMMISSION_GATE_ZERO_QTY",
            features_json: {
              ...(s.features || {}),
              gate_id: gateId || null,
              commission_ratio: perfGate && perfGate.commissionRatio,
              commission_threshold: COMMISSION_RATIO_THRESHOLD,
              commission_scale: commScale.scale,
              total_fee: perfGate && perfGate.totalFee,
              total_pnl: perfGate && perfGate.totalPnl,
            },
            event_intent: intent,
          });
          continue;
        }
        s.features = {
          ...(s.features || {}),
          gate_id: gateId || null,
          commission_ratio: perfGate && perfGate.commissionRatio,
          commission_threshold: COMMISSION_RATIO_THRESHOLD,
          commission_scale: commScale.scale,
          commission_scaled_in_signal: true,
          total_fee: perfGate && perfGate.totalFee,
          total_pnl: perfGate && perfGate.totalPnl,
        };
        console.warn(`[COMMISSION_GATE][SOFT_REDUCE] signal_fut ${exchange} ${symbol} ${s.event} | qty ${before.toFixed(4)} -> ${qtyFraction.toFixed(4)} | scale=${commScale.scale.toFixed(4)} gate_id=${gateId || "-"}`);
      }
      if (perfGate.mddBlocked && perfGate.mddReduceFactor < 1) {
        const before = qtyFraction;
        qtyFraction = qtyFraction * perfGate.mddReduceFactor;
        s.features = {
          ...(s.features || {}),
          mdd: perfGate.mdd,
          mdd_threshold: MDD_THRESHOLD,
          mdd_reduce_factor: perfGate.mddReduceFactor,
          mdd_scaled_in_signal: true,
        };
        console.log(`[MDD_REDUCE] ${exchange} ${symbol} ${s.event} | mdd=${(perfGate.mdd * 100).toFixed(2)}% < ${(MDD_THRESHOLD * 100).toFixed(0)}% | qty ${before.toFixed(4)} → ${qtyFraction.toFixed(4)} (x${perfGate.mddReduceFactor})`);
      }
    }

    let immediateEntry = false;
    let immediateReason = null;
    let coreProbePatch = null;
    let coreProbeClear = null;
    const signalTimingTier = resolveSignalTier(eventUpper, s.features);
    const isRealEvent = signalTimingTier === "REAL";
    const isPreRealEvent = signalTimingTier === "PRE_REAL";
    const isCoreEvent = signalTimingTier === "CORE";
    const isEarlyEvent = signalTimingTier === "EARLY";
    if (intentIsEntry && isAiRequired(exchange) && !hasAiSignal(s.features)) {
      const aiMissing = resolveAiMissingPolicy({ qtyFraction, features: s.features, sysCfg });
      if (aiMissing.drop) {
        const reason = aiMissing.reason || "DROP_AI_MISSING";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: aiMissing.features,
          event_intent: intent,
        });
        continue;
      }
      const prevQty = qtyFraction;
      qtyFraction = Number(aiMissing.qtyFraction);
      s.features = aiMissing.features;
      if (Number.isFinite(prevQty) && Number.isFinite(qtyFraction) && qtyFraction < prevQty) {
        console.warn(
          `[AI_MISSING][REDUCE] ${exchange} ${symbol} ${s.event} | qty ${prevQty.toFixed(4)} -> ${qtyFraction.toFixed(4)} | scale=${Number(aiMissing.features && aiMissing.features.ai_missing_reduce_pct || AI_MISSING_REDUCE_PCT).toFixed(4)}`
        );
      }
    }

    if (intentIsEntry && aiBiasGateCfg && aiBiasGateCfg.enabled) {
      const aiBiasGate = evaluateAiBiasEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: aiBiasGateCfg,
        riskBudget,
      });
      if (aiBiasGate.detail) {
        s.features = { ...(s.features || {}), ...(aiBiasGate.detail || {}), ai_bias_gate_enabled: true };
        Object.assign(features, aiBiasGate.detail || {});
      }
      if (!aiBiasGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: aiBiasGate.reason || "DROP_AI_BIAS_GATE",
          drop_reason_code: aiBiasGate.reason || "DROP_AI_BIAS_GATE",
          features_json: { ...(s.features || {}), ...(aiBiasGate.detail || {}), ai_bias_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      const aiBiasScale = Number(aiBiasGate.qtyScale);
      if (Number.isFinite(aiBiasScale) && aiBiasScale > 0 && aiBiasScale < 0.9999) {
        const before = qtyFraction;
        qtyFraction = qtyFraction * aiBiasScale;
        s.features = {
          ...(s.features || {}),
          ai_bias_gate_qty_before: before,
          ai_bias_gate_qty_after: qtyFraction,
          market_bias_mult: aiBiasScale,
        };
        Object.assign(features, {
          ai_bias_gate_qty_before: before,
          ai_bias_gate_qty_after: qtyFraction,
          market_bias_mult: aiBiasScale,
        });
      }
    }

    const evGateBypass = shouldBypassEvEntryGate({ intent, features: s.features });
    if (intentIsEntry && evGateCfg && evGateCfg.enabled && evGateBypass) {
      const evGateDetail = {
        ev_gate_enabled: true,
        ev_gate_skipped: true,
        ev_gate_skip_reason: "MANUAL_RETRY_OVERRIDE",
        ev_gate_action: "SKIP",
        ev_gate_qty_scale: 1,
      };
      s.features = { ...(s.features || {}), ...evGateDetail };
      Object.assign(features, evGateDetail);
    }
    if (intentIsEntry && evGateCfg && evGateCfg.enabled && !evGateBypass) {
      let evExitProfile = null;
      try {
        evExitProfile = await resolveAdaptiveFuturesExitProfile({
          exchange,
          symbol,
          tf: signalTf,
          intent,
          event: s.event,
          side: s.side,
          features: s.features,
          nowMs: Number(effectiveBarMs),
          manualProfileMode: liveCfg && liveCfg.exitProfileMode,
        });
      } catch (evExitProfileErr) {
        const evGateDetail = {
          ev_gate_enabled: true,
          ev_gate_exit_profile_resolve_failed: true,
          ev_gate_exit_profile_error: evExitProfileErr && evExitProfileErr.message
            ? String(evExitProfileErr.message)
            : String(evExitProfileErr),
        };
        s.features = { ...(s.features || {}), ...evGateDetail };
        Object.assign(features, evGateDetail);
      }
      const evGateBaseQty = qtyFraction;
      const evExitRulesAdjustment = applyEntryExitRuleRuntimeAdjustments({
        rules: evExitProfile && evExitProfile.rules,
        features: s.features,
        sysCfg,
        cohort: resolveLiveMarketRegimeCohort({ symbol, posMeta }),
        market: symbol,
      });
      const evGate = await evaluateEvEntryGate({
        exchange,
        symbol,
        tf: signalTf,
        barCloseMs: effectiveBarMs,
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: evGateCfg,
        exitRules: evExitRulesAdjustment.appliedExitRules,
        exitProfile: evExitProfile && evExitProfile.profile,
        exitProfileReason: evExitProfile && evExitProfile.reason,
      });
      if (evGate.detail) {
        s.features = { ...(s.features || {}), ...(evGate.detail || {}), ev_gate_enabled: true };
        Object.assign(features, evGate.detail || {});
      }
      if (!evGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: evGate.reason || "DROP_EV_GATE",
          drop_reason_code: evGate.reason || "DROP_EV_GATE",
          features_json: { ...(s.features || {}), ...(evGate.detail || {}), ev_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      const evScale = Number(evGate.qtyScale);
      if (Number.isFinite(evScale) && evScale > 0 && evScale < 0.9999) {
        const evQtyScaleResult = applyEvQtyScale({
          qtyFraction,
          evScale,
          intent,
          event: s.event,
          features: s.features,
        });
        qtyFraction = evQtyScaleResult.qtyFraction;
        s.features = {
          ...(s.features || {}),
          ev_gate_qty_before: evGateBaseQty,
          ev_gate_qty_after: qtyFraction,
          ev_gate_qty_after_suggested: evQtyScaleResult.suggestedQtyFraction,
          ev_gate_qty_scale_applied: evQtyScaleResult.appliedScale,
          ev_gate_qty_scale_suggested: evQtyScaleResult.suggestedScale,
          ev_gate_qty_scale_suppressed_for_fixed: evQtyScaleResult.suppressedForFixed,
          ev_gate_qty_profile: evQtyScaleResult.qtyProfile,
          ev_mult: evQtyScaleResult.appliedScale,
        };
        Object.assign(features, {
          ev_gate_qty_before: evGateBaseQty,
          ev_gate_qty_after: qtyFraction,
          ev_gate_qty_after_suggested: evQtyScaleResult.suggestedQtyFraction,
          ev_gate_qty_scale_applied: evQtyScaleResult.appliedScale,
          ev_gate_qty_scale_suggested: evQtyScaleResult.suggestedScale,
          ev_gate_qty_scale_suppressed_for_fixed: evQtyScaleResult.suppressedForFixed,
          ev_gate_qty_profile: evQtyScaleResult.qtyProfile,
          ev_mult: evQtyScaleResult.appliedScale,
        });
      }
      s.features = {
        ...(s.features || {}),
        market_ev_base_qty: evGateBaseQty,
        market_ev_final_qty: qtyFraction,
        market_ev_final_mult: Number.isFinite(evGateBaseQty) && evGateBaseQty > 0 ? (qtyFraction / evGateBaseQty) : null,
      };
      Object.assign(features, {
        market_ev_base_qty: evGateBaseQty,
        market_ev_final_qty: qtyFraction,
        market_ev_final_mult: Number.isFinite(evGateBaseQty) && evGateBaseQty > 0 ? (qtyFraction / evGateBaseQty) : null,
      });
    }

    if (intentIsEntry && waitOneBarCfg && waitOneBarCfg.enabled) {
      const waitOneBar = evaluateWaitOneBarTiming({
        intent,
        intentDir,
        eventUpper,
        cfg: waitOneBarCfg,
        features: s.features,
      });
      if (waitOneBar.detail) {
        s.features = { ...(s.features || {}), ...(waitOneBar.detail || {}), wait_one_bar_enabled: true };
        Object.assign(features, waitOneBar.detail || {});
      }
      if (!waitOneBar.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          drop_reason_code: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          features_json: { ...(s.features || {}), ...(waitOneBar.detail || {}), wait_one_bar_enabled: true },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry) {
      const policyEval = evaluateLiveEntryPolicy({
        exchange,
        symbol,
        intent,
        qtyPct: qtyFraction,
        features: s.features,
        stage: "RUNNER_SIGNAL",
        applyScale: true,
      });
      if (policyEval && policyEval.featuresPatch && typeof policyEval.featuresPatch === "object") {
        s.features = policyEval.featuresPatch;
        Object.assign(features, policyEval.featuresPatch);
      }
      if (!policyEval || policyEval.ok !== true || !Number.isFinite(Number(policyEval.qtyPctFinal)) || Number(policyEval.qtyPctFinal) <= 0) {
        const reason = String(policyEval && policyEval.reason || "DROP_LIVE_POLICY_BLOCK").trim().toUpperCase() || "DROP_LIVE_POLICY_BLOCK";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: { ...(s.features || {}) },
          event_intent: intent,
        });
        continue;
      }
      qtyFraction = Number(policyEval.qtyPctFinal);
    }

    if (intentIsEntry && immediateCfg.enabled && (isRealEvent || isPreRealEvent || isCoreEvent || isEarlyEvent)) {
      const { coreBuy, realBuy, coreSell, realSell } = resolveScoreLevels({ exchange, features });
      const score = pickSignalScoreExtended(features);
      const confidence = pickSignalConfidence(features);
      const waveConf = pickSignalWaveConf(features);
      const conflict = pickSignalConflict(features);
      const regime = pickSignalRegime(features);
      const volRank = pickSignalVolRank(features);
      const volStrong = volRank === "ultra" || volRank === "strong";
      const dir = intentDir;

      if (isCoreEvent && dir) {
        const probe = getCoreProbeMeta(posMeta, dir);
        if (probe && Number.isFinite(probe.remaining) && probe.remaining > 0) {
          const expired = Number.isFinite(probe.expiresMs) && Number.isFinite(effectiveBarMs) && effectiveBarMs > probe.expiresMs;
          if (expired) {
            coreProbeClear = probe;
          } else if (Number.isFinite(signalTfMs) && Number.isFinite(probe.barMs) && Number.isFinite(effectiveBarMs)) {
            const barsSince = Math.round((effectiveBarMs - probe.barMs) / signalTfMs);
            if (barsSince >= 0 && barsSince <= 1) {
              qtyFraction = Math.min(qtyFraction, probe.remaining);
              coreProbeClear = probe;
              features._core_probe_confirm = true;
              immediateReason = "CORE_CONFIRM_NEXT_BAR";
            }
          }
        }
      }

      if (!immediateReason && isRealEvent && immediateCfg.realEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= (realBuy + immediateCfg.realScoreMargin) : score <= (realSell - immediateCfg.realScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minRealConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minWaveConf : false;
        const regimeOk = regime ? regime === "trend" : false;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && volStrong && conflictOk) {
          immediateEntry = true;
          immediateReason = "REAL_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }

      if (!immediateReason && isPreRealEvent && immediateCfg.preRealEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY"
            ? score >= (coreBuy + immediateCfg.preRealScoreMargin)
            : score <= (coreSell - immediateCfg.preRealScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minPreRealConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minPreRealWaveConf : false;
        const regimeOk = regime ? regime !== "range" : true;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && conflictOk) {
          immediateEntry = true;
          immediateReason = "PRE_REAL_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }

      if (!immediateEntry && !immediateReason && isCoreEvent && immediateCfg.coreEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= (coreBuy + immediateCfg.coreScoreMargin) : score <= (coreSell - immediateCfg.coreScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minCoreConf : false;
        const regimeOk = regime ? regime !== "range" : false;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && regimeOk && volStrong && conflictOk) {
          const fraction = immediateCfg.coreFraction;
          const immediateQty = qtyFraction * fraction;
          const remainingQty = qtyFraction - immediateQty;
          if (Number.isFinite(immediateQty) && immediateQty > 0 && Number.isFinite(remainingQty) && remainingQty > 0) {
            qtyFraction = immediateQty;
            immediateEntry = true;
            immediateReason = "CORE_IMMEDIATE_PROBE";
            coreProbePatch = {
              remaining: remainingQty,
              barMs: Number.isFinite(effectiveBarMs) ? effectiveBarMs : null,
              expiresMs: Number.isFinite(signalTfMs) && Number.isFinite(effectiveBarMs)
                ? (effectiveBarMs + signalTfMs)
                : null,
            };
            features._core_probe_fraction = fraction;
            features._entry_exec_timing = "IMMEDIATE";
          }
        }
      }

      if (!immediateEntry && !immediateReason && isEarlyEvent && immediateCfg.earlyEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= immediateCfg.earlyScoreAbs : score <= -immediateCfg.earlyScoreAbs)
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minEarlyConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minEarlyWaveConf : false;
        const regimeOk = regime ? regime !== "range" : true;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && conflictOk) {
          immediateEntry = true;
          immediateReason = "EARLY_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }
    }

    if (coreProbeClear && coreProbeClear.base) {
      metaUpdates[`${coreProbeClear.base}_remaining_pct`] = 0;
      metaUpdates[`${coreProbeClear.base}_bar_ms`] = null;
      metaUpdates[`${coreProbeClear.base}_expires_ms`] = null;
    }

    if (coreProbePatch && intentDir) {
      const base = `core_probe_${String(intentDir).toLowerCase()}`;
      metaUpdates[`${base}_remaining_pct`] = coreProbePatch.remaining;
      metaUpdates[`${base}_bar_ms`] = coreProbePatch.barMs;
      metaUpdates[`${base}_expires_ms`] = coreProbePatch.expiresMs;
    }

    if (intentDir && (intent === "ENTRY" || intent === "ADD") && Number.isFinite(effectiveBarMs)) {
      const lastKey = `last_entry_bar_ms_${String(intentDir).toLowerCase()}`;
      metaUpdates[lastKey] = effectiveBarMs;
      const tier = resolveSignalTierFromEvent(s.event, s.features);
      if (Number.isFinite(tier)) {
        const tierKey = `last_entry_tier_${String(intentDir).toLowerCase()}`;
        const prevTier = Number(posMeta && posMeta[tierKey]);
        metaUpdates[tierKey] = Number.isFinite(prevTier) ? Math.max(prevTier, tier) : tier;
      }
    }

    if (!s.signal_id) {
      const savedSignal = await upsertSignal({
        exchange,
        symbol,
        tf,
        barCloseTimeUtc: signalBarCloseUtcForIntent,
        barCloseTimeUtcMs: signalBarCloseMsForIntent,
        event: s.event,
        side: s.side,
        qtyPct: qtyFraction,
        reason: s.reason || "INTERNAL_SIGNAL",
        features,
        executionMode: intentExecutionMode,
        source: "SERVER",
        authoritative: true,
        runId,
        decisionReason: s.reason || "INTERNAL_SIGNAL",
      });
      if (savedSignal && savedSignal.signal_id) {
        s.signal_id = savedSignal.signal_id;
        if (!s.signal_doc_id) s.signal_doc_id = savedSignal.signal_id;
        if (!features.signal_id) features.signal_id = savedSignal.signal_id;
        if (!features.signal_doc_id) features.signal_doc_id = s.signal_doc_id;
      }
      if (savedSignal && savedSignal.signal_id && (savedSignal.decision === "CREATED" || savedSignal.decision === "UPDATED_CHANGED")) {
        sendSignalReceivedAlert({
          exchange,
          symbol,
          tf,
          event: s.event,
          side: s.side,
          qtyPct: qtyFraction,
          reason: s.reason || "INTERNAL_SIGNAL",
          signalId: savedSignal.signal_id,
          executionMode: intentExecutionMode,
          source: "SERVER",
          authoritative: true,
        }).catch((err) => {
          console.warn("[SIGNAL_RECEIVED_ALERT_FAIL]", err?.message || err);
        });
      }
    }

    const isImmediateExit = exitImmediateEnabled && intent === "EXIT";
    const isExternalSignal = !!s.signal_id;
    const execOnCurrentBar = intentIsEntry && isExternalSignal && Number.isFinite(effectiveBarMs) && Number.isFinite(execBarCloseMs)
      && effectiveBarMs <= execBarCloseMs;
    const isImmediateEntry = immediateEntry === true || execOnCurrentBar;
    if (execOnCurrentBar && features._entry_exec_timing == null) {
      features._entry_exec_timing = "EXEC_CURRENT_BAR";
    }
    const nextExecMsFromSignal = (Number.isFinite(execTfMs) && Number.isFinite(signalBarCloseMsForIntent))
      ? addMs(signalBarCloseMsForIntent, execTfMs)
      : nextExecMs;
    const execBarCloseMsForIntent = (isImmediateExit || isImmediateEntry)
      ? execBarCloseMs
      : (Number.isFinite(nextExecMsFromSignal) ? Math.max(nextExecMsFromSignal, execBarCloseMs) : nextExecMs);
    const execBarCloseUtcForIntent = Number.isFinite(execBarCloseMsForIntent)
      ? msToUtcZ(execBarCloseMsForIntent)
      : execBarCloseUtc;
    // EXIT_ONLY tick loop retries must not reuse a canceled hourly intent id.
    const intentSignalBarCloseMs = (isImmediateExit && backfillExitOnly === true && Number.isFinite(execBarCloseMsForIntent))
      ? Number(execBarCloseMsForIntent)
      : signalBarCloseMsForIntent;
    const intentSignalBarCloseUtc = Number.isFinite(intentSignalBarCloseMs)
      ? msToUtcZ(intentSignalBarCloseMs)
      : signalBarCloseUtcForIntent;
    const pendingReason = isImmediateExit
      ? "IMMEDIATE_EXEC"
      : (isImmediateEntry ? (execOnCurrentBar ? "EXEC_CURRENT_BAR" : (immediateReason || "IMMEDIATE_ENTRY")) : "WAIT_NEXT_BAR");
    const pendingNote = (isImmediateExit || isImmediateEntry)
      ? `immediate_exec=${execBarCloseUtcForIntent}`
      : `next_exec=${execBarCloseUtcForIntent}`;
    if (intent === "EXIT") {
      const linkedEntryEventId = String(
        (features.entry_event_id || posMeta.entry_event_id || "")
      ).trim();
      const linkedEntrySignalType = String(
        (features.entry_signal_type || posMeta.entry_signal_type || "")
      ).toUpperCase();
      const linkedEntryGrade = String(
        (features.entry_grade || posMeta.entry_grade || posMeta.entry_timing_tier || "")
      ).toUpperCase();
      const linkedEntryQtyProfile = String(
        (features.entry_qty_profile || posMeta.entry_qty_profile || posMeta.entry_qty_tier || "")
      ).toUpperCase();
      if (linkedEntryEventId && !features.entry_event_id) features.entry_event_id = linkedEntryEventId;
      if (linkedEntrySignalType && !features.entry_signal_type) features.entry_signal_type = linkedEntrySignalType;
      if (linkedEntryGrade && !features.entry_grade) features.entry_grade = linkedEntryGrade;
      if (linkedEntryQtyProfile && !features.entry_qty_profile) features.entry_qty_profile = linkedEntryQtyProfile;
    }

    if (isTpP1Event && intent === "EXIT") {
      const pendingAtMs = Date.now();
      metaUpdates.tp_p1_pending = true;
      metaUpdates.tp_p1_pending_at_ms = Number.isFinite(pendingAtMs) ? pendingAtMs : null;
      metaUpdates.tp_p1_pending_until_ms = Number.isFinite(pendingAtMs) ? (pendingAtMs + tpP1PendingHoldMs) : null;
      metaUpdates.tp_p1_pending_event = s.event;
    }

    if (isImmediateEntry || immediateReason === "CORE_CONFIRM_NEXT_BAR") {
      console.log(
        `[immediate_entry] ex=${exchange} sym=${symbol} tf=${tf} ev=${s.event} side=${s.side} qty=${qtyFraction} reason=${execOnCurrentBar ? "EXEC_CURRENT_BAR" : (immediateReason || "IMMEDIATE_ENTRY")} sched=${execBarCloseUtcForIntent}`
      );
    }
    if (!isImmediateExit && !isImmediateEntry && isExternalSignal && intentIsEntry) {
      console.log(
        `[intent_scheduled] ex=${exchange} sym=${symbol} tf=${tf} ev=${s.event} side=${s.side} qty=${qtyFraction} reason=${pendingReason} sched=${execBarCloseUtcForIntent}`
      );
    }

    const rescueAddCommitGuard = evaluateCommittedRescueAddGate({
      applied: intent === "ADD" && (s.features._rescue_add_applied === true || s.features._replay_rescue_add_applied === true),
      replay: s.features._replay_rescue_add_applied === true,
      pendingAddCount: committedRescueAddCount,
      pendingAddSignalBarMs: committedRescueAddSignalBarMs,
      signalBarCloseMs: intentSignalBarCloseMs,
      maxAdds: s.features._rescue_add_applied === true
        ? s.features._rescue_add_max_adds
        : s.features._replay_rescue_add_max_adds,
      sameBarBlock: s.features._rescue_add_applied === true
        ? s.features._rescue_add_same_bar_block
        : s.features._replay_rescue_add_same_bar_block,
    });
    if (!rescueAddCommitGuard.ok) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: rescueAddCommitGuard.reason || "RESCUE_ADD_BLOCKED",
        drop_reason_code: rescueAddCommitGuard.reason || "RESCUE_ADD_BLOCKED",
        features_json: {
          ...(s.features || {}),
          rescue_add_commit_guard: rescueAddCommitGuard.detail || null,
        },
        event_intent: intent,
      });
      continue;
    }

    await upsertIntent({
      exchange,
      symbol,
      tf,
      signalBarCloseTimeUtc: intentSignalBarCloseUtc,
      signalBarCloseTimeUtcMs: intentSignalBarCloseMs,
      scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
      scheduledExecBarCloseUtcMs: execBarCloseMsForIntent,
      event: s.event,
      side: s.side,
      qtyPct: qtyFraction,
      reason: s.reason || "SIGNAL",
      features,
      signalId: s.signal_id || (features && features.signal_id) || null,
      runId,
      executionMode: intentExecutionMode,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: useBudget ? (riskBudget.maxKrw * qtyFraction) : null,
      qtyFraction: useBudget ? qtyFraction : null,
      signalPrice: Number(bar && (bar.close ?? bar.c)),
      signalDocId: s.signal_doc_id || null,
      pendingReason,
      pendingNote,
      ttlMs,
      execTf: execTfFinal,
      decisionReason: s.reason || "INTENT_CREATED",
    });

    sendSignalProgressAlert({
      exchange,
      symbol,
      tf,
      event: s.event,
      side: s.side,
      qtyPct: qtyFraction,
      signalId: s.signal_id || (features && features.signal_id) || null,
      executionMode: intentExecutionMode,
      source: "SERVER",
      authoritative: true,
      progressReason: "INTENT_CREATED",
      pendingReason,
      scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
    }).catch((err) => {
      console.warn("[SIGNAL_PROGRESS_ALERT_FAIL]", err?.message || err);
    });

    if (intent === "ADD" && (s.features._rescue_add_applied === true || s.features._replay_rescue_add_applied === true)) {
      committedRescueAddCount += 1;
      committedRescueAddSignalBarMs = Number.isFinite(Number(intentSignalBarCloseMs))
        ? Number(intentSignalBarCloseMs)
        : committedRescueAddSignalBarMs;
    }

    if (s.signal_id) {
      const lock = await tryLockSignal({ signalId: s.signal_id, runId });
      if (lock && lock.ok) {
        await markSignalConsumed({
          signalId: s.signal_id,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs: execBarCloseMsForIntent,
          execBarCloseUtc: execBarCloseUtcForIntent,
          reason: "INTENT_CREATED",
          meta: { intent: intent || null },
        });
      }
    }

    intentsCreated += 1;
    if (isImmediateEntry) immediateIntentsCreated += 1;
  }
  if (signalDrops.length) {
    await recordSignalDrops({
      exchange,
      symbol,
      tf: signalTf,
      runId,
      drops: signalDrops.map((d) => ({ ...d, execution_mode: intentExecutionMode })),
    });
    await consumeDroppedSignals({
      drops: signalDrops,
      runId,
      execBarCloseMs,
      execBarCloseUtc,
    });
  }

  if (Object.keys(metaUpdates).length) {
    const merged = mergeMeta(posMeta, metaUpdates);
    await upsertPosition({
      exchange,
      symbol,
      state: pos.state,
      positionSide: pos.position_side || posSide || null,
      sizePct: pos.size_pct,
      avgPrice: pos.avg_price,
      qtyBase: pos.qty_base ?? null,
      runId,
      executionMode: intentExecutionMode,
      budgetMaxKrw: pos.budget_max_krw ?? null,
      budgetUsedKrw: pos.budget_used_krw ?? null,
      budgetSource: pos.budget_source ?? null,
      meta: merged,
    });
    posMeta = merged;
  }

  if (exitImmediateEnabled || immediateIntentsCreated > 0) {
    const immediateIntents = await listPendingIntentsForExec({
      exchange,
      symbol,
      tf: signalTf,
      execBarCloseMs,
      limitN: 50,
    });
    if (Array.isArray(immediateIntents) && immediateIntents.length) {
      await executeIntentList(sortIntentsForExecution(immediateIntents));
      pos = await getPosition({ exchange, symbol });
      posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : posMeta;
      posSide = normalizePositionSide(
        pos.position_side ||
        pos.side ||
        (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
      );
      if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
      posQtyBase = resolvePosQtyBase(pos);
    }
  }

  const trailUpdates = computeTrailingMetaUpdate({ exchange, bar, position: pos, posMeta, positionSideFallback: posSide });
  if (trailUpdates) {
    const merged = mergeMeta(posMeta, trailUpdates);
    await upsertPosition({
      exchange,
      symbol,
      state: pos.state,
      positionSide: pos.position_side || posSide || null,
      sizePct: pos.size_pct,
      avgPrice: pos.avg_price,
      qtyBase: pos.qty_base ?? null,
      runId,
      executionMode: intentExecutionMode,
      budgetMaxKrw: pos.budget_max_krw ?? null,
      budgetUsedKrw: pos.budget_used_krw ?? null,
      budgetSource: pos.budget_source ?? null,
      meta: merged,
    });
    posMeta = merged;
  }

  return {
    fills_executed: fillsExecuted,
    intents_created: intentsCreated,
    signals_seen: signals.length,
    signals_external: externalSignals.length,
    signals_internal: internalSignals.length,
    signals_external_late: lateSignals,
    signal_drop_n: signalDrops.length,
    signal_drop_reason_counts: signalDrops.reduce((acc, row) => {
      const reason = String(row && (row.drop_reason_code || row.reason) || "UNKNOWN");
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {}),
    top_signal_drop_reason: signalDrops.length
      ? Object.entries(signalDrops.reduce((acc, row) => {
        const reason = String(row && (row.drop_reason_code || row.reason) || "UNKNOWN");
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {})).sort((a, b) => b[1] - a[1])[0][0]
      : null,
  };
}

module.exports = {
  runPaperUpbitForBar,
  runPaperFuturesForBar,
  syncFuturesPositionOnly,
  refreshBinanceNativeProtectionWithRetry,
  buildNativeProtectionMetaPatch,
  notifyNativeProtectionResult,
  resolveLiveFuturesConfig,
  __test: {
    applyAddRiskMetaOnFill,
    buildTimeStopExitSignal,
    buildNativeProtectionMetaPatch,
    inferEntryMetaDirection,
    canEvaluateInternalExitSignalsForBar,
    finalizeInternalSignals,
    scaleBaseBarCountByTf,
    resolveTfFromMs,
    resolveBinanceMaxHoldBars,
    resolveForceAllSignalsAdd,
    hasAiSignal,
    isAiRequired,
    resolveAiMissingPolicy,
    isManualRetryFeatures,
    resolveAddRiskConfig,
    ensureLogicalAddCapState,
    resolveCurrentQtyPctForCap,
    resolveLogicalCurrentQtyPctForBudget,
    resolveSyncedAddChainBaseQtyPct,
    resolveBudgetUsedFromNotional,
    resolveBinanceBudgetUsedKrw,
    evaluateAddIntentRiskGuard,
    resolveLiveRescueAddConfig,
    resolveReplayRescueAddConfig,
    isCoreOrRealEvent,
    resolveSameDirectionTrailProfitCooldownConfig,
    buildSameDirectionTrailProfitCooldownMetaPatch,
    resolveSameDirectionTrailProfitCooldownBlock,
    evaluateLiveRescueAdd,
    evaluateReplayRescueAdd,
    resolveEvGateConfig,
    resolveEvGateDecision,
    resolveEvGateTradePlan,
    applyEvQtyScale,
    restoreFixedEntryQtyFraction,
    shouldBypassEvEntryGate,
    buildSignalStageFeatures,
    evaluateEvEntryGate,
    resolveWaitOneBarConfig,
    evaluateWaitOneBarTiming,
    resolveAiBiasEntryGateConfig,
    evaluateAiBiasEntryGate,
    resolveShortEntryGateConfig,
    evaluateShortEntryGate,
    resolveEntryQualityGateConfig,
    evaluateEntryQualityGate,
    resolveCanonicalEntryConfig,
    evaluateCanonicalEntryGate,
    mergeCanonicalDecisionDetail,
    resolvePineStage1BundleMeta,
    resolveSignalTier,
    resolveEntryQualityTier,
    resolveEntryTierBudgetMax,
    evaluateCommittedRescueAddGate,
    collectActivePendingAddIntentState,
    applyAddAndProtectionMetaOnFill,
    isBinanceImmediateTriggerError,
    resolveManualRetryQtyBase,
    resolveEventRefMs,
    shouldBypassOppositeEntryCooldown,
    shouldBlockSignalOverlap,
    resolveOppositeCooldownWindow,
    resolveOppositeCooldownWindowFromPosition,
    resolveLiveMarketRegimeCohort,
    resolveTp1LadderConfig,
    resolveTp1LadderRuntimeState,
    resolveTp1LadderKpiForContext,
    collectCriticalExitRuleViolations,
    shouldRepairActiveExitRuntimeState,
    repairActivePositionExitRuntimeState,
    applyEntryExitRuleRuntimeAdjustments,
    loadTp1LadderKpiSnapshot,
    resolveStructureInitialStopPrice,
    resolveInitialStopSource,
    sendRescueAddRepriceAlert,
    notifyNativeProtectionResult,
    normalizeSignalStateToken,
    pickSignalRegime,
    isBinanceMultiAssetsIsolatedMarginBlocked,
    isBinanceMarginTypeOpenOrdersConflict,
    resolveRecentExternalFlatSyncGuard,
    normalizeEntryLineage,
    buildEntryLineageMetaPatch,
    resolveEntryLineageForFill,
    extractEntryLineageCandidate,
    resolveRiskBudget,
  },
};

// Backward-compatible alias
// - scheduler.js 는 runPaperMarket 이름으로 import/call 하고 있다.
// - 내부 구현은 runPaperUpbitForBar 를 그대로 사용한다.
const { runPaperKiwoomForBar } = require("./paperKiwoomRunner");

async function runPaperMarket(opts) {
  const ex = String(opts && opts.exchange || "BINANCEFUT").toUpperCase();
  if (ex.includes("BINANCE")) return runPaperFuturesForBar(opts);
  if (ex.includes("KIWOOM")) return runPaperKiwoomForBar(opts);
  return runPaperFuturesForBar(opts);
}

module.exports.runPaperMarket = runPaperMarket;
