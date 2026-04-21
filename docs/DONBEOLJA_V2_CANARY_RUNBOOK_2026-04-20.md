# DONBEOLJA V2 Canary Runbook

## 목적

이 문서는 실제 V2 canary cycle 1건을 bounded 방식으로 검증할 때 따라야 하는 고정 절차다.

핵심은 사람 판단을 최소화하고, 같은 `position_cycle_id` 축으로만 preflight와 pipeline을 실행하는 것이다.

## 금지 사항

아래는 금지한다.

1. selector 결과를 사람이 다시 편집해서 env로 옮기는 운영
2. preflight 없이 바로 pipeline 실행
3. 다른 실행에서 나온 artifact 디렉터리를 재사용해서 canary 판단
4. `SHADOW` 모드 결과를 `CANARY/LIVE` 근거로 읽는 운영

## 실행 순서

### 0. optional automated runbook verifier

아래 verifier는 checklist 1, 3~13을 artifact 기준으로 자동 검증한다.

```bash
export V2_PROMOTION_ARTIFACT_DIR="tmp/v2-promotion-artifacts/<position-cycle-id>"
export V2_PROMOTION_EXPECT_POSITION_CYCLE_ID="<position-cycle-id>"
npm run check:v2-canary-runbook
```

출력:

1. `promotion-runbook-review.json`
2. submit trace-back: `SUBMIT_CHK_05`

핵심:

1. 사람이 checklist를 다시 손으로 대조하기 전에 artifact coherence를 먼저 fail-closed로 확인한다
2. explicit cycle 경로에서 `candidate_selection_summary` 가 없으면 해당 항목은 `SKIP` 으로 기록한다
3. submit wrapper에서 `SUBMIT_CHK_05` 가 실패하면 개별 checklist 번호보다 먼저 이 파일의 `overall_status` 와 failed checklist 목록을 다시 본다

## 실행 체크리스트

아래는 operator가 위에서 아래로 체크해야 하는 fail-closed checklist다.

1. 같은 `position_cycle_id` 로 artifact 디렉터리를 고정했는가
2. preflight 없이 pipeline 또는 cloudbuild wrapper를 먼저 실행하지 않았는가
3. `promotion-preflight.json.ok = true` 인가
4. `promotion-canary-flow.json.ok = true` 인가
5. `promotion-runtime-manifest.json.snapshot_meta.selector_meta.position_cycle_id` 가 입력 cycle과 같은가
6. `unified-promotion-report.json.position_cycle_id` 가 같은가
7. `promotion-deploy-decision.json.approved = true` 인가
   submit trace-back: `SUBMIT_CHK_02`
8. `promotion-deploy-decision.json.bounded_runtime_summary` 핵심 필드가 모두 존재하는가
   submit trace-back: `SUBMIT_CHK_03`
9. `promotion-deploy-decision.json.candidate_selection_summary.selected_position_cycle_id` 와 최종 `position_cycle_id` 가 같은가
10. `promotion-cloudbuild-context.json.final_status_line` 이 `APPROVE_DEPLOY` 로 시작하는가
11. `promotion-cloudbuild-context.json.recommended_next_action = PROCEED_WITH_SUBMIT_WRAPPER` 인가
   submit trace-back: `SUBMIT_CHK_06`
12. `promotion-cloudbuild-context.json.recommended_next_action_reason` 이 현재 상태와 모순되지 않는가
    추가 확인: `promotion-cloudbuild-context.json.recommended_next_action_reason_code` 가 `recommended_next_action_reason` 및 blocker family와 모순되지 않는가
13. `promotion-cloudbuild-context.json.deploy_decision_summary.blocker_summary.blocker_n = 0` 인가
   submit trace-back: `SUBMIT_CHK_07`
13A. `promotion-cloudbuild-context.json.deploy_decision_summary.alert_retry_summary` 가 현재 outbox 상태와 모순되지 않는가
    추가 확인: `alert_retry_attention_required=true` 이면 `final_status_line` 에 `alert_failed=` 또는 `alert_pending=` 표시가 있는가
13B. `promotion-cloudbuild-context.json.deploy_decision_summary.warning_summary` 가 `promotion-deploy-decision.json.warnings` 와 모순되지 않는가
    추가 확인: warning이 있으면 `final_status_line` 에 `warnings=<n>` 과 top warning code가 표시되는가
14. `promotion-deploy-decision.json.bounded_runtime_summary.evidence_snapshot_summary` 가 존재하고 누락 카운트가 모두 0인가
   submit trace-back: `SUBMIT_CHK_04`
14A. `promotion-deploy-decision.json.bounded_runtime_summary.runtime_chain_audit_summary` 가 존재하고 `ok=true`, `check_n > 0`, `fail_n=0` 인가
    submit trace-back: `SUBMIT_CHK_04B`
15. `promotion-deploy-decision.json.candidate_selection_summary.selection_contract` 가 존재하고 모든 계약 플래그가 `true` 인가
   submit trace-back: `SUBMIT_CHK_09`
16. `promotion-preflight.json.lineage_contract.hash`, `promotion-runtime-manifest.json.snapshot_meta.lineage_contract.hash`, `promotion-deploy-decision.json.bounded_runtime_summary.lineage_contract.hash` 가 모두 같은가
   submit trace-back: `SUBMIT_CHK_08`
17. `promotion-cloudbuild-context.json.lineage_contract_hash` 와 `promotion-deploy-decision.json.bounded_runtime_summary.lineage_contract.hash` 가 같은가
   submit trace-back: `SUBMIT_CHK_08`
18. 위 모든 항목이 true 가 아니면 즉시 중단하고 artifact 디렉터리를 재사용하지 않는가

