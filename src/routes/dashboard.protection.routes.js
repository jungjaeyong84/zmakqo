"use strict";

// /dashboard/protection — real-time protective-order audit.
//
// This route cross-references every ACTIVE Binance Futures position's
// native SL + TP state as recorded in Firestore against what Binance
// actually has open right now, and surfaces mismatches as colored
// issues. Operator can hit this any time to answer "are my positions
// actually protected?" without asking the AI.
//
// Results are cached for 20 seconds to avoid hammering the Binance API
// on every page reload. The operator can force a fresh fetch with
// ?fresh=1.

const express = require("express");
const router = express.Router();

const { auditActivePositions } = require("../services/protectionAudit");
const { resolveLiveFuturesConfig } = require("../engine/paperBinanceRunner");

const CACHE_TTL_MS = 20 * 1000;
let lastResult = null;
let lastResultAt = 0;

async function getSnapshot({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && lastResult && (now - lastResultAt) < CACHE_TTL_MS) {
    return { ...lastResult, cached: true, cache_age_ms: now - lastResultAt };
  }
  const liveCfg = await resolveLiveFuturesConfig().catch(() => null);
  const result = await auditActivePositions({ liveCfg });
  lastResult = result;
  lastResultAt = now;
  return { ...result, cached: false, cache_age_ms: 0 };
}

router.get("/dashboard/protection", async (req, res) => {
  try {
    const fresh = String(req.query.fresh || "").trim() === "1";
    const payload = await getSnapshot({ fresh });
    return res.json(payload);
  } catch (e) {
    console.error("[dashboard.protection] audit failed", e && e.stack ? e.stack : e);
    return res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

router.get("/dashboard/protection/view", async (req, res) => {
  try {
    const fresh = String(req.query.fresh || "").trim() === "1";
    const payload = await getSnapshot({ fresh });
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.render("protection-audit", { payload });
  } catch (e) {
    console.error("[dashboard.protection] view render failed", e && e.stack ? e.stack : e);
    return res.status(500).send(`<pre>Protection audit failed: ${String((e && e.message) || e)}</pre>`);
  }
});

module.exports = router;
