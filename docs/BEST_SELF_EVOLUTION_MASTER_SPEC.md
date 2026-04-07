# BEST_SELF_EVOLUTION_MASTER_SPEC

- 제정: 2026-03-29
- 업데이트: 2026-04-05
- 상태: ACTIVE
- 목적: `BEST/FEBT`를 단순 튜닝 루프가 아니라 `측정 -> 원인분해 -> 후보생성 -> 오프라인 검증 -> canary -> 자동 롤백 -> 패치 메모리`까지 닫힌 자기 진화 시스템으로 확장하기 위한 상위 SSOT
- 검수 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md`
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SERVER_CANONICAL_ENGINE_MIGRATION_PLAN.md`
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
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_CLAUDE_AUDIT_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/CLAUDE_SELF_EVOLUTION_VALIDATION_PROMPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/CLAUDE_GOOGLE_GRADE_ML_QUANT_AUDIT_PROMPT_2026-04-05.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_UIUX_CONTROL_SURFACE_PLAN.md`

## 1. 한 줄 정의

`BEST Self-Evolution`은 서버 canonical engine, downstream policy, OpenClaw 감독관이 하나의 목적함수와 하나의 변경 헌법 아래에서 스스로 측정하고, 스스로 후보를 만들고, 스스로 검증하고, 조건부로만 적용하며, 실패하면 자동으로 되돌리는 운영 체계다. Pine는 shadow compare 역할만 가진다.

## 2. 최종 목적

1. `승률 60%+`를 승인 시장군 기준으로 달성
2. `count_ratio_global >= 1.00` 유지
3. `avg_ret_net`, `expectancy`, `tp1_first_rate` 비열위 유지
4. 월간 순수익 목표 달성
5. 실패 패치를 반복하지 않는 패치 메모리 체계 확보

## 3. 닫혀야 할 루프

1. 서버 canonical engine이 정본 신호를 만든다.
2. Pine는 shadow compare와 차트 확인용 telemetry만 남긴다.
3. 서버가 실행, 드롭, reject, partial fill, fallback을 모두 기록한다.
4. 데이터 통합층이 하나의 학습 row를 만든다.
5. 감독관이 목적함수와 원인분해 결과로 현재 상태를 진단한다.
6. 튜너와 Codex가 공통 schema의 후보 변경 집합을 만든다.
7. replay/offline 검증이 후보를 점수화한다.
8. stage autopilot이 canary를 제한적으로 적용한다.
9. 목표 미달이면 rollback 한다.
10. 결과는 memory ledger에 기록되어 다음 주 후보 생성에 사용된다.

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
9. `L8 Ops Substrate`
   - `OpenClaw cron`, `ops agent`, `automation watchdog`, `OpenClaw-first Telegram transport`

## 6. 적용 대상

1. Pine
   - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.0.pine.txt`
2. 서버/실행 체인
   - `/Users/jeongjaeyong/Projects/donbeolja/src/routes/webhook.routes.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/services/canonicalEngine/canonicalDecision.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/services/canonicalEngine/thresholdResolver.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/services/pineSignalQuality.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/services/waitOneBarPolicy.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/src/services/evTp1Probability.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/storage/fillsPaper.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/storage/tradesPaper.js`
