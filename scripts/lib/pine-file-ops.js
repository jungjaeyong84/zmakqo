#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { REPO_ROOT } = require("./automation-utils");

function updateLatestGeneratedPine(filePath) {
  const src = String(filePath || "").trim();
  if (!src) return null;
  const latestPath = path.join(REPO_ROOT, "code", "donbeolja_latest_generated.pine.txt");
  fs.copyFileSync(src, latestPath);
  return latestPath;
}

function openPineFileForReview(filePath) {
  const target = String(filePath || "").trim();
  if (!target || !fs.existsSync(target)) {
    return { ok: false, method: null, error: "FILE_MISSING" };
  }
  const attempts = [
    { cmd: "code", args: ["-g", target] },
    { cmd: "open", args: ["-a", "Cursor", target] },
    { cmd: "open", args: ["-a", "Visual Studio Code", target] },
    { cmd: "open", args: ["-a", "TextEdit", target] },
    { cmd: "open", args: [target] },
  ];
  for (const attempt of attempts) {
    const res = spawnSync(attempt.cmd, attempt.args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
    if (!res.error && Number(res.status) === 0) {
      return {
        ok: true,
        method: `${attempt.cmd} ${attempt.args.join(" ")}`,
        error: null,
      };
    }
  }
  return { ok: false, method: null, error: "OPEN_FAILED" };
}

function buildPineOpenContext({ sourceFilePath, latestFilePath } = {}) {
  const source = String(sourceFilePath || "").trim();
  const latest = String(latestFilePath || "").trim();
  return {
    title: "DONBEOLJA Pine Sync",
    subtitle: source ? path.basename(source) : "source unknown",
    message: latest
      ? `opened ${path.basename(latest)} from ${source ? path.basename(source) : "unknown source"}`
      : `opened from ${source ? path.basename(source) : "unknown source"}`,
  };
}

function notifyPineOpenContext({ sourceFilePath, latestFilePath } = {}) {
  const context = buildPineOpenContext({ sourceFilePath, latestFilePath });
  const script = [
    "display notification ",
    JSON.stringify(context.message),
    " with title ",
    JSON.stringify(context.title),
    " subtitle ",
    JSON.stringify(context.subtitle),
  ].join("");
  const res = spawnSync("osascript", ["-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  if (!res.error && Number(res.status) === 0) {
    return { ok: true, context, error: null };
  }
  return {
    ok: false,
    context,
    error: res.error ? String(res.error.message || res.error) : "NOTIFY_FAILED",
  };
}

module.exports = {
  updateLatestGeneratedPine,
  openPineFileForReview,
  buildPineOpenContext,
  notifyPineOpenContext,
};
