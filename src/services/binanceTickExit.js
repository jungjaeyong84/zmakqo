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
const { upsertIntent, markIntentStatus } = require("../storage/orderIntentsPaper");
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
const { getPositionReadView, getPositionReadViewsBySymbols } = require("./positionReadModel");
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

function normalizeTargetSymbols(targetSymbols = null) {
  const list = Array.isArray(targetSymbols)
    ? targetSymbols
    : (targetSymbols == null ? [] : [targetSymbols]);
  return Array.from(new Set(
    list
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function resolveTickExitSymbolsToCheck({ exCfg, targetSymbols = null } = {}) {
  const configuredSymbols = Array.from(new Set(
    (Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [])
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean)
  ));
  const requestedSymbols = normalizeTargetSymbols(targetSymbols);
  if (!requestedSymbols.length) return configuredSymbols;
  if (!configuredSymbols.length) return requestedSymbols;
  const configuredSet = new Set(configuredSymbols);
  return requestedSymbols.filter((symbol) => configuredSet.has(symbol));
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
  const canonical = resolveCanonicalPositionExitStage({
    positionSnapshot: pos,
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
const tpP1PendingTerminalAlertState = new Map();
const tpP1AckTimeoutAlertState = new Map();
const PENDING_INTENT_CHECK_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_PENDING_INTENT_TTL_MS, 3000);
const pendingIntentScopeScanLimitRaw = Number(process.env.TICK_EXIT_PENDING_INTENT_SCOPE_SCAN_LIMIT);
const PENDING_INTENT_SCOPE_SCAN_LIMIT = Number.isFinite(pendingIntentScopeScanLimitRaw)
  ? Math.max(20, Math.round(pendingIntentScopeScanLimitRaw))
  : 300;
const TICK_EXIT_LEASE_ENABLED = String(process.env.TICK_EXIT_LEASE_ENABLED || "1") !== "0";
const TICK_EXIT_LEASE_DOC = String(process.env.TICK_EXIT_LEASE_DOC || "runtime_locks/binance_tick_exit_loop");
const TICK_EXIT_LEASE_MIN_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_LEASE_MIN_TTL_MS, 30000);
const TICK_EXIT_LEASE_LOG_COOLDOWN_MS = 60 * 1000;
const TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS, 300000);
const TP_P1_PENDING_TERMINAL_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TP_P1_PENDING_TERMINAL_ALERT_COOLDOWN_MS, 300000);
const TP_P1_ACK_WATCHDOG_GRACE_MS = normalizeIntervalMs(process.env.TP_P1_ACK_WATCHDOG_GRACE_MS, 45000);
const TP_P1_ACK_TIMEOUT_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TP_P1_ACK_TIMEOUT_ALERT_COOLDOWN_MS, 300000);
const tickExitInstanceId = [
  String(process.env.K_REVISION || process.env.HOSTNAME || os.hostname() || "local"),
  String(process.pid || "0"),
].join("__");
let leaseSkippedLogAt = 0;
const tickExitFailureAlertState = new Map();
const nativeProtectionStateCache = new Map();
const nativeProtectionRefreshAttemptState = new Map();
const trailHardExitCooldownState = new Map();
const TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS, 10000);
const TICK_EXIT_NATIVE_PROTECTION_REFRESH_COOLDOWN_MS = normalizeIntervalMs(process.env.TICK_EXIT_NATIVE_PROTECTION_REFRESH_COOLDOWN_MS, 3000);
const TICK_EXIT_HARD_EXIT_COOLDOWN_MS = normalizeIntervalMs(process.env.TICK_EXIT_HARD_EXIT_COOLDOWN_MS, 60000);
const BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS = normalizeIntervalMs(process.env.BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS, 5 * 60 * 1000);
let lastTickExitSelfHealAt = 0;

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

