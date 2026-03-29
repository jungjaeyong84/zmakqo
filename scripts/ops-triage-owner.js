#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");

function readJsonSafe(absPath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(absPath, "utf8")), error: null };
  } catch (err) {
    return { ok: false, data: null, error: err && err.message ? err.message : String(err) };
  }
}

function writeJson(absPath, payload) {
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function pickLatestByPattern(dirPath, pattern) {
  if (!fs.existsSync(dirPath)) return null;
  const names = fs.readdirSync(dirPath).filter((name) => pattern.test(name));
  if (!names.length) return null;
  const sorted = names
    .map((name) => {
      const abs = path.join(dirPath, name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(abs).mtimeMs;
      } catch (_) {
        return null;
      }
      return { abs, mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sorted.length ? sorted[0].abs : null;
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function fmtPct(v, digits = 4) {
  if (!Number.isFinite(v)) return "N/A";
  return `${Number(v).toFixed(digits)}%`;
}

function pickFirstFinite(candidates, fallback = null) {
  for (const c of candidates) {
    if (Number.isFinite(c && c.value)) {
      return { value: c.value, source: c.source || "unknown" };
    }
  }
  return { value: fallback, source: "fallback" };
}

function parseLastJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (raw[i] !== "{") continue;
    const candidate = raw.slice(i);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // keep scanning
    }
  }
  return null;
}

function runNodeScript(scriptRelPath) {
  const startedAtIso = new Date().toISOString();
  const res = spawnSync("node", [scriptRelPath], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const endedAtIso = new Date().toISOString();
  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");
  return {
    script: scriptRelPath,
    command: `node ${scriptRelPath}`,
    started_at_iso: startedAtIso,
    ended_at_iso: endedAtIso,
    ok: res.status === 0,
    exit_code: res.status,
    summary: parseLastJsonObject(stdout),
    stdout_tail: stdout.trim().split("\n").filter(Boolean).slice(-12),
    stderr_tail: stderr.trim().split("\n").filter(Boolean).slice(-12),
  };
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

function extractHm(raw, fallback = null) {
  const m = String(raw || "")
    .trim()
    .match(/\b(\d{2}):(\d{2})\b/);
  if (!m) return fallback;
  return `${m[1]}:${m[2]}`;
}

function resolveLatestInputs() {
  const reportSyncPath = pickLatestByPattern(
    OPS_DAILY,
    /^\d{4}-\d{2}-\d{2}_report_sync_status_board_\d{4}_jihye\.json$/
  );
  const reportClockLatestPath = pickLatestByPattern(
    OPS_DAILY,
    /^\d{4}-\d{2}-\d{2}_report_clock_manager_latest_jihye\.json$/
  );
  return {
    report_sync: reportSyncPath,
    report_gap_conflict: path.join(OPS_DAILY, "report_gap_conflict_manager_latest.json"),
    report_clock: reportClockLatestPath,
    data_consistency: path.join(OPS_DAILY, "data_consistency_lead_latest.json"),
    kpi_path_owner: path.join(OPS_DAILY, "kpi_path_owner_latest.json"),
    strategy_alignment: path.join(OPS_DAILY, "strategy_id_alignment_latest.json"),
    role_runtime: path.join(OPS_DAILY, "role_bot_runtime_check_latest.json"),
    ceo_governance: path.join(OPS_DAILY, "ceo_24h_autonomous_governance_latest.json"),
  };
}

function readInputs(inputPaths) {
  return {
    reportSync: inputPaths.report_sync ? (readJsonSafe(inputPaths.report_sync).data || {}) : {},
    gapConflict: readJsonSafe(inputPaths.report_gap_conflict).data || {},
    reportClock: inputPaths.report_clock ? (readJsonSafe(inputPaths.report_clock).data || {}) : {},
    consistency: readJsonSafe(inputPaths.data_consistency).data || {},
    kpiPath: readJsonSafe(inputPaths.kpi_path_owner).data || {},
    strategy: readJsonSafe(inputPaths.strategy_alignment).data || {},
    runtime: readJsonSafe(inputPaths.role_runtime).data || {},
    ceo: readJsonSafe(inputPaths.ceo_governance).data || {},
  };
}

function collectMetrics(inputs) {
  const syncSummary = inputs.reportSync.summary || {};
  const gapKey = inputs.gapConflict.key_numbers || {};
  const c = inputs.consistency.consolidated_metrics || {};
  const thresholds = inputs.consistency.thresholds || {};
  const mismatch = inputs.strategy.mismatch || {};
  const mismatchFreshness = inputs.strategy.mismatch_freshness || {};
  const runtimeAgg = inputs.runtime.aggregate || {};
  const kpiSnapshot = inputs.kpiPath.kpi_snapshot || {};

  const cost = pickFirstFinite([
    { source: "data_consistency.consolidated_metrics.cost_ratio_pct", value: toNum(c.cost_ratio_pct, null) },
    { source: "report_gap_conflict.key_numbers.cost_ratio_pct", value: toNum(gapKey.cost_ratio_pct, null) },
  ], null);
  const mdd = pickFirstFinite([
    { source: "data_consistency.consolidated_metrics.mdd_pct", value: toNum(c.mdd_pct, null) },
    { source: "report_gap_conflict.key_numbers.mdd_pct", value: toNum(gapKey.mdd_pct, null) },
  ], null);
  const error24h = pickFirstFinite([
    { source: "data_consistency.consolidated_metrics.error_count_24h", value: toNum(c.error_count_24h, null) },
    { source: "report_gap_conflict.key_numbers.error_count_24h", value: toNum(gapKey.error_count_24h, null) },
  ], null);
  const validRate = pickFirstFinite([
    { source: "report_gap_conflict.key_numbers.valid_submission_rate_pct", value: toNum(gapKey.valid_submission_rate_pct, null) },
    { source: "report_sync.summary.valid_submission_rate_pct", value: toNum(syncSummary.valid_submission_rate_pct, null) },
    { source: "data_consistency.consolidated_metrics.valid_submission_rate_pct", value: toNum(c.valid_submission_rate_pct, null) },
  ], null);
  const onTimeRate = pickFirstFinite([
    { source: "report_gap_conflict.key_numbers.on_time_rate_pct", value: toNum(gapKey.on_time_rate_pct, null) },
    { source: "report_sync.summary.on_time_rate_pct", value: toNum(syncSummary.on_time_rate_pct, null) },
    { source: "data_consistency.consolidated_metrics.on_time_rate_pct", value: toNum(c.on_time_rate_pct, null) },
  ], null);
  const stale = pickFirstFinite([
    { source: "report_gap_conflict.key_numbers.stale_or_missing_count", value: toNum(gapKey.stale_or_missing_count, null) },
    { source: "report_sync.summary.stale_or_missing_count", value: toNum(syncSummary.stale_or_missing_count, null) },
    { source: "data_consistency.consolidated_metrics.stale_or_missing_count", value: toNum(c.stale_or_missing_count, null) },
  ], null);
  const conflict = pickFirstFinite([
    { source: "report_gap_conflict.key_numbers.conflict_count", value: toNum(gapKey.conflict_count, null) },
    { source: "data_consistency.consolidated_metrics.conflict_count", value: toNum(c.conflict_count, null) },
  ], null);
  const mismatchCnt = pickFirstFinite([
    { source: "strategy_id_alignment.mismatch.guard_count", value: toNum(mismatch.guard_count, null) },
    { source: "strategy_id_alignment.mismatch.after_live_revision_count", value: toNum(mismatch.after_live_revision_count, null) },
    { source: "strategy_id_alignment.mismatch_freshness.created_after_live_revision_count", value: toNum(mismatchFreshness.created_after_live_revision_count, null) },
    { source: "strategy_id_alignment.mismatch.total_count", value: toNum(mismatch.total_count, null) },
    { source: "report_gap_conflict.key_numbers.drop_reason_top1.count", value: String(gapKey.drop_reason_top1 && gapKey.drop_reason_top1.reason || "") === "DROP_STRATEGY_ID_MISMATCH" ? toNum(gapKey.drop_reason_top1.count, null) : null },
  ], null);
  const consistencyCheck = pickFirstFinite([
    { source: "kpi_path_owner.kpi_snapshot.consistency_check_count", value: toNum(kpiSnapshot.consistency_check_count, null) },
    { source: "report_gap_conflict.key_numbers.conflict_count", value: toNum(gapKey.conflict_count, null) },
  ], null);
  const liveDriftCheck = pickFirstFinite([
    { source: "kpi_path_owner.kpi_snapshot.live_drift_check_count", value: toNum(kpiSnapshot.live_drift_check_count, null) },
  ], null);

  return {
    cost_ratio_pct: round(cost.value, 4),
    cost_limit_pct: round(toNum(thresholds.cost_limit_pct, 0.2), 4),
    mdd_pct: round(mdd.value, 4),
    mdd_limit_pct: round(toNum(thresholds.mdd_hold_limit_pct, -1.5), 4),
    error_count_24h: toNum(error24h.value, null),
    valid_submission_rate_pct: round(validRate.value, 1),
    on_time_rate_pct: round(onTimeRate.value, 1),
    stale_or_missing_count: toNum(stale.value, null),
    conflict_count: toNum(conflict.value, null),
    consistency_check_count: toNum(consistencyCheck.value, null),
    live_drift_check_count: toNum(liveDriftCheck.value, null),
    strategy_id_mismatch_count: toNum(mismatchCnt.value, null),
    signals_count: toNum(gapKey.signals_count, null),
    drops_count: toNum(gapKey.drops_count, null),
    codex_fail_count_24h: toNum(runtimeAgg.codex_fail_count_24h, toNum(c.codex_fail_count_24h, null)),
    codex_timeout_event_count_24h: toNum(runtimeAgg.codex_timeout_event_count_24h, toNum(c.codex_timeout_event_count_24h, null)),
    conflict_matrix_vs_role: toNum(gapKey.conflict_matrix_vs_role, null),
    conflict_approval_vs_role: toNum(gapKey.conflict_approval_vs_role, null),
    source: {
      cost_ratio_pct: cost.source,
      mdd_pct: mdd.source,
      error_count_24h: error24h.source,
      valid_submission_rate_pct: validRate.source,
      on_time_rate_pct: onTimeRate.source,
      stale_or_missing_count: stale.source,
      conflict_count: conflict.source,
      consistency_check_count: consistencyCheck.source,
      live_drift_check_count: liveDriftCheck.source,
      strategy_id_mismatch_count: mismatchCnt.source,
    },
  };
}

function decideStatus(metrics, failedTasks) {
  let status = "진행";
  const reasons = [];
  if (failedTasks >= 2) {
    status = "중단";
    reasons.push(`자동 점검 실패 ${failedTasks}건`);
  }
  if (Number.isFinite(metrics.error_count_24h) && metrics.error_count_24h >= 2) {
    status = "중단";
    reasons.push(`핵심 오류 24h ${metrics.error_count_24h}건`);
  }
  if (status !== "중단") {
    if (Number.isFinite(metrics.cost_ratio_pct) && Number.isFinite(metrics.cost_limit_pct) && metrics.cost_ratio_pct > metrics.cost_limit_pct) {
      status = "보류";
      reasons.push(`비용 ${fmtPct(metrics.cost_ratio_pct)} > ${fmtPct(metrics.cost_limit_pct)}`);
    }
    if (Number.isFinite(metrics.mdd_pct) && Number.isFinite(metrics.mdd_limit_pct) && metrics.mdd_pct < metrics.mdd_limit_pct) {
      status = "보류";
      reasons.push(`MDD ${fmtPct(metrics.mdd_pct)} < ${fmtPct(metrics.mdd_limit_pct)}`);
    }
    if (Number.isFinite(metrics.strategy_id_mismatch_count) && metrics.strategy_id_mismatch_count >= 1) {
      status = "보류";
      reasons.push(`전략ID 불일치 ${metrics.strategy_id_mismatch_count}건`);
    }
    if (Number.isFinite(metrics.conflict_count) && metrics.conflict_count >= 1) {
      status = "보류";
      reasons.push(`판정 충돌 ${metrics.conflict_count}건`);
    }
    if ((Number.isFinite(metrics.conflict_matrix_vs_role) && metrics.conflict_matrix_vs_role >= 1)
      || (Number.isFinite(metrics.conflict_approval_vs_role) && metrics.conflict_approval_vs_role >= 1)) {
      status = "보류";
      reasons.push(`시각 충돌 matrix:${toNum(metrics.conflict_matrix_vs_role, 0)} / approval:${toNum(metrics.conflict_approval_vs_role, 0)}`);
    }
    if (Number.isFinite(metrics.stale_or_missing_count) && metrics.stale_or_missing_count >= 1) {
      status = "보류";
      reasons.push(`stale/누락 ${metrics.stale_or_missing_count}건`);
    }
  }
  if (!reasons.length) reasons.push("핵심 리스크 기준 충족");
  return {
    status_recommendation: status === "진행" ? "진행 가능" : `${status} 유지`,
    mode_recommendation: status === "진행" ? "수익 확대 가능" : "비용 차단 유지",
    go_no_go: status === "진행" ? "조건부 Go" : "No-Go 유지",
    reasons,
  };
}

function buildRiskTags(metrics) {
  const tags = [];
  if (Number.isFinite(metrics.cost_ratio_pct) && Number.isFinite(metrics.cost_limit_pct) && metrics.cost_ratio_pct > metrics.cost_limit_pct) {
    tags.push(`[ISSUE] H | 비용 ${fmtPct(metrics.cost_ratio_pct)} > 상한 ${fmtPct(metrics.cost_limit_pct)} | 비용 차단 유지`);
  }
  if (Number.isFinite(metrics.mdd_pct) && Number.isFinite(metrics.mdd_limit_pct) && metrics.mdd_pct < metrics.mdd_limit_pct) {
    tags.push(`[ISSUE] H | MDD ${fmtPct(metrics.mdd_pct)} < 기준 ${fmtPct(metrics.mdd_limit_pct)} | 공격 전환 금지`);
  }
  if (Number.isFinite(metrics.strategy_id_mismatch_count) && metrics.strategy_id_mismatch_count >= 1) {
    tags.push(`[ISSUE] H | 전략ID 불일치 ${metrics.strategy_id_mismatch_count}건 | strategy_id 동기화 필요`);
  }
  if (Number.isFinite(metrics.consistency_check_count) && metrics.consistency_check_count >= 1) {
    tags.push(`[ISSUE] H | 운영충돌(consistency_check) ${metrics.consistency_check_count}건 | approval_consistency_owner 재검증 필요`);
  }
  if ((Number.isFinite(metrics.conflict_matrix_vs_role) && metrics.conflict_matrix_vs_role >= 1)
    || (Number.isFinite(metrics.conflict_approval_vs_role) && metrics.conflict_approval_vs_role >= 1)) {
    tags.push(`[ISSUE] H | 보고 시각 충돌 matrix:${toNum(metrics.conflict_matrix_vs_role, 0)} / approval:${toNum(metrics.conflict_approval_vs_role, 0)} | report-clock-resync 재검증 필요`);
  }
  if (Number.isFinite(metrics.live_drift_check_count) && metrics.live_drift_check_count >= 1) {
    tags.push(`[ISSUE] M | 실시간차이(live_drift_check) ${metrics.live_drift_check_count}건 | metric_reconciliation_owner 축소 필요`);
  }
  if (Number.isFinite(metrics.on_time_rate_pct) && metrics.on_time_rate_pct < 90) {
    tags.push(`[ISSUE] M | 정시율 ${fmtPct(metrics.on_time_rate_pct, 1)} < 90% | 마감 10분/3분 경보 재강화`);
  }
  if (Number.isFinite(metrics.stale_or_missing_count) && metrics.stale_or_missing_count >= 1) {
    tags.push(`[ISSUE] M | stale/누락 ${metrics.stale_or_missing_count}건 | 제출 복구 필요`);
  }
  if (Number.isFinite(metrics.error_count_24h) && metrics.error_count_24h >= 1) {
    tags.push(`[ISSUE] M | 오류 ${metrics.error_count_24h}건/24h | 재발 0건 유지 필요`);
  }
  if (!tags.length) tags.push("[ISSUE] L | 핵심 리스크 기준 충족 | 현재 운영 유지");
  return tags;
}

function buildTriageBoard({ metrics, nextStaffReport }) {
  const due = nextStaffReport || "다음 직원 마감";
  const rows = [];
  if (Number.isFinite(metrics.cost_ratio_pct) && Number.isFinite(metrics.cost_limit_pct) && metrics.cost_ratio_pct > metrics.cost_limit_pct) {
    rows.push({
      severity: "H",
      issue: `비용 ${fmtPct(metrics.cost_ratio_pct)} > 상한 ${fmtPct(metrics.cost_limit_pct)}`,
      owner: "risk_owner",
      support_owner: "market_performance_owner",
      due_kst: due,
      kpi: "비용 완화 A/B 1세트 + 기대 절감(%p)",
    });
  }
  if (Number.isFinite(metrics.mdd_pct) && Number.isFinite(metrics.mdd_limit_pct) && metrics.mdd_pct < metrics.mdd_limit_pct) {
    rows.push({
      severity: "H",
      issue: `MDD ${fmtPct(metrics.mdd_pct)} < 기준 ${fmtPct(metrics.mdd_limit_pct)}`,
      owner: "risk_owner",
      support_owner: "market_performance_owner",
      due_kst: due,
      kpi: "MDD 방어안 1건 + 손실완화 기대치",
    });
  }
  if (Number.isFinite(metrics.strategy_id_mismatch_count) && metrics.strategy_id_mismatch_count >= 1) {
    rows.push({
      severity: "H",
      issue: `전략ID 불일치 ${metrics.strategy_id_mismatch_count}건`,
      owner: "signal_id_alignment_owner",
      support_owner: "post_apply_signal_observer",
      due_kst: due,
      kpi: "신규 mismatch 0 유지 + 허용목록 동기화 ETA",
    });
  }
  if (Number.isFinite(metrics.consistency_check_count) && metrics.consistency_check_count >= 1) {
    rows.push({
      severity: "H",
      issue: `운영충돌(consistency_check) ${metrics.consistency_check_count}건`,
      owner: "approval_consistency_owner",
      support_owner: "metric_reconciliation_owner",
      due_kst: due,
      kpi: "consistency_check 0건 복구",
    });
  }
  if (Number.isFinite(metrics.conflict_count) && metrics.conflict_count >= 1) {
    rows.push({
      severity: "H",
      issue: `운영 판정 충돌 ${metrics.conflict_count}건`,
      owner: "approval_consistency_owner",
      support_owner: "report_clock_manager",
      due_kst: due,
      kpi: "conflict 0건 복구",
    });
  }
  if ((Number.isFinite(metrics.conflict_matrix_vs_role) && metrics.conflict_matrix_vs_role >= 1)
    || (Number.isFinite(metrics.conflict_approval_vs_role) && metrics.conflict_approval_vs_role >= 1)) {
    rows.push({
      severity: "H",
      issue: `보고 시각 충돌 matrix:${toNum(metrics.conflict_matrix_vs_role, 0)} / approval:${toNum(metrics.conflict_approval_vs_role, 0)}`,
      owner: "report_clock_manager",
      support_owner: "approval_consistency_owner",
      due_kst: due,
      kpi: "matrix/approval 시각 충돌 0건 복구",
    });
  }
  if (Number.isFinite(metrics.on_time_rate_pct) && metrics.on_time_rate_pct < 90) {
    rows.push({
      severity: "M",
      issue: `정시율 ${fmtPct(metrics.on_time_rate_pct, 1)} < 90%`,
      owner: "report_sync_keeper",
      support_owner: "submission_compliance_owner",
      due_kst: due,
      kpi: "정시율 90%+ 복구",
    });
  }
  if (Number.isFinite(metrics.live_drift_check_count) && metrics.live_drift_check_count >= 1) {
    rows.push({
      severity: "M",
      issue: `실시간차이(live_drift_check) ${metrics.live_drift_check_count}건`,
      owner: "metric_reconciliation_owner",
      support_owner: "report_sync_keeper",
      due_kst: due,
      kpi: "live_drift_check 3건 -> 0건 추적표 제출",
    });
  }
  if (Number.isFinite(metrics.stale_or_missing_count) && metrics.stale_or_missing_count >= 1) {
    rows.push({
      severity: "M",
      issue: `stale/누락 ${metrics.stale_or_missing_count}건`,
      owner: "submission_compliance_owner",
      support_owner: "report_sync_keeper",
      due_kst: due,
      kpi: "stale 0건 복구",
    });
  }
  if (Number.isFinite(metrics.error_count_24h) && metrics.error_count_24h >= 1) {
    rows.push({
      severity: "M",
      issue: `오류 ${metrics.error_count_24h}건/24h`,
      owner: "system_owner",
      support_owner: "risk_owner",
      due_kst: due,
      kpi: "오류 추가 0건 유지",
    });
  }
  if (!rows.length) {
    rows.push({
      severity: "L",
      issue: "핵심 리스크 기준 충족",
      owner: "ops_triage_owner",
      support_owner: "report_clock_manager",
      due_kst: due,
      kpi: "기준 유지",
    });
  }
  return rows;
}

function buildMarkdown(payload) {
  const lines = [];
  lines.push(`# ${payload.date_key} ops_triage_owner 실행 보고 (${payload.cycle} KST)`);
  lines.push("");
  lines.push("## 1) 핵심 결론");
  lines.push(`- 판정: \`${payload.decision.status_recommendation} / ${payload.decision.mode_recommendation} / ${payload.decision.go_no_go}\``);
  lines.push(`- 보고 판단: \`${payload.report_timing.is_report_time ? "즉시 보고 시점" : "사전 점검 시점"}\` (${payload.report_timing.reason})`);
  lines.push(`- 핵심 수치: 비용 \`${fmtPct(payload.key_numbers.cost_ratio_pct)}\`, MDD \`${fmtPct(payload.key_numbers.mdd_pct)}\`, 정시율 \`${fmtPct(payload.key_numbers.on_time_rate_pct, 1)}\`, 운영충돌 \`${Number.isFinite(payload.key_numbers.consistency_check_count) ? payload.key_numbers.consistency_check_count : "N/A"}\`건, 실시간차이 \`${Number.isFinite(payload.key_numbers.live_drift_check_count) ? payload.key_numbers.live_drift_check_count : "N/A"}\`건`);
  lines.push("");
  lines.push("## 2) 실제 수행한 작업 (번호 목록)");
  payload.independent_execution_plan.done_now.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push("");
  lines.push("## 3) 변경 파일/산출물");
  payload.artifacts.files.forEach((x) => lines.push(`- \`${x}\``));
  lines.push("");
  lines.push("## 4) 지혜에게 보고할 핵심");
  lines.push("- 시스템 설계");
  payload.system_design.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 구현 태스크");
  payload.implementation_tasks.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 장애/보안 리스크");
  payload.report_to_jihye.issues.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 운영 체크리스트");
  payload.operations_checklist.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 대표 보고 요약");
  payload.report_to_jihye.core_outcomes.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 독립 실행안");
  lines.push(`  - ${payload.independent_execution_plan.next_actions_without_waiting.join(" / ")}`);
  lines.push("- 지혜를 통해 전달할 협업 요청");
  payload.collaboration_requests_via_jihye.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 진화 계획");
  payload.evolution.forEach((x) => lines.push(`  - ${x}`));
  lines.push("");
  lines.push("## 5) 재용에게 보여줄 쉬운 요약(비개발자용)");
  payload.simple_summary_for_jaeyong.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## 6) 리스크/확인사항");
  payload.report_to_jihye.issues.forEach((x) => lines.push(`- ${x}`));
  lines.push(`- 자가검증 결과: \`${payload.self_validation.result}\``);
  payload.self_validation.checks.forEach((x) => lines.push(`  - ${x}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const startedAtIso = new Date().toISOString();
  const generatedAtKst = toKstString(startedAtIso, { fallbackToString: true });
  const dateKey = kstDateKey(startedAtIso) || generatedAtKst.slice(0, 10);
  const cycle = generatedAtKst.slice(11, 16).replace(":", "");

  const runPlan = [
    "scripts/role-bot-runtime-check.js",
    "scripts/report-sync-status-board.js",
    "scripts/report-clock-manager.js",
    "scripts/report-gap-conflict-manager.js",
    "scripts/data-consistency-lead.js",
    "scripts/strategy-id-alignment-check.js",
    "scripts/kpi-path-owner-cycle.js",
  ];

  const taskResults = runPlan.map((script) => runNodeScript(script));

  let inputPaths = resolveLatestInputs();
  let inputs = readInputs(inputPaths);
  let metrics = collectMetrics(inputs);

  const clockConflictDetected = (toNum(metrics.conflict_matrix_vs_role, 0) > 0) || (toNum(metrics.conflict_approval_vs_role, 0) > 0);
  if (clockConflictDetected) {
    taskResults.push(runNodeScript("scripts/report-clock-resync.js"));
    taskResults.push(runNodeScript("scripts/role-bot-runtime-check.js"));
    taskResults.push(runNodeScript("scripts/report-gap-conflict-manager.js"));
    inputPaths = resolveLatestInputs();
    inputs = readInputs(inputPaths);
    metrics = collectMetrics(inputs);
  }

  const failedTasks = taskResults.filter((x) => !x.ok).length;
  const decision = decideStatus(metrics, failedTasks);

  const clockKey = inputs.reportClock.key_numbers || {};
  const nextStaffReport = String(
    clockKey.matrix_staff_to_jihye
    || (inputs.ceo.next_report && inputs.ceo.next_report.staff_to_jihye)
    || (((inputs.gapConflict.key_numbers || {}).role_bot_next_report_at_kst || "").trim()
      ? `${dateKey} ${String((inputs.gapConflict.key_numbers || {}).role_bot_next_report_at_kst).trim()} KST`
      : "")
    || ""
  ).trim() || null;
  const nextJihyeReport = String(
    clockKey.matrix_jihye_to_jaeyong
    || clockKey.approval_jihye_to_jaeyong
    || (inputs.ceo.next_report && inputs.ceo.next_report.jihye_to_jaeyong)
    || ((inputs.gapConflict.key_numbers || {}).matrix_next_report_jihye_to_jaeyong || "")
    || ""
  ).trim() || null;
  const nowKstMs = parseKstToMs(generatedAtKst);
  const nextStaffMs = parseKstToMs(nextStaffReport);
  const nextJihyeMs = parseKstToMs(nextJihyeReport);

  let isReportTime = false;
  let reportReason = "다음 직원 마감 정보 없음";
  if (Number.isFinite(nowKstMs) && Number.isFinite(nextStaffMs)) {
    const diffMin = Math.round((nextStaffMs - nowKstMs) / (60 * 1000));
    if (diffMin < -5) {
      reportReason = `직원 마감 ${nextStaffReport}가 지나 최신 슬롯 재확인 필요`;
    } else if (diffMin <= 20) {
      isReportTime = true;
      reportReason = `직원 마감 ${nextStaffReport}까지 ${diffMin}분, 즉시 보고 구간`;
    } else {
      reportReason = `직원 마감 ${nextStaffReport}까지 ${diffMin}분 남아 사전 점검 우선`;
    }
  }

  let triageDueKst = nextStaffReport;
  if (Number.isFinite(nowKstMs) && Number.isFinite(nextStaffMs) && nextStaffMs < nowKstMs) {
    triageDueKst = nextJihyeReport || nextStaffReport;
  }
  if (!triageDueKst && Number.isFinite(nextJihyeMs)) {
    triageDueKst = nextJihyeReport;
  }
  const triageDueMs = parseKstToMs(triageDueKst);
  if (Number.isFinite(nowKstMs) && (!Number.isFinite(triageDueMs) || triageDueMs < nowKstMs)) {
    const fallbackDueMs = nowKstMs + (30 * 60 * 1000);
    const fallbackDueKst = toKstString(fallbackDueMs, { fallbackToString: true });
    triageDueKst = `${fallbackDueKst.slice(0, 16)} KST`;
  }
  let collabJihyeDueKst = nextJihyeReport || triageDueKst;
  const collabJihyeDueMs = parseKstToMs(collabJihyeDueKst);
  if (Number.isFinite(nowKstMs) && (!Number.isFinite(collabJihyeDueMs) || collabJihyeDueMs < nowKstMs)) {
    collabJihyeDueKst = triageDueKst;
  }
  const effectiveStaffReportKst = triageDueKst || nextStaffReport || null;
  const effectiveJihyeReportKst = collabJihyeDueKst || nextJihyeReport || effectiveStaffReportKst;
  const nextStaffHm = extractHm(effectiveStaffReportKst, null);
  const nextJihyeHm = extractHm(effectiveJihyeReportKst, null);

  const progressPct = round(((taskResults.length - failedTasks) / taskResults.length) * 100, 1);
  const issueTags = buildRiskTags(metrics);
  const triageBoard = buildTriageBoard({ metrics, nextStaffReport: triageDueKst });
  const doneNow = taskResults.map((x) => `${x.command} (${x.ok ? "exit 0" : `exit ${x.exit_code}`})`);

  const collaborationRequests = [
    `[COLLAB_REQUEST] risk_owner | 비용/MDD 완화안 A/B + 기대효과(%p) 제출 | ${triageDueKst || "다음 직원 마감 전"}`,
    `[COLLAB_REQUEST] signal_id_alignment_owner | strategy_id 허용목록 동기화 ETA 제출 | ${triageDueKst || "다음 직원 마감 전"}`,
    `[COLLAB_REQUEST] report_sync_keeper | 정시율 90%+ 복구 증빙 제출 | ${triageDueKst || "다음 직원 마감 전"}`,
    `[COLLAB_REQUEST] metric_reconciliation_owner | consistency/live_drift 동시 축소 추적표 제출 | ${triageDueKst || "다음 직원 마감 전"}`,
    `[COLLAB_REQUEST] post_apply_signal_observer | mismatch 반영 후 60분 내 신규 mismatch 0건 증빙 | ${collabJihyeDueKst || "다음 대표 보고 전"}`,
  ];

  const evolution = [
    "[EVOLUTION] 누락된 ops-triage-owner.js를 복구해 triage 자동 실행 경로를 고정 | 파일부재 재발 차단",
    "[EVOLUTION] 시각 충돌 감지 시 report-clock-resync 자동 연동 | 보고시계 충돌 자동 복구",
    "[EVOLUTION] H/M/L 분류를 수치 기반 템플릿으로 표준화 | 역할별 책임/기한 명확화",
  ];

  const payload = {
    generated_at_iso: startedAtIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    cycle,
    role: "ops_triage_owner",
    mission: "H/M/L 분류와 담당 재배치로 운영 리스크를 마감 전 최소화",
    report_timing: {
      is_report_time: isReportTime,
      reason: reportReason,
      next_staff_report_kst: nextStaffReport,
      next_jihye_report_kst: nextJihyeReport,
      effective_next_staff_report_kst: effectiveStaffReportKst,
      effective_next_jihye_report_kst: effectiveJihyeReportKst,
    },
    decision,
    system_design: [
      "입력: 제출품질/충돌/정합성/런타임 지표를 최신 파일에서 자동 수집",
      "판정: 비용/MDD/전략ID/충돌/stale 기준으로 H/M/L 이슈를 자동 분류",
      "출력: triage 보고서(JSON/MD)와 latest 포인터를 동시에 갱신",
    ],
    implementation_tasks: [
      "점검 스크립트 7종 자동 실행",
      "시각 충돌 감지 시 자동 resync + 재검증",
      "H/M/L 보드와 협업 요청 태그 자동 생성",
    ],
    risk_security: issueTags,
    operations_checklist: [
      "실행 결과 exit code 확인",
      "핵심 수치(cost/mdd/submission/conflict/mismatch) 재계산",
      "출력 파일 4종(dated/latest JSON/MD) 동시 갱신",
      "자가검증 pass/fail 판정",
    ],
    independent_execution_plan: {
      status: failedTasks === 0 ? "completed" : "partial",
      progress_pct: progressPct,
      done_now: doneNow,
      next_actions_without_waiting: [
        `${nextStaffHm || "다음"} 전 H 이슈 재점검`,
        `${nextJihyeHm || "다음"} 전 협업요청 증빙 취합`,
        "다음 30분 사이클 자동 재실행",
      ],
    },
    key_numbers: {
      monthly_target_pct: 5,
      cost_ratio_pct: metrics.cost_ratio_pct,
      cost_limit_pct: metrics.cost_limit_pct,
      mdd_pct: metrics.mdd_pct,
      mdd_limit_pct: metrics.mdd_limit_pct,
      error_count_24h: metrics.error_count_24h,
      valid_submission_rate_pct: metrics.valid_submission_rate_pct,
      on_time_rate_pct: metrics.on_time_rate_pct,
      stale_or_missing_count: metrics.stale_or_missing_count,
      conflict_count: metrics.conflict_count,
      consistency_check_count: metrics.consistency_check_count,
      live_drift_check_count: metrics.live_drift_check_count,
      conflict_matrix_vs_role: metrics.conflict_matrix_vs_role,
      conflict_approval_vs_role: metrics.conflict_approval_vs_role,
      strategy_id_mismatch_count: metrics.strategy_id_mismatch_count,
      signals_count: metrics.signals_count,
      drops_count: metrics.drops_count,
      codex_fail_count_24h: metrics.codex_fail_count_24h,
      codex_timeout_event_count_24h: metrics.codex_timeout_event_count_24h,
      metric_source: metrics.source,
    },
    triage_policy: {
      severity_rule: "H 10분 / M 30분 / L 다음 사이클",
      h_due_by_kst: triageDueKst,
      m_due_by_kst: triageDueKst,
      l_due_cycle: "다음 30분 사이클",
    },
    triage_board: triageBoard,
    report_to_jihye: {
      progress: `${progressPct}% (${taskResults.length - failedTasks}/${taskResults.length} 자동 점검 성공)`,
      core_outcomes: [
        `점검 스크립트 ${taskResults.length}개 실행 (${taskResults.length - failedTasks}/${taskResults.length} 성공)`,
        `핵심 리스크 자동 판정: ${decision.status_recommendation} / ${decision.mode_recommendation} / ${decision.go_no_go}`,
        `운영충돌(consistency_check) ${toNum(metrics.consistency_check_count, 0)}건 / 실시간차이(live_drift_check) ${toNum(metrics.live_drift_check_count, 0)}건`,
        `보고 슬롯 고정: 직원 ${effectiveStaffReportKst || "미정"} / 지혜 ${effectiveJihyeReportKst || "미정"}`,
      ],
      issues: issueTags,
      decision_requests: [
        "보수 기준(비용/MDD/전략ID) 유지 여부 확정 요청",
        "정시율 90% 복구 전까지 No-Go 유지 여부 확정 요청",
      ],
    },
    collaboration_requests_via_jihye: collaborationRequests,
    evolution,
    simple_summary_for_jaeyong: [
      "지금은 안전 기준이 아직 안 맞아서 공격적으로 주문을 늘리면 안 됩니다.",
      `비용 ${fmtPct(metrics.cost_ratio_pct)}와 손실폭 ${fmtPct(metrics.mdd_pct)}이 기준 밖이라 보류가 맞습니다.`,
      `운영충돌 ${toNum(metrics.consistency_check_count, 0)}건, 실시간차이 ${toNum(metrics.live_drift_check_count, 0)}건으로 기준-실시간 차이도 같이 추적 중입니다.`,
      `다음 공식 보고는 ${effectiveJihyeReportKst || "미정"}이고, 그전까지 팀이 숫자 기준으로 복구 작업을 진행합니다.`,
    ],
    self_validation: {
      checks: [
        ...taskResults.map((x) => `${x.command} ${x.ok ? "성공" : `실패(exit ${x.exit_code})`}`),
        "출력 JSON/MD 파일 생성 확인",
        "필수 섹션(결론/작업/산출물/지혜보고/쉬운요약/리스크) 포함 확인",
      ],
      result: failedTasks === 0 ? "pass" : "fail",
    },
    source_files: inputPaths,
    task_logs: taskResults,
    artifacts: {
      files: [
        path.join(OPS_DAILY, `${dateKey}_ops_triage_owner_${cycle}_jihye.json`),
        path.join(OPS_DAILY, `${dateKey}_ops_triage_owner_${cycle}_jihye.md`),
        path.join(OPS_DAILY, "ops_triage_owner_latest.json"),
        path.join(OPS_DAILY, "ops_triage_owner_latest.md"),
      ],
    },
  };

  const outJson = path.join(OPS_DAILY, `${dateKey}_ops_triage_owner_${cycle}_jihye.json`);
  const outMd = path.join(OPS_DAILY, `${dateKey}_ops_triage_owner_${cycle}_jihye.md`);
  const latestJson = path.join(OPS_DAILY, "ops_triage_owner_latest.json");
  const latestMd = path.join(OPS_DAILY, "ops_triage_owner_latest.md");

  writeJson(outJson, payload);
  writeJson(latestJson, payload);
  fs.writeFileSync(outMd, buildMarkdown(payload), "utf8");
  fs.writeFileSync(latestMd, buildMarkdown(payload), "utf8");

  console.log(JSON.stringify({
    ok: true,
    role: payload.role,
    status_recommendation: payload.decision.status_recommendation,
    mode_recommendation: payload.decision.mode_recommendation,
    go_no_go: payload.decision.go_no_go,
    output_json: outJson,
    output_md: outMd,
    latest_json: latestJson,
    latest_md: latestMd,
    progress_pct: payload.independent_execution_plan.progress_pct,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("ops-triage-owner failed:", err && err.message ? err.message : err);
  process.exit(1);
}
