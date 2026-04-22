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
   submit trace-back: `SUBMIT_CHK_01A`
1A. `promotion-cloudbuild-context.json.artifact_dir` 와 `resolved_artifact_dir` 가 현재 최종 artifact dir와 같고, context/deploy/preflight/manifest cycle id가 모두 같은가. context의 `artifact_dir_coherence.ok` 도 같은 판단을 생성 시점에 이미 남기는가
    submit trace-back: `SUBMIT_CHK_01A`
2. preflight 없이 pipeline 또는 cloudbuild wrapper를 먼저 실행하지 않았는가
3. `promotion-preflight.json.ok = true` 인가
4. `promotion-canary-flow.json.ok = true` 인가
5. `promotion-runtime-manifest.json.snapshot_meta.selector_meta.position_cycle_id` 가 입력 cycle과 같은가
6. `unified-promotion-report.json.position_cycle_id` 가 같은가
7. `promotion-deploy-decision.json.approved = true` 인가
   submit trace-back: `SUBMIT_CHK_02`
8. `promotion-deploy-decision.json.bounded_runtime_summary` 핵심 필드가 모두 존재하는가
   submit trace-back: `SUBMIT_CHK_03`
9. `promotion-deploy-decision.json.selector_meta.position_cycle_id`, `candidate_selection_summary.selected_position_cycle_id`, `candidate_selection_summary.selected_preflight.position_cycle_id`, 최종 `position_cycle_id` 가 같은가
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
14B. `promotion-deploy-decision.json.production_runtime_chain_audit` 가 존재하고 `ok=true`, `reason=V2_PRODUCTION_RUNTIME_CHAIN_AUDIT_PASS`, `contract.fail_n=0` 인가
    submit trace-back: `SUBMIT_CHK_04C`
