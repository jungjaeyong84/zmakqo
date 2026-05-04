"use strict";

const crypto = require("crypto");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function round(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function normalizeFindingId(value) {
  return String(value == null ? "" : value).trim().toUpperCase();
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function findingById(analysis, id) {
  const target = normalizeFindingId(id);
  return asArray(analysis && analysis.root_cause_findings).find((finding) => normalizeFindingId(finding && finding.id) === target) || null;
}

function metricEvidence(finding) {
  const evidence = asObject(finding && finding.evidence) || {};
  const ifRemoved = asObject(finding && finding.if_removed) || {};
  return Object.freeze({
    group: trimOrNull(finding && finding.group),
    key: trimOrNull(evidence.key),
    n: toNumberOrNull(evidence.n),
    win_rate_pct: round(evidence.win_rate_pct, 2),
    net_pnl_usdt: round(evidence.net_pnl_usdt, 4),
    expectancy_usdt: round(evidence.expectancy_usdt, 4),
    profit_factor: evidence.profit_factor === "INF" ? "INF" : round(evidence.profit_factor, 4),
    if_removed_kept_n: toNumberOrNull(ifRemoved.kept_n),
    if_removed_kept_net_pnl_usdt: round(ifRemoved.kept_net_pnl_usdt, 4),
    if_removed_kept_profit_factor: ifRemoved.kept_profit_factor === Infinity ? "INF" : round(ifRemoved.kept_profit_factor, 4),
  });
}

function pushUnique(list, item) {
  if (!list.includes(item)) list.push(item);
}

function addCandidateAction(actions, action) {
  const id = trimOrNull(action && action.id);
  if (!id || actions.some((row) => row.id === id)) return;
  actions.push(Object.freeze({
    id,
    kind: trimOrNull(action.kind) || "SHADOW_FILTER",
    status: trimOrNull(action.status) || "SHADOW_ONLY",
    apply_mode: "SHADOW_ONLY",
    live_apply_allowed: false,
    description: trimOrNull(action.description),
    proposed_policy_delta: Object.freeze(asObject(action.proposed_policy_delta) || {}),
    evidence: Object.freeze(asObject(action.evidence) || {}),
    blockers: Object.freeze(asArray(action.blockers)),
  }));
}

function buildOpenClawPolicyCandidateFromRootCause({
  analysis,
  generatedAt = null,
  env = process.env,
} = {}) {
  const a = asObject(analysis) || {};
  const blockers = [];
  const warnings = [];
  const actions = [];
  const sampleN = toNumberOrNull(a.sample_n) || 0;
  const minSampleN = Math.max(1, Math.floor(toNumberOrNull(env.DONBEOLJA_V2_OPENCLAW_POLICY_CANDIDATE_MIN_SAMPLE_N) ?? 100));
  const autoApplyEnabled = parseBool(env.DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED, false);

  if (a.ok !== true) blockers.push("POLICY_CANDIDATE:ROOT_CAUSE_ANALYSIS_NOT_OK");
  if (sampleN < minSampleN) blockers.push("POLICY_CANDIDATE:SAMPLE_INSUFFICIENT");
  if (autoApplyEnabled) blockers.push("POLICY_CANDIDATE:AUTO_APPLY_ENV_MUST_STAY_OFF_FOR_ROOT_CAUSE_CANDIDATE");

  const pullback = findingById(a, "PULLBACK_RECLAIM_DECAY");
  if (pullback) {
    addCandidateAction(actions, {
      id: "SHADOW_SUPPRESS_PULLBACK_RECLAIM",
      kind: "SETUP_FILTER",
      description: "Shadow-test suppressing PULLBACK_RECLAIM entries because realized outcomes are materially negative.",
      proposed_policy_delta: {
        signal_criteria: {
          setup_type_overrides: {
            PULLBACK_RECLAIM: "SHADOW_SUPPRESS_UNTIL_RECOVERY_EVIDENCE",
          },
        },
      },
      evidence: metricEvidence(pullback),
    });
  }

  const shortDecay = findingById(a, "SHORT_DECAY");
  if (shortDecay) {
    addCandidateAction(actions, {
      id: "SHADOW_TIGHTEN_SHORT_ENTRIES",
      kind: "SIDE_FILTER",
      description: "Shadow-test a separate SHORT calibration instead of applying LONG thresholds symmetrically.",
      proposed_policy_delta: {
        signal_criteria: {
          side_overrides: {
            SHORT: {
              min_signal_score_delta: 5,
              require_btc_1h_alignment: true,
              require_mtf_1h_alignment: true,
            },
          },
        },
      },
      evidence: metricEvidence(shortDecay),
    });
  }

  const edgeInversion = findingById(a, "EDGE_LABEL_INVERSION");
  if (edgeInversion) {
    addCandidateAction(actions, {
      id: "SHADOW_DEMOTE_EDGE_LABEL_AUTHORITY",
      kind: "EDGE_LABEL_GUARD",
      description: "Shadow-test removing edge labels as promotion authority until realized edge is monotonic by label.",
      proposed_policy_delta: {
        signal_criteria: {
          edge_label_authority: "SHADOW_ADVISORY_ONLY",
          require_cost_adjusted_edge_accounting: true,
        },
      },
      evidence: metricEvidence(edgeInversion),
    });
  }

  const scoreInversion = findingById(a, "SCORE_INVERSION");
  if (scoreInversion) {
    addCandidateAction(actions, {
      id: "SHADOW_DISABLE_SCORE_ONLY_PROMOTION",
      kind: "SCORE_GUARD",
      description: "Shadow-test blocking any policy promotion based on score alone because score buckets are not monotonic with realized PnL.",
      proposed_policy_delta: {
        promotion: {
          score_only_promotion_allowed: false,
          require_cohort_realized_edge: true,
        },
      },
      evidence: metricEvidence(scoreInversion),
    });
  }

  const btcUnknown = findingById(a, "BTC_ALIGNMENT_UNKNOWN");
  if (btcUnknown) {
    pushUnique(blockers, "POLICY_CANDIDATE:BTC_ALIGNMENT_LINEAGE_INCOMPLETE");
    addCandidateAction(actions, {
      id: "REQUIRE_BTC_1H_ALIGNMENT_LINEAGE",
      kind: "LINEAGE_REQUIREMENT",
      status: "BLOCK_PROMOTION_UNTIL_PRESENT",
      description: "Do not promote policy changes until BTC 1h alignment is present in outcome evidence.",
      proposed_policy_delta: {
        evidence_requirements: {
          btc_1h_alignment_required: true,
        },
      },
      evidence: metricEvidence(btcUnknown),
      blockers: ["POLICY_CANDIDATE:BTC_ALIGNMENT_LINEAGE_INCOMPLETE"],
    });
  }

  const microUnknown = findingById(a, "MICROSTRUCTURE_UNKNOWN");
  if (microUnknown) {
    pushUnique(blockers, "POLICY_CANDIDATE:MICROSTRUCTURE_LINEAGE_INCOMPLETE");
    addCandidateAction(actions, {
      id: "REQUIRE_MICROSTRUCTURE_LINEAGE",
      kind: "LINEAGE_REQUIREMENT",
      status: "BLOCK_PROMOTION_UNTIL_PRESENT",
      description: "Do not promote policy changes until market quality, spread, funding, OI, and liquidation features are present in outcome evidence.",
      proposed_policy_delta: {
        evidence_requirements: {
          market_quality_required: true,
          spread_required: true,
          funding_rate_required: true,
          open_interest_delta_required: true,
          liquidation_notional_5m_required: true,
        },
      },
      evidence: metricEvidence(microUnknown),
      blockers: ["POLICY_CANDIDATE:MICROSTRUCTURE_LINEAGE_INCOMPLETE"],
    });
  }

  if (actions.length === 0) warnings.push("POLICY_CANDIDATE:NO_ACTIONABLE_ROOT_CAUSE_FINDINGS");

  const generated = generatedAt || new Date().toISOString();
  const candidateCore = {
    generated_at: generated,
    source_analysis_generated_at: trimOrNull(a.generated_at),
    source_sample_n: sampleN,
    source_total: asObject(a.total) || {},
    actions,
  };
  const candidateHash = sha256Hex(stableJson({
    source_sample_n: candidateCore.source_sample_n,
    source_total: candidateCore.source_total,
    actions: candidateCore.actions,
  }));
  const ok = blockers.length === 0 && actions.length > 0;

  return Object.freeze({
    ok,
    reason: ok ? "V2_OPENCLAW_POLICY_CANDIDATE_READY_FOR_SHADOW" : "V2_OPENCLAW_POLICY_CANDIDATE_BLOCKED",
    decision: ok ? "SHADOW_EVALUATE_ONLY" : "HOLD_SHADOW_REPAIR_EVIDENCE_FIRST",
    policy_candidate_id: `v2-root-cause-shadow-${candidateHash.slice(0, 12)}`,
    policy_candidate_hash: candidateHash,
    live_apply_allowed: false,
    auto_apply_allowed: false,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    thresholds: Object.freeze({ min_sample_n: minSampleN }),
    candidate: Object.freeze(candidateCore),
  });
}

module.exports = {
  buildOpenClawPolicyCandidateFromRootCause,
  __test: {
    stableJson,
    sha256Hex,
    metricEvidence,
  },
};
