const express = require("express");
const { getEffectiveExchangesSettings, getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { normalizeMarketSymbolForProvider, tfToMs, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { normalizeProviderId } = require("../utils/providerUtils");
const { fetchCandles } = require("../exchanges");
const { getPosition } = require("../storage/positions");
const { getPosition: getPaperPosition, upsertPosition: upsertPaperPosition, runWithPositionWriterLease } = require("../storage/positionsPaper");
const { upsertIntent, cancelPendingIntentsByMarket } = require("../storage/orderIntentsPaper");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { getPositionRuntimeObservation, resolveTrailObservationSnapshot } = require("../storage/positionRuntimeObservations");
const { toKstStringFromMs } = require("../utils/timeKst");
const { fetchFuturesUserTrades } = require("../exchanges/binanceFuturesPrivate");
const { syncBinanceFuturesFills } = require("../services/binanceFuturesFillsSync");
const { healBinanceLivePosition } = require("../services/binanceLiveStateSelfHeal");
const { syncNativeProtectionMetaFromBinance } = require("../services/nativeProtectionMetaSync");
const { getPositionReadView } = require("../services/positionReadModel");
const { loadMlServingRuntime } = require("../services/mlServingRuntime");
const { loadOperationalGuardRuntime } = require("../services/operationalGuardRuntime");
const { loadSystemSloRuntime } = require("../services/systemSloRuntime");
const { loadSystemAnomalyRuntime } = require("../services/systemAnomalyRuntime");
const {
  runPaperFuturesForBar,
  syncFuturesPositionOnly,
  runDistributedFuturesPositionSync,
} = require("../engine/paperBinanceRunner");
const { runActionPreHooks, runActionPostHooks } = require("../utils/actionExecutionHooks");

function nowMs() {
  return Date.now();
}

function allowLocal() {
  return String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
}

function ensureAuthOrSchedulerToken(req, res, next) {
  if (allowLocal()) return next();
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (expected && token === expected) return next();
  return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
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

async function getOperationalPositionView({ exchange, symbol } = {}) {
  return getPositionReadView({ exchange, symbol });
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

      const pos = await getOperationalPositionView({ exchange, symbol: market });
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
      const pre = await runActionPreHooks({
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
      const leaseResult = await runDistributedFuturesPositionSync({
        exchange,
        symbol: market,
        ttlMs: 120000,
        runner: async () => runWithPositionWriterLease({
          exchange,
          symbol: market,
          ttlMs: 120000,
          waitMs: 3000,
          runner: async () => {
          await syncFuturesPositionOnly({ runId, exchange, symbol: market, force: true });
          const curPos = await getOperationalPositionView({ exchange, symbol: market });
          const curState = String(curPos && curPos.state || "").toUpperCase();
          const curQtyBase = Number(curPos && curPos.qty_base);
          if (curState === "ACTIVE" && Number.isFinite(curQtyBase) && curQtyBase > 0) {
            return { ok: false, statusCode: 409, error: "POSITION_ALREADY_ACTIVE" };
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
            return { ok: false, statusCode: 400, error: "QTY_BASE_REQUIRED" };
          }

          const bars = await fetchCandles(exchange, market, "15m", 2);
          const bar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
          const execBarCloseMs = Number(bar && bar.closeTimeUtcMs);
          const execBarCloseUtc = String(bar && bar.closeTimeUtc || "");
          if (!Number.isFinite(execBarCloseMs) || !execBarCloseUtc) {
            return { ok: false, statusCode: 500, error: "LATEST_BAR_MISSING" };
          }
          const signalTf = (Array.isArray(exCfg && exCfg.tf_allowlist) && exCfg.tf_allowlist.length)
            ? String(exCfg.tf_allowlist[0])
            : (defaultExecTfFromEnv() || "15m");
          const execTf = String((exCfg && exCfg.exec_tf) || "15m");
          if (execTf !== "15m") {
            return { ok: false, statusCode: 400, error: "MANUAL_RETRY_EXEC_TF_UNSUPPORTED", exec_tf: execTf };
          }

          const fracRaw = body.fraction ?? body.qty_fraction ?? body.qty_pct ?? body.pct;
          const fraction = normalizeFraction(fracRaw) || 1;
          const sys = await getSystemSettingsForProvider(exchange, 2000);
          const execModeRaw = String(sys && sys.data && sys.data.execution_mode ? sys.data.execution_mode : "PAPER").toUpperCase();
          const executionMode = execModeRaw === "LIVE" ? "LIVE" : "PAPER";
          const signalMs = Date.now();
          const [mlServing, operationalGuard, systemSlo, systemAnomaly] = await Promise.all([
            loadMlServingRuntime({ exchange }),
            loadOperationalGuardRuntime({ exchange }),
            loadSystemSloRuntime({ exchange }),
            loadSystemAnomalyRuntime({ exchange }),
          ]);
          const pre = await runActionPreHooks({
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
            snapshotOverride: {
              mlServing,
              operationalGuard,
              systemSlo,
              systemAnomaly,
            },
          });
          actionEnvelope = pre.envelope;
          if (!pre.ok) {
            return {
              ok: false,
              statusCode: 409,
              error: "MANUAL_RETRY_PRE_HOOK_BLOCKED",
              reason: pre.reason,
            };
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

          await syncFuturesPositionOnly({ runId, exchange, symbol: market, force: true });
          const nextPos = await getOperationalPositionView({ exchange, symbol: market });
          return {
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
          };
          },
        }),
      });
      if (leaseResult && leaseResult.ok === false) {
        if (leaseResult.error === "MANUAL_RETRY_PRE_HOOK_BLOCKED") {
          return res.status(409).json({
            ok: false,
            error: "MANUAL_RETRY_PRE_HOOK_BLOCKED",
            reason: leaseResult.reason,
          });
        }
        if (leaseResult.reason === "LEASE_HELD" || leaseResult.reason === "LEASE_LOST") {
          return res.status(409).json({ ok: false, error: "MANUAL_RETRY_BUSY", reason: leaseResult.reason });
        }
        return res.status(Number(leaseResult.statusCode) || 400).json(leaseResult);
      }
      const nextPos = leaseResult.position;
      runActionPostHooks({
        envelope: actionEnvelope,
        ok: true,
        reason: "MANUAL_RETRY_COMPLETED",
        persist: true,
        result: {
          intent_id: actionEnvelope && actionEnvelope.intent_id,
          fills_executed: Number(leaseResult.result && leaseResult.result.fills_executed) || 0,
          intents_created: Number(leaseResult.result && leaseResult.result.intents_created) || 0,
          position_state: String(nextPos && nextPos.state || "").toUpperCase() || null,
        },
      });

      return res.json(leaseResult);
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
      const pre = await runActionPreHooks({
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

  router.post("/api/trading/repair-native-protection", ensureAuthOrSchedulerToken, async (req, res) => {
    try {
      const body = req.body || {};
      const providerRaw = body.provider || body.exchange || req.query.provider || req.query.exchange || "BINANCEFUT";
      const exchange = normalizeProviderId(providerRaw || "BINANCEFUT");
      if (exchange !== "BINANCEFUT") {
        return res.status(400).json({ ok: false, error: "BINANCE_ONLY" });
      }

      const rawMarket = String(body.market || body.symbol || req.query.market || req.query.symbol || "").trim();
      if (!rawMarket) {
        return res.status(400).json({ ok: false, error: "MARKET_REQUIRED" });
      }
      const exCfg = await getExchangeSettingsForProvider(exchange, 2000);
      const market = normalizeMarketSymbolForProvider(rawMarket, exchange);
      const markets = Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [];
      if (!market || (markets.length && !markets.includes(market))) {
        return res.status(400).json({ ok: false, error: "MARKET_NOT_ALLOWED" });
      }

      const healed = await healBinanceLivePosition({
        exchange,
        symbol: market,
        runId: `RUN__REPAIR_NATIVE__${exchange}__${market}__${Date.now()}`,
        forceRepair: true,
      });
      const pos = await getPositionReadView({
        exchange,
        symbol: market,
        fallbackPosition: healed && healed.position ? healed.position : await getPaperPosition({ exchange, symbol: market }),
      });
      const sizePct = Number(pos && pos.size_pct);
      if (!pos || String(pos.position_state || pos.state || "").toUpperCase() === "FLAT" || !Number.isFinite(sizePct) || sizePct <= 0) {
        return res.status(400).json({ ok: false, error: "NO_ACTIVE_POSITION" });
      }
      const payload = healed && healed.position ? healed.position : pos;
      const nextMeta = (payload && typeof payload.meta === "object") ? payload.meta : {};
      return res.json({
        ok: true,
        exchange,
        market,
        repaired: healed && healed.repaired === true,
        position_state: payload.position_state || null,
        qty_base: payload.qty_base || null,
        native_refresh_status: nextMeta.native_protection_refresh_status || null,
        native_refresh_reason: nextMeta.native_protection_refresh_reason || null,
        tp0_order_id: nextMeta.native_protection_tp0_order_id || null,
        tp1_order_id: nextMeta.native_protection_tp_order_id || null,
        stop_order_id: nextMeta.native_protection_stop_order_id || null,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "REPAIR_NATIVE_PROTECTION_FAILED",
        message: String(err && err.message ? err.message : err),
      });
    }
  });

  // Sync native protection meta from Binance snapshot.
  //
  // Reads current open + algo open orders on Binance for the symbol and writes
  // the STOP_MARKET/TAKE_PROFIT_MARKET order ids + trigger prices back into
  // `meta.native_protection_*`. Useful when manual intervention (operator
  // cancel/replace) or a partial recovery leaves meta drifted from reality.
  // Does NOT place, cancel, or modify orders on Binance.
  router.post("/api/trading/sync-native-protection-meta", ensureAuthOrSchedulerToken, async (req, res) => {
    try {
      const body = req.body || {};
      const providerRaw = body.provider || body.exchange || req.query.provider || req.query.exchange || "BINANCEFUT";
      const exchange = normalizeProviderId(providerRaw || "BINANCEFUT");
      if (exchange !== "BINANCEFUT") {
        return res.status(400).json({ ok: false, error: "BINANCE_ONLY" });
      }

      const rawMarket = String(body.market || body.symbol || req.query.market || req.query.symbol || "").trim();
      if (!rawMarket) {
        return res.status(400).json({ ok: false, error: "MARKET_REQUIRED" });
      }
      const exCfg = await getExchangeSettingsForProvider(exchange, 2000);
      const market = normalizeMarketSymbolForProvider(rawMarket, exchange);
      const markets = Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [];
      if (!market || (markets.length && !markets.includes(market))) {
        return res.status(400).json({ ok: false, error: "MARKET_NOT_ALLOWED" });
      }

      const result = await syncNativeProtectionMetaFromBinance({ exchange, symbol: market });
      if (!result || result.ok !== true) {
        return res.status(400).json(result || { ok: false, error: "SYNC_FAILED" });
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "SYNC_NATIVE_PROTECTION_META_FAILED",
        message: String(err && err.message ? err.message : err),
      });
    }
  });

  router.post("/api/trading/sync-futures-live-state", ensureAuthOrSchedulerToken, async (req, res) => {
    try {
      const body = req.body || {};
      const providerRaw = body.provider || body.exchange || req.query.provider || req.query.exchange || "BINANCEFUT";
      const exchange = normalizeProviderId(providerRaw || "BINANCEFUT");
      if (exchange !== "BINANCEFUT") {
        return res.status(400).json({ ok: false, error: "BINANCE_ONLY" });
      }

      const rawMarket = String(body.market || body.symbol || req.query.market || req.query.symbol || "").trim();
      if (!rawMarket) {
        return res.status(400).json({ ok: false, error: "MARKET_REQUIRED" });
      }
      const exCfg = await getExchangeSettingsForProvider(exchange, 2000);
      const market = normalizeMarketSymbolForProvider(rawMarket, exchange);
      const markets = Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [];
      if (!market || (markets.length && !markets.includes(market))) {
        return res.status(400).json({ ok: false, error: "MARKET_NOT_ALLOWED" });
      }

      const lookbackMsRaw = body.lookback_ms ?? body.lookbackMs ?? req.query.lookback_ms ?? req.query.lookbackMs;
      const lookbackMs = Number.isFinite(Number(lookbackMsRaw)) && Number(lookbackMsRaw) > 0
        ? Number(lookbackMsRaw)
        : null;

      const fills = await syncBinanceFuturesFills({
        markets: [market],
        executionMode: "LIVE",
        lookbackMs,
        minIntervalMs: 0,
        force: true,
      });

      const posSync = await syncFuturesPositionOnly({
        runId: `RUN__SYNC_LIVE_STATE__${exchange}__${market}__${Date.now()}`,
        exchange,
        symbol: market,
      });
      const pos = await getPositionReadView({
        exchange,
        symbol: market,
        fallbackPosition: await getPaperPosition({ exchange, symbol: market }),
      });
      const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
      const observation = await getPositionRuntimeObservation({ exchange, symbol: market });
      const trailSnapshot = resolveTrailObservationSnapshot({ meta, observation });

      return res.json({
        ok: true,
        exchange,
        market,
        fills,
        position_sync: posSync,
        position_state: pos ? (pos.position_state || pos.state || null) : null,
        qty_base: pos ? (pos.qty_base ?? null) : null,
        tp_p0_done: meta.tp_p0_done === true,
        tp_p1_done: meta.tp_p1_done === true,
        trail_active: meta.trail_active === true,
        trail_high: trailSnapshot.trail_high,
        trail_high_at_ms: trailSnapshot.trail_high_at_ms,
        trail_low: trailSnapshot.trail_low,
        trail_low_at_ms: trailSnapshot.trail_low_at_ms,
        trail_source: trailSnapshot.trail_source || null,
        native_refresh_status: meta.native_protection_refresh_status || null,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "SYNC_FUTURES_LIVE_STATE_FAILED",
        message: String(err && err.message ? err.message : err),
      });
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
