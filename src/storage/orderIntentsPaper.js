const { getFirestore } = require("./firestore");
const { tfToMs } = require("../utils/marketConfig");
const { enrichFeaturesWithRegime } = require("../utils/regime");
const { resolveEventMapping } = require("../services/signalMapping");

function nowIso(){ return new Date().toISOString(); }
function isTpP1Event(event) {
  const ev = String(event || "").toUpperCase();
  return ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_");
}
function intentId({exchange,symbol,tf,signalBarCloseMs,event}){
  return `INTENT__${exchange}__${symbol}__${tf}__${signalBarCloseMs}__${event}`;
}
function intentScopeKey({ exchange, symbol, tf }) {
  return `${exchange}__${symbol}__${tf}`;
}
function execKey({ exchange, symbol, tf, execBarCloseMs }) {
  if (!Number.isFinite(Number(execBarCloseMs))) return null;
  return `${exchange}__${symbol}__${tf}__${execBarCloseMs}`;
}

function intentTtlMs(tf) {
  const envMs = Number(process.env.INTENT_TTL_MS);
  if (Number.isFinite(envMs) && envMs > 0) return envMs;
  const bars = Number(process.env.INTENT_TTL_BARS || 2);
  const tfMs = tfToMs(tf);
  if (Number.isFinite(tfMs) && Number.isFinite(bars) && bars > 0) return Math.round(tfMs * bars);
  return 2 * 60 * 60 * 1000;
}

