// src/storage/bars.js
// bars 저장(최소 스키마) - Phase 0

const { getFirestore } = require("./firestore");

// doc id를 안전하게 만들기(특수문자 제거)
function safeId(s) {
  return String(s).replace(/[^a-zA-Z0-9_\-:.]/g, "_");
}

/**
 * bars 컬렉션에 1~N개 바를 upsert 저장
 * 유니크 키(문서ID): exchange_symbol_tf_closeTimeUtc
 *
 * bar: { exchange, symbol, tf, closeTimeUtc, closeTimeKst, ohlcv }
 */
async function upsertBars(bars) {
  const db = getFirestore();

  if (!Array.isArray(bars) || bars.length === 0) return { saved: 0 };

  const batch = db.batch();
  let saved = 0;

  for (const b of bars) {
    const docId = safeId(`${b.exchange}_${b.symbol}_${b.tf}_${b.closeTimeUtc}`);
    const ref = db.collection("bars").doc(docId);

    batch.set(
      ref,
      {
        exchange: b.exchange,
        symbol: b.symbol,
        tf: b.tf,
        bar_close_time_utc: b.closeTimeUtc,
        bar_close_time_kst: b.closeTimeKst || null,
        ohlcv_json: b.ohlcv,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    saved += 1;
  }

  await batch.commit();
  return { saved };
}

module.exports = { upsertBars };
