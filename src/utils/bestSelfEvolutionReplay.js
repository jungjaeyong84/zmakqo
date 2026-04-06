"use strict";

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

function hasFlag(candidate, flag) {
  return Array.isArray(candidate && candidate.risk_flags) && candidate.risk_flags.includes(flag);
}

function hasOnlyBlocker(blockers = [], expected = "") {
  const rows = Array.isArray(blockers) ? blockers : [];
  return rows.length === 1 && String(rows[0] || "").trim().toUpperCase() === String(expected || "").trim().toUpperCase();
}

function ratio(numerator, denominator) {
  const num = Number(numerator);
  const den = Number(denominator);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return num / den;
}

function isExecutedLike(row) {
  const kind = String(row && row.source_row_type || "").trim().toUpperCase();
  return kind === "EXECUTED" || kind === "PARTIAL" || kind === "FALLBACK";
}

function isDropLike(row) {
  const kind = String(row && row.source_row_type || "").trim().toUpperCase();
  return kind === "DROP" || kind === "MISSED" || kind === "REJECTED";
}

function isEntryLikeEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  return !ev.startsWith("EXIT_");
}

function normalizeMarkets(candidate = {}) {
  const rows = Array.isArray(candidate.markets) ? candidate.markets : [];
  const out = rows.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean);
  return out.length ? out : ["ALL"];
}

function rowInCandidateMarket(row, candidate) {
  const markets = normalizeMarkets(candidate);
  if (markets.includes("ALL")) return true;
  const market = String(row && row.market || "").trim().toUpperCase();
  return market && markets.includes(market);
}

function candidateChangeKeys(candidate = {}) {
  return (Array.isArray(candidate.changes) ? candidate.changes : [])
    .map((row) => String(row && row.key || "").trim().toUpperCase())
    .filter(Boolean);
}

function effectiveChangeDirections(candidate = {}) {
  const rows = Array.isArray(candidate && candidate.changes) ? candidate.changes : [];
  const out = new Set();
  for (const row of rows) {
    const explicit = String(row && row.direction || "").trim().toUpperCase();
    const current = toNum(row && row.current);
    const next = toNum(row && row.next);
    if (explicit === "TIGHTEN" || explicit === "LOOSEN") {
      out.add(explicit);
      continue;
    }
    if (current != null && next != null && current !== next) {
      const inferred = explicit === "SHIFT"
        ? resolveDirectionalChange(row && row.key, current, next)
        : null;
      if (inferred) out.add(inferred);
    }
  }
  return out;
}

function resolveDirectionalChange(key, current, next) {
  const curr = toNum(current);
  const nxt = toNum(next);
  if (curr == null || nxt == null || curr === nxt) return null;
  const keyUpper = String(key || "").trim().toUpperCase();
  const isMaxLike = keyUpper.includes("_MAX") || keyUpper.includes("KILL");
  if (nxt > curr) return isMaxLike ? "LOOSEN" : "TIGHTEN";
  return isMaxLike ? "TIGHTEN" : "LOOSEN";
}

function matchesKeyFamily(keys = [], token) {
  return keys.some((row) => row.includes(token));
}

