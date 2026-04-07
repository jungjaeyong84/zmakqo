# FILTER_STAGE_POLICY

- 제정: 2026-03-25
- 상태: ACTIVE
- 적용 범위:
  - PineScript 필터 설계
  - 서버 엔진 진입 필터 설계
  - 자동 튜닝 주기
  - 텔레그램/리포트/대시보드 단계 표기

## 목적

진입 필터의 단계 의미, 실제 운영 순서, 자동 조정 주기를 한 문서로 고정한다.
이 문서는 필터 단계 관련 해석의 SSOT(single source of truth)다.
역할 분리의 상세 기준은 아래 문서를 함께 따른다.

- `/Users/jeongjaeyong/Projects/donbeolja/docs/PINE_AND_FILTER_STAGE_ROLES.md`
- `/Users/jeongjaeyong/Projects/donbeolja/docs/OBJECTIVE_RETROSPECTIVE_POLICY.md`

## 최종 목표 함수

파인 수정부터 5차 WAIT_ONE_BAR 자동 조정까지 모든 변경은 아래 목표를 공통으로 따른다.

1. 승률:
   - 최소 `60% 이상`
2. 수익:
   - 순수익(`net`) `양수`
   - 기대값(`expectancy / EV`) `양수`
   - 월간 순수익 `1,500,000 KRW 이상`
3. 해석:
   - 승률만 높고 순수익이 음수인 변경은 실패로 본다.
   - 순수익만 양수인데 승률이 60% 미만으로 구조적으로 무너지는 변경도 실패로 본다.
   - 월간 순수익이 `1,500,000 KRW` 미만으로 내려가는 변경도 실패로 본다.
   - 최종 평가는 `승률 60% 이상 + 순수익 양수 + 기대값 양수 + 월간 순수익 1,500,000 KRW 이상`을 동시에 만족하는 쪽을 우선한다.

운영 원칙:

1. 필터 변경은 단일 지표 최적화가 아니라 위 3개 목표의 동시 달성을 목표로 한다.
2. 1~3차 주간 Pine 추천도 이 목표 함수를 기준으로 판단한다.
3. 4차 EV 자동 튜닝도 이 목표 함수를 기준으로 판단한다.
4. 5차 WAIT_ONE_BAR 자동 튜닝도 이 목표 함수를 기준으로 판단한다.
5. 충돌 시 우선순위는 `월간 순수익 1,500,000 KRW 이상 -> 순수익 양수 유지 -> 기대값 양수 유지 -> 승률 60% 이상 수렴`이다.

## 기본 원칙

1. 필터 단계는 `역할`로 구분한다.
2. Pine와 서버가 함께 쓰는 필터와, 서버 단독 필터를 분리한다.
3. Pine 주간 수정 주기와 서버 자동 튜닝 주기를 섞지 않는다.
4. 필터 단계의 의미와 실제 운영 순서를 혼동하지 않는다.
5. Pine 수정부터 4차 EV, 당일 서버 설정 변경, 리포트/텔레그램 해석 변경까지 한 묶음으로 조화롭게 검토한다.
6. 자동 판단은 LLM 자유서술보다 로컬 데이터 기반 ML/통계 리포트를 우선 근거로 삼는다.

## 용어 업데이트 (2026-03-29)

2026-03-29부터 운영 메시지와 감독관 artifact는 아래 계층명을 우선 사용한다.

1. `1차 상태/무결성`
2. `2차 진입 품질`
3. `3차 상태 기반 Soft Sizing`
4. `4차 EV/시간가치층`
5. `5차 WAIT 타이밍층`

기존 문서/리포트/코드에 남아 있는 legacy 용어는 아래처럼 해석한다.

1. `1차 무결성 가드` -> `1차 상태/무결성`
2. `3차 시황(롱숏우위)` -> `3차 상태 기반 Soft Sizing`
3. `4차 EV` -> `4차 EV/시간가치층`
4. `5차 WAIT_ONE_BAR` / `5차 WAIT` -> `5차 WAIT 타이밍층`

원칙:

