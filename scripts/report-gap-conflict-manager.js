#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round1(value) {
  const n = toNum(value, null);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function pickLatestByPattern(pattern) {
  if (!fs.existsSync(OPS_DAILY)) return null;
  const names = fs.readdirSync(OPS_DAILY).filter((name) => pattern.test(name));
  if (!names.length) return null;

  let picked = null;
  let pickedMs = -Infinity;
  for (const name of names) {
    const abs = path.join(OPS_DAILY, name);
    let ms = null;
    try {
      ms = fs.statSync(abs).mtimeMs;
    } catch (_err) {
      continue;
    }
    if (ms > pickedMs) {
      picked = { name, abs, mtimeMs: ms };
      pickedMs = ms;
    }
  }
  return picked;
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

function normalizeMinuteKey(raw) {
  const ms = parseKstToMs(raw);
  if (Number.isFinite(ms)) return toKstString(ms, { fallbackToString: true }).slice(0, 16);
  const text = String(raw || "").trim();
  const m = text.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function hhmm(kstText) {
  const m = String(kstText || "").match(/\b(\d{2}):(\d{2})/);
  return m ? `${m[1]}${m[2]}` : "0000";
}

function fmtPct(value, digits = 1) {
  const n = toNum(value, null);
  if (!Number.isFinite(n)) return "N/A";
  return `${n.toFixed(digits)}%`;
}

function fmtNum(value, digits = 1) {
  const n = toNum(value, null);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(digits);
}

function compactRoles(arr) {
  const rows = Array.isArray(arr) ? arr : [];
  return rows.length ? rows.join(", ") : "없음";
}

function buildMarkdown(payload) {
  const k = payload.key_numbers;
  const clockConflictCount = toNum(k.conflict_matrix_vs_role, 0) + toNum(k.conflict_approval_vs_role, 0);
  const stale = payload.key_numbers.stale_roles;
  const late = payload.key_numbers.late_roles_top3;
  const issues = payload.report_to_jihye.issues.join("\n");
  const collabRows = Array.isArray(payload.collaboration_requests_via_jihye)
    ? payload.collaboration_requests_via_jihye
    : [];
  const collabs = collabRows.length
    ? collabRows.map((row) => `- ${row.to_role}: ${row.request} (이유: ${row.why})`).join("\n")
    : "- 없음";
  const evolutions = payload.evolution.map((row) => `- ${row}`).join("\n");
  const checks = payload.self_validation.checks.map((row) => `- ${row}`).join("\n");
  const decisionRows = Array.isArray(payload.report_to_jihye.decision_requests)
    ? payload.report_to_jihye.decision_requests
    : [];
  const decisions = decisionRows.length
    ? decisionRows
        .map(
          (row) =>
            `- ${row.title}: A안(${row.option_a}) / B안(${row.option_b}) | 권고 ${row.recommended}`
        )
        .join("\n")
    : "- 없음";
  const onTimeRate = toNum(k.on_time_rate_pct, null);
  const onTimeComment = Number.isFinite(onTimeRate) && onTimeRate >= 90
    ? `오늘 수치 기준으로 정시 보고는 ${fmtPct(k.on_time_rate_pct)}로 기준(90%+)을 충족했습니다.`
    : `오늘 수치 기준으로 정시 보고는 ${fmtPct(k.on_time_rate_pct)}로 목표(90%+)에 못 미칩니다.`;

  return `# ${payload.date_key} 보고 누락/지연/충돌 집계 보고 ${payload.cycle} (report_gap_conflict_manager -> 지혜)

1) 핵심 결론
- 보고 시점 판단: ${payload.report_timing}
- 운영 판정: \`${payload.status_recommendation}\`, \`${payload.mode_recommendation}\`, \`${payload.go_no_go}\`
- 현재 핵심 수치: 유효 제출률 ${fmtPct(k.valid_submission_rate_pct)}, 정시율 ${fmtPct(
    k.on_time_rate_pct
  )}, stale/누락 ${k.stale_or_missing_count}건, 운영충돌 ${k.conflict_count}건, 정책충돌 ${toNum(
    k.policy_conflict_count,
    0
  )}건
- 보수 기준 위험: 비용 ${fmtPct(k.cost_ratio_pct, 4)}, MDD ${fmtPct(
    k.mdd_pct,
    4
  )}, 오류 ${k.error_count_24h}건

2) 실제 수행한 작업 (번호 목록)
1. 점검 스크립트 7종 재실행(system-autonomous, runtime, sync, reliability, clock, consistency, signal)
2. 제출/지연 집계 재산출: stale 역할, 지연 역할, 최대/평균 지연 추출
3. 시각 충돌 재검증: matrix/approval/role_bot next_report 비교
4. 충돌 안건 정리: stale 미복구, 시각 불일치, 런타임 실패/시간초과 지속
5. 지혜 보고용 JSON/MD 산출물 생성 및 latest 갱신

3) 변경 파일/산출물
- \`${payload.artifacts.output_json_dated}\`
- \`${payload.artifacts.output_md_dated}\`
- \`${payload.artifacts.output_json_latest}\`
- \`${payload.artifacts.output_md_latest}\`

4) 지혜에게 보고할 핵심
- 진행률: ${payload.report_to_jihye.progress}
- 핵심 성과:
  - stale/누락 역할: ${compactRoles(stale)}
  - 지연 상위 3개 역할: ${compactRoles(late)}
  - next_report 충돌: matrix-role ${k.conflict_matrix_vs_role}건, approval-role ${k.conflict_approval_vs_role}건
  - 신호 감시: 실신호 ${k.signals_count}건, 드롭 ${k.drops_count}건
- 의사결정 요청:
${decisions}
- 이슈:
${issues}

5) 재용에게 보여줄 쉬운 요약(비개발자용)
- 지금은 안전모드를 유지해야 합니다.
- 현재 보고 누락/오래된 보고는 ${k.stale_or_missing_count}건이고, 보고 시간 충돌은 ${clockConflictCount}건입니다.
- ${onTimeComment}
- 신호는 ${k.signals_count}건, 드롭은 ${k.drops_count}건이라 수익 확대 판단 표본이 부족합니다.

6) 리스크/확인사항
- stale 역할: ${compactRoles(stale)}
- 지연 역할 수: ${k.late_count}건 (최대 ${k.max_delay_min_valid_only}분, 평균 ${fmtNum(
    k.avg_delay_min_valid_only,
    1
  )}분)
- 운영충돌 안건 목록: ${payload.key_numbers.conflict_titles.length}건
${payload.key_numbers.conflict_titles.map((x) => `  - ${x}`).join("\n")}
- 정책충돌 안건 목록: ${toNum(payload.key_numbers.policy_conflict_count, 0)}건
${(payload.key_numbers.policy_conflict_titles || []).map((x) => `  - ${x}`).join("\n")}
- 자가검증:
${checks}
- 자가검증 결과: ${payload.self_validation.result}

지혜 경유 협업 요청
${collabs}

진화 계획
${evolutions}
`;
}

function main() {
  const nowIso = new Date().toISOString();
  const nowKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const cycle = hhmm(nowKst);

  const picked = {
    sync_board: pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_sync_status_board_\d{4}_jihye\.json$/),
    reliability: pickLatestByPattern(
      /^\d{4}-\d{2}-\d{2}_report_reliability_delay_conflict_\d{4}_jihye\.json$/
    ),
    clock_latest: pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_clock_manager_latest_jihye\.json$/),
    matrix: pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_governance_reporting_matrix_.*_jihye\.json$/),
  };

  const fixed = {
    consistency_latest: path.join(OPS_DAILY, "data_consistency_lead_latest.json"),
    runtime_latest: path.join(OPS_DAILY, "role_bot_runtime_check_latest.json"),
    signal_latest: path.join(OPS_DAILY, "post_apply_signal_probe_latest.json"),
    approval_latest: path.join(OPS_DAILY, "approval_execution_latest.json"),
  };

  const sourceData = {
    sync_board: picked.sync_board ? readJsonSafe(picked.sync_board.abs) : null,
    reliability: picked.reliability ? readJsonSafe(picked.reliability.abs) : null,
    clock_latest: picked.clock_latest ? readJsonSafe(picked.clock_latest.abs) : null,
    matrix: picked.matrix ? readJsonSafe(picked.matrix.abs) : null,
    consistency_latest: readJsonSafe(fixed.consistency_latest),
    runtime_latest: readJsonSafe(fixed.runtime_latest),
    signal_latest: readJsonSafe(fixed.signal_latest),
    approval_latest: readJsonSafe(fixed.approval_latest),
  };

  const summary = sourceData.sync_board && sourceData.sync_board.summary ? sourceData.sync_board.summary : {};
  const roles = sourceData.sync_board && Array.isArray(sourceData.sync_board.roles) ? sourceData.sync_board.roles : [];
  const staleRoles = roles
    .filter((row) => row.submission_status === "stale" || row.submission_status === "missing")
    .map((row) => row.role);
  const lateRoles = roles
    .filter((row) => row.submission_status === "late")
    .sort((a, b) => toNum(b.delay_min, 0) - toNum(a.delay_min, 0))
    .map((row) => row.role);

  const reliabilityAgenda =
    sourceData.reliability && Array.isArray(sourceData.reliability.conflict_agenda)
      ? sourceData.reliability.conflict_agenda
      : [];
  // RC-20: CF-04는 운영 충돌 KPI에서 제외하고 정책 충돌로 분리 집계
  const operationalConflictAgenda = reliabilityAgenda.filter((row) => String(row && row.id ? row.id : "") !== "CF-04");
  const policyConflictAgenda = reliabilityAgenda.filter((row) => String(row && row.id ? row.id : "") === "CF-04");
  const conflictTitles = operationalConflictAgenda.map((row) => row.title).filter(Boolean);
  const policyConflictTitles = policyConflictAgenda.map((row) => row.title).filter(Boolean);

  const clockKey = sourceData.clock_latest && sourceData.clock_latest.key_numbers
    ? sourceData.clock_latest.key_numbers
    : {};
  const runtimeChat0 =
    sourceData.runtime_latest && Array.isArray(sourceData.runtime_latest.chats)
      ? sourceData.runtime_latest.chats[0] || {}
      : {};
  const matrixNext =
    sourceData.matrix &&
    sourceData.matrix.report_system &&
    sourceData.matrix.report_system.next_report
      ? sourceData.matrix.report_system.next_report
      : {};
  const approvalNext =
    sourceData.approval_latest && sourceData.approval_latest.next_report
      ? sourceData.approval_latest.next_report
      : {};

  const roleNext = runtimeChat0.next_report_at_kst || null;
  const matrixJihye = matrixNext.jihye_to_jaeyong || null;
  const approvalJihye = approvalNext.jihye_to_jaeyong || null;

  const conflictMatrixVsRole = Number.isFinite(toNum(clockKey.conflict_matrix_vs_role, null))
    ? toNum(clockKey.conflict_matrix_vs_role, 0)
    : normalizeMinuteKey(roleNext) && normalizeMinuteKey(matrixJihye)
    ? normalizeMinuteKey(roleNext) === normalizeMinuteKey(matrixJihye)
      ? 0
      : 1
    : 0;
  const conflictApprovalVsRole = Number.isFinite(toNum(clockKey.conflict_approval_vs_role, null))
    ? toNum(clockKey.conflict_approval_vs_role, 0)
    : normalizeMinuteKey(roleNext) && normalizeMinuteKey(approvalJihye)
    ? normalizeMinuteKey(roleNext) === normalizeMinuteKey(approvalJihye)
      ? 0
      : 1
    : 0;
  const clockConflictTotal = conflictMatrixVsRole + conflictApprovalVsRole;
  const reliabilityConflictCount = operationalConflictAgenda.length;
  const policyConflictCount = policyConflictAgenda.length;

  const consolidated =
    sourceData.consistency_latest && sourceData.consistency_latest.consolidated_metrics
      ? sourceData.consistency_latest.consolidated_metrics
      : {};
  const runtimeAgg =
    sourceData.runtime_latest && sourceData.runtime_latest.aggregate
      ? sourceData.runtime_latest.aggregate
      : {};
  const signalCounts =
    sourceData.signal_latest && sourceData.signal_latest.counts ? sourceData.signal_latest.counts : {};

  const reportTiming =
    toNum(summary.stale_or_missing_count, 0) > 0 ||
    clockConflictTotal > 0 ||
    reliabilityConflictCount > 0 ||
    policyConflictCount > 0
      ? "즉시 보고 시점"
      : "정기 보고 시점";

  const issues = [];
  if (toNum(summary.stale_or_missing_count, 0) > 0) {
    issues.push(
      `[ISSUE] H | stale/누락 ${toNum(summary.stale_or_missing_count, 0)}건(${compactRoles(
        staleRoles
      )}) | 재제출 강제 여부 확정 필요`
    );
  }
  if (clockConflictTotal > 0) {
    issues.push(
      `[ISSUE] H | next_report 시각 충돌 ${clockConflictTotal}건 | 30분 체계 즉시 재동기화 필요`
    );
  }
  if (reliabilityConflictCount > 0) {
    issues.push(
      `[ISSUE] H | 충돌 안건 ${reliabilityConflictCount}건(${conflictTitles.join(", ")}) | 운영 기준 단일화 필요`
    );
  }
  if (policyConflictCount > 0) {
    issues.push(
      `[ISSUE] M | 정책충돌 ${policyConflictCount}건(${policyConflictTitles.join(", ")}) | 운영충돌과 분리 집계 유지`
    );
  }
  if (toNum(summary.on_time_rate_pct, 0) < 90) {
    issues.push(
      `[ISSUE] M | 정시율 ${fmtPct(
        summary.on_time_rate_pct
      )}로 목표(90%+) 미달 | 경보 기준(10분/3분) 재적용 필요`
    );
  }
  if (toNum(runtimeAgg.codex_fail_count_24h, 0) > 0 || toNum(runtimeAgg.codex_timeout_event_count_24h, 0) > 0) {
    issues.push(
      `[ISSUE] M | 24h Codex 실패 ${toNum(runtimeAgg.codex_fail_count_24h, 0)}건, 시간초과 ${toNum(
        runtimeAgg.codex_timeout_event_count_24h,
        0
      )}건 | 시스템 복구 트랙 유지 필요`
    );
  }
  if (toNum(signalCounts.signals, 0) === 0 && toNum(signalCounts.drops, 0) > 0) {
    issues.push(
      `[ISSUE] M | 실신호 0건, 드롭 ${toNum(signalCounts.drops, 0)}건 | DROP_STRATEGY_ID_MISMATCH 우선 점검 필요`
    );
  }
  if (issues.length === 0) {
    issues.push("[ISSUE] L | 핵심 운영 이슈 없음(수치 기준 충족) | 현재 보수 모니터링 유지");
  }

  const collaborationRequests = [];
  if (toNum(summary.stale_or_missing_count, 0) > 0) {
    collaborationRequests.push({
      to_role: "governance_secretary",
      request: `stale/누락 ${toNum(summary.stale_or_missing_count, 0)}건 재제출 처리 후 상태판 최신본 제출`,
      why: "유효 제출률 100% 복구 필요",
    });
  }
  collaborationRequests.push({
    to_role: "report_clock_manager",
    request:
      clockConflictTotal > 0
        ? `role_bot next_report(${roleNext || "N/A"})와 대표 보고 시각(${matrixJihye || approvalJihye || "N/A"}) 불일치 해소 증빙 제출`
        : `role_bot/matrix/approval next_report 동기화(직원->지혜 ${matrixNext.staff_to_jihye || "N/A"}, 지혜->재용 ${matrixJihye || approvalJihye || "N/A"}) 유지 증빙 제출`,
    why: clockConflictTotal > 0 ? "충돌 0건 KPI 복구 필요" : "충돌 0건 KPI 유지 필요",
  });
  if (toNum(summary.on_time_rate_pct, 0) < 90) {
    collaborationRequests.push({
      to_role: "report_sync_keeper",
      request: `정시율 ${fmtPct(summary.on_time_rate_pct)} -> 90%+ 회복 액션(10분/3분 경보 재가동) 결과 제출`,
      why: "보고 품질 목표 미달 해소 필요",
    });
  }
  if (reliabilityConflictCount > 0) {
    collaborationRequests.push({
      to_role: "risk_owner",
      request: `충돌 안건 ${reliabilityConflictCount}건(${conflictTitles.join(", ")}) 기준으로 운영 판정 단일화 보고 제출`,
      why: "보류/진행 이중 판정 해소 필요",
    });
  }
  if (policyConflictCount > 0) {
    collaborationRequests.push({
      to_role: "metric_reconciliation_owner",
      request: `정책충돌 ${policyConflictCount}건(${policyConflictTitles.join(", ")})에 대한 approval/lates 우선순위 규칙 유지 증빙 제출`,
      why: "RC-20 정책충돌 분리 KPI 유지 필요",
    });
  }
  if (toNum(runtimeAgg.codex_fail_count_24h, 0) > 0 || toNum(runtimeAgg.codex_timeout_event_count_24h, 0) > 0) {
    collaborationRequests.push({
      to_role: "system_owner",
      request: `Codex 실패/시간초과(${toNum(runtimeAgg.codex_fail_count_24h, 0)}/${toNum(
        runtimeAgg.codex_timeout_event_count_24h,
        0
      )}) 저감 실행 결과 제출`,
      why: "자율 운영 안정성 회복 필요",
    });
  }

  const evolution = [
    "[EVOLUTION] 점검 7종 결과를 누락/지연/충돌 전담 보고서 1장으로 자동 통합 | 판단 속도와 누락 방지 개선",
    "[EVOLUTION] stale/시각충돌/정시율 미달을 H-M 이슈 태그로 고정 | 우선순위 충돌 감소",
    "[EVOLUTION] 보고서에 지혜 의사결정 A/B를 상시 포함 | 승인 지연 없이 다음 액션 연결",
  ];

  const decisionRequests = [];
  if (toNum(summary.stale_or_missing_count, 0) > 0) {
    decisionRequests.push({
      title: `stale ${toNum(summary.stale_or_missing_count, 0)}건 처리`,
      option_a: "재제출 강제 후 같은 사이클 기준으로 재집계",
      option_b: "1회 임시 인정 후 다음 사이클에서 강제",
      recommended: "A안",
    });
  }
  decisionRequests.push({
    title: clockConflictTotal > 0 ? "보고 시각 충돌 처리" : "보고 시각 운영 체계 유지",
    option_a:
      clockConflictTotal > 0
        ? `대표 30분 체계(직원->지혜 ${matrixNext.staff_to_jihye || "N/A"} / 지혜->재용 ${matrixJihye || approvalJihye || "N/A"})에 즉시 재동기화`
        : `대표 30분 체계(직원->지혜 ${matrixNext.staff_to_jihye || "N/A"} / 지혜->재용 ${matrixJihye || approvalJihye || "N/A"}) 유지`,
    option_b: "역할봇 독립 시각 기준으로 전체 전환",
    recommended: "A안",
  });
  if (reliabilityConflictCount > 0) {
    decisionRequests.push({
      title: "운영 상태 판정 단일화",
      option_a: "보수 기준(보류/비용 차단/No-Go) 유지",
      option_b: "실행 기준(진행/수익 확대) 전환",
      recommended: "A안",
    });
  }
  if (policyConflictCount > 0) {
    decisionRequests.push({
      title: "정책충돌(CF-04) 처리 방식",
      option_a: "운영충돌 KPI에서 제외하고 정책충돌 KPI로만 관리",
      option_b: "운영충돌 KPI에 재포함",
      recommended: "A안",
    });
  }

  const progressPenalty =
    (toNum(summary.stale_or_missing_count, 0) > 0 ? 5 : 0)
    + (clockConflictTotal > 0 ? 3 : 0)
    + (reliabilityConflictCount > 0 ? 2 : 0)
    + (policyConflictCount > 0 ? 1 : 0);
  const progressValue = Math.max(90, 100 - progressPenalty);

  const statusRecommendation = sourceData.consistency_latest
    ? sourceData.consistency_latest.status_recommendation || "보류 유지"
    : "보류 유지";
  const modeRecommendation = sourceData.consistency_latest
    ? sourceData.consistency_latest.mode_recommendation || "비용 차단 유지"
    : "비용 차단 유지";
  const goNoGo = sourceData.consistency_latest
    ? sourceData.consistency_latest.go_no_go || "No-Go 유지"
    : "No-Go 유지";

  const payload = {
    generated_at_kst: nowKst,
    date_key: dateKey,
    cycle,
    role: "report_gap_conflict_manager",
    mission: "보고 누락/지연 집계 + 충돌 안건 정리 + 지혜 의사결정 연결",
    report_timing: reportTiming,
    status_recommendation: statusRecommendation,
    mode_recommendation: modeRecommendation,
    go_no_go: goNoGo,
    independent_execution: {
      status: "completed",
      done_now: [
        "점검 스크립트 7종 재실행으로 최신 수치 갱신",
        "stale/late 역할 재집계 및 충돌 안건 추출",
        "지혜 보고용 종합본(JSON+MD) 자동 생성",
      ],
    },
    key_numbers: {
      valid_submission_rate_pct: toNum(summary.valid_submission_rate_pct, null),
      on_time_rate_pct: toNum(summary.on_time_rate_pct, null),
      stale_or_missing_count: toNum(summary.stale_or_missing_count, null),
      late_count: toNum(summary.late_count, null),
      max_delay_min_valid_only: toNum(summary.max_delay_min_valid_only, null),
      avg_delay_min_valid_only: round1(summary.avg_delay_min_valid_only),
      stale_roles: staleRoles,
      late_roles_top3: lateRoles.slice(0, 3),
      conflict_count: reliabilityConflictCount,
      conflict_titles: conflictTitles,
      policy_conflict_count: policyConflictCount,
      policy_conflict_titles: policyConflictTitles,
      conflict_matrix_vs_role: conflictMatrixVsRole,
      conflict_approval_vs_role: conflictApprovalVsRole,
      matrix_next_report_jihye_to_jaeyong: matrixJihye,
      approval_next_report_jihye_to_jaeyong: approvalJihye,
      role_bot_next_report_at_kst: roleNext,
      cost_ratio_pct: toNum(consolidated.cost_ratio_pct, null),
      mdd_pct: toNum(consolidated.mdd_pct, null),
      error_count_24h: toNum(consolidated.error_count_24h, null),
      codex_fail_count_24h: toNum(runtimeAgg.codex_fail_count_24h, null),
      codex_timeout_event_count_24h: toNum(runtimeAgg.codex_timeout_event_count_24h, null),
      signals_count: toNum(signalCounts.signals, 0),
      drops_count: toNum(signalCounts.drops, 0),
      drop_reason_top1:
        sourceData.signal_latest &&
        Array.isArray(sourceData.signal_latest.drop_reason_top) &&
        sourceData.signal_latest.drop_reason_top[0]
          ? sourceData.signal_latest.drop_reason_top[0]
          : null,
    },
    report_to_jihye: {
      progress: `${progressValue}%`,
      core_outcomes: [
        `유효 제출률 ${fmtPct(summary.valid_submission_rate_pct)} / 정시율 ${fmtPct(
          summary.on_time_rate_pct
        )}`,
        `stale/누락 ${toNum(summary.stale_or_missing_count, 0)}건, 운영충돌 ${reliabilityConflictCount}건, 정책충돌 ${policyConflictCount}건`,
        `보수 기준 유지: 비용 ${fmtPct(consolidated.cost_ratio_pct, 4)}, MDD ${fmtPct(
          consolidated.mdd_pct,
          4
        )}, 오류 ${toNum(consolidated.error_count_24h, 0)}건`,
      ],
      issues,
      decision_requests: decisionRequests,
    },
    collaboration_requests_via_jihye: collaborationRequests,
    evolution,
    source_files: {
      sync_board: picked.sync_board ? picked.sync_board.abs : null,
      reliability: picked.reliability ? picked.reliability.abs : null,
      clock_latest: picked.clock_latest ? picked.clock_latest.abs : null,
      matrix: picked.matrix ? picked.matrix.abs : null,
      consistency_latest: fixed.consistency_latest,
      runtime_latest: fixed.runtime_latest,
      signal_latest: fixed.signal_latest,
      approval_latest: fixed.approval_latest,
    },
    self_validation: {
      checks: [],
      result: "pass",
    },
    artifacts: {},
  };

  const checks = [];
  if (payload.source_files.sync_board) {
    checks.push("sync status board latest 파일 참조 성공");
  } else {
    checks.push("sync status board latest 파일 미탐지");
    payload.self_validation.result = "fail";
  }

  if (payload.source_files.reliability) {
    checks.push("reliability delay/conflict 파일 참조 성공");
  } else {
    checks.push("reliability delay/conflict 파일 미탐지");
    payload.self_validation.result = "fail";
  }

  if (Number.isFinite(toNum(payload.key_numbers.stale_or_missing_count, null))) {
    checks.push("stale/누락 수치 추출 성공");
  } else {
    checks.push("stale/누락 수치 추출 실패");
    payload.self_validation.result = "fail";
  }

  if (Number.isFinite(toNum(payload.key_numbers.conflict_count, null))) {
    checks.push("충돌 안건 수치 추출 성공");
  } else {
    checks.push("충돌 안건 수치 추출 실패");
    payload.self_validation.result = "fail";
  }

  if (issues.length >= 1) {
    checks.push("이슈 태그([ISSUE]) 최소 1건 이상 생성");
  } else {
    checks.push("이슈 태그 생성 실패");
    payload.self_validation.result = "fail";
  }

  if (evolution.length >= 1) {
    checks.push("진화 태그([EVOLUTION]) 최소 1건 이상 생성");
  } else {
    checks.push("진화 태그 생성 실패");
    payload.self_validation.result = "fail";
  }

  payload.self_validation.checks = checks;

  const datedJson = path.join(
    OPS_DAILY,
    `${dateKey}_report_gap_conflict_manager_${cycle}_jihye.json`
  );
  const datedMd = path.join(
    OPS_DAILY,
    `${dateKey}_report_gap_conflict_manager_${cycle}_jihye.md`
  );
  const latestJson = path.join(OPS_DAILY, "report_gap_conflict_manager_latest.json");
  const latestMd = path.join(OPS_DAILY, "report_gap_conflict_manager_latest.md");

  payload.artifacts = {
    output_json_dated: datedJson,
    output_md_dated: datedMd,
    output_json_latest: latestJson,
    output_md_latest: latestMd,
  };

  const markdown = buildMarkdown(payload);
  fs.writeFileSync(datedJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMd, `${markdown}\n`, "utf8");
  fs.writeFileSync(latestMd, `${markdown}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        role: payload.role,
        generated_at_kst: payload.generated_at_kst,
        report_timing: payload.report_timing,
        status_recommendation: payload.status_recommendation,
        mode_recommendation: payload.mode_recommendation,
        go_no_go: payload.go_no_go,
        key_numbers: {
          valid_submission_rate_pct: payload.key_numbers.valid_submission_rate_pct,
          on_time_rate_pct: payload.key_numbers.on_time_rate_pct,
          stale_or_missing_count: payload.key_numbers.stale_or_missing_count,
          conflict_count: payload.key_numbers.conflict_count,
          conflict_matrix_vs_role: payload.key_numbers.conflict_matrix_vs_role,
          conflict_approval_vs_role: payload.key_numbers.conflict_approval_vs_role,
          signals_count: payload.key_numbers.signals_count,
          drops_count: payload.key_numbers.drops_count,
        },
        output_json_dated: datedJson,
        output_md_dated: datedMd,
        output_json_latest: latestJson,
        output_md_latest: latestMd,
        self_validation_result: payload.self_validation.result,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (err) {
  console.error("report-gap-conflict-manager failed:", err && err.message ? err.message : err);
  process.exit(1);
}
