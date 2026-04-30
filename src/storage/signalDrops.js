const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { sendSignalDroppedAlert } = require("../services/signalLifecycleAlert");
const { markSignalConsumed, tryLockSignal } = require("./signalsConsume");
const { enrichFeaturesWithRegime } = require("../utils/regime");
const { confirmSelfEvolutionRuntimeSignal } = require("../utils/selfEvolutionRuntimeState");
const { buildEventEnvelope } = require("../utils/eventEnvelope");
const { deriveSignalDocId } = require("../utils/signalDocId");
const { extractLiveExecutionPolicyTrace, toLiveExecutionPolicyTopLevel } = require("../utils/liveExecutionPolicyTrace");
const { normalizeRiskGovernorSurface } = require("../v2/riskGovernorSurface");

function nowIso() {
  return new Date().toISOString();
}

function hash10(payload) {
  return crypto.createHash("sha1").update(String(payload || "")).digest("hex").slice(0, 10);
}

function normalizeExecutionMode(v) {
  const s = String(v || "").toUpperCase();
  if (s === "LIVE" || s === "LIVE_DRY_RUN" || s === "PAPER") return s;
  return null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveFeatureBag(payload = null) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.features_json && typeof payload.features_json === "object") return payload.features_json;
  if (payload.features && typeof payload.features === "object") return payload.features;
  return {};
}

function extractOpenClawAuthorityTrace(features = null) {
  const src = features && typeof features === "object" ? features : {};
  return {
    qty_requested_pct: toNum(src._openclaw_authority_qty_requested),
    qty_after_openclaw_pct: toNum(src._openclaw_authority_qty_after_openclaw),
    qty_final_pct: toNum(src._openclaw_authority_qty_final),
    entry_budget_required_qty_pct: toNum(src._openclaw_authority_entry_budget_guard_required_qty_pct),
    entry_budget_required_budget: toNum(src._openclaw_authority_entry_budget_guard_required_budget),
    entry_budget_min_required_quote: toNum(src._openclaw_authority_entry_budget_guard_min_required_quote),
    entry_budget_notional_quote: toNum(src._openclaw_authority_entry_budget_guard_notional_quote),
    entry_budget_budget_max: toNum(src._openclaw_authority_entry_budget_guard_budget_max),
    entry_budget_leverage: toNum(src._openclaw_authority_entry_budget_guard_leverage),
    entry_budget_shortfall_quote: toNum(src._openclaw_authority_entry_budget_guard_shortfall_quote),
    entry_budget_floor_applied: src._openclaw_authority_entry_budget_guard_floor_applied === true,
    entry_budget_floor_previous_qty_pct: toNum(src._openclaw_authority_entry_budget_guard_floor_previous_qty_pct),
    entry_budget_floor_qty_pct: toNum(src._openclaw_authority_entry_budget_guard_floor_qty_pct),
    entry_budget_floor_max_snap_qty_pct: toNum(src._openclaw_authority_entry_budget_guard_floor_max_snap_qty_pct),
    entry_budget_floor_reason: upper(src._openclaw_authority_entry_budget_guard_floor_reason),
  };
}

function coalesceDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function extractRiskGovernorSurface(features = null) {
  const src = features && typeof features === "object" ? features : {};
  if (src.v2_discovery_risk_governor_surface && typeof src.v2_discovery_risk_governor_surface === "object") {
    return normalizeRiskGovernorSurface(src.v2_discovery_risk_governor_surface);
  }
  if (src.v2_discovery_risk_governor_reason || src.v2_discovery_risk_governor_blockers) {
    return normalizeRiskGovernorSurface({
      ok: false,
      reason: src.v2_discovery_risk_governor_reason,
      blockers: Array.isArray(src.v2_discovery_risk_governor_blockers)
        ? src.v2_discovery_risk_governor_blockers
        : [src.v2_discovery_risk_governor_blockers].filter(Boolean),
    });
  }
  return null;
}

