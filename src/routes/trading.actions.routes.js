const express = require("express");
const { getEffectiveExchangesSettings, getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { normalizeMarketSymbolForProvider, tfToMs, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { normalizeProviderId } = require("../utils/providerUtils");
const { fetchCandles } = require("../exchanges");
const { getPosition } = require("../storage/positions");
const { upsertIntent, cancelPendingIntentsByMarket } = require("../storage/orderIntentsPaper");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { toKstStringFromMs } = require("../utils/timeKst");
const { fetchFuturesUserTrades } = require("../exchanges/binanceFuturesPrivate");
const { runPaperFuturesForBar, syncFuturesPositionOnly } = require("../engine/paperUpbitRunner");
const { runActionPreHooks, runActionPostHooks } = require("../utils/actionExecutionHooks");

function nowMs() {
  return Date.now();
}

function normalizeFraction(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return null;
}

function alignNextBarClose(ms, tfMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(tfMs) || tfMs <= 0) return null;
  return Math.ceil(ms / tfMs) * tfMs;
}

function alignCurrentBarClose(ms, tfMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(tfMs) || tfMs <= 0) return null;
  return Math.floor(ms / tfMs) * tfMs;
}

function normalizeManualRetryEvent(eventRaw, sideRaw) {
  const event = String(eventRaw || "").trim().toUpperCase();
  if (event) return event;
  const side = String(sideRaw || "").trim().toUpperCase();
  if (side === "BUY") return "LONG";
  if (side === "SELL") return "SHORT";
  return null;
}

function sideFromRetryEvent(eventRaw) {
  const event = String(eventRaw || "").trim().toUpperCase();
  if (!event) return null;
  if (event.includes("SHORT") || event.includes("SELL")) return "SELL";
  if (event.includes("LONG") || event.includes("BUY")) return "BUY";
  return null;
}

function resolveRetryQtyBaseFromTrades(trades, entrySide) {
  const desiredExitSide = String(entrySide || "").toUpperCase() === "BUY" ? "SELL" : "BUY";
  if (!Array.isArray(trades) || !desiredExitSide) return null;
  for (let i = trades.length - 1; i >= 0; i -= 1) {
    const t = trades[i] || {};
    if (String(t.side || "").toUpperCase() !== desiredExitSide) continue;
    const qty = Number(t.qty);
    if (Number.isFinite(qty) && qty > 0) return qty;
  }
  return null;
}

