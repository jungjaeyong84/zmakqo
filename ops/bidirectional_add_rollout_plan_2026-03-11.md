# 양방향 Add 롤아웃 계획서

작성 시각: 2026-03-11 KST  
기준 전략: `donbeolja_v5.6.0.2`  
적용 후보 범위: `BINANCEFUT`, `CORE`, `PRE_REAL`, `LONG`, `SHORT`

## 1. 결론

이 문서는 `양방향 add`를 바로 실반영하기 위한 문서가 아니다.  
현재 시점 최선의 판단은 아래와 같다.

1. 구현은 가능하다.
2. 하지만 현재 완료된 공유 상태 실엔진 리플레이만 보면 `add`가 실제로 거의 발동하지 않았다.
3. 따라서 지금 단계의 목적은 `안전한 구현 계획 + 발동 조건 검증 + 보호주문 정합성 보장`이다.

즉, 이 계획서는 `실장 준비 문서`이고, 아직 `live 적용 승인 문서`는 아니다.

## 2. 적용 가정

이번 계획서의 기준 규칙은 아래로 고정한다.

1. 대상 티어: `CORE`, `PRE_REAL`
2. 대상 방향: `LONG`, `SHORT`
3. add 횟수: `포지션당 1회`
4. add 목표 크기: `원 포지션의 100%`
5. 손실 구간: `미실현손익 -0.1% ~ -1.4%`
6. 단, `코인당 총액 cap`을 넘지 않도록 자동 축소
7. `TP1 이전`, `trail_active=false`, `tp_p1_pending=false`에서만 허용
8. 같은 봉 재추가 금지
9. 반대 방향 전환, flip 직전/직후 구간에서는 add 금지

## 3. 핵심 목적

이번 add 설계의 목적은 두 가지다.

1. 손실 구간에서 같은 방향 고품질 신호가 다시 나올 때만 평균단가를 보정한다.
2. add 체결 직후 바뀐 평균단가에 맞게 거래소 보호주문을 즉시 다시 맞춘다.

둘 중 하나라도 실패하면 이 기능은 live에 넣으면 안 된다.

## 4. 왜 보호주문 재설정이 필수인가

`ADD` 후 평균단가가 바뀌면 기존 `STOP_MARKET` 보호주문은 이전 평단 기준이 된다.  
이 상태를 방치하면 아래 문제가 생긴다.

1. 실제 의도보다 손절이 너무 가깝거나 멀어진다.
2. 내부 `SL/TP1/TRAIL` 규칙과 거래소 보호주문 기준이 달라진다.
3. fills sync가 `EXIT_EXTERNAL_SYNC`로 오인할 가능성이 커진다.
4. TP1 이후 트레일링과 보호주문 기준이 엇갈리면 전량 청산 오판이 생길 수 있다.

따라서 add는 `체결 -> 내부 평단 반영 -> 보호주문 재설정`이 한 묶음이어야 한다.

## 5. 시스템 동작 원칙

### 5.1 Add는 새 진입이 아니다

1. `ADD`는 기존 포지션 증액이다.
2. 포지션 doc는 유지하고 `avg_price`, `qty_base`, `size_pct`, `add_chain_count`만 갱신한다.
3. TP1 이후 단계로 들어간 포지션은 add 대상에서 제외한다.

### 5.2 총액 cap 우선

1. add 목표는 `원 포지션의 100%`다.
2. 하지만 최종 노출은 해당 코인의 cap을 넘으면 안 된다.
3. cap에 걸리면 `100% -> 가능한 수량으로 자동 축소`한다.
4. 축소 후 주문이 `minQty/minNotional/stepSize`에 안 맞으면 add는 생성하지 않는다.

### 5.3 내부 규칙과 거래소 규칙은 같은 평단을 봐야 한다

1. 내부 포지션 메타
2. internal exit 계산
3. Binance native stop

이 세 개는 add 이후 동일한 `newAvg`를 기준으로 맞아야 한다.

## 6. Add 트리거 규칙

### 6.1 공통 조건

1. 포지션 상태가 `ACTIVE`
2. 현재 방향과 같은 방향 신호
3. 이벤트가 `CORE_*` 또는 `PRE_REAL_*`
4. `tp_p1_done != true`
5. `tp_p1_pending != true`
6. `trail_active != true`
7. `add_chain_count < 1`
8. 현재 봉에서 이미 add 시도 없음

### 6.2 손실 구간 판정

