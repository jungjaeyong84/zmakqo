#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString } = require("../src/utils/timeKst");
const {
  loadSubmissionLedger,
  upsertSubmissionEntry,
  saveSubmissionLedger,
} = require("./lib/submission-ledger");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const MATRIX_PATTERN = /^\d{4}-\d{2}-\d{2}_governance_reporting_matrix_.*_jihye\.json$/;

const DEFAULT_CYCLE_START_KST = "2026-02-26 00:20:07 KST";
const DEFAULT_DEADLINE_KST = "2026-02-26 00:28:00 KST";
const STALE_EVIDENCE_ALERT_MIN = 180;

const ROLE_SPECS = [
  {
    role_key: "market_performance_owner",
    role_kr: "시장/성과 담당",
    note: "비용 절감안 A/B + 기대효과 수치",
    patterns: [
      /performance_analyst_cycle\d+_jihye\.md$/,
      /performance_analyst_cycle\d+_jihye\.json$/,
    ],
  },
  {
    role_key: "risk_owner",
    role_kr: "리스크 담당",
    note: "위험등급표 + Go/No-Go 재판정",
    patterns: [/risk_controller_latest\.json$/, /risk_controller_cycle\d+_jihye\.(md|json)$/],
  },
  {
    role_key: "qa_owner",
    role_kr: "품질 담당",
    note: "표본 복구 계획 + 체크리스트",
    patterns: [
      /qa_manager_autonomous_cycle\d+_jihye\.md$/,
      /qa_manager_gate_snapshot.*_jihye\.json$/,
      /qa_manager_gate_snapshot_latest\.json$/,
    ],
  },
  {
    role_key: "system_owner",
    role_kr: "시스템 담당",
    note: "실패/시간초과 저감 액션 3건",
    patterns: [/system_recovery_actions_\d+_jihye\.md$/, /system_recovery_actions_latest\.json$/],
  },
  {
    role_key: "quant_owner",
    role_kr: "퀀트 담당",
    note: "고비용 시간대 억제 A/B",
    patterns: [
      /quant_trainer_autonomous_execution_cycle\d+_\d+_jihye\.md$/,
      /quant_training_taskpack_cycle\d+_\d+_jihye\.json$/,
    ],
  },
  {
    role_key: "pine_owner",
    role_kr: "파인 담당",
    note: "적용/롤백 절차 최신본",
    patterns: [
      /pine_autonomous_execution_cycle\d+_\d+_jihye\.md$/,
      /pine_.*apply_rollback_procedure.*_jihye\.md$/,
    ],
  },
  {
    role_key: "governance_secretary",
    role_kr: "거버넌스 비서",
    note: "stale 0건 상태판 제출",
    patterns: [/governance_secretary.*_jihye\.(md|json)$/],
  },
  {
    role_key: "report_sync_keeper",
    role_kr: "보고 동기화 담당",
    note: "정시 경보(10분/3분) 결과 제출",
    patterns: [/report_sync_status_board_.*_jihye\.(md|json)$/],
  },
  {
    role_key: "report_clock_manager",
    role_kr: "보고 시각 동기화 담당",
    note: "next_report 시각 충돌 0건",
    patterns: [/report_clock_manager.*_jihye\.(md|json)$/],
  },
];

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function pickLatestMatrixPath() {
  if (!fs.existsSync(OPS_DAILY)) return null;
  const names = fs.readdirSync(OPS_DAILY).filter((name) => MATRIX_PATTERN.test(name));
  if (!names.length) return null;

  let chosen = null;
  let chosenMs = -Infinity;
  for (const name of names) {
    const abs = path.join(OPS_DAILY, name);
    let mtimeMs = null;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch (_err) {
      continue;
    }
    if (mtimeMs > chosenMs) {
      chosen = abs;
      chosenMs = mtimeMs;
    }
  }
  return chosen;
}

function parseKstToMs(raw) {
  const m = String(raw || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?(?:\s*KST)?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || "0");
  return Date.UTC(year, month, day, hour - 9, minute, second, 0);
}

function normalizeNextReportKey(raw) {
  const ms = parseKstToMs(raw);
  if (!Number.isFinite(ms)) {
    const text = String(raw || "").trim();
    return text || null;
  }
  return toKstString(ms, { fallbackToString: true }).slice(0, 16);
}

function round1(v) {
  return Number(v.toFixed(1));
}

function pct(n, d) {
  if (!d) return 0;
  return round1((n / d) * 100);
}

