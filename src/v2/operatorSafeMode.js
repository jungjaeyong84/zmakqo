"use strict";

const ACTIONS = Object.freeze({
  PAUSE_ENTRIES: "PAUSE_ENTRIES",
  RESUME_CANARY: "RESUME_CANARY",
  ROLLBACK_SHADOW: "ROLLBACK_SHADOW",
  ARM_DISCOVERY_CANARY: "ARM_DISCOVERY_CANARY",
  DISARM_DISCOVERY_CANARY: "DISARM_DISCOVERY_CANARY",
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function normalizeSymbol(value) {
  const symbol = upper(value);
  if (!symbol) return null;
  return /^[A-Z0-9_:-]{3,32}$/.test(symbol) ? symbol : null;
}

function normalizeService(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  return /^[a-z][a-z0-9-]{0,62}$/.test(text) ? text : null;
}

function normalizeRegion(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  return /^[a-z]+-[a-z]+[0-9]$/.test(text) ? text : null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function buildEnvPatch(action, options = {}) {
  const symbol = normalizeSymbol(options.symbol);
  switch (upper(action)) {
    case ACTIONS.PAUSE_ENTRIES:
      return {
        DONBEOLJA_V2_CANARY_ONLY: "1",
        DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "0",
        DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "0",
        ML_LIVE_SERVING_ARMED: "0",
      };
    case ACTIONS.RESUME_CANARY:
      return {
        DONBEOLJA_V2_ENABLED: "1",
        DONBEOLJA_V2_DRY_RUN: "0",
        DONBEOLJA_V2_CANARY_ONLY: "1",
        DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "0",
        ML_LIVE_SERVING_ARMED: "0",
      };
    case ACTIONS.ROLLBACK_SHADOW:
      return {
        DONBEOLJA_V2_CANARY_ONLY: "1",
        DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "0",
        DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "0",
        OPENCLAW_AGENT_APPLY_ENABLED: "0",
        OPENCLAW_CONDUCTOR_SHADOW_ONLY: "1",
        ML_LIVE_SERVING_ARMED: "0",
      };
    case ACTIONS.ARM_DISCOVERY_CANARY:
      return {
        DONBEOLJA_V2_CANARY_ONLY: "1",
        DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
        DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
        DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: symbol || "",
        DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "5",
        DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "UNLIMITED",
        ML_LIVE_SERVING_ARMED: "0",
      };
    case ACTIONS.DISARM_DISCOVERY_CANARY:
      return {
        DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "0",
        DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "0",
        DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "",
      };
    default:
      return null;
  }
}

function buildGcloudCommand({ service = "donbeolja", region = "asia-northeast3", envPatch = {} } = {}) {
  const pairs = Object.entries(envPatch)
    .map(([key, value]) => `${key}=${String(value == null ? "" : value)}`)
    .join(",");
  return `gcloud run services update ${service} --region=${region} --update-env-vars='${pairs}'`;
}

function planOperatorSafeModeAction({
  action,
  options = {},
  env = process.env,
  confirm = null,
} = {}) {
  const normalizedAction = upper(action);
  const envPatch = buildEnvPatch(normalizedAction, options);
  const requestedService = trimOrNull(options.service);
  const requestedRegion = trimOrNull(options.region);
  const service = normalizeService(requestedService) || "donbeolja";
  const region = normalizeRegion(requestedRegion) || "asia-northeast3";
  const blockers = [];
  if (!envPatch) blockers.push("OPERATOR_SAFE_MODE:ACTION_UNSUPPORTED");
  if (requestedService && !normalizeService(requestedService)) blockers.push("OPERATOR_SAFE_MODE:SERVICE_INVALID");
  if (requestedRegion && !normalizeRegion(requestedRegion)) blockers.push("OPERATOR_SAFE_MODE:REGION_INVALID");
  if (parseBool(env.DONBEOLJA_V2_OPERATOR_ACTION_REQUIRE_CONFIRM, true) && trimOrNull(confirm) !== `CONFIRM_${normalizedAction}`) {
    blockers.push("OPERATOR_SAFE_MODE:CONFIRM_REQUIRED");
  }
  if (normalizedAction === ACTIONS.ARM_DISCOVERY_CANARY) {
    if (!upper(options.symbol)) {
      blockers.push("OPERATOR_SAFE_MODE:DISCOVERY_SYMBOL_REQUIRED");
    } else if (!normalizeSymbol(options.symbol)) {
      blockers.push("OPERATOR_SAFE_MODE:DISCOVERY_SYMBOL_INVALID");
    }
  }
  const ok = blockers.length === 0;
  return Object.freeze({
    ok,
    reason: ok ? "V2_OPERATOR_SAFE_MODE_ACTION_READY" : "V2_OPERATOR_SAFE_MODE_ACTION_BLOCKED",
    action: normalizedAction,
    blockers: Object.freeze(blockers),
    env_patch: Object.freeze(envPatch || {}),
    command_preview: envPatch ? buildGcloudCommand({
      service,
      region,
      envPatch,
    }) : null,
    apply_performed: false,
    note: "Preview only. Apply through approved Cloud Build or an audited operator runbook.",
  });
}

module.exports = {
  ACTIONS,
  buildEnvPatch,
  buildGcloudCommand,
  planOperatorSafeModeAction,
  __test: { trimOrNull, upper, normalizeSymbol, normalizeService, normalizeRegion, parseBool },
};
