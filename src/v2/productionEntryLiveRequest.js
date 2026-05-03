"use strict";

const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");
const { buildV2EntrySizingDecision } = require("./entrySizingDecision");
const { LIVE_CONFIRM_PHRASE } = require("./productionEntryLiveEndpoint");
const { buildOpenClawWorldState } = require("./openclawWorldState");
const { issueOpenClawExecutionPermit } = require("./openclawExecutionPermit");
const { V2_SIMPLE_EXIT_CONTRACT } = require("./exitPolicy");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseBoundedPermitTtlMinutes(env = process.env) {
  const raw = Number(env && env.DONBEOLJA_V2_OPENCLAW_EXECUTION_PERMIT_TTL_MINUTES);
  const fallback = 15;
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.min(30, Math.max(5, value));
}

function extractMlMaxSizeRatioFromBundle(bundle = null) {
  const row = asObject(bundle);
  const decision = asObject(row && row.openclawDecision);
  const summary = asObject(decision && decision.canonical_evidence_summary);
  const proposal = asObject(summary && summary.ml_ai_signal_proposal);
  const value = Number(proposal && proposal.size_ratio);
  return Number.isFinite(value) ? value : null;
}

function buildBlock(reason, extra = {}) {
  return Object.freeze({
    ok: false,
    reason,
    body: null,
    entrySizingDecision: null,
    ...extra,
  });
}

