// src/quality/gate.js
// Data Quality Gate (UTC 안전 파싱 + gate_version + severity)

const GATE_VERSION = "v0.2.0";

function parseTimeMs(v) {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    const hasTz = /Z$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s);
    const normalized = hasTz ? s : s + "Z";
    const t = Date.parse(normalized);
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

// reason_codes를 HARD/SOFT로 분류
function classifySeverity(reasonCodes) {
  const hardSet = new Set([
    "NO_BARS",
    "BAR_TIME_PARSE_FAIL",
    "PREV_BAR_TIME_PARSE_FAIL",
    "TIME_GAP_NOT_60M",
    "OHLC_HIGH_INVALID",
    "OHLC_LOW_INVALID",
    "OHLC_RANGE_INVALID",
  ]);

  // lag는 환경/지연에 의해 흔해져서 SOFT로 둔다.
  // (필요하면 나중에 정책으로 HARD 승격 가능)
  const softSet = new Set(["BAR_LAG_TOO_HIGH"]);

  let hasHard = false;
  let hasSoft = false;

  for (const r of reasonCodes || []) {
    if (hardSet.has(r)) hasHard = true;
    else if (softSet.has(r)) hasSoft = true;
    else hasHard = true; // 정의 밖 코드는 HARD로 취급
  }

  if (hasHard) return "HARD";
  if (hasSoft) return "SOFT";
  return "NONE";
}

/**
 * bars: [{ open, high, low, close, volume, closeTimeUtc }]
 */
function validateBars(
  bars,
  { expectedIntervalMs = 60 * 60 * 1000, maxLagMs = 15 * 60 * 1000 } = {}
) {
  const reasonCodes = [];
  const metrics = {};

  if (!Array.isArray(bars) || bars.length < 1) {
    reasonCodes.push("NO_BARS");
    return { gate_version: GATE_VERSION, status: "FAIL", severity: "HARD", reasonCodes, metrics };
  }

  const last = bars[bars.length - 1];

  // OHLC 모순 체크
  const o = Number(last.open);
  const h = Number(last.high);
  const l = Number(last.low);
  const c = Number(last.close);

  if (!(h >= Math.max(o, c))) reasonCodes.push("OHLC_HIGH_INVALID");
  if (!(l <= Math.min(o, c))) reasonCodes.push("OHLC_LOW_INVALID");
  if (!(h >= l)) reasonCodes.push("OHLC_RANGE_INVALID");

  // 시간 파싱 (UTC 안전)
  const lastMs = parseTimeMs(last.closeTimeUtc);
  metrics.bar_close_time_utc_ms = lastMs;

  if (!Number.isFinite(lastMs)) {
    reasonCodes.push("BAR_TIME_PARSE_FAIL");
    return { gate_version: GATE_VERSION, status: "FAIL", severity: "HARD", reasonCodes, metrics };
  }

  // 연속성(최근 2봉)
  if (bars.length >= 2) {
    const prev = bars[bars.length - 2];
    const prevMs = parseTimeMs(prev.closeTimeUtc);
    metrics.prev_bar_close_time_utc_ms = prevMs;

    if (!Number.isFinite(prevMs)) {
      reasonCodes.push("PREV_BAR_TIME_PARSE_FAIL");
    } else {
      const dt = lastMs - prevMs;
      metrics.interval_ms = dt;
      if (dt !== expectedIntervalMs) reasonCodes.push("TIME_GAP_NOT_60M");
    }
  }

  // 최신봉 지연
  const lag = Date.now() - lastMs;
  metrics.lag_ms = lag;
  if (lag > maxLagMs) reasonCodes.push("BAR_LAG_TOO_HIGH");

  const status = reasonCodes.length > 0 ? "FAIL" : "PASS";
  const severity = status === "PASS" ? "NONE" : classifySeverity(reasonCodes);

  return { gate_version: GATE_VERSION, status, severity, reasonCodes, metrics };
}

module.exports = { validateBars };
