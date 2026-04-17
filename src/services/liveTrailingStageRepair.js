"use strict";

const {
  fetchBinanceFuturesAccount,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
} = require("../exchanges/binanceFuturesPrivate");
const { computeRunnerExitStopPrice } = require("../engine/signalEngine");
const {
  requestBinanceNativeProtectionRefresh,
} = require("../engine/paperBinanceRunner");
const { resolveBinanceKeys } = require("./binanceApiKeys");
const { upsertTrailObservation } = require("../storage/positionRuntimeObservations");
const { getPosition, upsertPositionMetaOnly } = require("../storage/positionsPaper");
const {
  resolveCanonicalPositionExitStage,
  buildExitQuantityContractLedger,
  validateExitQuantityContractLedger,
} = require("./positionStateMachine");
const { isSimplifiedExitV2Active } = require("./simplifiedExitV2");

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function shouldEnforceSingleStopWriter() {
  return true;
}

function resolveNonAuthorityRepairStatus() {
  return "REPAIR_REQUESTED_NON_AUTHORITY_LAYER";
}

function sanitizeNativeProtectionResultForNonAuthority(result = null) {
  return {
    ok: false,
    skipped: true,
    reason: resolveNonAuthorityRepairStatus(),
    requested: true,
    source_result: result || null,
  };
}

function isSimplifiedExitV2Position(positionSnapshot = null) {
  const snapshot = positionSnapshot && typeof positionSnapshot === "object" ? positionSnapshot : {};
  const meta = snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
  return isSimplifiedExitV2Active(meta);
}

function resolveRepairTargetStage({
  positionSnapshot = null,
  externalQty = null,
} = {}) {
  const simplifiedExitV2Enabled = isSimplifiedExitV2Position(positionSnapshot);
  const canonical = resolveCanonicalPositionExitStage({
    positionSnapshot,
    simplifiedExitV2Enabled,
  });
  const currentQty = Number(externalQty);
  if (canonical.stage === "TRAIL") {
    return {
      stage: "TRAIL",
      source: canonical.source,
      reason: "CANONICAL_TRAIL_STAGE",
    };
  }
  if (canonical.stage === "TP1" && Number.isFinite(currentQty) && currentQty > 0) {
    return {
      stage: "TRAIL",
      source: "CANONICAL_TP1_WITH_OPEN_RUNNER",
      reason: "TP1_DONE_WITH_OPEN_RUNNER",
    };
  }
  if (simplifiedExitV2Enabled === true && positionSnapshot && positionSnapshot.meta && positionSnapshot.meta.tp_p0_done === true) {
    return {
      stage: null,
      source: canonical.source,
      reason: "V2_TP0_STAGE_REJECTED",
    };
  }
  if (simplifiedExitV2Enabled === true && canonical.stage === "TP0") {
    return {
      stage: null,
      source: canonical.source,
      reason: "V2_TP0_STAGE_REJECTED",
    };
  }
  if (canonical.stage === "TP0") {
    return {
      stage: "TP0",
      source: canonical.source,
      reason: "CANONICAL_TP0_STAGE",
    };
  }
  return {
    stage: null,
    source: canonical.source || null,
    reason: "CANONICAL_STAGE_REQUIRED",
  };
}

function buildRepairedMeta(meta = {}, stageInfo = {}) {
  const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
  const stage = normalizeSymbol(stageInfo.stage);
  const simplifiedExitV2Enabled = isSimplifiedExitV2Position({ meta: nextMeta });
  if (simplifiedExitV2Enabled !== true && (stage === "TP0" || stage === "TRAIL")) {
    nextMeta.tp_p0_done = true;
    nextMeta.tp_p0_source = nextMeta.tp_p0_source || "LIVE_STAGE_REPAIR";
  }
  if (stage === "TRAIL") {
    if (simplifiedExitV2Enabled !== true) nextMeta.tp_p0_done = true;
    nextMeta.tp_p1_done = true;
    nextMeta.trail_active = true;
    nextMeta.tp_p1_pending = false;
    nextMeta.tp_p1_pending_at_ms = null;
    nextMeta.tp_p1_pending_until_ms = null;
    nextMeta.tp_p1_pending_event = null;
    nextMeta.tp_p1_source = nextMeta.tp_p1_source || "LIVE_STAGE_REPAIR";
  }
  if ((simplifiedExitV2Enabled !== true && stage === "TP0") || stage === "TRAIL") {
    // C17 invariant: canonical_exit_stage is the single source of truth on
    // position meta going forward. Writing both fields previously created a
    // dual-owner problem where drift between them could silently diverge.
    nextMeta.canonical_exit_stage = stage;
    // Retain any historical authoritative_exit_stage value so readers with
    // the legacy fallback keep working during the migration window; do NOT
    // write a fresh authoritative_exit_stage here.
  }
  return nextMeta;
}

