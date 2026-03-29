# DONBEOLJA Ω Phase0 (12W) 고정 사양

본 문서는 **12주 실험 기간 동안 변경 금지(=비교 가능성 보장)**를 위해 멀티마켓/스키마/KPI를 "기준선"으로 고정한다.

## 1) 멀티마켓 고정

- 대상: **UPBIT 현물, KRW 마켓 여러 종목**
- 설정:
  - `UPBIT_MARKETS=KRW-BTC,KRW-ETH,...` (쉼표 구분)
  - 미설정 시 `UPBIT_MARKET` 1개만 처리
- 스케줄러:
  - `/scheduler/tick` 1회 호출이 `UPBIT_MARKETS` 전 종목을 순차 처리

## 2) 스키마 고정 (Firestore)

### 공통 규칙
- 모든 문서는 `exchange`, `symbol_or_pair_id`, `tf`, `created_at`(ISO) 를 기본 포함
- 시간은 원칙적으로 `*_utc_ms`(정수) + `*_kst_iso`(표준 문자열) 병행

### 컬렉션

| Collection | 목적 | Doc ID 규칙(핵심) |
|---|---|---|
| `bars_snapshots` | 바 스냅샷(60m) | `BAR__{ex}__{sym}__{tf}__{barCloseUtcMs}` |
| `signals` | 신호(외부 웹훅/내부) 원장 | 생성 시점별(중복 방지 로직은 sender에서) |
| `fills_paper` | 체결(fills) 원장 | `FILL__{ex}__{sym}__{tf}__{barCloseUtcMs}__{...}` |
| `trades_paper` | 체결을 trade로 변환 | `TRADE__{ex}__{sym}__{tf}__{tradeId}` |
| `positions_paper` | 현재 포지션 | `POS__{ex}__{sym}__{tf}` |
| `order_intents_paper` | 주문 의도 | `INTENT__{ex}__{sym}__{tf}__{barCloseUtcMs}` |
| `kpi_latest` | 최신 KPI(시장별) | `KPI_LATEST__{ex}__{sym}__{tf}` |
| `kpi_snapshots` | KPI 스냅샷(히스토리) | `KPI__{ex}__{sym}__{tf}__{ts}` |
| `gate_events` | 데이터 품질 게이트 로그 | `GATE__{ex}__{sym}__{tf}__{barKey}` |
| `run_ledger` | 실행 원장(run) | `RUN__{barKey}` |
| `filters_drop` | 드롭 필터(차단 규칙) | `DROP__{ex}__{sym}__{tf}__{side}__{group}__{subtype}` |
| `eval_weekly` | 주간 신호 평가 | `weekly__{YYYY-Www}` |
| `eval_latest` | 최신 평가(요약) | `latest` |

## 3) KPI 고정

### 3.1 Trade KPI(거래 KPI)
- 산출 근거: `fills_paper` → `trades_paper` 변환 후 계산
- 대표 KPI(고정):
  - `win_rate` (승률)
  - `avg_pnl_pct` (평균 손익%)
  - `profit_factor` (이익/손실 비율)
  - `mdd_pct` (Max Drawdown%)
  - `sharpe_like` (단순 샤프 유사치)

### 3.2 Signal KPI(신호 KPI, 승률 개선용)
- 목적: "돈벌자" 신호별 승률/EV 개선을 위한 주간 평가
- 평가 규칙(고정):
  - Timeframe: `60m`
  - Horizon: **3 bars** (기본)
  - 수익률: `ret = (futClose - nowClose)/nowClose`
  - 방향보정: `dir_ret = ret` (BUY), `dir_ret = -ret` (SELL)
  - Win 판정: `dir_ret > 0`
- 집계키(고정):
  - `{exchange}__{symbol}__{tf}__{side}__{group}__{subtype}`

## 4) 드롭 필터 적용 모드(고정)

- `DROP_FILTERS_MODE=record|enforce`
  - `record`(기본): 기록만 하고 **실제 차단 없음**
  - `enforce`: `filters_drop`에 등록된 신호를 실제 차단
- 권장 운영:
  - **1주차: record** (데이터 축적)
  - **2주차부터: enforce** (승률 개선 실험)

## 5) GPT 튜닝용 데이터 팩 고정

- API: `GET /report/pack?mode=weekly&from=YYYY-MM-DD&to=YYYY-MM-DD`
- zip 포함 파일(핵심):
  - `report.json` (fills/trades/KPI summary)
  - `signal_rows.json` (fills 기반 신호 요약)
  - `signals_eval_summary.json` (신호 KPI 요약)
  - `signals_eval_rows.jsonl` (신호별 개별 row: GPT 분석/미세조정 입력용)

