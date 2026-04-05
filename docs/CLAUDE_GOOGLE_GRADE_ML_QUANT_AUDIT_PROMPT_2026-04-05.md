# CLAUDE_GOOGLE_GRADE_ML_QUANT_AUDIT_PROMPT_2026-04-05

아래 프롬프트를 그대로 Claude에 전달한다.

```text
이 감사의 목적은 `donbeolja`가 2026-04-05 기준 어디까지 `구글급 ML 자동 퀀트 foundation`에 도달했는지, 현재 코드와 latest artifact 기준으로 오류/모순 없이 재판정하는 것이다.

절대 규칙:
1. 코드와 latest artifact가 충돌하면 latest artifact를 먼저 읽고, 코드로 원인을 설명하라.
2. 과거 audit finding을 그대로 반복하지 마라.
3. 반드시 `현재 구현된 것`, `현재 미구현`, `현재 해석 주의점`을 분리해서 써라.
4. hard filter와 future ML layer를 혼동하지 마라.
5. `PINE_WEBHOOK`, `MANUAL_REPLAY`, `PAPER_RUNTIME`를 운영 병목과 섞지 마라.
6. `execution_bottleneck_delta = STALE_COMPARISON`이면 trend 증거로 사용하지 마라.
7. `LEGACY_WEBHOOK_OUTCOME_ONLY`를 current runtime bottleneck으로 단정하지 마라.
8. 최신 코드에 없는 모델/optimizer를 “이미 구현됨”이라고 쓰면 오답이다.
9. 최신 artifact에 있는 foundation layer를 “아직 없음”이라고 쓰면 오답이다.

먼저 이 문서를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/docs/GOOGLE_GRADE_ML_QUANT_PLAN_2026-04-05.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md
3. /Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_ARCHITECTURE.md
4. /Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md

그 다음 latest artifact를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/ml_training_dataset_latest.json
2. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/ml_feature_store_latest.json
3. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_model_readiness_latest.json
4. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/execution_model_dataset_latest.json
5. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/execution_model_entry_dataset_latest.json
6. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/execution_model_exit_dataset_latest.json
7. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_execution_quality_latest.json
8. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_execution_stage_latency_latest.json
9. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_ml_experiment_registry_latest.json
10. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_execution_bottleneck_delta_latest.json
11. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_openclaw_autonomy_contract_latest.json
12. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_reasoning_journal_latest.json
13. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.json
14. /Users/jeongjaeyong/Projects/donbeolja/ops/daily/webhook_signal_execution_probe_history_latest.json

그 다음 아래 코드를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/src/utils/mlDatasetSchema.js
2. /Users/jeongjaeyong/Projects/donbeolja/src/services/outcomeLabeler.js
3. /Users/jeongjaeyong/Projects/donbeolja/scripts/build-ml-training-dataset.js
4. /Users/jeongjaeyong/Projects/donbeolja/src/utils/mlFeatureStore.js
5. /Users/jeongjaeyong/Projects/donbeolja/scripts/build-ml-feature-store.js
6. /Users/jeongjaeyong/Projects/donbeolja/src/utils/modelReadiness.js
7. /Users/jeongjaeyong/Projects/donbeolja/src/utils/executionModelDataset.js
8. /Users/jeongjaeyong/Projects/donbeolja/scripts/build-ml-execution-dataset.js
9. /Users/jeongjaeyong/Projects/donbeolja/src/utils/executionStageLatency.js
10. /Users/jeongjaeyong/Projects/donbeolja/src/utils/mlExperimentRegistry.js
11. /Users/jeongjaeyong/Projects/donbeolja/src/utils/executionBottleneckDelta.js
12. /Users/jeongjaeyong/Projects/donbeolja/src/utils/openclawAutonomyContract.js
13. /Users/jeongjaeyong/Projects/donbeolja/src/utils/openclawReasoningJournal.js
14. /Users/jeongjaeyong/Projects/donbeolja/src/routes/webhook.routes.js
15. /Users/jeongjaeyong/Projects/donbeolja/src/scheduler/marketRunner.js
16. /Users/jeongjaeyong/Projects/donbeolja/src/engine/paperUpbitRunner.js

첫 단계에서 반드시 아래 표를 만들어라.
- artifact path
- status
- dataset_version_id
- feature_store_version_id
- experiment_id
- generated_at
- 해석 주의점

그 다음 아래를 직접 판정하라.
1. training-ready row dataset이 실제로 존재하는가
2. raw cache direct build가 실제로 연결돼 있는가
3. TP0 / TP1 / time stop / pre-TP1 time stop / MFE / MAE / tp0_to_tp1_converted가 row label로 존재하는가
4. feature store가 latest artifact와 version id를 가지는가
5. execution dataset가 전체 / entry-only / exit-only로 분리됐는가
6. execution stage latency / experiment registry / bottleneck delta가 latest artifact로 존재하는가
7. OpenClaw가 dataset version / feature store version / execution bottleneck를 읽는가
8. 실제 alpha model이 구현됐는가, 아니면 foundation만 있는가
9. 실제 execution predictor가 구현됐는가, 아니면 analysis dataset만 있는가
10. portfolio optimizer가 구현됐는가
11. model promotion pipeline이 구현됐는가
12. `LEGACY_WEBHOOK_OUTCOME_ONLY`가 무엇을 의미하는지 코드와 artifact 기준으로 설명할 수 있는가
13. `STALE_COMPARISON`을 current trend로 오해할 위험이 남아 있는가

강제 판정 규칙:
1. `Alpha model implemented`라고 쓰려면 실제 train/infer path 파일을 제시해라.
2. `Execution predictor implemented`라고 쓰려면 실제 model train/infer path 파일을 제시해라.
3. `Portfolio optimizer implemented`라고 쓰려면 effective exposure/sizing optimizer 코드를 제시해라.
4. `foundation missing`이라고 쓰려면 아래 중 하나가 실제로 없어야 한다.
   - ml_training_dataset_latest
   - ml_feature_store_latest
   - execution_model_dataset_latest
   - model_readiness_latest
   - ml_experiment_registry_latest
5. `current execution bottleneck`를 주장하려면 legacy webhook observation gap과 구분해라.
   - top cause가 `LEGACY_WEBHOOK_OUTCOME_ONLY`면 current runtime bottleneck으로 단정하지 마라.
6. `trend improved/not improved`를 주장하려면 `execution_bottleneck_delta.status != STALE_COMPARISON`이어야 한다.

최종 출력 형식:
1. Executive Summary
   - 지금 시스템이 구글급 ML 퀀트로 가는 경로에서 어디까지 왔는지 5문장 이하로 요약
2. Implemented Foundation
   - 실제 구현된 것만 bullet로
3. Missing Layers
   - 아직 없는 것만 bullet로
4. Interpretation Risks
   - latest artifact를 잘못 읽으면 생기는 모순만 bullet로
5. Findings
   - OPEN / PARTIAL / CLOSED 판정과 근거
6. Next Priority
   - 지금 가장 먼저 해야 할 다음 3개

금지:
- “대체로”, “아마”, “보인다” 같은 추측형 문장만 쓰지 마라.
- 근거 없는 praise를 쓰지 마라.
- 오래된 artifact를 current truth처럼 쓰지 마라.
```
