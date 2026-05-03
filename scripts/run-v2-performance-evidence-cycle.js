#!/usr/bin/env node
"use strict";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function withDefault(env, key, value) {
  const current = trimOrNull(env[key]);
  return current == null ? value : env[key];
}

function buildCycleEnv(env = process.env) {
  return Object.freeze({
    ...env,
    V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE: withDefault(env, "V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE", "FIRESTORE"),
    V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE: withDefault(env, "V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE", "1"),
    V2_OPENCLAW_OUTCOME_ADJUDICATION_REQUIRE_NONEMPTY: withDefault(env, "V2_OPENCLAW_OUTCOME_ADJUDICATION_REQUIRE_NONEMPTY", "0"),
    V2_PERFORMANCE_GATE_SOFT: withDefault(env, "V2_PERFORMANCE_GATE_SOFT", "1"),
  });
}

function buildDefaultSteps() {
  return Object.freeze([
    {
      id: "outcome_adjudication_collector",
      critical: true,
      run: async (env) => require("./collect-v2-openclaw-outcome-adjudications").main({ env, setProcessExitCode: false }),
      summarize: (result) => ({
        ok: result && result.ok === true,
        reason: result && result.reason,
        output_file: result && result.output_file,
        source: result && result.source,
        write_enabled: result && result.write_enabled,
        write_n: result && result.write_n,
        adjudication_n: result && result.summary && result.summary.adjudication_n,
      }),
    },
    {
      id: "daily_performance_report",
      critical: true,
      run: async (env) => require("./generate-v2-openclaw-daily-performance-report").main(env),
      summarize: (result) => ({
        ok: Boolean(result && typeof result === "object"),
        reason: result && result.reason,
        sample_n: result && result.sample_n,
        win_rate_pct: result && result.win_rate_pct,
        profit_factor: result && result.profit_factor,
        expectancy: result && result.expectancy,
      }),
    },
    {
      id: "performance_gate",
      critical: true,
      allowBlocked: true,
      run: async (env) => require("./check-v2-performance-gate").main(env),
      summarize: (result) => ({
        ok: Boolean(result && typeof result === "object"),
        gate_ok: result && result.ok === true,
        reason: result && result.reason,
        blockers: result && result.blockers,
        output_file: result && result.output_file,
        sample_n: result && result.metrics && result.metrics.sample_n,
        profit_factor: result && result.metrics && result.metrics.profit_factor,
      }),
    },
    {
      id: "daily_performance_gate_summary",
      critical: true,
      allowBlocked: true,
      run: async (env) => require("./collect-v2-daily-performance-gate-summary").main(env),
      summarize: (result) => ({
        ok: Boolean(result && typeof result === "object"),
        summary_ok: result && result.ok === true,
        reason: result && result.reason,
        output_file: result && result.output_file,
        history_file: result && result.history_file,
        current_status: result && result.current_status,
        sample_n: result && result.sample_n,
      }),
    },
    {
      id: "evidence_snapshot",
      critical: true,
      allowBlocked: true,
      run: async (env) => require("./collect-v2-evidence-snapshot-daily").main(env),
      summarize: (result) => ({
        ok: Boolean(result && typeof result === "object"),
        snapshot_ok: result && result.ok === true,
        reason: result && result.reason,
        blockers: result && result.blockers,
        output_file: result && result.output_file,
        history_file: result && result.history_file,
        sample_n_30d: result && result.sample_n_30d,
        active_protection_streak_days: result && result.active_protection_streak_days,
      }),
    },
    {
      id: "formal_live_promotion_readiness",
      critical: true,
      allowBlocked: true,
      run: async (env) => require("./check-v2-formal-live-promotion-readiness").main(env),
      summarize: (result) => ({
        ok: Boolean(result && typeof result === "object"),
        readiness_ok: result && result.ok === true,
        reason: result && result.reason,
        blockers: result && result.blockers,
        output_file: result && result.output_file,
        sample_n_30d: result && result.metrics && result.metrics.sample_n_30d,
        active_protection_streak_days: result && result.metrics && result.metrics.active_protection_streak_days,
      }),
    },
  ]);
}

async function runStep(step, env) {
  const started = Date.now();
  const previousExitCode = process.exitCode;
  try {
    const result = await step.run(env);
    const summary = typeof step.summarize === "function" ? step.summarize(result) : { ok: true };
    const stepOk = summary.ok === true || (step.allowBlocked === true && summary.ok !== false);
    return Object.freeze({
      id: step.id,
      ok: stepOk,
      critical: step.critical === true,
      allow_blocked: step.allowBlocked === true,
      duration_ms: Date.now() - started,
      ...summary,
    });
  } catch (error) {
    return Object.freeze({
      id: step.id,
      ok: false,
      critical: step.critical === true,
      allow_blocked: step.allowBlocked === true,
      duration_ms: Date.now() - started,
      error: error && error.message ? error.message : String(error),
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

async function main({ env = process.env, steps = buildDefaultSteps(), setProcessExitCode = require.main === module } = {}) {
  const cycleEnv = buildCycleEnv(env);
  const started = Date.now();
  const results = [];

  for (const step of steps) {
    const result = await runStep(step, cycleEnv);
    results.push(result);
    if (result.ok !== true && step.critical === true) break;
  }

  const failed = results.filter((row) => row.ok !== true);
  const performanceGate = results.find((row) => row.id === "performance_gate") || null;
  const formalReadiness = results.find((row) => row.id === "formal_live_promotion_readiness") || null;
  const payload = Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? "V2_PERFORMANCE_EVIDENCE_CYCLE_COMPLETE" : "V2_PERFORMANCE_EVIDENCE_CYCLE_FAILED",
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    step_n: results.length,
    failed_step_ids: Object.freeze(failed.map((row) => row.id)),
    gate_ok: performanceGate ? performanceGate.gate_ok === true : null,
    formal_live_ok: formalReadiness ? formalReadiness.readiness_ok === true : null,
    steps: Object.freeze(results),
  });

  const out = JSON.stringify(payload, null, 2);
  if (payload.ok) console.log(out);
  else {
    console.error(out);
    if (setProcessExitCode) process.exitCode = 1;
  }
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_PERFORMANCE_EVIDENCE_CYCLE_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
} else {
  module.exports = {
    main,
    buildCycleEnv,
    buildDefaultSteps,
    runStep,
    __test: { trimOrNull, withDefault },
  };
}
