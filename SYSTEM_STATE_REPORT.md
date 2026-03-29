# 시스템 상태 리포트

> 최종 업데이트: 2026-03-28 KST
> 엔진 버전: donbeolja v6.0.3.0
> 전략 ID: donbeolja_v6.0.3.0
> 현재 운영: Binance Futures / 15m / LONG_SHORT_SINGLE / PAPER+LIVE 지원

## 현재 운영 기준

1. 외부 라이브 엔트리: `LONG / SHORT`
2. 현재 라이브 source band: `EARLY / CORE`
3. 현재 라이브 quantity profile: `FIXED`
4. `PRE_REAL / REAL`: legacy/historical diagnostic band only
5. 1차: 무결성 가드
6. 2차: AI usable
7. 3차: 시황 prior / sizing
8. 4차: EV final sizing / kill-switch
9. 5차: WAIT_ONE_BAR timing defer

## 배포 메타

- `DONBEOLJA_STRATEGY_ID=donbeolja_v6.0.3.0`
- `ENGINE_VERSION=6.0.3.0`
- `WEBHOOK_ALLOWED_STRATEGY_IDS`에 `donbeolja_v6.0.3.0` 포함
- 운영 기본 거래소: `BINANCEFUT`
- 운영 기본 타임프레임: `15m`

## 주의

1. TradingView 외부 노출 신호명은 `LONG / SHORT`만 사용한다.
2. 현재 라이브 quantity profile은 `FIXED`다.
3. Pine와 서버 자동화는 BinanceFUT 기준으로 단순화했다.
4. 과거 `UPBIT / KIWOOM / PRE_REAL / REAL` 흔적은 historical compatibility 용도일 수 있으나, 현재 운영 SSOT는 아니다.
5. 참조 없는 연구/백테스트 스크립트와 과거 문서는 `scripts/legacy/`, `docs/legacy/`로 분리한다.
