# 12주 테스트 주차 운영 절차 (코드 기준)

본 문서는 "주차별 데이터 제공 → 신호별 승률/EV 개선 루프"를 매주 반복하기 위한 **코드 기준 운영 절차**를 정의한다.

## 0. 고정 KPI (코드 상 단일 소스)

고정 KPI는 `src/config/frozen.js`에만 존재한다.

- `SCHEMA_VERSION`
- `SIGNAL_EVAL_VERSION`
- `SIGNAL_EVAL_HORIZON_BARS`
- `BAR_INTERVAL_MS_60M`
- `SIGNAL_KPI_MIN_N`, `SIGNAL_KPI_MIN_EVAL_N`
- `SIGNAL_KPI_KEEP_WR`, `SIGNAL_KPI_KEEP_EV`
- `SIGNAL_KPI_DROP_WR`, `SIGNAL_KPI_DROP_EV`
- `SIGNAL_KPI_HARD_STREAK`

`/api/report/pack` 출력 ZIP에 `frozen_kpi.json`으로 포함된다.

## 1. 주차 입력 데이터 (Firestore 컬렉션 단위)

| 구분 | 컬렉션 | 핵심 필드 | 주차 경계 | 비고 |
|---|---|---|---|---|
| 신호 | `signals` | `bar_close_time_utc_ms`, `exchange`, `symbol_or_pair_id`, `tf`, `side`, `event` | `[FROM, TO)` | eval_weekly 및 pack에서 공통 사용 |
| 바 | `bars_snapshots` | docId: `exchange__symbol__tf__ms`, `bar_close_time_utc_ms`, `ohlcv_json.close` | `FROM`~`TO + horizon` | `computeSignalEval`가 close를 추출 |
| 체결/거래 (옵션) | `fills` 또는 `trades` | 프로젝트 스키마에 따라 | `[FROM, TO)` | report pack의 trade KPI에 사용 |

### 시장 범위 (멀티마켓)

- 평가 대상 시장은 아래 순서로 결정된다.
  1) API 입력 `markets: [...]`
  2) 환경변수 `UPBIT_MARKETS=KRW-BTC,KRW-ETH,...`
  3) 환경변수 `UPBIT_MARKET=KRW-BTC`

## 2. 주차 산출물 (매주 고정)

| 산출물 | 생성 경로 | 저장 위치 | 포함 내용 |
|---|---|---|---|
| 주간 평가 | `POST /scheduler/eval-weekly` | `eval_weekly/{week}` | range, summary, per_key_summary, decisions |
| 차단 필터 반영 | `POST /scheduler/filters/drop-sync` | `filters_drop/*` | eval_id=week, mode(SOFT/HARD), streak |
| 리포트 패키지 | `GET /api/report/pack?from&to&mode=weekly&week=...` | HTTP zip | signals_eval, report.json, frozen_kpi.json, eval_weekly.json, filters_drop_*.json |

## 3. 주차 실행 순서 (eval_weekly → filters_drop → signalsQuery → report pack)

### 3.1 eval_weekly

- 엔드포인트: `POST /scheduler/eval-weekly`
- 인증: `x-scheduler-token: $SCHEDULER_TOKEN`
- 입력:
  - `week`(optional)
  - `from`, `to` (ISO)
  - `markets`(optional), `exchange`(optional), `tf`(optional)

### 3.2 filters_drop 반영

- 엔드포인트: `POST /scheduler/filters/drop-sync`
- 입력: `{ "week": "2026W01" }`

### 3.3 signalsQuery 차단 적용

- 적용 위치: `src/storage/signalsQuery.js`
- 기본 동작: `filters_drop.mode === "HARD"`만 차단한다.
- 예외: `DROP_FILTERS_ENFORCE_SOFT=1` 설정 시 SOFT도 차단한다.

### 3.4 report pack 반영

- 엔드포인트: `GET /api/report/pack?from=...&to=...&mode=weekly&week=...`
- ZIP 포함(추가):
  - `frozen_kpi.json`
  - `eval_weekly.json` (week 존재 시)
  - `filters_drop_week.json` (week 존재 시)
  - `filters_drop_current.json`
  - `week_meta.json`

## 4. 코드 기반 자동 실행

- 스크립트: `ops/week_cycle.sh`

예시:

```bash
export BASE_URL=http://localhost:3000
export SCHEDULER_TOKEN=... 
export WEEK=2026W01
export FROM=2026-01-01T00:00:00.000Z
export TO=2026-01-08T00:00:00.000Z
export MARKETS=KRW-BTC,KRW-ETH

bash ops/week_cycle.sh
```
