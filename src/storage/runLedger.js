// src/storage/runLedger.js
const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

async function createRun({ runId, engineVersion, runtimeMode, meta = {} } = {}) {
  const db = getFirestore();
  const docRef = runId
    ? db.collection("system_runs").doc(runId)
    : db.collection("system_runs").doc();

  // idempotent attempt 증가(있으면 +1)
  let attempt = 1;
  try {
    const existing = await docRef.get();
    if (existing.exists) {
      const prevAttempt = Number(existing.data()?.attempt);
      attempt = Number.isFinite(prevAttempt) ? prevAttempt + 1 : 2;
    }
  } catch (_) {
    attempt = 1;
  }

  const run = {
    run_id: docRef.id,
    status: "RUNNING",
    started_at: nowIso(),
    ended_at: null,

    engine_version: engineVersion || process.env.ENGINE_VERSION || "baseline_v0",
    runtime_mode: runtimeMode || process.env.RUNTIME_MODE || "local",

    has_gate_event: false,
    gate_status: null,
    gate_severity: null,
    gate_version: null,

    attempt,
    meta: meta || {},
  };

  await docRef.set(run, { merge: true });
  return run;
}

async function finishRun(runId, status, patch = {}) {
  if (!runId) return;

  const db = getFirestore();
  const ref = db.collection("system_runs").doc(runId);

  await ref.set(
    {
      status: status || "IDLE",
      ended_at: nowIso(),
      ...patch,
    },
    { merge: true }
  );
}

async function getLatestRun() {
  const db = getFirestore();
  const snap = await db.collection("system_runs").orderBy("started_at", "desc").limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

module.exports = { createRun, finishRun, getLatestRun };
