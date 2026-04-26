"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { __test } = require("../../scripts/check-v2-active-protection-reconciliation");
const { run } = require("../../scripts/check-v2-active-protection-reconciliation");

(() => {
  const pass = __test.summarizeActiveProtection({
    ok: true,
    exchange: "BINANCEFUT",
    issue_count: 0,
    issues: [],
    markets: [
      { symbol: "BNBUSDT", internal_active: true, external_active: true },
      { symbol: "SOLUSDT", internal_active: false, external_active: false },
    ],
  });
  assert.strictEqual(pass.ok, true);
  assert.strictEqual(pass.reason, "V2_ACTIVE_PROTECTION_RECONCILIATION_PASS");
  assert.strictEqual(pass.active_position_n, 1);
  assert.strictEqual(pass.protected_position_n, 1);
  assert.strictEqual(pass.unprotected_position_n, 0);

  const warnOnly = __test.summarizeActiveProtection({
    ok: false,
    exchange: "BINANCEFUT",
    issue_count: 1,
    issues: [{ symbol: "ETHUSDT", severity: "WARN", code: "NATIVE_ALGO_ORDER_VERIFY_UNAVAILABLE" }],
    markets: [{ symbol: "ETHUSDT", internal_active: false, external_active: true }],
  });
  assert.strictEqual(warnOnly.ok, true);
  assert.strictEqual(warnOnly.protected_position_n, 1);
  assert.strictEqual(warnOnly.unprotected_position_n, 0);

  const blocked = __test.summarizeActiveProtection({
    ok: false,
    exchange: "BINANCEFUT",
    issue_count: 1,
    issues: [
      { symbol: "XRPUSDT", severity: "CRIT", code: "NATIVE_TP1_MISSING" },
      { symbol: "ETHUSDT", severity: "WARN", code: "NATIVE_ALGO_ORDER_VERIFY_UNAVAILABLE" },
    ],
    markets: [
      { symbol: "XRPUSDT", internal_active: true, external_active: true },
      { symbol: "ETHUSDT", internal_active: false, external_active: true },
    ],
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, "V2_ACTIVE_PROTECTION_RECONCILIATION_BLOCKED");
  assert.strictEqual(blocked.active_position_n, 2);
  assert.strictEqual(blocked.protected_position_n, 1);
  assert.strictEqual(blocked.unprotected_position_n, 1);
  assert.deepStrictEqual(blocked.unprotected_symbols, ["XRPUSDT"]);
  assert.ok(__test.buildAlertBody(blocked).includes("protected=1/2"));
  assert.strictEqual(__test.shouldSendActiveProtectionAlert(pass, {}), false);
  assert.strictEqual(__test.shouldSendActiveProtectionAlert(pass, { V2_ACTIVE_PROTECTION_RECONCILIATION_SEND_ALERT: "1" }), true);
  assert.strictEqual(__test.shouldSendActiveProtectionAlert(blocked, {}), true);
  assert.strictEqual(__test.boolEnv("1"), true);
  assert.strictEqual(__test.boolEnv("0", true), false);

  const nowMs = Date.parse("2026-04-26T00:00:00.000Z");
  const firstDecision = __test.resolveActiveProtectionAlertDecision({ summary: blocked, previousState: null, nowMs });
  assert.strictEqual(firstDecision.should_send, true);
  assert.strictEqual(firstDecision.reason, "CRIT_IMMEDIATE");
  assert.strictEqual(firstDecision.severity, "CRITICAL");
  assert.strictEqual(firstDecision.fingerprint, "XRPUSDT:NATIVE_TP1_MISSING");
  const firstState = __test.buildNextAlertState({
    summary: blocked,
    alertDecision: firstDecision,
    alert: { ok: true },
    nowMs,
  });
  assert.strictEqual(firstState.status, "BLOCKED");
  assert.strictEqual(firstState.alert_sent_n, 1);
  const suppressedDecision = __test.resolveActiveProtectionAlertDecision({
    summary: blocked,
    previousState: firstState,
    nowMs: nowMs + 60000,
  });
  assert.strictEqual(suppressedDecision.should_send, false);
  assert.strictEqual(suppressedDecision.reason, "CRIT_BACKOFF_ACTIVE");
  assert.ok(suppressedDecision.next_alert_after);
  assert.strictEqual(
    __test.shouldSendActiveProtectionAlert(blocked, {
      V2_ACTIVE_PROTECTION_RECONCILIATION_SEND_ALERT: "1",
      V2_ACTIVE_PROTECTION_RECONCILIATION_ALERT_BACKOFF_MS_SEQUENCE: "999999999999",
    }, firstState),
    false,
    "manual PASS alert opt-in must not bypass CRIT backoff"
  );
  const expiredDecision = __test.resolveActiveProtectionAlertDecision({
    summary: blocked,
    previousState: firstState,
    nowMs: nowMs + 3600000,
  });
  assert.strictEqual(expiredDecision.should_send, true);
  assert.strictEqual(expiredDecision.reason, "CRIT_BACKOFF_EXPIRED");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-active-protection-reconciliation-"));
  const outputDir = path.join(tmpDir, "daily");
  const stateFile = path.join(tmpDir, "runtime", "state.json");
  const historyFile = path.join(tmpDir, "daily", "history.jsonl");
  const recentState = __test.buildNextAlertState({
    summary: blocked,
    alertDecision: firstDecision,
    alert: { ok: true },
    nowMs: Date.now(),
  });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(recentState)}\n`, "utf8");
  let alertCallN = 0;
  return run({
    env: {
      V2_ACTIVE_PROTECTION_RECONCILIATION_OUTPUT_DIR: outputDir,
      V2_ACTIVE_PROTECTION_RECONCILIATION_STATE_FILE: stateFile,
      V2_ACTIVE_PROTECTION_RECONCILIATION_HISTORY_FILE: historyFile,
      V2_ACTIVE_PROTECTION_RECONCILIATION_ALERT_BACKOFF_MS_SEQUENCE: "3600000",
      ALERT_CHANNEL: "telegram:test",
    },
    auditFn: async () => ({
      ok: false,
      exchange: "BINANCEFUT",
      issue_count: 1,
      issues: [{ symbol: "XRPUSDT", severity: "CRIT", code: "NATIVE_TP1_MISSING" }],
      markets: [{ symbol: "XRPUSDT", internal_active: true, external_active: true }],
    }),
    sendAlertFn: async () => {
      alertCallN += 1;
      return { ok: true };
    },
  }).then((result) => {
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.alert.skipped, true);
    assert.strictEqual(result.alert.reason, "CRIT_BACKOFF_ACTIVE");
    assert.strictEqual(alertCallN, 0);
    assert.ok(fs.existsSync(path.join(outputDir, "v2_active_protection_reconciliation_latest.json")),
      "latest artifact must be written even when alert is backoff-suppressed");
    assert.ok(fs.existsSync(historyFile), "hourly history jsonl must be appended");
    assert.ok(fs.existsSync(path.join(outputDir, "v2_active_protection_reconciliation_daily_summary_latest.json")),
      "daily summary artifact must be written");
    assert.ok(fs.existsSync(stateFile), "alert state must be updated");
    const written = JSON.parse(fs.readFileSync(path.join(outputDir, "v2_active_protection_reconciliation_latest.json"), "utf8"));
    assert.strictEqual(written.scheduler_job_id, "v2-active-protection-reconciliation");
    assert.strictEqual(written.cadence, "HOURLY");
    assert.strictEqual(written.alert_decision.reason, "CRIT_BACKOFF_ACTIVE");
    assert.strictEqual(written.history_file, historyFile);
    const historyRows = __test.readJsonlSafe(historyFile);
    assert.strictEqual(historyRows.length, 1);
    assert.strictEqual(historyRows[0].unprotected_position_n, 1);
    const dailySummary = JSON.parse(fs.readFileSync(path.join(outputDir, "v2_active_protection_reconciliation_daily_summary_latest.json"), "utf8"));
    assert.strictEqual(dailySummary.ok, false);
    assert.strictEqual(dailySummary.run_n, 1);
    assert.strictEqual(dailySummary.blocked_n, 1);
    assert.strictEqual(dailySummary.max_unprotected_position_n, 1);
    assert.deepStrictEqual(dailySummary.unprotected_symbols, ["XRPUSDT"]);

    const syntheticSummary = __test.buildDailySummary({
      dateKey: "2026-04-26",
      rows: [
        { generated_at: "2026-04-26T00:00:00.000Z", ok: true, active_position_n: 2, protected_position_n: 2, unprotected_position_n: 0, critical_issue_n: 0 },
        { generated_at: "2026-04-26T01:00:00.000Z", ok: true, active_position_n: 3, protected_position_n: 3, unprotected_position_n: 0, critical_issue_n: 0 },
      ],
    });
    assert.strictEqual(syntheticSummary.ok, true);
    assert.strictEqual(syntheticSummary.run_n, 2);
    assert.strictEqual(syntheticSummary.max_active_position_n, 3);

    console.log("CHECK_V2_ACTIVE_PROTECTION_RECONCILIATION_TEST_OK");
  });
})();
