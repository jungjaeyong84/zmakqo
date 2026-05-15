"use strict";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "donbeolja-dev" });
const db = admin.firestore();

(async () => {
  const snap = await db.collection("positions_paper").where("size_pct", ">", 0).get();
  const rows = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (String(d.execution_mode || "").toUpperCase() !== "LIVE") return;
    if (String(d.exchange || "").toUpperCase() !== "BINANCEFUT") return;
    const meta = d.meta || {};
    rows.push({
      symbol: d.symbol,
      side: d.position_side || meta.position_side,
      size_pct: d.size_pct,
      avg_price: d.avg_price,
      tp_p1_done: meta.tp_p1_done === true,
      tp_p1_target_price: meta.tp_p1_target_price ?? null,
      tp_p1_entry_event_id: meta.tp_p1_entry_event_id ?? null,
      tp_p1_at: meta.tp_p1_at ?? null,
      entry_event_id: meta.entry_event_id ?? null,
      entry_exec_bar_ms: meta.entry_exec_bar_ms ?? null,
      simplified_exit_v2_enabled: meta.simplified_exit_v2_enabled === true,
      native_protection_tp_order_id: meta.native_protection_tp_order_id ?? null,
      native_protection_tp_price: meta.native_protection_tp_price ?? null,
      native_protection_tp_status: meta.native_protection_tp_status ?? null,
      native_protection_stop_order_id: meta.native_protection_stop_order_id ?? null,
      native_protection_stop_price: meta.native_protection_stop_price ?? null,
      native_protection_refresh_status: meta.native_protection_refresh_status ?? null,
      native_protection_refresh_reason: meta.native_protection_refresh_reason ?? null,
      native_protection_refresh_at_ms: meta.native_protection_refresh_at_ms ?? null,
      runtime_exit_invariant_repaired: meta.runtime_exit_invariant_repaired ?? null,
      runtime_exit_repair_applied: meta.runtime_exit_repair_applied ?? null,
      external_synced_at: meta.external_synced_at ?? null,
    });
  });
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
