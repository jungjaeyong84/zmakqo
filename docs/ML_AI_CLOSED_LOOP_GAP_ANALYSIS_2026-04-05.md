"# ML+AI Closed-Loop Gap Analysis"

Status: `ACTIVE_GAP_MAP`
Updated: `2026-04-05`
Reference: [ML_AI_CLOSED_LOOP_OPERATING_SYSTEM_CHARTER_2026-04-05.md](/Users/jeongjaeyong/Projects/donbeolja/docs/ML_AI_CLOSED_LOOP_OPERATING_SYSTEM_CHARTER_2026-04-05.md)

## 1. Purpose

이 문서는 donbeolja의 현재 구현 상태와 최종 목표 상태 사이의 gap을 `loop 중심`으로 정리한다.

판단 기준은 다음 3개다.

1. 현재 artifact와 코드가 실제로 존재하는가
2. 운영 해석이 versioned truth 위에 서 있는가
3. loop가 실제로 닫혔는가

## 2. Headline Assessment

현재 상태를 한 줄로 요약하면:

- `well-instrumented rule-based quant system with strong ML foundations`

최종 목표를 한 줄로 요약하면:

- `데이터, 실행, 리스크, 승격이 스스로 닫히고 AI가 그 폐루프를 감독하는 ML+AI 운영체계`

냉정한 현재 위치:

1. `Data Truth Loop`: 강함
2. `Execution Learning Loop`: 중간
3. `Alpha Learning Loop`: 초기
4. `Portfolio Risk Loop`: 초기
5. `Promotion Loop`: 초기
6. `AI Governance Loop`: 중간

## 3. Gap Table

| Loop | Current State | Target State | Gap | Priority | Exit Criteria |
|---|---|---|---|---|---|
| Data Truth Loop | `ml_training_dataset`, `feature_store`, `execution_model_dataset`, `version_id`, `experiment_registry` 존재 | signal->intent->fill->exit->pnl->microstructure가 lossless lineage로 닫힘 | 일부 legacy/stale/noise 해석은 분리됐지만 아직 lineage backfill과 coverage 고도화 여지 있음 | P0 | lineage null rate bounded, dataset/version interpretation stable |
| Execution Learning Loop | offline `fill/scope` baseline, mismatch diagnostics, tier/raw diff, OpenClaw 연결 | serving-ready execution models, canary eligibility, runtime score contract | 모델은 offline-only, serving 없음, 일부 feature는 진단 전용에 머무름 | P1 | offline metrics stable, inference contract stable, canary-ready gate |
| Alpha Learning Loop | outcome labels, TP0/TP1/MFE/MAE foundation 존재 | calibrated alpha probabilities (`p_tp1`, `p_fail_pre_tp1`, `p_tp0_to_tp1`) | 실제 alpha train/infer path 부재 | P4 | versioned train-run + calibration + replay validation |
| Portfolio Risk Loop | hard guard, cluster/capital rules, 일부 quality penalty 존재 | book-level optimizer, dynamic sizing, admission scoring | optimizer 없음, correlation-aware allocation 없음 | P3 | allocation policy becomes model-driven and book-aware |
| Promotion Loop | registry, train-run metadata, model contract 골격 존재 | replay->shadow->canary->promote->rollback가 artifact contract로 닫힘 | ML artifact promotion contract 미완성 | P2 | model artifact id + canary metrics + rollback thresholds fixed |
| AI Governance Loop | OpenClaw가 execution/model/delta/status 읽음 | AI가 evidence orchestrator로 승격/보류/롤백 제안 | 아직 recommendation/gating evidence depth 부족 | P2/P5 | stale/noise/real delta 구분 + promotion evidence summaries stable |

## 4. Layer-by-Layer Gap

### 4.1 Data Layer

현재 강점:

1. training dataset 존재
2. feature store 존재
3. execution dataset 전체/entry/exit 분리
4. dataset/feature/experiment versioning 존재
5. execution microstructure artifact 존재

남은 gap:

1. lineage recovery/backfill 자동화 고도화
2. dataset coverage 증가
3. experiment-to-dataset reproducibility 더 엄격화
4. legacy observation gap 장기 누적 해소

판정:

- `Strong`

### 4.2 Execution Layer

현재 강점:

1. offline scope/fill baseline 존재
2. quality gate 존재
3. raw diff / tier diagnostics / false-positive diagnostics 존재
4. OpenClaw와 reasoning journal 연결 존재

남은 gap:

1. serving 없음
2. runtime score consumption contract 없음
3. canary gating 없음
4. threshold calibration이 artifact contract로 고정되지 않음

판정:

- `Mid`

### 4.3 Alpha Layer

현재 강점:

1. label foundation 존재
2. model readiness artifact 존재
3. retrospective microstructure truth 존재

남은 gap:

1. train/infer 코드 없음
2. calibration 없음
3. canary 없음
4. promotion contract 없음

판정:

- `Early`

