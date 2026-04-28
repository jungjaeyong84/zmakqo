"use strict";

// 2026-04-28 Stage S — V2→V1 positions_paper.meta mirror unit test.
//
// Covers:
//   (A) buildV2ToV1MetaPatch — pure transform, no I/O.
//   (B) isV2ToV1MetaMirrorEnabled — env gate semantics.
//   (C) writeV2ToV1MetaMirror — disabled by default (no upsertFn call).
//   (D) writeV2ToV1MetaMirror — enabled path issues a meta-only upsert
//       with the mirrored fields and returns OK.
//   (E) writeV2ToV1MetaMirror — upsertFn failure surfaces but never
//       throws (best-effort contract).
//   (F) Idempotence — same inputs produce identical patches modulo
//       the timestamp fields.

const assert = require("assert");
const path = require("path");

// Reload the module under each env permutation.
function reloadModule() {
  delete require.cache[require.resolve("../v2/v1MetaMirror")];
  return require("../v2/v1MetaMirror");
}

function withEnv(name, value, fn) {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { return fn(); } finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

const SAMPLE_INPUT = {
  entryEventId: "ENTRY__BTCUSDT__1713571200000",
  entryIntentId: "INTENT__BTCUSDT__1",
  positionCycleId: "PCY__BINANCEFUT__BTCUSDT__LONG__abc123",
  positionSide: "long",
  entryPrice: 60000,
  entryQtyAbs: 0.5,
  entryExecBarMs: 1713571200000,
  initialStopPrice: 59010,
  entryRDistance: 0.0165,
  tp1TargetPct: 0.025,
  nativeStopOrderId: "STOP__BTCUSDT__1",
  nativeStopPrice: 59010,
  nativeTpOrderId: "TP__BTCUSDT__1",
  nativeTpPrice: 61500,
  nativeTpQtyBase: 0.25,
  nativeTpQtyRatio: 0.5,
  nativeRefreshStatus: "ok",
  nativeRefreshAtMs: 1713571201234,
  nativeProtectionUnprotectedWindowMs: 25,
};

(function testBuildPatchPure() {
  const { buildV2ToV1MetaPatch } = reloadModule();
  const patch = buildV2ToV1MetaPatch(SAMPLE_INPUT);

  // (A.1) Provenance fields.
  assert.strictEqual(patch.v2_to_v1_mirrored, true);
  assert.strictEqual(patch.v2_to_v1_mirrored_position_cycle_id, SAMPLE_INPUT.positionCycleId);
  assert.ok(Number.isFinite(patch.v2_to_v1_mirrored_at_ms));

  // (A.2) V1-required entry fields.
  assert.strictEqual(patch.entry_event_id, SAMPLE_INPUT.entryEventId);
  assert.strictEqual(patch.entry_intent_id, SAMPLE_INPUT.entryIntentId);
  assert.strictEqual(patch.position_side, "LONG");
  assert.strictEqual(patch.entry_price, 60000);
  assert.strictEqual(patch.entry_qty_base, 0.5);
  assert.strictEqual(patch.entry_exec_bar_ms, 1713571200000);

  // (A.3) Stage E/G protection plan fields.
  assert.strictEqual(patch.initial_stop_price, 59010);
  assert.strictEqual(patch.entry_r_distance, 0.0165);
  assert.strictEqual(patch.tp_p1_target_pct, 0.025);

  // (A.4) Simplified V2 flag.
  assert.strictEqual(patch.simplified_exit_v2_enabled, true);

  // (A.5) Native protection mirror.
  assert.strictEqual(patch.native_protection_side, "LONG");
  assert.strictEqual(patch.native_protection_stop_price, 59010);
  assert.strictEqual(patch.native_protection_tp_price, 61500);
  assert.strictEqual(patch.native_protection_tp_qty_base, 0.25);
  assert.strictEqual(patch.native_protection_refresh_status, "OK");
  assert.strictEqual(patch.native_protection_unprotected_window_ms, 25);
  assert.strictEqual(patch.native_protection_stale, false);
  assert.strictEqual(patch.native_protection_refresh_context, "ENTRY");
})();

(function testEnvGate() {
  withEnv("V2_TO_V1_META_MIRROR_ENABLED", undefined, () => {
    const { isV2ToV1MetaMirrorEnabled } = reloadModule();
    assert.strictEqual(isV2ToV1MetaMirrorEnabled(process.env), false, "(B) default off");
  });
  withEnv("V2_TO_V1_META_MIRROR_ENABLED", "0", () => {
    const { isV2ToV1MetaMirrorEnabled } = reloadModule();
    assert.strictEqual(isV2ToV1MetaMirrorEnabled(process.env), false, "(B) explicit 0");
  });
  for (const truthy of ["1", "true", "yes", "on", "TRUE", "ON"]) {
    withEnv("V2_TO_V1_META_MIRROR_ENABLED", truthy, () => {
      const { isV2ToV1MetaMirrorEnabled } = reloadModule();
      assert.strictEqual(isV2ToV1MetaMirrorEnabled(process.env), true, `(B) truthy=${truthy}`);
    });
  }
})();

(async function testDisabledSkip() {
  const { writeV2ToV1MetaMirror } = reloadModule();
  let called = 0;
  const upsertFn = async () => { called += 1; };
  await withEnv("V2_TO_V1_META_MIRROR_ENABLED", "0", async () => {
    const result = await writeV2ToV1MetaMirror({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      positionCycleId: SAMPLE_INPUT.positionCycleId,
      patchInputs: SAMPLE_INPUT,
      env: process.env,
      upsertFn,
      logFn: () => {},
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, "V2_TO_V1_META_MIRROR_DISABLED");
    assert.strictEqual(called, 0, "(C) disabled mode must not call upsertFn");
  });
})();

(async function testEnabledHappyPath() {
  const { writeV2ToV1MetaMirror } = reloadModule();
  let captured = null;
  const upsertFn = async (args) => { captured = args; };
  await withEnv("V2_TO_V1_META_MIRROR_ENABLED", "1", async () => {
    const result = await writeV2ToV1MetaMirror({
      exchange: "BINANCEFUT",
      symbol: "btcusdt",
      positionCycleId: SAMPLE_INPUT.positionCycleId,
      patchInputs: SAMPLE_INPUT,
      env: process.env,
      upsertFn,
      logFn: () => {},
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.reason, "V2_TO_V1_META_MIRROR_OK");
    assert.ok(captured, "(D) upsertFn must be called");
    assert.strictEqual(captured.exchange, "BINANCEFUT");
    assert.strictEqual(captured.symbol, "BTCUSDT", "(D) symbol must be upper-cased");
    assert.strictEqual(captured.mutationKind, "V2_TO_V1_META_MIRROR");
    assert.strictEqual(captured.source, "V2_BOOTSTRAP");
    assert.strictEqual(captured.meta.entry_event_id, SAMPLE_INPUT.entryEventId);
    assert.strictEqual(captured.meta.simplified_exit_v2_enabled, true);
    assert.ok(!Object.prototype.hasOwnProperty.call(captured, "expectedWriteToken"),
      "(D) meta-only writes must NOT supply a CAS token (no state mutation)");
  });
})();

(async function testEnabledFailureBestEffort() {
  const { writeV2ToV1MetaMirror } = reloadModule();
  let logged = null;
  const upsertFn = async () => { throw new Error("FIRESTORE_DOWN"); };
  await withEnv("V2_TO_V1_META_MIRROR_ENABLED", "1", async () => {
    let threw = false;
    let result;
    try {
      result = await writeV2ToV1MetaMirror({
        exchange: "BINANCEFUT",
        symbol: "BTCUSDT",
        positionCycleId: SAMPLE_INPUT.positionCycleId,
        patchInputs: SAMPLE_INPUT,
        env: process.env,
        upsertFn,
        logFn: (line) => { logged = line; },
      });
    } catch (_) {
      threw = true;
    }
    assert.strictEqual(threw, false, "(E) writer must never throw — best-effort contract");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_TO_V1_META_MIRROR_FAIL");
    assert.ok(logged && logged.includes("v2_to_v1_meta_mirror_fail"), "(E) failure event must be logged");
  });
})();

(function testIdempotence() {
  const { buildV2ToV1MetaPatch } = reloadModule();
  const a = buildV2ToV1MetaPatch(SAMPLE_INPUT);
  const b = buildV2ToV1MetaPatch(SAMPLE_INPUT);
  // Strip timestamps before comparing.
  const strip = (obj) => {
    const out = { ...obj };
    delete out.v2_to_v1_mirrored_at_ms;
    delete out.native_protection_refresh_at_ms;
    return out;
  };
  assert.deepStrictEqual(strip(a), strip(b), "(F) buildV2ToV1MetaPatch must be deterministic");
})();

setTimeout(() => console.log("V2_TO_V1_META_MIRROR_TEST_OK"), 0);