async function patchPositionMetaOnlyWithRetry({
  exchange,
  symbol,
  executionMode,
  nextMeta,
} = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const current = await getPosition({ exchange, symbol });
    if (!current) throw new Error(`POSITION_NOT_FOUND ${symbol}`);
    try {
      const updated = await upsertPositionMetaOnly({
        exchange,
        symbol,
        runId: `RUN__LIVE_STAGE_REPAIR__${exchange}__${symbol}__${Date.now()}`,
        executionMode: executionMode || current.execution_mode || "LIVE",
        meta: nextMeta,
        source: "LIVE_STAGE_REPAIR",
        mutationKind: "POSITION_META_UPSERT",
        reason: "LIVE_STAGE_REPAIR",
        expectedWriteToken: current.position_write_token || null,
        suppressAuthorityRuntimeFamily: true,
        suppressAuthorityRuntimeFamilyReason: "LIVE_STAGE_REPAIR",
      });
      return updated;
    } catch (err) {
      const code = String(err && (err.code || err.message) || "").toUpperCase();
      if (!code.includes("POSITION_WRITE_TOKEN_MISMATCH") || attempt >= 3) throw err;
    }
  }
  throw new Error(`POSITION_WRITE_TOKEN_MISMATCH_RETRY_EXHAUSTED ${symbol}`);
}

async function fetchOpenOrderSnapshot(keys, symbol) {
  const [openOrders, algoOrders] = await Promise.all([
    fetchFuturesOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol }).catch(() => []),
    fetchFuturesAlgoOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol }).catch(() => []),
  ]);
  return {
    openOrders: Array.isArray(openOrders) ? openOrders : [],
    algoOrders: Array.isArray(algoOrders) ? algoOrders : [],
  };
}

