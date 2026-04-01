const { getFirestore } = require("./firestore");
const { getSystemSettingsCached } = require("./settings");
const { normalizeSide, deriveGroupSubtype, makeDropKey } = require("../services/signalTaxonomy");
const { recordSignalDrops } = require("./signalDrops");
const { sendAlert } = require("../utils/alerts");
const { tfToMs, normalizeMarketSymbolForProvider, defaultExecTfFromEnv } = require("../utils/marketConfig");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseIsoMs(v) {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function toBool(v, fallback = false) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function isShadowSignal(entry) {
  if (!entry) return false;
  const source = String(entry.source || "").trim().toUpperCase();
  return entry.authoritative !== true && source === "PINE_SHADOW";
}

function clampMin(raw, fallback, min = 1) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.trunc(n));
}

const FALLBACK_GUARD_DEFAULTS = {
  scanLimit: 500,
  maxCallsPerMin: 30,
  cooldownMs: 15 * 60 * 1000,
  alertMinIntervalMs: 5 * 60 * 1000,
};

const FALLBACK_METRICS_WINDOW_MS = 60 * 1000;
const fallbackMetricState = {
  windowStartMs: 0,
  query_error: 0,
  empty_result: 0,
  fallback_used: 0,
};

const fallbackGuardState = {
  windowStartMs: 0,
  callsInWindow: 0,
  openUntilMs: 0,
};

const fallbackAlertState = new Map();
const fallbackBlockLogState = new Map();

function resolveFallbackGuardConfig() {
  return {
    scanLimit: clampMin(process.env.SIGNALS_FALLBACK_SCAN_LIMIT, FALLBACK_GUARD_DEFAULTS.scanLimit, 50),
    maxCallsPerMin: clampMin(process.env.SIGNALS_FALLBACK_MAX_CALLS_PER_MIN, FALLBACK_GUARD_DEFAULTS.maxCallsPerMin, 1),
    cooldownMs: clampMin(process.env.SIGNALS_FALLBACK_COOLDOWN_MS, FALLBACK_GUARD_DEFAULTS.cooldownMs, 1000),
    alertMinIntervalMs: clampMin(process.env.SIGNALS_FALLBACK_ALERT_MIN_INTERVAL_MS, FALLBACK_GUARD_DEFAULTS.alertMinIntervalMs, 1000),
    forceOpen: toBool(process.env.SIGNALS_FALLBACK_FORCE_OPEN, false),
    forceOpenUntilMs: Number(process.env.SIGNALS_FALLBACK_FORCE_OPEN_UNTIL_MS),
  };
}

async function resolveFallbackGuardConfigRuntime() {
  const base = resolveFallbackGuardConfig();
  try {
    const sys = await getSystemSettingsCached(30_000);
    const data = (sys && sys.data && typeof sys.data === "object") ? sys.data : {};

    let forceOpen = base.forceOpen;
    if (!forceOpen && Object.prototype.hasOwnProperty.call(data, "signals_fallback_force_open")) {
      forceOpen = toBool(data.signals_fallback_force_open, false);
    }

    let forceOpenUntilMs = Number(base.forceOpenUntilMs);
    const sysForceOpenUntilMs = Number(data.signals_fallback_force_open_until_ms);
    if (Number.isFinite(sysForceOpenUntilMs)) {
      forceOpenUntilMs = Number.isFinite(forceOpenUntilMs)
        ? Math.max(forceOpenUntilMs, sysForceOpenUntilMs)
        : sysForceOpenUntilMs;
    }

    return { ...base, forceOpen, forceOpenUntilMs };
  } catch (_) {
    return base;
  }
}

function structuredLog(event, payload = {}, level = "log") {
  const rec = {
    event,
    ts: new Date().toISOString(),
    ...payload,
  };
  const fn = level === "warn" ? "warn" : "log";
  try {
    console[fn](JSON.stringify(rec));
  } catch (_) {
    console[fn](`[${event}] ${JSON.stringify(payload)}`);
  }
}

