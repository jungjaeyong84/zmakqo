"use strict";

const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OPENCLAW_SCHEDULER_SOT = "OPENCLAW_CRON";

const OPENCLAW_CRON_JOBS = Object.freeze([
  {
    job_id: "binance_exit_integrity_cycle",
    label: "com.jeongjaeyong.donbeolja.exitintegrity",
    name: "donbeolja-binance-exit-integrity-cycle",
    wrapper: `${REPO_ROOT}/ops/launchd/run_binance_exit_integrity_cycle.sh`,
    cron: "0 */4 * * *",
    runAtLoad: true,
    owner: "openclaw",
    criticality: "HIGH",
    produces_artifact: "binance_exit_integrity_cycle_latest.json",
    artifact_sla_hours: 5,
    depends_on: [],
    recovery_strategy: "re-run-once",
    scheduler_sot: OPENCLAW_SCHEDULER_SOT,
  },
  {
    job_id: "openclaw_hourly_cycle",
    label: "com.jeongjaeyong.donbeolja.openclawhourly",
    name: "donbeolja-openclaw-hourly-cycle",
    wrapper: `${REPO_ROOT}/ops/launchd/run_openclaw_hourly_cycle.sh`,
    cron: "0 * * * *",
    runAtLoad: true,
    owner: "openclaw",
    criticality: "HIGH",
    produces_artifact: "openclaw_hourly_cycle_latest.json",
    artifact_sla_hours: 2,
    depends_on: [],
    recovery_strategy: "re-run-once",
    scheduler_sot: OPENCLAW_SCHEDULER_SOT,
  },
  {
    job_id: "v2_repair_queue_service",
    label: "com.jeongjaeyong.donbeolja.v2repairqueue",
    name: "donbeolja-v2-repair-queue-service",
    wrapper: `${REPO_ROOT}/ops/launchd/run_v2_repair_queue_service.sh`,
    cron: "*/2 * * * *",
    runAtLoad: true,
    owner: "openclaw",
    criticality: "HIGH",
    produces_artifact: "v2_repair_queue_service_latest.json",
    artifact_sla_hours: 0.25,
    depends_on: [],
    recovery_strategy: "re-run-once",
    scheduler_sot: OPENCLAW_SCHEDULER_SOT,
  },
  {
    job_id: "openclaw_daily_cycle",
    label: "com.jeongjaeyong.donbeolja.openclawdaily",
    name: "donbeolja-openclaw-daily-cycle",
    wrapper: `${REPO_ROOT}/ops/launchd/run_openclaw_daily_cycle.sh`,
    cron: "30 23 * * *",
    owner: "openclaw",
    criticality: "HIGH",
    produces_artifact: "openclaw_daily_cycle_latest.json",
    artifact_sla_hours: 30,
    depends_on: ["openclaw_hourly_cycle"],
    recovery_strategy: "re-run-once",
    scheduler_sot: OPENCLAW_SCHEDULER_SOT,
  },
  // NOTE (2026-04-18): the four OpenClaw agent-cycle crons that used to
  // live here (evidence_linker / calibration / retrospect /
  // weekly_summary) were migrated to Cloud Scheduler hitting
  // /api/openclaw/cron/* on the donbeolja Cloud Run service after the
  // 2026-04-17 cost incident. They are intentionally NOT in
  // OPENCLAW_CRON_JOBS so the local automation-watchdog stops flagging
  // them as launchd MISSING. See OPENCLAW_CLOUD_SCHEDULER_JOBS below.
]);

