"use strict";

const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { defaultExecTfFromEnv, tfToMs } = require("../utils/marketConfig");
const { fetchCandles } = require("../exchanges");
const { upsertIntent, cancelPendingIntentsByMarket } = require("../storage/orderIntentsPaper");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { listExchangePositionReadViews, getPositionReadView } = require("./positionReadModel");
const { getPosition } = require("../storage/positions");
const { runPaperFuturesForBar, syncFuturesPositionOnly, runDistributedFuturesPositionSync } = require("../engine/paperBinanceRunner");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nowMs() {
  return Date.now();
}

function msToIso(ms) {
  try {
    return new Date(ms).toISOString();
  } catch (_) {
    return null;
  }
}

function alignCurrentBarClose(ms, tfMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(tfMs) || tfMs <= 0) return null;
  return Math.floor(ms / tfMs) * tfMs;
}

function alignNextBarClose(ms, tfMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(tfMs) || tfMs <= 0) return null;
  return Math.ceil(ms / tfMs) * tfMs;
}

function isExposedPosition(position = null) {
  if (!position || typeof position !== "object") return false;
  const state = upper(position.state);
  const sizePct = toNum(position.size_pct);
  const qtyBase = toNum(position.qty_base);
  if (Number.isFinite(sizePct) && sizePct > 0) {
    return state !== "FLAT";
  }
  return Number.isFinite(qtyBase) && qtyBase > 0 && state !== "FLAT";
}

function sideFromPosition(position = null) {
  const side = upper(position && (position.position_side || position.side || (position.meta && position.meta.position_side)));
  if (side === "SHORT") return "BUY";
  if (side === "LONG") return "SELL";
  return null;
}

function buildRemediationReason(anomalyState = null) {
  const reason = upper(anomalyState && anomalyState.reason);
  return reason || "SYSTEM_ANOMALY_CIRCUIT_BREAKER_OPEN";
}

async function loadOperationalPositionView({
  exchange,
  symbol,
  getRawPosition = getPosition,
  getReadPosition = getPositionReadView,
} = {}) {
  const fallback = await getRawPosition({ exchange, symbol }).catch(() => null);
  return getReadPosition({ exchange, symbol, fallbackPosition: fallback }).catch(() => fallback);
}

