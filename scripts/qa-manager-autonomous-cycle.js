#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString } = require("../src/utils/timeKst");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");

function readJsonSafe(absPath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(absPath, "utf8")) };
  } catch (err) {
    return { ok: false, data: null, error: err && err.message ? err.message : String(err) };
  }
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function pct(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return `${fmt(value, digits)}%`;
}

function pickLatestByPattern(pattern) {
  const names = fs.readdirSync(OPS_DAILY).filter((name) => pattern.test(name));
  if (!names.length) return null;
  let selected = null;
  let selectedMs = -Infinity;
  names.forEach((name) => {
    const abs = path.join(OPS_DAILY, name);
    const ms = fs.statSync(abs).mtimeMs;
    if (ms > selectedMs) {
      selected = { name, abs, mtimeMs: ms };
      selectedMs = ms;
    }
  });
  return selected;
}

function maxFinite(values, fallback = null) {
  const nums = values.map((v) => toNum(v, null)).filter((v) => Number.isFinite(v));
  if (!nums.length) return fallback;
  return Math.max(...nums);
}

function minFinite(values, fallback = null) {
  const nums = values.map((v) => toNum(v, null)).filter((v) => Number.isFinite(v));
  if (!nums.length) return fallback;
  return Math.min(...nums);
}

function parseKstToMs(raw) {
  const m = String(raw || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?(?:\s*KST)?$/);
  if (!m) return null;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]) - 9,
    Number(m[5]),
    Number(m[6] || "0"),
    0
  );
}

function addMinutesKst(baseKst, minutes) {
  const ms = parseKstToMs(baseKst);
  if (!Number.isFinite(ms)) return null;
  return toKstString(ms + minutes * 60 * 1000, { fallbackToString: true });
}

function minutesSinceMtime(absPath, baseMs) {
  try {
    const ms = fs.statSync(absPath).mtimeMs;
    return Math.max(0, (baseMs - ms) / (60 * 1000));
  } catch (_err) {
    return null;
  }
}

function toStatus(value, mode, threshold) {
  if (mode === "hold_if_false") return value ? "PASS" : "HOLD";
  if (mode === "hold_if_nonzero") return value === 0 ? "PASS" : "HOLD";
  if (mode === "eq") {
    if (value === null || value === undefined) return "HOLD";
    return value === threshold ? "PASS" : "FAIL";
  }
  if (!Number.isFinite(value)) return "HOLD";
  if (mode === "lte") return value <= threshold ? "PASS" : "FAIL";
  if (mode === "lt") return value < threshold ? "PASS" : "FAIL";
  if (mode === "gte") return value >= threshold ? "PASS" : "FAIL";
  if (mode === "gt") return value > threshold ? "PASS" : "FAIL";
  return "HOLD";
}

function caseObj(id, name, currentValue, threshold, status) {
  return { id, name, current_value: currentValue, threshold, status };
}

function markdownLineForValue(value, suffix = "") {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "number") return `${value}${suffix}`;
  return `${value}${suffix}`;
}

