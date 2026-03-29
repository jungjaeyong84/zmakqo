#!/usr/bin/env node
const https = require("https");

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT"];
const INTERVAL = "1h";
const DAYS_BACK = 90;
const INITIAL_CAPITAL = 14000;
const POSITION_SIZE_PCT = 10;
const COMMISSION_PCT = 0.04;
const LEVERAGE = 2;

const SL_PCT = 1.5;
const TP_PCT = 3.0;
const TRAIL_PCT = 1.0;

function fetchKlines(symbol, interval, limit) {
  return new Promise((resolve, reject) => {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const raw = JSON.parse(data);
          if (!Array.isArray(raw)) return reject(new Error(`invalid response: ${data.slice(0, 200)}`));
          resolve(raw.map((r) => ({
            time: r[0],
            open: Number(r[1]),
            high: Number(r[2]),
            low: Number(r[3]),
            close: Number(r[4]),
            volume: Number(r[5]),
            closeTime: r[6],
          })));
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    });
  });
}

function ema(data, len) {
  const k = 2 / (len + 1);
  const out = [data[0]];
  for (let i = 1; i < data.length; i += 1) out.push((data[i] * k) + (out[i - 1] * (1 - k)));
  return out;
}

function sma(data, len) {
  const out = [];
  for (let i = 0; i < data.length; i += 1) {
    if (i < len - 1) {
      out.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - len + 1; j <= i; j += 1) sum += data[j];
    out.push(sum / len);
  }
  return out;
}

function rma(data, len) {
  const out = [data[0]];
  for (let i = 1; i < data.length; i += 1) out.push((data[i] + (out[i - 1] * (len - 1))) / len);
  return out;
}

function rsiCalc(closes, len) {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const avgGain = rma(gains, len);
  const avgLoss = rma(losses, len);
  return avgGain.map((g, i) => {
    const l = avgLoss[i];
    if (l === 0) return 100;
    return 100 - (100 / (1 + (g / l)));
  });
}

function stochastic(highs, lows, closes, kLen, smooth, dLen) {
  const kRaw = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (i < kLen - 1) {
      kRaw.push(50);
      continue;
    }
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kLen + 1; j <= i; j += 1) {
      hh = Math.max(hh, highs[j]);
      ll = Math.min(ll, lows[j]);
    }
    const range = hh - ll;
    kRaw.push(range > 0 ? (((closes[i] - ll) / range) * 100) : 50);
  }
  const kSmooth = sma(kRaw, smooth);
  const d = sma(kSmooth, dLen);
  return { k: kSmooth, d };
}

function atr(highs, lows, closes, len) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i += 1) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return rma(tr, len);
}

function wmaCalc(data, len) {
  const out = [];
  for (let i = 0; i < data.length; i += 1) {
    if (i < len - 1 || Number.isNaN(data[i])) {
      out.push(data[i]);
      continue;
    }
    let num = 0;
    let den = 0;
    for (let j = 0; j < len; j += 1) {
      const w = len - j;
      num += data[i - j] * w;
      den += w;
    }
    out.push(num / den);
  }
  return out;
}

function hma(data, len) {
  const halfLen = Math.max(Math.round(len / 2), 1);
  const sqrtLen = Math.max(Math.round(Math.sqrt(len)), 1);
  const wma1 = wmaCalc(data, halfLen);
  const wma2 = wmaCalc(data, len);
  const diff = wma1.map((v, i) => (2 * v) - wma2[i]);
  return wmaCalc(diff, sqrtLen);
}

function ichimoku(highs, lows, convLen, baseLen) {
  const conv = [];
  const base = [];
  for (let i = 0; i < highs.length; i += 1) {
    if (i < convLen - 1) conv.push(NaN);
    else {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - convLen + 1; j <= i; j += 1) {
        hh = Math.max(hh, highs[j]);
        ll = Math.min(ll, lows[j]);
      }
      conv.push((hh + ll) / 2);
    }
    if (i < baseLen - 1) base.push(NaN);
    else {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - baseLen + 1; j <= i; j += 1) {
        hh = Math.max(hh, highs[j]);
        ll = Math.min(ll, lows[j]);
      }
      base.push((hh + ll) / 2);
    }
  }
  return { conv, base };
}

