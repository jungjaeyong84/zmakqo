"use strict";

const { candidateFingerprint } = require("./bestSelfEvolutionMemoryLedger");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function normalizeArray(value, fallback = ["ALL"]) {
  if (Array.isArray(value) && value.length) {
    return value.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean);
  }
  return fallback.slice();
}

function resolveDiffDirection(key, current, next) {
  const curr = toNum(current);
  const nxt = toNum(next);
  if (curr == null || nxt == null) return "SHIFT";
  if (curr === nxt) return "SHIFT";
  const keyUpper = String(key || "").toUpperCase();
  const isMaxLike = keyUpper.includes("_MAX") || keyUpper.includes("KILL");
  if (nxt > curr) return isMaxLike ? "LOOSEN" : "TIGHTEN";
  return isMaxLike ? "TIGHTEN" : "LOOSEN";
}

function aggregateDirection(changes = []) {
  const rows = Array.isArray(changes) ? changes : [];
  const tighten = rows.filter((row) => row.direction === "TIGHTEN").length;
  const loosen = rows.filter((row) => row.direction === "LOOSEN").length;
  if (tighten > loosen) return "TIGHTEN";
  if (loosen > tighten) return "LOOSEN";
  return "SHIFT";
}

function buildChange(key, current, next, reason) {
  return {
    key,
    current: current == null ? null : current,
    next: next == null ? null : next,
    direction: resolveDiffDirection(key, current, next),
    reason: String(reason || "N/A"),
  };
}

const PINE_THRESHOLD_KEYS = new Set([
  "SHARED_REGIME_TRANSITION_CONFIRMATION",
  "ENTRY_CORE_SCORE_ABS",
  "ENTRY_EARLY_SCORE_ABS",
  "ENTRY_PRE_REAL_SCORE_ABS",
  "ENTRY_REAL_SCORE_ABS",
  "GATE_CORE_SCORE_ABS",
  "GATE_EARLY_SCORE_ABS",
]);

function isPineThresholdChangeKey(key) {
  const raw = String(key || "").trim().toUpperCase();
  if (!raw) return false;
  if (PINE_THRESHOLD_KEYS.has(raw)) return true;
  if (raw.includes("REGIME") && raw.includes("CONFIRM")) return true;
  if (raw.includes("SCORE_ABS")) return true;
  if (raw.endsWith("_THRESHOLD")) return true;
  if (raw.endsWith("_MIN") || raw.endsWith("_MAX")) return true;
  return false;
}

function deriveCanonicalMigrationClass(candidate = {}) {
  const scope = String(candidate && candidate.scope || "").trim().toUpperCase();
  if (scope && scope !== "PINE") return "SERVER_POLICY";
  const changes = Array.isArray(candidate && candidate.changes) ? candidate.changes : [];
  const keyedChanges = changes
    .map((row) => String(row && row.key || "").trim())
    .filter(Boolean);
  if (keyedChanges.length && keyedChanges.every((key) => isPineThresholdChangeKey(key))) {
    return "PINE_THRESHOLD";
  }
  return "PINE_LOGIC";
}

function deriveCurrentDeployUnit(candidate = {}) {
  const scope = String(candidate && candidate.scope || "").trim().toUpperCase();
  return scope === "PINE" ? "PINE_FILE" : "SERVER_SETTINGS";
}

function deriveTargetDeployUnit(migrationClass) {
  if (migrationClass === "SERVER_POLICY") return "SERVER_SETTINGS";
  if (migrationClass === "PINE_THRESHOLD") return "SERVER_SETTINGS";
  return "PINE_FILE";
}

function annotateCanonicalMigration(candidate = {}) {
  const canonicalMigrationClass = deriveCanonicalMigrationClass(candidate);
  return {
    ...candidate,
    canonical_migration_class: canonicalMigrationClass,
    current_deploy_unit: deriveCurrentDeployUnit(candidate),
    target_deploy_unit: deriveTargetDeployUnit(canonicalMigrationClass),
  };
}

