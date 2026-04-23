"use strict";

const { REQUIRED_REPLAY_TRANSITION_EVENTS } = require("./replayGate");

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveWarningLimit(mode, policy) {
  const normalizedMode = upper(mode) || "CANARY";
  const source = policy && typeof policy === "object" ? policy : {};
  if (normalizedMode === "SHADOW") return toNumberOrNull(source.shadowMaxWarningCount) ?? 999999;
  if (normalizedMode === "LIVE") return toNumberOrNull(source.liveMaxWarningCount) ?? 0;
  return toNumberOrNull(source.canaryMaxWarningCount) ?? 0;
}

function buildReplayCoverageBlockers(replayReport) {
  const row = replayReport && typeof replayReport === "object" ? replayReport : null;
  if (!row) return [];
  if (row.transition_event_coverage_required === false) return [];
  const coverage = row.transition_event_coverage && typeof row.transition_event_coverage === "object"
    ? row.transition_event_coverage
    : null;
  const required = ensureArray(row.required_transition_events).length
    ? ensureArray(row.required_transition_events)
    : REQUIRED_REPLAY_TRANSITION_EVENTS;
  if (!coverage) {
    return ["REPLAY_TRANSITION_EVENT_COVERAGE_REQUIRED"];
  }
  return required
    .map((event) => upper(event))
    .filter(Boolean)
    .filter((event) => !(Number(coverage[event]) > 0))
    .map((event) => `REPLAY_TRANSITION_EVENT_MISSING:${event}`);
}

function evaluateV2DeployGate({
  replayReport,
  comparisonReport,
  mode = "CANARY",
  policy = {},
} = {}) {
  const blockers = [];
  const warnings = [];
  const replay = replayReport && typeof replayReport === "object" ? replayReport : null;
  const comparison = comparisonReport && typeof comparisonReport === "object" ? comparisonReport : null;
  if (!replay) blockers.push("REPLAY_REPORT_REQUIRED");
  if (!comparison) blockers.push("COMPARISON_REPORT_REQUIRED");

  if (!blockers.length) {
    if (replay.pass !== true) {
      blockers.push(...ensureArray(replay.blockers).map((row) => `REPLAY:${row}`));
    }
    blockers.push(...buildReplayCoverageBlockers(replay).map((row) => `REPLAY:${row}`));
    if (comparison.pass !== true) {
      blockers.push(...ensureArray(comparison.blockers).map((row) => `COMPARISON:${row}`));
    }
    warnings.push(...ensureArray(comparison.warnings).map((row) => `COMPARISON:${row}`));
  }

  const warningLimit = resolveWarningLimit(mode, policy);
  if (warnings.length > warningLimit) {
    blockers.push(`WARNING_LIMIT_EXCEEDED:${warnings.length}>${warningLimit}`);
  }

  return Object.freeze({
    pass: blockers.length === 0,
    failClosed: blockers.length > 0,
    mode: upper(mode) || "CANARY",
    warning_limit: warningLimit,
    warning_n: warnings.length,
    block_n: blockers.length,
    blockers,
    warnings,
  });
}

module.exports = {
  evaluateV2DeployGate,
  __test: {
    buildReplayCoverageBlockers,
  },
};
