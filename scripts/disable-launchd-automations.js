#!/usr/bin/env node
"use strict";

const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { OPENCLAW_CRON_JOBS } = require("./lib/openclaw-cron-manifest");

const uid = String(process.getuid());

function run(args) {
  return execFileSync("launchctl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
}

function tryRun(args) {
  try {
    run(args);
    return { ok: true, args };
  } catch (err) {
    return {
      ok: false,
      args,
      error: err && err.message ? String(err.message) : "LAUNCHCTL_FAILED",
    };
  }
}

function plistPathForLabel(label) {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function main() {
  const rows = OPENCLAW_CRON_JOBS.map((job) => {
    const plist = plistPathForLabel(job.label);
    return {
      label: job.label,
      plist,
      bootout: tryRun(["bootout", `gui/${uid}`, plist]),
      disable: tryRun(["disable", `gui/${uid}/${job.label}`]),
    };
  });
  process.stdout.write(`${JSON.stringify({ ok: true, rows }, null, 2)}\n`);
}

main();