function logFallbackBlockOnce({ reason, exchange, symbol, tf, caller }) {
  const now = Date.now();
  const key = `${reason}__${exchange}__${symbol}__${tf}__${caller}`;
  const prev = Number(fallbackBlockLogState.get(key));
  if (Number.isFinite(prev) && (now - prev) < 30 * 1000) return;
  fallbackBlockLogState.set(key, now);
  structuredLog("signals_fallback_blocked", { reason, exchange, symbol, tf, caller }, "warn");
}

async function maybeSendFallbackAlert({ event, severity = "WARN", title, body, minIntervalMs }) {
  if (toBool(process.env.SIGNALS_FALLBACK_ALERT_DISABLE, false)) return false;
  const now = Date.now();
  const last = Number(fallbackAlertState.get(event));
  if (Number.isFinite(last) && (now - last) < minIntervalMs) return false;
  fallbackAlertState.set(event, now);

  try {
    const sys = await getSystemSettingsCached(30_000);
    const channel = String(sys && sys.data && sys.data.alert_channel || "").trim();
    if (!channel) return false;
    await sendAlert({ channel, title, body, severity });
    return true;
  } catch (_) {
    return false;
  }
}

function flushFallbackMetricsWindow(nowMs) {
  if (!fallbackMetricState.windowStartMs) {
    fallbackMetricState.windowStartMs = nowMs;
    return;
  }
  if ((nowMs - fallbackMetricState.windowStartMs) < FALLBACK_METRICS_WINDOW_MS) return;
  structuredLog("signals_query_metrics", {
    window_ms: nowMs - fallbackMetricState.windowStartMs,
    query_error: fallbackMetricState.query_error,
    empty_result: fallbackMetricState.empty_result,
    fallback_used: fallbackMetricState.fallback_used,
  });
  fallbackMetricState.windowStartMs = nowMs;
  fallbackMetricState.query_error = 0;
  fallbackMetricState.empty_result = 0;
  fallbackMetricState.fallback_used = 0;
}

function bumpFallbackMetric(name) {
  if (!Object.prototype.hasOwnProperty.call(fallbackMetricState, name)) return;
  const now = Date.now();
  flushFallbackMetricsWindow(now);
  fallbackMetricState[name] += 1;
}

function ensureFallbackCircuitClosedIfExpired({ nowMs, cfg, context }) {
  if (!Number.isFinite(fallbackGuardState.openUntilMs) || fallbackGuardState.openUntilMs <= 0) return;
  if (nowMs < fallbackGuardState.openUntilMs) return;
  const prevOpenUntilMs = fallbackGuardState.openUntilMs;
  fallbackGuardState.openUntilMs = 0;
  fallbackGuardState.callsInWindow = 0;
  fallbackGuardState.windowStartMs = nowMs;
  structuredLog("signals_fallback_circuit_close", {
    exchange: context.exchange,
    symbol: context.symbol,
    tf: context.tf,
    caller: context.caller,
    prev_open_until_ms: prevOpenUntilMs,
    reason: "COOLDOWN_EXPIRED",
  });
  const title = "Signals fallback circuit closed";
  const body =
    `exchange=${context.exchange}\n` +
    `symbol=${context.symbol}\n` +
    `tf=${context.tf}\n` +
    `caller=${context.caller}\n` +
    `reason=COOLDOWN_EXPIRED`;
  maybeSendFallbackAlert({
    event: "signals_fallback_circuit_close",
    severity: "INFO",
    title,
    body,
    minIntervalMs: cfg.alertMinIntervalMs,
  }).catch(() => {});
}

function openFallbackCircuit({ nowMs, cfg, context, reason }) {
  const untilMs = nowMs + cfg.cooldownMs;
  fallbackGuardState.openUntilMs = untilMs;
  fallbackGuardState.callsInWindow = 0;
  fallbackGuardState.windowStartMs = nowMs;
  structuredLog("signals_fallback_circuit_open", {
    exchange: context.exchange,
    symbol: context.symbol,
    tf: context.tf,
    caller: context.caller,
    reason,
    cooldown_ms: cfg.cooldownMs,
    open_until_ms: untilMs,
    max_calls_per_min: cfg.maxCallsPerMin,
  }, "warn");
  const title = "Signals fallback circuit opened";
  const body =
    `exchange=${context.exchange}\n` +
    `symbol=${context.symbol}\n` +
    `tf=${context.tf}\n` +
    `caller=${context.caller}\n` +
    `reason=${reason}\n` +
    `cooldown_ms=${cfg.cooldownMs}`;
  maybeSendFallbackAlert({
    event: "signals_fallback_circuit_open",
    severity: "WARN",
    title,
    body,
    minIntervalMs: cfg.alertMinIntervalMs,
  }).catch(() => {});
}

