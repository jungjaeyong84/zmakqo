#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  updateLatestGeneratedPine,
  openPineFileForReview,
} = require("./lib/pine-file-ops");

loadLocalEnv();

function resolveLatestArtifactPath(...names) {
  for (const name of names) {
    const filePath = path.join(OPS_DAILY_DIR, name);
    if (fs.existsSync(filePath)) return filePath;
  }
  return path.join(OPS_DAILY_DIR, names[0]);
}

const CHANGE_CONTROL_LATEST_PATH = resolveLatestArtifactPath("pine_quality_change_control_latest.json", "pine_stage1_change_control_latest.json");
const OBJECTIVE_SUPERVISOR_LATEST_PATH = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");
const CODEX_PATCH_LATEST_PATH = path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json");
const STATE_PATH = path.join(OPS_DAILY_DIR, "rollback_monitor_state.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "rollback_monitor_latest.md");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "rollback_monitor_latest.json");
const CODEX_PATCH_MAX_AGE_HOURS = Math.max(6, Number(process.env.CODEX_PATCH_REVIEW_MAX_AGE_HOURS || 36));

function renderMarkdown(report = {}) {
  return [
    "# Rollback Monitor",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- verdict: ${report.verdict || "N/A"}`,
    `- reason: ${report.reason || "N/A"}`,
    `- rollback_file_path: ${report.rollback_file_path || "N/A"}`,
    `- latest_alias_path: ${report.latest_alias_path || "N/A"}`,
    `- opened: ${report.opened ? "YES" : "NO"}`,
    `- open_method: ${report.open_method || "N/A"}`,
    "",
    "## Inputs",
    `- objective supervisor: ${report.objective_supervisor_verdict || "N/A"}`,
    `- change control: ${report.change_control_reason || "N/A"}`,
    `- codex patch review: ${report.codex_verdict || "N/A"}`,
  ].join("\n") + "\n";
}

function evaluateRollbackMonitor({
  rollback = {},
  rollbackFilePath = null,
  codexFresh = false,
  codexVerdict = "HOLD",
  codexRollbackPath = null,
  state = {},
} = {}) {
  const codexAllowsRollback = codexFresh && codexVerdict === "ROLLBACK"
    && (!codexRollbackPath || codexRollbackPath === rollbackFilePath);

  let verdict = "HOLD";
  let reason = "ROLLBACK_NOT_READY";
  let latestAliasPath = null;
  let opened = false;
  let openMethod = null;

  if (rollback.ready === true && rollbackFilePath) {
    if (!codexFresh) {
      verdict = "HOLD";
      reason = "CODEX_REVIEW_REQUIRED_ROLLBACK";
    } else if (!codexAllowsRollback) {
      verdict = "HOLD";
      reason = "CODEX_REVIEW_BLOCK_ROLLBACK";
    } else if (state.rollback_file_path === rollbackFilePath && state.prepared_at) {
      verdict = "ROLLBACK_PREPARED";
      reason = "ALREADY_PREPARED";
      latestAliasPath = state.latest_alias_path || null;
      openMethod = state.open_method || null;
      opened = !!openMethod;
    } else {
      latestAliasPath = updateLatestGeneratedPine(rollbackFilePath);
      const openResult = openPineFileForReview(rollbackFilePath);
      opened = openResult.ok === true;
      openMethod = openResult.method || openResult.error || null;
      verdict = opened ? "ROLLBACK_PREPARED" : "ROLLBACK_READY";
      reason = opened ? "ROLLBACK_FILE_OPENED" : "ROLLBACK_FILE_PREPARED";
    }
  }

  return {
    verdict,
    reason,
    latestAliasPath,
    opened,
    openMethod,
    writeState: verdict === "ROLLBACK_PREPARED" && rollbackFilePath && state.rollback_file_path !== rollbackFilePath,
  };
}

async function main() {
  const nowMeta = nowKstMeta();
  const changeControl = readJsonRawSafe(CHANGE_CONTROL_LATEST_PATH, null) || {};
  const objectiveSupervisor = readJsonRawSafe(OBJECTIVE_SUPERVISOR_LATEST_PATH, null) || {};
  const codexPatch = readJsonRawSafe(CODEX_PATCH_LATEST_PATH, null) || {};
  const state = readJsonRawSafe(STATE_PATH, {}) || {};

  let codexFresh = false;
  try {
    const st = fs.statSync(CODEX_PATCH_LATEST_PATH);
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    codexFresh = Number.isFinite(ageHours) && ageHours <= CODEX_PATCH_MAX_AGE_HOURS;
  } catch (_err) {
    codexFresh = false;
  }

  const rollback = changeControl.auto_rollback || {};
  const rollbackFilePath = String(rollback.rollback_file_path || "").trim() || null;
  const codexVerdict = String(codexPatch.verdict || "HOLD").toUpperCase();
  const codexRollbackPath = String(codexPatch.recommended_rollback_file_path || "").trim() || null;
  const decision = evaluateRollbackMonitor({
    rollback,
    rollbackFilePath,
    codexFresh,
    codexVerdict,
    codexRollbackPath,
    state,
  });
  let { verdict, reason, latestAliasPath, opened, openMethod } = decision;

  if (decision.writeState) {
    writeJson(STATE_PATH, {
      rollback_file_path: rollbackFilePath,
      latest_alias_path: latestAliasPath,
      open_method: openMethod,
      prepared_at: nowMeta.kst,
    });
  }

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    verdict,
    reason,
    rollback_file_path: rollbackFilePath,
    latest_alias_path: latestAliasPath,
    opened,
    open_method: openMethod,
    objective_supervisor_verdict: String(objectiveSupervisor.verdict || "N/A"),
    change_control_reason: String(rollback.reason || "N/A"),
    codex_verdict: `${codexVerdict}${codexFresh ? "" : " (stale)"}${codexRollbackPath ? ` / ${codexRollbackPath}` : ""}`,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_rollback_monitor.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_rollback_monitor.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const alert = await sendKoreanTelegramSummary({
    title: `[자동 롤백 점검] ${report.verdict}`,
    severity: report.verdict === "ROLLBACK_PREPARED" ? "WARN" : "INFO",
    sections: [
      { header: "현재 상태", lines: [`자동 롤백 준비 상태는 ${report.verdict} 입니다. 사유는 ${report.reason} 입니다.`] },
      { header: "준비된 파일", lines: [report.rollback_file_path || "현재 준비된 롤백 파일이 없습니다.", report.latest_alias_path || "현재 최신 alias 정보가 없습니다."] },
      { header: "판단 근거", lines: [`목표 감독관 ${report.objective_supervisor_verdict}`, `변경 제어 ${report.change_control_reason}`, `Codex 검토 ${report.codex_verdict}`] },
      { header: "파일 열기 상태", lines: [report.open_method || "파일을 연 기록이 없습니다."] },
    ],
  });
  if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "SKIP_ALERT"))) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
  }

  console.log(JSON.stringify({
    ok: true,
    verdict: report.verdict,
    reason: report.reason,
    rollback_file_path: report.rollback_file_path,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    evaluateRollbackMonitor,
  },
};
