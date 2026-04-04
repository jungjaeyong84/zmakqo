"use strict";

const { deriveCanonicalParityDiagnostics } = require("./bestSelfEvolutionAnalysis");

function toNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  const base = (value.raw && typeof value.raw === "object")
    ? value.raw
    : ((value.display && typeof value.display === "object") ? value.display : value);
  if (base.summary && typeof base.summary === "object") return base.summary;
  return base;
}

function readRows(value) {
  if (!value || typeof value !== "object") return [];
  const base = (value.raw && typeof value.raw === "object")
    ? value.raw
    : ((value.display && typeof value.display === "object") ? value.display : value);
  if (Array.isArray(base.rows)) return base.rows;
  return [];
}

function toKstString(ms) {
  const n = toNum(ms);
  if (!Number.isFinite(n)) return null;
  const kst = new Date(n + (9 * 60 * 60 * 1000));
  const pad = (x) => String(x).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())} KST`;
}

function parseDateMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }
  const s = String(value || "").trim();
  if (!s) return null;
  const kstMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*KST$/i);
  if (kstMatch) {
    const [, y, mo, d, h, mi, sec] = kstMatch;
    const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi), Number(sec));
    return Number.isFinite(utcMs) ? utcMs : null;
  }
  const isoMs = Date.parse(s);
  return Number.isFinite(isoMs) ? isoMs : null;
}

function pickGeneratedAtMs(doc = null) {
  if (!doc || typeof doc !== "object") return null;
  const summary = readSummary(doc);
  const candidates = [
    doc.generated_at_ms,
    doc.generated_at,
    doc.generated_at_kst,
    summary.generated_at_ms,
    summary.generated_at,
    summary.generated_at_kst,
  ];
  let maxMs = null;
  for (const value of candidates) {
    const ms = parseDateMs(value);
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(maxMs) || ms > maxMs) maxMs = ms;
  }
  return Number.isFinite(maxMs) ? maxMs : null;
}

function pickCycleId(doc = null) {
  if (!doc || typeof doc !== "object") return null;
  const summary = readSummary(doc);
  const base = (doc.raw && typeof doc.raw === "object")
    ? doc.raw
    : ((doc.display && typeof doc.display === "object") ? doc.display : doc);
  const candidates = [
    base.cycle_id,
    base.source_cycle_id,
    base.generation_id,
    doc.cycle_id,
    doc.source_cycle_id,
    doc.generation_id,
    summary.cycle_id,
    summary.source_cycle_id,
    summary.generation_id,
  ];
  for (const value of candidates) {
    const s = String(value || "").trim();
    if (s) return s;
  }
  return null;
}

function bump(map, key) {
  map.set(key, Number(map.get(key) || 0) + 1);
}

function topRows(map, limit = 5) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, Math.max(0, limit))
    .map(([key, count]) => ({ key, count }));
}

function deriveArtifactCoherence({
  authority = null,
  quality = null,
  parity = null,
  runtime = null,
  evGateRescue = null,
  strategyAlignment = null,
  serverPrimaryCanary = null,
} = {}) {
  const nowMs = Date.now();
  const freshnessSlaMs = Math.max(
    60 * 1000,
    toNum(process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS) || (2 * 60 * 60 * 1000)
  );
  const skewMaxMs = Math.max(
    60 * 1000,
    toNum(process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS) || (45 * 60 * 1000)
  );
  const enforceFreshness = toBool(process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS, true);
  const enforceCycleAlignment = toBool(process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT, true);

  const artifacts = [
    { key: "authority", doc: authority, required: true },
    { key: "quality", doc: quality, required: true },
    { key: "parity", doc: parity, required: true },
    { key: "runtime", doc: runtime, required: true },
    { key: "ev_gate_rescue", doc: evGateRescue, required: false },
    { key: "strategy_alignment", doc: strategyAlignment, required: false },
    { key: "server_primary_canary", doc: serverPrimaryCanary, required: false },
  ];

  const rows = artifacts.map(({ key, doc, required }) => {
    const generatedAtMs = pickGeneratedAtMs(doc);
    const ageMs = Number.isFinite(generatedAtMs) ? Math.max(0, nowMs - generatedAtMs) : null;
    const fresh = Number.isFinite(ageMs) ? ageMs <= freshnessSlaMs : false;
    return {
      key,
      required,
      generated_at_kst: Number.isFinite(generatedAtMs) ? toKstString(generatedAtMs) : null,
      generated_at_ms: Number.isFinite(generatedAtMs) ? generatedAtMs : null,
      age_ms: Number.isFinite(ageMs) ? ageMs : null,
      fresh,
      cycle_id: pickCycleId(doc),
    };
  });

  const requiredRows = rows.filter((row) => row.required);
  const missingGeneratedRequired = requiredRows.filter((row) => !Number.isFinite(row.generated_at_ms));
  const staleRequired = requiredRows.filter((row) => Number.isFinite(row.age_ms) && row.fresh !== true);
  const validGeneratedRows = requiredRows.filter((row) => Number.isFinite(row.generated_at_ms));
  const generatedMsList = validGeneratedRows.map((row) => Number(row.generated_at_ms));
  const minGeneratedMs = generatedMsList.length ? Math.min(...generatedMsList) : null;
  const maxGeneratedMs = generatedMsList.length ? Math.max(...generatedMsList) : null;
  const skewMs = Number.isFinite(minGeneratedMs) && Number.isFinite(maxGeneratedMs)
    ? Math.max(0, maxGeneratedMs - minGeneratedMs)
    : null;
  const skewExceeded = Number.isFinite(skewMs) ? skewMs > skewMaxMs : true;

  const requiredCycleIds = requiredRows.map((row) => String(row.cycle_id || "").trim()).filter(Boolean);
  const cycleUnique = Array.from(new Set(requiredCycleIds));
  const cycleAligned = requiredCycleIds.length > 0 && cycleUnique.length === 1;
  const cycleAlignmentStatus = requiredCycleIds.length <= 0 ? "UNAVAILABLE" : (cycleAligned ? "ALIGNED" : "MIXED");
  const skewBypassedByCycleAlignment = false;
  const skewExceededEffective = skewExceeded;
  const staleRequiredEffective = staleRequired.filter((row) => !(enforceCycleAlignment && cycleAligned && String(row.cycle_id || "").trim()));

  const freshnessReady = missingGeneratedRequired.length === 0
    && staleRequiredEffective.length === 0
    && skewExceededEffective === false;
  const ready = (enforceFreshness ? freshnessReady : true) && (enforceCycleAlignment ? cycleAligned : true);

  const blockers = [
    ...(missingGeneratedRequired.length > 0 ? ["ARTIFACT_GENERATED_AT_MISSING"] : []),
    ...(staleRequiredEffective.length > 0 ? ["ARTIFACT_FRESHNESS_STALE"] : []),
    ...(skewExceededEffective ? ["ARTIFACT_GENERATED_AT_SKEW_EXCEEDED"] : []),
    ...(enforceCycleAlignment && !cycleAligned ? ["ARTIFACT_CYCLE_ALIGNMENT_MISMATCH"] : []),
  ];

  return {
    status: ready ? "READY" : "BLOCKED",
    ready,
    coherence_reason: ready ? "READY" : (blockers[0] || "ARTIFACT_COHERENCE_BLOCKED"),
    blockers,
    freshness_sla_ms: freshnessSlaMs,
    skew_max_ms: skewMaxMs,
    enforce_freshness: enforceFreshness,
    enforce_cycle_alignment: enforceCycleAlignment,
    missing_generated_required_n: missingGeneratedRequired.length,
    stale_required_n: staleRequired.length,
    stale_required_effective_n: staleRequiredEffective.length,
    generated_at_skew_ms: Number.isFinite(skewMs) ? skewMs : null,
    generated_at_skew_exceeded: skewExceeded,
    generated_at_skew_exceeded_effective: skewExceededEffective,
    generated_at_skew_bypassed_by_cycle_alignment: skewBypassedByCycleAlignment,
    cycle_alignment_status: cycleAlignmentStatus,
    cycle_unique_n: cycleUnique.length,
    required_artifact_n: requiredRows.length,
    rows,
  };
}

function deriveServerSignalCutoverReadiness({
  authority = null,
  quality = null,
  parity = null,
  runtime = null,
  evGateRescue = null,
  strategyAlignment = null,
  serverPrimaryCanary = null,
  driftRemediationApply = null,
} = {}) {
  const authoritySummary = readSummary(authority);
  const qualitySummary = readSummary(quality);
  const paritySummary = deriveCanonicalParityDiagnostics(parity);
  const runtimeSummary = readSummary(runtime);
  const evGateRescueSummary = readSummary(evGateRescue);
  const strategyAlignmentData = strategyAlignment && typeof strategyAlignment === "object" ? strategyAlignment : {};
  const canarySummary = readSummary(serverPrimaryCanary);
  const remediationApplySummary = readSummary(driftRemediationApply);
  const parityRows = readRows(parity);

  const driftStatus = toUpper(authoritySummary.drift_status) || "PARITY_UNKNOWN";
  const qualityStatus = toUpper(qualitySummary.quality_status) || "N_A";
  const runtimeStatus = toUpper(runtimeSummary.runtime_status) || "N_A";
  const sourceMode = toUpper(authoritySummary.source_mode || runtimeSummary.canonical_engine_source_mode) || "PINE_PRIMARY";
  const shadowObservedN = toNum(authoritySummary.pine_shadow_24h_n) || 0;
  const mismatchN = toNum(authoritySummary.parity_mismatch_n) || 0;
  const entryN = toNum(qualitySummary.authoritative_entry_signal_24h_n) || 0;
  const intentN = toNum(qualitySummary.order_intent_24h_n) || 0;
  const fillN = toNum(qualitySummary.fill_24h_n) || 0;
  const runtimeTf = String(runtimeSummary.exec_tf || "").trim() || null;
  const marketCount = toNum(runtimeSummary.market_count) || 0;
  const sourceParityMismatchN = toNum(paritySummary.source_parity_mismatch_n) || 0;
  const finalDownstreamMismatchN = toNum(paritySummary.final_downstream_mismatch_n) || 0;
  const evPolicyMismatchN = toNum(paritySummary.ev_policy_mismatch_n) || 0;
  const cooldownPolicyMismatchN = toNum(paritySummary.cooldown_policy_mismatch_n) || 0;
  const strategyGateMismatchN = toNum(paritySummary.strategy_gate_mismatch_n) || 0;
  const otherServerPolicyMismatchN = toNum(paritySummary.other_server_policy_mismatch_n) || 0;
  const evPolicyBlockMin = Math.max(1, toNum(process.env.SERVER_SIGNAL_CUTOVER_BLOCK_EV_POLICY_MISMATCH_MIN) || 1);
  const cooldownPolicyBlockMin = Math.max(1, toNum(process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN) || 2);
  const strategyGateBlockMin = Math.max(1, toNum(process.env.SERVER_SIGNAL_CUTOVER_BLOCK_STRATEGY_GATE_MISMATCH_MIN) || 1);
  const otherServerPolicyBlockMin = Math.max(1, toNum(process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN) || 2);
  const finalMismatchBlockInPrimary = toBool(process.env.SERVER_SIGNAL_CUTOVER_FINAL_MISMATCH_BLOCK_IN_PRIMARY, false);
  const otherServerPolicyBlockInPrimary = toBool(process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY, false);
  const evPolicyDriftBlocked = evPolicyMismatchN >= evPolicyBlockMin;
  const cooldownPolicyDriftBlocked = cooldownPolicyMismatchN >= cooldownPolicyBlockMin;
  const strategyGateDriftBlocked = strategyGateMismatchN >= strategyGateBlockMin;
  const otherServerPolicyDriftBlocked = otherServerPolicyMismatchN >= otherServerPolicyBlockMin
    && (sourceMode !== "SERVER_PRIMARY" || otherServerPolicyBlockInPrimary);
  const otherServerPolicyMonitorOnly = otherServerPolicyMismatchN > 0 && !otherServerPolicyDriftBlocked;
  const remediationLastAppliedAtMs = parseDateMs(
    (driftRemediationApply && (
      driftRemediationApply.last_applied_at_ms
      || driftRemediationApply.last_applied_at_kst
      || driftRemediationApply.last_applied_at
    ))
    || remediationApplySummary.last_applied_at_ms
    || remediationApplySummary.last_applied_at_kst
    || remediationApplySummary.last_applied_at
    || null
  );
  const remediationAppliedNow = driftRemediationApply && typeof driftRemediationApply === "object"
    ? (
      driftRemediationApply.applied === true
      || remediationApplySummary.applied === true
    )
    : false;
  const remediationApplied = remediationAppliedNow || Number.isFinite(remediationLastAppliedAtMs);
  const remediationExceptionReleaseApplied = toBool(
    (driftRemediationApply && driftRemediationApply.exception_release_applied)
      ?? remediationApplySummary.exception_release_applied,
    false
  );
  const remediationEvPatchApplied = toBool(
    (driftRemediationApply && driftRemediationApply.ev_policy_patch_applied)
      ?? remediationApplySummary.ev_policy_patch_applied,
    false
  );
  const remediationEvPatchReportOnlyApplied = toBool(
    (driftRemediationApply && driftRemediationApply.ev_policy_patch_report_only_applied)
      ?? remediationApplySummary.ev_policy_patch_report_only_applied,
    false
  );
  const remediationEvPatchAppliedN = Math.max(
    0,
    toNum(
      (driftRemediationApply && driftRemediationApply.ev_policy_patch_applied_n)
      ?? remediationApplySummary.ev_policy_patch_applied_n
    ) || 0
  );
  const remediationEvPatchRequestedN = Math.max(
    0,
    toNum(
      (driftRemediationApply && driftRemediationApply.ev_policy_patch_requested_n)
      ?? remediationApplySummary.ev_policy_patch_requested_n
    ) || 0
  );
  const remediationEvPatchReportOnlyAppliedN = Math.max(
    0,
    toNum(
      (driftRemediationApply && driftRemediationApply.ev_policy_patch_report_only_applied_n)
      ?? remediationApplySummary.ev_policy_patch_report_only_applied_n
    ) || 0
  );
  const remediationEvPatchEffectiveApplied = remediationEvPatchApplied || remediationEvPatchReportOnlyApplied;
  const remediationGeneratedAtMs = parseDateMs(
    (driftRemediationApply && (driftRemediationApply.generated_at_kst || driftRemediationApply.generated_at))
    || remediationApplySummary.generated_at_kst
    || remediationApplySummary.generated_at
    || null
  );
  const remediationAppliedAtMs = remediationApplied
    ? (
      Number.isFinite(remediationLastAppliedAtMs)
        ? remediationLastAppliedAtMs
        : (
          remediationAppliedNow
            ? remediationGeneratedAtMs
            : null
        )
    )
    : null;
  const remediationGraceEnabled = toBool(process.env.SERVER_SIGNAL_CUTOVER_REMEDIATION_GRACE_ENABLED, true);
  const remediationGraceWindowMs = Math.max(
    60 * 1000,
    toNum(process.env.SERVER_SIGNAL_CUTOVER_REMEDIATION_GRACE_WINDOW_MS) || (6 * 60 * 60 * 1000)
  );
  const remediationMinPostSamples = Math.max(
    1,
    toNum(process.env.SERVER_SIGNAL_CUTOVER_REMEDIATION_MIN_POST_SAMPLES) || 3
  );
  const nowMs = Date.now();
  const remediationWindowActive = remediationApplied
    && Number.isFinite(remediationAppliedAtMs)
    && (nowMs - remediationAppliedAtMs) <= remediationGraceWindowMs;
  const postApplyComparableTrackingActive = remediationEvPatchEffectiveApplied && Number.isFinite(remediationAppliedAtMs);
  const postApplyComparableRows = postApplyComparableTrackingActive
    ? parityRows.filter((row) => {
      const ms = toNum(row && row.observation_ms);
      if (!Number.isFinite(ms)) return false;
      return ms >= remediationAppliedAtMs;
    })
    : [];
  const postApplyEvPolicyMismatchN = postApplyComparableRows.filter((row) =>
    row
    && row.parity_match === false
    && toUpper(row.actual_drop_reason_family) === "EV_POLICY"
    && toUpper(row.actual_drop_reason) === "DROP_EV_GATE_TP1_PROB"
  ).length;
  const postApplyComparableN = postApplyComparableRows.length;
  const evPolicyGraceActive = remediationGraceEnabled
    && evPolicyDriftBlocked
    && remediationWindowActive
    && postApplyComparableN < remediationMinPostSamples;
  const evPolicyDriftBlockedEffective = evPolicyDriftBlocked && !evPolicyGraceActive;
  const dominantMismatchFamily = toUpper(paritySummary.dominant_mismatch_family)
    || toUpper(qualitySummary.top_drop_reason_family && qualitySummary.top_drop_reason_family.key)
    || null;
  const canaryReady = canarySummary.acceptance_ready === true;
  const canaryReason = String(canarySummary.acceptance_reason || "").trim().toUpperCase() || null;
  const strategyMismatch = strategyAlignmentData.mismatch && typeof strategyAlignmentData.mismatch === "object" ? strategyAlignmentData.mismatch : {};
  const strategyFreshness = strategyAlignmentData.mismatch_freshness && typeof strategyAlignmentData.mismatch_freshness === "object" ? strategyAlignmentData.mismatch_freshness : {};
  const strategyAlignmentSummary = strategyAlignmentData.alignment && typeof strategyAlignmentData.alignment === "object" ? strategyAlignmentData.alignment : {};
  const strategyGuardCount = toNum(strategyMismatch.guard_count) || 0;
  const strategyAfterLiveRevisionCount = toNum(strategyMismatch.after_live_revision_count) || 0;
  const strategyFreshnessStatus = toUpper(strategyFreshness.status) || null;
  const strategyLiveSyncNeeded = strategyAlignmentSummary.live_sync_needed === true;
  const strategyGateHistoricalOnly = strategyGateMismatchN > 0
    && strategyGuardCount <= 0
    && strategyAfterLiveRevisionCount <= 0
    && strategyFreshnessStatus === "HISTORICAL_ONLY"
    && strategyLiveSyncNeeded !== true;
  const evRescueRate = toNum(evGateRescueSummary.rescue_rate);
  const evPointPassLowerFailCount = toNum(evGateRescueSummary.point_pass_lower_fail_count) || 0;
  const evPointFailCount = toNum(evGateRescueSummary.point_fail_count) || 0;
  const evTopRescueMarket = Array.isArray(evGateRescueSummary.by_market) && evGateRescueSummary.by_market[0]
    ? String(evGateRescueSummary.by_market[0].market || "").trim().toUpperCase() || null
    : null;
  const evRecommendedAction = dominantMismatchFamily === "EV_POLICY"
    ? (
      Number.isFinite(evRescueRate) && evRescueRate >= 0.25 && evPointPassLowerFailCount >= evPointFailCount
        ? "LOWER_EV_TP1_MIN_REVIEW"
        : "HOLD_EV_POLICY_REVIEW"
    )
    : null;
  const genericRecommendedAction = dominantMismatchFamily === "EV_POLICY"
    ? evRecommendedAction
    : (dominantMismatchFamily === "COOLDOWN_POLICY"
      ? "RELAX_OPPOSITE_COOLDOWN_REVIEW"
      : (dominantMismatchFamily === "STRATEGY_GATE"
        ? "ALIGN_STRATEGY_GATE_REVIEW"
        : (finalDownstreamMismatchN > 0 ? "REVIEW_DOWNSTREAM_POLICY_PARITY" : null)));
  const artifactCoherence = deriveArtifactCoherence({
    authority,
    quality,
    parity,
    runtime,
    evGateRescue,
    strategyAlignment,
    serverPrimaryCanary,
  });
  const mismatchMarketCounts = new Map();
  const recentMismatchExamples = parityRows
    .filter((row) => row && row.parity_match === false)
    .sort((a, b) => (toNum(b.observation_ms) || 0) - (toNum(a.observation_ms) || 0))
    .slice(0, 5)
    .map((row) => ({
      market: String(row.market || row.symbol || "-").trim() || "-",
      tier: String(row.tier || "-").trim() || "-",
      regime: String(row.regime || "-").trim() || "-",
      family: String(row.actual_drop_reason_family || "-").trim().toUpperCase() || "-",
      reason: String(row.actual_drop_reason || row.shadow_reason || "-").trim() || "-",
      scope: String(row.mismatch_scope || "-").trim().toUpperCase() || "-",
      observed_at_kst: toKstString(row.observation_ms),
    }));
  for (const row of parityRows) {
    if (!row || row.parity_match !== false) continue;
    bump(mismatchMarketCounts, String(row.market || row.symbol || "UNKNOWN").trim() || "UNKNOWN");
  }
  const genericFinalDownstreamMismatchBlocked = (
    finalDownstreamMismatchN > 0
    && !evPolicyDriftBlockedEffective
    && !cooldownPolicyDriftBlocked
    && (!strategyGateDriftBlocked || strategyGateHistoricalOnly)
    && !otherServerPolicyDriftBlocked
    && (sourceMode !== "SERVER_PRIMARY" || finalMismatchBlockInPrimary)
  );
  const finalDownstreamMismatchMonitorOnly = (
    finalDownstreamMismatchN > 0
    && !evPolicyDriftBlockedEffective
    && !cooldownPolicyDriftBlocked
    && (!strategyGateDriftBlocked || strategyGateHistoricalOnly)
    && !otherServerPolicyDriftBlocked
    && !genericFinalDownstreamMismatchBlocked
  );

  const blockers = [];
  if (artifactCoherence.ready !== true) {
    blockers.push(...artifactCoherence.blockers);
  }
  if (runtimeStatus !== "READY") blockers.push("SERVER_RUNTIME_NOT_READY");
  if (runtimeTf !== "15m") blockers.push("SERVER_RUNTIME_TF_NOT_15M");
  if (marketCount <= 0) blockers.push("SERVER_RUNTIME_NO_MARKETS");
  if (shadowObservedN < 3) blockers.push("SHADOW_SAMPLE_SHORT");
  if (sourceParityMismatchN > 0) blockers.push("SOURCE_PARITY_DRIFT_ACTIVE");
  if (finalDownstreamMismatchN > 0) {
    if (evPolicyDriftBlockedEffective) blockers.push("EV_POLICY_DRIFT_ACTIVE");
    if (cooldownPolicyDriftBlocked) blockers.push("COOLDOWN_POLICY_DRIFT_ACTIVE");
    if (strategyGateDriftBlocked && !strategyGateHistoricalOnly) blockers.push("STRATEGY_GATE_DRIFT_ACTIVE");
    if (otherServerPolicyDriftBlocked) blockers.push("OTHER_SERVER_POLICY_DRIFT_ACTIVE");
    if (genericFinalDownstreamMismatchBlocked) blockers.push("FINAL_DOWNSTREAM_MISMATCH_ACTIVE");
  } else if (mismatchN > 0 || driftStatus === "PARITY_DRIFT") {
    blockers.push("PARITY_DRIFT_ACTIVE");
  }
  if (entryN <= 0) blockers.push("NO_SERVER_ENTRY_SIGNAL");
  if (intentN <= 0) blockers.push("NO_SERVER_INTENT");
  if (fillN <= 0) blockers.push("NO_SERVER_FILL");
  if (qualityStatus === "SERVER_SIGNAL_NOT_REACHING_EXECUTION") blockers.push("SERVER_SIGNAL_NOT_REACHING_EXECUTION");
  if (sourceMode === "SERVER_PRIMARY" && canaryReady !== true) blockers.push(canaryReason || "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT");

  const blockerActions = [];
  if (evPolicyDriftBlockedEffective) blockerActions.push({ family: "EV_POLICY", action: evRecommendedAction || "HOLD_EV_POLICY_REVIEW" });
  if (cooldownPolicyDriftBlocked) blockerActions.push({ family: "COOLDOWN_POLICY", action: "RELAX_OPPOSITE_COOLDOWN_REVIEW" });
  if (strategyGateDriftBlocked) blockerActions.push({ family: "STRATEGY_GATE", action: strategyGateHistoricalOnly ? "MONITOR_HISTORICAL_STRATEGY_GATE" : "ALIGN_STRATEGY_GATE_REVIEW" });
  if (otherServerPolicyDriftBlocked) blockerActions.push({ family: "OTHER_SERVER_POLICY", action: "FORCE_POLICY_HARDENING_REVIEW" });
  if (otherServerPolicyMonitorOnly) blockerActions.push({ family: "OTHER_SERVER_POLICY", action: "MONITOR_OTHER_SERVER_POLICY_ON_SERVER_PRIMARY" });
  if (finalDownstreamMismatchMonitorOnly) blockerActions.push({ family: "FINAL_DOWNSTREAM_MISMATCH", action: "MONITOR_ON_SERVER_PRIMARY" });

  const promotionGateReady = blockers.length === 0;
  const promotionBlockReasons = promotionGateReady ? [] : blockers.slice(0, 12);
  const promotionReady = promotionGateReady && sourceMode !== "SERVER_PRIMARY";
  const alreadyServerPrimary = sourceMode === "SERVER_PRIMARY";
  const status = promotionReady
    ? "SERVER_PRIMARY_PROMOTION_READY"
    : (alreadyServerPrimary
      ? (canaryReady ? "SERVER_PRIMARY_ACTIVE" : (canaryReason || "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT"))
      : (blockers[0] || "CUTOVER_HOLD"));

  return {
    current_status: {
      source_mode: sourceMode,
      drift_status: driftStatus,
      quality_status: qualityStatus,
      runtime_status: runtimeStatus,
      runtime_exec_tf: runtimeTf,
      runtime_market_count: marketCount,
      shadow_observed_24h_n: shadowObservedN,
      parity_mismatch_n: mismatchN,
      source_parity_mismatch_n: sourceParityMismatchN,
      final_downstream_mismatch_n: finalDownstreamMismatchN,
      ev_policy_mismatch_n: evPolicyMismatchN,
      ev_policy_drift_blocked_effective: evPolicyDriftBlockedEffective,
      ev_policy_grace_active: evPolicyGraceActive,
      ev_policy_remediation_applied: remediationApplied,
      ev_policy_patch_applied: remediationEvPatchApplied,
      ev_policy_patch_applied_n: remediationEvPatchAppliedN,
      ev_policy_patch_requested_n: remediationEvPatchRequestedN,
      ev_policy_patch_report_only_applied: remediationEvPatchReportOnlyApplied,
      ev_policy_patch_report_only_applied_n: remediationEvPatchReportOnlyAppliedN,
      ev_policy_effective_patch_applied: remediationEvPatchEffectiveApplied,
      learning_epoch_exception_release_applied: remediationExceptionReleaseApplied,
      ev_policy_remediation_applied_at_kst: Number.isFinite(remediationAppliedAtMs) ? toKstString(remediationAppliedAtMs) : null,
      ev_policy_remediation_min_post_samples: remediationMinPostSamples,
      ev_policy_post_apply_tracking_active: postApplyComparableTrackingActive,
      ev_policy_post_apply_comparable_n: postApplyComparableN,
      ev_policy_post_apply_mismatch_n: postApplyEvPolicyMismatchN,
      cooldown_policy_mismatch_n: cooldownPolicyMismatchN,
      strategy_gate_mismatch_n: strategyGateMismatchN,
      other_server_policy_mismatch_n: otherServerPolicyMismatchN,
      ev_policy_block_min: evPolicyBlockMin,
      cooldown_policy_block_min: cooldownPolicyBlockMin,
      strategy_gate_block_min: strategyGateBlockMin,
      other_server_policy_block_min: otherServerPolicyBlockMin,
      final_mismatch_block_in_primary: finalMismatchBlockInPrimary,
      other_server_policy_block_in_primary: otherServerPolicyBlockInPrimary,
      final_downstream_mismatch_monitor_only: finalDownstreamMismatchMonitorOnly,
      ev_policy_drift_blocked: evPolicyDriftBlocked,
      cooldown_policy_drift_blocked: cooldownPolicyDriftBlocked,
      strategy_gate_drift_blocked: strategyGateDriftBlocked,
      other_server_policy_drift_blocked: otherServerPolicyDriftBlocked,
      other_server_policy_monitor_only: otherServerPolicyMonitorOnly,
      strategy_gate_historical_only: strategyGateHistoricalOnly,
      strategy_gate_guard_count: strategyGuardCount,
      strategy_gate_after_live_revision_count: strategyAfterLiveRevisionCount,
      strategy_gate_freshness_status: strategyFreshnessStatus,
      dominant_mismatch_family: dominantMismatchFamily,
      ev_policy_rescue_rate: evRescueRate,
      ev_policy_point_pass_lower_fail_count: evPointPassLowerFailCount,
      ev_policy_point_fail_count: evPointFailCount,
      ev_policy_top_rescue_market: evTopRescueMarket,
      ev_policy_recommended_action: evRecommendedAction,
      recommended_action: genericRecommendedAction,
      blocker_actions: blockerActions,
      entry_24h_n: entryN,
      intent_24h_n: intentN,
      fill_24h_n: fillN,
      strategy_gate_historical_only: strategyGateHistoricalOnly,
      canary_acceptance_ready: canaryReady,
      canary_acceptance_reason: canaryReason,
      artifact_coherence_status: artifactCoherence.status,
      artifact_coherence_ready: artifactCoherence.ready === true,
      artifact_coherence_reason: artifactCoherence.coherence_reason,
      artifact_freshness_sla_ms: artifactCoherence.freshness_sla_ms,
      artifact_skew_max_ms: artifactCoherence.skew_max_ms,
      artifact_generated_at_skew_ms: artifactCoherence.generated_at_skew_ms,
      artifact_generated_at_skew_exceeded: artifactCoherence.generated_at_skew_exceeded === true,
      artifact_generated_at_skew_exceeded_effective: artifactCoherence.generated_at_skew_exceeded_effective === true,
      artifact_stale_required_n: artifactCoherence.stale_required_n,
      artifact_missing_generated_required_n: artifactCoherence.missing_generated_required_n,
      artifact_cycle_alignment_status: artifactCoherence.cycle_alignment_status,
      artifact_cycle_unique_n: artifactCoherence.cycle_unique_n,
      promotion_gate_ready: promotionGateReady,
      promotion_gate_status: promotionGateReady ? "READY" : "BLOCKED",
      promotion_blocker_n: promotionBlockReasons.length,
      promotion_block_reasons: promotionBlockReasons,
    },
    summary: {
      promotion_ready: promotionReady,
      promotion_gate_ready: promotionGateReady,
      promotion_gate_status: promotionGateReady ? "READY" : "BLOCKED",
      promotion_blocker_n: promotionBlockReasons.length,
      promotion_block_reasons: promotionBlockReasons,
      already_server_primary: alreadyServerPrimary,
      readiness_status: status,
      blocker_n: blockers.length,
      blockers,
      source_mode: sourceMode,
      runtime_exec_tf: runtimeTf,
      runtime_market_count: marketCount,
      entry_24h_n: entryN,
      intent_24h_n: intentN,
      fill_24h_n: fillN,
      strategy_gate_historical_only: strategyGateHistoricalOnly,
      dominant_mismatch_family: dominantMismatchFamily,
      recommended_action: genericRecommendedAction,
      ev_policy_block_min: evPolicyBlockMin,
      ev_policy_drift_blocked_effective: evPolicyDriftBlockedEffective,
      ev_policy_grace_active: evPolicyGraceActive,
      ev_policy_remediation_applied: remediationApplied,
      ev_policy_patch_applied: remediationEvPatchApplied,
      ev_policy_patch_applied_n: remediationEvPatchAppliedN,
      ev_policy_patch_requested_n: remediationEvPatchRequestedN,
      ev_policy_patch_report_only_applied: remediationEvPatchReportOnlyApplied,
      ev_policy_patch_report_only_applied_n: remediationEvPatchReportOnlyAppliedN,
      ev_policy_effective_patch_applied: remediationEvPatchEffectiveApplied,
      learning_epoch_exception_release_applied: remediationExceptionReleaseApplied,
      ev_policy_remediation_applied_at_kst: Number.isFinite(remediationAppliedAtMs) ? toKstString(remediationAppliedAtMs) : null,
      ev_policy_remediation_min_post_samples: remediationMinPostSamples,
      ev_policy_post_apply_tracking_active: postApplyComparableTrackingActive,
      ev_policy_post_apply_comparable_n: postApplyComparableN,
      ev_policy_post_apply_mismatch_n: postApplyEvPolicyMismatchN,
      cooldown_policy_block_min: cooldownPolicyBlockMin,
      strategy_gate_block_min: strategyGateBlockMin,
      other_server_policy_block_min: otherServerPolicyBlockMin,
      final_mismatch_block_in_primary: finalMismatchBlockInPrimary,
      other_server_policy_block_in_primary: otherServerPolicyBlockInPrimary,
      final_downstream_mismatch_monitor_only: finalDownstreamMismatchMonitorOnly,
      blocker_actions: blockerActions,
      ev_policy_recommended_action: evRecommendedAction,
      ev_policy_top_rescue_market: evTopRescueMarket,
      artifact_coherence_status: artifactCoherence.status,
      artifact_coherence_ready: artifactCoherence.ready === true,
      artifact_coherence_reason: artifactCoherence.coherence_reason,
      artifact_generated_at_skew_ms: artifactCoherence.generated_at_skew_ms,
      artifact_generated_at_skew_exceeded: artifactCoherence.generated_at_skew_exceeded === true,
      artifact_generated_at_skew_exceeded_effective: artifactCoherence.generated_at_skew_exceeded_effective === true,
      artifact_cycle_alignment_status: artifactCoherence.cycle_alignment_status,
    },
    rows: {
      top_mismatch_market: topRows(mismatchMarketCounts, 5),
      mismatch_examples: recentMismatchExamples,
      artifact_coherence: artifactCoherence.rows,
    },
  };
}

module.exports = {
  deriveServerSignalCutoverReadiness,
};
