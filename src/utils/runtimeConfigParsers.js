"use strict";

// 2026-04-29 P1-1.6 — sixth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Four operator-runtime-config value parsers:
//
//   splitRuntimeList            — comma/pipe/space-delimited list →
//                                 deduped uppercase array
//   positiveNumberOrNull        — number coerce; > 0 or null
//   isUnlimitedRuntimeLimit     — UNLIMITED | INF | INFINITY | *
//   positiveNumberOrUnlimited   — composition of the above two
//
// Pure functions: string/number coercion only, no I/O, no async,
// no module-level state. They are the parsing side of the
// operator's runtime configuration surface (env vars + Firestore
// system_settings rows that carry "max bars", "max minutes",
// "allowed exchanges", etc.). The runner used to host them inline
// at lines 6003, 6010, 6015, 6020.
//
// Why this group is the next safe cohesive unit after P1-1.5:
//   - Tight cohesion (positiveNumberOrUnlimited composes the
//     other two).
//   - Zero external callers (verified by grep on 2026-04-29).
//   - The parser surface for runtime-limit values is a pre-existing
//     contract — "UNLIMITED" / "INF" / "INFINITY" / "*" all map to
//     the same sentinel. Pinning that contract in a named module
//     prevents accidental drift when more callers want the same
//     parser later (instead of copy-pasting yet another sibling).

// splitRuntimeList — split a comma-, pipe-, or whitespace-
// delimited list into a normalized array. Each entry is trimmed,
// uppercased, and deduplication is NOT applied here (caller
// chooses if they want unique elements; the runner's call sites
// don't currently need a Set, and Set semantics would change
// iteration order).
function splitRuntimeList(raw) {
  return String(raw || "")
    .split(/[,\|\s]+/)
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean);
}

// positiveNumberOrNull — coerce to number; if finite and strictly
// positive, return it; otherwise null. Used by callers that need
// to distinguish "no limit configured" from "limit is 0".
function positiveNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

// isUnlimitedRuntimeLimit — recognize the operator's "no limit"
// sentinel strings. Case-insensitive. Recognizes "UNLIMITED",
// "INF", "INFINITY", "*". Anything else returns false.
function isUnlimitedRuntimeLimit(value) {
  const raw = String(value == null ? "" : value).trim().toUpperCase();
  return raw === "UNLIMITED" || raw === "INF" || raw === "INFINITY" || raw === "*";
}

// positiveNumberOrUnlimited — compose the previous two.
// "UNLIMITED"-style → the literal string "UNLIMITED".
// Otherwise positiveNumberOrNull(value).
function positiveNumberOrUnlimited(value) {
  if (isUnlimitedRuntimeLimit(value)) return "UNLIMITED";
  return positiveNumberOrNull(value);
}

module.exports = {
  splitRuntimeList,
  positiveNumberOrNull,
  isUnlimitedRuntimeLimit,
  positiveNumberOrUnlimited,
};
