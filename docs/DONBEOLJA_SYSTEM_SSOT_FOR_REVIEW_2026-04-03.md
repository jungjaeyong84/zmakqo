# DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03

- 제정: 2026-04-03
- 상태: ACTIVE
- 기준 시각: 2026-04-03 14:28 KST
- primary aligned cycle: `best_self_evolution_2026-04-03_1427_bb6cb98d`
- 목적:
  - Claude/Codex/OpenClaw가 2026-04-03 latest artifact 기준으로 동일한 판정을 내리도록 운영 SSOT를 고정한다.
  - `SERVER_PRIMARY_ACTIVE`, `promotion_gate_status`, `promotion_ready`를 서로 다른 판정 레이어로 분리해 오판을 막는다.
  - 최신 aligned cutover/runtime/quality cycle과 lagging autonomy/family artifacts를 혼동하지 않게 한다.

## 1. 절대 규칙

1. 최신 판정은 반드시 코드 + `*_latest` artifact 기준으로 수행한다.
2. Pine는 shadow compare 경로이며 실행 정본이 아니다.
3. `SERVER_PRIMARY_ACTIVE`, `promotion_gate_status`, `promotion_ready`를 동일 의미로 읽지 않는다.
4. objective score는 같은 cycle snapshot에서 governor/effect/plan/contract가 단일 값을 참조해야 한다.
5. `learning_epoch_exception_release=true`는 버그가 아니라 fresh-data 수집 정책이다.
6. cutover/runtime/quality가 최신 aligned cycle이고 autonomy/family artifacts가 이전 cycle이면, 이를 `artifact lag`로 보고 separate finding 또는 interpretation으로 적어라.

## 2. 현재 운영 스냅샷 (as-of 2026-04-03 14:28 KST)

### 2.1 배포

1. Cloud Build
   - `23c71e2a-1268-48ba-8b5f-bcfa9667554a`
   - status: `SUCCESS`
2. Cloud Run
   - `donbeolja` -> `donbeolja-01157-t94` (100%)
   - `donbeolja-egress` -> `donbeolja-egress-00392-4cr` (100%)
   - `donbeolja-exit-worker` -> `donbeolja-exit-worker-00494-m8r` (100%)

### 2.2 서버 신호/운영 가드

1. watchdog
   - `automation_watchdog_latest`
   - `display.verdict=PASS`
   - `display.issue_count=0`
   - `display.scheduler_mode=OPENCLAW_CRON`
2. runtime
   - `server_signal_runtime_latest`
   - `summary.cycle_id=best_self_evolution_2026-04-03_1427_bb6cb98d`
   - `runtime_status=READY`
   - `canonical_engine_source_mode=SERVER_PRIMARY`
   - `watchdog_verdict=PASS`
   - `learning_epoch_exception_release_enabled=true`
3. cutover
   - `server_signal_cutover_readiness_latest`
   - `readiness_status=SERVER_PRIMARY_ACTIVE`
   - `promotion_gate_status=READY`
   - `promotion_block_reasons=[]`
   - `artifact_coherence_status=READY`
   - `artifact_generated_at_skew_ms=3000`
   - `artifact_generated_at_skew_exceeded=false`
   - `artifact_cycle_alignment_status=ALIGNED`
4. quality
   - `server_signal_quality_latest`
   - `quality_status=WATCH_PARITY_DRIFT`
   - `parity_mismatch_n=17`
   - `final_downstream_mismatch_n=17`
   - `other_server_policy_mismatch_n=3`
   - top final family: `EV_POLICY(12)`
   - top other-server-policy action:
     - `LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED -> WATCH_ONLY_REVIEW`

### 2.3 autonomy/objective

1. `objective_supervisor_latest`
   - `verdict=HOLD`
   - `root_cause=EXTERNAL_AUTHORITY_BLOCK_ROLLBACK`
2. `best_self_evolution_openclaw_autonomy_contract_latest`
   - `authority_state=PENDING`
   - `ops_status=PASS`
   - `objective_score=-9.5532`
   - note: this artifact is older than the aligned 14:27 cutover/runtime/quality set
3. objective score SSOT
   - current unified objective score snapshot remains `-9.5532`
   - score identity is unified inside the current objective snapshot family even if not every artifact shares the newest cutover cycle

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
8. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_family_scoreboard_latest.json`

## 4. 검수 해석 규칙

1. `SERVER_PRIMARY_ACTIVE`는 source-mode truth다.
2. 승격 coherence 판정은 `promotion_gate_status`로 본다.
3. business promotion decision이 필요하면 `promotion_ready`와 `promotion_gate_status`를 separately 적는다.
4. `artifact_coherence_status!=READY`면 promotion gate는 cleared로 읽지 않는다.
5. `WATCH_PARITY_DRIFT`는 운영 관측 상태이지 즉시 source-mode rollback 근거가 아니다.
6. `authority_state=PENDING`이면 OpenClaw는 완전 자율 상태가 아니다.
7. 최신 cutover/runtime/quality cycle과 lagging autonomy/family artifacts를 한 행에 섞어 쓰지 마라.

## 5. 현재 남아 있는 잔여 리스크

1. `WATCH_PARITY_DRIFT`
2. `final_downstream_mismatch_n=17`
3. `EXTERNAL_AUTHORITY_BLOCK_ROLLBACK`
4. `authority_state=PENDING`
5. `objective_score=-9.5532`
6. 일부 autonomy/family artifact lag

## 6. 현재 결론

1. server canonical execution 자체는 active다.
2. promotion coherence gate도 최신 aligned set에서는 ready다.
3. objective score SSOT는 unified snapshot 기준으로 정렬됐다.
4. quarantine/watch-only 숫자는 의미적으로 분리돼 해석 가능하다.
5. 현재 blocker의 본질은 cutover skew가 아니라 downstream mismatch, objective hold, external authority pending이다.
