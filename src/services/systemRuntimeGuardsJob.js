"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { toKstString } = require("../utils/timeKst");
const { loadOperationalGuardRuntime } = require("./operationalGuardRuntime");
const { loadMlServingRuntime } = require("./mlServingRuntime");
const { buildSystemSloState } = require("./systemSloRuntime");
const { buildSystemAnomalyState } = require("./systemAnomalyRuntime");
const { recordSystemSloState } = require("../storage/systemSloStates");
const { recordSystemAnomalyState } = require("../storage/systemAnomalyStates");
const { recordSystemAnomalyRemediationState } = require("../storage/systemAnomalyRemediationStates");
const { runSystemAnomalyRemediation } = require("./systemAnomalyRemediation");
const { applyMlServingActuation } = require("./mlServingActuator");
const { exportTraceContext } = require("./otelExporter");
const { normalizeTraceContext } = require("../utils/traceContext");
const { loadNativeTrailProtectionRuntime } = require("./nativeTrailProtectionRuntime");
const { runBinanceExitIntegrityCycle } = require("../../scripts/run-binance-exit-integrity-cycle");
const { main: runTradeAlertOutboxLineageEvidenceCheck } = require("../../scripts/check-trade-alert-outbox-lineage-evidence");
const { main: runSignalLifecycleAlertDedupeEvidenceCheck } = require("../../scripts/check-signal-lifecycle-alert-dedupe-evidence");
const {
  loadPreferredExecutionQualityInput,
  loadPreferredLineageHealthInput,
} = require("./systemSloArtifactInputs");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const EXECUTION_QUALITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const LINEAGE_HEALTH_LATEST_PATH = path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json");
const EXECUTION_QUALITY_REFRESH_SCRIPT = path.join(REPO_ROOT, "scripts", "report-best-self-evolution-execution-quality.js");
const LINEAGE_HEALTH_REFRESH_SCRIPT = path.join(REPO_ROOT, "scripts", "report-signal-lineage-health.js");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function runRefreshScript(scriptPath) {
  const res = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    const stderr = String(res.stderr || "").trim();
    const stdout = String(res.stdout || "").trim();
    throw new Error(stderr || stdout || `refresh script failed: ${path.basename(scriptPath)}`);
  }
  return {
    ok: true,
    script: scriptPath,
  };
}

function deriveSummaryStatus({ sloState = null, anomalyState = null } = {}) {
  if (anomalyState && anomalyState.circuit_breaker_open === true) return "중단";
  if (sloState && sloState.block_new_entries === true) return "보류";
  return "진행";
}

