const crypto = require("crypto");

// ─────────────────────────────────────────────────────────────────────────────
// Dedicated undici Agent for the egress-proxy client.
//
// 2026-04-19 RCA (revised): exit-worker (minScale=1 long-running container)
// accumulated half-open TCP connections in Node's undici keep-alive pool.
// Cloud Run's ingress LB kills idle connections without sending a TCP FIN,
// so the client-side pool keeps reusing dead sockets — new writes
// succeed-looking but the response never arrives, and fetch() just aborts
// at the per-request 20s AbortController timeout.  Symptom: only one action
// (the most frequently called — `fetchBinanceFuturesAccount`) would
// visibly fail, while the egress-private server logs showed no record of
// the request.  Restart "fixed" it for ~3h until the pool decayed again.
//
// 2026-04-19 root-cause-of-root-cause: the prior fix (PR#18) attempted
// to install a custom undici `Agent`, but **`undici` was never declared
// as a direct dependency** in `package.json`.  Node 20+ bundles undici
// for `globalThis.fetch` but does NOT expose `require("undici")` — the
// module is only reachable if installed explicitly.  Thus on the
// deployed `exit-worker` the `require("undici")` throws
// `MODULE_NOT_FOUND`, the code silently falls back to `globalThis.fetch`,
// and **none** of the keep-alive / header-timeout / retry-pool-reset
// logic takes effect.  The symptom continued unabated — the fix only
// looked applied in code review.
//
// Mitigation (this module, layered):
//   1. `undici` is now a first-class dependency (package.json). A failed
//      `require("undici")` is treated as a fatal configuration error and
//      logged at ERROR level so CI log-sweeps / monitoring catch the
//      regression instead of it silently degrading to the global pool.
//   2. Dedicated `Agent` with short `keepAliveTimeout` (1s) so connections
//      rarely get reused across the 30s+ idle gap between calls.
//   3. Explicit `headersTimeout` / `bodyTimeout` inside undici so a dead
//      socket fails within ~5s (well under the 20s AbortController budget)
//      and surfaces as a real fetch error, not as silent hang.
//   4. **Dispatcher reset on transient failure**: before each retry we
//      `close()` the current Agent and lazily rebuild it on the next
//      request.  This is the only way to guarantee the retry doesn't draw
//      from the same half-open pool — undici cannot detect FIN-less dead
//      sockets until first write, so reusing the pool means the retry
//      rolls the dice again.
//
// The `EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER=1` escape hatch remains for
// test harnesses only.  In production it should be unset (or "0").
// ─────────────────────────────────────────────────────────────────────────────
let _undiciDispatcherCache = null;
let _undiciDispatcherTried = false;
let _undiciRequireFatalLogged = false;

function getEgressDispatcher() {
  if (_undiciDispatcherTried) return _undiciDispatcherCache;
  _undiciDispatcherTried = true;
  if (String(process.env.EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER || "0") === "1") {
    return null;
  }
  try {
    // eslint-disable-next-line global-require
    const { Agent } = require("undici");
    const keepAliveMs = (() => {
      const raw = Number(process.env.EGRESS_PROXY_KEEP_ALIVE_MS);
      if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
      return 1000;
    })();
    const headersTimeoutMs = (() => {
      const raw = Number(process.env.EGRESS_PROXY_HEADERS_TIMEOUT_MS);
      if (Number.isFinite(raw) && raw >= 1000) return Math.floor(raw);
      return 5000;
    })();
    const bodyTimeoutMs = (() => {
      const raw = Number(process.env.EGRESS_PROXY_BODY_TIMEOUT_MS);
      if (Number.isFinite(raw) && raw >= 1000) return Math.floor(raw);
      return 15000;
    })();
    _undiciDispatcherCache = new Agent({
      keepAliveTimeout: keepAliveMs,
      keepAliveMaxTimeout: Math.max(keepAliveMs, 1000),
      headersTimeout: headersTimeoutMs,
      bodyTimeout: bodyTimeoutMs,
      connect: { timeout: 5000 },
    });
    return _undiciDispatcherCache;
  } catch (err) {
    // undici not resolvable.  In production this means the half-open
    // mitigation is NOT active and every fetch() uses the default global
    // pool — the exact failure mode the mitigation was built to prevent.
    // Surface at ERROR level with a distinctive marker so CI/alerting can
    // catch the regression.  We log only once per process to avoid
    // flooding logs, and still return null (preserving the test-harness
    // fallback) — but operators should treat this log as a blocker.
    if (!_undiciRequireFatalLogged) {
      _undiciRequireFatalLogged = true;
      try {
        console.error("[egress][DISPATCHER_UNAVAILABLE_FATAL]", {
          message: err && err.message ? err.message : String(err),
          code: err && err.code ? err.code : null,
          hint: "undici must be declared in package.json dependencies; "
              + "Node's built-in fetch does NOT expose require(\"undici\"). "
              + "Without this dispatcher, half-open TCP sockets in the "
              + "keep-alive pool cause silent 20s timeouts on exit-worker.",
        });
      } catch (_) {}
    }
    _undiciDispatcherCache = null;
    return null;
  }
}