async function upsertIntent({
  exchange, symbol, tf,
  signalBarCloseTimeUtc, signalBarCloseTimeUtcMs,
  scheduledExecBarCloseUtc, scheduledExecBarCloseUtcMs,
  event, side, qtyPct, reason, features = {}, runId,
  budgetMaxKrw, budgetUsedKrw, qtyFraction,
  signalPrice,
  signalDocId,
  pendingReason,
  pendingNote,
  ttlMs,
  execTf,
  executionMode,
} = {}) {
  const db = getFirestore();
  const regimeMeta = enrichFeaturesWithRegime(features || {});
  const normalizedFeatures = regimeMeta.features;
  const mapping = resolveEventMapping({ event, side });
  const hintedIntent = String(normalizedFeatures && normalizedFeatures._event_intent || "").trim().toUpperCase();
  const useHintedIntent = hintedIntent === "ENTRY" || hintedIntent === "ADD" || hintedIntent === "EXIT";
  const eventIntent = useHintedIntent ? hintedIntent : (mapping.intent || null);
  const id = intentId({ exchange, symbol, tf, signalBarCloseMs: signalBarCloseTimeUtcMs, event });
  const ref = db.collection("order_intents_paper").doc(id);
  const t = nowIso();
  const ttlNum = Number(ttlMs);
  const ttlBaseTf = execTf || tf;
  let ttl = (Number.isFinite(ttlNum) && ttlNum > 0) ? ttlNum : intentTtlMs(ttlBaseTf);
  const ev = String(event || "").toUpperCase();
  if (ev.startsWith("EXIT_")) {
    const exitTtlNum = Number(process.env.EXIT_INTENT_TTL_MS);
    const exitBarsRaw = process.env.EXIT_INTENT_TTL_BARS;
    const exitBars = Number.isFinite(Number(exitBarsRaw)) ? Number(exitBarsRaw) : 8;
    let exitTtl = null;
    if (Number.isFinite(exitTtlNum) && exitTtlNum > 0) {
      exitTtl = exitTtlNum;
    } else if (Number.isFinite(exitBars) && exitBars > 0) {
      const tfMs = tfToMs(ttlBaseTf);
      if (Number.isFinite(tfMs) && tfMs > 0) exitTtl = Math.round(tfMs * exitBars);
    }
    if (Number.isFinite(exitTtl) && exitTtl > ttl) ttl = exitTtl;
  } else {
    const entryTtlNum = Number(process.env.ENTRY_INTENT_TTL_MS);
    const entryBarsRaw = process.env.ENTRY_INTENT_TTL_BARS;
    const entryBars = Number.isFinite(Number(entryBarsRaw)) ? Number(entryBarsRaw) : 8;
    let entryTtl = null;
    if (Number.isFinite(entryTtlNum) && entryTtlNum > 0) {
      entryTtl = entryTtlNum;
    } else if (Number.isFinite(entryBars) && entryBars > 0) {
      const tfMs = tfToMs(ttlBaseTf);
      if (Number.isFinite(tfMs) && tfMs > 0) entryTtl = Math.round(tfMs * entryBars);
    }
    if (Number.isFinite(entryTtl) && entryTtl > ttl) ttl = entryTtl;
  }
  const execMs = Number(scheduledExecBarCloseUtcMs);
  const expiresMs = Number.isFinite(execMs) ? execMs + ttl : null;
  const expiresAt = Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null;
  const scopeKey = intentScopeKey({ exchange, symbol, tf });
  const execKeyValue = execKey({ exchange, symbol, tf, execBarCloseMs: execMs });

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const featureEntryEventId = String(normalizedFeatures && normalizedFeatures.entry_event_id || "").trim() || null;
    const featureEntrySignalType = String(normalizedFeatures && normalizedFeatures.entry_signal_type || "").toUpperCase() || null;

    if (snap.exists) {
      const cur = snap.data() || {};
      const st = String(cur.status || "PENDING").toUpperCase();

      // ✅ FILLED/CANCELED는 절대 되돌리지 않는다
      if (st === "FILLED" || st === "CANCELED") return cur;

      // ✅ status는 건드리지 않고 부가정보만 갱신
      const patch = {
        run_id: runId || cur.run_id || null,
        reason: reason || cur.reason || null,
        features_json: normalizedFeatures,
        execution_mode: executionMode || cur.execution_mode || null,
        budget_max_krw: (budgetMaxKrw == null ? cur.budget_max_krw : Number(budgetMaxKrw)),
        budget_used_krw: (budgetUsedKrw == null ? cur.budget_used_krw : Number(budgetUsedKrw)),
        qty_fraction: (qtyFraction == null ? cur.qty_fraction : Number(qtyFraction)),
        event_intent: eventIntent || cur.event_intent || null,
        signal_price: (signalPrice == null ? cur.signal_price : Number(signalPrice)),
        signal_price_source: signalPrice == null ? cur.signal_price_source : "BAR_CLOSE",
        signal_doc_id: signalDocId || cur.signal_doc_id || null,
        entry_event_id: featureEntryEventId || cur.entry_event_id || null,
        entry_signal_type: featureEntrySignalType || cur.entry_signal_type || null,
        pending_reason: pendingReason || cur.pending_reason || "WAIT_NEXT_BAR",
        pending_note: pendingNote || cur.pending_note || null,
        intent_ttl_ms: Number.isFinite(ttl) ? ttl : (cur.intent_ttl_ms || null),
        expires_at: expiresAt || cur.expires_at || null,
        expires_at_ms: Number.isFinite(expiresMs) ? expiresMs : (cur.expires_at_ms || null),
        intent_scope: cur.intent_scope || scopeKey,
        exec_key: cur.exec_key || execKeyValue,
        regime: regimeMeta.regime || cur.regime || null,
        market_regime: regimeMeta.market_regime || cur.market_regime || null,
        regime_source: regimeMeta.regime_source || cur.regime_source || null,
        updated_at: t,
      };
      tx.set(ref, patch, { merge: true });
      return { ...cur, ...patch };
    }

    const payload = {
      intent_id: id,
      run_id: runId || null,
      exchange,
      symbol_or_pair_id: symbol,
      tf,
      signal_bar_close_time_utc: signalBarCloseTimeUtc || null,
      signal_bar_close_time_utc_ms: Number(signalBarCloseTimeUtcMs),
      scheduled_exec_bar_close_time_utc: scheduledExecBarCloseUtc || null,
      scheduled_exec_bar_close_time_utc_ms: Number(scheduledExecBarCloseUtcMs),
      event,
      side,
      qty_pct: Number(qtyPct),
      qty_fraction: (qtyFraction == null ? null : Number(qtyFraction)),
      event_intent: eventIntent,
      reason: reason || null,
      features_json: normalizedFeatures,
      execution_mode: executionMode || null,
      signal_price: (signalPrice == null ? null : Number(signalPrice)),
      signal_price_source: signalPrice == null ? null : "BAR_CLOSE",
      signal_doc_id: signalDocId || null,
      entry_event_id: featureEntryEventId,
      entry_signal_type: featureEntrySignalType,
      budget_max_krw: (budgetMaxKrw == null ? null : Number(budgetMaxKrw)),
      budget_used_krw: (budgetUsedKrw == null ? null : Number(budgetUsedKrw)),
      pending_reason: pendingReason || "WAIT_NEXT_BAR",
      pending_note: pendingNote || null,
      intent_ttl_ms: Number.isFinite(ttl) ? ttl : null,
      expires_at: expiresAt || null,
      expires_at_ms: Number.isFinite(expiresMs) ? expiresMs : null,
      intent_scope: scopeKey,
      exec_key: execKeyValue,
      regime: regimeMeta.regime,
      market_regime: regimeMeta.market_regime,
      regime_source: regimeMeta.regime_source,
      status: "PENDING",
      created_at: t,
      updated_at: t,
    };
    tx.set(ref, payload, { merge: true });
    return payload;
  });
}

