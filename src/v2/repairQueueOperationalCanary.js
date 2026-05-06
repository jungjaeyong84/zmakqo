"use strict";

const {
  buildPositionCycleDoc,
  buildExitRuntimeProjectionDoc,
  buildProtectionRuntimeDoc,
} = require("./contracts");
const { evaluateActiveExitWatchdog } = require("./watchdog");
const { runRepairQueueLiveService } = require("./repairQueueLiveService");
const {
  buildMemoryDb,
  buildCanaryExecutor,
} = require("./repairQueueCanary");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildRepairQueueOperationalCanaryFixture({
  recordedAt = "2026-04-21T08:00:00.000Z",
} = {}) {
  const positionCycle = {
    ...buildPositionCycleDoc({
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      entryEventId: "ENTRY__V2_REPAIR_OPERATIONAL_CANARY",
      entryOrderId: "ORDER__V2_REPAIR_OPERATIONAL_CANARY",
      entryFillGroupId: "FILL_GROUP__V2_REPAIR_OPERATIONAL_CANARY",
      signalIntentId: "SIG__V2_REPAIR_OPERATIONAL_CANARY",
      openclawDecisionId: "OCD__V2_REPAIR_OPERATIONAL_CANARY",
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
      slOrderId: "STOP__OLD_OPERATIONAL_CANARY",
      tp1OrderId: "TP1__OPERATIONAL_CANARY_OK",
      nativeStopPrice: null,
      nativeTp1Price: 2562.5,
      nativeRefreshStatus: "ERROR",
      lastRefreshAt: recordedAt,
      lastGapMs: 1000,
      healthStatus: "DEGRADED_REPAIRABLE",
      slOrderStatus: "PLACED",
      tp1OrderStatus: "PLACED",
      runtimeWriteReason: "WATCHDOG_SHADOW_GAP",
      placementIssueCodes: [],
      placementAttemptId: "PRATT__OPERATIONAL_CANARY",
      placementRetryId: "OPC0",
      placementStartedAt: recordedAt,
      placementFinishedAt: recordedAt,
      slAckAt: recordedAt,
      tp1AckAt: recordedAt,
    }),
    leverage: 2,
    exit_rules_override: positionCycle.exit_rules_override,
  };
  const exchangeState = {
    has_active_position: true,
    source: "SHADOW_OPERATIONAL_CANARY",
  };
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle,
    projection,
    protectionRuntime,
    exchangeState,
    createdAt: recordedAt,
  });
  const selectedRepairRequest = watchdog.repairRequests.find((row) => row.issue_code === "NATIVE_REFRESH_UNHEALTHY");
  if (!selectedRepairRequest) {
    throw new Error("OPERATIONAL_CANARY_NATIVE_REFRESH_REPAIR_REQUEST_REQUIRED");
  }
  return Object.freeze({
    positionCycleId,
    expectedStopPrice: 2458.75,
    watchdog,
    selectedRepairRequest,
    docsByCollectionKey: Object.freeze({
      POSITION_CYCLES: Object.freeze({
        [positionCycleId]: positionCycle,
      }),
      EXIT_RUNTIME_PROJECTIONS: Object.freeze({
        [projection.exit_runtime_projection_id]: projection,
      }),
      PROTECTION_RUNTIME: Object.freeze({
        [protectionRuntime.protection_runtime_id]: protectionRuntime,
      }),
      REPAIR_REQUESTS: Object.freeze({
        [selectedRepairRequest.exit_repair_request_id]: selectedRepairRequest,
      }),
    }),
  });
}

function evaluateOperationalCanaryResult({
  fixture,
  serviceResult,
  refreshCalls,
} = {}) {
  const summary = serviceResult && serviceResult.summary ? serviceResult.summary : {};
  const watchdog = fixture && fixture.watchdog ? fixture.watchdog : {};
  const selected = fixture && fixture.selectedRepairRequest ? fixture.selectedRepairRequest : {};
  const completionAttempts = serviceResult && serviceResult.live_worker_run
    ? serviceResult.live_worker_run.completion_attempts
    : [];
  const issueCodes = Array.isArray(watchdog.issueCodes) ? watchdog.issueCodes : [];
  const repairRequests = Array.isArray(watchdog.repairRequests) ? watchdog.repairRequests : [];
  const invariants = Object.freeze({
    watchdog_detected_native_refresh_unhealthy: issueCodes.includes("NATIVE_REFRESH_UNHEALTHY"),
    watchdog_generated_repair_requests: repairRequests.length >= 1,
    selected_request_generated_by_watchdog: repairRequests.some((row) => (
      row.exit_repair_request_id === selected.exit_repair_request_id &&
      row.issue_code === "NATIVE_REFRESH_UNHEALTHY"
    )),
    service_healthy: serviceResult && serviceResult.ok === true && serviceResult.status === "HEALTHY",
    exactly_one_repair_requested: Number(summary.requested_repair_n) === 1,
    exactly_one_delegated: Number(summary.delegated_repair_n) === 1,
    completion_succeeded: Number(summary.completion_success_n) === 1 && Number(summary.completion_failed_n) === 0,
    refresh_transport_called_once: refreshCalls.length === 1,
    completion_ledger_success: completionAttempts.some((row) => (
      row && row.completion_ledger && row.completion_ledger.execution_status === "COMPLETED_SUCCESS"
    )),
  });
  const failed = Object.entries(invariants)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);
  return Object.freeze({
    ok: failed.length === 0,
    failed_invariants: Object.freeze(failed),
    invariants,
  });
}

async function runRepairQueueOperationalCanary({
  env = process.env,
  recordedAt = null,
} = {}) {
  const at = trimOrNull(recordedAt) || new Date().toISOString();
  const fixture = buildRepairQueueOperationalCanaryFixture({ recordedAt: at });
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
      DONBEOLJA_V2_COLLECTION_PREFIX: "opcanaryv2__",
      DONBEOLJA_V2_REPAIR_QUEUE_REQUIRE_LATEST_ACTIVE_READ_MODEL: "0",
      POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY: "0",
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
  const verdict = evaluateOperationalCanaryResult({
    fixture,
    serviceResult,
    refreshCalls,
  });
  return Object.freeze({
    ok: verdict.ok,
    canary_mode: "SHADOW_REPAIR_REQUEST_GENERATION",
    generated_at: at,
    position_cycle_id: fixture.positionCycleId,
    exchange_write_performed: false,
    service_status: serviceResult.status,
    watchdog_issue_codes: Object.freeze(fixture.watchdog.issueCodes.slice()),
    watchdog_generated_repair_request_n: fixture.watchdog.repairRequests.length,
    selected_repair_request_id: fixture.selectedRepairRequest.exit_repair_request_id,
    selected_issue_code: fixture.selectedRepairRequest.issue_code,
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
  buildRepairQueueOperationalCanaryFixture,
  evaluateOperationalCanaryResult,
  runRepairQueueOperationalCanary,
  __test: {
    trimOrNull,
  },
};
