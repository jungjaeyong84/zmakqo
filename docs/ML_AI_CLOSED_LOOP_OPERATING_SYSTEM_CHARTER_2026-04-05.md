"# ML+AI Closed-Loop Operating System Charter"

Status: `ACTIVE_TARGET_ARCHITECTURE`
Updated: `2026-04-05`
Owner: `donbeolja`

## 1. Mission

donbeolja의 최종 목표는 단순 자동매매 봇이 아니다.

최종 목표는 다음 5개가 스스로 닫히는 `ML+AI 운영체계`다.

1. 데이터가 거래 truth를 손실 없이 기록한다.
2. 모델이 alpha, execution, risk를 확률적으로 추정한다.
3. 실행 결과가 다시 학습 데이터로 환원된다.
4. 리스크가 포지션 단위가 아니라 book 단위로 통제된다.
5. AI 감독자가 승격, 보류, 롤백을 증거 기반으로 통제한다.

이 시스템의 중심은 “모델”이 아니라 `closed loop`다.

## 2. Final Definition

최종 시스템은 아래를 만족해야 한다.

1. `Data Loop`
   신호, intent, fill, exit, pnl, mfe/mae, slippage, no-fill, latency, regime가 row-level lineage로 연결된다.

2. `Model Loop`
   alpha, execution, portfolio, risk 모델이 동일한 truth dataset과 versioned feature set에서 학습된다.

3. `Execution Loop`
   모델 출력이 submit, reduce, delay, block, sizing에 반영되고, 실행 결과가 다시 dataset으로 환원된다.

4. `Risk Loop`
   cluster, correlation, drawdown, liquidity, capital budget를 book 수준에서 통제한다.

5. `Promotion Loop`
   replay, shadow, canary, promote, rollback가 artifact 기준으로 닫힌다.

6. `AI Governance Loop`
   OpenClaw가 병목 감지, 실험 우선순위, 모순 탐지, 증거 집계, 승격 제안, 롤백 제안을 담당한다.

## 3. Non-Negotiables

다음 원칙은 절대 깨지면 안 된다.

1. `Truth before model`
   학습 데이터 truth가 불안정하면 모델 고도화는 금지한다.

2. `Version before interpretation`
   version id 없는 결과는 운영 truth로 쓰지 않는다.

3. `Offline before canary`
   offline 검증을 통과하지 못한 모델은 canary에 올리지 않는다.

4. `AI is governor, not unchecked trader`
   AI는 감독자다. 최종 거래 authority는 bounded contract 아래에 있어야 한다.

5. `Execution matters as much as alpha`
   방향 정확도만 보고 execution failure를 무시하지 않는다.

6. `Portfolio first, not signal first`
   개별 신호 최적화보다 book 전체 리스크가 우선이다.

7. `Interpretation must survive artifacts`
   모든 주장과 상태 변화는 artifact로 반증 가능해야 한다.

## 4. Forbidden Patterns

다음은 최종 시스템에서 금지한다.

1. `latest-only truth`
   latest artifact만 보고 과거/실험 비교를 생략하는 운영

2. `rule/model ambiguity`
   hard gate와 ML score의 역할이 섞여 설명이 깨지는 구조

3. `direct LLM trading authority`
   대형 모델이 근거 없는 텍스트 판단으로 직접 체결을 결정하는 구조

4. `promotion without rollback contract`
   rollback 기준 없는 승격

5. `dataset mutation without lineage`
   lineage 복원 없이 원본 의미를 바꾸는 backfill

6. `single-metric optimization`
   win rate 또는 pnl 하나만 보고 승격하는 구조

## 5. System Layers

### 5.1 Data Layer

책임:

1. raw cache/firestore snapshot 수집
2. row-level truth dataset 생성
3. feature store 생성
4. execution dataset 생성
5. dataset versioning 및 experiment registry 연결

필수 산출물:

1. `ml_training_dataset_latest.json`
2. `ml_feature_store_latest.json`
3. `execution_model_dataset_latest.json`
4. `best_self_evolution_ml_experiment_registry_latest.json`

### 5.2 Alpha Layer

책임:

1. `p_tp1`
2. `p_fail_pre_tp1`
3. `p_tp0_to_tp1`
4. expected payoff / downside 추정

현재 상태:

- foundation만 존재
- production alpha model 없음

### 5.3 Execution Layer

책임:

1. fill probability
2. no-fill scope classification
3. latency/slippage/partial-fill quality
4. webhook/policy/runtime failure 분해

현재 상태:

- execution dataset 강함
- offline execution scope/fill baseline 존재
- serving 없음

### 5.4 Portfolio Layer

책임:

1. correlation-aware admission
2. cluster/capital budget sizing
3. drawdown governor
4. liquidity stress handling

현재 상태:

- hard guard 있음
- optimizer 없음

### 5.5 Governance Layer

책임:

1. replay/shadow/canary
2. promote/hold/rollback contract
3. evidence ledger
4. contradiction handling
5. operator visibility

현재 상태:

- metadata/registry 있음
- ML promotion loop 미완성

