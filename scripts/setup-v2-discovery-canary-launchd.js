#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = "/Users/jeongjaeyong/Projects/donbeolja";
const LABEL = "com.jeongjaeyong.donbeolja.v2discoverycanaryautodeploy";
const SOURCE_PLIST = path.join(REPO_ROOT, "ops", "launchd", `${LABEL}.plist`);
const TARGET_PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const OUTPUT_FILE = path.join(REPO_ROOT, "ops", "daily", "v2_discovery_canary_launchd_latest.json");

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

function writeJson(fsApi, filePath, payload) {
  ensureDir(fsApi, path.dirname(filePath));
  fsApi.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function isLoaded({ uid = process.getuid(), label = LABEL, runLaunchctlFn = runLaunchctl } = {}) {
  return runLaunchctlFn(["print", `gui/${uid}/${label}`]).ok === true;
}

function setupLaunchd({
  argv = process.argv.slice(2),
  now = () => new Date().toISOString(),
  deps = {},
  paths = {},
} = {}) {
  const args = parseArgs(argv);
  const fsApi = deps.fs || fs;
  const runLaunchctlFn = deps.runLaunchctlFn || runLaunchctl;
  const getuid = deps.getuid || (() => process.getuid());
  const uid = getuid();
  const sourcePlist = paths.sourcePlist || SOURCE_PLIST;
  const targetPlist = paths.targetPlist || TARGET_PLIST;
  const outputFile = paths.outputFile || OUTPUT_FILE;
  const result = {
    ok: true,
    generated_at: now(),
    label: LABEL,
    source_plist: sourcePlist,
    target_plist: targetPlist,
    output_file: outputFile,
    dry_run: args.dryRun,
    install_requested: args.install,
    enable_requested: args.enable,
    kickstart_requested: args.kickstart,
    copied: false,
    loaded_before: isLoaded({ uid, runLaunchctlFn }),
    bootstrap: null,
    enable: null,
    kickstart: null,
    loaded_after: false,
  };

  if (!fsApi.existsSync(sourcePlist)) {
    result.ok = false;
    result.reason = "SOURCE_PLIST_MISSING";
    result.loaded_after = result.loaded_before;
    writeJson(fsApi, outputFile, result);
    return Object.freeze(result);
  }

  if (args.dryRun) {
    result.reason = "V2_DISCOVERY_CANARY_LAUNCHD_DRY_RUN";
    result.loaded_after = result.loaded_before;
    writeJson(fsApi, outputFile, result);
    return Object.freeze(result);
  }

  ensureDir(fsApi, path.dirname(targetPlist));
  fsApi.copyFileSync(sourcePlist, targetPlist);
  if (typeof fsApi.chmodSync === "function") {
    fsApi.chmodSync(targetPlist, 0o644);
  }
  result.copied = true;
  if (args.enable && !result.loaded_before) {
    result.bootstrap = runLaunchctlFn(["bootstrap", `gui/${uid}`, targetPlist]);
  }
  if (args.enable) {
    result.enable = runLaunchctlFn(["enable", `gui/${uid}/${LABEL}`]);
  }
  if (args.kickstart) {
    result.kickstart = runLaunchctlFn(["kickstart", "-k", `gui/${uid}/${LABEL}`]);
  }
  result.loaded_after = isLoaded({ uid, runLaunchctlFn });
  result.ok = args.enable
    ? result.loaded_after === true && (!result.bootstrap || result.bootstrap.ok === true) && (!result.enable || result.enable.ok === true)
    : result.copied === true;
  if (!result.ok) {
    result.reason = "V2_DISCOVERY_CANARY_LAUNCHD_ENABLE_FAILED";
  } else if (args.enable) {
    result.reason = "V2_DISCOVERY_CANARY_LAUNCHD_ENABLED";
  } else {
    result.reason = "V2_DISCOVERY_CANARY_LAUNCHD_INSTALLED";
  }
  writeJson(fsApi, outputFile, result);
  return Object.freeze(result);
}

function main() {
  const result = setupLaunchd();
  const sink = result.ok === true ? console.log : console.error;
  sink(JSON.stringify(result));
  if (result.ok !== true) process.exit(1);
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    setupLaunchd,
    __test: {
      REPO_ROOT,
      LABEL,
      SOURCE_PLIST,
      TARGET_PLIST,
      OUTPUT_FILE,
      parseArgs,
      isLoaded,
    },
  };
}
