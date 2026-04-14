#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const LABEL = "com.jeongjaeyong.donbeolja.activeexit";
const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_PLIST = path.join(REPO_ROOT, "ops", "launchd", `${LABEL}.plist`);
const TARGET_PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function run(args) {
  return execFileSync("launchctl", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function tryRun(args) {
  try {
    return { ok: true, args, text: run(args) };
  } catch (err) {
    return {
      ok: false,
      args,
      error: err && err.message ? String(err.message) : "LAUNCHCTL_FAILED",
    };
  }
}

function main() {
  fs.mkdirSync(path.dirname(TARGET_PLIST), { recursive: true });
  fs.copyFileSync(SOURCE_PLIST, TARGET_PLIST);
  fs.chmodSync(TARGET_PLIST, 0o644);
  const uid = String(process.getuid());
  const bootout = tryRun(["bootout", `gui/${uid}`, TARGET_PLIST]);
  const bootstrap = tryRun(["bootstrap", `gui/${uid}`, TARGET_PLIST]);
  const enable = tryRun(["enable", `gui/${uid}/${LABEL}`]);
  const kickstart = tryRun(["kickstart", "-k", `gui/${uid}/${LABEL}`]);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    label: LABEL,
    source_plist: SOURCE_PLIST,
    target_plist: TARGET_PLIST,
    bootout,
    bootstrap,
    enable,
    kickstart,
  }, null, 2)}\n`);
}

main();
