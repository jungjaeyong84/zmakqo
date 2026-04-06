"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../storage/firestore");

const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");
const CAPITAL_ALLOCATOR_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json");
const QUARANTINE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_quarantine_latest.json");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const POLICY_PARAMETER_PLAN_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_policy_parameter_plan_latest.json");
const OBJECTIVE_SUPERVISOR_PATH = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");
const SIGNAL_LINEAGE_HEALTH_PATH = path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json");
const DRIFT_REMEDIATION_APPLY_PATH = path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_apply_latest.json");
const LINEAGE_REPORT_LATEST_COLLECTION = String(process.env.LIVE_EXEC_POLICY_LINEAGE_REPORT_LATEST_COLLECTION || "report_latest").trim() || "report_latest";
const LINEAGE_REPORT_LATEST_DOC_ID = String(process.env.LIVE_EXEC_POLICY_LINEAGE_REPORT_LATEST_DOC_ID || "LATEST__signal_lineage_health__GLOBAL").trim() || "LATEST__signal_lineage_health__GLOBAL";
const POSITIONS_COLLECTION = String(process.env.LIVE_EXEC_POLICY_POSITIONS_COLLECTION || "positions_paper").trim() || "positions_paper";

const CACHE_TTL_MS = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_CACHE_TTL_MS);
  if (Number.isFinite(n) && n >= 1000) return n;
  return 30 * 1000;
})();

const SCALE_MIN = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_MIN);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.2;
})();

const SCALE_MAX = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_MAX);
  if (Number.isFinite(n) && n >= 1 && n <= 2) return n;
  return 1.2;
})();

const QUALITY_BLOCK_MAX_LATENCY_MS = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_QUALITY_BLOCK_MAX_LATENCY_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return 900000;
})();

const QUALITY_BLOCK_MAX_PARTIAL_PCT = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_QUALITY_BLOCK_MAX_PARTIAL_PCT);
  if (Number.isFinite(n) && n > 0) return n;
  return 95;
})();

const QUALITY_BLOCK_MAX_SLIPPAGE_BPS = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_QUALITY_BLOCK_MAX_SLIPPAGE_BPS);
  if (Number.isFinite(n) && n > 0) return n;
  return 120;
})();

const ENABLED = String(process.env.LIVE_EXEC_POLICY_ENABLED || "1").trim() !== "0";
const BINANCE_ONLY = String(process.env.LIVE_EXEC_POLICY_BINANCE_ONLY || "1").trim() !== "0";
const QUARANTINE_HARD_BLOCK = String(process.env.LIVE_EXEC_POLICY_QUARANTINE_HARD_BLOCK || "1").trim() !== "0";
const QUALITY_HARD_BLOCK = String(process.env.LIVE_EXEC_POLICY_QUALITY_HARD_BLOCK || "1").trim() !== "0";
const POLICY_PROFILE = String(process.env.LIVE_EXEC_POLICY_PROFILE || "RISK_GUARD_V2").trim() || "RISK_GUARD_V2";
const POLICY_PLAN_ENABLED = String(process.env.LIVE_EXEC_POLICY_POLICY_PLAN_ENABLED || "1").trim() !== "0";
const POLICY_PLAN_APPLY = String(process.env.LIVE_EXEC_POLICY_POLICY_PLAN_APPLY || "1").trim() === "1";
const POLICY_PLAN_WATCH_ONLY_BLOCK = String(process.env.LIVE_EXEC_POLICY_POLICY_PLAN_WATCH_ONLY_BLOCK || "1").trim() !== "0";
const POLICY_PLAN_HOLD_BLOCK = String(process.env.LIVE_EXEC_POLICY_POLICY_PLAN_HOLD_BLOCK || "1").trim() !== "0";
const OBJECTIVE_SCALE_ENABLED = String(process.env.LIVE_EXEC_POLICY_OBJECTIVE_SCALE_ENABLED || "1").trim() !== "0";
const EXEC_QUALITY_GLOBAL_GUARD_ENABLED = String(process.env.LIVE_EXEC_POLICY_EXECUTION_QUALITY_GLOBAL_GUARD_ENABLED || "1").trim() !== "0";
const LINEAGE_SLO_ENABLED = String(process.env.LIVE_EXEC_POLICY_LINEAGE_SLO_ENABLED || "1").trim() !== "0";
const LINEAGE_SLO_FAIL_CLOSED = String(process.env.LIVE_EXEC_POLICY_LINEAGE_SLO_FAIL_CLOSED || "1").trim() !== "0";
const LINEAGE_SLO_REQUIRE_FRESH = String(process.env.LIVE_EXEC_POLICY_LINEAGE_SLO_REQUIRE_FRESH || "1").trim() !== "0";
const DRIFT_REMEDIATION_ENABLED = String(process.env.LIVE_EXEC_POLICY_DRIFT_REMEDIATION_ENABLED || "1").trim() !== "0";
const DRIFT_REMEDIATION_WATCH_ONLY_BLOCK = String(process.env.LIVE_EXEC_POLICY_DRIFT_REMEDIATION_WATCH_ONLY_BLOCK || "1").trim() !== "0";
const LEARNING_EPOCH_EXCEPTION_RELEASE_ENABLED = String(process.env.LIVE_EXEC_POLICY_LEARNING_EPOCH_EXCEPTION_RELEASE_ENABLED || "1").trim() !== "0";

const ACTION_SCALE_REDUCE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_ACTION_REDUCE);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.45;
})();
const ACTION_SCALE_EXPLORE_LIGHT = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_ACTION_EXPLORE_LIGHT);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.65;
})();
const ACTION_SCALE_INCREASE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_ACTION_INCREASE);
  if (Number.isFinite(n) && n >= 1 && n <= 2) return n;
  return 1.12;
})();

const SCORE_SCALE_HIGH = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_SCORE_HIGH);
  if (Number.isFinite(n) && n > 0 && n <= 2) return n;
  return 1.1;
})();
const SCORE_SCALE_MID = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_SCORE_MID);
  if (Number.isFinite(n) && n > 0 && n <= 2) return n;
  return 1.0;
})();
const SCORE_SCALE_LOW = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_SCORE_LOW);
  if (Number.isFinite(n) && n > 0 && n <= 2) return n;
  return 0.85;
})();
const SCORE_SCALE_NEG = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_SCORE_NEG);
  if (Number.isFinite(n) && n > 0 && n <= 2) return n;
  return 0.65;
})();
const SCORE_SCALE_NEG_DEEP = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_SCORE_NEG_DEEP);
  if (Number.isFinite(n) && n > 0 && n <= 2) return n;
  return 0.45;
})();
const SCORE_SCALE_NEG_EXTREME = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_SCORE_NEG_EXTREME);
  if (Number.isFinite(n) && n > 0 && n <= 2) return n;
  return 0.3;
})();

const QUALITY_SCALE_LATENCY_HIGH = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_QUALITY_LATENCY_HIGH);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.85;
})();
const QUALITY_SCALE_LATENCY_SEVERE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_QUALITY_LATENCY_SEVERE);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.7;
})();
const QUALITY_SCALE_PARTIAL_HIGH = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_QUALITY_PARTIAL_HIGH);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.75;
})();
const QUALITY_SCALE_PARTIAL_SEVERE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_QUALITY_PARTIAL_SEVERE);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.55;
})();
const QUALITY_SCALE_SLIPPAGE_HIGH = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_SCALE_QUALITY_SLIPPAGE_HIGH);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.65;
})();

const QUALITY_GLOBAL_BLOCK_MAX_LATENCY_MS = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_QUALITY_GLOBAL_BLOCK_MAX_LATENCY_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return 600000;
})();

const QUALITY_GLOBAL_BLOCK_MAX_PARTIAL_PCT = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_QUALITY_GLOBAL_BLOCK_MAX_PARTIAL_PCT);
  if (Number.isFinite(n) && n > 0) return n;
  return 80;
})();

const QUALITY_GLOBAL_BLOCK_MAX_SLIPPAGE_BPS = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_QUALITY_GLOBAL_BLOCK_MAX_SLIPPAGE_BPS);
  if (Number.isFinite(n) && n > 0) return n;
  return 90;
})();

const LINEAGE_SLO_MAX_INTENT_SIGNAL_NULL_RATE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_LINEAGE_SLO_MAX_INTENT_SIGNAL_NULL_RATE);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0.02;
})();

const LINEAGE_SLO_MAX_FILL_SIGNAL_NULL_RATE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_LINEAGE_SLO_MAX_FILL_SIGNAL_NULL_RATE);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0.02;
})();

const LINEAGE_SLO_MAX_FILL_INTENT_NULL_RATE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_LINEAGE_SLO_MAX_FILL_INTENT_NULL_RATE);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0.02;
})();

const LINEAGE_SLO_MAX_REPORT_AGE_MS = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_LINEAGE_SLO_MAX_REPORT_AGE_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return 3 * 60 * 60 * 1000;
})();

const LINEAGE_SHARED_REFRESH_MS = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_LINEAGE_SHARED_REFRESH_MS);
  if (Number.isFinite(n) && n >= 1000) return n;
  return 30 * 1000;
})();

