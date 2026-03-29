# CLAUDE_SELF_EVOLUTION_VALIDATION_PROMPT

아래 프롬프트를 그대로 Claude Code에 전달한다.

```text
이 저장소에서 BEST/FEBT self-evolution 루프를 코드/산출물 감사 관점으로 검증해라.

먼저 반드시 아래 문서를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_CLAUDE_AUDIT_SPEC.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md
3. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_MASTER_SPEC.md

그 다음 반드시 아래 핵심 코드 파일을 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-self-evolution-loop.js
2. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js
3. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-stage-autopilot.js
4. /Users/jeongjaeyong/Projects/donbeolja/scripts/lib/best-febt-supervisor.js
5. /Users/jeongjaeyong/Projects/donbeolja/scripts/lib/automation-utils.js
6. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionLoopMonitor.js

그 다음 아래 latest 산출물을 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_run_latest.json
2. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json
3. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_dataset_latest.json
4. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_latest.json
5. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_attribution_latest.json
6. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_candidates_latest.json
7. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_replay_latest.json
8. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canary_latest.json
9. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_memory_latest.json
10. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_guards_latest.json
11. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_plan_latest.json
12. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_monitor_latest.json
13. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_weight_tuning_latest.json

필요하면 아래 세부 spec도 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DATASET_SPEC.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_OBJECTIVE_SCORE_SPEC.md
3. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_ATTRIBUTION_SPEC.md
4. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_CANDIDATE_CHANGESET_SPEC.md
5. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_CANARY_SPEC.md
6. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DEPLOYMENT_GUARDS_SPEC.md
7. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DEPLOYMENT_AUTOPILOT_SPEC.md
8. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_LOOP_MONITOR_SPEC.md
9. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_WEIGHT_TUNING_SPEC.md
10. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MEMORY_LEDGER_SPEC.md
11. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_WEEKLY_TUNING_POLICY.md

감사 목적은 아래 7개다.
1. self-evolution 루프가 실제로 end-to-end로 닫혀 있는가
2. supervisor가 Codex authority의 SSOT로 실제 기능하는가
3. loop monitor가 freshness뿐 아니라 cycle consistency를 실제 강제하는가
4. deployment plan / stage autopilot / rollback 가드가 실제 decision gate에 연결돼 있는가
5. memory ledger 기반 실패 재시도 차단이 실제 candidate 생성에 반영되는가
6. 파인 붙여넣기 제외 기준으로 이 시스템이 완전 자율에 가까운지
7. 현재 latest artifacts 기준 HOLD 사유가 구조적 결함인지 단순 성과 미달인지

중요 규칙:
- Findings를 최우선으로 제시해라.
- 칭찬보다 결함, 모호성, 구조적 누락, 가짜 자동화 위험을 먼저 적어라.
- 문서에 없는 구현 사실을 지어내지 말고, 코드/산출물에서 확인한 사실만 써라.
- 추측은 반드시 "가설"로 표시해라.
- 아키텍처 완성도와 운영 승격 가능성을 섞지 말아라.
- "완전 자율" 여부 판단에서 TradingView Pine 수동 붙여넣기는 명시적으로 제외하고 평가해라.

반드시 아래를 따로 판단해라.
1. 상위 orchestrator 존재 여부와 실제 단계 누락 여부
2. cycle_id / generation_id 원자성 보장 여부
3. objective supervisor 안에 loop monitor가 SSOT로 실리는지
4. stage autopilot이 supervisor/loop monitor blocker를 실제 적용 차단에 쓰는지
5. deployment plan이 보고용이 아니라 실제 handoff gate인지
6. memory ledger 실패 fingerprint가 candidate 생성 차단에 실제 반영되는지
7. latest artifacts가 같은 cycle을 공유하는지
8. 현재 HOLD 이유가 구조적 미완인지, 아니면 metric/canary 성과 미달인지
9. 파인 붙여넣기 제외 기준으로 남은 수동 단계가 실제 있는지
10. 이 시스템이 "흉내만 낸 자동화"인지 여부

출력 형식은 반드시 아래 순서를 따른다.
1. Findings
2. Open questions
3. Architecture assessment
4. Operational assessment
5. Remaining manual boundaries
6. Required next fixes
7. Optional notes

Finding 형식:
- [P0/P1/P2/P3][area] 짧은 제목
- 문제 설명
- 왜 문제인지
- 근거 파일 또는 산출물
- 수정 방향

Architecture assessment는 아래 셋 중 하나로 명시해라.
- APPROVE
- HOLD
- REJECT

Operational assessment는 아래 셋 중 하나로 명시해라.
- READY
- HOLD
- REJECT

그리고 아래 항목을 마지막에 명시해라.
1. `파인 붙여넣기 제외 완전자율성`: YES / PARTIAL / NO
2. `흉내만 낸 자동화 여부`: YES / NO
3. `현재 가장 큰 blocker 3개`
```
