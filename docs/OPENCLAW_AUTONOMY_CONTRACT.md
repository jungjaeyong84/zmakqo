# OPENCLAW_AUTONOMY_CONTRACT

- 제정: 2026-03-31
- 업데이트: 2026-04-03
- 상태: ACTIVE
- 검수 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03.md`

## 1. 한 줄 정의

`OPENCLAW_AUTONOMY_CONTRACT`는 objective recovery, authority state, server signal cutover, deployment truth를 한 프레임으로 묶는 상위 운영 계약이다.

## 2. 현재 정본 artifact

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_autonomy_contract_latest.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json`
3. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_runtime_latest.json`
4. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_cutover_readiness_latest.json`
5. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_quality_latest.json`
6. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_recovery_governor_latest.json`
7. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_recovery_effect_latest.json`
8. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_policy_parameter_plan_latest.json`

## 3. 현재 control plane 정본

1. `scheduler_sot = OPENCLAW_CRON`
2. `telegram_transport_sot = OPENCLAW_FIRST`
3. `execution_sot = SERVER_CANONICAL`
4. `signal_authority_target = SERVER_PRIMARY`
5. `pine_role = PINE_SHADOW`

## 4. 현재 latest 기준 상태 (as-of 2026-04-03 15:00 KST)

### 4.1 autonomy contract summary

1. `goal_state = OBJECTIVE_RECOVERY_REQUIRED`
2. `authority_state = PENDING`
3. `phase_d_status = READY`
4. `ops_status = PASS`
5. `server_signal_authority_status = PARITY_DRIFT`
6. `server_signal_quality_status = WATCH_PARITY_DRIFT`
7. `server_signal_runtime_status = READY`
8. `server_signal_transition_status = COMPLETE`
9. `objective_score = -9.5532`
10. `objective_score_source = OBJECTIVE`

### 4.2 cutover truth

1. `readiness_status = SERVER_PRIMARY_ACTIVE`
2. `promotion_gate_status = READY`
3. `promotion_block_reasons = []`
4. `artifact_coherence_status = READY`
5. `artifact_generated_at_skew_ms = 1496`
6. `dominant_mismatch_family = EV_POLICY`
7. `recommended_action = HOLD_EV_POLICY_REVIEW`

### 4.3 governor / plan

1. `governor_status = RECOVERY_CANARY_BLOCKED`
2. `policy_parameter_plan.status = HOLD`
3. `policy_parameter_plan.mode = ADVISORY_ONLY`
4. `policy_parameter_plan.current_objective_score = -9.5532`
5. `quarantine_market_n = 3`
6. `watch_only_review_market_n = 4`
7. `other_server_policy_watch_only_market_n = 1`

## 5. autonomy contract가 지금 보는 것

1. objective recovery가 아직 필요한지
2. authority가 아직 `PENDING`인지
3. source-mode는 이미 `SERVER_PRIMARY`인지
4. promotion coherence gate가 별도 blocker 없이 cleared인지
5. parity drift와 downstream mismatch가 monitor-only인지 blocker인지

## 6. 지금 왜 완전 자율 전환이 아닌가

현재 남은 이유는 아래 4개다.

1. `authority_state=PENDING`
2. `objective_supervisor.verdict=HOLD`
3. `governor_status=RECOVERY_CANARY_BLOCKED`
4. `reasoning_verification_quality=FAIL` and `objective_score=-9.5532`

## 7. 현재 최종 의미

1. OpenClaw substrate는 healthy다.
2. source-mode cutover는 operationally complete다.
3. promotion-grade coherence는 latest aligned set에서 ready지만 autonomy authority는 아직 닫히지 않았다.
4. 따라서 현재 병목은 자동화 부재가 아니라 objective/verification/authority의 최종 증거 부족이다.
