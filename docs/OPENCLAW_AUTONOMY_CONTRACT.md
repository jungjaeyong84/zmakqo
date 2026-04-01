# OPENCLAW_AUTONOMY_CONTRACT

- 제정: 2026-03-31
- 업데이트: 2026-04-01
- 상태: ACTIVE
- 목적:
  - `OpenClaw`를 돈벌자의 상위 운영 control plane으로 고정한다.
  - objective, authority, deployment, server signal cutover를 하나의 계약으로 정렬한다.

## 1. 한 줄 정의

`OPENCLAW_AUTONOMY_CONTRACT`는 돈벌자가 목표 미달 상태에서 어떤 회복 경로를 열 수 있는지, 그리고 서버 정본 전환이 아직 어떤 blocker 때문에 승격되지 않는지를 함께 판정하는 상위 계약이다.

## 1.1 우선순위 원칙

`OpenClaw`의 최상위 목적은 `월간 목표 달성`이다.  
판단 우선순위는 아래 순서를 따른다.

1. `월간 목표 달성 가능성`
2. `주간 회복 진행`
3. `일간 손실/활동 통제`
4. `드롭 검증과 기회비용 확인`
5. `서버 신호 품질`
6. `server signal parity drift / cutover readiness`

즉 `parity drift`와 `cutover readiness`는 중요하지만, 목표 회복이 필요한 동안에는 `주목표`가 아니라 `보조 운영 제약`으로 다룬다.

## 2. 현재 정본 artifact

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_autonomy_contract_latest.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_authority_latest.json`
3. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_quality_latest.json`
4. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_runtime_latest.json`
5. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_cutover_readiness_latest.json`
6. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_server_primary_acceptance_watch_latest.json`
7. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_recovery_governor_latest.json`
8. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_self_evolution_authority_latest.json`

## 3. 현재 control plane 정본

1. `scheduler_sot = OPENCLAW_CRON`
2. `telegram_transport_sot = OPENCLAW_FIRST`
3. `execution_sot = SERVER_CANONICAL`
4. `signal_authority_target = SERVER_PRIMARY`
5. `pine_role = PINE_SHADOW`
6. `automation_mode = OPENCLAW_ONLY`

## 4. 현재 latest 기준 상태

### 4.1 autonomy contract summary

현재 latest 기준:

1. `goal_state = OBJECTIVE_RECOVERY_REQUIRED`
2. `authority_state = HOLD`
3. `phase_d_status = SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`
4. `ops_status = PASS`
5. `server_signal_authority_status = PARITY_DRIFT`
6. `server_signal_quality_status = WATCH_PARITY_DRIFT`
7. `server_signal_runtime_status = READY`
8. `server_signal_transition_status = COMPLETE`
9. `server_signal_transition_progress_pct = 100`

### 4.2 server signal runtime

1. `canonical_engine_source_mode = SERVER_PRIMARY`
2. `exec_tf = 15m`
3. `market_count = 7`
4. `scheduler_status = ENABLED`
5. `watchdog_verdict = PASS`

### 4.3 server signal cutover readiness

1. `promotion_ready = false`
2. `readiness_status = SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`
3. `blockers = [EV_POLICY_DRIFT_ACTIVE, COOLDOWN_POLICY_DRIFT_ACTIVE, SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT]`
4. `dominant_mismatch_family = EV_POLICY`
5. `recommended_action = LOWER_EV_TP1_MIN_REVIEW`
6. `strategy_gate_historical_only = true`

### 4.4 supervisor / loop monitor

1. `objective_supervisor.verdict = HOLD`
2. `objective_supervisor.root_cause = EXTERNAL_AUTHORITY_BLOCK_ROLLBACK`
3. `loop_monitor.cycle_consistent = true`
4. `loop_monitor.critical_blockers = [EXTERNAL_AUTHORITY_BLOCK_ROLLBACK, SERVER_SIGNAL_PARITY_DRIFT, SERVER_SIGNAL_CUTOVER_NOT_READY, SELF_EVOLUTION_CANARY_APPLY_BLOCK]`

## 5. autonomy contract가 지금 보는 것

### 5.1 objective 축

1. 목표 점수가 아직 회복 필요 상태인지
2. recovery candidate가 열려 있는지
3. replay / canary / guards가 닫혔는지

### 5.2 deployment 축

1. authority가 `APPROVED`인지
2. 배포/활성화 경로가 실제 적용 가능한지
3. 외부 authority blocker가 rollback을 막고 있는지

### 5.3 server signal cutover 축

1. 서버 정본 신호가 실제로 생성되고 있는지
2. entry -> intent -> fill 품질이 유지되는지
3. `EV_POLICY`, `COOLDOWN_POLICY` drift가 승격 blocker인지
4. `SERVER_PRIMARY`로 올릴 준비가 됐는지

## 6. bounded degraded authority 정책

`Codex + Claude`가 기술적으로 timeout 교착에 빠져도 아무 후보나 promote하지 않는다.

아래가 모두 닫혀야 제한 promote를 고려한다.

1. `replay_pass`
2. `canary_ready`
3. `deployment_guards_pass`
4. `memory_clear`
5. `openclaw_ops_healthy`
6. `target_deploy_unit`이 허용 범위 안일 것

즉 degraded authority는 편법이 아니라 `검증된 회복 경로`다.

## 7. 지금 왜 완전 자율 전환이 아닌가

현재 남은 이유는 구조 부재보다 운영 증거 부족과 외부 authority hold다.

핵심 4개:

1. `SERVER_PRIMARY` acceptance sample이 아직 짧다.
2. `EV_POLICY_DRIFT_ACTIVE`가 아직 남아 있다.
3. `COOLDOWN_POLICY_DRIFT_ACTIVE`가 아직 남아 있다.
4. `EXTERNAL_AUTHORITY_BLOCK_ROLLBACK`가 아직 남아 있다.

반대로 이미 닫힌 것:

1. `STRATEGY_GATE`는 `historical_only`
2. `server runtime`은 `READY`
3. `ops substrate`는 `PASS`
4. `scheduler`는 `ENABLED`
5. `source mode`는 `SERVER_PRIMARY`
6. `Pine shadow transition`은 `COMPLETE`

## 8. 현재 최종 의미

지금 돈벌자는 이미 대부분의 자동화와 감독 체계를 갖췄다.

남은 것은 아래다.

1. 서버 정본 신호 품질 drift 축소
2. `SERVER_PRIMARY` 승격 acceptance 충족
3. canary apply block 해소
4. external authority hold 해소

즉 지금의 핵심 문제는 자동화 부족이 아니라,
`서버 정본 전환의 마지막 품질 blocker를 닫는 것`이다.