function buildDropAlertPayload(drop = null) {
  const payload = drop && typeof drop === "object" ? drop : {};
  const features = resolveFeatureBag(payload);
  const authorityTrace = extractOpenClawAuthorityTrace(features);
  const riskGovernor = extractRiskGovernorSurface(features);
  const bucket = resolveDropStageBucket(payload);
  return {
    exchange: payload.exchange,
    symbol: payload.symbol_or_pair_id,
    tf: payload.tf,
    event: payload.event,
    side: payload.side,
    qtyPct: payload.qty_pct,
    qtyRequestedPct: coalesceDefined(payload.qty_requested_pct, authorityTrace.qty_requested_pct),
    qtyAfterOpenclawPct: coalesceDefined(payload.qty_after_openclaw_pct, authorityTrace.qty_after_openclaw_pct),
    qtyFinalPct: coalesceDefined(payload.qty_final_pct, authorityTrace.qty_final_pct),
    requiredQtyPct: coalesceDefined(payload.entry_budget_required_qty_pct, authorityTrace.entry_budget_required_qty_pct),
    floorApplied: coalesceDefined(payload.entry_budget_floor_applied, authorityTrace.entry_budget_floor_applied) === true,
    floorQtyPct: coalesceDefined(payload.entry_budget_floor_qty_pct, authorityTrace.entry_budget_floor_qty_pct),
    reason: payload.reason,
    dropReasonCode: payload.drop_reason_code,
    signalId: payload.signal_id,
    executionMode: payload.execution_mode,
    source: payload.source || "SERVER",
    authoritative: true,
    dropGroup: payload.event_group || bucket.group,
    dropSubtype: payload.event_subtype || bucket.subtype,
    riskGovernor: riskGovernor && riskGovernor.present === true ? riskGovernor : null,
  };
}

function deriveReasonFamily(codeOrReason = null) {
  const s = upper(codeOrReason);
  if (!s) return "UNKNOWN";
  if (s === "MIN_ORDER_EXCEEDS_BUDGET") return "ENTRY_BUDGET_GUARD";
  if (s.startsWith("TP1_FAIL_CLOSED_")) return "TP1_FAIL_CLOSED";
  if (s.startsWith("OPENCLAW_EXECUTOR_")) return "OPENCLAW_EXECUTOR";
  if (s.startsWith("LIVE_POLICY_")) return "LIVE_EXEC_POLICY";
  if (s.startsWith("LIVE_RESCUE_ADD_")) return "LIVE_RESCUE_ADD";
  if (s.startsWith("LINEAGE_SLO_")) return "LINEAGE_SLO";
  if (s.includes("EV_POLICY")) return "EV_POLICY";
  if (s.includes("COOLDOWN")) return "COOLDOWN_POLICY";
  if (s.includes("STRATEGY")) return "STRATEGY_GATE";
  if (s.includes("EXECUTION_QUALITY")) return "EXECUTION_QUALITY";
  if (s.includes("TF_")) return "TF_GATE";
  if (s.includes("WEBHOOK")) return "WEBHOOK_INGRESS";
  const parts = s.split("_").filter(Boolean).slice(0, 2);
  return parts.length ? parts.join("_") : "UNKNOWN";
}

function isLineageFillIntentReason(value) {
  return upper(value) === "LINEAGE_SLO_FILL_INTENT_NULL_RATE";
}

function isTp1FailClosedQuarantineTrace(trace = null) {
  const src = trace && typeof trace === "object" ? trace : {};
  const policyReason = upper(src._live_exec_policy_reason);
  const quarantineReason = upper(src._live_exec_policy_quarantine_reason);
  const quarantineSource = upper(src._live_exec_policy_quarantine_source);
  return (
    policyReason === "TP1_FAIL_CLOSED_REPEAT_QUARANTINE"
    || quarantineSource === "TP1_FAIL_CLOSED"
    || quarantineReason === "REPEATED_TP1_FAIL_CLOSED_ESCALATED"
    || quarantineReason === "TP1_FAIL_CLOSED_REPEAT_QUARANTINE"
  );
}

function deriveEffectiveDropReason({ resolvedReason = null, liveExecPolicyTrace = null } = {}) {
  const trace = liveExecPolicyTrace && typeof liveExecPolicyTrace === "object" ? liveExecPolicyTrace : {};
  const rawReason = upper(resolvedReason);
  if (!isLineageFillIntentReason(rawReason)) return rawReason || null;

  const hasEntryMetric = trace._live_exec_policy_lineage_has_entry_fill_intent_metric === true;
  const entryFillIntentNullRate = Number(trace._live_exec_policy_lineage_entry_fills_intent_id_null_rate);
  const lineageReasonSuppressed = trace._live_exec_policy_lineage_reason_suppressed === true;

  if (
    lineageReasonSuppressed
    || !hasEntryMetric
    || !Number.isFinite(entryFillIntentNullRate)
    || entryFillIntentNullRate <= 0
  ) {
    const policyReason = upper(trace._live_exec_policy_reason);
    if (policyReason && policyReason !== rawReason && policyReason !== "LIVE_POLICY_OK") {
      return policyReason;
    }
    if (upper(trace._live_exec_policy_action) === "QUARANTINE") {
      if (isTp1FailClosedQuarantineTrace(trace)) {
        return "TP1_FAIL_CLOSED_REPEAT_QUARANTINE";
      }
      return "LIVE_POLICY_QUARANTINE_HARD_BLOCK";
    }
    if (upper(trace._live_exec_policy_plan_mode) === "WATCH_ONLY") {
      return "LIVE_POLICY_PLAN_WATCH_ONLY_BLOCK";
    }
    return "LIVE_POLICY_BLOCK";
  }

  return rawReason;
}

