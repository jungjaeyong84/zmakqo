const { getFirestore } = require("../storage/firestore");
const { RETENTION_POLICY } = require("../config/retentionPolicy");

function toMsDays(days) {
  const n = Number(days);
  return Number.isFinite(n) ? n * 24 * 60 * 60 * 1000 : null;
}

function cutoffIso(days) {
  const ms = toMsDays(days);
  if (!Number.isFinite(ms)) return null;
  return new Date(Date.now() - ms).toISOString();
}

async function cleanupCollection({ db, collection, field, cutoff, limit = 500, dryRun = false }) {
  const col = db.collection(collection);
  const q = col.where(field, "<", cutoff).orderBy(field, "asc").limit(limit);
  const snap = await q.get();
  if (snap.empty) {
    return { collection, field, cutoff, scanned: 0, deleted: 0 };
  }

  const docs = snap.docs;
  if (dryRun) {
    const oldest = docs[0].data() || {};
    const newest = docs[docs.length - 1].data() || {};
    return {
      collection,
      field,
      cutoff,
      scanned: docs.length,
      deleted: 0,
      oldest_value: oldest[field] || null,
      newest_value: newest[field] || null,
      dry_run: true,
    };
  }

  const batch = db.batch();
  for (const doc of docs) batch.delete(doc.ref);
  await batch.commit();

  const oldest = docs[0].data() || {};
  const newest = docs[docs.length - 1].data() || {};
  return {
    collection,
    field,
    cutoff,
    scanned: docs.length,
    deleted: docs.length,
    oldest_value: oldest[field] || null,
    newest_value: newest[field] || null,
  };
}

async function cleanupRetention({ limitPerCollection = 500, dryRun = false, policy = RETENTION_POLICY } = {}) {
  const db = getFirestore();
  const results = [];

  for (const rule of policy || []) {
    const cutoff = cutoffIso(rule.days);
    if (!cutoff || !rule.collection || !rule.field) {
      results.push({
        collection: rule.collection || null,
        skipped: true,
        reason: "INVALID_RULE",
      });
      continue;
    }

    try {
      const r = await cleanupCollection({
        db,
        collection: rule.collection,
        field: rule.field,
        cutoff,
        limit: limitPerCollection,
        dryRun,
      });
      results.push({ ...r, ok: true });
    } catch (e) {
      results.push({
        collection: rule.collection,
        field: rule.field,
        cutoff,
        ok: false,
        error: e && e.message ? e.message : String(e),
      });
    }
  }

  const deleted = results.reduce((sum, r) => sum + Number(r.deleted || 0), 0);
  return { ok: true, dry_run: dryRun, limit: limitPerCollection, deleted, results };
}

module.exports = { cleanupRetention };

