# FEBT_PINE_INTRODUCTION_PLAN

- 제정: 2026-03-29
- 상태: PROPOSED
- 대상: `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.0.pine.txt`
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_THRESHOLD_CALIBRATION_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_FAILSAFE_POLICY.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FILTER_STAGE_POLICY.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/PINE_AND_FILTER_STAGE_ROLES.md`

## 목표

`BEST` 상위 이론 안에서 `FEBT`를 PineScript에 도입해 `5차 WAIT 타이밍층`을 더 정교한 Pine-native timing model로 승격한다.

핵심 목표는 아래 3개다.

1. `FIRE` 봉의 진입 품질이 현재 immediate entry보다 좋아야 한다.
2. `LATE` 차단이 saved loss > missed gain 구조를 만들어야 한다.
3. 기존 `EARLY / CORE`, `LONG / SHORT`, Pine quality 의미를 훼손하지 않아야 한다.

## 절대 불변 조건

1. `EARLY / CORE` 의미를 바꾸지 않는다.
2. 외부 이벤트명 `LONG / SHORT`를 바꾸지 않는다.
3. `FEBT`는 새 source band를 만들지 않는다.
4. `FEBT`는 `1~4차` 판단을 다시 하지 않는다.
5. 롱/숏은 항상 대칭 구현한다.
6. 초기 도입은 `shadow`부터 시작한다.
7. Pine 신호는 `1~5차 활성 필터`를 우회하지 않는다.
8. `FEBT`는 `5차 WAIT 타이밍층`의 주판정 후보이며, `6차 새 레이어`로 추가하지 않는다.

## 역할 분리 증명 규칙

`FEBT`는 아래 증명이 없으면 도입 후보로 승격하지 않는다.

1. `2차 진입 품질`과의 차이:
   - `score / confidence / posterior / wave` 본체를 다시 판정하지 않는다는 증명
2. `3차 상태 기반 Soft Sizing`과의 차이:
   - 상태 방향성 자체가 아니라 `현재 봉 실행 가능성`만 판정한다는 증명
3. `4차 EV/시간가치층`과의 차이:
   - TP1 확률 하한이나 sizing policy를 다시 계산하지 않는다는 증명
4. `5차 WAIT 타이밍층`과의 관계:
   - `FEBT`는 현행 5차를 대체/승격하는 모델이며, 병렬 중복 레이어가 아니라는 명시

필수 산출물:

1. `signal overlap matrix`
   - `FEBT` vs `2차/3차/4차/현행 5차`
2. `disagreement attribution`
   - 어떤 케이스에서만 `FEBT`가 기존 5차와 다른지
3. `expected entry count delta`
   - `FEBT` 적용 시 진입 빈도 변화 추정

## 도입 범위

### Pine 내부 추가

1. 신규 계산 필드
   - `febt_lock_score`
   - `febt_delay_cost`
   - `febt_late_risk`
   - `febt_failure_risk`
   - `febt_edge`
   - `febt_phase`
   - `febt_fire_long`
   - `febt_fire_short`

2. 신규 input group
   - `grp_febt = "═══ FEBT Timing ═══"`

3. 신규 운영 모드
   - `OFF`
   - `SHADOW`
   - `SOFT`
   - `HARD`

### 서버/자동화 연계

1. Pine payload에 `febt_*` 메타를 실을 수 있게 필드 예약
2. 서버는 `SHADOW` 단계에서 저장만 하고 진입 로직은 그대로 유지
3. 자동화는 `phase별 TP1/SL/MAE/MFE/time-to-event`를 리포트한다.

## Phase별 실행 계획

### Phase 0 — Baseline 고정

목적:
1. 현행 `wait-one-bar` 성과 baseline 확보

세부 스펙:
1. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`

작업:
1. 최근 7d / 14d / 28d / 56d 기준으로
   - `5차 WAIT` 발동 수
   - wait 후 성과
   - no-wait 후 성과
   - saved loss / missed gain
2. symbol × side × tier × regime 분해
3. 현재 `wait-one-bar` reason별 top failure 수집
4. 현행 `2차/3차/4차/5차`와 타이밍 관련 신호 중복도 측정
5. Pine signal -> webhook -> order intent -> fill까지 브리지 지연 baseline 측정

완료 기준:
1. baseline markdown/json 존재
2. `FIRE/LATE` 비교 기준 수치 확정
3. `signal overlap matrix` 초안 존재
4. 브리지 지연의 p50 / p95 / max baseline 존재

