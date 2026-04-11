"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-position-read-model-cutover.js");

function run() {
  const md = __test.buildMarkdown({
    summary: {
      generated_at_kst: "2026-04-11 18:00:00 KST",
      exchange: "BINANCEFUT",
      dominant_status: "LATEST_READY",
      positions_paper_count: 8,
      position_read_model_latest_count: 8,
      position_events_count: 42,
      unified_position_timeline_count: 42,
      latest_coverage_pct: 1,
      timeline_coverage_pct: 1,
    },
    samples: [
      { symbol: "XRPUSDT", state: "ACTIVE", mutation_kind: "POSITION_UPSERT", position_event_id: "evt-1" },
    ],
  });
  assert.ok(md.includes("Position Read Model Cutover"));
  assert.ok(md.includes("LATEST_READY"));
  assert.ok(md.includes("XRPUSDT"));
  console.log("POSITION_READ_MODEL_CUTOVER_REPORT_TEST_OK");
}

run();