15. `promotion-deploy-decision.json.candidate_selection_summary.selection_contract` 가 존재하고 `selected_runtime_chain_ok` 를 포함한 모든 계약 플래그가 `true` 인가
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
| 1 | `SUBMIT_CHK_01A` | `promotion-cloudbuild-context.json`, `promotion-deploy-decision.json`, `promotion-preflight.json`, `promotion-runtime-manifest.json` | `artifact_dir`, `resolved_artifact_dir`, `position_cycle_id`, `snapshot_meta.selector_meta.position_cycle_id` | request artifact dir, context artifact/resolved dir, deploy/preflight/manifest/context cycle id가 모두 같은 최종 bounded dir를 가리킴 | artifact dir 폐기 후 preflight부터 다시 시작 |
| 1A | `SUBMIT_CHK_01A` | `promotion-cloudbuild-context.json`, `promotion-deploy-decision.json`, `promotion-preflight.json`, `promotion-runtime-manifest.json` | `artifact_dir`, `resolved_artifact_dir`, `artifact_dir_coherence`, `position_cycle_id`, `snapshot_meta.selector_meta.position_cycle_id` | automated verifier `CHK_01A` 가 `PASS` 이고 context writer가 `artifact_dir_coherence.ok=true` 를 남김 | artifact dir 폐기 후 preflight부터 다시 시작 |
| 3 | - | `promotion-preflight.json` | `ok` | `true` | preflight부터 다시 시작 |
| 4 | - | `promotion-canary-flow.json` | `ok`, `stage` | `ok=true`, `stage=PIPELINE_PASS` | canary flow 재실행 |
| 5 | - | `promotion-runtime-manifest.json` | `snapshot_meta.selector_meta.position_cycle_id` | 입력 `position_cycle_id` 와 동일 | artifact dir 폐기 후 preflight부터 다시 시작 |
| 6 | - | `unified-promotion-report.json` | `position_cycle_id` | 입력 `position_cycle_id` 와 동일 | unified report 생성 축 재검토 |
| 7 | `SUBMIT_CHK_02` | `promotion-deploy-decision.json` | `approved` | `true` | deploy decision blocker 검토 후 중단 |
| 8 | `SUBMIT_CHK_03` | `promotion-deploy-decision.json` | `bounded_runtime_summary.selector_query_budget`, `collector_query_budget`, `exporter_snapshot_size_bytes`, `manifest_counts` | 네 묶음 모두 존재 | bounded runtime artifact 재생성 |
| 9 | - | `promotion-deploy-decision.json` | `selector_meta.position_cycle_id`, `candidate_selection_summary.selected_position_cycle_id`, `candidate_selection_summary.selected_preflight.position_cycle_id`, `position_cycle_id` | 네 값이 동일. 불일치 시 `DEPLOY_DECISION:SELECTOR_META_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:SELECTOR_CANDIDATE_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_POSITION_CYCLE_MISMATCH` 중 하나로 차단 | selected cycle 검토 후 canary flow 재실행 |
| 10 | - | `promotion-cloudbuild-context.json` | `final_status_line` | `APPROVE_DEPLOY` 로 시작 | final status와 deploy decision 불일치 검토 |
| 11 | `SUBMIT_CHK_06` | `promotion-cloudbuild-context.json` | `recommended_next_action` | `PROCEED_WITH_SUBMIT_WRAPPER` | action hint에 따라 중단/재실행 |
| 12 | - | `promotion-cloudbuild-context.json` | `recommended_next_action_reason` | `recommended_next_action` 및 blocker family와 모순 없음 | reason과 blocker family 재검토 |
| 13 | `SUBMIT_CHK_07` | `promotion-cloudbuild-context.json`, `promotion-deploy-decision.json` | `deploy_decision_summary.approved`, `deploy_decision_summary.position_cycle_id`, `deploy_decision_summary.blocker_n`, `deploy_decision_summary.warning_n`, `deploy_decision_summary.blocker_summary`, `deploy_decision_summary.warning_summary` | context의 deploy decision 요약이 현재 `promotion-deploy-decision.json`에서 재계산한 deploy 상태/카운터/계열 요약과 같고 `blocker_n=0` 이어야 함. lineage hash 일치는 `SUBMIT_CHK_08` 이 전담한다. 다르면 submit 시점에 deploy decision이 교체됐거나 context가 stale이므로 `SUBMIT_CHK_07` 로 차단 | deploy decision/context drift면 artifact dir 폐기 후 fresh promotion pipeline 재실행 |
| 13A | - | `promotion-cloudbuild-context.json` | `deploy_decision_summary.alert_retry_summary`, `deploy_decision_summary.alert_retry_attention_required`, `final_status_line` | alert summary와 한 줄 상태가 서로 모순 없음 | alert retry family/runbook ref 검토 |
| 13B | - | `promotion-cloudbuild-context.json`, `promotion-deploy-decision.json` | `deploy_decision_summary.warning_summary`, `submit_trace.deploy_warning_summary`, `submit_trace.deploy_warning_runbook_checklist`, `warnings`, `final_status_line` | warning count/top warning이 서로 일치. repair streak warning은 `has_repair_firestore_canary_streak_warning=true` 와 runbook 19, production route streak warning은 `has_production_entry_route_canary_streak_warning=true` 와 runbook 26으로 추적 가능해야 함. `submit_trace.deploy_warning_*` 도 같은 값을 가리켜야 함 | warning summary/trace drift면 artifact dir 폐기 후 cloudbuild context 재생성 |
| 13C | `SUBMIT_CHK_06`, `SUBMIT_CHK_07`, `SUBMIT_CHK_08`, `SUBMIT_CHK_20A`, `SUBMIT_CHK_23` | `promotion-cloudbuild-context.json` | `submit_trace.relevant_submit_check_ids`, `submit_trace.failed_submit_check_ids`, `submit_trace.failed_runbook_checklist`, `submit_trace.blocker_families`, `submit_trace.primary_blocker_family`, `submit_trace.recommended_next_action_reason_code`, `submit_trace.checks[]`, `lineage_consistency_summary` | context 기준 submit 차단 상태가 trace에 그대로 반영. `SUBMIT_CHK_08` 은 hash 존재가 아니라 `lineage_consistency_summary.ok=true` 와 일치해야 함. 기본 relevant는 06/07/08, runbook은 11/13/16/17 이다. 보호주문 canary blocker가 있으면 `SUBMIT_CHK_20A` 와 runbook `27A`, OpenClaw supreme blocker가 있으면 `SUBMIT_CHK_23` 과 runbook `31` 도 context trace에 포함되어야 함 | submit trace drift면 wrapper 제출 금지, cloudbuild context 재생성 |
| 13D | `SUBMIT_CHK_06`, `SUBMIT_CHK_07` | `promotion-cloudbuild-context.json` | `blocker_summary.has_stale_artifact_provenance_blocker`, `submit_trace.blocker_families`, `recommended_next_action_reason_code`, `final_status_line` | stale artifact blocker가 있으면 `has_stale_artifact_provenance_blocker=true`, `submit_trace.blocker_families` 에 `STALE_ARTIFACT_PROVENANCE`, `recommended_next_action_reason_code=STALE_ARTIFACT_PROVENANCE_BLOCKER`, `final_status_line` 에 `stale_artifact=BLOCKED` 가 남아야 함. stale 판정은 파일 경로 mismatch뿐 아니라 `generated_at`/`artifact_generated_at` 누락 또는 `artifact_generated_age_minutes` 초과도 포함함 | artifact dir 폐기 후 fresh promotion pipeline을 재실행. 과거 latest artifact 재사용 금지 |
| 13E | `SUBMIT_CHK_06`, `SUBMIT_CHK_07` | `promotion-cloudbuild-context.json` | `blocker_summary.has_live_evidence_cycle_blocker`, `submit_trace.blocker_families`, `recommended_next_action_reason_code`, `final_status_line`, `operator_summary.lines[]`, `operator_alert_preview.sections[]` | LIVE evidence cycle blocker가 있으면 `has_live_evidence_cycle_blocker=true`, `submit_trace.blocker_families` 에 `LIVE_EVIDENCE_CYCLE`, `recommended_next_action_reason_code=LIVE_EVIDENCE_CYCLE_BLOCKER`, `final_status_line` 에 `live_evidence_cycle=BLOCKED`, 운영자 요약/알림 trace에 `live_evidence_cycle_blocker=YES` 가 남아야 함 | 서로 다른 cycle의 LIVE 증거가 섞인 상태이므로 artifact dir 폐기 후 같은 `position_cycle_id` 로 fresh promotion pipeline 전체 재실행 |
| 13F | `SUBMIT_CHK_06`, `SUBMIT_CHK_07`, `SUBMIT_CHK_23` | `promotion-cloudbuild-context.json` | `blocker_summary.has_openclaw_supreme_control_plane_blocker`, `submit_trace.blocker_families`, `submit_trace.recommended_next_action_reason_code`, `submit_trace.checks[]`, `final_status_line` | OpenClaw supreme blocker가 있으면 `has_openclaw_supreme_control_plane_blocker=true`, `submit_trace.blocker_families` 에 `OPENCLAW_SUPREME_CONTROL_PLANE`, `recommended_next_action_reason_code=OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER`, `submit_trace.checks[]` 에 `SUBMIT_CHK_23`/runbook `31`, `final_status_line` 에 `openclaw_supreme=BLOCKED` 가 남아야 함 | OpenClaw decision -> permit -> outcome -> learner shadow -> collector lineage closed-loop가 닫히지 않았으므로 해당 evidence를 복구하고 deploy decision 및 CloudBuild context를 다시 생성 |
| 13G | `SUBMIT_CHK_04C`, `SUBMIT_CHK_11`, `SUBMIT_CHK_19`, `SUBMIT_CHK_20A`, `SUBMIT_CHK_21`, `SUBMIT_CHK_23`, `SUBMIT_CHK_24`, `SUBMIT_CHK_06`, `SUBMIT_CHK_07` | `v2_live_evidence_readiness_latest.json`, `promotion-cloudbuild-context.json`, `promotion-cloudbuild-submit-request.json`, `promotion-deploy-decision.json` | `live_evidence_readiness_summary`, `live_evidence_readiness_file`, `axes[]`, `failed_axis_ids`, `submit_check_ids`, `runbook_refs`, `temporal_coherence`, `deploy_ready` | LIVE cloudbuild wrapper가 현재 artifact dir의 `promotion-deploy-decision.json` 을 읽어 `v2_live_evidence_readiness_latest.json` 을 생성하고 context와 submit request의 `live_evidence_readiness_summary` 에 보존해야 한다. runbook verifier는 artifact와 `promotion-cloudbuild-context.json.live_evidence_readiness_summary/file` 이 같은 파일/position cycle을 가리키고, production runtime chain, repair 24h streak, production entry route 24h streak, exit runtime 24h streak, protected entry canary, OpenClaw supreme closed loop, temporal/cycle coherence가 한 번에 PASS인지 독립 검증해야 함 | 실패한 `failed_axis_ids` 를 기준으로 해당 submit check와 runbook 번호를 먼저 수정. `SUBMIT_CHK_24` 또는 `CHK_13G` 가 실패하면 live evidence readiness summary가 누락/만료/실패/context drift 상태이므로 같은 artifact dir에서 CloudBuild wrapper를 재생성하거나 fresh promotion pipeline을 다시 실행 |
| 14 | `SUBMIT_CHK_04` | `promotion-deploy-decision.json` | `bounded_runtime_summary.evidence_snapshot_summary.ok`, `missing_transition_evidence_n`, `missing_protection_runtime_evidence_n` | `ok=true`, 두 누락 카운트 `0` | runtime snapshot/exporter부터 다시 생성 |
| 14A | `SUBMIT_CHK_04B` | `promotion-deploy-decision.json` | `bounded_runtime_summary.runtime_chain_audit_summary.ok`, `check_n`, `fail_n`, `failed_check_ids` | `ok=true`, `check_n > 0`, `fail_n=0`, `failed_check_ids=[]` | runtime chain audit 생성 경로와 entry/protection/reducer/alert 연결 불변식 재검토 |
| 14B | `SUBMIT_CHK_04C` | `promotion-deploy-decision.json` | `production_runtime_chain_audit.ok`, `reason`, `scope`, `contract.reason`, `contract.fail_n`, `contract.failed_check_ids` | `ok=true`, `reason=V2_PRODUCTION_RUNTIME_CHAIN_AUDIT_PASS`, `scope=production_runtime_chain`, `contract.reason=V2_PRODUCTION_RUNTIME_CHAIN_PASS`, `contract.fail_n=0`, `contract.failed_check_ids=[]` | production runtime chain source audit를 다시 실행하고 entry/protection/fill/reducer/tick/trail/alert/watchdog/repair 중 깨진 계열을 먼저 수정 |
| 15 | `SUBMIT_CHK_09` | `promotion-deploy-decision.json` | `candidate_selection_summary.selection_contract.ok`, `scan_limit_respected`, `recent_window_enforced`, `selected_candidate_present`, `selected_preflight_ok`, `selected_runtime_chain_ok`, `selected_cycle_matches_preflight`, `selected_cycle_matches_collector_env`, `selected_snapshot_counts_exact` | 모든 값 `true` | auto-select 결과 폐기 후 candidate selector부터 다시 시작 |
| 16 | `SUBMIT_CHK_08` | `promotion-preflight.json`, `promotion-runtime-manifest.json`, `promotion-deploy-decision.json` | `lineage_contract.hash` | 세 hash가 동일 | artifact dir 폐기 후 preflight부터 다시 시작 |
| 17 | `SUBMIT_CHK_08` | `promotion-cloudbuild-context.json`, `promotion-deploy-decision.json` | `lineage_consistency_summary`, `lineage_contract_hash`, `bounded_runtime_summary.lineage_contract.hash` | context lineage consistency가 PASS이고 두 hash가 동일 | submit 직전 wrapper provenance 재검토 후 중단 |
| 18 | `SUBMIT_CHK_10` | `promotion-deploy-decision.json` | `bounded_runtime_summary.openclaw_execution_audit_ledger_write.reason`, `skipped`, `doc_id` | `reason=OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN`, `skipped=false`, `doc_id` 존재 | collector env의 `DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` 여부와 Firestore ledger write 실패 원인 재검토 |
| 19 | `SUBMIT_CHK_11` | `promotion-deploy-decision.json`, `v2_repair_queue_firestore_canary_streak_latest.json` | `bounded_runtime_summary.repair_firestore_canary_streak.reason`, `artifact_file`, `artifact_dir`, `artifact_filename`, `artifact_current_dir_match`, `generated_at`, `artifact_generated_at`, `artifact_generated_age_minutes`, `healthy_run_n`, `firestore_evidence_missing_n`, `blockers` | LIVE만 필수. `artifact_filename=v2_repair_queue_firestore_canary_streak_latest.json`, `artifact_current_dir_match=true`, `reason=V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS`, `generated_at`/`artifact_generated_at` 존재, `artifact_generated_age_minutes <= max_gap_minutes`, `healthy_run_n >= min_run_count`, `firestore_evidence_missing_n=0`, `blockers=[]`. 각 healthy row는 `seed_write_n`, `seed_writes` 의 `POSITION_CYCLES`/`EXIT_RUNTIME_PROJECTIONS`/`PROTECTION_RUNTIME`/`REPAIR_REQUESTS`, `refresh_call_n`, `completion_attempts[].completion_ledger.execution_status=COMPLETED_SUCCESS`, `order_evidence[]` 를 포함해야 한다. 이 파일은 promotion pipeline이 unified report 직전에 같은 artifact dir에 갱신해야 함 | Firestore-backed repair canary collector history와 streak output을 재검토. 24시간 coverage 부족, deep Firestore evidence 누락, stale artifact면 LIVE 승격 금지 |
| 20 | `SUBMIT_CHK_12` | `promotion-cloudbuild-context.json`, `v2_repair_live_cutover_readiness_latest.json` | `live_cutover_readiness_summary`, `reason`, `auto_apply`, `mutates_environment`, `required_env_changes` | streak pass 후 `reason=V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT`, `auto_apply=false`, `mutates_environment=false`, env plan은 명시 승인 전 적용 금지. 실패 시에도 context에는 `live_cutover_readiness_summary.ok=false` 와 blocker/runbook ref가 남아야 함 | `check:v2-repair-live-cutover-readiness` 를 재실행하고 env 변경은 별도 승인 절차로만 적용 |
| 21 | `SUBMIT_CHK_13` | `promotion-deploy-decision.json` | `entry_boundary_audit.ok`, `reason`, `scope`, `violation_n` | `ok=true`, `reason=V2_ENTRY_BOUNDARY_AUDIT_PASS`, `scope=src/v2`, `violation_n=0`. `src/v2/entryBoundaryAudit.js` 는 `V2_TP0_EXIT_CONTRACT_FORBIDDEN` 를 포함해야 하며, `test:v2-promotion` 은 `v2-entry-boundary-audit.test.js` 를 실행해 V2 source의 TP0/P0/`EXIT_TP_P0` 재도입을 차단해야 함 | V2 entry submit/transport/protection 경계 위반 파일을 수정하고 `check:v2-entry-boundary` 및 deploy decision을 다시 실행. TP0 계열 위반이면 legacy exit contract를 V2로 되살린 것이므로 제거 후 재검증 |
| 22 | `SUBMIT_CHK_14` | `promotion-deploy-decision.json` | `production_cutover_audit.ok`, `reason`, `scope`, `contract.fail_n`, `contract.checks[]` | `ok=true`, `reason=V2_PRODUCTION_CUTOVER_AUDIT_PASS`, `scope=production_webhook_cutover`, `contract.fail_n=0`. `V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_OPENCLAW_LEGACY_AUTHORITY`, `V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_LEGACY_SIGNAL_WRITE`, `V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_LEGACY_IMMEDIATE_PROCESS` 가 모두 `ok=true` 이어야 함 | V2 production cutover guard route/import/outcome/실행순서 연결을 수정하고 `check:v2-production-cutover` 및 deploy decision을 다시 실행 |
| 23 | `SUBMIT_CHK_15` | `promotion-cloudbuild-context.json`, `v2_production_cutover_readiness_latest.json` | `production_cutover_readiness_summary`, `reason`, `guard_reason`, `legacy_webhook_blocked`, `v2_enabled`, `v2_dry_run`, `v2_canary_only` | LIVE만 필수. `reason=V2_PRODUCTION_CUTOVER_READINESS_PASS`, `legacy_webhook_blocked=true`, `guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED`, `v2_enabled=true`, `v2_dry_run=false`, `v2_canary_only=false`. 실패 시에도 context에는 `production_cutover_readiness_summary.ok=false` 와 `failed_check_ids` 가 남아야 함 | LIVE env cutover flags와 legacy webhook 차단 상태를 수정하고 `check:v2-production-cutover` 및 LIVE cloudbuild wrapper를 다시 실행 |
| 24 | `SUBMIT_CHK_16` | `promotion-cloudbuild-context.json`, `v2_scheduler_traffic_cutover_readiness_latest.json` | `scheduler_traffic_cutover_readiness_summary`, `scheduler_sot`, `missing_openclaw_job_ids`, `active_legacy_scheduler_job_n`, `cloud_run_services` | LIVE만 필수. readiness는 `reason=V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS`, `scheduler_sot=OPENCLAW_CRON`, `missing_openclaw_job_ids=[]`, `active_legacy_scheduler_job_n=0`, Cloud Run 서비스 traffic/revision/env 모두 ready | Cloud Scheduler/OpenClaw cron/Cloud Run traffic state를 수정한 뒤 `check:v2-scheduler-traffic-cutover` 및 LIVE cloudbuild wrapper를 다시 실행 |
| 24A | `SUBMIT_CHK_17` | `promotion-cloudbuild-context.json`, `v2_scheduler_traffic_collector_preflight_latest.json` | `scheduler_traffic_collector_preflight_summary`, `reason`, `project_id`, `region`, `service_names`, `required_env_exact_match_n`, `required_env_mismatch_n`, `required_env_names`, `failed_check_ids` | LIVE만 필수. collector preflight는 `reason=V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS`, context summary와 artifact file이 1:1로 맞아야 하며 Cloud Run service describe 결과에서 두 서비스 모두 `SCHEDULER_AUTOSTART=0`, `DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=OPENCLAW_CRON`, production-entry/exit-runtime canary Firestore write/read/source/require env가 exact value로 보여야 함. `required_env_exact_match_n >= 2`, `required_env_mismatch_n=0` 이어야 한다. collector preflight 실패 시에도 context에는 `scheduler_traffic_collector_preflight_summary.ok=false` 와 `failed_check_ids` 가 남아야 함 | collector 권한/환경 문제면 `SCHED_TRAFFIC_COLLECTOR_PREREQ_*` 를 먼저 해소하고 LIVE cloudbuild wrapper를 다시 실행 |
| 24B | `SUBMIT_CHK_05` | `promotion-runbook-review.json`, readiness artifact 5종 | `CHK_24B`, `artifact_current_dir_match`, `artifact_filename`, `generated_at`, `artifact_generated_at`, `artifact_generated_age_minutes` | LIVE만 필수. runbook verifier가 repair cutover, production cutover, scheduler collector, scheduler cutover, live evidence readiness artifact 5종의 current-dir provenance와 180분 이하 freshness를 독립 검증해야 함. 실패하면 submit wrapper는 runbook aggregate인 `SUBMIT_CHK_05` 로 막혀야 함 | stale latest artifact 재사용 가능성이 있으므로 artifact dir 폐기 후 fresh promotion pipeline 재실행 |
| 25 | `SUBMIT_CHK_18` | `promotion-deploy-decision.json` | `fill_sync_canonical_boundary_audit.ok`, `reason`, `scope`, `contract.fail_n`, `contract.failed_check_ids` | `ok=true`, `reason=V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS`, `scope=binance_fills_sync_canonical_boundary`, `contract.fail_n=0`, `contract.failed_check_ids=[]`. `test:v2-promotion` 은 `v2-fill-sync-canonical-boundary-audit.test.js` 를 실행해야 하며, `V2_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_EXPLICIT_ONLY` 는 V2 batch가 이미 canonical artifact를 쓴 뒤에는 `DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED=1` 이 켜져도 기존 canonical truth를 다시 쓰지 못한다는 것을 검증해야 함 | legacy fill sync canonical write 경계를 수정하고 `check:v2-fill-sync-canonical-boundary` 및 deploy decision을 다시 실행 |
| 26 | `SUBMIT_CHK_19` | `promotion-deploy-decision.json`, `v2_production_entry_route_canary_streak_latest.json` | `bounded_runtime_summary.production_entry_route_canary_streak.reason`, `artifact_file`, `artifact_dir`, `artifact_filename`, `artifact_current_dir_match`, `generated_at`, `artifact_generated_at`, `artifact_generated_age_minutes`, `history_source`, `history_file`, `healthy_run_n`, `blockers` | LIVE만 필수. `artifact_filename=v2_production_entry_route_canary_streak_latest.json`, `artifact_current_dir_match=true`, `reason=V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS`, `generated_at`/`artifact_generated_at` 존재, `artifact_generated_age_minutes <= max_gap_minutes`, `history_source=FIRESTORE`, `firestore_source_required=true`, `history_file` 은 V2 Firestore collection name, `healthy_run_n >= min_run_count`, `blockers=[]`, canary artifact는 `exchange_write_performed=false` 이어야 함. 이 파일은 promotion pipeline이 unified report 직전에 같은 artifact dir에 갱신해야 하며, promotion CI는 `v2-production-entry-route-canary-history.test.js` 로 history append/source 계약을 같이 검증해야 함 | OpenClaw cron의 V2 production route canary Firestore history와 streak output을 재검토. JSONL source 또는 stale artifact는 LIVE 승격 증거로 인정하지 않는다 |
| 27 | `SUBMIT_CHK_20` | `promotion-deploy-decision.json` | `production_cutover_audit.contract.checks[]` | `V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_RESOLVES_TRANSPORTS_BEFORE_ROUTE`, `V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REQUIRE_APPROVED_SIZING`, `V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REJECT_SIZING_CONFLICT`, `V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCK_DRY_RUN_CFG`, `V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_DO_NOT_EXPOSE_SECRETS`, `V2_PRODUCTION_ENTRY_LIVE_REQUEST_BUILDER_EMBEDS_SIZING` 가 모두 `ok=true` | live endpoint가 sizing 없이 route를 열 수 있거나 body/bundle sizing drift, secret/dry-run contract가 깨진 상태이므로 `check:v2-production-cutover` 및 deploy decision을 다시 실행 |
| 27A | `SUBMIT_CHK_20A` | `promotion-deploy-decision.json`, `v2_production_entry_protected_canary_latest.json` | `bounded_runtime_summary.production_entry_protected_canary.reason`, `artifact_file`, `artifact_dir`, `artifact_filename`, `artifact_current_dir_match`, `generated_at`, `artifact_generated_at`, `artifact_generated_age_minutes`, `route_result_summary.position_cycle_id`, `route_result_summary.runtime_health_status`, `sl_order_id`, `tp1_order_id`, `exchange_write_performed`, `live_endpoint_probe_summary.reason`, `live_endpoint_probe_summary.endpoint_enabled`, `live_endpoint_probe_summary.route_called`, `live_endpoint_probe_summary.transport_reason`, `live_endpoint_probe_summary.exchange_write_performed`, `approval_verification.blocker_summary.has_production_entry_protected_canary_blocker` | CANARY/LIVE 필수. promotion pipeline이 현재 artifact dir에 fresh no-exchange protected canary를 생성해야 하며, `artifact_filename=v2_production_entry_protected_canary_latest.json`, `artifact_current_dir_match=true`, `generated_at`/`artifact_generated_at` 존재, `artifact_generated_age_minutes <= 180`, `reason=V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS`, `runtime_health_status=HEALTHY`, SL/TP1 order id 존재, `exchange_write_performed=false` 이어야 함. 추가로 같은 artifact 안의 `live_endpoint_probe_summary` 가 `reason=V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED`, `endpoint_enabled=true`, `route_called=true`, `transport_reason=V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY`, `decision_mode=LIVE`, `runtime_enabled=true`, `runtime_dry_run=false`, `runtime_canary_only=false`, `exchange_write_performed=false` 를 증명해야 한다. LIVE에서는 `route_result_summary.position_cycle_id` 가 promotion `position_cycle_id` 와 같아야 하며, 다르면 `DEPLOY_DECISION:LIVE_PROTECTED_ENTRY_POSITION_CYCLE_MISMATCH` 로 fail-closed 된다. 실패 시 submit trace의 `primary_blocker_family` 는 `PROTECTED_ENTRY_CANARY` 여야 함 | route는 통과하지만 LIVE endpoint confirm/body/transport resolution, submitter/protection activation/runtime write 체인, stale canary 중 하나가 깨진 상태이므로 protected canary와 production route를 먼저 수정 |
| 28 | `SUBMIT_CHK_21` | `promotion-deploy-decision.json`, `v2_exit_runtime_canary_latest.json`, `v2_exit_runtime_canary_streak_latest.json` | `bounded_runtime_summary.exit_runtime_canary_streak.reason`, `artifact_file`, `artifact_dir`, `artifact_filename`, `artifact_current_dir_match`, `generated_at`, `artifact_generated_at`, `artifact_generated_age_minutes`, `history_source`, `firestore_source_required`, `coverage_minutes`, `latest_age_minutes`, `max_gap_minutes`, `max_observed_gap_minutes`, `long_run_quality_summary`, `tp1_missing_n`, `native_refresh_unhealthy_n`, `unprotected_window_violation_n`, `alert_silent_drop_n`, `alert_retry_unresolved_n`, `alert_outbox_integrity_gap_n`, `trail_activation_evidence_gap_n`, `blockers` | LIVE만 필수. 운영 collector는 먼저 `run:v2-exit-runtime-canary` 로 bounded read-only `v2_exit_runtime_canary_latest.json` 를 만들고 Firestore history에 적재해야 한다. streak는 `artifact_filename=v2_exit_runtime_canary_streak_latest.json`, `artifact_current_dir_match=true`, `generated_at`/`artifact_generated_at` 존재, `artifact_generated_age_minutes <= max_gap_minutes`, `reason=V2_EXIT_RUNTIME_CANARY_STREAK_PASS`, `history_source=FIRESTORE`, `firestore_source_required=true`, `long_run_quality_summary.status=PASS`, `coverage_minutes >= 1440`, `latest_age_minutes <= max_gap_minutes`, `max_observed_gap_minutes <= max_gap_minutes`, TP1 missing/native refresh/unprotected window/silent alert drop/alert retry unresolved/alert outbox integrity gap/trail activation evidence gap 결함 카운트 모두 `0`, `blockers=[]` 이어야 함. `alert_silent_drop_n` 은 outbox lineage 누락, `alert_retry_unresolved_n` 은 lineage는 맞지만 아직 `SENT`가 아닌 상태, `alert_outbox_integrity_gap_n` 은 transition별 outbox 중복, transition 없는 고아 outbox, position cycle drift를 뜻한다. `long_run_quality_summary` 의 coverage/freshness/defect counters는 top-level streak fields와 숫자까지 일치해야 하며, 요약 누락 또는 drift는 deploy decision에서 `DEPLOY_DECISION:EXIT_RUNTIME_CANARY_STREAK_REQUIRED` 로 차단되어야 한다. 이 파일은 promotion pipeline이 unified report 직전에 같은 artifact dir에 갱신해야 하며, promotion CI는 `v2-exit-runtime-canary-history.test.js` 로 durable history append/source 계약을 같이 검증해야 함 | exit runtime canary producer/Firestore history를 재검토. producer가 TP1 missing, native refresh unhealthy, 무보호 구간, silent alert drop, alert retry unresolved, alert outbox integrity gap, trail activation evidence gap을 하나라도 기록했거나 24시간 coverage가 부족하면 LIVE 승격 금지 |
| 29 | `SUBMIT_CHK_22` | `cloudbuild.yaml`, `promotion-cloudbuild-submit-request.json` | `approval_verification.production_runtime_config_summary`, `approval_contract.production_runtime_config_contract_required`, `approval_evidence_sources.production_runtime_config_contract` | CANARY/LIVE 필수. submit wrapper가 `auditWorkspaceV2ProductionRuntimeConfigContract` 를 직접 실행해 Cloud Run deploy env와 promotion runtime env forwarding 계약을 검증해야 한다. 실패 시 `primary_blocker_family=PRODUCTION_RUNTIME_CONFIG`, `recommended_next_action=FIX_V2_PRODUCTION_RUNTIME_CONFIG_AND_RECHECK_SUBMIT` 이어야 함 | `cloudbuild.yaml` 의 V2 cutover substitution/deploy env/runtime forwarding을 수정하고 `check:v2-production-runtime-config` 및 submit wrapper를 다시 실행 |
| 30 | `SUBMIT_CHK_07` | `promotion-deploy-decision.json` | `V2_PROMOTION_ARTIFACT_DIR`, `bounded_runtime_summary.repair_firestore_canary_streak.artifact_dir`, `bounded_runtime_summary.repair_firestore_canary_streak.position_cycle_id`, `bounded_runtime_summary.repair_firestore_canary_streak.artifact_generated_at`, `bounded_runtime_summary.production_entry_route_canary_streak.artifact_dir`, `bounded_runtime_summary.production_entry_route_canary_streak.position_cycle_id`, `bounded_runtime_summary.production_entry_route_canary_streak.artifact_generated_at`, `bounded_runtime_summary.exit_runtime_canary_streak.artifact_dir`, `bounded_runtime_summary.exit_runtime_canary_streak.position_cycle_id`, `bounded_runtime_summary.exit_runtime_canary_streak.artifact_generated_at`, `bounded_runtime_summary.production_entry_protected_canary.artifact_dir`, `bounded_runtime_summary.production_entry_protected_canary.route_result_summary.position_cycle_id`, `bounded_runtime_summary.openclaw_supreme_control_plane_summary.collector_execution_summary.artifact_dir`, `bounded_runtime_summary.openclaw_supreme_control_plane_summary.collector_execution_summary.position_cycle_id`, `bounded_runtime_summary.openclaw_supreme_control_plane_summary.collector_execution_summary.artifact_generated_at` | LIVE만 필수. 장시간 canary 3종, protected-entry proof 1종, OpenClaw supreme collector proof 1종은 모두 같은 artifact cycle을 가리켜야 하며, 그 artifact cycle은 실제 deploy decision을 쓰는 현재 artifact dir와 같아야 한다. 세 streak, protected-entry proof, OpenClaw supreme collector의 position cycle은 promotion position cycle과 같아야 한다. 추가로 장시간 canary 3종과 OpenClaw supreme collector의 `artifact_generated_at` 시각은 서로 30분 이내여야 한다. 깨지면 `DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH`, `DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:LIVE_PROTECTED_ENTRY_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:LIVE_OPENCLAW_SUPREME_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH` 중 하나로 fail-closed 된다 | 서로 다른 실행에서 나온 PASS 증거를 조합했거나 모든 증거가 같은 과거 artifact dir를 가리키는 상태이므로 artifact dir를 폐기하고 fresh promotion pipeline을 처음부터 재실행 |
| 31 | `SUBMIT_CHK_23` | `promotion-deploy-decision.json`, `promotion-cloudbuild-submit-request.json` | `bounded_runtime_summary.openclaw_supreme_control_plane_summary.ok`, `world_state_n`, `latest_world_state_hash`, `execution_permit_n`, `permit_validation_pass_n`, `permit_validation_fail_n`, `outcome_adjudication_n`, `outcome_unadjudicated_n`, `learner_shadow_summary.shadow_only_n`, `learner_shadow_summary.live_applied_n`, `learner_shadow_summary.stale_evaluation_n`, `learner_shadow_summary.max_evaluation_age_minutes`, `learner_shadow_summary.max_observed_evaluation_age_minutes`, `learner_shadow_summary.latest_evaluated_at`, `collector_execution_summary.status`, `collector_execution_summary.producer_script`, `collector_execution_summary.producer_scope`, `collector_execution_summary.source`, `collector_execution_summary.position_cycle_id`, `collector_execution_summary.openclaw_decision_id`, `collector_execution_summary.openclaw_execution_permit_ids`, `collector_execution_summary.openclaw_outcome_adjudication_ids`, `collector_execution_summary.artifact_file`, `collector_execution_summary.artifact_dir`, `collector_execution_summary.artifact_filename`, `collector_execution_summary.artifact_current_dir_match`, `collector_execution_summary.generated_at`, `collector_execution_summary.artifact_generated_at`, `collector_execution_summary.artifact_generated_age_minutes`, `collector_execution_summary.exchange_write_performed`, `lineage_consistency_summary.ok`, `expected_openclaw_decision_id`, `expected_position_cycle_id`, `expected_world_state_hash`, `expected_openclaw_execution_permit_ids`, `expected_openclaw_outcome_adjudication_ids`, `permit_lineage_mismatch_n`, `outcome_lineage_mismatch_n`, `learner_lineage_mismatch_n`, `blockers`, `operator_summary.lines[]`, `operator_alert_preview.sections[].lines[]` | LIVE만 필수. OpenClaw closed-loop가 world state hash, validated execution permit, outcome adjudication, shadow-only learner evaluation을 모두 증명해야 한다. 또한 permit, outcome, learner, collector provenance가 같은 OpenClaw decision, position cycle, world state hash 계열이어야 한다. `permit_validation_fail_n=0`, `outcome_unadjudicated_n=0`, `learner_shadow_summary.live_applied_n=0`, `learner_shadow_summary.stale_evaluation_n=0`, `0 < learner_shadow_summary.max_evaluation_age_minutes <= 1440`, `0 <= learner_shadow_summary.max_observed_evaluation_age_minutes <= learner_shadow_summary.max_evaluation_age_minutes`, `learner_shadow_summary.latest_evaluated_at` 존재, `collector_execution_summary.status=PASS`, `producer_script=collect-v2-promotion-runtime-snapshot`, `producer_scope=openclaw_supreme_control_plane`, `source=V2_FIRESTORE_COLLECTOR`, `artifact_filename=promotion-runtime-snapshot.json`, `artifact_current_dir_match=true`, `generated_at`/`artifact_generated_at` 존재, `artifact_generated_age_minutes <= 180`, `exchange_write_performed=false`, collector decision/cycle id와 permit/outcome id 배열이 lineage expected 값과 일치, lineage mismatch 카운트가 모두 `0`, blocker 배열은 모두 비어 있어야 한다. 실패 시 `primary_blocker_family=OPENCLAW_SUPREME_CONTROL_PLANE`, `recommended_next_action=FIX_OPENCLAW_SUPREME_CONTROL_PLANE_AND_RECHECK_DEPLOY_DECISION`, `operator_summary.lines[]` 와 `operator_alert_preview.sections[].lines[]` 의 `openclaw_supreme_blocker=YES` 가 모두 남아야 함 | OpenClaw decision bundle 생성, ExecutionPermit ledger, OutcomeAdjudicator ledger, learner shadow evidence 중 누락/불일치/만료/age 측정 누락/collector provenance 누락이 있거나 서로 다른 lineage 증거가 섞였으므로 해당 closed-loop evidence를 먼저 복구하고 deploy decision 및 submit wrapper를 다시 실행 |

