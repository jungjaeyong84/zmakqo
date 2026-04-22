# DONBEOLJA V2 Promotion Artifact Contract

## 목적

V2 승격 게이트는 사람이 JSON을 수동으로 붙여 넣는 방식으로 운영하면 안 된다.

CI와 로컬 검증은 동일한 artifact 규약을 따라야 한다.

## 표준 artifact 디렉터리

환경 변수:

1. `V2_PROMOTION_ARTIFACT_DIR`

이 디렉터리 아래에 아래 파일이 모두 있어야 한다.

1. `replay-report.json`
2. `shadow-live-comparison.json`
3. `source-mode-comparison.json`
4. `unified-promotion-report.json`
5. `promotion-deploy-decision.json`
6. `promotion-cloudbuild-submit-request.json`
7. `promotion-cloudbuild-context.json`

optional review artifact:

1. `promotion-runbook-review.json`

`promotion-runbook-review.json` 은 runbook checklist를 artifact 기준으로 자동 대조한 결과다.

최소 포함 항목:

1. `expected_position_cycle_id`
2. `overall_status`
3. `pass_n` / `fail_n` / `skip_n`
4. `checks[]`

`checks[]` 는 checklist id, file, field, pass/fail/skip, reason을 함께 남겨야 한다.

`promotion-cloudbuild-context.json` 은 제출 직전 wrapper 관점의 마지막 provenance 요약을 남겨야 한다.

최소 포함 항목:

1. 실행 mode / script / artifact_dir / position_cycle_id
2. `requested_artifact_dir`
3. `resolved_artifact_dir`
4. `artifact_dir_coherence.ok`
5. `artifact_dir_coherence.reason`
6. `artifact_dir_coherence.artifact_dir_matches_resolved_artifact_dir`
7. `artifact_dir_coherence.artifact_dir_contains_position_cycle_id`
8. `artifact_dir_coherence.context_cycle_matches_deploy_decision`
9. `final_status_line`
10. `recommended_next_action`
11. `recommended_next_action_reason`
12. `recommended_next_action_reason_code`
13. `lineage_contract_hash`
14. `submit_trace.relevant_submit_check_ids`
15. `submit_trace.relevant_runbook_checklist`
16. `submit_trace.failed_submit_check_ids`
17. `submit_trace.failed_runbook_checklist`
18. `submit_trace.blocker_families`
19. `submit_trace.primary_blocker_family`
20. `submit_trace.deploy_warning_attention_required`
21. `submit_trace.deploy_warning_summary`
22. `submit_trace.deploy_warning_runbook_checklist`
23. `submit_trace.recommended_next_action_reason_code`
24. `submit_trace.checks[]`
25. `deploy_decision_summary.approved`
26. `deploy_decision_summary.lineage_contract_hash`
27. `deploy_decision_summary.bounded_runtime_summary`
28. `deploy_decision_summary.candidate_selection_summary`
29. `deploy_decision_summary.blocker_summary`
30. `runbook_review_file`
31. `runbook_review_summary.ok`
32. `runbook_review_summary.failed_check_ids`

`final_status_line` 은 operator가 파일을 열자마자 판정 상태를 한 줄로 읽기 위한 필드다.
보호주문 canary 차단이 있으면 이 한 줄은 `protected_entry_canary=BLOCKED` 를 포함해야 한다.

최소 포함 항목:

1. final decision
2. cycle id
3. blocker / warning count
4. top blockers 일부

`recommended_next_action` 은 blocker 계열에 따른 다음 행동 권고를 고정한 필드다.

예:

1. provenance 계열이면 artifact dir 폐기 후 preflight부터 재실행
2. candidate selection 계열이면 selected cycle 검토 후 canary flow 재실행
3. bounded runtime 계열이면 runtime artifact 재생성 후 deploy decision 재검토
4. watchdog 계열이면 승격 보류 후 replay evidence 재검토

`recommended_next_action_reason` 은 왜 그 행동이 선택됐는지 짧게 설명하는 필드다.

즉, operator가 action hint를 다시 추측하지 않도록 blocker family와 다음 행동 사이의 연결을 문서에 같이 남겨야 한다.

`recommended_next_action_reason_code` 는 위 자유문 설명의 정규 코드다.

즉, runbook, code, alert가 서로 다른 문장으로 drift 나지 않게 operator용 설명과 machine-readable 분류를 같이 남겨야 한다.

`submit_trace` 는 cloudbuild context 단계에서 submit 차단과 runbook checklist를 역으로 연결하는 요약 필드다.

보호주문 canary 차단은 예외적으로 context 단계에서도 `SUBMIT_CHK_20A` 를 relevant/failed submit check에 포함해야 한다. 즉 `DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED` 가 있으면 submit wrapper까지 기다리지 않고 `promotion-cloudbuild-context.json.submit_trace.failed_runbook_checklist` 에 `27A` 가 보여야 한다.

`bounded_runtime_summary.production_entry_protected_canary` 는 단순 pass payload가 아니라 현재 artifact cycle의 fresh 증거여야 한다. 따라서 `artifact_file`, `artifact_dir`, `artifact_filename`, `artifact_current_dir_match`, `generated_at`, `artifact_generated_at`, `artifact_generated_age_minutes` 를 포함하고, CANARY/LIVE deploy decision은 `artifact_filename=v2_production_entry_protected_canary_latest.json`, `artifact_current_dir_match=true`, `artifact_generated_age_minutes <= 180` 이 아니면 fail-closed 해야 한다.

`bounded_runtime_summary.repair_firestore_canary_streak`, `bounded_runtime_summary.production_entry_route_canary_streak`, `bounded_runtime_summary.exit_runtime_canary_streak` 도 동일하게 현재 artifact cycle provenance를 포함해야 한다. LIVE deploy decision은 각각 `v2_repair_queue_firestore_canary_streak_latest.json`, `v2_production_entry_route_canary_streak_latest.json`, `v2_exit_runtime_canary_streak_latest.json` 파일명이 현재 artifact dir과 1:1로 맞지 않으면 fail-closed 해야 한다.

각 streak artifact는 파일 경로 provenance만으로 충분하지 않다. `generated_at`, `artifact_generated_at`, `artifact_generated_age_minutes` 를 함께 보존해야 하며, LIVE deploy decision은 `artifact_generated_age_minutes <= max_gap_minutes` 를 요구한다. 이는 오래된 PASS JSON을 현재 artifact dir에 복사해 24시간 streak가 최신인 것처럼 보이는 V1식 stale artifact 승격을 차단하기 위한 계약이다.

LIVE deploy decision은 개별 artifact freshness뿐 아니라 evidence cycle consistency도 검증해야 한다. `repair_firestore_canary_streak`, `production_entry_route_canary_streak`, `exit_runtime_canary_streak`, `production_entry_protected_canary` 의 `artifact_dir` 는 모두 같은 promotion artifact cycle이어야 하며, 세 long-run streak의 `position_cycle_id` 는 promotion `position_cycle_id` 와 같아야 한다. protected-entry proof의 `route_result_summary.position_cycle_id` 도 promotion `position_cycle_id` 와 같아야 한다. 불일치 시 `DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH`, `DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:LIVE_PROTECTED_ENTRY_POSITION_CYCLE_MISMATCH` 중 하나로 fail-closed 한다. 이는 서로 다른 실행에서 나온 PASS 증거를 조합해 LIVE로 올리는 V1식 증거 혼합을 차단하기 위한 계약이다.

`bounded_runtime_summary.production_entry_route_canary_streak` 는 streak 판정만으로 충분하지 않다. promotion CI의 `test:v2-promotion` 은 `v2-production-entry-route-canary-history.test.js` 를 실행해 production route canary가 durable history에 append되고 `history_source=FIRESTORE` 로 읽히는 계약을 같이 검증해야 한다. 이는 24시간 streak 요구가 있어도 history 생산자가 CI 밖에서 조용히 깨지는 V1식 관측성 공백을 차단하기 위한 계약이다.

`bounded_runtime_summary.exit_runtime_canary_streak` 는 단일 latest 파일이 아니라 24시간 Firestore-backed 장기 실행 증거여야 한다. 원천 producer는 `run:v2-exit-runtime-canary` 이고, 이 producer는 `ACTIVE_PROTECTED` cycle을 bounded query로만 읽으며 `exchange_write_performed=false` 를 반드시 보존해야 한다. LIVE mode에서는 `reason=V2_EXIT_RUNTIME_CANARY_STREAK_PASS`, `history_source=FIRESTORE`, `coverage_minutes >= 1440`, `latest_age_minutes <= max_gap_minutes`, `max_observed_gap_minutes <= max_gap_minutes`, `artifact_generated_age_minutes <= max_gap_minutes`, `tp1_missing_n=0`, `native_refresh_unhealthy_n=0`, `unprotected_window_violation_n=0`, `alert_silent_drop_n=0`, `blockers=[]` 를 모두 만족해야 한다.

LIVE promotion pipeline은 production route streak와 exit runtime streak refresh 시 각각 `DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE=1`, `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE=1` 을 강제해야 한다. 따라서 operator가 실수로 `*_STREAK_SOURCE=JSONL` 을 넘겨도 streak checker 자체가 `*:FIRESTORE_SOURCE_REQUIRED` blocker로 fail-closed 해야 한다.

`bounded_runtime_summary.exit_runtime_canary_streak` 도 streak 판정만으로 충분하지 않다. promotion CI의 `test:v2-promotion` 은 `v2-exit-runtime-canary-history.test.js` 를 실행해 exit runtime canary가 durable history에 append되고 `history_source=FIRESTORE` 로 읽히는 계약, `exchange_write_performed=false`, secret-leak guard를 같이 검증해야 한다. 이는 TP1 missing, native refresh unhealthy, 무보호 구간, silent alert drop 관측 producer가 CI 밖에서 조용히 깨지는 V1식 운영 공백을 차단하기 위한 계약이다.

LIVE deploy decision은 exit runtime canary streak가 `JSONL` 로컬 파일 기반이면 실패해야 한다. `check-v2-promotion-deploy-decision.test.js` 는 `history_source=JSONL` fixture와 현재 artifact dir 밖의 stale exit streak fixture를 각각 만들어 `DEPLOY_DECISION:EXIT_RUNTIME_CANARY_STREAK_REQUIRED` 및 `DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:EXIT_RUNTIME_CANARY_STREAK` 가 실제로 발생하는지 검증해야 한다. 이는 수동 파일 복사나 로컬 history 재사용으로 운영 Firestore 장기 증거 없이 LIVE가 열리는 V1식 증거 오염을 차단하기 위한 계약이다.

