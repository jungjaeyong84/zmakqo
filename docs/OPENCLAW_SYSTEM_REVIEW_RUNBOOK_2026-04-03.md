# OPENCLAW_SYSTEM_REVIEW_RUNBOOK_2026-04-03

- status: ACTIVE
- audience:
  - OpenClaw
  - Claude audit runners
  - Codex audit runners
- purpose:
  - Force a consistent read order for current donbeolja operations.
  - Prevent stale narrative from overriding current `*_latest` artifact truth.
  - Clarify how to interpret the current learning-epoch exception release policy.

## 1. Core Principle

OpenClaw does not directly learn from all raw fills/intents/trades as a single model.  
It reads current artifacts, runtime summaries, and SSOT documents, then makes operational judgments.

Therefore:

1. latest artifacts are the primary truth
2. MEMORY is only guidance
3. historical retrospectives are reference only
4. code is used to explain behavior when artifacts and docs disagree

## 2. Required Read Order

Read in this order for any substantial review:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03.md`
2. `/Users/jeongjaeyong/Projects/donbeolja/openclaw-workspace/MEMORY.md`
3. `/Users/jeongjaeyong/Projects/donbeolja/openclaw-ops-workspace/MEMORY.md`
4. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SERVER_CANONICAL_ENGINE_MIGRATION_PLAN.md`
5. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md`
6. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md`
7. latest artifacts under `/Users/jeongjaeyong/Projects/donbeolja/ops/daily`
8. code only after the above if explanation or contradiction analysis is needed

## 3. Must-Read Latest Artifacts

OpenClaw should read these first before claiming a current-system verdict:

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/automation_watchdog_latest.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/openclaw_hourly_cycle_latest.json`
3. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json`
4. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_runtime_latest.json`
5. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_cutover_readiness_latest.json`
6. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_quality_latest.json`
7. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_observation_24h_latest.json`
8. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_drift_remediation_apply_latest.json`
9. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_autonomy_contract_latest.json`

## 4. Current Interpretation Rules

### 4.1 Learning-Epoch Exception Release

If these conditions are visible:

1. `server_signal_observation_24h_latest.summary.learning_epoch_exception_release = true`
2. `server_signal_drift_remediation_apply_latest.inputs.learning_epoch_exception_release = true`

then interpret it as:

- historical market-level exceptions have been intentionally released
- this is a fresh-data collection policy
- it is not automatically a regression
- OpenClaw must not recommend re-blocking markets solely because they were blocked in older artifacts

### 4.2 What still remains blocked

Exception release does not mean all safety gates are disabled.

These can still block:

1. execution-quality hard block
2. global execution-quality guard
3. lineage fail-closed
4. other explicit system-wide hard guards

### 4.3 What OpenClaw should avoid

OpenClaw should not:

1. treat old quarantine/watch-only settings as current truth without checking provider settings and latest apply artifact
2. infer “full autonomy” when `authority_state=PENDING`
3. call `WATCH_PARITY_DRIFT` resolved just because cutover blockers are `0`
4. call “all data fully learned” when only summary artifacts were consumed

## 5. Current Operational Truth Snapshot

As of `2026-04-03` latest artifacts:

1. watchdog is `PASS`
2. OpenClaw hourly cycle is `PASS`
3. server signal runtime is `READY`
4. cutover readiness is `SERVER_PRIMARY_ACTIVE`
5. objective supervisor remains `HOLD`
6. autonomy contract remains `authority_state=PENDING`
7. learning-epoch exception release is active
8. `OTHER_SERVER_POLICY` effective watch-only markets are currently empty

## 6. Review Output Contract

When OpenClaw reviews the system, it should always separate:

1. structural implementation
2. current artifact evidence
3. operational hold
4. intentional temporary policy

Required sections:

1. `Current Facts`
2. `Findings`
3. `Contradictions`
4. `Risk Interpretation`
5. `Next Actions`

## 7. Recommended OpenClaw Prompt

Use this prompt when asking OpenClaw to audit the current system:

```md
Audit the current donbeolja system using latest artifacts first, then code only when needed.

Read in this order:
1. /Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_SYSTEM_REVIEW_RUNBOOK_2026-04-03.md
3. /Users/jeongjaeyong/Projects/donbeolja/openclaw-workspace/MEMORY.md
4. /Users/jeongjaeyong/Projects/donbeolja/openclaw-ops-workspace/MEMORY.md
5. current *_latest artifacts in /Users/jeongjaeyong/Projects/donbeolja/ops/daily

Rules:
- prefer latest artifacts over narrative
- treat learning_epoch_exception_release=true as intentional fresh-data collection policy
- do not call full autonomy when authority_state=PENDING
- separate source parity mismatch from final downstream mismatch
- distinguish intentional temporary policy from bug

Return:
1. Current Facts
2. Findings (P1/P2/P3)
3. Contradictions
4. Risk Interpretation
5. Next Actions
```

## 8. Escalation Rule

If OpenClaw sees:

1. `learning_epoch_exception_release=true`
2. `objective_supervisor_latest.verdict=HOLD`
3. `authority_state=PENDING`

then it should recommend:

- continue collecting fresh data
- avoid reintroducing market-level historical exceptions without new evidence
- focus next actions on new evidence quality, not stale narrative restoration
