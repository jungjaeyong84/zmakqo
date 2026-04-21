"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function objectOrNull(value) {
  return value && typeof value === "object" ? value : null;
}

function resolveFallbackLeverage({
  positionCycle,
  protectionRuntime,
  env = process.env,
  defaultLeverage = 1,
} = {}) {
  const cycleLeverage = toNumberOrNull(positionCycle && positionCycle.leverage);
  if (cycleLeverage > 0) return cycleLeverage;
  const runtimeLeverage = toNumberOrNull(protectionRuntime && protectionRuntime.leverage);
  if (runtimeLeverage > 0) return runtimeLeverage;
  const envLeverage = toNumberOrNull(env && env.DONBEOLJA_V2_REPAIR_DEFAULT_LEVERAGE);
  if (envLeverage > 0) return envLeverage;
  return Math.max(1, Number(defaultLeverage) || 1);
}

function resolveExitRulesOverride({
  positionCycle,
  protectionRuntime,
} = {}) {
  return objectOrNull(protectionRuntime && protectionRuntime.exit_rules_override)
    || objectOrNull(positionCycle && positionCycle.exit_rules_override)
    || null;
}

function buildPosMeta({
  delegatedRepair,
  positionCycle,
  projection,
  protectionRuntime,
  exitRulesOverride,
} = {}) {
  return Object.freeze({
    position_cycle_id: trimOrNull(positionCycle && positionCycle.position_cycle_id),
    entry_event_id: trimOrNull(positionCycle && positionCycle.entry_event_id),
    signal_intent_id: trimOrNull(positionCycle && positionCycle.signal_intent_id),
    openclaw_decision_id: trimOrNull(positionCycle && positionCycle.openclaw_decision_id),
    position_side: upper(positionCycle && positionCycle.position_side),
    stage: upper(projection && projection.stage),
    tp1_done: projection && projection.tp1_done === true,
    trail_active: projection && projection.trail_active === true,
    native_protection_stop_price: toNumberOrNull(projection && projection.native_stop_price)
      ?? toNumberOrNull(protectionRuntime && protectionRuntime.native_stop_price),
    repair_request_id: trimOrNull(delegatedRepair && delegatedRepair.exit_repair_request_id),
    repair_issue_code: upper(delegatedRepair && delegatedRepair.issue_code),
    exit_rules_override: exitRulesOverride,
  });
}

async function resolveBinanceRepairTransportContext({
  delegatedRepair,
  command,
  env = process.env,
  db = null,
  resolveLiveCfg,
  defaultLeverage = 1,
} = {}) {
  if (typeof resolveLiveCfg !== "function") {
    throw new Error("BINANCE_REPAIR_LIVE_CFG_RESOLVER_REQUIRED");
  }
  const envelope = objectOrNull(delegatedRepair && delegatedRepair.envelope);
  if (!envelope) throw new Error("BINANCE_REPAIR_DELEGATION_ENVELOPE_REQUIRED");
  const positionCycle = objectOrNull(envelope.position_cycle_snapshot);
  if (!positionCycle) throw new Error("BINANCE_REPAIR_POSITION_CYCLE_SNAPSHOT_REQUIRED");
  const projection = objectOrNull(envelope.projection_snapshot) || {};
  const protectionRuntime = objectOrNull(envelope.protection_runtime_snapshot) || {};

  const commandCycleId = trimOrNull(command && command.position_cycle_id);
  const cycleId = trimOrNull(positionCycle.position_cycle_id);
  if (!cycleId) throw new Error("BINANCE_REPAIR_POSITION_CYCLE_ID_REQUIRED");
  if (commandCycleId && commandCycleId !== cycleId) {
    throw new Error("BINANCE_REPAIR_COMMAND_POSITION_CYCLE_MISMATCH");
  }
  if (trimOrNull(delegatedRepair && delegatedRepair.position_cycle_id) !== cycleId) {
    throw new Error("BINANCE_REPAIR_DELEGATED_POSITION_CYCLE_MISMATCH");
  }

  const symbol = upper(positionCycle.symbol);
  if (!symbol) throw new Error("BINANCE_REPAIR_SYMBOL_REQUIRED");
  const positionSide = upper(positionCycle.position_side);
  if (!["LONG", "SHORT"].includes(positionSide)) {
    throw new Error("BINANCE_REPAIR_POSITION_SIDE_INVALID");
  }
  const fallbackEntryPrice = toNumberOrNull(positionCycle.entry_price);
  if (!(fallbackEntryPrice > 0)) {
    throw new Error("BINANCE_REPAIR_ENTRY_PRICE_REQUIRED");
  }
  const fallbackLeverage = resolveFallbackLeverage({
    positionCycle,
    protectionRuntime,
    env,
    defaultLeverage,
  });
  if (!(fallbackLeverage > 0)) {
    throw new Error("BINANCE_REPAIR_LEVERAGE_REQUIRED");
  }

  const liveCfg = await resolveLiveCfg({
    env,
    db,
    delegatedRepair,
    command,
    positionCycle,
    projection,
    protectionRuntime,
  });
  if (!liveCfg || typeof liveCfg !== "object") {
    throw new Error("BINANCE_REPAIR_LIVE_CFG_REQUIRED");
  }

  const exitRulesOverride = resolveExitRulesOverride({
    positionCycle,
    protectionRuntime,
  });

  return Object.freeze({
    liveCfg,
    exchange: upper(positionCycle.exchange) || "BINANCEFUT",
    symbol,
    fallbackSide: positionSide === "SHORT" ? "SELL" : "BUY",
    fallbackEntryPrice,
    fallbackLeverage,
    exitRulesOverride,
    posMeta: buildPosMeta({
      delegatedRepair,
      positionCycle,
      projection,
      protectionRuntime,
      exitRulesOverride,
    }),
  });
}

function buildBinanceRepairTransportContextResolver({
  resolveLiveCfg,
  defaultLeverage = 1,
} = {}) {
  if (typeof resolveLiveCfg !== "function") {
    throw new Error("BINANCE_REPAIR_LIVE_CFG_RESOLVER_REQUIRED");
  }
  return function binanceRepairTransportContextResolver({ delegatedRepair, command, env, db } = {}) {
    return resolveBinanceRepairTransportContext({
      delegatedRepair,
      command,
      env,
      db,
      resolveLiveCfg,
      defaultLeverage,
    });
  };
}

module.exports = {
  buildBinanceRepairTransportContextResolver,
  resolveBinanceRepairTransportContext,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    resolveFallbackLeverage,
    resolveExitRulesOverride,
    buildPosMeta,
  },
};
