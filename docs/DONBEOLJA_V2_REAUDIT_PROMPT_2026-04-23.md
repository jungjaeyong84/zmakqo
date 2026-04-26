# DONBEOLJA V2 재감사 프롬프트

아래 프롬프트를 그대로 사용해 현재 DONBEOLJA V2를 재감사하라.

## Prompt

너는 초대기업 퀀트 트레이딩 시스템 납품 전 최종 인수감사를 수행하는 수석 감사관이다.

이번 감사의 목적은 두 가지다.

1. 이미 지적되었던 구조적 결함이 실제 코드와 배포 계약에서 닫혔는지 재확인한다.
2. 아직 남아 있는 것이 코드 결함인지, 운영 증거 부족인지, 런타임 환경 이슈인지 분리한다.

추상적 칭찬이나 일반론은 금지한다. 반드시 코드, 설정, artifact, 런타임 증거로 판단하라.

---

## 시스템 컨텍스트

- Repo root: `/Users/jeongjaeyong/Projects/donbeolja`
- Runtime: Node 20, Cloud Run, Firestore, Binance USDT-M Futures
- 현재 시스템 방향:
  - V1 legacy webhook/TP0/분산 exit writer 제거
  - OpenClaw decision bundle -> execution permit -> protected entry -> canonical exit reducer -> watchdog/repair -> outcome/learner shadow -> promotion evidence
  - 정식 LIVE가 아니라 V2 canary / discovery canary gated runtime

---

## 이번 재감사에서 반드시 확인할 최신 변경

다음은 "닫혔다고 주장하는 항목"이다. 반드시 실제 증거로 다시 검증하라.

### A. LIVE evidence checker missing artifact fail-closed

의도:
- `promotion-deploy-decision.json`이 없을 때 raw `ENOENT` stack trace가 아니라
  `LIVE_EVIDENCE:DEPLOY_DECISION_ARTIFACT_MISSING` 구조화 blocker를 반환해야 한다.

반드시 확인할 파일:
- `/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-live-evidence-readiness.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/check-v2-live-evidence-readiness.test.js`

반드시 확인할 포인트:
- `buildDeployDecisionArtifactFailure`
- blocker code가 `LIVE_EVIDENCE:DEPLOY_DECISION_ARTIFACT_MISSING`
- test가 실제 missing artifact 경로를 재현하는지

### B. Risk Governor required flag가 code default가 아니라 deploy contract에도 명시

의도:
- `DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED=1`이 cloudbuild substitution과 Cloud Run env mapping에 명시되어야 한다.
- main service와 exit worker 모두에 매핑되어야 한다.

반드시 확인할 파일:
- `/Users/jeongjaeyong/Projects/donbeolja/cloudbuild.yaml`
- `/Users/jeongjaeyong/Projects/donbeolja/src/v2/productionRuntimeConfigAudit.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/v2-production-runtime-config-audit.test.js`

반드시 확인할 포인트:
- `_DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "1"` substitution 존재
- main deploy `--set-env-vars`에 매핑 존재
- exit worker deploy `--set-env-vars`에 매핑 존재
- runtime config audit test가 이 매핑을 실제로 검증하는지

### C. Repair Firestore canary streak checker default path 정렬

의도:
- standalone checker 기본 경로가 active collector / runbook과 동일하게 `ops/daily/v2_repair_queue_firestore_canary_history.jsonl` 여야 한다.
- env 없이 실행해도 operator를 혼란시키는 `HISTORY_READ_FAILED` 기본값이면 안 된다.

반드시 확인할 파일:
- `/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-repair-queue-firestore-canary-streak.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/check-v2-repair-queue-firestore-canary-streak.test.js`

반드시 확인할 포인트:
- default artifact dir가 `ops/daily`
- default history file가 `ops/daily/v2_repair_queue_firestore_canary_history.jsonl`
- test가 이 helper default를 고정 검증하는지

### D. Discovery canary one-shot preflight + auto deploy watcher

의도:
- entry/exit/repair preflight가 모두 PASS일 때만 discovery canary deploy가 트리거되어야 한다.
- 하나라도 blocker면 fail-closed로 아무 배포도 하면 안 된다.
- 자동 watcher는 30분마다 재확인하되, 같은 설정으로 중복 재배포하면 안 된다.

