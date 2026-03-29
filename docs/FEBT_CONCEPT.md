# FEBT_CONCEPT

- 제정: 2026-03-29
- 상태: PROPOSED
- 정식 명칭:
  - 국문: 최초 실행 가능 봉 이론
  - 영문: First Executable Bar Theory
  - 약칭: `FEBT`
- 상위 이론:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md`
- 적용 범위:
  - PineScript 타이밍 모델 설계
  - 서버 `5차 WAIT 타이밍층` 재설계
  - 자동화 리포트의 타이밍 품질 검증

## 목적

`FEBT`는 `BEST` 안에서 "가장 빠른 봉"이 아니라 "가장 먼저 들어가도 후회 비용이 낮은 봉"을 찾기 위한 Pine-native 타이밍 이론이다.

이 문서는 새 필터를 하나 더 추가하려는 문서가 아니다.
현재 운영 체계의 `5차 WAIT 타이밍층`을 더 정교한 타이밍 과학으로 승격하기 위한 개념 문서다.

핵심 질문은 하나다.

1. 지금 봉이, 한 봉 더 기다리면 오히려 불리해질 가능성이 높고, 동시에 이미 늦은 추격봉은 아닌가?

## 왜 필요한가

현재 시스템은 이미 아래 학문 조각을 일부 포함하고 있다.

1. 통계물리학:
   - 상태 인식
2. 미시구조:
   - entry quality 재료
3. 생존분석:
   - EV / TP1 / hold-value
4. 베이지안 의사결정:
   - 정책 결합과 action selection

문제는 `타이밍`만을 위한 독립 개념이 약하다는 점이다.

현재 `5차 WAIT 타이밍층`은 아래 질문을 섞어서 본다.

1. 지금 봉이 너무 늦은가
2. 지금 봉이 과열인가
3. 한 봉 더 기다리면 나아질까
4. 지금 진입이 breakout continuation인지 fake break인지

`FEBT`는 이 질문들을 하나의 타이밍 이론으로 정리한다.

## 비목표

`FEBT`는 아래를 목표로 하지 않는다.

1. 최고점/최저점 정확 예측
2. 바닥/천장 picking
3. 상태층, 진입 품질층, EV/시간가치층의 역할 대체
4. 1차~4차에서 이미 판단한 내용을 다시 중복 판정

즉 `FEBT`는 `BEST`의 하위 이론이며, `5차 WAIT 타이밍층`의 역할만 담당한다.

## 기존 체계 내 위치

현재 기준 계층은 아래와 같다.

1. `1차 상태/무결성`
2. `2차 진입 품질`
3. `3차 상태 기반 Soft Sizing`
4. `4차 EV/시간가치층`
5. `5차 WAIT 타이밍층`

`FEBT`는 아래 원칙으로 들어간다.

1. `1~4차`를 통과한 뒤에만 평가한다.
2. `1~4차`의 판정을 뒤집지 않는다.
3. `지금 들어갈지`, `한 봉 미룰지`, `이미 늦었는지`만 판단한다.
4. 장기적으로는 현재 `wait-one-bar` 규칙 엔진을 `FEBT`로 치환하거나 흡수한다.

## 핵심 개념

`FEBT`는 타이밍을 아래 5개 힘의 균형으로 본다.

1. `state_validity`
   - 지금 상태가 원천적으로 진입 가능한가
   - 입력:
     - regime
     - stat-physics summary
     - Pine quality state

2. `lock_score`
   - 방향이 실제로 봉 안에서 잠겼는가
   - 질문:
     - 종가가 body/range 안에서 얼마나 우세한가
     - wick rejection이 있는가
     - breakout이 close 기준으로 유지됐는가

3. `delay_cost`
   - 한 봉 더 기다리면 얼마나 불리해질 가능성이 큰가
   - 질문:
     - 이미 방향성이 붙었는가
     - momentum decay 전에 선점해야 하는가
     - 한 봉 뒤에는 더 추격이 될 가능성이 큰가

4. `late_risk`
   - 지금 들어가면 이미 늦었을 가능성이 큰가
   - 질문:
     - same-direction streak가 과도한가
     - body expansion이 과한가
     - close가 extreme에 붙어 있는가
     - mean reversion risk가 커졌는가

5. `failure_risk`
   - 지금 봉이 continuation이 아니라 fake move일 확률이 큰가
   - 질문:
     - breakout failure 구조인가
     - 반대 wick이 크고 close recovery가 약한가
     - impulsive continuation이 아니라 exhaustion인가

## FEBT의 상태값

`FEBT`는 최종적으로 5개 phase를 낸다.

1. `PREPARE`
   - 상태는 유효하지만 아직 봉이 잠기지 않았다.
2. `ARMED`
   - 거의 진입 가능하지만 한 박자 이르다.
3. `FIRE`
   - 최초 실행 가능 봉이다.
4. `LATE`
   - 방향 자체는 맞을 수 있으나 지금 진입은 추격일 가능성이 높다.
5. `VOID`
   - 구조가 무효다. wait이 아니라 진입 취소에 가깝다.

의미:

1. `PREPARE`
   - 진입하지 않는다.
2. `ARMED`
   - 다음 봉 확인 가치가 높다.
3. `FIRE`
   - 현재 체계에서는 진입 허용 후보
4. `LATE`
   - 5차에서 연기 또는 drop 후보
5. `VOID`
   - 명시적 차단 후보

## FEBT의 수학적 직관

엄밀한 물리 모델이 아니라, 아래 불평등으로 타이밍을 본다.

1. `state_validity = true`
2. `lock_score >= lock_min`
3. `delay_cost - late_risk >= edge_min`
4. `failure_risk <= fail_max`

롱 예시:

1. `state_validity_long`
2. `lock_score_long`
3. `delay_cost_long`
4. `late_risk_long`
5. `failure_risk_long`

최종 판단 예시:

```text
if not state_validity:
  phase = VOID
