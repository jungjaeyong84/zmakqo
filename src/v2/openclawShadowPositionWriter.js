"use strict";

const { buildV2EntryBootstrap } = require("./entryBootstrap");
const { buildProtectionRuntimeDoc } = require("./contracts");
const { putV2Doc } = require("./storage");
const { writeOpenClawShadowDecision, resolveShadowSignalIdentity } = require("./openclawShadowWriter");
const { resolveV2RuntimeConfig } = require("./runtime");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function resolvePositionWriterGate({ env = process.env, symbol = null } = {}) {
  const cfg = resolveV2RuntimeConfig(env);
  if (cfg.enabled !== true) return { ok: false, reason: "V2_DISABLED" };
  if (cfg.dryRun === true) return { ok: false, reason: "V2_DRY_RUN" };
  if (!parseBool(env.DONBEOLJA_V2_SHADOW_POSITION_WRITE_ENABLED, false)) {
    return { ok: false, reason: "V2_SHADOW_POSITION_WRITE_DISABLED" };
  }
  const normalizedSymbol = upper(symbol);
  if (
    cfg.canaryOnly === true &&
    Array.isArray(cfg.canarySymbols) &&
    cfg.canarySymbols.length > 0 &&
    normalizedSymbol &&
    !cfg.canarySymbols.includes(normalizedSymbol)
  ) {
    return { ok: false, reason: "V2_CANARY_SYMBOL_FILTERED" };
  }
  return { ok: true, reason: "V2_SHADOW_POSITION_WRITE_ENABLED" };
}

function resolvePositionSide(value) {
  const token = upper(value);
  if (token === "BUY") return "LONG";
  if (token === "SELL") return "SHORT";
  if (token === "LONG" || token === "SHORT") return token;
  return null;
}

function computePctDistance({ entryPrice = null, targetPrice = null } = {}) {
  const entry = toNumberOrNull(entryPrice);
  const target = toNumberOrNull(targetPrice);
  if (!(Number.isFinite(entry) && entry > 0 && Number.isFinite(target) && target > 0)) return null;
  return Math.abs(target - entry) / entry;
}

function resolveTp1QtyRatio({ entryQtyAbs = null, tp1QtyAbs = null } = {}) {
  const entryQty = toNumberOrNull(entryQtyAbs);
  const tpQty = toNumberOrNull(tp1QtyAbs);
  if (!(Number.isFinite(entryQty) && entryQty > 0 && Number.isFinite(tpQty) && tpQty > 0)) return null;
  const ratio = tpQty / entryQty;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null;
  return ratio;
}

function resolveProtectionMeta(meta = {}) {
  const source = meta && typeof meta === "object" ? meta : {};
  return Object.freeze({
    slOrderId: trimOrNull(source.native_protection_stop_order_id),
    tp1OrderId: trimOrNull(source.native_protection_tp_order_id),
    nativeStopPrice: toNumberOrNull(source.native_protection_stop_price),
    nativeTp1Price: toNumberOrNull(source.native_protection_tp_price),
    nativeTp1QtyAbs: toNumberOrNull(source.native_protection_tp_qty_base),
    nativeRefreshStatus: upper(source.native_protection_refresh_status) || "UNKNOWN",
    lastRefreshAt: Number.isFinite(Number(source.native_protection_refresh_at_ms))
      ? new Date(Number(source.native_protection_refresh_at_ms)).toISOString()
      : null,
    lastGapMs: toNumberOrNull(source.native_protection_unprotected_window_ms),
  });
}

function protectionIsComplete(protection = {}) {
  return !!(
    trimOrNull(protection.slOrderId) &&
    trimOrNull(protection.tp1OrderId) &&
    Number.isFinite(protection.nativeStopPrice) &&
    Number.isFinite(protection.nativeTp1Price)
  );
}

function resolveHealthStatus(protection = {}) {
  return protection.nativeRefreshStatus === "OK" ? "HEALTHY" : "DEGRADED_REPAIRABLE";
}

function buildApprovedRuleResult(fillContext = {}) {
  return {
    ok: true,
    reason: "OPENCLAW_EXECUTOR_OK",
    qtyPctFinal: toNumberOrNull(fillContext.qtyPctFinal) ?? 1,
    authority: {
      entryBudgetGuard: {
        applicable: false,
        ok: true,
        reason: "ENTRY_BUDGET_GUARD_NOT_EVALUATED",
      },
    },
  };
}

async function persistEntryBootstrap({ db = null, env = process.env, bootstrap, protectionRuntime } = {}) {
  const writes = [];
  writes.push(await putV2Doc({
    db,
    env,
    collectionKey: "POSITION_CYCLES",
    doc: bootstrap.positionCycle,
  }));
  writes.push(await putV2Doc({
    db,
    env,
    collectionKey: "EXIT_RUNTIME_PROJECTIONS",
    doc: bootstrap.projection,
  }));
  writes.push(await putV2Doc({
    db,
    env,
    collectionKey: "PROTECTION_RUNTIME",
    doc: protectionRuntime,
  }));
  return writes;
}

