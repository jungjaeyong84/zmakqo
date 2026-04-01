# SIGNAL_V6_1_1_0_TV_IMPORT_AND_CONSUMER_CONTRACT

- 기준일: 2026-04-01
- 대상 파일:
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt`
- webhook consumer:
  - `/Users/jeongjaeyong/Projects/donbeolja/src/routes/webhook.routes.js`
- canary checklist:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_V6_1_1_0_CANARY_APPLY_CHECKLIST.md`

## 1. 목적

이 문서는 `v6.1.1.0` production candidate를 TradingView에 import할 때 필요한 설정과,
서버 webhook consumer가 실제로 요구하는 payload 계약을 한 번에 정리한 문서다.

## 2. TradingView import 기준

사용 파일:
- `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt`

권장 import 순서:
1. TradingView Pine Editor를 연다.
2. `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt` 전체를 붙여넣는다.
3. script name이 `돈벌자 :) Ω Full v6.1.1.0`인지 확인한다.
4. `Add to chart` 전에 compile error가 없는지 확인한다.
5. 차트 적용 후 input에서 provider / qtyPct를 설정한다.
6. Alert는 `Any alert() function call`만 사용한다.
7. frequency는 `Once Per Bar Close`로 고정한다.

표시 표면 원칙:
1. 내부 엔진은 신규 구조를 쓰더라도, 차트에서 보이는 제목/입력 그룹/상태 패널은 `v6.0.3.x`에 최대한 가깝게 유지한다.
2. 즉 import 후 사용자가 느끼는 표면은 이전 버전과 크게 다르지 않아야 한다.

권장 설정:
1. `Webhook provider`
- Binance 선물: `BINANCEFUT`
- Upbit: `UPBIT`

2. `Webhook qtyPct`
- 기본값: `1.0`
- 의미:
  - Pine 기준 기본 signal fraction
  - 서버는 이후 자체 sizing/guard를 추가로 적용할 수 있다.

3. Alert 생성 방식
- TradingView에서 `Any alert() function call`
- frequency: `Once Per Bar Close`

이 파일은 `alertcondition()`도 제공하지만, 실제 운영 payload는 `alert()` 경로를 기준으로 본다.

## 2.1 Compile / Import 체크리스트

1. compile 단계에서 `alert()` 사용 오류가 없어야 한다.
2. compile 단계에서 `plotshape text must be const`류 오류가 없어야 한다.
3. alert는 아래 4개 pulse에서만 발생해야 한다.
- `LONG CORE`
- `LONG EARLY`
- `SHORT CORE`
- `SHORT EARLY`
4. `DIAG_C`, 시장 상태 변화, block reason은 외부 alert로 나오면 안 된다.

## 3. 서버 consumer 필수 계약

`/webhook/signal`은 아래 필드를 사실상 요구한다.

1. `exchange`
2. `symbol` 또는 `market` 또는 `ticker`
3. `tf`
4. `bar_close_time_utc_ms`
5. `event`
6. `side`
7. `qtyPct`

부가적으로 중요한 필드:
1. `strategy_id`
2. `action`
3. `event_intent`
4. `features.strategy_id`
5. `features.entry_grade`
6. `features.qty_profile`

## 4. v6.1.1.0 payload 정렬 결과

production candidate는 아래 top-level 키를 보낸다.

1. `exchange`
2. `symbol`
3. `market`
4. `ticker`
5. `tf`
6. `strategy_id`
7. `action = ENTRY`
8. `event_intent = ENTRY`
9. `event = LONG | SHORT`
10. `side = BUY | SELL`
11. `qtyPct`
12. `price`
13. `timeframe`
14. `market_state`
15. `htf_bias`
16. `trigger_type`
17. `risk_mode`
18. `opportunity_score`
19. `rr`
20. `stop_price`
21. `target_price`
22. `bar_close_time_utc_ms`
23. `bar_time`
24. `features`

`features` 내부 키:
1. `strategy_id`
2. `engine_mode`
3. `entry_grade`
4. `qty_profile`
5. `market_state`
6. `htf_bias`
7. `trigger_type`
8. `risk_mode`
9. `opportunity_score`
10. `rr`
11. `stop_price`
12. `target_price`
13. `_event_intent = ENTRY`
14. `signal_family`
15. `source_band`

대표 payload 예시:

```json
{
  "exchange": "BINANCEFUT",
  "symbol": "BTCUSDT",
  "market": "BTCUSDT",
  "ticker": "BTCUSDT",
  "tf": "15",
  "strategy_id": "donbeolja_v6.1.1.0",
  "engine_mode": "CLEAN_REDESIGN",
  "action": "ENTRY",
  "event_intent": "ENTRY",
  "event": "LONG",
  "side": "BUY",
  "direction": "LONG",
  "entry_grade": "CORE",
  "qty_profile": "FIXED",
  "timeframe": "15",
  "market_state": "BULL",
  "htf_bias": "BULL",
  "trigger_type": "BREAKOUT",
  "risk_mode": "NORMAL",
  "qtyPct": 1,
  "price": 100000,
  "opportunity_score": 0.81,
  "rr": 2.2,
  "stop_price": 99000,
  "target_price": 102200,
  "bar_close_time_utc_ms": 1775000000000,
  "bar_time": 1775000000000,
  "features": {
    "strategy_id": "donbeolja_v6.1.1.0",
    "engine_mode": "CLEAN_REDESIGN",
    "entry_grade": "CORE",
    "qty_profile": "FIXED",
    "_event_intent": "ENTRY",
    "signal_family": "LONG",
    "source_band": "CORE"
  }
}
```

## 5. consumer compatibility 판정

현재 consumer 경로 기준으로 다음은 충족한다.

1. `event`
- `LONG / SHORT`
- `canonicalExternalEntryEvent` 및 `resolveEventMapping`과 호환

2. `side`
- `BUY / SELL`
- entry mapping과 호환

3. `entry grade`
- `features.entry_grade`
- `resolveEntryTimingTier()`와 호환

4. `qty profile`
- `features.qty_profile = FIXED`
- live taxonomy와 호환

5. `strategy gate`
- top-level `strategy_id`
- `features.strategy_id`
둘 다 포함되어 strategy gate와 호환

6. `bar close time`
- `bar_close_time_utc_ms = time_close`
- server의 `barCloseMs` 계산 경로와 정렬

7. `event 중복 없음`
- `action = ENTRY`
- `event_intent = ENTRY`
- `event = LONG | SHORT`
- direction event를 `event`에 한 번만 넣는다

## 6. 남은 주의점

1. provider 값은 차트/거래소에 맞게 수동 선택해야 한다.
2. `qtyPct=1.0`은 Pine 기준 기본값이다.
3. 실제 TradingView 컴파일 검증은 아직 안 했다.
4. webhook token / URL은 운영 환경 값으로 따로 넣어야 한다.

## 7. 결론

`v6.1.1.0_TV_IMPORT_FINAL`은 이제

- TradingView에 붙일 수 있는 import 후보이고
- 서버 `/webhook/signal` consumer가 기대하는 필수 필드와도 정렬된 상태다.

즉 현재 기준에서 남은 것은 구조 설계가 아니라 실제 TradingView compile/import 확인이다.
