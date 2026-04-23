"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { __test } = require("../../scripts/check-v2-promotion-gate");
const mockArtifacts = require("../../scripts/generate-v2-promotion-artifacts-mock");
const { REQUIRED_REPLAY_TRANSITION_EVENTS } = require("../v2/replayGate");

const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});

function cleanReplayReport() {
  return {
    pass: true,
    blockers: [],
    episode_n: 4,
    transition_event_coverage: Object.fromEntries(REQUIRED_REPLAY_TRANSITION_EVENTS.map((event) => [event, 1])),
    required_transition_events: REQUIRED_REPLAY_TRANSITION_EVENTS,
  };
}

function withTempJsonFile(payload, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-gate-"));
  const file = path.join(dir, "report.json");
  fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  try {
    return fn(file);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

(function resolveGateInputsReadsInlineJson() {
  const inputs = __test.resolveGateInputs({
    V2_PROMOTION_MODE: "shadow",
    V2_PROMOTION_REPLAY_JSON: JSON.stringify({ pass: true, blockers: [] }),
    V2_PROMOTION_SHADOW_LIVE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [] }),
    V2_PROMOTION_SOURCE_MODE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [] }),
  });
  assert.strictEqual(inputs.mode, "SHADOW");
  assert.strictEqual(inputs.replayReport.pass, true);
})();

(function resolveArtifactFilePathUsesStandardNames() {
  const file = __test.resolveArtifactFilePath("/tmp/dbj-v2-artifacts", "replayReport");
  assert.ok(file.endsWith("/tmp/dbj-v2-artifacts/replay-report.json") || file.endsWith("\\tmp\\dbj-v2-artifacts\\replay-report.json"));
})();

(function resolveGateInputsReadsFiles() {
  withTempJsonFile({ pass: true, blockers: [] }, (replayFile) => {
    withTempJsonFile({ pass: true, blockers: [], warnings: [] }, (shadowFile) => {
      withTempJsonFile({ pass: true, blockers: [], warnings: [] }, (sourceFile) => {
        const inputs = __test.resolveGateInputs({
          V2_PROMOTION_REPLAY_FILE: replayFile,
          V2_PROMOTION_SHADOW_LIVE_FILE: shadowFile,
          V2_PROMOTION_SOURCE_MODE_FILE: sourceFile,
        });
        assert.strictEqual(inputs.replayReport.pass, true);
        assert.strictEqual(inputs.shadowLiveComparisonReport.pass, true);
        assert.strictEqual(inputs.sourceModeComparisonReport.pass, true);
      });
    });
  });
})();

