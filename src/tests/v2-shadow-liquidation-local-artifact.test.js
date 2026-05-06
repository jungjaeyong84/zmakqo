"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const walker = require("../../scripts/walk-v2-signal-shadow-counterfactual-ledger");
const liquidation = require("../../scripts/run-v2-liquidation-stream-collector-window");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    });
}

(async () => {
  await withTempDir("dbj-shadow-local-artifact-", async (dir) => {
    const walkerFile = path.join(dir, "walker.json");
    const walkerResult = await walker.main({
      env: {
        DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "0",
        DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_FILE: walkerFile,
      },
      setProcessExitCode: false,
    });
    assert.strictEqual(walkerResult.ok, true);
    assert.strictEqual(walkerResult.reason, "V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_DISABLED");
    const walkerArtifact = JSON.parse(fs.readFileSync(walkerFile, "utf8"));
    assert.strictEqual(walkerArtifact.reason, "V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_DISABLED");
    assert.strictEqual(walkerArtifact.output_file, walkerFile);
  });

  await withTempDir("dbj-liquidation-local-artifact-", async (dir) => {
    const outputFile = path.join(dir, "liquidation.json");
    const result = await liquidation.main({
      env: {
        DONBEOLJA_V2_LIQUIDATION_STREAM_WINDOW_FILE: outputFile,
      },
      collectorFactory: () => ({
        start: () => ({ ok: true, reason: "LIQUIDATION_STREAM_DISABLED" }),
        state: () => ({ enabled: false, buffered_event_n: 0, symbols: [] }),
        stop: () => ({ ok: true, reason: "STOPPED" }),
      }),
      setProcessExitCode: false,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "LIQUIDATION_STREAM_DISABLED");
    const artifact = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    assert.strictEqual(artifact.reason, "LIQUIDATION_STREAM_DISABLED");
    assert.strictEqual(artifact.output_file, outputFile);
  });

  console.log("V2_SHADOW_LIQUIDATION_LOCAL_ARTIFACT_TEST_OK");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
