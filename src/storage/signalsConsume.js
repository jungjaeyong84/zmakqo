// src/storage/signalsConsume.js
const { getFirestore } = require("./firestoreCore");

async function markSignalConsumed({
  signalId,
  runId,
  consumedAtIso,
  execBarCloseMs,
  execBarCloseUtc,
  reason,
  meta,
} = {}) {
  const db = getFirestore();
  if (!signalId) return;
  const patch = {
    consumed_at: consumedAtIso,
    consumed_run_id: runId,
    consumed_exec_bar_close_time_utc_ms: Number(execBarCloseMs),
    consumed_exec_bar_close_time_utc: execBarCloseUtc || null,
    updated_at: new Date().toISOString(),
  };
  if (reason) patch.consumed_reason = String(reason);
  if (meta && typeof meta === "object") patch.consumed_meta = meta;

  await db.collection("signals").doc(signalId).set(patch, { merge: true });
}

module.exports = { markSignalConsumed };

async function tryLockSignal({ signalId, runId }) {
  const db = getFirestore();
  const ref = db.collection("signals").doc(signalId);

  // Firestore transaction: set locked_run_id only if not consumed/locked
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "NO_SIGNAL" };

    const d = snap.data() || {};
    if (d.consumed_run_id || d.consumed_at) return { ok: false, reason: "ALREADY_CONSUMED" };
    if (d.locked_run_id && d.locked_run_id !== runId) return { ok: false, reason: "LOCKED" };

    tx.set(ref, { locked_run_id: runId, locked_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { merge: true });
    return { ok: true };
  });
}

module.exports.tryLockSignal = tryLockSignal;
