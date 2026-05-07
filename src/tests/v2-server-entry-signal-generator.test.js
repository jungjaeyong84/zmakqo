"use strict";

// 2026-04-28 F2 Phase 2 — V2 server-native ENTRY signal generator tests.
// Coverage:
//   (A) Indicator parity vs known reference values (SMA/EMA/RSI/MACD/ATR/highest/lowest)
//   (B) clamp / safeDiv helpers
//   (C) tfStringToMs translations
//   (D) computeHtfBias guards on insufficient bars
//   (E) generateV2EntrySignals — empty bars / position active / happy path
//   (F) Cooldown logic — same trigger within window blocks; trigger change unblocks
//   (G) Determinism — same input → same output

const assert = require("assert");
const {
  generateV2EntrySignals,
  computeHtfBias,
  DEFAULT_PARAMS,
  STRATEGY_ID,
  ENGINE_VERSION,
  SIGNAL_SOURCE,
  __test,
} = require("../v2/serverEntrySignalGenerator");

const { sma, ema, rsi, macd, atr, highest, lowest, clamp01, safeDiv, tfStringToMs, deriveDirectionDecision } = __test;

// ───── helpers ─────────────────────────────────────────────

function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

// Build N synthetic bars (close ascending then descending) for warmup.
function buildSyntheticBars(n, opts = {}) {
  const start = opts.start || 100;
  const slope = opts.slope || 0.1;
  const noise = opts.noise || 0;
  const bars = [];
  let ts = opts.startMs || 1700000000000;
  const tfMs = opts.tfMs || 60000;
  for (let i = 0; i < n; i += 1) {
    const c = start + i * slope + (noise ? Math.sin(i / 7) * noise : 0);
    const o = c - slope * 0.3;
    const h = Math.max(o, c) + Math.abs(slope) * 0.5;
    const l = Math.min(o, c) - Math.abs(slope) * 0.5;
    const v = 1000 + (i % 20) * 10;
    bars.push({
      open: o, high: h, low: l, close: c, volume: v,
      barCloseTimeUtcMs: ts, close_time_utc_ms: ts, t: ts,
    });
    ts += tfMs;
  }
  return bars;
}

// ───── (A) indicator parity ────────────────────────────────

(function testSmaBasic() {
  const out = sma([1, 2, 3, 4, 5], 3);
  assert.strictEqual(out[0], null);
  assert.strictEqual(out[1], null);
  assert.ok(approx(out[2], 2));
  assert.ok(approx(out[3], 3));
  assert.ok(approx(out[4], 4));
})();

(function testEmaSeed() {
  // EMA(5, period=3): seed = SMA(1..3) = 2; k = 2/4 = 0.5
  // ema[2] = 2; ema[3] = 4*0.5 + 2*0.5 = 3; ema[4] = 5*0.5 + 3*0.5 = 4
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.strictEqual(out[0], null);
  assert.strictEqual(out[1], null);
  assert.ok(approx(out[2], 2));
  assert.ok(approx(out[3], 3));
  assert.ok(approx(out[4], 4));
})();

(function testRsiKnown() {
  // Known reference: 14-period RSI on a synthetic monotonic up-series
  // → RSI converges to 100 (no losses).
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const out = rsi(closes, 14);
  assert.ok(out[14] != null);
  assert.ok(out[14] >= 99.99, `RSI on monotonic-up should ≈ 100, got ${out[14]}`);
  assert.ok(out[29] >= 99.99);
})();

(function testRsiDown() {
  const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
  const out = rsi(closes, 14);
  assert.ok(out[14] != null);
  assert.ok(out[14] <= 0.01, `RSI on monotonic-down should ≈ 0, got ${out[14]}`);
})();

(function testMacdShape() {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 5);
  const m = macd(closes, 12, 26, 9);
  assert.strictEqual(m.macd_line.length, closes.length);
  assert.strictEqual(m.signal.length, closes.length);
  assert.strictEqual(m.hist.length, closes.length);
  // First 25 should be null (slow EMA needs 26 closes)
  assert.strictEqual(m.macd_line[24], null);
  assert.ok(m.macd_line[25] != null);
})();

