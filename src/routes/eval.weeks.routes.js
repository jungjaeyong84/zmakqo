const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { getEffectiveExchangesSettings } = require("../utils/exchangeSettings");
const { resolveExecTfForExchange } = require("../utils/resolveExchange");
const { normalizeEvalExchange, evalDocId, matchesEvalTf } = require("../utils/evalDoc");

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

router.get("/api/eval/weeks", async (req, res) => {
  try {
    const n = Math.max(1, Math.min(52, Number(req.query.n || 12)));
    const db = getFirestore();
    let exchange = String(req.query.exchange || "").trim();
    if (!exchange) {
      const exCfg = await getEffectiveExchangesSettings(2000);
      exchange = (exCfg && exCfg.provider) ? String(exCfg.provider) : "BINANCEFUT";
    }
    exchange = normalizeEvalExchange(exchange);
    const execTf = await resolveExecTfForExchange(exchange, "15m", 2000);

    const now = new Date();
    const weeks = [];
    for (let i = n - 1; i >= 0; i--) {
      weeks.push(isoWeek(addWeeksUtc(now, -i)));
    }

    const snaps = await Promise.all(weeks.map((w) => db.collection("eval_weekly").doc(evalDocId(exchange, w)).get()));
    const out = weeks.map((w, idx) => {
      const snap = snaps[idx];
      const data = snap.exists ? (snap.data() || {}) : null;
      return {
        week: w,
        exists: !!(snap.exists && matchesEvalTf(data, execTf)),
      };
    });

    return res.json({ ok: true, n, exchange, exec_tf: execTf, weeks: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "EVAL_WEEKS_ERROR", message: e.message });
  }
});

module.exports = router;