function dropId({ exchange, symbol, tf, barCloseMs, event, side, group, subtype }) {
  return [
    "DROP",
    String(exchange || ""),
    String(symbol || ""),
    String(tf || ""),
    String(barCloseMs || ""),
    String(event || ""),
    String(side || ""),
    String(group || ""),
    String(subtype || ""),
  ].join("__");
}

function deriveCanonicalEventId({ exchange, symbol, tf, barCloseMs, event, side } = {}) {
  return [
    "EVENT",
    String(exchange || "").trim().toUpperCase(),
    String(symbol || "").trim().toUpperCase(),
    String(tf || "").trim(),
    String(barCloseMs || "").trim(),
    String(event || "").trim().toUpperCase(),
    String(side || "").trim().toUpperCase(),
  ].join("__");
}

function pickDropStrategyId(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  const features = payload.features_json && typeof payload.features_json === "object"
    ? payload.features_json
    : {};
  const strategyId = String(
    payload.strategy_id
    || features.strategy_id
    || ""
  ).trim();
  return strategyId || null;
}

function boolLike(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return ["1", "true", "yes", "y", "on"].includes(text);
}

function isV2DiscoveryCanaryBridgePayload(payload = null) {
  if (!payload || typeof payload !== "object") return false;
  const features = resolveFeatureBag(payload);
  const bridge = payload.bridge && typeof payload.bridge === "object" ? payload.bridge : {};
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  return (
    boolLike(payload.discovery_canary_bridge)
    || boolLike(payload.discovery_canary_enabled)
    || boolLike(payload.v2_discovery_canary_enabled)
    || boolLike(payload.v2_discovery_signal_fan_in_handoff)
    || boolLike(payload.v2_discovery_legacy_entry_filters_bypassed)
    || boolLike(bridge.discovery_canary_enabled)
    || boolLike(bridge.discovery_canary_bridge)
    || boolLike(meta.discovery_canary_enabled)
    || boolLike(meta.discovery_canary_bridge)
    || boolLike(features.discovery_canary_bridge)
    || boolLike(features.discovery_canary_enabled)
    || boolLike(features.v2_discovery_canary_enabled)
    || boolLike(features.v2_discovery_signal_fan_in_handoff)
    || boolLike(features.v2_discovery_legacy_entry_filters_bypassed)
    || upper(features.v2_discovery_entry_filter_authority) === "PRODUCTION_ENTRY_ROUTE"
  );
}

function shouldShadowSelfEvolutionCanaryFromDrop(payload = null) {
  if (!payload || typeof payload !== "object") return false;
  const executionMode = normalizeExecutionMode(payload.execution_mode);
  if (executionMode !== "LIVE") return false;
  if (!String(payload.signal_id || "").trim()) return false;
  if (!pickDropStrategyId(payload)) return false;
  return isV2DiscoveryCanaryBridgePayload(payload);
}

function shouldConfirmSelfEvolutionFromDrop(payload = null) {
  if (!payload || typeof payload !== "object") return false;
  const executionMode = normalizeExecutionMode(payload.execution_mode);
  if (executionMode !== "LIVE") return false;
  if (!String(payload.signal_id || "").trim()) return false;
  if (!pickDropStrategyId(payload)) return false;
  if (isV2DiscoveryCanaryBridgePayload(payload)) return false;
  return true;
}