function consumeFallbackPermit({ nowMs, cfg, context }) {
  ensureFallbackCircuitClosedIfExpired({ nowMs, cfg, context });
  if (cfg.forceOpen === true) {
    return { ok: false, reason: "FORCED_OPEN" };
  }
  if (Number.isFinite(cfg.forceOpenUntilMs) && cfg.forceOpenUntilMs > nowMs) {
    return { ok: false, reason: "FORCED_OPEN_UNTIL" };
  }
  if (Number.isFinite(fallbackGuardState.openUntilMs) && fallbackGuardState.openUntilMs > nowMs) {
    return { ok: false, reason: "CIRCUIT_OPEN" };
  }

  if (!fallbackGuardState.windowStartMs || (nowMs - fallbackGuardState.windowStartMs) >= 60 * 1000) {
    fallbackGuardState.windowStartMs = nowMs;
    fallbackGuardState.callsInWindow = 0;
  }

  if (fallbackGuardState.callsInWindow >= cfg.maxCallsPerMin) {
    openFallbackCircuit({ nowMs, cfg, context, reason: "RATE_LIMIT" });
    return { ok: false, reason: "RATE_LIMIT_OPENED" };
  }

  fallbackGuardState.callsInWindow += 1;
  return { ok: true, reason: "ALLOW" };
}

function resetFallbackGuardStateForTest() {
  fallbackGuardState.windowStartMs = 0;
  fallbackGuardState.callsInWindow = 0;
  fallbackGuardState.openUntilMs = 0;
  fallbackMetricState.windowStartMs = 0;
  fallbackMetricState.query_error = 0;
  fallbackMetricState.empty_result = 0;
  fallbackMetricState.fallback_used = 0;
  fallbackAlertState.clear();
  fallbackBlockLogState.clear();
}

function getLookbackBars(tf) {
  const raw = (process.env.SIGNALS_LOOKBACK_BARS !== undefined)
    ? process.env.SIGNALS_LOOKBACK_BARS
    : process.env.SIGNALS_LATE_BARS;
  const useRaw = (raw === undefined || raw === "") ? "2" : raw;
  const n = Math.floor(Number(useRaw));
  if (Number.isFinite(n) && n > 0) return n;
  return 0;
}

function getLateMaxAgeMs(tfMs) {
  const raw = process.env.SIGNALS_LATE_MAX_AGE_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return Number.isFinite(tfMs) ? tfMs * 2 : null;
}

function isConsumed(doc) {
  // v1 schema: consumed_at / consumed_run_id
  if (!doc) return false;
  if (doc.consumed_run_id) return true;
  if (doc.consumed_at) return true;
  return false;
}

function isLocked(doc) {
  if (!doc) return false;
  if (doc.locked_run_id) return true;
  if (doc.locked_at) return true;
  return false;
}