1. legacy 용어가 남아 있어도 의미 drift로 해석하지 않는다.
2. objective supervisor, Codex weekly patch engine, weekly governance 텔레그램은 새 계층명을 우선 사용한다.
3. 새 계층명은 역할 재분류이며, 자동 조정 cadence 자체를 바꾸는 뜻은 아니다.

## 통합 변경 원칙

필터 변경은 절대 단일 파라미터만 보고 결정하지 않는다.

반드시 함께 고려할 대상:

1. Pine tier 조건 변경
2. 1차 무결성 가드 기준 변경
3. 2차 AI 판단 정책 변경
4. 3차 시황(롱숏우위) 정책 변경
5. 4차 EV threshold/튜닝 변경
6. 5차 WAIT_ONE_BAR timing 튜닝 변경
7. same-day 운영 설정 변경
8. 텔레그램/리포트/대시보드 해석 문구 변경
9. 최신 ML 정책 리포트 해석
10. 최신 shadow canary 결과
11. 최신 `pine_quality_patch_candidates_latest.md`
12. 최신 `objective_retrospective_latest.md`

원칙:

1. 앞단 필터를 완화하면 뒷단 EV나 수량 정책이 같이 보정돼야 한다.
2. Pine에서 tier 의미를 바꾸면 서버 단계 해석도 같은 날 같이 검토해야 한다.
3. 텔레그램/리포트 문구는 실제 운영 순서와 같은 날 같이 맞춰야 한다.
4. 당일 다른 운영 변경이 있으면 필터 추천은 그 변경과 충돌하지 않는지 먼저 확인해야 한다.
5. 단계별 개별 최적화보다 전체 체인 기대값과 해석 일관성을 우선한다.
6. 모든 변경은 `승률 60% 이상 + 순수익 양수 + 기대값 양수 + 월간 순수익 1,500,000 KRW 이상` 목표와 충돌하지 않아야 한다.
7. 1~3차 조정은 최신 `ml_filter_policy_latest.md`를 같이 보고, late-entry penalty와 최근 봉 컨텍스트 근거를 확인해야 한다.
8. 자동 튜닝이나 주간 Pine 수정 전 최신 `filter_shadow_canary_latest.md`를 확인하고, golden/shadow drift가 있으면 수정 작업을 진행하지 않는다.
9. 주간 Pine 수정 전 최신 `pine_quality_patch_candidates_latest.md`가 있으면, 그 후보와 충돌하는 비대칭/과도 변경을 제안하지 않는다.
10. 주간 Pine 수정과 Codex 주간 패치 검토 전 최신 `objective_retrospective_latest.md`를 읽고, 데일리/주간/월간 목표 미달과 반성문을 함께 반영한다.

## 변경 근거 최소 요건

주간 Pine 수정이나 1~4차 필터 조정은 단순 드롭 개수만 보고 결정하지 않는다.

반드시 아래 보고 근거가 먼저 있어야 한다.

1. 표본 충분성:
   - 최소 `7d / 14d / 28d / 56d` 다중 윈도우
   - 단계별로 `충분 / 부족`을 따로 표시
2. side × tier × regime 분해:
   - 최소 `LONG/SHORT × 활성 source band(EARLY/CORE) × regime`
   - 후보, 드롭, 실행, realized 성과를 같이 본다
3. 드롭 반사실 검증:
   - 드롭된 신호가 이후 `TP1 first / SL first / hold / horizon win` 중 무엇이었는지 본다
   - 즉, `드롭이 실제로 맞았는지`를 반드시 확인한다
4. soft sizing 성과 분해:
   - 3차 시황 수량배수
   - 4차 EV band
   별 actual/full-size proxy를 비교한다
5. ML 정책 리포트:
   - late-entry penalty
   - feature coverage
   - stage recommendation
   - 4차 EV band recommendation
   를 같이 본다
6. shadow canary:
   - golden replay drift
   - shadow replay drift
   - 최근 실데이터 기준 단계별 재연 결과
   를 같이 본다
