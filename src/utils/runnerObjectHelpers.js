"use strict";

// 2026-04-29 P1-1.21 — twenty-first stateless-helper extraction
// from src/engine/paperBinanceRunner.js.
//
// Four generic object/value micro-utilities historically inline
// at paperBinanceRunner.js lines 4559-4585. Each is too small to
// deserve its own module, similar in spirit to P1-1.13
// (runnerScalarHelpers); bundling them removes top-of-file
// clutter from the runner.
//
//   hasPositionSize       finite > POS_SIZE_EPSILON predicate;
//                         the canonical "this position is
//                         considered live" gate
//   mergeMeta             shallow merge of two meta objects;
//                         drops undefined values from patch
//                         (preserves existing base values when
//                         patch is partial)
//   trimTextOrNull        empty-string → null; non-string → null
//                         after String coercion+trim
//   numOrNull             finite-number-or-null coercion;
//                         distinguishes "no value provided"
//                         (null/undefined/"") from "value
//                         provided but unparsable" (NaN-like)
//
// Pure functions. The runner used to host them inline. Composes
// the already-extracted POS_SIZE_EPSILON from
// src/utils/qtyCalculation (P1-1.2).
//
// AUDIT NOTE: numOrNull has 1 inline-arrow-function sibling at
// src/v2/v1MetaMirror.js:89 declared inside a closure. NOT a
// straight-forward sibling consolidation candidate (it lives
// inside another function's scope, not at module level), so
// the canonical migration story for that one is "leave it for
// the v1MetaMirror refactor pass" rather than the standard
// sibling-consolidation flow.

const { POS_SIZE_EPSILON } = require("./qtyCalculation");

// hasPositionSize — true iff sizePct is a finite number strictly
// greater than POS_SIZE_EPSILON. The canonical "is this position
// live" gate used by the runner's exit decision flow.
function hasPositionSize(sizePct) {
  const n = Number(sizePct);
  if (!Number.isFinite(n)) return false;
  return n > POS_SIZE_EPSILON;
}

// mergeMeta — shallow merge: returns a new object with `base`
// keys plus `patch` keys, where `undefined` values in patch are
// dropped (so callers can pass `{ field: maybeUndef }` without
// nulling the prior value). null and 0 and "" pass through —
// only `undefined` is treated as "no change".
function mergeMeta(base, patch) {
  const out = (base && typeof base === "object") ? { ...base } : {};
  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      out[k] = v;
    }
  }
  return out;
}

// trimTextOrNull — coerce to string, trim, return null on empty.
// Used by alert payload builders that want "either a non-empty
// string or null", not "an empty string sometimes".
function trimTextOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

// numOrNull — distinguish "no value" from "unparsable". null,
// undefined, "" → null (no value provided). Anything else gets
// Number()-coerced; finite → return; non-finite → null.
function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

module.exports = {
  hasPositionSize,
  mergeMeta,
  trimTextOrNull,
  numOrNull,
};