async function runSystemRuntimeGuardsJob({
  exchange = "BINANCEFUT",
  remediateOnBlock = false,
  dryRun = false,
  nowMs = Date.now(),
  artifactsDir = OPS_DAILY_DIR,
  loadOpsRuntime = loadOperationalGuardRuntime,
  loadServingRuntime = loadMlServingRuntime,
  buildSlo = buildSystemSloState,
  buildAnomaly = buildSystemAnomalyState,
  recordSlo = recordSystemSloState,
  recordAnomaly = recordSystemAnomalyState,
  recordRemediation = recordSystemAnomalyRemediationState,
  remediate = runSystemAnomalyRemediation,
  actuateServing = applyMlServingActuation,
  exportTrace = exportTraceContext,
  loadExecutionQuality = loadPreferredExecutionQualityInput,
  loadLineageHealth = loadPreferredLineageHealthInput,
  loadNativeTrailProtection = loadNativeTrailProtectionRuntime,
  runExitIntegrityCycle = runBinanceExitIntegrityCycle,
  runTradeAlertOutboxLineageCheck = runTradeAlertOutboxLineageEvidenceCheck,
  runSignalLifecycleAlertDedupeCheck = runSignalLifecycleAlertDedupeEvidenceCheck,
  refreshExecutionQualityInput = () => runRefreshScript(EXECUTION_QUALITY_REFRESH_SCRIPT),
  refreshLineageHealthInput = () => runRefreshScript(LINEAGE_HEALTH_REFRESH_SCRIPT),
} = {}) {
  const ex = String(exchange || "BINANCEFUT").trim().toUpperCase();
  const generatedAtIso = new Date(nowMs).toISOString();
  const generatedAtKst = toKstString(generatedAtIso, { fallbackToString: true });
  const artifactBaseDir = path.resolve(String(artifactsDir || OPS_DAILY_DIR));
  const exitIntegrityApply = dryRun === true
    ? false
    : !["0", "false", "off", "no"].includes(String(process.env.SYSTEM_RUNTIME_GUARDS_EXIT_INTEGRITY_APPLY || "true").trim().toLowerCase());
  const exitIntegrityCycle = await Promise.resolve().then(() => runExitIntegrityCycle({
    apply: exitIntegrityApply,
    exchange: ex,
    opsDailyDir: artifactBaseDir,
  })).catch((err) => ({
    ok: false,
    status: "FAIL",
    reason: err && err.message ? err.message : String(err),
    summary: {
      status: "FAIL",
      live_issue_count: null,
      reasons: [err && err.message ? err.message : String(err)],
    },
    output_json: path.join(artifactBaseDir, "binance_exit_integrity_cycle_latest.json"),
    output_md: path.join(artifactBaseDir, "binance_exit_integrity_cycle_latest.md"),
  }));

  const [operationalGuard, mlServing] = await Promise.all([
    loadOpsRuntime({ exchange: ex, force: true }),
    loadServingRuntime({ exchange: ex, force: true }),
  ]);
  const tradeAlertOutboxLineage = await Promise.resolve().then(() => runTradeAlertOutboxLineageCheck({
    ...process.env,
    TRADE_ALERT_OUTBOX_LINEAGE_SOFT: "1",
    TRADE_ALERT_OUTBOX_LINEAGE_QUIET: "1",
    TRADE_ALERT_OUTBOX_LINEAGE_OUTPUT_DIR: artifactBaseDir,
  })).catch((err) => ({
    ok: false,
    reason: "TRADE_ALERT_OUTBOX_LINEAGE_EVIDENCE_THROWN",
    blockers: ["TRADE_ALERT_OUTBOX_LINEAGE:CHECK_FAILED"],
    error: err && err.message ? err.message : String(err),
    checked_row_n: null,
    checked_exit_like_row_n: null,
    issue_row_n: null,
    issues: [],
    output_json: path.join(artifactBaseDir, "trade_alert_outbox_lineage_evidence_latest.json"),
  }));
  const signalLifecycleAlertDedupe = await Promise.resolve().then(() => runSignalLifecycleAlertDedupeCheck({
    ...process.env,
    SIGNAL_LIFECYCLE_ALERT_DEDUPE_SOFT: "1",
    SIGNAL_LIFECYCLE_ALERT_DEDUPE_QUIET: "1",
    SIGNAL_LIFECYCLE_ALERT_DEDUPE_OUTPUT_DIR: artifactBaseDir,
  })).catch((err) => ({
    ok: false,
    reason: "SIGNAL_LIFECYCLE_ALERT_DEDUPE_EVIDENCE_THROWN",
    blockers: ["SIGNAL_LIFECYCLE_ALERT_DEDUPE:CHECK_FAILED"],
    error: err && err.message ? err.message : String(err),
    checked_row_n: null,
    checked_sent_row_n: null,
    issue_row_n: null,
    issues: [],
    output_json: path.join(artifactBaseDir, "signal_lifecycle_alert_dedupe_evidence_latest.json"),
  }));
  const staleMaxAgeMs = Math.max(60 * 1000, Number(process.env.SYSTEM_SLO_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
  const [executionQuality, lineageHealth, nativeTrailProtection] = await Promise.all([
    Promise.resolve().then(() => loadExecutionQuality({
      maxAgeMs: staleMaxAgeMs,
      nowMs,
      refreshLocal: refreshExecutionQualityInput,
    })),
    Promise.resolve().then(() => loadLineageHealth({
      maxAgeMs: staleMaxAgeMs,
      nowMs,
      refreshLocal: refreshLineageHealthInput,
    })),
    Promise.resolve().then(() => loadNativeTrailProtection({ exchange: ex })),
  ]);
  const trace = normalizeTraceContext({
    requestId: null,
    runId: `RUN__SYSTEM_RUNTIME_GUARDS__${ex}__${nowMs}`,
    exchange: ex,
    symbol: "ALL",
    mutationKind: "SYSTEM_RUNTIME_GUARDS",
    source: "SYSTEM_RUNTIME_GUARDS_JOB",
    spanName: "system.runtime.guards",
  });
  const sloState = buildSlo({
    exchange: ex,
    operationalGuard,
    mlServing,
    executionQuality,
    lineageHealth,
    nativeTrailProtection,
    exitIntegrityCycle,
    tradeAlertOutboxLineage,
    signalLifecycleAlertDedupe,
    nowMs,
  });
  const anomalyState = buildAnomaly({
    exchange: ex,
    systemSlo: sloState,
    operationalGuard,
    mlServing,
    executionQuality,
    nativeTrailProtection,
    exitIntegrityCycle,
    nowMs,
  });
  const executionQualitySummary = executionQuality && typeof executionQuality === "object"
    ? (executionQuality.summary && typeof executionQuality.summary === "object" ? executionQuality.summary : executionQuality)
    : {};
  const executionQualityRootCause = executionQualitySummary.root_cause && typeof executionQualitySummary.root_cause === "object"
    ? executionQualitySummary.root_cause
    : {};
  const sloPath = path.join(artifactBaseDir, "system_slo_state_latest.json");
  const anomalyPath = path.join(artifactBaseDir, "system_anomaly_state_latest.json");
  const nativeTrailProtectionPath = path.join(artifactBaseDir, "native_trail_protection_gap_latest.json");
  writeJson(sloPath, {
    ok: true,
    generated_at_kst: generatedAtKst,
    exchange: ex,
    trace,
    state: sloState,
  });
  writeJson(anomalyPath, {
    ok: true,
    generated_at_kst: generatedAtKst,
    exchange: ex,
    trace,
    state: anomalyState,
  });
  writeJson(nativeTrailProtectionPath, {
    ok: true,
    generated_at_kst: generatedAtKst,
    exchange: ex,
    trace,
    summary: nativeTrailProtection,
  });

  await Promise.allSettled([
    recordSlo({
      exchange: ex,
      generatedAt: generatedAtIso,
      state: sloState,
      source: "RUN_SYSTEM_RUNTIME_GUARDS",
      artifacts: {
        latest_json: sloPath,
        binance_exit_integrity_cycle_latest_json: exitIntegrityCycle && exitIntegrityCycle.output_json ? exitIntegrityCycle.output_json : null,
      },
    }),
    recordAnomaly({
      exchange: ex,
      generatedAt: generatedAtIso,
      state: anomalyState,
      source: "RUN_SYSTEM_RUNTIME_GUARDS",
      artifacts: {
        latest_json: anomalyPath,
        binance_exit_integrity_cycle_latest_json: exitIntegrityCycle && exitIntegrityCycle.output_json ? exitIntegrityCycle.output_json : null,
      },
    }),
  ]);

  let remediation = {
    ok: true,
    skipped: true,
    reason: remediateOnBlock === true ? "SYSTEM_ANOMALY_BREAKER_CLOSED" : "SYSTEM_ANOMALY_REMEDIATION_DISABLED",
    exchange: ex,
    dry_run: dryRun === true,
    remediated_positions: 0,
    rows: [],
  };
  let actuation = {
    ok: true,
    skipped: true,
    reason: "NO_ML_ROLLBACK_REQUEST",
    exchange: ex,
  };
  if (String(anomalyState.rollback_action || "").trim().toUpperCase() === "REQUEST_ML_ROLLBACK") {
    actuation = await actuateServing({
      exchange: ex,
      servingState: {
        ...(mlServing && typeof mlServing === "object" ? mlServing : {}),
        promotion_action: {
          action: "ROLLBACK_AND_BLOCK",
        },
      },
      generatedAt: generatedAtIso,
    }).catch((err) => ({
      ok: false,
      exchange: ex,
      reason: err && err.message ? err.message : String(err),
    }));
  }
  if (remediateOnBlock === true && anomalyState.circuit_breaker_open === true) {
    remediation = await remediate({
      exchange: ex,
      anomalyState,
      dryRun,
    }).catch((err) => ({
      ok: false,
      reason: err && err.message ? err.message : String(err),
      exchange: ex,
      remediated_positions: 0,
      rows: [],
    }));
  }
  if (remediation) {
    const remediationPath = path.join(artifactBaseDir, "system_anomaly_remediation_latest.json");
    writeJson(remediationPath, {
      ok: remediation.ok === true,
      generated_at_kst: generatedAtKst,
      exchange: ex,
      trace,
      actuation,
      remediation,
    });
    remediation.artifacts = {
      latest_json: remediationPath,
    };
    await Promise.allSettled([
      recordRemediation({
        exchange: ex,
        generatedAt: generatedAtIso,
        remediation,
        source: "RUN_SYSTEM_RUNTIME_GUARDS",
        artifacts: remediation.artifacts,
      }),
    ]);
  }

  const otelExport = await exportTrace({
    trace,
    spanName: trace.span_name || "system.runtime.guards",
    startTime: nowMs,
    endTime: Date.now(),
    attributes: {
      exchange: ex,
      system_slo_status: sloState.status,
      system_anomaly_status: anomalyState.status,
      circuit_breaker_open: anomalyState.circuit_breaker_open === true,
      rollback_action: anomalyState.rollback_action || null,
      remediation_skipped: remediation && remediation.skipped === true,
      actuation_skipped: actuation && actuation.skipped === true,
      native_trail_protection_gap_count: Number(nativeTrailProtection && nativeTrailProtection.gap_count || 0),
      exit_integrity_status: String(exitIntegrityCycle && exitIntegrityCycle.status || exitIntegrityCycle && exitIntegrityCycle.summary && exitIntegrityCycle.summary.status || "UNKNOWN"),
      exit_integrity_live_issue_count: Number(exitIntegrityCycle && exitIntegrityCycle.summary && exitIntegrityCycle.summary.live_issue_count || 0),
      trade_alert_outbox_lineage_status: String(tradeAlertOutboxLineage && tradeAlertOutboxLineage.reason || "UNKNOWN"),
      trade_alert_outbox_lineage_issue_row_n: Number(tradeAlertOutboxLineage && tradeAlertOutboxLineage.issue_row_n || 0),
      signal_lifecycle_alert_dedupe_status: String(signalLifecycleAlertDedupe && signalLifecycleAlertDedupe.reason || "UNKNOWN"),
      signal_lifecycle_alert_dedupe_issue_row_n: Number(signalLifecycleAlertDedupe && signalLifecycleAlertDedupe.issue_row_n || 0),
      execution_quality_latency_driver: executionQualityRootCause.latency && executionQualityRootCause.latency.driver || null,
      execution_quality_partial_driver_market: executionQualityRootCause.partial_fill && executionQualityRootCause.partial_fill.driver_market || null,
      execution_quality_slippage_driver_market: executionQualityRootCause.slippage && executionQualityRootCause.slippage.driver_market || null,
      execution_quality_no_fill_reason: executionQualityRootCause.no_fill && executionQualityRootCause.no_fill.driver_reason || null,
    },
  });

  return {
    ok: true,
    exchange: ex,
    generated_at_iso: generatedAtIso,
    generated_at_kst: generatedAtKst,
    trace,
    status: deriveSummaryStatus({ sloState, anomalyState }),
    system_slo_status: sloState.status,
    system_slo_reason: sloState.reason,
    system_anomaly_status: anomalyState.status,
    system_anomaly_reason: anomalyState.reason,
    circuit_breaker_open: anomalyState.circuit_breaker_open === true,
    remediate_on_block: remediateOnBlock === true,
    actuation,
    remediation,
    otel_export: otelExport,
    execution_quality_focus: executionQualityRootCause,
    native_trail_protection: nativeTrailProtection,
    exit_integrity_cycle: exitIntegrityCycle,
    trade_alert_outbox_lineage: tradeAlertOutboxLineage,
    signal_lifecycle_alert_dedupe: signalLifecycleAlertDedupe,
    artifacts: {
      system_slo_latest_json: sloPath,
      system_anomaly_latest_json: anomalyPath,
      native_trail_protection_latest_json: nativeTrailProtectionPath,
      binance_exit_integrity_cycle_latest_json: exitIntegrityCycle && exitIntegrityCycle.output_json ? exitIntegrityCycle.output_json : null,
      trade_alert_outbox_lineage_latest_json: tradeAlertOutboxLineage && tradeAlertOutboxLineage.output_json ? tradeAlertOutboxLineage.output_json : path.join(artifactBaseDir, "trade_alert_outbox_lineage_evidence_latest.json"),
      signal_lifecycle_alert_dedupe_latest_json: signalLifecycleAlertDedupe && signalLifecycleAlertDedupe.output_json ? signalLifecycleAlertDedupe.output_json : path.join(artifactBaseDir, "signal_lifecycle_alert_dedupe_evidence_latest.json"),
      system_anomaly_remediation_latest_json: remediation && remediation.artifacts ? remediation.artifacts.latest_json : null,
    },
  };
}

module.exports = {
  runSystemRuntimeGuardsJob,
  __test: {
    deriveSummaryStatus,
    runRefreshScript,
  },
};
