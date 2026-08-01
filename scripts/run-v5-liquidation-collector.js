#!/usr/bin/env node
"use strict";

// scripts/run-v5-liquidation-collector.js (2026-08-01)
//
// STATUS 2026-08-01 — NOT DEPLOYABLE ON THIS HOST.
// Verified twice (standalone and under launchd, ~150s total): the socket
// OPENS against fstream.binance.com but no frames are ever delivered — not
// even btcusdt@aggTrade, which fires many times per second in any market.
// REST market data works perfectly from the same host all session, so this
// is a websocket-path problem on this network (middlebox / stream access),
// not a code defect. The launchd job was therefore UNLOADED rather than left
// running as a collector that can never collect.
//
// The working alternative already exists: scripts/analyze-v5-liquidation-wick.js
// detects the same cascades from kline wicks over MONTHS of REST history.
// Re-enable this file only on a network where a plain
//   node -e "new (require(String.fromCharCode(119,115)))(...)"  smoke test
// actually delivers frames.
//
// Binance does not serve historical forced-liquidation data over REST — the
// only public access is the live `!forceOrder@arr` websocket stream. That is
// precisely why liquidation-cascade strategies were listed as "untested":
// the dataset does not exist until someone records it. This records it.
//
// Output: ops/runtime/v5_liquidation_feed.jsonl, one row per liquidation
//   { ts, symbol, side, price, qty, notional_usdt }
// `side` is the side of the LIQUIDATION ORDER, so side=SELL means longs were
// force-sold (downside cascade) and side=BUY means shorts were squeezed.
//
// Runs under launchd with KeepAlive: the socket reconnects with backoff, and
// a heartbeat artifact lets the deadman watch it like every other lane.
// Read-only market data — no keys, no orders, nothing to lose.

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const ROOT = path.resolve(__dirname, "..");
const FEED = path.join(ROOT, "ops/runtime/v5_liquidation_feed.jsonl");
const HEARTBEAT = path.join(ROOT, "ops/daily/v5_liquidation_collector_latest.json");
const URL = "wss://fstream.binance.com/ws/!forceOrder@arr";

const MIN_NOTIONAL = Number(process.env.V5_LIQ_MIN_NOTIONAL) >= 0
  ? Number(process.env.V5_LIQ_MIN_NOTIONAL) : 0;

let received = 0;
let written = 0;
let connectedAt = null;
let reconnects = 0;
let lastEventTs = null;

function writeHeartbeat(state) {
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true });
    fs.writeFileSync(HEARTBEAT, JSON.stringify({
      generated_at: new Date().toISOString(),
      state,
      connected_at: connectedAt ? new Date(connectedAt).toISOString() : null,
      received, written, reconnects,
      last_event_at: lastEventTs ? new Date(lastEventTs).toISOString() : null,
      feed: FEED,
      min_notional_usdt: MIN_NOTIONAL,
    }, null, 2));
  } catch (_) { /* heartbeat must never kill the collector */ }
}

function handle(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }
  // payload: { e:"forceOrder", E, o:{ s, S, o, f, q, p, ap, X, l, z, T } }
  const o = msg && msg.o;
  if (!o || !o.s) return;
  received += 1;
  lastEventTs = Number(msg.E) || Date.now();
  const price = Number(o.ap || o.p);
  const qty = Number(o.z || o.q);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return;
  const notional = price * qty;
  if (notional < MIN_NOTIONAL) return;
  const row = {
    ts: Number(o.T) || lastEventTs,
    symbol: String(o.s).toUpperCase(),
    side: String(o.S).toUpperCase(),   // SELL = longs liquidated, BUY = shorts squeezed
    price, qty,
    notional_usdt: Math.round(notional * 100) / 100,
  };
  try {
    fs.mkdirSync(path.dirname(FEED), { recursive: true });
    fs.appendFileSync(FEED, JSON.stringify(row) + "\n", "utf8");
    written += 1;
  } catch (_) { /* disk hiccup — drop the row rather than crash the stream */ }
}

let backoffMs = 1000;
function connect() {
  const ws = new WebSocket(URL);
  let alive = false;

  ws.on("open", () => {
    alive = true;
    connectedAt = Date.now();
    backoffMs = 1000;
    writeHeartbeat("CONNECTED");
    console.log(JSON.stringify({ ok: true, event: "connected", url: URL }));
  });
  ws.on("message", handle);
  ws.on("error", (e) => console.error("WS_ERROR", e && e.message));
  ws.on("close", (code) => {
    writeHeartbeat("DISCONNECTED");
    console.error(JSON.stringify({ event: "closed", code, reconnect_in_ms: backoffMs }));
    reconnects += 1;
    setTimeout(connect, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 60000); // capped exponential backoff
  });

  // Binance pings; if nothing arrives for 5 minutes the socket is stale.
  const stale = setInterval(() => {
    if (!alive) return;
    const quietMs = Date.now() - (lastEventTs || connectedAt || Date.now());
    if (quietMs > 5 * 60 * 1000) {
      console.error(JSON.stringify({ event: "stale_socket", quiet_ms: quietMs }));
      try { ws.terminate(); } catch (_) {}
    }
  }, 60 * 1000);
  ws.on("close", () => clearInterval(stale));
}

setInterval(() => writeHeartbeat("RUNNING"), 60 * 1000).unref?.();
writeHeartbeat("STARTING");
connect();
