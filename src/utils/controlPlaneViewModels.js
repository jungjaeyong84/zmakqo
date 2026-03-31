const fs = require("fs");
const path = require("path");
const { unwrapDisplayAndRawReport } = require("./jsonDisplayFields");

const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function loadLatestArtifact(fileName) {
  const absPath = path.join(OPS_DAILY_DIR, fileName);
  const file = readJsonSafe(absPath, null);
  const raw = unwrapDisplayAndRawReport(file);
  const display = file && typeof file === "object" && !Array.isArray(file) && file.display && typeof file.display === "object"
    ? file.display
    : raw;
  return {
    fileName,
    absPath,
    file,
    raw,
    display,
    summary: (raw && raw.summary) || (display && display.summary) || {},
    currentStatus: (raw && raw.current_status) || (display && display.current_status) || {},
    rows: Array.isArray((display && display.rows)) ? display.rows : Array.isArray(raw && raw.rows) ? raw.rows : [],
  };
}

function statusTone(value) {
  const s = String(value || "").toUpperCase();
  if (!s) return "dim";
  if (["PASS", "OK", "ACTIVE", "APPROVED", "PROMOTE", "READY", "YES", "TRUE", "ON_TRACK"].includes(s)) return "ok";
  if (s.includes("FAIL") || s.includes("BLOCK") || s.includes("ROLLBACK") || s === "HOLD" || s === "PENDING" || s === "TIMEOUT_HOLD" || s === "OBJECTIVE_RECOVERY_REQUIRED") return s.includes("PENDING") ? "warn" : "bad";
  if (s.includes("WATCH") || s.includes("MONITOR") || s.includes("WARN") || s.includes("PARTIAL") || s.includes("SHORT") || s === "N/A") return "warn";
  return "dim";
}

function numberText(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signedNumberText(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${numberText(n, digits)}`;
}

function compactText(value, maxLen = 140) {
  const s = String(value || "").trim();
  if (!s) return "-";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function joinList(values, fallback = "-") {
  if (!Array.isArray(values) || !values.length) return fallback;
  return values.filter(Boolean).map((v) => String(v)).join(" / ");
}

function sliceList(values, max = 3) {
  if (!Array.isArray(values) || !values.length) return [];
  return values.slice(0, Math.max(0, max));
}

function extractThresholdPair(signatureText) {
  const text = String(signatureText || "");
  const core = text.match(/core_score_abs\\?":(\d+)/);
  const transition = text.match(/transition_core_score_abs\\?":(\d+)/);
  if (core && transition) return `${core[1]}/${transition[1]}`;
  return null;
}

function toDisplayPercent(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${numberText(n * 100, digits)}%`;
}

function buildMarketImpactRows(validation) {
  const rows = Array.isArray(validation && validation.market_objective_deltas)
    ? validation.market_objective_deltas.slice()
    : [];
  rows.sort((a, b) => Math.abs(Number(b && b.candidate_objective_delta) || 0) - Math.abs(Number(a && a.candidate_objective_delta) || 0));
  return rows.slice(0, 6).map((row) => ({
    market: compactText(row.market),
    delta: signedNumberText(row.candidate_objective_delta, 2),
    executed: `${numberText(row.before_metrics && row.before_metrics.executed_n, 0)} -> ${numberText(row.after_metrics && row.after_metrics.executed_n, 0)}`,
    realized: `${numberText(row.before_metrics && row.before_metrics.realized_n, 0)} -> ${numberText(row.after_metrics && row.after_metrics.realized_n, 0)}`,
    win_rate: `${toDisplayPercent(row.before_metrics && row.before_metrics.win_rate, 0)} -> ${toDisplayPercent(row.after_metrics && row.after_metrics.win_rate, 0)}`,
  }));
}

function buildRowsPreview(rows, mapper, limit = 5) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, Math.max(0, limit)).map(mapper).filter(Boolean);
}

function pickStageRow(stageArtifact, stageName) {
  const target = String(stageName || "").toUpperCase();
  return (stageArtifact.rows || []).find((row) => {
    const stage = String(row.display_stage || row.stage || "").toUpperCase();
    return stage === target;
  }) || null;
}

function buildSourceModeText(stageArtifact) {
  const row = pickStageRow(stageArtifact, "SOURCE_MODE");
  if (!row) return { value: "-", tone: "dim", detail: "source mode snapshot unavailable" };
  const modes = Array.isArray(row.current_source_modes)
    ? row.current_source_modes.map((item) => `${item.market || "?"} ${item.source_mode || "?"}`)
    : [];
  return {
    value: modes.length ? modes.join(" / ") : compactText(row.active_display_signature || row.active_signature),
    tone: statusTone(row.server_primary_acceptance_reason || row.machine_state),
    detail: compactText(row.server_primary_acceptance_reason || row.display_reason || row.active_reason),
  };
}

function buildPolicyBundleLabel(deploymentPlan, stageAutopilot) {
  const canonicalPolicyRow = pickStageRow(stageAutopilot, "CANONICAL_POLICY");
  const sourceMode = buildSourceModeText(stageAutopilot);
  const thresholdPair =
    extractThresholdPair(
      (canonicalPolicyRow && (canonicalPolicyRow.active_signature || canonicalPolicyRow.signature)) ||
      deploymentPlan.summary.threshold_bundle_signature
    ) ||
    extractThresholdPair(deploymentPlan.summary.active_policy_bundle_id) ||
    "-";
  return {
    primary: `${thresholdPair} · ${sourceMode.value}`,
    detail: compactText((canonicalPolicyRow && canonicalPolicyRow.active_reason) || deploymentPlan.summary.recommended_target_stage_reason),
  };
}

