"use strict";

const assert = require("assert");
const {
  OPENCLAW_CRON_JOBS,
  OPENCLAW_CRON_ARTIFACT_MAP,
  OPENCLAW_SCHEDULER_SOT,
  buildOpenClawCronMessage,
} = require("../../scripts/lib/openclaw-cron-manifest");

(() => {
  assert.strictEqual(OPENCLAW_CRON_JOBS.length, 2);
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
    assert.ok(job.produces_artifact, "job.produces_artifact missing");
    assert.ok(Number.isFinite(Number(job.artifact_sla_hours)), "job.artifact_sla_hours missing");
    assert.ok(Array.isArray(job.depends_on), "job.depends_on missing");
    assert.ok(job.recovery_strategy, "job.recovery_strategy missing");
    assert.strictEqual(job.scheduler_sot, OPENCLAW_SCHEDULER_SOT);
    assert.ok(!names.has(job.name), `duplicate name: ${job.name}`);
    assert.ok(!labels.has(job.label), `duplicate label: ${job.label}`);
    assert.ok(!jobIds.has(job.job_id), `duplicate job_id: ${job.job_id}`);
    names.add(job.name);
    labels.add(job.label);
    jobIds.add(job.job_id);
    assert.strictEqual(
      OPENCLAW_CRON_ARTIFACT_MAP[job.name],
      String(job.produces_artifact).replace(/_latest\.json$/i, "")
    );
  }

  const msg = buildOpenClawCronMessage(OPENCLAW_CRON_JOBS[0]);
  assert.ok(msg.includes("exactly once"), "message must force exact single run");
  assert.ok(msg.includes("If the wrapper succeeds"), "message must define success format");
  assert.ok(msg.includes("If the wrapper fails"), "message must define failure format");

  console.log("OPENCLAW_CRON_MANIFEST_TEST_OK");
})();
