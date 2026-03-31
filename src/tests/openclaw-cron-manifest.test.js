"use strict";

const assert = require("assert");
const { OPENCLAW_CRON_JOBS, buildOpenClawCronMessage } = require("../../scripts/lib/openclaw-cron-manifest");

(() => {
  assert.strictEqual(OPENCLAW_CRON_JOBS.length, 16);
  const names = new Set();
  const labels = new Set();
  for (const job of OPENCLAW_CRON_JOBS) {
    assert.ok(job.name, "job.name missing");
    assert.ok(job.label, "job.label missing");
    assert.ok(job.wrapper && job.wrapper.endsWith(".sh"), "job.wrapper missing");
    assert.ok(job.every || job.cron, "schedule missing");
    assert.ok(!names.has(job.name), `duplicate name: ${job.name}`);
    assert.ok(!labels.has(job.label), `duplicate label: ${job.label}`);
    names.add(job.name);
    labels.add(job.label);
  }

  const msg = buildOpenClawCronMessage(OPENCLAW_CRON_JOBS[0]);
  assert.ok(msg.includes("exactly once"), "message must force exact single run");
  assert.ok(msg.includes("If the wrapper succeeds"), "message must define success format");
  assert.ok(msg.includes("If the wrapper fails"), "message must define failure format");

  console.log("OPENCLAW_CRON_MANIFEST_TEST_OK");
})();
