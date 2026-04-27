"use strict";

const {
  V2_NAMESPACE,
  V2_EXCHANGE,
  V2_COLLECTION_PREFIX,
  V2_COLLECTIONS,
} = require("./constants");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => upper(item))
    .filter(Boolean);
}

function resolveV2RuntimeConfig(env = process.env) {
  const namespace = String(env.DONBEOLJA_V2_NAMESPACE || V2_NAMESPACE).trim() || V2_NAMESPACE;
  const exchange = upper(env.DONBEOLJA_V2_EXCHANGE || V2_EXCHANGE) || V2_EXCHANGE;
  const enabled = parseBool(env.DONBEOLJA_V2_ENABLED, false);
  const dryRun = parseBool(env.DONBEOLJA_V2_DRY_RUN, true);
  const canaryOnly = parseBool(env.DONBEOLJA_V2_CANARY_ONLY, true);
  const canarySymbols = parseCsvList(env.DONBEOLJA_V2_CANARY_SYMBOLS);
  const collectionPrefix = String(env.DONBEOLJA_V2_COLLECTION_PREFIX || `${namespace}__`).trim() || `${namespace}__`;
  const collections = Object.freeze(Object.fromEntries(
    Object.entries(V2_COLLECTIONS).map(([key, value]) => [key, `${collectionPrefix}${value}`])
  ));

  return Object.freeze({
    namespace,
    exchange,
    enabled,
    dryRun,
    canaryOnly,
    canarySymbols,
    collectionPrefix,
    collections,
    v1FreezeRequired: true,
    defaultProtectionModel: Object.freeze({
      tp1QtyRatio: 0.5,
      tp1TargetPct: 0.025,
    }),
    defaultComparisonThresholds: Object.freeze({
      qualityScoreAbsDeltaWarn: 0.15,
      rankScoreAbsDeltaWarn: 0.2,
      sizeRatioAbsDeltaWarn: 0.25,
    }),
    defaultDeployGatePolicy: Object.freeze({
      shadowMaxWarningCount: 999999,
      canaryMaxWarningCount: 0,
      liveMaxWarningCount: 0,
    }),
    defaultRepairQueuePolicy: Object.freeze({
      batchLimit: 10,
      maxCompletionFailureCount: 0,
      maxSkippedRepairCount: 0,
      maxMissingContextCount: 0,
    }),
  });
}

module.exports = {
  resolveV2RuntimeConfig,
  __test: {
    parseBool,
    parseCsvList,
  },
};
