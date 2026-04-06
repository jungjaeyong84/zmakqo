"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function norm(value) {
  return String(value || "").trim() || null;
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function findReplayMarketDelta(replay = null, market = null) {
  const rows = Array.isArray(replay && replay.market_objective_deltas) ? replay.market_objective_deltas : [];
  const key = String(market || "").trim().toUpperCase();
  return rows.find((row) => String(row && row.market || "").trim().toUpperCase() === key) || null;
}

function resolveDriftByMarket(summary = null) {
  const byMarket = summary && summary.byMarket && typeof summary.byMarket === "object"
    ? summary.byMarket
    : {};
  const out = {};
  for (const [marketRaw, meta] of Object.entries(byMarket)) {
    const market = String(marketRaw || "").trim().toUpperCase();
    if (!market) continue;
    out[market] = {
      total: toNum(meta && meta.total) || 0,
      drift: toNum(meta && meta.drift) || 0,
      byStage: meta && meta.byStage && typeof meta.byStage === "object" ? meta.byStage : {},
    };
  }
  if (!Object.keys(out).length && Number(toNum(summary && summary.drift) || 0) > 0) {
    out.GLOBAL = {
      total: toNum(summary && summary.total) || 0,
      drift: toNum(summary && summary.drift) || 0,
      byStage: summary && summary.byStage && typeof summary.byStage === "object" ? summary.byStage : {},
    };
  }
  return out;
}

function driftMetaForMarket(byMarket = {}, market) {
  const key = String(market || "").trim().toUpperCase();
  return byMarket[key] || { total: 0, drift: 0, byStage: {} };
}

function driftStageList(meta = null) {
  return Object.entries(meta && meta.byStage && typeof meta.byStage === "object" ? meta.byStage : {})
    .filter(([, value]) => Number(toNum(value && value.drift) || 0) > 0)
    .map(([stage]) => String(stage).trim().toUpperCase())
    .sort();
}

const WAVE_1 = Object.freeze(["BTCUSDT", "SOLUSDT"]);
const WAVE_2 = Object.freeze(["ETHUSDT", "BNBUSDT", "XRPUSDT"]);
const WAVE_3 = Object.freeze(["DOGEUSDT", "AXSUSDT"]);

function marketWave(market) {
  const key = String(market || "").trim().toUpperCase();
  if (WAVE_1.includes(key)) return 1;
  if (WAVE_2.includes(key)) return 2;
  if (WAVE_3.includes(key)) return 3;
  return 9;
}

function previousOpenWave(previousCanary = null) {
  const rows = Array.isArray(previousCanary && previousCanary.rows) ? previousCanary.rows : [];
  const progressed = rows.filter((row) => {
    const stage = String(row && row.current_stage || "").trim().toUpperCase();
    return stage === "SOFT" || stage === "HARD";
  });
  if (!progressed.length) return 1;
  return progressed.reduce((acc, row) => Math.max(acc, marketWave(row && row.market)), 1);
}

function waveHealthy(rows = [], wave) {
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => marketWave(row && row.market) === Number(wave));
  if (!scoped.length) return false;
  return scoped.every((row) => {
    const stage = String(row && row.current_stage || "").trim().toUpperCase();
    return (stage === "SOFT" || stage === "HARD")
      && String(row && row.canary_verdict || "").trim().toUpperCase() === "READY"
      && row.rollback_ready !== true;
  });
}

