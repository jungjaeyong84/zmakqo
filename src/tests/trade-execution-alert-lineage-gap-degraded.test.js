"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// trade-execution-alert-lineage-gap-degraded.test.js
//
// 2026-04-27 P0-D — lineage-gap degraded fallback unit tests.
//
// Background:
//   When upstream V2 lineage is missing (entry_event_id absent on an ACTIVE
//   position), resolveCanonicalExitAlertRequirement reports
//   `required && !satisfied` and the legacy code path silently dropped the
//   TP1/TRAIL alert (only writing a BLOCKED outbox row visible to ops).
//   The operator never received a Telegram notification — a silent miss
//   on a real fill is unacceptable.
//
// New contract (this test):
//   (A) When the canonical gate would block AND
//       TRADE_ALERT_LINEAGE_GAP_DEGRADED=1 (default), sendTradeExecutionAlert
//       prepares an outbox row with a `[LINEAGE_GAP:<reason>] ... (degraded)`
//       title and dispatches via sendAlert with severity="WARN".
//   (B) Successful degraded send marks the outbox ok=true with reason
//       "DEGRADED_LINEAGE_GAP" and the function returns
//       `{ ok: true, degraded: true, reason: "DEGRADED_LINEAGE_GAP" }` —
//       NOT skipped:true. The BLOCKED writeback path is skipped.
//   (C) When the dedupe key already has a SENT row (prep returns
//       skipSend:true), no resend happens; the function returns skipped:true
//       degraded:true with reason "OUTBOX_ALREADY_SENT" and BLOCKED is NOT
//       written.
//   (D) When sendAlert throws, the failure is recorded on the degraded row
//       and the path falls through to the BLOCKED writer (so observability
//       is no worse than the legacy behaviour).
//   (E) When TRADE_ALERT_LINEAGE_GAP_DEGRADED=0, the degraded prep is NOT
//       called and only the BLOCKED writer fires (legacy parity).
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

const outboxStubPath = require.resolve("../storage/tradeAlertOutbox");
const alertsStubPath = require.resolve("../utils/alerts");
const settingsStubPath = require.resolve("../storage/settings");

const calls = {
  prepareArgs: [],
  markArgs: [],
  sendArgs: [],
  prepareBehavior: "ok",   // "ok" | "skipSend" | "throw"
  sendBehavior: "ok",      // "ok" | "throw"
  prepareIdQueue: [],
  defaultPrepareId: "OUTBOX_DEG_TEST_ID__1",
};

require.cache[outboxStubPath] = {
  id: outboxStubPath,
  filename: outboxStubPath,
  loaded: true,
  exports: {
    prepareTradeAlertOutbox: async (args) => {
      calls.prepareArgs.push(args);
      if (calls.prepareBehavior === "throw") {
        throw new Error("stub: prepare failure");
      }
      const outboxId = calls.prepareIdQueue.length > 0
        ? calls.prepareIdQueue.shift()
        : calls.defaultPrepareId;
      if (calls.prepareBehavior === "skipSend") {
        return { outboxId, ref: null, doc: { status: "SENT" }, skipSend: true };
      }
      return { outboxId, ref: null, doc: null, skipSend: false };
    },
    markTradeAlertOutboxResult: async (args) => {
      calls.markArgs.push(args);
      return { outboxId: args && args.outboxId };
    },
    fetchTradeAlertOutboxItems: async () => [],
  },
};

require.cache[alertsStubPath] = {
  id: alertsStubPath,
  filename: alertsStubPath,
  loaded: true,
  exports: {
    sendAlert: async (args) => {
      calls.sendArgs.push(args);
      if (calls.sendBehavior === "throw") {
        throw new Error("stub: send failure");
      }
      return { ok: true, transport: "stub" };
    },
  },
};

// settings is touched by resolveAlertChannel cache miss path; stub it to be
// safe even though we set TRADE_ALERT_CHANNEL directly below.
require.cache[settingsStubPath] = {
  id: settingsStubPath,
  filename: settingsStubPath,
  loaded: true,
  exports: {
    getSystemSettingsForProvider: async () => ({ data: { alert_channel: "" } }),
  },
};

process.env.TRADE_ALERT_ENABLED = "1";
process.env.TRADE_ALERT_INCLUDE_PAPER = "1";
process.env.TRADE_ALERT_CHANNEL = "telegram:STUB";
process.env.TRADE_ALERT_TELEGRAM_ONLY = "1";
process.env.TRADE_ALERT_LINEAGE_GAP_DEGRADED = "1";

const { sendTradeExecutionAlert, __test } = require("../services/tradeExecutionAlert");
const { buildDegradedExitMessage } = __test;