// Reset the dispatcher so the next getEgressDispatcher() call rebuilds a
// fresh Agent with an empty connection pool.  Called between retry
// attempts when the previous attempt hit a transient transport failure —
// undici cannot detect a half-open TCP socket until first write, so the
// only way to guarantee the retry doesn't reuse the same dead socket is
// to tear down the pool entirely.  We `close()` gracefully (finishes
// in-flight requests, then ends idle sockets) with a short fallback to
// `destroy()` if close isn't available.  Best-effort — a failure here
// must not block the retry itself.
async function closeEgressDispatcher() {
  const current = _undiciDispatcherCache;
  _undiciDispatcherCache = null;
  _undiciDispatcherTried = false;
  if (!current) return;
  try {
    if (typeof current.close === "function") {
      await current.close();
    } else if (typeof current.destroy === "function") {
      await current.destroy();
    }
  } catch (_) {
    // Swallow — the dispatcher is already replaced in the cache slot;
    // leaking a zombie Agent is preferable to throwing on the retry path.
  }
}

function isTransientEgressFetchError(error) {
  if (!error || typeof error !== "object") return false;
  const code = String(error.code || "");
  if (code === "EGRESS_PROXY_TIMEOUT") return true;
  if (code === "EGRESS_PROXY_FETCH_FAIL") return true;
  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("econnreset")) return true;
  if (msg.includes("socket hang up")) return true;
  if (msg.includes("other side closed")) return true;
  if (msg.includes("headers timeout")) return true;
  if (msg.includes("body timeout")) return true;
  return false;
}

const BINANCE_PRIVATE_ACTIONS = new Set([
  "fetchBinanceFuturesAccount",
  "fetchFuturesOpenOrders",
  "fetchFuturesAlgoOpenOrders",
  "fetchFuturesPositionMode",
  "fetchBinanceWalletDeposits",
  "fetchBinanceWalletWithdrawals",
  "fetchBinanceWalletTransfers",
  "placeFuturesMarketOrder",
  "placeFuturesLimitOrder",
  "cancelFuturesOrder",
  "fetchFuturesAlgoOrder",
  "placeFuturesStopMarketOrder",
  "placeFuturesTakeProfitMarketOrder",
  "cancelFuturesOpenOrders",
  "fetchFuturesOrder",
  "fetchFuturesUserTrades",
  "fetchFuturesIncomeHistory",
  "setFuturesLeverage",
  "setFuturesMarginType",
]);

const DEFAULT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.EGRESS_PROXY_TIMEOUT_MS || 10000);
  if (Number.isFinite(raw) && raw >= 1000) return Math.floor(raw);
  return 10000;
})();

const EGRESS_VERBOSE_SUCCESS_LOGS = String(process.env.EGRESS_PROXY_VERBOSE_SUCCESS_LOGS || "0") === "1";
const EGRESS_SUMMARY_INTERVAL_MS = (() => {
  const raw = Number(process.env.EGRESS_PROXY_SUMMARY_INTERVAL_MS || 60000);
  if (Number.isFinite(raw) && raw >= 10000) return Math.floor(raw);
  return 60000;
})();
const egressClientSummary = new Map();

/* ── egress 요청 추적용 request_id 생성 ── */
function buildEgressRequestId() {
  const ms = Date.now();
  const rnd = crypto.randomBytes(4).toString("hex");
  return `EGR__${ms}__${rnd}`;
}

function shouldUseEgressProxy() {
  const mode = String(process.env.EGRESS_PROXY_MODE || "").trim().toLowerCase();
  const url = String(process.env.EGRESS_PROXY_URL || "").trim();
  return mode === "client" && !!url;
}

function resolveEgressBaseUrl() {
  return String(process.env.EGRESS_PROXY_URL || "").trim().replace(/\/+$/, "");
}

