// src/services/intents.cleanup.js
// - Firestore composite index 없이 동작하도록 "created_at desc N개"를 가져와 로컬 필터
// - scheduled_exec_ms가 이미 지난 PENDING intent를 자동 CANCELED 처리

const { getFirestore } = require("../storage/firestore");

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.lookbackLimit] - recent docs to scan (avoid index)
 * @param {number} [opts.staleAfterMs] - scheduled_exec_ms 가 now - staleAfterMs 보다 과거면 stale
 * @param {boolean} [opts.dryRun] - true면 업데이트 안함
 */
async function cleanupStalePendingIntents(opts = {}) {
  const db = getFirestore();
  const lookbackLimit = Number.isFinite(Number(opts.lookbackLimit)) ? Number(opts.lookbackLimit) : 500;
  const staleAfterMs  = Number.isFinite(Number(opts.staleAfterMs))  ? Number(opts.staleAfterMs)  : (2 * 60 * 60 * 1000); // 기본 2시간
  const dryRun = Boolean(opts.dryRun);

  const nowMs = Date.now();
  const cutoffMs = nowMs - staleAfterMs;

  let snap = null;
  try {
    snap = await db.collection("order_intents_paper")
      .where("status", "==", "PENDING")
      .limit(lookbackLimit)
      .get();
  } catch (_) {
    snap = await db.collection("order_intents_paper")
      .orderBy("created_at", "desc")
      .limit(lookbackLimit)
      .get();
  }

  let scanned = 0, pending = 0, stale = 0, canceled = 0;

  const tasks = [];
  snap.forEach(doc => {
    scanned += 1;
    const x = doc.data() || {};
    if (x.status !== "PENDING") return;
    pending += 1;

    const sched = Number(x.scheduled_exec_bar_close_time_utc_ms);
    const expiresMs = Number(x.expires_at_ms);
    const isExpired = Number.isFinite(expiresMs) && nowMs >= expiresMs;
    const isStale = Number.isFinite(sched) && sched < cutoffMs;
    if (!isExpired && !isStale) return;

    stale += 1;
    if (dryRun) return;

    const reason = isExpired ? "INTENT_EXPIRED" : "STALE_SCHEDULE_PASSED";
    const upd = {
      status: "CANCELED",
      canceled_at: nowIso(),
      updated_at: nowIso(),
      cancel_reason: reason,
      status_reason: reason,
      cancel_meta: {
        now_ms: nowMs,
        cutoff_ms: cutoffMs,
        scheduled_exec_ms: Number.isFinite(sched) ? sched : null,
        expires_at_ms: Number.isFinite(expiresMs) ? expiresMs : null,
      }
    };

    tasks.push(
      db.collection("order_intents_paper").doc(doc.id).set(upd, { merge: true })
        .then(() => { canceled += 1; })
    );
  });

  if (tasks.length) {
    // 너무 길어질까봐 chunk 처리
    const chunk = 50;
    for (let i=0; i<tasks.length; i+=chunk) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(tasks.slice(i, i+chunk));
    }
  }

  return {
    ok: true,
    scanned,
    pending,
    stale,
    canceled,
    dryRun,
    lookbackLimit,
    staleAfterMs,
    now_ms: nowMs,
    cutoff_ms: cutoffMs,
    now_iso: new Date(nowMs).toISOString(),
  };
}

module.exports = { cleanupStalePendingIntents };
