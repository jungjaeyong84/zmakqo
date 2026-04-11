"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const env = require("../config/env");
const { fetchBarCloseTime } = require("../utils/barTimeFetch");
const { fetchCandles } = require("../exchanges");
const { upsertBarSnapshot, queryBars } = require("../storage/barsSnapshots");
const { upsertGateEvent } = require("../storage/gateEvents");
const gateMod = require("../storage/gate");
const getGateStatus = gateMod.getGateStatusAsync || gateMod.getGateStatus;
const { getCursor, setCursor } = require("../storage/cursors");
const { getFirestore } = require("../storage/firestore");
const { listSignalsByMarket } = require("../storage/signalsQuery");
const { findRecentWebhookSummaryForBar } = require("../storage/webhookLedger");
const { runPaperMarket, syncFuturesPositionOnly, resolveFuturesPositionSyncRequest } = require("../engine/paperBinanceRunner");
const { tfToMs, normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { computeTradingMode: computeGateTradingMode } = require("../utils/tradingMode");
const { sendSignalCompareAlert } = require("../services/signalLifecycleAlert");
const { TF_60M } = require("../config/frozen");

const ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const SERVER_SIGNAL_GENERATION_TRACE_LATEST = path.join(OPS_DAILY, "server_signal_generation_trace_latest.json");

const DEFAULT_EXEC_TF = normalizeTf(defaultExecTfFromEnv()) || "15m";
const MARKET_RUNNER_BAR_CLAIM_TTL_MS = Math.max(3000, Number(process.env.MARKET_RUNNER_BAR_CLAIM_TTL_MS) || 120000);
const MARKET_RUNNER_BAR_CLAIM_WAIT_MS = Math.max(0, Number(process.env.MARKET_RUNNER_BAR_CLAIM_WAIT_MS) || 2000);
const marketRunnerBarClaimHolderId = [
  String(process.env.K_REVISION || process.env.HOSTNAME || os.hostname() || "local"),
  String(process.pid || "0"),
].join("__");

function graceMs() {
  const v = Number(env.scheduler.graceMs || 15000);
  return Number.isFinite(v) && v >= 0 ? v : 15000;
}

function computeMaxLagMs(tf) {
  const envMax = Number(env.gate.maxLagMs);
  const tfMs = tfToMs(tf);
  const tfAware = (!Number.isFinite(tfMs) || tfMs <= 0)
    ? 6 * 60 * 1000
    : Math.max(6 * 60 * 1000, Math.round(tfMs * 1.1));
  if (Number.isFinite(envMax) && envMax > 0) return Math.max(envMax, tfAware);
  return tfAware;
}

function pickTf({ stateTf, tfAllowlist } = {}) {
  const list = Array.isArray(tfAllowlist) ? tfAllowlist.filter(Boolean) : [];
  if (stateTf && list.includes(stateTf)) return stateTf;
  if (list.length) return list[0];
  return stateTf || DEFAULT_EXEC_TF;
}

function buildRunId({ exchange, market, tf, execTf, barCloseMs: barCloseMs_f }) {
  const label = String(execTf || tf || DEFAULT_EXEC_TF);
  return `RUN__${exchange}__${market}__${label}__${barCloseMs_f}`;
}

function buildMarketRunnerBarClaimDocPath({ exchange, market, tf, barCloseMs } = {}) {
  return [
    "runtime_locks",
    `market_runner_bar__${String(exchange || "").toUpperCase()}__${String(market || "").toUpperCase()}__${String(tf || DEFAULT_EXEC_TF).toUpperCase()}__${Number(barCloseMs || 0)}`
  ].join("/");
}

async function acquireMarketRunnerBarClaim({
  exchange,
  market,
  tf,
  barCloseMs,
  ttlMs = MARKET_RUNNER_BAR_CLAIM_TTL_MS,
  holderId = marketRunnerBarClaimHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || MARKET_RUNNER_BAR_CLAIM_TTL_MS));
  const ref = db.doc(buildMarketRunnerBarClaimDocPath({ exchange, market, tf, barCloseMs }));
  let acquired = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const owner = String(data.owner || "");
    const leaseUntilMs = Number(data.lease_until_ms);
    const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
    if (!owner || owner === holderId || expired) {
      acquired = true;
      tx.set(ref, {
        owner: holderId,
        lease_until_ms: leaseUntil,
        heartbeat_ms: now,
        heartbeat_at: new Date(now).toISOString(),
        exchange: String(exchange || "").toUpperCase(),
        symbol_or_pair_id: String(market || "").toUpperCase(),
        tf: String(tf || DEFAULT_EXEC_TF),
        bar_close_time_utc_ms: Number(barCloseMs || 0) || null,
      }, { merge: true });
      return;
    }
    holder = owner || null;
  });
  return { acquired, holder, holderId, leaseUntil };
}

