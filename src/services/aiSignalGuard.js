const { fetchNews } = require("./newsFetch");
const { callOpenAI, safeJsonParse } = require("./openaiClient");
const { callClaude } = require("./claudeClient");
const { getUpbitAccountSummary } = require("./upbitAccountSummary");
const { getBinanceFuturesAccountSummary } = require("./binanceFuturesAccountSummary");
const { fetchAccount: fetchKiwoomAccount } = require("../exchanges/kiwoomRest");
const { fetchCandles } = require("../exchanges");
const { getAiGuardSettingsCached } = require("../storage/settings");
const { getFirestore } = require("../storage/firestore");
const { getExchangeSettingsForProvider, getRiskBudgetForProvider } = require("../utils/exchangeSettings");
const { normalizeMarketSymbolForProvider, normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { normalizeProviderId } = require("../utils/providerUtils");
const { resolveBinanceFuturesKeys } = require("../utils/binanceKeyResolver");
const { normalizePositionSide } = require("../utils/positionSide");
const { listExchangePositionReadViews } = require("./positionReadModel");


const DECISION_CACHE_TTL_MS = Number(process.env.SIGNAL_AI_CACHE_TTL_MS || 60_000);
const ACCOUNT_CACHE_TTL_MS = Number(process.env.SIGNAL_AI_ACCOUNT_CACHE_TTL_MS || 30_000);
const CORR_CACHE_TTL_MS = Number(process.env.SIGNAL_AI_CORR_CACHE_TTL_MS || 600_000);
const BENCH_CACHE_TTL_MS = Number(process.env.SIGNAL_AI_BENCH_CACHE_TTL_MS || CORR_CACHE_TTL_MS);
const POSITIONS_CACHE_TTL_MS = Number(process.env.SIGNAL_AI_POSITIONS_CACHE_TTL_MS || 15_000);
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const decisionCache = new Map();
const accountCache = new Map();
const corrCache = new Map();
const benchCache = new Map();
const positionsCache = new Map();

function nowMs() {
  return Date.now();
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const s = String(raw).trim().toLowerCase();
  if (!s) return fallback;
  return !(s === "0" || s === "false" || s === "no" || s === "off");
}

function clamp01(n) {
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampIntRange(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function sideToPositionDir(side) {
  const s = String(side || "").trim().toUpperCase();
  if (s === "BUY") return "LONG";
  if (s === "SELL") return "SHORT";
  return null;
}

function normalizePositionSnapshot(pos) {
  if (!pos || typeof pos !== "object") {
    return { active: false, side: null, size_pct: 0 };
  }
  const sizeRaw = pos.size_pct ?? pos.sizePct ?? pos.qty_pct ?? pos.qtyPct ?? 0;
  const sizePct = Number(sizeRaw);
  const active = Number.isFinite(sizePct) && sizePct > 0;
  const side = normalizePositionSide(pos.position_side || pos.positionSide || pos.side || null);
  return { active, side, size_pct: active ? sizePct : 0 };
}

function normalizeIntentWithPosition({ intent, side, currentPosition } = {}) {
  const intentRaw = String(intent || "").trim().toUpperCase();
  if (intentRaw !== "ENTRY" && intentRaw !== "ADD") {
    return { intent: intentRaw || null, reason: null, posActive: null, posSide: null };
  }
  const posSnap = normalizePositionSnapshot(currentPosition);
  if (intentRaw === "ADD" && !posSnap.active) {
    return { intent: "ENTRY", reason: "POS_FLAT_ADD_TO_ENTRY", posActive: posSnap.active, posSide: posSnap.side };
  }
  return { intent: intentRaw, reason: null, posActive: posSnap.active, posSide: posSnap.side };
}

function lastKstAnchorMs(nowMs, anchorHourKst) {
  const kst = new Date(nowMs + KST_OFFSET_MS);
  const anchorUtcMs = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
    anchorHourKst,
    0,
    0
  ) - KST_OFFSET_MS;
  if (nowMs < anchorUtcMs) return anchorUtcMs - DAY_MS;
  return anchorUtcMs;
}

function resolveSignalNewsWindow(nowMs) {
  const windowDays = clampIntRange(process.env.SIGNAL_AI_NEWS_WINDOW_DAYS, 1, 30, 1);
  const anchorHour = clampIntRange(process.env.SIGNAL_AI_NEWS_ANCHOR_HOUR_KST, 0, 23, 7);
  const anchorMs = lastKstAnchorMs(nowMs, anchorHour);
  const fromMs = anchorMs - (windowDays - 1) * DAY_MS;
  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(nowMs).toISOString(),
    windowDays,
    anchorHour,
  };
}

function isRetryableReason(reason) {
  const r = String(reason || "").toLowerCase();
  return (
    r.includes("timeout") ||
    r.includes("fetch failed") ||
    r.includes("econn") ||
    r.includes("socket") ||
    r.includes("enotfound") ||
    r.includes("http_429") ||
    r.includes("http_5") ||
    r.includes("http_502") ||
    r.includes("http_503") ||
    r.includes("http_504")
  );
}

function normalizeMarketToken(raw) {
  const s = String(raw || "").toUpperCase();
  if (!s) return null;
  const v = s.replace("KRW-", "").replace("USDT", "").replace(".P", "").replace("KRX:", "");
  const token = v.replace(/[^A-Z0-9]/g, "").trim();
  return token || null;
}

function mean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const v of arr) {
    if (!Number.isFinite(v)) continue;
    sum += v;
    n += 1;
  }
  if (!n) return null;
  return sum / n;
}

function stddev(arr, mu) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const m = Number.isFinite(mu) ? mu : mean(arr);
  if (!Number.isFinite(m)) return null;
  let sumSq = 0;
  let n = 0;
  for (const v of arr) {
    if (!Number.isFinite(v)) continue;
    const d = v - m;
    sumSq += d * d;
    n += 1;
  }
  if (!n) return null;
  return Math.sqrt(sumSq / n);
}

function calcLogReturns(closes) {
  const out = [];
  if (!Array.isArray(closes)) return out;
  for (let i = 1; i < closes.length; i += 1) {
    const prev = Number(closes[i - 1]);
    const cur = Number(closes[i]);
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0 || cur <= 0) continue;
    out.push(Math.log(cur / prev));
  }
  return out;
}

function computeCorrBetaFromCloses(assetCloses, benchCloses, minPoints) {
  const aRet = calcLogReturns(assetCloses);
  const bRet = calcLogReturns(benchCloses);
  const n = Math.min(aRet.length, bRet.length);
  if (!Number.isFinite(n) || n <= 0) return { corr: null, beta: null, n: 0 };
  const need = Number.isFinite(minPoints) ? minPoints : 0;
  if (n < need) return { corr: null, beta: null, n };
  const a = aRet.slice(-n);
  const b = bRet.slice(-n);
  const ma = mean(a);
  const mb = mean(b);
  const sa = stddev(a, ma);
  const sb = stddev(b, mb);
  if (!Number.isFinite(sa) || !Number.isFinite(sb) || sa <= 0 || sb <= 0) {
    return { corr: null, beta: null, n };
  }
  let cov = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
    cov += da * db;
    count += 1;
  }
  if (!count) return { corr: null, beta: null, n };
  const corr = Math.max(-1, Math.min(1, cov / (count * sa * sb)));
  const beta = corr * (sa / sb);
  return { corr, beta, n: count };
}

function isCryptoProvider(exchange) {
  const ex = normalizeProviderId(exchange || "");
  return ex === "BINANCEFUT" || ex === "BINANCE";
}

function resolveBtcBenchmarkSymbol(exchange) {
  const ex = normalizeProviderId(exchange || "");
  if (ex === "BINANCEFUT" || ex === "BINANCE") return "BTCUSDT";
  return null;
}

function fallbackCorrBetaForToken(token) {
  const t = String(token || "").toUpperCase();
  const isMajor = t === "BTC" || t === "ETH";
  return {
    corr: isMajor ? 0.8 : 0.5,
    beta: isMajor ? 1.0 : 0.7,
    major: isMajor,
    source: "fallback",
  };
}