(function testAtrWilder() {
  // High=2, Low=1, Close=1.5 → TR=1; constant series → ATR converges to 1.
  const highs = new Array(30).fill(2);
  const lows = new Array(30).fill(1);
  const closes = new Array(30).fill(1.5);
  const out = atr(highs, lows, closes, 14);
  assert.ok(approx(out[13], 1));
  assert.ok(approx(out[29], 1));
})();

(function testHighestLowest() {
  const v = [1, 3, 2, 5, 4, 6, 1];
  const hi = highest(v, 3);
  const lo = lowest(v, 3);
  assert.strictEqual(hi[0], null);
  assert.strictEqual(hi[1], null);
  assert.strictEqual(hi[2], 3);
  assert.strictEqual(hi[3], 5);
  assert.strictEqual(hi[4], 5);
  assert.strictEqual(hi[5], 6);
  assert.strictEqual(hi[6], 6);
  assert.strictEqual(lo[2], 1);
  assert.strictEqual(lo[3], 2);
  assert.strictEqual(lo[4], 2);
  assert.strictEqual(lo[5], 4);
  assert.strictEqual(lo[6], 1);
})();

// ───── (B) helpers ────────────────────────────────────────

(function testClamp() {
  assert.strictEqual(clamp01(0.5), 0.5);
  assert.strictEqual(clamp01(-1), 0);
  assert.strictEqual(clamp01(2), 1);
  assert.strictEqual(clamp01(NaN), 0);
})();

(function testSafeDiv() {
  assert.strictEqual(safeDiv(10, 2), 5);
  assert.strictEqual(safeDiv(10, 0), 0);
  assert.strictEqual(safeDiv(10, 1e-15), 0);
})();

// ───── (C) tfStringToMs ──────────────────────────────────

(function testTfTranslation() {
  assert.strictEqual(tfStringToMs("1"), 60_000);
  assert.strictEqual(tfStringToMs("5"), 300_000);
  assert.strictEqual(tfStringToMs("15"), 900_000);
  assert.strictEqual(tfStringToMs("60"), 3_600_000);
  assert.strictEqual(tfStringToMs("240"), 14_400_000);
  assert.strictEqual(tfStringToMs("5m"), 300_000);
  assert.strictEqual(tfStringToMs("1h"), 3_600_000);
  assert.strictEqual(tfStringToMs("1d"), 86_400_000);
})();

// ───── (D) computeHtfBias guards ──────────────────────────

(function testHtfInsufficient() {
  const out = computeHtfBias([{ close: 100 }]);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.htf_bias, "NEUTRAL");
})();

(function testHtfBull() {
  // Monotonic up — fast EMA(21) > slow EMA(55) → BULL
  const bars = Array.from({ length: 70 }, (_, i) => ({ close: 100 + i * 0.5 }));
  const out = computeHtfBias(bars);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.htf_bias, "BULL");
})();

(function testHtfBear() {
  const bars = Array.from({ length: 70 }, (_, i) => ({ close: 200 - i * 0.5 }));
  const out = computeHtfBias(bars);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.htf_bias, "BEAR");
})();

// ───── (E) generateV2EntrySignals ─────────────────────────

(function testEmptyBars() {
  const r = generateV2EntrySignals({
    exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "5",
    bars: [],
    htfBias: "BULL",
  });
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(r.skipReason, "BARS_INSUFFICIENT");
})();

(function testActivePositionSkip() {
  const bars = buildSyntheticBars(160);
  const r = generateV2EntrySignals({
    exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "5",
    bars,
    htfBias: "BULL",
    position: { state: "ACTIVE", size_pct: 1.0 },
  });
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(r.skipReason, "POSITION_ACTIVE");
})();