const PORTFOLIO_CLUSTER_ENABLED = String(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_ENABLED || "1").trim() !== "0";
const PORTFOLIO_CLUSTER_REFRESH_MS = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_REFRESH_MS);
  if (Number.isFinite(n) && n >= 1000) return n;
  return 30 * 1000;
})();
const PORTFOLIO_CLUSTER_REDUCE_SAME_SIDE_AFTER = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_REDUCE_SAME_SIDE_AFTER);
  if (Number.isFinite(n) && n >= 2) return Math.floor(n);
  return 3;
})();
const PORTFOLIO_CLUSTER_BLOCK_SAME_SIDE_AFTER = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_BLOCK_SAME_SIDE_AFTER);
  if (Number.isFinite(n) && n >= 2) return Math.floor(n);
  return 4;
})();
const PORTFOLIO_CLUSTER_REDUCE_CORRELATED_AFTER = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_REDUCE_CORRELATED_AFTER);
  if (Number.isFinite(n) && n >= 2) return Math.floor(n);
  return 3;
})();
const PORTFOLIO_CLUSTER_BLOCK_CORRELATED_AFTER = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_BLOCK_CORRELATED_AFTER);
  if (Number.isFinite(n) && n >= 2) return Math.floor(n);
  return 4;
})();
const PORTFOLIO_CLUSTER_REDUCE_SCALE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_REDUCE_SCALE);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return 0.5;
})();
const PORTFOLIO_CLUSTER_MAX_SAME_SIDE_EXPOSURE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_MAX_SAME_SIDE_EXPOSURE);
  if (Number.isFinite(n) && n > 0) return n;
  return 2.5;
})();
const PORTFOLIO_CLUSTER_MAX_CORRELATED_SAME_SIDE_EXPOSURE = (() => {
  const n = Number(process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_MAX_CORRELATED_SAME_SIDE_EXPOSURE);
  if (Number.isFinite(n) && n > 0) return n;
  return 2.0;
})();
const PORTFOLIO_CLUSTER_CORRELATED_MARKETS = normalizeUpperList(
  process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_CORRELATED_MARKETS
  || "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,AXSUSDT"
);
const PORTFOLIO_CLUSTER_BENCHMARK_MARKETS = normalizeUpperList(
  process.env.LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_BENCHMARK_MARKETS
  || "BTCUSDT"
);
const PORTFOLIO_CLUSTER_CORRELATED_SET = new Set(PORTFOLIO_CLUSTER_CORRELATED_MARKETS);
const PORTFOLIO_CLUSTER_BENCHMARK_SET = new Set(PORTFOLIO_CLUSTER_BENCHMARK_MARKETS);

let cache = {
  ts: 0,
  snapshot: null,
};

let sharedLineageCache = {
  ts: 0,
  snapshot: null,
  refreshPromise: null,
};

let activePositionsCache = {
  ts: 0,
  snapshot: null,
  refreshPromise: null,
};

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function parseDateMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }
  const s = String(value || "").trim();
  if (!s) return null;
  const kstMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*KST$/i);
  if (kstMatch) {
    const [, y, mo, d, h, mi, sec] = kstMatch;
    const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi), Number(sec));
    return Number.isFinite(utcMs) ? utcMs : null;
  }
  const isoMs = Date.parse(s);
  return Number.isFinite(isoMs) ? isoMs : null;
}

function isEntryIntent(intent) {
  const x = upper(intent);
  return x === "ENTRY" || x === "ADD";
}

function allowExchange(exchange) {
  const ex = upper(exchange);
  if (!ex) return false;
  if (!BINANCE_ONLY) return true;
  return ex.includes("BINANCE");
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function readFileMtimeMs(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return Number.isFinite(stat && stat.mtimeMs) ? Math.floor(stat.mtimeMs) : null;
  } catch (_err) {
    return null;
  }
}

function buildSharedLineageDocPath() {
  return `firestore:${LINEAGE_REPORT_LATEST_COLLECTION}/${LINEAGE_REPORT_LATEST_DOC_ID}`;
}

function unwrapRaw(value) {
  if (!value || typeof value !== "object") return value || {};
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRaw(value);
  if (raw.summary && typeof raw.summary === "object") return raw.summary;
  return raw;
}

function readRows(value, key = "by_market") {
  const raw = unwrapRaw(value);
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  if (Array.isArray(summary[key])) return summary[key];
  if (Array.isArray(raw[key])) return raw[key];
  return [];
}

function readPolicyPlanMarketRows(value) {
  const raw = unwrapRaw(value);
  if (!raw || typeof raw !== "object") return [];
  const recommendations = raw.recommendations && typeof raw.recommendations === "object" ? raw.recommendations : {};
  if (Array.isArray(recommendations.by_market)) return recommendations.by_market;
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  if (Array.isArray(summary.by_market)) return summary.by_market;
  if (Array.isArray(raw.by_market)) return raw.by_market;
  return [];
}

function normalizeUpperList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(
      value
        .map((item) => upper(item))
        .filter(Boolean)
    ));
  }
  if (typeof value === "string") {
    const s = String(value || "").trim();
    if (!s) return [];
    try {
      return normalizeUpperList(JSON.parse(s));
    } catch (_err) {
      return normalizeUpperList(s.split(","));
    }
  }
  return [];
}

function normalizePositionSide(value) {
  const x = upper(value);
  if (x === "BUY" || x === "LONG") return "LONG";
  if (x === "SELL" || x === "SHORT") return "SHORT";
  return null;
}

function deriveDesiredPositionSide({ features = null } = {}) {
  const f = features && typeof features === "object" ? features : {};
  const candidates = [
    f.position_side,
    f.direction,
    f.event,
    f.signal_event,
    f.side,
    f.signal_side,
  ];
  for (const candidate of candidates) {
    const side = normalizePositionSide(candidate);
    if (side) return side;
    const raw = upper(candidate);
    if (!raw) continue;
    if (raw.includes("SHORT")) return "SHORT";
    if (raw.includes("LONG")) return "LONG";
  }
  return null;
}

function normalizeActivePositionRow(row = null, id = null) {
  if (!row || typeof row !== "object") return null;
  const posId = String(row.pos_id || id || "").trim();
  if (posId && !posId.startsWith("POS__")) return null;
  const exchange = upper(row.exchange);
  const market = upper(row.symbol_or_pair_id || row.symbol);
  const side = normalizePositionSide(row.position_side || row.side);
  const state = upper(row.state || row.position_state);
  const sizePct = toNum(row.size_pct);
  if (!exchange || !market || !side) return null;
  if (state === "FLAT") return null;
  if (Number.isFinite(sizePct) && sizePct <= 0) return null;
  return {
    pos_id: posId || null,
    exchange,
    market,
    side,
    state: state || null,
    size_pct: sizePct,
  };
}

function buildActivePositionsSnapshot(rows = []) {
  const activePositions = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeActivePositionRow(row && row.data, row && row.id);
    if (!normalized) continue;
    activePositions.push(normalized);
  }
  return {
    activePositions,
    generatedAtMs: Date.now(),
  };
}

function maybeRefreshActivePositionsSnapshot(now = Date.now()) {
  if (!PORTFOLIO_CLUSTER_ENABLED) return;
  if (activePositionsCache.refreshPromise) return;
  if (activePositionsCache.ts && (now - activePositionsCache.ts) < PORTFOLIO_CLUSTER_REFRESH_MS) return;
  activePositionsCache.refreshPromise = Promise.resolve()
    .then(async () => {
      const db = getFirestore();
      const snap = await db.collection(POSITIONS_COLLECTION).get();
      const rows = [];
      snap.forEach((doc) => {
        rows.push({ id: doc.id, data: doc.data() || {} });
      });
      activePositionsCache = {
        ts: Date.now(),
        snapshot: buildActivePositionsSnapshot(rows),
        refreshPromise: null,
      };
    })
    .catch(() => {
      activePositionsCache = {
        ts: Date.now(),
        snapshot: activePositionsCache.snapshot || null,
        refreshPromise: null,
      };
    });
}

function isCorrelatedClusterPair(currentMarket, otherMarket) {
  const a = upper(currentMarket);
  const b = upper(otherMarket);
  if (!a || !b) return false;
  if (a === b) return true;
  return PORTFOLIO_CLUSTER_CORRELATED_SET.has(a) && PORTFOLIO_CLUSTER_CORRELATED_SET.has(b);
}