function buildMissionControlViewModel() {
  const autonomy = loadLatestArtifact("best_self_evolution_openclaw_autonomy_contract_latest.json");
  const recoveryGovernor = loadLatestArtifact("best_self_evolution_objective_recovery_governor_latest.json");
  const recoveryEffect = loadLatestArtifact("best_self_evolution_objective_recovery_effect_latest.json");
  const deploymentPlan = loadLatestArtifact("best_self_evolution_deployment_plan_latest.json");
  const deploymentProbe = loadLatestArtifact("best_self_evolution_deployment_probe_latest.json");
  const bundleActivation = loadLatestArtifact("best_self_evolution_bundle_activation_latest.json");
  const acceptanceWatch = loadLatestArtifact("best_self_evolution_server_primary_acceptance_watch_latest.json");
  const loopMonitor = loadLatestArtifact("best_self_evolution_loop_monitor_latest.json");
  const objectiveSupervisor = loadLatestArtifact("objective_supervisor_latest.json");
  const watchdog = loadLatestArtifact("automation_watchdog_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const parity = loadLatestArtifact("best_self_evolution_canonical_engine_parity_latest.json");
  const provenance = loadLatestArtifact("best_self_evolution_canonical_engine_provenance_latest.json");

  const sourceMode = buildSourceModeText(stageAutopilot);
  const policyBundle = buildPolicyBundleLabel(deploymentPlan, stageAutopilot);
  const topBlocker = Array.isArray(loopMonitor.summary.critical_blockers) && loopMonitor.summary.critical_blockers.length
    ? loopMonitor.summary.critical_blockers[0]
    : compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause);

  return {
    active: "mission",
    title: "Mission Control",
    hero: {
      eyebrow: "OpenClaw Governor",
      title: compactText(autonomy.summary.goal_state),
      detail: `${compactText(topBlocker)} · target ${compactText(recoveryGovernor.summary.display_candidate_id || recoveryGovernor.summary.target_candidate_id)}`,
      tone: statusTone(autonomy.summary.goal_state),
      pills: [
        { label: "Authority", value: compactText(deploymentPlan.summary.authority_state), tone: statusTone(deploymentPlan.summary.authority_state) },
        { label: "Deployment", value: compactText(deploymentPlan.summary.plan_status), tone: statusTone(deploymentPlan.summary.plan_status) },
        { label: "Source", value: sourceMode.value, tone: sourceMode.tone },
        { label: "Phase D", value: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason), tone: statusTone(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason) },
      ],
      actions: [
        { label: "Recovery", href: "/dashboard/recovery", tone: "primary" },
        { label: "Deployment", href: "/dashboard/deployment", tone: "ghost" },
        { label: "Execution", href: "/dashboard/execution", tone: "ghost" },
        { label: "Audit", href: "/dashboard/audit", tone: "ghost" },
      ],
    },
    metrics: [
      {
        label: "Objective Score",
        value: signedNumberText(autonomy.currentStatus.objective_score, 2),
        meta: `monthly ${signedNumberText(autonomy.currentStatus.monthly_run_rate_krw, 0)} KRW`,
        tone: statusTone(autonomy.summary.goal_state),
      },
      {
        label: "Authority",
        value: compactText(deploymentPlan.summary.authority_state),
        meta: compactText(recoveryGovernor.summary.governor_reason || objectiveSupervisor.display && objectiveSupervisor.display.root_cause),
        tone: statusTone(deploymentPlan.summary.authority_state),
      },
      {
        label: "Deployment",
        value: compactText(deploymentPlan.summary.plan_status),
        meta: `${compactText(deploymentPlan.summary.activation_status)} / ${compactText(deploymentPlan.summary.activation_reason)}`,
        tone: statusTone(deploymentPlan.summary.plan_status),
      },
      {
        label: "Source Mode",
        value: sourceMode.value,
        meta: sourceMode.detail,
        tone: sourceMode.tone,
      },
      {
        label: "Phase D",
        value: `${numberText(acceptanceWatch.summary.executed_n, 0)}/${numberText(acceptanceWatch.summary.acceptance_min_executed, 0)}`,
        meta: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
        tone: statusTone(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
      },
      {
        label: "Ops",
        value: compactText(watchdog.display && watchdog.display.verdict),
        meta: `${compactText(watchdog.display && watchdog.display.scheduler_mode)} / issues ${numberText(watchdog.display && watchdog.display.issue_count, 0)}`,
        tone: statusTone(watchdog.display && watchdog.display.verdict),
      },
    ],
    sections: [
      {
        title: "Strategic State",
        description: "현재 목표와 회복 경로를 먼저 읽습니다.",
        columns: 2,
        cards: [
          {
            title: "Why Blocked",
            tone: statusTone(objectiveSupervisor.display && objectiveSupervisor.display.verdict),
            rows: [
              { label: "Root Cause", value: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause) },
              { label: "Failed Checks", value: joinList(objectiveSupervisor.display && objectiveSupervisor.display.blockers, "-") },
              { label: "Projected Score", value: signedNumberText(recoveryEffect.summary.projected_objective_score, 2) },
              { label: "Dominant Drag", value: compactText(recoveryEffect.summary.dominant_negative_market || "N/A") },
            ],
            notes: sliceList(objectiveSupervisor.display && objectiveSupervisor.display.blockers, 5),
          },
          {
            title: "Next Autonomous Action",
            tone: statusTone(recoveryGovernor.summary.governor_status),
            rows: [
              { label: "Target", value: compactText(recoveryGovernor.summary.display_candidate_id || recoveryGovernor.summary.target_candidate_id) },
              { label: "Governor", value: compactText(recoveryGovernor.summary.governor_status) },
              { label: "Replay / Canary", value: `${recoveryGovernor.summary.replay_pass ? "PASS" : "FAIL"} / ${recoveryGovernor.summary.canary_ready ? "READY" : "HOLD"}` },
              { label: "Gap Closure", value: `${numberText((recoveryEffect.summary.gap_closure_rate || 0) * 100, 1)}%` },
            ],
            notes: sliceList(recoveryGovernor.summary.next_actions || objectiveSupervisor.display && objectiveSupervisor.display.action_plan, 3),
            actions: [
              { label: "Open Recovery", href: "/dashboard/recovery", tone: "ghost" },
            ],
          },
        ],
      },
      {
        title: "Bundle State",
        description: "현재 active engine/policy bundle과 shadow 역할을 읽습니다.",
        columns: 3,
        cards: [
          {
            title: "Engine Bundle",
            tone: "ok",
            rows: [
              { label: "Active", value: compactText(deploymentPlan.summary.active_engine_bundle && deploymentPlan.summary.active_engine_bundle.strategy_id) },
              { label: "Prepared", value: compactText(deploymentPlan.summary.prepared_engine_bundle_id) },
              { label: "Rollback", value: compactText(deploymentPlan.summary.rollback_engine_bundle_id) },
              { label: "Activation", value: compactText(bundleActivation.summary.activation_reason) },
            ],
          },
          {
            title: "Policy Bundle",
            tone: "warn",
            rows: [
              { label: "Active Policy", value: compactText(policyBundle.primary, 84) },
              { label: "Policy Reason", value: compactText(policyBundle.detail) },
              { label: "Source Mode", value: sourceMode.value },
              { label: "Stage", value: compactText(deploymentPlan.summary.recommended_target_stage_reason) },
            ],
          },
          {
            title: "Shadow Pine",
            tone: "dim",
            rows: [
              { label: "Role", value: "SHADOW_OVERLAY_AUDIT" },
              { label: "Execution SOT", value: compactText(autonomy.control_plane && autonomy.control_plane.execution_sot) },
              { label: "Telegram", value: compactText(autonomy.control_plane && autonomy.control_plane.telegram_transport_sot) },
              { label: "Scheduler", value: compactText(autonomy.control_plane && autonomy.control_plane.scheduler_sot) },
            ],
          },
        ],
      },
      {
        title: "Evidence Chain",
        description: "현재 배포와 실행의 근거 artifact를 같은 높이에서 봅니다.",
        columns: 3,
        cards: [
          {
            title: "Deployment",
            tone: statusTone(deploymentPlan.summary.plan_status),
            rows: [
              { label: "Plan", value: compactText(deploymentPlan.summary.plan_status) },
              { label: "Probe", value: compactText(deploymentProbe.summary.probe_status) },
              { label: "Activation", value: compactText(bundleActivation.summary.activation_reason || deploymentPlan.summary.activation_reason) },
              { label: "Primary Unit", value: compactText(deploymentPlan.summary.deploy_unit_primary) },
            ],
            actions: [{ label: "Open Deployment", href: "/dashboard/deployment", tone: "ghost" }],
          },
          {
            title: "Execution",
            tone: sourceMode.tone,
            rows: [
              { label: "Source Mode", value: sourceMode.value },
              { label: "Acceptance", value: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason) },
              { label: "Executed", value: numberText(acceptanceWatch.summary.executed_n, 0) },
              { label: "Rollback Trigger", value: numberText(acceptanceWatch.summary.rollback_trigger_n, 0) },
            ],
            actions: [
              { label: "Open Execution", href: "/dashboard/execution", tone: "ghost" },
              { label: "Open Phase D", href: "/dashboard/server-primary", tone: "ghost" },
            ],
          },
          {
            title: "Evidence",
            tone: statusTone(parity.summary.source_parity_mismatch_n === 0 ? "PASS" : "WARN"),
            rows: [
              { label: "Source Parity", value: `${numberText(parity.summary.source_parity_match_n, 0)}/${numberText(parity.summary.shadow_observed_n, 0)}` },
              { label: "Downstream", value: numberText(parity.summary.final_downstream_mismatch_n, 0) },
              { label: "Provenance", value: `${numberText(provenance.summary.complete_n, 0)}/${numberText(provenance.summary.engine_eligible_n, 0)}` },
              { label: "Ops", value: compactText(watchdog.display && watchdog.display.verdict) },
            ],
            actions: [{ label: "Open Audit", href: "/dashboard/audit", tone: "ghost" }],
          },
        ],
      },
    ],
  };
}

