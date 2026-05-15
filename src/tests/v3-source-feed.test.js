"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  filterImportableV3SourceSignals,
  appendV3SourceFeedRows,
  resolveV3SourceFeedSinceIso,
  buildV3SourceFeedCheckpoint,
  readJsonlRows,
  __test,
} = require("../v3/sourceFeed");

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "v3-source-feed-")), name);
}

(() => {
  const rows = filterImportableV3SourceSignals([
    { signal_id: "sig-2", created_at: "2026-05-11T01:02:00.000Z", reason: "OTHER", event_intent: "ENTRY", exchange: "BINANCEFUT" },
    { signal_id: "sig-1", created_at: "2026-05-11T01:01:00.000Z", reason: "V2_SERVER_NATIVE_GENERATOR", event_intent: "ENTRY", exchange: "BINANCEFUT" },
    { signal_id: "sig-3", created_at: "2026-05-11T01:03:00.000Z", reason: "V2_SERVER_NATIVE_GENERATOR", event_intent: "EXIT", exchange: "BINANCEFUT" },
  ]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].signal_id, "sig-1");
})();

(() => {
  const feedPath = tmpFile("feed.jsonl");
  const appended1 = appendV3SourceFeedRows(feedPath, [
    { signal_id: "sig-1", created_at: "2026-05-11T01:01:00.000Z" },
    { signal_id: "sig-2", created_at: "2026-05-11T01:02:00.000Z" },
  ]);
  const appended2 = appendV3SourceFeedRows(feedPath, [
    { signal_id: "sig-2", created_at: "2026-05-11T01:02:00.000Z" },
    { signal_id: "sig-3", created_at: "2026-05-11T01:03:00.000Z" },
  ]);
  const rows = readJsonlRows(feedPath);
  assert.strictEqual(appended1, 2);
  assert.strictEqual(appended2, 1);
  assert.strictEqual(rows.length, 3);
})();

(() => {
  const feedPath = tmpFile("feed.jsonl");
  const appended1 = appendV3SourceFeedRows(feedPath, [
    {
      signal_id: "sig-1",
      created_at: "2026-05-11T01:01:00.000Z",
      features_json: {
        market_quality_score: 0.7,
      },
    },
  ]);
  const appended2 = appendV3SourceFeedRows(feedPath, [
    {
      signal_id: "sig-1",
      created_at: "2026-05-11T01:01:00.000Z",
      features_json: {
        market_quality_score: 0.7,
        spread_bps: 1.2,
        funding_rate: -0.0001,
        btc_1h_trend: "LONG",
        mtf_1h_direction: "LONG",
        feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
        signal_price: 100,
        stop_price: 95,
        target_price: 107.75,
      },
    },
  ]);
  const rows = readJsonlRows(feedPath);
  assert.strictEqual(appended1, 1);
  assert.strictEqual(appended2, 1);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].features_json.spread_bps, 1.2);
})();

(() => {
  const sinceIso = resolveV3SourceFeedSinceIso({
    checkpoint: {
      last_fetched_created_at: "2026-05-11T02:45:00.000Z",
    },
    now: new Date("2026-05-11T03:00:00.000Z"),
    lookbackMinutes: 180,
    overlapMinutes: 15,
  });
  assert.strictEqual(sinceIso, "2026-05-11T02:30:00.000Z");
})();

(() => {
  const checkpoint = buildV3SourceFeedCheckpoint({
    previousCheckpoint: {
      last_fetched_created_at: "2026-05-11T02:45:00.000Z",
      last_imported_created_at: "2026-05-11T02:40:00.000Z",
    },
    fetchedRows: [
      { created_at: "2026-05-11T02:50:00.000Z" },
      { created_at: "2026-05-11T02:55:00.000Z" },
    ],
    importedRows: [
      { created_at: "2026-05-11T02:52:00.000Z" },
    ],
    now: new Date("2026-05-11T03:00:00.000Z"),
    lookbackMinutes: 180,
    overlapMinutes: 15,
  });
  assert.strictEqual(checkpoint.last_fetched_created_at, "2026-05-11T02:55:00.000Z");
  assert.strictEqual(checkpoint.last_imported_created_at, "2026-05-11T02:52:00.000Z");
})();

(() => {
  const limit = __test.resolveAdaptiveKlineLimit({
    checkpoint: {
      last_imported_created_at: "2026-05-09T00:00:00.000Z",
    },
    now: new Date("2026-05-12T00:00:00.000Z"),
    intervalMs: 15 * 60 * 1000,
    fallbackLimit: 260,
    minHistoryBars: 260,
    maxLimit: 1500,
  });
  assert.strictEqual(limit, 548);
})();

(() => {
  assert.strictEqual(
    __test.shouldReplaceSourceFeedRow(
      { features_json: { market_quality_score: 0.7 } },
      { features_json: { market_quality_score: 0.7, spread_bps: 1.1 } }
    ),
    true
  );
})();

(() => {
  const feedPath = tmpFile("feed.jsonl");
  appendV3SourceFeedRows(feedPath, [
    {
      signal_id: "sig-semantic",
      created_at: "2026-05-11T01:01:00.000Z",
      event: "LONG",
      side: "BUY",
      exchange: "BINANCEFUT",
      tf: "15m",
      reason: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
      features_json: {
        setup_type: "BREAKOUT",
        trigger_type: "BREAKOUT",
        entry_grade: "CORE",
        source_band: "CORE",
        market_state: "BULL",
        htf_bias: "BULL",
        market_quality_score: 0.7,
        spread_bps: 1.1,
        funding_rate: -0.0001,
        btc_1h_trend: "LONG",
        mtf_1h_direction: "LONG",
        feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
        signal_price: 100,
        stop_price: 95,
        target_price: 107.75,
      },
    },
  ]);
  const appended = appendV3SourceFeedRows(feedPath, [
    {
      signal_id: "sig-semantic",
      created_at: "2026-05-11T01:01:00.000Z",
      event: "LONG",
      side: "BUY",
      exchange: "BINANCEFUT",
      tf: "15m",
      reason: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
      features_json: {
        setup_type: "CONTINUATION",
        trigger_type: "CONTINUATION",
        entry_grade: "CORE",
        source_band: "CORE",
        market_state: "BULL",
        htf_bias: "BULL",
        market_quality_score: 0.7,
        spread_bps: 1.1,
        funding_rate: -0.0001,
        btc_1h_trend: "LONG",
        mtf_1h_direction: "LONG",
        feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
        signal_price: 100,
        stop_price: 95,
        target_price: 107.75,
      },
    },
  ]);
  const rows = readJsonlRows(feedPath);
  assert.strictEqual(appended, 1);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].features_json.setup_type, "CONTINUATION");
})();

console.log("v3-source-feed.test.js PASS");
