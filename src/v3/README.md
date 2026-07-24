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

### 2026-07-15 마이크로-라이브 실행 레이어 (증분 1)

READY_FOR_RUNTIME_LANE_REVIEW 도달(2026-07-15)에 따른 다음 단계. **판정은
분할**: 실행 레이어 구축은 GO, 실제 자금 투입은 조건부 NO —
**자금 투입 기준: 실행 레이어 완성 시점에 post-filter 표본 n≥180 이고
비용 차감 expectancy > 0** (7/15 시점 post-filter n=96, +0.080R gross 로
비용 차감 시 음수 — 미충족).

구성:
- `src/v3/liveExecutor.js` — 순수 결정 로직. **paper entry ledger 가 유일한
  admission authority** — 거기 admit 된 signal_id 만 라이브 주문 후보가
  되므로 paper↔live 가 1:1 비교됨 (슬리피지/수수료 실측이 목적).
- `scripts/run-v3-live-executor.js` — 러너. 시장가 진입 → STOP_MARKET +
  TAKE_PROFIT_MARKET (closePosition) 브래킷. 브래킷이 거래소에 있으므로
  로컬 머신이 죽어도 exit 은 강제됨.
- transport 는 purge 에서 살아남은 `src/exchanges/binanceFuturesPrivate.js`
  재사용 (서명·재시도·정밀도 완비, 자체 테스트 그린).

안전 모델 (겹겹이, 기본값 = 전부 안전):
| 장치 | 기본값 |
|---|---|
| `V3_LIVE_ENABLED` | `0` (꺼짐) |
| `V3_LIVE_DRY_RUN` | `1` (켜도 주문 안 나감, 로그만) |
| `V3_LIVE_NOTIONAL_USDT` | `10` — **코드 상수 hard cap 20 USDT** 로 클램프 (env 로 올릴 수 없음; 캡 상향 = 코드 리뷰 = 자금 기준 충족 확인) |
| `V3_LIVE_LEVERAGE` | `1` (최대 3 클램프) |
| freshness | 10분보다 오래된 entry 는 실행 불가 → 냉시작이 원장 히스토리를 재생할 수 없음 (실측: 902건 전부 ENTRY_TOO_OLD) |
| 라이브 caps/kill | paper 와 동일 env (`V3_MAX_OPEN_*`, `V3_DAILY_DRAWDOWN_KILL_R`) 를 라이브 원장에 독립 적용 |
| dedup | signal_id 당 1회 (dry-run 행은 라이브 노출로 계산 안 함) |
| hedge 모드 | 감지 시 중단 (closePosition 시맨틱은 one-way 전용) |

단계별 롤아웃:
1. **지금**: `V3_LIVE_ENABLED=0` — 아무 일도 안 일어남 (검증 완료)
2. **dry-run**: `V3_LIVE_ENABLED=1` 만 — 주문 없이 intent 로그 축적
3. **testnet**: `BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com`
   + testnet 키 + `V3_LIVE_DRY_RUN=0` — 실제 주문 흐름 검증, 돈 0
4. **micro-live**: 자금 기준 (n≥180 & cost-adj exp>0) 충족 시에만 실키 +
   실주소로 전환

⚠️ 운영 주의: 구 Binance API 키가 GCP NAT IP 에 allowlist 되어 있었다면
그 IP 는 2026-07-02 에 해제됨 — 라이브 전에 키의 IP 제한을 이 머신
기준으로 갱신해야 함. 키는 `V3_LIVE_BINANCE_API_KEY/SECRET` (신규 이름,
기존 env 와 충돌 없음).

**증분 2 (2026-07-15 완료)** — exit 동기화 + 실측 리포트 + launchd 배선:
- `src/v3/liveExitSync.js` — 순수 로직: 브래킷 체결 판정(양쪽 체결 anomaly
  포함), userTrades 수수료 집계(비-USDT 커미션은 별도 표기), **실현 R·
  슬리피지·수수료를 R 단위로 실측** (부호 규약: 양수 = 유리). dry-run 행은
  같은 signal_id 의 paper exit 를 미러링(슬리피지·수수료 0) → 파이프라인
  전체를 주문 0 으로 상시 검증.
- `scripts/run-v3-live-exit-sync.js` — 실 포지션: 브래킷 조회 → 체결 기록
  (실제 평균가+수수료) → 생존 sibling 레그 정밀 취소(orderId 지정).
- `scripts/report-v3-live-vs-paper.js` — signal_id 조인으로
  `measured_cost_r_per_trade` 산출 (`ops/daily/v3_live_vs_paper_latest.json`).
  **풀 라이브 결정은 가정치 ~0.12R 대신 이 실측치를 사용한다.**
- launchd: `com.jeongjaeyong.donbeolja.v3livecycle` (180s, executor →
  exit-sync → report). `.env` 에 `V3_LIVE_ENABLED` 없으면 완전 inert —
  롤아웃 단계 전환은 코드/launchd 변경 없이 `.env` 편집만으로 진행.

### 2026-07-16 생존 강화 (survival hardening) — 5종 세트

"침묵이 죽음과 구별되지 않는" 구멍들을 메운 세트. 공통 기반:
`liveLedgerView.latestRowsBySignalId` (append-only 원장에서 **signal_id 당
최신 행이 authoritative** — 수리 행이 원본을 대체) +
`opsAlert` (상태전이 알림, 6h 재알림, 회복 통지; `V3_OPS_ALERT_CHANNEL` →
`EXIT_INTEGRITY_ALERT_CHANNEL` → `telegram:$TELEGRAM_CHAT_ID` 순 해석).

