const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { resolveEventMapping, SIGNAL_MAPPING_VERSION } = require("../services/signalMapping");
const { deriveGroupSubtype } = require("../services/signalTaxonomy");
const { normalizeMarketSymbolForProvider } = require("../utils/marketConfig");
const { normalizeProviderId } = require("../utils/providerUtils");
const { enrichFeaturesWithRegime } = require("../utils/regime");

function nowIso() {
  return new Date().toISOString();
}

function signalId({ exchange, symbol, tf, barCloseMs, event }) {
  return `SIG__${exchange}__${symbol}__${tf}__${barCloseMs}__${event}`;
}

function stableHash(obj) {
  const s = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeExecutionMode(v) {
  const s = String(v || "").toUpperCase();
  if (s === "LIVE" || s === "LIVE_DRY_RUN" || s === "PAPER") return s;
  return null;
}

function normalizeTpP1EventForExchange(eventRaw, exchange) {
  const ev = String(eventRaw || "").trim().toUpperCase();
  const ex = normalizeProviderId(exchange || "");
  if (ex === "BINANCEFUT" && ev === "EXIT_TP_P1_5P") return "EXIT_TP_P1_3P";
  return ev;
}

/**
 * ✅ 표준 signals 업서트 (운영형)
 * - CREATE: 없으면 생성 (received_count=1)
 * - UPDATE: 있으면(미소비) received_count++ (+payload 변하면 revision++)
 * - IGNORED_CONSUMED: 이미 consumed면 본문(side/qty_pct/...) 변경 금지, dup_count만 누적
 */
async function upsertSignal({
  exchange,
  symbol,
  tf,
  barCloseTimeUtc,
  barCloseTimeUtcMs,
  event,
  side,
  qtyPct,
  reason,
  features = {},
  executionMode,
  source = "webhook",
  authoritative = null,
} = {}) {
  const db = getFirestore();

  const exRaw = String(exchange || "").toUpperCase();
  const ex = normalizeProviderId(exRaw || "BINANCEFUT");
  const symRaw = String(symbol || "");
  const symNormalized = normalizeMarketSymbolForProvider(symRaw, ex);
  const sym = symNormalized || symRaw;
  const tf0 = String(tf || "");
  const ms = Number(barCloseTimeUtcMs);
  const ev = normalizeTpP1EventForExchange(event, ex);
  const sd = String(side || "").toUpperCase();
  const mapping = resolveEventMapping({ event: ev, side: sd });
  const feat = features || {};
  const execMode = normalizeExecutionMode(
    executionMode ||
    feat.execution_mode ||
    (feat.meta && feat.meta.execution_mode)
  );
  const hintedIntent = String(feat._event_intent || "").trim().toUpperCase();
  const useHintedIntent = hintedIntent === "ENTRY" || hintedIntent === "ADD" || hintedIntent === "EXIT";
  const finalIntent = useHintedIntent ? hintedIntent : mapping.intent;
  const mappingSource = useHintedIntent ? "feature_hint" : mapping.source;
  const finalSide = mapping.side || sd;
  const derived = deriveGroupSubtype(ev);
  const eventGroup = finalIntent || derived.group;
  const eventSubtype = derived.subtype;
  const qp = toNum(qtyPct);
  const regimeMeta = enrichFeaturesWithRegime(feat);
  const normalizedFeatures = regimeMeta.features;

  const id = signalId({ exchange: ex, symbol: sym, tf: tf0, barCloseMs: ms, event: ev });
  const ref = db.collection("signals").doc(id);

  const incomingCore = {
    exchange: ex,
    symbol_or_pair_id: sym,
    tf: tf0,
    bar_close_time_utc_ms: ms,
    event: ev,
    side: finalSide,
    qty_pct: qp,
    reason: reason || null,
    features_json: normalizedFeatures,
    price: toNum(feat.price),
    source,
    authoritative: authoritative == null ? null : authoritative === true,
    execution_mode: execMode,
    event_intent: finalIntent || null,
    event_group: eventGroup || null,
    event_subtype: eventSubtype || null,
    mapping_version: SIGNAL_MAPPING_VERSION,
    mapping_source: mappingSource || null,
    mapping_side_expected: mapping.side_expected || null,
    mapping_ok: mapping.ok === true,
    regime: regimeMeta.regime,
    market_regime: regimeMeta.market_regime,
    regime_source: regimeMeta.regime_source,
  };

  const incomingHash = stableHash(incomingCore);
  const t = nowIso();

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    // 1) CREATE
    if (!snap.exists) {
      const payload = {
        signal_id: id,
        exchange: incomingCore.exchange,
        symbol_or_pair_id: incomingCore.symbol_or_pair_id,
        tf: incomingCore.tf,
        bar_close_time_utc: barCloseTimeUtc || null,
        bar_close_time_utc_ms: incomingCore.bar_close_time_utc_ms,
        event: incomingCore.event,
        side: incomingCore.side,
        qty_pct: incomingCore.qty_pct,
        reason: incomingCore.reason,
        features_json: incomingCore.features_json,
        price: incomingCore.price,
        source: incomingCore.source,
        authoritative: incomingCore.authoritative,
        execution_mode: incomingCore.execution_mode,
        event_intent: incomingCore.event_intent,
        event_group: incomingCore.event_group,
        event_subtype: incomingCore.event_subtype,
        mapping_version: incomingCore.mapping_version,
        mapping_source: incomingCore.mapping_source,
        mapping_side_expected: incomingCore.mapping_side_expected,
        mapping_ok: incomingCore.mapping_ok,

        payload_hash: incomingHash,
        revision: 1,
        received_count: 1,
        dup_count: 0,

        consumed_at: null,
        consumed_run_id: null,

        created_at: t,
        updated_at: t,
      };

      tx.set(ref, payload, { merge: false });
      return { ok: true, signal_id: id, decision: "CREATED" };
    }

    const cur = snap.data() || {};

    // 2) 이미 consumed면 본문 변경 금지
    if (cur.consumed_at || cur.consumed_run_id) {
      const patch = {
        dup_count: Number(cur.dup_count || 0) + 1,
        last_dup_at: t,
        last_dup_payload_hash: incomingHash,
        updated_at: t,
      };
      tx.set(ref, patch, { merge: true });
      return { ok: true, signal_id: id, decision: "IGNORED_CONSUMED" };
    }

    // 3) UPDATE(미소비)
    const prevHash = cur.payload_hash || null;
    const changed = prevHash !== incomingHash;

    const patch = {
      exchange: incomingCore.exchange,
      symbol_or_pair_id: incomingCore.symbol_or_pair_id,
      tf: incomingCore.tf,
      bar_close_time_utc: barCloseTimeUtc || cur.bar_close_time_utc || null,
      bar_close_time_utc_ms: incomingCore.bar_close_time_utc_ms,
      event: incomingCore.event,
      side: incomingCore.side,
      qty_pct: incomingCore.qty_pct,
      reason: incomingCore.reason,
      features_json: incomingCore.features_json,
      price: incomingCore.price,
      source: incomingCore.source,
      authoritative: incomingCore.authoritative,
      execution_mode: incomingCore.execution_mode,
      event_intent: incomingCore.event_intent,
      event_group: incomingCore.event_group,
      event_subtype: incomingCore.event_subtype,
      mapping_version: incomingCore.mapping_version,
      mapping_source: incomingCore.mapping_source,
      mapping_side_expected: incomingCore.mapping_side_expected,
      mapping_ok: incomingCore.mapping_ok,

      payload_hash: incomingHash,
      received_count: Number(cur.received_count || 0) + 1,
      revision: changed ? Number(cur.revision || 1) + 1 : Number(cur.revision || 1),

      updated_at: t,
    };

    tx.set(ref, patch, { merge: true });
    return { ok: true, signal_id: id, decision: changed ? "UPDATED_CHANGED" : "UPDATED_SAME" };
  });
}

module.exports = { upsertSignal };