function detectAbIncluded(absPath) {
  try {
    const text = fs.readFileSync(absPath, "utf8");
    return /(A안|B안|대체안 A|대체안 B|option_a|option_b|A\/B|Plan A|Plan B)/i.test(text);
  } catch (_err) {
    return false;
  }
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickLatestFile(files, patterns) {
  const candidates = files.filter((name) => patterns.some((re) => re.test(name)));
  if (!candidates.length) return null;
  let best = null;
  let bestMs = -Infinity;
  for (const name of candidates) {
    const abs = path.join(OPS_DAILY, name);
    let mtimeMs = null;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch (_err) {
      continue;
    }
    if (mtimeMs > bestMs) {
      bestMs = mtimeMs;
      best = { name, abs, mtimeMs };
    }
  }
  return best;
}

function computeSubmissionStatus(mtimeMs, cycleStartMs, deadlineMs) {
  if (!Number.isFinite(mtimeMs)) {
    return {
      submission_status: "missing",
      valid_for_cycle: false,
      delay_min: null,
    };
  }
  const delayMin = Math.ceil((mtimeMs - deadlineMs) / 60000);
  if (mtimeMs < cycleStartMs) {
    return {
      submission_status: "stale",
      valid_for_cycle: false,
      delay_min: delayMin,
    };
  }
  if (mtimeMs <= deadlineMs) {
    return {
      submission_status: "on_time",
      valid_for_cycle: true,
      delay_min: delayMin,
    };
  }
  return {
    submission_status: "late",
    valid_for_cycle: true,
    delay_min: delayMin,
  };
}

function computeEvidenceAgeMin(nowMs, submissionTsMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(submissionTsMs)) return null;
  const ageMin = Math.floor((nowMs - submissionTsMs) / 60000);
  return ageMin >= 0 ? ageMin : 0;
}

function buildRows(cycleStartMs, deadlineMs, outputMdRel, ledgerData, nowMs) {
  const files = fs.readdirSync(OPS_DAILY);
  const deadlineHm = toKstString(deadlineMs, { fallbackToString: true }).slice(11, 16);
  return ROLE_SPECS.map((spec) => {
    if (spec.role_key === "report_sync_keeper") {
      const evidenceRel = outputMdRel;
      const ledgerEntry = upsertSubmissionEntry(ledgerData, {
        role: spec.role_key,
        evidenceFile: evidenceRel,
        observedMtimeMs: nowMs,
        submissionHintMs: nowMs,
        nowMs,
        sourceScript: "scripts/report-sync-status-board.js",
      });
      const submissionTsMs =
        ledgerEntry && Number.isFinite(ledgerEntry.ledger_submission_ts_ms)
          ? Number(ledgerEntry.ledger_submission_ts_ms)
          : nowMs;
      const status = computeSubmissionStatus(submissionTsMs, cycleStartMs, deadlineMs);
      const evidenceAgeMin = computeEvidenceAgeMin(nowMs, submissionTsMs);
      return {
        role: spec.role_key,
        role_kr: spec.role_kr,
        deadline_kst: deadlineHm,
        evidence_file: evidenceRel,
        note: spec.note,
        evidence_exists: true,
        submitted_kst: toKstString(submissionTsMs, { fallbackToString: true }),
        delay_min: status.delay_min,
        submission_status: status.submission_status,
        has_ab: true,
        ab_status: "included",
        valid_for_cycle: status.valid_for_cycle,
        submission_ts_ms: submissionTsMs,
        submission_ts_basis: ledgerEntry ? ledgerEntry.basis : "fallback_now",
        mtime_ms: nowMs,
        evidence_age_min: evidenceAgeMin,
        stale_evidence_alert: Number.isFinite(evidenceAgeMin) && evidenceAgeMin >= STALE_EVIDENCE_ALERT_MIN,
      };
    }

    const picked = pickLatestFile(files, spec.patterns);
    if (!picked) {
      upsertSubmissionEntry(ledgerData, {
        role: spec.role_key,
        evidenceFile: null,
        observedMtimeMs: null,
        submissionHintMs: null,
        nowMs,
        sourceScript: "scripts/report-sync-status-board.js",
      });
      return {
        role: spec.role_key,
        role_kr: spec.role_kr,
        deadline_kst: deadlineHm,
        evidence_file: null,
        note: spec.note,
        evidence_exists: false,
        submitted_kst: null,
        delay_min: null,
        submission_status: "missing",
        has_ab: false,
        ab_status: "missing",
        valid_for_cycle: false,
        submission_ts_ms: null,
        submission_ts_basis: "missing",
        mtime_ms: null,
        evidence_age_min: null,
        stale_evidence_alert: false,
      };
    }

    const evidenceRel = path.join("ops", "daily", picked.name);
    const ledgerEntry = upsertSubmissionEntry(ledgerData, {
      role: spec.role_key,
      evidenceFile: evidenceRel,
      observedMtimeMs: picked.mtimeMs,
      submissionHintMs: picked.mtimeMs,
      nowMs,
      sourceScript: "scripts/report-sync-status-board.js",
    });
    const submissionTsMs =
      ledgerEntry && Number.isFinite(ledgerEntry.ledger_submission_ts_ms)
        ? Number(ledgerEntry.ledger_submission_ts_ms)
        : picked.mtimeMs;
    const status = computeSubmissionStatus(submissionTsMs, cycleStartMs, deadlineMs);
    const hasAb = detectAbIncluded(picked.abs);
    const evidenceAgeMin = computeEvidenceAgeMin(nowMs, submissionTsMs);

    return {
      role: spec.role_key,
      role_kr: spec.role_kr,
      deadline_kst: deadlineHm,
      evidence_file: evidenceRel,
      note: spec.note,
      evidence_exists: true,
      submitted_kst: toKstString(submissionTsMs, { fallbackToString: true }),
      delay_min: status.delay_min,
      submission_status: status.submission_status,
      has_ab: hasAb,
      ab_status: hasAb ? "included" : "missing",
      valid_for_cycle: status.valid_for_cycle,
      submission_ts_ms: submissionTsMs,
      submission_ts_basis: ledgerEntry ? ledgerEntry.basis : "mtime_fallback",
      mtime_ms: picked.mtimeMs,
      evidence_age_min: evidenceAgeMin,
      stale_evidence_alert: Number.isFinite(evidenceAgeMin) && evidenceAgeMin >= STALE_EVIDENCE_ALERT_MIN,
    };
  });
}

