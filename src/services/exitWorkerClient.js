"use strict";

const recentTriggerState = new Map();

function resolveExitWorkerUrl() {
  return String(process.env.EXIT_WORKER_URL || "").trim().replace(/\/+$/, "");
}

function normalizeTargetSymbols(targetSymbols = null) {
  const list = Array.isArray(targetSymbols)
    ? targetSymbols
    : (targetSymbols == null ? [] : [targetSymbols]);
  return Array.from(new Set(
    list
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function resolveExitWorkerTriggerToken() {
  return String(
    process.env.EXIT_WORKER_TRIGGER_TOKEN ||
    process.env.SCHEDULER_TOKEN ||
    process.env.EGRESS_PROXY_TOKEN ||
    ""
  ).trim();
}

function resolveTriggerCooldownMs(raw = null) {
  const fallback = 15000;
  const value = raw == null ? process.env.EXIT_WORKER_TRIGGER_COOLDOWN_MS : raw;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function buildTriggerCooldownKey(reason) {
  return String(reason || "UNSPECIFIED").trim().toUpperCase() || "UNSPECIFIED";
}

function isTriggerCooldownActive({ reason, now = Date.now(), cooldownMs = null } = {}) {
  const resolvedCooldownMs = resolveTriggerCooldownMs(cooldownMs);
  if (resolvedCooldownMs <= 0) {
    return { active: false, key: buildTriggerCooldownKey(reason), remainingMs: 0, cooldownMs: resolvedCooldownMs };
  }
  const key = buildTriggerCooldownKey(reason);
  const lastAt = Number(recentTriggerState.get(key));
  if (!Number.isFinite(lastAt)) {
    return { active: false, key, remainingMs: 0, cooldownMs: resolvedCooldownMs };
  }
  const remainingMs = resolvedCooldownMs - Math.max(0, now - lastAt);
  return {
    active: remainingMs > 0,
    key,
    remainingMs: Math.max(0, remainingMs),
    cooldownMs: resolvedCooldownMs,
  };
}

async function triggerExitWorkerRun({
  reason,
  dispatchOnly = true,
  timeoutMs = 5000,
  bypassCooldown = false,
  cooldownMs = null,
  targetSymbols = null,
  targetExchange = null,
} = {}) {
  const baseUrl = resolveExitWorkerUrl();
  if (!baseUrl) {
    return { ok: false, skipped: true, reason: "EXIT_WORKER_URL_MISSING" };
  }
  const token = resolveExitWorkerTriggerToken();
  if (!token) {
    return { ok: false, skipped: true, reason: "EXIT_WORKER_TRIGGER_TOKEN_MISSING" };
  }
  const resolvedReason = String(reason || "UNSPECIFIED").trim() || "UNSPECIFIED";
  const cooldown = isTriggerCooldownActive({
    reason: resolvedReason,
    cooldownMs,
  });
  if (bypassCooldown !== true && cooldown.active) {
    return {
      ok: true,
      skipped: true,
      dispatched: false,
      reason: "EXIT_WORKER_TRIGGER_COOLDOWN",
      cooldown_ms: cooldown.cooldownMs,
      cooldown_remaining_ms: cooldown.remainingMs,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 5000));
  const requestStartedAt = Date.now();
  const normalizedTargetSymbols = normalizeTargetSymbols(targetSymbols);
  const normalizedTargetExchange = String(targetExchange || "").trim().toUpperCase() || null;
  recentTriggerState.set(cooldown.key, requestStartedAt);
  try {
    const endpoint = dispatchOnly !== false ? "/run" : "/run-execute";
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-scheduler-token": token,
      },
      body: JSON.stringify({
        reason: resolvedReason,
        dispatch_only: dispatchOnly !== false,
        ...(normalizedTargetSymbols.length ? { target_symbols: normalizedTargetSymbols } : {}),
        ...(normalizedTargetExchange ? { target_exchange: normalizedTargetExchange } : {}),
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
    if (Number(recentTriggerState.get(cooldown.key)) === requestStartedAt) {
      recentTriggerState.delete(cooldown.key);
    }
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
    resolveTriggerCooldownMs,
    buildTriggerCooldownKey,
    isTriggerCooldownActive,
    normalizeTargetSymbols,
    clearTriggerCooldownState() {
      recentTriggerState.clear();
    },
  },
};
