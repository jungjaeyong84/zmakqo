#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const OUTPUT_FILENAME = "v2-repair-queue-canary-preflight.json";
const CANARY_FILENAME = "v2-repair-queue-canary.json";
const OPERATIONAL_CANARY_FILENAME = "v2-repair-queue-operational-canary.json";
const FIRESTORE_CANARY_FILENAME = "v2-repair-queue-firestore-canary.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parsePositiveNumber(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return num;
  return Number(fallback);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR)
    || path.join(process.cwd(), "artifacts", "v2-repair-canary");
}

function resolveCanaryFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_FILE);
  if (explicit) return path.resolve(explicit);
  const dir = resolveArtifactDir(env);
  const filename = trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_FILE) || CANARY_FILENAME;
  return path.resolve(dir, filename);
}

function resolveOperationalCanaryFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_FILE);
  if (explicit) return path.resolve(explicit);
  const dir = trimOrNull(env.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_ARTIFACT_DIR)
    || resolveArtifactDir(env);
  const filename = trimOrNull(env.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_ARTIFACT_FILE)
    || OPERATIONAL_CANARY_FILENAME;
  return path.resolve(dir, filename);
}

function resolveFirestoreCanaryFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_FILE);
  if (explicit) return path.resolve(explicit);
  const dir = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR)
    || resolveArtifactDir(env);
  const filename = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_FILE)
    || FIRESTORE_CANARY_FILENAME;
  return path.resolve(dir, filename);
}

function resolveOutputFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_PREFLIGHT_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve(resolveArtifactDir(env), OUTPUT_FILENAME);
}

function resolvePreflightConfig(env = process.env) {
  const liveEnableRequested = parseBool(env.DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED, false);
  return Object.freeze({
    maxArtifactAgeMinutes: parsePositiveNumber(env.DONBEOLJA_V2_REPAIR_CANARY_MAX_AGE_MINUTES, 30),
    liveEnableRequested,
    operationalCanaryRequired: parseBool(
      env.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED,
      liveEnableRequested
    ),
    firestoreCanaryRequired: parseBool(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED, false),
  });
}

function readJsonArtifact(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  return Object.freeze({
    filePath: resolved,
    raw,
    payload: JSON.parse(raw),
  });
}

function buildCheck({ id, status, reason, field = null }) {
  return Object.freeze({
    id,
    status,
    reason: trimOrNull(reason),
    field: trimOrNull(field),
  });
}

function minutesSince(generatedAt, nowMs = Date.now()) {
  const ms = Date.parse(String(generatedAt || "").trim());
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (Number(nowMs) - ms) / 60000);
}

function completionLedgers(payload = {}) {
  return (Array.isArray(payload && payload.completion_attempts) ? payload.completion_attempts : [])
    .map((row) => row && row.completion_ledger)
    .filter((row) => row && typeof row === "object");
}

function hasRepairEvidenceSummary(payload = {}) {
  return completionLedgers(payload).some((ledger) => {
    const result = ledger.result_snapshot && typeof ledger.result_snapshot === "object"
      ? ledger.result_snapshot
      : {};
    const evidence = result.repair_evidence_summary && typeof result.repair_evidence_summary === "object"
      ? result.repair_evidence_summary
      : {};
    return (
      Array.isArray(result.runbook_refs) &&
      result.runbook_refs.length >= 1 &&
      Array.isArray(evidence.runbook_refs) &&
      evidence.runbook_refs.length >= 1 &&
      Array.isArray(evidence.order_evidence) &&
      evidence.order_evidence.length >= 1 &&
      evidence.order_evidence.every((order) => order && order.leg && order.order_status)
    );
  });
}