function buildGuardEffects(contract = null, marketGuard = null) {
  const selected = marketGuard && typeof marketGuard === "object" ? marketGuard : (contract || {});
  return {
    count_guard_effect: {
      projected_count_ratio_global: toNum(selected.projected_count_ratio_global),
      tightening_allowed: selected.tightening_allowed !== false,
      mode: String(selected.mode || contract && contract.mode || "NORMAL"),
    },
    replacement_effect: {
      projected_replacement_ratio: toNum(selected.projected_replacement_ratio),
      recovery_priority: selected.recovery_priority === true,
    },
  };
}

function buildRiskFlags({ direction, contract, marketGuard, blocked = false, ready = true } = {}) {
  const flags = [];
  const effective = marketGuard && typeof marketGuard === "object" ? marketGuard : contract;
  if (blocked) flags.push("BLOCKED_SOURCE_ACTION");
  if (ready === false) flags.push("NOT_READY");
  if (effective && effective.tightening_allowed === false && direction === "TIGHTEN") flags.push("COUNT_GUARD_ACTIVE");
  if (effective && effective.recovery_priority === true && direction === "TIGHTEN") flags.push("RECOVERY_PRIORITY_ACTIVE");
  if (effective && String(effective.mode || "").toUpperCase() === "COUNT_GUARD_ACTIVE") flags.push("MARKET_COUNT_GUARD");
  return flags;
}

function buildMemoryGuardContext(memoryLedger = null) {
  const raw = unwrapRawReport(memoryLedger);
  const summary = raw && raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  const currentRows = Array.isArray(raw && raw.current_rows) ? raw.current_rows : [];
  const blockedRows = currentRows.filter((row) => row && row.memory_blocked === true);
  return {
    blockedIds: new Set(
      (Array.isArray(summary.blocked_candidate_ids) ? summary.blocked_candidate_ids : [])
        .map((row) => String(row || "").trim())
        .filter(Boolean)
    ),
    blockedFingerprints: new Set(
      blockedRows
        .map((row) => String(row && row.change_fingerprint || "").trim())
        .filter(Boolean)
    ),
    currentRowById: new Map(
      currentRows
        .map((row) => [String(row && row.candidate_id || "").trim(), row])
        .filter((row) => row[0])
    ),
  };
}

function applyMemoryGuards(candidate = {}, memoryContext = null) {
  const next = {
    ...candidate,
    risk_flags: Array.isArray(candidate.risk_flags) ? candidate.risk_flags.slice() : [],
  };
  if (!memoryContext) return next;
  const candidateId = String(candidate && candidate.candidate_id || "").trim();
  const fingerprint = candidateFingerprint(candidate);
  const memoryRow = candidateId ? (memoryContext.currentRowById.get(candidateId) || null) : null;
  const explicitMemoryBlocked = (candidateId && memoryContext.blockedIds.has(candidateId)) || (memoryRow && memoryRow.memory_blocked === true);
  const fingerprintRepeated = memoryContext.blockedFingerprints.has(fingerprint);
  const memoryBlocked = explicitMemoryBlocked || fingerprintRepeated;

  next.change_fingerprint = fingerprint;
  next.memory_blocked = memoryBlocked === true;
  next.memory_block_reason = memoryBlocked
    ? String(
      (memoryRow && memoryRow.memory_block_reason)
      || (fingerprintRepeated ? "FAILED_FINGERPRINT_REPEAT" : "RECENT_FAIL_FINGERPRINT_WITHIN_TTL")
    )
    : null;
  next.failed_fingerprint_repeat = fingerprintRepeated === true;

  if (memoryBlocked && !next.risk_flags.includes("MEMORY_BLOCKED")) next.risk_flags.push("MEMORY_BLOCKED");
  if (fingerprintRepeated && !next.risk_flags.includes("FAILED_FINGERPRINT_REPEAT")) next.risk_flags.push("FAILED_FINGERPRINT_REPEAT");
  if (memoryBlocked || fingerprintRepeated) next.ready_for_auto_apply = false;
  return next;
}