function derivePortfolioClusterGuard({
  snapshot = null,
  exchange = null,
  market = null,
  desiredSide = null,
  qtyPct = null,
} = {}) {
  const ex = upper(exchange);
  const mk = upper(market);
  const side = normalizePositionSide(desiredSide);
  const positionsSnapshot = snapshot && snapshot.activePositionsSnapshot && typeof snapshot.activePositionsSnapshot === "object"
    ? snapshot.activePositionsSnapshot
    : null;
  const activePositions = Array.isArray(positionsSnapshot && positionsSnapshot.activePositions)
    ? positionsSnapshot.activePositions
    : [];
  const snapshotAvailable = activePositions.length > 0;
  if (!PORTFOLIO_CLUSTER_ENABLED || !ex || !mk || !side) {
    return {
      enabled: PORTFOLIO_CLUSTER_ENABLED,
      snapshotAvailable,
      blocked: false,
      reduce: false,
      scale: 1,
      desiredSide: side,
      sameSideAfter: null,
      correlatedSameSideAfter: null,
      altSameSideAfter: null,
    };
  }
  const sameExchangePositions = activePositions.filter((row) => row.exchange === ex && row.market !== mk);
  const sameSidePositions = sameExchangePositions.filter((row) => row.side === side);
  const correlatedSameSidePositions = sameSidePositions.filter((row) => isCorrelatedClusterPair(mk, row.market));
  const altSameSidePositions = correlatedSameSidePositions.filter((row) => !PORTFOLIO_CLUSTER_BENCHMARK_SET.has(row.market));
  const sameSideExposure = sameSidePositions.reduce((sum, row) => sum + (toNum(row.size_pct) || 1), 0);
  const correlatedSameSideExposure = correlatedSameSidePositions.reduce((sum, row) => sum + (toNum(row.size_pct) || 1), 0);
  const incomingExposure = Number.isFinite(toNum(qtyPct)) && Number(qtyPct) > 0 ? Number(qtyPct) : 1;
  const selfCorrelated = PORTFOLIO_CLUSTER_CORRELATED_SET.has(mk);
  const selfAlt = selfCorrelated && !PORTFOLIO_CLUSTER_BENCHMARK_SET.has(mk);
  const sameSideAfter = sameSidePositions.length + 1;
  const correlatedSameSideAfter = correlatedSameSidePositions.length + (selfCorrelated ? 1 : 0);
  const altSameSideAfter = altSameSidePositions.length + (selfAlt ? 1 : 0);
  const sameSideExposureAfter = sameSideExposure + incomingExposure;
  const correlatedSameSideExposureAfter = correlatedSameSideExposure + (selfCorrelated ? incomingExposure : 0);
  const exceedsSameSideExposureCap = sameSideExposureAfter > PORTFOLIO_CLUSTER_MAX_SAME_SIDE_EXPOSURE;
  const exceedsCorrelatedExposureCap = correlatedSameSideExposureAfter > PORTFOLIO_CLUSTER_MAX_CORRELATED_SAME_SIDE_EXPOSURE;
  const blocked = sameSideAfter >= PORTFOLIO_CLUSTER_BLOCK_SAME_SIDE_AFTER
    || correlatedSameSideAfter >= PORTFOLIO_CLUSTER_BLOCK_CORRELATED_AFTER
    || (exceedsSameSideExposureCap && sameSideExposure >= PORTFOLIO_CLUSTER_MAX_SAME_SIDE_EXPOSURE)
    || (exceedsCorrelatedExposureCap && correlatedSameSideExposure >= PORTFOLIO_CLUSTER_MAX_CORRELATED_SAME_SIDE_EXPOSURE);
  const sameSideCapScale = exceedsSameSideExposureCap
    ? clamp((PORTFOLIO_CLUSTER_MAX_SAME_SIDE_EXPOSURE - sameSideExposure) / Math.max(incomingExposure, 1e-9), 0, 1)
    : 1;
  const correlatedCapScale = exceedsCorrelatedExposureCap
    ? clamp((PORTFOLIO_CLUSTER_MAX_CORRELATED_SAME_SIDE_EXPOSURE - correlatedSameSideExposure) / Math.max(selfCorrelated ? incomingExposure : 1, 1e-9), 0, 1)
    : 1;
  const capScale = Math.min(sameSideCapScale, correlatedCapScale);
  const reduce = !blocked && (
    sameSideAfter >= PORTFOLIO_CLUSTER_REDUCE_SAME_SIDE_AFTER
    || correlatedSameSideAfter >= PORTFOLIO_CLUSTER_REDUCE_CORRELATED_AFTER
    || exceedsSameSideExposureCap
    || exceedsCorrelatedExposureCap
  );
  let reason = null;
  if (blocked && (exceedsSameSideExposureCap || exceedsCorrelatedExposureCap)) reason = "LIVE_POLICY_PORTFOLIO_CLUSTER_CAP_BLOCK";
  else if (blocked) reason = "LIVE_POLICY_PORTFOLIO_CLUSTER_BLOCK";
  else if (reduce && (exceedsSameSideExposureCap || exceedsCorrelatedExposureCap)) reason = "LIVE_POLICY_PORTFOLIO_CLUSTER_CAP_REDUCE";
  else if (reduce) reason = "LIVE_POLICY_PORTFOLIO_CLUSTER_REDUCE";
  return {
    enabled: PORTFOLIO_CLUSTER_ENABLED,
    snapshotAvailable,
    blocked,
    reduce,
    reason,
    scale: reduce ? Math.min(PORTFOLIO_CLUSTER_REDUCE_SCALE, capScale) : 1,
    desiredSide: side,
    sameSideAfter,
    correlatedSameSideAfter,
    altSameSideAfter,
    sameSideExposureAfter,
    correlatedSameSideExposureAfter,
    activeSameSideMarkets: sameSidePositions.map((row) => row.market),
    activeCorrelatedSameSideMarkets: correlatedSameSidePositions.map((row) => row.market),
    activeAltSameSideMarkets: altSameSidePositions.map((row) => row.market),
  };
}

function extractOtherServerPolicyWatchOnlyMarkets(doc = null) {
  const raw = unwrapRaw(doc);
  if (!raw || typeof raw !== "object") return [];
  const effective = raw.effective && typeof raw.effective === "object" ? raw.effective : {};
  const changes = raw.changes && typeof raw.changes === "object" ? raw.changes : {};
  const other = changes.other_server_policy_watch_only_markets && typeof changes.other_server_policy_watch_only_markets === "object"
    ? changes.other_server_policy_watch_only_markets
    : {};
  const fromEffective = normalizeUpperList(effective.other_server_policy_watch_only_markets);
  if (fromEffective.length > 0) return fromEffective;
  if (raw.applied === true) {
    const fromNext = normalizeUpperList(other.next);
    if (fromNext.length > 0) return fromNext;
  }
  return normalizeUpperList(other.current);
}

function extractOtherServerPolicyWatchOnlyMarketsByReason(doc = null) {
  const raw = unwrapRaw(doc);
  if (!raw || typeof raw !== "object") return {};
  const effective = raw.effective && typeof raw.effective === "object" ? raw.effective : {};
  const changes = raw.changes && typeof raw.changes === "object" ? raw.changes : {};
  const byReason = changes.other_server_policy_watch_only_markets_by_reason && typeof changes.other_server_policy_watch_only_markets_by_reason === "object"
    ? changes.other_server_policy_watch_only_markets_by_reason
    : {};
  const current = byReason.current && typeof byReason.current === "object" ? byReason.current : {};
  const next = byReason.next && typeof byReason.next === "object" ? byReason.next : {};
  const selected = effective.other_server_policy_watch_only_markets_by_reason && typeof effective.other_server_policy_watch_only_markets_by_reason === "object"
    ? effective.other_server_policy_watch_only_markets_by_reason
    : (raw.applied === true ? next : current);
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) return {};
  const out = {};
  for (const [reason, markets] of Object.entries(selected)) {
    const key = upper(reason);
    const rows = normalizeUpperList(markets);
    if (!key || rows.length <= 0) continue;
    out[key] = rows;
  }
  return out;
}

