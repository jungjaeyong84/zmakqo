// Verify "next bar execution" for UPBIT 60m paper trading.
// Flow: fetch latest bars -> store signals -> run tick -> insert synthetic next bars -> run tick -> verify fills.
require("dotenv").config();

const { fetchUpbitCandles } = require("../src/exchanges/upbit");
const { upsertBarSnapshot } = require("../src/storage/barsSnapshots");
const { upsertSignal } = require("../src/storage/signals");
const { getCursor, setCursor } = require("../src/storage/cursors");
const { getFirestore } = require("../src/storage/firestore");

const schedulerModule = require("../src/scheduler/scheduler");
const createScheduler =
  typeof schedulerModule === "function"
    ? schedulerModule
    : schedulerModule.createScheduler;

const EXCHANGE = "UPBIT";
const TF = "60m";
const MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP"];
const BAR_INTERVAL_MS = 60 * 60 * 1000;

function isoZ(ms) {
  return new Date(Number(ms)).toISOString().replace(".000Z", "Z");
}

function makeRunId(stage) {
  return `RUN__VERIFY_NEXT_BAR__${stage}__${Date.now()}`;
}

function makeSnapshotId({ exchange, symbol, tf, barCloseTimeUtcMs }) {
  return `${exchange}__${symbol}__${tf}__${barCloseTimeUtcMs}`;
}

function makeIntentId({ exchange, symbol, tf, signalBarCloseMs, event }) {
  return `INTENT__${exchange}__${symbol}__${tf}__${signalBarCloseMs}__${event}`;
}