function buildPineCandidates({ patchCandidates, tf = "15m", contract = null, marketGuard = null, changeControl = null } = {}) {
  const raw = unwrapRawReport(patchCandidates);
  const rows = Array.isArray(raw && raw.candidates) ? raw.candidates : [];
  return rows.map((row) => {
    const changes = [
      {
        key: String(row.pine_patch_axis || row.reason_family || "PINE_FULL_QUALITY_BUNDLE"),
        current: null,
        next: toNum(row.pine_patch_delta),
        direction: String(row.direction || "SHIFT").trim().toUpperCase() || "SHIFT",
        reason: String(row.rationale || row.pine_hint || row.reason_family || "N/A"),
      },
    ];
    const direction = aggregateDirection(changes);
    const ready = row.ready_for_weekly_patch === true;
    return {
      candidate_id: String(row.candidate_id || "").trim() || null,
      display_candidate_id: String(row.display_candidate_id || row.candidate_id || "").trim() || null,
      scope: "PINE",
      source: "PINE_PATCH_CANDIDATE",
      markets: normalizeArray(row.markets, ["ALL"]),
      tf: String(row.tf || tf || "15m"),
      changes,
      objective_delta: null,
      ...buildGuardEffects(contract, marketGuard),
      risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: false, ready }),
      rollback_target: String(changeControl && changeControl.auto_rollback && changeControl.auto_rollback.rollback_file_path || "").trim() || null,
      direction,
      status: String(row.status || "N/A"),
      ready_for_auto_apply: ready,
      evidence: {
        support_n: toNum(row.analyzed_n),
        support_rate: null,
        priority_score: toNum(row.priority_score),
        avg_dropped_ret_net: toNum(row.avg_dropped_ret_net),
        rationale: String(row.rationale || ""),
      },
    };
  });
}

function buildMlCandidates({ ml, tf = "15m", contract = null, marketGuard = null } = {}) {
  const raw = unwrapRawReport(ml);
  const recs = raw && raw.recommendations && typeof raw.recommendations === "object" ? raw.recommendations : {};
  const out = [];
  const qualityRows = Array.isArray(recs.QUALITY) ? recs.QUALITY : [];
  for (const row of qualityRows) {
    const change = buildChange(row.key, row.current, row.next, row.display_reason || row.reason);
    const direction = String(change.direction || "SHIFT");
    out.push({
      candidate_id: `ML_${String(row.key || "QUALITY").trim().toUpperCase()}`,
      display_candidate_id: String(row.display_key || row.key || "ML_QUALITY"),
      scope: "ML",
      source: "ML_QUALITY_RECOMMENDATION",
      markets: ["ALL"],
      tf,
      changes: [change],
      objective_delta: null,
      ...buildGuardEffects(contract, marketGuard),
      risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: !!row.blocked_action, ready: true }),
      rollback_target: null,
      direction,
      status: String(row.action || "KEEP"),
      ready_for_auto_apply: /^REVIEW_/.test(String(row.action || "")) && !row.blocked_action,
      evidence: {
        support_n: toNum(row.support_n),
        support_rate: toNum(row.support_rate),
        priority_score: null,
        avg_dropped_ret_net: null,
        rationale: String(row.reason || ""),
      },
    });
  }
  for (const [key, scope] of [["MARKET", "ML"], ["AI", "AI"], ["EV", "ML"]]) {
    const row = recs[key];
    if (!row || typeof row !== "object") continue;
    const nextObj = row.next && typeof row.next === "object" ? row.next : null;
    const changes = nextObj
      ? Object.keys(nextObj).map((changeKey) => buildChange(changeKey, null, nextObj[changeKey], row.reason))
      : [];
    const direction = changes.length ? aggregateDirection(changes) : "SHIFT";
    out.push({
      candidate_id: `${scope}_${String((row.blocked_key || key) || key).trim().toUpperCase()}`,
      display_candidate_id: String(row.blocked_key || key),
      scope,
      source: `ML_${key}_RECOMMENDATION`,
      markets: scope === "ML" && marketGuard && marketGuard.market ? [marketGuard.market] : ["ALL"],
      tf,
      changes,
      objective_delta: null,
      ...buildGuardEffects(contract, marketGuard),
      risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: !!row.blocked_action, ready: /^REVIEW_/.test(String(row.action || "")) }),
      rollback_target: null,
      direction,
      status: String(row.action || "KEEP"),
      ready_for_auto_apply: /^REVIEW_/.test(String(row.action || "")) && !row.blocked_action,
      evidence: {
        support_n: null,
        support_rate: null,
        priority_score: null,
        avg_dropped_ret_net: null,
        rationale: String(row.reason || ""),
      },
    });
  }
  return out;
}