## Submit Reverse Index

아래 표는 submit 차단 항목에서 runbook checklist로 역추적할 때 쓰는 최소 인덱스다.

| Submit Check ID | Runbook Checklist | 의미 |
| --- | --- | --- |
| `SUBMIT_CHK_01A` | `1`, `5`, `9` | resolved artifact dir matches selected cycle |
| `SUBMIT_CHK_02` | `7` | deploy decision approved |
| `SUBMIT_CHK_03` | `8` | bounded runtime summary complete |
| `SUBMIT_CHK_04` | `14` | evidence snapshot coverage complete |
| `SUBMIT_CHK_04B` | `14A` | runtime chain audit complete |
| `SUBMIT_CHK_04C` | `14B` | production runtime chain source audit complete |
| `SUBMIT_CHK_05` | `runbook aggregate` | automated runbook review overall status must be PASS |
| `SUBMIT_CHK_06` | `11` | cloudbuild next action is submit |
| `SUBMIT_CHK_07` | `13` | cloudbuild deploy decision summary matches current deploy decision and blocker count is zero |
| `SUBMIT_CHK_08` | `16`, `17` | lineage hashes consistent across bounded artifacts and cloudbuild context |
| `SUBMIT_CHK_09` | `15` | candidate selection contract complete |
| `SUBMIT_CHK_10` | `18` | OpenClaw execution audit ledger write complete |
| `SUBMIT_CHK_11` | `19` | LIVE repair Firestore canary streak complete |
| `SUBMIT_CHK_12` | `20` | LIVE repair cutover env plan must be explicit and non-mutating |
| `SUBMIT_CHK_13` | `21` | V2 entry boundary audit complete |
| `SUBMIT_CHK_14` | `22` | V2 production cutover audit complete |
| `SUBMIT_CHK_15` | `23` | LIVE production cutover readiness blocks legacy webhook |
| `SUBMIT_CHK_16` | `24` | LIVE scheduler traffic cutover uses OpenClaw cron only |
| `SUBMIT_CHK_17` | `24A` | LIVE scheduler traffic collector preflight can read GCP state |
| `SUBMIT_CHK_18` | `25` | V2 fill sync canonical boundary audit complete |
| `SUBMIT_CHK_19` | `26` | LIVE production entry route canary streak complete |
| `SUBMIT_CHK_20` | `27` | V2 production live entry sizing contract complete |
| `SUBMIT_CHK_20A` | `27A` | V2 production protected entry canary complete |
| `SUBMIT_CHK_21` | `28` | LIVE exit runtime canary streak complete |
| `SUBMIT_CHK_22` | `29` | V2 production runtime config contract complete |
| `SUBMIT_CHK_23` | `31` | LIVE OpenClaw supreme control plane closed loop complete |
| `SUBMIT_CHK_24` | `13G` | LIVE evidence readiness summary visible in final submit path |

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

