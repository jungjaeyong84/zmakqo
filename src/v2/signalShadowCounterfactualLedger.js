"use strict";

// V2 Signal Shadow Counterfactual Ledger (F0/F1).
//
// Records every signal evaluation — whether the upstream signal passed
// the live gate or not, AND whether each shadow filter said WOULD_BLOCK
// or WOULD_PASS — so a later analysis layer can compute, per filter and
// per filter-combination, the counterfactual MFE/MAE/return distribution
// of the signals each filter would have removed.
//
// Design constraints:
// - Default OFF behind `DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED`
//   so this is purely additive evidence accumulation. No live decision
//   reads from this collection.
// - Pure decision logic separated from Firestore I/O. The closer
//   accepts an injectable kline fetcher so it is testable without
//   network access.
// - One record per (symbol, candle_close_ms, side, filter_combination_hash).
//   Multiple signals on the same candle with the same filter outcome
//   collapse to the same doc — idempotent set with merge.
// - Records carry the *filter combination*, so a downstream analysis can
//   do leave-one-out attribution: "what was the marginal contribution
//   of BTC_1H_TREND when it was the only blocker vs. when it co-occurred
//   with MULTI_TF_1H_ALIGNMENT?"

const crypto = require("crypto");

const COLLECTION_NAME = "v2__signal_shadow_counterfactuals";

const DEFAULT_HORIZON_BARS = 24;
const DEFAULT_BAR_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 50;

const STATUS_PENDING = "PENDING";
const STATUS_CLOSED = "CLOSED";
const STATUS_EXPIRED = "EXPIRED";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback, minimum = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(minimum, Number(fallback) || minimum);
  return Math.max(minimum, Math.floor(num));
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function safeDocId(value) {
  return String(value == null ? "UNKNOWN" : value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 200) || "UNKNOWN";
}

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
}

function normalizeSide(value) {
  const token = upper(value);
  if (token === "LONG" || token === "BUY") return "LONG";
  if (token === "SHORT" || token === "SELL") return "SHORT";
  return null;
}

function uniqueSorted(values) {
  const list = Array.isArray(values) ? values : [];
  return Array.from(new Set(list.filter((v) => trimOrNull(v) !== null).map((v) => String(v))))
    .sort();
}

function buildFilterCombinationHash({
  would_block_filter_set = [],
  would_pass_filter_set = [],
  insufficient_evidence_filter_set = [],
} = {}) {
  const blockSet = uniqueSorted(would_block_filter_set);
  const passSet = uniqueSorted(would_pass_filter_set);
  const insufficientSet = uniqueSorted(insufficient_evidence_filter_set);
  const canonical = `BLOCK[${blockSet.join("|")}]PASS[${passSet.join("|")}]INSUF[${insufficientSet.join("|")}]`;
  return shortHash(canonical);
}

function buildCounterfactualDocId({ symbol, side, candle_close_ms, filter_combination_hash }) {
  const sym = safeDocId(symbol);
  const sd = safeDocId(side);
  const candleMs = Number(candle_close_ms);
  const candle = Number.isFinite(candleMs) ? Math.floor(candleMs).toString() : "0";
  const hash = safeDocId(filter_combination_hash || "no_hash");
  return `${sym}__${candle}__${sd}__${hash}`;
}

function buildCounterfactualDocPath(docId) {
  return `${COLLECTION_NAME}/${docId}`;
}