## Artifact Review Matrix

아래 표는 checklist 각 항목을 실제 artifact file path와 field에 1:1로 매핑한다.

| Checklist | Submit Check IDs | File | Field | Pass 조건 | Fail 시 행동 |
| --- | --- | --- | --- | --- | --- |
| 3 | - | `promotion-preflight.json` | `ok` | `true` | preflight부터 다시 시작 |
| 4 | - | `promotion-canary-flow.json` | `ok`, `stage` | `ok=true`, `stage=PIPELINE_PASS` | canary flow 재실행 |
| 5 | - | `promotion-runtime-manifest.json` | `snapshot_meta.selector_meta.position_cycle_id` | 입력 `position_cycle_id` 와 동일 | artifact dir 폐기 후 preflight부터 다시 시작 |
| 6 | - | `unified-promotion-report.json` | `position_cycle_id` | 입력 `position_cycle_id` 와 동일 | unified report 생성 축 재검토 |
| 7 | `SUBMIT_CHK_02` | `promotion-deploy-decision.json` | `approved` | `true` | deploy decision blocker 검토 후 중단 |
| 8 | `SUBMIT_CHK_03` | `promotion-deploy-decision.json` | `bounded_runtime_summary.selector_query_budget`, `collector_query_budget`, `exporter_snapshot_size_bytes`, `manifest_counts` | 네 묶음 모두 존재 | bounded runtime artifact 재생성 |
| 9 | - | `promotion-deploy-decision.json` | `candidate_selection_summary.selected_position_cycle_id`, `position_cycle_id` | 두 값이 동일 | selected cycle 검토 후 canary flow 재실행 |
| 10 | - | `promotion-cloudbuild-context.json` | `final_status_line` | `APPROVE_DEPLOY` 로 시작 | final status와 deploy decision 불일치 검토 |
| 11 | `SUBMIT_CHK_06` | `promotion-cloudbuild-context.json` | `recommended_next_action` | `PROCEED_WITH_SUBMIT_WRAPPER` | action hint에 따라 중단/재실행 |
| 12 | - | `promotion-cloudbuild-context.json` | `recommended_next_action_reason` | `recommended_next_action` 및 blocker family와 모순 없음 | reason과 blocker family 재검토 |
| 13 | `SUBMIT_CHK_07` | `promotion-cloudbuild-context.json` | `deploy_decision_summary.blocker_summary.blocker_n` | `0` | blocker summary 계열별 대응 |
| 13A | - | `promotion-cloudbuild-context.json` | `deploy_decision_summary.alert_retry_summary`, `deploy_decision_summary.alert_retry_attention_required`, `final_status_line` | alert summary와 한 줄 상태가 서로 모순 없음 | alert retry family/runbook ref 검토 |
| 13B | - | `promotion-cloudbuild-context.json`, `promotion-deploy-decision.json` | `deploy_decision_summary.warning_summary`, `submit_trace.deploy_warning_summary`, `submit_trace.deploy_warning_runbook_checklist`, `warnings`, `final_status_line` | warning count/top warning이 서로 일치. repair streak warning은 `has_repair_firestore_canary_streak_warning=true` 와 runbook 19, production route streak warning은 `has_production_entry_route_canary_streak_warning=true` 와 runbook 26으로 추적 가능해야 함. `submit_trace.deploy_warning_*` 도 같은 값을 가리켜야 함 | warning summary/trace drift면 artifact dir 폐기 후 cloudbuild context 재생성 |
| 13C | `SUBMIT_CHK_06`, `SUBMIT_CHK_07`, `SUBMIT_CHK_08` | `promotion-cloudbuild-context.json` | `submit_trace.relevant_submit_check_ids`, `submit_trace.failed_submit_check_ids`, `submit_trace.failed_runbook_checklist`, `submit_trace.blocker_families`, `submit_trace.primary_blocker_family`, `submit_trace.recommended_next_action_reason_code`, `submit_trace.checks[]` | context 기준 submit 차단 상태가 trace에 그대로 반영. relevant는 06/07/08, runbook은 11/13/16/17, 실패 목록과 blocker family/reason code가 context와 일치해야 함 | submit trace drift면 wrapper 제출 금지, cloudbuild context 재생성 |
| 14 | `SUBMIT_CHK_04` | `promotion-deploy-decision.json` | `bounded_runtime_summary.evidence_snapshot_summary.ok`, `missing_transition_evidence_n`, `missing_protection_runtime_evidence_n` | `ok=true`, 두 누락 카운트 `0` | runtime snapshot/exporter부터 다시 생성 |
| 14A | `SUBMIT_CHK_04B` | `promotion-deploy-decision.json` | `bounded_runtime_summary.runtime_chain_audit_summary.ok`, `check_n`, `fail_n`, `failed_check_ids` | `ok=true`, `check_n > 0`, `fail_n=0`, `failed_check_ids=[]` | runtime chain audit 생성 경로와 entry/protection/reducer/alert 연결 불변식 재검토 |
| 15 | `SUBMIT_CHK_09` | `promotion-deploy-decision.json` | `candidate_selection_summary.selection_contract.ok`, `scan_limit_respected`, `recent_window_enforced`, `selected_candidate_present`, `selected_preflight_ok`, `selected_cycle_matches_preflight`, `selected_cycle_matches_collector_env`, `selected_snapshot_counts_exact` | 모든 값 `true` | auto-select 결과 폐기 후 candidate selector부터 다시 시작 |
| 16 | `SUBMIT_CHK_08` | `promotion-preflight.json`, `promotion-runtime-manifest.json`, `promotion-deploy-decision.json` | `lineage_contract.hash` | 세 hash가 동일 | artifact dir 폐기 후 preflight부터 다시 시작 |
| 17 | `SUBMIT_CHK_08` | `promotion-cloudbuild-context.json`, `promotion-deploy-decision.json` | `lineage_contract_hash`, `bounded_runtime_summary.lineage_contract.hash` | 두 hash가 동일 | submit 직전 wrapper provenance 재검토 후 중단 |
| 18 | `SUBMIT_CHK_10` | `promotion-deploy-decision.json` | `bounded_runtime_summary.openclaw_execution_audit_ledger_write.reason`, `skipped`, `doc_id` | `reason=OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN`, `skipped=false`, `doc_id` 존재 | collector env의 `DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` 여부와 Firestore ledger write 실패 원인 재검토 |
| 19 | `SUBMIT_CHK_11` | `promotion-deploy-decision.json`, `v2_repair_queue_firestore_canary_streak_latest.json` | `bounded_runtime_summary.repair_firestore_canary_streak.reason`, `healthy_run_n`, `blockers` | LIVE만 필수. `reason=V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS`, `healthy_run_n >= min_run_count`, `blockers=[]`. 이 파일은 promotion pipeline이 unified report 직전에 같은 artifact dir에 갱신해야 함 | Firestore-backed repair canary collector history와 streak output을 재검토. 24시간 coverage 부족이면 LIVE 승격 금지 |
| 20 | `SUBMIT_CHK_12` | `promotion-cloudbuild-context.json`, `v2_repair_live_cutover_readiness_latest.json` | `live_cutover_readiness_summary`, `reason`, `auto_apply`, `mutates_environment`, `required_env_changes` | streak pass 후 `reason=V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT`, `auto_apply=false`, `mutates_environment=false`, env plan은 명시 승인 전 적용 금지. 실패 시에도 context에는 `live_cutover_readiness_summary.ok=false` 와 blocker/runbook ref가 남아야 함 | `check:v2-repair-live-cutover-readiness` 를 재실행하고 env 변경은 별도 승인 절차로만 적용 |
| 21 | `SUBMIT_CHK_13` | `promotion-deploy-decision.json` | `entry_boundary_audit.ok`, `reason`, `scope`, `violation_n` | `ok=true`, `reason=V2_ENTRY_BOUNDARY_AUDIT_PASS`, `scope=src/v2`, `violation_n=0` | V2 entry submit/transport/protection 경계 위반 파일을 수정하고 `check:v2-entry-boundary` 및 deploy decision을 다시 실행 |
| 22 | `SUBMIT_CHK_14` | `promotion-deploy-decision.json` | `production_cutover_audit.ok`, `reason`, `scope`, `contract.fail_n` | `ok=true`, `reason=V2_PRODUCTION_CUTOVER_AUDIT_PASS`, `scope=production_webhook_cutover`, `contract.fail_n=0` | V2 production cutover guard route/import/outcome 연결을 수정하고 `check:v2-production-cutover` 및 deploy decision을 다시 실행 |
| 23 | `SUBMIT_CHK_15` | `promotion-cloudbuild-context.json`, `v2_production_cutover_readiness_latest.json` | `production_cutover_readiness_summary`, `reason`, `guard_reason`, `legacy_webhook_blocked`, `v2_enabled`, `v2_dry_run`, `v2_canary_only` | LIVE만 필수. `reason=V2_PRODUCTION_CUTOVER_READINESS_PASS`, `legacy_webhook_blocked=true`, `guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED`, `v2_enabled=true`, `v2_dry_run=false`, `v2_canary_only=false`. 실패 시에도 context에는 `production_cutover_readiness_summary.ok=false` 와 `failed_check_ids` 가 남아야 함 | LIVE env cutover flags와 legacy webhook 차단 상태를 수정하고 `check:v2-production-cutover` 및 LIVE cloudbuild wrapper를 다시 실행 |
| 24 | `SUBMIT_CHK_16`, `SUBMIT_CHK_17` | `promotion-cloudbuild-context.json`, `v2_scheduler_traffic_collector_preflight_latest.json`, `v2_scheduler_traffic_cutover_readiness_latest.json` | `scheduler_traffic_collector_preflight_summary`, `scheduler_traffic_cutover_readiness_summary`, `scheduler_sot`, `missing_openclaw_job_ids`, `active_legacy_scheduler_job_n`, `cloud_run_services` | LIVE만 필수. collector preflight는 `reason=V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS`, readiness는 `reason=V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS`, `scheduler_sot=OPENCLAW_CRON`, `missing_openclaw_job_ids=[]`, `active_legacy_scheduler_job_n=0`, Cloud Run 서비스 traffic/revision/env 모두 ready. collector preflight 실패 시에도 context에는 `scheduler_traffic_collector_preflight_summary.ok=false` 와 `failed_check_ids` 가 남아야 함 | collector 권한/환경 문제면 `SCHED_TRAFFIC_COLLECTOR_PREREQ_*` 를 먼저 해소하고, scheduler 상태 문제면 Cloud Scheduler/OpenClaw cron/Cloud Run traffic state를 수정한 뒤 `check:v2-scheduler-traffic-cutover` 및 LIVE cloudbuild wrapper를 다시 실행 |
| 25 | `SUBMIT_CHK_18` | `promotion-deploy-decision.json` | `fill_sync_canonical_boundary_audit.ok`, `reason`, `scope`, `contract.fail_n`, `contract.failed_check_ids` | `ok=true`, `reason=V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS`, `scope=binance_fills_sync_canonical_boundary`, `contract.fail_n=0`, `contract.failed_check_ids=[]` | legacy fill sync canonical write 경계를 수정하고 `check:v2-fill-sync-canonical-boundary` 및 deploy decision을 다시 실행 |
| 26 | `SUBMIT_CHK_19` | `promotion-deploy-decision.json`, `v2_production_entry_route_canary_streak_latest.json` | `bounded_runtime_summary.production_entry_route_canary_streak.reason`, `history_source`, `history_file`, `healthy_run_n`, `blockers` | LIVE만 필수. `reason=V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS`, `history_source=FIRESTORE`, `history_file` 은 V2 Firestore collection name, `healthy_run_n >= min_run_count`, `blockers=[]`, canary artifact는 `exchange_write_performed=false` 이어야 함. 이 파일은 promotion pipeline이 unified report 직전에 같은 artifact dir에 갱신해야 함 | OpenClaw cron의 V2 production route canary Firestore history와 streak output을 재검토. JSONL source는 개발 fallback이므로 LIVE 승격 증거로 인정하지 않는다 |

