const { getFirestore } = require("../src/storage/firestore");

async function deleteBatch(db, refs) {
  if (!refs.length) return 0;
  const batch = db.batch();
  for (const ref of refs) batch.delete(ref);
  await batch.commit();
  return refs.length;
}

async function main() {
  const db = getFirestore();
  let scanned = 0;
  let deleted = 0;

  // 1) Delete legacy BINANCE exchange signals (most reliable filter)
  const legacySnap = await db.collection("signals").where("exchange", "==", "BINANCE").get();
  scanned += legacySnap.size;
  if (!legacySnap.empty) {
    const refs = legacySnap.docs.map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      deleted += await deleteBatch(db, refs.slice(i, i + 400));
    }
  }

  // 2) Extra safety: delete recent *.P symbols even if exchange missing
  const recentSnap = await db.collection("signals")
    .orderBy("bar_close_time_utc_ms", "desc")
    .limit(5000)
    .get();

  const refsP = [];
  recentSnap.forEach((d) => {
    const x = d.data() || {};
    const sym = String(x.symbol_or_pair_id || x.symbol || "");
    if (sym.endsWith(".P")) refsP.push(d.ref);
  });
  scanned += recentSnap.size;
  for (let i = 0; i < refsP.length; i += 400) {
    deleted += await deleteBatch(db, refsP.slice(i, i + 400));
  }

  console.log(JSON.stringify({ ok: true, scanned, deleted }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
