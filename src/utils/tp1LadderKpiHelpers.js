"use strict";

// 2026-04-29 P1-1.17 — seventeenth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Four pure helpers covering the TP1-ladder KPI snapshot data
// model (the structured statistics the runner reads out of
// performance_kpi_upgrade_contract.json to gate aggressive vs.
// base TP1 ladder profile selection):
//
//   unwrapSummaryRecord            raw → raw.summary || raw
//                                  (handle the two summary
//                                  envelope shapes the contract
//                                  file emits across versions)
//   normalizeTp1LadderKpiRecord    raw → typed snapshot object
//                                  with fixed numeric fields and
//                                  uppercased status; null when
//                                  input is not an object.
//   buildTp1LadderKpiScopeMap      raw object/array + scope
//                                  ("MARKET"|"COHORT") → Map of
//                                  normalized records keyed by
//                                  uppercased market or canonical
//                                  cohort string
//   resolveTp1LadderKpiForContext  given a snapshot and a
//                                  { market, cohort } context,
//                                  return { scope, kpi } picking
//                                  market over cohort over global
//
// Pure functions: object-property reads + Map construction. Self-
// contained call graph among the four; depends on the already-
// extracted `normalizeOpenClawCohort` (P1-1.10) for cohort key
// canonicalization. The runner used to host them inline at lines
// 842, 848, 862, 887. The async loader
// `loadTp1LadderKpiSnapshot` (line 903) is NOT extracted because
// it uses fs.statSync / fs.readFileSync + module-level cache —
// it stays in the runner.
//
// Why this group is the next safe cohesive unit after P1-1.16:
//   - Tightest semantic cohesion remaining at this extraction
//     tier — all four answer "given the KPI contract file's
//     payload, produce a snapshot the runner can ask 'should
//     this market/cohort run aggressive TP1?' against".
//   - Already covered by src/tests/tp1-ladder-kpi-scope.test.js
//     (lines 7, 37-51) via the runner's __test surface — that
//     integration test continues to pass unchanged because the
//     runner re-exports the SAME function reference (no fork).
//   - Two-envelope handling (raw vs. raw.summary) is a pre-
//     existing migration contract; pinning it in a named module
//     makes the contract auditable.

const { normalizeOpenClawCohort } = require("./openClawCohort");

// unwrapSummaryRecord — handle the dual envelope shape: either
// the file holds a top-level summary, or a nested { summary: {…} }
// wrapper. Returns the inner object in either case, or null on
// non-object input.
function unwrapSummaryRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.summary && typeof raw.summary === "object") return raw.summary;
  return raw;
}

// normalizeTp1LadderKpiRecord — canonical snapshot object the
// runner consumes downstream. Status is uppercased; numeric fields
// are coerced once via Number() (downstream callers Number.isFinite
// gate them). Field aliases handled: realized_trade_n /
// realized_n, tp0_to_tp1_conversion_rate / tp0_to_tp1_conversion.
function normalizeTp1LadderKpiRecord(raw = null) {
  const safe = unwrapSummaryRecord(raw) || raw;
  if (!safe || typeof safe !== "object") return null;
  const snapshot = {
    status: String(safe.status || "").trim().toUpperCase() || null,
    realized_n: Number(safe.realized_trade_n ?? safe.realized_n),
    tp0_hit_rate: Number(safe.tp0_hit_rate),
    tp1_hit_rate: Number(safe.tp1_hit_rate),
    tp0_to_tp1_conversion: Number(safe.tp0_to_tp1_conversion_rate ?? safe.tp0_to_tp1_conversion),
    fee_adjusted_expectancy: Number(safe.fee_adjusted_expectancy),
  };
  return snapshot;
}

// buildTp1LadderKpiScopeMap — accept either an array of records
// or a {key: record} object; produce a Map keyed by uppercased
// market symbol (when scope=="MARKET") or by canonical cohort
// string (otherwise). Records that fail normalization or have
// blank keys are silently dropped — the runner falls back to the
// global snapshot when no scoped record matches.
function buildTp1LadderKpiScopeMap(raw = null, scope = "MARKET") {
  const result = new Map();
  const addEntry = (scopeKey, record) => {
    const normalizedKey = scope === "MARKET"
      ? String(scopeKey || "").trim().toUpperCase()
      : normalizeOpenClawCohort(scopeKey);
    if (!normalizedKey) return;
    const normalizedRecord = normalizeTp1LadderKpiRecord(record);
    if (!normalizedRecord) return;
    result.set(normalizedKey, normalizedRecord);
  };
  if (!raw || typeof raw !== "object") return result;
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      addEntry(scope === "MARKET" ? row.market : row.cohort, row);
    }
    return result;
  }
  for (const [key, value] of Object.entries(raw)) {
    addEntry(key, value);
  }
  return result;
}

// resolveTp1LadderKpiForContext — pick MARKET → COHORT → GLOBAL
// in that priority. The scope name in the return tells callers
// which axis matched so log lines can attribute the decision
// correctly.
function resolveTp1LadderKpiForContext(snapshot = null, { market = null, cohort = null } = {}) {
  const safe = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!safe) return { scope: "GLOBAL", kpi: null };
  const marketKey = String(market || "").trim().toUpperCase();
  if (marketKey && safe.byMarket instanceof Map) {
    const marketSnapshot = safe.byMarket.get(marketKey);
    if (marketSnapshot) return { scope: "MARKET", kpi: marketSnapshot };
  }
  const cohortKey = normalizeOpenClawCohort(cohort);
  if (cohortKey && safe.byCohort instanceof Map) {
    const cohortSnapshot = safe.byCohort.get(cohortKey);
    if (cohortSnapshot) return { scope: "COHORT", kpi: cohortSnapshot };
  }
  return { scope: "GLOBAL", kpi: safe.global || null };
}

module.exports = {
  unwrapSummaryRecord,
  normalizeTp1LadderKpiRecord,
  buildTp1LadderKpiScopeMap,
  resolveTp1LadderKpiForContext,
};
