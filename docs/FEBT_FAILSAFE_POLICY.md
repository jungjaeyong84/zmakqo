# FEBT_FAILSAFE_POLICY

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `FEBT` 계산 실패, payload 누락, side 불명확, 서버 미수신 시 fallback 행동 정의
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_INTERFACE_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_OPERATIONAL_GUARDS.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`

## 목적

`febt_calc_ok = false`, `febt_phase = UNKNOWN`일 때 무엇을 할지 명시한다.

## 불변 조건

1. `FEBT` 실패는 active filters 우회 사유가 될 수 없다.
2. `UNKNOWN`은 `ALLOW`가 아니다.
3. fallback은 항상 `legacy 5차 WAIT` 기준이다.

## 실패 유형

1. `CALC_FAIL`
2. `PAYLOAD_MISSING`
3. `SIDE_UNKNOWN`
4. `STATE_INPUT_MISSING`
5. `SERVER_INGEST_FAIL`

## 모드별 fallback

### OFF

1. `legacy 5차 WAIT`만 사용

### SHADOW

1. `FEBT` 실패해도 live decision 영향 없음
2. 서버는 `legacy 5차 WAIT` 그대로 사용

정리:

1. `fail-open to legacy`

### SOFT

1. `FEBT`가 정상이면 advisory만 사용
2. `FEBT`가 실패하면 `legacy 5차 WAIT` verdict만 사용
3. raw entry를 그냥 통과시키지 않는다

정리:

1. `fail-safe to legacy`

### HARD

1. `FEBT`가 정상이면 `WAIT primary`
2. `FEBT`가 실패하면 즉시 `legacy 5차 WAIT fallback`
3. `legacy`마저 unavailable이면 `NO_NEW_ENTRY`

## Pine 측 정책

1. `febt_calc_ok = false`
2. `febt_phase = UNKNOWN`
3. `febt_timing_action = NO_OP`
4. alert는 유지

## 서버 측 정책

### SHADOW

1. 저장만 함
2. entry verdict는 `legacy wait_one_bar`

### SOFT

1. `UNKNOWN` 수신 시 `legacy wait_one_bar` verdict 사용
2. advisory phase 없음으로 간주

### HARD

1. `UNKNOWN` 수신 시 `legacy wait_one_bar` fallback 실행
2. fallback도 실패하면 `NO_NEW_ENTRY`
3. `hourly guard`와 `objective supervisor`에 경보

## 경보 조건

1. `UNKNOWN rate > 1.0%`
2. `PAYLOAD_MISSING rate > 0.5%`
3. `SERVER_INGEST_FAIL > 0.2%`
4. `double-fail > 0`

## 운영 행동

### SHADOW

1. 리포트만

### SOFT

1. unknown rate 임계 초과면 `SOFT -> SHADOW` 후보

### HARD

1. double-fail 발생 시 `HARD -> SOFT` 또는 `HARD -> SHADOW` 롤백 후보

## 한 줄 결론

`FEBT` 실패는 raw entry 허용 사유가 아니라, 항상 `legacy 5차 WAIT`로 안전 복귀해야 하는 운영 사건이다.
