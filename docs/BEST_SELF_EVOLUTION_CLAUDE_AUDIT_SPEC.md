# BEST_SELF_EVOLUTION_CLAUDE_AUDIT_SPEC

- 제정: 2026-03-29
- 상태: ACTIVE
- 목적: Claude가 `BEST/FEBT -> self-evolution` 루프를 `문서 + 코드 + 최신 산출물` 기준으로 품질 감사할 수 있게 현재 구현 경계, 수동 경계, 핵심 불변식, 감사 체크리스트를 한 문서로 고정한다.
- 상위 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_MASTER_SPEC.md`

## 1. 감사 대상의 한 줄 정의

`BEST Self-Evolution`은 Pine 수동 붙여넣기 경계를 제외하고, `측정 -> 목적함수 -> 원인분해 -> 후보 생성 -> replay -> canary -> auto rollback -> memory ledger -> deployment handoff -> loop monitor`를 Codex 감독 아래 한 사이클로 돌리는 자동 진화 루프다.

## 2. 무엇이 자동이고 무엇이 수동인가

### 자동 범위

1. Pine/서버/드롭/체결 데이터 통합
2. objective score 계산
3. attribution 계산
4. candidate change set 생성
5. replay/offline validation
6. market canary 판정
7. auto rollback 판정
8. memory ledger 기록과 실패 fingerprint 재시도 차단
9. deployment guards / deployment handoff plan 계산
10. objective supervisor의 Codex authority 판정
11. stage autopilot의 promotion 차단/허용 판단
12. loop monitor의 cycle health 검증
13. 상위 orchestrator가 위 단계를 한 cycle로 순차 실행

### 수동 범위

1. TradingView Pine 편집기에 최종 Pine 코드 붙여넣기
2. TradingView alert 인스턴스 자체 갱신
3. 사람이 최종적으로 TradingView 차트/UI에서 반영 여부를 확인하는 마지막 행위

## 3. 이 감사가 반드시 구분해야 할 것

1. `구조 완성도`
   - 루프가 아키텍처적으로 닫혀 있는가
2. `운영 준비도`
   - 현재 최신 산출물 기준으로 즉시 promotion 가능한가
3. `수동 경계`
   - 수동 Pine paste를 제외해도 나머지가 실제 자동으로 이어지는가
4. `가짜 자동화 여부`
   - 문서/리포트만 있고 실제 제어에 쓰이지 않는 부분이 있는가

이 문서의 목적은 2번과 4번을 특히 엄격하게 분리해서 검증하게 하는 것이다.

## 4. 현재 구현된 핵심 체인

### 상위 orchestrator

1. `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-self-evolution-loop.js`
2. 역할:
   - self-evolution 단계를 하나의 `cycle_id` 아래 순서대로 실행
   - 중간 supervisor seed/integrated/final run을 포함해 전체 cycle을 묶음
   - latest run artifact 생성

### cycle / generation 일관성

1. `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/automation-utils.js`
2. 역할:
   - 모든 self-evolution 산출물에 `cycle_id`, `generation_id` 부여
3. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionLoopMonitor.js`
4. 역할:
   - 산출물 freshness뿐 아니라 `같은 cycle인지`까지 검증
   - cycle mismatch면 `BLOCKED`

### 감독관 SSOT

1. `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js`
2. 역할:
   - 전체 루프의 Codex authority SSOT
   - `self_evolution_dataset`
   - `self_evolution_objective`
   - `self_evolution_attribution`
   - `self_evolution_candidates`
   - `self_evolution_replay`
   - `self_evolution_canary`
   - `self_evolution_memory`
   - `self_evolution_deployment`
   - `self_evolution_deployment_plan`
   - `self_evolution_loop_monitor`
   를 한 report/raw 안에 통합

### 마지막 적용 판단

1. `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-stage-autopilot.js`
2. `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/stage-autopilot.js`
3. 역할:
   - supervisor contract + loop monitor + deployment plan을 읽고
   - promotion / hold / rollback-only 판단

## 5. Claude가 읽어야 할 코드 우선순위

### 1순위: 상위 제어면

1. `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-self-evolution-loop.js`
2. `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js`
3. `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-stage-autopilot.js`
4. `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/best-febt-supervisor.js`
5. `/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/automation-utils.js`

### 2순위: 단계별 엔진

1. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionDataset.js`
2. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionAnalysis.js`
3. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionCandidates.js`
4. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionReplay.js`
5. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionCanary.js`
6. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionMemoryLedger.js`
7. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionDeploymentGuards.js`
8. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionDeploymentPlan.js`
9. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionLoopMonitor.js`
10. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/bestSelfEvolutionWeightTuning.js`

### 3순위: 리포트 생성기

1. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-dataset.js`
2. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-objective.js`
3. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-attribution.js`
4. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-candidates.js`
5. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-replay.js`
6. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-canary.js`
7. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-memory-ledger.js`
8. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-deployment-guards.js`
9. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-deployment-plan.js`
10. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-loop-monitor.js`
11. `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-weight-tuning.js`

## 6. Claude가 읽어야 할 최신 산출물

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_run_latest.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_supervisor_latest.json`
3. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_dataset_latest.json`
4. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_latest.json`
5. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_attribution_latest.json`
6. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_candidates_latest.json`
7. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_replay_latest.json`
8. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canary_latest.json`
9. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_memory_latest.json`
10. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_guards_latest.json`
11. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_plan_latest.json`
12. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_monitor_latest.json`
13. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_weight_tuning_latest.json`

## 7. 현재 불변식

1. supervisor는 Codex authority의 SSOT carrier여야 한다.
2. loop monitor는 freshness뿐 아니라 cycle consistency를 강제해야 한다.
3. deployment plan은 replay, canary, memory, deployment guards, loop monitor와 모순되면 안 된다.
4. stage autopilot은 supervisor contract와 loop monitor blocker를 무시하면 안 된다.
5. memory ledger가 실패 fingerprint를 기억하면 candidate generator는 동일 fingerprint를 다시 열지 말아야 한다.
6. count preservation, replacement recovery, latency, drawdown guard는 self-evolution보다 상위 헌법이다.
7. manual Pine paste는 마지막 수동 경계이지만, 그 직전까지의 handoff 판단은 모두 자동이어야 한다.

## 8. Claude가 반드시 검사해야 할 질문

1. `automation-self-evolution-loop.js`가 실제로 전체 체인을 빠짐없이 순서대로 실행하는가
2. 모든 self-evolution latest 산출물이 같은 `cycle_id`를 공유하도록 강제되는가
3. loop monitor의 결과가 objective supervisor raw/report 안에 실제로 편입되는가
4. stage autopilot이 supervisor와 loop monitor의 blocker를 실제 적용 차단에 사용하는가
5. deployment plan이 단순 보고서가 아니라 실제 promotion 판단에 쓰이는가
6. memory ledger 기반 pre-block가 candidate 생성 단계에서 실제 동작하는가
7. 현재 구조가 `문서/리포트만 많은 가짜 자동화`인지, 아니면 실제 decision gate를 움직이는지
8. Pine 붙여넣기를 제외하면, 남은 수동 단계가 실제로 존재하는지
9. mixed-generation artifact를 정상으로 오판할 경로가 남아 있는지
10. latest artifacts 기준으로 현재 루프가 `READY`인지 `HOLD`인지, 그 이유가 구조적 결함인지 성과 미달인지

## 9. Claude가 특히 구분해야 하는 실패 유형

1. `구조 실패`
   - 단계 누락
   - SSOT 누락
   - cycle mismatch 허용
   - sidecar 결과가 decision gate에 안 연결됨
2. `운영 실패`
   - canary fail
   - replay fail
   - objective fail
   - latency/count/replacement floor fail
3. `수동 경계 실패`
   - 자동이어야 할 부분이 아직 사람 판단/수동 실행에 의존함
4. `가짜 자동화`
   - 최신 리포트는 생성되지만 실제 autopilot/promote/rollback gate에는 안 쓰임

## 10. 현재 기대되는 정답 형태

Claude는 아래를 분리해서 판단해야 한다.

1. `아키텍처 완성도`
   - APPROVE / HOLD / REJECT
2. `운영 승격 가능성`
   - APPROVE / HOLD / REJECT
3. `파인 붙여넣기 제외 기준 완전자율성`
   - YES / PARTIAL / NO

현재 시스템은 구조적으로는 `파인 붙여넣기 제외` 기준 완전자율에 매우 가깝지만, 운영 승격 가능성은 latest metrics에 따라 `HOLD`일 수 있다. Claude는 이 둘을 섞지 말아야 한다.

## 11. 한 줄 결론

이 감사의 목적은 `자기 진화 시스템이 정말 닫혔는지`와 `지금 당장 승격할 수 있는지`를 분리해서 검증하게 만드는 것이다.
