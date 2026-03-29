# Legacy Scripts

이 디렉터리는 현재 BinanceFUT 라이브 운영 체인에 직접 연결되지 않은 연구/백테스트/과거 백필 스크립트를 분리 보관한다.

원칙
- `scripts/` 루트에는 현재 운영 자동화나 주기 실행에 직접 연결된 스크립트만 남긴다.
- `scripts/legacy/research/`는 과거 전략 탐색/진단용 스크립트다.
- `scripts/legacy/backtest/`는 과거 이벤트/tier 전제를 쓰는 백테스트 스크립트다.
- `scripts/legacy/backfill/`는 현재 Binance-only 운영과 무관한 과거 백필 스크립트다.

주의
- 이 영역의 스크립트는 `UPBIT`, `KIWOOM`, `PRE_REAL`, `REAL` 같은 과거 모델을 포함할 수 있다.
- 운영 자동화에 다시 연결하기 전에는 active runtime 경로에 재도입하지 않는다.
