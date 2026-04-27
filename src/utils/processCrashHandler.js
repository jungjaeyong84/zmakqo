"use strict";

// 2026-04-27 Stage K — senior audit caught SIGABRT 24x in 24h on prod
// without any structured root-cause log. Root cause: server.js never
// installed `uncaughtException` / `unhandledRejection` handlers, so any
// unhandled async error or sync throw fell through to Node's default
// abort path (signal 6) leaving Cloud Logging with empty textPayload.
//
// This module installs idempotent global handlers that:
//   1. emit a single-line structured warn with stack + cause so the next
//      crash surfaces the failing module/path,
//   2. give pending I/O a short grace period to flush,
//   3. exit with code 1 so Cloud Run's restart loop kicks in (the
//      previous SIGABRT path also restarted, so behavior is preserved
//      under the now-observable diagnostic).
//
// 안전 계약:
//   - 한 process 당 단일 install (idempotent flag).
//   - emit 자체가 throw 해도 propagation 안 시킴 (best-effort 로깅).
//   - 인수로 emit/exit/now 받아 testable.
//   - graceful 모드 default ON, env `DONBEOLJA_PROCESS_CRASH_GRACEFUL=0`
//     로 끄면 즉시 exit (testing 용).

const HANDLER_INSTALLED_KEY = "__donbeolja_process_crash_handler_installed_v1__";

function nowIso() {
  return new Date().toISOString();
}

function safeStack(error) {
  if (error && typeof error.stack === "string" && error.stack.length > 0) return error.stack;
  return null;
}

function safeMessage(error) {
  if (error && typeof error.message === "string" && error.message.length > 0) return error.message;
  if (error == null) return null;
  try { return String(error); } catch (_) { return null; }
}

function safeName(error) {
  if (error && typeof error.name === "string" && error.name.length > 0) return error.name;
  return null;
}

function safeCode(error) {
  if (error && typeof error.code === "string" && error.code.length > 0) return error.code;
  return null;
}

function buildPayload({ kind, error, origin, promiseInfo, observedAt }) {
  return {
    event: "process_crash_handler",
    kind,                      // UNCAUGHT_EXCEPTION | UNHANDLED_REJECTION
    origin: origin || null,    // node provides on uncaughtException
    name: safeName(error),
    code: safeCode(error),
    message: safeMessage(error),
    stack: safeStack(error),
    promise_info: promiseInfo || null,
    observed_at: observedAt || nowIso(),
  };
}

// Stage U — in-flight HTTP request tracker. The Stage K crash handler
// originally exited after a fixed 250ms grace window, but a senior
// audit pointed out that prod fetch() calls (egress proxy round-trips,
// Binance order placements) routinely run 200-1500ms — exiting at 250ms
// truncates an in-flight order ack and leaves an orphan exchange-side
// order with no DB record. The new tracker counts active fetch promises
// and waits up to `gracefulDrainTimeoutMs` (default 1500ms) for them to
// settle before forcing exit. Tracker is global, idempotent, and exits
// immediately if no work is in flight.
const ACTIVE_REQUESTS_KEY = "__donbeolja_inflight_requests__";

function getActiveRequestState(proc) {
  if (!proc[ACTIVE_REQUESTS_KEY]) {
    proc[ACTIVE_REQUESTS_KEY] = { count: 0 };
  }
  return proc[ACTIVE_REQUESTS_KEY];
}

function trackInFlightRequest(proc = process) {
  const state = getActiveRequestState(proc);
  state.count = (state.count || 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count = Math.max(0, (state.count || 0) - 1);
  };
}

function activeRequestCount(proc = process) {
  const state = getActiveRequestState(proc);
  return Number.isFinite(state.count) && state.count > 0 ? state.count : 0;
}

function drainInFlight({
  proc = process,
  drainTimeoutMs,
  pollIntervalMs = 50,
  setTimeoutFn = setTimeout,
} = {}) {
  return new Promise((resolve) => {
    const state = getActiveRequestState(proc);
    const startMs = Date.now();
    const tick = () => {
      const remaining = state.count || 0;
      if (remaining <= 0) {
        return resolve({ drained: true, waited_ms: Date.now() - startMs, remaining: 0 });
      }
      if (Date.now() - startMs >= drainTimeoutMs) {
        return resolve({ drained: false, waited_ms: Date.now() - startMs, remaining });
      }
      setTimeoutFn(tick, pollIntervalMs);
    };
    tick();
  });
}

function installProcessCrashHandlers({
  proc = process,
  emit = (payload) => {
    try { console.warn(JSON.stringify(payload)); } catch (_) { /* best-effort */ }
  },
  exit = (code) => {
    try { proc.exit(code); } catch (_) { /* best-effort */ }
  },
  graceful = String(proc.env.DONBEOLJA_PROCESS_CRASH_GRACEFUL || "1").trim() !== "0",
  gracefulDelayMs = 250,
  gracefulDrainTimeoutMs = Number(proc.env.DONBEOLJA_PROCESS_CRASH_DRAIN_TIMEOUT_MS) || 1500,
  setTimeoutFn = setTimeout,
} = {}) {
  if (proc[HANDLER_INSTALLED_KEY] === true) {
    return Object.freeze({ ok: true, reason: "ALREADY_INSTALLED" });
  }
  Object.defineProperty(proc, HANDLER_INSTALLED_KEY, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  const finalize = () => {
    try { exit(1); } catch (_) { /* swallow */ }
  };

  // Async-aware finalize: if there's in-flight work, wait up to
  // gracefulDrainTimeoutMs for it to settle before exiting.
  const finalizeWithDrain = async (kind) => {
    const inflight = activeRequestCount(proc);
    if (inflight <= 0) {
      // Nothing in flight — fall back to the original short-grace window
      // so existing tests that rely on graceful=false / explicit
      // gracefulDelayMs continue to behave the same.
      setTimeoutFn(finalize, gracefulDelayMs);
      return;
    }
    try {
      const drainResult = await drainInFlight({
        proc,
        drainTimeoutMs: gracefulDrainTimeoutMs,
        setTimeoutFn,
      });
      try {
        emit({
          event: "process_crash_handler_drain",
          kind,
          inflight_at_crash: inflight,
          drained: drainResult.drained,
          waited_ms: drainResult.waited_ms,
          remaining: drainResult.remaining,
          observed_at: nowIso(),
        });
      } catch (_) { /* swallow */ }
    } catch (_) { /* swallow */ }
    finalize();
  };

  proc.on("uncaughtException", (error, origin) => {
    try {
      emit(buildPayload({ kind: "UNCAUGHT_EXCEPTION", error, origin }));
    } catch (_) { /* surveillance must never throw */ }
    if (graceful) {
      finalizeWithDrain("UNCAUGHT_EXCEPTION");
    } else {
      finalize();
    }
  });

  proc.on("unhandledRejection", (reason, promise) => {
    try {
      emit(buildPayload({
        kind: "UNHANDLED_REJECTION",
        error: reason instanceof Error ? reason : { message: safeMessage(reason) },
        promiseInfo: promise && typeof promise === "object" ? "Promise" : null,
      }));
    } catch (_) { /* swallow */ }
    if (graceful) {
      finalizeWithDrain("UNHANDLED_REJECTION");
    } else {
      finalize();
    }
  });

  return Object.freeze({ ok: true, reason: "INSTALLED" });
}

module.exports = {
  installProcessCrashHandlers,
  trackInFlightRequest,
  activeRequestCount,
  drainInFlight,
  __test: {
    buildPayload,
    HANDLER_INSTALLED_KEY,
    ACTIVE_REQUESTS_KEY,
  },
};
