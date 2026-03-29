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

function mean(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

function sum(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((acc, n) => acc + n, 0);
}

function ratio(numerator, denominator) {
  const num = Number(numerator);
  const den = Number(denominator);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return num / den;
}

function countBy(items = [], keyFn) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(keyFn(item) || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

function normalizeMarket(row) {
  return String(row && row.market || "").trim().toUpperCase() || "UNKNOWN";
}

function normalizeLayer(row) {
  return String(row && row.drop_stage_key || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
}

function normalizeReason(row) {
  return String(
    row && (row.drop_reason || row.fallback_reason || row.chain_first_exit_kind || row.source_row_type)
    || "UNKNOWN"
  ).trim().toUpperCase() || "UNKNOWN";
}

function deriveConstraintFlags({
  projectedCountRatioGlobal = null,
  projectedReplacementRatio = null,
  latencyP95Ms = null,
  latencyBudgetMs = 1500,
} = {}) {
  const countRatio = toNum(projectedCountRatioGlobal);
  const replacementRatio = toNum(projectedReplacementRatio);
  const latencyP95 = toNum(latencyP95Ms);
  const budget = Number.isFinite(Number(latencyBudgetMs)) ? Number(latencyBudgetMs) : 1500;
  return {
    count_floor_pass: countRatio == null ? null : countRatio >= 1.0,
    replacement_floor_pass: replacementRatio == null ? null : replacementRatio >= 0.80,
    latency_budget_pass: latencyP95 == null ? null : latencyP95 <= budget,
  };
}

function deriveObjectiveScore({
  monthlyRunRateKrw = null,
  minMonthlyNetKrw = 1500000,
  avgRetNet = null,
  winRate = null,
  projectedCountRatioGlobal = null,
  projectedReplacementRatio = null,
  tp1FirstRate = null,
  fireWinRate = null,
  webhookToFillP95Ms = null,
  duplicateCount = 0,
  rejectCount = 0,
  disagreementRate = null,
  fallbackRate = null,
  missingRate = null,
  monthlyPass = null,
  objectivePass = null,
} = {}) {
  const monthlyRun = toNum(monthlyRunRateKrw);
  const monthlyTarget = Number.isFinite(Number(minMonthlyNetKrw)) && Number(minMonthlyNetKrw) > 0
    ? Number(minMonthlyNetKrw)
    : 1500000;
  const avgRet = toNum(avgRetNet);
  const win = toNum(winRate);
  const countRatio = toNum(projectedCountRatioGlobal);
  const replacementRatio = toNum(projectedReplacementRatio);
  const tp1Rate = toNum(tp1FirstRate);
  const fireRate = toNum(fireWinRate);
  const latencyP95 = toNum(webhookToFillP95Ms);
  const disagreement = toNum(disagreementRate);
  const fallback = toNum(fallbackRate);
  const missing = toNum(missingRate);

  const profitScore =
    (monthlyRun == null ? 0 : clamp(monthlyRun / monthlyTarget, -1.5, 2.0) * 2.0)
    + (avgRet == null ? 0 : clamp(avgRet * 100, -2.0, 2.0))
    + (win == null ? 0 : clamp((win - 0.5) * 10, -1.0, 1.0));
  const countScore = countRatio == null
    ? 0
    : (countRatio >= 1.0
      ? 2 + clamp((countRatio - 1.0) * 5, 0, 1.0)
      : -clamp((1.0 - countRatio) * 20, 0, 4.0));
  const replacementScore = replacementRatio == null
    ? 0
    : clamp((replacementRatio - 0.5) * 4, -1.0, 2.0);
  const tp1Score =
    (tp1Rate == null ? 0 : clamp((tp1Rate - 0.5) * 6, -1.0, 1.5))
    + (fireRate == null ? 0 : clamp((fireRate - 0.5) * 6, -1.0, 1.5));

  const drawdownPenalty =
    (monthlyPass === false ? 2.0 : 0)
    + (objectivePass === false ? 2.0 : 0)
    + (avgRet != null && avgRet < 0 ? clamp(Math.abs(avgRet) * 100, 0, 2.0) : 0);
  const latencyPenalty =
    (latencyP95 == null ? 0 : clamp((latencyP95 - 1500) / 1000, 0, 3.0))
    + clamp(Number(duplicateCount || 0) * 0.1, 0, 1.5)
    + clamp(Number(rejectCount || 0) * 0.1, 0, 1.5);
  const instabilityPenalty =
    (disagreement == null ? 0 : clamp(disagreement * 3, 0, 2.0))
    + (fallback == null ? 0 : clamp(fallback * 2, 0, 1.5))
    + (missing == null ? 0 : clamp(missing * 4, 0, 2.0));

  const objectiveScore = profitScore + countScore + replacementScore + tp1Score - drawdownPenalty - latencyPenalty - instabilityPenalty;
  return {
    objective_score: Number(objectiveScore.toFixed(4)),
    components: {
      profit_score: Number(profitScore.toFixed(4)),
      count_score: Number(countScore.toFixed(4)),
      replacement_score: Number(replacementScore.toFixed(4)),
      tp1_score: Number(tp1Score.toFixed(4)),
      drawdown_penalty: Number(drawdownPenalty.toFixed(4)),
      latency_penalty: Number(latencyPenalty.toFixed(4)),
      instability_penalty: Number(instabilityPenalty.toFixed(4)),
    },
    constraints: deriveConstraintFlags({
      projectedCountRatioGlobal: countRatio,
      projectedReplacementRatio: replacementRatio,
      latencyP95Ms: latencyP95,
    }),
  };
}

function deriveDatasetObjectiveScore({
  dataset = null,
  governance = null,
  phase0 = null,
  tuningContract = null,
} = {}) {
  const summary = dataset && dataset.summary && typeof dataset.summary === "object" ? dataset.summary : {};
  const rows = Array.isArray(dataset && dataset.rows) ? dataset.rows : [];
  const executedRows = rows.filter((row) => row.source_row_type === "EXECUTED" || row.source_row_type === "PARTIAL" || row.source_row_type === "FALLBACK");
  const fireRows = executedRows.filter((row) => String(row.febt_phase || "").toUpperCase() === "FIRE");
  const realizedRows = executedRows.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  const fireRealized = fireRows.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  const executedRowsWithFeatures = executedRows.filter((row) => row.features_json && typeof row.features_json === "object");
  const cohortExecutedN = executedRows.length;
  const cohortRealizedN = realizedRows.length;
  const strictExecutedN = toNum(summary.executed_n) || 0;
  const partialN = toNum(summary.partial_n) || 0;
  const fallbackN = toNum(summary.fallback_n) || 0;
  const datasetAvgRet = mean(realizedRows.map((row) => row.realized_ret_net));
  const datasetWinRate = ratio(realizedRows.filter((row) => Number(row.realized_ret_net) > 0).length, cohortRealizedN);
  const executedMissingRate = cohortExecutedN > 0
    ? (1 - (executedRowsWithFeatures.length / cohortExecutedN))
    : null;

  const overall = governance && governance.current && governance.current.overall && typeof governance.current.overall === "object"
    ? governance.current.overall
    : {};
  const objective = governance && governance.current && governance.current.objective && typeof governance.current.objective === "object"
    ? governance.current.objective
    : {};
  const objectiveCfg = governance && governance.objective && typeof governance.objective === "object"
    ? governance.objective
    : {};
  const phase0Baseline = phase0 && phase0.legacy_wait_baseline && typeof phase0.legacy_wait_baseline === "object"
    ? phase0.legacy_wait_baseline
    : {};
  const phase0Latency = phase0 && phase0.bridge_latency && typeof phase0.bridge_latency === "object"
    ? phase0.bridge_latency
    : {};

  const disagreementRate = ratio(
    tuningContract && tuningContract.disagreement_n,
    tuningContract && tuningContract.fire_n != null && tuningContract.late_n != null && tuningContract.void_n != null
      ? (Number(tuningContract.fire_n || 0) + Number(tuningContract.late_n || 0) + Number(tuningContract.void_n || 0))
      : cohortExecutedN
  );
  const fallbackRate = ratio(tuningContract && tuningContract.fallback_legacy_n, cohortExecutedN);
  const score = deriveObjectiveScore({
    monthlyRunRateKrw: toNum(objective.monthly_run_rate_krw),
    minMonthlyNetKrw: toNum(objectiveCfg.min_monthly_net_krw) || 1500000,
    avgRetNet: datasetAvgRet ?? toNum(summary.avg_realized_ret_net) ?? toNum(overall.avg_ret_net),
    winRate: datasetWinRate ?? toNum(overall.win_rate),
    projectedCountRatioGlobal: toNum(tuningContract && tuningContract.projected_count_ratio_global),
    projectedReplacementRatio: toNum(tuningContract && tuningContract.projected_replacement_ratio),
    tp1FirstRate: ratio(realizedRows.filter((row) => row.tp1_first === true).length, realizedRows.length)
      ?? toNum(phase0Baseline.immediate_win_rate),
    fireWinRate: ratio(fireRealized.filter((row) => Number(row.realized_ret_net) > 0).length, fireRealized.length),
    webhookToFillP95Ms: toNum(phase0Latency.webhook_to_fill_ms && phase0Latency.webhook_to_fill_ms.p95),
    duplicateCount: toNum(phase0Latency.duplicate_count) || 0,
    rejectCount: toNum(phase0Latency.reject_count) || 0,
    disagreementRate,
    fallbackRate,
    missingRate: executedMissingRate ?? (toNum(summary.features_coverage_rate) == null ? null : (1 - Number(summary.features_coverage_rate))),
    monthlyPass: typeof objective.monthly_pass === "boolean" ? objective.monthly_pass : null,
    objectivePass: typeof objective.pass === "boolean" ? objective.pass : null,
  });

  return {
    ...score,
    snapshot: {
      cohort_scope: "SELF_EVOLUTION_ENTRY_EXECUTED_COHORT",
      rows_n: toNum(summary.rows_n) || 0,
      executed_n: cohortExecutedN,
      strict_executed_n: strictExecutedN,
      partial_n: partialN,
      fallback_n: fallbackN,
      drop_n: toNum(summary.drop_n) || 0,
      realized_n: cohortRealizedN,
      fire_n: fireRows.length,
      fire_win_rate: ratio(fireRealized.filter((row) => Number(row.realized_ret_net) > 0).length, fireRealized.length),
      tp1_first_rate: ratio(realizedRows.filter((row) => row.tp1_first === true).length, realizedRows.length),
      avg_realized_ret_net: datasetAvgRet ?? toNum(summary.avg_realized_ret_net) ?? toNum(overall.avg_ret_net),
      win_rate: datasetWinRate ?? toNum(overall.win_rate),
      missing_rate: executedMissingRate ?? (toNum(summary.features_coverage_rate) == null ? null : (1 - Number(summary.features_coverage_rate))),
      projected_count_ratio_global: toNum(tuningContract && tuningContract.projected_count_ratio_global),
      projected_replacement_ratio: toNum(tuningContract && tuningContract.projected_replacement_ratio),
    },
  };
}

function deriveMarketObjectiveScores({
  dataset = null,
  governance = null,
  phase0 = null,
  marketContracts = [],
} = {}) {
  const rows = Array.isArray(dataset && dataset.rows) ? dataset.rows : [];
  const phase0Latency = phase0 && phase0.bridge_latency && typeof phase0.bridge_latency === "object"
    ? phase0.bridge_latency
    : {};
  const monthlyTarget = toNum(governance && governance.objective && governance.objective.min_monthly_net_krw) || 1500000;
  const byMarket = new Map();
  for (const row of rows) {
    const market = normalizeMarket(row);
    if (!byMarket.has(market)) byMarket.set(market, []);
    byMarket.get(market).push(row);
  }
  const contractMap = new Map(
    (Array.isArray(marketContracts) ? marketContracts : []).map((row) => [String(row.market || "").trim().toUpperCase(), row])
  );
  return Array.from(byMarket.entries())
    .map(([market, marketRows]) => {
      const executed = marketRows.filter((row) => row.source_row_type === "EXECUTED" || row.source_row_type === "PARTIAL" || row.source_row_type === "FALLBACK");
      const realized = executed.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
      const fireRealized = realized.filter((row) => String(row.febt_phase || "").toUpperCase() === "FIRE");
      const contract = contractMap.get(market) || null;
      const score = deriveObjectiveScore({
        monthlyRunRateKrw: null,
        minMonthlyNetKrw: monthlyTarget,
        avgRetNet: mean(realized.map((row) => row.realized_ret_net)),
        winRate: ratio(realized.filter((row) => Number(row.realized_ret_net) > 0).length, realized.length),
        projectedCountRatioGlobal: toNum(contract && contract.projected_count_ratio_global),
        projectedReplacementRatio: toNum(contract && contract.projected_replacement_ratio),
        tp1FirstRate: ratio(realized.filter((row) => row.tp1_first === true).length, realized.length),
        fireWinRate: ratio(fireRealized.filter((row) => Number(row.realized_ret_net) > 0).length, fireRealized.length),
        webhookToFillP95Ms: toNum(phase0Latency.webhook_to_fill_ms && phase0Latency.webhook_to_fill_ms.p95),
        duplicateCount: 0,
        rejectCount: 0,
        disagreementRate: ratio(contract && contract.disagreement_n, contract && contract.sampled_n),
        fallbackRate: ratio(contract && contract.fallback_legacy_n, contract && contract.sampled_n),
        missingRate: ratio(executed.filter((row) => !row.features_json).length, executed.length),
        monthlyPass: null,
        objectivePass: null,
      });
      return {
        market,
        sampled_n: marketRows.length,
        executed_n: executed.length,
        realized_n: realized.length,
        objective_score: score.objective_score,
        avg_realized_ret_net: mean(realized.map((row) => row.realized_ret_net)),
        win_rate: ratio(realized.filter((row) => Number(row.realized_ret_net) > 0).length, realized.length),
        tp1_first_rate: ratio(realized.filter((row) => row.tp1_first === true).length, realized.length),
        fire_win_rate: ratio(fireRealized.filter((row) => Number(row.realized_ret_net) > 0).length, fireRealized.length),
        projected_count_ratio_global: toNum(contract && contract.projected_count_ratio_global),
        projected_replacement_ratio: toNum(contract && contract.projected_replacement_ratio),
        mode: contract && contract.mode || "NORMAL",
        constraints: score.constraints,
      };
    })
    .sort((a, b) => (Number(b.objective_score || -Infinity) - Number(a.objective_score || -Infinity)) || String(a.market).localeCompare(String(b.market)));
}

function deriveMarketConcentrationDiagnostics({
  globalObjectiveScore = null,
  marketObjectiveScores = [],
} = {}) {
  const rows = Array.isArray(marketObjectiveScores) ? marketObjectiveScores : [];
  const globalScore = toNum(globalObjectiveScore);
  const negativeRows = rows
    .filter((row) => toNum(row && row.objective_score) != null && Number(row.objective_score) < 0)
    .slice()
    .sort((a, b) => Number(a.objective_score) - Number(b.objective_score));
  const worst = negativeRows[0] || null;
  const negativeAbsTotal = negativeRows.reduce((acc, row) => acc + Math.abs(Number(row.objective_score || 0)), 0);
  const worstAbs = worst ? Math.abs(Number(worst.objective_score || 0)) : null;
  const dominantNegativeShare = (worstAbs != null && negativeAbsTotal > 0)
    ? Number((worstAbs / negativeAbsTotal).toFixed(4))
    : null;
  const objectiveScoreExBottomMarket = (globalScore != null && worst)
    ? Number((globalScore - Number(worst.objective_score || 0)).toFixed(4))
    : globalScore;
  const marketDragGap = (globalScore != null && objectiveScoreExBottomMarket != null)
    ? Number((objectiveScoreExBottomMarket - globalScore).toFixed(4))
    : null;
  return {
    available: rows.length > 0,
    negative_market_n: negativeRows.length,
    dominant_negative_market: worst,
    dominant_negative_share: dominantNegativeShare,
    objective_score_ex_bottom_market: objectiveScoreExBottomMarket,
    bottom_market_drag_gap: marketDragGap,
    concentration_flag: Boolean(
      worst
      && dominantNegativeShare != null
      && dominantNegativeShare >= 0.5
      && Number(worst.realized_n || 0) >= 3
    ),
  };
}

function buildAttributionGroupRows(rows = [], grouper) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = grouper(row);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        rows: [],
        sample_n: 0,
      });
    }
    const acc = map.get(key);
    acc.rows.push(row);
    acc.sample_n += 1;
  }
  return Array.from(map.entries()).map(([key, acc]) => {
    const [layer, market, reason] = key.split("__");
    const realized = acc.rows.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
    return {
      layer,
      market,
      reason,
      sample_n: acc.sample_n,
      net_pnl_quote: sum(realized.map((row) => row.realized_pnl_quote)),
      avg_ret_net: mean(realized.map((row) => row.realized_ret_net)),
      missed_gain_pct: ratio(realized.filter((row) => Number(row.realized_ret_net) > 0).length, realized.length),
      saved_loss_pct: ratio(realized.filter((row) => Number(row.realized_ret_net) < 0).length, realized.length),
    };
  }).sort((a, b) => (b.sample_n - a.sample_n) || String(a.market).localeCompare(String(b.market)) || String(a.reason).localeCompare(String(b.reason)));
}

