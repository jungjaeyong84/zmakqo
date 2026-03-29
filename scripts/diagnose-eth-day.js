#!/usr/bin/env node
/* eslint-disable no-console */
const dns = require("node:dns").promises;
const fs = require("node:fs");
const path = require("node:path");
const { getFirestore } = require("../src/storage/firestore");

const FIRESTORE_HOST = String(process.env.FIRESTORE_DNS_HOST || "firestore.googleapis.com").trim();
const DNS_TIMEOUT_MS = toInt(process.env.FIRESTORE_DNS_TIMEOUT_MS, 2500, 300, 20000);
const QUERY_TIMEOUT_MS = toInt(process.env.FIRESTORE_QUERY_TIMEOUT_MS, 30000, 1000, 180000);

function toInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function toNum(raw, fallback = null) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function errorText(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err.stack) return String(err.stack);
  if (err.message) return String(err.message);
  return String(err);
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`TIMEOUT:${label}:${timeoutMs}ms`);
      err.code = "TIMEOUT";
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function kstDayRange(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`INVALID_DATE:${dateStr}`);
  }
  const startKst = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const startUtcMs = startKst.getTime() - 9 * 60 * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
  return { startUtcMs, endUtcMs };
}

function todayKstStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toKstString(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

function asIso(ms) {
  return new Date(ms).toISOString();
}

function parseMs(x) {
  if (Number.isFinite(x)) return Number(x);
  if (typeof x === "string" && x.trim()) {
    const n = Date.parse(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeUpper(v) {
  return String(v || "").trim().toUpperCase();
}

function countBy(items, key) {
  const map = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const v = String((it && it[key]) || "UNKNOWN");
    map.set(v, (map.get(v) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function countByStartsWith(items, key, prefix) {
  let n = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (String((it && it[key]) || "").startsWith(prefix)) n += 1;
  }
  return n;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = String(argv[i] || "");
    if (!cur.startsWith("--")) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

async function precheckDns(host, timeoutMs) {
  const rows = await withTimeout(dns.lookup(host, { all: true }), timeoutMs, `dns:${host}`);
  const addresses = Array.isArray(rows) ? rows.map((x) => x && x.address).filter(Boolean) : [];
  if (!addresses.length) throw new Error(`DNS_LOOKUP_FAIL:${host}`);
  return addresses;
}

async function fetchByBarRange(db, col, startMs, endMs) {
  const out = [];
  const q = db
    .collection(col)
    .where("bar_close_time_utc_ms", ">=", startMs)
    .where("bar_close_time_utc_ms", "<=", endMs);
  const snap = await withTimeout(q.get(), QUERY_TIMEOUT_MS, `${col}.bar_range`);
  snap.forEach((doc) => out.push({ _id: doc.id, ...doc.data() }));
  return out;
}

async function fetchByCreatedAtRange(db, col, startIso, endIsoExclusive) {
  const out = [];
  const q = db
    .collection(col)
    .where("created_at", ">=", startIso)
    .where("created_at", "<", endIsoExclusive);
  const snap = await withTimeout(q.get(), QUERY_TIMEOUT_MS, `${col}.created_at_range`);
  snap.forEach((doc) => out.push({ _id: doc.id, ...doc.data() }));
  return out;
}

function inferSymbol(row) {
  const direct = normalizeUpper(row && row.symbol);
  if (direct) return direct;

  const fromSignalId = String(row && row.signal_id || "").match(/^([A-Z0-9]+)(?:\.P)?\|/);
  if (fromSignalId && fromSignalId[1]) return String(fromSignalId[1]).toUpperCase();

  const candidates = [
    row && row._id,
    row && row.intent_id,
    row && row.signal_doc_id,
    row && row.fill_id,
    row && row.position_id,
  ];
  for (const c of candidates) {
    const parts = String(c || "").split("__");
    if (parts.length >= 3) {
      const maybe = normalizeUpper(parts[2]);
      if (maybe) return maybe;
    }
  }
  return "";
}

function inferExchange(row) {
  const direct = normalizeUpper(row && row.exchange);
  if (direct) return direct;
  const candidates = [
    row && row._id,
    row && row.intent_id,
    row && row.signal_doc_id,
    row && row.fill_id,
    row && row.position_id,
  ];
  for (const c of candidates) {
    const parts = String(c || "").split("__");
    if (parts.length >= 2) {
      const maybe = normalizeUpper(parts[1]);
      if (maybe) return maybe;
    }
  }
  return "";
}

function filterMarket(rows, exchange, symbol) {
  const ex = normalizeUpper(exchange);
  const sym = normalizeUpper(symbol);
  return (Array.isArray(rows) ? rows : []).filter((x) => {
    return inferExchange(x) === ex && inferSymbol(x) === sym;
  });
}

function pickRangeByMs(rows, msFieldList) {
  let first = null;
  let last = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    let ms = null;
    for (const field of msFieldList) {
      ms = parseMs(row && row[field]);
      if (Number.isFinite(ms)) break;
    }
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(first) || ms < first) first = ms;
    if (!Number.isFinite(last) || ms > last) last = ms;
  }
  return { firstMs: first, lastMs: last };
}

function buildLiveExceptionEvidence(intents) {
  const out = [];
  for (const it of Array.isArray(intents) ? intents : []) {
    const cancelReason = String(it && it.cancel_reason ? it.cancel_reason : "");
    const statusReason = String(it && it.status_reason ? it.status_reason : "");
    const cancelNote = String(it && it.cancel_note ? it.cancel_note : "");
    const isLiveException = cancelReason === "LIVE_EXCEPTION" || statusReason === "LIVE_EXCEPTION";
    if (!isLiveException) continue;
    out.push({
      intent_id: it.intent_id || null,
      created_at: it.created_at || null,
      updated_at: it.updated_at || null,
      event: it.event || null,
      qty_pct: toNum(it.qty_pct, null),
      pending_reason: it.pending_reason || null,
      cancel_reason: cancelReason || null,
      status_reason: statusReason || null,
      cancel_note: cancelNote || null,
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dateKey = String(args.date || process.argv[2] || todayKstStr()).trim();
  const exchange = normalizeUpper(args.exchange || "BINANCEFUT");
  const symbol = normalizeUpper(args.symbol || "ETHUSDT");
  const outPathArg = args.out ? String(args.out).trim() : "";

  const { startUtcMs, endUtcMs } = kstDayRange(dateKey);
  const startIso = asIso(startUtcMs);
  const endIsoExclusive = asIso(endUtcMs + 1);
  const db = getFirestore();

  let dnsPrecheck = null;
  try {
    const addresses = await precheckDns(FIRESTORE_HOST, DNS_TIMEOUT_MS);
    dnsPrecheck = {
      ok: true,
      host: FIRESTORE_HOST,
      timeout_ms: DNS_TIMEOUT_MS,
      resolved_count: addresses.length,
      resolved_sample: addresses.slice(0, 3),
    };
  } catch (err) {
    dnsPrecheck = {
      ok: false,
      host: FIRESTORE_HOST,
      timeout_ms: DNS_TIMEOUT_MS,
      error: errorText(err),
    };
  }

  const [signalsRaw, dropsRaw, fillsRaw, intentsRaw] = await Promise.all([
    fetchByBarRange(db, "signals", startUtcMs, endUtcMs),
    fetchByBarRange(db, "signals_dropped", startUtcMs, endUtcMs),
    fetchByBarRange(db, "fills_paper", startUtcMs, endUtcMs),
    fetchByCreatedAtRange(db, "order_intents_paper", startIso, endIsoExclusive),
  ]);

  const posDocId = `POS__${exchange}__${symbol}`;
  const posSnap = await withTimeout(db.collection("positions_paper").doc(posDocId).get(), QUERY_TIMEOUT_MS, "positions_paper.doc");
  const position = posSnap.exists ? (posSnap.data() || {}) : null;

  const signals = filterMarket(signalsRaw, exchange, symbol);
  const drops = filterMarket(dropsRaw, exchange, symbol);
  const fills = filterMarket(fillsRaw, exchange, symbol);
  const intents = filterMarket(intentsRaw, exchange, symbol);

  const tp1Signals = signals.filter((x) => String(x && x.event || "").startsWith("EXIT_TP_P1"));
  const tp1Intents = intents.filter((x) => String(x && x.event || "").startsWith("EXIT_TP_P1"));
  const liveExceptions = buildLiveExceptionEvidence(tp1Intents);
  const tp1PendingDrops = drops.filter((x) => String(x && x.reason || "") === "DROP_TP_P1_PENDING");
  const tp1PendingRange = pickRangeByMs(tp1PendingDrops, ["bar_close_time_utc_ms", "created_at", "updated_at"]);

  const issueConfirmed = tp1Signals.length > 0 && fills.length === 0 && liveExceptions.length > 0;
  const liveExceptionNotes = Array.from(new Set(liveExceptions.map((x) => String(x.cancel_note || "").trim()).filter(Boolean)));
  const liveExceptionRange = pickRangeByMs(liveExceptions, ["created_at", "updated_at"]);

  const diagnosis = {
    issue_confirmed: issueConfirmed,
    primary: issueConfirmed
      ? `${symbol} TP1 구간에서 LIVE_EXCEPTION 반복으로 체결 실패`
      : `${symbol}에서 동일 패턴 장애는 확인되지 않음`,
    technical_root_cause: liveExceptionNotes.length ? liveExceptionNotes.join(" | ") : null,
    side_effect: tp1PendingDrops.length > 0
      ? `DROP_TP_P1_PENDING ${tp1PendingDrops.length}건 누적`
      : null,
  };

  const payload = {
    date_kst: dateKey,
    generated_at_utc: new Date().toISOString(),
    exchange,
    symbol,
    dns_precheck: dnsPrecheck,
    window: {
      start_utc_ms: startUtcMs,
      end_utc_ms: endUtcMs,
      start_kst: toKstString(startUtcMs),
      end_kst: toKstString(endUtcMs),
      start_iso_utc: startIso,
      end_iso_utc_exclusive: endIsoExclusive,
    },
    summary: {
      signals_count: signals.length,
      drops_count: drops.length,
      fills_count: fills.length,
      tp1_signals_count: tp1Signals.length,
      tp1_intents_count: tp1Intents.length,
      tp1_live_exception_count: liveExceptions.length,
      tp1_drop_pending_count: tp1PendingDrops.length,
    },
    events: {
      signal_events: countBy(signals, "event"),
      drop_reasons: countBy(drops, "reason"),
      drop_codes: countBy(drops, "drop_reason_code"),
      fill_events: countBy(fills, "event"),
      intent_status: countBy(intents, "status"),
      intent_cancel_reasons: countBy(intents, "cancel_reason"),
      intent_status_reasons: countBy(intents, "status_reason"),
      tp1_signal_count_by_prefix: countByStartsWith(signals, "event", "EXIT_TP_P1"),
      trail_signal_count_by_prefix: countByStartsWith(signals, "event", "EXIT_TRAIL"),
    },
    tp1_pending_timeline: {
      first_drop_bar_ms_utc: tp1PendingRange.firstMs,
      first_drop_kst: toKstString(tp1PendingRange.firstMs),
      last_drop_bar_ms_utc: tp1PendingRange.lastMs,
      last_drop_kst: toKstString(tp1PendingRange.lastMs),
      span_minutes: Number.isFinite(tp1PendingRange.firstMs) && Number.isFinite(tp1PendingRange.lastMs)
        ? Math.round(((tp1PendingRange.lastMs - tp1PendingRange.firstMs) / 60000) * 100) / 100
        : null,
    },
    live_exception_timeline: {
      first_at_ms_utc: liveExceptionRange.firstMs,
      first_at_kst: toKstString(liveExceptionRange.firstMs),
      last_at_ms_utc: liveExceptionRange.lastMs,
      last_at_kst: toKstString(liveExceptionRange.lastMs),
      notes: liveExceptionNotes,
    },
    live_exception_evidence: liveExceptions,
    position_snapshot_now: position
      ? {
          exists: true,
          state: position.state || null,
          size_pct: toNum(position.size_pct, null),
          updated_at: position.updated_at || null,
          tp_p1_pending: !!position.tp_p1_pending,
          tp_p1_pending_at_ms: toNum(position.tp_p1_pending_at_ms, null),
          tp_p1_pending_until_ms: toNum(position.tp_p1_pending_until_ms, null),
          trail_active: !!position.trail_active,
        }
      : { exists: false },
    diagnosis,
  };

  if (outPathArg) {
    const abs = path.isAbsolute(outPathArg) ? outPathArg : path.join(process.cwd(), outPathArg);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: errorText(err),
    hint: "GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_CLOUD_PROJECT / 네트워크 상태를 확인하세요.",
  }, null, 2));
  process.exit(1);
});
