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
