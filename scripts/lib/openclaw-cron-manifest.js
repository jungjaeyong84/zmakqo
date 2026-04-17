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
]);

const LEGACY_OPENCLAW_CRON_JOB_NAMES = Object.freeze([
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
  LEGACY_OPENCLAW_CRON_JOB_NAMES,
  buildCronArtifactMap,
  buildOpenClawCronMessage,
};
