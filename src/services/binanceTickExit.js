"use strict";

const env = require("../config/env");
const os = require("os");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { tfToMs } = require("../utils/marketConfig");
const { getFirestore } = require("../storage/firestore");
const { getSystemSettingsForProvider } = require("../storage/settings");
const {
  getPositionRuntimeObservation,
  upsertTrailObservation,
  resolveTrailObservationSnapshot,
} = require("../storage/positionRuntimeObservations");
const { getPosition } = require("../storage/positions");
const { clearTpP1PendingIfUnchanged } = require("../storage/positionsPaper");
const { upsertIntent } = require("../storage/orderIntentsPaper");
const { upsertExitOrderContract } = require("../storage/exitOrderContracts");
const { resolveExitRulesForPosition, computeRunnerExitStopPrice, resolveTrailDelayState, resolveTpP0Pct } = require("../engine/signalEngine");
const {
  runPaperMarket,
  resolveLiveFuturesConfig,
  refreshBinanceNativeProtectionWithRetry,
  syncFuturesPositionOnly,
} = require("../engine/paperBinanceRunner");
const { resolveCloseSide, resolvePositionSideFromPosition } = require("../utils/positionSide");
const {
  getFuturesBaseUrl,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
  fetchFuturesOrder,
  fetchFuturesAlgoOrder,
  placeFuturesMarketOrder,
  __test: binancePrivateTest,
} = require("../exchanges/binanceFuturesPrivate");
const { sendAlert } = require("../utils/alerts");
const { runActionPreHooks, runActionPostHooks, emitActionEvent } = require("../utils/actionExecutionHooks");
const { auditBinanceExitIntegrity } = require("./exitIntegrityAudit");
const { runBinanceLiveStateSelfHeal } = require("./binanceLiveStateSelfHeal");
const { getPositionReadView, listExchangePositionReadViews } = require("./positionReadModel");
const { resolveCanonicalPositionExitStage } = require("./positionStateMachine");
const { loadOperationalGuardRuntime } = require("./operationalGuardRuntime");
const { loadSystemSloRuntime } = require("./systemSloRuntime");
const { loadSystemAnomalyRuntime } = require("./systemAnomalyRuntime");
const {
  loadTrailAuthorityRuntime,
  publishTrailAuthorityState,
  recordTrailRuntimeEvent,
} = require("./trailAuthorityRuntime");

function nowMs() {
  return Date.now();
}

function normalizeIntervalMs(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1000, Math.round(n));
}

function alignCurrentBarCloseLocal(ms, tfMs) {
  const now = Number(ms);
  const size = Number(tfMs);
  if (!Number.isFinite(now) || !Number.isFinite(size) || size <= 0) return null;
  return Math.floor(now / size) * size;
}

function ratioToPctTokenLocal(ratio) {
  const n = Math.abs(Number(ratio));
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round(n * 10000) / 100;
  return String(pct).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function resolveCanonicalExitStageForPosition(position) {
  const pos = position && typeof position === "object" ? position : null;
  const meta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const canonical = resolveCanonicalPositionExitStage({
    positionSnapshot: pos,
    fallbackStage: meta.authoritative_exit_stage || meta.canonical_exit_stage || null,
  });
  return canonical && canonical.stage ? canonical.stage : null;
}

function hasCanonicalTpP1Reached(stage) {
  const normalized = String(stage || "").trim().toUpperCase();
  return normalized === "TP1" || normalized === "TRAIL";
}

function isCanonicalTrailStage(stage) {
  return String(stage || "").trim().toUpperCase() === "TRAIL";
}

function shouldTriggerTrailHardExit({
  position,
  price,
  side,
  rules,
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  const meta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const canonicalStage = resolveCanonicalExitStageForPosition(pos);
  const tpP1Done = hasCanonicalTpP1Reached(canonicalStage);
  const tpP1Pending = meta.tp_p1_pending === true;
  const trailActive = isCanonicalTrailStage(canonicalStage) || tpP1Pending;
  if ((!tpP1Done && !tpP1Pending) || !trailActive) {
    return { trigger: false, reason: "NOT_TRAIL_STAGE" };
  }
  const avg = Number(pos && pos.avg_price);
  const leverageEff = Number(meta.external_leverage || meta.leverage || pos.leverage || 1);
  const runnerExit = computeRunnerExitStopPrice({
      avg,
      leverageEff,
      side,
      rules,
      tpP1Done,
      trailActive: isCanonicalTrailStage(canonicalStage),
      trailHigh: Number(meta.trail_high),
      trailLow: Number(meta.trail_low),
      entryRDistance: Number(meta.entry_r_distance),
    });
  const stopPrice = Number(runnerExit && runnerExit.stopPrice);
  if (!Number.isFinite(price) || !Number.isFinite(stopPrice) || stopPrice <= 0) {
    return { trigger: false, reason: "STOP_UNAVAILABLE", runnerExit };
  }
  const sideUpper = String(side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const crossed = sideUpper === "SHORT" ? (price >= stopPrice) : (price <= stopPrice);
  return {
    trigger: crossed,
    reason: crossed ? "TRAIL_STOP_BREACHED" : "SAFE",
    stopPrice,
    runnerExit,
  };
}

async function runTrailHardExit({
  exchange = "BINANCEFUT",
  symbol,
  position,
  price,
  signalTf,
  execTf,
  hardExit,
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  const meta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const qtyBase = Number(pos && pos.qty_base);
  if (!pos || !Number.isFinite(qtyBase) || qtyBase <= 0) {
    return { ok: false, skipped: true, reason: "NO_ACTIVE_POSITION" };
  }
  const liveCfg = await resolveLiveFuturesConfig({ exchange, symbol });
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) {
    return { ok: false, skipped: true, reason: "BINANCEFUT_KEYS_MISSING" };
  }
  const side = resolveCloseSide(resolvePositionSideFromPosition(pos, meta, "LONG"));
  const tfMs = Math.max(60 * 1000, Number(tfToMs(signalTf) || 15 * 60 * 1000));
  const now = Date.now();
  const signalBarCloseMs = alignCurrentBarCloseLocal(now, tfMs) || now;
  const execBarCloseMs = signalBarCloseMs;
  const event = "FORCE_EXIT_ALL";
  const runId = `RUN__TICK_EXIT_HARD_EXIT__${exchange}__${symbol}__${now}`;
  const requestId = `tick_exit_hard_exit_${symbol}_${now}`;
  const pre = await runActionPreHooks({
    action: "TRAIL_HARD_EXIT",
    runId,
    exchange,
    symbol,
    tf: signalTf,
    signalEvent: event,
    decisionReason: "TRAIL_STOP_BREACHED",
    source: "BINANCE_TICK_EXIT",
    executionMode: "LIVE",
    intent: "EXIT",
    qtyPct: 1,
    persist: true,
  });
  const intent = await upsertIntent({
    exchange,
    symbol,
    tf: signalTf,
    signalBarCloseTimeUtc: new Date(signalBarCloseMs).toISOString(),
    signalBarCloseTimeUtcMs: signalBarCloseMs,
    scheduledExecBarCloseUtc: new Date(execBarCloseMs).toISOString(),
    scheduledExecBarCloseUtcMs: execBarCloseMs,
    event,
    side,
    qtyPct: 1,
    qtyFraction: 1,
    reason: "TRAIL_STOP_BREACHED",
    pendingReason: "TRAIL_STOP_BREACHED",
    pendingNote: `stop=${Number(hardExit && hardExit.stopPrice).toFixed(6)} price=${Number(price).toFixed(6)}`,
    executionMode: "LIVE",
    features: {
      _tick_exit_hard_exit: true,
      _trail_stop_price: Number.isFinite(Number(hardExit && hardExit.stopPrice)) ? Number(hardExit.stopPrice) : null,
      _trail_stop_source: hardExit && hardExit.runnerExit ? hardExit.runnerExit.stopSource || null : null,
      _observed_price: Number.isFinite(Number(price)) ? Number(price) : null,
      position_side: resolvePositionSideFromPosition(pos, meta, "LONG"),
    },
    runId,
    execTf: execTf || signalTf,
    requestId,
    decisionReason: "TRAIL_STOP_BREACHED",
  });
  const order = await placeFuturesMarketOrder({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    symbol,
    side,
    quantity: qtyBase,
    reduceOnly: true,
    idempotencyKey: `${runId}__FORCE_EXIT_ALL`,
  });
  await upsertExitOrderContract({
    exchange,
    symbol,
    orderId: order && order.orderId,
    clientOrderId: order && order.clientOrderId,
    event,
    stage: "FORCE_EXIT_ALL",
    intentId: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null,
    signalId: intent && intent.signal_id ? intent.signal_id : null,
    signalDocId: intent && intent.signal_doc_id ? intent.signal_doc_id : null,
    positionSide: resolvePositionSideFromPosition(pos, meta, "LONG"),
    closeSide: side,
    expectedQtyBase: qtyBase,
    expectedQtyRatio: 1,
    triggerPrice: Number.isFinite(Number(hardExit && hardExit.stopPrice)) ? Number(hardExit.stopPrice) : null,
    triggerSource: hardExit && hardExit.runnerExit ? hardExit.runnerExit.stopSource || null : null,
    reduceOnly: true,
    closePosition: false,
    status: "OPEN",
    source: "TICK_EXIT_HARD_EXIT",
  }).catch(() => null);
  runActionPostHooks({
    envelope: { ...((pre && pre.envelope) || {}), intent_id: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null },
    ok: true,
    reason: "TRAIL_HARD_EXIT_ORDER_PLACED",
    persist: true,
    result: {
      order_id: order && order.orderId ? String(order.orderId) : null,
      qty_base: qtyBase,
      stop_price: Number.isFinite(Number(hardExit && hardExit.stopPrice)) ? Number(hardExit.stopPrice) : null,
      observed_price: Number.isFinite(Number(price)) ? Number(price) : null,
    },
  });
  return {
    ok: true,
    intentId: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null,
    orderId: order && order.orderId ? String(order.orderId) : null,
  };
}

const symbolCooldownState = new Map();
const symbolCooldownLogState = new Map();
const pendingIntentState = new Map();
const pendingIntentLogState = new Map();
const PENDING_INTENT_CHECK_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_PENDING_INTENT_TTL_MS, 3000);
const pendingIntentScopeScanLimitRaw = Number(process.env.TICK_EXIT_PENDING_INTENT_SCOPE_SCAN_LIMIT);
const PENDING_INTENT_SCOPE_SCAN_LIMIT = Number.isFinite(pendingIntentScopeScanLimitRaw)
  ? Math.max(50, Math.round(pendingIntentScopeScanLimitRaw))
  : 300;
const TICK_EXIT_LEASE_ENABLED = String(process.env.TICK_EXIT_LEASE_ENABLED || "1") !== "0";
const TICK_EXIT_LEASE_DOC = String(process.env.TICK_EXIT_LEASE_DOC || "runtime_locks/binance_tick_exit_loop");
const TICK_EXIT_LEASE_MIN_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_LEASE_MIN_TTL_MS, 30000);
const TICK_EXIT_LEASE_LOG_COOLDOWN_MS = 60 * 1000;
const TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS, 300000);
const tickExitInstanceId = [
  String(process.env.K_REVISION || process.env.HOSTNAME || os.hostname() || "local"),
  String(process.pid || "0"),
].join("__");
let leaseSkippedLogAt = 0;
const tickExitFailureAlertState = new Map();
const nativeProtectionStateCache = new Map();
const trailHardExitCooldownState = new Map();
const TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS, 10000);
const TICK_EXIT_HARD_EXIT_COOLDOWN_MS = normalizeIntervalMs(process.env.TICK_EXIT_HARD_EXIT_COOLDOWN_MS, 60000);

