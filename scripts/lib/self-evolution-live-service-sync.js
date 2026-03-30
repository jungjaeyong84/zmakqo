"use strict";

const { execSync } = require("child_process");

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function uniq(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function prependUnionCsv(priorityValue, ...csvValues) {
  const head = String(priorityValue || "").trim();
  const merged = uniq([
    head,
    ...csvValues.flatMap((value) => parseCsv(value)),
  ]);
  return merged.join(",");
}

function buildUpdateEnvCommand(service, region, envMap) {
  const serialized = Object.entries(envMap)
    .filter(([key, value]) => key && value != null && String(value).trim())
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join(":");
  return `gcloud run services update ${service} --region ${region} --update-env-vars "^:^${serialized}"`;
}

function describeServiceEnv(service, region) {
  const stdout = execSync(
    `gcloud run services describe ${service} --region ${region} --format=json`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const parsed = JSON.parse(stdout);
  const envList = (((parsed || {}).spec || {}).template || {}).spec || {};
  const container = (Array.isArray(envList.containers) ? envList.containers[0] : null) || {};
  const env = Array.isArray(container.env) ? container.env : [];
  const getValue = (name) => {
    const found = env.find((row) => row && row.name === name);
    return found && Object.prototype.hasOwnProperty.call(found, "value") ? String(found.value || "") : "";
  };
  return {
    revision: (parsed.status && parsed.status.latestReadyRevisionName) || null,
    values: {
      DONBEOLJA_STRATEGY_ID: getValue("DONBEOLJA_STRATEGY_ID"),
      WEBHOOK_ALLOWED_STRATEGY_IDS: getValue("WEBHOOK_ALLOWED_STRATEGY_IDS"),
      ENGINE_VERSION: getValue("ENGINE_VERSION"),
    },
  };
}

function syncLiveServiceStrategyRuntime({
  service,
  region,
  strategyId,
  engineVersion,
  desiredAllowedCsv = "",
  includeAllowlist = false,
} = {}) {
  const current = describeServiceEnv(service, region);
  const targetEnv = {
    DONBEOLJA_STRATEGY_ID: strategyId,
    ENGINE_VERSION: engineVersion,
  };
  if (includeAllowlist) {
    targetEnv.WEBHOOK_ALLOWED_STRATEGY_IDS = prependUnionCsv(
      strategyId,
      desiredAllowedCsv,
      current.values.WEBHOOK_ALLOWED_STRATEGY_IDS
    );
  }
  const command = buildUpdateEnvCommand(service, region, targetEnv);
  execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const after = describeServiceEnv(service, region);
  return {
    service,
    region,
    before: current,
    after,
    target_env: targetEnv,
    command,
  };
}

function syncSelfEvolutionLiveServices({
  strategyId,
  engineVersion,
  desiredAllowedCsv = "",
  region = process.env.GCP_REGION || "asia-northeast3",
} = {}) {
  const plans = [
    { service: "donbeolja", includeAllowlist: true },
    { service: "donbeolja-egress", includeAllowlist: false },
    { service: "donbeolja-exit-worker", includeAllowlist: false },
  ];
  return plans.map((plan) => syncLiveServiceStrategyRuntime({
    service: plan.service,
    region,
    strategyId,
    engineVersion,
    desiredAllowedCsv,
    includeAllowlist: plan.includeAllowlist,
  }));
}

module.exports = {
  prependUnionCsv,
  buildUpdateEnvCommand,
  syncSelfEvolutionLiveServices,
};
