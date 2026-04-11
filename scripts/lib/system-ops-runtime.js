"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_SYSTEM_OPS_LATEST_PATH = path.join(REPO_ROOT, "ops", "daily", "system_ops_check_latest.json");

function clone(value, fallback = {}) {
  if (!value || typeof value !== "object") return fallback;
  return JSON.parse(JSON.stringify(value));
}

function readJsonSafe(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return clone(fallback, {});
  }
}

async function loadSystemOpsLatest({
  exchange = "BINANCEFUT",
  fallbackPath = DEFAULT_SYSTEM_OPS_LATEST_PATH,
} = {}) {
  const { getOperationalRuntimeState } = require("../../src/storage/operationalRuntimeStates");
  const direct = await getOperationalRuntimeState({ exchange }).catch(() => null);
  const fallback = exchange ? await getOperationalRuntimeState({ exchange: null }).catch(() => null) : null;
  const doc = direct || fallback;
  if (doc && doc.state && typeof doc.state === "object") {
    return clone(doc.state, {});
  }
  return readJsonSafe(fallbackPath, {});
}

function loadSystemOpsLatestSync({
  exchange = "BINANCEFUT",
  fallbackPath = DEFAULT_SYSTEM_OPS_LATEST_PATH,
} = {}) {
  try {
    const program = `
      const { loadSystemOpsLatest } = require(${JSON.stringify(__filename)});
      loadSystemOpsLatest(${JSON.stringify({ exchange, fallbackPath })})
        .then((value) => process.stdout.write(JSON.stringify(value || {})))
        .catch(() => process.exit(2));
    `;
    const out = execFileSync(process.execPath, ["-e", program], {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(String(out || "{}"));
  } catch (_) {
    return readJsonSafe(fallbackPath, {});
  }
}

module.exports = {
  DEFAULT_SYSTEM_OPS_LATEST_PATH,
  loadSystemOpsLatest,
  loadSystemOpsLatestSync,
  __test: {
    readJsonSafe,
  },
};
