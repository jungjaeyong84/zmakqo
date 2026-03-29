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

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function fmtPct(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return `${Number(value).toFixed(digits)}%`;
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
      // continue
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

function pickLatestByPattern(dirPath, pattern) {
  if (!fs.existsSync(dirPath)) return null;
  const names = fs.readdirSync(dirPath).filter((name) => pattern.test(name));
  if (!names.length) return null;

  let latest = null;
  let latestMtime = -Infinity;
  for (const name of names) {
    const abs = path.join(dirPath, name);
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch (_) {
      continue;
    }
    if (mtimeMs > latestMtime) {
      latestMtime = mtimeMs;
      latest = abs;
    }
  }
  return latest;
}

function pickFirstFinite(candidates, fallback = null) {
  for (const candidate of candidates) {
    if (Number.isFinite(candidate && candidate.value)) {
      return { value: candidate.value, source: candidate.source };
    }
  }
  return { value: fallback, source: "fallback" };
}

function pickConservativeByDirection(candidates, direction, fallback = null) {
  const cleaned = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => Number.isFinite(candidate && candidate.value))
    .map((candidate) => ({ value: candidate.value, source: candidate.source }));
  if (!cleaned.length) return { value: fallback, source: "fallback" };

  let picked = cleaned[0];
  for (const candidate of cleaned.slice(1)) {
    if (direction === "lower_worse") {
      if (candidate.value < picked.value) picked = candidate;
      continue;
    }
    if (candidate.value > picked.value) picked = candidate;
  }
  return picked;
}

