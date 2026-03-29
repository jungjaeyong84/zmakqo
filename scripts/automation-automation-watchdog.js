#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  REPO_ROOT,
  copyLatest,
  ensureDir,
  execText,
  loadLocalEnv,
  nowKstMeta,
  readJsonSafe,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();
ensureDir(OPS_DAILY_DIR);
ensureDir(OPS_RUNTIME_DIR);

const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "automation_watchdog_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "automation_watchdog_latest.md");
const STATE_PATH = path.join(OPS_RUNTIME_DIR, "automation_watchdog_state.json");
const DATA_BACKFILL_SCRIPT = path.join(REPO_ROOT, "ops", "launchd", "run_data_backfill_recovery.sh");
const DATA_BACKFILL_LATEST_JSON = path.join(OPS_DAILY_DIR, "data_backfill_recovery_latest.json");
const DATA_BACKFILL_MIN_INTERVAL_MS = 30 * 60 * 1000;

const ARTIFACT_SPECS = Object.freeze([
  { name: "analytics_local_cache_refresh", filePath: path.join(OPS_DAILY_DIR, "analytics_local_cache_refresh_latest.json"), maxAgeHours: 4, severity: "WARN" },
  { name: "objective_retrospective", filePath: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"), maxAgeHours: 30, severity: "FAIL" },
  { name: "objective_supervisor", filePath: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"), maxAgeHours: 8, severity: "FAIL" },
  { name: "rollback_monitor", filePath: path.join(OPS_DAILY_DIR, "rollback_monitor_latest.json"), maxAgeHours: 8, severity: "FAIL" },
  { name: "signal_data_integrity", filePath: path.join(OPS_DAILY_DIR, "signal_data_integrity_latest.json"), maxAgeHours: 8, severity: "FAIL" },
  { name: "stage_autopilot", filePath: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"), maxAgeHours: 8, severity: "FAIL" },
  { name: "stage_outcome_ledgers", filePath: path.join(OPS_DAILY_DIR, "stage_outcome_ledgers_latest.json"), maxAgeHours: 8, severity: "WARN" },
  { name: "filter_shadow_canary", filePath: path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json"), maxAgeHours: 12, severity: "WARN" },
  { name: "ml_filter_policy", filePath: path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json"), maxAgeHours: 12, severity: "WARN" },
  { name: "weekly_filter_governance", filePath: path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json"), maxAgeHours: 36, severity: "WARN" },
  { name: "ev_tp1_threshold_tune", filePath: path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json"), maxAgeHours: 96, severity: "WARN" },
  { name: "wait_one_bar_tune", filePath: path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"), maxAgeHours: 144, severity: "WARN" },
  { name: "codex_weekly_patch_engine", filePath: path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json"), maxAgeHours: 192, severity: "WARN" },
]);

const AGENT_SPECS = Object.freeze([
  { label: "com.jeongjaeyong.donbeolja.objectiveretrospective", severity: "FAIL" },
  { label: "com.jeongjaeyong.donbeolja.objectivesupervisor", severity: "FAIL" },
  { label: "com.jeongjaeyong.donbeolja.rollbackmonitor", severity: "FAIL" },
  { label: "com.jeongjaeyong.donbeolja.stageautopilot", severity: "FAIL" },
  { label: "com.jeongjaeyong.donbeolja.signaldataintegrity", severity: "FAIL" },
  { label: "com.jeongjaeyong.donbeolja.analyticscache", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.stageoutcomeledgers", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.codexweeklypatch", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.filtershadowcanary", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.hourlyguard", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.mlfilterpolicy", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.evtp1tune", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.waitonebartune", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.weeklyfilters", severity: "WARN" },
  { label: "com.jeongjaeyong.donbeolja.weeklypine", severity: "WARN" },
]);

function ageHoursFromStat(stat) {
  return (Date.now() - Number(stat.mtimeMs || 0)) / (60 * 60 * 1000);
}

function assessArtifact(spec) {
  if (!fs.existsSync(spec.filePath)) {
    return {
      ...spec,
      exists: false,
      fresh: false,
      ageHours: null,
      issueCode: `${spec.name.toUpperCase()}_MISSING`,
      issueSeverity: spec.severity,
    };
  }
  const st = fs.statSync(spec.filePath);
  const ageHours = ageHoursFromStat(st);
  const fresh = Number.isFinite(ageHours) && ageHours <= spec.maxAgeHours;
  return {
    ...spec,
    exists: true,
    fresh,
    ageHours,
    mtimeMs: Number(st.mtimeMs || 0),
    issueCode: fresh ? null : `${spec.name.toUpperCase()}_STALE`,
    issueSeverity: fresh ? null : spec.severity,
  };
}

function parseLaunchctlList(text) {
  const out = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const label = parts[parts.length - 1];
    const lastExitRaw = parts[parts.length - 2];
    const pidRaw = parts[parts.length - 3];
    const pid = pidRaw === "-" ? null : Number(pidRaw);
    const lastExit = lastExitRaw === "-" ? null : Number(lastExitRaw);
    out.set(label, {
      label,
      pid: Number.isFinite(pid) ? pid : null,
      lastExit: Number.isFinite(lastExit) ? lastExit : null,
    });
  }
  return out;
}

function assessAgent(spec, launchctlRows) {
  const row = launchctlRows.get(spec.label);
  if (!row) {
    return {
      ...spec,
      loaded: false,
      pid: null,
      lastExit: null,
      issueCode: `${spec.label}_MISSING`,
      issueSeverity: spec.severity,
    };
  }
  const badExit = Number.isFinite(row.lastExit) && row.lastExit !== 0;
  return {
    ...spec,
    loaded: true,
    pid: row.pid,
    lastExit: row.lastExit,
    issueCode: badExit ? `${spec.label}_EXIT_${row.lastExit}` : null,
    issueSeverity: badExit ? spec.severity : null,
  };
}

function buildIssueSignature(artifactRows, agentRows) {
  const issues = [];
  for (const row of artifactRows) {
    if (row.issueCode) issues.push(`${row.issueSeverity}:${row.issueCode}`);
  }
  for (const row of agentRows) {
    if (row.issueCode) issues.push(`${row.issueSeverity}:${row.issueCode}`);
  }
  return issues.sort().join("|");
}

function computeVerdict(artifactRows, agentRows) {
  const severities = [...artifactRows, ...agentRows]
    .map((row) => row.issueSeverity)
    .filter(Boolean);
  if (severities.includes("FAIL")) return "FAIL";
  if (severities.includes("WARN")) return "WARN";
  return "PASS";
}

function normalizeRecoveryMode(raw) {
  const mode = String(raw || "").trim().toUpperCase();
  if (mode === "DETECT_ONLY" || mode === "REPORT_ONLY" || mode === "RECOVER_AND_REPORT") {
    return mode;
  }
  return "REPORT_ONLY";
}

function isRecoveryExecutionAllowed(mode, rawAllow) {
  if (normalizeRecoveryMode(mode) !== "RECOVER_AND_REPORT") return false;
  const flag = String(rawAllow || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

function buildSnapshot(artifactRows, agentRows) {
  const issues = [
    ...artifactRows.filter((row) => row.issueCode).map((row) => ({ severity: row.issueSeverity, code: row.issueCode })),
    ...agentRows.filter((row) => row.issueCode).map((row) => ({ severity: row.issueSeverity, code: row.issueCode })),
  ];
  return {
    verdict: computeVerdict(artifactRows, agentRows),
    issues,
    issueCount: issues.length,
    issueSignature: buildIssueSignature(artifactRows, agentRows),
  };
}

function readArtifactReport(filePath) {
  return readJsonSafe(filePath, null);
}

function buildDataBackfillTriggers(artifactRows) {
  const triggers = [];
  for (const row of artifactRows) {
    if (!["analytics_local_cache_refresh", "signal_data_integrity", "stage_outcome_ledgers"].includes(row.name)) continue;
    if (row.issueCode) triggers.push(row.issueCode);
  }
  const integrityRow = artifactRows.find((row) => row.name === "signal_data_integrity");
  const integrityData = integrityRow && integrityRow.exists ? readArtifactReport(integrityRow.filePath) : null;
  if (integrityData && String(integrityData.verdict || "").trim().toUpperCase() === "WARN") {
    triggers.push("SIGNAL_DATA_INTEGRITY_WARN");
  }
  return Array.from(new Set(triggers));
}

function summarizeBackfillRecovery(report) {
  if (!report || typeof report !== "object") return null;
  const steps = Array.isArray(report.steps) ? report.steps : [];
  return {
    generated_at_kst: report.generated_at_kst || null,
    reason: String(report.reason || "").trim() || null,
    verdict: String(report.verdict || "").trim() || null,
    succeeded_n: Number(report.succeeded_n || 0),
    total_n: Number(report.total_n || 0),
    failed_step: (steps.find((row) => !row.ok) || {}).id || null,
    completed_steps: steps.filter((row) => row && row.ok).map((row) => String(row.id || "").trim()).filter(Boolean),
  };
}

function shouldAttemptBackfill(previous, triggerSignature) {
  if (!triggerSignature) return false;
  const lastAttemptMs = Number(previous && previous.last_backfill_attempt_ms || 0);
  const lastSignature = String(previous && previous.last_backfill_issue_signature || "");
  const nowMs = Date.now();
  if (!lastAttemptMs || (nowMs - lastAttemptMs) >= DATA_BACKFILL_MIN_INTERVAL_MS) return true;
  return lastSignature !== triggerSignature;
}

function renderMarkdown(report) {
  const preRecovery = report.pre_recovery || {
    verdict: report.verdict,
    issueCount: report.issue_count,
    issueSignature: report.issue_signature,
  };
  const postRecovery = report.post_recovery || null;
  const lines = [
    "# Automation Watchdog",
    "",
    `- 실행 시각: ${report.generated_at_kst}`,
    `- recovery_mode: ${report.recovery_mode || "REPORT_ONLY"}`,
    `- verdict: ${preRecovery.verdict}`,
    `- issue_count: ${preRecovery.issueCount}`,
  ];
  if (report.data_backfill_recovery && report.data_backfill_recovery.attempted) {
    lines.push(`- data_backfill_recovery: ${report.data_backfill_recovery.ok ? "OK" : `FAIL (${report.data_backfill_recovery.error})`}`);
    lines.push(`- backfill_reason: ${report.data_backfill_recovery.reason || "N/A"}`);
    if (report.data_backfill_recovery.summary) {
      lines.push(`- backfill_steps: ${report.data_backfill_recovery.summary.succeeded_n}/${report.data_backfill_recovery.summary.total_n}`);
      lines.push(`- backfill_latest: ${report.data_backfill_recovery.summary.generated_at_kst || "N/A"}`);
    }
    if (postRecovery) {
      lines.push(`- pre_recovery_verdict: ${preRecovery.verdict} (${preRecovery.issueCount})`);
      lines.push(`- post_recovery_verdict: ${postRecovery.verdict} (${postRecovery.issueCount})`);
    }
  }
  lines.push("", "## Artifacts");
  for (const row of report.artifacts) {
    lines.push(`- ${row.name}: ${row.exists ? (row.fresh ? "fresh" : "stale") : "missing"} / age=${row.ageHours == null ? "N/A" : row.ageHours.toFixed(2)}h / max=${row.maxAgeHours}h`);
  }
  lines.push("", "## Launchd");
  for (const row of report.launchd) {
    lines.push(`- ${row.label}: ${row.loaded ? "loaded" : "missing"} / exit=${row.lastExit == null ? "N/A" : row.lastExit} / pid=${row.pid == null ? "-" : row.pid}`);
  }
  lines.push("", "## Issues");
  if (report.issues.length) {
    for (const row of report.issues) lines.push(`- [${row.severity}] ${row.code}`);
  } else {
    lines.push("- none");
  }
  if (postRecovery && Array.isArray(report.issues_post_recovery)) {
    lines.push("", "## Post Recovery Issues");
    if (report.issues_post_recovery.length) {
      for (const row of report.issues_post_recovery) lines.push(`- [${row.severity}] ${row.code}`);
    } else {
      lines.push("- none");
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const meta = nowKstMeta();
  const launchctlRes = execText("launchctl list");
  const launchctlRows = parseLaunchctlList(launchctlRes.ok ? launchctlRes.text : "");
  const previous = readJsonSafe(STATE_PATH, { last_verdict: "PASS", last_issue_signature: "" }) || { last_verdict: "PASS", last_issue_signature: "" };
  const recoveryMode = normalizeRecoveryMode(process.env.AUTOMATION_WATCHDOG_RECOVERY_MODE || "REPORT_ONLY");
  const recoveryAllowed = isRecoveryExecutionAllowed(recoveryMode, process.env.AUTOMATION_WATCHDOG_ALLOW_RECOVERY);

  const artifactRows = ARTIFACT_SPECS.map(assessArtifact);
  const agentRows = AGENT_SPECS.map((spec) => assessAgent(spec, launchctlRows));
  const preSnapshot = buildSnapshot(artifactRows, agentRows);

  let postArtifactRows = artifactRows;
  let postAgentRows = agentRows;
  let postSnapshot = null;
  let recovery = {
    mode: recoveryMode,
    allowed: recoveryAllowed,
    attempted: false,
    ok: null,
    reason: null,
    error: null,
    summary: null,
  };
  const backfillTriggers = buildDataBackfillTriggers(artifactRows);
  const backfillTriggerSignature = backfillTriggers.sort().join("|");
  if (recoveryAllowed && shouldAttemptBackfill(previous, backfillTriggerSignature) && fs.existsSync(DATA_BACKFILL_SCRIPT)) {
    const recoveryRes = execText(`DATA_BACKFILL_REASON='${backfillTriggerSignature}' '${DATA_BACKFILL_SCRIPT}'`, {
      cwd: REPO_ROOT,
      maxBuffer: 30 * 1024 * 1024,
    });
    const latestRecovery = summarizeBackfillRecovery(readArtifactReport(DATA_BACKFILL_LATEST_JSON));
    recovery = {
      mode: recoveryMode,
      allowed: recoveryAllowed,
      attempted: true,
      ok: !!recoveryRes.ok,
      reason: backfillTriggerSignature,
      error: recoveryRes.ok ? null : String(recoveryRes.error || "BACKFILL_EXEC_FAILED"),
      summary: latestRecovery,
    };
    postArtifactRows = ARTIFACT_SPECS.map(assessArtifact);
    postAgentRows = AGENT_SPECS.map((spec) => assessAgent(spec, launchctlRows));
    postSnapshot = buildSnapshot(postArtifactRows, postAgentRows);
  }

  const report = {
    generated_at_kst: meta.kst,
    recovery_mode: recoveryMode,
    recovery_allowed: recoveryAllowed,
    verdict: preSnapshot.verdict,
    issue_count: preSnapshot.issueCount,
    issue_signature: preSnapshot.issueSignature,
    data_backfill_recovery: recovery,
    artifacts: artifactRows,
    launchd: agentRows,
    artifacts_post_recovery: recovery.attempted ? postArtifactRows : null,
    launchd_post_recovery: recovery.attempted ? postAgentRows : null,
    issues: preSnapshot.issues,
    issues_post_recovery: postSnapshot ? postSnapshot.issues : null,
    pre_recovery: preSnapshot,
    post_recovery: postSnapshot,
    previous: previous,
  };

  const base = `${meta.dateKey}_${meta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_automation_watchdog.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_automation_watchdog.md`);
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const shouldAlert = recoveryMode !== "DETECT_ONLY"
    && (preSnapshot.verdict !== "PASS" || String(previous.last_verdict || "") !== "PASS");
  if (shouldAlert) {
    const alertResult = await sendKoreanTelegramSummary({
      title: `[자동화 상태 점검] ${preSnapshot.verdict}`,
      severity: preSnapshot.verdict === "FAIL" ? "WARN" : "INFO",
      dedupeKey: `automation_watchdog:${preSnapshot.verdict}:${preSnapshot.issueSignature || "PASS"}`,
      dedupeWindowSec: 6 * 60 * 60,
      dedupeFingerprint: JSON.stringify({ verdict: preSnapshot.verdict, issueSignature: preSnapshot.issueSignature }),
      sections: [
        {
          header: "전체 상태",
          lines: [
            `자동화 전체 상태는 ${preSnapshot.verdict} 입니다.`,
            `문제가 잡힌 항목은 ${preSnapshot.issueCount}건입니다.`,
            `복구 모드는 ${recoveryMode} 입니다.`,
          ],
        },
        {
          header: "핵심 이슈",
          lines: preSnapshot.issues.length ? preSnapshot.issues.slice(0, 6).map((row) => `[${row.severity}] ${row.code}`) : ["지금은 바로 조치할 이슈가 없습니다."],
        },
        ...(recovery && recovery.attempted ? [{
          header: "백필 복구",
          lines: [
            `복구 발동 이유: ${recovery.reason || "정보 없음"}`,
            `복구 결과: ${recovery.ok ? "정상적으로 끝났습니다." : `실패했습니다. (${recovery.error || "원인 불명"})`}`,
            `완료된 단계 수: ${recovery.summary ? `${recovery.summary.succeeded_n}/${recovery.summary.total_n}` : "정보 없음"}`,
            `복구 전 verdict: ${preSnapshot.verdict} (${preSnapshot.issueCount}건)`,
            ...(postSnapshot ? [`복구 후 verdict: ${postSnapshot.verdict} (${postSnapshot.issueCount}건)`] : []),
            ...(recovery.summary && recovery.summary.failed_step ? [`실패한 단계: ${recovery.summary.failed_step}`] : []),
          ],
        }] : []),
      ],
    });
    if (!alertResult || (alertResult.ok !== true && !(alertResult.skipped && alertResult.reason === "DEDUPED"))) {
      throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alertResult || {})}`);
    }
  }

  writeJson(STATE_PATH, {
    last_verdict: preSnapshot.verdict,
    last_issue_signature: preSnapshot.issueSignature,
    last_backfill_attempt_ms: recovery && recovery.attempted ? Date.now() : Number(previous.last_backfill_attempt_ms || 0),
    last_backfill_issue_signature: recovery && recovery.attempted ? backfillTriggerSignature : String(previous.last_backfill_issue_signature || ""),
    last_generated_at_kst: meta.kst,
  });

  console.log(JSON.stringify({
    ok: true,
    verdict: preSnapshot.verdict,
    issue_count: preSnapshot.issueCount,
    jsonPath,
    mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-automation-watchdog failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      parseLaunchctlList,
      computeVerdict,
      buildIssueSignature,
      normalizeRecoveryMode,
      isRecoveryExecutionAllowed,
      buildSnapshot,
    },
  };
}
