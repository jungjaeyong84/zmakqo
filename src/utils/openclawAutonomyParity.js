"use strict";

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function statusRow({ id, criterion, current, done, partial, blocker = null }) {
  return {
    id,
    criterion,
    current,
    status: done ? "DONE" : (partial ? "PARTIAL" : (current == null ? "NOT_STARTED" : "FAIL")),
    blocker: blocker || null,
  };
}

function buildAutonomyParity({
  autonomyContract = null,
  objectiveSupervisor = null,
  quality = null,
  cutover = null,
  policyPlan = null,
  reasoningJournal = null,
} = {}) {
  const autonomy = readSummary(autonomyContract);
  const objective = unwrapRawReport(objectiveSupervisor) || {};
  const qualitySummary = readSummary(quality);
  const cutoverSummary = readSummary(cutover);
  const policySummary = readSummary(policyPlan);
  const journalSummary = readSummary(reasoningJournal);

  const currentObjectiveScore = toNum(policySummary.current_objective_score)
    ?? toNum(objective.global_score)
    ?? toNum(objective.objective_score);
  const authorityState = toUpper(autonomy.authority_state);
  const cutoverStatus = String(cutoverSummary.readiness_status || "").trim() || null;
  const finalMismatchN = toNum(qualitySummary.final_downstream_mismatch_n);
  const contradictionN = toNum(journalSummary.contradiction_n) ?? 0;
  const journalEntryN = toNum(journalSummary.entry_n) ?? 0;
  const verifiedN = toNum(journalSummary.verified_n) ?? 0;
  const notMetN = toNum(journalSummary.not_met_n) ?? 0;
  const verificationRate = toNum(journalSummary.verification_rate);
  const objectiveVerdict = toUpper(objective.verdict);

  const requirements = [
    statusRow({
      id: "objective_score_non_negative",
      criterion: "objective_score >= 0",
      current: currentObjectiveScore,
      done: currentObjectiveScore != null && currentObjectiveScore >= 0,
      partial: currentObjectiveScore != null && currentObjectiveScore > -5,
      blocker: currentObjectiveScore != null && currentObjectiveScore < 0 ? "OBJECTIVE_BELOW_ZERO" : null,
    }),
    statusRow({
      id: "authority_state_ready",
      criterion: "authority_state = READY",
      current: authorityState,
      done: authorityState === "READY",
      partial: authorityState === "PENDING",
      blocker: authorityState && authorityState !== "READY" ? `AUTHORITY_${authorityState}` : null,
    }),
    statusRow({
      id: "reasoning_journal_consistency",
      criterion: "reasoning_journal entries >= 10 and contradiction_n = 0",
      current: `entries=${journalEntryN}, contradictions=${contradictionN}`,
      done: journalEntryN >= 10 && contradictionN === 0,
      partial: journalEntryN >= 1 && contradictionN === 0,
      blocker: journalEntryN < 10 ? "REASONING_HISTORY_TOO_SHORT" : (contradictionN > 0 ? "REASONING_CONTRADICTION" : null),
    }),
    statusRow({
      id: "reasoning_verification_quality",
      criterion: "verification_rate >= 0.5 with verified_n >= 5",
      current: `rate=${verificationRate != null ? verificationRate : "N/A"}, verified=${verifiedN}, not_met=${notMetN}`,
      done: verifiedN >= 5 && verificationRate != null && verificationRate >= 0.5,
      partial: verifiedN >= 1,
      blocker: verifiedN < 5 ? "INSUFFICIENT_VERIFICATION_SAMPLE" : (verificationRate != null && verificationRate < 0.5 ? "LOW_VERIFICATION_RATE" : null),
    }),
    statusRow({
      id: "server_primary_active",
      criterion: "server signal cutover readiness = SERVER_PRIMARY_ACTIVE",
      current: cutoverStatus,
      done: cutoverStatus === "SERVER_PRIMARY_ACTIVE",
      partial: cutoverSummary.already_server_primary === true || cutoverSummary.promotion_ready === true,
      blocker: cutoverStatus && cutoverStatus !== "SERVER_PRIMARY_ACTIVE" ? `CUTOVER_${toUpper(cutoverStatus)}` : null,
    }),
    statusRow({
      id: "final_downstream_mismatch_control",
      criterion: "final_downstream_mismatch_n <= 5",
      current: finalMismatchN,
      done: finalMismatchN != null && finalMismatchN <= 5,
      partial: finalMismatchN != null && finalMismatchN <= 15,
      blocker: finalMismatchN != null && finalMismatchN > 5 ? "FINAL_DOWNSTREAM_MISMATCH_HIGH" : null,
    }),
    statusRow({
      id: "objective_supervisor_clear",
      criterion: "objective_supervisor verdict != HOLD",
      current: objectiveVerdict,
      done: objectiveVerdict && objectiveVerdict !== "HOLD",
      partial: objectiveVerdict === "HOLD",
      blocker: objectiveVerdict === "HOLD" ? String(objective.root_cause || "OBJECTIVE_HOLD") : null,
    }),
  ];

  const doneN = requirements.filter((row) => row.status === "DONE").length;
  const partialN = requirements.filter((row) => row.status === "PARTIAL").length;
  const failN = requirements.filter((row) => row.status === "FAIL").length;
  const notStartedN = requirements.filter((row) => row.status === "NOT_STARTED").length;
  const progressScore = requirements.reduce((sum, row) => {
    if (row.status === "DONE") return sum + 1;
    if (row.status === "PARTIAL") return sum + 0.5;
    return sum;
  }, 0);
  const overallProgressPct = Math.round((progressScore / Math.max(1, requirements.length)) * 100);
  const nextMilestone = (requirements.find((row) => row.status !== "DONE") || {}).id || "READY";

  return {
    summary: {
      target: "authority_state=READY",
      overall_progress_pct: overallProgressPct,
      done_n: doneN,
      partial_n: partialN,
      fail_n: failN,
      not_started_n: notStartedN,
      current_authority_state: authorityState,
      current_objective_score: currentObjectiveScore,
      current_objective_verdict: objectiveVerdict,
      current_final_downstream_mismatch_n: finalMismatchN,
      reasoning_entry_n: journalEntryN,
      reasoning_contradiction_n: contradictionN,
      next_milestone: nextMilestone,
    },
    requirements,
  };
}

module.exports = {
  buildAutonomyParity,
};
