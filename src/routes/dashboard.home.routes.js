const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { getSystemSettingsForProvider, getAiAllocationSettingsForProvider } = require("../storage/settings");
const { queryBars } = require("../storage/barsSnapshots");
const { getRiskBudgetForProvider, getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { resolveExchangeFromReq, resolveRuntimeMarketsForExchange, resolveRuntimeTfContext } = require("../utils/resolveExchange");
const { computeUnrealized } = require("../utils/overall");
const { tfToMs, normalizeTf, normalizeMarketSymbolForProvider, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { SIGNAL_ENGINE_RULES, tpP1ForExchange, getExitRulesForExchange, resolveExitRulesForPosition } = require("../engine/signalEngine");
const { getPnlScopeDays, getScopeFromMs } = require("../services/pnlPolicy");
const { resolveRealizedRowsByMarket } = require("../services/realizedPnlResolver");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { checkCharterConsistency } = require("../services/charterCheck");
const { resolveEventMapping } = require("../services/signalMapping");
const { toKstString, kstDateKey } = require("../utils/timeKst");
const { normalizeProviderId } = require("../utils/providerUtils");
const { buildKpiLatestByMarket } = require("../utils/kpiLatestView");
const { buildExitStageView } = require("../utils/exitStageView");
const { buildSignalDisplayReason } = require("../utils/signalReasonView");
const { buildFillDisplayReason } = require("../utils/fillReasonView");
const { isPendingIntentExpired, resolveIntentStatusForView, isActivePendingIntent } = require("../utils/intentView");
const { buildRouteErrorRef, sanitizeRouteError, logRouteError } = require("../utils/routeErrors");
const {
  buildAiReasonKo,
  splitAiReasonUnits,
  translateAiReasonUnitKo,
} = require("../utils/aiReasonKo");
const {
  resolvePositionLeverage,
  resolvePositionLeverageReason,
  resolveFillLeverage,
  resolveFillLeverageReason,
  resolveLeverageTier,
  buildLeverageSummary,
  resolvePositionRollback,
  buildRollbackSummary,
} = require("../utils/leverageView");
const {
  resolvePositionBudgetUsedKrw,
  resolveFillBudgetUsedKrw,
} = require("../utils/budgetUsageView");
const { summarizeFebtRows, summarizeFebtPhase0Artifact } = require("../utils/febtSummary");
const { buildMissionControlViewModel } = require("../utils/controlPlaneViewModels");

const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");
const FEBT_PHASE0_LATEST_PATH = path.join(OPS_DAILY_DIR, "febt_phase0_baseline_latest.json");

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function maxCreatedAt(arr) {
  let max = null;
  for (const x of (arr || [])) {
    const ms = Date.parse(String(x.created_at || ""));
    if (!Number.isFinite(ms)) continue;
    if (max === null || ms > max) max = ms;
  }
  return max ? toKstString(new Date(max).toISOString()) : null;
}

function toMsSafe(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

function computeMappingOk(entry) {
  if (!entry || !entry.event) return null;
  const mapping = resolveEventMapping({ event: entry.event, side: entry.side });
  return mapping.ok === true;
}

function normalizeStatus(v) {
  const s = String(v || "").toUpperCase();
  return s || null;
}

function summarizeExitRuleValue(ruleList, field, fallback) {
  const nums = (ruleList || [])
    .map((rules) => Number(rules && rules[field]))
    .filter((v) => Number.isFinite(v));
  if (!nums.length) {
    return {
      value: Number.isFinite(Number(fallback)) ? Number(fallback) : null,
      min: Number.isFinite(Number(fallback)) ? Number(fallback) : null,
      max: Number.isFinite(Number(fallback)) ? Number(fallback) : null,
      mixed: false,
    };
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const mixed = Math.abs(max - min) > 1e-9;
  return {
    value: mixed ? null : nums[0],
    min,
    max,
    mixed,
  };
}

function buildIntentStatusLookup({ intents = [], exchange, tfDefault } = {}) {
  const exNorm = normalizeProviderId(exchange || "");
  const normalizeMarket = (raw) => normalizeMarketSymbolForProvider(raw, exNorm);
  const keyOf = ({ market, tf, barMs, event }) => {
    const mk = normalizeMarket(market || "");
    const ms = Number(barMs);
    const ev = String(event || "").toUpperCase();
    const tfNorm = String(tf || tfDefault || defaultExecTfFromEnv() || "15m");
    if (!mk || !Number.isFinite(ms) || !ev) return null;
    return `${mk}__${tfNorm}__${ms}__${ev}`;
  };
  const statusWeight = (status) => {
    const s = normalizeStatus(resolveIntentStatusForView(status, Date.now()) || (status && status.status));
    if (s === "PENDING") return 3;
    if (s === "FILLED") return 2;
    if (s === "CANCELED") return 1;
    return 0;
  };

  const map = new Map();
  for (const it of intents || []) {
    const key = keyOf({
      market: it.symbol_or_pair_id || it.symbol || it.market,
      tf: it.tf,
      barMs: it.signal_bar_close_time_utc_ms,
      event: it.event,
    });
    if (!key) continue;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, it);
      continue;
    }
    const wCur = statusWeight(cur);
    const wNew = statusWeight(it);
    if (wNew > wCur) {
      map.set(key, it);
      continue;
    }
    if (wNew === wCur) {
      const curMs = toMsSafe(cur.updated_at || cur.created_at || cur.signal_bar_close_time_utc_ms) || 0;
      const newMs = toMsSafe(it.updated_at || it.created_at || it.signal_bar_close_time_utc_ms) || 0;
      if (newMs >= curMs) map.set(key, it);
    }
  }

  return {
    resolveForSignal(signal) {
      if (!signal) return null;
      const key = keyOf({
        market: signal.symbol_or_pair_id || signal.symbol || signal.market,
        tf: signal.tf,
        barMs: signal.bar_close_time_utc_ms,
        event: signal.event,
      });
      if (!key) return null;
      return map.get(key) || null;
    },
  };
}

function normalizeRunHoursForUi(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    const n = Number(x);
    if (!Number.isFinite(n)) continue;
    const h = Math.trunc(n);
    if (h < 0 || h > 23) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  out.sort((a, b) => a - b);
  return out;
}

function deriveAiBudget(aiRunLatest, exchange, marketsExpected) {
  if (!aiRunLatest) return null;
  const byMarket = (aiRunLatest.next_by_market && typeof aiRunLatest.next_by_market === "object")
    ? aiRunLatest.next_by_market
    : (aiRunLatest.current_by_market && typeof aiRunLatest.current_by_market === "object")
      ? aiRunLatest.current_by_market
      : null;
  if (!byMarket) return null;
  const totalRaw = Number(aiRunLatest.target_total_krw ?? aiRunLatest.base_total_krw ?? 0);
  const totalMax = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null;
  const count = Array.isArray(marketsExpected) && marketsExpected.length
    ? marketsExpected.length
    : Object.keys(byMarket || {}).length;
  const defaultMax = (totalMax && count > 0) ? (totalMax / count) : null;
  return {
    enabled: true,
    total_max_krw: totalMax,
    default_max_krw: defaultMax,
    by_market: byMarket,
    unit: String(exchange || "").includes("BINANCE") ? "USDT" : "KRW",
    source: "ai_allocation",
    virtual: true,
    updated_at: aiRunLatest.created_at || null,
  };
}

function normalizeAiBiasDirection(direction, modeFallback) {
  const raw = String(direction || "").trim().toLowerCase();
  if (raw === "long" || raw === "bull" || raw === "up") return "long";
  if (raw === "short" || raw === "bear" || raw === "down") return "short";
  if (raw === "neutral") return "neutral";
  const mode = String(modeFallback || "").trim().toLowerCase();
  if (mode === "aggressive") return "long";
  if (mode === "conservative") return "short";
  return "neutral";
}

function sortMarketWeights(mapObj) {
  const src = (mapObj && typeof mapObj === "object") ? mapObj : {};
  return Object.entries(src)
    .map(([market, value]) => ({ market: String(market || "").toUpperCase(), value: Number(value) }))
    .filter((x) => x.market && Number.isFinite(x.value))
    .sort((a, b) => b.value - a.value);
}

function buildAiDecisionGroups(runLike) {
  const nextByMarket = (runLike && runLike.next_by_market && typeof runLike.next_by_market === "object")
    ? runLike.next_by_market
    : null;
  const currentByMarket = (runLike && runLike.current_by_market && typeof runLike.current_by_market === "object")
    ? runLike.current_by_market
    : {};
  const baseByMarket = nextByMarket || currentByMarket;
  if (!baseByMarket || typeof baseByMarket !== "object") return null;

  const topRows = sortMarketWeights(baseByMarket);
  const allMarkets = topRows.map((x) => x.market);
  const deltaRows = allMarkets
    .map((market) => {
      const next = Number((nextByMarket || baseByMarket)[market] || 0);
      const cur = Number(currentByMarket[market] || 0);
      return { market, next, cur, delta: next - cur };
    })
    .filter((x) => Number.isFinite(x.delta));

  const incRows = deltaRows.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta);
  const decRows = deltaRows.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta);

  const top = topRows.slice(0, 5).map((x) => x.market);
  const inc = incRows.slice(0, 5).map((x) => x.market);
  const dec = decRows.slice(0, 5).map((x) => x.market);

  const groups = {
    large_sector: top,
    growth: inc,
    momentum: dec,
  };
  const labels = {
    large_sector: "AI 핵심 비중(상위)",
    growth: "AI 비중 확대",
    momentum: "AI 비중 축소/관찰",
  };
  const summaries = {
    large_sector: top.length ? `현재 AI 비중이 높은 종목입니다: ${top.join(", ")}` : "현재 AI 핵심 비중 종목이 없습니다.",
    growth: inc.length ? `최근 AI가 비중을 늘린 종목입니다: ${inc.join(", ")}` : "최근 비중 확대 종목이 없습니다.",
    momentum: dec.length ? `최근 AI가 비중을 줄인 종목입니다: ${dec.join(", ")}` : "최근 비중 축소 종목이 없습니다.",
  };

  const dir = normalizeAiBiasDirection(runLike && runLike.direction, runLike && runLike.mode);
  const dirKo = dir === "long" ? "롱우위" : dir === "short" ? "숏우위" : "중립";
  const score = Number(runLike && runLike.direction_score);
  const scoreTxt = Number.isFinite(score) ? ` (방향 점수 ${score.toFixed(2)})` : "";
  const summaryKo = `AI 판단은 ${dirKo}${scoreTxt}이며, 핵심/확대/축소 3분류로 종목을 표시합니다.`;

  return {
    groups,
    labels,
    summaries,
    summary_ko: summaryKo,
  };
}