`npm run check:v2-scheduler-traffic-collector-prereq` 는 실행 주체가 GCP project를 resolve 할 수 있는지, Cloud Scheduler job list를 읽을 수 있는지, `donbeolja`/`donbeolja-exit-worker` Cloud Run service describe를 읽을 수 있는지, 그리고 두 서비스의 LIVE canary Firestore env가 exact value인지 확인한다.

이 preflight가 실패하면 checklist `24` 는 scheduler 상태 문제가 아니라 collector 권한/환경 문제로 분류하고, `SCHED_TRAFFIC_COLLECTOR_PREREQ_*` 실패 check id를 먼저 해소해야 한다.

Cloud Build의 promotion runtime은 `gcloud` 와 `node/npm` 을 같은 step에서 사용할 수 있어야 한다.

`npm run check:v2-production-runtime-config` 는 이 조건을 `CLOUDBUILD_PROMOTION_RUNTIME_HAS_GCLOUD_AND_NODE` 로 검사한다.

submit trace에서 `SUBMIT_CHK_17` 은 `SCHEDULER_COLLECTOR_BLOCKER`, `SUBMIT_CHK_16` 은 `SCHEDULER_TRAFFIC_BLOCKER` 로 분리되어야 한다.

두 경우를 `PRODUCTION_CUTOVER_BLOCKER` 로 처리하면 원인 분류가 다시 V1처럼 뭉개진 것이므로 artifact를 신뢰하지 않는다.

