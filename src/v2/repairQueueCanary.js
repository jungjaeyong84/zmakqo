"use strict";

const { V2_COLLECTIONS } = require("./constants");
const {
  buildPositionCycleDoc,
  buildExitRuntimeProjectionDoc,
  buildProtectionRuntimeDoc,
  buildRepairRequestDoc,
} = require("./contracts");
const { runRepairQueueLiveService } = require("./repairQueueLiveService");
const { buildDelegatedRepairExecutor } = require("./repairDelegatedExecutor");
const { buildBinanceRefreshNativeStopTransport } = require("./binanceProtectionTransport");
const { buildBinanceRepairTransportContextResolver } = require("./binanceRepairContextResolver");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeRefreshCall(call = {}) {
  const row = call && typeof call === "object" ? call : {};
  return Object.freeze({
    exchange: trimOrNull(row.exchange),
    symbol: trimOrNull(row.symbol),
    fallbackSide: trimOrNull(row.fallbackSide),
    fallbackEntryPrice: Number.isFinite(Number(row.fallbackEntryPrice)) ? Number(row.fallbackEntryPrice) : null,
    fallbackLeverage: Number.isFinite(Number(row.fallbackLeverage)) ? Number(row.fallbackLeverage) : null,
    writerSource: trimOrNull(row.writerSource),
    liveDryRun: row.liveCfg && row.liveCfg.liveDryRun === true,
    credentialKeyPresent: !!(row.liveCfg && trimOrNull(row.liveCfg.apiKey)),
    credentialSecretPresent: !!(row.liveCfg && trimOrNull(row.liveCfg.apiSecret)),
    posMeta: row.posMeta && typeof row.posMeta === "object"
      ? Object.freeze({
          position_cycle_id: trimOrNull(row.posMeta.position_cycle_id),
          position_side: trimOrNull(row.posMeta.position_side),
          stage: trimOrNull(row.posMeta.stage),
          tp1_done: row.posMeta.tp1_done === true,
          trail_active: row.posMeta.trail_active === true,
          repair_issue_code: trimOrNull(row.posMeta.repair_issue_code),
        })
      : null,
  });
}

function buildMemoryDb({ docsByCollectionKey = {} } = {}) {
  const writes = [];
  const store = {};
  for (const [key, rows] of Object.entries(docsByCollectionKey || {})) {
    store[key] = {};
    for (const [id, row] of Object.entries(rows || {})) {
      store[key][id] = cloneJson(row);
    }
  }
  function collectionKeyFromName(name) {
    const text = String(name || "").trim();
    return Object.entries(V2_COLLECTIONS).find(([, suffix]) => text.endsWith(suffix))?.[0] || null;
  }
  return Object.freeze({
    __writes: writes,
    collection(name) {
      function rowsForCollection() {
        const key = collectionKeyFromName(name);
        return key && store[key] ? Object.values(store[key]) : [];
      }
      return {
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  const rows = rowsForCollection().filter((row) => {
                    if (op !== "==") return false;
                    return row && row[field] === value;
                  });
                  return {
                    docs: rows.slice(0, Math.max(1, Number(limit) || 1)).map((row) => ({ data: () => row })),
                  };
                },
              };
            },
          };
        },
        limit(limit) {
          return {
            async get() {
              const rows = rowsForCollection();
              return {
                docs: rows.slice(0, Math.max(1, Number(limit) || 1)).map((row) => ({ data: () => row })),
              };
            },
          };
        },
        doc(id) {
          return {
            async set(payload, options) {
              const key = collectionKeyFromName(name);
              if (key) {
                if (!store[key]) store[key] = {};
                store[key][id] = cloneJson(payload);
              }
              writes.push({ collection: name, docId: id, payload: cloneJson(payload), options: cloneJson(options || {}) });
            },
            async get() {
              const key = collectionKeyFromName(name);
              const doc = key && store[key] ? store[key][id] : null;
              return {
                exists: !!doc,
                data() {
                  return doc;
                },
              };
            },
          };
        },
      };
    },
  });
}

