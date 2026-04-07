const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { resolveExchangeFromReq, resolveRuntimeTfContext } = require("../utils/resolveExchange");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { toKstString } = require("../utils/timeKst");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");

router.get("/dashboard/journal", async (req, res) => {
  try {
    const db = getFirestore();
    const { exchange, exCfg } = await resolveExchangeFromReq(req, 2000);
    const { execTf } = await resolveRuntimeTfContext(req, exchange, {
      fallback: (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m",
      ttlMs: 2000,
    });

    let trades = [];
    let lastCreatedAt = null;

    try {
      const snap = await db
        .collection("fills_paper")
        .orderBy("created_at", "desc")
        .limit(200)
        .get();

      snap.forEach((d) => {
        const x = d.data() || {};
        const ex = String(x.exchange || "").toUpperCase();
        if (ex !== String(exchange).toUpperCase()) return;
        if (!isLiveDocForExchange(exchange, x)) return;
        if (String(x.tf || "") !== String(execTf || "")) return;
        const createdAt = x.exec_bar_close_time_utc || x.created_at || null;
        trades.push({
          id: d.id,
          created_at: createdAt,
          created_kst: toKstString(createdAt) || null,
          exchange: x.exchange || null,
          symbol_or_pair_id: x.symbol_or_pair_id || x.symbol || x.market || null,
          tf: x.tf || null,
          event: x.event || null,
          side: x.side || null,
          exec_price: (x.exec_price != null) ? Number(x.exec_price) : null,
          qty_pct: (x.qty_pct != null) ? Number(x.qty_pct) : null,
          exec_qty_base: (x.exec_qty_base != null) ? Number(x.exec_qty_base) : null,
          fee_value: (x.fee_value != null) ? Number(x.fee_value) : null,
          pnl: (x.external_realized_pnl != null)
            ? Number(x.external_realized_pnl)
            : (x.realized_pnl != null ? Number(x.realized_pnl) : (x.pnl != null ? Number(x.pnl) : null)),
          note: x.note || x.exec_price_source || x.execution_mode || null,
        });
      });

      lastCreatedAt = trades.length ? (trades[0].created_at || null) : null;
    } catch (e) {
      // If collection doesn't exist yet, keep empty view (Phase 0 early days).
      trades = [];
      lastCreatedAt = null;
    }

    return res.render("journal", {
      trades,
      exchange,
      exec_tf: execTf,
      meta: {
        n: trades.length,
        last_created_at: lastCreatedAt,
        last_created_kst: toKstString(lastCreatedAt),
      },
    });
  } catch (e) {
    try {
      return res.status(200).render("journal", {
        trades: [],
        exchange: req.query.exchange || '',
        exec_tf: null,
        meta: { n: 0, last_created_at: null, last_created_kst: null },
        _error: { code: "JOURNAL_ROUTE_ERROR", message: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      });
    } catch (renderErr) {
      return res.status(500).send("RENDER_FALLBACK_ERROR: " + (renderErr.message || String(renderErr)));
    }
  }
});

module.exports = router;