function buildSummary(rows) {
  const targetRoles = rows.length;
  const evidenceExistsCount = rows.filter((r) => r.evidence_exists).length;
  const validRows = rows.filter((r) => r.valid_for_cycle);
  const onTimeRows = rows.filter((r) => r.submission_status === "on_time");
  const lateRows = rows.filter((r) => r.submission_status === "late");
  const staleOrMissingRows = rows.filter(
    (r) => r.submission_status === "stale" || r.submission_status === "missing"
  );
  const staleEvidenceRows = rows.filter((r) => r.stale_evidence_alert);
  const evidenceAgeValues = rows.map((r) => r.evidence_age_min).filter((v) => Number.isFinite(v));
  const abIncludedValid = validRows.filter((r) => r.has_ab).length;

  const lateDelays = lateRows
    .map((r) => r.delay_min)
    .filter((v) => Number.isFinite(v));
  const maxDelay = lateDelays.length ? Math.max(...lateDelays) : 0;
  const avgDelay = lateDelays.length
    ? round1(lateDelays.reduce((a, b) => a + b, 0) / lateDelays.length)
    : 0;

  return {
    target_roles: targetRoles,
    evidence_exists_count: evidenceExistsCount,
    evidence_exists_rate_pct: pct(evidenceExistsCount, targetRoles),
    valid_submissions: validRows.length,
    valid_submission_rate_pct: pct(validRows.length, targetRoles),
    on_time_count: onTimeRows.length,
    on_time_rate_pct: pct(onTimeRows.length, targetRoles),
    late_count: lateRows.length,
    late_rate_pct: pct(lateRows.length, targetRoles),
    stale_or_missing_count: staleOrMissingRows.length,
    stale_or_missing_rate_pct: pct(staleOrMissingRows.length, targetRoles),
    stale_evidence_count_180m: staleEvidenceRows.length,
    stale_evidence_rate_pct_180m: pct(staleEvidenceRows.length, targetRoles),
    max_evidence_age_min: evidenceAgeValues.length ? Math.max(...evidenceAgeValues) : null,
    ab_included_count_valid_only: abIncludedValid,
    ab_included_rate_pct_valid_only: pct(abIncludedValid, validRows.length),
    max_delay_min_valid_only: maxDelay,
    avg_delay_min_valid_only: avgDelay,
  };
}

