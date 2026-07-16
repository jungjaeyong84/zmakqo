"use strict";

// Tests for the 2026-07-16 survival-hardening set:
//   liveLedgerView   — latest-row-wins semantics (repair rows supersede)
//   liveExecutor     — slow-bleed breaker (incl. latch semantics + override)
//   liveBracketRepair— naked-position decision table
//   liveReconcile    — ghost / missing / qty-mismatch classification
//   deadmanCheck     — artifact staleness verdicts
//   opsAlert         — transition/dedup/re-arm decide logic

const assert = require("assert");

const { latestRowsBySignalId, openRealRows } = require("../v3/liveLedgerView");
const { decideLiveOrders, __test: exec } = require("../v3/liveExecutor");
const { decideBracketRepair, buildRepairedEntryRow, buildExternalCloseExitRow } = require("../v3/liveBracketRepair");
const { compareLedgerVsExchange, findingsSignature } = require("../v3/liveReconcile");
const { checkArtifacts } = require("../v3/deadmanCheck");
const { decideAlert } = require("../v3/opsAlert");

function withEnv(pairs, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(pairs)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ===== liveLedgerView =========================================================
(() => {
  const rows = [
    { signal_id: "A", status: "OPEN_BRACKET_INCOMPLETE", created_at: "2026-07-16T01:00:00.000Z", stop_order_id: null },
    { signal_id: "B", status: "OPEN", created_at: "2026-07-16T01:05:00.000Z" },
    { signal_id: "A", status: "OPEN", created_at: "2026-07-16T01:10:00.000Z", stop_order_id: 77, repaired: true },
  ];
  const m = latestRowsBySignalId(rows);
  assert.strictEqual(m.size, 2);
  assert.strictEqual(m.get("A").stop_order_id, 77, "repair row must supersede the incomplete original");
  // missing timestamps: append order wins
  const m2 = latestRowsBySignalId([{ signal_id: "X", v: 1 }, { signal_id: "X", v: 2 }]);
  assert.strictEqual(m2.get("X").v, 2);
  // openRealRows: closed + dry-run excluded, repaired row visible
  const open = openRealRows(rows, [{ signal_id: "B", status: "CLOSED" }]);
  assert.strictEqual(open.length, 1);
  assert.strictEqual(open[0].signal_id, "A");
  assert.strictEqual(open[0].repaired, true);
})();

// ===== executor: repair rows must not double-count against caps ==============
withEnv({ V3_LIVE_ENABLED: "1", V3_MAX_OPEN_TOTAL: "2" }, () => {
  const NOW = Date.parse("2026-07-16T03:00:00.000Z");
  const liveEntryRows = [
    { signal_id: "R1", symbol: "SOLUSDT", side: "SHORT", dry_run: false, status: "OPEN_BRACKET_INCOMPLETE", created_at: "2026-07-16T01:00:00.000Z" },
    { signal_id: "R1", symbol: "SOLUSDT", side: "SHORT", dry_run: false, status: "OPEN", created_at: "2026-07-16T01:10:00.000Z", repaired: true },
  ];
  const fresh = {
    signal_id: "NEW1", symbol: "BTCUSDT", side: "SHORT", tf: "15m", rr: 1.2,
    created_at: new Date(NOW - 60000).toISOString(),
    signal_price: 100, stop_price: 102, target_price: 97.6,
  };
  const r = decideLiveOrders({ paperEntries: [fresh], liveEntryRows, nowMs: NOW });
  // If the repaired signal double-counted, openTotal would start at 2 (=cap)
  // and NEW1 would be blocked by LIVE_MAX_OPEN_TOTAL. Admission proves
  // single-counting; live_open_total then reads 2 = 1 existing + 1 admitted.
  assert.strictEqual(r.intents.length, 1, "cap=2 with 1 truly-open must still admit");
  assert.strictEqual(r.skipped.LIVE_MAX_OPEN_TOTAL, undefined);
  assert.strictEqual(r.live_open_total, 2);
});

// ===== executor: slow-bleed breaker ==========================================
withEnv({ V3_LIVE_ENABLED: "1", V3_LIVE_BLEED_WINDOW_N: "5", V3_LIVE_BLEED_MIN_EXP_R: "-0.15" }, () => {
  const NOW = Date.parse("2026-07-16T03:00:00.000Z");
  const mkExit = (i, r, dry = false) => ({
    signal_id: `E${i}`, status: "CLOSED", dry_run: dry, realized_r: r,
    closed_at: new Date(Date.parse("2026-07-10T00:00:00Z") + i * 3600e3).toISOString(),
  });
  const fresh = {
    signal_id: "NEW2", symbol: "ETHUSDT", side: "SHORT", tf: "15m", rr: 1.2,
    created_at: new Date(NOW - 60000).toISOString(),
    signal_price: 100, stop_price: 102, target_price: 97.6,
  };
  // trailing 5 real trades at -0.2R avg → trip
  const bleeding = [1, 2, 3, 4, 5].map((i) => mkExit(i, -0.2));
  let r = decideLiveOrders({ paperEntries: [fresh], liveExitRows: bleeding, nowMs: NOW });
  assert.strictEqual(r.live_bleed.tripped, true);
  assert.strictEqual(r.intents.length, 0);
  assert.strictEqual(r.skipped.LIVE_BLEED_BREAKER, 1);
  // dry-run exits must NOT trip the breaker
  const dryBleed = [1, 2, 3, 4, 5].map((i) => mkExit(i, -1, true));
  r = decideLiveOrders({ paperEntries: [fresh], liveExitRows: dryBleed, nowMs: NOW });
  assert.strictEqual(r.live_bleed.tripped, false, "dry-run rows are not live bleed");
  assert.strictEqual(r.intents.length, 1);
  // below window size → not tripped (insufficient evidence)
  r = decideLiveOrders({ paperEntries: [fresh], liveExitRows: bleeding.slice(0, 4), nowMs: NOW });
  assert.strictEqual(r.live_bleed.tripped, false);
  // override releases the latch (deliberate operator act)
  withEnv({ V3_LIVE_BLEED_OVERRIDE: "1" }, () => {
    const r2 = decideLiveOrders({ paperEntries: [fresh], liveExitRows: bleeding, nowMs: NOW });
    assert.strictEqual(r2.live_bleed.tripped, false);
    assert.strictEqual(r2.intents.length, 1);
  });
  // exactly at threshold (-0.15) must NOT trip (strict less-than)
  const atEdge = [1, 2, 3, 4, 5].map((i) => mkExit(i, -0.15));
  r = decideLiveOrders({ paperEntries: [fresh], liveExitRows: atEdge, nowMs: NOW });
  assert.strictEqual(r.live_bleed.tripped, false);
});

// ===== bracket repair decision table =========================================
(() => {
  const entry = { signal_id: "S", symbol: "BTCUSDT", side: "LONG", stop_order_id: 1, tp_order_id: 2 };
  const alive = { status: "NEW", orderId: 9 };
  const dead = { status: "CANCELED", orderId: 9 };
  assert.strictEqual(decideBracketRepair({ entryRow: entry, positionAmt: 0 }).action, "CLOSE_EXTERNAL");
  assert.strictEqual(decideBracketRepair({ entryRow: entry, positionAmt: -0.1, stopOrder: alive, tpOrder: alive }).action, "ANOMALY", "LONG row but short position = direction mismatch");
  assert.strictEqual(decideBracketRepair({ entryRow: entry, positionAmt: 0.1, stopOrder: { status: "FILLED" }, tpOrder: alive }).action, "ANOMALY", "filled exit leg + open position never auto-repairs");
  assert.strictEqual(decideBracketRepair({ entryRow: entry, positionAmt: 0.1, stopOrder: alive, tpOrder: alive }).action, "NONE");
  assert.strictEqual(decideBracketRepair({ entryRow: entry, positionAmt: 0.1, stopOrder: null, tpOrder: alive }).action, "REPLACE_STOP");
  assert.strictEqual(decideBracketRepair({ entryRow: entry, positionAmt: 0.1, stopOrder: alive, tpOrder: dead }).action, "REPLACE_TP");
  assert.strictEqual(decideBracketRepair({ entryRow: entry, positionAmt: 0.1, stopOrder: null, tpOrder: null }).action, "REPLACE_BOTH");

  const repaired = buildRepairedEntryRow(entry, { stopOrderId: 99, repairedLegs: ["STOP"] });
  assert.strictEqual(repaired.status, "OPEN");
  assert.strictEqual(repaired.stop_order_id, 99);
  assert.strictEqual(repaired.tp_order_id, 2, "untouched leg keeps its order id");
  assert.strictEqual(repaired.prior_stop_order_id, 1);
  assert.strictEqual(repaired.repaired, true);

  const ext = buildExternalCloseExitRow(entry);
  assert.strictEqual(ext.status, "CLOSED");
  assert.strictEqual(ext.exit_event, "EXTERNAL_OR_UNFILLED");
  assert.strictEqual(ext.needs_review, true);
  assert.strictEqual(ext.realized_r, null, "external closes never fabricate a realized R");
})();

// ===== reconcile ==============================================================
(() => {
  const NOW = Date.parse("2026-07-16T03:00:00.000Z");
  const openRow = (sid, symbol, side, qty, ageMs) => ({
    signal_id: sid, symbol, side, qty, created_at: new Date(NOW - ageMs).toISOString(),
  });
  // healthy: ledger LONG 0.1 vs exchange +0.1
  let r = compareLedgerVsExchange({
    openLedgerRows: [openRow("L1", "BTCUSDT", "LONG", 0.1, 60e3)],
    positions: [{ symbol: "BTCUSDT", positionAmt: 0.1 }],
    nowMs: NOW,
  });
  assert.strictEqual(r.ok, true);
  // ghost: exchange position, empty ledger (dry-run invariant)
  r = compareLedgerVsExchange({ openLedgerRows: [], positions: [{ symbol: "ETHUSDT", positionAmt: -0.5 }], nowMs: NOW });
  assert.strictEqual(r.findings[0].type, "GHOST_POSITION");
  // direction mismatch is a ghost too
  r = compareLedgerVsExchange({
    openLedgerRows: [openRow("L2", "SOLUSDT", "LONG", 1, 60e3)],
    positions: [{ symbol: "SOLUSDT", positionAmt: -1 }],
    nowMs: NOW,
  });
  assert.strictEqual(r.findings[0].type, "GHOST_POSITION");
  // missing: ledger open, exchange flat, past grace
  r = compareLedgerVsExchange({ openLedgerRows: [openRow("L3", "XRPUSDT", "SHORT", 10, 11 * 60e3)], positions: [], nowMs: NOW });
  assert.strictEqual(r.findings[0].type, "MISSING_POSITION");
  // within grace → quiet (exit-sync will record it)
  r = compareLedgerVsExchange({ openLedgerRows: [openRow("L4", "XRPUSDT", "SHORT", 10, 60e3)], positions: [], nowMs: NOW });
  assert.strictEqual(r.ok, true);
  // qty mismatch beyond 5%
  r = compareLedgerVsExchange({
    openLedgerRows: [openRow("L5", "BNBUSDT", "LONG", 1.0, 60e3)],
    positions: [{ symbol: "BNBUSDT", positionAmt: 1.2 }],
    nowMs: NOW,
  });
  assert.strictEqual(r.findings[0].type, "QTY_MISMATCH");
  // signature stability
  assert.strictEqual(findingsSignature(r.findings), findingsSignature([...r.findings]));
})();

// ===== deadman ================================================================
(() => {
  const NOW = 1_000_000_000;
  const ages = { fresh: 60e3, stale: 20 * 60e3, missing: null };
  const fakeAge = (p) => ages[p];
  const r = checkArtifacts([
    { name: "paper", path: "fresh", max_age_ms: 15 * 60e3 },
    { name: "live", path: "stale", max_age_ms: 15 * 60e3 },
    { name: "watch", path: "missing", max_age_ms: 26 * 3600e3 },
  ], NOW, fakeAge);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.stale.map((s) => s.name).sort(), ["live", "watch"]);
  assert.strictEqual(r.stale.find((s) => s.name === "watch").missing, true, "missing artifact = stale");
  assert.deepStrictEqual(r.healthy.map((s) => s.name), ["paper"]);
})();