function deriveAttribution({
  dataset = null,
} = {}) {
  const rows = Array.isArray(dataset && dataset.rows) ? dataset.rows : [];
  const executed = rows.filter((row) => row.source_row_type === "EXECUTED" || row.source_row_type === "PARTIAL" || row.source_row_type === "FALLBACK");
  const dropLike = rows.filter((row) => row.source_row_type === "DROP" || row.source_row_type === "REJECTED" || row.source_row_type === "MISSED");
  const lateLoss = executed.filter((row) => String(row.febt_phase || "").toUpperCase() === "LATE" && Number.isFinite(toNum(row.realized_ret_net)) && Number(row.realized_ret_net) <= 0);
  const falseFire = executed.filter((row) => String(row.febt_phase || "").toUpperCase() === "FIRE" && Number.isFinite(toNum(row.realized_ret_net)) && Number(row.realized_ret_net) <= 0);
  const missedRecovery = rows.filter((row) =>
    (row.source_row_type === "DROP" || row.source_row_type === "MISSED")
    && ["FIRE", "ARMED"].includes(String(row.febt_phase || "").toUpperCase())
  );
  const fallbackCost = executed.filter((row) => row.source_row_type === "FALLBACK" || row.fallback_reason);

  const groupKey = (layer, row) => `${layer}__${normalizeMarket(row)}__${normalizeReason(row)}`;
  const out = {
    drop_attribution: buildAttributionGroupRows(dropLike, (row) => groupKey(normalizeLayer(row), row)).slice(0, 20),
    late_loss_attribution: buildAttributionGroupRows(lateLoss, (row) => groupKey("TIMING", row)).slice(0, 20),
    false_fire_attribution: buildAttributionGroupRows(falseFire, (row) => groupKey("TIMING", row)).slice(0, 20),
    missed_recovery_attribution: buildAttributionGroupRows(missedRecovery, (row) => groupKey(normalizeLayer(row), row)).slice(0, 20),
    fallback_cost_attribution: buildAttributionGroupRows(fallbackCost, (row) => groupKey("FALLBACK", row)).slice(0, 20),
  };
  out.summary = {
    drop_top_layer: countBy(out.drop_attribution, (row) => row.layer)[0] || null,
    late_loss_top_market: countBy(out.late_loss_attribution, (row) => row.market)[0] || null,
    false_fire_top_market: countBy(out.false_fire_attribution, (row) => row.market)[0] || null,
    missed_recovery_top_reason: countBy(out.missed_recovery_attribution, (row) => row.reason)[0] || null,
    fallback_cost_top_market: countBy(out.fallback_cost_attribution, (row) => row.market)[0] || null,
  };
  return out;
}

module.exports = {
  deriveObjectiveScore,
  deriveDatasetObjectiveScore,
  deriveMarketObjectiveScores,
  deriveMarketConcentrationDiagnostics,
  deriveAttribution,
  __test: {
    deriveConstraintFlags,
  },
};
