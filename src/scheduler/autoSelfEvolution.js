"use strict";

const env = require("../config/env");
const { readLatestSelfEvolutionRun, runSelfEvolutionLoop, isFreshSelfEvolutionLatest } = require("./selfEvolutionRunner");

let lastSelfEvolutionAutoCheckMs = 0;

function autoSelfEvolutionEnabled() {
  return env.auto.selfEvolution === true;
}

function autoSelfEvolutionCheckMs() {
  const v = Number(env.auto.selfEvolutionCheckMs || 15 * 60 * 1000);
  return Number.isFinite(v) && v > 0 ? v : 15 * 60 * 1000;
}

function autoSelfEvolutionMaxAgeMs() {
  const v = Number(env.auto.selfEvolutionMaxAgeMs || 4 * 60 * 60 * 1000);
  return Number.isFinite(v) && v > 0 ? v : 4 * 60 * 60 * 1000;
}

function autoSelfEvolutionLockStaleMs() {
  const v = Number(env.auto.selfEvolutionLockStaleMs || 2 * 60 * 60 * 1000);
  return Number.isFinite(v) && v > 0 ? v : 2 * 60 * 60 * 1000;
}

function shouldRunSelfEvolutionLoop(latest = null, nowMs = Date.now(), maxAgeMs = autoSelfEvolutionMaxAgeMs()) {
  return !isFreshSelfEvolutionLatest(latest, nowMs, maxAgeMs);
}

function maybeAutoSelfEvolutionLoop() {
  if (!autoSelfEvolutionEnabled()) return { ok: true, skipped: true, reason: "DISABLED" };
  const nowMs = Date.now();
  const throttleMs = autoSelfEvolutionCheckMs();
  if (Number.isFinite(throttleMs) && nowMs - lastSelfEvolutionAutoCheckMs < throttleMs) {
    return { ok: true, skipped: true, reason: "THROTTLED" };
  }
  lastSelfEvolutionAutoCheckMs = nowMs;

  const latest = readLatestSelfEvolutionRun();
  if (!shouldRunSelfEvolutionLoop(latest, nowMs, autoSelfEvolutionMaxAgeMs())) {
    return { ok: true, skipped: true, reason: "FRESH", latest };
  }

  return runSelfEvolutionLoop({
    trigger: "scheduler_auto",
    force: false,
    maxAgeMs: autoSelfEvolutionMaxAgeMs(),
    staleLockMs: autoSelfEvolutionLockStaleMs(),
  });
}

module.exports = {
  autoSelfEvolutionEnabled,
  autoSelfEvolutionCheckMs,
  autoSelfEvolutionMaxAgeMs,
  autoSelfEvolutionLockStaleMs,
  maybeAutoSelfEvolutionLoop,
  __test: {
    shouldRunSelfEvolutionLoop,
  },
};
