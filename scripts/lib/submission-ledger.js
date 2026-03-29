"use strict";

const fs = require("fs");
const path = require("path");
const { toKstString } = require("../../src/utils/timeKst");

const LEDGER_LATEST_NAME = "submission_ledger_latest.json";
const DEFAULT_POLICY = "same evidence_file keeps the first ledger-recorded submission timestamp";

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatKst(ms) {
  return toKstString(ms, { fallbackToString: true });
}

function normalizeRelPath(raw) {
  if (!raw) return null;
  return String(raw).replace(/\\/g, "/");
}

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function loadSubmissionLedger(opsDailyAbs) {
  const latestAbs = path.join(opsDailyAbs, LEDGER_LATEST_NAME);
  const base = {
    schema_version: "1.0",
    role: "submission_ledger_owner",
    basis: "submission_ledger",
    ledger_policy: DEFAULT_POLICY,
    generated_at_kst: null,
    generated_at_iso: null,
    entries: {},
  };
  const raw = readJsonSafe(latestAbs);
  if (!raw || typeof raw !== "object") {
    return { data: base, latest_abs: latestAbs, loaded: false };
  }
  return {
    data: {
      ...base,
      ...raw,
      entries: raw.entries && typeof raw.entries === "object" ? raw.entries : {},
    },
    latest_abs: latestAbs,
    loaded: true,
  };
}

function upsertSubmissionEntry(ledgerData, params) {
  const {
    role,
    evidenceFile,
    observedMtimeMs = null,
    nowMs = Date.now(),
    sourceScript = null,
  } = params || {};

  if (!ledgerData.entries || typeof ledgerData.entries !== "object") {
    ledgerData.entries = {};
  }

  const roleKey = String(role || "").trim();
  if (!roleKey) {
    return null;
  }

  const evidenceRel = normalizeRelPath(evidenceFile);
  const prev = ledgerData.entries[roleKey] || null;

  let submissionTsMs = null;
  let basis = "ledger_recorded_seed";
  const sameEvidence = Boolean(prev && evidenceRel && prev.evidence_file === evidenceRel);
  const prevFirstRecordedTs = sameEvidence
    ? toNum(prev.first_ledger_recorded_ts_ms, null)
    : null;
  const prevSubmissionTs = sameEvidence ? toNum(prev.ledger_submission_ts_ms, null) : null;
  const prevRecordedAtTs = sameEvidence ? toNum(prev.ledger_recorded_at_ms, null) : null;

  if (Number.isFinite(prevFirstRecordedTs)) {
    submissionTsMs = prevFirstRecordedTs;
    basis = "ledger_first_recorded_reuse";
  } else if (Number.isFinite(prevSubmissionTs)) {
    submissionTsMs = prevSubmissionTs;
    basis = "ledger_submission_reuse_legacy";
  } else if (Number.isFinite(prevRecordedAtTs)) {
    submissionTsMs = prevRecordedAtTs;
    basis = "ledger_recorded_backfill";
  } else if (Number.isFinite(toNum(nowMs, null))) {
    submissionTsMs = toNum(nowMs, null);
    basis = "ledger_recorded_seed";
  }

  const mtimeMs = toNum(observedMtimeMs, null);
  const entry = {
    role: roleKey,
    evidence_file: evidenceRel,
    evidence_exists: Boolean(evidenceRel),
    ledger_submission_ts_ms: Number.isFinite(submissionTsMs)
      ? Math.round(submissionTsMs)
      : null,
    ledger_submission_ts_kst: Number.isFinite(submissionTsMs)
      ? formatKst(submissionTsMs)
      : null,
    evidence_mtime_ms: Number.isFinite(mtimeMs) ? Math.round(mtimeMs) : null,
    evidence_mtime_kst: Number.isFinite(mtimeMs) ? formatKst(mtimeMs) : null,
    ledger_recorded_at_ms: Math.round(nowMs),
    ledger_recorded_at_kst: formatKst(nowMs),
    first_ledger_recorded_ts_ms: Number.isFinite(submissionTsMs)
      ? Math.round(submissionTsMs)
      : null,
    first_ledger_recorded_ts_kst: Number.isFinite(submissionTsMs)
      ? formatKst(submissionTsMs)
      : null,
    source_script: sourceScript,
    basis,
  };
  ledgerData.entries[roleKey] = entry;
  return entry;
}

function getSubmissionTsMs(ledgerData, params) {
  const { role, evidenceFile, fallbackMs = null } = params || {};
  const roleKey = String(role || "").trim();
  if (!roleKey || !ledgerData || !ledgerData.entries) {
    return toNum(fallbackMs, null);
  }
  const evidenceRel = normalizeRelPath(evidenceFile);
  const entry = ledgerData.entries[roleKey];
  if (entry && Number.isFinite(toNum(entry.ledger_submission_ts_ms, null))) {
    if (!evidenceRel || !entry.evidence_file || entry.evidence_file === evidenceRel) {
      return toNum(entry.ledger_submission_ts_ms, null);
    }
  }
  return toNum(fallbackMs, null);
}

function saveSubmissionLedger(opsDailyAbs, ledgerData, nowMs = Date.now()) {
  const asOfKst = formatKst(nowMs);
  const dateKey = asOfKst.slice(0, 10);
  const hhmm = asOfKst.slice(11, 16).replace(":", "");

  ledgerData.generated_at_kst = asOfKst;
  ledgerData.generated_at_iso = new Date(nowMs).toISOString();
  ledgerData.ledger_policy = DEFAULT_POLICY;

  const datedName = `${dateKey}_submission_ledger_${hhmm}_jihye.json`;
  const datedAbs = path.join(opsDailyAbs, datedName);
  const latestAbs = path.join(opsDailyAbs, LEDGER_LATEST_NAME);

  fs.writeFileSync(datedAbs, `${JSON.stringify(ledgerData, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestAbs, `${JSON.stringify(ledgerData, null, 2)}\n`, "utf8");

  return { dated_abs: datedAbs, latest_abs: latestAbs, dated_name: datedName };
}

module.exports = {
  loadSubmissionLedger,
  upsertSubmissionEntry,
  getSubmissionTsMs,
  saveSubmissionLedger,
  normalizeRelPath,
};
