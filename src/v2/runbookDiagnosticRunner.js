"use strict";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function blockerFamily(blocker) {
  const text = String(blocker || "").trim();
  if (!text) return "UNKNOWN";
  const idx = text.indexOf(":");
  return idx >= 0 ? text.slice(0, idx) : text;
}

const RUNBOOK_REFS = Object.freeze({
  SIGNAL_CRITERIA_BLOCKED: "RUNBOOK_SIGNAL_CRITERIA",
  HTF_REGIME: "RUNBOOK_HTF_ALIGNMENT",
  SETUP: "RUNBOOK_SETUP_FILTERS",
  MARKET_DATA_QUALITY: "RUNBOOK_MARKET_DATA_QUALITY",
  RISK_GOVERNOR: "RUNBOOK_RISK_GOVERNOR",
  DISCOVERY_CANARY_REALIZED_GUARD: "RUNBOOK_DISCOVERY_REALIZED_GUARD",
});

function buildRunbookDiagnosticPlan({ blockers = [] } = {}) {
  const list = asArray(blockers).map((item) => String(item || "").trim()).filter(Boolean);
  const families = Array.from(new Set(list.map(blockerFamily)));
  const runbookRefs = Array.from(new Set(families.map((family) => RUNBOOK_REFS[family]).filter(Boolean)));
  return {
    blocker_n: list.length,
    families,
    runbook_refs: runbookRefs,
  };
}

module.exports = {
  buildRunbookDiagnosticPlan,
  __test: {
    blockerFamily,
    buildRunbookDiagnosticPlan,
  },
};
