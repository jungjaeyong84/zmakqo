"use strict";

// 2026-04-29 P1-1.7 — seventh stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Three Binance margin-type helpers that historically lived
// inline in paperBinanceRunner.js (lines 3175, 3181, 3193):
//
//   normalizeFuturesMarginType                 — "CROSSED"|"ISOLATED" or fallback
//   isBinanceMultiAssetsIsolatedMarginBlocked  — recognise the
//                                                Binance -4168
//                                                "Multi-Assets mode
//                                                blocks ISOLATED" error
//   isBinanceMarginTypeOpenOrdersConflict      — recognise the
//                                                Binance -4067
//                                                "open orders block
//                                                margin-type change"
//                                                error
//
// Pure functions: string + error-shape inspection. No I/O, no
// async, no module-level state. Self-contained call graph
// (isBinanceMultiAssetsIsolatedMarginBlocked → normalizeFuturesMarginType).
//
// Why this group is the next safe cohesive unit after P1-1.6:
//   - Tightest semantic cohesion of any candidate left at this
//     extraction tier — all three answer questions about Binance
//     futures margin-type normalisation/error recognition.
//   - Already covered by
//     src/tests/margin-type-multi-assets-fallback.test.js
//     (lines 5-8) via the runner's __test surface. That
//     integration test continues to pass unchanged because the
//     runner re-exports the SAME function references (no fork).
//   - The two error-recognition predicates encode pre-existing
//     contracts with the Binance API error envelope (numeric code
//     -4168 / -4067 + body substring fallback). Pinning those
//     contracts in a named module makes a future "Binance API
//     error model" consolidation easier to audit.

// normalizeFuturesMarginType — coerce raw string to one of
// "CROSSED" | "ISOLATED"; fall back to caller-provided default
// (default "ISOLATED") otherwise.
function normalizeFuturesMarginType(raw, fallback = "ISOLATED") {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "CROSSED" || v === "ISOLATED") return v;
  return fallback;
}

// isBinanceMultiAssetsIsolatedMarginBlocked — true iff the error
// is Binance's "Multi-Assets mode blocks switching to ISOLATED"
// signal (numeric code -4168, or the canonical English message
// embedded in body/message). Only meaningful when caller intended
// ISOLATED; for any other margin type returns false.
function isBinanceMultiAssetsIsolatedMarginBlocked(err, marginType) {
  const type = normalizeFuturesMarginType(marginType, "");
  if (type !== "ISOLATED") return false;
  const code = Number(err && err.code);
  const body = String(err && err.body || "");
  const msg = String(err && err.message || err || "");
  const combined = `${msg} ${body}`;
  if (Number.isFinite(code) && code === -4168) return true;
  if (combined.includes("-4168")) return true;
  return /Unable to adjust to isolated-margin mode under the Multi-Assets mode/i.test(combined);
}

// isBinanceMarginTypeOpenOrdersConflict — true iff the error is
// Binance's "cannot change margin type while open orders exist"
// signal (numeric code -4067, or substring fallback).
function isBinanceMarginTypeOpenOrdersConflict(err) {
  const code = Number(err && err.code);
  const body = String(err && err.body || "");
  const msg = String(err && err.message || err || "");
  const combined = `${msg} ${body}`;
  if (Number.isFinite(code) && code === -4067) return true;
  if (combined.includes("-4067")) return true;
  return /cannot be changed if there exists open orders/i.test(combined)
    || /open orders/i.test(combined);
}

module.exports = {
  normalizeFuturesMarginType,
  isBinanceMultiAssetsIsolatedMarginBlocked,
  isBinanceMarginTypeOpenOrdersConflict,
};