7. Pine 후속 품질:
   - Pine raw signal이 이후 실제로 어떻게 전개됐는지 본다
   - 최소 `execution rate / TP1 hit / realized win / avg_ret_net`를 tier별로 본다
   - 가능하면 `time-to-TP1 / time-to-SL / MFE / MAE / late-entry penalty`를 같이 본다
   - 가능하면 `2h / 4h / 8h / 12h TP1/SL survival`, `TP1 vs SL competing-risk / interval hazard`, `matched baseline MFE/MAE/time-to-event`, `유사군 비교(score/conf/wave/session)`를 같이 본다
   - 주간 Pine 수정은 이 후속 품질이 나빠진 주에만 보수적으로 검토한다

원칙:

1. 단계별 표본이 부족하면 자동 조정은 `KEEP/HOLD`가 기본이다.
2. 1차 무결성 가드와 Pine은 보수적 수정만 허용한다.
3. 2차 AI, 3차 시황, 4차 EV는 반사실 검증과 표본 충분성이 없으면 튜닝하지 않는다.
4. 특히 4차 EV는 `실제 평가 표본`이 부족하면 자동 튜너가 값을 바꾸면 안 된다.
5. golden/shadow canary drift가 하나라도 있으면 자동 반영과 주간 Pine 수정 모두 `HOLD`가 기본이다.
6. Pine은 전체 체인의 뿌리이므로, 후속 품질이 악화됐는데도 단순 aggregate KPI만 보고 수정하지 않는다.
7. Pine과 1차 무결성 가드는 분리해서 완화/강화하지 않는다.
   - Pine 후속 품질이 약하면 1차 완화보다 Pine 보수 수정이 우선이다.
   - 1차 과차단 징후를 보려면 반드시 Pine 후속 품질과 matched baseline을 같이 본다.
   - matched baseline은 가능하면 realized 성과뿐 아니라 `MFE / MAE / time-to-TP1 / time-to-SL / survival / competing-risk`까지 같이 봐야 한다.

## Pine ↔ 1차 정밀 근거

Pine과 1차는 아래 근거를 묶어서 본다.

1. Pine tier별 후속 품질:
   - execution / TP1 / realized win / avg_ret_net
   - time-to-TP1 / time-to-SL
   - MFE / MAE
   - 2h / 4h / 8h / 12h survival
   - 2h / 4h / 8h / 12h competing-risk / interval hazard
2. 1차 무결성 가드 reason별 반사실:
   - TP1 first / SL first / horizon win / avg_ret_net
   - Wilson interval
   - smoothed rate
3. Pine ↔ 1차 무결성 가드 matched baseline:
   - matched avg_ret_net
   - matched MFE / MAE
   - matched time-to-TP1 / time-to-SL
   - 유사군 비교(score/conf/wave/session/late)
4. 변경 예산:
   - 최근 주간 이력과 연속 악화 여부를 보고 Pine/1차 변경 폭을 제한한다.

## Pine ↔ 1차 역할 재정의

현재 운영에서 1차는 `score / confidence / posterior / wave / EV / regime / conflict / entry quality`를 포함한다.
장기 목표는 `품질 판단 SSOT는 Pine`, `서버 1차는 무결성/안전 가드`로 정리하는 것이다.

원칙:

1. Pine는 구조적 품질 판단의 본체가 된다.
2. 외부 라이브 엔트리는 `LONG / SHORT`만 사용한다.
3. `LONG / SHORT`의 source timing은 `EARLY / CORE`, quantity profile은 `FIXED`다.
4. 서버 1차는 `좋은 신호냐`를 다시 해석하지 않고 `정상적인 신호냐`만 본다.
5. Pine와 서버 1차가 같은 품질 의미를 중복으로 다시 판단하는 split-brain 상태를 오래 유지하지 않는다.

Pine 이관 대상:

1. `DROP_LONG_GATE_SCORE`
2. `DROP_LONG_GATE_CONF`
3. `DROP_LONG_GATE_REGIME`
4. `DROP_SHORT_GATE_SCORE`
5. `DROP_SHORT_GATE_CONF`
6. `DROP_SHORT_GATE_REGIME`

서버 1차 잔류 대상:

1. 필수 필드 누락
2. malformed payload
3. event/side 불일치
4. regime/score/conf parsing failure
5. impossible numeric range
6. stale/integrity mismatch
7. 롱숏 대칭 위반
8. 서버 수신 시점 무결성 실패

