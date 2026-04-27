"use strict";

// 2026-04-27 Stage K — global process crash handler regression contract.
//   - install is idempotent (safe under re-entry).
//   - uncaughtException + unhandledRejection both emit structured warns.
//   - emit failures are swallowed (surveillance never breaks the crash).
//   - exit code = 1 (Cloud Run restart loop preserved).
//   - graceful mode delays exit so pending I/O can flush; non-graceful
//     exits immediately.

const assert = require("assert");

const path = require.resolve("../utils/processCrashHandler");
delete require.cache[path];
const {
  installProcessCrashHandlers,
  __test,
} = require("../utils/processCrashHandler");

function fakeProc(initialEnv = {}) {
  const listeners = { uncaughtException: [], unhandledRejection: [] };
  const exitCalls = [];
  const proc = {
    env: { ...initialEnv },
    on(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    exit(code) {
      exitCalls.push(code);
    },
  };
  return { proc, listeners, exitCalls };
}

// (A) buildPayload — UNCAUGHT_EXCEPTION + stack + origin.
{
  const err = new Error("boom");
  err.code = "ECRASH";
  const payload = __test.buildPayload({
    kind: "UNCAUGHT_EXCEPTION",
    error: err,
    origin: "uncaughtException",
    observedAt: "2026-04-27T05:00:00.000Z",
  });
  assert.strictEqual(payload.event, "process_crash_handler");
  assert.strictEqual(payload.kind, "UNCAUGHT_EXCEPTION");
  assert.strictEqual(payload.origin, "uncaughtException");
  assert.strictEqual(payload.message, "boom");
  assert.strictEqual(payload.code, "ECRASH");
  assert.ok(typeof payload.stack === "string" && payload.stack.includes("boom"));
}

// (B) buildPayload — UNHANDLED_REJECTION 의 reason 이 string 이어도 안전.
{
  const payload = __test.buildPayload({
    kind: "UNHANDLED_REJECTION",
    error: { message: "string reason" },
    promiseInfo: "Promise",
  });
  assert.strictEqual(payload.kind, "UNHANDLED_REJECTION");
  assert.strictEqual(payload.message, "string reason");
  assert.strictEqual(payload.stack, null);
  assert.strictEqual(payload.promise_info, "Promise");
}

// (C) install 후 기록된 listener 가 정확히 1개씩 (idempotent 재호출 시 없음).
{
  const { proc, listeners } = fakeProc();
  const r1 = installProcessCrashHandlers({ proc, emit: () => {}, exit: () => {} });
  assert.strictEqual(r1.reason, "INSTALLED");
  assert.strictEqual(listeners.uncaughtException.length, 1);
  assert.strictEqual(listeners.unhandledRejection.length, 1);
  const r2 = installProcessCrashHandlers({ proc, emit: () => {}, exit: () => {} });
  assert.strictEqual(r2.reason, "ALREADY_INSTALLED");
  assert.strictEqual(listeners.uncaughtException.length, 1, "(C) idempotent — 재install 시 추가 listener 없음");
}

// (D) uncaughtException trigger 시 emit + exit(1) 호출 (graceful=false 즉시).
{
  const { proc, listeners, exitCalls } = fakeProc();
  const captured = [];
  installProcessCrashHandlers({
    proc,
    emit: (p) => captured.push(p),
    exit: (c) => exitCalls.push(c),
    graceful: false,
  });
  listeners.uncaughtException[0](new Error("crash from D"), "uncaughtException");
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].kind, "UNCAUGHT_EXCEPTION");
  assert.strictEqual(captured[0].message, "crash from D");
  assert.deepStrictEqual(exitCalls, [1]);
}

// (E) unhandledRejection trigger 시 emit + exit(1).
{
  const { proc, listeners, exitCalls } = fakeProc();
  const captured = [];
  installProcessCrashHandlers({
    proc,
    emit: (p) => captured.push(p),
    exit: (c) => exitCalls.push(c),
    graceful: false,
  });
  listeners.unhandledRejection[0](new Error("rejected"), { then() {} });
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].kind, "UNHANDLED_REJECTION");
  assert.strictEqual(captured[0].message, "rejected");
  assert.strictEqual(captured[0].promise_info, "Promise");
  assert.deepStrictEqual(exitCalls, [1]);
}

// (F) emit 이 throw 해도 trade flow 안 깨짐 (best-effort).
{
  const { proc, listeners, exitCalls } = fakeProc();
  installProcessCrashHandlers({
    proc,
    emit: () => { throw new Error("emit blew up"); },
    exit: (c) => exitCalls.push(c),
    graceful: false,
  });
  // Should not throw.
  listeners.uncaughtException[0](new Error("crash"), "uncaughtException");
  assert.deepStrictEqual(exitCalls, [1], "(F) emit throw 무시, exit 정상");
}

// (G) graceful 모드 — setTimeout 으로 exit 지연.
{
  const { proc, listeners, exitCalls } = fakeProc();
  const scheduled = [];
  installProcessCrashHandlers({
    proc,
    emit: () => {},
    exit: (c) => exitCalls.push(c),
    graceful: true,
    gracefulDelayMs: 50,
    setTimeoutFn: (fn, ms) => { scheduled.push(ms); fn(); return 0; },
  });
  listeners.uncaughtException[0](new Error("graceful crash"));
  assert.deepStrictEqual(scheduled, [50], "(G) setTimeout 50ms");
  assert.deepStrictEqual(exitCalls, [1]);
}

// (H) env DONBEOLJA_PROCESS_CRASH_GRACEFUL=0 → 즉시 exit.
{
  const { proc, listeners, exitCalls } = fakeProc({ DONBEOLJA_PROCESS_CRASH_GRACEFUL: "0" });
  const scheduled = [];
  installProcessCrashHandlers({
    proc,
    emit: () => {},
    exit: (c) => exitCalls.push(c),
    setTimeoutFn: (fn, ms) => { scheduled.push(ms); return 0; },
  });
  listeners.uncaughtException[0](new Error("immediate"));
  assert.deepStrictEqual(scheduled, [], "(H) graceful=0 → setTimeout 안 걸림");
  assert.deepStrictEqual(exitCalls, [1]);
}

console.log("PROCESS_CRASH_HANDLER_TEST_OK");
