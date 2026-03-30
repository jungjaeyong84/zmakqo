"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function deriveDeploymentRootCause(blockers = []) {
  return Array.isArray(blockers) && blockers.length ? String(blockers[0] || "").trim() || null : null;
}

function derivePromotionNotReadyReason(promotion = null) {
  if (!promotion || typeof promotion !== "object") return "PROMOTION_NOT_READY";
  const explicit = String(promotion.reason || promotion.status || "").trim();
  return explicit || "PROMOTION_NOT_READY";
}

function pushAction(actions, message) {
  const line = String(message || "").trim();
  if (!line) return;
  if (!actions.includes(line)) actions.push(line);
}

function deriveDeploymentNextActions({
  blockers = [],
  targetCandidateId = null,
  targetReplay = null,
  targetCanaryRows = [],
  shadowGlobalDrift = 0,
  goldenGlobalDrift = 0,
  promotionReady = false,
  promotionNotReadyReason = null,
} = {}) {
  const actions = [];
  for (const blocker of Array.isArray(blockers) ? blockers : []) {
    switch (String(blocker || "").trim().toUpperCase()) {
      case "NO_TARGET_CANDIDATE":
        pushAction(actions, "Generate or select an active self-evolution candidate before deployment.");
        break;
      case "SELF_EVOLUTION_COUNT_FLOOR_FAIL":
        pushAction(actions, "Raise projected execution count above the floor before promoting a tighter policy.");
        break;
      case "SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL":
        pushAction(actions, "Improve replacement ratio projection before allowing deployment.");
        break;
      case "SELF_EVOLUTION_LATENCY_BUDGET_FAIL":
        pushAction(actions, "Reduce projected latency risk before deployment.");
        break;
      case "SELF_EVOLUTION_REPLAY_MISSING":
        pushAction(actions, `Rebuild replay validation for ${targetCandidateId || "the target candidate"} before deployment.`);
        break;
      case "SELF_EVOLUTION_REPLAY_NOT_PASS":
        pushAction(
          actions,
          `Resolve replay blockers for ${targetCandidateId || "the target candidate"}: ${Array.isArray(targetReplay && targetReplay.blockers) && targetReplay.blockers.length ? targetReplay.blockers.join(", ") : "validation_verdict is not PASS"}.`
        );
        break;
      case "SELF_EVOLUTION_CANARY_APPLY_BLOCK":
        pushAction(actions, `Wait for canary apply_pass=true before promoting ${targetCandidateId || "the target candidate"}.`);
        break;
      case "SELF_EVOLUTION_CANARY_ROLLBACK_READY":
        pushAction(actions, "Review rollback-ready canary markets before any promotion.");
        break;
      case "SELF_EVOLUTION_MEMORY_BLOCK":
        pushAction(actions, `Clear, expire, or explicitly override the memory ledger block for ${targetCandidateId || "the target candidate"}.`);
        break;
      case "FILTER_CANARY_DRIFT":
        pushAction(
          actions,
          `Resolve filter canary drift before deployment (shadow=${shadowGlobalDrift}, golden=${goldenGlobalDrift}${targetCanaryRows.length ? `, markets=${targetCanaryRows.map((row) => row.market).join("/")}` : ""}).`
        );
        break;
      default:
        break;
    }
  }
  if (!blockers.length && promotionReady !== true) {
    pushAction(actions, `Keep ${targetCandidateId || "the target candidate"} in replay/canary-ready state until promotion becomes ready (${promotionNotReadyReason || "PROMOTION_NOT_READY"}).`);
  }
  return actions;
}

