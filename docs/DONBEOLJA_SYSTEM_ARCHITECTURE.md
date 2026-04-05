# DONBEOLJA System Architecture

- 업데이트: 2026-04-05 KST
- 검수 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md`

## 개요
돈벌자는 자동 코인 선물 거래 시스템이다. 현재 아키텍처의 핵심 방향은 `서버 정본 신호 생성`이다. TradingView Pine는 보조 실행 경로가 아니라 시각화 및 비교 검증용 shadow 역할로 유지한다.

핵심 구조는 아래와 같다.
- 시장 데이터 수집
- 서버 신호 생성
- 드롭/정책 판단
- 주문 의도 생성
- 체결/거래 기록
- 수익 집계
- 자연 진화 및 운영 판단
- Pine 그림자 비교

## 주요 구성요소

### 1. Binance / 시장 데이터
역할:
- 거래 대상 마켓의 OHLCV 봉 데이터를 수집한다.
- 실행 TF를 기준으로 서버 신호 계산의 입력을 만든다.

의미:
- 서버가 정본 신호를 만들려면 차트와 독립적으로 봉 데이터를 읽을 수 있어야 한다.

### 2. 서버 신호 생성 엔진
역할:
- 봉 데이터를 읽고 LONG/SHORT 진입 신호를 계산한다.
- 신호 등급, 발생 사유, 차단 사유를 함께 남긴다.
- 저장 시 `source=SERVER`, `authoritative=true`로 기록한다.

의미:
- 이 엔진이 최종적으로 Pine를 대체하는 정본 판단 계층이다.

### 3. Pine Shadow
역할:
- TradingView 차트에서 전략 구조와 신호 위치를 시각화한다.
- 서버 정본과 비교 가능한 그림자 신호를 남긴다.
- 저장 시 `source=PINE_SHADOW`, `authoritative=false`로 기록한다.

의미:
- Pine는 정본이 아니라 비교 대상이다.
- 자동 진화가 규칙을 바꾸면 Pine도 항상 같이 갱신되어야 한다.

### 4. Webhook
역할:
- 외부에서 들어오는 Pine shadow 신호를 저장한다.
- 현재 구조에서는 실행 정본으로 사용하지 않는다.

의미:
- Webhook는 비교 운영 경로다.
- 운영 실행 경로와 분리되어야 drift를 관측할 수 있다.

### 5. Order Intents
역할:
- 서버 정본 신호를 주문 가능한 의도로 변환한다.
- 리스크, EV, cooldown, strategy gate 등 하류 정책을 통과해야 한다.

의미:
- 신호 생성과 실제 실행 사이의 정책 판단 층이다.

### 6. Fills / Trades
역할:
- 체결 결과를 저장한다.
- 포지션 변화와 거래 종료 결과를 기록한다.

의미:
- 실제 성과와 수익 집계의 근거가 된다.

### 6.1 Live Execution Policy (P2 Canary)
역할:
- `execution quality + allocator + quarantine + policy parameter plan`을 결합해 실주문 진입 수량을 조정한다.
- `WATCH_ONLY` 시장은 진입 차단할 수 있다.
- `portfolio cluster risk`를 계산해 same-side correlated cluster를 축소하거나 차단한다.

핵심 경로:
- `src/utils/liveExecutionPolicy.js`
- `ops/daily/best_self_evolution_policy_parameter_plan_latest.json`

현재 운용:
- `LIVE_EXEC_POLICY_POLICY_PLAN_ENABLED=1`
- `LIVE_EXEC_POLICY_POLICY_PLAN_APPLY=1` (canary)
- `LIVE_EXEC_POLICY_POLICY_PLAN_WATCH_ONLY_BLOCK=1`
- `LIVE_EXEC_POLICY_PORTFOLIO_CLUSTER_ENABLED=1`
- 기본 군집 규칙:
  - `3번째 same-side cluster -> REDUCE_SIZE`
  - `4번째 correlated cluster -> BLOCK`
  - `same-side / correlated same-side total exposure cap` 초과 시 추가 축소 또는 차단

### 6.2 EV Probability Calibration
역할:
- `DROP_EV_GATE_TP1_PROB`가 쓰는 `tp1_prob lower bound`를 empirical outcome으로 보정한다.
- 과신된 probability/lower bound를 실측 ceiling으로 clamp한다.

핵심 경로:
- `src/services/evTp1Probability.js`
- `src/utils/evTp1ProbabilityCalibration.js`
- `ops/daily/best_self_evolution_ev_probability_calibration_latest.json`

의미:
- EV gate 문제를 단순 threshold 완화로만 다루지 않고, 확률 모델 calibration부터 바로잡는다.

### 6.3 Exit Microstructure
역할:
- TP1 이전 생존력을 높이기 위해 `FAST_TP0`, `지연 trail`, `추격 진입 차단`, `pre-TP1 time stop`을 단계적으로 적용한다.

현재 원칙:
- `FAST_TP0`는 `절대 % floor + ATR 보정`으로 계산한다.
- `TP1` 직후에는 trail을 즉시 켜지 않고 `1봉 또는 추가 MFE` 조건을 기록한다.
- 같은 방향 포지션 군집은 count뿐 아니라 total exposure cap으로도 제어한다.
- recent FILLED entry 직후 외부 futures snapshot이 `0`으로 튀더라도 `external flat sync grace` 동안은 내부 포지션을 즉시 `FLAT`으로 덮지 않는다.

### 7. 수익 집계
역할:
- 실현 손익과 미실현 손익을 집계한다.
- 기간별, 마켓별, 누적 기준으로 성과를 보여준다.

의미:
- 사이트에서 사용자가 가장 직접적으로 체감하는 결과 계층이다.

### 8. 자연 진화 루프
역할:
- 전략 후보를 생성한다.
- replay, canary, validation을 통해 후보를 검증한다.
- 성과와 정합성 기준으로 다음 조치를 선택한다.

### 9. Objective Supervisor
역할:
- 목표 점수 회복 관점에서 현재 시스템의 병목을 찾는다.
- action plan을 정리한다.

### 10. Stage Autopilot
역할:
- stage별 후보를 자동 적용 또는 보류한다.
- source mode, EV, cooldown 등 주요 정책 승격/보류를 판단한다.

### 11. Autonomy Contract
역할:
- 현재 자동 운영 상태를 요약한다.
- 권한, 전환 진행률, 차단 이유를 최신 상태로 표현한다.

## 데이터 흐름

### 1. 봉 데이터 수집
- 서버가 Binance 기준 봉 데이터를 읽는다.
- 실행 TF는 현재 서버 런타임 기준을 따른다.

### 2. 신호 생성
- 서버 엔진이 봉 데이터를 기반으로 신호를 만든다.
- 이 신호는 `authoritative=true`로 저장된다.
- 동시에 Pine shadow는 별도 저장되어 비교 대상으로 남는다.

### 3. 드롭 판단
- 신호는 하류 정책을 통과해야 한다.
- 주요 차단 가족은 아래와 같다.
  - EV 정책
  - cooldown 정책
  - strategy gate

### 4. 주문 의도 생성
- 통과한 신호는 order intent로 변환된다.
- 이 단계부터 실제 실행 가능성이 생긴다.

### 5. 체결
- 의도는 체결로 이어질 수 있다.
- 체결 정보는 fills와 trades에 기록된다.

### 6. 수익 기록
- fills/trades가 누적되면 수익 집계 계층이 이를 반영한다.
- 홈과 수익 페이지는 이 결과를 사용자가 읽을 수 있게 보여준다.

### 7. 전략 평가
- 자연 진화 루프는 아래를 함께 본다.
  - 목표 점수
  - 실행 품질
  - 정본/그림자 drift
  - canary 결과
  - rollout readiness

## Authoritative / Shadow 개념

### Authoritative
의미:
- 실행과 운영 판단의 기준이 되는 데이터
- UI, Telegram, self-evolution에서 정본으로 읽는다

현재 기준:
- 서버 신호
- 서버 실행 품질
- 서버 런타임 상태

### Shadow
의미:
- 비교와 시각 검증을 위한 보조 데이터
- 실행 기준은 아니지만 품질 검증에는 중요하다

현재 기준:
- Pine shadow 신호
- TradingView 차트 시각화
- 서버 vs Pine parity 비교

## 현재 전환 상태
현재 시스템은 `Pine 중심 -> Server 중심` 전환을 완료했고, 이후 acceptance/품질 안정화 단계다.

이미 된 것:
- 서버 내부 신호는 정본으로 기록된다.
- Pine webhook은 shadow-only 경로로 강등되었다.
- UI 기본값은 정본 우선이다.
- Telegram은 정본 서버 신호 기준으로 이동 중이다.
- self-evolution과 autonomy contract는 server signal authority/quality/runtime/cutover를 읽는다.

아직 남은 것:
- 일부 drift family(`EV_POLICY`, `COOLDOWN_POLICY`)를 더 줄여야 한다.
- `SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`를 닫아 승격 acceptance를 충족해야 한다.
- objective recovery와 실행 품질을 동시 회복해야 한다.

## 왜 비교 운영이 계속 필요한가
서버가 정본이더라도 Pine shadow 비교는 당분간 필요하다.

이유:
1. 차트 체감과 서버 결과가 완전히 같은지 확인해야 한다.
2. drift가 `source parity`가 아니라 `downstream policy mismatch`일 수 있다.
3. 서버가 더 좋은 결과를 내는지 실제 운영 샘플로 검증해야 한다.
4. 자동 진화가 신호 체계를 바꾸면 Pine도 같이 갱신되고 비교되어야 한다.

즉 비교 운영의 원칙은 아래다.
- 운영 판단은 서버 정본 기준
- 검증과 시각 확인은 Pine shadow 기준

## 최종 목표 구조
최종 구조는 아래와 같다.

### 서버
- Binance 봉 읽기
- 신호 생성
- 주문 의도 생성
- 실행
- 기록
- 수익 집계
- Telegram 알림

### Pine
- 차트 시각화
- 신호 위치 표시
- 서버 정본과의 비교 검증

### 사이트
- 홈: 돈과 현재 상태
- 수익: 성과 분석
- 거래기록: 신호/드롭/체결
- 전략상태: 자연 진화와 서버 전환 상태
- 설정: 운영 기준 변경

## 아키텍처 원칙 요약
1. 서버가 정본이다.
2. Pine는 비교용 shadow다.
3. UI는 사용자가 읽을 수 있는 형태로 정본과 shadow를 구분해야 한다.
4. 자연 진화는 신호 품질과 전환 진행률을 함께 본다.
5. 신호 체계 변경은 서버 설정만이 아니라 Pine shadow regeneration까지 포함해야 완료다.