function buildSnapshotFromArtifacts({
  allocatorDoc = null,
  quarantineDoc = null,
  executionQualityDoc = null,
  policyParameterPlanDoc = null,
  objectiveSupervisorDoc = null,
  lineageHealthDoc = null,
  lineageHealthMtimeMs = null,
  lineageHealthPath = null,
  lineageHealthSource = null,
  lineageSharedRefreshPending = false,
  lineageSharedSnapshotAvailable = false,
  driftRemediationApplyDoc = null,
} = {}) {
  const allocatorSummary = readSummary(allocatorDoc);
  const quarantineSummary = readSummary(quarantineDoc);
  const qualitySummary = readSummary(executionQualityDoc);
  const policyPlanSummary = readSummary(policyParameterPlanDoc);
  const objectiveSummary = readSummary(objectiveSupervisorDoc);
  const lineageSummary = readSummary(lineageHealthDoc);

  const allocatorRows = readRows(allocatorDoc, "by_market");
  const quarantineRows = readRows(quarantineDoc, "by_market");
  const qualityRows = readRows(executionQualityDoc, "by_market");
  const policyPlanRows = readPolicyPlanMarketRows(policyParameterPlanDoc);
  const driftOtherServerPolicyWatchOnlyMarkets = extractOtherServerPolicyWatchOnlyMarkets(driftRemediationApplyDoc);
  const driftOtherServerPolicyWatchOnlyByReason = extractOtherServerPolicyWatchOnlyMarketsByReason(driftRemediationApplyDoc);
  const driftOtherServerPolicyReasonByMarket = new Map();
  for (const [reason, markets] of Object.entries(driftOtherServerPolicyWatchOnlyByReason)) {
    for (const market of markets) {
      if (!market) continue;
      if (!driftOtherServerPolicyReasonByMarket.has(market)) driftOtherServerPolicyReasonByMarket.set(market, []);
      driftOtherServerPolicyReasonByMarket.get(market).push(reason);
    }
  }

  const allocatorByMarket = new Map();
  for (const row of allocatorRows) {
    const market = upper(row && row.market);
    if (!market) continue;
    allocatorByMarket.set(market, row);
  }

  const quarantineByMarket = new Map();
  for (const row of quarantineRows) {
    const market = upper(row && row.market);
    if (!market) continue;
    quarantineByMarket.set(market, row);
  }

  const qualityByMarket = new Map();
  for (const row of qualityRows) {
    const market = upper(row && row.market);
    if (!market) continue;
    qualityByMarket.set(market, row);
  }

  const policyPlanByMarket = new Map();
  for (const row of policyPlanRows) {
    const market = upper(row && row.market);
    if (!market) continue;
    policyPlanByMarket.set(market, row);
  }

  const lineageGeneratedAtParsedMs = parseDateMs(
    (lineageHealthDoc && (lineageHealthDoc.generated_at || lineageHealthDoc.generated_at_kst))
    || lineageSummary.generated_at
    || lineageSummary.generated_at_kst
    || null
  );

  return {
    allocator: allocatorSummary,
    quarantine: quarantineSummary,
    quality: qualitySummary,
    policyPlan: policyPlanSummary,
    objective: objectiveSummary,
    lineage: lineageSummary,
    lineageGeneratedAtKst:
      String(
        (lineageHealthDoc && (lineageHealthDoc.generated_at_kst || lineageHealthDoc.generated_at))
        || lineageSummary.generated_at_kst
        || lineageSummary.generated_at
        || ""
      ).trim() || null,
    lineageGeneratedAtMs: lineageGeneratedAtParsedMs || toNum(lineageHealthMtimeMs),
    lineageGeneratedAtSource: String(lineageHealthSource || "").trim() || (lineageGeneratedAtParsedMs != null
      ? "ARTIFACT_TIMESTAMP"
      : (Number.isFinite(toNum(lineageHealthMtimeMs)) ? "FILE_MTIME" : null)),
    lineageReportPath: String(lineageHealthPath || "").trim() || SIGNAL_LINEAGE_HEALTH_PATH,
    lineageSharedRefreshPending: lineageSharedRefreshPending === true,
    lineageSharedSnapshotAvailable: lineageSharedSnapshotAvailable === true,
    allocatorByMarket,
    quarantineByMarket,
    qualityByMarket,
    policyPlanByMarket,
    driftOtherServerPolicyWatchOnlyMarkets,
    driftOtherServerPolicyWatchOnlySet: new Set(driftOtherServerPolicyWatchOnlyMarkets),
    driftOtherServerPolicyWatchOnlyByReason,
    driftOtherServerPolicyReasonByMarket,
  };
}

function normalizeSharedLineageSnapshot(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const report = raw.report && typeof raw.report === "object" ? raw.report : raw;
  if (!report || typeof report !== "object") return null;
  return {
    doc: report,
    path: buildSharedLineageDocPath(),
    source: "FIRESTORE_REPORT_LATEST",
    generatedAtMs: parseDateMs(
      report.generated_at
      || report.generated_at_kst
      || raw.generated_at
      || raw.generated_at_kst
      || raw.updated_at
      || null
    ),
  };
}

function maybeRefreshSharedLineageSnapshot(now = Date.now()) {
  if (!LINEAGE_SLO_ENABLED) return;
  if (sharedLineageCache.refreshPromise) return;
  if (sharedLineageCache.ts && (now - sharedLineageCache.ts) < LINEAGE_SHARED_REFRESH_MS) return;
  sharedLineageCache.refreshPromise = Promise.resolve()
    .then(async () => {
      const db = getFirestore();
      const snap = await db.collection(LINEAGE_REPORT_LATEST_COLLECTION).doc(LINEAGE_REPORT_LATEST_DOC_ID).get();
      sharedLineageCache = {
        ts: Date.now(),
        snapshot: snap.exists ? normalizeSharedLineageSnapshot(snap.data() || {}) : null,
        refreshPromise: null,
      };
    })
    .catch(() => {
      sharedLineageCache = {
        ts: Date.now(),
        snapshot: sharedLineageCache.snapshot || null,
        refreshPromise: null,
      };
    });
}

function selectPreferredLineageInput({
  localDoc = null,
  localMtimeMs = null,
  sharedSnapshot = null,
} = {}) {
  const localGeneratedAtMs = parseDateMs(
    (localDoc && (localDoc.generated_at || localDoc.generated_at_kst))
    || null
  ) || toNum(localMtimeMs);
  const sharedGeneratedAtMs = toNum(sharedSnapshot && sharedSnapshot.generatedAtMs);
  const useShared = !!(sharedSnapshot
    && sharedSnapshot.doc
    && (!Number.isFinite(localGeneratedAtMs) || (Number.isFinite(sharedGeneratedAtMs) && sharedGeneratedAtMs > localGeneratedAtMs)));
  if (useShared) {
    return {
      doc: sharedSnapshot.doc,
      mtimeMs: null,
      path: sharedSnapshot.path,
      source: sharedSnapshot.source,
    };
  }
  return {
    doc: localDoc,
    mtimeMs: localMtimeMs,
    path: SIGNAL_LINEAGE_HEALTH_PATH,
    source: null,
  };
}

function loadPolicySnapshot({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.snapshot && (now - cache.ts) < CACHE_TTL_MS) {
    return cache.snapshot;
  }
  maybeRefreshSharedLineageSnapshot(now);
  maybeRefreshActivePositionsSnapshot(now);
  const allocatorDoc = readJsonSafe(CAPITAL_ALLOCATOR_PATH, null);
  const quarantineDoc = readJsonSafe(QUARANTINE_PATH, null);
  const executionQualityDoc = readJsonSafe(EXECUTION_QUALITY_PATH, null);
  const policyParameterPlanDoc = POLICY_PLAN_ENABLED ? readJsonSafe(POLICY_PARAMETER_PLAN_PATH, null) : null;
  const objectiveSupervisorDoc = OBJECTIVE_SCALE_ENABLED ? readJsonSafe(OBJECTIVE_SUPERVISOR_PATH, null) : null;
  const localLineageHealthDoc = LINEAGE_SLO_ENABLED ? readJsonSafe(SIGNAL_LINEAGE_HEALTH_PATH, null) : null;
  const localLineageHealthMtimeMs = LINEAGE_SLO_ENABLED ? readFileMtimeMs(SIGNAL_LINEAGE_HEALTH_PATH) : null;
  const selectedLineageInput = selectPreferredLineageInput({
    localDoc: localLineageHealthDoc,
    localMtimeMs: localLineageHealthMtimeMs,
    sharedSnapshot: sharedLineageCache.snapshot,
  });
  const driftRemediationApplyDoc = DRIFT_REMEDIATION_ENABLED ? readJsonSafe(DRIFT_REMEDIATION_APPLY_PATH, null) : null;
  const snapshot = buildSnapshotFromArtifacts({
    allocatorDoc,
    quarantineDoc,
    executionQualityDoc,
    policyParameterPlanDoc,
    objectiveSupervisorDoc,
    lineageHealthDoc: selectedLineageInput.doc,
    lineageHealthMtimeMs: selectedLineageInput.mtimeMs,
    lineageHealthPath: selectedLineageInput.path,
    lineageHealthSource: selectedLineageInput.source,
    lineageSharedRefreshPending: !sharedLineageCache.snapshot && !!sharedLineageCache.refreshPromise,
    lineageSharedSnapshotAvailable: !!sharedLineageCache.snapshot,
    driftRemediationApplyDoc,
  });
  snapshot.activePositionsSnapshot = activePositionsCache.snapshot || null;
  cache = { ts: now, snapshot };
  return snapshot;
}

function deriveAllocatorActionScale(recommendedAction) {
  const action = upper(recommendedAction);
  if (action === "QUARANTINE") return 0;
  if (action === "REDUCE") return ACTION_SCALE_REDUCE;
  if (action === "EXPLORE_LIGHT") return ACTION_SCALE_EXPLORE_LIGHT;
  if (action === "INCREASE") return ACTION_SCALE_INCREASE;
  return 1.0;
}

function deriveAllocatorScoreScale(allocationScore) {
  const score = toNum(allocationScore);
  if (!Number.isFinite(score)) return 1.0;
  if (score >= 4) return SCORE_SCALE_HIGH;
  if (score >= 2) return SCORE_SCALE_MID;
  if (score >= 0) return SCORE_SCALE_LOW;
  if (score >= -2) return SCORE_SCALE_NEG;
  if (score >= -4) return SCORE_SCALE_NEG_DEEP;
  return SCORE_SCALE_NEG_EXTREME;
}

