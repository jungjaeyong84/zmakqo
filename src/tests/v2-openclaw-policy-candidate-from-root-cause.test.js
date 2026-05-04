"use strict";

const assert = require("assert");
const { buildOpenClawPolicyCandidateFromRootCause } = require("../v2/openclawPolicyCandidateFromRootCause");

function finding(id, group, key, n, pnl, pf = 0.2) {
  return {
    id,
    severity: "HIGH",
    group,
    evidence: {
      key,
      n,
      win_n: 1,
      loss_n: Math.max(0, n - 1),
      win_rate_pct: n > 0 ? 100 / n : 0,
      net_pnl_usdt: pnl,
      expectancy_usdt: n > 0 ? pnl / n : pnl,
      profit_factor: pf,
    },
    if_removed: {
      kept_n: 200 - n,
      kept_net_pnl_usdt: -10 - pnl,
      kept_profit_factor: 0.8,
    },
  };
}

const baseAnalysis = {
  ok: true,
  reason: "V2_OPENCLAW_ROOT_CAUSE_ANALYSIS_GENERATED",
  generated_at: "2026-05-04T00:00:00.000Z",
  sample_n: 247,
  total: {
    n: 247,
    win_rate_pct: 29.55,
    profit_factor: 0.409,
    expectancy_usdt: -0.2688,
    net_pnl_usdt: -66.3,
  },
  root_cause_findings: [
    finding("PULLBACK_RECLAIM_DECAY", "by_setup_type", "PULLBACK_RECLAIM", 43, -20.1),
    finding("SHORT_DECAY", "by_side", "SHORT", 83, -35.9),
    finding("EDGE_LABEL_INVERSION", "by_edge_cohort", "BUILDABLE_EDGE", 44, -19.4),
    finding("SCORE_INVERSION", "by_signal_score_bucket", "QUALIFIED", 32, -12.1),
  ],
};

{
  const result = buildOpenClawPolicyCandidateFromRootCause({
    analysis: baseAnalysis,
    generatedAt: "2026-05-04T01:00:00.000Z",
    env: {
      DONBEOLJA_V2_OPENCLAW_POLICY_CANDIDATE_MIN_SAMPLE_N: "100",
      DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "0",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.decision, "SHADOW_EVALUATE_ONLY");
  assert.strictEqual(result.live_apply_allowed, false);
  assert.ok(result.policy_candidate_id.startsWith("v2-root-cause-shadow-"));
  assert.ok(result.candidate.actions.some((row) => row.id === "SHADOW_SUPPRESS_PULLBACK_RECLAIM"));
  assert.ok(result.candidate.actions.some((row) => row.id === "SHADOW_TIGHTEN_SHORT_ENTRIES"));
  assert.ok(result.candidate.actions.some((row) => row.id === "SHADOW_DEMOTE_EDGE_LABEL_AUTHORITY"));
  assert.ok(result.candidate.actions.some((row) => row.id === "SHADOW_DISABLE_SCORE_ONLY_PROMOTION"));
}

{
  const env = {
    DONBEOLJA_V2_OPENCLAW_POLICY_CANDIDATE_MIN_SAMPLE_N: "100",
    DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "0",
  };
  const first = buildOpenClawPolicyCandidateFromRootCause({
    analysis: { ...baseAnalysis, generated_at: "2026-05-04T00:00:00.000Z" },
    generatedAt: "2026-05-04T01:00:00.000Z",
    env,
  });
  const second = buildOpenClawPolicyCandidateFromRootCause({
    analysis: { ...baseAnalysis, generated_at: "2026-05-04T02:00:00.000Z" },
    generatedAt: "2026-05-04T03:00:00.000Z",
    env,
  });
  assert.strictEqual(first.policy_candidate_id, second.policy_candidate_id);
  assert.strictEqual(first.policy_candidate_hash, second.policy_candidate_hash);
}

{
  const result = buildOpenClawPolicyCandidateFromRootCause({
    analysis: {
      ...baseAnalysis,
      root_cause_findings: [
        ...baseAnalysis.root_cause_findings,
        finding("BTC_ALIGNMENT_UNKNOWN", "by_btc_1h_alignment", "UNKNOWN", 247, -66.3),
        finding("MICROSTRUCTURE_UNKNOWN", "by_market_quality_bucket", "UNKNOWN", 247, -66.3),
      ],
    },
    env: {
      DONBEOLJA_V2_OPENCLAW_POLICY_CANDIDATE_MIN_SAMPLE_N: "100",
      DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "0",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.decision, "HOLD_SHADOW_REPAIR_EVIDENCE_FIRST");
  assert.ok(result.blockers.includes("POLICY_CANDIDATE:BTC_ALIGNMENT_LINEAGE_INCOMPLETE"));
  assert.ok(result.blockers.includes("POLICY_CANDIDATE:MICROSTRUCTURE_LINEAGE_INCOMPLETE"));
  assert.ok(result.candidate.actions.some((row) => row.id === "REQUIRE_BTC_1H_ALIGNMENT_LINEAGE"));
  assert.ok(result.candidate.actions.some((row) => row.id === "REQUIRE_MICROSTRUCTURE_LINEAGE"));
}

{
  const result = buildOpenClawPolicyCandidateFromRootCause({
    analysis: { ...baseAnalysis, sample_n: 20 },
    env: {
      DONBEOLJA_V2_OPENCLAW_POLICY_CANDIDATE_MIN_SAMPLE_N: "100",
      DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "0",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("POLICY_CANDIDATE:SAMPLE_INSUFFICIENT"));
}

{
  const result = buildOpenClawPolicyCandidateFromRootCause({
    analysis: baseAnalysis,
    env: {
      DONBEOLJA_V2_OPENCLAW_POLICY_CANDIDATE_MIN_SAMPLE_N: "100",
      DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "true",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("POLICY_CANDIDATE:AUTO_APPLY_ENV_MUST_STAY_OFF_FOR_ROOT_CAUSE_CANDIDATE"));
}

console.log("V2_OPENCLAW_POLICY_CANDIDATE_FROM_ROOT_CAUSE_TEST_OK");
