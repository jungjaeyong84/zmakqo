"use strict";

const assert = require("assert");
const {
  __test,
  evaluateGcpCostPosture,
  normalizeCloudRunService,
} = require("../../scripts/check-v2-gcp-cost-posture");

function repo({ dryRun = true, policies = true, size = 1000 } = {}) {
  return {
    repository: "gcr.io",
    location: "us",
    repositorySizeMb: size,
    cleanupPolicyDryRun: dryRun,
    cleanupPolicies: policies ? {
      "keep-recent-deploy-images": {},
      "delete-old-untagged-images": {},
      "delete-old-v2-commit-tags": {},
    } : {},
  };
}

function service({ name = "donbeolja", minScale = "1", windowMs = "10000", vpc = false } = {}) {
  return {
    metadata: { name },
    spec: {
      template: {
        metadata: {
          annotations: {
            "autoscaling.knative.dev/minScale": minScale,
            ...(vpc ? {
              "run.googleapis.com/vpc-access-connector": "donbeolja-connector",
              "run.googleapis.com/vpc-access-egress": "all-traffic",
            } : {}),
          },
        },
        spec: {
          containers: [{ env: [{ name: "DONBEOLJA_V2_LIQUIDATION_STREAM_WINDOW_MS", value: windowMs }] }],
        },
      },
    },
  };
}

function baselinePassesWithWarnings() {
  const result = evaluateGcpCostPosture({
    artifact_repositories: [repo()],
    scheduler_jobs: [{ name: "v2-liquidation-stream-collector-window", schedule: "*/5 * * * *" }],
    cloud_run_services: [service({ vpc: true })],
    vpc_connectors: [{ name: "donbeolja-connector", minInstances: 2, machineType: "e2-micro" }],
    recent_cloudbuilds: [{ id: "a" }, { id: "b" }],
    env: { DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT: "6" },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_GCP_COST_POSTURE_PASS");
  assert.ok(result.warnings.some((row) => row.includes("CLOUD_RUN_MIN_INSTANCE_BASELINE")));
  assert.ok(result.warnings.some((row) => row.includes("VPC_CONNECTOR_MIN_INSTANCE_BASELINE")));
}

function cloudBuildChurnBlocks() {
  const result = evaluateGcpCostPosture({
    artifact_repositories: [repo()],
    scheduler_jobs: [{ name: "v2-liquidation-stream-collector-window", schedule: "*/5 * * * *" }],
    cloud_run_services: [service()],
    vpc_connectors: [],
    recent_cloudbuilds: Array.from({ length: 7 }, (_, i) => ({ id: String(i) })),
    env: { DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT: "6" },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.some((row) => row.includes("CLOUDBUILD_24H_BUILD_LIMIT_EXCEEDED")));
}

function artifactCleanupDriftBlocks() {
  const result = evaluateGcpCostPosture({
    artifact_repositories: [repo({ dryRun: false, policies: false })],
    scheduler_jobs: [{ name: "v2-liquidation-stream-collector-window", schedule: "*/5 * * * *" }],
    cloud_run_services: [service()],
    vpc_connectors: [],
    recent_cloudbuilds: [],
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.some((row) => row.includes("ARTIFACT_CLEANUP_DRY_RUN_DISABLED")));
  assert.ok(result.blockers.some((row) => row.includes("ARTIFACT_CLEANUP_POLICY_MISSING")));
}

function liquidationCostRegressionBlocks() {
  const result = evaluateGcpCostPosture({
    artifact_repositories: [repo()],
    scheduler_jobs: [{ name: "v2-liquidation-stream-collector-window", schedule: "* * * * *" }],
    cloud_run_services: [service({ windowMs: "55000" })],
    vpc_connectors: [],
    recent_cloudbuilds: [],
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.some((row) => row.includes("LIQUIDATION_STREAM_SCHEDULE_DRIFT")));
  assert.ok(result.blockers.some((row) => row.includes("LIQUIDATION_STREAM_WINDOW_TOO_HIGH")));
}

function normalizesCloudRunServiceShape() {
  const out = normalizeCloudRunService(service({ name: "donbeolja-egress-private", minScale: "1", windowMs: "10000", vpc: true }));
  assert.strictEqual(out.name, "donbeolja-egress-private");
  assert.strictEqual(out.min_scale, 1);
  assert.strictEqual(out.vpc_connector, "donbeolja-connector");
  assert.strictEqual(out.liquidation_stream_window_ms, 10000);
}

function fixtureLoadersParseArrays() {
  const repos = __test.loadArtifactRepositories({
    env: { V2_GCP_COST_POSTURE_ARTIFACT_REPOSITORIES_JSON: JSON.stringify(repo()) },
  });
  assert.strictEqual(repos.length, 1);
  assert.strictEqual(repos[0].cleanup_policy_dry_run, true);
}

baselinePassesWithWarnings();
cloudBuildChurnBlocks();
artifactCleanupDriftBlocks();
liquidationCostRegressionBlocks();
normalizesCloudRunServiceShape();
fixtureLoadersParseArrays();
console.log("CHECK_V2_GCP_COST_POSTURE_TEST_OK");
