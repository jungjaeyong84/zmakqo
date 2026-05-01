#!/usr/bin/env node
"use strict";

const { createBinanceLiquidationStreamCollector } = require("../src/v2/binanceLiquidationStreamCollector");

function toPositiveInt(value, fallback, max) {
  const n = Number(value);
  const resolved = Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  return Math.min(Math.max(1, resolved), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function main({
  env = process.env,
  collectorFactory = createBinanceLiquidationStreamCollector,
  sleepFn = sleep,
  setProcessExitCode = require.main === module,
} = {}) {
  const collector = collectorFactory({ env });
  const started = collector.start();
  if (!started || started.ok !== true) {
    const payload = {
      ok: false,
      reason: started && started.reason ? started.reason : "LIQUIDATION_STREAM_START_FAILED",
      state: collector.state ? collector.state() : null,
    };
    emit(payload);
    if (setProcessExitCode) process.exitCode = 1;
    return payload;
  }
  if (started.reason === "LIQUIDATION_STREAM_DISABLED") {
    const payload = {
      ok: true,
      reason: started.reason,
      state: collector.state ? collector.state() : null,
      duration_ms: 0,
    };
    emit(payload);
    return payload;
  }

  const durationMs = toPositiveInt(env.DONBEOLJA_V2_LIQUIDATION_STREAM_WINDOW_MS, 55000, 120000);
  let stopped = null;
  try {
    await sleepFn(durationMs);
  } finally {
    stopped = collector.stop();
  }
  const state = collector.state ? collector.state() : null;
  const payload = {
    ok: true,
    reason: "V2_LIQUIDATION_STREAM_WINDOW_COLLECTED",
    started_reason: started.reason,
    stopped_reason: stopped && stopped.reason ? stopped.reason : null,
    duration_ms: durationMs,
    state,
    buffered_event_n: state && Number.isFinite(Number(state.buffered_event_n)) ? Number(state.buffered_event_n) : null,
  };
  emit(payload);
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    emit({
      ok: false,
      reason: "V2_LIQUIDATION_STREAM_WINDOW_COLLECTOR_THROWN",
      error_message: error && error.message ? String(error.message) : String(error),
    });
    process.exitCode = 1;
  });
}

module.exports = { main, __test: { toPositiveInt } };