exit runtime streak artifact는 상단 숫자뿐 아니라 `long_run_quality_summary` 를 포함해야 한다. 이 요약은 `status`, `history_source`, `firestore_source_required`, `coverage_minutes`, `latest_age_minutes`, `max_observed_gap_minutes`, 그리고 `defect_counts.tp1_missing_n/native_refresh_unhealthy_n/unprotected_window_violation_n/alert_silent_drop_n` 을 한 묶음으로 보존해 운영자가 왜 LIVE가 막혔는지 raw history를 열지 않고도 판독하게 한다.

LIVE scheduler binding도 artifact 외부 가정으로 남기지 않는다. promotion CI의 `test:v2-promotion` 은 `test:v2-openclaw-scheduler-binding` 을 실행해 OpenClaw cron route와 Cloud Scheduler manifest의 V2 canary jobs를 같이 검증해야 한다. 이 테스트 묶음은 `openclaw-cron-routes.test.js` 로 endpoint/`requireSchedulerToken`/script boundary를 확인하고, `openclaw-cron-manifest.test.js` 로 `v2_production_entry_route_canary` 와 `v2_exit_runtime_canary` 가 Cloud Scheduler manifest에만 존재하며 HIGH criticality, 기대 path, schedule, timezone을 보존하는지 확인한다. 이는 수동 latest artifact는 통과하지만 실제 운영 스케줄러가 빠져 24시간 streak가 다시 끊기는 V1식 운영 공백을 차단하기 위한 계약이다.

LIVE scheduler collector preflight는 단순히 Cloud Run service describe 권한만 확인하지 않는다. 수집 결과에서 `SCHEDULER_AUTOSTART` 와 `DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE` env key가 실제로 보이지 않으면 `SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_MISSING` 으로 실패해야 한다. 이는 권한은 있지만 필요한 runtime env를 읽지 못해 cutover readiness가 빈 증거로 통과하는 V1식 preflight 착시를 막기 위한 계약이다.

`SUBMIT_CONTRACT_CHK_49` 는 단순 문자열 존재만으로 충분하지 않다. `check-v2-promotion-submit-contract.test.js` 는 package promotion script에서 `test:v2-openclaw-scheduler-binding` 이 빠진 fixture와 OpenClaw exit runtime cron route가 빠진 fixture를 각각 만들어 `SUBMIT_CONTRACT_CHK_49` 가 실제로 fail-closed 되는지 검증해야 한다. 이는 계약 checker가 "현재 workspace가 우연히 정상이라 PASS" 인지, 결함 fixture를 실제로 잡는지 구분하기 위한 최소 E2E contract fixture다.

stale artifact provenance는 일반 bounded runtime 누락과 분리되어야 한다. 여기서 stale은 파일 경로 mismatch뿐 아니라 `generated_at`/`artifact_generated_at` 누락 또는 `artifact_generated_age_minutes` 초과를 포함한다. `DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:*` blocker가 있으면 `blocker_summary.has_stale_artifact_provenance_blocker=true`, `submit_trace.blocker_families` 에 `STALE_ARTIFACT_PROVENANCE`, `recommended_next_action_reason_code=STALE_ARTIFACT_PROVENANCE_BLOCKER`, `final_status_line` 에 `stale_artifact=BLOCKED` 가 남아야 한다.

LIVE evidence cycle mismatch도 일반 bounded runtime 누락과 분리되어야 한다. `DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH`, `DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:LIVE_PROTECTED_ENTRY_POSITION_CYCLE_MISMATCH` blocker가 있으면 `blocker_summary.has_live_evidence_cycle_blocker=true`, `submit_trace.blocker_families` 에 `LIVE_EVIDENCE_CYCLE`, `recommended_next_action_reason_code=LIVE_EVIDENCE_CYCLE_BLOCKER`, `final_status_line` 에 `live_evidence_cycle=BLOCKED`, `operator_summary.lines[]` 와 `operator_alert_preview.sections[]` 에 `live_evidence_cycle_blocker=YES` 가 남아야 한다. 이 문제는 단일 스크립트 재실행이 아니라 서로 다른 cycle에서 온 증거가 섞인 상태이므로 artifact dir을 폐기하고 fresh promotion pipeline을 재실행해야 한다.

최소 포함 항목:

1. `relevant_submit_check_ids`
2. `relevant_runbook_checklist`
3. `failed_submit_check_ids`
4. `failed_runbook_checklist`
5. `blocker_families`
6. `primary_blocker_family`
7. `deploy_warning_attention_required`
8. `deploy_warning_summary`
9. `deploy_warning_runbook_checklist`
10. `recommended_next_action_reason_code`
11. `checks[].id`
12. `checks[].ok`
13. `checks[].runbook_checklist`
14. `checks[].fields`

submit_trace.checks[] must include `SUBMIT_CHK_01A` and map it to `artifact_dir`, `resolved_artifact_dir`, `artifact_dir_coherence`, `position_cycle_id`.
If `artifact_dir_coherence.ok=false`, `submit_trace.failed_submit_check_ids` must include `SUBMIT_CHK_01A`, `failed_runbook_checklist` must include `1`, `5`, `9`, and `recommended_next_action_reason_code` must be `PROVENANCE_BLOCKER`.
15. `checks[].reason`

즉, operator가 `promotion-cloudbuild-context.json` 하나만 열어도 현재 context 기준으로 어느 `SUBMIT_CHK_*` 가 막히는지, 같은 문제를 runbook 몇 번에서 다시 봐야 하는지, 그 문제가 어느 계열인지 즉시 복원할 수 있어야 한다.

warning 계열도 submit wrapper까지 기다리지 않고 같은 context에서 읽을 수 있어야 한다. repair streak warning은 `deploy_warning_runbook_checklist=["19"]`, production entry route streak warning은 `deploy_warning_runbook_checklist=["26"]` 으로 복원 가능해야 한다.

`blocker_summary` 는 raw blocker 배열을 대체하는 것이 아니라 operator 판독 속도를 위한 1차 요약이다.

최소 포함 항목:

1. `blocker_n`
2. `top_blockers`
3. `has_provenance_blocker`
4. `has_watchdog_blocker`
5. `has_stale_artifact_provenance_blocker`
6. `has_candidate_selection_blocker`
7. `has_bounded_runtime_blocker`
8. `has_production_entry_protected_canary_blocker`

`promotion-cloudbuild-submit-request.json` 에도 runbook review 정책이 같이 남아야 한다.

최소 포함 항목:

1. `runbook_review_policy.required`
2. `runbook_review_policy.strategy`
3. `runbook_review_policy.reason`

또한 submit request에는 최종 승격이 어떤 bounded approval contract를 만족해야 하는지도 같이 남아야 한다.

최소 포함 항목:

1. `approval_contract.required`
2. `approval_contract.deploy_decision_approved_required`
3. `approval_contract.bounded_runtime_summary_required`
4. `approval_contract.lineage_contract_required`
5. `approval_contract.lineage_hash_match_required`
6. `approval_contract.evidence_snapshot_summary_required`
7. `approval_contract.runtime_chain_audit_summary_required`
8. `approval_contract.entry_boundary_audit_required`
9. `approval_contract.fill_sync_canonical_boundary_audit_required`
10. `approval_contract.production_cutover_audit_required`
11. `approval_contract.production_live_entry_sizing_contract_required`
12. `approval_contract.openclaw_execution_audit_ledger_write_required`
13. `approval_contract.repair_firestore_canary_streak_required`
14. `approval_contract.exit_runtime_canary_streak_required`
15. `approval_contract.production_entry_protected_canary_required`
16. `approval_contract.production_cutover_readiness_summary_required`
17. `approval_contract.scheduler_traffic_collector_preflight_summary_required`
18. `approval_contract.scheduler_traffic_cutover_readiness_summary_required`
19. `approval_contract.live_cutover_readiness_summary_required`
20. `approval_contract.runbook_review_pass_required`
21. `approval_contract.candidate_selection_ready_required`
22. `approval_contract.selected_preflight_required`
23. `approval_contract.blocker_free_required`
24. `approval_contract.recommended_next_action_required`
25. `approval_contract.resolved_artifact_dir_required`

또한 submit request에는 “최종 승격이 어떤 artifact/field로 증명돼야 하는가” 도 같이 남아야 한다.

최소 포함 항목:

1. `approval_evidence_sources.required`
2. `approval_evidence_sources.deploy_decision`
3. `approval_evidence_sources.bounded_runtime_summary`
4. `approval_evidence_sources.evidence_snapshot_summary`
5. `approval_evidence_sources.runtime_chain_audit_summary`
6. `approval_evidence_sources.entry_boundary_audit`
7. `approval_evidence_sources.fill_sync_canonical_boundary_audit`
8. `approval_evidence_sources.production_cutover_audit`
9. `approval_evidence_sources.production_live_entry_sizing_contract`
10. `approval_evidence_sources.openclaw_execution_audit_ledger_write`
11. `approval_evidence_sources.repair_firestore_canary_streak`
12. `approval_evidence_sources.exit_runtime_canary_streak`
13. `approval_evidence_sources.production_entry_protected_canary`
14. `approval_evidence_sources.production_cutover_readiness_summary`
15. `approval_evidence_sources.scheduler_traffic_collector_preflight_summary`
16. `approval_evidence_sources.scheduler_traffic_cutover_readiness_summary`
17. `approval_evidence_sources.live_cutover_readiness_summary`
18. `approval_evidence_sources.runbook_review`
19. `approval_evidence_sources.recommended_next_action`
20. `approval_evidence_sources.blocker_summary`
21. `approval_evidence_sources.lineage_hash_sources`
22. `approval_evidence_sources.candidate_selection` (auto-select path만)
23. `approval_evidence_sources.resolved_artifact_dir`
24. `approval_evidence_sources.production_runtime_config_contract`

submit request에는 실제 artifact를 읽고 계산한 최종 검증 결과도 같이 남아야 한다.

최소 포함 항목:

1. `approval_verification.required`
2. `approval_verification.ok`
3. `approval_verification.reason`
4. `approval_verification.fail_n`
5. `approval_verification.check_n`
6. `approval_verification.checks`
7. `approval_verification.blocker_summary`
8. `approval_verification.recommended_next_action`
9. `approval_verification.recommended_next_action_reason`
10. `approval_verification.recommended_next_action_reason_code`
11. `approval_verification.lineage_hashes`
12. `approval_verification.production_runtime_config_summary`

동시에 submit request top-level에는 사람이 바로 읽는 `submit_trace_summary` 도 같이 남아야 한다.

최소 포함 항목:

1. `submit_trace_summary.required`
2. `submit_trace_summary.ok`
3. `submit_trace_summary.failed_submit_check_ids`
4. `submit_trace_summary.failed_runbook_checklist`
5. `submit_trace_summary.blocker_families`
6. `submit_trace_summary.primary_blocker_family`
7. `submit_trace_summary.alert_retry_attention_required`
8. `submit_trace_summary.alert_retry_summary`
9. `submit_trace_summary.alert_runbook_refs`
10. `submit_trace_summary.deploy_warning_attention_required`
11. `submit_trace_summary.deploy_warning_summary`
12. `submit_trace_summary.deploy_warning_runbook_checklist`
13. `submit_trace_summary.live_cutover_readiness_summary`
14. `submit_trace_summary.production_cutover_readiness_summary`
15. `submit_trace_summary.scheduler_traffic_cutover_readiness_summary`
16. `submit_trace_summary.artifact_dir_coherence_summary`
17. `submit_trace_summary.recommended_next_action`
18. `submit_trace_summary.recommended_next_action_reason`
19. `submit_trace_summary.recommended_next_action_reason_code`
20. `submit_trace_summary.production_runtime_config_summary`

`submit_trace_summary.deploy_warning_summary` 는 최소한 `warning_n`, `top_warnings`, `has_live_readiness_warning`, `has_repair_firestore_canary_streak_warning`, `has_production_entry_route_canary_streak_warning` 를 포함해야 한다. repair streak warning은 runbook 19, production entry route streak warning은 runbook 26으로 역추적 가능해야 한다.

`submit_trace_summary.artifact_dir_coherence_summary` 는 `SUBMIT_CHK_01A` 의 사람이 읽는 원인이다. 최소한 `ok`, `reason`, `artifact_dir_matches_resolved_artifact_dir`, `artifact_dir_contains_position_cycle_id`, `resolved_artifact_dir_contains_position_cycle_id`, `context_cycle_matches_deploy_decision`, `file` 을 포함해야 한다.

즉, `SUBMIT_CHK_01A` 가 실패했을 때 operator가 `approval_verification.checks[]` 를 펼치기 전에 `artifact_dir_coherence_summary.reason` 과 flag 조합만 보고 final artifact dir drift인지 cycle drift인지 먼저 구분할 수 있어야 한다.

동시에 operator/alert 채널이 바로 재사용할 수 있는 `operator_summary` 도 같이 남아야 한다.

최소 포함 항목:

1. `operator_summary.status`
2. `operator_summary.headline`
3. `operator_summary.primary_blocker_family`
4. `operator_summary.alert_retry_attention_required`
5. `operator_summary.alert_runbook_refs`
6. `operator_summary.alert_failed_n`
7. `operator_summary.alert_pending_n`
8. `operator_summary.deploy_warning_attention_required`
9. `operator_summary.deploy_warning_n`
10. `operator_summary.deploy_warning_runbook_checklist`
11. `operator_summary.deploy_top_warnings`
12. `operator_summary.live_cutover_readiness_summary`
13. `operator_summary.production_cutover_readiness_summary`
14. `operator_summary.scheduler_traffic_cutover_readiness_summary`
15. `operator_summary.artifact_dir_coherence_summary`
16. `operator_summary.failed_submit_check_ids`
17. `operator_summary.failed_runbook_checklist`
18. `operator_summary.recommended_next_action`
19. `operator_summary.recommended_next_action_reason`
20. `operator_summary.recommended_next_action_reason_code`
21. `operator_summary.artifact_dir`
22. `operator_summary.output_file`
23. `operator_summary.lines[]`
24. `operator_summary.text`

즉, 이후 alert/CLI/ops 채널이 따로 문자열을 조립하지 않고도 같은 요약 구조를 재사용해야 한다.

`operator_summary.status` 는 최소한 `BLOCKED`, `READY`, `READY_WITH_ALERT_ATTENTION`, `READY_WITH_DEPLOY_WARNING`, `READY_WITH_ATTENTION` 상태를 구분해야 한다.

즉, submit 자체는 통과했지만 alert 운영 이슈나 CANARY deploy warning이 남은 상태를 `BLOCKED` 로 오인 표기하면 안 된다.

`operator_summary.lines[]` 는 사람이 바로 보내거나 붙여넣을 수 있는 표준 라인셋이다.

즉, headline만 재사용하고 나머지 줄은 채널마다 다시 조립하는 V1식 drift를 금지한다.

LIVE submit에서는 같은 line set 안에 `live_cutover_ready`, `live_cutover_auto_apply`, `live_cutover_mutates_env`, `live_cutover_env_changes`, `live_cutover_file` 이 포함돼야 한다.

즉, Cloud Build context에서 확인한 LIVE cutover readiness가 최종 CLI/Telegram 직전 요약에서 사라지면 안 된다.

LIVE submit에서는 같은 line set 안에 `production_cutover_ready`, `production_cutover_legacy_blocked`, `production_cutover_guard_reason`, `production_cutover_file` 도 포함돼야 한다.

즉, 실제 LIVE env에서 legacy webhook이 차단된다는 증거가 최종 CLI/Telegram 직전 요약에서 사라지면 안 된다.

LIVE submit에서는 같은 line set 안에 `scheduler_traffic_ready`, `scheduler_traffic_sot`, `scheduler_traffic_legacy_active`, `scheduler_traffic_file` 도 포함돼야 한다.

즉, OpenClaw cron 정본/legacy scheduler 비활성/Cloud Run traffic readiness 증거가 최종 CLI/Telegram 직전 요약에서 사라지면 안 된다.

같은 line set 안에는 `artifact_dir_coherence`, `artifact_dir_coherence_reason`, `artifact_dir_coherence_flags`, `artifact_dir_coherence_file` 도 포함돼야 한다.

즉, `SUBMIT_CHK_01A` provenance 차단이 발생했을 때 운영자가 어느 self-check flag가 깨졌는지 확인하려고 raw context JSON을 먼저 열어야 하면 안 된다.

같은 line set 안에는 `stale_artifact_provenance_blocker` 도 포함돼야 한다.

즉, stale artifact provenance 차단이 발생했을 때 운영자는 bounded runtime 누락이나 보호주문 본체 오류가 아니라 current artifact cycle 재생성 문제임을 operator summary에서 바로 읽을 수 있어야 한다.

`operator_summary.text` 는 위 라인셋을 줄바꿈으로 결합한 transport-agnostic 정본 문자열이다.

즉, 어떤 채널이든 `lines.join("\\n")` 를 다시 구현하지 말고 이 필드를 그대로 재사용해야 한다.

동시에 이 포맷의 구현 정본도 하나여야 한다.

즉, 채널 구현은 `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/v2-promotion-operator-summary.js` 를 직접 재사용해야 하며, 각 채널이 `operator_summary` 조립 로직을 다시 구현하면 안 된다.

이 원칙은 문서 원칙으로만 두지 않는다.

즉, `/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-promotion-submit-contract.js` 가 이 포맷터 참조와 submit wrapper 재정의 금지를 fail-closed 로 검사해야 한다.

즉, operator가 `approval_verification.checks[]` 를 펼치기 전에 submit 차단 계열과 다시 볼 runbook 번호를 top-level에서 즉시 읽을 수 있어야 한다.

같은 요약은 submit wrapper CLI stdout/stderr payload에도 그대로 노출돼야 한다.

즉, 운영자가 콘솔 출력과 artifact 파일을 서로 다른 기준으로 읽지 않게, `submit_trace_summary` 와 `approval_verification` 핵심 필드를 같은 구조로 재사용해야 한다.

실제 운영 채널 직전에는 `operator_alert_preview` 도 같이 남아야 한다.

최소 포함 항목:

1. `operator_alert_preview.required`
2. `operator_alert_preview.source`
3. `operator_alert_preview.severity`
4. `operator_alert_preview.title`
5. `operator_alert_preview.dedupe_key`
6. `operator_alert_preview.summary_text`
7. `operator_alert_preview.sections[]`
8. `operator_alert_preview.source_fingerprint_version`
9. `operator_alert_preview.source_fingerprint`

`operator_alert_preview.source_fingerprint` 는 `operator_summary` 와 `submit_trace_summary` 기준 SHA-256이어야 한다. renderer는 embedded preview가 최신 source fingerprint와 다르면 `V2_PROMOTION_OPERATOR_ALERT_PREVIEW_STALE` 로 중단한다.

`SUBMIT_CHK_08` 이 실패하거나 검증되는 경우 `operator_summary.lines[]` 와 `operator_alert_preview.sections[]` 의 trace section에는 아래 lineage consistency line set이 포함돼야 한다.

1. `lineage_consistency`
2. `lineage_consistency_reason`
3. `lineage_bounded_ok`
4. `lineage_context_hash_match`
5. `lineage_context_ok`

즉, 최종 submit 단계는 단순 `lineage_contract_hash` 존재 여부가 아니라 bounded artifact hash, CloudBuild context hash, context `lineage_consistency_summary` 가 모두 같은 의미로 통과했는지를 운영자 메시지에서 복원 가능해야 한다.

LIVE submit에서는 `operator_alert_preview.sections[]` 의 trace section에도 `live_cutover_ready`, `live_cutover_auto_apply`, `live_cutover_mutates_env`, `live_cutover_env_changes`, `live_cutover_file` 이 포함돼야 한다.

즉, `operator_summary.lines[]` 에는 있는데 실제 발송 preview trace에서 빠지는 상태도 contract 위반이다.

LIVE submit에서는 `operator_alert_preview.sections[]` 의 trace section에도 `production_cutover_ready`, `production_cutover_legacy_blocked`, `production_cutover_guard_reason`, `production_cutover_file` 이 포함돼야 한다.

즉, V2 full LIVE env 조건과 legacy webhook 차단 증거가 실제 발송 preview에서 빠지는 상태도 contract 위반이다.

LIVE submit에서는 `operator_alert_preview.sections[]` 의 trace section에도 `scheduler_traffic_ready`, `scheduler_traffic_sot`, `scheduler_traffic_legacy_active`, `scheduler_traffic_file` 이 포함돼야 한다.

`operator_alert_preview.sections[]` 의 trace section에도 `artifact_dir_coherence`, `artifact_dir_coherence_reason`, `artifact_dir_coherence_flags`, `artifact_dir_coherence_file` 이 포함돼야 한다.

즉, Telegram/CLI preview에서만 `SUBMIT_CHK_01A` 의 artifact dir self-check 원인이 사라지는 상태도 contract 위반이다.

`operator_alert_preview.sections[]` 의 trace section에도 `stale_artifact_provenance_blocker` 가 포함돼야 한다.

즉, Telegram/CLI preview에서 stale artifact provenance 문제가 generic bounded blocker로만 보이면 contract 위반이다.