function deriveOpenWave({ previousCanary = null, memoryLedger = null } = {}) {
  const previousSummary = previousCanary && previousCanary.summary && typeof previousCanary.summary === "object"
    ? previousCanary.summary
    : {};
  const previousRows = Array.isArray(previousCanary && previousCanary.rows) ? previousCanary.rows : [];
  const memorySummary = memoryLedger && memoryLedger.summary && typeof memoryLedger.summary === "object"
    ? memoryLedger.summary
    : {};
  const currentOpenWave = previousOpenWave(previousCanary);
  const scaleBlockers = [];
  if (previousRows.length > 0 && previousSummary.apply_pass !== true) scaleBlockers.push("PREVIOUS_CANARY_NOT_PASS");
  if (Number(previousSummary.rollback_ready_n || 0) > 0) scaleBlockers.push("PREVIOUS_ROLLBACK_READY");
  if (Number(memorySummary.blocked_candidate_n || 0) > 0) scaleBlockers.push("MEMORY_BLOCKED_CANDIDATES");
  if (Number(memorySummary.rolled_back_n || 0) > 0) scaleBlockers.push("MEMORY_ROLLBACK_HISTORY");
  if (Number(memorySummary.fail_n || 0) > (Number(memorySummary.success_n || 0) + Number(memorySummary.neutral_n || 0))) {
    scaleBlockers.push("MEMORY_FAIL_DOMINANT");
  }

  let openWave = currentOpenWave;
  if (!scaleBlockers.length) {
    if (openWave === 1 && waveHealthy(previousRows, 1)) openWave = 2;
    if (openWave === 2 && waveHealthy(previousRows, 2)) openWave = 3;
  }
  return {
    current_open_wave: currentOpenWave,
    open_wave: openWave,
    scale_allowed: openWave > currentOpenWave,
    scale_block_reason: scaleBlockers[0] || null,
  };
}

function uniqueMarkets(...lists) {
  const set = new Set();
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      const key = String(value || "").trim().toUpperCase();
      if (key) set.add(key);
    }
  }
  return Array.from(set.values()).sort((a, b) => marketWave(a) - marketWave(b) || a.localeCompare(b));
}

function extractExistingStage(previousCanary, market) {
  const rows = Array.isArray(previousCanary && previousCanary.rows) ? previousCanary.rows : [];
  const found = rows.find((row) => String(row && row.market || "").trim().toUpperCase() === String(market || "").trim().toUpperCase());
  return found && String(found.current_stage || "").trim().toUpperCase() || "SHADOW";
}

