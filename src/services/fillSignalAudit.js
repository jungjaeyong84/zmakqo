const { getFirestore } = require("../storage/firestore");
const { deriveSignalDocId, buildSignalDocId } = require("../utils/signalDocId");

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtKst(ms) {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function parseDateInput(raw, { endExclusive = false } = {}) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) {
    const base = new Date(`${s}T00:00:00+09:00`).getTime();
    return endExclusive ? base + DAY_MS : base;
  }
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function normalizeRange({ from, to, daysDefault = 3 } = {}) {
  const toMs = parseDateInput(to, { endExclusive: false }) ?? Date.now();
  const fromMs = parseDateInput(from, { endExclusive: false }) ?? (toMs - daysDefault * DAY_MS);
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  return { fromMs, toMs, fromIso, toIso };
}

async function fetchByCreatedAt(db, collection, fromIso, toIso) {
  const out = [];
  let query = db.collection(collection)
    .where("created_at", ">=", fromIso)
    .where("created_at", "<", toIso)
    .orderBy("created_at", "asc")
    .limit(500);

  while (true) {
    const snap = await query.get();
    if (snap.empty) break;
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    if (snap.size < 500) break;
    const last = snap.docs[snap.docs.length - 1];
    query = db.collection(collection)
      .where("created_at", ">=", fromIso)
      .where("created_at", "<", toIso)
      .orderBy("created_at", "asc")
      .startAfter(last)
      .limit(500);
  }
  return out;
}

function tfToMs(tf) {
  const s = String(tf || "").trim().toLowerCase();
  if (!s) return null;
  if (s.endsWith("m")) return Number(s.slice(0, -1)) * 60 * 1000;
  if (s.endsWith("h")) return Number(s.slice(0, -1)) * 60 * 60 * 1000;
  if (s.endsWith("d")) return Number(s.slice(0, -1)) * DAY_MS;
  if (s.endsWith("w")) return Number(s.slice(0, -1)) * 7 * DAY_MS;
  const n = Number(s);
  if (Number.isFinite(n)) return n * 60 * 1000;
  return null;
}

function normalizeUpper(v) {
  return String(v || "").trim().toUpperCase();
}

