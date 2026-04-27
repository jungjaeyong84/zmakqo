"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// v1-paper-engine-namespace-guard.test.js
//
// 2026-04-27 Stage 2 — vulnerability A defense-in-depth.
//
// Background: The legacy V1 paper engine (src/paper/engine.js) writes to
// the same `positions_paper` collection that the V2 simplified-exit helper
// (src/storage/positionsPaper.js) owns, but with a different doc-id prefix
// and a completely different schema. The V1 path bypasses the V2 invariant
// validator and writer-lease — that was the architectural vulnerability
// (A) we identified.
//
// This test pins two belt-and-suspenders protections added to V1:
//   (G1) V1 setPosition must REFUSE doc-ids starting with the V2 prefix
//        (`POS__`) so that even a wildly mis-formed ruleId can never clobber
//        a V2 document.
//   (G2) Every V1 setPosition write must stamp `paper_engine_version =
//        "v1_legacy"` so that any future cross-namespace reader can filter
//        V1 docs out instead of misinterpreting them as V2 schema.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// Stub Firestore so we can capture the .set call without touching the real
// backend. The V1 engine pulls getFirestore from "../storage/firestore".
const firestoreStubPath = require.resolve("../storage/firestore");
const captures = {
  setArgs: [],
};

const docStub = {
  set: async (data, opts) => {
    captures.setArgs.push({ data, opts });
    return { writeTime: { seconds: 0, nanoseconds: 0 } };
  },
};
const collectionStub = {
  doc: (id) => ({ ...docStub, _id: id }),
};
const dbStub = {
  collection: (name) => {
    captures.lastCollection = name;
    return collectionStub;
  },
};

require.cache[firestoreStubPath] = {
  id: firestoreStubPath,
  filename: firestoreStubPath,
  loaded: true,
  exports: { getFirestore: () => dbStub },
};

const { __test } = require("../paper/engine");
const { setPosition, V2_DOC_ID_PREFIX } = __test;

assert.strictEqual(typeof setPosition, "function",
  "setPosition export missing on __test");
assert.strictEqual(V2_DOC_ID_PREFIX, "POS__",
  "V2_DOC_ID_PREFIX must remain stable — V2 helper relies on this prefix");

function reset() {
  captures.setArgs.length = 0;
  captures.lastCollection = null;
}

(async () => {
  // ── (G1a) ruleId starting with POS__ → guard throws ───────────────────────
  {
    reset();
    let threw = null;
    try {
      await setPosition({
        ruleId: "POS__",
        symbol: "BTCUSDT",
        pos: { side: "LONG", qty: 1, avg_price: 100 },
      });
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof Error,
      "(G1a) V1 setPosition must throw when ruleId begins with V2 prefix");
    assert.strictEqual(threw.code, "V1_PAPER_ENGINE_NAMESPACE_GUARD",
      "(G1a) typed code so callers can classify");
    assert.ok(threw.docId && threw.docId.startsWith("POS__"),
      "(G1a) error.docId must surface the offending id for ops drill-down");
    assert.strictEqual(captures.setArgs.length, 0,
      "(G1a) NO Firestore write must happen when guard fires");
  }

  // ── (G1b) ruleId+symbol that produces POS__... after concat → guard throws
  {
    reset();
    let threw = null;
    try {
      await setPosition({
        ruleId: "POS_",
        symbol: "_BTCUSDT",
        pos: { side: "LONG", qty: 1, avg_price: 100 },
      });
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof Error,
      "(G1b) guard must catch composed-prefix collisions, not just literal POS__ prefix");
    assert.strictEqual(threw.code, "V1_PAPER_ENGINE_NAMESPACE_GUARD");
    assert.strictEqual(captures.setArgs.length, 0);
  }

  // ── (G1c) safe ruleId (R1_BASE) → no throw, write proceeds ────────────────
  {
    reset();
    await setPosition({
      ruleId: "R1_BASE",
      symbol: "BTCUSDT",
      pos: { side: "LONG", qty: 1, avg_price: 100 },
    });
    assert.strictEqual(captures.setArgs.length, 1,
      "(G1c) safe ruleId must result in exactly one set() call");
    assert.strictEqual(captures.lastCollection, "positions_paper",
      "(G1c) write target must be positions_paper collection");
  }

  // ── (G2) every V1 write must stamp paper_engine_version=v1_legacy ─────────
  {
    reset();
    await setPosition({
      ruleId: "R1_BASE",
      symbol: "ETHUSDT",
      pos: { side: "LONG", qty: 2, avg_price: 200, realized_pnl: 0 },
    });
    assert.strictEqual(captures.setArgs.length, 1);
    const written = captures.setArgs[0].data;
    assert.strictEqual(written.paper_engine_version, "v1_legacy",
      "(G2) paper_engine_version sentinel must be stamped on every V1 write — "
      + "this is what lets future cross-namespace readers filter V1 docs out");
    assert.strictEqual(written.rule_id, "R1_BASE",
      "(G2) rule_id must remain stamped (regression check on existing field)");
    assert.strictEqual(written.symbol, "ETHUSDT",
      "(G2) symbol must remain stamped");
    assert.strictEqual(written.side, "LONG");
    assert.strictEqual(written.qty, 2);
    assert.strictEqual(written.avg_price, 200);
    assert.ok(written.updated_at && typeof written.updated_at === "string");
    assert.strictEqual(captures.setArgs[0].opts && captures.setArgs[0].opts.merge, true,
      "(G2) write must remain merge:true so existing fields aren't clobbered");
  }

  console.log("V1_PAPER_ENGINE_NAMESPACE_GUARD_TEST_OK");
})().catch((err) => {
  console.error("TEST_FAIL:", err && err.stack ? err.stack : err);
  process.exit(1);
});
