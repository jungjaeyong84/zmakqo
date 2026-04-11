"use strict";

const assert = require("assert");
const { __test: timelineTest } = require("../storage/unifiedEventTimeline");
const { __test: replayTest } = require("../services/decisionReplayV2");
const { __test: positionsTest } = require("../storage/positionsPaper");
const { __test: mlOpsTest } = require("../services/mlOpsPipeline");

function testBuildUnifiedEventIdStableShape() {
  const id = timelineTest.buildUnifiedEventId({
    exchange: "binancefut",
    symbol: "xrpusdt",
    eventKind: "fill",
    eventSource: "fills_paper",
    tsMs: 1775865600000,
    traceId: "trace-1",
    entityId: "fill-1",
  });
  assert.strictEqual(typeof id, "string");
  assert.ok(id.length >= 20);
  const deterministicA = timelineTest.buildUnifiedEventId({
    eventSource: "fills_paper_external",
    sourceDocumentId: "fill-123",
  });
  const deterministicB = timelineTest.buildUnifiedEventId({
    eventSource: "fills_paper_external",
    sourceDocumentId: "fill-123",
  });
  assert.strictEqual(deterministicA, deterministicB);
}

function testNormalizeUnifiedTimelineRow() {
  const row = replayTest.normalizeUnifiedTimelineRow({
    event_kind: "fill",
    event: "exit_tp_p1_1.65p",
    exchange: "binancefut",
    symbol: "dogeusdt",
    ts_ms: 1775865603000,
    trace_id: "trace-1",
    payload: { qty_pct: 0.49 },
  });
  assert.strictEqual(row.kind, "FILL");
  assert.strictEqual(row.event, "EXIT_TP_P1_1.65P");
  assert.strictEqual(row.symbol, "DOGEUSDT");
  assert.strictEqual(row.payload.qty_pct, 0.49);
}

function testPositionWriteTokenHelpers() {
  const token = positionsTest.buildNextPositionWriteToken();
  assert.strictEqual(typeof token, "string");
  assert.ok(token.length >= 16);
  positionsTest.assertExpectedWriteToken({ position_write_token: token }, token);
  assert.throws(
    () => positionsTest.assertExpectedWriteToken({ position_write_token: token }, "mismatch"),
    /POSITION_WRITE_TOKEN_MISMATCH/
  );
}

function testSummarizeShadowInferenceCanary() {
  const summary = mlOpsTest.summarizeShadowInferenceCanary([
    {
      symbol: "XRPUSDT",
      baseline_decision: { ok: true, reason: "LIVE_POLICY_OK", qty_pct_final: 0.5 },
      shadow_decision: { inference: { ok: false, reason: "LIVE_POLICY_QUARANTINE_HARD_BLOCK", qty_pct_final: 0 } },
    },
    {
      symbol: "ETHUSDT",
      baseline_decision: { ok: false, reason: "LIVE_POLICY_QUARANTINE_HARD_BLOCK", qty_pct_final: 0 },
      shadow_decision: { inference: { ok: false, reason: "LIVE_POLICY_QUARANTINE_HARD_BLOCK", qty_pct_final: 0 } },
    },
  ]);
  assert.strictEqual(summary.compared_n, 2);
  assert.strictEqual(summary.disagreement_n, 1);
  assert.ok(summary.disagreement_rate > 0);
  assert.strictEqual(summary.by_symbol[0].key, "XRPUSDT");
}

testBuildUnifiedEventIdStableShape();
testNormalizeUnifiedTimelineRow();
testPositionWriteTokenHelpers();
testSummarizeShadowInferenceCanary();

console.log("UNIFIED_EVENT_TIMELINE_TEST_OK");