function evaluateCanaryPreflight({
  canaryArtifact,
  operationalCanaryArtifact = null,
  firestoreCanaryArtifact = null,
  config = resolvePreflightConfig({}),
  nowMs = Date.now(),
} = {}) {
  const artifact = canaryArtifact && typeof canaryArtifact === "object" ? canaryArtifact : null;
  const payload = artifact && artifact.payload && typeof artifact.payload === "object" ? artifact.payload : null;
  const raw = artifact ? String(artifact.raw || "") : "";
  const summary = payload && payload.summary && typeof payload.summary === "object" ? payload.summary : {};
  const verdict = payload && payload.verdict && typeof payload.verdict === "object" ? payload.verdict : {};
  const invariants = verdict && verdict.invariants && typeof verdict.invariants === "object" ? verdict.invariants : {};
  const refreshCalls = Array.isArray(payload && payload.refresh_calls) ? payload.refresh_calls : [];
  const firstRefresh = refreshCalls[0] && typeof refreshCalls[0] === "object" ? refreshCalls[0] : null;
  const ageMinutes = minutesSince(payload && payload.generated_at, nowMs);
  const operationalPayload = operationalCanaryArtifact && operationalCanaryArtifact.payload && typeof operationalCanaryArtifact.payload === "object"
    ? operationalCanaryArtifact.payload
    : null;
  const operationalRaw = operationalCanaryArtifact ? String(operationalCanaryArtifact.raw || "") : "";
  const operationalSummary = operationalPayload && operationalPayload.summary && typeof operationalPayload.summary === "object"
    ? operationalPayload.summary
    : {};
  const operationalAgeMinutes = minutesSince(operationalPayload && operationalPayload.generated_at, nowMs);
  const operationalIssueCodes = Array.isArray(operationalPayload && operationalPayload.watchdog_issue_codes)
    ? operationalPayload.watchdog_issue_codes
    : [];
  const firestorePayload = firestoreCanaryArtifact && firestoreCanaryArtifact.payload && typeof firestoreCanaryArtifact.payload === "object"
    ? firestoreCanaryArtifact.payload
    : null;
  const firestoreRaw = firestoreCanaryArtifact ? String(firestoreCanaryArtifact.raw || "") : "";
  const firestoreSummary = firestorePayload && firestorePayload.summary && typeof firestorePayload.summary === "object"
    ? firestorePayload.summary
    : {};
  const firestoreAgeMinutes = minutesSince(firestorePayload && firestorePayload.generated_at, nowMs);
  const firestoreIssueCodes = Array.isArray(firestorePayload && firestorePayload.watchdog_issue_codes)
    ? firestorePayload.watchdog_issue_codes
    : [];

  const checks = [];
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_01",
    status: payload && payload.ok === true ? "PASS" : "FAIL",
    reason: payload && payload.ok === true ? "canary ok=true" : "canary artifact must have ok=true",
    field: "ok",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_02",
    status: payload && payload.canary_mode === "DRY_RUN_FIXTURE" ? "PASS" : "FAIL",
    reason: payload && payload.canary_mode === "DRY_RUN_FIXTURE"
      ? "canary mode is dry-run fixture"
      : "canary mode must be DRY_RUN_FIXTURE before live repair enable",
    field: "canary_mode",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_03",
    status: payload && payload.exchange_write_performed === false ? "PASS" : "FAIL",
    reason: payload && payload.exchange_write_performed === false
      ? "artifact proves no exchange write"
      : "dry-run canary must not perform exchange writes",
    field: "exchange_write_performed",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_04",
    status: ageMinutes != null && ageMinutes <= Number(config.maxArtifactAgeMinutes) ? "PASS" : "FAIL",
    reason: ageMinutes != null && ageMinutes <= Number(config.maxArtifactAgeMinutes)
      ? `artifact age ${ageMinutes.toFixed(2)}m within limit`
      : "canary artifact is missing generated_at or stale",
    field: "generated_at",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_05",
    status: payload && payload.service_status === "HEALTHY" ? "PASS" : "FAIL",
    reason: payload && payload.service_status === "HEALTHY"
      ? "service status is HEALTHY"
      : "service status must be HEALTHY",
    field: "service_status",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_06",
    status: (
      Number(summary.requested_repair_n) === 1 &&
      Number(summary.delegated_repair_n) === 1 &&
      Number(summary.skipped_repair_n) === 0 &&
      Number(summary.missing_context_n) === 0
    ) ? "PASS" : "FAIL",
    reason: "repair queue must request and delegate exactly one fixture without skip or missing context",
    field: "summary",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_07",
    status: Number(summary.completion_success_n) === 1 && Number(summary.completion_failed_n) === 0 ? "PASS" : "FAIL",
    reason: "repair completion must succeed exactly once with zero failures",
    field: "summary.completion_success_n,summary.completion_failed_n",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_08",
    status: verdict && verdict.ok === true && Array.isArray(verdict.failed_invariants) && verdict.failed_invariants.length === 0
      ? "PASS"
      : "FAIL",
    reason: "canary invariants must all pass",
    field: "verdict",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_09",
    status: (
      Number(payload && payload.refresh_call_n) === 1 &&
      firstRefresh &&
      firstRefresh.writerSource === "BINANCE_TICK_EXIT" &&
      firstRefresh.liveDryRun === true
    ) ? "PASS" : "FAIL",
    reason: "refresh adapter must be called once through BINANCE_TICK_EXIT dry-run context",
    field: "refresh_call_n,refresh_calls[0]",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_10",
    status: invariants.delegated_and_completion_ledgers_written === true && Number(verdict.ledger_write_n) === 2
      ? "PASS"
      : "FAIL",
    reason: "delegated and completion ledgers must both be persisted",
    field: "verdict.ledger_write_n",
  }));
  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_11",
    status: (
      !raw.includes("apiKey") &&
      !raw.includes("apiSecret") &&
      !raw.includes("canary-key") &&
      !raw.includes("canary-secret")
    ) ? "PASS" : "FAIL",
    reason: "artifact must not expose credential field names or credential values",
    field: "raw",
  }));

  if (config.operationalCanaryRequired === true) {
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_12",
      status: operationalPayload && operationalPayload.ok === true ? "PASS" : "FAIL",
      reason: operationalPayload && operationalPayload.ok === true
        ? "operational canary ok=true"
        : "operational canary artifact must have ok=true",
      field: "operational.ok",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_13",
      status: operationalPayload && operationalPayload.canary_mode === "SHADOW_REPAIR_REQUEST_GENERATION" ? "PASS" : "FAIL",
      reason: "operational canary must prove watchdog-generated repair request flow",
      field: "operational.canary_mode",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_14",
      status: operationalPayload && operationalPayload.exchange_write_performed === false ? "PASS" : "FAIL",
      reason: "operational canary must not perform exchange writes",
      field: "operational.exchange_write_performed",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_15",
      status: operationalAgeMinutes != null && operationalAgeMinutes <= Number(config.maxArtifactAgeMinutes) ? "PASS" : "FAIL",
      reason: operationalAgeMinutes != null && operationalAgeMinutes <= Number(config.maxArtifactAgeMinutes)
        ? `operational canary age ${operationalAgeMinutes.toFixed(2)}m within limit`
        : "operational canary is missing generated_at or stale",
      field: "operational.generated_at",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_16",
      status: (
        operationalIssueCodes.includes("NATIVE_REFRESH_UNHEALTHY") &&
        operationalPayload &&
        operationalPayload.selected_issue_code === "NATIVE_REFRESH_UNHEALTHY" &&
        Number(operationalPayload.watchdog_generated_repair_request_n) >= 1
      ) ? "PASS" : "FAIL",
      reason: "watchdog must generate a NATIVE_REFRESH_UNHEALTHY repair request consumed by queue",
      field: "operational.watchdog_issue_codes,operational.selected_issue_code",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_17",
      status: (
        operationalPayload &&
        operationalPayload.service_status === "HEALTHY" &&
        Number(operationalSummary.completion_success_n) === 1 &&
        Number(operationalSummary.completion_failed_n) === 0
      ) ? "PASS" : "FAIL",
      reason: "operational canary repair completion must succeed exactly once with zero failures",
      field: "operational.summary",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_18",
      status: (
        !operationalRaw.includes("apiKey") &&
        !operationalRaw.includes("apiSecret") &&
        !operationalRaw.includes("canary-key") &&
        !operationalRaw.includes("canary-secret")
      ) ? "PASS" : "FAIL",
      reason: "operational canary artifact must not expose credential field names or values",
      field: "operational.raw",
    }));
  }

  if (config.firestoreCanaryRequired === true) {
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_19",
      status: firestorePayload && firestorePayload.ok === true ? "PASS" : "FAIL",
      reason: firestorePayload && firestorePayload.ok === true
        ? "firestore-backed canary ok=true"
        : "firestore-backed canary artifact must have ok=true",
      field: "firestore.ok",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_20",
      status: firestorePayload && firestorePayload.canary_mode === "FIRESTORE_BACKED_SHADOW_REPAIR_REQUEST_GENERATION" ? "PASS" : "FAIL",
      reason: "firestore-backed canary must prove storage adapter repair request flow",
      field: "firestore.canary_mode",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_21",
      status: (
        firestorePayload &&
        firestorePayload.firestore_write_performed === true &&
        firestorePayload.exchange_write_performed === false
      ) ? "PASS" : "FAIL",
      reason: "firestore-backed canary must write isolated Firestore docs and perform no exchange writes",
      field: "firestore.firestore_write_performed,firestore.exchange_write_performed",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_22",
      status: firestoreAgeMinutes != null && firestoreAgeMinutes <= Number(config.maxArtifactAgeMinutes) ? "PASS" : "FAIL",
      reason: firestoreAgeMinutes != null && firestoreAgeMinutes <= Number(config.maxArtifactAgeMinutes)
        ? `firestore-backed canary age ${firestoreAgeMinutes.toFixed(2)}m within limit`
        : "firestore-backed canary is missing generated_at or stale",
      field: "firestore.generated_at",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_23",
      status: (
        firestoreIssueCodes.includes("NATIVE_REFRESH_UNHEALTHY") &&
        firestorePayload &&
        firestorePayload.selected_issue_code === "NATIVE_REFRESH_UNHEALTHY" &&
        Number(firestorePayload.watchdog_generated_repair_request_n) >= 1
      ) ? "PASS" : "FAIL",
      reason: "firestore-backed canary must consume watchdog-generated NATIVE_REFRESH_UNHEALTHY request",
      field: "firestore.watchdog_issue_codes,firestore.selected_issue_code",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_24",
      status: (
        firestorePayload &&
        firestorePayload.service_status === "HEALTHY" &&
        Number(firestorePayload.seed_write_n) >= 4 &&
        Number(firestoreSummary.requested_repair_n) === 1 &&
        Number(firestoreSummary.delegated_repair_n) === 1 &&
        Number(firestoreSummary.completion_success_n) === 1 &&
        Number(firestoreSummary.completion_failed_n) === 0
      ) ? "PASS" : "FAIL",
      reason: "firestore-backed canary must seed fixture, delegate once, and complete once",
      field: "firestore.seed_write_n,firestore.summary",
    }));
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_25",
      status: (
        !firestoreRaw.includes("apiKey") &&
        !firestoreRaw.includes("apiSecret") &&
        !firestoreRaw.includes("canary-key") &&
        !firestoreRaw.includes("canary-secret")
      ) ? "PASS" : "FAIL",
      reason: "firestore-backed canary artifact must not expose credential field names or values",
      field: "firestore.raw",
    }));
  }

  checks.push(buildCheck({
    id: "RQ_CANARY_CHK_26",
    status: hasRepairEvidenceSummary(payload) ? "PASS" : "FAIL",
    reason: "base canary completion ledger must expose repair evidence summary, order evidence, and runbook refs",
    field: "completion_attempts[].completion_ledger.result_snapshot.repair_evidence_summary",
  }));
  if (config.operationalCanaryRequired === true || config.firestoreCanaryRequired === true) {
    checks.push(buildCheck({
      id: "RQ_CANARY_CHK_27",
      status: (
        (config.operationalCanaryRequired !== true || hasRepairEvidenceSummary(operationalPayload || {})) &&
        (config.firestoreCanaryRequired !== true || hasRepairEvidenceSummary(firestorePayload || {}))
      ) ? "PASS" : "FAIL",
      reason: "operational/firestore canaries must preserve repair evidence summary and runbook refs",
      field: "operational.completion_attempts,firestore.completion_attempts",
    }));
  }

  const failedChecks = checks.filter((row) => row.status !== "PASS");
  const blockers = failedChecks.map((row) => `REPAIR_CANARY_PREFLIGHT:${row.id}`);
  return Object.freeze({
    ok: failedChecks.length === 0,
    live_enable_requested: config.liveEnableRequested === true,
    operational_canary_required: config.operationalCanaryRequired === true,
    firestore_canary_required: config.firestoreCanaryRequired === true,
    canary_file: artifact ? artifact.filePath : null,
    operational_canary_file: operationalCanaryArtifact ? operationalCanaryArtifact.filePath : null,
    firestore_canary_file: firestoreCanaryArtifact ? firestoreCanaryArtifact.filePath : null,
    generated_at: trimOrNull(payload && payload.generated_at),
    age_minutes: ageMinutes,
    operational_generated_at: trimOrNull(operationalPayload && operationalPayload.generated_at),
    operational_age_minutes: operationalAgeMinutes,
    firestore_generated_at: trimOrNull(firestorePayload && firestorePayload.generated_at),
    firestore_age_minutes: firestoreAgeMinutes,
    max_artifact_age_minutes: Number(config.maxArtifactAgeMinutes),
    check_n: checks.length,
    fail_n: failedChecks.length,
    checks: Object.freeze(checks),
    blockers: Object.freeze(blockers),
  });
}