async function listPendingIntentsForExec({ exchange, symbol, tf, execBarCloseMs, limitN = 50 } = {}) {
  const db = getFirestore();
  const ms = Number(execBarCloseMs);
  let snap = null;
  const execKeyValue = execKey({ exchange, symbol, tf, execBarCloseMs: ms });
  try {
    if (execKeyValue) {
      snap = await db.collection("order_intents_paper")
        .where("exec_key", "==", execKeyValue)
        .limit(limitN)
        .get();
      if (!snap.empty) {
        return snap.docs.map(d => d.data()).filter((x) => String(x.status || "") === "PENDING");
      }
      const legacyFallback = String(process.env.INTENT_FALLBACK_SCAN || "1") !== "0";
      if (!legacyFallback) return [];
    }
  } catch (e) {
    // Missing index or legacy intent -> fallback scan
  }
  try {
    snap = await db.collection("order_intents_paper")
      .where("exchange", "==", exchange)
      .where("symbol_or_pair_id", "==", symbol)
      .where("tf", "==", tf)
      .where("scheduled_exec_bar_close_time_utc_ms", "==", ms)
      .where("status", "==", "PENDING")
      .limit(limitN)
      .get();
    if (snap.empty) return [];
    return snap.docs.map(d => d.data());
  } catch (e) {
    // Missing composite index -> fallback scan
    snap = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(80, Number(limitN) * 5))
      .get();
    const out = [];
    snap.forEach((d) => {
      const x = d.data() || {};
      if (String(x.exchange || "") !== String(exchange || "")) return;
      if (String(x.symbol_or_pair_id || "") !== String(symbol || "")) return;
      if (String(x.tf || "") !== String(tf || "")) return;
      if (String(x.status || "") !== "PENDING") return;
      if (Number(x.scheduled_exec_bar_close_time_utc_ms) !== ms) return;
      out.push(x);
    });
    return out.slice(0, Number(limitN) || 50);
  }
}

async function listPendingIntentsOverdue({ exchange, symbol, tf, execBarCloseMs, limitN = 50, lookbackLimit = 600 } = {}) {
  const db = getFirestore();
  const ms = Number(execBarCloseMs);
  if (!Number.isFinite(ms)) return [];
  const nowMs = Date.now();
  const scopeKey = intentScopeKey({ exchange, symbol, tf });

  let snap = null;
  try {
    snap = await db.collection("order_intents_paper")
      .where("intent_scope", "==", scopeKey)
      .limit(Math.max(80, Number(lookbackLimit) || 600))
      .get();
  } catch (_) {
    // fallback to scan
    snap = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, Number(lookbackLimit) || 600))
      .get();
  }

  const out = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    if (String(x.exchange || "") !== String(exchange || "")) return;
    if (String(x.symbol_or_pair_id || "") !== String(symbol || "")) return;
    if (String(x.tf || "") !== String(tf || "")) return;
    if (String(x.status || "") !== "PENDING") return;
    const sched = Number(x.scheduled_exec_bar_close_time_utc_ms);
    if (!Number.isFinite(sched) || sched >= ms) return;
    const expMs = Number(x.expires_at_ms);
    if (Number.isFinite(expMs) && expMs <= nowMs) return;
    out.push(x);
  });

  return out.slice(0, Number(limitN) || 50);
}

async function cancelExpiredPendingIntents({ exchange, symbol, tf, lookbackLimit = 600 } = {}) {
  const db = getFirestore();
  const nowMs = Date.now();
  const scopeKey = intentScopeKey({ exchange, symbol, tf });

  let snap = null;
  try {
    snap = await db.collection("order_intents_paper")
      .where("intent_scope", "==", scopeKey)
      .limit(Math.max(80, Number(lookbackLimit) || 600))
      .get();
  } catch (_) {
    snap = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, Number(lookbackLimit) || 600))
      .get();
  }

  const tasks = [];
  let canceled = 0;
  snap.forEach((d) => {
    const x = d.data() || {};
    if (String(x.status || "") !== "PENDING") return;
    if (String(x.exchange || "") !== String(exchange || "")) return;
    if (String(x.symbol_or_pair_id || "") !== String(symbol || "")) return;
    if (String(x.tf || "") !== String(tf || "")) return;
    const expMs = Number(x.expires_at_ms);
    if (!Number.isFinite(expMs) || expMs > nowMs) return;
    tasks.push(
      db.collection("order_intents_paper").doc(d.id).set({
        status: "CANCELED",
        canceled_at: nowIso(),
        updated_at: nowIso(),
        cancel_reason: "INTENT_EXPIRED",
        status_reason: "INTENT_EXPIRED",
      }, { merge: true })
        .then(() => { canceled += 1; })
    );
  });

  if (tasks.length) {
    const chunk = 50;
    for (let i = 0; i < tasks.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(tasks.slice(i, i + chunk));
    }
  }

  return { ok: true, canceled };
}