## Submit Reverse Index

아래 표는 submit 차단 항목에서 runbook checklist로 역추적할 때 쓰는 최소 인덱스다.

| Submit Check ID | Runbook Checklist | 의미 |
| --- | --- | --- |
| `SUBMIT_CHK_02` | `7` | deploy decision approved |
| `SUBMIT_CHK_03` | `8` | bounded runtime summary complete |
| `SUBMIT_CHK_04` | `14` | evidence snapshot coverage complete |
| `SUBMIT_CHK_05` | `runbook aggregate` | automated runbook review overall status must be PASS |
| `SUBMIT_CHK_06` | `11` | cloudbuild next action is submit |
| `SUBMIT_CHK_07` | `13` | cloudbuild blocker count is zero |
| `SUBMIT_CHK_08` | `16`, `17` | lineage hashes consistent across bounded artifacts and cloudbuild context |
| `SUBMIT_CHK_09` | `15` | candidate selection contract complete |
| `SUBMIT_CHK_10` | `18` | OpenClaw execution audit ledger write complete |
| `SUBMIT_CHK_11` | `19` | LIVE repair Firestore canary streak complete |
| `SUBMIT_CHK_12` | `20` | LIVE repair cutover env plan must be explicit and non-mutating |
| `SUBMIT_CHK_13` | `21` | V2 entry boundary audit complete |
| `SUBMIT_CHK_14` | `22` | V2 production cutover audit complete |
| `SUBMIT_CHK_15` | `23` | LIVE production cutover readiness blocks legacy webhook |
| `SUBMIT_CHK_16` | `24` | LIVE scheduler traffic cutover uses OpenClaw cron only |
| `SUBMIT_CHK_17` | `24` | LIVE scheduler traffic collector preflight can read GCP state |
| `SUBMIT_CHK_18` | `25` | V2 fill sync canonical boundary audit complete |
| `SUBMIT_CHK_19` | `26` | LIVE production entry route canary streak complete |