function resolveTfFromMsLocal(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const map = new Map([
    [60 * 1000, "1m"],
    [3 * 60 * 1000, "3m"],
    [5 * 60 * 1000, "5m"],
    [15 * 60 * 1000, "15m"],
    [30 * 60 * 1000, "30m"],
    [60 * 60 * 1000, "60m"],
    [4 * 60 * 60 * 1000, "4h"],
    [24 * 60 * 60 * 1000, "1d"],
  ]);
  return map.get(Math.round(n)) || null;
}

function resolvePositionSignalTf({ pos, exCfg } = {}) {
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const fromMetaText = String(meta.entry_exec_tf || meta.signal_tf || "").trim();
  if (fromMetaText) return fromMetaText;
  const fromMetaMs = resolveTfFromMsLocal(meta.entry_exec_tf_ms);
  if (fromMetaMs) return fromMetaMs;
  if (Array.isArray(exCfg && exCfg.tf_allowlist) && exCfg.tf_allowlist.length) {
    return String(exCfg.tf_allowlist[0]);
  }
  return "60m";
}

function shouldBypassNativeProtectionCache({ cached, refreshAtMs, now } = {}) {
  if (!cached) return true;
  if (!Number.isFinite(cached.expiresAt) || cached.expiresAt <= now) return true;
  if (Number.isFinite(Number(refreshAtMs)) && Number.isFinite(Number(cached.checkedAt)) && Number(refreshAtMs) > Number(cached.checkedAt)) {
    return true;
  }
  return false;
}

function clearNativeProtectionStateCache(symbol) {
  const key = String(symbol || "").toUpperCase();
  if (!key) return;
  nativeProtectionStateCache.delete(key);
}

function structuredLog(event, payload = {}, level = "log") {
  const record = { event, ts: new Date().toISOString(), ...payload };
  const fn = level === "warn" ? "warn" : "log";
  try {
    console[fn](JSON.stringify(record));
  } catch (_) {
    console[fn](`[${event}] ${JSON.stringify(payload)}`);
  }
}

function structuredLogWriter(event, payload = {}, level = "log") {
  structuredLog(event, payload, level);
}

function applyTrailObservationToPosition({ pos, observation } = {}) {
  const position = (pos && typeof pos === "object") ? pos : null;
  if (!position) return position;
  const meta = (position.meta && typeof position.meta === "object") ? position.meta : {};
  const snapshot = resolveTrailObservationSnapshot({ meta, observation });
  return {
    ...position,
    meta: {
      ...meta,
      trail_high: snapshot.trail_high,
      trail_high_at_ms: snapshot.trail_high_at_ms,
      trail_low: snapshot.trail_low,
      trail_low_at_ms: snapshot.trail_low_at_ms,
      ...(snapshot.native_stop_price != null || meta.native_protection_stop_price != null
        ? { native_protection_stop_price: snapshot.native_stop_price ?? meta.native_protection_stop_price }
        : {}),
      ...((snapshot.native_stop_order_id || meta.native_protection_stop_order_id)
        ? { native_protection_stop_order_id: snapshot.native_stop_order_id ?? meta.native_protection_stop_order_id }
        : {}),
      ...((snapshot.native_refresh_status || meta.native_protection_refresh_status)
        ? { native_protection_refresh_status: snapshot.native_refresh_status ?? meta.native_protection_refresh_status }
        : {}),
    },
  };
}

function buildTickTrailObservationDocUpdate(trailPatch, updatedAt = null) {
  const patch = (trailPatch && typeof trailPatch === "object") ? { ...trailPatch } : {};
  return {
    ...patch,
    updated_at: updatedAt || new Date().toISOString(),
  };
}

function buildTickTrailReconcileRunId(symbol, atMs = Date.now()) {
  return `RUN__TRAIL_RECONCILE__BINANCEFUT__${String(symbol || "").toUpperCase()}__${Number(atMs)}`;
}

async function resolveTickExitAlertChannel(exchange = "BINANCEFUT") {
  const sys = await getSystemSettingsForProvider(exchange, 5000);
  return String(sys && sys.data && sys.data.alert_channel || "").trim();
}

function shouldSendTickExitFailureAlert({ symbol, reason } = {}) {
  const key = `${String(symbol || "ALL").toUpperCase()}:${String(reason || "UNKNOWN").toUpperCase()}`;
  const now = nowMs();
  const last = Number(tickExitFailureAlertState.get(key));
  if (Number.isFinite(last) && (now - last) < TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS) return false;
  tickExitFailureAlertState.set(key, now);
  return true;
}

