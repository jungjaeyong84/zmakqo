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
    ],
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    entryExecBarMs: 150,
    incomingDir: "SHORT",
    cfg,
  });
  assert.strictEqual(summary.count, 2);
  assert.deepStrictEqual(summary.matches.map((row) => row.signal_id), ["sig-2", "sig-1"]);

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
    effectivePnlPct: 1.6,
  });
  assert.strictEqual(blockedBand.ok, false);
  assert.strictEqual(blockedBand.reason, "REVERSE_EXCEPTION_PROFIT_CAP_BLOCKED");

  const blockedCount = shouldReviveReverseDrop({
    cfg,
    reasonRaw: "REVERSE_COOLDOWN",
    intentBeforeOverride: "ENTRY",
    posSnap: { active: true, side: "LONG", size_pct: 1 },
    event: "CORE_SHORT",
    side: "SELL",
    priorDropCount: 0,
    effectivePnlPct: -0.4,
  });
  assert.strictEqual(blockedCount.ok, false);
  assert.strictEqual(blockedCount.reason, "REVERSE_EXCEPTION_DROP_COUNT_LOW");

  console.log("WEBHOOK_REVERSE_EXCEPTION_TEST_OK");
}

run();
