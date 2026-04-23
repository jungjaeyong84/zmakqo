"use strict";

const { resolveV2RuntimeConfig } = require("./runtime");
const { runV2ProductionEntryRoute } = require("./productionEntryRoute");
const { buildV2ProductionEntryLiveTransports } = require("./productionEntryLiveTransports");
const {
  DISCOVERY_CONFIRM_PHRASE,
  evaluateDiscoveryCanaryContract,
} = require("./discoveryCanaryContract");
const { evaluateV2RiskGovernor } = require("./riskGovernor");

const LIVE_CONFIRM_PHRASE = "EXECUTE_V2_LIVE_ENTRY";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function buildBlock(reason, extra = {}) {
  return Object.freeze({
    ok: false,
    reason,
    ...extra,
  });
}

function summarizeRuntimeConfig(cfg) {
  return Object.freeze({
    enabled: cfg.enabled === true,
    dry_run: cfg.dryRun === true,
    canary_only: cfg.canaryOnly === true,
    exchange: trimOrNull(cfg.exchange),
    namespace: trimOrNull(cfg.namespace),
    collection_prefix: trimOrNull(cfg.collectionPrefix),
  });
}

function extractBundle({ body = null, bundle = null } = {}) {
  const explicit = asObject(bundle);
  if (explicit) return explicit;
  const row = asObject(body);
  if (!row) return null;
  return asObject(row.bundle) || row;
}

function extractConfirm({ body = null, confirm = null } = {}) {
  return trimOrNull(confirm) || trimOrNull(asObject(body) && body.confirm);
}

function extractDecisionMode(bundle) {
  const row = asObject(bundle);
  const decision = asObject(row && row.openclawDecision);
  return upper(decision && decision.decision_mode);
}

function isDiscoveryCanaryAttempt({ env = process.env, confirm = null } = {}) {
  return parseBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, false)
    || trimOrNull(confirm) === DISCOVERY_CONFIRM_PHRASE;
}

function extractExecutionPermit({ body = null, bundle = null, executionPermit = null } = {}) {
  return asObject(executionPermit)
    || asObject(asObject(body) && body.executionPermit)
    || asObject(asObject(bundle) && bundle.executionPermit)
    || asObject(asObject(body) && body.openclawExecutionPermit)
    || null;
}

function extractWorldState({ body = null, bundle = null, worldState = null } = {}) {
  return asObject(worldState)
    || asObject(asObject(body) && body.worldState)
    || asObject(asObject(bundle) && bundle.worldState)
    || asObject(asObject(body) && body.openclawWorldState)
    || null;
}

function extractRiskGovernorInput({ body = null, bundle = null } = {}) {
  const row = asObject(body);
  const bundled = asObject(bundle);
  return asObject(row && (row.riskGovernor || row.risk_governor))
    || asObject(bundled && (bundled.riskGovernor || bundled.risk_governor))
    || null;
}

