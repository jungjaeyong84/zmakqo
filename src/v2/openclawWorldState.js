"use strict";

const crypto = require("crypto");
const { buildOpenClawWorldStateDoc } = require("./contracts");
const { putV2Doc } = require("./storage");
const { resolveV2RuntimeConfig } = require("./runtime");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.freeze(Object.keys(value).sort().reduce((acc, key) => {
      const item = value[key];
      if (item !== undefined) acc[key] = normalizeJson(item);
      return acc;
    }, {}));
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return value === undefined ? null : value;
}

function hashCanonicalJson(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(normalizeJson(value)))
    .digest("hex");
}

function buildOpenClawWorldState({
  env = process.env,
  exchange = null,
  mode = null,
  marketState = null,
  positionState = null,
  protectionState = null,
  riskState = null,
  runtimeState = null,
  canaryState = null,
  configState = null,
  costState = null,
  sourceRefs = null,
  generatedAt = null,
} = {}) {
  const cfg = resolveV2RuntimeConfig(env);
  const at = trimOrNull(generatedAt) || new Date().toISOString();
  const payload = normalizeJson({
    generated_at: at,
    exchange: upper(exchange) || cfg.exchange,
    mode: upper(mode) || "CANARY",
    market_state: marketState || {},
    position_state: positionState || {},
    protection_state: protectionState || {},
    risk_state: riskState || {},
    runtime_state: runtimeState || {
      enabled: cfg.enabled === true,
      dry_run: cfg.dryRun === true,
      canary_only: cfg.canaryOnly === true,
      namespace: cfg.namespace,
      collection_prefix: cfg.collectionPrefix,
    },
    canary_state: canaryState || {},
    config_state: configState || {},
    cost_state: costState || {},
    source_refs: sourceRefs || {},
  });
  const worldStateHash = hashCanonicalJson(payload);
  return Object.freeze(buildOpenClawWorldStateDoc({
    worldStateHash,
    generatedAt: at,
    exchange: payload.exchange,
    mode: payload.mode,
    marketState: payload.market_state,
    positionState: payload.position_state,
    protectionState: payload.protection_state,
    riskState: payload.risk_state,
    runtimeState: payload.runtime_state,
    canaryState: payload.canary_state,
    configState: payload.config_state,
    costState: payload.cost_state,
    sourceRefs: payload.source_refs,
  }));
}

async function persistOpenClawWorldState({
  worldState,
  db = null,
  env = process.env,
  merge = true,
} = {}) {
  const doc = worldState && typeof worldState === "object" ? worldState : null;
  if (!doc) throw new Error("OPENCLAW_WORLD_STATE_REQUIRED");
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "OPENCLAW_WORLD_STATES",
    doc,
    merge,
  });
  return Object.freeze({
    ok: true,
    reason: "OPENCLAW_WORLD_STATE_LEDGER_WRITTEN",
    world_state_hash: trimOrNull(doc.world_state_hash),
    persisted,
  });
}

module.exports = {
  buildOpenClawWorldState,
  persistOpenClawWorldState,
  __test: {
    normalizeJson,
    hashCanonicalJson,
    trimOrNull,
    upper,
  },
};
