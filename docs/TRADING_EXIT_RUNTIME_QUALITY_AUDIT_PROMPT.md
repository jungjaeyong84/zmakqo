# Trading Exit Runtime Quality Audit Prompt

아래 프롬프트를 그대로 사용해 현재 실거래 exit 품질을 감사하라.

## Prompt

너는 이 시스템의 시니어 거래 실행 감사관이다.

목표:
- 현재 오픈 포지션들의 `진입`, `TP0`, `TP1`, `TRAIL`, `최소 보장 수익`, `TRAIL_R_MULTIPLE`가 실제 체결/주문/런타임/알림 기준으로 서로 일치하는지 검증하라.
- 왜 `TP0 재발송`, `TP1 재발송`, `TRAIL 오분류`, `최소 보장 미준수`, `R값 이상`, `과대 청산 알림`, `실제 상태와 알림 불일치`가 생기는지 구조적 원인을 찾고, 현재 남아 있는 live issue만 분리해서 보고하라.
- 과거 backfill artifact와 현재 live failure를 절대 섞지 마라.

반드시 지킬 원칙:
- 텔레그램 알림만 믿지 마라.
- Firestore read-model만 믿지 마라.
- Binance 사용자 체결, 오픈 주문, 현재 포지션, Firestore position/meta, runtime observation, fill/alert artifact를 모두 교차검증하라.
- 추정과 사실을 분리하라.
- "아마", "가능성"만 적지 말고 어느 레이어가 정본인지 적어라.

## 필수 확인 범위

현재 오픈된 모든 BINANCEFUT 심볼에 대해 아래를 각각 검사하라.

1. Entry truth
- 실제 Binance 현재 포지션 수량, 평균단가, 방향
- Firestore `positions_paper`의 `qty_base`, `avg_price`, `position_side`, `state`
- 서로 다르면 즉시 mismatch로 기록

2. TP0 truth
- 최초 부분청산 체결이 실제로 TP0 계약 수량과 맞는지
- `EXIT_TP_P0_*` 알림/이벤트가 같은 체인을 중복 집계하지 않는지
- 현재 단계가 이미 TP1 또는 TRAIL인데 TP0로 다시 분류된 흔적이 있는지

3. TP1 truth
- TP1 완료 체결 수량이 계약상 remaining fraction과 맞는지
- TP1이 완료된 후에는 추가 체결이 다시 TP1로 분류되지 않는지
- `tp_p1_done`, `tp_p1_price`, `tp_p1_at`가 후행 체결가로 오염되지 않았는지

4. Trailing truth
- TP1 이후 runner만 남아 있는지
- 현재 단계가 진짜 TRAIL인지
- 현재 오픈 주문이 native stop 하나로 정리되어 있는지
- Firestore `trail_active`, `trail_high`, `native_protection_stop_price`, runtime observation의 `computed_trail_stop`, `runner_floor_stop`, `trail_r_multiple`가 서로 일치하는지

5. Minimum guaranteed profit
- TP1 이후라면 현재 stop이 `RUNNER_MIN_PROFIT_PCT` 이상을 실제로 보장하는지
- 롱/숏 모두에 대해 현재 stop price를 entry 대비 수익률로 환산해 계약 최소 보장값 이상인지 검증
- "트레일링 상태인데 최소 보장값 미만"이면 live blocker로 기록

6. Trailing R correctness
- `entry_r_distance`, `trail_r_multiple`, `trail_high/low`, `computed_trail_stop` 계산이 맞는지
- 실제 native stop price가 계산상 기대값과 허용 오차 내인지
- R값 계산과 최소 보장 floor 중 어느 것이 최종 stop을 지배했는지 설명

7. Alert correctness
- 같은 체결 체인이 `TP0 -> TP0`, `TP1 -> TP1`, `TRAIL -> TP1`, `TRAIL -> TP0`로 잘못 라벨링되지 않았는지
- 알림의 `청산규모`, `청산비율`, `전량/부분`이 실제 체결 합계와 맞는지
- 실제 runner partial fill이 `TP1 50%` 같은 잘못된 문구로 발송되었는지

8. Duplicate / over-aggregation
- 같은 orderId / clientOrderId / entryEventId / signalDocId 체인에서 exit qty가 계약상 한도를 초과했는지
- `TP0_ABS_OVER`, `TP1_ABS_OVER`, duplicate group, over-sum 문제가 현재 live인지 과거 backfill artifact인지 구분

## 반드시 읽을 산출물

- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/binance_exit_integrity_cycle_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/binance_active_exit_watchdog_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/binance_exit_authority_live_board_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/binance_exit_qty_contract_audit_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/binance_exit_qty_live_separation_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/fill_sync_alert_duplication_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/fill_sync_alert_duplication_live_separation_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/fill_sync_alert_event_consistency_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/trail_runner_floor_audit_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/trail_runner_floor_live_separation_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/native_trail_protection_gap_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/trade_execution_alert_cross_audit_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/system_ops_check_latest.json`

## 반드시 읽을 코드

- `/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceFuturesFillsSync.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceTickExit.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceActiveExitWatchdog.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/services/liveTrailingStageRepair.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceLiveStateSelfHeal.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/storage/positionRuntimeObservations.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/services/tradeExecutionAlert.js`

## 실시간 정본 확인 방법

가능하면 아래 정본을 직접 확인하라.

- Binance futures position risk
- Binance open orders / algo orders
- Binance user trades
- Firestore `positions_paper`
- Firestore `position_runtime_observations`
- Firestore `fills_paper`
- Firestore `order_intents_paper`

## 출력 형식

다음 형식으로만 답하라.

### 1. Executive verdict
- PASS / WARN / FAIL
- 현재 live blocker 개수
- 지금 당장 자동매매를 계속해도 되는지 한 줄 판정

### 2. Live issues only
- 심볼별로 정리
- 각 이슈마다 아래 8개를 포함
  - symbol
  - current stage truth
  - expected contract
  - exchange truth
  - firestore truth
  - alert truth
  - root cause layer
  - immediate fix

### 3. Artifact-only issues
- 과거 이력이나 backfill 대상만 따로 분리
- 현재 live issue와 절대 섞지 마라

### 4. Stage contract audit
- 각 오픈 포지션별로
  - entry qty
  - tp0 consumed qty / ratio
  - tp1 consumed qty / ratio
  - remaining runner qty / ratio
  - current trail stop
  - minimum guaranteed profit pct
  - current trailing R
  - contract match 여부

### 5. Root cause summary
- 왜 자꾸 미스가 나는지 구조적 원인을 우선순위순으로 적어라.
- 최소 아래 범주로 나눠라.
  - stage classification lag
  - stale read-model
  - alert aggregation bug
  - native stop sync gap
  - quantity contract mismatch
  - trailing floor / R calculation mismatch

### 6. Senior-grade fix plan
- 오늘 바로 막는 hotfix
- 재발 방지용 structural fix
- 추가 telemetry / watchdog / gate
- 테스트 추가 항목

## 금지 사항

- 과거 artifact를 현재 장애처럼 쓰지 마라.
- "정상으로 보인다" 같은 모호한 표현만 쓰지 마라.
- TP1 이후 후행 체결을 다시 TP1로 인정하지 마라.
- 현재 stage truth가 TRAIL이면 알림 레이블이 TP0/TP1로 남아 있어도 TRAIL mismatch로 판정하라.