실무 원칙:

1. 한 항목이라도 fail이면 다음 항목으로 넘어가지 않는다
2. provenance 계열 fail이면 artifact dir를 폐기하고 처음부터 다시 시작한다
3. watchdog 계열 fail이면 승격을 보류하고 replay evidence를 다시 읽는다
4. candidate 계열 fail이면 auto-select 결과와 최종 승인 cycle을 다시 맞춘다

LIVE 모드에서는 `run-v2-promotion-cloudbuild` 가 deploy decision 승인 후, runbook review 전에 `v2_repair_live_cutover_readiness_latest.json` 을 먼저 생성해야 한다.

즉, checklist `20` 은 사람이 별도로 파일을 만들었는지 보는 항목이 아니라, Cloud Build wrapper가 LIVE 전환 계획을 자동 산출했는지 검증하는 항목이다.

이 파일이 없으면 LIVE runbook review는 실패해야 한다.

동시에 `promotion-cloudbuild-context.json.live_cutover_readiness_summary` 와 `live_cutover_readiness_file` 이 같은 readiness 결과를 상단에 노출해야 한다.

즉, 운영자는 runbook review 파일을 열기 전에도 Cloud Build context에서 LIVE 전환 env plan이 non-mutating으로 생성됐는지 확인할 수 있어야 한다.

LIVE 모드에서는 같은 시점에 `v2_production_cutover_readiness_latest.json` 도 생성돼야 한다.

즉, checklist `23` 은 static route guard 검사가 아니라 실제 LIVE 승격 env에서 legacy `/webhook/signal` 이 `V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED` 로 막히는지 확인하는 항목이다.

동시에 `promotion-cloudbuild-context.json.production_cutover_readiness_summary` 와 `production_cutover_readiness_file` 이 같은 readiness 결과를 상단에 노출해야 한다.

LIVE 모드에서는 같은 시점에 `v2_scheduler_traffic_cutover_readiness_latest.json` 도 생성돼야 한다.

즉, checklist `24` 는 코드 설정만 보는 항목이 아니라 실제 운영 상태에서 legacy scheduler tick이 비활성이고, OpenClaw cron 필수 job이 살아 있으며, main/exit-worker Cloud Run traffic이 ready revision에 100% 붙어 있고, 두 서비스 모두 `SCHEDULER_AUTOSTART=0`/`DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=OPENCLAW_CRON` 인지 확인하는 항목이다.

동시에 `promotion-cloudbuild-context.json.scheduler_traffic_cutover_readiness_summary` 와 `scheduler_traffic_cutover_readiness_file` 이 같은 readiness 결과를 상단에 노출해야 한다.

이 상태 JSON은 수동 작성하지 않는 것이 원칙이다.