function shouldRunNativeProtectionRefreshCooldown({ symbol, now = nowMs(), cooldownMs = TICK_EXIT_NATIVE_PROTECTION_REFRESH_COOLDOWN_MS } = {}) {
  const key = String(symbol || "").toUpperCase();
  if (!key) return false;
  const current = Number(now);
  if (!Number.isFinite(current)) return false;
  const cooldown = Math.max(1000, Number(cooldownMs) || TICK_EXIT_NATIVE_PROTECTION_REFRESH_COOLDOWN_MS);
  const last = Number(nativeProtectionRefreshAttemptState.get(key));
  if (Number.isFinite(last) && (current - last) < cooldown) return false;
  nativeProtectionRefreshAttemptState.set(key, current);
  return true;
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
  const nextMeta = {
    ...meta,
    trail_high: snapshot.trail_high,
    trail_high_at_ms: snapshot.trail_high_at_ms,
    trail_low: snapshot.trail_low,
    trail_low_at_ms: snapshot.trail_low_at_ms,
    ...(snapshot.entry_r_distance != null || meta.entry_r_distance != null
      ? { entry_r_distance: snapshot.entry_r_distance ?? meta.entry_r_distance }
      : {}),
    ...(snapshot.trail_r_multiple != null || meta.trail_r_multiple != null
      ? { trail_r_multiple: snapshot.trail_r_multiple ?? meta.trail_r_multiple }
      : {}),
    ...(snapshot.runner_floor_stop != null || meta.runner_floor_stop != null
      ? { runner_floor_stop: snapshot.runner_floor_stop ?? meta.runner_floor_stop }
      : {}),
    ...(snapshot.trail_stop_by_r != null || snapshot.r_based_trail_stop != null || meta.trail_stop_by_r != null || meta.r_based_trail_stop != null
      ? {
        trail_stop_by_r: snapshot.trail_stop_by_r ?? snapshot.r_based_trail_stop ?? meta.trail_stop_by_r ?? meta.r_based_trail_stop,
        r_based_trail_stop: snapshot.r_based_trail_stop ?? snapshot.trail_stop_by_r ?? meta.r_based_trail_stop ?? meta.trail_stop_by_r,
      }
      : {}),
    ...(snapshot.trail_stop_by_pct != null || meta.trail_stop_by_pct != null
      ? { trail_stop_by_pct: snapshot.trail_stop_by_pct ?? meta.trail_stop_by_pct }
      : {}),
    ...(snapshot.chosen_stop_source || meta.chosen_stop_source
      ? { chosen_stop_source: snapshot.chosen_stop_source ?? meta.chosen_stop_source }
      : {}),
    ...(snapshot.chosen_stop_price != null || meta.chosen_stop_price != null
      ? { chosen_stop_price: snapshot.chosen_stop_price ?? meta.chosen_stop_price }
      : {}),
    ...(snapshot.final_effective_stop != null || meta.final_effective_stop != null
      ? { final_effective_stop: snapshot.final_effective_stop ?? meta.final_effective_stop }
      : {}),
    ...(snapshot.native_stop_price != null || meta.native_protection_stop_price != null
      ? { native_protection_stop_price: snapshot.native_stop_price ?? meta.native_protection_stop_price }
      : {}),
    ...((snapshot.native_stop_order_id || meta.native_protection_stop_order_id)
      ? { native_protection_stop_order_id: snapshot.native_stop_order_id ?? meta.native_protection_stop_order_id }
      : {}),
    ...((snapshot.native_refresh_status || meta.native_protection_refresh_status)
      ? { native_protection_refresh_status: snapshot.native_refresh_status ?? meta.native_protection_refresh_status }
      : {}),
  };
  return {
    ...position,
    meta: nextMeta,
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

async function syncTickExitTrailObservation({
  exchange = "BINANCEFUT",
  symbol,
  position = null,
  rules = null,
  nativeProtection = null,
  runtimeEvalAtMs = null,
  source = "TICK_EXIT",
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  if (!pos) return null;
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const canonicalStage = resolveCanonicalExitStageForPosition(pos);
  if (!hasCanonicalTpP1Reached(canonicalStage) && meta.tp_p1_pending !== true) return null;
  const side = resolvePositionSideFromPosition(pos, meta, "LONG");
  const exitRules = rules || resolveExitRulesForPosition({ exchange, position: pos });
  const runnerExit = computeRunnerExitStopPrice({
    avg: Number(pos && pos.avg_price),
    leverageEff: Number(meta && (meta.external_leverage || meta.leverage || pos.leverage || 1)),
    side,
    rules: exitRules,
    tpP1Done: hasCanonicalTpP1Reached(canonicalStage),
    trailActive: isCanonicalTrailStage(canonicalStage),
    trailHigh: meta && Number.isFinite(Number(meta.trail_high)) ? Number(meta.trail_high) : null,
    trailLow: meta && Number.isFinite(Number(meta.trail_low)) ? Number(meta.trail_low) : null,
    entryRDistance: Number(meta && meta.entry_r_distance),
  });
  const refresh = nativeProtection && typeof nativeProtection === "object" ? nativeProtection : null;
  const nativeStopPrice = refresh && refresh.ok === true
    ? Number(refresh.stop_price)
    : (meta && Number.isFinite(Number(meta.native_protection_stop_price))
      ? Number(meta.native_protection_stop_price)
      : null);
  const nativeStopOrderId = refresh && refresh.ok === true
    ? (refresh.stop_order_id || null)
    : (meta && meta.native_protection_stop_order_id ? meta.native_protection_stop_order_id : null);
  const nativeRefreshStatus = refresh
    ? (refresh.ok === true
      ? "OK"
      : String(refresh.reason || "FAILED").trim().toUpperCase())
    : (meta && meta.native_protection_refresh_status ? meta.native_protection_refresh_status : null);
  const observedAtMs = nowMs();
  return upsertTrailObservation({
    exchange,
    symbol,
    side,
    entryEventId: meta && meta.entry_event_id ? meta.entry_event_id : null,
    entryExecBarMs: meta && Number.isFinite(Number(meta.entry_exec_bar_ms))
      ? Number(meta.entry_exec_bar_ms)
      : null,
    entryPrice: Number(pos && pos.avg_price),
    entryRDistance: meta && Number.isFinite(Number(meta.entry_r_distance))
      ? Number(meta.entry_r_distance)
      : null,
    trailRMultiple: Number(exitRules && exitRules.TRAIL_R_MULTIPLE),
    trailHigh: meta && Number.isFinite(Number(meta.trail_high)) ? Number(meta.trail_high) : null,
    trailHighAtMs: meta && Number.isFinite(Number(meta.trail_high_at_ms)) ? Number(meta.trail_high_at_ms) : null,
    trailLow: meta && Number.isFinite(Number(meta.trail_low)) ? Number(meta.trail_low) : null,
    trailLowAtMs: meta && Number.isFinite(Number(meta.trail_low_at_ms)) ? Number(meta.trail_low_at_ms) : null,
    runnerFloorStop: Number(runnerExit && runnerExit.runnerFloorStop),
    computedTrailStop: Number(runnerExit && runnerExit.stopPrice),
    trailStopRaw: Number(runnerExit && runnerExit.trailStop),
    trailStopByR: Number(runnerExit && runnerExit.trailStopByR),
    trailStopByPct: Number(runnerExit && runnerExit.trailStopByPct),
    chosenStopSource: runnerExit && runnerExit.stopSource ? runnerExit.stopSource : null,
    chosenStopPrice: Number(runnerExit && runnerExit.stopPrice),
    finalEffectiveStop: Number(runnerExit && runnerExit.stopPrice),
    nativeStopPrice: Number.isFinite(nativeStopPrice) ? nativeStopPrice : null,
    nativeStopOrderId,
    nativeRefreshStatus,
    lastRepriceAtMs: observedAtMs,
    runtimeEvalAtMs: Number.isFinite(Number(runtimeEvalAtMs)) ? Number(runtimeEvalAtMs) : observedAtMs,
    source,
  });
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

function isTpP1IntentEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  return ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_");
}

function isTpP1PendingTerminalFailureIntent(intent = {}) {
  const status = String(intent && intent.status || "").trim().toUpperCase();
  if (status !== "CANCELED") return false;
  const terminalFailureStatus = String(intent && intent.terminal_failure_status || "").trim().toUpperCase();
  const statusFamily = String(intent && intent.status_family || "").trim().toUpperCase();
  const cancelReason = String(intent && intent.cancel_reason || "").trim().toUpperCase();
  const statusReason = String(intent && intent.status_reason || "").trim().toUpperCase();
  const decisionReason = String(intent && intent.decision_reason || intent.reason || "").trim().toUpperCase();
  const reasons = [terminalFailureStatus, statusFamily, cancelReason, statusReason, decisionReason].filter(Boolean);
  return reasons.some((reason) => reason === "FAILED_INTERNAL" || reason === "LIVE_FAILED" || reason === "LIVE_EXCEPTION" || reason.startsWith("LIVE_"));
}

function buildTpP1PendingTerminalAlertPayload({
  symbol,
  tf,
  pendingEvent,
  pendingAtMs,
  pendingUntilMs,
  intent = {},
} = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const lines = [
    "reason: TP1_PENDING_TERMINAL_LIVE_FAILURE",
    "phase: TP1_PENDING_WATCHDOG",
    `symbol: ${normalizedSymbol}`,
    `tf: ${String(tf || "-")}`,
    `pending_event: ${String(pendingEvent || "EXIT_TP_P1")}`,
    `intent_id: ${String(intent.intent_id || intent.id || "N/A")}`,
    `status: ${String(intent.status || "UNKNOWN").toUpperCase() || "UNKNOWN"}`,
    `status_reason: ${String(intent.status_reason || intent.cancel_reason || intent.decision_reason || intent.reason || "UNKNOWN").toUpperCase() || "UNKNOWN"}`,
  ];
  if (Number.isFinite(Number(pendingAtMs))) lines.push(`pending_at_utc: ${new Date(Number(pendingAtMs)).toISOString()}`);
  if (Number.isFinite(Number(pendingUntilMs))) lines.push(`pending_until_utc: ${new Date(Number(pendingUntilMs)).toISOString()}`);
  if (intent.last_error) lines.push(`error: ${String(intent.last_error).slice(0, 240)}`);
  return {
    title: `[P0] ${normalizedSymbol} TP1 pending terminal failure`,
    body: lines.join("\n"),
    severity: "ERROR",
  };
}

function shouldSendTpP1PendingTerminalAlert({ symbol, intentId, reason } = {}) {
  const key = [
    String(symbol || "").trim().toUpperCase() || "UNKNOWN",
    String(intentId || "").trim() || "NA",
    String(reason || "").trim().toUpperCase() || "UNKNOWN",
  ].join(":");
  const now = nowMs();
  const last = Number(tpP1PendingTerminalAlertState.get(key));
  if (Number.isFinite(last) && (now - last) < TP_P1_PENDING_TERMINAL_ALERT_COOLDOWN_MS) return false;
  tpP1PendingTerminalAlertState.set(key, now);
  return true;
}

function resolveTpP1AckWatchdogDecision({ meta = null, intent = null, now = Date.now(), graceMs = TP_P1_ACK_WATCHDOG_GRACE_MS } = {}) {
  const positionMeta = (meta && typeof meta === "object") ? meta : {};
  if (positionMeta.tp_p1_pending !== true) {
    return { timedOut: false, reason: "TP1_PENDING_INACTIVE" };
  }
  if (!intent || typeof intent !== "object") {
    return { timedOut: false, reason: "TP1_INTENT_MISSING" };
  }
  const status = String(intent.status || "").trim().toUpperCase();
  if (status !== "PENDING") {
    return { timedOut: false, reason: "TP1_INTENT_NOT_PENDING", status };
  }
  const ackAtMsRaw = Number(intent.live_submit_ack_at_ms);
  const ackAtMs = Number.isFinite(ackAtMsRaw) && ackAtMsRaw > 0 ? ackAtMsRaw : null;
  const startedAtMsRaw = Number(intent.live_submit_started_at_ms);
  const startedAtMs = Number.isFinite(startedAtMsRaw) && startedAtMsRaw > 0 ? startedAtMsRaw : null;
  const orderId = intent.live_submit_order_id != null ? String(intent.live_submit_order_id).trim() : "";
  const clientOrderId = intent.live_submit_client_order_id != null ? String(intent.live_submit_client_order_id).trim() : "";
  if (Number.isFinite(ackAtMs) || orderId || clientOrderId) {
    return {
      timedOut: false,
      reason: "TP1_ALREADY_ACKED",
      status,
      startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
      ackAtMs: Number.isFinite(ackAtMs) ? ackAtMs : null,
      liveSubmitState: String(intent.live_submit_state || "").trim().toUpperCase() || null,
      orderId: orderId || null,
      clientOrderId: clientOrderId || null,
    };
  }
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return {
      timedOut: false,
      reason: "TP1_SUBMIT_NOT_STARTED",
      status,
      liveSubmitState: String(intent.live_submit_state || "").trim().toUpperCase() || null,
    };
  }
  const refNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const grace = Math.max(1000, Number(graceMs) || TP_P1_ACK_WATCHDOG_GRACE_MS);
  const elapsedMs = Math.max(0, refNow - startedAtMs);
  return {
    timedOut: elapsedMs > grace,
    reason: elapsedMs > grace ? "TP1_ACK_TIMEOUT" : "TP1_ACK_PENDING",
    status,
    startedAtMs,
    ackAtMs: null,
    elapsedMs,
    graceMs: grace,
    liveSubmitState: String(intent.live_submit_state || "").trim().toUpperCase() || null,
    orderId: null,
    clientOrderId: null,
  };
}

function buildTpP1AckTimeoutAlertPayload({
  symbol,
  tf,
  pendingEvent,
  pendingAtMs,
  intent = {},
  decision = {},
} = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const lines = [
    "reason: TP1_ACK_TIMEOUT",
    "phase: TP1_ACK_WATCHDOG",
    `symbol: ${normalizedSymbol}`,
    `tf: ${String(tf || "-")}`,
    `pending_event: ${String(pendingEvent || "EXIT_TP_P1")}`,
    `intent_id: ${String(intent.intent_id || intent.id || "N/A")}`,
    `status: ${String(intent.status || "UNKNOWN").toUpperCase() || "UNKNOWN"}`,
    `live_submit_state: ${String(decision.liveSubmitState || intent.live_submit_state || "UNKNOWN").toUpperCase() || "UNKNOWN"}`,
    `grace_ms: ${Number.isFinite(Number(decision.graceMs)) ? Number(decision.graceMs) : TP_P1_ACK_WATCHDOG_GRACE_MS}`,
  ];
  if (Number.isFinite(Number(pendingAtMs))) lines.push(`pending_at_utc: ${new Date(Number(pendingAtMs)).toISOString()}`);
  if (Number.isFinite(Number(decision.startedAtMs))) lines.push(`submit_started_at_utc: ${new Date(Number(decision.startedAtMs)).toISOString()}`);
  if (Number.isFinite(Number(decision.elapsedMs))) lines.push(`elapsed_ms: ${Math.round(Number(decision.elapsedMs))}`);
  if (intent.live_submit_error) lines.push(`submit_error: ${String(intent.live_submit_error).slice(0, 240)}`);
  if (intent.last_error) lines.push(`last_error: ${String(intent.last_error).slice(0, 240)}`);
  return {
    title: `[P0] ${normalizedSymbol} TP1 submit ACK timeout`,
    body: lines.join("\n"),
    severity: "ERROR",
  };
}

function shouldSendTpP1AckTimeoutAlert({ symbol, intentId, reason } = {}) {
  const key = [
    String(symbol || "").trim().toUpperCase() || "UNKNOWN",
    String(intentId || "").trim() || "NA",
    String(reason || "").trim().toUpperCase() || "UNKNOWN",
  ].join(":");
  const now = nowMs();
  const last = Number(tpP1AckTimeoutAlertState.get(key));
  if (Number.isFinite(last) && (now - last) < TP_P1_ACK_TIMEOUT_ALERT_COOLDOWN_MS) return false;
  tpP1AckTimeoutAlertState.set(key, now);
  return true;
}

async function loadLatestTpP1IntentForScope({ exchange, symbol, tf } = {}) {
  const scope = intentScopeKey(exchange, symbol, tf);
  if (!scope) return null;
  const db = getFirestore();
  const rows = [];
  const collectRows = (snap) => {
    if (!snap || snap.empty) return;
    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (String(data.intent_scope || "") !== scope) return;
      if (!isTpP1IntentEvent(data.event)) return;
      rows.push({
        id: doc.id,
        intent_id: data.intent_id || doc.id,
        event: data.event || null,
        status: data.status || null,
        status_family: data.status_family || null,
        terminal_failure_status: data.terminal_failure_status || null,
        status_reason: data.status_reason || null,
        cancel_reason: data.cancel_reason || null,
        decision_reason: data.decision_reason || data.reason || null,
        last_error: data.last_error || null,
        live_submit_state: data.live_submit_state || null,
        live_submit_started_at_ms: data.live_submit_started_at_ms ?? null,
        live_submit_finished_at_ms: data.live_submit_finished_at_ms ?? null,
        live_submit_ack_at_ms: data.live_submit_ack_at_ms ?? null,
        live_submit_order_id: data.live_submit_order_id || null,
        live_submit_client_order_id: data.live_submit_client_order_id || null,
        live_submit_exception_family: data.live_submit_exception_family || null,
        live_submit_error: data.live_submit_error || null,
        updated_at: data.updated_at || null,
        created_at: data.created_at || null,
      });
    });
  };

  try {
    const orderedSnap = await db.collection("order_intents_paper")
      .where("intent_scope", "==", scope)
      .orderBy("updated_at", "desc")
      .limit(20)
      .get();
    collectRows(orderedSnap);
  } catch (_) {}

  if (!rows.length) {
    try {
      const fallbackSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .limit(Math.max(20, PENDING_INTENT_SCOPE_SCAN_LIMIT))
        .get();
      collectRows(fallbackSnap);
    } catch (_) {}
  }

  if (!rows.length) return null;
  rows.sort((a, b) => {
    const ta = Date.parse(String(a.updated_at || a.created_at || 0)) || 0;
    const tb = Date.parse(String(b.updated_at || b.created_at || 0)) || 0;
    return tb - ta;
  });
  return rows[0];
}

