// src/storage/gate.js
//
// Purpose
// - Provide a stable gate result per market/timeframe including bar close time.
// - Scheduler relies on gate.metrics.bar_close_time_utc_ms to determine new_bar / actor_allowed.
//
// Notes
// - Upbit candle API returns newest-first.
// - We treat "too many requests" or other fetch failures as FAIL_SOFT (not HARD), so the
//   system can keep running and you can see the reason in metrics.error.

const { fetchCandles } = require("../exchanges");
const { defaultMarketsFromEnv, tfToMs, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { isKrxMarketOpenKst } = require("../utils/krxCalendar");

function isoZ(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.endsWith("Z") ? t : `${t}Z`;
}

function toMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function newestBarCloseIso(bars) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  // 최신 바는 마지막 인덱스 (bars는 오래된 것부터 정렬됨)
  const b = bars[bars.length - 1];
  return isoZ(b.closeTimeUtc || b.t || b.bar_close_time_utc || (b.raw && b.raw.candle_date_time_utc));
}

function normalizeGate(g) {
  const gate = g && typeof g === "object" ? g : {};
  const status = String(gate.status || "FAIL").toUpperCase();
  const severity = String(gate.severity || (status === "PASS" ? "NONE" : "HARD")).toUpperCase();
  const reasonCodes = Array.isArray(gate.reasonCodes) ? gate.reasonCodes : [];
  const metrics = gate.metrics && typeof gate.metrics === "object" ? gate.metrics : {};
  const ok = gate.ok === true && status === "PASS";
  const stable_enough = gate.stable_enough === true;
  const lag_ok = gate.lag_ok === true;

  return {
    gate_version: gate.gate_version || "v0.2.3",
    status,
    severity,
    reasonCodes,
    metrics,
    ok,
    stable_enough,
    lag_ok,
    overall_status: gate.overall_status || (status === "PASS" ? "PASS" : severity === "SOFT" ? "FAIL_SOFT" : "FAIL_HARD"),
  };
}

function getGateStatus(bars, opts = {}) {
  const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
  const maxLagMs = Number.isFinite(Number(opts.maxLagMs)) ? Number(opts.maxLagMs) : 6 * 60 * 1000;
  const minStableBars = Number.isFinite(Number(opts.minStableBars)) ? Number(opts.minStableBars) : 1;
  const market = opts.market ? String(opts.market) : null;
  const tf = opts.tf ? String(opts.tf) : String(defaultExecTfFromEnv() || "15m");
  const exchange = opts.exchange ? String(opts.exchange).trim().toUpperCase() : null;

  const closeIso = newestBarCloseIso(bars);
  const closeMs = toMs(closeIso);

  const metrics = {
    n: Array.isArray(bars) ? bars.length : 0,
    fetched: !!opts.fetched,
    market,
    tf,
    now_utc_ms: nowMs,
    maxLagMs,
    bar_close_time_utc_ms: closeMs,
    bar_close_time_utc: closeIso,
  };

  const reasonCodes = [];
  let status = "PASS";
  let severity = "NONE";

  if (!Array.isArray(bars) || bars.length === 0 || !Number.isFinite(closeMs)) {
    status = "FAIL";
    severity = "HARD";
    reasonCodes.push("NO_BARS");
    return normalizeGate({ status, severity, reasonCodes, metrics, ok: false, stable_enough: false, lag_ok: false });
  }

  const lagMs = nowMs - closeMs;
  metrics.lagMs = lagMs;
  metrics.lag_ms = lagMs;

  const stableEnough = bars.length >= minStableBars;
  let lagOk = lagMs <= maxLagMs;
  if (exchange === "KIWOOM") {
    const krxOpen = isKrxMarketOpenKst(nowMs);
    metrics.krx_market_open = krxOpen;
    if (!krxOpen) {
      lagOk = true;
      metrics.lag_ignored = true;
    }
  }

  if (!stableEnough) {
    status = "FAIL";
    severity = "SOFT";
    reasonCodes.push("NOT_STABLE_ENOUGH");
  }
  if (!lagOk) {
    status = "FAIL";
    severity = "SOFT";
    reasonCodes.push("BAR_LAG_TOO_HIGH");
  }

  // Interval check: TF-aware gap detection (15m vs 60m etc.)
  if (Array.isArray(bars) && bars.length >= 2) {
    const prev = bars[bars.length - 2];
    const prevIso = prev && (prev.closeTimeUtc || prev.t || prev.bar_close_time_utc || (prev.raw && prev.raw.candle_date_time_utc));
    const prevMs = Number.isFinite(prev?.closeTimeUtcMs) ? prev.closeTimeUtcMs : toMs(prevIso);
    const expectedMs = tfToMs(tf);

    metrics.interval_expected_ms = Number.isFinite(expectedMs) ? expectedMs : null;
    metrics.interval_actual_ms = (Number.isFinite(closeMs) && Number.isFinite(prevMs)) ? (closeMs - prevMs) : null;

    if (Number.isFinite(expectedMs) && Number.isFinite(prevMs) && Number.isFinite(closeMs)) {
      const dt = closeMs - prevMs;
      const toleranceMs = Number.isFinite(Number(opts.intervalToleranceMs))
        ? Number(opts.intervalToleranceMs)
        : Math.max(1000, Math.round(expectedMs * 0.1)); // 10% or 1s

      const tooSmall = dt < (expectedMs - toleranceMs);
      const tooLarge = dt > (expectedMs + toleranceMs);

      if (tooSmall || tooLarge) {
        metrics.interval_ok = false;
        // Allow session gaps for KIWOOM (stock market closed hours)
        const isSessionGap = (exchange === "KIWOOM") && dt > expectedMs * 2;
        if (isSessionGap) {
          metrics.session_gap = true;
          reasonCodes.push("SESSION_GAP");
        } else {
          status = "FAIL";
          severity = "SOFT";
          reasonCodes.push("BAR_INTERVAL_MISMATCH");
        }
      } else {
        metrics.interval_ok = true;
      }
    }
  }

  return normalizeGate({
    status,
    severity,
    reasonCodes,
    metrics,
    ok: status === "PASS",
    stable_enough: stableEnough,
    lag_ok: lagOk,
  });
}