function resolveCounterfactualLedgerPolicy(env = process.env) {
  return Object.freeze({
    enabled: parseBool(env && env.DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED, false),
    horizon_bars: parsePositiveInt(
      env && env.DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_HORIZON_BARS,
      DEFAULT_HORIZON_BARS,
      1
    ),
    bar_interval_ms: parsePositiveInt(
      env && env.DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_BAR_INTERVAL_MS,
      DEFAULT_BAR_INTERVAL_MS,
      1000
    ),
    max_age_ms: parsePositiveInt(
      env && env.DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_MAX_AGE_MS,
      DEFAULT_MAX_AGE_MS,
      60 * 60 * 1000
    ),
    batch_limit: parsePositiveInt(
      env && env.DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_BATCH_LIMIT,
      DEFAULT_BATCH_LIMIT,
      1
    ),
  });
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function extractFilterSetsFromShadowDecision(shadowFilterDecision) {
  const decision = asObject(shadowFilterDecision);
  const filters = Array.isArray(decision && decision.filters) ? decision.filters : [];
  const wouldBlock = [];
  const wouldPass = [];
  const insufficient = [];
  for (const row of filters) {
    const obj = asObject(row);
    if (!obj || !trimOrNull(obj.id)) continue;
    if (obj.would_block === true) wouldBlock.push(obj.id);
    else if (obj.status === "WOULD_PASS") wouldPass.push(obj.id);
    else if (obj.status === "INSUFFICIENT_EVIDENCE") insufficient.push(obj.id);
    else if (obj.status === "NOT_APPLICABLE") continue;
  }
  return Object.freeze({
    would_block_filter_set: Object.freeze(uniqueSorted(wouldBlock)),
    would_pass_filter_set: Object.freeze(uniqueSorted(wouldPass)),
    insufficient_evidence_filter_set: Object.freeze(uniqueSorted(insufficient)),
  });
}

function buildPendingRecord({
  symbol,
  side,
  candle_close_ms,
  ref_price = null,
  signal_id = null,
  signal_verdict = null,
  shadow_filter_decision = null,
  horizon_bars = DEFAULT_HORIZON_BARS,
  bar_interval_ms = DEFAULT_BAR_INTERVAL_MS,
  now_ms,
} = {}) {
  const normalizedSide = normalizeSide(side);
  const normalizedSymbol = upper(symbol);
  const candleMs = Number(candle_close_ms);
  if (!normalizedSymbol) throw new Error("COUNTERFACTUAL_LEDGER_SYMBOL_REQUIRED");
  if (!normalizedSide) throw new Error("COUNTERFACTUAL_LEDGER_SIDE_REQUIRED");
  if (!Number.isFinite(candleMs)) throw new Error("COUNTERFACTUAL_LEDGER_CANDLE_CLOSE_MS_REQUIRED");
  const sets = extractFilterSetsFromShadowDecision(shadow_filter_decision);
  const filterCombinationHash = buildFilterCombinationHash(sets);
  const docId = buildCounterfactualDocId({
    symbol: normalizedSymbol,
    side: normalizedSide,
    candle_close_ms: candleMs,
    filter_combination_hash: filterCombinationHash,
  });
  const horizonBars = parsePositiveInt(horizon_bars, DEFAULT_HORIZON_BARS, 1);
  const barIntervalMs = parsePositiveInt(bar_interval_ms, DEFAULT_BAR_INTERVAL_MS, 1000);
  const horizonCloseMs = candleMs + (horizonBars * barIntervalMs);
  const verdict = upper(signal_verdict);
  const shadowVerdict = upper(asObject(shadow_filter_decision) && asObject(shadow_filter_decision).shadow_verdict);
  const refPrice = toNumberOrNull(ref_price);
  return Object.freeze({
    doc_id: docId,
    doc_path: buildCounterfactualDocPath(docId),
    record: Object.freeze({
      record_type: "V2_SIGNAL_SHADOW_COUNTERFACTUAL",
      symbol: normalizedSymbol,
      side: normalizedSide,
      candle_close_ms: candleMs,
      candle_close_iso: new Date(candleMs).toISOString(),
      ref_price: refPrice,
      signal_id: trimOrNull(signal_id),
      signal_verdict: verdict === "PASS" ? "PASS" : (verdict === "BLOCK" ? "BLOCK" : null),
      shadow_verdict: shadowVerdict === "WOULD_BLOCK" ? "WOULD_BLOCK"
        : (shadowVerdict === "WOULD_PASS" ? "WOULD_PASS" : null),
      would_block_filter_set: sets.would_block_filter_set,
      would_pass_filter_set: sets.would_pass_filter_set,
      insufficient_evidence_filter_set: sets.insufficient_evidence_filter_set,
      filter_combination_hash: filterCombinationHash,
      status: STATUS_PENDING,
      horizon_bars: horizonBars,
      bar_interval_ms: barIntervalMs,
      horizon_close_ms: horizonCloseMs,
      horizon_close_iso: new Date(horizonCloseMs).toISOString(),
      created_at_ms: Number.isFinite(Number(now_ms)) ? Number(now_ms) : Date.now(),
      created_at_iso: new Date(Number.isFinite(Number(now_ms)) ? Number(now_ms) : Date.now()).toISOString(),
      closed_at_ms: null,
      closed_at_iso: null,
      mfe_pct: null,
      mae_pct: null,
      exit_close_pct: null,
      bar_n_observed: null,
      close_reason: null,
    }),
  });
}

function evaluatePendingExpiry({ pending, now_ms, max_age_ms = DEFAULT_MAX_AGE_MS } = {}) {
  const row = asObject(pending);
  if (!row) return Object.freeze({ action: "WAIT", reason: "PENDING_NOT_OBJECT" });
  const status = upper(row.status);
  if (status === STATUS_CLOSED) return Object.freeze({ action: "SKIP", reason: "ALREADY_CLOSED" });
  if (status === STATUS_EXPIRED) return Object.freeze({ action: "SKIP", reason: "ALREADY_EXPIRED" });
  const horizonCloseMs = Number(row.horizon_close_ms);
  const createdAtMs = Number(row.created_at_ms);
  const now = Number(now_ms);
  if (!Number.isFinite(horizonCloseMs) || !Number.isFinite(createdAtMs) || !Number.isFinite(now)) {
    return Object.freeze({ action: "WAIT", reason: "MISSING_TIMESTAMPS" });
  }
  if (now < horizonCloseMs) return Object.freeze({ action: "WAIT", reason: "BEFORE_HORIZON" });
  const ageMs = now - createdAtMs;
  if (ageMs > max_age_ms) return Object.freeze({ action: "EXPIRE", reason: "EXCEEDED_MAX_AGE" });
  return Object.freeze({ action: "CLOSE", reason: "HORIZON_REACHED" });
}

function closeRecordFromKlines({ pending, klines, now_ms } = {}) {
  const row = asObject(pending);
  if (!row) throw new Error("COUNTERFACTUAL_CLOSE_PENDING_REQUIRED");
  const side = normalizeSide(row.side);
  if (!side) throw new Error("COUNTERFACTUAL_CLOSE_SIDE_INVALID");
  const refPrice = toNumberOrNull(row.ref_price);
  const list = Array.isArray(klines) ? klines : [];
  const candleMs = Number(row.candle_close_ms);
  const horizonCloseMs = Number(row.horizon_close_ms);
  let highestHigh = null;
  let lowestLow = null;
  let lastClose = null;
  let barNObserved = 0;
  for (const k of list) {
    if (!k) continue;
    const openMs = toNumberOrNull(Array.isArray(k) ? k[0] : k.open_ms ?? k.openTime ?? k.t);
    const high = toNumberOrNull(Array.isArray(k) ? k[2] : k.high ?? k.h);
    const low = toNumberOrNull(Array.isArray(k) ? k[3] : k.low ?? k.l);
    const close = toNumberOrNull(Array.isArray(k) ? k[4] : k.close ?? k.c);
    if (openMs === null || high === null || low === null || close === null) continue;
    if (Number.isFinite(candleMs) && openMs < candleMs) continue;
    if (Number.isFinite(horizonCloseMs) && openMs > horizonCloseMs) break;
    barNObserved += 1;
    highestHigh = highestHigh === null ? high : Math.max(highestHigh, high);
    lowestLow = lowestLow === null ? low : Math.min(lowestLow, low);
    lastClose = close;
  }
  const refValid = refPrice !== null && refPrice > 0;
  const mfeRawPct = refValid && highestHigh !== null && lowestLow !== null
    ? (side === "LONG"
      ? (highestHigh - refPrice) / refPrice
      : (refPrice - lowestLow) / refPrice)
    : null;
  const maeRawPct = refValid && highestHigh !== null && lowestLow !== null
    ? (side === "LONG"
      ? (refPrice - lowestLow) / refPrice
      : (highestHigh - refPrice) / refPrice)
    : null;
  const exitClosePct = refValid && lastClose !== null
    ? (side === "LONG"
      ? (lastClose - refPrice) / refPrice
      : (refPrice - lastClose) / refPrice)
    : null;
  const closedAtMs = Number.isFinite(Number(now_ms)) ? Number(now_ms) : Date.now();
  return Object.freeze({
    status: STATUS_CLOSED,
    closed_at_ms: closedAtMs,
    closed_at_iso: new Date(closedAtMs).toISOString(),
    mfe_pct: mfeRawPct,
    mae_pct: maeRawPct,
    exit_close_pct: exitClosePct,
    bar_n_observed: barNObserved,
    close_reason: barNObserved > 0 ? "HORIZON_KLINES" : "NO_KLINES",
  });
}

function buildExpiredUpdate({ now_ms } = {}) {
  const closedAtMs = Number.isFinite(Number(now_ms)) ? Number(now_ms) : Date.now();
  return Object.freeze({
    status: STATUS_EXPIRED,
    closed_at_ms: closedAtMs,
    closed_at_iso: new Date(closedAtMs).toISOString(),
    close_reason: "MAX_AGE_EXCEEDED",
  });
}

function resolveDocRef(db, docId) {
  if (!db) throw new Error("COUNTERFACTUAL_LEDGER_FIRESTORE_DB_REQUIRED");
  if (typeof db.doc === "function") return db.doc(buildCounterfactualDocPath(docId));
  if (typeof db.collection === "function") return db.collection(COLLECTION_NAME).doc(docId);
  throw new Error("COUNTERFACTUAL_LEDGER_FIRESTORE_REF_UNAVAILABLE");
}

function resolveCollectionRef(db) {
  if (!db) throw new Error("COUNTERFACTUAL_LEDGER_FIRESTORE_DB_REQUIRED");
  if (typeof db.collection === "function") return db.collection(COLLECTION_NAME);
  throw new Error("COUNTERFACTUAL_LEDGER_FIRESTORE_COLLECTION_UNAVAILABLE");
}

async function recordCounterfactualEvaluation({
  db,
  env = process.env,
  symbol,
  side,
  candle_close_ms,
  ref_price = null,
  signal_id = null,
  signal_verdict = null,
  shadow_filter_decision = null,
  now_ms = Date.now(),
} = {}) {
  const policy = resolveCounterfactualLedgerPolicy(env);
  if (!policy.enabled) {
    return Object.freeze({ ok: true, reason: "LEDGER_DISABLED", written: false });
  }
  if (!db) {
    return Object.freeze({ ok: false, reason: "LEDGER_FIRESTORE_UNAVAILABLE", written: false });
  }
  let pending;
  try {
    pending = buildPendingRecord({
      symbol,
      side,
      candle_close_ms,
      ref_price,
      signal_id,
      signal_verdict,
      shadow_filter_decision,
      horizon_bars: policy.horizon_bars,
      bar_interval_ms: policy.bar_interval_ms,
      now_ms,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "LEDGER_BUILD_FAILED",
      error_message: error && error.message ? String(error.message) : String(error),
      written: false,
    });
  }
  let ref;
  try {
    ref = resolveDocRef(db, pending.doc_id);
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "LEDGER_REF_FAILED",
      error_message: error && error.message ? String(error.message) : String(error),
      written: false,
    });
  }
  try {
    if (typeof ref.get === "function" && typeof ref.set === "function") {
      const snap = await ref.get();
      if (snap && snap.exists === true) {
        const existing = typeof snap.data === "function" ? snap.data() : null;
        if (existing && upper(existing.status) === STATUS_CLOSED) {
          return Object.freeze({
            ok: true,
            reason: "LEDGER_ALREADY_CLOSED",
            doc_id: pending.doc_id,
            written: false,
          });
        }
      }
      await ref.set(pending.record, { merge: true });
      return Object.freeze({
        ok: true,
        reason: "LEDGER_RECORDED",
        doc_id: pending.doc_id,
        written: true,
      });
    }
    return Object.freeze({ ok: false, reason: "LEDGER_REF_NOT_WRITABLE", written: false });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "LEDGER_WRITE_FAILED",
      error_message: error && error.message ? String(error.message) : String(error),
      doc_id: pending.doc_id,
      written: false,
    });
  }
}