function buildRecoveryViewModel() {
  const governor = loadLatestArtifact("best_self_evolution_objective_recovery_governor_latest.json");
  const effect = loadLatestArtifact("best_self_evolution_objective_recovery_effect_latest.json");
  const objectiveSupervisor = loadLatestArtifact("objective_supervisor_latest.json");
  const replay = loadLatestArtifact("best_self_evolution_replay_latest.json");
  const canary = loadLatestArtifact("best_self_evolution_canary_latest.json");
  const deploymentGuards = loadLatestArtifact("best_self_evolution_deployment_guards_latest.json");
  const targetValidation = Array.isArray(replay.raw && replay.raw.validations)
    ? replay.raw.validations.find((row) => row.candidate_id === effect.summary.target_candidate_id || row.display_candidate_id === effect.summary.target_candidate_id)
    : null;
  return {
    active: "recovery",
    title: "Recovery",
    hero: {
      eyebrow: "Objective Recovery Governor",
      title: compactText(governor.summary.governor_status),
      detail: compactText(governor.summary.governor_reason),
      tone: statusTone(governor.summary.governor_status),
      pills: [
        { label: "Target", value: compactText(governor.summary.display_candidate_id || governor.summary.target_candidate_id), tone: "warn" },
        { label: "Replay", value: governor.summary.replay_pass ? "PASS" : "HOLD", tone: statusTone(governor.summary.replay_pass ? "PASS" : "HOLD") },
        { label: "Canary", value: governor.summary.canary_ready ? "READY" : "HOLD", tone: statusTone(governor.summary.canary_ready ? "READY" : "HOLD") },
        { label: "Guards", value: governor.summary.deployment_guards_pass ? "PASS" : "FAIL", tone: statusTone(governor.summary.deployment_guards_pass ? "PASS" : "FAIL") },
      ],
      actions: [{ label: "Mission", href: "/dashboard/home", tone: "ghost" }],
    },
    metrics: [
      { label: "Current Score", value: signedNumberText(effect.summary.current_objective_score, 2), meta: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause), tone: "bad" },
      { label: "Projected Score", value: signedNumberText(effect.summary.projected_objective_score, 2), meta: compactText(effect.summary.tracking_status), tone: statusTone(effect.summary.tracking_status) },
      { label: "Target Delta", value: signedNumberText(effect.summary.target_candidate_objective_delta, 2), meta: compactText(effect.summary.target_candidate_id), tone: "ok" },
      { label: "Best Replay Delta", value: signedNumberText(effect.summary.best_replay_objective_delta, 2), meta: compactText(effect.summary.best_replay_candidate_id), tone: effect.summary.higher_delta_candidate_available ? "warn" : "dim" },
    ],
    sections: [
      {
        title: "Recovery Path",
        description: "현재 적용 대상과 더 큰 개선 후보를 분리해서 봅니다.",
        columns: 3,
        cards: [
          {
            title: "Current Target",
            tone: statusTone(governor.summary.governor_status),
            rows: [
              { label: "Candidate", value: compactText(effect.summary.target_candidate_id) },
              { label: "Deploy Unit", value: compactText(effect.summary.target_deploy_unit) },
              { label: "Projected Win Rate", value: numberText((effect.summary.projected_win_rate || 0) * 100, 1) + "%" },
              { label: "Projected Avg Ret", value: signedNumberText((effect.summary.projected_avg_ret_net || 0) * 100, 2) + "%" },
            ],
            notes: Array.isArray(effect.summary.next_actions) ? effect.summary.next_actions.slice(0, 3) : [],
          },
          {
            title: "Higher Delta Candidate",
            tone: effect.summary.higher_delta_candidate_available ? "warn" : "dim",
            rows: [
              { label: "Candidate", value: compactText(effect.summary.higher_delta_candidate_id || "N/A") },
              { label: "Objective Delta", value: signedNumberText(effect.summary.higher_delta_candidate_objective_delta, 2) },
              { label: "Ready", value: effect.summary.higher_delta_candidate_ready_for_auto_apply ? "YES" : "NO" },
              { label: "Hold Reason", value: compactText(effect.summary.higher_delta_candidate_hold_reason) },
            ],
          },
          {
            title: "Retrospective Blockers",
            tone: "bad",
            rows: [
              { label: "Root Cause", value: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause) },
              { label: "Monthly Failed", value: joinList(effect.summary.retrospective_monthly_failed_checks || []) },
              { label: "Top Drop Reason", value: compactText(effect.summary.retrospective_monthly_top_drop_reason) },
              { label: "Dominant Drag", value: `${compactText(effect.summary.dominant_negative_market)} (${numberText((effect.summary.dominant_negative_share || 0) * 100, 1)}%)` },
            ],
          },
        ],
      },
      {
        title: "Recovery Evidence",
        description: "replay, canary, deployment guards를 현재 recovery target 기준으로 풀어봅니다.",
        columns: 3,
        cards: [
          {
            title: "Replay Detail",
            tone: statusTone(targetValidation && targetValidation.validation_verdict),
            rows: [
              { label: "Validation", value: compactText(targetValidation && targetValidation.validation_verdict) },
              { label: "Objective Delta", value: signedNumberText(targetValidation && targetValidation.candidate_objective_delta, 2) },
              { label: "Count Delta", value: signedNumberText(targetValidation && targetValidation.count_delta, 2) },
              { label: "Risk Flags", value: joinList(targetValidation && targetValidation.risk_flags, "-") },
            ],
            table: targetValidation ? {
              columns: [
                { key: "market", label: "Market" },
                { key: "delta", label: "Delta" },
                { key: "executed", label: "Executed" },
                { key: "realized", label: "Realized" },
                { key: "win_rate", label: "Win Rate" },
              ],
              rows: buildMarketImpactRows(targetValidation),
            } : null,
          },
          {
            title: "Canary State",
            tone: statusTone(canary.summary.global_canary_pass ? "PASS" : "FAIL"),
            rows: [
              { label: "Ready Wave", value: numberText(canary.summary.open_wave, 0) },
              { label: "Top Ready", value: compactText(canary.summary.top_ready_market) },
              { label: "Scale Allowed", value: canary.summary.scale_allowed ? "YES" : "NO" },
              { label: "Scale Block", value: compactText(canary.summary.scale_block_reason) },
            ],
            table: {
              columns: [
                { key: "market", label: "Market" },
                { key: "wave", label: "Wave" },
                { key: "candidate", label: "Candidate" },
                { key: "verdict", label: "Verdict" },
                { key: "blockers", label: "Blockers" },
              ],
              rows: buildRowsPreview(canary.rows, (row) => ({
                market: compactText(row.market),
                wave: numberText(row.wave, 0),
                candidate: compactText(row.candidate_id),
                verdict: compactText(row.canary_verdict),
                blockers: joinList(row.blockers, "-"),
              }), 5),
            },
          },
          {
            title: "Deployment Guards",
            tone: statusTone(deploymentGuards.summary.deploy_pass ? "PASS" : "FAIL"),
            rows: [
              { label: "Target", value: compactText(deploymentGuards.summary.target_candidate_id) },
              { label: "Promotion Ready", value: deploymentGuards.summary.promotion_ready ? "YES" : "NO" },
              { label: "Canary Open Wave", value: numberText(deploymentGuards.summary.canary_open_wave, 0) },
              { label: "Memory Blocked", value: numberText(deploymentGuards.summary.memory_blocked_candidate_n, 0) },
            ],
            table: {
              columns: [
                { key: "market", label: "Market" },
                { key: "wave", label: "Wave" },
                { key: "candidate", label: "Candidate" },
                { key: "deploy", label: "Deploy" },
                { key: "blockers", label: "Blockers" },
              ],
              rows: buildRowsPreview(deploymentGuards.rows, (row) => ({
                market: compactText(row.market),
                wave: numberText(row.wave, 0),
                candidate: compactText(row.candidate_id),
                deploy: row.deploy_pass ? "PASS" : "HOLD",
                blockers: joinList(row.blockers, "-"),
              }), 6),
            },
          },
        ],
      },
    ],
  };
}

