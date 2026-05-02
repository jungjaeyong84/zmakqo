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

  const simplifiedTp1 = __test.buildCanonicalFillMetadata({
    event: "EXIT_TP_P1_2.5P",
    qty_fraction: 0.5,
    simplified_exit_v2_enabled: true,
  });
  assert.deepStrictEqual(simplifiedTp1, {
    canonical_exit_event: "EXIT_TP_P1_2.5P",
    canonical_exit_stage: "TP1",
    canonical_transition_events: ["TP1_REACHED", "TRAIL_ACTIVATED"],
    canonical_primary_transition_event: "TP1_REACHED",
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

  const simplifiedTrail = __test.buildCanonicalFillMetadata({
    event: "EXIT_TRAIL",
    qty_fraction: 0.25,
    simplified_exit_v2_enabled: true,
  });
  assert.deepStrictEqual(simplifiedTrail, {
    canonical_exit_event: "EXIT_TRAIL",
    canonical_exit_stage: "TRAIL",
    canonical_transition_events: ["TRAIL_FINAL_EXIT"],
    canonical_primary_transition_event: "TRAIL_FINAL_EXIT",
  });

  // 2026-04-28 senior audit Step 19 — V1 TP0 retirement contract:
  // simplified_exit_v2 reclassifies legacy TP0 fills into the TP1
  // stage. Pre-V2 the producer returned null; the new contract emits
  // a TP1-stage payload so the canonical-exit ledger records exactly
  // one stage per V2 cycle.
  assert.deepStrictEqual(__test.buildCanonicalFillMetadata({
    event: "EXIT_TP_P0_0.8P",
    qty_fraction: 0.25,
    simplified_exit_v2_enabled: true,
  }), {
    canonical_exit_event: "EXIT_TP_P1_2.5P",
    canonical_exit_stage: "TP1",
    canonical_transition_events: ["TP1_REACHED", "TRAIL_ACTIVATED"],
    canonical_primary_transition_event: "TP1_REACHED",
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
