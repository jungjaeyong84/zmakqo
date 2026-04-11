const express = require("express");
const router = express.Router();

const { fetchCandles, normalizeExchangeId } = require("../exchanges");
const { normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");

async function handleCandles(req, res, exchangeDefault = "BINANCEFUT") {
  try {
    const exchange = normalizeExchangeId(req.query.exchange || exchangeDefault);
    const tf = normalizeTf(req.query.tf || defaultExecTfFromEnv()) || "15m";
    const market = req.query.market || "BTCUSDT";
    const count = Number(req.query.count || 5);
    const bars = await fetchCandles(exchange, market, tf, count);
    res.json({ ok: true, exchange, market, tf, count, bars });
  } catch (e) {
    res.status(500).json({
      ok: false,
      reason: "candle_fetch_failed",
      error: String(e.message || e)
    });
  }
}

router.get("/candles", (req, res) => handleCandles(req, res, "BINANCEFUT"));

module.exports = router;
