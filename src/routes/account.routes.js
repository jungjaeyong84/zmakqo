const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { getBinanceFuturesAccountSummary } = require("../services/binanceFuturesAccountSummary");
const { getBinanceWalletCashflow } = require("../services/binanceWalletCashflow");

const CACHE_TTL_MS = 30_000;
const SNAPSHOT_MIN_INTERVAL_MS = 30 * 60 * 1000;

let cache = {};

async function loadRecentSnapshots(db, exchange, limitN = 400) {
  const snap = await db.collection("account_snapshots")
    .orderBy("created_at", "desc")
    .limit(limitN)
    .get();
  const rows = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    if (String(x.exchange || "").toUpperCase() !== exchange) return;
    rows.push(x);
  });
  return rows;
}

function findSnapshotBefore(rows, targetMs) {
  for (const r of rows) {
    const ms = Date.parse(String(r.created_at || ""));
    if (!Number.isFinite(ms)) continue;
    if (ms <= targetMs) return r;
  }
  return null;
}

function calcGrowth(current, prev, opts = {}) {
  const cur = Number(current);
  const base = prev ? Number(prev.total_value ?? prev.total_krw) : null;
  if (!Number.isFinite(cur) || !Number.isFinite(base) || base <= 0) {
    return {
      pct: null,
      delta_krw: null,
      since: prev ? prev.created_at : null,
      raw_pct: null,
      raw_delta_krw: null,
      external_flow_value: null,
      adjusted_by_cashflow: false,
    };
  }
  const rawDelta = cur - base;
  const extFlow = Number(opts.externalFlowValue);
  const hasExtFlow = Number.isFinite(extFlow);
  const adjDelta = hasExtFlow ? (rawDelta - extFlow) : rawDelta;
  return {
    pct: adjDelta / base,
    delta_krw: adjDelta,
    since: prev.created_at,
    raw_pct: rawDelta / base,
    raw_delta_krw: rawDelta,
    external_flow_value: hasExtFlow ? extFlow : null,
    adjusted_by_cashflow: hasExtFlow,
  };
}