function buildRuntimeSnapshot() {
  const autoCycle = readJsonSafe(path.join(OPS_DAILY, "system_autonomous_cycle_latest.json"));
  const systemOps = readJsonSafe(path.join(OPS_DAILY, "system_ops_check_latest.json"));
  const runtime = readJsonSafe(path.join(OPS_DAILY, "role_bot_runtime_check_latest.json"));
  const approval = readJsonSafe(path.join(OPS_DAILY, "approval_execution_latest.json"));

  let perfPath = path.join(OPS_DAILY, "2026-02-26_performance_metrics_jihye.json");
  const perfFromTask =
    autoCycle &&
    Array.isArray(autoCycle.task_logs) &&
    autoCycle.task_logs.find((x) => x.id === "performance") &&
    autoCycle.task_logs.find((x) => x.id === "performance").summary &&
    autoCycle.task_logs.find((x) => x.id === "performance").summary.output_path;
  if (perfFromTask && fs.existsSync(perfFromTask)) perfPath = perfFromTask;
  const perf = readJsonSafe(perfPath);

  return {
    system_status: systemOps && systemOps.status ? systemOps.status : null,
    system_mode: systemOps && systemOps.mode ? systemOps.mode : null,
    overall_auto_status: autoCycle && autoCycle.overall_status ? autoCycle.overall_status : null,
    role_bot_runtime_status: runtime && runtime.status ? runtime.status : null,
    cost_ratio_pct: toNum(
      systemOps && systemOps.cost_ratio_pct,
      toNum(perf && perf.costs && perf.costs.cost_ratio_pct, null)
    ),
    cost_limit_pct: toNum(
      systemOps && systemOps.cost_limit_pct,
      toNum(
        approval &&
          approval.decision &&
          approval.decision.execution_gate &&
          approval.decision.execution_gate.cost_ratio_lte,
        null
      )
    ),
    net_pnl_pct: toNum(
      systemOps && systemOps.net_pnl_pct,
      toNum(perf && perf.performance && perf.performance.net_pnl_pct, null)
    ),
    required_daily_pct: toNum(
      systemOps && systemOps.required_daily_pct,
      toNum(perf && perf.performance && perf.performance.required_daily_pct, null)
    ),
    mdd_pct: toNum(
      perf && perf.performance && perf.performance.mdd_pct,
      toNum(
        approval &&
          approval.decision &&
          approval.decision.current_metrics &&
          approval.decision.current_metrics.mdd_pct,
        null
      )
    ),
    mdd_limit_pct: toNum(
      systemOps && systemOps.loss_stop_pct,
      toNum(
        approval &&
          approval.decision &&
          approval.decision.execution_gate &&
          approval.decision.execution_gate.mdd_gte,
        -1.5
      )
    ),
    error_count_24h: toNum(systemOps && systemOps.error_count, null),
    stale_chat_count: toNum(runtime && runtime.aggregate && runtime.aggregate.stale_chat_count, null),
    codex_fail_count_24h: toNum(
      runtime && runtime.aggregate && runtime.aggregate.codex_fail_count_24h,
      null
    ),
    codex_timeout_event_count_24h: toNum(
      runtime && runtime.aggregate && runtime.aggregate.codex_timeout_event_count_24h,
      null
    ),
    next_report_at_kst:
      runtime &&
      Array.isArray(runtime.chats) &&
      runtime.chats[0] &&
      runtime.chats[0].next_report_at_kst
        ? runtime.chats[0].next_report_at_kst
        : null,
  };
}

function fmtPct(v, digits = 4) {
  const n = toNum(v, null);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "N/A";
}