function deriveQualityScale(row = null) {
  const latency = toNum(row && row.avg_created_to_fill_ms);
  const partial = toNum(row && row.partial_fill_rate_pct);
  const slippage = toNum(row && row.avg_slippage_bps);

  let scale = 1.0;
  if (Number.isFinite(latency) && latency >= 600000) scale = Math.min(scale, QUALITY_SCALE_LATENCY_SEVERE);
  else if (Number.isFinite(latency) && latency >= 300000) scale = Math.min(scale, QUALITY_SCALE_LATENCY_HIGH);

  if (Number.isFinite(partial) && partial >= 80) scale = Math.min(scale, QUALITY_SCALE_PARTIAL_SEVERE);
  else if (Number.isFinite(partial) && partial >= 65) scale = Math.min(scale, QUALITY_SCALE_PARTIAL_HIGH);

  if (Number.isFinite(slippage) && slippage >= 80) scale = Math.min(scale, QUALITY_SCALE_SLIPPAGE_HIGH);

  return clamp(scale, SCALE_MIN, SCALE_MAX);
}

function deriveQualityHardBlock(row = null) {
  const latency = toNum(row && row.avg_created_to_fill_ms);
  const partial = toNum(row && row.partial_fill_rate_pct);
  const slippage = toNum(row && row.avg_slippage_bps);
  if (Number.isFinite(latency) && latency >= QUALITY_BLOCK_MAX_LATENCY_MS) {
    return { blocked: true, reason: "EXECUTION_QUALITY_LATENCY_HARD_BLOCK" };
  }
  if (Number.isFinite(partial) && partial >= QUALITY_BLOCK_MAX_PARTIAL_PCT) {
    return { blocked: true, reason: "EXECUTION_QUALITY_PARTIAL_HARD_BLOCK" };
  }
  if (Number.isFinite(slippage) && slippage >= QUALITY_BLOCK_MAX_SLIPPAGE_BPS) {
    return { blocked: true, reason: "EXECUTION_QUALITY_SLIPPAGE_HARD_BLOCK" };
  }
  return { blocked: false, reason: null };
}

function deriveGlobalQualityHardBlock(summary = null, market = null) {
  const status = upper(summary && summary.status);
  const latency = toNum(summary && summary.created_to_fill_p95_ms);
  const partial = toNum(summary && summary.partial_fill_rate_pct);
  const slippage = toNum(summary && summary.adverse_slippage_p95_bps);
  if (!EXEC_QUALITY_GLOBAL_GUARD_ENABLED) return { blocked: false, reason: null };
  if (status !== "EXECUTION_QUALITY_REVIEW" && status !== "EXECUTION_QUALITY_FAIL") {
    return { blocked: false, reason: null };
  }

  if (Number.isFinite(latency) && latency >= QUALITY_GLOBAL_BLOCK_MAX_LATENCY_MS) {
    return { blocked: true, reason: "EXECUTION_QUALITY_GLOBAL_LATENCY_HARD_BLOCK" };
  }
  if (Number.isFinite(partial) && partial >= QUALITY_GLOBAL_BLOCK_MAX_PARTIAL_PCT) {
    return { blocked: true, reason: "EXECUTION_QUALITY_GLOBAL_PARTIAL_HARD_BLOCK" };
  }
  if (Number.isFinite(slippage) && slippage >= QUALITY_GLOBAL_BLOCK_MAX_SLIPPAGE_BPS) {
    return { blocked: true, reason: "EXECUTION_QUALITY_GLOBAL_SLIPPAGE_HARD_BLOCK" };
  }

  const topWatch = Array.isArray(summary && summary.top_watch_markets) ? summary.top_watch_markets : [];
  const mk = upper(market);
  if (mk && topWatch.some((row) => upper(row && row.market) === mk) && status === "EXECUTION_QUALITY_FAIL") {
    return { blocked: true, reason: "EXECUTION_QUALITY_GLOBAL_TOP_WATCH_HARD_BLOCK" };
  }
  return { blocked: false, reason: null };
}

function deriveObjectiveScale(summary = null) {
  if (!OBJECTIVE_SCALE_ENABLED) {
    return { scale: 1, verdict: null, objectiveScore: null, constrained: false };
  }
  const verdict = upper(summary && (summary.objective_verdict || summary.verdict || summary.status));
  const objectiveScore = toNum(summary && (summary.objective_score || summary.current_objective_score));
  const countFloorPass = summary && typeof summary.count_floor_pass === "boolean" ? summary.count_floor_pass : null;
  const replacementFloorPass = summary && typeof summary.replacement_floor_pass === "boolean" ? summary.replacement_floor_pass : null;
  const latencyBudgetPass = summary && typeof summary.latency_budget_pass === "boolean" ? summary.latency_budget_pass : null;
  let scale = 1.0;
  if (Number.isFinite(objectiveScore)) {
    if (objectiveScore <= -12) scale = Math.min(scale, 0.45);
    else if (objectiveScore <= -8) scale = Math.min(scale, 0.6);
    else if (objectiveScore <= -4) scale = Math.min(scale, 0.75);
    else if (objectiveScore < 0) scale = Math.min(scale, 0.9);
    else if (objectiveScore >= 4) scale = Math.max(scale, 1.05);
  }
  if (verdict === "HOLD") scale = Math.min(scale, 0.8);
  if (countFloorPass === false) scale = Math.min(scale, 0.7);
  if (replacementFloorPass === false) scale = Math.min(scale, 0.7);
  if (latencyBudgetPass === false) scale = Math.min(scale, 0.75);
  return {
    scale: clamp(scale, SCALE_MIN, SCALE_MAX),
    verdict,
    objectiveScore,
    constrained: (countFloorPass === false || replacementFloorPass === false || latencyBudgetPass === false),
    countFloorPass,
    replacementFloorPass,
    latencyBudgetPass,
  };
}

function deriveGlobalExecutionQualityScale(summary = null) {
  const status = upper(summary && summary.status);
  const latency = toNum(summary && summary.created_to_fill_p95_ms);
  const partial = toNum(summary && summary.partial_fill_rate_pct);
  const slippage = toNum(summary && summary.adverse_slippage_p95_bps);
  let scale = 1.0;
  if (status === "EXECUTION_QUALITY_REVIEW") scale = Math.min(scale, 0.9);
  if (status === "EXECUTION_QUALITY_FAIL") scale = Math.min(scale, 0.75);
  if (Number.isFinite(latency) && latency >= 600000) scale = Math.min(scale, 0.85);
  if (Number.isFinite(partial) && partial >= 70) scale = Math.min(scale, 0.82);
  if (Number.isFinite(slippage) && slippage >= 70) scale = Math.min(scale, 0.82);
  return clamp(scale, SCALE_MIN, SCALE_MAX);
}

function deriveLineageSloBlock(snapshot = null) {
  if (!LINEAGE_SLO_ENABLED) return { blocked: false, reason: null, stale: false };
  const summary = snapshot && snapshot.lineage && typeof snapshot.lineage === "object" ? snapshot.lineage : {};
  const reportMs = toNum(snapshot && snapshot.lineageGeneratedAtMs);
  const reportGeneratedAtKst = String(snapshot && snapshot.lineageGeneratedAtKst || "").trim() || null;
  const reportPath = String(snapshot && snapshot.lineageReportPath || "").trim() || null;
  const reportSource = String(snapshot && snapshot.lineageGeneratedAtSource || "").trim() || null;
  const sharedRefreshPending = snapshot && snapshot.lineageSharedRefreshPending === true;
  const sharedSnapshotAvailable = snapshot && snapshot.lineageSharedSnapshotAvailable === true;
  const nowMs = Date.now();
  const reportAgeMs = Number.isFinite(reportMs) ? Math.max(0, nowMs - reportMs) : null;
  if (LINEAGE_SLO_REQUIRE_FRESH) {
    if (!Number.isFinite(reportMs)) {
      return {
        blocked: LINEAGE_SLO_FAIL_CLOSED,
        reason: "LINEAGE_SLO_REPORT_MISSING",
        stale: false,
        report_generated_at_kst: reportGeneratedAtKst,
        report_age_ms: reportAgeMs,
        report_path: reportPath,
        report_source: reportSource,
        report_missing: true,
        max_report_age_ms: LINEAGE_SLO_MAX_REPORT_AGE_MS,
      };
    }
    const fresh = Number.isFinite(reportMs) && reportAgeMs <= LINEAGE_SLO_MAX_REPORT_AGE_MS;
    if (!fresh) {
      if (!sharedSnapshotAvailable && sharedRefreshPending && reportSource !== "FIRESTORE_REPORT_LATEST") {
        return {
          blocked: false,
          reason: "LINEAGE_SLO_SHARED_REFRESH_PENDING",
          stale: true,
          shared_refresh_pending: true,
          report_generated_at_kst: reportGeneratedAtKst,
          report_age_ms: reportAgeMs,
          report_path: reportPath,
          report_source: reportSource,
          report_missing: false,
          max_report_age_ms: LINEAGE_SLO_MAX_REPORT_AGE_MS,
        };
      }
      return {
        blocked: LINEAGE_SLO_FAIL_CLOSED,
        reason: "LINEAGE_SLO_REPORT_STALE",
        stale: true,
        shared_refresh_pending: false,
        report_generated_at_kst: reportGeneratedAtKst,
        report_age_ms: reportAgeMs,
        report_path: reportPath,
        report_source: reportSource,
        report_missing: false,
        max_report_age_ms: LINEAGE_SLO_MAX_REPORT_AGE_MS,
      };
    }
  }
  const intentSignalNull = toNum(summary.intents_signal_doc_id_null_rate);
  const fillSignalNull = toNum(summary.fills_signal_doc_id_null_rate);
  const fillIntentNull = toNum(
    summary.entry_fills_intent_id_null_rate != null
      ? summary.entry_fills_intent_id_null_rate
      : summary.fills_intent_id_null_rate
  );
  if (Number.isFinite(intentSignalNull) && intentSignalNull > LINEAGE_SLO_MAX_INTENT_SIGNAL_NULL_RATE) {
    return { blocked: LINEAGE_SLO_FAIL_CLOSED, reason: "LINEAGE_SLO_INTENT_SIGNAL_NULL_RATE", stale: false };
  }
  if (Number.isFinite(fillSignalNull) && fillSignalNull > LINEAGE_SLO_MAX_FILL_SIGNAL_NULL_RATE) {
    return { blocked: LINEAGE_SLO_FAIL_CLOSED, reason: "LINEAGE_SLO_FILL_SIGNAL_NULL_RATE", stale: false };
  }
  if (Number.isFinite(fillIntentNull) && fillIntentNull > LINEAGE_SLO_MAX_FILL_INTENT_NULL_RATE) {
    return { blocked: LINEAGE_SLO_FAIL_CLOSED, reason: "LINEAGE_SLO_FILL_INTENT_NULL_RATE", stale: false };
  }
  return { blocked: false, reason: null, stale: false };
}

