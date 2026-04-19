"use strict";

// 2026-04-19: transient-Firestore retry helper for the BE-raise path (and
// anywhere else that makes cross-region Firestore calls from a
// long-running Cloud Run instance).
//
// Motivation: production observed two BE-raise decision logs with
// `decision_stage: ERROR` within ~1 hour on the same BTCUSDT SHORT
// position:
//
//   2026-04-18T19:20  10 ABORTED: cross-transaction contention
//   2026-04-18T20:17  14 UNAVAILABLE: TLS socket disconnected
//
// Both are **transient infrastructure errors** — the Firestore client
// SDK is designed to survive these (ABORTED is a normal outcome of
// optimistic concurrency; UNAVAILABLE on a stale connection is a clean
// reconnect case). The BE-raise caller had no retry, so a transient
// blip dropped the BE stop raise entirely and left the position at its
// original SL for an extra tick cycle.
//
// This helper isolates the retry policy in one place with a deliberately
// narrow scope:
//
//   * retries ONLY transient gRPC codes 4 (DEADLINE_EXCEEDED), 10
//     (ABORTED), 14 (UNAVAILABLE). All other errors propagate
//     unchanged — no silent swallow of business logic failures.
//   * caller must supply an idempotent `fn` — we document that the
//     function will be invoked up to N times.
//   * records attempt count + terminal gRPC code on the thrown error
//     so callers can surface `firestore_retry_attempts` in logs.
//   * opt-out via env flag `FIRESTORE_TRANSIENT_RETRY_ENABLED=0` for
//     emergency kill-switch without redeploy.

// gRPC status codes that Firestore raises for *transient* infrastructure
// failures. Keeping the set explicit and narrow — INVALID_ARGUMENT,
// PERMISSION_DENIED, NOT_FOUND etc are NOT included and will pass
// through without retry. See
// https://grpc.github.io/grpc/core/md_doc_statuscodes.html
const TRANSIENT_GRPC_CODES = new Set([4, 10, 14]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /\b10 ABORTED\b/i,
  /cross-transaction contention/i,
  /\b14 UNAVAILABLE\b/i,
  /No connection established/i,
  /TLS connection was (?:terminated|established)/i,
  /socket disconnected/i,
  /\b4 DEADLINE_EXCEEDED\b/i,
  /deadline exceeded/i,
];

function boolEnv(name, fallback) {
  const raw = String(process.env[name] == null ? "" : process.env[name]).trim().toLowerCase();
  if (raw === "") return fallback;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  return fallback;
}

function resolveRetryEnabled() {
  return boolEnv("FIRESTORE_TRANSIENT_RETRY_ENABLED", true);
}

// Classify an error as a transient-Firestore failure worth retrying.
//
// The Firestore SDK sometimes exposes `err.code` as a number (gRPC int
// code); sometimes the code lives on a wrapped cause. We check both.
// We also match on message substrings as a fallback, because in some
// deployments the raw SDK error gets re-thrown with only the message
// preserved (e.g. through egress proxies).
function isTransientFirestoreError(err) {
  if (!err) return false;
  const numericCode = Number(err.code);
  if (Number.isFinite(numericCode) && TRANSIENT_GRPC_CODES.has(numericCode)) return true;
  if (err.cause && err.cause !== err) {
    if (isTransientFirestoreError(err.cause)) return true;
  }
  const msg = String(err.message || err || "");
  return TRANSIENT_MESSAGE_PATTERNS.some((rx) => rx.test(msg));
}

function extractGrpcCode(err) {
  if (!err) return null;
  const numeric = Number(err.code);
  if (Number.isFinite(numeric)) return numeric;
  if (err.cause && err.cause !== err) {
    const nested = extractGrpcCode(err.cause);
    if (nested != null) return nested;
  }
  const msg = String(err.message || "");
  const m = /\b(\d{1,2})\s+(ABORTED|UNAVAILABLE|DEADLINE_EXCEEDED)\b/i.exec(msg);
  return m ? Number(m[1]) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(Number(ms) || 0))));
}

// Deterministic-ish jittered backoff. Grows as 100, 300, 700, 1500ms
// with ±25% jitter so concurrent callers don't all wake up together on
// a clustered contention event.
function computeBackoffMs(attempt, baseDelayMs, rand = Math.random) {
  const base = Math.max(20, Math.floor(Number(baseDelayMs) || 100));
  const floor = base * (attempt - 1) * 2 + base; // 100, 300, 700, 1500...
  const jitterSpan = Math.floor(floor * 0.5);
  const jitter = Math.floor(rand() * jitterSpan) - Math.floor(jitterSpan / 2);
  return Math.max(0, floor + jitter);
}

// Retries `fn` on transient-Firestore errors. The caller is responsible
// for ensuring `fn` is idempotent. See module header for the gRPC
// code whitelist.
//
// On success: returns whatever `fn` returned. Attaches attempt count
// via `context.attempts` / `context.terminalCode` if `context` is
// supplied.
//
// On failure: throws the LAST error (preserving original type/message)
// but augments it with:
//   err.firestore_retry_attempts       — how many attempts were made
//   err.firestore_retry_terminal_code  — the last seen gRPC code
//   err.firestore_retry_exhausted      — true if we ran out of attempts
//   err.firestore_retry_transient      — true if the terminal error
//                                        matched the transient set
async function withTransientFirestoreRetry(fn, opts = {}) {
  if (typeof fn !== "function") {
    throw new TypeError("withTransientFirestoreRetry: fn must be a function");
  }
  const maxAttempts = Math.max(1, Math.floor(Number(opts.maxAttempts) || 3));
  const baseDelayMs = Math.max(20, Math.floor(Number(opts.baseDelayMs) || 120));
  const enabled = opts.enabled !== undefined ? Boolean(opts.enabled) : resolveRetryEnabled();
  const context = (opts.context && typeof opts.context === "object") ? opts.context : null;
  const rand = typeof opts.rand === "function" ? opts.rand : Math.random;
  const sleeper = typeof opts.sleep === "function" ? opts.sleep : sleep;

  const effectiveMax = enabled ? maxAttempts : 1;
  let lastErr = null;
  for (let attempt = 1; attempt <= effectiveMax; attempt += 1) {
    try {
      const result = await fn();
      if (context) {
        context.attempts = attempt;
        context.terminalCode = null;
        context.exhausted = false;
        context.transient = false;
      }
      return result;
    } catch (err) {
      lastErr = err;
      const transient = isTransientFirestoreError(err);
      const code = extractGrpcCode(err);
      if (context) {
        context.attempts = attempt;
        context.terminalCode = code;
        context.transient = transient;
        context.exhausted = attempt >= effectiveMax;
      }
      if (!transient || attempt >= effectiveMax) {
        if (err && typeof err === "object") {
          err.firestore_retry_attempts = attempt;
          err.firestore_retry_terminal_code = code;
          err.firestore_retry_exhausted = attempt >= effectiveMax;
          err.firestore_retry_transient = transient;
        }
        throw err;
      }
      await sleeper(computeBackoffMs(attempt, baseDelayMs, rand));
    }
  }
  // Should be unreachable — the loop either returns or throws.
  throw lastErr || new Error("withTransientFirestoreRetry: exhausted without error");
}

module.exports = {
  withTransientFirestoreRetry,
  isTransientFirestoreError,
  extractGrpcCode,
  computeBackoffMs,
  TRANSIENT_GRPC_CODES,
  __test: {
    resolveRetryEnabled,
    TRANSIENT_MESSAGE_PATTERNS,
  },
};
