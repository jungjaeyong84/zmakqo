const express = require("express");
const router = express.Router();

const { getFirestore } = require("../storage/firestore");
const { getEffectiveExchangesSettings } = require("../utils/exchangeSettings");
const { resolveExecTfForExchange } = require("../utils/resolveExchange");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");
const { normalizeEvalExchange, evalDocId, evalLatestId, matchesEvalTf } = require("../utils/evalDoc");

function requireSchedulerToken(req, res, next) {
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (!expected) return res.status(500).json({ ok: false, error: "SCHEDULER_TOKEN_NOT_SET" });
  if (token !== expected) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  next();
}

function normUpper(x, fallback = "") {
  const s = String(x || "").trim();
  return s ? s.toUpperCase() : fallback;
}

function normStr(x, fallback = "") {
  const s = String(x || "").trim();
  return s ? s : fallback;
}
// NOTE
// - eval_latest(decisions[]) 과 eval_weekly(decisions[]) 둘 다 지원.
// - 과거 포맷: decision.type, n, eval_n
// - 현재 포맷: decision.decision, n_total, n_eval
router.post(["/rules/promote", "/scheduler/rules/promote"], requireSchedulerToken, async (req, res) => {
  const db = getFirestore();

  const week = normStr(req?.body?.week);
  const promoteDecision = normUpper(req?.body?.decision, "KEEP");
  const exCfg = await getEffectiveExchangesSettings(2000);
  const exchange = normalizeEvalExchange(req?.body?.exchange || exCfg.provider || "BINANCEFUT");
  const execTf = await resolveExecTfForExchange(exchange, "15m", 2000);

  let source = "eval_latest";
  let eval_id = "latest";
  let decisions = [];

  if (week) {
    const snap = await db.collection("eval_weekly").doc(evalDocId(exchange, week)).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "NO_EVAL_WEEKLY", week, exchange });
    const data = snap.data() || {};
    if (!matchesEvalTf(data, execTf)) {
      return res.status(404).json({ ok: false, error: "NO_EVAL_WEEKLY_FOR_TF", week, exchange, exec_tf: execTf });
    }
    source = "eval_weekly";
    eval_id = normStr(data.eval_id, week);
    decisions = Array.isArray(data.decisions) ? data.decisions : (Array.isArray(data.decision_rows) ? data.decision_rows : []);
  } else {
    const snap = await db.collection("eval_latest").doc(evalLatestId(exchange)).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "NO_EVAL_LATEST", exchange });
    const data = snap.data() || {};
    if (!matchesEvalTf(data, execTf)) {
      return res.status(404).json({ ok: false, error: "NO_EVAL_LATEST_FOR_TF", exchange, exec_tf: execTf });
    }
    source = "eval_latest";
    eval_id = normStr(data.eval_id, "latest");
    decisions = Array.isArray(data.decisions) ? data.decisions : (Array.isArray(data.decision_rows) ? data.decision_rows : []);
  }

  const keep = decisions.filter((d) => {
    const v = normUpper(d?.decision || d?.type);
    return v === promoteDecision;
  });

  const nowIso = new Date().toISOString();
  const out = [];

  for (const x of keep) {
    const exchange = normUpper(x.exchange, "BINANCEFUT");
    const symbol = normStr(x.symbol_or_pair_id || x.symbol || x.market, "UNKNOWN");
    const tf = normStr(x.tf, defaultExecTfFromEnv() || "15m");
    const side = normUpper(x.side, "HOLD");
    const group = normUpper(x.group, "UNKNOWN");
    const subtype = normUpper(x.subtype, "NA");

    const rule_id = `RULE_CAND__${exchange}__${symbol}__${tf}__${side}__${group}__${subtype}`;

    const n_total = x.n_total ?? x.n;
    const n_eval = x.n_eval ?? x.eval_n;

    const doc = {
      rule_id,
      created_at: nowIso,
      source,
      eval_id,
      decision: promoteDecision,
      decision_reason: x.decision_reason || x.reason || "",
      basis: {
        win_rate: x.win_rate,
        ev_dir_ret_pct: x.ev_dir_ret_pct,
        n_total,
        n_eval,
      },
      exchange,
      symbol_or_pair_id: symbol,
      tf,
      side,
      group,
      subtype,
      status: "CANDIDATE",
    };

    await db.collection("rules_candidate").doc(rule_id).set(doc, { merge: true });
    out.push(doc);
  }

  res.json({ ok: true, source, eval_id, decision: promoteDecision, promoted: out.length, rules: out.slice(0, 200) });
});

module.exports = router;
