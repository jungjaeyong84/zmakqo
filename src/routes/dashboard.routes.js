// src/routes/dashboard.routes.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { getLastTrades, getFirestore } = require("../storage/firestore");
const { listExchangePositionReadViews } = require("../services/positionReadModel");

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
const { loadSystemRuntimeGuardView } = require("../services/systemRuntimeGuardView");
const { planOperatorSafeModeAction } = require("../v2/operatorSafeMode");
const { buildRunbookDiagnosticPlan } = require("../v2/runbookDiagnosticRunner");

function nowIso() {
  return new Date().toISOString();
}

const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");
const MIN_LIVE_COVERAGE_MINUTES = 24 * 60;

function readJsonSafe(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(OPS_DAILY_DIR, filename), "utf8"));
  } catch (_) {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function runtimeFlag(name, fallback = null) {
  const value = process.env[name];
  return value === undefined ? fallback : String(value);
}

function summarizeCanary(row) {
  const source = row && typeof row === "object" ? row : {};
  return {
    ok: source.ok === true,
    reason: source.reason || null,
    generated_at: source.generated_at || null,
    position_cycle_id: source.position_cycle_id || null,
    coverage_minutes: numOrNull(source.coverage_minutes),
    coverage_target_minutes: MIN_LIVE_COVERAGE_MINUTES,
    healthy_run_n: numOrNull(source.healthy_run_n),
    unhealthy_run_n: numOrNull(source.unhealthy_run_n),
    latest_age_minutes: numOrNull(source.latest_age_minutes),
    max_observed_gap_minutes: numOrNull(source.max_observed_gap_minutes),
    blockers: asArray(source.blockers),
    history_source: source.history_source || null,
    tp1_missing_n: numOrNull(source.tp1_missing_n),
    native_refresh_unhealthy_n: numOrNull(source.native_refresh_unhealthy_n),
    unprotected_window_violation_n: numOrNull(source.unprotected_window_violation_n),
    trail_activation_evidence_gap_n: numOrNull(source.trail_activation_evidence_gap_n),
  };
}

function summarizePerformanceGate(row) {
  const source = row && typeof row === "object" ? row : {};
  const metrics = source.metrics && typeof source.metrics === "object" ? source.metrics : {};
  return {
    ok: source.ok === true,
    reason: source.reason || null,
    blockers: asArray(source.blockers),
    sample_n: numOrNull(metrics.sample_n),
    win_rate_pct: numOrNull(metrics.win_rate_pct),
    profit_factor: numOrNull(metrics.profit_factor),
    expectancy_r: numOrNull(metrics.expectancy_r),
    net_pnl_pct: numOrNull(metrics.net_pnl_pct),
    net_pnl_usdt: numOrNull(metrics.net_pnl_usdt),
    generated_at: source.generated_at || metrics.generated_at || null,
  };
}

function summarizeFirestoreCostGuard(row) {
  const source = row && typeof row === "object" ? row : {};
  return {
    ok: source.ok === true,
    reason: source.reason || null,
    blockers: asArray(source.blockers),
    estimated_total_reads: numOrNull(source.estimated_total_reads),
    collector_query_limit_total: numOrNull(source.collector_query_limit_total),
    billing_metric_required: source.billing_metric_required === true,
    billing_read_ops_total: numOrNull(source.billing_read_ops_total),
    billing_metric_row_n: asArray(source.billing_metric_rows).length,
    generated_at: source.generated_at || null,
  };
}

function summarizeDiscoveryCanaryPolicy() {
  return {
    enabled: runtimeFlag("DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED", "0") === "1",
    allowed_symbols: String(runtimeFlag("DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS", "") || "")
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean),
    max_notional_quote: numOrNull(runtimeFlag("DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE", "6")),
    max_position_count: numOrNull(runtimeFlag("DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT", "1")),
    max_trades_per_day: numOrNull(runtimeFlag("DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY", "1")),
    daily_loss_halt_quote: numOrNull(runtimeFlag("DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE", "10")),
    confirm_phrase: "EXECUTE_V2_DISCOVERY_CANARY",
  };
}

function summarizeGenericGate(row, fallbackReason) {
  const source = row && typeof row === "object" ? row : {};
  return {
    ok: source.ok === true,
    reason: source.reason || fallbackReason || null,
    blockers: asArray(source.blockers),
    warnings: asArray(source.warnings),
    generated_at: source.generated_at || null,
    metrics: source.metrics && typeof source.metrics === "object" ? source.metrics : {},
  };
}

