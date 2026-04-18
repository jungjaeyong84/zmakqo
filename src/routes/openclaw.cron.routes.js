"use strict";

// Cloud Scheduler → Cloud Run HTTP trigger endpoints for the OpenClaw
// agent-cycle crons. These reuse the same main() functions that the old
// launchd wrappers called, so the Firestore query pattern and artifact
// output stay identical. Auth is enforced by an x-scheduler-token
// header matched against process.env.SCHEDULER_TOKEN (same token the
// existing schedulerRoutes already use for other internal jobs).
//
// Why HTTP endpoints on the existing `donbeolja` Cloud Run service
// instead of a new Cloud Run Job:
//   - No new service to warm up or pay always-on CPU.
//   - Reuses the OAuth-registered URL, Firestore clients, logging.
//   - Cloud Scheduler charges ~$0.10/month per job regardless.
//
// Why only SCHEDULER_TOKEN auth (no Google OAuth):
//   - Cloud Scheduler HTTP calls don't carry browser session cookies.
//   - The same pattern is already used by scheduler.routes.js for the
//     daily analytics refresh, so we match convention.
//
// Cost posture (2026-04-18):
//   - Evidence linker: 3 ledger reads + ~60 fills reads per run.
//   - At 6h cadence = ~250 reads/day. Cents-level.
//   - Calibration/retrospect: fewer because they only operate on
//     linked-outcome docs; 24h cadence further caps the bill.

const express = require("express");
const router = express.Router();

function requireSchedulerToken(req, res, next) {
  const expected = String(process.env.SCHEDULER_TOKEN || "").trim();
  if (!expected) {
    // If the server was started without a scheduler token the endpoint
    // must refuse — we never want these runnable by anonymous callers.
    return res.status(503).json({ ok: false, error: "SCHEDULER_TOKEN_NOT_CONFIGURED" });
  }
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "").trim();
  if (token !== expected) {
    return res.status(401).json({ ok: false, error: "BAD_TOKEN" });
  }
  return next();
}

function timeout(promise, ms, label) {
  let t = null;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label}_TIMEOUT_${ms}`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

async function runWithShortTimeout(label, runner, ms = 180000) {
  const started = Date.now();
  try {
    const result = await timeout(runner(), ms, label);
    const durationMs = Date.now() - started;
    return { ok: true, label, durationMs, result };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err && err.message ? err.message : String(err);
    return { ok: false, label, durationMs, error: message };
  }
}

// evidence_linker: joins evidence ledger outcomes with fills_paper.
router.post("/api/openclaw/cron/evidence-linker", requireSchedulerToken, async (req, res) => {
  // Override the linker's lookback default via env so this route reuses
  // the same script binding but with a cheaper query window.
  const prevLookback = process.env.OPENCLAW_EVIDENCE_LINKER_LOOKBACK_DAYS;
  const prevDryRun = process.env.DRY_RUN;
  process.env.OPENCLAW_EVIDENCE_LINKER_LOOKBACK_DAYS = String(req.query.lookback_days || prevLookback || 1);
  process.env.DRY_RUN = "0";
  try {
    const { main } = require("../../scripts/link-openclaw-evidence-outcomes");
    const outcome = await runWithShortTimeout("evidence_linker", () => main(), 120000);
    return res.status(outcome.ok ? 200 : 500).json(outcome);
  } finally {
    if (prevLookback === undefined) delete process.env.OPENCLAW_EVIDENCE_LINKER_LOOKBACK_DAYS;
    else process.env.OPENCLAW_EVIDENCE_LINKER_LOOKBACK_DAYS = prevLookback;
    if (prevDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = prevDryRun;
  }
});

// calibration: re-scores per-source trust weights.
router.post("/api/openclaw/cron/calibration", requireSchedulerToken, async (req, res) => {
  try {
    const { main } = require("../../scripts/report-openclaw-calibration");
    const outcome = await runWithShortTimeout("calibration", () => main(), 120000);
    return res.status(outcome.ok ? 200 : 500).json(outcome);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// retrospect: narrative review of last N hours.
router.post("/api/openclaw/cron/retrospect", requireSchedulerToken, async (req, res) => {
  // Default to 24h lookback for the scheduled run; override via ?lookback_hours=.
  const prevLookback = process.env.OPENCLAW_RETROSPECT_LOOKBACK_HOURS;
  process.env.OPENCLAW_RETROSPECT_LOOKBACK_HOURS = String(req.query.lookback_hours || prevLookback || 24);
  try {
    const { main } = require("../../scripts/run-openclaw-retrospect");
    const outcome = await runWithShortTimeout("retrospect", () => main(), 180000);
    return res.status(outcome.ok ? 200 : 500).json(outcome);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  } finally {
    if (prevLookback === undefined) delete process.env.OPENCLAW_RETROSPECT_LOOKBACK_HOURS;
    else process.env.OPENCLAW_RETROSPECT_LOOKBACK_HOURS = prevLookback;
  }
});

// Health probe — returns 200 with a small payload so scheduler smoke
// tests can verify auth + routing without kicking off a full run.
router.get("/api/openclaw/cron/_ping", requireSchedulerToken, (req, res) => {
  return res.json({
    ok: true,
    routes: [
      "POST /api/openclaw/cron/evidence-linker",
      "POST /api/openclaw/cron/calibration",
      "POST /api/openclaw/cron/retrospect",
    ],
    now_iso: new Date().toISOString(),
  });
});

module.exports = router;
