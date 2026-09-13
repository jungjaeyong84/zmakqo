"use strict";

// src/research/hypothesisRegistry.js — confirmation windows that cannot be backdated (2026-09-13).
//
// WHY THIS EXISTS
// ---------------
// Every verdict in this project has been rendered on roughly one quarter of
// data, and three months of crypto is one regime. That is why conclusions kept
// reversing: v8's "information is market timing, not cross-sectional" survived
// exactly until someone recomputed it with the right statistic.
//
// The specific failure mode this file blocks is subtler than a small sample.
// It is judging a hypothesis on the data that produced it. Searching a window,
// finding a pattern, then reporting that pattern's performance ON THAT WINDOW
// is not evidence — and after the fact it is nearly impossible to reconstruct
// whether a rule was fixed before or after the author saw the result.
//
// So the window is fixed in writing, in advance, and the file refuses to let
// it move:
//
//   1. confirmation_starts_at must be >= the moment of registration.
//      You cannot register a hypothesis today and claim its confirmation
//      window opened last quarter.
//   2. registered_at and confirmation_starts_at are immutable once written.
//      Re-registering the same id with different dates throws.
//   3. An outcome cannot be recorded before confirmation_starts_at has
//      actually arrived. Success cannot be declared on discovery data.
//   4. Every entry carries a hash over its immutable fields, so hand-editing
//      the JSON is detectable by validateRegistry().
//
// The registry stores intent, not results. What a hypothesis has to clear when
// its window opens lives in src/research/staticBenchmarkGate.js.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// `rationale` is immutable for the same reason the dates are. It carries the
// evidence that justified registration, and it is the field a later reader uses
// to judge whether the hypothesis should ever have been opened. Leaving it
// mutable meant the one field that records WHY could be rewritten without
// detection — found on 2026-09-14 when a registered entry turned out to carry
// figures from a construction that was not the one later frozen, and nothing in
// the module would have stopped that being quietly corrected.
//
// Consequence, and it is the intended one: evidence cannot be revised in place.
// A hypothesis whose justification changes is a different hypothesis and needs a
// new id, leaving the original visible with its own outcome.
const IMMUTABLE_FIELDS = ["id", "title", "rationale", "discovered_on", "registered_at", "confirmation_starts_at"];

// Bumped when the payload encoding or the field set changes, so old hashes fail
// loudly as "tampered" rather than being silently compared across formats.
//   v2 -> v3 : rationale brought under the hash
const HASH_PAYLOAD_VERSION = "v3";

function entryHash(entry) {
  // JSON-encode the values as an array. Field boundaries have to be
  // unambiguous: a plain concatenation makes {id:"ab", title:"c"} and
  // {id:"a", title:"bc"} hash identically, which would let an id be edited
  // without detection. JSON does that without smuggling a control byte into
  // a source file — an earlier revision used a NUL separator here, which git
  // then classified the whole module as binary.
  const values = IMMUTABLE_FIELDS.map((f) => (entry[f] === null || entry[f] === undefined ? "" : String(entry[f])));
  const payload = JSON.stringify([HASH_PAYLOAD_VERSION, ...values]);
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function readRegistry(registryPath) {
  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.hypotheses)) return { version: 1, hypotheses: [] };
    return parsed;
  } catch (_) {
    return { version: 1, hypotheses: [] };
  }
}

