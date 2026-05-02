"use strict";

const crypto = require("crypto");
const { getFirestore } = require("../storage/firestore");
const { listExchangePositionReadViews } = require("../services/positionReadModel");
const { getBinanceFuturesAccountSummary } = require("../services/binanceFuturesAccountSummary");
const {
  fetchFuturesBookTicker,
  fetchFuturesExchangeInfo,
} = require("../exchanges/binanceFuturesPrivate");
const {
  buildOpenClawDecisionBundle,
  persistOpenClawDecisionBundleLedger,
} = require("./openclawControlPlane");
const { recordCounterfactualEvaluation } = require("./signalShadowCounterfactualLedger");
const { buildV2ProductionEntryLiveRequest } = require("./productionEntryLiveRequest");
const { persistOpenClawWorldState } = require("./openclawWorldState");
const { resolveDiscoverySymbolNotionalQuote } = require("./discoveryCanaryNotionalPolicy");
const { runV2ProductionEntryLiveEndpoint } = require("./productionEntryLiveEndpoint");
const { DISCOVERY_CONFIRM_PHRASE } = require("./discoveryCanaryContract");
const { evaluateMarketDataQualityGate } = require("./marketDataQualityGate");
const { resolveV2CollectionRef } = require("./storage");
const { collectBinanceMicrostructureFeatures } = require("./binanceMicrostructureFeatures");
const { evaluateDiscoveryCanaryRealizedPerformanceGuard } = require("./discoveryCanaryRealizedPerformanceGuard");
// 2026-04-29 — entry-time trade alert dispatch. Until today the only
// ENTRY alert path was fillSync's polling-driven flushFillSyncAlertBatches
// (3-min cadence), so a successful V2 production entry route execution
// (V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED) could close the
// loop on the broker but the operator wouldn't see a Telegram alert
// until the next fillSync poll — and not at all when fillSync wasn't
// running for any reason. Operator-reported symptom on 2026-04-29:
// XRPUSDT entered at 06:31:17 UTC, no Telegram alert. The fix is the
// mirror of the exit α/β path in src/services/binanceTickExit.js: emit
// `sendTradeExecutionAlert` at the place-success boundary inside this
// bridge, with a dedupe Map keyed by (symbol, intent, signal_id) so
// fillSync's later authoritative echo lands inside the dedupe TTL and
// doesn't double-fire to the operator.
const { sendTradeExecutionAlert } = require("../services/tradeExecutionAlert");
const entryAlertDedupeState = new Map();
const ENTRY_ALERT_DEDUPE_TTL_MS = (() => {
  const raw = Number(process.env.V2_DISCOVERY_BRIDGE_ENTRY_ALERT_DEDUPE_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 10 * 60 * 1000;
})();
function buildEntryAlertDedupeKey({ symbol, signalId, intentId }) {
  const sym = String(symbol || "").trim().toUpperCase() || "?";
  const idem = String(signalId || intentId || "NA").trim();
  return `${sym}__ENTRY__${idem}`;
}
function shouldDispatchEntryAlert(key, nowMs = Date.now()) {
  if (!key) return true;
  const last = entryAlertDedupeState.get(key);
  if (!Number.isFinite(last)) return true;
  if (nowMs - last >= ENTRY_ALERT_DEDUPE_TTL_MS) {
    entryAlertDedupeState.delete(key);
    return true;
  }
  return false;
}
function recordEntryAlertDispatched(key, nowMs = Date.now()) {
  if (!key) return;
  entryAlertDedupeState.set(key, nowMs);
}
function clearEntryAlertDedupeForTest() {
  entryAlertDedupeState.clear();
}
function resolveEntrySideFromIntent(intentRow = {}) {
  const explicit = String(intentRow && intentRow.side || "").trim().toUpperCase();
  if (explicit === "LONG" || explicit === "SHORT") return explicit;
  const event = String(intentRow && intentRow.event || "").toUpperCase();
  if (event.includes("LONG")) return "LONG";
  if (event.includes("SHORT")) return "SHORT";
  return null;
}

// 2026-04-29 — recognise the "broker side actually entered" reasons.
// V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL and
// V2_PRODUCTION_ENTRY_LIVE_POST_FILL_ROUTE_FAILURE_PROTECTED both
// arrive on a bridge `ok=false` return path, but the broker order has
// already filled — the operator's capital is exposed on the exchange
// and they need to know about it (often more urgently than a clean
// success). Treat these the same as the success path for the purpose
// of dispatching the entry α alert; only the severity / note text
// differs.
function classifyEntryAlertReachability(handoffResult = null) {
  const ok = handoffResult && handoffResult.ok === true;
  if (ok && String(handoffResult.reason || "") === "V2_DISCOVERY_BRIDGE_EXECUTED") {
    return { reachable: true, severity: "INFO", post_fill_only: false, reason: "V2_DISCOVERY_BRIDGE_EXECUTED" };
  }
  const endpoint = handoffResult && handoffResult.endpoint_result;
  const endpointReason = endpoint && String(endpoint.reason || "");
  if (endpointReason === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL") {
    return { reachable: true, severity: "CRITICAL", post_fill_only: true, reason: endpointReason };
  }
  if (endpointReason === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_ROUTE_FAILURE_PROTECTED") {
    return { reachable: true, severity: "WARN", post_fill_only: true, reason: endpointReason };
  }
  return { reachable: false, severity: null, post_fill_only: false, reason: null };
}
const { loadLatestLiquidationSnapshot } = require("./binanceLiquidationStreamCollector");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function clamp01(value, fallback = 0) {
  const n = toNumberOrNull(value);
  if (n === null) return fallback;
  return Math.max(0, Math.min(1, n));
}

function pickNumber(source, ...keys) {
  const row = asObject(source);
  if (!row) return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const n = toNumberOrNull(row[key]);
      if (n !== null) return n;
    }
  }
  return null;
}

