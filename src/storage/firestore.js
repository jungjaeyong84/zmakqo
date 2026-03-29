// src/storage/firestore.js
/**
 * Firestore Adapter (Local/Prod 공용)
 * 목표:
 * - getFirestore() 제공
 * - getLastTrades() 제공
 * - pipeline/runner.js가 쓰는 idemExists/markIdem/addTrade 제공
 */

const admin = require("firebase-admin");

let _db = null;
const _dbByPaperNamespace = new Map();
const PAPER_COLLECTIONS = new Set([
  "positions_paper",
  "order_intents_paper",
  "fills_paper",
  "trades_paper",
  "paper_trades",
]);

function normalizePaperNamespace(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  return s
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

function resolvePaperCollectionName(name, paperNamespace = process.env.PAPER_NAMESPACE) {
  const base = String(name || "").trim();
  if (!base) return base;
  if (!PAPER_COLLECTIONS.has(base)) return base;
  const ns = normalizePaperNamespace(paperNamespace);
  if (!ns) return base;
  return `${base}__${ns}`;
}

function wrapFirestoreWithPaperNamespace(db, paperNamespace) {
  const ns = normalizePaperNamespace(paperNamespace);
  if (!ns) return db;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "collection") {
        return function collectionWithNamespace(name, ...rest) {
          return target.collection(resolvePaperCollectionName(name, ns), ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
}

function initFirestoreOnce() {
  if (_db) return _db;

  // 이미 초기화돼 있으면 재사용
  if (admin.apps && admin.apps.length > 0) {
    _db = admin.firestore();
    return _db;
  }

  // 인증: ADC 우선 (GOOGLE_APPLICATION_CREDENTIALS가 있으면 ADC가 그 파일을 사용)
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  _db = admin.firestore();

  try {
    _db.settings({ ignoreUndefinedProperties: true });
  } catch (e) {}

  return _db;
}

function getFirestore() {
  const db = initFirestoreOnce();
  const ns = normalizePaperNamespace(process.env.PAPER_NAMESPACE);
  if (!ns) return db;
  if (!_dbByPaperNamespace.has(ns)) {
    _dbByPaperNamespace.set(ns, wrapFirestoreWithPaperNamespace(db, ns));
  }
  return _dbByPaperNamespace.get(ns);
}

/**
 * idempotency helpers
 * 컬렉션: idempotency
 * docId: idemKey (문자열)
 */
async function idemExists(idemKey) {
  const db = getFirestore();
  const snap = await db.collection("idempotency").doc(String(idemKey)).get();
  return snap.exists;
}

async function markIdem(idemKey, data = {}) {
  const db = getFirestore();
  await db.collection("idempotency").doc(String(idemKey)).set(
    {
      idemKey: String(idemKey),
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );
  return true;
}

/**
 * trades
 * 컬렉션: paper_trades (기존 getLastTrades가 보는 컬렉션과 통일)
 */
async function addTrade(trade = {}) {
  const db = getFirestore();
  const doc = {
    ...trade,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const ref = await db.collection("paper_trades").add(doc);
  return { id: ref.id, ...doc };
}

/**
 * paper_trades 최근 N개
 */
async function getLastTrades(limit = 10) {
  const db = getFirestore();
  const col = db.collection("paper_trades");

  const candidates = ["created_at", "ts", "entry_time_utc"];
  for (const field of candidates) {
    try {
      const snap = await col.orderBy(field, "desc").limit(limit).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {}
  }

  const snap = await col.limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = {
  getFirestore,
  getLastTrades,
  idemExists,
  markIdem,
  addTrade,
  __test: {
    normalizePaperNamespace,
    resolvePaperCollectionName,
  },
};
