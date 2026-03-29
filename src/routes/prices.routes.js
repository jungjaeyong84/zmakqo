const express = require("express");
const { normalizeExchangeId } = require("../exchanges");

function createPricesRoutes() {
  const router = express.Router();

  router.get("/api/prices", async (req, res) => {
    try {
      const q = String(req.query.markets || "").trim();
      if (!q) return res.status(400).json({ ok:false, message:"markets query required (e.g., BTCUSDT,ETHUSDT)" });
      const exchange = normalizeExchangeId(req.query.exchange || "BINANCEFUT");
      const markets = q.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (!markets.length) return res.status(400).json({ ok:false, message:"no markets parsed" });

      const symbols = JSON.stringify(markets);
      const url = "https://fapi.binance.com/fapi/v1/ticker/24hr?symbols=" + encodeURIComponent(symbols);
      const r = await fetch(url, { method: "GET" });
      const text = await r.text();
      if (!r.ok) {
        return res.status(502).json({ ok:false, message:"binance futures ticker failed", status:r.status, body:text.slice(0,500) });
      }
      const raw = JSON.parse(text);
      const rows = (raw || []).map((x) => ({
        symbol: x.symbol,
        market: x.symbol,
        trade_price: Number(x.lastPrice),
        signed_change_rate: Number(x.priceChangePercent) / 100,
        acc_trade_price_24h: Number(x.quoteVolume),
        raw: x,
      }));
      const by_market = {};
      for (const x of rows) {
        if (x && x.market) by_market[x.market] = x;
      }

      return res.json({ ok:true, ts: new Date().toISOString(), exchange, markets, rows, by_market });
    } catch (e) {
      return res.status(500).json({ ok:false, message: String(e && e.message ? e.message : e) });
    }
  });

  return router;
}

module.exports = createPricesRoutes;