`npm run collect:v2-scheduler-traffic-state` 가 GCP Cloud Run service/env/traffic, Cloud Scheduler job 목록, OpenClaw cron manifest를 수집해 `v2_scheduler_traffic_state_latest.json` 을 만들고, `npm run check:v2-scheduler-traffic-cutover` 또는 LIVE cloudbuild wrapper가 이를 readiness 입력으로 사용해야 한다.

collector 실행 전제도 별도 검사한다.

`npm run check:v2-scheduler-traffic-collector-prereq` 는 실행 주체가 GCP project를 resolve 할 수 있는지, Cloud Scheduler job list를 읽을 수 있는지, `donbeolja`/`donbeolja-exit-worker` Cloud Run service describe를 읽을 수 있는지 확인한다.

이 preflight가 실패하면 checklist `24` 는 scheduler 상태 문제가 아니라 collector 권한/환경 문제로 분류하고, `SCHED_TRAFFIC_COLLECTOR_PREREQ_*` 실패 check id를 먼저 해소해야 한다.

Cloud Build의 promotion runtime은 `gcloud` 와 `node/npm` 을 같은 step에서 사용할 수 있어야 한다.

`npm run check:v2-production-runtime-config` 는 이 조건을 `CLOUDBUILD_PROMOTION_RUNTIME_HAS_GCLOUD_AND_NODE` 로 검사한다.

submit trace에서 `SUBMIT_CHK_17` 은 `SCHEDULER_COLLECTOR_BLOCKER`, `SUBMIT_CHK_16` 은 `SCHEDULER_TRAFFIC_BLOCKER` 로 분리되어야 한다.

두 경우를 `PRODUCTION_CUTOVER_BLOCKER` 로 처리하면 원인 분류가 다시 V1처럼 뭉개진 것이므로 artifact를 신뢰하지 않는다.

수동 JSON은 긴급 디버깅 예외이며, submit 직전 정본은 collector 산출물이어야 한다.

이 파일이 없거나 `DONBEOLJA_V2_ENABLED=1`, `DONBEOLJA_V2_DRY_RUN=0`, `DONBEOLJA_V2_CANARY_ONLY=0`, `DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=1` 조건이 깨지면 LIVE runbook review는 실패해야 한다.

LIVE 전환 전에는 별도로 `npm run check:v2-production-runtime-config` 도 통과해야 한다.

이 검사는 실제 Cloud Run deploy step이 아래 V2 cutover env를 substitution으로 받을 수 있는지 확인한다.

1. `DONBEOLJA_V2_ENABLED`
2. `DONBEOLJA_V2_DRY_RUN`
3. `DONBEOLJA_V2_CANARY_ONLY`
4. `DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER`
5. `DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL`
6. `DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL`
7. `DONBEOLJA_V2_COLLECTION_PREFIX`
8. `DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE`
9. `SCHEDULER_AUTOSTART`
10. `DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED`
11. `DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED`
12. `DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE`

즉, `SUBMIT_CHK_15` 가 LIVE readiness를 증명해도 Cloud Build deploy env가 이 값을 서비스에 전달하지 못하면 cutover는 금지된다.

V2 cutover의 scheduler 정본은 `OPENCLAW_CRON` 이다.

따라서 Cloud Run 서비스의 `SCHEDULER_AUTOSTART` 는 `0` 이어야 하며, 서버 내장 scheduler가 OpenClaw cron과 동시에 entry/automation tick을 만들면 안 된다.
5. bounded runtime 계열 fail이면 selector/collector/exporter artifact를 다시 만든다

### 1. artifact 디렉터리 고정

```bash
export V2_PROMOTION_ARTIFACT_DIR="tmp/v2-promotion-artifacts/<position-cycle-id>"
```

한 cycle당 한 artifact 디렉터리를 쓴다.

### 2. dry-run preflight

```bash
export V2_PROMOTION_MODE=CANARY
export V2_PROMOTION_SELECT_POSITION_CYCLE_ID="<position-cycle-id>"
npm run check:v2-promotion-canary-preflight
```

통과 기준:

1. `promotion-preflight.json.ok = true`
2. `snapshot_counts = 1 / 1 / 1`
3. `selector_meta.alignment_checks.* = true`
4. `lineage_contract.hash` 가 이후 manifest / deploy decision까지 유지되는가

### 3. bounded canary flow

```bash
npm run run:v2-promotion-canary-flow
```

통과 기준:

1. `promotion-canary-flow.json.ok = true`
2. `promotion-canary-flow.json.stage = PIPELINE_PASS`
3. `promotion-preflight.json.position_cycle_id` 와 `promotion-canary-flow.json.position_cycle_id` 가 동일
4. `promotion-runtime-manifest.json.snapshot_meta.selector_meta.position_cycle_id` 가 입력 cycle과 동일
5. `replay-report.json.episode_n`, `shadow-live-comparison.json.pair_n`, `source-mode-comparison.json.pair_n` 이 manifest count와 동일
6. `promotion-deploy-decision.json.approved = true`
7. `promotion-preflight.json.lineage_contract.hash` 와 `promotion-deploy-decision.json.bounded_runtime_summary.lineage_contract.hash` 가 동일

### 4. Cloud Build bounded canary

Cloud Build에서는 개별 script를 직접 조합하지 않는다.

반드시 `run:v2-promotion-cloudbuild` wrapper 하나만 사용한다.
실제 제출 request를 만들 때도 `submit:v2-promotion-cloudbuild` wrapper 하나만 사용한다.

필수 substitutions:

1. `_V2_PROMOTION_CANARY_FLOW_ENABLED=1`
2. `_V2_PROMOTION_MODE=CANARY`
3. `_V2_PROMOTION_SELECT_POSITION_CYCLE_ID=<position-cycle-id>`
4. `_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1`
5. `_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED=1`
6. `_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED=1`
7. `_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE=FIRESTORE`

