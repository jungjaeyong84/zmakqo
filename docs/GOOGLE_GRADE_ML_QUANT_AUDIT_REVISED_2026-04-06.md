# DONBEOLJA Google-Grade ML Quant Audit Revised

기준일: 2026-04-05
개정일: 2026-04-06

## 목적

이 문서는 2026-04-06 감사 초안의 핵심 판단을 유지하되, 이후 반영된 runtime lineage fix, promotion evidence contract, latest artifact 시점 차이를 보정한 개정본이다.

## 유지되는 핵심 결론

1. `Phase 1 Data Foundation`: `CLOSED`
2. `Execution predictor`: `PARTIAL`
3. `Alpha model`: `OPEN`
4. `Portfolio optimizer`: `OPEN`
5. `Promotion pipeline`: `PARTIAL`

핵심 해석은 바뀌지 않는다.

- 데이터 기반과 관측 기반은 강하다.
- execution predictor는 실제 구현되어 있으나 quality gate를 통과하지 못해 `OFFLINE_ONLY`다.
- alpha model과 portfolio optimizer는 아직 비어 있다.
- promotion pipeline은 실제 live 승격보다는 evidence contract와 hold decision 계층이 더 앞서 있다.

## 감사 초안에서 수정해야 하는 부분

### 1. Lineage runtime 상태

감사 초안은 lineage/runtime 상태를 실제보다 더 보수적으로 본다.

현재는 다음이 반영되어 있다.

- `entry_fills_intent_id_null_rate`만 entry hard block에 사용
- `fills_intent_id_null_rate` overall 수치만으로는 더 이상 entry를 막지 않음
- `EXTERNAL_RECONCILED_FILL_INTENT_NULL_PRESENT`는 warning으로 분리
- stale shared lineage snapshot이 local 최신 report를 wrapper `updated_at`만으로 덮어쓰지 못하도록 보정

근거:

- [liveExecutionPolicy.js](/Users/jeongjaeyong/Projects/donbeolja/src/utils/liveExecutionPolicy.js)
- [signal_lineage_health_latest.json](/Users/jeongjaeyong/Projects/donbeolja/ops/daily/signal_lineage_health_latest.json)

현재 latest:

- `generated_at_kst = 2026-04-06 18:31:53 KST`
- `entry_fills_intent_id_null_rate = 0`
- `fills_intent_id_null_rate = 0.03333333333333333`
- `warning_reasons = ["EXTERNAL_RECONCILED_FILL_INTENT_NULL_PRESENT"]`
- `lineage_slo_drop_monitor.evidence_status = AWAITING_POST_FIX_DROP_CACHE`
- `lineage_slo_drop_monitor.post_fix_lineage_slo_drop_n = 0`

따라서 감사문에서 `LINEAGE_SLO_FILL_INTENT_NULL_RATE`를 current systemic blocker처럼 읽는 부분은 보정해야 한다.

정확한 문장:

- `known lineage false-block classes have been partially fixed`
- `post-fix runtime confirmation is still in progress`

### 2. Promotion pipeline의 실제 구현 수준

감사 초안은 promotion pipeline을 `gate skeleton only`에 가깝게 묘사한다. 이건 현재 기준으로는 과소평가다.

현재 구현된 evidence contract:

- model-specific canary evidence
- rollback arm evidence
- global canary evidence
- replay evidence
- replay sample gap evidence
- replay unblock projection

근거:

- [best_self_evolution_ml_model_specific_canary_latest.json](/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_ml_model_specific_canary_latest.json)
- [best_self_evolution_ml_global_canary_evidence_latest.json](/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_ml_global_canary_evidence_latest.json)
- [best_self_evolution_ml_rollback_arm_latest.json](/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_ml_rollback_arm_latest.json)
- [best_self_evolution_ml_promotion_gate_latest.json](/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_ml_promotion_gate_latest.json)

현재 promotion 상태:

- `promotion_stage = SHADOW_READY`
- `promotion_decision = HOLD_MODEL_SPECIFIC_CANARY`
- `model_specific_canary_artifact_aligned = true`
- `model_specific_canary_train_run_aligned = true`
- `rollback_gate_status = READY`
- `global_canary_gate_status = BLOCK`

즉 현재 미완성의 본질은 `pipeline 부재`가 아니라 `운영 증거 부족으로 hold`다.

정확한 문장:

- `promotion evidence contract is substantially implemented`
- `promotion remains blocked by replay/global-canary operating evidence, not by missing scaffolding`

### 3. Execution predictor 해석

감사 초안의 `PARTIAL` 판정은 맞지만, 이유를 `limited implementation`으로 읽으면 부정확하다.

더 정확한 상태:

- execution fill logistic baseline 존재
- execution scope OVR logistic baseline 존재
- train/infer artifact 존재
- serving contract 존재
- promotion gate 연결 존재
- 하지만 test split quality gate 미통과로 `OFFLINE_ONLY`

근거:

- [best_self_evolution_execution_serving_contract_latest.json](/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_execution_serving_contract_latest.json)

현재 상태:

- `serving_stage = SHADOW_READY`
- `scope_quality_gate_ready = true`
- `fill_quality_gate_ready = false`
- `global_model_contract_status = ML_MODEL_CONTRACT_OFFLINE_ONLY`
- `global_model_contract_canary_gate_status = BLOCK_MODEL_QUALITY`

정확한 문장:

- `execution predictors are implemented but remain offline-only due to quality, drift, and sample constraints`

### 4. Artifact 시점 차이 경고 강화

