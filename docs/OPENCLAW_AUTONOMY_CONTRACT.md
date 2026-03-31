# OPENCLAW_AUTONOMY_CONTRACT

- 제정: 2026-03-31
- 상태: ACTIVE
- 목적:
  - `OpenClaw`를 단순 스케줄러가 아니라 donbeolja의 상위 운영 control plane으로 고정한다.
  - `objective miss -> recovery candidate -> bounded degraded authority -> deploy/rollback hold`의 최상위 계약을 문서와 artifact에서 동일하게 유지한다.

## 1. 한 줄 정의

`OPENCLAW_AUTONOMY_CONTRACT`는 donbeolja가 목표 미달 상태에서 어떤 조건으로 스스로 회복 경로를 열 수 있는지, 어떤 조건에서는 반드시 HOLD해야 하는지를 규정하는 상위 헌법이다.

## 2. 정본 artifact

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_autonomy_contract_latest.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_server_primary_acceptance_watch_latest.json`
3. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_recovery_governor_latest.json`
4. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_self_evolution_authority_latest.json`

## 3. Control Plane 정본

1. `scheduler_sot = OPENCLAW_CRON`
2. `telegram_transport_sot = OPENCLAW_FIRST`
3. `execution_sot = SERVER_CANONICAL`
4. `pine_role = SHADOW_OVERLAY_AUDIT`

## 4. Objective Policy

기본 회복 기준은 아래다.

1. `min_objective_score = 0`
2. `min_monthly_run_rate_krw = 1,500,000`
3. `min_win_rate = 0.60`
4. `recovery_trigger_objective_score = -0.25`

현재 real cycle `best_self_evolution_2026-03-31_2128_1dc17b7c` 기준 상태:

1. `objective_score = -7.4059`
2. `monthly_run_rate_krw = -436.19`
3. `win_rate = 0.4444`
4. `goal_state = OBJECTIVE_RECOVERY_REQUIRED`

## 5. Bounded Degraded Authority Policy

`Codex + Claude`가 기술적 timeout 교착에 빠질 경우에도, 아래 조건이 모두 닫혀야만 제한적 promote를 고려한다.

1. `enabled = true`
2. `min_timeout_streak = 3`
3. `require_replay_pass = true`
4. `require_canary_ready = true`
5. `require_deployment_guards_pass = true`
6. `require_memory_clear = true`
7. `require_openclaw_ops_healthy = true`
8. `allow_target_deploy_units = [SERVER_SETTINGS, ENGINE_POLICY_BUNDLE]`

즉 degraded authority는 “AI 둘 다 timeout이면 그냥 승격”이 아니라, `replay + canary + guards + memory + ops health`를 모두 통과한 bounded recovery path다.

## 6. Phase D Acceptance Watch

`SERVER_PRIMARY` 확대는 아래 acceptance가 닫혀야만 가능하다.

1. `min_server_primary_executed_n = 2`
2. `max_server_primary_disagreement_rate = 0.15`
3. `max_server_primary_rollback_trigger_n = 0`

현재 real cycle 기준:

1. `configured_server_primary_markets = ["AXSUSDT"]`
2. `observed_n = 1`
3. `executed_n = 0`
4. `phase_d_status = PENDING`
5. `phase_d_reason = SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`

## 7. Objective Recovery Governor

`OBJECTIVE_RECOVERY_GOVERNOR`는 현재 회복 경로가 실제로 열려 있는지 최종 판정한다.

현재 real cycle 기준:

1. `target_candidate_id = AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN`
2. `target_deploy_unit = SERVER_SETTINGS`
3. `replay_pass = true`
4. `canary_ready = true`
5. `deployment_guards_pass = true`
6. `memory_blocked = false`
7. `unrelated_memory_blocked_candidate_ids = ["AI_AI"]`
8. `governor_status = RECOVERY_PROMOTION_READY`
9. `degraded_authority_eligible = true`

즉 현재 governor 관점의 recovery path는 열려 있다. 다만 실제 promote는 `external authority pending`이 닫히거나, 향후 timeout 교착 시 degraded timeout policy가 발동해야 한다.

## 8. 최종 의미

현재 donbeolja는 이미 대부분의 측정, 후보 생성, 검증, 배포 확인을 자동으로 수행한다.

아직 완전 자율 진화가 아닌 이유는 3개다.

1. `external authority`가 아직 `PENDING/HOLD` 상태다.
2. `Phase D acceptance` 표본이 부족하다.
3. unrelated memory block은 아직 남아 있지만 recovery target을 직접 막고 있지는 않다.

즉 남은 문제는 구조적 자동화 부족이 아니라, `운영 증거와 external authority blocker`다.
