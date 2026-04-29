"use strict";

// 2026-04-29 P1-1.2 — second stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Five qty/budget calculation helpers plus the POS_SIZE_EPSILON
// constant that they (and ~25 other call sites in the runner) all
// share. They are pure: no I/O, no async, no module-level state
// beyond the env-resolved POS_SIZE_EPSILON, no broker/Firestore
// access. The runner used to host them inline at lines 3372-3443
// of paperBinanceRunner.js (20 704 LOC) — moving them out is a
// surgical seam, not a behaviour change.
//
// Why this group is the next cohesive unit after P1-1.1's bar/TF
// helpers: the five functions only call each other and `clamp`
// (re-implemented locally, identical semantics to runner's
// `clamp`). They form a pre-existing "qty fraction algebra":
//
//   resolveLogicalCurrentQtyPctForBudget   — KRW budget → 0..1
//   resolveCurrentQtyPctForCap             — state.currentQtyPct or fallback
//   resolveLiveExitCurrentQtyPct           — broker-side live qty pct
//   resolveIntentFillCloseRatio            — fill qty → close ratio
//   resolveSyncedAddChainBaseQtyPct        — add-chain base qty pct
//
// `paperBinanceRunner.js` re-exports the same names through its
// `__test` surface and module.exports so existing tests
// (live-rescue-add-plan.test.js — 5 direct refs at lines 14, 15,
// 16, 646, 650, 659, 825, 826, 1022, 1033) keep working
// unchanged. Identity-equality is preserved (the runner imports
// the same function references; it does not re-implement).

// Local clamp — identical to paperBinanceRunner.clamp. Inlined
// rather than imported to keep this module a leaf with no
// internal-engine dependencies.
function clamp(num, min, max) {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// POS_SIZE_EPSILON — the "treat as zero" floor for fractional
// position-size comparisons. Operator-tunable via env; default
// 0.0001 (1bp). Resolved once at module load, identical semantics
// to paperBinanceRunner's previous inline definition.
const POS_SIZE_EPSILON = (() => {
  const raw = Number(process.env.POS_SIZE_EPSILON);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 0.0001;
})();

// resolveCurrentQtyPctForCap — pick state.currentQtyPct if it is
// a finite number, else the caller's fallback (default 0). Used
// by the logical-add-cap evaluator: when no state has been
// recorded yet we cap against the caller's intended size, not 0.
function resolveCurrentQtyPctForCap(state, fallbackQtyPct = 0) {
  if (state && typeof state === "object") {
    const qtyPct = Number(state.currentQtyPct);
    if (Number.isFinite(qtyPct)) return qtyPct;
  }
  const fallback = Number(fallbackQtyPct);
  return Number.isFinite(fallback) ? fallback : 0;
}

// resolveLogicalCurrentQtyPctForBudget — KRW budget → fraction in
// [0,1]. Returns null when either max or used is non-finite or
// non-positive (no budget recorded yet); callers fall back to the
// state-based qty pct.
function resolveLogicalCurrentQtyPctForBudget({
  budgetMaxKrw,
  budgetUsedKrw,
} = {}) {
  const max = Number(budgetMaxKrw);
  const used = Number(budgetUsedKrw);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(used) || used <= 0) return null;
  return clamp(used / max, 0, 1);
}

// resolveLiveExitCurrentQtyPct — caller-supplied position +
// exchange → 0..1 fraction representing how much of the original
// notional is currently live. On Binance we trust the budget
// counters (KRW used / KRW max); for other exchanges we fall
// straight through to the caller's fallback. Returns null when
// neither path produces a usable number, so callers can short-
// circuit instead of misclosing.
function resolveLiveExitCurrentQtyPct({
  exchange,
  position,
  fallbackQtyPct,
} = {}) {
  const ex = String(exchange || "").toUpperCase();
  const pos = position && typeof position === "object" ? position : {};
  if (ex.includes("BINANCE")) {
    const logicalQtyPct = resolveLogicalCurrentQtyPctForBudget({
      budgetMaxKrw: pos.budget_max_krw,
      budgetUsedKrw: pos.budget_used_krw,
    });
    if (Number.isFinite(logicalQtyPct) && logicalQtyPct > POS_SIZE_EPSILON) {
      return clamp(logicalQtyPct, POS_SIZE_EPSILON, 1);
    }
  }
  const fallback = Number(fallbackQtyPct);
  if (Number.isFinite(fallback) && fallback > POS_SIZE_EPSILON) {
    return clamp(fallback, POS_SIZE_EPSILON, 1);
  }
  return null;
}

// resolveIntentFillCloseRatio — translate a fill-intent
// qtyFraction into a close-ratio in [0,1]. When useBudget is
// true the caller's qty is already an absolute budget fraction
// (e.g. "close 50% of total budget"), so we clamp and return.
// Otherwise qty is a delta against prevSize, so we divide.
function resolveIntentFillCloseRatio({
  qtyFraction,
  prevSize,
  useBudget,
} = {}) {
  const qty = Number(qtyFraction);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (useBudget === true) return Math.max(0, Math.min(1, qty));
  const current = Number(prevSize);
  if (Number.isFinite(current) && current > 0) {
    return Math.max(0, Math.min(1, qty / current));
  }
  return Math.max(0, Math.min(1, qty));
}

// resolveSyncedAddChainBaseQtyPct — back-compute the original
// entry-leg qty pct from the current logical qty pct and the
// add-chain count: base × (1 + addCount) = current. Used by the
// position-sync rebuild path so a restart can reconstruct the
// chain's first-leg size from broker truth. Returns null when
// inputs are insufficient (no budget yet, no chain active, or
// math collapses below epsilon).
function resolveSyncedAddChainBaseQtyPct({
  active,
  posMeta,
  budgetMaxKrw,
  budgetUsedKrw,
} = {}) {
  if (!active) return null;
  const currentQtyPct = resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw, budgetUsedKrw });
  if (!Number.isFinite(currentQtyPct) || currentQtyPct <= POS_SIZE_EPSILON) return null;
  const addCountRaw = Number(posMeta && posMeta.add_chain_count);
  const addCount = Number.isFinite(addCountRaw) ? Math.max(0, Math.trunc(addCountRaw)) : 0;
  const baseQtyPct = currentQtyPct / (1 + addCount);
  if (!Number.isFinite(baseQtyPct) || baseQtyPct <= POS_SIZE_EPSILON) return null;
  return Math.min(1, baseQtyPct);
}

module.exports = {
  POS_SIZE_EPSILON,
  resolveCurrentQtyPctForCap,
  resolveLogicalCurrentQtyPctForBudget,
  resolveLiveExitCurrentQtyPct,
  resolveIntentFillCloseRatio,
  resolveSyncedAddChainBaseQtyPct,
};
