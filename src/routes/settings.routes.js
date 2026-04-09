const express = require("express");
const router = express.Router();
const { FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("../storage/firestore");
const {
  invalidateRiskBudgetCache,
  invalidateSettingsCache,
  getExchangesSettingsCached,
  getSystemSettingsForProvider,
} = require("../storage/settings");
const { AI_ALLOCATION_DEFAULTS } = require("../config/aiAllocationDefaults");
const {
  normalizeMarketSymbolForProvider,
  normalizeMarketsList,
  normalizeTf,
  listFromRaw,
  defaultMarketsFromEnv,
  defaultTfAllowlistFromEnv,
  defaultExecTfFromEnv,
  filterSupportedTf,
  BINANCEFUT_CORE_MARKETS,
  isBlockedMarketSymbol,
  ensureProviderMarkets,
} = require("../utils/marketConfig");
const { getEnvExchangeOverride, getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { normalizeProviderId, pickProviderEntry } = require("../utils/providerUtils");
const { fetchAccounts } = require("../exchanges/upbitPrivate");
const { fetchBinanceFuturesAccount, fetchFuturesPositionMode } = require("../exchanges/binanceFuturesPrivate");
const { fetchAccount: fetchKiwoomAccount } = require("../exchanges/kiwoomRest");
const { getBinanceFuturesAccountSummary } = require("../services/binanceFuturesAccountSummary");

function allowLocal() {
  return String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
}

function ensureAuthOrSchedulerToken(req, res, next) {
  if (allowLocal()) return next();

  if (req.isAuthenticated && req.isAuthenticated()) return next();

  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (expected && token === expected) return next();

  return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
}

function clampInt(x, min, max) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function clampNumber(x, min, max) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || "").trim().toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

function pickBodyValue(body, key, legacyKey, fallback = undefined) {
  if (!body || typeof body !== "object") return fallback;
  const v = body[key];
  if (v !== undefined && v !== null && v !== "") return v;
  if (legacyKey) {
    const lv = body[legacyKey];
    if (lv !== undefined && lv !== null && lv !== "") return lv;
  }
  return fallback;
}

function normalizeNeutralPolicy(raw, fallback = "allow") {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "allow" || v === "block" || v === "long_only" || v === "short_only") return v;
  return fallback;
}

// normalizeProviderId is centralized in providerUtils.

function normalizeList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || "").trim()).filter(Boolean);
  }
  return String(raw || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getForcedProvidersFromEnv() {
  const out = [];
  const seen = new Set();
  for (const raw of listFromRaw(process.env.EXCHANGE_PROVIDERS || "")) {
    const norm = normalizeProviderId(raw, "");
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function normalizeRunHours(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === "string") {
    list = raw.split(/[\s,]+/);
  } else {
    list = [raw];
  }
  const hours = [];
  for (const v of list) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const h = Math.trunc(n);
    if (h < 0 || h > 23) continue;
    if (!hours.includes(h)) hours.push(h);
  }
  if (!hours.length) return null;
  return hours.sort((a, b) => a - b);
}

function normalizeRunMinute(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    const f = Number(fallback);
    if (!Number.isFinite(f)) return 0;
    return Math.max(0, Math.min(59, Math.trunc(f)));
  }
  const m = Math.trunc(n);
  if (m < 0) return 0;
  if (m > 59) return 59;
  return m;
}

function normalizeBudget(req, body, provider) {
  const clean = {};
  const prov = normalizeProviderId(provider || "BINANCEFUT");
  const unit = String(body.unit || (prov === "BINANCEFUT" ? "USDT" : "KRW")).toUpperCase();

  clean.enabled = !!body.enabled;

  const oe = String(body.on_exceed || "CLAMP").toUpperCase();
  // Engine expects: CLAMP | SKIP (UI may call it HALT)
  clean.on_exceed = (oe === "SKIP" || oe === "HALT" || oe === "STOP") ? "SKIP" : "CLAMP";

  clean.default_max_krw = clampInt(body.default_max_krw, 0, 1_000_000_000) || 0;
  clean.total_max_krw = clampInt(
    body.total_max_krw ?? body.total_budget_krw ?? body.total_krw,
    0,
    1_000_000_000
  ) || 0;

  const by = (body.by_market && typeof body.by_market === "object") ? body.by_market : {};
  clean.by_market = {};
  for (const [mk, raw] of Object.entries(by)) {
    const key = String(mk || "").trim();
    if (!key) continue;

    let v = raw;
    // accept either number or { max_krw: number }
    if (raw && typeof raw === "object") {
      v = raw.max_krw ?? raw.maxKrw ?? raw.max ?? raw.value ?? null;
    }

    const val = clampInt(v, 0, 1_000_000_000);
    if (val == null) continue;
    clean.by_market[key] = val;
  }

  // If total max is set, per-market/default must not exceed it.
  if (prov === "BINANCEFUT" && clean.total_max_krw > 0) {
    if (clean.default_max_krw > clean.total_max_krw) {
      clean.default_max_krw = clean.total_max_krw;
    }
    for (const [mk, val] of Object.entries(clean.by_market)) {
      if (Number(val) > clean.total_max_krw) {
        clean.by_market[mk] = clean.total_max_krw;
      }
    }
  }

  clean.updated_at = new Date().toISOString();
  clean.updated_by = (reqUser(req) || "api").slice(0, 120);
  clean.unit = unit;
  clean.provider = prov;

  return clean;
}

function normalizeByMarketMap(rawByMarket, provider) {
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const out = {};
  const src = rawByMarket && typeof rawByMarket === "object" ? rawByMarket : {};
  for (const [mk, raw] of Object.entries(src)) {
    const norm = normalizeMarketSymbolForProvider(mk, p);
    if (!norm) continue;
    let v = raw;
    if (raw && typeof raw === "object") {
      v = raw.max_krw ?? raw.maxKrw ?? raw.max ?? raw.value ?? null;
    }
    const n = clampInt(v, 0, 1_000_000_000);
    if (n == null) continue;
    out[norm] = n;
  }
  return out;
}

function mergeBudgetMarkets({ provider, byMarket, defaultMax, expectedMarkets }) {
  const p = normalizeProviderId(provider || "BINANCEFUT");
  const outRaw = normalizeByMarketMap(byMarket, p);
  const fallbackMarkets = defaultMarketsFromEnv(p);
  const candidatesRaw = Array.isArray(expectedMarkets) && expectedMarkets.length ? expectedMarkets : fallbackMarkets;
  const normalizedCandidates = normalizeMarketsList(candidatesRaw, p);
  const expected = ensureBinanceCoreMarkets(normalizedCandidates.length ? normalizedCandidates : fallbackMarkets, p);
  const expectedSet = new Set(expected);
  const out = {};
  for (const [mk, v] of Object.entries(outRaw)) {
    if (expectedSet.size && !expectedSet.has(mk)) continue;
    out[mk] = v;
  }
  const fallbackVal = clampInt(defaultMax, 0, 1_000_000_000) || 0;
  for (const mk of expected) {
    if (!Object.prototype.hasOwnProperty.call(out, mk)) {
      out[mk] = fallbackVal;
    }
  }
  return out;
}

function normalizeQtyPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return n;
}

function ensureBinanceCoreMarkets(markets, provider) {
  return ensureProviderMarkets(markets, provider);
}

const BINANCE_MIN_NOTIONAL = {
  BTCUSDT: 100,
  ETHUSDT: 20,
  XRPUSDT: 10,
  DOGEUSDT: 10,
  AXSUSDT: 10,
};
const BINANCE_MIN_NOTIONAL_BUFFER = Number(process.env.BINANCE_MIN_NOTIONAL_BUFFER || 1.5);

async function inferMinQtyPctByMarket(db, exchange, markets, limit = 800) {
  const out = {};
  const targets = new Set((markets || []).map((m) => String(m || "").toUpperCase()).filter(Boolean));
  if (!targets.size) return out;
  const snap = await db.collection("signals").orderBy("created_at", "desc").limit(limit).get();
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    if (ex && ex !== exchange) return;
    const mk = String(x.symbol || x.symbol_or_pair_id || x.market || "").toUpperCase();
    if (!targets.has(mk)) return;
    const qty = normalizeQtyPct(x.qty_pct ?? x.qtyPct);
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (!out[mk] || qty < out[mk]) out[mk] = qty;
  });
  return out;
}

async function applyBinanceMinBudget({ db, clean }) {
  const adjustments = [];
  const warnings = [];
  if (!clean || clean.provider !== "BINANCEFUT" || clean.enabled !== true) {
    return { adjustments, warnings };
  }

  const sys = (await getSystemSettingsForProvider("BINANCEFUT", 0)).data || {};
  const leverage = Number(sys.futures_leverage || 2) || 2;
  const markets = Object.keys(clean.by_market || {})
    .map((x) => String(x || "").toUpperCase())
    .filter((mk) => Object.prototype.hasOwnProperty.call(BINANCE_MIN_NOTIONAL, mk));
  const minQtyByMarket = await inferMinQtyPctByMarket(db, "BINANCEFUT", markets);

  let byMarket = clean.by_market || {};
  let changed = false;

  for (const mk of markets) {
    const minNotional = Number(BINANCE_MIN_NOTIONAL[mk] || 0);
    if (!Number.isFinite(minNotional) || minNotional <= 0) continue;
    const minQty = Math.max(0.01, Number(minQtyByMarket[mk] || 0.05));
    const buffer = Number.isFinite(BINANCE_MIN_NOTIONAL_BUFFER) && BINANCE_MIN_NOTIONAL_BUFFER > 0
      ? BINANCE_MIN_NOTIONAL_BUFFER
      : 1;
    const required = Math.ceil((minNotional * buffer) / (minQty * leverage));
    if (!Number.isFinite(required) || required <= 0) continue;

    const cur = Number((byMarket && byMarket[mk]) || clean.default_max_krw || 0);
    if (!Number.isFinite(cur) || cur <= 0) {
      warnings.push({ market: mk, reason: "BUDGET_EMPTY", required, min_qty_pct: minQty, leverage });
      byMarket[mk] = required;
      adjustments.push({ market: mk, before: cur || 0, after: required, min_qty_pct: minQty, leverage, min_notional: minNotional });
      changed = true;
      continue;
    }
    if (cur < required) {
      byMarket[mk] = required;
      adjustments.push({ market: mk, before: cur, after: required, min_qty_pct: minQty, leverage, min_notional: minNotional });
      changed = true;
    }
  }

  if (changed) {
    clean.by_market = byMarket;
    const sumByMarket = Object.values(byMarket).map(Number).filter((n) => Number.isFinite(n)).reduce((a, b) => a + b, 0);
    if (Number.isFinite(sumByMarket) && sumByMarket > 0 && (clean.total_max_krw || 0) < sumByMarket) {
      warnings.push({ market: "TOTAL", reason: "TOTAL_UNDER_SUM", total_max_krw: clean.total_max_krw || 0, sum_by_market: sumByMarket });
    }
  }

  return { adjustments, warnings };
}