function buildEvCandidate({ ev, tf = "15m", contract = null, marketGuard = null, objectiveSupervisor = null } = {}) {
  const raw = unwrapRawReport(ev);
  if (!raw || typeof raw !== "object") return [];
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const filterLayers = supervisor.filter_layers && typeof supervisor.filter_layers === "object"
    ? supervisor.filter_layers
    : {};
  const evLayer = filterLayers.ev_time_value && typeof filterLayers.ev_time_value === "object"
    ? filterLayers.ev_time_value
    : {};
  const attribution = supervisor.self_evolution_attribution && typeof supervisor.self_evolution_attribution === "object"
    ? supervisor.self_evolution_attribution
    : {};
  const missedRecovery = attribution.missed_recovery_top_reason && typeof attribution.missed_recovery_top_reason === "object"
    ? attribution.missed_recovery_top_reason
    : {};
  const evReason = String(raw.decision_reason || "").trim().toUpperCase();
  const evLayerReason = String(evLayer.tuner_reason || "").trim().toUpperCase();
  const staleEvTuner = evLayerReason === "STALE_ARTIFACT" || raw.fresh === false;
  const insufficientSample = evReason === "INSUFFICIENT_SAMPLE" || evLayerReason === "INSUFFICIENT_SAMPLE";
  const evMissedRecovery = String(missedRecovery.key || "").trim().toUpperCase() === "DROP_EV_GATE_TP1_PROB";
  const evMissedRecoveryN = toNum(missedRecovery.count) || 0;
  const allowShadowFallback = raw.settings_updated !== true
    && (staleEvTuner || insufficientSample)
    && evMissedRecovery
    && evMissedRecoveryN >= 3;
  const currentBand = raw.current_band && typeof raw.current_band === "object" ? raw.current_band : {};
  const nextBand = raw.next_band && typeof raw.next_band === "object" ? raw.next_band : {};
  const fallbackBand = allowShadowFallback
    ? {
      fullThreshold: toNum(currentBand.fullThreshold) == null ? null : Number((clamp(toNum(currentBand.fullThreshold) - 0.02, 0.35, 0.95)).toFixed(4)),
      killThreshold: toNum(currentBand.killThreshold),
      midScale: toNum(currentBand.midScale) == null ? null : Number((clamp(toNum(currentBand.midScale) + 0.05, 0.05, 1)).toFixed(4)),
      lowScale: toNum(currentBand.lowScale) == null ? null : Number((clamp(toNum(currentBand.lowScale) + 0.05, 0.05, 1)).toFixed(4)),
    }
    : nextBand;
  const nextThreshold = allowShadowFallback && toNum(raw.current_threshold) != null
    ? Number((clamp(toNum(raw.current_threshold) - 0.02, 0.3, 0.95)).toFixed(4))
    : raw.next_threshold;
  const changes = allowShadowFallback
    ? [
      buildChange("ev_gate_tp1_prob_min", raw.current_threshold, nextThreshold, raw.decision_reason),
      buildChange("ev_gate_tp1_prob_full", currentBand.fullThreshold, fallbackBand.fullThreshold, raw.decision_reason),
    ].filter((row) => row.current != null || row.next != null)
    : [
      buildChange("ev_gate_tp1_prob_min", raw.current_threshold, nextThreshold, raw.decision_reason),
      buildChange("ev_gate_tp1_prob_full", currentBand.fullThreshold, fallbackBand.fullThreshold, raw.decision_reason),
      buildChange("ev_gate_tp1_prob_kill", currentBand.killThreshold, fallbackBand.killThreshold, raw.decision_reason),
      buildChange("ev_gate_qty_scale_mid", currentBand.midScale, fallbackBand.midScale, raw.decision_reason),
      buildChange("ev_gate_qty_scale_low", currentBand.lowScale, fallbackBand.lowScale, raw.decision_reason),
    ].filter((row) => row.current != null || row.next != null);
  if (!raw.settings_updated && !allowShadowFallback) return [];
  const direction = aggregateDirection(changes);
  const candidate = {
    candidate_id: "EV_TP1_THRESHOLD_TUNE",
    display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
    canonical_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
    compatibility_candidate_id: "EV_TP1_THRESHOLD_TUNE",
    scope: "EV",
    source: allowShadowFallback ? "EV_TUNER_SHADOW_FALLBACK" : "EV_TUNER",
    // Filter-4 softening is a shared policy change, not a market-local override.
    markets: ["ALL"],
    tf: String(raw.tf || tf || "15m"),
    changes,
    objective_delta: null,
    ...buildGuardEffects(contract, null),
    risk_flags: buildRiskFlags({ direction, contract, marketGuard: null, blocked: false, ready: raw.settings_updated === true && !allowShadowFallback }),
    rollback_target: null,
    direction,
    status: allowShadowFallback
      ? (staleEvTuner ? "STALE_ARTIFACT_SHADOW_FALLBACK" : "INSUFFICIENT_SAMPLE_SHADOW_FALLBACK")
      : String(raw.decision_reason || "N/A"),
    ready_for_auto_apply: raw.settings_updated === true && !allowShadowFallback,
    policy_basis: "TP_COMPOSITE_EXIT_VALUE_V1",
    threshold_metric: "exit_value_lower_bound",
    compatibility_drop_reason: "DROP_EV_GATE_TP1_PROB",
    legacy_threshold_setting_keys: [
      "ev_gate_tp1_prob_min",
      "ev_gate_tp1_prob_full",
      "ev_gate_tp1_prob_kill",
    ],
    evidence: {
      support_n: allowShadowFallback ? evMissedRecoveryN : null,
      support_rate: null,
      priority_score: null,
      avg_dropped_ret_net: null,
      rationale: allowShadowFallback
        ? `${staleEvTuner ? "STALE_ARTIFACT" : "INSUFFICIENT_SAMPLE"} / missed_recovery=${evMissedRecoveryN}`
        : String(raw.decision_reason || ""),
    },
    shadow_only: allowShadowFallback,
  };
  if (allowShadowFallback && !candidate.risk_flags.includes("EV_SHADOW_FALLBACK")) candidate.risk_flags.push("EV_SHADOW_FALLBACK");
  if (staleEvTuner && !candidate.risk_flags.includes("EV_TUNER_STALE")) candidate.risk_flags.push("EV_TUNER_STALE");
  if (insufficientSample && !candidate.risk_flags.includes("EV_TUNER_INSUFFICIENT_SAMPLE")) candidate.risk_flags.push("EV_TUNER_INSUFFICIENT_SAMPLE");
  return [candidate];
}

