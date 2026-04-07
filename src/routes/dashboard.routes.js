// src/routes/dashboard.routes.js
const express = require("express");
const { getLastTrades } = require("../storage/firestore");

const { getLatestRun } = require("../storage/runLedger");
const { getLatestGateEvent } = require("../storage/gateEvents");

const {
  getRecentRuns,
  getRecentGates,
  getRecentSnapshots,
  getBarWindowCounters,
  getLatestPaperRun,
} = require("../storage/observability");

const { detectAccessScope } = require("../utils/accessScope");

function nowIso() {
  return new Date().toISOString();
}

function classifyTickResult(r) {
  if (!r) return { tick_type: "NONE", details: null };
  if (r.ok === false || r.stage === "ERROR") return { tick_type: "ERROR", details: { stage: r.stage || "ERROR" } };
  if (r.run_id) return { tick_type: "NEW_BAR_RECORDED", details: { run_id: r.run_id } };
  if (r.stage === "IDEMPOTENCY" || r.markets?.[0]?.stage === "IDEMPOTENCY") {
    return { tick_type: "IDEMPOTENCY_SKIP", details: { reason: r.markets?.[0]?.skip?.reason || null, cursor_ms: r.markets?.[0]?.skip?.cursor_ms ?? null } };
  }
  return { tick_type: "OTHER", details: { stage: r.stage || null } };
}