async function sendTickExitFailureAlert({
  symbol,
  error,
  phase = "RUN",
  position = null,
  price = null,
} = {}) {
  const reason = String(error || "UNKNOWN").trim() || "UNKNOWN";
  if (!shouldSendTickExitFailureAlert({ symbol, reason })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  try {
    const channel = await resolveTickExitAlertChannel("BINANCEFUT");
    if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
    const meta = (position && typeof position.meta === "object") ? position.meta : {};
    const lines = [
      `phase: ${String(phase || "RUN")}`,
      `error: ${reason.slice(0, 240)}`,
    ];
    if (symbol) lines.push(`symbol: ${String(symbol).toUpperCase()}`);
    if (position) {
      lines.push(`side: ${String(position.position_side || meta.position_side || "-").toUpperCase() || "-"}`);
      lines.push(`state: ${String(position.state || "-").toUpperCase()}`);
      lines.push(`tp1_done: ${meta.tp_p1_done === true ? "1" : "0"}`);
      lines.push(`trail_active: ${meta.trail_active === true ? "1" : "0"}`);
    }
    if (Number.isFinite(Number(price))) lines.push(`price: ${Number(price)}`);
    return sendAlert({
      channel,
      title: `${String(symbol || "BINANCEFUT").toUpperCase()} tick-exit 실패`,
      body: lines.join("\n"),
      severity: "WARN",
    });
  } catch (alertErr) {
    console.warn("[TICK_EXIT_ALERT_FAIL]", alertErr && alertErr.message ? alertErr.message : String(alertErr));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

function shouldRunBySymbolCooldown({ symbol, now, cooldownMs }) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return { ok: true, remainingMs: 0 };
  const cooldown = Number(cooldownMs);
  if (!Number.isFinite(cooldown) || cooldown <= 0) return { ok: true, remainingMs: 0 };

  const last = Number(symbolCooldownState.get(sym));
  if (Number.isFinite(last) && (now - last) < cooldown) {
    return { ok: false, remainingMs: Math.max(0, cooldown - (now - last)) };
  }
  symbolCooldownState.set(sym, now);
  if (symbolCooldownState.size > 1000) {
    for (const [k, v] of symbolCooldownState) {
      if (!Number.isFinite(v) || (now - v) > (cooldown * 4)) symbolCooldownState.delete(k);
    }
  }
  return { ok: true, remainingMs: 0 };
}

function intentScopeKey(exchange, symbol, tf) {
  return `${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${String(tf || "")}`;
}

async function hasPendingIntentsForScope({ exchange, symbol, tf, now } = {}) {
  const scope = intentScopeKey(exchange, symbol, tf);
  if (!scope) return false;
  const tsNow = Number.isFinite(now) ? now : Date.now();
  const cached = pendingIntentState.get(scope);
  if (cached && Number.isFinite(cached.checkedAt) && (tsNow - cached.checkedAt) < PENDING_INTENT_CHECK_TTL_MS) {
    return cached.hasPending === true;
  }

  let hasPending = false;
  const nowMsSafe = Date.now();
  const markHasPendingFromSnap = (snap) => {
    if (!snap || snap.empty) return false;
    let found = false;
    snap.forEach((d) => {
      if (found) return;
      const x = d.data() || {};
      if (String(x.status || "").toUpperCase() !== "PENDING") return;
      const expMs = Number(x.expires_at_ms);
      if (Number.isFinite(expMs) && expMs <= nowMsSafe) return;
      found = true;
    });
    return found;
  };

  try {
    const db = getFirestore();
    // Preferred path: scan only PENDING docs under this scope.
    try {
      const pendingSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .where("status", "==", "PENDING")
        .limit(40)
        .get();
      hasPending = markHasPendingFromSnap(pendingSnap);
    } catch (_) {
      hasPending = false;
    }
    // Fallback path: legacy/unknown index case -> scope-limited scan.
    if (!hasPending) {
      const scanSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .limit(PENDING_INTENT_SCOPE_SCAN_LIMIT)
        .get();
      hasPending = markHasPendingFromSnap(scanSnap);
    }
  } catch (_) {
    hasPending = false;
  }

  pendingIntentState.set(scope, { checkedAt: tsNow, hasPending });
  if (pendingIntentState.size > 2000) {
    for (const [k, v] of pendingIntentState) {
      if (!v || !Number.isFinite(v.checkedAt) || (tsNow - v.checkedAt) > (PENDING_INTENT_CHECK_TTL_MS * 10)) {
        pendingIntentState.delete(k);
      }
    }
  }
  return hasPending;
}

async function clearExpiredTpP1Pending({ pos, symbol, tf, now } = {}) {
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  if (meta.tp_p1_pending !== true) return false;

  const pendingAtMs = Number(meta.tp_p1_pending_at_ms);
  const pendingUntilMs = Number(meta.tp_p1_pending_until_ms);
  const refNow = Number.isFinite(now) ? now : Date.now();
  if (!Number.isFinite(pendingUntilMs) || refNow <= pendingUntilMs) return false;

  const hasPending = await hasPendingIntentsForScope({
    exchange: "BINANCEFUT",
    symbol,
    tf,
    now: refNow,
  });
  if (hasPending) return false;

  const clearedAt = new Date(refNow).toISOString();
  const cleared = await clearTpP1PendingIfUnchanged({
    exchange: "BINANCEFUT",
    symbol,
    pendingAtMs: Number.isFinite(pendingAtMs) ? pendingAtMs : null,
    pendingUntilMs,
    pendingEvent: meta.tp_p1_pending_event || null,
    clearedAt,
    clearedReason: "PENDING_EXPIRED_NO_ACTIVE_INTENT",
  });
  if (!cleared || cleared.cleared !== true) return false;

  pos.meta = {
    ...meta,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_pending_cleared_at: clearedAt,
    tp_p1_pending_cleared_reason: "PENDING_EXPIRED_NO_ACTIVE_INTENT",
  };
  return true;
}

async function fetchBinanceFuturesPrices(symbols) {
  const out = {};
  const list = Array.isArray(symbols) ? symbols.map((s) => String(s || "").toUpperCase()).filter(Boolean) : [];
  if (!list.length) return out;
  const baseUrl = getFuturesBaseUrl() || "https://fapi.binance.com";
  const url = `${baseUrl}/fapi/v1/ticker/price?symbols=` + encodeURIComponent(JSON.stringify(list));
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(`BINANCE_TICKER_FAIL_${res.status}`);
  const rows = JSON.parse(text);
  if (Array.isArray(rows)) {
    rows.forEach((r) => {
      const sym = String(r && r.symbol || "").toUpperCase();
      const px = Number(r && r.price);
      if (sym && Number.isFinite(px)) out[sym] = px;
    });
  }
  return out;
}

function resolveLeverageEff(pos, exchange) {
  const ex = String(exchange || "").toUpperCase();
  const meta = pos && pos.meta ? pos.meta : {};
  const levRaw = Number(meta.external_leverage ?? meta.leverage ?? meta.futures_leverage ?? pos.leverage);
  if (ex.includes("BINANCE") && Number.isFinite(levRaw) && levRaw > 0) return levRaw;
  return 1;
}

function pnlToPrice({ avg, pnlPct, side }) {
  if (!Number.isFinite(avg) || !Number.isFinite(pnlPct)) return null;
  const s = String(side || "").toUpperCase();
  if (s === "SHORT") return avg * (1 - pnlPct);
  return avg * (1 + pnlPct);
}

function computeBePct(rules, leverageEff, exchange) {
  if (!rules || rules.BE_ENABLE === false) return null;
  if (Number.isFinite(rules.BE_PCT)) return rules.BE_PCT;
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE") || !Number.isFinite(leverageEff) || leverageEff <= 0) return null;
  const feeBps = Number(process.env.FEE_BPS || 4);
  const slippageBps = Number(process.env.SLIPPAGE_BPS || 5);
  const roundTripBps = (Number.isFinite(feeBps) ? feeBps : 0) + (Number.isFinite(slippageBps) ? slippageBps : 0);
  return -((roundTripBps * 2) / 10000) * leverageEff;
}

function hasNativeStopProtection(meta) {
  const status = String(meta && meta.native_protection_refresh_status || "").toUpperCase();
  const stale = meta && meta.native_protection_stale === true;
  const stopPrice = Number(meta && meta.native_protection_stop_price);
  const stopOrderId = String(meta && meta.native_protection_stop_order_id || "").trim();
  return status === "OK" && stale !== true && ((Number.isFinite(stopPrice) && stopPrice > 0) || !!stopOrderId);
}

function hasNativeTpProtection(meta) {
  const status = String(meta && meta.native_protection_refresh_status || "").toUpperCase();
  const tpStatus = String(meta && meta.native_protection_tp_status || "").toUpperCase();
  const stale = meta && meta.native_protection_stale === true;
  const tpPrice = Number(meta && meta.native_protection_tp_price);
  const tpOrderId = String(meta && meta.native_protection_tp_order_id || "").trim();
  return status === "OK"
    && tpStatus === "OK"
    && stale !== true
    && ((Number.isFinite(tpPrice) && tpPrice > 0) || !!tpOrderId);
}

function isNativeStopLessProtectiveThanTrigger({ meta, triggerPrice, side } = {}) {
  const trg = Number(triggerPrice);
  if (!Number.isFinite(trg) || trg <= 0) return false;
  const stopPrice = Number(meta && meta.native_protection_stop_price);
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) return true;
  const sideUpper = String(side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const tolerance = Math.max(trg * 0.0001, 1e-8);
  if (sideUpper === "SHORT") {
    return stopPrice > (trg + tolerance);
  }
  return stopPrice < (trg - tolerance);
}

function normalizeOrderType(order) {
  return String(order && (order.type || order.origType || order.orderType || order.algoType) || "").toUpperCase();
}

function normalizeOrderId(order) {
  const raw = order && (order.orderId ?? order.order_id ?? order.algoId ?? order.algo_id);
  return String(raw == null ? "" : raw).trim();
}

function toOrderBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "on";
}

function matchesProtectionOrder(order, { kind, closeSide, targetOrderId } = {}) {
  const type = normalizeOrderType(order);
  const side = String(order && order.side || "").toUpperCase();
  const orderId = normalizeOrderId(order);
  const reduceOnly = toOrderBool(order && order.reduceOnly);
  const closePosition = toOrderBool(order && order.closePosition);
  const typeOk = kind === "STOP"
    ? (type === "STOP_MARKET" || type === "STOP")
    : (type === "TAKE_PROFIT_MARKET" || type === "TAKE_PROFIT");
  if (!typeOk) return false;
  if (closeSide && side && side !== closeSide) return false;
  if (targetOrderId && orderId && orderId === String(targetOrderId).trim()) return true;
  return reduceOnly || closePosition || !targetOrderId;
}

function normalizeAlgoOrderFetchResult(payload) {
  const helper = binancePrivateTest && typeof binancePrivateTest.normalizeAlgoOpenOrdersResponse === "function"
    ? binancePrivateTest.normalizeAlgoOpenOrdersResponse
    : null;
  if (helper) return helper(payload);
  if (Array.isArray(payload)) return { orders: payload, endpointUnavailable: false, note: null };
  if (payload && typeof payload === "object" && payload.endpointUnavailable === true) {
    return {
      orders: Array.isArray(payload.orders) ? payload.orders : [],
      endpointUnavailable: true,
      note: String(payload.note || "ALGO_ENDPOINT_UNAVAILABLE"),
    };
  }
  return { orders: [], endpointUnavailable: false, note: null };
}

async function fetchOrderByAnyId({ apiKey, apiSecret, symbol, orderId, skipAlgo = false } = {}) {
  const id = String(orderId || "").trim();
  if (!apiKey || !apiSecret || !symbol || !id) return null;
  try {
    return await fetchFuturesOrder({ apiKey, apiSecret, symbol, orderId: id });
  } catch (_) {}
  if (skipAlgo) return null;
  try {
    return await fetchFuturesAlgoOrder({ apiKey, apiSecret, symbol, algoId: id });
  } catch (_) {}
  return null;
}

async function resolveLiveNativeProtectionState({ exCfg, symbol, pos } = {}) {
  const sym = String(symbol || pos && (pos.symbol_or_pair_id || pos.symbol) || "").toUpperCase();
  if (!sym) return null;
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const metaStopActive = hasNativeStopProtection(meta);
  const metaTpActive = hasNativeTpProtection(meta);
  if (!metaStopActive && !metaTpActive) return null;

  const cacheKey = sym;
  const now = nowMs();
  const cached = nativeProtectionStateCache.get(cacheKey);
  if (!shouldBypassNativeProtectionCache({
    cached,
    refreshAtMs: meta.native_protection_refresh_at_ms,
    now,
  })) return cached.value;

  const apiKey = String(process.env.BINANCEFUT_API_KEY || exCfg && exCfg.api_key || "").trim();
  const apiSecret = String(process.env.BINANCEFUT_API_SECRET || exCfg && exCfg.api_secret || "").trim();
  if (!apiKey || !apiSecret) {
    const fallback = { stopActive: false, tpActive: false, verify_error: "BINANCE_KEYS_MISSING" };
    nativeProtectionStateCache.set(cacheKey, {
      checkedAt: now,
      expiresAt: now + TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS,
      value: fallback,
    });
    return fallback;
  }

  const positionSide = resolvePositionSideFromPosition(pos, meta, "LONG");
  const closeSide = resolveCloseSide(positionSide);
  let regularOrders = [];
  let algoOrders = [];
  let verifyError = null;
  let algoEndpointUnavailable = false;

  try {
    const fetched = await fetchFuturesOpenOrders({ apiKey, apiSecret, symbol: sym });
    regularOrders = Array.isArray(fetched) ? fetched : [];
  } catch (e) {
    verifyError = `OPEN_ORDERS_FETCH_FAIL:${String(e && e.message ? e.message : e).slice(0, 120)}`;
  }
  try {
    const fetched = await fetchFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol: sym });
    const normalized = normalizeAlgoOrderFetchResult(fetched);
    algoOrders = normalized.orders;
    algoEndpointUnavailable = normalized.endpointUnavailable === true;
    if (algoEndpointUnavailable) {
      verifyError = verifyError || String(normalized.note || "ALGO_ENDPOINT_UNAVAILABLE");
    }
  } catch (e) {
    verifyError = verifyError || `ALGO_OPEN_ORDERS_FETCH_FAIL:${String(e && e.message ? e.message : e).slice(0, 120)}`;
  }

  const stopOrderId = String(meta.native_protection_stop_order_id || "").trim();
  const tpOrderId = String(meta.native_protection_tp_order_id || "").trim();
  let stopActive = false;
  let tpActive = false;

  const allOrders = [...regularOrders, ...algoOrders];
  stopActive = allOrders.some((order) => matchesProtectionOrder(order, {
    kind: "STOP",
    closeSide,
    targetOrderId: stopOrderId || null,
  }));
  tpActive = allOrders.some((order) => matchesProtectionOrder(order, {
    kind: "TP",
    closeSide,
    targetOrderId: tpOrderId || null,
  }));

  if (!stopActive && stopOrderId) {
    const ord = await fetchOrderByAnyId({ apiKey, apiSecret, symbol: sym, orderId: stopOrderId, skipAlgo: algoEndpointUnavailable });
    if (ord) stopActive = matchesProtectionOrder(ord, { kind: "STOP", closeSide, targetOrderId: stopOrderId });
  }
  if (!tpActive && tpOrderId) {
    const ord = await fetchOrderByAnyId({ apiKey, apiSecret, symbol: sym, orderId: tpOrderId, skipAlgo: algoEndpointUnavailable });
    if (ord) tpActive = matchesProtectionOrder(ord, { kind: "TP", closeSide, targetOrderId: tpOrderId });
  }

  const value = {
    stopActive,
    tpActive,
    verify_error: verifyError,
  };
  nativeProtectionStateCache.set(cacheKey, {
    checkedAt: now,
    expiresAt: now + TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS,
    value,
  });
  return value;
}

