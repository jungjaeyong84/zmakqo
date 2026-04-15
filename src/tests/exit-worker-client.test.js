"use strict";

const assert = require("assert");
const { triggerExitWorkerRun, __test } = require("../services/exitWorkerClient");

async function run() {
  const oldEnv = {
    EXIT_WORKER_URL: process.env.EXIT_WORKER_URL,
    EXIT_WORKER_TRIGGER_TOKEN: process.env.EXIT_WORKER_TRIGGER_TOKEN,
    EXIT_WORKER_TRIGGER_COOLDOWN_MS: process.env.EXIT_WORKER_TRIGGER_COOLDOWN_MS,
  };
  const originalFetch = global.fetch;
  process.env.EXIT_WORKER_URL = "https://donbeolja-exit-worker-4ljfegivrq-du.a.run.app";
  process.env.EXIT_WORKER_TRIGGER_TOKEN = "tok";
  process.env.EXIT_WORKER_TRIGGER_COOLDOWN_MS = "15000";

  let captured = null;
  let capturedImmediate = null;
  let fetchCount = 0;
  global.fetch = async (url, opts) => {
    fetchCount += 1;
    if (url.endsWith("/run-execute")) capturedImmediate = { url, opts };
    else captured = { url, opts };
    return {
      ok: true,
      text: async () => JSON.stringify({ ok: true, dispatched: true }),
    };
  };

  try {
    assert.strictEqual(__test.resolveExitWorkerUrl(), "https://donbeolja-exit-worker-4ljfegivrq-du.a.run.app");
    assert.strictEqual(__test.resolveExitWorkerTriggerToken(), "tok");
    __test.clearTriggerCooldownState();

    const result = await triggerExitWorkerRun({ reason: "ENTRY_BINANCEFUT_BTCUSDT" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(captured.url, "https://donbeolja-exit-worker-4ljfegivrq-du.a.run.app/run");
    assert.strictEqual(captured.opts.method, "POST");
    assert.strictEqual(captured.opts.headers["x-scheduler-token"], "tok");
    const body = JSON.parse(String(captured.opts.body || "{}"));
    assert.strictEqual(body.reason, "ENTRY_BINANCEFUT_BTCUSDT");
    assert.strictEqual(body.dispatch_only, true);

    const immediateResult = await triggerExitWorkerRun({
      reason: "FILL_SYNC_NATIVE_REFRESH_ETHUSDT",
      dispatchOnly: false,
    });
    assert.strictEqual(immediateResult.ok, true);
    assert.strictEqual(capturedImmediate.url, "https://donbeolja-exit-worker-4ljfegivrq-du.a.run.app/run-execute");
    const immediateBody = JSON.parse(String(capturedImmediate.opts.body || "{}"));
    assert.strictEqual(immediateBody.reason, "FILL_SYNC_NATIVE_REFRESH_ETHUSDT");
    assert.strictEqual(immediateBody.dispatch_only, false);

    const cooldownResult = await triggerExitWorkerRun({ reason: "ENTRY_BINANCEFUT_BTCUSDT" });
    assert.strictEqual(cooldownResult.ok, true);
    assert.strictEqual(cooldownResult.skipped, true);
    assert.strictEqual(cooldownResult.reason, "EXIT_WORKER_TRIGGER_COOLDOWN");
    assert.strictEqual(fetchCount, 2);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (typeof value === "undefined") delete process.env[key];
      else process.env[key] = value;
    }
  }
}

run()
  .then(() => console.log("EXIT_WORKER_CLIENT_TEST_OK"))
  .catch((err) => {
    console.error("EXIT_WORKER_CLIENT_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