async function getLatestAiRun(db, provider) {
  const prov = String(provider || "").toUpperCase();
  let snap = null;
  let fallbackSnap = null;
  if (prov) {
    try {
      snap = await db.collection("ai_allocation_runs")
        .where("provider", "==", prov)
        .orderBy("created_at", "desc")
        .limit(1)
        .get();
    } catch (_) {
      snap = null;
    }
  }
  if ((!snap || snap.empty) && prov) {
    try {
      // Fallback without composite index: filter in memory.
      fallbackSnap = await db.collection("ai_allocation_runs")
        .orderBy("created_at", "desc")
        .limit(50)
        .get();
    } catch (_) {
      fallbackSnap = null;
    }
  }
  if ((!snap || snap.empty) && (!fallbackSnap || fallbackSnap.empty)) return null;
  let picked = null;
  if (prov) {
    const docs = (snap && snap.docs && snap.docs.length)
      ? snap.docs
      : (fallbackSnap && fallbackSnap.docs ? fallbackSnap.docs : []);
    for (const doc of docs) {
      const data = doc.data() || {};
      const p = String(data.provider || "").toUpperCase();
      if (p === prov) { picked = data; break; }
    }
    if (!picked) return null;
  } else {
    picked = snap.docs[0].data() || {};
  }
  const d = picked;
  const sideAllocation = (d.side_allocation && typeof d.side_allocation === "object") ? d.side_allocation : null;
  const directionRaw = (sideAllocation && sideAllocation.bias_direction) || d.direction || d.bias_direction || null;
  const direction = normalizeAiBiasDirection(directionRaw, d.mode);
  const reasonKo = buildAiReasonKo(d.mode_reason || null);
  const decision = buildAiDecisionGroups({
    direction,
    mode: d.mode || null,
    direction_score: (d.direction_score === undefined ? ((sideAllocation && sideAllocation.bias_score) ?? null) : d.direction_score),
    next_by_market: (d.next_by_market && typeof d.next_by_market === "object") ? d.next_by_market : null,
    current_by_market: (d.current_by_market && typeof d.current_by_market === "object") ? d.current_by_market : null,
  });
  return {
    created_at: d.created_at || null,
    mode: d.mode || null,
    confidence: (d.mode_confidence === undefined ? null : d.mode_confidence),
    bias_direction: (sideAllocation && sideAllocation.bias_direction) || null,
    direction,
    direction_score: (d.direction_score === undefined ? ((sideAllocation && sideAllocation.bias_score) ?? null) : d.direction_score),
    direction_confidence: (d.direction_confidence === undefined ? null : d.direction_confidence),
    side_allocation: sideAllocation,
    reason: d.mode_reason || null,
    reason_en: reasonKo.source_en,
    reason_ko_summary: reasonKo.summary_ko,
    reason_ko_details: reasonKo.details_ko,
    reason_ko_translation: reasonKo.translation_ko,
    news_ok: d.news_ok === true,
    news_count: d.news_count ?? null,
    news_provider: d.news_provider || null,
    news_reason: d.news_reason || null,
    news_cached: d.news_cached === true,
    gpt_ok: d.gpt_ok === true,
    gpt_attempted: d.gpt_attempted === true,
    claude_ok: d.claude_ok === true,
    claude_attempted: d.claude_attempted === true,
    claude_model: d.claude_model || null,
    claude_reason: d.claude_reason || null,
    ensemble_enabled: d.ensemble_enabled === true,
    ensemble_used: d.ensemble_used === true,
    ensemble_w_gpt: d.ensemble_w_gpt ?? null,
    ensemble_w_claude: d.ensemble_w_claude ?? null,
    router_ok: d.router_ok === true,
    router_confidence: d.router_confidence ?? null,
    router_model: d.router_model || null,
    final_model: d.final_model || null,
    applied: d.applied === true,
    apply_reason: d.apply_reason || null,
    base_total_krw: d.base_total_krw ?? null,
    target_total_krw: d.target_total_krw ?? null,
    current_by_market: (d.current_by_market && typeof d.current_by_market === "object") ? d.current_by_market : null,
    next_by_market: (d.next_by_market && typeof d.next_by_market === "object") ? d.next_by_market : null,
    recommended_groups: decision && decision.groups
      ? decision.groups
      : ((d.recommended_groups && typeof d.recommended_groups === "object") ? d.recommended_groups : null),
    recommended_group_labels: decision && decision.labels
      ? decision.labels
      : ((d.recommended_group_labels && typeof d.recommended_group_labels === "object") ? d.recommended_group_labels : null),
    recommended_group_summaries_ko: decision && decision.summaries ? decision.summaries : null,
    decision_summary_ko: decision && decision.summary_ko ? decision.summary_ko : null,
    provider: d.provider || null,
  };
}

async function getLatestGateForExchange(db, provider) {
  const prov = String(provider || "").toUpperCase();
  let snap = null;
  let fallbackSnap = null;
  if (prov) {
    try {
      snap = await db.collection("gate_events")
        .where("exchange", "==", prov)
        .orderBy("created_at", "desc")
        .limit(1)
        .get();
    } catch (_) {
      snap = null;
    }
  }
  if ((!snap || snap.empty) && prov) {
    try {
      fallbackSnap = await db.collection("gate_events")
        .orderBy("created_at", "desc")
        .limit(50)
        .get();
    } catch (_) {
      fallbackSnap = null;
    }
  }
  if ((!snap || snap.empty) && (!fallbackSnap || fallbackSnap.empty)) return null;
  let picked = null;
  if (prov) {
    const docs = (snap && snap.docs && snap.docs.length)
      ? snap.docs
      : (fallbackSnap && fallbackSnap.docs ? fallbackSnap.docs : []);
    for (const doc of docs) {
      const data = doc.data() || {};
      const p = String(data.exchange || "").toUpperCase();
      if (p === prov) { picked = data; break; }
    }
    if (!picked) return null;
  } else {
    picked = snap.docs[0].data() || {};
  }
  return picked;
}

