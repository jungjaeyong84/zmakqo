"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
  DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT,
} = require("../v2/discoveryCanaryNotionalPolicy");
const {
  buildDiscoveryNotionalCapConsistencyArtifact,
  dryRunSequentialRiskGovernor,
} = require("../v2/discoveryCanaryRiskCapConsistency");
const artifactScript = require("../../scripts/build-v2-discovery-notional-cap-artifact");
const capCheck = require("../../scripts/check-v2-discovery-notional-cap-consistency");

function defaultMapMatchesP1Design() {
  assert.strictEqual(
    DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT,
    "BTCUSDT:155|ETHUSDT:42|LINKUSDT:41|BNBUSDT:13|XRPUSDT:11|SOLUSDT:11|AXSUSDT:12|DOGEUSDT:11"
  );
  assert.deepStrictEqual(DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP, {
    BTCUSDT: 155,
    ETHUSDT: 42,
    LINKUSDT: 41,
    BNBUSDT: 13,
    XRPUSDT: 11,
    SOLUSDT: 11,
    AXSUSDT: 12,
    DOGEUSDT: 11,
  });
}

function btcBetaBasketDoesNotConsumeGroupCap() {
  const dryRun = dryRunSequentialRiskGovernor();
  assert.strictEqual(dryRun.ok, true);
  assert.strictEqual(dryRun.steps.length, 5);
  assert.strictEqual(dryRun.steps[dryRun.steps.length - 1].group_after_notional_quote, 262);
  assert.strictEqual(dryRun.steps[dryRun.steps.length - 1].total_after_notional_quote, 262);
}

function artifactCapturesGroupExposureEvidence() {
  const artifact = buildDiscoveryNotionalCapConsistencyArtifact({
    generatedAt: "2026-04-26T00:00:00.000Z",
  });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.reason, "V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_PASS");
  assert.deepStrictEqual(artifact.blockers, []);
  assert.strictEqual(artifact.evidence.btc_beta_configured_notional_quote, 262);
  assert.strictEqual(artifact.evidence.btc_beta_group_cap_headroom_quote, 38);
  assert.strictEqual(artifact.evidence.total_configured_notional_quote, 296);
  assert.strictEqual(artifact.evidence.largest_notional_position_basket_quote, 263);
  assert.deepStrictEqual(
    artifact.evidence.largest_notional_position_basket.map((row) => row.symbol),
    ["BTCUSDT", "ETHUSDT", "LINKUSDT", "BNBUSDT", "AXSUSDT"]
  );
  assert.strictEqual(artifact.evidence.largest_configured_symbol_notional_quote, 155);
  assert.strictEqual(artifact.policy.risk_total_cap_quote, 300);
  assert.strictEqual(artifact.policy.risk_symbol_cap_quote, 155);
  assert.strictEqual(artifact.policy.risk_correlated_group_cap_quote, 300);
  assert.strictEqual(artifact.evidence.risk_governor_btc_beta_dry_run.ok, true);
}

function artifactScriptWritesMachineReadableEvidence() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-notional-cap-"));
  const outputFile = path.join(dir, "artifact.json");
  const historyFile = path.join(dir, "history.jsonl");
  const result = artifactScript.main({
    V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_FILE: outputFile,
    V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_HISTORY_FILE: historyFile,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.output_file, outputFile);
  assert.strictEqual(result.history_file, historyFile);
  const parsed = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.evidence.btc_beta_configured_notional_quote, 262);
  assert.strictEqual(fs.existsSync(historyFile), true);
}

function artifactScriptUsesRuntimeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-notional-cap-env-"));
  const outputFile = path.join(dir, "artifact.json");
  const result = artifactScript.main({
    V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_FILE: outputFile,
    DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "BTCUSDT:301",
    DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: "155",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("DISCOVERY_CAP:SINGLE_SYMBOL_EXCEEDS_RISK_SYMBOL_CAP"));
}

function checkBlocksStaleOrBadArtifact() {
  const stale = capCheck.evaluateArtifact({
    artifact: {
      ok: true,
      generated_at: "2026-04-26T00:00:00.000Z",
      evidence: {},
      policy: {},
    },
    env: { DONBEOLJA_V2_DISCOVERY_NOTIONAL_CAP_MAX_AGE_MS: "1000" },
    nowMs: Date.parse("2026-04-26T00:00:02.000Z"),
  });
  assert.strictEqual(stale.ok, false);
  assert.ok(stale.blockers.includes("DISCOVERY_NOTIONAL_CAP:ARTIFACT_STALE"));

  const blocked = capCheck.evaluateArtifact({
    artifact: {
      ok: false,
      generated_at: "2026-04-26T00:00:00.000Z",
      blockers: ["DISCOVERY_CAP:MAX_POSITION_BASKET_EXCEEDS_RISK_TOTAL_CAP"],
      evidence: {},
      policy: {},
    },
    nowMs: Date.parse("2026-04-26T00:00:00.000Z"),
  });
  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.blockers.includes("DISCOVERY_CAP:MAX_POSITION_BASKET_EXCEEDS_RISK_TOTAL_CAP"));
}

function checkBuildsMissingArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-notional-cap-check-"));
  const outputFile = path.join(dir, "missing.json");
  const result = capCheck.runCheck({
    V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_FILE: outputFile,
    V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_HISTORY_FILE: path.join(dir, "history.jsonl"),
    DONBEOLJA_V2_DISCOVERY_NOTIONAL_CAP_REQUIRE_ARTIFACT: "1",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(fs.existsSync(outputFile), true);
}

function main() {
  defaultMapMatchesP1Design();
  btcBetaBasketDoesNotConsumeGroupCap();
  artifactCapturesGroupExposureEvidence();
  artifactScriptWritesMachineReadableEvidence();
  artifactScriptUsesRuntimeEnv();
  checkBlocksStaleOrBadArtifact();
  checkBuildsMissingArtifact();
}

main();
console.log("V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_TEST_OK");
