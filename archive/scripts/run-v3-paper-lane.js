#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { loadLocalEnv } = require("./lib/automation-utils");
const { buildV3LocalPaperLaneReport } = require("../src/v3/localPaperLane");
const { resolveV3LaneSinceIso, buildV3LaneCheckpoint } = require("../src/v3/laneCheckpoint");
const { readJsonlRows, readJsonSafe } = require("../src/v3/sourceFeed");

loadLocalEnv();

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_paper_lane_latest.json");
const QUEUE_PATH = path.join(OPS_RUNTIME, "v3_paper_candidate_queue.jsonl");
const CHECKPOINT_PATH = path.join(OPS_RUNTIME, "v3_paper_lane_checkpoint.json");
const FEED_PATH = path.join(OPS_RUNTIME, "v3_raw_signal_feed.jsonl");

const CHECKPOINT_OVERLAP_MINUTES = (() => {
  const n = Number(process.env.V3_PAPER_LANE_CHECKPOINT_OVERLAP_MINUTES);
  return Number.isFinite(n) && n >= 0 ? n : 15;
})();

function loadFeedRowsSince(feedPath, sinceIso) {
  return Object.freeze(
    readJsonlRows(feedPath)
      .filter((row) => String(row && row.created_at || "").trim() >= sinceIso)
      .sort((a, b) => String(a && a.created_at || "").localeCompare(String(b && b.created_at || "")))
  );
}

async function main() {
  const checkpoint = readJsonSafe(CHECKPOINT_PATH, null);
  const sinceIso = resolveV3LaneSinceIso({
    checkpoint,
    now: new Date(),
    lookbackMinutes: Number(process.env.V3_PAPER_LANE_LOOKBACK_MINUTES) || 180,
    overlapMinutes: CHECKPOINT_OVERLAP_MINUTES,
  });
  const sourceRows = loadFeedRowsSince(FEED_PATH, sinceIso);
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  fs.mkdirSync(OPS_RUNTIME, { recursive: true });
  const summary = buildV3LocalPaperLaneReport(sourceRows, { queuePath: QUEUE_PATH });
  const nextCheckpoint = buildV3LaneCheckpoint({
    previousCheckpoint: checkpoint,
    fetchedRows: sourceRows,
    now: new Date(),
    lookbackMinutes: Number(process.env.V3_PAPER_LANE_LOOKBACK_MINUTES) || 180,
    overlapMinutes: CHECKPOINT_OVERLAP_MINUTES,
  });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(nextCheckpoint, null, 2));
  const payload = {
    generated_at: new Date().toISOString(),
    source: "V3_LOCAL_SIGNAL_FEED",
    feed_path: FEED_PATH,
    lookback_minutes: Number(process.env.V3_PAPER_LANE_LOOKBACK_MINUTES) || 180,
    checkpoint_overlap_minutes: CHECKPOINT_OVERLAP_MINUTES,
    checkpoint_path: CHECKPOINT_PATH,
    checkpoint_loaded: Boolean(checkpoint),
    since_iso: sinceIso,
    source_row_n: sourceRows.length,
    queue_path: QUEUE_PATH,
    ...summary,
    checkpoint: nextCheckpoint,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    source_row_n: payload.source_row_n,
    source_signal_n: payload.source_signal_n,
    allowed_signal_n: payload.allowed_signal_n,
    appended_queue_n: payload.appended_queue_n,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V3_PAPER_LANE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
