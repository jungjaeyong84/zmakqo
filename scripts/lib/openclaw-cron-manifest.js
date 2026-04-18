"use strict";

const REPO_ROOT = "/Users/jeongjaeyong/Projects/donbeolja";
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

// Cloud Scheduler jobs — same OpenClaw agent crons, but invoked via HTTP
// POST on the `donbeolja` Cloud Run service instead of launchd on the
// operator's laptop. The local watchdog deliberately does not check
// these (Cloud Scheduler state is observable in GCP Console directly).
const OPENCLAW_CLOUD_SCHEDULER_JOBS = Object.freeze([
  {
    job_id: "openclaw_agent_evidence_linker",
    scheduler_name: "openclaw-evidence-linker",
    scheduler_region: "asia-northeast3",
    scheduler_schedule: "0 */6 * * *",
    scheduler_time_zone: "Asia/Seoul",
    http_path: "/api/openclaw/cron/evidence-linker?lookback_days=1",
    owner: "openclaw",
    criticality: "MEDIUM",
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
  OPENCLAW_CRON_ARTIFACT_MAP,
  OPENCLAW_CLOUD_SCHEDULER_JOBS,
  LEGACY_OPENCLAW_CRON_JOB_NAMES,
  buildCronArtifactMap,
  buildOpenClawCronMessage,
};
