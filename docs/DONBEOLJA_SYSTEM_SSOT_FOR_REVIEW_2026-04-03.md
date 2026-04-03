# DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03

- 제정: 2026-04-03
- 상태: ACTIVE
- 목적:
  - 2026-04-03 기준 서버 신호 P0-P2 안정화 결과를 운영 SSOT로 고정한다.
  - Claude/Codex/OpenClaw가 동일한 최신 artifact와 배포 상태를 기준으로 판정하도록 한다.

## 1. 절대 규칙

1. 최신 판정은 반드시 코드 + `*_latest` artifact + 현재 Cloud Run revision 기준으로 수행한다.
2. Pine는 shadow compare 경로이며 실행 정본이 아니다.
3. `OTHER_SERVER_POLICY`는 더 이상 단일 opaque bucket으로 읽지 않는다.
4. reason-level watch-only는 live execution guard가 실제 차단까지 수행하는 운영 정책이다.

## 2. 현재 운영 스냅샷 (as-of 2026-04-03 10:07 KST)

### 2.1 배포

1. Cloud Build
   - `28de8244-ccea-4e72-862f-d56259463157`
   - status: `SUCCESS`
2. Cloud Run
   - `donbeolja` -> `donbeolja-01143-fzg` (100%)
   - `donbeolja-egress` -> `donbeolja-egress-00384-8sk` (100%)
   - `donbeolja-exit-worker` -> `donbeolja-exit-worker-00486-68l` (100%)

### 2.2 서버 신호/운영 가드

1. watchdog
   - `automation_watchdog_latest`
   - `verdict=PASS`
   - `issue_count=0`
2. server signal observation
   - `server_signal_observation_24h_latest`
   - `status=DRIFT_MONITORING`
   - remediation apply state is visible
3. cutover/runtime
   - current mode remains `SERVER_PRIMARY_ACTIVE`
   - blocker count remains `0`

### 2.3 OTHER_SERVER_POLICY 하위 reason 운영 상태

1. `LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED`
   - action: `WATCH_ONLY_REVIEW`
   - effective market:
     - `ETHUSDT`
2. `LIVE_RESCUE_ADD_POST_TP1_BLOCKED`
   - action: `MONITOR_POST_TP1_GUARD`
   - current observed market:
     - `BNBUSDT`

## 3. 품질 검수 시 반드시 확인할 artifact

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/automation_watchdog_latest.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_quality_latest.json`
3. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_observation_24h_latest.json`
4. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_drift_remediation_plan_latest.json`
5. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_drift_remediation_apply_latest.json`
6. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_cutover_readiness_latest.json`
7. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_runtime_latest.json`

## 4. 검수 해석 규칙

1. `OTHER_SERVER_POLICY` mismatch는 반드시 sub-reason까지 내려가서 본다.
2. `WATCH_ONLY_REVIEW`는 운영상 차단 후보가 아니라 이미 적용 가능한 보호 정책으로 본다.
3. `MONITOR_POST_TP1_GUARD`는 즉시 차단이 아니라 post-TP1 rescue-add 가드 감시 상태로 본다.
4. watchdog이 `PASS`이면 `WEEKLY_FILTER_GOVERNANCE_STALE`는 해소된 것으로 판정한다.

## 5. 현재 남아 있는 잔여 리스크

1. `DRIFT_MONITORING`은 종료가 아니라 관측 단계다.
2. reason-level watch-only는 현재 `ETHUSDT`에만 적용되어 있으며, 향후 reason 분포 변화에 따라 대상 시장이 바뀔 수 있다.
3. 배포는 완료되었지만 자동 완화 효과는 최소 24h 관측으로 재검증해야 한다.
