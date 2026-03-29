const { fetchFuturesUserTrades, fetchFuturesOrder, fetchFuturesAlgoOrder } = require("../exchanges/binanceFuturesPrivate");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { normalizeMarketSymbolForProvider, normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { getFirestore } = require("../storage/firestore");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { upsertExternalFill } = require("../storage/fillsPaper");
const { getPosition, upsertPosition } = require("../storage/positionsPaper");
const { patchIntent } = require("../storage/orderIntentsPaper");
const { buildTradeId } = require("../storage/tradesPaper");
const { getExitRulesForExchange, resolveExitRulesForPosition } = require("../engine/signalEngine");
const { sendTradeExecutionAlert } = require("./tradeExecutionAlert");
const { ensureExitWorkerOn } = require("./exitWorkerScale");
const { sendAlert } = require("../utils/alerts");
const { resolvePositionSideFromPosition } = require("../utils/positionSide");

const DEFAULT_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 3 * 60 * 1000;
const DEFAULT_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_INTENT_FUTURE_ALLOW_MS = 3000;
const BINANCE_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 - 1000;
const DEFAULT_ALERT_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_INTENT_RECOVERY_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const DEFAULT_INTENT_RECOVERY_SCAN_LIMIT = 600;
const DEFAULT_ADD_NATIVE_PROTECTION_REFRESH_WINDOW_MS = 2 * 60 * 1000;

const syncState = {
  lastRunAt: 0,
};
const externalCloseAlertChannelCache = new Map();
const externalCloseAlertCooldownMap = new Map();

function nowIso() {
  return new Date().toISOString();
}

async function markSameDirectionTrailProfitCooldownFromExternalFill({
  exchange,
  symbol,
  event,
  realizedPnl,
  execTimeIso,
  positionSideBefore,
} = {}) {
  const ev = String(event || "").trim().toUpperCase();
  const pnl = Number(realizedPnl);
  const dir = String(positionSideBefore || "").trim().toUpperCase();
  const execMs = Date.parse(String(execTimeIso || ""));
  if (!ev.startsWith("EXIT_TRAIL")) return false;
  if (!Number.isFinite(pnl) || pnl <= 0) return false;
  if ((dir !== "LONG" && dir !== "SHORT") || !Number.isFinite(execMs)) return false;

  const pos = await getPosition({ exchange, symbol });
  const prevMeta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const nextMeta = {
    ...prevMeta,
    same_direction_trail_profit_exit_dir: dir,
    same_direction_trail_profit_exit_wall_ms: execMs,
    same_direction_trail_profit_exit_event: ev,
    same_direction_trail_profit_exit_realized_pnl: pnl,
    same_direction_trail_profit_exit_source: "BINANCE_USER_TRADES",
  };

  await upsertPosition({
    exchange,
    symbol,
    state: pos && pos.state ? pos.state : "FLAT",
    positionSide: (pos && pos.position_side) || null,
    sizePct: pos && pos.size_pct != null ? pos.size_pct : 0,
    avgPrice: pos && pos.avg_price != null ? pos.avg_price : null,
    qtyBase: pos && pos.qty_base != null ? pos.qty_base : null,
    runId: null,
    executionMode: (pos && pos.execution_mode) || "LIVE",
    budgetMaxKrw: pos && pos.budget_max_krw != null ? pos.budget_max_krw : null,
    budgetUsedKrw: pos && pos.budget_used_krw != null ? pos.budget_used_krw : null,
    budgetSource: pos && pos.budget_source != null ? pos.budget_source : null,
    meta: nextMeta,
  });

  return true;
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function pickFinitePositive(candidates = []) {
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function resolveIntentNotional(intent) {
  if (!intent || typeof intent !== "object") return null;
  const feat = (intent.features_json && typeof intent.features_json === "object") ? intent.features_json : {};
  return pickFinitePositive([
    intent.budget_used_krw,
    intent.fill_notional,
    intent.notional,
    intent.notional_krw,
    feat.budget_used_krw,
    feat.fill_notional,
    feat.notional,
    feat.notional_krw,
    feat.budget_used_quote,
    feat.order_notional,
  ]);
}

function resolveIntentQtyBase(intent) {
  if (!intent || typeof intent !== "object") return null;
  const feat = (intent.features_json && typeof intent.features_json === "object") ? intent.features_json : {};
  return pickFinitePositive([
    intent.qty_base,
    intent.fill_qty_base,
    intent.exec_qty_base,
    feat.qty_base,
    feat.fill_qty_base,
    feat.exec_qty_base,
    feat.order_qty_base,
  ]);
}

function computeSyncedQtyPct({ intent, tradeNotional, execQtyBase } = {}) {
  const intentQtyPct = Number(intent && intent.qty_pct);
  if (!Number.isFinite(intentQtyPct) || intentQtyPct <= 0) {
    return { qtyPct: null, mode: "NO_INTENT_QTY", ratio: null, intentQtyPct: null, intentNotional: null, intentQtyBase: null };
  }

  const expectedNotional = resolveIntentNotional(intent);
  const tradeNotionalNum = Number(tradeNotional);
  if (Number.isFinite(expectedNotional) && expectedNotional > 0 && Number.isFinite(tradeNotionalNum) && tradeNotionalNum > 0) {
    const ratioRaw = tradeNotionalNum / expectedNotional;
    const ratio = clamp01(ratioRaw);
    const qtyPct = (ratio !== null && ratio > 0) ? (intentQtyPct * ratio) : null;
    return {
      qtyPct: Number.isFinite(qtyPct) && qtyPct > 0 ? qtyPct : null,
      mode: "SCALED_NOTIONAL",
      ratio,
      intentQtyPct,
      intentNotional: expectedNotional,
      intentQtyBase: null,
    };
  }

  const expectedQtyBase = resolveIntentQtyBase(intent);
  const execQtyBaseNum = Number(execQtyBase);
  if (Number.isFinite(expectedQtyBase) && expectedQtyBase > 0 && Number.isFinite(execQtyBaseNum) && execQtyBaseNum > 0) {
    const ratioRaw = execQtyBaseNum / expectedQtyBase;
    const ratio = clamp01(ratioRaw);
    const qtyPct = (ratio !== null && ratio > 0) ? (intentQtyPct * ratio) : null;
    return {
      qtyPct: Number.isFinite(qtyPct) && qtyPct > 0 ? qtyPct : null,
      mode: "SCALED_QTY_BASE",
      ratio,
      intentQtyPct,
      intentNotional: null,
      intentQtyBase: expectedQtyBase,
    };
  }

  // If we cannot scale reliably, keep qty_pct null for external partial fills.
  return {
    qtyPct: null,
    mode: "UNSCALED_INTENT",
    ratio: null,
    intentQtyPct,
    intentNotional: expectedNotional,
    intentQtyBase: expectedQtyBase,
  };
}

function isTpP1Event(ev) {
  const e = String(ev || "").toUpperCase();
  return e === "EXIT_TP_P1" || e.startsWith("EXIT_TP_P1_");
}

function isSameOrderAsRecentTp1(orderMeta, recentTp1) {
  if (!orderMeta || !recentTp1) return false;
  const orderId = Number(orderMeta.orderId);
  const recentOrderId = Number(recentTp1.orderId);
  if (Number.isFinite(orderId) && Number.isFinite(recentOrderId) && orderId === recentOrderId) return true;

  const clientOrderId = String(orderMeta.clientOrderId || "").trim();
  const recentClientOrderId = String(recentTp1.clientOrderId || "").trim();
  if (clientOrderId && recentClientOrderId && clientOrderId === recentClientOrderId) return true;
  return false;
}

function pctLabel(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const absPct = Math.abs(n) * 100;
  if (!Number.isFinite(absPct) || absPct <= 0) return null;
  const rounded = Math.round(absPct * 100) / 100;
  return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

async function markTpP1DoneFromExternalFill({ exchange, symbol, execPrice, execTimeIso, entryEventId } = {}) {
  const pos = await getPosition({ exchange, symbol });
  const state = String(pos && (pos.position_state || pos.state) || "").toUpperCase();
  const sizePct = Number(pos && pos.size_pct);
  const qtyBase = Number(pos && pos.qty_base);
  const hasSize = (Number.isFinite(sizePct) && sizePct > 0) || (Number.isFinite(qtyBase) && qtyBase > 0);
  const stateOk = state === "ACTIVE" || state === "COMMIT" || state === "PROBE" || state === "SCALE_OUT";
  if (!stateOk && !hasSize) return false;

  const prevMeta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const currentEntryEventId = String(prevMeta.entry_event_id || "").trim();
  const tp1EntryEventId = String(entryEventId || "").trim();
  if (currentEntryEventId && tp1EntryEventId && currentEntryEventId !== tp1EntryEventId) return false;
  const entryExecMs = Number(prevMeta.entry_exec_bar_ms);
  const execMs = Date.parse(String(execTimeIso || ""));
  if (Number.isFinite(entryExecMs) && Number.isFinite(execMs) && (execMs + 30000) < entryExecMs) return false;
  const side = resolvePositionSideFromPosition(pos, prevMeta, "LONG");
  const prevTrailRef = side === "SHORT" ? Number(prevMeta.trail_low) : Number(prevMeta.trail_high);
  const tpP1AlreadyReady = prevMeta.tp_p1_done === true
    && prevMeta.trail_active === true
    && Number.isFinite(prevTrailRef);
  if (tpP1AlreadyReady) return false;
  const execPx = Number.isFinite(execPrice) ? execPrice : null;
  const nextTrailHigh = side === "SHORT" ? null : (execPx ?? prevMeta.trail_high ?? null);
  const nextTrailLow = side === "SHORT" ? (execPx ?? prevMeta.trail_low ?? null) : null;

  const nextMeta = {
    ...prevMeta,
    tp_p1_done: true,
    tp_p1_price: execPx ?? (prevMeta.tp_p1_price ?? null),
    trail_high: nextTrailHigh,
    trail_low: nextTrailLow,
    trail_active: true,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_at: execTimeIso || nowIso(),
    tp_p1_source: "BINANCE_USER_TRADES",
    tp_p1_entry_event_id: currentEntryEventId || tp1EntryEventId || null,
    tp_p1_entry_exec_bar_ms: Number.isFinite(entryExecMs) ? entryExecMs : null,
  };

  await upsertPosition({
    exchange,
    symbol,
    state: pos.state,
    positionSide: resolvePositionSideFromPosition(pos, prevMeta),
    sizePct: pos.size_pct,
    avgPrice: pos.avg_price,
    qtyBase: (pos.qty_base ?? prevMeta.qty_base ?? null),
    runId: null,
    executionMode: pos.execution_mode || "LIVE",
    budgetMaxKrw: pos.budget_max_krw ?? null,
    budgetUsedKrw: pos.budget_used_krw ?? null,
    budgetSource: pos.budget_source ?? null,
    meta: nextMeta,
  });

  console.warn(
    `[TP1_TRAIL_REPAIRED_BY_FILL_SYNC] ${symbol} side=${side || "UNKNOWN"} ` +
    `entry_event_id=${currentEntryEventId || tp1EntryEventId || "NA"} exec_price=${execPx ?? "NA"} ` +
    `trail_high=${nextTrailHigh ?? "NA"} trail_low=${nextTrailLow ?? "NA"}`
  );

  ensureExitWorkerOn({
    reason: `TP1_TRAIL_ARMED_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}`,
  }).catch((e) => {
    console.warn("[EXIT_WORKER_SCALE_ON_FAIL][TP1_SYNC]", e && e.message ? e.message : String(e));
  });

  return true;
}

function resolveEnvBool(v, def = false) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (!s) return def;
  return ["1", "true", "yes", "y", "on"].includes(s);
}

function filterTelegramChannels(raw) {
  return String(raw || "")
    .split(",")
    .map((v) => String(v || "").trim())
    .filter((v) => /^telegram:|^tg:|^telegram:\/\//i.test(v))
    .join(",");
}

async function resolveExternalCloseAlertChannel(exchange = "BINANCEFUT") {
  const ex = String(exchange || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
  const now = Date.now();
  const cached = externalCloseAlertChannelCache.get(ex);
  if (cached && Number.isFinite(cached.ts) && (now - cached.ts) < 60_000) {
    return cached.channel || "";
  }
  const sys = await getSystemSettingsForProvider(ex, 5000);
  const channel = filterTelegramChannels(String(sys && sys.data && sys.data.alert_channel || "").trim());
  externalCloseAlertChannelCache.set(ex, { ts: now, channel });
  return channel;
}

function shouldSendExternalCloseAlert({ symbol, orderId, clientOrderId } = {}) {
  const key = [
    String(symbol || "").trim().toUpperCase() || "UNKNOWN",
    Number.isFinite(Number(orderId)) ? String(Number(orderId)) : "NA",
    String(clientOrderId || "").trim() || "NA",
  ].join("|");
  const now = Date.now();
  const last = Number(externalCloseAlertCooldownMap.get(key));
  if (Number.isFinite(last) && (now - last) < 10 * 60 * 1000) return false;
  externalCloseAlertCooldownMap.set(key, now);
  return true;
}

function isExitEvent(event) {
  return String(event || "").trim().toUpperCase().startsWith("EXIT_");
}

function sumFiniteValues(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left + right;
  if (Number.isFinite(left)) return left;
  if (Number.isFinite(right)) return right;
  return null;
}

function resolveFillSyncAlertCloseRatio({ event, intent, qtyScale, execQtyBase, positionCtx } = {}) {
  if (!isExitEvent(event)) return null;
  const intentQtyFraction = clamp01(intent && intent.qty_fraction);
  const scaledRatio = clamp01(qtyScale && qtyScale.ratio);
  if (Number.isFinite(intentQtyFraction) && intentQtyFraction > 0) {
    if (Number.isFinite(scaledRatio) && scaledRatio > 0) {
      return clamp01(intentQtyFraction * scaledRatio);
    }
    return intentQtyFraction;
  }
  if (Number.isFinite(scaledRatio) && scaledRatio > 0) return scaledRatio;
  if (isTpP1Event(event)) {
    const execQty = Number(execQtyBase);
    const nativeTpQtyRatio = clamp01(positionCtx && positionCtx.nativeProtectionTpQtyRatio);
    const nativeTpQtyBase = Number(positionCtx && positionCtx.nativeProtectionTpQtyBase);
    if (
      Number.isFinite(execQty) && execQty > 0
      && Number.isFinite(nativeTpQtyBase) && nativeTpQtyBase > 0
      && Number.isFinite(nativeTpQtyRatio) && nativeTpQtyRatio > 0
    ) {
      return clamp01((execQty / nativeTpQtyBase) * nativeTpQtyRatio);
    }
    if (Number.isFinite(nativeTpQtyRatio) && nativeTpQtyRatio > 0) return nativeTpQtyRatio;
  }
  return null;
}

function resolveFillSyncAlertFullExit({ event, orderMeta, closeRatio } = {}) {
  const ev = String(event || "").trim().toUpperCase();
  if (!isExitEvent(ev)) return false;
  if (isTpP1Event(ev)) return false;
  if (orderMeta && orderMeta.closePosition === true) return true;
  if (Number.isFinite(closeRatio) && closeRatio >= 0.999) return true;
  if (
    ev.startsWith("EXIT_SL")
    || ev.startsWith("EXIT_TRAIL")
    || ev.startsWith("EXIT_TIME_STOP")
    || ev === "EXIT_EXTERNAL_SYNC"
    || ev === "EXIT_OPPOSITE_SIGNAL"
    || ev === "EXIT_LIQUIDATION_RISK"
  ) {
    return true;
  }
  return false;
}

function buildFillSyncAlertKey({ symbol, event, intent, side, orderMeta, tradeMs } = {}) {
  const sym = normalizeSymbol(symbol) || String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const ev = String(event || "").trim().toUpperCase() || "UNKNOWN";
  const it = String(intent || "").trim().toUpperCase() || "UNKNOWN";
  const tradeSide = String(side || "").trim().toUpperCase() || "NA";
  const orderId = Number.isFinite(Number(orderMeta && orderMeta.orderId))
    ? String(Number(orderMeta.orderId))
    : "NA";
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim() || "NA";
  const tradeBucket = Number.isFinite(Number(tradeMs))
    ? String(Math.floor(Number(tradeMs) / 60000))
    : "NA";
  return [sym, ev, it, tradeSide, orderId, clientOrderId, tradeBucket].join("|");
}

function queueFillSyncAlertBatch(batchMap, {
  symbol,
  event,
  intent,
  side,
  orderMeta,
  tradeMs,
  payload,
} = {}) {
  if (!(batchMap instanceof Map) || !payload || typeof payload !== "object") return;
  const key = buildFillSyncAlertKey({ symbol, event, intent, side, orderMeta, tradeMs });
  const current = batchMap.get(key);
  if (!current) {
    batchMap.set(key, {
      key,
      latestTradeMs: Number.isFinite(Number(tradeMs)) ? Number(tradeMs) : 0,
      fillCount: 1,
      payload: { ...payload },
    });
    return;
  }

  const nextTradeMs = Number.isFinite(Number(tradeMs)) ? Number(tradeMs) : current.latestTradeMs;
  const currentCloseRatio = Number(current.payload.closeRatio);
  const payloadCloseRatio = Number(payload.closeRatio);
  const mergedCloseRatio = (Number.isFinite(currentCloseRatio) || Number.isFinite(payloadCloseRatio))
    ? clamp01((Number.isFinite(currentCloseRatio) ? currentCloseRatio : 0) + (Number.isFinite(payloadCloseRatio) ? payloadCloseRatio : 0))
    : null;
  const mergedPayload = {
    ...current.payload,
    ...payload,
    notional: sumFiniteValues(current.payload.notional, payload.notional),
    realizedPnl: sumFiniteValues(current.payload.realizedPnl, payload.realizedPnl),
    closeRatio: mergedCloseRatio,
    fullExit: current.payload.fullExit === true || payload.fullExit === true,
  };
  if (!(Number.isFinite(Number(payload.execPrice)) && nextTradeMs >= current.latestTradeMs)) {
    mergedPayload.execPrice = current.payload.execPrice;
  }

  batchMap.set(key, {
    key,
    latestTradeMs: Math.max(current.latestTradeMs, nextTradeMs),
    fillCount: current.fillCount + 1,
    payload: mergedPayload,
  });
}

async function flushFillSyncAlertBatches(batchMap) {
  if (!(batchMap instanceof Map) || !batchMap.size) return;
  const items = Array.from(batchMap.values()).sort((a, b) => a.latestTradeMs - b.latestTradeMs);
  for (const item of items) {
    try {
      await sendTradeExecutionAlert(item.payload);
    } catch (e) {
      console.warn("[TRADE_EXEC_ALERT_FAIL][FILL_SYNC_BATCH]", e && e.message ? e.message : String(e));
    }
  }
  batchMap.clear();
}

async function sendExternalCloseAlert({
  symbol,
  tradeMs,
  orderMeta,
  recentTp1,
} = {}) {
  if (!resolveEnvBool(process.env.BINANCEFUT_EXTERNAL_CLOSE_ALERT_ENABLED, true)) return;
  const ageMs = Date.now() - Number(tradeMs);
  const maxAgeMs = Number(process.env.BINANCEFUT_EXTERNAL_CLOSE_ALERT_MAX_AGE_MS) || (30 * 60 * 1000);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) return;
  if (!shouldSendExternalCloseAlert({
    symbol,
    orderId: orderMeta && orderMeta.orderId,
    clientOrderId: orderMeta && orderMeta.clientOrderId,
  })) return;
  const channel = await resolveExternalCloseAlertChannel("BINANCEFUT");
  if (!channel) return;
  const afterTp1Sec = recentTp1 && Number.isFinite(Number(recentTp1.tradeMs)) && Number.isFinite(Number(tradeMs))
    ? Math.max(0, (Number(tradeMs) - Number(recentTp1.tradeMs)) / 1000)
    : null;
  const isAfterTp1 = Number.isFinite(afterTp1Sec) && afterTp1Sec <= (Number(process.env.BINANCEFUT_EXTERNAL_CLOSE_AFTER_TP1_WINDOW_MS) || 120);
  const title = isAfterTp1
    ? `${String(symbol || "").toUpperCase() || "UNKNOWN"} TP1 직후 외부 전량청산 감지`
    : `${String(symbol || "").toUpperCase() || "UNKNOWN"} 외부 전량청산 감지`;
  const lines = [
    `order_id: ${Number.isFinite(Number(orderMeta && orderMeta.orderId)) ? Number(orderMeta.orderId) : "NA"}`,
    `client_order_id: ${String(orderMeta && orderMeta.clientOrderId || "").trim() || "NA"}`,
    `order_type: ${String(orderMeta && orderMeta.orderType || "").toUpperCase() || "UNKNOWN"}`,
    `close_position: ${orderMeta && orderMeta.closePosition === true ? "true" : "false"}`,
    `tracked_client: 0`,
    `trade_time_utc: ${Number.isFinite(Number(tradeMs)) ? new Date(Number(tradeMs)).toISOString() : nowIso()}`,
  ];
  if (isAfterTp1) {
    lines.push(`after_tp1_sec: ${afterTp1Sec.toFixed(3)}`);
    lines.push(`tp1_event: ${String(recentTp1 && recentTp1.event || "EXIT_TP_P1")}`);
  }
  try {
    await sendAlert({
      channel,
      title,
      body: lines.join("\n"),
      severity: isAfterTp1 ? "ERROR" : "WARN",
    });
  } catch (e) {
    console.warn("[EXTERNAL_CLOSE_ALERT_FAIL]", e && e.message ? e.message : String(e));
  }
}

async function resolveBinanceKeys() {
  const ex = await getExchangeSettingsForProvider("BINANCEFUT", 5000);
  const apiKey = String(process.env.BINANCEFUT_API_KEY || (ex && ex.api_key) || "").trim();
  const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (ex && ex.api_secret) || "").trim();
  if (!apiKey || !apiSecret) return null;
  if (!process.env.BINANCEFUT_API_KEY) process.env.BINANCEFUT_API_KEY = apiKey;
  if (!process.env.BINANCEFUT_API_SECRET) process.env.BINANCEFUT_API_SECRET = apiSecret;
  return { apiKey, apiSecret, ex };
}

function cursorDocId(symbol) {
  return `FILL_SYNC__BINANCEFUT__${symbol}`;
}

function normalizeSymbol(raw) {
  return normalizeMarketSymbolForProvider(raw, "BINANCEFUT");
}

function pickIntentForTrade(trade, intents, matchWindowMs, intentFutureAllowMs = DEFAULT_INTENT_FUTURE_ALLOW_MS) {
  if (!trade) return null;
  const sym = normalizeSymbol(trade.symbol || "");
  const side = String(trade.side || "").toUpperCase();
  const tradeMs = Number(trade.time);
  if (!sym || !side || !Number.isFinite(tradeMs)) return null;

  let best = null;
  for (const it of intents) {
    if (!it) continue;
    if (String(it.exchange || "").toUpperCase() !== "BINANCEFUT") continue;
    const itSym = normalizeSymbol(it.symbol_or_pair_id || it.symbol || it.market || "");
    if (itSym !== sym) continue;
    const itSide = String(it.side || "").toUpperCase();
    if (itSide && itSide !== side) continue;
    const createdAtMs = Date.parse(String(it.created_at || ""));
    if (Number.isFinite(createdAtMs) && createdAtMs > (tradeMs + Math.max(0, Number(intentFutureAllowMs) || 0))) continue;
    const tMs = Number(
      it.signal_bar_close_time_utc_ms ||
      it.scheduled_exec_bar_close_time_utc_ms ||
      it.exec_bar_close_time_utc_ms ||
      (it.created_at ? Date.parse(it.created_at) : NaN)
    );
    if (!Number.isFinite(tMs)) continue;
    const delta = Math.abs(tradeMs - tMs);
    if (delta > matchWindowMs) continue;
    if (!best || delta < best.delta) best = { intent: it, delta };
  }
  return best ? best.intent : null;
}

function extractEntryContextFromIntent(intent) {
  if (!intent || typeof intent !== "object") return { entryEventId: null, entrySignalType: null };
  const features = (intent.features_json && typeof intent.features_json === "object") ? intent.features_json : {};
  const entryEventId = String(intent.entry_event_id || features.entry_event_id || "").trim() || null;
  const entrySignalType = String(intent.entry_signal_type || features.entry_signal_type || "").toUpperCase() || null;
  return { entryEventId, entrySignalType };
}

function canRecoverCanceledIntent(intent) {
  if (!intent || typeof intent !== "object") return false;
  const status = String(intent.status || "").toUpperCase();
  if (status !== "CANCELED") return false;
  const reason = String(intent.cancel_reason || intent.status_reason || "").toUpperCase();
  return reason === "LIVE_EXCEPTION" || reason === "LIVE_FAILED" || reason.startsWith("LIVE_");
}

async function recoverIntentFromExternalFill({
  intent,
  intentId,
  execTimeIso,
  execPrice,
  execQtyBase,
  notional,
  tradeId,
} = {}) {
  if (!intentId || !canRecoverCanceledIntent(intent)) return false;
  const recoveredAt = nowIso();
  const prevReason = String(intent.cancel_reason || intent.status_reason || "").toUpperCase() || null;
  await patchIntent(intentId, {
    status: "FILLED",
    status_reason: "EXTERNAL_FILL_RECONCILED",
    filled_at: execTimeIso || recoveredAt,
    filled_via: "BINANCE_USER_TRADES",
    fill_price: Number.isFinite(execPrice) ? execPrice : null,
    fill_qty_base: Number.isFinite(execQtyBase) ? execQtyBase : null,
    fill_notional: Number.isFinite(notional) ? notional : null,
    last_external_trade_id: Number.isFinite(Number(tradeId)) ? Number(tradeId) : null,
    recovered_at: recoveredAt,
    recovered_from_cancel_reason: prevReason,
    cancel_reason: null,
    cancel_note: null,
  });
  intent.status = "FILLED";
  intent.status_reason = "EXTERNAL_FILL_RECONCILED";
  intent.cancel_reason = null;
  return true;
}

async function reconcileCanceledIntentsFromRecentFills({
  lookbackMs = DEFAULT_INTENT_RECOVERY_LOOKBACK_MS,
  scanLimit = DEFAULT_INTENT_RECOVERY_SCAN_LIMIT,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const lookback = Number.isFinite(Number(lookbackMs)) && Number(lookbackMs) > 0
    ? Number(lookbackMs)
    : DEFAULT_INTENT_RECOVERY_LOOKBACK_MS;
  const limitN = Number.isFinite(Number(scanLimit)) && Number(scanLimit) > 0
    ? Math.floor(Number(scanLimit))
    : DEFAULT_INTENT_RECOVERY_SCAN_LIMIT;
  const cutoffMs = now - lookback;

  const snap = await db.collection("fills_paper")
    .orderBy("updated_at", "desc")
    .limit(limitN)
    .get();

  const latestByIntent = new Map();
  snap.forEach((doc) => {
    const x = doc.data() || {};
    if (String(x.exchange || "").toUpperCase() !== "BINANCEFUT") return;
    if (String(x.exec_price_source || "").toUpperCase() !== "BINANCE_USER_TRADES") return;
    const intentId = String(x.intent_id || "").trim();
    if (!intentId) return;
    const updatedMs = Date.parse(String(x.updated_at || x.created_at || ""));
    if (Number.isFinite(updatedMs) && updatedMs < cutoffMs) return;
    if (!latestByIntent.has(intentId)) {
      latestByIntent.set(intentId, x);
    }
  });

  let checked = 0;
  let recovered = 0;
  for (const [intentId, fill] of latestByIntent.entries()) {
    checked += 1;
    const intentSnap = await db.collection("order_intents_paper").doc(intentId).get();
    if (!intentSnap.exists) continue;
    const intentDoc = intentSnap.data() || {};
    if (!canRecoverCanceledIntent(intentDoc)) continue;
    const didRecover = await recoverIntentFromExternalFill({
      intent: intentDoc,
      intentId,
      execTimeIso: fill.exec_bar_close_time_utc || fill.updated_at || nowIso(),
      execPrice: Number(fill.exec_price),
      execQtyBase: Number(fill.exec_qty_base),
      notional: Number(fill.notional),
      tradeId: fill.external_trade_id,
    });
    if (didRecover) recovered += 1;
  }

  return { ok: true, checked, recovered };
}

async function loadPositionEntryContext(exchange, symbol, cacheMap) {
  const key = `${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}`;
  if (cacheMap && cacheMap.has(key)) return cacheMap.get(key);
  let ctx = {
    entryEventId: null,
    entrySignalType: null,
    positionSide: null,
    leverage: null,
    tpP1Done: false,
    trailActive: false,
  };
  try {
    const pos = await getPosition({ exchange, symbol });
    const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
    const entryEventId = String(meta.entry_event_id || "").trim() || null;
    const entrySignalType = String(meta.entry_signal_type || "").toUpperCase() || null;
    const positionSide = resolvePositionSideFromPosition(pos, meta);
    const leverageRaw = Number(meta.external_leverage ?? meta.leverage ?? pos.leverage);
    ctx = {
      entryEventId,
      entrySignalType,
      positionSide,
      qtyBase: Number.isFinite(Number(pos && pos.qty_base))
        ? Number(pos.qty_base)
        : (Number.isFinite(Number(meta.qty_base ?? meta.external_qty_base))
          ? Number(meta.qty_base ?? meta.external_qty_base)
          : null),
      leverage: Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : null,
      tpP1Done: meta.tp_p1_done === true,
      trailActive: meta.trail_active === true,
      nativeProtectionStale: meta.native_protection_stale === true,
      nativeProtectionRefreshStatus: String(meta.native_protection_refresh_status || "").toUpperCase() || null,
      nativeProtectionRefreshContext: String(meta.native_protection_refresh_context || "").toUpperCase() || null,
      nativeProtectionRefreshAtMs: Number.isFinite(Number(meta.native_protection_refresh_at_ms))
        ? Number(meta.native_protection_refresh_at_ms)
        : null,
      nativeProtectionTpQtyBase: Number.isFinite(Number(meta.native_protection_tp_qty_base))
        ? Number(meta.native_protection_tp_qty_base)
        : null,
      nativeProtectionTpQtyRatio: Number.isFinite(Number(meta.native_protection_tp_qty_ratio))
        ? Number(meta.native_protection_tp_qty_ratio)
        : null,
      exitRulesOverride: (meta.exit_rules_override && typeof meta.exit_rules_override === "object")
        ? meta.exit_rules_override
        : null,
    };
  } catch (_) {}
  if (cacheMap) cacheMap.set(key, ctx);
  return ctx;
}

async function loadRecentIntents(limit = 1000) {
  const db = getFirestore();
  const snap = await db.collection("order_intents_paper").orderBy("created_at", "desc").limit(limit).get();
  const out = [];
  snap.forEach((doc) => out.push(doc.data()));
  return out;
}

function isMeaningfulRealizedPnl(v) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) > 1e-12;
}

function buildExitEventByKind(kind, rules) {
  const k = String(kind || "").toUpperCase();
  const slLabel = pctLabel(rules && rules.SL);
  const tpLabel = pctLabel(rules && rules.TP_P1);
  const trailLabel = pctLabel(rules && rules.TRAIL_PCT);
  if (k === "SL") return slLabel ? `EXIT_SL_${slLabel}P` : "EXIT_SL";
  if (k === "TP1") return tpLabel ? `EXIT_TP_P1_${tpLabel}P` : "EXIT_TP_P1";
  if (k === "TRAIL") return trailLabel ? `EXIT_TRAIL_${trailLabel}P` : "EXIT_TRAIL";
  return "EXIT_EXTERNAL_SYNC";
}

function isSyntheticExternalFillExitEvent(event) {
  const ev = String(event || "").toUpperCase();
  if (!ev) return false;
  if (/^EXIT_TIME_STOP_\d+B$/.test(ev)) return true;
  if (ev === "EXIT_TIME_STOP") return true;
  return false;
}

function normalizeOrderBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || "").trim().toLowerCase();
  if (!s) return false;
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "on";
}