function candidateTargetsRow(candidate = {}, row = {}) {
  if (!rowInCandidateMarket(row, candidate)) return false;

  const scope = String(candidate.scope || "UNKNOWN").trim().toUpperCase();
  const keys = candidateChangeKeys(candidate);
  const event = String(row.event || "").trim().toUpperCase();
  const dropStage = String(row.drop_stage_key || "").trim().toUpperCase();
  const dropReason = String(row.drop_reason || "").trim().toUpperCase();
  const waitVerdict = String(row.wait_verdict || "").trim().toUpperCase();
  const evVerdict = String(row.ev_verdict || "").trim().toUpperCase();
  const qualityVerdict = String(row.quality_verdict || "").trim().toUpperCase();
  const febtPhase = String(row.febt_phase || "").trim().toUpperCase();
  const entryGrade = String(row.entry_grade || "").trim().toUpperCase();

  if (scope === "WAIT") {
    return (
      dropStage === "TIMING"
      || waitVerdict === "DROP"
      || (isExecutedLike(row) && (waitVerdict === "ALLOW" || febtPhase === "LATE" || febtPhase === "FIRE"))
    );
  }

  if (scope === "EV") {
    return (
      dropStage === "EV"
      || evVerdict === "DROP"
      || (isExecutedLike(row) && evVerdict === "ALLOW")
    );
  }

  if (scope === "AI") {
    return dropStage === "AI" || qualityVerdict === "DROP" || isExecutedLike(row);
  }

  if (scope === "ML") {
    if (matchesKeyFamily(keys, "CORE")) return entryGrade === "CORE" || event.includes("CORE_");
    if (matchesKeyFamily(keys, "EARLY")) return entryGrade === "EARLY" || event.includes("EARLY_");
    if (matchesKeyFamily(keys, "REGIME")) return dropReason.includes("REGIME") || isExecutedLike(row);
    if (matchesKeyFamily(keys, "CONF")) return dropReason.includes("CONF") || isExecutedLike(row);
    if (matchesKeyFamily(keys, "SCORE")) return dropReason.includes("SCORE") || isExecutedLike(row);
    return dropStage === "QUALITY" || isExecutedLike(row);
  }

  if (scope === "PINE") {
    if (!isEntryLikeEvent(event)) return false;
    if (matchesKeyFamily(keys, "REGIME")) return dropReason.includes("REGIME") || isExecutedLike(row);
    if (matchesKeyFamily(keys, "CONF")) return dropReason.includes("CONF") || isExecutedLike(row);
    if (matchesKeyFamily(keys, "SCORE")) return dropReason.includes("SCORE") || isExecutedLike(row);
    return true;
  }

  return false;
}

function deriveCohortMetrics(rows = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  const executedRows = scoped.filter(isExecutedLike);
  const realizedRows = executedRows.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  const fireRealized = realizedRows.filter((row) => String(row.febt_phase || "").trim().toUpperCase() === "FIRE");

  const avgRetNet = realizedRows.length
    ? realizedRows.reduce((acc, row) => acc + Number(row.realized_ret_net || 0), 0) / realizedRows.length
    : null;
  const winRate = ratio(realizedRows.filter((row) => Number(row.realized_ret_net) > 0).length, realizedRows.length);
  const tp1FirstRate = ratio(realizedRows.filter((row) => row.tp1_first === true).length, realizedRows.length);
  const fireWinRate = ratio(fireRealized.filter((row) => Number(row.realized_ret_net) > 0).length, fireRealized.length);

  return {
    rows_n: scoped.length,
    executed_n: executedRows.length,
    realized_n: realizedRows.length,
    avg_ret_net: avgRetNet,
    win_rate: winRate,
    tp1_first_rate: tp1FirstRate,
    fire_win_rate: fireWinRate,
  };
}

function deriveMarketCohortMetrics(rows = [], markets = []) {
  const targetMarkets = Array.isArray(markets)
    ? markets.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const marketSet = new Set(targetMarkets.includes("ALL")
    ? Array.from(new Set((Array.isArray(rows) ? rows : []).map((row) => String(row && row.market || "").trim().toUpperCase()).filter(Boolean)))
    : targetMarkets);
  const out = [];
  for (const market of marketSet) {
    const scoped = (Array.isArray(rows) ? rows : []).filter((row) => String(row && row.market || "").trim().toUpperCase() === market);
    out.push({ market, ...deriveCohortMetrics(scoped) });
  }
  return out;
}

function deltaOrZero(after, before) {
  const a = toNum(after);
  const b = toNum(before);
  if (a == null || b == null) return 0;
  return a - b;
}

function buildHistoricalReplayDelta(beforeMetrics, afterMetrics) {
  const executedBefore = Number(beforeMetrics.executed_n || 0);
  const executedAfter = Number(afterMetrics.executed_n || 0);
  const countRatio = executedBefore > 0 ? (executedAfter / executedBefore) : null;

  const delta =
    clamp(deltaOrZero(afterMetrics.avg_ret_net, beforeMetrics.avg_ret_net) * 100, -4, 4)
    + clamp(deltaOrZero(afterMetrics.win_rate, beforeMetrics.win_rate) * 6, -3, 3)
    + clamp(deltaOrZero(afterMetrics.tp1_first_rate, beforeMetrics.tp1_first_rate) * 5, -2.5, 2.5)
    + clamp(deltaOrZero(afterMetrics.fire_win_rate, beforeMetrics.fire_win_rate) * 4, -2, 2)
    + (countRatio == null ? 0 : clamp((countRatio - 1) * 6, -3, 1.5));

  return {
    candidate_objective_delta: Number(delta.toFixed(4)),
    count_delta: countRatio == null ? null : Number((countRatio - 1).toFixed(4)),
    replacement_delta: null,
    avg_ret_net_delta: Number(deltaOrZero(afterMetrics.avg_ret_net, beforeMetrics.avg_ret_net).toFixed(4)),
  };
}