수동 JSON은 긴급 디버깅 예외이며, submit 직전 정본은 collector 산출물이어야 한다.

이 파일이 없거나 `DONBEOLJA_V2_ENABLED=1`, `DONBEOLJA_V2_DRY_RUN=0`, `DONBEOLJA_V2_CANARY_ONLY=0`, `DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=1` 조건이 깨지면 LIVE runbook review는 실패해야 한다.

LIVE submit wrapper는 위 네 플래그를 운영자가 넘긴 임시 env와 무관하게 CloudBuild substitution으로 강제해야 한다. 또한 `DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=1`, `DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL=0`, `DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=OPENCLAW_CRON` 도 강제해야 하며, 이 값과 production entry/exit canary Firestore write/read/source env가 promotion runtime readiness check와 실제 Cloud Run deploy env 양쪽에 전달되어야 한다.

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
13. `DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE`
14. `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED`
15. `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED`
16. `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE`
17. `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE`

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
8. `_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE=1`
9. `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED=1`
10. `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED=1`
11. `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE=FIRESTORE`
12. `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE=1`

권장 사항:

1. `_V2_PROMOTION_ARTIFACT_DIR` 를 비우면 wrapper가 `tmp/v2-promotion-artifacts/canary_flow/<position-cycle-id>` 로 자동 고정한다
2. `_V2_PROMOTION_ARTIFACT_DIR` 를 직접 넣을 경우 path 안에 같은 `position-cycle-id` 가 포함되어야 한다
3. wrapper는 실행 후 `promotion-deploy-decision.json` 을 직접 읽고 `approved = true` 가 아니면 즉시 실패한다
4. bounded explicit cycle 경로에서는 wrapper가 `check:v2-canary-runbook` 을 자동 실행하고 `promotion-runbook-review.json.ok = true` 가 아니면 즉시 실패한다
5. auto-select 경로에서는 runtime이 먼저 candidate를 선택한 뒤 `<requested-artifact-dir>/<selected-position-cycle-id>` 로 bounded artifact dir를 finalize 하고, 그 final dir 기준으로 wrapper가 `check:v2-canary-runbook` 을 자동 실행해야 한다
6. `submit:v2-promotion-cloudbuild` 는 bounded CANARY/LIVE 제출 request에서 `_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` 을 자동 설정한다
7. `submit:v2-promotion-cloudbuild` 는 bounded CANARY/LIVE 제출 request에서 production entry route와 exit runtime canary Firestore write/read/source/require env를 자동으로 `1/1/FIRESTORE/1` 로 설정한다
8. promotion pipeline은 unified report 생성 직전에 `v2_repair_queue_firestore_canary_streak_latest.json` 를 artifact dir 안에 다시 생성하므로, submit 판단은 외부 latest 파일이 아니라 해당 승격 실행에서 갱신한 repair streak를 읽어야 한다
9. LIVE 제출은 `bounded_runtime_summary.repair_firestore_canary_streak` 이 24시간 Firestore-backed repair canary streak pass를 증명해야 하며, CANARY에서는 같은 증거가 없으면 warning으로만 남긴다
10. promotion pipeline은 unified report 생성 직전에 `v2_production_entry_route_canary_streak_latest.json` 를 artifact dir 안에 다시 생성하므로, submit 판단은 외부 latest 파일이 아니라 해당 승격 실행에서 갱신한 production route streak를 읽어야 한다
10A. `test:v2-promotion` 은 `test:v2-production-entry-route-canary-history` 를 반드시 포함해야 하며, 이는 `v2-production-entry-route-canary-history.test.js` 로 durable history append/source 계약이 streak 판정보다 먼저 깨지는지 검증하기 위함이다
11. LIVE 제출은 `bounded_runtime_summary.production_entry_route_canary_streak.history_source=FIRESTORE` 와 `firestore_source_required=true` 를 요구하므로, CANARY 기간에 먼저 durable canary history를 누적해야 한다. 또한 `collector_execution_summary.status=PASS`, `scheduler_job_id=v2_production_entry_route_canary`, `producer_script=run-v2-production-entry-route-canary`, `producer_scope=production_entry_route_canary`, `canary_mode=NO_EXCHANGE_ROUTE_PROOF`, `exchange_write_performed=false` 가 top-level streak coverage/freshness fields와 일치해야 한다.
12. LIVE 제출은 `bounded_runtime_summary.exit_runtime_canary_streak` 이 24시간 Firestore-backed exit runtime canary streak pass를 증명해야 하며, TP1 missing/native refresh unhealthy/unprotected window/silent alert drop/alert retry unresolved/alert outbox integrity gap/trail activation evidence gap 카운트가 하나라도 있으면 `SUBMIT_CHK_21`/runbook 28로 fail-closed 된다. 또한 `collector_execution_summary.status=PASS`, `scheduler_job_id=v2_exit_runtime_canary`, `producer_script=run-v2-exit-runtime-canary`, `producer_scope=exit_runtime_canary`, `canary_mode=LIVE_EXIT_RUNTIME_OBSERVATION`, `exchange_write_performed=false` 가 top-level streak coverage/freshness fields와 일치해야 한다.
12A. `test:v2-promotion` 은 `test:v2-exit-runtime-canary-history` 를 반드시 포함해야 하며, 이는 `v2-exit-runtime-canary-history.test.js` 로 exit runtime canary의 durable history append/source 계약과 secret-leak guard를 streak 판정보다 먼저 검증하기 위함이다
12B. `test:v2-promotion` 은 `test:v2-openclaw-scheduler-binding` 도 반드시 포함해야 하며, 이는 `openclaw-cron-routes.test.js` 와 `openclaw-cron-manifest.test.js` 로 V2 production route canary 및 exit runtime canary의 endpoint, `requireSchedulerToken`, script boundary, Cloud Scheduler manifest job/schedule/timezone을 promotion CI에서 고정하기 위함이다
12C. `test:v2-promotion` 은 `test:v2-repair-queue-runtime` 도 반드시 포함해야 하며, 이는 repair request fetch, delegated execution ledger, completion ledger, live worker, service entrypoint, canary/preflight가 함께 깨지는지 promotion CI에서 먼저 검증하기 위함이다
12D. `test:v2-promotion` 은 `test:v2-core-invariants` 를 가장 먼저 실행해야 한다. 이 묶음은 `v2-canonical-exit-reducer.test.js`, `v2-tick-exit-worker.test.js`, `v2-exit-fill-ingestion.test.js`, `v2-watchdog-repair.test.js`, `v2-watchdog-repair-runtime.test.js`, `tp0-retirement.test.js`, `native-protection-unprotected-window.test.js`, `exit-stage-fast-tp0.test.js`, `legacy-tp0-live-namespace.test.js`, `binance-fills-canonical-lineage-guard.test.js` 를 포함해 token audit 전에 reducer/tick/fill/watchdog/TP0-retirement behavior invariant를 직접 검증한다.
13. exit runtime streak의 원천은 `run:v2-exit-runtime-canary` 이며, 이 producer는 `ACTIVE_PROTECTED` cycle만 bounded query로 읽고 projection/protection/transitions/outbox를 position 단위로 직접 조회한다. full collection scan이나 exchange write가 발생하면 runbook 28 증거로 인정하지 않는다
14. CANARY/LIVE submit은 `check:v2-production-runtime-config` 와 같은 계약을 wrapper 내부에서 다시 실행해야 하며, CloudBuild validation과 실제 submit request의 runtime env가 갈라지면 `SUBMIT_CHK_22`/runbook 29로 fail-closed 된다
15. V2 production source는 TP0/P0/`EXIT_TP_P0` 계약명을 다시 포함하면 안 된다. `V2_TP0_EXIT_CONTRACT_FORBIDDEN` 이 깨지면 문제는 tuning이 아니라 V1 exit contract 재도입이므로 해당 source를 제거하고 `test:v2-promotion` 을 다시 실행한다
16. V2 fill sync canonical boundary는 `test:v2-promotion` 에 직접 포함되어야 한다. `V2_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_EXPLICIT_ONLY` 가 깨지면 legacy canonical write가 다시 본선 fallback처럼 열렸다는 뜻이다. V2 batch가 이미 canonical artifact를 쓴 뒤에는 `DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED=1` 도 기존 canonical truth를 다시 쓰는 권한이 아니며, explicit backfill은 V2 batch ownership이 없는 과거/복구 케이스로만 제한한다

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