function metricNumber(marketDataQuality = null, ...keys) {
  const row = asObject(marketDataQuality);
  const metrics = asObject(row && row.metrics);
  const fromMetrics = pickNumber(metrics, ...keys);
  if (fromMetrics !== null) return fromMetrics;
  return pickNumber(row, ...keys);
}

function estimateStopPctFromIntent(features = {}, intentRow = {}) {
  const explicit = Math.abs(toNumberOrNull(features.ev_gate_sl_pct) ?? toNumberOrNull(features.stop_pct) ?? 0);
  if (explicit > 0) return explicit;
  const signalPrice = toNumberOrNull(intentRow.signal_price ?? features.signal_price);
  const stopPrice = toNumberOrNull(features.stop_price);
  if (signalPrice > 0 && stopPrice > 0) {
    return Math.abs(signalPrice - stopPrice) / signalPrice * 100;
  }
  return null;
}

function estimateCostREquivalent({ costEstimateBps = null, stopPct = null, grossR = null } = {}) {
  const explicitCost = toNumberOrNull(costEstimateBps);
  const stop = toNumberOrNull(stopPct);
  if (explicitCost !== null && stop > 0) {
    return Math.max(0, explicitCost / (100 * stop));
  }
  const gross = toNumberOrNull(grossR);
  if (gross !== null) return Math.max(0.02, Math.min(0.2, gross * 0.05));
  return null;
}

function stepSafeNotional({ maxNotionalQuote = null, referencePrice = null, stepSize = null, minNotionalQuote = null, tp1QtyRatio = 0.5 } = {}) {
  const maxNotional = toNumberOrNull(maxNotionalQuote);
  const price = toNumberOrNull(referencePrice);
  const step = toNumberOrNull(stepSize);
  const minNotional = toNumberOrNull(minNotionalQuote) ?? 0;
  const ratio = toNumberOrNull(tp1QtyRatio) ?? 0.5;
  if (!(maxNotional > 0) || !(price > 0) || !(step > 0)) return maxNotional;
  const units = Math.floor(maxNotional / price / step);
  const safeQty = units * step;
  const safeNotional = safeQty * price;
  const tp1Units = Math.floor((safeQty * ratio) / step);
  const tp1Qty = tp1Units * step;
  const tp1Notional = tp1Qty * price;
  if (safeNotional >= minNotional && tp1Notional >= minNotional && safeNotional > 0) return safeNotional;
  return maxNotional;
}

function stableJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash12(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

async function persistDiscoveryExecutionPermitLedger({
  db = null,
  env = process.env,
  executionPermit = null,
} = {}) {
  const permit = asObject(executionPermit);
  const permitId = trimOrNull(permit && permit.openclaw_execution_permit_id);
  if (!permit || !permitId) {
    return Object.freeze({
      ok: false,
      reason: "OPENCLAW_EXECUTION_PERMIT_LEDGER_DOC_REQUIRED",
      openclaw_execution_permit_id: permitId,
    });
  }
  const permits = resolveV2CollectionRef({ db, env, collectionKey: "OPENCLAW_EXECUTION_PERMITS" });
  const ref = permits.ref.doc(permitId);
  const snap = await ref.get();
  if (snap && snap.exists === true) {
    const existing = snap.data ? (snap.data() || {}) : {};
    const status = upper(existing.permit_status);
    if (status !== "ISSUED") {
      return Object.freeze({
        ok: false,
        reason: "OPENCLAW_EXECUTION_PERMIT_LEDGER_ALREADY_USED",
        openclaw_execution_permit_id: permitId,
        permit_status: status,
      });
    }
    return Object.freeze({
      ok: true,
      reason: "OPENCLAW_EXECUTION_PERMIT_LEDGER_ALREADY_ISSUED",
      openclaw_execution_permit_id: permitId,
      collectionName: permits.collectionName,
    });
  }
  await ref.set(permit, { merge: false });
  return Object.freeze({
    ok: true,
    reason: "OPENCLAW_EXECUTION_PERMIT_LEDGER_WRITTEN",
    openclaw_execution_permit_id: permitId,
    collectionName: permits.collectionName,
  });
}

function deriveCounterfactualInputs({ bundle, intentRow, request, body }) {
  const bundleObj = asObject(bundle);
  if (!bundleObj) return null;
  const signalCriteria = asObject(bundleObj.signalCriteria);
  const shadowDecision = asObject(signalCriteria && signalCriteria.shadow_filter_decision);
  if (!shadowDecision) return null;
  const signalIntent = asObject(bundleObj.signalIntent);
  const symbol = upper(signalIntent && signalIntent.symbol);
  const side = upper(signalIntent && signalIntent.side);
  if (!symbol || !side) return null;
  const intent = asObject(intentRow);
  const featureValues = asObject(intent && intent.features_json);
  const candleCloseMs = toNumberOrNull(
    (intent && intent.signal_bar_close_time_utc_ms)
    ?? (featureValues && featureValues.signal_bar_close_time_utc_ms),
  );
  if (!Number.isFinite(candleCloseMs)) return null;
  const requestBody = asObject(body) || asObject(request && request.body);
  const sizing = asObject(requestBody && requestBody.sizing);
  const refPrice = toNumberOrNull(
    (sizing && sizing.referencePrice)
    ?? (intent && intent.signal_price)
    ?? (featureValues && featureValues.reference_price),
  );
  const decision = asObject(bundleObj.openclawDecision);
  const verdict = decision && decision.approved === true ? "PASS" : "BLOCK";
  return {
    symbol,
    side,
    candle_close_ms: candleCloseMs,
    ref_price: refPrice,
    signal_id: trimOrNull(signalIntent && signalIntent.signal_intent_id),
    signal_verdict: verdict,
    shadow_filter_decision: shadowDecision,
  };
}

function recordDiscoveryBridgeShadowCounterfactual({ db, env, bundle, intentRow, request, body }) {
  const inputs = deriveCounterfactualInputs({ bundle, intentRow, request, body });
  if (!inputs) return;
  Promise.resolve()
    .then(() => recordCounterfactualEvaluation({ db, env, ...inputs, now_ms: Date.now() }))
    .catch((error) => {
      const message = error && error.message ? String(error.message) : String(error);
      console.warn("[V2_SHADOW_COUNTERFACTUAL_LEDGER_FAIL]", message);
    });
}

async function persistDiscoveryBridgeLedgers({
  db = null,
  env = process.env,
  built = null,
  intentRow = null,
  nowIso = null,
} = {}) {
  const row = asObject(built);
  const request = asObject(row && row.request);
  const body = asObject(request && request.body);
  const worldState = asObject(request && request.worldState) || asObject(body && body.worldState);
  const executionPermit = asObject(request && request.executionPermit) || asObject(body && body.executionPermit);
  const bundle = asObject(row && row.bundle) || asObject(body && body.bundle);
  const result = {
    ok: true,
    reason: "V2_DISCOVERY_BRIDGE_LEDGER_PERSISTED",
    world_state: null,
    decision_bundle: null,
    execution_permit: null,
  };
  try {
    result.world_state = await persistOpenClawWorldState({
      db,
      env,
      worldState,
      merge: true,
    });
  } catch (error) {
    result.ok = false;
    result.reason = "V2_DISCOVERY_BRIDGE_WORLD_STATE_LEDGER_WRITE_FAILED";
    result.world_state = {
      ok: false,
      reason: trimOrNull(error && error.message) || "WORLD_STATE_LEDGER_WRITE_FAILED",
    };
    return Object.freeze(result);
  }
  try {
    result.decision_bundle = await persistOpenClawDecisionBundleLedger({
      db,
      env,
      bundle,
      source: "V2_DISCOVERY_CANARY_SERVER_SIGNAL_BRIDGE",
      createdAt: nowIso,
    });
  } catch (error) {
    result.ok = false;
    result.reason = "V2_DISCOVERY_BRIDGE_DECISION_BUNDLE_LEDGER_WRITE_FAILED";
    result.decision_bundle = {
      ok: false,
      reason: trimOrNull(error && error.message) || "DECISION_BUNDLE_LEDGER_WRITE_FAILED",
    };
    return Object.freeze(result);
  }
  recordDiscoveryBridgeShadowCounterfactual({ db, env, bundle, intentRow, request, body });
  result.execution_permit = await persistDiscoveryExecutionPermitLedger({
    db,
    env,
    executionPermit,
  });
  if (!result.execution_permit || result.execution_permit.ok !== true) {
    result.ok = false;
    result.reason = "V2_DISCOVERY_BRIDGE_EXECUTION_PERMIT_LEDGER_WRITE_FAILED";
    return Object.freeze(result);
  }
  return Object.freeze(result);
}

function normalizeAccountPositions(accountSummary = null) {
  return (Array.isArray(accountSummary && accountSummary.positions) ? accountSummary.positions : []).map((row) => {
    const symbol = upper(row && row.symbol);
    const notionalQuote = Math.abs(toNumberOrNull(row && (row.notional_quote ?? row.notionalQuote)) || 0);
    const qtyAbs = Math.abs(toNumberOrNull(row && (row.qty_abs ?? row.qtyAbs ?? row.position_amt ?? row.positionAmt)) || 0);
    return {
      symbol,
      side: upper(row && row.side),
      notional_quote: notionalQuote,
      qty_abs: qtyAbs,
    };
  }).filter((row) => row.symbol && (row.qty_abs > 0 || row.notional_quote > 0));
}

function mergeDiscoveryCanaryStateWithAccount({ state = null, accountSummary = null } = {}) {
  const base = asObject(state) ? { ...state } : {};
  const accountPositions = normalizeAccountPositions(accountSummary);
  const accountActivePositionN = accountPositions.length;
  const stateActivePositionN = toNumberOrNull(base.active_position_n ?? base.activePositionN);
  const mergedActivePositionN = Number.isFinite(stateActivePositionN)
    ? Math.max(stateActivePositionN, accountActivePositionN)
    : accountActivePositionN;
  return Object.freeze({
    ...base,
    active_position_n: mergedActivePositionN,
    exchange_active_position_n: accountActivePositionN,
    exchange_positions: accountPositions,
    state_source: "FIRESTORE_READ_MODEL_AND_BINANCE_ACCOUNT",
  });
}

function sideFromIntent(row = {}) {
  const event = upper(row.event);
  const side = upper(row.side);
  const family = upper(asObject(row.features_json) && row.features_json.signal_family);
  if (family === "LONG" || event === "LONG" || side === "BUY") return "LONG";
  if (family === "SHORT" || event === "SHORT" || side === "SELL") return "SHORT";
  return null;
}

function setupTypeFromFeatures(features = {}) {
  const explicit = upper(features.setup_type);
  if (explicit) return explicit;
  const trigger = upper(features.trigger_type);
  if (trigger === "BREAKOUT" || trigger === "BREAKDOWN") return "BREAKOUT_RETEST";
  if (trigger === "CONTINUATION") return "MOMENTUM_CONTINUATION";
  if (trigger === "RECLAIM" || trigger === "LOSS") return "PULLBACK_RECLAIM";
  return "PULLBACK_RECLAIM";
}

function resolveReferencePrice({ intentRow = {}, book = null, fallback = null } = {}) {
  const fromIntent = toNumberOrNull(intentRow.signal_price);
  if (fromIntent && fromIntent > 0) return fromIntent;
  const features = asObject(intentRow.features_json) || {};
  const fromFeature = toNumberOrNull(features.signal_price);
  if (fromFeature && fromFeature > 0) return fromFeature;
  const bid = toNumberOrNull(book && book.bidPrice);
  const ask = toNumberOrNull(book && book.askPrice);
  if (bid && ask && ask >= bid) return (bid + ask) / 2;
  const fb = toNumberOrNull(fallback);
  return fb && fb > 0 ? fb : null;
}

function fetchFuturesBaseUrl(env = process.env) {
  return trimOrNull(env.BINANCE_FUTURES_BASE_URL) || "https://fapi.binance.com";
}

async function fetchFuturesPublicJson(path, params = {}, env = process.env) {
  const url = new URL(`${fetchFuturesBaseUrl(env)}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`BINANCEFUT_PUBLIC_HTTP_${res.status}:${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
}

async function collectMarketDataQuality({
  env = process.env,
  db = null,
  symbol,
  candleCloseMs,
  nowMs = Date.now(),
  fetchBookTicker = fetchFuturesBookTicker,
  fetchPublicJson = (path, params) => fetchFuturesPublicJson(path, params, env),
  liquidationSnapshot = undefined,
  loadLiquidationSnapshot = loadLatestLiquidationSnapshot,
} = {}) {
  const sym = upper(symbol);
  if (!sym) throw new Error("V2_DISCOVERY_BRIDGE_SYMBOL_REQUIRED");
  const [book, premium, ticker24h, resolvedLiquidationSnapshot] = await Promise.all([
    fetchBookTicker({ symbol: sym }),
    fetchPublicJson("/fapi/v1/premiumIndex", { symbol: sym }),
    fetchPublicJson("/fapi/v1/ticker/24hr", { symbol: sym }),
    liquidationSnapshot !== undefined
      ? Promise.resolve(liquidationSnapshot)
      : Promise.resolve()
        .then(() => (typeof loadLiquidationSnapshot === "function"
          ? loadLiquidationSnapshot({ db, env, symbol: sym })
          : null))
        .catch(() => null),
  ]);
  const microstructure = await collectBinanceMicrostructureFeatures({
    symbol: sym,
    env,
    fetchJson: fetchPublicJson,
    liquidationSnapshot: resolvedLiquidationSnapshot,
  }).catch((error) => Object.freeze({
    ok: false,
    reason: "BINANCE_MICROSTRUCTURE_FEATURES_FAILED",
    symbol: sym,
    features: Object.freeze({ symbol: sym }),
    errors: Object.freeze([error && error.message ? String(error.message) : String(error)]),
  }));
  const snapshot = {
    symbol: sym,
    candle_close_ms: toNumberOrNull(candleCloseMs),
    mark_price: toNumberOrNull(premium && premium.markPrice),
    index_price: toNumberOrNull(premium && premium.indexPrice),
    best_bid: toNumberOrNull(book && book.bidPrice),
    best_ask: toNumberOrNull(book && book.askPrice),
    volume_quote_24h: toNumberOrNull(ticker24h && ticker24h.quoteVolume),
    gap_bars: 0,
    source: "BINANCE_FUTURES_PUBLIC",
  };
  const baseQuality = evaluateMarketDataQualityGate({ env, snapshot, nowMs });
  const microFeatures = asObject(microstructure && microstructure.features) || {};
  const quality = Object.freeze({
    ...baseQuality,
    warnings: Object.freeze(Array.from(new Set([
      ...(Array.isArray(baseQuality.warnings) ? baseQuality.warnings : []),
      ...((microstructure && microstructure.ok === false) ? ["MARKET_DATA:MICROSTRUCTURE_PARTIAL"] : []),
    ]))),
    metrics: Object.freeze({
      ...(asObject(baseQuality.metrics) || {}),
      ...microFeatures,
      microstructure_ok: microstructure ? microstructure.ok === true : false,
      microstructure_reason: microstructure ? microstructure.reason : null,
      microstructure_errors: microstructure && Array.isArray(microstructure.errors) ? microstructure.errors : [],
    }),
  });
  return Object.freeze({
    quality,
    book,
    premium,
    ticker24h,
    microstructure,
  });
}

function buildSignalCriteriaSeedFromIntent({ intentRow = {}, marketDataQuality = null } = {}) {
  const features = asObject(intentRow.features_json) || {};
  const side = sideFromIntent(intentRow);
  const grossR = toNumberOrNull(features.expected_gross_r) ?? toNumberOrNull(features.rr);
  const spreadBps = toNumberOrNull(features.spread_bps)
    ?? metricNumber(marketDataQuality, "spread_bps", "spreadBps");
  const markIndexGapBps = toNumberOrNull(features.mark_index_gap_bps)
    ?? metricNumber(marketDataQuality, "mark_index_gap_bps", "mark_index_divergence_bps", "markIndexGapBps", "markIndexDivergenceBps");
  const feeBpsRoundTrip = toNumberOrNull(features.fee_bps_round_trip)
    ?? toNumberOrNull(features.fee_estimate_bps)
    ?? toNumberOrNull(features.commission_bps_round_trip)
    ?? 8;
  const marketQualityScore = metricNumber(marketDataQuality, "market_quality_score", "marketQualityScore", "quality_score")
    ?? (marketDataQuality && marketDataQuality.ok === true ? 1 : null)
    ?? toNumberOrNull(features.market_quality_score);
  const costEstimateBps = toNumberOrNull(features.cost_estimate_bps)
    ?? (spreadBps !== null ? spreadBps + feeBpsRoundTrip : feeBpsRoundTrip);
  const explicitNetR = toNumberOrNull(features.expected_net_r_after_cost)
    ?? toNumberOrNull(features.net_r_after_cost)
    ?? toNumberOrNull(features.expected_net_r);
  const stopPct = estimateStopPctFromIntent(features, intentRow);
  const explicitCostREquivalent = toNumberOrNull(features.cost_r_equivalent);
  const costREquivalent = explicitCostREquivalent !== null
    ? explicitCostREquivalent
    : estimateCostREquivalent({ costEstimateBps, stopPct, grossR });
  const resolvedNetR = explicitNetR !== null
    ? explicitNetR
    : (grossR !== null && costREquivalent !== null ? Math.max(0, grossR - costREquivalent) : null);
  const fundingPenaltyBpsFromMarket = metricNumber(marketDataQuality, "funding_penalty_bps");
  const resolvedFundingPenaltyBps = Math.abs(toNumberOrNull(features.funding_penalty_bps) ?? fundingPenaltyBpsFromMarket ?? 0);
  return Object.freeze({
    htf_regime: {
      regime: side,
      alignment_score: clamp01(features.htf_alignment_score ?? features.structure_alignment ?? features.canonical_engine_field_alignment ?? features.confidence, 0),
    },
    setup_gate: {
      setup_type: setupTypeFromFeatures(features),
      setup_quality_score: clamp01(features.setup_quality_score ?? features.pullback_quality ?? features.opportunity_score, 0),
    },
    trigger_gate: {
      trigger_level: toNumberOrNull(features.trigger_level),
      trigger_confirmed: features.trigger_confirmed === true || upper(features.trigger_type) !== null,
      volume_zscore: toNumberOrNull(features.volume_zscore) ?? toNumberOrNull(features.volume_ratio) ?? toNumberOrNull(features.participation),
      rsi_entry_tf: toNumberOrNull(features.rsi_entry_tf)
        ?? (toNumberOrNull(features.directional_pressure) !== null
          ? (side === "SHORT"
            ? 55 - (25 * clamp01(features.directional_pressure))
            : 45 + (25 * clamp01(features.directional_pressure)))
          : null),
    },
    no_trade_gate: {
      market_quality_score: marketQualityScore,
      spread_bps: spreadBps,
      mark_index_gap_bps: markIndexGapBps,
      funding_penalty_bps: resolvedFundingPenaltyBps,
    },
    expected_edge_gate: {
      expected_gross_r: grossR,
      expected_net_r_after_cost: resolvedNetR,
      cost_estimate_bps: costEstimateBps,
      cost_r_equivalent: costREquivalent,
    },
  });
}

function buildStrategyFilterResultFromIntent({ intentRow = {}, nowIso = null } = {}) {
  const features = asObject(intentRow.features_json) || {};
  const side = sideFromIntent(intentRow);
  return Object.freeze({
    filter_name: "HTF_DIRECTION_ALIGNMENT",
    verdict: "PASS",
    reason: "V6_SERVER_NATIVE_SIGNAL_EMITTED",
    signal_side: side,
    htf_direction: side,
    htf_confidence: clamp01(features.htf_alignment_score ?? features.structure_alignment ?? features.confidence, 0),
    min_confidence: 0.4,
    evaluated_at: trimOrNull(nowIso) || new Date().toISOString(),
  });
}

function buildDiscoveryCanaryBundleFromIntent({
  intentRow,
  marketDataQuality,
  nowIso = null,
} = {}) {
  const row = asObject(intentRow);
  if (!row) throw new Error("V2_DISCOVERY_BRIDGE_INTENT_REQUIRED");
  const features = asObject(row.features_json) || {};
  const side = sideFromIntent(row);
  if (!side) throw new Error("V2_DISCOVERY_BRIDGE_SIDE_REQUIRED");
  const symbol = upper(row.symbol_or_pair_id || row.symbol);
  if (!symbol) throw new Error("V2_DISCOVERY_BRIDGE_SYMBOL_REQUIRED");
  const createdAt = trimOrNull(row.signal_bar_close_time_utc)
    || trimOrNull(features.signal_bar_close_time_utc)
    || trimOrNull(row.created_at)
    || trimOrNull(nowIso)
    || new Date().toISOString();
  const signalId = trimOrNull(row.signal_id || features.signal_id || row.intent_id);
  const score = clamp01(features.score_norm ?? features.opportunity_score ?? features.posterior ?? features.confidence, 0);
  const signalCriteria = buildSignalCriteriaSeedFromIntent({ intentRow: row, marketDataQuality });
  const featureValues = Object.freeze({
    ...(asObject(marketDataQuality && marketDataQuality.metrics) || {}),
    ...features,
    signal_id: signalId,
    source_intent_id: trimOrNull(row.intent_id),
    discovery_canary_bridge: true,
  });
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: signalId || `DISCOVERY_BRIDGE__${symbol}__${hash12(stableJson(row))}`,
    symbol,
    side,
    qualityScore: score,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "V2 discovery canary server-native signal handoff",
    policyScope: `${symbol}_${upper(row.tf || "15m") || "15M"}`,
    strategyFilterResult: buildStrategyFilterResultFromIntent({ intentRow: row, nowIso: createdAt }),
    timeframe: upper(row.tf || "15m") || "15M",
    featureSchemaVersion: "server_native_v6110_discovery_bridge_v1",
    featureValues,
    marketRegime: trimOrNull(features.market_regime || features.regime),
    proposalVerdict: "PASS",
    rankScore: score,
    sizeRatio: clamp01(features._openclaw_authority_qty_final ?? features._live_exec_policy_qty_after ?? row.qty_pct, 1),
    riskBand: "LOW",
    featuresHash: hash12(stableJson(featureValues)),
    modelVersion: "server-native-v6110-openclaw-bridge",
    decisionSummary: "Server-native V6.1.1.0 signal approved for bounded V2 discovery canary",
    marketDataQuality,
    signalCriteria,
    createdAt,
  });
}

async function buildDiscoveryCanaryState({ db = null, exchange = "BINANCEFUT", nowMs = Date.now() } = {}) {
  const firestore = db || getFirestore();
  let activePositionN = null;
  let positionStateError = null;
  try {
    const positions = await listExchangePositionReadViews({ exchange, limit: 100 });
    activePositionN = (Array.isArray(positions) ? positions : []).filter((row) => {
      const state = upper(row && row.state);
      const qty = Math.abs(toNumberOrNull(row && (row.qty_base ?? row.position_amt ?? row.size_pct)) || 0);
      return state === "ACTIVE" || qty > 0;
    }).length;
  } catch (error) {
    positionStateError = error && error.message ? String(error.message) : String(error);
  }
  let tradeCount24h = null;
  let dailyRealizedPnlQuote = null;
  let fillStateError = null;
  try {
    tradeCount24h = 0;
    dailyRealizedPnlQuote = 0;
    const sinceMs = Number(nowMs) - (24 * 60 * 60 * 1000);
    const snap = await firestore.collection("fills_paper").orderBy("created_at", "desc").limit(200).get();
    snap.forEach((doc) => {
      const row = doc.data() || {};
      const atMs = Date.parse(String(row.created_at || row.filled_at || row.exec_bar_close_time_utc || ""));
      if (!Number.isFinite(atMs) || atMs < sinceMs) return;
      if (upper(row.execution_mode) !== "LIVE") return;
      const event = upper(row.event);
      if (event === "LONG" || event === "SHORT" || upper(row.event_intent) === "ENTRY") tradeCount24h += 1;
      const pnl = toNumberOrNull(row.realized_pnl_quote ?? row.realizedPnlQuote ?? row.pnl);
      if (pnl !== null) dailyRealizedPnlQuote += pnl;
    });
  } catch (error) {
    tradeCount24h = null;
    dailyRealizedPnlQuote = null;
    fillStateError = error && error.message ? String(error.message) : String(error);
  }
  return Object.freeze({
    active_position_n: activePositionN,
    trade_count_24h: tradeCount24h,
    daily_realized_pnl_quote: dailyRealizedPnlQuote,
    state_source: "FIRESTORE_READ_MODEL",
    state_ok: positionStateError === null && fillStateError === null,
    position_state_error: positionStateError,
    fill_state_error: fillStateError,
  });
}

async function buildDiscoveryCanaryLiveRequestFromIntent({
  env = process.env,
  db = null,
  intentRow,
  liveCfg = null,
  referencePrice = null,
  nowMs = Date.now(),
  nowIso = new Date(nowMs).toISOString(),
  marketDataQuality = null,
  exchangeInfo = null,
  discoveryState = null,
} = {}) {
  const row = asObject(intentRow);
  if (!row) return Object.freeze({ ok: false, reason: "V2_DISCOVERY_BRIDGE_INTENT_REQUIRED" });
  const symbol = upper(row.symbol_or_pair_id || row.symbol);
  if (!symbol) return Object.freeze({ ok: false, reason: "V2_DISCOVERY_BRIDGE_SYMBOL_REQUIRED" });
  const realizedGuard = await evaluateDiscoveryCanaryRealizedPerformanceGuard({
    env,
    db,
    symbol,
    nowMs,
  });
  if (!realizedGuard || realizedGuard.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_CANARY_REALIZED_SYMBOL_GUARD_BLOCKED",
      realized_performance_guard: realizedGuard || null,
      blockers: realizedGuard && realizedGuard.blockers || Object.freeze(["DISCOVERY_CANARY_REALIZED_GUARD:BLOCKED"]),
    });
  }
  const marketPack = marketDataQuality
    ? { quality: marketDataQuality, book: null }
    : await collectMarketDataQuality({
      env,
      symbol,
      candleCloseMs: row.signal_bar_close_time_utc_ms || asObject(row.features_json) && row.features_json.signal_bar_close_time_utc_ms,
      nowMs,
    });
  if (!marketPack.quality || marketPack.quality.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_BRIDGE_MARKET_DATA_QUALITY_BLOCKED",
      market_data_quality: marketPack.quality || null,
    });
  }
  const info = exchangeInfo || await fetchFuturesExchangeInfo(symbol);
  const price = resolveReferencePrice({ intentRow: row, book: marketPack.book, fallback: referencePrice });
  const maxOrderQuote = resolveDiscoverySymbolNotionalQuote({
    env,
    symbol,
    fallback: toNumberOrNull(liveCfg && liveCfg.maxOrderQuote)
    ?? toNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE)
    ?? 6,
  });
  const bundle = buildDiscoveryCanaryBundleFromIntent({
    intentRow: row,
    marketDataQuality: marketPack.quality,
    nowIso,
  });
  const state = discoveryState || await buildDiscoveryCanaryState({ db, exchange: row.exchange || "BINANCEFUT", nowMs });
  const minNotionalQuote = toNumberOrNull(info && info.minNotional) ?? toNumberOrNull(liveCfg && liveCfg.minOrderQuote) ?? 5;
  const stepSize = toNumberOrNull(info && info.stepSize);
  const requestedNotionalQuote = stepSafeNotional({
    maxNotionalQuote: maxOrderQuote,
    referencePrice: price,
    stepSize,
    minNotionalQuote,
  });
  const request = buildV2ProductionEntryLiveRequest({
    bundle,
    sizing: {
      referencePrice: price,
      requestedNotionalQuote,
      maxNotionalQuote: maxOrderQuote,
      minNotionalQuote,
      minQtyAbs: toNumberOrNull(info && info.minQty) ?? 0,
      stepSize,
      allowMinOrderBump: true,
    },
    confirm: DISCOVERY_CONFIRM_PHRASE,
    discoveryCanaryState: state,
    env,
    now: () => nowIso,
  });
  if (!request.ok) {
    return Object.freeze({
      ...request,
      reason: request.reason || "V2_DISCOVERY_BRIDGE_REQUEST_BLOCKED",
      market_data_quality: marketPack.quality,
      discovery_canary_state: state,
    });
  }
  return Object.freeze({
    ok: true,
    reason: "V2_DISCOVERY_BRIDGE_REQUEST_READY",
    request,
    bundle,
    market_data_quality: marketPack.quality,
    realized_performance_guard: realizedGuard,
    discovery_canary_state: state,
    exchange_info: info,
  });
}

