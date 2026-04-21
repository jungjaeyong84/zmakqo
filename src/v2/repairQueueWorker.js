"use strict";

const { getV2Doc, listV2Docs, putV2Doc, queryV2DocsByField } = require("./storage");
const { buildRepairQueueBatch } = require("./repairQueueService");
const {
  buildDelegatedRepairExecutionLedgerDoc,
  buildSkippedRepairExecutionLedgerDoc,
} = require("./repairExecutionLedger");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function resolveRepairQueueBatchLimit(env = process.env, fallback = 10) {
  const raw = Number(env && env.DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return Math.max(1, Number(fallback) || 1);
}

function resolveRepairQueueScanLimit(env = process.env, batchLimit = 10) {
  const raw = Number(env && env.DONBEOLJA_V2_REPAIR_QUEUE_SCAN_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.floor(raw));
  return Math.max(1, Math.floor(Number(batchLimit) || 1) * 5);
}

function isPendingRepairRequest(row = {}) {
  const status = String(row && row.status || "").trim().toUpperCase();
  return status === "PENDING";
}

function sortRepairRequestsByCreatedAt(repairRequests = []) {
  return Object.freeze((Array.isArray(repairRequests) ? repairRequests : []).slice().sort((left, right) => {
    const leftMs = Date.parse(String(left && left.created_at || "").trim());
    const rightMs = Date.parse(String(right && right.created_at || "").trim());
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
    return String(left && left.exit_repair_request_id || "").localeCompare(String(right && right.exit_repair_request_id || ""));
  }));
}

function dedupePositionCycleIds(repairRequests = []) {
  return Array.from(new Set(
    (Array.isArray(repairRequests) ? repairRequests : [])
      .map((row) => trimOrNull(row && row.position_cycle_id))
      .filter(Boolean)
  ));
}

async function fetchPendingRepairRequests({
  db = null,
  env = process.env,
  batchLimit = null,
} = {}) {
  const boundedLimit = resolveRepairQueueBatchLimit(env, batchLimit == null ? 10 : batchLimit);
  const scanLimit = resolveRepairQueueScanLimit(env, boundedLimit);
  const pendingList = await queryV2DocsByField({
    db,
    env,
    collectionKey: "REPAIR_REQUESTS",
    field: "status",
    value: "PENDING",
    limit: scanLimit,
  });
  const rows = sortRepairRequestsByCreatedAt(pendingList.rows).slice(0, boundedLimit);
  return Object.freeze({
    ok: true,
    repair_request_limit: boundedLimit,
    repair_request_scan_limit: scanLimit,
    repair_requests: Object.freeze(rows),
    rows: Object.freeze(rows),
    collectionName: pendingList.collectionName,
  });
}

async function fetchRepairQueueInputs({
  db = null,
  env = process.env,
  repairRequestLimit = null,
} = {}) {
  const boundedLimit = resolveRepairQueueBatchLimit(env, repairRequestLimit == null ? 10 : repairRequestLimit);
  const pendingOnly = String(env && env.DONBEOLJA_V2_REPAIR_QUEUE_PENDING_ONLY || "1").trim() !== "0";
  const repairRequestList = pendingOnly
    ? await fetchPendingRepairRequests({
        db,
        env,
        batchLimit: boundedLimit,
      })
    : await listV2Docs({
        db,
        env,
        collectionKey: "REPAIR_REQUESTS",
        limit: boundedLimit,
      });
  const repairRequests = Array.isArray(repairRequestList.rows) ? repairRequestList.rows : [];
  const cycleIds = dedupePositionCycleIds(repairRequests);
  const positionCycleResults = await Promise.all(cycleIds.map((positionCycleId) => getV2Doc({
    db,
    env,
    collectionKey: "POSITION_CYCLES",
    docId: positionCycleId,
  })));
  const projectionResults = await Promise.all(cycleIds.map((positionCycleId) => getV2Doc({
    db,
    env,
    collectionKey: "EXIT_RUNTIME_PROJECTIONS",
    docId: `ERPv2__${positionCycleId}`,
  })));
  const protectionRuntimeResults = await Promise.all(cycleIds.map((positionCycleId) => getV2Doc({
    db,
    env,
    collectionKey: "PROTECTION_RUNTIME",
    docId: `PRTV2__${positionCycleId}`,
  })));
  return Object.freeze({
    ok: true,
    repair_request_limit: boundedLimit,
    repair_request_scan_limit: repairRequestList.repair_request_scan_limit || boundedLimit,
    pending_only: pendingOnly,
    repair_requests: Object.freeze(repairRequests.slice()),
    position_cycles: Object.freeze(positionCycleResults.filter((row) => row.ok === true).map((row) => row.doc)),
    projections: Object.freeze(projectionResults.filter((row) => row.ok === true).map((row) => row.doc)),
    protection_runtimes: Object.freeze(protectionRuntimeResults.filter((row) => row.ok === true).map((row) => row.doc)),
    requested_position_cycle_ids: Object.freeze(cycleIds),
    missing_position_cycle_ids: Object.freeze(
      positionCycleResults.filter((row) => row.ok !== true).map((row) => trimOrNull(row.docId)).filter(Boolean)
    ),
    missing_projection_cycle_ids: Object.freeze(
      projectionResults.filter((row) => row.ok !== true).map((row) => trimOrNull(row.docId && row.docId.replace(/^ERPv2__/, ""))).filter(Boolean)
    ),
    missing_protection_runtime_cycle_ids: Object.freeze(
      protectionRuntimeResults.filter((row) => row.ok !== true).map((row) => trimOrNull(row.docId && row.docId.replace(/^PRTV2__/, ""))).filter(Boolean)
    ),
  });
}

async function runRepairQueueWorker({
  db = null,
  env = process.env,
  repairRequestLimit = null,
  placementStartedAt = null,
  placementRetryIdPrefix = "RQ",
  persistExecutionLedger = false,
  recordedAt = null,
} = {}) {
  const inputs = await fetchRepairQueueInputs({
    db,
    env,
    repairRequestLimit,
  });
  const batch = buildRepairQueueBatch({
    repairRequests: inputs.repair_requests,
    projections: inputs.projections,
    protectionRuntimes: inputs.protection_runtimes,
    positionCycles: inputs.position_cycles,
    maxBatchSize: inputs.repair_request_limit,
    placementStartedAt,
    placementRetryIdPrefix,
  });
  const executionLedgerDocs = Object.freeze([
    ...batch.delegated_repairs.map((row) => buildDelegatedRepairExecutionLedgerDoc({
      delegatedRepair: row,
      recordedAt,
    })),
    ...batch.skipped_repairs.map((row) => buildSkippedRepairExecutionLedgerDoc({
      skippedRepair: row,
      recordedAt,
    })),
  ]);
  const persistedExecutionLedger = persistExecutionLedger === true
    ? Object.freeze(await Promise.all(executionLedgerDocs.map((doc) => putV2Doc({
        db,
        env,
        collectionKey: "REPAIR_EXECUTION_LEDGER",
        doc,
      }))))
    : Object.freeze([]);
  return Object.freeze({
    ok: true,
    repair_request_limit: inputs.repair_request_limit,
    requested_repair_n: inputs.repair_requests.length,
    requested_position_cycle_ids: inputs.requested_position_cycle_ids,
    missing_position_cycle_ids: inputs.missing_position_cycle_ids,
    missing_projection_cycle_ids: inputs.missing_projection_cycle_ids,
    missing_protection_runtime_cycle_ids: inputs.missing_protection_runtime_cycle_ids,
    batch,
    execution_ledger_docs: executionLedgerDocs,
    persisted_execution_ledger: persistedExecutionLedger,
  });
}

module.exports = {
  fetchPendingRepairRequests,
  fetchRepairQueueInputs,
  runRepairQueueWorker,
  __test: {
    trimOrNull,
    resolveRepairQueueBatchLimit,
    resolveRepairQueueScanLimit,
    isPendingRepairRequest,
    sortRepairRequestsByCreatedAt,
    dedupePositionCycleIds,
  },
};