// Default allowlist for signal event names.
//
// NOTE:
// - External webhook signals observed in this repo/docs use events such as
//   LONG / SHORT / EMO_LONG (and their SHORT variants).
// - Some legacy/internal schemas used ENTRY_* / EXIT_* / HEDGE_*.
//
// Keeping both sets in the default allowlist prevents a "signals received but
// never traded" failure mode when SIGNALS_EVENTS is not explicitly configured.
const DEFAULT_EVENTS = [
  // Common external entries/exits
  "LONG",
  "EMO_LONG",
  "SHORT",
  "EMO_SHORT",
  "EXIT_LONG",
  "EXIT_SHORT",
  "ICHI BELL LONG",
  "ICHI BELL SHORT",

  // Legacy/internal events
  "ENTRY_CORE_43",
  "ENTRY_CORE_46",
  "ENTRY_CORE_47",
  "ENTRY_CORE_48",
  "ENTRY_CORE_49",
  "ENTRY_CORE_50",
  "ENTRY_CORE_51",
  "ENTRY_REAL_50",
  "EXIT_CORE_25",
  "EXIT_REAL_25",
  "EXIT_SL_2P",
  "EXIT_SL_3P",
  "EXIT_SL_4P",
  "EXIT_BE_0P",
  "EXIT_TP_C_5P",
  "EXIT_TP_P1_5P",
  "EXIT_TP_P1_3P",
  "EXIT_TRAIL_2P",
  "EXIT_LIQUIDATION_RISK",
  "EXIT_OPPOSITE_SIGNAL",
  "EXIT_TRAIL_2P",
  "TP_C_5P",
  "FORCE_EXIT",
  "FORCE_EXIT_OVERNIGHT",
  "FORCE_EXIT_RISK",
  "HEDGE_ON",
  "HEDGE_OFF",
];

function isDynamicExitEvent(evt) {
  if (!evt) return false;
  return (
    evt.startsWith("EXIT_SL_") ||
    evt.startsWith("EXIT_TP_P1_") ||
    evt.startsWith("EXIT_TP_C_") ||
    evt.startsWith("EXIT_TRAIL_") ||
    evt.startsWith("EXIT_BE_")
  );
}

function isAllowedEvent(evt, eventList) {
  if (!evt) return false;
  if (eventList.includes(evt)) return true;
  return isDynamicExitEvent(evt);
}

// DROP_FILTERS_MODE: record | enforce
// - record : 드롭필터를 기록만 하고 실제 차단하지 않음
// - enforce: 드롭필터 실제 차단
function getDropFiltersMode() {
  const m = String(process.env.DROP_FILTERS_MODE || "record").trim().toLowerCase();
  return m === "enforce" ? "enforce" : "record";
}

let dropCache = {
  key: null,
  at: 0,
  ttlMs: 30 * 1000,
  set: new Set(),
};

