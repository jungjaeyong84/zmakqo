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

## 2. 현재 운영 스냅샷 (as-of 2026-04-03 10:23 KST)

### 2.1 배포

1. Cloud Build
   - `ea4974e7-81b6-49db-b61b-f13473196ddc`
   - status: `SUCCESS`
2. Cloud Run
   - `donbeolja` -> `donbeolja-01145-77b` (100%)
   - `donbeolja-egress` -> `donbeolja-egress-00385-rbj` (100%)
   - `donbeolja-exit-worker` -> `donbeolja-exit-worker-00487-qw4` (100%)

### 2.2 서버 신호/운영 가드

1. watchdog
   - `automation_watchdog_latest`
   - `verdict=PASS`
   - `issue_count=0`
2. server signal observation
   - `server_signal_observation_24h_latest`
   - `status=DRIFT_MONITORING`
   - `learning_epoch_exception_release=true`
   - remediation apply state is visible
3. cutover/runtime
   - current mode remains `SERVER_PRIMARY_ACTIVE`
   - blocker count remains `0`
4. autonomy/objective
   - `objective_supervisor_latest -> HOLD`
   - `best_self_evolution_openclaw_autonomy_contract_latest -> authority_state=PENDING`

### 2.3 historical market 예외 해제 상태

1. learning epoch 동안 historical market-level exceptions are intentionally released.
2. `server_signal_drift_remediation_apply_latest`
   - `learning_epoch_exception_release=true`
   - `effective.other_server_policy_watch_only_markets=[]`
3. current observed top sub-reasons remain:
   - `LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED`
   - `LIVE_RESCUE_ADD_POST_TP1_BLOCKED`
4. interpretation:
   - sub-reason mismatch 관측은 유지한다.
   - 하지만 과거 시장 예외를 바로 재적용하지 않고 fresh server-native data를 먼저 쌓는다.

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
5. `learning_epoch_exception_release=true`면 historical market-level watch-only/quarantine 예외 해제는 의도된 정책으로 본다.
6. `authority_state=PENDING`이면 OpenClaw가 최신 artifact를 읽고 있어도 완전 자율 상태로 부르지 않는다.

## 5. 현재 남아 있는 잔여 리스크

1. `DRIFT_MONITORING`은 종료가 아니라 관측 단계다.
2. `WATCH_PARITY_DRIFT`는 여전히 남아 있다.
3. historical market 예외는 해제되었지만 execution-quality/global safety guard는 여전히 살아 있다.
4. 배포는 완료되었지만 예외 해제 효과는 최소 24h 관측으로 재검증해야 한다.
