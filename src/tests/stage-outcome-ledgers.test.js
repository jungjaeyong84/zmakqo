"use strict";

const assert = require("assert");
const {
  buildCoverageGuard,
  __test,
} = require("../../scripts/lib/stage-outcome-ledgers");
const { __test: displayTest } = require("../../scripts/automation-stage-outcome-ledgers");

function run() {
  const tp1 = __test.mapPathOutcomeForTune({ ok: true, outcome: "TP1_FIRST" });
  assert.deepStrictEqual(tp1, { outcome: "TP1_HIT", resolved: true });

  const sl = __test.mapPathOutcomeForTune({ ok: true, outcome: "SL_FIRST" });
  assert.deepStrictEqual(sl, { outcome: "NO_TP1_EXITED", resolved: true });

  const immature = __test.mapPathOutcomeForTune({ ok: false, skip_reason: "IMMATURE" });
  assert.deepStrictEqual(immature, { outcome: "UNRESOLVED_OPEN", resolved: false });

  const stale = __test.mapPathOutcomeForTune({ ok: false, skip_reason: "ENTRY_BAR_MISSING" });
  assert.deepStrictEqual(stale, { outcome: "UNRESOLVED_STALE", resolved: false });

  const entryEventId = __test.buildEntryEventId({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    signalBarCloseMs: 1234567890000,
    event: "CORE_LONG",
  });
  assert.strictEqual(entryEventId, "BINANCEFUT|BTCUSDT|15m|1234567890000|CORE_LONG|CORE_LONG");

  const coveragePass = buildCoverageGuard({
    coverage: { ai_bias_rate: 0.12 },
    stage_samples: { ai_n: 55, market_n: 44 },
    self_validation: { ok: true },
  });
  assert.strictEqual(coveragePass.ai.pass, true);
  assert.strictEqual(coveragePass.market.pass, true);
  assert.strictEqual(coveragePass.pass, true);

  const coverageBlock = buildCoverageGuard({
    coverage: { ai_bias_rate: 0.03 },
    stage_samples: { ai_n: 55, market_n: 44 },
    self_validation: { ok: true },
  });
  assert.strictEqual(coverageBlock.ai.pass, true);
  assert.strictEqual(coverageBlock.market.pass, false);
  assert.strictEqual(coverageBlock.market.reason, "MARKET_COVERAGE_BLOCK");
  assert.strictEqual(coverageBlock.pass, false);

  assert.strictEqual(displayTest.describeWaitStateForUser("ALLOW"), "대기 없음");
  assert.strictEqual(displayTest.describeWaitStateForUser("WAIT_THEN_ENTER_TP1"), "한 봉 대기 후 진입, TP1 도달");
  const waitRows = displayTest.buildWaitStateRows({
    by_state: {
      WAIT_THEN_ENTER_SL: 2,
      ALLOW: 5,
    },
  });
  assert.deepStrictEqual(waitRows, [
    { state: "ALLOW", display_state: "대기 없음", count: 5 },
    { state: "WAIT_THEN_ENTER_SL", display_state: "한 봉 대기 후 진입, 손절 종료", count: 2 },
  ]);

  console.log("STAGE_OUTCOME_LEDGERS_TEST_OK");
}

run();
