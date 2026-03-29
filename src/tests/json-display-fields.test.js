"use strict";

const assert = require("assert");
const {
  addDisplayFieldsDeep,
  tierMapToRows,
  unwrapDisplayAndRawReport,
  wrapDisplayAndRawReport,
} = require("../utils/jsonDisplayFields");

(() => {
  const input = {
    rows: [
      {
        event: "EARLY_LONG",
        tier: "EARLY",
        reason: "DROP_SHORT_GATE_SCORE",
        stage: "QUALITY",
      },
    ],
    by_tier: {
      CORE: { signals_n: 3 },
    },
  };

  const out = addDisplayFieldsDeep(input);
  assert.strictEqual(out.rows[0].display_event, "LONG");
  assert.strictEqual(out.rows[0].display_tier, "LONG/SHORT 기본 진입");
  assert.strictEqual(out.rows[0].display_stage, "1차 무결성 가드");
  assert.ok(String(out.rows[0].display_reason || "").includes("무결성"));
  assert.strictEqual(out.by_tier.CORE.display_tier, "LONG/SHORT 확장 진입");

  const rows = tierMapToRows({
    EARLY: { executed_n: 1 },
    CORE: { executed_n: 2 },
  });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].tier, "EARLY");
  assert.strictEqual(rows[0].display_tier, "LONG/SHORT 기본 진입");
  assert.strictEqual(rows[1].tier, "CORE");
  assert.strictEqual(rows[1].display_tier, "LONG/SHORT 확장 진입");

  const wrapped = wrapDisplayAndRawReport({
    tier: "EARLY",
    reason: "DROP_SHORT_GATE_SCORE",
    nested: { stage: "QUALITY" },
    candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    display_candidate_id: "AUTO_LONG_SHORT_SCORE_TIGHTEN",
    realized_trades: {
      trade_n: 1,
      trades: [{ entry_signal_type: "CORE_LONG", entry_event_id: "X|CORE_LONG|CORE_LONG" }],
    },
    quality_by_tier: {
      EARLY: { executed_n: 1 },
      PRE_REAL: { executed_n: 2 },
    },
    quality_by_tier_rows: tierMapToRows({
      EARLY: { executed_n: 1 },
      CORE: { executed_n: 2 },
    }),
    settings_snapshot: {
      gate_core_score_abs: 35,
      gate_pre_real_score_abs: 40,
    },
    settings_snapshot_rows: [
      { label: "LONG/SHORT 기본 진입 점수 기준", value: 35 },
    ],
  });
  assert.strictEqual(wrapped.display.display_tier, "LONG/SHORT 기본 진입");
  assert.ok(String(wrapped.display.display_reason || "").includes("무결성"));
  assert.strictEqual(wrapped.display.candidate_id, undefined);
  assert.strictEqual(wrapped.display.realized_trades.trades, undefined);
  assert.strictEqual(wrapped.display.quality_by_tier, undefined);
  assert.strictEqual(wrapped.display.settings_snapshot, undefined);
  assert.strictEqual(wrapped.raw.tier, "EARLY");
  assert.strictEqual(unwrapDisplayAndRawReport(wrapped).tier, "EARLY");
  assert.deepStrictEqual(unwrapDisplayAndRawReport({ foo: 1 }), { foo: 1 });

  console.log("JSON_DISPLAY_FIELDS_TEST_OK");
})();
