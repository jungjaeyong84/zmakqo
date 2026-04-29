"use strict";

// 2026-04-29 — ROOT-CAUSE FIX (R3) for the V2 direct exit reduceOnly
// retry-storm. R1 + R2 prevent the duplicate dispatch from being
// attempted in the first place, which makes the original 60 s
// post-rejection cooldown (commit 6f6494a3) redundant — and worse,
// actively wrong, because it modelled the bug backwards (reacted to
// the symptom, the rejection, instead of preventing the duplicate
// dispatch).
//
// R3 retires the cooldown:
// - all v2DirectExitRejectCooldownState / V2_DIRECT_EXIT_REJECT_COOLDOWN_MS
//   declarations and their helpers are gone, except the lone
//   `isReduceOnlyReject(errMsg)` parser which stays as a diagnostic
//   tag on the `v2_direct_exit_dispatch_place_fail` log
// - the dispatch-entry skip block (`v2_direct_exit_dispatch_reject_cooldown_skip`)
//   is gone
// - the `markV2DirectExitRecentReject(symbol)` call in the place_fail
//   catch is gone
// - on a -2022 reject, instead of arming a per-symbol cooldown, we
//   force-invalidate the R2 broker position snapshot so the very
//   next cycle does a fresh fetch and absorbs the now-flat broker
//   state (rather than waiting up to 5 s for the existing snapshot
//   to expire naturally)

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const tickExitSrc = fs.readFileSync(
  path.join(__dirname, "..", "services", "binanceTickExit.js"),
  "utf8"
);

// (A) Cooldown machinery is gone.
(function testCooldownMachineryRemoved() {
  assert.ok(
    !/v2DirectExitRejectCooldownState/.test(tickExitSrc),
    "(A1) v2DirectExitRejectCooldownState Map must be removed"
  );
  assert.ok(
    !/V2_DIRECT_EXIT_REJECT_COOLDOWN_MS/.test(tickExitSrc),
    "(A2) V2_DIRECT_EXIT_REJECT_COOLDOWN_MS must be removed"
  );
  assert.ok(
    !/markV2DirectExitRecentReject/.test(tickExitSrc),
    "(A3) markV2DirectExitRecentReject must be removed"
  );
  assert.ok(
    !/isV2DirectExitInRejectCooldown/.test(tickExitSrc),
    "(A4) isV2DirectExitInRejectCooldown must be removed"
  );
  assert.ok(
    !/v2_direct_exit_dispatch_reject_cooldown_skip/.test(tickExitSrc),
    "(A5) reject_cooldown_skip log site must be removed"
  );
  // The diagnostic parser must remain.
  assert.ok(
    /function\s+isReduceOnlyReject\s*\(/.test(tickExitSrc),
    "(A6) isReduceOnlyReject diagnostic parser must remain"
  );
})();

// (B) The deleted file from 6f6494a3 is gone.
(function testCooldownTestFileDeleted() {
  const cooldownTest = path.join(__dirname, "v2-direct-exit-reject-cooldown.test.js");
  assert.strictEqual(
    fs.existsSync(cooldownTest),
    false,
    "(B) src/tests/v2-direct-exit-reject-cooldown.test.js must be removed"
  );
})();

// (C) On a -2022 reject, the place_fail catch invalidates the broker
//     snapshot so the next R2 cycle does a fresh fetch.
(function testRejectInvalidatesBrokerSnapshot() {
  const placeFailIdx = tickExitSrc.indexOf("structuredLog(\"v2_direct_exit_dispatch_place_fail\"");
  assert.ok(placeFailIdx > 0, "(C1) place_fail log site missing");
  const aroundCatch = tickExitSrc.slice(Math.max(0, placeFailIdx - 1500), placeFailIdx);
  assert.ok(
    /isReduceOnlyReject\s*\(\s*v2DispatchPlaceError\s*\)\s*\)\s*\{[\s\S]{0,200}invalidateBrokerPositionSnapshotCache\s*\(\s*\)/.test(aroundCatch),
    "(C2) place_fail catch must invalidate the broker snapshot when isReduceOnlyReject is true"
  );
})();

// (D) Runtime: __test surface no longer exposes the retired helpers
//     but still exposes isReduceOnlyReject for diagnostics.
(function testTestSurfaceShape() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  assert.strictEqual(typeof __test.isReduceOnlyReject, "function", "(D1) isReduceOnlyReject still exported");
  assert.strictEqual(__test.markV2DirectExitRecentReject, undefined, "(D2) markV2DirectExitRecentReject removed");
  assert.strictEqual(__test.isV2DirectExitInRejectCooldown, undefined, "(D3) isV2DirectExitInRejectCooldown removed");
  assert.strictEqual(__test._v2DirectExitRejectCooldownState, undefined, "(D4) cooldown Map export removed");
  assert.strictEqual(__test.V2_DIRECT_EXIT_REJECT_COOLDOWN_MS, undefined, "(D5) cooldown TTL export removed");
  // R1 + R2 helpers must remain.
  assert.strictEqual(typeof __test.markExitInFlight, "function", "(D6) R1 markExitInFlight still exported");
  assert.strictEqual(typeof __test.isExitInFlight, "function", "(D7) R1 isExitInFlight still exported");
  assert.strictEqual(typeof __test.getBrokerPositionSnapshot, "function", "(D8) R2 getBrokerPositionSnapshot still exported");
  assert.strictEqual(typeof __test.invalidateBrokerPositionSnapshotCache, "function", "(D9) R2 cache invalidator still exported");
})();