function buildRepairQueueCanaryFixture({
  recordedAt = "2026-04-21T07:30:00.000Z",
} = {}) {
  const positionCycle = {
    ...buildPositionCycleDoc({
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      entryEventId: "ENTRY__V2_REPAIR_CANARY",
      entryOrderId: "ORDER__V2_REPAIR_CANARY",
      entryFillGroupId: "FILL_GROUP__V2_REPAIR_CANARY",
      signalIntentId: "SIG__V2_REPAIR_CANARY",
      openclawDecisionId: "OCD__V2_REPAIR_CANARY",
      positionSide: "LONG",
      entryPrice: 2500,
      entryQtyAbs: 1,
      createdAt: recordedAt,
    }),
    leverage: 2,
    exit_rules_override: {
      SL: 0.0165,
      TP_P1: 0.025,
      TP_P1_QTY: 1,
      BE_ENABLE: false,
      BE_PCT: null,
      TRAIL_R_MULTIPLE: null,
      RUNNER_MIN_PROFIT_PCT: null,
    },
  };
  const positionCycleId = positionCycle.position_cycle_id;
  const projection = buildExitRuntimeProjectionDoc({
    positionCycleId,
    stage: "PRE_TP1",
    tp1Done: false,
    trailActive: false,
    entryQtyAbs: 1,
    tp1TargetPrice: 2562.5,
    tp1TargetQtyAbs: 1,
    tp1FilledQtyAbs: 0,
    runnerRemainingQtyAbs: 0,
    runnerFloorStop: null,
    trailStopByR: null,
    chosenStopSource: "SL",
    chosenStopPrice: 2458.75,
    finalEffectiveStop: 2458.75,
    nativeStopPrice: null,
    healthStatus: "DEGRADED_REPAIRABLE",
  });
  const protectionRuntime = {
    ...buildProtectionRuntimeDoc({
      positionCycleId,
      slOrderId: "STOP__OLD_CANARY",
      tp1OrderId: "TP1__CANARY_OK",
      nativeStopPrice: null,
      nativeTp1Price: 2562.5,
      nativeRefreshStatus: "ERROR",
      lastRefreshAt: recordedAt,
      lastGapMs: 1000,
      healthStatus: "DEGRADED_REPAIRABLE",
      slOrderStatus: "FAILED",
      tp1OrderStatus: "PLACED",
      runtimeWriteReason: "REFRESH_STOP_FAILED",
      placementIssueCodes: ["NATIVE_REFRESH_UNHEALTHY", "UNPROTECTED_ACTIVE_POSITION"],
      placementAttemptId: "PRATT__OLD_CANARY",
      placementRetryId: "OLD",
      placementStartedAt: recordedAt,
      placementFinishedAt: recordedAt,
      slAckAt: null,
      tp1AckAt: recordedAt,
    }),
    leverage: 2,
    exit_rules_override: positionCycle.exit_rules_override,
  };
  const repairRequest = buildRepairRequestDoc({
    positionCycleId,
    stage: "PRE_TP1",
    issueCode: "NATIVE_REFRESH_UNHEALTHY",
    healthStatus: "DEGRADED_REPAIRABLE",
    requestedAction: "REFRESH_NATIVE_STOP",
    detail: {
      canary_fixture: true,
      expected_stop_price: 2458.75,
    },
    createdAt: recordedAt,
  });
  const docsByCollectionKey = {
    POSITION_CYCLES: {
      [positionCycleId]: positionCycle,
    },
    EXIT_RUNTIME_PROJECTIONS: {
      [projection.exit_runtime_projection_id]: projection,
    },
    PROTECTION_RUNTIME: {
      [protectionRuntime.protection_runtime_id]: protectionRuntime,
    },
    REPAIR_REQUESTS: {
      [repairRequest.exit_repair_request_id]: repairRequest,
    },
  };
  return Object.freeze({
    positionCycleId,
    expectedStopPrice: 2458.75,
    docsByCollectionKey,
  });
}

function buildCanaryExecutor({
  fixture,
  refreshCalls,
  recordedAt,
} = {}) {
  const resolveContext = buildBinanceRepairTransportContextResolver({
    resolveLiveCfg: async () => ({
      executionMode: "LIVE_DRY_RUN",
      liveEnabled: false,
      liveDryRun: true,
      apiKey: "canary-key",
      apiSecret: "canary-secret",
      leverage: 2,
    }),
  });
  const refreshNativeStop = buildBinanceRefreshNativeStopTransport({
    now: () => recordedAt,
    resolveContext,
    refreshNativeProtectionWithRetry: async (payload) => {
      refreshCalls.push(sanitizeRefreshCall(payload));
      return {
        ok: true,
        stop_order_id: "STOP__V2_REPAIR_CANARY_DRY_RUN",
        stop_price: fixture.expectedStopPrice,
        stop_ack_ms: Date.parse(recordedAt),
        dry_run: true,
        exchange_write_performed: false,
      };
    },
  });
  return buildDelegatedRepairExecutor({
    recordedAt,
    transports: {
      refreshNativeStop,
    },
  });
}