// ===== opsAlert decide (transition / re-arm / recovery) ======================
(() => {
  const T0 = 1_000_000;
  // transition into failure → alert
  let d = decideAlert({ state: {}, key: "k", active: true, nowMs: T0, rearmMs: 1000 });
  assert.strictEqual(d.alert, true);
  // still failing, before re-arm → quiet
  let d2 = decideAlert({ state: d.nextState, key: "k", active: true, nowMs: T0 + 500, rearmMs: 1000 });
  assert.strictEqual(d2.alert, false);
  // still failing, past re-arm → reminder
  let d3 = decideAlert({ state: d2.nextState, key: "k", active: true, nowMs: T0 + 1500, rearmMs: 1000 });
  assert.strictEqual(d3.alert, true);
  // recovery transition
  let d4 = decideAlert({ state: d3.nextState, key: "k", active: false, nowMs: T0 + 2000, rearmMs: 1000 });
  assert.strictEqual(d4.alert, false);
  assert.strictEqual(d4.recovered, true);
  // healthy stays quiet
  let d5 = decideAlert({ state: d4.nextState, key: "k", active: false, nowMs: T0 + 3000, rearmMs: 1000 });
  assert.strictEqual(d5.alert, false);
  assert.strictEqual(d5.recovered, false);
})();

console.log("v3-survival-hardening.test.js PASS");