function buildWaitCandidate({ wait, tf = "15m", contract = null, marketGuard = null } = {}) {
  const raw = unwrapRawReport(wait);
  if (!raw || typeof raw !== "object") return [];
  const current = raw.current && typeof raw.current === "object" ? raw.current : {};
  const next = raw.next && typeof raw.next === "object" ? raw.next : {};
  const keys = Array.from(new Set([...Object.keys(current), ...Object.keys(next)]));
  const changes = keys.map((key) => buildChange(key, current[key], next[key], raw.reason)).filter((row) => row.current != null || row.next != null);
  const direction = aggregateDirection(changes);
  return [{
    candidate_id: "WAIT_ONE_BAR_TUNE",
    display_candidate_id: "WAIT_ONE_BAR_TUNE",
    scope: "WAIT",
    source: "WAIT_TUNER",
    markets: marketGuard && marketGuard.market ? [marketGuard.market] : ["ALL"],
    tf: String(raw.tf || tf || "15m"),
    changes,
    objective_delta: null,
    ...buildGuardEffects(contract, marketGuard),
    risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: false, ready: raw.changed === true }),
    rollback_target: null,
    direction,
    status: String(raw.reason || "N/A"),
    ready_for_auto_apply: raw.changed === true,
    evidence: {
      support_n: toNum(raw.enough_trigger_sample ? raw.current_summary && raw.current_summary.triggered_n : null),
      support_rate: null,
      priority_score: null,
      avg_dropped_ret_net: null,
      rationale: String(raw.reason || ""),
    },
  }];
}

