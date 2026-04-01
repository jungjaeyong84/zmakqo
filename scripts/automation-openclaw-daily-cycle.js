#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();

const REPO_ROOT = path.resolve(__dirname, "..");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "openclaw_daily_cycle_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "openclaw_daily_cycle_latest.md");

function extractJson(stdout = "") {
  const lines = String(stdout || "").trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch (_err) {
      // continue
    }
  }
  return null;
}

function runScript(script, env = {}) {
  const scriptPath = path.join(REPO_ROOT, "scripts", script);
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 16,
  });
  return {
    ok: child.status === 0,
    exit_code: child.status,
    parsed: extractJson(child.stdout),
    stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-5),
    stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-5),
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# OpenClaw Daily Cycle",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${report.status || "N/A"}`,
    `- retrospective: ${report.retrospective_status || "N/A"}`,
    `- supervisor: ${report.supervisor_status || "N/A"}`,
    "",
    "## Steps",
  ];
  for (const row of Array.isArray(report.steps) ? report.steps : []) {
    lines.push(`- ${row.id}: ${row.status} / summary=${row.summary || "N/A"}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const meta = nowKstMeta();
  const steps = [];

  const retrospective = runScript("automation-objective-retrospective.js");
  steps.push({
    id: "objective_retrospective",
    status: retrospective.ok ? "PASS" : "FAIL",
    summary: retrospective.parsed && (retrospective.parsed.failed_periods ? retrospective.parsed.failed_periods.join("/") : null)
      || retrospective.parsed && retrospective.parsed.status
      || "OK",
  });

  const supervisor = retrospective.ok
    ? runScript("automation-objective-supervisor.js", { SKIP_ALERT: process.env.SKIP_ALERT || "" })
    : { ok: false, parsed: null, stdout_tail: [], stderr_tail: ["RETROSPECTIVE_FAILED"] };
  steps.push({
    id: "objective_supervisor",
    status: supervisor.ok ? "PASS" : "FAIL",
    summary: supervisor.parsed && (supervisor.parsed.verdict || supervisor.parsed.reason || supervisor.parsed.status) || (supervisor.ok ? "OK" : "FAIL"),
  });

  const report = {
    ok: steps.every((row) => row.status !== "FAIL"),
    generated_at_kst: meta.kst,
    status: steps.every((row) => row.status !== "FAIL") ? "PASS" : "FAIL",
    retrospective_status: retrospective.parsed && (retrospective.parsed.failed_periods ? retrospective.parsed.failed_periods.join("/") : null)
      || retrospective.parsed && (retrospective.parsed.status || retrospective.parsed.reason || retrospective.parsed.ok === true && "OK")
      || (retrospective.ok ? "OK" : "FAIL"),
    supervisor_status: supervisor.parsed && (supervisor.parsed.verdict || supervisor.parsed.reason || supervisor.parsed.status)
      || (supervisor.ok ? "OK" : "FAIL"),
    learning_applied: retrospective.ok && supervisor.ok,
    steps,
    stdout_tail: {
      retrospective: retrospective.stdout_tail,
      supervisor: supervisor.stdout_tail,
    },
    stderr_tail: {
      retrospective: retrospective.stderr_tail,
      supervisor: supervisor.stderr_tail,
    },
  };

  const base = `${meta.dateKey}_${meta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_openclaw_daily_cycle.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_openclaw_daily_cycle.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  console.log(JSON.stringify({
    ok: report.ok,
    status: report.status,
    learning_applied: report.learning_applied,
    jsonPath,
    mdPath,
  }, null, 2));

  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("automation-openclaw-daily-cycle failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
