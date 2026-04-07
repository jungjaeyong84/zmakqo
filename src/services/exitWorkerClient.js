"use strict";

function resolveExitWorkerUrl() {
  return String(process.env.EXIT_WORKER_URL || "").trim().replace(/\/+$/, "");
}

function resolveExitWorkerTriggerToken() {
  return String(
    process.env.EXIT_WORKER_TRIGGER_TOKEN ||
    process.env.SCHEDULER_TOKEN ||
    process.env.EGRESS_PROXY_TOKEN ||
    ""
  ).trim();
}

async function triggerExitWorkerRun({ reason, dispatchOnly = true, timeoutMs = 5000 } = {}) {
  const baseUrl = resolveExitWorkerUrl();
  if (!baseUrl) {
    return { ok: false, skipped: true, reason: "EXIT_WORKER_URL_MISSING" };
  }
  const token = resolveExitWorkerTriggerToken();
  if (!token) {
    return { ok: false, skipped: true, reason: "EXIT_WORKER_TRIGGER_TOKEN_MISSING" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 5000));
  try {
    const res = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-scheduler-token": token,
      },
      body: JSON.stringify({
        reason: String(reason || "UNSPECIFIED"),
        dispatch_only: dispatchOnly !== false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* noop */ }
    if (!res.ok) {
      return {
        ok: false,
        skipped: true,
        reason: "EXIT_WORKER_TRIGGER_HTTP_FAIL",
        status: res.status,
        body: text.slice(0, 200),
      };
    }
    return { ok: true, dispatched: true, response: json || null };
  } catch (e) {
    return {
      ok: false,
      skipped: true,
      reason: "EXIT_WORKER_TRIGGER_FETCH_FAIL",
      error: e && e.message ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  triggerExitWorkerRun,
  __test: {
    resolveExitWorkerUrl,
    resolveExitWorkerTriggerToken,
  },
};