function writeRegistry(registryPath, doc) {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(doc, null, 2)}\n`);
}

function parseTs(value, field) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`HYPOTHESIS_REGISTRY_BAD_DATE: ${field}=${value}`);
  return ms;
}

/**
 * Register a hypothesis with a confirmation window that opens no earlier than now.
 * Re-registering an existing id is allowed ONLY if every immutable field matches
 * (idempotent re-run); any difference throws rather than silently rewriting history.
 */
function registerHypothesis({
  registryPath,
  id,
  title,
  rationale = "",
  discoveredOn,
  confirmationStartsAt,
  gate = {},
  now = new Date(),
} = {}) {
  if (!registryPath) throw new Error("HYPOTHESIS_REGISTRY_PATH_REQUIRED");
  if (!id || !title) throw new Error("HYPOTHESIS_REGISTRY_ID_AND_TITLE_REQUIRED");

  const nowMs = now instanceof Date ? now.getTime() : parseTs(now, "now");
  const startMs = parseTs(confirmationStartsAt, "confirmationStartsAt");
  if (startMs < nowMs) {
    throw new Error(
      `HYPOTHESIS_REGISTRY_BACKDATED_WINDOW: confirmation_starts_at ${new Date(startMs).toISOString()} is before registration ${new Date(nowMs).toISOString()}`
    );
  }
  if (discoveredOn) parseTs(discoveredOn, "discoveredOn");

  const doc = readRegistry(registryPath);
  const entry = {
    id: String(id),
    title: String(title),
    rationale: String(rationale),
    discovered_on: discoveredOn ? new Date(parseTs(discoveredOn, "discoveredOn")).toISOString() : null,
    registered_at: new Date(nowMs).toISOString(),
    confirmation_starts_at: new Date(startMs).toISOString(),
    gate: {
      requires_static_benchmark: true,
      ...gate,
    },
    outcome: null,
  };
  entry.hash = entryHash(entry);

  const existing = doc.hypotheses.find((h) => h.id === entry.id);
  if (existing) {
    const drift = IMMUTABLE_FIELDS.filter((f) => String(existing[f] || "") !== String(entry[f] || ""));
    if (drift.length) {
      throw new Error(`HYPOTHESIS_REGISTRY_IMMUTABLE_FIELD_CHANGED: ${entry.id} [${drift.join(", ")}]`);
    }
    return { registered: false, unchanged: true, entry: existing };
  }

  doc.hypotheses.push(entry);
  doc.updated_at = new Date(nowMs).toISOString();
  writeRegistry(registryPath, doc);
  return { registered: true, unchanged: false, entry };
}

/**
 * Record what happened. Refuses while the confirmation window is still in the
 * future — that is the whole point: no declaring success on discovery data.
 */
function recordOutcome({ registryPath, id, outcome, evidence = "", now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : parseTs(now, "now");
  const doc = readRegistry(registryPath);
  const entry = doc.hypotheses.find((h) => h.id === id);
  if (!entry) throw new Error(`HYPOTHESIS_REGISTRY_UNKNOWN_ID: ${id}`);

  const allowed = ["CONFIRMED", "REJECTED", "INCONCLUSIVE", "WITHDRAWN"];
  if (!allowed.includes(outcome)) {
    throw new Error(`HYPOTHESIS_REGISTRY_BAD_OUTCOME: ${outcome} (expected ${allowed.join("|")})`);
  }

  // Rejection and confirmation are NOT symmetric, and the first version of this
  // file did not implement that. A hypothesis that already fails on the data
  // that produced it will not start working out of sample, so rejecting early
  // is sound. Claiming success early is the thing that has to be barred.
  //
  // Early rejections are stamped in_sample so a reader can tell them from a
  // rejection that actually survived to the confirmation window.
  const startMs = parseTs(entry.confirmation_starts_at, "confirmation_starts_at");
  const windowOpen = nowMs >= startMs;
  const REJECTION_LIKE = ["REJECTED", "WITHDRAWN"];
  if (!windowOpen && !REJECTION_LIKE.includes(outcome)) {
    throw new Error(
      `HYPOTHESIS_REGISTRY_WINDOW_NOT_OPEN: ${id} cannot record ${outcome} before ${entry.confirmation_starts_at} (now ${new Date(nowMs).toISOString()}); only ${REJECTION_LIKE.join("/")} may be recorded early`
    );
  }
  if (!windowOpen && !String(evidence).trim()) {
    throw new Error(`HYPOTHESIS_REGISTRY_EARLY_REJECTION_NEEDS_EVIDENCE: ${id}`);
  }

  entry.outcome = {
    verdict: outcome,
    evidence: String(evidence),
    recorded_at: new Date(nowMs).toISOString(),
    in_sample: !windowOpen,
  };
  doc.updated_at = new Date(nowMs).toISOString();
  writeRegistry(registryPath, doc);
  return entry;
}

function listHypotheses({ registryPath, now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : parseTs(now, "now");
  const doc = readRegistry(registryPath);
  return doc.hypotheses.map((h) => {
    const startMs = Date.parse(h.confirmation_starts_at);
    return {
      ...h,
      window_open: Number.isFinite(startMs) ? nowMs >= startMs : false,
      days_until_open: Number.isFinite(startMs) ? Math.max(0, Math.ceil((startMs - nowMs) / 86400000)) : null,
    };
  });
}

/** Detect hand-edits to any immutable field. */
function validateRegistry({ registryPath } = {}) {
  const doc = readRegistry(registryPath);
  const tampered = [];
  const seen = new Set();
  const duplicates = [];
  for (const h of doc.hypotheses) {
    if (seen.has(h.id)) duplicates.push(h.id);
    seen.add(h.id);
    if (h.hash !== entryHash(h)) tampered.push(h.id);
  }
  return { ok: tampered.length === 0 && duplicates.length === 0, count: doc.hypotheses.length, tampered, duplicates };
}

module.exports = {
  registerHypothesis,
  recordOutcome,
  listHypotheses,
  validateRegistry,
  readRegistry,
  entryHash,
  IMMUTABLE_FIELDS,
};
