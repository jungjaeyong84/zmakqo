// Cleanup mismatched bars_snapshots where bar_close_time_utc_ms doesn't match bar_close_time_utc.
// Usage: APPLY=1 node scripts/cleanup-bars-snapshots.js

const { getFirestore } = require("../src/storage/firestore");

const APPLY = String(process.env.APPLY || "0") === "1";
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 500);
const MAX_DELETE = Number(process.env.MAX_DELETE || 100000);
const TOLERANCE_MS = Number(process.env.TOLERANCE_MS || 1000);

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function run() {
  const db = getFirestore();
  let totalScanned = 0;
  let totalMismatch = 0;
  let totalDeleted = 0;

  let last = null;

  while (true) {
    let q = db.collection("bars_snapshots").orderBy("__name__").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchDeletes = 0;

    snap.forEach((doc) => {
      totalScanned += 1;
      const d = doc.data() || {};
      const iso = String(d.bar_close_time_utc || "").trim();
      const ms = toNum(d.bar_close_time_utc_ms);
      if (!iso || ms === null) return;

      const parsed = Date.parse(iso);
      if (!Number.isFinite(parsed)) return;

      if (Math.abs(parsed - ms) > TOLERANCE_MS) {
        totalMismatch += 1;
        if (APPLY && totalDeleted < MAX_DELETE) {
          batch.delete(doc.ref);
          batchDeletes += 1;
          totalDeleted += 1;
        }
      }
    });

    if (APPLY && batchDeletes > 0) {
      await batch.commit();
    }

    last = snap.docs[snap.docs.length - 1];
    if (totalDeleted >= MAX_DELETE) break;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: APPLY,
        scanned: totalScanned,
        mismatched: totalMismatch,
        deleted: totalDeleted,
      },
      null,
      2
    )
  );
}

run().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