function normalizeAiAllocation(req, body = {}) {
  const clean = {};

  clean.enabled = normalizeBool(body.enabled);
  clean.apply_live = normalizeBool(body.apply_live);

  const newsDays = clampInt(body.news_window_days, 1, 14);
  clean.news_window_days = newsDays || AI_ALLOCATION_DEFAULTS.news_window_days;

  const modeScale = body.mode_scale || {};
  clean.mode_scale = {
    aggressive: clampNumber(modeScale.aggressive, 0.1, 1.0) ?? AI_ALLOCATION_DEFAULTS.mode_scale.aggressive,
    neutral: clampNumber(modeScale.neutral, 0.1, 1.0) ?? AI_ALLOCATION_DEFAULTS.mode_scale.neutral,
    conservative: clampNumber(modeScale.conservative, 0.1, 1.0) ?? AI_ALLOCATION_DEFAULTS.mode_scale.conservative,
  };
  const totalCap = clampNumber(body.total_cap_pct_max, 0.1, 1.0);
  clean.total_cap_pct_max = totalCap == null ? AI_ALLOCATION_DEFAULTS.total_cap_pct_max : totalCap;

  const reinvestRate = clampNumber(body.reinvest_rate, 0, 1.0);
  clean.reinvest_rate = reinvestRate == null ? AI_ALLOCATION_DEFAULTS.reinvest_rate : reinvestRate;
  const reinvestLoss = clampNumber(body.reinvest_loss_rate, 0, 2.0);
  clean.reinvest_loss_rate = reinvestLoss == null ? AI_ALLOCATION_DEFAULTS.reinvest_loss_rate : reinvestLoss;
  const eqMin = clampNumber(body.equity_mult_min, 0.1, 2.0);
  clean.equity_mult_min = eqMin == null ? AI_ALLOCATION_DEFAULTS.equity_mult_min : eqMin;
  const eqMax = clampNumber(body.equity_mult_max, 0.1, 3.0);
  clean.equity_mult_max = eqMax == null ? AI_ALLOCATION_DEFAULTS.equity_mult_max : eqMax;
  if (body.directional_enabled === undefined || body.directional_enabled === null || body.directional_enabled === "") {
    clean.directional_enabled = AI_ALLOCATION_DEFAULTS.directional_enabled;
  } else {
    clean.directional_enabled = normalizeBool(body.directional_enabled);
  }
  const sideTilt = clampNumber(body.side_bias_max_tilt, 0, 0.9);
  clean.side_bias_max_tilt = sideTilt == null ? AI_ALLOCATION_DEFAULTS.side_bias_max_tilt : sideTilt;
  const sideNeutral = clampNumber(body.side_bias_neutral_threshold, 0, 0.5);
  clean.side_bias_neutral_threshold = sideNeutral == null
    ? AI_ALLOCATION_DEFAULTS.side_bias_neutral_threshold
    : sideNeutral;
  const sideMinConf = clampNumber(body.side_bias_min_confidence, 0, 1);
  clean.side_bias_min_confidence = sideMinConf == null
    ? AI_ALLOCATION_DEFAULTS.side_bias_min_confidence
    : sideMinConf;
  const sideScaleMin = clampNumber(body.side_scale_min, 0.1, 1.0);
  const sideScaleMax = clampNumber(body.side_scale_max, 1.0, 3.0);
  const resolvedScaleMin = sideScaleMin == null ? AI_ALLOCATION_DEFAULTS.side_scale_min : sideScaleMin;
  const resolvedScaleMax = sideScaleMax == null ? AI_ALLOCATION_DEFAULTS.side_scale_max : sideScaleMax;
  clean.side_scale_min = Math.min(resolvedScaleMin, resolvedScaleMax);
  clean.side_scale_max = Math.max(resolvedScaleMin, resolvedScaleMax);

  clean.min_per_market_krw = clampInt(body.min_per_market_krw, 0, 1_000_000_000) || AI_ALLOCATION_DEFAULTS.min_per_market_krw;
  clean.max_per_market_krw = clampInt(body.max_per_market_krw, 0, 5_000_000_000) || AI_ALLOCATION_DEFAULTS.max_per_market_krw;

  const maxChange = clampNumber(body.max_change_pct, 0, 0.5);
  clean.max_change_pct = maxChange == null ? AI_ALLOCATION_DEFAULTS.max_change_pct : maxChange;

  clean.min_bars = clampInt(body.min_bars, 5, 500) || AI_ALLOCATION_DEFAULTS.min_bars;
  clean.bars_limit = clampInt(body.bars_limit, 100, 5000) || AI_ALLOCATION_DEFAULTS.bars_limit;

  clean.gpt_enabled = normalizeBool(body.gpt_enabled);
  clean.gpt_model = String(body.gpt_model || AI_ALLOCATION_DEFAULTS.gpt_model);
  clean.gpt_model_router = String(body.gpt_model_router || AI_ALLOCATION_DEFAULTS.gpt_model_router || clean.gpt_model);
  clean.gpt_model_pro = String(body.gpt_model_pro || AI_ALLOCATION_DEFAULTS.gpt_model_pro || clean.gpt_model);
  if (body.claude_enabled === undefined || body.claude_enabled === null || body.claude_enabled === "") {
    clean.claude_enabled = AI_ALLOCATION_DEFAULTS.claude_enabled;
  } else {
    clean.claude_enabled = normalizeBool(body.claude_enabled);
  }
  clean.claude_model = String(body.claude_model || AI_ALLOCATION_DEFAULTS.claude_model || "claude-opus-4-5-20251101").trim();
  const claudeTimeoutMs = clampInt(body.claude_timeout_ms, 1000, 30000);
  clean.claude_timeout_ms = claudeTimeoutMs == null ? (AI_ALLOCATION_DEFAULTS.claude_timeout_ms || 8000) : claudeTimeoutMs;
  if (body.ensemble_enabled === undefined || body.ensemble_enabled === null || body.ensemble_enabled === "") {
    clean.ensemble_enabled = AI_ALLOCATION_DEFAULTS.ensemble_enabled;
  } else {
    clean.ensemble_enabled = normalizeBool(body.ensemble_enabled);
  }
  const ensembleWGpt = clampNumber(body.ensemble_w_gpt, 0, 1);
  const ensembleWClaude = clampNumber(body.ensemble_w_claude, 0, 1);
  clean.ensemble_w_gpt = ensembleWGpt == null ? (AI_ALLOCATION_DEFAULTS.ensemble_w_gpt ?? 0.6) : ensembleWGpt;
  clean.ensemble_w_claude = ensembleWClaude == null ? (AI_ALLOCATION_DEFAULTS.ensemble_w_claude ?? 0.4) : ensembleWClaude;

  const routerThr = clampNumber(body.router_conf_threshold, 0, 1);
  clean.router_conf_threshold = routerThr == null ? (AI_ALLOCATION_DEFAULTS.router_conf_threshold ?? 0.6) : routerThr;

  const temp = clampNumber(body.gpt_temperature, 0, 1);
  clean.gpt_temperature = temp == null ? AI_ALLOCATION_DEFAULTS.gpt_temperature : temp;

  const cadence = clampInt(body.cadence_days, 1, 30);
  clean.cadence_days = cadence || AI_ALLOCATION_DEFAULTS.cadence_days;
  const dow = clampInt(body.run_dow, 0, 6);
  clean.run_dow = (dow === null || dow === undefined) ? AI_ALLOCATION_DEFAULTS.run_dow : dow;
  const runHour = clampInt(body.run_hour_kst, 0, 23);
  clean.run_hour_kst = (runHour === null || runHour === undefined) ? AI_ALLOCATION_DEFAULTS.run_hour_kst : runHour;
  const runHours = normalizeRunHours(body.run_hours_kst ?? body.runHoursKst ?? body.run_hours ?? body.runHours);
  clean.run_hours_kst = runHours || AI_ALLOCATION_DEFAULTS.run_hours_kst;
  clean.run_minute_kst = normalizeRunMinute(
    body.run_minute_kst ?? body.runMinuteKst ?? body.run_minute ?? body.runMinute,
    AI_ALLOCATION_DEFAULTS.run_minute_kst,
  );

  if (typeof body.api_key === "string" && body.api_key.trim()) {
    clean.api_key = body.api_key.trim();
  }

  clean.updated_at = new Date().toISOString();
  clean.updated_by = (req.user && (req.user.email || req.user.id || req.user.name))
    ? String(req.user.email || req.user.id || req.user.name).slice(0, 120)
    : "api";

  return clean;
}

