const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { getEffectiveExchangesSettings } = require("../utils/exchangeSettings");
const { resolveExecTfForExchange } = require("../utils/resolveExchange");
const { normalizeEvalExchange, evalDocId, matchesEvalTf } = require("../utils/evalDoc");

function allowLocalBypass() {
  return String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
}

function requireSchedulerToken(req, res, next) {
  if (allowLocalBypass()) return next();

  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(
    req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || ""
  );
  if (!expected) return res.status(500).json({ ok: false, error: "SCHEDULER_TOKEN_NOT_SET" });
  if (!token || token !== expected) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  return next();
}

function parseWeek(week) {
  const m = /^([0-9]{4})W([0-9]{2})$/.exec(String(week || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const w = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(w)) return null;
  if (w < 1 || w > 53) return null;
  return { y, w };
}

function isoWeekIdUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year, week };
}

function isoWeekStartUTC(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // 1..7 (Mon..Sun)
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));

  const start = new Date(mondayWeek1);
  start.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return start;
}
function isNextWeek(prevWeek, curWeek) {
  const a = parseWeek(prevWeek);
  const b = parseWeek(curWeek);
  if (!a || !b) return false;

  const aStart = isoWeekStartUTC(a.y, a.w);
  const nextStart = new Date(aStart);
  nextStart.setUTCDate(aStart.getUTCDate() + 7);

  const next = isoWeekIdUTC(nextStart);
  return next.year === b.y && next.week === b.w;
}

router.post("/scheduler/filters/drop-sync", requireSchedulerToken, async (req, res) => {
  try {
    const week = String(req.body?.week || "").trim();
    if (!week) return res.status(400).json({ ok: false, error: "MISSING_WEEK" });

    const db = getFirestore();
    let exchange = String(req.body?.exchange || "").trim();
    if (!exchange) {
      const exCfg = await getEffectiveExchangesSettings(2000);
      exchange = (exCfg && exCfg.provider) ? String(exCfg.provider) : "BINANCEFUT";
    }
    exchange = normalizeEvalExchange(exchange);
    const execTf = await resolveExecTfForExchange(exchange, "15m", 2000);

    const snap = await db.collection("eval_weekly").doc(evalDocId(exchange, week)).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: "WEEK_NOT_FOUND" });

    const x = snap.data() || {};
    if (!matchesEvalTf(x, execTf)) {
      return res.status(404).json({ ok: false, error: "WEEK_NOT_FOUND_FOR_TF", week, exchange, exec_tf: execTf });
    }
    const decisionRows = Array.isArray(x.decision_rows) ? x.decision_rows : [];
    const legacyDecisions = Array.isArray(x.decisions) ? x.decisions : [];
    let drops = [];
    if (decisionRows.length) {
      drops = decisionRows.filter((d) => String(d?.decision || d?.type || "").toUpperCase() === "DROP");
    } else if (legacyDecisions.length) {
      drops = legacyDecisions.filter((d) => String(d?.type || d?.decision || "").toUpperCase() === "DROP");
    } else if (Array.isArray(x.decisions?.drop)) {
      drops = x.decisions.drop;
    }

    if (!drops.length) {
      return res.json({ ok: true, week, exchange, written: 0, skipped: 0, rows: [], note: "NO_DROP_DECISIONS" });
    }

    let written = 0;
    let skipped = 0;
    const errors = [];
    const rows = [];

    for (const r of drops) {
      const exchange = String(r.exchange || "").toUpperCase();
      const symbolOrPair = String(r.symbol_or_pair_id || r.symbol || "");
      const tf = String(r.tf || "");
      const side = String(r.side || "").toUpperCase();
      const group = String(r.group || "");
      const subtype = String(r.subtype || "NA");

      if (!exchange || !symbolOrPair || !tf || !side || !group) {
        skipped += 1;
        errors.push({
          error: "INVALID_DROP_DECISION",
          decision: r,
        });
        continue;
      }

      const id = `DROP__${exchange}__${symbolOrPair}__${tf}__${side}__${group}__${subtype}`;
      const ref = db.collection("filters_drop").doc(id);

      let streak = 1;
      try {
        const prevSnap = await ref.get();
        if (prevSnap.exists) {
          const prev = prevSnap.data() || {};
          if (prev.week && isNextWeek(prev.week, week)) {
            streak = Math.min(9, Number(prev.streak || 1) + 1);
          } else {
            streak = 1;
          }
        }
      } catch {
        streak = 1;
      }

      const mode = streak >= 2 ? "HARD" : "SOFT";

      const payload = {
        id,
        week,
        eval_id: `${exchange}__${week}`,
        exchange,
        tf,
        side,
        group,
        subtype,
        symbol_or_pair_id: symbolOrPair,
        symbol: symbolOrPair,

        n_signals: r.n_signals ?? null,
        n_eval: r.n_eval ?? null,
        win_rate: r.win_rate ?? null,
        ev_dir_ret_pct: r.ev_dir_ret_pct ?? null,
        horizon_bars: x.horizon_bars ?? r.horizon_bars ?? null,

        streak,
        mode,
        updated_at: new Date().toISOString(),
      };

      // Back-compat fields (legacy consumers)
      payload.n = payload.n_signals;
      payload.eval_n = payload.n_eval;
      payload.ev = payload.ev_dir_ret_pct;

      await ref.set(payload, { merge: true });
      written += 1;

      rows.push({
        id,
        week,
        exchange,
        symbol_or_pair_id: symbolOrPair,
        tf,
        side,
        group,
        subtype,
        streak,
        mode,
      });
    }

    return res.json({ ok: true, week, exchange, written, skipped, rows, errors });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "DROP_SYNC_FAILED", detail: String(e?.message || e) });
  }
});

module.exports = router;