손실 구간은 현재 포지션의 실질 손익률 기준으로 본다.

1. `uPnL <= -0.1%`
2. `uPnL >= -1.4%`

여기서 벗어나면 add는 만들지 않는다.

### 6.3 방향별 해석

`LONG`

1. 현재가가 평균단가 아래
2. 손실 구간 충족
3. 같은 방향 `CORE_LONG` 또는 `PRE_REAL_LONG` 재확인

`SHORT`

1. 현재가가 평균단가 위
2. 손실 구간 충족
3. 같은 방향 `CORE_SHORT` 또는 `PRE_REAL_SHORT` 재확인

## 7. 실행 순서

1. 동일 방향 신호 수신
2. 현재 포지션과 메타 조회
3. add guard 평가
4. 손실 구간 확인
5. 목표 add 수량 계산
6. cap 초과 시 자동 축소
7. precision/minNotional 보정
8. 실주문 실행
9. 내부 포지션의 `avg_price`, `qty_base`, `size_pct`, `add_chain_count` 갱신
10. `refreshBinanceNativeProtectionWithRetry()` 호출
11. 보호주문 재설정 성공/실패를 메타와 로그에 기록
12. 실패 시 텔레그램 경고

## 8. 보호주문 재설정 설계

### 8.1 기본 원칙

1. add fill 전에는 기존 보호주문을 건드리지 않는다.
2. add fill 후 새 평균단가가 저장된 다음 취소/재생성한다.
3. 기존 보호주문은 먼저 전부 정리한다.
4. 그 다음 새 평균단가 기준으로 새 `STOP_MARKET`을 생성한다.
5. 현재 운영 정책상 native TP는 기본적으로 끄고, native SL 중심으로 맞춘다.

### 8.2 재설정 실패 처리

재설정 실패를 silent 처리하면 안 된다.

실패 시 반드시:

1. warning 로그
2. 텔레그램 알림
3. retry
4. `positions_paper.meta.native_protection_stale=true`
5. `native_protection_refresh_status=FAILED`

를 남긴다.

## 9. 구현 범위

### 9.1 엔진

주 변경 파일:

1. [paperBinanceRunner.js](/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js)

예정 변경:

1. add 설정 플래그 추가
2. `CORE/PRE_REAL`, `LONG/SHORT` 양방향 add guard 적용
3. 손실 `0.1~1.4` 필터 연결
4. cap 기준 자동 축소 로직 연결
5. add 성공 후 보호주문 refresh 강제 호출
6. 결과를 포지션 메타에 저장

### 9.2 fills sync

주 변경 파일:

1. [binanceFuturesFillsSync.js](/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceFuturesFillsSync.js)

예정 변경:

1. add 직후 교체된 native stop 체결 재분류 보강
2. `EXIT_EXTERNAL_SYNC` 오판 감소
3. add 직후 짧은 정합성 유예창 검토

### 9.3 tick exit

주 변경 파일:

1. [binanceTickExit.js](/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceTickExit.js)

예정 변경:

1. add 직후 새 평균단가가 반영된 포지션만 기준으로 감시
2. stale native protection 경고 강화
3. trail/SL 로그에 add 이후 평균단가 기준 값 기록

### 9.4 Binance helper

주 변경 파일:

1. [binanceFuturesPrivate.js](/Users/jeongjaeyong/Projects/donbeolja/src/exchanges/binanceFuturesPrivate.js)

예정 변경:

1. regular/algo 주문 취소 범위 재점검
2. add 후 보호주문 idempotency 정합성 점검

## 10. 고려할 점

### 10.1 양방향 100% add의 구조적 위험

1. 평단 개선 효과는 크다.
2. 반대로 틀리면 손실도 급격히 커진다.
3. 특히 `LONG`은 과거 탐색에서 효과가 약하거나 음수인 경우가 많았다.

즉, 구현은 하더라도 `shadow -> limited live -> full live` 순서가 필수다.

### 10.2 add가 거의 안 터질 수 있다

현재 완료된 공유 상태 리플레이에서는 add가 실제로 거의 발동하지 않았다.  
이건 전략이 안전하다는 뜻이 아니라, 조건이 너무 좁아 실전 영향이 없을 수 있다는 뜻이다.

### 10.3 운영 게이트와 상호작용한다

실엔진 리플레이에서는 add 자체보다 아래가 결과를 바꿀 수 있다.