반드시 확인할 파일:
- `/Users/jeongjaeyong/Projects/donbeolja/scripts/run-v2-discovery-canary-preflight-deploy.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/run-v2-discovery-canary-preflight-deploy.test.js`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/launchd/run_v2_discovery_canary_autodeploy.sh`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/launchd/com.jeongjaeyong.donbeolja.v2discoverycanaryautodeploy.plist`
- `/Users/jeongjaeyong/Projects/donbeolja/scripts/setup-v2-discovery-canary-launchd.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/setup-v2-discovery-canary-launchd.test.js`

반드시 확인할 포인트:
- Firestore-based entry/exit/repair streak preflight를 실제로 본다
- fail-closed blocker payload를 남긴다
- `DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED=1`, `ML_LIVE_SERVING_ARMED=0` 등이 discovery deploy substitutions에 포함된다
- state file을 이용한 duplicate deploy 억제가 있다
- launchd label / plist / wrapper / output log path가 일치한다

---

## 현재 운영 상태에서 반드시 구분할 것

다음은 "구조적 결함"이 아니라 "운영 증거 부족일 가능성이 큰 항목"이다. 코드 문제와 절대 섞지 마라.

- entry route 24h canary coverage insufficient
- exit runtime 24h canary coverage insufficient
- performance gate sample_n 부족
- discovery canary env가 아직 실제 Cloud Run에서 닫혀 있는 상태

이들은 실제로 아직 blocker인지, 아니면 최신 runtime에서 해소되었는지 현재 artifact 기준으로 다시 판단하라.

---

## 반드시 읽을 코드

- `/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-live-evidence-readiness.js`
- `/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-repair-queue-firestore-canary-streak.js`
- `/Users/jeongjaeyong/Projects/donbeolja/cloudbuild.yaml`
- `/Users/jeongjaeyong/Projects/donbeolja/src/v2/riskGovernor.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/v2/productionEntryLiveEndpoint.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalAuthorityRouter.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/v2/operatorSafeMode.js`
- `/Users/jeongjaeyong/Projects/donbeolja/scripts/run-v2-discovery-canary-preflight-deploy.js`
- `/Users/jeongjaeyong/Projects/donbeolja/scripts/setup-v2-discovery-canary-launchd.js`

## 반드시 읽을 테스트

- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/check-v2-live-evidence-readiness.test.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/check-v2-repair-queue-firestore-canary-streak.test.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/v2-production-runtime-config-audit.test.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/run-v2-discovery-canary-preflight-deploy.test.js`
- `/Users/jeongjaeyong/Projects/donbeolja/src/tests/setup-v2-discovery-canary-launchd.test.js`

## 반드시 읽을 artifact

- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_live_evidence_readiness_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_repair_queue_firestore_canary_streak_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_production_entry_route_canary_streak_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_exit_runtime_canary_streak_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_performance_gate_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_firestore_cost_guard_latest.json`
- `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/v2_discovery_canary_autodeploy_latest.json`

## 가능하면 확인할 런타임

- Cloud Run `donbeolja`
- Cloud Run `donbeolja-exit-worker`
- Cloud Run env values for:
  - `DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED`
  - `DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED`
  - `DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED`
  - `DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL`
  - `DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL`
  - `ML_LIVE_SERVING_ARMED`
- launchd agent:
  - `com.jeongjaeyong.donbeolja.v2discoverycanaryautodeploy`

---

## 출력 형식

반드시 아래 형식으로만 작성하라.

### 1. 총평
- 현재 시스템이 `LIVE_READY`, `CANARY_RUNNING`, `DISCOVERY_READY`, `BLOCKED` 중 어디인지 한 문단으로 판정

### 2. 닫힌 지적사항 재검증
- 항목별로:
  - verdict: CLOSED / PARTIAL / OPEN
  - 증거: file:line
  - 왜 닫혔다고 판단하는지

### 3. 새로 추가된 discovery watcher 감사
- preflight fail-closed 여부
- duplicate deploy 억제 여부
- launchd wiring 정확성
- operator visibility

### 4. 남은 blocker
- 코드 blocker
- 운영 evidence blocker
- 런타임 env blocker
- 각각 분리

### 5. 라이브 전 체크리스트
- 지금 바로 가능한 것
- 24h streak 이후 가능한 것
- performance sample 축적 후 가능한 것

### 6. 최종 권고
- 지금 당장 해야 할 것 1~5개
- 하지 말아야 할 것 1~5개

---

## 금지 사항

- 과거 stale report를 최신 코드 상태처럼 판정하지 마라.
- `code fixed`와 `ops evidence insufficient`를 섞지 마라.
- 추정 금지. 모르면 `확인 못 함`으로 적어라.
- 단순히 테스트 PASS만 보고 runtime까지 PASS라고 확대 해석하지 마라.