즉, scheduler/traffic cutover 증거가 실제 발송 preview에서 빠지는 상태도 contract 위반이다.

즉, 실제 운영 채널은 submit request를 읽고 제목/본문을 다시 조립하는 것이 아니라, `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/v2-promotion-submit-operator-alert.js` 가 만든 preview를 그대로 재사용해야 한다.

실제 전송 wrapper도 이 preview를 다시 가공하지 않고 renderer 결과를 그대로 `sendKoreanTelegramSummary` 에 넘겨야 한다.

즉, `/Users/jeongjaeyong/Projects/donbeolja/scripts/send-v2-promotion-submit-operator-alert.js` 는 `/Users/jeongjaeyong/Projects/donbeolja/scripts/render-v2-promotion-submit-operator-alert.js` 를 먼저 호출한 뒤 그 결과만 전송해야 한다.

동시에 submit request에는 마지막 전송 시도 결과도 같이 남아야 한다.

최소 포함 항목:

1. `operator_alert_delivery.required`
2. `operator_alert_delivery.send_enabled`
3. `operator_alert_delivery.ok`
4. `operator_alert_delivery.reason`
5. `operator_alert_delivery.preview`
6. `operator_alert_delivery.telegram_args`
7. `operator_alert_delivery.transport_result`

즉, 운영자는 submit artifact 하나만 보고 "무엇을 보내려 했는가" 와 "실제로 보냈는가" 를 같은 정본에서 복원할 수 있어야 한다.

동시에 wrapper 상단에서 바로 읽는 `operator_delivery_summary` 도 같이 남아야 한다.

최소 포함 항목:

1. `operator_delivery_summary.status`
2. `operator_delivery_summary.send_enabled`
3. `operator_delivery_summary.transport_state`
4. `operator_delivery_summary.reason`
5. `operator_delivery_summary.error_message`
6. `operator_delivery_summary.artifact_dir`
7. `operator_delivery_summary.output_file`
8. `operator_delivery_summary.lines[]`
9. `operator_delivery_summary.text`

즉, `operator_summary` 는 "보낼 내용" 정본으로 유지하고, delivery 결과는 별도 summary로 올려서 V1식 의미 혼합을 만들면 안 된다.

각 `approval_verification.checks[]` 항목에는 문서 참조도 같이 남아야 한다.

최소 포함 항목:

1. `doc_refs.runbook_checklist`
2. `doc_refs.artifact_contract`

즉, operator가 submit request만 열어도 이번 build가 bounded explicit cycle 자동 검증 경로인지, 아니면 auto-select runtime finalize 경로인지 즉시 알아야 한다.

동시에 operator는 이 build가 단순 실행 요청이 아니라, 최종적으로 `APPROVE_DEPLOY`, blocker-free, evidence-complete bounded approval을 만들어야 하는 요청이라는 것도 즉시 알아야 한다.

여기서 `lineage_hash_match_required` 는 단순히 lineage field 존재만 의미하지 않는다.

즉, submit 직전에는 아래 세 hash가 같은 bounded provenance 축을 가리켜야 한다.

1. `promotion-preflight.json.lineage_contract.hash`
2. `promotion-runtime-manifest.json.snapshot_meta.lineage_contract.hash`
3. `promotion-deploy-decision.json.bounded_runtime_summary.lineage_contract.hash`

`promotion-cloudbuild-context.json.lineage_contract_hash` 와 `deploy_decision_summary.lineage_contract_hash` 는 이 최종 hash를 operator가 한 파일에서 즉시 읽기 위한 wrapper-level 요약 필드다.

submit request의 `approval_evidence_sources.lineage_hash_sources` 는 이 hash를 어디서 비교해야 하는지 미리 고정한 목록이다.

즉, V1처럼 “무엇을 비교해야 하는지”가 사람 기억에만 남아 있다가 마지막에 흐려지는 운영을 금지한다.

동시에 `approval_verification` 은 submit wrapper가 그 목록을 실제 artifact에 대입해 확인한 결과다.

즉, request는 더 이상 단순 계획서가 아니라, 제출 직전 fail-closed 검증 결과를 포함한 증거 문서여야 한다.

`approval_verification.blocker_summary` 는 submit 단계 전용 1차 요약이다.

최소 포함 항목:

1. `blocker_n`
2. `top_failures`
3. `has_provenance_blocker`
4. `has_bounded_runtime_blocker`
5. `has_runbook_blocker`
6. `has_context_blocker`
7. `has_candidate_selection_blocker`
8. `has_stale_artifact_provenance_blocker`
9. `has_live_evidence_cycle_blocker`
10. `has_production_entry_protected_canary_blocker`

`approval_verification.recommended_next_action` 과 `approval_verification.recommended_next_action_reason` 도 같이 남아야 한다.

즉, submit이 차단됐을 때 operator가 raw check 배열을 다 읽기 전에 어떤 계열 문제인지와 다음 행동을 즉시 복원할 수 있어야 한다.

특히 `SUBMIT_CHK_20A` 실패는 단순 bounded runtime 누락이 아니라 `PROTECTED_ENTRY_CANARY` 계열로 먼저 드러나야 한다. 이 필드는 production entry가 SL/TP1 보호주문 체인을 증명하지 못했다는 의미이므로, `recommended_next_action` 은 `FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION` 이어야 한다.

동시에 `SUBMIT_CHK_11`, `SUBMIT_CHK_19`, `SUBMIT_CHK_20A` 가 stale artifact provenance 때문에 실패하면 `has_stale_artifact_provenance_blocker=true` 가 먼저 드러나야 한다. 이 경우 문제는 본체 runtime 수정이 아니라 현재 artifact dir 증거를 다시 만드는 것이므로, `recommended_next_action` 은 `DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE` 이어야 한다.

동시에 LIVE evidence cycle mismatch blocker는 `has_live_evidence_cycle_blocker=true` 와 `LIVE_EVIDENCE_CYCLE` 계열로 먼저 드러나야 한다. 이 경우 operator는 개별 readiness artifact를 수정하지 말고 전체 artifact dir을 폐기한 뒤 같은 `position_cycle_id` 로 fresh promotion pipeline을 재실행해야 한다.

동시에 각 check는 runbook checklist 번호와 artifact contract 필드명을 직접 가리켜야 한다.

즉, submit 차단 메시지와 운영 문서가 다른 언어를 쓰지 않도록, 마지막 검증 단계에서도 같은 번호 체계를 유지해야 한다.

현재 auto-select도 예외 경로가 아니라 runtime finalize 경로다.

즉, request 시점에는 cycle이 미정이어도 최종 artifact는 `<requested-artifact-dir>/<selected-position-cycle-id>` 로 bounded finalize 되어야 한다.

따라서 auto-select에서 root staging dir에 남는 `promotion-cloudbuild-context.json` 도 `resolved_artifact_dir` 를 통해 final bounded dir를 가리켜야 한다.

## mock producer

로컬과 CI smoke 용 mock producer를 둔다.

1. script: `npm run generate:v2-promotion-artifacts:mock`
2. env: `V2_PROMOTION_ARTIFACT_DIR`
3. env: `V2_PROMOTION_MODE`
4. env: `V2_PROMOTION_MOCK_PROFILE`

`V2_PROMOTION_MOCK_PROFILE`은 아래 셋 중 하나만 허용한다.

1. `CLEAN`
2. `WARN`
3. `BLOCKED`

이 producer는 운영 artifact 대체제가 아니라 gate 폐루프 검사용이다.

즉, V2가 live 승격되기 전에는 mock으로 wrapper/CI 계약을 검증하고, 이후에는 실제 replay/comparison producer로 교체해야 한다.

## replay artifact producer

replay는 이제 별도 실제 producer를 가진다.

1. script: `npm run generate:v2-replay-artifact`
2. output: `replay-report.json`
3. input priority:
4. `V2_PROMOTION_REPLAY_FIXTURE_FILE`
5. `V2_PROMOTION_REPLAY_FIXTURE_JSON`
6. `V2_PROMOTION_ARTIFACT_DIR/replay-fixtures.json`
7. `V2_PROMOTION_REPLAY_FIXTURE_PROFILE`

`V2_PROMOTION_REPLAY_FIXTURE_PROFILE` 기본값은 `REFERENCE_PASS` 이다.

허용 profile:

1. `REFERENCE_PASS`
2. `REFERENCE_NATIVE_PASS`
3. `REFERENCE_BLOCKED`

여기서 핵심은 replay artifact가 더 이상 hand-written report가 아니라 `evaluateReplayFixtureSet` 결과라는 점이다.

즉, V1처럼 운영자가 해석으로 pass/fail을 정하는 경로를 줄이고, reducer/watchdog/alert link 무결성이 report에 직접 반영되도록 한다.

## comparison artifact producer

comparison도 별도 실제 producer를 가진다.

1. script: `npm run generate:v2-comparison-artifacts`
2. outputs:
3. `shadow-live-comparison.json`
4. `source-mode-comparison.json`
5. input priority:
6. `V2_PROMOTION_SHADOW_LIVE_PAIRS_FILE` / `V2_PROMOTION_SOURCE_MODE_PAIRS_FILE`
7. `V2_PROMOTION_SHADOW_LIVE_PAIRS_JSON` / `V2_PROMOTION_SOURCE_MODE_PAIRS_JSON`
8. `V2_PROMOTION_ARTIFACT_DIR/comparison-fixtures.json`
9. `V2_PROMOTION_COMPARISON_FIXTURE_PROFILE`

`V2_PROMOTION_COMPARISON_FIXTURE_PROFILE` 기본값은 `REFERENCE_CLEAN` 이다.

허용 profile:

1. `REFERENCE_CLEAN`
2. `REFERENCE_WARN`
3. `REFERENCE_BLOCKED`

핵심은 comparison artifact도 hand-written report가 아니라

1. `buildShadowLiveComparisonReport`
2. `buildSourceModeComparisonReport`

평가 결과라는 점이다.

즉, V1처럼 운영자가 drift를 말로 해석하는 경로를 줄이고, blocker/warning 기준이 코드와 artifact에서 동일하게 유지되도록 한다.

## 우선순위

wrapper는 아래 순서로 입력을 읽는다.

1. 명시적 file env
2. 명시적 inline json env
3. `V2_PROMOTION_ARTIFACT_DIR` 표준 파일

즉, 디버깅 시에는 file/json env로 override 가능하지만, 기본 운영 계약은 artifact 디렉터리다.

## fail-closed 원칙

아래 중 하나라도 만족하면 gate는 실패해야 한다.

1. 표준 파일 6종 중 하나라도 없음
2. JSON 파싱 실패
3. unified promotion report blocker 존재
4. mode 정책 위반 warning 존재
5. deploy decision이 `APPROVE_DEPLOY` 가 아님

