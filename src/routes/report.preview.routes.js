const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { getEffectiveExchangesSettings } = require("../utils/exchangeSettings");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { isLiveDocForExchange } = require("../utils/liveOnly");

function allowLocalNoOauth() {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProd) return false;
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const allowFlag = String(process.env.ALLOW_LOCAL_NO_OAUTH || "") === "1";
  return allowFlag || !hasGoogle;
}

function toMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}

// GET /api/report/preview?from=...&to=...&exchange=...
router.get("/api/report/preview", async (req, res) => {
  try {
    const allowLocal = allowLocalNoOauth();
    if (!allowLocal) {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.redirect("/login");
      }
    }

    const from = String(req.query.from || "");
    const to = String(req.query.to || "");

    const fromMs = toMs(from);
    const toMsVal = toMs(to);

    if (fromMs === null || toMsVal === null || toMsVal <= fromMs) {
      return res.status(400).json({
        ok: false,
        error: "BAD_RANGE",
        message: "from/to must be valid ISO and to > from",
      });
    }

    const db = getFirestore();
    const exCfg = await getEffectiveExchangesSettings(2000);
    const exchangeParam = String(req.query.exchange || "").trim().toUpperCase();
    const exchange = exchangeParam || String(exCfg.provider || "BINANCEFUT").toUpperCase();

    // v0: 신형 fills(exec_price_source 존재)만 집계 대상으로 본다.
    // created_at(ISO string) 기반으로 대충 필터링 (정확도는 pack 단계에서 강화)
    const snap = await db.collection("fills_paper")
      .orderBy("created_at", "desc")
      .limit(1000)
      .get();

    let fillsNew = 0;
    let sellsNew = 0;
    const markets = {};

    snap.forEach(d => {
      const x = d.data() || {};
      const ex = String(x.exchange || "").toUpperCase();
      const mk = x.symbol || x.symbol_or_pair_id || x.market || "";
      const exResolved = ex || inferExchangeFromMarket(mk);
      if (exchange && (!exResolved || exResolved !== exchange)) return;
      if (!isLiveDocForExchange(exchange, x)) return;
      const created = Date.parse(String(x.created_at || ""));
      if (!Number.isFinite(created)) return;
      if (created < fromMs || created >= toMsVal) return;

      if (!x.exec_price_source) return; // 신형만

      fillsNew += 1;

      const side = String(x.side || "").toUpperCase();
      if (side === "SELL") sellsNew += 1;

      const m = x.symbol || x.symbol_or_pair_id || x.market || "UNKNOWN";
      markets[m] = (markets[m] || 0) + 1;
    });

    // v0: trade 수는 "신형 SELL 수"로 근사(정확한 trade 집계는 Phase1)
    const tradesApprox = sellsNew;

    return res.json({
      ok: true,
      exchange,
      range: { from, to, from_ms: fromMs, to_ms: toMsVal },
      counts: {
        fills_new: fillsNew,
        sells_new: sellsNew,
        trades_approx: tradesApprox,
      },
      markets,
      note: "preview_v0: counts are approximate (new fills only)",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "PREVIEW_ERROR", message: e.message });
  }
});

module.exports = router;
