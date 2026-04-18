"use strict";

const assert = require("assert");
const {
  OPENCLAW_CRON_JOBS,
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
  ]) {
    assert.ok(cloudJobIds.has(required),
      `required Cloud Scheduler job missing: ${required}`);
    assert.ok(!jobIds.has(required),
      `cron ${required} must be in OPENCLAW_CLOUD_SCHEDULER_JOBS only, not OPENCLAW_CRON_JOBS`);
  }
  // weekly_summary intentionally not on Cloud Scheduler yet — dashboard
  // content is too sparse pre-Day 14 to warrant a weekly digest.
  assert.ok(!cloudJobIds.has("openclaw_agent_weekly_summary"),
    "weekly_summary should stay off the scheduler until Day 14+");
  assert.ok(!jobIds.has("openclaw_agent_weekly_summary"),
    "weekly_summary should not be in launchd manifest either");

  const msg = buildOpenClawCronMessage(OPENCLAW_CRON_JOBS[0]);
  assert.ok(msg.includes("exactly once"), "message must force exact single run");
  assert.ok(msg.includes("If the wrapper succeeds"), "message must define success format");
  assert.ok(msg.includes("If the wrapper fails"), "message must define failure format");

  console.log("OPENCLAW_CRON_MANIFEST_TEST_OK");
})();
