# V3 Paper Bootstrap

`v3`는 `v1`, `v2`를 참고만 하고 코드는 공유하지 않는 `paper-only` 독립 정책선으로 시작한다.

목표는 세 가지다.

1. 실행 경로를 단순화한다.
2. current full-evidence sample 기준으로 승률을 먼저 올린다.
3. 검증 전에는 live exchange write를 열지 않는다.

## Phase 1 원칙

- exact allowlist만 허용
- `PULLBACK_RECLAIM` 전면 비활성화
- `LONG/SHORT` 둘 다 active
- raw signal은 exact ingress profile matcher로만 통과

허용 코호트:

1. `ACTIVE` `LONG | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE`
2. `ACTIVE` `LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE`
3. `ACTIVE` `SHORT | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE`
4. `ACTIVE` `LONG | BREAKOUT_RETEST | RANGE | MARGINAL_EDGE | EARLY`
5. `ACTIVE` `LONG | BREAKOUT_RETEST | TRANSITION | BUILDABLE_EDGE | EARLY`
6. `ACTIVE` `LONG | MOMENTUM_CONTINUATION | TREND | BUILDABLE_EDGE | CORE`
7. `ACTIVE` `LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | EARLY`

## 무엇을 살리고 무엇을 버리나

참고만 하는 것:

- 기존 outcome history
- 기존 evidence lineage가 남긴 관측 필드
- 현재 live-paper 운영 계약에서 확인된 실패 원인

버리는 것:

- reclaim/probe 계열 확장
- 복잡한 shadow candidate를 진입 게이트로 직접 연결하는 구조
- broad heuristic short 허용

## 구현 경로

`src/v3`는 `src/v1`, `src/v2`를 import 하지 않는다.

- `paperPolicy.js`
  - exact allowlist
- `paperBootstrap.js`
  - raw adjudication rows를 v3 자체 규칙으로 정규화하고 시뮬레이션
- `report-v3-paper-bootstrap.js`
  - 최신 bootstrap artifact 생성
- `signalPolicy.js`
  - v3 raw signal을 정책 입력으로 정규화
  - `BREAKDOWN -> BREAKOUT_RETEST`, `LOSS -> PULLBACK_RECLAIM`
  - exact raw ingress profile과 active cohort를 1:1 매칭
- `rawSignalGenerator.js`
  - public Binance Futures `15m/1h kline + bookTicker + premiumIndex`만 읽는 v3 전용 raw signal generator
  - 15m/1h market snapshot에서 exact active profile 후보만 생성
- `sourceFeed.js`
  - v3 local raw signal feed JSONL + checkpoint helper
- `localPaperLane.js`
  - local raw signal feed를 읽어 v3 candidate queue를 생성
- `localPaperEntryLedger.js`
  - queue를 append-only local entry ledger로 변환
- `localPaperExitLedger.js`
  - local entry ledger와 public Binance 1m kline path로 TP/SL close를 판정
- `performanceReport.js`
  - entry/exit ledger만 읽어 v3 전용 일간 성과를 계산
- `bootstrapLiveSeed.js`
  - v3 entry/exit ledger를 live bootstrap seed row로 정규화
  - static imported seed와 다른 단위를 직접 섞지 않도록 fixed risk-unit 기반 pseudo pnl을 생성
- `validationReport.js`
  - bootstrap + closed paper sample로 표본 충분성/안정성 게이트를 계산
- `controlPlane.js`
  - v3 artifact만 읽는 독립 local control snapshot builder
- `run-v3-local-server.js`
  - `server.js`를 거치지 않는 v3 전용 로컬 HTTP 서버

## 해석

이 phase는 `v3 실거래`가 아니다.

이 phase는:

1. `v3 policy`가 지금 표본에서 실제로 win-rate / expectancy를 개선하는지 확인하고
2. 개선이 확인되면 그다음에만 별도 `v3 runtime lane`을 붙이는 단계다.

현재 기본 bootstrap 목표는:

- no-reclaim exact allowlist
- retained sample `49+`
- retained win rate `55%+`
- positive expectancy

## 로컬 런타임

`v3`는 Cloud Run 없이 로컬 launchd만으로 돈다.

순서:

1. `run-v3-source-generator.js`
   - public Binance Futures 15m/1h kline + bookTicker + premiumIndex를 읽어 exact active profile 후보만 생성
   - `ops/runtime/v3_raw_signal_feed.jsonl`에 append
2. `run-v3-paper-lane.js`
   - `ops/runtime/v3_raw_signal_feed.jsonl`만 읽음
   - `ops/runtime/v3_paper_candidate_queue.jsonl`에 append
3. `run-v3-paper-entry-ledger.js`
   - candidate queue를 `ops/runtime/v3_paper_entry_ledger.jsonl`로 append
4. `run-v3-paper-exit-ledger.js`
   - open entry를 읽고 public Binance Futures 1m kline high/low path로 TP/SL 여부 판정
   - `ops/runtime/v3_paper_exit_ledger.jsonl`로 append
5. `report-v3-paper-performance.js`
   - `entry_ledger + exit_ledger`만 읽어 `ops/daily/v3_paper_performance_latest.json` 생성
6. `report-v3-bootstrap-live-seed.js`
   - `entry_ledger + exit_ledger + raw_signal_feed + static bootstrap seed`를 읽어
   - `ops/runtime/v3_bootstrap_live_seed.jsonl` 생성
   - `ops/daily/v3_bootstrap_live_seed_latest.json` 생성
7. `report-v3-paper-bootstrap.js`
   - static imported seed + live v3 seed를 합쳐 `ops/daily/v3_paper_bootstrap_latest.json` 생성
8. `report-v3-paper-validation.js`
   - bootstrap + paper closed trade 기준으로 `ops/daily/v3_paper_validation_latest.json` 생성
   - `ops/runtime/v3_paper_validation_history.jsonl`에 누적 기록
9. `run-v3-local-server.js`
   - `ops/daily`의 v3 artifact만 읽어 `/health`, `/api/v3/status`를 제공
   - `v1/v2` route/module을 import 하지 않음

이 7개는 모두 append-only JSONL 또는 그 JSONL 기반 artifact만 사용한다.

## 자동실행 복구

- launchd label: `com.jeongjaeyong.donbeolja.v3paper`
- runner: `ops/launchd/v3/run_v3_paper_cycle.sh`
- interval: `180s`
- cycle order:
  1. `run-v3-source-generator.js`
  2. `run-v3-paper-lane.js`
  3. `run-v3-paper-entry-ledger.js`
  4. `run-v3-paper-exit-ledger.js`
  5. `report-v3-paper-performance.js`
  6. `report-v3-bootstrap-live-seed.js`
  7. `report-v3-paper-bootstrap.js`
  8. `report-v3-paper-validation.js`
  9. `report-v3-openclaw-learning-state.js`

별도 local control server:

- launchd label: `com.jeongjaeyong.donbeolja.v3server`
- runner: `ops/launchd/v3/run_v3_server.sh`
- port: `127.0.0.1:3000`
- endpoints:
  - `/health`
  - `/api/v3/status`
  - `/api/v3/bootstrap`
  - `/api/v3/lane`
  - `/api/v3/performance`
  - `/api/v3/validation`

관리 명령:

- 설치/시작: `zsh scripts/manage-v3-paper-launchd.sh install`
- 상태 확인: `zsh scripts/manage-v3-paper-launchd.sh status`
- 1회 수동 실행: `zsh scripts/manage-v3-paper-launchd.sh run-once`
- 중지/삭제: `zsh scripts/manage-v3-paper-launchd.sh uninstall`