function normalizeSystem(req, body, current = {}) {
  const clean = {};
  clean.scheduler_enabled = normalizeBool(body.scheduler_enabled);
  clean.scheduler_interval_sec = clampInt(body.scheduler_interval_sec, 10, 3600) || 900;
  clean.timezone = String(body.timezone || "Asia/Seoul").trim().slice(0, 60);
  clean.retry_max = clampInt(body.retry_max, 0, 10) || 0;
  const lvl = String(body.log_level || "INFO").toUpperCase();
  clean.log_level = ["DEBUG", "INFO", "WARN", "ERROR"].includes(lvl) ? lvl : "INFO";
  clean.alert_channel = String(body.alert_channel || "").trim().slice(0, 160);
  clean.data_retention_days = clampInt(body.data_retention_days, 0, 3650) || 0;
  clean.auto_backfill_enabled = normalizeBool(body.auto_backfill_enabled);
  clean.auto_backfill_days = clampInt(body.auto_backfill_days, 0, 90) || 0;
  clean.fee_bps = clampInt(body.fee_bps ?? body.feeBps ?? body.fee, 0, 10000) || 0;
  clean.slippage_bps = clampInt(body.slippage_bps ?? body.slippageBps ?? body.slippage, 0, 10000) || 0;
  const slipModel = String(body.slippage_model ?? body.slippageModel ?? "FIXED").toUpperCase();
  clean.slippage_model = (slipModel === "VOLATILITY") ? "VOLATILITY" : "FIXED";
  let slipMin = clampInt(body.slippage_bps_min, 0, 10000);
  let slipMax = clampInt(body.slippage_bps_max, 0, 10000);
  if (slipMin != null && slipMax != null && slipMin > slipMax) {
    const tmp = slipMin;
    slipMin = slipMax;
    slipMax = tmp;
  }
  clean.slippage_bps_min = (slipMin == null) ? null : slipMin;
  clean.slippage_bps_max = (slipMax == null) ? null : slipMax;
  const volFactor = clampNumber(body.slippage_volatility_factor, 0, 5);
  clean.slippage_volatility_factor = (volFactor == null) ? 0.1 : volFactor;
  clean.fee_bps_by_market = normalizeBpsMap(body.fee_bps_by_market);
  clean.slippage_bps_by_market = normalizeBpsMap(body.slippage_bps_by_market);
  const ttlMs = clampInt(body.intent_ttl_ms, 0, 7 * 24 * 60 * 60 * 1000);
  clean.intent_ttl_ms = (ttlMs == null || ttlMs === 0) ? null : ttlMs;
  const ttlBars = clampInt(body.intent_ttl_bars, 0, 72);
  clean.intent_ttl_bars = (ttlBars == null || ttlBars === 0) ? null : ttlBars;

  const currentCfg = (current && typeof current === "object") ? current : {};
  const execModeRaw = String(body.execution_mode ?? body.exec_mode ?? "PAPER").toUpperCase().trim();
  const execMode = ["PAPER", "LIVE", "LIVE_DRY_RUN"].includes(execModeRaw) ? execModeRaw : "PAPER";
  const liveConfirm = String(body.live_confirm_text || body.live_confirm || "").trim().toUpperCase();
  const currentLiveConfirmRequired = (currentCfg.live_confirm_required === undefined || currentCfg.live_confirm_required === null)
    ? true
    : normalizeBool(currentCfg.live_confirm_required);
  const liveConfirmRequiredRaw = body.live_confirm_required;
  const liveConfirmRequired = (liveConfirmRequiredRaw === undefined || liveConfirmRequiredRaw === null || liveConfirmRequiredRaw === "")
    ? currentLiveConfirmRequired
    : normalizeBool(liveConfirmRequiredRaw);
  const liveConfirmOk = !liveConfirmRequired || liveConfirm === "LIVE";
  const providerRaw = req.query.provider || body.provider || "";
  const provider = normalizeProviderId(providerRaw || "");

  clean.execution_mode = execMode;
  const phase0Raw = body.phase0_paper_only;
  clean.phase0_paper_only = (phase0Raw === undefined || phase0Raw === null || phase0Raw === "")
    ? false
    : normalizeBool(phase0Raw);
  clean.live_enabled = normalizeBool(body.live_enabled) && execMode === "LIVE" && liveConfirmOk;
  clean.binance_real_trading_enabled = normalizeBool(body.binance_real_trading_enabled);
  clean.live_dry_run = normalizeBool(body.live_dry_run) || execMode === "LIVE_DRY_RUN";
  clean.live_min_order_krw = clampInt(body.live_min_order_krw, 0, 1_000_000_000) || 0;
  clean.live_max_order_krw = clampInt(body.live_max_order_krw, 0, 1_000_000_000) || 0;
  clean.live_allowed_markets = (provider === "BINANCEFUT" || provider === "BINANCE")
    ? normalizeMarketsList(normalizeList(body.live_allowed_markets), provider)
    : normalizeList(body.live_allowed_markets);
  clean.live_confirm_required = liveConfirmRequired;
  let lev = clampNumber(body.futures_leverage, 1, 3);
  if (lev == null) lev = 2;
  if (provider === "BINANCEFUT") lev = Math.round(lev);
  clean.futures_leverage = lev;

  const marginRaw = String(body.futures_margin_type || "ISOLATED").trim().toUpperCase();
  clean.futures_margin_type = (marginRaw === "CROSSED") ? "CROSSED" : "ISOLATED";
  const exitProfileRaw = String(body.futures_exit_profile_mode || "BASE").trim().toUpperCase();
  clean.futures_exit_profile_mode = (exitProfileRaw === "AGGRESSIVE") ? "AGGRESSIVE" : "BASE";
  const gateEnabledRaw = pickBodyValue(body, "gate_enabled", "short_gate_enabled");
  clean.gate_enabled = (gateEnabledRaw === undefined || gateEnabledRaw === null || gateEnabledRaw === "")
    ? true
    : normalizeBool(gateEnabledRaw);
  const gateTrendOnlyRaw = pickBodyValue(body, "gate_trend_only", "short_gate_trend_only");
  clean.gate_trend_only = (gateTrendOnlyRaw === undefined || gateTrendOnlyRaw === null || gateTrendOnlyRaw === "")
    ? true
    : normalizeBool(gateTrendOnlyRaw);
  const gateCoreEnabledRaw = pickBodyValue(body, "gate_core_enabled", "short_gate_core_enabled");
  clean.gate_core_enabled = (gateCoreEnabledRaw === undefined || gateCoreEnabledRaw === null || gateCoreEnabledRaw === "")
    ? true
    : normalizeBool(gateCoreEnabledRaw);
  const gatePreRealEnabledRaw = pickBodyValue(body, "gate_pre_real_enabled", "short_gate_pre_real_enabled");
  clean.gate_pre_real_enabled = (gatePreRealEnabledRaw === undefined || gatePreRealEnabledRaw === null || gatePreRealEnabledRaw === "")
    ? false
    : normalizeBool(gatePreRealEnabledRaw);
  const gateRealEnabledRaw = pickBodyValue(body, "gate_real_enabled", "short_gate_real_enabled");
  clean.gate_real_enabled = (gateRealEnabledRaw === undefined || gateRealEnabledRaw === null || gateRealEnabledRaw === "")
    ? true
    : normalizeBool(gateRealEnabledRaw);
  clean.gate_early_enabled = normalizeBool(pickBodyValue(body, "gate_early_enabled", "short_gate_early_enabled", false));
  const gateCoreAbs = clampNumber(pickBodyValue(body, "gate_core_score_abs", "short_gate_core_score_abs"), 0, 100);
  clean.gate_core_score_abs = (gateCoreAbs == null) ? 35 : gateCoreAbs;
  const gatePreRealAbs = clampNumber(pickBodyValue(body, "gate_pre_real_score_abs", "short_gate_pre_real_score_abs"), 0, 100);
  clean.gate_pre_real_score_abs = (gatePreRealAbs == null) ? 40 : gatePreRealAbs;
  const gateRealAbs = clampNumber(pickBodyValue(body, "gate_real_score_abs", "short_gate_real_score_abs"), 0, 100);
  clean.gate_real_score_abs = (gateRealAbs == null) ? 45 : gateRealAbs;
  const gateEarlyAbs = clampNumber(pickBodyValue(body, "gate_early_score_abs", "short_gate_early_score_abs"), 0, 100);
  clean.gate_early_score_abs = (gateEarlyAbs == null) ? 25 : gateEarlyAbs;
  const gateConf = clampNumber(pickBodyValue(body, "gate_conf_min", "short_gate_conf_min"), 0, 1);
  clean.gate_conf_min = (gateConf == null) ? 0.50 : gateConf;
  const gateWaveConf = clampNumber(pickBodyValue(body, "gate_wave_conf_min", "short_gate_wave_conf_min"), 0, 1);
  clean.gate_wave_conf_min = (gateWaveConf == null) ? 0.6 : gateWaveConf;
  const gateConflictRaw = pickBodyValue(body, "gate_block_conflict", "short_gate_block_conflict");
  clean.gate_block_conflict = (gateConflictRaw === undefined || gateConflictRaw === null || gateConflictRaw === "")
    ? true
    : normalizeBool(gateConflictRaw);
  clean.gate_transition_exception_enabled = normalizeBool(
    body.gate_transition_exception_enabled === undefined ? true : body.gate_transition_exception_enabled
  );
  clean.gate_transition_exception_core_enabled = normalizeBool(
    body.gate_transition_exception_core_enabled === undefined ? true : body.gate_transition_exception_core_enabled
  );
  clean.gate_transition_exception_pre_real_enabled = normalizeBool(
    body.gate_transition_exception_pre_real_enabled === undefined ? true : body.gate_transition_exception_pre_real_enabled
  );
  clean.gate_transition_exception_real_enabled = normalizeBool(body.gate_transition_exception_real_enabled);
  clean.gate_transition_exception_early_enabled = normalizeBool(body.gate_transition_exception_early_enabled);
  const gateTransitionScoreAbs = clampNumber(body.gate_transition_exception_score_abs, 0, 100);
  clean.gate_transition_exception_score_abs = (gateTransitionScoreAbs == null) ? 40 : gateTransitionScoreAbs;
  const gateTransitionWaveConf = clampNumber(body.gate_transition_exception_wave_conf_min, 0, 1);
  clean.gate_transition_exception_wave_conf_min = (gateTransitionWaveConf == null) ? 0.6 : gateTransitionWaveConf;
  clean.canonical_engine_enabled = normalizeBool(body.canonical_engine_enabled === undefined ? true : body.canonical_engine_enabled);
  clean.canonical_engine_shadow_enabled = normalizeBool(body.canonical_engine_shadow_enabled === undefined ? true : body.canonical_engine_shadow_enabled);
  clean.canonical_engine_source_mode = normalizeCanonicalEngineSourceMode(body.canonical_engine_source_mode, "PINE_PRIMARY");
  const canonicalCoreScoreAbs = clampNumber(body.canonical_engine_core_score_abs, 0, 100);
  clean.canonical_engine_core_score_abs = (canonicalCoreScoreAbs == null) ? 33 : canonicalCoreScoreAbs;
  const canonicalTransitionCoreScoreAbs = clampNumber(body.canonical_engine_transition_core_score_abs, 0, 100);
  clean.canonical_engine_transition_core_score_abs = (canonicalTransitionCoreScoreAbs == null) ? 29 : canonicalTransitionCoreScoreAbs;
  clean.canonical_engine_market_overrides = normalizeCanonicalEngineMarketOverrides(body.canonical_engine_market_overrides);

  // Legacy compatibility: keep mirrored short_gate_* keys until callers are fully migrated.
  clean.short_gate_enabled = clean.gate_enabled;
  clean.short_gate_trend_only = clean.gate_trend_only;
  clean.short_gate_core_enabled = clean.gate_core_enabled;
  clean.short_gate_pre_real_enabled = clean.gate_pre_real_enabled;
  clean.short_gate_real_enabled = clean.gate_real_enabled;
  clean.short_gate_early_enabled = clean.gate_early_enabled;
  clean.short_gate_core_score_abs = clean.gate_core_score_abs;
  clean.short_gate_pre_real_score_abs = clean.gate_pre_real_score_abs;
  clean.short_gate_real_score_abs = clean.gate_real_score_abs;
  clean.short_gate_early_score_abs = clean.gate_early_score_abs;
  clean.short_gate_conf_min = clean.gate_conf_min;
  clean.short_gate_wave_conf_min = clean.gate_wave_conf_min;
  clean.short_gate_block_conflict = clean.gate_block_conflict;

  const aiBiasDefaultEnabled = provider === "BINANCEFUT" || provider === "BINANCE";
  const aiMissingPolicyRaw = String(body.ai_missing_policy || "").trim().toUpperCase();
  clean.ai_missing_policy = (aiMissingPolicyRaw === "ALLOW" || aiMissingPolicyRaw === "REDUCE" || aiMissingPolicyRaw === "BLOCK")
    ? aiMissingPolicyRaw
    : "ALLOW";
  const aiMissingReducePct = clampNumber(body.ai_missing_reduce_pct, 0, 1);
  clean.ai_missing_reduce_pct = (aiMissingReducePct == null) ? 0.5 : aiMissingReducePct;
  const aiBiasEnabledRaw = body.ai_bias_gate_enabled;
  clean.ai_bias_gate_enabled = (aiBiasEnabledRaw === undefined || aiBiasEnabledRaw === null || aiBiasEnabledRaw === "")
    ? aiBiasDefaultEnabled
    : normalizeBool(aiBiasEnabledRaw);
  clean.ai_bias_gate_neutral_policy = normalizeNeutralPolicy(body.ai_bias_gate_neutral_policy, "allow");
  const aiBiasScoreThr = clampNumber(body.ai_bias_gate_score_threshold, 0, 1);
  clean.ai_bias_gate_score_threshold = (aiBiasScoreThr == null) ? 0.01 : aiBiasScoreThr;
  const aiBiasConf = clampNumber(body.ai_bias_gate_conf_min, 0, 1);
  clean.ai_bias_gate_conf_min = (aiBiasConf == null) ? 0 : aiBiasConf;
  clean.ai_bias_gate_core_enabled = normalizeBool(body.ai_bias_gate_core_enabled === undefined ? true : body.ai_bias_gate_core_enabled);
  clean.ai_bias_gate_pre_real_enabled = normalizeBool(body.ai_bias_gate_pre_real_enabled === undefined ? false : body.ai_bias_gate_pre_real_enabled);
  clean.ai_bias_gate_real_enabled = normalizeBool(body.ai_bias_gate_real_enabled === undefined ? false : body.ai_bias_gate_real_enabled);
  clean.ai_bias_gate_early_enabled = normalizeBool(body.ai_bias_gate_early_enabled);
  clean.ai_bias_gate_emo_enabled = normalizeBool(body.ai_bias_gate_emo_enabled);
  const aiBiasNeutralMult = clampNumber(body.ai_bias_gate_neutral_mult, 0, 1);
  clean.ai_bias_gate_neutral_mult = (aiBiasNeutralMult == null) ? 0.5 : aiBiasNeutralMult;
  const aiBiasOppositeMult = clampNumber(body.ai_bias_gate_opposite_mult, 0, 1);
  clean.ai_bias_gate_opposite_mult = (aiBiasOppositeMult == null) ? 0.35 : aiBiasOppositeMult;
  const aiBiasStrongOppositeScore = clampNumber(body.ai_bias_gate_strong_opposite_score, 0, 1);
  clean.ai_bias_gate_strong_opposite_score = (aiBiasStrongOppositeScore == null) ? 0.2 : aiBiasStrongOppositeScore;
  const aiBiasStrongOppositeConf = clampNumber(body.ai_bias_gate_strong_opposite_conf, 0, 1);
  clean.ai_bias_gate_strong_opposite_conf = (aiBiasStrongOppositeConf == null) ? 0.55 : aiBiasStrongOppositeConf;
  clean.ev_gate_enabled = normalizeBool(body.ev_gate_enabled === undefined ? true : body.ev_gate_enabled);
  clean.ev_gate_global_report_only_enabled = normalizeBool(body.ev_gate_global_report_only_enabled === undefined ? true : body.ev_gate_global_report_only_enabled);
  clean.ev_gate_core_enabled = normalizeBool(body.ev_gate_core_enabled === undefined ? true : body.ev_gate_core_enabled);
  clean.ev_gate_pre_real_enabled = normalizeBool(body.ev_gate_pre_real_enabled === undefined ? false : body.ev_gate_pre_real_enabled);
  clean.ev_gate_real_enabled = normalizeBool(body.ev_gate_real_enabled === undefined ? false : body.ev_gate_real_enabled);
  clean.ev_gate_early_enabled = normalizeBool(body.ev_gate_early_enabled === undefined ? true : body.ev_gate_early_enabled);
  let evGateTp1ProbMin = clampNumber(body.ev_gate_tp1_prob_min, 0, 1);
  if (evGateTp1ProbMin == null) evGateTp1ProbMin = 0.55;
  clean.ev_gate_tp1_prob_min = evGateTp1ProbMin;
  let evGateTp1ProbMinEarly = clampNumber(body.ev_gate_tp1_prob_min_early, 0, 1);
  if (evGateTp1ProbMinEarly == null) evGateTp1ProbMinEarly = evGateTp1ProbMin;
  clean.ev_gate_tp1_prob_min_early = evGateTp1ProbMinEarly;
  let evGateTp1ProbMinCore = clampNumber(body.ev_gate_tp1_prob_min_core, 0, 1);
  if (evGateTp1ProbMinCore == null) evGateTp1ProbMinCore = evGateTp1ProbMin;
  clean.ev_gate_tp1_prob_min_core = evGateTp1ProbMinCore;
  let evGateTp1ProbMinPreReal = clampNumber(body.ev_gate_tp1_prob_min_pre_real, 0, 1);
  if (evGateTp1ProbMinPreReal == null) evGateTp1ProbMinPreReal = evGateTp1ProbMin;
  clean.ev_gate_tp1_prob_min_pre_real = evGateTp1ProbMinPreReal;
  let evGateTp1ProbMinReal = clampNumber(body.ev_gate_tp1_prob_min_real, 0, 1);
  if (evGateTp1ProbMinReal == null) evGateTp1ProbMinReal = evGateTp1ProbMin;
  clean.ev_gate_tp1_prob_min_real = evGateTp1ProbMinReal;
  let evGateTp1ProbFull = clampNumber(body.ev_gate_tp1_prob_full, 0, 1);
  if (evGateTp1ProbFull == null) evGateTp1ProbFull = Math.max(0.60, evGateTp1ProbMin);
  clean.ev_gate_tp1_prob_full = Math.max(evGateTp1ProbMin, evGateTp1ProbFull);
  let evGateTp1ProbKill = clampNumber(body.ev_gate_tp1_prob_kill, 0, 1);
  if (evGateTp1ProbKill == null) evGateTp1ProbKill = 0.50;
  clean.ev_gate_tp1_prob_kill = Math.min(clean.ev_gate_tp1_prob_full, evGateTp1ProbKill);
  let evGateQtyScaleMid = clampNumber(body.ev_gate_qty_scale_mid, 0, 1);
  if (evGateQtyScaleMid == null) evGateQtyScaleMid = 0.70;
  clean.ev_gate_qty_scale_mid = evGateQtyScaleMid;
  let evGateQtyScaleLow = clampNumber(body.ev_gate_qty_scale_low, 0, 1);
  if (evGateQtyScaleLow == null) evGateQtyScaleLow = 0.40;
  clean.ev_gate_qty_scale_low = evGateQtyScaleLow;
  let evGateLookbackBars = clampNumber(body.ev_gate_lookback_bars, 4, 48);
  if (evGateLookbackBars == null) evGateLookbackBars = 12;
  clean.ev_gate_lookback_bars = Math.round(evGateLookbackBars);
  let evGateAtrBars = clampNumber(body.ev_gate_atr_bars, 3, 24);
  if (evGateAtrBars == null) evGateAtrBars = 8;
  clean.ev_gate_atr_bars = Math.round(evGateAtrBars);
  let evGateDefaultTp1Pct = clampNumber(body.ev_gate_default_tp1_pct, 0.1, 20);
  if (evGateDefaultTp1Pct == null) evGateDefaultTp1Pct = 3.25;
  clean.ev_gate_default_tp1_pct = evGateDefaultTp1Pct;
  let evGateDefaultSlPct = clampNumber(body.ev_gate_default_sl_pct, 0.1, 20);
  if (evGateDefaultSlPct == null) evGateDefaultSlPct = 1.65;
  clean.ev_gate_default_sl_pct = evGateDefaultSlPct;
  clean.ev_gate_skip_missing_bars = normalizeBool(
    body.ev_gate_skip_missing_bars === undefined ? true : body.ev_gate_skip_missing_bars
  );
  clean.wait_one_bar_enabled = normalizeBool(body.wait_one_bar_enabled === undefined ? true : body.wait_one_bar_enabled);
  clean.wait_one_bar_core_enabled = normalizeBool(body.wait_one_bar_core_enabled === undefined ? true : body.wait_one_bar_core_enabled);
  clean.wait_one_bar_pre_real_enabled = normalizeBool(body.wait_one_bar_pre_real_enabled === undefined ? false : body.wait_one_bar_pre_real_enabled);
  clean.wait_one_bar_real_enabled = normalizeBool(body.wait_one_bar_real_enabled === undefined ? false : body.wait_one_bar_real_enabled);
  clean.wait_one_bar_early_enabled = normalizeBool(body.wait_one_bar_early_enabled === undefined ? true : body.wait_one_bar_early_enabled);
  let waitOneBarSameDirStreakMin = clampInt(body.wait_one_bar_same_dir_streak_min, 2, 5);
  if (waitOneBarSameDirStreakMin == null) waitOneBarSameDirStreakMin = 3;
  clean.wait_one_bar_same_dir_streak_min = waitOneBarSameDirStreakMin;
  let waitOneBarChaseRatioMin = clampNumber(body.wait_one_bar_chase_ratio_min, 0.5, 5);
  if (waitOneBarChaseRatioMin == null) waitOneBarChaseRatioMin = 1.75;
  clean.wait_one_bar_chase_ratio_min = waitOneBarChaseRatioMin;
  let waitOneBarLastCloseControlMin = clampNumber(body.wait_one_bar_last_close_control_min, 0.5, 1);
  if (waitOneBarLastCloseControlMin == null) waitOneBarLastCloseControlMin = 0.80;
  clean.wait_one_bar_last_close_control_min = waitOneBarLastCloseControlMin;
  let waitOneBarLastDirBodyMin = clampNumber(body.wait_one_bar_last_dir_body_min, 0.05, 1);
  if (waitOneBarLastDirBodyMin == null) waitOneBarLastDirBodyMin = 0.45;
  clean.wait_one_bar_last_dir_body_min = waitOneBarLastDirBodyMin;
  let waitOneBarLastOppWickMax = clampNumber(body.wait_one_bar_last_opposite_wick_max, 0, 0.5);
  if (waitOneBarLastOppWickMax == null) waitOneBarLastOppWickMax = 0.18;
  clean.wait_one_bar_last_opposite_wick_max = waitOneBarLastOppWickMax;
  let waitOneBarRecentMove1PctMin = clampNumber(body.wait_one_bar_recent_move1_pct_min, 0.05, 10);
  if (waitOneBarRecentMove1PctMin == null) waitOneBarRecentMove1PctMin = 0.45;
  clean.wait_one_bar_recent_move1_pct_min = waitOneBarRecentMove1PctMin;
  let waitOneBarCounterDirBarsMax = clampInt(body.wait_one_bar_counter_dir_bars_max, 0, 3);
  if (waitOneBarCounterDirBarsMax == null) waitOneBarCounterDirBarsMax = 0;
  clean.wait_one_bar_counter_dir_bars_max = waitOneBarCounterDirBarsMax;
  clean.reverse_exception_enabled = normalizeBool(body.reverse_exception_enabled === undefined ? true : body.reverse_exception_enabled);
  let reverseExceptionDropCountMin = clampInt(body.reverse_exception_drop_count_min, 1, 10);
  if (reverseExceptionDropCountMin == null) reverseExceptionDropCountMin = 2;
  clean.reverse_exception_drop_count_min = reverseExceptionDropCountMin;
  let reverseExceptionMaxProfitPct = clampNumber(
    body.reverse_exception_max_profit_pct === undefined ? body.reverse_exception_max_abs_pnl_pct : body.reverse_exception_max_profit_pct,
    0,
    100
  );
  if (reverseExceptionMaxProfitPct == null) reverseExceptionMaxProfitPct = 1.5;
  clean.reverse_exception_max_profit_pct = reverseExceptionMaxProfitPct;
  clean.reverse_exception_core_enabled = normalizeBool(body.reverse_exception_core_enabled === undefined ? true : body.reverse_exception_core_enabled);
  clean.reverse_exception_pre_real_enabled = normalizeBool(body.reverse_exception_pre_real_enabled === undefined ? false : body.reverse_exception_pre_real_enabled);
  clean.reverse_exception_real_enabled = normalizeBool(body.reverse_exception_real_enabled === undefined ? false : body.reverse_exception_real_enabled);
  clean.reverse_exception_early_enabled = normalizeBool(body.reverse_exception_early_enabled);

  clean.rescue_add_enabled = normalizeBool(body.rescue_add_enabled);
  clean.rescue_add_tiers = normalizeList(body.rescue_add_tiers)
    .map((v) => String(v || "").trim().toUpperCase())
    .filter((v) => v === "EARLY" || v === "CORE");
  clean.rescue_add_sides = normalizeList(body.rescue_add_sides)
    .map((v) => String(v || "").trim().toUpperCase())
    .filter((v) => v === "LONG" || v === "SHORT");
  let rescueAddSize = clampNumber(body.rescue_add_size, 0, 10);
  if (rescueAddSize == null) rescueAddSize = 1;
  clean.rescue_add_size = rescueAddSize;
  let rescueAddMinLossPct = clampNumber(body.rescue_add_min_loss_pct, 0, 100);
  let rescueAddMaxLossPct = clampNumber(body.rescue_add_max_loss_pct, 0, 100);
  if (rescueAddMinLossPct == null) rescueAddMinLossPct = 0.1;
  if (rescueAddMaxLossPct == null) rescueAddMaxLossPct = 1.4;
  if (rescueAddMinLossPct > rescueAddMaxLossPct) {
    const tmp = rescueAddMinLossPct;
    rescueAddMinLossPct = rescueAddMaxLossPct;
    rescueAddMaxLossPct = tmp;
  }
  clean.rescue_add_min_loss_pct = rescueAddMinLossPct;
  clean.rescue_add_max_loss_pct = rescueAddMaxLossPct;
  const rescueAddMinStopDistancePct = clampNumber(body.rescue_add_min_stop_distance_pct, 0, 100);
  clean.rescue_add_min_stop_distance_pct = rescueAddMinStopDistancePct == null ? null : rescueAddMinStopDistancePct;
  let rescueAddMaxAdds = clampInt(body.rescue_add_max_adds, 0, 10);
  if (rescueAddMaxAdds == null) rescueAddMaxAdds = 1;
  clean.rescue_add_max_adds = rescueAddMaxAdds;
  clean.rescue_add_same_bar_block = normalizeBool(body.rescue_add_same_bar_block === undefined ? true : body.rescue_add_same_bar_block);
  clean.rescue_add_pre_tp1_only = normalizeBool(body.rescue_add_pre_tp1_only === undefined ? true : body.rescue_add_pre_tp1_only);
  clean.rescue_add_block_opposite_transition = normalizeBool(
    body.rescue_add_block_opposite_transition === undefined ? true : body.rescue_add_block_opposite_transition
  );
  clean.rescue_add_scenario = String(body.rescue_add_scenario || "LIVE_RESCUE_ADD").trim().slice(0, 80) || "LIVE_RESCUE_ADD";
  clean.add_guard_enabled = normalizeBool(body.add_guard_enabled === undefined ? true : body.add_guard_enabled);
  let addGuardSoftDrawdownPct = clampNumber(body.add_guard_soft_drawdown_pct, -1, 0);
  let addGuardHardDrawdownPct = clampNumber(body.add_guard_hard_drawdown_pct, -1, 0);
  if (addGuardSoftDrawdownPct == null) addGuardSoftDrawdownPct = -0.006;
  if (addGuardHardDrawdownPct == null) addGuardHardDrawdownPct = -0.016;
  if (addGuardSoftDrawdownPct < addGuardHardDrawdownPct) {
    const tmp = addGuardSoftDrawdownPct;
    addGuardSoftDrawdownPct = addGuardHardDrawdownPct;
    addGuardHardDrawdownPct = tmp;
  }
  clean.add_guard_soft_drawdown_pct = addGuardSoftDrawdownPct;
  clean.add_guard_hard_drawdown_pct = addGuardHardDrawdownPct;
  let addGuardSoftScale = clampNumber(body.add_guard_soft_scale, 0, 1);
  let addGuardHardScale = clampNumber(body.add_guard_hard_scale, 0, 1);
  if (addGuardSoftScale == null) addGuardSoftScale = 0.6;
  if (addGuardHardScale == null) addGuardHardScale = 0.35;
  clean.add_guard_soft_scale = addGuardSoftScale;
  clean.add_guard_hard_scale = addGuardHardScale;
  let addGuardMinQtyFraction = clampNumber(body.add_guard_min_qty_fraction, 0, 1);
  if (addGuardMinQtyFraction == null) addGuardMinQtyFraction = 0.003;
  clean.add_guard_min_qty_fraction = addGuardMinQtyFraction;
  let addGuardMaxLossStreak = clampInt(body.add_guard_max_loss_streak, 0, 10);
  if (addGuardMaxLossStreak == null) addGuardMaxLossStreak = 0;
  clean.add_guard_max_loss_streak = addGuardMaxLossStreak;
  const addGuardDayLossCap = clampNumber(body.add_guard_day_loss_cap_krw, 0, Number.MAX_SAFE_INTEGER);
  clean.add_guard_day_loss_cap_krw = addGuardDayLossCap == null ? null : addGuardDayLossCap;
  clean.add_guard_block_hard_drawdown = normalizeBool(body.add_guard_block_hard_drawdown === undefined ? true : body.add_guard_block_hard_drawdown);
  clean.signal_overlap_enabled = normalizeBool(body.signal_overlap_enabled === undefined ? true : body.signal_overlap_enabled);
  let signalOverlapBars = clampInt(body.signal_overlap_bars, 0, 32);
  if (signalOverlapBars == null) signalOverlapBars = 4;
  clean.signal_overlap_bars = signalOverlapBars;
  clean.tp1_ladder_enabled = normalizeBool(body.tp1_ladder_enabled === undefined ? true : body.tp1_ladder_enabled);
  clean.tp1_ladder_freeze = normalizeBool(body.tp1_ladder_freeze === undefined ? false : body.tp1_ladder_freeze);
  let tp1LadderStage1RealizedNMin = clampInt(body.tp1_ladder_stage1_realized_n_min, 1, 500);
  if (tp1LadderStage1RealizedNMin == null) tp1LadderStage1RealizedNMin = 8;
  clean.tp1_ladder_stage1_realized_n_min = tp1LadderStage1RealizedNMin;
  let tp1LadderStage1Tp0HitRateMin = clampNumber(body.tp1_ladder_stage1_tp0_hit_rate_min, 0, 1);
  if (tp1LadderStage1Tp0HitRateMin == null) tp1LadderStage1Tp0HitRateMin = 0.55;
  clean.tp1_ladder_stage1_tp0_hit_rate_min = tp1LadderStage1Tp0HitRateMin;
  let tp1LadderStage1Tp0ToTp1ConversionMin = clampNumber(body.tp1_ladder_stage1_tp0_to_tp1_conversion_min, 0, 1);
  if (tp1LadderStage1Tp0ToTp1ConversionMin == null) tp1LadderStage1Tp0ToTp1ConversionMin = 0.20;
  clean.tp1_ladder_stage1_tp0_to_tp1_conversion_min = tp1LadderStage1Tp0ToTp1ConversionMin;
  let tp1LadderStage1FeeAdjustedExpectancyMin = clampNumber(body.tp1_ladder_stage1_fee_adjusted_expectancy_min, -1, 1);
  if (tp1LadderStage1FeeAdjustedExpectancyMin == null) tp1LadderStage1FeeAdjustedExpectancyMin = -0.0005;
  clean.tp1_ladder_stage1_fee_adjusted_expectancy_min = tp1LadderStage1FeeAdjustedExpectancyMin;
  let tp1LadderStage2RealizedNMin = clampInt(body.tp1_ladder_stage2_realized_n_min, 1, 1000);
  if (tp1LadderStage2RealizedNMin == null) tp1LadderStage2RealizedNMin = 16;
  clean.tp1_ladder_stage2_realized_n_min = tp1LadderStage2RealizedNMin;
  let tp1LadderStage2Tp0HitRateMin = clampNumber(body.tp1_ladder_stage2_tp0_hit_rate_min, 0, 1);
  if (tp1LadderStage2Tp0HitRateMin == null) tp1LadderStage2Tp0HitRateMin = 0.60;
  clean.tp1_ladder_stage2_tp0_hit_rate_min = tp1LadderStage2Tp0HitRateMin;
  let tp1LadderStage2Tp1HitRateMin = clampNumber(body.tp1_ladder_stage2_tp1_hit_rate_min, 0, 1);
  if (tp1LadderStage2Tp1HitRateMin == null) tp1LadderStage2Tp1HitRateMin = 0.30;
  clean.tp1_ladder_stage2_tp1_hit_rate_min = tp1LadderStage2Tp1HitRateMin;
  let tp1LadderStage2Tp0ToTp1ConversionMin = clampNumber(body.tp1_ladder_stage2_tp0_to_tp1_conversion_min, 0, 1);
  if (tp1LadderStage2Tp0ToTp1ConversionMin == null) tp1LadderStage2Tp0ToTp1ConversionMin = 0.35;
  clean.tp1_ladder_stage2_tp0_to_tp1_conversion_min = tp1LadderStage2Tp0ToTp1ConversionMin;
  let tp1LadderStage2FeeAdjustedExpectancyMin = clampNumber(body.tp1_ladder_stage2_fee_adjusted_expectancy_min, -1, 1);
  if (tp1LadderStage2FeeAdjustedExpectancyMin == null) tp1LadderStage2FeeAdjustedExpectancyMin = 0;
  clean.tp1_ladder_stage2_fee_adjusted_expectancy_min = tp1LadderStage2FeeAdjustedExpectancyMin;
  clean.same_direction_trail_profit_cooldown_enabled = normalizeBool(body.same_direction_trail_profit_cooldown_enabled);
  let sameDirectionTrailProfitCooldownMs = clampInt(
    body.same_direction_trail_profit_cooldown_ms,
    0,
    7 * 24 * 60 * 60 * 1000
  );
  if (sameDirectionTrailProfitCooldownMs == null) sameDirectionTrailProfitCooldownMs = 4 * 60 * 60 * 1000;
  clean.same_direction_trail_profit_cooldown_ms = sameDirectionTrailProfitCooldownMs;
  let oppositeSignalCooldownBars = clampInt(body.opposite_signal_cooldown_bars, 0, 64);
  if (oppositeSignalCooldownBars == null) oppositeSignalCooldownBars = 4;
  clean.opposite_signal_cooldown_bars = oppositeSignalCooldownBars;
  let oppositeSignalCooldownBarsMixed = clampInt(body.opposite_signal_cooldown_bars_mixed, 0, 64);
  if (oppositeSignalCooldownBarsMixed == null) oppositeSignalCooldownBarsMixed = 4;
  clean.opposite_signal_cooldown_bars_mixed = oppositeSignalCooldownBarsMixed;
  let oppositeSignalCooldownBarsRescue = clampInt(body.opposite_signal_cooldown_bars_rescue, 0, 64);
  if (oppositeSignalCooldownBarsRescue == null) oppositeSignalCooldownBarsRescue = 4;
  clean.opposite_signal_cooldown_bars_rescue = oppositeSignalCooldownBarsRescue;
  let oppositeTimeCooldownMs = clampInt(body.opposite_time_cooldown_ms, 0, 7 * 24 * 60 * 60 * 1000);
  if (oppositeTimeCooldownMs == null) oppositeTimeCooldownMs = 60 * 60 * 1000;
  clean.opposite_time_cooldown_ms = oppositeTimeCooldownMs;
  let oppositeTimeCooldownMsMixed = clampInt(body.opposite_time_cooldown_ms_mixed, 0, 7 * 24 * 60 * 60 * 1000);
  if (oppositeTimeCooldownMsMixed == null) oppositeTimeCooldownMsMixed = 60 * 60 * 1000;
  clean.opposite_time_cooldown_ms_mixed = oppositeTimeCooldownMsMixed;
  let oppositeTimeCooldownMsRescue = clampInt(body.opposite_time_cooldown_ms_rescue, 0, 7 * 24 * 60 * 60 * 1000);
  if (oppositeTimeCooldownMsRescue == null) oppositeTimeCooldownMsRescue = 60 * 60 * 1000;
  clean.opposite_time_cooldown_ms_rescue = oppositeTimeCooldownMsRescue;
  clean.opposite_transition_enabled = normalizeBool(body.opposite_transition_enabled === undefined ? true : body.opposite_transition_enabled);
  let oppositeTransitionReduceFraction = clampNumber(body.opposite_transition_reduce_fraction, 0, 1);
  if (oppositeTransitionReduceFraction == null) oppositeTransitionReduceFraction = 0.35;
  clean.opposite_transition_reduce_fraction = oppositeTransitionReduceFraction;
  let oppositeTransitionConfirmBars = clampInt(body.opposite_transition_confirm_bars, 1, 16);
  if (oppositeTransitionConfirmBars == null) oppositeTransitionConfirmBars = 3;
  clean.opposite_transition_confirm_bars = oppositeTransitionConfirmBars;
  clean.opposite_transition_core_real_only = normalizeBool(
    body.opposite_transition_core_real_only === undefined ? true : body.opposite_transition_core_real_only
  );
  let maxHoldBars = clampInt(body.max_hold_bars, 0, 1000);
  if (maxHoldBars == null) maxHoldBars = 12;
  clean.max_hold_bars = maxHoldBars;

  clean.reinvest_enabled = normalizeBool(body.reinvest_enabled);
  let reinvestRatio = clampNumber(body.reinvest_ratio, 0, 1);
  if (reinvestRatio == null) reinvestRatio = 0.5;
  clean.reinvest_ratio = reinvestRatio;
  clean.auto_score_freeze = normalizeBool(body.auto_score_freeze === undefined ? false : body.auto_score_freeze);

  if (clean.execution_mode !== "LIVE") {
    clean.live_enabled = false;
  }

  clean.updated_at = new Date().toISOString();
  clean.updated_by = (reqUser(req) || "api").slice(0, 120);
  return clean;
}

