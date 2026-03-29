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

function latestWeeklyRow(weeklyHistory = null) {
  const rows = Array.isArray(weeklyHistory && weeklyHistory.weeks) ? weeklyHistory.weeks : [];
  return rows.length ? rows[rows.length - 1] : null;
}

function findPreparedPaths({ stageAutopilot = null, weeklyHistory = null, targetCandidateId = null, rollbackFilePath = null } = {}) {
  const stage = unwrapRawReport(stageAutopilot) || {};
  const stageRows = Array.isArray(stage.stage_rows) ? stage.stage_rows : [];
  const pineStage = stageRows.find((row) => String(row && row.stage || "").trim().toUpperCase() === "PINE") || {};
  const historyRows = Array.isArray(weeklyHistory && weeklyHistory.weeks) ? weeklyHistory.weeks.slice() : [];
  let matchedHistory = null;
  if (rollbackFilePath) {
    matchedHistory = [...historyRows].reverse().find((row) =>
      String(row && row.rollback_source_file_path || "").trim() === String(rollbackFilePath || "").trim()
    ) || null;
  } else if (targetCandidateId) {
    matchedHistory = [...historyRows].reverse().find((row) =>
      String(row && row.recommended_patch_id || "").trim() === String(targetCandidateId || "").trim()
    ) || null;
  }
  const latestHistory = matchedHistory || latestWeeklyRow(weeklyHistory) || {};
  return {
    prepared_file_path: String(pineStage.prepared_file_path || latestHistory.created_file_path || "").trim() || null,
    latest_generated_file_path: String(pineStage.latest_generated_file_path || latestHistory.latest_generated_file_path || "").trim() || null,
    rollback_source_file_path: String(pineStage.rollback_source_file_path || latestHistory.rollback_source_file_path || "").trim() || null,
    prepared_candidate_signature: String(pineStage.signature || pineStage.candidate_signature || "").trim() || null,
    prepared_stage_ready: pineStage.machine_state === "READY",
    prepared_reason: String(pineStage.reason || "").trim() || null,
    source_week_key: String(latestHistory.week_key || "").trim() || null,
  };
}

function deriveMarketScope(rows = [], targetCandidateId = null, openWave = 1) {
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) =>
    String(row && row.candidate_id || "").trim() === String(targetCandidateId || "").trim()
    && String(row && row.market || "").trim().toUpperCase() !== "ALL"
  );
  const openRows = scoped.filter((row) => (toNum(row && row.wave) || 99) <= openWave);
  return {
    rows: openRows.map((row) => ({
      market: String(row.market || "").trim().toUpperCase() || "UNKNOWN",
      wave: toNum(row.wave),
      canary_verdict: String(row.canary_verdict || "").trim().toUpperCase() || "BLOCK",
      current_stage: String(row.current_stage || "").trim().toUpperCase() || "SHADOW",
      blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
    })),
    total_n: openRows.length,
    ready_n: openRows.filter((row) => String(row.canary_verdict || "").trim().toUpperCase() === "READY").length,
    blocked_n: openRows.filter((row) => String(row.canary_verdict || "").trim().toUpperCase() !== "READY").length,
  };
}