function computeExitTriggers({ pos, rules, leverageEff, nativeProtectionState } = {}) {
  const out = [];
  const avg = Number(pos && pos.avg_price);
  if (!Number.isFinite(avg) || avg <= 0) return out;
  const meta = pos && pos.meta ? pos.meta : {};
  const side = resolvePositionSideFromPosition(pos, meta, "LONG");
  const canonicalStage = resolveCanonicalExitStageForPosition(pos);
  const tpP1Done = hasCanonicalTpP1Reached(canonicalStage);
  const tpP0Done = meta.tp_p0_done === true || tpP1Done;
  const tpP1Pending = meta.tp_p1_pending === true;
  const nativeStopActive = nativeProtectionState && typeof nativeProtectionState.stopActive === "boolean"
    ? nativeProtectionState.stopActive
    : hasNativeStopProtection(meta);
  const nativeTpActive = nativeProtectionState && typeof nativeProtectionState.tpActive === "boolean"
    ? nativeProtectionState.tpActive
    : hasNativeTpProtection(meta);

  if (!nativeStopActive) {
    const slPx = pnlToPrice({ avg, pnlPct: Number(rules.SL) / leverageEff, side });
    if (Number.isFinite(slPx)) out.push({ kind: "SL", price: slPx });
  }

  const tpP0Pct = resolveTpP0Pct({ rules, meta });
  if (!tpP0Done && Number.isFinite(tpP0Pct) && tpP0Pct > 0) {
    const tp0Px = pnlToPrice({ avg, pnlPct: Number(tpP0Pct) / leverageEff, side });
    if (Number.isFinite(tp0Px)) out.push({ kind: "TP_P0", price: tp0Px });
  }

  if (!tpP1Done && !nativeTpActive) {
    const tp1Px = pnlToPrice({ avg, pnlPct: Number(rules.TP_P1) / leverageEff, side });
    if (Number.isFinite(tp1Px)) out.push({ kind: "TP_P1", price: tp1Px });
  }

  if (Number.isFinite(rules.TP_C)) {
    const tpCPx = pnlToPrice({ avg, pnlPct: Number(rules.TP_C) / leverageEff, side });
    if (Number.isFinite(tpCPx)) out.push({ kind: "TP_C", price: tpCPx });
  }

  const bePct = computeBePct(rules, leverageEff, pos.exchange);
  if (Number.isFinite(bePct)) {
    const bePx = pnlToPrice({ avg, pnlPct: Number(bePct) / leverageEff, side });
    if (Number.isFinite(bePx)) out.push({ kind: "BE", price: bePx });
  }

  const trailDelay = resolveTrailDelayState({
    meta,
    tpP1Done,
    currentBarMs: Date.now(),
    closePx: null,
    side,
    leverageEff,
    rules,
  });
  const trailEnabled = isCanonicalTrailStage(canonicalStage) || trailDelay.trailActive || tpP1Pending;
  if ((tpP1Done || tpP1Pending) && trailEnabled && (Number.isFinite(rules.TRAIL_R_MULTIPLE) || Number.isFinite(rules.TRAIL_PCT))) {
    const runnerExit = computeRunnerExitStopPrice({
      avg,
      leverageEff,
      side,
      rules,
      tpP1Done,
      trailActive: isCanonicalTrailStage(canonicalStage),
      trailHigh: Number(meta.trail_high),
      trailLow: Number(meta.trail_low),
      entryRDistance: Number(meta.entry_r_distance),
    });
    if (Number.isFinite(runnerExit.stopPrice)) {
      out.push({ kind: "TRAIL", price: runnerExit.stopPrice, source: runnerExit.stopSource });
    }
  }

  return out;
}

function shouldCheckNear({ price, triggers, nearPct, side }) {
  return collectTriggeredKinds({ price, triggers, nearPct, side }).length > 0;
}

function collectTriggeredKinds({ price, triggers, nearPct, side }) {
  if (!Number.isFinite(price) || !Array.isArray(triggers) || !triggers.length) return [];
  const pct = Number(nearPct);
  const sideUpper = String(side || "LONG").toUpperCase();
  const kinds = [];

  triggers.forEach((t) => {
    const trg = Number(t && t.price);
    const kind = String(t && t.kind || "").toUpperCase();
    if (!Number.isFinite(trg) || trg <= 0) return;

    // 가격이 이미 트리거를 통과한 경우(급등/급락)는 nearPct와 무관하게 즉시 검사
    const isTakeProfit = kind === "TP_P0" || kind === "TP_P1" || kind === "TP_C";
    const crossed = sideUpper === "SHORT"
      ? (isTakeProfit ? (price <= trg) : (price >= trg))
      : (isTakeProfit ? (price >= trg) : (price <= trg));
    if (crossed) {
      kinds.push(kind);
      return;
    }

    if (!Number.isFinite(pct) || pct <= 0) return;
    const diff = Math.abs((price - trg) / trg);
    if (diff <= pct) kinds.push(kind);
  });

  return Array.from(new Set(kinds));
}

function shouldActivateFastLane({ pos, price, triggers, fastLanePct, side } = {}) {
  if (!pos || !Number.isFinite(price) || !Array.isArray(triggers) || !triggers.length) return false;
  const pct = Number(fastLanePct);
  if (!Number.isFinite(pct) || pct <= 0) return false;
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const canonicalStage = resolveCanonicalExitStageForPosition(pos);
  const tpP1Done = hasCanonicalTpP1Reached(canonicalStage);
  const rules = resolveExitRulesForPosition({ exchange: pos.exchange, position: pos });
  const trailDelay = resolveTrailDelayState({
    meta,
    tpP1Done,
    currentBarMs: Date.now(),
    closePx: price,
    side,
    leverageEff: Number(meta.external_leverage || pos.leverage || 1),
    rules,
  });
  const trailEnabled = isCanonicalTrailStage(canonicalStage) || trailDelay.trailActive || meta.tp_p1_pending === true;
  const trailReady = tpP1Done || meta.tp_p1_pending === true;
  if (!trailReady || !trailEnabled) return false;

  const trailTrigger = triggers.find((t) => String(t && t.kind || "").toUpperCase() === "TRAIL");
  const trg = Number(trailTrigger && trailTrigger.price);
  if (!Number.isFinite(trg) || trg <= 0) return false;

  const sideUpper = resolvePositionSideFromPosition(
    { position_side: side || pos.position_side || pos.side },
    meta,
    "LONG"
  );
  const crossed = sideUpper === "SHORT" ? (price >= trg) : (price <= trg);
  if (crossed) return true;

  const diff = Math.abs((price - trg) / trg);
  return diff <= pct;
}

