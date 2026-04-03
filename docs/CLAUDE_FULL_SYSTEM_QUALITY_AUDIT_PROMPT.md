# CLAUDE_FULL_SYSTEM_QUALITY_AUDIT_PROMPT

아래 프롬프트를 그대로 Claude에 전달한다.

```text
이 감사는 donbeolja 전체 시스템의 최신 end-to-end 품질 검사다.
대상 범위는 아래를 모두 포함한다.

Pine -> webhook -> 1~5차 서버 실행 -> 저장/리포트 -> BEST/FEBT 감독 -> self-evolution loop -> OpenClaw autonomy contract / recovery governor / reasoning journal / autonomy parity -> Codex/Claude authority -> deployment plan -> bundle activation/probe -> OpenClaw automation scheduler -> Telegram delivery

절대 규칙:
1. 과거 감사 문서나 과거 dated artifact를 현재 근거로 직접 쓰지 마라.
2. 최신 상태 판정은 현재 코드 + `*_latest` artifact만으로 입증하라.
3. READY/HOLD/NOT_READY 또는 PASS/PARTIAL/FAIL 판정은 반드시 근거 파일 경로와 현재 값을 같이 적어라.
4. 문서 설명과 실제 코드/산출물이 다르면 반드시 finding으로 올려라.
5. top-level이 null처럼 보이는 latest는 `display/raw wrapper` 구조를 먼저 확인한 뒤 판단하라.
6. `launchd label missing`을 곧바로 장애로 판단하지 마라. 현재 local automation scheduler SSOT는 `OpenClaw cron`이다.
7. Pine 수동 붙여넣기 경계는 따로 분리해서 적고, 그것만으로 전체 자동화가 깨졌다고 쓰지 마라.
8. mixed-generation 여부는 실제 current cycle table을 먼저 만든 뒤에만 판단하라.
9. 코드를 수정하거나 배포, 거래, sync, purge, migrate, cron add/rm/run, scheduler 실행은 하지 마라. 읽기 전용 감사만 수행하라.
10. 현재 시스템은 `bundle-based hybrid canonical + OpenClaw ops substrate` 상태라는 점을 전제로 감사하라.
11. `stage_autopilot_latest.json`은 `display.cycle_id`와 `display.evaluation_cycle_id`를 분리해서 읽어라. post-loop 재실행으로 `evaluation_cycle_id`가 달라도 `display.cycle_id`가 current cycle과 같고 loop_monitor가 mismatch 0이면 cycle mismatch로 올리지 마라.
12. `SERVER_PRIMARY_ACTIVE`, `promotion_gate_status`, `promotion_ready`를 동일 의미로 읽지 마라.
13. cutover/runtime/quality가 최신 aligned cycle이고 autonomy/family artifact가 lagging cycle이면, 이를 분리해 적어라.

반드시 가장 먼저 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/docs/CURRENT_SYSTEM_STATUS_2026-04-03.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03.md
3. /Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md
4. /Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_SPEC.md
5. /Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_SYSTEM_REVIEW_RUNBOOK_2026-04-03.md
6. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md
7. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SERVER_CANONICAL_ENGINE_MIGRATION_PLAN.md
8. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md
9. /Users/jeongjaeyong/Projects/donbeolja/docs/CLAUDE_CODE_SYSTEM_QUALITY_PLAYBOOK.md
10. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_CLAUDE_AUDIT_SPEC.md
11. /Users/jeongjaeyong/Projects/donbeolja/openclaw-ops-workspace/AGENTS.md
12. /Users/jeongjaeyong/Projects/donbeolja/openclaw-ops-workspace/MEMORY.md
13. /Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md
   - archived reference only, not current truth

그 다음 최신 artifact를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/automation_watchdog_latest.json
2. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/openclaw_hourly_cycle_latest.json
3. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json
4. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json
5. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/filter_shadow_canary_latest.json
6. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/febt_phase0_baseline_latest.json
7. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_run_latest.json
8. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_dataset_latest.json
9. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_latest.json
10. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_candidates_latest.json
11. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_replay_latest.json
12. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canary_latest.json
13. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_guards_latest.json
14. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canonical_engine_parity_latest.json
15. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canonical_engine_provenance_latest.json
16. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_server_primary_canary_latest.json
17. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_pine_shadow_drift_latest.json
18. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_server_primary_acceptance_watch_latest.json
19. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_probe_latest.json
20. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_bundle_activation_latest.json
21. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_autonomy_contract_latest.json
22. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_autonomy_parity_latest.json
23. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_reasoning_journal_latest.json
24. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_recovery_governor_latest.json
25. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_plan_latest.json
26. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_monitor_latest.json
27. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_self_evolution_authority_latest.json
28. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_policy_parameter_plan_latest.json
29. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_other_server_policy_review_latest.json
30. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_cooldown_policy_review_latest.json
31. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_family_scoreboard_latest.json
32. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/stage_autopilot_latest.json
33. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/self_evolution_manual_paste_ack_latest.json
34. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/codex_weekly_patch_engine_latest.json
35. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/claude_weekly_patch_engine_latest.json
36. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_runtime_latest.json
37. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_cutover_readiness_latest.json
38. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_quality_latest.json
39. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_observation_24h_latest.json
40. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/server_signal_drift_remediation_apply_latest.json
41. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/signals.json
42. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/signals_dropped.json
43. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/order_intents_paper.json
44. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/fills_paper.json
45. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/trades_paper.json

첫 단계에서 반드시 표를 만들어라.
- layer
- artifact/code path
- cycle_id 또는 generated_at
- current cycle 일치 여부
- status summary

그 다음 아래 코드를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/code/donbeolja.pine.txt
2. /Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_latest_generated.pine.txt
3. /Users/jeongjaeyong/Projects/donbeolja/src/routes/webhook.routes.js
4. /Users/jeongjaeyong/Projects/donbeolja/src/engine/paperUpbitRunner.js
5. /Users/jeongjaeyong/Projects/donbeolja/src/utils/alerts.js
6. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-filter-shadow-canary.js
7. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-weekly-filter-governance.js
8. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js
9. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-self-evolution-loop.js
10. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-stage-autopilot.js
11. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-codex-weekly-patch-engine.js
12. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-claude-weekly-patch-engine.js
13. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-automation-watchdog.js
14. /Users/jeongjaeyong/Projects/donbeolja/scripts/lib/openclaw-cron-manifest.js
15. /Users/jeongjaeyong/Projects/donbeolja/scripts/setup-openclaw-cron.js
16. /Users/jeongjaeyong/Projects/donbeolja/scripts/disable-launchd-automations.js
17. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-deployment-plan.js
18. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-loop-monitor.js
19. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-openclaw-autonomy-contract.js
20. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-openclaw-autonomy-parity.js
21. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-reasoning-journal.js
22. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-server-primary-acceptance-watch.js
23. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-objective-recovery-governor.js
24. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-self-evolution-authority-ensemble.js
25. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionDeploymentPlan.js
26. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionLoopMonitor.js
27. /Users/jeongjaeyong/Projects/donbeolja/src/utils/selfEvolutionRuntimeState.js
28. /Users/jeongjaeyong/Projects/donbeolja/src/utils/selfEvolutionAuthorityEnsemble.js
29. /Users/jeongjaeyong/Projects/donbeolja/src/utils/openclawAutonomyContract.js
30. /Users/jeongjaeyong/Projects/donbeolja/src/utils/openclawAutonomyParity.js
31. /Users/jeongjaeyong/Projects/donbeolja/src/utils/openclawReasoningJournal.js
32. /Users/jeongjaeyong/Projects/donbeolja/src/utils/openclawFamilyScoreboard.js
33. /Users/jeongjaeyong/Projects/donbeolja/src/utils/serverPrimaryAcceptanceWatch.js
34. /Users/jeongjaeyong/Projects/donbeolja/src/utils/objectiveRecoveryGovernor.js
35. /Users/jeongjaeyong/Projects/donbeolja/src/utils/liveExecutionPolicy.js
36. /Users/jeongjaeyong/Projects/donbeolja/src/storage/signalDrops.js
37. /Users/jeongjaeyong/Projects/donbeolja/src/storage/orderIntentsPaper.js
38. /Users/jeongjaeyong/Projects/donbeolja/src/storage/fillsPaper.js

반드시 step-by-step으로 아래를 점검하라.

1. Pine
- LONG/SHORT, EARLY/CORE, strategy_id, features_json, FEBT telemetry가 문서와 일치하는가
- 차트 overlay 의미와 서버 execution 의미가 섞이지 않는가

2. Webhook
- strategy gate가 applied/prepared/runtime state를 반영하는가
- canonical strategy_id가 alias보다 우선되는가
- false STRATEGY_ID_MISMATCH 경로가 남아 있는가

3. 1~5차 서버 실행
- 드롭 사유가 stage 정책 문서와 일치하는가
- EV/WAIT/AI/시장 경로가 signals, drops, intents, fills에 일관되게 남는가
- 수량 정책은 현재 구현 사실과 문서가 일치하는가

4. 저장/리포트
- signals -> intents -> fills 연결이 가능한가
- signals -> drops 직접 join이 가능한가
- duplicate, reject, stale, latency, provenance 근거가 실제로 측정되는가
- wrapper 구조 때문에 잘못 읽기 쉬운 latest 파일이 있는가

5. BEST/FEBT 감독
- weekly governance, objective supervisor, filter shadow canary, phase0 baseline이 서로 모순되지 않는가
- readiness blocker가 계측 문제인지 실제 성과 문제인지 분리 가능한가

6. self-evolution loop
- loop run PASS와 latest artifact current cycle이 같은 generation으로 publish되는가
- dataset/objective/candidates/replay/canary/deployment/loop monitor가 실제로 연결되는가
- autonomy contract / reasoning journal / autonomy parity / family scoreboard / recovery governor가 loop와 실제로 연결되는가
- stage_autopilot_latest는 `display.cycle_id`를 main cycle, `display.evaluation_cycle_id`를 post-loop evaluation으로 구분해서 읽는가

7. Codex/Claude authority
- codex/claude/ensemble verdict가 deployment plan과 supervisor에서 실제 decision gate로 쓰이는가
- external authority pending이 숨지지 않고 명시되는가

8. deployment plan -> bundle activation -> live runtime
- prepared target, applied origin, recommended target이 분리돼 추적되는가
- bundle activation은 `ACTIVE_BY_PROBE` 또는 actual decision 근거로만 닫히는가
- manual paste ack가 runtime state를 stale overwrite하지 않는가

9. OpenClaw automation substrate
- local automation scheduler 정본이 실제로 `OpenClaw cron`인가
- watchdog가 `launchd missing`을 false failure로 보고 있지 않은가
- legacy launchd는 diagnostic only로 처리되는가
- manifest-lite / step registry / capability manifest가 현재 코드와 artifact에 반영되는가

10. Telegram / outbound messaging
- repo alert path가 OpenClaw-first transport를 쓰는가
- direct Telegram API만을 정본으로 가정하는 코드/문서가 남아 있는가

출력 형식은 반드시 아래를 따른다.

1. Findings
- 우선순위 순으로 P1/P2/P3
- 각 finding마다:
  - 무엇이 문제인지
  - 왜 문제인지
  - 현재 근거 파일
  - 현재 값
  - 영향 범위

2. Layer-by-Layer Check
- Pine
- Webhook
- 1~5차 서버 실행
- 저장/리포트
- BEST/FEBT 감독
- self-evolution loop
- Codex/Claude authority
- OpenClaw autonomy contract / reasoning journal / autonomy parity
- deployment / bundle activation / runtime
- OpenClaw automation substrate
- Telegram delivery

3. Contradictions
- 문서와 코드가 다른 점
- artifact와 artifact가 다른 점
- wrapper 구조 때문에 오해하기 쉬운 점
- aligned cycle vs lagging cycle 구분에서 생기는 오해 가능성

4. Final Verdict
- ARCHITECTURE: PASS / PARTIAL / FAIL
- OPERATIONS: READY / HOLD / NOT_READY
- AUTONOMY_EXCEPT_PINE: YES / PARTIAL / NO
- PHASE_A: PASS / PARTIAL / FAIL
- PHASE_B: PASS / PARTIAL / FAIL
- PHASE_C: PASS / PARTIAL / FAIL
- PHASE_D: PASS / PARTIAL / FAIL
- PHASE_E: PASS / PARTIAL / FAIL
- PHASE_F: PASS / PARTIAL / FAIL
- OPENCLAW_AUTOMATION: PASS / PARTIAL / FAIL
- OPENCLAW_AUTONOMY_GOVERNOR: PASS / PARTIAL / FAIL
- TELEGRAM_DELIVERY: PASS / PARTIAL / FAIL
- FEBT_PHASE4: READY / NOT_READY
- FEBT_PHASE5: READY / NOT_READY

가장 중요한 금지:
- 과거 stale finding을 현재 문제로 재사용하지 마라.
- latest artifact의 실제 값 없이 추측으로 blocker를 만들지 마라.
- `launchd label missing`만 보고 current failure로 판정하지 마라.
- `display/raw` wrapper를 풀지 않고 null만 보고 깨졌다고 쓰지 마라.
- `stage_autopilot_latest`의 `evaluation_cycle_id`만 보고 cycle mismatch로 판정하지 마라.
- 최신 aligned cutover/runtime/quality cycle을 lagging autonomy/family artifact와 강제로 하나의 current cycle이라고 써서 오판하지 마라.
```
