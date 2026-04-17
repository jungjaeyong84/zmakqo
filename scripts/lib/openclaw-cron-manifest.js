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
  {
    // OpenClaw ML+AI agent — Phase B outcome linker (joins evidence ledger ↔ fills_paper).
    // Runs every 15 minutes so the calibration job downstream always has fresh labels.
    job_id: "openclaw_agent_evidence_linker",
    label: "com.jeongjaeyong.donbeolja.openclawlinker",
    name: "donbeolja-openclaw-evidence-linker",
    wrapper: `${REPO_ROOT}/ops/launchd/run_openclaw_evidence_linker.sh`,
    cron: "*/15 * * * *",
    owner: "openclaw",
    criticality: "MEDIUM",
    produces_artifact: "openclaw_evidence_linker_latest.json",
    artifact_sla_hours: 1,
    depends_on: [],
    recovery_strategy: "re-run-once",
    scheduler_sot: OPENCLAW_SCHEDULER_SOT,
  },
  {
    // OpenClaw ML+AI agent — Phase B calibration (per-source hit rate → trust_weights).
    // Drives autonomy auto-degrade: when a source trust falls below floor, its vote is dropped.
    // 4h cadence at :05 so it always runs after a fresh evidence_linker snapshot.
    job_id: "openclaw_agent_calibration",
    label: "com.jeongjaeyong.donbeolja.openclawcalibration",
    name: "donbeolja-openclaw-calibration",
    wrapper: `${REPO_ROOT}/ops/launchd/run_openclaw_calibration.sh`,
    cron: "5 */4 * * *",
    owner: "openclaw",
    criticality: "HIGH",
    produces_artifact: "openclaw_calibration_latest.json",
    artifact_sla_hours: 5,
    depends_on: ["openclaw_agent_evidence_linker"],
    recovery_strategy: "re-run-once",
    scheduler_sot: OPENCLAW_SCHEDULER_SOT,
  },
  {
    // OpenClaw ML+AI agent — Phase D retrospect loop (4h narrative review).
    // Safety-rail: only risk-reducing proposals (scale ≤ 1, no widen_sl/increase_qty) may stamp.
    // Offset by +15min so retrospect always sees the latest calibration trust_weights.
    job_id: "openclaw_agent_retrospect",
    label: "com.jeongjaeyong.donbeolja.openclawretrospect",
    name: "donbeolja-openclaw-retrospect",
    wrapper: `${REPO_ROOT}/ops/launchd/run_openclaw_retrospect.sh`,
    cron: "15 */4 * * *",
    owner: "openclaw",
    criticality: "MEDIUM",
    produces_artifact: "openclaw_retrospect_latest.json",
    artifact_sla_hours: 5,
    depends_on: ["openclaw_agent_calibration"],
    recovery_strategy: "re-run-once",
    scheduler_sot: OPENCLAW_SCHEDULER_SOT,
  },
  {
    // OpenClaw ML+AI agent — weekly telegram retrospect summary.
    // Never emits agent decisions; only sends aggregate counts + trust weights.
    // Mondays 09:00 KST. Produces no artifact (stdout-only), so we mark
    // produces_artifact null and the artifact freshness gate skips this job.
    job_id: "openclaw_agent_weekly_summary",
    label: "com.jeongjaeyong.donbeolja.openclawweekly",
    name: "donbeolja-openclaw-weekly-summary",
    wrapper: `${REPO_ROOT}/ops/launchd/run_openclaw_weekly_summary.sh`,
    cron: "0 9 * * 1",
    owner: "openclaw",
    criticality: "LOW",
    produces_artifact: null,
    artifact_sla_hours: null,
    depends_on: ["openclaw_agent_retrospect", "openclaw_agent_calibration"],
    recovery_strategy: "skip",
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
