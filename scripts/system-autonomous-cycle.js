#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

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

function runTask(repoRoot, task) {
  const startedAtIso = new Date().toISOString();
  const res = spawnSync(task.bin, task.args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const endedAtIso = new Date().toISOString();
  const stdout = String(res.stdout || "");
  const stderr = String(res.stderr || "");
  const parsed = parseLastJsonObject(stdout);

  return {
    id: task.id,
    label: task.label,
    command: `${task.bin} ${task.args.join(" ")}`,
    started_at_iso: startedAtIso,
    ended_at_iso: endedAtIso,
    ok: res.status === 0,
    exit_code: res.status,
    summary: parsed,
    stdout_tail: stdout.trim().split("\n").slice(-15),
    stderr_tail: stderr.trim().split("\n").slice(-15),
  };
}

function computeOverallStatus(tasks) {
  let status = "진행";
  const reasons = [];

  for (const task of tasks) {
    if (!task.ok) {
      status = "중단";
      reasons.push(`${task.id} 실행 실패(exit ${task.exit_code})`);
      continue;
    }
    const summary = task.summary && typeof task.summary === "object" ? task.summary : {};
    const signal = String(
      summary.status
      || summary.mode
      || summary.decision
      || ""
    ).trim();
    if (signal === "중단") {
      status = "중단";
      reasons.push(`${task.id} 결과 중단`);
      continue;
    }
    if (status !== "중단" && (signal === "보류" || signal === "비용 차단")) {
      status = "보류";
      reasons.push(`${task.id} 결과 ${signal}`);
    }
  }

  if (!reasons.length) reasons.push("모든 자동 점검 진행 가능");
  return { status, reasons };
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const nowIso = new Date().toISOString();
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });

  const tasks = [
    { id: "execution_quality", label: "실행 품질 리포트", bin: "node", args: ["scripts/report-best-self-evolution-execution-quality.js"] },
    { id: "signal_lineage_health", label: "시그널 라인리지 건강도", bin: "node", args: ["scripts/report-signal-lineage-health.js"] },
    { id: "system_runtime_guards", label: "시스템 런타임 가드", bin: "node", args: ["scripts/run-system-runtime-guards.js"] },
    { id: "trail_authority_feedback", label: "트레일 권한 피드백", bin: "node", args: ["scripts/run-trail-authority-feedback.js"] },
    { id: "trail_runner_floor_audit", label: "트레일 floor 감사", bin: "node", args: ["scripts/report-trail-runner-floor-audit.js"] },
    { id: "binance_exit_qty_contract_audit", label: "Binance exit 수량 계약 감사", bin: "node", args: ["scripts/report-binance-exit-qty-contract-audit.js"] },
    { id: "openclaw_policy_authority", label: "OpenClaw 정책 권한 리포트", bin: "node", args: ["scripts/report-openclaw-policy-authority.js"] },
    { id: "runtime_error_family_remediation", label: "런타임 오류 family remediation", bin: "node", args: ["scripts/runtime-error-family-remediation.js"] },
    { id: "ml_ops_pipeline", label: "ML 운영 파이프라인", bin: "node", args: ["scripts/run-ml-ops-pipeline.js"] },
    { id: "system_ops", label: "시스템 운영 점검", bin: "node", args: ["scripts/daily-system-ops-check.js"] },
    { id: "improvement_pack", label: "슬리피지 원천 팩 생성", bin: "node", args: ["scripts/build-improvement-pack-local.js"] },
    { id: "failure_mode", label: "실패 모드 사전점검", bin: "node", args: ["scripts/qa-failure-mode-precheck.js"] },
    { id: "performance", label: "성과 분석", bin: "node", args: ["scripts/daily-performance-analysis.js"] },
    { id: "execution_safety", label: "바이낸스 실행 안전 점검", bin: "node", args: ["scripts/binance-execution-safety-check.js"] },
    { id: "recovery_actions", label: "시스템 복구 액션 패키지", bin: "node", args: ["scripts/system-recovery-actions.js"] },
  ];

  const results = tasks.map((task) => runTask(repoRoot, task));
  const overall = computeOverallStatus(results);

  const summary = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    overall_status: overall.status,
    reasons: overall.reasons,
    completed_tasks: results.filter((r) => r.ok).length,
    total_tasks: results.length,
    tasks: results.map((r) => ({
      id: r.id,
      label: r.label,
      ok: r.ok,
      exit_code: r.exit_code,
      status: r.summary && (r.summary.status || r.summary.decision || null),
      mode: r.summary && r.summary.mode ? r.summary.mode : null,
      output_json: r.summary && r.summary.output_json ? r.summary.output_json : null,
      output_md: r.summary && r.summary.output_md ? r.summary.output_md : null,
    })),
    task_logs: results,
  };

  const outLatest = path.join(repoRoot, "ops", "daily", "system_autonomous_cycle_latest.json");
  const outDated = path.join(repoRoot, "ops", "daily", `${dateKey}_system_autonomous_cycle_jihye.json`);
  fs.writeFileSync(outLatest, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(outDated, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    overall_status: summary.overall_status,
    completed_tasks: summary.completed_tasks,
    total_tasks: summary.total_tasks,
    reasons: summary.reasons,
    output_latest: outLatest,
    output_dated: outDated,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("system-autonomous-cycle failed:", err && err.message ? err.message : err);
  process.exit(1);
}