function buildCanaryEvolutionShadowDoc({
  payload,
  exchange,
  symbol,
  tf,
  requestId = null,
  runId = null,
  createdAt = null,
} = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const signalId = String(source.signal_id || "").trim();
  const strategyId = pickDropStrategyId(source);
  const at = createdAt || nowIso();
  const shadowId = [
    "CANARY_EVOLUTION_SHADOW",
    signalId || source.drop_id || "",
    strategyId || "",
    hash10(JSON.stringify({
      reason: source.reason || source.drop_reason_code || source.decision_reason || null,
      event: source.event || null,
      side: source.side || null,
      bar_close_time_utc_ms: source.bar_close_time_utc_ms || null,
    })),
  ].join("__");
  return Object.freeze({
    canary_evolution_shadow_id: shadowId,
    shadow_type: "V2_DISCOVERY_CANARY_SELF_EVOLUTION_SHADOW",
    collection_reason: "DISCOVERY_CANARY_EXCLUDED_FROM_FORMAL_SELF_EVOLUTION",
    signal_id: signalId || null,
    strategy_id: strategyId || null,
    exchange: String(source.exchange || exchange || "").trim().toUpperCase() || null,
    symbol_or_pair_id: String(source.symbol_or_pair_id || symbol || "").trim() || null,
    tf: String(source.tf || tf || "").trim() || null,
    bar_close_time_utc_ms: Number.isFinite(Number(source.bar_close_time_utc_ms))
      ? Number(source.bar_close_time_utc_ms)
      : null,
    event: source.event || null,
    side: source.side || null,
    reason: source.reason || source.drop_reason_code || source.decision_reason || null,
    execution_mode: normalizeExecutionMode(source.execution_mode),
    request_id: source.request_id || requestId || null,
    run_id: source.run_id || runId || null,
    source_collection: "signals_dropped",
    source_drop_id: source.drop_id || null,
    bridge_discovery_canary_enabled: true,
    formal_self_evolution_confirmed: false,
    original_drop: source,
    created_at: at,
    updated_at: at,
  });
}

async function persistCanaryEvolutionShadowDrops({
  db,
  payloads = [],
  exchange,
  symbol,
  tf,
  requestId = null,
  runId = null,
  createdAt = null,
} = {}) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return Object.freeze({ ok: true, written: 0, failed: 0, docs: [] });
  }
  if (boolLike(process.env.DONBEOLJA_V2_CANARY_EVOLUTION_SHADOW_ENABLED ?? "1") !== true) {
    return Object.freeze({ ok: true, written: 0, failed: 0, skipped: true, docs: [] });
  }
  const firestore = db || getFirestore();
  const docs = payloads.map((payload) => buildCanaryEvolutionShadowDoc({
    payload,
    exchange,
    symbol,
    tf,
    requestId,
    runId,
    createdAt,
  }));
  const writes = docs.map((doc) =>
    firestore.collection("v2__signals_canary_evolution_shadow")
      .doc(doc.canary_evolution_shadow_id)
      .set(doc, { merge: true })
  );
  const settled = await Promise.allSettled(writes);
  const failed = settled.filter((row) => row.status === "rejected").length;
  return Object.freeze({
    ok: failed === 0,
    written: settled.length - failed,
    failed,
    docs,
  });
}

function inferDropStageBucketFromReason(reasonRaw = null) {
  const reason = upper(reasonRaw);
  if (!reason) return { group: null, subtype: null };
  if (reason === "MIN_ORDER_EXCEEDS_BUDGET") {
    return { group: "ENTRY", subtype: "MIN_ORDER_BUDGET" };
  }
  if (reason.startsWith("TP1_FAIL_CLOSED_")) {
    return { group: "ENTRY", subtype: "TP1_FAIL_CLOSED_QUARANTINE" };
  }
  if (reason.startsWith("OPENCLAW_EXECUTOR_")) {
    if (reason.startsWith("OPENCLAW_EXECUTOR_ALPHA_CONTEXT_")) {
      return { group: "ENTRY", subtype: "OPENCLAW_ALPHA_CONTEXT" };
    }
    if (reason.startsWith("OPENCLAW_EXECUTOR_ALLOCATOR_")) {
      return { group: "ENTRY", subtype: "OPENCLAW_ALLOCATOR" };
    }
    if (reason.startsWith("OPENCLAW_EXECUTOR_CORRELATED_")) {
      return { group: "ENTRY", subtype: "OPENCLAW_CORRELATED_RISK" };
    }
    if (reason.startsWith("OPENCLAW_EXECUTOR_SAME_SIDE_")) {
      return { group: "ENTRY", subtype: "OPENCLAW_SAME_SIDE_RISK" };
    }
    if (reason === "OPENCLAW_EXECUTOR_FAIL_CLOSED" || reason === "OPENCLAW_EXECUTOR_FAIL_OPEN") {
      return { group: "ENTRY", subtype: "OPENCLAW_EXECUTOR_FAULT" };
    }
    return { group: "ENTRY", subtype: "OPENCLAW_EXECUTOR" };
  }
  if (reason.startsWith("LIVE_POLICY_")) {
    if (reason.includes("QUARANTINE")) return { group: "ENTRY", subtype: "LIVE_POLICY_QUARANTINE" };
    if (reason.includes("EXECUTION_QUALITY")) return { group: "ENTRY", subtype: "LIVE_POLICY_EXECUTION_QUALITY" };
    return { group: "ENTRY", subtype: "LIVE_POLICY" };
  }
  if (reason.startsWith("LIVE_RESCUE_ADD_")) {
    return { group: "ADD", subtype: "LIVE_RESCUE" };
  }
  if (reason.startsWith("DROP_OPPOSITE_") || reason.startsWith("DROP_SAME_DIRECTION_")) {
    return { group: "ENTRY", subtype: "COOLDOWN" };
  }
  return { group: null, subtype: null };
}

