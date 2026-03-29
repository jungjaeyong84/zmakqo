# BEST_OPERATIONAL_GUARDS

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `BEST/FEBT` live 운영 전 필수 실행 가드와 중단 규칙 정의
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_INTERFACE_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SIGNAL_COUNT_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PINE_INTRODUCTION_PLAN.md`

## 목적

이 문서는 `BEST/FEBT`가 개념상 좋아 보여도 live 운영 승인을 받지 못하게 하는 대표 리스크를 막기 위한 최소 가드다.

핵심은 아래다.

1. false signal 누적 시 자동 중단
2. account risk 한도 고정
3. bridge failure 대응
4. duplicate/reject/partial fill/runbook 명시

## 권한 불변 조건

1. Pine는 active filters를 우회하지 않는다.
2. `FEBT`는 `timing verdict`만 제공한다.
3. 최종 execution action은 서버가 결정한다.
4. 계좌 리스크 한도는 서버가 책임진다.

## 초기 live risk cap

초기 Binance Futures 기준:

1. `max_risk_per_trade = 1.0% of equity`
2. `max_daily_drawdown = 5.0% of equity`
3. `max_symbol_concentration = 25% of gross exposure`
4. `max_concurrent_positions = 4`
5. `max_add_per_position = 1`

원칙:

1. 위 한도 미확정이면 `SOFT/HARD` 금지

## auto stop 조건

아래 중 하나면 `BEST/FEBT` live 승격 경로를 자동 중단한다.

1. `duplicate_rate > 0.5%`
2. `reject_rate > 0.5%`
3. `stale_rate > 1.0%`
4. `alert_to_fill_ms_p95 > bar_ms * 0.20`
5. `daily_drawdown >= 5.0%`
6. `3 losing signals in a row` and `phase = FIRE` concentration

auto-stop 행동:

1. `SHADOW`에서는 경보만
2. `SOFT`에서는 `FEBT -> SHADOW` 복귀, 전체 신규 진입은 유지
3. `HARD`에서는 `FEBT -> SOFT` 또는 `legacy 5차 WAIT fallback`, 필요 시 신규 진입 일시 중단
4. 기존 포지션 강제 청산은 자동으로 하지 않는다.

## duplicate guard

### dedupe key

초기 dedupe key:

1. `signal_key`
2. `signal_id`
3. `strategy_id`
4. `symbol`
5. `tf`
6. `bar_close_time_utc_ms`

원칙:

1. 같은 dedupe key의 repeated alert는 새 execution intent를 만들지 않는다.
2. `FEBT phase` 변경만으로 새 live order를 만들면 안 된다.

## reject handling

주문 거절 시:

1. `order_reject_reason` 기록
2. 해당 signal을 `EXECUTION_REJECTED`로 마킹
3. 즉시 재발주 금지
4. 재발주가 필요하면 `manual override` 경로만 허용

## partial fill handling

부분 체결 시:

1. `fill_ratio` 기록
2. `position state`를 partial 기준으로 갱신
3. `FEBT` 원래 phase를 수정하지 않는다
4. 후속 add/reduce 판단은 partial-aware risk로 재계산

## webhook / bridge failure

### Pine 신호 발생 -> 서버 미수신

1. `payload_missing` 기록
2. `stale alert`로 분류
3. 같은 bar에 후속 신호가 와도 bypass 금지

### webhook 수신 -> intent 생성 실패

1. `intent_create_failed` 기록
2. live order 생성 안 함
3. hourly guard / supervisor 경보

### intent 생성 -> fill 실패

1. `execution_timeout` 또는 `reject` 기록
2. retry는 자동이 아니라 정책 기반

## manual override

manual override는 아래 때만 허용한다.

1. 주문 거절
2. exchange outage
3. duplicate suppression 오작동
4. stale detection 오작동

manual override 조건:

1. operator id 기록
2. reason code 기록
3. original signal linkage 유지
4. 사후 감사 리포트 포함

## rollback 조건

아래 중 하나면 `SOFT/HARD`에서 즉시 rollback 후보다.

1. `count_ratio_global < 1.00`
2. `win_rate < 0.58` on approved markets aggregated `56d`
3. `expectancy` non-inferiority 위반
4. latency floor 위반 지속
5. duplicate/reject/stale 경보 지속

## 운영 로그 필수 필드

1. `best_version`
2. `febt_mode`
3. `febt_phase`
4. `febt_timing_action`
5. `market_state_summary_state`
6. `market_state_summary_action`
7. `signal_key`
8. `signal_id`
9. `trade_id`
10. `order_reject_reason`
11. `manual_override_reason`

## 승인 체크리스트

### SHADOW

1. payload 저장 가능
2. phase 집계 가능
3. 실패/누락률 집계 가능

### SOFT

1. risk cap 확정
2. duplicate/reject/partial fill runbook 확정
3. auto stop 조건 동작 확인
4. rollback 기준 확정

### HARD

1. testnet 또는 동등 모의 execution 검증 완료
2. approved markets 기준 `60%+`와 `count floor` 충족
3. supervisor/governance/hourly guard 모두 canary 통과

## 한 줄 결론

`BEST/FEBT`는 좋은 철학만으로 live 승격될 수 없고, duplicate/reject/partial fill/latency/drawdown까지 닫힌 운영 가드가 있어야만 승인 가능하다.