async function sendTpP1PendingTerminalAlert({
  symbol,
  tf,
  pendingEvent,
  pendingAtMs,
  pendingUntilMs,
  intent,
} = {}) {
  const reason = String(intent && (intent.status_reason || intent.cancel_reason || intent.decision_reason || intent.reason) || "UNKNOWN")
    .trim()
    .toUpperCase() || "UNKNOWN";
  if (!shouldSendTpP1PendingTerminalAlert({
    symbol,
    intentId: intent && (intent.intent_id || intent.id),
    reason,
  })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
  const payload = buildTpP1PendingTerminalAlertPayload({
    symbol,
    tf,
    pendingEvent,
    pendingAtMs,
    pendingUntilMs,
    intent,
  });
  try {
    return await sendAlert({
      channel,
      title: payload.title,
      body: payload.body,
      severity: payload.severity,
    });
  } catch (err) {
    console.warn("[TP1_PENDING_TERMINAL_ALERT_FAIL]", err && err.message ? err.message : String(err));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

async function sendTpP1AckTimeoutAlert({
  symbol,
  tf,
  pendingEvent,
  pendingAtMs,
  intent,
  decision,
} = {}) {
  if (!shouldSendTpP1AckTimeoutAlert({
    symbol,
    intentId: intent && (intent.intent_id || intent.id),
    reason: "TP1_ACK_TIMEOUT",
  })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
  const payload = buildTpP1AckTimeoutAlertPayload({
    symbol,
    tf,
    pendingEvent,
    pendingAtMs,
    intent,
    decision,
  });
  try {
    return await sendAlert({
      channel,
      title: payload.title,
      body: payload.body,
      severity: payload.severity,
    });
  } catch (err) {
    console.warn("[TP1_ACK_TIMEOUT_ALERT_FAIL]", err && err.message ? err.message : String(err));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
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

async function clearTerminalFailedTpP1Pending({ pos, symbol, tf, now } = {}) {
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  if (meta.tp_p1_pending !== true) return false;
  if (meta.tp_p1_done === true || meta.trail_active === true) return false;

  const latestIntent = await loadLatestTpP1IntentForScope({
    exchange: "BINANCEFUT",
    symbol,
    tf,
  });
  if (!latestIntent || !isTpP1IntentEvent(latestIntent.event) || !isTpP1PendingTerminalFailureIntent(latestIntent)) {
    return false;
  }

  const pendingAtMs = Number(meta.tp_p1_pending_at_ms);
  const pendingUntilMs = Number(meta.tp_p1_pending_until_ms);
  const refNow = Number.isFinite(now) ? now : Date.now();
  const clearedAt = new Date(refNow).toISOString();
  const clearedReason = "PENDING_TERMINAL_LIVE_FAILURE";
  const cleared = await clearTpP1PendingIfUnchanged({
    exchange: "BINANCEFUT",
    symbol,
    pendingAtMs: Number.isFinite(pendingAtMs) ? pendingAtMs : null,
    pendingUntilMs: Number.isFinite(pendingUntilMs) ? pendingUntilMs : null,
    pendingEvent: meta.tp_p1_pending_event || null,
    clearedAt,
    clearedReason,
  });
  if (!cleared || cleared.cleared !== true) return false;

  pendingIntentState.set(intentScopeKey("BINANCEFUT", symbol, tf), { checkedAt: refNow, hasPending: false });
  pos.meta = {
    ...meta,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_pending_cleared_at: clearedAt,
    tp_p1_pending_cleared_reason: clearedReason,
  };

  structuredLog("tick_exit_tp1_pending_terminal_failure", {
    exchange: "BINANCEFUT",
    symbol: String(symbol || "").toUpperCase(),
    tf: String(tf || ""),
    intent_id: latestIntent.intent_id || null,
    status: String(latestIntent.status || "").toUpperCase() || null,
    status_reason: String(latestIntent.status_reason || latestIntent.cancel_reason || latestIntent.decision_reason || "").toUpperCase() || null,
  }, "warn");

  await sendTpP1PendingTerminalAlert({
    symbol,
    tf,
    pendingEvent: meta.tp_p1_pending_event || null,
    pendingAtMs,
    pendingUntilMs,
    intent: latestIntent,
  });
  return true;
}

async function clearUnackedTpP1Pending({ pos, symbol, tf, now } = {}) {
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  if (meta.tp_p1_pending !== true) return false;
  if (meta.tp_p1_done === true || meta.trail_active === true) return false;

  const latestIntent = await loadLatestTpP1IntentForScope({
    exchange: "BINANCEFUT",
    symbol,
    tf,
  });
  const decision = resolveTpP1AckWatchdogDecision({
    meta,
    intent: latestIntent,
    now,
  });
  if (!decision || decision.timedOut !== true || !latestIntent || !latestIntent.intent_id) return false;

  const pendingAtMs = Number(meta.tp_p1_pending_at_ms);
  const refNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const clearedAt = new Date(refNow).toISOString();
  const timeoutNote = `TP1 submit ACK timeout after ${Math.round(Number(decision.elapsedMs) || 0)}ms`;

  await markIntentStatus(latestIntent.intent_id, "CANCELED", {
    cancel_reason: "TP1_ACK_TIMEOUT",
    status_reason: "TP1_ACK_TIMEOUT",
    cancel_note: timeoutNote,
    last_error: latestIntent.last_error || latestIntent.live_submit_error || timeoutNote,
    live_submit_state: "ACK_TIMEOUT",
    live_submit_finished_at_ms: refNow,
    live_submit_exception_family: "ACK_TIMEOUT",
    live_submit_error: timeoutNote,
  });

  const clearedReason = "PENDING_SUBMIT_ACK_TIMEOUT";
  pendingIntentState.set(intentScopeKey("BINANCEFUT", symbol, tf), { checkedAt: refNow, hasPending: false });
  pos.meta = {
    ...meta,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_pending_cleared_at: clearedAt,
    tp_p1_pending_cleared_reason: clearedReason,
  };

  structuredLog("tick_exit_tp1_ack_timeout", {
    exchange: "BINANCEFUT",
    symbol: String(symbol || "").toUpperCase(),
    tf: String(tf || ""),
    intent_id: latestIntent.intent_id || null,
    live_submit_state: decision.liveSubmitState || latestIntent.live_submit_state || null,
    live_submit_started_at_ms: Number.isFinite(Number(decision.startedAtMs)) ? Number(decision.startedAtMs) : null,
    elapsed_ms: Number.isFinite(Number(decision.elapsedMs)) ? Number(decision.elapsedMs) : null,
    grace_ms: Number.isFinite(Number(decision.graceMs)) ? Number(decision.graceMs) : null,
  }, "warn");

  await sendTpP1AckTimeoutAlert({
    symbol,
    tf,
    pendingEvent: meta.tp_p1_pending_event || null,
    pendingAtMs,
    intent: latestIntent,
    decision,
  });
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

function shouldEagerRefreshNativeProtection({ pos, nativeProtectionState } = {}) {
  const position = pos && typeof pos === "object" ? pos : null;
  if (!position) return { needed: false, reason: "NO_POSITION" };
  const meta = position && typeof position.meta === "object" ? position.meta : {};
  const canonicalStage = resolveCanonicalExitStageForPosition(position);
  const tpP1Done = hasCanonicalTpP1Reached(canonicalStage);
  const tpP1Pending = meta.tp_p1_pending === true;
  const stopActive = nativeProtectionState && typeof nativeProtectionState.stopActive === "boolean"
    ? nativeProtectionState.stopActive
    : hasNativeStopProtection(meta);
  const tpActive = nativeProtectionState && typeof nativeProtectionState.tpActive === "boolean"
    ? nativeProtectionState.tpActive
    : hasNativeTpProtection(meta);
  const refreshStatus = String(meta.native_protection_refresh_status || "").trim().toUpperCase() || null;
  const needsStop = stopActive !== true;
  const needsTp = !tpP1Done && !tpP1Pending && tpActive !== true;
  return {
    needed: needsStop || needsTp,
    reason: refreshStatus || (needsStop ? "NATIVE_STOP_MISSING" : (needsTp ? "NATIVE_TP_MISSING" : "UP_TO_DATE")),
    needsStop,
    needsTp,
  };
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

async function runBinanceTickExitOnce({ nearPct, symbolCooldownMs, targetSymbols = null } = {}) {
  const exCfg = await getExchangeSettingsForProvider("BINANCEFUT", 2000);
  if (!exCfg || exCfg.enabled === false) return { ok: false, skipped: true, reason: "BINANCE_DISABLED" };
  const normalizedTargetSymbols = normalizeTargetSymbols(targetSymbols);
  const symbolsToCheck = resolveTickExitSymbolsToCheck({
    exCfg,
    targetSymbols: normalizedTargetSymbols,
  });
  if (!symbolsToCheck.length) {
    return {
      ok: false,
      skipped: true,
      reason: normalizedTargetSymbols.length ? "NO_TARGET_MARKETS" : "NO_MARKETS",
      target_symbols: normalizedTargetSymbols,
    };
  }

  const positionMap = await getPositionReadViewsBySymbols({
    exchange: "BINANCEFUT",
    symbols: symbolsToCheck,
  }).catch(() => ({}));
  const positions = symbolsToCheck.map((symbol) => positionMap[symbol] || null);
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
        await clearTerminalFailedTpP1Pending({ pos, symbol, tf: signalTf, now: tickNow });
      } catch (e) {
        structuredLog("tick_exit_clear_failed_tp1_pending_error", {
          exchange: "BINANCEFUT",
          symbol: String(symbol).toUpperCase(),
          error: String(e && e.message || e).slice(0, 200),
        }, "warn");
      }
      try {
        await clearUnackedTpP1Pending({ pos, symbol, tf: signalTf, now: tickNow });
      } catch (e) {
        structuredLog("tick_exit_clear_unacked_tp1_pending_error", {
          exchange: "BINANCEFUT",
          symbol: String(symbol).toUpperCase(),
          error: String(e && e.message || e).slice(0, 200),
        }, "warn");
      }
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
                writerSource: "BINANCE_TICK_EXIT",
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
      let effectivePos = applyTrailObservationToPosition({ pos, observation: trailObservation });
      let leverageEff = resolveLeverageEff(pos, "BINANCEFUT");
      let rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: effectivePos });
      let nativeProtectionState = await resolveLiveNativeProtectionState({ exCfg, symbol, pos: effectivePos });
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
      const eagerProtectionRefresh = shouldEagerRefreshNativeProtection({
        pos: effectivePos,
        nativeProtectionState,
      });
      let resolvedPosSide = resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG");
      if (eagerProtectionRefresh.needed && shouldRunNativeProtectionRefreshCooldown({ symbol, now: tickNow })) {
        let refreshed = null;
        try {
          const liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol });
          refreshed = await refreshBinanceNativeProtectionWithRetry({
            liveCfg,
            exchange: "BINANCEFUT",
            symbol,
            fallbackSide: resolvedPosSide === "SHORT" ? "SELL" : "BUY",
            fallbackEntryPrice: Number(effectivePos && effectivePos.avg_price),
            fallbackLeverage: Number(effectivePos && effectivePos.meta && (effectivePos.meta.external_leverage || effectivePos.meta.leverage || effectivePos.leverage || 1)),
            exitRulesOverride: effectivePos && effectivePos.meta && effectivePos.meta.exit_rules_override ? effectivePos.meta.exit_rules_override : null,
            posMeta: effectivePos.meta || {},
            writerSource: "BINANCE_TICK_EXIT",
          });
          structuredLog("tick_exit_native_protection_refresh", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            side: resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG"),
            needs_stop: eagerProtectionRefresh.needsStop === true,
            needs_tp: eagerProtectionRefresh.needsTp === true,
            refresh_reason: eagerProtectionRefresh.reason,
            refreshed: refreshed && refreshed.ok === true,
            refresh_result_reason: refreshed && refreshed.reason ? String(refreshed.reason) : null,
          });
        } catch (nativeRefreshErr) {
          structuredLog("tick_exit_native_protection_refresh_error", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            refresh_reason: eagerProtectionRefresh.reason,
            error: String(nativeRefreshErr && nativeRefreshErr.message || nativeRefreshErr).slice(0, 200),
          }, "warn");
        } finally {
          try {
            clearNativeProtectionStateCache(symbol);
            await syncFuturesPositionOnly({
              runId: buildTickTrailReconcileRunId(symbol, Date.now()),
              exchange: "BINANCEFUT",
              symbol,
              force: true,
            });
            trailObservation = await getPositionRuntimeObservation({
              exchange: "BINANCEFUT",
              symbol,
            }).catch(() => trailObservation);
            effectivePos = applyTrailObservationToPosition({
              pos: await getPositionReadView({
                exchange: "BINANCEFUT",
                symbol,
              }),
              observation: trailObservation,
            });
            leverageEff = resolveLeverageEff(effectivePos || pos, "BINANCEFUT");
            rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: effectivePos });
            nativeProtectionState = await resolveLiveNativeProtectionState({ exCfg, symbol, pos: effectivePos });
            resolvedPosSide = resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG");
            await syncTickExitTrailObservation({
              exchange: "BINANCEFUT",
              symbol,
              position: effectivePos,
              rules,
              nativeProtection: refreshed,
              runtimeEvalAtMs: tickNow,
              source: "TICK_EXIT_NATIVE_REFRESH",
            }).catch(() => null);
          } catch (_) {}
        }
      }
      const triggers = computeExitTriggers({ pos: effectivePos, rules, leverageEff, nativeProtectionState });
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
        let refreshed = null;
        try {
          const liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol });
          refreshed = await refreshBinanceNativeProtectionWithRetry({
            liveCfg,
            exchange: "BINANCEFUT",
            symbol,
            fallbackSide: resolvedPosSide === "SHORT" ? "SELL" : "BUY",
            fallbackEntryPrice: Number(effectivePos && effectivePos.avg_price),
            fallbackLeverage: Number(effectivePos && effectivePos.meta && (effectivePos.meta.external_leverage || effectivePos.meta.leverage || effectivePos.leverage || 1)),
            exitRulesOverride: effectivePos && effectivePos.meta && effectivePos.meta.exit_rules_override ? effectivePos.meta.exit_rules_override : null,
            posMeta: effectivePos.meta || {},
            writerSource: "BINANCE_TICK_EXIT",
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
            effectivePos = applyTrailObservationToPosition({
              pos: await getPositionReadView({
                exchange: "BINANCEFUT",
                symbol,
              }),
              observation: await getPositionRuntimeObservation({
                exchange: "BINANCEFUT",
                symbol,
              }).catch(() => trailObservation),
            });
            rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: effectivePos });
            nativeProtectionState = await resolveLiveNativeProtectionState({ exCfg, symbol, pos: effectivePos });
            resolvedPosSide = resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG");
            await syncTickExitTrailObservation({
              exchange: "BINANCEFUT",
              symbol,
              position: effectivePos,
              rules,
              nativeProtection: refreshed,
              runtimeEvalAtMs: tickNow,
              source: "TICK_EXIT_NATIVE_FLOOR_REFRESH",
            }).catch(() => null);
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
  targetSymbols = null,
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
  const normalizedTargetSymbols = normalizeTargetSymbols(targetSymbols);
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
        targetSymbols: normalizedTargetSymbols,
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
    target_symbols: normalizedTargetSymbols,
    last_result: lastResult,
    self_heal: selfHealResult,
  };
}

