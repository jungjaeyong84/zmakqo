#!/usr/bin/env node
/**
 * 돈벌자 Pine v5.6.0.2 — Node.js 백테스터 (v2 - 버그 수정 + PATCH-55)
 * 수정사항:
 *   1. HTF RSI: 실제 4H 캔들 빌드 후 RSI 계산 (1H RSI 평균 → 4H candle RSI)
 *   2. ADX: 정확한 DI+/DI-/DX/ADX 구현 (근사값 제거)
 *   3. CORE posterior: 0.53 → 0.56 (PATCH-53 정확 반영)
 *   4. PRE_REAL: posterior 0.58 + vol_ratio >= 1.0 + K방향 (PATCH-55)
 */

const https = require("https");

// ─── 설정 ───
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

// ─── Binance API ───
function fetchKlines(symbol, interval, limit) {
  return new Promise((resolve, reject) => {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const raw = JSON.parse(data);
          if (!Array.isArray(raw)) { reject(new Error("Not array: " + data.slice(0,200))); return; }
          const candles = raw.map((r) => ({
            time: r[0],
            open: parseFloat(r[1]),
            high: parseFloat(r[2]),
            low: parseFloat(r[3]),
            close: parseFloat(r[4]),
            volume: parseFloat(r[5]),
            closeTime: r[6],
          }));
          resolve(candles);
        } catch (e) { reject(e); }
      });
      res.on("error", reject);
    });
  });
}

// ─── 기술 지표 ───
function ema(data, len) {
  const k = 2 / (len + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function sma(data, len) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < len - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - len + 1; j <= i; j++) sum += data[j];
    result.push(sum / len);
  }
  return result;
}

function rma(data, len) {
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    if (isNaN(result[i-1])) { result.push(data[i]); continue; }
    result.push((data[i] + result[i - 1] * (len - 1)) / len);
  }
  return result;
}

function rsiCalc(closes, len) {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const avgGain = rma(gains, len);
  const avgLoss = rma(losses, len);
  return avgGain.map((g, i) => {
    const l = avgLoss[i];
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  });
}

function stochastic(highs, lows, closes, kLen, smooth, dLen) {
  const kRaw = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < kLen - 1) { kRaw.push(50); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kLen + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    const range = hh - ll;
    kRaw.push(range > 0 ? ((closes[i] - ll) / range) * 100 : 50);
  }
  const kSmooth = sma(kRaw, smooth);
  const d = sma(kSmooth, dLen);
  return { k: kSmooth, d };
}

function atr(highs, lows, closes, len) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  }
  return rma(tr, len);
}

function hma(data, len) {
  const halfLen = Math.max(Math.round(len / 2), 1);
  const sqrtLen = Math.max(Math.round(Math.sqrt(len)), 1);
  const wma1 = wmaCalc(data, halfLen);
  const wma2 = wmaCalc(data, len);
  const diff = wma1.map((v, i) => 2 * v - wma2[i]);
  return wmaCalc(diff, sqrtLen);
}

function wmaCalc(data, len) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < len - 1 || isNaN(data[i])) { result.push(data[i]); continue; }
    let num = 0, den = 0;
    for (let j = 0; j < len; j++) {
      const w = len - j;
      num += data[i - j] * w;
      den += w;
    }
    result.push(num / den);
  }
  return result;
}

function ichimoku(highs, lows, convLen, baseLen) {
  const conv = [], base = [];
  for (let i = 0; i < highs.length; i++) {
    if (i < convLen - 1) { conv.push(NaN); } else {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - convLen + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]); }
      conv.push((hh + ll) / 2);
    }
    if (i < baseLen - 1) { base.push(NaN); } else {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - baseLen + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]); }
      base.push((hh + ll) / 2);
    }
  }
  return { conv, base };
}