async function runBinanceTickExitOnce({ nearPct, symbolCooldownMs } = {}) {
  const exCfg = await getExchangeSettingsForProvider("BINANCEFUT", 2000);
  if (!exCfg || exCfg.enabled === false) return { ok: false, skipped: true, reason: "BINANCE_DISABLED" };
  const markets = Array.isArray(exCfg.markets) ? exCfg.markets : [];
  const symbolSet = new Set(markets.map((s) => String(s || "").toUpperCase()).filter(Boolean));

  try {
    const positions = await listExchangePositionReadViews({
      exchange: "BINANCEFUT",
      limit: 200,
    });
    positions.forEach((p) => {
      const size = Number(p.size_pct || 0);
      const state = String(p.position_state || p.state || "").toUpperCase();
      const symbol = String(p.symbol_or_pair_id || p.symbol || "").toUpperCase();
      if (!symbol) return;
      if (!Number.isFinite(size) || size <= 0 || state === "FLAT") return;
      symbolSet.add(symbol);
    });
  } catch (_) {}

  const symbolsToCheck = Array.from(symbolSet);
  if (!symbolsToCheck.length) return { ok: false, skipped: true, reason: "NO_MARKETS" };

  const positions = await Promise.all(symbolsToCheck.map(async (mk) => {
    return getPositionReadView({
      exchange: "BINANCEFUT",
      symbol: mk,
    });
  }));
  const active = positions.filter((p) => {
    const size = Number(p && p.size_pct);
    const state = String(p && p.state || "").toUpperCase();
    return Number.isFinite(size) && size > 0 && state !== "FLAT";
  });
  if (!active.length) return { ok: true, checked: 0, triggered: 0 };

  const [operationalGuard, systemSlo, systemAnomaly] = await Promise.all([
    loadOperationalGuardRuntime({ exchange: "BINANCEFUT" }).catch(() => null),
    loadSystemSloRuntime({ exchange: "BINANCEFUT" }).catch(() => null),
    loadSystemAnomalyRuntime({ exchange: "BINANCEFUT" }).catch(() => null),
  ]);

  const symbols = active.map((p) => String(p.symbol_or_pair_id || p.symbol || "")).filter(Boolean);
  const priceMap = await fetchBinanceFuturesPrices(symbols);

  const execTf = String(exCfg.exec_tf || "15m");
  const cooldownMs = normalizeIntervalMs(symbolCooldownMs, 20000);

  let checked = 0;
  let triggered = 0;
  let skippedCooldown = 0;
  let fastLaneActive = false;
  const fastLaneSymbols = new Set();
  for (const pos of active) {
    const symbol = String(pos.symbol_or_pair_id || pos.symbol || "");
    const price = priceMap[String(symbol).toUpperCase()];
    if (!Number.isFinite(price)) continue;

    try {
      const tickNow = nowMs();
      const signalTf = resolvePositionSignalTf({ pos, exCfg });
      try {
        await clearExpiredTpP1Pending({ pos, symbol, tf: signalTf, now: tickNow });
      } catch (e) {
        structuredLog("tick_exit_clear_stale_tp1_pending_error", {
          exchange: "BINANCEFUT",
          symbol: String(symbol).toUpperCase(),
          error: String(e && e.message || e).slice(0, 200),
        }, "warn");
      }

      const _tMeta = (pos && typeof pos.meta === "object") ? pos.meta : {};
      const _canonicalStage = resolveCanonicalExitStageForPosition(pos);
      const _tpP1Done = hasCanonicalTpP1Reached(_canonicalStage);
      const _trailStage = isCanonicalTrailStage(_canonicalStage);
      const _trailEnabled = _trailStage || _tMeta.tp_p1_pending === true;
      if ((_tpP1Done || _tMeta.tp_p1_pending === true) && _trailEnabled) {
        const _tSide = resolvePositionSideFromPosition(pos, _tMeta, "LONG");
        let _trailPatch = null;
        let _trailField = null;
        let _trailNext = null;
        let _trailPrev = null;
        if (_tSide === "LONG") {
          const prevHigh = Number(_tMeta.trail_high);
          if (!Number.isFinite(prevHigh) || price > prevHigh) {
            _trailPatch = { "meta.trail_high": price, "meta.trail_high_at_ms": tickNow };
            _trailField = "trail_high";
            _trailNext = price;
            _trailPrev = prevHigh;
          }
        } else if (_tSide === "SHORT") {
          const prevLow = Number(_tMeta.trail_low);
          if (!Number.isFinite(prevLow) || price < prevLow) {
            _trailPatch = { "meta.trail_low": price, "meta.trail_low_at_ms": tickNow };
            _trailField = "trail_low";
            _trailNext = price;
            _trailPrev = prevLow;
          }
        }
        if (_trailPatch) {
          const _trailEvalMs = nowMs();
          const _exitRules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: pos });
          let _nativeRefresh = null;
          let _runnerExit = null;
          try {
            if (pos.meta && _trailField === "trail_high" && Number.isFinite(_trailNext)) {
              pos.meta.trail_high = _trailNext;
              pos.meta.trail_high_at_ms = tickNow;
            } else if (pos.meta && _trailField === "trail_low" && Number.isFinite(_trailNext)) {
              pos.meta.trail_low = _trailNext;
              pos.meta.trail_low_at_ms = tickNow;
            }
            _runnerExit = computeRunnerExitStopPrice({
              avg: Number(pos && pos.avg_price),
              leverageEff: Number(_tMeta && (_tMeta.external_leverage || _tMeta.leverage || pos.leverage || 1)),
              side: _tSide,
              rules: _exitRules,
              tpP1Done: _tpP1Done,
              trailActive: _trailStage,
              trailHigh: pos.meta && Number.isFinite(Number(pos.meta.trail_high)) ? Number(pos.meta.trail_high) : null,
              trailLow: pos.meta && Number.isFinite(Number(pos.meta.trail_low)) ? Number(pos.meta.trail_low) : null,
              entryRDistance: Number(_tMeta && _tMeta.entry_r_distance),
            });
            const _tLogKey = `trail_upd_${String(symbol).toUpperCase()}`;
            const _tNow = nowMs();
            const _tLastLog = Number(symbolCooldownLogState.get(_tLogKey));
            if (!Number.isFinite(_tLastLog) || (_tNow - _tLastLog) >= 60000) {
              symbolCooldownLogState.set(_tLogKey, _tNow);
              structuredLog("tick_exit_trail_updated", {
                exchange: "BINANCEFUT",
                symbol: String(symbol).toUpperCase(),
                side: _tSide,
                field: _trailField || (_tSide === "LONG" ? "trail_high" : "trail_low"),
                prev: _trailPrev,
                next: price,
              });
            }

            try {
              const _liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol });
              _nativeRefresh = await refreshBinanceNativeProtectionWithRetry({
                liveCfg: _liveCfg,
                exchange: "BINANCEFUT",
                symbol,
                fallbackSide: _tSide === "SHORT" ? "SELL" : "BUY",
                fallbackEntryPrice: Number(pos && pos.avg_price),
                fallbackLeverage: Number(_tMeta && (_tMeta.external_leverage || _tMeta.leverage || 1)),
                exitRulesOverride: _tMeta && _tMeta.exit_rules_override ? _tMeta.exit_rules_override : null,
                posMeta: pos.meta || _tMeta,
              });
            } catch (_nativeRefreshErr) {
              structuredLog("tick_exit_trail_native_refresh_error", {
                exchange: "BINANCEFUT",
                symbol: String(symbol).toUpperCase(),
                error: String(_nativeRefreshErr && _nativeRefreshErr.message || _nativeRefreshErr).slice(0, 200),
              }, "warn");
              _nativeRefresh = {
                ok: false,
                reason: String(_nativeRefreshErr && _nativeRefreshErr.message || _nativeRefreshErr).slice(0, 200),
              };
            }

            try {
              const _obsWriteAtMs = nowMs();
              const _obsNativeStopPrice = _nativeRefresh && _nativeRefresh.ok === true
                ? Number(_nativeRefresh.stop_price)
                : (pos.meta && Number.isFinite(Number(pos.meta.native_protection_stop_price))
                  ? Number(pos.meta.native_protection_stop_price)
                  : null);
              const _obsNativeStopOrderId = _nativeRefresh && _nativeRefresh.ok === true
                ? (_nativeRefresh.stop_order_id || null)
                : (pos.meta && pos.meta.native_protection_stop_order_id ? pos.meta.native_protection_stop_order_id : null);
              const _obsNativeRefreshStatus = _nativeRefresh
                ? (_nativeRefresh.ok === true
                  ? "OK"
                  : String(_nativeRefresh.reason || "FAILED").trim().toUpperCase())
                : (pos.meta && pos.meta.native_protection_refresh_status ? pos.meta.native_protection_refresh_status : null);
              await upsertTrailObservation({
                exchange: "BINANCEFUT",
                symbol,
                side: _tSide,
                entryEventId: pos.meta && pos.meta.entry_event_id ? pos.meta.entry_event_id : null,
                entryExecBarMs: pos.meta && Number.isFinite(Number(pos.meta.entry_exec_bar_ms))
                  ? Number(pos.meta.entry_exec_bar_ms)
                  : null,
                entryPrice: Number(pos && pos.avg_price),
                entryRDistance: pos.meta && Number.isFinite(Number(pos.meta.entry_r_distance))
                  ? Number(pos.meta.entry_r_distance)
                  : null,
                trailRMultiple: Number(_exitRules && _exitRules.TRAIL_R_MULTIPLE),
                trailHigh: pos.meta && Number.isFinite(Number(pos.meta.trail_high)) ? Number(pos.meta.trail_high) : null,
                trailHighAtMs: pos.meta && Number.isFinite(Number(pos.meta.trail_high_at_ms)) ? Number(pos.meta.trail_high_at_ms) : null,
                trailLow: pos.meta && Number.isFinite(Number(pos.meta.trail_low)) ? Number(pos.meta.trail_low) : null,
                trailLowAtMs: pos.meta && Number.isFinite(Number(pos.meta.trail_low_at_ms)) ? Number(pos.meta.trail_low_at_ms) : null,
                runnerFloorStop: Number(_runnerExit && _runnerExit.runnerFloorStop),
                computedTrailStop: Number(_runnerExit && _runnerExit.stopPrice),
                trailStopRaw: Number(_runnerExit && _runnerExit.trailStop),
                trailStopByR: Number(_runnerExit && _runnerExit.trailStopByR),
                trailStopByPct: Number(_runnerExit && _runnerExit.trailStopByPct),
                chosenStopSource: _runnerExit && _runnerExit.stopSource ? _runnerExit.stopSource : null,
                chosenStopPrice: Number(_runnerExit && _runnerExit.stopPrice),
                finalEffectiveStop: Number(_runnerExit && _runnerExit.stopPrice),
                nativeStopPrice: Number.isFinite(_obsNativeStopPrice) ? _obsNativeStopPrice : null,
                nativeStopOrderId: _obsNativeStopOrderId,
                nativeRefreshStatus: _obsNativeRefreshStatus,
                lastRepriceAtMs: _obsWriteAtMs,
                runtimeEvalAtMs: _trailEvalMs,
                source: "TICK_EXIT",
              });
              await recordTrailRuntimeEvent({
                exchange: "BINANCEFUT",
                symbol,
                event: "TRAIL_WATERMARK_UPDATED",
                runId: buildTickTrailReconcileRunId(symbol, tickNow),
                tsMs: tickNow,
                payload: {
                  side: _tSide,
                  field: _trailField || (_tSide === "LONG" ? "TRAIL_HIGH" : "TRAIL_LOW"),
                  prev: Number.isFinite(_trailPrev) ? _trailPrev : null,
                  next: Number.isFinite(_trailNext) ? _trailNext : null,
                  computed_trail_stop: Number(_runnerExit && _runnerExit.stopPrice),
                  runner_floor_stop: Number(_runnerExit && _runnerExit.runnerFloorStop),
                  native_stop_price: Number.isFinite(_obsNativeStopPrice) ? _obsNativeStopPrice : null,
                },
              }).catch(() => null);
            } catch (_trailObsErr) {
              structuredLog("tick_exit_trail_observation_write_error", {
                exchange: "BINANCEFUT",
                symbol: String(symbol).toUpperCase(),
                error: String(_trailObsErr && _trailObsErr.message || _trailObsErr).slice(0, 200),
              }, "warn");
              throw _trailObsErr;
            } finally {
              try {
                await syncFuturesPositionOnly({
                  runId: buildTickTrailReconcileRunId(symbol, Date.now()),
                  exchange: "BINANCEFUT",
                  symbol,
                });
              } catch (_syncErr) {
                structuredLog("tick_exit_trail_position_reconcile_error", {
                  exchange: "BINANCEFUT",
                  symbol: String(symbol).toUpperCase(),
                  error: String(_syncErr && _syncErr.message || _syncErr).slice(0, 200),
                }, "warn");
              }
            }
          } catch (_trailErr) {
            structuredLog("tick_exit_trail_update_error", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              error: String(_trailErr && _trailErr.message || _trailErr).slice(0, 200),
            }, "warn");
          }
        }
      }

      const scope = intentScopeKey("BINANCEFUT", symbol, signalTf);
      let trailObservation = null;
      try {
        trailObservation = await getPositionRuntimeObservation({
          exchange: "BINANCEFUT",
          symbol,
        });
      } catch (_) {}
      const effectivePos = applyTrailObservationToPosition({ pos, observation: trailObservation });
      const leverageEff = resolveLeverageEff(pos, "BINANCEFUT");
      const rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: effectivePos });
      const nativeProtectionState = await resolveLiveNativeProtectionState({ exCfg, symbol, pos: effectivePos });
      if (nativeProtectionState && nativeProtectionState.verify_error) {
        const logKey = `native_verify_${String(symbol).toUpperCase()}`;
        const lastLogged = Number(symbolCooldownLogState.get(logKey));
        if (!Number.isFinite(lastLogged) || (tickNow - lastLogged) >= 60000) {
          symbolCooldownLogState.set(logKey, tickNow);
          structuredLog("tick_exit_native_verify_warn", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            error: nativeProtectionState.verify_error,
          }, "warn");
        }
      }
      const triggers = computeExitTriggers({ pos: effectivePos, rules, leverageEff, nativeProtectionState });
      const resolvedPosSide = resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG");
      const trailTrigger = triggers.find((t) => String(t && t.kind || "").toUpperCase() === "TRAIL");
      const trailAuthority = trailTrigger
        ? await loadTrailAuthorityRuntime({
          exchange: "BINANCEFUT",
          symbol,
          position: effectivePos,
          activePositions: active,
          operationalGuard,
          systemSlo,
          systemAnomaly,
        }).catch(() => null)
        : null;
      const effectiveNearPct = Number.isFinite(Number(nearPct))
        ? (Number(nearPct) * Math.max(1, Number(trailAuthority && trailAuthority.near_pct_multiplier) || 1))
        : nearPct;
      const triggeredKinds = collectTriggeredKinds({
        price,
        triggers,
        nearPct: effectiveNearPct,
        side: resolvedPosSide,
      });
      if (trailAuthority) {
        await publishTrailAuthorityState({
          state: trailAuthority,
          source: "BINANCE_TICK_EXIT",
          triggerKinds: triggeredKinds,
        }).catch(() => null);
      }
      const trailProtectionDeficit = trailTrigger && isNativeStopLessProtectiveThanTrigger({
        meta: effectivePos.meta,
        triggerPrice: trailTrigger.price,
        side: resolvedPosSide,
      });
      if (trailProtectionDeficit) {
        try {
          const liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol });
          const refreshed = await refreshBinanceNativeProtectionWithRetry({
            liveCfg,
            exchange: "BINANCEFUT",
            symbol,
            fallbackSide: resolvedPosSide === "SHORT" ? "SELL" : "BUY",
            fallbackEntryPrice: Number(effectivePos && effectivePos.avg_price),
            fallbackLeverage: Number(effectivePos && effectivePos.meta && (effectivePos.meta.external_leverage || effectivePos.meta.leverage || effectivePos.leverage || 1)),
            exitRulesOverride: effectivePos && effectivePos.meta && effectivePos.meta.exit_rules_override ? effectivePos.meta.exit_rules_override : null,
            posMeta: effectivePos.meta || {},
          });
          structuredLog("tick_exit_trail_native_floor_refresh", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            side: resolvedPosSide,
            trigger_price: Number(trailTrigger.price),
            native_stop_price: Number(effectivePos && effectivePos.meta && effectivePos.meta.native_protection_stop_price),
            refreshed: refreshed && refreshed.ok === true,
            refresh_reason: refreshed && refreshed.reason ? String(refreshed.reason) : null,
          });
        } catch (nativeRefreshErr) {
          structuredLog("tick_exit_trail_native_floor_refresh_error", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            side: resolvedPosSide,
            trigger_price: Number(trailTrigger.price),
            error: String(nativeRefreshErr && nativeRefreshErr.message || nativeRefreshErr).slice(0, 200),
          }, "warn");
        } finally {
          try {
            clearNativeProtectionStateCache(symbol);
            await syncFuturesPositionOnly({
              runId: buildTickTrailReconcileRunId(symbol, Date.now()),
              exchange: "BINANCEFUT",
              symbol,
            });
          } catch (_) {}
        }
      }
      const hardExit = shouldTriggerTrailHardExit({
        position: effectivePos,
        price,
        side: resolvedPosSide,
        rules,
      });
      if (hardExit.trigger === true) {
        const hardExitKey = `TRAIL_HARD_EXIT__${String(symbol).toUpperCase()}`;
        const lastHardExitAt = Number(trailHardExitCooldownState.get(hardExitKey));
        if (!Number.isFinite(lastHardExitAt) || (tickNow - lastHardExitAt) >= TICK_EXIT_HARD_EXIT_COOLDOWN_MS) {
          trailHardExitCooldownState.set(hardExitKey, tickNow);
          try {
            const hardExitResult = await runTrailHardExit({
              exchange: "BINANCEFUT",
              symbol,
              position: effectivePos,
              price,
              signalTf,
              execTf,
              hardExit,
            });
            structuredLog("tick_exit_trail_hard_exit", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              side: resolvedPosSide,
              price,
              stop_price: hardExit.stopPrice,
              stop_source: hardExit.runnerExit && hardExit.runnerExit.stopSource ? hardExit.runnerExit.stopSource : null,
              order_id: hardExitResult && hardExitResult.orderId ? hardExitResult.orderId : null,
              ok: hardExitResult && hardExitResult.ok === true,
              reason: hardExitResult && hardExitResult.reason ? hardExitResult.reason : hardExit.reason,
            }, hardExitResult && hardExitResult.ok === true ? "log" : "warn");
            try {
              clearNativeProtectionStateCache(symbol);
              await syncFuturesPositionOnly({
                runId: buildTickTrailReconcileRunId(symbol, Date.now()),
                exchange: "BINANCEFUT",
                symbol,
              });
            } catch (_) {}
            checked += 1;
            triggered += 1;
            continue;
          } catch (hardExitErr) {
            structuredLog("tick_exit_trail_hard_exit_error", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              side: resolvedPosSide,
              price,
              stop_price: hardExit.stopPrice,
              error: String(hardExitErr && hardExitErr.message || hardExitErr).slice(0, 200),
            }, "warn");
          }
        }
      }
      const nearHit = triggeredKinds.length > 0;
      const fastLaneHit = shouldActivateFastLane({
        pos: effectivePos,
        price,
        triggers,
        fastLanePct: Number(env.tickExit && env.tickExit.fastLanePct || 0) * Math.max(1, Number(trailAuthority && trailAuthority.near_pct_multiplier) || 1),
        side: resolvedPosSide,
      }) || !!(trailAuthority && trailAuthority.force_fast_lane === true);
      if (fastLaneHit) {
        fastLaneActive = true;
        fastLaneSymbols.add(String(symbol).toUpperCase());
      }
      const trailOnlyTriggered = triggeredKinds.length > 0 && triggeredKinds.every((kind) => kind === "TRAIL");
      if (trailAuthority && trailAuthority.block_synthetic_trail === true && trailOnlyTriggered) {
        await recordTrailRuntimeEvent({
          exchange: "BINANCEFUT",
          symbol,
          event: "TRAIL_TRIGGER_BLOCKED",
          tsMs: tickNow,
          payload: {
            status: trailAuthority.status,
            reason: trailAuthority.reason,
            issues: Array.isArray(trailAuthority.issues) ? trailAuthority.issues.slice() : [],
            remediation_action: trailAuthority.remediation_action || null,
            triggered_kinds: triggeredKinds,
          },
        }).catch(() => null);
        continue;
      }
      let pendingForced = false;
      if (!nearHit) {
        pendingForced = await hasPendingIntentsForScope({
          exchange: "BINANCEFUT",
          symbol,
          tf: signalTf,
          now: nowMs(),
        });
        if (!pendingForced) continue;
        const logKey = String(symbol || "").toUpperCase();
        const now = nowMs();
        const lastLogged = Number(pendingIntentLogState.get(logKey));
        if (!Number.isFinite(lastLogged) || (now - lastLogged) >= 60 * 1000) {
          pendingIntentLogState.set(logKey, now);
          structuredLog("tick_exit_forced_by_pending_intent", {
            exchange: "BINANCEFUT",
            symbol: logKey,
            tf: signalTf,
          });
        }
      }

      const now = nowMs();
      const permit = (pendingForced || nearHit)
        ? { ok: true, remainingMs: 0 }
        : shouldRunBySymbolCooldown({ symbol, now, cooldownMs });
      if (!permit.ok) {
        skippedCooldown += 1;
        const key = String(symbol || "").toUpperCase();
        const lastLogged = Number(symbolCooldownLogState.get(key));
        if (!Number.isFinite(lastLogged) || (now - lastLogged) >= 60 * 1000) {
          symbolCooldownLogState.set(key, now);
          structuredLog("tick_exit_skipped_by_cooldown", {
            exchange: "BINANCEFUT",
            symbol: key,
            cooldown_ms: cooldownMs,
            remaining_ms: permit.remainingMs,
          });
        }
        continue;
      }

      checked += 1;
      const bar = {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        closeTimeUtc: new Date(now).toISOString(),
        closeTimeUtcMs: now,
        timestamp: now,
        t: new Date(now).toISOString(),
        o: price,
        h: price,
        l: price,
        c: price,
        v: 0,
      };
      const runId = `RUN__BINANCEFUT__${symbol}__TICK_EXIT__${now}`;
      if (triggeredKinds.includes("TRAIL")) {
        await recordTrailRuntimeEvent({
          exchange: "BINANCEFUT",
          symbol,
          event: "TRAIL_TRIGGER_ENQUEUED",
          runId,
          tsMs: now,
          payload: {
            status: trailAuthority && trailAuthority.status || "CLEAR",
            reason: trailAuthority && trailAuthority.reason || "TRAIL_AUTHORITY_OK",
            issues: trailAuthority && Array.isArray(trailAuthority.issues) ? trailAuthority.issues.slice() : [],
            near_pct: effectiveNearPct,
            force_fast_lane: !!(trailAuthority && trailAuthority.force_fast_lane === true),
            triggered_kinds: triggeredKinds,
          },
        }).catch(() => null);
      }
      const pre = await runActionPreHooks({
        action: "BINANCE_TICK_EXIT_MARKET_RUN",
        runId,
        exchange: "BINANCEFUT",
        symbol,
        tf: signalTf,
        signalEvent: "TICK_EXIT",
        decisionReason: pendingForced ? "PENDING_INTENT_FORCED" : "NEAR_TRIGGER",
        source: "BINANCE_TICK_EXIT",
        executionMode: "LIVE",
        intent: "EXIT",
        writer: structuredLogWriter,
        persist: true,
      });
      const runResult = await runPaperMarket({
        exchange: "BINANCEFUT",
        symbol,
        tf: signalTf,
        execTf,
        barCloseUtc: new Date(now).toISOString(),
        barCloseMs: now,
        bar,
        gate: null,
        trading_mode: "EXIT_ONLY",
        backfillExitOnly: true,
        runId,
      });
      runActionPostHooks({
        envelope: pre.envelope,
        ok: true,
        reason: "TICK_EXIT_MARKET_RUN_COMPLETED",
        writer: structuredLogWriter,
        persist: true,
        result: {
          fills_executed: Number(runResult && runResult.fills_executed) || 0,
          intents_created: Number(runResult && runResult.intents_created) || 0,
          pending_forced: pendingForced === true,
        },
      });
      if (triggeredKinds.includes("TRAIL")) {
        await recordTrailRuntimeEvent({
          exchange: "BINANCEFUT",
          symbol,
          event: "TRAIL_TRIGGER_COMPLETED",
          runId,
          tsMs: nowMs(),
          payload: {
            status: trailAuthority && trailAuthority.status || "CLEAR",
            reason: trailAuthority && trailAuthority.reason || "TRAIL_AUTHORITY_OK",
            triggered_kinds: triggeredKinds,
            fills_executed: Number(runResult && runResult.fills_executed) || 0,
            intents_created: Number(runResult && runResult.intents_created) || 0,
            pending_forced: pendingForced === true,
          },
        }).catch(() => null);
      }
      if ((Number(runResult && runResult.fills_executed) || 0) > 0 || (Number(runResult && runResult.intents_created) || 0) > 0) {
        try {
          const integrity = await auditBinanceExitIntegrity({ symbols: [symbol], includeFlat: true });
          const issueCount = Number(integrity && integrity.issue_count) || 0;
          const topIssue = Array.isArray(integrity && integrity.issues) && integrity.issues.length
            ? integrity.issues[0]
            : null;
          emitActionEvent({
            event: "action_post_integrity",
            envelope: pre.envelope,
            writer: structuredLogWriter,
            persist: true,
            extra: {
              hook: "post",
              ok: integrity && integrity.ok === true,
              issue_count: issueCount,
              top_issue_code: topIssue && topIssue.code ? String(topIssue.code).toUpperCase() : null,
              top_issue_severity: topIssue && topIssue.severity ? String(topIssue.severity).toUpperCase() : null,
              audit_scope: "EXIT_INTEGRITY_SYMBOL",
            },
            level: issueCount > 0 ? "warn" : "log",
          });
        } catch (auditErr) {
          emitActionEvent({
            event: "action_post_integrity",
            envelope: pre.envelope,
            writer: structuredLogWriter,
            persist: true,
            extra: {
              hook: "post",
              ok: false,
              audit_scope: "EXIT_INTEGRITY_SYMBOL",
              error: String(auditErr && auditErr.message || auditErr).slice(0, 240),
            },
            level: "warn",
          });
        }
      }
      try {
        const fillsExecuted = Number(runResult && runResult.fills_executed);
        const intentsCreated = Number(runResult && runResult.intents_created);
        if (Number.isFinite(intentsCreated) && Number.isFinite(fillsExecuted)) {
          if (intentsCreated > fillsExecuted) {
            pendingIntentState.set(scope, { checkedAt: nowMs(), hasPending: true });
          } else if (fillsExecuted > 0 && intentsCreated === 0) {
            pendingIntentState.set(scope, { checkedAt: nowMs(), hasPending: false });
          }
        }
      } catch (_) {}
      triggered += 1;
    } catch (symbolErr) {
      const errText = String(symbolErr && (symbolErr.stack || symbolErr.message) || symbolErr).slice(0, 500);
      runActionPostHooks({
        envelope: {
          run_id: null,
          signal_id: null,
          intent_id: null,
          signal_event: "TICK_EXIT",
          ts: new Date().toISOString(),
          exchange: "BINANCEFUT",
          symbol: String(symbol || "").toUpperCase() || null,
          tf: signalTf || null,
          decision_reason: "SYMBOL_LOOP_ERROR",
          source: "BINANCE_TICK_EXIT",
          execution_mode: "LIVE",
          action: "BINANCE_TICK_EXIT_MARKET_RUN",
        },
        ok: false,
        reason: "TICK_EXIT_MARKET_RUN_FAILED",
        writer: structuredLogWriter,
        persist: true,
        result: null,
        extra: {
          error: errText,
        },
      });
      structuredLog("tick_exit_symbol_fail", {
        exchange: "BINANCEFUT",
        symbol: String(symbol).toUpperCase(),
        error: errText,
      }, "warn");
      await sendTickExitFailureAlert({
        symbol,
        error: errText,
        phase: "SYMBOL_LOOP",
        position: pos,
        price,
      });
      continue;
    }
  }

  return {
    ok: true,
    active_count: active.length,
    checked,
    triggered,
    skipped_cooldown: skippedCooldown,
    fast_lane_active: fastLaneActive,
    fast_lane_symbols: Array.from(fastLaneSymbols),
  };
}

