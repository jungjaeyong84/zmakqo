"use strict";

// 2026-04-29 — ROOT-CAUSE FIX (R2) for the V2 direct exit reduceOnly
// retry-storm. R1 inhibits *post-place* duplicates; R2 inhibits the
// pre-place case where the broker has already closed the position
// (native STOP_MARKET fired, manual close, or fillSync has not yet
// propagated a recent close) but the local Firestore read view still
// shows ACTIVE. Without this guard a fast-lane tick would dispatch
// a reduceOnly close into a flat position and earn -2022.
//
// Fix: before iterating the active set, fetch the broker's account
// snapshot (positions[]) once per cycle, cache it for 5 s, and skip
// any symbol whose `positionAmt === 0`. fillSync will reconcile the
// local view at its own cadence; until then, R2 keeps the dispatch
// path honest.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const tickExitSrc = fs.readFileSync(
  path.join(__dirname, "..", "services", "binanceTickExit.js"),
  "utf8"
);

// (A) Helper definitions exist. 2026-04-29 P0-4 — these helpers were
//     extracted from binanceTickExit.js into the shared
//     `src/services/brokerPositionTruth.js` module so all callers
//     (binanceTickExit / liveTrailingStageRepair / fillsSync /
//     selfHeal) share one in-process snapshot. The R2 contract here
//     is unchanged: binanceTickExit re-exports the same names by
//     destructuring the shared module, so existing __test consumers
//     keep working.
const brokerTruthSrc = fs.readFileSync(
  path.join(__dirname, "..", "services", "brokerPositionTruth.js"),
  "utf8"
);
(function testSnapshotHelpersDefined() {
  assert.ok(
    /let\s+brokerPositionSnapshotCache\s*=\s*null/.test(brokerTruthSrc),
    "(A1) brokerPositionSnapshotCache must be a module-level let in brokerPositionTruth.js"
  );
  assert.ok(
    /BROKER_POSITION_SNAPSHOT_TTL_MS/.test(brokerTruthSrc),
    "(A2) BROKER_POSITION_SNAPSHOT_TTL_MS must be declared in brokerPositionTruth.js"
  );
  // The legacy env var name is honoured for back-compat — a deployment
  // with TICK_EXIT_BROKER_SNAPSHOT_TTL_MS set should keep working.
  assert.ok(
    /TICK_EXIT_BROKER_SNAPSHOT_TTL_MS/.test(brokerTruthSrc),
    "(A3) TTL must still honour the legacy TICK_EXIT_BROKER_SNAPSHOT_TTL_MS env var (back-compat)"
  );
  assert.ok(
    /function\s+buildBrokerPositionSnapshot\s*\(/.test(brokerTruthSrc),
    "(A4) buildBrokerPositionSnapshot must be declared in brokerPositionTruth.js"
  );
  assert.ok(
    /async\s+function\s+getBrokerPositionSnapshot\s*\(/.test(brokerTruthSrc),
    "(A5) getBrokerPositionSnapshot must be declared in brokerPositionTruth.js"
  );
  assert.ok(
    /function\s+invalidateBrokerPositionSnapshotCache\s*\(/.test(brokerTruthSrc),
    "(A6) invalidateBrokerPositionSnapshotCache must be declared in brokerPositionTruth.js"
  );
  // binanceTickExit must still re-export the same names for callers
  // that read the helpers via the tick-exit __test surface (R1/R2/R3
  // tests continue to import via binanceTickExit __test).
  assert.ok(
    /require\(["']\.\/brokerPositionTruth["']\)/.test(tickExitSrc),
    "(A7) binanceTickExit.js must require the shared brokerPositionTruth helper"
  );
})();

// (B) The pre-filter is wired into the active-list build pipeline:
//     activeRaw → in-flight refinement → broker-flat refinement →
//     iterate.
(function testPreFilterPlacement() {
  const inFlightSkipIdx = tickExitSrc.indexOf("tick_exit_skip_exit_in_flight");
  const brokerFlatSkipIdx = tickExitSrc.indexOf("tick_exit_skip_broker_flat");
  const dispatchPlaceIdx = tickExitSrc.indexOf("structuredLog(\"v2_direct_exit_dispatch_placed\"");
  assert.ok(inFlightSkipIdx > 0, "(B1) tick_exit_skip_exit_in_flight log site missing");
  assert.ok(brokerFlatSkipIdx > 0, "(B2) tick_exit_skip_broker_flat log site missing");
  assert.ok(dispatchPlaceIdx > 0, "(B3) v2_direct_exit_dispatch_placed log site missing");
  assert.ok(
    inFlightSkipIdx < brokerFlatSkipIdx,
    "(B4) broker-flat refinement must run after in-flight refinement"
  );
  assert.ok(
    brokerFlatSkipIdx < dispatchPlaceIdx,
    "(B5) broker-flat refinement must precede dispatch place"
  );
})();

// (C) The broker-flat skip path also clears any leftover in-flight
//     inhibit, so that when fillSync (eventually) repopulates the
//     view (e.g. user reopens the position) we don't have to wait
//     out R1's 30 s TTL.
(function testBrokerFlatClearsInFlight() {
  const idx = tickExitSrc.indexOf("tick_exit_skip_broker_flat");
  const region = tickExitSrc.slice(idx, idx + 1500);
  assert.ok(
    /clearExitInFlight\s*\(\s*sym\s*\)/.test(region),
    "(C) broker-flat branch must call clearExitInFlight(sym)"
  );
})();

// (D) Pre-filter failures must NOT crash the loop — they fall through
//     to the legacy dispatch path with structured warning logs.
(function testPreFilterFailureFallthrough() {
  assert.ok(
    tickExitSrc.includes("tick_exit_broker_snapshot_fetch_fail"),
    "(D1) snapshot fetch failure log site must exist"
  );
  assert.ok(
    tickExitSrc.includes("tick_exit_broker_pre_filter_fail"),
    "(D2) pre-filter outer failure log site must exist"
  );
  // Outer try/catch must wrap the whole pre-filter block, not throw.
  // Window widened to {0,12000} on each side because the 2026-04-29
  // broker-flat alert dispatch (β) added ~60 lines between the skip
  // log and the catch(preFilterErr) clause. The structural intent
  // (skip log lives inside the outer try/catch) is unchanged.
  assert.ok(
    /try\s*\{[\s\S]{0,12000}tick_exit_skip_broker_flat[\s\S]{0,12000}\}\s*catch\s*\(\s*preFilterErr\s*\)/.test(tickExitSrc),
    "(D3) pre-filter must be wrapped in try/catch"
  );
})();

// (E) Runtime: buildBrokerPositionSnapshot correctly classifies
//     positions.
(function testBuildSnapshotRuntime() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const { buildBrokerPositionSnapshot } = __test;

  const snap = buildBrokerPositionSnapshot({
    positions: [
      { symbol: "DOGEUSDT", positionAmt: "0", positionSide: "BOTH" },
      { symbol: "LINKUSDT", positionAmt: "12.345", positionSide: "LONG" },
      { symbol: "ETHUSDT", positionAmt: "-1.5", positionSide: "SHORT" },
      { symbol: "BNBUSDT", positionAmt: "not-a-number" },         // skipped
      { symbol: "", positionAmt: "1" },                            // skipped
      { positionAmt: "1" },                                        // skipped
    ],
  });
  assert.strictEqual(snap.size, 3, "(E1) only well-formed rows are kept");

  const doge = snap.get("DOGEUSDT");
  assert.strictEqual(doge.positionAmt, 0, "(E2) DOGE positionAmt parsed as number");
  assert.strictEqual(doge.isFlat, true, "(E3) DOGE recognised as flat");

  const link = snap.get("LINKUSDT");
  assert.strictEqual(link.isFlat, false, "(E4) LINK long is not flat");
  assert.strictEqual(link.positionSide, "LONG", "(E5) LINK side preserved");

  const eth = snap.get("ETHUSDT");
  assert.strictEqual(eth.isFlat, false, "(E6) ETH short is not flat");
  assert.strictEqual(eth.positionSide, "SHORT", "(E7) ETH side preserved");
})();

// (F) Runtime: getBrokerPositionSnapshot honours the TTL cache and
//     calls fetchBinanceFuturesAccount only once across cache hits.
(function testSnapshotCacheRuntime() {
  // 2026-04-29 P0-4 — the snapshot lives in `brokerPositionTruth` now,
  // not in binanceTickExit. To make the stub effective, clear BOTH
  // module caches AND the new shared module before requiring; the
  // monkey-patched fetcher will then be captured at module-level
  // destructure inside brokerPositionTruth.
  delete require.cache[require.resolve("../services/binanceTickExit")];
  delete require.cache[require.resolve("../services/brokerPositionTruth")];
  delete require.cache[require.resolve("../exchanges/binanceFuturesPrivate")];
  const privateModule = require("../exchanges/binanceFuturesPrivate");
  let fetchCalls = 0;
  const origFetch = privateModule.fetchBinanceFuturesAccount;
  privateModule.fetchBinanceFuturesAccount = async ({ apiKey, apiSecret }) => {
    fetchCalls += 1;
    return {
      positions: [
        { symbol: "DOGEUSDT", positionAmt: "0", positionSide: "BOTH" },
        { symbol: "LINKUSDT", positionAmt: "5", positionSide: "LONG" },
      ],
    };
  };

  // Re-require BOTH modules in dependency order so binanceTickExit
  // gets a fresh brokerPositionTruth that already saw the stubbed
  // fetcher.
  delete require.cache[require.resolve("../services/brokerPositionTruth")];
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const {
    getBrokerPositionSnapshot,
    invalidateBrokerPositionSnapshotCache,
    BROKER_POSITION_SNAPSHOT_TTL_MS,
  } = __test;

  invalidateBrokerPositionSnapshotCache();

  const liveCfg = { apiKey: "K", apiSecret: "S" };

  return Promise.resolve()
    .then(() => getBrokerPositionSnapshot({ liveCfg, nowMs: 1_000_000 }))
    .then((snap1) => {
      assert.ok(snap1 && snap1.byMap, "(F1) first call returns a snapshot");
      assert.strictEqual(snap1.byMap.size, 2, "(F2) snapshot has 2 symbols");
      assert.strictEqual(fetchCalls, 1, "(F3) one fetch on first call");

      // Cache hit within TTL — fetchCalls must NOT increase.
      return getBrokerPositionSnapshot({
        liveCfg,
        nowMs: 1_000_000 + BROKER_POSITION_SNAPSHOT_TTL_MS - 1,
      });
    })
    .then((snap2) => {
      assert.strictEqual(fetchCalls, 1, "(F4) cache hit within TTL — no extra fetch");
      assert.ok(snap2 && snap2.byMap.has("DOGEUSDT"), "(F5) cached snapshot returned");

      // Past TTL — refetch.
      return getBrokerPositionSnapshot({
        liveCfg,
        nowMs: 1_000_000 + BROKER_POSITION_SNAPSHOT_TTL_MS + 1,
      });
    })
    .then(() => {
      assert.strictEqual(fetchCalls, 2, "(F6) cache miss after TTL — refetch");

      // Restore.
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

console.log("V2_DIRECT_EXIT_BROKER_TRUTH_PRE_FILTER_TEST_OK");
