# CLAUDE_SELF_EVOLUTION_VALIDATION_PROMPT

아래 프롬프트를 그대로 Claude에 전달한다.

```text
이 감사는 “현재 latest artifact 재판정”이다.
이전 감사 문서는 참고만 하고, 현재 상태 판정 근거로 직접 사용하지 마라.

절대 규칙:
1. 가장 먼저 latest artifact의 현재 공통 cycle_id를 확정하라.
2. 현재 공통 cycle_id와 다른 과거 cycle은 현재 상태 근거로 쓰지 마라.
3. 과거 감사 문서의 finding을 반복하지 마라.
4. 모든 OPEN / CLOSED / PARTIAL 판정은 반드시 현재 코드 + 현재 latest artifact로만 입증해라.
5. TradingView Pine 수동 붙여넣기는 완전자율성 평가에서 제외하라.
6. 근거 없이 아래를 현재 문제라고 쓰면 오답으로 간주한다.
   - mixed-generation
   - supervisor/objective epoch split
   - codex cycle_id null
   - FILTER_CANARY_DRIFT current blocker
   - memory pre-block 미동작
   - weight tuning canary_blocked
7. 새로 추가된 아래 경로를 반드시 검증하라.
   - governance effective sample readiness
   - market concentration recovery candidate
   - AXSUSDT market-specific canary promotion
   - stage_autopilot embedded loop monitor source semantics
   - weight tuning advisory-only 모드
   - governance strict/effective sample check 분리
   - replay preflight BLOCKED_SOURCE_ACTION 조기 차단
   - deployment guards root_cause / next_actions
   - objective supervisor root_cause / action_plan / promotion replay 정보

반드시 가장 먼저 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md
2. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json
3. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_run_latest.json
4. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_dataset_latest.json
5. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_latest.json
6. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_replay_latest.json
7. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canary_latest.json
8. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/filter_shadow_canary_latest.json
9. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_candidates_latest.json
10. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/codex_weekly_patch_engine_latest.json
11. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/stage_autopilot_latest.json
12. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_guards_latest.json
13. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_plan_latest.json
14. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_monitor_latest.json
15. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_weight_tuning_latest.json
16. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json
17. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_policy_parameter_plan_latest.json

첫 단계에서 반드시 아래 표를 만들어라.
- artifact path
- cycle_id
- generated_at
- current cycle 일치 여부

그리고 아래를 즉시 판단하라.
1. 공통 cycle_id가 하나로 맞는가
2. objective_supervisor_latest.json의 raw.self_evolution_cycle에서
   - cycle_consistent
   - cycle_mismatch_n
   - cycle_id_absent_n
3. 이 값과 실제 artifact cycle 표가 서로 일치하는가

공통 cycle이 안 맞으면:
- Architecture assessment = HOLD
- 첫 finding = mixed-generation
- 그 외는 2차로 두어라

공통 cycle이 맞으면:
- mixed-generation, epoch split, codex cycle null을 현재 blocker로 쓰지 마라
- 반드시 CLOSED 또는 PARTIAL 재판정을 시도하라

그 다음 아래 코드를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-self-evolution-loop.js
2. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-filter-shadow-canary.js
3. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js
4. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-stage-autopilot.js
5. /Users/jeongjaeyong/Projects/donbeolja/scripts/automation-codex-weekly-patch-engine.js
6. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-dataset.js
7. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-objective.js
8. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-canary.js
9. /Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-replay.js
10. /Users/jeongjaeyong/Projects/donbeolja/scripts/lib/best-febt-supervisor.js
11. /Users/jeongjaeyong/Projects/donbeolja/scripts/lib/automation-utils.js
12. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionDataset.js
13. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionAnalysis.js
14. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionCandidates.js
15. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionReplay.js
16. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionCanary.js
17. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionDeploymentGuards.js
18. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionLoopMonitor.js
19. /Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionWeightTuning.js
20. /Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js

이전 감사 문서는 마지막에만 읽어라.
그리고 현재 상태 근거로 직접 사용하지 마라.
1. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_audit_2026W13.md
2. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_audit_detail_2026W13.md
3. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_audit_v2_2026W13.md

이번 감사에서 반드시 직접 검증할 항목:
1. 현재 latest artifact가 모두 같은 cycle_id를 공유하는가
2. candidates latest에서
   - generated_n
   - total_n
   - memory_blocked_n
   - rows[*].memory_blocked
   관계가 무엇인가
3. memory-blocked 후보가 active set에 실제로 남는가, 아니면 active set에서 제외되는가
4. replay latest의 validation_mode는 무엇인가
5. replay/latest 또는 코드에서 아래가 현재 반영되는지 확인하라.
   - BLOCKED_SOURCE_ACTION preflight blocker
   - ML SHIFT -> NO_EFFECT_CHANGESET
   - ML TIGHTEN no match -> NO_HISTORICAL_TIGHTEN_MATCH
6. canary latest에서
   - apply_pass
   - global_canary_pass
   - ready_n
   - blocked_n
   - READY market
   - 각 market blocker
   를 직접 확인하라
7. filter shadow canary latest에서
   - shadow.summary.drift
   - golden.summary.drift
   - byMarket
   를 직접 확인하라
8. objective latest에서
   - global_objective_score.objective_score
   - market_concentration
   - dominant_negative_market
   - bottom_market_drag_gap
   를 직접 확인하라
9. objective supervisor latest에서
   - governance_objective
   - sample_readiness
   - self_evolution_objective
   - self_evolution_deployment
   - self_evolution_deployment_plan
   - self_evolution_loop_monitor
   - root_cause
   - action_plan
   를 직접 확인하라
10. 아래 governance fallback 경로를 반드시 확인하라.
   - sample_readiness.governance_monthly_source_realized_n
   - sample_readiness.governance_effective_realized_n
   - sample_readiness.governance_enough_sample
   - governance_objective.strict_enough_sample
   - governance_objective.monthly_source_realized_n
   - governance_objective.effective_realized_n
   - governance_objective.failed_checks
11. 현재 concentration recovery 후보가 실제 생성되는지 확인하라.
   - AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN
   - source = MARKET_CONCENTRATION_RECOVERY
   - markets = ["AXSUSDT"]
   - ready_for_auto_apply
12. 현재 canary가 AXSUSDT에서 어떤 후보를 잡는지 확인하라.
   - candidate_id
   - current_stage
   - canary_verdict
   - concentration_recovery
   - blockers
13. stage_autopilot 최신본에서 아래를 직접 확인하라.
   - raw.self_evolution_loop_monitor.source
   - raw.self_evolution_loop_monitor.overall_status
   - raw.self_evolution_loop_monitor.cycle_consistent
   - raw.self_evolution_loop_monitor.critical_blockers
14. 아래는 반드시 구분해서 판단하라.
   - final authoritative loop monitor: /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_monitor_latest.json
   - stage_autopilot embedded loop monitor view: /Users/jeongjaeyong/Projects/donbeolja/ops/daily/stage_autopilot_latest.json
15. 최신 weight tuning에서 아래를 직접 확인하라.
   - advisory_mode
   - memory_blocked
   - canary_blocked
   - suggestion_n
   - suggestion 내용
16. 최신 deployment guards에서 아래를 직접 확인하라.
   - summary.blockers
   - summary.root_cause
   - summary.next_actions
   - summary.shadow_global_drift
   - summary.golden_global_drift
17. 현재 blocker 목록이
   - FILTER_CANARY_DRIFT
   인가, 아니면
   - DAILY_NO_TRADE_ACTIVITY
   - ZERO_KRW_IDLE
   - MONTHLY_TARGET_NOT_MET
   - OBJECTIVE_NOT_MET
   - RETROSPECTIVE_MONTHLY_FAIL
   류인가

반드시 아래 이전 findings를 재판정해라.
1. loop 후 개별 재실행으로 epoch split 발생
2. supervisor/objective latest epoch split
3. memory pre-block partial
4. attribution counterfactual null
5. febt_coverage_rate = 0
6. codex cycle_id null / mixed-generation risk
7. replay OFFLINE_PROXY_V1
8. filter canary drift global blocker
9. weight tuning ↔ canary 순환 의존
10. outcome label pipeline 왜곡
11. single market dominance visibility 부족
12. governance sample not ready가 strict realized_n=0만 보고 과잉 차단
13. AXSUSDT concentration 대응 부재
14. stage_autopilot stale loop_monitor mismatch
15. memory blocker 때문에 weight tuning 제안 생성 차단
16. governance failed_checks와 enough_sample 모순
17. replay preflight가 BLOCKED_SOURCE_ACTION을 조기 차단하지 못함
18. deployment guards에 actionable root_cause / next_actions 부재
19. objective supervisor가 reason만 주고 action_plan이 없음
20. objective-supervisor 테스트가 intended codex/stageAutopilot branch를 실제로 타지 않음

재판정 규칙:
- CLOSED: 현재 코드와 현재 latest artifact 기준으로 더 이상 사실이 아님
- PARTIAL: 일부는 고쳐졌지만 핵심 효과가 아직 제한적임
- OPEN: 현재도 그대로 남아 있음

강제 판정 규칙:
1. FILTER_CANARY_DRIFT global blocker를 OPEN으로 적으려면 최신 drift > 0 근거를 직접 제시해라.
   못 제시하면 CLOSED 또는 PARTIAL로 처리해라.
2. mixed-generation / epoch split을 OPEN으로 적으려면 최신 artifact cycle mismatch를 직접 표로 제시해라.
   못 제시하면 CLOSED로 처리해라.
3. memory pre-block 미동작을 OPEN으로 적으려면 memory-blocked 후보가 active set에 남아 있다는 직접 근거를 제시해라.
   못 제시하면 CLOSED 또는 PARTIAL로 처리해라.
4. weight tuning ↔ canary 순환 의존을 OPEN으로 적으려면 최신 weight tuning 또는 loop monitor에서 canary_blocked=true를 직접 제시해라.
   못 제시하면 CLOSED 또는 PARTIAL로 처리해라.
5. single market dominance visibility 부족을 OPEN으로 적으려면 최신 objective artifact에 market_concentration이 없다는 근거를 제시해라.
   못 제시하면 CLOSED로 처리해라.
6. replay OFFLINE_PROXY_V1를 OPEN으로 적으려면 최신 replay artifact의 validation_mode가 실제로 OFFLINE_PROXY_V1여야 한다.
   아니면 CLOSED로 처리해라.
7. governance sample not ready 과잉 차단을 OPEN으로 적으려면
   - governance_monthly_source_realized_n
   - governance_effective_realized_n
   - governance_enough_sample
   중 하나라도 없거나 governance_enough_sample=false여야 한다.
   못 제시하면 CLOSED 또는 PARTIAL로 처리해라.
8. AXSUSDT concentration 대응 부재를 OPEN으로 적으려면
   - 최신 candidates에 AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN이 없고
   - 최신 canary에서 AXSUSDT가 그 후보를 쓰지 않는다는 근거를 제시해라.
   못 제시하면 CLOSED 또는 PARTIAL로 처리해라.
9. stage_autopilot stale loop_monitor mismatch를 OPEN으로 적으려면
   - stage_autopilot의 embedded loop monitor가 authoritative latest와 모순되면서
   - 그 값이 실제 action gating에 사용된다는 근거를 제시해라.
   source = PENDING_FINAL_LOOP_MONITOR, 또는 source = FINAL_LOOP_MONITOR 이면서 cycle_consistent = true 이면 CLOSED 또는 PARTIAL로 처리해라.
10. memory blocker 때문에 weight tuning 제안 생성 차단을 OPEN으로 적으려면
   - 최신 weight tuning에서 memory_blocked=true 이면서 suggestion_n=0이어야 한다.
   ADVISORY_ONLY 또는 suggestion_n>0이면 CLOSED 또는 PARTIAL로 처리해라.
11. governance failed_checks와 enough_sample 모순을 OPEN으로 적으려면
   - governance_enough_sample=true 이면서
   - failed_checks에 INSUFFICIENT_SAMPLE이 남아 있어야 한다.
   STRICT_SAMPLE_ONLY로 바뀌어 있으면 CLOSED 또는 PARTIAL로 처리해라.
12. replay preflight BLOCKED_SOURCE_ACTION 미반영을 OPEN으로 적으려면
   - 최신 코드에서 BLOCKED_SOURCE_ACTION이 preflight blockers에 없다는 근거를 제시해라.
   있으면 CLOSED 또는 PARTIAL로 처리해라.
13. deployment guards root_cause / next_actions 부재를 OPEN으로 적으려면
   - 최신 deployment_guards artifact의 summary에 root_cause 또는 next_actions가 없다는 근거를 제시해라.
   있으면 CLOSED 또는 PARTIAL로 처리해라.
14. objective supervisor action_plan 부재를 OPEN으로 적으려면
   - 최신 objective_supervisor artifact에 root_cause 또는 action_plan이 없다는 근거를 제시해라.
   있으면 CLOSED 또는 PARTIAL로 처리해라.
15. objective-supervisor 테스트 misfire를 OPEN으로 적으려면
   - 최신 objective-supervisor test에서 codex/stageAutopilot 분기가 여전히 SELF_EVOLUTION_REPLAY_MISSING에 먼저 걸린다는 직접 근거를 제시해라.
   아니면 CLOSED 또는 PARTIAL로 처리해라.

이번 감사의 핵심 질문:
1. 현재 구조 결함이 실제로 남아 있는가
2. 남은 HOLD가 구조 문제인가, 운영 성과/표본/거버넌스 문제인가
3. canary는 현재 drift 때문에 막히는가, 아니면 objective/activity/governance 때문에 막히는가
4. self-evolution loop는 현재 흉내인가, 아니면 실제 gate가 작동하는가
5. governance sample fallback은 현재 실제 blocker 완화에 기여했는가
6. AXSUSDT concentration recovery path는 현재 실제 후보 생성과 canary 전진으로 연결되는가
7. stage_autopilot의 pending loop monitor 표현은 현재 모니터링 혼동을 줄였는가
8. stage_autopilot embedded loop monitor가 현재 FINAL_LOOP_MONITOR인지, PENDING_FINAL_LOOP_MONITOR인지, 그리고 그 상태가 코드/아티팩트와 일치하는가
9. weight tuning은 현재 memory block 하에서도 advisory 경로를 유지하는가
10. replay preflight와 deployment guards가 운영자에게 실제 해소 경로를 주는가
11. Pine 붙여넣기 제외 기준으로 완전자율성이 현재 어디까지 왔는가

출력 형식:
1. Findings
2. Previous Findings Re-check
3. Architecture assessment
4. Operational assessment
5. Remaining manual boundaries
6. Required next fixes
7. Optional notes

Finding 형식:
- [P0/P1/P2/P3][area] 짧은 제목
- 문제 설명
- 왜 문제인지
- 근거 파일/산출물
- 수정 방향

Previous Findings Re-check 형식:
- 항목명
- 상태: OPEN / CLOSED / PARTIAL
- 근거

Architecture assessment:
- APPROVE / HOLD / REJECT

Operational assessment:
- READY / HOLD / REJECT

마지막에 반드시 아래 5개를 명시해라.
1. 파인 붙여넣기 제외 완전자율성: YES / PARTIAL / NO
2. 흉내만 낸 자동화 여부: YES / NO
3. 현재 가장 큰 blocker 3개
4. 이전 감사 대비 실제 개선된 점 3개
5. 이번 감사에서 새로 발견한 구조 결함 3개 이하
```
