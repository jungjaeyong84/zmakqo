"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function toKstString(iso = null) {
  const date = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortObject(value[key]);
  return out;
}

function stableSignature(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return String(value);
  const sorted = sortObject(value);
  return JSON.stringify(sorted);
}

function extractStrategyId(row = null) {
  const features = parseJsonObject(row && row.features_json);
  return pickString(
    row && (row.strategy_id || row.strategyId)
    || (features && (features.strategy_id || features.strategyId || features._strategy_id_received))
  );
}

function extractEvent(row = null) {
  const features = parseJsonObject(row && row.features_json);
  return pickString(row && (row.event || row.signal_event) || (features && features.event));
}

function extractCreatedAt(row = null) {
  return pickString(row && row.created_at);
}

function deriveMatchingDecision(docs = [], { strategyId = null, ackMs = null, kind = "SIGNAL" } = {}) {
  const appliedStrategyId = pickString(strategyId);
  if (!appliedStrategyId) return null;
  const rows = Array.isArray(docs) ? docs : [];
  let earliest = null;
  for (const row of rows) {
    const rowStrategyId = extractStrategyId(row);
    if (!rowStrategyId || rowStrategyId !== appliedStrategyId) continue;
    const createdAt = extractCreatedAt(row);
    const createdMs = parseIsoMs(createdAt);
    if (ackMs != null && createdMs != null && createdMs < ackMs) continue;
    const candidate = {
      kind,
      signal_id: pickString(row && (row.signal_id || row.id || row.doc_id)),
      created_at: createdAt,
      created_ms: createdMs,
      event: extractEvent(row),
      strategy_id: rowStrategyId,
      symbol: pickString(row && (row.symbol || row.symbol_or_pair_id || row.pair_id)),
      reason: pickString(row && row.reason),
    };
    if (!earliest) {
      earliest = candidate;
      continue;
    }
    const earliestMs = earliest.created_ms;
    if (createdMs != null && earliestMs != null && createdMs < earliestMs) earliest = candidate;
    else if (createdMs != null && earliestMs == null) earliest = candidate;
  }
  return earliest;
}

function findLatestCreatedMs(docs = []) {
  let latest = null;
  for (const row of Array.isArray(docs) ? docs : []) {
    const createdMs = parseIsoMs(extractCreatedAt(row));
    if (createdMs == null) continue;
    if (latest == null || createdMs > latest) latest = createdMs;
  }
  return latest;
}

function derivePolicyBundle(systemSettings = null) {
  const sys = systemSettings && typeof systemSettings === "object" ? systemSettings : {};
  const marketOverrides = sys.canonical_engine_market_overrides && typeof sys.canonical_engine_market_overrides === "object"
    ? sys.canonical_engine_market_overrides
    : {};
  const thresholdBundle = {
    canonical_engine_core_score_abs: toNum(sys.canonical_engine_core_score_abs),
    canonical_engine_transition_core_score_abs: toNum(sys.canonical_engine_transition_core_score_abs),
    canonical_engine_market_overrides: marketOverrides,
  };
  const sourceModeBundle = {
    canonical_engine_source_mode: pickString(sys.canonical_engine_source_mode),
    canonical_engine_market_overrides: Object.fromEntries(
      Object.entries(marketOverrides).map(([market, row]) => [
        market,
        row && typeof row === "object" ? { source_mode: pickString(row.source_mode) } : {},
      ])
    ),
  };
  return {
    threshold_bundle_signature: stableSignature(thresholdBundle),
    source_mode_signature: stableSignature(sourceModeBundle),
    policy_bundle_id: stableSignature({
      threshold_bundle_signature: stableSignature(thresholdBundle),
      source_mode_signature: stableSignature(sourceModeBundle),
    }),
    loaded: Boolean(
      pickString(sys.canonical_engine_source_mode)
      && (toNum(sys.canonical_engine_core_score_abs) != null)
      && (toNum(sys.canonical_engine_transition_core_score_abs) != null)
    ),
  };
}

