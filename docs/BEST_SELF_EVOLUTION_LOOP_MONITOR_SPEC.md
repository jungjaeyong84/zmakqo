# BEST Self-Evolution Loop Monitor Spec

Status: ACTIVE

## Purpose
Codex must monitor every major self-evolution loop as one system and detect stale artifacts, broken promotion paths, critical blockers, and manual-paste readiness.

## Monitored Loops
1. `OBJECTIVE_SUPERVISOR`
2. `CANDIDATES`
3. `REPLAY`
4. `CANARY`
5. `DEPLOYMENT_GUARDS`
6. `DEPLOYMENT_PLAN`
7. `STAGE_AUTOPILOT`
8. `WEIGHT_TUNING`
9. `MEMORY_LEDGER`
10. `CODEX_PATCH_ENGINE`

## Outputs
1. `best_self_evolution_loop_monitor_latest.json`
2. `best_self_evolution_loop_monitor_latest.md`

## Summary Fields
1. `overall_status`
2. `stale_artifact_n`
3. `stale_artifacts`
4. `critical_blocker_n`
5. `critical_blockers`
6. `promotion_path_ready`
7. `manual_paste_ready`
8. `ready_candidate_id`
9. `canary_open_wave`
10. `fresh_loop_n`
11. `loop_n`

## Status Rules
1. `READY_FOR_MANUAL_PASTE` when deployment plan says manual step required and all upstream guards are aligned.
2. `BLOCKED` when stale artifacts exist.
3. `DEGRADED` when blockers exist or canary/deployment guards fail.
4. `HEALTHY` only when the loop chain is fresh and not blocked.

## Governance Rule
The loop monitor is informational but Codex should treat it as the top health view when deciding whether to promote, hold, or roll back.
