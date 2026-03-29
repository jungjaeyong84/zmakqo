# Pine `limit 1200` 대응 적용 체크리스트 (2026-02-26)

## 목적
- 오류 의미: 변수 수 한도(1200) 초과 가능성.
- 대응 방식: 전역 계산값 일부를 함수로 전환하고, payload 임시값을 축소.

## TradingView 적용 순서
1. `code/donbeolja.pine.txt` 전체를 복사.
2. TradingView Pine Editor에 붙여넣기.
3. 저장 후 컴파일(차트 적용).
4. 오류가 없으면 알림 1회 테스트 전송.

## 반드시 확인할 항목
- `strategy_id`, `strategy_id_source` 필드가 알림 payload에 포함되는지.
- `trace_payload_version`, `trace_chain_key`, `trace_emit_mode` 유지되는지.
- 실시간 알림(`REALTIME_PRE`)과 종가 알림(`BAR_CLOSE`)이 둘 다 정상 동작하는지.
- 수량 제한 로직이 유지되는지(`0.001` 간격, 최소/최대 방어).
- 종료 정책 기본값이 유지되는지(`tp1=3.0`, `trail=1.0`).

## 실패 시 즉시 대체안
- 대체안 A: payload 생성 함수를 2개(핵심/부가)로 분리해 지역 변수 추가 축소.
- 대체안 B: 디버그/표시 전용 값 중 비필수 필드를 우선 제거.

## 승인/실행 경계
- Pine 반영은 재용이 TradingView에서 직접 수행해야 함. (`[PINE_UPDATE_REQUIRED]`)
- 로컬 터미널에서는 TradingView 컴파일 결과를 직접 확인할 수 없음.
