#!/usr/bin/env node
/**
 * Exit Policy Analysis: ATR_DYNAMIC 활성화 판단 지원
 * fills_paper에서 최근 60일 데이터 분석
 */
require("dotenv").config();
const admin = require("firebase-admin");
if (!admin.apps.length) {
  const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (cred) admin.initializeApp({ credential: admin.credential.cert(cred) });
  else admin.initializeApp({ projectId: "donbeolja" });
}
const db = admin.firestore();

async function main() {
  const cutoffMs = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const cutoffISO = new Date(cutoffMs).toISOString();

  console.log("=== Querying fills_paper (last 60 days, BINANCEFUT) ===");
  const snap = await db.collection("fills_paper")
    .where("exchange", "==", "BINANCEFUT")
    .where("created_at", ">=", cutoffISO)
    .orderBy("created_at", "desc")
    .limit(2000)
    .get();

  const fills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log("Total fills:", fills.length);
  if (fills.length === 0) {
    console.log("No data. Trying without date filter...");
    const snap2 = await db.collection("fills_paper")
      .where("exchange", "==", "BINANCEFUT")
      .orderBy("created_at", "desc")
      .limit(2000)
      .get();
    fills.push(...snap2.docs.map(d => ({ id: d.id, ...d.data() })));
    console.log("Total fills (no date filter):", fills.length);
  }
  if (fills.length === 0) {
    console.log("Still no fills. Trying all exchanges...");
    const snap3 = await db.collection("fills_paper")
      .orderBy("created_at", "desc")
      .limit(500)
      .get();
    fills.push(...snap3.docs.map(d => ({ id: d.id, ...d.data() })));
    console.log("Total fills (all exchanges):", fills.length);
  }
  if (fills.length === 0) {
    console.log("No fill data found.");
    process.exit(0);
  }

  // Event distribution
  const eventCounts = {};
  const symbolCounts = {};
  const exitEvents = [];

  for (const f of fills) {
    const ev = String(f.event || "").toUpperCase();
    eventCounts[ev] = (eventCounts[ev] || 0) + 1;
    const sym = f.symbol || f.symbol_or_pair_id || "";
    symbolCounts[sym] = (symbolCounts[sym] || 0) + 1;

    if (ev.startsWith("EXIT_")) {
      exitEvents.push({
        event: ev,
        symbol: sym,
        pnl: Number(f.external_realized_pnl || 0),
        exec_price: Number(f.exec_price || 0),
        qty_pct: Number(f.qty_pct || 0),
        notional: Number(f.notional_krw || 0),
        created_at: f.created_at,
        features: f.features_json || {},
      });
    }
  }

  console.log("\n=== Event Distribution ===");
  Object.entries(eventCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log("\n=== Symbol Distribution ===");
  Object.entries(symbolCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Exit type analysis
  const exitBuckets = {};
  for (const e of exitEvents) {
    const type = e.event.replace(/_LONG|_SHORT/g, "");
    if (!exitBuckets[type]) exitBuckets[type] = { count: 0, totalPnl: 0, wins: 0, losses: 0, pnls: [] };
    exitBuckets[type].count++;
    exitBuckets[type].totalPnl += e.pnl;
    if (e.pnl > 0) exitBuckets[type].wins++;
    else exitBuckets[type].losses++;
    exitBuckets[type].pnls.push(e.pnl);
  }

  console.log("\n=== Exit Type Analysis ===");
  for (const [type, data] of Object.entries(exitBuckets).sort((a, b) => b[1].count - a[1].count)) {
    const avgPnl = data.count > 0 ? data.totalPnl / data.count : 0;
    const wr = data.count > 0 ? (data.wins / data.count * 100).toFixed(1) : "N/A";
    console.log(`  ${type}: ${data.count}건 | 총PnL: ${data.totalPnl.toFixed(2)} | 평균: ${avgPnl.toFixed(2)} | 승률: ${wr}%`);
  }

  // TP_P1 도달 후 추가 수익 분석 (Trail에서 잡는 수익 vs TP_P1 단계 수익)
  const tpP1Events = exitEvents.filter(e => e.event.includes("EXIT_TP_P1"));
  const trailEvents = exitEvents.filter(e => e.event.includes("EXIT_TRAIL"));
  const slEvents = exitEvents.filter(e => e.event.includes("EXIT_SL"));
  const beEvents = exitEvents.filter(e => e.event.includes("EXIT_BE"));

  console.log("\n=== Exit Flow Analysis (고정 3%/1% 기준) ===");
  console.log(`  TP_P1(+3% 부분익절): ${tpP1Events.length}건 → 평균 PnL: ${tpP1Events.length > 0 ? (tpP1Events.reduce((s,e)=>s+e.pnl,0)/tpP1Events.length).toFixed(2) : "N/A"}`);
  console.log(`  Trail(추세 따라감):  ${trailEvents.length}건 → 평균 PnL: ${trailEvents.length > 0 ? (trailEvents.reduce((s,e)=>s+e.pnl,0)/trailEvents.length).toFixed(2) : "N/A"}`);
  console.log(`  SL(손절):            ${slEvents.length}건 → 평균 PnL: ${slEvents.length > 0 ? (slEvents.reduce((s,e)=>s+e.pnl,0)/slEvents.length).toFixed(2) : "N/A"}`);
  console.log(`  BE(원가 복귀):       ${beEvents.length}건 → 평균 PnL: ${beEvents.length > 0 ? (beEvents.reduce((s,e)=>s+e.pnl,0)/beEvents.length).toFixed(2) : "N/A"}`);

  // Key question: SL 비율 (TP 못 닿고 떨어진 비율)
  const totalExits = exitEvents.length;
  if (totalExits > 0) {
    console.log("\n=== 핵심 지표 (ATR_DYNAMIC 판단) ===");
    console.log(`  총 EXIT: ${totalExits}건`);
    console.log(`  SL 비율: ${(slEvents.length/totalExits*100).toFixed(1)}% (${slEvents.length}/${totalExits})`);
    console.log(`  TP1 도달률: ${(tpP1Events.length/totalExits*100).toFixed(1)}%`);
    console.log(`  Trail 청산률: ${(trailEvents.length/totalExits*100).toFixed(1)}%`);
    console.log(`  BE 복귀률: ${(beEvents.length/totalExits*100).toFixed(1)}%`);

    const totalPnl = exitEvents.reduce((s,e) => s + e.pnl, 0);
    const avgWin = exitEvents.filter(e=>e.pnl>0);
    const avgLoss = exitEvents.filter(e=>e.pnl<0);
    console.log(`  전체 순PnL: ${totalPnl.toFixed(2)} USDT`);
    if (avgWin.length > 0 && avgLoss.length > 0) {
      const mw = avgWin.reduce((s,e)=>s+e.pnl,0)/avgWin.length;
      const ml = Math.abs(avgLoss.reduce((s,e)=>s+e.pnl,0)/avgLoss.length);
      console.log(`  평균 승 ${mw.toFixed(2)} / 평균 패 -${ml.toFixed(2)} = RR ${(mw/ml).toFixed(2)}`);
    }
  }

  // Per-symbol exit pattern
  console.log("\n=== Symbol별 Exit 패턴 ===");
  const symExits = {};
  for (const e of exitEvents) {
    if (!symExits[e.symbol]) symExits[e.symbol] = { sl: 0, tp: 0, trail: 0, be: 0, total: 0, pnl: 0 };
    symExits[e.symbol].total++;
    symExits[e.symbol].pnl += e.pnl;
    if (e.event.includes("EXIT_SL")) symExits[e.symbol].sl++;
    if (e.event.includes("EXIT_TP_P1")) symExits[e.symbol].tp++;
    if (e.event.includes("EXIT_TRAIL")) symExits[e.symbol].trail++;
    if (e.event.includes("EXIT_BE")) symExits[e.symbol].be++;
  }
  for (const [sym, d] of Object.entries(symExits).sort((a,b) => b[1].total - a[1].total)) {
    const slPct = d.total > 0 ? (d.sl/d.total*100).toFixed(0) : 0;
    console.log(`  ${sym}: ${d.total}건 | SL:${d.sl}(${slPct}%) TP:${d.tp} Trail:${d.trail} BE:${d.be} | PnL:${d.pnl.toFixed(2)}`);
  }

  // Features에서 pnl_pct, trail_pct 분석
  console.log("\n=== Trail Exit 세부 분석 ===");
  for (const e of trailEvents.slice(0, 10)) {
    const f = e.features || {};
    console.log(`  ${e.symbol} | PnL%: ${(f.pnl_pct*100||0).toFixed(2)}% | Trail%: ${(f.trail_pct*100||0).toFixed(2)}% | PnL: ${e.pnl.toFixed(2)} | ${e.created_at}`);
  }

  console.log("\n=== TP_P1 세부 분석 ===");
  for (const e of tpP1Events.slice(0, 10)) {
    const f = e.features || {};
    console.log(`  ${e.symbol} | PnL%: ${(f.pnl_pct*100||0).toFixed(2)}% | TP1%: ${(f.tp_p1_pct*100||0).toFixed(2)}% | PnL: ${e.pnl.toFixed(2)} | ${e.created_at}`);
  }

  console.log("\n=== SL 세부 분석 ===");
  for (const e of slEvents.slice(0, 10)) {
    const f = e.features || {};
    console.log(`  ${e.symbol} | PnL%: ${(f.pnl_pct*100||0).toFixed(2)}% | SL%: ${(f.trigger_sl_pct*100||0).toFixed(2)}% | PnL: ${e.pnl.toFixed(2)} | ${e.created_at}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
