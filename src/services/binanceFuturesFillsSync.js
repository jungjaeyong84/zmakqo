const {
  fetchFuturesUserTrades,
  fetchFuturesOrder,
  fetchFuturesAlgoOrder,
  fetchBinanceFuturesAccount,
  fetchFuturesExchangeInfo,
  placeFuturesMarketOrder,
} = require("../exchanges/binanceFuturesPrivate");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { normalizeMarketSymbolForProvider, normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { getFirestore } = require("../storage/firestore");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { upsertExternalFill, markExternalFillUnverified } = require("../storage/fillsPaper");
const { getExitOrderContractByOrderId, markExitOrderContractConsumed } = require("../storage/exitOrderContracts");
const { getPosition, upsertPosition, upsertPositionMetaOnly } = require("../storage/positionsPaper");
const { upsertSameDirectionTrailProfitObservation, getPositionRuntimeObservation } = require("../storage/positionRuntimeObservations");
const { patchIntent } = require("../storage/orderIntentsPaper");
const { buildTradeId } = require("../storage/tradesPaper");
const { getExitRulesForExchange, resolveExitRulesForPosition } = require("../engine/signalEngine");
const {
  syncFuturesPositionOnly,
  resolveFuturesPositionSyncRequest,
  requestBinanceNativeProtectionRefresh,
} = require("../engine/paperBinanceRunner");
const { sendTradeExecutionAlert } = require("./tradeExecutionAlert");
const { triggerExitWorkerRun } = require("./exitWorkerClient");
const { getPositionReadView } = require("./positionReadModel");
const { sendAlert } = require("../utils/alerts");
const { resolvePositionSideFromPosition } = require("../utils/positionSide");
const { buildExitStageView } = require("../utils/exitStageView");
const { isIntentCanceledLikeStatus } = require("../utils/intentStatus");
const { deriveSignalDocId } = require("../utils/signalDocId");
const { inferTakeProfitKindFromQtyRatio } = require("./binancePositionReconciler");
const { isSimplifiedExitV2Active } = require("./simplifiedExitV2");
const { sendKoreanTelegramSummary } = require("../../scripts/lib/automation-utils");
const {
  resolveExitStageAbsoluteContractQtyRatio,
  resolveTp0ContractQtyRatio,
  resolveTp1RemainingContractQtyRatio,
} = require("../utils/exitQtyContract");
const { recordUnifiedEvent } = require("../storage/unifiedEventTimeline");
const { recordCanonicalExitTransitions } = require("../storage/canonicalExitTransitions");
const {
  buildExitQuantityContractLedger,
  resolveCanonicalExitWritePayload,
  validateExitQuantityContractLedger,
} = require("./positionStateMachine");
const {
  COLLECTION: EXIT_AUTHORITY_STATE_COLLECTION,
  mergeStates: mergeExitAuthorityStates,
  normalizeState: normalizeExitAuthorityState,
  persistExitAuthorityStates,
} = require("../storage/exitAuthorityState");

const DEFAULT_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MS = 3 * 60 * 1000;
const DEFAULT_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_INTENT_FUTURE_ALLOW_MS = 3000;
const DEFAULT_FILLED_INTENT_MATCH_GRACE_MS = 15 * 1000;
const BINANCE_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 - 1000;
const DEFAULT_ALERT_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_INTENT_RECOVERY_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const DEFAULT_INTENT_RECOVERY_SCAN_LIMIT = 600;
const DEFAULT_ADD_NATIVE_PROTECTION_REFRESH_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_FILLS_SYNC_LEASE_TTL_MS = 120000;
const DEFAULT_FILLS_SYNC_LEASE_WAIT_MS = 3000;

const syncState = {
  lastRunAt: 0,
};
const externalCloseAlertChannelCache = new Map();
const externalCloseAlertCooldownMap = new Map();
const immediateProjectionAlertState = new Map();
const fillSyncOverrideWarnState = new Map();
const fillSyncTradeAlertCooldownMap = new Map();
const fillsSyncLeaseHolderId = `fills_sync__${process.env.K_REVISION || process.env.HOSTNAME || "local"}__${process.pid}`;
const FILL_SYNC_OVERRIDE_WARN_TTL_MS = 5 * 60 * 1000;
const FILL_SYNC_TRADE_ALERT_COOLDOWN_MS = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function buildExitLedgerMetaPatch({
  position = null,
  nextMeta = null,
  rules = null,
} = {}) {
  const pos = position && typeof position === "object" ? position : {};
  const meta = nextMeta && typeof nextMeta === "object" ? nextMeta : {};
  const ledger = buildExitQuantityContractLedger({
    positionSnapshot: {
      qty_base: Number(pos.qty_base),
      entry_qty_base: pos.entry_qty_base ?? meta.entry_qty_base ?? meta.entry_qty_abs ?? null,
      meta,
    },
    rules: rules || null,
  });
  const simplifiedExitV2Enabled = isSimplifiedExitV2Enabled({
    position: pos,
    ...(meta && typeof meta === "object" ? meta : {}),
  });
  return {
    entry_qty_base: Number.isFinite(Number(ledger.entry_qty_abs)) ? Number(ledger.entry_qty_abs) : null,
    entry_qty_abs: Number.isFinite(Number(ledger.entry_qty_abs)) ? Number(ledger.entry_qty_abs) : null,
    tp_p0_allowed_qty_abs: simplifiedExitV2Enabled ? null : (Number.isFinite(Number(ledger.tp0_allowed_abs)) ? Number(ledger.tp0_allowed_abs) : null),
    tp_p0_consumed_qty_abs: simplifiedExitV2Enabled ? null : (Number.isFinite(Number(ledger.tp0_consumed_abs)) ? Number(ledger.tp0_consumed_abs) : null),
    tp_p1_allowed_qty_abs: Number.isFinite(Number(ledger.tp1_allowed_abs)) ? Number(ledger.tp1_allowed_abs) : null,
    tp_p1_consumed_qty_abs: Number.isFinite(Number(ledger.tp1_consumed_abs)) ? Number(ledger.tp1_consumed_abs) : null,
    runner_allowed_qty_abs: Number.isFinite(Number(ledger.runner_allowed_abs)) ? Number(ledger.runner_allowed_abs) : null,
    runner_remaining_qty_abs: Number.isFinite(Number(ledger.runner_remaining_abs)) ? Number(ledger.runner_remaining_abs) : null,
    canonical_runner_remaining_abs: Number.isFinite(Number(ledger.runner_remaining_abs)) ? Number(ledger.runner_remaining_abs) : null,
    trail_consumed_qty_abs: Number.isFinite(Number(ledger.trail_consumed_abs)) ? Number(ledger.trail_consumed_abs) : null,
    total_consumed_qty_abs: (
      Number.isFinite(Number(ledger.entry_qty_abs)) && Number.isFinite(Number(ledger.total_consumed_ratio))
    ) ? (Number(ledger.entry_qty_abs) * Number(ledger.total_consumed_ratio)) : null,
    tp_p0_allowed_qty_ratio: simplifiedExitV2Enabled ? null : (Number.isFinite(Number(ledger.tp0_allowed_ratio)) ? Number(ledger.tp0_allowed_ratio) : null),
    tp_p0_consumed_qty_ratio: simplifiedExitV2Enabled ? null : (Number.isFinite(Number(ledger.tp0_consumed_ratio)) ? Number(ledger.tp0_consumed_ratio) : null),
    tp_p1_allowed_qty_ratio: Number.isFinite(Number(ledger.tp1_allowed_ratio)) ? Number(ledger.tp1_allowed_ratio) : null,
    tp_p1_consumed_qty_ratio: Number.isFinite(Number(ledger.tp1_consumed_ratio)) ? Number(ledger.tp1_consumed_ratio) : null,
    runner_allowed_qty_ratio: Number.isFinite(Number(ledger.runner_allowed_ratio)) ? Number(ledger.runner_allowed_ratio) : null,
    runner_remaining_qty_ratio: Number.isFinite(Number(ledger.runner_remaining_ratio)) ? Number(ledger.runner_remaining_ratio) : null,
    trail_consumed_qty_ratio: Number.isFinite(Number(ledger.trail_consumed_ratio)) ? Number(ledger.trail_consumed_ratio) : null,
    total_consumed_qty_ratio: Number.isFinite(Number(ledger.total_consumed_ratio)) ? Number(ledger.total_consumed_ratio) : null,
  };
}

function buildExitLedgerPayload(ledger = null, observedQtyAbs = null, { simplifiedExitV2Enabled = false } = {}) {
  const source = ledger && typeof ledger === "object" ? ledger : {};
  return {
    contractEntryQtyAbs: Number.isFinite(Number(source.entry_qty_abs)) ? Number(source.entry_qty_abs) : null,
    contractTp0AllowedAbs: simplifiedExitV2Enabled ? null : (Number.isFinite(Number(source.tp0_allowed_abs)) ? Number(source.tp0_allowed_abs) : null),
    contractTp0ConsumedAbs: simplifiedExitV2Enabled ? null : (Number.isFinite(Number(source.tp0_consumed_abs)) ? Number(source.tp0_consumed_abs) : null),
    contractTp1AllowedAbs: Number.isFinite(Number(source.tp1_allowed_abs)) ? Number(source.tp1_allowed_abs) : null,
    contractTp1ConsumedAbs: Number.isFinite(Number(source.tp1_consumed_abs)) ? Number(source.tp1_consumed_abs) : null,
    contractRunnerAllowedAbs: Number.isFinite(Number(source.runner_allowed_abs)) ? Number(source.runner_allowed_abs) : null,
    contractRunnerRemainingAbs: Number.isFinite(Number(source.runner_remaining_abs)) ? Number(source.runner_remaining_abs) : null,
    contractTrailConsumedAbs: Number.isFinite(Number(source.trail_consumed_abs)) ? Number(source.trail_consumed_abs) : null,
    contractObservedQtyAbs: Number.isFinite(Number(observedQtyAbs)) ? Number(observedQtyAbs) : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePositionWriterAuthorityError(err) {
  const code = String(err && err.code || err && err.message || "").trim().toUpperCase();
  return code.includes("POSITION_WRITE_TOKEN_MISMATCH")
    || code.includes("POSITION_WRITE_LEASE_HELD")
    || code.includes("POSITION_WRITE_LEASE_LOST");
}

async function reconcileExternalFillPositionSync({
  exchange,
  symbol,
  maxAttempts = 2,
  retryDelayMs = 100,
  syncPosition = syncFuturesPositionOnly,
  buildSyncRequest = resolveFuturesPositionSyncRequest,
} = {}) {
  let lastErr = null;
  const totalAttempts = Math.max(1, Math.floor(Number(maxAttempts) || 0));
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await syncPosition(buildSyncRequest({
        source: "FILL_SYNC_RECONCILE",
        runId: `RUN__FILL_SYNC_RECONCILE__${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__A${attempt}__${Date.now()}`,
        exchange,
        symbol,
      }));
    } catch (err) {
      lastErr = err;
      if (!isRetryablePositionWriterAuthorityError(err) || attempt >= totalAttempts) throw err;
      await sleep(Math.max(0, Number(retryDelayMs) || 0));
    }
  }
  throw lastErr || new Error("FILL_SYNC_RECONCILE_FAILED");
}

function shouldLogFillSyncOverride({
  prefix,
  symbol,
  orderId,
  clientOrderId,
  detail,
  ttlMs = FILL_SYNC_OVERRIDE_WARN_TTL_MS,
} = {}) {
  const normalizedPrefix = String(prefix || "").trim().toUpperCase() || "FILL_SYNC_EVENT_OVERRIDE";
  const normalizedSymbol = normalizeSymbol(symbol) || "UNKNOWN";
  const normalizedOrderId = Number.isFinite(Number(orderId)) ? String(Number(orderId)) : "NA";
  const normalizedClientOrderId = String(clientOrderId || "").trim() || "NA";
  const normalizedDetail = String(detail || "").trim().toUpperCase() || "NA";
  const key = [
    normalizedPrefix,
    normalizedSymbol,
    normalizedOrderId,
    normalizedClientOrderId,
    normalizedDetail,
  ].join("|");
  const now = Date.now();
  const maxAgeMs = Math.max(1000, Number(ttlMs) || FILL_SYNC_OVERRIDE_WARN_TTL_MS);
  const cached = fillSyncOverrideWarnState.get(key);
  if (cached && Number.isFinite(cached.at) && (now - cached.at) < maxAgeMs) {
    cached.at = now;
    cached.repeatCount = Number(cached.repeatCount || 1) + 1;
    fillSyncOverrideWarnState.set(key, cached);
    return { log: false, key, repeatCount: cached.repeatCount };
  }
  fillSyncOverrideWarnState.set(key, { at: now, repeatCount: 1 });
  for (const [cacheKey, item] of fillSyncOverrideWarnState.entries()) {
    if (!item || !Number.isFinite(item.at) || (now - item.at) >= maxAgeMs) fillSyncOverrideWarnState.delete(cacheKey);
  }
  return { log: true, key, repeatCount: 1 };
}

function buildFillsSyncLeaseDocPath(symbol) {
  return `runtime_locks/fills_sync__BINANCEFUT__${normalizeSymbol(symbol) || "UNKNOWN"}`;
}

async function acquireFillsSyncLease({
  symbol,
  ttlMs = DEFAULT_FILLS_SYNC_LEASE_TTL_MS,
  holderId = fillsSyncLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || DEFAULT_FILLS_SYNC_LEASE_TTL_MS));
  const ref = db.doc(buildFillsSyncLeaseDocPath(symbol));
  let acquired = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const owner = String(data.owner || "");
    const leaseUntilMs = Number(data.lease_until_ms);
    const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
    if (!owner || owner === holderId || expired) {
      acquired = true;
      tx.set(ref, {
        owner: holderId,
        lease_until_ms: leaseUntil,
        heartbeat_ms: now,
        heartbeat_at: new Date(now).toISOString(),
      }, { merge: true });
      return;
    }
    holder = owner || null;
  });
  return { acquired, holder, leaseUntil, holderId };
}

async function heartbeatFillsSyncLease({
  symbol,
  ttlMs = DEFAULT_FILLS_SYNC_LEASE_TTL_MS,
  holderId = fillsSyncLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || DEFAULT_FILLS_SYNC_LEASE_TTL_MS));
  const ref = db.doc(buildFillsSyncLeaseDocPath(symbol));
  let ok = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    const owner = String(data.owner || "");
    if (owner !== String(holderId || "")) {
      holder = owner || null;
      return;
    }
    ok = true;
    tx.set(ref, {
      lease_until_ms: leaseUntil,
      heartbeat_ms: now,
      heartbeat_at: new Date(now).toISOString(),
    }, { merge: true });
  });
  return { ok, holder, leaseUntil, holderId };
}

async function releaseFillsSyncLease({
  symbol,
  holderId = fillsSyncLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const ref = db.doc(buildFillsSyncLeaseDocPath(symbol));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (String(data.owner || "") !== String(holderId || "")) return;
    tx.set(ref, {
      lease_until_ms: Date.now() - 1,
      released_at: new Date().toISOString(),
    }, { merge: true });
  });
}