function deriveLearningEpochRelease(snapshot = null) {
  const quarantineSummary = snapshot && snapshot.quarantine && typeof snapshot.quarantine === "object" ? snapshot.quarantine : {};
  const allocatorSummary = snapshot && snapshot.allocator && typeof snapshot.allocator === "object" ? snapshot.allocator : {};
  const learningEpochActive = quarantineSummary.learning_epoch_active === true || allocatorSummary.learning_epoch_active === true;
  return {
    active: LEARNING_EPOCH_EXCEPTION_RELEASE_ENABLED && learningEpochActive,
    learning_epoch_active: learningEpochActive,
  };
}

function evaluateLiveEntryPolicy({
  exchange,
  symbol,
  intent,
  qtyPct,
  features = null,
  stage = "UNKNOWN",
  applyScale = true,
  applyPolicyPlan = POLICY_PLAN_APPLY,
  snapshotOverride = null,
} = {}) {
  const market = upper(symbol);
  const ex = upper(exchange);
  const qty = toNum(qtyPct);
  const baseFeatures = features && typeof features === "object" ? { ...features } : {};

  if (!ENABLED) {
    return {
      ok: true,
      qtyPctFinal: qty,
      reason: "LIVE_EXEC_POLICY_DISABLED",
      featuresPatch: {},
      policy: { stage, market, exchange: ex, enabled: false },
    };
  }
  if (!allowExchange(ex) || !isEntryIntent(intent) || !market || !Number.isFinite(qty) || qty <= 0) {
    return {
      ok: true,
      qtyPctFinal: qty,
      reason: "LIVE_EXEC_POLICY_SKIPPED",
      featuresPatch: {},
      policy: { stage, market, exchange: ex, skipped: true },
    };
  }

  const snapshot = snapshotOverride || loadPolicySnapshot();
  const allocatorRow = snapshot && snapshot.allocatorByMarket ? snapshot.allocatorByMarket.get(market) : null;
  const quarantineRow = snapshot && snapshot.quarantineByMarket ? snapshot.quarantineByMarket.get(market) : null;
  const qualityRow = snapshot && snapshot.qualityByMarket ? snapshot.qualityByMarket.get(market) : null;
  const qualitySummary = snapshot && snapshot.quality && typeof snapshot.quality === "object" ? snapshot.quality : {};
  const objectiveSummary = snapshot && snapshot.objective && typeof snapshot.objective === "object" ? snapshot.objective : {};
  const policyPlanSummary = snapshot && snapshot.policyPlan && typeof snapshot.policyPlan === "object" ? snapshot.policyPlan : {};
  const policyPlanRow = snapshot && snapshot.policyPlanByMarket ? snapshot.policyPlanByMarket.get(market) : null;

  const action = upper(allocatorRow && allocatorRow.recommended_action);
  const allocationScore = toNum(allocatorRow && allocatorRow.allocation_score);
  const quarantineReason = upper((quarantineRow && (quarantineRow.quarantine_reason || (Array.isArray(quarantineRow.quarantine_reasons) ? quarantineRow.quarantine_reasons[0] : null))) || null);
  const policyPlanGlobalScale = toNum(policyPlanSummary.global_qty_scale);
  const policyPlanMarketScale = toNum(policyPlanRow && policyPlanRow.qty_scale);
  const policyPlanMarketMode = upper(policyPlanRow && policyPlanRow.mode);
  const policyPlanStatus = upper(policyPlanSummary.status);
  const objectiveScale = deriveObjectiveScale(objectiveSummary);
  const qualityGlobalScale = deriveGlobalExecutionQualityScale(qualitySummary);

  const qualityHard = deriveQualityHardBlock(qualityRow);
  const qualityGlobalHard = deriveGlobalQualityHardBlock(qualitySummary, market);
  const lineageSlo = deriveLineageSloBlock(snapshot);
  const learningEpochRelease = deriveLearningEpochRelease(snapshot);
  const desiredSide = deriveDesiredPositionSide({ features: baseFeatures });
  const portfolioCluster = derivePortfolioClusterGuard({
    snapshot,
    exchange: ex,
    market,
    desiredSide,
    qtyPct: qty,
  });
  const otherServerPolicyWatchOnlyBlocked = DRIFT_REMEDIATION_ENABLED
    && DRIFT_REMEDIATION_WATCH_ONLY_BLOCK
    && !learningEpochRelease.active
    && !!(snapshot && snapshot.driftOtherServerPolicyWatchOnlySet && snapshot.driftOtherServerPolicyWatchOnlySet.has(market));
  const quarantineBlocked = QUARANTINE_HARD_BLOCK && !learningEpochRelease.active && !!(quarantineRow || action === "QUARANTINE");
  const qualityBlocked = QUALITY_HARD_BLOCK && qualityHard.blocked;
  const qualityGlobalBlocked = QUALITY_HARD_BLOCK && qualityGlobalHard.blocked;
  const policyPlanWatchOnlyBlocked = applyPolicyPlan
    && POLICY_PLAN_WATCH_ONLY_BLOCK
    && !learningEpochRelease.active
    && policyPlanMarketMode === "WATCH_ONLY";
  const policyPlanHoldBlocked = applyPolicyPlan
    && POLICY_PLAN_HOLD_BLOCK
    && !learningEpochRelease.active
    && policyPlanStatus === "HOLD"
    && (policyPlanMarketMode === "WATCH_ONLY" || (Number.isFinite(policyPlanMarketScale) && policyPlanMarketScale <= 0));

  const commonTracePatch = {
    ...baseFeatures,
    _live_exec_policy_stage: stage,
    _live_exec_policy_market: market,
    _live_exec_policy_action: action || null,
    _live_exec_policy_allocation_score: allocationScore,
    _live_exec_policy_quarantine_reason: quarantineReason || null,
    _live_exec_policy_quality_latency_ms: toNum(qualityRow && qualityRow.avg_created_to_fill_ms),
    _live_exec_policy_quality_partial_pct: toNum(qualityRow && qualityRow.partial_fill_rate_pct),
    _live_exec_policy_quality_slippage_bps: toNum(qualityRow && qualityRow.avg_slippage_bps),
    _live_exec_policy_quality_global_status: upper(qualitySummary.status),
    _live_exec_policy_quality_global_latency_p95_ms: toNum(qualitySummary.created_to_fill_p95_ms),
    _live_exec_policy_quality_global_partial_pct: toNum(qualitySummary.partial_fill_rate_pct),
    _live_exec_policy_quality_global_slippage_p95_bps: toNum(qualitySummary.adverse_slippage_p95_bps),
    _live_exec_policy_lineage_slo_enabled: LINEAGE_SLO_ENABLED,
    _live_exec_policy_lineage_slo_fail_closed: LINEAGE_SLO_FAIL_CLOSED,
    _live_exec_policy_lineage_report_generated_at_kst: String(lineageSlo.report_generated_at_kst || snapshot && snapshot.lineageGeneratedAtKst || "").trim() || null,
    _live_exec_policy_lineage_report_age_ms: toNum(lineageSlo.report_age_ms),
    _live_exec_policy_lineage_report_path: String(lineageSlo.report_path || snapshot && snapshot.lineageReportPath || "").trim() || null,
    _live_exec_policy_lineage_report_source: String(lineageSlo.report_source || snapshot && snapshot.lineageGeneratedAtSource || "").trim() || null,
    _live_exec_policy_lineage_report_missing: lineageSlo.report_missing === true,
    _live_exec_policy_lineage_shared_refresh_pending: lineageSlo.shared_refresh_pending === true,
    _live_exec_policy_lineage_slo_max_report_age_ms: LINEAGE_SLO_MAX_REPORT_AGE_MS,
    _live_exec_policy_drift_remediation_enabled: DRIFT_REMEDIATION_ENABLED,
    _live_exec_policy_other_server_policy_watch_only_block_enabled: DRIFT_REMEDIATION_WATCH_ONLY_BLOCK,
    _live_exec_policy_other_server_policy_watch_only_market: !!(snapshot && snapshot.driftOtherServerPolicyWatchOnlySet && snapshot.driftOtherServerPolicyWatchOnlySet.has(market)),
    _live_exec_policy_plan_enabled: POLICY_PLAN_ENABLED,
    _live_exec_policy_plan_apply: applyPolicyPlan === true,
    _live_exec_policy_plan_status: policyPlanStatus,
    _live_exec_policy_plan_mode: policyPlanMarketMode || upper(policyPlanSummary.mode),
    _live_exec_policy_plan_global_scale: policyPlanGlobalScale,
    _live_exec_policy_plan_market_scale: policyPlanMarketScale,
    _live_exec_policy_learning_epoch_active: learningEpochRelease.learning_epoch_active,
    _live_exec_policy_learning_epoch_exception_release_enabled: LEARNING_EPOCH_EXCEPTION_RELEASE_ENABLED,
    _live_exec_policy_learning_epoch_exception_release_active: learningEpochRelease.active,
    _live_exec_policy_objective_scale: objectiveScale.scale,
    _live_exec_policy_objective_verdict: objectiveScale.verdict,
    _live_exec_policy_objective_score: objectiveScale.objectiveScore,
    _live_exec_policy_objective_constrained: objectiveScale.constrained,
    _live_exec_policy_portfolio_cluster_enabled: PORTFOLIO_CLUSTER_ENABLED,
    _live_exec_policy_portfolio_cluster_snapshot_available: portfolioCluster.snapshotAvailable,
    _live_exec_policy_portfolio_cluster_desired_side: portfolioCluster.desiredSide,
    _live_exec_policy_portfolio_cluster_same_side_after: portfolioCluster.sameSideAfter,
    _live_exec_policy_portfolio_cluster_correlated_same_side_after: portfolioCluster.correlatedSameSideAfter,
    _live_exec_policy_portfolio_cluster_alt_same_side_after: portfolioCluster.altSameSideAfter,
    _live_exec_policy_portfolio_cluster_same_side_exposure_after: portfolioCluster.sameSideExposureAfter,
    _live_exec_policy_portfolio_cluster_correlated_same_side_exposure_after: portfolioCluster.correlatedSameSideExposureAfter,
    _live_exec_policy_portfolio_cluster_active_same_side_markets: portfolioCluster.activeSameSideMarkets || [],
    _live_exec_policy_portfolio_cluster_active_correlated_same_side_markets: portfolioCluster.activeCorrelatedSameSideMarkets || [],
  };

  if (quarantineBlocked) {
    const reason = "LIVE_POLICY_QUARANTINE_HARD_BLOCK";
    return {
      ok: false,
      qtyPctFinal: 0,
      reason,
      featuresPatch: {
        ...commonTracePatch,
        _live_exec_policy_reason: reason,
        _live_exec_policy_quarantine_reason: quarantineReason || "QUARANTINE",
      },
      policy: {
        stage,
        exchange: ex,
        market,
        blocked: true,
        reason,
        quarantine_reason: quarantineReason || null,
        recommended_action: action || null,
        allocation_score: allocationScore,
      },
    };
  }

  if (qualityBlocked) {
    const reason = qualityHard.reason || "LIVE_POLICY_EXECUTION_QUALITY_HARD_BLOCK";
    return {
      ok: false,
      qtyPctFinal: 0,
      reason,
      featuresPatch: {
        ...commonTracePatch,
        _live_exec_policy_reason: reason,
      },
      policy: {
        stage,
        exchange: ex,
        market,
        blocked: true,
        reason,
      },
    };
  }

  if (qualityGlobalBlocked) {
    const reason = qualityGlobalHard.reason || "LIVE_POLICY_EXECUTION_QUALITY_GLOBAL_HARD_BLOCK";
    return {
      ok: false,
      qtyPctFinal: 0,
      reason,
      featuresPatch: {
        ...commonTracePatch,
        _live_exec_policy_reason: reason,
      },
      policy: {
        stage,
        exchange: ex,
        market,
        blocked: true,
        reason,
      },
    };
  }

  if (lineageSlo.blocked) {
    const reason = upper(lineageSlo.reason) || "LINEAGE_SLO_BLOCKED";
    return {
      ok: false,
      qtyPctFinal: 0,
      reason,
      featuresPatch: {
        ...commonTracePatch,
        _live_exec_policy_reason: reason,
      },
      policy: {
        stage,
        exchange: ex,
        market,
        blocked: true,
        reason,
        lineage_report_generated_at_kst: String(lineageSlo.report_generated_at_kst || "").trim() || null,
        lineage_report_age_ms: toNum(lineageSlo.report_age_ms),
        lineage_report_path: String(lineageSlo.report_path || "").trim() || null,
        lineage_report_source: String(lineageSlo.report_source || "").trim() || null,
        lineage_report_missing: lineageSlo.report_missing === true,
        lineage_slo_max_report_age_ms: LINEAGE_SLO_MAX_REPORT_AGE_MS,
      },
    };
  }

  if (otherServerPolicyWatchOnlyBlocked) {
    const reason = "LIVE_POLICY_OTHER_SERVER_POLICY_WATCH_ONLY_BLOCK";
    const watchReasons = snapshot && snapshot.driftOtherServerPolicyReasonByMarket && snapshot.driftOtherServerPolicyReasonByMarket.get(market);
    return {
      ok: false,
      qtyPctFinal: 0,
      reason,
      featuresPatch: {
        ...commonTracePatch,
        _live_exec_policy_reason: reason,
        _live_exec_policy_other_server_policy_watch_only_block: true,
        _live_exec_policy_other_server_policy_watch_only_reasons: Array.isArray(watchReasons) ? watchReasons : [],
      },
      policy: {
        stage,
        exchange: ex,
        market,
        blocked: true,
        reason,
        other_server_policy_watch_only_reasons: Array.isArray(watchReasons) ? watchReasons : [],
      },
    };
  }

  if (policyPlanWatchOnlyBlocked) {
    const reason = "LIVE_POLICY_PLAN_WATCH_ONLY_BLOCK";
    return {
      ok: false,
      qtyPctFinal: 0,
      reason,
      featuresPatch: {
        ...commonTracePatch,
        _live_exec_policy_reason: reason,
      },
      policy: {
        stage,
        exchange: ex,
        market,
        blocked: true,
        reason,
        plan_mode: policyPlanMarketMode,
        plan_status: policyPlanStatus,
      },
    };
  }

  if (policyPlanHoldBlocked) {
    const reason = "LIVE_POLICY_PLAN_HOLD_BLOCK";
    return {
      ok: false,
      qtyPctFinal: 0,
      reason,
      featuresPatch: {
        ...commonTracePatch,
        _live_exec_policy_reason: reason,
      },
      policy: {
        stage,
        exchange: ex,
        market,
        blocked: true,
        reason,
        plan_mode: policyPlanMarketMode,
        plan_status: policyPlanStatus,
      },
    };
  }

  if (portfolioCluster.blocked) {
    const reason = portfolioCluster.reason || "LIVE_POLICY_PORTFOLIO_CLUSTER_BLOCK";
    return {
      ok: false,
      qtyPctFinal: 0,
      reason,
      featuresPatch: {
        ...commonTracePatch,
        _live_exec_policy_reason: reason,
      },
      policy: {
        stage,
        exchange: ex,
        market,
        blocked: true,
        reason,
        portfolio_cluster_same_side_after: portfolioCluster.sameSideAfter,
        portfolio_cluster_correlated_same_side_after: portfolioCluster.correlatedSameSideAfter,
        portfolio_cluster_alt_same_side_after: portfolioCluster.altSameSideAfter,
        portfolio_cluster_same_side_exposure_after: portfolioCluster.sameSideExposureAfter,
        portfolio_cluster_correlated_same_side_exposure_after: portfolioCluster.correlatedSameSideExposureAfter,
      },
    };
  }

  let qtyPctFinal = qty;
  let scaleApplied = 1.0;
  let actionScale = 1.0;
  let scoreScale = 1.0;
  let qualityScale = 1.0;
  let objectiveQtyScale = objectiveScale.scale;
  let qualityGlobalQtyScale = qualityGlobalScale;
  let portfolioClusterScale = 1.0;
  const alreadyScaled = baseFeatures._live_exec_policy_scale_applied === true;

  if (applyScale && !alreadyScaled) {
    actionScale = deriveAllocatorActionScale(action);
    scoreScale = deriveAllocatorScoreScale(allocationScore);
    qualityScale = deriveQualityScale(qualityRow);
    const planGlobalScale = (applyPolicyPlan && Number.isFinite(policyPlanGlobalScale))
      ? policyPlanGlobalScale
      : 1;
    const planMarketScale = (applyPolicyPlan && Number.isFinite(policyPlanMarketScale))
      ? policyPlanMarketScale
      : 1;
    portfolioClusterScale = portfolioCluster.reduce ? portfolioCluster.scale : 1;
    scaleApplied = clamp(
      actionScale
      * scoreScale
      * qualityScale
      * qualityGlobalQtyScale
      * objectiveQtyScale
      * portfolioClusterScale
      * planGlobalScale
      * planMarketScale,
      SCALE_MIN,
      SCALE_MAX
    );
    qtyPctFinal = clamp(qty * scaleApplied, 0, 1);
  }

  const featureActionScale = Number.isFinite(toNum(baseFeatures._live_exec_policy_action_scale))
    ? Number(baseFeatures._live_exec_policy_action_scale)
    : actionScale;
  const featureScoreScale = Number.isFinite(toNum(baseFeatures._live_exec_policy_score_scale))
    ? Number(baseFeatures._live_exec_policy_score_scale)
    : scoreScale;
  const featureQualityScale = Number.isFinite(toNum(baseFeatures._live_exec_policy_quality_scale))
    ? Number(baseFeatures._live_exec_policy_quality_scale)
    : qualityScale;
  const featurePortfolioClusterScale = Number.isFinite(toNum(baseFeatures._live_exec_policy_portfolio_cluster_scale))
    ? Number(baseFeatures._live_exec_policy_portfolio_cluster_scale)
    : portfolioClusterScale;
  const featureScaleApplied = Number.isFinite(toNum(baseFeatures._live_exec_policy_scale))
    ? Number(baseFeatures._live_exec_policy_scale)
    : scaleApplied;
  const featureQtyBefore = Number.isFinite(toNum(baseFeatures._live_exec_policy_qty_before))
    ? Number(baseFeatures._live_exec_policy_qty_before)
    : qty;
  const featureQtyAfter = Number.isFinite(toNum(baseFeatures._live_exec_policy_qty_after))
    ? Number(baseFeatures._live_exec_policy_qty_after)
    : qtyPctFinal;
  const featureScaledFlag = alreadyScaled || (applyScale && !alreadyScaled);

  const featuresPatch = {
    ...commonTracePatch,
    _live_exec_policy_action_scale: featureActionScale,
    _live_exec_policy_score_scale: featureScoreScale,
    _live_exec_policy_quality_scale: featureQualityScale,
    _live_exec_policy_quality_global_scale: qualityGlobalQtyScale,
    _live_exec_policy_portfolio_cluster_scale: featurePortfolioClusterScale,
    _live_exec_policy_portfolio_cluster_reduce: portfolioCluster.reduce,
    _live_exec_policy_scale_applied: featureScaledFlag,
    _live_exec_policy_scale: featureScaleApplied,
    _live_exec_policy_profile: POLICY_PROFILE,
    _live_exec_policy_qty_before: featureQtyBefore,
    _live_exec_policy_qty_after: featureQtyAfter,
    _live_exec_policy_allocator_generated_at_kst: snapshot && snapshot.allocator ? snapshot.allocator.generated_at_kst || null : null,
    _live_exec_policy_quarantine_generated_at_kst: snapshot && snapshot.quarantine ? snapshot.quarantine.generated_at_kst || null : null,
    _live_exec_policy_execution_quality_generated_at_kst: snapshot && snapshot.quality ? snapshot.quality.generated_at_kst || null : null,
    _live_exec_policy_plan_generated_at_kst: snapshot && snapshot.policyPlan ? snapshot.policyPlan.generated_at_kst || null : null,
  };

  return {
    ok: true,
    qtyPctFinal,
    reason: "LIVE_POLICY_OK",
    featuresPatch,
    policy: {
      stage,
      exchange: ex,
      market,
      blocked: false,
      action: action || null,
      allocation_score: allocationScore,
      action_scale: actionScale,
      score_scale: scoreScale,
      quality_scale: qualityScale,
      quality_global_scale: qualityGlobalQtyScale,
      portfolio_cluster_scale: featurePortfolioClusterScale,
      portfolio_cluster_reduce: portfolioCluster.reduce,
      objective_scale: objectiveQtyScale,
      objective_verdict: objectiveScale.verdict,
      objective_score: objectiveScale.objectiveScore,
      scale_applied: featureScaleApplied,
      plan_enabled: POLICY_PLAN_ENABLED,
      plan_apply: applyPolicyPlan === true,
      plan_status: policyPlanStatus,
      plan_mode: policyPlanMarketMode || upper(policyPlanSummary.mode),
      plan_global_scale: policyPlanGlobalScale,
      plan_market_scale: policyPlanMarketScale,
      learning_epoch_active: learningEpochRelease.learning_epoch_active,
      learning_epoch_exception_release_active: learningEpochRelease.active,
      lineage_shared_refresh_pending: lineageSlo.shared_refresh_pending === true,
      drift_remediation_enabled: DRIFT_REMEDIATION_ENABLED,
      drift_remediation_watch_only_block: DRIFT_REMEDIATION_WATCH_ONLY_BLOCK,
      profile: POLICY_PROFILE,
      qty_before: qty,
      qty_after: qtyPctFinal,
      already_scaled: alreadyScaled,
      apply_scale_requested: applyScale === true,
    },
  };
}

