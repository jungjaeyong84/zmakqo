"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/backfill-canonical-exit-fill-metadata");

function run() {
  const tp1 = __test.buildCanonicalFillMetadata({
    event: "EXIT_TP_P1_1.65P",
    qty_fraction: 0.375,
  });
  assert.deepStrictEqual(tp1, {
    canonical_exit_event: "EXIT_TP_P1_1.65P",
    canonical_exit_stage: "TP1",
    canonical_transition_events: ["TP1_REACHED", "TRAIL_ACTIVE"],
    canonical_primary_transition_event: "TRAIL_ACTIVE",
  });

  const trailFinal = __test.buildCanonicalFillMetadata({
    event: "EXIT_TRAIL",
    qty_fraction: 1,
  });
  assert.deepStrictEqual(trailFinal, {
    canonical_exit_event: "EXIT_TRAIL",
    canonical_exit_stage: "TRAIL",
    canonical_transition_events: ["TRAIL_FINAL_EXIT"],
    canonical_primary_transition_event: "TRAIL_FINAL_EXIT",
  });

  const unchanged = __test.isMetadataUnchanged({
    canonical_exit_event: "EXIT_TRAIL",
    canonical_exit_stage: "TRAIL",
    canonical_transition_events: ["TRAIL_PARTIAL"],
    canonical_primary_transition_event: "TRAIL_PARTIAL",
    extra: {
      canonical_exit_event: "EXIT_TRAIL",
      canonical_exit_stage: "TRAIL",
      canonical_transition_events: ["TRAIL_PARTIAL"],
      canonical_primary_transition_event: "TRAIL_PARTIAL",
    },
  }, {
    canonical_exit_event: "EXIT_TRAIL",
    canonical_exit_stage: "TRAIL",
    canonical_transition_events: ["TRAIL_PARTIAL"],
    canonical_primary_transition_event: "TRAIL_PARTIAL",
  });
  assert.strictEqual(unchanged, true);

  console.log("BACKFILL_CANONICAL_EXIT_FILL_METADATA_TEST_OK");
}

run();