function buildDeploymentViewModel() {
  const deploymentPlan = loadLatestArtifact("best_self_evolution_deployment_plan_latest.json");
  const deploymentProbe = loadLatestArtifact("best_self_evolution_deployment_probe_latest.json");
  const bundleActivation = loadLatestArtifact("best_self_evolution_bundle_activation_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const runtimeAck = loadLatestArtifact("self_evolution_manual_paste_ack_latest.json");
  const policyBundle = buildPolicyBundleLabel(deploymentPlan, stageAutopilot);
  return {
    active: "deployment",
    title: "Deployment",
    hero: {
      eyebrow: "Bundle Deployment",
      title: compactText(deploymentPlan.summary.plan_status),
      detail: `${compactText(deploymentPlan.summary.activation_status)} · ${compactText(deploymentPlan.summary.activation_reason)}`,
      tone: statusTone(deploymentPlan.summary.plan_status),
      pills: [
        { label: "Authority", value: compactText(deploymentPlan.summary.authority_state), tone: statusTone(deploymentPlan.summary.authority_state) },
        { label: "Probe", value: compactText(deploymentProbe.summary.probe_status), tone: statusTone(deploymentProbe.summary.probe_status) },
        { label: "Activation", value: compactText(bundleActivation.summary.activation_status), tone: statusTone(bundleActivation.summary.activation_status) },
        { label: "Primary", value: compactText(deploymentPlan.summary.deploy_unit_primary), tone: "dim" },
      ],
      actions: [{ label: "Mission", href: "/dashboard/home", tone: "ghost" }],
    },
    metrics: [
      { label: "Engine Bundle", value: compactText(deploymentPlan.summary.active_engine_bundle && deploymentPlan.summary.active_engine_bundle.strategy_id), meta: compactText(deploymentPlan.summary.rollback_engine_bundle_id), tone: "ok" },
      { label: "Policy Bundle", value: compactText(deploymentPlan.summary.active_policy_bundle && deploymentPlan.summary.active_policy_bundle.source), meta: compactText(deploymentPlan.summary.recommended_target_stage_reason), tone: "warn" },
      { label: "Probe", value: compactText(deploymentProbe.summary.probe_reason), meta: compactText(deploymentProbe.summary.latest_market_data_at_kst), tone: statusTone(deploymentProbe.summary.probe_status) },
      { label: "Activation", value: compactText(bundleActivation.summary.activation_reason), meta: compactText(bundleActivation.summary.confirmation_deadline_kst), tone: statusTone(bundleActivation.summary.activation_status) },
    ],
    sections: [
      {
        title: "Bundle State",
        description: "active / prepared / rollback 번들을 함께 읽습니다.",
        columns: 3,
        cards: [
          {
            title: "Engine Bundle",
            tone: "ok",
            rows: [
              { label: "Active", value: compactText(deploymentPlan.summary.active_engine_bundle_id) },
              { label: "Prepared", value: compactText(deploymentPlan.summary.prepared_engine_bundle_id) },
              { label: "Rollback", value: compactText(deploymentPlan.summary.rollback_engine_bundle_id) },
              { label: "Strategy", value: compactText(deploymentPlan.summary.active_engine_bundle && deploymentPlan.summary.active_engine_bundle.strategy_id) },
            ],
          },
          {
            title: "Policy Bundle",
            tone: "warn",
            rows: [
              { label: "Active", value: compactText(policyBundle.primary, 84) },
              { label: "Stage Reason", value: compactText(deploymentPlan.summary.recommended_target_stage_reason) },
              { label: "Source Mode Signature", value: compactText(deploymentPlan.summary.source_mode_signature, 84) },
              { label: "Threshold Signature", value: compactText(deploymentPlan.summary.threshold_bundle_signature, 84) },
            ],
          },
          {
            title: "Approval and Probe",
            tone: statusTone(deploymentPlan.summary.authority_state),
            rows: [
              { label: "Authority", value: compactText(deploymentPlan.summary.authority_state) },
              { label: "Approved", value: deploymentPlan.summary.authority_approved ? "YES" : "NO" },
              { label: "Probe", value: compactText(deploymentProbe.summary.probe_reason) },
              { label: "Activation", value: compactText(bundleActivation.summary.activation_reason) },
            ],
          },
        ],
      },
      {
        title: "Readiness Chain",
        description: "prepared -> probe -> activation -> runtime ack 경로를 연속해서 봅니다.",
        columns: 3,
        cards: [
          {
            title: "Prepared State",
            tone: statusTone(deploymentPlan.summary.prepare_pass ? "PASS" : "FAIL"),
            rows: [
              { label: "Prepare Pass", value: deploymentPlan.summary.prepare_pass ? "YES" : "NO" },
              { label: "Manual Step", value: deploymentPlan.summary.manual_step_required ? "YES" : "NO" },
              { label: "Ack", value: deploymentPlan.summary.manual_paste_acknowledged ? "YES" : "NO" },
              { label: "Origin", value: compactText(deploymentPlan.summary.applied_origin_display_candidate_id || deploymentPlan.summary.applied_origin_candidate_id) },
            ],
          },
          {
            title: "Probe Detail",
            tone: statusTone(deploymentProbe.summary.probe_status),
            rows: [
              { label: "Engine Loaded", value: deploymentProbe.summary.engine_bundle_loaded ? "YES" : "NO" },
              { label: "Policy Loaded", value: deploymentProbe.summary.policy_bundle_loaded ? "YES" : "NO" },
              { label: "Data Flow", value: deploymentProbe.summary.market_data_flow_ok ? "YES" : "NO" },
              { label: "Latest Data", value: compactText(deploymentProbe.summary.latest_market_data_at_kst) },
            ],
          },
          {
            title: "Runtime Ack",
            tone: statusTone(runtimeAck.summary && runtimeAck.summary.plan_status),
            rows: [
              { label: "Acknowledged", value: runtimeAck.raw && runtimeAck.raw.acknowledged ? "YES" : "NO" },
              { label: "Plan Status", value: compactText(runtimeAck.summary && runtimeAck.summary.plan_status) },
              { label: "Engine Loaded", value: runtimeAck.raw && runtimeAck.raw.engine_bundle_loaded ? "YES" : "NO" },
              { label: "Activation", value: compactText(runtimeAck.raw && runtimeAck.raw.bundle_activation_status) },
            ],
          },
        ],
      },
    ],
  };
}

function buildExecutionViewModel() {
  const parity = loadLatestArtifact("best_self_evolution_canonical_engine_parity_latest.json");
  const provenance = loadLatestArtifact("best_self_evolution_canonical_engine_provenance_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const sourceMode = buildSourceModeText(stageAutopilot);
  const canonicalPolicyRow = pickStageRow(stageAutopilot, "CANONICAL_POLICY");
  const paritySummary = parity.summary;
  const provenanceSummary = provenance.summary;
  return {
    active: "execution",
    title: "Execution",
    hero: {
      eyebrow: "Canonical Execution",
      title: sourceMode.value,
      detail: sourceMode.detail,
      tone: sourceMode.tone,
      pills: [
        { label: "Source Parity", value: `${numberText(paritySummary.source_parity_match_n, 0)}/${numberText(paritySummary.shadow_observed_n, 0)}`, tone: statusTone(paritySummary.source_parity_mismatch_n === 0 ? "PASS" : "FAIL") },
        { label: "Downstream", value: numberText(paritySummary.final_downstream_mismatch_n, 0), tone: paritySummary.final_downstream_mismatch_n > 0 ? "warn" : "ok" },
        { label: "Provenance", value: `${numberText(provenanceSummary.complete_n, 0)}/${numberText(provenanceSummary.engine_eligible_n, 0)}`, tone: statusTone(provenanceSummary.complete_n > 0 ? "PASS" : "WARN") },
        { label: "Execution Source", value: joinList((provenanceSummary.by_execution_source || []).map((row) => `${row.key}:${row.count}`)), tone: "dim" },
      ],
      actions: [
        { label: "Phase D", href: "/dashboard/server-primary", tone: "ghost" },
        { label: "Audit", href: "/dashboard/audit", tone: "ghost" },
      ],
    },
    metrics: [
      { label: "Source Mode", value: sourceMode.value, meta: sourceMode.detail, tone: sourceMode.tone },
      { label: "Source Parity", value: numberText(paritySummary.source_parity_mismatch_n, 0), meta: `stored ${numberText(paritySummary.source_evidence_stored_n, 0)} / derived ${numberText(paritySummary.source_evidence_derived_n, 0)}`, tone: statusTone(paritySummary.source_parity_mismatch_n === 0 ? "PASS" : "FAIL") },
      { label: "Downstream Mismatch", value: numberText(paritySummary.final_downstream_mismatch_n, 0), meta: compactText(paritySummary.top_downstream_reason || "policy gates"), tone: paritySummary.final_downstream_mismatch_n > 0 ? "warn" : "ok" },
      { label: "Provenance Complete", value: `${numberText(provenanceSummary.complete_n, 0)}/${numberText(provenanceSummary.engine_eligible_n, 0)}`, meta: `exec src ${numberText(provenanceSummary.with_execution_source_n, 0)} / overlay ${numberText(provenanceSummary.with_pine_overlay_role_n, 0)}`, tone: statusTone(provenanceSummary.complete_n > 0 ? "PASS" : "WARN") },
    ],
    sections: [
      {
        title: "Execution Evidence",
        description: "source parity와 provenance를 분리해 보여줍니다.",
        columns: 3,
        cards: [
          {
            title: "Active Policy",
            tone: "warn",
            rows: [
              { label: "Threshold", value: extractThresholdPair(canonicalPolicyRow && canonicalPolicyRow.active_signature) || "-" },
              { label: "Policy Reason", value: compactText(canonicalPolicyRow && canonicalPolicyRow.active_reason) },
              { label: "Source Mode", value: sourceMode.value },
              { label: "Acceptance", value: sourceMode.detail },
            ],
          },
          {
            title: "Parity",
            tone: statusTone(paritySummary.source_parity_mismatch_n === 0 ? "PASS" : "FAIL"),
            rows: [
              { label: "Observed", value: numberText(paritySummary.shadow_observed_n, 0) },
              { label: "Source Mismatch", value: numberText(paritySummary.source_parity_mismatch_n, 0) },
              { label: "Downstream Mismatch", value: numberText(paritySummary.final_downstream_mismatch_n, 0) },
              { label: "Stored Evidence", value: numberText(paritySummary.source_evidence_stored_n, 0) },
            ],
          },
          {
            title: "Provenance",
            tone: statusTone(provenanceSummary.complete_n > 0 ? "PASS" : "WARN"),
            rows: [
              { label: "Eligible", value: numberText(provenanceSummary.engine_eligible_n, 0) },
              { label: "Complete", value: numberText(provenanceSummary.complete_n, 0) },
              { label: "By Source", value: joinList((provenanceSummary.by_execution_source || []).map((row) => `${row.key}:${row.count}`)) },
              { label: "By Overlay", value: joinList((provenanceSummary.by_pine_overlay_role || []).map((row) => `${row.key}:${row.count}`)) },
            ],
            table: {
              columns: [
                { key: "collection", label: "Collection" },
                { key: "eligible", label: "Eligible" },
                { key: "complete", label: "Complete" },
                { key: "source", label: "Source" },
                { key: "overlay", label: "Overlay" },
              ],
              rows: buildRowsPreview(provenanceSummary.by_collection, (row) => ({
                collection: compactText(row.collection),
                eligible: numberText(row.eligible_n, 0),
                complete: numberText(row.complete_n, 0),
                source: numberText(row.with_execution_source_n, 0),
                overlay: numberText(row.with_pine_overlay_role_n, 0),
              }), 4),
            },
          },
        ],
      },
      {
        title: "Market-Level Evidence",
        description: "parity가 어디서 깨지는지 market 단위로 내려갑니다.",
        columns: 2,
        cards: [
          {
            title: "Market Parity",
            tone: "warn",
            table: {
              columns: [
                { key: "market", label: "Market" },
                { key: "comparable", label: "Observed" },
                { key: "match", label: "Match" },
                { key: "mismatch", label: "Mismatch" },
                { key: "rate", label: "Parity" },
              ],
              rows: buildRowsPreview(paritySummary.by_market_parity, (row) => ({
                market: compactText(row.key),
                comparable: numberText(row.comparable_n, 0),
                match: numberText(row.match_n, 0),
                mismatch: numberText(row.mismatch_n, 0),
                rate: toDisplayPercent(row.parity_rate, 0),
              }), 6),
            },
          },
          {
            title: "Execution Source Breakdown",
            tone: "dim",
            table: {
              columns: [
                { key: "key", label: "Source" },
                { key: "count", label: "Count" },
              ],
              rows: buildRowsPreview(provenanceSummary.by_execution_source, (row) => ({
                key: compactText(row.key),
                count: numberText(row.count, 0),
              }), 6),
            },
          },
        ],
      },
    ],
  };
}

function buildServerPrimaryViewModel() {
  const acceptanceWatch = loadLatestArtifact("best_self_evolution_server_primary_acceptance_watch_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const sourceMode = buildSourceModeText(stageAutopilot);
  return {
    active: "server-primary",
    title: "Server-Primary",
    hero: {
      eyebrow: "Phase D Acceptance",
      title: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
      detail: sourceMode.value,
      tone: statusTone(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
      pills: [
        { label: "Configured", value: numberText(acceptanceWatch.summary.configured_server_primary_markets_n, 0), tone: "dim" },
        { label: "Executed", value: `${numberText(acceptanceWatch.summary.executed_n, 0)}/${numberText(acceptanceWatch.summary.acceptance_min_executed, 0)}`, tone: "warn" },
        { label: "Disagreement", value: numberText(acceptanceWatch.summary.disagreement_rate || 0, 2), tone: "ok" },
        { label: "Rollback", value: numberText(acceptanceWatch.summary.rollback_trigger_n, 0), tone: "ok" },
      ],
      actions: [{ label: "Execution", href: "/dashboard/execution", tone: "ghost" }],
    },
    metrics: [
      { label: "Markets", value: joinList(acceptanceWatch.summary.configured_server_primary_markets || []), meta: compactText(sourceMode.value), tone: "dim" },
      { label: "Observed", value: numberText(acceptanceWatch.summary.observed_n, 0), meta: compactText(acceptanceWatch.summary.phase_d_reason), tone: "warn" },
      { label: "Executed", value: numberText(acceptanceWatch.summary.executed_n, 0), meta: `min ${numberText(acceptanceWatch.summary.acceptance_min_executed, 0)}`, tone: "warn" },
      { label: "Realized", value: numberText(acceptanceWatch.summary.realized_n, 0), meta: `disagreement ${numberText((acceptanceWatch.summary.disagreement_rate || 0) * 100, 1)}%`, tone: "ok" },
    ],
    sections: [
      {
        title: "Acceptance Threshold",
        description: "Phase D를 닫기 위한 샘플과 가드레일입니다.",
        columns: 2,
        cards: [
          {
            title: "Current Evidence",
            tone: statusTone(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
            rows: [
              { label: "Reason", value: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason) },
              { label: "Observed", value: numberText(acceptanceWatch.summary.observed_n, 0) },
              { label: "Executed", value: numberText(acceptanceWatch.summary.executed_n, 0) },
              { label: "Realized", value: numberText(acceptanceWatch.summary.realized_n, 0) },
            ],
          },
          {
            title: "Thresholds",
            tone: "dim",
            rows: [
              { label: "Min Executed", value: numberText(acceptanceWatch.summary.acceptance_min_executed || acceptanceWatch.summary.min_executed_n, 0) },
              { label: "Max Disagreement", value: numberText(((acceptanceWatch.summary.acceptance_max_disagreement_rate != null ? acceptanceWatch.summary.acceptance_max_disagreement_rate : acceptanceWatch.summary.max_disagreement_rate) || 0) * 100, 1) + "%" },
              { label: "Max Rollback", value: numberText(acceptanceWatch.summary.acceptance_max_rollback_trigger_n != null ? acceptanceWatch.summary.acceptance_max_rollback_trigger_n : acceptanceWatch.summary.max_rollback_trigger_n, 0) },
              { label: "Ready", value: acceptanceWatch.summary.acceptance_ready || acceptanceWatch.summary.phase_d_ready ? "YES" : "NO" },
            ],
          },
        ],
      },
    ],
  };
}

function buildAuditViewModel() {
  const loopMonitor = loadLatestArtifact("best_self_evolution_loop_monitor_latest.json");
  const objectiveSupervisor = loadLatestArtifact("objective_supervisor_latest.json");
  const watchdog = loadLatestArtifact("automation_watchdog_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  return {
    active: "audit",
    title: "Audit",
    hero: {
      eyebrow: "Cycle and Evidence",
      title: compactText(loopMonitor.summary.overall_status),
      detail: `${compactText(loopMonitor.summary.cycle_id)} · blockers ${joinList(loopMonitor.summary.critical_blockers || [])}`,
      tone: statusTone(loopMonitor.summary.overall_status),
      pills: [
        { label: "Cycle", value: loopMonitor.summary.cycle_consistent ? "CONSISTENT" : "MISMATCH", tone: statusTone(loopMonitor.summary.cycle_consistent ? "PASS" : "FAIL") },
        { label: "Fresh", value: `${numberText(loopMonitor.summary.fresh_loop_n, 0)}/${numberText(loopMonitor.summary.loop_n, 0)}`, tone: "ok" },
        { label: "Watchdog", value: compactText(watchdog.display && watchdog.display.verdict), tone: statusTone(watchdog.display && watchdog.display.verdict) },
        { label: "Stage Eval", value: compactText(stageAutopilot.display && stageAutopilot.display.evaluation_cycle_id), tone: "dim" },
      ],
      actions: [
        { label: "Legacy Report", href: "/dashboard/report", tone: "ghost" },
        { label: "Legacy Briefing", href: "/dashboard/briefing", tone: "ghost" },
      ],
    },
    metrics: [
      { label: "Current Cycle", value: compactText(loopMonitor.summary.cycle_id), meta: compactText(loopMonitor.summary.overall_status), tone: statusTone(loopMonitor.summary.overall_status) },
      { label: "Critical Blockers", value: numberText(loopMonitor.summary.critical_blocker_n, 0), meta: joinList(loopMonitor.summary.critical_blockers || []), tone: loopMonitor.summary.critical_blocker_n > 0 ? "bad" : "ok" },
      { label: "Watchdog", value: compactText(watchdog.display && watchdog.display.scheduler_mode), meta: `issues ${numberText(watchdog.display && watchdog.display.issue_count, 0)}`, tone: statusTone(watchdog.display && watchdog.display.verdict) },
      { label: "Supervisor", value: compactText(objectiveSupervisor.display && objectiveSupervisor.display.verdict), meta: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause), tone: statusTone(objectiveSupervisor.display && objectiveSupervisor.display.verdict) },
    ],
    sections: [
      {
        title: "Audit Chain",
        description: "cycle, freshness, wrapper 주의 대상을 같은 곳에서 확인합니다.",
        columns: 2,
        cards: [
          {
            title: "Loop Monitor",
            tone: statusTone(loopMonitor.summary.overall_status),
            rows: [
              { label: "Cycle Consistent", value: loopMonitor.summary.cycle_consistent ? "YES" : "NO" },
              { label: "Stale Artifacts", value: numberText(loopMonitor.summary.stale_artifact_n, 0) },
              { label: "Mismatch", value: numberText(loopMonitor.summary.cycle_mismatch_n, 0) },
              { label: "Ready Candidate", value: compactText(loopMonitor.summary.ready_candidate_id) },
            ],
          },
          {
            title: "Wrapper Caveat",
            tone: "warn",
            rows: [
              { label: "objective_supervisor", value: "display/raw wrapper" },
              { label: "stage_autopilot", value: "cycle_id + evaluation_cycle_id" },
              { label: "watchdog", value: "display/raw wrapper" },
              { label: "Use", value: "display first, raw on drill-down" },
            ],
          },
        ],
      },
      {
        title: "Critical Loops",
        description: "현재 cycle의 각 loop row를 직접 읽습니다.",
        columns: 2,
        cards: [
          {
            title: "Loop Rows",
            tone: statusTone(loopMonitor.summary.overall_status),
            table: {
              columns: [
                { key: "loop", label: "Loop" },
                { key: "status", label: "Status" },
                { key: "fresh", label: "Fresh" },
                { key: "reason", label: "Reason" },
              ],
              rows: buildRowsPreview(loopMonitor.rows, (row) => ({
                loop: compactText(row.loop),
                status: compactText(row.status),
                fresh: row.fresh ? "YES" : "NO",
                reason: compactText(row.reason, 56),
              }), 10),
            },
          },
          {
            title: "Stage Autopilot Caveat",
            tone: "warn",
            rows: [
              { label: "cycle_id", value: compactText(stageAutopilot.display && stageAutopilot.display.cycle_id) },
              { label: "evaluation_cycle_id", value: compactText(stageAutopilot.display && stageAutopilot.display.evaluation_cycle_id) },
              { label: "loop monitor source", value: compactText(stageAutopilot.display && stageAutopilot.display.self_evolution_loop_monitor && stageAutopilot.display.self_evolution_loop_monitor.source) },
              { label: "interpretation", value: "main cycle + post-loop re-evaluation" },
            ],
            notes: [
              "stage_autopilot latest는 post-loop 재평가를 덮어쓸 수 있습니다.",
              "cycle 판단은 loop_monitor와 함께 읽어야 합니다.",
            ],
          },
        ],
      },
    ],
  };
}

function buildControlPlaneRouteModel(pageKey) {
  const key = String(pageKey || "mission").toLowerCase();
  if (key === "recovery") return buildRecoveryViewModel();
  if (key === "deployment") return buildDeploymentViewModel();
  if (key === "execution") return buildExecutionViewModel();
  if (key === "server-primary") return buildServerPrimaryViewModel();
  if (key === "audit") return buildAuditViewModel();
  return buildMissionControlViewModel();
}

module.exports = {
  buildMissionControlViewModel,
  buildRecoveryViewModel,
  buildDeploymentViewModel,
  buildExecutionViewModel,
  buildServerPrimaryViewModel,
  buildAuditViewModel,
  buildControlPlaneRouteModel,
};