async function runDistributedFillsSync({
  symbol,
  runner,
  leaseEnabled = resolveEnvBool(process.env.BINANCEFUT_FILLS_SYNC_LEASE_ENABLED, true),
  ttlMs = Number(process.env.BINANCEFUT_FILLS_SYNC_LEASE_TTL_MS) || DEFAULT_FILLS_SYNC_LEASE_TTL_MS,
  waitMs = Number(process.env.BINANCEFUT_FILLS_SYNC_LEASE_WAIT_MS) || DEFAULT_FILLS_SYNC_LEASE_WAIT_MS,
  acquireLease = acquireFillsSyncLease,
  heartbeatLease = heartbeatFillsSyncLease,
  releaseLease = releaseFillsSyncLease,
} = {}) {
  if (typeof runner !== "function") throw new Error("runDistributedFillsSync: runner required");
  if (leaseEnabled !== true) return runner();

  const deadline = Date.now() + Math.max(0, Math.floor(Number(waitMs) || 0));
  let lease = null;
  for (;;) {
    lease = await acquireLease({ symbol, ttlMs });
    if (lease && lease.acquired === true) break;
    if (Date.now() >= deadline) {
      return { ok: false, skipped: true, reason: "LEASE_HELD", symbol: normalizeSymbol(symbol), holder: lease && lease.holder ? lease.holder : null };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  let heartbeatLost = false;
  const heartbeatEveryMs = Math.max(1000, Math.floor(Math.max(3000, ttlMs) / 3));
  const timer = setInterval(() => {
    heartbeatLease({ symbol, ttlMs, holderId: lease.holderId })
      .then((res) => {
        if (!res || res.ok !== true) heartbeatLost = true;
      })
      .catch(() => {
        heartbeatLost = true;
      });
  }, heartbeatEveryMs);

  try {
    const heartbeat = await heartbeatLease({ symbol, ttlMs, holderId: lease.holderId });
    if (!heartbeat || heartbeat.ok !== true) {
      return { ok: false, skipped: true, reason: "LEASE_LOST", symbol: normalizeSymbol(symbol), holder: heartbeat && heartbeat.holder ? heartbeat.holder : null };
    }
    const result = await runner();
    if (heartbeatLost && result && typeof result === "object") {
      return { ...result, lease_lost_after_run: true };
    }
    return result;
  } finally {
    clearInterval(timer);
    await releaseLease({ symbol, holderId: lease && lease.holderId }).catch(() => {});
  }
}

function shouldAuditProjectionImmediately(event = "") {
  const ev = String(event || "").trim().toUpperCase();
  return ev.startsWith("EXIT_TP_P0") || ev.startsWith("EXIT_TP_P1") || ev.startsWith("EXIT_TRAIL") || ev.startsWith("EXIT_SL");
}

function isSettledFlatProjection(position = null) {
  const pos = position && typeof position === "object" ? position : {};
  const state = String(pos.state || pos.position_state || "").trim().toUpperCase();
  const qtyBase = Number(pos.qty_base);
  if (state === "FLAT") return true;
  if (Number.isFinite(qtyBase) && qtyBase <= 0) return true;
  return false;
}

function buildImmediateProjectionIssues({ event = "", position = null } = {}) {
  const ev = String(event || "").trim().toUpperCase();
  const pos = position && typeof position === "object" ? position : {};
  if (isSettledFlatProjection(pos)) return [];
  const meta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};
  const issues = [];
  if (ev.startsWith("EXIT_TP_P0") && meta.tp_p0_done !== true) issues.push("TP0_FILL_PROJECTION_MISSING");
  if (ev.startsWith("EXIT_TP_P1") && meta.tp_p1_done !== true) issues.push("TP1_FILL_PROJECTION_MISSING");
  if (ev.startsWith("EXIT_TRAIL") && meta.trail_active !== true) issues.push("TRAIL_FILL_PROJECTION_INACTIVE");
  const nativeStatus = String(meta.native_protection_refresh_status || "").trim().toUpperCase();
  if (nativeStatus && nativeStatus !== "OK") issues.push(`NATIVE_PROTECTION_${nativeStatus}`);
  return issues;
}

async function sendImmediateProjectionMismatchAlert({
  symbol,
  event,
  issues = [],
  position = null,
} = {}) {
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  const sym = normalizeSymbol(symbol);
  if (!sym || !Array.isArray(issues) || !issues.length) {
    return { ok: false, skipped: true, reason: "NO_ISSUES" };
  }
  const pos = position && typeof position === "object" ? position : {};
  const meta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};
  const dedupe = shouldSendImmediateProjectionMismatchAlert({
    symbol: sym,
    event,
    issues,
  });
  if (!dedupe.send) {
    return {
      ok: true,
      skipped: true,
      reason: "COOLDOWN",
      repeatCount: dedupe.repeatCount,
      dedupeKey: dedupe.key,
    };
  }
  return sendKoreanTelegramSummary({
    title: `[경고] ${sym} fill-projection 불일치`,
    severity: "WARN",
    provider: "BINANCEFUT",
    dedupeKey: `fill_projection_mismatch:${dedupe.key}`,
    dedupeWindowSec: 600,
    dedupeFingerprint: {
      event: String(event || "").trim().toUpperCase() || "UNKNOWN",
      issues,
      repeat_count: dedupe.repeatCount,
      state: String(pos.state || "NA").trim().toUpperCase() || "NA",
      qty_base: Number.isFinite(Number(pos.qty_base)) ? Number(pos.qty_base) : null,
      entry_event_id: String(meta.entry_event_id || meta.origin_entry_event_id || "").trim() || null,
    },
    sections: [
      {
        header: "Projection",
        lines: [
          `event=${String(event || "").trim().toUpperCase() || "UNKNOWN"}`,
          `issues=${issues.join(",")}`,
          `repeat_count=${dedupe.repeatCount}`,
          `tp0_done=${meta.tp_p0_done === true ? "1" : "0"}`,
          `tp1_done=${meta.tp_p1_done === true ? "1" : "0"}`,
          `trail_active=${meta.trail_active === true ? "1" : "0"}`,
          `native_status=${String(meta.native_protection_refresh_status || "NA").trim().toUpperCase() || "NA"}`,
        ],
      },
      {
        header: "Position",
        lines: [
          `state=${String(pos.state || "NA").trim().toUpperCase() || "NA"}`,
          `qty_base=${Number.isFinite(Number(pos.qty_base)) ? String(Number(pos.qty_base)) : "NA"}`,
          `entry_event_id=${String(meta.entry_event_id || meta.origin_entry_event_id || "NA").trim() || "NA"}`,
          `projection_invariants=${Array.isArray(meta.exchange_projection_invariants) && meta.exchange_projection_invariants.length ? meta.exchange_projection_invariants.join(",") : "NA"}`,
        ],
      },
    ],
  });
}

async function auditImmediateProjectionEvents({
  events = [],
  position = null,
  markUnverified = markExternalFillUnverified,
  sendAlert = sendImmediateProjectionMismatchAlert,
} = {}) {
  const list = Array.isArray(events) ? events : [];
  const results = [];
  for (const eventRow of list) {
    const issues = buildImmediateProjectionIssues({
      event: eventRow && eventRow.event,
      position,
    });
    if (!issues.length) {
      results.push({
        fillId: eventRow && eventRow.fillId ? eventRow.fillId : null,
        event: eventRow && eventRow.event ? eventRow.event : null,
        audited: true,
        unverified: false,
        issues: [],
      });
      continue;
    }
    if (eventRow && eventRow.fillId) {
      await markUnverified({
        fillId: eventRow.fillId,
        event: eventRow.event,
        issues,
      });
    }
    await sendAlert({
      symbol: eventRow && eventRow.symbol,
      event: eventRow && eventRow.event,
      issues,
      position,
    });
    results.push({
      fillId: eventRow && eventRow.fillId ? eventRow.fillId : null,
      event: eventRow && eventRow.event ? eventRow.event : null,
      audited: true,
      unverified: true,
      issues: issues.slice(),
    });
  }
  return {
    ok: true,
    audited_n: results.length,
    unverified_n: results.filter((row) => row.unverified).length,
    results,
  };
}

async function auditProjectionEventImmediately({
  exchange = "BINANCEFUT",
  symbol,
  eventRow = null,
  syncPosition = syncFuturesPositionOnly,
  resolveSyncRequest = resolveFuturesPositionSyncRequest,
  getPositionFn = getPosition,
  auditProjectionEvents = auditImmediateProjectionEvents,
} = {}) {
  const sym = normalizeSymbol(symbol || (eventRow && eventRow.symbol));
  if (!sym || !eventRow) return { ok: false, skipped: true, reason: "INVALID_EVENT" };
  let position = null;
  try {
    await syncPosition(resolveSyncRequest({
      source: "FILL_SYNC_AUDIT",
      runId: `RUN__FILL_SYNC_AUDIT__BINANCEFUT__${sym}__${Number(eventRow.tradeMs || Date.now())}`,
      exchange,
      symbol: sym,
      force: true,
    }));
  } catch (_) {
    position = null;
  }
  position = await getPositionFn({ exchange, symbol: sym });
  return auditProjectionEvents({
    events: [{ ...eventRow, symbol: sym }],
    position,
  });
}