// ─── [FIX-1] 실제 4H 캔들 빌드 + RSI 계산 ───
function build4hRsi(candles, rsiLen) {
  // 4개 1H 캔들 → 1개 4H 캔들
  const candles4h = [];
  for (let i = 0; i + 3 < candles.length; i += 4) {
    candles4h.push({
      open: candles[i].open,
      high: Math.max(candles[i].high, candles[i+1].high, candles[i+2].high, candles[i+3].high),
      low: Math.min(candles[i].low, candles[i+1].low, candles[i+2].low, candles[i+3].low),
      close: candles[i+3].close,
    });
  }

  const closes4h = candles4h.map(c => c.close);
  const rsi4h = rsiCalc(closes4h, rsiLen);

  // 1H 인덱스 → 4H RSI 매핑 (가장 최근 완성된 4H 캔들의 RSI 사용)
  const htfRsiMap = new Array(candles.length).fill(50);
  for (let i = 0; i < candles.length; i++) {
    const idx4h = Math.floor(i / 4);
    // 현재 4H 봉이 완성되었으면 현재 값, 아니면 이전 값
    const completedIdx = (i % 4 === 3) ? idx4h : idx4h - 1;
    if (completedIdx >= 0 && completedIdx < rsi4h.length) {
      htfRsiMap[i] = rsi4h[completedIdx];
    }
  }
  return htfRsiMap;
}

// ─── [FIX-2] 정확한 ADX 계산 ───
function calcAdx(highs, lows, closes, len) {
  const n = closes.length;
  const plusDm = [0];
  const minusDm = [0];
  const tr = [highs[0] - lows[0]];

  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  }

  const smoothPlusDm = rma(plusDm, len);
  const smoothMinusDm = rma(minusDm, len);
  const smoothTr = rma(tr, len);

  const dx = [];
  for (let i = 0; i < n; i++) {
    const diPlus = smoothTr[i] > 0 ? (smoothPlusDm[i] / smoothTr[i]) * 100 : 0;
    const diMinus = smoothTr[i] > 0 ? (smoothMinusDm[i] / smoothTr[i]) * 100 : 0;
    const sum = diPlus + diMinus;
    dx.push(sum > 0 ? Math.abs(diPlus - diMinus) / sum * 100 : 0);
  }

  return rma(dx, len);
}