function runPreflight(env = process.env, { nowMs = Date.now() } = {}) {
  const config = resolvePreflightConfig(env);
  const canaryFile = resolveCanaryFile(env);
  const canaryArtifact = readJsonArtifact(canaryFile);
  const operationalCanaryArtifact = config.operationalCanaryRequired === true
    ? readJsonArtifact(resolveOperationalCanaryFile(env))
    : null;
  const firestoreCanaryArtifact = config.firestoreCanaryRequired === true
    ? readJsonArtifact(resolveFirestoreCanaryFile(env))
    : null;
  return evaluateCanaryPreflight({
    canaryArtifact,
    operationalCanaryArtifact,
    firestoreCanaryArtifact,
    config,
    nowMs,
  });
}

async function main(env = process.env) {
  const outputFile = resolveOutputFile(env);
  let report;
  try {
    report = runPreflight(env);
  } catch (error) {
    report = Object.freeze({
      ok: false,
      reason: "V2_REPAIR_QUEUE_CANARY_PREFLIGHT_THROWN",
      canary_file: resolveCanaryFile(env),
      operational_canary_file: resolveOperationalCanaryFile(env),
      firestore_canary_file: resolveFirestoreCanaryFile(env),
      blockers: Object.freeze(["REPAIR_CANARY_PREFLIGHT:ARTIFACT_READ_FAILED"]),
      error: Object.freeze({
        message: error && error.message ? error.message : String(error),
      }),
    });
  }
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, report);
  if (report.ok !== true) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_REPAIR_QUEUE_CANARY_PREFLIGHT_BLOCKED",
      output_file: outputFile,
      canary_file: report.canary_file,
      operational_canary_file: report.operational_canary_file,
      firestore_canary_file: report.firestore_canary_file,
      blockers: report.blockers,
    }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_REPAIR_QUEUE_CANARY_PREFLIGHT_PASS",
    output_file: outputFile,
    canary_file: report.canary_file,
    operational_canary_file: report.operational_canary_file,
    firestore_canary_file: report.firestore_canary_file,
    check_n: report.check_n,
  }));
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_REPAIR_QUEUE_CANARY_PREFLIGHT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runPreflight,
    evaluateCanaryPreflight,
    __test: {
      OUTPUT_FILENAME,
      CANARY_FILENAME,
      OPERATIONAL_CANARY_FILENAME,
      FIRESTORE_CANARY_FILENAME,
      trimOrNull,
      parseBool,
      parsePositiveNumber,
      resolveArtifactDir,
      resolveCanaryFile,
      resolveOperationalCanaryFile,
      resolveFirestoreCanaryFile,
      resolveOutputFile,
      resolvePreflightConfig,
      readJsonArtifact,
      buildCheck,
      minutesSince,
      completionLedgers,
      hasRepairEvidenceSummary,
    },
  };
}