async function repairLiveTrailingStageForSymbol({
  exchange = "BINANCEFUT",
  symbol,
  keys = null,
} = {}) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return { ok: false, skipped: true, reason: "SYMBOL_REQUIRED" };
  const resolvedKeys = keys || await resolveBinanceKeys();
  if (!resolvedKeys || !resolvedKeys.apiKey || !resolvedKeys.apiSecret) {
    return { ok: false, skipped: true, reason: "BINANCE_KEYS_MISSING" };
  }
  const account = await fetchBinanceFuturesAccount(resolvedKeys);
  const accountRow = (account.positions || []).find((row) => normalizeSymbol(row && row.symbol) === sym && Number(row.positionAmt || 0) !== 0);
  if (!accountRow) return { ok: true, skipped: true, reason: "NO_EXTERNAL_ACTIVE_POSITION", symbol: sym };
  const positionAmt = Number(accountRow && accountRow.positionAmt);
  const positionSide = positionAmt < 0 ? "SHORT" : "LONG";
  const positionQty = Math.abs(positionAmt);
  const position = await getPosition({ exchange, symbol: sym });
  if (!position || String(position.state || "").toUpperCase() !== "ACTIVE") {
    return { ok: true, skipped: true, reason: "POSITION_READ_MODEL_MISSING", symbol: sym };
  }
  const meta = (position.meta && typeof position.meta === "object") ? position.meta : {};
  const repairStage = resolveRepairTargetStage({
    positionSnapshot: position,
    externalQty: positionQty,
  });
  if (repairStage.stage !== "TRAIL" && repairStage.stage !== "TP0") {
    return {
      ok: true,
      skipped: true,
      reason: repairStage.reason || "CANONICAL_STAGE_REQUIRED",
      symbol: sym,
      canonical_stage: repairStage.stage,
      canonical_stage_source: repairStage.source,
    };
  }
  const nextMeta = buildRepairedMeta(meta, repairStage);
  // C3 invariant: repair writes must pass the absolute-qty contract validator.
  // The ledger is rebuilt from the *repaired* meta against the live exchange
  // qty so that a stale canonical snapshot cannot self-heal a broken state.
  const repairLedger = buildExitQuantityContractLedger({
    positionSnapshot: {
      qty_base: positionQty,
      entry_qty_base: nextMeta.entry_qty_base
        ?? nextMeta.entry_qty_abs
        ?? meta.entry_qty_base
        ?? meta.entry_qty_abs
        ?? position.entry_qty_base
        ?? null,
      meta: nextMeta,
      position_side: positionSide,
    },
    rules: nextMeta.exit_rules_override || meta.exit_rules_override || null,
  });
  const repairLedgerValidation = validateExitQuantityContractLedger({
    ledger: repairLedger,
    positionSnapshot: {
      state: String(position.state || "").toUpperCase(),
      position_state: position.position_state,
      size_pct: position.size_pct,
      qty_base: positionQty,
      entry_qty_base: repairLedger.entry_qty_abs,
      meta: nextMeta,
    },
  });
  if (repairLedgerValidation && repairLedgerValidation.blocked === true) {
    return {
      ok: false,
      skipped: true,
      reason: "LEDGER_INVARIANT_VIOLATION",
      symbol: sym,
      canonical_stage: repairStage.stage,
      canonical_stage_source: repairStage.source,
      issues: Array.isArray(repairLedgerValidation.issues) ? repairLedgerValidation.issues : [],
    };
  }
  const singleStopWriter = shouldEnforceSingleStopWriter();
  await patchPositionMetaOnlyWithRetry({
    exchange,
    symbol: sym,
    executionMode: position.execution_mode || "LIVE",
    nextMeta,
  });
  let nativeProtection = null;
  const nativeProtectionRequest = await requestBinanceNativeProtectionRefresh({
    exchange,
    symbol: sym,
    fallbackSide: positionSide,
    fallbackEntryPrice: Number(position.avg_price),
    fallbackLeverage: Number(position.leverage || meta.external_leverage || meta.leverage || 1),
    exitRulesOverride: nextMeta.exit_rules_override || null,
    posMeta: nextMeta,
    source: "LIVE_TRAILING_STAGE_REPAIR",
    reason: "NON_AUTHORITY_LAYER_REQUEST",
    dispatchReason: `LIVE_TRAILING_STAGE_REPAIR_NATIVE_STOP_REFRESH_${String(exchange || "").toUpperCase()}_${String(sym || "").toUpperCase()}`,
  });
  nativeProtection = singleStopWriter
    ? sanitizeNativeProtectionResultForNonAuthority(nativeProtectionRequest)
    : nativeProtectionRequest;
  const entryPrice = Number(position.avg_price);
  const leverage = Number(position.leverage || meta.external_leverage || meta.leverage || 1);
  const runnerExit = computeRunnerExitStopPrice({
    avg: entryPrice,
    leverageEff: leverage,
    side: positionSide,
    rules: nextMeta.exit_rules_override || {},
    tpP1Done: nextMeta.tp_p1_done === true,
    trailActive: nextMeta.trail_active === true,
    trailHigh: Number(nextMeta.trail_high),
    trailLow: Number(nextMeta.trail_low),
    entryRDistance: Number(nextMeta.entry_r_distance),
  });
  await upsertTrailObservation({
    exchange,
    symbol: sym,
    side: positionSide,
    entryEventId: nextMeta.entry_event_id || null,
    entryExecBarMs: Number(nextMeta.entry_exec_bar_ms) || null,
    entryPrice,
    entryRDistance: Number(nextMeta.entry_r_distance) || null,
    trailRMultiple: Number(nextMeta.trail_r_multiple || (nextMeta.exit_rules_override && nextMeta.exit_rules_override.TRAIL_R_MULTIPLE)) || null,
    trailHigh: Number(nextMeta.trail_high) || null,
    trailHighAtMs: Number(nextMeta.trail_high_at_ms) || null,
    trailLow: Number(nextMeta.trail_low) || null,
    trailLowAtMs: Number(nextMeta.trail_low_at_ms) || null,
    runnerFloorStop: Number(runnerExit && runnerExit.runnerFloorStop) || null,
    computedTrailStop: Number(runnerExit && runnerExit.stopPrice) || null,
    trailStopRaw: Number(runnerExit && runnerExit.trailStop) || null,
    trailStopByR: Number(runnerExit && runnerExit.trailStopByR) || null,
    trailStopByPct: Number(runnerExit && runnerExit.trailStopByPct) || null,
    chosenStopSource: runnerExit && runnerExit.stopSource ? runnerExit.stopSource : null,
    chosenStopPrice: Number(runnerExit && runnerExit.stopPrice) || null,
    finalEffectiveStop: Number(runnerExit && runnerExit.stopPrice) || null,
    nativeStopPrice: Number(nextMeta.native_protection_stop_price || meta.native_protection_stop_price) || null,
    nativeStopOrderId: nextMeta.native_protection_stop_order_id || meta.native_protection_stop_order_id || null,
    nativeRefreshStatus: singleStopWriter
      ? resolveNonAuthorityRepairStatus()
      : (nativeProtection && nativeProtection.ok === true ? "OK" : String(nativeProtection && nativeProtection.reason || "FAILED")),
    lastRepriceAtMs: Date.now(),
    runtimeEvalAtMs: Date.now(),
    source: "LIVE_STAGE_REPAIR",
  });
  const orders = await fetchOpenOrderSnapshot(resolvedKeys, sym);
  return {
    ok: true,
    symbol: sym,
    stage: repairStage.stage,
    canonical_stage_source: repairStage.source,
    remaining_qty: positionQty,
    native_protection: nativeProtection,
    open_orders_n: orders.openOrders.length,
    algo_orders_n: orders.algoOrders.length,
    open_orders: orders.openOrders,
    algo_orders: orders.algoOrders,
  };
}

module.exports = {
  repairLiveTrailingStageForSymbol,
  __test: {
    resolveRepairTargetStage,
    buildRepairedMeta,
    shouldEnforceSingleStopWriter,
    resolveNonAuthorityRepairStatus,
    sanitizeNativeProtectionResultForNonAuthority,
  },
};