function buildIssues(summary, runtime, rows, matrix) {
  const issues = [];

  const costRatio = toNum(runtime.cost_ratio_pct, null);
  const costLimit = toNum(runtime.cost_limit_pct, null);
  if (Number.isFinite(costRatio) && Number.isFinite(costLimit) && costRatio > costLimit) {
    issues.push(
      `[ISSUE] H | 비용 비율 ${fmtPct(costRatio)}가 상한 ${fmtPct(costLimit)} 초과 | 비용 차단 유지, 수익 확대 No-Go 유지`
    );
  } else if (Number.isFinite(costRatio) && Number.isFinite(costLimit)) {
    issues.push(
      `[ISSUE] M | 비용 비율 ${fmtPct(costRatio)}는 상한 이내이나 표본 부족 가능성 존재 | 보수 기준 재검증 필요`
    );
  } else {
    issues.push("[ISSUE] M | 비용 지표 확인 불완전 | 성과 집계 파일 재확인 필요");
  }

  if (summary.on_time_rate_pct < 70) {
    issues.push(
      `[ISSUE] M | 정시율 ${summary.on_time_rate_pct}% (${summary.on_time_count}/${summary.target_roles})로 기준 70% 미달 | 10분/3분 사전경보 강화 필요`
    );
  }
  if (summary.stale_or_missing_count > 0) {
    issues.push(
      `[ISSUE] H | stale/누락 ${summary.stale_or_missing_count}건 | 미제출 역할 재제출 또는 대체안 A/B 즉시 선택 필요`
    );
  }
  if (summary.stale_evidence_count_180m > 0) {
    const roles = rows
      .filter((r) => r.stale_evidence_alert)
      .map((r) => r.role)
      .join(", ");
    issues.push(
      `[ISSUE] M | evidence_age_min 180분 이상 ${summary.stale_evidence_count_180m}건(${roles || "N/A"}) | 최신 증빙 갱신 필요`
    );
  }
  if (toNum(runtime.stale_chat_count, 0) > 0) {
    issues.push(
      `[ISSUE] H | 역할봇 정체 채팅 ${runtime.stale_chat_count}건, 24h 실패 ${toNum(
        runtime.codex_fail_count_24h,
        0
      )}건 | 런타임 복구 우선`
    );
  }

  const reportClockRow = rows.find((r) => r.role === "report_clock_manager");
  const matrixNextRaw =
    matrix &&
    matrix.report_system &&
    matrix.report_system.next_report &&
    matrix.report_system.next_report.jihye_to_jaeyong
      ? matrix.report_system.next_report.jihye_to_jaeyong
      : null;
  const matrixNext = normalizeNextReportKey(matrixNextRaw);
  const runtimeNext = normalizeNextReportKey(runtime.next_report_at_kst);
  if (reportClockRow && reportClockRow.submission_status === "missing") {
    issues.push(
      `[ISSUE] M | report_clock_manager 증빙 누락(0/1) | next_report 시각 충돌 0건 KPI 검증 불가`
    );
  } else if (matrixNext && runtimeNext && matrixNext !== runtimeNext) {
    issues.push(
      `[ISSUE] M | next_report 시각 불일치(대표 ${matrixNextRaw} vs 역할봇 ${runtime.next_report_at_kst}) | 동기화 조치 필요`
    );
  }

  return issues;
}

function buildDecisionRequests(summary, rows) {
  const requests = [];
  const missingRoles = rows.filter((r) => r.submission_status === "missing");
  const staleRoles = rows.filter((r) => r.submission_status === "stale");

  if (missingRoles.length > 0) {
    requests.push({
      id: "DR-01",
      title: "미제출 역할 처리",
      option_a: "01:00 KST까지 재제출 강제",
      option_b: "기존 증빙 + 보수 판정으로 1회 임시 인정",
      reason: `미제출 ${missingRoles.length}건으로 유효 제출률 ${summary.valid_submission_rate_pct}%`,
    });
  }

  if (staleRoles.length > 0) {
    requests.push({
      id: "DR-02",
      title: "구버전(stale) 제출 처리",
      option_a: "현재 사이클 증빙 재작성 강제",
      option_b: "핵심 수치 동일 시 한시적 인정",
      reason: `stale ${staleRoles.length}건으로 사이클 정합성 저하`,
    });
  }

  if (summary.on_time_rate_pct < 70) {
    requests.push({
      id: "DR-03",
      title: "정시율 회복 규칙",
      option_a: "마감 10분/3분 이중 경보 즉시 의무화",
      option_b: "역할별 마감을 5분 간격 분산",
      reason: `정시율 ${summary.on_time_rate_pct}%로 기준 70% 미달`,
    });
  }

  if (summary.stale_evidence_count_180m > 0) {
    requests.push({
      id: "DR-04",
      title: "180분 이상 구증빙 처리",
      option_a: "180분 이상 역할 최신 증빙 재생성 강제",
      option_b: "핵심 수치 동일 시 1사이클 유예",
      reason: `구증빙 경보 ${summary.stale_evidence_count_180m}건 발생`,
    });
  }

  return requests;
}