function evaluateCanaryResult({ serviceResult, refreshCalls, db } = {}) {
  const summary = serviceResult && serviceResult.summary ? serviceResult.summary : {};
  const completionAttempts = serviceResult && serviceResult.live_worker_run
    ? serviceResult.live_worker_run.completion_attempts
    : [];
  const ledgerWrites = Array.isArray(db && db.__writes)
    ? db.__writes.filter((row) => String(row.collection || "").endsWith(V2_COLLECTIONS.REPAIR_EXECUTION_LEDGER))
    : [];
  const invariants = Object.freeze({
    service_healthy: serviceResult && serviceResult.ok === true && serviceResult.status === "HEALTHY",
    exactly_one_repair_requested: Number(summary.requested_repair_n) === 1,
    exactly_one_delegated: Number(summary.delegated_repair_n) === 1,
    no_skips: Number(summary.skipped_repair_n) === 0,
    no_missing_context: Number(summary.missing_context_n) === 0,
    completion_succeeded: Number(summary.completion_success_n) === 1 && Number(summary.completion_failed_n) === 0,
    refresh_transport_called_once: refreshCalls.length === 1,
    no_exchange_write: true,
    completion_ledger_success: completionAttempts.some((row) => (
      row && row.completion_ledger && row.completion_ledger.execution_status === "COMPLETED_SUCCESS"
    )),
    delegated_and_completion_ledgers_written: ledgerWrites.length === 2,
  });
  const failed = Object.entries(invariants)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);
  return Object.freeze({
    ok: failed.length === 0,
    failed_invariants: Object.freeze(failed),
    invariants,
    ledger_write_n: ledgerWrites.length,
  });
}

async function runRepairQueueCanary({
  env = process.env,
  recordedAt = null,
} = {}) {
  const at = trimOrNull(recordedAt) || new Date().toISOString();
  const fixture = buildRepairQueueCanaryFixture({ recordedAt: at });
  const db = buildMemoryDb({ docsByCollectionKey: fixture.docsByCollectionKey });
  const refreshCalls = [];
  const executeDelegatedRepair = buildCanaryExecutor({
    fixture,
    refreshCalls,
    recordedAt: at,
  });
  const serviceResult = await runRepairQueueLiveService({
    db,
    env: {
      ...env,
      DONBEOLJA_V2_COLLECTION_PREFIX: env.DONBEOLJA_V2_COLLECTION_PREFIX || "canaryv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_FAIL_CLOSED: "1",
      DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "1",
      DONBEOLJA_V2_REPAIR_QUEUE_MAX_COMPLETION_FAILURE_COUNT: "0",
      DONBEOLJA_V2_REPAIR_QUEUE_MAX_SKIPPED_REPAIR_COUNT: "0",
      DONBEOLJA_V2_REPAIR_QUEUE_MAX_MISSING_CONTEXT_COUNT: "0",
    },
    executeDelegatedRepair,
    recordedAt: at,
  });
  const verdict = evaluateCanaryResult({
    serviceResult,
    refreshCalls,
    db,
  });
  return Object.freeze({
    ok: verdict.ok,
    canary_mode: "DRY_RUN_FIXTURE",
    generated_at: at,
    position_cycle_id: fixture.positionCycleId,
    exchange_write_performed: false,
    service_status: serviceResult.status,
    fail_closed_triggered: serviceResult.fail_closed_triggered === true,
    summary: serviceResult.summary,
    verdict,
    refresh_call_n: refreshCalls.length,
    refresh_calls: Object.freeze(refreshCalls.slice()),
    completion_attempts: serviceResult.live_worker_run
      ? serviceResult.live_worker_run.completion_attempts
      : Object.freeze([]),
  });
}

module.exports = {
  buildRepairQueueCanaryFixture,
  buildMemoryDb,
  buildCanaryExecutor,
  evaluateCanaryResult,
  runRepairQueueCanary,
  __test: {
    trimOrNull,
    sanitizeRefreshCall,
  },
};
