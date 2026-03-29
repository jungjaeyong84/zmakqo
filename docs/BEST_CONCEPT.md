# BEST_CONCEPT

- 제정: 2026-03-29
- 상태: PROPOSED
- 정식 명칭:
  - 국문: 균형 실행 신호 이론
  - 영문: Balanced Executable Signal Theory
  - 약칭: `BEST`
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PHILOSOPHY.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_IMPLEMENTATION_FRAMEWORK.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_INTERFACE_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SIGNAL_COUNT_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_OPERATIONAL_GUARDS.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_REPLACEMENT_MEASUREMENT_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_THRESHOLD_CALIBRATION_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_FAILSAFE_POLICY.md`

## 목적

`BEST`의 최종 목적은 아래 하나다.

1. 너무 빠르지도, 너무 늦지도, 너무 보수적이지도 않은 최적의 차트 신호를 만드는 것

운영 목표는 아래 2개를 동시에 잡는다.

1. 승인 시장군에서 `승률 60%+`
2. baseline 대비 `신호 수 감소 금지`

즉 `BEST`는 "모든 학문을 도입하고 분석해서 차트에 신호를 만드는 새로운 학문"을 위한 상위 개념이다.

이 이론의 성공 조건은 단순한 승률 하나가 아니다.

1. 좋은 상태에서
2. 좋은 구조 위에
3. 좋은 시간가치를 가지고
4. 가장 후회 비용이 낮은 타이밍에
5. 실제 체결 가능한 신호를 만드는 것

## 왜 새 상위 학문이 필요한가

현재 시스템에는 이미 여러 학문 조각이 들어와 있다.

1. 통계물리학
   - 시장 상태 인식
2. 시장 미시구조
   - 봉 구조와 entry quality
3. 생존분석
   - TP1/SL/hold value
4. 베이지안 의사결정
   - posterior, utility, action selection
5. 제어이론
   - sizing, kill-switch, cooldown
6. 정보이론
   - 중복 feature 억제, 설명력 점검

문제는 이들이 하나의 신호 이론으로 명시적으로 묶여 있지 않다는 점이다.

그래서 `BEST`는 기존 학문을 새로 덧붙이는 것이 아니라, 이미 들어온 학문을 한 체계로 정렬한다.

## 핵심 원리

`BEST`는 신호를 아래 5개 층의 합의로 본다.

1. `상태 적합성`
   - 지금 시장이 원천적으로 실행 가능한 상태인가
2. `구조 적합성`
   - 지금 봉/구조가 entry quality를 만족하는가
3. `시간가치 적합성`
   - 지금 진입의 기대값과 생존 가치가 충분한가
4. `타이밍 적합성`
   - 지금이 너무 빠르지도 늦지도 않은 최초 실행 가능 시점인가
5. `행동 적합성`
   - 그래서 실제로 ENTRY/ADD/REDUCE/DROP 중 무엇을 할 것인가

`BEST`의 핵심은 어느 한 층이 모든 결정을 독점하지 않게 만드는 것이다.

## 현재 시스템과의 대응

현재 운영 계층과의 대응은 아래와 같다.

1. `1차 상태/무결성`
   - 상태 적합성의 기본 계약
2. `2차 진입 품질`
   - 구조 적합성
3. `3차 상태 기반 Soft Sizing`
   - 상태 적합성의 sizing/완화 반영
4. `4차 EV/시간가치층`
   - 시간가치 적합성
5. `5차 WAIT 타이밍층`
   - 타이밍 적합성

즉 `BEST`는 현재 필터를 부정하지 않는다.
현재 필터를 하나의 학문적 구조로 재정의한다.

## 하위 이론

`BEST`는 하나의 단일 함수가 아니라, 아래 하위 이론의 조합이다.

1. `MSR`
   - Market State Recognition
   - 상태 인식 이론
2. `SEQ`
   - Structural Entry Quality
   - 구조 품질 이론
3. `HSV`
   - Hold Survival Value
   - 시간가치/생존가치 이론
4. `FEBT`
   - First Executable Bar Theory
   - 최초 실행 가능 봉 이론
5. `AUP`
   - Action Utility Policy
   - 최종 행동 선택 정책

## FEBT의 위치

`FEBT`는 `BEST` 전체가 아니다.

1. `BEST`는 상위 통합 학문
2. `FEBT`는 그 안의 `타이밍 핵심 이론`

따라서 `FEBT`를 5차에 넣는 것은 타당하지만,
`FEBT = 모든 신호 학문`으로 보는 것은 부정확하다.

## 신호의 정의

`BEST` 기준에서 좋은 신호는 아래를 만족해야 한다.

1. `상태는 좋다`
2. `구조는 좋다`
3. `시간가치는 충분하다`
4. `타이밍은 적절하다`
5. `행동 결정은 실전 제약을 통과한다`

이 다섯이 동시에 맞아야 "너무 빠르지도 늦지도 않은" 신호가 된다.

## Pine와 서버의 역할 분리

### Pine

1. 상태/구조/타이밍에 가까운 즉시 계산을 담당
2. chart-visible signal metadata 생성
3. `BEST`의 현장 센서 역할

### 서버

1. 시간가치/행동결정을 담당
2. execution bridge, risk, dedupe, fill reality 반영
3. `BEST`의 정책/실행 엔진 역할

## 자동화의 역할

자동화는 `BEST`의 학문 검증 장치다.

1. 각 층의 독립성 검증
2. overlap matrix 산출
3. saved loss / missed gain 측정
4. latency/duplicate/reject 추적
5. drift 감시

## 성공 기준

`BEST`는 아래를 만족할 때만 진짜 학문으로 본다.

1. 각 층의 역할이 중복되지 않는다.
2. chart signal이 실제 체결 성과로 이어진다.
3. 너무 빠른 진입과 너무 늦은 추격을 동시에 줄인다.
4. weekly/monthly objective를 훼손하지 않는다.
5. 자동화 리포트로 사후 검증 가능하다.

## 한 줄 결론

`BEST`는 기존 학문을 더 붙이는 개념이 아니라, 현재 시스템에 이미 들어온 학문들을 통합해 "최적의 차트 신호를 만드는 상위 이론"이다. `FEBT`는 그 안에서 "가장 먼저 들어가도 후회 비용이 낮은 봉"을 찾는 타이밍 핵심 이론이다.