function buildMarketConcentrationCandidate({ objectiveSupervisor = null, tf = "15m", contract = null } = {}) {
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const objective = supervisor.self_evolution_objective && typeof supervisor.self_evolution_objective === "object"
    ? supervisor.self_evolution_objective
    : {};
  const concentration = objective.market_concentration && typeof objective.market_concentration === "object"
    ? objective.market_concentration
    : {};
  const dominant = concentration.dominant_negative_market && typeof concentration.dominant_negative_market === "object"
    ? concentration.dominant_negative_market
    : null;
  const market = String(dominant && dominant.market || "").trim().toUpperCase();
  const objectiveScore = toNum(dominant && dominant.objective_score);
  const realizedN = toNum(dominant && dominant.realized_n);
  const dragGap = toNum(concentration.bottom_market_drag_gap);
  const dominantShare = toNum(concentration.dominant_negative_share);
  const constraints = dominant && dominant.constraints && typeof dominant.constraints === "object"
    ? dominant.constraints
    : {};
  const countFloorPass = constraints.count_floor_pass !== false;
  const latencyBudgetPass = constraints.latency_budget_pass !== false;
  const severeConcentrationFallback = (
    (dominantShare != null && dominantShare >= 0.40)
    || (dragGap != null && dragGap >= 4)
    || (objectiveScore != null && objectiveScore <= -4)
  );
  if ((!concentration.concentration_flag && !severeConcentrationFallback) || !market) return [];
  if (objectiveScore == null || objectiveScore > -2) return [];
  if (realizedN == null || realizedN < 3) return [];
  if (dragGap == null || dragGap < 1) return [];
  if (!countFloorPass || !latencyBudgetPass) return [];

  const rationale = `dominant negative market ${market} objective ${objectiveScore.toFixed(4)} / drag ${dragGap.toFixed(4)} / realized ${realizedN}`;
  const changes = [
    {
      key: "shared_regime_transition_confirmation",
      current: 0,
      next: 1,
      direction: "TIGHTEN",
      reason: rationale,
    },
    {
      key: "entry_core_score_abs",
      current: 0,
      next: 1,
      direction: "TIGHTEN",
      reason: rationale,
    },
  ];

  return [{
    candidate_id: `AUTO_MARKET_${market}_REGIME_TIGHTEN`,
    display_candidate_id: `AUTO_${market}_REGIME_TIGHTEN`,
    scope: "PINE",
    source: "MARKET_CONCENTRATION_RECOVERY",
    markets: [market],
    tf,
    changes,
    objective_delta: null,
    ...buildGuardEffects(contract, null),
    risk_flags: [
      ...buildRiskFlags({ direction: "TIGHTEN", contract, marketGuard: null, blocked: false, ready: true }),
      "MARKET_CONCENTRATION_RECOVERY",
    ],
    rollback_target: null,
    direction: "TIGHTEN",
    status: "MARKET_CONCENTRATION_RECOVERY",
    ready_for_auto_apply: true,
    evidence: {
      support_n: realizedN,
      support_rate: toNum(concentration.dominant_negative_share),
      priority_score: dragGap,
      avg_dropped_ret_net: toNum(dominant && dominant.avg_realized_ret_net),
      rationale,
    },
    market_concentration_recovery: true,
    market_concentration_fallback_triggered: concentration.concentration_flag !== true,
    target_market: market,
    target_market_objective_score: objectiveScore,
    target_market_drag_gap: dragGap,
  }];
}