권장 사항:

1. `_V2_PROMOTION_ARTIFACT_DIR` 를 비우면 wrapper가 `tmp/v2-promotion-artifacts/canary_flow/<position-cycle-id>` 로 자동 고정한다
2. `_V2_PROMOTION_ARTIFACT_DIR` 를 직접 넣을 경우 path 안에 같은 `position-cycle-id` 가 포함되어야 한다
3. wrapper는 실행 후 `promotion-deploy-decision.json` 을 직접 읽고 `approved = true` 가 아니면 즉시 실패한다
4. bounded explicit cycle 경로에서는 wrapper가 `check:v2-canary-runbook` 을 자동 실행하고 `promotion-runbook-review.json.ok = true` 가 아니면 즉시 실패한다
5. auto-select 경로에서는 runtime이 먼저 candidate를 선택한 뒤 `<requested-artifact-dir>/<selected-position-cycle-id>` 로 bounded artifact dir를 finalize 하고, 그 final dir 기준으로 wrapper가 `check:v2-canary-runbook` 을 자동 실행해야 한다
6. `submit:v2-promotion-cloudbuild` 는 bounded CANARY/LIVE 제출 request에서 `_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` 을 자동 설정한다
7. `submit:v2-promotion-cloudbuild` 는 bounded CANARY/LIVE 제출 request에서 production entry route canary Firestore write/read/source env를 자동으로 `1/1/FIRESTORE` 로 설정한다
8. promotion pipeline은 unified report 생성 직전에 `v2_repair_queue_firestore_canary_streak_latest.json` 를 artifact dir 안에 다시 생성하므로, submit 판단은 외부 latest 파일이 아니라 해당 승격 실행에서 갱신한 repair streak를 읽어야 한다
9. LIVE 제출은 `bounded_runtime_summary.repair_firestore_canary_streak` 이 24시간 Firestore-backed repair canary streak pass를 증명해야 하며, CANARY에서는 같은 증거가 없으면 warning으로만 남긴다
10. promotion pipeline은 unified report 생성 직전에 `v2_production_entry_route_canary_streak_latest.json` 를 artifact dir 안에 다시 생성하므로, submit 판단은 외부 latest 파일이 아니라 해당 승격 실행에서 갱신한 production route streak를 읽어야 한다
11. LIVE 제출은 `bounded_runtime_summary.production_entry_route_canary_streak.history_source=FIRESTORE` 를 요구하므로, CANARY 기간에 먼저 durable canary history를 누적해야 한다

로컬 제출 request 생성 예시:

```bash
GOOGLE_CLOUD_PROJECT=donbeolja-dev \
V2_PROMOTION_CANARY_FLOW_ENABLED=1 \
V2_PROMOTION_MODE=CANARY \
V2_PROMOTION_SELECT_POSITION_CYCLE_ID="<position-cycle-id>" \
V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED=0 \
npm run submit:v2-promotion-cloudbuild
```

위 명령은 실제 제출 대신 `promotion-cloudbuild-submit-request.json` 만 남긴다.

이 request 안에는 `approval_evidence_sources` 도 같이 남아야 한다.

즉, 제출 전에 operator가 “최종적으로 어느 파일의 어느 필드를 보고 PASS 여부를 판단해야 하는가”를 request 한 장으로 복원할 수 있어야 한다.

또한 `approval_verification.ok = true` 가 아니면 submit 단계로 넘어가면 안 된다.

즉, submit wrapper는 이제 계획만 쓰는 도구가 아니라, 현재 artifact가 정말 그 계획을 만족하는지 마지막으로 차단하는 fail-closed 검증기여야 한다.

동시에 `approval_verification.blocker_summary` 와 `recommended_next_action` 도 같이 읽어야 한다.

즉, submit 차단이 발생했을 때도 provenance / bounded runtime / runbook / context / candidate 중 어느 계열이 문제인지 즉시 분류돼야 하고, 다음 행동도 고정돼 있어야 한다.

또한 `approval_verification.checks[].doc_refs.runbook_checklist` 를 같이 읽어야 한다.

즉, submit 단계에서 나온 `SUBMIT_CHK_*` 실패가 runbook의 몇 번 항목과 연결되는지 즉시 보여줘야 하며, operator가 마지막 단계에서 다시 번호를 수작업으로 대응시키지 않게 해야 한다.

동시에 `promotion-cloudbuild-submit-request.json.submit_trace_summary` 도 같이 읽어야 한다.

즉, submit request를 열자마자 어떤 `SUBMIT_CHK_*` 가 실제로 실패했는지, runbook 몇 번을 다시 보면 되는지, 어느 계열 문제인지 top-level에서 먼저 보여줘야 한다.

동시에 `submit_trace_summary.alert_retry_attention_required`, `submit_trace_summary.alert_retry_summary`, `submit_trace_summary.alert_runbook_refs` 도 같이 읽어야 한다.

즉, submit 자체는 통과했더라도 alert 운영 이슈가 남아 있으면 operator가 request 한 장만 보고 바로 family / pending / runbook ref를 복원해야 한다.

동시에 `submit_trace_summary.recommended_next_action_reason_code` 도 같이 읽어야 한다.

즉, submit 단계에서도 사람용 설명과 정규 분류 code가 같이 남아 wording drift를 막아야 한다.

CLI stdout/stderr 에서도 같은 `submit_trace_summary` 구조가 보여야 한다.

즉, operator가 submit 차단을 콘솔에서 먼저 봤더라도 같은 번호 체계와 계열 분류로 바로 runbook에 되돌아올 수 있어야 한다.

