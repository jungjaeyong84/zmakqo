const express = require("express");
const router = express.Router();
const { resolveExchangeFromReq, resolveRuntimeMarketsForExchange } = require("../utils/resolveExchange");

router.get("/dashboard/settings", async (req, res) => {
  const tab = String(req.query.tab || "risk").toLowerCase();
  const { exchange } = await resolveExchangeFromReq(req, 2000);
  const markets_expected = await resolveRuntimeMarketsForExchange(exchange, 2000);
  return res.render(String(req.query.legacy || "").trim() === "1" ? "settings.legacy.ejs" : "settings", {
    tab,
    markets_expected,
    exchange,
  });
});

module.exports = router;
