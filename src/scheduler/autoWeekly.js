"use strict";

const env = require("../config/env");
const { getFirestore } = require("../storage/firestore");
const { isoWeek } = require("../utils/overall");
const { defaultMarketsFromEnv, normalizeTf } = require("../utils/marketConfig");
const { pickTf } = require("./marketRunner");
const { postJson } = require("./helpers");
const { evalDocId, matchesEvalTf } = require("../utils/evalDoc");

let lastWeeklyAutoCheckMs = 0;

function autoWeeklyEnabled() {
  return env.auto.weeklyClose === true;
}

function weeklyWindowBounds() {
  const winMin = Number(env.auto.weeklyCloseWindowMin || 5);
  const winMax = Number(env.auto.weeklyCloseWindowMax || 25);
  return { winMin, winMax };
}

function isWeeklyWindow(nowMs) {
  const { winMin, winMax } = weeklyWindowBounds();
  const kstMs = nowMs + 9 * 60 * 60 * 1000;
  const k = new Date(kstMs);
  const day = k.getUTCDay();
  const hour = k.getUTCHours();
  const min = k.getUTCMinutes();
  return day === 1 && hour === 0 && min >= winMin && min <= winMax;
}

function computeWeeklyRangeUtcISO(nowMs = Date.now()) {
  const kstMs = nowMs + 9 * 60 * 60 * 1000;
  const k = new Date(kstMs);

  const y = k.getUTCFullYear();
  const m = k.getUTCMonth();
  const d = k.getUTCDate();
  const dow = k.getUTCDay();
  const delta = (dow + 6) % 7; // days since Monday

  const startKst = new Date(Date.UTC(y, m, d - delta, 0, 0, 0, 0));
  const endKst = new Date(Date.UTC(y, m, d - delta + 7, 0, 0, 0, 0));

  const startUtcMs = startKst.getTime() - 9 * 60 * 60 * 1000;
  const endUtcMs = endKst.getTime() - 9 * 60 * 60 * 1000;

  return { from: new Date(startUtcMs).toISOString(), to: new Date(endUtcMs).toISOString() };
}

async function maybeAutoWeeklyClose({ exchanges }) {
  if (!autoWeeklyEnabled()) return { ok: true, skipped: true, reason: "DISABLED" };
  const nowMs = Date.now();
  const throttleMs = Number(env.auto.weeklyCloseCheckMs || 60 * 60 * 1000);
  if (Number.isFinite(throttleMs) && nowMs - lastWeeklyAutoCheckMs < throttleMs) {
    return { ok: true, skipped: true, reason: "THROTTLED" };
  }
  lastWeeklyAutoCheckMs = nowMs;

  if (!isWeeklyWindow(nowMs)) return { ok: true, skipped: true, reason: "OUTSIDE_WINDOW" };

  const token = String(env.scheduler.token || "");
  if (!token) return { ok: false, skipped: true, reason: "NO_SCHEDULER_TOKEN" };

  const baseUrl = String(env.baseUrl || "http://localhost:3000");
  const refMs = nowMs - 24 * 60 * 60 * 1000;
  const week = isoWeek(new Date(refMs + 9 * 60 * 60 * 1000));
  const range = computeWeeklyRangeUtcISO(refMs);

  const db = getFirestore();
  const results = [];
  for (const exCfg of exchanges || []) {
    const exId = String(exCfg.provider || "BINANCEFUT").toUpperCase();
    const tf = normalizeTf((exCfg && exCfg.exec_tf) || pickTf({ stateTf: "15m", tfAllowlist: exCfg && exCfg.tf_allowlist })) || "15m";
    const evalId = evalDocId(exId, week);
    const snap = await db.collection("eval_weekly").doc(evalId).get();
    if (snap.exists && matchesEvalTf((snap.data() || {}), tf)) {
      results.push({ exchange: exId, skipped: true, reason: "ALREADY_DONE" });
      continue;
    }
    const markets = Array.isArray(exCfg.markets) && exCfg.markets.length
      ? exCfg.markets
      : defaultMarketsFromEnv(exId);
    const r = await postJson(`${baseUrl}/scheduler/weekly-close`, token, {
      from: range.from,
      to: range.to,
      exchange: exId,
      tf,
      markets,
    });
    results.push({ exchange: exId, ok: r.ok, status: r.status });
  }

  return { ok: true, week, range, results };
}

module.exports = {
  autoWeeklyEnabled,
  weeklyWindowBounds,
  isWeeklyWindow,
  computeWeeklyRangeUtcISO,
  maybeAutoWeeklyClose,
};
