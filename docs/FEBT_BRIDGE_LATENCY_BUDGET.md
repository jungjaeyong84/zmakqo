# FEBT_BRIDGE_LATENCY_BUDGET

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `BEST/FEBT` `Phase 0`에서 사용할 bridge latency budget과 현재 계측 공백을 고정
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_OPERATIONAL_GUARDS.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`

## 목적

`FEBT`는 timing 이론이므로, 차트에서 `FIRE`였더라도 실제 체결 시점에 이미 `LATE`가 되면 의미가 없다.

이 문서는 아래를 고정한다.

1. 측정 구간
2. 허용 budget
3. 현재 계측 가능한 timestamp
4. 현재 계측 공백

## 측정 구간

필수 구간:

1. `alert_to_webhook_ms`
2. `webhook_to_intent_ms`
3. `intent_to_fill_ms`
4. `alert_to_fill_ms`

보조 운영 지표:

1. `duplicate_rate`
2. `reject_rate`
3. `stale_rate`

## 현재 저장 구조

### 이미 있는 timestamp

1. `signals.bar_close_time_utc_ms`
2. `signals_dropped.bar_close_time_utc_ms`
3. `webhook_ledger.created_at`
4. `order_intents_paper.created_at`
5. `fills_paper.created_at`
6. `fills_paper.exec_bar_close_time_utc_ms`
7. `trades_paper.created_at`

### 현재 공백

1. Pine explicit `alert_emit_time_utc_ms` 없음
2. `request_id`가 `order_intents_paper`까지 전파되지 않음
3. webhook ingress와 intent/fill을 1:1로 잇는 direct bridge key가 약함

## Phase 0 측정 원칙

현 시점 baseline은 아래처럼 근사 측정한다.

1. `alert_to_webhook_ms ≈ webhook_ledger.created_at - bar_close_time_utc_ms`
2. `webhook_to_intent_ms ≈ order_intents_paper.created_at - webhook_ledger.created_at`
3. `intent_to_fill_ms ≈ fills_paper.created_at - order_intents_paper.created_at`
4. `alert_to_fill_ms ≈ fills_paper.created_at - bar_close_time_utc_ms`

주의:

1. 이는 `alert emit timestamp` 부재 상태의 근사 baseline이다.
2. `Phase 2` 이전에 정확도 한계가 있으므로 absolute truth가 아니라 `budget breach 탐지`용으로 본다.

## Initial Budget

### 15m

1. `bar_ms = 900000`
2. `alert_to_fill_ms_p95 <= 180000`
3. `alert_to_fill_ms_p50 <= 60000`
4. `duplicate_rate <= 0.5%`
5. `reject_rate <= 0.5%`
6. `stale_rate <= 1.0%`

segment seed:

1. `alert_to_webhook_ms_p95 <= 30000`
2. `webhook_to_intent_ms_p95 <= 45000`
3. `intent_to_fill_ms_p95 <= 105000`

### 1h

1. `bar_ms = 3600000`
2. `alert_to_fill_ms_p95 <= 720000`
3. `alert_to_fill_ms_p50 <= 240000`
4. `duplicate_rate <= 0.5%`
5. `reject_rate <= 0.5%`
6. `stale_rate <= 1.0%`

segment seed:

1. `alert_to_webhook_ms_p95 <= 120000`
2. `webhook_to_intent_ms_p95 <= 180000`
3. `intent_to_fill_ms_p95 <= 420000`

## 상태 판정

### GREEN

1. `alert_to_fill_ms_p95 <= budget`
2. `duplicate/reject/stale` 모두 budget 이내

### YELLOW

1. `alert_to_fill_ms_p95` 1회 초과
2. 또는 `duplicate/reject/stale` 중 하나가 budget 근접

행동:

1. `SHADOW` 유지
2. `SOFT/HARD` 승격 보류

### RED

1. `alert_to_fill_ms_p95 > budget` 지속
2. 또는 `duplicate_rate > 0.5%`
3. 또는 `reject_rate > 0.5%`
4. 또는 `stale_rate > 1.0%`

행동:

1. `SOFT -> SHADOW`
2. `HARD -> SOFT` 또는 `legacy WAIT fallback`

## Phase 0 실제 착수 상태

현재 상태:

1. budget 정의: 완료
2. 현재 측정 artifact: 미생성
3. 계측 공백 문서화: 완료

즉시 후속 작업:

1. `request_id` -> intent/fill trace linkage 설계
2. `alert_emit_time_utc_ms` Pine payload field 도입 검토
3. `bridge latency report` markdown/json 생성

## 한 줄 결론

현재 `BEST/FEBT`는 latency budget 숫자는 생겼지만 baseline artifact는 아직 없다. `Phase 0`의 첫 실측 목표는 `15m p95 180초`, `1h p95 720초`가 아니라, 이 budget을 실제 trace로 검증 가능한 형태로 만드는 것이다.
