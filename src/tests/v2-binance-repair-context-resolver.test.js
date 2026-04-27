"use strict";

const assert = require("assert");
const { buildRepairDelegationEnvelope } = require("../v2/watchdogRepairRuntime");
const {
  buildBinanceRepairTransportContextResolver,
  resolveBinanceRepairTransportContext,
} = require("../v2/binanceRepairContextResolver");

function buildDelegatedRefreshRepair(overrides = {}) {
  const positionCycle = {
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ctx",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    position_side: "LONG",
    entry_event_id: "ENTRY__CTX",
    signal_intent_id: "SIG__CTX",
    openclaw_decision_id: "OCD__CTX",
    entry_price: 2500,
    ...overrides.positionCycle,
  };
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: {
      exit_repair_request_id: "RQRV2__TRAIL__CTX",
      position_cycle_id: positionCycle.position_cycle_id,
      stage: "TRAIL_ACTIVE",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
    },
    projection: {
      exit_runtime_projection_id: `ERPv2__${positionCycle.position_cycle_id}`,
      position_cycle_id: positionCycle.position_cycle_id,
      stage: "TRAIL_ACTIVE",
      tp1_done: true,
      trail_active: true,
      final_effective_stop: 2445,
      native_stop_price: 2420,
      chosen_stop_source: "TRAIL",
      ...overrides.projection,
    },
    protectionRuntime: {
      protection_runtime_id: `PRTV2__${positionCycle.position_cycle_id}`,
      position_cycle_id: positionCycle.position_cycle_id,
      native_stop_price: 2410,
      leverage: 3,
      exit_rules_override: {
        TP_P1: 0.025,
      },
      ...overrides.protectionRuntime,
    },
    positionCycle,
    placementStartedAt: "2026-04-21T06:30:00.000Z",
    placementRetryId: "CTX1",
  });
  return {
    exit_repair_request_id: "RQRV2__TRAIL__CTX",
    position_cycle_id: positionCycle.position_cycle_id,
    issue_code: "TRAIL_STOP_MISSING",
    requested_action: "REFRESH_NATIVE_STOP",
    envelope,
  };
}

(async function resolverUsesPositionCycleSnapshotAndInjectedLiveCfgOnly() {
  const delegatedRepair = buildDelegatedRefreshRepair();
  const context = await resolveBinanceRepairTransportContext({
    delegatedRepair,
    command: delegatedRepair.envelope.writer_delegation.command,
    resolveLiveCfg: async ({ positionCycle }) => ({
      apiKey: `key:${positionCycle.symbol}`,
      apiSecret: "secret",
    }),
  });
  assert.strictEqual(context.symbol, "ETHUSDT");
  assert.strictEqual(context.fallbackSide, "BUY");
  assert.strictEqual(context.fallbackEntryPrice, 2500);
  assert.strictEqual(context.fallbackLeverage, 3);
  assert.deepStrictEqual(context.exitRulesOverride, { TP_P1: 0.025 });
  assert.strictEqual(context.posMeta.tp1_done, true);
  assert.strictEqual(context.posMeta.trail_active, true);
  assert.strictEqual(context.posMeta.native_protection_stop_price, 2420);
  assert.strictEqual(context.liveCfg.apiKey, "key:ETHUSDT");
})();

(async function resolverRejectsMissingLiveCfgResolver() {
  let err = null;
  try {
    await resolveBinanceRepairTransportContext({
      delegatedRepair: buildDelegatedRefreshRepair(),
      command: {
        position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ctx",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_REPAIR_LIVE_CFG_RESOLVER_REQUIRED");
})();

(async function resolverRejectsMissingSymbolInsteadOfParsingCycleId() {
  const delegatedRepair = buildDelegatedRefreshRepair({
    positionCycle: {
      symbol: null,
      position_cycle_id: "PCY__BINANCEFUT__BTCUSDT__LONG__ctx",
    },
  });
  let err = null;
  try {
    await resolveBinanceRepairTransportContext({
      delegatedRepair,
      command: delegatedRepair.envelope.writer_delegation.command,
      resolveLiveCfg: async () => ({ apiKey: "key", apiSecret: "secret" }),
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_REPAIR_SYMBOL_REQUIRED");
})();

(async function resolverRejectsMissingEntryPriceAndInvalidSide() {
  let err = null;
  try {
    const delegatedRepair = buildDelegatedRefreshRepair({
      positionCycle: {
        entry_price: null,
      },
    });
    await resolveBinanceRepairTransportContext({
      delegatedRepair,
      command: delegatedRepair.envelope.writer_delegation.command,
      resolveLiveCfg: async () => ({ apiKey: "key", apiSecret: "secret" }),
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_REPAIR_ENTRY_PRICE_REQUIRED");

  err = null;
  try {
    const delegatedRepair = buildDelegatedRefreshRepair({
      positionCycle: {
        position_side: "FLAT",
      },
    });
    await resolveBinanceRepairTransportContext({
      delegatedRepair,
      command: delegatedRepair.envelope.writer_delegation.command,
      resolveLiveCfg: async () => ({ apiKey: "key", apiSecret: "secret" }),
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_REPAIR_POSITION_SIDE_INVALID");
})();

(async function resolverBuilderReturnsTransportCompatibleResolver() {
  const delegatedRepair = buildDelegatedRefreshRepair({
    protectionRuntime: {
      leverage: null,
    },
  });
  const resolver = buildBinanceRepairTransportContextResolver({
    defaultLeverage: 2,
    resolveLiveCfg: async () => ({
      apiKey: "key",
      apiSecret: "secret",
    }),
  });
  const context = await resolver({
    delegatedRepair,
    command: delegatedRepair.envelope.writer_delegation.command,
  });
  assert.strictEqual(context.fallbackLeverage, 2);
})();

console.log("V2_BINANCE_REPAIR_CONTEXT_RESOLVER_TEST_OK");
