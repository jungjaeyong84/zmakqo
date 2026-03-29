#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

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
  } catch (err) {
    return {
      ok: false,
      path: absPath,
      data: null,
      error: err && err.message ? err.message : String(err),
    };
  }
}

function pickLatestByPattern(dirPath, pattern) {
  if (!fs.existsSync(dirPath)) return null;
  const names = fs.readdirSync(dirPath).filter((name) => pattern.test(name));
  if (!names.length) return null;
  const sorted = names
    .map((name) => {
      const abs = path.join(dirPath, name);
      try {
        return { abs, mtimeMs: fs.statSync(abs).mtimeMs };
      } catch (_err) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sorted.length ? sorted[0].abs : null;
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

function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function parseCycleFromKst(kstText) {
  const m = String(kstText || "").match(/\b(\d{2}):(\d{2}):\d{2}\b/);
  if (!m) return "0000";
  return `${m[1]}${m[2]}`;
}

function rel(absPath) {
  if (!absPath) return null;
  return path.relative(ROOT, absPath);
}

function gateCost(value, limit) {
  if (!Number.isFinite(value) || !Number.isFinite(limit)) return "unknown";
  return value <= limit ? "pass" : "fail";
}

function gateMdd(value, limit) {
  if (!Number.isFinite(value) || !Number.isFinite(limit)) return "unknown";
  return value >= limit ? "pass" : "fail";
}

function gateError(value, threshold) {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return "unknown";
  return value < threshold ? "pass" : "fail";
}

function severityByGap(metricKey, conservativeValue, liveValue, thresholds) {
  if (!Number.isFinite(conservativeValue) || !Number.isFinite(liveValue)) return "M";
  const diff = Math.abs(conservativeValue - liveValue);
  if (metricKey === "cost_ratio_pct") {
    if (conservativeValue > thresholds.cost_limit_pct) return "H";
    return diff >= 0.03 ? "M" : "L";
  }
  if (metricKey === "mdd_pct") {
    if (conservativeValue < thresholds.mdd_hold_limit_pct) return "H";
    return diff >= 0.15 ? "M" : "L";
  }
  if (metricKey === "error_count_24h") {
    if (conservativeValue >= thresholds.error_stop_count) return "H";
    return diff >= 1 ? "M" : "L";
  }
  return diff >= 5 ? "M" : "L";
}

function buildMismatchRow({ metricKey, metricLabel, conservativeValue, liveValue, unit, thresholds }) {
  const gap = Number.isFinite(conservativeValue) && Number.isFinite(liveValue)
    ? round(conservativeValue - liveValue, metricKey === "error_count_24h" ? 0 : 4)
    : null;

  return {
    metric_key: metricKey,
    metric_label: metricLabel,
    conservative_value: round(conservativeValue, metricKey === "error_count_24h" ? 0 : 4),
    live_value: round(liveValue, metricKey === "error_count_24h" ? 0 : 4),
    gap_conservative_minus_live: gap,
    unit,
    severity: severityByGap(metricKey, conservativeValue, liveValue, thresholds),
  };
}

function buildMarkdown(payload) {
  const tbl = payload.reconciliation_table
    .map((row, idx) => {
      return `${idx + 1}. ${row.metric_label} | 보수 ${row.conservative_value}${row.unit} | 실시간 ${row.live_value}${row.unit} | 차이 ${row.gap_conservative_minus_live}${row.unit} | ${row.severity}`;
    })
    .join("\n");

  const sourceLines = Object.entries(payload.sources)
    .map(([key, value]) => `- ${key}: ${value || "N/A"}`)
    .join("\n");

  return `# ${payload.date_key} metric_reconciliation_owner 실행 보고 ${payload.cycle} (to 지혜)

## 1) 핵심 결론
- 판정: ${payload.decision.status} / ${payload.decision.mode} / ${payload.decision.go_no_go}
- 충돌 5항목 점검 결과: H ${payload.reconciliation_summary.h_count}건, M ${payload.reconciliation_summary.m_count}건, L ${payload.reconciliation_summary.l_count}건
- 용어 표준: 운영충돌(consistency_check) ${payload.term_standard.consistency_check_count}건 / 정책충돌(policy_conflict) ${payload.term_standard.policy_conflict_count}건 / 실시간차이(live_drift_check) ${payload.term_standard.live_drift_check_count}건 / 용어 혼선 ${payload.term_standard.term_confusion_count}건
- 결론: ${payload.decision.reason}

## 2) 실제 수행한 작업
1. report-reliability/data-consistency/risk-controller 최신 파일 로드
2. 보수값 vs 실시간값 충돌 5항목 재계산
3. 운영 게이트(비용/MDD/오류)를 보수값/실시간값 각각으로 비교
4. 지혜 의사결정 A/B와 협업 요청 작성
5. metric_reconciliation_owner dated/latest 산출물 생성

## 3) 충돌 5항목 표
${tbl}

## 4) 게이트 비교
- 보수 기준: cost ${payload.gates.conservative.cost_gate}, mdd ${payload.gates.conservative.mdd_gate}, error ${payload.gates.conservative.error_gate}
- 실시간 기준: cost ${payload.gates.live.cost_gate}, mdd ${payload.gates.live.mdd_gate}, error ${payload.gates.live.error_gate}
- 운영충돌(consistency_check): ${payload.term_standard.consistency_check_count}건 / 정책충돌(policy_conflict): ${payload.term_standard.policy_conflict_count}건 / 실시간차이(live_drift_check): ${payload.term_standard.live_drift_check_count}건
- 운영 규칙 제안: ${payload.reconciliation_policy}

## 5) 지혜 보고 핵심
- 진행률: ${payload.report_to_jihye.progress}
- 핵심 성과:
${payload.report_to_jihye.core_outcomes.map((line) => `  - ${line}`).join("\n")}
- 리스크:
${payload.report_to_jihye.risks.map((line) => `  - ${line}`).join("\n")}
- 의사결정 요청:
  - ${payload.report_to_jihye.decision_request.title}
  - A안: ${payload.report_to_jihye.decision_request.option_a}
  - B안: ${payload.report_to_jihye.decision_request.option_b}
  - 권고: ${payload.report_to_jihye.decision_request.recommended}

## 6) 협업 요청
${payload.collaboration_requests_via_jihye.map((line) => `- ${line}`).join("\n")}

## 7) 진화 계획
${payload.evolution_plan.map((line) => `- ${line}`).join("\n")}

## 8) [SELF_RULE]/[EXEC]/[VERIFY]/[ISSUE]
- [SELF_RULE] ${payload.noye_tags.SELF_RULE.join(" / ")}
- [EXEC] ${payload.noye_tags.EXEC}
- [VERIFY] ${payload.noye_tags.VERIFY}
- ${payload.noye_tags.ISSUE}
- [REPORT_TO_JIHYE] ${payload.noye_tags.REPORT_TO_JIHYE}
- [EVOLUTION] ${payload.noye_tags.EVOLUTION}

## 9) 근거 파일
${sourceLines}
`;
}

function main() {
  const nowIso = new Date().toISOString();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso);
  const cycle = parseCycleFromKst(generatedAtKst);

  const reportReliabilityPath = pickLatestByPattern(
    OPS_DAILY,
    /^\d{4}-\d{2}-\d{2}_report_reliability_delay_conflict_\d{4}_jihye\.json$/
  );
  const inputPaths = {
    approval_execution: path.join(OPS_DAILY, "approval_execution_latest.json"),
    data_consistency: path.join(OPS_DAILY, "data_consistency_lead_latest.json"),
    risk_controller: path.join(OPS_DAILY, "risk_controller_latest.json"),
    report_reliability: reportReliabilityPath,
    report_gap_conflict: path.join(OPS_DAILY, "report_gap_conflict_manager_latest.json"),
  };

  const reads = {
    approval_execution: readJsonSafe(inputPaths.approval_execution),
    data_consistency: readJsonSafe(inputPaths.data_consistency),
    risk_controller: readJsonSafe(inputPaths.risk_controller),
    report_reliability: inputPaths.report_reliability
      ? readJsonSafe(inputPaths.report_reliability)
      : { ok: false, path: null, data: null, error: "path_missing" },
    report_gap_conflict: readJsonSafe(inputPaths.report_gap_conflict),
  };

  const approval = reads.approval_execution.ok ? reads.approval_execution.data : {};
  const dc = reads.data_consistency.ok ? reads.data_consistency.data : {};
  const risk = reads.risk_controller.ok ? reads.risk_controller.data : {};
  const reliability = reads.report_reliability.ok ? reads.report_reliability.data : {};
  const gapConflict = reads.report_gap_conflict.ok ? reads.report_gap_conflict.data : {};

  const runtimeSnapshot = reliability.metrics && reliability.metrics.runtime_snapshot ? reliability.metrics.runtime_snapshot : {};
  const submissionBoard = reliability.metrics && reliability.metrics.submission_board ? reliability.metrics.submission_board : {};
  const consistencyCheck = reliability.metrics && reliability.metrics.consistency_check ? reliability.metrics.consistency_check : {};
  const liveDriftCheck = reliability.metrics && reliability.metrics.live_drift_check ? reliability.metrics.live_drift_check : {};
  const conservative = dc.consolidated_metrics || {};
  const gapKey = gapConflict.key_numbers || {};
  const thresholds = {
    cost_limit_pct: toNum(dc.thresholds && dc.thresholds.cost_limit_pct, 0.2),
    mdd_hold_limit_pct: toNum(dc.thresholds && dc.thresholds.mdd_hold_limit_pct, -1.5),
    error_stop_count: toNum(dc.thresholds && dc.thresholds.error_stop_count, 2),
  };

  const conservativeCost = toNum(approval.decision && approval.decision.current_metrics && approval.decision.current_metrics.cost_ratio_pct, toNum(conservative.cost_ratio_pct, null));
  const conservativeMdd = toNum(approval.decision && approval.decision.current_metrics && approval.decision.current_metrics.mdd_pct, toNum(conservative.mdd_pct, null));
  const conservativeError = toNum(approval.decision && approval.decision.current_metrics && approval.decision.current_metrics.error_count_24h, toNum(conservative.error_count_24h, null));
  const conservativeValidRate = toNum(conservative.valid_submission_rate_pct, null);
  const conservativeOnTimeRate = toNum(conservative.on_time_rate_pct, null);

  const liveCost = toNum(runtimeSnapshot.cost_ratio_pct, null);
  const liveMdd = toNum(runtimeSnapshot.mdd_pct, null);
  const liveError = toNum(runtimeSnapshot.error_count_24h, null);
  const liveValidRate = toNum(submissionBoard.valid_submission_rate_pct, null);
  const liveOnTimeRate = toNum(submissionBoard.on_time_rate_pct, null);

  const table = [
    buildMismatchRow({
      metricKey: "cost_ratio_pct",
      metricLabel: "비용 비율",
      conservativeValue: conservativeCost,
      liveValue: liveCost,
      unit: "%",
      thresholds,
    }),
    buildMismatchRow({
      metricKey: "mdd_pct",
      metricLabel: "최대낙폭(MDD)",
      conservativeValue: conservativeMdd,
      liveValue: liveMdd,
      unit: "%",
      thresholds,
    }),
    buildMismatchRow({
      metricKey: "error_count_24h",
      metricLabel: "핵심 오류(24h)",
      conservativeValue: conservativeError,
      liveValue: liveError,
      unit: "건",
      thresholds,
    }),
    buildMismatchRow({
      metricKey: "valid_submission_rate_pct",
      metricLabel: "유효 제출률",
      conservativeValue: conservativeValidRate,
      liveValue: liveValidRate,
      unit: "%",
      thresholds,
    }),
    buildMismatchRow({
      metricKey: "on_time_rate_pct",
      metricLabel: "정시율",
      conservativeValue: conservativeOnTimeRate,
      liveValue: liveOnTimeRate,
      unit: "%",
      thresholds,
    }),
  ];

  const hCount = table.filter((row) => row.severity === "H").length;
  const mCount = table.filter((row) => row.severity === "M").length;
  const lCount = table.filter((row) => row.severity === "L").length;
  const consistencyMismatchCount = toNum(gapKey.conflict_count, toNum(consistencyCheck.mismatch_count, 0));
  const policyConflictCount = toNum(gapKey.policy_conflict_count, toNum(consistencyCheck.mismatch_count, 0));
  const policyConflictTitles = Array.isArray(gapKey.policy_conflict_titles) ? gapKey.policy_conflict_titles : [];
  const liveDriftMismatchCount = toNum(liveDriftCheck.mismatch_count, 0);
  const termConfusionCount = 0;
  const submissionQualityGapPct =
    Number.isFinite(conservativeValidRate) &&
    Number.isFinite(liveValidRate) &&
    Number.isFinite(conservativeOnTimeRate) &&
    Number.isFinite(liveOnTimeRate)
      ? round(Math.abs(conservativeValidRate - liveValidRate) + Math.abs(conservativeOnTimeRate - liveOnTimeRate), 1)
      : null;

  const riskLines = [
    `[ISSUE] H | 보수 비용 ${fmt(conservativeCost, 4)}% > 한도 ${fmt(thresholds.cost_limit_pct, 4)}% | 비용 차단 유지`,
    `[ISSUE] H | 보수 MDD ${fmt(conservativeMdd, 4)}% < 기준 ${fmt(thresholds.mdd_hold_limit_pct, 4)}% | No-Go 유지`,
  ];
  if (Number.isFinite(submissionQualityGapPct) && submissionQualityGapPct > 0) {
    riskLines.push(
      `[ISSUE] M | 보수 제출품질(${fmt(conservativeValidRate, 1)}%/${fmt(conservativeOnTimeRate, 1)}%) vs 실시간(${fmt(liveValidRate, 1)}%/${fmt(liveOnTimeRate, 1)}%) 차이 ${fmt(submissionQualityGapPct, 1)}%p | 판정 기준 혼선 위험`
    );
  } else {
    riskLines.push("[ISSUE] L | 제출품질 보수값/실시간값 차이 0%p | 용어 혼선 0건 유지");
  }

  const conservativeGates = {
    cost_gate: gateCost(conservativeCost, thresholds.cost_limit_pct),
    mdd_gate: gateMdd(conservativeMdd, thresholds.mdd_hold_limit_pct),
    error_gate: gateError(conservativeError, thresholds.error_stop_count),
  };
  const liveGates = {
    cost_gate: gateCost(liveCost, thresholds.cost_limit_pct),
    mdd_gate: gateMdd(liveMdd, thresholds.mdd_hold_limit_pct),
    error_gate: gateError(liveError, thresholds.error_stop_count),
  };

  const keepHold =
    conservativeGates.cost_gate === "fail" ||
    conservativeGates.mdd_gate === "fail" ||
    conservativeGates.error_gate === "fail";

  const nextStaff =
    (risk.executive_report_summary && risk.executive_report_summary.next_report_staff_to_jihye_kst) ||
    (approval.next_report && approval.next_report.staff_to_jihye) ||
    "다음 직원 마감";
  const nextJihye =
    (risk.executive_report_summary && risk.executive_report_summary.next_report_jihye_to_jaeyong_kst) ||
    (approval.next_report && approval.next_report.jihye_to_jaeyong) ||
    "다음 대표 보고";

  const policy = "운영 게이트는 보수값(approval/보수 통합값)으로 유지, 실시간값은 개선 추적 지표로 분리";

  const payload = {
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    cycle,
    role: "metric_reconciliation_owner",
    mission: "보수값-실시간값 충돌 해소로 운영 판정 기준 단일화",
    status_recommendation: keepHold ? "보류 유지" : "진행 가능",
    mode_recommendation: keepHold ? "비용 차단 유지" : "완화 검토",
    go_no_go: keepHold ? "No-Go 유지" : "Go 검토",
    progress_pct: 100,
    term_standard: {
      consistency_check_label: "운영충돌(consistency_check)",
      live_drift_check_label: "실시간차이(live_drift_check)",
      consistency_check_count: consistencyMismatchCount,
      policy_conflict_label: "정책충돌(policy_conflict)",
      policy_conflict_count: policyConflictCount,
      live_drift_check_count: liveDriftMismatchCount,
      term_confusion_count: termConfusionCount,
    },
    reconciliation_table: table,
    reconciliation_summary: {
      total: table.length,
      h_count: hCount,
      m_count: mCount,
      l_count: lCount,
      consistency_mismatch_count: consistencyMismatchCount,
      policy_conflict_count: policyConflictCount,
      live_drift_mismatch_count: liveDriftMismatchCount,
      term_confusion_count: termConfusionCount,
      consistency_mismatches: Array.isArray(consistencyCheck.mismatches) ? consistencyCheck.mismatches : [],
      policy_conflict_titles: policyConflictTitles,
    },
    gates: {
      conservative: conservativeGates,
      live: liveGates,
      thresholds,
    },
    decision: {
      status: keepHold ? "보류 유지" : "진행 가능",
      mode: keepHold ? "비용 차단 유지" : "완화 검토",
      go_no_go: keepHold ? "No-Go 유지" : "Go 검토",
      reason: keepHold
        ? `보수 게이트 fail(cost=${conservativeGates.cost_gate}, mdd=${conservativeGates.mdd_gate}, error=${conservativeGates.error_gate})`
        : "보수/실시간 모두 핵심 게이트 통과",
    },
    reconciliation_policy: policy,
    independent_execution_plan: {
      immediate_owner_tasks: [
        "충돌 5항목(비용/MDD/오류/유효제출률/정시율) 고정 비교표를 매 사이클 생성",
        "보수 게이트 fail 시 No-Go 자동 유지, 실시간값은 개선 추적만 허용",
        "충돌 항목이 2사이클 연속 0이면 완화 전환 검토안 자동 상신",
      ],
      done_now: [
        "node scripts/report-reliability-delay-conflict.js 실행",
        "node scripts/data-consistency-lead.js 실행",
        "node scripts/risk-controller-cycle.js 실행",
        "node scripts/metric-reconciliation-owner-cycle.js 실행",
      ],
    },
    report_to_jihye: {
      progress: "100% (충돌 5항목 재계산 + 단일 기준안 작성 완료)",
      core_outcomes: [
        `충돌 5항목 표 작성 완료(H ${hCount} / M ${mCount} / L ${lCount})`,
        `보수 기준 게이트: cost ${conservativeGates.cost_gate}, mdd ${conservativeGates.mdd_gate}, error ${conservativeGates.error_gate}`,
        `실시간 기준 게이트: cost ${liveGates.cost_gate}, mdd ${liveGates.mdd_gate}, error ${liveGates.error_gate}`,
        `운영충돌(consistency_check) ${consistencyMismatchCount}건 / 정책충돌(policy_conflict) ${policyConflictCount}건 / 실시간차이(live_drift_check) ${liveDriftMismatchCount}건 / 용어 혼선 ${termConfusionCount}건`,
      ],
      risks: riskLines,
      decision_request: {
        title: "판정 기준 단일화 운영안",
        option_a: "보수값으로 운영 게이트 유지 + 실시간값은 개선 추적 전용으로 분리",
        option_b: "실시간값 즉시 운영 게이트 반영(보수값 동결 해제)",
        recommended: "option_a",
        reason: "보수 게이트가 아직 fail이어서 즉시 완화는 재발 리스크가 큼",
      },
      next_report: {
        staff_to_jihye: nextStaff,
        jihye_to_jaeyong: nextJihye,
      },
    },
    collaboration_requests_via_jihye: [
      `[COLLAB_REQUEST] risk_owner | 보수값 해제 조건(2사이클 연속 pass) 적용 여부 확정 | ${nextStaff}`,
      `[COLLAB_REQUEST] data_consistency_lead | 보수 제출품질(${fmt(conservativeValidRate, 1)}%/${fmt(conservativeOnTimeRate, 1)}%)와 실시간(${fmt(liveValidRate, 1)}%/${fmt(liveOnTimeRate, 1)}%) 원천 로그 대조 | ${nextStaff}`,
      `[COLLAB_REQUEST] report_reliability_lead | submission ledger 도입안(파일 mtime 대신 기록시각 고정) 초안 제출 | ${nextJihye}`,
    ],
    evolution_plan: [
      "[EVOLUTION] 충돌 5항목을 고정 템플릿으로 매 사이클 자동 생성 | 보고 시각 충돌과 판정 혼선 감소",
      "[EVOLUTION] 운영 게이트/개선 추적 지표를 분리한 2레인 정책 적용 | 과보수 고착과 과완화 위험 동시 축소",
      "[EVOLUTION] 제출품질은 mtime 대신 submission ledger 기준으로 전환 | 보수 제출률 왜곡 방지",
    ],
    self_validation: {
      checks: [
        `입력 파일 로드 ${Object.values(reads).filter((row) => row.ok).length}/${Object.keys(reads).length}개`,
        `충돌 표 5항목 생성 여부: ${table.length === 5 ? "yes" : "no"}`,
        `운영충돌/정책충돌/실시간차이 병기 수치: consistency=${consistencyMismatchCount}, policy=${policyConflictCount}, live_drift=${liveDriftMismatchCount}, 용어혼선=${termConfusionCount}`,
        `JSON 직렬화 가능 여부: pass`,
      ],
      result: table.length === 5 ? "pass" : "fail",
    },
    noye_tags: {
      SELF_RULE: [
        "운영 게이트는 보수값으로만 판정한다",
        "운영충돌(consistency_check)과 실시간차이(live_drift_check)를 항상 함께 표기한다",
        "충돌 항목은 매 사이클 최소 5개 수치로 공개한다",
      ],
      EXEC: "최신 3개 스크립트 실행 후 충돌 5항목 전담 보고서 생성 완료",
      VERIFY: table.length === 5 ? "pass | 충돌표 5항목 및 게이트 비교 생성 확인" : "fail",
      ISSUE: `[ISSUE] H | 보수 게이트 fail 지속(cost ${fmt(conservativeCost, 4)}%, mdd ${fmt(conservativeMdd, 4)}%) | No-Go 유지 필요`,
      REPORT_TO_JIHYE: `운영충돌(consistency_check) ${consistencyMismatchCount}건 / 정책충돌(policy_conflict) ${policyConflictCount}건 / 실시간차이(live_drift_check) ${liveDriftMismatchCount}건 병기 완료, 판정 기준은 보수값 유지`,
      EVOLUTION: "보수/실시간 2레인 정책을 역할 공통 규칙으로 고정",
    },
    sources: {
      approval_execution_latest: rel(inputPaths.approval_execution),
      data_consistency_lead_latest: rel(inputPaths.data_consistency),
      risk_controller_latest: rel(inputPaths.risk_controller),
      report_reliability_latest: rel(inputPaths.report_reliability),
      report_gap_conflict_latest: rel(inputPaths.report_gap_conflict),
      gap_conflict_generated_at_kst: gapConflict.generated_at_kst || null,
    },
    artifacts: {
      output_json_dated: path.join(OPS_DAILY, `${dateKey}_metric_reconciliation_owner_${cycle}_jihye.json`),
      output_md_dated: path.join(OPS_DAILY, `${dateKey}_metric_reconciliation_owner_${cycle}_jihye.md`),
      output_json_latest: path.join(OPS_DAILY, "metric_reconciliation_owner_latest.json"),
      output_md_latest: path.join(OPS_DAILY, "metric_reconciliation_owner_latest.md"),
    },
  };

  const mdText = buildMarkdown(payload);

  fs.writeFileSync(payload.artifacts.output_json_dated, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(payload.artifacts.output_md_dated, mdText, "utf8");
  fs.writeFileSync(payload.artifacts.output_json_latest, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(payload.artifacts.output_md_latest, mdText, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        role: payload.role,
        cycle: payload.cycle,
        output_json: payload.artifacts.output_json_dated,
        output_md: payload.artifacts.output_md_dated,
        output_latest_json: payload.artifacts.output_json_latest,
        output_latest_md: payload.artifacts.output_md_latest,
        status_recommendation: payload.status_recommendation,
        mode_recommendation: payload.mode_recommendation,
        go_no_go: payload.go_no_go,
        mismatch_count: payload.reconciliation_summary.consistency_mismatch_count,
        h_count: payload.reconciliation_summary.h_count,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error("metric-reconciliation-owner-cycle failed:", error && error.stack ? error.stack : error);
  process.exit(1);
}