같은 이유로 채널 구현은 `scripts/lib/v2-promotion-operator-summary.js` 를 기준 포맷터로 재사용해야 한다.

이 조건이 깨지면 `scripts/check-v2-promotion-submit-contract.js` 가 즉시 fail 되어야 한다.

실제 운영 채널 전송 직전에는 `promotion-cloudbuild-submit-request.json.operator_alert_preview` 를 우선 사용해야 한다.

즉, 제목/심각도/section 구성도 `scripts/lib/v2-promotion-submit-operator-alert.js` 정본을 그대로 재사용해야 하며, 채널에서 다시 조립하지 않는다.

`READY_WITH_DEPLOY_WARNING` 상태도 이 규칙의 예외가 아니다.

즉, CANARY는 승인됐지만 LIVE 전 확인이 남은 상태를 renderer/Telegram 경로에서 `READY` 로 축약하면 안 된다.

LIVE submit에서 `promotion-cloudbuild-context.json.live_cutover_readiness_summary` 가 존재하면 `submit_trace_summary`, `operator_summary.lines`, `operator_alert_preview.sections[].lines` 에도 `live_cutover_*` 라인이 그대로 남아야 한다.

즉, LIVE 전환 env plan이 Cloud Build context에는 있는데 최종 CLI/Telegram 직전 요약에서는 보이지 않는 상태를 허용하지 않는다.

