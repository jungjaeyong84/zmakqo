"use strict";

const http = require("http");
const env = require("../config/env");
const { startBinanceTickExitLoop, stopBinanceTickExitLoop } = require("../services/binanceTickExit");

const port = Number(process.env.PORT || env.port || 8080);
const state = {
  startedAt: new Date().toISOString(),
  loop: null,
};

function respondJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function startLoop() {
  const result = startBinanceTickExitLoop();
  state.loop = result;
  if (result && result.ok) {
    console.log(`[WORKER] tick-exit loop started: ${JSON.stringify(result)}`);
    return;
  }
  console.warn(`[WORKER] tick-exit loop skipped: ${JSON.stringify(result)}`);
}

function stopLoop() {
  try {
    const result = stopBinanceTickExitLoop();
    console.log(`[WORKER] tick-exit loop stopped: ${JSON.stringify(result)}`);
  } catch (e) {
    console.warn(`[WORKER] tick-exit stop failed: ${e && e.message ? e.message : String(e)}`);
  }
}

const server = http.createServer((req, res) => {
  const path = String(req.url || "/").split("?")[0];
  if (path === "/health" || path === "/") {
    respondJson(res, 200, {
      ok: true,
      service: "donbeolja-exit-worker",
      tick_exit_enabled: !!(env.tickExit && env.tickExit.enabled),
      started_at: state.startedAt,
      loop: state.loop,
    });
    return;
  }
  respondJson(res, 404, { ok: false, error: "NOT_FOUND" });
});

server.listen(port, () => {
  console.log(`[WORKER] listening on :${port}`);
  startLoop();
});

["SIGTERM", "SIGINT"].forEach((sig) => {
  process.on(sig, () => {
    console.log(`[WORKER] received ${sig}, shutting down`);
    stopLoop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
});