function build4hRsi(candles, rsiLen) {
  const candles4h = [];
  for (let i = 0; i + 3 < candles.length; i += 4) {
    candles4h.push({
      open: candles[i].open,
      high: Math.max(candles[i].high, candles[i + 1].high, candles[i + 2].high, candles[i + 3].high),
      low: Math.min(candles[i].low, candles[i + 1].low, candles[i + 2].low, candles[i + 3].low),
      close: candles[i + 3].close,
    });
  }
  const closes4h = candles4h.map((c) => c.close);
  const rsi4h = rsiCalc(closes4h, rsiLen);
  const map = new Array(candles.length).fill(50);
  for (let i = 0; i < candles.length; i += 1) {
    const idx4h = Math.floor(i / 4);
    const completedIdx = (i % 4 === 3) ? idx4h : idx4h - 1;
    if (completedIdx >= 0 && completedIdx < rsi4h.length) map[i] = rsi4h[completedIdx];
  }
  return map;
}

function calcAdx(highs, lows, closes, len) {
  const plusDm = [0];
  const minusDm = [0];
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm.push((upMove > downMove && upMove > 0) ? upMove : 0);
    minusDm.push((downMove > upMove && downMove > 0) ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smoothPlusDm = rma(plusDm, len);
  const smoothMinusDm = rma(minusDm, len);
  const smoothTr = rma(tr, len);
  const dx = [];
  for (let i = 0; i < closes.length; i += 1) {
    const diPlus = smoothTr[i] > 0 ? (smoothPlusDm[i] / smoothTr[i]) * 100 : 0;
    const diMinus = smoothTr[i] > 0 ? (smoothMinusDm[i] / smoothTr[i]) * 100 : 0;
    const sum = diPlus + diMinus;
    dx.push(sum > 0 ? (Math.abs(diPlus - diMinus) / sum) * 100 : 0);
  }
  return rma(dx, len);
}

function clamp01(x) { return Math.max(Math.min(x, 1), 0); }
function clamp(x, lo, hi) { return Math.max(Math.min(x, hi), lo); }
function logit(p) { return Math.log(Math.max(p, 0.001) / Math.max(1 - p, 0.001)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

const SCENARIOS = [
  {
    key: "baseline",
    desc: "원본 근사",
    earlyLongScoreMin: 20,
    disableEarlyLong: false,
    coreLongScoreMin: 20,
    coreLongPostMin: 0.56,
    longRequireVolOnCore: false,
    longRequireBullHtf: false,
    longTransitionScoreMin: 20,
    longTransitionPostMin: 0.56,
    preRealLongPostMin: 0.58,
    preRealLongScoreMin: 25,
    coreLongMaxPosPct: null,
    coreLongMaxK: null,
    preRealLongMaxPosPct: null,
    preRealLongMaxK: null,
    earlyShortScoreMin: 20,
    coreShortScoreMin: 20,
    coreShortPostMin: 0.56,
    shortRequireVolOnCore: false,
    shortRequireBearHtf: false,
    shortTransitionScoreMin: 20,
    shortTransitionPostMin: 0.56,
    preRealShortPostMin: 0.58,
    preRealShortScoreMin: 25,
    realBlocked: false,
  },
  {
    key: "balanced_plus_shorts",
    desc: "롱 유지 + 숏 약간 확장",
    earlyLongScoreMin: 20,
    disableEarlyLong: false,
    coreLongScoreMin: 20,
    coreLongPostMin: 0.56,
    longRequireVolOnCore: false,
    longRequireBullHtf: false,
    longTransitionScoreMin: 20,
    longTransitionPostMin: 0.56,
    preRealLongPostMin: 0.58,
    preRealLongScoreMin: 25,
    coreLongMaxPosPct: null,
    coreLongMaxK: null,
    preRealLongMaxPosPct: null,
    preRealLongMaxK: null,
    earlyShortScoreMin: 18,
    coreShortScoreMin: 18,
    coreShortPostMin: 0.55,
    shortRequireVolOnCore: false,
    shortRequireBearHtf: false,
    shortTransitionScoreMin: 18,
    shortTransitionPostMin: 0.55,
    preRealShortPostMin: 0.57,
    preRealShortScoreMin: 23,
    realBlocked: false,
  },
  {
    key: "timing_balanced",
    desc: "롱 transition 소폭 강화 + 숏 소폭 확장",
    earlyLongScoreMin: 21,
    disableEarlyLong: false,
    coreLongScoreMin: 21,
    coreLongPostMin: 0.57,
    longRequireVolOnCore: false,
    longRequireBullHtf: false,
    longTransitionScoreMin: 24,
    longTransitionPostMin: 0.58,
    preRealLongPostMin: 0.59,
    preRealLongScoreMin: 26,
    coreLongMaxPosPct: null,
    coreLongMaxK: null,
    preRealLongMaxPosPct: null,
    preRealLongMaxK: null,
    earlyShortScoreMin: 18,
    coreShortScoreMin: 18,
    coreShortPostMin: 0.55,
    shortRequireVolOnCore: false,
    shortRequireBearHtf: false,
    shortTransitionScoreMin: 18,
    shortTransitionPostMin: 0.55,
    preRealShortPostMin: 0.57,
    preRealShortScoreMin: 23,
    realBlocked: false,
  },
  {
    key: "long_htf_bull_short_expand",
    desc: "롱 HTF 정렬 강화 + 숏 확장",
    earlyLongScoreMin: 20,
    disableEarlyLong: false,
    coreLongScoreMin: 20,
    coreLongPostMin: 0.56,
    longRequireVolOnCore: false,
    longRequireBullHtf: true,
    longTransitionScoreMin: 20,
    longTransitionPostMin: 0.56,
    preRealLongPostMin: 0.58,
    preRealLongScoreMin: 25,
    coreLongMaxPosPct: null,
    coreLongMaxK: null,
    preRealLongMaxPosPct: null,
    preRealLongMaxK: null,
    earlyShortScoreMin: 18,
    coreShortScoreMin: 18,
    coreShortPostMin: 0.55,
    shortRequireVolOnCore: false,
    shortRequireBearHtf: false,
    shortTransitionScoreMin: 18,
    shortTransitionPostMin: 0.55,
    preRealShortPostMin: 0.57,
    preRealShortScoreMin: 23,
    realBlocked: false,
  },
  {
    key: "combo_balanced",
    desc: "롱/숏 모두 타이밍 보정",
    earlyLongScoreMin: 24,
    disableEarlyLong: false,
    coreLongScoreMin: 22,
    coreLongPostMin: 0.57,
    longRequireVolOnCore: false,
    longRequireBullHtf: false,
    longTransitionScoreMin: 25,
    longTransitionPostMin: 0.58,
    preRealLongPostMin: 0.59,
    preRealLongScoreMin: 27,
    coreLongMaxPosPct: null,
    coreLongMaxK: null,
    preRealLongMaxPosPct: null,
    preRealLongMaxK: null,
    earlyShortScoreMin: 18,
    coreShortScoreMin: 18,
    coreShortPostMin: 0.55,
    shortRequireVolOnCore: false,
    shortRequireBearHtf: false,
    shortTransitionScoreMin: 17,
    shortTransitionPostMin: 0.54,
    preRealShortPostMin: 0.57,
    preRealShortScoreMin: 22,
    realBlocked: false,
  },
  {
    key: "strict_both",
    desc: "롱/숏 모두 보수화",
    earlyLongScoreMin: 24,
    disableEarlyLong: false,
    coreLongScoreMin: 24,
    coreLongPostMin: 0.58,
    longRequireVolOnCore: true,
    longRequireBullHtf: true,
    longTransitionScoreMin: 30,
    longTransitionPostMin: 0.60,
    preRealLongPostMin: 0.60,
    preRealLongScoreMin: 30,
    coreLongMaxPosPct: null,
    coreLongMaxK: null,
    preRealLongMaxPosPct: null,
    preRealLongMaxK: null,
    earlyShortScoreMin: 20,
    coreShortScoreMin: 20,
    coreShortPostMin: 0.56,
    shortRequireVolOnCore: true,
    shortRequireBearHtf: true,
    shortTransitionScoreMin: 22,
    shortTransitionPostMin: 0.56,
    preRealShortPostMin: 0.58,
    preRealShortScoreMin: 25,
    realBlocked: false,
  },
];

function backtest(candles, symbol, sc) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const emaFast = ema(closes, 21);
  const emaSlow = ema(closes, 55);
  const stoch = stochastic(highs, lows, closes, 14, 3, 3);
  const volSma = sma(volumes, 20);
  const hmaVals = hma(closes, 20);
  const ichi = ichimoku(highs, lows, 9, 26);
  const htfRsiMap = build4hRsi(candles, 14);
  const adxVals = calcAdx(highs, lows, closes, 14);

  const trades = [];
  let position = null;
  let lastLongBar = -999;
  let lastShortBar = -999;
  const cooldownBars = 14;
  const signalCounts = { EARLY_LONG: 0, EARLY_SHORT: 0, CORE_LONG: 0, CORE_SHORT: 0, PRE_REAL_LONG: 0, PRE_REAL_SHORT: 0, REAL_LONG: 0, REAL_SHORT: 0 };
  const slPct = Number.isFinite(sc.slPct) ? sc.slPct : SL_PCT;
  const tpPct = Number.isFinite(sc.tpPct) ? sc.tpPct : TP_PCT;
  const trailPct = Number.isFinite(sc.trailPct) ? sc.trailPct : TRAIL_PCT;
  const longSlPct = Number.isFinite(sc.longSlPct) ? sc.longSlPct : slPct;
  const longTpPct = Number.isFinite(sc.longTpPct) ? sc.longTpPct : tpPct;
  const longTrailPct = Number.isFinite(sc.longTrailPct) ? sc.longTrailPct : trailPct;
  const shortSlPct = Number.isFinite(sc.shortSlPct) ? sc.shortSlPct : slPct;
  const shortTpPct = Number.isFinite(sc.shortTpPct) ? sc.shortTpPct : tpPct;
  const shortTrailPct = Number.isFinite(sc.shortTrailPct) ? sc.shortTrailPct : trailPct;
  const leverage = Number.isFinite(sc.leverage) ? sc.leverage : LEVERAGE;

  for (let i = 60; i < candles.length; i += 1) {
    const c = candles[i];
    if (position) {
      let exitReason = null;
      let exitPrice = null;
      if (position.side === "LONG") {
        if (c.low <= position.sl) {
          exitReason = "SL";
          exitPrice = position.sl;
        } else if (c.high >= position.tp) {
          position.tpHit = true;
          if (position.highWm == null) position.highWm = c.high;
        }
        if (!exitReason) {
          if (c.high > position.highWm) {
            position.highWm = c.high;
            const newTrail = position.highWm * (1 - (position.trailPct / 100));
            if (newTrail > position.trailStop) position.trailStop = newTrail;
          }
          if (position.tpHit && c.low <= position.trailStop) {
            exitReason = "TRAIL";
            exitPrice = position.trailStop;
          } else if (position.tpHit && c.high >= position.tp) {
            exitReason = "TP";
            exitPrice = position.tp;
          }
        }
      } else {
        if (c.high >= position.sl) {
          exitReason = "SL";
          exitPrice = position.sl;
        } else if (c.low <= position.tp) {
          position.tpHit = true;
          if (position.lowWm == null) position.lowWm = c.low;
        }
        if (!exitReason) {
          if (c.low < position.lowWm) {
            position.lowWm = c.low;
            const newTrail = position.lowWm * (1 + (position.trailPct / 100));
            if (newTrail < position.trailStop) position.trailStop = newTrail;
          }
          if (position.tpHit && c.high >= position.trailStop) {
            exitReason = "TRAIL";
            exitPrice = position.trailStop;
          } else if (position.tpHit && c.low <= position.tp) {
            exitReason = "TP";
            exitPrice = position.tp;
          }
        }
      }
      if (exitReason) {
        const pnlPctRaw = position.side === "LONG"
          ? (((exitPrice - position.entry) / position.entry) * 100 * leverage)
          : (((position.entry - exitPrice) / position.entry) * 100 * leverage);
        const feePct = COMMISSION_PCT * 2 * leverage;
        const pnlPct = pnlPctRaw - feePct;
        const notionalUsd = INITIAL_CAPITAL * (POSITION_SIZE_PCT / 100);
        const pnlUsd = (notionalUsd * pnlPct / 100);
        trades.push({
          symbol,
          tier: position.tier,
          side: position.side,
          exitReason,
          pnlUsd,
          pnlPct,
          bars: i - position.bar,
          exitTime: c.time,
          entryTime: position.entryTime,
          entryRegime: position.entryRegime,
          entryTrend: position.entryTrend,
          entryHtf: position.entryHtf,
          entryScore: position.entryScore,
          entryPostLong: position.entryPostLong,
          entryPostShort: position.entryPostShort,
          entryVolRatio: position.entryVolRatio,
          entryPosPct: position.entryPosPct,
          entryK: position.entryK,
        });
        position = null;
      }
    }

    if (position) continue;

    let upCnt = 0;
    let downCnt = 0;
    for (let j = Math.max(0, i - 14); j <= i; j += 1) {
      if (emaFast[j] > emaSlow[j]) upCnt += 1;
      if (emaFast[j] < emaSlow[j]) downCnt += 1;
    }
    const trendState = upCnt >= 9 ? "bull" : downCnt >= 9 ? "bear" : "neutral";
    const htfRsi = htfRsiMap[i];
    const htfState = htfRsi > 55 ? "bull" : htfRsi < 45 ? "bear" : "neutral";
    const kVal = stoch.k[i] || 50;
    const dVal = stoch.d[i] || 50;
    const prevK = stoch.k[i - 1] || 50;
    const prevD = stoch.d[i - 1] || 50;
    const crossKdUp = prevK <= prevD && kVal > dVal;
    const crossKdDown = prevK >= prevD && kVal < dVal;
    const volRatio = volSma[i] > 0 ? (volumes[i] / volSma[i]) : 1;
    const volStrong = volRatio >= 1.2;
    const adx = adxVals[i] || 20;
    const regimeState = adx >= 25 ? "trend" : adx <= 18 ? "range" : "transition";
    const adolHma = hmaVals[i] || closes[i];
    const adolHmaPrev = hmaVals[i - 1] || closes[i - 1];
    const adolMomFast = adolHma - (hmaVals[i - 3] || closes[i - 3]);
    const baseLine = ichi.base[i] || closes[i];
    const longPullbackLookback = Number.isFinite(sc.longPullbackLookback) ? sc.longPullbackLookback : 3;
    const longPullbackTouchSlackPct = Number.isFinite(sc.longPullbackTouchSlackPct) ? sc.longPullbackTouchSlackPct : 0.002;
    let recentLow = Infinity;
    for (let j = Math.max(0, i - longPullbackLookback + 1); j <= i; j += 1) recentLow = Math.min(recentLow, lows[j]);
    let recentPrevLow = Infinity;
    for (let j = Math.max(0, i - longPullbackLookback); j <= i - 1; j += 1) recentPrevLow = Math.min(recentPrevLow, lows[j]);
    const longRecentTouchAdol = recentLow <= (adolHma * (1 + longPullbackTouchSlackPct));
    const longRecentTouchBase = recentLow <= (baseLine * (1 + longPullbackTouchSlackPct));
    const longRecentPullbackTouch = longRecentTouchAdol || longRecentTouchBase;
    const longRecentPrevTouchAdol = recentPrevLow <= (adolHmaPrev * (1 + longPullbackTouchSlackPct));
    const longRecentPrevTouchBase = recentPrevLow <= ((ichi.base[i - 1] || closes[i - 1]) * (1 + longPullbackTouchSlackPct));
    const longRecentPullbackPrevTouch = longRecentPrevTouchAdol || longRecentPrevTouchBase;
    const longResumeCloseUp = closes[i] > closes[i - 1];

    let tdBuy = 0;
    let tdSell = 0;
    if (i >= 4) {
      for (let j = i; j >= Math.max(4, i - 12); j -= 1) {
        if (closes[j] < closes[j - 4]) tdBuy += 1;
        else break;
      }
      for (let j = i; j >= Math.max(4, i - 12); j -= 1) {
        if (closes[j] > closes[j - 4]) tdSell += 1;
        else break;
      }
    }

    const trendSep = emaSlow[i] > 0 ? (emaFast[i] - emaSlow[i]) / emaSlow[i] : 0;
    const strTrendL = (0.5 * clamp01(trendSep / 0.02)) + (0.5 * (upCnt / 15));
    const strTrendS = (0.5 * clamp01((-trendSep) / 0.02)) + (0.5 * (downCnt / 15));
    const strHtfL = clamp01((htfRsi - 50) / 30);
    const strHtfS = clamp01((50 - htfRsi) / 30);
    const strTdL = clamp01(tdBuy / 9);
    const strTdS = clamp01(tdSell / 9);
    const strStochL = (0.6 * clamp01((kVal - 50) / 50)) + (0.4 * clamp01((kVal - dVal) / 20));
    const strStochS = (0.6 * clamp01((50 - kVal) / 50)) + (0.4 * clamp01((dVal - kVal) / 20));
    const strVolL = clamp01((volRatio - 0.8) / 1.2);
    const strRegime = clamp01((adx - 18) / 7);
    const rawL = (0.30 * strTrendL) + (0.20 * strHtfL) + (0.18 * strTdL) + (0.15 * strStochL) + (0.12 * strVolL) + (0.05 * strRegime);
    const rawS = (0.30 * strTrendS) + (0.20 * strHtfS) + (0.18 * strTdS) + (0.15 * strStochS) + (0.12 * strVolL) + (0.05 * strRegime);
    const score = (rawL - rawS) * 100;

    const htfRsiNorm = clamp01((htfRsi - 30) / 40);
    const ichiPos = c.close > baseLine ? 1 : c.close < (baseLine * 0.98) ? 0 : 0.5;
    const priorLong = (0.4 * htfRsiNorm) + (0.3 * ichiPos) + (0.3 * 0.5);
    const scoreNorm = clamp(score / 100, -1, 1);
    let waveLong = 0.5 + (0.3 * scoreNorm) + (0.1 * (c.close > adolHma ? 1 : -1)) + (0.1 * (adolMomFast > 0 ? 1 : -1));
    waveLong = clamp(waveLong, 0.05, 0.95);
    const conf = Math.abs(waveLong - 0.5) * 2;
    const lambdaPost = 0.15 + (0.8 * conf);
    const logitPost = ((1 - lambdaPost) * logit(priorLong)) + (lambdaPost * logit(waveLong));
    const postLong = sigmoid(logitPost);
    const postShort = 1 - postLong;

    let posHigh = -Infinity;
    let posLow = Infinity;
    for (let j = Math.max(0, i - 19); j <= i; j += 1) {
      posHigh = Math.max(posHigh, highs[j]);
      posLow = Math.min(posLow, lows[j]);
    }
    const posRange = posHigh - posLow;
    const posPct = posRange > 0 ? ((c.close - posLow) / posRange) : 0.5;

    const earlyLongMinVol = Number.isFinite(sc.earlyLongMinVol) ? sc.earlyLongMinVol : null;
    const earlyLongRangeScoreMin = Number.isFinite(sc.earlyLongRangeScoreMin) ? sc.earlyLongRangeScoreMin : null;
    const earlyLongTransitionScoreMin = Number.isFinite(sc.earlyLongTransitionScoreMin) ? sc.earlyLongTransitionScoreMin : null;
    const earlySoftLongBaseRaw = c.close > adolHma && adolHma > adolHmaPrev && adolMomFast > 0 && score >= sc.earlyLongScoreMin && trendState !== "bear" && htfState !== "bear";
    let earlySoftLongBase = earlySoftLongBaseRaw;
    if (sc.earlyLongRequireBullHtf) earlySoftLongBase = earlySoftLongBase && htfState === "bull";
    if (Number.isFinite(earlyLongMinVol)) earlySoftLongBase = earlySoftLongBase && volRatio >= earlyLongMinVol;
    if (regimeState === "range" && Number.isFinite(earlyLongRangeScoreMin)) earlySoftLongBase = earlySoftLongBase && score >= earlyLongRangeScoreMin;
    if (regimeState === "transition" && Number.isFinite(earlyLongTransitionScoreMin)) earlySoftLongBase = earlySoftLongBase && score >= earlyLongTransitionScoreMin;
    const earlySoftLong = sc.disableEarlyLong ? false : earlySoftLongBase;
    const earlySoftShortBase = c.close < adolHma && adolHma < adolHmaPrev && adolMomFast < 0 && score <= -sc.earlyShortScoreMin && trendState !== "bull" && htfState !== "bull";
    const earlySoftShort = sc.disableEarlyShort ? false : earlySoftShortBase;
    const bullBreakoutLong = !!sc.enableBullBreakoutLongPromotion
      && earlySoftLong
      && regimeState === "trend"
      && trendState === "bull"
      && htfState === "bull"
      && posPct >= (Number.isFinite(sc.bullBreakoutLongPosMin) ? sc.bullBreakoutLongPosMin : 0.93)
      && kVal >= (Number.isFinite(sc.bullBreakoutLongKMin) ? sc.bullBreakoutLongKMin : 85)
      && volRatio >= (Number.isFinite(sc.bullBreakoutLongVolMin) ? sc.bullBreakoutLongVolMin : 0.8)
      && postLong >= (Number.isFinite(sc.bullBreakoutLongPostMin) ? sc.bullBreakoutLongPostMin : 0.72);

    let coreLong = (htfState === "bull" || trendState === "bull") && score >= 5 && c.close >= baseLine && postLong >= 0.53
      && score >= sc.coreLongScoreMin && postLong >= sc.coreLongPostMin
      && (posPct <= 0.80 || score >= 40)
      && !(kVal >= 78 && score < 50)
      && regimeState !== "range";
    if (sc.longRequireBullHtf) coreLong = coreLong && htfState === "bull";
    if (regimeState === "transition") coreLong = coreLong && score >= sc.longTransitionScoreMin && postLong >= sc.longTransitionPostMin;
    if (sc.longRequireVolOnCore) coreLong = coreLong && volRatio >= 1.0;
    if (Number.isFinite(sc.coreLongMaxPosPct)) coreLong = coreLong && posPct <= sc.coreLongMaxPosPct;
    if (Number.isFinite(sc.coreLongMaxK)) coreLong = coreLong && kVal <= sc.coreLongMaxK;
    if (sc.longRequirePullbackTouchOnCore && htfState === "bull") coreLong = coreLong && longRecentPullbackTouch;
    if (sc.longRequirePrevPullbackTouchOnCore && htfState === "bull") coreLong = coreLong && longRecentPullbackPrevTouch;
    if (sc.disableCoreLong) coreLong = false;
    if (bullBreakoutLong) coreLong = true;

    let coreShort = (htfState === "bear" || trendState === "bear") && score <= -5 && c.close <= baseLine && postShort >= 0.53
      && score <= -sc.coreShortScoreMin && postShort >= sc.coreShortPostMin
      && (posPct >= 0.20 || score <= -40)
      && !(kVal <= 22 && score > -50)
      && regimeState !== "range";
    if (sc.shortRequireBearHtf) coreShort = coreShort && htfState === "bear";
    if (regimeState === "transition") coreShort = coreShort && score <= -sc.shortTransitionScoreMin && postShort >= sc.shortTransitionPostMin;
    if (sc.shortRequireVolOnCore) coreShort = coreShort && volRatio >= 1.0;

    const coreLongFinal = (sc.disableCoreLongFinalOnly ? false : coreLong) && (htfState !== "bear" || score >= 35);
    const coreShortFinal = (sc.disableCoreShortFinalOnly ? false : coreShort) && (htfState !== "bull" || score <= -35);

    const preRealLong = coreLongFinal && score >= sc.preRealLongScoreMin && postLong >= sc.preRealLongPostMin
      && volRatio >= 1.0 && kVal > prevK
      && (htfState !== "bear" || score >= 50);
    const preRealLongRetestOk = (!sc.preRealLongRequirePullbackTouch || longRecentPullbackTouch)
      && (!sc.preRealLongRequirePrevPullbackTouch || longRecentPullbackPrevTouch)
      && (!sc.preRealLongRequireCloseResume || longResumeCloseUp);
    const preRealLongAdj = (!Number.isFinite(sc.preRealLongMaxPosPct) || posPct <= sc.preRealLongMaxPosPct)
      && (!Number.isFinite(sc.preRealLongMaxK) || kVal <= sc.preRealLongMaxK);
    const preRealLongFinal = (sc.disablePreRealLong ? false : preRealLong) && preRealLongAdj && preRealLongRetestOk;
    const preRealShortBase = coreShortFinal && score <= -sc.preRealShortScoreMin && postShort >= sc.preRealShortPostMin
      && volRatio >= 1.0 && kVal < prevK
      && (htfState !== "bull" || score <= -50);
    const preRealShort = sc.disablePreRealShort ? false : preRealShortBase;

    const realLongBase = coreLongFinal && score >= 25 && volStrong && (crossKdUp || (score >= 20 && postLong >= 0.60 && kVal <= 35 && kVal > prevK)) && postLong >= 0.57 && (posPct <= 0.70 || score >= 35);
    const realShortBase = coreShortFinal && score <= -25 && volStrong && (crossKdDown || (score <= -20 && postShort >= 0.60 && kVal >= 65 && kVal < prevK)) && postShort >= 0.57 && (posPct >= 0.30 || score <= -35);
    const realLong = sc.realBlocked ? false : realLongBase;
    const realShort = sc.realBlocked ? false : realShortBase;

    const cooldownLong = (i - lastLongBar >= cooldownBars) && (i - lastShortBar >= 3 || score >= 35);
    const cooldownShort = (i - lastShortBar >= cooldownBars) && (i - lastLongBar >= 3 || score <= -35);

    let tier = null;
    let side = null;
    const coreLongTierAllowed = sc.suppressCoreLongTier ? false : coreLongFinal;
    if (realLong && cooldownLong) { tier = "REAL"; side = "LONG"; signalCounts.REAL_LONG += 1; }
    else if (realShort && cooldownShort) { tier = "REAL"; side = "SHORT"; signalCounts.REAL_SHORT += 1; }
    else if (preRealLongFinal && cooldownLong) { tier = "PRE_REAL"; side = "LONG"; signalCounts.PRE_REAL_LONG += 1; }
    else if (preRealShort && cooldownShort) { tier = "PRE_REAL"; side = "SHORT"; signalCounts.PRE_REAL_SHORT += 1; }
    else if (coreLongTierAllowed && cooldownLong) { tier = "CORE"; side = "LONG"; signalCounts.CORE_LONG += 1; }
    else if ((sc.suppressCoreShortTier ? false : coreShortFinal) && cooldownShort) { tier = "CORE"; side = "SHORT"; signalCounts.CORE_SHORT += 1; }
    else if (earlySoftLong && cooldownLong) { tier = "EARLY"; side = "LONG"; signalCounts.EARLY_LONG += 1; }
    else if (earlySoftShort && cooldownShort) { tier = "EARLY"; side = "SHORT"; signalCounts.EARLY_SHORT += 1; }

    if (!tier) continue;
    const entry = c.close;
    if (side === "LONG") {
      position = {
        side,
        tier,
        entry,
        bar: i,
        entryTime: c.time,
        entryRegime: regimeState,
        entryTrend: trendState,
        entryHtf: htfState,
        entryScore: score,
        entryPostLong: postLong,
        entryPostShort: postShort,
        entryVolRatio: volRatio,
        entryPosPct: posPct,
        entryK: kVal,
        tpHit: false,
        sl: entry * (1 - (longSlPct / 100)),
        tp: entry * (1 + (longTpPct / 100)),
        trailStop: entry * (1 - (longTrailPct / 100)),
        trailPct: longTrailPct,
        highWm: c.high,
      };
      lastLongBar = i;
    } else {
      position = {
        side,
        tier,
        entry,
        bar: i,
        entryTime: c.time,
        entryRegime: regimeState,
        entryTrend: trendState,
        entryHtf: htfState,
        entryScore: score,
        entryPostLong: postLong,
        entryPostShort: postShort,
        entryVolRatio: volRatio,
        entryPosPct: posPct,
        entryK: kVal,
        tpHit: false,
        sl: entry * (1 + (shortSlPct / 100)),
        tp: entry * (1 - (shortTpPct / 100)),
        trailStop: entry * (1 + (shortTrailPct / 100)),
        trailPct: shortTrailPct,
        lowWm: c.low,
      };
      lastShortBar = i;
    }
  }
  return { trades, signalCounts };
}

function summarizeTrades(trades, signalCounts) {
  let equity = INITIAL_CAPITAL;
  let peak = equity;
  let maxDD = 0;
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd < 0);
  const netPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const grossW = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossL = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    equity += t.pnlUsd;
    peak = Math.max(peak, equity);
    const dd = ((peak - equity) / peak) * 100;
    maxDD = Math.max(maxDD, dd);
  }
  const longs = trades.filter((t) => t.side === "LONG");
  const shorts = trades.filter((t) => t.side === "SHORT");
  const signalTotal = Object.values(signalCounts).reduce((s, v) => s + v, 0);
  return {
    trades: trades.length,
    signals: signalTotal,
    winRate: trades.length ? (wins.length / trades.length) : 0,
    netPnl,
    retPct: netPnl / INITIAL_CAPITAL,
    pf: grossL > 0 ? (grossW / grossL) : (grossW > 0 ? Infinity : 0),
    mddPct: maxDD,
    longTrades: longs.length,
    longNet: longs.reduce((s, t) => s + t.pnlUsd, 0),
    shortTrades: shorts.length,
    shortNet: shorts.reduce((s, t) => s + t.pnlUsd, 0),
  };
}

