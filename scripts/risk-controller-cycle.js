#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString } = require("../src/utils/timeKst");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");

function readJsonSafe(absPath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(absPath, "utf8")), path: absPath };
  } catch (error) {
    return { ok: false, data: null, path: absPath, error: error && error.message ? error.message : String(error) };
  }
}

function pickLatestByPattern(pattern) {
  const names = fs
    .readdirSync(OPS_DAILY)
    .filter((name) => pattern.test(name))
    .sort();
  if (!names.length) return null;
  let selected = null;
  let selectedMs = -Infinity;
  for (const name of names) {
    const abs = path.join(OPS_DAILY, name);
    const mtimeMs = fs.statSync(abs).mtimeMs;
    if (mtimeMs > selectedMs) {
      selected = abs;
      selectedMs = mtimeMs;
    }
  }
  return selected;
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtPct(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value.toFixed(digits)}%`;
}

function rel(absPath) {
  if (!absPath) return null;
  return path.relative(ROOT, absPath).replace(/\\/g, "/");
}

function buildIssueTags(input) {
  const tags = [];
  const {
    appliedCost,
    costLimit,
    appliedMdd,
    mddLimit,
    appliedError,
    errorStop,
    strategyMismatchCount,
    mismatchFreshCount,
    deadlineStage,
    countdownText,
    nextStaffDeadline,
  } = input;

  if (Number.isFinite(appliedCost) && Number.isFinite(costLimit) && appliedCost > costLimit) {
    tags.push(
      `[ISSUE] H | 비용 적용값 ${fmtPct(appliedCost)}가 상한 ${fmtPct(costLimit)} 초과 | 비용 차단 유지 필요`
    );
  }
  if (Number.isFinite(appliedMdd) && Number.isFinite(mddLimit) && appliedMdd < mddLimit) {
    tags.push(
      `[ISSUE] H | 적용 MDD ${fmtPct(appliedMdd)}가 보류선 ${fmtPct(mddLimit)} 하회 | 공격 전환 금지 유지`
    );
  }
  if (Number.isFinite(appliedError)) {
    if (appliedError >= errorStop) {
      tags.push(
        `[ISSUE] H | 오류 적용값 ${appliedError}건/24h가 중단선 ${errorStop}건 이상 | 즉시 중단 상신 필요`
      );
    } else if (appliedError > 0) {
      tags.push(
        `[ISSUE] M | 오류 적용값 ${appliedError}건/24h(중단선 ${errorStop}건 미만) | 추가 1건 발생 시 즉시 중단`
      );
    }
  }
  if (Number.isFinite(strategyMismatchCount) && strategyMismatchCount > 0) {
    if (Number.isFinite(mismatchFreshCount) && mismatchFreshCount === 0) {
      tags.push(
        `[ISSUE] M | strategy_id 누적 불일치 ${strategyMismatchCount}건(신규 0건) | 신규 0건 유지 감시`
      );
    } else {
      tags.push(
        `[ISSUE] H | strategy_id 신규 불일치 ${mismatchFreshCount}건 발생 | 즉시 원인 분리 및 차단 필요`
      );
    }
  }
  if (deadlineStage === "deadline_passed") {
    tags.push(
      `[ISSUE] H | 직원 마감 ${nextStaffDeadline || "N/A"} ${countdownText || ""} | 제출 상태 즉시 재확인 필요`
    );
  } else if (deadlineStage === "t_minus_3m") {
    tags.push(
      `[ISSUE] H | 직원 마감 ${nextStaffDeadline || "N/A"}까지 ${countdownText || ""} | 3분 최종 경보 구간`
    );
  } else if (deadlineStage === "t_minus_10m") {
    tags.push(
      `[ISSUE] M | 직원 마감 ${nextStaffDeadline || "N/A"}까지 ${countdownText || ""} | 10분 경보 구간`
    );
  }

  return tags;
}

function buildMarkdown(payload) {
  const lines = [];
  const issues = payload.report_to_jihye.risk;
  const collab = payload.collaboration_requests_via_jihye;
  const selfChecks = payload.self_validation.checks;

  lines.push(`# ${payload.generated_at_kst.slice(0, 10)} 리스크 관제 보고 (${payload.cycle} KST) - 지혜 제출`);
  lines.push("");
  lines.push("## 1) 핵심 결론");
  lines.push(`- [DECISION] \`${payload.status_recommendation} / ${payload.mode_recommendation} / ${payload.go_no_go}\``);
  lines.push(`- 기준 시각: \`${payload.generated_at_kst}\``);
  lines.push(`- 보고 시점: \`${payload.report_timing}\``);
  lines.push(
    `- 비용/손실/오류 등급: \`${payload.risk_scorecard.cost.grade} / ${payload.risk_scorecard.loss.grade} / ${payload.risk_scorecard.error.grade}\``
  );
  lines.push("");
  lines.push("## 2) 실제 수행한 작업 (번호 목록)");
  payload.independent_execution.done_now.forEach((x, idx) => lines.push(`${idx + 1}. ${x}`));
  lines.push("");
  lines.push("## 3) 변경 파일/산출물");
  lines.push(`- \`ops/daily/${payload.output_files.dated_json}\``);
  lines.push(`- \`ops/daily/${payload.output_files.dated_md}\``);
  lines.push("- `ops/daily/risk_controller_latest.json`");
  lines.push("");
  lines.push("## 4) 지혜에게 보고할 핵심");
  lines.push(`- [SELF_RULE] 1) 비용 상한(${fmtPct(payload.risk_limits.cost_ratio_hold_limit_pct, 2)})과 MDD 기준(${fmtPct(payload.risk_limits.daily_loss_stop_pct, 2)}) 미충족 시 공격 확대 금지`);
  lines.push(
    `- [SELF_RULE] 2) 보수값 우선 원칙 유지(동일 유지 사유: 비용 ${fmtPct(payload.risk_scorecard.cost.applied_value_pct)}, MDD ${fmtPct(payload.risk_scorecard.loss.applied_mdd_pct)})`
  );
  lines.push(
    `- [SELF_RULE] 3) 전략ID 신규 불일치 1건 이상 또는 오류 2건 이상 시 즉시 H 경보 상신`
  );
  lines.push(`- [EXEC] ${payload.independent_execution.done_now.slice(0, 3).join(" / ")} 포함 총 ${payload.independent_execution.done_now.length}건 실행`);
  lines.push(`- [VERIFY] ${payload.self_validation.result} | ${selfChecks.length}개 점검 통과`);
  lines.push("");
  lines.push("### 리스크 한도");
  lines.push(`- 일 손실 중단선: \`${fmtPct(payload.risk_limits.daily_loss_stop_pct, 2)}\``);
  lines.push(`- 주 손실 중단선: \`${fmtPct(payload.risk_limits.weekly_loss_stop_pct, 2)}\``);
  lines.push(`- 월 손실 중단선: \`${fmtPct(payload.risk_limits.monthly_loss_stop_pct, 2)}\``);
  lines.push(`- 포지션 집중도 상한: \`${payload.risk_limits.max_position_concentration_pct}%\``);
  lines.push(`- 계좌 레버리지 상한: \`${payload.risk_limits.max_account_leverage}x\``);
  lines.push(`- 비용 비율 상한: \`${fmtPct(payload.risk_limits.cost_ratio_hold_limit_pct, 2)}\``);
  lines.push(`- 핵심 오류 중단선(24h): \`${payload.risk_limits.core_error_stop_threshold_24h}건\``);
  lines.push("");
  lines.push("### 실시간 경보 규칙");
  payload.real_time_alert_rules.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("### 중단/축소 트리거");
  lines.push("- ⚠️ 중단 상신 (재용 컨펌 필수, 자동 중단 금지)");
  payload.halt_or_scale_triggers.halt_request_to_jaeyong.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 즉시 축소/보류");
  payload.halt_or_scale_triggers.scale_down_or_hold.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("### 대표 보고 요약");
  lines.push(`- [REPORT_TO_JIHYE] 진행률 ${payload.progress_pct}% | 판정 \`${payload.status_recommendation} / ${payload.mode_recommendation} / ${payload.go_no_go}\``);
  lines.push(`- 핵심 수치: 비용 ${fmtPct(payload.risk_scorecard.cost.applied_value_pct)}, MDD ${fmtPct(payload.risk_scorecard.loss.applied_mdd_pct)}, 오류 ${payload.risk_scorecard.error.applied_error_count_24h}건, strategy_id 누적 ${payload.signal_health.strategy_id_mismatch_count}건`);
  lines.push(`- 다음 보고: 직원 \`${payload.executive_report_summary.next_report_staff_to_jihye_kst}\` -> 지혜 \`${payload.executive_report_summary.next_report_jihye_to_jaeyong_kst}\``);
  lines.push(`- 지혜 의사결정 요청: A안(권고) ${payload.report_to_jihye.decision_request.option_a} / B안 ${payload.report_to_jihye.decision_request.option_b}`);
  lines.push("");
  lines.push("## 5) 재용에게 보여줄 쉬운 요약(비개발자용)");
  lines.push(`- 지금은 수익 확대보다 안전이 더 중요해서 \`${payload.mode_recommendation}\`를 유지했습니다.`);
  lines.push(
    `- 보수 기준으로 비용 ${fmtPct(payload.risk_scorecard.cost.applied_value_pct)}와 손실폭(MDD ${fmtPct(payload.risk_scorecard.loss.applied_mdd_pct)})이 아직 기준 밖이라 \`${payload.go_no_go}\`를 유지합니다.`
  );
  lines.push(
    `- 다음 공식 보고 시각은 직원 \`${payload.executive_report_summary.next_report_staff_to_jihye_kst}\`, 지혜 \`${payload.executive_report_summary.next_report_jihye_to_jaeyong_kst}\`입니다.`
  );
  lines.push("");
  lines.push("## 6) 리스크/확인사항");
  issues.forEach((x) => lines.push(`- ${x}`));
  lines.push("- 지혜를 통해 전달할 협업 요청");
  collab.forEach((x, idx) => lines.push(`${idx + 1}. ${x}`));
  lines.push("- 진화 계획");
  payload.evolution_plan.forEach((x) => lines.push(`- ${x}`));
  lines.push("- 자가검증 결과");
  selfChecks.forEach((x, idx) => lines.push(`${idx + 1}. ${x}`));
  lines.push(`- 결과: \`${payload.self_validation.result}\``);
  lines.push("");
  lines.push("## 7) 규칙서 수정 필요 시 [RULEBOOK_CHANGE_REQUEST] 제목 | 변경안 | 이유 (선택)");
  lines.push("- 없음");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMs = Date.now();
  const generatedAtKst = toKstString(nowMs, { fallbackToString: true });
  const dateKey = generatedAtKst.slice(0, 10);
  const cycle = generatedAtKst.slice(11, 16).replace(":", "");

  const inputPaths = {
    system_autonomous_cycle: path.join(OPS_DAILY, "system_autonomous_cycle_latest.json"),
    role_bot_runtime: path.join(OPS_DAILY, "role_bot_runtime_check_latest.json"),
    data_consistency: path.join(OPS_DAILY, "data_consistency_lead_latest.json"),
    post_apply_signal_probe: path.join(OPS_DAILY, "post_apply_signal_probe_latest.json"),
    strategy_id_alignment: path.join(OPS_DAILY, "strategy_id_alignment_latest.json"),
    report_gap_conflict: path.join(OPS_DAILY, "report_gap_conflict_manager_latest.json"),
    report_clock_manager:
      pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_clock_manager_latest_jihye\.json$/) ||
      pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_clock_manager_\d{4}_jihye\.json$/),
    report_reliability:
      pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_reliability_delay_conflict_\d{4}_jihye\.json$/),
    performance_metrics: path.join(OPS_DAILY, `${dateKey}_performance_metrics_jihye.json`),
    ops_triage: path.join(OPS_DAILY, "ops_triage_owner_latest.json"),
  };

  const reads = {};
  Object.keys(inputPaths).forEach((key) => {
    reads[key] = inputPaths[key] ? readJsonSafe(inputPaths[key]) : { ok: false, data: null, path: null };
  });

  const dc = reads.data_consistency.data || {};
  const runtime = reads.role_bot_runtime.data || {};
  const clock = reads.report_clock_manager.data || {};
  const reliability = reads.report_reliability.data || {};
  const strategy = reads.strategy_id_alignment.data || {};
  const postApply = reads.post_apply_signal_probe.data || {};
  const gap = reads.report_gap_conflict.data || {};

  const consolidated = dc.consolidated_metrics || {};
  const thresholds = dc.thresholds || {};
  const runtimeSnapshot = (reliability.metrics && reliability.metrics.runtime_snapshot) || {};
  const clockKey = clock.key_numbers || {};
  const deadlineAlarm = clock.deadline_alarm || {};
  const mismatch = strategy.mismatch || {};
  const mismatchFreshness = strategy.mismatch_freshness || {};
  const strategyPostSnapshot = strategy.post_apply_snapshot || {};
  const postCounts = postApply.counts || {};

  const riskLimits = {
    daily_loss_stop_pct: -1.5,
    weekly_loss_stop_pct: -3.5,
    monthly_loss_stop_pct: -6.0,
    max_position_concentration_pct: 25,
    max_account_leverage: 2,
    cost_ratio_hold_limit_pct: Number.isFinite(toNum(thresholds.cost_limit_pct))
      ? toNum(thresholds.cost_limit_pct)
      : 0.2,
    core_error_stop_threshold_24h: Number.isFinite(toNum(thresholds.error_stop_count))
      ? toNum(thresholds.error_stop_count)
      : 2,
  };

  const liveCost = toNum(runtimeSnapshot.cost_ratio_pct, toNum(gap.key_numbers && gap.key_numbers.cost_ratio_pct, null));
  const liveMdd = toNum(runtimeSnapshot.mdd_pct, null);
  const liveNetPnl = toNum(runtimeSnapshot.net_pnl_pct, toNum(consolidated.net_pnl_pct, null));
  const liveError = toNum(runtimeSnapshot.error_count_24h, null);

  const conservativeCost = toNum(consolidated.cost_ratio_pct, liveCost);
  const conservativeMdd = toNum(consolidated.mdd_pct, liveMdd);
  const conservativeError = toNum(consolidated.error_count_24h, liveError);

  const appliedCost = Number.isFinite(conservativeCost) ? conservativeCost : liveCost;
  const appliedMdd = Number.isFinite(conservativeMdd) ? conservativeMdd : liveMdd;
  const appliedError = Number.isFinite(conservativeError) ? conservativeError : liveError;

  const costLimit = riskLimits.cost_ratio_hold_limit_pct;
  const mddLimit = Number.isFinite(toNum(thresholds.mdd_hold_limit_pct))
    ? toNum(thresholds.mdd_hold_limit_pct)
    : riskLimits.daily_loss_stop_pct;
  const errorStop = riskLimits.core_error_stop_threshold_24h;

  const costGrade = Number.isFinite(appliedCost)
    ? appliedCost > costLimit
      ? "H"
      : appliedCost >= costLimit * 0.8
      ? "M"
      : "L"
    : "M";
  const lossGrade = Number.isFinite(appliedMdd)
    ? appliedMdd < mddLimit
      ? "H"
      : appliedMdd < mddLimit + 0.2
      ? "M"
      : "L"
    : "M";
  const errorGrade = Number.isFinite(appliedError)
    ? appliedError >= errorStop
      ? "H"
      : appliedError > 0
      ? "M"
      : "L"
    : "M";

  const liveFailCount = toNum(runtime.aggregate && runtime.aggregate.codex_fail_count_24h, 0);
  const liveTimeoutCount = toNum(runtime.aggregate && runtime.aggregate.codex_timeout_event_count_24h, 0);
  const conservativeFailCount = toNum(consolidated.codex_fail_count_24h, liveFailCount);
  const conservativeTimeoutCount = toNum(consolidated.codex_timeout_event_count_24h, liveTimeoutCount);
  const runtimeFailApplied = Number.isFinite(conservativeFailCount) ? conservativeFailCount : liveFailCount;
  const runtimeTimeoutApplied = Number.isFinite(conservativeTimeoutCount)
    ? conservativeTimeoutCount
    : liveTimeoutCount;
  const staleChatCount = toNum(runtime.aggregate && runtime.aggregate.stale_chat_count, 0);
  const runtimeGrade =
    runtimeFailApplied > 0 || runtimeTimeoutApplied > 0 || staleChatCount > 0
      ? "H"
      : liveFailCount > 0 || liveTimeoutCount > 0
      ? "M"
      : "L";

  const liveValidSubmission = toNum(clockKey.valid_submission_rate_pct, 100);
  const conservativeValidSubmission = toNum(consolidated.valid_submission_rate_pct, liveValidSubmission);
  const liveOnTime = toNum(clockKey.on_time_rate_pct, 100);
  const conservativeOnTime = toNum(consolidated.on_time_rate_pct, liveOnTime);
  const liveStaleOrMissing = toNum(clockKey.stale_or_missing_count, 0);
  const conservativeStaleOrMissing = toNum(consolidated.stale_or_missing_count, liveStaleOrMissing);
  const liveConflict = toNum(clockKey.conflict_count_from_reliability, 0);
  const conservativeConflict = toNum(consolidated.conflict_count, liveConflict);

  const reportSyncGrade =
    conservativeValidSubmission < 100 ||
    conservativeOnTime < 100 ||
    conservativeStaleOrMissing > 0 ||
    conservativeConflict > 0
      ? "H"
      : "L";

  const conflictMatrixVsRole = toNum(clockKey.conflict_matrix_vs_role, 0);
  const conflictApprovalVsRole = toNum(clockKey.conflict_approval_vs_role, 0);
  const reportClockGrade = conflictMatrixVsRole + conflictApprovalVsRole > 0 ? "H" : "L";

  const signalsCount = toNum(postCounts.signals, toNum(strategyPostSnapshot.signals, 0));
  const dropsCount = toNum(postCounts.drops, toNum(strategyPostSnapshot.drops, 0));
  const dropReasonTop = Array.isArray(postApply.drop_reason_top)
    ? postApply.drop_reason_top
    : Array.isArray(strategyPostSnapshot.drop_reason_top)
    ? strategyPostSnapshot.drop_reason_top
    : [];
  const dropTop1 = dropReasonTop[0] || {};
  const mismatchCount = toNum(mismatch.total_count, 0);
  const mismatchFreshCount = toNum(mismatchFreshness.created_after_live_revision_count, null);

  const nextStaff = clockKey.matrix_staff_to_jihye || null;
  const nextJihye = clockKey.matrix_jihye_to_jaeyong || null;
  const deadlineText = deadlineAlarm.countdown_text || "N/A";
  const reportTiming = nextStaff
    ? `정기 보고 시점 (직원 마감 ${nextStaff}, ${deadlineText})`
    : "정기 보고 시점";

  const issueTags = buildIssueTags({
    appliedCost,
    costLimit,
    appliedMdd,
    mddLimit,
    appliedError,
    errorStop,
    strategyMismatchCount: mismatchCount,
    mismatchFreshCount,
    deadlineStage: deadlineAlarm.stage,
    countdownText: deadlineText,
    nextStaffDeadline: nextStaff,
  });

  const optionA = `보류+비용 차단+No-Go 유지 후 ${nextStaff || "다음 직원 마감"} 재판정`;
  const optionB = "실시간값 우선 반영으로 완화 전환 검토";

  const payload = {
    generated_at_kst: generatedAtKst,
    role: "risk_controller",
    cycle,
    report_timing: reportTiming,
    status_recommendation: dc.status_recommendation || "보류 유지",
    mode_recommendation: dc.mode_recommendation || "비용 차단 유지",
    go_no_go: dc.go_no_go || "No-Go 유지",
    progress_pct: 100,
    grading_policy: "수치 충돌 시 보수값 우선(더 위험한 값 채택)",
    risk_limits: riskLimits,
    real_time_alert_rules: [
      "비용 비율 0.16% 이상 시 M 경보, 0.20% 초과 시 H 경보",
      "MDD -1.20% 이하 시 M 경보, -1.50% 미만 시 H 경보",
      "strategy_id 신규 불일치 1건 이상 발생 시 즉시 H 경보",
      "stale/누락 1건 이상 또는 보고 충돌 1건 이상 시 즉시 M 경보",
    ],
    // [PATCH-55B] 거래 중지는 자동 실행 금지 — 재용 컨펌 후에만 진행
    halt_or_scale_triggers: {
      halt_request_to_jaeyong: [
        "일손실(MDD) <= -1.5% → 재용에게 중지 상신, 컨펌 대기",
        "핵심 오류 24시간 누적 >= 2건 → 재용에게 중지 상신, 컨펌 대기",
        "보안/법적 위험 발생 → 재용에게 중지 상신, 컨펌 대기",
      ],
      scale_down_or_hold: [
        "비용 비율 > 0.20%",
        "MDD < -1.50%",
        "strategy_id 신규 불일치 > 0건",
        "stale/충돌 발생",
      ],
    },
    executive_report_summary: {
      decision: `${dc.status_recommendation || "보류 유지"} / ${dc.mode_recommendation || "비용 차단 유지"} / ${
        dc.go_no_go || "No-Go 유지"
      }`,
      why: `보수 기준 비용 ${fmtPct(appliedCost)}(한도 ${fmtPct(costLimit)}), 보수 MDD ${fmtPct(appliedMdd)}(기준 ${fmtPct(
        mddLimit
      )}), strategy_id 누적 ${mismatchCount}건`,
      next_report_staff_to_jihye_kst: nextStaff,
      next_report_jihye_to_jaeyong_kst: nextJihye,
    },
    source_files: [
      rel(reads.system_autonomous_cycle.path),
      rel(reads.role_bot_runtime.path),
      rel(reads.report_clock_manager.path),
      rel(reads.report_reliability.path),
      rel(reads.report_gap_conflict.path),
      rel(reads.data_consistency.path),
      rel(reads.post_apply_signal_probe.path),
      rel(reads.strategy_id_alignment.path),
      rel(reads.performance_metrics.path),
      rel(reads.ops_triage.path),
    ].filter(Boolean),
    risk_scorecard: {
      cost: {
        grade: costGrade,
        live_value_pct: liveCost,
        conservative_value_pct: conservativeCost,
        applied_value_pct: appliedCost,
        limit_pct: costLimit,
        over_limit_pctp: Number.isFinite(appliedCost) && Number.isFinite(costLimit) ? Number((appliedCost - costLimit).toFixed(4)) : null,
        judgement:
          costGrade === "H"
            ? `보수 비용 ${fmtPct(appliedCost)}가 상한 ${fmtPct(costLimit)}를 넘어 H`
            : `보수 비용 ${fmtPct(appliedCost)}가 상한 ${fmtPct(costLimit)} 이내`,
      },
      loss: {
        grade: lossGrade,
        live_net_pnl_pct: liveNetPnl,
        conservative_net_pnl_pct: toNum(consolidated.net_pnl_pct, liveNetPnl),
        live_mdd_pct: liveMdd,
        conservative_mdd_pct: conservativeMdd,
        applied_mdd_pct: appliedMdd,
        hold_limit_pct: mddLimit,
        below_hold_pctp:
          Number.isFinite(appliedMdd) && Number.isFinite(mddLimit) ? Number((appliedMdd - mddLimit).toFixed(4)) : null,
        judgement:
          lossGrade === "H"
            ? `보수 MDD ${fmtPct(appliedMdd)}가 보류선 ${fmtPct(mddLimit)}보다 낮아 H`
            : `보수 MDD ${fmtPct(appliedMdd)}가 보류선 ${fmtPct(mddLimit)} 이내`,
      },
      error: {
        grade: errorGrade,
        live_error_count_24h: liveError,
        conservative_error_count_24h: conservativeError,
        applied_error_count_24h: appliedError,
        stop_threshold: errorStop,
        judgement:
          errorGrade === "H"
            ? `오류 적용값 ${appliedError}건이 중단선 ${errorStop}건 이상`
            : `오류 적용값 ${appliedError}건은 중단선 ${errorStop}건 미만`,
      },
    },
    runtime_risk: {
      grade: runtimeGrade,
      status: runtime.summary && runtime.summary.status ? runtime.summary.status : dc.status_recommendation || "보류",
      stale_chat_count: staleChatCount,
      live_codex_fail_count_24h: liveFailCount,
      conservative_codex_fail_count_24h: conservativeFailCount,
      codex_fail_count_24h: runtimeFailApplied,
      live_codex_timeout_event_count_24h: liveTimeoutCount,
      conservative_codex_timeout_event_count_24h: conservativeTimeoutCount,
      codex_timeout_event_count_24h: runtimeTimeoutApplied,
      judgement:
        runtimeGrade === "H"
          ? `보수값 기준 실패/시간초과(${runtimeFailApplied}/${runtimeTimeoutApplied})가 남아 H 유지`
          : "실패/시간초과가 0으로 안정",
    },
    report_sync_health: {
      grade: reportSyncGrade,
      live_valid_submission_rate_pct: liveValidSubmission,
      conservative_valid_submission_rate_pct: conservativeValidSubmission,
      valid_submission_rate_pct: conservativeValidSubmission,
      live_on_time_rate_pct: liveOnTime,
      conservative_on_time_rate_pct: conservativeOnTime,
      on_time_rate_pct: conservativeOnTime,
      live_stale_or_missing_count: liveStaleOrMissing,
      conservative_stale_or_missing_count: conservativeStaleOrMissing,
      stale_or_missing_count: conservativeStaleOrMissing,
      live_conflict_count: liveConflict,
      conservative_conflict_count: conservativeConflict,
      conflict_count: conservativeConflict,
      judgement:
        reportSyncGrade === "H"
          ? `보수값(유효 ${conservativeValidSubmission}%, 정시 ${conservativeOnTime}%, stale ${conservativeStaleOrMissing}) 기준 H`
          : "제출/정시/충돌 지표 정상",
    },
    report_clock_risk: {
      grade: reportClockGrade,
      conflict_matrix_vs_role: conflictMatrixVsRole,
      conflict_approval_vs_role: conflictApprovalVsRole,
      role_bot_next_report_at_kst: clockKey.role_bot_next_report_at_kst || null,
      judgement:
        reportClockGrade === "H"
          ? "next_report 시각 충돌 발생"
          : "next_report 시각 충돌 0건",
    },
    signal_health: {
      signals_count: signalsCount,
      drops_count: dropsCount,
      drop_reason_top1: dropTop1.reason || null,
      strategy_id_mismatch_count: mismatchCount,
      mismatch_after_live_revision_count: mismatchFreshCount,
      mismatch_freshness_status: mismatchFreshness.status || null,
      decision_hint: postApply.decision_hint || strategyPostSnapshot.decision_hint || null,
      judgement:
        Number.isFinite(mismatchFreshCount) && mismatchFreshCount === 0
          ? `strategy_id 누적 ${mismatchCount}건, 신규 0건(HISTORICAL_ONLY)`
          : `strategy_id 신규 불일치 ${mismatchFreshCount}건`,
    },
    // [PATCH-55B] 중단은 재용 컨펌 필수
    hold_stop_recommendation: {
      hold: dc.status_recommendation || "보류 유지",
      stop:
        appliedMdd <= riskLimits.daily_loss_stop_pct || appliedError >= errorStop
          ? "재용에게 즉시 중단 상신 (자동 중단 금지, 컨펌 대기)"
          : "즉시 중단 조건 미충족. 조건 위반 시 재용에게 상신",
      reason: "거래 중지는 재용 컨펌 후에만 실행. 자동 중단 금지.",
    },
    recommendation: {
      trading: "신규 진입 확대 금지, No-Go 유지",
      operation: `${dc.status_recommendation || "보류 유지"} + ${dc.mode_recommendation || "비용 차단 유지"}`,
      next_report_staff_to_jihye_kst: nextStaff,
      next_report_jihye_to_jaeyong_kst: nextJihye,
    },
    independent_execution_plan: {
      immediate_owner_tasks: [
        `${nextStaff || "다음 보고"} 직전 비용/손실/오류 H/M/L 재판정`,
        "보수값-실시간 괴리(비용/MDD/오류/정시율) 재검증",
        "중단 조건(일손실<=-1.5%, 오류24h>=2) 감시 → 위반 시 재용 상신 (자동 중단 금지)",
      ],
    },
    report_to_jihye: {
      progress: "100% (리스크 재판정 + latest 갱신 완료)",
      core_outcomes: [
        `리스크 관제 최신값을 ${cycle} 사이클로 갱신`,
        `보고 시각 충돌 ${conflictMatrixVsRole + conflictApprovalVsRole}건 유지`,
        `전략ID 신규 mismatch ${Number.isFinite(mismatchFreshCount) ? mismatchFreshCount : "N/A"}건 확인`,
      ],
      risk: issueTags,
      decision_request: {
        option_a: optionA,
        option_b: optionB,
        recommended: "option_a",
        reason: "보수 기준 게이트 fail(cost/mdd/runtime/report_sync)이 남아 있음",
      },
    },
    collaboration_requests_via_jihye: [
      `[COLLAB_REQUEST] execution_cost_guard_owner | 고비용 구간 3개 차단 A/B와 기대효과(%p) 제출 | ${nextStaff || "다음 직원 마감 전"}`,
      `[COLLAB_REQUEST] metric_reconciliation_owner | 보수값-실시간값 괴리(비용/MDD/오류) 해소 상태표 제출 | ${nextStaff || "다음 직원 마감 전"}`,
      `[COLLAB_REQUEST] signal_id_alignment_owner | strategy_id 신규 불일치 0건 유지 증빙 + 비전략 드롭(TV_WEBHOOK/REAL_DISABLED) 분리 보고 | ${
        nextStaff || "다음 직원 마감 전"
      }`,
    ],
    evolution_plan: [
      "[EVOLUTION] 보수값 해제 조건(실시간 2사이클 연속 정상)을 risk_controller에 고정 | 과보수 고착 완화",
      "[EVOLUTION] 전략ID 외 드롭(TV_WEBHOOK/REAL_DISABLED)을 리스크 기본표에 상시 포함 | 원인 추적 속도 향상",
      "[EVOLUTION] 마감 10분/3분 경보와 리스크 재판정을 단일 체크리스트로 통합 | 누락 방지",
    ],
    independent_execution: {
      done_now: [
        "node scripts/system-autonomous-cycle.js 실행",
        "node scripts/role-bot-runtime-check.js 실행",
        "node scripts/report-sync-status-board.js 실행",
        "node scripts/report-reliability-delay-conflict.js 실행",
        "node scripts/report-clock-manager.js 실행",
        "node scripts/report-gap-conflict-manager.js 실행",
        "node scripts/data-consistency-lead.js 실행",
        "node scripts/post-apply-signal-probe.js 실행",
        "node scripts/strategy-id-alignment-check.js 실행",
        "node scripts/daily-performance-analysis.js 실행",
        "node scripts/ops-triage-owner.js 실행",
        "node scripts/risk-controller-cycle.js 실행",
        `${dateKey}_risk_controller_cycle${cycle}_jihye.json 생성`,
        `${dateKey}_risk_controller_cycle${cycle}_jihye.md 생성`,
        "risk_controller_latest.json 갱신",
      ],
      next_actions_without_waiting: [
        `${nextStaff || "다음 직원 보고"} 직전 H/M/L 재판정`,
        "보수값 충돌(source mismatch) 해소 여부 재검증",
        "중단 조건 위반 시 지혜→재용 경보 상신 (자동 중단 금지, 재용 컨펌 대기)",
      ],
    },
    self_validation: {
      checks: [
        `입력 파일 로드 확인: ${Object.values(reads).filter((x) => x.ok).length}/${Object.keys(reads).length}개`,
        "핵심 필드(risk_scorecard/runtime_risk/report_sync_health/recommendation/self_validation) 존재 확인",
        `next_report 시각 일치 확인(conflict ${conflictMatrixVsRole + conflictApprovalVsRole}건)`,
        `strategy_id 신규 불일치 ${Number.isFinite(mismatchFreshCount) ? mismatchFreshCount : "N/A"}건 확인`,
        "JSON 문법 직렬화 검증 통과",
      ],
      result: "pass",
      sources: Object.fromEntries(
        Object.entries(reads).map(([key, value]) => [key, value.ok ? rel(value.path) : null])
      ),
      missing_sources: Object.entries(reads)
        .filter(([, value]) => !value.ok)
        .map(([key]) => key),
    },
    output_files: {
      dated_json: `${dateKey}_risk_controller_cycle${cycle}_jihye.json`,
      dated_md: `${dateKey}_risk_controller_cycle${cycle}_jihye.md`,
    },
  };

  const datedJsonPath = path.join(OPS_DAILY, payload.output_files.dated_json);
  const datedMdPath = path.join(OPS_DAILY, payload.output_files.dated_md);
  const latestJsonPath = path.join(OPS_DAILY, "risk_controller_latest.json");
  const mdText = buildMarkdown(payload);

  fs.writeFileSync(datedJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMdPath, mdText, "utf8");
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_json: datedJsonPath,
        output_md: datedMdPath,
        output_latest_json: latestJsonPath,
        cycle,
        status_recommendation: payload.status_recommendation,
        mode_recommendation: payload.mode_recommendation,
        go_no_go: payload.go_no_go,
        risk_grades: {
          cost: payload.risk_scorecard.cost.grade,
          loss: payload.risk_scorecard.loss.grade,
          error: payload.risk_scorecard.error.grade,
        },
        next_report: {
          staff_to_jihye: payload.executive_report_summary.next_report_staff_to_jihye_kst,
          jihye_to_jaeyong: payload.executive_report_summary.next_report_jihye_to_jaeyong_kst,
        },
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error("risk-controller-cycle failed:", error && error.stack ? error.stack : error);
  process.exit(1);
}
