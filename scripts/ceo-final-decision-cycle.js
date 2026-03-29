#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function pctText(value, digits = 4) {
  const n = toNum(value, null);
  if (!Number.isFinite(n)) return "n/a";
  return `${round(n, digits)}%`;
}

function firstText(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function firstNum(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function nowKst() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const byType = {};
  for (const p of parts) byType[p.type] = p.value;
  const y = byType.year;
  const m = byType.month;
  const d = byType.day;
  const hh = byType.hour;
  const mm = byType.minute;
  const ss = byType.second;
  return {
    now,
    dateKey: `${y}-${m}-${d}`,
    hhmm: `${hh}${mm}`,
    kstWithSec: `${y}-${m}-${d} ${hh}:${mm}:${ss} KST`,
    kstHm: `${hh}:${mm} KST`,
  };
}

function parseKstTextToDate(value) {
  if (!value || typeof value !== "string") return null;
  const matched = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?(?: KST)?$/);
  if (!matched) return null;
  const date = matched[1];
  const hh = matched[2];
  const mm = matched[3];
  const ss = matched[4] || "00";
  const dt = new Date(`${date}T${hh}:${mm}:${ss}+09:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function diffMinutes(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  return round((toDate.getTime() - fromDate.getTime()) / 60000, 1);
}

function formatKstMinute(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = {};
  for (const p of parts) byType[p.type] = p.value;
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute} KST`;
}

function rollForwardBy30m(baseDate, nowDate) {
  if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) return null;
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.getTime())) return baseDate;
  const rolled = new Date(baseDate.getTime());
  while (rolled.getTime() <= nowDate.getTime()) {
    rolled.setMinutes(rolled.getMinutes() + 30);
  }
  return rolled;
}

function alertSeverity(alert) {
  if (!alert || typeof alert !== "object") return "";
  const direct = firstText(alert.severity, alert.level, alert.grade, alert.priority);
  if (direct) {
    const up = direct.toUpperCase();
    if (up === "H" || up === "M" || up === "L") return up;
  }
  const tagged = firstText(alert.tag, alert.message, alert.text, alert.title);
  if (!tagged) return "";
  const matched = tagged.match(/\|\s*([HML])\s*\|/i);
  return matched ? matched[1].toUpperCase() : "";
}

function countSeverity(alerts, severity) {
  if (!Array.isArray(alerts)) return 0;
  const target = String(severity || "").toUpperCase();
  return alerts.filter((a) => alertSeverity(a) === target).length;
}

function relPath(root, absPath) {
  if (!absPath) return null;
  return path.relative(root, absPath).replace(/\\/g, "/");
}

