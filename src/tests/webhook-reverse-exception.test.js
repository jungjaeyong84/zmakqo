const assert = require("assert");
const {
  resolveReverseExceptionConfig,
  summarizeOppositeReverseDrops,
  shouldReviveReverseDrop,
} = require("../services/webhookReverseException");

function run() {
  const cfg = resolveReverseExceptionConfig({}, "BINANCEFUT");

  const summary = summarizeOppositeReverseDrops({
    rows: [
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "CORE_SHORT",
        side: "SELL",
        signal_id: "sig-1",
        bar_close_time_utc_ms: 200,
        features_json: { _reason_raw: "REVERSE_BLOCKED" },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "CORE_SHORT",
        side: "SELL",
        signal_id: "sig-2",
        bar_close_time_utc_ms: 300,
        features_json: { _reason_raw: "REVERSE_COOLDOWN" },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "EARLY_SHORT",
        side: "SELL",
        signal_id: "sig-3",
        bar_close_time_utc_ms: 320,
        features_json: { _reason_raw: "REVERSE_BLOCKED" },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "PRE_REAL_SHORT",
        side: "SELL",
        signal_id: "sig-4",
        bar_close_time_utc_ms: 120,
        features_json: { _reason_raw: "REVERSE_BLOCKED" },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        tf: "15m",
        event: "SHORT",
        side: "SELL",
        signal_id: "sig-5",
        bar_close_time_utc_ms: 340,
        features_json: { _reason_raw: "REVERSE_BLOCKED", entry_grade: "CORE" },
      },
    ],
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    entryExecBarMs: 150,
    incomingDir: "SHORT",
    cfg,
  });
  assert.strictEqual(summary.count, 4);
  assert.deepStrictEqual(summary.matches.map((row) => row.signal_id), ["sig-5", "sig-3", "sig-2", "sig-1"]);

  const revived = shouldReviveReverseDrop({
    cfg,
    reasonRaw: "REVERSE_BLOCKED",
    intentBeforeOverride: "ENTRY",
    posSnap: { active: true, side: "LONG", size_pct: 1 },
    event: "CORE_SHORT",
    side: "SELL",
    priorDropCount: 1,
    effectivePnlPct: -1.2,
  });
  assert.strictEqual(revived.ok, true);
  assert.strictEqual(revived.detail.total_drop_count, 2);

  const blockedBand = shouldReviveReverseDrop({
    cfg,
    reasonRaw: "REVERSE_BLOCKED",
    intentBeforeOverride: "ENTRY",
    posSnap: { active: true, side: "LONG", size_pct: 1 },
    event: "CORE_SHORT",
    side: "SELL",
    priorDropCount: 3,
    effectivePnlPct: 3.5,
  });
  assert.strictEqual(blockedBand.ok, false);
  assert.strictEqual(blockedBand.reason, "REVERSE_EXCEPTION_PROFIT_CAP_BLOCKED");

  const revivedCount = shouldReviveReverseDrop({
    cfg,
    reasonRaw: "REVERSE_COOLDOWN",
    intentBeforeOverride: "ENTRY",
    posSnap: { active: true, side: "LONG", size_pct: 1 },
    event: "CORE_SHORT",
    side: "SELL",
    priorDropCount: 0,
    effectivePnlPct: -0.4,
  });
  assert.strictEqual(revivedCount.ok, true);
  assert.strictEqual(revivedCount.detail.total_drop_count, 1);

  const revivedFromCanonicalEvent = shouldReviveReverseDrop({
    cfg,
    reasonRaw: "REVERSE_BLOCKED",
    intentBeforeOverride: "ENTRY",
    posSnap: { active: true, side: "LONG", size_pct: 1 },
    event: "SHORT",
    eventFeatures: { entry_grade: "CORE" },
    side: "SELL",
    priorDropCount: 1,
    effectivePnlPct: -0.3,
  });
  assert.strictEqual(revivedFromCanonicalEvent.ok, true);
  assert.strictEqual(revivedFromCanonicalEvent.detail.total_drop_count, 2);

  const revivedMixedTierBypass = shouldReviveReverseDrop({
    cfg,
    reasonRaw: "REVERSE_BLOCKED",
    intentBeforeOverride: "ENTRY",
    posSnap: { active: true, side: "LONG", size_pct: 1 },
    posMeta: { openclaw_market_regime_cohort: "MIXED" },
    event: "PRE_REAL_SHORT",
    eventFeatures: { openclaw_market_regime_cohort: "MIXED" },
    side: "SELL",
    priorDropCount: 1,
    effectivePnlPct: -0.8,
  });
  assert.strictEqual(revivedMixedTierBypass.ok, true);
  assert.strictEqual(revivedMixedTierBypass.detail.cohort, "MIXED");
  assert.strictEqual(revivedMixedTierBypass.detail.tier_bypass_applied, true);

  console.log("WEBHOOK_REVERSE_EXCEPTION_TEST_OK");
}

run();