async function markIntentStatus(intentIdValue, status, patch = {}) {
  const db = getFirestore();
  const ref = db.collection("order_intents_paper").doc(intentIdValue);
  await ref.set({ status, updated_at: nowIso(), ...patch }, { merge: true });

  const st = String(status || "").toUpperCase();
  if (st !== "CANCELED") return;

  // TP1 cancel should immediately release pending lock; otherwise TP1 can stay blocked for too long.
  try {
    const snap = await ref.get();
    if (!snap.exists) return;
    const doc = snap.data() || {};
    if (!isTpP1Event(doc.event)) return;
    const ex = String(doc.exchange || "").trim();
    const sym = String(doc.symbol_or_pair_id || "").trim();
    if (!ex || !sym) return;
    const posId = `POS__${ex}__${sym}`;
    await db.collection("positions_paper").doc(posId).update({
      "meta.tp_p1_pending": false,
      "meta.tp_p1_pending_at_ms": null,
      "meta.tp_p1_pending_until_ms": null,
      "meta.tp_p1_pending_event": null,
      "meta.tp_p1_pending_cleared_at": nowIso(),
      "meta.tp_p1_pending_cleared_reason": String(patch.cancel_reason || patch.status_reason || "INTENT_CANCELED"),
      updated_at: nowIso(),
    });
  } catch (_) {}
}

async function patchIntent(intentIdValue, patch = {}) {
  const db = getFirestore();
  const ref = db.collection("order_intents_paper").doc(intentIdValue);
  await ref.set({ updated_at: nowIso(), ...patch }, { merge: true });
}

async function cancelPendingIntentsByMarket({
  exchange,
  symbol,
  limitN = 200,
  reason = "MANUAL_CANCEL_UI",
  note = null,
  filterFn = null,
} = {}) {
  const db = getFirestore();
  const ex = String(exchange || "").trim();
  const sym = String(symbol || "").trim();
  if (!ex || !sym) return { ok: false, canceled: 0, scanned: 0 };

  let docs = [];
  let snap = null;
  try {
    snap = await db.collection("order_intents_paper")
      .where("exchange", "==", ex)
      .where("symbol_or_pair_id", "==", sym)
      .where("status", "==", "PENDING")
      .limit(Number(limitN) || 200)
      .get();
    if (!snap.empty) {
      docs = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
    }
  } catch (_) {
    // Missing composite index -> fallback scan
  }

  if (!docs.length) {
    snap = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, Number(limitN) || 200 * 5))
      .get();
    snap.forEach((d) => {
      const x = d.data() || {};
      if (String(x.exchange || "") !== ex) return;
      if (String(x.symbol_or_pair_id || "") !== sym) return;
      if (String(x.status || "") !== "PENDING") return;
      docs.push({ id: d.id, data: x });
    });
  }

  let canceled = 0;
  let scanned = 0;
  const tasks = [];
  for (const doc of docs) {
    scanned += 1;
    if (typeof filterFn === "function" && !filterFn(doc.data)) continue;
    tasks.push(
      db.collection("order_intents_paper").doc(doc.id).set({
        status: "CANCELED",
        canceled_at: nowIso(),
        updated_at: nowIso(),
        cancel_reason: reason,
        status_reason: reason,
        cancel_note: note || null,
      }, { merge: true })
        .then(() => { canceled += 1; })
    );
  }

  if (tasks.length) {
    const chunk = 50;
    for (let i = 0; i < tasks.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(tasks.slice(i, i + chunk));
    }
  }

  return { ok: true, canceled, scanned };
}

module.exports = {
  upsertIntent,
  listPendingIntentsForExec,
  listPendingIntentsOverdue,
  cancelExpiredPendingIntents,
  markIntentStatus,
  patchIntent,
  cancelPendingIntentsByMarket,
};