module.exports = {
  evaluateLiveEntryPolicy,
  getLiveExecutionPolicyRuntimeConfig: () => ({
    enabled: ENABLED,
    binance_only: BINANCE_ONLY,
    quarantine_hard_block: QUARANTINE_HARD_BLOCK,
    quality_hard_block: QUALITY_HARD_BLOCK,
    policy_profile: POLICY_PROFILE,
    policy_plan_enabled: POLICY_PLAN_ENABLED,
    policy_plan_apply: POLICY_PLAN_APPLY,
    policy_plan_watch_only_block: POLICY_PLAN_WATCH_ONLY_BLOCK,
    policy_plan_hold_block: POLICY_PLAN_HOLD_BLOCK,
    objective_scale_enabled: OBJECTIVE_SCALE_ENABLED,
    execution_quality_global_guard_enabled: EXEC_QUALITY_GLOBAL_GUARD_ENABLED,
    lineage_slo_enabled: LINEAGE_SLO_ENABLED,
    lineage_slo_fail_closed: LINEAGE_SLO_FAIL_CLOSED,
    lineage_slo_require_fresh: LINEAGE_SLO_REQUIRE_FRESH,
    drift_remediation_enabled: DRIFT_REMEDIATION_ENABLED,
    drift_remediation_watch_only_block: DRIFT_REMEDIATION_WATCH_ONLY_BLOCK,
    portfolio_cluster_enabled: PORTFOLIO_CLUSTER_ENABLED,
    portfolio_cluster_reduce_same_side_after: PORTFOLIO_CLUSTER_REDUCE_SAME_SIDE_AFTER,
    portfolio_cluster_block_same_side_after: PORTFOLIO_CLUSTER_BLOCK_SAME_SIDE_AFTER,
    portfolio_cluster_reduce_correlated_after: PORTFOLIO_CLUSTER_REDUCE_CORRELATED_AFTER,
    portfolio_cluster_block_correlated_after: PORTFOLIO_CLUSTER_BLOCK_CORRELATED_AFTER,
    portfolio_cluster_max_same_side_exposure: PORTFOLIO_CLUSTER_MAX_SAME_SIDE_EXPOSURE,
    portfolio_cluster_max_correlated_same_side_exposure: PORTFOLIO_CLUSTER_MAX_CORRELATED_SAME_SIDE_EXPOSURE,
    learning_epoch_exception_release_enabled: LEARNING_EPOCH_EXCEPTION_RELEASE_ENABLED,
    cache_ttl_ms: CACHE_TTL_MS,
    scale_min: SCALE_MIN,
    scale_max: SCALE_MAX,
    quality_block_max_latency_ms: QUALITY_BLOCK_MAX_LATENCY_MS,
    quality_block_max_partial_pct: QUALITY_BLOCK_MAX_PARTIAL_PCT,
    quality_block_max_slippage_bps: QUALITY_BLOCK_MAX_SLIPPAGE_BPS,
    quality_global_block_max_latency_ms: QUALITY_GLOBAL_BLOCK_MAX_LATENCY_MS,
    quality_global_block_max_partial_pct: QUALITY_GLOBAL_BLOCK_MAX_PARTIAL_PCT,
    quality_global_block_max_slippage_bps: QUALITY_GLOBAL_BLOCK_MAX_SLIPPAGE_BPS,
    lineage_slo_max_intent_signal_null_rate: LINEAGE_SLO_MAX_INTENT_SIGNAL_NULL_RATE,
    lineage_slo_max_fill_signal_null_rate: LINEAGE_SLO_MAX_FILL_SIGNAL_NULL_RATE,
    lineage_slo_max_fill_intent_null_rate: LINEAGE_SLO_MAX_FILL_INTENT_NULL_RATE,
    lineage_slo_max_report_age_ms: LINEAGE_SLO_MAX_REPORT_AGE_MS,
  }),
  __test: {
    buildSnapshotFromArtifacts,
    normalizeSharedLineageSnapshot,
    selectPreferredLineageInput,
    extractOtherServerPolicyWatchOnlyMarkets,
    deriveDesiredPositionSide,
    buildActivePositionsSnapshot,
    derivePortfolioClusterGuard,
    deriveAllocatorActionScale,
    deriveAllocatorScoreScale,
    deriveQualityScale,
    deriveQualityHardBlock,
  },
};
