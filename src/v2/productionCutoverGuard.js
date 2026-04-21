"use strict";

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function buildV2ProductionCutoverGuard(env = process.env) {
  const v2Enabled = parseBool(env.DONBEOLJA_V2_ENABLED, false);
  const dryRun = parseBool(env.DONBEOLJA_V2_DRY_RUN, true);
  const canaryOnly = parseBool(env.DONBEOLJA_V2_CANARY_ONLY, true);
  const requireProductionCutover = parseBool(env.DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER, false);
  const allowLegacyWebhookSignal = parseBool(env.DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, false);
  const blockLegacyWebhookSignal = parseBool(
    env.DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL,
    v2Enabled === true && dryRun === false && canaryOnly === false
  );

  const context = Object.freeze({
    v2_enabled: v2Enabled,
    v2_dry_run: dryRun,
    v2_canary_only: canaryOnly,
    require_production_cutover: requireProductionCutover,
    block_legacy_webhook_signal: blockLegacyWebhookSignal,
    allow_legacy_webhook_signal: allowLegacyWebhookSignal,
  });

  if (requireProductionCutover && !v2Enabled) {
    return Object.freeze({
      allowed: false,
      reason: "V2_PRODUCTION_CUTOVER_REQUIRED",
      httpStatus: 409,
      context,
    });
  }
  if (requireProductionCutover && dryRun) {
    return Object.freeze({
      allowed: false,
      reason: "V2_PRODUCTION_CUTOVER_DRY_RUN_BLOCKED",
      httpStatus: 409,
      context,
    });
  }
  if (requireProductionCutover && canaryOnly) {
    return Object.freeze({
      allowed: false,
      reason: "V2_PRODUCTION_CUTOVER_CANARY_ONLY_BLOCKED",
      httpStatus: 409,
      context,
    });
  }
  if (blockLegacyWebhookSignal && !allowLegacyWebhookSignal) {
    return Object.freeze({
      allowed: false,
      reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
      httpStatus: 409,
      context,
    });
  }

  return Object.freeze({
    allowed: true,
    reason: "V2_PRODUCTION_CUTOVER_GUARD_ALLOW",
    httpStatus: 200,
    context,
  });
}

module.exports = {
  buildV2ProductionCutoverGuard,
  __test: {
    parseBool,
  },
};