function shouldUsePrivateBinanceEgress(provider, action) {
  const prov = String(provider || "").trim().toLowerCase();
  const act = String(action || "").trim();
  if (prov !== "binancefut") return false;
  if (!BINANCE_PRIVATE_ACTIONS.has(act)) return false;
  const privateUrl = String(
    process.env.EGRESS_PROXY_BINANCE_PRIVATE_URL
      || process.env.EGRESS_PROXY_PRIVATE_URL
      || ""
  ).trim();
  return !!privateUrl;
}

function resolveEgressBaseUrlFor(provider, action) {
  if (shouldUsePrivateBinanceEgress(provider, action)) {
    return String(
      process.env.EGRESS_PROXY_BINANCE_PRIVATE_URL
        || process.env.EGRESS_PROXY_PRIVATE_URL
        || ""
    ).trim().replace(/\/+$/, "");
  }
  return resolveEgressBaseUrl();
}

function resolveEgressToken() {
  return String(process.env.EGRESS_PROXY_TOKEN || process.env.SCHEDULER_TOKEN || "").trim();
}

function egressSummaryKey(provider, action) {
  return `${String(provider || "").trim().toLowerCase()}::${String(action || "").trim()}`;
}

function flushEgressSummary(key, bucket, now) {
  if (!bucket) return;
  const provider = String(bucket.provider || "").trim().toLowerCase();
  const action = String(bucket.action || "").trim();
  console.log("[egress][SUMMARY]", {
    role: "client",
    provider,
    action,
    success: bucket.success || 0,
    started_at: new Date(bucket.startedAt || now).toISOString(),
    ended_at: new Date(now).toISOString(),
    window_ms: now - (bucket.startedAt || now),
  });
  egressClientSummary.set(key, {
    provider,
    action,
    success: 0,
    startedAt: now,
  });
}

function noteEgressClientSuccess(provider, action) {
  const now = Date.now();
  const key = egressSummaryKey(provider, action);
  const bucket = egressClientSummary.get(key) || {
    provider,
    action,
    success: 0,
    startedAt: now,
  };
  bucket.success += 1;
  if ((now - bucket.startedAt) >= EGRESS_SUMMARY_INTERVAL_MS) {
    flushEgressSummary(key, bucket, now);
    return;
  }
  egressClientSummary.set(key, bucket);
}