async function main() {
  const db = getFirestore();
  const scheduler = createScheduler();

  process.env.UPBIT_MARKETS = MARKETS.join(",");
  process.env.PAPER_TRADING = "1";
  process.env.BARS_SNAPSHOT_REFRESH = "1";
  process.env.RUNTIME_MODE = process.env.RUNTIME_MODE || "local";
  process.env.MAX_LAG_MS = process.env.MAX_LAG_MS || String(2 * 60 * 60 * 1000);

  const ctx = {
    markets: {},
    syntheticSnapshotIds: [],
  };

  try {
    console.log("== VERIFY NEXT BAR EXECUTION ==");
    console.log(`Markets: ${MARKETS.join(", ")}`);

    // 1) Fetch latest bars and refresh snapshots
    for (const market of MARKETS) {
      const cursorBefore = await getCursor({ exchange: EXCHANGE, symbol: market, tf: TF });
      const bars = await fetchUpbitCandles(market, TF, 2);
      if (!Array.isArray(bars) || bars.length === 0) {
        throw new Error(`NO_UPBIT_BARS: ${market}`);
      }

      const latest = bars[bars.length - 1];
      const barCloseMs =
        Number(latest.closeTimeUtcMs) ||
        Number(latest.timestamp) ||
        Date.parse(latest.closeTimeUtc || "");
      const barCloseUtc = latest.closeTimeUtc || isoZ(barCloseMs);

      await upsertBarSnapshot({
        runId: makeRunId(`snapshot_${market}`),
        exchange: EXCHANGE,
        symbol: market,
        tf: TF,
        barCloseTimeUtc: barCloseUtc,
        barCloseTimeUtcMs: barCloseMs,
        bar: latest,
      });

      const event = `ENTRY_CORE_LONG_AUTO_${Date.now()}_${market.replace("-", "_")}`;

      ctx.markets[market] = {
        cursorBefore,
        latest,
        barCloseMs,
        barCloseUtc,
        nextBarMs: barCloseMs + BAR_INTERVAL_MS,
        nextBarUtc: isoZ(barCloseMs + BAR_INTERVAL_MS),
        event,
      };

      console.log(`[BAR] ${market} close=${barCloseUtc} (${barCloseMs})`);
    }

    // 2) Insert signals for current bar
    const signalEvents = [];
    for (const market of MARKETS) {
      const m = ctx.markets[market];
      await upsertSignal({
        exchange: EXCHANGE,
        symbol: market,
        tf: TF,
        barCloseTimeUtc: m.barCloseUtc,
        barCloseTimeUtcMs: m.barCloseMs,
        event: m.event,
        side: "BUY",
        qtyPct: 1,
        reason: "VERIFY_NEXT_BAR",
      });
      signalEvents.push(m.event);
      console.log(`[SIGNAL] ${market} event=${m.event}`);
    }

    // Allow these synthetic events to be picked up by the engine.
    process.env.SIGNALS_EVENTS = signalEvents.join(",");

    // 3) Tick #1: create intents for next bar (replay allowed)
    process.env.ALLOW_REPLAY_SAME_BAR = "1";
    const tick1 = await scheduler.tick({ runId: makeRunId("stage1") });
    console.log("[TICK1] ok=", tick1.ok, "errors=", tick1.errors ? tick1.errors.length : 0);

    // 4) Insert synthetic next bar snapshots
    for (const market of MARKETS) {
      const m = ctx.markets[market];
      const syntheticBar = {
        ...m.latest,
        closeTimeUtc: m.nextBarUtc,
        closeTimeUtcMs: m.nextBarMs,
        t: m.nextBarUtc,
        timestamp: m.nextBarMs,
        lastUpdatedMs: m.nextBarMs,
      };

      await upsertBarSnapshot({
        runId: makeRunId(`synthetic_${market}`),
        exchange: EXCHANGE,
        symbol: market,
        tf: TF,
        barCloseTimeUtc: m.nextBarUtc,
        barCloseTimeUtcMs: m.nextBarMs,
        bar: syntheticBar,
      });

      const id = makeSnapshotId({
        exchange: EXCHANGE,
        symbol: market,
        tf: TF,
        barCloseTimeUtcMs: m.nextBarMs,
      });
      ctx.syntheticSnapshotIds.push(id);

      console.log(`[SYNTHETIC] ${market} next_close=${m.nextBarUtc} (${m.nextBarMs})`);
    }

    // 5) Tick #2: execute intents on the next bar
    process.env.ALLOW_REPLAY_SAME_BAR = "0";
    const tick2 = await scheduler.tick({ runId: makeRunId("stage2") });
    console.log("[TICK2] ok=", tick2.ok, "errors=", tick2.errors ? tick2.errors.length : 0);

    // 6) Verify intents + fills
    const fillsSnap = await db.collection("fills_paper")
      .orderBy("created_at", "desc")
      .limit(100)
      .get();
    const fills = fillsSnap.docs.map((d) => d.data());

    for (const market of MARKETS) {
      const m = ctx.markets[market];
      const intentId = makeIntentId({
        exchange: EXCHANGE,
        symbol: market,
        tf: TF,
        signalBarCloseMs: m.barCloseMs,
        event: m.event,
      });

      const intentSnap = await db.collection("order_intents_paper").doc(intentId).get();
      const intent = intentSnap.exists ? intentSnap.data() : null;

      const fill = fills.find((f) => String(f.intent_id) === String(intentId)) || null;

      console.log(`[RESULT] ${market}`);
      console.log(`  intent_id=${intentId}`);
      console.log(`  intent_status=${intent ? intent.status : "MISSING"}`);
      console.log(`  scheduled_exec_ms=${intent ? intent.scheduled_exec_bar_close_time_utc_ms : "N/A"}`);
      console.log(`  fill_id=${fill ? fill.fill_id : "NONE"}`);
      console.log(`  fill_exec_ms=${fill ? fill.exec_bar_close_time_utc_ms : "N/A"}`);
    }
  } finally {
    // Cleanup: remove synthetic bars and restore cursors
    try {
      for (const id of ctx.syntheticSnapshotIds) {
        await db.collection("bars_snapshots").doc(id).delete();
      }
    } catch (e) {
      console.error("[CLEANUP] failed to delete synthetic snapshots:", e.message || e);
    }

    try {
      for (const market of MARKETS) {
        const m = ctx.markets[market];
        if (!m) continue;
        const cursorId = `${EXCHANGE}__${market}__${TF}`;
        if (m.cursorBefore) {
          await setCursor({
            exchange: EXCHANGE,
            symbol: market,
            tf: TF,
            barCloseTimeUtc: m.cursorBefore.last_processed_bar_close_time_utc || null,
            barCloseTimeUtcMs: m.cursorBefore.last_processed_bar_close_time_utc_ms || null,
            runId: "RESTORE_VERIFY_NEXT_BAR",
          });
        } else {
          await db.collection("processed_cursors").doc(cursorId).delete();
        }
      }
    } catch (e) {
      console.error("[CLEANUP] failed to restore cursors:", e.message || e);
    }
  }
}

main()
  .then(() => {
    console.log("== DONE ==");
    process.exit(0);
  })
  .catch((err) => {
    console.error("VERIFY_NEXT_BAR_FAILED:", err && err.message ? err.message : String(err));
    process.exit(1);
  });
