"use strict";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toIsoOrNull(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolveV3LaneSinceIso({
  checkpoint = null,
  now = new Date(),
  lookbackMinutes = 180,
  overlapMinutes = 15,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("V3_LANE_NOW_INVALID");
  const checkpointIso = toIsoOrNull(checkpoint && checkpoint.last_seen_created_at);
  const overlapMs = Math.max(0, Number(overlapMinutes) || 0) * 60 * 1000;
  if (checkpointIso) {
    const checkpointMs = new Date(checkpointIso).getTime();
    return new Date(Math.max(0, checkpointMs - overlapMs)).toISOString();
  }
  const lookbackMs = Math.max(1, Number(lookbackMinutes) || 180) * 60 * 1000;
  return new Date(Math.max(0, nowMs - lookbackMs)).toISOString();
}

function buildV3LaneCheckpoint({
  previousCheckpoint = null,
  fetchedRows = [],
  now = new Date(),
  lookbackMinutes = 180,
  overlapMinutes = 15,
} = {}) {
  let lastSeenIso = toIsoOrNull(previousCheckpoint && previousCheckpoint.last_seen_created_at);
  for (const row of Array.isArray(fetchedRows) ? fetchedRows : []) {
    const createdAt = toIsoOrNull(row && row.created_at);
    if (!createdAt) continue;
    if (!lastSeenIso || createdAt > lastSeenIso) lastSeenIso = createdAt;
  }
  return Object.freeze({
    generated_at: (now instanceof Date ? now : new Date(now)).toISOString(),
    last_seen_created_at: lastSeenIso,
    fetched_row_n: Array.isArray(fetchedRows) ? fetchedRows.length : 0,
    lookback_minutes: Math.max(1, Number(lookbackMinutes) || 180),
    overlap_minutes: Math.max(0, Number(overlapMinutes) || 0),
  });
}

module.exports = Object.freeze({
  resolveV3LaneSinceIso,
  buildV3LaneCheckpoint,
});
