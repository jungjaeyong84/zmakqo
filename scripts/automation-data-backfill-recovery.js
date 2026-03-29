#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { execSync } = require("child_process");
const {
  OPS_DAILY_DIR,
  REPO_ROOT,
  copyLatest,
  ensureDir,
  loadLocalEnv,
  nowKstMeta,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "data_backfill_recovery_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "data_backfill_recovery_latest.md");
const REASON = String(process.env.DATA_BACKFILL_REASON || "MANUAL_OR_WATCHDOG").trim() || "MANUAL_OR_WATCHDOG";
const PROVIDER = String(process.env.DATA_BACKFILL_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const STEP_TIMEOUT_MS = Math.max(30_000, Number(process.env.DATA_BACKFILL_STEP_TIMEOUT_MS || 180_000));

const STEPS = Object.freeze([
  { id: "refresh_cache_1", label: "analytics cache refresh", cmd: "node scripts/refresh-analytics-local-cache.js" },
  { id: "signal_integrity", label: "signal data integrity repair", cmd: "node scripts/automation-signal-data-integrity.js" },
  { id: "refresh_cache_2", label: "analytics cache refresh (post-repair)", cmd: "node scripts/refresh-analytics-local-cache.js" },
  { id: "stage_ledgers", label: "stage outcome ledgers rebuild", cmd: "node scripts/automation-stage-outcome-ledgers.js" },
  { id: "weekly_governance", label: "weekly governance rebuild", cmd: "node scripts/automation-weekly-filter-governance.js" },
  { id: "objective_supervisor", label: "objective supervisor refresh", cmd: "node scripts/automation-objective-supervisor.js" },
  { id: "stage_autopilot", label: "stage autopilot refresh", cmd: "node scripts/automation-stage-autopilot.js" },
]);

function renderMarkdown(report) {
  const lines = [
    "# Data Backfill Recovery",
    "",
    `- 실행 시각: ${report.generated_at_kst}`,
    `- provider: ${report.provider}`,
    `- reason: ${report.reason}`,
    `- verdict: ${report.verdict}`,
    `- succeeded: ${report.succeeded_n}/${report.total_n}`,
    "",
    "## Steps",
  ];
  for (const row of report.steps) {
    lines.push(`- ${row.id}: ${row.ok ? "OK" : "FAIL"} / ${row.label}`);
    if (row.error) lines.push(`  - error: ${row.error}`);
  }
  return `${lines.join("\n")}\n`;
}

function runStep(cmd) {
  try {
    const out = execSync(cmd, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
      timeout: STEP_TIMEOUT_MS,
    });
    return { ok: true, text: out };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? String(err.message) : "EXEC_FAILED",
      text: err && err.stdout ? String(err.stdout) : "",
      stderr: err && err.stderr ? String(err.stderr) : "",
    };
  }
}

async function main() {
  loadLocalEnv();
  ensureDir(OPS_DAILY_DIR);
  const meta = nowKstMeta();
  const steps = [];

  for (const spec of STEPS) {
    const res = runStep(spec.cmd);
    steps.push({
      id: spec.id,
      label: spec.label,
      cmd: spec.cmd,
      ok: !!res.ok,
      error: res.ok ? null : String(res.error || "EXEC_FAILED"),
      stdout_tail: String(res.text || "").trim().split(/\r?\n/).filter(Boolean).slice(-8),
      stderr_tail: String(res.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-8),
    });
    if (!res.ok) break;
  }

  const succeededN = steps.filter((row) => row.ok).length;
  const verdict = succeededN === STEPS.length ? "RECOVERED" : "FAILED";
  const report = {
    generated_at_kst: meta.kst,
    provider: PROVIDER,
    reason: REASON,
    verdict,
    total_n: STEPS.length,
    succeeded_n: succeededN,
    steps,
  };

  const base = `${meta.dateKey}_${meta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_data_backfill_recovery.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_data_backfill_recovery.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const alert = await sendKoreanTelegramSummary({
    title: `[데이터 누락 복구] ${verdict}`,
    provider: PROVIDER,
    severity: verdict === "RECOVERED" ? "INFO" : "WARN",
    dedupeKey: `data_backfill_recovery:${REASON}:${verdict}`,
    dedupeWindowSec: 2 * 60 * 60,
    dedupeFingerprint: JSON.stringify({
      reason: REASON,
      verdict,
      failedStep: steps.find((row) => !row.ok)?.id || null,
    }),
    sections: [
      { header: "복구 결과", lines: [`복구를 시작한 이유: ${REASON}`, `끝난 단계: ${succeededN}/${STEPS.length}`, `최종 상태: ${verdict}`] },
      { header: "실행한 순서", lines: steps.map((row) => `${row.label}: ${row.ok ? "정상 완료" : `실패 (${row.error})`}`) },
    ],
  });
  if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "DEDUPED"))) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
  }

  if (verdict !== "RECOVERED") {
    throw new Error(`DATA_BACKFILL_RECOVERY_FAILED:${steps.find((row) => !row.ok)?.id || "UNKNOWN"}`);
  }

  console.log(JSON.stringify({
    ok: true,
    verdict,
    reason: REASON,
    jsonPath,
    mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-data-backfill-recovery failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    STEPS,
  },
};