const OPENCLAW_OPTIONAL_CRON_JOBS = Object.freeze([
  {
    job_id: "v2_repair_queue_firestore_canary_collector",
    label: "com.jeongjaeyong.donbeolja.v2repairfirestorecanary",
    name: "donbeolja-v2-repair-firestore-canary-collector",
    wrapper: `${REPO_ROOT}/ops/launchd/run_v2_repair_queue_firestore_canary_collector.sh`,
    plist: `${REPO_ROOT}/ops/launchd/com.jeongjaeyong.donbeolja.v2repairfirestorecanary.plist`,
    cron: "0 */2 * * *",
    start_interval_seconds: 7200,
    runAtLoad: false,
    owner: "openclaw",
    criticality: "MEDIUM",
    produces_artifact: "v2_repair_queue_firestore_canary_latest.json",
    artifact_sla_hours: 3,
    depends_on: [],
    recovery_strategy: "re-run-once",
    scheduler_sot: OPENCLAW_SCHEDULER_SOT,
    opt_in_env: "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED=1",
  },
]);

// Cloud Scheduler jobs — same OpenClaw agent crons, but invoked via HTTP
// POST on the `donbeolja` Cloud Run service instead of launchd on the
// operator's laptop. The local watchdog deliberately does not check
// these (Cloud Scheduler state is observable in GCP Console directly).
const OPENCLAW_CLOUD_SCHEDULER_JOBS = Object.freeze([
  // 2026-04-28 senior audit Step 18 — produces_artifact + artifact_sla_hours
  // added so dashboard.openclaw.routes (which reads this manifest to populate
  // body.artifacts) can locate the artifact filenames after the 2026-04-18
  // migration moved these jobs from local launchd to Cloud Scheduler.
  // Without these fields the dashboard surfaced an empty `artifacts` block.
  {
    job_id: "openclaw_agent_evidence_linker",
    scheduler_name: "openclaw-evidence-linker",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "0 */6 * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/evidence-linker?lookback_days=1",
    owner: "openclaw",
    criticality: "MEDIUM",
    produces_artifact: "openclaw_evidence_linker_latest.json",
    artifact_sla_hours: 6,
  },
  {
    job_id: "openclaw_agent_calibration",
    scheduler_name: "openclaw-calibration",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "15 6 * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/calibration",
    owner: "openclaw",
    criticality: "HIGH",
    produces_artifact: "openclaw_calibration_latest.json",
    artifact_sla_hours: 26,
  },
  {
    job_id: "openclaw_agent_retrospect",
    scheduler_name: "openclaw-retrospect",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "30 6 * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/retrospect?lookback_hours=24",
    owner: "openclaw",
    criticality: "MEDIUM",
    produces_artifact: "openclaw_retrospect_latest.json",
    artifact_sla_hours: 26,
  },
  {
    job_id: "v2_production_entry_route_canary",
    scheduler_name: "v2-production-entry-route-canary",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "5 * * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/v2-production-entry-route-canary",
    owner: "openclaw",
    criticality: "HIGH",
    canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
  },
  {
    job_id: "v2_exit_runtime_canary",
    scheduler_name: "v2-exit-runtime-canary",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "35 * * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/v2-exit-runtime-canary",
    owner: "openclaw",
    criticality: "HIGH",
    canary_mode: "LIVE_EXIT_RUNTIME_OBSERVATION",
  },
  {
    job_id: "v2_active_protection_reconciliation",
    scheduler_name: "v2-active-protection-reconciliation",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "0 * * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/v2-active-protection-reconciliation",
    owner: "openclaw",
    criticality: "HIGH",
    canary_mode: "LIVE_ACTIVE_PROTECTION_RECONCILIATION",
    produces_artifact: "v2_active_protection_reconciliation_latest.json",
  },
  {
    job_id: "v2_fill_sync",
    scheduler_name: "v2-fill-sync",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "*/5 * * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/v2-fill-sync",
    owner: "openclaw",
    criticality: "HIGH",
    runtime_mode: "LIVE_USER_TRADE_FILL_SYNC",
  },
  {
    job_id: "openclaw_server_primary_tick",
    scheduler_name: "openclaw-server-primary-tick",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "1,16,31,46 * * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/openclaw-server-primary-tick",
    owner: "openclaw",
    criticality: "HIGH",
    runtime_mode: "SERVER_PRIMARY_PAPER",
  },
  {
    job_id: "v2_signal_shadow_counterfactual_walker",
    scheduler_name: "v2-signal-shadow-counterfactual-walker",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "*/15 * * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/v2-signal-shadow-counterfactual-walker",
    owner: "openclaw",
    criticality: "MEDIUM",
    runtime_mode: "SHADOW_COUNTERFACTUAL_WALKER",
  },
  {
    job_id: "v2_signal_shadow_counterfactual_analyzer",
    scheduler_name: "v2-signal-shadow-counterfactual-analyzer",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "0 7 * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/v2-signal-shadow-counterfactual-analyzer",
    owner: "openclaw",
    criticality: "MEDIUM",
    produces_artifact: "v2_signal_shadow_counterfactual_analysis_latest.json",
    runtime_mode: "SHADOW_COUNTERFACTUAL_ANALYZER",
  },
  // weekly_summary intentionally not recreated until the evidence
  // ledger accumulates enough data to make the digest worth reading.
]);

