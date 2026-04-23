"use strict";

const DIAGNOSTIC_MAP = Object.freeze([
  {
    match: /^PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:/,
    family: "ENTRY_24H_CANARY",
    runbook_refs: Object.freeze(["26"]),
    commands: Object.freeze([
      "DONBEOLJA_V2_COLLECTION_PREFIX=v2__ DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED=1 DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE=FIRESTORE DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE=1 node scripts/check-v2-production-entry-route-canary-streak.js",
    ]),
  },
  {
    match: /^EXIT_RUNTIME_CANARY_STREAK:/,
    family: "EXIT_24H_CANARY",
    runbook_refs: Object.freeze(["28"]),
    commands: Object.freeze([
      "DONBEOLJA_V2_COLLECTION_PREFIX=v2__ DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED=1 DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE=FIRESTORE DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE=1 node scripts/check-v2-exit-runtime-canary-streak.js",
      "EXIT_INTEGRITY_ALERT_CHANNEL= APPLY=0 node scripts/run-binance-active-exit-watchdog.js",
    ]),
  },
  {
    match: /^FIRESTORE_COST_GUARD:/,
    family: "FIRESTORE_COST",
    runbook_refs: Object.freeze(["cost-guard"]),
    commands: Object.freeze([
      "npm run collect:v2-firestore-billing-metric",
      "V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC=1 npm run check:v2-firestore-cost-guard",
    ]),
  },
  {
    match: /^PERFORMANCE_GATE:/,
    family: "PERFORMANCE_GATE",
    runbook_refs: Object.freeze(["performance-gate"]),
    commands: Object.freeze([
      "npm run generate:v2-openclaw-daily-performance-report",
      "V2_PERFORMANCE_GATE_SOFT=1 npm run check:v2-performance-gate",
    ]),
  },
  {
    match: /^DEPLOY_DECISION:/,
    family: "DEPLOY_DECISION",
    runbook_refs: Object.freeze(["13E", "30"]),
    commands: Object.freeze([
      "npm run check:v2-promotion-deploy-decision",
      "npm run check:v2-live-evidence-readiness",
    ]),
  },
  {
    match: /^RISK_GOVERNOR:/,
    family: "RISK_GOVERNOR",
    runbook_refs: Object.freeze(["risk-governor"]),
    commands: Object.freeze([
      "node scripts/check-v2-risk-governor.js",
    ]),
  },
  {
    match: /^MARKET_DATA:/,
    family: "MARKET_DATA_QUALITY",
    runbook_refs: Object.freeze(["market-data-quality"]),
    commands: Object.freeze([
      "node scripts/check-v2-market-data-quality.js",
    ]),
  },
]);

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function classifyBlocker(blocker) {
  const text = String(blocker || "").trim();
  const row = DIAGNOSTIC_MAP.find((item) => item.match.test(text));
  if (!row) {
    return Object.freeze({
      blocker: text,
      family: "UNKNOWN",
      runbook_refs: Object.freeze([]),
      commands: Object.freeze([]),
    });
  }
  return Object.freeze({
    blocker: text,
    family: row.family,
    runbook_refs: row.runbook_refs,
    commands: row.commands,
  });
}

function buildRunbookDiagnosticPlan({ blockers = [] } = {}) {
  const rows = unique(blockers).map(classifyBlocker);
  const families = unique(rows.map((row) => row.family));
  const commands = unique(rows.flatMap((row) => row.commands));
  const runbookRefs = unique(rows.flatMap((row) => row.runbook_refs));
  return Object.freeze({
    ok: rows.length > 0,
    reason: rows.length > 0 ? "V2_RUNBOOK_DIAGNOSTIC_PLAN_READY" : "V2_RUNBOOK_DIAGNOSTIC_NO_BLOCKERS",
    blocker_n: rows.length,
    families: Object.freeze(families),
    runbook_refs: Object.freeze(runbookRefs),
    commands: Object.freeze(commands),
    rows: Object.freeze(rows),
  });
}

module.exports = {
  DIAGNOSTIC_MAP,
  classifyBlocker,
  buildRunbookDiagnosticPlan,
};