async function writeOpenClawShadowEntryBootstrap({
  db = null,
  env = process.env,
  input = {},
  fillContext = {},
} = {}) {
  const symbol = upper((input && input.symbol) || (fillContext && fillContext.symbol));
  const gate = resolvePositionWriterGate({ env, symbol });
  if (gate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: gate.reason,
    };
  }

  const positionSide = resolvePositionSide(fillContext.positionSide || input.side);
  const entryPrice = toNumberOrNull(fillContext.entryPrice);
  const entryQtyAbs = toNumberOrNull(fillContext.entryQtyAbs);
  const entryEventId = trimOrNull(fillContext.entryEventId);
  const entryOrderId = trimOrNull(fillContext.entryOrderId);
  const entryFillGroupId = trimOrNull(fillContext.entryFillGroupId);
  const protection = resolveProtectionMeta(fillContext.protectionMeta);

  if (!positionSide || !entryEventId || !entryOrderId || !entryFillGroupId) {
    return {
      ok: false,
      written: false,
      skipped: false,
      reason: "V2_SHADOW_ENTRY_BOOTSTRAP_CONTEXT_INCOMPLETE",
    };
  }
  if (!(Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(entryQtyAbs) && entryQtyAbs > 0)) {
    return {
      ok: false,
      written: false,
      skipped: false,
      reason: "V2_SHADOW_ENTRY_BOOTSTRAP_ENTRY_METRICS_INVALID",
    };
  }
  if (!protectionIsComplete(protection)) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: "V2_SHADOW_BOOTSTRAP_PROTECTION_INCOMPLETE",
    };
  }

  const signalWrite = await writeOpenClawShadowDecision({
    db,
    env,
    input,
    ruleResult: buildApprovedRuleResult(fillContext),
    composite: {
      accept: true,
      scale: 1,
      reason_trace: ["RULE:OPENCLAW_EXECUTOR_OK", "ENTRY_BOOTSTRAP_APPROVED"],
    },
  });

  const identity = resolveShadowSignalIdentity({
    input,
    recommendedAction: "APPROVE_ENTRY",
    decisionMode: "SHADOW",
  });
  const signalIntentId = trimOrNull(signalWrite && signalWrite.signal_intent_id) || identity.signalIntentId;
  const openclawDecisionId = trimOrNull(signalWrite && signalWrite.openclaw_decision_id) || identity.openclawDecisionId;

  const stopLossPct = computePctDistance({ entryPrice, targetPrice: protection.nativeStopPrice });
  const tp1TargetPct = computePctDistance({ entryPrice, targetPrice: protection.nativeTp1Price });
  const tp1QtyRatio = resolveTp1QtyRatio({ entryQtyAbs, tp1QtyAbs: protection.nativeTp1QtyAbs }) || 0.5;
  const bootstrap = buildV2EntryBootstrap({
    exchange: upper(input.exchange) || "BINANCEFUT",
    symbol,
    entryEventId,
    entryOrderId,
    entryFillGroupId,
    entryIntentId: trimOrNull(fillContext.entryIntentId),
    signalIntentId,
    openclawDecisionId,
    positionSide,
    entryPrice,
    entryQtyAbs,
    stopLossPct: stopLossPct || 0.0165,
    tp1TargetPct: tp1TargetPct || 0.0168,
    tp1QtyRatio,
  });

  const projection = {
    ...bootstrap.projection,
    chosen_stop_price: protection.nativeStopPrice,
    final_effective_stop: protection.nativeStopPrice,
    native_stop_price: protection.nativeStopPrice,
    health_status: resolveHealthStatus(protection),
  };
  const protectionRuntime = buildProtectionRuntimeDoc({
    positionCycleId: bootstrap.positionCycle.position_cycle_id,
    slOrderId: protection.slOrderId,
    tp1OrderId: protection.tp1OrderId,
    nativeStopPrice: protection.nativeStopPrice,
    nativeTp1Price: protection.nativeTp1Price,
    nativeRefreshStatus: protection.nativeRefreshStatus,
    lastRefreshAt: protection.lastRefreshAt,
    lastGapMs: protection.lastGapMs,
    healthStatus: resolveHealthStatus(protection),
  });

  const writes = await persistEntryBootstrap({
    db,
    env,
    bootstrap: {
      ...bootstrap,
      projection,
    },
    protectionRuntime,
  });

  return {
    ok: true,
    written: true,
    skipped: false,
    reason: "V2_SHADOW_ENTRY_BOOTSTRAP_OK",
    position_cycle_id: bootstrap.positionCycle.position_cycle_id,
    signal_intent_id: signalIntentId,
    openclaw_decision_id: openclawDecisionId,
    writes,
  };
}

module.exports = {
  writeOpenClawShadowEntryBootstrap,
  __test: {
    resolvePositionWriterGate,
    resolveProtectionMeta,
    protectionIsComplete,
    computePctDistance,
    resolveTp1QtyRatio,
  },
};