3. 자동화/감독
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-openclaw-hourly-cycle.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-openclaw-daily-cycle.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-objective-supervisor.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-stage-autopilot.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-automation-watchdog.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/backfill-canonical-engine-provenance.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-deployment-probe.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-bundle-activation.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/report-best-self-evolution-server-primary-canary.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-ml-filter-policy.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-wait-one-bar-tune.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-ev-tp1-threshold-tune.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/setup-openclaw-cron.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/scripts/disable-launchd-automations.js`
   - `/Users/jeongjaeyong/Projects/donbeolja/src/utils/alerts.js`

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
19. canonical engine parity/provenance
20. deployment probe / bundle activation
21. server-primary canary
22. bundle-based deploy unit
23. OpenClaw cron automation substrate
24. OpenClaw-first alert transport
25. OpenClaw autonomy contract
26. server-primary acceptance watch
27. objective recovery governor
28. server-primary learning epoch
29. change-result attribution
30. exploration budget / proposal / apply candidate
31. server market capital allocator / quarantine
32. policy parameter evolution plan report
33. live execution policy canary integration (report-only/active switch)
34. market regime board / rescue-mixed-keep_drop cohort tracking
35. sample-aware verification / deferred low-sample handling
36. empirical EV probability calibration
37. portfolio cluster risk live guard
38. 기관급 ML 자동 퀀트 확장 계획은 `/Users/jeongjaeyong/Projects/donbeolja/docs/GOOGLE_GRADE_ML_QUANT_PLAN_2026-04-05.md`를 기준 문서로 삼는다.
39. `ml training dataset / feature store / execution model dataset / experiment registry / execution stage latency / execution bottleneck delta`를 Phase 1 foundation artifact로 사용한다.
40. `webhook immediate probe history`를 execution bottleneck 해석의 보조 증거로 사용한다.
41. objective retrospective FX normalization (`USDT -> KRW`)
42. `4차 EV/시간가치층`은 이제 `TP1-only`가 아니라 `TP_COMPOSITE_EXIT_VALUE_V1` 기준으로 동작하며, `DROP_EV_GATE_TP1_PROB` reason code는 backward compatibility로 유지한다.

현재 migration 상태:

1. `Phase A`: `PASS`
2. `Phase B`: `PASS`
3. `Phase C`: `PASS`
4. `Phase D`: `PARTIAL`
5. `Phase E`: `PASS`
6. `Phase F`: `PASS`

현재 운영 substrate 상태:

1. `Automation Scheduler`: `PASS`
   - 개별 자동화는 제거되었고 `OpenClaw hourly/daily cycle`만 남는다.
   - watchdog는 `scheduler_mode=OPENCLAW_CRON`, `verdict=PASS`다.
2. `Telegram Delivery`: `PASS`
   - repo alert path는 `OpenClaw-first`로 동작한다.
3. `External Authority`: `PENDING`
   - applied runtime은 active지만 authority verdict는 아직 `HOLD`다.

현재 server signal 상태:

1. `runtime = READY`
2. `source_mode = SERVER_PRIMARY`
3. `scheduler = ENABLED`
4. `pine_shadow_transition = COMPLETE`
5. `parity_drift = ACTIVE`
6. `cutover = SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`

현재 autonomy governor / verification / memory 상태는 고정 문장이 아니라 아래 latest artifact를 정본으로 본다.

- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_recovery_governor_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_reasoning_journal_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_memory_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_market_regime_board_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_ev_probability_calibration_latest.json`

## 8. 운영 규칙 최신화

1. `verification`
   - `DEFERRED_LEARNING_EPOCH`와 `DEFERRED_LOW_SAMPLE`를 공식 상태로 사용한다.
   - `ev_policy_post_apply_comparable_n`는 저표본일 때 실패로 확정하지 않는다.
   - `sample formation`과 `effect verification`은 분리한다.

2. `autonomy parity`
   - `final_downstream_mismatch_control`은 절대 count 단독이 아니라 `rate + sample floor + count guardrail`로 판정한다.

3. `memory ledger`
   - 저표본 EV remediation 실패는 즉시 fingerprint block으로 확정하지 않는다.
   - `PROVISIONAL_FAIL`을 거쳐 충분한 표본 뒤에만 fail fingerprint로 승격한다.

4. `bounded live mutation`
   - live auto-mutation은 allowlist 안의 작은 파라미터 변화만 자동 반영한다.
   - allowlist 밖 키, 전략 구조 변경, 과도한 delta는 자동 반영하지 않고 승인 요청 경로로 보낸다.
   - rollback 계열은 promote보다 더 강한 자동 권한을 가진다.

5. `EV policy`
   - live global threshold는 학습 epoch 동안 직접 완화하지 않는다.
   - report-only market/cohort threshold와 empirical calibration layer로 관측/보정을 수행한다.
   - `4차 EV/시간가치층`의 실제 gate metric은 `tp1_prob lower bound`가 아니라 `exit_value_lower_bound`다.
   - 내부 composite basis는 `TP_COMPOSITE_EXIT_VALUE_V1`이며 `TP0`, `TP1`, `tp0_to_tp1_conversion`, `pre_tp1_time_stop_risk`, `expected_exit_value_r`를 함께 본다.
   - `probability/lowerBound` 필드는 legacy compatibility output으로 남고, drop reason `DROP_EV_GATE_TP1_PROB`도 하위 소비자 호환성을 위해 유지한다.
   - `DROP_EV_GATE_TP1_PROB` 완화보다 먼저 probability calibration과 실행 미세구조(`FAST_TP0`, cohort TP1, chase reject, pre-TP1 time stop)를 우선 검증한다.
   - `BINANCEFUT` TP1은 전역 고정값만 쓰지 않고 `RESCUE=2.8%`, `MIXED=3.0%`, `KEEP_DROP=base` cohort 분기를 허용한다.
   - `pre-TP1 time stop`은 `EARLY=4 bars`, `CORE=6 bars`, `TP1 progress < 50%`일 때만 작동한다.

