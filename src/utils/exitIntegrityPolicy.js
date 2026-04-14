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
  return {
    available: !!summary,
    status: upper(summary && summary.status),
    liveGateBlocked: summary && summary.live_gate_blocked === true,
    stopDivergenceGate: upper(summary && summary.stop_divergence_gate),
    stopDivergenceSymbolN: toNum(summary && summary.stop_divergence_symbol_n, 0),
    canonicalTransitionBackfillOk: summary && summary.canonical_transition_backfill_ok === true,
    reasons,
  };
}

function readExitIntegrityReport(filePath = EXIT_INTEGRITY_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function deriveExitIntegrityExposureGuard(doc = null, { blockedScale = 0.5 } = {}) {
  const summary = extractExitIntegritySummary(doc);
  const scale = summary.stopDivergenceGate === "BLOCK"
    ? clamp(blockedScale, 0, 1)
    : 1;
  return {
    ...summary,
    scale,
    active: scale < 1,
    reason: scale < 1 ? "LIVE_POLICY_EXIT_INTEGRITY_STOP_DIVERGENCE_SCALE" : null,
  };
}

module.exports = {
  EXIT_INTEGRITY_REPORT_PATH,
  STOP_DIVERGENCE_CODES,
  normalizeStopDivergenceCodes,
  getStopDivergenceMeta,
  buildStopDivergenceItems,
  extractExitIntegritySummary,
  readExitIntegrityReport,
  deriveExitIntegrityExposureGuard,
};
