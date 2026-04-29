"use strict";

// 2026-04-29 P1-1.12 — twelfth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Three pure helpers covering "wait + retry-eligibility for live
// infra errors":
//
//   sleepMs                    Promise<void> after `ms`
//                              (Number-coerced; non-positive →
//                              already resolved)
//   sleep                      alias of sleepMs (kept for callsite
//                              backwards-compat; runner has both
//                              names in use)
//   isRetryableLiveInfraError  classify whether an error is a
//                              transient infra failure that the
//                              caller should retry (egress proxy
//                              timeout, fetch failed, ECONN*,
//                              503/500-class messages)
//
// Pure functions: setTimeout-promise wrapper + string inspection.
// No I/O beyond the timer, no async loops, no module-level state.
// The runner used to host them inline at lines 1616, 1622, 1626.
//
// AUDIT-SIGNIFICANT: `sleepMs` has TWO sibling copies elsewhere
// in the codebase (audited 2026-04-29 by grep):
//
//   src/services/aiSignalGuard.js:35
//   src/services/newsFetch.js:45
//
// Both sibling bodies are byte-identical to this version. They
// will be migrated to import from this canonical module in
// follow-up audit-driven sub-steps. Same pattern as P1-1.4
// (channelList) and P1-1.10 (openClawCohort).
//
// `isRetryableLiveInfraError` has no siblings (verified). It is
// exported via paperBinanceRunner.__test and exercised by
// src/tests/live-execution-runtime-guards.test.js — that
// integration test continues to pass after extraction because
// the runner re-exports the SAME function reference (no fork).

// sleepMs — wait `ms` milliseconds and resolve. Non-finite or
// non-positive `ms` resolves immediately (no zero-timer scheduled).
function sleepMs(ms) {
  const waitMs = Number(ms);
  if (!Number.isFinite(waitMs) || waitMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

// sleep — alias of sleepMs. Kept under both names because the
// runner's existing call sites mix both spellings (some retry
// loops use `sleep(ms)`, others use `sleepMs(ms)` for explicitness).
function sleep(ms) {
  return sleepMs(ms);
}

// isRetryableLiveInfraError — true iff the error looks like a
// transient infra fault the caller should retry. Recognizes
// (case-insensitive on code + message):
//   - EGRESS_PROXY_TIMEOUT, EGRESS_PROXY_FETCH_FAIL  (the
//     project's custom dispatcher error envelope)
//   - ETIMEDOUT, ECONNRESET, ECONNREFUSED, EAI_AGAIN  (Node
//     socket-level codes)
//   - "fetch failed", "timeout", "service unavailable",
//     "internal error", "try again"  (vendor message fragments)
// Anything else returns false; callers must treat as terminal.
//
// IMPORTANT: this function intentionally does NOT classify
// Binance/exchange API business errors (margin insufficient,
// price out of range, code -2010 etc.) as retryable — those are
// permanent rejections at the strategy/account layer.
function isRetryableLiveInfraError(err) {
  const code = String(err && err.code || "").trim().toUpperCase();
  const msg = String(err && err.message || err || "").trim().toUpperCase();
  if (code === "EGRESS_PROXY_TIMEOUT" || code === "EGRESS_PROXY_FETCH_FAIL") return true;
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EAI_AGAIN") return true;
  if (msg.includes("EGRESS_PROXY_TIMEOUT")) return true;
  if (msg.includes("EGRESS_PROXY_FETCH_FAIL")) return true;
  if (msg.includes("FETCH FAILED")) return true;
  if (msg.includes("TIMEOUT")) return true;
  if (msg.includes("ECONNRESET")) return true;
  if (msg.includes("ECONNREFUSED")) return true;
  if (msg.includes("SERVICE UNAVAILABLE")) return true;
  if (msg.includes("INTERNAL ERROR")) return true;
  if (msg.includes("TRY AGAIN")) return true;
  return false;
}

module.exports = {
  sleepMs,
  sleep,
  isRetryableLiveInfraError,
};