function isNativeTpEnabled() {
  const raw = String(process.env.BINANCE_NATIVE_TP_ENABLED || "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isRecentAddNativeProtectionRefresh({ positionCtx, tradeMs } = {}) {
  const ctx = (positionCtx && typeof positionCtx === "object") ? positionCtx : {};
  const context = String(ctx.nativeProtectionRefreshContext || "").toUpperCase();
  const refreshStatus = String(ctx.nativeProtectionRefreshStatus || "").toUpperCase();
  const stale = ctx.nativeProtectionStale === true;
  const refreshAtMs = Number(ctx.nativeProtectionRefreshAtMs);
  const tradeTimeMs = Number(tradeMs);
  const windowMsRaw = Number(process.env.BINANCEFUT_ADD_NATIVE_PROTECTION_REFRESH_WINDOW_MS);
  const windowMs = Number.isFinite(windowMsRaw) && windowMsRaw > 0
    ? Math.floor(windowMsRaw)
    : DEFAULT_ADD_NATIVE_PROTECTION_REFRESH_WINDOW_MS;
  if (context !== "ADD") return false;
  if (!stale && refreshStatus !== "FAILED") return false;
  if (!Number.isFinite(refreshAtMs) || !Number.isFinite(tradeTimeMs)) return false;
  return Math.abs(tradeTimeMs - refreshAtMs) <= windowMs;
}

function normalizeFetchedOrderMeta(ord) {
  if (!ord || typeof ord !== "object") {
    return {
      orderType: null,
      closePosition: false,
      reduceOnly: false,
      clientOrderId: null,
      status: null,
    };
  }
  return {
    orderType: String(ord.type || ord.origType || "").toUpperCase() || null,
    closePosition: normalizeOrderBool(ord.closePosition),
    reduceOnly: normalizeOrderBool(ord.reduceOnly),
    clientOrderId: String(ord.clientOrderId || ord.origClientOrderId || "").trim() || null,
    status: String(ord.status || "").toUpperCase() || null,
  };
}

async function resolveExternalOrderMeta({
  trade,
  apiKey,
  apiSecret,
  symbol,
  orderMetaCache,
} = {}) {
  const orderId = Number(trade && (trade.orderId || trade.order_id));
  if (!Number.isFinite(orderId)) {
    return {
      orderId: null,
      orderType: null,
      closePosition: false,
      reduceOnly: false,
      clientOrderId: null,
      status: null,
    };
  }
  if (orderMetaCache && orderMetaCache.has(orderId)) {
    return orderMetaCache.get(orderId);
  }

  let meta = {
    orderId,
    orderType: null,
    closePosition: false,
    reduceOnly: false,
    clientOrderId: null,
    status: null,
  };
  let regularFetchError = null;
  try {
    const ord = await fetchFuturesOrder({
      apiKey,
      apiSecret,
      symbol,
      orderId,
    });
    meta = {
      orderId,
      ...normalizeFetchedOrderMeta(ord),
    };
  } catch (e) {
    regularFetchError = e;
    try {
      const algoOrd = await fetchFuturesAlgoOrder({
        apiKey,
        apiSecret,
        symbol,
        algoId: orderId,
      });
      meta = {
        orderId,
        ...normalizeFetchedOrderMeta(algoOrd),
      };
    } catch (algoErr) {
      const regText = String(regularFetchError && regularFetchError.message ? regularFetchError.message : regularFetchError || "").slice(0, 160);
      const algoText = String(algoErr && algoErr.message ? algoErr.message : algoErr || "").slice(0, 160);
      console.warn(
        `[FILL_SYNC_ORDER_META_FETCH_FAIL] ${String(symbol || "").toUpperCase()} order_id=${orderId} ` +
        `regular=${regText || "NA"} algo=${algoText || "NA"}`
      );
    }
  }

  if (orderMetaCache) orderMetaCache.set(orderId, meta);
  return meta;
}

async function resolveExternalExitEvent({
  intent,
  trade,
  orderMeta,
  positionCtx,
  recentTp1,
  rules,
} = {}) {
  if (!isMeaningfulRealizedPnl(trade && trade.realizedPnl)) return "SYNC_FILL";

  const intentEvent = intent && intent.event
    ? String(intent.event).toUpperCase()
    : null;
  const orderType = String(orderMeta && orderMeta.orderType || "").toUpperCase() || null;
  const closePosition = !!(orderMeta && orderMeta.closePosition === true);
  const orderId = Number(orderMeta && orderMeta.orderId);
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim() || null;
  const trackedClientOrder = !!(clientOrderId && /^(fut_|dbj_)/.test(clientOrderId));
  const sameOrderAsRecentTp1 = isSameOrderAsRecentTp1(orderMeta, recentTp1);
  const recentAddProtectionRefresh = isRecentAddNativeProtectionRefresh({
    positionCtx,
    tradeMs: Number(trade && trade.time),
  });

  if (closePosition) {
    if (orderType === "STOP_MARKET" || orderType === "STOP") {
      return buildExitEventByKind("SL", rules);
    }
    if (orderType === "TAKE_PROFIT_MARKET" || orderType === "TAKE_PROFIT") {
      if (positionCtx && positionCtx.trailActive) return buildExitEventByKind("TRAIL", rules);
      return buildExitEventByKind("TP1", rules);
    }
    if (trackedClientOrder && orderType === "MARKET" && !isNativeTpEnabled()) {
      const sym = normalizeSymbol(trade && trade.symbol);
      console.warn(
        `[FILL_SYNC_EVENT_RECLASSIFIED_NATIVE_SL] ${sym || "UNKNOWN"} order_id=${Number.isFinite(orderId) ? orderId : "NA"} ` +
        `client_order_id=${clientOrderId || "NA"} tracked=1 closePosition=true type=MARKET tp_native=0 -> SL`
      );
      return buildExitEventByKind("SL", rules);
    }
    if (recentAddProtectionRefresh && orderType === "MARKET" && !isNativeTpEnabled()) {
      const sym = normalizeSymbol(trade && trade.symbol);
      console.warn(
        `[FILL_SYNC_EVENT_RECLASSIFIED_ADD_REFRESH_SL] ${sym || "UNKNOWN"} order_id=${Number.isFinite(orderId) ? orderId : "NA"} ` +
        `client_order_id=${clientOrderId || "NA"} refresh_context=${positionCtx && positionCtx.nativeProtectionRefreshContext || "NA"} ` +
        `refresh_status=${positionCtx && positionCtx.nativeProtectionRefreshStatus || "NA"} stale=${positionCtx && positionCtx.nativeProtectionStale === true ? "1" : "0"} -> SL`
      );
      return buildExitEventByKind("SL", rules);
    }
    const sym = normalizeSymbol(trade && trade.symbol);
    const prefix = trackedClientOrder ? "[FILL_SYNC_EVENT_OVERRIDE]" : "[EXTERNAL_CLOSE_UNTRACKED]";
    const detail = intentEvent && isTpP1Event(intentEvent)
      ? `intent_event=${intentEvent} -> EXIT_EXTERNAL_SYNC (closePosition=true)`
      : "closePosition=true -> EXIT_EXTERNAL_SYNC";
    console.warn(
      `${prefix} ${sym || "UNKNOWN"} order_id=${Number.isFinite(orderId) ? orderId : "NA"} ` +
      `client_order_id=${clientOrderId || "NA"} tracked=${trackedClientOrder ? "1" : "0"} ${detail}`
    );
    return buildExitEventByKind("UNKNOWN", rules);
  }
  if (intentEvent) {
    if (isSyntheticExternalFillExitEvent(intentEvent)) {
      const sym = normalizeSymbol(trade && trade.symbol);
      console.warn(
        `[FILL_SYNC_EVENT_OVERRIDE] ${sym || "UNKNOWN"} order_id=${Number.isFinite(orderId) ? orderId : "NA"} ` +
        `intent_event=${intentEvent} -> EXIT_EXTERNAL_SYNC (synthetic intent event)`
      );
      return "EXIT_EXTERNAL_SYNC";
    }
    return intentEvent;
  }

  if (sameOrderAsRecentTp1 && isTpP1Event(recentTp1 && recentTp1.event)) {
    return buildExitEventByKind("TP1", rules);
  }

  if (orderType === "STOP_MARKET" || orderType === "STOP") {
    return buildExitEventByKind("SL", rules);
  }
  if (orderType === "TAKE_PROFIT_MARKET" || orderType === "TAKE_PROFIT") {
    if (positionCtx && positionCtx.trailActive) return buildExitEventByKind("TRAIL", rules);
    return buildExitEventByKind("TP1", rules);
  }

  const realized = Number(trade && trade.realizedPnl);
  if (!Number.isFinite(realized)) return buildExitEventByKind("UNKNOWN", rules);
  if (realized < 0) return buildExitEventByKind("SL", rules);
  if (positionCtx && positionCtx.trailActive) return buildExitEventByKind("TRAIL", rules);
  return buildExitEventByKind("TP1", rules);
}

function inferPositionSideBefore({ trade, positionCtx } = {}) {
  const ctxSide = String(positionCtx && positionCtx.positionSide || "").toUpperCase();
  if (ctxSide === "LONG" || ctxSide === "SHORT") return ctxSide;
  const tradeSide = String(trade && trade.side || "").toUpperCase();
  if (tradeSide === "BUY") return "SHORT";
  if (tradeSide === "SELL") return "LONG";
  return null;
}

function resolvePositionSideForTrade(trade, fallback = null) {
  const explicit = String(trade && trade.positionSide || "").toUpperCase();
  if (explicit === "LONG" || explicit === "SHORT") return explicit;
  const side = String(trade && trade.side || "").toUpperCase();
  if (side === "BUY") return "LONG";
  if (side === "SELL") return "SHORT";
  return fallback;
}

async function syncMarketTrades({
  apiKey,
  apiSecret,
  symbol,
  execTf,
  lookbackMs,
  matchWindowMs,
  intents,
  maxPages = 5,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const sym = normalizeSymbol(symbol);
  if (!sym) return { ok: false, reason: "SYMBOL_INVALID" };

  const cursorId = cursorDocId(sym);
  const cursorRef = db.collection("processed_cursors").doc(cursorId);
  const cursorSnap = await cursorRef.get();
  const cursor = cursorSnap.exists ? cursorSnap.data() : null;
  const lastMsRaw = Number(cursor && cursor.last_trade_time_ms);
  const lastId = Number(cursor && cursor.last_trade_id);
  const lookbackStart = now - (lookbackMs || DEFAULT_LOOKBACK_MS);
  const hasCursorMs = Number.isFinite(lastMsRaw) && lastMsRaw > 0;
  const startMs = hasCursorMs ? Math.max(lastMsRaw, lookbackStart) : lookbackStart;
  const endMs = now;

  let fetched = 0;
  let inserted = 0;
  let lastTradeMs = hasCursorMs ? lastMsRaw : null;
  let lastTradeId = Number.isFinite(lastId) ? lastId : null;
  let pageStartMs = startMs;
  const positionEntryCache = new Map();
  const orderMetaCache = new Map();
  const recentTp1BySymbol = new Map();
  const pendingAlertBatches = new Map();
  const defaultExitRules = getExitRulesForExchange("BINANCEFUT");
  const alertEnabled = resolveEnvBool(process.env.BINANCEFUT_FILLS_SYNC_ALERT_ENABLED, true);
  const intentFutureAllowMs = Number(process.env.BINANCEFUT_FILLS_SYNC_INTENT_FUTURE_ALLOW_MS) || DEFAULT_INTENT_FUTURE_ALLOW_MS;
  const alertMaxAgeMsRaw = Number(process.env.BINANCEFUT_FILLS_SYNC_ALERT_MAX_AGE_MS);
  const alertMaxAgeMs = Number.isFinite(alertMaxAgeMsRaw) && alertMaxAgeMsRaw > 0
    ? Math.floor(alertMaxAgeMsRaw)
    : DEFAULT_ALERT_MAX_AGE_MS;

  for (let page = 0; page < maxPages; page += 1) {
    const windowEndMs = Math.min(endMs, pageStartMs + BINANCE_MAX_WINDOW_MS);
    const trades = await fetchFuturesUserTrades({
      apiKey,
      apiSecret,
      symbol: sym,
      startTime: pageStartMs,
      endTime: windowEndMs,
      limit: 1000,
    });
    const list = Array.isArray(trades) ? trades : [];
    if (!list.length) break;

    list.sort((a, b) => Number(a.time) - Number(b.time));
    fetched += list.length;

    for (const t of list) {
      const tradeId = Number(t.id || t.tradeId);
      const tradeMs = Number(t.time);
      if (Number.isFinite(lastTradeMs)) {
        if (tradeMs < lastTradeMs) continue;
        if (tradeMs === lastTradeMs && Number.isFinite(lastTradeId) && Number.isFinite(tradeId) && tradeId <= lastTradeId) {
          continue;
        }
      }

      const intent = pickIntentForTrade(t, intents, matchWindowMs || DEFAULT_MATCH_WINDOW_MS, intentFutureAllowMs);
      const positionCtx = await loadPositionEntryContext("BINANCEFUT", sym, positionEntryCache);
      const exitRules = (positionCtx && positionCtx.exitRulesOverride)
        ? resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: { meta: { exit_rules_override: positionCtx.exitRulesOverride } } })
        : defaultExitRules;
      const recentTp1 = recentTp1BySymbol.get(sym) || null;
      const orderMeta = await resolveExternalOrderMeta({
        trade: t,
        apiKey,
        apiSecret,
        symbol: sym,
        orderMetaCache,
      });
      const event = await resolveExternalExitEvent({
        intent,
        trade: t,
        orderMeta,
        positionCtx,
        recentTp1,
        rules: exitRules,
      });
      const intentId = intent ? intent.intent_id : null;
      const signalId = intent ? (intent.signal_id || (intent.features_json && intent.features_json.signal_id)) : null;
      const signalDocId = intent ? (intent.signal_doc_id || (intent.features_json && intent.features_json.signal_doc_id)) : null;
      const execPrice = Number(t.price);
      const execQtyBase = Number(t.qty);
      const notional = Number(t.quoteQty) || (Number.isFinite(execPrice) && Number.isFinite(execQtyBase) ? execPrice * execQtyBase : null);
      const qtyScale = computeSyncedQtyPct({
        intent,
        tradeNotional: notional,
        execQtyBase,
      });
      const qtyPct = qtyScale.qtyPct;
      const qtyFraction = intent ? intent.qty_fraction : null;
      const intentEntryCtx = extractEntryContextFromIntent(intent);
      const intentLeverage = intent
        ? Number(
          intent.leverage_applied ??
          intent.applied_leverage ??
          (intent.features_json && (intent.features_json.leverage_applied ?? intent.features_json.applied_leverage))
        )
        : null;
      const intentLeverageReason = intent
        ? String(intent.leverage_reason || (intent.features_json && intent.features_json.leverage_reason) || "").trim()
        : "";
      const feeValue = (t.commission == null ? null : Number(t.commission));
      const realizedPnl = (t.realizedPnl == null ? null : Number(t.realizedPnl));
      const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim() || null;
      const trackedClientOrder = !!(clientOrderId && /^(fut_|dbj_)/.test(clientOrderId));
      const untrackedClosePosition = orderMeta && orderMeta.closePosition === true && !trackedClientOrder;
      const recentTp1LagSec = recentTp1 && Number.isFinite(recentTp1.tradeMs) && Number.isFinite(tradeMs)
        ? Math.max(0, (tradeMs - recentTp1.tradeMs) / 1000)
        : null;

      if (untrackedClosePosition && String(orderMeta && orderMeta.orderType || "").toUpperCase() === "MARKET") {
        await sendExternalCloseAlert({
          symbol: sym,
          tradeMs,
          orderMeta,
          recentTp1,
        });
      }

      const fillId = `EXT__BINANCEFUT__${sym}__${Number.isFinite(tradeId) ? tradeId : String(t.id || t.time || now)}`;
      const execTimeIso = Number.isFinite(tradeMs) ? new Date(tradeMs).toISOString() : nowIso();
      const linkedTradeId = Number.isFinite(tradeMs)
        ? buildTradeId({
          exchange: "BINANCEFUT",
          symbol: sym,
          event,
          execBarCloseMs: tradeMs,
          execMs: tradeMs,
        })
        : null;
      const looksLikeExit = Number.isFinite(realizedPnl) && Math.abs(realizedPnl) > 1e-12;
      let inferredEntryCtx = { entryEventId: null, entrySignalType: null };
      if (looksLikeExit && !intentEntryCtx.entryEventId) {
        inferredEntryCtx = await loadPositionEntryContext("BINANCEFUT", sym, positionEntryCache);
      }
      const entryEventId = intentEntryCtx.entryEventId || inferredEntryCtx.entryEventId || null;
      const entrySignalType = intentEntryCtx.entrySignalType || inferredEntryCtx.entrySignalType || null;
      const positionSideBefore = inferPositionSideBefore({ trade: t, positionCtx });
      const closeRatio = looksLikeExit
        ? resolveFillSyncAlertCloseRatio({ event, intent, qtyScale, execQtyBase, positionCtx })
        : null;
      const fullExit = looksLikeExit
        ? resolveFillSyncAlertFullExit({
          event,
          orderMeta,
          closeRatio,
        })
        : false;

      const upserted = await upsertExternalFill({
        fillId,
        intentId,
        tradeId: linkedTradeId,
        exchange: "BINANCEFUT",
        symbol: sym,
        tf: execTf,
        execBarCloseTimeUtc: execTimeIso,
        execBarCloseTimeUtcMs: Number.isFinite(tradeMs) ? tradeMs : null,
        side: String(t.side || "").toUpperCase(),
        event,
        qtyPct,
        execPrice,
        feeBps: 0,
        slippageBps: 0,
        feeValue,
        notional,
        notionalKrw: notional,
        qtyFraction,
        execPriceSource: "BINANCE_USER_TRADES",
        executionMode: "LIVE",
        liveOrderId: t.orderId ? String(t.orderId) : null,
        execQtyBase,
        entryEventId,
        entrySignalType,
        signalId,
        signalDocId,
        leverageApplied: Number.isFinite(intentLeverage) && intentLeverage > 0 ? intentLeverage : null,
        leverageReason: intentLeverageReason || null,
        createdAt: execTimeIso,
        extra: {
          external: true,
          external_source: "BINANCE_USER_TRADES",
          external_trade_id: Number.isFinite(tradeId) ? tradeId : null,
          external_order_id: Number.isFinite(orderMeta.orderId) ? orderMeta.orderId : null,
          external_order_type: orderMeta.orderType || null,
          external_client_order_id: orderMeta.clientOrderId || null,
          external_order_status: orderMeta.status || null,
          external_order_close_position: orderMeta.closePosition === true,
          external_order_reduce_only: orderMeta.reduceOnly === true,
          external_after_tp1_sec: Number.isFinite(recentTp1LagSec) ? recentTp1LagSec : null,
          external_position_side: t.positionSide || null,
          external_realized_pnl: realizedPnl,
          qty_pct_mode: qtyScale.mode,
          qty_pct_ratio: Number.isFinite(qtyScale.ratio) ? qtyScale.ratio : null,
          qty_pct_intent_raw: Number.isFinite(qtyScale.intentQtyPct) ? qtyScale.intentQtyPct : null,
          qty_pct_intent_notional: Number.isFinite(qtyScale.intentNotional) ? qtyScale.intentNotional : null,
          qty_pct_intent_qty_base: Number.isFinite(qtyScale.intentQtyBase) ? qtyScale.intentQtyBase : null,
        },
      });

      if (isTpP1Event(event)) {
        try {
          await markTpP1DoneFromExternalFill({
            exchange: "BINANCEFUT",
            symbol: sym,
            execPrice,
            execTimeIso,
            entryEventId,
          });
        } catch (_) {}
        recentTp1BySymbol.set(sym, {
          tradeMs,
          event,
          orderId: Number.isFinite(Number(orderMeta && orderMeta.orderId)) ? Number(orderMeta.orderId) : null,
          clientOrderId,
          execPrice: Number.isFinite(execPrice) ? execPrice : null,
        });
        const cacheKey = `BINANCEFUT__${sym}`;
        if (positionEntryCache.has(cacheKey)) {
          const cachedCtx = positionEntryCache.get(cacheKey) || {};
          positionEntryCache.set(cacheKey, {
            ...cachedCtx,
            tpP1Done: true,
            trailActive: true,
          });
        }
      }

      if (intentId) {
        try {
          await recoverIntentFromExternalFill({
            intent,
            intentId,
            execTimeIso,
            execPrice,
            execQtyBase,
            notional,
            tradeId,
          });
        } catch (e) {
          console.warn("[INTENT_RECOVER_FAIL][FILL_SYNC]", e && e.message ? e.message : String(e));
        }
      }

      if (looksLikeExit && fullExit) {
        try {
          await markSameDirectionTrailProfitCooldownFromExternalFill({
            exchange: "BINANCEFUT",
            symbol: sym,
            event,
            realizedPnl,
            execTimeIso,
            positionSideBefore,
          });
        } catch (e) {
          console.warn("[SAME_DIRECTION_TRAIL_COOLDOWN_SYNC_FAIL]", e && e.message ? e.message : String(e));
        }
      }

      if (upserted && upserted.inserted) inserted += 1;
      if (upserted && upserted.inserted && alertEnabled) {
        const isExitEvent = event.startsWith("EXIT_");
        const isEntryLikeEvent = !isExitEvent && event !== "SYNC_FILL";
        const allowExitAlert = isExitEvent && isMeaningfulRealizedPnl(realizedPnl);
        const allowEntryAlert = isEntryLikeEvent;
        if (allowExitAlert || allowEntryAlert) {
          const eventAgeMs = Number.isFinite(tradeMs) ? (Date.now() - tradeMs) : null;
          if (!Number.isFinite(eventAgeMs) || eventAgeMs <= alertMaxAgeMs) {
            const side = String(t.side || "").toUpperCase();
            const intentHintRaw = String(
              (intent && (intent.event_intent || (intent.features_json && intent.features_json._event_intent))) || ""
            ).toUpperCase();
            const resolvedIntent = isExitEvent
              ? "EXIT"
              : (intentHintRaw === "ADD" || intentHintRaw === "ENTRY" ? intentHintRaw : "ENTRY");
            queueFillSyncAlertBatch(pendingAlertBatches, {
              symbol: sym,
              event,
              intent: resolvedIntent,
              side,
              orderMeta,
              tradeMs,
              payload: {
              exchange: "BINANCEFUT",
              symbol: sym,
              event,
              side,
              intent: resolvedIntent,
              executionMode: "LIVE",
              notional,
              execPrice,
              closeRatio,
              fullExit,
              realizedPnl: isExitEvent ? realizedPnl : null,
              positionSideBefore,
              positionSideAfter: isExitEvent ? null : resolvePositionSideForTrade(t, positionSideBefore),
              appliedLeverage: Number.isFinite(intentLeverage)
                ? intentLeverage
                : (positionCtx && Number.isFinite(positionCtx.leverage) ? positionCtx.leverage : null),
              leverageReason: intentLeverageReason || "BINANCE_USER_TRADES_SYNC",
              exitRules,
              features: (intent && intent.features_json && typeof intent.features_json === "object") ? intent.features_json : {},
              runId: `FILL_SYNC__${sym}`,
              },
            });
          }
        }
      }

      if (!Number.isFinite(lastTradeMs) || tradeMs > lastTradeMs) {
        lastTradeMs = tradeMs;
        lastTradeId = Number.isFinite(tradeId) ? tradeId : lastTradeId;
      } else if (tradeMs === lastTradeMs && Number.isFinite(tradeId)) {
      if (!Number.isFinite(lastTradeId) || tradeId > lastTradeId) lastTradeId = tradeId;
      }
    }

    const lastInPage = list[list.length - 1];
    const lastMsInPage = Number(lastInPage && lastInPage.time);
    if (!Number.isFinite(lastMsInPage) || lastMsInPage <= pageStartMs) break;
    pageStartMs = lastMsInPage + 1;
    if (list.length < 1000) break;
  }

  await flushFillSyncAlertBatches(pendingAlertBatches);

  if (Number.isFinite(lastTradeMs)) {
    await cursorRef.set({
      cursor_id: cursorId,
      exchange: "BINANCEFUT",
      symbol: sym,
      tf: "FILL_SYNC",
      last_trade_time_ms: lastTradeMs,
      last_trade_time_utc: new Date(lastTradeMs).toISOString(),
      last_trade_id: Number.isFinite(lastTradeId) ? lastTradeId : null,
      updated_at: nowIso(),
    }, { merge: true });
  }

  return { ok: true, symbol: sym, fetched, inserted };
}

