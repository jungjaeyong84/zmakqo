"use strict";

const { evaluateV2DeployGate } = require("./deployGate");

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

const TERMINAL_WATCHDOG_ISSUE_CODES = new Set([
  "TERMINAL_TRANSITION_MISSING",
  "TERMINAL_PROJECTION_MISMATCH",
  "TERMINAL_STAGE_WITH_ACTIVE_POSITION",
]);

function normalizeSection(name, report) {
  const label = String(name || "").trim().toUpperCase() || "UNKNOWN";
  const row = report && typeof report === "object" ? report : null;
  if (!row) {
    return Object.freeze({
      name: label,
      pass: false,
      blockers: [`${label}:REPORT_REQUIRED`],
      warnings: [],
      report: null,
    });
  }
  return Object.freeze({
    name: label,
    pass: row.pass === true,
    blockers: ensureArray(row.blockers).map((item) => `${label}:${item}`),
    warnings: ensureArray(row.warnings).map((item) => `${label}:${item}`),
    report: row,
  });
}

function extractCriticalWatchdogIssueCodes(replayReport) {
  const row = replayReport && typeof replayReport === "object" ? replayReport : null;
  const out = new Set();
  for (const blocker of ensureArray(row && row.blockers)) {
    const text = String(blocker || "").trim();
    const marker = "WATCHDOG_ISSUES_PRESENT:";
    const idx = text.indexOf(marker);
    if (idx < 0) continue;
    const payload = text.slice(idx + marker.length);
    for (const code of payload.split("|")) {
      const normalized = String(code || "").trim().toUpperCase();
      if (TERMINAL_WATCHDOG_ISSUE_CODES.has(normalized)) {
        out.add(normalized);
      }
    }
  }
  return Array.from(out);
}

function buildUnifiedPromotionReport({
  replayReport,
  shadowLiveComparisonReport,
  sourceModeComparisonReport,
  mode = "CANARY",
  policy = {},
} = {}) {
  const shadowLive = normalizeSection("SHADOW_LIVE", shadowLiveComparisonReport);
  const sourceMode = normalizeSection("SOURCE_MODE", sourceModeComparisonReport);
  const combinedComparison = Object.freeze({
    pass: shadowLive.pass === true && sourceMode.pass === true,
    blockers: [...shadowLive.blockers, ...sourceMode.blockers],
    warnings: [...shadowLive.warnings, ...sourceMode.warnings],
  });

  const deployGate = evaluateV2DeployGate({
    replayReport,
    comparisonReport: combinedComparison,
    mode,
    policy,
  });

  const replay = replayReport && typeof replayReport === "object"
    ? Object.freeze({
        pass: replayReport.pass === true,
        blockers: ensureArray(replayReport.blockers).map((item) => `REPLAY:${item}`),
        report: replayReport,
      })
    : Object.freeze({
        pass: false,
        blockers: ["REPLAY:REPORT_REQUIRED"],
        report: null,
      });
  const criticalWatchdogIssueCodes = extractCriticalWatchdogIssueCodes(replayReport);

  return Object.freeze({
    pass: deployGate.pass === true,
    failClosed: deployGate.failClosed === true,
    mode: deployGate.mode,
    replay,
    comparison: Object.freeze({
      shadowLive,
      sourceMode,
      combined: combinedComparison,
    }),
    deployGate,
    critical_watchdog_issue_codes: criticalWatchdogIssueCodes,
    blockers: deployGate.blockers,
    warnings: deployGate.warnings,
  });
}

module.exports = {
  buildUnifiedPromotionReport,
  __test: {
    extractCriticalWatchdogIssueCodes,
  },
};
