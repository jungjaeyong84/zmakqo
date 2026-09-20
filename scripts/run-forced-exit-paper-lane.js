#!/usr/bin/env node
"use strict";

// scripts/run-forced-exit-paper-lane.js — paper lane for the forced-exit short
// (2026-09-20). PAPER ONLY: no keys, no order path, live exposure is always 0.
//
// WHAT IT TESTS
// -------------
// When Binance announces that holders must leave a token — the token is
// delisted, its perpetual is delisted, or it is put under the Monitoring Tag —
// short that token's USDT perpetual and hold for a week. Across 175 such
// announcements since 2024 the short won 68.6% of the time with a median of
// +10.3%, and a +50% stop cut the tail that had ruined the unstopped version.
//
// Why a lane instead of another backtest: the rule below was shaped by looking
// at those 175 events. Two of the three families were seen before the stop was
// designed, so the combined number is exploration, not evidence. Only
// announcements that arrive AFTER this file was written can settle it, and the
// rule is therefore frozen until the decision dates below.
//
// FROZEN RULE — do not change before the final decision
//   events    Binance announcements, three families:
//               A "Binance Will Delist <tokens> on <date>"
//               B "Binance Futures Will Delist ... Perpetual Contract(s)"
//               C "Binance Will Extend the Monitoring Tag to Include <tokens>"
//             matched to TOKEN / 1000TOKEN / 1000000TOKEN + USDT perpetual that
//             was already listed; the same symbol is not re-entered within 30 days.
//   entry     the close of the hourly bar containing the announcement.
//   exit      168 hours after entry, or the last close if the contract stops
//             trading, whichever comes first.
//   stop      an hourly high at or above 1.5x entry closes the position there.
//   size      6% of equity per event, total gross capped at 100% of equity.
//   costs     0.15% per side; funding paid by the short is debited, received credited.
//
// DECISION (fixed here, in advance)
//   interim   2027-03-20 or 30 closed events, whichever is later
//   final     2027-09-20 or 60 closed events, whichever is later
//   PASS      mean monthly >= 3%, losing months <= 20%, mean / |worst month| >= 0.25,
//             top 5 events <= 50% of total profit
//   A rule change before the final decision voids the test.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVENTS = path.join(ROOT, "ops/runtime/forced_exit_events.jsonl");
const LEDGER = path.join(ROOT, "ops/runtime/forced_exit_paper_ledger.jsonl");
const REPORT = path.join(ROOT, "ops/daily/forced_exit_paper_latest.json");

// ---- frozen parameters ------------------------------------------------------
const H = 3600e3;
const DAY = 864e5;
const HOLD_H = 168;
const STOP = 1.5;
const COST = 0.0015;
const SIZE = 0.06;
const MAX_GROSS = 1.0;
const DEDUPE_DAYS = 30;
const LOOKBACK_H = 72;          // announcements this old are still entered (catch-up after downtime)
const INTERIM = { date: "2027-03-20", events: 30 };
const FINAL = { date: "2027-09-20", events: 60 };
// -----------------------------------------------------------------------------

const FAPI = "https://fapi.binance.com";
const CMS = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rateLimited = null;

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (res.status === 429 || res.status === 418) { rateLimited = res.status; throw new Error(`RATE_LIMITED ${res.status}`); }
  if (!res.ok) return null;
  return res.json();
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

function append(p, row) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, `${JSON.stringify(row)}\n`);
}

// ---- announcement parsing (the three families) ------------------------------
function parseArticle(title) {
  let m = title.match(/^Binance Will Delist (.+?) on (\d{4}-\d{2}-\d{2})/i);
  if (m) return { family: "token_delist", tokens: splitTokens(m[1]) };
  if (/^Binance Futures Will Delist/i.test(title)) {
    const syms = [...new Set([...title.matchAll(/\b([A-Z0-9]{2,20}USDT)\b/g)].map((x) => x[1]))];
    return { family: "futures_delist", symbols: syms };
  }
  m = title.match(/Monitoring Tag to (?:Include )?(.+?)(?:\s+on\s+\d{4}-\d{2}-\d{2}|,?\s+(?:and\s+)?Remove|$)/i);
  if (m && /Extend/i.test(title)) return { family: "monitoring_tag", tokens: splitTokens(m[1]) };
  return null;
}

function splitTokens(s) {
  return s.replace(/\(.*?\)/g, "").replace(/\d{4}-\d{2}-\d{2}/g, "").split(/,\s*|\s*&\s*|\s+and\s+/)
    .map((x) => x.trim()).filter((x) => /^[A-Z0-9]{2,15}$/.test(x));
}

async function fetchAnnouncements() {
  const out = [];
  for (const catalogId of [161, 49]) {
    for (const pageNo of [1, 2]) {
      const j = await getJson(`${CMS}?type=1&catalogId=${catalogId}&pageNo=${pageNo}&pageSize=20`, { "User-Agent": "Mozilla/5.0" });
      const c = j && j.data && j.data.catalogs && j.data.catalogs[0];
      if (c && Array.isArray(c.articles)) for (const a of c.articles) out.push({ code: a.code, title: a.title, release: a.releaseDate });
      await sleep(600);
    }
  }
  return out;
}

