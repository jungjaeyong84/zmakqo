"use strict";

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deriveServerPrimaryAcceptanceWatch({ autonomyContract = null, serverPrimaryCanary = null, cutoverReadiness = null, serverRuntime = null } = {}) {
  const contract = unwrapRawReport(autonomyContract) || {};
  const contractSummary = contract.summary && typeof contract.summary === "object" ? contract.summary : {};
  const phaseDPolicy = contract.phase_d_policy && typeof contract.phase_d_policy === "object"
    ? contract.phase_d_policy
    : {};
  const canary = unwrapRawReport(serverPrimaryCanary) || {};
  const cutover = unwrapRawReport(cutoverReadiness) || {};
  const runtime = unwrapRawReport(serverRuntime) || {};
  const cutoverSummary = cutover.summary && typeof cutover.summary === "object" ? cutover.summary : cutover;
  const runtimeSummary = runtime.summary && typeof runtime.summary === "object" ? runtime.summary : runtime;
  const summary = readSummary(canary);
  const rows = Array.isArray(canary.rows) ? canary.rows : [];

  const minExecuted = Math.max(1, toNum(phaseDPolicy.min_server_primary_executed_n) || toNum(summary.acceptance_min_executed) || 2);
  const maxDisagreementRate = Math.max(0, toNum(phaseDPolicy.max_server_primary_disagreement_rate) || 0.15);
  const maxRollbackTriggers = Math.max(0, toNum(phaseDPolicy.max_server_primary_rollback_trigger_n) || 0);
  const executedN = toNum(summary.server_primary_executed_n) || 0;
  const realizedN = toNum(summary.server_primary_realized_n) || 0;
  const disagreementRate = toNum(summary.pine_shadow_disagreement_rate) || 0;
  const rollbackTriggerN = toNum(summary.rollback_trigger_n) || 0;
  const configuredMarkets = Array.isArray(summary.configured_server_primary_markets)
    ? summary.configured_server_primary_markets.filter(Boolean)
    : [];
  const fallbackConfiguredCount = Math.max(
    0,
    toNum(summary.configured_server_primary_markets_n) || 0,
    toNum(summary.server_primary_markets_n) || 0,
    toNum(cutoverSummary.runtime_market_count) || 0,
    toNum(runtimeSummary.market_count) || 0
  );
  const effectiveConfiguredCount = configuredMarkets.length || fallbackConfiguredCount;
  const applyPass = summary.apply_pass === true;

  let phaseDStatus = "PENDING";
  let phaseDReason = String(summary.acceptance_reason || "").trim().toUpperCase() || null;

  if (!effectiveConfiguredCount) {
    phaseDStatus = "N/A";
    phaseDReason = "NO_SERVER_PRIMARY_MARKETS";
  } else if (applyPass === false) {
    phaseDStatus = "BLOCK";
    phaseDReason = "SERVER_PRIMARY_CANARY_BLOCK";
  } else if (rollbackTriggerN > maxRollbackTriggers) {
    phaseDStatus = "BLOCK";
    phaseDReason = "SERVER_PRIMARY_ROLLBACK_TRIGGERED";
  } else if (disagreementRate > maxDisagreementRate) {
    phaseDStatus = "BLOCK";
    phaseDReason = "SERVER_PRIMARY_DISAGREEMENT_HIGH";
  } else if (executedN < minExecuted) {
    phaseDStatus = "PENDING";
    phaseDReason = phaseDReason || "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT";
  } else if (summary.acceptance_ready === true) {
    phaseDStatus = "READY";
    phaseDReason = "SERVER_PRIMARY_ACCEPTANCE_READY";
  }

  return {
    summary: {
      contract_goal_state: String(contractSummary.goal_state || "").trim().toUpperCase() || null,
      configured_server_primary_markets_n: effectiveConfiguredCount,
      configured_server_primary_markets: configuredMarkets,
      observed_n: toNum(summary.row_n) || 0,
      executed_n: executedN,
      realized_n: realizedN,
      apply_pass: summary.apply_pass === true,
      min_executed_n: minExecuted,
      disagreement_rate: disagreementRate,
      max_disagreement_rate: maxDisagreementRate,
      rollback_trigger_n: rollbackTriggerN,
      max_rollback_trigger_n: maxRollbackTriggers,
      phase_d_ready: phaseDStatus === "READY",
      phase_d_status: phaseDStatus,
      phase_d_reason: phaseDReason,
    },
    rows: rows.map((row) => ({
      market: String(row.market || "").trim() || null,
      executed_n: toNum(row.executed_n) || 0,
      realized_n: toNum(row.realized_n) || 0,
      pine_shadow_disagreement_rate: toNum(row.pine_shadow_disagreement_rate) || 0,
      rollback_trigger_n: toNum(row.rollback_trigger_n) || 0,
      win_rate: toNum(row.win_rate),
      avg_ret_net: toNum(row.avg_ret_net),
    })),
  };
}

module.exports = {
  deriveServerPrimaryAcceptanceWatch,
};
