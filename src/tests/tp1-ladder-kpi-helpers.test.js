"use strict";

// 2026-04-29 P1-1.17 — TP1-ladder KPI helper extraction tests.
//
// Pre-existing integration test tp1-ladder-kpi-scope.test.js
// continues to exercise the runner-internal call sites; this file
// pins the contract at the unit level.

const assert = require("assert");

delete require.cache[require.resolve("../utils/tp1LadderKpiHelpers")];
const {
  unwrapSummaryRecord,
  normalizeTp1LadderKpiRecord,
  buildTp1LadderKpiScopeMap,
  resolveTp1LadderKpiForContext,
} = require("../utils/tp1LadderKpiHelpers");

// ── (A) unwrapSummaryRecord ─────────────────────────────────────
(function testUnwrap() {
  // Top-level (no envelope).
  assert.deepStrictEqual(
    unwrapSummaryRecord({ status: "OK", n: 10 }),
    { status: "OK", n: 10 },
    "(A1) top-level pass-through"
  );
  // Envelope shape.
  assert.deepStrictEqual(
    unwrapSummaryRecord({ summary: { status: "OK" } }),
    { status: "OK" },
    "(A2) summary envelope unwrapped"
  );
  // Falsy.
  assert.strictEqual(unwrapSummaryRecord(null), null, "(A3) null");
  assert.strictEqual(unwrapSummaryRecord(undefined), null, "(A4) undefined");
  assert.strictEqual(unwrapSummaryRecord("string"), null, "(A5) non-object");
  // summary that is non-object falls through to raw.
  assert.deepStrictEqual(
    unwrapSummaryRecord({ summary: "not-object", status: "OK" }),
    { summary: "not-object", status: "OK" },
    "(A6) non-object summary falls through"
  );
})();

// ── (B) normalizeTp1LadderKpiRecord ─────────────────────────────
(function testNormalizeRecord() {
  // Basic shape.
  const out = normalizeTp1LadderKpiRecord({
    status: "ok",
    realized_trade_n: 100,
    tp0_hit_rate: 0.6,
    tp1_hit_rate: 0.4,
    tp0_to_tp1_conversion_rate: 0.7,
    fee_adjusted_expectancy: 0.012,
  });
  assert.strictEqual(out.status, "OK", "(B1) status uppercased");
  assert.strictEqual(out.realized_n, 100, "(B2) realized_trade_n → realized_n");
  assert.strictEqual(out.tp0_hit_rate, 0.6, "(B3) tp0_hit_rate");
  assert.strictEqual(out.tp1_hit_rate, 0.4, "(B4) tp1_hit_rate");
  assert.strictEqual(out.tp0_to_tp1_conversion, 0.7, "(B5) conversion alias");
  assert.strictEqual(out.fee_adjusted_expectancy, 0.012, "(B6) fee_adjusted_expectancy");
  // Field aliases: realized_n direct.
  const aliasOut = normalizeTp1LadderKpiRecord({ realized_n: 50 });
  assert.strictEqual(aliasOut.realized_n, 50, "(B7) realized_n direct");
  // Envelope unwrap.
  const wrapped = normalizeTp1LadderKpiRecord({ summary: { status: "active", realized_n: 5 } });
  assert.strictEqual(wrapped.status, "ACTIVE", "(B8) envelope unwrapped + status uppercased");
  assert.strictEqual(wrapped.realized_n, 5, "(B9) envelope payload normalized");
  // null/empty.
  assert.strictEqual(normalizeTp1LadderKpiRecord(null), null, "(B10) null");
  assert.strictEqual(normalizeTp1LadderKpiRecord(""), null, "(B11) empty string");
})();

