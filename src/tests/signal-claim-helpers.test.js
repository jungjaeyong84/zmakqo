"use strict";

// 2026-04-29 P1-1.15 — signal-claim helper extraction tests.

const assert = require("assert");

delete require.cache[require.resolve("../utils/signalClaimHelpers")];
const {
  resolveSignalIdFromSignalLike,
  isSignalClaimAlreadyHandled,
} = require("../utils/signalClaimHelpers");

// ── (A) resolveSignalIdFromSignalLike — fallback chain ─────────
(function testResolveId() {
  // Direct signal_id wins.
  assert.strictEqual(
    resolveSignalIdFromSignalLike({ signal_id: "abc" }),
    "abc",
    "(A1) row.signal_id"
  );
  // signal_doc_id fallback.
  assert.strictEqual(
    resolveSignalIdFromSignalLike({ signal_doc_id: "doc1" }),
    "doc1",
    "(A2) row.signal_doc_id"
  );
  // features_json.signal_id fallback.
  assert.strictEqual(
    resolveSignalIdFromSignalLike({ features_json: { signal_id: "fj1" } }),
    "fj1",
    "(A3) features_json.signal_id"
  );
  // features.signal_doc_id fallback.
  assert.strictEqual(
    resolveSignalIdFromSignalLike({ features: { signal_doc_id: "f2" } }),
    "f2",
    "(A4) features.signal_doc_id"
  );
  // Order: top-level wins over nested.
  assert.strictEqual(
    resolveSignalIdFromSignalLike({
      signal_id: "top",
      features_json: { signal_id: "nested" },
    }),
    "top",
    "(A5) top-level signal_id wins over nested"
  );
  // Trim whitespace.
  assert.strictEqual(
    resolveSignalIdFromSignalLike({ signal_id: "  spaced  " }),
    "spaced",
    "(A6) trim"
  );
  // Empty string at all paths → null.
  assert.strictEqual(resolveSignalIdFromSignalLike({}), null, "(A7) empty row");
  assert.strictEqual(resolveSignalIdFromSignalLike(null), null, "(A8) null row");
  assert.strictEqual(resolveSignalIdFromSignalLike(undefined), null, "(A9) undefined row");
  assert.strictEqual(
    resolveSignalIdFromSignalLike({ signal_id: "" }),
    null,
    "(A10) empty signal_id → null (after trim)"
  );
  // Falsy primitives at first slot fall through.
  assert.strictEqual(
    resolveSignalIdFromSignalLike({ signal_id: null, signal_doc_id: "doc" }),
    "doc",
    "(A11) null signal_id falls through to signal_doc_id"
  );
})();

// ── (B) isSignalClaimAlreadyHandled ────────────────────────────
(function testHandled() {
  assert.strictEqual(
    isSignalClaimAlreadyHandled({ reason: "ALREADY_CONSUMED" }),
    true,
    "(B1) ALREADY_CONSUMED"
  );
  assert.strictEqual(
    isSignalClaimAlreadyHandled({ reason: "LOCKED" }),
    true,
    "(B2) LOCKED"
  );
  // Case-insensitive.
  assert.strictEqual(
    isSignalClaimAlreadyHandled({ reason: "already_consumed" }),
    true,
    "(B3) lowercase normalized"
  );
  // Whitespace.
  assert.strictEqual(
    isSignalClaimAlreadyHandled({ reason: "  LOCKED  " }),
    true,
    "(B4) trim"
  );
  // Other reasons → false.
  assert.strictEqual(
    isSignalClaimAlreadyHandled({ reason: "CLAIM_FAILED" }),
    false,
    "(B5) CLAIM_FAILED → false"
  );
  assert.strictEqual(
    isSignalClaimAlreadyHandled({ reason: "OK" }),
    false,
    "(B6) OK → false"
  );
  // Empty / null result.
  assert.strictEqual(
    isSignalClaimAlreadyHandled({}),
    false,
    "(B7) empty result → false"
  );
  assert.strictEqual(
    isSignalClaimAlreadyHandled(null),
    false,
    "(B8) null result → false"
  );
})();

// ── (C) paperBinanceRunner internal binding ───────────────────
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(C1) paperBinanceRunner still loads after signalClaimHelpers extraction");
})();

console.log("SIGNAL_CLAIM_HELPERS_TEST_OK");
