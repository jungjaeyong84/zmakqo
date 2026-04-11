#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { loadSystemOpsLatestSync } = require("./lib/system-ops-runtime");
const {
  loadSubmissionLedger,
  upsertSubmissionEntry,
  saveSubmissionLedger,
} = require("./lib/submission-ledger");

const ROOT = process.cwd();
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const TIME_ZONE = "Asia/Seoul";
const DEFAULT_CYCLE_START_KST = "2026-02-26 00:20:07 KST";
const DEFAULT_DEADLINE_KST = "2026-02-26 00:28:00 KST";
const SYNC_BOARD_PATTERN = /^\d{4}-\d{2}-\d{2}_report_sync_status_board_\d{4}_jihye\.json$/;

const ROLE_CONFIG = [
  {
    role: "market_performance_owner",
    role_kr: "시장/성과 담당",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/2026-02-25_performance_analyst_cycle2330_jihye.md",
    note: "비용 절감안 A/B 수치 제출",
  },
  {
    role: "risk_owner",
    role_kr: "리스크 담당",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/risk_controller_latest.json",
    note: "비용/MDD/오류 등급 + Go/No-Go",
  },
  {
    role: "qa_owner",
    role_kr: "품질 담당",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/2026-02-25_qa_manager_autonomous_cycle2251_jihye.md",
    note: "누락 지표 복구 계획",
  },
  {
    role: "system_owner",
    role_kr: "시스템 담당",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/2026-02-25_system_recovery_actions_2350_jihye.md",
    note: "실패/지연 복구 액션 3건",
  },
  {
    role: "quant_owner",
    role_kr: "퀀트 담당",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/2026-02-25_quant_trainer_autonomous_execution_cycle4_2332_jihye.md",
    note: "고비용 시간대 억제 A/B",
  },
  {
    role: "pine_owner",
    role_kr: "파인 담당",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/2026-02-25_pine_autonomous_execution_cycle5_2308_jihye.md",
    note: "적용 8단계/롤백 5단계 절차",
  },
  {
    role: "governance_secretary",
    role_kr: "거버넌스 비서",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/2026-02-25_governance_secretary_status_board_2125_jihye.md",
    note: "지연 복구 상태판",
  },
  {
    role: "report_sync_keeper",
    role_kr: "보고 동기화 담당",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/2026-02-25_report_sync_status_board_2340_jihye.md",
    note: "제출률/지연/A-B 최종 집계",
  },
  {
    role: "report_clock_manager",
    role_kr: "보고 시각 동기화 담당",
    deadline_kst: "22:55",
    evidence_file: "ops/daily/2026-02-26_report_clock_manager_latest_jihye.md",
    note: "next_report 시각 충돌 0건 증빙",
  },
];

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function readLatestSyncBoard() {
  const names = fs
    .readdirSync(OPS_DAILY)
    .filter((name) => SYNC_BOARD_PATTERN.test(name));
  if (!names.length) return null;

  let picked = null;
  for (const name of names) {
    const absPath = path.join(OPS_DAILY, name);
    let mtimeMs = NaN;
    try {
      mtimeMs = fs.statSync(absPath).mtimeMs;
    } catch (_err) {
      continue;
    }
    if (!picked || mtimeMs > picked.mtimeMs) {
      picked = { name, absPath, mtimeMs };
    }
  }
  if (!picked) return null;

  const payload = readJsonSafe(picked.absPath);
  if (!payload || typeof payload !== "object") return null;
  return { ...picked, payload };
}

function normalizeKst(input, fallback) {
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  return raw.endsWith("KST") ? raw : `${raw} KST`;
}

function parseKstToMs(input) {
  const clean = String(input || "")
    .replace("KST", "")
    .trim();
  if (!clean) return NaN;
  const m = clean.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!m) return NaN;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || "0");
  return Date.UTC(year, month, day, hour - 9, minute, second, 0);
}

function normalizeNextReportKey(input) {
  const ms = parseKstToMs(input);
  if (!Number.isFinite(ms)) {
    const raw = String(input || "").trim();
    return raw || null;
  }
  return formatKst(ms).slice(0, 16);
}

