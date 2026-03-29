#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString } = require("../src/utils/timeKst");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");

function readJsonSafe(absPath) {
  try {
    return {
      ok: true,
      path: absPath,
      data: JSON.parse(fs.readFileSync(absPath, "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      path: absPath,
      data: null,
      error: error && error.message ? error.message : String(error),
    };
  }
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function fmtPct(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value.toFixed(digits)}%`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function rel(absPath) {
  return path.relative(ROOT, absPath).replace(/\\/g, "/");
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseKstLabelToEpochMs(label) {
  if (typeof label !== "string") return null;
  const match = label.trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))? KST$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  return Date.UTC(year, month, day, hour - 9, minute, second);
}

function toMinuteKstString(epochMs) {
  const label = toKstString(epochMs, { fallbackToString: true });
  if (typeof label !== "string" || label.length < 16) return label;
  return `${label.slice(0, 16)} KST`;
}

function findLatestReportFile(dir, matcher) {
  try {
    const files = fs.readdirSync(dir).filter((name) => matcher.test(name));
    if (!files.length) return null;
    files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
    return path.join(dir, files[0]);
  } catch (_error) {
    return null;
  }
}

function buildMarkdown(payload) {
  const lines = [];
  const allocationRows = payload.current_allocation_plan;
  const reasons = payload.adjustment_rationale;
  const rules = payload.increase_decrease_rules;
  const issues = payload.issues;
  const collab = payload.collaboration_requests_via_jihye;
  const checks = payload.self_validation.checks;
  const fmtCount = (value) => (Number.isFinite(value) ? `${value}` : "N/A");

  lines.push(`# ${payload.generated_at_kst.slice(0, 10)} 자본배분 매니저 보고 (${payload.cycle} KST) - 지혜 제출`);
  lines.push("");
  lines.push("## 1) 핵심 결론");
  lines.push(`- [DECISION] \`${payload.status_recommendation} / ${payload.mode_recommendation} / ${payload.go_no_go}\``);
  lines.push(`- 기준 시각: \`${payload.generated_at_kst}\``);
  lines.push(
    `- 현재 계정 권고 레버리지: \`${payload.account_leverage_plan.recommended_account_leverage}x\` (상한 \`${payload.account_leverage_plan.max_account_leverage}x\`)`
  );
  lines.push(
    `- 핵심 수치: 비용 \`${fmtPct(payload.key_metrics.applied_cost_ratio_pct)}\`, MDD \`${fmtPct(
      payload.key_metrics.applied_mdd_pct
    )}\`, strategy_id 누적 \`${payload.key_metrics.strategy_id_mismatch_total}\`건, 정시율(통합) \`${fmtPct(
      payload.key_metrics.on_time_rate_pct
    )}\`, 정시율(신뢰성) \`${fmtPct(payload.key_metrics.reliability_on_time_rate_pct)}\`, 운영충돌(consistency_check) \`${fmtCount(
      payload.key_metrics.consistency_check_mismatch_count
    )}\`건, 실시간차이(live_drift_check) \`${fmtCount(payload.key_metrics.live_drift_check_mismatch_count)}\`건`
  );
  lines.push("");
  lines.push("## 2) 실제 수행한 작업 (번호 목록)");
  payload.executed_now.forEach((step, idx) => lines.push(`${idx + 1}. ${step}`));
  lines.push("");
  lines.push("## 3) 변경 파일/산출물");
  lines.push(`- \`ops/daily/${payload.output_files.dated_json}\``);
  lines.push(`- \`ops/daily/${payload.output_files.dated_md}\``);
  lines.push("- `ops/daily/capital_allocation_manager_latest.json`");
  lines.push("- `ops/daily/capital_allocation_manager_latest.md`");
  lines.push("");
  lines.push("## 4) 지혜에게 보고할 핵심");
  lines.push("- 현재 배분안");
  allocationRows.forEach((row, idx) => {
    lines.push(
      `${idx + 1}. ${row.bucket}: \`${row.weight_pct}%\` | 레버리지 \`${row.max_leverage}x\` | 실행상태 \`${row.execution_mode}\``
    );
  });
  lines.push("- 조정 근거");
  reasons.forEach((row) => lines.push(`- ${row}`));
  lines.push("- 증액/감액 규칙");
  rules.forEach((row, idx) => lines.push(`${idx + 1}. ${row}`));
  lines.push("- 대표 보고 요약");
  lines.push(
    `- [REPORT_TO_JIHYE] 진행률 ${payload.progress_pct}% | 판정 \`${payload.status_recommendation} / ${payload.mode_recommendation} / ${payload.go_no_go}\``
  );
  lines.push(
    `- 운영충돌(consistency_check) \`${fmtCount(
      payload.key_metrics.consistency_check_mismatch_count
    )}건\` / 실시간차이(live_drift_check) \`${fmtCount(payload.key_metrics.live_drift_check_mismatch_count)}건\``
  );
  lines.push(
    `- 다음 보고: 직원 \`${payload.next_report.staff_to_jihye_kst || "미확정"}\` -> 지혜 \`${
      payload.next_report.jihye_to_jaeyong_kst || "미확정"
    }\``
  );
  lines.push(`- 지혜 의사결정 요청: ${payload.report_to_jihye.decision_request}`);
  lines.push(`- [SELF_RULE] 1) 단일 전략 25% 초과 금지, 2) No-Go 동안 신규 확대 금지, 3) 보수값 우선 배분 유지`);
  lines.push(`- [EXEC] ${payload.executed_now.join(" / ")}`);
  lines.push(
    `- [VERIFY] ${payload.self_validation.result} | 배분합계 ${payload.self_validation.weight_sum_pct}% | 핵심 파일 ${payload.self_validation.loaded_sources}/${payload.self_validation.total_sources}개 로드`
  );
  lines.push("");
  lines.push("## 5) 재용에게 보여줄 쉬운 요약(비개발자용)");
  lines.push(
    `- 지금은 위험 수치가 기준보다 나빠서, 공격적으로 돈을 넣지 않고 \`${allocationRows.find((x) => x.bucket === "현금/대기자금")?.weight_pct || 0}%\`를 안전자금으로 유지했습니다.`
  );
  lines.push(
    `- 새 주문을 크게 늘리기 전에 비용(\`${fmtPct(payload.key_metrics.applied_cost_ratio_pct)}\`)과 손실폭(\`${fmtPct(
      payload.key_metrics.applied_mdd_pct
    )}\`)을 먼저 기준 안으로 되돌리는 데 집중합니다.`
  );
  lines.push(
    `- 다음 공식 보고 시각은 직원 \`${payload.next_report.staff_to_jihye_kst || "미확정"}\`, 지혜 \`${
      payload.next_report.jihye_to_jaeyong_kst || "미확정"
    }\`입니다.`
  );
  lines.push("");
  lines.push("## 6) 리스크/확인사항");
  issues.forEach((row) => lines.push(`- ${row}`));
  lines.push("- 지혜를 통해 전달할 협업 요청");
  collab.forEach((row, idx) => lines.push(`${idx + 1}. ${row}`));
  lines.push("- 진화 계획");
  payload.evolution_plan.forEach((row) => lines.push(`- ${row}`));
  lines.push("- 자가검증 결과");
  checks.forEach((row, idx) => lines.push(`${idx + 1}. ${row}`));
  lines.push(`- 결과: \`${payload.self_validation.result}\``);
  lines.push("");
  lines.push("## 7) 규칙서 수정 필요 시 [RULEBOOK_CHANGE_REQUEST] 제목 | 변경안 | 이유 (선택)");
  lines.push("- 없음");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function main() {
  const now = Date.now();
  const generatedAtKst = toKstString(now, { fallbackToString: true });
  const dateKey = generatedAtKst.slice(0, 10);
  const cycle = generatedAtKst.slice(11, 16).replace(":", "");
  let reliabilityLatest = findLatestReportFile(
    OPS_DAILY,
    new RegExp(`^${dateKey}_report_reliability_delay_conflict_\\d{4}_jihye\\.json$`)
  );
  if (!reliabilityLatest) {
    reliabilityLatest = findLatestReportFile(
      OPS_DAILY,
      /^\d{4}-\d{2}-\d{2}_report_reliability_delay_conflict_\d{4}_jihye\.json$/
    );
  }

  const sourcePaths = {
    data_consistency: path.join(OPS_DAILY, "data_consistency_lead_latest.json"),
    risk_controller: path.join(OPS_DAILY, "risk_controller_latest.json"),
    performance_analyst: path.join(OPS_DAILY, "performance_analyst_latest.json"),
    strategy_id_alignment: path.join(OPS_DAILY, "strategy_id_alignment_latest.json"),
    post_apply_signal_probe: path.join(OPS_DAILY, "post_apply_signal_probe_latest.json"),
    execution_microstructure: path.join(OPS_DAILY, "execution_microstructure_latest.json"),
    approval_execution: path.join(OPS_DAILY, "approval_execution_latest.json"),
    report_gap_conflict: path.join(OPS_DAILY, "report_gap_conflict_manager_latest.json"),
  };
  if (reliabilityLatest) {
    sourcePaths.report_reliability = reliabilityLatest;
  }

  const reads = {};
  Object.keys(sourcePaths).forEach((key) => {
    reads[key] = readJsonSafe(sourcePaths[key]);
  });

  const dc = (reads.data_consistency && reads.data_consistency.data) || {};
  const rc = (reads.risk_controller && reads.risk_controller.data) || {};
  const pa = (reads.performance_analyst && reads.performance_analyst.data) || {};
  const sid = (reads.strategy_id_alignment && reads.strategy_id_alignment.data) || {};
  const probe = (reads.post_apply_signal_probe && reads.post_apply_signal_probe.data) || {};
  const micro = (reads.execution_microstructure && reads.execution_microstructure.data) || {};
  const approval = (reads.approval_execution && reads.approval_execution.data) || {};
  const gap = (reads.report_gap_conflict && reads.report_gap_conflict.data) || {};
  const reliability = (reads.report_reliability && reads.report_reliability.data) || {};

  const consolidated = dc.consolidated_metrics || {};
  const thresholds = dc.thresholds || {};
  const riskLimits = rc.risk_limits || {};
  const reportQuality = pa.core_metrics && pa.core_metrics.report_quality ? pa.core_metrics.report_quality : {};
  const objectiveVsCurrent = pa.objective_vs_current || {};
  const mismatch = sid.mismatch || {};
  const mismatchFreshness = sid.mismatch_freshness || {};
  const signalHealth = rc.signal_health || {};
  const probeCounts = probe.counts || {};
  const microMetrics = micro.metrics || {};
  const slippage = microMetrics.slippage || {};
  const intents = microMetrics.intents || {};
  const reliabilityMetrics = reliability.metrics || {};
  const reliabilitySubmissionBoard = reliabilityMetrics.submission_board || {};
  const consistencyCheck = reliabilityMetrics.consistency_check || reliability.consistency_check || {};
  const liveDriftCheck = reliabilityMetrics.live_drift_check || reliability.live_drift_check || {};
  const gapKeyNumbers = gap.key_numbers || {};

  const costLimit = toNum(thresholds.cost_limit_pct, toNum(riskLimits.cost_ratio_hold_limit_pct, 0.2));
  const mddLimit = toNum(thresholds.mdd_hold_limit_pct, -1.5);
  const errorStop = toNum(thresholds.error_stop_count, toNum(riskLimits.core_error_stop_threshold_24h, 2));

  const appliedCost = toNum(
    consolidated.cost_ratio_pct,
    toNum(rc.risk_scorecard && rc.risk_scorecard.cost && rc.risk_scorecard.cost.applied_value_pct, null)
  );
  const appliedMdd = toNum(
    consolidated.mdd_pct,
    toNum(rc.risk_scorecard && rc.risk_scorecard.loss && rc.risk_scorecard.loss.applied_mdd_pct, null)
  );
  const appliedError = toNum(
    consolidated.error_count_24h,
    toNum(rc.risk_scorecard && rc.risk_scorecard.error && rc.risk_scorecard.error.applied_error_count_24h, 0)
  );
  const netPnlPct = toNum(consolidated.net_pnl_pct, toNum(objectiveVsCurrent.live_net_pnl_pct, null));
  const requiredDailyPct = toNum(objectiveVsCurrent.required_daily_pct, 0.1667);
  const dailyGapPctp = Number.isFinite(netPnlPct) ? round(netPnlPct - requiredDailyPct, 4) : null;

  const validSubmissionRate = toNum(consolidated.valid_submission_rate_pct, toNum(reportQuality.valid_submission_rate_pct, null));
  const onTimeRate = toNum(consolidated.on_time_rate_pct, toNum(reportQuality.on_time_rate_pct, null));
  const reliabilityValidSubmissionRate = toNum(reliabilitySubmissionBoard.valid_submission_rate_pct, null);
  const reliabilityOnTimeRate = toNum(reliabilitySubmissionBoard.on_time_rate_pct, null);
  const onTimeRateGapPctp =
    Number.isFinite(onTimeRate) && Number.isFinite(reliabilityOnTimeRate) ? round(onTimeRate - reliabilityOnTimeRate, 1) : null;
  const staleCount = toNum(consolidated.stale_or_missing_count, toNum(reportQuality.stale_or_missing_count, 0));
  const conflictCount = toNum(consolidated.conflict_count, 0);
  const consistencyMismatchCount = toNum(consistencyCheck.mismatch_count, toNum(gapKeyNumbers.conflict_count, null));
  const liveDriftMismatchCount = toNum(liveDriftCheck.mismatch_count, null);
  const runtimeFailCount = toNum(consolidated.codex_fail_count_24h, toNum(rc.runtime_risk && rc.runtime_risk.codex_fail_count_24h, 0));
  const runtimeTimeoutCount = toNum(
    consolidated.codex_timeout_event_count_24h,
    toNum(rc.runtime_risk && rc.runtime_risk.codex_timeout_event_count_24h, 0)
  );

  const strategyMismatchTotal = toNum(mismatch.total_count, toNum(signalHealth.strategy_id_mismatch_count, 0));
  const strategyMismatchFreshRaw = toNum(
    mismatchFreshness.created_after_live_revision_count,
    toNum(signalHealth.mismatch_after_live_revision_count, null)
  );
  const strategyMismatchFresh = Number.isFinite(strategyMismatchFreshRaw) ? strategyMismatchFreshRaw : 0;
  const strategyMismatchGuard = toNum(
    mismatch.guard_count,
    Number.isFinite(strategyMismatchFreshRaw) ? strategyMismatchFreshRaw : strategyMismatchTotal
  );
  const signalsCount = toNum(probeCounts.signals, toNum(signalHealth.signals_count, 0));
  const dropsCount = toNum(probeCounts.drops, toNum(signalHealth.drops_count, 0));

  const adverseP95Bps = toNum(slippage.adverse_p95_bps, null);
  const fillRatePct = toNum(intents.fill_rate_pct, null);

  const costFail = Number.isFinite(appliedCost) && Number.isFinite(costLimit) ? appliedCost > costLimit : true;
  const mddFail = Number.isFinite(appliedMdd) && Number.isFinite(mddLimit) ? appliedMdd < mddLimit : true;
  const errorFail = Number.isFinite(appliedError) && Number.isFinite(errorStop) ? appliedError >= errorStop : false;
  const reportFail =
    (Number.isFinite(validSubmissionRate) && validSubmissionRate < 100) ||
    (Number.isFinite(onTimeRate) && onTimeRate < 100) ||
    staleCount > 0 ||
    conflictCount > 0 ||
    (Number.isFinite(consistencyMismatchCount) && consistencyMismatchCount > 0);
  const runtimeFail = runtimeFailCount > 0 || runtimeTimeoutCount > 0;
  const onTimeSourceConflict = Number.isFinite(onTimeRateGapPctp) ? Math.abs(onTimeRateGapPctp) >= 5 : false;

  const statusRecommendation = dc.status_recommendation || "보류 유지";
  const modeRecommendation = dc.mode_recommendation || "비용 차단 유지";
  const goNoGo = dc.go_no_go || (costFail || mddFail || reportFail || runtimeFail ? "No-Go 유지" : "Go");
  const hardDefensive = goNoGo.includes("No-Go") || costFail || mddFail;

  const coreMaintenancePct = hardDefensive ? 20 : 30;
  const recoveryControlPct = hardDefensive ? 10 : 15;
  const candidateNewVersionPct = hardDefensive || strategyMismatchGuard > 0 ? 0 : 10;
  const reservePct = 100 - (coreMaintenancePct + recoveryControlPct + candidateNewVersionPct);

  const maxAccountLeverage = toNum(riskLimits.max_account_leverage, 2);
  const recommendedAccountLeverage = clamp(hardDefensive ? 0.8 : 1.2, 0.5, maxAccountLeverage);

  const currentAllocationPlan = [
    {
      bucket: "핵심 유지 전략(기존 버전 중심)",
      strategy_scope: "donbeolja_v5.5.5.9 중심",
      weight_pct: coreMaintenancePct,
      max_leverage: hardDefensive ? 0.8 : 1.2,
      execution_mode: "기존 포지션 유지/축소 우선, 신규 확대 금지",
    },
    {
      bucket: "손실 완화/복구 버킷",
      strategy_scope: "손실 축소 목적의 보수 집행",
      weight_pct: recoveryControlPct,
      max_leverage: hardDefensive ? 0.5 : 0.8,
      execution_mode: "작은 규모 검증만 허용",
    },
    {
      bucket: "신규 버전 후보 전략",
      strategy_scope: "donbeolja_v5.5.8.0 / v5.5.6.0",
      weight_pct: candidateNewVersionPct,
      max_leverage: 0,
      execution_mode: candidateNewVersionPct === 0 ? "동결(실거래 배분 0%)" : "조건부 제한 운영",
    },
    {
      bucket: "현금/대기자금",
      strategy_scope: "USDT 안전자금",
      weight_pct: reservePct,
      max_leverage: 0,
      execution_mode: "리스크 완화 완료 전 유지",
    },
  ];

  const adjustmentRationale = [
    `비용 ${fmtPct(appliedCost)} > 한도 ${fmtPct(costLimit)} 이므로 공격 배분 금지`,
    `MDD ${fmtPct(appliedMdd)} < 기준 ${fmtPct(mddLimit)} 이므로 자본 보존 우선`,
    `strategy_id 운영 가드 ${strategyMismatchGuard}건(누적 ${strategyMismatchTotal}건, 신규 ${strategyMismatchFresh}건)으로 신규 버전 실거래 배분 0%`,
    `운영충돌(consistency_check) ${
      Number.isFinite(consistencyMismatchCount) ? consistencyMismatchCount : "N/A"
    }건 / 실시간차이(live_drift_check) ${Number.isFinite(liveDriftMismatchCount) ? liveDriftMismatchCount : "N/A"}건 분리 표기`,
    `보고 품질(유효 ${validSubmissionRate}%, 정시 ${onTimeRate}%, stale ${staleCount})과 런타임 실패(${runtimeFailCount}/${runtimeTimeoutCount})를 반영해 대기자금 비중 확대`,
    Number.isFinite(onTimeRateGapPctp)
      ? `정시율 소스 차이(통합 ${onTimeRate}% vs 신뢰성 ${reliabilityOnTimeRate}%, 차이 ${onTimeRateGapPctp}%p) 모니터링`
      : "정시율 소스 차이는 데이터 부족으로 판정 보류",
    `일 목표 대비 손익 격차 ${dailyGapPctp !== null ? `${dailyGapPctp}%p` : "N/A"}는 플러스지만, 보호 지표 미충족으로 방어 배분 유지`,
  ];

  const increaseDecreaseRules = [
    "증액: 비용<=0.20% AND MDD>=-1.50% AND 신규 strategy_id 불일치 0건 AND 제출품질 100%를 2사이클 연속 충족하면 핵심 유지 전략 +5%p(최대 35%)",
    "감액: 비용>0.20% 또는 MDD<-1.50%이면 핵심 유지 전략 -5%p, 동일 비율을 현금/대기자금으로 즉시 이동",
    "동결: strategy_id 운영 가드 불일치가 1건 이상이면 신규 버전 후보 전략은 항상 0% 유지",
    "중단: 오류 24h 2건 이상 또는 MDD<=-2.00%이면 실거래 신규 진입 0%, 복구 전용만 허용",
  ];

  const issues = [];
  if (costFail) issues.push(`[ISSUE] H | 비용 ${fmtPct(appliedCost)}가 한도 ${fmtPct(costLimit)} 초과 | 비용 차단 유지`);
  if (mddFail) issues.push(`[ISSUE] H | MDD ${fmtPct(appliedMdd)}가 기준 ${fmtPct(mddLimit)} 하회 | 신규 확대 금지`);
  if (strategyMismatchGuard > 0) {
    issues.push(
      `[ISSUE] M | strategy_id 운영 가드 ${strategyMismatchGuard}건(누적 ${strategyMismatchTotal}건, 신규 ${strategyMismatchFresh}건) | 신규 버전 실거래 배분 0% 유지`
    );
  }
  if (reportFail) {
    issues.push(
      `[ISSUE] M | 보고품질 유효 ${validSubmissionRate}%/정시 ${onTimeRate}%/stale ${staleCount} | 제출 품질 정상화 전 방어 배분 유지`
    );
  }
  if (onTimeSourceConflict) {
    issues.push(
      `[ISSUE] M | 정시율 소스 차이 ${onTimeRateGapPctp}%p(통합 ${onTimeRate}% vs 신뢰성 ${reliabilityOnTimeRate}%) | metric_reconciliation_owner 원인 분해 필요`
    );
  }
  if (Number.isFinite(consistencyMismatchCount) || Number.isFinite(liveDriftMismatchCount)) {
    const issueGrade =
      (Number.isFinite(consistencyMismatchCount) && consistencyMismatchCount > 0) ||
      (Number.isFinite(liveDriftMismatchCount) && liveDriftMismatchCount > 0)
        ? "M"
        : "L";
    issues.push(
      `[ISSUE] ${issueGrade} | 운영충돌(consistency_check) ${
        Number.isFinite(consistencyMismatchCount) ? consistencyMismatchCount : "N/A"
      }건 / 실시간차이(live_drift_check) ${
        Number.isFinite(liveDriftMismatchCount) ? liveDriftMismatchCount : "N/A"
      }건 | 운영 판정은 승인 보수값, 실시간차이 축소 필요`
    );
  }
  if (runtimeFail) {
    issues.push(
      `[ISSUE] M | 런타임 실패 ${runtimeFailCount}건, 시간초과 ${runtimeTimeoutCount}건 | 자동운영 안정화 전 레버리지 상향 금지`
    );
  }
  if (Number.isFinite(adverseP95Bps) && adverseP95Bps > 25) {
    issues.push(`[ISSUE] M | 체결 불리 슬리피지 P95 ${adverseP95Bps}bps | 주문 규모 확대 금지`);
  }

  const nextReportSource = {
    staff_to_jihye_kst:
      (approval.next_report && approval.next_report.staff_to_jihye) ||
      (rc.recommendation && rc.recommendation.next_report_staff_to_jihye_kst) ||
      reportQuality.next_staff_report_kst ||
      null,
    jihye_to_jaeyong_kst:
      (approval.next_report && approval.next_report.jihye_to_jaeyong) ||
      (rc.recommendation && rc.recommendation.next_report_jihye_to_jaeyong_kst) ||
      reportQuality.next_jihye_report_kst ||
      null,
  };
  const staffSourceMs = parseKstLabelToEpochMs(nextReportSource.staff_to_jihye_kst);
  const jihyeSourceMs = parseKstLabelToEpochMs(nextReportSource.jihye_to_jaeyong_kst);
  const defaultGapMs = 2 * 60 * 1000;
  const preservedGapMs =
    Number.isFinite(staffSourceMs) && Number.isFinite(jihyeSourceMs) && jihyeSourceMs > staffSourceMs
      ? jihyeSourceMs - staffSourceMs
      : defaultGapMs;
  const staffFinalMs = Number.isFinite(staffSourceMs) && staffSourceMs > now ? staffSourceMs : now + 10 * 60 * 1000;
  const jihyeFinalMs =
    Number.isFinite(jihyeSourceMs) && jihyeSourceMs > staffFinalMs ? jihyeSourceMs : staffFinalMs + preservedGapMs;
  const reportClockAutoRecoveryApplied =
    !(Number.isFinite(staffSourceMs) && staffSourceMs === staffFinalMs) ||
    !(Number.isFinite(jihyeSourceMs) && jihyeSourceMs === jihyeFinalMs);

  const nextReport = {
    staff_to_jihye_kst: toMinuteKstString(staffFinalMs),
    jihye_to_jaeyong_kst: toMinuteKstString(jihyeFinalMs),
    source_staff_to_jihye_kst: nextReportSource.staff_to_jihye_kst,
    source_jihye_to_jaeyong_kst: nextReportSource.jihye_to_jaeyong_kst,
    auto_recovery_applied: reportClockAutoRecoveryApplied,
  };
  if (reportClockAutoRecoveryApplied) {
    issues.push(
      `[ISSUE] M | 원본 보고 시각(${nextReportSource.staff_to_jihye_kst || "미기재"} -> ${
        nextReportSource.jihye_to_jaeyong_kst || "미기재"
      })이 현재 시각 기준 만료/누락 | 다음 보고 시각을 ${nextReport.staff_to_jihye_kst} -> ${nextReport.jihye_to_jaeyong_kst}로 자동 복구`
    );
  }

  const collaborationRequests = [
    `[COLLAB_REQUEST] risk_controller | 비용/MDD 정상화 2사이클 연속 증빙치 제출 | ${nextReport.staff_to_jihye_kst || "다음 보고 전"}`,
    `[COLLAB_REQUEST] signal_id_alignment_owner | 누적 불일치 ${strategyMismatchTotal}건의 재발 방지 체크 결과 제출 | ${
      nextReport.staff_to_jihye_kst || "다음 보고 전"
    }`,
    `[COLLAB_REQUEST] metric_reconciliation_owner | 정시율 소스 차이 ${Number.isFinite(onTimeRateGapPctp) ? `${onTimeRateGapPctp}%p` : "N/A"} 원인/단일 기준안 제출 | ${
      nextReport.staff_to_jihye_kst || "다음 보고 전"
    }`,
    `[COLLAB_REQUEST] execution_microstructure_owner | 슬리피지 P95 ${adverseP95Bps}bps 개선 A/B안 제출 | ${nextReport.staff_to_jihye_kst || "다음 보고 전"}`,
  ];

  const evolutionPlan = [
    "[EVOLUTION] 배분안 산출을 스크립트로 자동화해 사이클별 수치 편차를 줄임 | 수동 계산 오류 감소",
    "[EVOLUTION] 증액 조건을 2사이클 연속 통과 규칙으로 고정 | 급격한 위험 재노출 방지",
    "[EVOLUTION] 신규 버전 버킷을 mismatch 기반 자동 동결로 전환 | 전략 과집중/오동작 예방",
    "[EVOLUTION] 정시율 소스 충돌을 자동 경보로 추가 | 보고 품질 지표 혼선 조기 차단",
  ];

  const sourceReadStatus = Object.keys(reads).map((key) => ({
    key,
    path: rel(reads[key].path),
    ok: reads[key].ok,
    error: reads[key].error,
  }));
  const loadedSources = sourceReadStatus.filter((x) => x.ok).length;
  const totalSources = sourceReadStatus.length;

  const weightSumPct = currentAllocationPlan.reduce((acc, row) => acc + toNum(row.weight_pct, 0), 0);

  const payload = {
    generated_at_iso: new Date(now).toISOString(),
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    cycle,
    role: "capital_allocation_manager",
    mission: "바이낸스 월 5% 목표를 위한 전략/계정 단위 자본배분 및 레버리지 최적화",
    status_recommendation: statusRecommendation,
    mode_recommendation: modeRecommendation,
    go_no_go: goNoGo,
    progress_pct: 100,
    key_metrics: {
      required_daily_pct: requiredDailyPct,
      net_pnl_pct: netPnlPct,
      gap_vs_required_daily_pctp: dailyGapPctp,
      applied_cost_ratio_pct: appliedCost,
      cost_limit_pct: costLimit,
      applied_mdd_pct: appliedMdd,
      mdd_limit_pct: mddLimit,
      error_count_24h: appliedError,
      error_stop_threshold_24h: errorStop,
      strategy_id_mismatch_total: strategyMismatchTotal,
      strategy_id_mismatch_fresh: strategyMismatchFresh,
      strategy_id_mismatch_guard: strategyMismatchGuard,
      valid_submission_rate_pct: validSubmissionRate,
      on_time_rate_pct: onTimeRate,
      reliability_valid_submission_rate_pct: reliabilityValidSubmissionRate,
      reliability_on_time_rate_pct: reliabilityOnTimeRate,
      on_time_rate_gap_pctp: onTimeRateGapPctp,
      consistency_check_mismatch_count: consistencyMismatchCount,
      live_drift_check_mismatch_count: liveDriftMismatchCount,
      signals_count: signalsCount,
      drops_count: dropsCount,
      fill_rate_pct: fillRatePct,
      adverse_slippage_p95_bps: adverseP95Bps,
    },
    account_leverage_plan: {
      max_account_leverage: maxAccountLeverage,
      recommended_account_leverage: recommendedAccountLeverage,
      reason: hardDefensive
        ? "비용/MDD 보호 기준 미충족 상태라 레버리지 방어 모드 적용"
        : "핵심 보호 기준 충족 범위에서 제한적 운영",
    },
    current_allocation_plan: currentAllocationPlan,
    adjustment_rationale: adjustmentRationale,
    increase_decrease_rules: increaseDecreaseRules,
    next_report: nextReport,
    report_to_jihye: {
      decision_request:
        "A안(권고): 현재 배분안 유지 후 2사이클 연속 정상 시에만 +5%p 증액 / B안: 다음 사이클 즉시 +5%p 시범 증액",
      recommended_option: "A",
      summary: `보수값 기준 비용 ${fmtPct(appliedCost)}, MDD ${fmtPct(appliedMdd)}, 운영충돌(consistency_check) ${
        Number.isFinite(consistencyMismatchCount) ? consistencyMismatchCount : "N/A"
      }건, 실시간차이(live_drift_check) ${
        Number.isFinite(liveDriftMismatchCount) ? liveDriftMismatchCount : "N/A"
      }건, mismatch 운영 가드 ${strategyMismatchGuard}건(누적 ${strategyMismatchTotal}건), 정시율 차이 ${
        Number.isFinite(onTimeRateGapPctp) ? `${onTimeRateGapPctp}%p` : "N/A"
      }로 방어 배분 유지 필요`,
    },
    source_files: sourceReadStatus,
    executed_now: [
      `최신 운영 파일 ${loadedSources}종 로드 및 핵심 지표 추출`,
      "전략/계정 단위 비중과 레버리지 방어 배분 자동 계산",
      "지혜 보고용 JSON/MD 산출물 및 latest 파일 동시 갱신",
    ],
    issues,
    collaboration_requests_via_jihye: collaborationRequests,
    evolution_plan: evolutionPlan,
    self_validation: {
      checks: [
        `입력 파일 로드 ${loadedSources}/${totalSources}개 확인`,
        `배분 비중 합계 ${round(weightSumPct, 2)}% 확인`,
        `No-Go 상태에서 신규 버전 후보 배분 ${candidateNewVersionPct}% 동결 확인`,
        `계정 레버리지 권고 ${recommendedAccountLeverage}x <= 상한 ${maxAccountLeverage}x 확인`,
        `다음 보고 시각 ${nextReport.staff_to_jihye_kst} -> ${nextReport.jihye_to_jaeyong_kst}가 현재 이후인지 확인`,
        `정시율 소스 차이 ${Number.isFinite(onTimeRateGapPctp) ? `${onTimeRateGapPctp}%p` : "N/A"} 기록`,
        `운영충돌(consistency_check) ${
          Number.isFinite(consistencyMismatchCount) ? consistencyMismatchCount : "N/A"
        }건 / 실시간차이(live_drift_check) ${
          Number.isFinite(liveDriftMismatchCount) ? liveDriftMismatchCount : "N/A"
        }건 동시 표기 확인`,
      ],
      result:
        loadedSources === totalSources &&
        round(weightSumPct, 2) === 100 &&
        recommendedAccountLeverage <= maxAccountLeverage
          ? "pass"
          : "fail",
      loaded_sources: loadedSources,
      total_sources: totalSources,
      weight_sum_pct: round(weightSumPct, 2),
    },
  };

  const datedJson = `${dateKey}_capital_allocation_manager_${cycle}_jihye.json`;
  const datedMd = `${dateKey}_capital_allocation_manager_${cycle}_jihye.md`;
  const latestJson = "capital_allocation_manager_latest.json";
  const latestMd = "capital_allocation_manager_latest.md";

  const datedJsonPath = path.join(OPS_DAILY, datedJson);
  const datedMdPath = path.join(OPS_DAILY, datedMd);
  const latestJsonPath = path.join(OPS_DAILY, latestJson);
  const latestMdPath = path.join(OPS_DAILY, latestMd);

  payload.output_files = {
    dated_json: datedJson,
    dated_md: datedMd,
    latest_json: latestJson,
    latest_md: latestMd,
  };

  fs.writeFileSync(datedJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMdPath, buildMarkdown(payload), "utf8");
  fs.copyFileSync(datedJsonPath, latestJsonPath);
  fs.copyFileSync(datedMdPath, latestMdPath);

  console.log(
    JSON.stringify(
      {
        ok: true,
        generated_at_kst: generatedAtKst,
        decision: `${statusRecommendation} / ${modeRecommendation} / ${goNoGo}`,
        key_metrics: {
          applied_cost_ratio_pct: appliedCost,
          applied_mdd_pct: appliedMdd,
          strategy_id_mismatch_total: strategyMismatchTotal,
          on_time_rate_pct: onTimeRate,
          reliability_on_time_rate_pct: reliabilityOnTimeRate,
          on_time_rate_gap_pctp: onTimeRateGapPctp,
        },
        account_leverage: recommendedAccountLeverage,
        allocation: currentAllocationPlan.map((x) => ({ bucket: x.bucket, weight_pct: x.weight_pct })),
        outputs: {
          dated_json: rel(datedJsonPath),
          dated_md: rel(datedMdPath),
          latest_json: rel(latestJsonPath),
          latest_md: rel(latestMdPath),
        },
        self_validation: payload.self_validation,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error("capital-allocation-manager-cycle failed:", error && error.message ? error.message : error);
  process.exit(1);
}
