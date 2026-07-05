"use strict";

// Tests for the 2026-07-05 symmetric entry-quality filters in
// localPaperEntryLedger. Operator doctrine: no policy may treat LONG and
// SHORT differently — so the funding floor and the symbol denylist use ONE
// threshold / ONE list applied to both sides, and this file explicitly
// asserts the symmetry (a LONG and a SHORT with identical funding get
// identical verdicts).

const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

const { buildV3PaperEntryLedgerReport, __test } = require("../v3/localPaperEntryLedger");
const { resolveEntryMinFunding, resolveEntrySymbolDenylist } = __test;

function tmpLedger() {
  return path.join(os.tmpdir(), `v3-qf-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
}

function queueRow({ symbol, side, funding = 0.0001, i = 0 }) {
  const base = 100;
  return {
    signal_id: `V3SIG__BINANCEFUT__${symbol}__15m__${1783500000000 + i}__${side}`,
    created_at: new Date(Date.now() - 60 * 1000).toISOString(),
    symbol,
    exchange: "BINANCEFUT",
    tf: "15m",
    side,
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    cohort_key: `${side} | MC | TREND | MARGINAL_EDGE | CORE`,
    profile_id: side === "SHORT" ? "SHORT_MC_TREND_MARGINAL_CORE" : "LONG_MC_TREND_MARGINAL_CORE",
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
    funding_rate: funding,
    btc_1h_trend: side === "SHORT" ? "SHORT" : "LONG",
    mtf_1h_direction: side === "SHORT" ? "SHORT" : "LONG",
    feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
    rr: side === "SHORT" ? 1.2 : 1.55,
    signal_price: base,
    stop_price: side === "SHORT" ? base + 2 : base - 2,
    target_price: side === "SHORT" ? base - 2.4 : base + 3.1,
  };
}

function withEnv(pairs, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(pairs)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ---- resolver defaults + overrides ----------------------------------------
withEnv({ V3_ENTRY_MIN_FUNDING: undefined, V3_ENTRY_SYMBOL_DENYLIST: undefined }, () => {
  assert.strictEqual(resolveEntryMinFunding(), 0, "default funding floor is 0");
  assert.deepStrictEqual([...resolveEntrySymbolDenylist()], ["INJUSDT"], "default denylist is INJUSDT");
});
withEnv({ V3_ENTRY_MIN_FUNDING: "-0.0003", V3_ENTRY_SYMBOL_DENYLIST: "AAAUSDT, bbbusdt" }, () => {
  assert.strictEqual(resolveEntryMinFunding(), -0.0003);
  assert.deepStrictEqual([...resolveEntrySymbolDenylist()].sort(), ["AAAUSDT", "BBBUSDT"]);
});
withEnv({ V3_ENTRY_SYMBOL_DENYLIST: "" }, () => {
  assert.strictEqual(resolveEntrySymbolDenylist().size, 0, "empty env disables the denylist");
});

// ---- funding floor is SYMMETRIC: identical verdicts for LONG and SHORT ----
withEnv({ V3_ENTRY_MIN_FUNDING: undefined, V3_ENTRY_SYMBOL_DENYLIST: "" }, () => {
  const ledger = tmpLedger();
  try {
    const rows = [
      queueRow({ symbol: "BTCUSDT", side: "SHORT", funding: -0.0001, i: 1 }),
      queueRow({ symbol: "ETHUSDT", side: "LONG", funding: -0.0001, i: 2 }),
      queueRow({ symbol: "SOLUSDT", side: "SHORT", funding: 0.0001, i: 3 }),
      queueRow({ symbol: "XRPUSDT", side: "LONG", funding: 0.0001, i: 4 }),
    ];
    const r = buildV3PaperEntryLedgerReport(rows, { ledgerPath: ledger, exitRows: [] });
    assert.strictEqual(r.appended_entry_n, 2, "positive-funding LONG and SHORT both admitted");
    assert.strictEqual(r.blocked_reason_counts.V3_LEDGER_FUNDING_BELOW_MIN, 2,
      "negative-funding LONG and SHORT both blocked — same threshold, both sides");
    const sides = r.new_entries.map((e) => e.side).sort();
    assert.deepStrictEqual(sides, ["LONG", "SHORT"], "one admitted per side — verdict is side-blind");
    assert.strictEqual(r.entry_filters.min_funding, 0);
  } finally { fs.existsSync(ledger) && fs.unlinkSync(ledger); }
});

// ---- missing funding: blocked UPSTREAM by the learning-context gate --------
// hasCompleteLearningContext (pre-existing) already requires funding_rate to
// be present, so a null-funding row never reaches the funding floor. This
// pins that interaction: the block reason must be LEARNING_CONTEXT_REQUIRED,
// NOT FUNDING_BELOW_MIN (the floor's isFinite guard is defensive only).
withEnv({ V3_ENTRY_MIN_FUNDING: undefined, V3_ENTRY_SYMBOL_DENYLIST: "" }, () => {
  const ledger = tmpLedger();
  try {
    const row = queueRow({ symbol: "BNBUSDT", side: "SHORT", i: 5 });
    row.funding_rate = null;
    const r = buildV3PaperEntryLedgerReport([row], { ledgerPath: ledger, exitRows: [] });
    assert.strictEqual(r.appended_entry_n, 0);
    assert.strictEqual(r.blocked_reason_counts.V3_LEDGER_LEARNING_CONTEXT_REQUIRED, 1,
      "null funding is a learning-context defect, not a funding-floor verdict");
    assert.strictEqual(r.blocked_reason_counts.V3_LEDGER_FUNDING_BELOW_MIN, undefined);
  } finally { fs.existsSync(ledger) && fs.unlinkSync(ledger); }
});

// ---- denylist blocks BOTH sides of the same symbol -------------------------
withEnv({ V3_ENTRY_MIN_FUNDING: undefined, V3_ENTRY_SYMBOL_DENYLIST: undefined }, () => {
  const ledger = tmpLedger();
  try {
    const rows = [
      queueRow({ symbol: "INJUSDT", side: "SHORT", funding: 0.0001, i: 6 }),
      queueRow({ symbol: "INJUSDT", side: "LONG", funding: 0.0001, i: 7 }),
      queueRow({ symbol: "BTCUSDT", side: "SHORT", funding: 0.0001, i: 8 }),
    ];
    const r = buildV3PaperEntryLedgerReport(rows, { ledgerPath: ledger, exitRows: [] });
    assert.strictEqual(r.blocked_reason_counts.V3_LEDGER_SYMBOL_DENYLISTED, 2,
      "denylisted symbol blocked on BOTH sides");
    assert.strictEqual(r.appended_entry_n, 1);
    assert.deepStrictEqual(r.entry_filters.symbol_denylist, ["INJUSDT"]);
  } finally { fs.existsSync(ledger) && fs.unlinkSync(ledger); }
});

console.log("v3-entry-quality-filters.test.js PASS");
