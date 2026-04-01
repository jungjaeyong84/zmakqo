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

function renderMarkdown(report = {}) {
  return `# OpenClaw Daily Cycle\n\n- generated_at_kst: ${report.generated_at_kst || "N/A"}\n- status: ${report.status || "N/A"}\n- retrospective: ${report.retrospective_status || "N/A"}\n`;
}

function main() {
  const meta = nowKstMeta();
  const scriptPath = path.join(REPO_ROOT, "scripts", "automation-objective-retrospective.js");
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env },
    maxBuffer: 1024 * 1024 * 16,
  });
  const parsed = extractJson(child.stdout);
  const report = {
    ok: child.status === 0,
    generated_at_kst: meta.kst,
    status: child.status === 0 ? "PASS" : "FAIL",
    retrospective_status: parsed && (parsed.status || parsed.reason || parsed.ok === true && "OK") || (child.status === 0 ? "OK" : "FAIL"),
    stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-5),
    stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-5),
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