async function runTickExitSelfHealPhase({
  enabled = String(process.env.BINANCE_LIVE_STATE_SELF_HEAL_ENABLED || "1") !== "0",
  reason = "TICK_EXIT_LOOP",
  leaseHeartbeatOk = true,
  maxPositions = Math.max(1, Number(process.env.BINANCE_LIVE_STATE_SELF_HEAL_MAX_POSITIONS || 12)),
  cooldownMs = BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS,
  runSelfHeal = runBinanceLiveStateSelfHeal,
} = {}) {
  if (enabled !== true) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }
  if (leaseHeartbeatOk !== true) {
    return { ok: false, skipped: true, reason: "LEASE_LOST" };
  }
  const now = nowMs();
  const resolvedCooldownMs = Math.max(0, Number(cooldownMs) || 0);
  if (resolvedCooldownMs > 0 && Number.isFinite(lastTickExitSelfHealAt) && (now - lastTickExitSelfHealAt) < resolvedCooldownMs) {
    return {
      ok: true,
      skipped: true,
      reason: "COOLDOWN",
      cooldown_ms: resolvedCooldownMs,
      cooldown_remaining_ms: Math.max(0, resolvedCooldownMs - (now - lastTickExitSelfHealAt)),
    };
  }
  try {
    const result = await runSelfHeal({
      exchange: "BINANCEFUT",
      maxPositions,
      reason,
    });
    lastTickExitSelfHealAt = now;
    return result;
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
  tpP1PendingTerminalAlertState.clear();
  tpP1AckTimeoutAlertState.clear();
  nativeProtectionStateCache.clear();
  nativeProtectionRefreshAttemptState.clear();
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
    syncTickExitTrailObservation,
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
    shouldEagerRefreshNativeProtection,
    shouldRunNativeProtectionRefreshCooldown,
    shouldTriggerTrailHardExit,
    shouldRunBySymbolCooldown,
    normalizeTargetSymbols,
    resolveTickExitSymbolsToCheck,
    isTpP1IntentEvent,
    isTpP1PendingTerminalFailureIntent,
    resolveTpP1AckWatchdogDecision,
    buildTpP1PendingTerminalAlertPayload,
    shouldSendTpP1PendingTerminalAlert,
    buildTpP1AckTimeoutAlertPayload,
    shouldSendTpP1AckTimeoutAlert,
    _symbolCooldownState: symbolCooldownState,
    clearSelfHealCooldown() {
      lastTickExitSelfHealAt = 0;
    },
    shouldSendTickExitFailureAlert,
  },
};