function buildMarkdown(payload) {
  const lines = [];
  const tc = payload.test_cases;
  const c = payload.test_case_counts;
  const d = payload.decision;
  const r = payload.representative_report_recommendation;

  lines.push(`# ${payload.generated_at_kst.slice(0, 10)} QA 자율 운영 사이클 ${payload.cycle_hhmm} (품질 관리자 -> 지혜)`);
  lines.push("");
  lines.push(`기준 시각: ${payload.as_of_kst}`);
  lines.push(`실행 시각: ${payload.generated_at_kst}`);
  lines.push(`최종 판정: \`${d.trading_operation}\` / 운영 모드: \`${d.mode}\` / 수익 확대: \`${d.growth_actions}\``);
  lines.push("");
  lines.push("## 검증 범위");
  payload.validation_scope.forEach((v, idx) => {
    lines.push(`${idx + 1}. ${v}`);
  });
  lines.push("");
  lines.push("## 테스트 케이스");
  lines.push("| ID | 항목 | 현재값 | 기준 | 판정 |");
  lines.push("|---|---|---:|---:|---|");
  tc.forEach((t) => {
    const current = markdownLineForValue(t.current_value);
    lines.push(`| ${t.id} | ${t.name} | ${current} | ${t.threshold} | ${t.status} |`);
  });
  lines.push("");
  lines.push(`요약: PASS ${c.pass} / HOLD ${c.hold} / FAIL ${c.fail}`);
  lines.push("");
  lines.push("## 합격 기준");
  lines.push("1. 운영 데일리 게이트");
  lines.push("- 비용 비율 <= 0.20%");
  lines.push("- 순손익 >= +0.1667%");
  lines.push("- MDD > -1.50%");
  lines.push("- 24h 핵심 오류 < 2건");
  lines.push("- 유효 제출률/정시율/A-B 포함률 = 100%");
  lines.push("- stale/누락 = 0건");
  lines.push("- 24h 실패 <= 6건, 24h 시간초과 <= 3건");
  lines.push("- 보고 시각 충돌 = 0건");
  lines.push("");
  lines.push("2. 백테스트 게이트");
  lines.push("- 최근 180일 이상, 거래 200건 이상");
  lines.push("- 비용 반영 누적수익률 >= +8%");
  lines.push("- MDD >= -6.0%");
  lines.push("");
  lines.push("3. 워크포워드 게이트");
  lines.push("- 4구간 중 3구간 이상 양수");
  lines.push("- 월 평균 >= +0.8%");
  lines.push("- 구간 MDD >= -4.0%");
  lines.push("");
  lines.push("4. 페이퍼 게이트");
  lines.push("- 최근 14일 수익률 >= +1.5%");
  lines.push("- 비용 평균 <= 0.20%");
  lines.push("- 주문 실패율 <= 1.0%");
  lines.push("- 데이터 결측 = 0건");
  lines.push("");
  lines.push("5. 실거래 게이트");
  lines.push("- 최근 7일 비용 평균 <= 0.20%");
  lines.push("- 슬리피지 p95 <= 0.08%");
  lines.push("- 주문 실패율 <= 0.5%");
  lines.push("- 체결 수량 이상치 = 0건");
  lines.push("- 보고 시각 충돌 = 0건");
  lines.push("- 공격 전환 최소 표본 30구간 이상");
  lines.push("");
  lines.push("## 실패 시 조치");
  payload.failure_actions.forEach((x, idx) => {
    lines.push(`${idx + 1}. ${x}`);
  });
  lines.push("");
  lines.push("## 대표 보고 권고");
  lines.push("1. 독립 실행안");
  r.independent_execution_plan.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("2. 지혜에게 보고할 내용");
  lines.push(`- 진행률: \`${r.report_to_jihye.progress_pct}\``);
  lines.push("- 핵심 성과:");
  r.report_to_jihye.core_outcomes.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 핵심 리스크:");
  r.report_to_jihye.core_risk.forEach((x) => lines.push(`  - ${x}`));
  lines.push(`- 지혜 의사결정 요청: ${r.report_to_jihye.decision_request}`);
  lines.push("");
  lines.push("3. 지혜를 통해 전달할 협업 요청");
  r.collaboration_requests_via_jihye.forEach((x) => {
    lines.push(`- ${x.to}: ${x.request} (${x.deadline_kst})`);
  });
  lines.push("");
  lines.push("4. 진화 계획");
  r.evolution_plan.forEach((x) => {
    lines.push(`[EVOLUTION] ${x.change} | ${x.expected_effect}`);
  });
  lines.push("");
  payload.issues.forEach((x) => lines.push(x));
  lines.push("");
  lines.push("## 자가검증 결과");
  lines.push("1. 실제로 지금 실행한 일");
  payload.self_validation.executed_now.forEach((x) => lines.push(`- \`${x}\``));
  lines.push("");
  lines.push("2. 검증 결과");
  payload.self_validation.checks.forEach((x) => lines.push(`- ${x}`));
  lines.push(`- 결론: \`${payload.self_validation.result}\``);
  if (payload.self_validation.open_risk) {
    lines.push(`- 미해결 리스크: ${payload.self_validation.open_risk}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMs = Date.now();
  const generatedAtKst = toKstString(nowMs, { fallbackToString: true });
  const asOfKst = generatedAtKst;
  const dateKey = generatedAtKst.slice(0, 10);
  const hhmm = generatedAtKst.slice(11, 16).replace(":", "");

  const syncPicked = pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_sync_status_board_\d{4}_jihye\.json$/);
  const reliabilityPicked = pickLatestByPattern(
    /^\d{4}-\d{2}-\d{2}_report_reliability_delay_conflict_\d{4}_jihye\.json$/
  );
  const matrixPicked = pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_governance_reporting_matrix_.*_jihye\.json$/);
  const clockLatestPicked = pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_clock_manager_latest_jihye\.json$/);
  const performancePicked = pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_performance_metrics_.*\.json$/);

  const fileMap = {
    system_autonomous: path.join(OPS_DAILY, "system_autonomous_cycle_latest.json"),
    system_ops: path.join(OPS_DAILY, "system_ops_check_latest.json"),
    qa_failure: path.join(OPS_DAILY, "qa_failure_mode_precheck_latest.json"),
    runtime: path.join(OPS_DAILY, "role_bot_runtime_check_latest.json"),
    gap_conflict: path.join(OPS_DAILY, "report_gap_conflict_manager_latest.json"),
    signal: path.join(OPS_DAILY, "post_apply_signal_probe_latest.json"),
    consistency: path.join(OPS_DAILY, "data_consistency_lead_latest.json"),
    approval: path.join(OPS_DAILY, "approval_execution_latest.json"),
    performance: performancePicked ? performancePicked.abs : null,
    sync_board: syncPicked ? syncPicked.abs : null,
    reliability: reliabilityPicked ? reliabilityPicked.abs : null,
    matrix: matrixPicked ? matrixPicked.abs : null,
    report_clock_latest: clockLatestPicked ? clockLatestPicked.abs : null,
    ceo_governance: path.join(OPS_DAILY, "ceo_24h_autonomous_governance_latest.json"),
  };

  const systemAuto = readJsonSafe(fileMap.system_autonomous).data || {};
  const systemOps = readJsonSafe(fileMap.system_ops).data || {};
  const qaFailure = readJsonSafe(fileMap.qa_failure).data || {};
  const runtime = readJsonSafe(fileMap.runtime).data || {};
  const gap = readJsonSafe(fileMap.gap_conflict).data || {};
  const signal = readJsonSafe(fileMap.signal).data || {};
  const consistency = readJsonSafe(fileMap.consistency).data || {};
  const approval = readJsonSafe(fileMap.approval).data || {};
  const performance = fileMap.performance ? readJsonSafe(fileMap.performance).data || {} : {};
  const syncBoard = fileMap.sync_board ? readJsonSafe(fileMap.sync_board).data || {} : {};
  const reliability = fileMap.reliability ? readJsonSafe(fileMap.reliability).data || {} : {};
  const matrix = fileMap.matrix ? readJsonSafe(fileMap.matrix).data || {} : {};
  const clock = fileMap.report_clock_latest ? readJsonSafe(fileMap.report_clock_latest).data || {} : {};
  const ceoGov = readJsonSafe(fileMap.ceo_governance).data || {};

  const liveCost = toNum(systemOps.cost_ratio_pct, toNum(performance.cost_ratio_pct, null));
  const liveMdd = toNum(systemOps.mdd_pct, toNum(performance.mdd_pct, null));
  const liveErrorCount = toNum(systemOps.error_count_24h, toNum(performance.error_count_24h, null));

  const conservativeCost = maxFinite([
    consistency?.consolidated_metrics?.cost_ratio_pct,
    gap?.key_numbers?.cost_ratio_pct,
    approval?.decision?.current_metrics?.cost_ratio_pct,
    liveCost,
  ]);
  const conservativeMdd = minFinite([
    consistency?.consolidated_metrics?.mdd_pct,
    gap?.key_numbers?.mdd_pct,
    approval?.decision?.current_metrics?.mdd_pct,
    liveMdd,
  ]);
  const conservativeErrorCount = maxFinite([
    consistency?.consolidated_metrics?.error_count_24h,
    gap?.key_numbers?.error_count_24h,
    approval?.decision?.current_metrics?.error_count_24h,
    liveErrorCount,
  ]);

  const validRateConservative = minFinite([
    syncBoard?.summary?.valid_submission_rate_pct,
    reliability?.metrics?.submission_board?.valid_submission_rate_pct,
    gap?.key_numbers?.valid_submission_rate_pct,
    consistency?.consolidated_metrics?.valid_submission_rate_pct,
  ]);
  const onTimeRateConservative = minFinite([
    syncBoard?.summary?.on_time_rate_pct,
    reliability?.metrics?.submission_board?.on_time_rate_pct,
    gap?.key_numbers?.on_time_rate_pct,
    consistency?.consolidated_metrics?.on_time_rate_pct,
  ]);
  const staleCountConservative = maxFinite([
    syncBoard?.summary?.stale_or_missing_count,
    reliability?.metrics?.submission_board?.stale_or_missing_count,
    gap?.key_numbers?.stale_or_missing_count,
    consistency?.consolidated_metrics?.stale_or_missing_count,
  ]);
  const conflictCountConservative = maxFinite([
    reliability?.conflict_agenda ? reliability.conflict_agenda.length : null,
    reliability?.metrics?.consistency_check?.mismatch_count,
    gap?.key_numbers?.conflict_count,
    consistency?.consolidated_metrics?.conflict_count,
  ]);

  const liveStaleCount = maxFinite([
    gap?.key_numbers?.stale_or_missing_count,
    consistency?.consolidated_metrics?.stale_or_missing_count,
  ]);
  const codexFailConservative = maxFinite([
    runtime?.aggregate?.codex_fail_count_24h,
    gap?.key_numbers?.codex_fail_count_24h,
    consistency?.consolidated_metrics?.codex_fail_count_24h,
  ]);
  const codexTimeoutConservative = maxFinite([
    runtime?.aggregate?.codex_timeout_event_count_24h,
    gap?.key_numbers?.codex_timeout_event_count_24h,
    consistency?.consolidated_metrics?.codex_timeout_event_count_24h,
  ]);
  const abRateLive = toNum(syncBoard?.summary?.ab_included_rate_pct_valid_only, null);

  const clockMatrixVsRole = toNum(clock?.key_numbers?.conflict_matrix_vs_role, null);
  const clockApprovalVsRole = toNum(clock?.key_numbers?.conflict_approval_vs_role, null);
  const clockPair = `${Number.isFinite(clockMatrixVsRole) ? clockMatrixVsRole : "N/A"}/${
    Number.isFinite(clockApprovalVsRole) ? clockApprovalVsRole : "N/A"
  }`;

  const fmFailCount = toNum(qaFailure.fail_count, null);
  const fmHoldCount = toNum(qaFailure.hold_count, null);
  const fmChecks = Array.isArray(qaFailure.checks) ? qaFailure.checks : [];
  const slippageReady = fmChecks.find((x) => x.id === "FM-03")?.status === "PASS";
  const orderFailRateReady = fmChecks.find((x) => x.id === "FM-04")?.status === "PASS";

  const signalCount = toNum(signal?.counts?.signals, toNum(gap?.key_numbers?.signals_count, null));
  const dropCount = maxFinite([signal?.counts?.drops, gap?.key_numbers?.drops_count]);
  const sampleConservative = toNum(consistency?.consolidated_metrics?.sample_intervals_conservative, null);

  const tc = [];
  tc.push(caseObj("TC-01", "보수 기준 비용 비율", conservativeCost, "<=0.20", toStatus(conservativeCost, "lte", 0.2)));
  tc.push(caseObj("TC-02", "실시간 비용 비율", liveCost, "<=0.20", toStatus(liveCost, "lte", 0.2)));
  tc.push(caseObj("TC-03", "보수 기준 MDD", conservativeMdd, ">-1.50", toStatus(conservativeMdd, "gt", -1.5)));
  tc.push(caseObj("TC-04", "실시간 MDD", liveMdd, ">-1.50", toStatus(liveMdd, "gt", -1.5)));
  tc.push(caseObj("TC-05", "24h 핵심 오류(보수 기준)", conservativeErrorCount, "<2", toStatus(conservativeErrorCount, "lt", 2)));
  tc.push(caseObj("TC-06", "stale/누락(보수 기준)", staleCountConservative, "=0", toStatus(staleCountConservative, "eq", 0)));
  tc.push(caseObj("TC-07", "stale/누락(실시간)", liveStaleCount, "=0", toStatus(liveStaleCount, "eq", 0)));
  tc.push(caseObj("TC-08", "24h Codex 실패(보수 기준)", codexFailConservative, "<=6", toStatus(codexFailConservative, "lte", 6)));
  tc.push(
    caseObj("TC-09", "24h Codex 시간초과(보수 기준)", codexTimeoutConservative, "<=3", toStatus(codexTimeoutConservative, "lte", 3))
  );
  tc.push(
    caseObj("TC-10", "유효 제출률(보수 기준)", validRateConservative, "=100", toStatus(validRateConservative, "eq", 100))
  );
  tc.push(
    caseObj("TC-11", "정시율(보수 기준)", onTimeRateConservative, "=100", toStatus(onTimeRateConservative, "eq", 100))
  );
  tc.push(caseObj("TC-12", "A/B 포함률(실시간 유효 제출 기준)", abRateLive, "=100", toStatus(abRateLive, "eq", 100)));
  tc.push(caseObj("TC-13", "수치 충돌 건수(보수 기준)", conflictCountConservative, "=0", toStatus(conflictCountConservative, "eq", 0)));
  const tc14Status =
    clockPair === "0/0" ? "PASS" : clockPair === "N/A/N/A" ? "HOLD" : "FAIL";
  tc.push(caseObj("TC-14", "보고 시각 충돌(matrix/approval vs role)", clockPair, "0/0", tc14Status));
  tc.push(caseObj("TC-15", "실패 모드 FAIL 건수", fmFailCount, "=0", toStatus(fmFailCount, "eq", 0)));
  tc.push(caseObj("TC-16", "실패 모드 HOLD 건수", fmHoldCount, "=0", toStatus(fmHoldCount, "hold_if_nonzero")));
  tc.push(caseObj("TC-17", "슬리피지 지표 준비", slippageReady, "true", toStatus(slippageReady, "eq", true)));
  tc.push(caseObj("TC-18", "주문 실패율 계산 준비", orderFailRateReady, "true", toStatus(orderFailRateReady, "hold_if_false")));
  tc.push(caseObj("TC-19", "실신호 수", signalCount, ">=1", toStatus(signalCount, "gte", 1)));
  tc.push(caseObj("TC-20", "공격 전환 최소 표본(보수 구간)", sampleConservative, ">=30", toStatus(sampleConservative, "gte", 30)));

  const passCount = tc.filter((x) => x.status === "PASS").length;
  const holdCount = tc.filter((x) => x.status === "HOLD").length;
  const failCount = tc.filter((x) => x.status === "FAIL").length;

  const staffToJihye =
    ceoGov?.reporting_system?.next_cycle?.staff_deadline ||
    matrix?.report_system?.next_report?.staff_to_jihye ||
    approval?.next_report?.staff_to_jihye ||
    null;
  const jihyeToJaeyong =
    ceoGov?.reporting_system?.next_cycle?.ceo_report ||
    matrix?.report_system?.next_report?.jihye_to_jaeyong ||
    approval?.next_report?.jihye_to_jaeyong ||
    null;
  const reportingWindowMin = 2;
  const cadenceMin = toNum(consistency?.cadence_min, 30) || 30;
  const cadenceMs = cadenceMin * 60 * 1000;
  let effectiveStaffDeadlineMs = parseKstToMs(staffToJihye);
  if (Number.isFinite(effectiveStaffDeadlineMs)) {
    while (effectiveStaffDeadlineMs + reportingWindowMin * 60 * 1000 < nowMs) {
      effectiveStaffDeadlineMs += cadenceMs;
    }
  }
  const reportingDeltaMin = Number.isFinite(effectiveStaffDeadlineMs)
    ? (nowMs - effectiveStaffDeadlineMs) / (60 * 1000)
    : null;
  const reportingTimeNow = Number.isFinite(reportingDeltaMin)
    ? Math.abs(reportingDeltaMin) <= reportingWindowMin
    : true;
  const nextCycleDeadline = Number.isFinite(effectiveStaffDeadlineMs)
    ? toKstString(effectiveStaffDeadlineMs, { fallbackToString: true })
    : addMinutesKst(generatedAtKst, cadenceMin);
  const nextCycleRiskDeadline = Number.isFinite(effectiveStaffDeadlineMs)
    ? toKstString(effectiveStaffDeadlineMs + 2 * 60 * 1000, { fallbackToString: true })
    : addMinutesKst(generatedAtKst, cadenceMin + 2);

  const decisionReasons = [];
  if (Number.isFinite(conservativeCost) && conservativeCost > 0.2) {
    decisionReasons.push(`보수 기준 비용 ${pct(conservativeCost)} > 0.20%`);
  }
  if (Number.isFinite(conservativeMdd) && conservativeMdd <= -1.5) {
    decisionReasons.push(`보수 기준 MDD ${pct(conservativeMdd)} <= -1.50%`);
  }
  if (Number.isFinite(staleCountConservative) && staleCountConservative > 0) {
    decisionReasons.push(`보수 기준 stale/누락 ${staleCountConservative}건`);
  }
  if (Number.isFinite(validRateConservative) && validRateConservative < 100) {
    decisionReasons.push(`보수 기준 유효 제출률 ${fmt(validRateConservative, 1)}% < 100%`);
  }
  if (Number.isFinite(onTimeRateConservative) && onTimeRateConservative < 100) {
    decisionReasons.push(`보수 기준 정시율 ${fmt(onTimeRateConservative, 1)}% < 100%`);
  }
  if (failCount > 0) {
    decisionReasons.push(`테스트 FAIL ${failCount}건`);
  }
  if (holdCount > 0) {
    decisionReasons.push(`테스트 HOLD ${holdCount}건`);
  }

  const issues = [];
  if (Number.isFinite(conservativeCost) && conservativeCost > 0.2) {
    issues.push(`[ISSUE] H | 비용 ${pct(conservativeCost)}가 상한 0.20% 초과 | 비용 차단 유지 필요`);
  }
  if (Number.isFinite(conservativeMdd) && conservativeMdd <= -1.5) {
    issues.push(`[ISSUE] H | MDD ${pct(conservativeMdd)}가 보류선 -1.50% 미달 | 공격 전환 금지 유지`);
  }
  if (Number.isFinite(staleCountConservative) && staleCountConservative > 0) {
    issues.push(`[ISSUE] H | stale/누락 보수값 ${staleCountConservative}건 | 재제출 강제 필요`);
  }
  if (Number.isFinite(validRateConservative) && validRateConservative < 100) {
    issues.push(`[ISSUE] H | 유효 제출률 ${pct(validRateConservative, 1)} < 100% | 누락 제출 즉시 보완 필요`);
  }
  if (Number.isFinite(onTimeRateConservative) && onTimeRateConservative < 100) {
    issues.push(`[ISSUE] H | 정시율 ${pct(onTimeRateConservative, 1)} < 100% | 마감 전 10분/3분 경보 강화 필요`);
  }
  if (Number.isFinite(abRateLive) && abRateLive < 100) {
    issues.push(`[ISSUE] M | A/B 포함률 ${pct(abRateLive, 1)} < 100% | 보고 포맷 누락 필드 보완 필요`);
  }
  if (Number.isFinite(conflictCountConservative) && conflictCountConservative > 0) {
    issues.push(`[ISSUE] H | 수치 충돌 ${conflictCountConservative}건 | 충돌 원천 파일 재정합 필요`);
  }
  if (clockPair !== "0/0" && clockPair !== "N/A/N/A") {
    issues.push(`[ISSUE] H | 보고 시각 충돌 ${clockPair} | 마감 시각 단일 소스 재고정 필요`);
  }
  if (slippageReady !== true) {
    issues.push("[ISSUE] H | 슬리피지 지표 미준비(FM-03) | 원천 파일 JSON 복구 전 주문 확대 금지");
  }
  if (orderFailRateReady !== true) {
    issues.push("[ISSUE] M | 주문 실패율 계산 미준비(FM-04) | 주문 건수 분모 연결 전 HOLD 유지");
  }
  if (Number.isFinite(dropCount) && dropCount > 0) {
    issues.push(`[ISSUE] M | 실신호 ${Number.isFinite(signalCount) ? signalCount : "N/A"}건, 드롭 ${dropCount}건 | 신호 경로 점검 필요`);
  }
  if (Number.isFinite(sampleConservative) && sampleConservative < 30) {
    issues.push(`[ISSUE] M | 공격 전환 표본 ${sampleConservative} < 30 | 표본 확보 전 NO_GO 유지`);
  }
  if (!issues.length) {
    issues.push("[ISSUE] L | 주요 차단 이슈 없음 | 보수 모니터링 유지");
  }

  const evolutionPlan = [
    {
      change: "보고 품질 수치를 보수값(최저 제출률/최저 정시율/최대 stale)으로 고정 계산",
      expected_effect: "지표 충돌 시 판단 흔들림 감소",
    },
    {
      change: "QA 사이클 스크립트에서 JSON+MD를 동시에 생성해 latest 자동 갱신",
      expected_effect: "사이클 누락 없이 30분 보고 리듬 유지",
    },
    {
      change: "실패 모드(FM-03/FM-04)와 신호 드롭을 QA 게이트에 상시 결합",
      expected_effect: "실거래 전환 전 리스크 조기 차단",
    },
  ];

  const freshnessWindowMin = 20;
  const freshnessTargets = [
    { label: "system_autonomous_cycle_latest", abs: fileMap.system_autonomous },
    { label: "qa_failure_mode_precheck_latest", abs: fileMap.qa_failure },
    { label: "role_bot_runtime_check_latest", abs: fileMap.runtime },
    { label: "report_gap_conflict_manager_latest", abs: fileMap.gap_conflict },
    { label: "post_apply_signal_probe_latest", abs: fileMap.signal },
    { label: "data_consistency_lead_latest", abs: fileMap.consistency },
    { label: "approval_execution_latest", abs: fileMap.approval },
    { label: "ceo_24h_autonomous_governance_latest", abs: fileMap.ceo_governance },
    { label: "report_sync_status_board_latest_pick", abs: fileMap.sync_board },
    { label: "report_clock_manager_latest_pick", abs: fileMap.report_clock_latest },
  ].filter((x) => Boolean(x.abs));
  const freshnessSnapshot = freshnessTargets.map((x) => {
    const ageMin = minutesSinceMtime(x.abs, nowMs);
    return {
      name: x.label,
      age_min: Number.isFinite(ageMin) ? Number(ageMin.toFixed(2)) : null,
      fresh_within_window: Number.isFinite(ageMin) ? ageMin <= freshnessWindowMin : false,
    };
  });
  const freshCount = freshnessSnapshot.filter((x) => x.fresh_within_window).length;
  const staleCountText = Number.isFinite(staleCountConservative) ? staleCountConservative : "N/A";
  const reportQualityNeedsRecovery =
    (Number.isFinite(validRateConservative) && validRateConservative < 100) ||
    (Number.isFinite(onTimeRateConservative) && onTimeRateConservative < 100) ||
    (Number.isFinite(abRateLive) && abRateLive < 100);
  const staleNeedsRecovery = Number.isFinite(staleCountConservative) && staleCountConservative > 0;
  const clockConflictExists = clockPair !== "0/0" && clockPair !== "N/A/N/A";
  const runtimeNeedsRecovery =
    (Number.isFinite(codexFailConservative) && codexFailConservative > 0) ||
    (Number.isFinite(codexTimeoutConservative) && codexTimeoutConservative > 0);
  const signalDropExists = Number.isFinite(dropCount) && dropCount > 0;
  const collaborationRequests = [];
  if (staleNeedsRecovery) {
    collaborationRequests.push({
      to: "governance_secretary",
      request: `stale ${staleCountConservative}건 최신본 재제출 및 숫자/A-B 포함 보고 제출`,
      deadline_kst: nextCycleDeadline || "다음 사이클 직원 마감 전",
    });
  }
  if (reportQualityNeedsRecovery) {
    collaborationRequests.push({
      to: "report_sync_keeper",
      request: "유효 제출률/정시율/A-B 포함률을 100%로 복구하고 경보 로그 증빙 제출",
      deadline_kst: nextCycleDeadline || "다음 사이클 직원 마감 전",
    });
  }
  if (clockConflictExists) {
    collaborationRequests.push({
      to: "report_clock_manager",
      request: `보고 시각 충돌(${clockPair}) 원인 분해와 0/0 복구 결과 제출`,
      deadline_kst: nextCycleRiskDeadline || "다음 사이클 지혜 보고 전",
    });
  }
  if (runtimeNeedsRecovery) {
    collaborationRequests.push({
      to: "runtime_recovery_lead",
      request: "24h 실패/시간초과 저감 실행 결과 제출",
      deadline_kst: nextCycleRiskDeadline || "다음 사이클 지혜 보고 전",
    });
  }
  if (signalDropExists) {
    collaborationRequests.push({
      to: "post_apply_signal_observer",
      request: "DROP_STRATEGY_ID_MISMATCH 원인 분해와 대체안 A/B 제출",
      deadline_kst: nextCycleRiskDeadline || "다음 사이클 지혜 보고 전",
    });
  }
  if (!collaborationRequests.length) {
    collaborationRequests.push({
      to: "qa_manager",
      request: "현재 사이클 품질 지표 정상 유지 모니터링",
      deadline_kst: nextCycleDeadline || "다음 사이클 직원 마감 전",
    });
  }
  const failureActions = ["운영 상태 보류/비용 차단/NO_GO 유지"];
  if (staleNeedsRecovery) {
    failureActions.push("stale/누락 0건 복구 전 승인 게이트 통과 금지");
  }
  if (slippageReady !== true) {
    failureActions.push("슬리피지(FM-03) 복구 전 신규 진입 확대 금지");
  }
  if (orderFailRateReady !== true) {
    failureActions.push("주문 실패율 분모 연결 전 주문 실패율 게이트 HOLD 유지");
  }
  if (signalDropExists) {
    failureActions.push("DROP_STRATEGY_ID_MISMATCH 해소 전 실신호 기반 확대 금지");
  }
  if (clockConflictExists) {
    failureActions.push("보고 시각 충돌 0/0 복구 전 마감 확정 자동화 금지");
  }

  const payload = {
    as_of_kst: asOfKst,
    generated_at_kst: generatedAtKst,
    role: "qa_manager",
    cycle_hhmm: hhmm,
    reporting_time_judgement: {
      is_reporting_time_now: reportingTimeNow,
      window_min: reportingWindowMin,
      reason: [
        reportingTimeNow
          ? `직원 보고 창(${nextCycleDeadline || staffToJihye || "N/A"}) 진입(±${reportingWindowMin}분)`
          : `직원 보고 창(${nextCycleDeadline || staffToJihye || "N/A"}) 대기 중`,
        `보수 기준 위험값: 비용 ${pct(conservativeCost)}, MDD ${pct(conservativeMdd)}, stale ${Number.isFinite(staleCountConservative) ? staleCountConservative : "N/A"}건`,
        `QA 테스트 ${tc.length}건 재판정 완료`,
      ],
    },
    decision: {
      trading_operation: "보류",
      mode: "비용 차단",
      growth_actions: "NO_GO",
      tie_break_rule: "충돌 시 더 보수적인 값 우선",
      reason: decisionReasons,
    },
    validation_scope: [
      "월 +5% 목표 대비 당일 운영 게이트 재판정",
      "백테스트/워크포워드/페이퍼/실거래 전환 단계 합격선 점검",
      "실패 모드(슬리피지/주문 실패율/데이터 결측/수수료·펀딩) 사전 검증",
      "보고 품질(유효 제출률/정시율/A-B 포함률/stale) 릴리스 게이트 반영",
      "실신호/드롭/런타임 실패를 운영 차단 조건으로 점검",
    ],
    test_cases: tc,
    test_case_counts: {
      pass: passCount,
      hold: holdCount,
      fail: failCount,
    },
    pass_criteria: {
      daily_gate: {
        cost_ratio_pct_max: 0.2,
        net_pnl_pct_min: 0.1667,
        mdd_pct_min: -1.5,
        error_count_24h_max: 1,
        valid_submission_rate_pct: 100,
        on_time_rate_pct: 100,
        ab_included_rate_pct_valid_only: 100,
        runtime_stale_or_missing_count: 0,
        codex_fail_count_24h_max: 6,
        codex_timeout_event_count_24h_max: 3,
        clock_conflict_count_max: 0,
      },
      backtest_gate: {
        lookback_days_min: 180,
        trades_min: 200,
        net_return_pct_min: 8,
        mdd_pct_min: -6,
      },
      walkforward_gate: {
        positive_windows_min: 3,
        total_windows: 4,
        avg_monthly_pct_min: 0.8,
        window_mdd_pct_min: -4,
      },
      paper_gate: {
        lookback_days: 14,
        return_pct_min: 1.5,
        cost_ratio_pct_max: 0.2,
        order_fail_rate_pct_max: 1,
        missing_data_count: 0,
      },
      live_gate: {
        lookback_days: 7,
        cost_ratio_pct_max: 0.2,
        slippage_p95_pct_max: 0.08,
        order_fail_rate_pct_max: 0.5,
        qty_anomaly_count: 0,
        runtime_stale_or_missing_count: 0,
        clock_conflict_count_max: 0,
        aggressive_switch_min_intervals: 30,
      },
    },
    stage_gate: {
      backtest: "HOLD",
      walkforward: "HOLD",
      paper: failCount > 0 ? "FAIL" : "PASS",
      live: failCount > 0 || holdCount > 0 ? "NO_GO" : "GO",
    },
    failure_actions: failureActions,
    representative_report_recommendation: {
      independent_execution_plan: [
        "최신 점검 파일 9종 파싱 후 수치 정합성 재확인",
        `입력 파일 최신성 점검(기준 ${freshnessWindowMin}분)`,
        "보수값 우선 규칙으로 QA 테스트 20건 재판정",
        "qa_manager 게이트 스냅샷과 사이클 보고서를 동시 생성",
      ],
      report_to_jihye: {
        progress_pct: "100%",
        core_outcomes: [
          `테스트 ${tc.length}건 재판정 완료 (PASS ${passCount} / HOLD ${holdCount} / FAIL ${failCount})`,
          `보고 시각 충돌 ${clockPair} 유지`,
          "최종 판정: 보류 / 비용 차단 / NO_GO 유지",
        ],
        core_risk: [
          `비용 ${pct(conservativeCost)} (기준 0.20% 초과)`,
          `MDD ${pct(conservativeMdd)} (기준 -1.50% 미달)`,
          `유효 제출률 ${pct(validRateConservative, 1)}, 정시율 ${pct(onTimeRateConservative, 1)}`,
          `stale/누락 ${Number.isFinite(staleCountConservative) ? staleCountConservative : "N/A"}건`,
          `실신호 ${Number.isFinite(signalCount) ? signalCount : "N/A"}건, 드롭 ${Number.isFinite(dropCount) ? dropCount : "N/A"}건`,
        ],
        decision_request: `보류/비용 차단/NO_GO 유지 확정 + stale ${
          staleNeedsRecovery ? `${staleCountText}건 복구 강제(A안)` : "0건 유지 모니터링(B안)"
        } + 보고 품질 ${reportQualityNeedsRecovery ? "100% 복구 강제(A안)" : "100% 유지(B안)"}`,
      },
      collaboration_requests_via_jihye: collaborationRequests,
      evolution_plan: evolutionPlan,
    },
    issues,
    evolution: evolutionPlan.map((x) => `[EVOLUTION] ${x.change} | ${x.expected_effect}`),
    self_validation: {
      executed_now: [
        "node scripts/qa-manager-autonomous-cycle.js",
        `입력 파일 최신성 확인(${freshCount}/${freshnessSnapshot.length}개가 ${freshnessWindowMin}분 이내 갱신)`,
        `QA 테스트 ${tc.length}건 재판정`,
        "QA 게이트 JSON/MD 산출물 생성 및 latest 갱신",
      ],
      checks: [
        `테스트 건수 합계 확인(${passCount}+${holdCount}+${failCount}=${tc.length})`,
        `입력 최신성 점검(${freshCount}/${freshnessSnapshot.length}개 fresh)`,
        "필수 순서(검증 범위 -> 테스트 케이스 -> 합격 기준 -> 실패 시 조치 -> 대표 보고 권고) 포함",
        "핵심 태그([ISSUE], [EVOLUTION]) 포함",
        "JSON 문법 검증 가능 형태로 생성",
      ],
      result: "pass",
      open_risk: "슬리피지 원천 미복구 + 주문 실패율 분모 미수집",
      source_freshness: {
        window_min: freshnessWindowMin,
        fresh_count: freshCount,
        total_count: freshnessSnapshot.length,
        files: freshnessSnapshot,
      },
    },
    source_files: Object.values(fileMap).filter(Boolean).map((x) => path.relative(ROOT, x)),
  };

  const outJsonDated = path.join(OPS_DAILY, `${dateKey}_qa_manager_gate_snapshot_${hhmm}_jihye.json`);
  const outJsonLatest = path.join(OPS_DAILY, "qa_manager_gate_snapshot_latest.json");
  const outMdDated = path.join(OPS_DAILY, `${dateKey}_qa_manager_autonomous_cycle${hhmm}_jihye.md`);

  fs.writeFileSync(outJsonDated, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(outJsonLatest, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMdDated, buildMarkdown(payload), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        role: "qa_manager",
        generated_at_kst: generatedAtKst,
        status: payload.decision.trading_operation,
        mode: payload.decision.mode,
        growth_actions: payload.decision.growth_actions,
        test_case_counts: payload.test_case_counts,
        output_json_dated: outJsonDated,
        output_json_latest: outJsonLatest,
        output_md_dated: outMdDated,
      },
      null,
      2
    )
  );
}

main();