async function callEgressProxyOnce({
  base,
  prov,
  action,
  payload,
  token,
  timeoutMsFinal,
  requestId,
  attempt,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMsFinal);
  try {
    let res = null;
    try {
      const fetchOpts = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-egress-token": token,
          "x-egress-request-id": requestId,
        },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal,
      };
      const dispatcher = getEgressDispatcher();
      if (dispatcher) fetchOpts.dispatcher = dispatcher;
      res = await fetch(`${base}/egress/${prov}`, fetchOpts);
    } catch (fetchErr) {
      const msg = String(fetchErr && fetchErr.message ? fetchErr.message : fetchErr);
      const abortLike = msg === "This operation was aborted" || String(fetchErr && fetchErr.name || "") === "AbortError";
      const err = new Error(
        abortLike
          ? `EGRESS_PROXY_TIMEOUT provider=${prov} action=${action} request_id=${requestId} timeout_ms=${timeoutMsFinal} attempt=${attempt}`
          : `EGRESS_PROXY_FETCH_FAIL provider=${prov} action=${action} request_id=${requestId} msg=${msg} attempt=${attempt}`
      );
      err.code = abortLike ? "EGRESS_PROXY_TIMEOUT" : "EGRESS_PROXY_FETCH_FAIL";
      err.requestId = requestId;
      err.provider = prov;
      err.action = action;
      err.timeoutMs = timeoutMsFinal;
      err.attempt = attempt;
      err.cause = fetchErr;
      throw err;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* noop */ }
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || text || `EGRESS_HTTP_${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = text;
      err.requestId = requestId;
      err.provider = prov;
      err.action = action;
      err.attempt = attempt;
      // HTTP status errors are NOT transient-retryable here — they indicate
      // a server-reachable failure (auth rejection, payload error, 5xx from
      // upstream).  The caller can retry at its layer if appropriate, but we
      // don't spin on the same request inside this module.
      console.error("[egress][RESPONSE_ERROR]", {
        request_id: requestId,
        provider: prov,
        action,
        status: res.status,
        message: msg,
      });
      throw err;
    }
    if (json && json.ok === false) {
      const msg = json.message || json.error || "EGRESS_ERROR";
      const err = new Error(msg);
      err.status = json.status || 500;
      err.body = json;
      err.requestId = requestId;
      err.provider = prov;
      err.action = action;
      err.attempt = attempt;
      console.error("[egress][LOGIC_ERROR]", { request_id: requestId, provider: prov, action, message: msg });
      throw err;
    }
    return { json, res };
  } finally {
    clearTimeout(timeout);
  }
}

async function callEgressProxy({ provider, action, payload, timeoutMs, maxAttempts } = {}) {
  const requestIdRoot = buildEgressRequestId();
  const base = resolveEgressBaseUrlFor(provider, action);
  if (!base) throw new Error("EGRESS_PROXY_URL_MISSING");
  const prov = String(provider || "").trim().toLowerCase();
  if (!prov) throw new Error("EGRESS_PROXY_PROVIDER_REQUIRED");
  const token = resolveEgressToken();
  if (!token) throw new Error("EGRESS_PROXY_TOKEN_MISSING");

  if (EGRESS_VERBOSE_SUCCESS_LOGS) {
    console.log("[egress][REQUEST]", { request_id: requestIdRoot, provider: prov, action });
  }

  const timeoutMsFinal = (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) >= 1000)
    ? Math.floor(Number(timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  // Single retry on transient transport failures. The retry uses a fresh
  // request_id so Cloud Logging can correlate each attempt independently
  // (a retry that succeeds on attempt 2 otherwise looks like a phantom
  // success in the server logs without a matching client timeout trail).
  const totalAttempts = (() => {
    const raw = Number(maxAttempts);
    if (Number.isFinite(raw) && raw >= 1 && raw <= 5) return Math.floor(raw);
    const envRaw = Number(process.env.EGRESS_PROXY_MAX_ATTEMPTS);
    if (Number.isFinite(envRaw) && envRaw >= 1 && envRaw <= 5) return Math.floor(envRaw);
    return 2;
  })();

  let lastError = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const requestId = attempt === 1
      ? requestIdRoot
      : `${requestIdRoot}__retry${attempt}`;
    try {
      const { json } = await callEgressProxyOnce({
        base,
        prov,
        action,
        payload,
        token,
        timeoutMsFinal,
        requestId,
        attempt,
      });
      if (EGRESS_VERBOSE_SUCCESS_LOGS) {
        console.log("[egress][RESPONSE_OK]", {
          request_id: requestId,
          provider: prov,
          action,
          attempt,
          server_request_id: json && json.request_id,
        });
      } else {
        noteEgressClientSuccess(prov, action);
      }
      if (attempt > 1) {
        // Surface recovery for ops observability — previous-attempt failure
        // already logged from the catch branch.
        console.warn("[egress][RETRY_RECOVERED]", {
          provider: prov,
          action,
          request_id: requestId,
          attempt,
          total_attempts: totalAttempts,
        });
      }
      if (json && Object.prototype.hasOwnProperty.call(json, "data")) return json.data;
      return json;
    } catch (err) {
      lastError = err;
      const transient = isTransientEgressFetchError(err);
      // Log each transport failure so the retry trail is visible.
      // Non-transient failures (HTTP status / logic) already logged inside
      // `callEgressProxyOnce`; don't double-log them.
      if (transient) {
        console.error("[egress][RESPONSE_ERROR]", {
          request_id: err.requestId,
          provider: prov,
          action,
          message: err.message,
          code: err.code,
          attempt,
          transient: true,
        });
      }
      if (!transient || attempt >= totalAttempts) break;
      // Before the next attempt, tear down the dispatcher so the retry
      // draws from a fresh connection pool.  undici cannot detect
      // half-open TCP sockets (Cloud Run LB kills idle connections
      // without FIN) until first write, so reusing the same pool means
      // the retry can roll the dice against the same dead socket that
      // just failed.  Closing here guarantees a clean slate.
      try {
        await closeEgressDispatcher();
      } catch (_) { /* best-effort */ }
    }
  }
  throw lastError;
}

module.exports = {
  shouldUseEgressProxy,
  callEgressProxy,
  buildEgressRequestId,
  shouldUsePrivateBinanceEgress,
  resolveEgressBaseUrlFor,
  __test: {
    isTransientEgressFetchError,
    getEgressDispatcher,
    closeEgressDispatcher,
  },
};
