"use strict";

// 2026-04-29 — ROOT-CAUSE FIX (R1) for the V2 direct exit reduceOnly
// retry-storm. The earlier 60 s reject-cooldown only masked the
// symptom; the true cause is that `binanceTickExit` derives its
// `active` filter from a Firestore-cached read view that lags
// `fillSync` by up to 3 minutes. So after a successful place, the
// next fast-lane tick still sees an "ACTIVE" position and re-fires
// the same trigger, producing the duplicate dispatch that Binance
// rejects with -2022.
//
// R1 inhibits this at the source: as soon as a place succeeds,
// `markExitInFlight(symbol, ...)` flags the symbol; the next tick's
// active filter excludes any in-flight symbol from trigger evaluation
// (logged once as `tick_exit_skip_exit_in_flight`). A 30 s TTL bounds
// the inhibit so a stuck/lost ack cannot permanently silence the
// symbol; fillSync (or R2's broker truth pre-filter) clears the
// inhibit early when the actual close lands.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const tickExitSrc = fs.readFileSync(
  path.join(__dirname, "..", "services", "binanceTickExit.js"),
  "utf8"
);

// (A) Helper definitions exist.
(function testInFlightHelpersDefined() {
  assert.ok(
    /const\s+exitInFlightState\s*=\s*new\s+Map\s*\(\s*\)/.test(tickExitSrc),
    "(A1) exitInFlightState Map must be declared"
  );
  assert.ok(
    /EXIT_IN_FLIGHT_TTL_MS/.test(tickExitSrc),
    "(A2) EXIT_IN_FLIGHT_TTL_MS must be declared"
  );
  assert.ok(
    /TICK_EXIT_IN_FLIGHT_TTL_MS/.test(tickExitSrc),
    "(A3) TTL must be tunable via TICK_EXIT_IN_FLIGHT_TTL_MS env var"
  );
  assert.ok(
    /function\s+markExitInFlight\s*\(/.test(tickExitSrc),
    "(A4) markExitInFlight must be declared"
  );
  assert.ok(
    /function\s+clearExitInFlight\s*\(/.test(tickExitSrc),
    "(A5) clearExitInFlight must be declared"
  );
  assert.ok(
    /function\s+isExitInFlight\s*\(/.test(tickExitSrc),
    "(A6) isExitInFlight must be declared"
  );
})();

// (B) markExitInFlight is invoked on V2 direct dispatch place success,
//     before the v2_direct_exit_dispatch_placed log.
(function testMarkOnPlaceSuccess() {
  const placedLogIdx = tickExitSrc.indexOf('structuredLog("v2_direct_exit_dispatch_placed"');
  assert.ok(placedLogIdx > 0, "(B1) v2_direct_exit_dispatch_placed log site not found");
  const around = tickExitSrc.slice(Math.max(0, placedLogIdx - 1500), placedLogIdx);
  // Must mark BEFORE the placed log (and AFTER v2DispatchPlaced=true).
  assert.ok(
    /v2DispatchPlaced\s*=\s*true[\s\S]*markExitInFlight\s*\(\s*symbol\s*,/.test(around),
    "(B2) markExitInFlight(symbol, ...) must be called between v2DispatchPlaced=true and the placed log"
  );
})();

// (C) The active filter excludes in-flight symbols and emits
//     tick_exit_skip_exit_in_flight.
(function testActiveFilterSkipsInFlight() {
  const skipIdx = tickExitSrc.indexOf("tick_exit_skip_exit_in_flight");
  assert.ok(skipIdx > 0, "(C1) tick_exit_skip_exit_in_flight log site not found");
  // The skip must reference isExitInFlight + a Firestore-stale-derived
  // active list (activeRaw) and feed a final `active` array.
  const window = tickExitSrc.slice(Math.max(0, skipIdx - 1500), skipIdx + 1500);
  assert.ok(
    /isExitInFlight\s*\(\s*sym\s*\)/.test(window),
    "(C2) skip branch must call isExitInFlight(sym)"
  );
  assert.ok(
    /const\s+activeRaw\s*=\s*positions\.filter/.test(tickExitSrc),
    "(C3) raw active filter must be renamed to activeRaw (in-flight refinement happens after)"
  );
  assert.ok(
    /const\s+active\s*=\s*\[\s*\]/.test(tickExitSrc),
    "(C4) refined `active` array must be built from activeRaw minus in-flight symbols"
  );
})();

// (D) Runtime: in-flight lifecycle.
(function testInFlightLifecycleRuntime() {
  delete require.cache[require.resolve("../services/binanceTickExit")];
  const { __test } = require("../services/binanceTickExit");
  const {
    markExitInFlight,
    clearExitInFlight,
    isExitInFlight,
    getExitInFlightRecord,
    _exitInFlightState,
    EXIT_IN_FLIGHT_TTL_MS,
  } = __test;

  _exitInFlightState.clear();

  assert.strictEqual(isExitInFlight("DOGEUSDT"), false, "(D1) fresh symbol must not be in-flight");

  markExitInFlight("DOGEUSDT", {
    runId: "RUN__BINANCEFUT__DOGEUSDT__TICK_EXIT__1700000000000__abcd1234",
    fraction: 1,
    triggeredKinds: ["TRAIL"],
    source: "V2_DIRECT_EXIT_DISPATCH",
  });
  assert.strictEqual(isExitInFlight("DOGEUSDT"), true, "(D2) immediately after mark, must be in-flight");
  assert.strictEqual(isExitInFlight("dogeusdt"), true, "(D3) lookup must be case-insensitive");
  assert.strictEqual(isExitInFlight("LINKUSDT"), false, "(D4) inhibit is per-symbol");

  const rec = getExitInFlightRecord("DOGEUSDT");
  assert.ok(rec, "(D5) record must be retrievable");
  assert.strictEqual(rec.fraction, 1, "(D6) fraction must round-trip");
  assert.deepStrictEqual(rec.triggeredKinds, ["TRAIL"], "(D7) triggeredKinds must round-trip");
  assert.strictEqual(rec.source, "V2_DIRECT_EXIT_DISPATCH", "(D8) source must round-trip");

  // TTL safety net — record auto-evicts on read after expiry.
  // Use a wider safety margin (1 second) instead of ±1 ms because
  // markExitInFlight reads Date.now() inside the function — there can
  // be a small drift between the test's Date.now() and the mark's
  // captured placedAt that fails a ±1 ms boundary on a slow scheduler.
  const justBefore = Date.now() + EXIT_IN_FLIGHT_TTL_MS - 1000;
  assert.strictEqual(isExitInFlight("DOGEUSDT", justBefore), true, "(D9) inhibit holds well before TTL");
  const afterExpiry = Date.now() + EXIT_IN_FLIGHT_TTL_MS + 1000;
  assert.strictEqual(isExitInFlight("DOGEUSDT", afterExpiry), false, "(D10) inhibit lifts well after TTL");
  assert.strictEqual(_exitInFlightState.has("DOGEUSDT"), false, "(D11) expired entries are GC'd on read");

  // clearExitInFlight (used by fillSync / broker truth pre-filter (R2)
  // hooks to release the inhibit early when the actual close lands).
  markExitInFlight("BNBUSDT", { runId: "X", fraction: 0.5 });
  assert.strictEqual(isExitInFlight("BNBUSDT"), true, "(D12) BNB marked");
  assert.strictEqual(clearExitInFlight("BNBUSDT"), true, "(D13) clear must report deletion");
  assert.strictEqual(isExitInFlight("BNBUSDT"), false, "(D14) after clear, no longer in-flight");
  assert.strictEqual(clearExitInFlight("BNBUSDT"), false, "(D15) clear of absent symbol returns false");

  _exitInFlightState.clear();
})();

// (E) TTL is configurable via TICK_EXIT_IN_FLIGHT_TTL_MS env var.
(function testTtlEnvOverride() {
  const prev = process.env.TICK_EXIT_IN_FLIGHT_TTL_MS;
  try {
    process.env.TICK_EXIT_IN_FLIGHT_TTL_MS = "5000";
    delete require.cache[require.resolve("../services/binanceTickExit")];
    const { __test } = require("../services/binanceTickExit");
    assert.strictEqual(__test.EXIT_IN_FLIGHT_TTL_MS, 5000, "(E) TTL env override must take effect");
  } finally {
    // Always unset (do not restore prev) so neighbouring orphan tests
    // never see a leaked override that would silently shrink the
    // default 30 s window in their own runtime checks.
    delete process.env.TICK_EXIT_IN_FLIGHT_TTL_MS;
    delete require.cache[require.resolve("../services/binanceTickExit")];
    if (prev !== undefined) {
      // Re-export the variable for tests that *did* mean to set it
      // before us; this is best-effort and orphan-runner-isolated.
      process.env.TICK_EXIT_IN_FLIGHT_TTL_MS = prev;
    }
  }
})();

console.log("V2_DIRECT_EXIT_IN_FLIGHT_INHIBIT_TEST_OK");