function shouldSendImmediateProjectionMismatchAlert({ symbol, event, issues = [], nowMs = Date.now() } = {}) {
  const sym = normalizeSymbol(symbol);
  const ev = String(event || "").trim().toUpperCase() || "UNKNOWN";
  const issueKey = Array.isArray(issues) ? issues.map((v) => String(v || "").trim().toUpperCase()).filter(Boolean).sort().join(",") : "";
  const key = `${sym || "UNKNOWN"}|${ev}|${issueKey || "NA"}`;
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const prev = immediateProjectionAlertState.get(key);
  if (!prev || !Number.isFinite(prev.firstAtMs) || (now - prev.firstAtMs) > (10 * 60 * 1000)) {
    const next = { firstAtMs: now, lastAtMs: now, repeatCount: 1 };
    immediateProjectionAlertState.set(key, next);
    return { send: true, key, repeatCount: 1, firstAtMs: now, lastAtMs: now };
  }
  const repeatCount = Number.isFinite(prev.repeatCount) ? (prev.repeatCount + 1) : 2;
  const next = { firstAtMs: prev.firstAtMs, lastAtMs: now, repeatCount };
  immediateProjectionAlertState.set(key, next);
  const shouldSend = repeatCount === 3 || repeatCount === 10 || repeatCount % 25 === 0;
  return { send: shouldSend, key, repeatCount, firstAtMs: prev.firstAtMs, lastAtMs: now };
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

  await upsertSameDirectionTrailProfitObservation({
    exchange,
    symbol,
    exitDir: dir,
    exitWallMs: execMs,
    exitEvent: ev,
    realizedPnl: pnl,
    source: "BINANCE_USER_TRADES",
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

function qtyPrecision(step) {
  const s = String(step == null ? "" : step);
  const idx = s.indexOf(".");
  return idx === -1 ? 0 : (s.length - idx - 1);
}

function roundQtyToStep(qty, step) {
  const q = Number(qty);
  const s = Number(step);
  if (!Number.isFinite(q) || !Number.isFinite(s) || s <= 0) return null;
  const floored = Math.floor(q / s) * s;
  return Number(floored.toFixed(qtyPrecision(s)));
}

function resolveTinyResidualCloseDecision({ position = null, exchangeInfo = null } = {}) {
  const pos = position && typeof position === "object" ? position : {};
  const info = exchangeInfo && typeof exchangeInfo === "object" ? exchangeInfo : {};
  const amt = Number(pos.positionAmt ?? pos.position_amt);
  const absQty = Math.abs(amt);
  const minQty = Number(info.minQty);
  const markPrice = Number(pos.markPrice ?? pos.mark_price ?? pos.entryPrice ?? pos.entry_price);
  const minNotional = Number(info.minNotional);
  const side = amt < 0 ? "BUY" : (amt > 0 ? "SELL" : null);
  const stepSize = Number(info.stepSize);
  const roundedQty = roundQtyToStep(absQty, stepSize);
  const notional = Number.isFinite(markPrice) && Number.isFinite(roundedQty) ? markPrice * roundedQty : null;
  const tinyByQty = Number.isFinite(minQty) && Number.isFinite(roundedQty) && roundedQty > 0 && roundedQty <= minQty;
  const tinyByNotional = Number.isFinite(minNotional) && Number.isFinite(notional) && notional > 0 && notional < minNotional;
  if (!side || !Number.isFinite(roundedQty) || roundedQty <= 0) {
    return { shouldClose: false, side: null, qty: null, reason: "NO_POSITION" };
  }
  if (!(tinyByQty || tinyByNotional)) {
    return { shouldClose: false, side, qty: roundedQty, reason: "NOT_TINY" };
  }
  return {
    shouldClose: true,
    side,
    qty: roundedQty,
    reason: tinyByQty ? "TINY_BY_QTY" : "TINY_BY_NOTIONAL",
    minQty: Number.isFinite(minQty) ? minQty : null,
    minNotional: Number.isFinite(minNotional) ? minNotional : null,
    notional: Number.isFinite(notional) ? notional : null,
  };
}

async function closeTinyExternalResidualPosition({
  apiKey,
  apiSecret,
  symbol,
  contextTag = "FILL_SYNC",
  tradeMs = null,
} = {}) {
  const sym = normalizeSymbol(symbol);
  if (!sym || !apiKey || !apiSecret) return { ok: false, skipped: true, reason: "PARAMS_INVALID" };
  const [account, info] = await Promise.all([
    fetchBinanceFuturesAccount({ apiKey, apiSecret }),
    fetchFuturesExchangeInfo(sym),
  ]);
  const positions = Array.isArray(account && account.positions) ? account.positions : [];
  const externalPos = positions.find((row) => normalizeSymbol(row && row.symbol) === sym) || null;
  const decision = resolveTinyResidualCloseDecision({
    position: externalPos,
    exchangeInfo: info,
  });
  if (!decision.shouldClose) {
    return { ok: true, skipped: true, reason: decision.reason, qty: decision.qty || null };
  }

  const order = await placeFuturesMarketOrder({
    apiKey,
    apiSecret,
    symbol: sym,
    side: decision.side,
    quantity: decision.qty,
    reduceOnly: true,
    idempotencyKey: `fill_sync_dust_${String(contextTag || "fill_sync").toLowerCase()}_${sym}_${Number.isFinite(Number(tradeMs)) ? Number(tradeMs) : Date.now()}`,
  });

  return {
    ok: true,
    skipped: false,
    reason: decision.reason,
    qty: decision.qty,
    side: decision.side,
    orderId: order && order.orderId ? String(order.orderId) : null,
  };
}

function resolveIntentNotional(intent) {
  if (!intent || typeof intent !== "object") return null;
  const feat = (intent.features_json && typeof intent.features_json === "object") ? intent.features_json : {};
  return pickFinitePositive([
    intent.fill_notional,
    intent.notional,
    intent.notional_krw,
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

function isSameOrderAsRecentTp0(orderMeta, recentTp0) {
  if (!orderMeta || !recentTp0) return false;
  const orderId = Number(orderMeta.orderId);
  const recentOrderId = Number(recentTp0.orderId);
  if (Number.isFinite(orderId) && Number.isFinite(recentOrderId) && orderId === recentOrderId) return true;

  const clientOrderId = String(orderMeta.clientOrderId || "").trim();
  const recentClientOrderId = String(recentTp0.clientOrderId || "").trim();
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

function isSimplifiedExitV2Enabled(positionCtx = null) {
  const ctx = (positionCtx && typeof positionCtx === "object") ? positionCtx : {};
  const position = (ctx.position && typeof ctx.position === "object") ? ctx.position : {};
  return isSimplifiedExitV2Active({
    ...ctx,
    meta: (position.meta && typeof position.meta === "object") ? position.meta : {},
  });
}

function computeAdverseSlippageBps({ side, signalPrice, execPrice } = {}) {
  const ref = Number(signalPrice);
  const fill = Number(execPrice);
  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(fill) || fill <= 0) return null;
  const normalizedSide = String(side || "").trim().toUpperCase();
  const adverseBps = normalizedSide === "SELL"
    ? ((ref - fill) / ref) * 10000
    : ((fill - ref) / ref) * 10000;
  if (!Number.isFinite(adverseBps)) return null;
  return Math.max(0, adverseBps);
}

function clearConsumedTakeProfitProtectionMeta(meta = {}) {
  const prevMeta = meta && typeof meta === "object" ? meta : {};
  const preservedTp0OrderId = prevMeta.native_protection_tp0_order_id ?? prevMeta.native_protection_consumed_tp0_order_id ?? null;
  const preservedTpOrderId = prevMeta.native_protection_tp_order_id ?? prevMeta.native_protection_consumed_tp_order_id ?? null;
  const preservedTp0QtyBase = Number.isFinite(Number(prevMeta.native_protection_tp0_qty_base))
    ? Number(prevMeta.native_protection_tp0_qty_base)
    : (Number.isFinite(Number(prevMeta.native_protection_consumed_tp0_qty_base))
      ? Number(prevMeta.native_protection_consumed_tp0_qty_base)
      : null);
  const preservedTpQtyBase = Number.isFinite(Number(prevMeta.native_protection_tp_qty_base))
    ? Number(prevMeta.native_protection_tp_qty_base)
    : (Number.isFinite(Number(prevMeta.native_protection_consumed_tp_qty_base))
      ? Number(prevMeta.native_protection_consumed_tp_qty_base)
      : null);
  const preservedTp0QtyRatio = Number.isFinite(Number(prevMeta.native_protection_tp0_qty_ratio))
    ? Number(prevMeta.native_protection_tp0_qty_ratio)
    : (Number.isFinite(Number(prevMeta.native_protection_consumed_tp0_qty_ratio))
      ? Number(prevMeta.native_protection_consumed_tp0_qty_ratio)
      : null);
  const preservedTpQtyRatio = Number.isFinite(Number(prevMeta.native_protection_tp_qty_ratio))
    ? Number(prevMeta.native_protection_tp_qty_ratio)
    : (Number.isFinite(Number(prevMeta.native_protection_consumed_tp_qty_ratio))
      ? Number(prevMeta.native_protection_consumed_tp_qty_ratio)
      : null);
  return {
    ...prevMeta,
    native_protection_consumed_tp0_order_id: preservedTp0OrderId,
    native_protection_consumed_tp_order_id: preservedTpOrderId,
    native_protection_consumed_tp0_qty_base: preservedTp0QtyBase,
    native_protection_consumed_tp_qty_base: preservedTpQtyBase,
    native_protection_consumed_tp0_qty_ratio: preservedTp0QtyRatio,
    native_protection_consumed_tp_qty_ratio: preservedTpQtyRatio,
    native_protection_tp0_order_id: null,
    native_protection_tp_order_id: null,
    native_protection_tp0_status: null,
    native_protection_tp_status: null,
    native_protection_tp0_reason: null,
    native_protection_tp_reason: null,
    native_protection_tp0_qty_base: null,
    native_protection_tp_qty_base: null,
    native_protection_tp0_qty_ratio: null,
    native_protection_tp_qty_ratio: null,
  };
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

function isScaledQtyPctMode(mode) {
  const normalized = String(mode || "").trim().toUpperCase();
  return normalized === "SCALED_NOTIONAL" || normalized === "SCALED_QTY_BASE";
}

function resolveFillSyncAlertCloseRatioInfo({ event, intent, qtyScale, execQtyBase, positionCtx, rules } = {}) {
  const empty = { closeRatio: null, aggregation: "SUM", source: null };
  if (!isExitEvent(event)) return empty;
  const eventUpper = String(event || "").toUpperCase();
  const syncedQtyPct = clamp01(qtyScale && qtyScale.qtyPct);
  const qtyScaleMode = String(qtyScale && qtyScale.mode || "").trim().toUpperCase();
  const nativeTp0QtyRatio = clamp01(
    positionCtx && (
      positionCtx.nativeProtectionTp0QtyRatio
      ?? positionCtx.nativeProtectionConsumedTp0QtyRatio
    )
  );
  const nativeTp0QtyBase = Number(
    positionCtx && (
      positionCtx.nativeProtectionTp0QtyBase
      ?? positionCtx.nativeProtectionConsumedTp0QtyBase
    )
  );
  const nativeTpQtyRatio = clamp01(
    positionCtx && (
      positionCtx.nativeProtectionTpQtyRatio
      ?? positionCtx.nativeProtectionConsumedTpQtyRatio
    )
  );
  const nativeTpQtyBase = Number(
    positionCtx && (
      positionCtx.nativeProtectionTpQtyBase
      ?? positionCtx.nativeProtectionConsumedTpQtyBase
    )
  );
  if (eventUpper.startsWith("EXIT_TP_P0") && Number.isFinite(syncedQtyPct) && syncedQtyPct > 0) {
    return {
      closeRatio: syncedQtyPct,
      aggregation: isScaledQtyPctMode(qtyScaleMode) ? "SUM" : "MAX",
      source: qtyScaleMode || "SYNCED_QTY_PCT",
    };
  }
  const execQty = Number(execQtyBase);
  if (eventUpper.startsWith("EXIT_TP_P0")) {
    if (
      Number.isFinite(execQty) && execQty > 0
      && Number.isFinite(nativeTp0QtyBase) && nativeTp0QtyBase > 0
      && Number.isFinite(nativeTp0QtyRatio) && nativeTp0QtyRatio > 0
    ) {
      return {
        closeRatio: clamp01((execQty / nativeTp0QtyBase) * nativeTp0QtyRatio),
        aggregation: "SUM",
        source: "NATIVE_TP0_QTY_BASE",
      };
    }
    if (Number.isFinite(nativeTp0QtyRatio) && nativeTp0QtyRatio > 0) {
      return {
        closeRatio: nativeTp0QtyRatio,
        aggregation: "MAX",
        source: "NATIVE_TP0_QTY_RATIO",
      };
    }
    const tp0ContractQtyRatio = resolveExitStageAbsoluteContractQtyRatio("TP0", rules);
    if (Number.isFinite(tp0ContractQtyRatio) && tp0ContractQtyRatio > 0) {
      return {
        closeRatio: tp0ContractQtyRatio,
        aggregation: "MAX",
        source: "CONTRACT_TP0_QTY_FALLBACK",
      };
    }
  }
  if (isTpP1Event(event)) {
    if (
      Number.isFinite(execQty) && execQty > 0
      && Number.isFinite(nativeTpQtyBase) && nativeTpQtyBase > 0
      && Number.isFinite(nativeTpQtyRatio) && nativeTpQtyRatio > 0
    ) {
      return {
        closeRatio: clamp01((execQty / nativeTpQtyBase) * nativeTpQtyRatio),
        aggregation: "SUM",
        source: "NATIVE_TP_QTY_BASE",
      };
    }
    if (Number.isFinite(nativeTpQtyRatio) && nativeTpQtyRatio > 0) {
      return {
        closeRatio: nativeTpQtyRatio,
        aggregation: "MAX",
        source: "NATIVE_TP_QTY_RATIO",
      };
    }
    if (Number.isFinite(syncedQtyPct) && syncedQtyPct > 0) {
      return {
        closeRatio: syncedQtyPct,
        aggregation: isScaledQtyPctMode(qtyScaleMode) ? "SUM" : "MAX",
        source: qtyScaleMode || "SYNCED_QTY_PCT",
      };
    }
    // C12 invariant: do not fall back to the contract target when neither the
    // intent nor the exchange-acknowledged qty can prove how much was actually
    // closed. Publishing `closeRatio=0.5` for an unverified TP1 event tells
    // operators a lie (intent-shaped, not execution-shaped). Return empty so
    // downstream alert code surfaces it as coverage_ready=false.
  }
  const intentQtyFraction = clamp01(intent && intent.qty_fraction);
  const scaledRatio = clamp01(qtyScale && qtyScale.ratio);
  if (Number.isFinite(intentQtyFraction) && intentQtyFraction > 0) {
    if (Number.isFinite(scaledRatio) && scaledRatio > 0) {
      return {
        closeRatio: clamp01(intentQtyFraction * scaledRatio),
        aggregation: "SUM",
        source: "INTENT_QTY_FRACTION_SCALED",
      };
    }
    return {
      closeRatio: intentQtyFraction,
      aggregation: "MAX",
      source: "INTENT_QTY_FRACTION",
    };
  }
  if (Number.isFinite(scaledRatio) && scaledRatio > 0) {
    return {
      closeRatio: scaledRatio,
      aggregation: "SUM",
      source: "QTY_SCALE_RATIO",
    };
  }
  const positionQtyBase = Number(positionCtx && positionCtx.qtyBase);
  if (isTpP1Event(event)) {
    return empty;
  }
  if (Number.isFinite(execQty) && execQty > 0 && Number.isFinite(positionQtyBase) && positionQtyBase > 0) {
    return {
      closeRatio: clamp01(execQty / positionQtyBase),
      aggregation: "SUM",
      source: "POSITION_QTY_BASE",
    };
  }
  return empty;
}

function buildStageHintedMeta(meta = {}, event = "", trade = null) {
  const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
  const ev = String(event || "").trim().toUpperCase();
  const tradeMs = Number(trade && trade.time);
  const execPrice = Number(trade && trade.price);
  const execAtIso = Number.isFinite(tradeMs) ? new Date(tradeMs).toISOString() : null;
  const alreadyPastTp1 = nextMeta.tp_p1_done === true || nextMeta.trail_active === true;
  // TP0 retirement policy (2026-04-17): in simplified-exit-v2 mode the only
  // exit stages are SL / TP1 / Trailing. `tp_p0_done` must not be stamped on
  // v2 position meta even when an external EXIT_TP_P0 fill arrives (legacy
  // operator actions, replay, or a misrouted native order). The ledger
  // validator and canonical transition layer already refuse to escalate TP0
  // in v2, so zeroing the hint here keeps the meta internally consistent.
  const v2Enabled = isSimplifiedExitV2Active(nextMeta);
  if (isTpP0Event(ev)) {
    if (!v2Enabled) {
      nextMeta.tp_p0_done = true;
      if (Number.isFinite(execPrice) && execPrice > 0) nextMeta.tp_p0_price = execPrice;
      if (execAtIso) nextMeta.tp_p0_at = execAtIso;
      if (Number.isFinite(tradeMs) && tradeMs > 0) nextMeta.tp_p0_bar_ms = tradeMs;
    }
  }
  if (isTpP1Event(ev)) {
    if (!v2Enabled) nextMeta.tp_p0_done = true;
    nextMeta.tp_p1_done = true;
    nextMeta.trail_active = true;
    nextMeta.tp_p1_pending = false;
    nextMeta.tp_p1_pending_at_ms = null;
    nextMeta.tp_p1_pending_until_ms = null;
    nextMeta.tp_p1_pending_event = null;
    if (!alreadyPastTp1) {
      if (Number.isFinite(execPrice) && execPrice > 0) nextMeta.tp_p1_price = execPrice;
      if (execAtIso) nextMeta.tp_p1_at = execAtIso;
      if (Number.isFinite(tradeMs) && tradeMs > 0) nextMeta.tp_p1_bar_ms = tradeMs;
    }
  }
  if (ev.startsWith("EXIT_TRAIL")) {
    if (!v2Enabled) nextMeta.tp_p0_done = true;
    nextMeta.tp_p1_done = true;
    nextMeta.trail_active = true;
  }
  return nextMeta;
}

function buildFillSyncNativeProtectionRefreshArgs({
  exchange = "BINANCEFUT",
  symbol,
  syncedPosition = null,
  hintedMeta = null,
} = {}) {
  const pos = syncedPosition && typeof syncedPosition === "object" ? syncedPosition : {};
  const meta = hintedMeta && typeof hintedMeta === "object" ? hintedMeta : {};
  return {
    exchange,
    symbol,
    fallbackSide: meta.position_side || pos.position_side || pos.side || null,
    fallbackEntryPrice: Number(pos.avg_price),
    fallbackLeverage: Number(meta.external_leverage || meta.leverage || pos.leverage || 1),
    exitRulesOverride: meta.exit_rules_override || null,
    posMeta: meta,
    source: "BINANCE_FUTURES_FILLS_SYNC",
    reason: "NON_AUTHORITY_LAYER_REQUEST",
    dispatchReason: `BINANCE_FUTURES_FILLS_SYNC_NATIVE_STOP_REFRESH_${String(symbol || "").toUpperCase()}`,
    dispatchExitWorker: true,
    // Single stop writer contract: fill sync may request repair, but must not
    // execute the native write inline.
    executeImmediately: false,
  };
}

async function promotePositionStageHintsFromExternalExit({
  exchange = "BINANCEFUT",
  symbol,
  event,
  trade = null,
  runId = null,
} = {}) {
  const ev = String(event || "").trim().toUpperCase();
  if (!(isTpP0Event(ev) || isTpP1Event(ev) || ev.startsWith("EXIT_TRAIL"))) {
    return { ok: false, skipped: true, reason: "NOT_STAGE_EXIT" };
  }
  const sym = normalizeSymbol(symbol);
  if (!sym) return { ok: false, skipped: true, reason: "SYMBOL_INVALID" };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const pos = await getPosition({ exchange, symbol: sym }).catch(() => null);
    if (!pos || isSettledFlatProjection(pos)) {
      return { ok: true, skipped: true, reason: "POSITION_FLAT" };
    }
    const currentMeta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};
    const hintedMeta = buildStageHintedMeta(currentMeta, ev, trade);
    const ledgerPatch = buildExitLedgerMetaPatch({
      position: pos,
      nextMeta: hintedMeta,
      rules: hintedMeta.exit_rules_override && typeof hintedMeta.exit_rules_override === "object"
        ? hintedMeta.exit_rules_override
        : (currentMeta.exit_rules_override && typeof currentMeta.exit_rules_override === "object"
          ? currentMeta.exit_rules_override
          : null),
    });
    const nextMeta = {
      ...hintedMeta,
      ...ledgerPatch,
    };
    // C1 invariant: stage-hint writes must pass the absolute-qty contract
    // validator before they are persisted. This refuses to propagate a hint
    // that would corrupt the ledger (e.g. TP1 consumed > allowed, runner
    // remaining mismatch, missing entry_qty_abs after TP milestone).
    const ledgerValidation = validateExitQuantityContractLedger({
      ledger: {
        entry_qty_abs: ledgerPatch.entry_qty_abs,
        tp0_allowed_ratio: ledgerPatch.tp_p0_allowed_qty_ratio,
        tp0_consumed_ratio: ledgerPatch.tp_p0_consumed_qty_ratio,
        tp1_allowed_ratio: ledgerPatch.tp_p1_allowed_qty_ratio,
        tp1_consumed_ratio: ledgerPatch.tp_p1_consumed_qty_ratio,
        runner_allowed_ratio: ledgerPatch.runner_allowed_qty_ratio,
        runner_remaining_ratio: ledgerPatch.runner_remaining_qty_ratio,
        trail_consumed_ratio: ledgerPatch.trail_consumed_qty_ratio,
        total_consumed_ratio: ledgerPatch.total_consumed_qty_ratio,
        tp0_allowed_abs: ledgerPatch.tp_p0_allowed_qty_abs,
        tp0_consumed_abs: ledgerPatch.tp_p0_consumed_qty_abs,
        tp1_allowed_abs: ledgerPatch.tp_p1_allowed_qty_abs,
        tp1_consumed_abs: ledgerPatch.tp_p1_consumed_qty_abs,
        runner_allowed_abs: ledgerPatch.runner_allowed_qty_abs,
        runner_remaining_abs: ledgerPatch.runner_remaining_qty_abs,
        trail_consumed_abs: ledgerPatch.trail_consumed_qty_abs,
      },
      positionSnapshot: {
        state: pos.state,
        position_state: pos.position_state,
        size_pct: pos.size_pct,
        qty_base: pos.qty_base,
        entry_qty_base: nextMeta.entry_qty_base,
        meta: nextMeta,
      },
    });
    if (ledgerValidation && ledgerValidation.blocked === true) {
      return {
        ok: false,
        skipped: true,
        reason: "LEDGER_INVARIANT_VIOLATION",
        stage_event: ev,
        issues: Array.isArray(ledgerValidation.issues) ? ledgerValidation.issues : [],
        position: pos,
      };
    }
    const unchanged = JSON.stringify(nextMeta) === JSON.stringify(currentMeta);
    if (unchanged) {
      return { ok: true, skipped: true, reason: "META_ALREADY_HINTED", position: pos };
    }
    try {
      const updated = await upsertPositionMetaOnly({
        exchange,
        symbol: sym,
        runId: runId || `RUN__FILL_SYNC_STAGE_HINT__${exchange}__${sym}__${Number(trade && trade.time || Date.now())}`,
        executionMode: String(pos.execution_mode || "LIVE").trim().toUpperCase() || "LIVE",
        meta: nextMeta,
        source: "BINANCE_USER_TRADES_SYNC",
        mutationKind: "POSITION_META_UPSERT",
        reason: "EXTERNAL_EXIT_STAGE_HINT",
        expectedWriteToken: Object.prototype.hasOwnProperty.call(pos || {}, "position_write_token")
          ? (String(pos.position_write_token || "").trim() || null)
          : null,
        suppressAuthorityRuntimeFamily: true,
        suppressAuthorityRuntimeFamilyReason: "FILL_SYNC_STAGE_HINT_RETRY",
      });
      return { ok: true, updated, position: { ...pos, meta: nextMeta } };
    } catch (err) {
      const code = String(err && (err.code || err.message) || "").toUpperCase();
      if (!code.includes("POSITION_WRITE_TOKEN_MISMATCH") || attempt >= 3) throw err;
    }
  }
  return { ok: false, skipped: true, reason: "STAGE_HINT_RETRY_EXHAUSTED" };
}

function mergeRecentExitHintsIntoMeta(meta = {}, {
  recentTp0 = null,
  recentTp1 = null,
  recentTrail = null,
} = {}) {
  const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
  // TP0 retirement policy — v2 positions never stamp tp_p0_done regardless of
  // which cached hint arrives. See buildStageHintedMeta for rationale.
  const v2Enabled = isSimplifiedExitV2Active(nextMeta);
  if (!v2Enabled && recentTp0 && isTpP0Event(recentTp0.event)) {
    nextMeta.tp_p0_done = true;
  }
  if (recentTp1 && isTpP1Event(recentTp1.event)) {
    if (!v2Enabled) nextMeta.tp_p0_done = true;
    nextMeta.tp_p1_done = true;
    nextMeta.trail_active = true;
    nextMeta.tp_p1_pending = false;
    nextMeta.tp_p1_pending_at_ms = null;
    nextMeta.tp_p1_pending_until_ms = null;
    nextMeta.tp_p1_pending_event = null;
  }
  if (recentTrail && String(recentTrail.event || "").trim().toUpperCase().startsWith("EXIT_TRAIL")) {
    if (!v2Enabled) nextMeta.tp_p0_done = true;
    nextMeta.tp_p1_done = true;
    nextMeta.trail_active = true;
  }
  return nextMeta;
}

function resolveFillSyncAlertCloseRatio({ event, intent, qtyScale, execQtyBase, positionCtx, rules } = {}) {
  const resolved = resolveFillSyncAlertCloseRatioInfo({ event, intent, qtyScale, execQtyBase, positionCtx, rules });
  return resolved && Number.isFinite(Number(resolved.closeRatio)) ? resolved.closeRatio : null;
}

function mergeFillSyncAlertCloseRatio(currentPayload = {}, payload = {}) {
  const currentCloseRatio = Number(currentPayload.closeRatio);
  const payloadCloseRatio = Number(payload.closeRatio);
  if (!(Number.isFinite(currentCloseRatio) || Number.isFinite(payloadCloseRatio))) return null;
  const currentAggregation = String(currentPayload.closeRatioAggregation || "").trim().toUpperCase();
  const payloadAggregation = String(payload.closeRatioAggregation || "").trim().toUpperCase();
  if (currentAggregation === "MAX" && payloadAggregation === "MAX") {
    return clamp01(Math.max(
      Number.isFinite(currentCloseRatio) ? currentCloseRatio : 0,
      Number.isFinite(payloadCloseRatio) ? payloadCloseRatio : 0,
    ));
  }
  return clamp01(
    (Number.isFinite(currentCloseRatio) ? currentCloseRatio : 0)
    + (Number.isFinite(payloadCloseRatio) ? payloadCloseRatio : 0)
  );
}

function resolveFillSyncAlertFullExit({ event, orderMeta, closeRatio } = {}) {
  const ev = String(event || "").trim().toUpperCase();
  if (!isExitEvent(ev)) return false;
  if (isTpP1Event(ev)) return false;
  if (orderMeta && orderMeta.closePosition === true) return true;
  if (Number.isFinite(closeRatio) && closeRatio >= 0.999) return true;
  if (
    ev.startsWith("EXIT_SL")
    || ev.startsWith("EXIT_TIME_STOP")
    || ev === "EXIT_EXTERNAL_SYNC"
    || ev === "EXIT_OPPOSITE_SIGNAL"
    || ev === "EXIT_LIQUIDATION_RISK"
  ) {
    return true;
  }
  return false;
}

function resolveFillSyncAlertIdentityTransitionToken(payload = {}) {
  const items = [];
  const primary = String(
    payload && (
      payload.canonicalTransitionEvent
      || payload.canonical_primary_transition_event
    ) || ""
  ).trim().toUpperCase();
  if (primary) items.push(primary);
  if (Array.isArray(payload && payload.canonicalTransitionEvents)) {
    items.push(...payload.canonicalTransitionEvents);
  }
  if (Array.isArray(payload && payload.canonical_transition_events)) {
    items.push(...payload.canonical_transition_events);
  }
  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const normalized = String(item || "").trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  if (!deduped.length) return null;
  const trailTransitionItems = deduped.filter((item) => item === "TRAIL_PARTIAL" || item === "TRAIL_FINAL_EXIT");
  if (!trailTransitionItems.length) return null;
  return `TRANSITION::${trailTransitionItems.join("+")}`;
}

function resolveFillSyncAlertIdentityToken({ event, payload } = {}) {
  return resolveFillSyncAlertIdentityTransitionToken(payload)
    || resolveFillSyncAlertIdentityEvent(event, payload);
}

function buildFillSyncAlertKey({ symbol, event, intent, side, orderMeta, tradeMs, payload } = {}) {
  const sym = normalizeSymbol(symbol) || String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const ev = resolveFillSyncAlertIdentityToken({ event, payload });
  const it = String(intent || "").trim().toUpperCase() || "UNKNOWN";
  const tradeSide = String(side || "").trim().toUpperCase() || "NA";
  const entryEventId = String(payload && payload.entryEventId || "").trim() || "NA";
  const positionSideBefore = String(payload && payload.positionSideBefore || "").trim().toUpperCase() || "NA";
  const orderId = Number.isFinite(Number(orderMeta && orderMeta.orderId))
    ? String(Number(orderMeta.orderId))
    : "NA";
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim() || "NA";
  const tradeBucket = Number.isFinite(Number(tradeMs))
    ? String(Math.floor(Number(tradeMs) / 60000))
    : "NA";
  if (ev === "EXIT_OPPOSITE_SIGNAL") {
    if (entryEventId === "NA") {
      return [sym, ev, it, tradeSide, orderId, clientOrderId, positionSideBefore, tradeBucket].join("|");
    }
    return [sym, ev, it, tradeSide, entryEventId, positionSideBefore, tradeBucket].join("|");
  }
  return [sym, ev, it, tradeSide, orderId, clientOrderId, tradeBucket].join("|");
}

function stripFillSyncUnverifiedSuffix(event) {
  const ev = String(event || "").trim().toUpperCase();
  return ev.endsWith("_UNVERIFIED") ? ev.slice(0, -"_UNVERIFIED".length) : ev;
}

function isVerifiedFillSyncAlertEvent(event, payload = {}) {
  if (payload && payload.classificationVerified === false) return false;
  if (payload && payload.classificationVerified === true) return true;
  return !String(event || "").trim().toUpperCase().endsWith("_UNVERIFIED");
}

function buildFillSyncAlertChainKey({ symbol, event, intent, side, orderMeta, tradeMs, payload } = {}) {
  const sym = normalizeSymbol(symbol) || String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const transitionToken = resolveFillSyncAlertIdentityTransitionToken(payload);
  const it = String(intent || "").trim().toUpperCase() || "UNKNOWN";
  const tradeSide = String(side || "").trim().toUpperCase() || "NA";
  const entryEventId = String(payload && payload.entryEventId || "").trim() || "NA";
  const positionSideBefore = String(payload && payload.positionSideBefore || "").trim().toUpperCase() || "NA";
  const orderId = Number.isFinite(Number(orderMeta && orderMeta.orderId))
    ? String(Number(orderMeta.orderId))
    : "NA";
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim() || "NA";
  const tradeBucket = Number.isFinite(Number(tradeMs))
    ? String(Math.floor(Number(tradeMs) / 60000))
    : "NA";
  if (String(event || "").trim().toUpperCase() === "EXIT_OPPOSITE_SIGNAL") {
    if (transitionToken) {
      return [sym, transitionToken, it, tradeSide, entryEventId, positionSideBefore, tradeBucket].join("|");
    }
    return [sym, it, tradeSide, entryEventId, positionSideBefore, tradeBucket].join("|");
  }
  if (orderId === "NA" && clientOrderId === "NA") return null;
  if (transitionToken) {
    return [sym, transitionToken, it, tradeSide, orderId, clientOrderId, tradeBucket].join("|");
  }
  return [sym, it, tradeSide, orderId, clientOrderId, tradeBucket].join("|");
}

function resolvePreferredFillSyncStageEvent(stage, currentEvent, nextEvent, currentPayload = {}, nextPayload = {}) {
  if (stage === "TP0") {
    if (isTpP0Event(nextEvent)) return nextEvent;
    if (isTpP0Event(currentEvent)) return currentEvent;
    return buildExitEventByKind("TP0", nextPayload.exitRules || currentPayload.exitRules);
  }
  if (stage === "TP1") {
    if (isTpP1Event(nextEvent)) return nextEvent;
    if (isTpP1Event(currentEvent)) return currentEvent;
    return buildExitEventByKind("TP1", nextPayload.exitRules || currentPayload.exitRules);
  }
  if (stage === "TRAIL") {
    if (String(nextEvent || "").trim().toUpperCase().startsWith("EXIT_TRAIL")) return nextEvent;
    if (String(currentEvent || "").trim().toUpperCase().startsWith("EXIT_TRAIL")) return currentEvent;
    return buildExitEventByKind("TRAIL", nextPayload.exitRules || currentPayload.exitRules);
  }
  return nextEvent || currentEvent;
}

function resolveFillSyncAlertIdentityEvent(event, payload = {}) {
  const canonicalEvent = String(
    payload && (
      payload.canonicalExitEvent
      || payload.canonical_exit_event
      || payload.canonicalAlertEvent
      || payload.canonical_alert_event
    ) || ""
  ).trim().toUpperCase();
  const rawEvent = String(event || "").trim().toUpperCase();
  return stripFillSyncUnverifiedSuffix(canonicalEvent || rawEvent) || "UNKNOWN";
}

function resolvePreferredFillSyncAlertEvent(currentPayload = {}, payload = {}) {
  const currentEvent = resolveFillSyncAlertIdentityEvent(currentPayload.event, currentPayload);
  const nextEvent = resolveFillSyncAlertIdentityEvent(payload.event, payload);
  if (!currentEvent) return nextEvent;
  if (!nextEvent) return currentEvent;
  if (currentEvent === nextEvent) {
    return isVerifiedFillSyncAlertEvent(payload.event, payload) ? nextEvent : currentEvent;
  }

  const currentVerified = isVerifiedFillSyncAlertEvent(currentPayload.event, currentPayload);
  const nextVerified = isVerifiedFillSyncAlertEvent(payload.event, payload);
  if (currentVerified !== nextVerified) {
    return currentVerified ? currentEvent : nextEvent;
  }

  const currentStage = classifyExitAuthorityStage(currentEvent);
  const nextStage = classifyExitAuthorityStage(nextEvent);
  const currentCanonicalStage = String(currentPayload.canonicalExitStage || "").trim().toUpperCase() || null;
  const nextCanonicalStage = String(payload.canonicalExitStage || "").trim().toUpperCase() || null;
  const tp0Done = currentPayload.alertStageHintTp0Done === true || payload.alertStageHintTp0Done === true;
  const tp1Done = currentPayload.alertStageHintTp1Done === true || payload.alertStageHintTp1Done === true;
  const trailActive = currentPayload.alertStageHintTrailActive === true || payload.alertStageHintTrailActive === true;

  if (currentCanonicalStage === "TRAIL" || nextCanonicalStage === "TRAIL") {
    return resolvePreferredFillSyncStageEvent("TRAIL", currentEvent, nextEvent, currentPayload, payload);
  }
  if (
    (currentCanonicalStage === "TP1" || nextCanonicalStage === "TP1")
    && (currentStage === "TP0" || currentStage === "TP1")
    && (nextStage === "TP0" || nextStage === "TP1")
  ) {
    return resolvePreferredFillSyncStageEvent("TP1", currentEvent, nextEvent, currentPayload, payload);
  }

  if ((currentStage === "TP0" && nextStage === "TP1") || (currentStage === "TP1" && nextStage === "TP0")) {
    if (trailActive || tp1Done) {
      return resolvePreferredFillSyncStageEvent("TP1", currentEvent, nextEvent, currentPayload, payload);
    }
    if (tp0Done) {
      return resolvePreferredFillSyncStageEvent("TP0", currentEvent, nextEvent, currentPayload, payload);
    }
    return resolvePreferredFillSyncStageEvent("TP0", currentEvent, nextEvent, currentPayload, payload);
  }

  if ((currentStage === "TP1" && nextStage === "TRAIL") || (currentStage === "TRAIL" && nextStage === "TP1")) {
    if (trailActive) {
      return resolvePreferredFillSyncStageEvent("TRAIL", currentEvent, nextEvent, currentPayload, payload);
    }
    return resolvePreferredFillSyncStageEvent("TP1", currentEvent, nextEvent, currentPayload, payload);
  }

  return nextEvent;
}

function shouldClampConflictingFillSyncAlertCloseRatio(currentPayload = {}, payload = {}, preferredEvent = null) {
  const currentEvent = stripFillSyncUnverifiedSuffix(currentPayload.event);
  const nextEvent = stripFillSyncUnverifiedSuffix(payload.event);
  const preferred = stripFillSyncUnverifiedSuffix(preferredEvent);
  if (!currentEvent || !nextEvent || currentEvent === nextEvent) return false;
  if (isTpP0Event(preferred) || isTpP1Event(preferred)) return true;
  return false;
}

function findExistingFillSyncAlertBatchByChainKey(batchMap, chainKey) {
  if (!(batchMap instanceof Map) || !chainKey) return null;
  for (const item of batchMap.values()) {
    if (item && item.chainKey === chainKey) return item;
  }
  return null;
}

function buildFillSyncAlertCooldownKey({ symbol, event, intent, side, orderMeta, payload } = {}) {
  const sym = normalizeSymbol(symbol) || String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const ev = resolveFillSyncAlertIdentityToken({ event, payload });
  const it = String(intent || "").trim().toUpperCase() || "UNKNOWN";
  const tradeSide = String(side || "").trim().toUpperCase() || "NA";
  const entryEventId = String(payload && payload.entryEventId || "").trim() || "NA";
  const positionSideBefore = String(payload && payload.positionSideBefore || "").trim().toUpperCase() || "NA";
  const orderId = Number.isFinite(Number(orderMeta && orderMeta.orderId))
    ? String(Number(orderMeta.orderId))
    : "NA";
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim() || "NA";
  if (ev === "EXIT_OPPOSITE_SIGNAL") {
    if (entryEventId === "NA") {
      return [sym, ev, it, tradeSide, orderId, clientOrderId, positionSideBefore].join("|");
    }
    return [sym, ev, it, tradeSide, entryEventId, positionSideBefore].join("|");
  }
  return [sym, ev, it, tradeSide, orderId, clientOrderId].join("|");
}

function shouldSendFillSyncTradeAlert({
  symbol,
  event,
  intent,
  side,
  orderMeta,
  payload,
  cooldownMs = FILL_SYNC_TRADE_ALERT_COOLDOWN_MS,
  nowMs = Date.now(),
} = {}) {
  const key = buildFillSyncAlertCooldownKey({
    symbol,
    event,
    intent,
    side,
    orderMeta,
    payload,
  });
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const ttlMs = Math.max(1000, Number(cooldownMs) || FILL_SYNC_TRADE_ALERT_COOLDOWN_MS);
  const prev = Number(fillSyncTradeAlertCooldownMap.get(key));
  if (Number.isFinite(prev) && (now - prev) < ttlMs) {
    return { send: false, key, lastSentAtMs: prev };
  }
  fillSyncTradeAlertCooldownMap.set(key, now);
  for (const [cacheKey, sentAtMs] of fillSyncTradeAlertCooldownMap.entries()) {
    if (!Number.isFinite(Number(sentAtMs)) || (now - Number(sentAtMs)) >= ttlMs) {
      fillSyncTradeAlertCooldownMap.delete(cacheKey);
    }
  }
  return { send: true, key, lastSentAtMs: now };
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
  const key = buildFillSyncAlertKey({ symbol, event, intent, side, orderMeta, tradeMs, payload });
  const chainKey = buildFillSyncAlertChainKey({ symbol, event, intent, side, orderMeta, tradeMs, payload });
  const current = batchMap.get(key) || findExistingFillSyncAlertBatchByChainKey(batchMap, chainKey);
  if (!current) {
    batchMap.set(key, {
      key,
      chainKey,
      latestTradeMs: Number.isFinite(Number(tradeMs)) ? Number(tradeMs) : 0,
      fillCount: 1,
      payload: { ...payload },
    });
    return;
  }

  const nextTradeMs = Number.isFinite(Number(tradeMs)) ? Number(tradeMs) : current.latestTradeMs;
  const preferredEvent = resolvePreferredFillSyncAlertEvent(current.payload, payload);
  const conflictingStageMerge = shouldClampConflictingFillSyncAlertCloseRatio(current.payload, payload, preferredEvent);
  const mergedCloseRatio = conflictingStageMerge
    ? clamp01(Math.max(
      Number.isFinite(Number(current.payload.closeRatio)) ? Number(current.payload.closeRatio) : 0,
      Number.isFinite(Number(payload.closeRatio)) ? Number(payload.closeRatio) : 0,
    ))
    : mergeFillSyncAlertCloseRatio(current.payload, payload);
  const mergedPayload = {
    ...current.payload,
    ...payload,
    event: preferredEvent,
    notional: sumFiniteValues(current.payload.notional, payload.notional),
    realizedPnl: sumFiniteValues(current.payload.realizedPnl, payload.realizedPnl),
    closeRatio: mergedCloseRatio,
    closeRatioAggregation: conflictingStageMerge
      ? "MAX"
      : (
      String(current.payload.closeRatioAggregation || "").trim().toUpperCase() === "MAX"
      && String(payload.closeRatioAggregation || "").trim().toUpperCase() === "MAX"
    ) ? "MAX" : "SUM",
    fullExit: current.payload.fullExit === true || payload.fullExit === true,
  };
  if (!(Number.isFinite(Number(payload.execPrice)) && nextTradeMs >= current.latestTradeMs)) {
    mergedPayload.execPrice = current.payload.execPrice;
  }

  const nextKey = buildFillSyncAlertKey({
    symbol,
    event: preferredEvent,
    intent,
    side,
    orderMeta,
    tradeMs: nextTradeMs,
    payload: mergedPayload,
  });
  if (current.key !== nextKey) batchMap.delete(current.key);

  batchMap.set(nextKey, {
    key: nextKey,
    chainKey: current.chainKey || chainKey || null,
    latestTradeMs: Math.max(current.latestTradeMs, nextTradeMs),
    fillCount: current.fillCount + 1,
    payload: mergedPayload,
  });
}

async function flushFillSyncAlertBatches(batchMap, {
  shouldSendAlert = shouldSendFillSyncTradeAlert,
  sendTradeAlert = sendTradeExecutionAlert,
} = {}) {
  if (!(batchMap instanceof Map) || !batchMap.size) return;
  const items = Array.from(batchMap.values()).sort((a, b) => a.latestTradeMs - b.latestTradeMs);
  for (const item of items) {
    try {
      const gate = shouldSendAlert({
        symbol: item.payload && item.payload.symbol,
        event: item.payload && item.payload.event,
        intent: item.payload && item.payload.intent,
        side: item.payload && item.payload.side,
        orderMeta: {
          orderId: item.payload && item.payload.orderId,
          clientOrderId: item.payload && item.payload.clientOrderId,
        },
        payload: item.payload,
        nowMs: item.latestTradeMs || Date.now(),
      });
      if (!gate || gate.send !== true) continue;
      await sendTradeAlert(item.payload);
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

function parseEntryEventId(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const parts = text.split("|");
  if (parts.length < 6) return null;
  const ex = String(parts[0] || "").trim().toUpperCase();
  const sym = String(parts[1] || "").trim().toUpperCase();
  const tf = String(parts[2] || "").trim();
  const barMs = Number(parts[3]);
  const event = String(parts[4] || "").trim().toUpperCase();
  if (!ex || !sym || !tf || !Number.isFinite(barMs) || !event) return null;
  return { exchange: ex, symbol: sym, tf, barMs, event };
}

function resolveSignalRefsForExternalFill({
  intent = null,
  positionCtx = null,
  exchange = "BINANCEFUT",
  symbol = null,
  execTf = "15m",
} = {}) {
  const intentSignalId = intent ? (intent.signal_id || (intent.features_json && intent.features_json.signal_id)) : null;
  const intentSignalDocId = intent ? (intent.signal_doc_id || (intent.features_json && intent.features_json.signal_doc_id)) : null;
  const normalizedIntentSignalId = String(intentSignalId || "").trim() || null;
  const normalizedIntentSignalDocId = String(intentSignalDocId || "").trim() || null;
  if (normalizedIntentSignalId || normalizedIntentSignalDocId) {
    return {
      signalId: normalizedIntentSignalId || normalizedIntentSignalDocId || null,
      signalDocId: normalizedIntentSignalDocId || normalizedIntentSignalId || null,
      signalBarCloseMs: Number.isFinite(Number(intent && intent.signal_bar_close_time_utc_ms))
        ? Number(intent.signal_bar_close_time_utc_ms)
        : null,
      signalTf: String(intent && intent.tf || "").trim() || null,
      source: "INTENT",
    };
  }

  const parsedEntry = parseEntryEventId(positionCtx && positionCtx.entryEventId);
  const fallbackTf = (parsedEntry && parsedEntry.tf) || String(execTf || "").trim() || "15m";
  const fallbackBarMs = (parsedEntry && Number.isFinite(parsedEntry.barMs)) ? parsedEntry.barMs : null;
  const fallbackEvent = (parsedEntry && parsedEntry.event)
    || (String(positionCtx && positionCtx.entrySignalType || "").trim().toUpperCase() || null);
  const fallbackDocId = deriveSignalDocId({
    exchange,
    symbol,
    tf: fallbackTf,
    barCloseMs: fallbackBarMs,
    event: fallbackEvent,
    signalId: null,
  });
  return {
    signalId: fallbackDocId || null,
    signalDocId: fallbackDocId || null,
    signalBarCloseMs: fallbackBarMs,
    signalTf: fallbackTf,
    source: fallbackDocId ? "POSITION_ENTRY_EVENT" : "UNAVAILABLE",
  };
}

function buildSyntheticIntentId({ exchange, symbol, tf, barMs, event } = {}) {
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const tfSafe = String(tf || "").trim() || "15m";
  const ms = Number(barMs);
  const ev = String(event || "").trim().toUpperCase() || "EXIT_EXTERNAL_SYNC";
  if (!ex || !sym || !Number.isFinite(ms) || ms <= 0) return null;
  return `INTENT__${ex}__${sym}__${tfSafe}__${Math.trunc(ms)}__${ev}`;
}

async function ensureSyntheticExternalIntent({
  exchange = "BINANCEFUT",
  symbol = null,
  tf = "15m",
  event = null,
  side = null,
  tradeMs = null,
  execTimeIso = null,
  signalId = null,
  signalDocId = null,
  signalBarCloseMs = null,
} = {}) {
  const refMs = Number.isFinite(Number(signalBarCloseMs)) ? Number(signalBarCloseMs) : Number(tradeMs);
  const intentId = buildSyntheticIntentId({
    exchange,
    symbol,
    tf,
    barMs: refMs,
    event,
  });
  if (!intentId) return null;
  const eventUpper = String(event || "").trim().toUpperCase();
  const eventIntent = eventUpper.startsWith("EXIT_") ? "EXIT" : "ENTRY";
  await patchIntent(intentId, {
    intent_id: intentId,
    exchange: String(exchange || "").trim().toUpperCase() || null,
    symbol_or_pair_id: String(symbol || "").trim() || null,
    tf: String(tf || "").trim() || null,
    event: eventUpper || null,
    side: String(side || "").trim().toUpperCase() || null,
    event_intent: eventIntent,
    reason: "EXTERNAL_FILL_SYNC",
    decision_reason: "EXTERNAL_FILL_RECONCILED",
    status: "FILLED",
    status_reason: "EXTERNAL_FILL_RECONCILED",
    execution_mode: "LIVE",
    signal_id: String(signalId || signalDocId || "").trim() || null,
    signal_doc_id: String(signalDocId || signalId || "").trim() || null,
    signal_bar_close_time_utc_ms: Number.isFinite(refMs) ? refMs : null,
    scheduled_exec_bar_close_time_utc_ms: Number.isFinite(Number(tradeMs)) ? Number(tradeMs) : null,
    filled_at: execTimeIso || nowIso(),
    filled_via: "BINANCE_USER_TRADES",
    external_sync_synthetic_intent: true,
    created_at: execTimeIso || nowIso(),
    features_json: {
      external_sync_synthetic_intent: true,
      signal_id: String(signalId || signalDocId || "").trim() || null,
      signal_doc_id: String(signalDocId || signalId || "").trim() || null,
      source: "BINANCE_USER_TRADES",
    },
  });
  return intentId;
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
    if (it.external_sync_synthetic_intent === true || (it.features_json && it.features_json.external_sync_synthetic_intent === true)) continue;
    const itSide = String(it.side || "").toUpperCase();
    if (itSide && itSide !== side) continue;
    const createdAtMs = Date.parse(String(it.created_at || ""));
    if (Number.isFinite(createdAtMs) && createdAtMs > (tradeMs + Math.max(0, Number(intentFutureAllowMs) || 0))) continue;
    const status = String(it.status || "").toUpperCase();
    if (status === "FILLED") {
      const filledAtMs = Number(
        Date.parse(String(it.filled_at || "")) ||
        Date.parse(String(it.updated_at || "")) ||
        Date.parse(String(it.ts || "")) ||
        createdAtMs
      );
      if (
        Number.isFinite(filledAtMs)
        && tradeMs > (filledAtMs + (Number(process.env.BINANCEFUT_FILLED_INTENT_MATCH_GRACE_MS) || DEFAULT_FILLED_INTENT_MATCH_GRACE_MS))
      ) {
        continue;
      }
    }
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
  if (!isIntentCanceledLikeStatus(status)) return false;
  const reason = String(intent.cancel_reason || intent.status_reason || "").toUpperCase();
  return reason === "LIVE_EXCEPTION" || reason === "LIVE_FAILED" || reason.startsWith("LIVE_");
}

function canFinalizeIntentFromExternalFill(intent) {
  if (!intent || typeof intent !== "object") return false;
  const status = String(intent.status || "").toUpperCase();
  if (status === "PENDING") return true;
  return canRecoverCanceledIntent(intent);
}

function applyAuthoritativeExitContractOverride(event, exitContract) {
  const currentEvent = String(event || "").trim().toUpperCase();
  const contractEvent = String(exitContract && exitContract.event || "").trim().toUpperCase();
  if (contractEvent) return contractEvent;
  return currentEvent;
}

function applyAuthoritativeIntentEventOverride(event, intent) {
  const currentEvent = String(event || "").trim().toUpperCase();
  const intentEvent = String(intent && intent.event || "").trim().toUpperCase();
  if (isAuthoritativeForcedExitIntentEvent(intentEvent)) return intentEvent;
  return currentEvent;
}

function resolveExternalSyncHintStage({
  event,
  orderMeta,
  positionCtx,
  recentTp0,
  recentTp1,
} = {}) {
  if (String(event || "").trim().toUpperCase() !== "EXIT_EXTERNAL_SYNC") return null;
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim();
  const trackedClientOrder = !!(clientOrderId && /^(fut_|dbj_)/.test(clientOrderId));
  if (orderMeta && orderMeta.closePosition === true && !trackedClientOrder) {
    return "UNTRACKED_CLOSE_POSITION";
  }
  const trailActive = !!(
    (positionCtx && positionCtx.trailActive === true)
    || isTrailExitEligible(positionCtx, recentTp1)
  );
  if (trailActive) return "TRAIL_AFTER_TP1";
  if (
    (positionCtx && positionCtx.tpP1Done === true)
    || isTpP1Event(recentTp1 && recentTp1.event)
  ) {
    return "AFTER_TP1";
  }
  if (
    (positionCtx && positionCtx.tpP0Done === true)
    || isTpP0Event(recentTp0 && recentTp0.event)
  ) {
    return "AFTER_TP0";
  }
  return "UNKNOWN";
}

function inferAuthoritativeForcedExitEventFromRefs(...values) {
  for (const value of values) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) continue;
    if (raw === "FORCE_EXIT_HALF" || raw.includes("FORCE_EXIT_HALF")) return "FORCE_EXIT_HALF";
    if (raw === "FORCE_EXIT_ALL" || raw.includes("FORCE_EXIT_ALL")) return "FORCE_EXIT_ALL";
    if (raw === "EXIT_FORCE_ALL" || raw.includes("EXIT_FORCE_ALL")) return "FORCE_EXIT_ALL";
    if (raw === "ACTIVE_NATIVE_STOP_MISSING_FORCE_EXIT") return "FORCE_EXIT_ALL";
  }
  return null;
}

function applyAuthoritativeForcedExitRefOverride({
  event,
  intent = null,
  exitOrderContract = null,
  intentId = null,
  signalId = null,
  signalDocId = null,
  runId = null,
  requestId = null,
  decisionReason = null,
} = {}) {
  const currentEvent = String(event || "").trim().toUpperCase();
  const forcedEvent = inferAuthoritativeForcedExitEventFromRefs(
    exitOrderContract && exitOrderContract.event,
    intent && intent.event,
    intentId,
    signalId,
    signalDocId,
    runId,
    requestId,
    decisionReason
  );
  if (isAuthoritativeForcedExitIntentEvent(forcedEvent)) return forcedEvent;
  return currentEvent;
}

async function loadIntentById(intentId) {
  const id = String(intentId || "").trim();
  if (!id) return null;
  try {
    const snap = await getFirestore().collection("order_intents_paper").doc(id).get();
    return snap.exists ? (snap.data() || null) : null;
  } catch (_) {
    return null;
  }
}

async function loadExitOrderContract({ exchange, symbol, orderMeta, cacheMap } = {}) {
  const orderId = Number(orderMeta && orderMeta.orderId);
  if (!Number.isFinite(orderId)) return null;
  const key = `${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${orderId}`;
  if (cacheMap && cacheMap.has(key)) return cacheMap.get(key);
  const doc = await getExitOrderContractByOrderId({ exchange, symbol, orderId }).catch(() => null);
  if (cacheMap) cacheMap.set(key, doc || null);
  return doc || null;
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
  if (!intentId || !canFinalizeIntentFromExternalFill(intent)) return false;
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
    position: null,
  };
  try {
    const pos = await getPositionReadView({
      exchange,
      symbol,
    });
    const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
    const entryEventId = String(meta.entry_event_id || "").trim() || null;
    const entrySignalType = String(meta.entry_signal_type || "").toUpperCase() || null;
    const positionSide = resolvePositionSideFromPosition(pos, meta);
    const leverageRaw = Number(meta.external_leverage ?? meta.leverage ?? pos.leverage);
    const leverage = Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : null;
    const observation = await getPositionRuntimeObservation({ exchange, symbol }).catch(() => null);
    const exitStage = pos
      ? buildExitStageView({
          exchange,
          position: pos,
          leverageFallback: leverage || 1,
          observation,
        })
      : null;
    ctx = {
      entryEventId,
      entrySignalType,
      positionSide,
      tpP0Done: meta.tp_p0_done === true,
      qtyBase: Number.isFinite(Number(pos && pos.qty_base))
        ? Number(pos.qty_base)
        : (Number.isFinite(Number(meta.qty_base ?? meta.external_qty_base))
          ? Number(meta.qty_base ?? meta.external_qty_base)
          : null),
      leverage,
      tpP1Done: meta.tp_p1_done === true,
      trailActive: meta.trail_active === true,
      position: pos || null,
      exitStage: exitStage || null,
      stopDivergenceItems: Array.isArray(exitStage && exitStage.stop_divergence_items) ? exitStage.stop_divergence_items : [],
      chosenStopSource: exitStage && exitStage.chosen_stop_source ? String(exitStage.chosen_stop_source) : null,
      chosenStopPrice: Number.isFinite(Number(exitStage && exitStage.chosen_stop_price)) ? Number(exitStage.chosen_stop_price) : null,
      runnerFloorStop: Number.isFinite(Number(exitStage && exitStage.runner_floor_stop)) ? Number(exitStage.runner_floor_stop) : null,
      trailStopByR: Number.isFinite(Number(exitStage && exitStage.trail_stop_by_r)) ? Number(exitStage.trail_stop_by_r) : null,
      nativeStopPrice: Number.isFinite(Number(exitStage && exitStage.native_stop_price)) ? Number(exitStage.native_stop_price) : null,
      nativeProtectionStale: meta.native_protection_stale === true,
      nativeProtectionRefreshStatus: String(meta.native_protection_refresh_status || "").toUpperCase() || null,
      nativeProtectionRefreshContext: String(meta.native_protection_refresh_context || "").toUpperCase() || null,
      nativeProtectionRefreshAtMs: Number.isFinite(Number(meta.native_protection_refresh_at_ms))
        ? Number(meta.native_protection_refresh_at_ms)
        : null,
      nativeProtectionTp0OrderId: Number.isFinite(Number(meta.native_protection_tp0_order_id))
        ? Number(meta.native_protection_tp0_order_id)
        : null,
      nativeProtectionTpOrderId: Number.isFinite(Number(meta.native_protection_tp_order_id))
        ? Number(meta.native_protection_tp_order_id)
        : null,
      nativeProtectionConsumedTp0OrderId: Number.isFinite(Number(meta.native_protection_consumed_tp0_order_id))
        ? Number(meta.native_protection_consumed_tp0_order_id)
        : null,
      nativeProtectionConsumedTpOrderId: Number.isFinite(Number(meta.native_protection_consumed_tp_order_id))
        ? Number(meta.native_protection_consumed_tp_order_id)
        : null,
      nativeProtectionTp0QtyBase: Number.isFinite(Number(meta.native_protection_tp0_qty_base))
        ? Number(meta.native_protection_tp0_qty_base)
        : null,
      nativeProtectionTp0QtyRatio: Number.isFinite(Number(meta.native_protection_tp0_qty_ratio))
        ? Number(meta.native_protection_tp0_qty_ratio)
        : null,
      nativeProtectionConsumedTp0QtyBase: Number.isFinite(Number(meta.native_protection_consumed_tp0_qty_base))
        ? Number(meta.native_protection_consumed_tp0_qty_base)
        : null,
      nativeProtectionConsumedTp0QtyRatio: Number.isFinite(Number(meta.native_protection_consumed_tp0_qty_ratio))
        ? Number(meta.native_protection_consumed_tp0_qty_ratio)
        : null,
      nativeProtectionTpQtyBase: Number.isFinite(Number(meta.native_protection_tp_qty_base))
        ? Number(meta.native_protection_tp_qty_base)
        : null,
      nativeProtectionTpQtyRatio: Number.isFinite(Number(meta.native_protection_tp_qty_ratio))
        ? Number(meta.native_protection_tp_qty_ratio)
        : null,
      nativeProtectionConsumedTpQtyBase: Number.isFinite(Number(meta.native_protection_consumed_tp_qty_base))
        ? Number(meta.native_protection_consumed_tp_qty_base)
        : null,
      nativeProtectionConsumedTpQtyRatio: Number.isFinite(Number(meta.native_protection_consumed_tp_qty_ratio))
        ? Number(meta.native_protection_consumed_tp_qty_ratio)
        : null,
      simplifiedExitV2Enabled: isSimplifiedExitV2Active(meta),
      exitRulesOverride: (meta.exit_rules_override && typeof meta.exit_rules_override === "object")
        ? meta.exit_rules_override
        : null,
    };
  } catch (_) {}
  if (cacheMap) cacheMap.set(key, ctx);
  return ctx;
}

function resolveAlertExitRules(positionCtx, defaultExitRules) {
  if (positionCtx && positionCtx.position) {
    return resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: positionCtx.position });
  }
  if (positionCtx && positionCtx.exitRulesOverride) {
    return resolveExitRulesForPosition({
      exchange: "BINANCEFUT",
      position: { meta: { exit_rules_override: positionCtx.exitRulesOverride } },
    });
  }
  return defaultExitRules;
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

function shouldEmitExternalFillSyncExitAlert({
  event = null,
  realizedPnl = null,
  canonicalStage = null,
  canonicalTransitionEvents = [],
  ledgerBlockedInvariant = false,
  canonicalEntryLineageMissing = false,
} = {}) {
  const ev = String(event || "").trim().toUpperCase();
  const stage = String(canonicalStage || "").trim().toUpperCase();
  const transitions = Array.isArray(canonicalTransitionEvents)
    ? canonicalTransitionEvents.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const canonicalTransitionRequired = stage === "TP0" || stage === "TP1" || stage === "TRAIL";
  const hasCanonicalTransition = transitions.length > 0;
  if (ledgerBlockedInvariant === true || canonicalEntryLineageMissing === true) return false;
  if (canonicalTransitionRequired && !hasCanonicalTransition) return false;
  if (hasCanonicalTransition) return true;
  if (ev === "EXIT_EXTERNAL_SYNC") return true;
  return isMeaningfulRealizedPnl(realizedPnl);
}

function buildExitEventByKind(kind, rules) {
  const k = String(kind || "").toUpperCase();
  const slLabel = pctLabel(rules && rules.SL);
  const tp0Label = pctLabel(rules && rules.TP_P0);
  const tpLabel = pctLabel(rules && rules.TP_P1);
  const trailLabel = pctLabel(rules && rules.TRAIL_PCT);
  if (k === "SL") return slLabel ? `EXIT_SL_${slLabel}P` : "EXIT_SL";
  if (k === "TP0") return tp0Label ? `EXIT_TP_P0_${tp0Label}P` : "EXIT_TP_P0";
  if (k === "TP1") return tpLabel ? `EXIT_TP_P1_${tpLabel}P` : "EXIT_TP_P1";
  if (k === "TRAIL") {
    const trailR = Number(rules && rules.TRAIL_R_MULTIPLE);
    if (Number.isFinite(trailR) && trailR > 0) return "EXIT_TRAIL";
    return trailLabel ? `EXIT_TRAIL_${trailLabel}P` : "EXIT_TRAIL";
  }
  return "EXIT_EXTERNAL_SYNC";
}

function normalizeExitEventForRules(event, rules) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return ev;
  if (ev.startsWith("EXIT_TP_P0")) return buildExitEventByKind("TP0", rules);
  if (ev.startsWith("EXIT_TP_P1")) return buildExitEventByKind("TP1", rules);
  if (ev.startsWith("EXIT_TRAIL")) return buildExitEventByKind("TRAIL", rules);
  if (ev.startsWith("EXIT_SL")) return buildExitEventByKind("SL", rules);
  return ev;
}

function isSameOrderAsNativeTp0(orderMeta, positionCtx) {
  const orderId = Number(orderMeta && orderMeta.orderId);
  const nativeOrderId = Number(positionCtx && positionCtx.nativeProtectionTp0OrderId);
  const consumedOrderId = Number(positionCtx && positionCtx.nativeProtectionConsumedTp0OrderId);
  return Number.isFinite(orderId) && (
    (Number.isFinite(nativeOrderId) && orderId === nativeOrderId)
    || (Number.isFinite(consumedOrderId) && orderId === consumedOrderId)
  );
}

function isSameOrderAsNativeTp1(orderMeta, positionCtx) {
  const orderId = Number(orderMeta && orderMeta.orderId);
  const nativeOrderId = Number(positionCtx && positionCtx.nativeProtectionTpOrderId);
  const consumedOrderId = Number(positionCtx && positionCtx.nativeProtectionConsumedTpOrderId);
  return Number.isFinite(orderId) && (
    (Number.isFinite(nativeOrderId) && orderId === nativeOrderId)
    || (Number.isFinite(consumedOrderId) && orderId === consumedOrderId)
  );
}

function shouldTrustMatchedIntentExitEvent({
  intentEvent,
  orderMeta,
  positionCtx,
  recentTp0,
  recentTp1,
  qtyPct,
  rules,
} = {}) {
  const ev = String(intentEvent || "").trim().toUpperCase();
  if (!ev || !ev.startsWith("EXIT_")) return false;
  const ctx = (positionCtx && typeof positionCtx === "object") ? positionCtx : {};
  const sameOrderTp0 = isSameOrderAsNativeTp0(orderMeta, ctx);
  const sameOrderTp1 = isSameOrderAsNativeTp1(orderMeta, ctx);
  const sameOrderRecentTp0 = isSameOrderAsRecentTp0(orderMeta, recentTp0);
  const sameOrderRecentTp1 = isSameOrderAsRecentTp1(orderMeta, recentTp1);
  const inferredKind = inferTakeProfitKindFromQtyPct(qtyPct, rules);

  if (ev.startsWith("EXIT_TP_P0")) {
    if (sameOrderTp1 || sameOrderRecentTp1) return false;
    const postTp0Stage = !!(ctx.tpP0Done === true || ctx.tpP1Done === true || ctx.trailActive === true);
    if (postTp0Stage) return sameOrderTp0 || sameOrderRecentTp0;
    if (sameOrderTp0 || sameOrderRecentTp0) return true;
    return true;
  }

  if (isTpP1Event(ev)) {
    if (sameOrderTp0) return false;
    if (sameOrderRecentTp1) return true;
    if (ctx.tpP0Done !== true && inferredKind === "TP0") return false;
    return true;
  }

  if (ev.startsWith("EXIT_TRAIL")) {
    if (sameOrderTp0 || sameOrderTp1) return false;
    if (orderMeta && orderMeta.closePosition === true) return true;
    return isTrailExitEligible(ctx, recentTp1);
  }

  return true;
}

function isTrailExitEligible(positionCtx, recentTp1) {
  const ctx = (positionCtx && typeof positionCtx === "object") ? positionCtx : {};
  const recentTp1Event = String(recentTp1 && recentTp1.event || "").toUpperCase();
  if (isTpP1Event(recentTp1Event)) return true;
  if (ctx.trailActive !== true) return false;
  if (ctx.tpP1Done === true) return true;
  return false;
}

function isTpP0Event(event) {
  const ev = String(event || "").toUpperCase();
  return ev.startsWith("EXIT_TP_P0");
}

function classifyExitAuthorityStage(event) {
  const ev = String(event || "").toUpperCase();
  if (!ev) return "OTHER";
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return "OTHER";
}

function resolveExitAuthorityChainKey({
  exchange,
  symbol,
  event,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
} = {}) {
  const ex = String(exchange || "").trim().toUpperCase() || "UNKNOWN";
  const sym = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const stage = classifyExitAuthorityStage(event);
  const entryKey = String(entryEventId || "").trim();
  if (entryKey) return { chainKey: `${ex}__${sym}__ENTRY__${entryKey}`, confidence: "ENTRY" };
  const signalKey = String(signalDocId || "").trim();
  if (signalKey) return { chainKey: `${ex}__${sym}__SIGNAL__${signalKey}`, confidence: "SIGNAL" };
  const rawOrderId = orderMeta && orderMeta.orderId != null ? orderMeta.orderId : null;
  const orderId = rawOrderId == null ? NaN : Number(rawOrderId);
  if (Number.isFinite(orderId)) return { chainKey: `${ex}__${sym}__ORDER__${orderId}`, confidence: "ORDER" };
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim();
  if (clientOrderId) return { chainKey: `${ex}__${sym}__CLIENT__${clientOrderId}`, confidence: "CLIENT" };
  return { chainKey: `${ex}__${sym}__STAGE__${stage}`, confidence: "STAGE" };
}

function buildExitAuthorityChainKey(args = {}) {
  return resolveExitAuthorityChainKey(args).chainKey;
}

// P3-03: per-run counter of how often we fall back to the stage-level (weakest)
// chain key. The integrity cycle surfaces this so ops can see silent
// entry-lineage loss without having to diff every fill.
const fillSyncChainKeyLowConfidenceCounts = { ENTRY: 0, SIGNAL: 0, ORDER: 0, CLIENT: 0, STAGE: 0 };
const fillSyncChainKeyLowConfidenceRecentKeys = new Set();
const FILL_SYNC_LOW_CONFIDENCE_RECENT_LIMIT = 32;

function observeExitAuthorityChainKeyConfidence({
  symbol = null,
  event = null,
  confidence = "STAGE",
  chainKey = null,
} = {}) {
  const upperConfidence = String(confidence || "STAGE").trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(fillSyncChainKeyLowConfidenceCounts, upperConfidence)) {
    fillSyncChainKeyLowConfidenceCounts[upperConfidence] += 1;
  }
  // "STAGE" is the weakest — two different cycles on the same symbol can
  // collide. Emit a structured observation log once per unique chainKey per
  // run so ops can correlate with Firestore.
  if (upperConfidence === "STAGE") {
    const token = String(chainKey || `${symbol || "?"}__${event || "?"}`).trim();
    if (token && !fillSyncChainKeyLowConfidenceRecentKeys.has(token)) {
      if (fillSyncChainKeyLowConfidenceRecentKeys.size >= FILL_SYNC_LOW_CONFIDENCE_RECENT_LIMIT) {
        const first = fillSyncChainKeyLowConfidenceRecentKeys.values().next().value;
        if (first) fillSyncChainKeyLowConfidenceRecentKeys.delete(first);
      }
      fillSyncChainKeyLowConfidenceRecentKeys.add(token);
      console.warn("[FILL_SYNC_CHAIN_KEY_LOW_CONFIDENCE]", JSON.stringify({
        chain_key: chainKey,
        symbol: String(symbol || "").toUpperCase() || null,
        event: String(event || "").toUpperCase() || null,
        confidence: upperConfidence,
      }));
    }
  }
}

function getFillSyncChainKeyConfidenceCounts() {
  return { ...fillSyncChainKeyLowConfidenceCounts };
}

function resetFillSyncChainKeyConfidenceForTest() {
  for (const key of Object.keys(fillSyncChainKeyLowConfidenceCounts)) {
    fillSyncChainKeyLowConfidenceCounts[key] = 0;
  }
  fillSyncChainKeyLowConfidenceRecentKeys.clear();
}

function resolveCanonicalExternalExitEvent({
  authorityMap,
  exchange,
  symbol,
  event,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
  positionCtx = null,
  recentTp0 = null,
  recentTp1 = null,
  recentTrail = null,
  rules = null,
} = {}) {
  const currentEvent = String(event || "").trim().toUpperCase();
  const { chainKey, confidence: chainKeyConfidence } = resolveExitAuthorityChainKey({
    exchange,
    symbol,
    event: currentEvent,
    entryEventId,
    signalDocId,
    orderMeta,
  });
  observeExitAuthorityChainKeyConfidence({
    symbol,
    event: currentEvent,
    confidence: chainKeyConfidence,
    chainKey,
  });
  return resolveCanonicalExitWritePayload({
    exchange,
    symbol,
    event: currentEvent,
    chainKey,
    entryEventId,
    signalDocId,
    orderMeta,
    positionSnapshot: positionCtx,
    authorityState: authorityMap instanceof Map && authorityMap.has(chainKey)
      ? authorityMap.get(chainKey)
      : null,
    recentStages: {
      tp0: isTpP0Event(recentTp0 && recentTp0.event) ? "TP0" : null,
      tp1: isTpP1Event(recentTp1 && recentTp1.event) ? "TP1" : null,
      trail: String(recentTrail && recentTrail.event || "").trim().toUpperCase().startsWith("EXIT_TRAIL") ? "TRAIL" : null,
    },
    rules,
  });
}

function shouldPromoteCanonicalExternalExit(decision = null) {
  const resolved = decision && typeof decision === "object" ? decision : {};
  if (resolved.entryLineageMissing === true) return false;
  if (resolved.ledgerBlockedInvariant === true) return false;
  return true;
}

function shouldEnforceSingleStopWriter() {
  return true;
}

async function recordCanonicalExitTransitionsForFill({
  exchange,
  symbol,
  fillId,
  tradeMs,
  event,
  transitionEvents,
  chainKey,
  ledger,
  reason,
  entryEventId = null,
  orderMeta = null,
  tradeId = null,
} = {}) {
  return recordCanonicalExitTransitions({
    exchange,
    symbol,
    fillId,
    tradeId,
    tradeMs,
    canonicalEvent: event,
    transitionEvents,
    chainKey,
    reason,
    entryEventId,
    orderMeta,
    ledger,
    source: "BINANCE_FUTURES_FILLS_SYNC",
  });
}

function getExitAuthorityState(map, chainKey) {
  if (!map.has(chainKey)) {
    map.set(chainKey, {
      tp0: 0,
      tp1: 0,
      trail: 0,
      sl: 0,
      forceExitAll: 0,
      forceExitHalf: 0,
      otherExit: 0,
      total: 0,
    });
  }
  return map.get(chainKey);
}

function applyExternalExitQtyAuthority({
  authorityMap,
  exchange,
  symbol,
  event,
  positionCtx = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
  qtyPct = null,
  rules = null,
  tolerance = 0.03,
} = {}) {
  const rawQty = Number(qtyPct);
  const stage = classifyExitAuthorityStage(event);
  const { chainKey, confidence: chainKeyConfidence } = resolveExitAuthorityChainKey({
    exchange,
    symbol,
    event,
    entryEventId,
    signalDocId,
    orderMeta,
  });
  observeExitAuthorityChainKeyConfidence({
    symbol,
    event,
    confidence: chainKeyConfidence,
    chainKey,
  });
  if (!Number.isFinite(rawQty) || rawQty <= 0 || !authorityMap || stage === "OTHER") {
    return {
      chainKey,
      stage,
      rawQtyPct: Number.isFinite(rawQty) ? rawQty : null,
      acceptedQtyPct: Number.isFinite(rawQty) ? rawQty : null,
      droppedQtyPct: null,
      capped: false,
      duplicateSuspected: false,
      reason: "PASS_THROUGH",
    };
  }
  const state = getExitAuthorityState(authorityMap, chainKey);
  const simplifiedExitV2Enabled = isSimplifiedExitV2Enabled(positionCtx);
  const effectiveStage = simplifiedExitV2Enabled && stage === "TP0" ? "TP1" : stage;
  const tp0Cap = resolveExitStageAbsoluteContractQtyRatio("TP0", rules);
  const tp1Cap = resolveExitStageAbsoluteContractQtyRatio("TP1", rules);
  let remaining = null;
  if (effectiveStage === "TP0") remaining = Math.max(0, tp0Cap - state.tp0);
  else if (effectiveStage === "TP1") remaining = Math.max(0, tp1Cap - state.tp1);
  else remaining = Math.max(0, 1 - state.total);
  const acceptedQtyPct = Math.max(0, Math.min(rawQty, remaining));
  const droppedQtyPct = Math.max(0, rawQty - acceptedQtyPct);
  const capped = droppedQtyPct > 1e-9;
  if (acceptedQtyPct > 1e-9) {
    state.total += acceptedQtyPct;
    if (effectiveStage === "TP0") state.tp0 += acceptedQtyPct;
    else if (effectiveStage === "TP1") state.tp1 += acceptedQtyPct;
    else if (effectiveStage === "TRAIL") state.trail += acceptedQtyPct;
    else if (effectiveStage === "SL") state.sl += acceptedQtyPct;
    else if (effectiveStage === "FORCE_EXIT_ALL") state.forceExitAll += acceptedQtyPct;
    else if (effectiveStage === "FORCE_EXIT_HALF") state.forceExitHalf += acceptedQtyPct;
    else state.otherExit += acceptedQtyPct;
  }
  return {
    chainKey,
    stage: effectiveStage,
    rawQtyPct: rawQty,
    acceptedQtyPct: acceptedQtyPct > 1e-9 ? acceptedQtyPct : null,
    droppedQtyPct: droppedQtyPct > 1e-9 ? droppedQtyPct : null,
    capped,
    duplicateSuspected: capped && droppedQtyPct > Math.max(1e-9, Number(tolerance) || 0.03),
    reason: capped ? "CHAIN_QTY_CAP_APPLIED" : "CHAIN_QTY_ACCEPTED",
  };
}

function inferTakeProfitKindFromQtyPct(qtyPct, rules, positionCtx = null) {
  if (isSimplifiedExitV2Enabled(positionCtx)) {
    const ratio = Number(qtyPct);
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    // C14 invariant: in v2 the only TP stage is TP1 with a contract target of
    // `tp1_allowed_ratio`. A fill must be within ±40% of that target (with a
    // 5pp absolute floor) to be classified as TP1; smaller fractions are
    // partial-fill noise and must be ignored so that `tp_p1_done` never gets
    // set on a 5% exit.
    const target = resolveTp1RemainingContractQtyRatio(rules, 0.5);
    if (!Number.isFinite(target) || target <= 0) return null;
    const tolerance = Math.max(0.05, target * 0.4);
    if (Math.abs(ratio - target) > tolerance) return null;
    return "TP1";
  }
  return inferTakeProfitKindFromQtyRatio(
    qtyPct,
    Number(rules && rules.TP_P0_QTY),
    Number(rules && rules.TP_P1_QTY)
  );
}

function inferTakeProfitKindFromPostFillRemainingAwareQty(execQtyBase, positionQtyBase, rules, positionCtx = null) {
  if (isSimplifiedExitV2Enabled(positionCtx)) {
    const execQty = Number(execQtyBase);
    return Number.isFinite(execQty) && execQty > 0 ? "TP1" : null;
  }
  const execQty = Number(execQtyBase);
  const remainingQty = Number(positionQtyBase);
  if (!Number.isFinite(execQty) || execQty <= 0 || !Number.isFinite(remainingQty) || remainingQty < 0) return null;
  const ratio = clamp01(execQty / (remainingQty + execQty));
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const tp0Ref = resolveTp0ContractQtyRatio(rules, 0.25);
  const tp1Ref = resolveTp1RemainingContractQtyRatio(rules, 0.5);
  const candidates = [];
  if (Number.isFinite(tp0Ref) && tp0Ref > 0) {
    candidates.push({ kind: "TP0", dist: Math.abs(ratio - tp0Ref), ref: tp0Ref });
  }
  if (Number.isFinite(tp1Ref) && tp1Ref > 0) {
    candidates.push({ kind: "TP1", dist: Math.abs(ratio - tp1Ref), ref: tp1Ref });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  if (!Number.isFinite(best.ref) || best.ref <= 0) return null;
  if (best.dist > Math.max(0.05, best.ref * 0.4)) return null;
  return best.kind;
}

function inferStageConstrainedTakeProfitKind(positionCtx, inferredKind, recentTp0) {
  const ctx = (positionCtx && typeof positionCtx === "object") ? positionCtx : {};
  const tp0Done = ctx.tpP0Done === true;
  const tp1Done = ctx.tpP1Done === true;
  const trailActive = ctx.trailActive === true;
  if (isSimplifiedExitV2Enabled(ctx)) {
    if (tp1Done || trailActive) return null;
    return "TP1";
  }
  if (tp1Done || trailActive) return null;
  if (!tp0Done) {
    if (inferredKind === "TP1") return "TP1";
    if (isTpP0Event(recentTp0 && recentTp0.event)) return "TP1";
    return "TP0";
  }
  if (inferredKind === "TP0" || inferredKind === "TP1") return inferredKind;
  return "TP1";
}

function applyActiveExitStageBackstopOverride({
  event,
  intentEvent = null,
  trade,
  orderMeta,
  positionCtx,
  recentTp0,
  recentTp1,
  recentTrail,
  rules,
  qtyPct,
} = {}) {
  const currentEvent = String(event || "").trim().toUpperCase();
  const matchedIntentEvent = String(intentEvent || "").trim().toUpperCase();
  const currentIsTp0 = isTpP0Event(currentEvent);
  const currentIsTp1 = isTpP1Event(currentEvent);
  if (!(currentIsTp0 || currentIsTp1)) return currentEvent;
  const ctx = (positionCtx && typeof positionCtx === "object") ? positionCtx : {};
  const simplifiedExitV2Enabled = isSimplifiedExitV2Enabled(ctx);
  if (!simplifiedExitV2Enabled && currentIsTp0 && matchedIntentEvent.startsWith("EXIT_TP_P0")) return currentEvent;
  if (!simplifiedExitV2Enabled && currentIsTp1 && isTpP1Event(matchedIntentEvent)) return currentEvent;
  const recentTrailEvent = String(recentTrail && recentTrail.event || "").trim().toUpperCase();
  const trailEligible = isTrailExitEligible(ctx, recentTp1) || recentTrailEvent.startsWith("EXIT_TRAIL");

  if (ctx.tpP1Done === true || ctx.trailActive === true || trailEligible) {
    return buildExitEventByKind("TRAIL", rules);
  }
  if (simplifiedExitV2Enabled && (currentIsTp0 || currentIsTp1)) {
    return buildExitEventByKind("TP1", rules);
  }
  if (!currentIsTp0) return currentEvent;
  if (ctx.tpP0Done !== true) return currentEvent;

  const inferredQtyKind = inferTakeProfitKindFromQtyPct(qtyPct, rules, ctx);
  const inferredPostFillKind = inferTakeProfitKindFromPostFillRemainingAwareQty(
    Number(trade && trade.qty),
    Number(ctx.qtyBase),
    rules,
    ctx
  );
  const constrainedKind = inferStageConstrainedTakeProfitKind(ctx, inferredQtyKind, recentTp0);
  const closePosition = !!(orderMeta && orderMeta.closePosition === true);

  if (trailEligible && closePosition) return buildExitEventByKind("TRAIL", rules);
  if (inferredPostFillKind === "TP1" || constrainedKind === "TP1") return buildExitEventByKind("TP1", rules);
  return currentEvent;
}

function isSyntheticExternalFillExitEvent(event) {
  const ev = String(event || "").toUpperCase();
  if (!ev) return false;
  if (/^EXIT_TIME_STOP_\d+B$/.test(ev)) return true;
  if (ev === "EXIT_TIME_STOP") return true;
  return false;
}

function isAuthoritativeForcedExitIntentEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  if (ev === "FORCE_EXIT_ALL" || ev === "FORCE_EXIT_HALF") return true;
  if (ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return true;
  return false;
}

function shouldSuppressMatchedExternalFillAlert({
  event,
  intentId,
  matchedIntentEvent,
} = {}) {
  if (!intentId) return false;
  if (!isAuthoritativeForcedExitIntentEvent(matchedIntentEvent)) return false;
  return String(event || "").trim().toUpperCase() === String(matchedIntentEvent || "").trim().toUpperCase();
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
  recentTp0,
  rules,
  qtyPct,
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
  const sameOrderAsRecentTp0 = isSameOrderAsRecentTp0(orderMeta, recentTp0);
  const sameOrderAsNativeTp0 = isSameOrderAsNativeTp0(orderMeta, positionCtx);
  const sameOrderAsNativeTp1 = isSameOrderAsNativeTp1(orderMeta, positionCtx);
  const trailEligible = isTrailExitEligible(positionCtx, recentTp1);
  const observedQtyPct = Number.isFinite(Number(qtyPct))
    ? Number(qtyPct)
    : (() => {
        const execQty = Number(trade && trade.qty);
        const positionQtyBase = Number(positionCtx && positionCtx.qtyBase);
        if (!Number.isFinite(execQty) || execQty <= 0 || !Number.isFinite(positionQtyBase) || positionQtyBase <= 0) return null;
        return clamp01(execQty / positionQtyBase);
      })();
  const inferredTakeProfitKind = inferTakeProfitKindFromQtyPct(observedQtyPct, rules, positionCtx);
  const inferredPostFillTakeProfitKind = inferTakeProfitKindFromPostFillRemainingAwareQty(
    Number(trade && trade.qty),
    Number(positionCtx && positionCtx.qtyBase),
    rules,
    positionCtx
  );
  const stageConstrainedTakeProfitKind = inferStageConstrainedTakeProfitKind(positionCtx, inferredTakeProfitKind, recentTp0);
  const fallbackTakeProfitKind = (isSimplifiedExitV2Enabled(positionCtx) ? stageConstrainedTakeProfitKind : null)
    || inferredTakeProfitKind
    || (stageConstrainedTakeProfitKind === "TP1" ? "TP1" : null)
    || inferredPostFillTakeProfitKind
    || stageConstrainedTakeProfitKind
    || null;
  const recentAddProtectionRefresh = isRecentAddNativeProtectionRefresh({
    positionCtx,
    tradeMs: Number(trade && trade.time),
  });

  if (intentEvent && isAuthoritativeForcedExitIntentEvent(intentEvent)) {
    return intentEvent;
  }

  if (closePosition) {
    if (orderType === "STOP_MARKET" || orderType === "STOP") {
      return buildExitEventByKind("SL", rules);
    }
    if (orderType === "TAKE_PROFIT_MARKET" || orderType === "TAKE_PROFIT") {
      if (intentEvent && shouldTrustMatchedIntentExitEvent({
        intentEvent,
        orderMeta,
        positionCtx,
        recentTp0,
        recentTp1,
        qtyPct,
        rules,
      })) {
        return normalizeExitEventForRules(intentEvent, rules);
      }
      if (sameOrderAsNativeTp0) return buildExitEventByKind("TP0", rules);
      if (sameOrderAsRecentTp0) return buildExitEventByKind("TP0", rules);
      if (sameOrderAsNativeTp1) return buildExitEventByKind("TP1", rules);
      if (trailEligible) return buildExitEventByKind("TRAIL", rules);
      if (fallbackTakeProfitKind) return buildExitEventByKind(fallbackTakeProfitKind, rules);
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
    const logDecision = shouldLogFillSyncOverride({
      prefix,
      symbol: sym,
      orderId,
      clientOrderId,
      detail,
    });
    if (logDecision.log) {
      console.warn(
        `${prefix} ${sym || "UNKNOWN"} order_id=${Number.isFinite(orderId) ? orderId : "NA"} ` +
        `client_order_id=${clientOrderId || "NA"} tracked=${trackedClientOrder ? "1" : "0"} ${detail}`
      );
    }
    return buildExitEventByKind("UNKNOWN", rules);
  }
  if (intentEvent) {
    if (isSyntheticExternalFillExitEvent(intentEvent)) {
      const sym = normalizeSymbol(trade && trade.symbol);
      const detail = `intent_event=${intentEvent} -> EXIT_EXTERNAL_SYNC (synthetic intent event)`;
      const logDecision = shouldLogFillSyncOverride({
        prefix: "[FILL_SYNC_EVENT_OVERRIDE]",
        symbol: sym,
        orderId,
        clientOrderId: orderMeta && orderMeta.clientOrderId,
        detail,
      });
      if (logDecision.log) {
        console.warn(
          `[FILL_SYNC_EVENT_OVERRIDE] ${sym || "UNKNOWN"} order_id=${Number.isFinite(orderId) ? orderId : "NA"} ` +
          detail
        );
      }
      return "EXIT_EXTERNAL_SYNC";
    }
    if (shouldTrustMatchedIntentExitEvent({
      intentEvent,
      orderMeta,
      positionCtx,
      recentTp0,
      recentTp1,
      qtyPct,
      rules,
    })) {
      return normalizeExitEventForRules(intentEvent, rules);
    }
  }

  if (sameOrderAsRecentTp1 && isTpP1Event(recentTp1 && recentTp1.event)) {
    return buildExitEventByKind("TP1", rules);
  }
  if (sameOrderAsRecentTp0 && isTpP0Event(recentTp0 && recentTp0.event)) {
    return buildExitEventByKind("TP0", rules);
  }

  if (orderType === "STOP_MARKET" || orderType === "STOP") {
    return buildExitEventByKind("SL", rules);
  }
  if (orderType === "TAKE_PROFIT_MARKET" || orderType === "TAKE_PROFIT") {
    if (sameOrderAsNativeTp0) return buildExitEventByKind("TP0", rules);
    if (sameOrderAsRecentTp0) return buildExitEventByKind("TP0", rules);
    if (sameOrderAsNativeTp1) return buildExitEventByKind("TP1", rules);
    if (trailEligible) return buildExitEventByKind("TRAIL", rules);
    if (fallbackTakeProfitKind) return buildExitEventByKind(fallbackTakeProfitKind, rules);
    return buildExitEventByKind("TP1", rules);
  }

  const realized = Number(trade && trade.realizedPnl);
  if (!Number.isFinite(realized)) return buildExitEventByKind("UNKNOWN", rules);
  if (realized < 0) return buildExitEventByKind("SL", rules);
  if (trailEligible) return buildExitEventByKind("TRAIL", rules);
  if (fallbackTakeProfitKind) return buildExitEventByKind(fallbackTakeProfitKind, rules);
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
  const exitOrderContractCache = new Map();
  const recentTp1BySymbol = new Map();
  const recentTp0BySymbol = new Map();
  const recentTrailBySymbol = new Map();
  const pendingAlertBatches = new Map();
  let lastExitTradeMs = null;
  let observedExitFill = false;
  // C2 persistence: hydrate the authority accumulator from Firestore so that a
  // process restart cannot drop the previously-consumed qty cap. Failures are
  // non-fatal — the legacy per-run Map still enforces within-run invariants.
  const exitQtyAuthorityMap = new Map();
  const exitQtyAuthorityTouched = new Map();
  try {
    const hydrateSnap = await db.collection(EXIT_AUTHORITY_STATE_COLLECTION)
      .where("exchange", "==", "BINANCEFUT")
      .where("symbol", "==", sym)
      .limit(50)
      .get();
    hydrateSnap.forEach((doc) => {
      const data = doc.data() || {};
      const key = String(data.chain_key || doc.id || "").trim();
      if (!key) return;
      exitQtyAuthorityMap.set(key, normalizeExitAuthorityState(data.state || {}));
    });
  } catch (_err) {
    // fall through — in-memory cap still applies
  }
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

      let intent = pickIntentForTrade(t, intents, matchWindowMs || DEFAULT_MATCH_WINDOW_MS, intentFutureAllowMs);
      const positionCtx = await loadPositionEntryContext("BINANCEFUT", sym, positionEntryCache);
      const exitRules = resolveAlertExitRules(positionCtx, defaultExitRules);
      const recentTp1 = recentTp1BySymbol.get(sym) || null;
      const recentTp0 = recentTp0BySymbol.get(sym) || null;
      const recentTrail = recentTrailBySymbol.get(sym) || null;
      const execPrice = Number(t.price);
      const execQtyBase = Number(t.qty);
      const notional = Number(t.quoteQty) || (Number.isFinite(execPrice) && Number.isFinite(execQtyBase) ? execPrice * execQtyBase : null);
      const qtyScale = computeSyncedQtyPct({
        intent,
        tradeNotional: notional,
        execQtyBase,
      });
      const qtyPct = qtyScale.qtyPct;
      const orderMeta = await resolveExternalOrderMeta({
        trade: t,
        apiKey,
        apiSecret,
        symbol: sym,
        orderMetaCache,
      });
      const exitOrderContract = await loadExitOrderContract({
        exchange: "BINANCEFUT",
        symbol: sym,
        orderMeta,
        cacheMap: exitOrderContractCache,
      });
      let event = await resolveExternalExitEvent({
        intent,
        trade: t,
        orderMeta,
        positionCtx,
        recentTp1,
        recentTp0,
        rules: exitRules,
        qtyPct,
      });
      let intentId = intent ? intent.intent_id : null;
      const signalRefs = resolveSignalRefsForExternalFill({
        intent,
        positionCtx,
        exchange: "BINANCEFUT",
        symbol: sym,
        execTf,
      });
      const signalId = signalRefs.signalId;
      const signalDocId = signalRefs.signalDocId;
      let canonicalStageDecision = resolveCanonicalExternalExitEvent({
        authorityMap: exitQtyAuthorityMap,
        exchange: "BINANCEFUT",
        symbol: sym,
        event,
        entryEventId: (positionCtx && positionCtx.entryEventId) || null,
        signalDocId,
        orderMeta,
        positionCtx,
        recentTp0,
        recentTp1,
        recentTrail,
        rules: exitRules,
      });
      event = canonicalStageDecision.event;
      const qtyFraction = intent ? intent.qty_fraction : null;
      const intentEntryCtx = extractEntryContextFromIntent(intent);
      const signalPrice = intent
        ? Number(intent.signal_price ?? (intent.features_json && intent.features_json.signal_price))
        : null;
      const signalPriceDiff = Number.isFinite(signalPrice) ? (execPrice - signalPrice) : null;
      const signalPriceDiffPct = (Number.isFinite(signalPrice) && signalPrice !== 0)
        ? (signalPriceDiff / signalPrice)
        : null;
      const slippageBps = computeAdverseSlippageBps({
        side: String(t.side || "").toUpperCase(),
        signalPrice,
        execPrice,
      });
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
      const looksLikeExit = Number.isFinite(realizedPnl) && Math.abs(realizedPnl) > 1e-12;
      if (looksLikeExit) {
        observedExitFill = true;
        if (!Number.isFinite(lastExitTradeMs) || tradeMs > lastExitTradeMs) lastExitTradeMs = tradeMs;
      }
      if (!intentId && looksLikeExit) {
        intentId = await ensureSyntheticExternalIntent({
          exchange: "BINANCEFUT",
          symbol: sym,
          tf: execTf,
          event,
          side: String(t.side || "").toUpperCase(),
          tradeMs,
          execTimeIso,
          signalId,
          signalDocId,
          signalBarCloseMs: signalRefs.signalBarCloseMs,
        });
      }
      if ((!intent || !intent.intent_id) && intentId) {
        const recoveredIntent = await loadIntentById(intentId);
        if (recoveredIntent) intent = recoveredIntent;
      }
      event = applyAuthoritativeExitContractOverride(event, exitOrderContract);
      event = applyAuthoritativeIntentEventOverride(event, intent);
      event = applyAuthoritativeForcedExitRefOverride({
        event,
        intent,
        exitOrderContract,
        intentId,
        signalId,
        signalDocId,
        runId: intent && intent.run_id,
        requestId: intent && intent.request_id,
        decisionReason: intent && (intent.reason || intent.status_reason || intent.cancel_reason),
      });
      event = applyActiveExitStageBackstopOverride({
        event,
        intentEvent: intent && intent.event,
        trade: t,
        orderMeta,
        positionCtx,
        recentTp0,
        recentTp1,
        recentTrail,
        rules: exitRules,
        qtyPct,
      });
      const linkedTradeId = Number.isFinite(tradeMs)
        ? buildTradeId({
          exchange: "BINANCEFUT",
          symbol: sym,
          event,
          execBarCloseMs: tradeMs,
          execMs: tradeMs,
        })
        : null;
      let inferredEntryCtx = { entryEventId: null, entrySignalType: null };
      if (looksLikeExit && !intentEntryCtx.entryEventId) {
        inferredEntryCtx = await loadPositionEntryContext("BINANCEFUT", sym, positionEntryCache);
      }
      const entryEventId = intentEntryCtx.entryEventId || inferredEntryCtx.entryEventId || null;
      const entrySignalType = intentEntryCtx.entrySignalType || inferredEntryCtx.entrySignalType || null;
      const rawEvidenceEvent = event;
      canonicalStageDecision = resolveCanonicalExternalExitEvent({
        authorityMap: exitQtyAuthorityMap,
        exchange: "BINANCEFUT",
        symbol: sym,
        event,
        entryEventId,
        signalDocId,
        orderMeta,
        positionCtx,
        recentTp0,
        recentTp1,
        recentTrail,
        rules: exitRules,
      });
      event = canonicalStageDecision.event;
      const positionSideBefore = inferPositionSideBefore({ trade: t, positionCtx });
      const authorityDecision = looksLikeExit
        ? applyExternalExitQtyAuthority({
          authorityMap: exitQtyAuthorityMap,
          exchange: "BINANCEFUT",
          symbol: sym,
          event,
          entryEventId,
          signalDocId,
          orderMeta,
          positionCtx,
          qtyPct,
          rules: exitRules,
        })
        : {
          chainKey: null,
          stage: "OTHER",
          rawQtyPct: Number.isFinite(Number(qtyPct)) ? Number(qtyPct) : null,
          acceptedQtyPct: Number.isFinite(Number(qtyPct)) ? Number(qtyPct) : null,
          droppedQtyPct: null,
          capped: false,
          duplicateSuspected: false,
          reason: "PASS_THROUGH",
        };
      // C2 persistence tracking: remember which chainKeys were mutated so the
      // final authority state can be written back to Firestore at loop exit.
      if (looksLikeExit
        && authorityDecision
        && authorityDecision.chainKey
        && Number(authorityDecision.acceptedQtyPct) > 0) {
        exitQtyAuthorityTouched.set(authorityDecision.chainKey, {
          entryEventId: entryEventId || null,
        });
      }
      const authoritativeQtyPct = looksLikeExit
        ? authorityDecision.acceptedQtyPct
        : qtyPct;
      const authoritativeQtyFraction = Number.isFinite(Number(authoritativeQtyPct))
        ? Number(authoritativeQtyPct)
        : null;
      const authoritativeQtyScale = looksLikeExit
        ? {
          ...qtyScale,
          qtyPct: Number.isFinite(Number(authoritativeQtyPct)) ? Number(authoritativeQtyPct) : null,
        }
        : qtyScale;
      const closeRatioInfo = looksLikeExit
        ? resolveFillSyncAlertCloseRatioInfo({ event, intent, qtyScale: authoritativeQtyScale, execQtyBase, positionCtx, rules: exitRules })
        : null;
      const closeRatio = closeRatioInfo && Number.isFinite(Number(closeRatioInfo.closeRatio))
        ? closeRatioInfo.closeRatio
        : null;
      const fullExit = looksLikeExit
        ? resolveFillSyncAlertFullExit({
          event,
          orderMeta,
          closeRatio,
        })
        : false;
      const canonicalTransitionDecision = looksLikeExit
        ? {
          transitionEvents: Array.isArray(canonicalStageDecision.transitionEvents)
            ? canonicalStageDecision.transitionEvents
            : [],
          primaryTransitionEvent: canonicalStageDecision.primaryTransitionEvent || null,
        }
        : { transitionEvents: [], primaryTransitionEvent: null };
      const canonicalExitMutationAllowed = looksLikeExit
        ? shouldPromoteCanonicalExternalExit(canonicalStageDecision)
        : false;
      const exitLedgerPayload = looksLikeExit
        ? buildExitLedgerPayload(canonicalStageDecision.ledger || null, execQtyBase, {
          simplifiedExitV2Enabled: isSimplifiedExitV2Enabled(positionCtx),
        })
        : null;

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
        qtyPct: authoritativeQtyPct,
        execPrice,
        feeBps: 0,
        slippageBps,
        feeValue,
        notional,
        notionalKrw: notional,
        qtyFraction: authoritativeQtyFraction,
        execPriceSource: "BINANCE_USER_TRADES",
        executionMode: "LIVE",
        liveOrderId: t.orderId ? String(t.orderId) : null,
        execQtyBase,
        entryEventId,
        entrySignalType,
        signalId,
        signalDocId,
        signalBarCloseTimeUtcMs: Number.isFinite(Number(signalRefs.signalBarCloseMs))
          ? Number(signalRefs.signalBarCloseMs)
          : null,
        signalPrice: Number.isFinite(signalPrice) ? signalPrice : null,
        signalPriceDiff,
        signalPriceDiffPct,
        signalPriceSource: intent ? (intent.signal_price_source || null) : null,
        leverageApplied: Number.isFinite(intentLeverage) && intentLeverage > 0 ? intentLeverage : null,
        leverageReason: intentLeverageReason || null,
        featuresJson: (intent && intent.features_json && typeof intent.features_json === "object") ? intent.features_json : null,
        createdAt: execTimeIso,
        runId: intent ? (intent.run_id || null) : null,
        decisionReason: intent ? (intent.reason || intent.event || "EXTERNAL_FILL_RECONCILED") : "EXTERNAL_FILL_RECONCILED",
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
          canonical_exit_event: canonicalStageDecision.event || null,
          canonical_transition_events: Array.isArray(canonicalTransitionDecision.transitionEvents)
            ? canonicalTransitionDecision.transitionEvents
            : [],
          canonical_primary_transition_event: canonicalTransitionDecision.primaryTransitionEvent || null,
          qty_pct_mode: qtyScale.mode,
          qty_pct_ratio: Number.isFinite(qtyScale.ratio) ? qtyScale.ratio : null,
          qty_pct_intent_raw: Number.isFinite(qtyScale.intentQtyPct) ? qtyScale.intentQtyPct : null,
          qty_pct_intent_notional: Number.isFinite(qtyScale.intentNotional) ? qtyScale.intentNotional : null,
          qty_pct_intent_qty_base: Number.isFinite(qtyScale.intentQtyBase) ? qtyScale.intentQtyBase : null,
          authoritative_exit_chain_key: authorityDecision.chainKey || null,
          authoritative_exit_stage: authorityDecision.stage || null,
          canonical_exit_chain_key: canonicalStageDecision.chainKey || null,
          canonical_exit_stage: canonicalStageDecision.stage || null,
          canonical_exit_reason: canonicalStageDecision.reason || null,
          canonical_entry_lineage_required: canonicalStageDecision.entryLineageRequired === true,
          canonical_entry_lineage_missing: canonicalStageDecision.entryLineageMissing === true,
          authoritative_qty_pct_raw: Number.isFinite(Number(authorityDecision.rawQtyPct)) ? Number(authorityDecision.rawQtyPct) : null,
          authoritative_qty_pct_accepted: Number.isFinite(Number(authorityDecision.acceptedQtyPct)) ? Number(authorityDecision.acceptedQtyPct) : null,
          authoritative_qty_pct_dropped: Number.isFinite(Number(authorityDecision.droppedQtyPct)) ? Number(authorityDecision.droppedQtyPct) : null,
          authoritative_qty_cap_applied: authorityDecision.capped === true,
          authoritative_duplicate_suspected: authorityDecision.duplicateSuspected === true,
          authoritative_qty_reason: authorityDecision.reason || null,
          canonical_exit_stage_relocked: canonicalStageDecision.stageRelocked === true,
          canonical_exit_blocked_invariant: canonicalStageDecision.blockedInvariant === true,
          canonical_exit_ledger_blocked_invariant: canonicalStageDecision.ledgerBlockedInvariant === true,
          canonical_exit_ledger_issue_codes: Array.isArray(canonicalStageDecision.ledgerValidation && canonicalStageDecision.ledgerValidation.issues)
            ? canonicalStageDecision.ledgerValidation.issues.map((issue) => String(issue && issue.code || "").trim().toUpperCase()).filter(Boolean)
            : [],
          contract_entry_qty_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractEntryQtyAbs))
            ? Number(exitLedgerPayload.contractEntryQtyAbs)
            : null,
          contract_tp0_allowed_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractTp0AllowedAbs))
            ? Number(exitLedgerPayload.contractTp0AllowedAbs)
            : null,
          contract_tp0_consumed_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractTp0ConsumedAbs))
            ? Number(exitLedgerPayload.contractTp0ConsumedAbs)
            : null,
          contract_tp1_allowed_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractTp1AllowedAbs))
            ? Number(exitLedgerPayload.contractTp1AllowedAbs)
            : null,
          contract_tp1_consumed_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractTp1ConsumedAbs))
            ? Number(exitLedgerPayload.contractTp1ConsumedAbs)
            : null,
          contract_runner_allowed_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractRunnerAllowedAbs))
            ? Number(exitLedgerPayload.contractRunnerAllowedAbs)
            : null,
          contract_runner_remaining_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractRunnerRemainingAbs))
            ? Number(exitLedgerPayload.contractRunnerRemainingAbs)
            : null,
          contract_trail_consumed_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractTrailConsumedAbs))
            ? Number(exitLedgerPayload.contractTrailConsumedAbs)
            : null,
          contract_observed_qty_abs: exitLedgerPayload && Number.isFinite(Number(exitLedgerPayload.contractObservedQtyAbs))
            ? Number(exitLedgerPayload.contractObservedQtyAbs)
            : null,
        },
      });

      if (isTpP0Event(event)) {
        recentTp0BySymbol.set(sym, {
          tradeMs,
          event,
          orderId: Number.isFinite(Number(orderMeta && orderMeta.orderId)) ? Number(orderMeta.orderId) : null,
          clientOrderId,
          execPrice: Number.isFinite(execPrice) ? execPrice : null,
        });
      }
      if (isTpP1Event(event)) {
        recentTp1BySymbol.set(sym, {
          tradeMs,
          event,
          orderId: Number.isFinite(Number(orderMeta && orderMeta.orderId)) ? Number(orderMeta.orderId) : null,
          clientOrderId,
          execPrice: Number.isFinite(execPrice) ? execPrice : null,
        });
      }
      if (String(event || "").trim().toUpperCase().startsWith("EXIT_TRAIL")) {
        recentTrailBySymbol.set(sym, {
          tradeMs,
          event,
          orderId: Number.isFinite(Number(orderMeta && orderMeta.orderId)) ? Number(orderMeta.orderId) : null,
          clientOrderId,
          execPrice: Number.isFinite(execPrice) ? execPrice : null,
        });
      }

      if (upserted && upserted.inserted && looksLikeExit) {
        try {
          if (canonicalExitMutationAllowed) {
            await recordCanonicalExitTransitionsForFill({
              exchange: "BINANCEFUT",
              symbol: sym,
              fillId,
              tradeMs,
              event,
              transitionEvents: canonicalTransitionDecision.transitionEvents,
              chainKey: canonicalStageDecision.chainKey || null,
              ledger: canonicalStageDecision.ledger || null,
              reason: canonicalStageDecision.reason || null,
              entryEventId,
              orderMeta,
              tradeId,
            });
          }
        } catch (transitionErr) {
          console.warn("[BINANCEFUT_CANONICAL_EXIT_TRANSITION_RECORD_FAIL]", transitionErr && transitionErr.message ? transitionErr.message : String(transitionErr));
        }
        try {
          if (canonicalExitMutationAllowed) {
            const stageHintResult = await promotePositionStageHintsFromExternalExit({
              exchange: "BINANCEFUT",
              symbol: sym,
              event,
              trade: t,
              runId: `RUN__FILL_SYNC_STAGE_HINT__${sym}__${tradeMs}`,
            });
            if (stageHintResult && stageHintResult.position) {
              positionEntryCache.set(`BINANCEFUT__${sym}`, {
                ...(positionCtx && typeof positionCtx === "object" ? positionCtx : {}),
                tpP0Done: stageHintResult.position.meta && stageHintResult.position.meta.tp_p0_done === true,
                tpP1Done: stageHintResult.position.meta && stageHintResult.position.meta.tp_p1_done === true,
                trailActive: stageHintResult.position.meta && stageHintResult.position.meta.trail_active === true,
                position: stageHintResult.position,
              });
            }
          }
        } catch (stageErr) {
          console.warn("[BINANCEFUT_FILL_SYNC_STAGE_HINT_FAIL]", stageErr && stageErr.message ? stageErr.message : String(stageErr));
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
      if (looksLikeExit && exitOrderContract && Number.isFinite(Number(orderMeta && orderMeta.orderId))) {
        try {
          await markExitOrderContractConsumed({
            exchange: "BINANCEFUT",
            symbol: sym,
            orderId: Number(orderMeta.orderId),
            fillId,
            tradeId,
            consumedEvent: event,
            consumedQtyBase: execQtyBase,
            consumedAt: execTimeIso,
          });
        } catch (e) {
          console.warn("[EXIT_ORDER_CONTRACT_CONSUME_FAIL]", e && e.message ? e.message : String(e));
        }
      }
      if (upserted && upserted.inserted && shouldAuditProjectionImmediately(event)) {
        try {
          await auditProjectionEventImmediately({
            exchange: "BINANCEFUT",
            symbol: sym,
            eventRow: { fillId, event, tradeMs, symbol: sym },
          });
        } catch (e) {
          console.warn("[BINANCEFUT_FILL_SYNC_IMMEDIATE_AUDIT_FAIL]", e && e.message ? e.message : String(e));
        }
      }
      if (upserted && upserted.inserted && alertEnabled) {
        const isForcedExitEvent = isAuthoritativeForcedExitIntentEvent(event);
        const isExitEvent = String(event || "").trim().toUpperCase().startsWith("EXIT_") || isForcedExitEvent;
        const isEntryLikeEvent = !isExitEvent && event !== "SYNC_FILL";
        const canonicalStageForAlert = String(canonicalStageDecision.stage || "").trim().toUpperCase();
        const canonicalEntryLineageMissing = looksLikeExit && canonicalStageDecision.entryLineageMissing === true;
        const allowExitAlert = isExitEvent && shouldEmitExternalFillSyncExitAlert({
          event,
          realizedPnl,
          canonicalStage: canonicalStageForAlert,
          canonicalTransitionEvents: canonicalTransitionDecision.transitionEvents,
          ledgerBlockedInvariant: canonicalStageDecision.ledgerBlockedInvariant === true,
          canonicalEntryLineageMissing,
        });
        const allowEntryAlert = isEntryLikeEvent;
        const duplicateSuppressed = looksLikeExit
          && authorityDecision
          && authorityDecision.duplicateSuspected === true
          && (!Number.isFinite(Number(authoritativeQtyPct)) || Number(authoritativeQtyPct) <= 0);
        if (allowExitAlert || allowEntryAlert) {
          if (duplicateSuppressed) {
            continue;
          }
          const eventAgeMs = Number.isFinite(tradeMs) ? (Date.now() - tradeMs) : null;
          if (!Number.isFinite(eventAgeMs) || eventAgeMs <= alertMaxAgeMs) {
            const matchedIntentEvent = String(intent && intent.event || "").toUpperCase();
            const suppressBecauseAuthoritativeForcedIntent = shouldSuppressMatchedExternalFillAlert({
              event,
              intentId,
              matchedIntentEvent,
            });
            if (suppressBecauseAuthoritativeForcedIntent) {
              continue;
            }
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
              closeRatioAggregation: closeRatioInfo ? closeRatioInfo.aggregation : null,
              closeRatioSource: closeRatioInfo ? closeRatioInfo.source : null,
              fullExit,
              realizedPnl: isExitEvent ? realizedPnl : null,
              reason: isExitEvent
                ? (String(
                  (intent && (intent.reason || intent.status_reason || intent.cancel_reason))
                  || (event === "EXIT_EXTERNAL_SYNC" ? "EXTERNAL_FILL_RECONCILED" : "")
                ).trim() || null)
                : null,
              decisionReason: isExitEvent
                ? (String(
                  (intent && (intent.status_reason || intent.reason || intent.cancel_reason))
                  || (event === "EXIT_EXTERNAL_SYNC" ? "EXTERNAL_FILL_RECONCILED" : "")
                ).trim() || null)
                : null,
              positionSideBefore,
              positionSideAfter: isExitEvent ? null : resolvePositionSideForTrade(t, positionSideBefore),
              appliedLeverage: Number.isFinite(intentLeverage)
                ? intentLeverage
                : (positionCtx && Number.isFinite(positionCtx.leverage) ? positionCtx.leverage : null),
              leverageReason: intentLeverageReason || "BINANCE_USER_TRADES_SYNC",
              exitRules,
              entryEventId: entryEventId || null,
              canonicalExitEvent: canonicalStageDecision.event || null,
              canonicalExitStage: canonicalStageDecision.stage || null,
              canonicalExitChainKey: canonicalStageDecision.chainKey || null,
              canonicalTransitionEvent: canonicalTransitionDecision.primaryTransitionEvent || null,
              canonicalTransitionEvents: Array.isArray(canonicalTransitionDecision.transitionEvents)
                ? canonicalTransitionDecision.transitionEvents
                : [],
              rawEvidenceEvent,
              stopDivergenceItems: Array.isArray(positionCtx && positionCtx.stopDivergenceItems)
                ? positionCtx.stopDivergenceItems
                : [],
              chosenStopSource: positionCtx && positionCtx.chosenStopSource || null,
              chosenStopPrice: positionCtx && Number.isFinite(Number(positionCtx.chosenStopPrice))
                ? Number(positionCtx.chosenStopPrice)
                : null,
              runnerFloorStop: positionCtx && Number.isFinite(Number(positionCtx.runnerFloorStop))
                ? Number(positionCtx.runnerFloorStop)
                : null,
              trailStopByR: positionCtx && Number.isFinite(Number(positionCtx.trailStopByR))
                ? Number(positionCtx.trailStopByR)
                : null,
              nativeStopPrice: positionCtx && Number.isFinite(Number(positionCtx.nativeStopPrice))
                ? Number(positionCtx.nativeStopPrice)
                : null,
              simplifiedExitV2Enabled: positionCtx && positionCtx.simplifiedExitV2Enabled === true,
              simplified_exit_v2_enabled: positionCtx && positionCtx.simplifiedExitV2Enabled === true,
              ...(exitLedgerPayload || {}),
              classificationVerified: !canonicalEntryLineageMissing
                && !String(event || "").trim().toUpperCase().endsWith("_UNVERIFIED"),
              alertStageHintTp0Done: (positionCtx && positionCtx.tpP0Done === true) || isTpP0Event(recentTp0 && recentTp0.event),
              alertStageHintTp1Done: (positionCtx && positionCtx.tpP1Done === true) || isTpP1Event(recentTp1 && recentTp1.event),
              alertStageHintTrailActive: positionCtx && positionCtx.trailActive === true,
              externalSyncHintStage: resolveExternalSyncHintStage({
                event,
                orderMeta,
                positionCtx,
                recentTp0,
                recentTp1,
              }),
              externalSyncOrderType: event === "EXIT_EXTERNAL_SYNC"
                ? (String(orderMeta && orderMeta.orderType || "").trim().toUpperCase() || null)
                : null,
              externalSyncClosePosition: event === "EXIT_EXTERNAL_SYNC"
                ? !!(orderMeta && orderMeta.closePosition === true)
                : null,
              features: (intent && intent.features_json && typeof intent.features_json === "object") ? intent.features_json : {},
              runId: `FILL_SYNC__${sym}`,
              orderId: Number.isFinite(Number(orderMeta && orderMeta.orderId)) ? Number(orderMeta.orderId) : null,
              clientOrderId: String(orderMeta && orderMeta.clientOrderId || "").trim() || null,
              sourceFillId: fillId,
              },
            });
          }
        }
      }

      if (positionEntryCache && typeof positionEntryCache.delete === "function") {
        positionEntryCache.delete(`BINANCEFUT:${sym}`);
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

  if (observedExitFill) {
    try {
      const dustClose = await closeTinyExternalResidualPosition({
        apiKey,
        apiSecret,
        symbol: sym,
        contextTag: "fill_sync",
        tradeMs: lastExitTradeMs,
      });
      if (dustClose && !dustClose.skipped) {
        console.warn(
          `[BINANCEFUT_FILL_SYNC_DUST_CLOSE] ${sym} side=${dustClose.side} qty=${dustClose.qty} reason=${dustClose.reason} order_id=${dustClose.orderId || "NA"}`
        );
      }
    } catch (e) {
      console.warn("[BINANCEFUT_FILL_SYNC_DUST_CLOSE_FAIL]", e && e.message ? e.message : String(e));
    }
    try {
      const syncResult = await reconcileExternalFillPositionSync({
        exchange: "BINANCEFUT",
        symbol: sym,
      });
      const syncedPosition = syncResult && syncResult.position ? syncResult.position : null;
      const syncedMeta = syncedPosition && typeof syncedPosition.meta === "object" ? syncedPosition.meta : {};
      const syncedState = String(syncedPosition && syncedPosition.state || "").toUpperCase();
      const syncedQtyBase = Number(syncedPosition && syncedPosition.qty_base);
      const hintedMeta = mergeRecentExitHintsIntoMeta(syncedMeta, {
        recentTp0: recentTp0BySymbol.get(sym) || null,
        recentTp1: recentTp1BySymbol.get(sym) || null,
        recentTrail: recentTrailBySymbol.get(sym) || null,
      });
      if (syncedPosition && syncedState === "ACTIVE" && Number.isFinite(syncedQtyBase) && syncedQtyBase > 0) {
        try {
          await requestBinanceNativeProtectionRefresh(buildFillSyncNativeProtectionRefreshArgs({
            exchange: "BINANCEFUT",
            symbol: sym,
            syncedPosition,
            hintedMeta,
          }));
        } catch (refreshErr) {
          console.warn("[BINANCEFUT_FILL_SYNC_NATIVE_REFRESH_FAIL]", refreshErr && refreshErr.message ? refreshErr.message : String(refreshErr));
        }
      }
    } catch (e) {
      console.warn("[BINANCEFUT_FILL_SYNC_POSITION_RECONCILE_FAIL]", e && e.message ? e.message : String(e));
    }
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

  // C2 persistence: write back the authority accumulator so a restart cannot
  // re-apply already-consumed qty. Failures are non-fatal.
  if (exitQtyAuthorityTouched.size > 0) {
    const patches = [];
    for (const [chainKey, meta] of exitQtyAuthorityTouched.entries()) {
      const state = exitQtyAuthorityMap.get(chainKey);
      if (!state) continue;
      patches.push({
        chainKey,
        exchange: "BINANCEFUT",
        symbol: sym,
        entryEventId: (meta && meta.entryEventId) || null,
        state,
      });
    }
    try {
      await persistExitAuthorityStates(db, patches);
    } catch (_err) {
      // silent — within-run Map already enforced the cap
    }
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
      const r = await runDistributedFillsSync({
        symbol: sym,
        runner: () => syncMarketTrades({
          apiKey: keys.apiKey,
          apiSecret: keys.apiSecret,
          symbol: sym,
          execTf: tf,
          lookbackMs: lookback,
          matchWindowMs,
          intents,
          maxPages,
        }),
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

  if (results.some((row) => row && row.ok === true && row.skipped !== true)) {
    syncState.lastRunAt = Date.now();
  }
  return { ok: true, tf, markets: list.length, results, intent_recovery: intentRecovery };
}

module.exports = {
  syncBinanceFuturesFills,
  __test: {
    buildExitLedgerMetaPatch,
    buildExitLedgerPayload,
    clearConsumedTakeProfitProtectionMeta,
    computeSyncedQtyPct,
    resolveIntentNotional,
    resolveIntentQtyBase,
    shouldEmitExternalFillSyncExitAlert,
    resolveAlertExitRules,
    normalizeExitEventForRules,
    resolveFillSyncAlertCloseRatio,
    resolveFillSyncAlertCloseRatioInfo,
    resolveFillSyncAlertFullExit,
    resolveTinyResidualCloseDecision,
    mergeFillSyncAlertCloseRatio,
    queueFillSyncAlertBatch,
    pickIntentForTrade,
    resolveExternalExitEvent,
    isSameOrderAsRecentTp1,
    isSameOrderAsRecentTp0,
    isSyntheticExternalFillExitEvent,
    isAuthoritativeForcedExitIntentEvent,
    isTrailExitEligible,
    classifyExitAuthorityStage,
    buildExitAuthorityChainKey,
    resolveExitAuthorityChainKey,
    observeExitAuthorityChainKeyConfidence,
    getFillSyncChainKeyConfidenceCounts,
    resetFillSyncChainKeyConfidenceForTest,
    applyExternalExitQtyAuthority,
    resolveCanonicalExternalExitEvent,
    shouldPromoteCanonicalExternalExit,
    inferStageConstrainedTakeProfitKind,
    applyActiveExitStageBackstopOverride,
    buildFillSyncNativeProtectionRefreshArgs,
    buildStageHintedMeta,
    mergeRecentExitHintsIntoMeta,
    buildImmediateProjectionIssues,
    auditImmediateProjectionEvents,
    auditProjectionEventImmediately,
    reconcileExternalFillPositionSync,
    shouldSendImmediateProjectionMismatchAlert,
    buildFillsSyncLeaseDocPath,
    runDistributedFillsSync,
    shouldLogFillSyncOverride,
    shouldSuppressMatchedExternalFillAlert,
    buildFillSyncAlertKey,
    buildFillSyncAlertChainKey,
    buildFillSyncAlertCooldownKey,
    resolveFillSyncAlertIdentityToken,
    resolveFillSyncAlertIdentityEvent,
    shouldSendFillSyncTradeAlert,
    flushFillSyncAlertBatches,
    canFinalizeIntentFromExternalFill,
    resolveExternalSyncHintStage,
    inferAuthoritativeForcedExitEventFromRefs,
    applyAuthoritativeForcedExitRefOverride,
    applyAuthoritativeExitContractOverride,
    applyAuthoritativeIntentEventOverride,
  },
};