// ── (C) buildTp1LadderKpiScopeMap (MARKET scope) ───────────────
(function testScopeMapMarket() {
  // Object input.
  const m = buildTp1LadderKpiScopeMap({
    BTCUSDT: { realized_n: 100, status: "ok" },
    ETHUSDT: { realized_n: 50, status: "ok" },
  }, "MARKET");
  assert.strictEqual(m.size, 2, "(C1) two markets");
  assert.strictEqual(m.get("BTCUSDT").realized_n, 100, "(C2) BTC entry");
  assert.strictEqual(m.get("ETHUSDT").status, "OK", "(C3) ETH status uppercased");
  // Array input with `market` field.
  const arr = buildTp1LadderKpiScopeMap([
    { market: "BTCUSDT", realized_n: 200 },
    { market: "ETHUSDT", realized_n: 80 },
  ], "MARKET");
  assert.strictEqual(arr.get("BTCUSDT").realized_n, 200, "(C4) array with market field");
  // Empty / non-object.
  assert.strictEqual(buildTp1LadderKpiScopeMap(null, "MARKET").size, 0, "(C5) null → empty Map");
  assert.strictEqual(buildTp1LadderKpiScopeMap("garbage", "MARKET").size, 0, "(C6) string → empty Map");
})();

// ── (D) buildTp1LadderKpiScopeMap (COHORT scope) ───────────────
(function testScopeMapCohort() {
  // Cohort key normalization via normalizeOpenClawCohort.
  const m = buildTp1LadderKpiScopeMap({
    rescue: { realized_n: 100 },
    MIXED: { realized_n: 50 },
    "unknown-cohort": { realized_n: 20 },
  }, "COHORT");
  assert.strictEqual(m.has("RESCUE"), true, "(D1) rescue normalized");
  assert.strictEqual(m.has("MIXED"), true, "(D2) MIXED preserved");
  assert.strictEqual(
    m.has("unknown-cohort"),
    false,
    "(D3) unknown cohort dropped (normalizeOpenClawCohort returns null)"
  );
})();

// ── (E) resolveTp1LadderKpiForContext priority ─────────────────
(function testResolveContext() {
  const snapshot = {
    global: { realized_n: 1000 },
    byMarket: new Map([["BTCUSDT", { realized_n: 100 }]]),
    byCohort: new Map([["RESCUE", { realized_n: 50 }]]),
  };
  // Market wins over cohort.
  const r1 = resolveTp1LadderKpiForContext(snapshot, { market: "BTCUSDT", cohort: "RESCUE" });
  assert.strictEqual(r1.scope, "MARKET", "(E1) market wins");
  assert.strictEqual(r1.kpi.realized_n, 100, "(E2) market kpi");
  // Cohort fallback when market missing.
  const r2 = resolveTp1LadderKpiForContext(snapshot, { market: "ETHUSDT", cohort: "RESCUE" });
  assert.strictEqual(r2.scope, "COHORT", "(E3) cohort fallback");
  assert.strictEqual(r2.kpi.realized_n, 50, "(E4) cohort kpi");
  // Global fallback when both miss.
  const r3 = resolveTp1LadderKpiForContext(snapshot, { market: "ETHUSDT", cohort: "MIXED" });
  assert.strictEqual(r3.scope, "GLOBAL", "(E5) global fallback");
  assert.strictEqual(r3.kpi.realized_n, 1000, "(E6) global kpi");
  // null snapshot.
  assert.deepStrictEqual(
    resolveTp1LadderKpiForContext(null, { market: "BTCUSDT" }),
    { scope: "GLOBAL", kpi: null },
    "(E7) null snapshot → GLOBAL/null"
  );
  // Empty market/cohort → global.
  const r4 = resolveTp1LadderKpiForContext(snapshot);
  assert.strictEqual(r4.scope, "GLOBAL", "(E8) no context → global");
})();

// ── (F) paperBinanceRunner __test re-exports ──────────────────
(function testPaperRunnerReExports() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const { __test: paperTest } = require("../engine/paperBinanceRunner");
  assert.strictEqual(paperTest.resolveTp1LadderKpiForContext, resolveTp1LadderKpiForContext,
    "(F1) same ref for resolveTp1LadderKpiForContext");
})();

console.log("TP1_LADDER_KPI_HELPERS_TEST_OK");
