# BEST_SELF_EVOLUTION_DEPLOYMENT_GUARDS_SPEC

- 제정: 2026-03-29
- 상태: ACTIVE
- 목적: `replay -> canary -> memory -> stage autopilot` 사이의 최종 승격/차단 판단을 하나의 배포 가드로 고정한다.

## 0. 현재 SSOT

1. latest artifact
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_guards_latest.json`
2. upstream inputs
   - `objective_supervisor_latest.json`
   - `best_self_evolution_candidates_latest.json`
   - `best_self_evolution_replay_latest.json`
   - `best_self_evolution_canary_latest.json`
   - `best_self_evolution_memory_latest.json`
3. consumers
   - `automation-objective-supervisor.js`
   - `automation-stage-autopilot.js`
   - `automation-codex-weekly-patch-engine.js`

## 1. 목적

1. 승격 후보가 있어도 `deploy_pass`가 아니면 실제 apply 금지
2. rollback 후보가 있어도 `rollback_only`가 아니면 자동 rollback 준비 상태로 올리지 않음
3. `objective`, `replay`, `canary`, `memory`를 따로 보지 않고 최종 배포 판단 하나로 합친다

## 2. 핵심 필드

1. `target_candidate_id`
2. `deploy_pass`
3. `rollback_only`
4. `blockers`
5. `replay_verdict`
6. `canary_open_wave`
7. `market_ready_n`
8. `market_total_n`
9. `memory_blocked_candidate_n`

## 3. 차단 규칙

아래 중 하나면 `deploy_pass = false`.

1. `SELF_EVOLUTION_COUNT_FLOOR_FAIL`
2. `SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL`
3. `SELF_EVOLUTION_LATENCY_BUDGET_FAIL`
4. `SELF_EVOLUTION_REPLAY_MISSING`
5. `SELF_EVOLUTION_REPLAY_NOT_PASS`
6. `SELF_EVOLUTION_CANARY_APPLY_BLOCK`
7. `SELF_EVOLUTION_CANARY_ROLLBACK_READY`
8. `SELF_EVOLUTION_MEMORY_BLOCK`
9. `FILTER_CANARY_DRIFT`

## 4. stage autopilot 연동

1. Pine `PROMOTE` 후보는 `deploy_pass = true`일 때만 준비 가능
2. `deploy_pass = false`면 `SELF_EVOLUTION_DEPLOYMENT_BLOCK` 계열 사유로 HOLD
3. `rollback_only = true`는 rollback 쪽 의사결정 힌트로만 쓰고, 실제 rollback은 기존 adverse guard를 유지한다

## 5. Codex 연동

1. Codex weekly patch engine은 deployment guard snapshot을 prompt에 포함한다
2. `deploy_pass = false`면 promotion 추천을 더 보수적으로 본다
3. `memory_blocked_candidate_n > 0` 또는 `SELF_EVOLUTION_MEMORY_BLOCK`이면 동일 candidate 재추천을 피한다
