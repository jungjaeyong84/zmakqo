const express = require("express");
const { getFirestore } = require("../storage/firestore");
const { getRiskBudgetForProvider, getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { resolveExchangeFromReq, resolveRuntimeMarketsForExchange, resolveRuntimeTfContext } = require("../utils/resolveExchange");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { tfToMs, normalizeMarketSymbolForProvider } = require("../utils/marketConfig");
const { getPnlScopeDays, getPnlSourcePolicy } = require("../services/pnlPolicy");
const { resolveRealizedRowsByMarket } = require("../services/realizedPnlResolver");
const { resolveEventMapping } = require("../services/signalMapping");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { toKstString, kstStartOfDayMs } = require("../utils/timeKst");
const { normalizeProviderId } = require("../utils/providerUtils");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { buildKpiLatestByMarket } = require("../utils/kpiLatestView");
const { buildExitStageView } = require("../utils/exitStageView");
const { buildSignalDisplayReason } = require("../utils/signalReasonView");
const { buildFillDisplayReason } = require("../utils/fillReasonView");
const { isPendingIntentExpired, resolveIntentStatusForView, isActivePendingIntent } = require("../utils/intentView");
const {
  resolvePositionLeverage,
  resolvePositionLeverageReason,
  resolveFillLeverage,
  resolveFillLeverageReason,
  resolveLeverageTier,
  buildLeverageSummary,
  resolvePositionRollback,
  buildRollbackSummary,
} = require("../utils/leverageView");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");

function toMsSafe(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

function computeMappingOk(entry) {
  if (!entry || !entry.event) return null;
  const mapping = resolveEventMapping({ event: entry.event, side: entry.side });
  return mapping.ok === true;
}

function latestMs(rows, fields) {
  let max = null;
  for (const r of rows || []) {
    for (const f of fields) {
      const v = r && r[f] !== undefined ? r[f] : null;
      const ms = toMsSafe(v);
      if (ms == null) continue;
      if (max == null || ms > max) max = ms;
    }
  }
  return max;
}

function meanFinite(arr) {
  const nums = (arr || []).filter((x) => Number.isFinite(Number(x))).map(Number);
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

function isShadowSignal(entry) {
  if (!entry) return false;
  const source = String(entry.source || "").toUpperCase();
  return entry.authoritative !== true && source === "PINE_SHADOW";
}

function normalizeStatus(v) {
  const s = String(v || "").toUpperCase();
  return s || null;
}

function buildIntentStatusLookup({ intents = [], exchange, tfDefault } = {}) {
  const exNorm = normalizeProviderId(exchange || "");
  const normalizeMarket = (raw) => normalizeMarketSymbolForProvider(raw, exNorm);
  const keyOf = ({ market, tf, barMs, event }) => {
    const mk = normalizeMarket(market || "");
    const ms = Number(barMs);
    const ev = String(event || "").toUpperCase();
    const tfNorm = String(tf || tfDefault || defaultExecTfFromEnv() || "15m");
    if (!mk || !Number.isFinite(ms) || !ev) return null;
    return `${mk}__${tfNorm}__${ms}__${ev}`;
  };
  const statusWeight = (intent) => {
    const s = normalizeStatus(resolveIntentStatusForView(intent, Date.now()) || (intent && intent.status));
    if (s === "PENDING") return 3;
    if (s === "FILLED") return 2;
    if (s === "CANCELED") return 1;
    return 0;
  };

  const map = new Map();
  for (const it of intents || []) {
    const key = keyOf({
      market: it.symbol_or_pair_id || it.symbol || it.market,
      tf: it.tf,
      barMs: it.signal_bar_close_time_utc_ms,
      event: it.event,
    });
    if (!key) continue;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, it);
      continue;
    }
    const wCur = statusWeight(cur);
    const wNew = statusWeight(it);
    if (wNew > wCur) {
      map.set(key, it);
      continue;
    }
    if (wNew === wCur) {
      const curMs = toMsSafe(cur.updated_at || cur.created_at || cur.signal_bar_close_time_utc_ms) || 0;
      const newMs = toMsSafe(it.updated_at || it.created_at || it.signal_bar_close_time_utc_ms) || 0;
      if (newMs >= curMs) map.set(key, it);
    }
  }

  return {
    resolveForSignal(signal) {
      if (!signal) return null;
      const key = keyOf({
        market: signal.symbol_or_pair_id || signal.symbol || signal.market,
        tf: signal.tf,
        barMs: signal.bar_close_time_utc_ms,
        event: signal.event,
      });
      if (!key) return null;
      return map.get(key) || null;
    },
  };
}

const apiStateCache = new Map();
const apiStateTtlMs = Number(process.env.API_STATE_CACHE_MS || 10000);

async function topN(db, col, n) {
  const snap = await db.collection(col).orderBy("created_at", "desc").limit(n).get();
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...(d.data() || {}) }));
  return out;
}

async function parseMarketsFromSettings(exchange) {
  const markets = await resolveRuntimeMarketsForExchange(exchange, 2000);
  return markets && markets.length ? markets : [];
}

