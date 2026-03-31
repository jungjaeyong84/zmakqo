"use strict";

const REPO_ROOT = "/Users/jeongjaeyong/Projects/donbeolja";

const OPENCLAW_CRON_JOBS = Object.freeze([
  {
    label: "com.jeongjaeyong.donbeolja.analyticscache",
    name: "donbeolja-analytics-cache",
    wrapper: `${REPO_ROOT}/ops/launchd/run_analytics_local_cache.sh`,
    every: "2h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.automationwatchdog",
    name: "donbeolja-automation-watchdog",
    wrapper: `${REPO_ROOT}/ops/launchd/run_automation_watchdog.sh`,
    every: "1h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.codexweeklypatch",
    name: "donbeolja-codex-weekly-patch",
    wrapper: `${REPO_ROOT}/ops/launchd/run_codex_weekly_patch_engine.sh`,
    cron: "50 8 * * 0",
  },
  {
    label: "com.jeongjaeyong.donbeolja.evtp1tune",
    name: "donbeolja-ev-tp1-tune",
    wrapper: `${REPO_ROOT}/ops/launchd/run_ev_tp1_threshold_tune.sh`,
    every: "72h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.filtershadowcanary",
    name: "donbeolja-filter-shadow-canary",
    wrapper: `${REPO_ROOT}/ops/launchd/run_filter_shadow_canary.sh`,
    every: "6h",
    runAtLoad: true,
  },
  {
    label: "com.jeongjaeyong.donbeolja.hourlyguard",
    name: "donbeolja-hourly-guard",
    wrapper: `${REPO_ROOT}/ops/launchd/run_hourly_guard.sh`,
    cron: "0 * * * *",
  },
  {
    label: "com.jeongjaeyong.donbeolja.mlfilterpolicy",
    name: "donbeolja-ml-filter-policy",
    wrapper: `${REPO_ROOT}/ops/launchd/run_ml_filter_policy.sh`,
    every: "6h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.objectiveretrospective",
    name: "donbeolja-objective-retrospective",
    wrapper: `${REPO_ROOT}/ops/launchd/run_objective_retrospective.sh`,
    cron: "30 23 * * *",
  },
  {
    label: "com.jeongjaeyong.donbeolja.objectivesupervisor",
    name: "donbeolja-objective-supervisor",
    wrapper: `${REPO_ROOT}/ops/launchd/run_objective_supervisor.sh`,
    every: "6h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.rollbackmonitor",
    name: "donbeolja-rollback-monitor",
    wrapper: `${REPO_ROOT}/ops/launchd/run_rollback_monitor.sh`,
    every: "6h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.signaldataintegrity",
    name: "donbeolja-signal-data-integrity",
    wrapper: `${REPO_ROOT}/ops/launchd/run_signal_data_integrity.sh`,
    every: "6h",
    runAtLoad: true,
  },
  {
    label: "com.jeongjaeyong.donbeolja.stageautopilot",
    name: "donbeolja-stage-autopilot",
    wrapper: `${REPO_ROOT}/ops/launchd/run_stage_autopilot.sh`,
    every: "6h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.stageoutcomeledgers",
    name: "donbeolja-stage-outcome-ledgers",
    wrapper: `${REPO_ROOT}/ops/launchd/run_stage_outcome_ledgers.sh`,
    every: "4h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.waitonebartune",
    name: "donbeolja-wait-one-bar-tune",
    wrapper: `${REPO_ROOT}/ops/launchd/run_wait_one_bar_tune.sh`,
    every: "120h",
  },
  {
    label: "com.jeongjaeyong.donbeolja.weeklyfilters",
    name: "donbeolja-weekly-filters",
    wrapper: `${REPO_ROOT}/ops/launchd/run_weekly_filter_governance.sh`,
    cron: "40 8 * * 0",
  },
  {
    label: "com.jeongjaeyong.donbeolja.weeklypine",
    name: "donbeolja-weekly-pine",
    wrapper: `${REPO_ROOT}/ops/launchd/run_weekly_pine_upgrade.sh`,
    cron: "0 9 * * 0",
  },
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

module.exports = {
  REPO_ROOT,
  OPENCLAW_CRON_JOBS,
  buildOpenClawCronMessage,
};
