#!/usr/bin/env node
"use strict";

// scripts/run-v3-funding-monitor.js — hourly funding-carry watcher.
// Alerts (deduped per symbol, 24h re-arm) when trailing-window funding APY
// crosses the threshold; artifact feeds the deadman heartbeat.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");
const {
  computeTrailingFundingApy,
  decideHotSymbols,
  resolveAlertApyPct,
  resolveWindowDays,
  resolveSymbols,
} = require("../src/v3/fundingMonitor");
const { alertOnce } = require("../src/v3/opsAlert");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "ops/daily/v3_funding_monitor_latest.json");
const ALERT_STATE = path.join(ROOT, "ops/runtime/v3_ops_alert_state.json");

async function fetchFunding(symbol) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=120`);
  if (!res.ok) throw new Error(`${symbol} HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const symbols = resolveSymbols();
  const windowDays = resolveWindowDays();
  const alertApy = resolveAlertApyPct();

  const perSymbol = {};
  for (const sym of symbols) {
    try {
      perSymbol[sym] = computeTrailingFundingApy(await fetchFunding(sym), windowDays);
    } catch (e) {
      perSymbol[sym] = { apy_pct: null, error: String(e && e.message || e) };
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  const hot = decideHotSymbols(perSymbol, { alertApyPct: alertApy, windowDays });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    alert_apy_pct: alertApy,
    per_symbol: perSymbol,
    hot,
  }, null, 2));

  // per-symbol transition alerts (24h re-arm while continuously hot)
  for (const sym of symbols) {
    const h = hot.find((x) => x.symbol === sym);
    await alertOnce({
      stateFile: ALERT_STATE,
      key: `funding_hot_${sym}`,
      active: !!h,
      title: `💰 funding carry 가열: ${sym}`,
      severity: "info",
      recoveryTitle: `funding carry 냉각: ${sym}`,
      rearmMs: 24 * 60 * 60 * 1000,
      body: h
        ? `${sym} 최근 ${windowDays}일 funding APY ${h.apy_pct}% (임계 ${alertApy}%, 이벤트 ${h.events}건 중 음수 ${h.negative_events}). 델타중립 carry (현물 롱+무기한 숏) 검토 시점 — 실행 레이어는 아직 없음, 이 알림이 설계 트리거.`
        : "",
    });
  }

  console.log(JSON.stringify({ ok: true, hot: hot.map((h) => `${h.symbol}:${h.apy_pct}%`), latest_json: OUT }));
}

if (require.main === module) {
  main().catch((e) => { console.error("RUN_V3_FUNDING_MONITOR_FAIL", e && e.stack ? e.stack : String(e)); process.exit(1); });
}
