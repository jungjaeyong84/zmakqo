# OPENCLAW_MANIFEST_LITE_AND_STEP_REGISTRY_PROPOSAL_2026-04-03

- status: PROPOSED
- updated_at_kst: 2026-04-03
- purpose:
  - Evaluate whether donbeolja should introduce a hook pipeline pattern and a separate manifest-driven scheduler registry.
  - Define the lower-risk alternative that fits the current architecture.

## 1. Executive Decision

Two proposals were reviewed:

1. hook pipeline pattern for declarative event chaining
2. manifest-based tool/job registration for scheduler validation

Decision:

1. do not introduce a new hook engine now
2. do not add a second standalone manifest SSOT now
3. strengthen the current architecture in a manifest-like way

Reason:

1. `automation-openclaw-hourly-cycle.js` already acts as the operational chain coordinator
2. `scripts/lib/openclaw-cron-manifest.js` already exists and is the current scheduler registry
3. `automation-automation-watchdog.js` already consumes scheduler metadata and artifact freshness
4. adding a parallel framework now would create duplicate truth and harder debugging

## 2. Current Reality

### 2.1 What already exists

1. scheduler registry
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/openclaw-cron-manifest.js`
2. hourly operational chain
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-openclaw-hourly-cycle.js`
3. scheduler/artifact audit
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-automation-watchdog.js`

### 2.2 What the current chain already does

The hourly cycle already runs a declared sequence:

1. analytics local cache refresh
2. signal lineage health report
3. doc-artifact parity check
4. drift remediation plan
5. drift remediation apply
6. post-remediation report refresh
7. automation watchdog
8. self evolution loop
9. Pine sync
10. hourly overall report

That means the architecture is already a practical step chain, even if it is not yet formalized as a generic hook framework.

## 3. Proposal Review

### 3.1 Hook pipeline pattern

Proposed idea:

1. `signal generated -> quality check -> remediation apply -> alert/ledger`
2. declare those transitions as hooks rather than hardcoded sequence

Assessment:

1. architecturally sound
2. not yet justified by current complexity
3. would add abstraction before current failure modes are exhausted

Benefits if introduced later:

1. cleaner fan-out/fan-in control
2. explicit pre/post step contracts
3. simpler retry/skip semantics
4. better lineage on each step

Current downside:

1. existing hourly cycle is still readable and deterministic
2. a generic hook engine would add one more layer during an already sensitive stabilization phase
3. debugging would get harder before operational benefit is clear

Decision:

1. defer generic hook pipeline
2. first formalize the existing sequence as a step registry inside the current hourly cycle

### 3.2 Manifest-based tool registration

Proposed idea:

1. define all scheduler jobs and validations in a standalone manifest
2. let watchdog validate against that manifest

Assessment:

1. directionally correct
2. but a separate second manifest would duplicate current truth

Why duplication risk is real:

1. cron jobs already live in `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/openclaw-cron-manifest.js`
2. watchdog already maps scheduler rows to artifacts and issues
3. daily/hourly artifact expectations already exist in `ARTIFACT_SPECS`

Decision:

1. do not create a second external manifest now
2. evolve the current cron manifest and watchdog metadata into a manifest-lite model

## 4. Recommended Architecture

### 4.1 Manifest-lite scheduler registry

Keep using:

- `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/openclaw-cron-manifest.js`

Extend each job with metadata like:

1. `job_id`
2. `owner`
3. `criticality`
4. `produces_artifact`
5. `artifact_sla_hours`
6. `depends_on`
7. `recovery_strategy`
8. `scheduler_sot`

Example shape:

```js
{
  job_id: "openclaw_hourly_cycle",
  label: "com.jeongjaeyong.donbeolja.openclawhourly",
  name: "donbeolja-openclaw-hourly-cycle",
  wrapper: ".../ops/launchd/run_openclaw_hourly_cycle.sh",
  cron: "0 * * * *",
  runAtLoad: true,
  owner: "openclaw",
  criticality: "HIGH",
  produces_artifact: "openclaw_hourly_cycle_latest.json",
  artifact_sla_hours: 2,
  depends_on: [],
  recovery_strategy: "re-run-once",
  scheduler_sot: "OPENCLAW_CRON"
}
```

Expected result:

1. watchdog can explain not just that a job failed, but why the failure matters
2. scheduler review becomes more declarative without introducing duplicate infrastructure

### 4.2 Hourly cycle step registry

Keep using:

- `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-openclaw-hourly-cycle.js`

Refactor internally so steps come from a registry array:

1. `id`
2. `kind`
3. `script`
4. `depends_on`
5. `fail_mode`
6. `produces_artifact`
7. `summary_selector`
8. `criticality`

Example shape:

```js
{
  id: "server_signal_drift_remediation_apply",
  kind: "script",
  script: "apply-server-signal-drift-remediation-plan.js",
  depends_on: ["server_signal_drift_remediation_plan"],
  fail_mode: "hard_fail",
  produces_artifact: "server_signal_drift_remediation_apply_latest.json",
  criticality: "HIGH"
}
```

Why this is the right middle step:

1. preserves current deterministic execution
2. avoids introducing a generic hook runtime prematurely
3. makes future hook migration easier if complexity increases

## 5. What Not To Do Now

Do not do these yet:

1. do not create a separate YAML/JSON/TOML scheduler manifest as a second SSOT
2. do not introduce a generic event bus for the hourly cycle
3. do not split the current hourly cycle into a plugin framework
4. do not add async fan-out unless there is a proven runtime bottleneck

## 6. Trigger Conditions For Future Hook Pipeline Adoption

Revisit a true hook pipeline only if one or more become true:

1. step count grows materially beyond the current hourly cycle and daily cycle complexity
2. multiple post-step fan-out actions become routine
3. retry/skip/backoff logic becomes deeply nested
4. step-level lineage needs become a first-class audit requirement
5. different triggers need to reuse the same pre/post chain semantics

## 7. Rollout Plan

### Phase 1

Document and extend current manifest fields.

Success criteria:

1. cron manifest includes owner/criticality/artifact/SLA metadata
2. watchdog uses those fields in output

### Phase 2

Refactor hourly cycle into a step registry without behavior change.

Success criteria:

1. same steps
2. same order
3. same artifacts
4. same PASS/FAIL semantics

### Phase 3

Add richer step telemetry.

Suggested event envelope fields:

1. `run_id`
2. `step_id`
3. `status`
4. `artifact`
5. `reason`
6. `duration_ms`
7. `depends_on`

### Phase 4

Only if justified, design a reusable hook engine from the now-proven registry model.

## 8. Final Recommendation

The proposal is good, but the timing matters.

Best next move:

1. strengthen the existing cron manifest into a manifest-lite registry
2. formalize hourly cycle steps into a step registry
3. keep execution deterministic
4. defer generic hook pipeline until complexity proves the need

This gets most of the architectural clarity with less operational risk.