async function closeCounterfactualRecord({
  db,
  doc_id,
  pending = null,
  fetchKlines,
  now_ms = Date.now(),
  max_age_ms = DEFAULT_MAX_AGE_MS,
} = {}) {
  if (!doc_id) throw new Error("COUNTERFACTUAL_CLOSE_DOC_ID_REQUIRED");
  if (typeof fetchKlines !== "function") throw new Error("COUNTERFACTUAL_CLOSE_FETCH_KLINES_REQUIRED");
  const ref = resolveDocRef(db, doc_id);
  const snap = pending ? null : await ref.get();
  const data = pending || (snap && typeof snap.data === "function" ? snap.data() : null);
  if (!data) {
    return Object.freeze({ ok: false, reason: "LEDGER_DOC_NOT_FOUND", doc_id });
  }
  const expiry = evaluatePendingExpiry({ pending: data, now_ms, max_age_ms });
  if (expiry.action === "SKIP") {
    return Object.freeze({ ok: true, reason: expiry.reason, doc_id, action: "SKIP" });
  }
  if (expiry.action === "WAIT") {
    return Object.freeze({ ok: true, reason: expiry.reason, doc_id, action: "WAIT" });
  }
  if (expiry.action === "EXPIRE") {
    const update = buildExpiredUpdate({ now_ms });
    await ref.set(update, { merge: true });
    return Object.freeze({ ok: true, reason: "EXPIRED", doc_id, action: "EXPIRE", update });
  }
  let klines;
  try {
    klines = await fetchKlines({
      symbol: data.symbol,
      candle_close_ms: data.candle_close_ms,
      horizon_close_ms: data.horizon_close_ms,
      bar_interval_ms: data.bar_interval_ms,
      horizon_bars: data.horizon_bars,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "LEDGER_KLINE_FETCH_FAILED",
      error_message: error && error.message ? String(error.message) : String(error),
      doc_id,
    });
  }
  const update = closeRecordFromKlines({ pending: data, klines, now_ms });
  await ref.set(update, { merge: true });
  return Object.freeze({ ok: true, reason: "CLOSED", doc_id, action: "CLOSE", update });
}