async function runSystemAnomalyRemediation({
  exchange = "BINANCEFUT",
  anomalyState = null,
  dryRun = false,
  listPositions = listExchangePositionReadViews,
  getExchangeSettings = getExchangeSettingsForProvider,
  getSystemSettings = getSystemSettingsForProvider,
  fetchBars = fetchCandles,
  cancelPending = cancelPendingIntentsByMarket,
  createIntent = upsertIntent,
  runExecutor = runPaperFuturesForBar,
  syncPosition = syncFuturesPositionOnly,
  runLease = runDistributedFuturesPositionSync,
  getRawPosition = getPosition,
  getReadPosition = getPositionReadView,
  now = nowMs,
} = {}) {
  const ex = upper(exchange) || "BINANCEFUT";
  const breakerOpen = !!(anomalyState && anomalyState.circuit_breaker_open === true);
  const anomalyReason = buildRemediationReason(anomalyState);
  if (!breakerOpen) {
    return {
      ok: true,
      skipped: true,
      reason: "SYSTEM_ANOMALY_BREAKER_CLOSED",
      exchange: ex,
      remediated_positions: 0,
      rows: [],
    };
  }

  const rows = await listPositions({ exchange: ex }).catch(() => []);
  const activePositions = (Array.isArray(rows) ? rows : []).filter((row) => isExposedPosition(row));
  if (!activePositions.length) {
    return {
      ok: true,
      skipped: true,
      reason: "NO_ACTIVE_POSITIONS",
      exchange: ex,
      remediated_positions: 0,
      rows: [],
    };
  }

  const exCfg = await getExchangeSettings(ex, 2000).catch(() => null);
  const tf = (Array.isArray(exCfg && exCfg.tf_allowlist) && exCfg.tf_allowlist.length)
    ? String(exCfg.tf_allowlist[0])
    : (defaultExecTfFromEnv() || "15m");
  const execTf = String((exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m");
  const tfMs = tfToMs(tf) || tfToMs(defaultExecTfFromEnv()) || 15 * 60 * 1000;
  const execTfMs = tfToMs(execTf) || 15 * 60 * 1000;
  const sys = await getSystemSettings(ex, 2000).catch(() => null);
  const execModeRaw = String(sys && sys.data && sys.data.execution_mode ? sys.data.execution_mode : "PAPER").toUpperCase();
  const executionMode = execModeRaw === "LIVE" ? "LIVE" : "PAPER";

  const results = [];
  for (const position of activePositions) {
    const symbol = upper(position && (position.symbol_or_pair_id || position.symbol));
    const closeSide = sideFromPosition(position);
    if (!symbol || !closeSide) {
      results.push({
        symbol: symbol || null,
        ok: false,
        skipped: true,
        reason: "POSITION_SIDE_UNKNOWN",
      });
      continue;
    }

    const leaseResult = await runLease({
      exchange: ex,
      symbol,
      runner: async () => {
        const currentMs = Number(now());
        const signalBarCloseMs = alignCurrentBarClose(currentMs, tfMs) || currentMs;
        const fallbackExecBarCloseMs = alignNextBarClose(currentMs, execTfMs) || currentMs;
        const bars = await fetchBars(ex, symbol, execTf, 2).catch(() => []);
        const bar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
        const execBarCloseMs = toNum(bar && bar.closeTimeUtcMs) || fallbackExecBarCloseMs;
        const execBarCloseUtc = String(bar && bar.closeTimeUtc || msToIso(execBarCloseMs) || "");
        const runId = `RUN__SYSTEM_ANOMALY_FLATTEN__${ex}__${symbol}__${Date.now()}`;
        const signalBarCloseUtc = msToIso(signalBarCloseMs);
        const note = `${anomalyReason}`.slice(0, 160);
        const baseResult = {
          symbol,
          exchange: ex,
          execution_mode: executionMode,
          signal_tf: tf,
          exec_tf: execTf,
          anomaly_reason: anomalyReason,
          canceled_pending_entries: 0,
          intent_id: null,
          executor_result: null,
          position: null,
          dry_run: dryRun === true,
        };

        if (dryRun === true) {
          return {
            ok: true,
            skipped: false,
            ...baseResult,
            reason: "DRY_RUN",
          };
        }

        const canceled = await cancelPending({
          exchange: ex,
          symbol,
          reason: "SYSTEM_ANOMALY_FLATTEN",
          note,
          filterFn: (intent) => {
            const eventIntent = upper(intent && intent.event_intent);
            return eventIntent === "ENTRY" || eventIntent === "ADD";
          },
        }).catch(() => ({ canceled: 0 }));

        const intent = await createIntent({
          exchange: ex,
          symbol,
          tf,
          signalBarCloseTimeUtc: signalBarCloseUtc,
          signalBarCloseTimeUtcMs: signalBarCloseMs,
          scheduledExecBarCloseUtc: execBarCloseUtc || msToIso(execBarCloseMs),
          scheduledExecBarCloseUtcMs: execBarCloseMs,
          event: "FORCE_EXIT_ALL",
          side: closeSide,
          qtyPct: 1,
          qtyFraction: 1,
          reason: anomalyReason,
          pendingReason: "SYSTEM_ANOMALY_FLATTEN",
          pendingNote: note,
          executionMode,
          features: {
            action: "EXIT",
            _system_anomaly_guard: true,
            _system_anomaly_status: upper(anomalyState && anomalyState.status),
            _system_anomaly_reason: anomalyReason,
            _system_anomaly_issues: Array.isArray(anomalyState && anomalyState.issues)
              ? anomalyState.issues.slice(0, 20).map((row) => upper(row)).filter(Boolean)
              : [],
          },
          runId,
          execTf,
          requestId: null,
          decisionReason: anomalyReason,
        });

        let executorResult = null;
        if (bar && execBarCloseUtc) {
          executorResult = await runExecutor({
            runId,
            exchange: ex,
            symbol,
            tf,
            execTf,
            barCloseUtc: execBarCloseUtc,
            barCloseMs: execBarCloseMs,
            bar,
            gate: null,
            trading_mode: "RUNNING",
          }).catch((err) => ({
            ok: false,
            reason: err && err.message ? err.message : String(err),
          }));
        } else {
          executorResult = {
            ok: false,
            skipped: true,
            reason: "EXEC_BAR_MISSING_INTENT_ONLY",
          };
        }

        await syncPosition({ runId, exchange: ex, symbol, force: true }).catch(() => null);
        const nextPosition = await loadOperationalPositionView({
          exchange: ex,
          symbol,
          getRawPosition,
          getReadPosition,
        });

        return {
          ok: true,
          skipped: false,
          ...baseResult,
          canceled_pending_entries: Number(canceled && canceled.canceled) || 0,
          intent_id: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null,
          executor_result: executorResult,
          position: nextPosition,
          reason: executorResult && executorResult.reason ? executorResult.reason : "SYSTEM_ANOMALY_FLATTEN_ENQUEUED",
        };
      },
    });
    results.push({
      symbol,
      ...(leaseResult && typeof leaseResult === "object" ? leaseResult : { ok: false, reason: "UNKNOWN_REMEDIATION_RESULT" }),
    });
  }

  return {
    ok: true,
    exchange: ex,
    anomaly_reason: anomalyReason,
    remediated_positions: results.filter((row) => row && row.ok === true && row.skipped !== true).length,
    rows: results,
  };
}

module.exports = {
  runSystemAnomalyRemediation,
  __test: {
    isExposedPosition,
    sideFromPosition,
    buildRemediationReason,
    alignCurrentBarClose,
    alignNextBarClose,
  },
};