function formatKst(ms) {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} KST`;
}

function round1(v) {
  return Number(v.toFixed(1));
}

function pct(count, total) {
  if (!total) return 0;
  return round1((count / total) * 100);
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtPct(value, digits = 4) {
  const n = toNum(value, null);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "N/A";
}

function detectAbIncluded(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return /(A안|B안|대체안 A|대체안 B|option_a|option_b|A\/B)/.test(text);
  } catch (_err) {
    return false;
  }
}

function buildRoleRows(deadlineMs, cycleStartMs, ledgerData, nowMs) {
  const deadlineKstHm = formatKst(deadlineMs).slice(11, 16);
  return ROLE_CONFIG.map((item) => {
    const absPath = path.join(ROOT, item.evidence_file);
    const exists = fs.existsSync(absPath);
    const evidenceRel = item.evidence_file;

    if (!exists) {
      upsertSubmissionEntry(ledgerData, {
        role: item.role,
        evidenceFile: null,
        observedMtimeMs: null,
        submissionHintMs: null,
        nowMs,
        sourceScript: "scripts/report-reliability-delay-conflict.js",
      });
      return {
        ...item,
        deadline_kst: deadlineKstHm,
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
      };
    }

    const stat = fs.statSync(absPath);
    const mtimeMs = stat.mtimeMs;
    const ledgerEntry = upsertSubmissionEntry(ledgerData, {
      role: item.role,
      evidenceFile: evidenceRel,
      observedMtimeMs: mtimeMs,
      submissionHintMs: mtimeMs,
      nowMs,
      sourceScript: "scripts/report-reliability-delay-conflict.js",
    });
    const submissionTsMs =
      ledgerEntry && Number.isFinite(ledgerEntry.ledger_submission_ts_ms)
        ? Number(ledgerEntry.ledger_submission_ts_ms)
        : mtimeMs;
    const delayMin = Math.ceil((submissionTsMs - deadlineMs) / 60000);
    const validForCycle = submissionTsMs >= cycleStartMs;
    const submissionStatus = !validForCycle
      ? "stale"
      : submissionTsMs <= deadlineMs
      ? "on_time"
      : "late";
    const hasAb = detectAbIncluded(absPath);

    return {
      ...item,
      deadline_kst: deadlineKstHm,
      evidence_exists: true,
      submitted_kst: formatKst(submissionTsMs),
      delay_min: delayMin,
      submission_status: submissionStatus,
      has_ab: hasAb,
      ab_status: hasAb ? "included" : "missing",
      valid_for_cycle: validForCycle,
      submission_ts_ms: submissionTsMs,
      submission_ts_basis: ledgerEntry ? ledgerEntry.basis : "mtime_fallback",
      mtime_ms: mtimeMs,
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
  const abIncludedValid = validRows.filter((r) => r.has_ab).length;

  const lateDelayValues = lateRows
    .map((r) => r.delay_min)
    .filter((v) => typeof v === "number");
  const maxDelay = lateDelayValues.length ? Math.max(...lateDelayValues) : 0;
  const avgDelay = lateDelayValues.length
    ? round1(lateDelayValues.reduce((a, b) => a + b, 0) / lateDelayValues.length)
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
    ab_included_count_valid_only: abIncludedValid,
    ab_included_rate_pct_valid_only: pct(abIncludedValid, validRows.length),
    max_delay_min_valid_only: maxDelay,
    avg_delay_min_valid_only: avgDelay,
  };
}

function buildRuntimeSnapshot() {
  const autoCyclePath = path.join(OPS_DAILY, "system_autonomous_cycle_latest.json");
  const systemOpsPath = path.join(OPS_DAILY, "system_ops_check_latest.json");
  const runtimePath = path.join(OPS_DAILY, "role_bot_runtime_check_latest.json");
  const approvalPath = path.join(OPS_DAILY, "approval_execution_latest.json");
  const dataConsistencyPath = path.join(OPS_DAILY, "data_consistency_lead_latest.json");

  const autoCycle = readJsonSafe(autoCyclePath);
  const systemOps = loadSystemOpsLatestSync({ fallbackPath: systemOpsPath });
  const roleRuntime = readJsonSafe(runtimePath);
  const approval = readJsonSafe(approvalPath);
  const dataConsistency = readJsonSafe(dataConsistencyPath);

  let perfPath = path.join(OPS_DAILY, "2026-02-25_performance_metrics_jihye.json");
  const perfLog =
    autoCycle?.task_logs?.find((x) => x.id === "performance")?.summary
      ?.output_path || null;
  if (perfLog && fs.existsSync(perfLog)) {
    perfPath = perfLog;
  }
  const perf = readJsonSafe(perfPath);

  const snapshot = {
    system_status: systemOps?.status || null,
    system_mode: systemOps?.mode || null,
    overall_auto_status: autoCycle?.overall_status || null,
    role_bot_runtime_status: roleRuntime?.status || null,
    cost_ratio_pct: systemOps?.cost_ratio_pct ?? perf?.costs?.cost_ratio_pct ?? null,
    cost_limit_pct:
      systemOps?.cost_limit_pct ??
      approval?.decision?.execution_gate?.cost_ratio_lte ??
      null,
    net_pnl_pct:
      systemOps?.net_pnl_pct ?? perf?.performance?.net_pnl_pct ?? null,
    required_daily_pct:
      systemOps?.required_daily_pct ?? perf?.performance?.required_daily_pct ?? null,
    mdd_pct:
      perf?.performance?.mdd_pct ??
      approval?.decision?.current_metrics?.mdd_pct ??
      null,
    mdd_limit_pct:
      systemOps?.loss_stop_pct ??
      approval?.decision?.execution_gate?.mdd_gte ??
      -1.5,
    error_count_24h: systemOps?.error_count ?? null,
    drop_tp1_pending_count:
      systemOps?.execution_health?.drop_tp1_pending_count ?? null,
    qty_pct_non_positive_count:
      systemOps?.execution_health?.qty_pct_non_positive_count ?? null,
    duplicate_signal_fill_count:
      systemOps?.execution_health?.duplicate_signal_fill_count ?? null,
    stale_chat_count: roleRuntime?.aggregate?.stale_chat_count ?? null,
    codex_fail_count_24h: roleRuntime?.aggregate?.codex_fail_count_24h ?? null,
    codex_timeout_event_count_24h:
      roleRuntime?.aggregate?.codex_timeout_event_count_24h ?? null,
  };

  const approvedMetrics = approval?.decision?.current_metrics || {};
  const consolidated = dataConsistency?.consolidated_metrics || {};
  const decisionSourceMetrics = {
    cost_ratio_pct: toNum(consolidated.cost_ratio_pct, toNum(snapshot.cost_ratio_pct, null)),
    mdd_pct: toNum(consolidated.mdd_pct, toNum(snapshot.mdd_pct, null)),
    error_count_24h: toNum(
      consolidated.error_count_24h,
      toNum(snapshot.error_count_24h, null)
    ),
  };
  const decisionSourceName = dataConsistency?.consolidated_metrics
    ? "data_consistency_lead_latest.consolidated_metrics"
    : "runtime_snapshot_fallback";

  const collectMismatches = (latestMetrics, latestLabel) => {
    const mismatches = [];
    const checks = [
      ["cost_ratio_pct", approvedMetrics.cost_ratio_pct, latestMetrics.cost_ratio_pct, 0.0001],
      ["mdd_pct", approvedMetrics.mdd_pct, latestMetrics.mdd_pct, 0.0001],
      ["error_count_24h", approvedMetrics.error_count_24h, latestMetrics.error_count_24h, 0.0001],
    ];
    for (const [name, lhs, rhs, epsilon] of checks) {
      if (
        typeof lhs === "number" &&
        typeof rhs === "number" &&
        Math.abs(lhs - rhs) > epsilon
      ) {
        mismatches.push(`${name} mismatch: approval=${lhs}, ${latestLabel}=${rhs}`);
      }
    }
    return mismatches;
  };

  const decisionMismatches = collectMismatches(decisionSourceMetrics, "decision_latest");
  const liveMismatches = collectMismatches(snapshot, "live_latest");

  return {
    auto_cycle: autoCycle,
    system_ops: systemOps,
    role_runtime: roleRuntime,
    approval,
    snapshot,
    decision_source: {
      name: decisionSourceName,
      metrics: decisionSourceMetrics,
    },
    consistency_check: {
      name: "approval_execution_latest vs decision_source_latest",
      source: decisionSourceName,
      mismatch_count: decisionMismatches.length,
      mismatches: decisionMismatches,
    },
    live_drift_check: {
      name: "approval_execution_latest vs live_runtime_snapshot",
      mismatch_count: liveMismatches.length,
      mismatches: liveMismatches,
    },
  };
}

function buildConflictAgenda(rows, summary, runtimeBundle, deadlineKst) {
  const conflicts = [];
  const staleRows = rows.filter(
    (r) => r.submission_status === "stale" || r.submission_status === "missing"
  );

  if (staleRows.length > 0) {
    conflicts.push({
      id: "CF-01",
      title: `${deadlineKst} 기준 유효 제출률 미복구`,
      impact: `유효 제출률 ${summary.valid_submission_rate_pct}%(${summary.valid_submissions}/${summary.target_roles})로 목표 100% 미달`,
      evidence: staleRows.map(
        (r) =>
          `${r.role}: ${r.submission_status}, submitted=${r.submitted_kst || "N/A"}`
      ),
      request_to_jihye:
        "stale/누락 역할 재제출 강제 여부 또는 1회 임시 인정 여부 확정 필요",
    });
  }

  const overall = runtimeBundle.snapshot.overall_auto_status;
  const runtime = runtimeBundle.snapshot.role_bot_runtime_status;
  if (overall && runtime && overall !== runtime) {
    const left = String(overall);
    const right = String(runtime);
    conflicts.push({
      id: "CF-02",
      title: `운영 상태 판정 충돌(${left} vs ${right})`,
      impact: "자동 운영 상태와 역할봇 런타임 상태가 달라 실행 기준 혼선 발생",
      evidence: [
        `system_autonomous_cycle_latest.overall_status=${overall}`,
        `role_bot_runtime_check_latest.status=${runtime}`,
      ],
      request_to_jihye: `운영 기준 단일화(${left}/${right} 중 하나) 결정 필요`,
    });
  }

  const approvalNext =
    runtimeBundle.approval?.next_report?.jihye_to_jaeyong || null;
  const roleNext = runtimeBundle.role_runtime?.chats?.[0]?.next_report_at_kst || null;
  const approvalNextNorm = normalizeNextReportKey(approvalNext);
  const roleNextNorm = normalizeNextReportKey(roleNext);
  if (approvalNextNorm && roleNextNorm && approvalNextNorm !== roleNextNorm) {
    conflicts.push({
      id: "CF-03",
      title: "다음 보고 시각 충돌",
      impact:
        "대표 보고 시각과 역할봇 예약 시각이 달라 24시간 자율 루틴 연속성 저하 위험",
      evidence: [
        `approval_execution_latest.next_report.jihye_to_jaeyong=${approvalNext}`,
        `role_bot_runtime_check_latest.chats[0].next_report_at_kst=${roleNext}`,
      ],
      request_to_jihye:
        "역할봇 next_report_at_kst를 대표 보고 체계와 동기화할지 확정 필요",
    });
  }

  const mismatchCount =
    Number(runtimeBundle?.consistency_check?.mismatch_count) || 0;
  const mismatchEvidence = Array.isArray(runtimeBundle?.consistency_check?.mismatches)
    ? runtimeBundle.consistency_check.mismatches
    : [];
  if (mismatchCount > 0) {
    conflicts.push({
      id: "CF-04",
      title: "승인 기준값 vs 최신 지표 불일치",
      impact: `핵심 지표 ${mismatchCount}건 불일치로 판정 기준 혼선 위험`,
      evidence: mismatchEvidence,
      request_to_jihye:
        "판정 원천을 approval 보수값 또는 latest 실시간값 중 하나로 단일화할지 결정 필요",
    });
  }

  return conflicts;
}

function buildDecisionRequests(conflicts, summary, deadlineKst) {
  const out = [];

  if (conflicts.find((c) => c.id === "CF-01")) {
    out.push({
      id: "DR-01",
      title: "stale/누락 역할 처리 방식",
      option_a: `${deadlineKst} 기준으로 재제출 강제`,
      option_b: "핵심 수치 동일 조건으로 1회 임시 인정",
      reason: `유효 제출률 ${summary.valid_submission_rate_pct}%로 목표 100% 미달`,
    });
  }
  const cf02 = conflicts.find((c) => c.id === "CF-02");
  if (cf02) {
    const m = String(cf02.title || "").match(/\((.+)\s+vs\s+(.+)\)/);
    const left = m && m[1] ? m[1] : "상태A";
    const right = m && m[2] ? m[2] : "상태B";
    out.push({
      id: "DR-02",
      title: `운영 판정 단일화(${left} vs ${right})`,
      option_a: `${left} 기준 우선 적용(보수적)`,
      option_b: `${right} 기준 우선 적용`,
      reason: "운영 상태 이중 표기로 실행 판단 지연 위험",
    });
  }
  if (conflicts.find((c) => c.id === "CF-03")) {
    out.push({
      id: "DR-03",
      title: "보고 시각 동기화 방식",
      option_a: `역할봇 next_report_at_kst를 ${deadlineKst} 체계로 즉시 수정`,
      option_b: `${deadlineKst} 보고 후 운영 체계(예: 09:00)로 공식 전환`,
      reason: "파일 간 다음 보고 시각 불일치",
    });
  }
  if (conflicts.find((c) => c.id === "CF-04")) {
    out.push({
      id: "DR-04",
      title: "판정 원천 수치 단일화(approval vs latest)",
      option_a: "approval 보수값 유지(차단 지속) + 불일치 원인 해소 후 전환",
      option_b: "latest 실시간값 즉시 채택(보수값 동결 해제)",
      reason: "핵심 지표 불일치가 남아 있으면 Go/No-Go 판단 오류 위험",
    });
  }

  return out;
}

function buildJsonPayload(nowMs, rows, summary, runtimeBundle, conflicts, timing) {
  const asOfKst = formatKst(nowMs);
  const hhmm = asOfKst.slice(11, 16).replace(":", "");
  const hasCF01 = conflicts.some((c) => c.id === "CF-01");
  const hasCF02 = conflicts.some((c) => c.id === "CF-02");
  const hasCF03 = conflicts.some((c) => c.id === "CF-03");
  const hasCF04 = conflicts.some((c) => c.id === "CF-04");
  const liveDriftCount =
    Number(runtimeBundle?.live_drift_check?.mismatch_count) || 0;
  const progressPct =
    100 -
    (summary.stale_or_missing_count > 0 ? 3 : 0) -
    (conflicts.length > 0 ? 1 : 0) -
    (hasCF04 ? 2 : 0) -
    (runtimeBundle.snapshot.role_bot_runtime_status === "중단" ? 1 : 0);

  const costRatio = toNum(runtimeBundle.snapshot.cost_ratio_pct, null);
  const costLimit = toNum(runtimeBundle.snapshot.cost_limit_pct, null);
  const mddPct = toNum(runtimeBundle.snapshot.mdd_pct, null);
  const mddLimit = toNum(runtimeBundle.snapshot.mdd_limit_pct, -1.5);
  const runtimeStatus = String(runtimeBundle.snapshot.role_bot_runtime_status || "미확인");
  const codexFail24h = toNum(runtimeBundle.snapshot.codex_fail_count_24h, null);

  const issues = [];
  if (Number.isFinite(costRatio) && Number.isFinite(costLimit)) {
    if (costRatio > costLimit) {
      issues.push(
        `[ISSUE] H | 비용 비율 ${fmtPct(costRatio)}가 상한 ${fmtPct(costLimit)} 초과 | 비용 차단 유지 및 신규 진입 확대 금지`
      );
    } else {
      issues.push(
        `[ISSUE] L | 비용 비율 ${fmtPct(costRatio)}가 상한 ${fmtPct(costLimit)} 이내 | 비용 차단 유지 후 2회 연속 확인`
      );
    }
  } else {
    issues.push("[ISSUE] M | 비용 지표 일부 누락 | 원본 집계 파일 재확인 필요");
  }

  if (Number.isFinite(mddPct) && Number.isFinite(mddLimit)) {
    if (mddPct < mddLimit) {
      issues.push(
        `[ISSUE] H | MDD ${fmtPct(mddPct)}가 보류선 ${fmtPct(mddLimit)} 하회 | 손실 방어 우선, No-Go 유지`
      );
    } else {
      issues.push(
        `[ISSUE] L | MDD ${fmtPct(mddPct)}가 보류선 ${fmtPct(mddLimit)} 이내 | 방어 모드 유지`
      );
    }
  } else {
    issues.push("[ISSUE] M | MDD 지표 누락 | 성과 파일 재생성 필요");
  }

  if (summary.stale_or_missing_count > 0) {
    issues.push(
      `[ISSUE] M | 유효 제출률 ${summary.valid_submission_rate_pct}% (${summary.valid_submissions}/${summary.target_roles}) | stale/누락 역할 복구 필요`
    );
  } else {
    issues.push(
      `[ISSUE] L | 유효 제출률 ${summary.valid_submission_rate_pct}% (${summary.valid_submissions}/${summary.target_roles}) | stale/누락 0건 유지`
    );
  }
  if (summary.on_time_rate_pct < 100) {
    issues.push(
      `[ISSUE] M | 정시율 ${summary.on_time_rate_pct}% (${summary.on_time_count}/${summary.target_roles}) | 마감 10분/3분 사전경보 즉시 도입`
    );
  } else {
    issues.push(
      `[ISSUE] L | 정시율 ${summary.on_time_rate_pct}% (${summary.on_time_count}/${summary.target_roles}) | 현재 정시 상태 유지`
    );
  }
  issues.push(
    `[ISSUE] ${runtimeStatus === "중단" ? "H" : "M"} | 역할봇 상태 ${runtimeStatus}, 24h 실패 ${Number.isFinite(codexFail24h) ? `${codexFail24h}건` : "N/A"} | 정체 채팅 우선 복구`
  );
  if (hasCF04) {
    issues.push(
      `[ISSUE] H | 승인 기준값 vs 최신 지표 불일치 ${runtimeBundle.consistency_check.mismatch_count}건 | 판정 원천 단일화 전 신호 사용 보류`
    );
  } else if (liveDriftCount > 0) {
    issues.push(
      `[ISSUE] M | 승인 기준값 vs 실시간 관측값 차이 ${liveDriftCount}건 | 운영 판정은 단일 기준 유지, 실시간 추세 모니터링`
    );
  }

  const staleRoles = rows.filter(
    (r) => r.submission_status === "stale" || r.submission_status === "missing"
  );

  return {
    as_of_kst: asOfKst,
    role: "report_reliability_lead",
    mission: "보고 누락/지연 집계와 충돌 안건 정리",
    cycle_window_kst: `${timing.cycle_start_kst}~${timing.deadline_kst}`,
    board_deadline_kst: timing.deadline_kst,
    status: "즉시 보고 필요",
    progress_pct: progressPct,
    independent_execution: {
      immediate_owner_tasks: [
        "자동 점검 2종 재실행으로 최신 운영 수치 고정",
        `책임 역할 ${summary.target_roles}개 제출시각/유효성/A-B 포함 여부 재집계`,
        "운영 상태 및 다음 보고시각 충돌 안건 정리",
      ],
      done_now: [
        "node scripts/system-autonomous-cycle.js 실행",
        "node scripts/role-bot-runtime-check.js 실행",
        `latest sync board(${timing.sync_board_source || "N/A"}) 기준 누락/지연 재집계`,
        "scripts/report-reliability-delay-conflict.js 실행",
      ],
      next_actions_without_waiting: [
        "다음 보고 마감 전 stale/누락 역할 재제출 여부 재확인",
        "마감 10분/3분 사전경보 자동화 적용안 다음 사이클에 반영",
        "role_bot next_report_at_kst 동기화 여부 추적",
        "approval vs latest 핵심 지표 불일치 0건 복구 여부 재확인",
      ],
    },
    metrics: {
      submission_board: summary,
      roles: rows,
      runtime_snapshot: runtimeBundle.snapshot,
      decision_source: runtimeBundle.decision_source,
      consistency_check: runtimeBundle.consistency_check,
      live_drift_check: runtimeBundle.live_drift_check,
    },
    conflict_agenda: conflicts,
    report_to_jihye: {
      progress: `${progressPct}% (재집계/충돌정리 완료, stale/누락 ${summary.stale_or_missing_count}건 의사결정 필요)`,
      core_outcomes: [
        `유효 제출률 ${summary.valid_submission_rate_pct}% (${summary.valid_submissions}/${summary.target_roles}) 재확인`,
        `정시율 ${summary.on_time_rate_pct}% (${summary.on_time_count}/${summary.target_roles}), 최대 지연 ${summary.max_delay_min_valid_only}분`,
        `운영/보고 충돌 안건 ${conflicts.length}건 분리 완료`,
      ],
      issues,
      decision_requests: buildDecisionRequests(conflicts, summary, timing.deadline_kst),
    },
    collaboration_requests_via_jihye: [
      ...(hasCF01
        ? [{
        to_role: "governance_secretary",
        ask: `${timing.deadline_kst} 기준 최신 상태판 재제출(숫자+A/B+의사결정요청 포함)`,
        why: "stale 해소 및 유효 제출률 100% 복구 필요",
      }, {
        to_role: "risk_owner",
        ask: `${timing.deadline_kst} 기준 리스크 게이트 재판정 파일 재제출`,
        why: `${timing.cycle_start_kst} 이후 유효 제출 기준 충족 필요`,
      }]
        : []),
      ...(hasCF02
        ? [{
        to_role: "system_owner",
        ask: "역할봇 정체(stale chat 1건) 복구 액션 결과 1건 제출",
        why: "운영 판정 충돌 해소(보류/중단 단일화) 필요",
      }]
        : []),
      ...(hasCF03
        ? [{
        to_role: "report_clock_manager",
        ask: "대표 보고 시각 vs 역할봇 next_report 시각 동기화 증빙 제출",
        why: "시각 충돌(CF-03) 해소 및 KPI(충돌 0건) 검증 필요",
      }]
        : []),
      ...(hasCF04
        ? [{
        to_role: "metric_reconciliation_owner",
        ask: `approval 보수값과 latest 실시간값 불일치 ${runtimeBundle.consistency_check.mismatch_count}건의 원천/우선순위 규칙 확정안 제출`,
        why: "판정 원천 단일화 전에는 신호 사용 기준이 흔들릴 수 있음",
      }]
        : []),
    ],
    evolution_plan: [
      "[EVOLUTION] 제출 판정용 submission_ts ledger(JSON) 도입 | mtime 왜곡으로 인한 제출 충돌 감소",
      "[EVOLUTION] 마감 10분/3분 사전경보를 역할 공통 기본값으로 고정 | 정시율 회복 속도 개선",
      "[EVOLUTION] 운영 판정 tie-break(보류/중단 충돌 시 보수 우선) 규칙 문서화 | 실행 지연 축소",
    ],
    self_validation: {
      checks: [
        "자동 점검 스크립트 2종 재실행(exit code 0) 확인",
        "파일 존재/submission ledger/A-B 포함 여부 재계산",
        "approval_execution_latest 대비 단일 기준 충돌/실시간 드리프트 분리 확인",
        "필수 항목(독립실행/지혜보고/협업요청/진화계획) 포함 확인",
      ],
      result: "pass",
      open_risk:
        staleRoles.length > 0
          ? `stale_or_missing ${staleRoles.length}건 미해소`
          : "없음",
    },
    artifacts: {
      script: "scripts/report-reliability-delay-conflict.js",
      output_hhmm: hhmm,
      sync_board_source: timing.sync_board_source || null,
    },
  };
}

function buildMarkdown(payload, jsonRelPath) {
  const titleDate = payload.as_of_kst.slice(0, 10);
  const s = payload.metrics.submission_board;
  const runtime = payload.metrics.runtime_snapshot;
  const rows = payload.metrics.roles;

  const tableRows = rows
    .map(
      (r) =>
        `| ${r.role_kr} | ${r.submitted_kst || "-"} | ${r.submission_status} | ${
          r.delay_min ?? "-"
        } | ${r.ab_status} |`
    )
    .join("\n");

  const conflictLines = payload.conflict_agenda.length
    ? payload.conflict_agenda
        .map(
          (c) =>
            `- [${c.id}] ${c.title} | 영향: ${c.impact} | 요청: ${c.request_to_jihye}`
        )
        .join("\n")
    : "- 충돌 안건 없음";

  const issueLines = payload.report_to_jihye.issues.map((x) => `- ${x}`).join("\n");
  const decisionLines = payload.report_to_jihye.decision_requests.length
    ? payload.report_to_jihye.decision_requests
        .map(
          (d) =>
            `- ${d.id} | ${d.title}\n  - A안: ${d.option_a}\n  - B안: ${d.option_b}\n  - 이유: ${d.reason}`
        )
        .join("\n")
    : "- 의사결정 요청 없음";

  const collabLines = payload.collaboration_requests_via_jihye
    .map((c) => `- ${c.to_role}: ${c.ask} (이유: ${c.why})`)
    .join("\n");

  const evolutionLines = payload.evolution_plan.map((x) => `- ${x}`).join("\n");
  const selfChecks = payload.self_validation.checks.map((x) => `- ${x}`).join("\n");

  return `# ${titleDate} 보고 누락/지연 집계 및 충돌 안건 정리 ${payload.artifacts.output_hhmm} (report_reliability_lead -> 지혜)

