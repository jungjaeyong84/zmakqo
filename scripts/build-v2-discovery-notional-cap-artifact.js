"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildDiscoveryNotionalCapConsistencyArtifact,
} = require("../src/v2/discoveryCanaryRiskCapConsistency");
const {
  resolveDiscoverySymbolNotionalQuoteMap,
} = require("../src/v2/discoveryCanaryNotionalPolicy");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_FILE = path.join(ROOT, "ops", "daily", "v2_discovery_notional_cap_consistency_latest.json");
const DEFAULT_HISTORY_FILE = path.join(ROOT, "ops", "daily", "v2_discovery_notional_cap_consistency_history.jsonl");

function numberWithDefault(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main(env = process.env) {
  const outputFile = env.V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_FILE || DEFAULT_OUTPUT_FILE;
  const historyFile = env.V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_HISTORY_FILE || DEFAULT_HISTORY_FILE;
  const artifact = buildDiscoveryNotionalCapConsistencyArtifact({
    map: resolveDiscoverySymbolNotionalQuoteMap(env),
    maxPositionCount: numberWithDefault(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT, 8),
    riskTotalCap: numberWithDefault(env.DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE, 900),
    riskSymbolCap: numberWithDefault(env.DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE, 200),
    riskCorrelatedGroupCap: numberWithDefault(env.DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE, 900),
  });
  writeJson(outputFile, artifact);
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(historyFile, `${JSON.stringify(artifact)}\n`, "utf8");
  return Object.freeze({
    ...artifact,
    output_file: outputFile,
    history_file: historyFile,
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
  DEFAULT_HISTORY_FILE,
  __test: { numberWithDefault },
};
