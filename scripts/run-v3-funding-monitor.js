#!/usr/bin/env node
"use strict";

// scripts/run-v3-funding-monitor.js — hourly CARRY watcher.
//
// 2026-08-01: widened from funding-only to every measurable contractual
// carry, and re-anchored on the benchmark that actually matters — the
// risk-free stablecoin yield. Rationale in src/v4/basisCarry.js: after 107
// directional configurations produced nothing that survives multiple-testing
// correction, the honest system stops predicting and instead measures yields
// that are written in today's contract prices (funding is paid every 8h;
// dated-future basis is enforced by delivery convergence). Those need no
// backtest and no 20-year validation horizon.
//
// Emits a single carry menu ranked by EXCESS over risk-free, with the default
// posture "HOLD_RISK_FREE" — doing nothing is the benchmark every source has
// to beat. File and job names are unchanged so the deadman heartbeat and
// launchd wiring keep working.

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
const { computeBasisCarry, rankCarrySources } = require("../src/v4/basisCarry");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "ops/daily/v3_funding_monitor_latest.json");
const ALERT_STATE = path.join(ROOT, "ops/runtime/v3_ops_alert_state.json");

// benchmark: what the capital earns doing nothing (stablecoin yield)
const RISK_FREE_PCT = Number.isFinite(Number(process.env.V4_RISK_FREE_PCT)) ? Number(process.env.V4_RISK_FREE_PCT) : 5;
// how much richer a source must be before running a live delta-neutral book
const MIN_EXCESS_PCT = Number.isFinite(Number(process.env.V4_CARRY_MIN_EXCESS_PCT)) ? Number(process.env.V4_CARRY_MIN_EXCESS_PCT) : 5;
// round-trip cost across both legs of a basis trade, percent
const BASIS_COST_PCT = Number.isFinite(Number(process.env.V4_BASIS_COST_PCT)) ? Number(process.env.V4_BASIS_COST_PCT) : 0.20;
// funding harvesting also pays fees on entry/exit of both legs; charged as an
// annualized haircut so funding and basis are compared on the same footing.
const FUNDING_COST_PCT = Number.isFinite(Number(process.env.V4_FUNDING_COST_PCT)) ? Number(process.env.V4_FUNDING_COST_PCT) : 0.4;

async function fetchFunding(symbol) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=120`);
  if (!res.ok) throw new Error(`${symbol} HTTP ${res.status}`);
  return res.json();
}

// Dated (quarterly) contracts and their spot references.
async function fetchBasisSources() {
  const out = [];
  let info;
  try { info = await (await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo")).json(); }
  catch (_) { return out; }
  const dated = (info.symbols || []).filter((s) =>
    s.status === "TRADING" && s.contractType &&
    (s.contractType === "CURRENT_QUARTER" || s.contractType === "NEXT_QUARTER"));
  const spotCache = new Map();
  const now = Date.now();
  for (const c of dated) {
    try {
      if (!spotCache.has(c.pair)) {
        const t = await (await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${c.pair}`)).json();
        spotCache.set(c.pair, Number(t.price));
        await new Promise((r) => setTimeout(r, 80));
      }
      const spot = spotCache.get(c.pair);
      const t = await (await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${c.symbol}`)).json();
      const carry = computeBasisCarry({
        spotPrice: spot,
        futurePrice: Number(t.price),
        daysToExpiry: (Number(c.deliveryDate) - now) / 86400000,
        roundTripCostPct: BASIS_COST_PCT,
      });
      if (carry) out.push({ kind: "basis", symbol: c.symbol, annualized_net_pct: carry.annualized_net_pct, detail: carry });
      await new Promise((r) => setTimeout(r, 80));
    } catch (_) { /* contract unavailable this run */ }
  }
  return out;
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

  // unified carry menu: funding + dated basis, ranked by excess over risk-free
  const fundingSources = Object.entries(perSymbol)
    .filter(([, m]) => m && m.apy_pct !== null)
    .map(([sym, m]) => ({
      kind: "funding",
      symbol: sym,
      annualized_net_pct: +(m.apy_pct - FUNDING_COST_PCT).toFixed(3),
      detail: m,
    }));
  const basisSources = await fetchBasisSources();
  const carry = rankCarrySources({
    sources: [...fundingSources, ...basisSources],
    riskFreePct: RISK_FREE_PCT,
    minExcessPct: MIN_EXCESS_PCT,
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    alert_apy_pct: alertApy,
    per_symbol: perSymbol,
    hot,
    carry_menu: carry,
  }, null, 2));

  // one alert on the portfolio-level verdict: is ANY carry worth deploying?
  await alertOnce({
    stateFile: ALERT_STATE,
    key: "carry_deploy_worthy",
    active: carry.verdict === "CARRY_RICH_REVIEW_DEPLOY",
    title: "💰 캐리 리치: 델타중립 배치 검토 시점",
    severity: "info",
    recoveryTitle: "캐리 냉각: 무위험 보유로 복귀",
    rearmMs: 24 * 60 * 60 * 1000,
    body: carry.deploy_worthy.length
      ? carry.deploy_worthy.map((s) => `${s.kind} ${s.symbol}: 순 ${s.annualized_net_pct}%/yr (무위험 ${RISK_FREE_PCT}% 대비 +${s.excess_pct}%p)`).join("\n")
        + `\n\n실행 레이어는 아직 없음 — 이 알림이 설계 트리거.`
      : "",
  });

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

  console.log(JSON.stringify({
    ok: true,
    hot: hot.map((h) => `${h.symbol}:${h.apy_pct}%`),
    carry_verdict: carry.verdict,
    best_carry: carry.best ? `${carry.best.kind} ${carry.best.symbol} ${carry.best.annualized_net_pct}% (excess ${carry.best.excess_pct}pp)` : null,
    risk_free_pct: RISK_FREE_PCT,
    latest_json: OUT,
  }));
}

if (require.main === module) {
  main().catch((e) => { console.error("RUN_V3_FUNDING_MONITOR_FAIL", e && e.stack ? e.stack : String(e)); process.exit(1); });
}
