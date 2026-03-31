# Runtime Memory

- This workspace exists to let OpenClaw cron own donbeolja local automations.
- Approved entrypoints are the shell wrappers in `ops/launchd/`.
- Automation watchdog treats OpenClaw cron as the scheduler SSOT and launchd only as legacy diagnostics.
- Current sender policy: Telegram alerts should flow through OpenClaw-first transport in `src/utils/alerts.js`.
- Do not rewrite schedules during a run; only execute the requested wrapper and summarize the outcome.