function summarizeBinanceUsdtCashflow(entries, fromMs, toMs) {
  if (!Array.isArray(entries) || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return { net: null, deposit: null, withdraw: null, used: 0, skipped_non_usdt: 0 };
  }
  let net = 0;
  let deposit = 0;
  let withdraw = 0;
  let used = 0;
  let skippedNonUsdt = 0;
  for (const row of entries) {
    if (!row || row.completed !== true || row.excluded_from_summary === true) continue;
    const ms = Number(row.time_ms);
    if (!Number.isFinite(ms) || ms <= fromMs || ms > toMs) continue;
    const coin = String(row.coin || "").toUpperCase();
    if (coin !== "USDT") {
      skippedNonUsdt += 1;
      continue;
    }
    const amt = Number(row.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (row.type === "DEPOSIT") {
      net += amt;
      deposit += amt;
      used += 1;
    } else if (row.type === "WITHDRAW") {
      net -= amt;
      withdraw += amt;
      used += 1;
    }
  }
  if (!used) return { net: 0, deposit: 0, withdraw: 0, used: 0, skipped_non_usdt: skippedNonUsdt };
  return { net, deposit, withdraw, used, skipped_non_usdt: skippedNonUsdt };
}

async function maybeSaveSnapshot(db, exchange, summary, rows) {
  const latest = rows && rows.length ? rows[0] : null;
  const latestMs = latest ? Date.parse(String(latest.created_at || "")) : null;
  const nowMs = Date.parse(String(summary.updated_at || "")) || Date.now();
  if (Number.isFinite(latestMs) && (nowMs - latestMs) < SNAPSHOT_MIN_INTERVAL_MS) return;

  const totalValue = Number(summary.total_value ?? summary.total_krw);
  const cashValue = Number(summary.cash_value ?? summary.cash_krw);
  const docId = `ACC__${exchange}__${nowMs}`;
  await db.collection("account_snapshots").doc(docId).set({
    exchange,
    unit: summary.unit || (exchange === "BINANCEFUT" ? "USDT" : "KRW"),
    total_value: Number.isFinite(totalValue) ? totalValue : null,
    cash_value: Number.isFinite(cashValue) ? cashValue : null,
    total_krw: summary.total_krw ?? null,
    cash_krw: summary.cash_krw ?? null,
    holdings_n: summary.holdings_n,
    created_at: summary.updated_at,
  });
}

router.get("/api/account/summary", async (req, res) => {
  try {
    const exchangeRaw = String(req.query.exchange || "BINANCEFUT").toUpperCase();
    const exchange = exchangeRaw.includes("BINANCE")
      ? "BINANCEFUT"
      : "BINANCEFUT";

    const now = Date.now();
    const cached = cache[exchange];
    if (cached && cached.data && (now - cached.ts) <= CACHE_TTL_MS) {
      return res.json({ ...cached.data, cached: true });
    }

    const data = await getExchangeSettingsForProvider("BINANCEFUT", 3000);
    const apiKey = String(process.env.BINANCEFUT_API_KEY || (data && data.api_key) || "");
    const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (data && data.api_secret) || "");
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ ok: false, error: "BINANCEFUT_KEYS_MISSING" });
    }
    const summary = await getBinanceFuturesAccountSummary({ apiKey, apiSecret });

    const db = getFirestore();
    const rows = await loadRecentSnapshots(db, exchange, 400);
    await maybeSaveSnapshot(db, exchange, summary, rows);

    const nowMs = Date.parse(String(summary.updated_at || "")) || Date.now();
    const daySnap = findSnapshotBefore(rows, nowMs - 24 * 60 * 60 * 1000);
    const weekSnap = findSnapshotBefore(rows, nowMs - 7 * 24 * 60 * 60 * 1000);
    const monthSnap = findSnapshotBefore(rows, nowMs - 30 * 24 * 60 * 60 * 1000);

    const totalValue = Number(summary.total_value ?? summary.total_krw);
    let dailyExtFlow = null;
    let weeklyExtFlow = null;
    let monthlyExtFlow = null;
    let cashflowMeta = null;
    if (exchange === "BINANCEFUT") {
      const candidates = [daySnap, weekSnap, monthSnap]
        .map((x) => Date.parse(String(x && x.created_at || "")))
        .filter((ms) => Number.isFinite(ms));
      if (candidates.length) {
        const fromMs = Math.max(0, Math.min(...candidates) - 60_000);
        try {
          const cashflow = await getBinanceWalletCashflow({ startMs: fromMs, endMs: nowMs });
          const entries = Array.isArray(cashflow && cashflow.entries) ? cashflow.entries : [];
          const dayFrom = Date.parse(String(daySnap && daySnap.created_at || ""));
          const weekFrom = Date.parse(String(weekSnap && weekSnap.created_at || ""));
          const monthFrom = Date.parse(String(monthSnap && monthSnap.created_at || ""));
          const dailyFlow = summarizeBinanceUsdtCashflow(entries, dayFrom, nowMs);
          const weeklyFlow = summarizeBinanceUsdtCashflow(entries, weekFrom, nowMs);
          const monthlyFlow = summarizeBinanceUsdtCashflow(entries, monthFrom, nowMs);
          dailyExtFlow = dailyFlow.net;
          weeklyExtFlow = weeklyFlow.net;
          monthlyExtFlow = monthlyFlow.net;
          cashflowMeta = {
            policy_version: cashflow && cashflow.policy_version ? cashflow.policy_version : null,
            entry_count: entries.length,
            daily: dailyFlow,
            weekly: weeklyFlow,
            monthly: monthlyFlow,
          };
        } catch (cfErr) {
          cashflowMeta = {
            error: cfErr && cfErr.message ? cfErr.message : String(cfErr),
          };
        }
      }
    }
    const payload = {
      ok: true,
      exchange,
      ...summary,
      growth: {
        daily: calcGrowth(totalValue, daySnap, { externalFlowValue: dailyExtFlow }),
        weekly: calcGrowth(totalValue, weekSnap, { externalFlowValue: weeklyExtFlow }),
        monthly: calcGrowth(totalValue, monthSnap, { externalFlowValue: monthlyExtFlow }),
      },
      growth_basis: exchange === "BINANCEFUT" ? "TRADING_PNL_EX_CASHFLOW" : "ACCOUNT_TOTAL_CHANGE",
      growth_cashflow: cashflowMeta,
      snapshot_count: rows.length,
    };
    cache[exchange] = { ts: now, data: payload };
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "ACCOUNT_SUMMARY_ERROR", message: String(e && e.message ? e.message : e) });
  }
});

module.exports = router;