function calcHedgeScale(corrMag) {
  if (!Number.isFinite(corrMag)) return 0.35;
  const raw = 0.5 - 0.5 * Math.min(1, Math.max(0, corrMag));
  return Math.max(0.2, Math.min(0.5, raw));
}

function extractPositionSymbol(pos, exchange) {
  const raw = (pos && (pos.symbol_or_pair_id || pos.symbol || pos.market || pos.market_id)) ? String(pos.symbol_or_pair_id || pos.symbol || pos.market || pos.market_id) : "";
  const norm = normalizeMarketSymbolForProvider(raw, exchange);
  return norm || raw || null;
}

function extractPositionSizePct(pos) {
  const sizeRaw = pos ? (pos.size_pct ?? pos.sizePct ?? pos.qty_pct ?? pos.qtyPct ?? pos.qty ?? 0) : 0;
  const size = Number(sizeRaw);
  return Number.isFinite(size) ? size : 0;
}

function extractPositionSide(pos) {
  const side = normalizePositionSide(pos && (pos.position_side || pos.positionSide || pos.side || pos.position));
  return side || "LONG";
}

async function listActivePositionsByExchange(exchange) {
  const ex = normalizeProviderId(exchange || "");
  const cached = positionsCache.get(ex);
  const now = nowMs();
  if (cached && (now - cached.ts) <= POSITIONS_CACHE_TTL_MS) return cached.data;
  let rows = [];
  try {
    rows = await listExchangePositionReadViews({ exchange: ex });
  } catch (err) {
    console.warn("[AI_SIGNAL][CROSS_ASSET_POSITIONS_FAIL]", { exchange: ex, reason: err && err.message ? err.message : String(err) });
    rows = [];
  }
  const active = rows.filter((p) => extractPositionSizePct(p) > 0);
  positionsCache.set(ex, { ts: now, data: active });
  return active;
}

async function fetchBenchmarkCandles(exchange, tf, count) {
  const ex = normalizeProviderId(exchange || "");
  const bench = resolveBtcBenchmarkSymbol(ex);
  if (!bench) return null;
  const benchNorm = normalizeMarketSymbolForProvider(bench, ex);
  if (!benchNorm) return null;
  const key = `${ex}|${benchNorm}|${tf}|${count}`;
  const cached = benchCache.get(key);
  const now = nowMs();
  if (cached && (now - cached.ts) <= BENCH_CACHE_TTL_MS) return cached.data;
  try {
    const bars = await fetchCandles(ex, benchNorm, tf, count);
    benchCache.set(key, { ts: now, data: bars });
    return bars;
  } catch (err) {
    console.warn("[AI_SIGNAL][CROSS_ASSET_BENCH_FAIL]", { exchange: ex, bench: benchNorm, tf, reason: err && err.message ? err.message : String(err) });
    return null;
  }
}

async function fetchCorrBetaToBtc({ exchange, symbol, tf, window, minPoints }) {
  const ex = normalizeProviderId(exchange || "");
  const bench = resolveBtcBenchmarkSymbol(ex);
  if (!bench) return null;
  const symNorm = normalizeMarketSymbolForProvider(symbol, ex);
  const benchNorm = normalizeMarketSymbolForProvider(bench, ex);
  if (!symNorm || !benchNorm) return null;
  if (symNorm === benchNorm) {
    return { corr: 1, beta: 1, n: null, symbol: symNorm, bench: benchNorm, source: "benchmark" };
  }
  const key = `${ex}|${symNorm}|${tf}|${window}|${minPoints}`;
  const cached = corrCache.get(key);
  const now = nowMs();
  if (cached && (now - cached.ts) <= CORR_CACHE_TTL_MS) return cached.data;
  let assetBars = null;
  let benchBars = null;
  try {
    const count = window + 1;
    [assetBars, benchBars] = await Promise.all([
      fetchCandles(ex, symNorm, tf, count),
      fetchBenchmarkCandles(ex, tf, count),
    ]);
  } catch (err) {
    console.warn("[AI_SIGNAL][CROSS_ASSET_CORR_FAIL]", { exchange: ex, symbol: symNorm, tf, reason: err && err.message ? err.message : String(err) });
    return null;
  }
  if (!Array.isArray(assetBars) || !Array.isArray(benchBars)) return null;
  const assetCloses = assetBars.map((b) => Number(b.close ?? b.c)).filter((v) => Number.isFinite(v));
  const benchCloses = benchBars.map((b) => Number(b.close ?? b.c)).filter((v) => Number.isFinite(v));
  const calc = computeCorrBetaFromCloses(assetCloses, benchCloses, minPoints);
  if (!calc || !Number.isFinite(calc.corr) || !Number.isFinite(calc.beta)) return null;
  const data = { corr: calc.corr, beta: calc.beta, n: calc.n, symbol: symNorm, bench: benchNorm, source: "computed" };
  corrCache.set(key, { ts: now, data });
  return data;
}

