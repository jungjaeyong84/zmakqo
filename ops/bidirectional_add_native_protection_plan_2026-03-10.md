# 양방향 Add + 보호주문 재설정 계획서

작성 시각: 2026-03-10 KST
기준 전략: `donbeolja_v5.6.0.2`
적용 범위: `BINANCEFUT`, `CORE`, `PRE_REAL`, `LONG`, `SHORT`

## 1. 목적

현재 엔진은 동일 방향 신호를 `ADD`로 처리할 수 있고, 내부 포지션 평균단가(`avg_price`)와 수량(`qty_base`)도 갱신한다. 다만 실거래에서 `ADD` 체결 후 평균단가가 바뀌면, 거래소 네이티브 보호주문(`STOP_MARKET`, 선택적 `TAKE_PROFIT_MARKET`)도 반드시 새 평균단가 기준으로 다시 계산되어야 한다.

이번 변경의 목적은 아래 두 가지다.

1. `LONG/SHORT` 양방향 모두에서 1회 `ADD`를 허용한다.
2. `ADD` 체결 직후 보호주문을 새 평균단가 기준으로 안전하게 재설정한다.

## 2. 적용 규칙

### 2.1 Add 트리거 규칙

1. 대상 티어: `CORE`, `PRE_REAL`
2. 대상 방향: `LONG`, `SHORT`
3. Add 횟수: `포지션당 1회`
4. Add 크기: `원 포지션의 100%`
5. 손실 구간: `미실현손익 -0.8% ~ -1.4%`
6. 단, `코인당 총액 cap`을 넘지 않도록 자동 축소
7. `TP1 이전`, `trail_active=false`, `tp_p1_pending=false` 상태에서만 허용
8. 같은 봉 재추가 금지
9. 반대 방향 전환(`EXIT_OPPOSITE_SIGNAL`, flip transition)과 동시 발생 시 add 금지

### 2.2 코인당 총액 cap 정의

이번 계획서에서는 `코인당 총액 cap`을 현재 엔진의 `riskBudget.maxKrw` 기준으로 본다.

즉:

1. 최초 진입이 해당 코인 cap의 100% 미만으로 들어가더라도
2. `ADD` 후 최종 `size_pct`가 `1.0`을 넘지 않게 강제하고
3. 남은 여유가 100% add에 부족하면 `자동 축소`한다.

이 규칙은 현재 `paperBinanceRunner.js`의 `remaining = 1 - curSize` 및 `TOTAL_BUDGET_EXCEEDED` 분기와 연결된다.

참조:

1. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L5486)
2. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L5532)
3. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L5698)

## 3. 현재 재사용 가능한 기반

### 3.1 Add guard / add meta

기존 엔진에는 `ADD`용 guard와 메타 누적 구조가 이미 있다.

1. `resolveAddRiskConfig()`
2. `evaluateAddIntentRiskGuard()`
3. `applyAddRiskMetaOnFill()`
4. `add_chain_count`, `add_chain_active`, `add_guard_day_loss_streak`

참조:

1. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L2283)
2. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L2341)
3. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L2414)

### 3.2 평균단가 / 수량 갱신

`ENTRY/ADD` 체결 후 내부 포지션은 이미 아래 값이 갱신된다.

1. `newAvg`
2. `newQtyBase`
3. `newSize`

참조:

1. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L5692)
2. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L5735)
3. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L5741)

### 3.3 네이티브 보호주문 재설정 함수

기존 엔진에는 보호주문 재설정 함수가 이미 있다.

1. `refreshBinanceNativeProtectionWithRetry()`
2. `refreshBinanceNativeProtection()`
3. 내부 동작:
   - 현재 바이낸스 포지션 조회
   - 기존 open/algo orders 취소
   - 새 `STOP_MARKET` 재배치
   - 옵션으로 새 `TAKE_PROFIT_MARKET` 재배치

참조:

1. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L3995)
2. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L4028)
3. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L4084)
4. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js#L4105)

### 3.4 외부 fill sync 재분류

fills sync는 `closePosition=true`인 보호주문 체결을 `SL/TP1/TRAIL`로 분류한다. 따라서 `ADD` 이후 보호주문이 교체되면, 그 새 주문의 성격이 내부 상태와 일치해야 `EXIT_EXTERNAL_SYNC` 오판이 줄어든다.