function buildV2ProductionEntryLiveRequest({
  bundle,
  sizing = {},
  confirm = LIVE_CONFIRM_PHRASE,
  discoveryCanaryState = null,
  worldState = null,
  executionPermit = null,
  env = process.env,
  now = () => new Date().toISOString(),
} = {}) {
  const sourceBundle = asObject(bundle);
  if (!sourceBundle) return buildBlock("V2_PRODUCTION_ENTRY_LIVE_BUNDLE_REQUIRED");

  const routedDecision = resolveEntryIntentFromOpenClaw(sourceBundle);
  if (!routedDecision || routedDecision.ok !== true) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE", {
      routedDecision,
    });
  }

  const sizingDecision = buildV2EntrySizingDecision({
    entryIntent: routedDecision.entryIntent,
    referencePrice: sizing.referencePrice ?? sizing.reference_price,
    requestedNotionalQuote: sizing.requestedNotionalQuote ?? sizing.requested_notional_quote,
    maxNotionalQuote: sizing.maxNotionalQuote ?? sizing.max_notional_quote,
    minNotionalQuote: sizing.minNotionalQuote ?? sizing.min_notional_quote,
    minQtyAbs: sizing.minQtyAbs ?? sizing.min_qty_abs,
    stepSize: sizing.stepSize ?? sizing.step_size,
    maxSizeRatio: sizing.maxSizeRatio ?? sizing.max_size_ratio ?? extractMlMaxSizeRatioFromBundle(sourceBundle),
    allowMinOrderBump: sizing.allowMinOrderBump === true || sizing.allow_min_order_bump === true,
    requirePartialTp1MinNotional: sizing.requirePartialTp1MinNotional !== false && sizing.require_partial_tp1_min_notional !== false,
    tp1QtyRatio: sizing.tp1QtyRatio ?? sizing.tp1_qty_ratio ?? V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio,
    createdAt: trimOrNull(sizing.createdAt || sizing.created_at) || trimOrNull(now()) || new Date().toISOString(),
  });

  if (!sizingDecision.ok) {
    return buildBlock("V2_PRODUCTION_ENTRY_LIVE_SIZING_NOT_APPROVED", {
      routedDecision,
      entrySizingDecision: sizingDecision,
    });
  }

  const enrichedBundle = Object.freeze({
    ...sourceBundle,
    entrySizingDecision: sizingDecision,
  });
  const decision = asObject(sourceBundle.openclawDecision);
  const signal = asObject(sourceBundle.signalIntent);
  const generatedAt = trimOrNull(now()) || new Date().toISOString();
  const resolvedWorldState = asObject(worldState) || buildOpenClawWorldState({
    env,
    mode: decision && decision.decision_mode,
    marketState: {
      symbol: signal && signal.symbol,
      side: signal && signal.side,
    },
    riskState: {
      entry_qty_abs: sizingDecision.entry_qty_abs,
      notional_quote: sizingDecision.notional_quote,
    },
    runtimeState: {
      request_scope: "production_entry_live_request",
      entry_intent_id: sizingDecision.entry_intent_id,
    },
    generatedAt,
  });
  const resolvedPermit = asObject(executionPermit) || issueOpenClawExecutionPermit({
    bundle: sourceBundle,
    worldState: resolvedWorldState,
    sizingCap: {
      entry_qty_abs_max: sizingDecision.entry_qty_abs,
      notional_quote_max: sizingDecision.notional_quote,
      max_size_ratio: sizingDecision.max_size_ratio || null,
      size_ratio_max: sizingDecision.max_size_ratio || null,
      sizing_cap_notional_quote: sizingDecision.sizing_cap_notional_quote || null,
    },
    riskBudget: {
      max_notional_quote: sizingDecision.max_notional_quote,
      min_notional_quote: sizingDecision.min_notional_quote,
    },
    exitContract: {
      tp1_qty_ratio: V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio,
      tp1_target_pct: V2_SIMPLE_EXIT_CONTRACT.tp1_target_pct,
      tp1_exit_mode: V2_SIMPLE_EXIT_CONTRACT.tp1_exit_mode,
      tp0_supported: V2_SIMPLE_EXIT_CONTRACT.tp0_supported,
      runner_enabled: V2_SIMPLE_EXIT_CONTRACT.runner_enabled,
      trail_enabled: V2_SIMPLE_EXIT_CONTRACT.trail_enabled,
      be_enabled: V2_SIMPLE_EXIT_CONTRACT.be_enabled,
    },
    approvalReason: "PRODUCTION_ENTRY_LIVE_REQUEST_APPROVED_BY_OPENCLAW",
    issuedAt: generatedAt,
    ttlMinutes: parseBoundedPermitTtlMinutes(env),
  });

  return Object.freeze({
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_LIVE_REQUEST_READY",
    routedDecision,
    entrySizingDecision: sizingDecision,
    worldState: resolvedWorldState,
    executionPermit: resolvedPermit,
    body: Object.freeze({
      confirm,
      bundle: enrichedBundle,
      entrySizingDecision: sizingDecision,
      discoveryCanaryState: asObject(discoveryCanaryState) ? Object.freeze({ ...discoveryCanaryState }) : null,
      worldState: resolvedWorldState,
      executionPermit: resolvedPermit,
      request_contract: Object.freeze({
        ok: true,
        reason: "V2_PRODUCTION_ENTRY_LIVE_REQUEST_EMBEDS_SIZING",
        entry_intent_id: sizingDecision.entry_intent_id,
        symbol: sizingDecision.symbol,
        side: sizingDecision.side,
        entry_qty_abs: sizingDecision.entry_qty_abs,
        notional_quote: sizingDecision.notional_quote,
        exit_contract_id: V2_SIMPLE_EXIT_CONTRACT.contract_id,
        tp1_qty_ratio: V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio,
        tp1_target_pct: V2_SIMPLE_EXIT_CONTRACT.tp1_target_pct,
        runner_enabled: V2_SIMPLE_EXIT_CONTRACT.runner_enabled,
        trail_enabled: V2_SIMPLE_EXIT_CONTRACT.trail_enabled,
        be_enabled: V2_SIMPLE_EXIT_CONTRACT.be_enabled,
        world_state_hash: resolvedWorldState.world_state_hash,
        openclaw_execution_permit_id: resolvedPermit.openclaw_execution_permit_id,
      }),
    }),
  });
}

module.exports = {
  buildV2ProductionEntryLiveRequest,
  __test: {
    trimOrNull,
    asObject,
    parseBoundedPermitTtlMinutes,
    extractMlMaxSizeRatioFromBundle,
  },
};
