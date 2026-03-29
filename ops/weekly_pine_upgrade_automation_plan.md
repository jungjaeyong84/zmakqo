# Weekly Pine Upgrade Automation Plan

## 목적
- 매주 일요일 아침 자동으로 개선팩을 수집하고 분석한다.
- 직전 주 변경이 실제로 `win_rate`, `EV`, `net` 개선에 기여했는지 검증한다.
- 안전한 주간 패치가 있을 때만 새 버전 Pine 파일을 생성한다.
- 생성 결과와 분석 요약을 텔레그램으로 통지한다.
- 주간 추적뿐 아니라 월간 누적 추세도 함께 관리한다.

## 범위
- 대상 전략 파일:
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja.pine.txt`
- 분석 입력:
  - 개선팩 ZIP 내부 `meta/`, `config/`, `data/`, `analysis/`, `qa/`, `cases/`
- 출력:
  - 주간 보고서
  - 월간 요약 보고서
  - 주간/월간 히스토리 JSON
  - 새 버전 Pine 파일
- 제외:
  - Cloud Run 배포
  - TradingView 직접 반영
  - 운영 설정 자동 변경

## 핵심 원칙
1. 외부 데이터 사용 금지
2. 개선팩 ZIP 외 추측 금지
3. 패치는 주 1회만
4. 변경 변수는 1~2개만
5. 대규모 리팩토링 금지
6. 롱/숏 분리 최적화 금지
7. 모든 주간 패치는 롱/숏 공통 파라미터만 허용
8. QA나 재현성 실패 시 코드 생성 금지
9. 안전한 추천이 없으면 `hold` 또는 `rollback candidate`만 보고

## 스케줄
- 실행 시각:
  - 매주 일요일 `08:00 KST`
- 자동화 이름:
  - `Weekly Pine Upgrade`

## 입력 데이터
### 주간 입력
1. 현재 주 개선팩 ZIP
   - 이전 7개 전체 캘린더 일자
2. 직전 주 개선팩 ZIP
   - 그 이전 7개 전체 캘린더 일자

### 기준 파일
1. 자동화 기준 프롬프트:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/weekly_pine_upgrade_automation_prompt.md`
2. 현재 기준 Pine:
   - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja.pine.txt`
3. 과거 주간 보고서:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/`
4. 과거 생성 Pine 버전:
   - `/Users/jeongjaeyong/Projects/donbeolja/code/`

## 실행 흐름
### 1. 개선팩 다운로드
1. 현재 주 ZIP 다운로드
2. 직전 주 ZIP 다운로드
3. 파일 경로와 날짜 범위를 기록

### 2. 무결성 점검
1. `qa/data_quality_report.json` 확인
2. `qa/deterministic_replay_report.json` 확인
3. `signal_events ↔ signal_features` 조인율 확인
4. `trade_ledger` 링크율 확인
5. Fail이면 즉시 종료
   - 보고서는 작성
   - Pine 파일은 생성하지 않음
   - 텔레그램에는 `hold`만 전송

### 3. 현재 주 분석
1. `analysis/kpi_overall.json`에서 baseline 정리
2. `kpi_by_signal`, `kpi_by_market`, `kpi_by_regime`로 악화 구간 요약
3. 신호별 문제를 FP-heavy, FN-heavy, tail-risk로 분류
4. 최대 3개 패치 후보 생성

### 4. 직전 주 대비 비교
1. `overall win_rate`
2. `overall EV`
3. `overall net`
4. `by-signal win_rate / EV`
5. `by-market`, `by-regime` 집중도 변화
6. 직전 주 변경이:
   - `improved`
   - `degraded`
   - `mixed`
   인지 판정

### 5. 다주/월간 추적
1. 주간 히스토리 JSON 갱신
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_pine_upgrade_history.json`
2. 월간 히스토리 JSON 갱신
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/monthly_pine_upgrade_history.json`
3. 최근 주간 누적 추세 판단
   - `improving`
   - `degrading`
   - `mixed`
