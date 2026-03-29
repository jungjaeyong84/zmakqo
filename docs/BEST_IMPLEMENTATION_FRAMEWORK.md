# BEST_IMPLEMENTATION_FRAMEWORK

- 제정: 2026-03-29
- 상태: PROPOSED
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PHILOSOPHY.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_INTERFACE_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SIGNAL_COUNT_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_OPERATIONAL_GUARDS.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`

## 목적

`BEST`를 실제 시스템에 어떻게 배치할지 정의한다.

핵심은 아래다.

1. Pine는 `센서`
2. 서버는 `정책/실행 엔진`
3. 자동화는 `반증/감사 엔진`

## 전체 구조

### L1 상태층

역할:

1. 시장이 실행 가능한 상태인가

주요 학문:

1. 통계물리학
2. regime detection
3. change-point detection

현재 대응:

1. `1차 상태/무결성`
2. `3차 상태 기반 Soft Sizing` 일부

### L2 구조층

역할:

1. 지금 봉/구조가 진입 품질을 가지는가

주요 학문:

1. 시장 미시구조
2. 구조 품질 이론

현재 대응:

1. `2차 진입 품질`

### L3 시간가치층

역할:

1. 지금 진입의 hold value와 TP1/SL 기대값이 충분한가

주요 학문:

1. 생존분석
2. EV
3. hazard modeling

현재 대응:

1. `4차 EV/시간가치층`

### L4 타이밍층

역할:

1. 지금이 너무 빠르지도 늦지도 않은 최초 실행 가능 시점인가

주요 학문:

1. `FEBT`

현재 대응:

1. `5차 WAIT 타이밍층`

### L5 행동층

역할:

1. ENTRY / ADD / REDUCE / DROP / EXIT 중 무엇을 할 것인가

주요 학문:

1. 베이지안 의사결정
2. 제어이론
3. 실행 리스크 관리

현재 대응:

1. AI bias gate
2. policy/action layer
3. risk sizing

초기 구현 원칙:

1. `L5`는 first release에서 기존 서버 policy 로직의 재정의다.
2. `Phase 0/1`에서 L5 신규 엔진 구현은 범위 밖이다.

## 컴포넌트 매핑

### Pine

Pine가 맡아야 할 것:

1. 상태 센서
2. 구조 센서
3. 타이밍 센서

Pine가 맡으면 안 되는 것:

1. fill reality
2. reject handling
3. partial fill
4. account-level risk

Pine의 출력 원칙:

1. 차트에 보이는 메타
2. payload로 전달되는 즉시 계산값
3. 의미는 고정되고 해석은 서버/자동화와 일치해야 함

### 서버

서버가 맡아야 할 것:

1. 시간가치 최종 판단
2. 행동 정책 선택
3. execution bridge reality
4. dedupe/reject/partial fill
5. risk sizing / cap / cooldown

서버의 출력:

1. 최종 action
2. quantity policy
3. trace payload
4. audit field

### 자동화

자동화가 맡아야 할 것:

1. 각 층 독립성 검증
2. overlap matrix
3. disagreement attribution
4. saved loss / missed gain
5. latency/drift/reject tracking

자동화의 출력:

1. weekly governance
2. objective supervisor
3. hourly guard
4. impact report
5. patch supervisor feedback

## 60%+와 count 유지의 구현 원칙

이 둘을 동시에 달성하려면 아래 원칙이 필요하다.

1. `block-first` 금지
   - 신호를 막기 전에 더 나은 bar로 옮길 수 있는지 먼저 본다.
2. `replacement accounting` 필수
   - 막힌 신호 수와 복구된 신호 수를 같이 센다.
3. `market whitelist` 필수
   - 목표 승률은 승인 시장군 기준으로 잡는다.
4. `count floor` 필수
   - baseline 대비 `count >= 1.00x`
5. `expectancy guard` 필수
   - count를 지키더라도 expectancy가 무너지면 실패

## 개발 순서

### Step 1

1. `BEST` 상위 철학 문서 고정
2. `FEBT`를 timing core로 위치 고정

### Step 2

1. `Phase 0` 측정 체계 고정
2. overlap / saved loss / latency 기준 확정

### Step 3

1. Pine `SHADOW` instrumentation
2. `febt_*` payload 계약 추가

### Step 4

1. 서버 shadow 저장
2. 자동화 phase report 추가

### Step 5

1. `SOFT` 승격
2. replacement accounting 검증

### Step 6

1. `HARD` 승격
2. risk sheet / bridge runbook 승인

## 실패 패턴

### 실패 1

1. 승률은 올라가지만 신호 수가 크게 줄어듦
2. 해석:
   - `BEST` 실패

### 실패 2

1. 신호 수는 유지되지만 실체결 승률이 개선되지 않음
2. 해석:
   - chart timing과 execution reality 분리 실패

### 실패 3

1. `FEBT`가 기존 5차와 사실상 같은 판정만 냄
2. 해석:
   - 새 학문이 아니라 이름만 붙인 중복

### 실패 4

1. Pine timing이 서버 필터를 우회함
2. 해석:
   - 층 분리 실패

## 자동화 검증 질문

자동화는 최소한 아래 질문에 답해야 한다.

1. 새 timing core가 기존 5차와 실제로 다른가
2. 그 차이가 saved loss / missed gain 개선으로 이어지는가
3. count floor가 지켜지는가
4. approved markets에서 `60%+` 목표에 가까워지는가
5. bridge latency가 timing 의미를 깨지 않는가

## 한 줄 결론

`BEST` 구현은 새 필터를 하나 더 얹는 작업이 아니라, Pine/서버/자동화가 각자 맡아야 할 층을 분리하고 같은 신호를 더 좋은 위치로 재배치하는 작업이다.
