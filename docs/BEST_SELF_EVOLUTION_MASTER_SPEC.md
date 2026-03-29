# BEST_SELF_EVOLUTION_MASTER_SPEC

- 제정: 2026-03-29
- 상태: ACTIVE
- 목적: `BEST/FEBT`를 단순 튜닝 루프가 아니라 `측정 -> 원인분해 -> 후보생성 -> 오프라인 검증 -> canary -> 자동 롤백 -> 패치 메모리`까지 닫힌 자기 진화 시스템으로 확장하기 위한 상위 SSOT
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_MASTER_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_SYSTEM_ROLLOUT_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_WEEKLY_TUNING_POLICY.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DATASET_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_OBJECTIVE_SCORE_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_ATTRIBUTION_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_CANDIDATE_CHANGESET_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_CANARY_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DEPLOYMENT_GUARDS_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DEPLOYMENT_AUTOPILOT_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_LOOP_MONITOR_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_WEIGHT_TUNING_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MEMORY_LEDGER_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_WORK_BREAKDOWN.md`

## 1. 한 줄 정의

`BEST Self-Evolution`은 Pine, 서버, 필터, 자동화, 감독관이 하나의 목적함수와 하나의 변경 헌법 아래에서 스스로 측정하고, 스스로 후보를 만들고, 스스로 검증하고, 조건부로만 적용하며, 실패하면 자동으로 되돌리는 운영 체계다.

## 2. 최종 목적

1. `승률 60%+`를 승인 시장군 기준으로 달성
2. `count_ratio_global >= 1.00` 유지
3. `avg_ret_net`, `expectancy`, `tp1_first_rate` 비열위 유지
4. 월간 순수익 목표 달성
5. 실패 패치를 반복하지 않는 패치 메모리 체계 확보

## 3. 닫혀야 할 루프

1. Pine가 신호와 timing telemetry를 보낸다.
2. 서버가 실행, 드롭, reject, partial fill, fallback을 모두 기록한다.
3. 데이터 통합층이 하나의 학습 row를 만든다.
4. 감독관이 목적함수와 원인분해 결과로 현재 상태를 진단한다.
5. 튜너와 Codex가 공통 schema의 후보 변경 집합을 만든다.
6. replay/offline 검증이 후보를 점수화한다.
7. stage autopilot이 canary를 제한적으로 적용한다.
8. 목표 미달이면 rollback 한다.
9. 결과는 memory ledger에 기록되어 다음 주 후보 생성에 사용된다.

## 4. 상위 원칙

1. `No Blind Autonomy`
   - 자동화는 측정 없이 변경하면 안 된다.
2. `One Objective Constitution`
   - 모든 튜너는 감독관의 공통 목적함수와 헌법을 따른다.
3. `Replace Before Remove`
   - count를 줄이는 tightening보다 replacement 회복이 우선이다.
4. `Evidence Before Promotion`
   - shadow, replay, canary를 통과하지 못하면 live 승격 금지
5. `Rollback Is First-Class`
   - 자동 승격과 동일한 수준으로 자동 롤백이 정의되어야 한다.
6. `Memory Over Repetition`
   - 실패한 패치를 잊지 않고 다음 후보 생성에 반영한다.

## 5. 시스템 레이어

1. `L0 Dataset`
   - 실행/드롭/누락/가드 차단/체결 결과를 하나의 row로 통합
2. `L1 Objective`
   - 전역/시장별 목적함수 계산
3. `L2 Attribution`
   - 손실/미스/late/void/fallback 원인 분해
4. `L3 Candidate`
   - Pine/WAIT/EV/ML/AI 변경 후보 생성
5. `L4 Replay`
   - 후보별 offline/counterfactual 검증
6. `L5 Canary`
   - 시장별/시간대별 제한 적용
7. `L6 Memory`
   - 패치 결과 ledger와 재시도 금지 규칙
8. `L7 Constitution`
   - 감독관 계약, count floor, drawdown, latency, rollback 헌법

## 6. 적용 대상

1. Pine
   - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.0.pine.txt`
2. 서버/실행 체인
   - `/Users/jeongjaeyong/Projects/donbeolja/src/routes/webhook.routes.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/services/pineSignalQuality.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/services/waitOneBarPolicy.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/services/evTp1Probability.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/storage/fillsPaper.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/storage/tradesPaper.js`
3. 자동화/감독
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-weekly-filter-governance.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-stage-autopilot.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-codex-weekly-patch-engine.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-ml-filter-policy.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-wait-one-bar-tune.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-ev-tp1-threshold-tune.js`

## 7. 지금 구현된 범위

1. `Phase 0~3` BEST/FEBT 계측/감독/리포트
2. fills/trades까지 `features_json` 전파
3. 감독관 공통 계약과 시장별 계약
4. ML/WAIT/EV/Codex/Autopilot/Audit가 감독관 계약을 읽는 구조
5. P0 dataset
6. P1 objective score
7. P2 attribution
8. P3 candidate change set
9. P4 replay validation
10. P5 market canary
11. P6 auto rollback
12. P7 memory ledger
13. canary scale
14. deployment guards
15. memory-aware pre-block
16. weight tuning advisory
17. deployment handoff plan
18. Codex loop monitor

## 8. 다음 고도화 범위

1. Pine manual paste handoff 고도화
2. 시장별 objective score 정교화
3. memory 기반 candidate pre-block 자동화 강화
4. weight tuning auto-apply 금지 해제 여부 검증

## 9. 다음 구현 우선순위

1. `Deployment Autopilot Hardening`
2. `Memory-aware Candidate Blocking`
3. `Weight Tuning Auto-Apply Review`

## 10. 한 줄 결론

자기 진화 시스템의 핵심은 “AI가 막 바꾸는 것”이 아니라, `감독관 헌법 아래에서 측정-검증-적용-롤백-기억`이 닫힌 하나의 시스템을 만드는 것이다.