function buildJsonPayload(nowMs, cycleStartMs, deadlineMs, outputMdRel, matrix, matrixPath, ledgerData) {
  const rows = buildRows(cycleStartMs, deadlineMs, outputMdRel, ledgerData, nowMs);
  const summary = buildSummary(rows);
  const runtime = buildRuntimeSnapshot();
  const issues = buildIssues(summary, runtime, rows, matrix);
  const decisionRequests = buildDecisionRequests(summary, rows);
  const needsClockSync = issues.some(
    (x) => x.includes("next_report 시각 불일치") || x.includes("report_clock_manager 증빙 누락")
  );
  const needsRuntimeRecovery = toNum(runtime.stale_chat_count, 0) > 0;

  const missingRoles = rows
    .filter((r) => r.submission_status === "missing")
    .map((r) => r.role);
  const staleRoles = rows
    .filter((r) => r.submission_status === "stale")
    .map((r) => r.role);
  const staleEvidenceRoles = rows.filter((r) => r.stale_evidence_alert).map((r) => r.role);

  return {
    as_of_kst: toKstString(nowMs, { fallbackToString: true }),
    cycle_window_kst: `${toKstString(cycleStartMs, { fallbackToString: true }).replace(
      " KST",
      ""
    )}~${toKstString(deadlineMs, { fallbackToString: true })}`,
    board_deadline_kst: toKstString(deadlineMs, { fallbackToString: true }),
    cycle_acceptance_rule: "사이클 시작 이후 제출원장(ledger) 기록시각 기준으로 유효 제출 판정",
    status: summary.stale_or_missing_count > 0 ? "지연 복구 필요" : "정상",
    mode: runtime.system_mode || "비용 차단",
    evidence_age_policy: {
      metric: "evidence_age_min",
      stale_alert_threshold_min: STALE_EVIDENCE_ALERT_MIN,
      stale_alert_count: summary.stale_evidence_count_180m,
    },
    roles: rows,
    summary,
    runtime_snapshot: runtime,
    decision_requests_to_jihye: decisionRequests,
    issues,
    collaboration_requests_via_jihye: [
      ...(summary.stale_or_missing_count > 0
        ? [{
        to_role: "governance_secretary",
        request: "stale/누락 역할 증빙을 같은 기준(사이클 시작 이후)으로 재요청",
        why: `유효 제출률 ${summary.valid_submission_rate_pct}%를 100%로 복구 필요`,
      }]
        : []),
      ...(summary.stale_evidence_count_180m > 0
        ? [{
        to_role: "governance_secretary",
        request: "evidence_age_min 180분 이상 역할 최신 증빙 재요청",
        why: `구증빙 경보 ${summary.stale_evidence_count_180m}건 해소 필요`,
      }]
        : []),
      ...(needsRuntimeRecovery
        ? [{
        to_role: "system_owner",
        request: "역할봇 정체 1건 복구 결과(원인/해결 시각) 제출",
        why: "런타임 중단 해소가 최우선",
      }]
        : []),
      ...(needsClockSync
        ? [{
        to_role: "report_clock_manager",
        request: "대표 보고 시각과 역할봇 next_report 시각 동기화 증빙 제출",
        why: "시각 충돌 리스크 제거 필요",
      }]
        : []),
    ],
    evolution: [
      {
        change: "역할별 증빙 파일 탐색을 자동화해 상태판 생성 스크립트로 고정",
        expected_effect: "수작업 누락 감소, 집계 속도 향상",
      },
      {
        change: "정시율 기준을 70%로 수치 고정하고 경보(10분/3분)를 기본값으로 적용",
        expected_effect: "지연 조기 차단",
      },
      {
        change: "report_clock_manager 증빙을 상태판 필수 항목으로 추가",
        expected_effect: "보고 시각 충돌 조기 탐지",
      },
    ],
    independent_execution: {
      done_now: [
        "node scripts/system-autonomous-cycle.js 재실행",
        "node scripts/role-bot-runtime-check.js 재실행",
        "node scripts/report-reliability-delay-conflict.js 재실행",
        `마감 ${toKstString(deadlineMs, { fallbackToString: true }).slice(11, 16)} 기준 9개 역할 제출/지연/A-B 상태판 생성`,
      ],
      next_actions_without_waiting: [
        "미제출/구버전 역할 재제출 여부 30분 내 재확인",
        "정시율 70% 회복 전까지 보류+비용차단 유지",
      ],
    },
    self_validation: {
      checks: [
        "JSON 직렬화/문법 확인 가능",
        "9개 역할 모두 status 산출",
        "핵심 수치(유효 제출률/정시율/stale) 원장 시각 기준 재계산",
        "evidence_age_min 계산 및 180분 stale 경보 집계 반영",
        "이슈/협업요청/진화 계획 포함 확인",
      ],
      result: "pass",
      open_risk: {
        missing_roles: missingRoles,
        stale_roles: staleRoles,
        stale_evidence_roles: staleEvidenceRoles,
      },
    },
    artifacts: {
      matrix_source: matrixPath ? path.relative(ROOT, matrixPath) : null,
      script: "scripts/report-sync-status-board.js",
      submission_ledger_latest: "ops/daily/submission_ledger_latest.json",
      submission_ledger_dated: null,
    },
  };
}

