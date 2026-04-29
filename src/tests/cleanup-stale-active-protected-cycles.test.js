"use strict";

// 2026-04-30 P0-fix-G — stale ACTIVE_PROTECTED cleanup script tests.
//
// Pin the classification truth-table so a future "be more aggressive"
// or "be more conservative" change is forced to make an explicit
// decision.

const assert = require("assert");

delete require.cache[require.resolve("../../scripts/cleanup-stale-active-protected-cycles")];
const { __test } = require("../../scripts/cleanup-stale-active-protected-cycles");
const { classifyCycle, parseArgs, resolveCycleAgeMs } = __test;

const NOW_MS = Date.parse("2026-04-30T12:00:00.000Z");
const FIVE_MIN_MS = 5 * 60 * 1000;
const ONE_HOUR_AGO = new Date(NOW_MS - 60 * 60 * 1000).toISOString();
const TWO_MIN_AGO = new Date(NOW_MS - 2 * 60 * 1000).toISOString();

// ── (A) parseArgs ──────────────────────────────────────────────
(function testParseArgs() {
  assert.strictEqual(parseArgs([]).apply, false, "(A1) default apply=false");
  assert.strictEqual(parseArgs(["--apply"]).apply, true, "(A2) --apply → true");
  assert.strictEqual(parseArgs(["--apply=true"]).apply, true, "(A3) --apply=true");
  assert.strictEqual(parseArgs(["--apply=false"]).apply, false, "(A4) --apply=false");
  assert.strictEqual(parseArgs(["--apply", "--other"]).apply, true, "(A5) extra args ignored");
})();

// ── (B) resolveCycleAgeMs ──────────────────────────────────────
(function testResolveCycleAge() {
  // Priority chain: entry_bootstrap_committed_at → activated_at →
  // opened_at → created_at.
  assert.strictEqual(
    resolveCycleAgeMs({ entry_bootstrap_committed_at: ONE_HOUR_AGO }, NOW_MS),
    60 * 60 * 1000,
    "(B1) entry_bootstrap_committed_at"
  );
  assert.strictEqual(
    resolveCycleAgeMs({ activated_at: TWO_MIN_AGO }, NOW_MS),
    2 * 60 * 1000,
    "(B2) activated_at fallback"
  );
  // Top of chain wins.
  assert.strictEqual(
    resolveCycleAgeMs({
      entry_bootstrap_committed_at: ONE_HOUR_AGO,
      activated_at: TWO_MIN_AGO,
    }, NOW_MS),
    60 * 60 * 1000,
    "(B3) bootstrap wins over activated"
  );
  // No usable timestamp.
  assert.strictEqual(resolveCycleAgeMs({}, NOW_MS), null, "(B4) no timestamps → null");
  // Garbage timestamp.
  assert.strictEqual(
    resolveCycleAgeMs({ activated_at: "not-a-date" }, NOW_MS),
    null,
    "(B5) garbage timestamp → null"
  );
})();

// ── (C) classifyCycle ──────────────────────────────────────────
(function testClassify() {
  const baseCycle = {
    position_cycle_id: "PCY__BTCUSDT__1",
    symbol: "BTCUSDT",
    position_side: "LONG",
    status: "ACTIVE_PROTECTED",
    activated_at: ONE_HOUR_AGO,
  };

  // Broker map: BTC absent (effectively flat), ETH live.
  const brokerByMap = new Map([
    ["ETHUSDT", { positionAmt: 0.1, positionSide: "LONG", isFlat: false }],
    ["BNBUSDT", { positionAmt: 0, positionSide: "FLAT", isFlat: true }],
  ]);

  // (C1) STALE_BROKER_FLAT — symbol absent + age above floor.
  const c1 = classifyCycle({ cycle: baseCycle, brokerByMap, nowMs: NOW_MS });
  assert.strictEqual(c1.classification, "STALE_BROKER_FLAT",
    `(C1) absent in broker → STALE (got ${c1.classification})`);

  // (C2) STALE_BROKER_FLAT — symbol present with isFlat=true.
  const c2 = classifyCycle({
    cycle: { ...baseCycle, symbol: "BNBUSDT", position_cycle_id: "PCY__BNB" },
    brokerByMap,
    nowMs: NOW_MS,
  });
  assert.strictEqual(c2.classification, "STALE_BROKER_FLAT",
    `(C2) isFlat=true → STALE (got ${c2.classification})`);

  // (C3) BROKER_LIVE — symbol present and not flat.
  const c3 = classifyCycle({
    cycle: { ...baseCycle, symbol: "ETHUSDT", position_cycle_id: "PCY__ETH" },
    brokerByMap,
    nowMs: NOW_MS,
  });
  assert.strictEqual(c3.classification, "BROKER_LIVE",
    `(C3) live broker side → BROKER_LIVE (got ${c3.classification})`);

  // (C4) RECENTLY_OPENED — age below floor.
  const c4 = classifyCycle({
    cycle: { ...baseCycle, activated_at: TWO_MIN_AGO },
    brokerByMap,
    nowMs: NOW_MS,
  });
  assert.strictEqual(c4.classification, "RECENTLY_OPENED",
    `(C4) age=2min < 5min floor → RECENTLY_OPENED (got ${c4.classification})`);

  // (C5) UNKNOWN — broker map unavailable.
  const c5 = classifyCycle({ cycle: baseCycle, brokerByMap: null, nowMs: NOW_MS });
  assert.strictEqual(c5.classification, "UNKNOWN",
    `(C5) no broker → UNKNOWN (got ${c5.classification})`);

  // (C6) UNKNOWN_AGE — no usable timestamp.
  const c6 = classifyCycle({
    cycle: { position_cycle_id: "X", symbol: "BTCUSDT", status: "ACTIVE_PROTECTED" },
    brokerByMap,
    nowMs: NOW_MS,
  });
  assert.strictEqual(c6.classification, "UNKNOWN_AGE",
    `(C6) no age → UNKNOWN_AGE (got ${c6.classification})`);

  // (C7) MISSING_FIELDS.
  const c7 = classifyCycle({ cycle: { activated_at: ONE_HOUR_AGO }, brokerByMap, nowMs: NOW_MS });
  assert.strictEqual(c7.classification, "MISSING_FIELDS",
    `(C7) no symbol/id → MISSING_FIELDS (got ${c7.classification})`);
})();

// ── (D) age floor pin ───────────────────────────────────────────
//
// CRITICAL safety: a cycle younger than CYCLE_AGE_FLOOR_MS is NEVER
// classified STALE even when broker is FLAT. This protects against
// the race window where PROTECTION_PENDING just transitioned to
// ACTIVE_PROTECTED but the broker side hasn't caught up yet.
(function testAgeFloorSafety() {
  const brokerByMap = new Map(); // empty → all symbols absent
  const recent = {
    position_cycle_id: "PCY__RECENT",
    symbol: "BTCUSDT",
    status: "ACTIVE_PROTECTED",
    activated_at: new Date(NOW_MS - (FIVE_MIN_MS - 1)).toISOString(), // 1ms below floor
  };
  const c = classifyCycle({ cycle: recent, brokerByMap, nowMs: NOW_MS });
  assert.strictEqual(c.classification, "RECENTLY_OPENED",
    "(D1) cycle 1ms below floor must be RECENTLY_OPENED, NOT STALE — protection-window safety");
})();

console.log("CLEANUP_STALE_ACTIVE_PROTECTED_CYCLES_TEST_OK");
