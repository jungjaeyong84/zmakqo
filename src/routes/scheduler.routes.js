const express = require("express");
const { createRun, finishRun, getLatestRun } = require("../storage/runLedger");
const { getFirestore } = require("../storage/firestore");
const { processSignalPaper } = require("../paper/engine");
const { getEffectiveExchangesSettings, getMultiExchangesSettings } = require("../utils/exchangeSettings");
const { defaultMarketsFromEnv, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { resolveExecTfForExchange } = require("../utils/resolveExchange");
const { TF_60M } = require("../config/frozen");

const { cleanupStalePendingIntents } = require("../services/intents.cleanup");
const { cleanupRetention } = require("../services/retention.cleanup");
const { runAiAllocation } = require("../services/aiAllocation");
const { runCostGuard } = require("../services/costGuardService");
const { fetchRecentNewFills, buildTradesFromFillsWithFunding } = require("../services/tradesFromFills");
const { resolveRealizedRowsByMarket } = require("../services/realizedPnlResolver");
const { runSelfEvolutionLoop } = require("../scheduler/selfEvolutionRunner");
const { runAnalyticsLocalCacheRefresh } = require("../scheduler/analyticsLocalCacheRunner");
const {
  runFeatureLabelDatasetJob,
  runShadowEvaluationSummaryJob,
  runShadowInferenceCanaryJob,
  runMlOpsPipelineJob,
} = require("../services/mlOpsPipeline");
const { runSystemRuntimeGuardsJob } = require("../services/systemRuntimeGuardsJob");
const { runTrailAuthorityFeedbackJob } = require("../services/trailAuthorityFeedback");
const { runRuntimeErrorFamilyRemediationJob } = require("../../scripts/runtime-error-family-remediation");

const DEFAULT_EXEC_TF = defaultExecTfFromEnv() || "15m";

// ─────────────────────────────────────────────
// Scheduler Auth (P0)
// - 로그인 세션(req.isAuthenticated()) OR 헤더 토큰(SCHEDULER_TOKEN) 통과
// ─────────────────────────────────────────────
function requireSchedulerAuth(req, res, next) {
  try {
    if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  } catch (_) {}

  // Local dev escape hatch
  if (String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1") return next();

  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const tokenFromHeader =
    String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || req.get("x_scheduler_token") || "");
  const tokenFromQuery =
    String(req.query.scheduler_token || req.query.token || "");
  const tokenFromBody = String(
    (req.body && (req.body.scheduler_token || req.body.token)) || ""
  );
  const token = tokenFromHeader || tokenFromQuery || tokenFromBody;

  if (!expected) {
    return res.status(500).json({ ok: false, error: "SERVER_MISCONFIG", message: "SCHEDULER_TOKEN not set" });
  }
  if (token !== expected) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  return next();
}

function msToIso(ms) {
  try { return new Date(ms).toISOString(); } catch (_) { return null; }
}
function nowIso() { return new Date().toISOString(); }

async function getLatestGateSnapshot(db, exchange) {
  const target = String(exchange || "").toUpperCase();
  try {
    const snap = await db.collection("gate_events").orderBy("created_at", "desc").limit(100).get();
    if (snap.empty) return null;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const ex = String(data.exchange || "").toUpperCase();
      if (!target || ex === target) return data;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function openClaudeBridgeRemoved(res) {
  return res.status(410).json({
    ok: false,
    error: "OPENCLAUDE_BRIDGE_REMOVED",
    message: "OpenClaude analysis bridge was removed.",
  });
}


async function getMarketsFromSettings() {
  const ex = await getEffectiveExchangesSettings(2000);
  return Array.isArray(ex.markets) && ex.markets.length ? ex.markets : defaultMarketsFromEnv(ex.provider);
}

async function getRunExchanges() {
  try {
    const multi = await getMultiExchangesSettings(2000);
    const list = Array.isArray(multi.exchanges) ? multi.exchanges : [];
    const providers = list
      .filter((x) => x && x.enabled !== false)
      .map((x) => String(x.provider || "").toUpperCase())
      .filter(Boolean);
    return providers;
  } catch (_) {
    return [];
  }
}

function pickCandidate(pool) {
  // deterministic selection contract
  pool.sort((a, b) => {
    const ams = Number(a.bar_close_time_utc_ms);
    const bms = Number(b.bar_close_time_utc_ms);
    if (bms !== ams) return bms - ams;

    const aside = String(a.side || "").toUpperCase();
    const bside = String(b.side || "").toUpperCase();
    const ap = (aside === "SELL") ? 0 : (aside === "BUY") ? 1 : 2;
    const bp = (bside === "SELL") ? 0 : (bside === "BUY") ? 1 : 2;
    if (ap !== bp) return ap - bp;

    const au = String(a.updated_at || a.created_at || "");
    const bu = String(b.updated_at || b.created_at || "");
    if (bu !== au) return bu.localeCompare(au);

    const ar = Number(a.revision || 0);
    const br = Number(b.revision || 0);
    if (br !== ar) return br - ar;

    const aid = String(a.signal_id || a.id || "");
    const bid = String(b.signal_id || b.id || "");
    return aid.localeCompare(bid);
  });
  return pool[0];
}

// ✅ CLAIM 원자화: state=PENDING & consumed=false인 경우만 CLAIMED로 전환
async function claimSignalTx({ db, signalDocId, runId, ttlMs }) {
  const ref = db.collection("signals").doc(signalDocId);
  const t = nowIso();
  const exp = new Date(Date.now() + ttlMs).toISOString();

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "SIGNAL_NOT_FOUND" };

    const cur = snap.data() || {};
    const consumed = Boolean(cur.consumed === true || cur.state === "EXECUTED");
    if (consumed) return { ok: false, reason: "ALREADY_EXECUTED" };

    const st = String(cur.state || "PENDING");
    const claimExp = cur.claim_expires_at || null;

    if (st === "CLAIMED" && claimExp && claimExp > t) {
      return { ok: false, reason: "ALREADY_CLAIMED" };
    }

    tx.set(ref, {
      state: "CLAIMED",
      consumed: false,
      claimed_at: t,
      claim_run_id: runId,
      claim_expires_at: exp,
      last_error: null,
      updated_at: t,
    }, { merge: true });

    return { ok: true, state: "CLAIMED", claimed_at: t, claim_expires_at: exp };
  });

  return out;
}