async function syncBinanceFuturesFills({
  markets,
  execTf,
  executionMode,
  liveEnabled,
  lookbackMs,
  minIntervalMs,
  force = false,
} = {}) {
  const enabled = resolveEnvBool(process.env.BINANCEFUT_FILLS_SYNC_ENABLED, true);
  if (!enabled) return { ok: false, skipped: true, reason: "SYNC_DISABLED" };
  if (!force) {
    const interval = Number.isFinite(Number(minIntervalMs))
      ? Number(minIntervalMs)
      : Number(process.env.BINANCEFUT_FILLS_SYNC_INTERVAL_MS) || DEFAULT_MIN_INTERVAL_MS;
    if (syncState.lastRunAt && (Date.now() - syncState.lastRunAt) < interval) {
      return { ok: false, skipped: true, reason: "TOO_FREQUENT" };
    }
  }

  if (String(executionMode || "").toUpperCase() === "LIVE" && liveEnabled === false) {
    return { ok: false, skipped: true, reason: "LIVE_DISABLED" };
  }

  const keys = await resolveBinanceKeys();
  if (!keys) return { ok: false, skipped: true, reason: "KEYS_MISSING" };

  const ex = keys.ex || {};
  const tf = normalizeTf(execTf || ex.exec_tf || defaultExecTfFromEnv()) || "15m";
  const list = Array.isArray(markets) && markets.length
    ? markets.map((m) => normalizeSymbol(m)).filter(Boolean)
    : (Array.isArray(ex.markets) ? ex.markets.map((m) => normalizeSymbol(m)).filter(Boolean) : []);

  if (!list.length) return { ok: false, skipped: true, reason: "NO_MARKETS" };

  const intents = await loadRecentIntents(1000);
  const matchWindowMs = Number(process.env.BINANCEFUT_FILLS_SYNC_MATCH_MS) || DEFAULT_MATCH_WINDOW_MS;
  const lookback = Number.isFinite(Number(lookbackMs))
    ? Number(lookbackMs)
    : Number(process.env.BINANCEFUT_FILLS_SYNC_LOOKBACK_MS) || DEFAULT_LOOKBACK_MS;
  const maxPagesEnv = Math.floor(Number(process.env.BINANCEFUT_FILLS_SYNC_MAX_PAGES) || 0);
  const maxPagesByLookback = Math.max(5, Math.ceil(lookback / BINANCE_MAX_WINDOW_MS) + 2);
  const maxPages = maxPagesEnv > 0 ? Math.max(maxPagesEnv, maxPagesByLookback) : maxPagesByLookback;

  const results = [];
  for (const sym of list) {
    try {
      const r = await syncMarketTrades({
        apiKey: keys.apiKey,
        apiSecret: keys.apiSecret,
        symbol: sym,
        execTf: tf,
        lookbackMs: lookback,
        matchWindowMs,
        intents,
        maxPages,
      });
      results.push(r);
    } catch (e) {
      results.push({ ok: false, symbol: sym, error: e && e.message ? e.message : String(e) });
    }
  }

  let intentRecovery = { ok: false, skipped: true, reason: "DISABLED" };
  const recoveryEnabled = resolveEnvBool(process.env.BINANCEFUT_FILLS_SYNC_INTENT_RECOVERY_ENABLED, true);
  if (recoveryEnabled) {
    try {
      intentRecovery = await reconcileCanceledIntentsFromRecentFills({
        lookbackMs: Number(process.env.BINANCEFUT_FILLS_SYNC_INTENT_RECOVERY_LOOKBACK_MS) || DEFAULT_INTENT_RECOVERY_LOOKBACK_MS,
        scanLimit: Number(process.env.BINANCEFUT_FILLS_SYNC_INTENT_RECOVERY_SCAN_LIMIT) || DEFAULT_INTENT_RECOVERY_SCAN_LIMIT,
      });
    } catch (e) {
      intentRecovery = { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  syncState.lastRunAt = Date.now();
  return { ok: true, tf, markets: list.length, results, intent_recovery: intentRecovery };
}

module.exports = {
  syncBinanceFuturesFills,
  __test: {
    computeSyncedQtyPct,
    resolveIntentNotional,
    resolveIntentQtyBase,
    resolveFillSyncAlertCloseRatio,
    resolveFillSyncAlertFullExit,
    queueFillSyncAlertBatch,
    pickIntentForTrade,
    resolveExternalExitEvent,
    isSameOrderAsRecentTp1,
    isSyntheticExternalFillExitEvent,
  },
};
