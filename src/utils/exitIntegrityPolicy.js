"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const EXIT_INTEGRITY_REPORT_PATH = path.join(OPS_DAILY_DIR, "binance_exit_integrity_cycle_latest.json");

const STOP_DIVERGENCE_CODE_META = Object.freeze({
  CHOSEN_STOP_MISSING: { label: "chosen stop 누락", severity: "bad" },
  NATIVE_STOP_MISMATCH: { label: "네이티브 stop 불일치", severity: "bad" },
  RUNNER_FLOOR_BROKEN: { label: "최소 보장 floor 위반", severity: "bad" },
  TRAIL_R_MISMATCH: { label: "TRAIL_R_MULTIPLE 불일치", severity: "bad" },
  TRAIL_STOP_BELOW_RUNNER_FLOOR_LONG: { label: "LONG stop이 runner floor 아래", severity: "bad" },
  TRAIL_STOP_ABOVE_RUNNER_FLOOR_SHORT: { label: "SHORT stop이 runner floor 위", severity: "bad" },
  TRAIL_STOP_CHOSEN_SOURCE_MISMATCH: { label: "chosen stop source 불일치", severity: "bad" },
  RUNNER_MIN_GUARANTEE_MISSED: { label: "최소 보장 수익 미준수", severity: "bad" },
  TRAIL_R_STOP_MISSING: { label: "TRAIL_R_MULTIPLE stop 누락", severity: "warn" },
  RUNNER_FLOOR_STOP_MISSING: { label: "runner floor stop 누락", severity: "warn" },
});

