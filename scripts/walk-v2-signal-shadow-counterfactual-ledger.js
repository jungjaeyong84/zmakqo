#!/usr/bin/env node
"use strict";

// F1 walker runtime entry.
//
// Closes pending counterfactual records past their kline horizon by
// fetching klines from Binance Futures public REST and computing
// MFE/MAE/exit_close_pct in-place. Stale records past max_age_ms are
// expired without fetching klines.
//
// Default OFF: when
// `DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED` is unset
// or 0, this script returns immediately as a no-op so it is safe to
// install in launchd / Cloud Scheduler before activation.

const ledger = require("../src/v2/signalShadowCounterfactualLedger");

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function tryLoadFirestore() {
  try {
    const { getFirestore } = require("../src/storage/firestore");
    return await getFirestore();
  } catch (error) {
    return null;
  }
}

async function fetchBinanceFuturesKlines({ symbol, candle_close_ms, horizon_close_ms, bar_interval_ms }) {
  const intervalToken = (() => {
    const min = Math.round(bar_interval_ms / 60000);
    if (min === 1) return "1m";
    if (min === 3) return "3m";
    if (min === 5) return "5m";
    if (min === 15) return "15m";
    if (min === 30) return "30m";
    if (min === 60) return "1h";
    return "15m";
  })();
  const startTime = candle_close_ms - bar_interval_ms;
  const endTime = horizon_close_ms + bar_interval_ms;
  const url = new URL("https://fapi.binance.com/fapi/v1/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", intervalToken);
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("endTime", String(endTime));
  url.searchParams.set("limit", "200");
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`BINANCE_KLINES_HTTP_${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("BINANCE_KLINES_PAYLOAD_INVALID");
  return data;
}

async function main({
  env = process.env,
  argv = process.argv.slice(2),
  db: providedDb = null,
  fetchKlines = fetchBinanceFuturesKlines,
  now_ms = Date.now(),
  setProcessExitCode = require.main === module,
} = {}) {
  const dryRun = Array.isArray(argv) && argv.includes("--dry-run");
  const policy = ledger.resolveCounterfactualLedgerPolicy(env);
  if (!policy.enabled) {
    const payload = {
      ok: true,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_DISABLED",
      processed_n: 0,
    };
    emit(payload);
    return payload;
  }
  if (dryRun) {
    const payload = {
      ok: true,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_DRY_RUN",
      policy: {
        enabled: policy.enabled,
        horizon_bars: policy.horizon_bars,
        bar_interval_ms: policy.bar_interval_ms,
        max_age_ms: policy.max_age_ms,
        batch_limit: policy.batch_limit,
      },
      processed_n: 0,
    };
    emit(payload);
    return payload;
  }
  const db = providedDb || await tryLoadFirestore();
  if (!db) {
    const payload = {
      ok: false,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_FIRESTORE_UNAVAILABLE",
      processed_n: 0,
    };
    emit(payload);
    return payload;
  }
  const result = await ledger.walkPendingCounterfactuals({
    db,
    env,
    fetchKlines,
    now_ms,
  });
  const payload = {
    ok: result.ok === true,
    reason: result.reason,
    processed_n: result.processed_n,
    closed_n: Array.isArray(result.results)
      ? result.results.filter((r) => r && r.action === "CLOSE").length
      : 0,
    expired_n: Array.isArray(result.results)
      ? result.results.filter((r) => r && r.action === "EXPIRE").length
      : 0,
  };
  emit(payload);
  if (!result.ok && setProcessExitCode) process.exitCode = 1;
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    emit({
      ok: false,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_WALKER_THROWN",
      error_message: error && error.message ? String(error.message) : String(error),
    });
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  __test: {
    fetchBinanceFuturesKlines,
  },
};
