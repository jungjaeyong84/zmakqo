"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const preflight = require("../../scripts/check-v2-repair-queue-canary-preflight");
const { runRepairQueueCanary } = require("../v2/repairQueueCanary");
const { runRepairQueueOperationalCanary } = require("../v2/repairQueueOperationalCanary");
const { runRepairQueueFirestoreCanary } = require("../v2/repairQueueFirestoreCanary");
const { buildMemoryDb } = require("../v2/repairQueueCanary");

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function buildHealthyCanaryPayload() {
  return runRepairQueueCanary({
    env: {},
    recordedAt: "2026-04-21T07:30:00.000Z",
  });
}

async function buildHealthyOperationalCanaryPayload() {
  return runRepairQueueOperationalCanary({
    env: {},
    recordedAt: "2026-04-21T07:31:00.000Z",
  });
}

async function buildHealthyFirestoreCanaryPayload() {
  return runRepairQueueFirestoreCanary({
    db: buildMemoryDb(),
    env: {
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_COLLECTION_PREFIX: "paperopcanarytest__",
    },
    recordedAt: "2026-04-21T07:32:00.000Z",
  });
}

async function preflightPassesForFreshDryRunCanary() {
  const payload = await buildHealthyCanaryPayload();
  const operationalPayload = await buildHealthyOperationalCanaryPayload();
  const firestorePayload = await buildHealthyFirestoreCanaryPayload();
  const report = preflight.evaluateCanaryPreflight({
    canaryArtifact: {
      filePath: "/tmp/v2-repair-queue-canary.json",
      raw: JSON.stringify(payload),
      payload,
    },
    operationalCanaryArtifact: {
      filePath: "/tmp/v2-repair-queue-operational-canary.json",
      raw: JSON.stringify(operationalPayload),
      payload: operationalPayload,
    },
    firestoreCanaryArtifact: {
      filePath: "/tmp/v2-repair-queue-firestore-canary.json",
      raw: JSON.stringify(firestorePayload),
      payload: firestorePayload,
    },
    config: {
      maxArtifactAgeMinutes: 30,
      liveEnableRequested: true,
      operationalCanaryRequired: true,
      firestoreCanaryRequired: true,
    },
    nowMs: Date.parse("2026-04-21T07:40:00.000Z"),
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.fail_n, 0);
  assert.strictEqual(report.live_enable_requested, true);
  assert.strictEqual(report.operational_canary_required, true);
  assert.strictEqual(report.firestore_canary_required, true);
  assert.strictEqual(report.check_n, 27);
}

async function preflightFailsClosedOnStaleCanary() {
  const payload = await buildHealthyCanaryPayload();
  const report = preflight.evaluateCanaryPreflight({
    canaryArtifact: {
      filePath: "/tmp/v2-repair-queue-canary.json",
      raw: JSON.stringify(payload),
      payload,
    },
    config: {
      maxArtifactAgeMinutes: 5,
      liveEnableRequested: false,
      operationalCanaryRequired: false,
    },
    nowMs: Date.parse("2026-04-21T07:40:00.000Z"),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("REPAIR_CANARY_PREFLIGHT:RQ_CANARY_CHK_04"));
}

async function preflightFailsClosedOnExchangeWriteFlag() {
  const payload = {
    ...await buildHealthyCanaryPayload(),
    exchange_write_performed: true,
  };
  const report = preflight.evaluateCanaryPreflight({
    canaryArtifact: {
      filePath: "/tmp/v2-repair-queue-canary.json",
      raw: JSON.stringify(payload),
      payload,
    },
    config: {
      maxArtifactAgeMinutes: 30,
      liveEnableRequested: false,
      operationalCanaryRequired: false,
    },
    nowMs: Date.parse("2026-04-21T07:40:00.000Z"),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("REPAIR_CANARY_PREFLIGHT:RQ_CANARY_CHK_03"));
}

async function preflightFailsClosedOnCredentialMarkers() {
  const payload = await buildHealthyCanaryPayload();
  const report = preflight.evaluateCanaryPreflight({
    canaryArtifact: {
      filePath: "/tmp/v2-repair-queue-canary.json",
      raw: `${JSON.stringify(payload)}\napiSecret=leaked`,
      payload,
    },
    config: {
      maxArtifactAgeMinutes: 30,
      liveEnableRequested: false,
      operationalCanaryRequired: false,
    },
    nowMs: Date.parse("2026-04-21T07:40:00.000Z"),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("REPAIR_CANARY_PREFLIGHT:RQ_CANARY_CHK_11"));
}

async function preflightFailsClosedWhenOperationalCanaryMissingRequiredEvidence() {
  const payload = await buildHealthyCanaryPayload();
  const operationalPayload = {
    ...await buildHealthyOperationalCanaryPayload(),
    selected_issue_code: "UNPROTECTED_ACTIVE_POSITION",
  };
  const report = preflight.evaluateCanaryPreflight({
    canaryArtifact: {
      filePath: "/tmp/v2-repair-queue-canary.json",
      raw: JSON.stringify(payload),
      payload,
    },
    operationalCanaryArtifact: {
      filePath: "/tmp/v2-repair-queue-operational-canary.json",
      raw: JSON.stringify(operationalPayload),
      payload: operationalPayload,
    },
    config: {
      maxArtifactAgeMinutes: 30,
      liveEnableRequested: true,
      operationalCanaryRequired: true,
    },
    nowMs: Date.parse("2026-04-21T07:40:00.000Z"),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("REPAIR_CANARY_PREFLIGHT:RQ_CANARY_CHK_16"));
}

async function preflightFailsClosedWhenFirestoreCanaryMissingRequiredEvidence() {
  const payload = await buildHealthyCanaryPayload();
  const operationalPayload = await buildHealthyOperationalCanaryPayload();
  const firestorePayload = {
    ...await buildHealthyFirestoreCanaryPayload(),
    firestore_write_performed: false,
  };
  const report = preflight.evaluateCanaryPreflight({
    canaryArtifact: {
      filePath: "/tmp/v2-repair-queue-canary.json",
      raw: JSON.stringify(payload),
      payload,
    },
    operationalCanaryArtifact: {
      filePath: "/tmp/v2-repair-queue-operational-canary.json",
      raw: JSON.stringify(operationalPayload),
      payload: operationalPayload,
    },
    firestoreCanaryArtifact: {
      filePath: "/tmp/v2-repair-queue-firestore-canary.json",
      raw: JSON.stringify(firestorePayload),
      payload: firestorePayload,
    },
    config: {
      maxArtifactAgeMinutes: 30,
      liveEnableRequested: true,
      operationalCanaryRequired: true,
      firestoreCanaryRequired: true,
    },
    nowMs: Date.parse("2026-04-21T07:40:00.000Z"),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("REPAIR_CANARY_PREFLIGHT:RQ_CANARY_CHK_21"));
}

async function preflightFailsClosedWhenRepairEvidenceSummaryMissing() {
  const payload = {
    ...await buildHealthyCanaryPayload(),
    completion_attempts: [],
  };
  const report = preflight.evaluateCanaryPreflight({
    canaryArtifact: {
      filePath: "/tmp/v2-repair-queue-canary.json",
      raw: JSON.stringify(payload),
      payload,
    },
    config: {
      maxArtifactAgeMinutes: 30,
      liveEnableRequested: false,
      operationalCanaryRequired: false,
    },
    nowMs: Date.parse("2026-04-21T07:40:00.000Z"),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("REPAIR_CANARY_PREFLIGHT:RQ_CANARY_CHK_26"));
}

async function mainWritesPreflightArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-canary-preflight-"));
  try {
    const payload = await buildHealthyCanaryPayload();
    const operationalPayload = await buildHealthyOperationalCanaryPayload();
    const firestorePayload = await buildHealthyFirestoreCanaryPayload();
    const canaryFile = path.join(dir, "v2-repair-queue-canary.json");
    const operationalCanaryFile = path.join(dir, "v2-repair-queue-operational-canary.json");
    const firestoreCanaryFile = path.join(dir, "v2-repair-queue-firestore-canary.json");
    writeJson(canaryFile, payload);
    writeJson(operationalCanaryFile, operationalPayload);
    writeJson(firestoreCanaryFile, firestorePayload);
    const report = preflight.runPreflight({
      DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_CANARY_MAX_AGE_MINUTES: "30",
      DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED: "1",
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED: "1",
    }, {
      nowMs: Date.parse("2026-04-21T07:40:00.000Z"),
    });
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.canary_file, canaryFile);
    assert.strictEqual(report.operational_canary_file, operationalCanaryFile);
    assert.strictEqual(report.firestore_canary_file, firestoreCanaryFile);
    assert.strictEqual(report.check_n, 27);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

(function helperParsersStayStable() {
  assert.strictEqual(preflight.__test.parseBool("yes", false), true);
  assert.strictEqual(preflight.__test.parseBool("off", true), false);
  assert.strictEqual(preflight.__test.parsePositiveNumber("3", 1), 3);
  assert.strictEqual(preflight.__test.parsePositiveNumber("-3", 7), 7);
})();

async function main() {
  await preflightPassesForFreshDryRunCanary();
  await preflightFailsClosedOnStaleCanary();
  await preflightFailsClosedOnExchangeWriteFlag();
  await preflightFailsClosedOnCredentialMarkers();
  await preflightFailsClosedWhenOperationalCanaryMissingRequiredEvidence();
  await preflightFailsClosedWhenFirestoreCanaryMissingRequiredEvidence();
  await preflightFailsClosedWhenRepairEvidenceSummaryMissing();
  await mainWritesPreflightArtifact();
  console.log("CHECK_V2_REPAIR_QUEUE_CANARY_PREFLIGHT_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
