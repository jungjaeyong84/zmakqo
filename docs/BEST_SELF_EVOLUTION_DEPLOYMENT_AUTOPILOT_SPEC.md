# BEST Self-Evolution Deployment Autopilot Spec

Status: ACTIVE

## Purpose
Codex must supervise the last mile of the self-evolution loop before manual Pine paste. This layer turns replay, canary, memory, deployment guards, stage autopilot handoff, and weekly Pine history into a single deployment handoff plan.

## Scope
1. Decide whether a candidate is only prepared, ready for manual paste, prepared for rollback, or ready for manual rollback.
2. Keep Pine manual paste as the only required human step.
3. Block deployment when replay, canary, memory, drift, or Codex authority do not align.

## Inputs
1. `objective_supervisor_latest.json`
2. `pine_quality_change_control_latest.json`
3. `codex_weekly_patch_engine_latest.json`
4. `best_self_evolution_deployment_guards_latest.json`
5. `best_self_evolution_canary_latest.json`
6. `stage_autopilot_latest.json`
7. `weekly_pine_upgrade_history.json`

## Outputs
1. `best_self_evolution_deployment_plan_latest.json`
2. `best_self_evolution_deployment_plan_latest.md`
3. `objective_supervisor.raw.self_evolution_deployment_plan`
4. `objective_supervisor.raw.codex_authority`

## Plan Status
1. `HOLD`
2. `PREPARE_PROMOTION`
3. `READY_FOR_MANUAL_PASTE`
4. `PREPARE_ROLLBACK`
5. `READY_FOR_MANUAL_ROLLBACK`

## Rules
1. Promotion requires change-control ready, deployment guards pass, and Codex verdict `PROMOTE`.
2. Rollback requires rollback ready, Codex verdict `ROLLBACK`, and rollback source present.
3. Manual paste readiness requires a prepared/generated Pine file path and stage autopilot Pine stage ready.
4. Open canary wave constrains market scope.
5. Handoff checklist must always be emitted when promotion or rollback is being prepared.

## Codex Authority
1. Owner is `CODEX`.
2. Objective supervisor is the SSOT carrier of Codex authority.
3. Stage autopilot should rely on `objective_supervisor.raw.codex_authority` before falling back to direct Codex patch output.
