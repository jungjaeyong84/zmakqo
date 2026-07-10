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

## 포트폴리오 리스크 통제 (2026-06-19, live-readiness 선행조건)

v3 숏 엔진은 시장 전체 하락 한 번에 상관 SHORT를 최대 ~19개 동시 발사한다
(크립토 심볼 상관 0.7~0.9). symbol+side 잠금만으로는 실노출이 안 묶이므로
`localPaperEntryLedger`에 3중 통제를 추가했다. 전부 env 오버라이드 가능:

| Env | 기본값 | 의미 | blocked reason |
|---|---|---|---|
| `V3_MAX_OPEN_TOTAL` | `6` | 전체 동시 오픈 상한 | `V3_LEDGER_MAX_OPEN_TOTAL` |
| `V3_MAX_OPEN_PER_SIDE` | `5` | 방향별 동시 오픈 상한 (상관 클러스터 방어) | `V3_LEDGER_MAX_OPEN_PER_SIDE` |
| `V3_DAILY_DRAWDOWN_KILL_R` | `-5` | 당일 실현 R이 이 값 이하면 신규 진입 전면 정지 (0=비활성) | `V3_LEDGER_DAILY_DRAWDOWN_KILL` |

- kill 스위치는 **실현 R만** 본다 (오픈 포지션 미실현은 제외). UTC 일 단위.
- 통제 상태는 entry-ledger 리포트의 `risk_controls` 필드 + 사이클 로그의
  `risk_blocked`로 관측된다 (`open_long_n`, `open_short_n`, `kill_switch_active`,
  `today_realized_r`).
- 페이퍼에서 먼저 검증한 뒤 동일 파라미터를 라이브로 가져간다 — 이게
  라이브 진입 순서의 1단계. 통제가 페이퍼 성과를 어떻게 바꾸는지(상관
  클러스터 거래 수 감소)는 다음 부트스트랩 라운드에서 측정.
- 테스트: `src/tests/v3-entry-risk-controls.test.js`

허용 코호트 (`V3_PAPER_BOOTSTRAP_2026_05_16_V3`, phase `PHASE_1B_PRUNED_BUILDABLE_AND_RANGE`):

1. `ACTIVE` `LONG | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE`
2. `ACTIVE` `LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE`
3. `ACTIVE` `SHORT | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE`
4. `SHADOW` `LONG | BREAKOUT_RETEST | RANGE | MARGINAL_EDGE | EARLY`
5. `SHADOW` `LONG | MOMENTUM_CONTINUATION | TREND | BUILDABLE_EDGE | CORE`
6. `ACTIVE` `LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | EARLY`

### 2026-05-16 phase 1B 가지치기 근거

`ops/daily/v3_paper_bootstrap_latest.json` 의 `retained_live_metrics_r` 기준:

| Cohort | n (R) | WR | Exp | Net | 처리 |
|---|---|---|---|---|---|
| `LONG_BR_TRANSITION_BUILDABLE_EARLY` | 36 | 38.9% | -0.008R | -0.30R | **완전 제거** (signalPolicy 도 함께) |
| `LONG_MC_TREND_BUILDABLE_CORE` | 8 | 37.5% | -0.044R | -0.35R | `SHADOW` (회복 관찰) |
| `LONG_BR_RANGE_MARGINAL_EARLY` | 2 | 0% | -1R | -2R | `SHADOW` (표본 부족) |

`SHADOW` 코호트는:
- `V3_SIGNAL_ACTIVE_PROFILES` 에 그대로 두어 raw signal 은 계속 생성되고 카운트됨
- `evaluateV3PaperPolicy` 가 `ok:false, reason:"V3_PAPER_COHORT_SHADOWED", apply_mode:"SHADOW"` 를 돌려보내므로 entry 는 만들어지지 않음
- 다음 부트스트랩 라운드에서 `removed_reason_counts.V3_PAPER_COHORT_SHADOWED` 로 보임 → 같은 시장 조건에서 라이브 수치가 회복되는지 평가 후 `ACTIVE` 복귀 또는 완전 제거 결정

### 2026-05-30 take-profit 비대칭 (RR) + phase 2 LONG 엣지 조사

**SHORT take-profit 단축 (RR 1.55 → 1.2)** — `scripts/analyze-v3-rr-sweep.js` 가
296개 closed paper trade 를 실제 Binance 1m 경로로 replay 한 결과:

| Side | RR | WR | Exp | 결정 |
|---|---|---|---|---|
| SHORT | 1.55 → **1.2** | 45.8% → **53.6%** | +0.167R → **+0.180R** | 단축 (WR·exp·net 모두 개선) |
| LONG | **1.55 유지** | 43.1% | +0.098R | 유지 (모든 RR 에서 WR≥50%+수익 동시 불가) |

LONG/SHORT 는 정반대 target 거리를 원함 — 약세장에서 SHORT 는 빠르게 목표 도달,
LONG 은 발전할 공간 필요. side 별 RR 은 env (`V3_RAW_RR_SHORT`/`V3_RAW_RR_LONG`)
로 오버라이드 가능. SHORT 프로파일의 `min.rr` floor 는 1.4 → 1.15 로 함께 낮춤.

**phase 2 — LONG 엣지 조사 (4가지 방법, 모두 무엣지 확정)**:
1. 진입 feature 판별: out-of-sample 상관 0 (`scripts/analyze-v3-winrate-levers.js`)
2. RR sweep: WR≥50% + 수익 동시 만족하는 RR 없음
3. exit 오버레이 (breakeven/partial, `scripts/analyze-v3-exit-overlay.js`):
   50% 찍는 유일한 변형이 expectancy 붕괴(+0.029R) + TEST 음수 → metric gaming
4. 심볼 단위 train/test: **양쪽 양수인 LONG 심볼 0개**. 과거 LONG 수익은
   INJUSDT 단일 심볼의 train 구간 아티팩트(TR +1.37R → TE -0.15R)였음

**운영자 결정 (2026-05-30)**: 위 증거(현재 out-of-sample LONG ≈ -0.2R 손실)
에도 불구하고 LONG 은 **ACTIVE 유지** — BULL 레짐 복귀 시 회복 가능성에 베팅.
LONG 을 SHADOW 로 강등하거나 SHORT 에 partial-TP 오버레이(WR 60%, exp 반감)를
거는 옵션은 모두 거부됨. 이 결정은 의도된 것이며 "손실 LONG 방치 버그"가 아님.

### 2026-07-05 대칭 entry-quality 필터

**운영자 원칙: LONG/SHORT 를 차별하는 정책 금지** — 같은 규칙·같은 임계값을
양쪽에 동일 적용한다. post-RR 시대(n=498) train/test 검증
(`scripts/analyze-v3-wr-levers-round2.js`)에서 양쪽 모두 독립적으로 개선이
확인된 두 필터를 entry-ledger admit 단계에 추가:

| Env | 기본값 | 규칙 (양쪽 동일) | blocked reason |
|---|---|---|---|
| `V3_ENTRY_MIN_FUNDING` | `0` | 진입 시 funding_rate ≥ 임계값 | `V3_LEDGER_FUNDING_BELOW_MIN` |
| `V3_ENTRY_SYMBOL_DENYLIST` | `INJUSDT` | 심볼 양방향 전면 차단 | `V3_LEDGER_SYMBOL_DENYLISTED` |

근거 (era, TRAIN/TEST 양쪽 유지 확인):
- funding ≥ 0: LONG WR 31.4→46.6%, SHORT WR 53.2→59.5% — **양쪽 다 개선**
- INJUSDT: SHORT 쪽 robust drag (TR -0.15 / TE -0.49), LONG 엣지는 이미
  out-of-sample 붕괴 → 대칭 원칙에 따라 양방향 금지
- 합산: era 52.0→55.3% WR, exp +0.187→+0.280R,
  **라이브 비용 차감 exp +0.067→+0.160R (2.4배)**
- 비용: 거래량 약 -47% (잘린 묶음은 ~손익분기 +0.08R)

기각된 후보 (정직 기록): mid-spread SHORT 음수는 비단조(우연 셀), 시간대
필터는 40셀 다중검정 대비 증거 부족 — 관측만. 신호 생성은 그대로 두고
진입만 차단하므로(SHADOW 방식) 차단 코호트의 회복 여부는 계속 관측된다.

### 2026-07-10 비용 모델 + net-R 게이트 전환

