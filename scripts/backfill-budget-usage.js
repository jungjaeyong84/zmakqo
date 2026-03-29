// Backfill budget fields (notional_krw, budget_max_krw, budget_used_krw, qty_fraction)
// for existing fills/trades/positions based on settings/risk_budget.
// Default is dry-run. Set APPLY=1 to write.
require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");

const PAGE_SIZE = Number(process.env.PAGE_SIZE || 500);
const MAX_DOCS = Number(process.env.MAX_DOCS || 50000);

function normalizeQtyFraction(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return null;
}

async function loadRiskBudget(db) {
  const snap = await db.collection("settings").doc("risk_budget").get();
  if (!snap.exists) return null;
  const cfg = snap.data() || {};
  if (cfg.enabled !== true) return null;
  return cfg;
}

function budgetMaxFor(cfg, market) {
  const by = (cfg.by_market && typeof cfg.by_market === "object") ? cfg.by_market : {};
  const v = Number(by[market] ?? cfg.default_max_krw ?? 0);
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function scanAndPatch({
  db,
  colName,
  maxDocs,
  apply,
  makePatch,
}) {
  let lastId = null;
  let scanned = 0;
  let matched = 0;
  let updated = 0;

  for (;;) {
    let q = db.collection(colName).orderBy("__name__").limit(PAGE_SIZE);
    if (lastId) q = q.startAfter(lastId);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      if (scanned > maxDocs) return { scanned, matched, updated, truncated: true };
      const data = doc.data() || {};
      const patch = makePatch(data);
      if (!patch) continue;
      matched += 1;
      if (apply) {
        await doc.ref.set(patch, { merge: true });
        updated += 1;
      }
    }

    lastId = snap.docs[snap.docs.length - 1].id;
  }

  return { scanned, matched, updated, truncated: false };
}

async function main() {
  const apply = String(process.env.APPLY || "0") === "1";
  const db = getFirestore();

  const cfg = await loadRiskBudget(db);
  if (!cfg) {
    console.log("Risk budget is disabled or missing. Nothing to backfill.");
    return;
  }

  console.log("== BACKFILL BUDGET FIELDS ==");
  console.log(`APPLY=${apply ? "1" : "0 (dry-run)"}`);

  const fillsRes = await scanAndPatch({
    db,
    colName: "fills_paper",
    maxDocs: MAX_DOCS,
    apply,
    makePatch: (x) => {
      if (x.notional_krw != null && x.budget_max_krw != null && x.budget_used_krw != null && x.qty_fraction != null) return null;
      const market = x.symbol || x.symbol_or_pair_id || x.market;
      if (!market) return null;
      const maxKrw = budgetMaxFor(cfg, market);
      if (!maxKrw) return null;
      const qtyFraction = (x.qty_fraction != null) ? normalizeQtyFraction(x.qty_fraction) : normalizeQtyFraction(x.qty_pct);
      if (!qtyFraction) return null;
      const notionalKrw = maxKrw * qtyFraction;
      const patch = {};
      if (x.qty_fraction == null) patch.qty_fraction = qtyFraction;
      if (x.notional_krw == null) patch.notional_krw = notionalKrw;
      if (x.budget_max_krw == null) patch.budget_max_krw = maxKrw;
      if (x.budget_used_krw == null) patch.budget_used_krw = notionalKrw;
      return Object.keys(patch).length ? patch : null;
    },
  });

  console.log(`[fills_paper] scanned=${fillsRes.scanned} matched=${fillsRes.matched} updated=${fillsRes.updated}` + (fillsRes.truncated ? " (truncated)" : ""));

  const tradesRes = await scanAndPatch({
    db,
    colName: "trades_paper",
    maxDocs: MAX_DOCS,
    apply,
    makePatch: (x) => {
      if (x.notional_krw != null && x.budget_max_krw != null && x.budget_used_krw != null && x.qty_fraction != null) return null;
      const market = x.symbol_or_pair_id || x.symbol || x.market;
      if (!market) return null;
      const maxKrw = budgetMaxFor(cfg, market);
      if (!maxKrw) return null;
      const qtyFraction = (x.qty_fraction != null) ? normalizeQtyFraction(x.qty_fraction) : normalizeQtyFraction(x.qty_pct);
      if (!qtyFraction) return null;
      const notionalKrw = maxKrw * qtyFraction;
      const patch = {};
      if (x.qty_fraction == null) patch.qty_fraction = qtyFraction;
      if (x.notional_krw == null) patch.notional_krw = notionalKrw;
      if (x.budget_max_krw == null) patch.budget_max_krw = maxKrw;
      if (x.budget_used_krw == null) patch.budget_used_krw = notionalKrw;
      return Object.keys(patch).length ? patch : null;
    },
  });

  console.log(`[trades_paper] scanned=${tradesRes.scanned} matched=${tradesRes.matched} updated=${tradesRes.updated}` + (tradesRes.truncated ? " (truncated)" : ""));

  const posRes = await scanAndPatch({
    db,
    colName: "positions_paper",
    maxDocs: MAX_DOCS,
    apply,
    makePatch: (x) => {
      const posId = String(x.pos_id || "");
      if (!posId.startsWith("POS__")) return null;
      if (x.budget_max_krw != null && x.budget_used_krw != null) return null;
      const market = x.symbol_or_pair_id || x.symbol;
      if (!market) return null;
      const maxKrw = budgetMaxFor(cfg, market);
      if (!maxKrw) return null;
      const sizePct = Number(x.size_pct || 0);
      const used = (Number.isFinite(sizePct) && sizePct > 0) ? maxKrw * sizePct : 0;
      const patch = {};
      if (x.budget_max_krw == null) patch.budget_max_krw = maxKrw;
      if (x.budget_used_krw == null) patch.budget_used_krw = used;
      return Object.keys(patch).length ? patch : null;
    },
  });

  console.log(`[positions_paper] scanned=${posRes.scanned} matched=${posRes.matched} updated=${posRes.updated}` + (posRes.truncated ? " (truncated)" : ""));
}

main()
  .then(() => {
    console.log("== DONE ==");
    process.exit(0);
  })
  .catch((err) => {
    console.error("BACKFILL_FAILED:", err && err.message ? err.message : String(err));
    process.exit(1);
  });