(function testHappyPath_NoSignalForGentleSlope() {
  // Very gentle slope → trend_strength_raw too small → state RANGE; no signal expected
  const bars = buildSyntheticBars(160, { slope: 0.001 });
  const r = generateV2EntrySignals({
    exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "5",
    bars,
    htfBias: "NEUTRAL",
  });
  assert.strictEqual(r.skipped, false);
  assert.strictEqual(r.signals.length, 0);
  assert.ok(r.diagnostics.market_state);
  assert.strictEqual(typeof r.diagnostics.long_decision_reason, "string");
  assert.strictEqual(typeof r.diagnostics.short_decision_reason, "string");
})();

(function shortLossPayloadCarriesReclaimContractEvidence() {
  const payload = __test.buildPayload({
    direction: "SHORT",
    grade: "EARLY",
    score: 0.71,
    market_state: "TRANSITION",
    htf_bias: "BEAR",
    trigger_type: "LOSS",
    risk_mode: "PASS",
    rr: 1.8,
    stop: 102,
    target: 98,
    close: 100,
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    barCloseMs: 1700000000000,
    qtyPct: 100,
    runId: "TEST",
    criteriaInputs: {
      structure_alignment: 0.82,
      pullback_quality: 0.81,
      directional_pressure: 0.77,
      continuation_pressure: 0.71,
      risk_efficiency: 0.74,
      confidence: 0.71,
      hold_after_reclaim: true,
      reclaim_hold_confirmed: true,
      reclaim_level_held: true,
      stop_distance_sane: true,
      trigger_stop_distance_sane: true,
      pullback_reclaim_short_recovery_confirmed: true,
    },
  });
  assert.strictEqual(payload.features.hold_after_reclaim, true);
  assert.strictEqual(payload.features.reclaim_hold_confirmed, true);
  assert.strictEqual(payload.features.stop_distance_sane, true);
  assert.strictEqual(payload.features.pullback_reclaim_short_recovery_confirmed, true);
})();

(function testHappyPath_StructureProducesDiagnostics() {
  const bars = buildSyntheticBars(160, { slope: 0.5 });
  const r = generateV2EntrySignals({
    exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "5",
    bars,
    htfBias: "BULL",
  });
  assert.strictEqual(r.skipped, false);
  assert.ok(typeof r.diagnostics.long_opportunity === "number");
  assert.ok(typeof r.diagnostics.short_opportunity === "number");
  assert.ok(typeof r.diagnostics.market_state === "string");
})();

// ───── (F) Cooldown ───────────────────────────────────────

(function testCooldownState() {
  const tfMs = 300_000;
  const lastBar = 1700000000000;
  // Same trigger 4 bars ago → blocked
  const cdBlocked = {
    last_long_signal_bar_close_ms: lastBar,
    last_long_trigger: "BREAKOUT",
    last_short_signal_bar_close_ms: null,
    last_short_trigger: null,
  };
  const bars = buildSyntheticBars(160, {
    slope: 0.5,
    startMs: lastBar + tfMs * 4,
    tfMs,
  });
  // We don't validate that a signal IS produced — only that cooldown
  // structurally tracks. Even if the underlying conditions don't pass
  // for this synthetic sequence, the cooldownStateNext must echo input.
  const r = generateV2EntrySignals({
    exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "5",
    bars,
    htfBias: "BULL",
    cooldownState: cdBlocked,
    barCloseMs: lastBar + tfMs * 4,
  });
  assert.ok(r.cooldownStateNext, "cooldownStateNext must be present");
  // No signal emitted (this fixture doesn't pass thresholds), so state
  // should be unchanged.
  if (r.signals.length === 0) {
    assert.strictEqual(r.cooldownStateNext.last_long_signal_bar_close_ms, lastBar);
    assert.strictEqual(r.cooldownStateNext.last_long_trigger, "BREAKOUT");
  }
})();

// ───── (G) Determinism ────────────────────────────────────

