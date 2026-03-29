const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { normalizeProviderId } = require("../src/utils/providerUtils");

function nowIso() {
  return new Date().toISOString();
}

function normalizeExecutionMode(v) {
  const s = String(v || "").toUpperCase();
  if (s === "LIVE" || s === "LIVE_DRY_RUN" || s === "PAPER") return s;
  return null;
}

function extractExecutionMode(data = {}) {
  const feat = data.features_json || data.features || null;
  const ai = feat && feat.ai_signal ? feat.ai_signal : null;
  const candidates = [
    data.execution_mode,
    data.executionMode,
    data.meta && data.meta.execution_mode,
    feat && feat.execution_mode,
    feat && feat._execution_mode,
    feat && feat.meta && feat.meta.execution_mode,
    ai && ai.execution_mode,
    ai && ai.meta && ai.meta.execution_mode,
    data._execution_mode,
  ];

  for (const c of candidates) {
    const m = normalizeExecutionMode(c);
    if (m) return m;
  }
  return null;
}

async function resolveDefaultExecutionMode(exchange, cache) {
  const ex = normalizeProviderId(exchange || "UPBIT");
  if (cache.has(ex)) return cache.get(ex);
  const sys = await getSystemSettingsForProvider(ex, 5000);
  const cfg = (sys && sys.data) ? sys.data : {};
  let exec = normalizeExecutionMode(cfg.execution_mode);
  if (exec === "LIVE" && cfg.live_dry_run === true) exec = "LIVE_DRY_RUN";
  cache.set(ex, exec || null);
  return exec || null;
}

async function backfillCollection({ name, exchangeFilter = [] } = {}) {
  const db = getFirestore();
  const col = db.collection(name);
  const exchangeSet = new Set(exchangeFilter.map((x) => normalizeProviderId(x)));

  let last = null;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let missing = 0;

  const defaultModeCache = new Map();
  let batch = db.batch();
  let batchOps = 0;

  async function commitBatch() {
    if (!batchOps) return;
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
      const ex = normalizeProviderId(data.exchange || data.provider || "UPBIT");
      if (exchangeSet.size > 0 && !exchangeSet.has(ex)) {
        skipped += 1;
        continue;
      }

      const existing = normalizeExecutionMode(data.execution_mode);
      if (existing) {
        skipped += 1;
        continue;
      }

      missing += 1;
      const derived = extractExecutionMode(data);
      const fallback = derived ? derived : await resolveDefaultExecutionMode(ex, defaultModeCache);
      if (!fallback) {
        skipped += 1;
        continue;
      }

      batch.update(doc.ref, {
        execution_mode: fallback,
        execution_mode_backfilled: true,
        execution_mode_backfilled_at: nowIso(),
        updated_at: nowIso(),
      });
      batchOps += 1;
      updated += 1;

      if (batchOps >= 300) {
        await commitBatch();
      }
    }

    last = snap.docs[snap.docs.length - 1];
  }

  await commitBatch();

  return { collection: name, scanned, missing, updated, skipped };
}

async function main() {
  const exchangeFilter = String(process.env.EXCHANGE_FILTER || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const results = [];
  results.push(await backfillCollection({ name: "signals", exchangeFilter }));
  results.push(await backfillCollection({ name: "signals_dropped", exchangeFilter }));

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_EXECUTION_MODE_ERROR", err && err.message ? err.message : err);
  process.exit(1);
});