## cloudbuild 연결 원칙

cloudbuild는 아래 원칙을 따른다.

1. 기본값은 opt-in
2. mock artifact producer는 smoke 검사용으로만 opt-in 연결한다
3. real 승격 검증은 `run:v2-promotion-cloudbuild` wrapper 한 경로로만 실행한다
4. `pipeline`, `mock`, `gate-only` 는 동시에 켜지면 즉시 실패해야 한다
5. enable 시에는 artifact 디렉터리가 명시되거나, bounded mode면 `position_cycle_id` 기준으로 deterministic path가 자동 파생되어야 한다
6. live/canary 승격 판단은 mock이 아니라 real pipeline artifact 기준이어야 한다
7. `canary_flow` 는 `position_cycle_id` 없으면 즉시 실패해야 한다
8. bounded canary/live mode에서 artifact dir는 같은 `position_cycle_id` 축으로만 고정되어야 한다
   최종 submit wrapper는 이 조건을 `SUBMIT_CHK_01A` 로 다시 검증해야 한다. `promotion-cloudbuild-context.json.artifact_dir`, `resolved_artifact_dir`, `artifact_dir_coherence`, `position_cycle_id`, `promotion-deploy-decision.json.position_cycle_id`, `promotion-preflight.json.position_cycle_id`, `promotion-runtime-manifest.json.snapshot_meta.selector_meta.position_cycle_id` 가 같은 최종 bounded dir를 설명하지 못하면 provenance fail-closed다.
   또한 cloudbuild context 생성기는 `artifact_dir_coherence` 를 함께 남겨야 한다. `artifact_dir_coherence.ok=false` 또는 `reason=ARTIFACT_DIR_RESOLVED_DIR_MISMATCH` 는 runbook `CHK_01A` 와 submit `SUBMIT_CHK_01A` 를 보기 전에 이미 final dir/staging dir drift가 발생했다는 증거다.
9. bounded canary/live mode에서는 wrapper가 `promotion-deploy-decision.json` 을 직접 읽고 `APPROVE_DEPLOY` 가 아니면 즉시 실패해야 한다
10. bounded explicit cycle 경로에서는 wrapper가 `promotion-runbook-review.json` 을 자동 생성하고 `overall_status=PASS` 가 아니면 즉시 실패해야 한다
11. auto-select 경로는 runtime이 candidate selection 후 `<requested-artifact-dir>/<selected-position-cycle-id>` 로 artifact dir를 finalize 하고, wrapper는 그 final dir에서 `promotion-runbook-review.json` 을 자동 생성하고 `overall_status=PASS` 가 아니면 즉시 실패해야 한다
12. bounded canary/live mode에서는 `DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` 이 runtime env로 전달되어야 한다
13. LIVE mode에서는 `bounded_runtime_summary.repair_firestore_canary_streak` 이 `V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS` 를 증명해야 하며, CANARY mode에서는 이 증거가 없으면 deploy decision warning으로만 남긴다. 이 streak는 단순 `ok=true` JSONL이 아니라 각 row의 Firestore-backed 실행 증거를 요구한다. `firestore_evidence_missing_n=0`, `seed_write_n>=4`, `seed_writes` 의 `POSITION_CYCLES`/`EXIT_RUNTIME_PROJECTIONS`/`PROTECTION_RUNTIME`/`REPAIR_REQUESTS`, `refresh_call_n>=1`, `completion_attempts[].completion_ledger.execution_status=COMPLETED_SUCCESS`, `order_evidence[]` 가 복원되지 않으면 LIVE 승격 증거로 인정하지 않는다
14. bounded canary/live mode에서는 `entry_boundary_audit` 이 `V2_ENTRY_BOUNDARY_AUDIT_PASS` 를 증명해야 하며, 위반 시 `SUBMIT_CHK_13`/runbook 21로 fail-closed 된다. 이 감사에는 `V2_TP0_EXIT_CONTRACT_FORBIDDEN` 이 포함되어야 하고, `test:v2-promotion` 은 `v2-entry-boundary-audit.test.js` 를 실행해 V2 production source에 TP0/P0/`EXIT_TP_P0` 계약명이 다시 들어오는 것을 차단해야 한다
15. bounded canary/live mode에서는 `fill_sync_canonical_boundary_audit` 이 `V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS` 를 증명해야 하며, 위반 시 `SUBMIT_CHK_18`/runbook 25로 fail-closed 된다
16. bounded canary/live mode에서는 `production_cutover_audit` 이 `V2_PRODUCTION_CUTOVER_AUDIT_PASS` 를 증명해야 하며, 위반 시 `SUBMIT_CHK_14`/runbook 22로 fail-closed 된다
17. bounded canary/live mode에서는 `production_cutover_audit.contract.checks[]` 가 live endpoint가 sizing-backed transport를 route 전에 만들고, live transport가 approved `entrySizingDecision` 없이 막히며, body/bundle sizing drift를 거부하고, live request builder가 approved sizing을 bundle에 포함한다는 것을 증명해야 하며, 위반 시 `SUBMIT_CHK_20`/runbook 27로 fail-closed 된다
18. LIVE mode에서는 `production_cutover_readiness_summary` 가 `V2_PRODUCTION_CUTOVER_READINESS_PASS` 와 `legacy_webhook_blocked=true` 를 증명해야 하며, 위반 시 `SUBMIT_CHK_15`/runbook 23으로 fail-closed 된다
19. LIVE mode에서는 `scheduler_traffic_collector_preflight_summary` 가 `V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS` 를 증명해야 하며, 위반 시 `SUBMIT_CHK_17`/runbook 24A로 fail-closed 된다
20. LIVE mode에서는 `scheduler_traffic_cutover_readiness_summary` 가 `V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS`, `scheduler_sot=OPENCLAW_CRON`, `missing_openclaw_job_ids=[]`, `active_legacy_scheduler_job_n=0`, Cloud Run service readiness를 증명해야 하며, 위반 시 `SUBMIT_CHK_16`/runbook 24로 fail-closed 된다
21. LIVE mode에서는 `run:v2-exit-runtime-canary` 가 생산한 Firestore history를 기반으로 `bounded_runtime_summary.exit_runtime_canary_streak` 이 `V2_EXIT_RUNTIME_CANARY_STREAK_PASS` 를 증명해야 하며, 위반 시 `SUBMIT_CHK_21`/runbook 28로 fail-closed 된다
22. bounded canary/live submit wrapper는 `auditWorkspaceV2ProductionRuntimeConfigContract` 를 직접 실행해 CloudBuild deploy env와 promotion runtime env forwarding 계약을 다시 검증해야 하며, 위반 시 `SUBMIT_CHK_22`/runbook 29로 fail-closed 된다
23. LIVE wrapper가 live cutover, production cutover, scheduler traffic 단계 중 어디서 실패하더라도 `promotion-cloudbuild-context.json` 은 직전까지 생성된 readiness summary와 실패 summary를 보존해야 한다
24. wrapper가 runbook review 단계에서 실패하더라도 `promotion-cloudbuild-context.json` 은 `runbook_review_summary.ok=false`, `failed_check_ids`, `top_failed_checks[]`, `runbook_review_file` 을 보존해야 한다
25. runbook review가 필수 artifact 누락/JSON 파싱 오류 등으로 review 생성 전에 throw 되더라도 context에는 synthetic `CHK_RUNBOOK_REVIEW_THROWN` 이 남아야 한다
26. submit wrapper의 operator summary와 operator alert preview는 `runbook_review`, `runbook_review_failures`, `runbook_review_failed_checks`, `runbook_review_file` 을 같은 line set으로 노출해야 한다

`SUBMIT_CHK_17` 실패는 `SCHEDULER_COLLECTOR_BLOCKER` 이며, 권장 행동은 `FIX_V2_SCHEDULER_COLLECTOR_IAM_AND_RERUN_LIVE_CLOUDBUILD_WRAPPER` 이다.

`SUBMIT_CHK_16` 실패는 `SCHEDULER_TRAFFIC_BLOCKER` 이며, 권장 행동은 `FIX_V2_SCHEDULER_TRAFFIC_CUTOVER_AND_RERUN_LIVE_CLOUDBUILD_WRAPPER` 이다.

두 실패는 `PRODUCTION_CUTOVER_BLOCKER` 로 묶지 않는다.

`scheduler_traffic_cutover_readiness_summary` 의 입력 상태는 `scripts/collect-v2-scheduler-traffic-state.js` 가 만든 `v2_scheduler_traffic_state_latest.json` 또는 동일 payload에서 파생된 `DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON` 이어야 한다.

즉, 사람이 Cloud Console을 보고 임의로 만든 JSON으로 LIVE submit을 통과시키는 것을 정상 경로로 보지 않는다. 정상 경로는 collector -> readiness -> cloudbuild context -> submit verification -> operator alert preview 순서다.

collector 자체의 실행 권한은 `scripts/check-v2-scheduler-traffic-collector-prereq.js` 로 먼저 증명한다.

이 preflight 산출물은 `v2_scheduler_traffic_collector_preflight_latest.json` 이며, 실패 시 `SCHED_TRAFFIC_COLLECTOR_PREREQ_01_PROJECT_RESOLVED`, `SCHED_TRAFFIC_COLLECTOR_PREREQ_02_SCHEDULER_JOBS_LIST`, `SCHED_TRAFFIC_COLLECTOR_PREREQ_03_RUN_SERVICE_DESCRIBE_*` 중 하나로 원인을 좁힌다.

LIVE cloudbuild wrapper는 collector preflight 실패 시에도 `promotion-cloudbuild-context.json` 을 다시 써야 한다.

이때 `scheduler_traffic_collector_preflight_summary.ok=false`, `failed_check_ids`, `project_id`, `region`, `service_names`, `scheduler_traffic_collector_preflight_file` 이 보존되어야 하며, `scheduler_traffic_cutover_readiness_summary` 는 아직 실행되지 않았으면 `null` 이어야 한다.

readiness 실패와 collector 권한 실패는 같은 장애로 취급하지 않는다.

Cloud Build validation/promotion runtime은 `gcr.io/google.com/cloudsdktool/cloud-sdk:alpine` 계열에서 `nodejs npm` 을 설치해 실행한다.

이유는 LIVE scheduler traffic collector가 `gcloud` 를 필요로 하면서도 같은 step에서 Node 기반 promotion wrapper를 실행해야 하기 때문이다.

Cloud Build wrapper mode:

