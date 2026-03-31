#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  buildPrompt,
  buildCandidateDisplayMap,
  deriveReviewReadiness,
  replaceCandidateIdsInText,
  renderMarkdown,
} = require("./automation-codex-weekly-patch-engine");
const { callClaude } = require("../src/services/claudeClient");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");

loadLocalEnv();

const MAX_AGE_HOURS = Math.max(12, Number(process.env.CLAUDE_PATCH_ENGINE_INPUT_MAX_AGE_HOURS || 48));
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "claude_weekly_patch_engine_latest.md");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "claude_weekly_patch_engine_latest.json");
const CLAUDE_MODEL = String(process.env.CLAUDE_PATCH_ENGINE_MODEL || process.env.CLAUDE_MODEL || "claude-opus-4-5-20251101").trim();
const CLAUDE_TIMEOUT_MS = Math.max(10_000, Number(process.env.CLAUDE_PATCH_ENGINE_TIMEOUT_MS || 90_000));
const CLAUDE_API_KEY = String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
const CLAUDE_ENABLED = String(process.env.CLAUDE_PATCH_ENGINE_ENABLED || (CLAUDE_API_KEY ? "1" : "0")).trim() !== "0";

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readFreshJson(filePath, maxAgeHours = MAX_AGE_HOURS) {
  const data = readJsonRawSafe(filePath, null);
  if (!data) return { filePath, data: null, exists: false, fresh: false, ageHours: null };
  try {
    const st = fs.statSync(filePath);
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    return { filePath, data, exists: true, fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours, ageHours };
  } catch (_err) {
    return { filePath, data, exists: true, fresh: false, ageHours: null };
  }
}

function parseClaudeJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(String(fenced[1]).trim());
      } catch (_inner) {
        return null;
      }
    }
  }
  return null;
}