function createTradingActionsRoutes() {
  const router = express.Router();

  // Force exit 50% / 100% (all exchanges)
  router.post("/api/trading/force-exit", async (req, res) => {
    let actionEnvelope = null;
    try {
      const body = req.body || {};
      const requestId = String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || "").trim() || null;
      const rawMarket = String(body.market || body.symbol || "").trim();
      const fracRaw = body.fraction ?? body.qty_fraction ?? body.qty_pct ?? body.pct;
      const fraction = normalizeFraction(fracRaw);

      if (!rawMarket) {
        return res.status(400).json({ ok: false, error: "MARKET_REQUIRED" });
      }
      if (!Number.isFinite(fraction) || (fraction !== 0.5 && fraction !== 1)) {
        return res.status(400).json({ ok: false, error: "BAD_FRACTION", message: "Only 0.5 or 1.0 allowed." });
      }

      const providerRaw = body.provider || body.exchange || req.query.provider || req.query.exchange || "";
      const provider = providerRaw ? normalizeProviderId(providerRaw) : "";
      const exCfg = provider
        ? await getExchangeSettingsForProvider(provider, 2000)
        : await getEffectiveExchangesSettings(2000);
      const exchange = normalizeProviderId(exCfg && exCfg.provider ? exCfg.provider : (provider || "BINANCEFUT"));
      const market = normalizeMarketSymbolForProvider(rawMarket, exchange);
      const markets = Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [];
      if (!market || (markets.length && !markets.includes(market))) {
        return res.status(400).json({ ok: false, error: "MARKET_NOT_ALLOWED" });
      }

      const pos = await getPosition({ exchange, symbol: market });
      const state = String(pos && pos.state || "").toUpperCase();
      const sizePct = Number(pos && pos.size_pct);
      if (state !== "ACTIVE" || !Number.isFinite(sizePct) || sizePct <= 0) {
        return res.status(400).json({ ok: false, error: "NO_POSITION" });
      }

      const signalTf = (Array.isArray(exCfg.tf_allowlist) && exCfg.tf_allowlist.length)
        ? String(exCfg.tf_allowlist[0])
        : (defaultExecTfFromEnv() || "15m");
      const execTf = String(exCfg.exec_tf || "15m");
      const signalTfMs = tfToMs(signalTf) || tfToMs(defaultExecTfFromEnv()) || 15 * 60 * 1000;
      const execTfMs = tfToMs(execTf) || 15 * 60 * 1000;

      const now = nowMs();
      const signalBarCloseMs = alignCurrentBarClose(now, signalTfMs);
      const execBarCloseMs = alignNextBarClose(now, execTfMs);
      if (!Number.isFinite(signalBarCloseMs) || !Number.isFinite(execBarCloseMs)) {
        return res.status(500).json({ ok: false, error: "BAD_BAR_TIME" });
      }

      const event = fraction >= 1 ? "FORCE_EXIT_ALL" : "FORCE_EXIT_HALF";
      const posSide = String(pos.position_side || pos.side || (pos.meta && pos.meta.position_side) || "").toUpperCase();
      const side = posSide === "SHORT" ? "BUY" : "SELL";
      const sys = await getSystemSettingsForProvider(exchange, 2000);
      const execModeRaw = String(sys && sys.data && sys.data.execution_mode ? sys.data.execution_mode : "PAPER").toUpperCase();
      const executionMode = execModeRaw === "LIVE" ? "LIVE" : "PAPER";
      const runId = `RUN__MANUAL_FORCE_EXIT__${exchange}__${market}__${Date.now()}`;
      const pre = runActionPreHooks({
        action: "TRADING_FORCE_EXIT",
        runId,
        exchange,
        symbol: market,
        tf: signalTf,
        signalEvent: event,
        decisionReason: "FORCE_EXIT_UI",
        source: "TRADING_ACTIONS_ROUTE",
        executionMode,
        intent: "EXIT",
        qtyPct: fraction,
        persist: true,
      });
      actionEnvelope = pre.envelope;

      const intent = await upsertIntent({
        exchange,
        symbol: market,
        tf: signalTf,
        signalBarCloseTimeUtc: new Date(signalBarCloseMs).toISOString(),
        signalBarCloseTimeUtcMs: signalBarCloseMs,
        scheduledExecBarCloseUtc: new Date(execBarCloseMs).toISOString(),
        scheduledExecBarCloseUtcMs: execBarCloseMs,
        event,
        side,
        qtyPct: fraction,
        reason: "FORCE_EXIT_UI",
        pendingReason: "MANUAL_FORCE_EXIT",
        pendingNote: `FORCE_EXIT_${fraction === 1 ? "ALL" : "HALF"}`,
        executionMode,
        features: {
          _manual_force_exit: true,
          _force_exit_fraction: fraction,
          position_side: posSide || null,
        },
        runId,
        execTf,
        requestId,
        decisionReason: "FORCE_EXIT_UI",
      });
      if (actionEnvelope) actionEnvelope.intent_id = intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null;
      runActionPostHooks({
        envelope: actionEnvelope,
        ok: true,
        reason: "FORCE_EXIT_INTENT_CREATED",
        persist: true,
        result: {
          intent_id: actionEnvelope && actionEnvelope.intent_id,
          fraction,
          exchange,
          symbol: market,
          scheduled_exec_bar_close_time_utc_ms: execBarCloseMs,
        },
      });

      return res.json({
        ok: true,
        intent_id: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null,
        market,
        exchange,
        fraction,
        scheduled_exec_kst: toKstStringFromMs(execBarCloseMs, { fallback: null }),
      });
    } catch (err) {
      runActionPostHooks({
        envelope: actionEnvelope || {
          action: "TRADING_FORCE_EXIT",
          ts: new Date().toISOString(),
        },
        ok: false,
        reason: "FORCE_EXIT_FAILED",
        persist: true,
        result: null,
        extra: {
          error: String(err && err.message || err).slice(0, 240),
        },
      });
      return res.status(500).json({ ok: false, error: "FORCE_EXIT_FAILED", message: String(err && err.message || err) });
    }
  });

  router.post("/api/trading/manual-retry-entry", async (req, res) => {
    let actionEnvelope = null;
    try {
      const body = req.body || {};
      const requestId = String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || "").trim() || null;
      const rawMarket = String(body.market || body.symbol || "").trim();
      if (!rawMarket) {
        return res.status(400).json({ ok: false, error: "MARKET_REQUIRED" });
      }

      const providerRaw = body.provider || body.exchange || req.query.provider || req.query.exchange || "";
      const provider = providerRaw ? normalizeProviderId(providerRaw) : "BINANCEFUT";
      const exchange = normalizeProviderId(provider || "BINANCEFUT");
      if (exchange !== "BINANCEFUT") {
        return res.status(400).json({ ok: false, error: "MANUAL_RETRY_BINANCE_ONLY" });
      }

      const exCfg = await getExchangeSettingsForProvider(exchange, 2000);
      const market = normalizeMarketSymbolForProvider(rawMarket, exchange);
      const markets = Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [];
      if (!market || (markets.length && !markets.includes(market))) {
        return res.status(400).json({ ok: false, error: "MARKET_NOT_ALLOWED" });
      }

      const event = normalizeManualRetryEvent(body.event, body.side);
      const side = sideFromRetryEvent(event);
      if (!event || !side) {
        return res.status(400).json({ ok: false, error: "EVENT_OR_SIDE_REQUIRED" });
      }

      const runId = `RUN__MANUAL_RETRY__${exchange}__${market}__${Date.now()}`;
      await syncFuturesPositionOnly({ runId, exchange, symbol: market });
      const curPos = await getPosition({ exchange, symbol: market });
      const curState = String(curPos && curPos.state || "").toUpperCase();
      const curQtyBase = Number(curPos && curPos.qty_base);
      if (curState === "ACTIVE" && Number.isFinite(curQtyBase) && curQtyBase > 0) {
        return res.status(409).json({ ok: false, error: "POSITION_ALREADY_ACTIVE" });
      }

      let qtyBase = Number(body.qty_base ?? body.qtyBase);
      const apiKey = String(process.env.BINANCEFUT_API_KEY || (exCfg && exCfg.api_key) || "");
      const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (exCfg && exCfg.api_secret) || "");
      let qtySource = "request";
      if ((!Number.isFinite(qtyBase) || qtyBase <= 0) && apiKey && apiSecret) {
        const recentTrades = await fetchFuturesUserTrades({ apiKey, apiSecret, symbol: market, limit: 30 });
        qtyBase = resolveRetryQtyBaseFromTrades(recentTrades, side);
        qtySource = "recent_exit_trade";
      }
      if (!Number.isFinite(qtyBase) || qtyBase <= 0) {
        return res.status(400).json({ ok: false, error: "QTY_BASE_REQUIRED" });
      }

      const bars = await fetchCandles(exchange, market, "15m", 2);
      const bar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
      const execBarCloseMs = Number(bar && bar.closeTimeUtcMs);
      const execBarCloseUtc = String(bar && bar.closeTimeUtc || "");
      if (!Number.isFinite(execBarCloseMs) || !execBarCloseUtc) {
        return res.status(500).json({ ok: false, error: "LATEST_BAR_MISSING" });
      }
      const signalTf = (Array.isArray(exCfg && exCfg.tf_allowlist) && exCfg.tf_allowlist.length)
        ? String(exCfg.tf_allowlist[0])
        : (defaultExecTfFromEnv() || "15m");
      const execTf = String((exCfg && exCfg.exec_tf) || "15m");
      if (execTf !== "15m") {
        return res.status(400).json({ ok: false, error: "MANUAL_RETRY_EXEC_TF_UNSUPPORTED", exec_tf: execTf });
      }

      const fracRaw = body.fraction ?? body.qty_fraction ?? body.qty_pct ?? body.pct;
      const fraction = normalizeFraction(fracRaw) || 1;
      const sys = await getSystemSettingsForProvider(exchange, 2000);
      const execModeRaw = String(sys && sys.data && sys.data.execution_mode ? sys.data.execution_mode : "PAPER").toUpperCase();
      const executionMode = execModeRaw === "LIVE" ? "LIVE" : "PAPER";
      const signalMs = Date.now();
      const pre = runActionPreHooks({
        action: "TRADING_MANUAL_RETRY_ENTRY",
        runId,
        exchange,
        symbol: market,
        tf: signalTf,
        signalEvent: event,
        decisionReason: "MANUAL_RETRY_BY_USER",
        source: "TRADING_ACTIONS_ROUTE",
        executionMode,
        intent: "ENTRY",
        qtyPct: fraction,
        features: {
          action: "ENTRY",
          _manual_retry_by_user: true,
          _manual_retry_qty_base: qtyBase,
          _manual_retry_source: qtySource,
          _entry_exec_timing: "EXEC_CURRENT_BAR",
        },
        persist: true,
      });
      actionEnvelope = pre.envelope;
      if (!pre.ok) {
        return res.status(409).json({
          ok: false,
          error: "MANUAL_RETRY_PRE_HOOK_BLOCKED",
          reason: pre.reason,
        });
      }

      const intent = await upsertIntent({
        exchange,
        symbol: market,
        tf: signalTf,
        signalBarCloseTimeUtc: new Date(signalMs).toISOString(),
        signalBarCloseTimeUtcMs: signalMs,
        scheduledExecBarCloseUtc: execBarCloseUtc,
        scheduledExecBarCloseUtcMs: execBarCloseMs,
        event,
        side,
        qtyPct: fraction,
        qtyFraction: fraction,
        reason: "MANUAL_RETRY_BY_USER",
        pendingReason: "MANUAL_RETRY_BY_USER",
        pendingNote: String(body.note || "FALSE_EXIT_RETRY").slice(0, 160),
        executionMode,
        features: {
          ...pre.featuresPatch,
        },
        runId,
        execTf,
        requestId,
        decisionReason: "MANUAL_RETRY_BY_USER",
      });
      if (actionEnvelope) actionEnvelope.intent_id = intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null;

      const result = await runPaperFuturesForBar({
        runId,
        exchange,
        symbol: market,
        tf: signalTf,
        execTf,
        barCloseUtc: execBarCloseUtc,
        barCloseMs: execBarCloseMs,
        bar,
        gate: null,
        trading_mode: "RUNNING",
      });

      await syncFuturesPositionOnly({ runId, exchange, symbol: market });
      const nextPos = await getPosition({ exchange, symbol: market });
      runActionPostHooks({
        envelope: actionEnvelope,
        ok: true,
        reason: "MANUAL_RETRY_COMPLETED",
        persist: true,
        result: {
          intent_id: actionEnvelope && actionEnvelope.intent_id,
          fills_executed: Number(result && result.fills_executed) || 0,
          intents_created: Number(result && result.intents_created) || 0,
          position_state: String(nextPos && nextPos.state || "").toUpperCase() || null,
        },
      });

      return res.json({
        ok: true,
        exchange,
        market,
        event,
        side,
        qty_base: qtyBase,
        qty_source: qtySource,
        intent_id: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null,
        scheduled_exec_kst: toKstStringFromMs(execBarCloseMs, { fallback: null }),
        result,
        position: nextPos,
      });
    } catch (err) {
      runActionPostHooks({
        envelope: actionEnvelope || {
          action: "TRADING_MANUAL_RETRY_ENTRY",
          ts: new Date().toISOString(),
        },
        ok: false,
        reason: "MANUAL_RETRY_FAILED",
        persist: true,
        result: null,
        extra: {
          error: String(err && err.message || err).slice(0, 240),
        },
      });
      return res.status(500).json({ ok: false, error: "MANUAL_RETRY_FAILED", message: String(err && err.message || err) });
    }
  });

  // Cancel pending intents for a market (all exchanges)
  router.post("/api/trading/cancel-pending", async (req, res) => {
    let actionEnvelope = null;
    try {
      const body = req.body || {};
      const rawMarket = String(body.market || body.symbol || "").trim();
      if (!rawMarket) {
        return res.status(400).json({ ok: false, error: "MARKET_REQUIRED" });
      }

      const providerRaw = body.provider || body.exchange || req.query.provider || req.query.exchange || "";
      const provider = providerRaw ? normalizeProviderId(providerRaw) : "";
      const exCfg = provider
        ? await getExchangeSettingsForProvider(provider, 2000)
        : await getEffectiveExchangesSettings(2000);
      const exchange = normalizeProviderId(exCfg && exCfg.provider ? exCfg.provider : (provider || "BINANCEFUT"));

      const market = normalizeMarketSymbolForProvider(rawMarket, exchange);
      const markets = Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [];
      if (!market || (markets.length && !markets.includes(market))) {
        return res.status(400).json({ ok: false, error: "MARKET_NOT_ALLOWED" });
      }
      const pre = runActionPreHooks({
        action: "TRADING_CANCEL_PENDING",
        runId: `RUN__CANCEL_PENDING__${exchange}__${market}__${Date.now()}`,
        exchange,
        symbol: market,
        tf: null,
        signalEvent: "CANCEL_PENDING",
        decisionReason: "MANUAL_CANCEL_UI",
        source: "TRADING_ACTIONS_ROUTE",
        executionMode: null,
        intent: "CANCEL",
        persist: true,
      });
      actionEnvelope = pre.envelope;

      const result = await cancelPendingIntentsByMarket({
        exchange,
        symbol: market,
        limitN: 300,
        reason: "MANUAL_CANCEL_UI",
        note: "CANCEL_PENDING_UI",
      });
      runActionPostHooks({
        envelope: actionEnvelope,
        ok: true,
        reason: "CANCEL_PENDING_COMPLETED",
        persist: true,
        result: {
          canceled: result.canceled || 0,
          scanned: result.scanned || 0,
        },
      });

      return res.json({
        ok: true,
        exchange,
        market,
        canceled: result.canceled || 0,
        scanned: result.scanned || 0,
      });
    } catch (err) {
      runActionPostHooks({
        envelope: actionEnvelope || {
          action: "TRADING_CANCEL_PENDING",
          ts: new Date().toISOString(),
        },
        ok: false,
        reason: "CANCEL_PENDING_FAILED",
        persist: true,
        result: null,
        extra: {
          error: String(err && err.message || err).slice(0, 240),
        },
      });
      return res.status(500).json({ ok: false, error: "CANCEL_PENDING_FAILED", message: String(err && err.message || err) });
    }
  });

  return router;
}

module.exports = createTradingActionsRoutes;
module.exports.__test = {
  normalizeManualRetryEvent,
  sideFromRetryEvent,
  resolveRetryQtyBaseFromTrades,
};