async function getGateStatusAsync(ctxOrBars, opts = {}) {
  // Supports either a "ctx" object or direct bars array.
  if (Array.isArray(ctxOrBars)) {
    return getGateStatus(ctxOrBars, opts);
  }

  const ctx = ctxOrBars && typeof ctxOrBars === "object" ? ctxOrBars : {};
  const fallbackMarkets = defaultMarketsFromEnv();
  const market = ctx.market ? String(ctx.market) : String(opts.market || fallbackMarkets[0] || "KRW-BTC");
  const tf = ctx.tf ? String(ctx.tf) : String(opts.tf || defaultExecTfFromEnv() || "15m");
  const nowMs = Number.isFinite(Number(ctx.nowMs)) ? Number(ctx.nowMs) : Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
  const count = Number.isFinite(Number(ctx.count)) ? Number(ctx.count) : Number.isFinite(Number(opts.count)) ? Number(opts.count) : 2;

  try {
    const raw = await fetchCandles(opts.exchange || "UPBIT", market, tf, Math.max(2, count));
    // raw candles already contain candle_date_time_utc and timestamp; map to a stable bar shape.
    const bars = (raw || []).map((c) => {
      const closeIso = c && c.candle_date_time_utc ? `${c.candle_date_time_utc}Z` : null;
      const closeMs = c && typeof c.timestamp === "number" ? c.timestamp : toMs(closeIso);
      return {
        open: c.opening_price,
        high: c.high_price,
        low: c.low_price,
        close: c.trade_price,
        volume: c.candle_acc_trade_volume,
        closeTimeUtc: closeIso,
        closeTimeUtcMs: closeMs,
        raw: c,
      };
    });

    return getGateStatus(bars, {
      ...opts,
      market,
      tf,
      nowMs,
      fetched: true,
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    // Prefer SOFT so the loop survives rate limits.
    return normalizeGate({
      status: "FAIL",
      severity: "SOFT",
      reasonCodes: ["RATE_LIMIT_OR_FETCH_FAIL"],
      metrics: { error: msg, market, tf, now_utc_ms: nowMs },
      ok: false,
      stable_enough: false,
      lag_ok: false,
      overall_status: "FAIL_SOFT",
    });
  }
}

// Compatibility aliases used by older code.
const getGate = getGateStatus;
const computeGate = getGateStatus;

module.exports = {
  normalizeGate,
  getGateStatus,
  getGateStatusAsync,
  getGate,
  computeGate,
};
