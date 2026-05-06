"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runner = require("../../scripts/run-openclaw-server-primary-tick");

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-server-primary-tick-"));
  const outputFile = path.join(tmpDir, "openclaw_server_primary_tick_latest.json");
  const historyFile = path.join(tmpDir, "openclaw_server_primary_tick_history.jsonl");

  const artifact = await runner.main({
    env: {
      DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_FILE: outputFile,
      DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_HISTORY_FILE: historyFile,
    },
    nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
    createRunFn: async () => ({ run_id: "RUN__SERVER_PRIMARY_TICK__1" }),
    finishRunFn: async () => {},
    getMultiExchangesSettingsFn: async () => ({
      mode: "single",
      exchanges: [
        {
          provider: "BINANCEFUT",
          enabled: true,
          markets: ["SOLUSDT", "BTCUSDT"],
          tf_allowlist: ["15m"],
          exec_tf: "15m",
        },
      ],
    }),
    runOneMarketFn: async ({ exchange, market }) => ({
      exchange,
      market,
      bar_close_time_utc_ms: Date.parse("2026-04-24T00:00:00.000Z"),
      snapshot_refresh: { ok: true },
      snapshot_refresh_signal: null,
      signal_trace: {
        status: market === "SOLUSDT" ? "SERVER_SIGNAL_CREATED" : "NO_SERVER_SIGNAL",
        signals_seen: market === "SOLUSDT" ? 1 : 0,
        signals_internal: market === "SOLUSDT" ? 1 : 0,
        signals_seen_total: market === "SOLUSDT" ? 2 : 0,
        signals_internal_total: market === "SOLUSDT" ? 2 : 0,
        intents_created: market === "SOLUSDT" ? 1 : 0,
        direct_handoff_generated_n: market === "SOLUSDT" ? 1 : 0,
        direct_handoff_executed_n: market === "SOLUSDT" ? 1 : 0,
        direct_handoff_blocked_n: 0,
        top_signal_drop_reason: market === "BTCUSDT" ? "DROP_OPPOSITE_COOLDOWN" : null,
      },
    }),
    analyticsRunner: () => ({ ok: true, skipped: false, reason: "REFRESHED" }),
    reportAuthority: () => ({ ok: true }),
    reportQuality: () => ({ ok: true }),
    reportRuntime: async () => ({ ok: true }),
    reportCutover: () => ({ ok: true }),
    reportObservation: () => ({ ok: true }),
    setProcessExitCode: false,
  });

  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.reason, "OPENCLAW_SERVER_PRIMARY_TICK_PASS");
  assert.strictEqual(artifact.summary.market_n, 2);
  assert.strictEqual(artifact.summary.server_signal_created_n, 1);
  assert.strictEqual(artifact.summary.signals_seen_n, 2);
  assert.strictEqual(artifact.summary.intents_created_n, 1);
  assert.strictEqual(artifact.summary.direct_handoff_generated_n, 1);
  assert.strictEqual(artifact.summary.direct_handoff_executed_n, 1);
  assert.strictEqual(artifact.summary.market_error_n, 0);
  assert.strictEqual(artifact.derived_artifacts.ok, true);
  assert.ok(fs.existsSync(outputFile));
  assert.ok(fs.existsSync(historyFile));
  assert.ok(fs.readFileSync(historyFile, "utf8").includes("OPENCLAW_SERVER_PRIMARY_TICK_PASS"));

  const warned = await runner.main({
    env: {
      DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_FILE: path.join(tmpDir, "warned_latest.json"),
      DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_HISTORY_FILE: path.join(tmpDir, "warned_history.jsonl"),
    },
    nowMs: Date.parse("2026-04-24T00:05:00.000Z"),
    createRunFn: async () => ({ run_id: "RUN__SERVER_PRIMARY_TICK__WARN" }),
    finishRunFn: async () => {},
    getMultiExchangesSettingsFn: async () => ({
      mode: "single",
      exchanges: [
        {
          provider: "BINANCEFUT",
          enabled: true,
          markets: ["SOLUSDT"],
          tf_allowlist: ["15m"],
          exec_tf: "15m",
        },
      ],
    }),
    runOneMarketFn: async ({ exchange, market }) => ({
      exchange,
      market,
      bar_close_time_utc_ms: Date.parse("2026-04-24T00:05:00.000Z"),
      snapshot_refresh: { ok: true },
      snapshot_refresh_signal: null,
      signal_trace: {
        status: "NO_SERVER_SIGNAL",
        signals_seen: 0,
        signals_internal: 0,
        signals_seen_total: 0,
        signals_internal_total: 0,
        intents_created: 0,
        direct_handoff_generated_n: 0,
        direct_handoff_executed_n: 0,
        direct_handoff_blocked_n: 0,
      },
    }),
    analyticsRunner: () => ({ ok: false, skipped: false, reason: "CACHE_REFRESH_FAILED" }),
    reportAuthority: () => ({ ok: true }),
    reportQuality: () => ({ ok: true }),
    reportRuntime: async () => ({ ok: true }),
    reportCutover: () => ({ ok: true }),
    reportObservation: () => ({ ok: true }),
    setProcessExitCode: false,
  });

  assert.strictEqual(warned.ok, true);
  assert.strictEqual(warned.reason, "OPENCLAW_SERVER_PRIMARY_TICK_PASS_WITH_DERIVED_ARTIFACT_WARNINGS");
  assert.strictEqual(warned.summary.market_error_n, 0);
  assert.strictEqual(warned.summary.snapshot_refresh_fail_n, 0);
  assert.strictEqual(warned.derived_artifacts.ok, false);
  assert.strictEqual(warned.warnings.length, 1);
  assert.strictEqual(warned.warnings[0].id, "analytics_local_cache");

  const failed = await runner.main({
    env: {
      DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_FILE: path.join(tmpDir, "failed_latest.json"),
      DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_HISTORY_FILE: path.join(tmpDir, "failed_history.jsonl"),
    },
    nowMs: Date.parse("2026-04-24T00:15:00.000Z"),
    createRunFn: async () => ({ run_id: "RUN__SERVER_PRIMARY_TICK__2" }),
    finishRunFn: async () => {},
    getMultiExchangesSettingsFn: async () => ({
      mode: "single",
      exchanges: [
        {
          provider: "BINANCEFUT",
          enabled: true,
          markets: ["SOLUSDT"],
          tf_allowlist: ["15m"],
          exec_tf: "15m",
        },
      ],
    }),
    runOneMarketFn: async () => ({
      exchange: "BINANCEFUT",
      market: "SOLUSDT",
      error: "BAR_REFRESH_FAILED",
      snapshot_refresh: { ok: false, skipped: false, error: "BAR_REFRESH_FAILED" },
      signal_trace: {
        status: "RUN_ERROR",
        signals_seen: 0,
        signals_internal: 0,
        signals_seen_total: 0,
        signals_internal_total: 0,
        intents_created: 0,
        direct_handoff_generated_n: 0,
        direct_handoff_executed_n: 0,
        direct_handoff_blocked_n: 0,
      },
    }),
    analyticsRunner: () => ({ ok: false, skipped: false, reason: "CACHE_REFRESH_FAILED" }),
    reportAuthority: () => ({ ok: true }),
    reportQuality: () => ({ ok: true }),
    reportRuntime: async () => ({ ok: true }),
    reportCutover: () => ({ ok: true }),
    reportObservation: () => ({ ok: true }),
    setProcessExitCode: false,
  });

  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.reason, "OPENCLAW_SERVER_PRIMARY_TICK_BLOCKED");
  assert.strictEqual(failed.summary.market_error_n, 1);
  assert.strictEqual(failed.summary.snapshot_refresh_fail_n, 1);
  assert.strictEqual(failed.derived_artifacts.ok, false);

  assert.ok(runner.__test.resolveOutputFile({}).endsWith(path.join("ops", "daily", "openclaw_server_primary_tick_latest.json")));
  assert.ok(runner.__test.resolveHistoryFile({}).endsWith(path.join("ops", "daily", "openclaw_server_primary_tick_history.jsonl")));

  console.log("RUN_OPENCLAW_SERVER_PRIMARY_TICK_TEST_OK");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
