"use strict";

const fs = require("fs");
const path = require("path");
const { listExchangePositionReadViews } = require("./positionReadModel");
const { fetchUnifiedEventTimeline } = require("../storage/unifiedEventTimeline");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// P3-14: per-market rate limiter for the allocator quarantine epoch-release
// audit log. One entry per market per 24h window.
const allocatorEpochReleaseLogSeen = new Map();
const ALLOCATOR_EPOCH_RELEASE_LOG_WINDOW_MS = 24 * 60 * 60 * 1000;

function logAllocatorQuarantineEpochRelease({ market = null, reason = null, releaseScale = null } = {}) {
  const mk = upper(market);
  if (!mk) return;
  const now = Date.now();
  const prev = allocatorEpochReleaseLogSeen.get(mk);
  if (Number.isFinite(prev) && (now - prev) < ALLOCATOR_EPOCH_RELEASE_LOG_WINDOW_MS) return;
  allocatorEpochReleaseLogSeen.set(mk, now);
  console.warn("[ALLOCATOR_QUARANTINE_EPOCH_RELEASE]", JSON.stringify({
    market: mk,
    reason,
    release_scale: Number.isFinite(releaseScale) ? releaseScale : null,
    at: new Date(now).toISOString(),
  }));
}

function resetAllocatorEpochReleaseLogForTest() {
  allocatorEpochReleaseLogSeen.clear();
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] == null ? "" : process.env[name]).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function numEnv(name, fallback, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = toNum(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const ENABLED = boolEnv("OPENCLAW_EXECUTOR_ENABLED", true);
const BINANCE_ONLY = boolEnv("OPENCLAW_EXECUTOR_BINANCE_ONLY", true);
const ALLOW_UPSCALE = boolEnv("OPENCLAW_EXECUTOR_ALLOW_UPSCALE", false);
const CACHE_TTL_MS = numEnv("OPENCLAW_EXECUTOR_CACHE_TTL_MS", 5000, { min: 0, max: 60000 });
const RECENT_EXIT_LOOKBACK_MS = numEnv("OPENCLAW_EXECUTOR_RECENT_EXIT_LOOKBACK_MS", 6 * 60 * 60 * 1000, { min: 60 * 1000, max: 48 * 60 * 60 * 1000 });
const RECENT_EXIT_BLOCK_MS = numEnv("OPENCLAW_EXECUTOR_RECENT_EXIT_BLOCK_MS", 30 * 60 * 1000, { min: 0, max: 12 * 60 * 60 * 1000 });
const RECENT_EXIT_SOFT_MS = numEnv("OPENCLAW_EXECUTOR_RECENT_EXIT_SOFT_MS", 4 * 60 * 60 * 1000, { min: 0, max: 48 * 60 * 60 * 1000 });
const RECENT_EXIT_SCALE = numEnv("OPENCLAW_EXECUTOR_RECENT_EXIT_SCALE", 0.55, { min: 0.05, max: 1 });
const CLUSTER_REDUCE_SCALE = numEnv("OPENCLAW_EXECUTOR_CLUSTER_REDUCE_SCALE", 0.65, { min: 0.05, max: 1 });
const RESCUE_SCALE = numEnv("OPENCLAW_EXECUTOR_RESCUE_SCALE", 0.75, { min: 0.05, max: 1 });
const HIGH_CONF_SCALE = numEnv("OPENCLAW_EXECUTOR_HIGH_CONF_SCALE", 1.05, { min: 1, max: 1.5 });
const SAME_SIDE_REDUCE_THRESHOLD = Math.trunc(numEnv("OPENCLAW_EXECUTOR_SAME_SIDE_REDUCE_THRESHOLD", 2, { min: 1, max: 10 }));
const SAME_SIDE_BLOCK_THRESHOLD = Math.trunc(numEnv("OPENCLAW_EXECUTOR_SAME_SIDE_BLOCK_THRESHOLD", 3, { min: 1, max: 10 }));
const CORRELATED_REDUCE_THRESHOLD = Math.trunc(numEnv("OPENCLAW_EXECUTOR_CORRELATED_REDUCE_THRESHOLD", 2, { min: 1, max: 10 }));
const CORRELATED_BLOCK_THRESHOLD = Math.trunc(numEnv("OPENCLAW_EXECUTOR_CORRELATED_BLOCK_THRESHOLD", 3, { min: 1, max: 10 }));
const CONFIDENCE_HIGH_MIN = numEnv("OPENCLAW_EXECUTOR_CONFIDENCE_HIGH_MIN", 0.82, { min: 0, max: 1 });
const POSTERIOR_HIGH_MIN = numEnv("OPENCLAW_EXECUTOR_POSTERIOR_HIGH_MIN", 0.68, { min: 0, max: 1 });
const CORRELATED_GROUPS_ENV = String(
  process.env.OPENCLAW_EXECUTOR_CORRELATED_GROUPS
  || "ALT_BETA:DOGEUSDT|XRPUSDT|SOLUSDT|AXSUSDT|LINKUSDT,MAJORS:BTCUSDT|ETHUSDT|BNBUSDT"
).trim();
const ALLOCATOR_REDUCE_SCALE = numEnv("OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE_SCALE", 0.55, { min: 0.05, max: 1 });
const ALLOCATOR_EXPLORE_SCALE = numEnv("OPENCLAW_EXECUTOR_ALLOCATOR_EXPLORE_SCALE", 0.7, { min: 0.05, max: 1 });
const ALLOCATOR_INCREASE_SCALE = numEnv("OPENCLAW_EXECUTOR_ALLOCATOR_INCREASE_SCALE", 1.08, { min: 1, max: 1.5 });
const ALLOCATOR_QUARANTINE_EPOCH_RELEASE_ENABLED = boolEnv("OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_RELEASE_ENABLED", true);
const ALLOCATOR_QUARANTINE_EPOCH_RELEASE_SCALE = numEnv(
  "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_RELEASE_SCALE",
  1,
  { min: 0.05, max: 1 }
);
const ALLOCATOR_SNAPSHOT_STALE_MAX_AGE_MS = numEnv(
  "OPENCLAW_EXECUTOR_ALLOCATOR_STALE_MAX_AGE_MS",
  12 * 60 * 60 * 1000,
  { min: 0, max: 7 * 24 * 60 * 60 * 1000 }
);
const ALLOCATOR_SNAPSHOT_STALE_REDUCE_SCALE = numEnv(
  "OPENCLAW_EXECUTOR_ALLOCATOR_STALE_REDUCE_SCALE",
  ALLOCATOR_REDUCE_SCALE,
  { min: 0.05, max: 1 }
);
const ALPHA_CONTEXT_EPOCH_RELEASE_ENABLED = boolEnv("OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_RELEASE_ENABLED", true);
const ALPHA_CONTEXT_EPOCH_RELEASE_SCALE = numEnv(
  "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_RELEASE_SCALE",
  ALLOCATOR_REDUCE_SCALE,
  { min: 0.05, max: 1 }
);
const ALPHA_CONTEXT_HARD_MIN_REALIZED_N = Math.trunc(numEnv(
  "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MIN_REALIZED_N",
  20,
  { min: 1, max: 1000 }
));
const ALPHA_CONTEXT_HARD_MAX_POSITIVE_RATE = numEnv(
  "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MAX_POSITIVE_RATE",
  0.15,
  { min: 0, max: 1 }
);
const ALPHA_CONTEXT_HARD_MAX_AVG_REALIZED_RET_NET = numEnv(
  "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD_MAX_AVG_REALIZED_RET_NET",
  -0.003,
  { min: -1, max: 1 }
);
const SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD = numEnv("OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD", 1.2, { min: 0, max: 10 });
const SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD = numEnv("OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD", 2.2, { min: 0, max: 10 });
const CORRELATED_EXPOSURE_REDUCE_THRESHOLD = numEnv("OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE_THRESHOLD", 0.8, { min: 0, max: 10 });
const CORRELATED_EXPOSURE_BLOCK_THRESHOLD = numEnv("OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK_THRESHOLD", 1.2, { min: 0, max: 10 });
const RUNNER_EXPOSURE_FALLBACK = numEnv("OPENCLAW_EXECUTOR_RUNNER_EXPOSURE_FALLBACK", 0.2, { min: 0, max: 1 });
const WEIGHTED_CLUSTER_COUNT_ENABLED = boolEnv("OPENCLAW_EXECUTOR_WEIGHTED_CLUSTER_COUNT_ENABLED", true);
const RUNNER_CLUSTER_COUNT_MIN_WEIGHT = numEnv("OPENCLAW_EXECUTOR_RUNNER_CLUSTER_COUNT_MIN_WEIGHT", 0.35, { min: 0, max: 1 });

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const CAPITAL_ALLOCATOR_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_capital_allocator_latest.json");

const positionViewCache = new Map();
const recentTimelineCache = new Map();
const allocatorCache = {
  ts: 0,
  mtimeMs: null,
  summary: null,
  byMarket: new Map(),
};

function clampQty(value) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function clamp01(value) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function pickPositiveNum(...values) {
  for (const value of values) {
    const n = toNum(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function resolveEffectiveAlphaContext(meta = null) {
  const requestedSeverity = upper(meta && meta.severity);
  const realizedN = toNum(meta && meta.realized_n);
  const positiveRate = toNum(meta && meta.positive_rate);
  const avgRealizedRetNet = toNum(meta && meta.avg_realized_ret_net);
  if (!requestedSeverity) {
    return {
      requestedSeverity: null,
      effectiveSeverity: null,
      hardEligible: false,
      realizedN,
      positiveRate,
      avgRealizedRetNet,
      reason: null,
    };
  }
  if (requestedSeverity !== "HARD") {
    return {
      requestedSeverity,
      effectiveSeverity: requestedSeverity,
      hardEligible: false,
      realizedN,
      positiveRate,
      avgRealizedRetNet,
      reason: "ALPHA_CONTEXT_NON_HARD",
    };
  }
  const hardEligible = (
    Number.isFinite(realizedN) &&
    realizedN >= ALPHA_CONTEXT_HARD_MIN_REALIZED_N &&
    Number.isFinite(positiveRate) &&
    positiveRate <= ALPHA_CONTEXT_HARD_MAX_POSITIVE_RATE &&
    Number.isFinite(avgRealizedRetNet) &&
    avgRealizedRetNet <= ALPHA_CONTEXT_HARD_MAX_AVG_REALIZED_RET_NET
  );
  return {
    requestedSeverity,
    effectiveSeverity: hardEligible ? "HARD" : "SOFT",
    hardEligible,
    realizedN,
    positiveRate,
    avgRealizedRetNet,
    reason: hardEligible
      ? "ALPHA_CONTEXT_HARD_CONFIRMED"
      : "ALPHA_CONTEXT_HARD_DOWNGRADED_TO_SOFT",
  };
}

function parseCorrelatedGroups(raw = "") {
  const groups = new Map();
  String(raw || "")
    .split(",")
    .map((chunk) => String(chunk || "").trim())
    .filter(Boolean)
    .forEach((chunk) => {
      const [groupName, symbolList] = chunk.split(":");
      const name = upper(groupName);
      const symbols = String(symbolList || "")
        .split("|")
        .map((item) => upper(item))
        .filter(Boolean);
      if (!name || !symbols.length) return;
      groups.set(name, new Set(symbols));
    });
  return groups;
}

const CORRELATED_GROUPS = parseCorrelatedGroups(CORRELATED_GROUPS_ENV);

function resolveSymbolGroups(symbol) {
  const resolved = upper(symbol);
  const groups = [];
  if (!resolved) return groups;
  for (const [name, members] of CORRELATED_GROUPS.entries()) {
    if (members.has(resolved)) groups.push(name);
  }
  return groups;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function statMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (_) {
    return null;
  }
}

function inferIntentDirection({ event = null, side = null, features = null } = {}) {
  const eventUpper = upper(event);
  const sideUpper = upper(side);
  const featureSide = upper(features && (features.position_side || features.intent_side || features.entry_side || features.side));
  if (featureSide === "LONG" || featureSide === "SHORT") return featureSide;
  if (sideUpper === "BUY") return "LONG";
  if (sideUpper === "SELL") return "SHORT";
  if (eventUpper && eventUpper.includes("SHORT")) return "SHORT";
  if (eventUpper && eventUpper.includes("LONG")) return "LONG";
  return null;
}

function normalizePositionSideFromView(view = null) {
  return upper(
    view && (
      view.position_side
      || view.side
      || (view.meta && (view.meta.position_side || view.meta.external_position_side || view.meta.external_side))
    )
  );
}

function hasActiveExposure(view = null) {
  if (!view || typeof view !== "object") return false;
  const state = upper(view.state || view.position_state);
  const sizePct = toNum(view.size_pct);
  const qtyBase = toNum(view.qty_base);
  if (state && state !== "FLAT" && state !== "CLOSED") return true;
  return (Number.isFinite(sizePct) && sizePct > 0) || (Number.isFinite(qtyBase) && qtyBase > 0);
}

function resolveExitRulesFromView(view = null) {
  const meta = view && view.meta && typeof view.meta === "object" ? view.meta : {};
  const sources = [
    view && view.exit_rules_override,
    view && view.exit_rules,
    meta.exit_rules_override,
    meta.exit_rules,
  ];
  for (const source of sources) {
    if (source && typeof source === "object") return source;
  }
  return {};
}

function resolveRunnerAllowedRatioFromView(view = null) {
  const meta = view && view.meta && typeof view.meta === "object" ? view.meta : {};
  const direct = clamp01(
    view && (
      view.runner_allowed_qty_ratio
      ?? view.contract_runner_allowed_ratio
      ?? meta.runner_allowed_qty_ratio
      ?? meta.runner_allowed_ratio
      ?? meta.contract_runner_allowed_ratio
      ?? meta.contract_runner_allowed_qty_ratio
    )
  );
  if (direct != null) return direct;
  const legacyDirect = clamp01(
    view && (
      view.runner_remaining_qty_ratio
      ?? view.canonical_runner_remaining_ratio
      ?? meta.runner_remaining_qty_ratio
      ?? meta.canonical_runner_remaining_ratio
    )
  );
  if (legacyDirect != null) return legacyDirect;
  const rules = resolveExitRulesFromView(view);
  const tp0QtyRatio = clamp01(rules.TP_P0_QTY) ?? 0.25;
  const tp1QtyRatio = clamp01(rules.TP_P1_QTY) ?? 0.5;
  return clamp01((1 - tp0QtyRatio) * (1 - tp1QtyRatio)) ?? RUNNER_EXPOSURE_FALLBACK;
}

function isRunnerStageView(view = null) {
  const meta = view && view.meta && typeof view.meta === "object" ? view.meta : {};
  const positionState = upper(view && (view.position_state || view.state));
  const canonicalStage = upper(
    view && (
      view.canonical_exit_stage
      || view.exit_stage
      || view.stage
      || meta.canonical_exit_stage
      || meta.exit_stage
    )
  );
  return (
    meta.trail_active === true
    || meta.tp_p1_done === true
    || canonicalStage === "TRAIL"
    || canonicalStage === "FINAL_EXIT"
    || positionState === "SCALE_OUT"
  );
}

function resolveEffectiveExposureSizePct(view = null) {
  const meta = view && view.meta && typeof view.meta === "object" ? view.meta : {};
  const rawSizePct = clamp01(view && (view.size_pct ?? meta.size_pct));
  const currentQtyAbs = pickPositiveNum(
    view && view.qty_base,
    meta.qty_base,
    view && view.canonical_runner_remaining_abs,
    view && view.runner_remaining_qty_abs,
    meta.canonical_runner_remaining_abs,
    meta.runner_remaining_qty_abs,
    meta.runner_remaining_abs,
    meta.contract_runner_remaining_abs
  );
  const entryQtyAbs = pickPositiveNum(
    view && view.entry_qty_base,
    view && view.entry_qty_abs,
    meta.entry_qty_base,
    meta.entry_qty_abs,
    meta.contract_entry_qty_abs,
    meta.entryQtyAbs
  );
  if (Number.isFinite(currentQtyAbs) && Number.isFinite(entryQtyAbs) && entryQtyAbs > 0) {
    return {
      sizePct: clamp01(currentQtyAbs / entryQtyAbs) ?? 1,
      source: "CURRENT_OVER_ENTRY_QTY",
      rawSizePct,
    };
  }

  const runnerRemainingRatio = clamp01(
    view && (
      view.runner_remaining_qty_ratio
      ?? view.canonical_runner_remaining_ratio
      ?? meta.runner_remaining_qty_ratio
      ?? meta.canonical_runner_remaining_ratio
    )
  );
  if (runnerRemainingRatio != null) {
    return {
      sizePct: runnerRemainingRatio,
      source: "RUNNER_REMAINING_RATIO",
      rawSizePct,
    };
  }

  const runnerAllowedAbs = pickPositiveNum(
    view && view.runner_allowed_qty_abs,
    view && view.contract_runner_allowed_abs,
    meta.runner_allowed_qty_abs,
    meta.runner_allowed_abs,
    meta.contract_runner_allowed_abs
  );
  const runnerAllowedRatio = resolveRunnerAllowedRatioFromView(view);
  if (Number.isFinite(currentQtyAbs) && Number.isFinite(runnerAllowedAbs) && runnerAllowedAbs > 0 && runnerAllowedRatio != null) {
    return {
      sizePct: clamp01((currentQtyAbs / runnerAllowedAbs) * runnerAllowedRatio) ?? runnerAllowedRatio,
      source: "CURRENT_OVER_RUNNER_ALLOWED",
      rawSizePct,
    };
  }

  if (isRunnerStageView(view)) {
    return {
      sizePct: clamp01(Math.min(runnerAllowedRatio ?? RUNNER_EXPOSURE_FALLBACK, RUNNER_EXPOSURE_FALLBACK)) ?? RUNNER_EXPOSURE_FALLBACK,
      source: "RUNNER_STAGE_FALLBACK",
      rawSizePct,
    };
  }

  return {
    sizePct: rawSizePct ?? 1,
    source: rawSizePct != null ? "RAW_SIZE_PCT" : "FULL_SLOT_DEFAULT",
    rawSizePct,
  };
}

function resolveClusterCountContribution(view = null, exposureSizing = null) {
  if (!WEIGHTED_CLUSTER_COUNT_ENABLED) return 1;
  const sizing = (exposureSizing && typeof exposureSizing === "object")
    ? exposureSizing
    : resolveEffectiveExposureSizePct(view);
  const source = upper(sizing && sizing.source);
  const runnerDerived = (
    source === "CURRENT_OVER_RUNNER_ALLOWED"
    || source === "RUNNER_REMAINING_RATIO"
    || source === "RUNNER_STAGE_FALLBACK"
  );
  if (!runnerDerived) return 1;
  const sizePct = clamp01(sizing && sizing.sizePct);
  const baseWeight = Number.isFinite(sizePct) && sizePct > 0 ? sizePct : RUNNER_EXPOSURE_FALLBACK;
  return Math.max(RUNNER_CLUSTER_COUNT_MIN_WEIGHT, Math.min(1, baseWeight));
}

function resolveRecentEvent(row = null) {
  if (!row || typeof row !== "object") return null;
  return upper(
    row.event
    || (row.payload && row.payload.event)
    || (row.raw && row.raw.event)
    || (row.raw && row.raw.after && row.raw.after.event)
    || (row.raw && row.raw.after_snapshot && row.raw.after_snapshot.event)
  );
}

function isExitEventName(event) {
  const ev = upper(event);
  if (!ev) return false;
  return ev.includes("EXIT") || ev.includes("TRAIL") || ev.includes("TP") || ev.includes("SL") || ev.includes("FORCE_EXIT");
}

function resolveExitPositionSide(row = null) {
  const rawSide = upper(
    row && (
      row.position_side
      || (row.payload && (row.payload.position_side || row.payload.exit_dir))
      || (row.raw && (row.raw.position_side || row.raw.side))
      || (row.raw && row.raw.after && (row.raw.after.position_side || row.raw.after.side))
    )
  );
  if (rawSide === "LONG" || rawSide === "SHORT") return rawSide;
  if (rawSide === "SELL") return "LONG";
  if (rawSide === "BUY") return "SHORT";
  return null;
}

function extractLatestExitRow(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => Number(b.ts_ms || 0) - Number(a.ts_ms || 0))
    .find((row) => isExitEventName(resolveRecentEvent(row))) || null;
}

function minScale(current, next) {
  const a = toNum(current);
  const b = toNum(next);
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : null;
  if (!Number.isFinite(b)) return a;
  return Math.min(a, b);
}

function maxScale(current, next) {
  const a = toNum(current);
  const b = toNum(next);
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : null;
  if (!Number.isFinite(b)) return a;
  return Math.max(a, b);
}

function resolveConfidence(features = null) {
  if (!features || typeof features !== "object") return null;
  return toNum(
    features.confidence
    ?? features.conf
    ?? features.signal_confidence
    ?? features.wave_confidence
    ?? features.wave_conf
  );
}

function resolvePosterior(features = null, desiredSide = null) {
  if (!features || typeof features !== "object") return null;
  const side = upper(desiredSide);
  if (side === "LONG") {
    return toNum(
      features.long_posterior
      ?? features.posterior_long
      ?? features.posterior_buy
      ?? features.buy_posterior
      ?? features.posterior
    );
  }
  if (side === "SHORT") {
    return toNum(
      features.short_posterior
      ?? features.posterior_short
      ?? features.posterior_sell
      ?? features.sell_posterior
      ?? features.posterior
    );
  }
  return toNum(features.posterior);
}

function resolveEntryTier(features = null, event = null) {
  const raw = upper(
    features && (
      features.entry_grade
      || features.entry_timing_tier
      || features.entry_tier
      || features.signal_tier
    )
  ) || upper(event);
  if (!raw) return null;
  if (raw.includes("CORE")) return "CORE";
  if (raw.includes("REAL")) return "REAL";
  if (raw.includes("PRE_REAL")) return "PRE_REAL";
  if (raw.includes("EARLY")) return "EARLY";
  return raw;
}

function resolveExecutorCohort({ cohort = null, features = null } = {}) {
  return upper(
    cohort
    || (features && (
      features.openclaw_market_regime_cohort
      || features.market_regime_cohort
      || features._openclaw_market_regime_cohort
    ))
  );
}

function resolveExecutorRegime(features = null) {
  return upper(
    features && (
      features.openclaw_market_regime_cohort
      || features.market_regime_cohort
      || features.pro_regime_state
      || features.market_regime
      || features.regime
      || features._openclaw_market_regime_cohort
    )
  ) || "UNKNOWN";
}

function loadCapitalAllocatorSnapshot({ force = false } = {}) {
  const nowMs = Date.now();
  const mtimeMs = statMtimeMs(CAPITAL_ALLOCATOR_PATH);
  if (!force && allocatorCache.summary && allocatorCache.ts && (nowMs - allocatorCache.ts) < CACHE_TTL_MS && allocatorCache.mtimeMs === mtimeMs) {
    return allocatorCache;
  }
  const doc = safeReadJson(CAPITAL_ALLOCATOR_PATH);
  const summary = doc && doc.summary && typeof doc.summary === "object" ? doc.summary : {};
  const rows = Array.isArray(summary.by_market) ? summary.by_market : [];
  const byMarket = new Map();
  for (const row of rows) {
    const market = upper(row && row.market);
    if (!market) continue;
    byMarket.set(market, row);
  }
  allocatorCache.ts = nowMs;
  allocatorCache.mtimeMs = mtimeMs;
  allocatorCache.summary = summary;
  allocatorCache.byMarket = byMarket;
  allocatorCache.generatedAtKst = doc && typeof doc.generated_at_kst === "string" ? doc.generated_at_kst : null;
  return allocatorCache;
}

function normalizeCapitalAllocatorSnapshot(snapshot = null) {
  if (!snapshot || typeof snapshot !== "object") return loadCapitalAllocatorSnapshot();
  return {
    summary: snapshot.summary || {},
    byMarket: snapshot.byMarket instanceof Map
      ? snapshot.byMarket
      : new Map(
        Array.isArray(snapshot.by_market)
          ? snapshot.by_market
              .map((row) => [upper(row && row.market), row])
              .filter((row) => row[0])
          : []
      ),
    mtimeMs: toNum(snapshot.mtimeMs),
    generatedAtKst: typeof snapshot.generatedAtKst === "string"
      ? snapshot.generatedAtKst
      : (typeof snapshot.generated_at_kst === "string" ? snapshot.generated_at_kst : null),
  };
}

function resolveAllocatorSnapshotAgeMs(snapshot = null, nowMs = Date.now()) {
  const mtimeMs = toNum(snapshot && snapshot.mtimeMs);
  if (!Number.isFinite(mtimeMs)) return null;
  return Math.max(0, nowMs - mtimeMs);
}

function resolveAllocatorSnapshotStaleness(snapshot = null, nowMs = Date.now()) {
  const summary = snapshot && snapshot.summary && typeof snapshot.summary === "object" ? snapshot.summary : {};
  const ageMs = resolveAllocatorSnapshotAgeMs(snapshot, nowMs);
  const reasons = [];
  if (
    summary.input_stale === true
    || summary.inputs_stale === true
    || summary.inputs_fresh === false
    || summary.stale === true
    || upper(summary.input_freshness_status) === "STALE_INPUTS"
    || upper(summary.evidence_status) === "SERVER_MARKET_CAPITAL_ALLOCATOR_STALE_INPUTS"
  ) {
    reasons.push("SUMMARY_INPUT_STALE");
  }
  if (
    Number.isFinite(ageMs)
    && ALLOCATOR_SNAPSHOT_STALE_MAX_AGE_MS >= 0
    && ageMs > ALLOCATOR_SNAPSHOT_STALE_MAX_AGE_MS
  ) {
    reasons.push("FILE_AGE_EXCEEDED");
  }
  return {
    ageMs,
    stale: reasons.length > 0,
    reasons,
  };
}

async function listActivePositionViews({ exchange, override = null } = {}) {
  if (Array.isArray(override)) return override.slice();
  const key = upper(exchange) || "UNKNOWN";
  const cached = positionViewCache.get(key);
  const nowMs = Date.now();
  if (cached && cached.expiresAt > nowMs && Array.isArray(cached.rows)) return cached.rows.slice();
  const rows = await listExchangePositionReadViews({ exchange }).catch(() => []);
  positionViewCache.set(key, { expiresAt: nowMs + CACHE_TTL_MS, rows: Array.isArray(rows) ? rows.slice() : [] });
  return Array.isArray(rows) ? rows.slice() : [];
}

async function listRecentTimelineRows({ exchange, symbol, nowMs, override = null } = {}) {
  if (Array.isArray(override)) return override.slice();
  const key = `${upper(exchange) || "UNKNOWN"}__${upper(symbol) || "UNKNOWN"}`;
  const cached = recentTimelineCache.get(key);
  if (cached && cached.expiresAt > nowMs && Array.isArray(cached.rows)) return cached.rows.slice();
  const rows = await fetchUnifiedEventTimeline({
    exchange,
    symbol,
    fromMs: nowMs - RECENT_EXIT_LOOKBACK_MS,
    toMs: nowMs + 1,
    limit: 80,
  }).catch(() => []);
  recentTimelineCache.set(key, { expiresAt: nowMs + CACHE_TTL_MS, rows: Array.isArray(rows) ? rows.slice() : [] });
  return Array.isArray(rows) ? rows.slice() : [];
}

function summarizeExposure({ exchange, symbol, desiredSide, positionViews = [] } = {}) {
  const targetSymbol = upper(symbol);
  const side = upper(desiredSide);
  const targetGroups = resolveSymbolGroups(targetSymbol);
  const exposures = [];
  for (const row of (Array.isArray(positionViews) ? positionViews : [])) {
    if (!hasActiveExposure(row)) continue;
    const rowSymbol = upper(row.symbol || row.symbol_or_pair_id);
    if (!rowSymbol) continue;
    const rowSide = normalizePositionSideFromView(row);
    const exposureSizing = resolveEffectiveExposureSizePct(row);
    const clusterCountWeight = resolveClusterCountContribution(row, exposureSizing);
    const rowGroups = resolveSymbolGroups(rowSymbol);
    exposures.push({
      exchange: upper(exchange),
      symbol: rowSymbol,
      side: rowSide,
      size_pct: exposureSizing.sizePct,
      raw_size_pct: exposureSizing.rawSizePct,
      exposure_size_source: exposureSizing.source,
      cluster_count_weight: clusterCountWeight,
      sameSymbol: rowSymbol === targetSymbol,
      sameSide: !!(side && rowSide && rowSide === side),
      groupOverlap: targetGroups.filter((name) => rowGroups.includes(name)),
    });
  }
  const sameSideActive = exposures.filter((row) => row.sameSide && !row.sameSymbol);
  const correlatedActive = exposures.filter((row) => row.sameSide && !row.sameSymbol && row.groupOverlap.length > 0);
  const sameSideExposure = sameSideActive.reduce((sum, row) => sum + (toNum(row.size_pct) || 1), 0);
  const correlatedExposure = correlatedActive.reduce((sum, row) => sum + (toNum(row.size_pct) || 1), 0);
  const sameSideWeightedCount = sameSideActive.reduce((sum, row) => sum + (toNum(row.cluster_count_weight) || 1), 0);
  const correlatedWeightedCount = correlatedActive.reduce((sum, row) => sum + (toNum(row.cluster_count_weight) || 1), 0);
  const sameSideRawCount = sameSideActive.length;
  const correlatedRawCount = correlatedActive.length;
  return {
    exposures,
    sameSideActive,
    correlatedActive,
    sameSideRawCountAfter: sameSideRawCount + 1,
    correlatedRawCountAfter: correlatedRawCount + 1,
    sameSideWeightedCountAfter: sameSideWeightedCount + 1,
    correlatedWeightedCountAfter: correlatedWeightedCount + 1,
    sameSideCountAfter: (WEIGHTED_CLUSTER_COUNT_ENABLED ? sameSideWeightedCount : sameSideRawCount) + 1,
    correlatedCountAfter: (WEIGHTED_CLUSTER_COUNT_ENABLED ? correlatedWeightedCount : correlatedRawCount) + 1,
    sameSideExposureAfter: sameSideExposure,
    correlatedExposureAfter: correlatedExposure,
    targetGroups,
  };
}

async function evaluateOpenClawExecutionDecision({
  exchange,
  symbol,
  intent,
  event,
  side,
  qtyPct,
  features = null,
  stage = "RUNNER_SIGNAL",
  applyScale = true,
  nowMs = Date.now(),
  signalTf = null,
  cohort = null,
  positionViews = null,
  recentTimelineRows = null,
  capitalAllocatorSnapshot = null,
} = {}) {
  const resolvedExchange = upper(exchange);
  const resolvedSymbol = upper(symbol);
  const intentUpper = upper(intent);
  const qtyBefore = clampQty(qtyPct);
  const desiredSide = inferIntentDirection({ event, side, features });
  const baseFeatures = features && typeof features === "object" ? safeClone(features) || {} : {};

  const baseResult = {
    ok: true,
    reason: "OPENCLAW_EXECUTOR_PASS",
    qtyPctFinal: qtyBefore,
    scaleApplied: 1,
    exitProfileMode: null,
    decision: {
      enabled: ENABLED,
      exchange: resolvedExchange,
      symbol: resolvedSymbol,
      intent: intentUpper,
      stage: upper(stage),
      signalTf: String(signalTf || "").trim() || null,
      desiredSide,
    },
    featuresPatch: {
      ...baseFeatures,
      _openclaw_executor_enabled: ENABLED,
      _openclaw_executor_stage: upper(stage),
    },
  };

  if (!ENABLED) {
    return {
      ...baseResult,
      reason: "OPENCLAW_EXECUTOR_DISABLED",
      featuresPatch: {
        ...baseResult.featuresPatch,
        _openclaw_executor_reason: "OPENCLAW_EXECUTOR_DISABLED",
      },
    };
  }
  if (BINANCE_ONLY && !(resolvedExchange || "").includes("BINANCE")) {
    return {
      ...baseResult,
      reason: "OPENCLAW_EXECUTOR_NON_BINANCE_SKIP",
      featuresPatch: {
        ...baseResult.featuresPatch,
        _openclaw_executor_reason: "OPENCLAW_EXECUTOR_NON_BINANCE_SKIP",
      },
    };
  }
  if (intentUpper !== "ENTRY" && intentUpper !== "ADD") {
    return {
      ...baseResult,
      reason: "OPENCLAW_EXECUTOR_NON_ENTRY_SKIP",
      featuresPatch: {
        ...baseResult.featuresPatch,
        _openclaw_executor_reason: "OPENCLAW_EXECUTOR_NON_ENTRY_SKIP",
      },
    };
  }

  let scale = 1;
  let blocked = false;
  let reason = "OPENCLAW_EXECUTOR_OK";
  let exitProfileMode = null;
  const notes = [];
  const resolvedCohort = resolveExecutorCohort({ cohort, features: baseFeatures });

  const [views, timelineRows] = await Promise.all([
    listActivePositionViews({ exchange: resolvedExchange, override: positionViews }),
    listRecentTimelineRows({ exchange: resolvedExchange, symbol: resolvedSymbol, nowMs, override: recentTimelineRows }),
  ]);
  const allocatorSnapshot = normalizeCapitalAllocatorSnapshot(capitalAllocatorSnapshot);
  const allocatorRow = allocatorSnapshot.byMarket.get(resolvedSymbol) || null;
  const allocatorSnapshotFreshness = resolveAllocatorSnapshotStaleness(allocatorSnapshot, nowMs);
  const allocatorSnapshotAgeMs = allocatorSnapshotFreshness.ageMs;
  const allocatorSnapshotStale = allocatorSnapshotFreshness.stale;
  const allocatorSnapshotStaleReasons = allocatorSnapshotFreshness.reasons;

  const latestExit = extractLatestExitRow(timelineRows);
  const latestExitTsMs = toNum(latestExit && latestExit.ts_ms);
  const latestExitAgeMs = Number.isFinite(latestExitTsMs) ? Math.max(0, nowMs - latestExitTsMs) : null;
  const latestExitEvent = resolveRecentEvent(latestExit);
  const latestExitPositionSide = resolveExitPositionSide(latestExit);
  const sameDirectionRecentExit = !desiredSide || !latestExitPositionSide || desiredSide === latestExitPositionSide;

  if (Number.isFinite(latestExitAgeMs) && latestExitAgeMs <= RECENT_EXIT_BLOCK_MS && sameDirectionRecentExit) {
    blocked = true;
    reason = "OPENCLAW_EXECUTOR_RECENT_REENTRY_BLOCK";
    exitProfileMode = "BASE";
    notes.push(reason);
  } else if (Number.isFinite(latestExitAgeMs) && latestExitAgeMs <= RECENT_EXIT_SOFT_MS) {
    scale = minScale(scale, RECENT_EXIT_SCALE);
    exitProfileMode = "BASE";
    reason = "OPENCLAW_EXECUTOR_RECENT_REENTRY_REDUCE";
    notes.push(reason);
  }

  const exposure = summarizeExposure({
    exchange: resolvedExchange,
    symbol: resolvedSymbol,
    desiredSide,
    positionViews: views,
  });
  const incomingExposure = qtyBefore;
  const sameSideExposureAfter = exposure.sameSideExposureAfter + incomingExposure;
  const correlatedExposureAfter = exposure.correlatedExposureAfter + (exposure.targetGroups.length > 0 ? incomingExposure : 0);

  if (!blocked && exposure.sameSideCountAfter >= SAME_SIDE_BLOCK_THRESHOLD) {
    blocked = true;
    reason = "OPENCLAW_EXECUTOR_SAME_SIDE_CLUSTER_BLOCK";
    exitProfileMode = "BASE";
    notes.push(reason);
  }
  if (!blocked && exposure.correlatedCountAfter >= CORRELATED_BLOCK_THRESHOLD) {
    blocked = true;
    reason = "OPENCLAW_EXECUTOR_CORRELATED_CLUSTER_BLOCK";
    exitProfileMode = "BASE";
    notes.push(reason);
  }
  if (!blocked) {
    const clusterReduce = exposure.sameSideCountAfter >= SAME_SIDE_REDUCE_THRESHOLD
      || exposure.correlatedCountAfter >= CORRELATED_REDUCE_THRESHOLD;
    if (clusterReduce) {
      scale = minScale(scale, CLUSTER_REDUCE_SCALE);
      exitProfileMode = "BASE";
      reason = exposure.correlatedCountAfter >= CORRELATED_REDUCE_THRESHOLD
        ? "OPENCLAW_EXECUTOR_CORRELATED_CLUSTER_REDUCE"
        : "OPENCLAW_EXECUTOR_SAME_SIDE_CLUSTER_REDUCE";
      notes.push(reason);
    }
  }

  if (!blocked && sameSideExposureAfter > SAME_SIDE_EXPOSURE_BLOCK_THRESHOLD) {
    blocked = true;
    reason = "OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK";
    exitProfileMode = "BASE";
    notes.push(reason);
  } else if (!blocked && correlatedExposureAfter > CORRELATED_EXPOSURE_BLOCK_THRESHOLD) {
    blocked = true;
    reason = "OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK";
    exitProfileMode = "BASE";
    notes.push(reason);
  } else if (!blocked && (sameSideExposureAfter > SAME_SIDE_EXPOSURE_REDUCE_THRESHOLD || correlatedExposureAfter > CORRELATED_EXPOSURE_REDUCE_THRESHOLD)) {
    scale = minScale(scale, CLUSTER_REDUCE_SCALE);
    exitProfileMode = "BASE";
    reason = correlatedExposureAfter > CORRELATED_EXPOSURE_REDUCE_THRESHOLD
      ? "OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE"
      : "OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE";
    notes.push(reason);
  }

  if (!blocked && ["RESCUE", "HOLD_SAMPLE", "WATCH_ONLY", "LEARNING"].includes(resolvedCohort)) {
    scale = minScale(scale, RESCUE_SCALE);
    exitProfileMode = "BASE";
    reason = "OPENCLAW_EXECUTOR_COHORT_REDUCE";
    notes.push(reason);
  }

  const confidence = resolveConfidence(baseFeatures);
  const posterior = resolvePosterior(baseFeatures, desiredSide);
  const entryTier = resolveEntryTier(baseFeatures, event);
  const executorRegime = resolveExecutorRegime(baseFeatures);
  const highConfidence = Number.isFinite(confidence) && confidence >= CONFIDENCE_HIGH_MIN
    && Number.isFinite(posterior) && posterior >= POSTERIOR_HIGH_MIN
    && (entryTier === "CORE" || entryTier === "REAL");

  if (!blocked && highConfidence && exitProfileMode == null) {
    exitProfileMode = "AGGRESSIVE";
    reason = "OPENCLAW_EXECUTOR_HIGH_CONF_AGGRESSIVE";
    notes.push(reason);
    if (ALLOW_UPSCALE && applyScale) scale = maxScale(scale, HIGH_CONF_SCALE);
  }

  const allocatorAction = upper(allocatorRow && allocatorRow.recommended_action);
  const allocatorScore = toNum(allocatorRow && allocatorRow.allocation_score);
  const allocatorLearningEpochActive = allocatorSnapshot.summary && allocatorSnapshot.summary.learning_epoch_active === true;
  const allocatorQuarantineEpochReleaseActive = allocatorLearningEpochActive && ALLOCATOR_QUARANTINE_EPOCH_RELEASE_ENABLED;
  const alphaContextEpochReleaseActive = allocatorLearningEpochActive && ALPHA_CONTEXT_EPOCH_RELEASE_ENABLED;
  const allocatorPenaltyReasons = Array.isArray(allocatorRow && allocatorRow.penalty_reasons)
    ? allocatorRow.penalty_reasons.map((item) => upper(item)).filter(Boolean)
    : [];
  const allocatorAlphaContextRows = Array.isArray(allocatorSnapshot.summary && allocatorSnapshot.summary.alpha_penalty_context_rows)
    ? allocatorSnapshot.summary.alpha_penalty_context_rows
    : [];
  const matchedAlphaContext = allocatorAlphaContextRows.find((row) => {
    if (upper(row && row.market) !== resolvedSymbol) return false;
    if (upper(row && row.position_side) !== upper(desiredSide)) return false;
    const rowRegime = upper(row && row.regime_key) || "UNKNOWN";
    return rowRegime === executorRegime || rowRegime === "UNKNOWN" || executorRegime === "UNKNOWN";
  }) || null;
  const alphaContextMeta = resolveEffectiveAlphaContext(matchedAlphaContext);
  const matchedAlphaSeverity = alphaContextMeta.effectiveSeverity;
  if (!blocked && matchedAlphaSeverity === "HARD") {
    if (allocatorSnapshotStale) {
      scale = minScale(scale, ALLOCATOR_SNAPSHOT_STALE_REDUCE_SCALE);
      exitProfileMode = exitProfileMode || "BASE";
      reason = "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_STALE_REDUCE";
      notes.push("OPENCLAW_EXECUTOR_ALLOCATOR_SNAPSHOT_STALE");
      notes.push(reason);
    } else if (alphaContextEpochReleaseActive) {
      const releaseScale = Number.isFinite(ALPHA_CONTEXT_EPOCH_RELEASE_SCALE)
        ? ALPHA_CONTEXT_EPOCH_RELEASE_SCALE
        : ALLOCATOR_REDUCE_SCALE;
      scale = minScale(scale, releaseScale);
      exitProfileMode = exitProfileMode || "BASE";
      reason = releaseScale < 0.999999
        ? "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_REDUCE"
        : "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_RELEASE";
      notes.push("OPENCLAW_EXECUTOR_ALPHA_CONTEXT_HARD");
      notes.push(reason);
    } else {
      blocked = true;
      reason = "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_BLOCK";
      exitProfileMode = "BASE";
      notes.push(reason);
    }
  } else if (!blocked && matchedAlphaSeverity === "SOFT") {
    scale = minScale(scale, ALLOCATOR_REDUCE_SCALE);
    exitProfileMode = exitProfileMode || "BASE";
    reason = "OPENCLAW_EXECUTOR_ALPHA_CONTEXT_REDUCE";
    notes.push(reason);
  }
  if (!blocked && (allocatorAction === "QUARANTINE" || allocatorAction === "BLOCK")) {
    if (allocatorSnapshotStale) {
      scale = minScale(scale, ALLOCATOR_SNAPSHOT_STALE_REDUCE_SCALE);
      exitProfileMode = exitProfileMode || "BASE";
      reason = "OPENCLAW_EXECUTOR_ALLOCATOR_STALE_REDUCE";
      notes.push("OPENCLAW_EXECUTOR_ALLOCATOR_SNAPSHOT_STALE");
      notes.push(`OPENCLAW_EXECUTOR_ALLOCATOR_${allocatorAction}`);
      notes.push(reason);
    } else if (allocatorAction === "QUARANTINE" && allocatorQuarantineEpochReleaseActive) {
      const releaseScale = Number.isFinite(ALLOCATOR_QUARANTINE_EPOCH_RELEASE_SCALE)
        ? ALLOCATOR_QUARANTINE_EPOCH_RELEASE_SCALE
        : 1;
      scale = minScale(scale, releaseScale);
      exitProfileMode = exitProfileMode || "BASE";
      reason = releaseScale < 0.999999
        ? "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_REDUCE"
        : "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_RELEASE";
      notes.push("OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE");
      notes.push(reason);
      // P3-14: audit log — emit a structured line whenever the epoch-release
      // path promotes a QUARANTINE into a soft reduce so operators can see
      // which markets were spared. Rate-limited to once per market per day
      // to avoid log spam during a learning epoch.
      try {
        logAllocatorQuarantineEpochRelease({
          market: symbol,
          reason,
          releaseScale,
        });
      } catch (_) { /* never fail the authority path on logging */ }
    } else {
      blocked = true;
      reason = allocatorAction === "BLOCK"
        ? "OPENCLAW_EXECUTOR_ALLOCATOR_BLOCK"
        : "OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE";
      exitProfileMode = "BASE";
      notes.push(reason);
    }
  } else if (!blocked && allocatorAction === "REDUCE") {
    scale = minScale(scale, ALLOCATOR_REDUCE_SCALE);
    exitProfileMode = exitProfileMode || "BASE";
    reason = "OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE";
    notes.push(reason);
  } else if (!blocked && allocatorAction === "EXPLORE_LIGHT") {
    scale = minScale(scale, ALLOCATOR_EXPLORE_SCALE);
    exitProfileMode = exitProfileMode || "BASE";
    reason = "OPENCLAW_EXECUTOR_ALLOCATOR_EXPLORE_SCALE";
    notes.push(reason);
  } else if (!blocked && allocatorAction === "INCREASE" && ALLOW_UPSCALE && applyScale) {
    scale = maxScale(scale, ALLOCATOR_INCREASE_SCALE);
    if (exitProfileMode == null) exitProfileMode = "AGGRESSIVE";
    reason = "OPENCLAW_EXECUTOR_ALLOCATOR_INCREASE";
    notes.push(reason);
  }

  const scaleApplied = applyScale ? (Number.isFinite(scale) ? scale : 1) : 1;
  const qtyPctFinal = blocked ? 0 : clampQty(qtyBefore * scaleApplied);
  const featuresPatch = {
    ...baseFeatures,
    _openclaw_executor_enabled: true,
    _openclaw_executor_stage: upper(stage),
    _openclaw_executor_reason: reason,
    _openclaw_executor_notes: notes.slice(),
    _openclaw_executor_qty_before: qtyBefore,
    _openclaw_executor_qty_after: qtyPctFinal,
    _openclaw_executor_scale_applied: scaleApplied,
    _openclaw_executor_apply_scale: applyScale === true,
    _openclaw_executor_same_side_count_after: exposure.sameSideCountAfter,
    _openclaw_executor_correlated_count_after: exposure.correlatedCountAfter,
    _openclaw_executor_same_side_position_count_after: exposure.sameSideRawCountAfter,
    _openclaw_executor_correlated_position_count_after: exposure.correlatedRawCountAfter,
    _openclaw_executor_same_side_weighted_count_after: exposure.sameSideWeightedCountAfter,
    _openclaw_executor_correlated_weighted_count_after: exposure.correlatedWeightedCountAfter,
    _openclaw_executor_same_side_exposure_after: sameSideExposureAfter,
    _openclaw_executor_correlated_exposure_after: correlatedExposureAfter,
    _openclaw_executor_groups: exposure.targetGroups.slice(),
    _openclaw_executor_recent_exit_event: latestExitEvent,
    _openclaw_executor_recent_exit_age_ms: latestExitAgeMs,
    _openclaw_executor_recent_exit_position_side: latestExitPositionSide,
    _openclaw_executor_cohort: resolvedCohort,
    _openclaw_executor_confidence: confidence,
    _openclaw_executor_posterior: posterior,
    _openclaw_executor_entry_tier: entryTier,
    _openclaw_executor_regime: executorRegime,
    _openclaw_executor_allocator_action: allocatorAction,
    _openclaw_executor_allocator_score: allocatorScore,
    _openclaw_executor_allocator_learning_epoch_active: allocatorLearningEpochActive,
    _openclaw_executor_allocator_quarantine_epoch_release_active: allocatorQuarantineEpochReleaseActive,
    _openclaw_executor_alpha_context_epoch_release_active: alphaContextEpochReleaseActive,
    _openclaw_executor_allocator_snapshot_age_ms: allocatorSnapshotAgeMs,
    _openclaw_executor_allocator_snapshot_stale: allocatorSnapshotStale,
    _openclaw_executor_allocator_snapshot_stale_reasons: allocatorSnapshotStaleReasons.slice(),
    _openclaw_executor_allocator_generated_at_kst: allocatorSnapshot.generatedAtKst || null,
    _openclaw_executor_allocator_penalty_reasons: allocatorPenaltyReasons,
    _openclaw_executor_alpha_context: matchedAlphaContext,
    _openclaw_executor_alpha_context_requested_severity: alphaContextMeta.requestedSeverity,
    _openclaw_executor_alpha_context_effective_severity: alphaContextMeta.effectiveSeverity,
    _openclaw_executor_alpha_context_hard_eligible: alphaContextMeta.hardEligible,
    _openclaw_executor_alpha_context_gate_reason: alphaContextMeta.reason,
  };
  if (exitProfileMode) {
    featuresPatch._openclaw_executor_exit_profile_mode = exitProfileMode;
    featuresPatch.openclaw_executor_exit_profile_mode = exitProfileMode;
    featuresPatch.openclaw_executor_exit_profile_reason = reason;
  }

  return {
    ok: !blocked && qtyPctFinal > 0,
    reason,
    qtyPctFinal,
    scaleApplied,
    exitProfileMode,
    decision: {
      enabled: true,
      exchange: resolvedExchange,
      symbol: resolvedSymbol,
      intent: intentUpper,
      stage: upper(stage),
      signalTf: String(signalTf || "").trim() || null,
      desiredSide,
      sameSideCountAfter: exposure.sameSideCountAfter,
      correlatedCountAfter: exposure.correlatedCountAfter,
      sameSideRawCountAfter: exposure.sameSideRawCountAfter,
      correlatedRawCountAfter: exposure.correlatedRawCountAfter,
      sameSideWeightedCountAfter: exposure.sameSideWeightedCountAfter,
      correlatedWeightedCountAfter: exposure.correlatedWeightedCountAfter,
      sameSideExposureAfter,
      correlatedExposureAfter,
      groups: exposure.targetGroups.slice(),
      recentExitEvent: latestExitEvent,
      recentExitAgeMs: latestExitAgeMs,
      recentExitPositionSide: latestExitPositionSide,
      cohort: resolvedCohort,
      confidence,
      posterior,
      entryTier,
      executorRegime,
      allocatorAction,
      allocatorScore,
      allocatorLearningEpochActive,
      allocatorQuarantineEpochReleaseActive,
      alphaContextEpochReleaseActive,
      allocatorSnapshotAgeMs,
      allocatorSnapshotStale,
      allocatorSnapshotStaleReasons: allocatorSnapshotStaleReasons.slice(),
      allocatorGeneratedAtKst: allocatorSnapshot.generatedAtKst || null,
      allocatorPenaltyReasons,
      alphaContext: matchedAlphaContext,
      sameSideExposureRows: exposure.sameSideActive.map((row) => ({
        symbol: row.symbol,
        side: row.side,
        size_pct: row.size_pct,
        raw_size_pct: row.raw_size_pct,
        exposure_size_source: row.exposure_size_source,
        cluster_count_weight: row.cluster_count_weight,
        groupOverlap: row.groupOverlap.slice(),
      })),
      correlatedExposureRows: exposure.correlatedActive.map((row) => ({
        symbol: row.symbol,
        side: row.side,
        size_pct: row.size_pct,
        raw_size_pct: row.raw_size_pct,
        exposure_size_source: row.exposure_size_source,
        cluster_count_weight: row.cluster_count_weight,
        groupOverlap: row.groupOverlap.slice(),
      })),
      notes,
    },
    featuresPatch,
  };
}

module.exports = {
  evaluateOpenClawExecutionDecision,
  __test: {
    inferIntentDirection,
    resolveExitPositionSide,
    extractLatestExitRow,
    summarizeExposure,
    resolveConfidence,
    resolvePosterior,
    resolveEntryTier,
    resolveExecutorCohort,
    normalizeCapitalAllocatorSnapshot,
    resolveAllocatorSnapshotAgeMs,
    resolveAllocatorSnapshotStaleness,
    resolveEffectiveAlphaContext,
    parseCorrelatedGroups,
    hasActiveExposure,
    resolveRunnerAllowedRatioFromView,
    resolveEffectiveExposureSizePct,
    resolveClusterCountContribution,
    logAllocatorQuarantineEpochRelease,
    resetAllocatorEpochReleaseLogForTest,
    ALLOCATOR_EPOCH_RELEASE_LOG_WINDOW_MS,
  },
};