const INPUT_PATHS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  governance: path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json"),
  changeControl: path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.json"),
  patchCandidates: path.join(OPS_DAILY_DIR, "pine_quality_patch_candidates_latest.json"),
  ml: path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json"),
  ev: path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json"),
  wait: path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  selfEvolutionCandidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  selfEvolutionCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  selfEvolutionCanonicalParity: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json"),
  selfEvolutionCanonicalProvenance: path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_provenance_latest.json"),
  selfEvolutionServerPrimaryCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json"),
  selfEvolutionBundleActivation: path.join(OPS_DAILY_DIR, "best_self_evolution_bundle_activation_latest.json"),
  deploymentPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"),
  loopMonitor: path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.json"),
  retrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
});

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objectiveSupervisor = readFreshJson(INPUT_PATHS.objectiveSupervisor, MAX_AGE_HOURS);
  const governance = readFreshJson(INPUT_PATHS.governance, MAX_AGE_HOURS);
  const changeControl = readFreshJson(INPUT_PATHS.changeControl, MAX_AGE_HOURS);
  const patchCandidates = readFreshJson(INPUT_PATHS.patchCandidates, MAX_AGE_HOURS);
  const ml = readFreshJson(INPUT_PATHS.ml, MAX_AGE_HOURS);
  const ev = readFreshJson(INPUT_PATHS.ev, MAX_AGE_HOURS);
  const wait = readFreshJson(INPUT_PATHS.wait, MAX_AGE_HOURS);
  const canary = readFreshJson(INPUT_PATHS.canary, MAX_AGE_HOURS);
  const stageAutopilot = readFreshJson(INPUT_PATHS.stageAutopilot, MAX_AGE_HOURS);
  const selfEvolutionCandidatesArtifact = readFreshJson(INPUT_PATHS.selfEvolutionCandidates, MAX_AGE_HOURS);
  const selfEvolutionCanaryArtifact = readFreshJson(INPUT_PATHS.selfEvolutionCanary, MAX_AGE_HOURS);
  const selfEvolutionCanonicalParityArtifact = readFreshJson(INPUT_PATHS.selfEvolutionCanonicalParity, MAX_AGE_HOURS);
  const selfEvolutionCanonicalProvenanceArtifact = readFreshJson(INPUT_PATHS.selfEvolutionCanonicalProvenance, MAX_AGE_HOURS);
  const selfEvolutionServerPrimaryCanaryArtifact = readFreshJson(INPUT_PATHS.selfEvolutionServerPrimaryCanary, MAX_AGE_HOURS);
  const selfEvolutionBundleActivationArtifact = readFreshJson(INPUT_PATHS.selfEvolutionBundleActivation, MAX_AGE_HOURS);
  const deploymentPlan = readFreshJson(INPUT_PATHS.deploymentPlan, MAX_AGE_HOURS);
  const loopMonitor = readFreshJson(INPUT_PATHS.loopMonitor, MAX_AGE_HOURS);
  const retrospective = readFreshJson(INPUT_PATHS.retrospective, MAX_AGE_HOURS);
  const objectiveSupervisorData = unwrapRawReport(objectiveSupervisor.data);
  const selfEvolutionCandidatesData = unwrapRawReport(selfEvolutionCandidatesArtifact.data);
  const selfEvolutionCanaryData = unwrapRawReport(selfEvolutionCanaryArtifact.data);
  const candidateDisplayMap = buildCandidateDisplayMap(changeControl.data, patchCandidates.data);
  const stageAutopilotData = unwrapRawReport(stageAutopilot.data);
  const stageRows = Array.isArray(stageAutopilotData && stageAutopilotData.stage_rows) ? stageAutopilotData.stage_rows : [];
  const sourceModeStage = stageRows.find((row) => String(row && row.stage || "").trim().toUpperCase() === "SOURCE_MODE") || {};
  const canonicalPolicyStage = stageRows.find((row) => String(row && row.stage || "").trim().toUpperCase() === "CANONICAL_POLICY") || {};
  const inputs = [objectiveSupervisor, governance, changeControl, patchCandidates, ml, ev, wait, canary, stageAutopilot, selfEvolutionCandidatesArtifact, selfEvolutionCanaryArtifact, selfEvolutionCanonicalParityArtifact, selfEvolutionCanonicalProvenanceArtifact, selfEvolutionServerPrimaryCanaryArtifact, selfEvolutionBundleActivationArtifact, deploymentPlan, loopMonitor, retrospective];
  const reviewReadiness = deriveReviewReadiness({
    changeControl: changeControl.data,
    selfEvolutionCanary: selfEvolutionCanaryData,
    deploymentPlan: unwrapRawReport(deploymentPlan.data),
    bundleActivation: unwrapRawReport(selfEvolutionBundleActivationArtifact.data),
  });
  const {
    readyPromotion,
    readyRollback,
    selfEvolutionPromotionReady,
    selfEvolutionRollbackReady,
    selfEvolutionAuthorityBypass,
    pendingSignalConfirmation,
    reviewReady,
    blockedReason,
  } = reviewReadiness;
  const anyWatchlist = Boolean(patchCandidates.data && Array.isArray(patchCandidates.data.candidates) && patchCandidates.data.candidates.length > 0);

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_claude_weekly_patch_engine.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_claude_weekly_patch_engine.md`);
  const baseReport = {
    ok: true,
    owner: "CLAUDE",
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    status: "SKIPPED",
    verdict: "HOLD",
    recommended_candidate_id: null,
    recommended_rollback_file_path: null,
    confidence: null,
    reason: "NO_REVIEW_NEEDED",
    summary: "자동 승격/롤백 준비 상태가 아니어서 Claude 검토를 생략했습니다.",
    checks: [],
    risks: [],
    review_unit: "ENGINE_POLICY_BUNDLE",
    source_mode_change: String(sourceModeStage.signature || "").trim() || null,
    canonical_threshold_signature: String((unwrapRawReport(deploymentPlan.data) && unwrapRawReport(deploymentPlan.data).summary && unwrapRawReport(deploymentPlan.data).summary.recommended_target_stage_signature) || canonicalPolicyStage.signature || "").trim() || null,
    inputs: inputs.map((row) => ({ name: path.basename(row.filePath, ".json"), filePath: row.filePath, fresh: row.fresh, age_hours: row.ageHours })),
    model: CLAUDE_MODEL,
  };

  if (pendingSignalConfirmation) {
    const blocked = {
      ...baseReport,
      status: "FRESH",
      reason: blockedReason,
      summary: "현재 적용 전략의 bundle activation proof가 아직 닫히지 않아 Claude 권위 심사를 보류합니다.",
      checks: [
        `plan_status=${String((unwrapRawReport(deploymentPlan.data) && unwrapRawReport(deploymentPlan.data).summary && unwrapRawReport(deploymentPlan.data).summary.plan_status) || (unwrapRawReport(deploymentPlan.data) && unwrapRawReport(deploymentPlan.data).plan_status) || "N/A")}`,
        `change=${readyPromotion ? "PROMOTE" : (readyRollback ? "ROLLBACK" : "NO")}`,
        `self-evolution=${selfEvolutionPromotionReady ? "PROMOTE" : (selfEvolutionRollbackReady ? "ROLLBACK" : (selfEvolutionAuthorityBypass ? "AUTHORITY_BYPASS" : "NO"))}`,
      ],
      risks: [
        "pending signal confirmation 이전 review verdict는 false disagreement를 만들 수 있음",
      ],
    };
    writeJson(jsonPath, wrapDisplayAndRawReport(blocked));
    writeText(mdPath, renderMarkdown(blocked));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    console.log(JSON.stringify({ ok: true, status: blocked.status, reason: blocked.reason }));
    return;
  }

  if (!(reviewReady || anyWatchlist)) {
    writeJson(jsonPath, wrapDisplayAndRawReport(baseReport));
    writeText(mdPath, renderMarkdown(baseReport));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    console.log(JSON.stringify({ ok: true, status: "SKIPPED", reason: baseReport.reason }));
    return;
  }

  if (!CLAUDE_ENABLED || !CLAUDE_API_KEY) {
    const skipped = {
      ...baseReport,
      reason: "CLAUDE_DISABLED_OR_NO_API_KEY",
      summary: "Claude 패치 엔진이 비활성화됐거나 API 키가 없어 HOLD 처리했습니다.",
    };
    writeJson(jsonPath, wrapDisplayAndRawReport(skipped));
    writeText(mdPath, renderMarkdown(skipped));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    console.log(JSON.stringify({ ok: true, status: "SKIPPED", reason: skipped.reason }));
    return;
  }

  const prompt = replaceCandidateIdsInText(buildPrompt({
    objectiveSupervisor: objectiveSupervisorData,
    governance: unwrapRawReport(governance.data),
    changeControl: changeControl.data,
    patchCandidates: patchCandidates.data,
    ml: ml.data,
    ev: ev.data,
    wait: wait.data,
    canary: canary.data,
    stageAutopilot: stageAutopilot.data,
    selfEvolutionCandidatesDirect: selfEvolutionCandidatesData,
    selfEvolutionCanaryDirect: selfEvolutionCanaryData,
    selfEvolutionCanonicalParityDirect: unwrapRawReport(selfEvolutionCanonicalParityArtifact.data),
    selfEvolutionCanonicalProvenanceDirect: unwrapRawReport(selfEvolutionCanonicalProvenanceArtifact.data),
    selfEvolutionServerPrimaryCanaryDirect: unwrapRawReport(selfEvolutionServerPrimaryCanaryArtifact.data),
    deploymentPlan: deploymentPlan.data,
    loopMonitor: unwrapRawReport(loopMonitor.data),
    retrospective: retrospective.data,
  }), candidateDisplayMap);

  const system = [
    "You are the weekly Claude patch engine for DONBEOLJA.",
    "Return JSON only. Do not include markdown fences.",
    "Schema keys: verdict, recommended_candidate_id, recommended_rollback_file_path, confidence, reason, summary, checks, risks.",
    "Verdict must be HOLD, PROMOTE, or ROLLBACK.",
  ].join("\n");

  const res = await Promise.race([
    callClaude({
      apiKey: CLAUDE_API_KEY,
      model: CLAUDE_MODEL,
      system,
      prompt,
      temperature: 0.1,
      maxTokens: 900,
      cacheSystem: true,
    }),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "TIMEOUT" }), CLAUDE_TIMEOUT_MS)),
  ]);
  const parsed = res && res.ok ? parseClaudeJson(res.text) : null;
  const report = {
    ok: !!parsed,
    owner: "CLAUDE",
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    status: parsed ? "FRESH" : "FAILED",
    verdict: parsed ? String(parsed.verdict || "HOLD").trim().toUpperCase() || "HOLD" : "HOLD",
    recommended_candidate_id: parsed ? (String(parsed.recommended_candidate_id || "").trim() || null) : null,
    display_candidate_id: parsed ? (candidateDisplayMap.get(String(parsed.recommended_candidate_id || "").trim()) || String(parsed.recommended_candidate_id || "").trim() || null) : null,
    recommended_rollback_file_path: parsed ? (String(parsed.recommended_rollback_file_path || "").trim() || null) : null,
    confidence: parsed ? toNum(parsed.confidence) : null,
    reason: parsed ? replaceCandidateIdsInText(String(parsed.reason || "N/A"), candidateDisplayMap) : String(res && res.reason || "CLAUDE_PARSE_FAILED"),
    summary: parsed ? replaceCandidateIdsInText(String(parsed.summary || "N/A"), candidateDisplayMap) : String(res && res.text || res && res.reason || "CLAUDE_PARSE_FAILED").trim().slice(0, 1000),
    checks: parsed && Array.isArray(parsed.checks) ? parsed.checks.map((row) => replaceCandidateIdsInText(String(row || ""), candidateDisplayMap)) : [],
    risks: parsed && Array.isArray(parsed.risks) ? parsed.risks.map((row) => replaceCandidateIdsInText(String(row || ""), candidateDisplayMap)) : [],
    review_unit: "ENGINE_POLICY_BUNDLE",
    source_mode_change: String(sourceModeStage.signature || "").trim() || null,
    canonical_threshold_signature: String((unwrapRawReport(deploymentPlan.data) && unwrapRawReport(deploymentPlan.data).summary && unwrapRawReport(deploymentPlan.data).summary.recommended_target_stage_signature) || canonicalPolicyStage.signature || "").trim() || null,
    inputs: baseReport.inputs,
    model: CLAUDE_MODEL,
    raw_reason: res && res.reason ? res.reason : null,
  };

  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  if (String(process.env.CLAUDE_PATCH_ENGINE_SKIP_TELEGRAM || "1").trim() !== "1") {
    const alert = await sendKoreanTelegramSummary({
      title: `[Claude 주간 패치 엔진] ${report.verdict}`,
      severity: report.verdict === "ROLLBACK" ? "WARN" : "INFO",
      sections: [
        { header: "판정", lines: [`${report.verdict} / ${report.reason}`] },
        { header: "검토 준비", lines: [`change=${readyPromotion ? "PROMOTE" : (readyRollback ? "ROLLBACK" : "NO")}`, `self-evolution=${selfEvolutionPromotionReady ? "PROMOTE" : (selfEvolutionRollbackReady ? "ROLLBACK" : (selfEvolutionAuthorityBypass ? "AUTHORITY_BYPASS" : "NO"))}`] },
        { header: "추천", lines: [`candidate ${report.display_candidate_id || report.recommended_candidate_id || "N/A"}`, `rollback ${report.recommended_rollback_file_path || "N/A"}`] },
      ],
    });
    if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "SKIP_ALERT"))) {
      throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
    }
  }

  console.log(JSON.stringify({
    ok: report.ok,
    status: report.status,
    verdict: report.verdict,
    candidate: report.display_candidate_id || report.recommended_candidate_id,
    rollback: report.recommended_rollback_file_path,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    deriveReviewReadiness,
    parseClaudeJson,
  },
};