// ---- market data ------------------------------------------------------------
async function perpIndex() {
  const info = await getJson(`${FAPI}/fapi/v1/exchangeInfo`);
  const m = new Map();
  for (const s of info.symbols) {
    if (s.quoteAsset !== "USDT" || s.contractType !== "PERPETUAL") continue;
    m.set(s.symbol, { symbol: s.symbol, onboard: s.onboardDate, status: s.status });
  }
  return m;
}

async function klines(symbol, startTime, limit = 300) {
  const r = await getJson(`${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1h&startTime=${startTime}&limit=${limit}`);
  return Array.isArray(r) ? r.map((x) => [Number(x[0]), Number(x[1]), Number(x[2]), Number(x[3]), Number(x[4])]) : [];
}

async function funding(symbol, startTime) {
  const r = await getJson(`${FAPI}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${startTime}&limit=100`);
  return Array.isArray(r) ? r.map((x) => [Number(x.fundingTime), Number(x.fundingRate)]) : [];
}

function symbolFor(token, perps) {
  return [`${token}USDT`, `1000${token}USDT`, `1000000${token}USDT`].find((s) => perps.has(s)) || null;
}

// ---- lane -------------------------------------------------------------------
async function main() {
  const now = Date.now();
  const events = readJsonl(EVENTS);
  const ledger = readJsonl(LEDGER);
  const errors = [];

  const closed = ledger.filter((r) => r.status === "CLOSED");
  const openRows = new Map();
  for (const r of ledger) {
    if (r.status === "OPEN") openRows.set(r.event_id, r);
    if (r.status === "CLOSED") openRows.delete(r.event_id);
  }
  let equity = closed.length ? closed[closed.length - 1].equity_after : 1;

  const perps = await perpIndex();

  // 1) new events
  let articles = [];
  try { articles = await fetchAnnouncements(); } catch (e) { errors.push(`announcements: ${e.message}`); }
  const seenIds = new Set(events.map((e) => e.event_id));
  for (const a of articles) {
    if (now - a.release > LOOKBACK_H * H) continue;
    const parsed = parseArticle(a.title);
    if (!parsed) continue;
    const symbols = parsed.symbols || parsed.tokens.map((t) => symbolFor(t, perps)).filter(Boolean);
    for (const symbol of symbols) {
      const p = perps.get(symbol);
      if (!p || !(p.onboard < a.release)) continue;
      const id = `${a.code}|${symbol}`;
      if (seenIds.has(id)) continue;
      const recent = events.some((e) => e.symbol === symbol && Math.abs(e.announced_ms - a.release) <= DEDUPE_DAYS * DAY);
      const row = { event_id: id, family: parsed.family, symbol, title: a.title, announced: new Date(a.release).toISOString(), announced_ms: a.release, skipped: recent ? "within 30 days of a prior event" : null, detected_at: new Date(now).toISOString() };
      append(EVENTS, row);
      events.push(row);
      seenIds.add(id);
    }
  }

  // 2) open positions for entries whose announcement hour has closed
  const grossOpen = () => [...openRows.values()].reduce((a, r) => a + r.size, 0);
  for (const e of events) {
    if (e.skipped || openRows.has(e.event_id) || ledger.some((r) => r.event_id === e.event_id)) continue;
    const barOpen = Math.floor(e.announced_ms / H) * H;
    if (now < barOpen + H) continue;                       // entry bar still forming
    if (now > e.announced_ms + LOOKBACK_H * H) { append(LEDGER, { event_id: e.event_id, symbol: e.symbol, status: "SKIPPED", reason: "detected too late", at: new Date(now).toISOString() }); continue; }
    if (grossOpen() + SIZE > MAX_GROSS) { append(LEDGER, { event_id: e.event_id, symbol: e.symbol, status: "SKIPPED", reason: "gross cap", at: new Date(now).toISOString() }); continue; }
    let bars = [];
    try { bars = await klines(e.symbol, barOpen, 2); } catch (err) { errors.push(`${e.symbol} entry klines: ${err.message}`); break; }
    const bar = bars.find((b) => b[0] === barOpen);
    if (!bar) { errors.push(`${e.symbol}: no bar at ${new Date(barOpen).toISOString()}`); continue; }
    const row = { event_id: e.event_id, family: e.family, symbol: e.symbol, status: "OPEN", announced: e.announced,
      entry_ts: barOpen, entry_time: new Date(barOpen).toISOString(), entry_price: bar[4], size: SIZE, side: "SHORT",
      stop_price: bar[4] * STOP, opened_at: new Date(now).toISOString() };
    append(LEDGER, row);
    ledger.push(row);
    openRows.set(e.event_id, row);
    await sleep(300);
  }

  // 3) manage open positions
  for (const [id, pos] of [...openRows]) {
    let bars = [];
    try { bars = await klines(pos.symbol, pos.entry_ts, 300); } catch (err) { errors.push(`${pos.symbol} klines: ${err.message}`); continue; }
    if (!bars.length) continue;
    const deadline = pos.entry_ts + HOLD_H * H;
    let exitPrice = null, exitTs = null, reason = null;
    for (const b of bars) {
      if (b[0] <= pos.entry_ts) continue;
      if (b[0] + H > now) break;                            // only closed bars
      if (b[2] >= pos.stop_price) { exitPrice = pos.stop_price; exitTs = b[0]; reason = "STOP"; break; }
      if (b[0] >= deadline) { exitPrice = b[4]; exitTs = b[0]; reason = "HOLD_EXPIRED"; break; }
    }
    const last = bars[bars.length - 1];
    if (!exitPrice && now - (last[0] + H) > 12 * H) { exitPrice = last[4]; exitTs = last[0]; reason = "CONTRACT_ENDED"; }
    if (!exitPrice) continue;
    let fundingSum = 0;
    try {
      for (const [t, r] of await funding(pos.symbol, pos.entry_ts + 1)) if (t <= exitTs + H) fundingSum += r;
    } catch (err) { errors.push(`${pos.symbol} funding: ${err.message}`); }
    const gross = -(exitPrice - pos.entry_price) / pos.entry_price;
    const pnl = gross + fundingSum - 2 * COST;
    const equityAfter = equity * (1 + pos.size * pnl);
    append(LEDGER, { event_id: id, family: pos.family, symbol: pos.symbol, status: "CLOSED", announced: pos.announced,
      entry_time: pos.entry_time, entry_price: pos.entry_price, exit_time: new Date(exitTs).toISOString(), exit_price: exitPrice,
      exit_reason: reason, gross_pct: Math.round(gross * 1e4) / 100, funding_pct: Math.round(fundingSum * 1e4) / 100,
      cost_pct: Math.round(2 * COST * 1e4) / 100, pnl_pct: Math.round(pnl * 1e4) / 100, size: pos.size,
      equity_before: Math.round(equity * 1e6) / 1e6, equity_after: Math.round(equityAfter * 1e6) / 1e6, closed_at: new Date(now).toISOString() });
    equity = equityAfter;
    openRows.delete(id);
    await sleep(300);
  }

  // 4) report
  const allClosed = readJsonl(LEDGER).filter((r) => r.status === "CLOSED");
  const byMonth = new Map();
  for (const r of allClosed) {
    const m = r.exit_time.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) || 0) + r.size * (r.pnl_pct / 100));
  }
  const months = [...byMonth].sort();
  const vals = months.map(([, v]) => v * 100);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const worst = vals.length ? Math.min(...vals) : null;
  const total = allClosed.reduce((a, r) => a + r.size * (r.pnl_pct / 100), 0);
  const top5 = allClosed.map((r) => r.size * (r.pnl_pct / 100)).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const due = (d) => new Date().toISOString().slice(0, 10) >= d.date && allClosed.length >= d.events;
  const report = {
    generated_at: new Date(now).toISOString(),
    lane: "forced_exit_short_paper",
    rule: "short the USDT perp after a Binance delist / futures-delist / monitoring-tag announcement; 168h; +50% stop; 6% of equity per event; gross <= 100%",
    frozen_until: FINAL.date,
    events_detected: events.length,
    events_skipped_dedupe: events.filter((e) => e.skipped).length,
    open_positions: [...openRows.values()].map((r) => ({ symbol: r.symbol, entry_time: r.entry_time, entry_price: r.entry_price, stop_price: r.stop_price })),
    closed_events: allClosed.length,
    equity: Math.round(equity * 1e6) / 1e6,
    win_rate: allClosed.length ? Math.round((allClosed.filter((r) => r.pnl_pct > 0).length / allClosed.length) * 1000) / 1000 : null,
    stops_hit: allClosed.filter((r) => r.exit_reason === "STOP").length,
    monthly_pct: months.map(([m, v]) => `${m} ${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}`),
    mean_monthly_pct: mean === null ? null : Math.round(mean * 100) / 100,
    losing_share: vals.length ? Math.round((vals.filter((v) => v < 0).length / vals.length) * 1000) / 1000 : null,
    mean_over_worst: mean === null || worst === null || worst >= 0 ? null : Math.round((mean / Math.abs(worst)) * 1000) / 1000,
    top5_share: total > 0 ? Math.round((top5 / total) * 1000) / 1000 : null,
    decision: { interim: INTERIM, final: FINAL, interim_due: due(INTERIM), final_due: due(FINAL) },
    verdict: allClosed.length < INTERIM.events ? "ACCUMULATING" : "SEE_DECISION_CRITERIA",
    live_exposure_usdt: 0,
    rate_limited: rateLimited,
    errors,
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: !rateLimited, detected: events.length, open: openRows.size, closed: allClosed.length, equity: report.equity, errors: errors.length }));
  if (rateLimited) process.exit(3);
}

if (require.main === module) {
  main().catch((e) => { console.error("FORCED_EXIT_PAPER_LANE_FAIL", e && e.stack ? e.stack : String(e)); process.exit(1); });
}

module.exports = { parseArticle, splitTokens, symbolFor };