### Phase 1 — Pine Shadow Feature Emit

목적:
1. Pine가 `FEBT`를 계산하지만 신호 차단은 하지 않음

세부 스펙:
1. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`

작업:
1. `febt_*` 계산 함수 추가
2. `febt_phase`를 debug/payload 메타에만 기록
3. chart debug label 또는 panel row 추가는 선택적
4. `SHADOW` mode에서만 활성
5. `FEBT` 계산 실패 시 `febt_phase = UNKNOWN`, `febt_timing_action = NO_OP`로 기록하고, live entry decision에는 영향 주지 않음

완료 기준:
1. 차트 신호 수 변화 0
2. payload에 `febt_phase`, `febt_edge` 존재
3. Pine compile 통과
4. `FEBT` 계산 실패율이 리포트됨

### Phase 2 — Server Shadow Logging

목적:
1. 서버와 자동화가 `FEBT` phase별 성과를 수집

작업:
1. webhook ingest가 `febt_*` 필드 저장
2. signal/quality report에 `febt_phase` 포함
3. weekly governance, objective supervisor, hourly guard, improvement pack에 phase breakdown 추가
4. TradingView alert 시각, webhook 수신 시각, intent 생성 시각, fill 시각 차이를 연결해서 latency budget 리포트 추가
5. duplicate signal / overlap signal / stale signal과 `FEBT` phase 관계 집계
6. `FEBT` 저장 실패 시 fallback reason code 기록
7. fill/trade/impact report propagation은 `Phase 2b` 후속 범위로 분리

완료 기준:
1. phase별 표본 수 집계 가능
2. `FIRE`, `ARMED`, `LATE`별 TP1/SL 비교 가능
3. phase별 latency / dedupe / stale 연계 분석 가능

### Phase 3 — Soft Enforcement

목적:
1. 가장 위험이 낮은 규칙부터 `FEBT`를 실제 진입 정책에 반영

작업:
1. `SOFT` mode 도입
2. 규칙:
   - `FIRE` = pass
   - `ARMED` = one-bar defer hint
   - `LATE` = aggressive add 차단 또는 late-risk 높을 때만 defer
   - `VOID` = hard drop 후보지만 초기에는 warning-only 또는 narrow block
3. `saved loss > missed gain` 구간만 활성
4. risk sheet 고정:
   - max risk per trade
   - daily drawdown kill-switch
   - symbol concentration cap
   - max concurrent position cap
5. bridge runbook 고정:
   - duplicate alert dedupe
   - order reject handling
   - partial fill handling
   - manual override procedure

완료 기준:
1. realized 표본 기준 expectancy 훼손 없음
2. phase별 regression 없음
3. 최소 `4주 shadow` 또는 동등한 다중 윈도우 관측 통과
4. risk sheet와 bridge runbook 서명 완료

### Phase 4 — Hard Promotion

목적:
1. `5차 WAIT 타이밍층`의 주판정을 `FEBT` 중심으로 전환

작업:
1. `HARD` mode 도입
2. 기존 `wait-one-bar` 규칙은 fallback safety net만 유지
3. `FEBT phase`를 메인 timing verdict로 사용
4. Binance testnet 또는 동등한 모의 execution bridge 검증 완료 후에만 실전 승격

완료 기준:
1. `FIRE precision`이 기존 wait-one-bar보다 우세
2. `LATE` 차단이 saved loss > missed gain 유지
3. supervisor / governance / canary에서 drift 없음
4. p95 bridge latency가 사전 허용 budget 이내

## Pine 설계 원칙

세부 OHLCV 입력 공식:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_MICROSTRUCTURE_INPUT_SPEC.md`
2. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`

### 입력 재료

1. candle microstructure
   - `range_pos`
   - `body_ratio`
   - `upper/lower_wick_ratio`
2. continuation / extension
   - `same_dir_streak`
   - `recent_move_1_pct`
   - `recent_move_2_pct`
3. structure retention
   - `break_retention`
   - `close_control`
4. exhaustion / reversal
   - `impulse_decay`
   - `counter_rejection`
   - `micro_absorption`

### 출력 phase 기준

1. `VOID`
   - `state_validity == false` 또는 `failure_risk > fail_max`
2. `PREPARE`
   - 잠김이 부족
3. `ARMED`
   - 잠김은 있으나 아직 edge 부족
4. `FIRE`
   - `lock_score` 충분 + `delay_cost - late_risk` 우위
5. `LATE`
   - 방향은 맞지만 과열/추격

## 초기 임계값 정책

초기에는 dynamic tuning보다 보수적 고정값으로 시작한다.

원칙:
1. `SHADOW` 단계에서는 threshold를 운용값이 아니라 관측값으로 본다.
2. `SOFT` 전환 전 최소 2개 윈도우 이상에서 동일 방향 성과 확인
3. symbol 특이치는 초기에 허용하지 않는다.
4. first release는 provider 전체 공통값만 사용
5. `SOFT` 전환 전 최소 기준:
   - observation >= `4주`
   - `FIRE` win rate >= `52%`
   - `FIRE` avg_ret_net non-inferior
   - `FIRE` Sharpe-like quality proxy >= `0.8`
6. 단계 해석:
   - `52%` = `SHADOW -> SOFT` 후보선
   - `58%` = `SOFT 유지선`
   - `60%` = `HARD 승격선`

## 자동화 검증 계획

### 필수 리포트

1. `FEBT shadow report`
   - phase별 count
   - TP1 first / SL first / unresolved
   - avg_ret_net
   - MFE / MAE
   - time-to-TP1 / time-to-SL
2. `FEBT disagreement report`
   - 현행 wait-one-bar와 `FEBT` 판정이 다른 케이스만 분리
3. `phase precision report`
   - symbol × side × tier × regime × phase
4. `bridge latency report`
   - alert -> webhook -> intent -> fill
5. `failure fallback report`
   - Pine calc fail
   - payload missing
   - duplicate/stale overlap

### 필수 합격선

1. `FIRE`:
   - win rate non-inferior
   - avg_ret_net non-inferior
2. `LATE`:
   - blocked case의 saved loss > missed gain
3. `ARMED`:
   - 1봉 뒤 진입의 평균 성과가 immediate보다 같거나 우세
4. 전체:
   - 월간 순수익 페이스 악화 금지
5. 운영:
   - p95 bridge latency budget 이내
   - duplicate signal escalation 없음
   - fallback fail-open 금지

## 옥토퍼스 검증 질문

옥토퍼스는 아래 질문에 답해야 한다.

1. `FEBT`가 현재 5차 역할과 겹치지 않고 독립된 timing theory로 성립하는가
2. `SHADOW -> SOFT -> HARD` 단계가 충분히 보수적인가
3. Pine에 두기 적절한 계산과 서버로 남겨야 할 계산이 명확한가
4. phase 정의가 실전적으로 검증 가능한가
5. 어떤 failure mode가 가장 위험한가
6. hard promotion 전에 반드시 추가해야 할 리포트/가드가 무엇인가

## 위험 목록

1. `FIRE`가 사실상 chase continuation만 높게 찍히는 위험
2. `LATE`가 좋은 추세봉까지 과차단하는 위험
3. symbol/regime별 drift
4. Pine와 서버가 서로 다른 `FEBT` 의미를 쓰는 split-brain
5. 기존 wait-one-bar와 중복으로 신호가 과도하게 줄어드는 위험
6. filter-stage authority ambiguity로 Pine phase가 서버 필터를 우회하는 위험
7. bridge latency로 `FIRE`가 실제 체결 시점에는 `LATE`가 되는 위험
8. Pine 계산 실패 시 fail-open 또는 fail-close가 무정의인 위험

## Go / No-Go 기준

### Go

1. shadow 데이터에서 `FIRE`가 평균적으로 가장 좋은 phase
2. `LATE` 차단의 기회비용이 방어이익보다 작음
3. objective/monthly pace 훼손 없음
4. Octopus verdict가 `APPROVE` 또는 최소 `HOLD with narrow fixes`
5. role overlap matrix가 허용 범위 이내
6. risk sheet / bridge runbook / fallback policy 완료

### No-Go

1. `FIRE`와 `LATE`가 성과적으로 분리되지 않음
2. `ARMED` 대기가 오히려 성과 악화
3. 기존 wait-one-bar 대비 명확한 개선 신호 없음
4. Octopus가 `REJECT`
5. stage authority 또는 fallback policy가 미정

## 최종 산출물

1. Pine shadow patch spec
2. Phase 0 measurement plan
3. Phase 1 Pine field spec
4. payload field spec
5. weekly governance phase report spec
6. hard promotion checklist

## 한 줄 결론

`FEBT` 도입은 가능하지만, `shadow -> soft -> hard` 순서와 phase별 사후검증 체계를 먼저 고정하지 않으면 바로 넣으면 안 된다.