// (E) Runtime: invalidateBrokerPositionSnapshotCache actually clears
//     the cache so the next call refetches. 2026-04-29 P0-4 — the
//     snapshot now lives in `brokerPositionTruth`, so we must clear
//     that module's cache too before the stubbed fetcher is captured.
(function testInvalidateBehaviour() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  delete require.cache[require.resolve("../services/brokerPositionTruth")];
  delete require.cache[require.resolve("../exchanges/binanceFuturesPrivate")];
  const privateModule = require("../exchanges/binanceFuturesPrivate");
  let fetchCalls = 0;
  const origFetch = privateModule.fetchBinanceFuturesAccount;
  privateModule.fetchBinanceFuturesAccount = async () => {
    fetchCalls += 1;
    return { positions: [{ symbol: "DOGEUSDT", positionAmt: "0", positionSide: "BOTH" }] };
  };
  delete require.cache[require.resolve("../services/brokerPositionTruth")];
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const { getBrokerPositionSnapshot, invalidateBrokerPositionSnapshotCache } = __test;
  invalidateBrokerPositionSnapshotCache();

  return Promise.resolve()
    .then(() => getBrokerPositionSnapshot({ liveCfg: { apiKey: "K", apiSecret: "S" }, nowMs: 1000 }))
    .then(() => {
      assert.strictEqual(fetchCalls, 1, "(E1) first call fetches");
      // Same nowMs — would normally be a cache hit, but invalidate first.
      invalidateBrokerPositionSnapshotCache();
      return getBrokerPositionSnapshot({ liveCfg: { apiKey: "K", apiSecret: "S" }, nowMs: 1000 });
    })
    .then(() => {
      assert.strictEqual(fetchCalls, 2, "(E2) post-invalidate, the next call refetches even within TTL");
      privateModule.fetchBinanceFuturesAccount = origFetch;
      delete require.cache[require.resolve("../services/binanceTickExit")];
      delete require.cache[require.resolve("../services/brokerPositionTruth")];
      delete require.cache[require.resolve("../exchanges/binanceFuturesPrivate")];
    })
    .catch((e) => {
      privateModule.fetchBinanceFuturesAccount = origFetch;
      delete require.cache[require.resolve("../services/binanceTickExit")];
      delete require.cache[require.resolve("../services/brokerPositionTruth")];
      delete require.cache[require.resolve("../exchanges/binanceFuturesPrivate")];
      throw e;
    });
})();

console.log("V2_DIRECT_EXIT_R3_COOLDOWN_RETIRED_TEST_OK");