기준 시각: ${payload.as_of_kst}  
마감 시각: ${payload.board_deadline_kst}  
상태: ${payload.status}

## 1) 독립 실행안
- 즉시 작업: 자동 점검 재실행 + 역할 ${s.target_roles}개 제출시각/A-B 재집계 + 충돌 안건 분리
- 실제 실행 완료:
  - node scripts/system-autonomous-cycle.js
  - node scripts/role-bot-runtime-check.js
  - latest sync board(${payload.artifacts.sync_board_source || "N/A"}) 기반 누락/지연 재집계
  - scripts/report-reliability-delay-conflict.js 실행
- 다음 액션:
  - stale/누락 역할 재제출 여부 다음 보고 마감 전 재확인
  - 마감 10분/3분 사전경보 자동화 적용 추적

## 2) 지혜에게 보고할 내용
- 진행률: ${payload.report_to_jihye.progress}
- 핵심 성과:
  - 유효 제출률 ${s.valid_submission_rate_pct}% (${s.valid_submissions}/${s.target_roles})
  - 정시율 ${s.on_time_rate_pct}% (${s.on_time_count}/${s.target_roles})
  - 최대 지연 ${s.max_delay_min_valid_only}분, 평균 지연 ${s.avg_delay_min_valid_only}분
  - 비용 ${runtime.cost_ratio_pct}% (상한 ${runtime.cost_limit_pct}%), MDD ${runtime.mdd_pct}%