async function loadDropFilters({ exchange, symbol_or_pair_id, tf }) {
  const mode = getDropFiltersMode();
  if (mode !== "enforce") return new Set();

  const ex = String(exchange || "BINANCEFUT").toUpperCase();
  const sym = String(symbol_or_pair_id || "").trim();
  const t = String(tf || defaultExecTfFromEnv() || "15m").trim();
  const cacheKey = `${ex}__${sym}__${t}`;

  const now = Date.now();
  if (dropCache.key === cacheKey && now - dropCache.at < dropCache.ttlMs) {
    return dropCache.set;
  }

  const db = getFirestore();
  const blocked = new Set();

  // Firestore does not support (symbol_or_pair_id == sym OR symbol == sym)
  // in a single query. We query both and merge.
  const snaps = [];

  try {
    const q1 = db
      .collection("filters_drop")
      .where("exchange", "==", ex)
      .where("symbol_or_pair_id", "==", sym)
      .where("tf", "==", t)
      .limit(500);
    snaps.push(await q1.get());
  } catch (_) {
    // Fail-open: do not block signals if the index/query is missing.
  }

  try {
    const q2 = db
      .collection("filters_drop")
      .where("exchange", "==", ex)
      .where("symbol", "==", sym)
      .where("tf", "==", t)
      .limit(500);
    snaps.push(await q2.get());
  } catch (_) {
   // Fail-open.
  }

  if (snaps.length === 0) {
    try {
      const q3 = db.collection("filters_drop").orderBy("updated_at", "desc").limit(800);
      snaps.push(await q3.get());
    } catch (_) {
      // Fail-open.
    }
  }

  const seen = new Set();
  for (const snap of snaps) {
    if (!snap) continue;
    snap.forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);

      const r = d.data() || {};

      const rx = String(r.exchange || "").toUpperCase();
      const rsym = String(r.symbol_or_pair_id || r.symbol || "").trim();
      const rtf = String(r.tf || "").trim();

      if (rx && rx !== ex) return;
      if (rtf && rtf !== t) return;
      if (rsym && rsym !== sym) return;

      const m = String(r.mode || "HARD").toUpperCase();
      const softEnabled = String(process.env.DROP_FILTERS_ENFORCE_SOFT || "0") === "1";
      if (m === "SOFT" && !softEnabled) return;
      const side = normalizeSide(r.side);
      const group = String(r.group || "UNKNOWN").toUpperCase();
      const subtype = String(r.subtype || "NA").toUpperCase();

      blocked.add(makeDropKey({ side, group, subtype }));
      // HARD = block the whole group, SOFT = block only subtype.
      if (m === "HARD") blocked.add(`${side}__${group}__ALL`);
    });
  }

  dropCache = { ...dropCache, key: cacheKey, at: now, set: blocked };
  return blocked;
}
async function queryDeterministicWindow({ exchange, symbol_or_pair_id, tf, barCloseTimeUtcMs, windowMs, caller }) {
  const db = getFirestore();
  const from = Number(barCloseTimeUtcMs) - Number(windowMs);
  const to = Number(barCloseTimeUtcMs) + Number(windowMs);

  const ex = String(exchange || "BINANCEFUT").toUpperCase();
  const sym = String(symbol_or_pair_id || "").trim();
  const t = String(tf || defaultExecTfFromEnv() || "15m").trim();

  const events = (process.env.SIGNALS_EVENTS || "").trim();
  const eventList = events ? events.split(",").map((x) => x.trim()).filter(Boolean) : DEFAULT_EVENTS;

  const out = [];
  const docs = [];
  const seen = new Set();
  let queryError = false;

  const fields = ["symbol_or_pair_id", "symbol"];
  for (const field of fields) {
    try {
      const snap = await db
        .collection("signals")
        .where("exchange", "==", ex)
        .where(field, "==", sym)
        .where("tf", "==", t)
        .where("bar_close_time_utc_ms", ">=", from)
        .where("bar_close_time_utc_ms", "<=", to)
        .limit(200)
        .get();
      snap.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        docs.push(d);
      });
    } catch (_) {
      queryError = true;
    }
  }

  if (docs.length === 0 && queryError) {
    // Missing composite index (or transient Firestore error):
    // signal lookup can still proceed via explicit fallback scan.
    bumpFallbackMetric("query_error");
    structuredLog("signals_query_error", {
      exchange: ex,
      symbol: sym,
      tf: t,
      caller: caller || "UNKNOWN",
      stage: "DETERMINISTIC",
    }, "warn");
    return { rows: [], queryError: true };
  }

  docs.forEach((d) => {
    const s = d.data() || {};
    if (isConsumed(s) || isLocked(s)) return;

    const evt = String(s.event || "").toUpperCase();
    if (!isAllowedEvent(evt, eventList)) return;

    out.push(s);
  });

  if (out.length === 0) {
    bumpFallbackMetric("empty_result");
  }

  return { rows: out, queryError: false };
}

