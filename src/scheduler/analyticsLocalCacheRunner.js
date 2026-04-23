"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "refresh-analytics-local-cache.js");
const LATEST_PATH = path.join(OPS_DAILY_DIR, "analytics_local_cache_refresh_latest.json");
const LOCK_PATH = path.join(OPS_DAILY_DIR, ".analytics_local_cache_refresh.lock.json");

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function latestGeneratedAtMs(report = null) {
  if (!report || typeof report !== "object") return null;
  const candidates = [report.generated_at, report.generated_at_utc, report.generated_at_kst, report.updated_at];
  for (const value of candidates) {
    const ms = Date.parse(String(value || ""));
    if (Number.isFinite(ms)) return ms;
  }
  try {
    return fs.statSync(LATEST_PATH).mtimeMs;
  } catch (_err) {
    return null;
  }
}

function isFreshAnalyticsLocalCache(report = null, nowMs = Date.now(), maxAgeMs = 15 * 60 * 1000) {
  const ms = latestGeneratedAtMs(report);
  if (!Number.isFinite(ms)) return false;
  return (nowMs - ms) < maxAgeMs;
}

function readLatestAnalyticsLocalCache() {
  return readJsonSafe(LATEST_PATH);
}

function parseLastJsonLine(stdout = "") {
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

function acquireLock({ nowMs = Date.now(), trigger = "manual", staleMs = 60 * 60 * 1000 } = {}) {
  const payload = { trigger, created_at: new Date(nowMs).toISOString(), created_at_ms: nowMs, pid: process.pid };
  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify(payload, null, 2), { flag: "wx" });
    return { ok: true, lock: payload };
  } catch (err) {
    if (!err || err.code !== "EEXIST") return { ok: false, reason: "LOCK_WRITE_FAIL", error: err && err.message ? err.message : String(err) };
  }
  const existing = readJsonSafe(LOCK_PATH);
  const createdAtMs = Number(existing && existing.created_at_ms) || Date.parse(String(existing && existing.created_at || ""));
  if (Number.isFinite(createdAtMs) && (nowMs - createdAtMs) > staleMs) {
    try { fs.unlinkSync(LOCK_PATH); } catch (_err) { return { ok: false, reason: "LOCK_STALE_UNLINK_FAIL" }; }
    return acquireLock({ nowMs, trigger, staleMs });
  }
  return { ok: false, reason: "LOCKED", lock: existing };
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
  } catch (_err) {
    // noop
  }
}

function runAnalyticsLocalCacheRefresh({
  trigger = "manual",
  force = false,
  maxAgeMs = 15 * 60 * 1000,
  staleLockMs = 60 * 60 * 1000,
  skipDependentReports = false,
  envOverrides = {},
} = {}) {
  const nowMs = Date.now();
  const latest = readLatestAnalyticsLocalCache();
  if (!force && isFreshAnalyticsLocalCache(latest, nowMs, maxAgeMs)) {
    return { ok: true, skipped: true, reason: "FRESH", latest };
  }
  const lock = acquireLock({ nowMs, trigger, staleMs: staleLockMs });
  if (!lock.ok) return { ok: true, skipped: true, reason: lock.reason, lock: lock.lock || null, latest };
  try {
    const child = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ...envOverrides,
        ANALYTICS_CACHE_TRIGGER: trigger,
        ...(skipDependentReports ? { ANALYTICS_CACHE_SKIP_DEPENDENT_REPORTS: "1" } : {}),
      },
      maxBuffer: 1024 * 1024 * 16,
    });
    return {
      ok: child.status === 0,
      skipped: false,
      exit_code: child.status,
      stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).slice(-5),
      stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).slice(-5),
      parsed: parseLastJsonLine(child.stdout),
      latest: readLatestAnalyticsLocalCache(),
    };
  } finally {
    releaseLock();
  }
}

module.exports = {
  runAnalyticsLocalCacheRefresh,
  readLatestAnalyticsLocalCache,
  isFreshAnalyticsLocalCache,
  __test: {
    latestGeneratedAtMs,
    parseLastJsonLine,
    isFreshAnalyticsLocalCache,
  },
};
