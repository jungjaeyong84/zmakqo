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
  const result = artifactScript.main({
    V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_FILE: outputFile,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.output_file, outputFile);
  const parsed = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.evidence.btc_beta_configured_notional_quote, 262);
}

function main() {
  defaultMapMatchesP1Design();
  btcBetaBasketDoesNotConsumeGroupCap();
  artifactCapturesGroupExposureEvidence();
  artifactScriptWritesMachineReadableEvidence();
}

main();
console.log("V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_TEST_OK");
