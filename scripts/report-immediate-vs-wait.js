#!/usr/bin/env node
"use strict";

const { getFirestore } = require("../src/storage/firestore");
const { resolveEventMapping } = require("../src/services/signalMapping");

function getArg(name, defVal) {
  const key = `--${name}=`;
  const found = process.argv.find((x) => x.startsWith(key));
  if (!found) return defVal;
  return found.slice(key.length);
}

function toMs(x) {
  if (x == null) return null;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const t = Date.parse(x);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function normalizeExchange(x) {
  const s = String(x || "").trim().toUpperCase();
  if (!s) return null;
  if (s === "BINANCE" || s === "BINANCEFUT" || s === "BINANCE_FUT") return "BINANCEFUT";
  if (s === "UPBIT") return "UPBIT";
  if (s === "KIWOOM") return "KIWOOM";
  return s;
}

function classifyTiming(pendingReason) {
  const r = String(pendingReason || "").toUpperCase();
  if (!r) return "UNKNOWN";
  if (r.includes("EXEC_CURRENT_BAR")) return "EXEC_CURRENT_BAR";
  if (r.includes("REAL_IMMEDIATE_ENTRY")) return "REAL_IMMEDIATE";
  if (r.includes("CORE_IMMEDIATE_PROBE")) return "CORE_IMMEDIATE";
  if (r.includes("IMMEDIATE_ENTRY")) return "IMMEDIATE";
  if (r.includes("CORE_CONFIRM_NEXT_BAR")) return "CORE_CONFIRM_NEXT_BAR";
  if (r.includes("WAIT_NEXT_BAR")) return "WAIT_NEXT_BAR";
  if (r.includes("IMMEDIATE_EXEC")) return "IMMEDIATE_EXEC";
  return r;
}

function eventTier(event) {
  const e = String(event || "").toUpperCase();
  if (e.startsWith("REAL_")) return "REAL";
  if (e.startsWith("CORE_")) return "CORE";
  if (e.startsWith("EARLY_")) return "EARLY";
  if (e.startsWith("EMO_")) return "EMO";
  return "OTHER";
}

(async () => {
  const exchangeArg = normalizeExchange(getArg("exchange", ""));
  const hours = Number(getArg("hours", "24"));
  const limit = Number(getArg("limit", "5000"));
  const fromArg = getArg("from", "");
  const fromMs = fromArg ? toMs(fromArg) : (Number.isFinite(hours) && hours > 0 ? Date.now() - hours * 60 * 60 * 1000 : null);

  const db = getFirestore();
  const snap = await db.collection("order_intents_paper").orderBy("created_at", "desc").limit(Math.max(1, limit || 1)).get();

  const rows = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = normalizeExchange(x.exchange);
    if (exchangeArg && ex !== exchangeArg) return;
    const createdMs = toMs(x.created_at) || toMs(x.created_at_ms) || toMs(x.signal_bar_close_time_utc_ms);
    if (Number.isFinite(fromMs) && Number.isFinite(createdMs) && createdMs < fromMs) return;
    rows.push({ ...x, _exchange: ex, _created_ms: createdMs });
  });

  const byExchange = new Map();
  for (const r of rows) {
    const ex = r._exchange || "UNKNOWN";
    if (!byExchange.has(ex)) {
      byExchange.set(ex, { total: 0, entries: 0, exits: 0, adds: 0, timing: {}, tiers: {} });
    }
    const acc = byExchange.get(ex);
    acc.total += 1;
    const mapping = resolveEventMapping({ event: r.event, side: r.side });
    const intent = mapping.intent || "UNKNOWN";
    if (intent === "ENTRY") acc.entries += 1;
    else if (intent === "EXIT") acc.exits += 1;
    else if (intent === "ADD") acc.adds += 1;

    if (intent === "ENTRY" || intent === "ADD") {
      const timing = classifyTiming(r.pending_reason || r.pendingReason);
      acc.timing[timing] = (acc.timing[timing] || 0) + 1;
      const tier = eventTier(r.event);
      acc.tiers[tier] = (acc.tiers[tier] || 0) + 1;
    }
  }

  const out = {
    range: {
      exchange: exchangeArg || "ALL",
      from_ms: fromMs || null,
      from_iso: fromMs ? new Date(fromMs).toISOString() : null,
      limit_scanned: limit,
      intents_matched: rows.length,
    },
    exchanges: {},
  };

  for (const [ex, acc] of byExchange.entries()) {
    const entryBase = acc.entries + acc.adds;
    const immediate = (acc.timing.REAL_IMMEDIATE || 0)
      + (acc.timing.CORE_IMMEDIATE || 0)
      + (acc.timing.IMMEDIATE || 0)
      + (acc.timing.EXEC_CURRENT_BAR || 0);
    const wait = acc.timing.WAIT_NEXT_BAR || 0;
    const confirm = acc.timing.CORE_CONFIRM_NEXT_BAR || 0;
    const execCurrentBar = acc.timing.EXEC_CURRENT_BAR || 0;
    out.exchanges[ex] = {
      total_intents: acc.total,
      entry_intents: acc.entries,
      add_intents: acc.adds,
      exit_intents: acc.exits,
      entry_base: entryBase,
      timing: acc.timing,
      tiers: acc.tiers,
      ratios: {
        immediate_rate: entryBase ? Number((immediate / entryBase).toFixed(4)) : null,
        exec_current_bar_rate: entryBase ? Number((execCurrentBar / entryBase).toFixed(4)) : null,
        wait_rate: entryBase ? Number((wait / entryBase).toFixed(4)) : null,
        confirm_rate: entryBase ? Number((confirm / entryBase).toFixed(4)) : null,
      },
    };
  }

  console.log(JSON.stringify(out, null, 2));
})();
