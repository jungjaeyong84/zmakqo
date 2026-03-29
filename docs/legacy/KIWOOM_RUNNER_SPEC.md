# KIWOOM Runner/Adapter 설계 스펙 (기록용)

> 목적: 돈벌자 Ω 기존 아키텍처(확정봉, Signal→Intent→Fill→Position, Gate/StateMachine)를 유지한 채
> 키움 REST를 Upbit/Binance처럼 플러그인으로 붙이기 위한 설계 메모.
> **구현 지시 아님.** 향후 반영 기준으로만 보관.

## 0) 목표/전제
- 확정봉 기준(기본 60m)으로만 신호/체결/로그/리포트
- signal_id = exchange + symbol + tf + bar_close_kst
- 상태머신: FLAT → PROBE → COMMIT → SCALE_OUT → FLAT
- Data Quality Gate: 결측/지연/스파이크/정지/호가 공백 시 보류/차단

## 1) 역할 분리
### 1.1 KiwoomRunner (집행 오케스트레이터)
- 입력: 확정봉 신호
- Gate 체크 → 상태머신 → Intent 생성/멱등락
- Adapter 호출(주문/취소/정정/조회/계좌)
- Fill 반영/Position 업데이트/Consumed 마킹

### 1.2 KiwoomAdapter (프로토콜 번역기)
- 내부 표준 요청 → 키움 REST/WS 호출
- 응답 정규화/에러 표준화

## 2) Kiwoom REST/WS 외부 계약
### 2.1 OAuth2
- POST /oauth2/token
- grant_type=client_credentials, appkey, secretkey
- mock: https://mockapi.kiwoom.com (KRX 한정)

### 2.2 주문
- POST /api/dostk/ordr
- api-id: kt10000(매수) / kt10001(매도) / kt10002(정정) / kt10003(취소)
- Body: dmst_stex_tp, stk_cd, ord_qty, ord_uv, trde_tp, cond_uv

### 2.3 계좌/잔고
- POST /api/dostk/acnt (예: ka01690)
- cash/holdings 정규화 필요

### 2.4 차트
- POST /api/dostk/chart
- ka10080(분봉), ka10081(일봉), ka10082(주봉), ka10083(월봉)

### 2.5 WebSocket
- wss://api.kiwoom.com:10000 (mock: wss://mockapi.kiwoom.com:10000)
- 체결/잔고 실시간은 품질상 유리

## 3) 내부 표준 요청/응답
- 공통 envelope: request_id, run_id, exchange, symbol, ts_ms
- PlaceOrder: api_id, dmst_stex_tp, stk_cd, side, order_type, qty, price, tif, client_order_id
- FetchAccount: cash_krw, holdings[]
- FetchBars: bars[{t,o,h,l,c,v}]

## 4) Firestore 설계
- signals / signals_consumed / order_intents_live / fills_live / positions_live / bars_snapshots / gate_events / system_runs
- DocID 표준: SIG__, SIGLOCK__, INTENT__, FILL__, POS__, BAR__, GATE__

## 5) 에러코드 매핑
- AUTH_EXPIRED/AUTH_INVALID, RATE_LIMIT, INVALID_REQUEST, SYMBOL_NOT_FOUND,
  INSUFFICIENT_FUNDS, MARKET_CLOSED, ORDER_REJECTED, ORDER_NOT_FOUND,
  PROVIDER_5XX, NETWORK_TIMEOUT, UNKNOWN

## 6) 재시도 정책
- 조회: 6회, 주문: 3회(멱등락 필수)
- 네트워크 타임아웃 시: 즉시 재주문 금지, 주문 조회로 리컨실
- RATE_LIMIT: 백오프 + Gate reason 기록

## 7) KRX 특이점
- MarketCalendar 필요 (휴장/조기폐장/특별세션)
- 60m 봉은 세션 분할 이슈 → 초기 기본 TF는 D 권장
- 호가 단위/가격 반올림 필수
- 롱 only: BUY/SELL만
- 심볼 표준: KRX:005930 등 네임스페이스 권장

## 8) Phase Gate (Kiwoom)
- K0 MOCK 정합성 → K1 MOCK 안정성(200봉) → K2 소액 LIVE

## 9) Open Issues (초기 결정 필요)
- 기본 TF: D vs 60m 유지
- PAPER: next_open 모델 vs mock 체결 직접 호출
- 신호 소스: TV webhook 중심 vs 서버 계산 중심