1. `_V2_PROMOTION_CANARY_FLOW_ENABLED=1` -> `run:v2-promotion-canary-flow`
2. `_V2_PROMOTION_PIPELINE_ENABLED=1` -> `run:v2-promotion-pipeline`
3. `_V2_PROMOTION_GATE_ENABLED=1` -> `check:v2-promotion-gate`
4. `_V2_PROMOTION_MOCK_ARTIFACTS_ENABLED=1` -> `generate:v2-promotion-artifacts:mock`

둘 이상 동시에 켜지면 wrapper가 fail-closed로 종료한다.

Cloud Build validation step은 deploy 전에 `npm run check:v2-production-runtime-config` 를 실행해야 한다.

이 검사는 `cloudbuild.yaml` 자체가 아래 substitution과 Cloud Run env mapping을 보유하는지 확인한다.

1. `_DONBEOLJA_V2_ENABLED` -> `DONBEOLJA_V2_ENABLED`
2. `_DONBEOLJA_V2_DRY_RUN` -> `DONBEOLJA_V2_DRY_RUN`
3. `_DONBEOLJA_V2_CANARY_ONLY` -> `DONBEOLJA_V2_CANARY_ONLY`
4. `_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER` -> `DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER`
5. `_DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL` -> `DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL`
6. `_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL` -> `DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL`
7. `_DONBEOLJA_V2_COLLECTION_PREFIX` -> `DONBEOLJA_V2_COLLECTION_PREFIX`
8. `_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE` -> `DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE`
9. `_DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON` -> `DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON` promotion runtime input
10. fixed `SCHEDULER_AUTOSTART=0`

기본 substitution 값은 안전값이다.

1. `_DONBEOLJA_V2_ENABLED=0`
2. `_DONBEOLJA_V2_DRY_RUN=1`
3. `_DONBEOLJA_V2_CANARY_ONLY=1`
4. `_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=0`
5. `_DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=1`
6. `_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL=0`
7. `_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=OPENCLAW_CRON`
8. `_DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON=""`

즉, 설정 통로는 항상 존재해야 하지만 LIVE 전환은 submit/runbook readiness가 승인한 substitution 조합에서만 가능해야 한다.

V2 scheduler cutover mode의 기본값은 `OPENCLAW_CRON` 이어야 한다.

즉, Cloud Run 서버 내장 scheduler는 `SCHEDULER_AUTOSTART=0` 으로 유지하고, 운영 automation은 OpenClaw cron manifest가 소유해야 한다.

Cloud Build submit wrapper:

1. script: `npm run submit:v2-promotion-cloudbuild`
2. 입력: wrapper mode env + `GOOGLE_CLOUD_PROJECT`
3. 출력: `promotion-cloudbuild-submit-request.json`
4. 기본값은 submit disabled 이고 request artifact만 생성한다
5. `V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED=1` 일 때만 실제 `gcloud builds submit` 을 호출한다
6. bounded CANARY/LIVE request는 `_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` substitution을 포함해야 한다
7. LIVE request는 안전 기본값에 의존하지 않고 `_DONBEOLJA_V2_ENABLED=1`, `_DONBEOLJA_V2_DRY_RUN=0`, `_DONBEOLJA_V2_CANARY_ONLY=0`, `_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=1`, `_DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=1`, `_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL=0`, `_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=OPENCLAW_CRON` 을 강제 substitution으로 남겨야 한다

핵심은 “무슨 substitutions로 build를 제출했는가”가 artifact로 남아야 한다는 점이다.

## unified real pipeline

real artifact 생성과 gate 판정은 아래 단일 스크립트로 묶는다.

1. script: `npm run run:v2-promotion-pipeline`
2. 단계:
3. replay artifact 생성
4. comparison artifact 2종 생성
5. unified promotion report 생성
6. deploy decision artifact 생성
7. gate 판정

deploy decision script:

1. script: `npm run check:v2-promotion-deploy-decision`
2. input: `unified-promotion-report.json`
3. output: `promotion-deploy-decision.json`

deploy decision artifact는 최종 승인/차단 판정 외에도 아래를 그대로 보존해야 한다.

1. `bounded_runtime_summary`
2. `candidate_selection_summary`
3. `selector_meta`
4. `bounded_runtime_summary.lineage_contract`
5. `bounded_runtime_summary.alert_retry_summary`
6. `bounded_runtime_summary.openclaw_execution_audit_ledger_write`
7. `bounded_runtime_summary.repair_firestore_canary_streak`
8. `bounded_runtime_summary.exit_runtime_canary_streak`
9. `entry_boundary_audit`
10. `fill_sync_canonical_boundary_audit`
11. `production_cutover_audit`
12. `production_cutover_audit.contract.checks[]` 중 live entry sizing contract check
13. `alert_retry_summary`
14. `alert_retry_attention_required`

`candidate_selection_summary` 가 존재하는 경우 deploy decision은 `selection_contract` 도 그대로 보존해야 한다.
즉, auto-select가 만든 후보 선택 근거를 마지막 승인 artifact에서 다시 복원할 수 있어야 한다.
승인 단계에서 필요한 것은 단순한 `selected_position_cycle_id` 문자열이 아니라, 그 cycle이 bounded preflight-ready candidate였다는 기계 판독 근거다.

동시에 `bounded_runtime_summary.lineage_contract` 도 보존해야 한다.
이 값은 selector meta에서 계산한 canonical hash이며, `promotion-preflight.json.lineage_contract` 및 `promotion-runtime-manifest.json.snapshot_meta.lineage_contract` 와 같은 값이어야 한다.
즉, 최종 승인 artifact 하나만 열어도 “이 판단이 정확히 어떤 bounded lineage 위에서 나왔는가”를 복원할 수 있어야 한다.

동시에 `selector_meta` 도 top-level에 보존해야 한다.
`selector_meta.position_cycle_id`, 최종 `position_cycle_id`, `candidate_selection_summary.selected_position_cycle_id`, `candidate_selection_summary.selected_preflight.position_cycle_id` 는 같은 값이어야 한다.
불일치하면 deploy decision은 `DEPLOY_DECISION:SELECTOR_META_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:SELECTOR_CANDIDATE_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_POSITION_CYCLE_MISMATCH` 중 해당 blocker로 fail-closed 해야 한다.

동시에 `bounded_runtime_summary.alert_retry_summary` 도 보존해야 한다.

최소 포함 항목:

1. `outbox_n`
2. `failed_n`
3. `sent_n`
4. `pending_n`
5. `retryable_failed_n`
6. `terminal_failed_n`
7. `family_counts`
8. `retry_policy_counts`
9. `runbook_ref_counts`
10. `latest_failed`

즉, operator가 `trade_alert_outbox_v2` raw row를 직접 뒤지지 않아도 현재 alert delivery/retry 문제가 어느 계열인지, 자동 retry 대상인지, 다시 볼 runbook ref가 무엇인지 최종 승인 artifact 상단에서 바로 읽을 수 있어야 한다.

동시에 `alert_retry_summary` 와 `alert_retry_attention_required` 도 deploy decision top-level에 같이 남겨야 한다.

즉, operator가 `bounded_runtime_summary` 안쪽을 끝까지 펼치지 않아도 마지막 승인 artifact를 열자마자 alert retry 주의 상태를 한 번에 읽을 수 있어야 한다.

`CANARY/LIVE` 에서는 `bounded_runtime_summary` 가 비어 있거나 핵심 필드가 빠져 있으면 `APPROVE_DEPLOY` 를 내리면 안 된다.

최소 요구 필드는 아래 네 묶음이다.

1. `selector_query_budget`
2. `collector_query_budget`
3. `exporter_snapshot_size_bytes`
4. `manifest_counts`

동시에 `bounded_runtime_summary.evidence_snapshot_summary` 도 필수다.
coverage summary가 없거나 `missing_transition_evidence_n`, `missing_protection_runtime_evidence_n` 중 하나라도 0이 아니면 deploy decision은 blocker를 남기고 차단해야 한다.

동시에 `bounded_runtime_summary.runtime_chain_audit_summary` 도 필수다.
`ok=true`, `check_n > 0`, `fail_n=0`, `failed_check_ids=[]` 가 아니면 deploy decision은 blocker를 남기고 차단해야 한다.
핵심은 V2 entry/protection/reducer/alert chain 감사가 단위 테스트에만 머물지 않고, 최종 승격 산출물 안에서도 같은 cycle의 runtime chain 증거로 남아야 한다는 점이다.

또한 `bounded_runtime_summary.lineage_contract` 도 필수다.
`version`, `hash` 둘 다 비어 있으면 안 되고, wrapper / runbook 경로에서는 preflight와 manifest의 lineage contract hash와 일치해야 한다.
핵심은 같은 cycle id라고 해서 같은 bounded evidence라고 가정하지 않는 것이다.
V1의 약점은 같은 cycle처럼 보여도 selector 재실행으로 linked doc와 query window가 조용히 바뀌는 경로에 있었다.

또한 `candidate_selection_summary` 가 존재하는 경우에는 `selected_position_cycle_id` 와 최종 `position_cycle_id` 가 일치해야 한다.
`selector_meta.position_cycle_id` 와 `candidate_selection_summary.selected_preflight.position_cycle_id` 도 같은 값이어야 한다.
이 중 하나라도 다르면 `DEPLOY_DECISION:SELECTOR_META_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:SELECTOR_CANDIDATE_POSITION_CYCLE_MISMATCH`, `DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_POSITION_CYCLE_MISMATCH` 로 차단해야 한다.

즉, auto-select가 끼어 있는 승격에서 “선택한 cycle” 과 “승인한 cycle” 이 다르면 마지막 승인 단계에서 즉시 차단돼야 한다.

동시에 `candidate_selection_summary.selection_contract` 도 필수다.
최소 요구는 아래 아홉 개가 모두 `true` 인 것이다.

1. `ok`
2. `scan_limit_respected`
3. `recent_window_enforced`
4. `selected_candidate_present`
5. `selected_preflight_ok`
6. `selected_runtime_chain_ok`
7. `selected_cycle_matches_preflight`
8. `selected_cycle_matches_collector_env`
9. `selected_snapshot_counts_exact`

즉, auto-select artifact가 있더라도 selection contract가 비어 있거나 하나라도 false면 deploy decision은 마지막 승인선에서 fail-closed여야 한다.

핵심은 wrapper가 이 파일 하나만 읽더라도, 승인 여부와 함께 어떤 bounded 증거 위에서 승인했는지 복원 가능해야 한다는 점이다.

unified promotion report는 아래 요약을 반드시 같이 남겨야 한다.

1. selector query budget summary
2. collector query budget summary
3. exporter snapshot size bytes
4. manifest count summary
5. 동일 artifact dir에 `promotion-canary-candidate-selection.json` 이 있으면 candidate selection summary
6. `bounded_runtime_summary.evidence_snapshot_summary`
7. `bounded_runtime_summary.lineage_contract`