품질 이관 규칙:

1. `regime / confidence / score / posterior / wave / EV`는 하나의 full quality 묶음으로 같이 이동한다.
2. `regime`만 Pine로 보내고 `confidence`나 `score`를 서버 1차에 남기는 부분 이관은 금지한다.
3. `posterior / wave / EV`를 Pine가 계산하는데 서버 1차가 다시 같은 의미를 재판단하는 split도 금지한다.
4. `confidence`만 먼저 이동하거나 `score`만 마지막에 따로 이동하는 단계적 split은 금지한다.
5. Pine 품질 이관 주에는 Pine와 서버 1차 문구, 텔레그램, 리포트 reason 해석을 같은 날 같이 맞춘다.
6. Pine 품질 이관은 항상 롱/숏 대칭으로만 수행한다.
7. 품질 이관은 주간 Pine 변경 예산 안에서만 허용한다.
8. 최신 shadow canary에 drift가 없고, objective supervisor와 Codex weekly patch review가 `FAILED/BLOCKED` 상태가 아닐 때만 후보로 검토한다.

## 필터 단계 의미

### 0차 운영/보호

- 목적:
  - 시스템 무결성 보호
  - 중복 실행 방지
  - stale / overlap / cooldown / pending 같은 운영 리스크 차단
- 원칙:
  - 항상 hard drop
  - 품질/AI/EV/시황 판단을 여기에 넣지 않는다

### 1차 무결성 가드

- 목적:
  - 현재 운영에서는 신호 자체가 구조적으로 유효한지 확인
  - 장기적으로는 서버 무결성과 안전 가드로 축소
- 포함:
  - score
  - confidence
  - wave confidence
  - regime
  - conflict
  - entry quality
- 원칙:
  - invalid signal 제거가 목적
  - 방향 우위나 TP1 도달 확률은 여기서 판단하지 않는다
  - 장기 목표는 Pine가 품질 의미를 소유하고, 서버 1차는 무결성 실패만 차단하는 구조다

### 2차 AI 판단

- 목적:
  - AI 사용 가능 여부와 기본 허용 여부 확인
- 포함:
  - AI missing
  - AI block
  - AI usable 여부
- 원칙:
  - AI가 없거나 막으면 hard drop
  - 방향 우위와 EV는 여기서 판단하지 않는다

### 3차 시황(롱숏우위)

- 목적:
  - 현재 시장에서 롱/숏 중 어느 방향이 우위인지 판단
- 포함:
  - AI bias
  - neutral policy
  - opposite-side block
- 원칙:
  - 방향 prior를 다룬다
  - score/confidence/wave/TP 복합 기대값은 여기서 다시 판단하지 않는다

### 4차 EV

- 목적:
  - 선택된 방향이 TP0/TP1/시간청산을 함께 반영한 복합 기대값 하한을 만족하는지 확인
- 포함:
  - 최근 봉 기반 TP 복합 exit-value 추정
  - tier별 threshold
  - EV 자동 튜닝
- 원칙:
  - 최종 실행 적합성 필터
  - 방향 우위 판단은 여기서 하지 않는다

### 5차 타이밍 연기(WAIT_ONE_BAR)

- 목적:
  - 0~4차를 모두 통과한 신호라도 현재 봉이 과열된 추격봉이면 다음 봉까지 진입을 연기
- 포함:
  - open/close body
  - wick imbalance
  - same-direction streak
  - 최근 1봉 확장
- 원칙:
  - AI bias, TP1 probability, regime/conflict를 다시 판단하지 않는다
  - 좋은 신호인데 현재 봉만 늦은 경우를 막는 전용 레이어다

## 현재 운영 코드의 실제 순서

2026-03-26 기준 현재 운영 엔진 순서는 아래와 같다.

1. 1차 무결성 가드
2. 2차 AI 판단
3. 3차 시황(롱숏우위)
4. 4차 EV
5. 5차 타이밍 연기(WAIT_ONE_BAR)

설명:

1. 현재 production 코드는 `AI bias -> EV -> WAIT_ONE_BAR` 순서로 정리됐다.
2. 3차 시황은 `prior sizing`, 4차 EV는 `final sizing + kill-switch`, 5차 WAIT는 `late-entry timing deferral` 역할을 가진다.
3. 따라서 화면/텔레그램 단계 표기도 현재 운영 순서에 맞춰야 한다.

