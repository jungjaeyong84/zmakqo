# SIGNAL_V6_1_1_0_CANARY_APPLY_CHECKLIST

- 기준일: 2026-04-01
- 대상 Pine:
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt`
- 참고 계약:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_V6_1_1_0_TV_IMPORT_AND_CONSUMER_CONTRACT.md`
- 목표:
  - `v6.1.1.0`을 TradingView에 실제로 적용하고,
  - 첫 canary webhook 1건이 서버 `signals` 저장까지 이어지는지 검증한다.

## 1. 사전 조건

1. TradingView 차트가 실제 운영 대상 마켓/타임프레임으로 열려 있어야 한다.
2. 서버 webhook URL과 token이 운영값으로 준비돼 있어야 한다.
3. 서버가 최신 consumer를 사용 중이어야 한다.
- 경로: `/Users/jeongjaeyong/Projects/donbeolja/src/routes/webhook.routes.js`
4. OpenClaw ops substrate가 정상이어야 한다.
- 최소 확인:
  - `automation_watchdog_latest.json -> verdict = PASS`
  - `best_self_evolution_loop_monitor_latest.json -> cycle_consistent = true`

## 2. TradingView Import

1. Pine Editor를 연다.
2. `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt` 전체를 붙여넣는다.
3. 스크립트명이 `돈벌자 :) Ω Full v6.1.1.0`인지 확인한다.
4. `Save` 후 `Add to chart` 전에 compile error가 없는지 확인한다.
5. 차트 적용 후 입력값을 확인한다.
- `Webhook provider`
- `Webhook qtyPct`
- 표시 옵션

## 3. Compile Acceptance

아래를 모두 만족해야 다음 단계로 간다.

1. compile error가 없어야 한다.
2. `alert()` 관련 오류가 없어야 한다.
3. `plotshape text must be const`류 오류가 없어야 한다.
4. 차트에 기존 표면 감각이 유지되어야 한다.
- 상태 패널 존재
- EMA ribbon 표시
- 마커 표기:
  - `RE`
  - `RC`
  - `SE`
  - `SC`

## 4. Alert Configuration

1. TradingView Alert 생성 화면을 연다.
2. 조건은 `Any alert() function call`을 선택한다.
3. frequency는 `Once Per Bar Close`로 고정한다.
4. webhook URL을 입력한다.
5. alert message는 비워둔다.
- 운영 payload는 Pine `alert()`가 동적으로 생성한다.

## 5. Alert Contract Acceptance

외부로 나가는 alert는 아래 4개만 허용한다.

1. `LONG EARLY`
2. `LONG CORE`
3. `SHORT EARLY`
4. `SHORT CORE`

아래는 외부 alert로 나오면 안 된다.

1. `DIAG_C`
2. 시장 상태 변화
3. 리스크 모드 변화
4. 내부 block reason

## 6. 첫 Canary Webhook 검증

첫 신호가 발생하면 아래를 순서대로 확인한다.

1. TradingView alert log에 신호가 실제 발생했는지 확인한다.
2. 서버 `/webhook/signal` 응답이 `2xx`인지 확인한다.
3. 최근 signals cache에 새 row가 생겼는지 확인한다.
- 경로:
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/signals.json`
4. 필요하면 최근 intents/drops도 같이 본다.
- 경로:
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/signals_dropped.json`
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/order_intents_paper.json`

## 7. Server Consumer Acceptance

첫 canary row는 최소한 아래를 만족해야 한다.

1. `strategy_id = donbeolja_v6.1.1.0`
2. `event = LONG | SHORT`
3. `side = BUY | SELL`
4. `action = ENTRY`
5. `event_intent = ENTRY`
6. `qtyPct` 존재
7. `bar_close_time_utc_ms` 존재
8. `features.entry_grade = EARLY | CORE`
9. `features.qty_profile = FIXED`
10. `features.strategy_id = donbeolja_v6.1.1.0`

## 8. Canary 결과 판정

### PASS

아래를 모두 만족하면 PASS다.

1. TradingView compile 성공
2. Alert 생성 성공
3. 첫 webhook 1건 `2xx`
4. `signals` 또는 `signals_dropped`에 새 row 저장
5. payload key가 consumer 계약과 일치

### FAIL

아래 중 하나면 FAIL이다.

1. compile 실패
2. alert가 4종 외 이벤트로 발생
3. webhook `4xx/5xx`
4. 저장 row 없음
5. `event/side/entry_grade/qtyPct/bar_close_time_utc_ms` 누락

## 9. 첫 Fail 시 우선 확인 순서

1. Pine compile error 메시지
2. TradingView alert frequency가 `Once Per Bar Close`인지
3. webhook URL/token 오타
4. payload key 누락 여부
5. 서버 consumer 로그에서 `strategy_id/event/side` 파싱 여부

## 10. 운영 후속 체크

첫 canary가 붙은 뒤에는 아래를 추가로 본다.

1. `signals` 저장 여부
2. `signals_dropped` 저장 여부
3. `order_intents_paper`까지 이어지는지
4. `best_self_evolution_dataset_latest.json`에 새 row가 반영되는지
5. `best_self_evolution_objective_recovery_effect_latest.json`와 `objective_supervisor_latest.json`가 새 신호를 운영 해석에 반영하는지

## 11. 현재 운영 기준 주의점

1. self-evolution authority pending은 이미 닫혔다.
- `deployment_plan_latest.json -> authority_state = APPROVED`
- `external_authority_pending = false`
2. 현재 핵심 blocker는 authority가 아니라 objective와 Phase D다.
- `best_self_evolution_loop_monitor_latest.json -> critical_blockers = ["RETROSPECTIVE_OBJECTIVE_FAIL"]`
- `best_self_evolution_server_primary_acceptance_watch_latest.json -> phase_d_reason = SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`
3. `best_self_evolution_openclaw_autonomy_contract_latest.json`은 현재 authority를 아직 `PENDING`으로 요약하고 있다.
- 이 값은 최신 authority closure를 아직 반영하지 못한 stale summary로 봐야 한다.

## 12. 결론

`v6.1.1.0`의 남은 일은 설계가 아니라 실적용 검증이다.
이 체크리스트는 아래 한 줄을 확인하기 위한 것이다.

- `TradingView alert 1건 -> webhook 2xx -> signals 저장 1건`
