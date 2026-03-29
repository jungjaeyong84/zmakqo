/* eslint-disable no-console */
const { getFirestore } = require("../src/storage/firestore");
const { getExchangeSettingsForProvider } = require("../src/utils/exchangeSettings");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickProviderBucket(doc) {
  if (doc && typeof doc.providers === "object" && doc.providers) {
    return { mode: "providers", bucket: doc.providers };
  }
  if (doc && typeof doc.by_provider === "object" && doc.by_provider) {
    return { mode: "by_provider", bucket: doc.by_provider };
  }
  return { mode: "legacy", bucket: null };
}

function ensureBudget(entry, markets) {
  const out = { ...entry };
  const byMarket = (out.by_market && typeof out.by_market === "object") ? { ...out.by_market } : {};
  const totalMax = toNum(out.total_max_krw) || 0;
  let defaultMax = toNum(out.default_max_krw) || 0;
  if (defaultMax <= 0 && totalMax > 0 && markets.length > 0) {
    defaultMax = totalMax / markets.length;
  }
  for (const mk of markets) {
    const cur = toNum(byMarket[mk]);
    if (!Number.isFinite(cur) || cur <= 0) {
      if (defaultMax > 0) byMarket[mk] = defaultMax;
    }
  }
  out.by_market = byMarket;
  if (defaultMax > 0) out.default_max_krw = defaultMax;
  return out;
}

async function main() {
  const db = getFirestore();
  const ex = await getExchangeSettingsForProvider("KIWOOM", 3000);
  const markets = Array.isArray(ex && ex.markets) ? ex.markets : [];
  if (!markets.length) {
    console.error("[kiwoom-budget] markets empty; check exchange settings.");
    process.exitCode = 1;
    return;
  }

  const ref = db.collection("settings").doc("risk_budget");
  const snap = await ref.get();
  const doc = snap.exists ? (snap.data() || {}) : {};
  const { mode, bucket } = pickProviderBucket(doc);

  let payload = {};
  if (mode === "providers" || mode === "by_provider") {
    const map = { ...(bucket || {}) };
    const prev = (map.KIWOOM && typeof map.KIWOOM === "object") ? map.KIWOOM : {};
    map.KIWOOM = ensureBudget(prev, markets);
    payload = { [mode]: map };
  } else {
    const prev = (doc && typeof doc === "object") ? doc : {};
    payload = ensureBudget(prev, markets);
  }

  await ref.set(payload, { merge: true });
  console.log("[kiwoom-budget] updated risk_budget with missing markets:", markets.length);
}

main().catch((e) => {
  console.error("[kiwoom-budget] failed:", e && (e.message || e));
  process.exitCode = 1;
});