// ─── 스코어 유틸 ───
function clamp01(x) { return Math.max(Math.min(x, 1), 0); }
function clamp(x, lo, hi) { return Math.max(Math.min(x, hi), lo); }
function logit(p) { return Math.log(Math.max(p, 0.001) / Math.max(1 - p, 0.001)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// ─── 백테스트 엔진 ───
function backtest(candles, symbol) {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  // 지표 계산
  const emaFast = ema(closes, 21);
  const emaSlow = ema(closes, 55);
  const rsiVals = rsiCalc(closes, 14);
  const stoch = stochastic(highs, lows, closes, 14, 3, 3);
  const atrVals = atr(highs, lows, closes, 14);
  const volSma = sma(volumes, 20);
  const hmaVals = hma(closes, 20);
  const ichi = ichimoku(highs, lows, 9, 26);

  // [FIX-1] 실제 4H RSI
  const htfRsiMap = build4hRsi(candles, 14);

  // [FIX-2] 정확한 ADX
  const adxVals = calcAdx(highs, lows, closes, 14);

  // 트레이드 기록
  const trades = [];
  let position = null;
  let lastLongBar = -999, lastShortBar = -999;
  const cooldownBars = 14;

  const signalCounts = { EARLY_LONG: 0, EARLY_SHORT: 0, CORE_LONG: 0, CORE_SHORT: 0, PRE_REAL_LONG: 0, PRE_REAL_SHORT: 0, REAL_LONG: 0, REAL_SHORT: 0 };

  for (let i = 60; i < n; i++) {
    const c = candles[i];

    // ── 1. 포지션 관리 (Exit 체크) ──
    if (position) {
      let exitReason = null;
      let exitPrice = null;

      if (position.side === "LONG") {
        if (c.low <= position.sl) {
          exitReason = "SL";
          exitPrice = position.sl;
        } else if (c.high >= position.tp) {
          exitReason = "TP";
          exitPrice = position.tp;
        } else {
          if (c.high > position.highWm) {
            position.highWm = c.high;
            const newTrail = position.highWm * (1 - TRAIL_PCT / 100);
            if (newTrail > position.trailStop) position.trailStop = newTrail;
          }
          if (position.tpHit && c.low <= position.trailStop) {
            exitReason = "TRAIL";
            exitPrice = position.trailStop;
          }
          if (c.high >= position.tp && !position.tpHit) {
            position.tpHit = true;
          }
        }
      } else { // SHORT
        if (c.high >= position.sl) {
          exitReason = "SL";
          exitPrice = position.sl;
        } else if (c.low <= position.tp) {
          exitReason = "TP";
          exitPrice = position.tp;
        } else {
          if (c.low < position.lowWm) {
            position.lowWm = c.low;
            const newTrail = position.lowWm * (1 + TRAIL_PCT / 100);
            if (newTrail < position.trailStop) position.trailStop = newTrail;
          }
          if (position.tpHit && c.high >= position.trailStop) {
            exitReason = "TRAIL";
            exitPrice = position.trailStop;
          }
          if (c.low <= position.tp && !position.tpHit) {
            position.tpHit = true;
          }
        }
      }

      if (exitReason) {
        const pnlPct = position.side === "LONG"
          ? (exitPrice - position.entry) / position.entry * 100 * LEVERAGE
          : (position.entry - exitPrice) / position.entry * 100 * LEVERAGE;
        const pnlUsd = (INITIAL_CAPITAL * POSITION_SIZE_PCT / 100) * pnlPct / 100;
        const fee = (INITIAL_CAPITAL * POSITION_SIZE_PCT / 100) * COMMISSION_PCT / 100 * 2;

        trades.push({
          symbol,
          side: position.side,
          tier: position.tier,
          entry: position.entry,
          exit: exitPrice,
          exitReason,
          pnlPct: pnlPct - (COMMISSION_PCT * 2 * LEVERAGE / 100 * 100),
          pnlUsd: pnlUsd - fee,
          entryTime: new Date(candles[position.bar].time).toISOString(),
          exitTime: new Date(c.time).toISOString(),
          bars: i - position.bar,
        });
        position = null;
      }
    }

    // ── 2. 지표 값 ──
    const efst = emaFast[i];
    const eslw = emaSlow[i];

    // Trend
    let upCnt = 0, downCnt = 0;
    for (let j = Math.max(0, i - 14); j <= i; j++) {
      if (emaFast[j] > emaSlow[j]) upCnt++;
      if (emaFast[j] < emaSlow[j]) downCnt++;
    }
    const bullTrend = upCnt >= 9;
    const bearTrend = downCnt >= 9;
    const trendState = bullTrend ? "bull" : bearTrend ? "bear" : "neutral";

    // [FIX-1] 실제 4H RSI 사용
    const htfRsi = htfRsiMap[i];
    const htfState = htfRsi > 55 ? "bull" : htfRsi < 45 ? "bear" : "neutral";

    // Stochastic
    const kVal = stoch.k[i] || 50;
    const dVal = stoch.d[i] || 50;
    const prevK = stoch.k[i-1] || 50;
    const prevD = stoch.d[i-1] || 50;
    const crossKdUp = prevK <= prevD && kVal > dVal;
    const crossKdDown = prevK >= prevD && kVal < dVal;

    // Volume
    const volRatio = volSma[i] > 0 ? volumes[i] / volSma[i] : 1;
    const volStrong = volRatio >= 1.2;

    // [FIX-2] 정확한 ADX 사용
    const adx = adxVals[i] || 20;
    const regimeState = adx >= 25 ? "trend" : adx <= 18 ? "range" : "transition";

    // ADOL (HMA)
    const adolHma = hmaVals[i] || closes[i];
    const adolHmaPrev = hmaVals[i-1] || closes[i-1];
    const adolMomFast = adolHma - (hmaVals[i-3] || closes[i-3]);

    // Ichimoku
    const baseLine = ichi.base[i] || closes[i];

    // TD Sequential
    let tdBuy = 0, tdSell = 0;
    if (i >= 4) {
      for (let j = i; j >= Math.max(4, i - 12); j--) {
        if (closes[j] < closes[j-4]) tdBuy++;
        else break;
      }
      for (let j = i; j >= Math.max(4, i - 12); j--) {
        if (closes[j] > closes[j-4]) tdSell++;
        else break;
      }
    }

    // ── 3. 스코어 계산 (Gradient) ──
    const trendSep = eslw > 0 ? (efst - eslw) / eslw : 0;
    const trendConsist = upCnt / 15;
    const strTrendL = 0.5 * clamp01(trendSep / 0.02) + 0.5 * trendConsist;
    const strTrendS = 0.5 * clamp01(-trendSep / 0.02) + 0.5 * (downCnt / 15);

    const strHtfL = clamp01((htfRsi - 50) / 30);
    const strHtfS = clamp01((50 - htfRsi) / 30);

    const strTdL = clamp01(tdBuy / 9);
    const strTdS = clamp01(tdSell / 9);

    const strStochL = 0.6 * clamp01((kVal - 50) / 50) + 0.4 * clamp01((kVal - dVal) / 20);
    const strStochS = 0.6 * clamp01((50 - kVal) / 50) + 0.4 * clamp01((dVal - kVal) / 20);

    const strVolL = clamp01((volRatio - 0.8) / 1.2);
    const strRegime = clamp01((adx - 18) / 7);

    const rawL = 0.30 * strTrendL + 0.20 * strHtfL + 0.18 * strTdL + 0.15 * strStochL + 0.12 * strVolL + 0.05 * strRegime;
    const rawS = 0.30 * strTrendS + 0.20 * strHtfS + 0.18 * strTdS + 0.15 * strStochS + 0.12 * strVolL + 0.05 * strRegime;
    const score = (rawL - rawS) * 100;

    // ── 4. Posterior 계산 ──
    const htfRsiNorm = clamp01((htfRsi - 30) / 40);
    const ichiPos = c.close > baseLine ? 1.0 : c.close < baseLine * 0.98 ? 0.0 : 0.5;
    const priorLong = 0.4 * htfRsiNorm + 0.3 * ichiPos + 0.3 * 0.5;

    const scoreNorm = clamp(score / 100, -1, 1);
    let waveLong = 0.5 + 0.3 * scoreNorm + 0.1 * (c.close > adolHma ? 1 : -1) + 0.1 * (adolMomFast > 0 ? 1 : -1);
    waveLong = clamp(waveLong, 0.05, 0.95);

    const conf = Math.abs(waveLong - 0.5) * 2;
    const lambdaPost = 0.15 + 0.80 * conf;
    const logitPost = (1 - lambdaPost) * logit(priorLong) + lambdaPost * logit(waveLong);
    const postLong = sigmoid(logitPost);
    const postShort = 1 - postLong;

    // ── 5. 위치 필터 ──
    let posHigh = -Infinity, posLow = Infinity;
    for (let j = Math.max(0, i - 19); j <= i; j++) {
      posHigh = Math.max(posHigh, highs[j]);
      posLow = Math.min(posLow, lows[j]);
    }
    const posRange = posHigh - posLow;
    const posPct = posRange > 0 ? (c.close - posLow) / posRange : 0.5;

    // ── 6. 신호 조건 ──

    // EARLY
    const earlySoftLong = c.close > adolHma && adolHma > adolHmaPrev && adolMomFast > 0 && score >= 20 && trendState !== "bear" && htfState !== "bear";
    const earlySoftShort = c.close < adolHma && adolHma < adolHmaPrev && adolMomFast < 0 && score <= -20 && trendState !== "bull" && htfState !== "bull";

    // [FIX-3] v2.6.5 sync CORE — posterior 0.56 (기존 0.53 버그 수정)
    const coreLong = (htfState === "bull" || trendState === "bull") && score >= 5 && c.close >= baseLine && postLong >= 0.53
      && score >= 20 && postLong >= 0.56  // ← FIX: 0.53 → 0.56 (PATCH-53 정확 반영)
      && (posPct <= 0.80 || score >= 40)
      && !(kVal >= 78 && score < 50)
      && regimeState !== "range";

    const coreShort = (htfState === "bear" || trendState === "bear") && score <= -5 && c.close <= baseLine && postShort >= 0.53
      && score <= -20 && postShort >= 0.56  // ← FIX: 0.53 → 0.56
      && (posPct >= 0.20 || score <= -40)
      && !(kVal <= 22 && score > -50)
      && regimeState !== "range";

    // HTF 역방향 페널티
    const coreLongFinal = coreLong && (htfState !== "bear" || score >= 35);
    const coreShortFinal = coreShort && (htfState !== "bull" || score <= -35);

    // [FIX-4] PRE_REAL — PATCH-55: posterior 0.58 + vol ≥ 1.0 + K 방향
    const preRealLong = coreLongFinal && score >= 25 && postLong >= 0.58
      && volRatio >= 1.0 && kVal > prevK
      && (htfState !== "bear" || score >= 50);
    const preRealShort = coreShortFinal && score <= -25 && postShort >= 0.58
      && volRatio >= 1.0 && kVal < prevK
      && (htfState !== "bull" || score <= -50);

    // REAL (v2.6.5)
    const realLong = coreLongFinal && score >= 25 && volStrong && (crossKdUp || (score >= 20 && postLong >= 0.60 && kVal <= 35 && kVal > prevK)) && postLong >= 0.57 && (posPct <= 0.70 || score >= 35);
    const realShort = coreShortFinal && score <= -25 && volStrong && (crossKdDown || (score <= -20 && postShort >= 0.60 && kVal >= 65 && kVal < prevK)) && postShort >= 0.57 && (posPct >= 0.30 || score <= -35);

    // ── 7. 진입 결정 ──
    if (position) continue;

    const cooldownLong = (i - lastLongBar >= cooldownBars) && (i - lastShortBar >= 3 || score >= 35);
    const cooldownShort = (i - lastShortBar >= cooldownBars) && (i - lastLongBar >= 3 || score <= -35);

    let tier = null, side = null;

    if (realLong && cooldownLong) { tier = "REAL"; side = "LONG"; signalCounts.REAL_LONG++; }
    else if (realShort && cooldownShort) { tier = "REAL"; side = "SHORT"; signalCounts.REAL_SHORT++; }
    else if (preRealLong && cooldownLong) { tier = "PRE_REAL"; side = "LONG"; signalCounts.PRE_REAL_LONG++; }
    else if (preRealShort && cooldownShort) { tier = "PRE_REAL"; side = "SHORT"; signalCounts.PRE_REAL_SHORT++; }
    else if (coreLongFinal && cooldownLong) { tier = "CORE"; side = "LONG"; signalCounts.CORE_LONG++; }
    else if (coreShortFinal && cooldownShort) { tier = "CORE"; side = "SHORT"; signalCounts.CORE_SHORT++; }
    else if (earlySoftLong && cooldownLong) { tier = "EARLY"; side = "LONG"; signalCounts.EARLY_LONG++; }
    else if (earlySoftShort && cooldownShort) { tier = "EARLY"; side = "SHORT"; signalCounts.EARLY_SHORT++; }

    if (tier && side) {
      const entry = c.close;
      if (side === "LONG") {
        position = {
          side, entry, tier, bar: i, tpHit: false,
          sl: entry * (1 - SL_PCT / 100),
          tp: entry * (1 + TP_PCT / 100),
          trailStop: entry * (1 - TRAIL_PCT / 100),
          highWm: c.high, lowWm: c.low,
        };
        lastLongBar = i;
      } else {
        position = {
          side, entry, tier, bar: i, tpHit: false,
          sl: entry * (1 + SL_PCT / 100),
          tp: entry * (1 - TP_PCT / 100),
          trailStop: entry * (1 + TRAIL_PCT / 100),
          highWm: c.high, lowWm: c.low,
        };
        lastShortBar = i;
      }
    }
  }

  return { trades, signalCounts };
}

// ─── 리포트 생성 ───
function generateReport(allResults) {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" 돈벌자 Pine v5.6.0.2 — 백테스트 결과 (v2: 버그수정+PATCH-55)");
  console.log(" 기간: 최근 " + DAYS_BACK + "일 | 1H | Binance Futures");
  console.log(" 자본: $" + INITIAL_CAPITAL + " | 포지션: " + POSITION_SIZE_PCT + "% | 레버리지: x" + LEVERAGE);
  console.log(" Exit: SL " + SL_PCT + "% / TP " + TP_PCT + "% / Trail " + TRAIL_PCT + "%");
  console.log(" 수정: HTF RSI(4H캔들), ADX(정확), CORE post≥0.56, PRE_REAL PATCH-55");
  console.log("═══════════════════════════════════════════════════════════");

  let allTrades = [];
  const symbolResults = {};

  for (const { symbol, trades, signalCounts } of allResults) {
    symbolResults[symbol] = { trades, signalCounts };
    allTrades = allTrades.concat(trades);
  }

  // ── 1. 전체 요약 ──
  console.log("\n━━━ 1. 전체 요약 ━━━");
  printTradeStats(allTrades, "전체");

  // ── 2. 종목별 ──
  console.log("\n━━━ 2. 종목별 성과 ━━━");
  console.log("종목       | 건수 | 승률  | 순이익(USD) |   PF   | SL% | 평균봉");
  console.log("───────────┼──────┼───────┼─────────────┼────────┼─────┼──────");
  for (const sym of SYMBOLS) {
    const t = symbolResults[sym]?.trades || [];
    if (t.length === 0) { console.log(`${sym.padEnd(10)} | ${String(0).padStart(4)} | N/A`); continue; }
    const wins = t.filter(x => x.pnlUsd > 0);
    const losses = t.filter(x => x.pnlUsd < 0);
    const grossW = wins.reduce((s,x) => s + x.pnlUsd, 0);
    const grossL = Math.abs(losses.reduce((s,x) => s + x.pnlUsd, 0));
    const pf = grossL > 0 ? (grossW / grossL).toFixed(2) : (grossW > 0 ? "INF" : "0.00");
    const wr = (wins.length / t.length * 100).toFixed(0);
    const netPnl = t.reduce((s,x) => s + x.pnlUsd, 0);
    const slCount = t.filter(x => x.exitReason === "SL").length;
    const slPct = (slCount / t.length * 100).toFixed(0);
    const avgBars = (t.reduce((s,x) => s + x.bars, 0) / t.length).toFixed(0);
    const v = netPnl >= 0 ? "✅" : "❌";
    console.log(`${sym.padEnd(10)} | ${String(t.length).padStart(4)} | ${wr.padStart(3)}%  | ${(netPnl >= 0 ? "+" : "") + netPnl.toFixed(1).padStart(10)} | ${pf.padStart(6)} | ${slPct.padStart(3)}% | ${avgBars.padStart(4)}  ${v}`);
  }

  // ── 3. 진입 등급별 ──
  console.log("\n━━━ 3. 진입 등급별 성과 ━━━");
  for (const tier of ["EARLY", "CORE", "PRE_REAL", "REAL"]) {
    const t = allTrades.filter(x => x.tier === tier);
    if (t.length > 0) printTradeStats(t, tier);
  }

  // ── 4. LONG vs SHORT ──
  console.log("\n━━━ 4. LONG vs SHORT ━━━");
  const longs = allTrades.filter(x => x.side === "LONG");
  const shorts = allTrades.filter(x => x.side === "SHORT");
  if (longs.length > 0) printTradeStats(longs, "LONG");
  if (shorts.length > 0) printTradeStats(shorts, "SHORT");

  // ── 5. 월별 ──
  console.log("\n━━━ 5. 월별 성과 ━━━");
  const monthMap = {};
  for (const t of allTrades) {
    const m = t.exitTime.slice(0, 7);
    if (!monthMap[m]) monthMap[m] = { pnl: 0, count: 0, wins: 0 };
    monthMap[m].pnl += t.pnlUsd;
    monthMap[m].count++;
    if (t.pnlUsd > 0) monthMap[m].wins++;
  }
  for (const [m, d] of Object.entries(monthMap).sort()) {
    const wr = (d.wins / d.count * 100).toFixed(0);
    console.log(`  ${m}: ${d.count}건 | 승률: ${wr}% | PnL: ${d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(2)} USD ${d.pnl >= 0 ? "✅" : "❌"}`);
  }

  // ── 6. 신호 발생 횟수 ──
  console.log("\n━━━ 6. 신호 발생 횟수 ━━━");
  for (const { symbol, signalCounts } of allResults) {
    const total = Object.values(signalCounts).reduce((s, v) => s + v, 0);
    if (total === 0) continue;
    console.log(`  ${symbol}: 총${total}건 | EL:${signalCounts.EARLY_LONG} ES:${signalCounts.EARLY_SHORT} CL:${signalCounts.CORE_LONG} CS:${signalCounts.CORE_SHORT} pRL:${signalCounts.PRE_REAL_LONG} pRS:${signalCounts.PRE_REAL_SHORT} RL:${signalCounts.REAL_LONG} RS:${signalCounts.REAL_SHORT}`);
  }

  // ── 7. 최대 낙폭 (MDD) ──
  console.log("\n━━━ 7. 자본 곡선 & MDD ━━━");
  let equity = INITIAL_CAPITAL;
  let peak = equity;
  let maxDD = 0;
  const sortedTrades = [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime));
  for (const t of sortedTrades) {
    equity += t.pnlUsd;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  console.log(`  시작 자본: $${INITIAL_CAPITAL.toFixed(2)}`);
  console.log(`  최종 자본: $${equity.toFixed(2)}`);
  console.log(`  순이익: ${equity - INITIAL_CAPITAL >= 0 ? "+" : ""}$${(equity - INITIAL_CAPITAL).toFixed(2)} (${((equity - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100).toFixed(2)}%)`);
  console.log(`  최대 낙폭(MDD): -${maxDD.toFixed(2)}%`);
  console.log(`  총 거래: ${sortedTrades.length}건`);

  // ── 8. 청산 유형 분포 ──
  console.log("\n━━━ 8. 청산 유형 분포 ━━━");
  const exitReasons = {};
  for (const t of allTrades) {
    const key = t.exitReason;
    if (!exitReasons[key]) exitReasons[key] = { count: 0, pnl: 0, wins: 0 };
    exitReasons[key].count++;
    exitReasons[key].pnl += t.pnlUsd;
    if (t.pnlUsd > 0) exitReasons[key].wins++;
  }
  for (const [reason, d] of Object.entries(exitReasons).sort((a,b) => b[1].count - a[1].count)) {
    const wr = (d.wins / d.count * 100).toFixed(0);
    console.log(`  ${reason}: ${d.count}건 (${(d.count / allTrades.length * 100).toFixed(1)}%) | 승률: ${wr}% | PnL: ${d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(2)}`);
  }

  // ── 9. 등급×종목 성과 매트릭스 ──
  console.log("\n━━━ 9. 등급×종목 성과 매트릭스 ━━━");
  console.log("종목       | EARLY      | CORE       | PRE_REAL   | REAL");
  console.log("───────────┼────────────┼────────────┼────────────┼──────────");
  for (const sym of SYMBOLS) {
    const parts = [];
    for (const tier of ["EARLY", "CORE", "PRE_REAL", "REAL"]) {
      const t = allTrades.filter(x => x.symbol === sym && x.tier === tier);
      if (t.length === 0) { parts.push("  -  ".padEnd(10)); continue; }
      const w = t.filter(x => x.pnlUsd > 0).length;
      const pnl = t.reduce((s,x) => s + x.pnlUsd, 0);
      parts.push(`${t.length}건 ${(pnl >= 0 ? "+" : "")}${pnl.toFixed(0)}`.padEnd(10));
    }
    console.log(`${sym.padEnd(10)} | ${parts.join(" | ")}`);
  }
}

function printTradeStats(trades, label) {
  const wins = trades.filter(x => x.pnlUsd > 0);
  const losses = trades.filter(x => x.pnlUsd < 0);
  const grossW = wins.reduce((s,x) => s + x.pnlUsd, 0);
  const grossL = Math.abs(losses.reduce((s,x) => s + x.pnlUsd, 0));
  const netPnl = trades.reduce((s,x) => s + x.pnlUsd, 0);
  const pf = grossL > 0 ? (grossW / grossL).toFixed(3) : (grossW > 0 ? "INF" : "0");
  const wr = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : "0.0";
  const avgW = wins.length > 0 ? (grossW / wins.length).toFixed(2) : "0.00";
  const avgL = losses.length > 0 ? (grossL / losses.length).toFixed(2) : "0.00";
  const rr = (losses.length > 0 && wins.length > 0) ? ((grossW/wins.length) / (grossL/losses.length)).toFixed(2) : "N/A";
  const avgBars = trades.length > 0 ? (trades.reduce((s,x) => s + x.bars, 0) / trades.length).toFixed(1) : "0";

  console.log(`\n  ▶ ${label} (${trades.length}건)`);
  console.log(`    승률: ${wr}% (${wins.length}승 / ${losses.length}패)`);
  console.log(`    순이익: ${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} USD`);
  console.log(`    Profit Factor: ${pf}`);
  console.log(`    평균승: +$${avgW} | 평균패: -$${avgL} | R:R = ${rr}`);
  console.log(`    평균 보유: ${avgBars}봉`);

  const sorted = [...trades].sort((a,b) => b.pnlUsd - a.pnlUsd);
  if (sorted.length >= 3) {
    console.log(`    최고: ${sorted[0].symbol} +$${sorted[0].pnlUsd.toFixed(2)} (${sorted[0].tier} ${sorted[0].side})`);
    console.log(`    최저: ${sorted[sorted.length-1].symbol} $${sorted[sorted.length-1].pnlUsd.toFixed(2)} (${sorted[sorted.length-1].tier} ${sorted[sorted.length-1].side})`);
  }
}

// ─── 메인 실행 ───
async function main() {
  console.log("데이터 수집 중...");
  const limit = DAYS_BACK * 24;
  const allResults = [];

  for (const sym of SYMBOLS) {
    try {
      process.stdout.write(`  ${sym}...`);
      const candles = await fetchKlines(sym, INTERVAL, Math.min(limit, 1500));
      process.stdout.write(` ${candles.length}봉\n`);
      const result = backtest(candles, sym);
      allResults.push({ symbol: sym, ...result });
    } catch (e) {
      console.log(` 실패: ${e.message}`);
      allResults.push({ symbol: sym, trades: [], signalCounts: {} });
    }
  }

  generateReport(allResults);
}

main().catch(e => { console.error(e); process.exit(1); });
