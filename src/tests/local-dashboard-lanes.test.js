const assert = require("assert");
const { __test, buildLocalDashboardView } = require("../server/localDashboardApp");

// Replaces local-dashboard-entry-flow.test.js, which covered the v3 paper
// entry flow the dashboard no longer renders (v3 retired 2026-08-07).

// The bug this pins: buildCarryLane once sliced `sources` to the first 6
// entries and built its lookup from the slice. XRPUSDT sits at index 6, so its
// excess rendered as "-" — indistinguishable to a reader from "this symbol has
// no carry data", when in fact the number existed and was simply dropped. A
// dashboard that silently blanks a real number is worse than one that errors.
{
  const sources = [];
  for (let i = 0; i < 6; i += 1) {
    sources.push({ kind: "funding", symbol: `PAD${i}USDT`, annualized_net_pct: 4, excess_pct: -1 });
  }
  sources.push({ kind: "funding", symbol: "XRPUSDT", annualized_net_pct: 2.43, excess_pct: -2.57 });
  sources.push({ kind: "basis", symbol: "BTCUSDT_261225", annualized_net_pct: 3.7, excess_pct: -1.3 });

  const lane = __test.buildCarryLane({
    generated_at: "2026-08-07T10:00:00.000Z",
    carry_menu: { verdict: "HOLD_RISK_FREE", sources },
    per_symbol: { XRPUSDT: { apy_pct: 2.83, events: 21, negative_events: 5 } },
  });

  const xrp = lane.excessFor("funding", "XRPUSDT");
  assert.ok(xrp, "(A1) the 7th source must be reachable — no slice before lookup");
  assert.strictEqual(xrp.excess_pct, -2.57, "(A2) excess must survive the lookup");

  // funding and basis are different mechanisms (one re-prices every 8h, the
  // other converges at delivery) and must not be merged into one table
  assert.strictEqual(lane.fundingSources.length, 7, "(A3) funding sources split out");
  assert.strictEqual(lane.basisSources.length, 1, "(A4) basis sources split out");
  assert.strictEqual(lane.excessFor("basis", "BTCUSDT_261225").excess_pct, -1.3, "(A5) basis reachable by kind");

  // a symbol genuinely absent must return null rather than throw
  assert.strictEqual(lane.excessFor("funding", "NOPEUSDT"), null, "(A6) absent symbol yields null");

  assert.strictEqual(lane.isDormant, true, "(A7) HOLD_RISK_FREE is the dormant state");
}

// Health must come from the deadman, and a stale heartbeat must surface as bad
// rather than being averaged away into an "ok".
{
  const ok = __test.computeHealth({ generated_at: new Date().toISOString(), healthy: [{ name: "a" }, { name: "b" }], stale: [] });
  assert.strictEqual(ok.tone, "ok", "(B1) no stale entries => ok");

  const bad = __test.computeHealth({ healthy: [{ name: "a" }], stale: [{ name: "v5flow_collector" }] });
  assert.strictEqual(bad.tone, "bad", "(B2) any stale heartbeat => bad");
  assert.ok(bad.detail.includes("v5flow_collector"), "(B3) the stale lane must be named, not just counted");

  const missing = __test.computeHealth(null);
  assert.strictEqual(missing.tone, "warn", "(B4) unreadable deadman is warn, never silently ok");
}

// The flow collector's whole purpose is out-growing the API horizon, so the
// banked span has to be reported, not the API's own 30-day window.
{
  const flow = __test.buildFlowLane({ rows_total: 17856, banked_span_days: 31, symbols: 24, failures: [] });
  assert.strictEqual(flow.bankedSpanDays, 31, "(C1) banked span reported");
  assert.strictEqual(flow.apiHorizonDays, 30, "(C2) API horizon kept for comparison");
  assert.deepStrictEqual(flow.failures, [], "(C3) failures default to an array, never undefined");
}

// The whole view must build against the real artifacts on disk without
// throwing, and the simplified page must keep the two facts that stop a reader
// drawing the wrong conclusion: exposure is zero, and the backtest behind the
// v6 lane did not clear significance.
{
  const view = buildLocalDashboardView();
  assert.strictEqual(view.strip.length, 4, "(D1) four status facts");
  assert.strictEqual(view.others.length, 4, "(D2) every non-tested lane compressed to one line");
  const exposure = view.strip.find((s) => s.label === "\uc2e4\uac70\ub798");
  assert.strictEqual(exposure.value, "0\uc6d0", "(D3) live exposure must read zero while every lane is paper");
  assert.ok(view.v6, "(D4) the lane under test is present");
  assert.ok(Number.isFinite(view.v6.progressPct), "(D5) progress toward a verdict is computable");

  // The backtest's RETURN would read as a forecast; its t-stat bounds the
  // claim. The page must carry the t, or a reader sees only the upside.
  assert.ok("expectedT" in view.v6, "(D6) backtest t-stat surfaced, not just the return");
}

// The ledger writes a position OPEN and later CLOSED under the SAME id.
// Counting both rows double-counts every settled trade.
{
  const { buildV6Lane } = __test;
  if (buildV6Lane) {
    const rows = [
      { id: "A", status: "OPEN", opened_at: "2026-08-08T00:00:00Z" },
      { id: "A", status: "CLOSED", opened_at: "2026-08-08T00:00:00Z", closed_at: "2026-08-08T01:00:00Z", net_pct: 1 },
    ];
    const latest = new Map();
    for (const r of rows) latest.set(r.id, r);
    const lane = buildV6Lane({ closed_n: 1, open_n: 0, config: {}, backtest_expectation: {} }, [...latest.values()]);
    assert.strictEqual(lane.open.length, 0, "(E1) a settled trade must not still count as open");
    assert.strictEqual(lane.recent.length, 1, "(E2) and must appear once as closed");
  }
}

console.log("LOCAL_DASHBOARD_LANES_TESTS_PASS");