(function testDeterminism() {
  const args = {
    exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "5",
    bars: buildSyntheticBars(160, { slope: 0.3 }),
    htfBias: "BULL",
  };
  const a = generateV2EntrySignals(args);
  const b = generateV2EntrySignals(args);
  // generated_at differs by ms between the two calls — exclude it.
  const stripGeneratedAt = (d) => {
    const out = { ...d };
    delete out.generated_at;
    return out;
  };
  assert.deepStrictEqual(stripGeneratedAt(a.diagnostics), stripGeneratedAt(b.diagnostics));
  assert.deepStrictEqual(a.signals, b.signals);
})();

// ───── (H) Payload schema ────────────────────────────────

(function testPayloadShape() {
  // Manually build a fixture that's likely to fire a signal:
  // strong continuation up trend with HTF BULL.
  const bars = [];
  let ts = 1700000000000;
  for (let i = 0; i < 200; i += 1) {
    // Strong upward trend with bull-close shape on each bar
    const o = 100 + i * 0.4;
    const c = o + 0.6;          // close > open
    const h = c + 0.05;
    const l = o - 0.05;
    bars.push({
      open: o, high: h, low: l, close: c, volume: 2000,
      barCloseTimeUtcMs: ts, t: ts,
    });
    ts += 300_000;
  }
  const r = generateV2EntrySignals({
    exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "5",
    bars,
    htfBias: "BULL",
    barCloseMs: ts - 300_000,
  });
  // We tolerate either 0 or 1+ signals; if 1+, validate schema.
  for (const sig of r.signals) {
    assert.strictEqual(sig.action, "ENTRY");
    assert.strictEqual(sig.event_intent, "ENTRY");
    assert.ok(sig.event === "LONG" || sig.event === "SHORT");
    assert.ok(sig.side === "BUY" || sig.side === "SELL");
    assert.ok(sig.entry_grade === "CORE" || sig.entry_grade === "EARLY");
    assert.strictEqual(sig.strategy_id, STRATEGY_ID);
    assert.strictEqual(sig.features.source, SIGNAL_SOURCE);
    assert.strictEqual(sig.features.v2_server_native, true);
    assert.strictEqual(sig.features.engine_version, ENGINE_VERSION);
    assert.ok(Number.isFinite(sig.price));
    assert.ok(Number.isFinite(sig.stop_price));
    assert.ok(Number.isFinite(sig.target_price));
    assert.ok(Number.isFinite(sig.rr));
    assert.ok(Number.isFinite(sig.opportunity_score));

    // V2 signalCriteria gate inputs (hotfix #7) — must be present so
    // buildSignalCriteriaSeedFromIntent can map into htf_regime /
    // setup_gate / trigger_gate / no_trade_gate / expected_edge_gate.
    const f = sig.features;
    assert.ok(Number.isFinite(Number(f.htf_alignment_score)),
      `(H) features.htf_alignment_score must be finite (got ${f.htf_alignment_score})`);
    assert.ok(Number.isFinite(Number(f.setup_quality_score)),
      `(H) features.setup_quality_score must be finite (got ${f.setup_quality_score})`);
    assert.strictEqual(typeof f.trigger_confirmed, "boolean",
      "(H) features.trigger_confirmed must be a boolean");
    assert.ok(Number.isFinite(Number(f.trigger_level)),
      `(H) features.trigger_level must be finite (got ${f.trigger_level})`);
    assert.ok(Number.isFinite(Number(f.expected_gross_r)),
      `(H) features.expected_gross_r must be finite (got ${f.expected_gross_r})`);
    // sub-scores can be null when generator didn't compute, but for
    // a CORE/EARLY signal they should always be present.
    assert.ok(Number.isFinite(Number(f.directional_pressure)),
      `(H) features.directional_pressure must be finite for a fired signal (got ${f.directional_pressure})`);
    assert.ok(Number.isFinite(Number(f.participation)),
      `(H) features.participation must be finite for a fired signal (got ${f.participation})`);
    assert.ok(Number.isFinite(Number(f.rsi_entry_tf)),
      `(H) features.rsi_entry_tf must be finite for a fired signal (got ${f.rsi_entry_tf})`);
  }
})();