async function queryFallbackScan({ exchange, symbol_or_pair_id, tf, barCloseTimeUtcMs, scanLimit, caller }) {
  const db = getFirestore();

  const ex = String(exchange || "BINANCEFUT").toUpperCase();
  const sym = String(symbol_or_pair_id || "").trim();
  const t = String(tf || defaultExecTfFromEnv() || "15m").trim();
  const exList = ex === "BINANCEFUT" ? [ex, "BINANCE"] : [ex];

  const out = [];
  const docs = [];
  try {
    for (const exValue of exList) {
      try {
        const q = await db
          .collection("signals")
          .where("exchange", "==", exValue)
          .where("symbol_or_pair_id", "==", sym)
          .where("tf", "==", t)
          .orderBy("created_at", "desc")
          .limit(scanLimit)
          .get();
        q.forEach((d) => docs.push(d));
      } catch (_) {}
    }
  } catch (_) {}

  if (docs.length === 0) {
    // Missing composite index -> fall back to unfiltered scan
    const snap = await db
      .collection("signals")
      .orderBy("created_at", "desc")
      .limit(scanLimit)
      .get();
    snap.forEach((d) => docs.push(d));
  }

  const normalize = (v) => String(v || "").trim();
  const normSym = normalizeMarketSymbolForProvider(sym, ex) || sym;
  docs.forEach((d) => {
    const s = d.data() || {};
    if (isConsumed(s) || isLocked(s)) return;
    const sx = String(s.exchange || "").toUpperCase();
    if (!exList.includes(sx)) return;
    const sSymRaw = normalize(s.symbol_or_pair_id || s.symbol || "");
    const sSym = normalizeMarketSymbolForProvider(sSymRaw, ex) || sSymRaw;
    if (normalize(sSym) !== normalize(normSym)) {
      return;
    }
    if (String(s.tf || "").trim() !== t) return;
    if (toNum(s.bar_close_time_utc_ms) !== toNum(barCloseTimeUtcMs)) return;
    out.push(s);
  });

  out.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  structuredLog("signals_fallback_used", {
    exchange: ex,
    symbol: sym,
    tf: t,
    caller: caller || "UNKNOWN",
    scan_limit: scanLimit,
    matched_rows: out.length,
  }, "warn");
  bumpFallbackMetric("fallback_used");
  return out;
}

async function getSignalsFromStorage({
  exchange = "BINANCEFUT",
  symbol,
  tf = defaultExecTfFromEnv() || "15m",
  barCloseTimeUtcMs,
  windowMs = 40 * 1000,
  scanLimit = 4000,
  caller = "getSignalsFromStorage",
  includeShadow = false,
}) {
  const ex = String(exchange || "BINANCEFUT").toUpperCase();
  const sym = String(symbol || "").trim();
  const t = String(tf || defaultExecTfFromEnv() || "15m").trim();
  const barMs = toNum(barCloseTimeUtcMs);

  if (!sym || barMs === null) return [];

  // 1) deterministic window (fast)
  const deterministic = await queryDeterministicWindow({
    exchange: ex,
    symbol_or_pair_id: sym,
    tf: t,
    barCloseTimeUtcMs: barMs,
    windowMs,
    caller,
  });
  let signals = Array.isArray(deterministic) ? deterministic : (deterministic.rows || []);
  const deterministicError = !!(deterministic && !Array.isArray(deterministic) && deterministic.queryError === true);
  const cfg = await resolveFallbackGuardConfigRuntime();
  const effectiveScanLimit = Math.min(
    Math.max(50, Number.isFinite(Number(scanLimit)) ? Number(scanLimit) : cfg.scanLimit),
    cfg.scanLimit
  );

  // 2) fallback scan (slow) only if deterministic query itself failed.
  // Avoid full scans on "no signal for this bar" because that explodes Firestore read cost.
  if (signals.length === 0 && deterministicError) {
    const permit = consumeFallbackPermit({
      nowMs: Date.now(),
      cfg,
      context: { exchange: ex, symbol: sym, tf: t, caller },
    });
    if (permit.ok) {
      signals = await queryFallbackScan({
        exchange: ex,
        symbol_or_pair_id: sym,
        tf: t,
        barCloseTimeUtcMs: barMs,
        scanLimit: effectiveScanLimit,
        caller,
      });
    } else {
      logFallbackBlockOnce({
        reason: permit.reason,
        exchange: ex,
        symbol: sym,
        tf: t,
        caller,
      });
    }
  }

  // drop filter (optional)
  if (!includeShadow) {
    signals = signals.filter((row) => !isShadowSignal(row));
  }

  // drop filter (optional)
  const blocked = await loadDropFilters({ exchange: ex, symbol_or_pair_id: sym, tf: t });
  if (blocked.size > 0) {
    const kept = [];
    const dropped = [];
    for (const s of signals) {
      const side = normalizeSide(s.side || s.action);
      const derived = deriveGroupSubtype(s.event);
      const group = String(s.event_group || s.group || derived.group || "UNKNOWN").toUpperCase();
      const subtype = String(s.event_subtype || s.subtype || derived.subtype || "GEN").toUpperCase();
      const k = makeDropKey({ side, group, subtype });
      const k2 = `${side}__${group}__ALL`;
      if (blocked.has(k) || blocked.has(k2)) {
        dropped.push({
          ...s,
          side,
          event_group: group,
          event_subtype: subtype,
          drop_key: k,
          drop_reason_code: `DROP_FILTER_${side}__${group}__${subtype}`,
        });
      } else {
        kept.push(s);
      }
    }
    signals = kept;
    if (dropped.length) {
      await recordSignalDrops({ exchange: ex, symbol: sym, tf: t, drops: dropped });
    }
  }

  // deterministic order
  signals.sort((a, b) => {
    const ams = toNum(a.bar_close_time_utc_ms) || 0;
    const bms = toNum(b.bar_close_time_utc_ms) || 0;
    if (ams !== bms) return ams - bms;
    return String(a.event || "").localeCompare(String(b.event || ""));
  });

  return signals;
}

