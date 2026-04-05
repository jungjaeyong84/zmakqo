# OPENCLAW_AUTONOMY_CONTRACT

- 제정: 2026-03-31
- 업데이트: 2026-04-05
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
9. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_market_regime_board_latest.json`

## 3. 현재 control plane 정본

1. `scheduler_sot = OPENCLAW_CRON`
2. `telegram_transport_sot = OPENCLAW_FIRST`
3. `execution_sot = SERVER_CANONICAL`
4. `signal_authority_target = SERVER_PRIMARY`
5. `pine_role = PINE_SHADOW`

## 4. 현재 latest 기준 상태

### 4.1 autonomy contract summary

아래 고정 숫자 대신 latest artifact를 정본으로 읽는다.

1. `goal_state`
2. `authority_state`
3. `phase_d_status`
4. `ops_status`
5. `server_signal_authority_status`
6. `server_signal_quality_status`
7. `server_signal_runtime_status`
8. `server_signal_transition_status`
9. `objective_score`
10. `market_regime_board_status`

### 4.2 cutover truth

1. `readiness_status`
2. `promotion_gate_status`
3. `promotion_block_reasons`
4. `artifact_coherence_status`
5. `dominant_mismatch_family`
6. `recommended_action`
7. `ev_policy_post_apply_comparable_n`
8. `ev_policy_post_apply_mismatch_rate`

### 4.3 governor / plan

1. `governor_status`
2. `policy_parameter_plan.status`
3. `policy_parameter_plan.mode`
4. `policy_parameter_plan.current_objective_score`
5. `quarantine_market_n`
6. `watch_only_review_market_n`
7. `other_server_policy_watch_only_market_n`
8. `market_regime_rescue_n`
9. `market_regime_keep_drop_n`
10. `execution_microstructure_status`
11. `portfolio_cluster_risk_status`

## 5. autonomy contract가 지금 보는 것

1. objective recovery가 아직 필요한지
2. authority가 아직 `PENDING`인지
3. source-mode는 이미 `SERVER_PRIMARY`인지
4. promotion coherence gate가 별도 blocker 없이 cleared인지
5. parity drift와 downstream mismatch가 monitor-only인지 blocker인지
6. `market regime board`가 rescue cohort를 열어야 하는지
7. `final_downstream_mismatch_control`이 count가 아니라 `rate` 기준으로 fail인지
8. `FAST_TP0 / cohort TP1 / delayed trail / pre-TP1 time stop / chase reject / portfolio cluster cap / external flat sync grace`가 실행 미세구조 병목을 완화하는지

## 6. 지금 왜 완전 자율 전환이 아닌가

현재 남은 이유는 아래 4개다.

1. `authority_state=PENDING`
2. `objective_supervisor.verdict=HOLD`
3. `governor_status`가 promotion-ready가 아니거나 external authority가 남아 있음
4. `reasoning_verification_quality`와 `final_downstream_mismatch_control`이 아직 PASS가 아님

## 7. 현재 최종 의미

1. OpenClaw substrate는 healthy다.
2. source-mode cutover는 operationally complete다.
3. promotion-grade coherence는 artifact 정합성과 시장군 상태를 함께 본다.
4. 따라서 현재 병목은 자동화 부재가 아니라 objective/verification/authority/EV policy calibration과 execution microstructure의 최종 증거 부족이다.

## 8. 실행 미세구조 계약

1. `FAST_TP0`
   - 초기 소이익은 `절대 % floor + ATR 보정`으로 일부 청산한다.
2. `cohort TP1`
   - `RESCUE=2.8%`, `MIXED=3.0%`, `KEEP_DROP=base` 규칙으로 TP1 거리를 분기한다.
   - 이미 열린 포지션도 cohort backfill을 통해 이 규칙을 소급 적용할 수 있다.
3. `delayed trail`
   - `TP1` 직후 trail을 즉시 활성화하지 않고 `1봉 또는 추가 MFE` 충족 후 활성화한다.
   - 두 조건은 artifact/meta에 모두 기록한다.
4. `pre-TP1 time stop`
   - `EARLY=4 bars`, `CORE=6 bars`, `TP1 progress < 50%`일 때만 시간손절을 허용한다.
5. `chase reject`
   - 과확장 진입은 `DROP_CHASE_ENTRY_QUALITY`로 차단하고, 회고/학습에서 별도 드롭 패밀리로 본다.
6. `portfolio cluster cap`
   - same-side cluster는 count뿐 아니라 total exposure cap도 함께 본다.
7. `external flat sync grace`
   - recent FILLED entry 직후 외부 `positionAmt=0` snapshot이 잠깐 들어와도 내부 포지션 `FLAT` overwrite를 바로 허용하지 않는다.
   - active sync는 `openclaw_market_regime_cohort/objective_score/drop_verdict`를 유지해 현재 포지션이 cohort TP1 규칙을 잃지 않도록 한다.

## 9. 운영 알림 계약

1. `execution semantics`
   - Telegram/운영 알림은 `TP0`, `pre-TP1 time stop`, `cohort`, `portfolio cluster reduce/block`를 구분해서 노출한다.
2. `operator readability`
   - `LIVE_RESCUE_ADD_*`, `LIVE_POLICY_*`, `LINEAGE_SLO_*`, `DROP_CHASE_ENTRY_QUALITY` 등 운영 드롭/보류 사유는 한국어 설명을 기본 제공한다.
3. `meaning parity`
   - 사람 운영자가 읽는 알림 의미와 OpenClaw가 읽는 artifact 의미가 어긋나지 않도록 동일한 사유 분류를 유지한다.