const SYSTEM_GLOBAL_KEYS = [
  "scheduler_enabled",
  "scheduler_interval_sec",
  "timezone",
  "retry_max",
  "log_level",
  "alert_channel",
  "data_retention_days",
  "auto_backfill_enabled",
  "auto_backfill_days",
  "phase0_paper_only",
];

const SYSTEM_PROVIDER_KEYS = [
  "fee_bps",
  "slippage_bps",
  "slippage_model",
  "slippage_bps_min",
  "slippage_bps_max",
  "slippage_volatility_factor",
  "fee_bps_by_market",
  "slippage_bps_by_market",
  "intent_ttl_ms",
  "intent_ttl_bars",
  "execution_mode",
  "live_enabled",
  "binance_real_trading_enabled",
  "live_dry_run",
  "live_min_order_krw",
  "live_max_order_krw",
  "live_allowed_markets",
  "live_confirm_required",
  "futures_leverage",
  "futures_margin_type",
  "futures_exit_profile_mode",
  "gate_enabled",
  "gate_trend_only",
  "gate_core_enabled",
  "gate_pre_real_enabled",
  "gate_real_enabled",
  "gate_early_enabled",
  "gate_core_score_abs",
  "gate_pre_real_score_abs",
  "gate_real_score_abs",
  "gate_early_score_abs",
  "gate_conf_min",
  "gate_wave_conf_min",
  "gate_block_conflict",
  "gate_transition_exception_enabled",
  "gate_transition_exception_core_enabled",
  "gate_transition_exception_pre_real_enabled",
  "gate_transition_exception_real_enabled",
  "gate_transition_exception_early_enabled",
  "gate_transition_exception_score_abs",
  "gate_transition_exception_wave_conf_min",
  "canonical_engine_enabled",
  "canonical_engine_shadow_enabled",
  "canonical_engine_source_mode",
  "canonical_engine_core_score_abs",
  "canonical_engine_transition_core_score_abs",
  "canonical_engine_market_overrides",
  "ai_missing_policy",
  "ai_missing_reduce_pct",
  "ai_bias_gate_enabled",
  "ai_bias_gate_neutral_policy",
  "ai_bias_gate_score_threshold",
  "ai_bias_gate_conf_min",
  "ai_bias_gate_core_enabled",
  "ai_bias_gate_pre_real_enabled",
  "ai_bias_gate_real_enabled",
  "ai_bias_gate_early_enabled",
  "ai_bias_gate_emo_enabled",
  "ai_bias_gate_neutral_mult",
  "ai_bias_gate_opposite_mult",
  "ai_bias_gate_strong_opposite_score",
  "ai_bias_gate_strong_opposite_conf",
  "ev_gate_enabled",
  "ev_gate_global_report_only_enabled",
  "ev_gate_core_enabled",
  "ev_gate_pre_real_enabled",
  "ev_gate_real_enabled",
  "ev_gate_early_enabled",
  "ev_gate_tp1_prob_min",
  "ev_gate_tp1_prob_min_early",
  "ev_gate_tp1_prob_min_core",
  "ev_gate_tp1_prob_min_pre_real",
  "ev_gate_tp1_prob_min_real",
  "ev_gate_tp1_prob_full",
  "ev_gate_tp1_prob_kill",
  "ev_gate_qty_scale_mid",
  "ev_gate_qty_scale_low",
  "ev_gate_lookback_bars",
  "ev_gate_atr_bars",
  "ev_gate_default_tp1_pct",
  "ev_gate_default_sl_pct",
  "ev_gate_skip_missing_bars",
  "wait_one_bar_enabled",
  "wait_one_bar_core_enabled",
  "wait_one_bar_pre_real_enabled",
  "wait_one_bar_real_enabled",
  "wait_one_bar_early_enabled",
  "wait_one_bar_same_dir_streak_min",
  "wait_one_bar_chase_ratio_min",
  "wait_one_bar_last_close_control_min",
  "wait_one_bar_last_dir_body_min",
  "wait_one_bar_last_opposite_wick_max",
  "wait_one_bar_recent_move1_pct_min",
  "wait_one_bar_counter_dir_bars_max",
  "reverse_exception_enabled",
  "reverse_exception_drop_count_min",
  "reverse_exception_max_profit_pct",
  "reverse_exception_core_enabled",
  "reverse_exception_pre_real_enabled",
  "reverse_exception_real_enabled",
  "reverse_exception_early_enabled",
  "rescue_add_enabled",
  "rescue_add_tiers",
  "rescue_add_sides",
  "rescue_add_size",
  "rescue_add_min_loss_pct",
  "rescue_add_max_loss_pct",
  "rescue_add_min_stop_distance_pct",
  "rescue_add_max_adds",
  "rescue_add_same_bar_block",
  "rescue_add_pre_tp1_only",
  "rescue_add_block_opposite_transition",
  "rescue_add_scenario",
  "add_guard_enabled",
  "add_guard_soft_drawdown_pct",
  "add_guard_hard_drawdown_pct",
  "add_guard_soft_scale",
  "add_guard_hard_scale",
  "add_guard_min_qty_fraction",
  "add_guard_max_loss_streak",
  "add_guard_day_loss_cap_krw",
  "add_guard_block_hard_drawdown",
  "signal_overlap_enabled",
  "signal_overlap_bars",
  "tp1_ladder_enabled",
  "tp1_ladder_freeze",
  "tp1_ladder_stage1_realized_n_min",
  "tp1_ladder_stage1_tp0_hit_rate_min",
  "tp1_ladder_stage1_tp0_to_tp1_conversion_min",
  "tp1_ladder_stage1_fee_adjusted_expectancy_min",
  "tp1_ladder_stage2_realized_n_min",
  "tp1_ladder_stage2_tp0_hit_rate_min",
  "tp1_ladder_stage2_tp1_hit_rate_min",
  "tp1_ladder_stage2_tp0_to_tp1_conversion_min",
  "tp1_ladder_stage2_fee_adjusted_expectancy_min",
  "same_direction_trail_profit_cooldown_enabled",
  "same_direction_trail_profit_cooldown_ms",
  "opposite_signal_cooldown_bars",
  "opposite_signal_cooldown_bars_mixed",
  "opposite_signal_cooldown_bars_rescue",
  "opposite_time_cooldown_ms",
  "opposite_time_cooldown_ms_mixed",
  "opposite_time_cooldown_ms_rescue",
  "opposite_transition_enabled",
  "opposite_transition_reduce_fraction",
  "opposite_transition_confirm_bars",
  "opposite_transition_core_real_only",
  "max_hold_bars",
  // Legacy mirrors (temporary)
  "short_gate_enabled",
  "short_gate_trend_only",
  "short_gate_core_enabled",
  "short_gate_pre_real_enabled",
  "short_gate_real_enabled",
  "short_gate_early_enabled",
  "short_gate_core_score_abs",
  "short_gate_pre_real_score_abs",
  "short_gate_real_score_abs",
  "short_gate_early_score_abs",
  "short_gate_conf_min",
  "short_gate_wave_conf_min",
  "short_gate_block_conflict",
  "auto_score_freeze",
  "reinvest_enabled",
  "reinvest_ratio",
];