function deriveBundleActivation({
  manualPasteAck = null,
  systemSettings = null,
  signalsCache = null,
  dropsCache = null,
  postApplyProbe = null,
  deploymentProbe = null,
  nowMs = Date.now(),
  provider = "BINANCEFUT",
  flowMaxAgeMinutes = 360,
  defaultTimeoutMinutes = 180,
} = {}) {
  const ack = manualPasteAck && typeof manualPasteAck === "object" ? manualPasteAck : {};
  const acknowledged = ack.acknowledged === true;
  const appliedStrategyId = pickString(ack.applied_strategy_id);
  const ackIso = pickString(ack.acknowledged_at_iso);
  const ackMs = parseIsoMs(ackIso);
  const timeoutMinutes = Math.max(
    5,
    Math.round(toNum(ack.confirmation_timeout_minutes) || defaultTimeoutMinutes)
  );
  const deadlineMs = ackMs != null ? (ackMs + (timeoutMinutes * 60 * 1000)) : null;
  const deadlineIso = deadlineMs != null ? new Date(deadlineMs).toISOString() : null;
  const timeoutElapsed = deadlineMs != null ? nowMs >= deadlineMs : false;

  const signalsDocs = Array.isArray(signalsCache && signalsCache.docs) ? signalsCache.docs : [];
  const dropsDocs = Array.isArray(dropsCache && dropsCache.docs) ? dropsCache.docs : [];
  const firstSignal = deriveMatchingDecision(signalsDocs, { strategyId: appliedStrategyId, ackMs, kind: "SIGNAL" });
  const firstDrop = deriveMatchingDecision(dropsDocs, { strategyId: appliedStrategyId, ackMs, kind: "DROP" });
  let firstDecision = null;
  if (firstSignal && firstDrop) {
    if (firstSignal.created_ms != null && firstDrop.created_ms != null) {
      firstDecision = firstSignal.created_ms <= firstDrop.created_ms ? firstSignal : firstDrop;
    } else {
      firstDecision = firstSignal.created_ms != null ? firstSignal : firstDrop;
    }
  } else {
    firstDecision = firstSignal || firstDrop;
  }

  const latestSignalsMs = findLatestCreatedMs(signalsDocs);
  const latestDropsMs = findLatestCreatedMs(dropsDocs);
  const latestProbeMs = parseIsoMs(postApplyProbe && postApplyProbe.generated_at_iso);
  const latestFlowMs = [latestSignalsMs, latestDropsMs, latestProbeMs].filter((v) => v != null).sort((a, b) => b - a)[0] || null;
  const flowMaxAgeMs = Math.max(15, Number(flowMaxAgeMinutes || 360)) * 60 * 1000;
  const fallbackMarketDataFlowOk = latestFlowMs != null ? (nowMs - latestFlowMs) <= flowMaxAgeMs : false;
  const policy = derivePolicyBundle(systemSettings);
  const fallbackEngineBundleLoaded = Boolean(
    acknowledged
    && appliedStrategyId
    && ack.canonical_source_synced !== false
  );
  const probeSummary = deploymentProbe && typeof deploymentProbe === "object"
    ? (deploymentProbe.summary && typeof deploymentProbe.summary === "object" ? deploymentProbe.summary : deploymentProbe)
    : {};
  const engineBundleLoaded = typeof probeSummary.engine_bundle_loaded === "boolean"
    ? probeSummary.engine_bundle_loaded
    : fallbackEngineBundleLoaded;
  const marketDataFlowOk = typeof probeSummary.market_data_flow_ok === "boolean"
    ? probeSummary.market_data_flow_ok
    : fallbackMarketDataFlowOk;
  const policyLoaded = typeof probeSummary.policy_bundle_loaded === "boolean"
    ? probeSummary.policy_bundle_loaded
    : policy.loaded;
  const probePass = typeof probeSummary.probe_pass === "boolean"
    ? probeSummary.probe_pass
    : Boolean(engineBundleLoaded && policyLoaded && marketDataFlowOk);
  const probeStatus = pickString(probeSummary.probe_status);
  const probeReason = pickString(probeSummary.probe_reason);
  const firstDecisionSeen = !!firstDecision;
  const activationConfirmed = Boolean(
    acknowledged
    && engineBundleLoaded
    && policyLoaded
    && (firstDecisionSeen || probePass)
  );
  const activationPending = Boolean(acknowledged && !activationConfirmed && !timeoutElapsed);

  let activationStatus = "N/A";
  let activationReason = "NO_ACKNOWLEDGEMENT";
  if (acknowledged) {
    if (firstDecisionSeen) {
      activationStatus = "ACTIVE";
      activationReason = "ACTIVE_BY_FIRST_DECISION";
    } else if (probePass) {
      activationStatus = "ACTIVE";
      activationReason = "ACTIVE_BY_PROBE";
    } else if (timeoutElapsed) {
      activationStatus = "TIMEOUT";
      activationReason = "DEPLOYMENT_CONFIRM_TIMEOUT";
    } else if (!engineBundleLoaded) {
      activationStatus = "PENDING";
      activationReason = "PENDING_ENGINE_BUNDLE_LOAD";
    } else if (!policyLoaded) {
      activationStatus = "PENDING";
      activationReason = "PENDING_POLICY_BUNDLE_LOAD";
    } else if (!marketDataFlowOk) {
      activationStatus = "PENDING";
      activationReason = "PENDING_MARKET_DATA_FLOW";
    } else {
      activationStatus = "PENDING";
      activationReason = "PENDING_ACTIVATION_PROOF";
    }
  }

  return {
    summary: {
      provider: pickString(provider),
      acknowledged,
      applied_strategy_id: appliedStrategyId,
      engine_bundle_id: appliedStrategyId ? `strategy:${appliedStrategyId}` : null,
      policy_bundle_id: policy.policy_bundle_id,
      engine_bundle_loaded: engineBundleLoaded,
      policy_bundle_loaded: policyLoaded,
      threshold_bundle_signature: policy.threshold_bundle_signature,
      source_mode_signature: policy.source_mode_signature,
      market_data_flow_ok: marketDataFlowOk,
      probe_pass: probePass,
      probe_status: probeStatus || (probePass ? "PASS" : (activationStatus === "TIMEOUT" ? "TIMEOUT" : "PENDING")),
      probe_reason: probeReason || (probePass ? "PROBE_PASS" : null),
      latest_market_data_at_iso: latestFlowMs != null ? new Date(latestFlowMs).toISOString() : null,
      latest_market_data_at_kst: latestFlowMs != null ? toKstString(new Date(latestFlowMs).toISOString()) : null,
      first_decision_seen: firstDecisionSeen,
      first_decision_kind: firstDecision ? firstDecision.kind : null,
      first_decision_id: firstDecision ? firstDecision.signal_id : null,
      first_decision_created_at: firstDecision ? firstDecision.created_at : null,
      first_decision_event: firstDecision ? firstDecision.event : null,
      first_decision_reason: firstDecision ? firstDecision.reason : null,
      first_decision_symbol: firstDecision ? firstDecision.symbol : null,
      confirmation_timeout_minutes: timeoutMinutes,
      confirmation_deadline_iso: deadlineIso,
      confirmation_deadline_kst: deadlineIso ? toKstString(deadlineIso) : null,
      timeout_elapsed: timeoutElapsed,
      confirmation_timed_out: timeoutElapsed && !activationConfirmed,
      activation_confirmed: activationConfirmed,
      activation_pending: activationPending,
      activation_status: activationStatus,
      activation_reason: activationReason,
      signal_match_n: firstSignal ? 1 : 0,
      drop_match_n: firstDrop ? 1 : 0,
      signal_cache_n: signalsDocs.length,
      drop_cache_n: dropsDocs.length,
    },
  };
}

module.exports = {
  deriveBundleActivation,
  __test: {
    parseIsoMs,
    stableSignature,
    derivePolicyBundle,
    deriveMatchingDecision,
    deriveBundleActivation,
  },
};
