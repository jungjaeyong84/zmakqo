const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { getEffectiveExchangesSettings } = require("../utils/exchangeSettings");
const { resolveExecTfForExchange } = require("../utils/resolveExchange");
const { normalizeEvalExchange, evalDocId, evalLatestId, matchesEvalTf } = require("../utils/evalDoc");

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

function evalTfMatchesDoc(doc, expectedTf) {
  return !!(doc && matchesEvalTf(doc, expectedTf));
}

// GET /api/eval/latest
// 1) eval_latest/latest for current exec_tf
// 2) current week doc for current exec_tf
// 3) fallback: newest eval_weekly for current exec_tf
router.get("/api/eval/latest", async (req, res) => {
  try {
    const db = getFirestore();
    const week = isoWeek(new Date());
    let exchange = String(req.query.exchange || "").trim();
    if (!exchange) {
      const exCfg = await getEffectiveExchangesSettings(2000);
      exchange = (exCfg && exCfg.provider) ? String(exCfg.provider) : "BINANCEFUT";
    }
    exchange = normalizeEvalExchange(exchange);
    const execTf = await resolveExecTfForExchange(exchange, "15m", 2000);

    const latest = await db.collection("eval_latest").doc(evalLatestId(exchange)).get();
    if (latest.exists) {
      const data = latest.data() || {};
      if (evalTfMatchesDoc(data, execTf)) {
        return res.json({ ok: true, id: data.week || latest.id, exchange, exec_tf: execTf, data });
      }
    }

    const doc = await db.collection("eval_weekly").doc(evalDocId(exchange, week)).get();
    if (doc.exists) {
      const data = doc.data() || {};
      if (evalTfMatchesDoc(data, execTf)) {
        return res.json({ ok: true, id: week, exchange, exec_tf: execTf, data });
      }
    }

    const snap = await db.collection("eval_weekly").orderBy("created_at", "desc").limit(50).get();
    if (snap.empty) return res.status(404).json({ ok: false, error: "NO_EVAL_WEEKLY", exchange, exec_tf: execTf });

    let picked = null;
    for (const d of snap.docs) {
      const data = d.data() || {};
      const ex = normalizeEvalExchange(data.exchange || (data.universe && data.universe.exchange) || "");
      if (ex !== exchange) continue;
      if (!evalTfMatchesDoc(data, execTf)) continue;
      picked = { id: d.id, data };
      break;
    }
    if (!picked) {
      return res.status(404).json({ ok: false, error: "NO_EVAL_FOR_TF", exchange, exec_tf: execTf });
    }
    return res.json({ ok: true, id: picked.id, exchange, exec_tf: execTf, data: picked.data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "EVAL_LATEST_ERROR", message: e.message });
  }
});

// GET /api/eval/history?n=4
// returns last N eval_weekly docs for the current exec_tf, newest first
router.get("/api/eval/history", async (req, res) => {
  try {
    const db = getFirestore();
    const n = Math.max(1, Math.min(26, Number(req.query.n || 4)));
    const week = isoWeek(new Date());
    let exchange = String(req.query.exchange || "").trim();
    if (!exchange) {
      const exCfg = await getEffectiveExchangesSettings(2000);
      exchange = (exCfg && exCfg.provider) ? String(exCfg.provider) : "BINANCEFUT";
    }
    exchange = normalizeEvalExchange(exchange);
    const execTf = await resolveExecTfForExchange(exchange, "15m", 2000);

    const weeks = [];
    for (let i = 0; i < n; i++) weeks.push(isoWeek(addWeeksUtc(new Date(), -i)));

    const snaps = await Promise.all(weeks.map((w) => db.collection("eval_weekly").doc(evalDocId(exchange, w)).get()));
    const rows = [];
    for (let i = 0; i < weeks.length; i++) {
      const d = snaps[i];
      if (!d.exists) continue;
      const data = d.data() || {};
      if (!evalTfMatchesDoc(data, execTf)) continue;
      rows.push({ id: weeks[i], data });
    }

    return res.json({ ok: true, n, week_latest: week, exchange, exec_tf: execTf, docs: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "EVAL_HISTORY_ERROR", message: e.message });
  }
});

module.exports = router;
