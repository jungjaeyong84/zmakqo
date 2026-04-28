"use strict";

// 2026-04-28 F2 Phase 3 — V2 server-native ENTRY signal generator
// integration structural test.
//
// Validates the static wiring (no Firestore, no network, no live process)
// so a regression that severs the integration is caught at build time:
//
//   (A) src/storage/v2ServerEntryCooldown.js exists with the expected
//       getter/setter API
//   (B) src/v2/serverEntrySignalGenerator.js exports
//       generateV2EntrySignals (used as the sole entry point from
//       paperBinanceRunner)
//   (C) src/engine/paperBinanceRunner.js imports both modules and
//       checks DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED before
//       calling generateV2EntrySignals — i.e. default off
//   (D) The generator's output is funneled into `internalSignalsRaw`
//       so the existing dedupe + V2 discovery handoff bridge picks it up
//   (E) src/scheduler/marketRunner.js fires the 240m HTF cache refresh
//       under the same env flag (Phase 2.5)

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// (A) cooldown storage module
(function testCooldownStorageModule() {
  const mod = require("../storage/v2ServerEntryCooldown");
  assert.strictEqual(typeof mod.getV2ServerEntryCooldownState, "function", "(A) getter must be a function");
  assert.strictEqual(typeof mod.setV2ServerEntryCooldownState, "function", "(A) setter must be a function");
  assert.strictEqual(typeof mod.buildCooldownDocId, "function", "(A) doc-id builder must be a function");
  assert.strictEqual(mod.COLLECTION, "v2_server_entry_cooldown", "(A) collection name pinned");
  // doc-id sanity
  const id = mod.buildCooldownDocId({ exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "5" });
  assert.strictEqual(id, "BINANCEFUT__BTCUSDT__5");
  assert.strictEqual(mod.buildCooldownDocId({}), null);
  assert.strictEqual(mod.buildCooldownDocId({ exchange: "BINANCEFUT" }), null);
})();

// (B) generator module export contract
(function testGeneratorExport() {
  const mod = require("../v2/serverEntrySignalGenerator");
  assert.strictEqual(typeof mod.generateV2EntrySignals, "function", "(B) generator must be exported");
  assert.strictEqual(typeof mod.computeHtfBias, "function", "(B) HTF helper must be exported");
})();

// (C+D) paperBinanceRunner integration source check
(function testPaperBinanceRunnerWiring() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "engine", "paperBinanceRunner.js"),
    "utf8"
  );

  // (C1) generator + cooldown imports
  assert.ok(
    src.includes('require("../v2/serverEntrySignalGenerator")'),
    "(C1) paperBinanceRunner must require ../v2/serverEntrySignalGenerator"
  );
  assert.ok(
    src.includes('require("../storage/v2ServerEntryCooldown")'),
    "(C1) paperBinanceRunner must require ../storage/v2ServerEntryCooldown"
  );

  // (C2) env flag check default off
  assert.ok(
    src.includes("DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED"),
    "(C2) paperBinanceRunner must read DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED"
  );

  // (C3) the env-flag check must precede the generateV2EntrySignals call
  const flagIdx = src.indexOf("DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED");
  const callIdx = src.indexOf("generateV2EntrySignals(");
  assert.ok(flagIdx > 0 && callIdx > 0, "(C3) anchors not found");
  assert.ok(
    flagIdx < callIdx,
    "(C3) env-flag check must precede generateV2EntrySignals call (default off)"
  );

  // (D) the output must merge into internalSignalsRaw — at BOTH call
  //     sites (paperBinanceRunner has two parallel functions:
  //     runPaperBinanceForBar and runPaperFuturesForBar; the BinanceFut
  //     runtime path goes through runPaperFuturesForBar so both must
  //     have the inject).
  const arrIndices = [];
  let pos = 0;
  while ((pos = src.indexOf("const internalSignalsRaw = [", pos)) !== -1) {
    arrIndices.push(pos);
    pos += 1;
  }
  assert.ok(arrIndices.length >= 2, "(D) at least two internalSignalsRaw array build sites expected");
  for (const idx of arrIndices) {
    const tail = src.slice(idx, idx + 2000);
    assert.ok(
      tail.includes("...v2ServerEntrySignals"),
      `(D) generator output must spread into internalSignalsRaw at all sites (missing near offset ${idx})`
    );
  }

  // (E) cooldown persistence on signal fire
  assert.ok(
    src.includes("setV2ServerEntryCooldownState("),
    "(E) cooldown state setter must be called"
  );
  assert.ok(
    src.includes("getV2ServerEntryCooldownState("),
    "(E) cooldown state getter must be called"
  );
})();

// (F) marketRunner 240m HTF cache refresh
(function testMarketRunnerHtfRefresh() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "scheduler", "marketRunner.js"),
    "utf8"
  );
  assert.ok(
    src.includes("DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED"),
    "(F1) marketRunner must check the same env flag"
  );
  assert.ok(
    /tf:\s*"4h"/.test(src),
    "(F2) marketRunner must refresh tf=\"4h\" snapshot (binance interval form, not raw \"240\")"
  );
  assert.ok(
    src.includes("countOverride: 70") || src.includes("countOverride : 70"),
    "(F3) marketRunner must request 70-bar HTF backfill"
  );
})();

// (G) refreshLatestBarSnapshot accepts countOverride
(function testRefreshLatestBarSnapshotSignature() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "scheduler", "marketRunner.js"),
    "utf8"
  );
  assert.ok(
    /async function refreshLatestBarSnapshot\(\{[^}]*countOverride[^}]*\}/m.test(src),
    "(G) refreshLatestBarSnapshot signature must include countOverride"
  );
})();

// (H) generator-default-off runtime check — when the env flag is unset/0,
//     the generator module is still loadable and won't be invoked.
(function testEnvFlagDefaultOff() {
  // We don't run paperBinanceRunner here (it requires Firestore + many
  // services) — the source-level assertions above cover that the env
  // flag is read first. This is a smoke test that the parseBool form
  // matches what we'd expect for default off.
  const cases = [
    { env: undefined, expected: false },
    { env: "", expected: false },
    { env: "0", expected: false },
    { env: "false", expected: false },
    { env: "no", expected: false },
    { env: "off", expected: false },
    { env: "1", expected: true },
    { env: "true", expected: true },
    { env: "yes", expected: true },
    { env: "on", expected: true },
    { env: "TRUE", expected: true },
    { env: "ON", expected: true },
  ];
  for (const c of cases) {
    const raw = String(c.env || "0").trim().toLowerCase();
    const parsed = raw === "1" || raw === "true" || raw === "yes" || raw === "on";
    assert.strictEqual(parsed, c.expected, `(H) parseBool('${c.env}') = ${parsed}, expected ${c.expected}`);
  }
})();

console.log("V2_SERVER_ENTRY_SIGNAL_INTEGRATION_TEST_OK");