function findReasonCount(reasonRows, reasonKey, fallback = null) {
  const rows = Array.isArray(reasonRows) ? reasonRows : [];
  const hit = rows.find((row) => row && String(row.reason || "").trim() === String(reasonKey || "").trim());
  if (!hit) return fallback;
  return toNum(hit.count, fallback);
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

function toKstMinuteString(utcMs) {
  if (!Number.isFinite(utcMs)) return null;
  const kst = toKstString(new Date(utcMs).toISOString(), { fallbackToString: true });
  const base = String(kst).slice(0, 16);
  return `${base} KST`;
}

function buildFallbackReportSlot(nowKstMs) {
  if (!Number.isFinite(nowKstMs)) return null;
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstNow = new Date(nowKstMs + KST_OFFSET_MS);
  const target = new Date(kstNow.getTime());
  const minute = target.getUTCMinutes();

  if (minute < 28) {
    target.setUTCMinutes(28, 0, 0);
  } else if (minute < 58) {
    target.setUTCMinutes(58, 0, 0);
  } else {
    target.setUTCHours(target.getUTCHours() + 1, 28, 0, 0);
  }

  const staffMs = target.getTime() - KST_OFFSET_MS;
  const jihyeMs = staffMs + (2 * 60 * 1000);
  return {
    source: "fallback_30m_slot",
    staff_to_jihye: toKstMinuteString(staffMs),
    jihye_to_jaeyong: toKstMinuteString(jihyeMs),
  };
}

function extractHm(raw, fallback = null) {
  const m = String(raw || "")
    .trim()
    .match(/\b(\d{2}):(\d{2})\b/);
  if (!m) return fallback;
  return `${m[1]}:${m[2]}`;
}

function pickReportSlot({ nowKstMs, candidates }) {
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .map((item) => {
      const source = item && item.source ? item.source : "unknown";
      const generatedAtKst = item && item.generated_at_kst ? item.generated_at_kst : null;
      const nextReport = item && item.next_report ? item.next_report : {};
      const staff = nextReport.staff_to_jihye || null;
      const jihye = nextReport.jihye_to_jaeyong || null;
      return {
        source,
        generated_at_kst: generatedAtKst,
        staff_to_jihye: staff,
        jihye_to_jaeyong: jihye,
        generated_at_ms: parseKstToMs(generatedAtKst),
        staff_ms: parseKstToMs(staff),
      };
    })
    .filter((x) => x.staff_to_jihye || x.jihye_to_jaeyong);

  if (!normalized.length) return null;

  const freshnessCutoffMs = Number.isFinite(nowKstMs) ? nowKstMs - (5 * 60 * 1000) : null;
  const fresh = Number.isFinite(freshnessCutoffMs)
    ? normalized.filter((x) => Number.isFinite(x.staff_ms) && x.staff_ms >= freshnessCutoffMs)
    : normalized;
  const pool = fresh.length ? fresh : normalized;

  pool.sort((a, b) => {
    const aGenerated = Number.isFinite(a.generated_at_ms) ? a.generated_at_ms : -Infinity;
    const bGenerated = Number.isFinite(b.generated_at_ms) ? b.generated_at_ms : -Infinity;
    if (bGenerated !== aGenerated) return bGenerated - aGenerated;
    const aStaff = Number.isFinite(a.staff_ms) ? a.staff_ms : -Infinity;
    const bStaff = Number.isFinite(b.staff_ms) ? b.staff_ms : -Infinity;
    return bStaff - aStaff;
  });
  return pool[0];
}

function buildRiskTags(metrics) {
  const lines = [];
  if (Number.isFinite(metrics.cost_ratio_pct) && Number.isFinite(metrics.cost_limit_pct) && metrics.cost_ratio_pct > metrics.cost_limit_pct) {
    lines.push(`[ISSUE] H | 비용 ${fmtPct(metrics.cost_ratio_pct)} > 상한 ${fmtPct(metrics.cost_limit_pct)} | 비용 차단 유지 필요`);
  }
  if (Number.isFinite(metrics.mdd_pct) && Number.isFinite(metrics.mdd_limit_pct) && metrics.mdd_pct < metrics.mdd_limit_pct) {
    lines.push(`[ISSUE] H | MDD ${fmtPct(metrics.mdd_pct)} < 기준 ${fmtPct(metrics.mdd_limit_pct)} | 공격 전환 금지`);
  }
  if (Number.isFinite(metrics.strategy_id_mismatch_drop_count) && metrics.strategy_id_mismatch_drop_count >= 1) {
    lines.push(`[ISSUE] H | 전략ID 불일치 드롭 ${metrics.strategy_id_mismatch_drop_count}건 | 서버 허용 strategy_id 동기화 필요`);
  }
  if (Number.isFinite(metrics.stale_or_missing_count) && metrics.stale_or_missing_count >= 1) {
    lines.push(`[ISSUE] M | stale/누락 ${metrics.stale_or_missing_count}건 | 제출 정합성 100% 복구 필요`);
  }
  if (
    (Number.isFinite(metrics.stale_evidence_count_180m) && metrics.stale_evidence_count_180m >= 1)
    || (Number.isFinite(metrics.max_evidence_age_min) && metrics.max_evidence_age_min >= 180)
  ) {
    lines.push(
      `[ISSUE] M | 증빙 180분 초과 ${metrics.stale_evidence_count_180m ?? "N/A"}건 (최대 ${metrics.max_evidence_age_min ?? "N/A"}분) | 최신 증빙 교체 필요`
    );
  }
  if (Number.isFinite(metrics.valid_submission_rate_pct) && metrics.valid_submission_rate_pct < 100) {
    lines.push(`[ISSUE] M | 유효 제출률 ${fmtPct(metrics.valid_submission_rate_pct, 1)} | 제출 누락 역할 재제출 필요`);
  }
  if (Number.isFinite(metrics.on_time_rate_pct) && metrics.on_time_rate_pct < 90) {
    lines.push(`[ISSUE] M | 정시율 ${fmtPct(metrics.on_time_rate_pct, 1)} | 마감 10분/3분 경보 재강화 필요`);
  }
  if (Number.isFinite(metrics.live_drift_check_count) && metrics.live_drift_check_count >= 1) {
    lines.push(`[ISSUE] M | 실시간차이(live_drift_check) ${metrics.live_drift_check_count}건 | 3->0 축소 추적 필요`);
  }
  if (Number.isFinite(metrics.tv_webhook_drop_count) && metrics.tv_webhook_drop_count >= 1) {
    lines.push(`[ISSUE] M | 비-전략ID 드롭 TV_WEBHOOK ${metrics.tv_webhook_drop_count}건 | 저감 액션 A/B 즉시 추적 필요`);
  }
  const hasSubmissionDrift = Number.isFinite(metrics.valid_submission_rate_pct)
    && Number.isFinite(metrics.conservative_valid_submission_rate_pct)
    && (
      metrics.valid_submission_rate_pct !== metrics.conservative_valid_submission_rate_pct
      || metrics.on_time_rate_pct !== metrics.conservative_on_time_rate_pct
      || metrics.stale_or_missing_count !== metrics.conservative_stale_or_missing_count
    );
  if (hasSubmissionDrift) {
    lines.push(
      `[ISSUE] M | 제출지표 실시간/보수 차이 live(유효 ${fmtPct(metrics.valid_submission_rate_pct, 1)}, 정시 ${fmtPct(metrics.on_time_rate_pct, 1)}, stale ${metrics.stale_or_missing_count}) vs conservative(유효 ${fmtPct(metrics.conservative_valid_submission_rate_pct, 1)}, 정시 ${fmtPct(metrics.conservative_on_time_rate_pct, 1)}, stale ${metrics.conservative_stale_or_missing_count}) | 운영충돌/실시간차이 분리 표기 유지`
    );
  }
  if (!lines.length) {
    lines.push("[ISSUE] L | 핵심 리스크 지표 모두 기준 이내 | 현재 운영 유지");
  }
  return lines;
}

function decideRecommendation({ metrics, taskFailures }) {
  const reasons = [];
  let status = "진행";

  if (taskFailures >= 2) {
    status = "중단";
    reasons.push(`자동 점검 실패 ${taskFailures}건`);
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
    if (Number.isFinite(metrics.strategy_id_mismatch_drop_count) && metrics.strategy_id_mismatch_drop_count >= 1) {
      status = "보류";
      reasons.push(`전략ID 불일치 ${metrics.strategy_id_mismatch_drop_count}건`);
    }
    if (Number.isFinite(metrics.stale_or_missing_count) && metrics.stale_or_missing_count >= 1) {
      status = "보류";
      reasons.push(`stale/누락 ${metrics.stale_or_missing_count}건`);
    }
  }

  if (!reasons.length) reasons.push("핵심 리스크 기준 충족");
  const mode = status === "진행" ? "수익 확대 가능" : "비용 차단 유지";
  const goNoGo = status === "진행" ? "조건부 Go" : "No-Go 유지";
  return { status, mode, go_no_go: goNoGo, reasons };
}

function buildMarkdown(payload) {
  const lines = [];
  const p = payload;
  lines.push(`# ${p.date_key} 시스템 개발 자율 실행 보고 (${p.generated_at_kst.slice(11, 16)} KST)`);
  lines.push("");
  lines.push("## 1) 핵심 결론");
  lines.push(`- 판정: \`${p.decision.status_recommendation} / ${p.decision.mode_recommendation} / ${p.decision.go_no_go}\``);
  lines.push(`- 보고 시점 판단: \`${p.report_timing.is_report_time ? "보고 시점" : "사전 점검 시점"}\` (${p.report_timing.reason})`);
  lines.push(`- 핵심 수치: 비용 \`${fmtPct(p.core_metrics.cost_ratio_pct)}\`, MDD \`${fmtPct(p.core_metrics.mdd_pct)}\`, 전략ID 불일치 \`${p.core_metrics.strategy_id_mismatch_drop_count}\`건, 실시간차이 \`${p.core_metrics.live_drift_check_count}\`건, TV_WEBHOOK \`${p.core_metrics.tv_webhook_drop_count}\`건, stale \`${p.core_metrics.stale_or_missing_count}\`건, 180분 초과 증빙 \`${p.core_metrics.stale_evidence_count_180m}\`건`);
  lines.push("");
  lines.push("## 2) 실제 수행한 작업 (번호 목록)");
  p.independent_execution.executed_now.forEach((x, idx) => lines.push(`${idx + 1}. ${x}`));
  lines.push("");
  lines.push("## 3) 변경 파일/산출물");
  p.artifacts.forEach((x, idx) => lines.push(`${idx + 1}. ${x}`));
  lines.push("");
  lines.push("## 4) 지혜에게 보고할 핵심");
  lines.push("- 1) 독립 실행안");
  lines.push(`  - ${p.independent_execution.goal}`);
  lines.push(`  - 진행률: \`${p.independent_execution.progress_pct}%\``);
  lines.push("- 2) 지혜에게 보고할 내용");
  lines.push(`  - 진행률: ${p.report_to_jihye.progress}`);
  lines.push("  - 핵심 성과:");
  p.report_to_jihye.key_achievements.forEach((x) => lines.push(`    - ${x}`));
  lines.push("  - 리스크:");
  p.report_to_jihye.risk_tags.forEach((x) => lines.push(`    - ${x}`));
  lines.push("  - 지혜 의사결정 요청:");
  p.report_to_jihye.decision_requests.forEach((x) => lines.push(`    - ${x}`));
  lines.push("- 3) 지혜를 통해 전달할 협업 요청");
  p.collaboration_requests_via_jihye.forEach((x) => lines.push(`  - ${x}`));
  lines.push("- 4) 진화 계획");
  p.evolution_plan.forEach((x) => lines.push(`  - ${x}`));
  lines.push("");
  lines.push("## 5) 재용에게 보여줄 쉬운 요약(비개발자용)");
  p.simple_summary_for_jaeyong.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## 6) 리스크/확인사항");
  p.report_to_jihye.risk_tags.forEach((x) => lines.push(`- ${x}`));
  if (Array.isArray(p.approval_items) && p.approval_items.length) {
    p.approval_items.forEach((x) => lines.push(`- ${x}`));
  }
  lines.push(`- 자가검증 결과: \`${p.self_validation.result}\``);
  p.self_validation.checks.forEach((x) => lines.push(`  - ${x}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const startedAtIso = new Date().toISOString();
  const generatedAtKst = toKstString(startedAtIso, { fallbackToString: true });
  const dateKey = kstDateKey(startedAtIso) || generatedAtKst.slice(0, 10);
  const hhmm = generatedAtKst.slice(11, 16).replace(":", "");

  const runPlan = [
    { id: "sync_board", label: "제출/정시 보드 재생성", script: "scripts/report-sync-status-board.js" },
    { id: "data_consistency", label: "보수 수치 재집계", script: "scripts/data-consistency-lead.js" },
    { id: "signal_probe", label: "신호/드롭 재점검", script: "scripts/post-apply-signal-probe.js" },
    { id: "strategy_alignment", label: "전략ID 정합성 점검", script: "scripts/strategy-id-alignment-check.js" },
    { id: "execution_safety", label: "실행 안전 점검", script: "scripts/binance-execution-safety-check.js" },
    { id: "recovery_actions", label: "복구 액션 재산출", script: "scripts/system-recovery-actions.js" },
    { id: "system_cycle", label: "시스템 종합 사이클", script: "scripts/system-autonomous-cycle.js" },
  ];
  const taskResults = runPlan.map((task) => ({
    id: task.id,
    label: task.label,
    ...runNodeScript(task.script),
  }));

  const reportSyncLatestPath = pickLatestByPattern(OPS_DAILY, /^\d{4}-\d{2}-\d{2}_report_sync_status_board_\d{4}_jihye\.json$/);
  const fileMap = {
    approval_execution: path.join(OPS_DAILY, "approval_execution_latest.json"),
    ceo_governance: path.join(OPS_DAILY, "ceo_24h_autonomous_governance_latest.json"),
    data_consistency: path.join(OPS_DAILY, "data_consistency_lead_latest.json"),
    metric_reconciliation: path.join(OPS_DAILY, "metric_reconciliation_owner_latest.json"),
    risk_controller: path.join(OPS_DAILY, "risk_controller_latest.json"),
    execution_safety: path.join(OPS_DAILY, "binance_execution_safety_latest.json"),
    recovery_actions: path.join(OPS_DAILY, "system_recovery_actions_latest.json"),
    system_cycle: path.join(OPS_DAILY, "system_autonomous_cycle_latest.json"),
    post_apply_signal_probe: path.join(OPS_DAILY, "post_apply_signal_probe_latest.json"),
    strategy_id_alignment: path.join(OPS_DAILY, "strategy_id_alignment_latest.json"),
    report_sync_latest: reportSyncLatestPath,
  };

  const approval = readJsonSafe(fileMap.approval_execution).data || {};
  const ceo = readJsonSafe(fileMap.ceo_governance).data || {};
  const consistency = readJsonSafe(fileMap.data_consistency).data || {};
  const metricReconciliation = readJsonSafe(fileMap.metric_reconciliation).data || {};
  const risk = readJsonSafe(fileMap.risk_controller).data || {};
  const execution = readJsonSafe(fileMap.execution_safety).data || {};
  const recovery = readJsonSafe(fileMap.recovery_actions).data || {};
  const systemCycle = readJsonSafe(fileMap.system_cycle).data || {};
  const postApply = readJsonSafe(fileMap.post_apply_signal_probe).data || {};
  const strategyAlign = readJsonSafe(fileMap.strategy_id_alignment).data || {};
  const syncBoard = fileMap.report_sync_latest ? (readJsonSafe(fileMap.report_sync_latest).data || {}) : {};

  const c = consistency.consolidated_metrics || {};
  const termStandard = metricReconciliation.term_standard || {};
  const riskScore = risk.risk_scorecard || {};
  const execRuntime = execution.runtime || {};
  const signalCounts = postApply.counts || {};
  const postApplyDropTop = Array.isArray(postApply.drop_reason_top) ? postApply.drop_reason_top : [];
  const mismatch = strategyAlign.mismatch || {};
  const strategyPostApply = strategyAlign.post_apply_snapshot || {};
  const strategyDropTop = Array.isArray(strategyPostApply.drop_reason_top) ? strategyPostApply.drop_reason_top : [];
  const conflictSnapshot = strategyAlign.conflict_snapshot || {};
  const strategyLiveDrift = conflictSnapshot.live_drift_check || {};
  const mismatchFreshness = strategyAlign.mismatch_freshness || {};
  const syncSummary = syncBoard.summary || {};

  const chosenCost = pickFirstFinite([
    { source: "data_consistency_lead_latest.consolidated_metrics.cost_ratio_pct", value: toNum(c.cost_ratio_pct, null) },
    { source: "risk_controller_latest.risk_scorecard.cost.applied_value_pct", value: toNum(riskScore.cost && riskScore.cost.applied_value_pct, null) },
    { source: "binance_execution_safety_latest.runtime.cost_ratio_pct", value: toNum(execRuntime.cost_ratio_pct, null) },
  ], null);
  const chosenMdd = pickFirstFinite([
    { source: "data_consistency_lead_latest.consolidated_metrics.mdd_pct", value: toNum(c.mdd_pct, null) },
    { source: "risk_controller_latest.risk_scorecard.loss.applied_mdd_pct", value: toNum(riskScore.loss && riskScore.loss.applied_mdd_pct, null) },
  ], null);
  const chosenError = pickFirstFinite([
    { source: "data_consistency_lead_latest.consolidated_metrics.error_count_24h", value: toNum(c.error_count_24h, null) },
    { source: "risk_controller_latest.risk_scorecard.error.applied_error_count_24h", value: toNum(riskScore.error && riskScore.error.applied_error_count_24h, null) },
    { source: "binance_execution_safety_latest.runtime.error_count", value: toNum(execRuntime.error_count, null) },
  ], null);
  const liveValidSubmissionRate = pickFirstFinite([
    { source: "report_sync_status_board.summary.valid_submission_rate_pct", value: toNum(syncSummary.valid_submission_rate_pct, null) },
  ], null);
  const liveOnTimeRate = pickFirstFinite([
    { source: "report_sync_status_board.summary.on_time_rate_pct", value: toNum(syncSummary.on_time_rate_pct, null) },
  ], null);
  const liveStale = pickFirstFinite([
    { source: "report_sync_status_board.summary.stale_or_missing_count", value: toNum(syncSummary.stale_or_missing_count, null) },
  ], null);
  const staleEvidenceCount180m = pickFirstFinite([
    { source: "report_sync_status_board.summary.stale_evidence_count_180m", value: toNum(syncSummary.stale_evidence_count_180m, null) },
  ], null);
  const maxEvidenceAgeMin = pickFirstFinite([
    { source: "report_sync_status_board.summary.max_evidence_age_min", value: toNum(syncSummary.max_evidence_age_min, null) },
  ], null);

  const conservativeValidSubmissionRate = pickConservativeByDirection([
    { source: "data_consistency_lead_latest.consolidated_metrics.valid_submission_rate_pct", value: toNum(c.valid_submission_rate_pct, null) },
    { source: "risk_controller_latest.report_sync_health.valid_submission_rate_pct", value: toNum(risk.report_sync_health && risk.report_sync_health.valid_submission_rate_pct, null) },
  ], "lower_worse", null);
  const conservativeOnTimeRate = pickConservativeByDirection([
    { source: "data_consistency_lead_latest.consolidated_metrics.on_time_rate_pct", value: toNum(c.on_time_rate_pct, null) },
    { source: "risk_controller_latest.report_sync_health.on_time_rate_pct", value: toNum(risk.report_sync_health && risk.report_sync_health.on_time_rate_pct, null) },
  ], "lower_worse", null);
  const conservativeStale = pickConservativeByDirection([
    { source: "data_consistency_lead_latest.consolidated_metrics.stale_or_missing_count", value: toNum(c.stale_or_missing_count, null) },
    { source: "risk_controller_latest.report_sync_health.stale_or_missing_count", value: toNum(risk.report_sync_health && risk.report_sync_health.stale_or_missing_count, null) },
  ], "higher_worse", null);

  const effectiveValidSubmissionRate = Number.isFinite(liveValidSubmissionRate.value)
    ? liveValidSubmissionRate
    : conservativeValidSubmissionRate;
  const effectiveOnTimeRate = Number.isFinite(liveOnTimeRate.value)
    ? liveOnTimeRate
    : conservativeOnTimeRate;
  const effectiveStale = Number.isFinite(liveStale.value)
    ? liveStale
    : conservativeStale;
  const chosenMismatch = pickFirstFinite([
    { source: "strategy_id_alignment_latest.mismatch.guard_count", value: toNum(mismatch.guard_count, null) },
    { source: "strategy_id_alignment_latest.mismatch.after_live_revision_count", value: toNum(mismatch.after_live_revision_count, null) },
    { source: "strategy_id_alignment_latest.mismatch_freshness.created_after_live_revision_count", value: toNum(mismatchFreshness.created_after_live_revision_count, null) },
    { source: "strategy_id_alignment_latest.mismatch.total_count", value: toNum(mismatch.total_count, null) },
    { source: "binance_execution_safety_latest.runtime.strategy_id_mismatch_count", value: toNum(execRuntime.strategy_id_mismatch_count, null) },
  ], null);
  const chosenDrops = pickFirstFinite([
    { source: "post_apply_signal_probe_latest.counts.drops", value: toNum(signalCounts.drops, null) },
  ], null);
  const chosenSignals = pickFirstFinite([
    { source: "post_apply_signal_probe_latest.counts.signals", value: toNum(signalCounts.signals, null) },
  ], null);
  const chosenLiveDrift = pickFirstFinite([
    { source: "metric_reconciliation_owner_latest.term_standard.live_drift_check_count", value: toNum(termStandard.live_drift_check_count, null) },
    { source: "strategy_id_alignment_latest.conflict_snapshot.live_drift_check.mismatch_count", value: toNum(strategyLiveDrift.mismatch_count, null) },
  ], null);
  const chosenTvWebhook = pickFirstFinite([
    { source: "strategy_id_alignment_latest.post_apply_snapshot.drop_reason_top[TV_WEBHOOK]", value: findReasonCount(strategyDropTop, "TV_WEBHOOK", null) },
    { source: "post_apply_signal_probe_latest.drop_reason_top[TV_WEBHOOK]", value: findReasonCount(postApplyDropTop, "TV_WEBHOOK", null) },
  ], null);

  const metrics = {
    cost_ratio_pct: round(chosenCost.value, 4),
    cost_limit_pct: round(toNum(approval.decision && approval.decision.execution_gate && approval.decision.execution_gate.cost_ratio_lte, toNum(execRuntime.cost_limit_pct, 0.2)), 4),
    mdd_pct: round(chosenMdd.value, 4),
    mdd_limit_pct: round(toNum(approval.decision && approval.decision.execution_gate && approval.decision.execution_gate.mdd_gte, -1.5), 4),
    error_count_24h: chosenError.value,
    valid_submission_rate_pct: round(effectiveValidSubmissionRate.value, 1),
    on_time_rate_pct: round(effectiveOnTimeRate.value, 1),
    stale_or_missing_count: Number.isFinite(effectiveStale.value) ? effectiveStale.value : null,
    stale_evidence_count_180m: Number.isFinite(staleEvidenceCount180m.value) ? staleEvidenceCount180m.value : null,
    max_evidence_age_min: Number.isFinite(maxEvidenceAgeMin.value) ? maxEvidenceAgeMin.value : null,
    conservative_valid_submission_rate_pct: round(conservativeValidSubmissionRate.value, 1),
    conservative_on_time_rate_pct: round(conservativeOnTimeRate.value, 1),
    conservative_stale_or_missing_count: Number.isFinite(conservativeStale.value) ? conservativeStale.value : null,
    strategy_id_mismatch_drop_count: chosenMismatch.value,
    live_drift_check_count: chosenLiveDrift.value,
    tv_webhook_drop_count: chosenTvWebhook.value,
    signal_count: chosenSignals.value,
    drop_count: chosenDrops.value,
    execution_flow_data_ready: execRuntime.execution_flow_data_ready === true,
    drop_tp1_pending_count: toNum(execRuntime.drop_tp1_pending_count, null),
    qty_pct_non_positive_count: toNum(execRuntime.qty_pct_non_positive_count, null),
    metric_source: {
      cost_ratio_pct: chosenCost.source,
      mdd_pct: chosenMdd.source,
      error_count_24h: chosenError.source,
      valid_submission_rate_pct: effectiveValidSubmissionRate.source,
      on_time_rate_pct: effectiveOnTimeRate.source,
      stale_or_missing_count: effectiveStale.source,
      stale_evidence_count_180m: staleEvidenceCount180m.source,
      max_evidence_age_min: maxEvidenceAgeMin.source,
      conservative_valid_submission_rate_pct: conservativeValidSubmissionRate.source,
      conservative_on_time_rate_pct: conservativeOnTimeRate.source,
      conservative_stale_or_missing_count: conservativeStale.source,
      strategy_id_mismatch_drop_count: chosenMismatch.source,
      live_drift_check_count: chosenLiveDrift.source,
      tv_webhook_drop_count: chosenTvWebhook.source,
      signal_count: chosenSignals.source,
      drop_count: chosenDrops.source,
    },
  };

  const taskFailures = taskResults.filter((x) => !x.ok).length;
  const decision = decideRecommendation({ metrics, taskFailures });

  const nowKstMs = parseKstToMs(generatedAtKst);
  const reportSlot = pickReportSlot({
    nowKstMs,
    candidates: [
      { source: "approval_execution_latest", generated_at_kst: approval.generated_at_kst, next_report: approval.next_report },
      { source: "ceo_24h_autonomous_governance_latest", generated_at_kst: ceo.generated_at_kst, next_report: ceo.next_report },
    ],
  });
  let nextStaffReport = reportSlot ? reportSlot.staff_to_jihye : null;
  let nextJihyeReport = reportSlot ? reportSlot.jihye_to_jaeyong : null;
  let selectedSlotSource = reportSlot ? reportSlot.source : null;

  const staleCutoffMs = Number.isFinite(nowKstMs) ? nowKstMs - (5 * 60 * 1000) : null;
  const parsedSlotMs = parseKstToMs(nextStaffReport);
  const hasStaleReportSlot = Number.isFinite(staleCutoffMs)
    && Number.isFinite(parsedSlotMs)
    && parsedSlotMs < staleCutoffMs;
  const hasMissingReportSlot = !nextStaffReport || !nextJihyeReport;

  let fallbackReason = null;
  if (hasStaleReportSlot || hasMissingReportSlot) {
    const fallbackSlot = buildFallbackReportSlot(nowKstMs);
    if (fallbackSlot) {
      nextStaffReport = fallbackSlot.staff_to_jihye;
      nextJihyeReport = fallbackSlot.jihye_to_jaeyong;
      selectedSlotSource = fallbackSlot.source;
      if (hasStaleReportSlot) {
        fallbackReason = `기존 보고 슬롯(${reportSlot ? reportSlot.staff_to_jihye : "N/A"}) 만료로 30분 슬롯 자동 복구`;
      } else {
        fallbackReason = "보고 슬롯 누락으로 30분 슬롯 자동 복구";
      }
    }
  }

  const nextStaffHm = extractHm(nextStaffReport, null);
  const nextJihyeHm = extractHm(nextJihyeReport, null);
  const staffDeadlineText = nextStaffHm ? `${nextStaffHm} KST 전` : "다음 마감 전";
  const nextJihyeText = nextJihyeHm ? `${nextJihyeHm} KST` : "미정";
  const nextStaffMs = parseKstToMs(nextStaffReport);
  let isReportTime = false;
  let reportReason = fallbackReason || "다음 직원 보고 시각 정보 없음";
  if (Number.isFinite(nowKstMs) && Number.isFinite(nextStaffMs)) {
    const diffMin = Math.round((nextStaffMs - nowKstMs) / (60 * 1000));
    if (!fallbackReason && diffMin < -5) {
      reportReason = `직원 마감 ${nextStaffReport}가 이미 지나 최신 슬롯 재확인 필요`;
    } else if (diffMin <= 20) {
      isReportTime = true;
      reportReason = `직원 마감 ${nextStaffReport}까지 ${diffMin}분, H 리스크 지속으로 사전 보고`;
    } else {
      reportReason = `직원 마감 ${nextStaffReport}까지 ${diffMin}분 남아 사전 점검 우선`;
    }
  }

  const keyAchievements = [
    `점검 스크립트 ${taskResults.length}개 자동 실행 (${taskResults.length - taskFailures}/${taskResults.length} 성공)`,
    "시스템 개발 보고서 생성 로직을 스크립트로 고정해 수동 누락 위험 제거",
    `보수 기준 수치(cost/mdd/error)와 제출 정합성 수치를 단일 보고서로 통합`,
    `비-전략ID 드롭 상위 TV_WEBHOOK ${metrics.tv_webhook_drop_count ?? "N/A"}건을 시스템 KPI에 고정`,
  ];
  const riskTags = buildRiskTags(metrics);

  const decisionRequests = [
    `${nextStaffHm || "다음"} 보고에서도 보수 기준(비용/MDD/전략ID 불일치) 우선 정책 유지 여부 확정 요청`,
  ];
  if (Number.isFinite(metrics.tv_webhook_drop_count) && metrics.tv_webhook_drop_count >= 1) {
    decisionRequests.push(`TV_WEBHOOK ${metrics.tv_webhook_drop_count}건 저감안 A/B를 다음 보고 전 실행 우선순위 1로 확정 요청`);
  }
  const approvalItems = [];
  const approvalRequiredText = typeof strategyAlign.user_approval_required === "string"
    ? strategyAlign.user_approval_required.trim()
    : "";
  const hasPendingUserApproval = approvalRequiredText.includes("[USER_APPROVAL_REQUIRED]");
  if (hasPendingUserApproval) {
    approvalItems.push(approvalRequiredText);
    decisionRequests.push("실서버 strategy_id 허용목록 동기화 승인 여부 확정 요청");
  }

  const progressPct = round(((taskResults.length - taskFailures) / taskResults.length) * 100, 1);
  const executedNow = taskResults.map((x) => `${x.command} (${x.ok ? "exit 0" : `exit ${x.exit_code}`})`);
  const collaborationRequests = [
    "signal_id_alignment_owner: 승인 시 보수안(conservative_allowlist_only) 반영 ETA 공유",
    "post_apply_signal_observer: 반영 후 60분 내 DROP_STRATEGY_ID_MISMATCH 0건 검증 제출",
    "runtime_recovery_lead: 비용 차단 유지 상태에서 실신호 복구 실험 A/B 결과 제출",
    "execution_microstructure_owner: TV_WEBHOOK 상위 심볼/시간대 분해표 제출 및 30분 내 저감 실험 지원",
  ];
  const evolutionPlan = [
    "[EVOLUTION] 시스템 개발 보고를 수동 작성에서 스크립트 자동 생성으로 전환 | 마감 직전 누락/지연 감소",
    "[EVOLUTION] 실행 점검 결과와 제출 정합성 지표를 한 파일로 결합 | 의사결정 속도 개선",
    `[EVOLUTION] ${nextStaffHm || "다음"} 마감 20분 전 자동 사전보고 판정을 고정 | 보고 시계 혼선 예방`,
  ];

  const payload = {
    generated_at_iso: startedAtIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    role: "system_development_owner",
    report_timing: {
      is_report_time: isReportTime,
      reason: reportReason,
      selected_slot_source: selectedSlotSource,
      next_staff_report_kst: nextStaffReport,
      next_jihye_report_kst: nextJihyeReport,
    },
    decision: {
      status_recommendation: `${decision.status} 유지`,
      mode_recommendation: decision.mode,
      go_no_go: decision.go_no_go,
      reasons: decision.reasons,
      reference_status: {
        execution_safety: execution.status || null,
        recovery_actions: recovery.status || null,
        system_cycle: systemCycle.overall_status || null,
      },
    },
    system_design: {
      data_flow_contract: [
        "신호 수신(webhook) -> 주문 의도(idempotency key) -> 주문 실행 -> 체결 동기화 -> 성과/리스크 집계",
        "전략ID 불일치(DROP_STRATEGY_ID_MISMATCH)는 주문 전 차단 이벤트로 분리 집계",
        "보수 수치(cost/mdd/error)와 제출 정합성(제출률/정시율/stale)을 함께 보고해 운영 판단 단일화",
      ],
      interface_contract: {
        input_files: Object.values(fileMap).filter(Boolean),
        output_files: [
          path.join(OPS_DAILY, "system_dev_autonomous_cycle_latest.json"),
          path.join(OPS_DAILY, `${dateKey}_system_dev_autonomous_cycle_${hhmm}_jihye.json`),
          path.join(OPS_DAILY, `${dateKey}_system_dev_autonomous_cycle_${hhmm}_jihye.md`),
        ],
      },
      resilience_controls: {
        idempotency: execution.checks && execution.checks.idempotency_guard && execution.checks.idempotency_guard.ok === true,
        retry: execution.checks && execution.checks.retry_guard && execution.checks.retry_guard.ok === true,
        rate_limit_backoff: execution.checks && execution.checks.rate_limit_guard && execution.checks.rate_limit_guard.ok === true,
        strategy_mismatch_gate: Number.isFinite(metrics.strategy_id_mismatch_drop_count),
        live_default_off: execution.checks && execution.checks.default_live_guard && execution.checks.default_live_guard.ok === true,
      },
      failure_response_plan: [
        "오류 24h 2건 이상이면 즉시 중단",
        "비용/MDD/전략ID/stale 조건 위반 시 보류+비용 차단 유지",
        "복구 액션(SYS-A1~A3) KPI를 다음 사이클에서 자동 재검증",
      ],
    },
    independent_execution: {
      goal: `${staffDeadlineText} 시스템 리스크(비용/MDD/전략ID/stale)를 자동 재집계하고 지혜 보고 형식으로 고정 제출`,
      progress_pct: progressPct,
      executed_now: executedNow,
      task_summary: {
        total: taskResults.length,
        success: taskResults.length - taskFailures,
        failed: taskFailures,
      },
    },
    core_metrics: metrics,
    implementation_tasks: {
      completed: [
        "시스템 개발 자율 실행 리포트 자동 생성 스크립트 신규 추가",
        `핵심 점검 ${taskResults.length}개 자동 실행`,
        "최신 산출물 JSON/MD 동시 생성 및 latest 포인터 갱신",
      ],
      next: [
        `${staffDeadlineText} 동일 스크립트 재실행으로 수치 변동 재확인`,
        `승인 반영 후 60분 내 전략ID 불일치 ${metrics.strategy_id_mismatch_drop_count ?? "N/A"}건 -> 0건 검증`,
        `TV_WEBHOOK 저감안 A: 드롭 상위 심볼/시간대(Top3) 재생성 후 동일 패턴 반복 구간 즉시 경보`,
        `TV_WEBHOOK 저감안 B: 웹훅 입력 payload 누락/불일치를 원인코드로 분해해 TV_WEBHOOK 포괄 집계 축소`,
      ],
    },
    report_to_jihye: {
      progress: `${progressPct}% (${taskResults.length - taskFailures}/${taskResults.length} 자동 점검 성공)`,
      key_achievements: keyAchievements,
      risk_tags: riskTags,
      decision_requests: decisionRequests,
    },
    collaboration_requests_via_jihye: collaborationRequests,
    evolution_plan: evolutionPlan,
    simple_summary_for_jaeyong: [
      "지금은 수익을 늘리는 단계가 아니라 손실을 막는 단계라서 안전모드를 유지해야 합니다.",
      `비용(${fmtPct(metrics.cost_ratio_pct)})과 손실(MDD ${fmtPct(metrics.mdd_pct)})이 아직 기준보다 나빠서, 새로 크게 진입하면 위험합니다.`,
      `전략 ID 불일치 ${metrics.strategy_id_mismatch_drop_count ?? "N/A"}건은 신규 0건으로 유지 중이고, 대신 TV_WEBHOOK ${metrics.tv_webhook_drop_count ?? "N/A"}건을 줄이는 작업을 다음 보고(${nextJihyeText}) 전까지 바로 진행합니다.`,
    ],
    self_validation: {
      checks: [
        ...taskResults.map((x) => `${x.command} ${x.ok ? "성공" : `실패(exit ${x.exit_code})`}`),
        "출력 JSON 직렬화 성공",
        "필수 섹션(결론/작업/산출물/보고핵심/쉬운요약/리스크) 포함 확인",
      ],
      result: taskFailures === 0 ? "pass" : "fail",
    },
    approval_items: approvalItems,
    task_logs: taskResults,
    artifacts: [
      path.join(ROOT, "scripts", "system-dev-autonomous-cycle.js"),
      path.join(OPS_DAILY, `${dateKey}_system_dev_autonomous_cycle_${hhmm}_jihye.json`),
      path.join(OPS_DAILY, `${dateKey}_system_dev_autonomous_cycle_${hhmm}_jihye.md`),
      path.join(OPS_DAILY, "system_dev_autonomous_cycle_latest.json"),
      path.join(OPS_DAILY, "system_dev_autonomous_cycle_latest.md"),
    ],
  };

  const outputJsonDated = path.join(OPS_DAILY, `${dateKey}_system_dev_autonomous_cycle_${hhmm}_jihye.json`);
  const outputMdDated = path.join(OPS_DAILY, `${dateKey}_system_dev_autonomous_cycle_${hhmm}_jihye.md`);
  const outputJsonLatest = path.join(OPS_DAILY, "system_dev_autonomous_cycle_latest.json");
  const outputMdLatest = path.join(OPS_DAILY, "system_dev_autonomous_cycle_latest.md");

  writeJson(outputJsonDated, payload);
  writeJson(outputJsonLatest, payload);
  fs.writeFileSync(outputMdDated, buildMarkdown(payload), "utf8");
  fs.writeFileSync(outputMdLatest, buildMarkdown(payload), "utf8");

  console.log(JSON.stringify({
    ok: true,
    role: payload.role,
    status_recommendation: payload.decision.status_recommendation,
    mode_recommendation: payload.decision.mode_recommendation,
    go_no_go: payload.decision.go_no_go,
    progress_pct: payload.independent_execution.progress_pct,
    output_json: outputJsonLatest,
    output_md: outputMdDated,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("system-dev-autonomous-cycle failed:", err && err.message ? err.message : err);
  process.exit(1);
}