**발단**: 누적 +135R(gross)의 출처를 주별로 분해하니 상위 3주(W20/W23/W26)가
+155R, **나머지 432건 합계 -19R** — 엣지가 폭락/고변동 주간에 전부 몰려 있고
평상시엔 잃는 구조. 게다가 수수료·슬리피지가 R 계산에 아예 없어서
(진입-손절 중앙값 1.86% 폭 기준 왕복 ~0.075R/거래) 실전 기준으로는
평상시 구간이 확정 마이너스였다.

**측정 수정 (출시)**:

| Env | 기본값 | 의미 |
|---|---|---|
| `V3_COST_ROUND_TRIP_FEE_PCT` | `0.10` | 시장가 왕복 수수료 % (taker 0.05×2) |
| `V3_COST_ROUND_TRIP_SLIPPAGE_PCT` | `0.04` | 왕복 슬리피지 % 가정 (0.02×2) |

- exit-ledger가 청산마다 `cost_r`(해당 거래의 리스크 폭으로 환산)과
  `realized_r_net`을 기록한다.
- validation 게이트의 모든 paper 지표(품질 + rolling 윈도우)는
  **`realized_r_net` 기준**(`paper_gate.metric_basis: NET_OF_COSTS`).
  비용 필드가 없는 레거시 행은 자기 signal/stop 가격으로 동일 모델을
  소급 적용. gross 지표는 `gross_*` 필드로 병기.
- expectancy 플로어 0.15R(gross, ~0.12R 라이브 비용 버퍼 내장)는 비용이
  지표 안으로 들어왔으므로 이중계산 — **net 0.05R로 조정**
  (`V3_PAPER_VALIDATION_MIN_PAPER_EXPECTANCY_R`).

**자기자본곡선 상태 (관찰 전용, 차단 아님)**:

직전 20건 청산 net R 합의 부호(`V3_EQUITY_CURVE_WINDOW`, 기본 20)를
entry admit 시 `equity_curve_state`(ON/OFF)로 스탬프하고 exit 행까지
전달한다. 전체 원장 walk-forward에서 ON +0.224R / OFF -0.064R(net)로
강력해 보이지만, **시간순 70/30 분할에서 window=20만 간신히 생존(+0.046R)
하고 10/30은 음수로 뒤집혔다** — 인접 파라미터가 죽는 단독 생존은 우연일
가능성이 높아 차단 필터로는 기각. validation 리포트의
`equity_curve_observation`으로 전방 증거를 누적해 분할이 계속 성립할 때만
승격한다.

**함께 기각 (정직 기록)**: BTC 3일 변동성 분위, BTC 7일 추세 강도/정렬 —
전부 train/test에서 부호가 뒤집힘(우연 셀). "이긴 주간"을 외생 변수로
식별하려는 시도는 현재 데이터로는 실패.

- 테스트: `src/tests/v3-cost-model-and-equity-curve.test.js`

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

현재 기본 bootstrap 게이트는 (2026-06-25 수익성 게이트, env 오버라이드 가능):

- no-reclaim exact allowlist
- retained sample `50+`
- win rate `≥ 48%` (`V3_GATE_MIN_WR_PCT`) — RR-aware 손익분기(~43.4%) 위, 도달 가능 CI 내
- expectancy `≥ +0.15R` (`V3_GATE_MIN_EXPECTANCY_R`) — 라이브 비용 ~0.12R 버퍼
- profit factor `≥ 1.30` (`V3_GATE_MIN_PROFIT_FACTOR`)

> **왜 55%를 버렸나** (2026-06-25): 구 게이트의 `retained win rate 55%+` 는
> 통계 근거 없는 하드코딩이었다. n=710에서 참 WR의 95% CI는 [46.3%, 53.7%]로
> 55%는 상한 밖 = 구조적으로 도달 불가. 게다가 RR을 무시했다 — SHORT는 RR 1.2라
> 손익분기 45.5%, LONG은 39.2%, 블렌드 ~43.4%인데 50% WR이면 이미 +6.6%p 위다.
> 새 게이트는 단일 WR 대신 "손익분기 위 + 양의 expectancy(비용 버퍼) + PF" 를
> 보므로 더 엄격하다 (48%/-0.05R/PF0.9 전략은 셋 다 탈락). 근거:
> `scripts/analyze-v3-rr-sweep.js`, `scripts/analyze-v3-winrate-levers.js`.

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
