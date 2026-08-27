"use strict";

// src/v3/deadmanCheck.js — pipeline heartbeat verdicts (2026-07-16).
//
// "Silence is not success": every v3 cycle rewrites its daily artifact each
// tick regardless of market activity, so artifact age IS pipeline liveness.
// This module turns a set of artifact descriptors into stale/healthy
// verdicts; the runner alerts on transitions (via opsAlert) and re-alerts
// every 6h while stale.
//
// HONEST LIMIT (documented, not solved): this watchdog runs on the same
// machine under the same launchd. It catches every partial death (one job
// wedged, disk full, keys revoked → cycles stop updating artifacts) but NOT
// whole-machine death (power off, lid closed). Whole-machine coverage needs
// an off-machine observer, which is out of scope for a local-primary stack.

const fs = require("fs");

function artifactAgeMs(filePath, nowMs = Date.now()) {
  // Prefer the artifact's own generated_at (content truth); fall back to
  // file mtime (covers artifacts without the field); null = missing file.
  try {
    const stat = fs.statSync(filePath);
    let ts = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const g = Date.parse(parsed.generated_at || parsed.checked_at || "");
      if (Number.isFinite(g)) ts = g;
    } catch (_) { /* unreadable JSON → mtime */ }
    if (ts === null) ts = stat.mtimeMs;
    return Math.max(0, nowMs - ts);
  } catch (_) {
    return null; // missing = worst kind of stale
  }
}

// descriptors: [{ name, path, max_age_ms }]
// 2026-08-27 — freshness alone is not liveness.
//
// A 25-hour v7 outage went completely unnoticed. Both the collector and the
// lane ran on schedule, every one of their network calls failed, and both
// still exited 0 and wrote a fresh artifact reporting the failures in a field
// nothing read. Age-only checking saw a recent mtime and called it healthy —
// so total failure was indistinguishable from normal operation, which is the
// one thing a deadman exists to prevent.
//
// A descriptor may now name a `degraded` predicate over the artifact's parsed
// contents. Age still decides liveness; this decides whether the work the
// heartbeat claims to represent actually happened.
function readArtifact(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) { return null; }
}

function checkArtifacts(descriptors = [], nowMs = Date.now(), ageFn = artifactAgeMs) {
  const stale = [];
  const healthy = [];
  for (const d of Array.isArray(descriptors) ? descriptors : []) {
    if (!d || !d.name || !d.path) continue;
    const age = ageFn(d.path, nowMs);
    const entry = {
      name: d.name,
      path: d.path,
      age_ms: age,
      max_age_ms: d.max_age_ms,
      missing: age === null,
    };
    let degradedReason = null;
    if (age !== null && typeof d.degraded === "function") {
      const doc = readArtifact(d.path);
      // An artifact that cannot be parsed is itself a failure, not a pass.
      try { degradedReason = doc === null ? "artifact unreadable" : (d.degraded(doc) || null); }
      catch (e) { degradedReason = `degraded check threw: ${e.message}`; }
    }
    if (degradedReason) entry.degraded_reason = degradedReason;
    if (age === null || age > d.max_age_ms || degradedReason) stale.push(entry);
    else healthy.push(entry);
  }
  return Object.freeze({
    ok: stale.length === 0,
    stale: Object.freeze(stale),
    healthy: Object.freeze(healthy),
  });
}

module.exports = Object.freeze({ checkArtifacts, artifactAgeMs });