`evidence_snapshot_summary` 는 선택사항이 아니다.
이 값은 exporter가 runtime snapshot의 `episodes[].transitions[].source_exchange_evidence` 와 `episodes[].protectionRuntime.last_exchange_evidence` 를 직접 세어 계산한 coverage여야 한다.
즉, 외부 입력 JSON이 임의 summary를 넣더라도 최종 manifest와 unified report는 exporter 계산값을 기준으로 읽어야 한다.

필수 필드는 아래 여섯 개다.

1. `transition_n`
2. `transition_evidence_n`
3. `missing_transition_evidence_n`
4. `protection_runtime_n`
5. `protection_runtime_evidence_n`
6. `missing_protection_runtime_evidence_n`

`ok=true`, `missing_transition_evidence_n=0`, `missing_protection_runtime_evidence_n=0` 가 아니면 canary/live deploy decision은 무조건 fail-closed여야 한다.

`lineage_contract` 도 선택사항이 아니다.
최소 요구는 아래 두 항목이다.

1. `version`
2. `hash`

운영 경로에서는 같은 artifact dir 안의 아래 세 해시가 모두 일치해야 한다.

1. `promotion-preflight.json.lineage_contract.hash`
2. `promotion-runtime-manifest.json.snapshot_meta.lineage_contract.hash`
3. `promotion-deploy-decision.json.bounded_runtime_summary.lineage_contract.hash`

즉, preflight 이후 pipeline이 selector를 다시 실행해 다른 bounded lineage를 태우는 경로를 허용하지 않는다.

핵심은 운영자가 replay/comparison/gate 판정만 보는 것이 아니라, 그 판정이 bounded selector/collector/exporter 제약 안에서 생성됐는지 한 파일에서 확인할 수 있어야 한다는 점이다.

핵심 규칙:

1. `SHADOW` 는 절대 deploy approve가 아니다
2. `CANARY/LIVE` 는 `position_cycle_id` 없는 승인 불가
3. 최종 배포 판단은 raw comparison report가 아니라 deploy decision artifact로 읽는다

이 스크립트는 mock env 혼입을 금지한다.

즉, V1처럼 smoke와 real 판정이 섞여 운영자가 어느 결과를 믿어야 하는지 헷갈리는 상태를 허용하지 않는다.

## runtime snapshot exporter

real pipeline이 reference profile 대신 운영 스냅샷을 받을 수 있도록 exporter를 둔다.

1. script: `npm run export:v2-promotion-runtime-snapshot`
2. input priority:
3. `V2_PROMOTION_RUNTIME_SNAPSHOT_FILE`
4. `V2_PROMOTION_RUNTIME_SNAPSHOT_JSON`
5. `V2_PROMOTION_ARTIFACT_DIR/promotion-runtime-snapshot.json`

입력 스냅샷은 아래 세 묶음을 반드시 포함해야 한다.

1. `episodes`
2. `shadowLivePairs`
3. `sourceModePairs`

export 결과:

1. `replay-fixtures.json`
2. `comparison-fixtures.json`
3. `promotion-runtime-manifest.json`

핵심은 V1처럼 운영 증거와 승격 artifact가 분리되지 않게 하는 것이다.

즉, runtime snapshot이 들어오면 pipeline은 그것을 fixture 파일로 표준화한 뒤 동일한 evaluator를 타야 한다.

추가 원칙:

1. `TP1_REACHED` shadow transition은 webhook alert나 stage hint만으로 생성하면 안 된다
2. `binanceFuturesFillsSync`의 실제 fill evidence와 누적 TP1 수량이 target을 닫았을 때만 artifact에 포함돼야 한다
3. split fill 중간 상태는 transition 미발행이 정상이며, artifact도 이를 mismatch가 아니라 pending evidence로 해석해야 한다
4. `TRAIL_ACTIVATED` shadow transition은 `binanceTickExit`의 실제 native stop refresh success와 `chosen_stop_source=TRAIL`이 동시에 확인될 때만 artifact에 포함돼야 한다
5. `SL_HIT` / `TRAIL_HIT` shadow transition은 `binanceFuturesFillsSync`의 실제 full-exit stop fill만 받아야 하며, 최종 event 분류는 raw event string보다 V2 projection stage를 우선해야 한다
6. runtime snapshot에는 watchdog terminal mismatch issue(`TERMINAL_TRANSITION_MISSING`, `TERMINAL_PROJECTION_MISMATCH`, `TERMINAL_STAGE_WITH_ACTIVE_POSITION`)가 포함돼야 하며, gate는 이를 warning이 아니라 blocker로 다뤄야 한다

runtime candidate replay scope:

1. reference replay fixture는 전체 event family coverage를 요구한다
2. runtime snapshot exporter가 만드는 단일 canary replay fixture는 `replay_context.scope=RUNTIME_CANDIDATE` 를 포함해야 한다
3. 같은 fixture는 `replay_context.require_transition_event_coverage=false` 를 포함해야 한다
4. 이 flag는 단일 실거래 cycle이 `SL_HIT`, `TRAIL_HIT`, `EXTERNAL_CLOSE_SYNC`, `MANUAL_CLOSE_SYNC` 를 동시에 모두 보여야 한다는 잘못된 요구만 끈다
5. episode 내부 무결성, terminal consistency, outbox evidence, protection runtime evidence, watchdog blockers는 계속 fail-closed다
6. deploy decision은 runtime candidate replay에서 coverage blocker를 생략할 수 있지만, `bounded_runtime_summary.runtime_chain_audit_summary` 는 계속 필수다

## firestore collector

runtime snapshot을 사람이 수동으로 조합하지 않도록 collector를 둔다.

1. script: `npm run collect:v2-promotion-runtime-snapshot`
2. 기준축: `V2_PROMOTION_COLLECT_POSITION_CYCLE_ID`
3. collector는 이 기준축에 연결된 V2 문서만 읽는다

필수 입력:

1. `V2_PROMOTION_COLLECT_POSITION_CYCLE_ID`
2. `V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID`
3. `V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID`
4. `V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID`

collector는 아래 문서를 읽어 `promotion-runtime-snapshot.json`을 만든다.

1. `position_cycles_v2`
2. `exit_runtime_projection_v2`
3. `protection_runtime_v2`
4. `canonical_exit_transitions_v2`
5. `trade_alert_outbox_v2`
6. `exit_repair_requests_v2`
7. `signal_intents_v2`
8. `feature_snapshots_v2`
9. `ml_ai_signal_proposals_v2`
10. `ml_ai_evidence_ledger_v2`
11. `openclaw_decisions_v2`

collector query budget 원칙:

1. transition / outbox / repair request / linked doc query는 모두 explicit limit를 가져야 한다
2. collector는 limit에 닿은 결과를 정상으로 간주하면 안 된다
3. query 결과 row 수가 limit와 같아지면 truncation 가능성이 있으므로 즉시 fail-closed 해야 한다
4. snapshot meta에는 실제 query limit와 수집 count가 같이 남아야 한다

collector 추가 입력:

1. `V2_PROMOTION_COLLECT_EXCHANGE_STATE_JSON`
2. 최소 필드: `has_active_position`

이 입력은 terminal mismatch를 runtime snapshot 단계에서 재구성할 때 사용한다.

1. 거래소 flat + non-terminal projection + terminal transition 부재 -> `TERMINAL_TRANSITION_MISSING`
2. terminal transition 존재 + non-terminal projection -> `TERMINAL_PROJECTION_MISMATCH`
3. terminal projection + 거래소 active position -> `TERMINAL_STAGE_WITH_ACTIVE_POSITION`

selector / preflight 전달 규칙:

1. `V2_PROMOTION_SELECT_EXCHANGE_STATE_JSON` 이 있으면 selector는 `V2_PROMOTION_COLLECT_EXCHANGE_STATE_JSON` 으로 그대로 전달해야 한다
2. `V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON` 이 있으면 candidate selector는 이를 preflight selector env로 전달해야 한다
3. preflight snapshot에 terminal mismatch watchdog issue가 있으면 candidate 단계에서 즉시 fail-closed 해야 한다
4. `V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED=1` 이면 canary flow는 candidate selector artifact를 먼저 남기고, terminal mismatch 후보는 pipeline 전에 `CANDIDATE_BLOCKED` 로 종료해야 한다
5. cloudbuild submit substitution도 `V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED` 와 `V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON` 을 그대로 넘겨야 하며, auto-select canary의 deploy decision에는 최종 `position_cycle_id` 가 반드시 포함되어야 한다

운영 전제도 분명해야 한다.

1. `signal_intents_v2` / `openclaw_decisions_v2` 는 실제 shadow runtime writer가 채워야 한다
2. `position_cycles_v2` / `protection_runtime_v2` / `exit_runtime_projection_v2` 는 opening fill 이후, full protection confirmed 조건에서만 shadow bootstrap writer가 채워야 한다
3. 이 둘만 채워진 상태는 promotion 입력으로 충분하지 않다
4. `position_cycles_v2` / `protection_runtime_v2` / `exit_runtime_projection_v2` 가 비어 있으면 selector는 `NO_ACTIVE_POSITION_CYCLES` 로 fail-closed 해야 한다
5. stop 또는 tp1 보호주문이 하나라도 비면 active cycle bootstrap 자체를 금지해야 한다

exporter guard 원칙:

1. runtime snapshot은 max bytes를 넘어가면 export 전에 즉시 fail-closed 해야 한다
2. episode / shadow-live pair / source-mode pair count도 상한을 가져야 한다
3. manifest에는 snapshot size bytes가 남아야 한다

핵심은 V1처럼 운영자가 여러 화면과 문서를 보고 수동으로 snapshot을 다시 쓰는 경로를 줄이는 것이다.

즉, collector -> exporter -> evaluator 순서가 real path가 된다.

collector는 단순 수집기로 끝나면 안 된다.

selector가 이미 bounded 축을 골랐더라도, collector는 아래를 다시 검증해야 한다.

1. `position_cycle_id` 가 position / projection / protection runtime 전체에 동일한가
2. position cycle의 native `signal_intent_id`, `openclaw_decision_id` 가 실제 native 문서와 일치하는가
3. shadow proposal이 같은 symbol / side / timeframe 축인가
4. webhook signal intent가 같은 symbol / side 이고 `WEBHOOK_ASSISTED` 인가
5. webhook decision이 webhook signal intent에 실제로 연결되고 native `policy_scope` 와 일치하는가
6. `selector_meta` 가 있으면 그 안의 id와 실제 collector 입력이 다시 일치하는가