async function evaluateCrossAssetOpposite({ exchange, symbol, side, intent, qtyPct, account } = {}) {
  const enabled = boolEnv("SIGNAL_AI_CROSS_ASSET_ENABLED", true);
  if (!enabled) return null;
  const intentUpper = String(intent || "").toUpperCase();
  if (intentUpper !== "ENTRY" && intentUpper !== "ADD") return null;
  if (!isCryptoProvider(exchange)) return null;
  const sigDir = sideToPositionDir(side);
  if (!sigDir) return null;
  const qty = Number(qtyPct);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const ex = normalizeProviderId(exchange || "");
  const symbolNorm = normalizeMarketSymbolForProvider(symbol, ex);
  if (!symbolNorm) return null;

  const positionsAll = await listActivePositionsByExchange(ex);
  const positions = positionsAll.filter((p) => {
    const posSym = extractPositionSymbol(p, ex);
    return posSym && posSym !== symbolNorm && extractPositionSizePct(p) > 0;
  });
  if (!positions.length) return null;

  const corrWindow = clampIntRange(process.env.SIGNAL_AI_CORR_WINDOW, 30, 300, 120);
  const corrMinPoints = clampIntRange(process.env.SIGNAL_AI_CORR_MIN_POINTS, 20, 200, 60);
  const exCfg = await getExchangeSettingsForProvider(ex, 2000).catch(() => null);
  const corrTfRaw =
    normalizeTf(process.env.SIGNAL_AI_CORR_TF || (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv())
    || normalizeTf((exCfg && exCfg.exec_tf) || defaultExecTfFromEnv())
    || "15m";
  const maxPositions = clampIntRange(process.env.SIGNAL_AI_CROSS_ASSET_MAX_POSITIONS, 1, 20, 10);
  const highCorr = Number(process.env.SIGNAL_AI_CROSS_ASSET_HIGH_CORR || 0.6);
  const midCorr = Number(process.env.SIGNAL_AI_CROSS_ASSET_MID_CORR || 0.3);
  const minScale = Number(process.env.SIGNAL_AI_CROSS_ASSET_MIN_SCALE || 0.05);

  const valueBase = (account && account.ok && Number.isFinite(Number(account.total_value)) && Number(account.total_value) > 0)
    ? Number(account.total_value)
    : 1;

  const sorted = positions
    .map((p) => ({ p, size: extractPositionSizePct(p) }))
    .sort((a, b) => b.size - a.size)
    .slice(0, maxPositions)
    .map((x) => x.p);

  const posInfos = [];
  let netExposure = 0;
  for (const pos of sorted) {
    const posSymbol = extractPositionSymbol(pos, ex);
    if (!posSymbol) continue;
    const sizePct = extractPositionSizePct(pos);
    if (!Number.isFinite(sizePct) || sizePct <= 0) continue;
    const posSide = extractPositionSide(pos);
    const posSign = posSide === "SHORT" ? -1 : 1;
    const token = normalizeMarketToken(posSymbol);
    const fallback = fallbackCorrBetaForToken(token);
    let corr = fallback.corr;
    let beta = fallback.beta;
    let corrSource = fallback.source;
    let corrN = null;
    const corrData = await fetchCorrBetaToBtc({
      exchange: ex,
      symbol: posSymbol,
      tf: corrTfRaw,
      window: corrWindow,
      minPoints: corrMinPoints,
    });
    if (corrData && Number.isFinite(corrData.corr) && Number.isFinite(corrData.beta)) {
      corr = corrData.corr;
      beta = corrData.beta;
      corrSource = corrData.source;
      corrN = corrData.n;
    }
    if (!Number.isFinite(beta) || beta === 0) beta = fallback.beta;
    const value = sizePct * valueBase;
    netExposure += posSign * value * beta;
    posInfos.push({
      symbol: posSymbol,
      side: posSide,
      size_pct: sizePct,
      corr,
      corr_n: corrN,
      corr_source: corrSource,
      beta,
    });
  }

  if (!posInfos.length) return null;
  const netAbs = Math.abs(netExposure);
  if (!Number.isFinite(netAbs) || netAbs <= 1e-9) return null;

  const sigSign = sigDir === "SHORT" ? -1 : 1;
  const opposite = netExposure > 0 ? sigSign < 0 : sigSign > 0;
  if (!opposite) return null;

  const sigToken = normalizeMarketToken(symbolNorm);
  const sigFallback = fallbackCorrBetaForToken(sigToken);
  let sigCorr = sigFallback.corr;
  let sigBeta = sigFallback.beta;
  let sigCorrSource = sigFallback.source;
  let sigCorrN = null;
  const sigCorrData = await fetchCorrBetaToBtc({
    exchange: ex,
    symbol: symbolNorm,
    tf: corrTfRaw,
    window: corrWindow,
    minPoints: corrMinPoints,
  });
  if (sigCorrData && Number.isFinite(sigCorrData.corr) && Number.isFinite(sigCorrData.beta)) {
    sigCorr = sigCorrData.corr;
    sigBeta = sigCorrData.beta;
    sigCorrSource = sigCorrData.source;
    sigCorrN = sigCorrData.n;
  }
  if (!Number.isFinite(sigBeta) || sigBeta === 0) sigBeta = sigFallback.beta;

  const sigValue = qty * valueBase;
  const sigExposure = sigSign * sigValue * sigBeta;
  const corrMag = Number.isFinite(sigCorr) ? Math.abs(sigCorr) : Math.abs(sigFallback.corr);

  let corrLevel = "LOW";
  if (corrMag >= highCorr) corrLevel = "HIGH";
  else if (corrMag >= midCorr) corrLevel = "MID";

  let scale = 1;
  let decision = "ALLOW";
  let reason = "CROSS_ASSET_OPPOSITE_LOW_CORR";

  if (corrLevel === "HIGH") {
    let scaleBase = calcHedgeScale(corrMag);
    if (Number.isFinite(sigExposure) && sigExposure !== 0) {
      const maxNeutral = netAbs / Math.abs(sigExposure);
      if (Number.isFinite(maxNeutral)) scaleBase = Math.min(scaleBase, maxNeutral);
    }
    scale = scaleBase;
    if (!Number.isFinite(scale) || scale <= 0 || scale < minScale) {
      decision = "BLOCK";
      reason = "CROSS_ASSET_HEDGE_TOO_SMALL";
    } else {
      const netAfter = netExposure + sigExposure * scale;
      if (Math.abs(netAfter) >= netAbs) {
        decision = "BLOCK";
        reason = "CROSS_ASSET_OPPOSITE_HIGH_CORR";
      } else if (scale < 1) {
        decision = "REDUCE";
        reason = "CROSS_ASSET_HEDGE_HIGH_CORR";
      }
    }
  } else if (corrLevel === "MID") {
    scale = calcHedgeScale(corrMag);
    if (Number.isFinite(scale) && scale < 1) {
      decision = "REDUCE";
      reason = "CROSS_ASSET_HEDGE_MID_CORR";
    }
  }

  const qtyFinal = decision === "REDUCE" ? qty * scale : qty;
  const netAfter = Number.isFinite(sigExposure)
    ? netExposure + sigExposure * (decision === "REDUCE" ? scale : 1)
    : null;

  return {
    decision,
    qty_pct: qtyFinal,
    reason,
    meta: {
      enabled: true,
      decision,
      reason,
      exchange: ex,
      symbol: symbolNorm,
      sig_dir: sigDir,
      sig_qty_pct: qty,
      sig_qty_pct_final: qtyFinal,
      sig_corr: sigCorr,
      sig_corr_n: sigCorrN,
      sig_corr_source: sigCorrSource,
      sig_beta: sigBeta,
      corr_level: corrLevel,
      corr_tf: corrTfRaw,
      corr_window: corrWindow,
      net_exposure: netExposure,
      net_exposure_after: netAfter,
      positions_n: posInfos.length,
      positions: posInfos.slice(0, 5),
    },
  };
}

function buildKeywordsForProvider(provider, symbol) {
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const token = normalizeMarketToken(symbol);
  if (p === "KIWOOM") {
    const base = [
      "KOSPI",
      "KOSDAQ",
      "Korea stocks",
      "Korean stocks",
      "KRX",
      "DART",
      "공시",
      "실적",
      "환율",
      "금리",
      "반도체",
      "수출",
    ];
    if (token) base.push(token);
    return base;
  }
  const base = [
    "crypto",
    "bitcoin",
    "ethereum",
    "altcoin",
    "blockchain",
    "macro",
    "rates",
    "dollar",
    "equity",
  ];
  if (token) base.push(token);
  return base;
}

function buildAllowedDomainsForProvider(provider) {
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const base = [
    "reuters.com",
    "bloomberg.com",
    "ft.com",
    "wsj.com",
    "yahoo.com",
    "investing.com",
    "news.google.com",
    "naver.com",
    "daum.net",
  ];
  if (p === "KIWOOM") {
    return [
      ...base,
      "dart.fss.or.kr",
      "fss.or.kr",
      "kind.krx.co.kr",
      "krx.co.kr",
      "yna.co.kr",
      "mk.co.kr",
      "hankyung.com",
    ];
  }
  return [
    ...base,
    "coindesk.com",
    "cointelegraph.com",
    "theblock.co",
    "cryptoslate.com",
  ];
}

function extractProStatus(features) {
  const out = {};
  const feat = features || {};
  for (const [k, v] of Object.entries(feat)) {
    if (!k.startsWith("pro_")) continue;
    if (typeof v === "string") {
      const s = v.trim();
      out[k] = s.length > 180 ? s.slice(0, 180) : s;
    } else if (Number.isFinite(Number(v))) {
      out[k] = Number(v);
    } else if (v != null) {
      out[k] = v;
    }
  }
  return out;
}

function extractSignalMetrics(features) {
  const feat = features || {};
  const allow = new Set([
    "score",
    "score_norm",
    "score_panel",
    "signal_strength",
    "strength",
    "atr",
    "htf_rsi",
    "stoch_k",
    "volume_ratio",
    "band_width",
    "zz_wave_conf",
    "zz_bull_prob",
    "zz_bear_prob",
    "pos_state",
    "pos_dir",
    "tier_dir",
    "tier_phase",
    "action",
    "risk_label",
    "risk_txt",
    "env_txt",
    "wave_txt",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(feat)) {
    if (!allow.has(k)) continue;
    if (typeof v === "string") out[k] = v.trim().slice(0, 160);
    else if (Number.isFinite(Number(v))) out[k] = Number(v);
    else if (v != null) out[k] = v;
  }
  return out;
}

async function getAccountContext(provider) {
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const cached = accountCache.get(p);
  const now = nowMs();
  if (cached && (now - cached.ts) <= ACCOUNT_CACHE_TTL_MS) return cached.data;

  let data = { ok: false, provider: p, total_value: null, unit: p === "BINANCEFUT" ? "USDT" : "KRW", error: null };
  try {
    const ex = await getExchangeSettingsForProvider(p, 5000);
    if (p === "UPBIT") {
      const accessKey = String(process.env.UPBIT_ACCESS_KEY || (ex && ex.api_key) || "");
      const secretKey = String(process.env.UPBIT_SECRET_KEY || (ex && ex.api_secret) || "");
      if (!accessKey || !secretKey) throw new Error("UPBIT_KEYS_MISSING");
      const summary = await getUpbitAccountSummary({ accessKey, secretKey });
      const total = Number(summary && summary.total_krw);
      if (!Number.isFinite(total) || total <= 0) throw new Error("UPBIT_TOTAL_EMPTY");
      data = { ok: true, provider: p, total_value: total, unit: "KRW", source: "upbit_summary" };
    } else if (p === "BINANCEFUT") {
      const keys = await resolveBinanceFuturesKeys({ ttlMs: 5000 });
      const apiKey = String(keys && keys.apiKey || "");
      const apiSecret = String(keys && keys.apiSecret || "");
      if (!apiKey || !apiSecret) throw new Error("BINANCEFUT_KEYS_MISSING");
      const summary = await getBinanceFuturesAccountSummary({ apiKey, apiSecret });
      const total = Number(summary && summary.total_value);
      if (!Number.isFinite(total) || total <= 0) throw new Error("BINANCEFUT_TOTAL_EMPTY");
      data = { ok: true, provider: p, total_value: total, unit: String(summary.unit || "USDT"), source: "binance_summary" };
    } else if (p === "KIWOOM") {
      const apiKey = String(process.env.KIWOOM_APP_KEY || (ex && ex.api_key) || "");
      const apiSecret = String(process.env.KIWOOM_APP_SECRET || (ex && ex.api_secret) || "");
      if (!apiKey || !apiSecret) throw new Error("KIWOOM_KEYS_MISSING");
      const account = await fetchKiwoomAccount({ appkey: apiKey, secretkey: apiSecret });
      if (!account || account.ok !== true) throw new Error((account && (account.message || account.error)) || "KIWOOM_ACCOUNT_FAILED");
      const cash = Number(account.cash_krw);
      const holdings = Array.isArray(account.holdings) ? account.holdings : [];
      let holdingsValue = 0;
      for (const h of holdings) {
        const qty = Number(h.qty);
        const last = Number(h.last_price);
        if (Number.isFinite(qty) && Number.isFinite(last)) holdingsValue += qty * last;
      }
      const total = (Number.isFinite(cash) ? cash : 0) + holdingsValue;
      if (!Number.isFinite(total) || total <= 0) throw new Error("KIWOOM_TOTAL_EMPTY");
      data = { ok: true, provider: p, total_value: total, unit: "KRW", source: "kiwoom_account" };
    }
  } catch (err) {
    data = { ...data, ok: false, error: err && err.message ? err.message : String(err) };
  }

  accountCache.set(p, { ts: now, data });
  return data;
}

// ── System Prompt (캐싱 대상 — 모든 신호에 공통) ──────────────────
function buildSystemPrompt(isBinanceFut) {
  const lines = [
    "You are the Donbeolja automated trading decision engine.",
    "Use only the input JSON. No emotions, guesses, or extra analysis.",
    "Return ONE JSON object only with fields:",
    "{",
    '  "decision": "ALLOW|REDUCE|BLOCK",',
    '  "qty_pct": number|null,',
    '  "max_risk_pct_total": number|null,',
    '  "risk_mode": "aggressive|neutral|conservative",',
    '  "confidence": number,',
    '  "reason": "short",',
    '  "news_summary": "short"',
    "}",
    "",
    "Hard rules (order is fixed):",
    "1) Normalize qty_pct:",
    "- If signal.qty_pct > 1, treat as percent and divide by 100.",
    "- If qty_pct is NaN, <= 0, or missing -> decision=BLOCK, reason=INVALID_QTY.",
    "",
    "2) Missing core fields -> BLOCK:",
    "- signal.exchange, signal.symbol, signal.tf, signal.event, signal.side, intent, signal.price, signal.strategy_id",
    "- If any missing -> decision=BLOCK, reason=MISSING_FIELD.",
    "",
    "2-1) Value sanity checks:",
    "- If signal.price <= 0 -> decision=BLOCK, reason=INVALID_PRICE.",
    "- If signal.confidence is provided and not in [0,1] -> decision=BLOCK, reason=INVALID_CONFIDENCE.",
    "- If signal.account_balance is provided and <= 0 -> decision=BLOCK, reason=INVALID_ACCOUNT_BALANCE.",
    "",
    "3) EXIT intent:",
    '- If intent == "EXIT": decision=ALLOW, qty_pct=null, max_risk_pct_total=null,',
    "  risk_mode=neutral, confidence=0.6, reason=EXIT_ALWAYS_ALLOW.",
    "",
    ...(isBinanceFut ? [
      "4) BINANCEFUT numeric context (non-blocking):",
      "- Use these as hints ONLY; you may still keep decision=ALLOW if overall risk is acceptable.",
      "- Conflict/regime/low-score/wave/weak-volume/Trend/HTF mismatch are NOT forced REDUCE.",
      "- If you choose to reduce, keep qty_pct <= input qty and set a clear short reason.",
    ] : [
      "4) PRO STATUS caution (additional evidence):",
      "- If pro_status text contains any of:",
      '  "관망", "금지", "진입 금지", "거래 금지", "경고", "과열", "추격 금지", "신호 충돌",',
      '  "횡보", "박스", "전환 주의", "조정", "리스크"',
      "  then decision=REDUCE, qty_pct=qty_pct*0.5, reason=PRO_RISK_SOFT.",
    ]),
    "",
    "5) Risk budget clamp (if enabled and account.total_value valid):",
    "- cap = risk_budget.max_value / account.total_value",
    "- If cap is finite and cap < qty_pct -> decision=REDUCE, qty_pct=cap, reason=RISK_BUDGET_CAP.",
    "",
    "6) Score-based conservative reduce (do NOT increase size):",
    "- If pro_status.pro_score_line contains a number (score):",
    "  - If abs(score) < 15 -> decision=REDUCE and qty_pct = qty_pct * 0.5, reason=LOW_SCORE.",
    "- For BINANCEFUT, treat this as advisory only (do not force reduce).",
    "",
    "7) If no rule above blocks or reduces, decision=ALLOW, qty_pct=normalized qty_pct, reason=OK.",
    "",
    "Output constraints:",
    "- qty_pct must be <= normalized input qty_pct.",
    "- confidence must be between 0 and 1.",
    "- Keep reason short and single-cause.",
    "- If uncertain, choose ALLOW with confidence <= 0.55.",
  ];
  return lines.join("\n");
}

// ── User Prompt (동적 — 신호마다 다름) ──────────────────
function buildUserPrompt({ signal, intent, proStatus, metrics, account, riskBudget, headlines }) {
  const payload = {
    signal,
    intent,
    pro_status: proStatus,
    metrics,
    account,
    risk_config: signal && signal.risk_config ? signal.risk_config : null,
    risk_budget: riskBudget,
    headlines,
  };
  return "Input JSON:\n" + JSON.stringify(payload);
}

// ── Legacy buildPrompt (하위 호환) ──────────────────
function buildPrompt({ signal, intent, proStatus, metrics, account, riskBudget, headlines }) {
  const isBinanceFut = normalizeProviderId(signal && signal.exchange ? signal.exchange : "") === "BINANCEFUT";
  return buildSystemPrompt(isBinanceFut) + "\n\n" + buildUserPrompt({ signal, intent, proStatus, metrics, account, riskBudget, headlines });
}

function buildClaudePrompt({ signal, intent, account, riskBudget, headlines }) {
  const slimSignal = signal ? {
    exchange: signal.exchange,
    symbol: signal.symbol,
    tf: signal.tf,
    event: signal.event,
    side: signal.side,
    qty_pct: signal.qty_pct,
    price: signal.price,
    confidence: signal.confidence,
    strategy_id: signal.strategy_id,
    account_balance: signal.account_balance,
    reason: signal.reason,
    bar_close_time_utc_ms: signal.bar_close_time_utc_ms,
  } : null;
  const slimAccount = (account && typeof account === "object")
    ? {
      total_value: account.total_value ?? null,
      unit: account.unit ?? null,
      error: account.error ?? null,
    }
    : account;
  const slimRisk = (riskBudget && typeof riskBudget === "object" && riskBudget.enabled)
    ? {
      enabled: true,
      max_value: riskBudget.max_value ?? null,
      total_max: riskBudget.total_max ?? null,
      unit: riskBudget.unit ?? null,
      on_exceed: riskBudget.on_exceed ?? null,
    }
    : { enabled: false };
  const slimHeadlines = Array.isArray(headlines)
    ? headlines.slice(0, 8).map((h) => ({
      title: h && h.title ? String(h.title).slice(0, 160) : null,
      source: h && h.source ? String(h.source).slice(0, 80) : null,
      published_at: h && h.published_at ? String(h.published_at).slice(0, 40) : null,
    })).filter((h) => h.title)
    : [];
  return buildPrompt({
    signal: slimSignal,
    intent,
    proStatus: null,
    metrics: null,
    account: slimAccount,
    riskBudget: slimRisk,
    headlines: slimHeadlines,
  });
}

function extractJsonObject(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const direct = safeJsonParse(raw);
  if (direct && typeof direct === "object") return direct;
  const fence = raw.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
  if (fence && fence[1]) {
    const parsed = safeJsonParse(fence[1].trim());
    if (parsed && typeof parsed === "object") return parsed;
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = raw.slice(start, end + 1);
    const parsed = safeJsonParse(sliced);
    if (parsed && typeof parsed === "object") return parsed;
  }
  return null;
}

function parseAiDecision(text) {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") return null;
  const decisionRaw = String(parsed.decision || parsed.action || "").trim().toUpperCase();
  const decision = (decisionRaw === "BLOCK" || decisionRaw === "REDUCE" || decisionRaw === "ALLOW") ? decisionRaw : "ALLOW";
  const qtyPctRaw = parsed.qty_pct;
  const qtyPct = (qtyPctRaw === null || qtyPctRaw === undefined || qtyPctRaw === "")
    ? null
    : clamp01(Number(qtyPctRaw));
  const maxRiskRaw = Number(parsed.max_risk_pct_total);
  const maxRiskPctTotal = (Number.isFinite(maxRiskRaw) && maxRiskRaw > 0) ? clamp01(maxRiskRaw) : null;
  const confidenceRaw = parsed.confidence;
  const confidence = (confidenceRaw === null || confidenceRaw === undefined || confidenceRaw === "")
    ? null
    : clamp01(Number(confidenceRaw));
  const riskModeRaw = String(parsed.risk_mode || parsed.mode || "").trim().toLowerCase();
  const riskMode = (riskModeRaw === "aggressive" || riskModeRaw === "conservative" || riskModeRaw === "neutral")
    ? riskModeRaw
    : "neutral";
  const reason = String(parsed.reason || parsed.rationale || "").trim().slice(0, 160) || null;
  const newsSummary = String(parsed.news_summary || parsed.news || "").trim().slice(0, 200) || null;
  return {
    decision,
    qty_pct: qtyPct,
    max_risk_pct_total: maxRiskPctTotal,
    confidence,
    risk_mode: riskMode,
    reason,
    news_summary: newsSummary,
  };
}

function normalizeAiDecision(parsed, { isExit, allowExitBlock, canBlock, canAdjust, blockMinConf }) {
  if (!parsed) return { decision: "ALLOW", blockSoftened: false };
  let decision = parsed.decision;
  let blockSoftened = false;
  if (isExit && !allowExitBlock) decision = "ALLOW";
  if (!canBlock && decision === "BLOCK") decision = "ALLOW";
  if (!canAdjust && decision === "REDUCE") decision = "ALLOW";
  const reasonUpper = String(parsed.reason || "").toUpperCase();
  const conf = Number(parsed.confidence);
  const lowConf = !Number.isFinite(conf) || conf < blockMinConf;
  const softReason = reasonUpper.includes("PRO_RISK_BLOCK") || reasonUpper.includes("PRO_RISK_SOFT");
  if (decision === "BLOCK" && (lowConf || softReason)) {
    decision = canAdjust ? "REDUCE" : "ALLOW";
    blockSoftened = true;
  }
  return { decision, blockSoftened };
}

function decisionToScore(decision) {
  if (decision === "ALLOW") return 1;
  if (decision === "REDUCE") return 0.5;
  return 0;
}

function scoreWithConfidence(decision, confidence, defaultConf = 0.55) {
  const conf = Number.isFinite(confidence) ? confidence : defaultConf;
  const base = decisionToScore(decision);
  const score = base * conf;
  if (!Number.isFinite(score)) return null;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

function normalizeWeight(raw, fallback = 0.5) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function isHardBlockReason(reason) {
  const r = String(reason || "").toUpperCase();
  if (!r) return false;
  return (
    r.includes("INVALID_") ||
    r.includes("MISSING_FIELD") ||
    r.includes("AI_QTY_ZERO") ||
    r.includes("CROSS_ASSET_BLOCK") ||
    r.includes("ACCOUNT_UNAVAILABLE") ||
    r.includes("NO_ACCOUNT")
  );
}

function decisionCacheKey({ exchange, symbol, tf, barCloseMs, event, side, intent, qtyPct }) {
  const qtyToken = Number.isFinite(Number(qtyPct)) ? Number(qtyPct).toFixed(6) : "NA";
  return [exchange, symbol, tf, barCloseMs, event, side, intent || "NA", qtyToken].join("|");
}

async function evaluateSignalWithAi({ exchange, symbol, tf, event, side, qtyPct, intent, reason, features, price, strategyId, confidence, accountBalance, currentPosition, riskConfig, barCloseTimeUtcMs } = {}) {
  const enabled = boolEnv("SIGNAL_AI_ENABLED", false);
  if (!enabled) return { ok: false, disabled: true, meta: { ai_enabled: false } };

  const model = String(
    process.env.SIGNAL_AI_CLAUDE_MODEL
    || process.env.SIGNAL_AI_MODEL
    || process.env.CLAUDE_MODEL
    || "claude-opus-4-5-20251101"
  ).trim();
  const gptModel = String(
    process.env.SIGNAL_AI_GPT_MODEL
    || process.env.SIGNAL_AI_OPENAI_MODEL
    || process.env.OPENAI_MODEL
    || "gpt-5.2"
  ).trim();
  const newsProvider = String(process.env.SIGNAL_AI_NEWS_PROVIDER || process.env.NEWS_PROVIDER || "openai_web");
  const newsModel = String(process.env.SIGNAL_AI_NEWS_MODEL || process.env.NEWS_WEB_MODEL || "");
  let apiKey = String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "");
  const gptApiKey = String(process.env.OPENAI_API_KEY || "");
  const timeoutMs = Number(process.env.SIGNAL_AI_TIMEOUT_MS || 8000);
  const canBlock = boolEnv("SIGNAL_AI_CAN_BLOCK", false);
  const canAdjust = boolEnv("SIGNAL_AI_CAN_ADJUST", true);
  const allowExitBlock = boolEnv("SIGNAL_AI_ALLOW_EXIT_BLOCK", false);
  const failMode = String(process.env.SIGNAL_AI_FAIL_MODE || "ALLOW").trim().toUpperCase();
  const blockMinConfRaw = Number(process.env.SIGNAL_AI_BLOCK_MIN_CONF || 0.65);
  const blockMinConf = Number.isFinite(blockMinConfRaw) ? blockMinConfRaw : 0.65;
  let guardData = null;
  try {
    const guardRes = await getAiGuardSettingsCached(30_000);
    guardData = guardRes && guardRes.data ? guardRes.data : null;
  } catch (_) {}

  // Firestore에 별도 API키가 있으면 우선 사용
  const guardKey = guardData && guardData.claude_api_key ? String(guardData.claude_api_key) : "";
  if (!apiKey && guardKey) apiKey = guardKey;
  const guardEnsembleEnabled = (guardData && typeof guardData.ensemble_enabled === "boolean")
    ? guardData.ensemble_enabled
    : null;
  const ensembleEnabled = boolEnv(
    "SIGNAL_AI_ENSEMBLE_ENABLED",
    guardEnsembleEnabled != null ? guardEnsembleEnabled : true
  );
  const ensembleWGptRaw = Number(
    process.env.SIGNAL_AI_ENSEMBLE_W_GPT
    || (guardData && guardData.ensemble_w_gpt)
    || 0.5
  );
  const ensembleWClaudeRaw = Number(
    process.env.SIGNAL_AI_ENSEMBLE_W_CLAUDE
    || (guardData && guardData.ensemble_w_claude)
    || 0.5
  );
  const ensembleAllowMinRaw = Number(
    process.env.SIGNAL_AI_ENSEMBLE_ALLOW_MIN
    || (guardData && guardData.ensemble_allow_min)
    || 0.6
  );
  const ensembleReduceMinRaw = Number(
    process.env.SIGNAL_AI_ENSEMBLE_REDUCE_MIN
    || (guardData && guardData.ensemble_reduce_min)
    || 0.45
  );
  const ensembleWGpt = normalizeWeight(ensembleWGptRaw, 0.5);
  const ensembleWClaude = normalizeWeight(ensembleWClaudeRaw, 0.5);
  const ensembleAllowMin = clamp01(ensembleAllowMinRaw) ?? 0.6;
  let ensembleReduceMin = clamp01(ensembleReduceMinRaw) ?? 0.45;
  if (ensembleReduceMin > ensembleAllowMin) ensembleReduceMin = ensembleAllowMin;

  const maxRetriesRaw = Number(process.env.SIGNAL_AI_RETRY_MAX || 2);
  const maxRetries = Number.isFinite(maxRetriesRaw) ? Math.max(0, Math.floor(maxRetriesRaw)) : 2;
  const retryBaseMsRaw = Number(process.env.SIGNAL_AI_RETRY_BASE_MS || 250);
  const retryBaseMs = Number.isFinite(retryBaseMsRaw) ? Math.max(0, retryBaseMsRaw) : 250;

  const intentNorm = normalizeIntentWithPosition({ intent, side, currentPosition });
  const intentFinal = intentNorm.intent;
  const intentOverrideReason = intentNorm.reason;
  const isExit = String(intentFinal || "").toUpperCase() === "EXIT";

  const key = decisionCacheKey({
    exchange,
    symbol,
    tf,
    barCloseMs: barCloseTimeUtcMs,
    event,
    side,
    intent: intentFinal,
    qtyPct,
  });
  const cached = decisionCache.get(key);
  const now = nowMs();
  if (cached && (now - cached.ts) <= DECISION_CACHE_TTL_MS) {
    return { ok: true, cached: true, ...cached.data };
  }

  const account = await getAccountContext(exchange);
  const riskBudget = await getRiskBudgetForProvider(exchange, 5000);
  const keywords = buildKeywordsForProvider(exchange, symbol);
  const allowedDomains = buildAllowedDomainsForProvider(exchange);
  const { fromIso, toIso } = resolveSignalNewsWindow(now);
  const newsRes = await fetchNews({
    apiKey,
    keywords,
    fromIso,
    toIso,
    pageSize: Number(process.env.SIGNAL_AI_NEWS_MAX || 40),
    provider: newsProvider,
    language: normalizeProviderId(exchange) === "KIWOOM" ? "ko" : "en",
    model: newsModel,
    allowedDomains,
  });

  const headlines = (newsRes && Array.isArray(newsRes.articles) ? newsRes.articles : [])
    .slice(0, 25)
    .map((a) => ({
      title: String(a.title || "").trim(),
      source: a.source ? String(a.source) : null,
      published_at: a.published_at ? String(a.published_at) : null,
    }))
    .filter((a) => a.title);

  const priceVal = (price === null || price === undefined || price === "") ? null : Number(price);
  const confidenceVal = (confidence === null || confidence === undefined || confidence === "") ? null : clamp01(Number(confidence));
  const accountBalanceVal = (accountBalance === null || accountBalance === undefined || accountBalance === "") ? null : Number(accountBalance);
  const accountBalanceFinal = Number.isFinite(accountBalanceVal)
    ? accountBalanceVal
    : (account.ok && Number.isFinite(Number(account.total_value)) ? Number(account.total_value) : null);
  const strategyIdVal = strategyId ? String(strategyId).trim() : null;
  const signal = {
    exchange,
    symbol,
    tf,
    event,
    side,
    qty_pct: qtyPct,
    price: Number.isFinite(priceVal) ? priceVal : null,
    confidence: confidenceVal,
    strategy_id: strategyIdVal,
    account_balance: accountBalanceFinal,
    current_position: currentPosition ?? null,
    risk_config: riskConfig ?? null,
    reason: reason || null,
    bar_close_time_utc_ms: Number(barCloseTimeUtcMs) || null,
  };
  const sideUpper = String(side || "").toUpperCase();
  const isShortSignal = sideUpper === "SELL" || sideUpper === "SHORT";
  const proStatus = extractProStatus(features);
  const exchangeNorm = normalizeProviderId(exchange || "");
  let proStatusFinal = proStatus;
  if (proStatusFinal && typeof proStatusFinal === "object") {
    proStatusFinal = { ...proStatusFinal };
    if (exchangeNorm === "BINANCEFUT" || isShortSignal) {
      delete proStatusFinal.pro_action_txt;
      delete proStatusFinal.pro_risk_txt;
    }
  }
  const metrics = extractSignalMetrics(features);
  if (isShortSignal && metrics && typeof metrics === "object") {
    delete metrics.action;
    delete metrics.risk_label;
    delete metrics.risk_txt;
  }

  const riskMax = (riskBudget && riskBudget.enabled)
    ? Number((riskBudget.by_market && riskBudget.by_market[symbol]) || riskBudget.default_max_krw || 0)
    : null;

  // [2026-03-02] System/User 분리 → Prompt Cache 활용
  const isBinanceFut = normalizeProviderId(exchange || "") === "BINANCEFUT";
  const systemPrompt = buildSystemPrompt(isBinanceFut);
  const accountPayload = account.ok ? { total_value: account.total_value, unit: account.unit } : { error: account.error || "ACCOUNT_UNAVAILABLE" };
  const riskPayload = riskBudget && riskBudget.enabled ? {
    enabled: true,
    max_value: Number(riskMax || riskBudget.default_max_krw || riskBudget.default_max || riskBudget.max_krw || 0) || null,
    total_max: Number(riskBudget.total_max_krw || riskBudget.total_krw || 0) || null,
    on_exceed: riskBudget.on_exceed || "CLAMP",
    unit: riskBudget.unit || (isBinanceFut ? "USDT" : "KRW"),
  } : { enabled: false };
  const userPrompt = buildUserPrompt({
    signal,
    intent: intentFinal,
    proStatus: proStatusFinal,
    metrics,
    account: accountPayload,
    riskBudget: riskPayload,
    headlines,
  });
  // Legacy full prompt (하위 호환용)
  const prompt = systemPrompt + "\n\n" + userPrompt;

  const runModelWithRetry = async ({ tag, enabled, run }) => {
    if (!enabled) return { ok: false, attempted: false, attempts: 0, reason: `${tag}_DISABLED`, res: null };
    let res = null;
    let attempts = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      attempts = attempt + 1;
      const call = run();
      res = await Promise.race([
        call,
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "TIMEOUT" }), timeoutMs)),
      ]);
      if (res && res.ok === true) return { ok: true, attempted: true, attempts, reason: null, res };
      const reasonText = res && res.reason ? res.reason : `${tag}_FAIL`;
      const canRetry = attempt < maxRetries && isRetryableReason(reasonText);
      if (!canRetry) return { ok: false, attempted: true, attempts, reason: reasonText, res };
      const waitMs = retryBaseMs * (attempt + 1);
      console.warn(`[AI_SIGNAL][${tag}_RETRY]`, { exchange, symbol, tf, event, side, reason: reasonText, attempt: attempt + 1, wait_ms: waitMs });
      await sleepMs(waitMs);
    }
    const fallbackReason = (res && res.reason) ? res.reason : `${tag}_FAIL`;
    return { ok: false, attempted: true, attempts, reason: fallbackReason, res };
  };

  const claudeEnabled = !!apiKey;
  const gptEnabled = !!gptApiKey && ensembleEnabled;
  const [claudeRun, gptRun] = await Promise.all([
    runModelWithRetry({
      tag: "CLAUDE",
      enabled: claudeEnabled,
      run: () => callClaude({
        apiKey,
        model,
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.2,
        maxTokens: 600,
        jsonMode: true,
        cacheSystem: true,
      }),
    }),
    runModelWithRetry({
      tag: "OPENAI",
      enabled: gptEnabled,
      run: () => callOpenAI({
        apiKey: gptApiKey,
        model: gptModel,
        prompt,
        temperature: 0.2,
        maxTokens: 600,
        jsonMode: true,
      }),
    }),
  ]);

  const claudeParsed = (claudeRun.ok && claudeRun.res && claudeRun.res.ok) ? parseAiDecision(claudeRun.res.text) : null;
  const gptParsed = (gptRun.ok && gptRun.res && gptRun.res.ok) ? parseAiDecision(gptRun.res.text) : null;

  if (!claudeParsed && !gptParsed) {
    const failReason = [
      claudeRun.reason ? `CLAUDE:${claudeRun.reason}` : null,
      gptRun.reason ? `GPT:${gptRun.reason}` : null,
    ].filter(Boolean).join("|") || "AI_FAIL";
    const meta = {
      ai_enabled: true,
      ai_ok: false,
      ai_reason: failReason,
      ai_model: ensembleEnabled ? `${gptModel}+${model}` : model,
      ai_retry_count: Math.max(0, Math.max(claudeRun.attempts, gptRun.attempts) - 1),
      ai_timeout_ms: timeoutMs,
      news_provider: newsRes.provider || newsProvider,
      news_ok: newsRes.ok === true,
      news_reason: newsRes.reason || null,
      news_count: headlines.length,
      cache_metrics: {
        claude: claudeRun.res && claudeRun.res.cacheMetrics ? claudeRun.res.cacheMetrics : null,
        gpt: gptRun.res && gptRun.res.cacheMetrics ? gptRun.res.cacheMetrics : null,
      },
    };
    console.warn("[AI_SIGNAL][ENSEMBLE_FAIL]", { exchange, symbol, tf, event, side, reason: failReason, timeout_ms: timeoutMs });
    meta.ai_fail_mode = failMode;
    if (failMode === "BLOCK") {
      const data = { decision: "BLOCK", qty_pct_final: 0, meta };
      decisionCache.set(key, { ts: now, data });
      return { ok: true, ...data };
    }
    if (failMode === "REDUCE") {
      const qtyBase = Number(qtyPct);
      const qtyReduced = (Number.isFinite(qtyBase) && qtyBase > 0) ? (qtyBase * 0.5) : 0;
      const decision = qtyReduced > 0 ? "REDUCE" : "BLOCK";
      const data = { decision, qty_pct_final: qtyReduced, meta };
      decisionCache.set(key, { ts: now, data });
      return { ok: true, ...data };
    }
    return { ok: false, meta };
  }

  const claudeDecisionNorm = claudeParsed
    ? normalizeAiDecision(claudeParsed, { isExit, allowExitBlock, canBlock, canAdjust, blockMinConf })
    : null;
  const gptDecisionNorm = gptParsed
    ? normalizeAiDecision(gptParsed, { isExit, allowExitBlock, canBlock, canAdjust, blockMinConf })
    : null;

  let parsed = claudeParsed || gptParsed;
  let aiDecisionNorm = claudeDecisionNorm || gptDecisionNorm || { decision: "ALLOW", blockSoftened: false };
  let ensembleScore = null;
  let ensembleUsed = false;
  let ensembleWGptNorm = null;
  let ensembleWClaudeNorm = null;

  if (ensembleEnabled && claudeParsed && gptParsed && claudeDecisionNorm && gptDecisionNorm) {
    const wSum = (ensembleWGpt + ensembleWClaude) > 0 ? (ensembleWGpt + ensembleWClaude) : 1;
    ensembleWGptNorm = ensembleWGpt / wSum;
    ensembleWClaudeNorm = ensembleWClaude / wSum;
    const gptScore = scoreWithConfidence(gptDecisionNorm.decision, gptParsed.confidence, 0.55) ?? 0;
    const claudeScore = scoreWithConfidence(claudeDecisionNorm.decision, claudeParsed.confidence, 0.55) ?? 0;
    ensembleScore = (ensembleWGptNorm * gptScore) + (ensembleWClaudeNorm * claudeScore);
    let ensembleDecision = "BLOCK";
    const sameDecision = gptDecisionNorm.decision === claudeDecisionNorm.decision ? gptDecisionNorm.decision : null;
    // Resolve inconsistency: unanimous model decision should not flip to opposite by score weighting.
    if (sameDecision === "ALLOW") ensembleDecision = "ALLOW";
    else if (sameDecision === "REDUCE") ensembleDecision = "REDUCE";
    else {
      if (ensembleScore >= ensembleAllowMin) ensembleDecision = "ALLOW";
      else if (ensembleScore >= ensembleReduceMin) ensembleDecision = "REDUCE";
    }
    aiDecisionNorm = {
      decision: ensembleDecision,
      blockSoftened: !!(claudeDecisionNorm.blockSoftened || gptDecisionNorm.blockSoftened),
    };
    parsed = (gptScore <= claudeScore) ? gptParsed : claudeParsed;
    ensembleUsed = true;
  } else if (gptParsed && !claudeParsed) {
    parsed = gptParsed;
    aiDecisionNorm = gptDecisionNorm || aiDecisionNorm;
  }

  let decision = aiDecisionNorm.decision;
  let blockSoftened = aiDecisionNorm.blockSoftened;

  let qtyPctFinal = qtyPct;
  let qtyReason = null;
  if (decision === "REDUCE") {
    if (Number.isFinite(parsed.qty_pct)) {
      qtyPctFinal = Math.min(qtyPctFinal, parsed.qty_pct);
      qtyReason = "AI_QTY_PCT";
    }
    if (Number.isFinite(parsed.max_risk_pct_total) && account.ok && Number.isFinite(account.total_value) && account.total_value > 0) {
      const base = (riskBudget && riskBudget.enabled && Number.isFinite(Number(riskMax)))
        ? Number(riskMax)
        : account.total_value;
      if (Number.isFinite(base) && base > 0) {
        const cap = (parsed.max_risk_pct_total * account.total_value) / base;
        if (Number.isFinite(cap)) {
          qtyPctFinal = Math.min(qtyPctFinal, cap);
          qtyReason = qtyReason || "AI_MAX_RISK_PCT";
        }
      }
    }
    if (!qtyReason && Number.isFinite(qtyPct)) {
      qtyPctFinal = Math.min(qtyPctFinal, qtyPct * 0.5);
      qtyReason = "AI_REDUCE_DEFAULT";
    }
  }

  if (!Number.isFinite(qtyPctFinal) || qtyPctFinal <= 0) {
    decision = "BLOCK";
    qtyPctFinal = 0;
    qtyReason = qtyReason || "AI_QTY_ZERO";
  }

  let finalDecision = decision;
  let finalQtyPct = qtyPctFinal;
  let finalQtyReason = qtyReason;
  let binanceBlockDowngraded = false;
  const primaryDecision = decision;
  const primaryConfidence = parsed && Number.isFinite(parsed.confidence) ? parsed.confidence : null;
  const primaryReason = ensembleUsed
    ? `ENSEMBLE:${gptParsed && gptParsed.reason ? gptParsed.reason : (gptRun.reason || "GPT_FAIL")}|${claudeParsed && claudeParsed.reason ? claudeParsed.reason : (claudeRun.reason || "CLAUDE_FAIL")}`
    : (parsed && parsed.reason ? parsed.reason : null);
  const primaryModel = ensembleUsed
    ? `${gptModel}+${model}`
    : (claudeParsed ? model : gptModel);

  if (isExit && !allowExitBlock) finalDecision = "ALLOW";
  if (!canBlock && finalDecision === "BLOCK") finalDecision = "ALLOW";
  if (!canAdjust && finalDecision === "REDUCE") finalDecision = "ALLOW";

  // For Binance futures entries, soften non-hard BLOCK to REDUCE so trade count is not cut by AI noise.
  const downgradeBinanceBlock = boolEnv("SIGNAL_AI_BINANCE_BLOCK_TO_REDUCE", false);
  if (downgradeBinanceBlock && exchangeNorm === "BINANCEFUT" && !isExit && finalDecision === "BLOCK") {
    const blockReason = String(finalQtyReason || parsed.reason || "").toUpperCase();
    if (!isHardBlockReason(blockReason)) {
      if (canAdjust) {
        const qtyBase = Number.isFinite(qtyPct) ? Number(qtyPct) : null;
        let reducedQty = Number.isFinite(qtyBase) ? (qtyBase * 0.5) : null;
        if (Number.isFinite(finalQtyPct) && finalQtyPct > 0) {
          reducedQty = Number.isFinite(reducedQty) ? Math.min(reducedQty, finalQtyPct) : finalQtyPct;
        }
        if (!Number.isFinite(reducedQty) || reducedQty <= 0) {
          reducedQty = Number.isFinite(qtyBase) ? qtyBase * 0.5 : 0;
        }
        finalDecision = "REDUCE";
        finalQtyPct = reducedQty;
        finalQtyReason = "BINANCE_BLOCK_TO_REDUCE";
        binanceBlockDowngraded = true;
      } else {
        finalDecision = "ALLOW";
        finalQtyPct = Number.isFinite(qtyPct) ? Number(qtyPct) : finalQtyPct;
        finalQtyReason = "BINANCE_BLOCK_TO_ALLOW";
        binanceBlockDowngraded = true;
      }
    }
  }

  if (finalDecision === "BLOCK") {
    finalQtyPct = 0;
    finalQtyReason = "AI_BLOCK";
  } else if (finalDecision === "REDUCE") {
    if (!Number.isFinite(finalQtyPct) || finalQtyPct <= 0) {
      finalQtyPct = Number.isFinite(qtyPct) ? qtyPct * 0.5 : 0;
      finalQtyReason = finalQtyReason || "AI_REDUCE_DEFAULT";
    }
  }

  let crossAssetMeta = null;
  if (!isExit && finalDecision !== "BLOCK") {
    const crossAssetRes = await evaluateCrossAssetOpposite({
      exchange,
      symbol,
      side,
      intent: intentFinal,
      qtyPct: finalQtyPct,
      account,
    });
    if (crossAssetRes) {
      crossAssetMeta = crossAssetRes.meta || null;
      const crossDecision = crossAssetRes.decision;
      if (crossDecision === "BLOCK") {
        if (canBlock) {
          finalDecision = "BLOCK";
          finalQtyPct = 0;
          finalQtyReason = crossAssetRes.reason || "CROSS_ASSET_BLOCK";
        } else if (canAdjust) {
          finalDecision = "REDUCE";
          if (Number.isFinite(crossAssetRes.qty_pct)) {
            finalQtyPct = Math.min(finalQtyPct, crossAssetRes.qty_pct);
          } else if (Number.isFinite(qtyPct)) {
            finalQtyPct = Math.min(finalQtyPct, qtyPct * 0.5);
          }
          finalQtyReason = crossAssetRes.reason || "CROSS_ASSET_REDUCE";
        }
      } else if (crossDecision === "REDUCE") {
        if (canAdjust) {
          finalDecision = finalDecision === "BLOCK" ? "BLOCK" : "REDUCE";
          if (Number.isFinite(crossAssetRes.qty_pct)) {
            finalQtyPct = Math.min(finalQtyPct, crossAssetRes.qty_pct);
          }
          finalQtyReason = crossAssetRes.reason || "CROSS_ASSET_REDUCE";
        }
      }
    }
  }

  if (!Number.isFinite(finalQtyPct) || finalQtyPct <= 0) {
    finalDecision = "BLOCK";
    finalQtyPct = 0;
    finalQtyReason = finalQtyReason || "AI_QTY_ZERO";
  }

  const meta = {
    ai_enabled: true,
    ai_ok: true,
    ai_model: primaryModel,
    ai_retry_count: Math.max(0, Math.max(claudeRun.attempts, gptRun.attempts) - 1),
    ai_timeout_ms: timeoutMs,
    ai_intent_raw: intent ? String(intent).toUpperCase() : null,
    ai_intent_final: intentFinal ? String(intentFinal).toUpperCase() : null,
    ai_intent_override_reason: intentOverrideReason || null,
    ai_pos_active: intentNorm.posActive,
    ai_pos_side: intentNorm.posSide,
    ai_decision: finalDecision,
    ai_confidence: primaryConfidence,
    ai_risk_mode: parsed ? parsed.risk_mode : null,
    ai_reason: primaryReason,
    ai_block_softened: blockSoftened,
    ai_block_min_conf: blockMinConf,
    ai_news_summary: parsed ? parsed.news_summary : null,
    ai_qty_reason: finalQtyReason,
    ai_qty_raw: Number.isFinite(qtyPct) ? Number(qtyPct) : null,
    ai_qty_final: Number.isFinite(finalQtyPct) ? Number(finalQtyPct) : null,
    ai_max_risk_pct_total: parsed ? parsed.max_risk_pct_total : null,
    ai_pro_status_sanitized: exchangeNorm === "BINANCEFUT",
    ai_gpt_decision: gptDecisionNorm ? gptDecisionNorm.decision : null,
    ai_gpt_confidence: gptParsed && Number.isFinite(gptParsed.confidence) ? gptParsed.confidence : null,
    ai_gpt_reason: gptParsed && gptParsed.reason ? gptParsed.reason : (gptRun.reason || null),
    ai_gpt_block_softened: gptDecisionNorm ? !!gptDecisionNorm.blockSoftened : null,
    ai_claude_enabled: claudeEnabled,
    ai_claude_attempted: claudeRun.attempted === true,
    ai_claude_ok: !!claudeParsed,
    ai_claude_reason: claudeParsed ? null : (claudeRun.reason || null),
    ai_claude_model: claudeRun.attempted ? model : null,
    ai_claude_model_primary: model,
    ai_claude_model_canary: null,
    ai_claude_canary_pct: 0,
    ai_claude_canary_used: false,
    ai_claude_decision: claudeDecisionNorm ? claudeDecisionNorm.decision : null,
    ai_claude_confidence: claudeParsed && Number.isFinite(claudeParsed.confidence) ? claudeParsed.confidence : null,
    ai_claude_block_softened: claudeDecisionNorm ? !!claudeDecisionNorm.blockSoftened : null,
    ai_ensemble_enabled: ensembleEnabled,
    ai_ensemble_used: ensembleUsed,
    ai_ensemble_score: ensembleUsed && Number.isFinite(ensembleScore) ? ensembleScore : null,
    ai_ensemble_allow_min: ensembleEnabled ? ensembleAllowMin : null,
    ai_ensemble_reduce_min: ensembleEnabled ? ensembleReduceMin : null,
    ai_ensemble_w_gpt: ensembleEnabled ? (ensembleWGptNorm ?? ensembleWGpt) : null,
    ai_ensemble_w_claude: ensembleEnabled ? (ensembleWClaudeNorm ?? ensembleWClaude) : null,
    ai_primary_decision: primaryDecision,
    ai_binance_block_downgraded: binanceBlockDowngraded,
    ai_cross_asset: crossAssetMeta,
    cache_metrics: {
      claude: claudeRun.res && claudeRun.res.cacheMetrics ? claudeRun.res.cacheMetrics : null,
      gpt: gptRun.res && gptRun.res.cacheMetrics ? gptRun.res.cacheMetrics : null,
    },
    news_provider: newsRes.provider || newsProvider,
    news_ok: newsRes.ok === true,
    news_reason: newsRes.reason || null,
    news_count: headlines.length,
  };

  const data = { decision: finalDecision, qty_pct_final: finalQtyPct, meta };
  decisionCache.set(key, { ts: now, data });
  return { ok: true, ...data };
}

module.exports = { evaluateSignalWithAi };