function deriveDeploymentPlan({
  objectiveSupervisor = null,
  changeControl = null,
  codexPatchReview = null,
  deploymentGuards = null,
  canaryReport = null,
  stageAutopilot = null,
  weeklyHistory = null,
} = {}) {
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const change = unwrapRawReport(changeControl) || {};
  const codex = unwrapRawReport(codexPatchReview) || {};
  const guards = unwrapRawReport(deploymentGuards) || {};
  const guardSummary = guards.summary && typeof guards.summary === "object" ? guards.summary : {};
  const canary = unwrapRawReport(canaryReport) || {};
  const canarySummary = canary.summary && typeof canary.summary === "object" ? canary.summary : {};
  const canaryRows = Array.isArray(canary.rows) ? canary.rows : [];

  const promotion = supervisor.promotion && typeof supervisor.promotion === "object"
    ? supervisor.promotion
    : (change.auto_promotion && typeof change.auto_promotion === "object" ? change.auto_promotion : {});
  const rollback = supervisor.rollback && typeof supervisor.rollback === "object"
    ? supervisor.rollback
    : (change.auto_rollback && typeof change.auto_rollback === "object" ? change.auto_rollback : {});
  const targetCandidateId = String(guardSummary.target_candidate_id || promotion.candidate_id || "").trim() || null;
  const displayCandidateId = String(promotion.display_candidate_id || targetCandidateId || "").trim() || null;
  const rollbackFilePath = String(rollback.rollback_file_path || "").trim() || null;
  const codexVerdict = String(codex.verdict || "HOLD").trim().toUpperCase();
  const codexCandidateId = String(codex.recommended_candidate_id || "").trim() || null;
  const codexRollbackPath = String(codex.recommended_rollback_file_path || "").trim() || null;
  const openWave = toNum(guardSummary.canary_open_wave) || toNum(canarySummary.open_wave) || 1;
  const prepared = findPreparedPaths({
    stageAutopilot,
    weeklyHistory,
    targetCandidateId,
    rollbackFilePath,
  });
  const marketScope = deriveMarketScope(canaryRows, targetCandidateId, openWave);

  const promotionPreparePass = promotion.ready === true
    && guardSummary.deploy_pass === true
    && codexVerdict === "PROMOTE"
    && (!codexCandidateId || codexCandidateId === targetCandidateId);
  const rollbackPreparePass = rollback.ready === true
    && !!rollbackFilePath
    && codexVerdict === "ROLLBACK"
    && (!codexRollbackPath || codexRollbackPath === rollbackFilePath);
  const readyForManualPaste = promotionPreparePass
    && prepared.prepared_stage_ready === true
    && (!!prepared.prepared_file_path || !!prepared.latest_generated_file_path);
  const readyForManualRollback = rollbackPreparePass
    && prepared.prepared_stage_ready === true
    && (!!prepared.rollback_source_file_path || !!rollbackFilePath);

  let planStatus = "HOLD";
  if (readyForManualRollback) planStatus = "READY_FOR_MANUAL_ROLLBACK";
  else if (rollbackPreparePass) planStatus = "PREPARE_ROLLBACK";
  else if (readyForManualPaste) planStatus = "READY_FOR_MANUAL_PASTE";
  else if (promotionPreparePass) planStatus = "PREPARE_PROMOTION";

  const blockers = [];
  if (planStatus === "HOLD" && Array.isArray(guardSummary.blockers)) blockers.push(...guardSummary.blockers);
  if ((promotion.ready === true || rollback.ready === true) && codexVerdict === "HOLD") blockers.push("CODEX_ACTION_NOT_APPROVED");
  if (promotionPreparePass && !readyForManualPaste) blockers.push("PINE_PREPARE_PENDING");
  if (rollbackPreparePass && !readyForManualRollback) blockers.push("ROLLBACK_PREPARE_PENDING");

  const checklist = rollbackPreparePass
    ? [
      `rollback target ${rollbackFilePath || "N/A"} 를 latest alias로 연결`,
      "TradingView Pine 편집기에 rollback source를 붙여넣기",
      "현재 활성 심볼/시간대가 rollback target과 일치하는지 확인",
      "붙여넣기 후 alert 재설정 여부 확인",
    ]
    : [
      `candidate ${displayCandidateId || targetCandidateId || "N/A"} generated file을 latest alias와 비교`,
      `wave ${openWave} 범위 시장(${marketScope.rows.map((row) => row.market).join(", ") || "N/A"})만 적용`,
      "TradingView Pine 편집기에 prepared/generated file을 붙여넣기",
      "붙여넣기 후 webhook alert가 기존 LONG/SHORT 메인 이벤트만 가리키는지 확인",
    ];

  return {
    summary: {
      plan_status: planStatus,
      target_candidate_id: targetCandidateId,
      display_candidate_id: displayCandidateId,
      rollback_file_path: rollbackFilePath,
      prepare_pass: promotionPreparePass || rollbackPreparePass,
      ready_for_manual_paste: readyForManualPaste || readyForManualRollback,
      manual_step_required: planStatus === "READY_FOR_MANUAL_PASTE" || planStatus === "READY_FOR_MANUAL_ROLLBACK",
      open_wave: openWave,
      target_wave: openWave,
      market_scope_n: marketScope.total_n,
      market_scope_ready_n: marketScope.ready_n,
      market_scope_blocked_n: marketScope.blocked_n,
      prepared_file_path: prepared.prepared_file_path,
      latest_generated_file_path: prepared.latest_generated_file_path,
      rollback_source_file_path: prepared.rollback_source_file_path,
      prepared_stage_ready: prepared.prepared_stage_ready,
      source_week_key: prepared.source_week_key,
      codex_verdict: codexVerdict,
      blockers: Array.from(new Set(blockers.filter(Boolean))),
    },
    rows: marketScope.rows,
    handoff: {
      checklist,
      prepared_file_path: prepared.prepared_file_path,
      latest_generated_file_path: prepared.latest_generated_file_path,
      rollback_source_file_path: prepared.rollback_source_file_path,
      candidate_signature: prepared.prepared_candidate_signature || targetCandidateId,
      prepared_reason: prepared.prepared_reason,
    },
  };
}

module.exports = {
  deriveDeploymentPlan,
  unwrapRawReport,
};