async function finalizeExecutedTx({ db, signalDocId, runId, execResult }) {
  const ref = db.collection("signals").doc(signalDocId);
  const t = nowIso();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const cur = snap.data() || {};
    if (cur.consumed === true || cur.state === "EXECUTED") return;

    tx.set(ref, {
      state: "EXECUTED",
      consumed: true,
      exec_run_id: runId,
      exec_result: execResult,
      consumed_at: t,
      consumed_run_id: runId,
      updated_at: t,
    }, { merge: true });
  });
}

async function finalizeFailedTx({ db, signalDocId, runId, errorMsg }) {
  const ref = db.collection("signals").doc(signalDocId);
  const t = nowIso();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const cur = snap.data() || {};
    if (cur.consumed === true || cur.state === "EXECUTED") return;

    tx.set(ref, {
      state: "FAILED",
      consumed: false,
      last_error: errorMsg,
      updated_at: t,
    }, { merge: true });
  });
}

// (레거시) 신호 소비/즉시 실행 루틴 — 기본 OFF
async function consumeAndExecuteOne({ runId, exchange, symbol, tf, barCloseMs }) {
  const db = getFirestore();

  const lookbackBars = Number(process.env.SIGNALS_LOOKBACK_BARS || 12);
  const intervalMs = 60 * 60 * 1000;
  const sinceMs = barCloseMs - lookbackBars * intervalMs;

  const snap = await db.collection("signals")
    .orderBy("bar_close_time_utc_ms", "desc")
    .limit(200)
    .get();

  const candidates = [];
  snap.forEach(d => candidates.push({ id: d.id, ...d.data() }));

  const pool = candidates.filter(s => {
    const ex = String(s.exchange || "").toUpperCase();
    const sym = s.symbol_or_pair_id || s.symbol || null;
    const tf0 = String(s.tf || "");
    const ms = Number(s.bar_close_time_utc_ms);

    if (ex !== exchange) return false;
    if (sym !== symbol) return false;
    if (tf0 !== tf) return false;
    if (!Number.isFinite(ms)) return false;
    if (ms < sinceMs || ms > barCloseMs) return false;

    if (s.consumed === true || s.state === "EXECUTED") return false;

    if (String(process.env.REQUIRE_SIGNAL_PRICE || "0") === "1") {
      const p = Number(s.price);
      if (!Number.isFinite(p)) return false;
    }
    return true;
  });

  if (pool.length === 0) {
    return { ok: true, consumed: false, reason: "NO_CANDIDATE" };
  }

  const chosen = pickCandidate(pool);
  const signalDocId = chosen.signal_id || chosen.id;

  const claim = await claimSignalTx({ db, signalDocId, runId, ttlMs: 90_000 });
  if (!claim.ok) {
    return { ok: true, consumed: false, reason: claim.reason, signal_id: signalDocId };
  }

  try {
    const side = String(chosen.side || "").toUpperCase();
    const sig = side === "SELL" ? "SELL" : side === "BUY" ? "BUY" : "HOLD";

    const px = Number(chosen.price);
    const payload = {
      symbol,
      tf,
      signal: sig,
      price: px,
      ts: chosen.bar_close_time_utc || msToIso(chosen.bar_close_time_utc_ms) || nowIso(),
      source: "signals",
      version: "legacy_consumer",
      reason_codes: [chosen.event || "UNKNOWN", chosen.reason || "UNKNOWN"],
    };

    const paper = await processSignalPaper({ runId, payload });
    const r0 = (paper && paper.results && paper.results[0]) ? paper.results[0] : {};

    const execResult = {
      action: sig,
      symbol,
      tf,
      bar_close_ms: Number(chosen.bar_close_time_utc_ms),
      price: px,
      order_id: r0.order_id || null,
      fill_id: r0.fill_id || null,
      net_pnl: (typeof r0.net_pnl === "number") ? r0.net_pnl : null,
      paper_ok: paper && paper.ok === true,
      paper_action: r0.action || null,
      paper_reason: r0.reason || null,
      at: nowIso(),
    };

    await finalizeExecutedTx({ db, signalDocId, runId, execResult });
    return { ok: true, consumed: true, signal_id: signalDocId, payload, paper };
  } catch (e) {
    await finalizeFailedTx({ db, signalDocId, runId, errorMsg: e.message });
    return { ok: false, consumed: false, signal_id: signalDocId, error: e.message };
  }
}