참조:

1. [binanceFuturesFillsSync.js](/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceFuturesFillsSync.js#L740)

## 4. 핵심 설계

### 4.1 설계 원칙

1. `ADD`는 새 포지션이 아니라 `기존 포지션 증액`으로 본다.
2. 증액이 발생하면 내부 `avg_price`, `qty_base`, `size_pct`가 먼저 확정되어야 한다.
3. 내부 포지션 확정 직후, 동일 트랜잭션 후속 단계에서 네이티브 보호주문을 재설정한다.
4. 보호주문 재설정 실패는 조용히 무시하지 않고, 텔레그램 경고 + 리트라이 + 상태 표식으로 남긴다.

### 4.2 Add 실행 순서

1. 동일 방향 신호가 들어오면 `ENTRY` 대신 `ADD` 의도로 변환
2. 현재 포지션 기준으로 `LONG/SHORT`, `tier`, `uPnL`, `add_chain_count` 확인
3. `-0.8% ~ -1.4%` 손실 구간인지 확인
4. `100% add` 목표치 계산
5. 코인 cap 초과 시 `자동 축소`
6. 최소 주문 수량/최소 명목금액/step size 보정
7. 실주문 체결
8. 내부 `avg_price`, `qty_base`, `size_pct`, `add_chain_count` 갱신
9. 새 평균단가 기준으로 보호주문 취소 후 재배치
10. 보호주문 재설정 성공 여부를 로그/텔레그램/메타에 기록

### 4.3 LONG/SHORT 계산 규칙

`LONG`

1. 현재가가 평균단가 아래로 내려와 `uPnL <= -0.8%`
2. `uPnL >= -1.4%`
3. 같은 방향 `CORE_LONG` 또는 `PRE_REAL_LONG` 신호가 추가 확인되면 `ADD`

`SHORT`

1. 현재가가 평균단가 위로 올라 `uPnL <= -0.8%`
2. `uPnL >= -1.4%`
3. 같은 방향 `CORE_SHORT` 또는 `PRE_REAL_SHORT` 신호가 추가 확인되면 `ADD`

## 5. 보호주문 재설정 설계

### 5.1 왜 재설정이 필요한가

`ADD` 후 평균단가가 바뀌면 기존 보호주문은 이전 평단을 기준으로 만들어진 주문이므로 그대로 두면 안 된다.

문제 예시:

1. `LONG` add 후 평균단가가 내려갔는데 SL이 예전 높은 평단 기준이면 손절이 너무 가까워짐
2. `SHORT` add 후 평균단가가 올라갔는데 SL이 예전 낮은 평단 기준이면 실제 허용 손실과 달라짐
3. TP 네이티브 주문이 켜져 있으면 `TP1/Trail` 판정도 왜곡될 수 있음

### 5.2 보호주문 재설정 원칙

1. `ADD` fill이 확정되기 전에는 보호주문을 먼저 건드리지 않는다.
2. `ADD` fill 후 새 평균단가가 저장된 뒤 재계산한다.
3. 기존 보호주문은 `cancelFuturesOpenOrders()`로 먼저 정리한다.
4. 그 다음 새 평균단가 기준으로 `STOP_MARKET`을 재생성한다.
5. 네이티브 TP 사용 시 TP도 새 평균단가 기준으로 재생성한다.
6. 내부 `TP1`, `TRAIL`, `BE` 상태는 초기화가 아니라 `현재 포지션 단계`에 맞게 유지/재계산한다.

### 5.3 TP1/Trail 상태 처리

이번 규칙에서 `ADD`는 `TP1 이전`에만 허용하므로 원칙은 아래와 같다.

1. `tp_p1_done=true`면 add 금지
2. `trail_active=true`면 add 금지
3. `tp_p1_pending=true`면 add 금지
4. 따라서 add 후 보호주문 재설정은 항상 `SL 중심`이고, TP1/Trail 단계 상태 꼬임을 줄일 수 있다.

## 6. 구현 범위

### 6.1 엔진

주 변경 파일:

1. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js)

변경 포인트:

1. `ADD` 의도 생성 조건을 운영 설정으로 활성화
2. `LONG/SHORT` 양방향 동일 규칙 적용
3. `-0.8% ~ -1.4%` 손실 구간 설정값 추가
4. `100% add` 목표치 계산 후 코인 cap 기준 자동 축소
5. `ADD` 성공 후 `refreshBinanceNativeProtectionWithRetry()` 강제 호출
6. 보호주문 재설정 결과를 `positions_paper.meta`에 기록

### 6.2 fills sync / 외부 정합성

주 변경 파일:

1. [binanceFuturesFillsSync.js](/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceFuturesFillsSync.js)

변경 포인트:

1. `ADD` 직후 새 보호주문 체결을 이전 주문으로 오인하지 않도록 id/타입 정합성 강화
2. `EXIT_EXTERNAL_SYNC`로 떨어질 가능성이 있는 `closePosition=true` 체결 재분류 근거 보강
3. 새 보호주문 교체 직후 짧은 정합성 유예창을 둘지 검토

### 6.3 tick exit

주 변경 파일:

1. [binanceTickExit.js](/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceTickExit.js)

변경 포인트:

1. add 직후 새 평균단가가 반영된 포지션만 감시하도록 정합성 체크
2. 보호주문 refresh 실패 상태가 있으면 경고 강화
3. 내부 trail/SL 계산 기준이 새 평균단가와 일치하는지 검증 로그 추가

### 6.4 Binance private helper

주 변경 파일:

1. [binanceFuturesPrivate.js](/Users/jeongjaeyong/Projects/donbeolja/src/exchanges/binanceFuturesPrivate.js)

변경 포인트:

1. regular + algo 주문 취소 범위를 add refresh 시 확실히 보장
2. 새 보호주문 idempotency key가 add 후 평균단가 변화를 반영하도록 점검

## 7. 고려할 점

### 7.1 실전 리스크

1. 양방향 100% add는 평균단가 개선 효과가 크지만, 틀리면 손실도 크게 확대된다.
2. 특히 `LONG`은 과거 검증에서 add 효과가 약하거나 역효과가 자주 있었다.
3. 따라서 live 적용 전 `shadow -> limited live -> full live` 순서가 필요하다.

### 7.2 보호주문 경쟁 조건

1. add fill sync가 늦게 들어오면, 내부 평균단가와 외부 포지션 평균단가가 잠시 어긋날 수 있다.
2. 기존 보호주문 취소와 새 보호주문 생성 사이에 빈 구간이 생기면 위험하다.
3. 이 구간을 최소화하려면:
   - add fill 성공 후 즉시 `refresh`
   - `retry`
   - 실패 시 텔레그램 경고
   - 실패 상태 메타 기록
   가 필요하다.

### 7.3 최소 주문 / 정밀도

1. 100% add를 cap에 맞춰 축소하면 주문이 너무 작아질 수 있다.
2. Binance `stepSize`, `minQty`, `minNotional` 보정 후 `ORDER_TOO_SMALL`로 드롭될 수 있다.
3. 이 경우 `ADD skipped by cap/precision`을 명시적으로 남겨야 한다.

### 7.4 반대 방향 전환과 충돌

1. add 후보 봉에 반대 방향 flip 신호가 동시에 나오면 add보다 청산/전환이 우선이다.
2. 기존 `EXIT_OPPOSITE_SIGNAL`, `FLIP_CONFIRM` 흐름과 충돌하면 안 된다.

## 8. 구현 단계

### 단계 1. 설정 추가

추가 예정 설정:

1. `rescue_add_enabled`
2. `rescue_add_tiers=CORE,PRE_REAL`
3. `rescue_add_sides=LONG,SHORT`
4. `rescue_add_size=1.0`
5. `rescue_add_min_loss_pct=0.8`
6. `rescue_add_max_loss_pct=1.4`
7. `rescue_add_max_adds=1`
8. `rescue_add_block_after_tp1=1`

### 단계 2. 엔진 로직

1. 동일 방향 in-position signal을 `ADD`로 승격
2. `uPnL` 손실 구간 필터 적용
3. `cap` 초과 시 자동 축소
4. `ADD` 체결 직후 보호주문 refresh 호출

### 단계 3. 보호주문 정합성

1. refresh 성공 시 새 `entry_price`, `stop_price`, `tp_price`, `order_id` 저장
2. refresh 실패 시:
   - 경고 로그
   - 텔레그램 알림
   - retry
   - 포지션 메타에 `native_protection_stale=true`