가능하면 같은 출력에는 `operator_summary` 도 같이 보여야 한다.

즉, 운영 채널이 바뀌어도 headline, blocker family, runbook 번호, 다음 행동이 같은 구조에서 바로 재사용돼야 한다.

이때 `operator_summary.status=READY_WITH_ALERT_ATTENTION` 은 `BLOCKED` 와 별도 상태로 유지해야 한다.

이때 `operator_summary.status=READY_WITH_DEPLOY_WARNING` 은 CANARY는 승인됐지만 LIVE 전 확인이 남은 상태다.

즉, submit 차단, alert 운영 주의, LIVE readiness warning을 같은 headline으로 뭉개면 안 된다.

가능하면 실제 운영 채널 발송은 `operator_summary.lines` 를 그대로 재사용해야 한다.

즉, 채널별로 한국어 문장을 다시 조립하지 말고, 표준 라인셋을 같은 순서로 재사용해야 한다.

가능하면 더 직접적으로는 `operator_summary.text` 를 그대로 재사용해야 한다.

즉, 발송 직전에 `lines.join("\\n")` 를 다시 구현하는 작은 차이조차도 다시 drift 지점이 되지 않게 해야 한다.

같은 이유로 채널 구현은 `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/v2-promotion-operator-summary.js` 를 기준 포맷터로 재사용해야 한다.

이 조건이 깨지면 `/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-promotion-submit-contract.js` 가 즉시 fail 되어야 한다.

실제 운영 채널 전송 직전에는 `promotion-cloudbuild-submit-request.json.operator_alert_preview` 를 우선 사용해야 한다.

즉, 제목/심각도/section 구성도 `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/v2-promotion-submit-operator-alert.js` 정본을 그대로 재사용해야 하며, 채널에서 다시 조립하지 않는다.

`READY_WITH_DEPLOY_WARNING` 상태도 이 규칙의 예외가 아니다.

즉, CANARY는 승인됐지만 LIVE 전 확인이 남은 상태를 renderer/Telegram 경로에서 `READY` 로 축약하면 안 된다.

LIVE submit에서 `promotion-cloudbuild-context.json.live_cutover_readiness_summary` 가 존재하면 `submit_trace_summary`, `operator_summary.lines`, `operator_alert_preview.sections[].lines` 에도 `live_cutover_*` 라인이 그대로 남아야 한다.

즉, LIVE 전환 env plan이 Cloud Build context에는 있는데 최종 CLI/Telegram 직전 요약에서는 보이지 않는 상태를 허용하지 않는다.

`/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-promotion-submit-contract.js` 는 이 조건을 operator summary와 alert preview trace 양쪽에서 모두 검사해야 한다.

실제 전송은 `/Users/jeongjaeyong/Projects/donbeolja/scripts/send-v2-promotion-submit-operator-alert.js` wrapper만 사용한다.

즉, 운영자가 전송 직전에 title/body를 다시 만들지 않고, preview -> render -> send 한 경로만 사용해야 한다.

submit artifact에서는 `operator_alert_delivery` 까지 같이 확인한다.

즉, 전송이 활성화된 경우 실제 transport 결과까지 같은 request 파일에 남아 있어야 하며, 전송이 비활성화된 경우에도 dry-run 결과가 남아 있어야 한다.

동시에 `operator_delivery_summary` 도 같이 확인한다.

즉, wrapper 출력 한 번만 보고도 `READY_NOT_SENT`, `DELIVERED`, `DELIVERY_SKIPPED`, `DELIVERY_FAILED` 중 어느 상태인지 즉시 판독돼야 한다.

## 산출물

필수 산출물:

1. `promotion-preflight.json`
2. `promotion-collector-inputs.json`
3. `promotion-runtime-snapshot.json`
4. `promotion-runtime-manifest.json`
5. `replay-report.json`
6. `shadow-live-comparison.json`
7. `source-mode-comparison.json`
8. `unified-promotion-report.json`
9. `promotion-deploy-decision.json`
10. `promotion-canary-flow.json`

optional review artifact:

1. `promotion-runbook-review.json`

`run:v2-promotion-canary-flow` 는 내부적으로 preflight를 다시 수행하고 같은 artifact 디렉터리에 `promotion-preflight.json` 을 남긴다.

동시에 pipeline 단계는 preflight에서 이미 확정한 `collector_env` 와 `lineage_contract` 를 그대로 재사용해야 한다.

즉, 같은 cycle이라도 selector를 다시 태워 `recent_cutoff_at`, linked doc, feature snapshot이 조용히 바뀌는 경로를 허용하지 않는다.

auto-select 경로에서는 request 단계의 staging artifact dir와 최종 bounded artifact dir가 다를 수 있다.

이 경우 `promotion-canary-flow.json` 의 `requested_artifact_dir` 와 `artifact_dir` 를 함께 읽어야 한다.

즉, 선택 전 staging 경로와 선택 후 bounded 경로가 문서상으로도 분리돼야 V1처럼 provenance 축이 다시 섞이지 않는다.

즉, 사람이 preflight 결과를 따로 복사하거나 재조립할 여지가 없다.

최종 승격 판단은 개별 report 3개를 따로 읽는 대신 `unified-promotion-report.json` 하나를 기준으로 읽는다.

실제 배포 가능 여부는 `promotion-deploy-decision.json` 하나를 기준으로 읽는다.

따라서 `promotion-deploy-decision.json` 에는 승인 여부만이 아니라 `bounded_runtime_summary`, `candidate_selection_summary` 도 같이 남아야 한다.