(function resolveGateInputsReadsArtifactDirectory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-artifacts-"));
  try {
    fs.writeFileSync(path.join(dir, "replay-report.json"), JSON.stringify({ pass: true, blockers: [] }), "utf8");
    fs.writeFileSync(path.join(dir, "shadow-live-comparison.json"), JSON.stringify({ pass: true, blockers: [], warnings: [] }), "utf8");
    fs.writeFileSync(path.join(dir, "source-mode-comparison.json"), JSON.stringify({ pass: true, blockers: [], warnings: [] }), "utf8");
    fs.writeFileSync(path.join(dir, "promotion-runtime-manifest.json"), JSON.stringify({
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: "PCY__TEST",
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
          alignment_checks: {
            symbol_match: true,
            side_match: true,
            timeframe_match: true,
            policy_scope_match: true,
          },
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      counts: {
        episode_n: 4,
        shadow_live_pair_n: 1,
        source_mode_pair_n: 1,
      },
    }), "utf8");
    const inputs = __test.resolveGateInputs({
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    assert.strictEqual(inputs.replayReport.pass, true);
    assert.strictEqual(inputs.shadowLiveComparisonReport.pass, true);
    assert.strictEqual(inputs.sourceModeComparisonReport.pass, true);
    assert.strictEqual(inputs.runtimeManifest.snapshot_meta.selector_meta.position_cycle_id, "PCY__TEST");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function resolveGateInputsReadsGeneratedMockArtifacts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-artifacts-generated-"));
  try {
    await mockArtifacts.main({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_MOCK_PROFILE: "CLEAN",
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    const inputs = __test.resolveGateInputs({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    assert.strictEqual(inputs.replayReport.pass, true);
    assert.strictEqual(inputs.shadowLiveComparisonReport.warn_n, 0);
    assert.strictEqual(inputs.sourceModeComparisonReport.warn_n, 0);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function buildGateFailureReasonsReturnsUnifiedBlockers() {
  const reasons = __test.buildGateFailureReasons({
    blockers: [
      "COMPARISON:SOURCE_MODE:BTCUSDT__LONG__SOURCE_MODE:DECISION_APPROVAL_MISMATCH",
      "WARNING_LIMIT_EXCEEDED:1>0",
    ],
  });
  assert.deepStrictEqual(reasons, [
    "COMPARISON:SOURCE_MODE:BTCUSDT__LONG__SOURCE_MODE:DECISION_APPROVAL_MISMATCH",
    "WARNING_LIMIT_EXCEEDED:1>0",
  ]);
})();

(function canaryRequiresRuntimeProvenanceManifest() {
  const result = __test.evaluateGateFromEnv({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_REPLAY_JSON: JSON.stringify(cleanReplayReport()),
    V2_PROMOTION_SHADOW_LIVE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [] }),
    V2_PROMOTION_SOURCE_MODE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [] }),
  });
  assert.strictEqual(result.report.pass, false);
  assert.ok(result.report.blockers.includes("PROVENANCE:MANIFEST_REQUIRED"));
})();

(function canaryPassesWithRuntimeProvenanceManifest() {
  const result = __test.evaluateGateFromEnv({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_REPLAY_JSON: JSON.stringify(cleanReplayReport()),
    V2_PROMOTION_SHADOW_LIVE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [], pair_n: 1 }),
    V2_PROMOTION_SOURCE_MODE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [], pair_n: 1 }),
    V2_PROMOTION_RUNTIME_MANIFEST_JSON: JSON.stringify({
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: "PCY__TEST",
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
          alignment_checks: {
            symbol_match: true,
            side_match: true,
            timeframe_match: true,
            policy_scope_match: true,
          },
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      counts: {
        episode_n: 4,
        shadow_live_pair_n: 1,
        source_mode_pair_n: 1,
      },
    }),
  });
  assert.strictEqual(result.report.pass, true);
})();

(function canaryBlocksOnManifestAndReportCountMismatch() {
  const result = __test.evaluateGateFromEnv({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_REPLAY_JSON: JSON.stringify(cleanReplayReport()),
    V2_PROMOTION_SHADOW_LIVE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [], pair_n: 1 }),
    V2_PROMOTION_SOURCE_MODE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [], pair_n: 1 }),
    V2_PROMOTION_RUNTIME_MANIFEST_JSON: JSON.stringify({
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: "PCY__TEST",
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
          alignment_checks: {
            symbol_match: true,
            side_match: true,
            timeframe_match: true,
            policy_scope_match: true,
          },
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      counts: {
        episode_n: 2,
        shadow_live_pair_n: 1,
        source_mode_pair_n: 1,
      },
    }),
  });
  assert.strictEqual(result.report.pass, false);
  assert.ok(result.report.blockers.includes("PROVENANCE:REPLAY_EPISODE_COUNT_MISMATCH"));
})();

(function canaryBlocksWhenLineageContractIsMissing() {
  const result = __test.evaluateGateFromEnv({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_REPLAY_JSON: JSON.stringify(cleanReplayReport()),
    V2_PROMOTION_SHADOW_LIVE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [], pair_n: 1 }),
    V2_PROMOTION_SOURCE_MODE_JSON: JSON.stringify({ pass: true, blockers: [], warnings: [], pair_n: 1 }),
    V2_PROMOTION_RUNTIME_MANIFEST_JSON: JSON.stringify({
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: "PCY__TEST",
          alignment_checks: {
            symbol_match: true,
            side_match: true,
            timeframe_match: true,
            policy_scope_match: true,
          },
        },
      },
      counts: {
        episode_n: 1,
        shadow_live_pair_n: 1,
        source_mode_pair_n: 1,
      },
    }),
  });
  assert.strictEqual(result.report.pass, false);
  assert.ok(result.report.blockers.includes("PROVENANCE:LINEAGE_CONTRACT_REQUIRED"));
})();

(function missingInputsThrowExplicitly() {
  let err = null;
  try {
    __test.resolveGateInputs({});
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_REPLAY_FILE_OR_V2_PROMOTION_REPLAY_JSON_REQUIRED");
})();

console.log("CHECK_V2_PROMOTION_GATE_TEST_OK");
