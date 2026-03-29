const { getFirestore } = require("../src/storage/firestore");

const TARGET_EXCHANGE = "BINANCEFUT";
const PAGE_SIZE = 400;

async function deleteByField({ db, collection, field, value }) {
  let deleted = 0;
  while (true) {
    const snap = await db.collection(collection)
      .where(field, "==", value)
      .limit(PAGE_SIZE)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.docs.length;
  }
  return deleted;
}

async function deleteByIdPrefix({ db, collection, prefix }) {
  let deleted = 0;
  while (true) {
    const end = prefix + "\uf8ff";
    const snap = await db.collection(collection)
      .orderBy("__name__")
      .startAt(prefix)
      .endAt(end)
      .limit(PAGE_SIZE)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.docs.length;
  }
  return deleted;
}

async function main() {
  const db = getFirestore();

  const results = [];

  results.push({
    collection: "fills_paper",
    deleted: await deleteByField({ db, collection: "fills_paper", field: "exchange", value: TARGET_EXCHANGE }),
  });
  results.push({
    collection: "order_intents_paper",
    deleted: await deleteByField({ db, collection: "order_intents_paper", field: "exchange", value: TARGET_EXCHANGE }),
  });
  results.push({
    collection: "positions_paper",
    deleted: await deleteByField({ db, collection: "positions_paper", field: "exchange", value: TARGET_EXCHANGE }),
  });
  results.push({
    collection: "trades_paper",
    deleted: await deleteByField({ db, collection: "trades_paper", field: "exchange", value: TARGET_EXCHANGE }),
  });

  // Prefix cleanup for any legacy docs lacking exchange field.
  results.push({
    collection: "order_intents_paper",
    deleted: await deleteByIdPrefix({ db, collection: "order_intents_paper", prefix: "INTENT__BINANCEFUT__" }),
    note: "prefix",
  });
  results.push({
    collection: "positions_paper",
    deleted: await deleteByIdPrefix({ db, collection: "positions_paper", prefix: "POS__BINANCEFUT__" }),
    note: "prefix",
  });
  results.push({
    collection: "trades_paper",
    deleted: await deleteByIdPrefix({ db, collection: "trades_paper", prefix: "TRADE__BINANCEFUT__" }),
    note: "prefix",
  });

  const total = results.reduce((sum, r) => sum + (Number(r.deleted) || 0), 0);
  console.log(JSON.stringify({ ok: true, exchange: TARGET_EXCHANGE, total_deleted: total, results }, null, 2));
}

main().catch((err) => {
  console.error("PURGE_BINANCE_PAPER_FAILED", err && err.message ? err.message : err);
  process.exit(1);
});