4. 월초 첫 실행이면 전달 월간 요약 마감
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/YYYY-MM_monthly_pine_upgrade.md`

### 6. 주간 추천 패치 선정
1. 패치 후보는 최대 3개
2. 각 후보는 1~2개 변수만 수정
3. 롱/숏 공통 파라미터만 허용
4. 가장 안전한 1개만 선정
5. 안전한 패치가 없으면 `hold`

### 7. Pine 버전 파일 생성
1. 현재 `donbeolja.pine.txt` 버전 읽기
2. 마지막 숫자 세그먼트만 `+1`
3. 예:
   - `v5.6.0.4 -> v5.6.0.5`
4. 새 파일 생성 위치:
   - `/Users/jeongjaeyong/Projects/donbeolja/code/`
5. 새 파일에는 아래만 반영
   - indicator title version
   - `STRATEGY_ID`
   - 추천 패치 1개
6. 원본 `donbeolja.pine.txt`는 덮어쓰지 않음

## 출력물
### 주간 보고서
- 경로:
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/YYYY-MM-DD_weekly_pine_upgrade.md`
- 형식:
  - `(I) 베이스라인 요약`
  - `(I-a) 직전 주 대비 변화`
  - `(I-b) 누적 추세 판단`
  - `(I-c) 월간 누적 판단`
  - `(II) 신호별 문제 TOP 5`
  - `(III) 패치 후보 3개`
  - `(IV) 이번 주 추천 패치 1개 + 롤백 기준 + 검증 체크리스트`
  - `(V) 추가 데이터 요청 5개 이내`

### 월간 보고서
- 경로:
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/YYYY-MM_monthly_pine_upgrade.md`
- 내용:
  - 전달 전체 개선 추세
  - 가장 잘 먹힌 주간 패치
  - 실패한 패치
  - 신호군별 개선/악화
  - 다음 달 회피 항목

### 히스토리
1. 주간:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_pine_upgrade_history.json`
2. 월간:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/monthly_pine_upgrade_history.json`

## 텔레그램 통지
### 매 실행 시 필수 전송
1. QA pass/fail
2. week-over-week:
   - improved / degraded / mixed
3. multi-week trend:
   - improved / degraded / mixed
4. month-to-date:
   - improved / degraded / mixed
5. 핵심 KPI 변화:
   - win_rate
   - EV
   - net
6. 이전 주 변경 평가:
   - effective / harmful / inconclusive
7. 이번 주 권고:
   - patch id
   - hold
   - rollback candidate

### 새 버전 파일 생성 시 추가 전송
1. 생성 완료
2. 파일 경로
3. 새 버전
4. 추천 patch id

### 월간 보고서 마감 시 추가 전송
1. 전달 최종 평가
2. best / worst signal family
3. best / worst weekly patch
4. next-month caution

## 패치 허용/금지 기준
### 허용
1. shared threshold
2. shared confidence floor
3. shared probability threshold
4. shared gap / cooldown
5. shared weight

### 금지
1. long-only threshold change
2. short-only threshold change
3. long/short 분리 게이트 조정
4. 한 방향만 비활성화
5. 구조 리팩토링

## 보류/롤백 조건
다음 중 하나라도 강하게 확인되면 새 버전 생성 보류 또는 rollback candidate:
1. QA gate fail
2. deterministic replay fail
3. OOS EV 악화
4. OOS win_rate 의미 있게 악화
5. `worst` 또는 `p10` 악화
6. fill_rate 과도 감소
7. 특정 market/regime 편향 심화
8. 직전 주 변경이 broad-based degradation으로 판정

## 성공 기준
1. 자동화가 매주 같은 절차로 재현 가능
2. 안전한 패치가 있을 때만 새 버전 생성
3. 새 파일 생성 사실과 분석 요약이 텔레그램으로 전달
4. 주간 히스토리와 월간 히스토리가 누적 관리
5. 롱/숏 분리 최적화 없이도 개선 방향을 유지

## 현 단계 상태
1. 기준 프롬프트 파일은 작성 완료
2. 자동화 실행 기준은 정리 완료
3. 아직 이 계획서 자체가 자동화 엔진에 강제 반영된 것은 아님
4. 다음 단계는 이 계획서를 기준으로 자동화 생성 또는 업데이트
