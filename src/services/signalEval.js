const { defaultExecTfFromEnv, tfToMs } = require("../utils/marketConfig");
// src/services/signalEval.js
// 신호(돈벌자 지표 포함) 성능 평가용 공통 로직

const { SIGNAL_EVAL_HORIZON_BARS, SIGNAL_EVAL_VERSION } = require("../config/frozen");
const { normalizeSide, deriveGroupSubtype } = require("./signalTaxonomy");
const { alignBarCloseMs } = require("../utils/alignBarCloseMs");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toMs(x) {
  const n = toNum(x);
  if (n !== null) return n;
  const s = String(x || "").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  let sum = 0;
  for (const x of arr) sum += x;
  return sum / arr.length;
}

function winRate(arr) {
  if (!arr || arr.length === 0) return 0;
  let wins = 0;
  for (const x of arr) if (x > 0) wins += 1;
  return wins / arr.length;
}

function buildCloseMap(barsSnapshots = []) {
  const map = new Map();
  for (const b of barsSnapshots) {
    const exchange = String(b.exchange || b.ex || "BINANCEFUT").toUpperCase();
    const symbol = String(b.symbol_or_pair_id || b.symbol || b.market || "UNKNOWN").trim();
    const tf = String(b.tf || defaultExecTfFromEnv() || "15m").trim();

    const ms = toMs(b.bar_close_time_utc_ms) ?? toMs(b.bar_close_time_utc);
    // bars_snapshots 스키마 호환
    // - legacy: { close } 또는 { ohlc: { close } }
    // - current: { ohlcv_json: { close } }
    const close =
      toNum(b.close) ??
      toNum(b?.ohlc?.close) ??
      toNum(b?.ohlcv_json?.close) ??
      toNum(b?.ohlcv?.close) ??
      toNum(b?.c);
    if (ms === null || close === null) continue;

    // Multi-market 안전: (exchange, symbol, tf, ms) 합성키 사용
    const key = `${exchange}__${symbol}__${tf}__${ms}`;
    // 동일 키 중복 시: 최신(대개 마지막)이 우선
    map.set(key, close);
    // 1ms 오프셋 허용(거래소별 time_close 표현 차이 대응)
    if (Number.isFinite(ms)) {
      const keyMinus = `${exchange}__${symbol}__${tf}__${ms - 1}`;
      const keyPlus = `${exchange}__${symbol}__${tf}__${ms + 1}`;
      if (!map.has(keyMinus)) map.set(keyMinus, close);
      if (!map.has(keyPlus)) map.set(keyPlus, close);
    }
  }
  return map;
}

/**
 * @param {Object} args
 * @param {Array<Object>} args.signals
 * @param {Array<Object>} args.barsSnapshots
 * @param {number} [args.horizonBars]
 * @param {number} [args.intervalMs]
 * @param {(sig: Object, meta: {side:string, group:string, subtype:string}) => string} args.groupKeyFn
 */
