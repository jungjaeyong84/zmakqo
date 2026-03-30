"use strict";

const fs = require("fs");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIsoMs(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
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

function fileExists(pathValue) {
  const filePath = String(pathValue || "").trim();
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath);
  } catch (_err) {
    return false;
  }
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

function deriveManualPasteAck({ manualPasteAck = null, prepared = {}, targetCandidateId = null } = {}) {
  const ack = unwrapRawReport(manualPasteAck) || {};
  const acknowledged = ack.acknowledged === true;
  const ackPreparedFilePath = String(ack.prepared_file_path || ack.applied_file_path || "").trim() || null;
  const ackLatestGeneratedFilePath = String(ack.latest_generated_file_path || "").trim() || null;
  const ackCandidateSignature = String(ack.candidate_signature || ack.target_candidate_id || "").trim() || null;
  const ackTargetCandidateId = String(ack.target_candidate_id || "").trim() || null;
  const fileMatched = Boolean(
    (ackPreparedFilePath && prepared.prepared_file_path && ackPreparedFilePath === prepared.prepared_file_path)
    || (ackLatestGeneratedFilePath && prepared.latest_generated_file_path && ackLatestGeneratedFilePath === prepared.latest_generated_file_path)
  );
  const candidateMatched = Boolean(
    (ackCandidateSignature && prepared.prepared_candidate_signature && ackCandidateSignature === prepared.prepared_candidate_signature)
    || (ackTargetCandidateId && targetCandidateId && ackTargetCandidateId === targetCandidateId)
  );
  const preparedFileStillExists = fileExists(ackPreparedFilePath || prepared.prepared_file_path);
  const matched = acknowledged && preparedFileStillExists && (fileMatched || candidateMatched);
  return {
    acknowledged: matched,
    acknowledged_at_kst: String(ack.acknowledged_at_kst || "").trim() || null,
    acknowledged_at_iso: String(ack.acknowledged_at_iso || "").trim() || null,
    prepared_file_path: ackPreparedFilePath,
    latest_generated_file_path: ackLatestGeneratedFilePath,
    candidate_signature: ackCandidateSignature,
    target_candidate_id: ackTargetCandidateId,
    applied_strategy_id: String(ack.applied_strategy_id || "").trim() || null,
    confirmation_status: matched ? "APPLIED_PENDING_SIGNAL_CONFIRMATION" : "N/A",
  };
}

