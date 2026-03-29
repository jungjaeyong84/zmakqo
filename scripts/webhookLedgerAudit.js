#!/usr/bin/env node
const { getFirestore } = require("../src/storage/firestore");

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function main() {
  const hours = Math.max(1, toNum(process.argv[2], 24));
  const limit = Math.max(100, toNum(process.argv[3], 5000));
  const fromIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const db = getFirestore();

  const snap = await db.collection("webhook_ledger")
    .where("created_at", ">=", fromIso)
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();

  const byReq = new Map();
  const byDecision = {};
  const byReason = {};
  let ingress = 0;
  let outcome = 0;

  snap.forEach((d) => {
    const x = d.data() || {};
    const req = String(x.request_id || "");
    if (!req) return;
    const cur = byReq.get(req) || { ingress: 0, outcome: 0, outcomes: [] };
    if (x.stage === "INGRESS") {
      ingress += 1;
      cur.ingress += 1;
    } else if (x.stage === "OUTCOME") {
      outcome += 1;
      cur.outcome += 1;
      cur.outcomes.push({
        decision: x.decision || null,
        reason: x.reason || null,
        http_status: x.http_status || null,
      });
      const dec = String(x.decision || "UNKNOWN");
      const rsn = String(x.reason || "UNKNOWN");
      byDecision[dec] = (byDecision[dec] || 0) + 1;
      byReason[rsn] = (byReason[rsn] || 0) + 1;
    }
    byReq.set(req, cur);
  });

  let missingOutcome = 0;
  let duplicateOutcome = 0;
  for (const v of byReq.values()) {
    if (v.ingress > 0 && v.outcome === 0) missingOutcome += 1;
    if (v.outcome > 1) duplicateOutcome += 1;
  }

  const topDecision = Object.entries(byDecision).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topReason = Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log(JSON.stringify({
    window_hours: hours,
    from_iso: fromIso,
    docs_scanned: snap.size,
    request_ids: byReq.size,
    ingress,
    outcome,
    missing_outcome_request_ids: missingOutcome,
    duplicate_outcome_request_ids: duplicateOutcome,
    top_decision: topDecision,
    top_reason: topReason,
  }, null, 2));
}

main().catch((e) => {
  console.error("[WEBHOOK_LEDGER_AUDIT_ERROR]", e && e.message ? e.message : String(e));
  process.exit(1);
});
