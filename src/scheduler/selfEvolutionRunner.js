"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "automation-self-evolution-loop.js");
const LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_run_latest.json");
const LOCK_PATH = path.join(OPS_DAILY_DIR, ".best_self_evolution_loop.lock.json");

function toMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
  const candidates = [
    report.generated_at,
    report.generated_at_utc,
    report.generated_at_kst,
    report.finished_at,
  ];
  for (const value of candidates) {
    const ms = Date.parse(String(value || ""));
    if (Number.isFinite(ms)) return ms;
  }
  try {
    const stat = fs.statSync(LATEST_PATH);
    return stat.mtimeMs;
  } catch (_err) {
    return null;
  }
}

function isFreshSelfEvolutionLatest(report = null, nowMs = Date.now(), maxAgeMs = 4 * 60 * 60 * 1000) {
  const generatedAtMs = latestGeneratedAtMs(report);
  if (!Number.isFinite(generatedAtMs)) return false;
  return (nowMs - generatedAtMs) < maxAgeMs;
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

function acquireLock({ nowMs = Date.now(), trigger = "manual", staleMs = 2 * 60 * 60 * 1000 } = {}) {
  const payload = {
    trigger,
    created_at: new Date(nowMs).toISOString(),
    created_at_ms: nowMs,
    pid: process.pid,
  };
  try {
    fs.writeFileSync(LOCK_PATH, JSON.stringify(payload, null, 2), { flag: "wx" });
    return { ok: true, lock: payload };
  } catch (err) {
    if (!err || err.code !== "EEXIST") return { ok: false, reason: "LOCK_WRITE_FAIL", error: err && err.message ? err.message : String(err) };
  }

  const existing = readJsonSafe(LOCK_PATH);
  const createdAtMs = toMs(existing && existing.created_at_ms) || Date.parse(String(existing && existing.created_at || ""));
  if (Number.isFinite(createdAtMs) && (nowMs - createdAtMs) > staleMs) {
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch (_err) {
      return { ok: false, reason: "LOCK_STALE_UNLINK_FAIL" };
    }
    return acquireLock({ nowMs, trigger, staleMs });
  }
  return {
    ok: false,
    reason: "LOCKED",
    lock: existing,
  };
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
  } catch (_err) {
    // noop
  }
}

function readLatestSelfEvolutionRun() {
  return readJsonSafe(LATEST_PATH);
}

function runSelfEvolutionLoop({ trigger = "manual", force = false, maxAgeMs = 4 * 60 * 60 * 1000, staleLockMs = 2 * 60 * 60 * 1000 } = {}) {
  const nowMs = Date.now();
  const latest = readLatestSelfEvolutionRun();
  if (!force && isFreshSelfEvolutionLatest(latest, nowMs, maxAgeMs)) {
    return {
      ok: true,
      skipped: true,
      reason: "FRESH",
      latest,
    };
  }

  const lock = acquireLock({ nowMs, trigger, staleMs: staleLockMs });
  if (!lock.ok) {
    return {
      ok: true,
      skipped: true,
      reason: lock.reason,
      lock: lock.lock || null,
      latest,
    };
  }

  try {
    const child = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        SELF_EVOLUTION_TRIGGER: trigger,
      },
      maxBuffer: 1024 * 1024 * 16,
    });
    const parsed = parseLastJsonLine(child.stdout);
    return {
      ok: child.status === 0,
      skipped: false,
      exit_code: child.status,
      stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).slice(-5),
      stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).slice(-5),
      parsed,
      latest: readLatestSelfEvolutionRun(),
    };
  } finally {
    releaseLock();
  }
}

module.exports = {
  runSelfEvolutionLoop,
  readLatestSelfEvolutionRun,
  isFreshSelfEvolutionLatest,
  __test: {
    latestGeneratedAtMs,
    parseLastJsonLine,
    isFreshSelfEvolutionLatest,
  },
};