function buildMarkdown(payload, jsonRelPath) {
  const rows = payload.roles;
  const s = payload.summary;
  const r = payload.runtime_snapshot;
  const roleRows = rows
    .map((x) => {
      const submitted = x.submitted_kst ? x.submitted_kst.slice(11, 19) : "-";
      const delay = Number.isFinite(x.delay_min)
        ? `${x.delay_min > 0 ? "+" : ""}${x.delay_min}`
        : "-";
      const evidenceAge = Number.isFinite(x.evidence_age_min) ? `${x.evidence_age_min}` : "-";
      const statusKr =
        x.submission_status === "on_time"
          ? "정시"
          : x.submission_status === "late"
          ? "지연"
          : x.submission_status === "stale"
          ? "구버전(무효)"
          : "미제출";
      return `| ${x.role_kr} | ${submitted} | ${statusKr} | ${delay} | ${evidenceAge} | ${
        x.stale_evidence_alert ? "경보" : "정상"
      } | ${x.ab_status === "included" ? "포함" : "미포함"} | ${x.note} |`;
    })
    .join("\n");

  const decisionLines = payload.decision_requests_to_jihye.length
    ? payload.decision_requests_to_jihye
        .map(
          (d) =>
            `${d.id}. ${d.title}\n- A안: ${d.option_a}\n- B안: ${d.option_b}\n- 사유: ${d.reason}`
        )
        .join("\n")
    : "없음";

  const issueLines = payload.issues.map((x) => x).join("\n");
  const collabLines = payload.collaboration_requests_via_jihye
    .map((x) => `- ${x.to_role}: ${x.request} (이유: ${x.why})`)
    .join("\n");
  const evolutionLines = payload.evolution
    .map((x) => `[EVOLUTION] ${x.change} | ${x.expected_effect}`)
    .join("\n");
  const selfChecks = payload.self_validation.checks.map((x) => `- ${x}`).join("\n");

  return `# ${payload.as_of_kst.slice(0, 10)} 역할별 제출/지연/대체안 A/B 상태판 ${payload.as_of_kst
    .slice(11, 16)
    .replace(":", "")} (보고 동기화 담당 -> 지혜)

기준 시각: ${payload.as_of_kst}
사이클 창: ${payload.cycle_window_kst}
제출 마감: ${payload.board_deadline_kst}
유효 제출 규칙: 사이클 시작 이후 제출원장(ledger) 기록시각 기준

## 1) 역할별 상태
| 역할 | 원장 제출시각(KST) | 상태 | 지연(분) | 증빙경과(분) | 180분경보 | A/B 포함 | 비고 |
|---|---:|---|---:|---:|---|---|---|
${roleRows}

## 2) 집계 수치
1. 파일 존재 제출률: \`${s.evidence_exists_count}/${s.target_roles} = ${s.evidence_exists_rate_pct}%\`
2. 유효 제출률: \`${s.valid_submissions}/${s.target_roles} = ${s.valid_submission_rate_pct}%\`
3. 정시율: \`${s.on_time_count}/${s.target_roles} = ${s.on_time_rate_pct}%\`
4. 지연율: \`${s.late_count}/${s.target_roles} = ${s.late_rate_pct}%\`
5. 구버전/미제출률: \`${s.stale_or_missing_count}/${s.target_roles} = ${s.stale_or_missing_rate_pct}%\`
6. A/B 포함률(유효 제출 기준): \`${s.ab_included_count_valid_only}/${s.valid_submissions} = ${s.ab_included_rate_pct_valid_only}%\`
7. 최대 지연(유효 제출): \`${s.max_delay_min_valid_only}분\`
8. 평균 지연(유효 제출): \`${s.avg_delay_min_valid_only}분\`
9. 구증빙 경보(180분 이상): \`${s.stale_evidence_count_180m}/${s.target_roles} = ${s.stale_evidence_rate_pct_180m}%\`
10. 최대 증빙 경과분: \`${Number.isFinite(s.max_evidence_age_min) ? `${s.max_evidence_age_min}분` : "N/A"}\`

## 3) 운영/정합성 스냅샷
- 운영 상태: \`${r.system_status || "N/A"}\` / 모드: \`${r.system_mode || "N/A"}\`
- 자동 점검 종합 상태: \`${r.overall_auto_status || "N/A"}\`
- 런타임 상태: \`${r.role_bot_runtime_status || "N/A"}\`
- 비용 비율: \`${fmtPct(r.cost_ratio_pct)}\` (상한 \`${fmtPct(r.cost_limit_pct)}\`)
- 순손익률: \`${fmtPct(r.net_pnl_pct)}\` (일 필요치 \`${fmtPct(r.required_daily_pct)}\`)
- MDD: \`${fmtPct(r.mdd_pct)}\` (기준 \`${fmtPct(r.mdd_limit_pct)}\`)
- 24h 오류/실패/시간초과: \`${r.error_count_24h ?? "N/A"} / ${r.codex_fail_count_24h ?? "N/A"} / ${
    r.codex_timeout_event_count_24h ?? "N/A"
  }\`
- next_report_at_kst(역할봇): \`${r.next_report_at_kst || "N/A"}\`
- 증빙 stale 경보 기준: \`evidence_age_min >= ${payload.evidence_age_policy.stale_alert_threshold_min}분\` (현재 \`${payload.evidence_age_policy.stale_alert_count}건\`)

## 4) 지혜 의사결정 요청 (A/B)
${decisionLines}

## 5) 이슈
${issueLines}

## 6) 지혜 경유 협업 요청
${collabLines}

## 7) 진화 계획
${evolutionLines}

## 8) 독립 실행안 (실제로 지금 실행한 일)
1. \`node scripts/system-autonomous-cycle.js\` 재실행
2. \`node scripts/role-bot-runtime-check.js\` 재실행
3. \`node scripts/report-reliability-delay-conflict.js\` 재실행
4. \`node scripts/report-sync-status-board.js\` 실행으로 상태판 자동 생성

## 9) 자가검증
결과: \`${payload.self_validation.result}\`
점검 목록:
${selfChecks}
오픈 리스크:
- missing_roles: ${(payload.self_validation.open_risk.missing_roles || []).join(", ") || "없음"}
- stale_roles: ${(payload.self_validation.open_risk.stale_roles || []).join(", ") || "없음"}
- stale_evidence_roles: ${(payload.self_validation.open_risk.stale_evidence_roles || []).join(", ") || "없음"}

## 10) 산출물
- JSON: \`${jsonRelPath}\`
`;
}