## 6. OpenClaw Role

OpenClaw의 최종 역할은 다음이다.

1. current system state를 artifact에서 읽는다.
2. stale comparison과 real delta를 구분한다.
3. execution/alpha/risk 병목을 우선순위화한다.
4. 실험 후보를 score한다.
5. 승격과 보류의 근거를 문서화한다.
6. contradiction와 governance violation을 감지한다.

OpenClaw가 하면 안 되는 일:

1. raw text intuition만으로 실거래 변경 승인
2. dataset truth보다 우선하는 판단
3. rollback 기준 없는 낙관적 승격

## 7. Closed Loops To Complete

최종 시스템을 위해 반드시 닫아야 할 루프다.

### Loop A. Data Truth Loop

입력:
- signal, intent, fill, exit, position, report

출력:
- versioned truth dataset

닫힘 조건:
- every row traceable
- invalid lineage rate bounded
- legacy/noise/stale case separated

### Loop B. Execution Learning Loop

입력:
- execution dataset
- runtime/policy/webhook signals

출력:
- fill/scope/latency/slippage model

닫힘 조건:
- offline metrics
- mismatch cluster diagnostics
- canary candidate eligibility

### Loop C. Alpha Learning Loop

입력:
- labeled trade outcomes

출력:
- TP1/failure/conversion probability

닫힘 조건:
- calibrated probabilities
- regime-wise validation
- no leakage

### Loop D. Portfolio Risk Loop

입력:
- active book, cluster state, capital usage, correlation proxies

출력:
- sizing, block, reduce, defer decisions

닫힘 조건:
- book-level objective improvement
- drawdown containment

### Loop E. Promotion Loop

입력:
- train run artifact
- replay/shadow/canary metrics

출력:
- promote / hold / rollback

닫힘 조건:
- explicit artifact ids
- gate criteria
- rollback playbook

### Loop F. AI Governance Loop

입력:
- all latest + versioned artifacts

출력:
- evidence-backed recommendations

닫힘 조건:
- no stale interpretation
- no authority ambiguity
- decision logs preserved

## 8. Current State Assessment

현재 donbeolja는 아래 상태다.

1. `Data Loop`: strong
2. `Execution Learning Loop`: early-mid
3. `Alpha Learning Loop`: foundation only
4. `Portfolio Risk Loop`: early
5. `Promotion Loop`: early
6. `AI Governance Loop`: mid

냉정한 해석:

- `good rule-based quant system with serious ML foundations`
- 아직 `production-grade ML quant operating system`은 아니다.

## 9. Development Priority

우선순위는 기능 추가가 아니라 loop closure 기준으로 정한다.

### P0. Truth Preservation

1. lineage integrity
2. version ids
3. stale vs real delta separation
4. legacy observation gap isolation

### P1. Execution Productionization

1. execution scope/fill/slippage/latency baseline 고도화
2. mismatch cluster diagnostics 유지
3. serving-ready inference contract 설계

### P2. Promotion Contract

1. model artifact id
2. replay/shadow/canary metric snapshot
3. rollback thresholds

### P3. Portfolio Optimizer

1. cluster -> book optimizer 승격
2. capital allocation contract
3. market admission policy

### P4. Alpha Models

1. TP1 probability
2. failure probability
3. TP0->TP1 conversion

### P5. Online Calibration and Drift

1. calibration report
2. drift detectors
3. degradation alarms

## 10. Operating Rules For Development

개발은 아래 순서로만 한다.

1. artifact gap 확인
2. interpretation risk 분리
3. feature or contract 추가
4. tests
5. dataset/report rebuild
6. latest artifact 비교
7. OpenClaw summary 확인
8. commit

다음 경우에는 개발을 멈추고 대기한다.

1. sample size가 너무 작을 때
2. stale comparison만 반복될 때
3. 새 feature가 성능을 악화시킬 때
4. 운영 샘플 축적이 더 중요한 시점일 때

## 11. Success Criteria

최종본은 아래를 만족해야 한다.

1. dataset truth가 stable하다
2. execution/alpha/risk 모델이 versioned train-run을 가진다
3. canary/promote/rollback이 artifact contract로 닫힌다
4. OpenClaw가 stale/noise/real delta를 구분한다
5. book-level objective가 model-driven으로 개선된다

## 12. Current Practical Directive

현재 시점의 directive는 이것이다.

1. 데이터와 execution artifact 관측을 계속 유지한다.
2. 표본이 충분히 쌓일 때만 다음 feature/guard를 추가한다.
3. OpenClaw가 새 summary를 누적해서 읽게 한다.
4. 성능이 악화되는 feature는 진단용으로만 남기고 모델 입력에서는 제외한다.
5. 각 개발은 “더 영리한 규칙”이 아니라 “더 닫힌 루프”를 만드는지 기준으로 판단한다.

## 13. One-Line Standard

donbeolja의 최종 목표는

`데이터, 실행, 리스크, 승격이 스스로 닫히고, AI가 그 폐루프를 감독하는 ML+AI 운영체계`

다.
