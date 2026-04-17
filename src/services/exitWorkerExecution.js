"use strict";

function normalizeExitWorkerTargetSymbols(targetSymbols = null) {
  const list = Array.isArray(targetSymbols)
    ? targetSymbols
    : (targetSymbols == null ? [] : [targetSymbols]);
  return Array.from(new Set(
    list
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function resolvePositiveInt(value, fallback, minValue = 1) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < minValue) return fallback;
  return Math.floor(num);
}

function resolveExitWorkerExecutionConfig({ payload = {}, env = process.env } = {}) {
  const targetSymbols = normalizeExitWorkerTargetSymbols(
    payload && (
      payload.target_symbols != null
        ? payload.target_symbols
        : payload.targetSymbols
    )
  );
  const targetMode = targetSymbols.length > 0;
  const targetSymbolCount = Math.max(1, targetSymbols.length);
  const targetDefaultMaxDurationMs = Math.min(120000, 45000 + ((targetSymbolCount - 1) * 15000));
  const targetDefaultTimeoutMs = Math.min(180000, targetDefaultMaxDurationMs + 30000);
  const maxDurationMs = targetMode
    ? resolvePositiveInt(
        env.EXIT_WORKER_TARGET_BURST_MAX_MS || env.EXIT_WORKER_BURST_TARGET_MAX_MS,
        targetDefaultMaxDurationMs,
        1000
      )
    : resolvePositiveInt(env.EXIT_WORKER_BURST_MAX_MS, 55000, 1000);
  const maxIterations = targetMode
    ? resolvePositiveInt(
        env.EXIT_WORKER_TARGET_BURST_MAX_ITERATIONS || env.EXIT_WORKER_BURST_TARGET_MAX_ITERATIONS,
        1
      )
    : resolvePositiveInt(env.EXIT_WORKER_BURST_MAX_ITERATIONS, 20);
  const timeoutMs = targetMode
    ? resolvePositiveInt(
        env.EXIT_WORKER_TARGET_EXEC_TIMEOUT_MS || env.EXIT_WORKER_EXEC_TARGET_TIMEOUT_MS,
        Math.max(targetDefaultTimeoutMs, maxDurationMs + 15000),
        1000
      )
    : resolvePositiveInt(
        env.EXIT_WORKER_EXEC_TIMEOUT_MS,
        maxDurationMs + 15000,
        1000
      );
  return {
    targetMode,
    targetSymbols,
    maxDurationMs,
    maxIterations,
    timeoutMs,
  };
}

function buildExitWorkerTimeoutResult({
  timeoutMs = null,
  startedAt = null,
  finishedAt = null,
  reason = null,
  chainDepth = null,
  targetMode = false,
  targetSymbols = [],
} = {}) {
  return {
    ok: false,
    error: "EXIT_WORKER_EXEC_TIMEOUT",
    reason: String(reason || "EXIT_WORKER_EXEC_TIMEOUT"),
    timeout_ms: Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : null,
    started_at: startedAt || null,
    finished_at: finishedAt || null,
    chain_depth: Number.isFinite(Number(chainDepth)) ? Number(chainDepth) : null,
    target_mode: targetMode === true,
    target_symbols: normalizeExitWorkerTargetSymbols(targetSymbols),
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
  const executionConfig = resolveExitWorkerExecutionConfig({ payload });

  state.lastExecuteAt = startedAt;
  state.lastFinishedAt = null;
  state.inFlight = {
    started_at: startedAt,
    reason,
    chain_depth: chainDepth,
    timeout_ms: resolvedTimeoutMs,
    target_mode: executionConfig.targetMode,
    target_symbols: executionConfig.targetSymbols,
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
            targetMode: executionConfig.targetMode,
            targetSymbols: executionConfig.targetSymbols,
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
          target_mode: executionConfig.targetMode,
          target_symbols: executionConfig.targetSymbols,
        }
      : {
          ok: false,
          error: "EXIT_WORKER_EMPTY_RESULT",
          started_at: startedAt,
          finished_at: nowIso(),
          target_mode: executionConfig.targetMode,
          target_symbols: executionConfig.targetSymbols,
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
      target_mode: executionConfig.targetMode,
      target_symbols: executionConfig.targetSymbols,
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
  resolveExitWorkerExecutionConfig,
  __test: {
    buildExitWorkerTimeoutResult,
    normalizeExitWorkerTargetSymbols,
    resolveExitWorkerExecutionConfig,
  },
};
