# CLAUDE_FULL_SYSTEM_QUALITY_AUDIT_PROMPT

아래 프롬프트를 그대로 Claude에 전달한다.

```text
이 감사는 donbeolja 전체 시스템의 최신 end-to-end 품질 검사다.
대상 범위는 아래 순서를 반드시 모두 포함한다.

Pine -> webhook -> 1~5차 서버 실행 -> 저장/리포트 -> BEST/FEBT 감독 -> self-evolution 20단계 -> Codex/Claude authority -> deployment plan -> manual paste -> live confirm

절대 규칙:
1. 과거 감사 문서나 과거 dated artifact를 현재 근거로 직접 쓰지 마라.
2. 최신 상태 판정은 현재 코드 + *_latest artifact만으로 입증하라.
3. READY/HOLD/NOT_READY 판정은 반드시 근거 파일 경로와 현재 값을 같이 적어라.
4. 문서 설명과 실제 코드/산출물이 다르면 반드시 finding으로 올려라.
5. top-level null처럼 보이는 wrapper 파일은 raw/display 구조를 먼저 확인한 뒤 판단하라.
6. Pine 수동 붙여넣기 경계는 따로 분리해서 적고, 그것만으로 전체 자동화가 깨졌다고 쓰지 마라.
7. mixed-generation 여부는 실제 current cycle table을 먼저 만든 뒤에만 판단하라.
8. 코드를 수정하거나 배포, 거래, sync, purge, migrate, scheduler 실행은 하지 마라. 읽기 전용 감사만 수행하라.

반드시 가장 먼저 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/CLAUDE_CODE_SYSTEM_QUALITY_PLAYBOOK.md
3. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_CLAUDE_AUDIT_SPEC.md
4. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_SYSTEM_ROLLOUT_PLAN.md
5. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PINE_INTRODUCTION_PLAN.md
6. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md
7. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_OPERATIONAL_GUARDS.md

그 다음 최신 artifact를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json
2. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json
3. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/filter_shadow_canary_latest.json
4. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/febt_phase0_baseline_latest.json
5. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_run_latest.json
6. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_dataset_latest.json
7. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_latest.json
8. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_candidates_latest.json
9. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_replay_latest.json
10. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canary_latest.json
11. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_guards_latest.json
12. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_plan_latest.json
13. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_monitor_latest.json
14. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_self_evolution_authority_latest.json
15. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/stage_autopilot_latest.json
16. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/self_evolution_manual_paste_ack_latest.json
17. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/codex_weekly_patch_engine_latest.json
18. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/claude_weekly_patch_engine_latest.json
19. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/signals.json
20. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/signals_dropped.json
21. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/order_intents_paper.json
22. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/fills_paper.json

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
5. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-filter-shadow-canary.js
6. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-weekly-filter-governance.js
7. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js
8. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-self-evolution-loop.js
9. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-stage-autopilot.js
10. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-codex-weekly-patch-engine.js
11. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-claude-weekly-patch-engine.js
12. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-deployment-plan.js
13. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-loop-monitor.js
14. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-self-evolution-authority-ensemble.js
15. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionDeploymentPlan.js
16. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionLoopMonitor.js
17. /Users/jeongjaeyong/Projects/donbeolja/src/utils/selfEvolutionRuntimeState.js
18. /Users/jeongjaeyong/Projects/donbeolja/src/utils/selfEvolutionAuthorityEnsemble.js

반드시 step-by-step으로 아래를 점검하라.

1. Pine
- LONG/SHORT, EARLY/CORE, strategy_id, features_json, FEBT telemetry가 문서와 일치하는가
- 차트 표시와 서버 이벤트 의미가 섞이지 않는가

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
- duplicate, reject, stale, latency 근거가 실제로 측정되는가
- wrapper 구조 때문에 잘못 읽기 쉬운 latest 파일이 있는가

5. BEST/FEBT 감독
- weekly governance, objective supervisor, filter shadow canary, phase0 baseline이 서로 모순되지 않는가
- Phase 4/5 readiness blocker가 계측 문제인지 실제 성과 문제인지 분리 가능한가

6. self-evolution 20단계
- loop run PASS와 latest artifact current cycle이 같은 generation으로 publish되는가
- dataset/objective/candidates/replay/canary/deployment/loop monitor가 실제로 연결되는가

7. Codex/Claude authority
- codex/claude/ensemble verdict가 deployment plan과 supervisor에서 실제 decision gate로 쓰이는가
- authority bypass 상태가 숨어 있지 않고 명시되는가

8. deployment plan -> manual paste -> live confirm
- prepared target, applied origin, recommended target이 분리돼 추적되는가
- manual paste ack가 runtime state를 덮어쓰거나 stale overwrite하지 않는가
- live confirm 대기/확정 상태가 artifact에 정직하게 반영되는가

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
- self-evolution 20단계
- Codex/Claude authority
- deployment/manual paste/live confirm

3. Contradictions
- 문서와 코드가 다른 점
- artifact와 artifact가 다른 점
- wrapper 구조 때문에 오해하기 쉬운 점

4. Final Verdict
- ARCHITECTURE: PASS / PARTIAL / FAIL
- OPERATIONS: READY / HOLD / NOT_READY
- AUTONOMY_EXCEPT_PINE: YES / PARTIAL / NO
- FEBT_PHASE4: READY / NOT_READY
- FEBT_PHASE5: READY / NOT_READY

가장 중요한 금지:
- 과거 stale finding을 현재 문제로 재사용하지 마라.
- latest artifact의 실제 값 없이 추측으로 blocker를 만들지 마라.
```