6. `market regime`
   - OpenClaw는 global score만 보지 않고 `RESCUE / MIXED / KEEP_DROP / HOLD_SAMPLE` cohort를 함께 본다.

7. `exit microstructure`
   - `FAST_TP0`는 `절대 % + ATR 보정`을 함께 사용한다.
   - 이미 열린 포지션도 `/Users/jeongjaeyong/Projects/donbeolja/scripts/apply-open-position-cohort-backfill.js`로 `openclaw_market_regime_cohort`를 주입해 cohort TP1을 소급 적용할 수 있다.
   - `TP1 이후 trail`은 즉시 활성화하지 않고 `1봉 경과 또는 추가 MFE` 조건을 기록/학습한다.
   - `same-side cluster cap`은 count뿐 아니라 total exposure 상한도 함께 본다.
   - `external flat sync grace`는 recent FILLED entry 직후 외부 `positionAmt=0` snapshot이 들어와도 즉시 `FLAT` overwrite하지 않도록 보호한다.
   - external active sync는 `openclaw_market_regime_cohort/objective_score/drop_verdict`를 보존해 현재 포지션의 TP1 cohort 메타가 동기화 중 사라지지 않도록 한다.

8. `portfolio risk`
   - live entry policy는 단일 심볼만이 아니라 same-side correlated cluster를 본다.
   - 기본 규칙은 `3번째 same-side cluster -> reduce`, `4번째 correlated cluster -> block`이다.
   - count cap과 별도로 `same-side exposure cap`, `correlated same-side exposure cap`을 함께 본다.

9. `alert semantics`
   - Telegram/운영 알림은 `TP0`, `pre-TP1 time stop`, `cohort`, `DROP_CHASE_ENTRY_QUALITY`, `LIVE_RESCUE_ADD_*`, `LINEAGE_SLO_*`, `LIVE_POLICY_*`를 사람이 읽기 쉬운 한글 설명으로 노출한다.
   - 알림 계층은 실행 성공/실패뿐 아니라 운영 보류 이유를 OpenClaw와 사람 운영자가 같은 의미로 읽도록 유지한다.
   - 승인 필요 변경은 일반 `[변경]` 알림과 분리해 별도 `[요청]` 알림으로 보낸다.

10. `ML foundation interpretation`
   - `execution_model_dataset`의 `LEGACY_WEBHOOK_OUTCOME_ONLY`는 current runtime bottleneck이 아니라 historical webhook observation gap을 뜻할 수 있다.
   - `execution_bottleneck_delta`가 `STALE_COMPARISON`이면 같은 experiment/dataset 재생성으로 보고 trend 증거로 사용하지 않는다.
   - `dataset_version_id / feature_store_version_id / experiment_id`를 함께 읽지 않으면 ML foundation 상태를 잘못 해석할 수 있다.

## 9. 다음 고도화 범위

1. `SERVER_PRIMARY` acceptance sample 축적
2. external authority pending 해소
3. timeout authority degraded-policy 발동 검증
4. downstream parity mismatch, 특히 `EV_POLICY` 압력 완화
5. 시장별 objective score 정교화
6. policy parameter plan을 advisory에서 apply-ready로 승격

## 10. 다음 구현 우선순위

1. `Server-Primary Acceptance`
2. `External Authority Closure`
3. `Degraded Timeout Authority Validation`
4. `Downstream Policy Pressure Reduction`

## 11. 한 줄 결론

자기 진화 시스템의 핵심은 “AI가 막 바꾸는 것”이 아니라, `감독관 헌법 아래에서 측정-검증-적용-롤백-기억`이 닫힌 하나의 시스템을 만드는 것이다.