function deriveMarketReplayDeltas(candidate = {}, beforeRows = [], afterRows = []) {
  return deriveMarketCohortMetrics(beforeRows, normalizeMarkets(candidate))
    .map((beforeRow) => {
      const afterRow = deriveMarketCohortMetrics(afterRows, [beforeRow.market])[0] || { market: beforeRow.market };
      const marketDelta = buildHistoricalReplayDelta(beforeRow, afterRow);
      return {
        market: beforeRow.market,
        candidate_objective_delta: marketDelta.candidate_objective_delta,
        count_delta: marketDelta.count_delta,
        replacement_delta: marketDelta.replacement_delta,
        avg_ret_net_delta: marketDelta.avg_ret_net_delta,
        before_metrics: beforeRow,
        after_metrics: afterRow,
      };
    });
}

function buildHistoricalReplayRows(candidate = {}, dataset = null) {
  const rows = Array.isArray(dataset && dataset.rows) ? dataset.rows : [];
  const direction = String(candidate.direction || "SHIFT").trim().toUpperCase();
  const effectiveDirections = effectiveChangeDirections(candidate);
  const applyTighten = direction === "TIGHTEN" || (direction === "SHIFT" && effectiveDirections.has("TIGHTEN"));
  const applyLoosen = direction === "LOOSEN" || (direction === "SHIFT" && effectiveDirections.has("LOOSEN"));
  const blockers = [];
  const matchedRows = rows.filter((row) => candidateTargetsRow(candidate, row));
  const matchedExecutedRealized = matchedRows.filter((row) => isExecutedLike(row) && Number.isFinite(toNum(row.realized_ret_net)));
  const matchedDropRealized = matchedRows.filter((row) => isDropLike(row) && Number.isFinite(toNum(row.realized_ret_net)));

  let replayRows = rows.slice();
  let historicalAppliedN = 0;

  if (applyTighten && !applyLoosen) {
    const removable = matchedExecutedRealized.filter((row) => Number(row.realized_ret_net) <= 0);
    historicalAppliedN = removable.length;
    if (!historicalAppliedN) blockers.push("NO_HISTORICAL_TIGHTEN_MATCH");
    const removeKeys = new Set(removable.map((row) => String(row.signal_key || row.signal_id || "")));
    replayRows = rows.filter((row) => !removeKeys.has(String(row.signal_key || row.signal_id || "")));
  } else if (applyLoosen && !applyTighten) {
    const addable = matchedDropRealized.map((row) => ({
      ...row,
      source_row_type: "EXECUTED",
    }));
    historicalAppliedN = addable.length;
    if (!historicalAppliedN) blockers.push("NO_REALIZED_COUNTERFACTUAL");
    replayRows = rows.concat(addable);
  } else if (applyLoosen && applyTighten) {
    const removable = matchedExecutedRealized.filter((row) => Number(row.realized_ret_net) <= 0);
    const removeKeys = new Set(removable.map((row) => String(row.signal_key || row.signal_id || "")));
    const baseRows = rows.filter((row) => !removeKeys.has(String(row.signal_key || row.signal_id || "")));
    const addable = matchedDropRealized.map((row) => ({
      ...row,
      source_row_type: "EXECUTED",
    }));
    historicalAppliedN = removable.length + addable.length;
    if (!historicalAppliedN) blockers.push("NO_EFFECT_CHANGESET");
    replayRows = baseRows.concat(addable);
  } else {
    blockers.push("NO_EFFECT_CHANGESET");
  }

  return {
    replay_rows: replayRows,
    historical_matched_n: matchedRows.length,
    historical_realized_match_n: matchedExecutedRealized.length + matchedDropRealized.length,
    historical_applied_n: historicalAppliedN,
    blockers,
  };
}