`scripts/check-v2-promotion-submit-contract.js` 는 이 조건을 operator summary와 alert preview trace 양쪽에서 모두 검사해야 한다.

실제 전송은 `scripts/send-v2-promotion-submit-operator-alert.js` wrapper만 사용한다.

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

즉, 승인 상태, cycle id, blocker / warning count, top blockers 일부를 파일 첫 판독 포인트로 제공해야 한다. 보호주문 canary blocker가 있으면 `protected_entry_canary=BLOCKED` 도 같은 한 줄에 있어야 한다.

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
또한 `selector_meta.position_cycle_id`, `candidate_selection_summary.selected_position_cycle_id`, `candidate_selection_summary.selected_preflight.position_cycle_id`, 최종 `position_cycle_id` 가 서로 다르면 deploy decision은 `DEPLOY_DECISION:SELECTOR_META_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:SELECTOR_CANDIDATE_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_POSITION_CYCLE_MISMATCH` 로 fail-closed 해야 한다.

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

## Production protected entry canary checklist

LIVE entry endpoint를 켜기 전 운영자는 route canary뿐 아니라 protected entry canary도 확인해야 한다.

필수 명령:

```bash
npm run test:v2-production-entry-protected-canary
npm run run:v2-production-entry-protected-canary
```

필수 artifact:

