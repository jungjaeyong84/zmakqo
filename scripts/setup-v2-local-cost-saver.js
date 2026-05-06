#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  REPO_ROOT,
  OPENCLAW_LOCAL_COST_SAVER_JOBS,
} = require("./lib/openclaw-cron-manifest");

function parseArgs(argv = []) {
  const install = argv.includes("--install") || argv.includes("--enable") || argv.includes("--kickstart");
  return Object.freeze({
    dryRun: argv.includes("--dry-run") || !install,
    install,
    enable: argv.includes("--enable"),
    kickstart: argv.includes("--kickstart"),
  });
}

function ensureDir(fsApi, dirPath) {
  fsApi.mkdirSync(dirPath, { recursive: true });
}

function plistPathForLabel(label) {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function buildStartCalendarInterval(rows) {
  return rows.map((row) => {
    const fields = [];
    if (Number.isInteger(row.hour)) fields.push("      <key>Hour</key>", `      <integer>${row.hour}</integer>`);
    if (Number.isInteger(row.minute)) fields.push("      <key>Minute</key>", `      <integer>${row.minute}</integer>`);
    return ["    <dict>", ...fields, "    </dict>"].join("\n");
  }).join("\n");
}

function renderPlist(job) {
  const stdout = path.join(REPO_ROOT, "ops", "runtime", `${job.log_basename}.out.log`);
  const stderr = path.join(REPO_ROOT, "ops", "runtime", `${job.log_basename}.err.log`);
  const scheduleBlock = job.start_interval_seconds
    ? [
      "    <key>StartInterval</key>",
      `    <integer>${job.start_interval_seconds}</integer>`,
    ].join("\n")
    : [
      "    <key>StartCalendarInterval</key>",
      "    <array>",
      buildStartCalendarInterval(job.start_calendar_interval || []),
      "    </array>",
    ].join("\n");
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "  <dict>",
    "    <key>Label</key>",
    `    <string>${job.label}</string>`,
    "",
    "    <key>ProgramArguments</key>",
    "    <array>",
    "      <string>/bin/zsh</string>",
    `      <string>${job.wrapper}</string>`,
    "    </array>",
    "",
    "    <key>WorkingDirectory</key>",
    `    <string>${REPO_ROOT}</string>`,
    "",
    scheduleBlock,
    "",
    "    <key>RunAtLoad</key>",
    job.runAtLoad ? "    <true/>" : "    <false/>",
    "",
    "    <key>StandardOutPath</key>",
    `    <string>${stdout}</string>`,
    "    <key>StandardErrorPath</key>",
    `    <string>${stderr}</string>`,
    "  </dict>",
    "</plist>",
    "",
  ].join("\n");
}

function runLaunchctl(args) {
  try {
    const stdout = execFileSync("launchctl", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return Object.freeze({ ok: true, stdout: String(stdout || ""), stderr: "" });
  } catch (error) {
    return Object.freeze({
      ok: false,
      stdout: String(error && error.stdout || ""),
      stderr: String(error && error.stderr || error && error.message || ""),
    });
  }
}

function isLoaded(label, uid, runner = runLaunchctl) {
  return runner(["print", `gui/${uid}/${label}`]).ok === true;
}

function installJob(job, {
  fsApi = fs,
  uid = process.getuid(),
  runner = runLaunchctl,
  enable = false,
  kickstart = false,
  targetPlistOverride = null,
} = {}) {
  const targetPlist = targetPlistOverride || plistPathForLabel(job.label);
  ensureDir(fsApi, path.dirname(targetPlist));
  ensureDir(fsApi, path.join(REPO_ROOT, "ops", "runtime"));
  fsApi.writeFileSync(targetPlist, renderPlist(job), "utf8");
  if (typeof fsApi.chmodSync === "function") fsApi.chmodSync(targetPlist, 0o644);
  const result = {
    ok: true,
    label: job.label,
    scheduler_name: job.scheduler_name,
    target_plist: targetPlist,
    loaded_before: isLoaded(job.label, uid, runner),
    bootstrap: null,
    enable: null,
    kickstart: null,
    loaded_after: false,
  };
  if (enable && !result.loaded_before) {
    result.bootstrap = runner(["bootstrap", `gui/${uid}`, targetPlist]);
  }
  if (enable) {
    result.enable = runner(["enable", `gui/${uid}/${job.label}`]);
  }
  if (kickstart) {
    result.kickstart = runner(["kickstart", "-k", `gui/${uid}/${job.label}`]);
  }
  result.loaded_after = isLoaded(job.label, uid, runner);
  result.ok = enable
    ? result.loaded_after === true && (!result.bootstrap || result.bootstrap.ok === true) && (!result.enable || result.enable.ok === true)
    : true;
  return Object.freeze(result);
}

function main({
  argv = process.argv.slice(2),
  now = () => new Date().toISOString(),
  deps = {},
} = {}) {
  const args = parseArgs(argv);
  const fsApi = deps.fs || fs;
  const uid = deps.uid || process.getuid();
  const runner = deps.runLaunchctl || runLaunchctl;
  const payload = {
    ok: true,
    generated_at: now(),
    dry_run: args.dryRun,
    install_requested: args.install,
    enable_requested: args.enable,
    kickstart_requested: args.kickstart,
    job_n: OPENCLAW_LOCAL_COST_SAVER_JOBS.length,
    cloud_scheduler_pause_targets: OPENCLAW_LOCAL_COST_SAVER_JOBS.map((job) => job.scheduler_name),
    jobs: [],
  };
  for (const job of OPENCLAW_LOCAL_COST_SAVER_JOBS) {
    if (args.dryRun) {
      payload.jobs.push({
        label: job.label,
        scheduler_name: job.scheduler_name,
        target_plist: plistPathForLabel(job.label),
        wrapper: job.wrapper,
        criticality: job.criticality,
      });
      continue;
    }
    payload.jobs.push(installJob(job, {
      fsApi,
      uid,
      runner,
      enable: args.enable,
      kickstart: args.kickstart,
    }));
  }
  payload.ok = payload.jobs.every((row) => row.ok !== false);
  return Object.freeze(payload);
}

if (require.main === module) {
  const result = main();
  const sink = result.ok ? console.log : console.error;
  sink(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
} else {
  module.exports = {
    main,
    __test: {
      parseArgs,
      renderPlist,
      plistPathForLabel,
      installJob,
    },
  };
}
