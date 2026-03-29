"use strict";

const { fetchBarCloseTime } = require("../utils/barTimeFetch");

async function __sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function __fetchBarCloseMsFromPrimaryExchange(market) {
  const result = await fetchBarCloseTime({ exchange: "BINANCEFUT", market: String(market), retries: 3, delayMs: 600 });
  if (result.success) {
    return { ms: result.ms, iso: result.iso, n: result.n };
  }
  throw result.error || new Error(result.errorMessage || "BINANCEFUT_CANDLE_FETCH_FAIL");
}

function nowUtcMs() {
  return Date.now();
}

function clamp(num, min, max) {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeIntervalMs(sec, fallbackMs) {
  const n = clamp(sec, 10, 3600);
  if (!Number.isFinite(n)) return fallbackMs;
  return Math.max(10_000, Math.trunc(n * 1000));
}

function __msFromGateMetrics(g) {
  if (!g) return null;
  const m = g.metrics || {};
  return (typeof m.bar_close_time_utc_ms === "number") ? m.bar_close_time_utc_ms : null;
}

function __isoFromGateMetrics(g) {
  if (!g) return null;
  const m = g.metrics || {};
  return (typeof m.bar_close_time_utc === "string") ? m.bar_close_time_utc : null;
}

function __isoZ(x) {
  if (x == null) return null;
  const t = String(x).trim();
  if (!t) return null;
  return t.endsWith("Z") ? t : (t + "Z");
}

function __toMsIso(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function __barCloseMsFromBars(bars) {
  if (!bars || !bars.length) return null;
  const b = bars[bars.length - 1];
  if (typeof b.closeTimeUtcMs === "number") return b.closeTimeUtcMs;
  if (typeof b.bar_close_time_utc_ms === "number") return b.bar_close_time_utc_ms;
  const iso =
    __isoZ(b.closeTimeUtc || b.t || b.bar_close_time_utc) ||
    __isoZ(b.candle_date_time_utc) ||
    __isoZ(b.candle_date_time_kst);
  return __toMsIso(iso);
}

function __barCloseIsoFromBars(bars) {
  if (!bars || !bars.length) return null;
  const b = bars[bars.length - 1];
  const iso =
    __isoZ(b.closeTimeUtc || b.t || b.bar_close_time_utc) ||
    __isoZ(b.candle_date_time_utc) ||
    __isoZ(b.candle_date_time_kst);
  return iso;
}

async function postJson(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-scheduler-token": token,
    },
    body: JSON.stringify(body || {}),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

function parseTimeMs(x) {
  if (x == null) return null;
  const n = Number(x);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(String(x));
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  __sleep,
  __fetchBarCloseMsFromUpbit: __fetchBarCloseMsFromPrimaryExchange,
  __fetchBarCloseMsFromPrimaryExchange,
  nowUtcMs,
  clamp,
  normalizeIntervalMs,
  __msFromGateMetrics,
  __isoFromGateMetrics,
  __isoZ,
  __toMsIso,
  __barCloseMsFromBars,
  __barCloseIsoFromBars,
  postJson,
  parseTimeMs,
};