`bounded_runtime_summary` 안에는 `evidence_snapshot_summary` 도 반드시 같이 남아야 한다.
이 summary는 exporter가 실제 runtime snapshot `episodes` 본문을 읽어 계산한 raw exchange evidence coverage다.
즉, canary/live 승격은 query budget만 맞는다고 통과하면 안 되고 transition evidence와 protection runtime evidence coverage까지 함께 확인해야 한다.

즉, 운영자는 마지막 파일 하나만 열어도 bounded provenance와 candidate 선택 맥락까지 함께 확인할 수 있어야 한다.

제출 wrapper 단계에서는 `promotion-cloudbuild-context.json` 이 같은 정보를 wrapper 관점 요약으로 한 번 더 남겨야 한다.

즉, 제출 직전에도 mode, script, artifact_dir, deploy decision summary, bounded summary, candidate summary를 한 파일에서 확인할 수 있어야 한다.

이때 `promotion-cloudbuild-context.json.lineage_contract_hash` 도 같이 남겨야 한다.

즉, operator가 submit 직전 파일 하나만 열어도 지금 제출하려는 bounded artifact의 lineage hash를 즉시 읽을 수 있어야 한다.

auto-select runtime finalize 경로에서는 같은 context file에 `requested_artifact_dir` 와 `resolved_artifact_dir` 가 함께 남아야 한다.

즉, operator가 staging dir를 열어도 최종 bounded dir가 어디인지 즉시 복원 가능해야 한다.

`promotion-cloudbuild-context.json.final_status_line` 은 operator가 마지막 상태를 한 줄로 읽는 필드다.

즉, 승인 상태, cycle id, blocker / warning count, top blockers 일부를 파일 첫 판독 포인트로 제공해야 한다.

`promotion-cloudbuild-context.json.recommended_next_action` 은 마지막 문서를 본 뒤 operator가 취해야 할 다음 행동을 고정한 필드다.

즉, provenance/candidate/bounded/watchdog 계열 blocker마다 사람 임의 해석 대신 정해진 다음 행동을 먼저 제시해야 한다.

`promotion-cloudbuild-context.json.recommended_next_action_reason` 은 그 행동이 왜 선택됐는지 설명하는 필드다.

즉, operator가 다음 행동뿐 아니라 그 행동의 근거까지 같은 문서에서 확인할 수 있어야 한다.

동시에 `promotion-cloudbuild-context.json.recommended_next_action_reason_code` 도 같이 읽어야 한다.

즉, 자유문 설명이 조금 바뀌더라도 runbook과 code가 같은 정규 분류를 유지하는지 즉시 확인할 수 있어야 한다.

또한 `deploy_decision_summary.blocker_summary` 로 operator가 blocker 계열을 즉시 식별할 수 있어야 한다.

즉, raw blocker 배열을 다 읽기 전에 provenance/watchdog/candidate/bounded 계열 중 무엇이 문제인지 먼저 보여줘야 한다.

동시에 `promotion-cloudbuild-context.json.submit_trace` 도 같이 읽어야 한다.

즉, submit wrapper 단계까지 가지 않아도 현재 context 기준으로 어떤 `SUBMIT_CHK_*` 가 이미 깨졌는지, runbook 몇 번을 다시 보면 되는지, 어느 계열 문제인지 즉시 복원할 수 있어야 한다.

또한 `CANARY/LIVE` 에서는 `bounded_runtime_summary` 의 핵심 필드가 비어 있으면 마지막 승인 단계에서 즉시 차단돼야 한다.

`candidate_selection_summary` 가 있는 경우에는 `selected_position_cycle_id` 와 최종 `position_cycle_id` 가 다르면 마지막 승인 단계에서 즉시 차단돼야 한다.

bounded explicit cycle 경로에서는 wrapper가 같은 artifact dir에 `promotion-runbook-review.json` 도 남겨야 한다.

auto-select runtime finalize 경로에서도 최종 bounded artifact dir에는 같은 `promotion-runbook-review.json` 이 남아야 한다.

wrapper는 runbook review가 실패해도 `promotion-cloudbuild-context.json` 을 다시 써서 `runbook_review_summary.ok=false`, `failed_check_ids`, `top_failed_checks[]`, `runbook_review_file` 을 남겨야 한다.

필수 artifact 누락이나 JSON 파싱 오류로 `promotion-runbook-review.json` 생성 전 단계에서 중단되어도 context에는 synthetic `CHK_RUNBOOK_REVIEW_THROWN` 이 남아야 한다.

submit wrapper의 operator summary와 operator alert preview는 `runbook_review`, `runbook_review_failures`, `runbook_review_failed_checks`, `runbook_review_file` 을 같은 값으로 노출해야 한다.

즉, deploy decision 승인 이후에도 runbook checklist coherence가 깨져 있으면 submit 단계로 넘어갈 수 없어야 한다.

## 실패 시 판정

### `PREFLIGHT:*`

cycle 자체가 bounded promotion 대상이 아니다.

즉시 pipeline 진행 금지.

### `PROVENANCE:*`

artifact 조각이 섞였거나, selector alignment가 깨졌거나, manifest/report count가 다르다.

즉시 artifact 디렉터리 폐기 후 다시 시작.

### `REPLAY:*` 또는 `COMPARISON:*`

promotion evidence가 아직 불충분하다.

이 경우 canary hold가 맞다.

## 운영 메모

이 runbook의 목적은 빠른 승격이 아니라 잘못된 승격 차단이다.

V1의 약점은 대부분 코드 내부보다 운영 절차에서 축이 섞이는 순간 시작됐다.

V2 canary는 반드시 아래 순서를 지킨다.

1. preflight
2. canary flow
3. artifact review
4. 그 다음에만 deploy 판단
