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
    native_trail_protection: nativeTrailProtection,
    exit_integrity_cycle: exitIntegrityCycle,
    artifacts: {
      system_slo_latest_json: sloPath,
      system_anomaly_latest_json: anomalyPath,
      native_trail_protection_latest_json: nativeTrailProtectionPath,
      binance_exit_integrity_cycle_latest_json: exitIntegrityCycle && exitIntegrityCycle.output_json ? exitIntegrityCycle.output_json : null,
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
