"use strict";

const env = require("../config/env");
const { runAiAllocation } = require("../services/aiAllocation");
const { getMultiExchangesSettings } = require("../utils/exchangeSettings");

let lastAiAutoCheckMs = 0;

function autoAiAllocationEnabled() {
  return env.auto.aiAllocation === true;
}

function autoAiAllocationCheckMs() {
  const v = Number(env.auto.aiAllocationCheckMs || 12 * 60 * 60 * 1000);
  return Number.isFinite(v) && v > 0 ? v : 12 * 60 * 60 * 1000;
}

async function maybeAutoAiAllocation() {
  if (!autoAiAllocationEnabled()) return { ok: true, skipped: true, reason: "DISABLED" };
  const nowMs = Date.now();
  const throttleMs = autoAiAllocationCheckMs();
  if (Number.isFinite(throttleMs) && nowMs - lastAiAutoCheckMs < throttleMs) {
    return { ok: true, skipped: true, reason: "THROTTLED" };
  }
  lastAiAutoCheckMs = nowMs;

  try {
    const multi = await getMultiExchangesSettings(3000);
    const exchanges = Array.isArray(multi && multi.exchanges) ? multi.exchanges : [];
    const providers = exchanges
      .filter((x) => x && x.enabled !== false)
      .map((x) => String(x.provider || "").toUpperCase())
      .filter(Boolean);
    if (!providers.length) {
      const out = await runAiAllocation({ apply: true });
      return { ok: true, result: out };
    }
    const results = [];
    for (const provider of providers) {
      const out = await runAiAllocation({ apply: true, provider });
      results.push({ provider, ...out });
    }
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

module.exports = {
  autoAiAllocationEnabled,
  autoAiAllocationCheckMs,
  maybeAutoAiAllocation,
};
