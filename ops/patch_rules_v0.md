# DONBEOLJA Patch Rules v0 (Candidate Triggers)

입력: /tmp/donbeolja_report.json (pack-token 기반)

목적: 주 1회 “패치 후보”를 생성할 때, 무엇을 ‘이상 징후’로 볼지 고정한다.
주의: 이 파일은 실행 코드가 아니라 규율(문서)이다.

---

## 1) 입력 스키마(최소)
- top: meta, markets_expected, position_snapshot, kpi_summary, fills
- meta.range: from/to/from_ms/to_ms
- kpi_summary: fills_new, sells_new, trades_approx
- fills: (0..N)

---

## 2) Candidate Triggers (v0)

### T1. 시장 누락(관측 결손)
- 조건: markets_expected의 각 market이 position_snapshot에 존재하지 않는다.
- 증거: markets_expected vs position_snapshot[].market diff

### T2. 포지션/바 타임 불일치(시계 흔들림)
- 조건: position_snapshot[].bar_close_time_utc_ms가 market별로 크게 벌어진다.
- 증거: max(bar_close_ms) - min(bar_close_ms) > 1 interval

### T3. 거래 표본 부족 지속(KPI INCONCLUSIVE 고착)
- 조건: kpi_summary.trades_approx가 0에 수렴하거나 매우 낮다.
- 증거: trades_approx 값, 기간(range)

### T4. fills 신호 모델 불일치(체결 모델 흔들림)
- 조건: fills[].exec_price_source가 기대 값(BAR_OPEN) 외 값으로 등장한다.
- 증거: fills[].exec_price_source 분포

### T5. SELL만 존재(비정상 편향)
- 조건: fills_new > 0인데 fills 배열이 SELL만으로 구성된다.
- 증거: fills[].side 분포

---

## 3) Patch Candidate Output (v0)
- (a) trigger_id: T1..T5
- (b) evidence: report.json에서 발췌한 최소 필드
- (c) hypothesis: 트리거가 의미하는 구조적 가능성 1문장
- (d) proposed_patch: 수정 대상 파일/함수 후보 1개
- (e) rollback_condition: 원복 조건 1개(측정값 기준)