async function runBinanceTickExitBurst({
  maxDurationMs,
  maxIterations,
  intervalMs,
  symbolCooldownMs,
  fastLaneEnabled,
  fastLaneIntervalMs,
  nearPct,
} = {}) {
  if (!env.tickExit || env.tickExit.enabled !== true) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }

  const intervalMsResolved = normalizeIntervalMs(
    intervalMs != null ? intervalMs : (env.tickExit && env.tickExit.intervalMs),
    10000
  );
  const fastLaneIntervalResolved = normalizeIntervalMs(
    fastLaneIntervalMs != null ? fastLaneIntervalMs : (env.tickExit && env.tickExit.fastLaneIntervalMs),
    1000
  );
  const symbolCooldownResolved = normalizeIntervalMs(
    symbolCooldownMs != null ? symbolCooldownMs : (env.tickExit && env.tickExit.symbolCooldownMs),
    20000
  );
  const nearPctResolved = Number.isFinite(Number(nearPct))
    ? Number(nearPct)
    : Number(env.tickExit && env.tickExit.nearPct || 0.003);
  const fastLaneEnabledResolved = fastLaneEnabled != null
    ? fastLaneEnabled === true
    : (env.tickExit && env.tickExit.fastLaneEnabled !== false);
  const maxDurationResolved = Math.max(5000, Math.floor(Number(maxDurationMs || 55000)));
  const maxIterationsResolved = Math.max(1, Math.floor(Number(maxIterations || 20)));
  const startedAt = nowMs();
  const leaseTtlMs = Math.max(
    TICK_EXIT_LEASE_MIN_TTL_MS,
    maxDurationResolved + Math.max(intervalMsResolved, fastLaneIntervalResolved) * 2
  );
  const lease = await acquireTickExitLease({ ttlMs: leaseTtlMs });
  if (!lease.ok) {
    return { ok: false, skipped: true, reason: "LEASE_FAIL", error: lease.error || "UNKNOWN" };
  }
  if (lease.acquired !== true) {
    return { ok: true, skipped: true, reason: "LEASE_HELD", holder: lease.holder || null };
  }

  let iterations = 0;
  let nextDelayMs = intervalMsResolved;
  let lastResult = null;
  let selfHealResult = null;

  try {
    while (iterations < maxIterationsResolved) {
      lastResult = await runBinanceTickExitOnce({
        nearPct: nearPctResolved,
        symbolCooldownMs: symbolCooldownResolved,
      });
      iterations += 1;

      const activeCount = Number(lastResult && lastResult.active_count) || 0;
      const fastLaneActive = fastLaneEnabledResolved && lastResult && lastResult.fast_lane_active === true;
      nextDelayMs = fastLaneActive
        ? Math.min(intervalMsResolved, fastLaneIntervalResolved)
        : intervalMsResolved;

      if (activeCount <= 0) break;
      if ((nowMs() - startedAt + nextDelayMs) >= maxDurationResolved) break;
      await sleep(nextDelayMs);
    }
  } finally {
    await releaseTickExitLease();
  }

  selfHealResult = await runTickExitSelfHealPhase({
    reason: "TICK_EXIT_BURST",
  });

  const activeCount = Number(lastResult && lastResult.active_count) || 0;
  return {
    ok: true,
    iterations,
    elapsed_ms: nowMs() - startedAt,
    next_delay_ms: nextDelayMs,
    reschedule_recommended: activeCount > 0,
    last_result: lastResult,
    self_heal: selfHealResult,
  };
}