function deriveDeploymentGuards({
  objectiveSupervisor = null,
  candidateChangeSet = null,
  replayReport = null,
  canaryReport = null,
  memoryLedger = null,
} = {}) {
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const promotion = supervisor.promotion && typeof supervisor.promotion === "object" ? supervisor.promotion : {};
  const rollback = supervisor.rollback && typeof supervisor.rollback === "object" ? supervisor.rollback : {};
  const objective = supervisor.self_evolution_objective && typeof supervisor.self_evolution_objective === "object"
    ? supervisor.self_evolution_objective
    : {};
  const candidates = unwrapRawReport(candidateChangeSet);
  const candidateSummary = candidates && candidates.summary && typeof candidates.summary === "object" ? candidates.summary : {};
  const replay = unwrapRawReport(replayReport);
  const replaySummary = replay && replay.summary && typeof replay.summary === "object" ? replay.summary : {};
  const validations = Array.isArray(replay && replay.validations) ? replay.validations : [];
  const canary = unwrapRawReport(canaryReport);
  const canarySummary = canary && canary.summary && typeof canary.summary === "object" ? canary.summary : {};
  const canaryRows = Array.isArray(canary && canary.rows) ? canary.rows : [];
  const memory = unwrapRawReport(memoryLedger);
  const memorySummary = memory && memory.summary && typeof memory.summary === "object" ? memory.summary : {};

  const targetCandidateId = String(
    promotion.candidate_id
    || replaySummary.best_candidate_id
    || candidateSummary.top_candidate_id
    || ""
  ).trim() || null;
  const targetReplay = targetCandidateId
    ? (validations.find((row) => String(row && row.candidate_id || "").trim() === targetCandidateId) || null)
    : null;
  const targetCanaryRows = targetCandidateId
    ? canaryRows.filter((row) => String(row && row.candidate_id || "").trim() === targetCandidateId)
    : [];
  const memoryBlockedIds = new Set(
    (Array.isArray(memorySummary.blocked_candidate_ids) ? memorySummary.blocked_candidate_ids : [])
      .map((row) => String(row || "").trim())
      .filter(Boolean)
  );
  const shadowGlobalDrift = toNum(canarySummary.shadow_global_drift) || 0;
  const goldenGlobalDrift = toNum(canarySummary.golden_global_drift) || 0;
  const promotionReady = promotion.ready === true;
  const promotionNotReadyReason = promotionReady ? null : derivePromotionNotReadyReason(promotion);

  const blockers = [];
  if (!targetCandidateId) blockers.push("NO_TARGET_CANDIDATE");
  if (objective.count_floor_pass === false) blockers.push("SELF_EVOLUTION_COUNT_FLOOR_FAIL");
  if (objective.replacement_floor_pass === false) blockers.push("SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL");
  if (objective.latency_budget_pass === false) blockers.push("SELF_EVOLUTION_LATENCY_BUDGET_FAIL");
  if (!targetReplay) blockers.push("SELF_EVOLUTION_REPLAY_MISSING");
  else if (String(targetReplay.validation_verdict || "").trim().toUpperCase() !== "PASS") blockers.push("SELF_EVOLUTION_REPLAY_NOT_PASS");
  if (canarySummary.apply_pass !== true) blockers.push("SELF_EVOLUTION_CANARY_APPLY_BLOCK");
  if (Number(canarySummary.rollback_ready_n || 0) > 0) blockers.push("SELF_EVOLUTION_CANARY_ROLLBACK_READY");
  if (memoryBlockedIds.has(targetCandidateId)) blockers.push("SELF_EVOLUTION_MEMORY_BLOCK");
  const hasExplicitGlobalCanaryPass = canarySummary.global_canary_pass === true || canarySummary.global_canary_pass === false;
  const globalCanaryPass = hasExplicitGlobalCanaryPass
    ? canarySummary.global_canary_pass === true
    : (shadowGlobalDrift === 0 && goldenGlobalDrift === 0);
  if (globalCanaryPass !== true) blockers.push("FILTER_CANARY_DRIFT");
  const rootCause = deriveDeploymentRootCause(blockers) || promotionNotReadyReason;
  const nextActions = deriveDeploymentNextActions({
    blockers,
    targetCandidateId,
    targetReplay,
    targetCanaryRows,
    shadowGlobalDrift,
    goldenGlobalDrift,
    promotionReady,
    promotionNotReadyReason,
  });

  const deployPass = promotionReady === true && blockers.length === 0;
  const rollbackOnly = rollback.ready === true && deployPass !== true;
  const rows = canaryRows.map((row) => ({
    market: String(row && row.market || "").trim().toUpperCase() || "UNKNOWN",
    wave: toNum(row && row.wave),
    current_stage: String(row && row.current_stage || "").trim().toUpperCase() || "SHADOW",
    candidate_id: String(row && row.candidate_id || "").trim() || null,
    deploy_pass: String(row && row.canary_verdict || "").trim().toUpperCase() === "READY"
      && (String(row && row.current_stage || "").trim().toUpperCase() === "SOFT"
        || String(row && row.current_stage || "").trim().toUpperCase() === "HARD"),
    blockers: Array.isArray(row && row.blockers) ? row.blockers.slice() : [],
  }));

  return {
    summary: {
      target_candidate_id: targetCandidateId,
      deploy_pass: deployPass,
      rollback_only: rollbackOnly,
      blockers,
      root_cause: rootCause,
      next_actions: nextActions,
      promotion_ready: promotionReady,
      promotion_not_ready_reason: promotionNotReadyReason,
      replay_verdict: String(targetReplay && targetReplay.validation_verdict || "").trim().toUpperCase() || null,
      canary_open_wave: toNum(canarySummary.open_wave) || 1,
      market_ready_n: rows.filter((row) => row.deploy_pass).length,
      market_total_n: rows.length,
      memory_blocked_candidate_n: toNum(memorySummary.blocked_candidate_n) || 0,
      shadow_global_drift: shadowGlobalDrift,
      golden_global_drift: goldenGlobalDrift,
    },
    rows,
  };
}

module.exports = {
  deriveDeploymentGuards,
  unwrapRawReport,
};
