# SIGNAL_V6_1_1_0_REDESIGN_SPEC

- 제정: 2026-04-01
- 상태: DRAFT
- 성격: CLEAN-SHEET REDESIGN
- 설계 파일:
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_SIGNAL_REDESIGN.pine.txt`
- production candidate:
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_PRODUCTION_CANDIDATE.pine.txt`
- TradingView import final:
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt`
- 연계 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_TIER_DEFINITION.md`

## 1. 목적

`v6.1.1.0`은 `v6.0.3.x`를 보수적으로 손보는 버전이 아니다.
이 버전은 신호 생성 로직을 처음부터 다시 정의하는 clean-sheet redesign이다.

핵심 목표는 3개다.

1. `일관성`
- 상충하는 다중 AND veto를 제거하고, 하나의 방향 판단 체계를 만든다.

2. `지속성`
- 한 봉에서만 번쩍이는 신호보다, 일정 시간 살아남는 구조적 진입을 우선한다.

3. `가독성`
- 왜 신호가 나왔는지, 왜 막혔는지, 현재 시장 상태가 무엇인지 한 화면에서 읽을 수 있어야 한다.

4. `표면 호환성`
- TradingView에서 보이는 제목, 입력 그룹, 신호 표시, 상태 패널은 `v6.0.3.x`의 사용감에 최대한 가깝게 유지한다.
- 즉 내부 엔진은 새로 짜되, 사용자가 보는 표면은 급격히 낯설어지지 않게 한다.

## 2. 철학

1. `signal = market state + opportunity score + trigger + risk approval`
2. `hard block`은 극단 위험이나 무의미한 시장에서만 쓴다.
3. `품질`은 score가 담당한다.
4. `진입 시점`은 trigger가 담당한다.
5. `외부 계약`만 유지하고 내부 구조는 자유롭게 재구성한다.

## 3. 외부 출력 계약

내부는 완전 신규지만, 외부 시스템과의 최소 계약은 유지한다.

1. 방향 label은 `LONG / SHORT`
2. live grade는 `EARLY / CORE`
3. `DIAG_C`는 내부 고확신 상태
4. quantity profile 표기는 `FIXED`
5. 이벤트 타입은 `ENTRY`
6. alert는 `LONG_EARLY / LONG_CORE / SHORT_EARLY / SHORT_CORE` 네 종류만 허용한다.
7. `DIAG_C`, 시장 상태, 차단 사유, 내부 진단은 alert event로 승격하지 않는다.

## 4. 신규 구조

### 4.1 Market State Engine

시장 상태를 먼저 결정한다.

허용 상태:
- `BULL`
- `BEAR`
- `TRANSITION`
- `RANGE`
- `CHAOS`

판정 요소:
- EMA ribbon alignment
- EMA slope
- ATR ratio
- volume participation
- higher timeframe bias

### 4.2 Opportunity Engine

롱/숏 각각 `0..1` score를 계산한다.

| factor | weight | 설명 |
| --- | ---: | --- |
| structure_alignment | 0.24 | 상태와 방향 정렬 |
| directional_pressure | 0.22 | RSI/MACD/EMA 압력 |
| pullback_quality | 0.16 | 눌림/반등 위치 품질 |
| participation | 0.14 | 거래량과 확장성 |
| continuation_pressure | 0.14 | 직전 bar 이후 이어질 힘 |
| risk_efficiency | 0.10 | 과열/과확장 여부 |

### 4.3 Trigger Engine

trigger는 setup veto가 아니라 진입 시점 선택기다.
아래 셋 중 하나면 충분하다.

1. `BREAKOUT`
2. `RECLAIM`
3. `CONTINUATION`

즉, timing 조건을 전부 AND로 묶지 않는다.

### 4.4 Risk Engine

리스크가 비효율적이면 진입을 막는다.

핵심 요소:
- ATR 기반 stop/target
- minimum reward/risk
- dead market
- chaos market
- HTF conflict
- extreme extension

## 5. Hard Block

하드 차단은 아래만 남긴다.

1. `DATA_INVALID`
2. `DEAD_MARKET`
3. `CHAOS_MARKET`
4. `HTF_CONFLICT`
5. `EXTREME_EXTENSION`

이외의 요소는 score 또는 trigger 판단으로 보낸다.

## 6. Grade 정의

### EARLY
- `score >= 0.56`
- `RECLAIM/BREAKOUT` 또는 `LOSS/BREAKDOWN` trigger 존재
- `early risk pass`
- `TRANSITION`에서는 방향 bias와 anti-chop gate를 함께 본다.

