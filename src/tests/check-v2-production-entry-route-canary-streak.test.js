"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const checker = require("../../scripts/check-v2-production-entry-route-canary-streak");

function buildHealthyPayload(generatedAt) {
  return {
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS",
    scope: "production_entry_route_canary",
    canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
    exchange_write_performed: false,
    route_called: true,
    kernel_called: true,
    persist_called: true,
    generated_at: generatedAt,
    fail_n: 0,
    failed_check_ids: [],
    route_result_summary: {
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED",
      position_cycle_id: "PCYV2__ETHUSDT__ENTRY__CANARY",
      entry_event_id: "ENTRY__V2_PRODUCTION_ROUTE_CANARY",
      protection_runtime_id: "PCYV2__ETHUSDT__ENTRY__CANARY__PROTECTION_RUNTIME__CANARY",
      audit_ledger_reason: "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED",
    },
  };
}

function buildHistory(rows) {
  return {
    rows: rows.map((payload, index) => ({
      line_no: index + 1,
      raw: JSON.stringify(payload),
      payload,
    })),
    invalid_lines: [],
  };
}

(function streakPassesWithContinuousHealthyCoverage() {
  const nowMs = Date.parse("2026-04-21T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  const report = checker.evaluateProductionEntryRouteCanaryStreak({
    history: buildHistory(rows),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
    historyFile: "/tmp/history.jsonl",
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS");
  assert.strictEqual(report.healthy_run_n, 13);
  assert.strictEqual(report.blockers.length, 0);
})();

(function streakFailsOnSingleLatestOnlyEvidence() {
  const nowMs = Date.parse("2026-04-21T12:00:00.000Z");
  const report = checker.evaluateProductionEntryRouteCanaryStreak({
    history: buildHistory([
      buildHealthyPayload("2026-04-21T12:00:00.000Z"),
    ]),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:MIN_RUN_COUNT"));
  assert.ok(report.blockers.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:COVERAGE_INSUFFICIENT"));
})();

(function streakFailsOnUnhealthyRouteResult() {
  const nowMs = Date.parse("2026-04-21T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  rows[5] = {
    ...rows[5],
    route_result_summary: {
      ...rows[5].route_result_summary,
      audit_ledger_reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
    },
  };
  const report = checker.evaluateProductionEntryRouteCanaryStreak({
    history: buildHistory(rows),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:UNHEALTHY_ROW_IN_WINDOW"));
})();

(function parserReportsInvalidJsonl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-prod-route-streak-"));
  try {
    const filePath = path.join(dir, "history.jsonl");
    fs.writeFileSync(filePath, `${JSON.stringify(buildHealthyPayload("2026-04-21T12:00:00.000Z"))}\n{bad-json}\n`, "utf8");
    const parsed = checker.parseHistoryFile(filePath);
    assert.strictEqual(parsed.rows.length, 1);
    assert.strictEqual(parsed.invalid_lines.length, 1);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function helperDefaultsStayStable() {
  assert.ok(checker.__test.resolveHistoryFile({}).endsWith("v2_production_entry_route_canary_history.jsonl"));
  assert.ok(checker.__test.resolveOutputFile({}).endsWith("v2_production_entry_route_canary_streak_latest.json"));
  assert.strictEqual(checker.__test.resolveStreakConfig({}).lookbackHours, 24);
})();

console.log("CHECK_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_TEST_OK");