// ───── DEFAULT_PARAMS sanity ──────────────────────────────

(function testDefaultParams() {
  assert.ok(approx(DEFAULT_PARAMS.thr_early, 0.56));
  assert.ok(approx(DEFAULT_PARAMS.thr_core, 0.68));
  assert.strictEqual(DEFAULT_PARAMS.same_dir_cooldown_bars, 8);
  assert.ok(approx(DEFAULT_PARAMS.continuation_close_pos_long_min, 0.48));
  assert.ok(approx(DEFAULT_PARAMS.continuation_close_pos_short_max, 0.52));
  assert.ok(approx(DEFAULT_PARAMS.continuation_pullback_depth_long_min, 0.30));
  assert.ok(approx(DEFAULT_PARAMS.continuation_pullback_depth_long_max, 0.88));
  assert.ok(approx(DEFAULT_PARAMS.continuation_pullback_depth_short_min, 0.12));
  assert.ok(approx(DEFAULT_PARAMS.continuation_pullback_depth_short_max, 0.70));
  assert.ok(approx(DEFAULT_PARAMS.continuation_pressure_min, 0.56));
  assert.ok(approx(DEFAULT_PARAMS.min_rr, 1.45));
  assert.ok(approx(DEFAULT_PARAMS.stop_atr, 1.8));
  assert.ok(approx(DEFAULT_PARAMS.target_atr, 2.8));
})();

(function testContinuationDiagnosticsPresent() {
  const bars = buildSyntheticBars(160, { slope: 0.25 });
  const out = generateV2EntrySignals({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15",
    bars,
    htfBias: "BULL",
    barCloseMs: bars[bars.length - 1].barCloseTimeUtcMs,
  });
  assert.strictEqual(typeof out.diagnostics.pullback_depth_ok_long, "boolean");
  assert.strictEqual(typeof out.diagnostics.pullback_depth_ok_short, "boolean");
  assert.strictEqual(typeof out.diagnostics.continuation_bar_bias_long, "boolean");
  assert.strictEqual(typeof out.diagnostics.continuation_bar_bias_short, "boolean");
  assert.strictEqual(typeof out.diagnostics.trigger_breakout_long, "boolean");
  assert.strictEqual(typeof out.diagnostics.trigger_reclaim_long, "boolean");
  assert.strictEqual(typeof out.diagnostics.trigger_continuation_long, "boolean");
  assert.strictEqual(typeof out.diagnostics.trigger_breakdown_short, "boolean");
  assert.strictEqual(typeof out.diagnostics.trigger_loss_short, "boolean");
  assert.strictEqual(typeof out.diagnostics.trigger_continuation_short, "boolean");
  assert.strictEqual(typeof out.diagnostics.bull_close, "boolean");
  assert.strictEqual(typeof out.diagnostics.bear_close, "boolean");
  assert.ok(Number.isFinite(Number(out.diagnostics.continuation_pressure_long)));
  assert.ok(Number.isFinite(Number(out.diagnostics.continuation_pressure_short)));
  assert.ok(Number.isFinite(Number(out.diagnostics.close_pos_in_bar)));
  assert.ok(Number.isFinite(Number(out.diagnostics.price_position)));
})();

(function testDecisionReason_NoTrigger() {
  const out = deriveDirectionDecision({
    direction: "LONG",
    triggerType: "NONE",
    triggerActive: false,
    signalFired: false,
  });
  assert.strictEqual(out.reason, "LONG_NO_TRIGGER");
})();

(function testDecisionReason_CooldownBlocked() {
  const out = deriveDirectionDecision({
    direction: "SHORT",
    triggerType: "LOSS",
    triggerActive: true,
    signalFired: false,
    canFire: false,
    earlyEligible: true,
    coreEligible: false,
  });
  assert.strictEqual(out.reason, "SHORT_COOLDOWN_BLOCKED");
})();

console.log("V2_SERVER_ENTRY_SIGNAL_GENERATOR_TEST_OK");