1. `ops/daily/v2_production_entry_protected_canary_latest.json`
2. `ops/daily/v2_production_entry_protected_canary_history.jsonl`

필수 check id:

1. `V2_PROTECTED_ENTRY_CANARY_REQUEST_SIZING_APPROVED`
2. `V2_PROTECTED_ENTRY_CANARY_ROUTE_OK`
3. `V2_PROTECTED_ENTRY_CANARY_KERNEL_AUDIT_OK`
4. `V2_PROTECTED_ENTRY_CANARY_ACTIVATION_COMMIT_OK`
5. `V2_PROTECTED_ENTRY_CANARY_ACTIVE_PROTECTED`
6. `V2_PROTECTED_ENTRY_CANARY_SL_ORDER_PRESENT`
7. `V2_PROTECTED_ENTRY_CANARY_TP1_ORDER_PRESENT`
8. `V2_PROTECTED_ENTRY_CANARY_BATCH_WRITES_PRESENT`
9. `V2_PROTECTED_ENTRY_CANARY_NO_EXCHANGE_WRITE`
10. `V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_PROBE_OK`
11. `V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_ROUTE_CALLED`
12. `V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_TRANSPORTS_READY`
13. `V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_NO_EXCHANGE_WRITE`

운영 판정:

1. `reason` 은 `V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS` 여야 한다
2. `exchange_write_performed` 는 반드시 `false` 여야 한다
3. `memory_firestore_batch_commit_n` 은 2 이상이어야 한다
4. `route_result_summary.runtime_health_status` 는 `HEALTHY` 여야 한다
5. `route_result_summary.sl_order_id` 와 `route_result_summary.tp1_order_id` 가 모두 있어야 한다
6. `generated_at` 과 `artifact_generated_at` 이 존재해야 하며 `artifact_generated_age_minutes <= 180` 이어야 한다
7. `live_endpoint_probe_summary` 는 LIVE endpoint enabled, confirm phrase, LIVE decision mode, transport resolution, route invocation을 no-exchange로 증명해야 한다

이 항목 중 하나라도 깨지면 LIVE entry enable 금지다.
또한 submit 차단 시 `approval_verification.blocker_summary.has_production_entry_protected_canary_blocker=true`, `submit_trace_summary.primary_blocker_family=PROTECTED_ENTRY_CANARY`, `operator_summary` 의 `protected_entry_canary_blocker=YES` 가 같이 남아야 한다.

## LIVE exit runtime canary scheduler binding checklist

Checklist 28의 `exit_runtime_canary_streak` 는 producer가 실제 운영 스케줄러에서 계속 실행된다는 전제를 포함한다.

운영자는 LIVE 승격 전 아래 연결을 같이 확인해야 한다.

1. OpenClaw cron route: `POST /api/openclaw/cron/v2-exit-runtime-canary`
2. route guard: `requireSchedulerToken`
3. scheduler manifest job id: `v2_exit_runtime_canary`
4. CloudBuild substitution: `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED`, `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED`, `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE`, `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE`
5. Cloud Run env: `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED`, `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED`, `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE`, `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE`
6. submit contract: `SUBMIT_CONTRACT_CHK_49`
7. promotion CI: `test:v2-openclaw-scheduler-binding`

이 항목 중 하나라도 빠지면 24시간 streak는 신뢰 가능한 LIVE evidence가 아니다.
이 경우 runbook 28을 통과시키지 말고 OpenClaw cron/CloudBuild wiring부터 복구한다.

## Scheduler traffic Cloud Scheduler evidence addendum

Runbook checklist 24는 이제 `missing_openclaw_job_ids=[]` 만 보는 것이 아니라 `openclaw_cloud_scheduler_jobs` evidence도 포함한다.

필수 Cloud Scheduler HIGH job:

1. `openclaw_agent_calibration`
2. `v2_production_entry_route_canary`
3. `v2_exit_runtime_canary`

각 job은 아래가 모두 맞아야 한다.

1. `enabled=true`
2. `path_match=true`
3. `schedule_match=true`
4. `time_zone_match=true`

특히 `v2_exit_runtime_canary` 가 빠지면 24시간 exit runtime streak가 장기 운영 증거가 아니라 수동/일회성 artifact가 된다.
그 경우 checklist 24와 28은 모두 LIVE 승격 불가로 판정한다.

## LIVE readiness artifact freshness checklist

LIVE submit 직전 운영자는 readiness artifact 4종이 현재 cycle에서 새로 생성됐는지 확인해야 한다.

대상 checklist:

1. Runbook 20 / `SUBMIT_CHK_12`: `v2_repair_live_cutover_readiness_latest.json`
2. Runbook 23 / `SUBMIT_CHK_15`: `v2_production_cutover_readiness_latest.json`
3. Runbook 24A / `SUBMIT_CHK_17`: `v2_scheduler_traffic_collector_preflight_latest.json`
4. Runbook 24 / `SUBMIT_CHK_16`: `v2_scheduler_traffic_cutover_readiness_latest.json`

각 LIVE readiness artifact는 아래를 만족해야 한다.

1. `artifact_current_dir_match=true`
2. `artifact_filename` 이 기대 파일명과 일치
3. `generated_at` 존재
4. `artifact_generated_at` 존재
5. `artifact_generated_age_minutes <= 180`

위 조건은 `promotion-runbook-review.json` 의 `CHK_24B` 가 자동 검증한다.
위 조건이 깨지면 문제는 runtime 기능 고장이 아니라 stale artifact provenance 계열이다.
운영자는 해당 artifact dir을 폐기하고 fresh promotion pipeline을 다시 실행해야 한다.
