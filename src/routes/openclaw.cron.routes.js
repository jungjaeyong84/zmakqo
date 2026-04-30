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

// v2-production-entry-route-canary: proves OpenClaw scheduler traffic can
// reach the V2 production entry route without allowing exchange writes.
router.post("/api/openclaw/cron/v2-production-entry-route-canary", requireSchedulerToken, async (req, res) => {
  try {
    const { main } = require("../../scripts/run-v2-production-entry-route-canary");
    const outcome = await runWithShortTimeout("v2_production_entry_route_canary", () => main({ setProcessExitCode: false }), 120000);
    const resultOk = outcome.ok === true && outcome.result && outcome.result.ok === true;
    return res.status(resultOk ? 200 : 500).json({
      ...outcome,
      ok: resultOk,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// v2-exit-runtime-canary: read-only collector for live exit runtime health.
// This feeds the Firestore-backed 24h streak required before LIVE cutover.
//
// Timeout note (2026-04-28): production main() takes ~180s end-to-end
// (binance API egress + Firestore writes) so the prior 120000ms cap
// caused chronic 500s every hour even though the canary itself returned
// ok=true. Bumped to 240000ms (4 min) — keeps headroom over the 180s
// observed budget while still well under Cloud Run's 540s request cap.
router.post("/api/openclaw/cron/v2-exit-runtime-canary", requireSchedulerToken, async (req, res) => {
  try {
    const { main } = require("../../scripts/run-v2-exit-runtime-canary");
    const outcome = await runWithShortTimeout("v2_exit_runtime_canary", () => main({ setProcessExitCode: false }), 240000);
    const resultOk = outcome.ok === true && outcome.result && outcome.result.ok === true;
    return res.status(resultOk ? 200 : 500).json({
      ...outcome,
      ok: resultOk,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// 2026-04-30 P0-fix-G follow-up — recurring stale-cycle cleanup.
//
// Background: P0-fix-G one-shot script
// (scripts/cleanup-stale-active-protected-cycles.js) cleared 43
// stale ACTIVE_PROTECTED cycles whose broker side was already FLAT.
// The accumulation pattern is structural — every WS user-data
// stream LEASE_LOST or fill-sync race can leave a cycle stuck in
// ACTIVE_PROTECTED — so a recurring cleanup is the right long-term
// posture instead of waiting for the next deploy gate to surface
// it.
//
// Operator gating:
//   V2_STALE_CYCLE_CLEANUP_APPLY env var
//     "1"/"true"/"yes" → mutate (status: CLOSED + provenance)
//     anything else (or unset) → diagnose-only (default)
//
// Default OFF for safety: the very first production deploys run
// in diagnose mode so the operator can review the report and
// flip the env var to enable mutation only after the classifier
// truth-table has been observed in live traffic. Same staged-
// rollout posture as the v2-exit-runtime-canary canary streak
// (which started observe-only and was promoted to gate-blocking
// after the streak was clean).
//
// The route uses the same hard caps + age floor as the CLI tool
// (CLEANUP_MAX_WRITES default 50, CLEANUP_CYCLE_AGE_FLOOR_MS
// default 5 min) — see the script header for the full safety
// contract.
router.post("/api/openclaw/cron/v2-stale-cycle-cleanup", requireSchedulerToken, async (req, res) => {
  try {
    const { main } = require("../../scripts/cleanup-stale-active-protected-cycles");
    const applyRaw = String(process.env.V2_STALE_CYCLE_CLEANUP_APPLY || "").trim().toLowerCase();
    const apply = applyRaw === "1" || applyRaw === "true" || applyRaw === "yes" || applyRaw === "on";
    const outcome = await runWithShortTimeout(
      "v2_stale_cycle_cleanup",
      () => main({ argv: apply ? ["--apply"] : [] }),
      180000
    );
    // The cleanup script's main() returns the report directly (not
    // wrapped in { ok, result }), so we project ok = report.ok.
    const result = outcome && outcome.result ? outcome.result : null;
    const resultOk = outcome.ok === true && (!result || result.ok === true);
    return res.status(resultOk ? 200 : 500).json({
      ...outcome,
      ok: resultOk,
      apply_mode: apply ? "APPLY" : "DIAGNOSE_ONLY",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// v2-active-protection-reconciliation: live exchange/order reconciliation
// for active positions. Any unprotected active position must make this
// endpoint fail so Cloud Scheduler status reflects the safety problem.
router.post("/api/openclaw/cron/v2-active-protection-reconciliation", requireSchedulerToken, async (req, res) => {
  try {
    const { run } = require("../../scripts/check-v2-active-protection-reconciliation");
    const outcome = await runWithShortTimeout("v2_active_protection_reconciliation", () => run(), 120000);
    const resultOk = outcome.ok === true && outcome.result && outcome.result.ok === true;
    return res.status(resultOk ? 200 : 500).json({
      ...outcome,
      ok: resultOk,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// openclaw-server-primary-tick: authoritative server-native paper tick that
// refreshes bars_snapshots and generates server-primary paper signals under
// the OpenClaw scheduler SOT. This replaces the old legacy tick path for V2.
router.post("/api/openclaw/cron/openclaw-server-primary-tick", requireSchedulerToken, async (req, res) => {
  try {
    const { main } = require("../../scripts/run-openclaw-server-primary-tick");
    // 2026-04-30 P0 production verification — 16-symbol entry-TF warmup can
    // legitimately exceed the old 180s route guard on cold-start ticks. Keep
    // this aligned with the Cloud Run request timeout and Cloud Scheduler
    // attempt deadline so the cron fails only on real script failure.
    const outcome = await runWithShortTimeout("openclaw_server_primary_tick", () => main({ setProcessExitCode: false }), 300000);
    const resultOk = outcome.ok === true && outcome.result && outcome.result.ok === true;
    return res.status(resultOk ? 200 : 500).json({
      ...outcome,
      ok: resultOk,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// v2-signal-shadow-counterfactual-walker: closes pending shadow ledger
// records past their kline horizon (F1). Default OFF behind
// DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED — when the
// flag is unset the walker returns immediately as a no-op so this
// endpoint is safe to schedule before the ledger is activated.
router.post("/api/openclaw/cron/v2-signal-shadow-counterfactual-walker", requireSchedulerToken, async (req, res) => {
  try {
    const { main } = require("../../scripts/walk-v2-signal-shadow-counterfactual-ledger");
    const outcome = await runWithShortTimeout(
      "v2_signal_shadow_counterfactual_walker",
      () => main({ setProcessExitCode: false }),
      120000
    );
    const resultOk = outcome.ok === true && outcome.result && outcome.result.ok === true;
    return res.status(resultOk ? 200 : 500).json({
      ...outcome,
      ok: resultOk,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// v2-signal-shadow-counterfactual-analyzer: read-only F2 leave-one-out
// analyzer that consumes CLOSED records and writes the daily report
// artifact. Pure analysis, never mutates the ledger.
router.post("/api/openclaw/cron/v2-signal-shadow-counterfactual-analyzer", requireSchedulerToken, async (req, res) => {
  try {
    const { main } = require("../../scripts/analyze-v2-signal-shadow-counterfactuals");
    const outcome = await runWithShortTimeout(
      "v2_signal_shadow_counterfactual_analyzer",
      () => main({ setProcessExitCode: false }),
      180000
    );
    const resultOk = outcome.ok === true && outcome.result && outcome.result.ok === true;
    return res.status(resultOk ? 200 : 500).json({
      ...outcome,
      ok: resultOk,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
});

// v2-production-entry-live: deliberately disabled by default. When enabled,
// this endpoint still delegates only to the V2 production entry route.
router.post("/api/openclaw/cron/v2-production-entry-live", requireSchedulerToken, express.json({ type: "*/*", limit: "128kb" }), async (req, res) => {
  try {
    const { runV2ProductionEntryLiveEndpoint } = require("../v2/productionEntryLiveEndpoint");
    const outcome = await runWithShortTimeout("v2_production_entry_live", () => runV2ProductionEntryLiveEndpoint({
      env: process.env,
      body: req.body,
      requestId: req.get("x-request-id") || req.get("X-Request-Id") || null,
    }), 120000);
    const resultOk = outcome.ok === true && outcome.result && outcome.result.ok === true;
    return res.status(resultOk ? 200 : 409).json({
      ...outcome,
      ok: resultOk,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
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
      "POST /api/openclaw/cron/v2-production-entry-route-canary",
      "POST /api/openclaw/cron/v2-exit-runtime-canary",
      "POST /api/openclaw/cron/v2-active-protection-reconciliation",
      "POST /api/openclaw/cron/openclaw-server-primary-tick",
      "POST /api/openclaw/cron/v2-signal-shadow-counterfactual-walker",
      "POST /api/openclaw/cron/v2-signal-shadow-counterfactual-analyzer",
      "POST /api/openclaw/cron/v2-production-entry-live",
    ],
    now_iso: new Date().toISOString(),
  });
});

module.exports = router;
