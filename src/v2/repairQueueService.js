"use strict";

const { buildRepairDelegationEnvelope, assertWatchdogRepairRuntimeBoundaries } = require("./watchdogRepairRuntime");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function parseIsoMs(value) {
  const time = Date.parse(String(value || "").trim());
  return Number.isFinite(time) ? time : null;
}

function normalizeRepairRequests(repairRequests = []) {
  return Array.isArray(repairRequests) ? repairRequests.filter((row) => row && typeof row === "object") : [];
}

function dedupeRepairRequests(repairRequests = []) {
  const seen = new Set();
  const rows = [];
  for (const row of normalizeRepairRequests(repairRequests)) {
    const id = trimOrNull(row.exit_repair_request_id);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  return Object.freeze(rows);
}

function sortRepairRequestsForQueue(repairRequests = []) {
  return Object.freeze(dedupeRepairRequests(repairRequests).slice().sort((left, right) => {
    const leftMs = parseIsoMs(left.created_at);
    const rightMs = parseIsoMs(right.created_at);
    if (leftMs != null && rightMs != null && leftMs !== rightMs) return leftMs - rightMs;
    const leftId = trimOrNull(left.exit_repair_request_id) || "";
    const rightId = trimOrNull(right.exit_repair_request_id) || "";
    return leftId.localeCompare(rightId);
  }));
}

function indexRowsByPositionCycle(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const cycleId = trimOrNull(row.position_cycle_id);
    if (!cycleId) continue;
    map.set(cycleId, row);
  }
  return map;
}

function buildRepairQueueBatch({
  repairRequests = [],
  projections = [],
  protectionRuntimes = [],
  positionCycles = [],
  maxBatchSize = 10,
  placementStartedAt = null,
  placementRetryIdPrefix = "RQ",
} = {}) {
  const boundaryAudit = assertWatchdogRepairRuntimeBoundaries();
  const projectionMap = indexRowsByPositionCycle(projections);
  const runtimeMap = indexRowsByPositionCycle(protectionRuntimes);
  const positionCycleMap = indexRowsByPositionCycle(positionCycles);
  const boundedSize = Math.max(1, Number(maxBatchSize) || 1);
  const orderedRequests = sortRepairRequestsForQueue(repairRequests).slice(0, boundedSize);
  const delegatedRepairs = [];
  const skippedRepairs = [];

  orderedRequests.forEach((repairRequest, index) => {
    const cycleId = trimOrNull(repairRequest.position_cycle_id);
    const projection = projectionMap.get(cycleId);
    const protectionRuntime = runtimeMap.get(cycleId) || {};
    if (!projection) {
      skippedRepairs.push(Object.freeze({
        exit_repair_request_id: trimOrNull(repairRequest.exit_repair_request_id),
        position_cycle_id: cycleId,
        issue_code: upper(repairRequest.issue_code),
        requested_action: upper(repairRequest.requested_action),
        skip_reason: "PROJECTION_REQUIRED",
      }));
      return;
    }
    const positionCycle = positionCycleMap.get(cycleId);
    if (!positionCycle) {
      skippedRepairs.push(Object.freeze({
        exit_repair_request_id: trimOrNull(repairRequest.exit_repair_request_id),
        position_cycle_id: cycleId,
        issue_code: upper(repairRequest.issue_code),
        requested_action: upper(repairRequest.requested_action),
        skip_reason: "POSITION_CYCLE_REQUIRED",
      }));
      return;
    }
    try {
      const envelope = buildRepairDelegationEnvelope({
        repairRequest,
        projection,
        protectionRuntime,
        positionCycle,
        placementStartedAt,
        placementRetryId: `${placementRetryIdPrefix}${index + 1}`,
      });
      delegatedRepairs.push(Object.freeze({
        exit_repair_request_id: trimOrNull(repairRequest.exit_repair_request_id),
        position_cycle_id: cycleId,
        issue_code: upper(repairRequest.issue_code),
        requested_action: upper(repairRequest.requested_action),
        envelope,
      }));
    } catch (error) {
      skippedRepairs.push(Object.freeze({
        exit_repair_request_id: trimOrNull(repairRequest.exit_repair_request_id),
        position_cycle_id: cycleId,
        issue_code: upper(repairRequest.issue_code),
        requested_action: upper(repairRequest.requested_action),
        skip_reason: trimOrNull(error && error.message) || "REPAIR_QUEUE_BUILD_FAILED",
      }));
    }
  });

  return Object.freeze({
    ok: true,
    boundary_audit: boundaryAudit,
    requested_batch_n: normalizeRepairRequests(repairRequests).length,
    selected_batch_n: orderedRequests.length,
    delegated_n: delegatedRepairs.length,
    skipped_n: skippedRepairs.length,
    delegated_repairs: Object.freeze(delegatedRepairs),
    skipped_repairs: Object.freeze(skippedRepairs),
  });
}

module.exports = {
  buildRepairQueueBatch,
  __test: {
    trimOrNull,
    upper,
    parseIsoMs,
    normalizeRepairRequests,
    dedupeRepairRequests,
    sortRepairRequestsForQueue,
    indexRowsByPositionCycle,
  },
};