async function runTickExitSelfHealPhase({
  enabled = String(process.env.BINANCE_LIVE_STATE_SELF_HEAL_ENABLED || "1") !== "0",
  reason = "TICK_EXIT_LOOP",
  leaseHeartbeatOk = true,
  maxPositions = Math.max(1, Number(process.env.BINANCE_LIVE_STATE_SELF_HEAL_MAX_POSITIONS || 12)),
  runSelfHeal = runBinanceLiveStateSelfHeal,
} = {}) {
  if (enabled !== true) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }
  if (leaseHeartbeatOk !== true) {
    return { ok: false, skipped: true, reason: "LEASE_LOST" };
  }
  try {
    return await runSelfHeal({
      exchange: "BINANCEFUT",
      maxPositions,
      reason,
    });
  } catch (e) {
    return {
      ok: false,
      error: e && e.message ? e.message : String(e),
    };
  }
}

async function acquireTickExitLease({ ttlMs } = {}) {
  if (!TICK_EXIT_LEASE_ENABLED) return { ok: true, acquired: true, leaseDisabled: true };
  const ttl = Math.max(TICK_EXIT_LEASE_MIN_TTL_MS, normalizeIntervalMs(ttlMs, TICK_EXIT_LEASE_MIN_TTL_MS));
  const now = Date.now();
  const leaseUntil = now + ttl;
  const db = getFirestore();
  const ref = db.doc(TICK_EXIT_LEASE_DOC);

  try {
    let acquired = false;
    let holder = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const owner = String(data.owner || "");
      const leaseUntilMs = Number(data.lease_until_ms);
      const heartbeatMs = Number(data.heartbeat_ms);
      const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
      const heartbeatFreshMaxMs = Math.max(ttl * 2, 10000);
      const heartbeatFresh = Number.isFinite(heartbeatMs) && (now - heartbeatMs) <= heartbeatFreshMaxMs;
      const staleHolder = !!owner && owner !== tickExitInstanceId && !expired && !heartbeatFresh;
      if (!owner || owner === tickExitInstanceId || expired || staleHolder) {
        acquired = true;
        tx.set(ref, {
          owner: tickExitInstanceId,
          lease_until_ms: leaseUntil,
          heartbeat_at: new Date(now).toISOString(),
          heartbeat_ms: now,
        }, { merge: true });
      } else {
        acquired = false;
        holder = owner;
      }
    });
    return { ok: true, acquired, holder };
  } catch (e) {
    return { ok: false, acquired: false, error: e && e.message ? e.message : String(e) };
  }
}