function pickKeys(src, keys) {
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  }
  return out;
}

function stripLegacyProviderSettings(src = {}) {
  const out = { ...(src || {}) };
  const legacyKeys = [
    "bar_context_gate_enabled",
    "bar_context_gate_core_enabled",
    "bar_context_gate_pre_real_enabled",
    "bar_context_gate_real_enabled",
    "bar_context_gate_early_enabled",
    "bar_context_gate_lookback_bars",
    "bar_context_gate_move_bars",
    "bar_context_gate_min_consecutive_bars",
    "bar_context_gate_max_move_pct",
    "bar_context_gate_max_move_range_mult",
    "ev_gate_gain_pct",
    "ev_gate_loss_pct",
    "ev_gate_cost_pct",
    "ev_gate_edge_min",
    "ev_gate_skip_missing_posterior",
  ];
  for (const key of legacyKeys) delete out[key];
  return out;
}

function normalizeBpsMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [mk, v0] of Object.entries(raw)) {
    const key = String(mk || "").trim();
    if (!key) continue;
    let v = v0;
    if (v0 && typeof v0 === "object") {
      v = v0.bps ?? v0.value ?? v0.max ?? v0.fee_bps ?? v0.slippage_bps ?? null;
    }
    const val = clampInt(v, 0, 10000);
    if (val == null) continue;
    out[key] = val;
  }
  return out;
}

function normalizeCanonicalEngineSourceMode(raw, fallback = "PINE_PRIMARY") {
  const value = String(raw || "").trim().toUpperCase();
  if (value === "PINE_PRIMARY" || value === "SERVER_SHADOW" || value === "SERVER_PRIMARY") return value;
  return fallback;
}

function normalizeCanonicalEngineMarketOverrides(raw) {
  if (raw === null || raw === undefined || raw === "") return {};
  let source = raw;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch (_err) {
      return {};
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const out = {};
  for (const [market, value] of Object.entries(source)) {
    const key = String(market || "").trim().toUpperCase().replace(/\.P$/, "");
    if (!key) continue;
    const row = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : { core_score_abs: value };
    const normalized = {};
    if (row.enabled !== undefined) normalized.enabled = normalizeBool(row.enabled);
    if (row.shadow_enabled !== undefined) normalized.shadow_enabled = normalizeBool(row.shadow_enabled);
    if (row.source_mode !== undefined) normalized.source_mode = normalizeCanonicalEngineSourceMode(row.source_mode, "PINE_PRIMARY");
    const coreScoreAbs = clampNumber(row.core_score_abs, 0, 100);
    const transitionCoreScoreAbs = clampNumber(row.transition_core_score_abs, 0, 100);
    if (coreScoreAbs != null) normalized.core_score_abs = coreScoreAbs;
    if (transitionCoreScoreAbs != null) normalized.transition_core_score_abs = transitionCoreScoreAbs;
    if (Object.keys(normalized).length) out[key] = normalized;
  }
  return out;
}

function normalizeAi(req, body) {
  const clean = {};
  const lang = String(body.language || "ko").toLowerCase();
  clean.language = (lang === "en" || lang === "kr" || lang === "ko") ? (lang === "kr" ? "ko" : lang) : "ko";
  const length = String(body.summary_length || "medium").toLowerCase();
  clean.summary_length = ["short", "medium", "long"].includes(length) ? length : "medium";
  const emphasis = String(body.report_emphasis || "EV").toUpperCase();
  clean.report_emphasis = ["EV", "MDD", "GATE", "BALANCED"].includes(emphasis) ? emphasis : "EV";
  clean.warnings_enabled = normalizeBool(body.warnings_enabled);
  clean.table_ratio = clampInt(body.table_ratio, 0, 100);
  if (clean.table_ratio == null) clean.table_ratio = 60;

  clean.updated_at = new Date().toISOString();
  clean.updated_by = (reqUser(req) || "api").slice(0, 120);
  return clean;
}

function normalizeAiGuard(req, body, current) {
  const cur = current && typeof current === "object" ? current : {};
  const clean = {};
  const clearKey = normalizeBool(body.clear_key || body.clear);
  let claudeApiKey = cur.claude_api_key || null;
  if (clearKey) {
    claudeApiKey = null;
  } else {
    const k = String(body.claude_api_key || body.claude_key || "").trim();
    if (k) claudeApiKey = k;
  }
  clean.claude_api_key = claudeApiKey;

  const curAllow = clampNumber(cur.ensemble_allow_min, 0, 1);
  const curReduce = clampNumber(cur.ensemble_reduce_min, 0, 1);
  let allowMin = clampNumber(body.ensemble_allow_min, 0, 1);
  let reduceMin = clampNumber(body.ensemble_reduce_min, 0, 1);
  if (allowMin == null) allowMin = curAllow;
  if (reduceMin == null) reduceMin = curReduce;
  if (allowMin == null) allowMin = 0.6;
  if (reduceMin == null) reduceMin = 0.45;
  if (reduceMin > allowMin) reduceMin = allowMin;
  clean.ensemble_allow_min = allowMin;
  clean.ensemble_reduce_min = reduceMin;

  const curModel = String(cur.claude_model || "").trim();
  const modelRaw = String(body.claude_model || "").trim();
  clean.claude_model = modelRaw || curModel || "claude-opus-4-5-20251101";

  clean.updated_at = new Date().toISOString();
  clean.updated_by = (reqUser(req) || "api").slice(0, 120);
  return clean;
}

function normalizeExchanges(req, body, current) {
  const cur = current && typeof current === "object" ? current : {};
  const clean = {};

  const rawProvider = String(body.provider || cur.provider || "BINANCEFUT").trim().toUpperCase();
  clean.provider = rawProvider.includes("BINANCE") ? "BINANCEFUT" : "BINANCEFUT";
  clean.enabled = normalizeBool(body.enabled);

  const marketsRaw = listFromRaw(body.markets);
  const markets = marketsRaw.map((m) => normalizeMarketSymbolForProvider(m, clean.provider)).filter(Boolean);
  clean.markets = ensureBinanceCoreMarkets(markets.length
    ? Array.from(new Set(markets))
    : (Array.isArray(cur.markets) && cur.markets.length ? cur.markets : defaultMarketsFromEnv(clean.provider)), clean.provider);

  const tfRaw = listFromRaw(body.tf_allowlist || body.tf_allow);
  const { supported: tfSupported } = filterSupportedTf(tfRaw);
  if (tfSupported.length) {
    clean.tf_allowlist = tfSupported;
  } else if (Array.isArray(cur.tf_allowlist) && cur.tf_allowlist.length) {
    clean.tf_allowlist = cur.tf_allowlist;
  } else {
    clean.tf_allowlist = defaultTfAllowlistFromEnv();
  }

  const execTfRaw = String(body.exec_tf || body.execution_tf || cur.exec_tf || defaultExecTfFromEnv()).trim();
  const execTf = normalizeTf(execTfRaw) || normalizeTf(cur.exec_tf) || defaultExecTfFromEnv();
  clean.exec_tf = execTf;

  const clearKeys = normalizeBool(body.clear_keys);
  let apiKey = cur.api_key || null;
  let apiSecret = cur.api_secret || null;

  if (clearKeys) {
    apiKey = null;
    apiSecret = null;
  } else {
    const k = String(body.api_key || "").trim();
    const s = String(body.api_secret || "").trim();
    if (k) apiKey = k;
    if (s) apiSecret = s;
  }

  clean.api_key = apiKey;
  clean.api_secret = apiSecret;

  clean.updated_at = new Date().toISOString();
  clean.updated_by = (reqUser(req) || "api").slice(0, 120);
  return clean;
}

// normalizeProviderId / pickProviderEntry are centralized in providerUtils.

function reqUser(req) {
  try {
    return req.user && (req.user.email || req.user.id || req.user.name) ? String(req.user.email || req.user.id || req.user.name) : null;
  } catch (_) {
    return null;
  }
}

const SETTINGS_CHANGE_COLLECTION = "settings_change_log";
const DEV_CHANGE_COLLECTION = "dev_change_log";
const SENSITIVE_PATH_RE = /(api[_-]?key|api[_-]?secret|app[_-]?key|app[_-]?secret|secret|token|password|private[_-]?key|access[_-]?key)/i;

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function shouldRedactPath(path) {
  if (!path) return false;
  const key = String(path).split(".").pop();
  return SENSITIVE_PATH_RE.test(key);
}

function normalizeLeafForLog(value) {
  if (Array.isArray(value)) {
    if (value.length <= 50) return value;
    return {
      _type: "array",
      count: value.length,
      head: value.slice(0, 20),
      tail: value.slice(-5),
    };
  }
  if (typeof value === "string") {
    if (value.length <= 200) return value;
    return value.slice(0, 200) + "...";
  }
  return value;
}

function diffForLog(before, after, path = "", out = []) {
  if (shouldRedactPath(path)) {
    const beforeSet = before !== undefined && before !== null && String(before) !== "";
    const afterSet = after !== undefined && after !== null && String(after) !== "";
    const same = before === after;
    if (same || (!beforeSet && !afterSet)) return out;
    const note = beforeSet && afterSet
      ? "VALUE_CHANGED"
      : (afterSet ? "SET" : "CLEARED");
    out.push({
      path,
      before: beforeSet ? "SET" : "EMPTY",
      after: afterSet ? "SET" : "EMPTY",
      redacted: true,
      note,
    });
    return out;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      diffForLog(before[key], after[key], nextPath, out);
    }
    return out;
  }

  if (Array.isArray(before) || Array.isArray(after)) {
    const b = Array.isArray(before) ? before : [];
    const a = Array.isArray(after) ? after : [];
    if (JSON.stringify(b) === JSON.stringify(a)) return out;
    out.push({
      path,
      before: normalizeLeafForLog(b),
      after: normalizeLeafForLog(a),
    });
    return out;
  }

  if (before === after) return out;
  out.push({
    path,
    before: normalizeLeafForLog(before),
    after: normalizeLeafForLog(after),
  });
  return out;
}

