#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  REPO_ROOT,
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");

loadLocalEnv();

const CODEX_BIN = String(process.env.CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex").trim();
const CODEX_MODEL = String(process.env.CODEX_PATCH_ENGINE_MODEL || "").trim();
const EXEC_TIMEOUT_MS = Math.max(60_000, Number(process.env.CODEX_PATCH_ENGINE_TIMEOUT_MS || 600_000));
const MAX_AGE_HOURS = Math.max(12, Number(process.env.CODEX_PATCH_ENGINE_INPUT_MAX_AGE_HOURS || 48));
const RETRY_COUNT = Math.max(1, Number(process.env.CODEX_PATCH_ENGINE_RETRY_COUNT || 2));
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.md");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json");
function resolveLatestArtifactPath(...names) {
  for (const name of names) {
    const candidate = path.join(OPS_DAILY_DIR, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(OPS_DAILY_DIR, names[0]);
}
const INPUT_PATHS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  governance: path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json"),
  changeControl: resolveLatestArtifactPath("pine_quality_change_control_latest.json", "pine_stage1_change_control_latest.json"),
  patchCandidates: resolveLatestArtifactPath("pine_quality_patch_candidates_latest.json", "pine_stage1_patch_candidates_latest.json"),
  ml: path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json"),
  ev: path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json"),
  wait: path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  retrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
});

function buildCandidateDisplayMap(changeControl = null, patchCandidates = null) {
  const map = new Map();
  const ccId = String(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.candidate_id || "").trim();
  const ccDisplay = String(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.display_candidate_id || "").trim();
  if (ccId && ccDisplay) map.set(ccId, ccDisplay);
  const rows = Array.isArray(patchCandidates && patchCandidates.candidates) ? patchCandidates.candidates : [];
  for (const row of rows) {
    const raw = String(row && row.candidate_id || "").trim();
    const display = String(row && row.display_candidate_id || "").trim();
    if (raw && display) map.set(raw, display);
  }
  return map;
}

function toDisplayCandidateId(candidateId, displayMap) {
  const raw = String(candidateId || "").trim();
  if (!raw) return null;
  return displayMap.get(raw) || raw;
}