### 4.4 Portfolio Layer

현재 강점:

1. hard guards 존재
2. cluster/reduce/block 계열 rule 존재
3. 일부 execution-quality penalty 연결 존재

남은 gap:

1. portfolio optimizer 없음
2. exposure/correlation allocator 없음
3. book-level objective optimizer 없음
4. dynamic sizing engine 없음

판정:

- `Early`

### 4.5 Promotion / Governance Layer

현재 강점:

1. train-run artifact 존재
2. model contract 골격 존재
3. OpenClaw summary/current snapshot 연결 존재
4. stale comparison 방어 존재

남은 gap:

1. replay/shadow/canary 결과가 ML artifact 승격 계약으로 안 닫힘
2. rollback threshold가 model-specific하게 고정되지 않음
3. promotion evidence ledger 미완성

판정:

- `Early-Mid`

## 5. What Is Already Good Enough

아래는 당장 다시 설계할 필요가 없다.

1. execution dataset versioning
2. experiment registry skeleton
3. stale comparison interpretation guard
4. legacy webhook observation gap separation
5. scope baseline mismatch diagnostics chain

이 영역은 “없다”가 아니라 “다음 loop로 연결이 덜 됐다”가 정확하다.

## 6. What Is Still Missing

지금 truly missing인 것은 아래다.

1. production alpha model
2. production execution predictor serving
3. portfolio optimizer
4. model promotion pipeline
5. online calibration/drift loop

즉 현재 가장 큰 gap은 `더 좋은 feature 몇 개`가 아니라

- `serving`
- `promotion`
- `portfolio`
- `calibration`

이다.

## 7. Evidence-Based Priority Order

### P0. Data Truth Preservation

해야 할 것:

1. lineage null/legacy backfill 안정화
2. stale/noise separation 유지
3. artifact version interpretation 고정

이걸 먼저 하는 이유:

- 모든 loop의 기반이기 때문

### P1. Execution Productionization

해야 할 것:

1. execution scope/fill inference contract 고정
2. offline model serving adapter 설계
3. canary-ready metrics 정의

이걸 먼저 하는 이유:

- 현재 가장 준비된 ML layer이기 때문

### P2. ML Promotion Contract

해야 할 것:

1. replay/shadow/canary metric snapshot을 model artifact 기준으로 연결
2. rollback rule 명시
3. promote/hold decision contract 정의

이걸 먼저 하는 이유:

- train run만 있고 운영 승격 루프가 닫혀 있지 않기 때문

### P3. Portfolio Optimizer

해야 할 것:

1. cluster rule -> optimizer 전환
2. allocation contract
3. book-level risk objective

이걸 먼저 하는 이유:

- ML alpha/execution만 좋아져도 portfolio가 약하면 수익 구조가 무너진다

### P4. Alpha Model

해야 할 것:

1. `p_tp1`
2. `p_fail_pre_tp1`
3. `p_tp0_to_tp1`

이걸 나중으로 둔 이유:

- 현재 execution layer가 더 준비됐고, alpha serving 계약은 아직 비어 있기 때문

## 8. Immediate Next Gap

현재 latest artifact 기준 immediate next gap은 이것이다.

1. `CORE TV_WEBHOOK` 약점군은 이미 `WEBHOOK_PRE_BAR_CLOSE_FILLED`와 `WEBHOOK_SAVED_NO_PROBE`로 분해됐다.
2. 그런데 이건 아직 `diagnostic truth`다.
3. 아직 `serving decision`이나 `promotion contract`로 연결되지 않았다.

즉 다음 실무 gap은:

- `진단 -> 운영 계약` 전환

이다.

## 9. Stop / Wait Criteria

다음 경우에는 개발보다 관측이 우선이다.

1. sample size가 너무 작을 때
2. `STALE_COMPARISON`만 반복될 때
3. 새 feature가 mismatch를 악화시킬 때
4. OpenClaw가 아직 새 summary를 충분히 누적하지 못했을 때

## 10. Resume Criteria

다음 중 하나면 다시 개발을 재개한다.

1. 같은 weak pattern이 2 cycle 이상 반복
2. `execution_scope_inference_mismatch_rate > 0.10`
3. `saved_no_probe` 또는 `pre_bar_close` rows가 누적
4. new experiment/delta가 stale comparison이 아님

## 11. Current Bottom Line

현재 시스템은:

- foundation와 observability는 강하다
- offline execution ML은 중간 이상으로 올라왔다
- 하지만 promotion, portfolio, alpha serving은 비어 있다

그래서 현재 최종 평가:

1. `일반 개인 시스템 대비`: 매우 높음
2. `일반 기업형 퀀트 시스템 대비`: 높음
3. `기관형 ML+AI 운영체계 대비`: 아직 중간 이하

한 줄로:

`현재 donbeolja의 가장 큰 gap은 더 많은 진단이 아니라, 진단을 운영 계약으로 닫는 것`이다.
