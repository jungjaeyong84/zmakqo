const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-candidates");

function run() {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 19:47:00 KST",
    summary: {
      generated_n: 4,
      total_n: 3,
      ready_n: 1,
      blocked_n: 1,
      memory_blocked_n: 1,
      failed_fingerprint_repeat_n: 0,
      by_scope: { PINE: 1, EV: 1, WAIT: 1 },
      by_canonical_migration_class_generated: { PINE_THRESHOLD: 1, SERVER_POLICY: 2 },
      by_canonical_migration_class: { PINE_THRESHOLD: 1, SERVER_POLICY: 2 },
      by_target_deploy_unit_generated: { SERVER_SETTINGS: 3 },
      by_target_deploy_unit: { SERVER_SETTINGS: 3 },
      top_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      top_scope: "PINE",
      top_candidate_migration_class: "PINE_THRESHOLD",
      top_candidate_target_deploy_unit: "SERVER_SETTINGS",
    },
    rows: [
      {
        candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        scope: "PINE",
        canonical_migration_class: "PINE_THRESHOLD",
        current_deploy_unit: "PINE_FILE",
        target_deploy_unit: "SERVER_SETTINGS",
        direction: "TIGHTEN",
        status: "WATCHLIST_TIGHTEN",
        ready_for_auto_apply: false,
        count_guard_effect: { projected_count_ratio_global: 1.0 },
        replacement_effect: { projected_replacement_ratio: 0.82 },
        risk_flags: ["NOT_READY"],
      },
    ],
    blocked_rows: [
      {
        candidate_id: "ML_GATE_CORE_SCORE_ABS",
        scope: "ML",
        canonical_migration_class: "SERVER_POLICY",
        current_deploy_unit: "SERVER_SETTINGS",
        target_deploy_unit: "SERVER_SETTINGS",
        direction: "TIGHTEN",
        memory_block_reason: "FAILED_FINGERPRINT_REPEAT",
        risk_flags: ["MEMORY_BLOCKED", "FAILED_FINGERPRINT_REPEAT"],
      },
    ],
  });

  assert.match(markdown, /BEST Self-Evolution Candidate Change Sets/);
  assert.match(markdown, /generated\/active\/ready\/source_blocked: 4 \/ 3 \/ 1 \/ 1/);
  assert.match(markdown, /memory_blocked\/fingerprint_repeat: 1 \/ 0/);
  assert.match(markdown, /by_migration_class_generated: PINE_THRESHOLD=1, SERVER_POLICY=2/);
  assert.match(markdown, /by_migration_class_active: PINE_THRESHOLD=1, SERVER_POLICY=2/);
  assert.match(markdown, /by_target_deploy_unit_generated: SERVER_SETTINGS=3/);
  assert.match(markdown, /by_target_deploy_unit_active: SERVER_SETTINGS=3/);
  assert.match(markdown, /AUTO_CORE_REGIME_TIGHTEN: PINE\/TIGHTEN \/ class=PINE_THRESHOLD \/ deploy=PINE_FILE->SERVER_SETTINGS/);
  assert.match(markdown, /Memory Blocked/);
  assert.match(markdown, /ML_GATE_CORE_SCORE_ABS: ML\/TIGHTEN \/ class=SERVER_POLICY \/ deploy=SERVER_SETTINGS->SERVER_SETTINGS/);
  console.log("BEST_SELF_EVOLUTION_CANDIDATES_REPORT_TEST_OK");
}

run();
