"use strict";

const assert = require("assert");
const {
  auditV2ProductionRuntimeConfigContract,
  auditWorkspaceV2ProductionRuntimeConfigContract,
  __test,
} = require("../v2/productionRuntimeConfigAudit");

(function workspaceContractPasses() {
  const result = auditWorkspaceV2ProductionRuntimeConfigContract();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_RUNTIME_CONFIG_CONTRACT_PASS");
  assert.strictEqual(result.fail_n, 0);
  assert.ok(result.check_n >= 42);
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON, "");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "0");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "0");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "JSONL");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_ENABLED, "$_DONBEOLJA_V2_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE, "$_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE");
  assert.strictEqual(result.main_service_env.SCHEDULER_AUTOSTART, "0");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_ENABLED, "$_DONBEOLJA_V2_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE, "$_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE");
  assert.strictEqual(result.exit_service_env.SCHEDULER_AUTOSTART, "0");
})();

(function missingCloudbuildMappingFailsClosedWithTraceableIds() {
  const source = [
    "substitutions:",
    "  _DONBEOLJA_V2_ENABLED: \"0\"",
    "steps:",
    "  - name: \"gcr.io/google.com/cloudsdktool/cloud-sdk\"",
    "    args:",
    "      [",
    "        \"run\", \"deploy\", \"$_SERVICE\",",
    "        \"--set-env-vars\", \"^;^RUNTIME_MODE=production;DONBEOLJA_V2_ENABLED=$_DONBEOLJA_V2_ENABLED\"",
    "      ]",
  ].join("\n");
  const result = auditV2ProductionRuntimeConfigContract({ cloudbuildSource: source });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_RUNTIME_CONFIG_CONTRACT_BLOCKED");
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_DRY_RUN"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED"));
  assert.ok(result.failed_check_ids.includes("MAIN_SERVICE_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED_MAPPED"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_EXIT_SERVICE_ENV_FOUND"));
  assert.ok(result.failed_check_ids.includes("MAIN_SERVICE_DONBEOLJA_V2_DRY_RUN_MAPPED"));
  assert.ok(result.failed_check_ids.includes("MAIN_SERVICE_SCHEDULER_AUTOSTART_MAPPED"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_VALIDATION_RUNS_RUNTIME_CONFIG_AUDIT"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_SCHEDULER_TRAFFIC_STATE"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_PROMOTION_RUNTIME_HAS_GCLOUD_AND_NODE"));
})();

(function promotionRuntimeMustProvideGcloudForSchedulerCollector() {
  const source = [
    "steps:",
    "  - name: \"node:20-alpine\"",
    "    args: [\"-lc\", \"npm ci --no-audit --no-fund && npm run run:v2-promotion-cloudbuild\"]",
  ].join("\n");
  const result = auditV2ProductionRuntimeConfigContract({ cloudbuildSource: source });
  assert.strictEqual(__test.hasPromotionRuntimeGcloudAvailable(source), false);
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_PROMOTION_RUNTIME_HAS_GCLOUD_AND_NODE"));
})();

(function parserExtractsDeployEnvVarsForServiceToken() {
  const source = [
    "\"run\", \"deploy\", \"$_EXIT_SERVICE\",",
    "        \"--set-env-vars\", \"^;^RUNTIME_MODE=production;DONBEOLJA_V2_ENABLED=$_DONBEOLJA_V2_ENABLED;DONBEOLJA_V2_DRY_RUN=$_DONBEOLJA_V2_DRY_RUN\"",
  ].join("\n");
  const env = __test.extractDeploySetEnvVars(source, "$_EXIT_SERVICE");
  assert.strictEqual(env.RUNTIME_MODE, "production");
  assert.strictEqual(env.DONBEOLJA_V2_ENABLED, "$_DONBEOLJA_V2_ENABLED");
  assert.strictEqual(env.DONBEOLJA_V2_DRY_RUN, "$_DONBEOLJA_V2_DRY_RUN");
})();

console.log("V2_PRODUCTION_RUNTIME_CONFIG_AUDIT_TEST_OK");