function createSchedulerRoutes(scheduler) {
  const router = express.Router();
  const statusCache = { ts: 0, payload: null };
  const statusTtlMs = Number(process.env.SCHED_STATUS_CACHE_MS || 10000);

  router.get("/scheduler/status", requireSchedulerAuth, async (req, res) => {
    const now = Date.now();
    if (statusCache.payload && Number.isFinite(statusCache.ts) && (now - statusCache.ts) < statusTtlMs) {
      res.set("Cache-Control", "private, max-age=5");
      return res.json(statusCache.payload);
    }
    const sched = scheduler.status?.() || {};
    const state = sched.state ?? null;
    const running = (typeof sched.running === "boolean")
      ? sched.running
      : (state === "RUNNING" || state === "EXIT_ONLY");

    let exchangeLabel = sched.exchange ?? null;
    let enabledExchanges = [];
    try {
      const multi = await getMultiExchangesSettings(1500);
      const list = Array.isArray(multi.exchanges) ? multi.exchanges : [];
      enabledExchanges = list.filter((x) => x && x.enabled !== false);
      if (enabledExchanges.length) {
        exchangeLabel = enabledExchanges.map((x) => String(x.provider || "").toUpperCase()).filter(Boolean).join("+");
      }
    } catch (_) {}

    const primaryExchange = enabledExchanges[0] || null;
    const signalTfCurrent =
      sched.signal_tf
      || (primaryExchange && Array.isArray(primaryExchange.tf_allowlist) && primaryExchange.tf_allowlist[0])
      || sched.tf
      || TF_60M;
    const execTfCurrent =
      sched.exec_tf
      || (primaryExchange && primaryExchange.exec_tf)
      || signalTfCurrent
      || null;

    let lastTick = sched.lastTick ?? null;
    if (!lastTick) {
      try {
        const latestRun = await getLatestRun();
        if (latestRun) {
          lastTick = {
            exchange: latestRun.meta?.exchange || exchangeLabel || null,
            tf: latestRun.meta?.tf || signalTfCurrent || null,
            exec_tf: execTfCurrent || null,
            started_at: latestRun.started_at || null,
            finished_at: latestRun.ended_at || null,
            overall_status: latestRun.summary?.overall_status || null,
            overall_gate_str: latestRun.summary?.overall_status || null,
          };
        }
      } catch (_) {}
    }

    const gateRaw = String(
      (lastTick && (lastTick.overall_gate_str || lastTick.overall_status || (lastTick.overall_gate && (lastTick.overall_gate.overall_status || lastTick.overall_gate.status))))
      || ""
    ).trim().toUpperCase();
    const shouldUseGateFallback =
      !gateRaw ||
      gateRaw === "-" ||
      gateRaw === "UNKNOWN" ||
      gateRaw === "SKIPPED" ||
      (lastTick && lastTick.skip_reason === "SCHEDULER_DISABLED");
    if (shouldUseGateFallback) {
      try {
        const db = getFirestore();
        const gateLatest = await getLatestGateSnapshot(db, exchangeLabel);
        if (gateLatest) {
          lastTick = {
            ...(lastTick || {}),
            exchange: (lastTick && lastTick.exchange) || exchangeLabel || gateLatest.exchange || null,
            tf: gateLatest.tf || signalTfCurrent || null,
            exec_tf: execTfCurrent || null,
            overall_status: gateLatest.status || null,
            overall_gate_str: gateLatest.status || null,
            overall_gate: {
              status: gateLatest.status || null,
              overall_status: gateLatest.status || null,
              severity: gateLatest.severity || null,
              reasonCodes: Array.isArray(gateLatest.reason_codes) ? gateLatest.reason_codes : [],
            },
          };
        }
      } catch (_) {}
    }

    const runtimeMode = process.env.RUNTIME_MODE || "local";
    const isLocalRuntime = runtimeMode === "local" || process.env.NODE_ENV !== "production";
    const schedulerManagedExternally = !isLocalRuntime && running !== true;

    const payload = {
      ok: true,
      scheduler: {
        exchange: exchangeLabel,
        tf: sched.tf ?? signalTfCurrent ?? null,
        signal_tf: signalTfCurrent ?? null,
        exec_tf: execTfCurrent ?? null,
        paperEnabled: sched.paperEnabled ?? null,
        state,
        running,
        lastTick,

        // legacy fields (kept for backwards compatibility)
        pollMs: sched.pollMs ?? null,
        graceMs: sched.graceMs ?? null,
        lastCloseTime: sched.lastCloseTime ?? null,
        lastRun: sched.lastRun ?? null,
        lastResult: sched.lastResult ?? null,
      },
      runtime: {
        mode: runtimeMode,
        engine_version: process.env.ENGINE_VERSION || "baseline_v0",
        scheduler_managed_externally: schedulerManagedExternally,
      },
    };
    statusCache.ts = now;
    statusCache.payload = payload;
    res.set("Cache-Control", "private, max-age=5");
    res.json(payload);
  });
  
  router.post("/scheduler/tick", requireSchedulerAuth, async (req, res) => {
    const exchange = String((req.body && (req.body.exchange || req.body.EXCHANGE)) || "BINANCEFUT").toUpperCase();
    const tf = String((req.body && (req.body.tf || req.body.TF)) || DEFAULT_EXEC_TF);

    // request-scoped runtime override: ALLOW_REPLAY_SAME_BAR
    const __prevAllowReplay = process.env.ALLOW_REPLAY_SAME_BAR;
    const __reqAllowReplay = (req.body && (req.body.ALLOW_REPLAY_SAME_BAR ?? req.body.allowReplaySameBar)) ?? null;
    if (__reqAllowReplay !== null && __reqAllowReplay !== undefined) {
      const on = String(__reqAllowReplay) === "1" || String(__reqAllowReplay).toLowerCase() === "true";
      process.env.ALLOW_REPLAY_SAME_BAR = on ? "1" : "0";
    }

    const runExchanges = await getRunExchanges();
    const exchangeLabel = runExchanges.length ? runExchanges.join("+") : exchange;
    const runId = `RUN__${exchange}__${tf}__${Date.now()}`;

    // create run-ledger entry
    try {
      await createRun({
        runId,
        engineVersion: process.env.ENGINE_VERSION,
        runtimeMode: process.env.RUNTIME_MODE,
        meta: {
          exchange: exchangeLabel,
          exchanges: runExchanges,
          tf,
          endpoint: "/scheduler/tick",
        },
      });
    } catch (e) {
      if (__prevAllowReplay === undefined) delete process.env.ALLOW_REPLAY_SAME_BAR;
      else process.env.ALLOW_REPLAY_SAME_BAR = __prevAllowReplay;
      return res.status(500).json({ ok: false, error: "RUN_LEDGER_FAILED", message: e.message });
    }

    try {
      const tickResult = await scheduler.tick({ runId });
      const tickErrors = Array.isArray(tickResult && tickResult.errors)
        ? tickResult.errors.slice(0, 50).map((e) => ({
          exchange: e && e.exchange ? e.exchange : null,
          market: e && e.market ? e.market : null,
          error: e && e.error ? e.error : (e && e.message ? e.message : String(e)),
        }))
        : [];
      
/* __PATCH_COPY_BAR_TIME_V1__ */

try {
  if (tickResult && tickResult.markets && Array.isArray(tickResult.markets)) {
    for (const mr of tickResult.markets) {
      const g = mr && mr.gate;
      const met = g && g.metrics ? g.metrics : null;
      if (met && typeof met.bar_close_time_utc_ms === "number") {
        mr.bar_close_time_utc_ms = met.bar_close_time_utc_ms;
        if (typeof met.bar_close_time_utc === "string") {
          mr.bar_close_time_utc = met.bar_close_time_utc;
        }
      }
    }
  }
} catch (e) {}

const markets = (tickResult && tickResult.markets) ? tickResult.markets : [];

      // 레거시 consume는 기본 OFF (중복체결 리스크 차단)
      const consumes = [];
      if (String(process.env.ENABLE_LEGACY_SIGNAL_CONSUME || "0") === "1") {
        const consumeSymbols = await getMarketsFromSettings();

        const baseBarCloseMs = (markets && markets[0] && Number(markets[0].bar_close_time_utc_ms)) || Number.NaN;

        for (const sym of consumeSymbols) {
          if (!Number.isFinite(baseBarCloseMs)) continue;
          const c = await consumeAndExecuteOne({
            runId,
            exchange,
            symbol: sym,
            tf,
            barCloseMs: baseBarCloseMs,
          });
          consumes.push({ market: sym, tf, ...c });
        }
      }

      // cleanup stale pending intents (no index)
      let cleanup = null;
      try {
        cleanup = await cleanupStalePendingIntents({ staleAfterMs: 2 * 60 * 60 * 1000, lookbackLimit: 500 });
      } catch (e) {
        cleanup = { ok: false, error: (e && e.message) ? e.message : String(e) };
      }

      const status = (tickResult && tickResult.ok) ? "DONE" : "DONE_WITH_ERRORS";
      try {
        await finishRun(runId, status, {
          errors: tickErrors,
          summary: {
            market_count: Array.isArray(markets) ? markets.length : 0,
            overall_status: tickResult && tickResult.overall_status,
            errors_count: tickErrors.length,
            consumes_count: consumes.length,
          },
        });
      } catch (_) {
        // ignore
      }

      return res.json({ ok: true, run_id: runId, tick_result: tickResult, consumes, cleanup });
    } catch (e) {
      try {
        await finishRun(runId, "FAILED", { error: (e && e.message) ? e.message : String(e) });
      } catch (_) {
        // ignore
      }
      return res.status(500).json({ ok: false, run_id: runId, error: "TICK_ERROR", message: e.message });
    } finally {
      if (__prevAllowReplay === undefined) delete process.env.ALLOW_REPLAY_SAME_BAR;
      else process.env.ALLOW_REPLAY_SAME_BAR = __prevAllowReplay;
    }
  });


// P2: multi-market tick wrapper (compat)
  // - scheduler.tick()가 자체적으로 BINANCEFUT_MARKETS 전체를 처리하므로, tick-multi는 alias 역할만 수행
  router.post("/scheduler/tick-multi", requireSchedulerAuth, async (req, res) => {
    const exchange = String((req.body && (req.body.exchange || req.body.EXCHANGE)) || "BINANCEFUT").toUpperCase();
    const tf = String((req.body && (req.body.tf || req.body.TF)) || DEFAULT_EXEC_TF);

    const __prevAllowReplay = process.env.ALLOW_REPLAY_SAME_BAR;
    try {
      if (req.body && typeof req.body.allow_replay_same_bar !== "undefined") {
        process.env.ALLOW_REPLAY_SAME_BAR = String(req.body.allow_replay_same_bar);
      }

      const runExchanges = await getRunExchanges();
      const exchangeLabel = runExchanges.length ? runExchanges.join("+") : exchange;
      const runId = `RUN__${exchange}__${tf}__${Date.now()}`;

      try {
        await createRun({
          runId,
          engineVersion: process.env.ENGINE_VERSION,
          runtimeMode: process.env.RUNTIME_MODE,
          meta: { exchange: exchangeLabel, exchanges: runExchanges, tf, mode: "SCHEDULER_TICK_MULTI" },
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: "RUN_CREATE_FAIL", message: e.message });
      }

      try {
        const tickResult = await scheduler.tick({ runId });
        const tickErrors = Array.isArray(tickResult && tickResult.errors)
          ? tickResult.errors.slice(0, 50).map((e) => ({
            exchange: e && e.exchange ? e.exchange : null,
            market: e && e.market ? e.market : null,
            error: e && e.error ? e.error : (e && e.message ? e.message : String(e)),
          }))
          : [];
        const status = tickResult && tickResult.ok ? "DONE" : "DONE_WITH_ERRORS";
        try {
          await finishRun(runId, status, {
            errors: tickErrors,
            summary: {
              overall_status: tickResult && tickResult.overall_status,
              market_count: Array.isArray(tickResult && tickResult.markets) ? tickResult.markets.length : 0,
              error_count: tickErrors.length,
            },
          });
        } catch (_) {}

        return res.json({ ok: true, run_id: runId, tick_result: tickResult });
      } catch (e) {
        try { await finishRun(runId, "FAILED", { error: { message: e.message } }); } catch (_) {}
        return res.status(500).json({ ok: false, error: "TICK_MULTI_FAIL", message: e.message });
      }
    } finally {
      if (typeof __prevAllowReplay === "undefined") delete process.env.ALLOW_REPLAY_SAME_BAR;
      else process.env.ALLOW_REPLAY_SAME_BAR = __prevAllowReplay;
    }
  });

  router.post("/scheduler/self-evolution", requireSchedulerAuth, async (req, res) => {
    try {
      const force = req.body && (req.body.force === true || String(req.body.force || "").toLowerCase() === "true" || String(req.body.force || "") === "1");
      const result = runSelfEvolutionLoop({
        trigger: force ? "scheduler_route_force" : "scheduler_route",
        force,
      });
      if (!result.ok && !result.skipped) {
        return res.status(500).json({ ok: false, error: "SELF_EVOLUTION_LOOP_FAIL", result });
      }
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "SELF_EVOLUTION_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

  router.post("/scheduler/analytics-local-cache-refresh", requireSchedulerAuth, async (req, res) => {
    try {
      const force = req.body && (req.body.force === true || String(req.body.force || "").toLowerCase() === "true" || String(req.body.force || "") === "1");
      const result = runAnalyticsLocalCacheRefresh({
        trigger: force ? "scheduler_route_force" : "scheduler_route",
        force,
        skipDependentReports: true,
      });
      if (!result.ok && !result.skipped) {
        return res.status(500).json({ ok: false, error: "ANALYTICS_LOCAL_CACHE_REFRESH_FAIL", result });
      }
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "ANALYTICS_LOCAL_CACHE_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

  router.post("/scheduler/feature-label-dataset", requireSchedulerAuth, async (req, res) => {
    try {
      const body = (req && req.body && typeof req.body === "object") ? req.body : {};
      const result = await runFeatureLabelDatasetJob({
        exchange: body.exchange || body.provider || null,
        markets: body.markets || null,
        tf: body.tf || null,
        limitN: body.limit_n || body.limitN || null,
        windowDays: body.window_days || body.windowDays || null,
        fromMs: body.from_ms || body.fromMs || null,
        force: body.force === true || String(body.force || "").trim() === "1",
      });
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "FEATURE_LABEL_DATASET_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

  router.post("/scheduler/shadow-eval-summary", requireSchedulerAuth, async (req, res) => {
    try {
      const body = (req && req.body && typeof req.body === "object") ? req.body : {};
      const result = await runShadowEvaluationSummaryJob({
        exchange: body.exchange || body.provider || null,
        fromMs: body.from_ms || body.fromMs || null,
        windowHours: body.window_hours || body.windowHours || null,
        limit: body.limit || null,
        force: body.force === true || String(body.force || "").trim() === "1",
      });
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "SHADOW_EVAL_SUMMARY_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

  router.post("/scheduler/shadow-inference-canary", requireSchedulerAuth, async (req, res) => {
    try {
      const body = (req && req.body && typeof req.body === "object") ? req.body : {};
      const result = await runShadowInferenceCanaryJob({
        exchange: body.exchange || body.provider || null,
        fromMs: body.from_ms || body.fromMs || null,
        windowHours: body.window_hours || body.windowHours || null,
        limit: body.limit || null,
        force: body.force === true || String(body.force || "").trim() === "1",
      });
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "SHADOW_INFERENCE_CANARY_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

  router.post("/scheduler/ml-ops-pipeline", requireSchedulerAuth, async (req, res) => {
    try {
      const body = (req && req.body && typeof req.body === "object") ? req.body : {};
      const result = await runMlOpsPipelineJob({
        exchange: body.exchange || body.provider || null,
        markets: body.markets || null,
        tf: body.tf || null,
        limitN: body.limit_n || body.limitN || null,
        windowDays: body.window_days || body.windowDays || null,
        fromMs: body.from_ms || body.fromMs || null,
        windowHours: body.window_hours || body.windowHours || null,
        limit: body.limit || null,
        force: body.force === true || String(body.force || "").trim() === "1",
      });
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "ML_OPS_PIPELINE_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

  router.post("/scheduler/system-runtime-guards", requireSchedulerAuth, async (req, res) => {
    try {
      const body = (req && req.body && typeof req.body === "object") ? req.body : {};
      const result = await runSystemRuntimeGuardsJob({
        exchange: body.exchange || body.provider || null,
        remediateOnBlock: body.remediate_on_block === false
          ? false
          : String(body.remediate_on_block || body.remediateOnBlock || "1").trim() !== "0",
        dryRun: body.dry_run === true || String(body.dry_run || body.dryRun || "").trim() === "1",
      });
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "SYSTEM_RUNTIME_GUARDS_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

  router.post("/scheduler/trail-authority-feedback", requireSchedulerAuth, async (req, res) => {
    try {
      const body = (req && req.body && typeof req.body === "object") ? req.body : {};
      const result = await runTrailAuthorityFeedbackJob({
        exchange: body.exchange || body.provider || null,
        lookbackHours: body.lookback_hours || body.lookbackHours || null,
        fetchLimit: body.fetch_limit || body.fetchLimit || body.limit || null,
      });
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "TRAIL_AUTHORITY_FEEDBACK_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

  router.post("/scheduler/runtime-error-family-remediation", requireSchedulerAuth, async (req, res) => {
    try {
      const result = await runRuntimeErrorFamilyRemediationJob();
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "RUNTIME_ERROR_FAMILY_REMEDIATION_ROUTE_FAIL", message: e && e.message ? e.message : String(e) });
    }
  });

router.post("/scheduler/kpi-batch", requireSchedulerAuth, async (req, res) => {
    const debug = { route: "scheduler/kpi-batch", started_at: new Date().toISOString() };
    try {
      const { getFirestore } = require("../storage/firestore");
      const { fetchRecentNewFills, buildTradesFromFillsWithFunding } = require("../services/tradesFromFills");
      const { calcKpi } = require("../services/kpiCalc");

      const db = getFirestore();

      const exCfg = await getEffectiveExchangesSettings(2000);
      const exchange = exCfg.provider || "BINANCEFUT";
      const tf = await resolveExecTfForExchange(exchange, exCfg.exec_tf || DEFAULT_EXEC_TF, 2000);
      const markets = await getMarketsFromSettings();
      debug.exchange = exchange;
      debug.tf = tf;
      debug.markets_n = Array.isArray(markets) ? markets.length : 0;

      const results = [];

      for (const m of markets) {
        try {
          const fills = await fetchRecentNewFills({ exchange, symbol: m, tf, limitN: 2000 });
          const mode = String(process.env.TRADE_PNL_MODE || "EACH_SELL");
          const { trades, closedTradePnls } = await buildTradesFromFillsWithFunding(fills, { mode, exchange, symbol: m });

          const kpi = calcKpi({ tradePnls: closedTradePnls, rollingN: 100 });

          const now = new Date().toISOString();
          const snapId = `KPI__${exchange}__${m}__${tf}__${now}`;

          const payload = {
            snapshot_id: snapId,
            computed_at: now,
            exchange,
            market: m,
            tf,
            window_type: "ROLLING_TRADES",
            window_n: 100,
            kpi,
          };

          await db.collection("kpi_snapshots").doc(snapId).set(payload, { merge: false });
          await db.collection("kpi_latest").doc(`KPI_LATEST__${exchange}__${m}__${tf}`).set(payload, { merge: true });

          results.push({
            market: m,
            status: kpi.status,
            n: kpi.n,
            win_rate: kpi.win_rate,
            quality_score: kpi.quality_score
          });
        } catch (err) {
          console.error("[KPI_BATCH_MARKET_ERROR]", {
            exchange,
            tf,
            market: m,
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : null,
          });
          throw err;
        }
      }

      debug.results_n = results.length;
      return res.json({ ok: true, exchange, tf, markets, results });
    } catch (e) {
      console.error("[KPI_BATCH_ERROR]", {
        ...debug,
        message: e && e.message ? e.message : String(e),
        stack: e && e.stack ? e.stack : null,
      });
      return res.status(500).json({ ok: false, error: "KPI_BATCH_ERROR", message: e.message });
    }
  });


  // AUTO WATCH: detect any NEW-style SELL fills and log it
  router.post("/scheduler/sell-watch", requireSchedulerAuth, async (req, res) => {
    try {
      const { getFirestore } = require("../storage/firestore");
      const db = getFirestore();

      const snap = await db.collection("fills_paper")
        .orderBy("created_at","desc")
        .limit(200)
        .get();

      let found = 0;
      const { isLiveDocForExchange } = require("../utils/liveOnly");
      snap.forEach(d => {
        const x = d.data() || {};
        if (!isLiveDocForExchange(x.exchange || "", x)) return;
        const isNew = !!x.exec_price_source;
        const side = String(x.side || "").toUpperCase();
        if (isNew && side === "SELL") {
          found += 1;
          console.log("[AUTO-WATCH][SELL_DETECTED]", {
            market: x.symbol,
            exec_ms: x.exec_bar_close_time_utc_ms,
            price: x.exec_price,
            qty_pct: x.qty_pct,
            event: x.event,
            created_at: x.created_at,
            fill_id: x.fill_id || d.id,
          });
        }
      });

      if (found === 0) {
        console.log("[AUTO-WATCH] no SELL in last window");
      }

      
      // SELL_WATCH_TRIGGERS_KPI_BATCH_V1
      // SELL 감지 시 즉시 KPI 재계산(표본 축적을 숫자로 반영)
      if (found > 0) {
        try {
          // 내부 스케줄러 라우트의 /scheduler/kpi-batch와 동일한 로직을 호출할 수 없으므로,
          // 여기서는 "kpi_latest 갱신"을 위해 간단히 해당 함수들을 직접 호출한다.
          // (기존 kpi-batch 라우트가 사용하는 calcKpi 흐름을 재사용)
          const { calcKpi } = require("../services/kpiCalc");
          const { buildTradesFromFillsWithFunding, fetchRecentNewFills } = require("../services/tradesFromFills");
          const db2 = getFirestore();

          const markets = await getMarketsFromSettings();
          const exCfg2 = await getEffectiveExchangesSettings(2000);
          const exchange = exCfg2.provider || "BINANCEFUT";
          const tf = await resolveExecTfForExchange(exchange, exCfg2.exec_tf || DEFAULT_EXEC_TF, 2000);

          const results = [];
          for (const market of markets) {
            // 신형 fill만: tradesFromFills가 exec_price_source로 필터함
            const fills = await fetchRecentNewFills({ exchange, symbol: market, tf, limitN: 4000 });
            const { closedTradePnls } = await buildTradesFromFillsWithFunding(fills, { exchange, symbol: market });
            const kpi = calcKpi({ tradePnls: closedTradePnls, rollingN: 100 });

            const docId = `KPI_LATEST__${exchange}__${market}__${tf}`;
            const now = new Date().toISOString();
            const snapId = `KPI__${exchange}__${market}__${tf}__${now}`;
            const payload = {
              snapshot_id: snapId,
              computed_at: now,
              exchange,
              market,
              tf,
              window_type: "ROLLING_TRADES",
              window_n: 100,
              kpi,
            };
            await db2.collection("kpi_latest").doc(docId).set(payload, { merge: true });

            results.push({ market, status: kpi.status, n: kpi.n });
          }

          console.log("[SELL_WATCH][KPI_BATCH_TRIGGERED]", { found, results });
        } catch (e) {
          console.log("[SELL_WATCH][KPI_BATCH_FAILED]", { found, error: e.message });
        }
      }

// REALIZED_24H_AGG_V3: pre-aggregate realized 24h stats for briefing (income-api first)
// Run only when a SELL fill was detected in this scan window.
if (found > 0) {
  try {
      const markets = await getMarketsFromSettings();
      const exCfg3 = await getEffectiveExchangesSettings(2000);
      const exchange = exCfg3.provider || "BINANCEFUT";
    const execTf = await resolveExecTfForExchange(exchange, DEFAULT_EXEC_TF, 2000);
    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    const fillsLimit = Math.max(50, Math.min(4000, Math.trunc(Number(process.env.DASHBOARD_FILLS_LIMIT || 2000))));
    const mode2 = String(process.env.TRADE_PNL_MODE || "EACH_SELL");
    const realizedResolved = await resolveRealizedRowsByMarket({
      exchange,
      markets,
      tf: execTf || DEFAULT_EXEC_TF,
      fallbackTf: DEFAULT_EXEC_TF,
      limitN: fillsLimit,
      fromMs: sinceMs,
      toMs: Date.now() + 1,
      mode: mode2,
      includeAllIncomeMarkets: true,
    });
    const realizedByMarket = {};
    for (const mkt of (realizedResolved && Array.isArray(realizedResolved.markets) ? realizedResolved.markets : markets)) {
      const bucket = realizedResolved && realizedResolved.by_market ? realizedResolved.by_market[mkt] : null;
      let sells = 0;
      let sumPct = 0;
      let sumKrw = 0;
      for (const row of (bucket && Array.isArray(bucket.rows) ? bucket.rows : [])) {
        const ms = Number(row && row.close_ms);
        if (!Number.isFinite(ms) || ms < sinceMs) continue;
        const pnlKrw = Number(row && row.pnl_krw);
        if (!Number.isFinite(pnlKrw)) continue;
        sells += 1;
        sumKrw += pnlKrw;
        const notional = Number(row && row.notional_krw);
        if (Number.isFinite(notional) && notional !== 0) sumPct += (pnlKrw / notional);
      }
      realizedByMarket[mkt] = {
        sells_24h: sells,
        pnl_pct_sum_24h: sumPct,
        pnl_krw_sum_24h: sumKrw,
        source_mode: (bucket && bucket.source_mode) ? String(bucket.source_mode) : "NONE",
      };
    }

    const realizedAggTf = execTf || DEFAULT_EXEC_TF;
    await db.collection("briefing_agg").doc(`REALIZED_24H__${exchange}__${realizedAggTf}`).set({
      updated_at: new Date().toISOString(),
      exchange,
      tf: realizedAggTf,
      since_ms: sinceMs,
      policy_version: "REALIZED_24H_AGG_V3",
      source_mode: realizedResolved && realizedResolved.source_mode ? String(realizedResolved.source_mode) : "NONE",
      source_policy: realizedResolved && realizedResolved.source_policy ? String(realizedResolved.source_policy) : null,
      source_breakdown: realizedResolved && realizedResolved.source_breakdown ? realizedResolved.source_breakdown : null,
      by_market: realizedByMarket,
    }, { merge: true });
  } catch (e) {
    // ignore (aggregation is best-effort)
  }
}

return res.json({ ok: true, found });
} catch (e) {
      return res.status(500).json({ ok: false, error: "SELL_WATCH_ERROR", message: e.message });
    }
  });


  // AUTO WATCH: detect KPI transition (n > 0) and log it
  router.post("/scheduler/kpi-watch", requireSchedulerAuth, async (req, res) => {
    try {
      const { getFirestore } = require("../storage/firestore");
      const db = getFirestore();

      const snap = await db.collection("kpi_latest")
        .limit(500)
        .get();

      let found = 0;
      snap.forEach(d => {
        const x = d.data() || {};
        const market = x.market;
        const n = x.kpi && typeof x.kpi.n === "number" ? x.kpi.n : 0;
        const status = x.kpi && x.kpi.status ? x.kpi.status : "UNKNOWN";
        const computedAt = x.computed_at || null;

        if (n > 0) {
          found += 1;
          console.log("[AUTO-WATCH][KPI_READY]", { market, n, status, computed_at: computedAt });
        }
      });

      if (found === 0) {
        console.log("[AUTO-WATCH] KPI not ready yet (all n=0)");
      }

      return res.json({ ok: true, found });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "KPI_WATCH_ERROR", message: e.message });
    }
  });

  router.post("/scheduler/cost-guard", requireSchedulerAuth, async (req, res) => {
    try {
      const body = (req && req.body && typeof req.body === "object") ? req.body : {};
      const query = (req && req.query && typeof req.query === "object") ? req.query : {};
      const dryRunRaw = body.dry_run ?? query.dry_run ?? body.dryRun ?? query.dryRun;
      const dryRun = String(dryRunRaw || "").trim().toLowerCase();
      const applyProtection = !(dryRun === "1" || dryRun === "true" || dryRun === "yes");

      const projectId = String(
        body.project_id ||
        query.project_id ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        "donbeolja-dev"
      ).trim();

      const serviceName = String(
        body.service ||
        query.service ||
        process.env.K_SERVICE ||
        process.env.COST_GUARD_SERVICE ||
        "donbeolja"
      ).trim();

      const out = await runCostGuard({
        projectId,
        serviceName,
        billingExportTable: body.billing_export_table || query.billing_export_table || process.env.BILLING_EXPORT_TABLE,
        dayThresholdKrw: body.day_threshold_krw ?? query.day_threshold_krw ?? process.env.DAY_THRESHOLD_KRW,
        fallbackSpikeCount: body.fallback_spike_count ?? query.fallback_spike_count ?? process.env.FALLBACK_SPIKE_COUNT,
        queryBarsFallbackSpikeCount:
          body.query_bars_fallback_spike_count ??
          query.query_bars_fallback_spike_count ??
          process.env.QUERY_BARS_FALLBACK_SPIKE_COUNT,
        lookbackMin: body.lookback_min ?? query.lookback_min ?? process.env.LOOKBACK_MIN,
        forceOpenMs: body.force_open_ms ?? query.force_open_ms ?? process.env.COST_GUARD_FORCE_OPEN_MS,
        applyProtection,
      });

      return res.json({ ok: true, dry_run: !applyProtection, ...out });
    } catch (e) {
      console.warn("[COST_GUARD_ROUTE_ERROR]", e && e.message ? e.message : String(e));
      return res.status(500).json({ ok: false, error: "COST_GUARD_ERROR", message: e && e.message ? e.message : String(e) });
    }
  });

  // Retention cleanup: delete old Firestore docs by policy
  router.post("/scheduler/retention-cleanup", requireSchedulerAuth, async (req, res) => {
    try {
      const limit = Number(req.body && req.body.limit) || Number(process.env.RETENTION_CLEANUP_LIMIT || 500);
      const dryRun = String((req.body && req.body.dry_run) || "") === "1" || String(req.query.dry_run || "") === "1";
      const out = await cleanupRetention({ limitPerCollection: limit, dryRun });
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: "RETENTION_CLEANUP_ERROR", message: e.message });
    }
  });

  // AI allocation: update risk budget based on news + quant weights
  router.post("/scheduler/ai-allocation", requireSchedulerAuth, async (req, res) => {
    try {
      const dryRun = String((req.body && req.body.dry_run) || "") === "1" || String(req.query.dry_run || "") === "1";
      const force = String((req.body && req.body.force) || "") === "1" || String(req.query.force || "") === "1";
      const provider = req.body && (req.body.provider || req.body.exchange);
      if (!provider) {
        const cfg = await getMultiExchangesSettings(3000);
        const providers = (cfg && Array.isArray(cfg.exchanges) ? cfg.exchanges : [])
          .filter((x) => x && x.enabled !== false)
          .map((x) => x.provider)
          .filter(Boolean);
        const results = [];
        for (const p of providers) {
          const out = await runAiAllocation({ apply: !dryRun, provider: p, force });
          results.push({ provider: p, ...out });
        }
        return res.json({ ok: true, results });
      }
      const out = await runAiAllocation({ apply: !dryRun, provider, force });
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: "AI_ALLOCATION_ERROR", message: e.message });
    }
  });

  // OpenClaude analysis bridge endpoints are intentionally removed.
  router.post("/scheduler/openclaude-analyze", requireSchedulerAuth, async (req, res) => {
    return openClaudeBridgeRemoved(res);
  });

  router.get("/scheduler/openclaude-latest", requireSchedulerAuth, async (req, res) => {
    return openClaudeBridgeRemoved(res);
  });

  router.get("/scheduler/openclaude-context", requireSchedulerAuth, async (req, res) => {
    return openClaudeBridgeRemoved(res);
  });

  return router;
}

module.exports = createSchedulerRoutes;