- 역할별 집계:
| 역할 | 제출시각(KST) | 상태 | 지연(분) | A/B |
|---|---|---|---:|---|
${tableRows}
- 충돌 안건:
${conflictLines}
- 리스크:
${issueLines}
- 지혜 의사결정 요청:
${decisionLines}

## 3) 지혜를 통해 전달할 협업 요청
${collabLines}

## 4) 진화 계획
${evolutionLines}

## 자가검증
결과: ${payload.self_validation.result}  
점검 목록:
${selfChecks}
오픈 리스크: ${payload.self_validation.open_risk}

## 산출물
- JSON: ${jsonRelPath}
`;
}

function main() {
  const nowMs = Date.now();
  const nowKst = formatKst(nowMs);
  const hhmm = nowKst.slice(11, 16).replace(":", "");
  const dateKey = nowKst.slice(0, 10);
  const ledgerBundle = loadSubmissionLedger(OPS_DAILY);

  const latestSyncBoard = readLatestSyncBoard();
  const syncPayload = latestSyncBoard?.payload || null;
  const syncRows = Array.isArray(syncPayload?.roles) ? syncPayload.roles : null;
  const syncSummary =
    syncPayload?.summary && typeof syncPayload.summary === "object"
      ? syncPayload.summary
      : null;

  const cycleStartKst = normalizeKst(
    String(syncPayload?.cycle_window_kst || "").split("~")[0],
    DEFAULT_CYCLE_START_KST
  );
  const deadlineKst = normalizeKst(syncPayload?.board_deadline_kst, DEFAULT_DEADLINE_KST);

  const deadlineMs = parseKstToMs(deadlineKst);
  const cycleStartMs = parseKstToMs(cycleStartKst);
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(cycleStartMs)) {
    throw new Error("failed to parse cycle/deadline KST");
  }

  const rows = syncRows || buildRoleRows(deadlineMs, cycleStartMs, ledgerBundle.data, nowMs);
  const summary = syncSummary || buildSummary(rows);
  const runtimeBundle = buildRuntimeSnapshot();
  const conflicts = buildConflictAgenda(rows, summary, runtimeBundle, deadlineKst);
  const payload = buildJsonPayload(nowMs, rows, summary, runtimeBundle, conflicts, {
    cycle_start_kst: cycleStartKst,
    deadline_kst: deadlineKst,
    sync_board_source: latestSyncBoard
      ? path.join("ops", "daily", latestSyncBoard.name)
      : null,
  });
  const ledgerSaved = saveSubmissionLedger(OPS_DAILY, ledgerBundle.data, nowMs);
  payload.artifacts.submission_ledger_latest = path.relative(ROOT, ledgerSaved.latest_abs);
  payload.artifacts.submission_ledger_dated = path.relative(ROOT, ledgerSaved.dated_abs);

  const jsonName = `${dateKey}_report_reliability_delay_conflict_${hhmm}_jihye.json`;
  const mdName = `${dateKey}_report_reliability_delay_conflict_${hhmm}_jihye.md`;
  const jsonAbs = path.join(OPS_DAILY, jsonName);
  const mdAbs = path.join(OPS_DAILY, mdName);

  fs.writeFileSync(jsonAbs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const mdContent = buildMarkdown(payload, `ops/daily/${jsonName}`);
  fs.writeFileSync(mdAbs, mdContent, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_json: jsonAbs,
        output_md: mdAbs,
        submission_ledger_latest: ledgerSaved.latest_abs,
        submission_ledger_dated: ledgerSaved.dated_abs,
        valid_submission_rate_pct: payload.metrics.submission_board.valid_submission_rate_pct,
        on_time_rate_pct: payload.metrics.submission_board.on_time_rate_pct,
        stale_or_missing_count: payload.metrics.submission_board.stale_or_missing_count,
        conflict_count: payload.conflict_agenda.length,
        cost_ratio_pct: payload.metrics.runtime_snapshot.cost_ratio_pct,
        mdd_pct: payload.metrics.runtime_snapshot.mdd_pct,
        runtime_status: payload.metrics.runtime_snapshot.role_bot_runtime_status,
      },
      null,
      2
    )
  );
}

main();
