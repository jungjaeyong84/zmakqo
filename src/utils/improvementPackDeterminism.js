const crypto = require("crypto");

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .sort();
}

function normalizePackIdentity(identity = {}) {
  return {
    exchanges: normalizeStringArray(identity.exchanges),
    markets: normalizeStringArray(identity.markets),
    base_tf: String(identity.base_tf || "").trim() || null,
    from_utc: String(identity.from_utc || "").trim() || null,
    to_utc: String(identity.to_utc || "").trim() || null,
  };
}

function stablePackIdentityKey(identity = {}) {
  return sha256Hex(JSON.stringify(normalizePackIdentity(identity)));
}

function normalizeDeterminismCache(raw) {
  if (raw && raw.version === 2 && raw.packs && typeof raw.packs === "object") {
    return {
      version: 2,
      packs: { ...raw.packs },
    };
  }
  if (
    raw &&
    raw.pack_identity &&
    Array.isArray(raw.event_ids) &&
    (typeof raw.hash === "string" || raw.hash == null)
  ) {
    const packIdentity = normalizePackIdentity(raw.pack_identity);
    const packKey = stablePackIdentityKey(packIdentity);
    return {
      version: 2,
      packs: {
        [packKey]: {
          pack_identity: packIdentity,
          hash: raw.hash || null,
          event_ids: raw.event_ids.slice(),
          saved_at_utc: raw.saved_at_utc || null,
        },
      },
    };
  }
  return { version: 2, packs: {} };
}

function pruneDeterminismCache(cache, maxEntries = 128) {
  const entries = Object.entries(cache.packs || {});
  if (entries.length <= maxEntries) return cache;
  entries.sort((a, b) => {
    const aTs = Date.parse(a[1] && a[1].saved_at_utc ? a[1].saved_at_utc : "") || 0;
    const bTs = Date.parse(b[1] && b[1].saved_at_utc ? b[1].saved_at_utc : "") || 0;
    return bTs - aTs;
  });
  cache.packs = Object.fromEntries(entries.slice(0, maxEntries));
  return cache;
}

function buildDeterministicReplayResult({
  currentEventIds = [],
  currentHash,
  packIdentity,
  previousCache,
  savedAtUtc,
}) {
  const normalizedIdentity = normalizePackIdentity(packIdentity);
  const packKey = stablePackIdentityKey(normalizedIdentity);
  const cache = normalizeDeterminismCache(previousCache);
  const previousEntry = cache.packs[packKey];
  const diffFiles = [];
  let deterministicDiff = null;
  let matchPct = 1.0;
  let compared = false;
  let note = "Determinism baseline stored (no comparable previous pack identity found).";

  if (previousEntry && Array.isArray(previousEntry.event_ids)) {
    compared = true;
    const prevIds = previousEntry.event_ids.slice();
    const prevSet = new Set(prevIds);
    const currentSet = new Set(currentEventIds);
    const missing = prevIds.filter((id) => !currentSet.has(id));
    const added = currentEventIds.filter((id) => !prevSet.has(id));
    const intersection = currentEventIds.filter((id) => prevSet.has(id)).length;
    const denom = Math.max(prevIds.length, currentEventIds.length) || 1;
    matchPct = intersection / denom;
    if (previousEntry.hash !== currentHash) {
      deterministicDiff = {
        prev_hash: previousEntry.hash || null,
        current_hash: currentHash,
        prev_count: prevIds.length,
        current_count: currentEventIds.length,
        missing_count: missing.length,
        new_count: added.length,
        missing_sample: missing.slice(0, 200),
        new_sample: added.slice(0, 200),
      };
      diffFiles.push("qa/diff/event_id_diff.json");
      note = "Determinism mismatch within the same pack identity. See diff file.";
    } else {
      note = "Determinism verified against the previous pack with the same identity.";
    }
  }

  cache.packs[packKey] = {
    pack_identity: normalizedIdentity,
    hash: currentHash,
    event_ids: currentEventIds.slice(),
    saved_at_utc: savedAtUtc || null,
  };
  pruneDeterminismCache(cache);

  return {
    deterministic: {
      method: "hash",
      comparison_scope: compared ? "same_pack_identity" : "baseline_only",
      compared_with_previous_same_identity: compared,
      match_pct: matchPct,
      note,
      hash: currentHash,
      diff_files: diffFiles,
      pack_identity: normalizedIdentity,
    },
    deterministicDiff,
    nextCache: cache,
  };
}

module.exports = {
  buildDeterministicReplayResult,
  normalizeDeterminismCache,
  normalizePackIdentity,
  stablePackIdentityKey,
};