assert.strictEqual(typeof buildDegradedExitMessage, "function",
  "buildDegradedExitMessage must be exported on __test");

function resetCalls() {
  calls.prepareArgs.length = 0;
  calls.markArgs.length = 0;
  calls.sendArgs.length = 0;
  calls.prepareBehavior = "ok";
  calls.sendBehavior = "ok";
  calls.prepareIdQueue.length = 0;
}

function buildTp1BlockedPayload() {
  return {
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    event: "EXIT_TP_P1_2.5P",
    intent: "EXIT",
    side: "SELL",
    positionSideBefore: "LONG",
    executionMode: "LIVE",
    notional: 1234.56,
    execPrice: 17.42,
    qtyBase: 70.85,
    closeRatio: 0.5,
    fullExit: false,
    canonicalExitEvent: "EXIT_TP_P1_2.5P",
    canonicalExitStage: "TP1",
    canonicalTransitionEvents: [],
    canonicalTransitionEvent: null,
  };
}

(async () => {
  // ── (helper) buildDegradedExitMessage shape sanity ─────────────────────────
  {
    const m = buildDegradedExitMessage(buildTp1BlockedPayload(), {
      reason: "MISSING_CANONICAL_EXIT_TRANSITION",
    });
    assert.ok(m && typeof m.title === "string" && typeof m.body === "string",
      "buildDegradedExitMessage must return {title, body}");
    assert.ok(m.title.startsWith("[LINEAGE_GAP:MISSING_CANONICAL_EXIT_TRANSITION]"),
      "title must carry [LINEAGE_GAP:<reason>] prefix");
    assert.ok(m.title.includes("LINKUSDT"),
      "title must include symbol so ops can identify position at a glance");
    assert.ok(m.title.includes("(degraded)"),
      "title must mark message as degraded");
    assert.ok(m.body.includes("17.420") || m.body.includes("17.42"),
      "body must include execPrice for ops context");
    assert.ok(m.body.includes("롱"),
      "body must include direction in Korean for ops context");
  }

  // ── (A)+(B): degraded prep+send happens, BLOCKED writer skipped ────────────
  {
    resetCalls();
    calls.prepareIdQueue.push("OUTBOX_DEG__A");
    const result = await sendTradeExecutionAlert(buildTp1BlockedPayload());
    assert.strictEqual(result.ok, true,
      "(A) degraded send must report ok:true — operator received a notification");
    assert.strictEqual(result.skipped, false,
      "(A) degraded send must NOT be skipped — it actually dispatched");
    assert.strictEqual(result.reason, "DEGRADED_LINEAGE_GAP",
      "(A) reason must be DEGRADED_LINEAGE_GAP for downstream classification");
    assert.strictEqual(result.degraded, true,
      "(A) result must carry degraded:true flag");
    assert.strictEqual(result.outboxId, "OUTBOX_DEG__A",
      "(A) outboxId must surface for ops drill-down");

    assert.strictEqual(calls.prepareArgs.length, 1,
      "(A) only the degraded prep must run — BLOCKED writer must NOT also run");
    const prep = calls.prepareArgs[0];
    assert.strictEqual(prep.source, "tradeExecutionAlert.sendTradeExecutionAlert.degraded",
      "(A) prep source tag identifies the degraded path");
    assert.ok(prep.title && prep.title.startsWith("[LINEAGE_GAP:"),
      "(A) prep title must carry [LINEAGE_GAP:<reason>] prefix");
    assert.strictEqual(prep.allowResend, false,
      "(A) degraded prep must NOT allowResend — must respect prior SENT rows");
    assert.strictEqual(prep.payload && prep.payload.lineage_gap_degraded, true,
      "(A) prep payload must mark lineage_gap_degraded:true for outbox indexing");

    assert.strictEqual(calls.sendArgs.length, 1,
      "(A) sendAlert must be called exactly once");
    const send = calls.sendArgs[0];
    assert.strictEqual(send.severity, "WARN",
      "(A) degraded alert severity must be WARN, not INFO");
    assert.ok(send.title && send.title.startsWith("[LINEAGE_GAP:"),
      "(A) send title must carry [LINEAGE_GAP:<reason>] prefix");
    assert.strictEqual(send.channel, "telegram:STUB",
      "(A) channel must come from TRADE_ALERT_CHANNEL env override");

    assert.strictEqual(calls.markArgs.length, 1,
      "(A) markTradeAlertOutboxResult must be called exactly once on success");
    const mark = calls.markArgs[0];
    assert.strictEqual(mark.ok, true, "(A) mark must record ok:true");
    assert.strictEqual(mark.reason, "DEGRADED_LINEAGE_GAP",
      "(A) mark reason classifies the row as degraded");
    assert.strictEqual(mark.source, "tradeExecutionAlert.sendTradeExecutionAlert.degraded");
  }

  // ── (C): prior SENT row → no resend, no BLOCKED, returns skipped+degraded ──
  {
    resetCalls();
    calls.prepareBehavior = "skipSend";
    calls.prepareIdQueue.push("OUTBOX_DEG__C_PRIOR");
    const result = await sendTradeExecutionAlert(buildTp1BlockedPayload());
    assert.strictEqual(result.skipped, true,
      "(C) skipSend must propagate as skipped:true");
    assert.strictEqual(result.reason, "OUTBOX_ALREADY_SENT",
      "(C) reason must indicate prior SENT, not DEGRADED_LINEAGE_GAP");
    assert.strictEqual(result.degraded, true,
      "(C) degraded:true preserved so caller can distinguish from normal dedupe");
    assert.strictEqual(result.outboxId, "OUTBOX_DEG__C_PRIOR",
      "(C) outboxId points at the pre-existing SENT row");
    assert.strictEqual(calls.prepareArgs.length, 1,
      "(C) only the degraded prep runs — BLOCKED writer must NOT also run");
    assert.strictEqual(calls.sendArgs.length, 0,
      "(C) sendAlert must NOT fire when a SENT row already exists for the dedupe key");
    assert.strictEqual(calls.markArgs.length, 0,
      "(C) mark must NOT fire — would clobber the prior SENT row");
  }

  // ── (D): sendAlert throws → mark failure on degraded, fall through BLOCKED ─
  {
    resetCalls();
    calls.sendBehavior = "throw";
    // First prep is the degraded one, second prep is the BLOCKED writer.
    calls.prepareIdQueue.push("OUTBOX_DEG__D_DEG", "OUTBOX_DEG__D_BLOCKED");
    const result = await sendTradeExecutionAlert(buildTp1BlockedPayload());
    assert.strictEqual(result.skipped, true,
      "(D) on degraded send failure, the function must still return skipped:true "
      + "(BLOCKED-row fallback) so the trading path is uninterrupted");
    assert.strictEqual(result.blocked, true,
      "(D) result.blocked must be true — the canonical gate did block the canonical send");
    assert.strictEqual(result.reason, "MISSING_CANONICAL_EXIT_TRANSITION",
      "(D) reason must reflect the canonical block, not the send failure");
    assert.strictEqual(calls.prepareArgs.length, 2,
      "(D) two prep calls expected: degraded then BLOCKED writer");
    assert.strictEqual(calls.prepareArgs[0].source,
      "tradeExecutionAlert.sendTradeExecutionAlert.degraded",
      "(D) first prep is the degraded row");
    assert.strictEqual(calls.prepareArgs[1].source,
      "tradeExecutionAlert.sendTradeExecutionAlert.blocked",
      "(D) second prep is the BLOCKED writeback (fallback observability)");
    // Two mark calls: one for degraded failure, one for BLOCKED.
    assert.strictEqual(calls.markArgs.length, 2,
      "(D) mark called twice: degraded failure + BLOCKED writeback");
    assert.strictEqual(calls.markArgs[0].ok, false,
      "(D) degraded mark must record ok:false on send failure");
    assert.strictEqual(calls.markArgs[1].blocked, true,
      "(D) BLOCKED mark must record blocked:true");
  }

  // ── (E): feature flag off → degraded prep skipped, BLOCKED-only path ───────
  {
    process.env.TRADE_ALERT_LINEAGE_GAP_DEGRADED = "0";
    resetCalls();
    calls.prepareIdQueue.push("OUTBOX_DEG__E_BLOCKED");
    const result = await sendTradeExecutionAlert(buildTp1BlockedPayload());
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.reason, "MISSING_CANONICAL_EXIT_TRANSITION",
      "(E) flag-off must preserve the legacy MISSING_CANONICAL_EXIT_TRANSITION reason");
    assert.strictEqual(calls.prepareArgs.length, 1,
      "(E) only ONE prep call when degraded path is disabled");
    assert.strictEqual(calls.prepareArgs[0].source,
      "tradeExecutionAlert.sendTradeExecutionAlert.blocked",
      "(E) the sole prep must be the legacy BLOCKED writer");
    assert.strictEqual(calls.sendArgs.length, 0,
      "(E) no sendAlert when degraded flag is off");
    // Restore for subsequent tests in same process (none after, but defensive).
    process.env.TRADE_ALERT_LINEAGE_GAP_DEGRADED = "1";
  }

  console.log("TRADE_EXECUTION_ALERT_LINEAGE_GAP_DEGRADED_TEST_OK");
})().catch((err) => {
  console.error("TEST_FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});
