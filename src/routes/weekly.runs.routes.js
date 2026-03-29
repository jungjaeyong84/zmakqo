const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}W${String(weekNo).padStart(2, "0")}`;
}

function addWeeksUtc(d, deltaWeeks) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + deltaWeeks * 7);
  return x;
}

// GET /api/weekly/runs?n=12
router.get("/api/weekly/runs", async (req, res) => {
  try {
    const n = Math.max(1, Math.min(52, Number(req.query.n || 12)));
    const db = getFirestore();

    const now = new Date();
    const weeks = [];
    for (let i = n - 1; i >= 0; i--) weeks.push(isoWeek(addWeeksUtc(now, -i)));

    const snaps = await Promise.all(weeks.map(w => db.collection("weekly_runs").doc(w).get()));
    const out = weeks.map((w, idx) => {
      const doc = snaps[idx];
      if (!doc.exists) return { week: w, exists:false };
      const x = doc.data() || {};
      return {
        week: w,
        exists: true,
        ok: !!x.ok,
        runtime_ms: x.runtime_ms ?? null,
        created_at: x.created_at ?? null,
        keep: x.eval_weekly?.keep ?? null,
        need_data: x.eval_weekly?.need_data ?? null,
        promoted_watchlist: x.promote_need_data?.promoted ?? null,
        promoted_candidate: x.promote_keep?.promoted ?? null,
      };
    });

    return res.json({ ok:true, n, runs: out });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"WEEKLY_RUNS_ERROR", message:e.message });
  }
});

module.exports = router;
