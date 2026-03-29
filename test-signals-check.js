// Test script to check if signals are persisting to Firestore
const { getFirestore } = require("./src/storage/firestore");

async function checkSignals() {
  console.log("=" .repeat(60));
  console.log("Checking Firestore signals collection");
  console.log("=".repeat(60));
  console.log();

  try {
    const db = getFirestore();

    // Query all signals
    const snapshot = await db.collection("signals").get();

    console.log(`Total signals in database: ${snapshot.size}`);
    console.log();

    if (!snapshot.empty) {
      console.log("Signals found:");
      console.log("-".repeat(60));

      snapshot.forEach((doc, idx) => {
        const data = doc.data();
        console.log(`[${idx + 1}] ID: ${doc.id}`);
        console.log(`    Exchange: ${data.exchange}`);
        console.log(`    Symbol: ${data.symbol_or_pair_id}`);
        console.log(`    TF: ${data.tf}`);
        console.log(`    Event: ${data.event}`);
        console.log(`    Side: ${data.side}`);
        console.log(`    Bar Close: ${data.bar_close_time_utc}`);
        console.log(`    Created: ${data.created_at}`);
        console.log(`    Consumed: ${data.consumed_at || "NO"}`);
        console.log();
      });
    } else {
      console.log("⚠️  No signals found in database");
      console.log();
      console.log("Possible causes:");
      console.log("  1. Firestore write permissions issue");
      console.log("  2. Transaction failing silently");
      console.log("  3. Collection name mismatch");
      console.log("  4. Firestore not initialized properly");
    }

  } catch (error) {
    console.error("❌ Error checking signals:");
    console.error(error);
    process.exit(1);
  }
}

checkSignals()
  .then(() => {
    console.log("Signal check complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Signal check failed:", err);
    process.exit(1);
  });
