"use strict";

// Regression tests for Phase 2 remediation invariants (C2, C8, C13, C17).

const assert = require("assert");

const {
  validatePositionSnapshotTransition,
  detectPositionSideFlip,
  resolveStoredCanonicalExitStage,
} = require("../services/positionStateMachine");
const exitAuthorityState = require("../storage/exitAuthorityState");
const collectionCache = require("../../scripts/lib/exit-integrity-collection-cache");

// ---------- C13 LONG/SHORT flip invariant ---------------------------------
(() => {
  const carried = validatePositionSnapshotTransition({
    prev: {
      state: "ACTIVE",
      position_state: "COMMIT",
      position_side: "LONG",
      size_pct: 1,
      qty_base: 1,
      entry_qty_base: 1,
      meta: { tp_p0_done: true, tp_p1_done: true, trail_active: true, simplified_exit_v2_enabled: true },
    },
    next: {
      state: "ACTIVE",
      position_state: "COMMIT",
      position_side: "SHORT",
      size_pct: 1,
      qty_base: 1,
      entry_qty_base: 1,
      meta: { tp_p0_done: false, tp_p1_done: true, trail_active: true, simplified_exit_v2_enabled: true },
    },
  });
  assert.ok(carried.issues.some((i) => i.code === "SIDE_FLIP_WITHOUT_LEDGER_RESET"),
    `expected SIDE_FLIP_WITHOUT_LEDGER_RESET; got ${JSON.stringify(carried.issues)}`);
  assert.strictEqual(carried.ok, false, "side-flip with carried ledger must fail-closed");

  const reset = validatePositionSnapshotTransition({
    prev: {
      state: "FLAT",
      position_state: "FLAT",
      position_side: "LONG",
      size_pct: 0,
      qty_base: 0,
      meta: {},
    },
    next: {
      state: "ACTIVE",
      position_state: "COMMIT",
      position_side: "SHORT",
      size_pct: 1,
      qty_base: 1,
      entry_qty_base: 1,
      meta: { tp_p0_done: false, tp_p1_done: false, trail_active: false, simplified_exit_v2_enabled: true },
    },
  });
  assert.ok(!reset.issues.some((i) => i.code === "SIDE_FLIP_WITHOUT_LEDGER_RESET"),
    "clean flip with reset ledger must NOT flag the side-flip invariant");

  const flip = detectPositionSideFlip({
    prev: { position_side: "LONG" },
    next: { position_side: "SHORT", meta: { tp_p1_done: false } },
  });
  assert.strictEqual(flip.flipped, true);
  assert.strictEqual(flip.ledger_carried_over, false);
})();

// ---------- C17 meta dual-owner single-reader --------------------------
(() => {
  assert.strictEqual(
    resolveStoredCanonicalExitStage({ canonical_exit_stage: "TRAIL" }),
    "TRAIL"
  );
  assert.strictEqual(
    resolveStoredCanonicalExitStage({ authoritative_exit_stage: "TP0" }),
    "TP0",
    "legacy field must still be readable during migration"
  );
  assert.strictEqual(
    resolveStoredCanonicalExitStage({
      canonical_exit_stage: "TRAIL",
      authoritative_exit_stage: "TP1",
    }),
    "TRAIL",
    "canonical_exit_stage must win when both present"
  );
  assert.strictEqual(resolveStoredCanonicalExitStage({}), null);

  // Repair path must no longer write authoritative_exit_stage on fresh meta.
  const repair = require("../services/liveTrailingStageRepair");
  const { __test } = repair;
  const nextMeta = __test.buildRepairedMeta(
    { simplified_exit_v2_enabled: true },
    { stage: "TRAIL", source: "CANONICAL_TRAIL_STAGE", reason: "CANONICAL_TRAIL_STAGE" }
  );
  assert.strictEqual(nextMeta.canonical_exit_stage, "TRAIL");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(nextMeta, "authoritative_exit_stage"),
    false,
    "repair must not write authoritative_exit_stage on fresh meta"
  );
})();

// ---------- C2 authority state normalization / merge -----------------------
(() => {
  const merged = exitAuthorityState.mergeStates(
    { tp0: 0.25, tp1: 0.1, total: 0.3, trail: 0 },
    { tp0: 0.2, tp1: 0.35, total: 0.4, trail: 0.1 }
  );
  assert.strictEqual(merged.tp0, 0.25);
  assert.strictEqual(merged.tp1, 0.35);
  assert.strictEqual(merged.trail, 0.1);
  assert.strictEqual(merged.total, 0.4);

  const zeroed = exitAuthorityState.normalizeState({
    tp0: -1, tp1: "foo", trail: null, total: 0.5,
  });
  assert.strictEqual(zeroed.tp0, 0);
  assert.strictEqual(zeroed.tp1, 0);
  assert.strictEqual(zeroed.trail, 0);
  assert.strictEqual(zeroed.total, 0.5);

  // persist & load with a stub db that captures writes/reads.
  (async () => {
    const store = new Map();
    const stubDb = {
      collection(name) {
        assert.strictEqual(name, exitAuthorityState.COLLECTION);
        return {
          doc(key) {
            return {
              async get() {
                return {
                  exists: store.has(key),
                  data() { return store.get(key) || null; },
                };
              },
              async set(payload) {
                store.set(key, payload);
              },
            };
          },
        };
      },
    };
    await exitAuthorityState.persistExitAuthorityStates(stubDb, [
      {
        chainKey: "BINANCEFUT__BTCUSDT__ENTRY__abc",
        exchange: "BINANCEFUT",
        symbol: "BTCUSDT",
        entryEventId: "abc",
        state: { tp1: 0.5, total: 0.5 },
      },
    ]);
    assert.strictEqual(store.size, 1);
    const loaded = await exitAuthorityState.loadExitAuthorityStates(
      stubDb,
      ["BINANCEFUT__BTCUSDT__ENTRY__abc", "NONEXISTENT"]
    );
    assert.strictEqual(loaded.size, 1);
    assert.strictEqual(loaded.get("BINANCEFUT__BTCUSDT__ENTRY__abc").tp1, 0.5);
  })().catch((err) => {
    console.error("EXIT_AUTHORITY_STATE_STUB_FAIL", err);
    process.exit(1);
  });
})();

// ---------- C8 collection cache roundtrip ----------------------------------
(() => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "integrity-cache-"));
  const file = path.join(dir, "cache.json");
  fs.writeFileSync(file, JSON.stringify({
    generated_at: new Date().toISOString(),
    lookback_ms: 1000,
    collections: {
      fills_paper: { rows: [{ __id: "f1", qty: 1 }, { __id: "f2", qty: 2 }], truncated: false },
      trade_alert_outbox: { rows: [], truncated: false },
    },
  }));
  const cached = collectionCache.readExitIntegrityCollectionCache(file);
  assert.ok(cached, "cache must be readable");
  const fills = collectionCache.getCachedCollectionRows(cached, "fills_paper");
  assert.strictEqual(Array.isArray(fills), true);
  assert.strictEqual(fills.length, 2);
  assert.strictEqual(fills[0].__id, "f1");
  const empty = collectionCache.getCachedCollectionRows(cached, "does_not_exist");
  assert.strictEqual(empty, null);

  // missing file → null (subscript falls back to legacy query).
  const missing = collectionCache.readExitIntegrityCollectionCache(path.join(dir, "nope.json"));
  assert.strictEqual(missing, null);

  collectionCache.removeCacheFile(file);
  assert.strictEqual(fs.existsSync(file), false);
})();

console.log("EXIT_INVARIANTS_PHASE2_TEST_OK");