즉, selector가 맞아도 collector가 다시 막아야 한다.

여기서 느슨해지면 V1처럼 앞단 검증을 믿고 뒤에서 다른 축 문서를 섞는 약점이 다시 생긴다.

## 운영 금지사항

아래 방식은 금지한다.

1. 사람 손으로 JSON 내용을 복사해서 shell env에 붙여 넣는 운영
2. replay만 있고 comparison이 없는 반쪽 artifact
3. shadow/live만 있고 webhook/native가 없는 반쪽 artifact

## bounded selector

운영자가 promotion collector 입력 id 네 개를 수동으로 찾는 단계도 줄여야 한다.

여기가 다시 사람 의존 단계로 남아 있으면 V1처럼 운영자가 잘못된 비교축을 집어넣고도 pipeline이 돌아가는 약점이 생긴다.

그래서 V2는 selector를 먼저 두고, selector가 `position_cycle_id` 하나를 기준축으로 collector 입력 세트를 fail-closed로 뽑는다.

1. script: `npm run select:v2-promotion-runtime-inputs`
2. 필수 입력: `V2_PROMOTION_SELECT_POSITION_CYCLE_ID`
3. selector 출력: `promotion-collector-inputs.json`
4. selector는 아래 문서를 bounded query로만 읽는다

selector guard 원칙:

1. runtime selector는 explicit `position_cycle_id` 하나만 기준축으로 삼아야 한다
2. runtime selector는 recent window 밖의 cycle을 promotion 입력으로 승격하면 안 된다
3. linked doc / shadow proposal / webhook signal / webhook decision 검색은 모두 explicit query limit를 가져야 한다
4. selector query 결과가 limit에 닿으면 truncation 가능성이 있으므로 즉시 fail-closed 해야 한다
5. selector meta에는 query limit와 recent cutoff가 남아야 한다

1. `position_cycles_v2`
2. `signal_intents_v2`
3. `feature_snapshots_v2`
4. `ml_ai_signal_proposals_v2`
5. `ml_ai_evidence_ledger_v2`
6. `openclaw_decisions_v2`

selector는 아래를 자동 결정한다.

1. native signal intent / decision / feature snapshot / proposal / ml evidence
2. shadow proposal
3. webhook signal intent / decision

candidate selector guard 원칙:

1. active cycle universe scan도 explicit scan limit를 가져야 한다
2. active cycle query 결과가 scan limit에 닿으면 즉시 fail-closed 해야 한다
3. candidate selector는 recent window 밖의 active cycle을 평가하지 않아야 한다
4. recent window 안에 active cycle이 없으면 `NO_RECENT_ACTIVE_POSITION_CYCLES` 로 no-op skip 되어야 한다
5. candidate selection artifact에는 scan limit, recent window, active/recent cycle count가 남아야 한다

selector는 자동 선택만 하는 것이 아니라 비교축 무결성도 검사한다.

fail-closed 검사:

1. native linked doc가 모두 같은 `signal_intent_id`에 묶이는가
2. shadow proposal이 같은 symbol / side / timeframe 축인가
3. webhook signal intent가 같은 symbol / side 축인가
4. webhook decision이 webhook signal intent에 실제로 연결되는가
5. webhook decision `policy_scope`가 native decision `policy_scope`와 일치하는가

찾지 못하면 보정하지 않고 즉시 fail-closed로 끝낸다.

selector는 선택 결과뿐 아니라 선택 근거도 남긴다.

1. `promotion-collector-inputs.json`
2. `snapshotMeta.selector_meta`
3. `promotion-runtime-manifest.json.snapshot_meta.selector_meta`

즉, real path는 이제 아래 순서다.

1. selector
2. collector
3. exporter
4. replay/comparison evaluator

## canary preflight

실제 운영 cycle을 바로 artifact 생성으로 보내지 않는다.

V2는 먼저 preflight를 태워서 이 cycle이 bounded promotion 대상인지 검사한다.

1. script: `npm run check:v2-promotion-canary-preflight`
2. 필수 입력: `V2_PROMOTION_SELECT_POSITION_CYCLE_ID`
3. 출력: `promotion-preflight.json`

preflight는 아래를 dry-run으로 확인한다.

1. selector가 실제 collector 입력 세트를 fail-closed로 선택하는가
2. collector가 실제 snapshot 1세트를 만들 수 있는가
3. snapshot 안의 `selector_meta.alignment_checks`가 모두 true 인가
4. episode / shadow_live / source_mode count가 모두 1인가
5. projection / protection runtime이 같은 `position_cycle_id` 축인가

## canary candidate selector

운영자가 실제 production data에서 어떤 `position_cycle_id`를 집을지부터 흔들리면 V1 약점이 다시 나온다.

그래서 V2는 candidate selector를 둔다.

1. script: `npm run select:v2-promotion-canary-candidate`
2. 입력:
3. `V2_PROMOTION_MODE`
4. `V2_PROMOTION_CANDIDATE_STATUS` 기본값 `ACTIVE_PROTECTED`
5. `V2_PROMOTION_CANDIDATE_LIMIT` 기본값 `10`
6. 출력: `promotion-canary-candidate-selection.json`

이 스크립트는 별도 후보 규칙을 만들지 않는다.

`position_cycles_v2(status=ACTIVE_PROTECTED)`를 읽고, 각 cycle에 기존 canary preflight를 그대로 태운다.

`ACTIVE` 는 legacy compatibility 값으로만 남긴다. V2 promotion selector의 기본값은 보호주문 `SL + TP1` 이 모두 증명된 `ACTIVE_PROTECTED` 이다.

즉, 선택 규칙과 승격 규칙이 두 벌로 갈라지지 않는다.

선택 결과는 아래를 남긴다.

1. 선택된 `selected_position_cycle_id`
2. 선택된 cycle에 바로 투입 가능한 `collector_env`
3. 모든 평가 cycle의 preflight 요약 또는 fail reason
4. `selection_status`
5. `active_position_cycle_n`
6. `selection_contract`

`selection_contract` 는 operator 설명용 문자열이 아니라, auto-select가 정말 bounded preflight-ready cycle을 선택했는지에 대한 기계 판독용 계약이다.

최소 포함 항목:

1. `scan_limit_respected`
2. `recent_window_enforced`
3. `selected_candidate_present`
4. `selected_preflight_ok`
5. `selected_runtime_chain_ok`
6. `selected_cycle_matches_preflight`
7. `selected_cycle_matches_collector_env`
8. `selected_snapshot_counts_exact`

`selection_status=READY` 이더라도 위 계약이 하나라도 false면 그 선택은 신뢰 가능한 canary 후보로 보면 안 된다.

핵심은 “최신 active cycle”이 아니라 “최신 preflight ready cycle”을 고르는 것이다.

그래야 V1처럼 operator가 최근 cycle을 집었다가 bounded promotion과 무관한 축을 태우는 문제가 줄어든다.

`selection_status` 는 최소 아래 둘을 구분해야 한다.

1. `NO_ACTIVE_POSITION_CYCLES`
2. `NO_PREFLIGHT_READY_CANDIDATES`

즉, “V2 runtime이 비어 있다”와 “cycle은 있지만 bounded promotion 준비가 안 됐다”를 운영자가 구분할 수 있어야 한다.

즉, 운영 runbook은 아래 순서를 따른다.

1. candidate selector
2. preflight
3. pipeline
4. unified promotion report review
5. selector/collector/exporter bounded summary review
6. gate

## LIVE exit runtime canary scheduler and env contract

`approval_contract.exit_runtime_canary_streak_required=true` 인 LIVE 제출은 아래 운영 연결을 요구한다.

1. OpenClaw cron endpoint: `/api/openclaw/cron/v2-exit-runtime-canary`
2. Cloud Scheduler manifest job id: `v2_exit_runtime_canary`
3. CloudBuild substitutions:
4. `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED`
5. `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED`
6. `_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE`
7. Cloud Run env:
8. `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED`
9. `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED`
10. `DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE`
11. Submit contract check: `SUBMIT_CONTRACT_CHK_49`

이 계약은 producer-only 상태를 금지한다.
즉, `run:v2-exit-runtime-canary` 가 존재해도 scheduler route, manifest, CloudBuild env, submit substitution 중 하나가 빠지면 LIVE promotion evidence로 인정하지 않는다.

## Scheduler traffic Cloud Scheduler evidence contract

`scheduler_traffic_cutover_readiness_summary` 는 아래 필드를 보존해야 한다.

1. `required_openclaw_job_ids`
2. `missing_openclaw_job_ids`
3. `openclaw_cloud_scheduler_jobs`
4. `active_legacy_scheduler_job_n`
5. `cloud_run_services`

LIVE mode에서 `required_openclaw_job_ids` 는 launchd manifest의 HIGH job과 `OPENCLAW_CLOUD_SCHEDULER_JOBS` 의 HIGH job을 모두 포함해야 한다.
`openclaw_cloud_scheduler_jobs` 는 최소 `v2_production_entry_route_canary` 와 `v2_exit_runtime_canary` 를 포함해야 하며, 두 job 모두 `enabled=true` 여야 한다.

Cloud Scheduler job은 존재만으로 충분하지 않다.
`path_match`, `schedule_match`, `time_zone_match` 가 true일 때만 enabled evidence로 인정한다.

## LIVE readiness artifact freshness contract

LIVE readiness artifact 4종도 long-run streak/protected entry canary와 같은 freshness 계약을 따른다.

대상:

1. `v2_repair_live_cutover_readiness_latest.json`
2. `v2_production_cutover_readiness_latest.json`
3. `v2_scheduler_traffic_collector_preflight_latest.json`
4. `v2_scheduler_traffic_cutover_readiness_latest.json`

각 summary는 `promotion-cloudbuild-context.json` 과 `promotion-cloudbuild-submit-request.json.submit_trace_summary` 에 아래 필드를 보존해야 한다.

1. `artifact_file`
2. `artifact_dir`
3. `artifact_filename`
4. `artifact_current_dir_match`
5. `generated_at`
6. `artifact_generated_at`
7. `artifact_generated_age_minutes`

LIVE submit은 `artifact_current_dir_match=true`, 기대 filename 일치, `generated_at`/`artifact_generated_at` 존재, `artifact_generated_age_minutes <= 180` 을 모두 요구한다.

이 중 하나라도 깨지면 submit wrapper는 해당 `SUBMIT_CHK_*` 를 실패시키고 `STALE_ARTIFACT_PROVENANCE` family로 분류해야 한다.
즉, 오래된 readiness PASS JSON을 현재 artifact dir에 복사해 LIVE 승격을 통과시키는 경로는 허용하지 않는다.