async function logSettingsChange({ db, source, provider, scope, before, after, req, extra } = {}) {
  if (!db || !source) return false;
  const changes = diffForLog(before || {}, after || {});
  if (!changes.length) return false;

  const createdAt = new Date().toISOString();
  const createdBy = (reqUser(req) || "api").slice(0, 120);
  const ipRaw = req ? (req.get("x-forwarded-for") || req.ip || "") : "";
  const actorIp = String(ipRaw || "").split(",")[0].trim();
  const userAgent = req ? String(req.get("user-agent") || "").slice(0, 200) : "";

  const payload = {
    created_at: createdAt,
    created_by: createdBy,
    source,
    provider: provider || null,
    scope: scope || null,
    actor_ip: actorIp || null,
    user_agent: userAgent || null,
    changes,
    ...(extra || {}),
  };

  await db.collection(SETTINGS_CHANGE_COLLECTION).add(payload);
  return true;
}

function normalizeDevChangeBody(req, body) {
  const clean = {};
  clean.title = String(body.title || body.summary || "dev change").trim().slice(0, 200);
  clean.summary = String(body.summary || "").trim().slice(0, 2000);
  clean.source = String(body.source || "manual").trim().slice(0, 80) || "manual";
  clean.tags = normalizeList(body.tags || []);
  clean.changes = Array.isArray(body.changes) ? body.changes.slice(0, 500) : [];
  clean.meta = (body.meta && typeof body.meta === "object") ? body.meta : {};
  clean.created_at = new Date().toISOString();
  clean.created_by = (reqUser(req) || "api").slice(0, 120);
  return clean;
}

// Apply auth only for /api/settings/*, not for unrelated routes.
router.use("/api/settings", ensureAuthOrSchedulerToken);

/**
 * GET /api/settings/change-log
 * query: limit=50, provider=BINANCEFUT, source=settings/system
 */
router.get("/api/settings/change-log", async (req, res) => {
  try {
    const db = getFirestore();
    const limit = clampInt(req.query.limit, 1, 200) || 50;
    const scan = clampInt(req.query.scan, limit, 1000) || Math.max(limit, 200);
    const provider = req.query.provider ? normalizeProviderId(req.query.provider) : "";
    const source = req.query.source ? String(req.query.source || "").trim() : "";

    const snap = await db.collection(SETTINGS_CHANGE_COLLECTION)
      .orderBy("created_at", "desc")
      .limit(scan)
      .get();

    const data = [];
    snap.forEach((d) => {
      if (data.length >= limit) return;
      const row = d.data() || {};
      if (provider && String(row.provider || "").toUpperCase() !== provider) return;
      if (source && String(row.source || "") !== source) return;
      data.push({ id: d.id, ...row });
    });

    return res.json({ ok: true, data, limit, scanned: snap.size });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_SETTINGS_CHANGE_LOG_ERROR", message: e.message });
  }
});

/**
 * GET /api/dev-change-log
 * query: limit=50, source=deploy
 */
router.get("/api/dev-change-log", ensureAuthOrSchedulerToken, async (req, res) => {
  try {
    const db = getFirestore();
    const limit = clampInt(req.query.limit, 1, 200) || 50;
    const source = req.query.source ? String(req.query.source || "").trim() : "";
    const snap = await db.collection(DEV_CHANGE_COLLECTION)
      .orderBy("created_at", "desc")
      .limit(limit)
      .get();
    const data = [];
    snap.forEach((d) => {
      const row = d.data() || {};
      if (source && String(row.source || "") !== source) return;
      data.push({ id: d.id, ...row });
    });
    return res.json({ ok: true, data, limit });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_DEV_CHANGE_LOG_ERROR", message: e.message });
  }
});

/**
 * POST /api/dev-change-log
 * body: { title, summary, source, tags, changes, meta }
 */
router.post("/api/dev-change-log", ensureAuthOrSchedulerToken, async (req, res) => {
  try {
    const db = getFirestore();
    const clean = normalizeDevChangeBody(req, req.body || {});
    await db.collection(DEV_CHANGE_COLLECTION).add(clean);
    return res.json({ ok: true, stored: "dev_change_log", data: clean });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SET_DEV_CHANGE_LOG_ERROR", message: e.message });
  }
});

/**
 * GET /api/settings/risk-budget
 * => settings/risk_budget 문서를 반환
 */