| # | 장치 | 위치 | 동작 |
|---|---|---|---|
| 1 | **데드맨** | `deadmanCheck.js` + launchd `v3deadman` (600s) | 아티팩트 나이로 파이프라인 심박 판정 (paper 15분 / live 15분 / readiness watch 26h). 정지→알림, 회복→통지. **한계: 같은 머신이라 머신 전체 사망은 못 잡음 (외부 관찰자 필요, 명시적 미해결)** |
| 2 | **브래킷 수리** | `liveBracketRepair.js` + exit-sync 통합 | `OPEN_BRACKET_INCOMPLETE` 발견 시: 포지션 플랫→EXTERNAL_OR_UNFILLED 기록(수동검토 플래그), 레그 죽음→**원래 paper 레벨로만** 재설치(재가격 금지), 체결된 exit 레그+포지션 공존→ANOMALY(자동수리 금지, 즉시 알림) |
| 3 | **원장 백업** | `run-v3-ledger-backup.js` + launchd `v3backup` (일 03:47) | ops/runtime *.jsonl 전부 + *_latest.json → tar.gz + sha256 manifest, 보존 14개. **iCloud Drive 자동감지 미러** (`V3_BACKUP_EXTRA_DIR` 로 재지정 가능) — 디스크 사망 보호. tar 는 `-T` 파일리스트 (30k+ 파일 ARG_MAX 회피) |
| 4 | **출혈 차단기** | executor 내장 | 최근 `V3_LIVE_BLEED_WINDOW_N`(30) 실거래 expectancy < `V3_LIVE_BLEED_MIN_EXP_R`(-0.15R) → 신규 진입 전면 정지. **래칭**: 정지 중엔 창이 안 바뀌므로 자연 래치 — 해제는 수동 검토 후 `V3_LIVE_BLEED_OVERRIDE=1` 또는 원장 정리. daily kill(자정 리셋)이 못 잡는 만성 출혈용 |
| 5 | **정합성** | `liveReconcile.js` + live cycle 스텝 | 거래소↔원장: GHOST_POSITION(원장 모르는 포지션; dry-run 중엔 "계좌=플랫" 불변식) / MISSING_POSITION(grace 10분 초과) / QTY_MISMATCH(5% 허용) — 발견 시 알림(시그니처 dedup) |

감사에서 발견·수정된 부수 사항: `num(null)→0` 강제변환(별도 커밋),
tar E2BIG(ops/daily 30k 스냅샷), 좀비 launchd
`v3openclawlearningstate`(러너 삭제 후 plist 잔존, exit 78 반복 — 제거;
동일 작업은 paper cycle 9단계가 수행).

테스트: `src/tests/v3-survival-hardening.test.js` (latest-wins, 차단기
래치/오버라이드/경계값, 수리 결정표, 정합 분류, 데드맨 판정, 알림 dedup).

### 2026-07-24 전략 재판단 — "상시 돈 인쇄기는 없다" 확정과 2정 체제

**측정으로 닫은 경로들** (`scripts/analyze-v3-daily-regime-gate.js`,
`scripts/analyze-v3-htf-momentum.js`):
- 일봉 레짐 정렬 게이트: 3정의 모두에서 "버린 묶음"이 양수 — 7월 출혈의
  원인이 아님. 최선 +0.03R gross 개선뿐 → 채택 안 함.
- 일봉 TSMOM (14/30/90d, 11심볼, 2.7년, 플립시 비용): **3개 lookback 전부
  최근 16개월 음수** (-6~-15%/yr), B&H(+11%)도 못 이김 → v4 일봉 레인
  안 지음. (진입 feature·RR·exit 오버레이에 이은 4번째 독립 부정 결과)

**살아있는 구조** — 평소엔 잠자고 자기 엣지가 실측될 때만 깨어나는 2정:
1. **v3 = 약세장 전문가** (paper 대기, READY 감시 중)
2. **funding 하베스터 후보** = `fundingMonitor.js` + launchd `v3funding`
   (시간당): 6심볼 trailing 7일 funding APY 감시,
   `V3_FUNDING_ALERT_APY_PCT`(기본 15%) 초과가 **지속**되면(커버리지 가드:
   윈도우당 이벤트 ≥ 2.5/일 — 데이터 공백이 연환산 스파이크를 못 만들게)
   텔레그램. 실측(7/24): BTC 5.1% / BNB 5.6% / 나머지 ≤3% — 차가움, 대기.
   델타중립 실행 레이어는 **첫 실제 알림이 트리거** (엣지 관측 전 실행부터
   짓지 않는다는 v3 교훈). 자본이 작으면 푼돈임을 명시.

**비용 공학 (결정론적 개선)**: 진입을 maker-first로 —
`pickMakerPrice`(패시브 사이드 합류) + GTX(post-only) 지정가 →
`V3_LIVE_MAKER_WAIT_MS`(기본 5s) 대기 → 미체결 시 시장가 폴백.
부분체결은 체결분만 유지(브래킷이 closePosition이라 안전측).
`entry_fill_mode`(MAKER/MAKER_PARTIAL/TAKER)를 원장에 기록해 실제 maker
체결률을 micro-live가 실측. taker 0.05%→maker 0.02%: 왕복 비용
~0.115R→~0.09R (+BNB 수수료 할인 10%는 운영자 계정 설정 — 켜면 ~0.08R).
`V3_LIVE_MAKER_FIRST=0`으로 비활성 가능.

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