function resolveDropStageBucket(payload = null) {
  const p = payload && typeof payload === "object" ? payload : {};
  const features = resolveFeatureBag(p);
  const explicitGroup = upper(
    p.event_group
    || p.group
    || features.event_group
    || features.signal_group
    || features._event_group
    || null
  );
  const explicitSubtype = upper(
    p.event_subtype
    || p.subtype
    || features.event_subtype
    || features.signal_subtype
    || features._event_subtype
    || null
  );
  const inferred = inferDropStageBucketFromReason(
    p.decision_reason
    || p.reason
    || p.drop_reason_code
    || null
  );
  const group = explicitGroup || inferred.group || "UNKNOWN";
  const subtype = explicitSubtype || inferred.subtype || null;
  return { group, subtype };
}

function resolveSignalIdFromDrop(drop = null) {
  const payload = drop && typeof drop === "object" ? drop : {};
  return String(
    payload.signal_id
    || (payload.features_json && payload.features_json.signal_id)
    || (payload.features && payload.features.signal_id)
    || ""
  ).trim() || null;
}

function buildDropBatchDedupeKey({ drop = null, exchange, symbol, tf, decisionReason = null } = {}) {
  const d = drop && typeof drop === "object" ? drop : {};
  const signalId = resolveSignalIdFromDrop(d);
  const reason = upper(d.decision_reason || decisionReason || d.reason || d.drop_reason_code || null);
  return [
    String(exchange || d.exchange || "").trim().toUpperCase(),
    String(symbol || d.symbol_or_pair_id || d.symbol || "").trim().toUpperCase(),
    String(tf || d.tf || "").trim(),
    String(d.bar_close_time_utc_ms || ""),
    String(d.event || "").trim().toUpperCase(),
    String(d.side || "").trim().toUpperCase(),
    signalId || "",
    reason || "",
  ].join("__");
}

function dedupeDropsForBatch({ drops = [], exchange, symbol, tf, decisionReason = null } = {}) {
  if (!Array.isArray(drops) || drops.length <= 1) return Array.isArray(drops) ? drops : [];
  const seen = new Set();
  const out = [];
  for (const drop of drops) {
    const key = buildDropBatchDedupeKey({ drop, exchange, symbol, tf, decisionReason });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(drop);
  }
  return out;
}

function isSignalDropAlreadyHandled(lock = null) {
  const reason = String(lock && lock.reason || "").trim().toUpperCase();
  return reason === "ALREADY_CONSUMED" || reason === "LOCKED";
}

async function filterDropsForConsumedSignals({ drops = [], runId = null, tryLockSignalFn = tryLockSignal } = {}) {
  if (!Array.isArray(drops) || drops.length === 0) {
    return Object.freeze({ kept: [], suppressed: [] });
  }
  const kept = [];
  const suppressed = [];
  for (const drop of drops) {
    const signalId = resolveSignalIdFromDrop(drop);
    if (!signalId) {
      kept.push(drop);
      continue;
    }
    try {
      const lock = await tryLockSignalFn({ signalId, runId });
      if (lock && lock.ok === true) {
        kept.push(drop);
        continue;
      }
      if (isSignalDropAlreadyHandled(lock)) {
        const reason = String(lock && lock.reason || "").trim().toUpperCase() || "ALREADY_HANDLED";
        console.warn(`[SIGNAL_DROP_SUPPRESSED_ALREADY_CONSUMED] signal_id=${signalId} reason=${reason}`);
        suppressed.push({ signal_id: signalId, reason, drop });
        continue;
      }
      kept.push(drop);
    } catch (error) {
      console.warn(`[SIGNAL_DROP_SUPPRESS_CHECK_FAILED] signal_id=${signalId} error=${error && error.message ? error.message : String(error)}`);
      kept.push(drop);
    }
  }
  return Object.freeze({ kept, suppressed });
}

