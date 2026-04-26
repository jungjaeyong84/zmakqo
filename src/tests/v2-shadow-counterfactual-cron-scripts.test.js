"use strict";

// Verifies the walker and analyzer scripts expose the contract the
// /api/openclaw/cron/v2-signal-shadow-counterfactual-* route handlers
// rely on: a callable `main()` that returns `{ ok, reason, ... }`
// without process.exit, and that the walker is a no-op when the
// counterfactual ledger flag is OFF (the default everywhere).

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const walker = require("../../scripts/walk-v2-signal-shadow-counterfactual-ledger");
const analyzer = require("../../scripts/analyze-v2-signal-shadow-counterfactuals");

(async () => {
  assert.strictEqual(typeof walker.main, "function", "walker.main must be exported");
  const walkerOff = await walker.main({
    env: {},
    argv: [],
    setProcessExitCode: false,
  });
  assert.strictEqual(walkerOff.ok, true, "walker must succeed when ledger flag is OFF");
  assert.strictEqual(
    walkerOff.reason,
    "V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_DISABLED",
    "walker must report DISABLED when flag is OFF"
  );
  assert.strictEqual(walkerOff.processed_n, 0, "walker must process 0 records when disabled");

  const walkerDryRun = await walker.main({
    env: { DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "1" },
    argv: ["--dry-run"],
    setProcessExitCode: false,
  });
  assert.strictEqual(walkerDryRun.ok, true, "walker dry-run must succeed when flag is ON");
  assert.strictEqual(
    walkerDryRun.reason,
    "V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_DRY_RUN",
    "walker dry-run must report DRY_RUN"
  );
  assert.strictEqual(walkerDryRun.processed_n, 0, "walker dry-run must process 0 records");

  const failingDb = {
    collection() {
      return {
        where() {
          return {
            where() {
              return {
                limit() {
                  return {
                    get: async () => {
                      throw new Error("FAILED_PRECONDITION_INDEX_REQUIRED");
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const walkerQueryFail = await walker.main({
    env: { DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "1" },
    argv: [],
    db: failingDb,
    fetchKlines: async () => [],
    setProcessExitCode: false,
  });
  assert.strictEqual(walkerQueryFail.ok, false, "walker must fail when Firestore query throws");
  assert.strictEqual(walkerQueryFail.reason, "WALK_QUERY_FAILED");
  assert.ok(
    typeof walkerQueryFail.error_message === "string"
      && walkerQueryFail.error_message.includes("FAILED_PRECONDITION_INDEX_REQUIRED"),
    "walker emit must forward underlying error_message for diagnosis"
  );

  assert.strictEqual(typeof analyzer.main, "function", "analyzer.main must be exported");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-shadow-cron-test-"));
  const tmpOutput = path.join(tmpDir, "analysis.json");
  try {
    const analyzerDryRun = await analyzer.main({
      env: {
        DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_FILE: tmpOutput,
      },
      argv: ["--dry-run"],
      setProcessExitCode: false,
    });
    assert.strictEqual(analyzerDryRun.ok, true, "analyzer dry-run must succeed");
    assert.strictEqual(
      analyzerDryRun.reason,
      "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_DRY_RUN",
      "analyzer dry-run must report DRY_RUN"
    );
    assert.strictEqual(analyzerDryRun.sample_n, 0, "analyzer dry-run must report sample_n=0");
    assert.strictEqual(
      analyzerDryRun.output_file,
      tmpOutput,
      "analyzer dry-run must honor DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_FILE override"
    );
    assert.ok(fs.existsSync(tmpOutput), "analyzer dry-run must write the artifact file");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("V2_SHADOW_COUNTERFACTUAL_CRON_SCRIPTS_TEST_OK");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
