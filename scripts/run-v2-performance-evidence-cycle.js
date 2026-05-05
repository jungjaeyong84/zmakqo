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

function buildRunId(now = Date.now()) {
  return `v2_performance_evidence_cycle_${now}`;
}

function buildCycleEnv(env = process.env, { runId = null, manualRun = null } = {}) {
  const resolvedRunId = trimOrNull(runId) || trimOrNull(env.V2_EVIDENCE_CYCLE_RUN_ID) || buildRunId();
  return Object.freeze({
    ...env,
    V2_EVIDENCE_CYCLE_RUN_ID: resolvedRunId,
    OPENCLAW_RUN_ID: withDefault({ ...env, OPENCLAW_RUN_ID: env.OPENCLAW_RUN_ID || resolvedRunId }, "OPENCLAW_RUN_ID", resolvedRunId),
    V2_EVIDENCE_CYCLE_MANUAL_RUN: manualRun == null
      ? withDefault(env, "V2_EVIDENCE_CYCLE_MANUAL_RUN", require.main === module ? "1" : "0")
      : (manualRun ? "1" : "0"),
    V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE: withDefault(env, "V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE", "FIRESTORE"),
    V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE: withDefault(env, "V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE", "1"),
    V2_OPENCLAW_OUTCOME_ADJUDICATION_REQUIRE_NONEMPTY: withDefault(env, "V2_OPENCLAW_OUTCOME_ADJUDICATION_REQUIRE_NONEMPTY", "0"),
    V2_PERFORMANCE_GATE_SOFT: withDefault(env, "V2_PERFORMANCE_GATE_SOFT", "1"),
    V2_OPENCLAW_POLICY_CANDIDATE_SOFT: withDefault(env, "V2_OPENCLAW_POLICY_CANDIDATE_SOFT", "1"),
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
      id: "root_cause_analysis",
      critical: true,
      run: async (env) => require("./analyze-v2-openclaw-root-cause").main(env),
      summarize: (result) => ({
        ok: result && result.ok === true,
        reason: result && result.reason,
        sample_n: result && result.sample_n,
        profit_factor: result && result.total && result.total.profit_factor,
        finding_n: result && Array.isArray(result.root_cause_findings) ? result.root_cause_findings.length : null,
        run_id: result && result.run_id,
      }),
    },
    {
      id: "policy_candidate_from_root_cause",
      critical: true,
      allowBlocked: true,
      run: async (env) => require("./generate-v2-openclaw-policy-candidate-from-root-cause").main(env),
      summarize: (result) => ({
        ok: Boolean(result && typeof result === "object"),
        candidate_ok: result && result.ok === true,
        reason: result && result.reason,
        decision: result && result.decision,
        blockers: result && result.blockers,
        output_file: result && result.output_file,
        source_sample_n: result && result.candidate && result.candidate.source_sample_n,
        run_id: result && result.run_id,
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
  const started = Date.now();
  const runId = trimOrNull(env.V2_EVIDENCE_CYCLE_RUN_ID) || buildRunId(started);
  const cycleEnv = buildCycleEnv(env, { runId, manualRun: setProcessExitCode === true });
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
    run_id: runId,
    source_cycle_id: runId,
    manual_run: cycleEnv.V2_EVIDENCE_CYCLE_MANUAL_RUN === "1",
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
    buildRunId,
  };
}