function deriveCandidateObjectiveDelta(candidate = {}, context = {}) {
  const objective = context.objective || {};
  const dataset = context.dataset || {};
  const datasetRows = Array.isArray(dataset && dataset.rows) ? dataset.rows : [];
  const currentObjectiveScore = toNum(objective.objective_score) || 0;
  const countFloorPass = objective.count_floor_pass !== false;
  const replacementFloorPass = objective.replacement_floor_pass !== false;
  const latencyBudgetPass = objective.latency_budget_pass !== false;
  const direction = String(candidate.direction || "SHIFT").toUpperCase();
  const scope = String(candidate.scope || "UNKNOWN").toUpperCase();
  const blockers = [];

  if (hasFlag(candidate, "MEMORY_BLOCKED")) blockers.push("SELF_EVOLUTION_MEMORY_BLOCK");
  if (hasFlag(candidate, "FAILED_FINGERPRINT_REPEAT")) blockers.push("SELF_EVOLUTION_FINGERPRINT_REPEAT");
  if (hasFlag(candidate, "BLOCKED_SOURCE_ACTION")) blockers.push("BLOCKED_SOURCE_ACTION");
  if (hasFlag(candidate, "COUNT_GUARD_ACTIVE") && direction === "TIGHTEN") blockers.push("COUNT_GUARD_ACTIVE");
  if (hasFlag(candidate, "RECOVERY_PRIORITY_ACTIVE") && direction === "TIGHTEN") blockers.push("RECOVERY_PRIORITY_ACTIVE");
  if (!countFloorPass && direction === "TIGHTEN") blockers.push("SELF_EVOLUTION_COUNT_FLOOR_FAIL");
  if (!replacementFloorPass && direction === "TIGHTEN") blockers.push("SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL");
  if (!latencyBudgetPass) blockers.push("SELF_EVOLUTION_LATENCY_BUDGET_FAIL");

  const beforeMetrics = deriveCohortMetrics(datasetRows);
  if (blockers.length) {
    return {
      validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
      candidate_id: candidate.candidate_id || null,
      display_candidate_id: candidate.canonical_candidate_id || candidate.display_candidate_id || candidate.candidate_id || null,
      canonical_candidate_id: candidate.canonical_candidate_id || candidate.display_candidate_id || candidate.candidate_id || null,
      scope,
      direction,
      ev_policy_review_mode: candidate.ev_policy_review_mode || null,
      ev_profile_review_target_n: toNum(candidate.ev_profile_review_target_n),
      ev_profile_review_targets: Array.isArray(candidate.ev_profile_review_targets) ? candidate.ev_profile_review_targets.slice() : [],
      ev_profile_top_return_drag_profile: candidate.ev_profile_top_return_drag_profile || null,
      ev_profile_top_return_drag_driver: candidate.ev_profile_top_return_drag_driver || null,
      ev_profile_top_mixed_profile: candidate.ev_profile_top_mixed_profile || null,
      ev_profile_top_mixed_driver: candidate.ev_profile_top_mixed_driver || null,
      current_objective_score: Number(currentObjectiveScore.toFixed(4)),
      candidate_objective_delta: 0,
      count_delta: 0,
      replacement_delta: null,
      avg_ret_net_delta: 0,
      projected_objective_score: Number(currentObjectiveScore.toFixed(4)),
      validation_verdict: "BLOCK",
      blockers,
      risk_flags: Array.isArray(candidate.risk_flags) ? candidate.risk_flags.slice() : [],
      count_guard_effect: candidate.count_guard_effect || null,
      replacement_effect: candidate.replacement_effect || null,
      market_objective_deltas: deriveMarketReplayDeltas(candidate, datasetRows, datasetRows),
      historical_match_n: 0,
      historical_realized_match_n: 0,
      historical_applied_n: 0,
      before_metrics: beforeMetrics,
      after_metrics: beforeMetrics,
      summary: String(candidate.evidence && candidate.evidence.rationale || candidate.status || "N/A"),
    };
  }

  const replay = buildHistoricalReplayRows(candidate, dataset);
  blockers.push(...replay.blockers);
  const afterMetrics = deriveCohortMetrics(replay.replay_rows);
  const replayDelta = buildHistoricalReplayDelta(beforeMetrics, afterMetrics);
  const marketReplayDeltas = deriveMarketReplayDeltas(candidate, datasetRows, replay.replay_rows);
  const shadowCounterfactualMissing =
    hasFlag(candidate, "EV_SHADOW_FALLBACK")
    && hasOnlyBlocker(blockers, "NO_REALIZED_COUNTERFACTUAL");

  let validationVerdict = "WARN";
  if (blockers.length) validationVerdict = shadowCounterfactualMissing ? "WARN" : "BLOCK";
  else if (replayDelta.candidate_objective_delta >= 0.25) validationVerdict = "PASS";
  else if (replayDelta.candidate_objective_delta <= -0.25) validationVerdict = "BLOCK";

  return {
    validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
    candidate_id: candidate.candidate_id || null,
    display_candidate_id: candidate.canonical_candidate_id || candidate.display_candidate_id || candidate.candidate_id || null,
    canonical_candidate_id: candidate.canonical_candidate_id || candidate.display_candidate_id || candidate.candidate_id || null,
    scope,
    direction,
    ev_policy_review_mode: candidate.ev_policy_review_mode || null,
    ev_profile_review_target_n: toNum(candidate.ev_profile_review_target_n),
    ev_profile_review_targets: Array.isArray(candidate.ev_profile_review_targets) ? candidate.ev_profile_review_targets.slice() : [],
    ev_profile_top_return_drag_profile: candidate.ev_profile_top_return_drag_profile || null,
    ev_profile_top_return_drag_driver: candidate.ev_profile_top_return_drag_driver || null,
    ev_profile_top_mixed_profile: candidate.ev_profile_top_mixed_profile || null,
    ev_profile_top_mixed_driver: candidate.ev_profile_top_mixed_driver || null,
    current_objective_score: Number(currentObjectiveScore.toFixed(4)),
    candidate_objective_delta: replayDelta.candidate_objective_delta,
    count_delta: replayDelta.count_delta,
    replacement_delta: replayDelta.replacement_delta,
    avg_ret_net_delta: replayDelta.avg_ret_net_delta,
    projected_objective_score: Number((currentObjectiveScore + replayDelta.candidate_objective_delta).toFixed(4)),
    validation_verdict: validationVerdict,
    blockers: shadowCounterfactualMissing ? ["SHADOW_COUNTERFACTUAL_MISSING"] : blockers,
    risk_flags: Array.isArray(candidate.risk_flags) ? candidate.risk_flags.slice() : [],
    count_guard_effect: candidate.count_guard_effect || null,
    replacement_effect: candidate.replacement_effect || null,
    market_objective_deltas: marketReplayDeltas,
    historical_match_n: replay.historical_matched_n,
    historical_realized_match_n: replay.historical_realized_match_n,
    historical_applied_n: replay.historical_applied_n,
    before_metrics: beforeMetrics,
    after_metrics: afterMetrics,
    summary: shadowCounterfactualMissing
      ? `shadow fallback pending counterfactual / ${String(candidate.evidence && candidate.evidence.rationale || candidate.status || "N/A")}`
      : String(candidate.evidence && candidate.evidence.rationale || candidate.status || "N/A"),
  };
}

