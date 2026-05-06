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

const LOCAL_RUNTIME_ENV_OUTPUT = path.join(REPO_ROOT, "ops", "runtime", "local_cost_saver_runtime.env");
const DEFAULT_RUNTIME_ENV_SERVICE = "donbeolja";
const DEFAULT_RUNTIME_ENV_REGION = "asia-northeast3";
const DEFAULT_RUNTIME_ENV_PROJECT = "donbeolja-dev";

function parseSecretRef(row) {
  const ref = row && (row.valueSource?.secretKeyRef || row.valueFrom?.secretKeyRef);
  if (!ref || !ref.name) return null;
  return Object.freeze({
    secret_name: String(ref.name),
    secret_version: String(ref.key || "latest"),
  });
}

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

function shellQuote(value) {
  return `'${String(value == null ? "" : value).replace(/'/g, `'\"'\"'`)}'`;
}

function fetchCloudRunLiteralEnv({
  service = DEFAULT_RUNTIME_ENV_SERVICE,
  region = DEFAULT_RUNTIME_ENV_REGION,
  project = DEFAULT_RUNTIME_ENV_PROJECT,
  execFileSyncFn = execFileSync,
} = {}) {
  const stdout = execFileSyncFn("gcloud", [
    "run",
    "services",
    "describe",
    service,
    "--region",
    region,
    "--project",
    project,
    "--format=json",
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(String(stdout || "{}"));
  const rows = (((parsed || {}).spec || {}).template || {}).spec?.containers?.[0]?.env || [];
  return rows
    .filter((row) => row && row.name)
    .map((row) => {
      const name = String(row.name);
      if (Object.prototype.hasOwnProperty.call(row, "value")) {
        return Object.freeze({
          name,
          value: String(row.value == null ? "" : row.value),
          source: "literal",
        });
      }
      const secretRef = parseSecretRef(row);
      if (secretRef) {
        return Object.freeze({
          name,
          source: "secret",
          ...secretRef,
        });
      }
      return Object.freeze({
        name,
        source: "unset",
      });
    });
}

function fetchSecretValue({
  envName,
  secretName,
  secretVersion = "latest",
  project = DEFAULT_RUNTIME_ENV_PROJECT,
  env = process.env,
  execFileSyncFn = execFileSync,
} = {}) {
  const local = String(env && env[envName] || "");
  if (local) {
    return Object.freeze({
      ok: true,
      name: envName,
      value: local,
      source: "local_env",
      secret_name: secretName || null,
      secret_version: secretVersion || null,
    });
  }
  const stdout = execFileSyncFn("gcloud", [
    "secrets",
    "versions",
    "access",
    String(secretVersion || "latest"),
    "--secret",
    String(secretName),
    "--project",
    String(project),
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return Object.freeze({
    ok: true,
    name: envName,
    value: String(stdout == null ? "" : stdout).replace(/\r?\n$/, ""),
    source: "secret_manager",
    secret_name: secretName || null,
    secret_version: secretVersion || null,
  });
}

function resolveRuntimeEnvRows(rows = [], {
  env = process.env,
  project = DEFAULT_RUNTIME_ENV_PROJECT,
  execFileSyncFn = execFileSync,
} = {}) {
  const resolved = [];
  const stats = {
    literal_env_n: 0,
    secret_env_n: 0,
    synced_secret_env_n: 0,
    skipped_unset_env_n: 0,
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.name) continue;
    if (row.source === "literal") {
      stats.literal_env_n += 1;
      resolved.push(Object.freeze({
        name: row.name,
        value: String(row.value == null ? "" : row.value),
        source: "literal",
      }));
      continue;
    }
    if (row.source === "secret") {
      stats.secret_env_n += 1;
      const secretValue = fetchSecretValue({
        envName: row.name,
        secretName: row.secret_name,
        secretVersion: row.secret_version,
        project,
        env,
        execFileSyncFn,
      });
      stats.synced_secret_env_n += 1;
      resolved.push(secretValue);
      continue;
    }
    stats.skipped_unset_env_n += 1;
  }
  return Object.freeze({
    rows: resolved,
    ...stats,
  });
}

function renderRuntimeEnvFile(rows = [], {
  generatedAt = new Date().toISOString(),
  service = DEFAULT_RUNTIME_ENV_SERVICE,
  region = DEFAULT_RUNTIME_ENV_REGION,
  project = DEFAULT_RUNTIME_ENV_PROJECT,
} = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row && row.name) : [];
  const lines = [
    "#!/bin/zsh",
    `# generated_at=${generatedAt}`,
    `# source=cloud-run service=${service} region=${region} project=${project}`,
  ];
  safeRows.forEach((row) => {
    lines.push(`export ${String(row.name)}=${shellQuote(row.value)}`);
  });
  lines.push("");
  return lines.join("\n");
}

function writeRuntimeEnvSnapshot({
  fsApi = fs,
  service = DEFAULT_RUNTIME_ENV_SERVICE,
  region = DEFAULT_RUNTIME_ENV_REGION,
  project = DEFAULT_RUNTIME_ENV_PROJECT,
  env = process.env,
  execFileSyncFn = execFileSync,
  now = () => new Date().toISOString(),
  outputFile = LOCAL_RUNTIME_ENV_OUTPUT,
} = {}) {
  const runtimeRows = fetchCloudRunLiteralEnv({
    service,
    region,
    project,
    execFileSyncFn,
  });
  const resolved = resolveRuntimeEnvRows(runtimeRows, {
    env,
    project,
    execFileSyncFn,
  });
  ensureDir(fsApi, path.dirname(outputFile));
  const rendered = renderRuntimeEnvFile(resolved.rows, {
    generatedAt: now(),
    service,
    region,
    project,
  });
  fsApi.writeFileSync(outputFile, rendered, "utf8");
  if (typeof fsApi.chmodSync === "function") fsApi.chmodSync(outputFile, 0o600);
  return Object.freeze({
    ok: true,
    service,
    region,
    project,
    output_file: outputFile,
    literal_env_n: resolved.literal_env_n,
    secret_env_n: resolved.secret_env_n,
    synced_secret_env_n: resolved.synced_secret_env_n,
    skipped_unset_env_n: resolved.skipped_unset_env_n,
    total_env_n: resolved.rows.length,
  });
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
    runtime_env_sync: null,
    jobs: [],
  };
  if (!args.dryRun) {
    try {
      payload.runtime_env_sync = writeRuntimeEnvSnapshot({
        fsApi,
        execFileSyncFn: deps.execFileSync || execFileSync,
        now,
      });
    } catch (error) {
      payload.runtime_env_sync = {
        ok: false,
        output_file: LOCAL_RUNTIME_ENV_OUTPUT,
        reason: "LOCAL_COST_SAVER_RUNTIME_ENV_SYNC_FAILED",
        error: error && error.message ? error.message : String(error),
      };
      payload.ok = false;
      return Object.freeze(payload);
    }
  }
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
      renderRuntimeEnvFile,
      fetchCloudRunLiteralEnv,
      fetchSecretValue,
      resolveRuntimeEnvRows,
      writeRuntimeEnvSnapshot,
      plistPathForLabel,
      installJob,
    },
  };
}
