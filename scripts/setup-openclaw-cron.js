#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const {
  OPENCLAW_CRON_JOBS,
  LEGACY_OPENCLAW_CRON_JOB_NAMES,
  buildOpenClawCronMessage,
  REPO_ROOT,
} = require("./lib/openclaw-cron-manifest");

const OPENCLAW_BIN = String(process.env.OPENCLAW_BIN || "openclaw").trim() || "openclaw";
const TZ = "Asia/Seoul";
const AGENT_ID = "donbeolja-ops";
const TIMEOUT_SECONDS = "1800";
const MAX_BUFFER = 10 * 1024 * 1024;

function runJson(args) {
  const out = execFileSync(OPENCLAW_BIN, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return JSON.parse(out);
}

function runText(args) {
  return execFileSync(OPENCLAW_BIN, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
}

function parseArgs(argv) {
  return {
    runAtLoad: argv.includes("--run-at-load"),
    dryRun: argv.includes("--dry-run"),
  };
}

function listJobs() {
  const payload = runJson(["cron", "list", "--json"]);
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

function removeByName(name, existingJobs) {
  const matches = existingJobs.filter((job) => String(job.name || "").trim() === String(name || "").trim());
  for (const job of matches) {
    if (job && job.id) runText(["cron", "rm", String(job.id)]);
  }
  return matches.length;
}

function removeLegacyJobs(existingJobs) {
  let removed = 0;
  for (const name of LEGACY_OPENCLAW_CRON_JOB_NAMES) {
    removed += removeByName(name, existingJobs);
  }
  return removed;
}

function buildAddArgs(job) {
  const args = [
    "cron",
    "add",
    "--json",
    "--agent",
    AGENT_ID,
    "--name",
    job.name,
    "--description",
    job.wrapper,
    "--timeout-seconds",
    TIMEOUT_SECONDS,
    "--no-deliver",
    "--message",
    buildOpenClawCronMessage(job),
  ];
  if (job.every) {
    args.push("--every", job.every);
  }
  if (job.cron) {
    args.push("--tz", TZ, "--cron", job.cron);
  }
  return args;
}

function addJob(job, dryRun = false) {
  const args = buildAddArgs(job);
  if (dryRun) {
    return { dryRun: true, args };
  }
  return runJson(args);
}

function runJobByName(name, jobs) {
  const match = jobs.find((job) => String(job.name || "").trim() === String(name || "").trim());
  if (!match || !match.id) {
    throw new Error(`CRON_JOB_NOT_FOUND:${name}`);
  }
  return runJson(["cron", "run", String(match.id), "--expect-final", "--timeout", "1800000"]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const existing = listJobs();
  const legacyRemoved = removeLegacyJobs(existing);
  const results = [];
  for (const job of OPENCLAW_CRON_JOBS) {
    const removed = removeByName(job.name, existing);
    const added = addJob(job, args.dryRun);
    results.push({
      name: job.name,
      label: job.label,
      removed_n: removed,
      added,
    });
  }

  const after = args.dryRun ? [] : listJobs();
  const runAtLoad = [];
  if (args.runAtLoad && !args.dryRun) {
    for (const job of OPENCLAW_CRON_JOBS.filter((row) => row.runAtLoad)) {
      runAtLoad.push({
        name: job.name,
        result: runJobByName(job.name, after),
      });
    }
  }

  const payload = {
    ok: true,
    agent_id: AGENT_ID,
    timezone: TZ,
    dry_run: args.dryRun,
    job_n: OPENCLAW_CRON_JOBS.length,
    legacy_removed_n: legacyRemoved,
    results,
    run_at_load: runAtLoad,
    installed_jobs: after.map((job) => ({
      id: job.id || null,
      name: job.name || null,
      nextRunAt: job.nextRunAt || null,
      enabled: job.enabled !== false,
    })),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main();