function deriveLiveSignalConfirmation({ signalsCache = null, manualPaste = null } = {}) {
  const docs = Array.isArray(signalsCache && signalsCache.docs) ? signalsCache.docs : [];
  const appliedStrategyId = String(manualPaste && manualPaste.applied_strategy_id || "").trim() || null;
  const ackMs = parseIsoMs(manualPaste && manualPaste.acknowledged_at_iso);
  if (!(manualPaste && manualPaste.acknowledged) || !appliedStrategyId || !docs.length) {
    return {
      confirmed: false,
      pending: Boolean(manualPaste && manualPaste.acknowledged),
      signal_id: null,
      created_at: null,
      strategy_id: appliedStrategyId,
      event: null,
    };
  }
  const match = docs.find((row) => {
    const event = String(
      row && (row.event || row.signal_event || (row.features_json && row.features_json.event) || "")
    ).trim().toUpperCase();
    if (!(event === "LONG" || event === "SHORT")) return false;
    const strategyId = String(
      row && (
        row.strategy_id
        || (row.features_json && row.features_json.strategy_id)
        || (row.features && row.features.strategy_id)
        || ""
      )
    ).trim();
    if (strategyId !== appliedStrategyId) return false;
    const createdMs = parseIsoMs(row && row.created_at);
    if (ackMs != null && createdMs != null && createdMs < ackMs) return false;
    return true;
  }) || null;
  return {
    confirmed: !!match,
    pending: !!manualPaste.acknowledged && !match,
    signal_id: match ? String(match.signal_id || match.id || match.doc_id || "").trim() || null : null,
    created_at: match ? String(match.created_at || "").trim() || null : null,
    strategy_id: appliedStrategyId,
    event: match ? String(match.event || match.signal_event || (match.features_json && match.features_json.event) || "").trim().toUpperCase() || null : null,
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
  manualPasteAck = null,
  signalsCache = null,
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
  const recoveryPromotion = promotion.ready === true && promotion.recovery_mode === true;
  const openWave = toNum(guardSummary.canary_open_wave) || toNum(canarySummary.open_wave) || 1;
  const prepared = findPreparedPaths({
    stageAutopilot,
    weeklyHistory,
    targetCandidateId,
    rollbackFilePath,
  });
  const manualPaste = deriveManualPasteAck({
    manualPasteAck,
    prepared,
    targetCandidateId,
  });
  const liveSignalConfirmation = deriveLiveSignalConfirmation({
    signalsCache,
    manualPaste,
  });
  const marketScope = deriveMarketScope(canaryRows, targetCandidateId, openWave);

  const promotionAuthorityPass = (
    codexVerdict === "PROMOTE"
    && (!codexCandidateId || codexCandidateId === targetCandidateId)
  ) || recoveryPromotion;
  const promotionPreparePass = promotion.ready === true
    && guardSummary.deploy_pass === true
    && promotionAuthorityPass;
  const rollbackPreparePass = rollback.ready === true
    && !!rollbackFilePath
    && codexVerdict === "ROLLBACK"
    && (!codexRollbackPath || codexRollbackPath === rollbackFilePath);
  const dryPrepareEligible = promotionPreparePass
    && prepared.prepared_stage_ready !== true
    && String(prepared.prepared_reason || "").trim().toUpperCase() === "DAILY_NO_TRADE_ACTIVITY";
  const readyForManualPaste = promotionPreparePass
    && prepared.prepared_stage_ready === true
    && (!!prepared.prepared_file_path || !!prepared.latest_generated_file_path);
  const readyForManualRollback = rollbackPreparePass
    && prepared.prepared_stage_ready === true
    && (!!prepared.rollback_source_file_path || !!rollbackFilePath);
  const changeControlRelevant = promotion.ready === true || rollback.ready === true;

  let planStatus = "HOLD";
  if (readyForManualRollback) planStatus = "READY_FOR_MANUAL_ROLLBACK";
  else if (rollbackPreparePass) planStatus = "PREPARE_ROLLBACK";
  else if (liveSignalConfirmation.confirmed) planStatus = "APPLIED_CONFIRMED";
  else if (manualPaste.acknowledged) planStatus = "APPLIED_PENDING_SIGNAL_CONFIRMATION";
  else if (readyForManualPaste) planStatus = "READY_FOR_MANUAL_PASTE";
  else if (promotionPreparePass) planStatus = dryPrepareEligible ? "PREPARE_PROMOTION_DRY" : "PREPARE_PROMOTION";

  const blockers = [];
  if (planStatus === "HOLD" && Array.isArray(guardSummary.blockers)) blockers.push(...guardSummary.blockers);
  if (changeControlRelevant && codexVerdict === "HOLD" && !recoveryPromotion) blockers.push("CODEX_ACTION_NOT_APPROVED");
  if (promotionPreparePass && !readyForManualPaste && !dryPrepareEligible) blockers.push("PINE_PREPARE_PENDING");
  if (dryPrepareEligible) blockers.push("DRY_PREPARE_ONLY");
  if (rollbackPreparePass && !readyForManualRollback) blockers.push("ROLLBACK_PREPARE_PENDING");

  const checklist = rollbackPreparePass
    ? [
      `rollback target ${rollbackFilePath || "N/A"} 를 latest alias로 연결`,
      "TradingView Pine 편집기에 rollback source를 붙여넣기",
      "현재 활성 심볼/시간대가 rollback target과 일치하는지 확인",
      "붙여넣기 후 alert 재설정 여부 확인",
    ]
    : (liveSignalConfirmation.confirmed
      ? [
        `confirmed signal ${liveSignalConfirmation.signal_id || "N/A"} 에서 ${liveSignalConfirmation.strategy_id || "N/A"} 확인`,
        `event ${liveSignalConfirmation.event || "N/A"} / created_at ${liveSignalConfirmation.created_at || "N/A"}`,
        "post-apply signal probe와 strategy alignment 리포트가 신규 strategy_id를 반영하는지 점검",
      ]
      : (manualPaste.acknowledged
      ? [
        `applied candidate ${displayCandidateId || targetCandidateId || "N/A"} 의 live signal strategy_id를 확인`,
        `첫 active LONG/SHORT 신호에서 ${manualPaste.applied_strategy_id || "strategy_id"} 수신 여부 점검`,
        "post-apply signal probe와 strategy alignment 리포트를 재생성",
      ]
      : [
      `candidate ${displayCandidateId || targetCandidateId || "N/A"} generated file을 latest alias와 비교`,
      `wave ${openWave} 범위 시장(${marketScope.rows.map((row) => row.market).join(", ") || "N/A"})만 적용`,
      "TradingView Pine 편집기에 prepared/generated file을 붙여넣기",
      "붙여넣기 후 webhook alert가 기존 LONG/SHORT 메인 이벤트만 가리키는지 확인",
    ]));

  const nextActions = [];
  if (dryPrepareEligible) {
    nextActions.push("거래가 없는 날에도 prepared/generated Pine 파일 경로를 유지하고 다음 거래 세션 전에 수동 반영 준비");
  }
  if (String(prepared.prepared_reason || "").trim().toUpperCase() === "DAILY_NO_TRADE_ACTIVITY") {
    nextActions.push("DAILY_NO_TRADE_ACTIVITY 해소 전까지 dry-prepare 상태로 유지하고 거래 재개 시 prepared artifact 재검증");
  }
  if (changeControlRelevant && codexVerdict === "HOLD" && !recoveryPromotion) {
    nextActions.push("Codex 승인 또는 rollback 결론이 나올 때까지 change-control 상태를 재평가");
  }
  if (marketScope.blocked_n > 0) {
    nextActions.push("blocked market canary를 먼저 해소해 open wave 전체를 READY 상태로 맞춤");
  }
  if (promotionPreparePass && !readyForManualPaste && !dryPrepareEligible) {
    nextActions.push("PINE stage가 prepared file을 생성할 때까지 stage_autopilot 결과를 재확인");
  }
  if (rollbackPreparePass && !readyForManualRollback) {
    nextActions.push("rollback source file 경로를 준비한 뒤 manual rollback handoff를 생성");
  }
  if (manualPaste.acknowledged) {
    nextActions.push("live signal에서 applied strategy_id 확인 전까지 APPLIED_PENDING_SIGNAL_CONFIRMATION 상태를 유지");
  }
  if (liveSignalConfirmation.confirmed) {
    nextActions.length = 0;
  }

  return {
    summary: {
      plan_status: planStatus,
      target_candidate_id: targetCandidateId,
      display_candidate_id: displayCandidateId,
      rollback_file_path: rollbackFilePath,
      prepare_pass: promotionPreparePass || rollbackPreparePass,
      dry_prepare_available: dryPrepareEligible,
      ready_for_manual_paste: (!manualPaste.acknowledged) && (readyForManualPaste || readyForManualRollback),
      manual_step_required: (!manualPaste.acknowledged) && (planStatus === "READY_FOR_MANUAL_PASTE" || planStatus === "READY_FOR_MANUAL_ROLLBACK"),
      manual_paste_acknowledged: manualPaste.acknowledged,
      live_signal_confirmation_pending: liveSignalConfirmation.pending,
      live_signal_confirmed: liveSignalConfirmation.confirmed,
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
      applied_strategy_id: manualPaste.applied_strategy_id,
      manual_paste_acknowledged_at_kst: manualPaste.acknowledged_at_kst,
      manual_paste_acknowledged_at_iso: manualPaste.acknowledged_at_iso,
      confirmed_signal_id: liveSignalConfirmation.signal_id,
      confirmed_signal_created_at: liveSignalConfirmation.created_at,
      codex_verdict: codexVerdict,
      blockers: Array.from(new Set(blockers.filter(Boolean))),
      next_actions: Array.from(new Set(nextActions.filter(Boolean))),
    },
    rows: marketScope.rows,
    handoff: {
      checklist,
      prepared_file_path: prepared.prepared_file_path,
      latest_generated_file_path: prepared.latest_generated_file_path,
      rollback_source_file_path: prepared.rollback_source_file_path,
      candidate_signature: prepared.prepared_candidate_signature || targetCandidateId,
      prepared_reason: prepared.prepared_reason,
      dry_prepare: dryPrepareEligible,
      next_actions: Array.from(new Set(nextActions.filter(Boolean))),
    },
  };
}

module.exports = {
  deriveDeploymentPlan,
  unwrapRawReport,
};
