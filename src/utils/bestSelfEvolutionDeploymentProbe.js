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
  return JSON.stringify(sortObject(value));
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

function findLatestCreatedMs(docs = []) {
  let latest = null;
  for (const row of Array.isArray(docs) ? docs : []) {
    const createdMs = parseIsoMs(row && row.created_at);
    if (createdMs == null) continue;
    if (latest == null || createdMs > latest) latest = createdMs;
  }
  return latest;
}

function deriveDeploymentProbe({
  manualPasteAck = null,
  systemSettings = null,
  signalsCache = null,
  dropsCache = null,
  postApplyProbe = null,
  provider = "BINANCEFUT",
  nowMs = Date.now(),
  flowMaxAgeMinutes = 360,
} = {}) {
  const ack = manualPasteAck && typeof manualPasteAck === "object" ? manualPasteAck : {};
  const acknowledged = ack.acknowledged === true;
  const appliedStrategyId = pickString(ack.applied_strategy_id);
  const policy = derivePolicyBundle(systemSettings);
  const latestSignalsMs = findLatestCreatedMs(signalsCache && signalsCache.docs);
  const latestDropsMs = findLatestCreatedMs(dropsCache && dropsCache.docs);
  const latestProbeMs = parseIsoMs(postApplyProbe && postApplyProbe.generated_at_iso);
  const latestFlowMs = [latestSignalsMs, latestDropsMs, latestProbeMs]
    .filter((value) => value != null)
    .sort((a, b) => b - a)[0] || null;
  const flowMaxAgeMs = Math.max(15, Number(flowMaxAgeMinutes || 360)) * 60 * 1000;
  const marketDataFlowOk = latestFlowMs != null ? (nowMs - latestFlowMs) <= flowMaxAgeMs : false;
  const engineBundleLoaded = Boolean(
    acknowledged
    && appliedStrategyId
    && ack.canonical_source_synced !== false
  );
  const featureSnapshotReady = Boolean(engineBundleLoaded && policy.loaded && marketDataFlowOk);
  const canonicalDecisionReady = featureSnapshotReady;
  const probePass = Boolean(featureSnapshotReady && canonicalDecisionReady);
  let probeStatus = "N/A";
  let probeReason = "NO_ACKNOWLEDGEMENT";
  if (acknowledged) {
    if (!engineBundleLoaded) {
      probeStatus = "PENDING";
      probeReason = "PENDING_ENGINE_BUNDLE_LOAD";
    } else if (!policy.loaded) {
      probeStatus = "PENDING";
      probeReason = "PENDING_POLICY_BUNDLE_LOAD";
    } else if (!marketDataFlowOk) {
      probeStatus = "PENDING";
      probeReason = "PENDING_MARKET_DATA_FLOW";
    } else {
      probeStatus = "PASS";
      probeReason = "PROBE_PASS";
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
      policy_bundle_loaded: policy.loaded,
      threshold_bundle_signature: policy.threshold_bundle_signature,
      source_mode_signature: policy.source_mode_signature,
      latest_market_data_at_iso: latestFlowMs != null ? new Date(latestFlowMs).toISOString() : null,
      latest_market_data_at_kst: latestFlowMs != null ? toKstString(new Date(latestFlowMs).toISOString()) : null,
      market_data_flow_ok: marketDataFlowOk,
      feature_snapshot_ready: featureSnapshotReady,
      canonical_decision_ready: canonicalDecisionReady,
      probe_pass: probePass,
      probe_status: probeStatus,
      probe_reason: probeReason,
      signal_cache_n: Array.isArray(signalsCache && signalsCache.docs) ? signalsCache.docs.length : 0,
      drop_cache_n: Array.isArray(dropsCache && dropsCache.docs) ? dropsCache.docs.length : 0,
    },
  };
}

module.exports = {
  deriveDeploymentProbe,
  __test: {
    derivePolicyBundle,
    deriveDeploymentProbe,
    parseIsoMs,
    stableSignature,
  },
};