function computeWeeklyRangeUtcISO(nowMs = Date.now()) {
  // Rolling 7d window (now-7d ~ now)
  const end = new Date(nowMs);
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

function clampLimit(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.trunc(n);
}

const HOME_CACHE_MS = Number(process.env.DASHBOARD_CACHE_MS || 60000);
const homeCache = { key: "", at: 0, data: null };

function getHomeCache(key) {
  const now = Date.now();
  if (homeCache.data && homeCache.key === key && now - homeCache.at < HOME_CACHE_MS) {
    return homeCache.data;
  }
  return null;
}

function setHomeCache(key, data) {
  homeCache.key = key;
  homeCache.at = Date.now();
  homeCache.data = data;
}

async function resolveMarketsExpected(exchange) {
  const markets = await resolveRuntimeMarketsForExchange(exchange, 2000);
  return markets && markets.length ? markets : [];
}

function buildFillGroupKey(fill) {
  const ex = String(fill.exchange || "").toUpperCase();
  const sym = String(fill.symbol || fill.symbol_or_pair_id || fill.market || "");
  const liveOrderId = fill.live_order_id || fill.order_id || null;
  if (liveOrderId) return `${ex}__${sym}__ORDER__${liveOrderId}`;
  const externalTradeId = fill.external_trade_id || null;
  if (externalTradeId) return `${ex}__${sym}__TRADE__${externalTradeId}`;
  const fillId = fill.fill_id || fill.id || null;
  if (fillId) return `${ex}__${sym}__FILL__${fillId}`;
  const createdAt = fill.created_at || fill.exec_bar_close_time_utc || "UNKNOWN";
  return `${ex}__${sym}__TS__${createdAt}`;
}

function aggregateFillsForUi(fills, limit) {
  const groups = new Map();
  const order = [];
  for (const f of (fills || [])) {
    const key = buildFillGroupKey(f);
    let agg = groups.get(key);
    if (!agg) {
      agg = { ...f };
      agg._agg_weight_sum = 0;
      agg._agg_weighted_price_sum = 0;
      agg._agg_notional_krw_sum = 0;
      agg._agg_exec_qty_base_sum = 0;
      agg._agg_fill_count = 0;
      groups.set(key, agg);
      order.push(key);
    }

    const execPrice = Number(f.exec_price);
    const qtyBase = Number(f.exec_qty_base);
    const notionalKrw = Number(f.notional_krw);
    let weight = null;
    if (Number.isFinite(qtyBase) && qtyBase > 0) {
      weight = qtyBase;
    } else if (Number.isFinite(notionalKrw) && notionalKrw > 0 && Number.isFinite(execPrice) && execPrice > 0) {
      weight = notionalKrw / execPrice;
    }

    agg._agg_fill_count += 1;
    if (Number.isFinite(notionalKrw)) agg._agg_notional_krw_sum += notionalKrw;
    if (Number.isFinite(qtyBase)) agg._agg_exec_qty_base_sum += qtyBase;
    if (Number.isFinite(execPrice) && weight && weight > 0) {
      agg._agg_weight_sum += weight;
      agg._agg_weighted_price_sum += execPrice * weight;
    }

    const execMs = Number(f.exec_bar_close_time_utc_ms);
    const curExecMs = Number(agg.exec_bar_close_time_utc_ms);
    if (Number.isFinite(execMs) && (!Number.isFinite(curExecMs) || execMs > curExecMs)) {
      agg.exec_bar_close_time_utc_ms = execMs;
    }

    const curCreated = Date.parse(String(agg.created_at || ""));
    const candidate = Date.parse(String(f.created_at || ""));
    if (Number.isFinite(candidate) && (!Number.isFinite(curCreated) || candidate > curCreated)) {
      agg.created_at = f.created_at;
    }

    if (agg.exec_price_source == null && f.exec_price_source != null) agg.exec_price_source = f.exec_price_source;
    if (agg.leverage_applied == null && f.leverage_applied != null) agg.leverage_applied = f.leverage_applied;
    if (agg.applied_leverage == null && f.applied_leverage != null) agg.applied_leverage = f.applied_leverage;
    if (agg.leverage_reason == null && f.leverage_reason != null) agg.leverage_reason = f.leverage_reason;
    if (agg.signal_price == null && f.signal_price != null) agg.signal_price = f.signal_price;
    if (agg.signal_price_diff == null && f.signal_price_diff != null) agg.signal_price_diff = f.signal_price_diff;
    if (agg.signal_price_diff_pct == null && f.signal_price_diff_pct != null) agg.signal_price_diff_pct = f.signal_price_diff_pct;
    if (agg.tf == null && f.tf != null) agg.tf = f.tf;
    if (agg.event == null && f.event != null) agg.event = f.event;
    if (agg.side == null && f.side != null) agg.side = f.side;
  }

  const out = [];
  for (const key of order) {
    const agg = groups.get(key);
    if (!agg) continue;

    if (agg._agg_weight_sum > 0) {
      agg.exec_price = agg._agg_weighted_price_sum / agg._agg_weight_sum;
    }
    if (agg._agg_notional_krw_sum > 0) {
      agg.notional_krw = agg._agg_notional_krw_sum;
    }
    if (agg._agg_exec_qty_base_sum > 0) {
      agg.exec_qty_base = agg._agg_exec_qty_base_sum;
    }

    const sigPx = Number(agg.signal_price);
    const execPx = Number(agg.exec_price);
    if (Number.isFinite(sigPx) && sigPx !== 0 && Number.isFinite(execPx)) {
      const diff = execPx - sigPx;
      agg.signal_price_diff = diff;
      agg.signal_price_diff_pct = diff / sigPx;
    }

    delete agg._agg_weight_sum;
    delete agg._agg_weighted_price_sum;
    delete agg._agg_notional_krw_sum;
    delete agg._agg_exec_qty_base_sum;
    delete agg._agg_fill_count;

    out.push(agg);
    if (limit && out.length >= limit) break;
  }
  return out;
}

router.get("/dashboard/mission", async (req, res) => {
  const idx = String(req.originalUrl || "").indexOf("?");
  const qs = idx >= 0 ? String(req.originalUrl || "").slice(idx) : "";
  return res.redirect(`/dashboard/home${qs}`);
});

router.get("/dashboard/home", async (req, res) => {
  try {
    const allowLocal = String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
    if (!allowLocal) {
      if (!req.isAuthenticated || !req.isAuthenticated()) return res.redirect("/login");
    }

    const db = getFirestore();
    const { exchange, exCfg } = await resolveExchangeFromReq(req, 2000);
    const { signalTf, execTf } = await resolveRuntimeTfContext(req, exchange, {
      fallback: (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m",
      ttlMs: 2000,
    });
    const markets_expected = await resolveMarketsExpected(exchange);
    const systemSettings = (await getSystemSettingsForProvider(exchange, 5000)).data || {};
    const isBinanceExchange = String(exchange || "").toUpperCase().includes("BINANCE");
    const defaultFuturesLeverage = (() => {
      const lev = Number(systemSettings.futures_leverage);
      if (Number.isFinite(lev) && lev > 0) return lev;
      return isBinanceExchange ? 2 : 1;
    })();
    const exchangeSettings = await getExchangeSettingsForProvider(exchange, 2000);

    const weeklyDefault = computeWeeklyRangeUtcISO(Date.now());
    const weekly = {
      from: String(req.query.from || weeklyDefault.from),
      to: String(req.query.to || weeklyDefault.to),
    };
    const packUrl = `/api/report/improvement-pack?level=STANDARD&exchange=${encodeURIComponent(exchange)}&tf=${encodeURIComponent(signalTf)}&from=${encodeURIComponent(weekly.from)}&to=${encodeURIComponent(weekly.to)}`;
    const cacheKey = `${exchange}__${signalTf}__${execTf}__${weekly.from}__${weekly.to}`;
    const cached = getHomeCache(cacheKey);
    if (cached) {
      const cachedPayload = { ...cached, mission_control: buildMissionControlViewModel() };
      setHomeCache(cacheKey, cachedPayload);
      return res.render("home", cachedPayload);
    }

    const [sigSnap, dropSnap, fillSnap, intentSnap] = await Promise.all([
      db.collection("signals").orderBy("created_at", "desc").limit(200).get(),
      db.collection("signals_dropped").orderBy("created_at", "desc").limit(200).get(),
      db.collection("fills_paper").orderBy("created_at", "desc").limit(200).get(),
      db.collection("order_intents_paper").orderBy("created_at", "desc").limit(200).get(),
    ]);

    const signalsRaw = [];
    sigSnap.forEach((d) => {
      const x = d.data() || {};
      const ex = String(x.exchange || "").toUpperCase();
      const mkRaw = String(x.symbol_or_pair_id || x.symbol || x.market || "");
      const exResolved = normalizeProviderId(ex || inferExchangeFromMarket(mkRaw));
      if (!exResolved || exResolved !== exchange) return;
      const mkNorm = normalizeMarketSymbolForProvider(mkRaw, exResolved) || mkRaw;
      signalsRaw.push({ id: d.id, _market_norm: mkNorm, ...x });
    });

    const dropsRaw = [];
    dropSnap.forEach((d) => {
      const x = d.data() || {};
      const ex = String(x.exchange || "").toUpperCase();
      const mkRaw = String(x.symbol_or_pair_id || x.symbol || x.market || "");
      const exResolved = normalizeProviderId(ex || inferExchangeFromMarket(mkRaw));
      if (!exResolved || exResolved !== exchange) return;
      const mkNorm = normalizeMarketSymbolForProvider(mkRaw, exResolved) || mkRaw;
      dropsRaw.push({ id: d.id, _market_norm: mkNorm, ...x, _signal_source: "DROP" });
    });

    const signalsMerged = [
      ...signalsRaw.map((x) => ({ ...x, _signal_source: "SIGNAL" })),
      ...dropsRaw,
    ].sort((a, b) => {
      const aMs = toMsSafe(a.created_at || a.created_kst || a.bar_close_time_utc_ms) || 0;
      const bMs = toMsSafe(b.created_at || b.created_kst || b.bar_close_time_utc_ms) || 0;
      return bMs - aMs;
    });
    const febtShadowRecent = summarizeFebtRows(signalsMerged.slice(0, 200));
    const febtPhase0Latest = summarizeFebtPhase0Artifact(readJsonSafe(FEBT_PHASE0_LATEST_PATH, null));

    const fillsRaw = [];
    fillSnap.forEach((d) => {
      const x = d.data() || {};
      const ex = String(x.exchange || "").toUpperCase();
      const mkRaw = String(x.symbol || x.symbol_or_pair_id || x.market || "");
      const exResolved = normalizeProviderId(ex || inferExchangeFromMarket(mkRaw));
      if (!exResolved || exResolved !== exchange) return;
      if (!isLiveDocForExchange(exchange, x)) return;
      const mkNorm = normalizeMarketSymbolForProvider(mkRaw, exResolved) || mkRaw;
      fillsRaw.push({ id: d.id, _market_norm: mkNorm, ...x });
    });

    const intentsFiltered = [];
    intentSnap.forEach((d) => {
      const x = d.data() || {};
      const ex = String(x.exchange || "").toUpperCase();
      const mk = String(x.symbol || x.symbol_or_pair_id || x.market || "");
      const exResolved = ex || inferExchangeFromMarket(mk);
      if (!exResolved || exResolved !== exchange) return;
      intentsFiltered.push({ id: d.id, ...x });
    });

    const intentLookup = buildIntentStatusLookup({ intents: intentsFiltered, exchange, tfDefault: signalTf });

    const intentFailures = {
      total: 0,
      latest_at: null,
      top: [],
      recent: [],
    };
    const failureCounts = {};
    const failureLabel = (raw) => {
      const r = String(raw || "UNKNOWN").toUpperCase();
      if (r === "ORDER_TOO_SMALL") return "주문 너무 작음";
      if (r === "POSITION_TOO_SMALL") return "포지션 수량이 최소주문보다 작음";
      if (r === "MIN_ORDER_EXCEEDS_BUDGET") return "예산이 최소주문보다 작음";
      if (r === "TOTAL_BUDGET_EXCEEDED") return "총 예산 초과";
      if (r === "POSITION_FULL") return "포지션 한도";
      if (r === "NO_POSITION") return "보유 포지션 없음";
      if (r === "LIVE_DISABLED") return "실거래 비활성";
      if (r === "BAD_QTY") return "수량 오류";
      if (r === "BAD_FILL_PRICE") return "가격 오류";
      return r;
    };
    for (const x of intentsFiltered) {
      const st = String(x.status || "").toUpperCase();
      if (st !== "CANCELED") continue;
      const mk = String(x.symbol || x.symbol_or_pair_id || x.market || "");
      const reasonRaw = String(x.cancel_reason || x.status_reason || "UNKNOWN").toUpperCase();
      const reason = failureLabel(reasonRaw);
      failureCounts[reason] = (failureCounts[reason] || 0) + 1;
      intentFailures.total += 1;
      if (!intentFailures.latest_at) {
        intentFailures.latest_at = x.updated_at || x.created_at || null;
      }
      if (intentFailures.recent.length < 6) {
        intentFailures.recent.push({
          intent_id: x.intent_id || x.id,
          market: mk || "-",
          reason,
          reason_raw: reasonRaw,
          note: x.cancel_note || null,
          updated_at: x.updated_at || x.created_at || null,
        });
      }
    }
    intentFailures.top = Object.entries(failureCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // kpi_latest (market별)
    const kpiSnap = await db.collection("kpi_latest").select("market", "kpi", "tf", "exchange").get();
    const kpiLatestByMarket = buildKpiLatestByMarket({ snap: kpiSnap, exchange, execTf });
    const kpiByMarket = {};
    for (const [market, row] of Object.entries(kpiLatestByMarket)) {
      kpiByMarket[market] = row && row.kpi ? row.kpi : null;
    }

    // positions_paper (market별)
    const posSnap = await db.collection("positions_paper").get();
    const posByMarket = {};
    posSnap.forEach((d) => {
      const x = d.data() || {};
      const posId = String(x.pos_id || d.id || "");
      if (!posId.startsWith("POS__")) return;
      const mk = x.symbol_or_pair_id || x.symbol;
      if (!mk) return;
      const ex = String(x.exchange || "").toUpperCase();
      const exResolved = ex || inferExchangeFromMarket(mk);
      if (!exResolved || exResolved !== exchange) return;
      if (!isLiveDocForExchange(exchange, x)) return;
      posByMarket[String(mk)] = x;
    });

    const exitRules = getExitRulesForExchange(exchange);
    const tpThreshold = tpP1ForExchange(exchange);
    const tpStatus = {
      exec_tf: execTf,
      threshold_pct: tpThreshold,
      threshold_pct_min: tpThreshold,
      threshold_pct_max: tpThreshold,
      tp_qty_pct: exitRules.TP_P1_QTY,
      tp_qty_pct_min: exitRules.TP_P1_QTY,
      tp_qty_pct_max: exitRules.TP_P1_QTY,
      trail_pct: exitRules.TRAIL_PCT,
      trail_pct_min: exitRules.TRAIL_PCT,
      trail_pct_max: exitRules.TRAIL_PCT,
      runner_min_profit_pct: exitRules.RUNNER_MIN_PROFIT_PCT,
      runner_min_profit_pct_min: exitRules.RUNNER_MIN_PROFIT_PCT,
      runner_min_profit_pct_max: exitRules.RUNNER_MIN_PROFIT_PCT,
      sl_pct: exitRules.SL,
      sl_pct_min: exitRules.SL,
      sl_pct_max: exitRules.SL,
      mixed_rules: false,
      rules_source_label: `${exchange} 기본 규칙`,
      ready_count: 0,
      ready_markets: [],
      latest_exec_kst: null,
      next_exec_kst: null,
    };
    let latestExecMs = null;
    const execTfMs = tfToMs(execTf);
    const activeResolvedRules = [];
    for (const [mk, pos] of Object.entries(posByMarket)) {
      const state = String(pos.state || "").toUpperCase();
      if (state !== "ACTIVE") continue;
      const avg = Number(pos.avg_price);
      if (!Number.isFinite(avg) || avg <= 0) continue;
      const resolvedExitRules = resolveExitRulesForPosition({ exchange, position: pos });
      activeResolvedRules.push(resolvedExitRules);
      let bars = [];
      try {
        bars = await queryBars({ exchange, symbol: mk, tf: execTf, limit: 1 });
      } catch (_) {
        bars = [];
      }
      const bar = (bars && bars.length) ? bars[bars.length - 1] : null;
      const close = Number(bar && (bar.close ?? bar.c));
      const closeMs = Number(bar && (bar.closeTimeUtcMs ?? bar.timestamp));
      if (!Number.isFinite(close)) continue;
      if (Number.isFinite(closeMs)) {
        latestExecMs = latestExecMs == null ? closeMs : Math.max(latestExecMs, closeMs);
      }
      const side = String(pos.position_side || pos.side || "LONG").toUpperCase();
      const pnlPct = (side === "SHORT") ? ((avg - close) / avg) : ((close - avg) / avg);
      const leverage = resolvePositionLeverage(pos, {
        fallback: isBinanceExchange ? defaultFuturesLeverage : 1,
      }) || 1;
      const pnlPctEffective = Number.isFinite(pnlPct) ? (pnlPct * leverage) : null;
      const tpThresholdForPos = Number.isFinite(Number(resolvedExitRules && resolvedExitRules.TP_P1))
        ? Number(resolvedExitRules.TP_P1)
        : tpThreshold;
      if (Number.isFinite(pnlPctEffective) && Number.isFinite(tpThresholdForPos) && pnlPctEffective >= tpThresholdForPos) {
        tpStatus.ready_count += 1;
        tpStatus.ready_markets.push(mk);
      }
    }
    if (activeResolvedRules.length > 0) {
      const thresholdSummary = summarizeExitRuleValue(activeResolvedRules, "TP_P1", tpThreshold);
      const tpQtySummary = summarizeExitRuleValue(activeResolvedRules, "TP_P1_QTY", exitRules.TP_P1_QTY);
      const trailSummary = summarizeExitRuleValue(activeResolvedRules, "TRAIL_PCT", exitRules.TRAIL_PCT);
      const runnerSummary = summarizeExitRuleValue(activeResolvedRules, "RUNNER_MIN_PROFIT_PCT", exitRules.RUNNER_MIN_PROFIT_PCT);
      const slSummary = summarizeExitRuleValue(activeResolvedRules, "SL", exitRules.SL);
      tpStatus.threshold_pct = thresholdSummary.value;
      tpStatus.threshold_pct_min = thresholdSummary.min;
      tpStatus.threshold_pct_max = thresholdSummary.max;
      tpStatus.tp_qty_pct = tpQtySummary.value;
      tpStatus.tp_qty_pct_min = tpQtySummary.min;
      tpStatus.tp_qty_pct_max = tpQtySummary.max;
      tpStatus.trail_pct = trailSummary.value;
      tpStatus.trail_pct_min = trailSummary.min;
      tpStatus.trail_pct_max = trailSummary.max;
      tpStatus.runner_min_profit_pct = runnerSummary.value;
      tpStatus.runner_min_profit_pct_min = runnerSummary.min;
      tpStatus.runner_min_profit_pct_max = runnerSummary.max;
      tpStatus.sl_pct = slSummary.value;
      tpStatus.sl_pct_min = slSummary.min;
      tpStatus.sl_pct_max = slSummary.max;
      tpStatus.mixed_rules = thresholdSummary.mixed || tpQtySummary.mixed || trailSummary.mixed || runnerSummary.mixed || slSummary.mixed;
      tpStatus.rules_source_label = tpStatus.mixed_rules
        ? `${exchange} 활성 포지션 혼합 규칙`
        : `${exchange} 활성 포지션 규칙`;
    }
    if (Number.isFinite(latestExecMs)) {
      tpStatus.latest_exec_kst = toKstString(new Date(latestExecMs).toISOString());
      if (Number.isFinite(execTfMs) && execTfMs > 0) {
        tpStatus.next_exec_kst = toKstString(new Date(latestExecMs + execTfMs).toISOString());
      }
    }

    // bars_snapshots (latest close per market)
    const barsSnap = await db.collection("bars_snapshots")
      .select("symbol", "symbol_or_pair_id", "ohlcv_json", "created_at")
      .orderBy("created_at", "desc")
      .limit(900)
      .get();
    const closeByMarket = {};
    barsSnap.forEach((d) => {
      const x = d.data() || {};
      const ex = String(x.exchange || "").toUpperCase();
      const mk = x.symbol || x.symbol_or_pair_id;
      const exResolved = ex || inferExchangeFromMarket(mk);
      if (!exResolved || exResolved !== exchange) return;
      if (!mk || closeByMarket[mk] !== undefined) return;
      const o = x.ohlcv_json || {};
      const close = Number(o.close);
      if (!Number.isFinite(close)) return;
      closeByMarket[mk] = close;
    });

    const aiRunLatest = await getLatestAiRun(db, exchange);
    const aiAllocCfgRaw = await getAiAllocationSettingsForProvider(exchange, 5000);
    const aiAllocCfgData = (aiAllocCfgRaw && aiAllocCfgRaw.data && typeof aiAllocCfgRaw.data === "object")
      ? aiAllocCfgRaw.data
      : {};
    const aiAllocConfig = {
      enabled: aiAllocCfgData.enabled === true,
      cadence_days: Number(aiAllocCfgData.cadence_days || 0) || null,
      run_dow: Number.isFinite(Number(aiAllocCfgData.run_dow)) ? Number(aiAllocCfgData.run_dow) : null,
      run_hour_kst: Number.isFinite(Number(aiAllocCfgData.run_hour_kst)) ? Number(aiAllocCfgData.run_hour_kst) : null,
      run_hours_kst: normalizeRunHoursForUi(aiAllocCfgData.run_hours_kst),
      run_minute_kst: Number.isFinite(Number(aiAllocCfgData.run_minute_kst)) ? Number(aiAllocCfgData.run_minute_kst) : 30,
      gpt_enabled: aiAllocCfgData.gpt_enabled !== false,
      claude_enabled: aiAllocCfgData.claude_enabled !== false,
      ensemble_enabled: aiAllocCfgData.ensemble_enabled !== false,
      ensemble_w_gpt: Number.isFinite(Number(aiAllocCfgData.ensemble_w_gpt)) ? Number(aiAllocCfgData.ensemble_w_gpt) : null,
      ensemble_w_claude: Number.isFinite(Number(aiAllocCfgData.ensemble_w_claude)) ? Number(aiAllocCfgData.ensemble_w_claude) : null,
    };

    let riskBudget = null;
    try {
      const rb = await getRiskBudgetForProvider(exchange, 0);
      riskBudget = rb && rb.data ? rb.data : null;
    } catch (_) {
      riskBudget = null;
    }
    let budgetUnit = String((riskBudget && riskBudget.unit) || (String(exchange || "").includes("BINANCE") ? "USDT" : "KRW")).toUpperCase();
    let budgetEnabled = riskBudget && riskBudget.enabled === true;
    let budgetDefault = budgetEnabled ? Number(riskBudget.default_max_krw || 0) : null;
    let budgetByMarket = budgetEnabled && typeof riskBudget.by_market === "object" ? riskBudget.by_market : {};
    let totalMaxRaw = budgetEnabled ? Number(riskBudget.total_max_krw || 0) : 0;
    let budgetSource = (riskBudget && riskBudget.source) ? String(riskBudget.source) : "risk_budget";
    let budgetVirtual = false;

    if (!budgetEnabled) {
      const aiBudget = deriveAiBudget(aiRunLatest, exchange, markets_expected);
      if (aiBudget) {
        riskBudget = aiBudget;
        budgetEnabled = true;
        budgetUnit = String(aiBudget.unit || budgetUnit).toUpperCase();
        budgetDefault = (aiBudget.default_max_krw && aiBudget.default_max_krw > 0) ? aiBudget.default_max_krw : null;
        budgetByMarket = aiBudget.by_market || {};
        totalMaxRaw = (aiBudget.total_max_krw && aiBudget.total_max_krw > 0) ? aiBudget.total_max_krw : 0;
        budgetSource = aiBudget.source || "ai_allocation";
        budgetVirtual = aiBudget.virtual === true;
      }
    }
    const realizedByMarket = {};
    const asOfMs = Date.now();
    const pnlScopeDays = getPnlScopeDays();
    const pnlScopeFromMs = getScopeFromMs(asOfMs, pnlScopeDays);
    const pnlScopeToMs = asOfMs + 1;
    let realizedSourceExternalN = 0;
    let realizedSourceFallbackN = 0;
    let realizedSourceNoneN = 0;
    let realizedTotalAll = null;
    let pnlSourcePolicy = null;
    const pnlMode = String(process.env.TRADE_PNL_MODE || "EACH_SELL");
    const fillsLimit = clampLimit(process.env.DASHBOARD_FILLS_LIMIT, 50, 4000, 2000);
    const weeklyFromMs = Date.parse(String(weekly.from || ""));
    const weeklyToMs = Date.parse(String(weekly.to || ""));
    const weeklyRangeAgg = { total: 0, hasTotal: false, trades: 0, by_market: {} };
    const weeklyRangeAggAll = { total: 0, hasTotal: false, trades: 0, by_market: {} };
    const resolvedRealized = await resolveRealizedRowsByMarket({
      exchange,
      markets: markets_expected,
      tf: execTf,
      fallbackTf: signalTf || execTf,
      limitN: fillsLimit,
      fromMs: pnlScopeFromMs,
      toMs: pnlScopeToMs,
      mode: pnlMode,
      includeAllIncomeMarkets: true,
    });
    pnlSourcePolicy = resolvedRealized && resolvedRealized.source_policy
      ? String(resolvedRealized.source_policy)
      : null;
    if (resolvedRealized && resolvedRealized.source_breakdown) {
      realizedSourceExternalN = Number(resolvedRealized.source_breakdown.external_markets || 0);
      realizedSourceFallbackN = Number(resolvedRealized.source_breakdown.fallback_markets || 0);
      realizedSourceNoneN = Number(resolvedRealized.source_breakdown.none_markets || 0);
    }
    const totalAllRaw = Number(resolvedRealized && resolvedRealized.total_pnl_krw);
    realizedTotalAll = Number.isFinite(totalAllRaw) ? totalAllRaw : null;

    for (const mk of markets_expected) {
      const bucket = resolvedRealized && resolvedRealized.by_market ? resolvedRealized.by_market[mk] : null;
      const rows = Array.isArray(bucket && bucket.rows) ? bucket.rows : [];
      let sum = 0;
      let has = false;
      let rangeSum = 0;
      let rangeHas = false;
      let rangeTrades = 0;
      for (const row of rows) {
        const v = Number(row && row.pnl_krw);
        if (!Number.isFinite(v)) continue;
        sum += v;
        has = true;
        const ms = Number(row && row.close_ms);
        if (Number.isFinite(weeklyFromMs) && Number.isFinite(weeklyToMs) && Number.isFinite(ms)) {
          if (ms >= weeklyFromMs && ms < weeklyToMs) {
            rangeSum += v;
            rangeHas = true;
            rangeTrades += 1;
          }
        }
      }
      realizedByMarket[mk] = has ? sum : null;
      weeklyRangeAgg.by_market[mk] = {
        realized_krw: rangeHas ? rangeSum : null,
        trades_n: rangeTrades,
      };
      if (rangeHas) {
        weeklyRangeAgg.total += rangeSum;
        weeklyRangeAgg.hasTotal = true;
      }
      weeklyRangeAgg.trades += rangeTrades;
    }

    for (const mk of (resolvedRealized && Array.isArray(resolvedRealized.markets) ? resolvedRealized.markets : [])) {
      const bucket = resolvedRealized.by_market ? resolvedRealized.by_market[mk] : null;
      const rows = Array.isArray(bucket && bucket.rows) ? bucket.rows : [];
      let rangeSum = 0;
      let rangeHas = false;
      let rangeTrades = 0;
      for (const row of rows) {
        const v = Number(row && row.pnl_krw);
        if (!Number.isFinite(v)) continue;
        const ms = Number(row && row.close_ms);
        if (Number.isFinite(weeklyFromMs) && Number.isFinite(weeklyToMs) && Number.isFinite(ms)) {
          if (ms >= weeklyFromMs && ms < weeklyToMs) {
            rangeSum += v;
            rangeHas = true;
            rangeTrades += 1;
          }
        }
      }
      weeklyRangeAggAll.by_market[mk] = {
        realized_krw: rangeHas ? rangeSum : null,
        trades_n: rangeTrades,
      };
      if (rangeHas) {
        weeklyRangeAggAll.total += rangeSum;
        weeklyRangeAggAll.hasTotal = true;
      }
      weeklyRangeAggAll.trades += rangeTrades;
    }

    // market별 최신 1건
    const lastSignalByMarket = {};
    for (const x of signalsMerged) {
      const mk = String(x._market_norm || normalizeMarketSymbolForProvider(x.symbol_or_pair_id || x.symbol || x.market || "", exchange)).trim();
      if (!mk) continue;
      if (!lastSignalByMarket[mk]) lastSignalByMarket[mk] = x;
    }

    const lastFillByMarket = {};
    for (const x of fillsRaw) {
      const mk = String(x._market_norm || normalizeMarketSymbolForProvider(x.symbol || x.symbol_or_pair_id || x.market || "", exchange)).trim();
      if (!mk) continue;
      if (!lastFillByMarket[mk]) lastFillByMarket[mk] = x;
    }

    const markets = markets_expected.map((mk) => {
      const kpi = kpiByMarket[mk] || { status: "INCONCLUSIVE", n: 0 };
      const pos = posByMarket[mk] || { state: "FLAT", size_pct: 0, avg_price: null };
      const lastSig = lastSignalByMarket[mk] || null;
      const lastFill = lastFillByMarket[mk] || null;
      const close = (closeByMarket[mk] !== undefined) ? closeByMarket[mk] : null;
      const unrealized = (pos && pos.avg_price != null)
        ? computeUnrealized(close, pos.avg_price, pos.position_side || pos.side)
        : null;

      const kpiN = (kpi && kpi.n != null) ? Number(kpi.n) : 0;
      const budgetMaxKrw = budgetEnabled
        ? Number((budgetByMarket && budgetByMarket[mk]) || budgetDefault || 0)
        : null;
      const budgetUsedKrw = budgetEnabled
        ? resolvePositionBudgetUsedKrw({ exchange, position: pos, budgetMaxKrw })
        : null;
      const positionLeverage = resolvePositionLeverage(pos, {
        fallback: isBinanceExchange ? defaultFuturesLeverage : 1,
      });
      const positionLeverageTier = resolveLeverageTier(positionLeverage);
      const positionLeverageReason = resolvePositionLeverageReason(pos);
      const fillLeverage = resolveFillLeverage(lastFill, {
        position: pos,
        fallback: positionLeverage,
      });
      const fillLeverageTier = resolveLeverageTier(fillLeverage);
      const fillLeverageReason = resolveFillLeverageReason(lastFill, { position: pos });
      const rollback = resolvePositionRollback(pos);
      const exitStage = buildExitStageView({
        exchange,
        position: pos,
        closePrice: close,
        leverageFallback: isBinanceExchange ? defaultFuturesLeverage : 1,
      });

      const realizedKrw = (realizedByMarket[mk] != null) ? Number(realizedByMarket[mk]) : null;
      const unrealizedKrw = (budgetUsedKrw != null && unrealized != null)
        ? (budgetUsedKrw * Number(unrealized))
        : null;
      let totalPnlKrw = null;
      if (Number.isFinite(realizedKrw)) totalPnlKrw = realizedKrw;
      if (Number.isFinite(unrealizedKrw)) totalPnlKrw = (totalPnlKrw == null ? 0 : totalPnlKrw) + unrealizedKrw;
      const growthPct = (budgetMaxKrw && budgetMaxKrw > 0 && totalPnlKrw != null)
        ? (totalPnlKrw / budgetMaxKrw)
        : null;

      return {
        market: mk,
        kpi,
        kpi_n: kpiN,
        position: {
          state: pos.state || "FLAT",
          size_pct: (pos.size_pct != null) ? Number(pos.size_pct) : 0,
          avg_price: (pos.avg_price != null) ? Number(pos.avg_price) : null,
          budget_max_krw: (budgetMaxKrw && budgetMaxKrw > 0) ? budgetMaxKrw : null,
          budget_used_krw: (budgetUsedKrw != null) ? budgetUsedKrw : null,
          leverage: positionLeverage,
          leverage_tier: positionLeverageTier,
          leverage_reason: positionLeverageReason,
          rollback_active: rollback.active,
          rollback_until_ms: rollback.until_ms,
          rollback_remaining_ms: rollback.remaining_ms,
          rollback_reason: rollback.reason,
        },
        position_state: pos.state || "FLAT",
        position_leverage: positionLeverage,
        position_leverage_tier: positionLeverageTier,
        exit_stage: exitStage,
        unrealized_pnl_pct: unrealized,
        realized_pnl_krw: realizedKrw,
        unrealized_pnl_krw: unrealizedKrw,
        total_pnl_krw: totalPnlKrw,
        growth_pct: growthPct,
        last_signal: lastSig ? {
          created_kst: toKstString(lastSig.created_at),
          created_at: lastSig.created_at || null,
          side: lastSig.side || null,
          event: lastSig.event || null,
          qty_pct: lastSig.qty_pct ?? lastSig.qtyPct ?? null,
          event_intent: lastSig.event_intent ?? null,
          mapping_ok: computeMappingOk(lastSig),
          late_by_bars: lastSig.features_json ? lastSig.features_json._late_by_bars : null,
        } : null,
        last_fill: lastFill ? {
          created_kst: toKstString(lastFill.created_at),
          created_at: lastFill.created_at || null,
          side: lastFill.side || null,
          event: lastFill.event || null,
          exec_price: lastFill.exec_price ?? null,
          exec_price_source: lastFill.exec_price_source ?? null,
          notional_krw: (lastFill.notional_krw != null) ? Number(lastFill.notional_krw) : null,
          budget_used_krw: resolveFillBudgetUsedKrw({
            exchange,
            fill: lastFill,
            position: pos,
            budgetMaxKrw,
          }),
          leverage_applied: fillLeverage,
          leverage_tier: fillLeverageTier,
          leverage_reason: fillLeverageReason,
          signal_price: (lastFill.signal_price != null) ? Number(lastFill.signal_price) : null,
          signal_price_diff: (lastFill.signal_price_diff != null) ? Number(lastFill.signal_price_diff) : null,
          signal_price_diff_pct: (lastFill.signal_price_diff_pct != null) ? Number(lastFill.signal_price_diff_pct) : null,
        } : null,
      };
    });
    const leverage_summary = buildLeverageSummary(markets, { includeFlat: false });
    leverage_summary.default_leverage = isBinanceExchange ? defaultFuturesLeverage : 1;
    leverage_summary.enabled = isBinanceExchange;
    const rollback_summary = buildRollbackSummary(markets, { includeFlat: false });
    rollback_summary.enabled = isBinanceExchange;

    let totalUsed = 0;
    let sumMax = 0;
    for (const m of markets) {
      const used = m.position && m.position.budget_used_krw != null ? Number(m.position.budget_used_krw) : null;
      const max = m.position && m.position.budget_max_krw != null ? Number(m.position.budget_max_krw) : null;
      if (Number.isFinite(used)) totalUsed += used;
      if (Number.isFinite(max)) sumMax += max;
    }

    const totalMaxEffective = (totalMaxRaw && totalMaxRaw > 0) ? totalMaxRaw : (sumMax > 0 ? sumMax : null);
    const totalUsedPct = (totalMaxEffective && totalMaxEffective > 0) ? (totalUsed / totalMaxEffective) : null;
    const budget_summary = {
      enabled: budgetEnabled,
      total_max_krw: totalMaxEffective,
      total_used_krw: budgetEnabled ? totalUsed : null,
      total_used_pct: totalUsedPct,
      total_max_source: (totalMaxRaw && totalMaxRaw > 0) ? "total_max_krw" : "sum_by_market",
      unit: budgetUnit,
      source: budgetSource,
      virtual: budgetVirtual,
      updated_at: riskBudget && riskBudget.updated_at ? riskBudget.updated_at : null,
    };

    let totalUnrealized = 0;
    let pnlUsed = 0;
    for (const m of markets) {
      const posState = m.position && m.position.state ? String(m.position.state).toUpperCase() : "";
      const used = m.position && m.position.budget_used_krw != null ? Number(m.position.budget_used_krw) : null;
      const u = (m.unrealized_pnl_pct != null) ? Number(m.unrealized_pnl_pct) : null;
      if (posState === "ACTIVE" && Number.isFinite(used) && Number.isFinite(u)) {
        totalUnrealized += used * u;
        pnlUsed += used;
      }
    }
    let totalRealized = 0;
    let hasRealized = false;
    for (const mk of markets_expected) {
      const v = Number(realizedByMarket[mk]);
      if (!Number.isFinite(v)) continue;
      totalRealized += v;
      hasRealized = true;
    }
    const totalUnrealizedKrw = (budgetEnabled && pnlUsed > 0) ? totalUnrealized : null;
    const totalRealizedKrw = Number.isFinite(realizedTotalAll) ? realizedTotalAll : (hasRealized ? totalRealized : null);
    const totalPnlKrw = (totalUnrealizedKrw != null || totalRealizedKrw != null)
      ? (Number(totalUnrealizedKrw || 0) + Number(totalRealizedKrw || 0))
      : null;
    const growthPctTotal = (totalMaxEffective && totalMaxEffective > 0 && totalPnlKrw != null)
      ? (totalPnlKrw / totalMaxEffective)
      : null;
    const growthPctUsed = (pnlUsed > 0 && totalPnlKrw != null) ? (totalPnlKrw / pnlUsed) : null;
    const budget_perf = {
      total_unrealized_krw: totalUnrealizedKrw,
      total_realized_krw: totalRealizedKrw,
      total_pnl_krw: totalPnlKrw,
      growth_pct_total: growthPctTotal,
      growth_pct_used: growthPctUsed,
      pnl_used_krw: pnlUsed || null,
      unit: budgetUnit,
      pnl_scope_days: pnlScopeDays,
      pnl_scope_from_ms: pnlScopeFromMs,
      pnl_scope_to_ms: pnlScopeToMs,
      pnl_source_policy: pnlSourcePolicy,
      realized_source_mode:
        realizedSourceExternalN > 0 && realizedSourceFallbackN > 0 ? "MIXED" :
        realizedSourceExternalN > 0 ? "EXTERNAL" :
        realizedSourceFallbackN > 0 ? "FALLBACK" : "NONE",
      realized_source_breakdown: {
        external_markets: realizedSourceExternalN,
        fallback_markets: realizedSourceFallbackN,
        none_markets: realizedSourceNoneN,
      },
    };

    const weeklyMarketRows = Object.keys(weeklyRangeAggAll.by_market || {}).map((mk) => {
      const row = weeklyRangeAggAll.by_market[mk] || {};
      return { market: mk, realized_krw: row.realized_krw ?? null, trades_n: row.trades_n ?? 0 };
    }).filter((r) => Number.isFinite(Number(r.realized_krw)));
    const totalAbs = weeklyMarketRows.reduce((acc, r) => acc + Math.abs(Number(r.realized_krw)), 0);
    const sorted = weeklyMarketRows
      .sort((a, b) => Math.abs(Number(b.realized_krw)) - Math.abs(Number(a.realized_krw)))
    const top3 = sorted.slice(0, 3).map((r) => ({
      market: r.market,
      realized_krw: r.realized_krw,
      share_pct: (totalAbs > 0) ? (Math.abs(Number(r.realized_krw)) / totalAbs) : null,
    }));
    const restAbs = sorted.slice(3).reduce((acc, r) => acc + Math.abs(Number(r.realized_krw)), 0);
    const other = (restAbs > 0) ? {
      market: "OTHER",
      realized_krw: sorted.slice(3).reduce((acc, r) => acc + Number(r.realized_krw), 0),
      share_pct: (totalAbs > 0) ? (restAbs / totalAbs) : null,
    } : null;

    const weekly_range_perf = {
      from: weekly.from,
      to: weekly.to,
      total_realized_krw: weeklyRangeAggAll.hasTotal ? weeklyRangeAggAll.total : null,
      growth_pct_total: (totalMaxEffective && totalMaxEffective > 0 && weeklyRangeAggAll.hasTotal)
        ? (weeklyRangeAggAll.total / totalMaxEffective)
        : null,
      trades_n: weeklyRangeAggAll.trades,
      top3,
      other,
    };

    // coverage (KPI_MIN_N 기준)
    const KPI_MIN_N = Number(process.env.KPI_MIN_N || 20);
    let minN = Infinity;
    for (const m of markets) minN = Math.min(minN, Number(m.kpi_n || 0));
    const ok = markets.every((m) => Number(m.kpi_n || 0) >= KPI_MIN_N);

    const coverage = {
      label: ok ? "DATA_OK" : "DATA_INSUFFICIENT",
      kpi_min_n: KPI_MIN_N,
      min_n: (minN === Infinity ? 0 : minN),
      per_market: markets.map((m) => ({ market: m.market, n: m.kpi_n })),
      note: ok
        ? "kpi.n 기준 충족. EV/승률/꼬리 지표 판단 가능."
        : "kpi.n 표본 부족. EV/승률/꼬리 지표는 무효로 처리.",
    };

    // signals/fills list view (12개)
    const nowMs = Date.now();
    const signals12 = signalsMerged.slice(0, 12).map((x) => {
      const matched = intentLookup.resolveForSignal(x);
      const schedMs = Number(matched && matched.scheduled_exec_bar_close_time_utc_ms);
      const execPlan = matched ? {
        intent_id: matched.intent_id || matched.id || null,
        status: normalizeStatus(resolveIntentStatusForView(matched, nowMs)),
        scheduled_exec_bar_close_time_utc_ms: Number.isFinite(schedMs) ? schedMs : null,
        scheduled_exec_kst: Number.isFinite(schedMs) ? toKstString(schedMs) : null,
        pending_reason: matched.pending_reason || null,
        status_reason: matched.status_reason || null,
        cancel_reason: matched.cancel_reason || null,
        cancel_note: matched.cancel_note || null,
        last_error: matched.last_error || null,
        is_future: Number.isFinite(schedMs) ? schedMs > nowMs : null,
      } : null;
      const displayReason = buildSignalDisplayReason(x, execPlan);
      return {
        created_kst: toKstString(x.created_at),
        created_at: x.created_at || null,
        symbol: x.symbol_or_pair_id || x.symbol || null,
        tf: x.tf || null,
        event: x.event || null,
        side: x.side || null,
        qty_pct: (x.qty_pct === undefined ? (x.qtyPct === undefined ? null : x.qtyPct) : x.qty_pct),
        reason: x.reason || null,
        display_reason: displayReason.primary,
        display_reason_detail: displayReason.detail,
        display_reason_secondary: displayReason.secondary,
        display_reason_external_fill: displayReason.is_external_fill,
        display_reason_stage_step: displayReason.stage_step,
        display_reason_stage_label: displayReason.stage_label,
        display_reason_stage_text: displayReason.stage_text,
        display_reason_ko: displayReason.reason_ko,
        event_intent: x.event_intent ?? null,
        mapping_ok: computeMappingOk(x),
        late_by_bars: x.features_json ? x.features_json._late_by_bars : null,
        exec_plan: execPlan,
      };
    });

    const fills12 = aggregateFillsForUi(fillsRaw, 12).map((x) => {
      const display = buildFillDisplayReason(x);
      return {
        created_kst: toKstString(x.created_at),
        created_at: x.created_at || null,
        symbol: x.symbol || x.symbol_or_pair_id || x.market || null,
        tf: x.tf || null,
        event: x.event || null,
        side: x.side || null,
        exec_price: x.exec_price ?? null,
        exec_price_source: x.exec_price_source ?? null,
        exec_bar_close_time_utc_ms: x.exec_bar_close_time_utc_ms ?? null,
        notional_krw: (x.notional_krw != null) ? Number(x.notional_krw) : null,
        leverage_applied: (x.leverage_applied != null)
          ? Number(x.leverage_applied)
          : ((x.applied_leverage != null) ? Number(x.applied_leverage) : null),
        leverage_tier: resolveLeverageTier(
          x.leverage_applied != null
            ? Number(x.leverage_applied)
            : (x.applied_leverage != null ? Number(x.applied_leverage) : null)
        ),
        leverage_reason: x.leverage_reason || null,
        signal_price: (x.signal_price != null) ? Number(x.signal_price) : null,
        signal_price_diff: (x.signal_price_diff != null) ? Number(x.signal_price_diff) : null,
        signal_price_diff_pct: (x.signal_price_diff_pct != null) ? Number(x.signal_price_diff_pct) : null,
        display_exec_label: display.exec_label,
        display_exec_text: display.exec_text,
        display_exec_ko: display.exec_ko,
      };
    });

    const runtime = {
      mode: process.env.RUNTIME_MODE || (process.env.NODE_ENV === "production" ? "prod" : "local"),
      engine_version: process.env.ENGINE_VERSION || "baseline_v0",
    };

    const todayKey = kstDateKey(new Date().toISOString());
    const aiModeToday = aiRunLatest && (kstDateKey(aiRunLatest.created_at) === todayKey) ? aiRunLatest : null;
    const aiModeDisplay = aiModeToday || aiRunLatest || null;
    const aiModeStale = !!(aiModeDisplay && !aiModeToday);

    const charter_check = checkCharterConsistency(exchange);
    const gate_latest = await getLatestGateForExchange(db, exchange);

    const asOfKst = toKstString(new Date().toISOString());
    const payload = {
      service: String(process.env.K_SERVICE || "donbeolja"),
      exchange,
      as_of_kst: asOfKst,
      pnl_scope_days: pnlScopeDays,
      pnl_source_policy: pnlSourcePolicy || (budget_perf && budget_perf.pnl_source_policy) || null,
      signal_tf: signalTf,
      exec_tf: execTf,
      gate_latest,
      weekly,
      packUrl,
      latestSignalsAt: maxCreatedAt(signalsMerged),
      latestFillsAt: maxCreatedAt(fillsRaw),
      markets_expected,
      markets,
      coverage,
      signals12,
      fills12,
      runtime,
      system_settings: {
        execution_mode: systemSettings.execution_mode || "PAPER",
        live_enabled: systemSettings.live_enabled === true,
        live_dry_run: systemSettings.live_dry_run === true,
        live_confirm_required: systemSettings.live_confirm_required === true,
        futures_leverage: defaultFuturesLeverage,
      },
      tp_status: tpStatus,
      leverage_summary,
      rollback_summary,
      ai_mode_today: aiModeToday,
      ai_mode_display: aiModeDisplay,
      ai_mode_stale: aiModeStale,
      ai_run_latest: aiRunLatest,
      ai_alloc_config: aiAllocConfig,
      charter_check,
      budget_summary,
      budget_perf,
      weekly_range_perf,
      febt_shadow_recent: febtShadowRecent,
      febt_phase0_latest: febtPhase0Latest,
      intent_failures: intentFailures,
      mission_control: buildMissionControlViewModel(),
    };
    setHomeCache(cacheKey, payload);
    return res.render("home", payload);
  } catch (e) {
    const errorRef = buildRouteErrorRef("HOME");
    logRouteError("HOME_ROUTE_ERROR", errorRef, e, {
      route: "dashboard.home",
      exchange: req && req.query ? String(req.query.exchange || "") : null,
    });
    const sanitized = sanitizeRouteError(e, {
      defaultCode: "HOME_ROUTE_ERROR",
      defaultMessage: "홈 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      defaultStatus: 500,
    });
    return res.status(sanitized.status).send(`${sanitized.code}:${errorRef}`);
  }
});

module.exports = router;
module.exports.__test = {
  buildAiReasonKo,
  splitAiReasonUnits,
  translateAiReasonUnitKo,
};
