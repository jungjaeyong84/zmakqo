const { getFirestore } = require("../src/storage/firestore");
const { normalizeMarketSymbolForProvider } = require("../src/utils/marketConfig");

function nowIso() {
  return new Date().toISOString();
}

function buildSignalId({ exchange, symbol, tf, barCloseMs, event }) {
  return `SIG__${exchange}__${symbol}__${tf}__${barCloseMs}__${event}`;
}

async function migrate() {
  const db = getFirestore();
  const col = db.collection("signals");
  let last = null;
  let scanned = 0;
  let converted = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let merged = 0;

  let batch = db.batch();
  let batchOps = 0;

  async function commitBatch() {
    if (batchOps === 0) return;
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  }

  while (true) {
    let q = col.orderBy("__name__").limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data() || {};
      const exRaw = String(data.exchange || "").toUpperCase();
      if (!exRaw.includes("BINANCE")) {
        continue;
      }

      const symRaw = String(data.symbol_or_pair_id || data.symbol || "").trim();
      const tf = String(data.tf || "").trim();
      const barMs = Number(data.bar_close_time_utc_ms);
      const ev = String(data.event || "").trim();

      const exTarget = "BINANCEFUT";
      const symTarget = normalizeMarketSymbolForProvider(symRaw, exTarget) || symRaw;

      if (!tf || !Number.isFinite(barMs) || !ev || !symTarget) {
        skipped += 1;
        continue;
      }

      const newId = buildSignalId({
        exchange: exTarget,
        symbol: symTarget,
        tf,
        barCloseMs: barMs,
        event: ev,
      });

      if (doc.id === newId) {
        // Only update fields if exchange/symbol are still legacy.
        if (exRaw !== exTarget || symRaw !== symTarget) {
          batch.update(doc.ref, {
            exchange: exTarget,
            symbol_or_pair_id: symTarget,
            symbol: symTarget,
            updated_at: nowIso(),
            migrated_from: data.migrated_from || null,
            migrated_at: data.migrated_at || null,
          });
          batchOps += 1;
          converted += 1;
          updated += 1;
        }
        continue;
      }

      // Create a normalized copy doc when needed.
      const newRef = col.doc(newId);
      const newSnap = await newRef.get();
      if (!newSnap.exists) {
        const payload = {
          ...data,
          signal_id: newId,
          exchange: exTarget,
          symbol_or_pair_id: symTarget,
          symbol: symTarget,
          migrated_from: doc.id,
          migrated_at: nowIso(),
          updated_at: nowIso(),
        };
        batch.set(newRef, payload, { merge: true });
        batchOps += 1;
        created += 1;
        converted += 1;
      } else {
        merged += 1;
      }

      batch.update(doc.ref, {
        migrated_to: newId,
        migrated_at: nowIso(),
        exchange_legacy: exRaw,
        symbol_legacy: symRaw || null,
        archived: true,
        updated_at: nowIso(),
      });
      batchOps += 1;

      if (batchOps >= 350) {
        await commitBatch();
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (batchOps >= 350) await commitBatch();
  }

  await commitBatch();

  console.log(JSON.stringify({
    ok: true,
    scanned,
    converted,
    created,
    updated,
    merged,
    skipped,
  }));
}

migrate().catch((e) => {
  console.error("MIGRATE_BINANCE_SIGNALS_ERROR", e && e.message ? e.message : e);
  process.exit(1);
});
