"use strict";

const fs = require("fs");
const path = require("path");
const { summarizeExecutionScopeTierRawDiff } = require("../src/utils/executionScopeTierRawDiff");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function main() {
  const dailyDir = path.resolve(__dirname, "..", "ops", "daily");
  const report = summarizeExecutionScopeTierRawDiff({
    executionEntryDataset: readJson(path.join(dailyDir, "execution_model_entry_dataset_latest.json")),
    executionScopeInference: readJson(path.join(dailyDir, "best_self_evolution_execution_scope_inference_latest.json")),
    executionScopeTierDiagnostics: readJson(path.join(dailyDir, "best_self_evolution_execution_scope_tier_diagnostics_latest.json")),
  });
  const latestJson = path.join(dailyDir, "best_self_evolution_execution_scope_tier_raw_diff_latest.json");
  writeJson(latestJson, report);
  process.stdout.write(`${JSON.stringify({ ok: true, latest_json: latestJson, status: report.summary.status, target_tier: report.summary.target_tier })}\n`);
}

main();