async function walkPendingCounterfactuals({
  db,
  env = process.env,
  fetchKlines,
  now_ms = Date.now(),
} = {}) {
  const policy = resolveCounterfactualLedgerPolicy(env);
  if (!policy.enabled) {
    return Object.freeze({ ok: true, reason: "LEDGER_DISABLED", processed_n: 0, results: Object.freeze([]) });
  }
  if (typeof fetchKlines !== "function") {
    return Object.freeze({ ok: false, reason: "WALK_FETCH_KLINES_REQUIRED", processed_n: 0 });
  }
  let collection;
  try {
    collection = resolveCollectionRef(db);
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "WALK_COLLECTION_REF_FAILED",
      error_message: error && error.message ? String(error.message) : String(error),
      processed_n: 0,
    });
  }
  let snap;
  try {
    let q = collection.where("status", "==", STATUS_PENDING);
    if (typeof q.where === "function") {
      q = q.where("horizon_close_ms", "<=", now_ms);
    }
    if (typeof q.limit === "function") {
      q = q.limit(policy.batch_limit);
    }
    snap = typeof q.get === "function" ? await q.get() : null;
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "WALK_QUERY_FAILED",
      error_message: error && error.message ? String(error.message) : String(error),
      processed_n: 0,
    });
  }
  const docs = snap && Array.isArray(snap.docs) ? snap.docs : [];
  const results = [];
  for (const doc of docs) {
    const data = typeof doc.data === "function" ? doc.data() : null;
    if (!data) continue;
    const docId = doc.id || data.doc_id || buildCounterfactualDocId({
      symbol: data.symbol,
      side: data.side,
      candle_close_ms: data.candle_close_ms,
      filter_combination_hash: data.filter_combination_hash,
    });
    try {
      const result = await closeCounterfactualRecord({
        db,
        doc_id: docId,
        pending: data,
        fetchKlines,
        now_ms,
        max_age_ms: policy.max_age_ms,
      });
      results.push(result);
    } catch (error) {
      results.push(Object.freeze({
        ok: false,
        reason: "WALK_CLOSE_FAILED",
        error_message: error && error.message ? String(error.message) : String(error),
        doc_id: docId,
      }));
    }
  }
  return Object.freeze({
    ok: true,
    reason: "WALK_COMPLETE",
    processed_n: results.length,
    results: Object.freeze(results),
  });
}

module.exports = {
  COLLECTION_NAME,
  DEFAULT_HORIZON_BARS,
  DEFAULT_BAR_INTERVAL_MS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_BATCH_LIMIT,
  STATUS_PENDING,
  STATUS_CLOSED,
  STATUS_EXPIRED,
  resolveCounterfactualLedgerPolicy,
  buildFilterCombinationHash,
  buildCounterfactualDocId,
  buildCounterfactualDocPath,
  extractFilterSetsFromShadowDecision,
  buildPendingRecord,
  evaluatePendingExpiry,
  closeRecordFromKlines,
  buildExpiredUpdate,
  recordCounterfactualEvaluation,
  closeCounterfactualRecord,
  walkPendingCounterfactuals,
  __test: {
    normalizeSide,
    uniqueSorted,
    safeDocId,
    shortHash,
  },
};