const STOP_DIVERGENCE_CODES = new Set(Object.keys(STOP_DIVERGENCE_CODE_META));

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toNum(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStopDivergenceCodes(codes = []) {
  const seen = new Set();
  const rows = [];
  for (const code of Array.isArray(codes) ? codes : []) {
    const normalized = upper(code);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
}

function getStopDivergenceMeta(code) {
  const normalized = upper(code);
  if (!normalized) {
    return {
      code: null,
      label: null,
      severity: "warn",
      display: null,
    };
  }
  const meta = STOP_DIVERGENCE_CODE_META[normalized] || {};
  return {
    code: normalized,
    label: String(meta.label || normalized).trim(),
    severity: String(meta.severity || "warn").trim() || "warn",
    display: `${normalized} · ${String(meta.label || normalized).trim()}`,
  };
}

function buildStopDivergenceItems(codes = []) {
  return normalizeStopDivergenceCodes(codes).map((code) => getStopDivergenceMeta(code));
}

function extractExitIntegritySummary(doc = null) {
  const raw = doc && typeof doc === "object" ? doc : null;
  const summary = raw && raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  const reasons = Array.isArray(summary && summary.reasons)
    ? summary.reasons.map((reason) => String(reason || "").trim()).filter(Boolean)
    : [];
  const canonicalExitStageFailN = toNum(summary && summary.canonical_exit_stage_fail_n, 0);
  const exitQtyLiveIssueChainN = toNum(summary && summary.exit_qty_live_issue_chain_n, 0);
  const trailFloorLiveViolationN = toNum(summary && summary.trail_floor_live_violation_n, 0);
  const fillSyncDuplicateGroupN = toNum(summary && summary.fill_sync_duplicate_group_n, 0);
  const duplicationLiveGroupN = toNum(summary && summary.duplication_live_group_n, 0);
  const fillSyncAlertEventIssueN = toNum(summary && summary.fill_sync_alert_event_issue_n, 0);
  const stopDivergenceSymbolN = toNum(summary && summary.stop_divergence_symbol_n, 0);
  const canonicalTransitionBackfillOk = summary
    ? (Object.prototype.hasOwnProperty.call(summary, "canonical_transition_backfill_ok")
      ? summary.canonical_transition_backfill_ok === true
      : true)
    : true;
  const issueStrikeFamilies = [];
  if (canonicalExitStageFailN > 0) issueStrikeFamilies.push("CANONICAL_EXIT_STAGE");
  if (exitQtyLiveIssueChainN > 0) issueStrikeFamilies.push("EXIT_QTY_CONTRACT");
  if (trailFloorLiveViolationN > 0) issueStrikeFamilies.push("MIN_GUARANTEE");
  if (stopDivergenceSymbolN > 0) issueStrikeFamilies.push("STOP_DIVERGENCE");
  if ((fillSyncDuplicateGroupN + duplicationLiveGroupN + fillSyncAlertEventIssueN) > 0) issueStrikeFamilies.push("DUPLICATE_ALERT");
  if (!canonicalTransitionBackfillOk) issueStrikeFamilies.push("CANONICAL_BACKFILL");
  return {
    available: !!summary,
    status: upper(summary && summary.status),
    liveGateBlocked: summary && summary.live_gate_blocked === true,
    stopDivergenceGate: upper(summary && summary.stop_divergence_gate),
    stopDivergenceSymbolN,
    canonicalExitStageFailN,
    exitQtyLiveIssueChainN,
    trailFloorLiveViolationN,
    fillSyncDuplicateGroupN,
    duplicationLiveGroupN,
    fillSyncAlertEventIssueN,
    canonicalTransitionBackfillOk,
    issueStrikeFamilies,
    issueStrikeCount: issueStrikeFamilies.length,
    reasons,
  };
}

const DEFAULT_REPORT_MAX_AGE_MS = (() => {
  const manifestSlaHours = 5;
  const n = Number(process.env.LIVE_EXEC_POLICY_EXIT_INTEGRITY_MAX_AGE_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return manifestSlaHours * 60 * 60 * 1000;
})();

function readExitIntegrityReport(filePath = EXIT_INTEGRITY_REPORT_PATH) {
  let stats = null;
  try {
    stats = fs.statSync(filePath);
  } catch (_err) {
    return { doc: null, mtimeMs: null, path: filePath, present: false };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { doc, mtimeMs: stats.mtimeMs || stats.mtime.getTime(), path: filePath, present: true };
  } catch (_err) {
    return { doc: null, mtimeMs: stats.mtimeMs || stats.mtime.getTime(), path: filePath, present: true, parseError: true };
  }
}

function resolveReportInput(input = null) {
  if (input === null || input === undefined) {
    return {
      disabled: true,
      doc: null,
      mtimeMs: null,
      path: null,
      present: false,
      parseError: false,
    };
  }
  if (input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "doc")) {
    const rawMtime = input.mtimeMs;
    const mtimeMs = (rawMtime === null || rawMtime === undefined || rawMtime === "")
      ? null
      : (Number.isFinite(Number(rawMtime)) ? Number(rawMtime) : null);
    return {
      disabled: input.disabled === true,
      doc: input.doc || null,
      mtimeMs,
      path: input.path || null,
      present: input.present === true,
      parseError: input.parseError === true,
    };
  }
  // Legacy plain-doc input — treat as an in-memory report with no mtime metadata.
  return {
    disabled: false,
    doc: input,
    mtimeMs: null,
    path: null,
    present: true,
    parseError: false,
  };
}

function deriveExitIntegrityExposureGuard(input = null, {
  blockedScale = 0.5,
  singleStrikeScale = 0.75,
  doubleStrikeScale = blockedScale,
  tripleStrikeScale = 0,
  maxAgeMs = DEFAULT_REPORT_MAX_AGE_MS,
  now = Date.now(),
} = {}) {
  const resolved = resolveReportInput(input);
  const summary = extractExitIntegritySummary(resolved.doc);
  const ageMs = Number.isFinite(resolved.mtimeMs) ? Math.max(0, now - resolved.mtimeMs) : null;
  const stale = Number.isFinite(ageMs) && Number.isFinite(maxAgeMs) && ageMs > maxAgeMs;
  const parseError = resolved.parseError === true;
  const missing = !parseError && !resolved.disabled && (resolved.present !== true || resolved.doc == null);

  if (resolved.disabled) {
    return {
      ...summary,
      scale: 1,
      active: false,
      reason: null,
      blockNewEntries: false,
      report_missing: false,
      report_parse_error: false,
      report_stale: false,
      report_mtime_ms: null,
      report_age_ms: null,
      report_max_age_ms: maxAgeMs,
      report_path: null,
      report_disabled: true,
    };
  }

  if (parseError) {
    return {
      ...summary,
      scale: 0,
      active: true,
      reason: "LIVE_POLICY_EXIT_INTEGRITY_REPORT_PARSE_ERROR",
      blockNewEntries: true,
      report_missing: false,
      report_parse_error: true,
      report_stale: false,
      report_mtime_ms: resolved.mtimeMs,
      report_age_ms: ageMs,
      report_max_age_ms: maxAgeMs,
      report_path: resolved.path,
    };
  }

  if (missing) {
    return {
      ...summary,
      scale: 0,
      active: true,
      reason: "LIVE_POLICY_EXIT_INTEGRITY_REPORT_MISSING",
      blockNewEntries: true,
      report_missing: true,
      report_parse_error: false,
      report_stale: false,
      report_mtime_ms: resolved.mtimeMs,
      report_age_ms: ageMs,
      report_max_age_ms: maxAgeMs,
      report_path: resolved.path,
    };
  }

  if (stale) {
    return {
      ...summary,
      scale: 0,
      active: true,
      reason: "LIVE_POLICY_EXIT_INTEGRITY_REPORT_STALE",
      blockNewEntries: true,
      report_missing: false,
      report_parse_error: false,
      report_stale: true,
      report_mtime_ms: resolved.mtimeMs,
      report_age_ms: ageMs,
      report_max_age_ms: maxAgeMs,
      report_path: resolved.path,
    };
  }

  let scale = 1;
  let reason = null;
  let blockNewEntries = false;
  if (summary.issueStrikeCount >= 3) {
    scale = clamp(tripleStrikeScale, 0, 1);
    reason = "LIVE_POLICY_EXIT_INTEGRITY_TRIPLE_STRIKE_BLOCK";
    blockNewEntries = scale <= 0;
  } else if (summary.issueStrikeCount === 2) {
    scale = clamp(doubleStrikeScale, 0, 1);
    reason = "LIVE_POLICY_EXIT_INTEGRITY_DOUBLE_STRIKE_SCALE";
  } else if (summary.issueStrikeCount === 1) {
    scale = clamp(singleStrikeScale, 0, 1);
    reason = "LIVE_POLICY_EXIT_INTEGRITY_SINGLE_STRIKE_SCALE";
  }
  return {
    ...summary,
    scale,
    active: scale < 1,
    reason: scale < 1 ? reason : null,
    blockNewEntries,
    report_missing: false,
    report_parse_error: false,
    report_stale: false,
    report_mtime_ms: resolved.mtimeMs,
    report_age_ms: ageMs,
    report_max_age_ms: maxAgeMs,
    report_path: resolved.path,
  };
}

module.exports = {
  EXIT_INTEGRITY_REPORT_PATH,
  DEFAULT_REPORT_MAX_AGE_MS,
  STOP_DIVERGENCE_CODES,
  normalizeStopDivergenceCodes,
  getStopDivergenceMeta,
  buildStopDivergenceItems,
  extractExitIntegritySummary,
  readExitIntegrityReport,
  deriveExitIntegrityExposureGuard,
};
