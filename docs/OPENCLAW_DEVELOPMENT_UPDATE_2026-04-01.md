# OPENCLAW_DEVELOPMENT_UPDATE_2026-04-01

- 기준일: 2026-04-01
- 목적:
  - 최근 서버 신호 전환, OpenClaw 자율 운영, UI/메시지 정리, 학습 artifact 확장을 한 문서에서 요약한다.

## 1. 운영 구조 변화

1. `Pine`는 더 이상 운영 정본이 아니다.
2. `서버 canonical engine`이 신호 정본이다.
3. `OpenClaw`가 hourly/daily cycle로 전체 자동화를 소유한다.
4. 개별 cron/자동화는 제거하고 `OpenClaw cycle`로 통합했다.

## 2. 현재 서버 신호 상태

latest 기준:

1. `runtime_status = READY`
2. `canonical_engine_source_mode = SERVER_PRIMARY`
3. `scheduler_status = ENABLED`
4. `watchdog_verdict = PASS`
5. `pine_shadow_transition_status = COMPLETE`
6. `pine_shadow_transition_progress_pct = 100`

현재 남은 blocker:

1. `SERVER_SIGNAL_PARITY_DRIFT`
2. `SERVER_SIGNAL_CUTOVER_NOT_READY`
3. `EV_POLICY_DRIFT_ACTIVE`
4. `COOLDOWN_POLICY_DRIFT_ACTIVE`
5. `SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`

## 3. OpenClaw 판단/학습 확장

추가된 핵심 artifact:

1. `drop validation`
2. `provisional realized outcome`
3. `market objective score`
4. `server vs pine performance delta`
5. `execution quality`
6. `reverse policy`
7. `server-primary learning epoch`
8. `change-result attribution`
9. `exploration budget`
10. `exploration proposal`
11. `exploration apply candidate`
12. `server market capital allocator`
13. `server market quarantine`

의미:

1. OpenClaw는 이제 `무엇을 바꿨는지`뿐 아니라 `그 결과가 어땠는지`도 본다.
2. 드롭된 신호를 반사실로 검증한다.
3. 시장별로 `production / exploration / watch`를 나눈다.
4. `Pine`는 비교용 shadow evidence일 뿐, 수정 우선순위가 아니다.

## 4. 메시지 체계 변화

현재 기본 유지 메시지:

1. 거래 관련 메시지
2. `[시간별 자산 현황]`
3. `[일간·주간·월간 회고]`
4. `[목표 점검]`
5. `[자동 변경 반영]`
6. `[자동 롤백 점검]`

기본 OFF:

1. 신호 lifecycle 메시지
2. 세부 튜닝 메시지
3. 주간 엔진 상세 메시지
4. health / exit integrity 정보성 메시지

## 5. UI 변화

1. 홈, 거래기록, 전략상태, 수익, 입출금, 설정이 trader shell로 정리되었다.
2. legacy 백업 경로는 `?legacy=1`로 유지한다.
3. 홈에서는 불필요한 소개 영역을 제거하고 상태/수익/신호 중심으로 재배치했다.
4. 전략상태는 `서버 신호 정본 상태`, `실시간 전환 상태`, `회복 판단` 중심으로 정리했다.

## 6. 데이터 품질 보정

1. `cycle mismatch`를 줄이기 위해 파생 artifact cycle anchor를 정리했다.
2. `fill_24h_n > order_intent_24h_n`는 바로 오류로 해석하지 않도록 quality note를 추가했다.
3. `server_market_quarantine` stale 문제를 loop step에 포함시켜 수정했다.

## 7. 현재 가장 부족한 것

1. 서버 정본 신호 표본이 아직 적다.
2. 특히 `13시 이후 BTC 외 무신호`처럼 시장 전체에서 생성 밀도가 충분치 않다.
3. 대부분의 mismatch는 생성기보다 `후단 EV/COOLDOWN`에서 발생한다.

## 8. 다음 우선순위

1. 서버 신호 표본 더 쌓기
2. `EV/COOLDOWN` drift 더 줄이기
3. 시장별 무신호 원인 추적
4. `change-result attribution`으로 변경 효과를 더 빠르게 다시 반영

## 9. 한 줄 결론

돈벌자는 이제 `Pine 중심 운영`이 아니라 `서버 신호 + OpenClaw control plane` 구조로 넘어왔다.  
남은 문제는 구조 부재가 아니라 `서버 정본 표본 부족`과 `후단 drift`다.