const LEGACY_OPENCLAW_CRON_JOB_NAMES = Object.freeze([
  // Pre-2026-04-18 launchd cron names that no longer exist on disk.
  // The watchdog uses this list to avoid flagging their absence.
  "donbeolja-openclaw-evidence-linker",
  "donbeolja-openclaw-calibration",
  "donbeolja-openclaw-retrospect",
  "donbeolja-openclaw-weekly-summary",
  "donbeolja-automation-watchdog",
  "donbeolja-hourly-guard",
  "donbeolja-analytics-cache",
  "donbeolja-objective-retrospective",
  "donbeolja-stage-outcome-ledgers",
  "donbeolja-filter-shadow-canary",
  "donbeolja-ml-filter-policy",
  "donbeolja-objective-supervisor",
  "donbeolja-rollback-monitor",
  "donbeolja-signal-data-integrity",
  "donbeolja-stage-autopilot",
  "donbeolja-ev-tp1-tune",
  "donbeolja-weekly-filters",
  "donbeolja-codex-weekly-patch",
  "donbeolja-weekly-pine",
  "donbeolja-wait-one-bar-tune",
]);

function buildOpenClawCronMessage(job) {
  const wrapperName = String(job && job.wrapper || "").split("/").pop() || "run.sh";
  return [
    `Run \`${job.wrapper}\` exactly once using zsh.`,
    `Working directory is \`${REPO_ROOT}\`.`,
    "Do not edit product code or schedules during this run.",
    `If the wrapper succeeds, reply exactly: OK ${wrapperName}`,
    `If the wrapper fails, reply exactly: FAIL ${wrapperName} :: <last meaningful error line>`,
  ].join("\n");
}

function buildCronArtifactMap(jobs = OPENCLAW_CRON_JOBS) {
  return Object.freeze(
    Object.fromEntries(
      (Array.isArray(jobs) ? jobs : [])
        .map((job) => {
          const name = String(job && job.name || "").trim();
          const artifact = String(job && job.produces_artifact || "").trim();
          if (!name || !artifact) return null;
          return [name, artifact.replace(/_latest\.json$/i, "")];
        })
        .filter(Boolean)
    )
  );
}

const OPENCLAW_CRON_ARTIFACT_MAP = buildCronArtifactMap();

module.exports = {
  REPO_ROOT,
  OPENCLAW_SCHEDULER_SOT,
  OPENCLAW_CRON_JOBS,
  OPENCLAW_OPTIONAL_CRON_JOBS,
  OPENCLAW_CRON_ARTIFACT_MAP,
  OPENCLAW_CLOUD_SCHEDULER_JOBS,
  LEGACY_OPENCLAW_CRON_JOB_NAMES,
  buildCronArtifactMap,
  buildOpenClawCronMessage,
};
