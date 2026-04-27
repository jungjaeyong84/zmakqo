"use strict";

// 2026-04-28 senior audit (Step 4 — OOM diagnosis).
//
// Cloud Run logs showed `Memory limit of 1024 MiB exceeded` followed by
// SIGABRT (signal 6) every 30–60 minutes on the donbeolja main service.
// Stage K's V8-level uncaughtException handler never fired because Cloud
// Run sends SIGABRT externally when the cgroup memory limit is breached
// — the process is killed before any V8 handler runs.
//
// Root cause: `tpP1PendingTerminalAlertState` is keyed by
// `${symbol}:${intentId}:${reason}`. The intentId is per-intent, so the
// cache grew unboundedly across the lifetime of a Cloud Run instance.
// We added a soft cap of 2048 entries with a cooldown-aware sweep and
// a hard floor that drops the oldest half if the sweep cannot reclaim
// enough.
//
// This test pins the eviction contract: a) once `size` exceeds the cap,
// the next call to `shouldSendTpP1PendingTerminalAlert` triggers a sweep
// that drops the cache to <= cap; b) the cooldown contract is preserved
// for keys that remain within their cooldown window.

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function clearCache(cache) {
  cache.clear();
}

function run() {
  const cache = __test._tpP1PendingTerminalAlertState;
  assert.ok(cache instanceof Map, "alert cache must be a Map");
  clearCache(cache);

  // (A) Cooldown semantics — the second call within the cooldown window
  // returns false, regardless of cache pressure.
  const first = __test.shouldSendTpP1PendingTerminalAlert({
    symbol: "BTCUSDT",
    intentId: "INTENT_A",
    reason: "TP1_PENDING_TIMEOUT",
  });
  const repeat = __test.shouldSendTpP1PendingTerminalAlert({
    symbol: "BTCUSDT",
    intentId: "INTENT_A",
    reason: "TP1_PENDING_TIMEOUT",
  });
  assert.strictEqual(first, true, "(A) first call within cooldown must allow alert");
  assert.strictEqual(repeat, false, "(A) repeat call within cooldown must suppress");

  // (B) Cap behavior — pre-fill the cache with > 2048 distinct entries
  // and verify the next mutation triggers a sweep that reduces size.
  clearCache(cache);
  const FAKE_NOW = Date.now();
  for (let i = 0; i < 2050; i += 1) {
    // Manually populate with stale timestamps (older than the cooldown
    // window) so the cooldown-aware sweep can reclaim them. This mimics
    // hours of accumulated intent-id keys after the cooldown elapsed.
    cache.set(`SYM_${i}:INTENT_${i}:REASON`, FAKE_NOW - (24 * 60 * 60 * 1000));
  }
  assert.strictEqual(cache.size, 2050, "(B) precondition — cache pre-filled to 2050");
  __test.shouldSendTpP1PendingTerminalAlert({
    symbol: "ETHUSDT",
    intentId: "INTENT_NEW",
    reason: "TP1_PENDING_TIMEOUT",
  });
  assert.ok(cache.size <= 2048, "(B) sweep must keep size <= 2048 after mutation");
  assert.ok(cache.size <= 100, "(B) cooldown sweep should reclaim most stale entries (got " + cache.size + ")");

  // (C) Hard cap — when entries are all *fresh* (within cooldown), the
  // sweep can't reclaim any, so the hard floor must drop oldest half.
  clearCache(cache);
  const FRESH_NOW = Date.now();
  for (let i = 0; i < 2100; i += 1) {
    cache.set(`SYM_${i}:INTENT_${i}:REASON`, FRESH_NOW);
  }
  assert.strictEqual(cache.size, 2100, "(C) precondition — fresh-entry cache pre-filled to 2100");
  __test.shouldSendTpP1PendingTerminalAlert({
    symbol: "BNBUSDT",
    intentId: "INTENT_C",
    reason: "TP1_PENDING_TIMEOUT",
  });
  // After a fresh-only mutation, hard floor drops oldest half:
  // pre-mutation size = 2100, post-add = 2101, fresh sweep keeps all,
  // hard floor drops floor(2101/2) = 1050 entries → final ~1051.
  assert.ok(cache.size <= 1100, "(C) hard floor must drop ~half when no entries are stale (got " + cache.size + ")");
  clearCache(cache);
}

try {
  run();
  console.log("TICK_EXIT_ALERT_CACHE_EVICTION_TEST_OK");
} catch (err) {
  console.error("TICK_EXIT_ALERT_CACHE_EVICTION_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