function buildSuppressedSignalDropDoc({
  suppressed,
  exchange,
  symbol,
  tf,
  requestId = null,
  runId = null,
  createdAt = null,
} = {}) {
  const row = suppressed && typeof suppressed === "object" ? suppressed : {};
  const drop = row.drop && typeof row.drop === "object" ? row.drop : {};
  const signalId = resolveSignalIdFromDrop(drop) || trimString(row.signal_id);
  const barCloseMs = drop.bar_close_time_utc_ms == null ? null : Number(drop.bar_close_time_utc_ms);
  const event = drop.event || null;
  const side = drop.side || null;
  const reason = upper(row.reason) || "ALREADY_HANDLED";
  const at = createdAt || nowIso();
  const docId = [
    "SUPPRESSED_DROP",
    String(exchange || "").trim().toUpperCase(),
    String(symbol || "").trim().toUpperCase(),
    String(tf || "").trim(),
    String(barCloseMs || ""),
    String(event || "").trim().toUpperCase(),
    String(side || "").trim().toUpperCase(),
    hash10(`${signalId || ""}__${reason}__${JSON.stringify(drop)}`),
  ].join("__");
  return Object.freeze({
    suppressed_drop_id: docId,
    signal_id: signalId || null,
    exchange: String(exchange || "").trim().toUpperCase() || null,
    symbol_or_pair_id: String(symbol || "").trim() || null,
    tf: String(tf || "").trim() || null,
    bar_close_time_utc_ms: Number.isFinite(barCloseMs) ? barCloseMs : null,
    event,
    side,
    suppress_reason: reason,
    request_id: drop.request_id || requestId || null,
    run_id: drop.run_id || runId || null,
    original_drop: drop,
    alert_suppressed: true,
    collection_reason: "SIGNAL_CONSUME_LOCK_SUPPRESSED_DROP",
    created_at: at,
    updated_at: at,
  });
}

async function persistSuppressedSignalDrops({
  db,
  suppressed = [],
  exchange,
  symbol,
  tf,
  requestId = null,
  runId = null,
  createdAt = null,
} = {}) {
  if (!Array.isArray(suppressed) || suppressed.length === 0) {
    return Object.freeze({ ok: true, written: 0, failed: 0 });
  }
  const firestore = db || getFirestore();
  const docs = suppressed.map((row) => buildSuppressedSignalDropDoc({
    suppressed: row,
    exchange,
    symbol,
    tf,
    requestId,
    runId,
    createdAt,
  }));
  const writes = docs.map((doc) =>
    firestore.collection("v2__signals_dropped_suppressed")
      .doc(doc.suppressed_drop_id)
      .set(doc, { merge: true })
  );
  const settled = await Promise.allSettled(writes);
  const failed = settled.filter((row) => row.status === "rejected").length;
  return Object.freeze({
    ok: failed === 0,
    written: settled.length - failed,
    failed,
    docs,
  });
}

function trimString(value) {
  const text = String(value || "").trim();
  return text || null;
}