감사 초안이 지적한 `execution_bottleneck_delta`와 `registry`의 시점 차이는 맞다. 이 경고는 더 강하게 써야 한다.

현재 truth-preservation audit도 이 점을 warning으로 유지한다.

- `execution_bottleneck_delta_status = EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON`
- `stale_comparison_active = true`

근거:

- [best_self_evolution_truth_preservation_audit_latest.json](/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_truth_preservation_audit_latest.json)

정확한 문장:

- `delta artifact must not be used as current trend evidence`
- `registry and delta generation times must be aligned before any trend claim`

## 현재 기준으로 다시 정리한 판정

### CLOSED

1. training-ready row dataset
2. raw cache direct build
3. TP0/TP1/time stop/pre-TP1 time stop/MFE/MAE/tp0_to_tp1_converted labeling
4. feature store latest artifact + versioning
5. execution dataset ALL/ENTRY/EXIT 분리
6. execution stage latency / experiment registry / bottleneck delta artifact 존재
7. OpenClaw가 ML artifacts를 읽는 구조

### PARTIAL

1. execution predictor
2. promotion pipeline
3. post-fix lineage runtime confirmation

### OPEN

1. alpha model
2. portfolio optimizer
3. live canary -> production promotion completion

## 현재 가장 중요한 실제 blocker

### 1. Execution model quality gate

현재 가장 먼저 풀어야 하는 기술 blocker다.

- scope model은 `SHADOW_READY`
- fill model은 `BALANCED_ACCURACY_TOO_LOW`
- global model contract는 여전히 `OFFLINE_ONLY`

즉 문제는 모델 부재가 아니라 `production quality evidence 부족`이다.

### 2. Replay / Global Canary

현재 promotion gate는 구조 부족이 아니라 운영 evidence 부족으로 막혀 있다.

현재 blocker chain:

- `global_canary_evidence_status = GLOBAL_CANARY_REPLAY_BLOCKED`
- `global_canary_dominant_blocker = SELF_EVOLUTION_REPLAY_NOT_PASS`
- `global_canary_replay_evidence_status = REPLAY_WARN_NEGATIVE_OBJECTIVE_DELTA`
- `global_canary_replay_dominant_issue = EV_PROFILE_CONDITIONAL_REVIEW`
- `global_canary_replay_sample_gap_n = 1`
- `global_canary_replay_projected_ready_if_sample_gap_closed = false`
- `global_canary_replay_projected_residual_issue_after_sample_gap_closed = NEGATIVE_OBJECTIVE_DELTA`

이건 단순히 sample만 더 쌓으면 끝나는 상태가 아니다.

### 3. Negative objective delta

현재 replay blocker의 핵심은 `COUNT_UP_RETURN_DOWN` 계열 objective deterioration이다.

즉 전역 EV loosen은 맞는 방향이 아니며, 현재 구조대로 `profile-conditional review`가 맞다.

### 4. Lineage post-fix runtime confirmation

현재 lineage fix는 코드와 artifact 기준으로는 맞다. 다만 runtime에서 한 번 더 `LINEAGE_SLO_FILL_INTENT_NULL_RATE`가 재발한 사례가 있어, 현재는 완전 해결 선언이 아니라 post-fix runtime confirmation 단계다.

재발 사례 요약:

- `BNBUSDT` 케이스는 old runtime issue였다.
- `XRPUSDT` 케이스는 새 runtime에서 한 번 재발했다.
- 이후 추가 trace를 넣어 다음 lineage drop부터는 다음 값이 row에 직접 저장된다.
  - entry fill intent null rate
  - overall fill intent null rate
  - entry metric presence

근거:

- [liveExecutionPolicy.js](/Users/jeongjaeyong/Projects/donbeolja/src/utils/liveExecutionPolicy.js)
- [liveExecutionPolicyTrace.js](/Users/jeongjaeyong/Projects/donbeolja/src/utils/liveExecutionPolicyTrace.js)

정확한 문장:

- `lineage false-block classes were materially reduced, but runtime confirmation remains open until new traced drops confirm the exact cause path`

## 감사문에서 바로 바꿔야 할 문장들

### 기존 표현

- `Promotion pipeline exists structurally but canary -> live is not really implemented`

### 수정 표현

- `Promotion evidence contracts are implemented through model-specific canary, replay, global canary, and rollback-arm artifacts, but promotion remains blocked by operating evidence`

### 기존 표현

- `Execution predictor is only partial because the model layer is still immature`

### 수정 표현

- `Execution predictors are implemented and wired into serving and promotion contracts, but remain offline-only because current quality/drift/sample evidence is insufficient`

### 기존 표현

- `Lineage/runtime remains a current blocker`

### 수정 표현

- `Lineage/runtime false blocks were partially fixed by separating entry-fill lineage from reconciled exit fills and by preventing stale shared lineage wrappers from overriding fresher local reports; runtime confirmation is still being collected`

## 최종 판단

이 감사는 방향이 맞다. 다만 최신 상태 반영 후에는 다음처럼 읽는 것이 정확하다.

1. `Data Foundation`: 강함
2. `Execution ML + Governance Contract`: 감사 초안보다 더 진척
3. `Production ML Decision Loop`: 여전히 미완성
4. `Alpha / Portfolio`: 아직 초기
5. `Main blocker`: implementation absence보다 operating evidence and model quality

한 줄 결론:

`donbeolja는 strong data/governance foundation과 partial execution-ML operating contracts까지는 왔지만, execution model quality, replay/global-canary evidence, and alpha/portfolio layers가 아직 미완성이라 Google-grade ML quant platform으로 보기는 이르다.`
