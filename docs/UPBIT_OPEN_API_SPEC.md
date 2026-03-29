# UPBIT OPEN API (KR) - API OVERVIEW / AUTH / RATE LIMITS / REST+WEBSOCKET GUIDE
Codex Paste용 요약본 (문서 기반 규격 정리)

> 출처: 업비트 개발자 센터 문서의 '개요(api-overview)', '인증(auth)', '요청 수 제한(rate-limits)',
> 'REST API 사용 및 에러 안내', 'WebSocket 사용 및 에러 안내'
> 목적: 구현자가 즉시 연동 가능한 “공통 규격 + 운영 포인트”를 한 문서로 제공

---

## 0) 범위
- 시세 조회(Quotation) + 거래/자산 관리(Exchange)
- 인증/JWT, 레이트리밋, REST/WS 운영 포인트

---

## 1) API 카테고리(기능 성격 기준)
### 1.1 시세 조회(Quotation)
- 성격: Public API (인증 없이 호출)
- 범위: 조회 전용(과거 이력 + 실시간 조회)
- 주요 기능: 페어, 캔들(OHLCV), 최근 체결, 현재가, 호가

### 1.2 거래 및 자산 관리(Exchange)
- 성격: Private API (API Key 기반 인증 필수)
- 범위: 주문/취소/조회, 입출금 요청/조회 등
- 주요 기능: 계정 자산, 주문, 입출금, 트래블룰 관련 요청, 서비스 상태/키 목록 조회

---

## 2) 연동 방식(프로토콜)
### 2.1 REST API
- 방식: Request-Response
- 적합: 주문 생성/취소/입출금 요청, 느린 주기 갱신 조회
- 단점: 실시간성 낮음

### 2.2 WebSocket
- 방식: 최초 연결 이후 스트림 수신
- 적합: 실시간 시세/체결/호가/캔들 구독, 모니터링 및 자동매매 반영
- 단점: 연결 유지/재연결/ping-pong 등 운영 난이도 존재

---

## 3) 공통 Endpoint / 보안 / 포맷
### 3.1 REST Base URL
- https://api.upbit.com
- REST 호출은 일반적으로 `/v1` 하위 경로 사용

### 3.2 WebSocket Endpoint
- 시세(Quotation): `wss://api.upbit.com/websocket/v1`
- 자산/주문(Exchange): 인증 필요

### 3.3 TLS
- TLS 1.2 이상 지원 (TLS 1.3 권장)

### 3.4 Content-Type
- REST는 `application/json` 지원
- 특히 POST는 JSON Body 요청 필요
  - `Content-Type: application/json; charset=utf-8`

### 3.5 Query Parameter 인코딩(REST)
- GET/DELETE에서 쿼리 파라미터가 있으면 URL 인코딩 후 요청
- 단, 배열 형식이며 이름에 `[]` 포함하는 경우 '[' , ']' 문자는 인코딩 대상에서 제외

### 3.6 gzip(REST)
- gzip 응답은 “시세(Quotation) API”만 지원
  - `Accept-Encoding: gzip`

---

## 4) 인증(Exchange REST + Exchange WebSocket)
### 4.1 API Key 기본
- API Key = Access Key + Secret Key 쌍
- Secret Key는 발급 시에만 확인 가능, 외부 노출 금지
- API Key는 허용 IP 등록 필요, Key당 최대 10개 IP 등록 가능

### 4.2 권한(Permission)
- API Key는 권한 그룹을 선택 부여
- 권한 부족 시 `out_of_scope` 오류 가능
- 각 API Reference 하단의 “API Key Permission” 기준 충족 필요

### 4.3 인증 토큰(JWT) 전송
- REST 및 WebSocket(Private) 모두 동일하게 Authorization 헤더 사용
  - `Authorization: Bearer <JWT_TOKEN>`

### 4.4 JWT 구조(권장)
- JWT = Header.Payload.Signature (Base64Url 인코딩, '.' 구분)
- Header(권장): `{"alg":"HS512","typ":"JWT"}`
- Signature: HMAC-SHA512( base64UrlEncode(header) + "." + base64UrlEncode(payload), Secret Key )
- Secret Key는 Base64 인코딩되어 있지 않으므로 별도의 Base64 디코딩 불필요

### 4.5 Payload 필드(필수/조건)
- `access_key` (필수)
- `nonce` (필수): 매 요청마다 새로운 UUID 문자열
- `query_hash` (조건): 쿼리/바디 존재 시 필수
- `query_hash_alg` (선택): 기본 SHA512

### 4.6 query_hash 생성 규칙(매우 중요)
#### A) GET/DELETE
- 실제 요청 URL에 포함된 “쿼리 문자열(query string)” 그대로 사용
- 파라미터 순서 변경 금지
- 배열 파라미터는 `states[]=wait&states[]=watch` 형태
- 쉼표 구분 파라미터는 `pairs=KRW-BTC,KRW-ETH` 형태
- URL 인코딩 “되지 않은” 문자열 기준으로 SHA512 해시

#### B) POST
- JSON Body의 모든 Key-Value를 “쿼리 문자열 형식”으로 변환 후 해시
- QueryString 생성 로직과 실제 요청 Body가 불일치하면 서명 검증 실패

