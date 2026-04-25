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
  assert.ok(result.check_n >= 50);
  assert.strictEqual(result.substitutions._COMMIT_SHA, "unknown");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_ENABLED, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_DRY_RUN, "0");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_CANARY_ONLY, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON, "");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(result.substitutions._V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, "0");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, "");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT, "8");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE, "6");
  assert.strictEqual(
    result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
    "BTCUSDT:230|ETHUSDT:50|LINKUSDT:50|BNBUSDT:15|XRPUSDT:15|SOLUSDT:15|AXSUSDT:15|DOGEUSDT:15"
  );
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE, "10");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, "0");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE, "250");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE, "230");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE, "250");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "0");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, "1");
  assert.strictEqual(result.substitutions._DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, "1");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_ENABLED, "$_DONBEOLJA_V2_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "$_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, "$_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, "$_DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, "$_DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, "$_DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_STRATEGY_ID, "donbeolja_v2_openclaw");
  assert.strictEqual(result.main_service_env.WEBHOOK_ALLOWED_STRATEGY_IDS, "V2_SERVER_NATIVE_ONLY");
  assert.strictEqual(result.main_service_env.ENGINE_VERSION, "2.0.0");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, "$_DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE, "$_DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE, "$_DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE, "$_DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE, "$_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED, "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED, "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE, "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE, "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE");
  assert.strictEqual(result.main_service_env.V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC, "$_V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, "$_DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, "$_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT, "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE, "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP, "$_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT, "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY, "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY");
  assert.strictEqual(result.main_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE, "$_DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE");
  assert.strictEqual(result.main_service_env.OPENCLAW_AGENT_APPLY_ENABLED, "0");
  assert.strictEqual(result.main_service_env.ML_LIVE_SERVING_ARMED, "$_ML_LIVE_SERVING_ARMED");
  assert.strictEqual(result.main_service_env.OPENCLAW_NARRATIVE_SHADOW_ONLY, "1");
  assert.strictEqual(result.main_service_env.SCHEDULER_AUTOSTART, "0");
  assert.strictEqual(result.main_service_labels["commit-sha"], "$_COMMIT_SHA");
  assert.strictEqual(result.main_service_labels["image-tag"], "$_TAG");
  assert.strictEqual(result.egress_service_labels["commit-sha"], "$_COMMIT_SHA");
  assert.strictEqual(result.egress_private_service_labels["image-tag"], "$_TAG");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_ENABLED, "$_DONBEOLJA_V2_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "$_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, "$_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, "$_DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, "$_DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, "$_DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_STRATEGY_ID, "donbeolja_v2_openclaw");
  assert.strictEqual(result.exit_service_env.ENGINE_VERSION, "2.0.0");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, "$_DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE, "$_DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE, "$_DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE, "$_DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE, "$_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE, "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED, "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED, "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE, "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE, "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE");
  assert.strictEqual(result.exit_service_env.V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC, "$_V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, "$_DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, "$_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT, "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE, "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP, "$_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT, "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY, "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY");
  assert.strictEqual(result.exit_service_env.DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE, "$_DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE");
  assert.strictEqual(result.exit_service_env.OPENCLAW_AGENT_APPLY_ENABLED, "0");
  assert.strictEqual(result.exit_service_env.ML_LIVE_SERVING_ARMED, "$_ML_LIVE_SERVING_ARMED");
  assert.strictEqual(result.exit_service_env.OPENCLAW_NARRATIVE_SHADOW_ONLY, "1");
  assert.strictEqual(result.exit_service_env.SCHEDULER_AUTOSTART, "0");
  assert.strictEqual(result.exit_service_labels["commit-sha"], "$_COMMIT_SHA");
  assert.strictEqual(result.exit_service_labels["image-tag"], "$_TAG");
  assert.strictEqual(
    result.checks.find((row) => row.id === "DOCKERFILE_CODEX_ONLY_RUNTIME_SURFACE").ok,
    true
  );
})();

(function dockerfileMustNotInstallAlternateLlmProvider() {
  assert.strictEqual(__test.hasCodexOnlyRuntimeImageSurface([
    "RUN npm install -g @anthropic-ai/claude-code@latest",
    "ENV OPENCLAW_CLAUDE_CLI_BIN=/usr/local/bin/claude",
  ].join("\n")), false);
  assert.strictEqual(__test.hasCodexOnlyRuntimeImageSurface([
    "RUN apk add --no-cache git ca-certificates",
    "ENV OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY",
  ].join("\n")), true);
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
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__COMMIT_SHA"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_SUBSTITUTION__DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED"));
  assert.ok(result.failed_check_ids.includes("MAIN_SERVICE_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED_MAPPED"));
  assert.ok(result.failed_check_ids.includes("MAIN_SERVICE_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED_MAPPED"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_EXIT_SERVICE_ENV_FOUND"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_MAIN_SERVICE_LABELS_FOUND"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_EXIT_SERVICE_LABELS_FOUND"));
  assert.ok(result.failed_check_ids.includes("MAIN_SERVICE_DONBEOLJA_V2_DRY_RUN_MAPPED"));
  assert.ok(result.failed_check_ids.includes("MAIN_SERVICE_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED_MAPPED"));
  assert.ok(result.failed_check_ids.includes("MAIN_SERVICE_SCHEDULER_AUTOSTART_MAPPED"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_VALIDATION_RUNS_RUNTIME_CONFIG_AUDIT"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_SCHEDULER_TRAFFIC_STATE"));
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_V2_CUTOVER_ENV"));
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

(function promotionRuntimeMustForwardLiveCutoverFlagsToReadinessChecks() {
  const source = [
    "steps:",
    "  - name: \"gcr.io/google.com/cloudsdktool/cloud-sdk:alpine\"",
    "    args: [\"-lc\", \"apk add --no-cache nodejs npm && DONBEOLJA_V2_ENABLED=$_DONBEOLJA_V2_ENABLED DONBEOLJA_V2_DRY_RUN=$_DONBEOLJA_V2_DRY_RUN DONBEOLJA_V2_CANARY_ONLY=$_DONBEOLJA_V2_CANARY_ONLY npm run run:v2-promotion-cloudbuild\"]",
  ].join("\n");
  const result = auditV2ProductionRuntimeConfigContract({ cloudbuildSource: source });
  assert.strictEqual(__test.hasV2CutoverEnvForwardedToPromotionRuntime(source), false);
  assert.ok(result.failed_check_ids.includes("CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_V2_CUTOVER_ENV"));
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

(function parserExtractsDeployLabelsForServiceToken() {
  const source = [
    "\"run\", \"deploy\", \"$_EXIT_SERVICE\",",
    "        \"--update-labels\", \"commit-sha=$_COMMIT_SHA,image-tag=$_TAG\"",
  ].join("\n");
  const labels = __test.extractDeployUpdateLabels(source, "$_EXIT_SERVICE");
  assert.strictEqual(labels["commit-sha"], "$_COMMIT_SHA");
  assert.strictEqual(labels["image-tag"], "$_TAG");
})();

console.log("V2_PRODUCTION_RUNTIME_CONFIG_AUDIT_TEST_OK");
