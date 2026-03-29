// Cleanup test data created by verify-next-bar-exec.js
// Default is dry-run. Set APPLY=1 to delete.
require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");

const RUN_PREFIX = "RUN__VERIFY_NEXT_BAR__";
const EVENT_PREFIX = "ENTRY_CORE_LONG_AUTO_";
const SIGNAL_REASON = "VERIFY_NEXT_BAR";

const TARGETS = [
  { name: "signals", match: (d) => {
    const event = String(d.event || "");
    const reason = String(d.reason || "");
    const consumed = String(d.consumed_run_id || "");
    const locked = String(d.locked_run_id || "");
    return event.startsWith(EVENT_PREFIX) || reason === SIGNAL_REASON ||
      consumed.startsWith(RUN_PREFIX) || locked.startsWith(RUN_PREFIX);
  }},
  { name: "order_intents_paper", match: (d) => String(d.run_id || "").startsWith(RUN_PREFIX) || String(d.event || "").startsWith(EVENT_PREFIX) },
  { name: "fills_paper", match: (d) => String(d.run_id || "").startsWith(RUN_PREFIX) || String(d.event || "").startsWith(EVENT_PREFIX) },
  { name: "trades_paper", match: (d) => String(d.run_id || "").startsWith(RUN_PREFIX) || String(d.event || "").startsWith(EVENT_PREFIX) },
  { name: "bars_snapshots", match: (d) => String(d.run_id || "").startsWith(RUN_PREFIX) },
];

const PAGE_SIZE = 500;

async function scanAndMaybeDelete({ db, colName, match, apply }) {
  let lastId = null;
  let scanned = 0;
  let matched = 0;
  let deleted = 0;

  for (;;) {
    let q = db.collection(colName).orderBy("__name__").limit(PAGE_SIZE);
    if (lastId) q = q.startAfter(lastId);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data() || {};
      if (!match(data)) continue;
      matched += 1;

      if (apply) {
        await doc.ref.delete();
        deleted += 1;
      }
    }

    lastId = snap.docs[snap.docs.length - 1].id;
  }

  return { scanned, matched, deleted };
}

async function main() {
  const apply = String(process.env.APPLY || "0") === "1";
  const db = getFirestore();

  console.log("== CLEANUP VERIFY NEXT BAR ==");
  console.log(`APPLY=${apply ? "1" : "0 (dry-run)"}`);

  for (const t of TARGETS) {
    const res = await scanAndMaybeDelete({
      db,
      colName: t.name,
      match: t.match,
      apply,
    });
    console.log(`[${t.name}] scanned=${res.scanned} matched=${res.matched} deleted=${res.deleted}`);
  }
}

main()
  .then(() => {
    console.log("== DONE ==");
    process.exit(0);
  })
  .catch((err) => {
    console.error("CLEANUP_FAILED:", err && err.message ? err.message : String(err));
    process.exit(1);
  });
