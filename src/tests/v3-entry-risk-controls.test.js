"use strict";

// Tests for the 2026-06-19 v3 portfolio risk controls in
// localPaperEntryLedger: total concurrent cap, per-direction cap, and the
// daily-drawdown circuit breaker. These bound the effective single-bet size
// of the correlated short engine (up to ~19 SHORTs fire in one market-wide
// down-move) — a live-readiness prerequisite.

const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

const { buildV3PaperEntryLedgerReport, __test } = require("../v3/localPaperEntryLedger");
const {
  resolveMaxOpenTotal,
  resolveMaxOpenPerSide,
  resolveDailyDrawdownKillR,
  computeTodayRealizedR,
} = __test;

function tmpLedger() {
  return path.join(os.tmpdir(), `v3-risk-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
}

// Minimal admissible queue row (must satisfy hasCompleteLearningContext).
function queueRow({ symbol, side, i = 0, createdAtMs = Date.now() }) {
  const base = side === "SHORT" ? 100 : 100;
  return {
    signal_id: `V3SIG__BINANCEFUT__${symbol}__15m__${1781840000000 + i}__${side}`,
    // keep created_at within the signal-age window of the test's clock so
    // the stale check (which runs before the risk controls) does not pre-block.
    created_at: new Date(createdAtMs - 60 * 1000).toISOString(),
    symbol,
    exchange: "BINANCEFUT",
    tf: "15m",
    side,
    setup_type: side === "SHORT" ? "MOMENTUM_CONTINUATION" : "BREAKOUT_RETEST",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    cohort_key: `${side} | X | TREND | MARGINAL_EDGE | CORE`,
    profile_id: side === "SHORT" ? "SHORT_MC_TREND_MARGINAL_CORE" : "LONG_BR_TREND_MARGINAL_CORE",
    entry_grade: "CORE",
    market_state: side === "SHORT" ? "BEAR" : "BULL",
    htf_bias: side === "SHORT" ? "BEAR" : "BULL",
    opportunity_score: 0.73,
    confidence: 0.74,
    setup_quality_score: 0.73,
    structure_alignment: 0.9,
    htf_alignment_score: 0.9,
    market_quality_score: 0.8,
    spread_bps: 1.2,
    funding_rate: -0.0001,
    btc_1h_trend: side === "SHORT" ? "SHORT" : "LONG",
    mtf_1h_direction: side === "SHORT" ? "SHORT" : "LONG",
    feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
    rr: side === "SHORT" ? 1.2 : 1.55,
    signal_price: base,
    stop_price: side === "SHORT" ? base + 2 : base - 2,
    target_price: side === "SHORT" ? base - 2.4 : base + 3.1,
  };
}

const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "LINKUSDT", "ARBUSDT", "TIAUSDT", "AAVEUSDT"];

// ---- resolver defaults + env overrides ---------------------------------
(() => {
  const prev = { t: process.env.V3_MAX_OPEN_TOTAL, s: process.env.V3_MAX_OPEN_PER_SIDE, k: process.env.V3_DAILY_DRAWDOWN_KILL_R };
  try {
    delete process.env.V3_MAX_OPEN_TOTAL;
    delete process.env.V3_MAX_OPEN_PER_SIDE;
    delete process.env.V3_DAILY_DRAWDOWN_KILL_R;
    assert.strictEqual(resolveMaxOpenTotal(), 6, "default total cap 6");
    assert.strictEqual(resolveMaxOpenPerSide(), 5, "default per-side cap 5");
    assert.strictEqual(resolveDailyDrawdownKillR(), -5, "default kill -5R");
    process.env.V3_MAX_OPEN_TOTAL = "3";
    process.env.V3_MAX_OPEN_PER_SIDE = "2";
    process.env.V3_DAILY_DRAWDOWN_KILL_R = "-8";
    assert.strictEqual(resolveMaxOpenTotal(), 3);
    assert.strictEqual(resolveMaxOpenPerSide(), 2);
    assert.strictEqual(resolveDailyDrawdownKillR(), -8);
  } finally {
    for (const [k, v] of [["V3_MAX_OPEN_TOTAL", prev.t], ["V3_MAX_OPEN_PER_SIDE", prev.s], ["V3_DAILY_DRAWDOWN_KILL_R", prev.k]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
})();

// ---- computeTodayRealizedR -------------------------------------------------
(() => {
  const now = Date.parse("2026-06-19T12:00:00.000Z");
  const rows = [
    { status: "CLOSED", closed_at: "2026-06-19T01:00:00.000Z", realized_r: -1 },
    { status: "CLOSED", closed_at: "2026-06-19T02:00:00.000Z", realized_r: 1.2 },
    { status: "CLOSED", closed_at: "2026-06-18T23:00:00.000Z", realized_r: -1 }, // yesterday, excluded
    { status: "OPEN", closed_at: "2026-06-19T03:00:00.000Z", realized_r: -1 },    // not closed, excluded
  ];
  const t = computeTodayRealizedR(rows, now);
  assert.strictEqual(t.n, 2, "only today's CLOSED rows count");
  assert.ok(Math.abs(t.net - 0.2) < 1e-9, `today net should be +0.2R, got ${t.net}`);
})();

// ---- total concurrent cap --------------------------------------------------
(() => {
  const prev = process.env.V3_MAX_OPEN_TOTAL;
  process.env.V3_MAX_OPEN_TOTAL = "3";
  process.env.V3_MAX_OPEN_PER_SIDE = "10"; // disable per-side for this test
  const ledger = tmpLedger();
  try {
    // 5 distinct SHORT symbols in one cycle; cap=3 -> only 3 admitted
    const rows = SYMS.slice(0, 5).map((s, i) => queueRow({ symbol: s, side: "SHORT", i }));
    const r = buildV3PaperEntryLedgerReport(rows, { ledgerPath: ledger, exitRows: [] });
    assert.strictEqual(r.appended_entry_n, 3, `total cap should admit exactly 3, got ${r.appended_entry_n}`);
    assert.strictEqual(r.blocked_reason_counts.V3_LEDGER_MAX_OPEN_TOTAL, 2, "2 blocked by total cap");
    assert.strictEqual(r.risk_controls.max_open_total, 3);
    assert.strictEqual(r.risk_controls.open_short_n, 3);
  } finally {
    fs.existsSync(ledger) && fs.unlinkSync(ledger);
    if (prev === undefined) delete process.env.V3_MAX_OPEN_TOTAL; else process.env.V3_MAX_OPEN_TOTAL = prev;
    delete process.env.V3_MAX_OPEN_PER_SIDE;
  }
})();

// ---- per-direction cap (the correlated-cluster guard) ----------------------
(() => {
  process.env.V3_MAX_OPEN_TOTAL = "20";  // disable total cap
  process.env.V3_MAX_OPEN_PER_SIDE = "2";
  const ledger = tmpLedger();
  try {
    // 4 SHORTs + 1 LONG; per-side cap 2 -> 2 SHORT + 1 LONG admitted, 2 SHORT blocked
    const rows = [
      ...SYMS.slice(0, 4).map((s, i) => queueRow({ symbol: s, side: "SHORT", i })),
      queueRow({ symbol: "INJUSDT", side: "LONG", i: 99 }),
    ];
    const r = buildV3PaperEntryLedgerReport(rows, { ledgerPath: ledger, exitRows: [] });
    assert.strictEqual(r.risk_controls.open_short_n, 2, "only 2 SHORT admitted");
    assert.strictEqual(r.risk_controls.open_long_n, 1, "1 LONG admitted (separate side budget)");
    assert.strictEqual(r.blocked_reason_counts.V3_LEDGER_MAX_OPEN_PER_SIDE, 2, "2 SHORT blocked by per-side cap");
    assert.strictEqual(r.appended_entry_n, 3);
  } finally {
    fs.existsSync(ledger) && fs.unlinkSync(ledger);
    delete process.env.V3_MAX_OPEN_TOTAL;
    delete process.env.V3_MAX_OPEN_PER_SIDE;
  }
})();

// ---- daily drawdown kill switch -------------------------------------------
(() => {
  process.env.V3_DAILY_DRAWDOWN_KILL_R = "-5";
  const ledger = tmpLedger();
  const now = Date.parse("2026-06-19T12:00:00.000Z");
  try {
    // today's realized R already at -6R (below -5 threshold) -> halt all
    const exitRows = [
      { status: "CLOSED", closed_at: "2026-06-19T01:00:00.000Z", realized_r: -1, symbol: "BTCUSDT", side: "SHORT" },
      { status: "CLOSED", closed_at: "2026-06-19T02:00:00.000Z", realized_r: -1, symbol: "ETHUSDT", side: "SHORT" },
      { status: "CLOSED", closed_at: "2026-06-19T03:00:00.000Z", realized_r: -1, symbol: "SOLUSDT", side: "SHORT" },
      { status: "CLOSED", closed_at: "2026-06-19T04:00:00.000Z", realized_r: -1, symbol: "XRPUSDT", side: "SHORT" },
      { status: "CLOSED", closed_at: "2026-06-19T05:00:00.000Z", realized_r: -1, symbol: "BNBUSDT", side: "SHORT" },
      { status: "CLOSED", closed_at: "2026-06-19T06:00:00.000Z", realized_r: -1, symbol: "DOGEUSDT", side: "SHORT" },
    ];
    // use symbols NOT present in exitRows so the symbol-cooldown check
    // (which runs before the kill switch) does not pre-block them.
    const rows = ["SUIUSDT", "TAOUSDT", "SANDUSDT"].map((s, i) => queueRow({ symbol: s, side: "SHORT", i: 200 + i, createdAtMs: now }));
    const r = buildV3PaperEntryLedgerReport(rows, { ledgerPath: ledger, exitRows, nowMs: now });
    assert.strictEqual(r.risk_controls.kill_switch_active, true, "kill switch armed at -6R <= -5R");
    assert.ok(Math.abs(r.risk_controls.today_realized_r - (-6)) < 1e-9);
    assert.strictEqual(r.appended_entry_n, 0, "no entries admitted while kill switch active");
    assert.strictEqual(r.blocked_reason_counts.V3_LEDGER_DAILY_DRAWDOWN_KILL, 3);
  } finally {
    fs.existsSync(ledger) && fs.unlinkSync(ledger);
    delete process.env.V3_DAILY_DRAWDOWN_KILL_R;
  }
})();

// ---- kill switch NOT armed above threshold --------------------------------
(() => {
  process.env.V3_DAILY_DRAWDOWN_KILL_R = "-5";
  const ledger = tmpLedger();
  const now = Date.parse("2026-06-19T12:00:00.000Z");
  try {
    const exitRows = [
      { status: "CLOSED", closed_at: "2026-06-19T01:00:00.000Z", realized_r: -1, symbol: "BTCUSDT", side: "SHORT" },
      { status: "CLOSED", closed_at: "2026-06-19T02:00:00.000Z", realized_r: -1, symbol: "ETHUSDT", side: "SHORT" },
    ]; // -2R, above -5 threshold
    const rows = [queueRow({ symbol: "SOLUSDT", side: "SHORT", i: 300, createdAtMs: now })];
    const r = buildV3PaperEntryLedgerReport(rows, { ledgerPath: ledger, exitRows, nowMs: now });
    assert.strictEqual(r.risk_controls.kill_switch_active, false);
    assert.strictEqual(r.appended_entry_n, 1, "entry admitted when above kill threshold");
  } finally {
    fs.existsSync(ledger) && fs.unlinkSync(ledger);
    delete process.env.V3_DAILY_DRAWDOWN_KILL_R;
  }
})();

console.log("v3-entry-risk-controls.test.js PASS");