function buildCandidateChangeSets({
  objectiveSupervisor = null,
  patchCandidates = null,
  ml = null,
  ev = null,
  wait = null,
  changeControl = null,
  memoryLedger = null,
} = {}) {
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const contract = supervisor.best_febt_tuning_contract || null;
  const marketGuard = Array.isArray(supervisor.best_febt_market_contracts)
    ? supervisor.best_febt_market_contracts.find((row) => row && (row.tightening_allowed === false || row.recovery_priority === true))
      || supervisor.best_febt_market_contracts[0]
      || null
    : null;
  const tf = String(supervisor.phase0 && supervisor.phase0.tf || "15m");
  const memoryContext = buildMemoryGuardContext(memoryLedger);
  const generatedRows = [
    ...buildPineCandidates({ patchCandidates, tf, contract, marketGuard, changeControl: unwrapRawReport(changeControl) }),
    ...buildMarketConcentrationCandidate({ objectiveSupervisor: supervisor, tf, contract }),
    ...buildMlCandidates({ ml, tf, contract, marketGuard }),
    ...buildEvCandidate({ ev, tf, contract, marketGuard, objectiveSupervisor: supervisor }),
    ...buildWaitCandidate({ wait, tf, contract, marketGuard }),
  ]
    .filter((row) => row && row.candidate_id)
    .map((row) => annotateCanonicalMigration(row))
    .map((row) => applyMemoryGuards(row, memoryContext));
  const blockedRows = generatedRows.filter((row) => row.memory_blocked === true);
  const rows = generatedRows.filter((row) => row.memory_blocked !== true);

  const byCanonicalMigrationClassGenerated = generatedRows.reduce((acc, row) => {
    const key = String(row.canonical_migration_class || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byTargetDeployUnitGenerated = generatedRows.reduce((acc, row) => {
    const key = String(row.target_deploy_unit || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byScope = rows.reduce((acc, row) => {
    const key = String(row.scope || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byCanonicalMigrationClass = rows.reduce((acc, row) => {
    const key = String(row.canonical_migration_class || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byTargetDeployUnit = rows.reduce((acc, row) => {
    const key = String(row.target_deploy_unit || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const ready = rows.filter((row) => row.ready_for_auto_apply === true).length;
  const blocked = rows.filter((row) => Array.isArray(row.risk_flags) && row.risk_flags.includes("BLOCKED_SOURCE_ACTION")).length;
  const memoryBlocked = blockedRows.length;
  const fingerprintRepeated = blockedRows.filter((row) => row.failed_fingerprint_repeat === true).length;
  const topCandidate = rows.slice().sort((a, b) =>
    ((toNum(b.evidence && b.evidence.priority_score) ?? -Infinity) - (toNum(a.evidence && a.evidence.priority_score) ?? -Infinity))
    || ((toNum(b.evidence && b.evidence.support_n) ?? 0) - (toNum(a.evidence && a.evidence.support_n) ?? 0))
    || String(a.candidate_id).localeCompare(String(b.candidate_id))
  )[0] || null;

  return {
    rows,
    blocked_rows: blockedRows,
    summary: {
      generated_n: generatedRows.length,
      total_n: rows.length,
      ready_n: ready,
      blocked_n: blocked,
      memory_blocked_n: memoryBlocked,
      failed_fingerprint_repeat_n: fingerprintRepeated,
      by_scope: byScope,
      by_canonical_migration_class_generated: byCanonicalMigrationClassGenerated,
      by_canonical_migration_class: byCanonicalMigrationClass,
      by_target_deploy_unit_generated: byTargetDeployUnitGenerated,
      by_target_deploy_unit: byTargetDeployUnit,
      top_candidate_id: topCandidate && topCandidate.candidate_id || null,
      top_scope: topCandidate && topCandidate.scope || null,
      top_candidate_migration_class: topCandidate && topCandidate.canonical_migration_class || null,
      top_candidate_target_deploy_unit: topCandidate && topCandidate.target_deploy_unit || null,
    },
  };
}

module.exports = {
  unwrapRawReport,
  buildCandidateChangeSets,
  __test: {
    resolveDiffDirection,
    aggregateDirection,
    isPineThresholdChangeKey,
    deriveCanonicalMigrationClass,
    deriveCurrentDeployUnit,
    deriveTargetDeployUnit,
    annotateCanonicalMigration,
  },
};