async function auditFillsSignals({ from, to, exchange, issueLimit = 200 } = {}) {
  const { fromMs, toMs, fromIso, toIso } = normalizeRange({ from, to });
  const db = getFirestore();

  const fillsRaw = await fetchByCreatedAt(db, "fills_paper", fromIso, toIso);
  const exUpper = exchange ? normalizeUpper(exchange) : null;
  const fills = exUpper
    ? fillsRaw.filter((f) => normalizeUpper(f.exchange) === exUpper)
    : fillsRaw;

  const signalScanStartIso = new Date(fromMs - DAY_MS).toISOString();
  const signalsRaw = await fetchByCreatedAt(db, "signals", signalScanStartIso, toIso);
  const dropsRaw = await fetchByCreatedAt(db, "signals_dropped", signalScanStartIso, toIso);

  const signalMap = new Map();
  for (const s of signalsRaw) {
    const id = s.signal_id || buildSignalDocId({
      exchange: s.exchange,
      symbol: s.symbol_or_pair_id || s.symbol,
      tf: s.tf,
      barCloseMs: s.bar_close_time_utc_ms,
      event: s.event,
    });
    if (id && !signalMap.has(id)) signalMap.set(id, s);
  }

  const dropMap = new Map();
  for (const s of dropsRaw) {
    const id = s.signal_id || buildSignalDocId({
      exchange: s.exchange,
      symbol: s.symbol_or_pair_id || s.symbol,
      tf: s.tf,
      barCloseMs: s.bar_close_time_utc_ms,
      event: s.event,
    });
    if (id && !dropMap.has(id)) dropMap.set(id, s);
  }

  const issues = [];
  const byMarket = new Map();
  const signalUsage = new Map();

  let matchedByDocId = 0;
  let missingSignal = 0;
  let matchedDropped = 0;

  for (const f of fills) {
    const mk = normalizeUpper(f.symbol || f.symbol_or_pair_id || f.market);
    const ex = normalizeUpper(f.exchange);
    const key = `${ex}:${mk}`;
    byMarket.set(key, (byMarket.get(key) || 0) + 1);

    const derivedDocId = deriveSignalDocId({
      exchange: f.exchange,
      symbol: f.symbol || f.symbol_or_pair_id || f.market,
      tf: f.tf,
      barCloseMs: f.signal_bar_close_time_utc_ms || f.exec_bar_close_time_utc_ms,
      event: f.event,
      signalId: f.signal_doc_id || f.signal_id,
    });

    if (derivedDocId) {
      signalUsage.set(derivedDocId, (signalUsage.get(derivedDocId) || 0) + 1);
    }

    const reasons = [];
    const isExitLike = String(f.event || "").toUpperCase().startsWith("EXIT");

    let sig = derivedDocId ? signalMap.get(derivedDocId) : null;
    if (sig) {
      matchedByDocId += 1;
    } else if (derivedDocId && dropMap.has(derivedDocId)) {
      matchedDropped += 1;
      reasons.push("SIGNAL_DROPPED_BUT_FILLED");
    } else if (!isExitLike) {
      missingSignal += 1;
      reasons.push(derivedDocId ? "SIGNAL_NOT_FOUND" : "SIGNAL_DOC_ID_NOT_RESOLVED");
    }

    if (sig) {
      const fillSide = normalizeUpper(f.side);
      const sigSide = normalizeUpper(sig.side);
      if (fillSide && sigSide && fillSide !== sigSide) reasons.push("SIDE_MISMATCH");

      const fillEvent = String(f.event || "").trim();
      const sigEvent = String(sig.event || "").trim();
      if (fillEvent && sigEvent && fillEvent !== sigEvent) reasons.push("EVENT_MISMATCH");

      if (sig.mapping_ok === false) reasons.push("SIGNAL_MAPPING_NOT_OK");

      const tfMs = tfToMs(sig.tf);
      const execMs = Number(f.exec_bar_close_time_utc_ms);
      const sigMs = Number(sig.bar_close_time_utc_ms || f.signal_bar_close_time_utc_ms);
      if (Number.isFinite(tfMs) && Number.isFinite(execMs) && Number.isFinite(sigMs)) {
        const delta = Math.abs(execMs - sigMs);
        if (delta > tfMs * 2.5) reasons.push("SIGNAL_EXEC_TIME_GAP");
      }
    }

    const qty = Number(f.qty_pct);
    if (Number.isFinite(qty) && qty > 1.2) reasons.push("QTY_PCT_TOO_LARGE");
    if (Number.isFinite(qty) && qty <= 0) reasons.push("QTY_PCT_NON_POSITIVE");

    if (reasons.length) {
      issues.push({
        fill_id: f.fill_id || f.id,
        created_at: f.created_at,
        exchange: ex || null,
        symbol: mk || null,
        event: f.event || null,
        side: f.side || null,
        qty_pct: f.qty_pct ?? null,
        signal_doc_id: derivedDocId || null,
        signal_id: f.signal_id || null,
        reasons,
      });
    }
  }

  const dupSignals = Array.from(signalUsage.entries()).filter(([, n]) => n > 1);
  const topMarkets = Array.from(byMarket.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => ({ market: k, fills: v }));

  const limitedIssues = issues.slice(0, issueLimit);

  return {
    summary: {
      range_kst: {
        start: fmtKst(fromMs),
        end_exclusive: fmtKst(toMs),
      },
      signal_scan_window_kst: {
        start: fmtKst(fromMs - DAY_MS),
        end_exclusive: fmtKst(toMs),
      },
      exchange: exUpper || "ALL",
      fills_count: fills.length,
      signals_in_range: signalsRaw.length,
      dropped_signals_in_range: dropsRaw.length,
      markets_count: byMarket.size,
      matched_by_doc_id: matchedByDocId,
      matched_dropped: matchedDropped,
      missing_signal_for_entries: missingSignal,
      issue_count: issues.length,
      issue_truncated: issues.length > limitedIssues.length,
      side_mismatch_count: issues.filter((x) => x.reasons.includes("SIDE_MISMATCH")).length,
      event_mismatch_count: issues.filter((x) => x.reasons.includes("EVENT_MISMATCH")).length,
      mapping_not_ok_count: issues.filter((x) => x.reasons.includes("SIGNAL_MAPPING_NOT_OK")).length,
      time_gap_count: issues.filter((x) => x.reasons.includes("SIGNAL_EXEC_TIME_GAP")).length,
      qty_pct_large_count: issues.filter((x) => x.reasons.includes("QTY_PCT_TOO_LARGE")).length,
      qty_pct_non_positive_count: issues.filter((x) => x.reasons.includes("QTY_PCT_NON_POSITIVE")).length,
      duplicate_signal_fill_count: dupSignals.length,
    },
    top_markets: topMarkets,
    duplicate_signal_fills: dupSignals.slice(0, 50).map(([signal_doc_id, fills_n]) => ({
      signal_doc_id,
      fills_n,
    })),
    issues: limitedIssues,
  };
}

module.exports = { auditFillsSignals };
