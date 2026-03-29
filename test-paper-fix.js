// Test script to verify paper trading fix
require("dotenv").config();
const { getFirestore } = require("./src/storage/firestore");

async function testPaperTradingFix() {
  console.log("=".repeat(60));
  console.log("Testing Paper Trading Fix");
  console.log("=".repeat(60));
  console.log();

  const db = getFirestore();

  try {
    // 1. Check recent signals (simple query to avoid index requirement)
    console.log("[1] Checking recent signals (all markets/TFs)");
    console.log("-".repeat(60));

    const signalsSnap = await db
      .collection("signals")
      .orderBy("created_at", "desc")
      .limit(20)
      .get();

    console.log(`Total recent signals found: ${signalsSnap.size}`);

    let unconsumedCount = 0;
    let btc60mCount = 0;

    signalsSnap.forEach(doc => {
      const data = doc.data();
      const consumed = data.consumed_at || data.consumed_run_id;
      const isBtc60m = data.symbol_or_pair_id === "KRW-BTC" && data.tf === "60m";

      if (isBtc60m) {
        btc60mCount++;
        if (!consumed) {
          unconsumedCount++;
          console.log(`  [${unconsumedCount}] ${data.event} ${data.side} @ ${data.bar_close_time_utc} (UNCONSUMED)`);
        }
      }
    });

    console.log(`KRW-BTC 60m signals: ${btc60mCount}`);
    console.log(`Unconsumed KRW-BTC 60m signals: ${unconsumedCount}`);
    console.log();

    // 2. Check recent order intents
    console.log("[2] Checking recent order intents");
    console.log("-".repeat(60));

    const intentsSnap = await db
      .collection("order_intents_paper")
      .orderBy("created_at", "desc")
      .limit(5)
      .get();

    console.log(`Total intents found: ${intentsSnap.size}`);

    if (intentsSnap.size > 0) {
      intentsSnap.forEach((doc, idx) => {
        const data = doc.data();
        console.log(`  [${idx + 1}] ${data.event} ${data.side} ${data.qty_pct}% @ ${data.created_at}`);
        console.log(`      Status: ${data.status || 'PENDING'}`);
        console.log(`      Exec Bar: ${data.scheduled_exec_bar_close_utc || 'N/A'}`);
      });
    } else {
      console.log("  ⚠️  No order intents found - paper trading may not have executed yet");
    }
    console.log();

    // 3. Check recent fills
    console.log("[3] Checking recent fills");
    console.log("-".repeat(60));

    const fillsSnap = await db
      .collection("fills_paper")
      .orderBy("created_at", "desc")
      .limit(5)
      .get();

    console.log(`Total fills found: ${fillsSnap.size}`);

    if (fillsSnap.size > 0) {
      fillsSnap.forEach((doc, idx) => {
        const data = doc.data();
        console.log(`  [${idx + 1}] ${data.event} ${data.side} ${data.qty_pct}% @ ${data.exec_price || 'N/A'}`);
        console.log(`      Exec Time: ${data.exec_bar_close_time_utc || data.created_at}`);
      });
    } else {
      console.log("  ⚠️  No fills found - intents may not have been executed yet");
    }
    console.log();

    // 4. Check positions
    console.log("[4] Checking current positions");
    console.log("-".repeat(60));

    const positionsSnap = await db
      .collection("positions_paper")
      .where("exchange", "==", "UPBIT")
      .where("symbol_or_pair_id", "==", "KRW-BTC")
      .limit(5)
      .get();

    console.log(`Total positions found: ${positionsSnap.size}`);

    if (positionsSnap.size > 0) {
      positionsSnap.forEach((doc, idx) => {
        const data = doc.data();
        console.log(`  [${idx + 1}] ${data.symbol_or_pair_id}: ${data.state || 'UNKNOWN'}`);
        console.log(`      Size: ${data.size_pct || 0}%`);
        console.log(`      Avg Price: ${data.avg_price || 'N/A'}`);
        console.log(`      Updated: ${data.updated_at || data.created_at}`);
      });
    } else {
      console.log("  ⚠️  No positions found");
    }
    console.log();

    // Summary
    console.log("=".repeat(60));
    console.log("Test Summary");
    console.log("=".repeat(60));

    if (unconsumedCount > 0 && intentsSnap.size === 0) {
      console.log("⚠️  Status: SIGNALS PRESENT BUT NO INTENTS");
      console.log("   This may be normal if scheduler hasn't run yet.");
      console.log("   Wait 5 minutes for next scheduler cycle.");
    } else if (intentsSnap.size > 0 && fillsSnap.size === 0) {
      console.log("⏳  Status: INTENTS CREATED, AWAITING EXECUTION");
      console.log("   Intents will execute on next bar (60 minutes).");
    } else if (fillsSnap.size > 0) {
      console.log("✅ Status: PAPER TRADING SYSTEM OPERATIONAL");
      console.log("   Signals → Intents → Fills working correctly.");
    } else {
      console.log("ℹ️  Status: NO ACTIVITY YET");
      console.log("   Send a test webhook or wait for TradingView signals.");
    }

    console.log();

  } catch (error) {
    console.error("❌ Test failed:");
    console.error(error);
    process.exit(1);
  }
}

testPaperTradingFix()
  .then(() => {
    console.log("Test complete");
    process.exit(0);
  })
  .catch(err => {
    console.error("Test error:", err);
    process.exit(1);
  });
