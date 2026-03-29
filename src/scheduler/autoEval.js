"use strict";

const env = require("../config/env");
const { getFirestore } = require("../storage/firestore");
const { defaultMarketsFromEnv, normalizeTf } = require("../utils/marketConfig");
const { pickTf } = require("./marketRunner");
const { postJson } = require("./helpers");
const { evalLatestId, matchesEvalTf } = require("../utils/evalDoc");

let lastEvalAutoCheckMs = 0;

function autoEvalEnabled() {
  return env.auto.evalLatest === true;
}

function autoEvalCheckMs() {
  const v = Number(env.auto.evalLatestCheckMs || 6 * 60 * 60 * 1000);
  return Number.isFinite(v) && v > 0 ? v : 6 * 60 * 60 * 1000;
}

function autoEvalMaxAgeMs() {
  const v = Number(env.auto.evalLatestMaxAgeMs || 24 * 60 * 60 * 1000);
  return Number.isFinite(v) && v > 0 ? v : 24 * 60 * 60 * 1000;
}

function isFreshEvalLatestForTf(data, targetTf, nowMs, maxAgeMs) {
  if (!matchesEvalTf(data, targetTf)) return false;
  const genMs = Date.parse(String(data && (data.generated_at || data.created_at) || ""));
  if (!Number.isFinite(genMs)) return false;
  return (nowMs - genMs) < maxAgeMs;
}

async function maybeAutoEvalLatest({ exchanges }) {
  if (!autoEvalEnabled()) return { ok: true, skipped: true, reason: "DISABLED" };
  const nowMs = Date.now();
  const throttleMs = autoEvalCheckMs();
  if (Number.isFinite(throttleMs) && nowMs - lastEvalAutoCheckMs < throttleMs) {
    return { ok: true, skipped: true, reason: "THROTTLED" };
  }
  lastEvalAutoCheckMs = nowMs;

  const token = String(env.scheduler.token || "");
  if (!token) return { ok: false, skipped: true, reason: "NO_SCHEDULER_TOKEN" };

  const baseUrl = String(env.baseUrl || "http://localhost:3000");
  const maxAgeMs = autoEvalMaxAgeMs();
  const db = getFirestore();
  const results = [];

  for (const exCfg of exchanges || []) {
    const exId = String(exCfg.provider || "BINANCEFUT").toUpperCase();
    const targetTf = normalizeTf((exCfg && exCfg.exec_tf) || pickTf({ stateTf: "15m", tfAllowlist: exCfg && exCfg.tf_allowlist })) || "15m";
    const latestId = evalLatestId(exId);
    const latest = await db.collection("eval_latest").doc(latestId).get();
    if (latest.exists) {
      const data = latest.data() || {};
      if (isFreshEvalLatestForTf(data, targetTf, nowMs, maxAgeMs)) {
        results.push({ exchange: exId, skipped: true, reason: "FRESH" });
        continue;
      }
    }

    const tf = targetTf;
    const markets = Array.isArray(exCfg.markets) && exCfg.markets.length
      ? exCfg.markets
      : defaultMarketsFromEnv(exId);
    const r = await postJson(`${baseUrl}/scheduler/eval-weekly`, token, {
      exchange: exId,
      tf,
      markets,
    });
    results.push({ exchange: exId, ok: r.ok, status: r.status });
  }

  return { ok: true, results };
}

module.exports = {
  autoEvalEnabled,
  autoEvalCheckMs,
  autoEvalMaxAgeMs,
  maybeAutoEvalLatest,
  __test: {
    isFreshEvalLatestForTf,
  },
};
