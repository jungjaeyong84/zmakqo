"use strict";

// Tests for the 2026-07-15 micro-live execution decision layer. Focus: the
// safety model — defaults OFF, dry-run by default, the non-overridable
// notional hard cap, freshness (no cold-start replay), live caps/kill, and
// per-signal dedup.

const assert = require("assert");
const { decideLiveOrders, LIVE_NOTIONAL_HARD_CAP_USDT, __test } = require("../v3/liveExecutor");

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

const NOW = Date.parse("2026-07-15T03:00:00.000Z");
function paperEntry({ symbol = "BTCUSDT", side = "SHORT", i = 0, ageMs = 60 * 1000 }) {
  const sig = 100;
  return {
    signal_id: `SIG_${symbol}_${side}_${i}`,
    created_at: new Date(NOW - ageMs).toISOString(),
    symbol,
    side,
    tf: "15m",
    rr: side === "SHORT" ? 1.2 : 1.55,
    signal_price: sig,
    stop_price: side === "SHORT" ? sig + 2 : sig - 2,
    target_price: side === "SHORT" ? sig - 2.4 : sig + 3.1,
  };
}

// ---- default posture: disabled, and dry-run when enabled -------------------
withEnv({ V3_LIVE_ENABLED: undefined, V3_LIVE_DRY_RUN: undefined }, () => {
  const r = decideLiveOrders({ paperEntries: [paperEntry({})], nowMs: NOW });
  assert.strictEqual(r.intents.length, 0, "live must be OFF by default");
  assert.strictEqual(r.skipped.LIVE_DISABLED, 1);
  assert.strictEqual(__test.resolveDryRun(), true, "dry-run must be the default");
});

// ---- enabled + default dry-run: intents produced, flagged dry_run ----------
withEnv({ V3_LIVE_ENABLED: "1", V3_LIVE_DRY_RUN: undefined }, () => {
  const r = decideLiveOrders({ paperEntries: [paperEntry({})], nowMs: NOW });
  assert.strictEqual(r.intents.length, 1);
  assert.strictEqual(r.intents[0].dry_run, true, "intents must be dry-run unless explicitly disabled");
  assert.strictEqual(r.intents[0].order_side, "SELL");
  assert.strictEqual(r.intents[0].close_side, "BUY");
});

// ---- notional hard cap is NOT env-overridable ------------------------------
withEnv({ V3_LIVE_ENABLED: "1", V3_LIVE_NOTIONAL_USDT: "5000" }, () => {
  const r = decideLiveOrders({ paperEntries: [paperEntry({})], nowMs: NOW });
  assert.strictEqual(r.config.notional_usdt, LIVE_NOTIONAL_HARD_CAP_USDT,
    "a fat-fingered env must clamp to the code hard cap");
  assert.ok(Math.abs(r.intents[0].raw_qty - LIVE_NOTIONAL_HARD_CAP_USDT / 100) < 1e-12);
});

// ---- freshness: cold start must not replay history -------------------------
withEnv({ V3_LIVE_ENABLED: "1" }, () => {
  const stale = paperEntry({ i: 1, ageMs: 11 * 60 * 1000 }); // older than 10min default
  const fresh = paperEntry({ symbol: "ETHUSDT", i: 2, ageMs: 60 * 1000 });
  const r = decideLiveOrders({ paperEntries: [stale, fresh], nowMs: NOW });
  assert.strictEqual(r.intents.length, 1);
  assert.strictEqual(r.intents[0].symbol, "ETHUSDT");
  assert.strictEqual(r.skipped.ENTRY_TOO_OLD, 1);
});

// ---- per-signal dedup across cycles ----------------------------------------
withEnv({ V3_LIVE_ENABLED: "1" }, () => {
  const e = paperEntry({ i: 3 });
  const r = decideLiveOrders({
    paperEntries: [e],
    liveEntryRows: [{ signal_id: e.signal_id, symbol: e.symbol, side: e.side, dry_run: false }],
    nowMs: NOW,
  });
  assert.strictEqual(r.intents.length, 0);
  assert.strictEqual(r.skipped.ALREADY_EXECUTED, 1);
});

// ---- live caps: total + per-side + symbol-side lock ------------------------
withEnv({ V3_LIVE_ENABLED: "1", V3_MAX_OPEN_TOTAL: "2", V3_MAX_OPEN_PER_SIDE: "1" }, () => {
  const open = [
    { signal_id: "OLD1", symbol: "SOLUSDT", side: "SHORT", dry_run: false },
  ];
  const entries = [
    paperEntry({ symbol: "BTCUSDT", side: "SHORT", i: 4 }), // blocked: per-side cap (1 short open)
    paperEntry({ symbol: "XRPUSDT", side: "LONG", i: 5 }),  // admitted (side budget free)
    paperEntry({ symbol: "BNBUSDT", side: "LONG", i: 6 }),  // blocked: total cap (2 reached)
  ];
  const r = decideLiveOrders({ paperEntries: entries, liveEntryRows: open, nowMs: NOW });
  assert.strictEqual(r.intents.length, 1);
  assert.strictEqual(r.intents[0].symbol, "XRPUSDT");
  assert.strictEqual(r.skipped.LIVE_MAX_OPEN_PER_SIDE, 1);
  assert.strictEqual(r.skipped.LIVE_MAX_OPEN_TOTAL, 1);
});

// ---- dry-run rows hold no live exposure ------------------------------------
withEnv({ V3_LIVE_ENABLED: "1", V3_MAX_OPEN_TOTAL: "1" }, () => {
  const open = [{ signal_id: "DR1", symbol: "SOLUSDT", side: "SHORT", dry_run: true }];
  const r = decideLiveOrders({ paperEntries: [paperEntry({ i: 7 })], liveEntryRows: open, nowMs: NOW });
  assert.strictEqual(r.intents.length, 1, "dry-run ledger rows must not consume live caps");
});

// ---- live daily kill switch -------------------------------------------------
withEnv({ V3_LIVE_ENABLED: "1", V3_DAILY_DRAWDOWN_KILL_R: "-2" }, () => {
  const exits = [
    { signal_id: "A", status: "CLOSED", closed_at: "2026-07-15T01:00:00.000Z", realized_r: -1 },
    { signal_id: "B", status: "CLOSED", closed_at: "2026-07-15T02:00:00.000Z", realized_r: -1.2 },
  ];
  const r = decideLiveOrders({ paperEntries: [paperEntry({ i: 8 })], liveExitRows: exits, nowMs: NOW });
  assert.strictEqual(r.live_kill_active, true);
  assert.strictEqual(r.intents.length, 0);
  assert.strictEqual(r.skipped.LIVE_DAILY_KILL, 1);
});

// ---- closed live entries free their slot ------------------------------------
withEnv({ V3_LIVE_ENABLED: "1", V3_MAX_OPEN_TOTAL: "1" }, () => {
  const entryRows = [{ signal_id: "C1", symbol: "SOLUSDT", side: "SHORT", dry_run: false }];
  const exitRows = [{ signal_id: "C1", status: "CLOSED", closed_at: "2026-07-14T00:00:00.000Z", realized_r: 1.2 }];
  const r = decideLiveOrders({ paperEntries: [paperEntry({ i: 9 })], liveEntryRows: entryRows, liveExitRows: exitRows, nowMs: NOW });
  assert.strictEqual(r.intents.length, 1, "a closed live position must free its concurrency slot");
});

console.log("v3-live-executor.test.js PASS");
