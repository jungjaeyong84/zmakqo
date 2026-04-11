"use strict";

const fs = require("fs");
const path = require("path");
const { loadSystemSloRuntime } = require("./systemSloRuntime");
const { loadSystemAnomalyRuntime } = require("./systemAnomalyRuntime");
const { getSystemAnomalyRemediationState } = require("../storage/systemAnomalyRemediationStates");
const { getOperationalRuntimeState } = require("../storage/operationalRuntimeStates");
const { toKstString } = require("../utils/timeKst");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const REMEDIATION_LATEST_PATH = path.join(OPS_DAILY_DIR, "system_anomaly_remediation_latest.json");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function parseDateMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function clone(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}

function normalizeRemediation(remediation = null, generatedAt = null) {
  const raw = clone(remediation);
  if (!raw || typeof raw !== "object") return null;
  raw.generated_at = raw.generated_at || generatedAt || null;
  raw.generated_at_ms = parseDateMs(raw.generated_at_ms || raw.generated_at || generatedAt || null);
  raw.remediated_positions = Number.isFinite(Number(raw.remediated_positions)) ? Number(raw.remediated_positions) : 0;
  raw.rows = Array.isArray(raw.rows) ? raw.rows : [];
  raw.dry_run = raw.dry_run === true;
  raw.skipped = raw.skipped === true;
  raw.ok = raw.ok !== false;
  return raw;
}

async function loadLatestRemediation({ exchange = null } = {}) {
  const ex = upper(exchange);
  const doc = await getSystemAnomalyRemediationState({ exchange: ex }).catch(() => null);
  if (doc && doc.remediation && typeof doc.remediation === "object") {
    return normalizeRemediation(doc.remediation, doc.generated_at || null);
  }
  const fileDoc = safeReadJson(REMEDIATION_LATEST_PATH);
  if (fileDoc && String(fileDoc.exchange || "").trim().toUpperCase() === ex) {
    return normalizeRemediation(fileDoc.remediation || null, fileDoc.generated_at || fileDoc.generated_at_kst || null);
  }
  return null;
}

async function loadSystemRuntimeGuardView({
  exchange = "BINANCEFUT",
  force = false,
  systemSlo = null,
  systemAnomaly = null,
} = {}) {
  const ex = upper(exchange) || "BINANCEFUT";
  const slo = systemSlo && typeof systemSlo === "object"
    ? clone(systemSlo)
    : await loadSystemSloRuntime({ exchange: ex, force });
  const anomaly = systemAnomaly && typeof systemAnomaly === "object"
    ? clone(systemAnomaly)
    : await loadSystemAnomalyRuntime({ exchange: ex, systemSlo: slo, force });
  const remediation = await loadLatestRemediation({ exchange: ex });
  const operationalRuntime = await getOperationalRuntimeState({ exchange: ex }).catch(() => null);
  const runtimeState = operationalRuntime && operationalRuntime.state && typeof operationalRuntime.state === "object"
    ? operationalRuntime.state
    : {};
  const writerAuthority = runtimeState.position_writer_authority_24h && typeof runtimeState.position_writer_authority_24h === "object"
    ? clone(runtimeState.position_writer_authority_24h)
    : null;

  const generatedAtMsCandidates = [
    parseDateMs(slo && (slo.generated_at_ms || slo.generated_at)),
    parseDateMs(anomaly && (anomaly.generated_at_ms || anomaly.generated_at)),
    parseDateMs(remediation && (remediation.generated_at_ms || remediation.generated_at)),
  ].filter((value) => Number.isFinite(value));
  const generatedAtMs = generatedAtMsCandidates.length ? Math.max(...generatedAtMsCandidates) : null;

  let tone = "ok";
  if (anomaly && anomaly.circuit_breaker_open === true) tone = "danger";
  else if ((slo && slo.block_new_entries === true) || (anomaly && String(anomaly.status || "").toUpperCase() === "WARN")) tone = "warn";

  return {
    exchange: ex,
    tone,
    generated_at: Number.isFinite(generatedAtMs) ? new Date(generatedAtMs).toISOString() : null,
    generated_at_kst: Number.isFinite(generatedAtMs) ? toKstString(new Date(generatedAtMs).toISOString(), { fallbackToString: true }) : null,
    block_new_entries: !!(slo && slo.block_new_entries === true),
    circuit_breaker_open: !!(anomaly && anomaly.circuit_breaker_open === true),
    slo_status: String(slo && slo.status || "UNKNOWN").toUpperCase(),
    slo_reason: String(slo && slo.reason || "UNKNOWN").toUpperCase(),
    slo_issues: Array.isArray(slo && slo.issues) ? slo.issues.slice() : [],
    anomaly_status: String(anomaly && anomaly.status || "UNKNOWN").toUpperCase(),
    anomaly_reason: String(anomaly && anomaly.reason || "UNKNOWN").toUpperCase(),
    anomaly_issues: Array.isArray(anomaly && anomaly.issues) ? anomaly.issues.slice() : [],
    writer_authority: writerAuthority,
    remediation,
  };
}

module.exports = {
  loadSystemRuntimeGuardView,
  __test: {
    normalizeRemediation,
  },
};