function createStateRoutes() {
  const router = express.Router();

  async function renderTrading(req, res) {
    try {
      const showShadowSignals = String(req.query.shadow || "").trim() === "1";
      const db = getFirestore();
      const { exchange } = await resolveExchangeFromReq(req, 2000);
      const exchangeNorm = normalizeProviderId(exchange);
      const markets = await parseMarketsFromSettings(exchange);
      const exCfg = await getExchangeSettingsForProvider(exchange, 2000);
      const { signalTf: tfDefault, execTf } = await resolveRuntimeTfContext(req, exchange, {
        fallback: (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m",
        ttlMs: 2000,
      });
      const tfMs = tfToMs(tfDefault) || 15 * 60 * 1000;
      const isBinanceExchange = String(exchangeNorm || "").includes("BINANCE");
      const defaultFuturesLeverage = (() => {
        const lev = Number(exCfg && exCfg.futures_leverage);
        if (Number.isFinite(lev) && lev > 0) return lev;
        return isBinanceExchange ? 2 : 1;
      })();

      // Fetch latest windows (without composite indexes)
      const [signals, intents, fills, drops] = await Promise.all([
        topN(db, "signals", 200),
        topN(db, "order_intents_paper", 300),
        topN(db, "fills_paper", 300),
        topN(db, "signals_dropped", 200),
      ]);
      const resolveItemExchange = (item) => {
        const exRaw = String(item && item.exchange ? item.exchange : "").toUpperCase();
        if (exRaw) return normalizeProviderId(exRaw);
        const mkRaw = String(item && (item.symbol_or_pair_id || item.symbol || item.market) ? (item.symbol_or_pair_id || item.symbol || item.market) : "");
        return normalizeProviderId(inferExchangeFromMarket(mkRaw));
      };
      const filterByExchange = (arr) => (arr || []).filter((x) => resolveItemExchange(x) === exchangeNorm);
      const filterLiveOnly = (arr) => filterByExchange(arr).filter((x) => isLiveDocForExchange(exchangeNorm, x));
      const signalsFiltered = filterByExchange(signals);
      const signalsVisible = showShadowSignals ? signalsFiltered : signalsFiltered.filter((x) => !isShadowSignal(x));
      const dropsFiltered = filterByExchange(drops);
      const intentsFiltered = filterLiveOnly(intents);
      const fillsFiltered = filterLiveOnly(fills);
      const intentLookup = buildIntentStatusLookup({ intents: intentsFiltered, exchange: exchangeNorm, tfDefault });
      const signalsMerged = [
        ...signalsVisible.map((x) => ({ ...x, _signal_source: "SIGNAL" })),
        ...dropsFiltered.map((x) => ({ ...x, _signal_source: "DROP" })),
      ].sort((a, b) => {
        const aMs = toMsSafe(a.created_at || a.created_kst || a.bar_close_time_utc_ms) || 0;
        const bMs = toMsSafe(b.created_at || b.created_kst || b.bar_close_time_utc_ms) || 0;
        return bMs - aMs;
      });

      const nowMs = Date.now();
      const intentSummary = {
        // Exchange + live scope only. Mixed-scope totals make the trading page misleading.
        total: intentsFiltered.length,
        pending: intentsFiltered.filter((x) => isActivePendingIntent(x, nowMs)).length,
        filled: intentsFiltered.filter((x) => String(x.status || "").toUpperCase() === "FILLED").length,
        canceled: intentsFiltered.filter((x) => resolveIntentStatusForView(x, nowMs) === "CANCELED").length,
        expired_pending: intentsFiltered.filter((x) => {
          return isPendingIntentExpired(x, nowMs);
        }).length,
      };

      // positions: docId direct lookup (POS__BINANCEFUT__BTCUSDT)
      const posDocs = await Promise.all(
        markets.map((mk) => db.collection("positions_paper").doc(`POS__${exchange}__${mk}`).get())
      );
      const positionsByMarket = {};
      markets.forEach((mk, i) => {
        const d = posDocs[i];
        const data = d.exists ? (d.data() || {}) : null;
        positionsByMarket[mk] = (data && isLiveDocForExchange(exchange, data)) ? data : null;
      });

      // KPI latest (market별 요약)
      const kpiSnap = await db.collection("kpi_latest").select("market", "kpi", "computed_at", "exchange", "tf").get();
      const kpiByMarket = buildKpiLatestByMarket({ snap: kpiSnap, exchange: exchangeNorm, execTf });
      const kpiRows = markets.map((mk) => ({
        market: mk,
        kpi: kpiByMarket[mk] ? kpiByMarket[mk].kpi : null,
        computed_at: kpiByMarket[mk] ? kpiByMarket[mk].computed_at : null,
      }));
      const kpiList = kpiRows.filter((r) => r.kpi && Number.isFinite(Number(r.kpi.n)));
      const KPI_MIN_N = Number(process.env.KPI_MIN_N || 20);
      const avgWinRate = meanFinite(kpiList.map((r) => r.kpi.win_rate));
      const avgEv = meanFinite(kpiList.map((r) => r.kpi.ev));
      const avgMdd = meanFinite(kpiList.map((r) => r.kpi.mdd));
      const worstTailVals = kpiList.map((r) => r.kpi && r.kpi.tail ? r.kpi.tail.worst : null)
        .filter((x) => Number.isFinite(Number(x))).map(Number);
      const worstTail = worstTailVals.length ? Math.min(...worstTailVals) : null;
      const nVals = kpiList.map((r) => Number(r.kpi.n)).filter((x) => Number.isFinite(x));
      const minN = nVals.length ? Math.min(...nVals) : 0;
      const statusCounts = {};
      for (const r of kpiList) {
        const st = String(r.kpi.status || "INCONCLUSIVE").toUpperCase();
        statusCounts[st] = (statusCounts[st] || 0) + 1;
      }
      const noData = Math.max(0, markets.length - kpiList.length);
      if (noData > 0) statusCounts.NO_DATA = (statusCounts.NO_DATA || 0) + noData;
      const statusText = Object.entries(statusCounts)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      const computedMs = kpiList
        .map((r) => toMsSafe(r.computed_at))
        .filter((x) => Number.isFinite(x));
      const lastComputedMs = computedMs.length ? Math.max(...computedMs) : null;
      const readyMarkets = kpiList.filter((r) => Number(r.kpi.n || 0) >= KPI_MIN_N).length;
      const kpiSummary = {
        total_markets: markets.length,
        kpi_markets: kpiList.length,
        min_n: minN,
        kpi_min_n: KPI_MIN_N,
        ready_markets: readyMarkets,
        avg_win_rate: avgWinRate,
        avg_ev: avgEv,
        avg_mdd: avgMdd,
        worst_tail: worstTail,
        status_text: statusText || null,
        last_computed_kst: toKstString(lastComputedMs),
      };

      // Market rows (latest signal/fill + pending intents)
      const normalizeMarket = (raw) => normalizeMarketSymbolForProvider(raw, exchangeNorm);
      const rows = markets.map((mk) => {
        const lastSignal = signalsMerged.find((x) => normalizeMarket(x.symbol_or_pair_id || x.symbol || x.market || "") === mk) || null;
        const lastFill = fillsFiltered.find((x) => normalizeMarket(x.symbol || x.symbol_or_pair_id || x.market || "") === mk) || null;

        const pendings = intentsFiltered
          .filter((x) => normalizeMarket(x.symbol_or_pair_id || x.symbol || x.market || "") === mk && isActivePendingIntent(x, nowMs))
          .slice(0, 5);

        const pos = positionsByMarket[mk];
        const state = pos ? (pos.position_state || pos.state || null) : null;
        const sizePct = pos ? (pos.size_pct ?? pos.sizePct ?? null) : null;
        const avgPrice = pos ? (pos.avg_price ?? pos.avgPrice ?? null) : null;
        const positionLeverage = resolvePositionLeverage(pos, {
          fallback: isBinanceExchange ? defaultFuturesLeverage : 1,
        });
        const positionLeverageTier = resolveLeverageTier(positionLeverage);
        const positionLeverageReason = resolvePositionLeverageReason(pos);
        const fillLeverage = resolveFillLeverage(lastFill, {
          position: pos,
          fallback: positionLeverage,
        });
        const fillLeverageTier = resolveLeverageTier(fillLeverage);
        const fillLeverageReason = resolveFillLeverageReason(lastFill, { position: pos });
        const rollback = resolvePositionRollback(pos);
        const exitStage = buildExitStageView({
          exchange,
          position: pos,
          leverageFallback: isBinanceExchange ? defaultFuturesLeverage : 1,
        });

        return {
          market: mk,
          exchange,
          tf: tfDefault,
          position: pos,
          position_state: state,
          position_size_pct: sizePct,
          position_avg_price: avgPrice,
          position_leverage: positionLeverage,
          position_leverage_tier: positionLeverageTier,
          position_leverage_reason: positionLeverageReason,
          position_rollback_active: rollback.active,
          position_rollback_until_ms: rollback.until_ms,
          position_rollback_remaining_ms: rollback.remaining_ms,
          position_rollback_reason: rollback.reason,
          exit_stage: exitStage,
          last_signal: lastSignal ? {
            ...lastSignal,
            event_intent: lastSignal.event_intent ?? null,
            mapping_ok: computeMappingOk(lastSignal),
            late_by_bars: lastSignal.features_json ? lastSignal.features_json._late_by_bars : null,
          } : null,
          last_fill: lastFill ? {
            ...lastFill,
            signal_price: (lastFill.signal_price != null) ? Number(lastFill.signal_price) : null,
            signal_price_diff: (lastFill.signal_price_diff != null) ? Number(lastFill.signal_price_diff) : null,
            signal_price_diff_pct: (lastFill.signal_price_diff_pct != null) ? Number(lastFill.signal_price_diff_pct) : null,
            leverage_applied: fillLeverage,
            leverage_tier: fillLeverageTier,
            leverage_reason: fillLeverageReason,
          } : null,
          fill_leverage: fillLeverage,
          pending_intents: pendings.map((p) => ({
            ...p,
            scheduled_exec_bar_close_time_utc_ms: p.scheduled_exec_bar_close_time_utc_ms ?? null,
            expires_at: p.expires_at ?? null,
            pending_reason: p.pending_reason ?? null,
            status_reason: p.status_reason ?? null,
          })),
          _view: {
            last_signal_ts: toKstString(lastSignal?.created_kst || lastSignal?.created_at, { fallbackToString: true }),
            last_fill_ts: toKstString(lastFill?.created_kst || lastFill?.created_at, { fallbackToString: true }),
          },
        };
      });
      // Show current leverage posture for all monitored markets (active count is still separate).
      const leverageSummary = buildLeverageSummary(rows, { includeFlat: true });
      leverageSummary.default_leverage = isBinanceExchange ? defaultFuturesLeverage : 1;
      leverageSummary.enabled = isBinanceExchange;
      const rollbackSummary = buildRollbackSummary(rows, { includeFlat: true });
      rollbackSummary.enabled = isBinanceExchange;

      // Health checks (scheduler/signal/fill/bars)
      const runsSnap = await db.collection("system_runs").orderBy("started_at", "desc").limit(30).get();
      const runs = [];
      runsSnap.forEach((d) => runs.push(d.data() || {}));
      const tickRuns = runs.filter((r) => {
        const meta = r.meta || {};
        const isTick = meta.endpoint === "/scheduler/tick" || meta.mode === "SCHEDULER_TICK_MULTI";
        if (!isTick) return false;
        const target = String(exchange || "").toUpperCase();
        const ex = String(meta.exchange || "").toUpperCase();
        const exList = Array.isArray(meta.exchanges)
          ? meta.exchanges.map((x) => String(x || "").toUpperCase()).filter(Boolean)
          : [];
        if (!ex && !exList.length) return true;
        if (exList.length) return exList.includes(target);
        if (ex.includes("+")) {
          return ex.split("+").map((x) => x.trim()).includes(target);
        }
        return ex === target;
      });
      const lastTickMs = latestMs(tickRuns, ["started_at", "ended_at"]);
      const prevTickMs = tickRuns.length > 1 ? toMsSafe(tickRuns[1]?.started_at) : null;
      const tickIntervalMs = (lastTickMs != null && prevTickMs != null) ? Math.abs(lastTickMs - prevTickMs) : null;

      const lastSignalSavedMs = latestMs(signalsVisible, ["bar_close_time_utc_ms", "created_at", "created_kst"]);
      const lastSignalDropMs = latestMs(dropsFiltered, ["bar_close_time_utc_ms", "created_at", "created_kst"]);
      const lastSignalAnyMs = Math.max(
        Number.isFinite(lastSignalSavedMs) ? lastSignalSavedMs : -1,
        Number.isFinite(lastSignalDropMs) ? lastSignalDropMs : -1,
      );
      const lastSignalAnyMsSafe = Number.isFinite(lastSignalAnyMs) && lastSignalAnyMs >= 0 ? lastSignalAnyMs : null;
      const lastSignalAny = signalsMerged[0] || null;
      const lastFillMs = latestMs(fillsFiltered, ["exec_bar_close_time_utc_ms", "created_at", "created_kst"]);
      const dropWindowHours = Number(process.env.SIGNAL_DROP_SUMMARY_HOURS || 24);
      const dropWindowMs = Number.isFinite(dropWindowHours) ? (dropWindowHours * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);
      const dropsRecent = dropsFiltered.filter((d) => {
        const ms = toMsSafe(d.created_at) ?? toMsSafe(d.created_kst) ?? toMsSafe(d.bar_close_time_utc_ms);
        return Number.isFinite(ms) && (nowMs - ms) <= dropWindowMs;
      });
      const reasonCounts = new Map();
      const aiReasonCounts = new Map();
      let aiBlockCount = 0;
      for (const d of dropsRecent) {
        const code = String(d.drop_reason_code || d.reason || "UNKNOWN").toUpperCase().trim() || "UNKNOWN";
        reasonCounts.set(code, (reasonCounts.get(code) || 0) + 1);
        if (code === "AI_BLOCK") {
          aiBlockCount += 1;
          const aiReason = String(d.features_json && d.features_json.ai_signal && d.features_json.ai_signal.ai_reason ? d.features_json.ai_signal.ai_reason : "").trim();
          if (aiReason) {
            aiReasonCounts.set(aiReason, (aiReasonCounts.get(aiReason) || 0) + 1);
          }
        }
      }
      const topReasons = Array.from(reasonCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k}(${v})`);
      const topAiReasons = Array.from(aiReasonCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k}(${v})`);
      const dropByMarket = {};
      for (const d of dropsRecent) {
        const mkRaw = d.symbol_or_pair_id || d.symbol || d.market;
        const mk = normalizeMarket(mkRaw || "");
        if (!mk) continue;
        if (!dropByMarket[mk]) {
          dropByMarket[mk] = {
            total: 0,
            ai_block: 0,
            reasons: new Map(),
            ai_reasons: new Map(),
          };
        }
        const bucket = dropByMarket[mk];
        bucket.total += 1;
        const code = String(d.drop_reason_code || d.reason || "UNKNOWN").toUpperCase().trim() || "UNKNOWN";
        bucket.reasons.set(code, (bucket.reasons.get(code) || 0) + 1);
        if (code === "AI_BLOCK") {
          bucket.ai_block += 1;
          const aiReason = String(d.features_json && d.features_json.ai_signal && d.features_json.ai_signal.ai_reason ? d.features_json.ai_signal.ai_reason : "").trim();
          if (aiReason) {
            bucket.ai_reasons.set(aiReason, (bucket.ai_reasons.get(aiReason) || 0) + 1);
          }
        }
      }
      const dropByMarketSummary = Object.entries(dropByMarket).map(([mk, b]) => {
        const topReasonsLocal = Array.from(b.reasons.entries())
          .sort((a, b2) => b2[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `${k}(${v})`);
        const topAiReasonsLocal = Array.from(b.ai_reasons.entries())
          .sort((a, b2) => b2[1] - a[1])
          .slice(0, 2)
          .map(([k, v]) => `${k}(${v})`);
        return {
          market: mk,
          total: b.total,
          ai_block: b.ai_block,
          ai_block_pct: b.total ? (b.ai_block / b.total) : null,
          top_reasons: topReasonsLocal,
          top_ai_reasons: topAiReasonsLocal,
        };
      }).sort((a, b) => b.total - a.total);
      const dropSummary = {
        window_hours: dropWindowHours,
        total: dropsRecent.length,
        ai_block: aiBlockCount,
        ai_block_pct: dropsRecent.length ? (aiBlockCount / dropsRecent.length) : null,
        top_reasons: topReasons,
        top_ai_reasons: topAiReasons,
        by_market: dropByMarketSummary,
      };

      const barsSnap = await db.collection("bars_snapshots")
        .select("exchange", "symbol", "symbol_or_pair_id", "bar_close_time_utc_ms", "bar_close_time_utc", "created_at")
        .orderBy("created_at", "desc")
        .limit(900)
        .get();
      const lastBarByMarket = {};
      barsSnap.forEach((d) => {
        const x = d.data() || {};
        const ex = String(x.exchange || "").toUpperCase();
        if (ex && ex !== String(exchange || "").toUpperCase()) return;
        const mk = x.symbol || x.symbol_or_pair_id || x.market;
        if (!mk || lastBarByMarket[mk] !== undefined) return;
        const ms = toMsSafe(x.bar_close_time_utc_ms) ?? toMsSafe(x.bar_close_time_utc) ?? toMsSafe(x.created_at);
        if (ms == null) return;
        lastBarByMarket[mk] = ms;
      });

      const barTimes = Object.values(lastBarByMarket).filter((x) => Number.isFinite(x));
      const latestBarMs = barTimes.length ? Math.max(...barTimes) : null;
      const staleBars = markets.filter((mk) => {
        const ms = lastBarByMarket[mk];
        if (!Number.isFinite(ms)) return true;
        return (nowMs - ms) > (tfMs * 2);
      });

      // Risk guardrail (warning-only)
      const risk = (await getRiskBudgetForProvider(exchange, 0)).data || null;
      const guardrailEnabled = risk && risk.enabled === true;
      const guardrailMax = Number(risk?.total_max_krw || 0);
      const guardrail = {
        enabled: guardrailEnabled && guardrailMax > 0,
        total_max_krw: guardrailMax > 0 ? guardrailMax : null,
        threshold_krw: guardrailMax > 0 ? (guardrailMax * Number(process.env.RISK_DAILY_LOSS_PCT || 0.03)) : null,
        unit: risk && risk.unit ? String(risk.unit).toUpperCase() : (String(exchange || "").includes("BINANCE") ? "USDT" : "KRW"),
        daily_realized_krw: null,
        daily_trades_n: 0,
        daily_realized_source: "NONE",
        daily_source_breakdown: null,
        pnl_source_policy: getPnlSourcePolicy(),
        daily_loss_pct: null,
        threshold_pct: Number(process.env.RISK_DAILY_LOSS_PCT || 0.03),
        status: "OFF",
        error: null,
      };

      if (guardrail.enabled && String(process.env.RISK_GUARDRAIL_ENABLE || "1") === "1") {
        try {
          const dayStartMs = kstStartOfDayMs(nowMs);
          const fillsLimit = Number(process.env.DASHBOARD_FILLS_LIMIT || 2000);
          const pnlMode = String(process.env.TRADE_PNL_MODE || "EACH_SELL");
          const realized = await resolveRealizedRowsByMarket({
            exchange,
            markets,
            tf: execTf || tfDefault,
            fallbackTf: tfDefault,
            limitN: fillsLimit,
            fromMs: dayStartMs,
            toMs: nowMs + 1,
            mode: pnlMode,
            includeAllIncomeMarkets: true,
          });
          const dailyRaw = Number(realized && realized.total_pnl_krw);
          const daily = Number.isFinite(dailyRaw) ? dailyRaw : 0;
          const tradesN = Number(realized && realized.trades_n || 0);
          const sourceBreakdown = realized && realized.source_breakdown ? realized.source_breakdown : {};
          const sourceExternalMarkets = Number(sourceBreakdown.external_markets || 0);
          const sourceFallbackMarkets = Number(sourceBreakdown.fallback_markets || 0);
          const sourceNoneMarkets = Number(sourceBreakdown.none_markets || 0);
          guardrail.daily_realized_krw = daily;
          guardrail.daily_trades_n = tradesN;
          guardrail.daily_realized_source = realized && realized.source_mode
            ? String(realized.source_mode)
            : (
              sourceExternalMarkets > 0 && sourceFallbackMarkets > 0 ? "MIXED" :
              sourceExternalMarkets > 0 ? "EXTERNAL" :
              sourceFallbackMarkets > 0 ? "FALLBACK" : "NONE"
            );
          guardrail.daily_source_breakdown = {
            external_markets: sourceExternalMarkets,
            fallback_markets: sourceFallbackMarkets,
            none_markets: sourceNoneMarkets,
          };
          guardrail.pnl_source_policy = realized && realized.source_policy ? String(realized.source_policy) : getPnlSourcePolicy();
          guardrail.daily_loss_pct = (guardrailMax > 0) ? (daily / guardrailMax) : null;
          if (guardrail.daily_loss_pct != null && guardrail.daily_loss_pct <= -guardrail.threshold_pct) {
            guardrail.status = "ALERT";
          } else if (tradesN > 0) {
            guardrail.status = "OK";
          } else {
            guardrail.status = "NO_TRADES";
          }
        } catch (e) {
          guardrail.status = "ERROR";
          guardrail.error = e?.message || String(e);
        }
      }

      const sys = (await getSystemSettingsForProvider(exchange, 0)).data || {};
      const warnings = [];
      const tickStaleMs = tfMs * Number(process.env.TICK_STALE_BARS || 2);
      const signalStaleMs = tfMs * Number(process.env.SIGNAL_SILENCE_BARS || 2);
      const fillStaleMs = tfMs * Number(process.env.FILL_SILENCE_BARS || 6);
      const tickFastMs = Math.max(5 * 60 * 1000, Math.round(tfMs / 4));
      const hasActivePosition = markets.some((mk) => {
        const pos = positionsByMarket[mk];
        const size = Number(pos?.size_pct ?? pos?.sizePct ?? 0);
        return Number.isFinite(size) && size > 0;
      });
      const hasPendingIntents = intentSummary.pending > 0;
      const shouldCheckFill = hasActivePosition || hasPendingIntents;
      const shouldCheckSignal = hasActivePosition || hasPendingIntents;

      if (!lastTickMs) warnings.push({ level: "bad", message: "스케줄러 실행 기록 없음" });
      else if ((nowMs - lastTickMs) > tickStaleMs) warnings.push({ level: "bad", message: "스케줄러 지연" });
      if (tickIntervalMs && tickIntervalMs < tickFastMs) warnings.push({ level: "warn", message: "스케줄러 과다 호출 가능" });

      if (shouldCheckSignal) {
        if (!lastSignalAnyMsSafe) warnings.push({ level: "warn", message: "신호 수신 기록 없음" });
        else if ((nowMs - lastSignalAnyMsSafe) > signalStaleMs) warnings.push({ level: "warn", message: "신호 수신 지연(저장/필터링 포함)" });
        if (lastSignalSavedMs && (nowMs - lastSignalSavedMs) > signalStaleMs) {
          warnings.push({ level: "warn", message: "신호 저장 지연(필터링 증가 가능)" });
        } else if (!lastSignalSavedMs) {
          warnings.push({ level: "warn", message: "신호 저장 기록 없음" });
        }
      }

      if (shouldCheckFill) {
        if (!lastFillMs) warnings.push({ level: "warn", message: "체결 기록 없음" });
        else if ((nowMs - lastFillMs) > fillStaleMs) warnings.push({ level: "warn", message: "체결 지연" });
      }

      if (staleBars.length > 0) warnings.push({ level: "warn", message: `봉 데이터 지연 ${staleBars.length}개` });
      if (String(sys.log_level || "").toUpperCase() === "DEBUG") warnings.push({ level: "warn", message: "로그 DEBUG (비용 증가 가능)" });
      if (Number(sys.data_retention_days || 0) <= 0) warnings.push({ level: "warn", message: "데이터 보관 무제한 (비용 증가 가능)" });
      if (guardrail.status === "ALERT") warnings.push({ level: "bad", message: "일일 손실 한도 초과 (경고)" });
      if (guardrail.status === "ERROR") warnings.push({ level: "warn", message: "리스크 가드레일 계산 실패" });

      const health = {
        last_tick_ms: lastTickMs,
        last_tick_kst: toKstString(lastTickMs),
        tick_interval_ms: tickIntervalMs,
        last_signal_ms: lastSignalSavedMs,
        last_signal_kst: toKstString(lastSignalSavedMs),
        last_signal_any_ms: lastSignalAnyMsSafe,
        last_signal_any_kst: toKstString(lastSignalAnyMsSafe),
        last_fill_ms: lastFillMs,
        last_fill_kst: toKstString(lastFillMs),
        latest_bar_ms: latestBarMs,
        latest_bar_kst: toKstString(latestBarMs),
        stale_bars_n: staleBars.length,
        warnings,
        guardrail,
        retention_days: Number(sys.data_retention_days || 0),
        log_level: sys.log_level || "INFO",
        drop_summary: dropSummary,
      };

      const signals12 = signalsMerged.slice(0, 12).map((x) => {
        const matched = intentLookup.resolveForSignal(x);
        const schedMs = Number(matched && matched.scheduled_exec_bar_close_time_utc_ms);
        const execPlan = matched ? {
          intent_id: matched.intent_id || matched.id || null,
            status: normalizeStatus(resolveIntentStatusForView(matched, nowMs)),
          scheduled_exec_bar_close_time_utc_ms: Number.isFinite(schedMs) ? schedMs : null,
          scheduled_exec_kst: Number.isFinite(schedMs) ? toKstString(schedMs) : null,
          pending_reason: matched.pending_reason || null,
          status_reason: matched.status_reason || null,
          cancel_reason: matched.cancel_reason || null,
          cancel_note: matched.cancel_note || null,
          last_error: matched.last_error || null,
          is_future: Number.isFinite(schedMs) ? schedMs > nowMs : null,
        } : null;
        const displayReason = buildSignalDisplayReason(x, execPlan);
        return {
          ...x,
          created_kst: toKstString(x.created_kst || x.created_at, { fallbackToString: true }),
          event_intent: x.event_intent ?? null,
          mapping_ok: computeMappingOk(x),
          late_by_bars: x.features_json ? x.features_json._late_by_bars : null,
          display_reason: displayReason.primary,
          display_reason_detail: displayReason.detail,
          display_reason_secondary: displayReason.secondary,
          display_reason_external_fill: displayReason.is_external_fill,
          display_reason_stage_step: displayReason.stage_step,
          display_reason_stage_label: displayReason.stage_label,
          display_reason_stage_text: displayReason.stage_text,
          display_reason_ko: displayReason.reason_ko,
          exec_plan: execPlan,
        };
      });
      const fills12 = fillsFiltered.slice(0, 12).map((x) => {
        const market = normalizeMarket(x.symbol || x.symbol_or_pair_id || x.market || "");
        const pos = positionsByMarket[market] || null;
        const lev = resolveFillLeverage(x, {
          position: pos,
          fallback: resolvePositionLeverage(pos, { fallback: isBinanceExchange ? defaultFuturesLeverage : 1 }),
        });
        const display = buildFillDisplayReason(x);
        return {
          ...x,
          created_kst: toKstString(x.created_kst || x.created_at, { fallbackToString: true }),
          signal_price: (x.signal_price != null) ? Number(x.signal_price) : null,
          signal_price_diff: (x.signal_price_diff != null) ? Number(x.signal_price_diff) : null,
          signal_price_diff_pct: (x.signal_price_diff_pct != null) ? Number(x.signal_price_diff_pct) : null,
          leverage_applied: lev,
          leverage_tier: resolveLeverageTier(lev),
          leverage_reason: resolveFillLeverageReason(x, { position: pos }),
          display_exec_label: display.exec_label,
          display_exec_text: display.exec_text,
          display_exec_ko: display.exec_ko,
        };
      });

      const asOfKst = toKstString(new Date().toISOString());
      return res.render("state", {
        markets_expected: markets,
        exchange,
        tf_default: tfDefault,
        rows,
        signals12,
        fills12,
        health,
        leverage_summary: leverageSummary,
        rollback_summary: rollbackSummary,
        now_kst: asOfKst,
        as_of_kst: asOfKst,
        pnl_scope_days: getPnlScopeDays(),
        pnl_source_policy: (health && health.guardrail && health.guardrail.pnl_source_policy)
          ? String(health.guardrail.pnl_source_policy)
          : getPnlSourcePolicy(),
        intent_summary: intentSummary,
        kpi_summary: kpiSummary,
        show_shadow_signals: showShadowSignals,
      });
    } catch (e) {
      return res.status(500).send("STATE_ROUTE_ERROR: " + (e?.message || String(e)));
    }
  }

  // Control-surface alias: /dashboard/trading + legacy compatibility: /dashboard/state
  router.get("/dashboard/trading", renderTrading);
  router.get("/dashboard/state", renderTrading);

  // JSON (for debugging/AJAX)
  router.get("/api/state", async (req, res) => {
    try {
      const showShadowSignals = String(req.query.shadow || "").trim() === "1";
      const db = getFirestore();
      const { exchange } = await resolveExchangeFromReq(req, 2000);
      const exchangeNorm = normalizeProviderId(exchange);
      const { signalTf, execTf } = await resolveRuntimeTfContext(req, exchange, { fallback: defaultExecTfFromEnv() || "15m", ttlMs: 2000 });
      const cacheKey = `${String(exchange || "BINANCEFUT").toUpperCase()}__${signalTf}__${execTf}__shadow:${showShadowSignals ? "1" : "0"}`;
      const now = Date.now();
      const cached = apiStateCache.get(cacheKey);
      if (cached && Number.isFinite(cached.ts) && (now - cached.ts) < apiStateTtlMs) {
        res.set("Cache-Control", "private, max-age=5");
        return res.json(cached.payload);
      }
      const markets = await parseMarketsFromSettings(exchange);

      const [signals, drops, intents, fills] = await Promise.all([
        topN(db, "signals", 200),
        topN(db, "signals_dropped", 200),
        topN(db, "order_intents_paper", 300),
        topN(db, "fills_paper", 300),
      ]);
      const resolveItemExchange = (item) => {
        const exRaw = String(item && item.exchange ? item.exchange : "").toUpperCase();
        if (exRaw) return normalizeProviderId(exRaw);
        const mkRaw = String(item && (item.symbol_or_pair_id || item.symbol || item.market)
          ? (item.symbol_or_pair_id || item.symbol || item.market)
          : "");
        return normalizeProviderId(inferExchangeFromMarket(mkRaw));
      };
      const filterByExchange = (arr) => (arr || []).filter((x) => resolveItemExchange(x) === exchangeNorm);
      const filterLiveOnly = (arr) => filterByExchange(arr).filter((x) => isLiveDocForExchange(exchange, x));
      const signalsFiltered = filterByExchange(signals);
      const signalsVisible = showShadowSignals ? signalsFiltered : signalsFiltered.filter((x) => !isShadowSignal(x));
      const dropsFiltered = filterByExchange(drops);
      const intentsFiltered = filterLiveOnly(intents);
      const fillsFiltered = filterLiveOnly(fills);
      const normalizeMarket = (raw) => normalizeMarketSymbolForProvider(raw, exchangeNorm);
      const signalsMerged = [
        ...signalsVisible.map((x) => ({ ...x, _signal_source: "SIGNAL" })),
        ...dropsFiltered.map((x) => ({ ...x, _signal_source: "DROP" })),
      ].sort((a, b) => {
        const aMs = toMsSafe(a.created_at || a.created_kst || a.bar_close_time_utc_ms) || 0;
        const bMs = toMsSafe(b.created_at || b.created_kst || b.bar_close_time_utc_ms) || 0;
        return bMs - aMs;
      });
      const lastSignalSavedMs = latestMs(signalsVisible, ["bar_close_time_utc_ms", "created_at", "created_kst"]);
      const lastSignalDropMs = latestMs(dropsFiltered, ["bar_close_time_utc_ms", "created_at", "created_kst"]);
      const lastSignalAnyMs = Math.max(
        Number.isFinite(lastSignalSavedMs) ? lastSignalSavedMs : -1,
        Number.isFinite(lastSignalDropMs) ? lastSignalDropMs : -1,
      );
      const lastSignalAnyMsSafe = Number.isFinite(lastSignalAnyMs) && lastSignalAnyMs >= 0 ? lastSignalAnyMs : null;
      const lastSignalAny = signalsMerged[0] || null;

      const posDocs = await Promise.all(
        markets.map((mk) => db.collection("positions_paper").doc(`POS__${exchange}__${mk}`).get())
      );
      const positionsByMarket = {};
      markets.forEach((mk, i) => {
        const d = posDocs[i];
        const data = d.exists ? (d.data() || {}) : null;
        positionsByMarket[mk] = (data && isLiveDocForExchange(exchange, data)) ? data : null;
      });
      const isBinanceExchange = String(exchange || "").toUpperCase().includes("BINANCE");
      const defaultFuturesLeverage = isBinanceExchange ? 2 : 1;
      const nowMs = Date.now();

      const rows = markets.map((mk) => {
        const lastSignal = signalsMerged.find((x) => normalizeMarket(x.symbol_or_pair_id || x.symbol || x.market || "") === mk) || null;
        const lastFill = fillsFiltered.find((x) => (x.symbol || x.symbol_or_pair_id || x.market) === mk) || null;
        const pendings = intentsFiltered
          .filter((x) => (x.symbol_or_pair_id || x.symbol) === mk && isActivePendingIntent(x, nowMs))
          .slice(0, 10);
        const position = positionsByMarket[mk];
        const positionLeverage = resolvePositionLeverage(position, {
          fallback: isBinanceExchange ? defaultFuturesLeverage : 1,
        });
        const fillLeverage = resolveFillLeverage(lastFill, {
          position,
          fallback: positionLeverage,
        });

        return {
          market: mk,
          position,
          position_leverage: positionLeverage,
          position_leverage_tier: resolveLeverageTier(positionLeverage),
          position_leverage_reason: resolvePositionLeverageReason(position),
          last_signal: lastSignal,
          last_fill: lastFill ? {
            ...lastFill,
            leverage_applied: fillLeverage,
            leverage_tier: resolveLeverageTier(fillLeverage),
            leverage_reason: resolveFillLeverageReason(lastFill, { position }),
          } : null,
          fill_leverage: fillLeverage,
          pending_intents: pendings,
        };
      });
      const leverageSummary = buildLeverageSummary(rows, { includeFlat: true });
      leverageSummary.default_leverage = isBinanceExchange ? defaultFuturesLeverage : 1;
      leverageSummary.enabled = isBinanceExchange;
      const rollbackSummary = buildRollbackSummary(rows, { includeFlat: true });
      rollbackSummary.enabled = isBinanceExchange;

      const payload = {
        ok: true,
        markets,
        exchange,
        rows,
        leverage_summary: leverageSummary,
        rollback_summary: rollbackSummary,
        meta: {
          show_shadow_signals: showShadowSignals,
          last_signal_saved_ms: lastSignalSavedMs,
          last_signal_drop_ms: lastSignalDropMs,
          last_signal_any_ms: lastSignalAnyMsSafe,
          last_signal_any_market: lastSignalAny ? normalizeMarket(lastSignalAny.symbol_or_pair_id || lastSignalAny.symbol || lastSignalAny.market || "") : null,
          last_signal_any_source: lastSignalAny ? String(lastSignalAny._signal_source || "SIGNAL") : null,
        },
      };
      apiStateCache.set(cacheKey, { ts: now, payload });
      res.set("Cache-Control", "private, max-age=5");
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ ok: false, message: e?.message || String(e) });
    }
  });

  return router;
}

module.exports = createStateRoutes;