1. commission gate
2. opposite cooldown
3. tier budget auto scale
4. pending / trail / TP1 block

따라서 add 평가를 할 때는 `수익률`만 보면 안 되고, 실제 `rescue intent/fill`이 있었는지 먼저 봐야 한다.

## 11. 검증 기준

### 11.1 단위 테스트

1. `LONG add` 평균단가 재계산
2. `SHORT add` 평균단가 재계산
3. cap 초과 시 자동 축소
4. `tp1_done=true` 상태에서 add 차단
5. add 후 native protection refresh 호출
6. refresh 실패 시 stale 메타와 텔레그램 경고

### 11.2 실엔진 리플레이

반드시 아래를 같이 본다.

1. baseline
2. add `25%`
3. add `50%`
4. add `75%`
5. add `100%`

공통 조건:

1. `CORE+PRE_REAL`
2. `LONG+SHORT`
3. `1회`
4. 손실구간 비교:
   - `0.1 ~ 1.4`
   - `0.8 ~ 1.4`
   - `0.8 ~ 1.8`
5. `코인 cap 내 자동 축소`

### 11.3 live 승인 기준

아래를 모두 만족해야만 live 후보로 승격한다.

1. `rescue_intents > 0`
2. `rescue_fills > 0`
3. add 이후 내부/외부 평균단가 일치
4. native stop 재설정 성공
5. `EXIT_EXTERNAL_SYNC` 오판 증가 없음
6. TP1 이후 trailing 정상 유지

## 12. 현재까지의 리플레이 사실

완료된 공유 상태 실엔진 리플레이:

1. [replay_rescue_compare_sharedstate_3d_loss06_14_alladds.json](/Users/jeongjaeyong/Projects/donbeolja/ops/analysis/replay_rescue_compare_sharedstate_3d_loss06_14_alladds.json)
2. [replay_rescue_compare_sharedstate_3d_loss08_18_alladds.json](/Users/jeongjaeyong/Projects/donbeolja/ops/analysis/replay_rescue_compare_sharedstate_3d_loss08_18_alladds.json)

공통 범위:

1. 기간: `3일`
2. 심볼: `BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT, SOLUSDT, AXSUSDT`
3. source signals: `62`
4. 이벤트 분포:
   - `CORE_SHORT 25`
   - `PRE_REAL_SHORT 12`
   - `CORE_LONG 10`
   - `EARLY_LONG 5`
   - `PRE_REAL_LONG 5`
   - `EARLY_SHORT 3`
   - `SS_SHORT 2`

주의:

1. 아래 완료 리플레이는 모두 `이전 손실구간` 기준이다.
2. 즉 현재 요청한 `-0.1% ~ -1.4%` 설정의 최종 검증 결과는 아직 아니다.
3. 이 섹션은 최신 계획 기준의 직접 근거가 아니라, 직전 검증 이력으로만 봐야 한다.

핵심 결과:

1. baseline:
   - trades `11`
   - win rate `90.91%`
   - total pnl `+4.5608`
2. `0.8~1.8` 손실구간:
   - `25/50/75/100` 모두 `rescue_intents=0`, `rescue_fills=0`
   - 즉 add 미발동
3. `0.6~1.4` 손실구간:
   - `25/75/100` 역시 `rescue_intents=0`, `rescue_fills=0`
   - `50%` 시나리오만 `+0.3731` 차이가 있었지만, 여전히 `rescue_fills=0`
   - 따라서 이 차이는 add 효과로 해석하면 안 된다.

현재 확정 가능한 해석:

1. 지금 규칙은 양방향 add를 한다고 해도, 완료된 3일 리플레이에서는 실제 add가 한 번도 체결되지 않았다.
2. 즉 `100% add`가 좋다/나쁘다를 아직 말할 근거가 부족하다.
3. 먼저 해결해야 할 문제는 `add 발동 빈도`와 `운영 게이트와의 충돌`이다.

## 13. 롤아웃 제안

현 시점 제안 순서는 아래가 맞다.

1. 계획서 기준으로 코드 구현
2. shadow mode
3. `rescue_intent/fill`이 실제 생기는지 관찰
4. native protection refresh 안정성 검증
5. 그 다음 limited live

지금 바로 full live는 권고하지 않는다.

## 14. 롤백 계획

1. `rescue_add_enabled=0`
2. add 신규 생성 중단
3. 보호주문 refresh 로직은 유지
4. 대시보드에 `disabled` 상태 표시