function buildReplayValidationReport({ candidateChangeSet = null, objective = null, attribution = null, dataset = null } = {}) {
  const rows = Array.isArray(candidateChangeSet && candidateChangeSet.rows) ? candidateChangeSet.rows : [];
  const objectiveSummary = objective && typeof objective === "object" ? objective : {};
  const datasetSummary = dataset && typeof dataset === "object" ? dataset : {};
  const validations = rows.map((row) => deriveCandidateObjectiveDelta(row, {
    objective: objectiveSummary,
    attribution,
    dataset: datasetSummary,
  }));
  validations.sort((a, b) =>
    ((b.candidate_objective_delta || -Infinity) - (a.candidate_objective_delta || -Infinity))
    || String(a.candidate_id || "").localeCompare(String(b.candidate_id || ""))
  );
  const passN = validations.filter((row) => row.validation_verdict === "PASS").length;
  const warnN = validations.filter((row) => row.validation_verdict === "WARN").length;
  const blockN = validations.filter((row) => row.validation_verdict === "BLOCK").length;
  const best = validations[0] || null;
  return {
    validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
    summary: {
      total_n: validations.length,
      pass_n: passN,
      warn_n: warnN,
      block_n: blockN,
      best_candidate_id: best && best.candidate_id || null,
      best_verdict: best && best.validation_verdict || null,
      best_objective_delta: best && best.candidate_objective_delta != null ? best.candidate_objective_delta : null,
    },
    validations,
  };
}

module.exports = {
  deriveCandidateObjectiveDelta,
  buildReplayValidationReport,
  __test: {
    candidateTargetsRow,
    deriveCohortMetrics,
    buildHistoricalReplayRows,
  },
};