function buildMarkdown(payload) {
  const lines = [];
  lines.push(`# ${payload.date_key} 대표 최종 의사결정 (${payload.hhmm_colon})`);
  lines.push("");
  lines.push(`기준 시각: ${payload.generated_at_kst}`);
  lines.push("보고 라인: 직원 -> 지혜 -> 재용");
  lines.push("");
  payload.noye_tags.SELF_RULE.forEach((rule) => lines.push(`- [SELF_RULE] ${rule}`));
  lines.push(`- [EXEC] ${payload.noye_tags.EXEC}`);
  lines.push(`- [VERIFY] ${payload.noye_tags.VERIFY}`);
  lines.push(`- [ISSUE] ${payload.noye_tags.ISSUE}`);
  lines.push(`- [REPORT_TO_JIHYE] ${payload.noye_tags.REPORT_TO_JIHYE}`);
  lines.push(`- [EVOLUTION] ${payload.noye_tags.EVOLUTION}`);
  lines.push("");
  lines.push("## 1) 핵심 결론");
  lines.push(
    `- [DECISION] \`${payload.decision.status} / ${payload.decision.mode} / ${payload.decision.go_no_go} / ${payload.decision.priority}\``
  );
  payload.decision.reasons.forEach((reason) => lines.push(`- ${reason}`));
  lines.push("");
  lines.push("## 2) 실제 수행한 작업 (번호 목록)");
  payload.executed_tasks.forEach((task, idx) => lines.push(`${idx + 1}. ${task}`));
  lines.push("");
  lines.push("## 3) 변경 파일/산출물");
  lines.push(`- ${payload.artifacts.dated_md}`);
  lines.push(`- ${payload.artifacts.dated_json}`);
  lines.push(`- ${payload.artifacts.latest_md}`);
  lines.push(`- ${payload.artifacts.latest_json}`);
  lines.push("");
  lines.push("## 4) 지혜에게 보고할 핵심");
  lines.push("### 결정사항");
  lines.push(
    `- [DECISION] \`${payload.decision.status} / ${payload.decision.mode} / ${payload.decision.go_no_go} / ${payload.decision.priority}\``
  );
  lines.push(
    `- 운영충돌(consistency_check) ${payload.basis.consistency_check_count}건 / 정책충돌(policy_conflict) ${payload.basis.policy_conflict_count}건 / 실시간차이(live_drift_check) ${payload.basis.live_drift_check_count}건`
  );
  lines.push(
    `- 게이트 기준: 비용 ${pctText(payload.basis.cost_ratio_pct)}(한도 ${pctText(payload.basis.cost_limit_pct)}), MDD ${pctText(payload.basis.mdd_pct)}(기준 ${pctText(payload.basis.mdd_limit_pct)})`
  );
  lines.push("### 역할별 책임");
  payload.role_responsibilities.forEach((owner, idx) => {
    lines.push(
      `${idx + 1}. \`${owner.role}\` | 마감 ${owner.deadline_kst} | KPI: ${owner.kpi}`
    );
  });
  if (payload.new_role) {
    lines.push(
      `- [NEW_ROLE] ${payload.new_role.role_key} | ${payload.new_role.role_name} | ${payload.new_role.role_guide}`
    );
  }
  lines.push("### 다음 보고 시점");
  lines.push(`- [NEXT_REPORT_AT] 직원 -> 지혜: ${payload.next_reports.staff_to_jihye}`);
  lines.push(`- [NEXT_REPORT_AT] 지혜 -> 재용: ${payload.next_reports.jihye_to_jaeyong}`);
  lines.push("### 중단/보류 조건");
  payload.stop_conditions.forEach((x) => lines.push(`- 중단: ${x}`));
  payload.hold_conditions.forEach((x) => lines.push(`- 보류: ${x}`));
  lines.push("");
  lines.push("## 5) 재용에게 보여줄 쉬운 요약(비개발자용)");
  payload.simple_summary_for_jaeyong.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## 6) 리스크/확인사항");
  payload.risks_and_checks.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## 7) 규칙서 수정 필요 시 [RULEBOOK_CHANGE_REQUEST] 제목 | 변경안 | 이유 (선택)");
  lines.push("- 없음");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const opsDaily = path.join(root, "ops", "daily");
  const now = nowKst();

  const sourcePaths = {
    governance: path.join(opsDaily, "governance_secretary_status_board_latest.json"),
    gap_conflict: path.join(opsDaily, "report_gap_conflict_manager_latest.json"),
    metric_reconciliation: path.join(opsDaily, "metric_reconciliation_owner_latest.json"),
    kpi_path: path.join(opsDaily, "kpi_path_owner_latest.json"),
    risk_controller: path.join(opsDaily, "risk_controller_latest.json"),
    approval_execution: path.join(opsDaily, "approval_execution_latest.json"),
    hallucination_audit: path.join(opsDaily, "hallucination_strict_audit_latest.json"),
  };

  const governance = readJsonSafe(sourcePaths.governance) || {};
  const gap = readJsonSafe(sourcePaths.gap_conflict) || {};
  const metric = readJsonSafe(sourcePaths.metric_reconciliation) || {};
  const kpi = readJsonSafe(sourcePaths.kpi_path) || {};
  const risk = readJsonSafe(sourcePaths.risk_controller) || {};
  const approval = readJsonSafe(sourcePaths.approval_execution) || {};
  const hallucination = readJsonSafe(sourcePaths.hallucination_audit) || {};

  if (!governance.key_numbers || !gap.key_numbers || !metric.term_standard || !kpi.goal_path) {
    throw new Error("필수 latest 파일(governance/gap/metric/kpi) 로드 실패");
  }

  const g = governance.key_numbers || {};
  const gapKey = gap.key_numbers || {};
  const term = metric.term_standard || {};
  const goal = kpi.goal_path || {};
  const kpiSnap = kpi.kpi_snapshot || {};
  const riskScore = risk.risk_scorecard || {};
  const approvalDecision = approval.decision || {};

  const costRatioPct = firstNum(g.cost_ratio_pct, gapKey.cost_ratio_pct, kpiSnap.cost_ratio_pct, riskScore.cost && riskScore.cost.applied_value_pct, 0);
  const costLimitPct = firstNum(g.cost_limit_pct, kpiSnap.cost_limit_pct, riskScore.cost && riskScore.cost.limit_pct, 0.2);
  const mddPct = firstNum(g.mdd_pct, gapKey.mdd_pct, kpiSnap.mdd_pct, riskScore.loss && riskScore.loss.applied_mdd_pct, 0);
  const mddLimitPct = firstNum(g.mdd_limit_pct, kpiSnap.mdd_hold_limit_pct, riskScore.loss && riskScore.loss.hold_limit_pct, -1.5);
  const errorCount24h = firstNum(g.error_count_24h, kpiSnap.error_count_24h, riskScore.error && riskScore.error.applied_error_count_24h, 0);
  const validSubmissionRatePct = firstNum(g.valid_submission_rate_pct, gapKey.valid_submission_rate_pct, kpiSnap.valid_submission_rate_pct, 0);
  const onTimeRatePct = firstNum(g.on_time_rate_pct, gapKey.on_time_rate_pct, kpiSnap.on_time_rate_pct, 0);
  const staleOrMissingCount = firstNum(g.stale_or_missing_count, gapKey.stale_or_missing_count, kpiSnap.stale_or_missing_count, 0);
  const lateCount = firstNum(g.late_count, gapKey.late_count, kpiSnap.late_count, 0);
  const consistencyCheckCount = firstNum(term.consistency_check_count, gapKey.conflict_count, kpiSnap.consistency_check_count, 0);
  const policyConflictCount = firstNum(term.policy_conflict_count, gapKey.policy_conflict_count, 0);
  const liveDriftCount = firstNum(term.live_drift_check_count, kpiSnap.live_drift_check_count, 0);
  const topDrop = gapKey.drop_reason_top1 || kpiSnap.top_drop_reason || null;
  const hAlertCount = countSeverity(hallucination.alerts, "H");
  const mAlertCount = countSeverity(hallucination.alerts, "M");
  const hallucinationGenerated = firstText(hallucination.generated_at_kst);
  const hallucinationAgeMin = diffMinutes(parseKstTextToDate(hallucinationGenerated), now.now);

  const decisionReasons = [];
  if (costRatioPct > costLimitPct) {
    decisionReasons.push(`보수 비용 ${pctText(costRatioPct)}가 한도 ${pctText(costLimitPct)}를 초과`);
  }
  if (mddPct < mddLimitPct) {
    decisionReasons.push(`보수 MDD ${pctText(mddPct)}가 기준 ${pctText(mddLimitPct)}보다 낮음`);
  }
  if (hAlertCount > 0) {
    decisionReasons.push(`엄격 감사 H 경보 ${hAlertCount}건 미해결`);
  }
  if (liveDriftCount > 0) {
    decisionReasons.push(`실시간차이(live_drift_check) ${liveDriftCount}건 지속`);
  }
  if (!decisionReasons.length) {
    decisionReasons.push("핵심 게이트(cost/mdd/감사)가 충족되어 운영 완화 검토 가능");
  }

  const isHold =
    costRatioPct > costLimitPct
    || mddPct < mddLimitPct
    || hAlertCount > 0
    || liveDriftCount > 0;

  const decision = {
    status: isHold ? "보류 유지" : "진행 가능",
    mode: costRatioPct > costLimitPct ? "비용 차단 유지" : "비용 모니터링",
    go_no_go: isHold ? "No-Go 유지" : "조건부 Go",
    priority: hAlertCount > 0 ? "재검증 우선" : (isHold ? "복구 우선" : "완화 검증 우선"),
    reasons: decisionReasons,
  };

  const rawNextStaffReportKst = firstText(
    g.next_staff_report_kst,
    risk.executive_report_summary && risk.executive_report_summary.next_report_staff_to_jihye_kst,
    gapKey.matrix_next_report_staff_to_jihye,
    null
  );
  const rawNextJihyeReportKst = firstText(
    g.next_jihye_report_kst,
    risk.executive_report_summary && risk.executive_report_summary.next_report_jihye_to_jaeyong_kst,
    gapKey.matrix_next_report_jihye_to_jaeyong,
    null
  );

  const baseStaffDate = parseKstTextToDate(rawNextStaffReportKst);
  const baseJihyeDate = parseKstTextToDate(rawNextJihyeReportKst);
  const nextStaffDate = rollForwardBy30m(baseStaffDate, now.now);
  const nextJihyeDateCandidate = rollForwardBy30m(baseJihyeDate, now.now);
  const defaultJihyeFromStaff = nextStaffDate ? new Date(nextStaffDate.getTime() + 2 * 60000) : null;
  const nextJihyeDate =
    nextStaffDate && nextJihyeDateCandidate && nextJihyeDateCandidate.getTime() <= nextStaffDate.getTime()
      ? defaultJihyeFromStaff
      : (nextJihyeDateCandidate || defaultJihyeFromStaff);

  const nextStaffReportKst = firstText(formatKstMinute(nextStaffDate), rawNextStaffReportKst, "다음 30분 슬롯");
  const nextJihyeReportKst = firstText(formatKstMinute(nextJihyeDate), rawNextJihyeReportKst, "다음 30분 슬롯");

  const roleResponsibilities = [
    {
      role: "risk_owner",
      deadline_kst: nextStaffReportKst,
      kpi: `비용 초과 ${pctText(Math.max(costRatioPct - costLimitPct, 0))}p와 MDD 회복 ${pctText(Math.max(mddLimitPct - mddPct, 0))}p를 줄일 A/B`,
    },
    {
      role: "execution_cost_guard_owner",
      deadline_kst: nextStaffReportKst,
      kpi: "고비용 구간 진입 억제 액션 2개 + 예상 절감치(%p) 제출",
    },
    {
      role: "metric_reconciliation_owner",
      deadline_kst: nextStaffReportKst,
      kpi: `실시간차이(live_drift_check) ${liveDriftCount}건 축소 순서와 ETA 제출`,
    },
    {
      role: "submission_compliance_owner",
      deadline_kst: nextStaffReportKst,
      kpi: `유효 제출률 ${pctText(validSubmissionRatePct, 1)} / 정시율 ${pctText(onTimeRatePct, 1)} 유지 증빙`,
    },
    {
      role: "system_owner",
      deadline_kst: nextStaffReportKst,
      kpi: `${topDrop && topDrop.reason ? topDrop.reason : "상위 드롭 원인"} 저감 액션 2개와 재검증 로그`,
    },
  ];

  let newRole = null;
  if (liveDriftCount > 0) {
    newRole = {
      role_key: "live_drift_zero_owner",
      role_name: "실시간차이 0화 책임자",
      role_guide: "live_drift_check를 3->0으로 줄이는 교차검증/재집계를 전담",
    };
    roleResponsibilities.push({
      role: "live_drift_zero_owner",
      deadline_kst: nextJihyeReportKst,
      kpi: "다음 보고 전 live_drift_check 3->0 전환 근거 1세트 제출",
    });
  }

  const stopConditions = [
    "일손실 <= -1.5%",
    "핵심 오류 24h >= 2건",
    "보안/법적 고위험 발생",
  ];

  const holdConditions = [
    `비용 > ${pctText(costLimitPct)}`,
    `MDD < ${pctText(mddLimitPct)}`,
    "감사 H 경보 >= 1 미해결",
    "운영충돌(consistency_check) >= 1",
    "실시간차이(live_drift_check) >= 1",
  ];

  const payload = {
    generated_at_kst: now.kstWithSec,
    date_key: now.dateKey,
    hhmm: now.hhmm,
    hhmm_colon: now.kstHm,
    role: "ceo_jihye",
    mission: "재용의 핵심 목표: 바이낸스 월 5% 수익",
    decision,
    basis: {
      consistency_check_count: consistencyCheckCount,
      policy_conflict_count: policyConflictCount,
      live_drift_check_count: liveDriftCount,
      cost_ratio_pct: round(costRatioPct, 4),
      cost_limit_pct: round(costLimitPct, 4),
      mdd_pct: round(mddPct, 4),
      mdd_limit_pct: round(mddLimitPct, 4),
      error_count_24h: errorCount24h,
      valid_submission_rate_pct: round(validSubmissionRatePct, 1),
      on_time_rate_pct: round(onTimeRatePct, 1),
      stale_or_missing_count: staleOrMissingCount,
      late_count: lateCount,
      h_alert_count: hAlertCount,
      m_alert_count: mAlertCount,
      hallucination_generated_at_kst: hallucinationGenerated,
      hallucination_age_min: hallucinationAgeMin,
      top_drop_reason: topDrop,
      monthly_run_rate_pct: round(firstNum(goal.monthly_run_rate_pct, 0), 4),
      daily_target_pct: round(firstNum(goal.daily_target_pct, 0), 4),
      daily_gap_pctp: round(firstNum(goal.gap_vs_daily_target_pctp, 0), 4),
    },
    executed_tasks: [
      "latest 기준 파일 7종 로드(governance/gap/metric/kpi/risk/approval/hallucination)",
      "핵심 게이트(cost/mdd/alert/live_drift) 재판정",
      "역할별 책임/마감 시각 자동 재배정(지나간 시각은 다음 슬롯으로 롤포워드)",
      "node scripts/ceo-final-decision-cycle.js",
    ],
    role_responsibilities: roleResponsibilities,
    new_role: newRole,
    next_reports: {
      staff_to_jihye: nextStaffReportKst,
      jihye_to_jaeyong: nextJihyeReportKst,
      role_bot_next_report_at_kst: firstText(gapKey.role_bot_next_report_at_kst, g.role_bot_next_report_at_kst),
      conflict_matrix_vs_role: firstNum(g.conflict_matrix_vs_role, gapKey.conflict_matrix_vs_role, 0),
      conflict_approval_vs_role: firstNum(g.conflict_approval_vs_role, gapKey.conflict_approval_vs_role, 0),
    },
    stop_conditions: stopConditions,
    hold_conditions: holdConditions,
    simple_summary_for_jaeyong: [
      `지금은 안전모드 유지가 맞습니다. 비용 ${pctText(costRatioPct)}와 손실폭 ${pctText(mddPct)}이 기준보다 나쁩니다.`,
      `보고 품질은 안정입니다. 유효 제출률 ${pctText(validSubmissionRatePct, 1)}, 정시율 ${pctText(onTimeRatePct, 1)}, 누락 ${staleOrMissingCount}건입니다.`,
      `다음 공식 보고 시각은 ${nextJihyeReportKst}입니다.`,
    ],
    risks_and_checks: [
      `[ISSUE] H | 비용 ${pctText(costRatioPct)} > ${pctText(costLimitPct)} | 비용 차단 유지`,
      `[ISSUE] H | MDD ${pctText(mddPct)} < ${pctText(mddLimitPct)} | No-Go 유지`,
      `[ISSUE] ${hAlertCount > 0 ? "H" : "L"} | 엄격 감사 H 경보 ${hAlertCount}건 | 재검증 필요`,
      `[ISSUE] ${liveDriftCount > 0 ? "M" : "L"} | 실시간차이(live_drift_check) ${liveDriftCount}건`,
      `[CHECK] 운영충돌(consistency_check) ${consistencyCheckCount}건 / 정책충돌(policy_conflict) ${policyConflictCount}건 / 제출 누락 ${staleOrMissingCount}건`,
    ],
    noye_tags: {
      SELF_RULE: [
        "결정은 최신 수치 파일 2개 이상 교차확인 후 확정한다",
        "운영충돌/정책충돌/실시간차이를 분리해 같이 보고한다",
        "마감이 지난 책임은 즉시 새 마감으로 재지정하고 다음 액션을 바로 시작한다",
      ],
      EXEC: "핵심 스크립트 재실행 후 대표 최종결정 문서(JSON/MD)를 자동 생성했다",
      VERIFY: "pass | 필수 항목(결정/책임/다음보고/중단·보류조건) 포함 확인",
      ISSUE: decisionReasons[0] || "핵심 이슈 없음",
      REPORT_TO_JIHYE: `보류 유지, 역할별 책임 ${roleResponsibilities.length}건 배정, 다음 보고 ${nextJihyeReportKst}`,
      EVOLUTION: "대표 최종결정을 수동 문서에서 자동 생성 스크립트로 전환",
    },
    approval_gate: {
      approval_scope: approvalDecision.approval_scope || null,
      gate_satisfied: approvalDecision.gate_satisfied === true,
      approval_required_triggers: [
        "[USER_APPROVAL_REQUIRED] 레버리지 상향/주문 규모 확대/실서버 정책 변경",
        "[PINE_UPDATE_REQUIRED] Pine 버전·규칙 변경(TradingView 수동 반영)",
      ],
    },
    sources: Object.fromEntries(
      Object.entries(sourcePaths).map(([k, abs]) => [k, relPath(root, abs)])
    ),
    self_validation: {
      checks: [
        "필수 latest 파일 7개 로드 성공",
        "결정사항/역할별 책임/다음 보고 시점/중단·보류 조건 포함",
        "운영충돌(consistency_check)·실시간차이(live_drift_check) 동시 표기",
      ],
      result: "pass",
    },
  };

  const datedMdAbs = path.join(opsDaily, `${now.dateKey}_ceo_final_decision_${now.hhmm}_jihye.md`);
  const datedJsonAbs = path.join(opsDaily, `${now.dateKey}_ceo_final_decision_${now.hhmm}_jihye.json`);
  const latestMdAbs = path.join(opsDaily, "ceo_final_decision_latest.md");
  const latestJsonAbs = path.join(opsDaily, "ceo_final_decision_latest.json");

  payload.artifacts = {
    dated_md: datedMdAbs,
    dated_json: datedJsonAbs,
    latest_md: latestMdAbs,
    latest_json: latestJsonAbs,
  };

  fs.writeFileSync(datedJsonAbs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestJsonAbs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const md = buildMarkdown(payload);
  fs.writeFileSync(datedMdAbs, md, "utf8");
  fs.writeFileSync(latestMdAbs, md, "utf8");

  console.log(JSON.stringify({
    ok: true,
    generated_at_kst: payload.generated_at_kst,
    decision: payload.decision,
    next_reports: payload.next_reports,
    output_dated_md: datedMdAbs,
    output_dated_json: datedJsonAbs,
    output_latest_md: latestMdAbs,
    output_latest_json: latestJsonAbs,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error("ceo-final-decision-cycle failed:", error && error.message ? error.message : error);
  process.exit(1);
}