async function releaseTickExitLease() {
  if (!TICK_EXIT_LEASE_ENABLED) return;
  try {
    const db = getFirestore();
    const ref = db.doc(TICK_EXIT_LEASE_DOC);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const owner = String(data.owner || "");
      if (owner !== tickExitInstanceId) return;
      tx.set(ref, {
        lease_until_ms: Date.now() - 1,
        released_at: new Date().toISOString(),
      }, { merge: true });
    });
  } catch (_) {}
}

async function heartbeatTickExitLease({ ttlMs = TICK_EXIT_LEASE_MIN_TTL_MS } = {}) {
  if (!TICK_EXIT_LEASE_ENABLED) return { ok: true, leaseDisabled: true };
  try {
    const db = getFirestore();
    const ref = db.doc(TICK_EXIT_LEASE_DOC);
    const now = Date.now();
    const leaseUntil = now + Math.max(ttlMs, TICK_EXIT_LEASE_MIN_TTL_MS);
    let ok = false;
    let holder = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const owner = String(data.owner || "");
      if (owner !== tickExitInstanceId) {
        holder = owner || null;
        return;
      }
      ok = true;
      tx.set(ref, {
        lease_until_ms: leaseUntil,
        heartbeat_at: new Date(now).toISOString(),
        heartbeat_ms: now,
      }, { merge: true });
    });
    return { ok, holder, leaseUntil };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

let loopTimer = null;
let loopRunning = false;
let loopStarted = false;

function startBinanceTickExitLoop() {
  if (loopStarted) return { ok: true, running: true };
  if (!env.tickExit || env.tickExit.enabled !== true) return { ok: false, skipped: true, reason: "DISABLED" };
  loopStarted = true;
  const intervalMs = normalizeIntervalMs(env.tickExit.intervalMs, 10000);
  const fastLaneEnabled = env.tickExit.fastLaneEnabled !== false;
  const fastLaneIntervalMs = normalizeIntervalMs(env.tickExit.fastLaneIntervalMs, 1000);
  const symbolCooldownMs = normalizeIntervalMs(env.tickExit.symbolCooldownMs, 20000);
  const leaseTtlMs = Math.max(intervalMs * 3, TICK_EXIT_LEASE_MIN_TTL_MS);
  const nearPct = Number(env.tickExit.nearPct || 0.003);
  const fastLanePct = Number(env.tickExit.fastLanePct || 0.003);
  let nextDelayMs = intervalMs;
  let fastLaneArmed = false;

  const loop = async () => {
    if (!loopStarted) return;
    if (loopRunning) {
      loopTimer = setTimeout(loop, nextDelayMs);
      return;
    }
    loopRunning = true;
    try {
      const lease = await acquireTickExitLease({ ttlMs: leaseTtlMs });
      if (!lease.ok) {
        console.warn("[TICK_EXIT_LEASE_FAIL]", lease.error || "UNKNOWN");
      }
      if (lease.ok && lease.acquired !== true) {
        const now = Date.now();
        if ((now - leaseSkippedLogAt) >= TICK_EXIT_LEASE_LOG_COOLDOWN_MS) {
          leaseSkippedLogAt = now;
          structuredLog("tick_exit_skipped_by_lease", {
            owner: lease.holder || null,
            instance: tickExitInstanceId,
          });
        }
      } else {
        const heartbeatEveryMs = Math.max(1000, Math.floor(leaseTtlMs / 3));
        let heartbeatTimer = null;
        try {
          heartbeatTimer = setInterval(() => {
            heartbeatTickExitLease({ ttlMs: leaseTtlMs }).catch(() => {});
          }, heartbeatEveryMs);
          const result = await runBinanceTickExitOnce({ nearPct, symbolCooldownMs });
          const heartbeat = await heartbeatTickExitLease({ ttlMs: leaseTtlMs });
          if (!heartbeat.ok) {
            structuredLog("tick_exit_lease_lost", {
              owner: heartbeat.holder || null,
              instance: tickExitInstanceId,
            }, "warn");
            result.self_heal = await runTickExitSelfHealPhase({
              reason: "TICK_EXIT_LOOP",
              leaseHeartbeatOk: false,
            });
            nextDelayMs = intervalMs;
          } else {
            result.self_heal = await runTickExitSelfHealPhase({
              reason: "TICK_EXIT_LOOP",
              leaseHeartbeatOk: true,
            });
            const useFastLane = fastLaneEnabled && result && result.fast_lane_active === true;
            nextDelayMs = useFastLane ? Math.min(intervalMs, fastLaneIntervalMs) : intervalMs;
            if (useFastLane !== fastLaneArmed) {
              fastLaneArmed = useFastLane;
              structuredLog(useFastLane ? "tick_exit_fastlane_on" : "tick_exit_fastlane_off", {
                interval_ms: nextDelayMs,
                base_interval_ms: intervalMs,
                fastlane_interval_ms: fastLaneIntervalMs,
                fastlane_pct: fastLanePct,
                symbols: Array.isArray(result && result.fast_lane_symbols) ? result.fast_lane_symbols : [],
              });
            }
          }
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }
    } catch (e) {
      const errText = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
      console.warn("[TICK_EXIT_FAIL]", errText);
      sendTickExitFailureAlert({
        symbol: null,
        error: errText,
        phase: "LOOP",
        position: null,
        price: null,
      }).catch(() => {});
    } finally {
      loopRunning = false;
      if (loopStarted) loopTimer = setTimeout(loop, nextDelayMs);
    }
  };

  loopTimer = setTimeout(loop, intervalMs);
  return {
    ok: true,
    running: true,
    intervalMs,
    symbolCooldownMs,
    leaseEnabled: TICK_EXIT_LEASE_ENABLED,
    fastLaneEnabled,
    fastLaneIntervalMs,
    fastLanePct,
  };
}

function stopBinanceTickExitLoop() {
  loopStarted = false;
  loopRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  symbolCooldownState.clear();
  symbolCooldownLogState.clear();
  pendingIntentState.clear();
  pendingIntentLogState.clear();
  nativeProtectionStateCache.clear();
  trailHardExitCooldownState.clear();
  releaseTickExitLease().catch(() => {});
  return { ok: true, running: false };
}

module.exports = {
  startBinanceTickExitLoop,
  stopBinanceTickExitLoop,
  runBinanceTickExitOnce,
  runBinanceTickExitBurst,
  __test: {
    buildTickTrailObservationDocUpdate,
    buildTickTrailReconcileRunId,
    runTickExitSelfHealPhase,
    heartbeatTickExitLease,
    computeExitTriggers,
    shouldCheckNear,
    collectTriggeredKinds,
    shouldActivateFastLane,
    applyTrailObservationToPosition,
    isNativeStopLessProtectiveThanTrigger,
    resolvePositionSignalTf,
    shouldBypassNativeProtectionCache,
    hasNativeStopProtection,
    hasNativeTpProtection,
    shouldTriggerTrailHardExit,
    shouldRunBySymbolCooldown,
    _symbolCooldownState: symbolCooldownState,
    shouldSendTickExitFailureAlert,
  },
};