## 3차/4차 처리 원칙

1. 3차 시황:
   - soft sizing 중심
   - 강한 반대만 hard drop
2. 4차 EV:
   - final sizing 중심
   - 매우 낮은 TP1 도달 확률에서만 hard kill-switch
3. 최종 수량:
   - `final_qty = base_qty × market_bias_mult × ev_mult`
4. 최근 봉 컨텍스트와 late-entry penalty는 ML 정책 리포트에서 같이 본다.

## 5차 처리 원칙

1. 5차 WAIT_ONE_BAR:
   - hard drop이 아니라 `다음 봉까지 진입 연기` 전용 레이어
   - 좋은 신호인데 현재 봉만 늦은 경우를 분리한다
2. 5차는 아래만 본다:
   - same-direction streak
   - chase ratio
   - close control
   - direction body
   - opposite wick
   - recent 1-bar move
3. 5차는 아래를 다시 판단하지 않는다:
   - regime / conflict / confidence
   - AI usable / AI bias
   - TP1 probability
4. 5차는 4차 EV를 통과한 후에만 동작한다.

## 자동 조정 주기 SSOT

### Pine/전략 구조와 강하게 연결된 필터

아래 필터는 Pine 주간 수정 주기를 따른다.

1. 1차 무결성 가드
2. 2차 AI 판단
3. 3차 시황(롱숏우위)

운영 원칙:

1. `주 1회`, `일요일`
2. 자동 반영이 아니라 `주간 추천안 생성`이 기본
3. Pine 주간 수정과 함께 검토/반영

이유:

1. 이 세 단계는 Pine 신호 생성 의미와 강하게 연결된다.
2. 중간에 자주 바꾸면 Pine와 서버 의미가 다시 어긋난다.

### 서버 단독 적응 필터

아래 필터는 서버 자동 튜닝 주기를 따른다.

1. 4차 EV
2. 5차 WAIT_ONE_BAR

운영 원칙:

1. 4차 EV는 `3일`마다 자동 조정
2. 5차 WAIT_ONE_BAR는 `5일`마다 자동 조정
3. 자동 반영 가능
4. 텔레그램 요약 필수
5. 최신 ML 정책 리포트를 우선 생성하거나 최신본을 참조한다.
6. 주간 Pine/주간 거버넌스는 최신 4차/5차 자동조정 결과를 반드시 같이 확인한다.

이유:

1. EV는 서버 단독 실행 적합성 필터다.
2. Pine 신호 의미를 직접 바꾸지 않는다.
3. 따라서 더 빠른 주기로 adaptive tuning이 가능하다.
4. 단, 튜닝 목표는 단순 threshold 최적화가 아니라 `승률 60% 이상 + 순수익 양수 + 기대값 양수 + 월간 순수익 1,500,000 KRW 이상`이다.
5. 직접 실현 표본이 부족하면 ML 정책 리포트의 EV band 힌트를 제한적으로만 사용한다.

## 개발 규칙

아래 작업 전에는 반드시 이 문서를 먼저 확인한다.

1. 단계 표기 변경
2. Pine 필터 주기 변경
3. EV 자동 튜닝 주기 변경
4. 텔레그램/리포트의 단계 해석 변경
5. 엔진 순서 변경
6. 같은 날 여러 단계나 운영 설정을 함께 바꾸는 경우

## 변경 시 체크리스트

1. 현재 운영 순서와 문서상 목표 구조를 구분했는가
2. Pine 연동 필터와 서버 단독 필터를 분리했는가
3. 자동 조정 주기가 Pine 주간 수정과 충돌하지 않는가
4. 텔레그램/리포트/대시보드 단계 표기가 실제 운영 순서와 맞는가
5. 당일 변경된 Pine/필터/설정/알림이 서로 충돌하지 않는가
6. 이번 변경이 `승률 60% 이상 + 순수익 양수 + 기대값 양수 + 월간 순수익 1,500,000 KRW 이상` 목표와 정합적인가
