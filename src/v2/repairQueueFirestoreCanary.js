"use strict";

const { putV2Doc } = require("./storage");
const { runRepairQueueLiveService } = require("./repairQueueLiveService");
const {
  buildRepairQueueOperationalCanaryFixture,
  evaluateOperationalCanaryResult,
} = require("./repairQueueOperationalCanary");
const { buildCanaryExecutor } = require("./repairQueueCanary");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function formatPrefixTimestamp(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function buildDefaultFirestoreCanaryPrefix(recordedAt = null) {
  const suffix = formatPrefixTimestamp(recordedAt);
  return suffix ? `paperopcanaryv2_${suffix}__` : "paperopcanaryv2__";
}

function resolveFirestoreCanaryEnv(env = process.env, { recordedAt = null } = {}) {
  const prefix = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_COLLECTION_PREFIX)
    || buildDefaultFirestoreCanaryPrefix(recordedAt);
  return Object.freeze({
    ...env,
    DONBEOLJA_V2_COLLECTION_PREFIX: prefix,
    DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_ENABLED: "1",
    DONBEOLJA_V2_REPAIR_QUEUE_SERVICE_FAIL_CLOSED: "1",
    DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT: "1",
    DONBEOLJA_V2_REPAIR_QUEUE_SCAN_LIMIT: env.DONBEOLJA_V2_REPAIR_QUEUE_SCAN_LIMIT || "10",
    DONBEOLJA_V2_REPAIR_QUEUE_MAX_COMPLETION_FAILURE_COUNT: "0",
    DONBEOLJA_V2_REPAIR_QUEUE_MAX_SKIPPED_REPAIR_COUNT: "0",
    DONBEOLJA_V2_REPAIR_QUEUE_MAX_MISSING_CONTEXT_COUNT: "0",
  });
}

async function seedRepairQueueFirestoreCanaryFixture({
  db = null,
  env = process.env,
  fixture,
} = {}) {
  if (!fixture || !fixture.docsByCollectionKey) {
    throw new Error("FIRESTORE_CANARY_FIXTURE_REQUIRED");
  }
  const writes = [];
  for (const [collectionKey, docsById] of Object.entries(fixture.docsByCollectionKey)) {
    for (const doc of Object.values(docsById || {})) {
      writes.push(await putV2Doc({
        db,
        env,
        collectionKey,
        doc,
        merge: false,
      }));
    }
  }
  return Object.freeze(writes);
}

async function runRepairQueueFirestoreCanary({
  db = null,
  env = process.env,
  recordedAt = null,
  writeEnabled = null,
} = {}) {
  const at = trimOrNull(recordedAt) || new Date().toISOString();
  const enabled = writeEnabled == null
    ? parseBool(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED, false)
    : writeEnabled === true;
  const canaryEnv = resolveFirestoreCanaryEnv(env, { recordedAt: at });
  if (enabled !== true) {
    return Object.freeze({
      ok: false,
      reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_WRITE_DISABLED",
      canary_mode: "FIRESTORE_BACKED_SHADOW_REPAIR_REQUEST_GENERATION",
      generated_at: at,
      collection_prefix: canaryEnv.DONBEOLJA_V2_COLLECTION_PREFIX,
      firestore_write_performed: false,
      exchange_write_performed: false,
      service_status: "BLOCKED",
      blockers: Object.freeze(["FIRESTORE_CANARY_WRITE_DISABLED"]),
    });
  }

  const fixture = buildRepairQueueOperationalCanaryFixture({ recordedAt: at });
  const seedWrites = await seedRepairQueueFirestoreCanaryFixture({
    db,
    env: canaryEnv,
    fixture,
  });
  const refreshCalls = [];
  const executeDelegatedRepair = buildCanaryExecutor({
    fixture,
    refreshCalls,
    recordedAt: at,
  });
  const serviceResult = await runRepairQueueLiveService({
    db,
    env: canaryEnv,
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
    reason: verdict.ok
      ? "V2_REPAIR_QUEUE_FIRESTORE_CANARY_HEALTHY"
      : "V2_REPAIR_QUEUE_FIRESTORE_CANARY_FAILED",
    canary_mode: "FIRESTORE_BACKED_SHADOW_REPAIR_REQUEST_GENERATION",
    generated_at: at,
    collection_prefix: canaryEnv.DONBEOLJA_V2_COLLECTION_PREFIX,
    position_cycle_id: fixture.positionCycleId,
    firestore_write_performed: true,
    exchange_write_performed: false,
    seed_write_n: seedWrites.length,
    seed_writes: Object.freeze(seedWrites),
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
  resolveFirestoreCanaryEnv,
  seedRepairQueueFirestoreCanaryFixture,
  runRepairQueueFirestoreCanary,
  __test: {
    trimOrNull,
    parseBool,
  },
};