async function recordSignalDrops({
  exchange,
  symbol,
  tf,
  drops = [],
  requestId = null,
  runId = null,
  decisionReason = null,
  db: injectedDb = null,
  tryLockSignalFn = tryLockSignal,
  markSignalConsumedFn = markSignalConsumed,
  sendSignalDroppedAlertFn = sendSignalDroppedAlert,
} = {}) {
  if (!Array.isArray(drops) || drops.length === 0) return { ok: true, written: 0 };
  const filtered = await filterDropsForConsumedSignals({ drops, runId, tryLockSignalFn });
  const effectiveDrops = dedupeDropsForBatch({
    drops: filtered.kept,
    exchange,
    symbol,
    tf,
    decisionReason,
  });
  const db = injectedDb || getFirestore();
  const now = nowIso();
  const suppressedCommit = await persistSuppressedSignalDrops({
    db,
    suppressed: filtered.suppressed,
    exchange,
    symbol,
    tf,
    requestId,
    runId,
    createdAt: now,
  });
  if (!effectiveDrops.length) {
    return {
      ok: suppressedCommit.ok === true,
      written: 0,
      suppressed: filtered.suppressed.length,
      suppressed_signal_drops: filtered.suppressed,
      suppressed_commit: suppressedCommit,
    };
  }

  const normalizedDrops = [];
  const writes = effectiveDrops.map((d) => {
    const { group, subtype } = resolveDropStageBucket(d);
    const id = dropId({
      exchange,
      symbol,
      tf,
      barCloseMs: d.bar_close_time_utc_ms,
      event: d.event,
      side: d.side,
      group,
      subtype,
    });
    const inputFeatures = resolveFeatureBag(d);
    const regimeMeta = enrichFeaturesWithRegime(inputFeatures);
    const resolvedSource = upper(
      d.source
      || (d.meta && d.meta.source)
      || (d.features_json && d.features_json.source)
      || (d.features && d.features.source)
      || "SERVER"
    ) || "SERVER";
    let resolvedSignalId = String(
      d.signal_id
      || (d.features_json && d.features_json.signal_id)
      || (d.features && d.features.signal_id)
      || ""
    ).trim() || null;
    const resolvedSignalDocId = String(
      d.signal_doc_id
      || (d.features_json && d.features_json.signal_doc_id)
      || (d.features && d.features.signal_doc_id)
      || deriveSignalDocId({
        exchange,
        symbol,
        tf,
        barCloseMs: d.bar_close_time_utc_ms,
        event: d.event,
        signalId: resolvedSignalId,
      })
      || ""
    ).trim() || null;
    if (!resolvedSignalId && String(resolvedSignalDocId || "").startsWith("SIG__")) {
      resolvedSignalId = resolvedSignalDocId;
    }
    const effectiveFeatures = regimeMeta.features && typeof regimeMeta.features === "object"
      ? regimeMeta.features
      : inputFeatures;
    const liveExecPolicyTrace = extractLiveExecutionPolicyTrace(effectiveFeatures);
    const openclawAuthorityTrace = extractOpenClawAuthorityTrace(effectiveFeatures);
    const rawResolvedReason = d.decision_reason || decisionReason || d.reason || d.drop_reason_code || null;
    const resolvedReason = deriveEffectiveDropReason({
      resolvedReason: rawResolvedReason,
      liveExecPolicyTrace,
    });
    const resolvedReasonFamily = deriveReasonFamily(d.reason_family || d.drop_reason_code || resolvedReason);
    const canonicalEventId = String(
      d.canonical_event_id
      || deriveCanonicalEventId({ exchange, symbol, tf, barCloseMs: d.bar_close_time_utc_ms, event: d.event, side: d.side })
      || ""
    ).trim() || null;

    const payload = {
      drop_id: id,
      ...buildEventEnvelope({
        requestId: d.request_id || requestId || null,
        runId: d.run_id || runId || (d.features_json && d.features_json.run_id) || (d.features && d.features.run_id) || null,
        signalId: resolvedSignalId,
        intentId: d.intent_id || null,
        event: d.event || null,
        exchange,
        symbol,
        tf,
        decisionReason: resolvedReason,
        action: d.event_intent || null,
        intent: d.event_intent || null,
        executionMode: d.execution_mode
          || (d.meta && d.meta.execution_mode)
          || inputFeatures.execution_mode
          || null,
        source: resolvedSource,
        reasonFamily: resolvedReasonFamily,
        authority: "SERVER",
        barCloseMs: d.bar_close_time_utc_ms,
        createdAt: now,
      }),
      exchange: String(exchange || "").toUpperCase(),
      symbol_or_pair_id: String(symbol || ""),
      tf: String(tf || ""),
      bar_close_time_utc_ms: Number(d.bar_close_time_utc_ms || 0) || null,
      event: d.event || null,
      side: d.side || null,
      qty_pct: Number.isFinite(Number(d.qty_pct)) ? Number(d.qty_pct) : null,
      reason: resolvedReason || d.reason || "DROP_FILTER",
      decision_reason: resolvedReason,
      reason_family: resolvedReasonFamily,
      features_json: effectiveFeatures,
      execution_mode: normalizeExecutionMode(
        d.execution_mode ||
        (d.meta && d.meta.execution_mode) ||
        inputFeatures.execution_mode
      ),
      request_id: d.request_id || requestId || null,
      run_id: d.run_id || runId || (d.features_json && d.features_json.run_id) || (d.features && d.features.run_id) || null,
      event_group: group,
      event_subtype: subtype,
      drop_key: d.drop_key || null,
      drop_reason_code: resolvedReason || d.drop_reason_code || null,
      drop_reason_code_raw: d.drop_reason_code || null,
      decision_reason_raw: rawResolvedReason,
      signal_id: resolvedSignalId || null,
      signal_doc_id: resolvedSignalDocId || null,
      canonical_event_id: canonicalEventId,
      event_intent: d.event_intent || null,
      mapping_ok: d.mapping_ok === true,
      mapping_version: d.mapping_version || null,
      source: resolvedSource,
      source_authority: "SERVER",
      regime: regimeMeta.regime,
      market_regime: regimeMeta.market_regime,
      regime_source: regimeMeta.regime_source,
      ...toLiveExecutionPolicyTopLevel(liveExecPolicyTrace),
      ...openclawAuthorityTrace,
      created_at: now,
      updated_at: now,
    };
    normalizedDrops.push(payload);
    return db.collection("signals_dropped").doc(id).set(payload, { merge: true });
  });

  await Promise.allSettled(writes);
  const canaryEvolutionShadowPayloads = normalizedDrops
    .filter((payload) => shouldShadowSelfEvolutionCanaryFromDrop(payload));
  const canaryEvolutionShadowCommit = await persistCanaryEvolutionShadowDrops({
    db,
    payloads: canaryEvolutionShadowPayloads,
    exchange,
    symbol,
    tf,
    requestId,
    runId,
    createdAt: now,
  });
  const confirmations = normalizedDrops
    .filter((payload) => shouldConfirmSelfEvolutionFromDrop(payload))
    .map((payload) =>
      confirmSelfEvolutionRuntimeSignal({
        signalId: payload.signal_id || null,
        createdAt: payload.created_at || now,
        event: payload.event || null,
        strategyId: pickDropStrategyId(payload),
        updatedBy: "webhook_drop_signal_confirm",
      })
    );
  if (confirmations.length) {
    await Promise.allSettled(confirmations);
  }
  const consumeResults = normalizedDrops
    .filter((payload) => payload.signal_id)
    .map((payload) =>
      markSignalConsumedFn({
        signalId: payload.signal_id,
        runId: payload.run_id || runId,
        consumedAtIso: now,
        execBarCloseMs: payload.bar_close_time_utc_ms,
        execBarCloseUtc: Number.isFinite(Number(payload.bar_close_time_utc_ms))
          ? new Date(Number(payload.bar_close_time_utc_ms)).toISOString()
          : null,
        reason: payload.drop_reason_code || payload.reason || "DROP",
        meta: {
          drop_id: payload.drop_id || null,
          canonical_event_id: payload.canonical_event_id || null,
          source: "signals_dropped",
        },
      }).catch((error) => ({
        ok: false,
        reason: "MARK_SIGNAL_CONSUMED_FAILED",
        error_message: error && error.message ? String(error.message) : String(error),
        signal_id: payload.signal_id,
      }))
    );
  const consumedSettled = consumeResults.length ? await Promise.allSettled(consumeResults) : [];
  const alerts = normalizedDrops.map((d) => sendSignalDroppedAlertFn(buildDropAlertPayload(d)));
  await Promise.allSettled(alerts);
  return {
    ok: true,
    written: writes.length,
    suppressed: filtered.suppressed.length,
    suppressed_signal_drops: filtered.suppressed,
    suppressed_commit: suppressedCommit,
    canary_evolution_shadow_n: canaryEvolutionShadowCommit.written || 0,
    canary_evolution_shadow_commit: canaryEvolutionShadowCommit,
    self_evolution_runtime_confirmed_n: confirmations.length,
    consumed_before_alert_n: consumedSettled.filter((row) => row.status === "fulfilled").length,
  };
}

module.exports = {
  recordSignalDrops,
  __test: {
    pickDropStrategyId,
    boolLike,
    isV2DiscoveryCanaryBridgePayload,
    shouldShadowSelfEvolutionCanaryFromDrop,
    shouldConfirmSelfEvolutionFromDrop,
    buildCanaryEvolutionShadowDoc,
    persistCanaryEvolutionShadowDrops,
    resolveDropStageBucket,
    inferDropStageBucketFromReason,
    deriveReasonFamily,
    deriveCanonicalEventId,
    deriveEffectiveDropReason,
    extractOpenClawAuthorityTrace,
    extractRiskGovernorSurface,
    buildDropAlertPayload,
    resolveSignalIdFromDrop,
    isSignalDropAlreadyHandled,
    filterDropsForConsumedSignals,
    buildSuppressedSignalDropDoc,
    persistSuppressedSignalDrops,
    buildDropBatchDedupeKey,
    dedupeDropsForBatch,
  },
};