router.get("/api/settings/risk-budget", async (req, res) => {
  try {
    const db = getFirestore();
    const doc = await db.collection("settings").doc("risk_budget").get();
    const raw = doc.exists ? (doc.data() || {}) : null;
    const rawProvider = req.query.provider || req.query.exchange || req.query.ex;
    const provider = rawProvider ? normalizeProviderId(rawProvider) : "";
    if (provider) {
      const providers = raw && typeof raw.providers === "object" ? raw.providers : null;
      const legacyProvider = normalizeProviderId(raw && raw.provider ? raw.provider : "BINANCEFUT");
      const entry = pickProviderEntry(providers, provider) || (provider === legacyProvider ? raw : null);
      const unit = String((entry && entry.unit) || (provider === "BINANCEFUT" ? "USDT" : "KRW")).toUpperCase();
      const data = entry && typeof entry === "object"
        ? { ...entry, provider, unit }
        : {
          enabled: false,
          on_exceed: "CLAMP",
          total_max_krw: 0,
          default_max_krw: 0,
          by_market: {},
          provider,
          unit,
        };
      try {
        const exCfg = await getExchangeSettingsForProvider(provider, 3000);
        const expectedMarkets = Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [];
        data.by_market = mergeBudgetMarkets({
          provider,
          byMarket: data.by_market,
          defaultMax: data.default_max_krw,
          expectedMarkets,
        });
      } catch (_) {
        data.by_market = mergeBudgetMarkets({
          provider,
          byMarket: data.by_market,
          defaultMax: data.default_max_krw,
          expectedMarkets: [],
        });
      }
      if (provider === "BINANCEFUT") {
        try {
          const ex = await getExchangeSettingsForProvider("BINANCEFUT", 3000);
          const apiKey = String(process.env.BINANCEFUT_API_KEY || (ex && ex.api_key) || "");
          const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (ex && ex.api_secret) || "");
          if (apiKey && apiSecret) {
            const summary = await getBinanceFuturesAccountSummary({ apiKey, apiSecret });
            const totalValue = Number(summary && summary.total_value);
            if (Number.isFinite(totalValue) && totalValue > 0) {
              data.total_max_krw = totalValue;
              data.total_max_source = "account_total";
              data.account_total_value = totalValue;
            }
          }
        } catch (_) {}
      }
      return res.json({ ok: true, data, source: "settings/risk_budget" });
    }
    const data = raw || {
      enabled: false,
      on_exceed: "CLAMP",
      total_max_krw: 0,
      default_max_krw: 0,
      by_market: {},
    };
    return res.json({ ok: true, data, source: "settings/risk_budget" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_RISK_BUDGET_ERROR", message: e.message });
  }
});

/**
 * POST /api/settings/risk-budget
 * body: { enabled, on_exceed, default_max_krw, by_market }
 */
  router.post("/api/settings/risk-budget", async (req, res) => {
  try {
    const db = getFirestore();

    // normalize, validate
    const provider = normalizeProviderId(req.query.provider || req.body.provider || "");
    const clean = normalizeBudget(req, req.body || {}, provider);
    try {
      const exCfg = await getExchangeSettingsForProvider(clean.provider, 3000);
      clean.by_market = mergeBudgetMarkets({
        provider: clean.provider,
        byMarket: clean.by_market,
        defaultMax: clean.default_max_krw,
        expectedMarkets: Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [],
      });
    } catch (_) {
      clean.by_market = mergeBudgetMarkets({
        provider: clean.provider,
        byMarket: clean.by_market,
        defaultMax: clean.default_max_krw,
        expectedMarkets: [],
      });
    }
    const guard = await applyBinanceMinBudget({ db, clean });

    const snap = await db.collection("settings").doc("risk_budget").get();
    const raw = snap.exists ? (snap.data() || {}) : {};
    const providers = (raw.providers && typeof raw.providers === "object") ? { ...raw.providers } : {};
    const beforeEntry = providers[clean.provider] || {};
    const oldProviderByMarket = (
      beforeEntry &&
      typeof beforeEntry === "object" &&
      beforeEntry.by_market &&
      typeof beforeEntry.by_market === "object"
    ) ? beforeEntry.by_market : {};
    const oldRootByMarket = (
      false && raw && typeof raw.by_market === "object" && raw.by_market
    ) ? raw.by_market : {};
    providers[clean.provider] = clean;

    const payload = {
      providers,
      updated_at: clean.updated_at,
      updated_by: clean.updated_by,
    };
    

    await db.collection("settings").doc("risk_budget").set(payload, { merge: true });
    // Firestore merge keeps unknown nested keys; remove stale by_market keys explicitly.
    const deletePayload = {};
    for (const key of Object.keys(oldProviderByMarket)) {
      if (!Object.prototype.hasOwnProperty.call(clean.by_market, key)) {
        deletePayload[`providers.${clean.provider}.by_market.${key}`] = FieldValue.delete();
      }
    }
    
    if (Object.keys(deletePayload).length) {
      const riskRef = db.collection("settings").doc("risk_budget");
      try {
        await riskRef.update(deletePayload);
      } catch (_) {
        await riskRef.set(deletePayload, { merge: true });
      }
    }

    try { invalidateRiskBudgetCache(); } catch (_) {}
    try {
      await db.collection("risk_budget_history").add({
        created_at: clean.updated_at,
        created_by: clean.updated_by,
        source: "settings/risk_budget",
        provider: clean.provider,
        snapshot: clean,
      });
    } catch (_) {}

    try {
      await logSettingsChange({
        db,
        source: "settings/risk_budget",
        provider: clean.provider,
        scope: "provider",
        before: beforeEntry,
        after: clean,
        req,
      });
    } catch (_) {}

    return res.json({
      ok: true,
      stored: "settings/risk_budget",
      data: clean,
      adjustments: guard.adjustments || [],
      warnings: guard.warnings || [],
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SET_RISK_BUDGET_ERROR", message: e.message });
  }
});

/**
 * GET /api/settings/risk-budget/history
 */
router.get("/api/settings/risk-budget/history", async (req, res) => {
  try {
    const db = getFirestore();
    const limit = clampInt(req.query.limit, 1, 100) || 12;
    const rawProvider = req.query.provider || req.query.exchange || req.query.ex;
    const provider = rawProvider ? normalizeProviderId(rawProvider) : "";
    let query = db.collection("risk_budget_history").orderBy("created_at", "desc");
    if (provider) {
      query = query.where("provider", "==", provider);
    }
    const snap = await query.limit(limit).get();
    const data = [];
    snap.forEach((d) => data.push({ id: d.id, ...(d.data() || {}) }));
    return res.json({ ok: true, data, limit });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_RISK_BUDGET_HISTORY_ERROR", message: e.message });
  }
});

/**
 * GET /api/settings/system
 */
router.get("/api/settings/system", async (req, res) => {
  try {
    const providerRaw = req.query.provider || req.query.exchange || "";
    const provider = normalizeProviderId(providerRaw || "");
    if (providerRaw) {
      const resSys = await getSystemSettingsForProvider(provider, 0);
      const data = (resSys && resSys.data) ? resSys.data : {};
      return res.json({ ok: true, data, provider, source: "settings/system.providers" });
    }

    const db = getFirestore();
    const doc = await db.collection("settings").doc("system").get();
    const fallback = {
      scheduler_enabled: true,
      scheduler_interval_sec: 900,
      timezone: "Asia/Seoul",
      retry_max: 0,
      log_level: "INFO",
      alert_channel: "",
      data_retention_days: 30,
      auto_backfill_enabled: false,
      auto_backfill_days: 0,
      fee_bps: 0,
      slippage_bps: 0,
      slippage_model: "FIXED",
      slippage_bps_min: null,
      slippage_bps_max: null,
      slippage_volatility_factor: 0.1,
      fee_bps_by_market: {},
      slippage_bps_by_market: {},
      intent_ttl_ms: null,
      intent_ttl_bars: 2,
      execution_mode: "PAPER",
      phase0_paper_only: false,
      live_enabled: false,
      live_dry_run: false,
      live_min_order_krw: 5000,
      live_max_order_krw: 0,
      live_allowed_markets: [],
      live_confirm_required: true,
      reinvest_enabled: false,
      reinvest_ratio: 0.5,
      futures_margin_type: "ISOLATED",
      futures_exit_profile_mode: "BASE",
      gate_enabled: true,
      gate_trend_only: true,
      gate_core_enabled: true,
      gate_pre_real_enabled: false,
      gate_real_enabled: false,
      gate_early_enabled: false,
      gate_core_score_abs: 35,
      gate_pre_real_score_abs: 40,
      gate_real_score_abs: 45,
      gate_early_score_abs: 25,
      gate_conf_min: 0.50,
      gate_wave_conf_min: 0.6,
      gate_block_conflict: true,
      gate_transition_exception_enabled: true,
      gate_transition_exception_core_enabled: true,
      gate_transition_exception_pre_real_enabled: true,
      gate_transition_exception_real_enabled: false,
      gate_transition_exception_early_enabled: false,
      gate_transition_exception_score_abs: 40,
      gate_transition_exception_wave_conf_min: 0.6,
      canonical_engine_enabled: true,
      canonical_engine_shadow_enabled: true,
      canonical_engine_source_mode: "PINE_PRIMARY",
      canonical_engine_core_score_abs: 33,
      canonical_engine_transition_core_score_abs: 29,
      canonical_engine_market_overrides: {},
      ai_missing_policy: "ALLOW",
      ai_missing_reduce_pct: 0.5,
      ai_bias_gate_enabled: true,
      ai_bias_gate_neutral_policy: "allow",
      ai_bias_gate_score_threshold: 0.01,
      ai_bias_gate_conf_min: 0,
      ai_bias_gate_core_enabled: true,
      ai_bias_gate_pre_real_enabled: false,
      ai_bias_gate_real_enabled: false,
      ai_bias_gate_early_enabled: false,
      ai_bias_gate_emo_enabled: false,
      ai_bias_gate_neutral_mult: 0.5,
      ai_bias_gate_opposite_mult: 0.35,
      ai_bias_gate_strong_opposite_score: 0.2,
      ai_bias_gate_strong_opposite_conf: 0.55,
      ev_gate_enabled: true,
      ev_gate_global_report_only_enabled: true,
      ev_gate_core_enabled: true,
      ev_gate_pre_real_enabled: false,
      ev_gate_real_enabled: false,
      ev_gate_early_enabled: true,
      ev_gate_tp1_prob_min: 0.55,
      ev_gate_tp1_prob_min_early: 0.55,
      ev_gate_tp1_prob_min_core: 0.55,
      ev_gate_tp1_prob_min_pre_real: 0.55,
      ev_gate_tp1_prob_min_real: 0.55,
      ev_gate_tp1_prob_full: 0.60,
      ev_gate_tp1_prob_kill: 0.50,
      ev_gate_qty_scale_mid: 0.70,
      ev_gate_qty_scale_low: 0.40,
      ev_gate_lookback_bars: 12,
      ev_gate_atr_bars: 8,
      ev_gate_default_tp1_pct: 3.25,
      ev_gate_default_sl_pct: 1.65,
      ev_gate_skip_missing_bars: true,
      reverse_exception_enabled: true,
      reverse_exception_drop_count_min: 2,
      reverse_exception_max_profit_pct: 1.5,
      reverse_exception_core_enabled: true,
      reverse_exception_pre_real_enabled: false,
      reverse_exception_real_enabled: false,
      reverse_exception_early_enabled: false,
      // Legacy mirrors
      short_gate_enabled: true,
      short_gate_trend_only: true,
      short_gate_core_enabled: true,
      short_gate_pre_real_enabled: false,
      short_gate_real_enabled: false,
      short_gate_early_enabled: false,
      short_gate_core_score_abs: 35,
      short_gate_pre_real_score_abs: 40,
      short_gate_real_score_abs: 45,
      short_gate_early_score_abs: 25,
      short_gate_conf_min: 0.50,
      short_gate_wave_conf_min: 0.6,
      short_gate_block_conflict: true,
    };
    const rawDoc = doc.exists ? (doc.data() || {}) : {};
    const rawProviders = rawDoc.providers && typeof rawDoc.providers === "object"
      ? Object.fromEntries(Object.entries(rawDoc.providers).map(([id, cfg]) => [id, stripLegacyProviderSettings(cfg)]))
      : undefined;
    const raw = stripLegacyProviderSettings({
      ...rawDoc,
      ...(rawProviders ? { providers: rawProviders } : {}),
    });
    const data = { ...fallback, ...raw };
    if ((data.gate_enabled === undefined || data.gate_enabled === null) && data.short_gate_enabled !== undefined) data.gate_enabled = data.short_gate_enabled;
    if ((data.gate_trend_only === undefined || data.gate_trend_only === null) && data.short_gate_trend_only !== undefined) data.gate_trend_only = data.short_gate_trend_only;
    if ((data.gate_core_enabled === undefined || data.gate_core_enabled === null) && data.short_gate_core_enabled !== undefined) data.gate_core_enabled = data.short_gate_core_enabled;
    if ((data.gate_pre_real_enabled === undefined || data.gate_pre_real_enabled === null) && data.short_gate_pre_real_enabled !== undefined) data.gate_pre_real_enabled = data.short_gate_pre_real_enabled;
    if ((data.gate_real_enabled === undefined || data.gate_real_enabled === null) && data.short_gate_real_enabled !== undefined) data.gate_real_enabled = data.short_gate_real_enabled;
    if ((data.gate_early_enabled === undefined || data.gate_early_enabled === null) && data.short_gate_early_enabled !== undefined) data.gate_early_enabled = data.short_gate_early_enabled;
    if ((data.gate_core_score_abs === undefined || data.gate_core_score_abs === null) && data.short_gate_core_score_abs !== undefined) data.gate_core_score_abs = data.short_gate_core_score_abs;
    if ((data.gate_pre_real_score_abs === undefined || data.gate_pre_real_score_abs === null) && data.short_gate_pre_real_score_abs !== undefined) data.gate_pre_real_score_abs = data.short_gate_pre_real_score_abs;
    if ((data.gate_real_score_abs === undefined || data.gate_real_score_abs === null) && data.short_gate_real_score_abs !== undefined) data.gate_real_score_abs = data.short_gate_real_score_abs;
    if ((data.gate_early_score_abs === undefined || data.gate_early_score_abs === null) && data.short_gate_early_score_abs !== undefined) data.gate_early_score_abs = data.short_gate_early_score_abs;
    if ((data.gate_conf_min === undefined || data.gate_conf_min === null) && data.short_gate_conf_min !== undefined) data.gate_conf_min = data.short_gate_conf_min;
    if ((data.gate_wave_conf_min === undefined || data.gate_wave_conf_min === null) && data.short_gate_wave_conf_min !== undefined) data.gate_wave_conf_min = data.short_gate_wave_conf_min;
    if ((data.gate_block_conflict === undefined || data.gate_block_conflict === null) && data.short_gate_block_conflict !== undefined) data.gate_block_conflict = data.short_gate_block_conflict;
    return res.json({ ok: true, data, source: "settings/system" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_SYSTEM_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * POST /api/settings/system
 */
router.post("/api/settings/system", async (req, res) => {
  try {
    const db = getFirestore();
    const providerRaw = req.query.provider || req.query.exchange || req.body?.provider || "";
    const provider = providerRaw ? normalizeProviderId(providerRaw) : "";
    const beforeSnap = await db.collection("settings").doc("system").get();
    const beforeRaw = beforeSnap.exists ? (beforeSnap.data() || {}) : {};
    const currentProviderCfg = provider && beforeRaw.providers && typeof beforeRaw.providers === "object"
      ? stripLegacyProviderSettings(beforeRaw.providers[provider] || {})
      : {};
    const mergedBody = provider
      ? { ...currentProviderCfg, ...(req.body || {}), provider }
      : { ...beforeRaw, ...(req.body || {}) };
    const clean = normalizeSystem(req, mergedBody, provider ? currentProviderCfg : beforeRaw);

    if (provider) {
      const basePatch = pickKeys(clean, SYSTEM_GLOBAL_KEYS);
      const providerPatch = pickKeys(clean, SYSTEM_PROVIDER_KEYS);
      await db.runTransaction(async (tx) => {
        const ref = db.collection("settings").doc("system");
        const snap = await tx.get(ref);
        const raw = snap.exists ? (snap.data() || {}) : {};
        const providers = (raw.providers && typeof raw.providers === "object") ? { ...raw.providers } : {};
        const existing = providers[provider] && typeof providers[provider] === "object"
          ? stripLegacyProviderSettings(providers[provider])
          : {};
        providers[provider] = {
          ...existing,
          ...providerPatch,
          provider,
          updated_at: clean.updated_at,
          updated_by: clean.updated_by,
        };
        tx.set(ref, { ...basePatch, providers }, { merge: true });
      });
      invalidateSettingsCache("system");
      try {
        const beforeGlobal = pickKeys(beforeRaw, SYSTEM_GLOBAL_KEYS);
        const beforeProvider = beforeRaw.providers && beforeRaw.providers[provider]
          ? pickKeys(beforeRaw.providers[provider], SYSTEM_PROVIDER_KEYS)
          : {};
        await logSettingsChange({
          db,
          source: "settings/system",
          scope: "global",
          before: beforeGlobal,
          after: basePatch,
          req,
        });
        await logSettingsChange({
          db,
          source: "settings/system.providers",
          provider,
          scope: "provider",
          before: beforeProvider,
          after: providerPatch,
          req,
        });
      } catch (_) {}
      return res.json({ ok: true, stored: "settings/system.providers", provider, data: clean });
    }

    await db.collection("settings").doc("system").set(clean, { merge: true });
    invalidateSettingsCache("system");
    try {
      const allKeys = [...SYSTEM_GLOBAL_KEYS, ...SYSTEM_PROVIDER_KEYS];
      const beforeSubset = pickKeys(beforeRaw, allKeys);
      const afterSubset = pickKeys(clean, allKeys);
      await logSettingsChange({
        db,
        source: "settings/system",
        scope: "global",
        before: beforeSubset,
        after: afterSubset,
        req,
      });
    } catch (_) {}
    return res.json({ ok: true, stored: "settings/system", data: clean });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SET_SYSTEM_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * GET /api/settings/ai
 */
router.get("/api/settings/ai", async (req, res) => {
  try {
    const db = getFirestore();
    const doc = await db.collection("settings").doc("ai").get();
    const raw = doc.exists ? (doc.data() || {}) : {};
    const defaults = {
      language: "ko",
      summary_length: "medium",
      report_emphasis: "EV",
      warnings_enabled: true,
      table_ratio: 60,
    };
    const providerRaw = req.query.provider;
    const provider = providerRaw ? normalizeProviderId(providerRaw) : null;
    const entry = provider ? pickProviderEntry(raw.providers, provider) : null;
    const data = provider
      ? { ...defaults, ...(entry || {}), provider }
      : { ...defaults, ...raw, provider: raw.provider || "BINANCEFUT" };
    return res.json({ ok: true, data, source: "settings/ai" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_AI_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * POST /api/settings/ai
 */
router.post("/api/settings/ai", async (req, res) => {
  try {
    const db = getFirestore();
    const clean = normalizeAi(req, req.body || {});
    const providerRaw = req.query.provider;
    const provider = providerRaw ? normalizeProviderId(providerRaw) : null;
    if (provider) {
      const doc = await db.collection("settings").doc("ai").get();
      const cur = doc.exists ? (doc.data() || {}) : {};
      const providers = cur.providers && typeof cur.providers === "object" ? { ...cur.providers } : {};
      const beforeEntry = providers[provider] || {};
      providers[provider] = clean;
      await db.collection("settings").doc("ai").set({ providers }, { merge: true });
      invalidateSettingsCache("ai");
      try {
        await logSettingsChange({
          db,
          source: "settings/ai.providers",
          provider,
          scope: "provider",
          before: beforeEntry,
          after: clean,
          req,
        });
      } catch (_) {}
      return res.json({ ok: true, stored: "settings/ai.providers", data: { ...clean, provider } });
    }
    const beforeDoc = await db.collection("settings").doc("ai").get();
    const beforeRaw = beforeDoc.exists ? (beforeDoc.data() || {}) : {};
    await db.collection("settings").doc("ai").set(clean, { merge: true });
    invalidateSettingsCache("ai");
    try {
      const beforeSubset = pickKeys(beforeRaw, Object.keys(clean));
      await logSettingsChange({
        db,
        source: "settings/ai",
        scope: "global",
        before: beforeSubset,
        after: clean,
        req,
      });
    } catch (_) {}
    return res.json({ ok: true, stored: "settings/ai", data: clean });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SET_AI_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * GET /api/settings/ai-guard
 */
router.get("/api/settings/ai-guard", async (req, res) => {
  try {
    const db = getFirestore();
    const doc = await db.collection("settings").doc("ai_guard").get();
    const raw = doc.exists ? (doc.data() || {}) : {};
    const key = String(raw.claude_api_key || "");
    const model = String(raw.claude_model || "claude-opus-4-5-20251101").trim();
    const allowMin = clampNumber(raw.ensemble_allow_min, 0, 1);
    const reduceMin = clampNumber(raw.ensemble_reduce_min, 0, 1);
    const data = {
      ...raw,
      claude_model: model || "claude-opus-4-5-20251101",
      ensemble_allow_min: allowMin == null ? 0.6 : allowMin,
      ensemble_reduce_min: reduceMin == null ? 0.45 : reduceMin,
      claude_api_key_set: !!key,
      claude_api_key_hint: key ? `****${key.slice(-4)}` : null,
    };
    delete data.claude_api_key;
    return res.json({ ok: true, data, source: "settings/ai_guard" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_AI_GUARD_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * POST /api/settings/ai-guard
 */
router.post("/api/settings/ai-guard", async (req, res) => {
  try {
    const db = getFirestore();
    const beforeDoc = await db.collection("settings").doc("ai_guard").get();
    const beforeRaw = beforeDoc.exists ? (beforeDoc.data() || {}) : {};
    const clean = normalizeAiGuard(req, req.body || {}, beforeRaw);
    await db.collection("settings").doc("ai_guard").set(clean, { merge: true });
    invalidateSettingsCache("aiGuard");
    try {
      const beforeSubset = pickKeys(beforeRaw, Object.keys(clean));
      await logSettingsChange({
        db,
        source: "settings/ai_guard",
        scope: "global",
        before: beforeSubset,
        after: clean,
        req,
      });
    } catch (_) {}
    const key = String(clean.claude_api_key || "");
    const data = {
      ...clean,
      claude_api_key_set: !!key,
      claude_api_key_hint: key ? `****${key.slice(-4)}` : null,
    };
    delete data.claude_api_key;
    return res.json({ ok: true, stored: "settings/ai_guard", data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SET_AI_GUARD_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * GET /api/settings/ai-allocation
 */
async function fetchLatestAiAllocRun(db, provider) {
  const prov = String(provider || "").toUpperCase();
  if (!prov) return null;
  try {
    const snap = await db.collection("ai_allocation_runs")
      .where("provider", "==", prov)
      .orderBy("created_at", "desc")
      .limit(1)
      .get();
    if (!snap.empty) {
      const d = snap.docs[0].data() || {};
      return {
        created_at: d.created_at || null,
        mode: d.mode || null,
        confidence: (d.mode_confidence === undefined ? null : d.mode_confidence),
        direction: d.direction || null,
        direction_score: (d.direction_score === undefined ? null : d.direction_score),
        direction_confidence: (d.direction_confidence === undefined ? null : d.direction_confidence),
        side_allocation: (d.side_allocation && typeof d.side_allocation === "object") ? d.side_allocation : null,
        reason: d.mode_reason || null,
      };
    }
  } catch (_) {
    // fall through to fallback
  }
  try {
    const snap = await db.collection("ai_allocation_runs")
      .orderBy("created_at", "desc")
      .limit(50)
      .get();
    if (snap.empty) return null;
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const p = String(d.provider || "").toUpperCase();
      if (p !== prov) continue;
      return {
        created_at: d.created_at || null,
        mode: d.mode || null,
        confidence: (d.mode_confidence === undefined ? null : d.mode_confidence),
        direction: d.direction || null,
        direction_score: (d.direction_score === undefined ? null : d.direction_score),
        direction_confidence: (d.direction_confidence === undefined ? null : d.direction_confidence),
        side_allocation: (d.side_allocation && typeof d.side_allocation === "object") ? d.side_allocation : null,
        reason: d.mode_reason || null,
      };
    }
  } catch (_) {
    return null;
  }
  return null;
}

router.get("/api/settings/ai-allocation", async (req, res) => {
  try {
    const db = getFirestore();
    const doc = await db.collection("settings").doc("ai_allocation").get();
    const raw = doc.exists ? (doc.data() || {}) : {};
    const providerRaw = req.query.provider;
    const provider = providerRaw ? normalizeProviderId(providerRaw) : null;
    const entry = provider ? pickProviderEntry(raw.providers, provider) : null;
    const merged = provider ? (entry || {}) : raw;
    const apiKey = String(merged.api_key || "");
    const data = {
      ...AI_ALLOCATION_DEFAULTS,
      ...merged,
      api_key_set: !!apiKey,
      api_key_hint: apiKey ? `****${apiKey.slice(-4)}` : null,
      provider: provider || raw.provider || "BINANCEFUT",
    };
    const lastRun = await fetchLatestAiAllocRun(db, data.provider);
    if (lastRun) data.last_run = lastRun;
    delete data.api_key;
    return res.json({ ok: true, data, source: "settings/ai_allocation" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_AI_ALLOCATION_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * POST /api/settings/ai-allocation
 */
router.post("/api/settings/ai-allocation", async (req, res) => {
  try {
    const db = getFirestore();
    const clean = normalizeAiAllocation(req, req.body || {});
    const payload = { ...clean };
    if (!payload.api_key) delete payload.api_key;
    const providerRaw = req.query.provider;
    const provider = providerRaw ? normalizeProviderId(providerRaw) : null;
    if (provider) {
      const doc = await db.collection("settings").doc("ai_allocation").get();
      const cur = doc.exists ? (doc.data() || {}) : {};
      const providers = cur.providers && typeof cur.providers === "object" ? { ...cur.providers } : {};
      const beforeEntry = providers[provider] || {};
      providers[provider] = payload;
      await db.collection("settings").doc("ai_allocation").set({ providers }, { merge: true });
      invalidateSettingsCache("aiAllocation");
      try {
        await logSettingsChange({
          db,
          source: "settings/ai_allocation.providers",
          provider,
          scope: "provider",
          before: beforeEntry,
          after: payload,
          req,
        });
      } catch (_) {}
      const apiKey = String(clean.api_key || "");
      const data = {
        ...clean,
        api_key_set: !!apiKey,
        api_key_hint: apiKey ? `****${apiKey.slice(-4)}` : null,
        provider,
      };
      delete data.api_key;
      return res.json({ ok: true, stored: "settings/ai_allocation.providers", data });
    }
    const beforeDoc = await db.collection("settings").doc("ai_allocation").get();
    const beforeRaw = beforeDoc.exists ? (beforeDoc.data() || {}) : {};
    await db.collection("settings").doc("ai_allocation").set(payload, { merge: true });
    invalidateSettingsCache("aiAllocation");
    try {
      const beforeSubset = pickKeys(beforeRaw, Object.keys(payload));
      await logSettingsChange({
        db,
        source: "settings/ai_allocation",
        scope: "global",
        before: beforeSubset,
        after: payload,
        req,
      });
    } catch (_) {}
    const apiKey = String(clean.api_key || "");
    const data = {
      ...clean,
      api_key_set: !!apiKey,
      api_key_hint: apiKey ? `****${apiKey.slice(-4)}` : null,
    };
    delete data.api_key;
    return res.json({ ok: true, stored: "settings/ai_allocation", data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SET_AI_ALLOCATION_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * GET /api/settings/exchanges
 */
router.get("/api/settings/exchanges", async (req, res) => {
  try {
    const db = getFirestore();
    const doc = await db.collection("settings").doc("exchanges").get();
    const cur = doc.exists ? (doc.data() || {}) : {};
    const envOverride = getEnvExchangeOverride();
    const forcedProviders = getForcedProvidersFromEnv();
    const envLocked = !!envOverride || forcedProviders.length > 0;
    const providersInDb = cur.exchanges && typeof cur.exchanges === "object"
      ? Object.keys(cur.exchanges).map((p) => normalizeProviderId(p))
      : [];
    const availableProviders = forcedProviders.length
      ? forcedProviders
      : (providersInDb.length ? providersInDb : [normalizeProviderId(cur.provider || "BINANCEFUT")]);
    const requestedRaw = req.query.provider || cur.provider || availableProviders[0] || "BINANCEFUT";
    const requestedNorm = normalizeProviderId(requestedRaw, availableProviders[0] || "BINANCEFUT");
    const providerReq = forcedProviders.length && !forcedProviders.includes(requestedNorm)
      ? (forcedProviders[0] || requestedNorm)
      : requestedNorm;
    const effective = await getExchangeSettingsForProvider(providerReq, 2000);
    let activeProvider = normalizeProviderId(cur.provider || providerReq);
    if (forcedProviders.length && !forcedProviders.includes(activeProvider)) {
      activeProvider = forcedProviders[0];
    }
    const entry = pickProviderEntry(cur.exchanges, providerReq);
    const useLegacy = !entry && providerReq === activeProvider;
    const provider = normalizeProviderId((effective && effective.provider) || (envOverride && envOverride.provider) || providerReq);
    const normalizedMarkets = normalizeMarketsList((entry && entry.markets) || cur.markets, provider);
    const markets = ensureBinanceCoreMarkets(
      Array.isArray(effective && effective.markets) && effective.markets.length
        ? effective.markets
        : ((normalizedMarkets.length ? normalizedMarkets : defaultMarketsFromEnv(provider))),
      provider
    );
    const tfAllow = Array.isArray(effective && effective.tf_allowlist) && effective.tf_allowlist.length
      ? effective.tf_allowlist
      : defaultTfAllowlistFromEnv();
    const execTf = normalizeTf((effective && effective.exec_tf) || (envOverride && envOverride.exec_tf) || (entry && entry.exec_tf) || cur.exec_tf || defaultExecTfFromEnv());
    const enabled = typeof (effective && effective.enabled) === "boolean"
      ? effective.enabled
      : ((envOverride && typeof envOverride.enabled === "boolean")
        ? envOverride.enabled
        : (entry && typeof entry.enabled === "boolean" ? entry.enabled : (typeof cur.enabled === "boolean" ? cur.enabled : true)));
    const apiKey = String((effective && effective.api_key) || (entry && entry.api_key) || (useLegacy ? (cur.api_key || "") : ""));
    const apiSecret = String((effective && effective.api_secret) || (entry && entry.api_secret) || (useLegacy ? (cur.api_secret || "") : ""));
    const data = {
      provider,
      active_provider: activeProvider,
      available_providers: availableProviders,
      enabled,
      markets,
      tf_allowlist: tfAllow,
      exec_tf: execTf,
      api_key_set: !!apiKey,
      api_secret_set: !!apiSecret,
      api_key_hint: apiKey ? `****${apiKey.slice(-4)}` : null,
      api_secret_hint: apiSecret ? `****${apiSecret.slice(-4)}` : null,
      updated_at: (effective && effective.updated_at) || (entry && entry.updated_at) || (useLegacy ? (cur.updated_at || null) : null),
      updated_by: (effective && effective.updated_by) || (entry && entry.updated_by) || (useLegacy ? (cur.updated_by || null) : null),
      locked_by_env: typeof (effective && effective.locked_by_env) === "boolean" ? effective.locked_by_env : envLocked,
      multi_enabled: availableProviders.length > 1,
    };
    return res.json({ ok: true, data, source: "settings/exchanges" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "GET_EXCHANGE_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * POST /api/settings/exchanges
 */
router.post("/api/settings/exchanges", async (req, res) => {
  try {
    const envOverride = getEnvExchangeOverride();
    const forcedProviders = getForcedProvidersFromEnv();
    if (envOverride || forcedProviders.length) {
      return res.status(409).json({
        ok: false,
        error: "EXCHANGE_SETTINGS_LOCKED",
        message: "exchange settings locked by env",
        locked_by_env: true,
      });
    }
    const db = getFirestore();
    const doc = await db.collection("settings").doc("exchanges").get();
    const cur = doc.exists ? (doc.data() || {}) : {};
    const setActiveOnly = normalizeBool(req.body && req.body.set_active_only);
    if (setActiveOnly) {
      const provider = normalizeProviderId(req.body && req.body.provider, cur.provider || "BINANCEFUT");
      const beforeProvider = normalizeProviderId(cur.provider || "") || null;
      const legacyMap = (cur.exchanges && typeof cur.exchanges === "object") ? { ...cur.exchanges } : {};
      if (!legacyMap[provider]) {
        legacyMap[provider] = {
          provider,
          enabled: true,
          markets: defaultMarketsFromEnv(provider),
          tf_allowlist: defaultTfAllowlistFromEnv(),
          exec_tf: defaultExecTfFromEnv(),
          api_key: null,
          api_secret: null,
          updated_at: cur.updated_at || null,
          updated_by: cur.updated_by || null,
        };
      }
      const next = {
        provider,
        updated_at: new Date().toISOString(),
        updated_by: (reqUser(req) || "api").slice(0, 120),
        exchanges: legacyMap,
      };
      await db.collection("settings").doc("exchanges").set(next, { merge: true });
      invalidateSettingsCache("exchanges");
      try {
        await logSettingsChange({
          db,
          source: "settings/exchanges",
          scope: "global",
          before: { provider: beforeProvider },
          after: { provider },
          req,
        });
      } catch (_) {}
      return res.json({ ok: true, stored: "settings/exchanges", data: { provider } });
    }

    const providerReq = normalizeProviderId(req.body && req.body.provider, cur.provider || "BINANCEFUT");
    const entryCur = pickProviderEntry(cur.exchanges, providerReq) || cur;
    const clean = normalizeExchanges(req, req.body || {}, entryCur);
    const legacyMap = (cur.exchanges && typeof cur.exchanges === "object") ? { ...cur.exchanges } : {};
    const legacyProvider = normalizeProviderId(cur.provider || "");
    if (!Object.keys(legacyMap).length && legacyProvider) {
      legacyMap[legacyProvider] = {
        provider: legacyProvider,
        enabled: typeof cur.enabled === "boolean" ? cur.enabled : true,
        markets: Array.isArray(cur.markets) ? cur.markets : [],
        tf_allowlist: Array.isArray(cur.tf_allowlist) ? cur.tf_allowlist : [],
        exec_tf: normalizeTf(cur.exec_tf) || defaultExecTfFromEnv(),
        api_key: cur.api_key || null,
        api_secret: cur.api_secret || null,
        updated_at: cur.updated_at || null,
        updated_by: cur.updated_by || null,
      };
    }

    const next = {
      ...cur,
      provider: clean.provider,
      enabled: clean.enabled,
      markets: clean.markets,
      tf_allowlist: clean.tf_allowlist,
      exec_tf: clean.exec_tf,
      api_key: clean.api_key,
      api_secret: clean.api_secret,
      updated_at: clean.updated_at,
      updated_by: clean.updated_by,
      exchanges: {
        ...legacyMap,
        [clean.provider]: {
          provider: clean.provider,
          enabled: clean.enabled,
          markets: clean.markets,
          tf_allowlist: clean.tf_allowlist,
          exec_tf: clean.exec_tf,
          api_key: clean.api_key,
          api_secret: clean.api_secret,
          updated_at: clean.updated_at,
          updated_by: clean.updated_by,
        },
      },
    };
    await db.collection("settings").doc("exchanges").set(next, { merge: true });
    invalidateSettingsCache("exchanges");
    try {
      const beforeEntry = pickProviderEntry(cur.exchanges, clean.provider) || {};
      await logSettingsChange({
        db,
        source: "settings/exchanges.providers",
        provider: clean.provider,
        scope: "provider",
        before: {
          enabled: beforeEntry.enabled,
          markets: beforeEntry.markets,
          tf_allowlist: beforeEntry.tf_allowlist,
          exec_tf: beforeEntry.exec_tf,
          api_key: beforeEntry.api_key,
          api_secret: beforeEntry.api_secret,
        },
        after: {
          enabled: clean.enabled,
          markets: clean.markets,
          tf_allowlist: clean.tf_allowlist,
          exec_tf: clean.exec_tf,
          api_key: clean.api_key,
          api_secret: clean.api_secret,
        },
        req,
      });
      await logSettingsChange({
        db,
        source: "settings/exchanges",
        scope: "global",
        before: { provider: normalizeProviderId(cur.provider || "") || null },
        after: { provider: clean.provider },
        req,
      });
    } catch (_) {}
    return res.json({ ok: true, stored: "settings/exchanges", data: {
      provider: clean.provider,
      enabled: clean.enabled,
      markets: clean.markets,
      tf_allowlist: clean.tf_allowlist,
      exec_tf: clean.exec_tf,
      api_key_set: !!clean.api_key,
      api_secret_set: !!clean.api_secret,
      updated_at: clean.updated_at,
      updated_by: clean.updated_by,
    } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SET_EXCHANGE_SETTINGS_ERROR", message: e.message });
  }
});

/**
 * GET /api/settings/exchanges/test
 */
router.get("/api/settings/exchanges/test", async (req, res) => {
  try {
    const rawProvider = String(req.query.provider || "BINANCEFUT").trim().toUpperCase();
    const provider = rawProvider.includes("BINANCE") ? "BINANCEFUT" : "BINANCEFUT";
    const rawMarkets = listFromRaw(req.query.markets);
    let markets = rawMarkets.map((m) => normalizeMarketSymbolForProvider(m, provider)).filter(Boolean);
    if (!markets.length) {
      const ex = await getExchangeSettingsForProvider(provider, 2000);
      markets = normalizeMarketsList((ex && ex.markets) ? ex.markets : [], provider);
    }
    if (!markets.length) {
      return res.status(400).json({ ok: false, error: "NO_MARKETS" });
    }

    const url = "https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(markets));
    const start = Date.now();
    const r = await fetch(url, { method: "GET" });
    const text = await r.text();
    const latencyMs = Date.now() - start;

    if (!r.ok) {
      return res.status(502).json({ ok: false, error: "EXCHANGE_TICKER_FAILED", status: r.status, latency_ms: latencyMs, body: text.slice(0, 500) });
    }

    const rows = JSON.parse(text);
    return res.json({
      ok: true,
      provider,
      markets,
      count: Array.isArray(rows) ? rows.length : 0,
      latency_ms: latencyMs,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "EXCHANGE_TEST_ERROR", message: String(e && e.message ? e.message : e) });
  }
});

/**
 * GET /api/settings/exchanges/live-check
 * - 선택 거래소 실거래 키 확인(잔고 노출 없이 계정 호출만 확인)
 */
router.get("/api/settings/exchanges/live-check", async (req, res) => {
  try {
    const ex = await getExchangesSettingsCached(3000);
    const data = ex && ex.data ? ex.data : {};
    const provider = normalizeProviderId(req.query.provider || data.provider || "BINANCEFUT");
    const activeProvider = normalizeProviderId(data.provider || provider);
    const entry = pickProviderEntry(data.exchanges, provider) || null;
    const useLegacy = !entry && provider === activeProvider;
    if (!entry && !useLegacy) {
      return res.status(400).json({ ok: false, error: "EXCHANGE_SETTINGS_EMPTY", message: "provider not configured" });
    }

    const apiKey = String(process.env.BINANCEFUT_API_KEY || (entry && entry.api_key) || "");
    const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (entry && entry.api_secret) || "");
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ ok: false, error: "BINANCEFUT_KEYS_MISSING" });
    }
    const account = await fetchBinanceFuturesAccount({ apiKey, apiSecret });
    let posMode = null;
    try {
      posMode = await fetchFuturesPositionMode({ apiKey, apiSecret });
    } catch (_) {
      posMode = null;
    }
    const assets = Array.isArray(account && account.assets) ? account.assets : [];
    const hedgeOn = !!(posMode && posMode.dualSidePosition === true);
    return res.json({
      ok: true,
      provider,
      can_trade: account && account.canTrade === true,
      asset_count: assets.length,
      assets: assets.map((a) => a.asset).filter(Boolean).slice(0, 20),
      hedge_mode: hedgeOn,
      warnings: hedgeOn ? ["HEDGE_MODE_ON"] : [],
    });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    try {
      console.error("[EXCHANGE_LIVE_CHECK_FAILED]", {
        message: msg,
        provider: req.query && req.query.provider,
      });
    } catch (_) {}
    return res.status(500).json({ ok: false, error: "EXCHANGE_LIVE_CHECK_FAILED", message: msg });
  }
});

module.exports = router;
