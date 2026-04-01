# SERVER_VS_PINE_SHADOW_COMPARISON_RUNBOOK

- 기준일: 2026-04-01
- 상태: DRAFT
- 목적:
  - `서버 정본 + Pine 그림자` 병행 운영 기간 동안 무엇을 비교하고, 어떤 수치에서 전환 완료를 선언할지 고정한다.
- 상위 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_MIGRATION_CHECKLIST.md`

## 1. 원칙

병행 비교 기간에도 정본은 이미 서버다.

1. `SERVER`는 주문/실행/UI/Telegram의 기준이다.
2. `PINE_SHADOW`는 비교와 진단의 기준이다.
3. `PINE_SHADOW`가 더 많이 보인다고 해서 운영 정본으로 되돌리지 않는다.
4. 비교 목적은 `누가 정본인가`를 다시 정하는 것이 아니라 `왜 차이가 나는가`를 줄이는 것이다.

## 2. 비교 기간

권장 최소 기간:

1. `14일`
2. 또는 `15m 기준 주요 활성 마켓에서 shadow_observed_n >= 50`
3. 또는 `cutover blocker가 2주 연속 0`

최소 기간 중 하나만으로 끝내지 않는다.

완료 판정은 아래를 함께 본다.

1. 기간
2. 표본 수
3. drift family
4. execution 품질

## 3. 매일 봐야 하는 지표

### 3.1 authority

파일:

- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_authority_latest.json`

핵심:

1. `authoritative_server_24h_n`
2. `pine_shadow_24h_n`
3. `parity_mismatch_n`
4. `parity_mismatch_rate`
5. `source_parity_mismatch_n`

### 3.2 quality

파일:

- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_quality_latest.json`

핵심:

1. `authoritative_entry_signal_24h_n`
2. `order_intent_24h_n`
3. `fill_24h_n`
4. `intent_conversion_rate`
5. `fill_conversion_rate`
6. `top_drop_reason_family`

### 3.3 cutover readiness

파일:

- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_cutover_readiness_latest.json`

핵심:

1. `blockers`
2. `dominant_mismatch_family`
3. `recommended_action`
4. `blocker_actions`

### 3.4 loop monitor

파일:

- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_monitor_latest.json`

핵심:

1. `server_signal_cutover_status`
2. `server_signal_runtime_status`
3. `server_signal_quality_status`
4. `critical_blockers`

## 4. mismatch family별 해석

### 4.1 `EV_POLICY`

의미:

1. 서버 정본 신호는 생성됐지만 EV gate에서 Pine 그림자와 다른 판단을 내린다.
2. 현재 가장 중요한 cutover blocker다.

기본 조치:

1. `LOWER_EV_TP1_MIN_REVIEW`
2. `best_self_evolution_ev_gate_rescue_latest.json` 확인
3. `SOLUSDT`, `BNBUSDT` 같은 상위 시장부터 확인

### 4.2 `COOLDOWN_POLICY`

의미:

1. 반대 방향 cooldown / wait timing이 Pine와 다르게 작동한다.

기본 조치:

1. `RELAX_OPPOSITE_COOLDOWN_REVIEW`
2. `WAIT` stage candidate가 실제로 적용 가능한지 확인

### 4.3 `STRATEGY_GATE`

의미:

1. 전략 ID 게이트 차이
2. 다만 `strategy_gate_historical_only = true`면 현재 운영 blocker로 보지 않는다.

기본 조치:

1. 신규 mismatch면 정렬 필요
2. historical-only면 관측만 유지

## 5. 병행 기간 운영 규칙

1. `SERVER` 신호만 Telegram/실행/UI에 쓴다.
2. `PINE_SHADOW`는 저장/비교만 한다.
3. Pine shadow mismatch가 있어도 source parity mismatch가 아니면 바로 rollback하지 않는다.
4. rollback은 아래 경우만 고려한다.
5. 서버 신호 체계가 바뀌면 Pine shadow 파일과 TradingView import final도 같은 변경 묶음으로 갱신한다.

필수 동반 파일:

1. `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_SIGNAL_REDESIGN.pine.txt`
2. `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_PRODUCTION_CANDIDATE.pine.txt`
3. `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt`

rollback 후보:

1. `source_parity_mismatch_n > 0`
2. `authoritative_entry_signal_24h_n = 0`이 2개 이상 연속 cycle
3. `intent_conversion_rate`가 급락하고 `fill_24h_n = 0`
4. `SERVER_SIGNAL_NOT_REACHING_EXECUTION`

## 6. 주간 판단 기준

주 1회 아래를 요약한다.

1. `server vs pine mismatch rate`
2. `dominant mismatch family`
3. `entry -> intent -> fill` 전환율
4. `top mismatch market`
5. `historical-only strategy gate` 여부

판정:

1. `IMPROVING`
  - mismatch family가 줄고 있음
  - entry/intent/fill 전환율이 유지 또는 개선
2. `STABLE_BUT_NOT_READY`
  - mismatch가 줄지 않음
  - execution 품질은 유지
3. `REGRESSION`
  - mismatch 증가
  - execution 품질 악화

## 7. 비교 종료 조건

아래를 동시에 만족해야 `Pine 비교 운영 종료`로 본다.

1. `source_parity_mismatch_n = 0`
2. `STRATEGY_GATE`는 `historical_only = true` 또는 `0`
3. `EV_POLICY`, `COOLDOWN_POLICY` drift가 blocker에서 빠짐
4. `promotion_ready = true`
5. `canonical_engine_source_mode = SERVER_PRIMARY`
6. `authoritative_entry_signal -> intent -> fill` 경로가 2주 이상 안정

## 8. 완료 선언 문장

완료 선언은 아래 조건을 만족할 때만 쓴다.

1. `서버가 15분 봉 기준 정본 신호를 생성`
2. `Pine는 비교/시각화 shadow로만 사용`
3. `SERVER_PRIMARY`가 실제 운영 source mode`
4. `cutover blocker 0`

## 9. 현재 판정

2026-04-01 기준:

1. 정본: `SERVER`
2. 비교: `PINE_SHADOW`
3. 현재 핵심 blocker:
  - `EV_POLICY_DRIFT_ACTIVE`
  - `COOLDOWN_POLICY_DRIFT_ACTIVE`
4. `STRATEGY_GATE`는 현재 `historical_only`

즉 지금은:

- 구조 전환은 거의 끝났고
- 비교 운영을 통해 마지막 품질 드리프트를 줄이는 단계다.