function createDashboardRoutes(stateMachine, scheduler) {
  const router = express.Router();

  router.get("/dashboard", async (req, res) => {
  // UI default: show dashboard home.
  // Debug: return JSON snapshot only when explicitly requested.
  const accept = String(req.headers.accept || "");
  const wantsJson = (String(req.query.raw || "") === "1") || accept.includes("application/json");
  if (!wantsJson) {
    return res.redirect(302, "/dashboard/home");
  }

    const snapshotAt = nowIso();
    const errors = [];
    const scopeDetected = detectAccessScope(req);

    const runtime = {
      mode: process.env.RUNTIME_MODE || "local",
      engine_version: process.env.ENGINE_VERSION || "baseline_v0",
      base_url: process.env.BASE_URL || null,
      node_env: process.env.NODE_ENV || null,
      google_cloud_project: process.env.GOOGLE_CLOUD_PROJECT || null,
      access_scope_env: process.env.ACCESS_SCOPE || "unknown",
      access_scope_detected: scopeDetected,
    };

    const costs = {
      fee_bps: Number(process.env.FEE_BPS || 0),
      slippage_bps: Number(process.env.SLIPPAGE_BPS || 0),
      funding_bps_per_8h: Number(process.env.FUNDING_BPS_PER_8H || 0),
    };

    const state = stateMachine.getState();
    const sched = scheduler.status();
    const tickSummary = classifyTickResult(sched.lastResult);

    let lastTrades = [];
    try { lastTrades = await getLastTrades(10); } catch (e) { errors.push({ part: "lastTrades", message: e?.message || String(e) }); }

    let latestRun = null;
    let latestGate = null;
    try { latestRun = await getLatestRun(); } catch (e) { errors.push({ part: "latest_run", message: e?.message || String(e) }); }
    try { latestGate = await getLatestGateEvent(); } catch (e) { errors.push({ part: "latest_gate", message: e?.message || String(e) }); }

    let recentRuns = [];
    let recentGates = [];
    let recentSnapshots = [];
    let barWindow = null;
    let latestPaperRun = null;

    try { recentRuns = await getRecentRuns(10); } catch (e) { errors.push({ part: "recent_runs", message: e?.message || String(e) }); }
    try { recentGates = await getRecentGates(10); } catch (e) { errors.push({ part: "recent_gates", message: e?.message || String(e) }); }
    try { recentSnapshots = await getRecentSnapshots(10); } catch (e) { errors.push({ part: "recent_snapshots", message: e?.message || String(e) }); }
    try { barWindow = await getBarWindowCounters({ windowBars: 24, gateFetchN: 500 }); } catch (e) { errors.push({ part: "bar_window_counters", message: e?.message || String(e) }); }
    try { latestPaperRun = await getLatestPaperRun({ lookbackN: 500 }); } catch (e) { errors.push({ part: "latest_paper_run", message: e?.message || String(e) }); }

    const sources = {
      state: "memory",
      scheduler: "memory",
      lastTrades: "firestore",
      latest_run: "firestore",
      latest_gate: "firestore",
      recent_runs: "firestore",
      recent_gates: "firestore",
      recent_snapshots: "firestore",
      bar_window_counters: "firestore_gate_events",
      latest_paper_run: "firestore_system_runs",
    };

    const latestError =
      latestRun?.meta?.error_code
        ? { error_code: latestRun.meta.error_code, error_message: latestRun.meta.error_message || null, error_chain: latestRun.meta.error_chain || [], run_id: latestRun.run_id, status: latestRun.status }
        : null;

    res.json({
      ok: true,
      snapshot_at: snapshotAt,
      sources,
      errors,
      runtime,
      costs,
      state,
      scheduler: {
        running: sched.running,
        pollMs: sched.pollMs,
        graceMs: sched.graceMs,
        lastCloseTime: sched.lastCloseTime,
        lastRun: sched.lastRun,
        lastResult: sched.lastResult,
        tick_summary: tickSummary,
        lastTickStartedAt: sched.lastTickStartedAt || null,
        expectedNextTickAt: sched.expectedNextTickAt || null,
        cursorMsMemory: sched.cursorMsMemory ?? null,
      },
      latest_run: latestRun,
      latest_gate: latestGate,
      latest_error: latestError,
      counters: { bar_window: barWindow },
      latest_paper_run: latestPaperRun,
      recent: { recent_runs: recentRuns, recent_gates: recentGates, recent_snapshots: recentSnapshots },
      lastTrades,
    });
  });

  // ── Lightweight polling endpoint for home dashboard ──
  router.get("/api/dashboard/pulse", async (req, res) => {
    try {
      const db = getFirestore();
      const exchange = String(req.query.exchange || "BINANCEFUT").toUpperCase();

      // Latest 3 signals
      const signalsSnap = await db.collection("signals")
        .where("exchange", "==", exchange)
        .orderBy("created_at", "desc")
        .limit(3)
        .get();
      const signals = signalsSnap.docs.map((d) => {
        const data = d.data();
        return {
          symbol: data.symbol_or_pair_id || data.symbol || null,
          event: data.event || null,
          entry_grade: (data.features_json && data.features_json.entry_grade) || null,
          source: (data.features_json && data.features_json.canonical_engine_candidate_source) || "SERVER",
          created_at: data.created_at || null,
          status: data.exec_plan ? (data.exec_plan.status || null) : null,
        };
      });

      // Latest 3 fills
      const fillsSnap = await db.collection("fills_paper")
        .where("exchange", "==", exchange)
        .orderBy("created_at", "desc")
        .limit(3)
        .get();
      const fills = fillsSnap.docs.map((d) => {
        const data = d.data();
        return {
          symbol: data.symbol || data.symbol_or_pair_id || null,
          event: data.event || null,
          exec_price: data.exec_price || null,
          created_at: data.created_at || null,
        };
      });

      // Active positions count
      const posSnap = await db.collection("positions_paper")
        .where("exchange", "==", exchange)
        .where("status", "==", "ACTIVE")
        .get();

      res.json({
        ok: true,
        ts: new Date().toISOString(),
        signals,
        fills,
        active_positions: posSnap.size,
      });
    } catch (e) {
      res.json({ ok: false, error: e.message || String(e), signals: [], fills: [], active_positions: 0 });
    }
  });

  return router;
}

module.exports = createDashboardRoutes;
