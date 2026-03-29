const { fetchCandles } = require("../exchanges");
const { buildSignal } = require("../engine/signalEngine");
const { recordSignalIfNew } = require("../storage/signals");
const { loadPosition, applyFill } = require("../storage/positions");
const { saveBars } = require("../storage/bars");
const { paperFill } = require("../paper/paperBroker");
const { makeIntentFromSignal } = require("../engine/intentEngine");
const { getTradingConfig } = require("../config/trading");
const { defaultExecTfFromEnv, normalizeTf } = require("../utils/marketConfig");

/* __BAR_TIME_NORMALIZE_V2__ */

function __isoZ(x) {
  if (!x) return null;
  const t = String(x).trim();
  if (!t) return null;
  return t.endsWith("Z") ? t : (t + "Z");
}
function __toMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function normalizeBarsForGateV2(bars) {
  const out = [];
  for (const b of (bars || [])) {
    const closeIso = __isoZ(b.closeTimeUtc || b.t || b.closeTimeUtcIso || b.close_time_utc);
    const closeMs = (typeof b.closeTimeUtcMs === "number") ? b.closeTimeUtcMs : __toMs(closeIso);

    const o = (b.open !== undefined && b.open !== null) ? b.open : b.o;
    const h = (b.high !== undefined && b.high !== null) ? b.high : b.h;
    const l = (b.low  !== undefined && b.low  !== null) ? b.low  : b.l;
    const c = (b.close!== undefined && b.close!== null) ? b.close: b.c;
    const v = (b.volume!==undefined && b.volume!==null) ? b.volume: b.v;

    out.push({
      open: o, high: h, low: l, close: c, volume: v,
      closeTimeUtc: closeIso,
      closeTimeUtcMs: closeMs,
      t: closeIso, o, h, l, c, v
    });
  }
  return out;
}


/* __BAR_TIME_NORMALIZE_V1__ */
function _isoZ(x) {
  if (!x) return null;
  const t = String(x).trim();
  if (!t) return null;
  return t.endsWith("Z") ? t : (t + "Z");
}
function _toMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function normalizeBarsForGate(bars) {
  const out = [];
  for (const b of (bars || [])) {
    const closeIso = _isoZ(b.closeTimeUtc || b.t || b.closeTimeUtcIso || b.close_time_utc);
    const closeMs = (typeof b.closeTimeUtcMs === 'number') ? b.closeTimeUtcMs : _toMs(closeIso);

    // 변수 정의: open/high/low/close/volume 우선, 없으면 o/h/l/c/v 사용
    const o = (b.open !== undefined && b.open !== null) ? b.open : b.o;
    const h = (b.high !== undefined && b.high !== null) ? b.high : b.h;
    const l = (b.low  !== undefined && b.low  !== null) ? b.low  : b.l;
    const c = (b.close!== undefined && b.close!== null) ? b.close: b.c;
    const v = (b.volume!==undefined && b.volume!==null) ? b.volume: b.v;

    out.push({
      "open": o, "high": h, "low": l, "close": c, "volume": v,
      "closeTimeUtc": closeIso,
      "closeTimeUtcMs": closeMs,
      "t": closeIso, "o": o, "h": h, "l": l, "c": c, "v": v
    })
  }
  return out;
}


function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeBar(b) {
  if (!b || typeof b !== "object") return null;

  // Prefer canonical storage fields if present.
  const closeTimeUtc = b.closeTimeUtc || b.t || b.candle_date_time_utc || null;

  const open = b.open !== undefined ? toNumber(b.open) : (b.o !== undefined ? toNumber(b.o) : (b.opening_price !== undefined ? toNumber(b.opening_price) : null));
  const high = b.high !== undefined ? toNumber(b.high) : (b.h !== undefined ? toNumber(b.h) : (b.high_price !== undefined ? toNumber(b.high_price) : null));
  const low  = b.low  !== undefined ? toNumber(b.low)  : (b.l !== undefined ? toNumber(b.l) : (b.low_price  !== undefined ? toNumber(b.low_price)  : null));
  const close= b.close!== undefined ? toNumber(b.close): (b.c !== undefined ? toNumber(b.c) : (b.trade_price !== undefined ? toNumber(b.trade_price) : null));
  const volume = b.volume !== undefined ? toNumber(b.volume) : (b.v !== undefined ? toNumber(b.v) : (b.candle_acc_trade_volume !== undefined ? toNumber(b.candle_acc_trade_volume) : null));

  if (!closeTimeUtc || open === null || high === null || low === null || close === null) return null;

  // Provide both shapes (storage + TA points) to keep the rest of the codebase stable.
  return {
    closeTimeUtc,
    open,
    high,
    low,
    close,
    volume: volume === null ? 0 : volume,

    // legacy / indicator shape
    t: closeTimeUtc,
    o: open,
    h: high,
    l: low,
    c: close,
    v: volume === null ? 0 : volume
  };
}

function toPoint(b) {
  const tMs = Date.parse(b.closeTimeUtc || b.t);
  return {
    t: Number.isFinite(tMs) ? tMs : null,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    v: b.v
  };
}

async function runPaper(market, options = {}) {
  const exchange = options.exchange || "UPBIT";
  const tf = normalizeTf(options.tf || defaultExecTfFromEnv()) || "15m";
  const barsCount = options.barsCount || 5;

  const rawBars = await fetchCandles(exchange, market, tf, barsCount);
  const bars = (rawBars || []).map(normalizeBar).filter(Boolean);

  if (!bars || bars.length < 2) {
    return { ok: false, error: "NO_BARS", market, exchange, tf };
  }

  // Persist bars in storage shape
  await saveBars(market, bars);

  const last = bars[bars.length - 1];
  const lastCloseTimeUtcMs = Date.parse(last.closeTimeUtc || last.t);
  if (!Number.isFinite(lastCloseTimeUtcMs)) {
    return { ok: false, error: "BAD_BAR_TIME", market, exchange, tf };
  }

  const points = bars.map(toPoint).filter((p) => Number.isFinite(p.t));

  const config = getTradingConfig({ exchange, market, tf });

  const signal = buildSignal(market, points, config);
  const signalId = await recordSignalIfNew(signal);

  const position = await loadPosition({ exchange, symbol_or_pair_id: market });
  const intent = makeIntentFromSignal({ exchange, market, tf, signal, position, config });

  if (!intent) {
    return {
      ok: true,
      runId: options.runId || null,
      market,
      exchange,
      tf,
      lastCloseTimeUtcMs,
      signal: { id: signalId, event: signal.event, side: signal.side, qty_pct: signal.qty_pct },
      intent: null,
      fill: null
    };
  }

  const fill = await paperFill(intent, { market, bars, lastCloseTimeUtcMs });
  await applyFill(fill);

  return {
    ok: true,
    runId: options.runId || null,
    market,
    exchange,
    tf,
    lastCloseTimeUtcMs,
    signal: { id: signalId, event: signal.event, side: signal.side, qty_pct: signal.qty_pct },
    intent,
    fill
  };
}

async function runOnce(market, options = {}) {
  return runPaper(market, options);
}

module.exports = { runPaper, runOnce };
