"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildDiscoveryNotionalCapConsistencyArtifact,
} = require("../src/v2/discoveryCanaryRiskCapConsistency");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_FILE = path.join(ROOT, "ops", "daily", "v2_discovery_notional_cap_consistency_latest.json");

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main(env = process.env) {
  const outputFile = env.V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_FILE || DEFAULT_OUTPUT_FILE;
  const artifact = buildDiscoveryNotionalCapConsistencyArtifact();
  writeJson(outputFile, artifact);
  return Object.freeze({
    ...artifact,
    output_file: outputFile,
  });
}

if (require.main === module) {
  const result = main();
  console.log(JSON.stringify({
    ok: result.ok,
    reason: result.reason,
    output_file: result.output_file,
    blockers: result.blockers,
    btc_beta_configured_notional_quote: result.evidence.btc_beta_configured_notional_quote,
    btc_beta_group_cap_headroom_quote: result.evidence.btc_beta_group_cap_headroom_quote,
  }));
  if (result.ok !== true) process.exitCode = 1;
}

module.exports = {
  main,
  DEFAULT_OUTPUT_FILE,
};
