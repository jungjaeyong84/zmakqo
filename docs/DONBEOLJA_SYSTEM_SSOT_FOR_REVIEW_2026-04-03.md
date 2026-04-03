# DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03

- 제정: 2026-04-03
- 상태: ACTIVE
- 기준 시각: 2026-04-03 14:11 KST
- 목적:
  - Claude/Codex/OpenClaw가 2026-04-03 latest artifact 기준으로 동일한 판정을 내리도록 운영 SSOT를 고정한다.
  - `SERVER_PRIMARY_ACTIVE`와 promotion gate 상태를 분리해 오판을 막는다.

## 1. 절대 규칙

1. 최신 판정은 반드시 코드 + `*_latest` artifact 기준으로 수행한다.
2. Pine는 shadow compare 경로이며 실행 정본이 아니다.
3. `SERVER_PRIMARY_ACTIVE`와 `promotion_gate_status`를 동일 의미로 읽지 않는다.
4. objective score는 같은 `cycle_id`에서 governor/effect/plan/contract가 단일 snapshot을 참조한다.
5. `learning_epoch_exception_release=true`는 버그가 아니라 fresh-data 수집 정책이다.

## 2. 현재 운영 스냅샷 (as-of 2026-04-03 14:11 KST)

### 2.1 배포

1. Cloud Build
   - `a3227723-4dde-4e7a-9a15-1742607a4378`
   - status: `SUCCESS`
2. Cloud Run
   - `donbeolja` -> `donbeolja-01153-6kb` (100%)
   - `donbeolja-egress` -> `donbeolja-egress-00390-lvv` (100%)
   - `donbeolja-exit-worker` -> `donbeolja-exit-worker-00492-z2n` (100%)

### 2.2 서버 신호/운영 가드

1. watchdog
   - `automation_watchdog_latest`
   - `verdict=PASS`
   - `issue_count=0`
2. runtime
   - `server_signal_runtime_latest`
   - `runtime_status=READY`
   - `canonical_engine_source_mode=SERVER_PRIMARY`
   - `watchdog_verdict=PASS`
   - `learning_epoch_exception_release_enabled=true`
3. cutover
   - `server_signal_cutover_readiness_latest`
   - `readiness_status=SERVER_PRIMARY_ACTIVE`
   - `promotion_gate_status=BLOCKED`
   - `promotion_block_reasons=[ARTIFACT_GENERATED_AT_SKEW_EXCEEDED]`
   - `artifact_coherence_status=BLOCKED`
   - `artifact_generated_at_skew_ms=9969000`
4. quality
   - `server_signal_quality_latest`
   - `quality_status=WATCH_PARITY_DRIFT`
   - `parity_mismatch_n=15`
   - `final_downstream_mismatch_n=15`
   - `other_server_policy_mismatch_n=3`
   - top final family: `EV_POLICY(10)`
   - top other-server-policy action:
     - `LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED -> WATCH_ONLY_REVIEW`

### 2.3 autonomy/objective

1. `objective_supervisor_latest`
   - `cycle_id=test_ctx_2026-04-03_1120`
   - `verdict=HOLD`
   - `root_cause=EXTERNAL_AUTHORITY_BLOCK_ROLLBACK`
2. `best_self_evolution_openclaw_autonomy_contract_latest`
   - `authority_state=PENDING`
   - `phase_d_status=READY`
   - `ops_status=PASS`
   - `objective_score=-9.5532`
3. objective score SSOT
   - current `cycle_id=test_ctx_2026-04-03_1120`
   - `governor/effect/plan/contract` current objective score is unified to `-9.5532`

### 2.4 policy/quarantine/watch-only

1. `best_self_evolution_policy_parameter_plan_latest`
   - `status=HOLD`
   - `mode=ADVISORY_ONLY`
   - `quarantine_market_n=3`
   - `watch_only_review_market_n=4`
   - `other_server_policy_watch_only_market_n=1`
   - `watch_only_review_overlap_market_n=0`
2. 해석 규칙
   - `quarantine_market_n`은 allocator quarantine만 센다.
   - `watch_only_review_market_n`은 review/watch-only 전체를 센다.
   - `other_server_policy_watch_only_market_n`은 그중 `OTHER_SERVER_POLICY` 전용 count다.

## 3. 검수 시 반드시 확인할 artifact

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/automation_watchdog_latest.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_runtime_latest.json`
3. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_cutover_readiness_latest.json`
4. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_quality_latest.json`
5. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json`
6. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_autonomy_contract_latest.json`
7. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_policy_parameter_plan_latest.json`

## 4. 검수 해석 규칙

1. `SERVER_PRIMARY_ACTIVE`는 source-mode truth다.
2. 승격 판정은 `promotion_gate_status`로 본다.
3. `artifact_coherence_status!=READY`면 promotion gate는 cleared로 읽지 않는다.
4. `WATCH_PARITY_DRIFT`는 운영 관측 상태이지 즉시 source-mode rollback 근거가 아니다.
5. `authority_state=PENDING`이면 OpenClaw는 완전 자율 상태가 아니다.

## 5. 현재 남아 있는 잔여 리스크

1. `ARTIFACT_GENERATED_AT_SKEW_EXCEEDED`
2. `WATCH_PARITY_DRIFT`
3. `EXTERNAL_AUTHORITY_BLOCK_ROLLBACK`
4. `authority_state=PENDING`
5. `objective_score=-9.5532`

## 6. 현재 결론

1. server canonical execution 자체는 active다.
2. promotion-grade cutover coherence는 아직 blocked다.
3. objective score SSOT는 같은 cycle에서 일치하도록 정렬됐다.
4. quarantine/watch-only 숫자는 이제 의미적으로 분리돼 해석 가능하다.
