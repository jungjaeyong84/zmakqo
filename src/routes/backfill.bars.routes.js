const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { fetchCandles, normalizeExchangeId } = require("../exchanges");
const { getMarketsExpected, getEffectiveExchangesSettings, getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { normalizeMarketSymbolForProvider, normalizeTf, tfToMs, defaultExecTfFromEnv } = require("../utils/marketConfig");

function requireSchedulerToken(req, res, next) {
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (!expected) return res.status(500).json({ ok:false, error:"SERVER_MISCONFIG", message:"SCHEDULER_TOKEN not set" });
  if (token !== expected) return res.status(401).json({ ok:false, error:"UNAUTHORIZED" });
  next();
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

router.post("/scheduler/backfill-bars", requireSchedulerToken, async (req, res) => {
  const start = Date.now();
  try {
    const db = getFirestore();
    const days = Math.max(1, Math.min(14, Number(req.body?.days || 7)));
    const exCfg = await getEffectiveExchangesSettings(2000);
    const exchange = normalizeExchangeId(req.body?.exchange || exCfg.provider || "BINANCEFUT");
    let marketsRaw = null;
    if (Array.isArray(req.body?.markets) && req.body.markets.length) {
      marketsRaw = req.body.markets.map(String);
    } else if (req.body?.exchange) {
      const perEx = await getExchangeSettingsForProvider(exchange, 2000);
      marketsRaw = (perEx && Array.isArray(perEx.markets)) ? perEx.markets : [];
    } else {
      marketsRaw = await getMarketsExpected(2000);
    }
    const markets = marketsRaw.map((m) => normalizeMarketSymbolForProvider(m, exchange)).filter(Boolean);

    const tf = normalizeTf(req.body?.tf || req.query?.tf || defaultExecTfFromEnv()) || "15m";
    const tfMs = tfToMs(tf) || (60 * 60 * 1000);
    const barsPerDay = Math.max(1, Math.ceil((24 * 60 * 60 * 1000) / tfMs));
    const needBars = days * barsPerDay;

    let written = 0;
    const perMarket = {};

    for (const m of markets) {
      const bars = await fetchCandles(exchange, m, tf, needBars);
      perMarket[m] = { fetched: bars.length, written: 0 };

      const batchSize = 400;
      let batch = db.batch();
      let inBatch = 0;

      for (const b of bars) {
        const barCloseMs = Number(b.closeTimeUtcMs) || Date.parse(String(b.closeTimeUtc || b.t || ""));
        if (!Number.isFinite(barCloseMs)) continue;

        const docId = `${exchange}__${m}__${tf}__${barCloseMs}`;
        const ref = db.collection("bars_snapshots").doc(docId);

        const payload = {
          run_id: "BACKFILL",
          exchange,
          symbol: m,
          tf,
          bar_close_time_utc: b.closeTimeUtc || b.t || null,
          bar_close_time_utc_ms: barCloseMs,
          created_at: new Date().toISOString(),
          ohlcv_json: {
            open: toNum(b.open),
            high: toNum(b.high),
            low: toNum(b.low),
            close: toNum(b.close),
            volume: toNum(b.volume),
          },
          note: `BACKFILL_${days}D_${tf}`,
        };

        batch.set(ref, payload, { merge: true });
        inBatch += 1;

        if (inBatch >= batchSize) {
          await batch.commit();
          written += inBatch;
          perMarket[m].written += inBatch;
          batch = db.batch();
          inBatch = 0;
        }
      }

      if (inBatch > 0) {
        await batch.commit();
        written += inBatch;
        perMarket[m].written += inBatch;
      }
    }

    return res.json({ ok: true, days, markets, tf, written, perMarket, runtime_ms: Date.now() - start });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"BACKFILL_BARS_ERROR", message:e.message, runtime_ms: Date.now() - start });
  }
});

module.exports = router;
