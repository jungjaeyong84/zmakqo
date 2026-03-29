# Firestore Retention Policy

## 기본 정책(권장)
- bars_snapshots: 90일
- signals / signals_tv: 180일
- order_intents_paper / orders_paper: 180일
- fills_paper / trades_paper / paper_trades: 365일
- gate_events: 30일
- report_runs / weekly_runs: 365일
- system_runs: 30일
- eval_weekly: 365일
- kpi_snapshots: 90일
- account_snapshots: 365일
- risk_budget_history: 365일
- filters_drop: 365일
- briefing_agg: 90일

## 실행 방법
수동:
```
DRY_RUN=1 npm run cleanup:retention
```

실삭제:
```
npm run cleanup:retention
```

## 스케줄러 연동
Cloud Scheduler → Cloud Run
```
POST /scheduler/retention-cleanup
headers: x-scheduler-token
body: { "dry_run": "1", "limit": 500 }
```

## 정책 변경
`src/config/retentionPolicy.js`에서 컬렉션별 기간/필드를 수정한다.

## 로컬 산출물 보존 기준
아래 경로는 애플리케이션 소스가 아니라 로컬 실행 산출물 또는 운영 분석 산출물로 본다.

- `ops/daily/`
  - 주기 실행 리포트와 점검 결과물
  - Git 추적 제외
  - 용량이 커지면 최근 운영 확인에 필요한 범위만 남기고 정리
- `ops/analysis/`
  - 실험/리플레이/탐색 결과물
  - Git 추적 제외
  - 재현 근거가 필요한 결과만 별도 문서로 승격하고 원본 산출물은 정리 가능
- `data/`
  - 로컬 캐시 또는 임시 JSON 산출물
  - Git 추적 제외
  - 재생성 가능하면 우선 삭제
- `noye/`
  - 로컬 보고서/스냅샷/전송 로그
  - Git 추적 제외
  - `*.log` 류는 정기적으로 삭제, 필요한 보고서만 보관
- `ops/runtime/`
  - 런타임 상태 파일
  - Git 추적 제외
  - 실행 중 참조될 수 있으므로 내용 확인 없이 일괄 삭제하지 않음
- `ops/launchd/*.err.log`, `ops/launchd/*.out.log`
  - launchd 로그
  - Git 추적 제외
  - 장애 조사 후 정리

## 로컬 정리 원칙
- 소스/설정/런북과 산출물을 섞어 커밋하지 않는다.
- `git status`에 보이면 안 되는 항목은 `.gitignore`로 숨기고, 필요 없으면 실제 파일도 삭제한다.
- 중복 복사본 디렉터리는 root 소스와 차이를 확인한 뒤 stale 조각으로 판단되면 제거한다.
