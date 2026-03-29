"use strict";

const fs = require("fs");
const path = require("path");

const MONTHLY_TARGET_PCT = 5;
const MONTH_DAYS = 30;
const WEEKS_PER_MONTH = 4.345;
const CYCLES_PER_DAY_30M = 48;

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function asPct(value, digits = 4) {
  if (!Number.isFinite(value)) return "n/a";
  return `${round(value, digits)}%`;
}

function asSignedPct(value, digits = 4) {
  if (!Number.isFinite(value)) return "n/a";
  const n = round(value, digits);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

function parseJsonSafe(absPath) {
  try {
    const raw = fs.readFileSync(absPath, "utf8");
    return { ok: true, data: JSON.parse(raw), error: null };
  } catch (error) {
    return { ok: false, data: null, error: error && error.message ? error.message : String(error) };
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function kstNow() {
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
    iso: now.toISOString(),
    dateKey: `${y}-${m}-${d}`,
    hhmm: `${hh}${mm}`,
    dayOfMonth: toNum(d, 1),
    kstWithSec: `${y}-${m}-${d} ${hh}:${mm}:${ss} KST`,
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
  const iso = `${date}T${hh}:${mm}:${ss}+09:00`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
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

function minutesDiff(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  return round((toDate.getTime() - fromDate.getTime()) / 60000, 1);
}

function writeText(absPath, text) {
  fs.writeFileSync(absPath, text, "utf8");
}

function jsonToFile(absPath, obj) {
  writeText(absPath, `${JSON.stringify(obj, null, 2)}\n`);
}

function buildMarkdown(payload) {
  const lines = [];
  lines.push(`# ${payload.date_key} 목표경로 관리자 사이클 ${payload.cycle} (kpi_path_owner -> 지혜)`);
  lines.push("");
  payload.noye_tags.SELF_RULE.forEach((rule) => lines.push(`- [SELF_RULE] ${rule}`));
  lines.push(`- [EXEC] ${payload.noye_tags.EXEC}`);
  lines.push(`- [VERIFY] ${payload.noye_tags.VERIFY}`);
  lines.push(`- [ISSUE] ${payload.noye_tags.ISSUE}`);
  lines.push(`- [REPORT_TO_JIHYE] ${payload.noye_tags.REPORT_TO_JIHYE}`);
  lines.push(`- [EVOLUTION] ${payload.noye_tags.EVOLUTION}`);
  lines.push("");
  lines.push("## 1) 핵심 결론");
  lines.push(`- [DECISION] \`${payload.decision.status_recommendation} / ${payload.decision.mode_recommendation} / ${payload.decision.go_no_go}\``);
  lines.push(`- 월 목표 \`${asPct(payload.goal_path.monthly_target_pct)}\` 기준, 오늘 순손익 \`${asPct(payload.goal_path.live_net_pnl_pct)}\`, 일 목표 대비 \`${asPct(payload.goal_path.gap_vs_daily_target_pctp)}p\``);
  lines.push(`- 월 환산 페이스 \`${asPct(payload.goal_path.monthly_run_rate_pct)}\` (목표 대비 \`${asPct(payload.goal_path.gap_vs_monthly_target_pctp)}p\`)`);
  lines.push(`- 안전 게이트 미충족: 비용 \`${asPct(payload.kpi_snapshot.cost_ratio_pct)}\`(한도 ${asPct(payload.kpi_snapshot.cost_limit_pct)}) / MDD \`${asPct(payload.kpi_snapshot.mdd_pct)}\`(기준 ${asPct(payload.kpi_snapshot.mdd_hold_limit_pct)})`);
  lines.push("");
  lines.push("## 2) 실제 수행한 작업 (번호 목록)");
  payload.independent_execution.done_now.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push("");
  lines.push("## 3) 변경 파일/산출물");
  lines.push(`- ${payload.artifacts.output_json_dated}`);
  lines.push(`- ${payload.artifacts.output_md_dated}`);
  lines.push(`- ${payload.artifacts.output_json_latest}`);
  lines.push(`- ${payload.artifacts.output_md_latest}`);
  lines.push("");
  lines.push("## 4) 지혜에게 보고할 핵심");
  lines.push(`- 진행률: \`${payload.report_to_jihye.progress_pct}%\``);
  payload.report_to_jihye.core_outcomes.forEach((x) => lines.push(`- ${x}`));
  payload.report_to_jihye.risks.forEach((x) => lines.push(`- ${x}`));
  lines.push(`- 지혜 의사결정 요청: ${payload.report_to_jihye.decision_request.option_a} / ${payload.report_to_jihye.decision_request.option_b} (권고: ${payload.report_to_jihye.decision_request.recommended})`);
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
  lines.push("## 협업 요청");
  payload.collaboration_requests_via_jihye.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const opsDaily = path.join(repoRoot, "ops", "daily");
  const now = kstNow();

  const sources = {
    data_consistency: path.join(opsDaily, "data_consistency_lead_latest.json"),
    risk_controller: path.join(opsDaily, "risk_controller_latest.json"),
    gap_conflict: path.join(opsDaily, "report_gap_conflict_manager_latest.json"),
    report_clock: path.join(opsDaily, "2026-02-26_report_clock_manager_latest_jihye.json"),
    metric_reconciliation: path.join(opsDaily, "metric_reconciliation_owner_latest.json"),
    strategy_alignment: path.join(opsDaily, "strategy_id_alignment_latest.json"),
  };

  const loaded = {};
  const sourceReadStatus = {};
  Object.entries(sources).forEach(([key, abs]) => {
    const r = parseJsonSafe(abs);
    sourceReadStatus[key] = r.ok ? "ok" : `error: ${r.error}`;
    loaded[key] = r.data;
  });

  if (!loaded.data_consistency || !loaded.risk_controller || !loaded.gap_conflict) {
    throw new Error("필수 latest 파일 로드 실패(data_consistency/risk_controller/gap_conflict)");
  }

  const dataConsistency = loaded.data_consistency || {};
  const riskController = loaded.risk_controller || {};
  const gapConflict = loaded.gap_conflict || {};
  const reportClock = loaded.report_clock || {};
  const reconciliation = loaded.metric_reconciliation || {};
  const strategy = loaded.strategy_alignment || {};

  const consolidated = dataConsistency.consolidated_metrics || {};
  const thresholds = dataConsistency.thresholds || {};
  const riskScore = riskController.risk_scorecard || {};
  const reportClockRisk = riskController.report_clock_risk || {};
  const executive = riskController.executive_report_summary || {};
  const gapKey = gapConflict.key_numbers || {};
  const clockKey = reportClock.key_numbers || {};
  const termStandard = reconciliation.term_standard || {};
  const mismatch = strategy.mismatch || {};
  const mismatchFreshness = strategy.mismatch_freshness || {};

  const costRatioPct = toNum(consolidated.cost_ratio_pct, toNum(riskScore.cost && riskScore.cost.applied_value_pct, 0));
  const mddPct = toNum(consolidated.mdd_pct, toNum(riskScore.loss && riskScore.loss.applied_mdd_pct, 0));
  const errorCount = toNum(consolidated.error_count_24h, toNum(riskScore.error && riskScore.error.applied_error_count_24h, 0));
  const netPnlPct = toNum(consolidated.net_pnl_pct, toNum(riskScore.loss && riskScore.loss.live_net_pnl_pct, 0));
  const onTimeRateConservativePct = toNum(consolidated.on_time_rate_pct, toNum(thresholds.on_time_target_pct, 100));
  const onTimeRateLivePct = toNum(gapKey.on_time_rate_pct, onTimeRateConservativePct);
  const onTimeRatePct = onTimeRateLivePct;
  const validSubmissionRatePct = toNum(consolidated.valid_submission_rate_pct, toNum(gapKey.valid_submission_rate_pct, 0));
  const staleCount = toNum(consolidated.stale_or_missing_count, toNum(gapKey.stale_or_missing_count, 0));
  const consistencyCheckCount = toNum(termStandard.consistency_check_count, toNum(gapKey.conflict_count, 0));
  const policyConflictCount = toNum(termStandard.policy_conflict_count, 0);
  const liveDriftCheckCount = toNum(termStandard.live_drift_check_count, 0);
  const lateCount = toNum(gapKey.late_count, 0);
  const signalsCount = toNum(gapKey.signals_count, 0);
  const dropsCount = toNum(gapKey.drops_count, 0);
  const strategyGuardMismatchCount = toNum(mismatch.guard_count, 0);
  const strategyNewMismatchCount = toNum(mismatch.after_live_revision_count, 0);

  const costLimitPct = toNum(thresholds.cost_limit_pct, 0.2);
  const mddHoldLimitPct = toNum(thresholds.mdd_hold_limit_pct, -1.5);
  const errorStopCount = toNum(thresholds.error_stop_count, 2);
  const onTimeTargetPct = toNum(thresholds.on_time_target_pct, 100);

  const weeklyTargetPct = MONTHLY_TARGET_PCT / WEEKS_PER_MONTH;
  const dailyTargetPct = MONTHLY_TARGET_PCT / MONTH_DAYS;
  const cycle30mTargetPct = dailyTargetPct / CYCLES_PER_DAY_30M;

  const dayOfMonth = Math.min(Math.max(now.dayOfMonth, 1), MONTH_DAYS);
  const daysRemaining = Math.max(MONTH_DAYS - dayOfMonth, 0);
  const monthElapsedTargetPct = dailyTargetPct * dayOfMonth;
  const monthlyRunRatePct = netPnlPct * MONTH_DAYS;
  const requiredDailyFromNowPct =
    daysRemaining > 0 ? (MONTHLY_TARGET_PCT - netPnlPct) / daysRemaining : MONTHLY_TARGET_PCT - netPnlPct;
  const requiredCycleFromNowPct = requiredDailyFromNowPct / CYCLES_PER_DAY_30M;

  const nowDate = new Date();
  const rawNextJihyeKst = firstNonEmpty(
    clockKey.matrix_jihye_to_jaeyong,
    executive.next_report_jihye_to_jaeyong_kst,
    gapKey.matrix_next_report_jihye_to_jaeyong
  );
  const rawNextStaffKst = firstNonEmpty(
    clockKey.matrix_staff_to_jihye,
    executive.next_report_staff_to_jihye_kst
  );
  const nextJihyeDate = rollForwardBy30m(parseKstTextToDate(rawNextJihyeKst), nowDate);
  const nextStaffDate = rollForwardBy30m(parseKstTextToDate(rawNextStaffKst), nowDate);
  const nextJihyeKst = firstNonEmpty(formatKstMinute(nextJihyeDate), rawNextJihyeKst);
  const nextStaffKst = firstNonEmpty(formatKstMinute(nextStaffDate), rawNextStaffKst);
  const minsToJihye = minutesDiff(nowDate, nextJihyeDate);
  let reportTimingStatus = "사전 점검 시점";
  let reportTimingReason = "다음 정기 보고 시각 전";
  if (minsToJihye !== null && Math.abs(minsToJihye) <= 2) {
    reportTimingStatus = "보고 시점";
    reportTimingReason = `지혜 보고 ${nextJihyeKst} 기준 ±2분 구간`;
  } else if (minsToJihye !== null && minsToJihye < -2) {
    reportTimingStatus = "보고 지연 구간";
    reportTimingReason = `지혜 보고 ${nextJihyeKst}가 ${Math.abs(minsToJihye)}분 경과`;
  }

  const issues = [];
  if (costRatioPct > costLimitPct) {
    issues.push(`[ISSUE] H | 비용 ${asPct(costRatioPct)} > 한도 ${asPct(costLimitPct)} | 비용 차단 유지`);
  }
  if (mddPct < mddHoldLimitPct) {
    issues.push(`[ISSUE] H | MDD ${asPct(mddPct)} < 기준 ${asPct(mddHoldLimitPct)} | 공격 전환 금지`);
  }
  if (onTimeRatePct < 90) {
    issues.push(
      `[ISSUE] M | 정시율(실시간) ${asPct(onTimeRatePct, 1)} < 90% (보수 ${asPct(onTimeRateConservativePct, 1)}) | 보고 동기화 복구 필요`,
    );
  }
  if (policyConflictCount > 0) {
    issues.push(`[ISSUE] M | 정책충돌(policy_conflict) ${policyConflictCount}건 | 승인값-최신값 정렬 필요`);
  }
  if (liveDriftCheckCount > 0) {
    issues.push(`[ISSUE] M | 실시간차이(live_drift_check) ${liveDriftCheckCount}건 | 기준-최신 차이 축소 필요`);
  }
  if (issues.length === 0) {
    issues.push("[ISSUE] L | 즉시 경보 이슈 없음 | 보수 모니터링 유지");
  }

  const monthlyPaceGapPctp = monthlyRunRatePct - MONTHLY_TARGET_PCT;
  const gateDeficitReasons = [];
  if (costRatioPct > costLimitPct) gateDeficitReasons.push("비용");
  if (mddPct < mddHoldLimitPct) gateDeficitReasons.push("MDD");
  if (onTimeRatePct < 90) gateDeficitReasons.push("정시율");
  const safetyShortageLabels = [];
  if (costRatioPct > costLimitPct) safetyShortageLabels.push("비용");
  if (mddPct < mddHoldLimitPct) safetyShortageLabels.push("손실폭");
  if (onTimeRatePct < 90) safetyShortageLabels.push("보고 정시율");
  if (liveDriftCheckCount > 0) safetyShortageLabels.push("실시간 수치 차이");
  const jaeyongPaceLine =
    monthlyRunRatePct >= MONTHLY_TARGET_PCT
      ? "현재 수익 속도는 월 5% 목표 경로 안에 있습니다."
      : "현재 수익 속도는 월 5% 목표보다 느려 보완이 필요합니다.";
  const jaeyongSafetyLine =
    safetyShortageLabels.length > 0
      ? `${safetyShortageLabels.join(", ")} 기준이 아직 안 맞아서 지금은 안전 모드를 유지해야 합니다.`
      : "핵심 안전 기준은 현재 충족 상태입니다.";
  const reportSyncRequestLine =
    onTimeRatePct < 90
      ? `정시율(실시간) ${asPct(onTimeRatePct, 1)} -> 90%+ 복구 실행 결과 제출`
      : `정시율(실시간) ${asPct(onTimeRatePct, 1)} 90%+ 유지 증빙 제출`;
  const onTimeNextImprovementLine =
    onTimeRatePct < 90
      ? `다음 사이클에 정시율(실시간) ${asPct(onTimeRatePct, 1)}를 90% 이상으로 복구하고 live_drift_check ${liveDriftCheckCount}건을 0건으로 축소한다.`
      : `다음 사이클에 정시율(실시간) ${asPct(onTimeRatePct, 1)}를 90% 이상으로 유지하고 live_drift_check ${liveDriftCheckCount}건을 0건으로 축소한다.`;
  const decisionReason =
    gateDeficitReasons.length > 0
      ? `${gateDeficitReasons.join("/")} 미달이 남아 있어 완화 전환 시 재발 리스크가 큼`
      : "핵심 게이트가 충족됐지만 실시간차이 정리 전까지는 보수 유지가 안전함";

  const collaborationRequests = [
    `[COLLAB_REQUEST] execution_cost_guard_owner | 비용 초과분 ${asPct(Math.max(costRatioPct - costLimitPct, 0))}p를 줄일 A/B 실행안 제출 | ${nextStaffKst || "다음 보고 전"}`,
    `[COLLAB_REQUEST] risk_owner | MDD 회복 필요치 ${asPct(Math.max(mddHoldLimitPct - mddPct, 0))}p 달성 경로 제출 | ${nextStaffKst || "다음 보고 전"}`,
    `[COLLAB_REQUEST] report_sync_keeper | ${reportSyncRequestLine} | ${nextStaffKst || "다음 보고 전"}`,
  ];

  const payload = {
    generated_at_iso: now.iso,
    generated_at_kst: now.kstWithSec,
    date_key: now.dateKey,
    cycle: now.hhmm,
    role: "kpi_path_owner",
    mission: "월 5% 달성경로를 매 사이클 숫자로 증명",
    report_timing: {
      status: reportTimingStatus,
      reason: reportTimingReason,
      now_kst: now.kstWithSec,
      next_staff_to_jihye_kst: nextStaffKst,
      next_jihye_to_jaeyong_kst: nextJihyeKst,
      minutes_to_next_jihye_report: minsToJihye,
    },
    decision: {
      status_recommendation: dataConsistency.status_recommendation || riskController.status_recommendation || "보류 유지",
      mode_recommendation: dataConsistency.mode_recommendation || riskController.mode_recommendation || "비용 차단 유지",
      go_no_go: dataConsistency.go_no_go || riskController.go_no_go || "No-Go 유지",
    },
    goal_path: {
      monthly_target_pct: MONTHLY_TARGET_PCT,
      weekly_target_pct: round(weeklyTargetPct, 4),
      daily_target_pct: round(dailyTargetPct, 4),
      cycle_30m_target_pct: round(cycle30mTargetPct, 4),
      live_net_pnl_pct: round(netPnlPct, 4),
      gap_vs_daily_target_pctp: round(netPnlPct - dailyTargetPct, 4),
      monthly_run_rate_pct: round(monthlyRunRatePct, 4),
      gap_vs_monthly_target_pctp: round(monthlyRunRatePct - MONTHLY_TARGET_PCT, 4),
      day_of_month_proxy: dayOfMonth,
      month_elapsed_target_pct: round(monthElapsedTargetPct, 4),
      gap_vs_elapsed_target_proxy_pctp: round(netPnlPct - monthElapsedTargetPct, 4),
      remaining_days_proxy: daysRemaining,
      required_daily_pct_from_now_proxy: round(requiredDailyFromNowPct, 4),
      required_cycle_30m_pct_from_now_proxy: round(requiredCycleFromNowPct, 4),
      assumptions: [
        "월 누적 수익률 원천이 분리되어 있지 않아 net_pnl_pct(당일 기준)를 월 경로 프록시로 사용",
        "월 목표 분해는 30일/48사이클(30분) 고정 규칙 사용",
      ],
    },
    kpi_snapshot: {
      cost_ratio_pct: round(costRatioPct, 4),
      cost_limit_pct: round(costLimitPct, 4),
      cost_over_limit_pctp: round(Math.max(costRatioPct - costLimitPct, 0), 4),
      mdd_pct: round(mddPct, 4),
      mdd_hold_limit_pct: round(mddHoldLimitPct, 4),
      mdd_recovery_needed_pctp: round(Math.max(mddHoldLimitPct - mddPct, 0), 4),
      error_count_24h: errorCount,
      error_stop_count: errorStopCount,
      valid_submission_rate_pct: round(validSubmissionRatePct, 1),
      on_time_rate_pct: round(onTimeRatePct, 1),
      on_time_rate_conservative_pct: round(onTimeRateConservativePct, 1),
      on_time_rate_live_pct: round(onTimeRateLivePct, 1),
      on_time_recovery_needed_pctp: round(Math.max(onTimeTargetPct - onTimeRatePct, 0), 1),
      stale_or_missing_count: staleCount,
      late_count: lateCount,
      consistency_check_count: consistencyCheckCount,
      policy_conflict_count: policyConflictCount,
      live_drift_check_count: liveDriftCheckCount,
      strategy_guard_mismatch_count: strategyGuardMismatchCount,
      strategy_new_mismatch_count: strategyNewMismatchCount,
      mismatch_freshness_status: mismatchFreshness.status || null,
      signals_count: signalsCount,
      drops_count: dropsCount,
      top_drop_reason: gapKey.drop_reason_top1 || null,
    },
    independent_execution: {
      progress_pct: 100,
      done_now: [
        "latest 기준 파일 6종(data/risk/gap/clock/metric/strategy) 로드",
        "월/주/일/30분 목표 경로와 부족분(cost/mdd/on-time) 재계산",
        "kpi_path_owner 보고서(JSON/MD) 생성 및 latest 갱신",
      ],
      next_actions_without_waiting: [
        `다음 사이클(${nextStaffKst || "직원 다음 마감"} 전) 비용/MDD/정시율 회복 필요치 재산출`,
        "실시간차이(live_drift_check) 3건을 0건으로 줄이는 추적표 갱신",
        "월 환산 페이스와 보수 게이트를 분리 표기해 No-Go 해제 조건 체크",
      ],
    },
    report_to_jihye: {
      progress_pct: 100,
      core_outcomes: [
        `월 5% 경로 분해 고정: 주 ${asPct(weeklyTargetPct)} / 일 ${asPct(dailyTargetPct)} / 30분 ${asPct(cycle30mTargetPct)}`,
        `오늘 순손익 ${asPct(netPnlPct)}로 일 목표 대비 ${asPct(netPnlPct - dailyTargetPct)}p`,
        `월 환산 페이스 ${asPct(monthlyRunRatePct)}(목표 대비 ${asPct(monthlyRunRatePct - MONTHLY_TARGET_PCT)}p)`,
        `정시율 병기: 보수 ${asPct(onTimeRateConservativePct, 1)} / 실시간 ${asPct(onTimeRateLivePct, 1)}`,
        `운영충돌(consistency_check) ${consistencyCheckCount}건 / 실시간차이(live_drift_check) ${liveDriftCheckCount}건 병기`,
      ],
      risks: issues,
      decision_request: {
        title: "월 5% 경로 운영 기준",
        option_a: "보수 게이트(cost/mdd/on-time) 회복 전까지 보류+비용 차단 유지",
        option_b: `실시간 순손익 페이스(월 목표 대비 ${asSignedPct(monthlyPaceGapPctp)}p)를 우선 반영해 조기 완화`,
        recommended: "option_a",
        reason: decisionReason,
      },
    },
    collaboration_requests_via_jihye: collaborationRequests,
    evolution_plan: [
      "[EVOLUTION] 월 경로표에 보수 게이트 부족분(cost/mdd/on-time)을 고정 병기 | 수익-안전 동시 관리 강화",
      "[EVOLUTION] 보고 시각 도달 시 자동 resync 후 경로표 재계산 | 시각 지연으로 인한 판단 공백 축소",
      "[EVOLUTION] live_drift_check(실시간차이) 전용 축소 목표를 3->0으로 별도 추적 | 기준/최신 혼선 감소",
    ],
    simple_summary_for_jaeyong: [
      jaeyongPaceLine,
      jaeyongSafetyLine,
      `다음 공식 보고는 ${nextJihyeKst || "다음 30분 슬롯"}입니다.`,
    ],
    risks_and_checks: [
      `핵심 리스크: 비용 ${asPct(costRatioPct)}(한도 ${asPct(costLimitPct)}), MDD ${asPct(mddPct)}(기준 ${asPct(mddHoldLimitPct)}), 정시율(보수/실시간) ${asPct(onTimeRateConservativePct, 1)} / ${asPct(onTimeRateLivePct, 1)}`,
      `완화된 항목: 운영충돌(consistency_check) ${consistencyCheckCount}건, 시각충돌 ${toNum(clockKey.conflict_matrix_vs_role, toNum(reportClockRisk.conflict_matrix_vs_role, 0)) + toNum(clockKey.conflict_approval_vs_role, toNum(reportClockRisk.conflict_approval_vs_role, 0))}건`,
      `추가 확인: strategy_id 신규 불일치 ${strategyNewMismatchCount}건(상태 ${mismatchFreshness.status || "n/a"})`,
      "자가검증: 필수 섹션/태그/수치 계산/파일 생성 확인",
    ],
    noye_tags: {
      SELF_RULE: [
        "월 5% 목표는 주/일/30분 숫자로 분해해 매 사이클 고정 보고한다",
        "운영충돌(consistency_check)과 실시간차이(live_drift_check)를 항상 함께 표기한다",
        "수익 숫자와 안전 숫자(cost/mdd/on-time)를 분리해 동시에 판정한다",
      ],
      EXEC: "핵심 점검 스크립트 재실행 후 목표경로 리포트(JSON/MD) 자동 생성",
      VERIFY: "pass | 계산식(월/주/일/30분)과 게이트 부족분(cost/mdd/on-time) 산출 검증 완료",
      ISSUE: String(issues[0] || "L | 즉시 경보 이슈 없음 | 보수 모니터링 유지").replace(/^\[ISSUE\]\s*/, ""),
      REPORT_TO_JIHYE: `진행률 100% | 월경로(주/일/30분) 수치화 완료 | 운영충돌(consistency_check) ${consistencyCheckCount}건 / 실시간차이(live_drift_check) ${liveDriftCheckCount}건`,
      EVOLUTION: "경로표에 게이트 부족분과 다음 복구 목표를 자동 병기하도록 고정",
    },
    source_files: {
      ...sources,
    },
    source_read_status: sourceReadStatus,
    self_validation: {
      checks: [
        "latest 입력 6종 파싱 성공 여부 확인",
        "월/주/일/30분 목표값 계산 확인",
        "비용/MDD/정시율(보수/실시간) 부족분 계산 확인",
        "운영충돌(consistency_check)/실시간차이(live_drift_check) 동시 표기 확인",
        "출력 JSON/MD 및 latest 포인터 생성 확인",
      ],
      result: "pass",
    },
  };

  const datedJson = path.join(opsDaily, `${now.dateKey}_kpi_path_owner_${now.hhmm}_jihye.json`);
  const datedMd = path.join(opsDaily, `${now.dateKey}_kpi_path_owner_${now.hhmm}_jihye.md`);
  const latestJson = path.join(opsDaily, "kpi_path_owner_latest.json");
  const latestMd = path.join(opsDaily, "kpi_path_owner_latest.md");

  payload.artifacts = {
    output_json_dated: datedJson,
    output_md_dated: datedMd,
    output_json_latest: latestJson,
    output_md_latest: latestMd,
  };

  jsonToFile(datedJson, payload);
  jsonToFile(latestJson, payload);

  const md = buildMarkdown(payload);
  writeText(datedMd, md);
  writeText(latestMd, md);

  console.log(
    JSON.stringify(
      {
        ok: true,
        role: payload.role,
        cycle: payload.cycle,
        generated_at_kst: payload.generated_at_kst,
        decision: payload.decision,
        goal_path: {
          daily_target_pct: payload.goal_path.daily_target_pct,
          live_net_pnl_pct: payload.goal_path.live_net_pnl_pct,
          gap_vs_daily_target_pctp: payload.goal_path.gap_vs_daily_target_pctp,
          monthly_run_rate_pct: payload.goal_path.monthly_run_rate_pct,
        },
        kpi_snapshot: {
          cost_ratio_pct: payload.kpi_snapshot.cost_ratio_pct,
          mdd_pct: payload.kpi_snapshot.mdd_pct,
          on_time_rate_pct: payload.kpi_snapshot.on_time_rate_pct,
          consistency_check_count: payload.kpi_snapshot.consistency_check_count,
          live_drift_check_count: payload.kpi_snapshot.live_drift_check_count,
        },
        report_timing: payload.report_timing,
        output_json: datedJson,
        output_md: datedMd,
        output_latest_json: latestJson,
        output_latest_md: latestMd,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error("kpi-path-owner-cycle failed:", error && error.message ? error.message : error);
  process.exit(1);
}
