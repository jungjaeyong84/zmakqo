const express = require("express");
const { getFirestore } = require("../storage/firestore");

// GET /api/risk
// -> { ok:true, source, fee_bps, slippage_bps, notional_base }
function createRiskRoutes() {
  const router = express.Router();

  router.get("/api/risk", async (req, res) => {
    try {
      const db = getFirestore();
      const candidates = [
        ["settings", "risk"],
        ["settings", "runtime"],
        ["config", "risk"],
        ["config", "runtime"],
      ];

      for (const [col, doc] of candidates) {
        try {
          const snap = await db.collection(col).doc(doc).get();
          if (!snap.exists) continue;
          const x = snap.data() || {};
          const fee_bps = Number(x.fee_bps ?? x.feeBps ?? x.fee ?? 0) || 0;
          const slippage_bps = Number(x.slippage_bps ?? x.slippageBps ?? x.slippage ?? 0) || 0;
          const notional_base = Number(x.notional_base ?? x.notionalBase ?? x.paper_notional_base ?? 1) || 1;

          return res.json({
            ok: true,
            source: `${col}/${doc}`,
            fee_bps,
            slippage_bps,
            notional_base,
          });
        } catch (_) {}
      }

      return res.json({
        ok: true,
        source: "DEFAULT(0)",
        fee_bps: 0,
        slippage_bps: 0,
        notional_base: 1,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, message: String(e && e.message ? e.message : e) });
    }
  });

  return router;
}

module.exports = createRiskRoutes;
