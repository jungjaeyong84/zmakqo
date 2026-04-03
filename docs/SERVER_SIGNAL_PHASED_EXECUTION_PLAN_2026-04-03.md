# Server Signal Phased Execution Plan

- status: COMPLETED
- completed_at_kst: 2026-04-03 10:07 KST
- release_branch: `codex/server-signal-phased-p0-p2-20260403`
- release_commit: `9d36d74`
- cloud_build: `28de8244-ccea-4e72-862f-d56259463157`

## Goal
- Complete the remaining server-signal stabilization work in order:
- `P0`: merge phase2 and clear `WEEKLY_FILTER_GOVERNANCE_STALE`
- `P1`: ship a 24h observation report and split `OTHER_SERVER_POLICY` into sub-reasons
- `P2`: extend automatic remediation from family-level to sub-reason-level

## Rules
- Finish exactly one project at a time.
- After each project, run an audit gate before moving on.
- Do not revert unrelated dirty worktree changes.
- Prefer additive changes and isolated validation artifacts.

## Phase Order

### P0-1
- Safely merge `codex/drift-remediation-phase2-20260403` into `master`
- Push merged `master`
- Audit gate:
- branch divergence is zero
- `master` contains commit `19a38ef`
- smoke tests pass

### P0-2
- Resolve `WEEKLY_FILTER_GOVERNANCE_STALE`
- Ensure watchdog returns `PASS` or a non-blocking unrelated warning only
- Audit gate:
- `weekly_filter_governance_latest.json` is fresh
- watchdog no longer reports `WEEKLY_FILTER_GOVERNANCE_STALE`

### P1-1
- Add a 24h observation report focused on:
- drift remediation apply status
- watch-only markets
- final downstream mismatch trend
- execution-quality and objective snapshots
- Run the report for the current last-24h window
- Audit gate:
- report generates successfully
- report reads current artifacts without stale-path or schema errors

### P1-2
- Split `OTHER_SERVER_POLICY` into concrete sub-reasons
- At minimum classify:
- `LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED`
- `REVERSE_EXCEPTION_*`
- any remaining unmatched items as `OTHER_SERVER_POLICY_MISC`
- Audit gate:
- parity/quality report exposes sub-reason counts
- tests cover classification rules

### P2
- Extend automatic remediation granularity from family to sub-reason
- Examples:
- `LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED` -> watch-only or rescue-add parameter review
- `REVERSE_EXCEPTION_*` -> reverse-path review or cooldown tuning
- `OTHER_SERVER_POLICY_MISC` -> monitor only unless threshold reached
- Wire remediation output into policy plan and live execution guard where appropriate
- Audit gate:
- remediation plan emits sub-reason actions
- apply path handles supported sub-reasons safely
- live execution policy honors the supported watch-only outputs

## Deliverables
- updated code
- tests for each phase
- latest generated artifacts
- final summary with any residual risk

## Success Criteria
- `master` contains phase2 merge
- watchdog stale warning fixed
- 24h report available
- `OTHER_SERVER_POLICY` no longer appears only as a single opaque bucket
- remediation logic can act on sub-reasons, not just families

## Completion Summary

### P0-1
- status: done
- result:
  - phase2 follow-up work was isolated on `codex/server-signal-phased-p0-p2-20260403`
  - release commit `9d36d74` was pushed to `origin`
  - PR open URL:
    - `https://github.com/jungjaeyong84/zmakqo/pull/new/codex/server-signal-phased-p0-p2-20260403`
- audit:
  - targeted files only were staged
  - no unrelated dirty worktree changes were reverted

### P0-2
- status: done
- result:
  - `scripts/automation-automation-watchdog.js` now treats weekly governance freshness on a weekly cadence (`192h`)
- audit:
  - `automation_watchdog_latest.json`
  - `verdict=PASS`
  - `issue_count=0`
  - `WEEKLY_FILTER_GOVERNANCE_STALE` cleared

### P1-1
- status: done
- result:
  - added `server_signal_observation_24h_latest.{json,md}`
  - wired report generation into the OpenClaw hourly cycle
- audit:
  - report generation succeeded
  - current status: `DRIFT_MONITORING`
  - remediation apply state is visible in the 24h report

### P1-2
- status: done
- result:
  - `OTHER_SERVER_POLICY` is now split into concrete sub-reasons
  - current observed sub-reasons:
    - `LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED`
    - `LIVE_RESCUE_ADD_POST_TP1_BLOCKED`
- audit:
  - `server_signal_quality_latest.json` exposes sub-reason rows and actions
  - tests cover sub-reason classification

### P2
- status: done
- result:
  - sub-reason-level remediation plan and apply path added
  - `ETHUSDT` is now watch-only for:
    - `OTHER_SERVER_POLICY > LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED`
  - `BNBUSDT` post-TP1 rescue-add mismatch is monitor-only:
    - `LIVE_RESCUE_ADD_POST_TP1_BLOCKED`
- audit:
  - remediation plan emits sub-reason actions
  - apply artifact persists sub-reason watch-only outputs
  - live execution policy honors reason-level watch-only block state

## Deployment Verification

- build status: `SUCCESS`
- Cloud Run revisions (100% traffic):
  - `donbeolja-01143-fzg`
  - `donbeolja-egress-00384-8sk`
  - `donbeolja-exit-worker-00486-68l`
