# BEST_FEBT_WEEKLY_TUNING_POLICY

- 제정: 2026-03-29
- 상태: ACTIVE
- 목적: 기존 주간 자동화 루프가 `BEST/FEBT`를 임의 해석하지 않고, 고정된 KPI와 고정된 조정 규칙으로 Pine 후보 패치를 제안하도록 정책을 명시
- 적용 대상:
  - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-weekly-filter-governance.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-codex-weekly-patch-engine.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.0.pine.txt`

## 1. 한 줄 원칙

주간 자동화는 `BEST/FEBT`를 위해 새 루프를 만들지 않는다.

해야 할 일은 아래 4개다.

1. 측정
2. 반증
3. 제한된 파라미터만 제안
4. count floor를 깨지 않는 범위에서만 승격

## 2. 주간 평가 대상 KPI

주간 자동화는 아래 KPI를 기본 세트로 본다.

1. `febt_fire_rate`
2. `febt_late_rate`
3. `febt_void_rate`
4. `febt_disagree_rate`
5. `replacement_ratio`
6. `count_ratio_global`
7. `fire_tp1_first_rate`
8. `fire_avg_ret_net`
9. `fire_expectancy`
10. `latency_budget_pass`

보조 KPI:

1. `fallback_legacy_rate`
2. `phase_known_rate`
3. `candidate_recovered_n`
4. `candidate_blocked_n`
5. `candidate_wait_n`
6. `projected_net_signal_delta_n`

## 3. 주간 자동화 역할 분담

### weekly governance

담당:

1. KPI 집계
2. overlap / disagreement / replacement proxy 보고
3. 시장별/사유별 편차 집계

### objective supervisor

담당:

1. 승격 차단
2. phase gate readiness 판정
3. 운영 위험 경고

### codex weekly patch engine

담당:

1. 기존 patch candidate 중 `PROMOTE / HOLD / ROLLBACK` 판단
2. `BEST/FEBT` 기준에서 어떤 candidate가 더 안전한지 설명
3. 허용된 파라미터 범위 안에서만 tuning 제안 근거 작성

## 4. 자동 조정 허용 레버

1차 자동 조정 허용 레버는 아래 5개뿐이다.

1. `febt_lock_arm_min`
2. `febt_lock_fire_min`
3. `febt_fire_edge_min`
4. `febt_late_hard_max`
5. `febt_fail_max`

조정 방식:

1. 주간 자동화는 `소폭 조정`만 허용
2. 같은 주에 2개를 초과한 동시 변경은 금지
3. 방향 반전급 조정은 금지

## 5. 자동 조정 금지 레버

아래는 초기 주간 자동화에서 자동 수정 금지다.

1. `lock_score` 가중치
2. `delay_cost` 가중치
3. `late_risk` 가중치
4. `failure_risk` 가중치
5. `FEBT` phase precedence
6. `LONG/SHORT` live semantics
7. approved market universe
8. count floor / replacement accounting 규칙 자체

위 항목은 별도 RFC 또는 문서 승인 없이 자동 패치 대상으로 올리지 않는다.

## 6. 우선순위 규칙

우선순위는 항상 아래 순서를 따른다.

1. `count_ratio_global >= 1.00`
2. `replacement_ratio`
3. `avg_ret_net` non-inferior
4. `expectancy` non-inferior
5. `fire_tp1_first_rate`
6. `FIRE win rate`

즉 승률이 좋아 보여도 `count_ratio_global < 1.00`이면 자동 tightening은 금지다.

## 7. 주간 조정 규칙

### Rule A. FIRE가 너무 적다

조건:

1. `febt_fire_rate`가 하한 밴드 아래
2. `count_ratio_global >= 1.00`

허용 조정:

1. `febt_lock_fire_min` 소폭 하향
2. `febt_fire_edge_min` 소폭 하향

금지:

1. `febt_fail_max` 완화와 동시 수행

### Rule B. FIRE는 충분하지만 성과가 약하다

조건:

1. `febt_fire_rate`는 충분
2. `fire_tp1_first_rate` 또는 `fire_avg_ret_net`가 baseline보다 약함

허용 조정:

1. `febt_lock_fire_min` 소폭 상향
2. `febt_fail_max` 소폭 하향
3. `febt_late_hard_max` 소폭 하향

### Rule C. LATE가 너무 많다

조건:

1. `febt_late_rate`가 과다
2. `count_ratio_global`이 유지됨

허용 조정:

1. `febt_late_hard_max` 소폭 상향
2. `febt_fire_edge_min` 소폭 하향

### Rule D. replacement가 안 된다

조건:

1. `replacement_ratio < 0.80`

허용 조정:

1. `febt_lock_arm_min` 완화
2. `febt_fire_edge_min` 완화

추가 조건:

1. `void_rate` 급증 시 자동 적용 금지

### Rule E. count가 줄었다

조건:

1. `count_ratio_global < 1.00`

강제 규칙:

1. tightening 패치 금지
2. rollback 우선 검토
3. 완화 방향 patch만 예외적으로 검토

## 8. 패치 엔진 판정 규칙

`automation-codex-weekly-patch-engine`는 아래 기준으로 움직인다.

1. `PROMOTE`
   - 기존 change-control이 이미 promotion ready
   - `BEST/FEBT` KPI도 비열위 조건 충족
2. `ROLLBACK`
   - 기존 change-control이 rollback ready
   - count floor 또는 expectancy가 깨짐
3. `HOLD`
   - 데이터 희소
   - KPI 충돌
   - 허용 레버 밖 변경이 필요

## 9. 데이터 희소 규칙

아래 중 하나면 자동화는 기본값 `HOLD`다.

1. `phase_known_rate` 낮음
2. `candidate_blocked_n` 부족
3. `replacement_ratio`가 표본 부족으로 불안정
4. `fire_tp1_first_rate`가 승인 표본 미달

## 10. 문서 우선순위

충돌 시 우선순위는 아래와 같다.

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_MASTER_SPEC.md`
2. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_SYSTEM_ROLLOUT_PLAN.md`
3. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_WEEKLY_TUNING_POLICY.md`
4. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PINE_INTRODUCTION_PLAN.md`

## 11. 한 줄 결론

주간 자동화는 `BEST/FEBT`를 위해 Pine를 매주 바꿀 수 있다.

하지만 그 방식은 아래로 제한된다.

1. `측정 가능한 KPI`
2. `고정된 허용 레버 5개`
3. `count floor 우선`
4. `PROMOTE / HOLD / ROLLBACK`의 change-control 체계 안에서만 수행