### 단계 4. 관측성

대시보드/리포트에 아래 항목 추가:

1. `add_count`
2. `last_add_at`
3. `avg_before_add`
4. `avg_after_add`
5. `native_protection_refreshed_at`
6. `native_protection_refresh_status`
7. `native_protection_stale`

## 9. 검증 계획

### 9.1 단위 테스트

1. `LONG add` 후 평균단가 재계산 테스트
2. `SHORT add` 후 평균단가 재계산 테스트
3. cap 초과 시 자동 축소 테스트
4. `tp1_done=true` 상태에서 add 차단 테스트
5. add 후 native protection refresh 호출 테스트
6. refresh 실패 시 텔레그램 경고 테스트

### 9.2 실엔진 리플레이

공유 상태 실엔진 리플레이 기준:

1. baseline
2. add 25%
3. add 50%
4. add 75%
5. add 100%

공통 조건:

1. `CORE+PRE_REAL`
2. `LONG+SHORT`
3. `1회`
4. `손실 0.8% ~ 1.4%`
5. `코인 cap 내 자동 축소`

### 9.3 live rollout

1. `shadow mode` 3일
2. `PRE_REAL만 limited live` 3일 또는 20 trades
3. 이상 없으면 `CORE 포함`
4. 롤백 스위치는 설정값으로 즉시 off 가능해야 함

## 10. 롤백 계획

1. `rescue_add_enabled=0`
2. 기존 보호주문 refresh 로직만 유지
3. add 관련 메타는 읽되, 신규 add 생성은 중단
4. 대시보드에는 `disabled` 상태를 명시

## 11. 완료 기준

다음이 모두 만족되어야 live 반영 가능으로 본다.

1. `ADD` 후 평균단가가 내부/외부에서 일치
2. 보호주문이 새 평균단가 기준으로 교체됨
3. `TP1 -> trailing` 정상 유지
4. `EXIT_EXTERNAL_SYNC` 오판 증가 없음
5. 리플레이에서 baseline 대비 개선 근거 확보
6. 텔레그램 경고 없이 `native protection stale` 미발생

## 12. 리플레이 결과 첨부

이 문서 작성 시점에 아래 조건으로 공유 상태 실엔진 리플레이를 실행했다.

1. `CORE+PRE_REAL`
2. `LONG+SHORT`
3. `1회`
4. `손실 0.8% ~ 1.4%`
5. `100% add`
6. `코인 cap 내 자동 축소`
7. `24시간 spot replay`
8. `6심볼: BTC/ETH/BNB/XRP/SOL/AXS`

산출물:

1. [replay_rescue_compare_sharedstate_1d_loss08_14_add100.json](/Users/jeongjaeyong/Projects/donbeolja/ops/analysis/replay_rescue_compare_sharedstate_1d_loss08_14_add100.json)
2. [replay_rescue_compare_sharedstate_1d_loss08_14_add100.log](/Users/jeongjaeyong/Projects/donbeolja/tmp/replay_rescue_compare_sharedstate_1d_loss08_14_add100.log)

요약:

1. baseline
   - trades: `8`
   - win rate: `87.5%`
   - total pnl: `+3.3055`
   - long pnl: `+3.3055`
   - short pnl: `0`
2. rescue add 100%
   - trades: `8`
   - win rate: `87.5%`
   - total pnl: `+3.3046`
   - long pnl: `+3.3046`
   - short pnl: `0`
3. delta vs baseline
   - total pnl: `-0.0009`
   - win rate: `변화 없음`

핵심 해석:

1. 이번 24시간 공유 상태 replay에서는 `ADD intent=0`, `ADD fill=0`이었다.
2. 즉 `100% add` 규칙이 성과를 바꾼 것이 아니라, 실제로는 발동하지 않았다.
3. add 후보 드롭 사유는 대부분 `REPLAY_RESCUE_ADD_LOSS_WINDOW_BLOCKED`였다.
4. 따라서 현재 설정은 `위험해서 성과가 나쁜 전략`이 아니라, `손실구간 조건이 좁아 실제 발동 빈도가 매우 낮은 전략`에 가깝다.
5. 같은 이유로, live 적용 전에 `발동 빈도`와 `보호주문 재설정 안정성`을 먼저 검증해야 한다.
