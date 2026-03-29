BINANCE FUTURES (USDⓈ-M/COIN-M) DEV SPEC DIGEST
Last checked: 2026-01-27

Scope: Binance Derivatives Trading (Futures only)
- USDⓈ-M Futures (USDT-M, /fapi)
- COIN-M Futures (Coin-M, /dapi)
- WebSocket Market Streams, User Data Streams, WebSocket API

============================================================
1) Base URL (REST + WS)
============================================================

[USDⓈ-M Futures (USDT-M)]
- REST (Production): https://fapi.binance.com
- REST (Testnet):    https://demo-fapi.binance.com
- WS Market Streams: wss://fstream.binance.com
- WS Market Streams(Test): wss://fstream.binancefuture.com
- WS API (Trade/Account):  wss://ws-fapi.binance.com/ws-fapi/v1
- WS API (Testnet):        wss://testnet.binancefuture.com/ws-fapi/v1
- WS User Data Stream:     wss://fstream.binance.com/ws/<listenKey>

[COIN-M Futures]
- REST (Production): https://dapi.binance.com
- REST (Testnet):    https://testnet.binancefuture.com
- WS Market Streams: wss://dstream.binance.com
- WS Market Streams(Test): wss://dstream.binancefuture.com
- WS API (Trade/Account):  wss://ws-dapi.binance.com/ws-dapi/v1
- WS API (Testnet):        wss://testnet.binancefuture.com/ws-dapi/v1
- WS User Data Stream:
  - wss://dstream.binance.com/ws/<listenKey>
  - wss://dstream-auth.binance.com/ws/<listenKey>?listenKey=<validateListenKey>

============================================================
2) REST 공통 규칙
============================================================

- API Key: X-MBX-APIKEY
- SIGNED는 HMAC SHA256(signature) 필수
- timestamp(ms) 필수, recvWindow 기본 5000
- query/body 동시 전송 시 query 우선
- 429/418: IP 기준 제한(418은 반복 위반 시 밴)
- 503: UNKNOWN 상태 가능 → 중복 주문 방지 위해 order query/WS 확인 후 재시도

============================================================
3) WebSocket Market Streams
============================================================

- raw: /ws/<streamName>
- combined: /stream?streams=<s1>/<s2>
- 심볼은 소문자
- 24시간 연결 유효, 3분마다 ping, pong 필수
- 연결당 메시지 10/sec 제한, 스트림 1024 제한
- 주문/포지션 상태는 User Data Stream 우선 신뢰 권고

============================================================
4) User Data Streams (계정/주문)
============================================================

- listenKey 60분 유효, PUT keepalive로 연장
- -1125 발생 시 POST로 재발급
- 24시간 만료 재연결 필요
- 2024-09-03: USDT-M TRADE_LITE 이벤트 추가
- 2025-12-15: CONDITIONAL_ORDER_TRIGGER_REJECT 제거 → ALGO_UPDATE로 대체

============================================================
5) WebSocket API (주문/계정 액션)
============================================================

- WS API는 Market Streams와 별개 연결
- 요청 포맷:
  { "id": <any>, "method": "<methodName>", "params": { ... } }
- params 정렬 후 서명 필요 (WS API)
- price/quantity는 문자열로 전송 권장

============================================================
6) REST 신규 주문 (USDT-M 예시)
============================================================

POST /fapi/v1/order (SIGNED)
- symbol, side, type 필수
- positionSide: Hedge 모드에서 LONG/SHORT 필수
- MARKET: quantity 필수
- LIMIT: quantity + price + timeInForce 필수
- reduceOnly: Hedge 모드 금지
- newClientOrderId: 고유 권장

============================================================
7) 조건부 주문 Algo 이관 (중요)
============================================================

- STOP/TP/TRAILING_STOP_MARKET 등은 Algo로 이관됨
- /fapi/v1/algoOrder 사용
- User Stream: ALGO_UPDATE 이벤트 파싱 필요

============================================================
8) 히스토리 조회 제한
============================================================

- /fapi/v1/userTrades: 최근 6개월 제한
- /fapi/v1/aggTrades: 최근 1년 제한
- COIN-M은 async 다운로드 엔드포인트 제공

============================================================
9) 구현 체크리스트
============================================================

- base URL 선택 (USDT-M/COIN-M, prod/testnet)
- timestamp/recvWindow/서명 필수
- 429/418/503 처리
- User Data Stream 기반 상태 동기화
- Algo 주문 이관 반영

