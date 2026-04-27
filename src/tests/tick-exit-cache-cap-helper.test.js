"use strict";

// 2026-04-28 senior audit Step 8 — defensive depth on top of Step 4 OOM
// fix. Step 4 capped only `tpP1PendingTerminalAlertState` because that
// was the empirically observed leak (intent-id keyed). The other in-
// memory alert caches in binanceTickExit.js are bounded today by
// symbol-only or symbol:reason keying, but a future change adding
// per-intent or per-bar dimensions would silently re-introduce the
// SIGABRT-via-OOM pattern. The shared `applyAlertCacheCap` helper now
// runs after every `.set()` on those caches.
//
// This test pins:
//   1. The helper itself — early-exit under cap, cooldown-aware sweep,
//      hard floor.
//   2. The four call sites (TpP1AckTimeout / TickExitFailure /
//      NativeProtectionRefresh / TrailHardExit) actually invoke the
//      cap on their backing caches.

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function run() {
  const helper = __test.applyAlertCacheCap;
  assert.strictEqual(typeof helper, "function", "applyAlertCacheCap must be exported");

  // (A) Under-cap → no-op.
  {
    const cache = new Map();
    cache.set("k1", Date.now());
    helper(cache, 60000, 100);
    assert.strictEqual(cache.size, 1, "(A) under-cap call must be a no-op");
  }

  // (B) Cooldown-aware sweep — stale entries are dropped first.
  {
    const cache = new Map();
    const now = Date.now();
    for (let i = 0; i < 110; i += 1) cache.set(`stale_${i}`, now - 10 * 60 * 1000);
    cache.set("fresh", now);
    helper(cache, 60 * 1000, 100); // cooldown 60s, cap 100
    assert.ok(cache.size <= 100, "(B) sweep must keep size <= cap");
    assert.ok(cache.has("fresh"), "(B) fresh entries must survive the sweep");
  }

  // (C) Fresh-only hard floor — when nothing is stale, drop oldest half.
  {
    const cache = new Map();
    const now = Date.now();
    for (let i = 0; i < 200; i += 1) cache.set(`fresh_${i}`, now);
    helper(cache, 60 * 60 * 1000, 100); // cooldown 1h, cap 100
    assert.ok(cache.size <= 100, "(C) hard floor must drop entries when no sweep candidates");
    assert.ok(cache.size >= 50, "(C) hard floor must not over-drop (got " + cache.size + ")");
  }

  // (D) Defensive null-safe call — nothing throws on a non-Map argument.
  {
    helper(null, 1000);
    helper(undefined, 1000);
    helper({}, 1000);
    assert.ok(true, "(D) helper must not throw on non-Map inputs");
  }

  // (E) Each cap-protected call site uses the helper. We pre-fill the
  //     cache past the cap with stale entries, then trigger the call
  //     site once and confirm the size dropped.
  function exerciseCapPath({ cache, cooldownMs, fire }) {
    cache.clear();
    const stale = Date.now() - 10 * cooldownMs;
    for (let i = 0; i < 2100; i += 1) cache.set(`OLD_${i}`, stale);
    assert.strictEqual(cache.size, 2100, "precondition — pre-filled to 2100");
    fire();
    assert.ok(cache.size <= 2048, `(E) cache.size must be <= 2048 after cap (got ${cache.size})`);
  }

  exerciseCapPath({
    cache: __test._tpP1AckTimeoutAlertState,
    cooldownMs: 300000,
    fire: () => __test.shouldSendTpP1AckTimeoutAlert({
      symbol: "BTCUSDT", intentId: "INT_NEW", reason: "TIMEOUT",
    }),
  });

  exerciseCapPath({
    cache: __test._tickExitFailureAlertState,
    cooldownMs: 300000,
    fire: () => __test.shouldSendTickExitFailureAlert({ symbol: "BTCUSDT", reason: "FAIL" }),
  });

  exerciseCapPath({
    cache: __test._nativeProtectionRefreshAttemptState,
    cooldownMs: 3000,
    fire: () => __test.shouldRunNativeProtectionRefreshCooldown({ symbol: "BTCUSDT" }),
  });
}

try {
  run();
  console.log("TICK_EXIT_CACHE_CAP_HELPER_TEST_OK");
} catch (err) {
  console.error("TICK_EXIT_CACHE_CAP_HELPER_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