async function heartbeatMarketRunnerBarClaim({
  exchange,
  market,
  tf,
  barCloseMs,
  ttlMs = MARKET_RUNNER_BAR_CLAIM_TTL_MS,
  holderId = marketRunnerBarClaimHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || MARKET_RUNNER_BAR_CLAIM_TTL_MS));
  const ref = db.doc(buildMarketRunnerBarClaimDocPath({ exchange, market, tf, barCloseMs }));
  let ok = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    const owner = String(data.owner || "");
    if (owner !== String(holderId || "")) {
      holder = owner || null;
      return;
    }
    ok = true;
    tx.set(ref, {
      lease_until_ms: leaseUntil,
      heartbeat_ms: now,
      heartbeat_at: new Date(now).toISOString(),
    }, { merge: true });
  });
  return { ok, holder, leaseUntil, holderId };
}

async function releaseMarketRunnerBarClaim({
  exchange,
  market,
  tf,
  barCloseMs,
  holderId = marketRunnerBarClaimHolderId,
} = {}) {
  const db = getFirestore();
  const ref = db.doc(buildMarketRunnerBarClaimDocPath({ exchange, market, tf, barCloseMs }));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (String(data.owner || "") !== String(holderId || "")) return;
    tx.set(ref, {
      lease_until_ms: Date.now() - 1,
      released_at: new Date().toISOString(),
    }, { merge: true });
  });
}