else if failure_risk > fail_max:
  phase = VOID
else if late_risk >= late_hard_max:
  phase = LATE
else if lock_score < lock_arm_min:
  phase = PREPARE
else if lock_score >= lock_fire_min and (delay_cost - late_risk) >= fire_edge_min:
  phase = FIRE
else:
  phase = ARMED
```

우선순위 메모:

1. `LATE` 판정은 `PREPARE`보다 우선한다.
2. 즉 `late_risk >= late_hard_max`와 `lock_score < lock_arm_min`가 동시에 참이면 canonical phase는 `LATE`다.
3. 구현 SSOT는 `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`다.

## Pine에서 계산할 기본 변수

### 공통 입력

1. `range_pos`
   - 현재 종가의 봉 범위 내 위치
2. `body_ratio`
   - body / range
3. `upper_wick_ratio`
4. `lower_wick_ratio`
5. `same_dir_streak`
6. `recent_move_1_pct`
7. `recent_move_2_pct`
8. `break_retention`
   - breakout 후 종가 유지 정도
9. `close_control`
   - 종가 지배력
10. `impulse_decay`
11. `counter_rejection`
12. `micro_absorption`

세부 공식:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_MICROSTRUCTURE_INPUT_SPEC.md`
2. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`

### 파생 점수

1. `febt_lock_score`
   - close control
   - break retention
   - direction body
   - rejection wick

2. `febt_delay_cost`
   - continuation likelihood
   - early momentum persistence
   - next-bar chase risk

3. `febt_late_risk`
   - same-dir streak
   - chase ratio
   - stretched close
   - exhaustion likelihood

4. `febt_failure_risk`
   - breakout failure
   - opposite wick reversal
   - close fade
   - impulse decay after extension

## Pine 출력 필드

Pine은 아래 메타를 만들 수 있어야 한다.

1. `febt_phase`
2. `febt_lock_score`
3. `febt_delay_cost`
4. `febt_late_risk`
5. `febt_failure_risk`
6. `febt_edge = febt_delay_cost - febt_late_risk`
7. `febt_state_valid`
8. `febt_fire_long`
9. `febt_fire_short`

원칙:

1. 숫자 자체보다 `phase`가 더 중요하다.
2. 자동화는 숫자와 phase를 같이 저장해야 한다.
3. 사용자-facing 텔레그램은 phase 중심으로 읽히게 한다.

## 서버 역할

서버는 `FEBT`를 아래처럼 소비한다.

1. `PREPARE`
   - no entry
2. `ARMED`
   - one-bar defer 후보
3. `FIRE`
   - 5차 통과
4. `LATE`
   - wait 또는 drop
5. `VOID`
   - drop

중요 원칙:

1. 서버가 Pine의 `FEBT`를 다시 raw candle로 재계산하지 않는다.
2. 서버는 Pine 출력 phase를 신뢰하고, 필요하면 운영 policy만 얹는다.
3. 서버 fallback이 필요하면 동일 필드명 기반 최소 재평가만 한다.

## 자동화 검증 항목

`FEBT`는 이름만 붙인 필터가 아니라 사후검증 가능한 체계여야 한다.

최소 검증 항목:

1. `phase별 표본 수`
2. `phase별 execution rate`
3. `phase별 TP1 first rate`
4. `phase별 SL first rate`
5. `phase별 avg_ret_net`
6. `phase별 MFE / MAE`
7. `phase별 time-to-TP1 / time-to-SL`
8. `ARMED에서 1봉 연기 후 성과`
9. `LATE 진입의 손실률`
10. `FIRE precision by symbol`

핵심 비교:

1. `FIRE`가 현재 wait-one-bar보다 실제로 더 좋은가
2. `ARMED -> 다음 봉 진입`이 현재 immediate entry보다 좋은가
3. `LATE`를 차단했을 때 missed gain보다 saved loss가 더 큰가

## 기존 필터와의 관계

`FEBT`는 아래와 겹치면 안 된다.

1. `1차 상태/무결성`
   - payload integrity 재검사 금지
2. `2차 진입 품질`
   - score/conf/posterior/wave 본체 재판정 금지
3. `3차 상태 기반 Soft Sizing`
   - 상태 방향성 재판정 금지
4. `4차 EV/시간가치층`
   - TP1 확률 하한 재판정 금지

`FEBT`가 해도 되는 일:

1. 지금 봉이 너무 이른지
2. 지금 봉이 최초 실행 가능한지
3. 지금 봉이 이미 늦었는지
4. 지금 봉이 continuation보다 fake break일 가능성이 높은지

## 현재 wait-one-bar와의 관계

현행 `wait-one-bar`는 유지하되, `FEBT`는 아래 경로로 단계적 이관한다.

1. Phase A
   - 기존 wait-one-bar 유지
   - Pine이 `febt_*` 메타만 발행
   - 서버/자동화는 shadow 비교만 수행
2. Phase B
   - wait-one-bar와 `FEBT` 동시 평가
   - disagreement cases만 분석
3. Phase C
   - `FEBT phase`를 5차의 주판정으로 승격
   - 기존 wait-one-bar rule은 보조 safety net으로 축소

## 롱/숏 대칭 원칙

`FEBT`는 항상 대칭이다.

1. 롱에서 쓰는 변수는 숏에도 대칭 변환되어야 한다.
2. 롱 전용 타이밍 우대, 숏 전용 예외는 금지한다.
3. 비대칭이 필요하면 `symbol/regime evidence`로만 허용한다.

## 실패 조건

아래 중 하나면 `FEBT`는 실패로 본다.

1. `FIRE` 표본은 늘었지만 avg_ret_net이 악화
2. `LATE` 차단으로 missed gain이 saved loss보다 큼
3. `ARMED` 대기 전략이 실제로는 기회비용만 키움
4. phase 정의가 market/regime마다 drift가 큼
5. Pine와 서버가 다른 `FEBT` 의미를 쓰는 split-brain 발생

## 도입 전제

`FEBT` 도입 전 아래가 먼저 필요하다.

1. `5차 WAIT 타이밍층` 현재 성과 baseline
2. symbol × regime × side × tier 기준 비교표
3. shadow canary에서 `FEBT` phase logging
4. Pine payload에 `febt_*` 필드 실을 자리 확보
5. weekly governance / objective supervisor / impact report에 phase별 breakdown 추가

## 권장 다음 단계

1. Pine 변수명 확정
   - `febt_lock_score`
   - `febt_delay_cost`
   - `febt_late_risk`
   - `febt_failure_risk`
   - `febt_phase`
2. Pine shadow implementation
3. 서버 수신/저장 필드 추가
4. 자동화 phase 리포트 추가
5. 기존 wait-one-bar와 A/B 비교

## 한 줄 정의

`FEBT`는 "가장 먼저 들어가도 후회 비용이 낮은 최초 봉"을 찾는 Pine-native 타이밍 이론이다.
