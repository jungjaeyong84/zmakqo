"use strict";

const assert = require("assert");
const fs = require("fs");
const {
  OPENCLAW_CRON_JOBS,
  OPENCLAW_OPTIONAL_CRON_JOBS,
  OPENCLAW_CRON_ARTIFACT_MAP,
  OPENCLAW_SCHEDULER_SOT,
  buildOpenClawCronMessage,
} = require("../../scripts/lib/openclaw-cron-manifest");

(() => {
  assert.ok(OPENCLAW_CRON_JOBS.length >= 3);
  const names = new Set();
  const labels = new Set();
  const jobIds = new Set();
  for (const job of OPENCLAW_CRON_JOBS) {
    assert.ok(job.job_id, "job.job_id missing");
    assert.ok(job.name, "job.name missing");
    assert.ok(job.label, "job.label missing");
    assert.ok(job.wrapper && job.wrapper.endsWith(".sh"), "job.wrapper missing");
    assert.ok(job.every || job.cron, "schedule missing");
    assert.ok(job.owner, "job.owner missing");
    assert.ok(job.criticality, "job.criticality missing");
    // Some jobs (e.g. the weekly telegram summary) intentionally publish
    // only to stdout and have no on-disk artifact. For those we require
    // produces_artifact/artifact_sla_hours to be explicitly null so the
    // absence is deliberate — anything else is a misconfigured job.
    if (job.produces_artifact === null) {
      assert.strictEqual(job.artifact_sla_hours, null,
        `job.artifact_sla_hours must be null when produces_artifact is null (job_id=${job.job_id})`);
    } else {
      assert.ok(job.produces_artifact, "job.produces_artifact missing");
      assert.ok(Number.isFinite(Number(job.artifact_sla_hours)), "job.artifact_sla_hours missing");
    }
    assert.ok(Array.isArray(job.depends_on), "job.depends_on missing");
    assert.ok(job.recovery_strategy, "job.recovery_strategy missing");
    assert.strictEqual(job.scheduler_sot, OPENCLAW_SCHEDULER_SOT);
    assert.ok(!names.has(job.name), `duplicate name: ${job.name}`);
    assert.ok(!labels.has(job.label), `duplicate label: ${job.label}`);
    assert.ok(!jobIds.has(job.job_id), `duplicate job_id: ${job.job_id}`);
    names.add(job.name);
    labels.add(job.label);
    jobIds.add(job.job_id);
    if (job.produces_artifact) {
      assert.strictEqual(
        OPENCLAW_CRON_ARTIFACT_MAP[job.name],
        String(job.produces_artifact).replace(/_latest\.json$/i, "")
      );
    } else {
      assert.strictEqual(
        OPENCLAW_CRON_ARTIFACT_MAP[job.name],
        undefined,
        `artifact-map must not contain ${job.name} when produces_artifact is null`
      );
    }
  }

  // 2026-04-18: the four Phase B..E agent crons moved from launchd to
  // Cloud Scheduler (see OPENCLAW_CLOUD_SCHEDULER_JOBS). They must be
  // present there, and MUST NOT appear in OPENCLAW_CRON_JOBS anymore —
  // if they do, the local automation-watchdog will flag them as MISSING.
  const { OPENCLAW_CLOUD_SCHEDULER_JOBS } = require("../../scripts/lib/openclaw-cron-manifest");
  const cloudJobIds = new Set((OPENCLAW_CLOUD_SCHEDULER_JOBS || []).map((j) => j.job_id));
  for (const required of [
    "openclaw_agent_evidence_linker",
    "openclaw_agent_calibration",
    "openclaw_agent_retrospect",
    "v2_production_entry_route_canary",
  ]) {
    assert.ok(cloudJobIds.has(required),
      `required Cloud Scheduler job missing: ${required}`);
    assert.ok(!jobIds.has(required),
      `cron ${required} must be in OPENCLAW_CLOUD_SCHEDULER_JOBS only, not OPENCLAW_CRON_JOBS`);
  }
  const v2ProductionEntryCanary = OPENCLAW_CLOUD_SCHEDULER_JOBS.find((job) => job.job_id === "v2_production_entry_route_canary");
  assert.ok(v2ProductionEntryCanary, "v2 production entry route canary missing");
  assert.strictEqual(v2ProductionEntryCanary.http_path, "/api/openclaw/cron/v2-production-entry-route-canary");
  assert.strictEqual(v2ProductionEntryCanary.criticality, "HIGH");
  assert.strictEqual(v2ProductionEntryCanary.canary_mode, "NO_EXCHANGE_ROUTE_PROOF");
  // weekly_summary intentionally not on Cloud Scheduler yet — dashboard
  // content is too sparse pre-Day 14 to warrant a weekly digest.
  assert.ok(!cloudJobIds.has("openclaw_agent_weekly_summary"),
    "weekly_summary should stay off the scheduler until Day 14+");
  assert.ok(!jobIds.has("openclaw_agent_weekly_summary"),
    "weekly_summary should not be in launchd manifest either");
  const repairQueueJob = OPENCLAW_CRON_JOBS.find((job) => job.job_id === "v2_repair_queue_service");
  assert.ok(repairQueueJob, "v2 repair queue service cron missing");
  assert.strictEqual(repairQueueJob.wrapper.endsWith("run_v2_repair_queue_service.sh"), true);
  assert.strictEqual(repairQueueJob.produces_artifact, "v2_repair_queue_service_latest.json");
  assert.strictEqual(repairQueueJob.criticality, "HIGH");
  assert.strictEqual(repairQueueJob.scheduler_sot, OPENCLAW_SCHEDULER_SOT);
  const repairWrapper = fs.readFileSync(repairQueueJob.wrapper, "utf8");
  assert.ok(repairWrapper.includes("run-v2-repair-queue-canary.js"), "repair wrapper must run canary before service");
  assert.ok(repairWrapper.includes("run-v2-repair-queue-operational-canary.js"), "repair wrapper must run operational canary before service");
  assert.ok(repairWrapper.includes("run-v2-repair-queue-firestore-canary.js"), "repair wrapper must support firestore-backed canary before service");
  assert.ok(repairWrapper.includes("check-v2-repair-queue-firestore-canary-streak.js"), "repair wrapper must support firestore canary streak gate");
  assert.ok(repairWrapper.includes("DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED"), "repair wrapper must expose firestore canary requirement flag");
  assert.ok(repairWrapper.includes("DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED"), "repair wrapper must keep firestore writes opt-in");
  assert.ok(repairWrapper.includes("DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED"), "repair wrapper must keep 24h streak gate opt-in");
  assert.ok(repairWrapper.includes("check-v2-repair-queue-canary-preflight.js"), "repair wrapper must run preflight before service");
  assert.ok(repairWrapper.includes("DONBEOLJA_V2_REPAIR_CANARY_PREFLIGHT_REQUIRED"), "repair wrapper must force preflight requirement");

  const optionalRepairFirestoreJob = OPENCLAW_OPTIONAL_CRON_JOBS.find((job) => job.job_id === "v2_repair_queue_firestore_canary_collector");
  assert.ok(optionalRepairFirestoreJob, "v2 firestore canary optional cron missing");
  assert.strictEqual(optionalRepairFirestoreJob.wrapper.endsWith("run_v2_repair_queue_firestore_canary_collector.sh"), true);
  assert.strictEqual(optionalRepairFirestoreJob.plist.endsWith("com.jeongjaeyong.donbeolja.v2repairfirestorecanary.plist"), true);
  assert.strictEqual(optionalRepairFirestoreJob.produces_artifact, "v2_repair_queue_firestore_canary_latest.json");
  assert.strictEqual(optionalRepairFirestoreJob.scheduler_sot, OPENCLAW_SCHEDULER_SOT);
  assert.strictEqual(optionalRepairFirestoreJob.start_interval_seconds, 7200);
  assert.strictEqual(optionalRepairFirestoreJob.runAtLoad, false);
  assert.strictEqual(jobIds.has(optionalRepairFirestoreJob.job_id), false, "optional firestore canary must not be active by default");
  const firestoreCollectorWrapper = fs.readFileSync(optionalRepairFirestoreJob.wrapper, "utf8");
  const firestoreCollectorPlist = fs.readFileSync(optionalRepairFirestoreJob.plist, "utf8");
  assert.ok(firestoreCollectorWrapper.includes("run-v2-repair-queue-firestore-canary.js"), "collector must run firestore canary");
  assert.ok(firestoreCollectorWrapper.includes("check-v2-repair-queue-firestore-canary-streak.js"), "collector must write streak verdict");
  assert.ok(firestoreCollectorWrapper.includes("date +%Y%m%d%H%M%S"), "collector must use a fresh prefix by default");
  assert.ok(firestoreCollectorWrapper.includes("|| true"), "collector must not flap while streak is still accumulating");
  assert.ok(firestoreCollectorPlist.includes("<string>com.jeongjaeyong.donbeolja.v2repairfirestorecanary</string>"), "collector plist label mismatch");
  assert.ok(firestoreCollectorPlist.includes("run_v2_repair_queue_firestore_canary_collector.sh"), "collector plist wrapper mismatch");
  assert.ok(firestoreCollectorPlist.includes("<key>StartInterval</key>"), "collector plist must use interval schedule");
  assert.ok(firestoreCollectorPlist.includes("<integer>7200</integer>"), "collector plist must run every 2h");
  assert.ok(firestoreCollectorPlist.includes("<key>RunAtLoad</key>"), "collector plist must define RunAtLoad");
  assert.ok(firestoreCollectorPlist.includes("<false/>"), "collector plist must not run at load by default");

  const msg = buildOpenClawCronMessage(OPENCLAW_CRON_JOBS[0]);
  assert.ok(msg.includes("exactly once"), "message must force exact single run");
  assert.ok(msg.includes("If the wrapper succeeds"), "message must define success format");
  assert.ok(msg.includes("If the wrapper fails"), "message must define failure format");

  console.log("OPENCLAW_CRON_MANIFEST_TEST_OK");
})();
