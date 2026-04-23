const express = require("express");
const { getMarketsExpected } = require("../utils/exchangeSettings");
const { defaultMarketsFromEnv } = require("../utils/marketConfig");

function createPipelineRoutes(stateMachine) {
  const router = express.Router();

  router.get("/pipeline/run", async (req, res) => {
    if (String(process.env.DONBEOLJA_V2_ENABLED || "0").trim() === "1") {
      return res.status(410).json({
        ok: false,
        reason: "V2_LEGACY_PIPELINE_RUN_DISABLED",
        replacement: "OPENCLAW_CRON_AND_V2_PRODUCTION_ENTRY_ROUTE",
      });
    }

    const enabled = String(process.env.ENABLE_PIPELINE_RUN || "0") === "1";
    if (!enabled) {
      return res.status(403).json({ ok: false, reason: "PIPELINE_RUN_DISABLED" });
    }

    const cur = stateMachine.getState();

    if (cur.state !== stateMachine.STATES.RUNNING) {
      return res.status(403).json({ ok: false, reason: "not_running", current: cur });
    }

    const expectedMarkets = await getMarketsExpected(2000);
    const fallback = defaultMarketsFromEnv();
    const market = req.query.market || expectedMarkets[0] || fallback[0] || "KRW-BTC";

    try {
      const { runOnce } = require("../pipeline/runner");
      const result = await runOnce(market);

      if (!result.ok && result.stage === "IDEMPOTENCY") {
        return res.status(409).json({ ok: false, reason: "duplicate_bar", idemKey: result.idemKey, market: result.market });
      }

      if (!result.ok && result.stage === "GATE") {
        return res.status(403).json({ ok: false, reason: "gate_failed", gate: result.gate, market: result.market });
      }

      return res.json({
        ok: true,
        message: "pipeline run executed",
        market: result.market,
        source: result.source,
        idemKey: result.idemKey,
        gate: result.gate,
        signal: result.signal,
        fill: result.fill
      });
    } catch (e) {
      return res.status(500).json({ ok: false, reason: "pipeline_internal_error", error: String(e.message || e), market });
    }
  });

  return router;
}

module.exports = createPipelineRoutes;
