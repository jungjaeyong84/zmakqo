# Release Notes - 2026-04-03

## Scope
- Server signal quality observability enhancement
- Doc-artifact SSOT parity lock correction
- Cloud Run rollout verification

## Changes

### 1) FINAL_DOWNSTREAM_MISMATCH family/action breakdown
- File: `src/utils/serverSignalQuality.js`
- Added output fields:
  - `summary.final_downstream_mismatch_n`
  - `summary.top_final_downstream_drop_reason_family`
  - `rows.final_downstream_family_actions[]`
- Added family -> recommended action mapping:
  - `EV_POLICY` -> `RELAX_EV_POLICY_REVIEW`
  - `COOLDOWN_POLICY` -> `RELAX_OPPOSITE_COOLDOWN_REVIEW`
  - `OTHER_SERVER_POLICY` -> `WATCH_ONLY_REVIEW`
  - `ENTRY_QUALITY` / `RISK_POLICY` -> `KEEP_DROP_RULE`
  - default -> `MONITOR_ONLY`

### 2) Test coverage update
- File: `src/tests/server-signal-quality.test.js`
- Added assertions for new mismatch family/action outputs.

### 3) SSOT lock correction
- File: `docs/ARTIFACT_SSOT_LOCK.md`
- `governor_status` aligned to latest artifact value:
  - `RECOVERY_CANARY_BLOCKED`

## Verification
- Tests:
  - `SERVER_SIGNAL_QUALITY_TEST_OK`
  - `LIVE_EXECUTION_POLICY_TEST_OK`
  - `SERVER_SIGNAL_CUTOVER_READINESS_TEST_OK`
  - `SERVER_SIGNAL_DRIFT_REMEDIATION_PLAN_TEST_OK`
- Parity:
  - `check:doc-artifact-parity` -> `ok=true, mismatch_n=0`
- Runtime outputs:
  - latest `server_signal_quality` now exposes family-level actions

## Deployment
- Cloud Build: `fd4b1a1c-6cc2-4e94-a707-97d74142f930` (SUCCESS)
- Cloud Run revisions (100% traffic):
  - `donbeolja-01134-jr7`
  - `donbeolja-egress-00382-vb8`
  - `donbeolja-exit-worker-00484-clt`

## Follow-up Rollout

### 4) Phased server-signal stabilization (P0-P2)
- Files:
  - `scripts/automation-automation-watchdog.js`
  - `src/utils/serverSignalObservation24h.js`
  - `scripts/report-server-signal-observation-24h.js`
  - `src/utils/serverSignalDriftRemediationPlan.js`
  - `src/utils/policyParameterEvolutionPlan.js`
  - `src/utils/liveExecutionPolicy.js`
- Added:
  - 24h observation artifact for drift/remediation state
  - `OTHER_SERVER_POLICY` sub-reason classification
  - sub-reason-level remediation planning and apply path
  - reason-level watch-only enforcement in live execution policy

### 5) Operational outcome
- `WEEKLY_FILTER_GOVERNANCE_STALE` resolved
- watchdog:
  - `verdict=PASS`
  - `issue_count=0`
- current reason-level remediation:
  - `ETHUSDT`
    - family: `OTHER_SERVER_POLICY`
    - reason: `LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED`
    - action: `WATCH_ONLY_REVIEW`
  - `BNBUSDT`
    - family: `OTHER_SERVER_POLICY`
    - reason: `LIVE_RESCUE_ADD_POST_TP1_BLOCKED`
    - action: `MONITOR_POST_TP1_GUARD`

### 6) Verification
- Tests:
  - `SERVER_SIGNAL_OBSERVATION_24H_TEST_OK`
  - `SERVER_SIGNAL_QUALITY_TEST_OK`
  - `SERVER_SIGNAL_DRIFT_REMEDIATION_PLAN_TEST_OK`
  - `POLICY_PARAMETER_EVOLUTION_PLAN_TEST_OK`
  - `LIVE_EXECUTION_POLICY_TEST_OK`
- Artifacts:
  - latest `automation_watchdog` = `PASS`
  - latest `server_signal_observation_24h` = `DRIFT_MONITORING`
  - latest `server_signal_drift_remediation_apply` = applied

### 7) Deployment
- Cloud Build: `28de8244-ccea-4e72-862f-d56259463157` (SUCCESS)
- Cloud Run revisions (100% traffic):
  - `donbeolja-01143-fzg`
  - `donbeolja-egress-00384-8sk`
  - `donbeolja-exit-worker-00486-68l`