### CORE
- `score >= 0.68`
- `CONTINUATION/BREAKOUT` 또는 `CONTINUATION/BREAKDOWN` trigger 존재
- 더 강한 구조 정렬과 participation
- `core risk pass`
- `HTF_CONFLICT`는 `EARLY`가 아니라 `CORE`를 주로 제한한다.

### DIAG_C
- `score >= 0.82`
- 내부 고확신 상태
- 외부 live grade로 직접 쓰지 않는다.

### 재발사 제어

- 같은 방향 재발사는 `same_dir_cooldown_bars = 8` 기준으로 억제한다.
- 다만 trigger type이 바뀌면 같은 방향이라도 더 일찍 재발사할 수 있다.

## 7. 설명 가능성 계약

항상 제공해야 하는 진단 값:

1. `market_state`
2. `htf_bias`
3. `long_opportunity_score`
4. `short_opportunity_score`
5. `trigger_long / trigger_short`
6. `risk_mode_long_early / risk_mode_short_early`
7. `risk_mode_long_core / risk_mode_short_core`
8. `block_reason_long / block_reason_short`
9. `live_grade_long / live_grade_short`

## 8. 설계상 중요한 차이

이 버전은 의도적으로 아래를 버린다.

1. legacy patch stack의 흔적
2. 동일 evidence의 반복 심사
3. 늦은 단계에서 연속으로 붙는 veto 체인
4. trend/score/posterior/wave의 중복 심사 구조

즉 `v6.1.1.0`은 기존 구조의 개량판이 아니라, 신호 정의 자체를 바꾼다.

## 9. 운영 해석

운영자는 아래만 보면 된다.

1. 시장 상태
2. long/short 어느 쪽 기회 점수가 높은지
3. 어떤 trigger가 열린 것인지
4. risk engine이 허용했는지
5. 최종 grade가 EARLY인지 CORE인지

## 10. Production Payload Contract

production candidate는 JSON payload를 만든다.
최소 필드:

1. `exchange`
2. `symbol`
3. `market`
4. `ticker`
5. `tf`
6. `strategy_id`
7. `engine_mode`
8. `action = ENTRY`
9. `event_intent = ENTRY`
10. `event = LONG | SHORT`
11. `side = BUY | SELL`
12. `direction`
13. `entry_grade`
14. `qty_profile`
15. `timeframe`
16. `market_state`
17. `htf_bias`
18. `trigger_type`
19. `risk_mode`
20. `qtyPct`
21. `price`
22. `opportunity_score`
23. `rr`
24. `stop_price`
25. `target_price`
26. `bar_close_time_utc_ms`
27. `bar_time`
28. `features`

핵심 규칙:

1. `action`은 항상 `ENTRY`
2. `event_intent`도 항상 `ENTRY`
3. 실제 방향 이벤트는 `event = LONG | SHORT` 한 번만 보낸다
4. `features.entry_grade`와 `features.qty_profile`은 consumer가 직접 해석하는 필드다

### Alert Policy

production candidate의 alert 정책은 고정이다.

1. `LONG CORE`
2. `LONG EARLY`
3. `SHORT CORE`
4. `SHORT EARLY`

그 외 이벤트는 모두 내부 상태로만 남긴다.

1. `DIAG_C`
2. `market_state` 변화
3. `risk_mode` 변화
4. `block_reason` 변화
5. 진단 테이블/시각화 상태

## 11. Production Candidate 의미

`PRODUCTION_CANDIDATE`는 legacy 비교용 shadow가 아니라,
실제로 TradingView에 붙여볼 수 있는 단일 파일 후보를 뜻한다.

즉:
- 내부 구조는 clean-sheet
- 출력 계약은 운영 시스템이 받아들일 수 있게 정렬
- 메시지는 `alert()` 기반 동적 JSON payload 사용
- 차트 표면은 `v6.0.3.x` 스타일의 제목 / 그룹 라벨 / 상태 패널 / LONG·SHORT 마커를 최대한 유지

## 12. 비목표

1. 기존 `v6.0.3.x`와 1:1 유사성 유지
2. 기존 veto taxonomy 보존
3. legacy 비교 리포트 의존
4. patch history 계승

## 13. 최종 판단

`v6.1.1.0`의 정의는 이것이다.

- `상태를 먼저 보고`
- `기회를 점수화하고`
- `트리거는 one-of-many로 열고`
- `리스크로 최종 승인하는`
- `완전 신규 LONG/SHORT 엔진`

즉 이 버전은 `AND의 폭정`을 줄이는 수준이 아니라,
신호 시스템의 책임 분할 자체를 새로 정의한다.