// legacy adapter used by engine modules
async function getSignalsForBar({
  exchange = "BINANCEFUT",
  symbol,
  tf = defaultExecTfFromEnv() || "15m",
  barCloseMs,
  limitN = 200,
  maxLookbackBars,
  maxLookaheadBars = 0,
  caller = "getSignalsForBar",
  includeShadow = false,
} = {}) {
  const barMs = toNum(barCloseMs);
  if (!symbol || barMs === null) return [];

  const cfg = resolveFallbackGuardConfig();
  const scanLimit = Math.max(cfg.scanLimit, Number(limitN) * 5);
  let lookbackBars = getLookbackBars(tf);
  let lookaheadBars = Math.max(0, Math.floor(Number(maxLookaheadBars) || 0));
  const cap = Math.floor(Number(maxLookbackBars));
  if (Number.isFinite(cap) && cap >= 0) {
    lookbackBars = Math.min(lookbackBars, cap);
  }
  if (!lookbackBars && !lookaheadBars) {
    const out = await getSignalsFromStorage({
      exchange,
      symbol,
      tf,
      barCloseTimeUtcMs: barMs,
      scanLimit,
      caller,
      includeShadow,
    });
    return out.slice(0, Number(limitN) || 200);
  }

  const tfMs = tfToMs(tf);
  if (!Number.isFinite(tfMs) || tfMs <= 0) {
    const out = await getSignalsFromStorage({
      exchange,
      symbol,
      tf,
      barCloseTimeUtcMs: barMs,
      scanLimit,
      caller,
      includeShadow,
    });
    return out.slice(0, Number(limitN) || 200);
  }

  const maxAgeMs = getLateMaxAgeMs(tfMs);
  const nowMs = Date.now();
  const seen = new Set();
  const all = [];

  for (let i = lookaheadBars; i >= 1; i -= 1) {
    const targetMs = barMs + (i * tfMs);
    const rows = await getSignalsFromStorage({
      exchange,
      symbol,
      tf,
      barCloseTimeUtcMs: targetMs,
      scanLimit,
      caller: `${caller}:lookahead`,
      includeShadow,
    });
    for (const s of rows) {
      const id = s.signal_id || `${s.exchange || ""}__${s.symbol_or_pair_id || s.symbol || ""}__${s.tf || ""}__${s.bar_close_time_utc_ms || ""}__${s.event || ""}`;
      if (seen.has(id)) continue;
      if (Number.isFinite(maxAgeMs)) {
        const createdMs = parseIsoMs(s.created_at || s.created_kst || s.updated_at);
        if (Number.isFinite(createdMs) && (nowMs - createdMs) > maxAgeMs) continue;
      }
      seen.add(id);
      all.push(s);
    }
  }

  for (let i = 0; i <= lookbackBars; i += 1) {
    const targetMs = barMs - (i * tfMs);
    const rows = await getSignalsFromStorage({
      exchange,
      symbol,
      tf,
      barCloseTimeUtcMs: targetMs,
      scanLimit,
      caller: i === 0 ? caller : `${caller}:lookback`,
      includeShadow,
    });
    for (const s of rows) {
      const id = s.signal_id || `${s.exchange || ""}__${s.symbol_or_pair_id || s.symbol || ""}__${s.tf || ""}__${s.bar_close_time_utc_ms || ""}__${s.event || ""}`;
      if (seen.has(id)) continue;
      if (Number.isFinite(maxAgeMs)) {
        const createdMs = parseIsoMs(s.created_at || s.created_kst || s.updated_at);
        if (Number.isFinite(createdMs) && (nowMs - createdMs) > maxAgeMs) continue;
      }
      seen.add(id);
      all.push(s);
    }
  }

  all.sort((a, b) => {
    const ams = toNum(a.bar_close_time_utc_ms) || 0;
    const bms = toNum(b.bar_close_time_utc_ms) || 0;
    if (ams !== bms) return ams - bms;
    return String(a.event || "").localeCompare(String(b.event || ""));
  });

  return all.slice(0, Number(limitN) || 200);
}

