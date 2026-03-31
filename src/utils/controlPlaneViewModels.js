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

  const sourceMode = buildSourceModeText(stageAutopilot);
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
            title: "Objective Recovery",
            tone: statusTone(objectiveSupervisor.display && objectiveSupervisor.display.verdict),
            rows: [
              { label: "Root Cause", value: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause) },
              { label: "Recovery Target", value: compactText(recoveryGovernor.summary.display_candidate_id || recoveryGovernor.summary.target_candidate_id) },
              { label: "Projected Score", value: signedNumberText(recoveryEffect.summary.projected_objective_score, 2) },
              { label: "Gap Closure", value: `${numberText((recoveryEffect.summary.gap_closure_rate || 0) * 100, 1)}%` },
            ],
            notes: objectiveSupervisor.display && Array.isArray(objectiveSupervisor.display.action_plan)
              ? objectiveSupervisor.display.action_plan.slice(0, 3)
              : [],
          },
          {
            title: "Governor Status",
            tone: statusTone(recoveryGovernor.summary.governor_status),
            rows: [
              { label: "Status", value: compactText(recoveryGovernor.summary.governor_status) },
              { label: "Reason", value: compactText(recoveryGovernor.summary.governor_reason) },
              { label: "Replay / Canary", value: `${recoveryGovernor.summary.replay_pass ? "PASS" : "FAIL"} / ${recoveryGovernor.summary.canary_ready ? "READY" : "HOLD"}` },
              { label: "Higher Delta", value: compactText(recoveryEffect.summary.higher_delta_candidate_id || "N/A") },
            ],
            actions: [
              { label: "Open Recovery", href: "/dashboard/recovery", tone: "ghost" },
            ],
          },
        ],
      },
      {
        title: "Operational State",
        description: "배포와 실행 근거를 같은 표면에서 읽습니다.",
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
            title: "Audit",
            tone: statusTone(loopMonitor.summary.overall_status),
            rows: [
              { label: "Cycle", value: compactText(loopMonitor.summary.cycle_id) },
              { label: "Loop Freshness", value: `${numberText(loopMonitor.summary.fresh_loop_n, 0)}/${numberText(loopMonitor.summary.loop_n, 0)}` },
              { label: "Critical Blocker", value: compactText(topBlocker) },
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
        columns: 2,
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
        ],
      },
    ],
  };
}

function buildDeploymentViewModel() {
  const deploymentPlan = loadLatestArtifact("best_self_evolution_deployment_plan_latest.json");
  const deploymentProbe = loadLatestArtifact("best_self_evolution_deployment_probe_latest.json");
  const bundleActivation = loadLatestArtifact("best_self_evolution_bundle_activation_latest.json");
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
        columns: 2,
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
              { label: "Active", value: compactText(deploymentPlan.summary.active_policy_bundle && deploymentPlan.summary.active_policy_bundle.source) },
              { label: "Stage Reason", value: compactText(deploymentPlan.summary.recommended_target_stage_reason) },
              { label: "Source Mode Signature", value: compactText(deploymentPlan.summary.source_mode_signature) },
              { label: "Threshold Signature", value: compactText(deploymentPlan.summary.threshold_bundle_signature) },
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
        columns: 2,
        cards: [
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
              { label: "Min Executed", value: numberText(acceptanceWatch.summary.acceptance_min_executed, 0) },
              { label: "Max Disagreement", value: numberText((acceptanceWatch.summary.acceptance_max_disagreement_rate || 0) * 100, 1) + "%" },
              { label: "Max Rollback", value: numberText(acceptanceWatch.summary.acceptance_max_rollback_trigger_n, 0) },
              { label: "Ready", value: acceptanceWatch.summary.acceptance_ready ? "YES" : "NO" },
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
