"use strict";

// 2026-04-18 P2-1 (audit re-verified): the STAGE-confidence chainKey
// groups two different entry cycles on the same (exchange, symbol,
// stage) into one authority bucket, which lets exit qty percentages
// leak across cycles. Shipping the blocker in observe-only mode by
// default — `EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK=1` flips it on
// without a redeploy. These tests lock in both the default-off preservation
// of existing behavior AND the opt-in fail-closed semantics.

const assert = require("assert");
const { __test } = require("../services/binanceFuturesFillsSync");

(function stageBlockedDefaultOff() {
  const prev = process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
  delete process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
  try {
    assert.strictEqual(__test.isStageConfidenceLiveBlockEnabled(), false,
      "default must preserve legacy behavior — ops opts in explicitly");
    assert.strictEqual(__test.isExitAuthorityChainKeyConfidenceLiveEligible("STAGE"), true,
      "with block off, STAGE remains live-eligible");
    assert.strictEqual(__test.isExitAuthorityChainKeyConfidenceLiveEligible("ORDER"), true,
      "non-STAGE confidences are always live-eligible");
  } finally {
    if (prev == null) delete process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
    else process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK = prev;
  }
})();

(function stageBlockedWhenEnvFlipped() {
  const prev = process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
  process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK = "1";
  try {
    assert.strictEqual(__test.isStageConfidenceLiveBlockEnabled(), true);
    assert.strictEqual(__test.isExitAuthorityChainKeyConfidenceLiveEligible("STAGE"), false,
      "opting in must fail-closed on STAGE");
    assert.strictEqual(__test.isExitAuthorityChainKeyConfidenceLiveEligible("ENTRY"), true,
      "ENTRY lineage remains eligible even when STAGE is blocked");
    assert.strictEqual(__test.isExitAuthorityChainKeyConfidenceLiveEligible("SIGNAL"), true);
    assert.strictEqual(__test.isExitAuthorityChainKeyConfidenceLiveEligible("ORDER"), true);
    assert.strictEqual(__test.isExitAuthorityChainKeyConfidenceLiveEligible("CLIENT"), true);
  } finally {
    if (prev == null) delete process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
    else process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK = prev;
  }
})();

(function applyExternalExitQtyAuthorityFailsClosedOnStageWhenBlocked() {
  const prev = process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
  process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK = "1";
  __test.resetFillSyncChainKeyLiveBlockedForTest();
  try {
    const authorityMap = new Map();
    // STAGE confidence is produced when entryEventId, signalDocId,
    // orderMeta.orderId and clientOrderId are all absent/empty.
    const out = __test.applyExternalExitQtyAuthority({
      authorityMap,
      exchange: "BINANCEFUT",
      symbol: "XYZUSDT",
      event: "EXIT_TP_P1",
      entryEventId: null,
      signalDocId: null,
      orderMeta: { orderId: null, clientOrderId: "" },
      qtyPct: 0.5,
    });
    assert.strictEqual(out.reason, "STAGE_CONFIDENCE_LIVE_BLOCKED",
      "block must short-circuit the authority write with a distinct reason");
    assert.strictEqual(out.acceptedQtyPct, 0,
      "fail-closed means zero qty is accepted until lineage is repaired");
    assert.strictEqual(out.droppedQtyPct, 0.5,
      "the full request must show as dropped so operators can see the hit");
    assert.ok(String(out.chainKey).includes("__STAGE__"),
      "return must expose the chainKey for downstream correlation");
    const counts = __test.getFillSyncChainKeyLiveBlockedCounts();
    assert.strictEqual(counts.STAGE, 1,
      "STAGE block counter must increment so the integrity cycle can surface the hit");
    // Sanity: authorityMap was untouched (no state mutation on the
    // blocked path).
    assert.strictEqual(authorityMap.size, 0,
      "blocked authority writes must not leave partial state in the authority map");
  } finally {
    if (prev == null) delete process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
    else process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK = prev;
  }
})();

(function applyExternalExitQtyAuthorityStillAcceptsStageWhenBlockOff() {
  const prev = process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
  delete process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
  __test.resetFillSyncChainKeyLiveBlockedForTest();
  try {
    const authorityMap = new Map();
    const out = __test.applyExternalExitQtyAuthority({
      authorityMap,
      exchange: "BINANCEFUT",
      symbol: "XYZUSDT",
      event: "EXIT_TP_P1",
      entryEventId: null,
      signalDocId: null,
      orderMeta: { orderId: null, clientOrderId: "" },
      qtyPct: 0.5,
    });
    assert.notStrictEqual(out.reason, "STAGE_CONFIDENCE_LIVE_BLOCKED",
      "with the flag off, STAGE must continue to flow through the normal path");
    const counts = __test.getFillSyncChainKeyLiveBlockedCounts();
    assert.strictEqual(counts.STAGE, 0,
      "block counter must not increment when the flag is off");
  } finally {
    if (prev == null) delete process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK;
    else process.env.EXIT_AUTHORITY_STAGE_CONFIDENCE_LIVE_BLOCK = prev;
  }
})();

console.log("EXIT_AUTHORITY_STAGE_CONFIDENCE_BLOCK_TEST_OK");