function findBestValidationForMarket(candidateChangeSet, replayReport, market) {
  const rows = Array.isArray(candidateChangeSet && candidateChangeSet.rows) ? candidateChangeSet.rows : [];
  const validations = Array.isArray(replayReport && replayReport.validations) ? replayReport.validations : [];
  const candidateMap = new Map(rows.map((row) => [String(row && row.candidate_id || "").trim(), row]));
  const marketKey = String(market || "").trim().toUpperCase();
  const scored = validations
    .map((validation) => {
      const candidateId = String(validation && validation.candidate_id || "").trim();
      const candidate = candidateMap.get(candidateId);
      if (!candidate) return null;
      const markets = Array.isArray(candidate.markets) ? candidate.markets.map((row) => String(row || "").trim().toUpperCase()) : [];
      const applies = markets.includes("ALL") || markets.includes(marketKey);
      if (!applies) return null;
      return {
        candidate,
        validation,
        exactMarketScoped: markets.includes(marketKey) && !markets.includes("ALL"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const verdictRank = (row) => {
        const verdict = String(row.validation && row.validation.validation_verdict || "").toUpperCase();
        if (verdict === "PASS") return 3;
        if (verdict === "WARN") return 2;
        if (verdict === "BLOCK") return 1;
        return 0;
      };
      return Number(b.exactMarketScoped === true) - Number(a.exactMarketScoped === true)
        || verdictRank(b) - verdictRank(a)
        || (toNum(b.validation && b.validation.candidate_objective_delta) || -Infinity) - (toNum(a.validation && a.validation.candidate_objective_delta) || -Infinity)
        || String(a.validation && a.validation.candidate_id || "").localeCompare(String(b.validation && b.validation.candidate_id || ""));
    });
  return scored[0] || null;
}

function buildMarketCanaryRows({
  objectiveSupervisor = null,
  candidateChangeSet = null,
  replayReport = null,
  driftCanary = null,
  previousCanary = null,
  memoryLedger = null,
  executionServingContract = null,
  executionScopeTrainRun = null,
} = {}) {
  const servingSummary = readSummary(executionServingContract);
  const scopeTrainSummary = readSummary(executionScopeTrainRun);
  const objective = objectiveSupervisor && objectiveSupervisor.self_evolution_objective && typeof objectiveSupervisor.self_evolution_objective === "object"
    ? objectiveSupervisor.self_evolution_objective
    : {};
  const marketScores = Array.isArray(objective.market_objective_scores) ? objective.market_objective_scores : [];
  const marketScoreMap = new Map(marketScores.map((row) => [String(row && row.market || "").trim().toUpperCase(), row]));
  const marketContracts = Array.isArray(objectiveSupervisor && objectiveSupervisor.best_febt_market_contracts)
    ? objectiveSupervisor.best_febt_market_contracts
    : [];
  const marketContractMap = new Map(marketContracts.map((row) => [String(row && row.market || "").trim().toUpperCase(), row]));
  const shadowSummary = driftCanary && driftCanary.shadow && driftCanary.shadow.summary && typeof driftCanary.shadow.summary === "object"
    ? driftCanary.shadow.summary
    : {};
  const goldenSummary = driftCanary && driftCanary.golden && driftCanary.golden.summary && typeof driftCanary.golden.summary === "object"
    ? driftCanary.golden.summary
    : {};
  const driftShadow = toNum(shadowSummary.drift) || 0;
  const driftGolden = toNum(goldenSummary.drift) || 0;
  const shadowByMarket = resolveDriftByMarket(shadowSummary);
  const goldenByMarket = resolveDriftByMarket(goldenSummary);
  const shadowGlobalDrift = toNum(driftMetaForMarket(shadowByMarket, "GLOBAL").drift) || 0;
  const goldenGlobalDrift = toNum(driftMetaForMarket(goldenByMarket, "GLOBAL").drift) || 0;
  const globalCanaryPass = driftShadow === 0 && driftGolden === 0;
  const waveState = deriveOpenWave({ previousCanary, memoryLedger });
  const preferredModelFamily = norm(servingSummary.preferred_model_family) || "EXECUTION_SCOPE";
  const preferredModelKind = norm(servingSummary.preferred_model_kind || scopeTrainSummary.model_kind);
  const preferredModelArtifactId = norm(servingSummary.preferred_model_artifact_id || scopeTrainSummary.model_artifact_id);
  const preferredTrainRunId = norm(servingSummary.preferred_train_run_id || scopeTrainSummary.train_run_id);
  const preferredExperimentId = norm(servingSummary.experiment_id || scopeTrainSummary.experiment_id);
  const modelBindingReady = servingSummary.shadow_ready === true && Boolean(preferredModelArtifactId);

  const rows = [];
  for (const market of uniqueMarkets(
    marketScores.map((row) => row.market),
    marketContracts.map((row) => row.market),
    Array.isArray(candidateChangeSet && candidateChangeSet.rows)
      ? candidateChangeSet.rows.flatMap((row) => Array.isArray(row.markets) ? row.markets : [])
      : []
  )) {
    const previousStage = extractExistingStage(previousCanary, market);
    const best = findBestValidationForMarket(candidateChangeSet, replayReport, market);
    const marketScore = marketScoreMap.get(market) || null;
    const marketContract = marketContractMap.get(market) || null;
    const replay = best && best.validation || null;
    const candidate = best && best.candidate || null;
    const concentrationRecovery = Boolean(
      candidate
      && (
        candidate.market_concentration_recovery === true
        || String(candidate && candidate.source || "").trim().toUpperCase() === "MARKET_CONCENTRATION_RECOVERY"
        || (Array.isArray(candidate && candidate.risk_flags) && candidate.risk_flags.includes("MARKET_CONCENTRATION_RECOVERY"))
      )
    );
    const concentrationRecoveryPass = concentrationRecovery
      && String(candidate && candidate.target_market || "").trim().toUpperCase() === market
      && toNum(replay && replay.candidate_objective_delta) != null
      && toNum(replay && replay.candidate_objective_delta) >= 1.0;
    const wave = marketWave(market);
    const shadowMarketMeta = driftMetaForMarket(shadowByMarket, market);
    const goldenMarketMeta = driftMetaForMarket(goldenByMarket, market);
    const shadowMarketDrift = toNum(shadowMarketMeta.drift) || 0;
    const goldenMarketDrift = toNum(goldenMarketMeta.drift) || 0;
    const blockers = [];

    if (shadowGlobalDrift > 0) blockers.push("FILTER_CANARY_DRIFT_GLOBAL_SHADOW");
    if (goldenGlobalDrift > 0) blockers.push("FILTER_CANARY_DRIFT_GLOBAL_GOLDEN");
    if (shadowMarketDrift > 0) blockers.push("FILTER_CANARY_DRIFT_MARKET_SHADOW");
    if (goldenMarketDrift > 0) blockers.push("FILTER_CANARY_DRIFT_MARKET_GOLDEN");
    if (!candidate || !replay) blockers.push("SELF_EVOLUTION_REPLAY_MISSING");
    if (candidate && replay && String(replay.validation_verdict || "").toUpperCase() !== "PASS") blockers.push("SELF_EVOLUTION_REPLAY_NOT_PASS");
    if (wave > waveState.open_wave) blockers.push("WAVE_NOT_OPEN");
    if (marketContract && String(marketContract.mode || "").toUpperCase() !== "NORMAL") blockers.push("MARKET_CONTRACT_BLOCK");
    if (marketContract && marketContract.tightening_allowed === false && String(candidate && candidate.direction || "").toUpperCase() === "TIGHTEN") blockers.push("COUNT_GUARD_ACTIVE");
    if (marketContract && marketContract.recovery_priority === true && String(candidate && candidate.direction || "").toUpperCase() === "TIGHTEN") blockers.push("RECOVERY_PRIORITY_ACTIVE");
    if (marketScore && marketScore.constraints && marketScore.constraints.count_floor_pass === false) blockers.push("OBJECTIVE_COUNT_BLOCK");
    if (marketScore && marketScore.constraints && marketScore.constraints.replacement_floor_pass === false) blockers.push("OBJECTIVE_REPLACEMENT_BLOCK");
    if (marketScore && marketScore.constraints && marketScore.constraints.latency_budget_pass === false) blockers.push("OBJECTIVE_LATENCY_BLOCK");
    if (marketScore && toNum(marketScore.objective_score) != null && toNum(marketScore.objective_score) < 0 && !concentrationRecoveryPass) {
      blockers.push("OBJECTIVE_SCORE_NEGATIVE");
    }

    const currentStageRaw = String(previousStage || "SHADOW").toUpperCase();
    const currentStage = ["SHADOW", "SOFT", "HARD"].includes(currentStageRaw) ? currentStageRaw : "SHADOW";
    let nextStage = currentStage;
    let canaryAction = "KEEP";
    let rollbackReady = false;

    const replayMarketDelta = findReplayMarketDelta(replay, market);
    const effectiveReplayDelta = toNum(replayMarketDelta && replayMarketDelta.candidate_objective_delta) != null
      ? toNum(replayMarketDelta && replayMarketDelta.candidate_objective_delta)
      : toNum(replay && replay.candidate_objective_delta);
    const baseEligible = blockers.length === 0;
    if (currentStage === "SHADOW" && baseEligible) {
      nextStage = "SOFT";
      canaryAction = "PROMOTE_SOFT";
    } else if (currentStage === "SOFT" && baseEligible && effectiveReplayDelta != null && effectiveReplayDelta >= 1.0 && toNum(marketScore && marketScore.objective_score) != null && toNum(marketScore && marketScore.objective_score) >= 0) {
      nextStage = "HARD";
      canaryAction = "PROMOTE_HARD";
    } else if (currentStage !== "SHADOW" && blockers.length) {
      nextStage = "SHADOW";
      canaryAction = "AUTO_ROLLBACK";
      rollbackReady = true;
    }

    rows.push({
      market,
      wave,
      previous_stage: currentStage,
      current_stage: nextStage,
      canary_action: canaryAction,
      rollback_ready: rollbackReady,
      canary_verdict: rollbackReady ? "ROLLBACK_READY" : (blockers.length ? "BLOCK" : "READY"),
      candidate_id: String(candidate && candidate.candidate_id || "").trim() || null,
      candidate_scope: String(candidate && candidate.scope || "").trim() || null,
      replay_verdict: String(replay && replay.validation_verdict || "").trim() || null,
      replay_delta: effectiveReplayDelta,
      replay_delta_global: toNum(replay && replay.candidate_objective_delta),
      replay_delta_market: toNum(replayMarketDelta && replayMarketDelta.candidate_objective_delta),
      objective_score: toNum(marketScore && marketScore.objective_score),
      projected_count_ratio_global: toNum(marketScore && marketScore.projected_count_ratio_global),
      projected_replacement_ratio: toNum(marketScore && marketScore.projected_replacement_ratio),
      market_contract_mode: String(marketContract && marketContract.mode || "N/A"),
      tightening_allowed: marketContract ? marketContract.tightening_allowed !== false : null,
      recovery_priority: marketContract ? marketContract.recovery_priority === true : null,
      fire_n: toNum(marketContract && marketContract.fire_n),
      late_n: toNum(marketContract && marketContract.late_n),
      disagreement_n: toNum(marketContract && marketContract.disagreement_n),
      dominant_disagreement_reason: String(marketContract && marketContract.dominant_disagreement_reason || "").trim() || null,
      drift_shadow_market: shadowMarketDrift,
      drift_golden_market: goldenMarketDrift,
      drift_shadow_global: shadowGlobalDrift,
      drift_golden_global: goldenGlobalDrift,
      drift_shadow_stages: driftStageList(shadowMarketMeta),
      drift_golden_stages: driftStageList(goldenMarketMeta),
      concentration_recovery: concentrationRecovery,
      model_family: modelBindingReady ? preferredModelFamily : null,
      model_kind: modelBindingReady ? preferredModelKind : null,
      model_artifact_id: modelBindingReady ? preferredModelArtifactId : null,
      train_run_id: modelBindingReady ? preferredTrainRunId : null,
      experiment_id: modelBindingReady ? preferredExperimentId : null,
      blockers,
    });
  }

  const readyRows = rows.filter((row) => row.canary_verdict === "READY");
  const rollbackRows = rows.filter((row) => row.rollback_ready === true);
  const topShadowDriftMarket = rows
    .slice()
    .sort((a, b) => (Number(b.drift_shadow_market || 0) - Number(a.drift_shadow_market || 0)) || String(a.market || "").localeCompare(String(b.market || "")))[0] || null;
  const topGoldenDriftMarket = rows
    .slice()
    .sort((a, b) => (Number(b.drift_golden_market || 0) - Number(a.drift_golden_market || 0)) || String(a.market || "").localeCompare(String(b.market || "")))[0] || null;
  return {
    summary: {
      total_n: rows.length,
      shadow_n: rows.filter((row) => row.current_stage === "SHADOW").length,
      soft_n: rows.filter((row) => row.current_stage === "SOFT").length,
      hard_n: rows.filter((row) => row.current_stage === "HARD").length,
      ready_n: readyRows.length,
      blocked_n: rows.filter((row) => row.canary_verdict === "BLOCK").length,
      rollback_ready_n: rollbackRows.length,
      apply_pass: readyRows.some((row) => row.wave === 1 && (row.current_stage === "SOFT" || row.current_stage === "HARD")),
      global_canary_pass: globalCanaryPass,
      shadow_global_drift: shadowGlobalDrift,
      golden_global_drift: goldenGlobalDrift,
      current_open_wave: waveState.current_open_wave,
      open_wave: waveState.open_wave,
      scale_allowed: waveState.scale_allowed,
      scale_block_reason: waveState.scale_block_reason,
      next_wave_candidate: waveState.open_wave < 3 ? waveState.open_wave + 1 : null,
      top_ready_market: readyRows[0] ? readyRows[0].market : null,
      top_rollback_market: rollbackRows[0] ? rollbackRows[0].market : null,
      top_shadow_drift_market: topShadowDriftMarket && Number(topShadowDriftMarket.drift_shadow_market || 0) > 0 ? topShadowDriftMarket.market : null,
      top_golden_drift_market: topGoldenDriftMarket && Number(topGoldenDriftMarket.drift_golden_market || 0) > 0 ? topGoldenDriftMarket.market : null,
      model_binding_source: modelBindingReady ? "EXECUTION_SERVING_CONTRACT" : "NONE",
      model_family: modelBindingReady ? preferredModelFamily : null,
      model_kind: modelBindingReady ? preferredModelKind : null,
      model_artifact_id: modelBindingReady ? preferredModelArtifactId : null,
      train_run_id: modelBindingReady ? preferredTrainRunId : null,
      experiment_id: modelBindingReady ? preferredExperimentId : null,
    },
    rows,
  };
}

module.exports = {
  buildMarketCanaryRows,
  marketWave,
  unwrapRawReport,
  __test: {
    deriveOpenWave,
    extractExistingStage,
    findBestValidationForMarket,
    waveHealthy,
  },
};