function scenarioRank(m) {
  return (m.netPnl) - (m.mddPct * 45) + (m.winRate * 700) - Math.max(0, (110 - m.signals)) * 2;
}

async function main() {
  const limit = Math.min(DAYS_BACK * 24, 1500);
  const marketData = new Map();
  for (const symbol of SYMBOLS) {
    process.stdout.write(`${symbol} fetch... `);
    const candles = await fetchKlines(symbol, INTERVAL, limit);
    console.log(`${candles.length} bars`);
    marketData.set(symbol, candles);
  }

  const rows = [];
  for (const sc of SCENARIOS) {
    let allTrades = [];
    const combinedSignals = { EARLY_LONG: 0, EARLY_SHORT: 0, CORE_LONG: 0, CORE_SHORT: 0, PRE_REAL_LONG: 0, PRE_REAL_SHORT: 0, REAL_LONG: 0, REAL_SHORT: 0 };
    for (const symbol of SYMBOLS) {
      const { trades, signalCounts } = backtest(marketData.get(symbol), symbol, sc);
      allTrades = allTrades.concat(trades);
      for (const [k, v] of Object.entries(signalCounts)) combinedSignals[k] += v;
    }
    const metrics = summarizeTrades(allTrades, combinedSignals);
    rows.push({
      scenario: sc.key,
      desc: sc.desc,
      ...metrics,
      rank: scenarioRank(metrics),
    });
  }

  rows.sort((a, b) => b.rank - a.rank);
  console.log("\nscenario,signals,trades,win_rate,net_usd,ret_pct,pf,mdd_pct,long_net,short_net");
  for (const r of rows) {
    console.log([
      r.scenario,
      r.signals,
      r.trades,
      (r.winRate * 100).toFixed(1),
      r.netPnl.toFixed(2),
      (r.retPct * 100).toFixed(2),
      Number.isFinite(r.pf) ? r.pf.toFixed(3) : "INF",
      r.mddPct.toFixed(2),
      r.longNet.toFixed(2),
      r.shortNet.toFixed(2),
    ].join(","));
  }

  const best = rows[0];
  console.log("\nBEST");
  console.log(JSON.stringify(best, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  SYMBOLS,
  INTERVAL,
  DAYS_BACK,
  INITIAL_CAPITAL,
  POSITION_SIZE_PCT,
  COMMISSION_PCT,
  LEVERAGE,
  SL_PCT,
  TP_PCT,
  TRAIL_PCT,
  SCENARIOS,
  fetchKlines,
  backtest,
  summarizeTrades,
};