async function runV2DiscoveryCanaryServerSignalHandoff({
  env = process.env,
  db = null,
  intentRow,
  liveCfg = null,
  referencePrice = null,
  requestId = null,
  runLiveEndpoint = runV2ProductionEntryLiveEndpoint,
  nowMs = Date.now(),
} = {}) {
  if (!asObject(intentRow)) return Object.freeze({ ok: false, reason: "V2_DISCOVERY_BRIDGE_INTENT_REQUIRED" });
  const accountSummary = await getBinanceFuturesAccountSummary({
    apiKey: liveCfg && liveCfg.apiKey,
    apiSecret: liveCfg && liveCfg.apiSecret,
    forceRefresh: true,
  });
  const firestoreState = await buildDiscoveryCanaryState({
    db,
    exchange: intentRow && (intentRow.exchange || "BINANCEFUT"),
    nowMs,
  });
  const discoveryState = mergeDiscoveryCanaryStateWithAccount({
    state: firestoreState,
    accountSummary,
  });
  const built = await buildDiscoveryCanaryLiveRequestFromIntent({
    env,
    db,
    intentRow,
    liveCfg,
    referencePrice,
    discoveryState,
    nowMs,
  });
  if (!built.ok) return built;
  const ledgerPersistence = await persistDiscoveryBridgeLedgers({
    db,
    env,
    built,
    intentRow,
    nowIso: new Date(nowMs).toISOString(),
  });
  if (!ledgerPersistence || ledgerPersistence.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_BRIDGE_LEDGER_PERSIST_BLOCKED",
      request: built.request,
      ledger_persistence: ledgerPersistence || null,
      market_data_quality: built.market_data_quality,
      discovery_canary_state: built.discovery_canary_state,
    });
  }
  const candidateNotional = built.request && built.request.entrySizingDecision
    ? built.request.entrySizingDecision.notional_quote
    : null;
  const result = await runLiveEndpoint({
    db,
    env,
    body: {
      ...built.request.body,
      riskGovernor: {
        account: {
          equity_quote: toNumberOrNull(accountSummary && accountSummary.total_value),
          daily_loss_quote: Math.max(0, -(toNumberOrNull(built.discovery_canary_state && built.discovery_canary_state.daily_realized_pnl_quote) || 0)),
          consecutive_loss_n: 0,
          trade_count_24h: toNumberOrNull(built.discovery_canary_state && built.discovery_canary_state.trade_count_24h) || 0,
        },
        positions: normalizeAccountPositions(accountSummary),
        candidate: {
          symbol: upper(intentRow && (intentRow.symbol_or_pair_id || intentRow.symbol)),
          notional_quote: candidateNotional,
        },
        market: {
          volatility_bps: 0,
        },
      },
    },
    requestId: trimOrNull(requestId) || trimOrNull(intentRow && intentRow.intent_id),
  });
  // 2026-04-29 — ENTRY α alert dispatcher. Called for both the clean
  // success path AND the post-fill-failure branches where broker
  // order has already filled (operator capital is exposed). dedupe
  // by signal_id so fillSync's later authoritative echo never
  // double-fires.
  function maybeDispatchEntryAlert(handoffResult) {
    try {
      const reachability = classifyEntryAlertReachability(handoffResult);
      if (!reachability.reachable) return;
      const intentSym = upper(intentRow && (intentRow.symbol_or_pair_id || intentRow.symbol)) || null;
      const signalId = trimOrNull(intentRow && (intentRow.signal_id || intentRow.signal_intent_id))
        || trimOrNull(built && built.request && built.request.body && built.request.body.signalIntent && built.request.body.signalIntent.signal_intent_id);
      const intentId = trimOrNull(intentRow && intentRow.intent_id);
      const dedupeKey = buildEntryAlertDedupeKey({ symbol: intentSym, signalId, intentId });
      if (!shouldDispatchEntryAlert(dedupeKey)) return;
      recordEntryAlertDispatched(dedupeKey);
      const side = resolveEntrySideFromIntent(intentRow) || "LONG";
      const refPrice = Number.isFinite(Number(referencePrice)) ? Number(referencePrice) : null;
      const sizingDecision = (built && built.request && built.request.body && built.request.body.entrySizingDecision) || null;
      const execQty = Number.isFinite(Number(sizingDecision && sizingDecision.entry_qty_abs))
        ? Number(sizingDecision.entry_qty_abs) : null;
      const notional = Number.isFinite(Number(sizingDecision && sizingDecision.notional_quote))
        ? Number(sizingDecision.notional_quote) : null;
      const noteFor = (() => {
        if (reachability.severity === "CRITICAL") {
          return "V2 discovery bridge — broker order filled but native protection setup CRITICAL. Operator must verify position exposure manually.";
        }
        if (reachability.severity === "WARN") {
          return "V2 discovery bridge — broker order filled and protected, but downstream route step failed. Position is in place; downstream reconciliation will follow.";
        }
        return "V2 discovery bridge — entry executed and protected; alert emitted at place boundary (fillSync echo dedupe by signal_id).";
      })();
      sendTradeExecutionAlert({
        exchange: upper(intentRow && intentRow.exchange) || "BINANCEFUT",
        symbol: intentSym,
        event: side === "SHORT" ? "ENTRY_SHORT" : "ENTRY_LONG",
        intent: "ENTRY",
        side,
        executionMode: "LIVE",
        execPrice: refPrice,
        execQty,
        execQtyBase: execQty,
        notional,
        tradeAlertDedupeKey: dedupeKey,
        idempotencyKey: dedupeKey,
        signalId,
        intentId,
        runId: trimOrNull(intentRow && intentRow.run_id) || trimOrNull(requestId),
        rawEvidenceEvent: side === "SHORT" ? "ENTRY_SHORT" : "ENTRY_LONG",
        note: noteFor,
        severity: reachability.severity,
        post_fill_only: reachability.post_fill_only,
        bridge_reason: reachability.reason,
      }).catch((alertErr) => {
        console.warn(
          "[V2_DISCOVERY_BRIDGE_ENTRY_ALERT_FAIL]",
          alertErr && alertErr.message ? alertErr.message : String(alertErr),
        );
      });
    } catch (alertGuardErr) {
      console.warn(
        "[V2_DISCOVERY_BRIDGE_ENTRY_ALERT_GUARD]",
        alertGuardErr && alertGuardErr.message ? alertGuardErr.message : String(alertGuardErr),
      );
    }
  }

  if (!result || result.ok !== true) {
    const blockedHandoffResult = {
      ok: false,
      reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
      endpoint_result: result || null,
    };
    // Even on bridge ok=false, broker may have already filled (post-fill
    // protection critical / post-fill route failure). Operator MUST know
    // about that exposure.
    maybeDispatchEntryAlert(blockedHandoffResult);
    return Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED",
      request: built.request,
      ledger_persistence: ledgerPersistence,
      endpoint_result: result || null,
      market_data_quality: built.market_data_quality,
      discovery_canary_state: built.discovery_canary_state,
    });
  }

  const successHandoffResult = {
    ok: true,
    reason: "V2_DISCOVERY_BRIDGE_EXECUTED",
    endpoint_result: result,
  };
  maybeDispatchEntryAlert(successHandoffResult);

  return Object.freeze({
    ok: true,
    reason: "V2_DISCOVERY_BRIDGE_EXECUTED",
    request: built.request,
    ledger_persistence: ledgerPersistence,
    endpoint_result: result,
    market_data_quality: built.market_data_quality,
    discovery_canary_state: built.discovery_canary_state,
  });
}

module.exports = {
  collectMarketDataQuality,
  buildSignalCriteriaSeedFromIntent,
  buildDiscoveryCanaryBundleFromIntent,
  buildDiscoveryCanaryState,
  buildDiscoveryCanaryLiveRequestFromIntent,
  runV2DiscoveryCanaryServerSignalHandoff,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    sideFromIntent,
    setupTypeFromFeatures,
    // 2026-04-29 — entry α alert helpers
    buildEntryAlertDedupeKey,
    shouldDispatchEntryAlert,
    recordEntryAlertDispatched,
    clearEntryAlertDedupeForTest,
    resolveEntrySideFromIntent,
    classifyEntryAlertReachability,
    ENTRY_ALERT_DEDUPE_TTL_MS,
    resolveReferencePrice,
    stepSafeNotional,
    buildStrategyFilterResultFromIntent,
    normalizeAccountPositions,
    mergeDiscoveryCanaryStateWithAccount,
    persistDiscoveryExecutionPermitLedger,
    persistDiscoveryBridgeLedgers,
    deriveCounterfactualInputs,
    recordDiscoveryBridgeShadowCounterfactual,
  },
};