async function runWithMarketRunnerBarClaim({
  exchange,
  market,
  tf,
  barCloseMs,
  runner,
  ttlMs = MARKET_RUNNER_BAR_CLAIM_TTL_MS,
  waitMs = MARKET_RUNNER_BAR_CLAIM_WAIT_MS,
  acquireClaim = acquireMarketRunnerBarClaim,
  heartbeatClaim = heartbeatMarketRunnerBarClaim,
  releaseClaim = releaseMarketRunnerBarClaim,
} = {}) {
  if (typeof runner !== "function") throw new Error("runWithMarketRunnerBarClaim: runner required");
  const deadline = Date.now() + Math.max(0, Math.floor(Number(waitMs) || 0));
  let claim = null;
  for (;;) {
    claim = await acquireClaim({ exchange, market, tf, barCloseMs, ttlMs });
    if (claim && claim.acquired === true) break;
    if (Date.now() >= deadline) {
      return { ok: false, skipped: true, reason: "BAR_CLAIM_HELD", holder: claim && claim.holder ? claim.holder : null };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  let heartbeatLost = false;
  const heartbeatEveryMs = Math.max(1000, Math.floor(Math.max(3000, ttlMs) / 3));
  const timer = setInterval(() => {
    heartbeatClaim({ exchange, market, tf, barCloseMs, ttlMs, holderId: claim.holderId })
      .then((res) => {
        if (!res || res.ok !== true) heartbeatLost = true;
      })
      .catch(() => {
        heartbeatLost = true;
      });
  }, heartbeatEveryMs);
  try {
    const heartbeat = await heartbeatClaim({ exchange, market, tf, barCloseMs, ttlMs, holderId: claim.holderId });
    if (!heartbeat || heartbeat.ok !== true) {
      return { ok: false, skipped: true, reason: "BAR_CLAIM_LOST", holder: heartbeat && heartbeat.holder ? heartbeat.holder : null };
    }
    const result = await runner();
    if (heartbeatLost && result && typeof result === "object") {
      return { ...result, bar_claim_lost_after_run: true };
    }
    return result;
  } finally {
    clearInterval(timer);
    await releaseClaim({ exchange, market, tf, barCloseMs, holderId: claim && claim.holderId }).catch(() => {});
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeJsonSafe(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function summarizeServerSignalTrace({
  exchange,
  market,
  signalTf,
  execTf,
  barCloseMs,
  barCloseUtc,
  newBar,
  actorAllowed,
  executionEnabled,
  gate,
  paper,
  error,
} = {}) {
  const paperSafe = paper && typeof paper === "object" ? paper : null;
  const dropCounts = paperSafe && paperSafe.signal_drop_reason_counts && typeof paperSafe.signal_drop_reason_counts === "object"
    ? paperSafe.signal_drop_reason_counts
    : {};
  const topDropReason = paperSafe && paperSafe.top_signal_drop_reason
    ? paperSafe.top_signal_drop_reason
    : (Object.entries(dropCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null);
  let status = "UNKNOWN";
  let reason = "UNKNOWN";
  if (error) {
    status = "RUN_ERROR";
    reason = error;
  } else if (executionEnabled !== true) {
    status = "SKIPPED";
    reason = "EXECUTION_DISABLED";
  } else if (!actorAllowed) {
    status = !newBar ? "SKIPPED" : "BLOCKED";
    reason = !newBar
      ? "NO_NEW_BAR"
      : ((gate && Array.isArray(gate.reasonCodes) && gate.reasonCodes[0]) || "GATE_BLOCKED");
  } else if (!paperSafe) {
    status = "BLOCKED";
    reason = "PAPER_RESULT_MISSING";
  } else if (Number(paperSafe.signals_internal || 0) > 0) {
    status = "SERVER_SIGNAL_CREATED";
    reason = Number(paperSafe.intents_created || 0) > 0 ? "INTENT_CREATED" : (topDropReason || "SERVER_SIGNAL_CREATED");
  } else if (Number(paperSafe.signals_seen || 0) > 0) {
    status = "NO_SERVER_SIGNAL";
    reason = topDropReason || "EXTERNAL_ONLY_OR_DROPPED";
  } else {
    status = "NO_SERVER_SIGNAL";
    reason = topDropReason || "NO_SIGNAL_GENERATED";
  }

  return {
    generated_at: new Date().toISOString(),
    exchange: exchange || null,
    market: market || null,
    signal_tf: signalTf || null,
    exec_tf: execTf || null,
    bar_close_time_utc_ms: Number.isFinite(barCloseMs) ? barCloseMs : null,
    bar_close_time_utc: barCloseUtc || null,
    new_bar: !!newBar,
    actor_allowed: !!actorAllowed,
    execution_enabled: executionEnabled === true,
    gate_status: gate && gate.status ? gate.status : null,
    gate_reason_codes: gate && Array.isArray(gate.reasonCodes) ? gate.reasonCodes : [],
    signals_seen: Number(paperSafe && paperSafe.signals_seen || 0),
    signals_internal: Number(paperSafe && paperSafe.signals_internal || 0),
    signals_external: Number(paperSafe && paperSafe.signals_external || 0),
    intents_created: Number(paperSafe && paperSafe.intents_created || 0),
    signal_drop_n: Number(paperSafe && paperSafe.signal_drop_n || 0),
    signal_drop_reason_counts: dropCounts,
    top_signal_drop_reason: topDropReason,
    status,
    reason,
  };
}

function persistServerSignalGenerationTrace(entry) {
  const existing = readJsonSafe(SERVER_SIGNAL_GENERATION_TRACE_LATEST);
  const prevEntries = Array.isArray(existing && existing.entries) ? existing.entries : [];
  const entries = [entry, ...prevEntries].slice(0, 200);
  writeJsonSafe(SERVER_SIGNAL_GENERATION_TRACE_LATEST, {
    generated_at: new Date().toISOString(),
    latest: entry,
    entries,
  });
}

async function refreshLatestBarSnapshot({ exchange, market, tf, runId } = {}) {
  const enabled = env.bars.snapshotRefresh === true;
  if (!enabled) return { ok: false, skipped: true, reason: "DISABLED" };

  try {
    const count = Math.max(2, Math.min(10, Number(env.bars.snapshotRefreshCount || 3)));
    const bars = await fetchCandles(exchange, market, tf, count);
    if (!Array.isArray(bars) || bars.length === 0) {
      return { ok: false, error: "NO_BARS" };
    }

    let written = 0;
    let latestMs = null;
    let latestIso = null;

    for (const bar of bars) {
      const barCloseUtc = bar.closeTimeUtc || bar.t || null;
      const barCloseMs =
        (barCloseUtc ? Date.parse(String(barCloseUtc)) : null) ||
        Number(bar.closeTimeUtcMs) ||
        Number(bar.timestamp) ||
        Number(bar.lastUpdatedMs) ||
        null;

      if (!Number.isFinite(barCloseMs)) continue;

      const barCloseUtcFinal = barCloseUtc || new Date(barCloseMs).toISOString().replace(".000Z", "Z");

      await upsertBarSnapshot({
        runId: runId || null,
        exchange,
        symbol: market,
        tf,
        barCloseTimeUtc: barCloseUtcFinal,
        barCloseTimeUtcMs: barCloseMs,
        bar,
      });
      written += 1;
      if (latestMs === null || barCloseMs > latestMs) {
        latestMs = barCloseMs;
        latestIso = barCloseUtcFinal;
      }
    }

    return { ok: true, written, bar_close_time_utc_ms: latestMs, bar_close_time_utc: latestIso };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

async function computeGateForMarket({ exchange, market, tf, lastProcessedBarCloseMs, nowMs }) {
    const bars = await queryBars({
      exchange: exchange || "BINANCEFUT",
      symbol: market,
      tf: tf || DEFAULT_EXEC_TF,
      limit: Number(env.gate.barsLimit || 200),
    });

  const gate = await getGateStatus(bars, {
    exchange,
    market,
    tf,
    lastProcessedBarCloseMs,
    nowMs,
    maxLagMs: computeMaxLagMs(tf),
    minStableBars: Number(env.gate.minStableBars || 1),
    graceMs: graceMs(),
  });

  try {
    if (gate) {
      if (!gate.metrics) gate.metrics = {};
      const hasMs = (typeof gate.metrics.bar_close_time_utc_ms === "number") && Number.isFinite(gate.metrics.bar_close_time_utc_ms);

      if (!hasMs) {
        const result = await fetchBarCloseTime({ exchange, market: String(market), tf, retries: 3, delayMs: 600 });
        if (result.success) {
          gate.metrics.bar_close_time_utc_ms = result.ms;
          gate.metrics.bar_close_time_utc = result.iso || new Date(result.ms).toISOString().replace(".000Z","Z");
          if (gate.metrics.market == null) gate.metrics.market = String(market);
          if (gate.metrics.tf == null) gate.metrics.tf = String(tf);
          if (gate.metrics.n == null) gate.metrics.n = result.n;
          if (gate.metrics.fetched == null) gate.metrics.fetched = true;
        } else {
          throw new Error(result.errorMessage || "FETCH_BAR_TIME_FAILED");
        }
      }
    }
  } catch (e) {
    if (gate) {
      if (!gate.metrics) gate.metrics = {};
      gate.metrics.error = (e && e.message) ? e.message : String(e);
      gate.status = "FAIL";
      gate.severity = "SOFT";
      gate.ok = false;
      gate.stable_enough = false;
      gate.lag_ok = false;
      gate.reasonCodes = ["RATE_LIMIT_OR_FETCH_FAIL"];
      gate.overall_status = "FAIL_SOFT";
    }
  }

  try {
    await upsertGateEvent({
      exchange,
      market,
      tf,
      barCloseMs: gate && gate.metrics && gate.metrics.bar_close_time_utc_ms,
      status: gate && gate.status,
      severity: gate && gate.severity,
      reasonCodes: (gate && gate.reasonCodes) || [],
      metrics: gate && gate.metrics,
    });
  } catch (e) {
    console.warn("[GATE_EVENT_SAVE_FAIL]", e?.message || e);
  }

  return gate;
}

async function runOneMarket({ exchange, market, signalTf, execTf, nowMs, runIdHint, executionEnabled, executionMode, allowReplaySameBar }) {
  const signalTfFinal = normalizeTf(signalTf || DEFAULT_EXEC_TF) || DEFAULT_EXEC_TF;
  const execTfFinal = normalizeTf(execTf || signalTfFinal) || signalTfFinal;

  const snapshotRefresh = await refreshLatestBarSnapshot({
    exchange,
    market,
    tf: execTfFinal,
    runId: runIdHint,
  });
  const signalSnapshotRefresh = (signalTfFinal !== execTfFinal)
    ? await refreshLatestBarSnapshot({
      exchange,
      market,
      tf: signalTfFinal,
      runId: runIdHint,
    })
    : null;
  if (snapshotRefresh && snapshotRefresh.ok === false && !snapshotRefresh.skipped) {
    console.warn(
      `[snapshot_refresh_fail] ex=${exchange} sym=${market} tf=${execTfFinal} err=${snapshotRefresh.error || snapshotRefresh.reason || "UNKNOWN"}`
    );
  }
  if (signalSnapshotRefresh && signalSnapshotRefresh.ok === false && !signalSnapshotRefresh.skipped) {
    console.warn(
      `[snapshot_refresh_fail] ex=${exchange} sym=${market} tf=${signalTfFinal} err=${signalSnapshotRefresh.error || signalSnapshotRefresh.reason || "UNKNOWN"}`
    );
  }

  const cursorId = `${exchange}__${market}__${execTfFinal}`;
  const cursor = await getCursor({ exchange, symbol: market, tf: execTfFinal });
  const lastProcessed = cursor && Number(cursor.last_processed_bar_close_time_utc_ms);
  const lastProcessedMs = Number.isFinite(lastProcessed) ? lastProcessed : null;

  const gate = await computeGateForMarket({
    exchange,
    market,
    tf: execTfFinal,
    lastProcessedBarCloseMs: lastProcessedMs,
    nowMs,
  });

  let futuresSync = null;
  if (String(exchange || "").toUpperCase().includes("BINANCE") &&
      (String(executionMode || "").toUpperCase() === "LIVE" || String(executionMode || "").toUpperCase() === "LIVE_DRY_RUN")) {
    try {
      futuresSync = await syncFuturesPositionOnly(resolveFuturesPositionSyncRequest({
        source: "MARKET_RUNNER",
        runId: runIdHint || `RUN__${exchange}__${market}__SYNC__${Date.now()}`,
        exchange,
        symbol: market,
      }));
    } catch (e) {
      futuresSync = { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  }

  let barCloseMs_f = gate && gate.metrics && Number(gate.metrics.bar_close_time_utc_ms);
  let barCloseIso_f = gate && gate.metrics && gate.metrics.bar_close_time_utc;

  if (!Number.isFinite(barCloseMs_f)) {
    try {
      const result = await fetchBarCloseTime({ exchange, market: String(market), tf: execTfFinal, retries: 3, delayMs: 600 });
      if (result.success) {
        barCloseMs_f = result.ms;
        barCloseIso_f = result.iso || new Date(result.ms).toISOString().replace(".000Z","Z");
        if (gate) {
          if (!gate.metrics) gate.metrics = {};
          gate.metrics.bar_close_time_utc_ms = result.ms;
          gate.metrics.bar_close_time_utc = barCloseIso_f;
          if (gate.metrics.market == null) gate.metrics.market = String(market);
          if (gate.metrics.tf == null) gate.metrics.tf = String(execTfFinal);
          if (gate.metrics.fetched == null) gate.metrics.fetched = true;
        }
      }
    } catch (e) {
      if (gate) {
        if (!gate.metrics) gate.metrics = {};
        gate.metrics.error = (e && e.message) ? e.message : String(e);
      }
    }
  }

  const tfMs = tfToMs(execTfFinal);
  const cursorAhead = Number.isFinite(barCloseMs_f) &&
    Number.isFinite(lastProcessedMs) &&
    (lastProcessedMs - barCloseMs_f) >= (Number.isFinite(tfMs) ? Math.max(60 * 1000, tfMs / 2) : 60 * 1000);
  const effectiveLastProcessed = cursorAhead ? null : lastProcessedMs;
  const newBar = Number.isFinite(barCloseMs_f) && (effectiveLastProcessed === null || barCloseMs_f > effectiveLastProcessed);
  const allowReplayEnv = ["1", "true", "yes", "y", "on"].includes(
    String(process.env.ALLOW_REPLAY_SAME_BAR || "").trim().toLowerCase()
  );
  const allowReplay = allowReplaySameBar === true || allowReplayEnv || env.allowReplaySameBar === true;
  const actorAllowed =
    executionEnabled &&
    Number.isFinite(barCloseMs_f) &&
    (newBar || allowReplay) &&
    gate &&
    (gate.ok === true || gate.severity === "SOFT");

  let lastSignal = null;
  try {
    const sigs = await listSignalsByMarket({ exchange, market, tf: signalTfFinal, limit: 1 });
    if (Array.isArray(sigs) && sigs.length) lastSignal = sigs[0];
  } catch (e) {
    console.warn("[SCHED_LAST_SIGNAL_FAIL]", e?.message || e);
  }

  let paper = null;
  let err = null;
  let errStack = null;

  if (executionEnabled && actorAllowed) {
    try {
      const effectiveRunId = runIdHint || buildRunId({ exchange, market, tf: signalTfFinal, execTf: execTfFinal, barCloseMs: barCloseMs_f });
      const maxBackfillBars = Math.max(0, Number(env.bars.exitBackfillMaxBars || 0));
      const backfillEnabled = env.bars.exitBackfillEnabled === true && maxBackfillBars > 0;
      const barQueryLimit = backfillEnabled ? Math.max(2, maxBackfillBars + 1) : 1;

      const barsForPaper = await queryBars({
        exchange: exchange || "BINANCEFUT",
        symbol: market,
        tf: execTfFinal,
        limit: barQueryLimit,
      });

      const latestBar = barsForPaper && barsForPaper.length > 0 ? barsForPaper[barsForPaper.length - 1] : null;

      if (!latestBar) {
        throw new Error("NO_BAR_AVAILABLE_FOR_PAPER_EXEC");
      }

      const tradingModeInfo = computeGateTradingMode(gate);

      if (backfillEnabled && Number.isFinite(effectiveLastProcessed) && Number.isFinite(barCloseMs_f)) {
        const latestBarMs = Number(latestBar.timestamp);
        const backfillUpperMs = Number.isFinite(latestBarMs) ? latestBarMs : barCloseMs_f;
        const signalTfMs = tfToMs(signalTfFinal);
        const allowEntryBars = Math.max(0, Number(env.bars.exitBackfillAllowEntryBars || 0));
        let backfillBars = barsForPaper.filter((b) => {
          const ts = Number(b && b.timestamp);
          return Number.isFinite(ts) && ts > effectiveLastProcessed && ts < backfillUpperMs;
        });
        if (backfillBars.length > maxBackfillBars) {
          backfillBars = backfillBars.slice(backfillBars.length - maxBackfillBars);
        }
        for (const b of backfillBars) {
          const backfillMs = Number(b.timestamp);
          const backfillIso = b.closeTimeUtc || b.t || new Date(backfillMs).toISOString().replace(".000Z", "Z");
          const backfillRunId = `${effectiveRunId}__BACKFILL_EXIT__${backfillMs}`;
          const barsBehind = Number.isFinite(signalTfMs) && Number.isFinite(backfillUpperMs)
            ? Math.round((backfillUpperMs - backfillMs) / signalTfMs)
            : null;
          const backfillAllowEntry = allowEntryBars > 0 && Number.isFinite(barsBehind) && barsBehind <= allowEntryBars;
          const backfillClaim = await runWithMarketRunnerBarClaim({
            exchange,
            market,
            tf: execTfFinal,
            barCloseMs: backfillMs,
            runner: async () => {
              await runPaperMarket({
                exchange,
                symbol: market,
                tf: signalTfFinal,
                execTf: execTfFinal,
                barCloseUtc: backfillIso,
                barCloseMs: backfillMs,
                bar: b,
                gate: gate,
                trading_mode: "EXIT_ONLY",
                backfillExitOnly: true,
                backfillAllowEntry,
                runId: backfillRunId,
              });
              await setCursor({
                exchange,
                symbol: market,
                tf: execTfFinal,
                barCloseTimeUtc: backfillIso,
                barCloseTimeUtcMs: backfillMs,
                runId: backfillRunId,
              });
              return { ok: true };
            },
          });
          if (backfillClaim && backfillClaim.skipped === true) {
            console.warn(`[market_runner_backfill_claim_skipped] ex=${exchange} sym=${market} tf=${execTfFinal} bar=${backfillMs} reason=${backfillClaim.reason || "BAR_CLAIM_HELD"}`);
          }
        }
      }

      const currentClaim = await runWithMarketRunnerBarClaim({
        exchange,
        market,
        tf: execTfFinal,
        barCloseMs: barCloseMs_f,
        runner: async () => {
          const executed = await runPaperMarket({
            exchange,
            symbol: market,
            tf: signalTfFinal,
            execTf: execTfFinal,
            barCloseUtc: barCloseIso_f,
            barCloseMs: barCloseMs_f,
            bar: latestBar,
            gate: gate,
            trading_mode: tradingModeInfo.trading_mode,
            runId: effectiveRunId,
          });
          await setCursor({
            exchange,
            symbol: market,
            tf: execTfFinal,
            barCloseTimeUtc: barCloseIso_f,
            barCloseTimeUtcMs: barCloseMs_f,
            runId: effectiveRunId,
          });
          return executed;
        },
      });
      if (currentClaim && currentClaim.skipped === true) {
        paper = currentClaim;
      } else {
        paper = currentClaim;
      }
    } catch (e) {
      err = (e && e.message) ? e.message : String(e);
      errStack = (e && e.stack) ? String(e.stack) : null;
    }
  }

  const signalTrace = summarizeServerSignalTrace({
    exchange,
    market,
    signalTf: signalTfFinal,
    execTf: execTfFinal,
    barCloseMs: barCloseMs_f,
    barCloseUtc: Number.isFinite(barCloseMs_f) ? (barCloseIso_f || new Date(barCloseMs_f).toISOString()) : null,
    newBar,
    actorAllowed,
    executionEnabled,
    gate,
    paper,
    error: err,
  });
  persistServerSignalGenerationTrace(signalTrace);
  try {
    const webhookSummary = await findRecentWebhookSummaryForBar({
      exchange,
      symbol: market,
      tf: signalTfFinal,
      barCloseMs: barCloseMs_f,
      lookbackHours: 6,
      limit: 500,
    });
    await sendSignalCompareAlert({
      exchange,
      symbol: market,
      tf: signalTfFinal,
      barCloseMs: barCloseMs_f,
      barCloseUtc: signalTrace.bar_close_time_utc,
      newBar: signalTrace.new_bar,
      actorAllowed: signalTrace.actor_allowed,
      webhookSeen: webhookSummary.webhook_seen === true,
      webhookDecision: webhookSummary.top_decision,
      serverSignalCreated: signalTrace.status === "SERVER_SIGNAL_CREATED",
      serverReason: signalTrace.reason,
      topDropReason: signalTrace.top_signal_drop_reason,
      signalDropN: signalTrace.signal_drop_n,
    });
  } catch (e) {
    console.warn("[SIGNAL_COMPARE_ALERT_FAIL]", e?.message || e);
  }

  return {
    exchange,
    market,
    symbol_or_pair_id: market,
    tf: signalTfFinal,
    exec_tf: execTfFinal,
    ok: !!(gate && gate.ok === true) && !err,
    gate: {
      gate_version: gate && gate.gate_version,
      status: gate && gate.status,
      severity: gate && gate.severity,
      reasonCodes: (gate && gate.reasonCodes) || [],
      metrics: gate && gate.metrics,
      ok: !!(gate && gate.ok === true),
      stable_enough: !!(gate && gate.stable_enough),
      lag_ok: !!(gate && gate.lag_ok),
    },
    bar_close_time_utc_ms: Number.isFinite(barCloseMs_f) ? barCloseMs_f : null,
    bar_close_time_utc: Number.isFinite(barCloseMs_f) ? (barCloseIso_f || new Date(barCloseMs_f).toISOString()) : null,
    lag_ms: gate && gate.metrics && gate.metrics.lagMs,
    snapshot_refresh: snapshotRefresh,
    snapshot_refresh_signal: signalSnapshotRefresh,
    cursor_before_ms: cursor || null,
    cursor_after_ms: await getCursor({ exchange, symbol: market, tf: execTfFinal }),
    new_bar: !!newBar,
    actor_allowed: !!actorAllowed,
    paper_enabled: executionEnabled,
    paper,
    execution_mode: executionMode,
    error: err,
    error_stack: errStack,
    signal_trace: signalTrace,
    trading_mode: gate && gate.trading_mode,
    run_id: runIdHint || null,
    last_signal: lastSignal,
    futures_sync: futuresSync,
  };
}

module.exports = {
  pickTf,
  buildRunId,
  refreshLatestBarSnapshot,
  computeGateForMarket,
  runOneMarket,
  __test: {
    summarizeServerSignalTrace,
    buildMarketRunnerBarClaimDocPath,
    runWithMarketRunnerBarClaim,
  },
};
