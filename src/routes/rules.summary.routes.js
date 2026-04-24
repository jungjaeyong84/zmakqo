const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");

// GET /api/rules/summary
router.get("/api/rules/summary", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("rule_candidates")
      .limit(1000)
      .get();

    let watch = 0, cand = 0, active = 0, other = 0;
    snap.forEach(d => {
      const x = d.data() || {};
      const st = String(x.status || "").toUpperCase();
      if (st === "WATCHLIST") watch += 1;
      else if (st === "CANDIDATE") cand += 1;
      else if (st === "ACTIVE") active += 1;
      else other += 1;
    });

    return res.json({ ok:true, counts: { WATCHLIST: watch, CANDIDATE: cand, ACTIVE: active, OTHER: other }, total: snap.size });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"RULES_SUMMARY_ERROR", message: e.message });
  }
});

module.exports = router;
