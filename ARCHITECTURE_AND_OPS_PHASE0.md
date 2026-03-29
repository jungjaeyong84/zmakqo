# ARCHITECTURE & OPS — Phase0 (PAPER)

## 0. 개발 SSOT
- tier 관련 모든 개발은 아래 문서를 기본 참조로 삼는다.
- SSOT:
  - [/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_TIER_DEFINITION.md](/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_TIER_DEFINITION.md)
- 적용 범위:
  - PineScript 수정
  - 서버 엔진 수정
  - EV / add / reverse / alert / UI tier 문구 수정
- 원칙:
  - EARLY / CORE / PRE_REAL / REAL 의미를 이 문서와 다르게 해석하지 않는다.
  - tier 의미를 바꾸는 수정은 명시적 설계 변경으로 취급한다.

## 1. 시스템 개요
- 대상: Upbit Spot / Long-only / PAPER
- 목적: 데이터 수집 → 신호 검증 → 체결 시뮬 → KPI → 리포트 → 패치 제안
- LIVE 자금 영향: 없음

### 데이터 흐름
Webhook Signal
 → signals
 → scheduler/tick
 → intents
 → fills_paper
 → positions_paper
 → kpi_latest
 → report(pack-token)
 → patch-suggest

---

## 2. 핵심 정책

### Overall Gate v2
- RED / FAIL → EXIT_ONLY
- YELLOW / WARN → EXIT_ONLY
- INCONCLUSIVE → **RUNNING 허용**
- GREEN / PASS → RUNNING

목적: 표본 축적 단계에서 BUY 영구 차단 방지

---

### Idempotency
- 기본: 동일 bar 재처리 차단
- 예외: `ALLOW_REPLAY_SAME_BAR=1`

---

### Bar Close 정렬 정책 (v1.1)
- 기준: markets_expected 중 **공통 reference bar**
- 출력:
  - bar_close_time_utc_ms: reference
  - stale_ms: (reference - 실제 bar)

의미:
- 비교는 동일 시간축
- 신선도는 stale_ms로 판단

---

## 3. 운영 자동화 (Cloud Scheduler)

### Hourly
- `/scheduler/kpi-batch`
- KPI_LATEST 갱신

### Weekly
- `/api/report/pack-token?mode=weekly`
- `/scheduler/patch-suggest`

---

## 4. 리포트 계약 (report.json)

필수 키:
- meta
- markets_expected
- position_snapshot
- kpi_summary
- fills

position_snapshot:
- market
- last_close
- bar_close_time_utc_ms
- stale_ms

---

## 5. 패치 루프

Trigger (T1~T5)
 → Gate(적합성/영향/안전)
 → PATCH_PROPOSAL
 → 승인
 → 단일 커밋
 → 태그: patch-YYYYWW-Tx

현재 상태:
- candidates_count = 0
- 안정 구간

---

## 6. 관찰 포인트
- weekly patch-suggest 결과
- kpi_latest.status 변화
- stale_ms 급증 여부