function computeSignalEval({
  signals = [],
  barsSnapshots = [],
  horizonBars = SIGNAL_EVAL_HORIZON_BARS,
  intervalMs = tfToMs(defaultExecTfFromEnv()) || (15 * 60 * 1000),
  groupKeyFn,
} = {}) {
  if (typeof groupKeyFn !== "function") throw new Error("groupKeyFn required");

  const closeMap = buildCloseMap(barsSnapshots);
  const diagnostics = {
    scanned_signals: Array.isArray(signals) ? signals.length : 0,
    closeMap_size: closeMap.size,
    match_ok: 0,
    match_nowClose_missing: 0,
    match_futClose_missing: 0,
  };

  const rawRows = [];
  for (const sig of signals) {
    const exchange = String(sig.exchange || "BINANCEFUT").toUpperCase();
    const symbol = String(sig.symbol_or_pair_id || sig.symbol || sig.market || "UNKNOWN").trim();
    const tf = String(sig.tf || defaultExecTfFromEnv() || "15m").trim();

    const event = String(sig.event || "").trim();
    const side = normalizeSide(sig.side || sig.action);

    const derived = deriveGroupSubtype(event);
    const group = String(sig.event_group || sig.group || derived.group);
    const subtype = String(sig.event_subtype || sig.subtype || derived.subtype);

    const rawBarCloseMs = toMs(sig.bar_close_time_utc_ms) ?? toMs(sig.bar_close_time_utc);
    const barCloseMs = alignBarCloseMs(exchange, tf, rawBarCloseMs);
    if (barCloseMs === null) continue;

    const keyNow = `${exchange}__${symbol}__${tf}__${barCloseMs}`;
    const futureMs = barCloseMs + horizonBars * intervalMs;
    const keyFuture = `${exchange}__${symbol}__${tf}__${futureMs}`;

    const nowClose = closeMap.get(keyNow);
    const futureClose = closeMap.get(keyFuture);

    if (nowClose === undefined || futureClose === undefined) {
      if (nowClose === undefined) diagnostics.match_nowClose_missing += 1;
      else if (futureClose === undefined) diagnostics.match_futClose_missing += 1;
      rawRows.push({
        exchange,
        symbol_or_pair_id: symbol,
        tf,
        side,
        event,
        group,
        subtype,
        bar_close_time_utc_ms: barCloseMs,
        horizon_bars: horizonBars,
        eval_ok: false,
        reason: "MISSING_CLOSE",
        missing_now_close: nowClose === undefined,
        missing_future_close: futureClose === undefined,
      });
      continue;
    }

    diagnostics.match_ok += 1;

    const ret = (futureClose - nowClose) / nowClose;
    const dir = side === "SELL" ? -1 : 1;
    const dirRet = ret * dir;

    const retPct = ret * 100;
    const dirRetPct = dirRet * 100;

    const key = groupKeyFn(sig, { side, group, subtype });

    rawRows.push({
      key,
      exchange,
      symbol_or_pair_id: symbol,
      tf,
      side,
      event,
      group,
      subtype,
      bar_close_time_utc_ms: barCloseMs,
      now_close: nowClose,
      future_close: futureClose,
      horizon_bars: horizonBars,
      ret_horizon_pct: Number(retPct.toFixed(6)),
      dir_ret_horizon_pct: Number(dirRetPct.toFixed(6)),
      win: dirRetPct > 0 ? 1 : 0,
      eval_ok: true,
    });
  }

  // deterministic sort
  rawRows.sort((a, b) => {
    const ta = toNum(a.bar_close_time_utc_ms) || 0;
    const tb = toNum(b.bar_close_time_utc_ms) || 0;
    if (ta !== tb) return ta - tb;
    return String(a.key || "").localeCompare(String(b.key || ""));
  });

  return {
    meta: {
      eval_version: SIGNAL_EVAL_VERSION,
      horizon_bars: horizonBars,
      interval_ms: intervalMs,
      created_at: new Date().toISOString(),
    },
    rawRows,
    diagnostics,
  };
}

function summariseSignalRows({ rawRows = [] } = {}) {
  const acc = new Map();
  for (const r of rawRows) {
    const key = String(r.key || "").trim();
    if (!key) continue;
    const cur = acc.get(key) || {
      key,
      exchange: r.exchange,
      symbol_or_pair_id: r.symbol_or_pair_id,
      tf: r.tf,
      side: r.side,
      group: r.group,
      subtype: r.subtype,
      n: 0,
      eval_n: 0,
      rets: [],
    };

    cur.n += 1;
    if (r.eval_ok) {
      cur.eval_n += 1;
      cur.rets.push(Number(r.dir_ret_horizon_pct) || 0);
    }

    acc.set(key, cur);
  }

  const rows = [];
  for (const cur of acc.values()) {
    const ev = avg(cur.rets);
    const wr = winRate(cur.rets);
    rows.push({
      key: cur.key,
      exchange: cur.exchange,
      symbol_or_pair_id: cur.symbol_or_pair_id,
      tf: cur.tf,
      side: cur.side,
      group: cur.group,
      subtype: cur.subtype,
      n: cur.n,
      eval_n: cur.eval_n,
      win_rate: Number(wr.toFixed(4)),
      ev_dir_ret_pct: Number(ev.toFixed(6)),
    });
  }

  // deterministic sort: win_rate desc, ev desc, n desc
  rows.sort((a, b) => {
    if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
    if (b.ev_dir_ret_pct !== a.ev_dir_ret_pct) return b.ev_dir_ret_pct - a.ev_dir_ret_pct;
    if (b.eval_n !== a.eval_n) return b.eval_n - a.eval_n;
    return String(a.key).localeCompare(String(b.key));
  });

  return rows;
}

module.exports = {
  computeSignalEval,
  summariseSignalRows,
};