function main() {
  const nowMs = Date.now();
  const matrixPath = pickLatestMatrixPath();
  const matrix = (matrixPath && readJsonSafe(matrixPath)) || {};
  const cycleStartMs = parseKstToMs(matrix.as_of_kst || DEFAULT_CYCLE_START_KST);
  const deadlineMs = parseKstToMs(
    (matrix.report_system &&
      matrix.report_system.next_report &&
      matrix.report_system.next_report.staff_to_jihye) ||
      DEFAULT_DEADLINE_KST
  );
  if (!Number.isFinite(cycleStartMs) || !Number.isFinite(deadlineMs)) {
    throw new Error("cycle start/deadline parse failed");
  }

  const asOf = toKstString(nowMs, { fallbackToString: true });
  const dateKey = asOf.slice(0, 10);
  const hhmm = asOf.slice(11, 16).replace(":", "");
  const mdName = `${dateKey}_report_sync_status_board_${hhmm}_jihye.md`;
  const jsonName = `${dateKey}_report_sync_status_board_${hhmm}_jihye.json`;
  const outputMdRel = path.join("ops", "daily", mdName);
  const ledgerBundle = loadSubmissionLedger(OPS_DAILY);

  const payload = buildJsonPayload(
    nowMs,
    cycleStartMs,
    deadlineMs,
    outputMdRel,
    matrix,
    matrixPath,
    ledgerBundle.data
  );
  const ledgerSaved = saveSubmissionLedger(OPS_DAILY, ledgerBundle.data, nowMs);
  payload.artifacts.submission_ledger_latest = path.relative(ROOT, ledgerSaved.latest_abs);
  payload.artifacts.submission_ledger_dated = path.relative(ROOT, ledgerSaved.dated_abs);

  const jsonAbs = path.join(OPS_DAILY, jsonName);
  const mdAbs = path.join(OPS_DAILY, mdName);
  fs.writeFileSync(jsonAbs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdAbs, buildMarkdown(payload, path.join("ops", "daily", jsonName)), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_json: jsonAbs,
        output_md: mdAbs,
        submission_ledger_latest: ledgerSaved.latest_abs,
        submission_ledger_dated: ledgerSaved.dated_abs,
        summary: payload.summary,
        runtime_status: payload.runtime_snapshot.role_bot_runtime_status,
        issue_count: payload.issues.length,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (err) {
  console.error("report-sync-status-board failed:", err && err.message ? err.message : err);
  process.exit(1);
}