### 4.7 최소 구현 절차(JWT)
1) (옵션) query_string 생성
   - GET/DELETE: URL의 raw query string 사용
   - POST: JSON Body -> query_string 변환
2) `query_hash = SHA512(query_string).hex`
3) payload 구성: `{access_key, nonce, (query_hash, query_hash_alg="SHA512")}`
4) JWT 생성: HS512 서명
5) Authorization 헤더로 전송

---

## 5) 요청 수 제한(Rate Limits)
### 5.1 공통 원칙
- 초(Second) 단위 제한
- 그룹별 허용 횟수 정의
- 동일 그룹 API 간 요청 수 합산

### 5.2 Origin 헤더 포함 요청(특수)
- Quotation REST + Quotation WebSocket 요청에 대해 10초당 1회만 허용

### 5.3 잔여 요청 수 확인(REST)
- 응답 헤더: `Remaining-Req`
  - 예: `group=default; min=1800; sec=29`

### 5.4 초과 요청 제재
- 429 Too Many Requests
- 429 반복 시 418 (차단 시간 포함)

### 5.5 제한 측정 단위
- Quotation REST: IP 단위
- Exchange REST: 계정 단위
- WebSocket: 인증 헤더 포함 시 계정 단위, 미포함 시 IP 단위

### 5.6 Rate Limit 그룹 정책(요약)
#### [Quotation]
- market/candle/trade/ticker/orderbook: 초당 10회

#### [Exchange]
- default: 초당 30회
- order/order-test: 초당 8회
- order-cancel-all: 2초당 1회

#### [WebSocket]
- websocket-connect: 초당 5회
- websocket-message: 초당 5회 + 분당 100회

---

## 6) REST API 사용 및 에러 규격
### 6.1 인증(Exchange)
- 인증 필요 API는 Authorization 필수

### 6.2 주요 HTTP Status / 에러 코드
- 400: validation_error, create_ask_error, create_bid_error, insufficient_funds_*, under_min_total_*, withdraw_address_not_registered 등
- 401: invalid_query_payload, jwt_verification, expired_access_key, nonce_used, no_authorization_ip, out_of_scope 등
- 404: 존재하지 않는 데이터
- 418/429: 요청 제한 초과/차단
- 500: 서버 오류

### 6.3 에러 응답 형식
- Quotation: `{"error":{"name":400,"message":"..."}}`
- Exchange:   `{"error":{"name":"ERROR_CODE","message":"..."}}`

---

## 7) WebSocket 사용 및 에러 규격
### 7.1 인증 필요 여부
- Quotation: 인증 없음
- Exchange: Authorization 헤더로 JWT 필요

### 7.2 에러 응답
- `{"error":{"name":"ERROR_CODE","message":"..."}}`
- 주요 error.name: `INVALID_AUTH, WRONG_FORMAT, NO_TICKET, NO_TYPE, NO_CODES, INVALID_PARAM`

### 7.3 수신 데이터(type)
- ticker / trade / orderbook / candle.{unit}
- myAsset / myOrder

### 7.4 요청 메시지 구조(JSON Array)
- 기본: `[ TicketObject, DataTypeObject1, ..., FormatObject ]`
- Ticket: `{"ticket":"<UUID>"}`
- DataType: `type`, `codes`(필수), 옵션: level, is_only_snapshot, is_only_realtime
- Format: `{"format":"DEFAULT|SIMPLE|JSON_LIST|SIMPLE_LIST"}`

### 7.5 연결 관리
- 120초 Idle Timeout
- 주기 PING/PONG 또는 "PING" 메시지로 유지
- 정상 유지 시 10초 간격 `{ "status": "UP" }` 전송

### 7.6 압축(Compression)
- RFC7692 기반 압축 지원

---

## 8) 기능 목록(개요 기준)
### 8.1 Quotation(REST)
- 페어 목록, 캔들(Second/Minute/Day/Week/Month/Year), 최근 체결, 현재가, 호가

### 8.2 Quotation(WebSocket)
- ticker/trade/orderbook/candle.{unit} 구독

### 8.3 Exchange(REST)
- 자산, 주문, 입출금, 트래블룰, 서비스 상태

### 8.4 Exchange(WebSocket)
- myAsset / myOrder

---

## 9) 구현 체크리스트(실패 원인 상위)
- nonce 매 요청 UUID 신규 생성(재사용 금지)
- query_hash 생성 시 문자열 구성/순서/배열/인코딩이 실제 요청과 100% 일치
- HS512 서명 사용, Secret Key Base64 디코딩 불필요
- Remaining-Req 기반 호출량 추적, 429 시 백오프
- Quotation만 gzip 지원
- WS Idle Timeout 대응(PING/PONG)

---

## 10) 정합성 메모(검증 필요)
- Private WS는 동일 엔드포인트(`/websocket/v1`)를 쓰고 Authorization 헤더로 인증하는 방식이 일반적입니다. 
  (문서 개정에 따라 별도 경로가 생길 수 있으니 최신 문서 확인 필요)

