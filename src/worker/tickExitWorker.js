"use strict";

const http = require("http");
const env = require("../config/env");
const { runBinanceTickExitBurst } = require("../services/binanceTickExit");
const { runExitWorkerExecution } = require("../services/exitWorkerExecution");

const port = Number(process.env.PORT || env.port || 8080);
const state = {
  startedAt: new Date().toISOString(),
  lastDispatchAt: null,
  lastExecuteAt: null,
  lastFinishedAt: null,
  lastResult: null,
  inFlight: null,
};

function respondJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function resolveTriggerToken() {
  return String(
    process.env.EXIT_WORKER_TRIGGER_TOKEN ||
    process.env.SCHEDULER_TOKEN ||
    process.env.EGRESS_PROXY_TOKEN ||
    ""
  ).trim();
}

function isAuthorized(req) {
  const expected = resolveTriggerToken();
  if (!expected) return false;
  const token = String(req.headers["x-scheduler-token"] || req.headers["x-exit-worker-token"] || "").trim();
  return token === expected;
}

function resolveSelfUrl() {
  const explicit = String(process.env.EXIT_WORKER_SELF_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  return `http://127.0.0.1:${port}`;
}

async function dispatchSelfExecute(payload = {}) {
  const selfUrl = resolveSelfUrl();
  const token = resolveTriggerToken();
  if (!selfUrl || !token) return { ok: false, skipped: true, reason: "SELF_URL_OR_TOKEN_MISSING" };
  try {
    const promise = fetch(`${selfUrl}/run-execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-scheduler-token": token,
      },
      body: JSON.stringify(payload),
    });
    promise.catch((e) => {
      console.warn(`[WORKER] self dispatch failed: ${e && e.message ? e.message : String(e)}`);
    });
    return { ok: true, dispatched: true };
  } catch (e) {
    return { ok: false, skipped: true, reason: e && e.message ? e.message : String(e) };
  }
}

async function executeBurst(payload = {}) {
  const maxDurationMs = Number(process.env.EXIT_WORKER_BURST_MAX_MS || 55000);
  const result = await runExitWorkerExecution({
    payload,
    state,
    timeoutMs: Number(process.env.EXIT_WORKER_EXEC_TIMEOUT_MS || (maxDurationMs + 15000)),
    onTimeout: (timeoutResult) => {
      console.warn("[WORKER] execute burst timeout", timeoutResult);
    },
    runBurst: () => runBinanceTickExitBurst({
      maxDurationMs,
      maxIterations: Number(process.env.EXIT_WORKER_BURST_MAX_ITERATIONS || 20),
    }),
  });
  const chainDepth = Math.max(0, Math.floor(Number(payload.chain_depth || 0)));
  if (result && result.ok && result.reschedule_recommended === true && chainDepth < 100) {
    const dispatch = await dispatchSelfExecute({
      reason: String(payload.reason || "CONTINUE"),
      chain_depth: chainDepth + 1,
      parent_execute_at: state.lastExecuteAt,
    });
    if (dispatch && dispatch.ok) {
      result.self_dispatched = true;
      result.next_chain_depth = chainDepth + 1;
    }
  }
  return result;
}

const server = http.createServer((req, res) => {
  (async () => {
    const path = String(req.url || "/").split("?")[0];
    if (path === "/health" || path === "/") {
      respondJson(res, 200, {
        ok: true,
        service: "donbeolja-exit-worker",
        tick_exit_enabled: !!(env.tickExit && env.tickExit.enabled),
        started_at: state.startedAt,
        last_dispatch_at: state.lastDispatchAt,
        last_execute_at: state.lastExecuteAt,
        last_finished_at: state.lastFinishedAt,
        in_flight: state.inFlight,
        last_result: state.lastResult,
      });
      return;
    }

    if ((path === "/run" || path === "/run-execute") && req.method === "POST") {
      if (!isAuthorized(req)) {
        respondJson(res, 401, { ok: false, error: "UNAUTHORIZED" });
        return;
      }
      let payload = {};
      try {
        const raw = await readBody(req);
        payload = raw ? JSON.parse(raw) : {};
      } catch (e) {
        respondJson(res, 400, { ok: false, error: "BAD_BODY", message: e && e.message ? e.message : String(e) });
        return;
      }

      if (path === "/run") {
        state.lastDispatchAt = new Date().toISOString();
        const dispatch = await dispatchSelfExecute({
          reason: String(payload.reason || "MANUAL"),
          chain_depth: 0,
        });
        const status = dispatch && dispatch.ok ? 202 : 503;
        respondJson(res, status, {
          ok: dispatch && dispatch.ok === true,
          dispatched: dispatch && dispatch.dispatched === true,
          reason: payload.reason || "MANUAL",
          dispatch,
        });
        return;
      }

      const result = await executeBurst(payload || {});
      respondJson(res, 200, {
        ok: true,
        executed: true,
        result,
      });
      return;
    }

    respondJson(res, 404, { ok: false, error: "NOT_FOUND" });
  })().catch((e) => {
    respondJson(res, 500, { ok: false, error: "WORKER_RUNTIME_FAIL", message: e && e.message ? e.message : String(e) });
  });
});

server.listen(port, () => {
  console.log(`[WORKER] listening on :${port}`);
});

["SIGTERM", "SIGINT"].forEach((sig) => {
  process.on(sig, () => {
    console.log(`[WORKER] received ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
});