function replaceCandidateIdsInText(text, displayMap) {
  let out = String(text || "");
  for (const [raw, display] of displayMap.entries()) {
    if (!raw || !display || raw === display) continue;
    out = out.split(raw).join(display);
  }
  out = out.replace(/\b(AUTO_[A-Z0-9_]+)\s*\/\s*\1\b/g, "$1");
  return out;
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

function buildObjectiveSupervisorLayerLines(objectiveSupervisor = null) {
  const layers = objectiveSupervisor && objectiveSupervisor.filter_layers && typeof objectiveSupervisor.filter_layers === "object"
    ? objectiveSupervisor.filter_layers
    : {};
  return [
    `- current filter layer model: 1차 상태/무결성 -> 2차 진입 품질 -> 3차 상태 기반 Soft Sizing -> 4차 EV/시간가치층 -> 5차 WAIT 타이밍층`,
    `- legacy mapping: '3차 시황' == '3차 상태 기반 Soft Sizing', '4차 EV' == '4차 EV/시간가치층', '5차 WAIT' == '5차 WAIT 타이밍층'`,
    `- layer 1 integrity: ${layers.integrity ? `${layers.integrity.server_mode || "N/A"} / coverage ${layers.integrity.coverage_pass ? "PASS" : "BLOCK"}` : "N/A"}`,
    `- layer 2 entry quality: ${layers.entry_quality ? `candidate ${layers.entry_quality.pine_candidate_verdict || "N/A"} / ml quality ${layers.entry_quality.quality_actions != null ? layers.entry_quality.quality_actions : "N/A"}` : "N/A"}`,
    `- layer 3 state soft sizing: ${layers.state_soft_sizing ? `${layers.state_soft_sizing.ml_action || "N/A"} / physics ${layers.state_soft_sizing.physics_action || "N/A"} / qty ${layers.state_soft_sizing.qty_scale != null ? layers.state_soft_sizing.qty_scale : "N/A"}` : "N/A"}`,
    `- layer 4 EV/time value: ${layers.ev_time_value ? `${layers.ev_time_value.tuner_reason || "N/A"} / policy ${layers.ev_time_value.policy_version || "N/A"} / source ${layers.ev_time_value.policy_source || "N/A"}` : "N/A"}`,
    `- layer 5 wait timing: ${layers.wait_timing ? `${layers.wait_timing.tuner_reason || "N/A"} / ${layers.wait_timing.wait_action || "N/A"}` : "N/A"}`,
  ];
}

function buildBestFebtMarketContractLines(objectiveSupervisor = null) {
  const rows = Array.isArray(objectiveSupervisor && objectiveSupervisor.best_febt_market_contracts)
    ? objectiveSupervisor.best_febt_market_contracts
    : [];
  if (!rows.length) return ["- market contract: N/A"];
  return rows.slice(0, 5).map((row) =>
    `- market ${row.market || "UNKNOWN"}: ${row.mode || "N/A"} / replacement ${row.projected_replacement_ratio != null ? row.projected_replacement_ratio : "N/A"} / count ${row.projected_count_ratio_global != null ? row.projected_count_ratio_global : "N/A"} / fire ${row.fire_n != null ? row.fire_n : "N/A"} / late ${row.late_n != null ? row.late_n : "N/A"} / disagree ${row.disagreement_n != null ? row.disagreement_n : "N/A"} / reason ${row.dominant_disagreement_reason || "N/A"}`
  );
}

function buildPrompt(context = {}) {
  const { objectiveSupervisor, governance, changeControl, patchCandidates, ml, ev, wait, canary, stageAutopilot, retrospective } = context;
  const displayMap = buildCandidateDisplayMap(changeControl, patchCandidates);
  const promotionDisplayId = toDisplayCandidateId(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.candidate_id, displayMap);
  const objectiveLayerLines = buildObjectiveSupervisorLayerLines(objectiveSupervisor);
  const febtShadow = governance && governance.current && governance.current.febt_shadow && typeof governance.current.febt_shadow === "object"
    ? governance.current.febt_shadow
    : {};
  const waitLayer = objectiveSupervisor && objectiveSupervisor.filter_layers && objectiveSupervisor.filter_layers.wait_timing && typeof objectiveSupervisor.filter_layers.wait_timing === "object"
    ? objectiveSupervisor.filter_layers.wait_timing
    : {};
  const bestFebtContract = objectiveSupervisor && objectiveSupervisor.best_febt_tuning_contract && typeof objectiveSupervisor.best_febt_tuning_contract === "object"
    ? objectiveSupervisor.best_febt_tuning_contract
    : null;
  const bestFebtMarketLines = buildBestFebtMarketContractLines(objectiveSupervisor);
  return [
    "You are the weekly Codex patch engine for DONBEOLJA.",
    "Task: inspect the provided latest reports and return a single JSON decision only.",
    "Do not modify files. Do not propose new parameter names. Use only existing candidate IDs or rollback file paths from the reports.",
    "Decision enum: HOLD | PROMOTE | ROLLBACK.",
    "Constraints:",
    "- Use every safe lever available to move the system toward the shared objective, but never bypass the existing guards.",
    "- Maintain long/short symmetry.",
    "- Respect change budget and change-control guards.",
    "- Treat patch candidates as Pine full-quality bundle candidates; server 1차 remains integrity-only and must not be semantically retuned here.",
    "- BEST/FEBT weekly tuning must follow /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_WEEKLY_TUNING_POLICY.md.",
    "- BEST/FEBT weekly tuning may only use these automatic levers: febt_lock_arm_min, febt_lock_fire_min, febt_fire_edge_min, febt_late_hard_max, febt_fail_max.",
    "- Do not recommend automatic weight changes for lock_score, delay_cost, late_risk, or failure_risk in the weekly loop.",
    "- If count_ratio_global < 1.00, tightening recommendations are disallowed; prefer HOLD or rollback-compatible reasoning.",
    "- Favor replacement_ratio and count preservation ahead of marginal win-rate gains.",
    "- Prefer HOLD on weak/conflicting evidence.",
    "- PROMOTE only when existing change-control already indicates a ready promotion candidate.",
    "- ROLLBACK only when existing change-control already indicates a ready rollback target.",
    "- Optimize for: 1) expectancy positive, 2) win rate >= 60%, 3) monthly net >= 1,500,000 KRW, 4) lower drawdown.",
    "Required JSON keys:",
    JSON.stringify({
      verdict: "HOLD",
      recommended_candidate_id: null,
      recommended_rollback_file_path: null,
      confidence: 0.0,
      reason: "short reason",
      summary: "short summary",
      checks: ["check"],
      risks: ["risk"],
    }, null, 2),
    "Artifacts:",
    `- objective supervisor: ${INPUT_PATHS.objectiveSupervisor}`,
    `- weekly governance: ${INPUT_PATHS.governance}`,
    `- Pine quality change control: ${INPUT_PATHS.changeControl}`,
    `- Pine quality patch candidates: ${INPUT_PATHS.patchCandidates}`,
    `- ml policy: ${INPUT_PATHS.ml}`,
    `- ev tuner: ${INPUT_PATHS.ev}`,
    `- wait tuner: ${INPUT_PATHS.wait}`,
    `- shadow canary: ${INPUT_PATHS.canary}`,
    `- stage autopilot: ${INPUT_PATHS.stageAutopilot}`,
    `- objective retrospective: ${INPUT_PATHS.retrospective}`,
    `- BEST/FEBT weekly tuning policy: /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_WEEKLY_TUNING_POLICY.md`,
    "Filter layer interpretation:",
    ...objectiveLayerLines,
    "Quick context:",
    `- objective supervisor verdict: ${objectiveSupervisor && objectiveSupervisor.verdict || "N/A"} / reason=${objectiveSupervisor && objectiveSupervisor.reason || "N/A"}`,
    `- governance objective: ${governance && governance.current && governance.current.objective ? governance.current.objective.verdict : "N/A"}`,
    `- governance monthly run-rate KRW: ${governance && governance.current && governance.current.objective && governance.current.objective.monthly_run_rate_krw != null ? governance.current.objective.monthly_run_rate_krw : "N/A"}`,
    `- change control: ${changeControl && changeControl.verdict || "N/A"}`,
    `- auto promotion: ${changeControl && changeControl.auto_promotion ? `${changeControl.auto_promotion.ready ? "READY" : "HOLD"} / ${changeControl.auto_promotion.reason} / ${promotionDisplayId || "N/A"}` : "N/A"}`,
    `- auto rollback: ${changeControl && changeControl.auto_rollback ? `${changeControl.auto_rollback.ready ? "READY" : "HOLD"} / ${changeControl.auto_rollback.reason} / ${changeControl.auto_rollback.rollback_file_path || "N/A"}` : "N/A"}`,
    `- patch candidates verdict: ${patchCandidates && patchCandidates.verdict || "N/A"}`,
    `- ml quality actions: ${ml && ml.recommendations && ml.recommendations.QUALITY ? ml.recommendations.QUALITY.length : 0}`,
    `- ev tuner: ${ev && ev.decision_reason || "N/A"}`,
    `- wait tuner: ${wait && wait.reason || "N/A"}`,
    `- canary shadow drift: ${canary && canary.shadow && canary.shadow.summary ? canary.shadow.summary.drift : "N/A"}`,
    `- stage autopilot objective: ${stageAutopilot && stageAutopilot.objective_verdict || "N/A"} / actions=${stageAutopilot && Array.isArray(stageAutopilot.actions) ? stageAutopilot.actions.length : "N/A"}`,
    `- retrospective daily: ${retrospective && retrospective.periods && retrospective.periods.DAILY && retrospective.periods.DAILY.objective ? retrospective.periods.DAILY.objective.verdict : "N/A"} / net=${retrospective && retrospective.periods && retrospective.periods.DAILY && retrospective.periods.DAILY.realized_trades ? retrospective.periods.DAILY.realized_trades.net_pnl_quote : "N/A"}`,
    `- retrospective weekly: ${retrospective && retrospective.periods && retrospective.periods.WEEKLY && retrospective.periods.WEEKLY.objective ? retrospective.periods.WEEKLY.objective.verdict : "N/A"} / net=${retrospective && retrospective.periods && retrospective.periods.WEEKLY && retrospective.periods.WEEKLY.realized_trades ? retrospective.periods.WEEKLY.realized_trades.net_pnl_quote : "N/A"}`,
    `- retrospective monthly: ${retrospective && retrospective.periods && retrospective.periods.MONTHLY && retrospective.periods.MONTHLY.objective ? retrospective.periods.MONTHLY.objective.verdict : "N/A"} / net=${retrospective && retrospective.periods && retrospective.periods.MONTHLY && retrospective.periods.MONTHLY.realized_trades ? retrospective.periods.MONTHLY.realized_trades.net_pnl_quote : "N/A"}`,
    "BEST/FEBT weekly tuning snapshot:",
    `- febt contract mode: ${bestFebtContract && bestFebtContract.mode || "N/A"}`,
    `- febt tightening allowed: ${bestFebtContract ? (bestFebtContract.tightening_allowed ? "YES" : "NO") : "N/A"}`,
    `- febt recovery priority: ${bestFebtContract ? (bestFebtContract.recovery_priority ? "YES" : "NO") : "N/A"}`,
    `- febt projected replacement_ratio: ${bestFebtContract && bestFebtContract.projected_replacement_ratio != null ? bestFebtContract.projected_replacement_ratio : (febtShadow.projected_replacement_ratio != null ? febtShadow.projected_replacement_ratio : "N/A")}`,
    `- febt projected count_ratio_global: ${bestFebtContract && bestFebtContract.projected_count_ratio_global != null ? bestFebtContract.projected_count_ratio_global : (febtShadow.projected_count_ratio != null ? febtShadow.projected_count_ratio : "N/A")}`,
    `- febt projected net signal delta: ${bestFebtContract && bestFebtContract.projected_net_signal_delta_n != null ? bestFebtContract.projected_net_signal_delta_n : (febtShadow.projected_net_signal_delta_n != null ? febtShadow.projected_net_signal_delta_n : "N/A")}`,
    `- febt candidate recovered / blocked / wait: ${febtShadow.candidate_recovered_n != null ? febtShadow.candidate_recovered_n : "N/A"} / ${febtShadow.candidate_blocked_n != null ? febtShadow.candidate_blocked_n : "N/A"} / ${febtShadow.candidate_wait_n != null ? febtShadow.candidate_wait_n : "N/A"}`,
    `- wait layer febt fire / late / void: ${waitLayer.febt_fire_n != null ? waitLayer.febt_fire_n : "N/A"} / ${waitLayer.febt_late_n != null ? waitLayer.febt_late_n : "N/A"} / ${waitLayer.febt_void_n != null ? waitLayer.febt_void_n : "N/A"}`,
    `- wait layer febt disagreement / fallback / missing: ${waitLayer.febt_disagreement_n != null ? waitLayer.febt_disagreement_n : "N/A"} / ${waitLayer.febt_fallback_legacy_n != null ? waitLayer.febt_fallback_legacy_n : "N/A"} / ${waitLayer.febt_missing_rate != null ? waitLayer.febt_missing_rate : "N/A"}`,
    "BEST/FEBT market contracts:",
    ...bestFebtMarketLines,
  ].join("\n");
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Codex Weekly Patch Engine",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- status: ${report.status || "N/A"}`,
    `- verdict: ${report.verdict || "N/A"}`,
    `- reason: ${report.reason || "N/A"}`,
    `- recommended_candidate_id: ${report.display_candidate_id || report.recommended_candidate_id || "N/A"}`,
    `- recommended_rollback_file_path: ${report.recommended_rollback_file_path || "N/A"}`,
    `- confidence: ${report.confidence != null ? report.confidence : "N/A"}`,
    "",
    "## Summary",
    `- ${report.summary || "N/A"}`,
    "",
    "## Checks",
    ...((report.checks || []).length ? report.checks.map((row) => `- ${row}`) : ["- none"]),
    "",
    "## Risks",
    ...((report.risks || []).length ? report.risks.map((row) => `- ${row}`) : ["- none"]),
    "",
    "## Inputs",
    ...((report.inputs || []).map((row) => `- ${row.name}: ${row.fresh ? "fresh" : "stale"} / ${row.filePath}`)),
  ];
  if (report.command) {
    lines.push("", "## Command", `- ${report.command}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseCodexJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(String(fenced[1]).trim());
      } catch (_inner) {}
    }
  }
  return null;
}

function runCodexExec({ args, prompt, lastMessagePath } = {}) {
  let res = null;
  let parsed = null;
  let finalRaw = "";
  let attempts = 0;
  for (let i = 0; i < RETRY_COUNT; i += 1) {
    attempts += 1;
    res = spawnSync(CODEX_BIN, args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      input: prompt,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
    });
    finalRaw = fs.existsSync(lastMessagePath) ? fs.readFileSync(lastMessagePath, "utf8") : String(res.stdout || "");
    parsed = parseCodexJson(finalRaw);
    if (parsed) break;
  }
  return { res, parsed, finalRaw, attempts };
}

async function main() {
  const nowMeta = nowKstMeta();
  const objectiveSupervisor = readFreshJson(INPUT_PATHS.objectiveSupervisor, MAX_AGE_HOURS);
  const governance = readFreshJson(INPUT_PATHS.governance, MAX_AGE_HOURS);
  const changeControl = readFreshJson(INPUT_PATHS.changeControl, MAX_AGE_HOURS);
  const patchCandidates = readFreshJson(INPUT_PATHS.patchCandidates, MAX_AGE_HOURS);
  const ml = readFreshJson(INPUT_PATHS.ml, MAX_AGE_HOURS);
  const ev = readFreshJson(INPUT_PATHS.ev, MAX_AGE_HOURS);
  const wait = readFreshJson(INPUT_PATHS.wait, MAX_AGE_HOURS);
  const canary = readFreshJson(INPUT_PATHS.canary, MAX_AGE_HOURS);
  const stageAutopilot = readFreshJson(INPUT_PATHS.stageAutopilot, MAX_AGE_HOURS);
  const retrospective = readFreshJson(INPUT_PATHS.retrospective, MAX_AGE_HOURS);
  const candidateDisplayMap = buildCandidateDisplayMap(changeControl.data, patchCandidates.data);
  const inputs = [objectiveSupervisor, governance, changeControl, patchCandidates, ml, ev, wait, canary, stageAutopilot, retrospective];
  const readyPromotion = Boolean(changeControl.data && changeControl.data.auto_promotion && changeControl.data.auto_promotion.ready === true);
  const readyRollback = Boolean(changeControl.data && changeControl.data.auto_rollback && changeControl.data.auto_rollback.ready === true);
  const anyWatchlist = Boolean(patchCandidates.data && Array.isArray(patchCandidates.data.candidates) && patchCandidates.data.candidates.length > 0);

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_codex_weekly_patch_engine.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_codex_weekly_patch_engine.md`);

  const baseReport = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    status: "SKIPPED",
    verdict: "HOLD",
    recommended_candidate_id: null,
    recommended_rollback_file_path: null,
    confidence: null,
    reason: "NO_REVIEW_NEEDED",
    summary: "자동 승격/롤백 준비 상태가 아니어서 Codex 검토를 생략했습니다.",
    checks: [],
    risks: [],
    inputs: inputs.map((row) => ({ name: path.basename(row.filePath, ".json"), filePath: row.filePath, fresh: row.fresh, age_hours: row.ageHours })),
    command: null,
  };

  if (!(readyPromotion || readyRollback || anyWatchlist)) {
    writeJson(jsonPath, wrapDisplayAndRawReport(baseReport));
    writeText(mdPath, renderMarkdown(baseReport));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    console.log(JSON.stringify({ ok: true, status: "SKIPPED", reason: baseReport.reason }));
    return;
  }

  if (!fs.existsSync(CODEX_BIN)) {
    const failed = { ...baseReport, ok: false, status: "FAILED", reason: "CODEX_BIN_MISSING", summary: CODEX_BIN };
    writeJson(jsonPath, wrapDisplayAndRawReport(failed));
    writeText(mdPath, renderMarkdown(failed));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    throw new Error(`CODEX_BIN_MISSING:${CODEX_BIN}`);
  }

  const schemaPath = path.join("/tmp", `codex_patch_engine_schema_${process.pid}.json`);
  const lastMessagePath = path.join("/tmp", `codex_patch_engine_last_${process.pid}.json`);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "recommended_candidate_id", "recommended_rollback_file_path", "confidence", "reason", "summary", "checks", "risks"],
    properties: {
      verdict: { type: "string", enum: ["HOLD", "PROMOTE", "ROLLBACK"] },
      recommended_candidate_id: { type: ["string", "null"] },
      recommended_rollback_file_path: { type: ["string", "null"] },
      confidence: { type: "number" },
      reason: { type: "string" },
      summary: { type: "string" },
      checks: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } }
    }
  };
  writeJson(schemaPath, schema);

  const prompt = buildPrompt({
    objectiveSupervisor: objectiveSupervisor.data,
    governance: governance.data,
    changeControl: changeControl.data,
    patchCandidates: patchCandidates.data,
    ml: ml.data,
    ev: ev.data,
    wait: wait.data,
    canary: canary.data,
    stageAutopilot: stageAutopilot.data,
    retrospective: retrospective.data,
  });

  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C", REPO_ROOT,
    "--color", "never",
  ];
  if (CODEX_MODEL) args.push("-m", CODEX_MODEL);
  args.push(
    "--output-schema", schemaPath,
    "--output-last-message", lastMessagePath,
    "-",
  );
  const promptNormalized = replaceCandidateIdsInText(prompt, candidateDisplayMap);
  const execResult = runCodexExec({ args, prompt: promptNormalized, lastMessagePath });
  const { res, parsed, finalRaw, attempts } = execResult;
  const report = {
    ok: !!parsed,
    generated_at_kst: nowMeta.kst,
    status: parsed ? "OK" : (res.error ? "FAILED" : `EXIT_${res.status}`),
    verdict: parsed ? String(parsed.verdict || "HOLD").toUpperCase() : "HOLD",
    recommended_candidate_id: parsed ? (String(parsed.recommended_candidate_id || "").trim() || null) : null,
    display_candidate_id: parsed ? toDisplayCandidateId(parsed.recommended_candidate_id, candidateDisplayMap) : null,
    recommended_rollback_file_path: parsed ? (String(parsed.recommended_rollback_file_path || "").trim() || null) : null,
    confidence: parsed ? toNum(parsed.confidence) : null,
    reason: parsed ? replaceCandidateIdsInText(String(parsed.reason || "N/A"), candidateDisplayMap) : (res.error && res.error.message ? String(res.error.message) : "PARSE_FAILED"),
    summary: parsed ? replaceCandidateIdsInText(String(parsed.summary || "N/A"), candidateDisplayMap) : replaceCandidateIdsInText(String(finalRaw || res.stderr || "N/A").trim().slice(0, 1000), candidateDisplayMap),
    checks: parsed && Array.isArray(parsed.checks) ? parsed.checks.map((row) => replaceCandidateIdsInText(String(row), candidateDisplayMap)) : [],
    risks: parsed && Array.isArray(parsed.risks) ? parsed.risks.map((row) => replaceCandidateIdsInText(String(row), candidateDisplayMap)) : [],
    inputs: baseReport.inputs,
    attempts,
    command: [CODEX_BIN, ...args].join(" "),
    stderr_tail: String(res.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-20),
  };

  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const alert = await sendKoreanTelegramSummary({
    title: `[Codex 주간 패치 엔진] ${report.verdict}`,
    severity: report.verdict === "ROLLBACK" ? "WARN" : "INFO",
    sections: [
      { header: "판정", lines: [`${report.verdict} / ${report.reason}`] },
      { header: "추천", lines: [`candidate ${report.display_candidate_id || report.recommended_candidate_id || "N/A"}`, `rollback ${report.recommended_rollback_file_path || "N/A"}`] },
      { header: "요약", lines: [report.summary || "N/A"] },
      { header: "점검", lines: (report.checks || []).slice(0, 5) },
      { header: "리스크", lines: (report.risks || []).slice(0, 5) },
    ],
  });
  if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "SKIP_ALERT"))) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
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
} else {
  module.exports = {
    __test: {
      buildPrompt,
      buildCandidateDisplayMap,
      replaceCandidateIdsInText,
      buildObjectiveSupervisorLayerLines,
      buildBestFebtMarketContractLines,
    },
  };
}