async function runV2ProductionEntryLiveEndpoint({
  db = null,
  env = process.env,
  body = null,
  bundle = null,
  confirm = null,
  executionPermit = null,
  worldState = null,
  requestId = null,
  entryTransport,
  protectionTransports,
  buildLiveTransports = buildV2ProductionEntryLiveTransports,
  runProductionEntryRoute = runV2ProductionEntryRoute,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof runProductionEntryRoute !== "function") throw new Error("RUN_PRODUCTION_ENTRY_ROUTE_REQUIRED");
  if (typeof buildLiveTransports !== "function") throw new Error("BUILD_LIVE_TRANSPORTS_REQUIRED");
  const startedAt = trimOrNull(now()) || new Date().toISOString();
  const runtimeConfig = resolveV2RuntimeConfig(env);
  const runtime = summarizeRuntimeConfig(runtimeConfig);
  const endpointEnabled = parseBool(env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, false);
  const resolvedBundle = extractBundle({ body, bundle });
  const resolvedConfirm = extractConfirm({ body, confirm });
  const resolvedExecutionPermit = extractExecutionPermit({ body, bundle: resolvedBundle, executionPermit });
  const resolvedWorldState = extractWorldState({ body, bundle: resolvedBundle, worldState });
  const decisionMode = extractDecisionMode(resolvedBundle);
  const discoveryCanaryAttempt = isDiscoveryCanaryAttempt({ env, confirm: resolvedConfirm });

  const base = Object.freeze({
    scope: "production_entry_live_endpoint",
    request_id: trimOrNull(requestId),
    generated_at: startedAt,
    runtime,
    endpoint_enabled: endpointEnabled,
    route_called: false,
    route_result: null,
    transport_resolution: null,
    discovery_canary_contract: null,
    risk_governor: null,
    exchange_write_boundary: "V2_PRODUCTION_ENTRY_ROUTE_ONLY",
  });

  if (!endpointEnabled) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_DISABLED", base);
  }
  if (!discoveryCanaryAttempt && resolvedConfirm !== LIVE_CONFIRM_PHRASE) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_CONFIRM_REQUIRED", base);
  }
  if (discoveryCanaryAttempt && resolvedConfirm !== DISCOVERY_CONFIRM_PHRASE) {
    return buildBlock("V2_DISCOVERY_CANARY_CONFIRM_REQUIRED", base);
  }
  if (!runtimeConfig.enabled) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_V2_DISABLED", base);
  }
  if (runtimeConfig.dryRun) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_DRY_RUN_BLOCKED", base);
  }
  if (runtimeConfig.canaryOnly && !discoveryCanaryAttempt) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_CANARY_ONLY_BLOCKED", base);
  }
  if (!resolvedBundle) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_BUNDLE_REQUIRED", base);
  }
  if (!discoveryCanaryAttempt && decisionMode !== "LIVE") {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_DECISION_REQUIRED", {
      ...base,
      decision_mode: decisionMode,
    });
  }
  if (discoveryCanaryAttempt && decisionMode !== "CANARY") {
    return buildBlock("V2_DISCOVERY_CANARY_DECISION_REQUIRED", {
      ...base,
      decision_mode: decisionMode,
    });
  }

  let transportResolution = null;
  let resolvedEntryTransport = entryTransport;
  let resolvedProtectionTransports = protectionTransports;
  if (!resolvedEntryTransport || !resolvedProtectionTransports) {
    try {
      transportResolution = await buildLiveTransports({
        db,
        env,
        body,
        bundle: resolvedBundle,
        now: () => startedAt,
      });
      resolvedEntryTransport = transportResolution && transportResolution.entryTransport;
      resolvedProtectionTransports = transportResolution && transportResolution.protectionTransports;
    } catch (error) {
      return buildBlock("V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCKED", {
        ...base,
        transport_resolution: Object.freeze({
          ok: false,
          reason: trimOrNull(error && error.message) || "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCKED",
        }),
      });
    }
  }

  let discoveryContract = null;
  if (discoveryCanaryAttempt) {
    discoveryContract = evaluateDiscoveryCanaryContract({
      env,
      body,
      bundle: resolvedBundle,
      confirm: resolvedConfirm,
      runtime,
      decisionMode,
      symbol: transportResolution && transportResolution.symbol,
    });
    if (!discoveryContract.ok) {
      return buildBlock("V2_DISCOVERY_CANARY_CONTRACT_BLOCKED", {
        ...base,
        transport_resolution: summarizeTransportResolution(transportResolution),
        discovery_canary_contract: discoveryContract,
      });
    }
  }

  let riskGovernorSummary = null;
  const riskGovernorInput = extractRiskGovernorInput({ body, bundle: resolvedBundle });
  if (riskGovernorInput || parseBool(env.DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, false)) {
    riskGovernorSummary = evaluateV2RiskGovernor({
      env,
      account: riskGovernorInput && riskGovernorInput.account,
      positions: riskGovernorInput && riskGovernorInput.positions,
      candidate: (riskGovernorInput && riskGovernorInput.candidate) || {
        symbol: transportResolution && transportResolution.symbol,
        notional_quote: (transportResolution && Number(transportResolution.entry_qty_abs) * Number(transportResolution.reference_price || 0)) || undefined,
      },
      market: riskGovernorInput && riskGovernorInput.market,
    });
    if (!riskGovernorSummary.ok) {
      return buildBlock("V2_RISK_GOVERNOR_BLOCKED", {
        ...base,
        transport_resolution: summarizeTransportResolution(transportResolution),
        discovery_canary_contract: discoveryContract,
        risk_governor: riskGovernorSummary,
      });
    }
  }

  const routeResult = await runProductionEntryRoute({
    db,
    env,
    bundle: resolvedBundle,
    executionPermit: resolvedExecutionPermit,
    worldState: resolvedWorldState,
    entryTransport: resolvedEntryTransport,
    protectionTransports: resolvedProtectionTransports,
    now: () => startedAt,
  });

  if (!routeResult || routeResult.ok !== true) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED", {
      ...base,
      route_called: true,
      route_result: routeResult || null,
      transport_resolution: summarizeTransportResolution(transportResolution),
      discovery_canary_contract: discoveryContract,
      risk_governor: riskGovernorSummary,
    });
  }

  return Object.freeze({
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED",
    ...base,
    route_called: true,
    route_result: routeResult,
    transport_resolution: summarizeTransportResolution(transportResolution),
    discovery_canary_contract: discoveryContract,
    risk_governor: riskGovernorSummary,
  });
}

function summarizeTransportResolution(transportResolution = null) {
  const row = asObject(transportResolution);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    entry_intent_id: trimOrNull(row.entry_intent_id),
    symbol: upper(row.symbol),
    side: upper(row.side),
    entry_qty_abs: Number.isFinite(Number(row.entry_qty_abs)) ? Number(row.entry_qty_abs) : null,
    live_cfg_summary: asObject(row.live_cfg_summary) ? Object.freeze({ ...row.live_cfg_summary }) : null,
  });
}

module.exports = {
  LIVE_CONFIRM_PHRASE,
  runV2ProductionEntryLiveEndpoint,
  __test: {
    trimOrNull,
    upper,
    parseBool,
    asObject,
    extractBundle,
    extractConfirm,
    extractDecisionMode,
    extractExecutionPermit,
    extractWorldState,
    isDiscoveryCanaryAttempt,
    summarizeTransportResolution,
    summarizeRuntimeConfig,
  },
};