function buildV2MissionControlSnapshot() {
  const entryCanary = summarizeCanary(readJsonSafe("v2_production_entry_route_canary_streak_latest.json"));
  const exitCanary = summarizeCanary(readJsonSafe("v2_exit_runtime_canary_streak_latest.json"));
  const repairCanary = summarizeCanary(readJsonSafe("v2_repair_queue_firestore_canary_streak_latest.json"));
  const performanceGate = summarizePerformanceGate(readJsonSafe("v2_performance_gate_latest.json"));
  const firestoreCostGuard = summarizeFirestoreCostGuard(readJsonSafe("v2_firestore_cost_guard_latest.json"));
  const riskGovernor = summarizeGenericGate(readJsonSafe("v2_risk_governor_latest.json"), "V2_RISK_GOVERNOR_NOT_COLLECTED");
  const policyPromotion = summarizeGenericGate(readJsonSafe("v2_openclaw_policy_promotion_gate_latest.json"), "OPENCLAW_POLICY_PROMOTION_NOT_COLLECTED");
  const marketDataQuality = summarizeGenericGate(readJsonSafe("v2_market_data_quality_latest.json"), "V2_MARKET_DATA_QUALITY_NOT_COLLECTED");
  const discoveryCanary = summarizeDiscoveryCanaryPolicy();
  const liveEvidence = readJsonSafe("v2_live_evidence_readiness_latest.json");

  const blockers = [
    ...asArray(entryCanary.blockers),
    ...asArray(exitCanary.blockers),
    ...asArray(repairCanary.blockers),
    ...asArray(performanceGate.blockers),
    ...asArray(firestoreCostGuard.blockers),
    ...asArray(riskGovernor.blockers),
    ...asArray(policyPromotion.blockers),
    ...asArray(marketDataQuality.blockers),
  ];
  if (entryCanary.ok !== true) blockers.push("V2_SITE:ENTRY_24H_CANARY_NOT_READY");
  if (exitCanary.ok !== true) blockers.push("V2_SITE:EXIT_24H_CANARY_NOT_READY");
  if (repairCanary.ok !== true) blockers.push("V2_SITE:REPAIR_24H_CANARY_NOT_READY");
  if (performanceGate.ok !== true) blockers.push("V2_SITE:PERFORMANCE_GATE_NOT_READY");
  if (firestoreCostGuard.ok !== true) blockers.push("V2_SITE:FIRESTORE_COST_GUARD_NOT_READY");
  if (riskGovernor.ok === false && riskGovernor.reason !== "V2_RISK_GOVERNOR_NOT_COLLECTED") blockers.push("V2_SITE:RISK_GOVERNOR_NOT_READY");
  if (policyPromotion.ok === false && policyPromotion.reason !== "OPENCLAW_POLICY_PROMOTION_NOT_COLLECTED") blockers.push("V2_SITE:POLICY_PROMOTION_NOT_READY");
  if (marketDataQuality.ok === false && marketDataQuality.reason !== "V2_MARKET_DATA_QUALITY_NOT_COLLECTED") blockers.push("V2_SITE:MARKET_DATA_QUALITY_NOT_READY");

  const v2Enabled = runtimeFlag("DONBEOLJA_V2_ENABLED", "0");
  const canaryOnly = runtimeFlag("DONBEOLJA_V2_CANARY_ONLY", "1");
  const liveEndpointEnabled = runtimeFlag("DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED", "0");
  const allowLegacyWebhook = runtimeFlag("DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL", "0");
  const schedulerCutoverMode = runtimeFlag("DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE", null);

  let verdict = "CANARY_RUNNING";
  if (v2Enabled !== "1") verdict = "V2_DISABLED";
  else if (blockers.length > 0) verdict = "LIVE_READY_BLOCKED";
  else if (canaryOnly === "1" || liveEndpointEnabled !== "1") verdict = "CANARY_READY_ONLY";
  else verdict = "LIVE_READY";

  return {
    ok: true,
    snapshot_at: nowIso(),
    mode: "V2",
    verdict,
    live_evidence_ready: liveEvidence && liveEvidence.ok === true ? true : false,
    scheduler_cutover: schedulerCutoverMode === "OPENCLAW_CRON" ? "OPENCLAW_CRON" : (schedulerCutoverMode || "UNKNOWN"),
    runtime_flags: {
      v2_enabled: v2Enabled,
      dry_run: runtimeFlag("DONBEOLJA_V2_DRY_RUN", "1"),
      canary_only: canaryOnly,
      live_endpoint_enabled: liveEndpointEnabled,
      block_legacy_webhook_signal: runtimeFlag("DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL", "1"),
      allow_legacy_webhook_signal: allowLegacyWebhook,
      scheduler_cutover_mode: schedulerCutoverMode,
      openclaw_agent_apply_enabled: runtimeFlag("OPENCLAW_AGENT_APPLY_ENABLED", "0"),
      openclaw_conductor_shadow_only: runtimeFlag("OPENCLAW_CONDUCTOR_SHADOW_ONLY", "1"),
      firestore_cost_guard_require_billing_metric: runtimeFlag("V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC", "0"),
      discovery_canary_enabled: runtimeFlag("DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED", "0"),
    },
    discovery_canary: discoveryCanary,
    entry_canary: entryCanary,
    exit_canary: exitCanary,
    repair_canary: repairCanary,
    performance_gate: performanceGate,
    firestore_cost_guard: firestoreCostGuard,
    risk_governor: riskGovernor,
    policy_promotion: policyPromotion,
    market_data_quality: marketDataQuality,
    live_evidence: liveEvidence ? {
      ok: liveEvidence.ok === true,
      reason: liveEvidence.reason || null,
      blocker_n: numOrNull(liveEvidence.blocker_n),
      blockers: asArray(liveEvidence.blockers),
      artifact_dir: liveEvidence.artifact_dir || null,
      position_cycle_id: liveEvidence.position_cycle_id || null,
    } : null,
    blockers: Array.from(new Set(blockers)),
    diagnostic_plan: buildRunbookDiagnosticPlan({ blockers }),
  };
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

  router.get("/api/v2/mission-control", (req, res) => {
    res.json(buildV2MissionControlSnapshot());
  });

  router.post("/api/v2/operator/safe-action", express.json({ limit: "32kb" }), (req, res) => {
    const result = planOperatorSafeModeAction({
      action: req.body && req.body.action,
      options: req.body && req.body.options,
      confirm: req.body && req.body.confirm,
      env: process.env,
    });
    res.status(result.ok ? 200 : 409).json(result);
  });

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
    let activePositions = 0;
    let systemRuntimeGuards = null;

    try { recentRuns = await getRecentRuns(10); } catch (e) { errors.push({ part: "recent_runs", message: e?.message || String(e) }); }
    try { recentGates = await getRecentGates(10); } catch (e) { errors.push({ part: "recent_gates", message: e?.message || String(e) }); }
    try { recentSnapshots = await getRecentSnapshots(10); } catch (e) { errors.push({ part: "recent_snapshots", message: e?.message || String(e) }); }
    try { barWindow = await getBarWindowCounters({ windowBars: 24, gateFetchN: 500 }); } catch (e) { errors.push({ part: "bar_window_counters", message: e?.message || String(e) }); }
    try { latestPaperRun = await getLatestPaperRun({ lookbackN: 500 }); } catch (e) { errors.push({ part: "latest_paper_run", message: e?.message || String(e) }); }
    try { systemRuntimeGuards = await loadSystemRuntimeGuardView({ exchange: "BINANCEFUT" }); } catch (e) { errors.push({ part: "system_runtime_guards", message: e?.message || String(e) }); }
    try {
      const readPositions = await listExchangePositionReadViews({ exchange: "BINANCEFUT" });
      activePositions = readPositions.filter((row) => {
        const stateName = String(row && (row.position_state || row.state) || "").toUpperCase();
        const sizePct = Number(row && row.size_pct);
        return stateName !== "FLAT" && Number.isFinite(sizePct) && sizePct > 0;
      }).length;
    } catch (e) { errors.push({ part: "active_positions", message: e?.message || String(e) }); }

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
      system_runtime_guards: "firestore_runtime_state",
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
      system_runtime_guards: systemRuntimeGuards,
      counters: { bar_window: barWindow },
      latest_paper_run: latestPaperRun,
      active_positions: activePositions,
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
      const readPositions = await listExchangePositionReadViews({ exchange });
      const activePositions = readPositions.filter((row) => {
        const state = String(row && (row.position_state || row.state) || "").toUpperCase();
        const sizePct = Number(row && row.size_pct);
        return state !== "FLAT" && Number.isFinite(sizePct) && sizePct > 0;
      }).length;
      const systemRuntimeGuards = await loadSystemRuntimeGuardView({ exchange });

      res.json({
        ok: true,
        ts: new Date().toISOString(),
        signals,
        fills,
        active_positions: activePositions,
        system_runtime_guards: systemRuntimeGuards,
      });
    } catch (e) {
      res.json({ ok: false, error: e.message || String(e), signals: [], fills: [], active_positions: 0, system_runtime_guards: null });
    }
  });

  return router;
}

module.exports = createDashboardRoutes;
