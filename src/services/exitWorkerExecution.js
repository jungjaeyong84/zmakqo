"use strict";

function buildExitWorkerTimeoutResult({
  timeoutMs = null,
  startedAt = null,
  finishedAt = null,
  reason = null,
  chainDepth = null,
} = {}) {
  return {
    ok: false,
    error: "EXIT_WORKER_EXEC_TIMEOUT",
    reason: String(reason || "EXIT_WORKER_EXEC_TIMEOUT"),
    timeout_ms: Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : null,
    started_at: startedAt || null,
    finished_at: finishedAt || null,
    chain_depth: Number.isFinite(Number(chainDepth)) ? Number(chainDepth) : null,
  };
}

async function runExitWorkerExecution({
  payload = {},
  state,
  runBurst,
  timeoutMs,
  nowIso = () => new Date().toISOString(),
  onTimeout = null,
} = {}) {
  if (!state || typeof state !== "object") throw new Error("EXIT_WORKER_STATE_REQUIRED");
  if (typeof runBurst !== "function") throw new Error("EXIT_WORKER_RUNNER_REQUIRED");

  const startedAt = nowIso();
  const resolvedTimeoutMs = Math.max(1000, Number(timeoutMs) || 70000);
  const chainDepth = Math.max(0, Math.floor(Number(payload && payload.chain_depth || 0)));
  const reason = String(payload && payload.reason || "MANUAL");

  state.lastExecuteAt = startedAt;
  state.lastFinishedAt = null;
  state.inFlight = {
    started_at: startedAt,
    reason,
    chain_depth: chainDepth,
    timeout_ms: resolvedTimeoutMs,
  };

  let timer = null;
  const task = Promise.resolve().then(() => runBurst());
  task.catch(() => {});

  try {
    const result = await Promise.race([
      task,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          const timeoutResult = buildExitWorkerTimeoutResult({
            timeoutMs: resolvedTimeoutMs,
            startedAt,
            finishedAt: nowIso(),
            reason,
            chainDepth,
          });
          if (typeof onTimeout === "function") {
            try { onTimeout(timeoutResult); } catch (_) {}
          }
          resolve(timeoutResult);
        }, resolvedTimeoutMs);
      }),
    ]);
    state.lastResult = result && typeof result === "object"
      ? {
          ...result,
          started_at: startedAt,
          finished_at: nowIso(),
        }
      : {
          ok: false,
          error: "EXIT_WORKER_EMPTY_RESULT",
          started_at: startedAt,
          finished_at: nowIso(),
        };
    return state.lastResult;
  } catch (e) {
    state.lastResult = {
      ok: false,
      error: e && e.message ? e.message : String(e),
      started_at: startedAt,
      finished_at: nowIso(),
      chain_depth: chainDepth,
      reason,
    };
    return state.lastResult;
  } finally {
    if (timer) clearTimeout(timer);
    state.lastFinishedAt = nowIso();
    state.inFlight = null;
  }
}

module.exports = {
  runExitWorkerExecution,
  __test: {
    buildExitWorkerTimeoutResult,
  },
};
