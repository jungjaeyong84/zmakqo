# BEST_FEBT_INTERFACE_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `BEST` 상위 이론과 `FEBT` timing core 사이의 입력/출력/호출 시점/권한 계약 정의
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_IMPLEMENTATION_FRAMEWORK.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_FAILSAFE_POLICY.md`

## 목적

이 문서는 아래를 명확히 한다.

1. `BEST`가 `FEBT`를 언제 호출하는가
2. `FEBT`가 어떤 입력만 받는가
3. `FEBT`가 무엇을 반환하는가
4. `FEBT`가 무엇을 결정하지 못하는가

핵심은 `개념적 계층 선언`을 `실제 운영 계약`으로 바꾸는 것이다.

## 불변 조건

1. `FEBT`는 `BEST`의 `L4 타이밍층`이다.
2. `FEBT`는 `L1 상태층`, `L2 구조층`, `L3 시간가치층`의 본판정을 다시 하지 않는다.
3. `FEBT`는 `L5 행동층`의 최종 action을 직접 결정하지 않는다.
4. `FEBT`는 `active filter bypass` 경로를 가지지 않는다.
5. `FEBT`는 `timing verdict`만 제공한다.

## 호출 시점

`FEBT`는 아래 순서에서만 평가된다.

1. `L1 상태층` 평가 완료
2. `L2 구조층` 평가 완료
3. `L3 시간가치층` 평가 완료
4. `L1~L3`가 `DROP`이 아닐 때만 `FEBT` 호출
5. `FEBT` 결과를 `L5 행동층`이 소비

즉 `FEBT`는 upstream verdict가 살아 있는 케이스만 timing 분류한다.

## 입력 계약

### 공통 context

1. `symbol`
2. `tf`
3. `side`
4. `event`
5. `bar_close_time_utc_ms`
6. `entry_grade`
7. `provider`

### L1 상태층 요약 입력

1. `market_state_summary_state`
2. `market_state_summary_action`
3. `market_state_summary_qty_scale`
4. `market_state_summary_wait_assist`
5. `market_state_summary_wait_hard`

### L2 구조층 요약 입력

1. `entry_structure_ok`
2. `entry_structure_reason`
3. `score`
4. `score_abs`
5. `confidence`
6. `posterior_long`
7. `posterior_short`
8. `wave_conf`

### L3 시간가치층 요약 입력

1. `ev_gate_ok`
2. `ev_tp1_prob`
3. `ev_tp1_policy_version`
4. `ev_tp1_policy_source`
5. `hold_value_state`

### microstructure 입력

1. `range_pos`
2. `body_ratio`
3. `upper_wick_ratio`
4. `lower_wick_ratio`
5. `same_dir_streak`
6. `recent_move_1_pct`
7. `recent_move_2_pct`
8. `break_retention`
9. `close_control`
10. `impulse_decay`
11. `counter_rejection`
12. `micro_absorption`

## 출력 계약

`FEBT`는 아래만 반환한다.

1. `febt_mode`
2. `febt_phase`
3. `febt_lock_score`
4. `febt_delay_cost`
5. `febt_late_risk`
6. `febt_failure_risk`
7. `febt_edge`
8. `febt_state_valid`
9. `febt_calc_ok`
10. `febt_calc_reason`
11. `febt_timing_action`
12. `febt_authority`

### `febt_phase`

허용값:

1. `PREPARE`
2. `ARMED`
3. `FIRE`
4. `LATE`
5. `VOID`
6. `UNKNOWN`

### `febt_timing_action`

허용값:

1. `OBSERVE`
2. `PASS`
3. `DEFER_HINT`
4. `LATE_WARN`
5. `BLOCK_CANDIDATE`
6. `NO_OP`

원칙:

1. `SHADOW`에서는 `OBSERVE` 또는 `NO_OP`
2. `SOFT`에서는 `PASS`, `DEFER_HINT`, `LATE_WARN`, `BLOCK_CANDIDATE`
3. `HARD`에서는 `PASS`, `DEFER_HINT`, `BLOCK_CANDIDATE`

### `febt_authority`

허용값:

1. `SHADOW_ONLY`
2. `TIMING_ADVISORY`
3. `WAIT_PRIMARY`

초기값:

1. `SHADOW` 단계는 항상 `SHADOW_ONLY`

## 권한 경계

### `FEBT`가 할 수 있는 것

1. `지금은 FIRE다`
2. `지금은 ARMED라서 1봉 대기 힌트가 있다`
3. `지금은 LATE라서 추격 위험이 높다`
4. `지금은 VOID라서 timing 구조가 무효다`

### `FEBT`가 할 수 없는 것

1. `L1~L3`를 무효화
2. `ENTRY/ADD/REDUCE/DROP/EXIT` 최종 결정
3. account-level risk sizing
4. duplicate/reject/partial fill 처리

## L5 행동층 소비 규칙

`L5`는 `FEBT`를 아래처럼 읽는다.

1. `SHADOW_ONLY`
   - 저장만 함
2. `TIMING_ADVISORY`
   - action 후보를 재정렬할 수 있으나, `L1~L3` verdict를 뒤집지 않음
3. `WAIT_PRIMARY`
   - `5차 WAIT` 본판정으로 사용하되, fail-safe는 기존 wait-one-bar 유지

## JSON 예시

```json
{
  "symbol": "BTCUSDT",
  "tf": "60",
  "side": "BUY",
  "event": "LONG",
  "bar_close_time_utc_ms": 1774753200000,
  "market_state_summary_state": "ORDERED",
  "entry_structure_ok": true,
  "ev_gate_ok": true,
  "febt_mode": "SHADOW",
  "febt_phase": "FIRE",
  "febt_lock_score": 0.74,
  "febt_delay_cost": 0.66,
  "febt_late_risk": 0.29,
  "febt_failure_risk": 0.18,
  "febt_edge": 0.37,
  "febt_state_valid": true,
  "febt_calc_ok": true,
  "febt_calc_reason": "OK",
  "febt_timing_action": "OBSERVE",
  "febt_authority": "SHADOW_ONLY"
}
```

## 실패 처리

1. `febt_calc_ok = false`
2. `febt_phase = UNKNOWN`
3. `febt_timing_action = NO_OP`
4. `FEBT`는 live decision을 바꾸지 않음
5. 서버는 `febt_payload_missing` 또는 `febt_calc_reason`를 저장

세부 fallback 규칙:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_FAILSAFE_POLICY.md`

## 문서 요구사항

`BEST` 또는 `FEBT` 관련 새 문서는 아래 중 하나를 반드시 포함해야 한다.

1. 입력 스키마 변경
2. 출력 스키마 변경
3. 권한 경계 변경
4. failure handling 변경
5. 재검증 조건

## 한 줄 결론

`BEST`와 `FEBT` 사이의 계약은 "좋은 개념"이 아니라 "언제 호출하고, 무엇을 받고, 무엇만 내보내며, 무엇은 절대 못하게 할지"를 명시하는 인터페이스여야 한다.