async function listSignalsByMarket({ exchange = "BINANCEFUT", market, tf = defaultExecTfFromEnv() || "15m", limit = 50, includeShadow = false } = {}) {
  const db = getFirestore();
  const ex = String(exchange || "BINANCEFUT").toUpperCase();
  const symRaw = String(market || "").trim();
  if (!symRaw) return [];
  const sym = normalizeMarketSymbolForProvider(symRaw, ex) || symRaw;
  const t = String(tf || defaultExecTfFromEnv() || "15m").trim();

  const events = (process.env.SIGNALS_EVENTS || "").trim();
  const eventList = events ? events.split(",").map((x) => x.trim()).filter(Boolean) : DEFAULT_EVENTS;
  const scanLimit = Math.max(200, Number(limit) * 20);

  const docs = [];
  const seenDoc = new Set();

  const pushDocs = (snap) => {
    if (!snap) return;
    snap.forEach((d) => {
      if (seenDoc.has(d.id)) return;
      seenDoc.add(d.id);
      docs.push(d);
    });
  };

  try {
    const q1 = await db
      .collection("signals")
      .where("exchange", "==", ex)
      .where("symbol_or_pair_id", "==", sym)
      .where("tf", "==", t)
      .orderBy("created_at", "desc")
      .limit(scanLimit)
      .get();
    pushDocs(q1);
  } catch (_) {}

  try {
    const q2 = await db
      .collection("signals")
      .where("exchange", "==", ex)
      .where("symbol", "==", sym)
      .where("tf", "==", t)
      .orderBy("created_at", "desc")
      .limit(scanLimit)
      .get();
    pushDocs(q2);
  } catch (_) {}

  if (docs.length === 0) {
    try {
      const q3 = await db
        .collection("signals")
        .orderBy("created_at", "desc")
        .limit(scanLimit)
        .get();
      pushDocs(q3);
    } catch (_) {}
  }

  const out = [];
  for (const d of docs) {
    const s = d.data() || {};
    if (isConsumed(s) || isLocked(s)) continue;
    const sx = String(s.exchange || "").toUpperCase();
    if (sx && sx !== ex) continue;
    const sSymRaw = String(s.symbol_or_pair_id || s.symbol || "").trim();
    const sSym = normalizeMarketSymbolForProvider(sSymRaw, ex) || sSymRaw;
    if (sSym !== sym) continue;
    if (String(s.tf || "").trim() !== t) continue;
    const evt = String(s.event || "").trim().toUpperCase();
    if (eventList.length && !isAllowedEvent(evt, eventList)) continue;
    if (!includeShadow && isShadowSignal(s)) continue;
    out.push(s);
    if (out.length >= Number(limit)) break;
  }

  out.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return out.slice(0, Number(limit));
}

module.exports = {
  getSignalsFromStorage,
  getSignalsForBar,
  listSignalsByMarket,
  loadDropFilters,
  getDropFiltersMode,
  __test: {
    resolveFallbackGuardConfig,
    consumeFallbackPermit,
    ensureFallbackCircuitClosedIfExpired,
    resetFallbackGuardStateForTest,
    fallbackGuardState,
    fallbackMetricState,
  },
};
