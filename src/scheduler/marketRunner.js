"use strict";

const env = require("../config/env");
const { fetchBarCloseTime } = require("../utils/barTimeFetch");
const { fetchCandles } = require("../exchanges");
const { upsertBarSnapshot, queryBars } = require("../storage/barsSnapshots");
const { upsertGateEvent } = require("../storage/gateEvents");
const gateMod = require("../storage/gate");
const getGateStatus = gateMod.getGateStatusAsync || gateMod.getGateStatus;
const { getCursor, setCursor } = require("../storage/cursors");
const { listSignalsByMarket } = require("../storage/signalsQuery");
const { runPaperMarket, syncFuturesPositionOnly } = require("../engine/paperUpbitRunner");
const { tfToMs, normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { computeTradingMode: computeGateTradingMode } = require("../utils/tradingMode");
const { TF_60M } = require("../config/frozen");

const DEFAULT_EXEC_TF = normalizeTf(defaultExecTfFromEnv()) || "15m";

function graceMs() {
  const v = Number(env.scheduler.graceMs || 15000);
  return Number.isFinite(v) && v >= 0 ? v : 15000;
}

function computeMaxLagMs(tf) {
  const envMax = Number(env.gate.maxLagMs);
  if (Number.isFinite(envMax) && envMax > 0) return envMax;
  const tfMs = tfToMs(tf);
  if (!Number.isFinite(tfMs) || tfMs <= 0) return 6 * 60 * 1000;
  return Math.max(6 * 60 * 1000, Math.round(tfMs * 1.1));
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
      exchange: exchange || "UPBIT",
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
      futuresSync = await syncFuturesPositionOnly({
        runId: runIdHint || `RUN__${exchange}__${market}__SYNC__${Date.now()}`,
        exchange,
        symbol: market,
      });
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

  if (executionEnabled && actorAllowed) {
    try {
      const effectiveRunId = runIdHint || buildRunId({ exchange, market, tf: signalTfFinal, execTf: execTfFinal, barCloseMs: barCloseMs_f });
      const maxBackfillBars = Math.max(0, Number(env.bars.exitBackfillMaxBars || 0));
      const backfillEnabled = env.bars.exitBackfillEnabled === true && maxBackfillBars > 0;
      const barQueryLimit = backfillEnabled ? Math.max(2, maxBackfillBars + 1) : 1;

      const barsForPaper = await queryBars({
        exchange: exchange || "UPBIT",
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
        }
      }

      paper = await runPaperMarket({
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
    } catch (e) {
      err = (e && e.message) ? e.message : String(e);
    }
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
    execution_mode: executionMode,
    error: err,
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
};
