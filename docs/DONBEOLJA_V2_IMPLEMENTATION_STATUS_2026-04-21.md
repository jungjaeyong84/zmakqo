# DONBEOLJA V2 Implementation Status

## 목적

이 문서는 `docs/DONBEOLJA_V2_BUILD_ROADMAP_2026-04-20.md` 를 기준으로,
현재 `src/v2` 와 관련 테스트가 실제로 어디까지 구현됐는지 증거 기반으로 정리한 상태판이다.

핵심은 "파일이 있다"와 "운영 가능한 단계다"를 구분하는 것이다.

## 총평

현재 V2는 아래 두 층의 완성도가 크게 다르다.

1. bounded promotion / lineage / canary / submit fail-closed 계층
2. 실제 entry / protection / reducer / tick / alert / watchdog / repair runtime 계층

1번은 상당히 진전됐다.
2번은 핵심 pure module과 contract는 많이 올라왔지만, 실제 런타임 오케스트레이션과 production write path는 아직 얇다.

즉, "V2 안전한 승격 검증 프레임" 은 후반부에 가깝고,
"V2 실전 본체" 는 중반 이하로 보는 것이 맞다.

## 상태 정의

1. `완료`
   운영 경로에 필요한 핵심 구현 + 테스트 + fail-closed 증거가 모두 있다.
2. `부분완료`
   핵심 contract / pure module / 테스트는 있으나, 런타임 오케스트레이션 또는 production write path가 얇다.
3. `초기`
   골격은 있으나 실제 운영 경로로 보기 어렵다.
4. `미착수`
   문서 외 근거가 거의 없다.

## 단계별 상태

| 단계 | 상태 | 판단 |
| --- | --- | --- |
| 단계 0. 착수 준비 | 부분완료 | 문서/namespace/runtime contract는 존재하나, V1/V2 완전 분리 운영이 코드 차원에서 끝났다고 보긴 이르다 |
| 단계 1. Data Contract | 부분완료 | contract와 storage 계층은 강하다. 실제 Firestore live namespace 사용 증거는 아직 부족하다 |
| 단계 2. Entry + Native Protection | 부분완료 | bootstrap/executor/protection writer는 존재하고 테스트도 통과한다. 하지만 live orchestration evidence는 아직 부족하다 |
| 단계 3. Canonical Exit Reducer | 부분완료 | reducer와 ledger 규칙은 명확하다. 다만 실제 fill sync writer가 V2 reducer를 production path로 쓰는 증거는 아직 없다 |
| 단계 4. Tick Exit Worker | 부분완료 | pure evaluation과 refresh request 생성은 존재한다. tick scheduler / runtime write 연결은 아직 얇다 |
| 단계 5. Alert Pipeline | 부분완료 | alert worker와 outbox contract는 있다. production canonical transition 후행 처리로 완전히 묶였다고 보긴 이르다 |
| 단계 6. Watchdog + Repair Queue | 부분완료 | watchdog / repair executor pure logic은 있다. queue / executor / service 분리 운영은 아직 약하다 |
| 단계 6A. OpenClaw Supreme Control Plane | 부분완료 | decision bundle / evidence summary는 존재한다. supreme control plane 실제 운영 통합은 아직 미완이다 |
| 단계 6B. ML+AI Native Signal Plane | 부분완료 | proposal, shadow writer, comparison, promotion artifact 계층은 꽤 진전됐다. 실제 native signal 운영 승격은 아직 아니다 |
| 단계 7. Replay Gate | 완료에 가까운 부분완료 | bounded selector / collector / exporter / replay / comparison / unified report / deploy decision / cloudbuild / submit wrapper까지 닫혀 있다 |
| 단계 8. Paper / Shadow / Canary | 초기 | 문서와 gate는 있으나, V2가 실제 paper/shadow/live를 대체 운용하는 증거는 아직 부족하다 |

## 증거

### 단계 0. 착수 준비

증거:

1. `src/v2/runtime.js`
2. `src/v2/constants.js`
3. `src/v2/boundaries.js`
4. `docs/DONBEOLJA_V1_FREEZE_POLICY_2026-04-20.md`
5. `docs/DONBEOLJA_V2_REBUILD_PRINCIPLES_2026-04-20.md`

판정:

1. namespace / collection prefix / canary flags / dry-run flags는 코드에 있다
2. 하지만 V1 write path와 완전 격리 운영이 실제 런타임에 강제된다고 단정할 배포 증거는 아직 부족하다

### 단계 1. Data Contract

증거:

1. `src/v2/contracts.js`
2. `src/v2/storage.js`
3. `src/tests/v2-runtime-contracts.test.js`
4. `src/tests/v2-storage.test.js`

판정:

1. schema 생성기와 validator 계층은 강하다
2. collection key -> doc id field 매핑도 있다
3. `src/v2/storage.js` 는 단건 write 외에 `putV2DocsBatch` 를 제공하고, Firestore batch가 없으면 `V2_FIRESTORE_BATCH_REQUIRED` 로 fail-closed 한다
4. 정본 전이처럼 여러 V2 collection을 동시에 닫아야 하는 경로가 단일 batch boundary를 사용할 수 있게 됐다
5. 다만 production data에서 `*_v2` collection이 실제 steady-state로 채워지는 운영 증거는 아직 없다

### 단계 2. Entry + Native Protection

증거:

1. `src/v2/entryBootstrap.js`
2. `src/v2/entryExecutor.js`
3. `src/v2/protectionModel.js`
4. `src/v2/protectionWriter.js`
5. `src/v2/entryProtectionStorage.js`
6. `src/v2/entryProtectionRunner.js`
7. `src/v2/entryProtectionRepairRequests.js`
8. `src/v2/entrySubmitter.js`
9. `src/v2/entrySizingDecision.js`
10. `src/v2/entryBoundaryAudit.js`
11. `src/v2/binanceEntryOrderTransport.js`
12. `src/v2/binanceInitialProtectionTransport.js`
13. `scripts/check-v2-entry-boundary.js`
14. `src/tests/v2-entry-bootstrap.test.js`
15. `src/tests/v2-entry-executor.test.js`
16. `src/tests/v2-entry-submitter.test.js`
17. `src/tests/v2-entry-sizing-decision.test.js`
18. `src/tests/v2-entry-boundary-audit.test.js`
19. `src/tests/v2-binance-entry-order-transport.test.js`
20. `src/tests/v2-protection-writer.test.js`
21. `src/tests/v2-entry-protection-storage.test.js`
22. `src/tests/v2-entry-protection-runner.test.js`
23. `src/tests/v2-binance-initial-protection-transport.test.js`
24. 실행 확인: `V2_ENTRY_BOOTSTRAP_TEST_OK`, `V2_ENTRY_EXECUTOR_TEST_OK`, `V2_ENTRY_SUBMITTER_TEST_OK`, `V2_ENTRY_SIZING_DECISION_TEST_OK`, `V2_ENTRY_BOUNDARY_AUDIT_TEST_OK`, `V2_BINANCE_ENTRY_ORDER_TRANSPORT_TEST_OK`, `V2_PROTECTION_WRITER_TEST_OK`, `V2_ENTRY_PROTECTION_STORAGE_TEST_OK`, `V2_ENTRY_PROTECTION_RUNNER_TEST_OK`, `V2_BINANCE_INITIAL_PROTECTION_TRANSPORT_TEST_OK`

판정:

1. entry intent validation, bootstrap, initial protection command 생성, single-writer guard는 구현됐다
2. 그러나 이 계층은 아직 pure orchestration 모듈에 가깝다
3. 거래소 호출, fill persistence, bootstrap write commit이 한 경로로 묶인 production runner 증거는 아직 부족하다
4. 다만 `src/v2/runtimeChainAudit.js` 와 `src/tests/v2-runtime-chain-audit.test.js` 로 handoff 이후 lineage drift가 있으면 reducer/alert 쪽으로 진행 자체를 fail-closed 하도록 감사 증거는 한 단계 올라왔다
5. `src/v2/protectionWriter.js` 의 `finalizeAuditedInitialProtectionPlacement` 가 entry -> placement -> protection runtime 경계에서 audit를 강제하므로, 적어도 초기 보호주문 경계는 "테스트용 감사" 에서 "실행 경계의 fail-closed helper" 로 한 단계 올라왔다
6. entry bootstrap은 이제 `status=PROTECTION_PENDING` 으로만 cycle을 만들고, `SL + TP1` 이 모두 `HEALTHY` 로 증명된 protection runtime이 있을 때만 `ACTIVE_PROTECTED` 로 승격한다
7. reducer/alert runtime chain audit와 promotion candidate selector는 `ACTIVE_PROTECTED` 를 정상 downstream 대상으로 보므로, V1식 무보호 active cycle 재발 위험이 한 단계 줄었다
8. `src/v2/entryProtectionStorage.js` 가 bootstrap pending write와 protected activation write를 Firestore batch boundary로 묶는다. batch 없는 writer는 `V2_FIRESTORE_BATCH_REQUIRED` 로 fail-closed 한다
9. protected activation은 `position_cycles_v2(status=ACTIVE_PROTECTED)` 와 `protection_runtime_v2(health_status=HEALTHY)` 를 같은 batch에서 쓰므로, V1식 split write / half-active 재발 위험이 더 줄었다
10. `src/v2/entryProtectionRunner.js` 가 pending write -> SL 먼저 제출 -> TP1 제출 -> audited finalize -> protected activation write 순서를 하나의 runtime helper로 묶었다
11. TP1 실패나 malformed ack는 activation write 전 차단되고, TP1 실패는 `TP1_ORDER_MISSING` 이 포함된 `protectionWriteResult` 로 반환된다
12. initial protection transport가 예외를 throw 하거나 malformed ack를 반환해도 runner가 이를 `FAILED` ack로 정규화하고, `protection_runtime_v2(degraded)` 와 repair request를 남기므로 pending bootstrap만 남는 V1식 관측성 손실이 줄었다
13. `src/v2/binanceInitialProtectionTransport.js` 가 initial SL/TP1 Binance adapter를 제공한다. SL은 `STOP_MARKET closePosition=true`, TP1은 `TAKE_PROFIT_MARKET closePosition=false reduceOnly=true quantity_abs` 로 고정된다
14. dry-run adapter는 거래소 호출 없이 실패 ack를 반환하므로, dry-run 상태에서 `ACTIVE_PROTECTED` 가 생성되지 않는다
15. order id 없는 skipped/existing order 응답은 `PLACED` 로 인정하지 않는다
16. `src/v2/entryProtectionRepairRequests.js` 와 `commitEntryProtectionRepairQueue` 가 TP1/SL 초기 보호 실패를 `protection_runtime_v2(degraded)` + `exit_repair_requests_v2(status=PENDING)` batch write로 영속화한다
17. `TP1_ORDER_MISSING` 은 `ENSURE_TP1_ORDER`, `UNPROTECTED_ACTIVE_POSITION` 은 `ENSURE_FULL_PROTECTION` 으로 매핑된다
18. dry-run 실패 ack는 `DRY_RUN_PROTECTION_ACK` 로 repair enqueue를 skip 하므로, dry-run 검증이 live repair를 오염시키지 않는다
19. `src/v2/entrySubmitter.js` 가 production entry submit shell 역할을 시작했다. entry transport와 protection transport를 먼저 검증하고, executable intent와 `FILLED` receipt lineage가 모두 확인된 뒤에만 `runV2EntryProtectionActivation` 을 호출한다
20. entry fill 이후 protection activation 자체가 throw 되어도 submitter는 `ENTRY_PROTECTION_ACTIVATION_THROWN` 구조화 결과와 entry fill lineage를 반환하므로, 체결 후 예외가 상위 계층에서 원인 없이 사라지는 위험이 줄었다
21. protection transport 누락, `SHADOW` intent, partial fill, fill lineage 누락은 entry/protection 진행을 fail-closed 한다
22. `src/v2/binanceEntryOrderTransport.js` 가 Binance MARKET entry adapter를 제공한다. `LONG -> BUY`, `SHORT -> SELL`, `reduceOnly=false` 로 고정하고, 수량은 `quantityResolver` 가 명시한 절대수량만 사용한다
23. Binance entry adapter는 `FILLED + orderId + avgPrice + executedQty` 가 모두 있을 때만 `entry_event_id` / `entry_order_id` / `entry_fill_group_id` 를 생성한다
24. dry-run adapter는 거래소 호출 없이 `DRY_RUN` receipt를 반환하므로 submitter가 filled entry로 처리하지 않는다
25. `src/v2/entrySizingDecision.js` 가 `requested_notional_quote`, `max_notional_quote`, `min_notional_quote`, `min_qty_abs`, `step_size` 를 기준으로 `entry_qty_abs` 를 승인 또는 차단한다
26. blocked sizing decision은 quantity resolver로 승격할 수 없고, resolver는 `entry_intent_id/symbol/side` mismatch를 차단한다
27. step size 반올림이나 min order bump가 budget을 초과하면 주문 제출 전에 fail-closed 된다
28. `src/v2/entryBoundaryAudit.js` 와 `scripts/check-v2-entry-boundary.js` 가 V2 내부에서 raw `placeFuturesMarketOrder` 참조는 `binanceEntryOrderTransport` 로, `runV2EntryProtectionActivation` 직접 호출은 `entrySubmitter` 로 제한한다
29. `npm run check:v2-entry-boundary` 로 V2 entry namespace 우회 여부를 별도 gate처럼 검사할 수 있다

V1 약점 재발 위험:

1. V2 내부 boundary는 잠겼지만, 아직 V1 legacy runtime 전체의 native entry writer를 차단하지는 않는다
2. production route / scheduler cutover가 이 shell만 호출하도록 연결되지 않으면 V1식 분산 writer 문제가 다시 생긴다

### 단계 3. Canonical Exit Reducer

증거:

1. `src/v2/canonicalExitReducer.js`
2. `src/v2/exitFillIngestion.js`
3. `src/tests/v2-canonical-exit-reducer.test.js`
4. `src/tests/v2-exit-fill-ingestion.test.js`
5. 실행 확인: `V2_CANONICAL_EXIT_REDUCER_TEST_OK`, `V2_EXIT_FILL_INGESTION_TEST_OK`

판정:

1. TP1 / TRAIL_ACTIVATED / STOP_EXIT / EXTERNAL/MANUAL close reducer는 있다
2. legacy partial take profit은 명시적으로 차단한다
3. absolute qty ledger 검증도 들어가 있다
4. 다만 실제 exchange fill sync가 이 reducer를 authoritative writer로 사용 중이라는 운영 증거는 아직 없다
5. 새 runtime chain audit는 reducer가 protection health가 깨진 상태에서 조용히 downstream truth를 만들지 못하게 하는 별도 감사층으로 기능한다
6. `openclawShadowExitWriter` 의 TP1 transition 경로는 이제 `ACTIVE_PROTECTED` position cycle과 `HEALTHY/OK` protection runtime, SL/TP1 order evidence가 없으면 canonical transition을 쓰지 않는다
7. `src/v2/exitFillIngestion.js` 가 V2 fill 이벤트를 reducer evidence로 정규화하는 단일 순수 진입점을 제공한다
8. 이 계층은 `TP1`, `STOP/SL/TRAIL`, `EXTERNAL`, `MANUAL` 만 허용하고, V2 계약 밖의 legacy partial fill은 `V2_EXIT_FILL_UNSUPPORTED_LEGACY_PARTIAL` 로 거부한다
9. source fill id와 source order id가 없으면 reducer 호출 전 `EXIT_FILL_SOURCE_*_REQUIRED` 로 차단하므로, V1식 fill lineage 누락 상태에서 canonical truth를 만드는 위험을 줄였다
10. stop fill은 fill price 없이는 `EXIT_FILL_STOP_PRICE_REQUIRED` 로 차단하며, `SL_HIT` vs `TRAIL_HIT` 판정은 fill label이 아니라 projection stage를 기준으로 reducer가 결정한다
11. 이 계층은 transition에 `source_exchange_evidence` snapshot을 붙이고 alert worker까지 같은 canonical transition으로 준비하므로, replay gate가 요구하는 evidence shape와 production fill reducer 입력이 같은 방향으로 수렴한다
12. `binanceFuturesFillsSync` 의 V2 shadow TP1/SL/TRAIL/EXTERNAL/MANUAL wrapper도 이제 writer 호출 전에 `normalizeV2ExitFillEvidence` 를 통과한다
13. 따라서 V2 계약 밖의 legacy partial fill이 `TP1_REACHED` 로 remap되는 경우에도 V2 shadow writer는 호출되지 않고, legacy canonical write gate가 `V2_EXIT_FILL_UNSUPPORTED_LEGACY_PARTIAL` 로 막는다
14. `openclawShadowExitWriter` 의 TP1 / TRAIL_ACTIVATED / SL_HIT / TRAIL_HIT / EXTERNAL_CLOSE_SYNC / MANUAL_CLOSE_SYNC 산출물은 이제 canonical transition, runtime projection, alert outbox, protection runtime 갱신을 Firestore batch 한 경계로 쓴다
15. 따라서 V1식 "transition은 있는데 projection/outbox/protection runtime이 빠지는" split-write drift 재발 위험이 shadow exit writer 경로에서 줄었다

V1 약점 재발 위험:

1. reducer가 있어도 production fill writer가 다른 stage 추론을 하면 V1처럼 truth가 분산된다
2. 현재 runtime chain audit 정본은 `src/v2/runtimeChainAudit.js` 하나로 통일됐고, `src/v2/runtimeExecutionChain.js` 는 그 정본을 그대로 위임하므로 검사 drift 자체는 줄었다
3. shadow TP1 writer는 보호 runtime gate로 한 단계 잠겼고, `binanceFuturesFillsSync` 의 shadow TP1 wrapper도 writer의 보호 runtime 차단 결과를 그대로 보존하도록 테스트됐다
4. production fill sync의 legacy TP1 canonical transition 기록도 event label이 아니라 `TP1_REACHED` transition 기준으로 V2 shadow TP1 gate 결과를 먼저 확인하고, 보호 runtime 불량이면 legacy 기록과 stage hint 승격을 같이 막도록 보강됐다
5. production fill sync의 legacy `SL_HIT` / `TRAIL_HIT` 기록도 V2 shadow stop-exit writer 결과를 먼저 확인하고, context/gate 불량이면 legacy 기록과 stage hint 승격을 같이 막도록 보강됐다
6. production fill sync의 legacy `EXTERNAL_CLOSE_SYNC` / `MANUAL_CLOSE_SYNC` 기록도 V2 shadow external-close writer 결과를 먼저 확인하고, position/projection context 불량이면 legacy 기록과 stage hint 승격을 같이 막도록 보강됐다
7. legacy canonical gate는 이제 V2 shadow writer가 `write_mode=BATCH` 와 `CANONICAL_EXIT_TRANSITIONS` / `EXIT_RUNTIME_PROJECTIONS` / `TRADE_ALERT_OUTBOX` write evidence를 반환해야 통과한다
8. 따라서 단순히 `ok=true, written=true` 만 반환하는 우회 writer나 half-write wrapper는 legacy canonical transition 기록을 더 이상 전진시킬 수 없다
9. production fill sync의 V2 shadow wrapper는 `exitFillIngestion` 을 통과하지만, 아직 모든 legacy canonical write가 이 모듈 하나로 대체된 것은 아니다
10. batch write는 writer 내부 split-write를 줄였지만, delivery worker 후행 업데이트까지 같은 transaction으로 묶는 것은 아니다. 알림 배송 결과는 별도 retry 가능한 상태 전이로 남겨야 한다
11. 남은 gap은 live canary에서 위 gate들이 실제 Binance fill sequence와 비용 제한 안에서 충분한 evidence를 남기는지 검증하는 것이다

### 단계 4. Tick Exit Worker

증거:

1. `src/v2/tickExitWorker.js`
2. `src/tests/v2-tick-exit-worker.test.js`
3. 실행 확인: `V2_TICK_EXIT_WORKER_TEST_OK`

판정:

1. watermark / runner floor / R-based trail / chosen stop source / refresh request 계산은 구현됐다
2. 하지만 아직 pure evaluator 성격이 강하다
3. 실제 tick scheduler, projection writeback, refresh command dispatch와 결합된 V2 runtime 증거는 약하다
4. shadow trail activation writer는 이제 `nativeRefreshStatus=OK` 인 경우에만 canonical `TRAIL_ACTIVATED` 를 기록하도록 fail-closed 되어, V1식 "native stop 미확정인데 trail truth 먼저 승격" 위험을 한 단계 더 줄였다

V1 약점 재발 위험:

1. trail activation과 native stop refresh 성공이 같은 single writer로 묶이지 않으면, V1처럼 trail truth와 exchange stop이 어긋날 수 있다

### 단계 5. Alert Pipeline

증거:

1. `src/v2/alertWorker.js`
2. `src/tests/v2-alert-worker.test.js`
3. 실행 확인: `V2_ALERT_WORKER_TEST_OK`

판정:

1. canonical transition 기반 alert payload와 terminal health 검증은 있다
2. dedupe/outbox contract도 있다
3. 다만 실제 Telegram/worker/retry pipeline이 V2 canonical transition 후행 처리로 production에 연결됐다고 보긴 이르다
4. `runtimeChainAudit` 가 alert payload/event/stage/cycle mismatch도 별도 체크해서, downstream 채널 직전 drift를 조기에 잡는 근거가 추가됐다
5. shadow exit writer는 이제 canonical transition/projection을 쓸 때 같은 경계에서 `trade_alert_outbox_v2` 도 같이 남기므로, 최소한 shadow write path에서는 V1식 silent alert drop 여지가 더 줄었다
6. 또한 `src/v2/alertDeliveryWorker.js` 가 prepared payload만 소비해 delivery result를 outbox 상태와 같이 닫기 시작했으므로, 적어도 V2 shadow 경로에서는 "나중에 제목/본문을 다시 조립해서 보내는" V1식 drift를 더 줄였다
7. outbox에는 이제 prepared payload와 delivery request snapshot도 같이 저장되고, `src/v2/alertRetryWorker.js` 가 그 스냅샷만 읽어 bounded retry를 수행하므로 retry 단계에서 다시 문장을 조립하는 V1식 재발 위험도 더 줄었다
8. canonical exit writer는 alert outbox initial row를 transition/projection/protection runtime과 같은 batch에 넣으므로, 정본 전이는 있는데 알림 작업 row가 없는 silent-drop 상태를 shadow path에서 차단한다
9. retry worker는 이제 `max_attempt`, `cooldown`, `terminal fail reason` 기준을 가져서, 전송 비활성/준비 불가 상태를 무한 재시도하거나 너무 짧은 간격으로 소음을 내는 V1식 운영 문제도 한 단계 더 줄였다
10. 또한 failure taxonomy와 `DONBEOLJA_V2_ALERT_RETRY_RUNBOOK_2026-04-21.md` 가 연결돼 있어, retry 차단이 발생하면 어느 계열 문제인지와 어느 runbook ref를 다시 보면 되는지가 같은 코드 체계로 복원된다
11. `scripts/check-v2-alert-runbook.js` 가 `src/v2/alertFailureTaxonomy.js`, `src/v2/alertRetryWorker.js`, `src/v2/alertDeliveryWorker.js`, runbook 문서 간 역참조를 fail-closed 로 검사하므로, V1식 "코드는 바뀌었는데 runbook은 예전 설명을 유지" 하는 drift도 더 줄었다
12. taxonomy 정본도 이제 `ALERT_FAILURE_TAXONOMY_CONTRACTS` 로 명시돼 있고 `src/tests/v2-alert-failure-taxonomy.test.js` 와 checker가 같은 catalog를 읽으므로, checker가 분류 계약을 다시 하드코딩하는 V1식 중복 truth 위험도 더 줄었다

V1 약점 재발 위험:

1. outbox가 canonical source를 쓰더라도 실제 운영 worker가 다른 source를 참조하면 silent drop이나 중복이 다시 생길 수 있다

### 단계 6. Watchdog + Repair Queue

증거:

1. `src/v2/watchdog.js`
2. `src/v2/repairExecutor.js`
3. `src/tests/v2-watchdog-repair.test.js`
4. 실행 확인: `V2_WATCHDOG_REPAIR_TEST_OK`

판정:

1. TP1 missing / trail stop missing / native refresh unhealthy / terminal mismatch issue code는 있다
2. repair command도 writer/price/source mismatch를 검사한다
3. `src/v2/watchdogRepairRuntime.js` 와 `src/tests/v2-watchdog-repair-runtime.test.js` 로 이제 watchdog는 repair request만 만들고, repair executor는 이를 protection writer로 delegate만 한다는 service boundary 증거가 추가됐다
4. `src/v2/repairQueueService.js` 와 `src/tests/v2-repair-queue-service.test.js` 로 repair queue consumer가 bounded batch, duplicate suppression, projection-required skip, position-cycle-required skip, terminal repair skip 기준으로 delegate envelope만 만들도록 정리됐다
5. `src/v2/repairQueueWorker.js`, `src/v2/repairExecutionLedger.js`, `src/v2/repairExecutionCompletion.js`, `src/tests/v2-repair-queue-worker.test.js`, `src/tests/v2-repair-execution-ledger.test.js`, `src/tests/v2-repair-execution-completion.test.js` 로 Firestore `REPAIR_REQUESTS` bounded fetch -> `POSITION_CYCLES` / projection / protection runtime hydrate -> delegation batch 생성 -> execution ledger persistence -> protection writer handoff completion ledger 까지 runtime orchestration 뼈대가 추가됐다
6. `src/v2/repairQueueLiveWorker.js` 와 `src/tests/v2-repair-queue-live-worker.test.js` 로 delegated repair executor callback, completion success/fail ledger, executor throw fallback까지 live worker shell 수준의 실행 경계가 추가됐다
7. `src/v2/repairQueueLiveService.js` 와 `src/tests/v2-repair-queue-live-service.test.js` 로 live service entrypoint가 `HEALTHY` / `DEGRADED` / `DISABLED` verdict와 fail-closed blocker reason을 같은 summary로 올리기 시작했다
8. `scripts/run-v2-repair-queue-service.js` 와 `src/tests/run-v2-repair-queue-service.test.js` 로 실제 job entrypoint가 artifact를 남기고, executor 미구현 상태를 `V2_REPAIR_QUEUE_EXECUTOR_NOT_IMPLEMENTED` 로 fail-closed 하도록 명시됐다
9. `src/v2/repairDelegatedExecutor.js` 와 `src/tests/v2-repair-delegated-executor.test.js` 로 protection writer delegation만 소비하는 adapter가 추가됐고, transport 미주입은 `REPAIR_TRANSPORT_MISSING` 으로 completion ledger에 실패로 닫히도록 정리됐다
10. `src/v2/binanceProtectionTransport.js` 와 `src/tests/v2-binance-protection-transport.test.js` 로 Binance refresh transport가 명시적 context resolver 없이는 symbol / liveCfg / side를 추론하지 않고, 호출 시 `BINANCE_TICK_EXIT` writer source만 주입하도록 고정됐다
11. `src/v2/binanceRepairContextResolver.js` 와 `src/tests/v2-binance-repair-context-resolver.test.js` 로 Binance repair context가 delegated envelope의 `position_cycle_snapshot` 에서만 symbol / side / entry price를 복원하고, `position_cycle_id` 문자열 파싱을 거부하는 증거가 추가됐다
12. `src/v2/binanceRepairLiveCfgResolver.js` 와 `src/tests/v2-binance-repair-live-cfg-resolver.test.js` 로 V2 repair live cfg가 기존 `resolveLiveFuturesConfig` adapter를 통해서만 들어오고, key missing / live disabled / non-Binance exchange를 fail-closed 하는 증거가 추가됐다
13. `ops/launchd/run_v2_repair_queue_service.sh`, `scripts/lib/openclaw-cron-manifest.js`, `scripts/automation-automation-watchdog.js`, `src/tests/openclaw-cron-manifest.test.js`, `src/tests/automation-watchdog.test.js` 로 V2 repair queue service가 기존 scheduler SSOT인 `OPENCLAW_CRON`에 등록되고, `v2_repair_queue_service_latest.json` artifact freshness까지 watchdog에 연결됐다
14. `src/v2/repairQueueCanary.js`, `scripts/run-v2-repair-queue-canary.js`, `src/tests/v2-repair-queue-canary.test.js`, `src/tests/run-v2-repair-queue-canary.test.js` 로 Firestore emulator와 Binance 없이 메모리 fixture에서 queue -> `POSITION_CYCLES` hydrate -> delegated executor -> Binance transport adapter -> completion ledger까지 통과하는 dry-run canary 증거가 추가됐다
15. `scripts/check-v2-repair-queue-canary-preflight.js` 와 `src/tests/check-v2-repair-queue-canary-preflight.test.js` 로 live repair enable 전에 canary artifact freshness, dry-run mode, no exchange write, `BINANCE_TICK_EXIT` writer source, completion ledger, secret 미노출을 fail-closed로 검사하는 gate가 추가됐다
16. `scripts/run-v2-repair-queue-service.js`, `src/tests/run-v2-repair-queue-service.test.js`, `ops/launchd/run_v2_repair_queue_service.sh`, `src/tests/openclaw-cron-manifest.test.js`, `scripts/automation-automation-watchdog.js`, `src/tests/automation-watchdog.test.js` 로 Binance transport binding이 켜진 repair service는 canary preflight 없이는 실행되지 않고, scheduler wrapper도 canary -> preflight -> service 순서로만 실행되며, canary/preflight artifact freshness도 watchdog가 감시한다
17. `src/v2/repairQueueOperationalCanary.js`, `scripts/run-v2-repair-queue-operational-canary.js`, `src/tests/v2-repair-queue-operational-canary.test.js`, `src/tests/run-v2-repair-queue-operational-canary.test.js` 로 fixture에 repair request를 미리 심는 방식이 아니라 watchdog가 `TRAIL_STOP_MISSING` 을 감지해 생성한 request를 queue가 소비하고 completion ledger까지 닫는 shadow operational canary 증거가 추가됐다
18. preflight는 이제 live repair enable 요청 시 dry-run canary뿐 아니라 shadow operational canary의 watchdog-generated request, no exchange write, completion success, secret 미노출까지 같이 fail-closed 로 검사한다
19. service entrypoint 자체도 Binance transport binding이 켜지면 `DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED=1` 과 `DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED=1` 을 preflight에 주입하므로, wrapper를 우회한 직접 실행도 18개 canary check 없이는 통과하지 않는다
20. scheduler wrapper는 dry-run canary -> shadow operational canary -> preflight -> service 순서로만 실행되며, automation watchdog도 `v2_repair_queue_operational_canary_latest.json` freshness를 별도 감시한다
21. `src/v2/repairQueueWorker.js` 는 이제 `REPAIR_REQUESTS` 를 무조건 list 하지 않고 `status=PENDING` 만 bounded scan 하므로, stale/completed repair request가 새 복구를 가로막는 V1식 queue 오염 위험이 줄었다
22. `src/v2/repairQueueFirestoreCanary.js`, `scripts/run-v2-repair-queue-firestore-canary.js`, `src/tests/v2-repair-queue-firestore-canary.test.js`, `src/tests/run-v2-repair-queue-firestore-canary.test.js` 로 isolated collection prefix에 canary fixture를 실제 storage adapter로 seed한 뒤 같은 Firestore read path로 queue -> completion ledger까지 닫는 Firestore-backed paper canary가 추가됐다
23. Firestore-backed paper canary는 기본값에서 write disabled로 fail-closed 되고, `DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED=1` 이 있어야 seed write를 수행한다
24. 2026-04-21 12:07 KST 기준 dev Firestore isolated prefix `paperopcanaryv2_20260421120746__` 로 1회 실행했고, seed write 4건, queue requested/delegated 1건, completion success 1건, exchange write 0건을 artifact `ops/daily/v2_repair_queue_firestore_canary_latest.json` 에 남겼다
25. 같은 artifact를 preflight에 연결해 `DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED=1` 상태에서 dry-run / operational / firestore-backed 총 25개 check가 통과함을 확인했다
26. `scripts/run-v2-repair-queue-firestore-canary.js` 는 이제 latest JSON뿐 아니라 `v2_repair_queue_firestore_canary_history.jsonl` 에 실행 이력을 append하므로, 최신 성공 1건이 과거 실패를 덮어버리는 V1식 증거 소실 위험이 줄었다
27. `scripts/check-v2-repair-queue-firestore-canary-streak.js` 와 `src/tests/check-v2-repair-queue-firestore-canary-streak.test.js` 로 24시간 lookback, 최소 run 수, 최대 gap, window 내 unhealthy row, credential marker를 fail-closed 로 검사하는 streak gate가 추가됐다
28. scheduler wrapper는 `DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED=1` 일 때만 streak gate를 실행하므로, 실제 24시간 관찰을 시작하기 전에는 기본 운영 경로를 불필요하게 막지 않는다
29. `ops/launchd/run_v2_repair_queue_firestore_canary_collector.sh` 와 optional cron manifest `v2_repair_queue_firestore_canary_collector` 로 2시간 간격 수집을 opt-in 할 수 있게 했다. 이 job은 active cron 목록에는 넣지 않아 기본 운영 watchdog가 missing으로 울지 않는다
30. collector wrapper는 기본 prefix를 `paperopcanaryv2_YYYYMMDDHHMMSS__` 로 매 run 새로 만들기 때문에, 이전 run의 `PENDING` repair request가 다음 canary를 오염시키는 위험을 줄인다
31. 2026-04-21 12:14 KST 기준 collector wrapper를 1회 실제 실행했고, latest ok=true, history 누적 2건, streak는 `MIN_RUN_COUNT` / `COVERAGE_INSUFFICIENT` 로 fail-closed 되는 정상 상태를 확인했다
32. 다만 실제 production Firestore 프로젝트에서 24시간 이상 주기 실행된 paper/live 포지션 장기 운영 증거는 아직 부족하다
33. `scripts/setup-v2-repair-firestore-canary-launchd.js` 는 기본 dry-run이며, `--install` / `--enable` / `--kickstart` 를 명시했을 때만 `~/Library/LaunchAgents` 복사와 `launchctl` 조작을 수행한다
34. setup 결과는 `ops/daily/v2_repair_queue_firestore_canary_launchd_latest.json` 에 source plist, target plist, loaded_before/after, bootstrap/enable/kickstart 결과로 남아 수동 등록 drift를 추적할 수 있다
35. 2026-04-21 기준 launchd collector의 장기 실행은 아직 opt-in 상태다. live repair preflight에 `DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED=1` 를 켜기 전에는 24시간 history coverage와 streak pass가 먼저 필요하다
36. 2026-04-21 12:21 KST 기준 `scripts/setup-v2-repair-firestore-canary-launchd.js --enable --kickstart` 를 실제 실행했고, `loaded_after=true`, `bootstrap.ok=true`, `enable.ok=true`, `kickstart.ok=true` 가 `ops/daily/v2_repair_queue_firestore_canary_launchd_latest.json` 에 기록됐다
37. 같은 시각 launchd 상태는 `runs=1`, `last exit code=0`, `run interval=7200 seconds` 로 확인됐고, collector가 `paperopcanaryv2_20260421122110__` prefix로 Firestore-backed canary 1회를 추가 실행해 history가 3건이 됐다
38. 최신 collector 실행은 `V2_REPAIR_QUEUE_FIRESTORE_CANARY_HEALTHY`, `exchange_write_performed=false`, `seed_write_n=4`, `completion_success_n=1` 이며, streak gate는 아직 `MIN_RUN_COUNT` / `COVERAGE_INSUFFICIENT` 로 fail-closed 상태다

V1 약점 재발 위험:

1. watchdog가 read-only여야 하는데 실제 운영에서 write 권한을 다시 가지면 V1처럼 truth가 분산된다
2. shadow operational canary가 있어도 실제 Firestore query / live exchange latency / launchd runtime env가 다르면 V1처럼 "테스트 통과, 운영 실패"가 다시 생길 수 있다
3. Firestore-backed canary를 실제 스케줄에 붙이지 않으면, storage adapter 경로는 검증됐지만 launchd/ADC/project/env drift는 여전히 운영에서만 드러난다
4. latest artifact만 보면 실패가 덮일 수 있으므로, live 확대 전에는 반드시 history JSONL 기반 streak gate가 통과해야 한다
5. 반복 canary가 같은 collection prefix를 쓰면 과거 `PENDING` request가 새 run을 오염시킬 수 있으므로, collector는 매 run 새 prefix를 유지해야 한다

### 단계 6A. OpenClaw Supreme Control Plane

증거:

1. `src/v2/openclawControlPlane.js`
2. `src/tests/v2-openclaw-control-plane.test.js`
3. `src/v2/openclawExecutionSeparationAudit.js`
4. `src/tests/v2-openclaw-execution-separation-audit.test.js`
5. 실행 확인: `V2_OPENCLAW_CONTROL_PLANE_TEST_OK`
6. 실행 확인: `V2_OPENCLAW_EXECUTION_SEPARATION_AUDIT_TEST_OK`

판정:

1. signal intent / feature snapshot / ML+AI evidence / strategy filter / OpenClaw decision bundle 생성은 존재한다
2. canonical evidence summary도 있다
3. OpenClaw 승인만으로 entry execution이 진행되지 않고, deterministic router와 entry execution kernel이 signal/openclaw lineage를 다시 확인하는 audit가 추가됐다
4. shadow decision / min-order hard guard block / 임의 router bypass / routed intent 없는 execution 객체 주입은 `OPENCLAW_EXECUTION_SEPARATION` audit에서 fail-closed 된다
5. `scripts/collect-v2-promotion-runtime-snapshot.js` 는 native OpenClaw decision과 signal intent를 기준으로 `openclaw_execution_separation_audits` 를 snapshot meta에 포함한다
6. `scripts/export-v2-promotion-runtime-snapshot.js` 는 해당 audits를 `openclaw_execution_separation_summary` 로 집계하고, `scripts/generate-v2-unified-promotion-report.js` 는 이를 `bounded_runtime_summary` 로 승격한다
7. `scripts/check-v2-promotion-deploy-decision.js` 는 CANARY/LIVE에서 `openclaw_execution_separation_summary.ok=true`, `audit_n>0`, `fail_n=0`, `failed_check_ids=[]` 가 없으면 `DEPLOY_DECISION:OPENCLAW_EXECUTION_SEPARATION_REQUIRED` 로 fail-closed 한다
8. `src/v2/contracts.js`, `src/v2/storage.js`, `src/v2/openclawExecutionAuditLedger.js` 로 `openclaw_execution_audits_v2` durable ledger 계약과 writer가 추가됐다
9. `DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` 이 명시된 경우에만 collector가 ledger write를 수행하고, 기본값은 `OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_DISABLED` 로 snapshot meta에 skip evidence를 남긴다
10. CANARY/LIVE deploy decision은 ledger write evidence가 없거나 `skipped=true` 이면 `DEPLOY_DECISION:OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_REQUIRED` 로 fail-closed 한다
11. Cloud Build bounded CANARY/LIVE plan과 submit substitutions는 `DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` 을 자동 전달한다
12. submit wrapper는 같은 증거를 `SUBMIT_CHK_10` 으로 재검사하고, runbook checklist `18` 로 역추적한다
13. 즉, promotion artifact 경로와 Firestore durable ledger 경로가 둘 다 존재하지만, 운영 write는 bounded 승격 경로에서만 자동 opt-in 되고 승격/submit/runbook이 같은 durable write 증거를 요구해 V1식 무심코 쓰기/비용 증가와 증거 없는 승격 위험을 동시에 줄였다
14. `repair_firestore_canary_streak` 가 unified report / deploy decision / cloudbuild summary / submit wrapper까지 전달되고, LIVE에서는 `SUBMIT_CHK_11` / runbook checklist `19` 로 하드 차단되며 CANARY에서는 warning으로만 남는다
15. 이로써 24시간 Firestore-backed repair canary streak가 준비되기 전에는 LIVE 승격이 막히고, CANARY 개발은 막지 않는 계층형 승격 정책이 생겼다
16. CANARY deploy warning은 이제 `deploy_warning_summary` / `deploy_warning_runbook_checklist` 로 submit trace와 operator summary에 남고, `READY_WITH_DEPLOY_WARNING` 으로 alert preview까지 전달된다
17. 따라서 `REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY` 가 단순 warning이라는 이유로 운영자 화면에서 묻히는 V1식 silent readiness drift 위험이 줄었다
18. `check-v2-canary-runbook` 의 `CHK_13B` 가 `promotion-deploy-decision.json.warnings` 와 `promotion-cloudbuild-context.json.deploy_decision_summary.warning_summary` / `final_status_line` 의 count/top warning 정합성을 검사하므로, warning 노출 경로 자체도 자동 검증된다
19. `submit-v2-promotion-cloudbuild` 테스트는 이제 `READY_WITH_DEPLOY_WARNING` 을 메모리 결과뿐 아니라 저장된 `promotion-cloudbuild-submit-request.json`, renderer output, CLI payload까지 end-to-end로 검증한다
20. 따라서 운영 채널이 embedded `operator_alert_preview` 를 재사용하지 않고 별도 조립하면서 warning 의미가 사라지는 V1식 drift도 더 줄었다
21. LIVE cutover readiness도 `promotion-cloudbuild-context.json` 에서 `submit_trace_summary`, `operator_summary.lines`, `operator_alert_preview.sections[].lines`, renderer output, CLI payload까지 전달된다
22. 따라서 LIVE 전환 env plan이 승인 직전 운영 채널에서 사라지는 V1식 최종 채널 관측성 단절을 더 줄였다
23. LIVE submit은 이제 `SUBMIT_CHK_12` 로 `live_cutover_readiness_summary` 자체를 필수 검증하므로, 최종 운영 채널에 `live_cutover_*` 라인이 없으면 submit이 fail-closed 된다
24. submit contract는 shared formatter뿐 아니라 operator alert preview trace section에서도 `live_cutover_*` 라인을 검사하므로, 실제 발송 직전 preview에서만 값이 사라지는 drift도 fail-closed 된다
25. LIVE scheduler/traffic readiness도 `v2_scheduler_traffic_cutover_readiness_latest.json`, `promotion-cloudbuild-context.json.scheduler_traffic_cutover_readiness_summary`, `SUBMIT_CHK_16`, runbook checklist `24`, operator summary/alert preview line set으로 연결됐다
26. 따라서 OpenClaw cron 필수 job 누락, legacy `/scheduler/tick` 활성, Cloud Run `SCHEDULER_AUTOSTART` 재활성, ready revision이 아닌 traffic 상태는 LIVE submit 전에 드러난다

### 단계 6B. ML+AI Native Signal Plane

증거:

1. `src/v2/mlAiSignalProposal.js`
2. `src/v2/signalAuthorityRouter.js`
3. `src/v2/openclawShadowWriter.js`
4. `src/v2/openclawShadowPositionWriter.js`
5. `src/v2/openclawShadowExitWriter.js`
6. `src/v2/shadowLiveComparison.js`
7. `src/v2/sourceModeComparison.js`
8. `src/v2/unifiedPromotionReport.js`
9. 관련 테스트 다수 존재

판정:

1. shadow signal proposal / router / comparison / report 계층은 상당히 진전됐다
2. 특히 bounded promotion evidence까지 이어지는 문서와 스크립트는 강하다
3. 하지만 실제 native signal live authority 자체는 아직 shadow/promotion 준비 단계에 더 가깝다
4. shadow exit writer의 TP1 경로는 보호 runtime evidence를 필수화했으므로, V1식 “무보호/부분보호 상태에서 TP1 truth만 전진”하는 위험은 shadow 경로에서 줄었다
5. fill sync shadow wrapper는 TP1이 아닌 이벤트에서 writer를 호출하지 않고, TP1 writer가 반환한 `V2_SHADOW_TP1_*` skip reason을 보존하므로 fill ingestion 계층에서 원인 추적이 끊기지 않는다
6. TP1 legacy canonical transition write는 V2 shadow TP1 gate가 성공하지 않으면 차단되므로, fill ingestion이 V2 보호 runtime gate를 우회해서 truth를 전진시키는 경로가 줄었다
7. SL/TRAIL legacy canonical transition write도 V2 shadow stop-exit gate가 성공하지 않으면 차단되므로, stop/trail 종료에서도 legacy truth 선기록 문제가 줄었다
8. EXTERNAL/MANUAL legacy canonical transition write도 V2 shadow external-close gate가 성공하지 않으면 차단되므로, 수동 개입/거래소 UI 변경이 조용히 로컬 truth로 흡수되는 문제가 줄었다

### 단계 7. Replay Gate

증거:

1. `scripts/select-v2-promotion-runtime-inputs.js`
2. `scripts/collect-v2-promotion-runtime-snapshot.js`
3. `scripts/export-v2-promotion-runtime-snapshot.js`
4. `scripts/generate-v2-replay-artifact.js`
5. `scripts/generate-v2-comparison-artifacts.js`
6. `scripts/generate-v2-unified-promotion-report.js`
7. `scripts/check-v2-promotion-deploy-decision.js`
8. `scripts/check-v2-promotion-gate.js`
9. `scripts/lib/v2-promotion-submit-trace.js`
10. `scripts/lib/v2-promotion-operator-summary.js`
11. `scripts/check-v2-promotion-submit-contract.js`
12. `scripts/lib/v2-promotion-submit-operator-alert.js`
13. `scripts/render-v2-promotion-submit-operator-alert.js`
14. `scripts/send-v2-promotion-submit-operator-alert.js`
15. `scripts/run-v2-promotion-canary-flow.js`
16. `scripts/run-v2-promotion-cloudbuild.js`
17. `scripts/submit-v2-promotion-cloudbuild.js`
18. `src/v2/replayGate.js`
19. `src/v2/replayFixtureFactory.js`
20. `src/v2/deployGate.js`
21. `scripts/generate-v2-promotion-artifacts-mock.js`
22. 관련 테스트 다수 통과

판정:

1. 이 축은 현재 V2에서 가장 강한 부분이다
2. lineage contract, evidence snapshot summary, runbook check, submit fail-closed, blocker family, runbook checklist ref까지 연결됐다
3. submit 차단 사유와 runbook 역추적, operator summary 포맷도 공용 모듈로 고정돼 있어서 V1식 채널별 drift 재발 위험을 낮췄다
4. 이제 shared formatter 참조와 submit wrapper 재정의 금지까지 별도 검사 스크립트로 fail-closed 됐다
5. 실제 운영 채널 직전 preview도 공용 모듈로 고정돼 있어, submit request를 읽는 채널이 제목/본문을 다시 조립하지 않아도 된다
6. 실제 전송 wrapper도 preview renderer 결과만 전송하도록 고정돼 있어, 전송 직전 drift 지점도 더 줄였다
7. submit artifact 안에 operator alert delivery 결과까지 남아, "보낼 예정" 과 "실제 전송 결과" 를 같은 파일에서 추적할 수 있다
8. runtime snapshot collector가 이제 `alert_retry_summary` 를 만들고 `unified-promotion-report.json` top-level 및 `bounded_runtime_summary` 에 같이 승격하므로, 운영자가 `trade_alert_outbox_v2` raw row를 직접 열지 않아도 failure family / retry policy / runbook ref를 상단 summary에서 바로 읽을 수 있다
9. deploy decision과 cloudbuild context도 이제 `alert_retry_summary` 와 `alert_retry_attention_required` 를 같이 보존하고, `final_status_line` 에 `alert_failed` / `alert_pending` 힌트를 노출하므로 submit 직전 계층에서도 alert 운영 위험이 top-level에 드러난다
10. submit wrapper의 `submit_trace_summary`, `operator_summary`, `operator_alert_preview` 도 이제 같은 alert attention 신호를 재사용하므로, V1식 "submit은 READY로 보이는데 운영 채널에서는 BLOCKED처럼 보이는" 의미 drift 위험이 더 줄었다
11. submit wrapper는 이제 `operator_alert_delivery` 와 별도로 `operator_delivery_summary` 도 남기므로, "보낼 내용" 정본과 "실제 전송 상태" 요약을 섞지 않고도 wrapper 상단 한 번에 읽을 수 있다
12. replay gate는 이제 단일 TRAIL happy path만으로 pass 되지 않는다. `TP1_REACHED`, `TRAIL_ACTIVATED`, `SL_HIT`, `TRAIL_HIT`, `EXTERNAL_CLOSE_SYNC`, `MANUAL_CLOSE_SYNC` 전 계열 coverage가 없으면 `REPLAY_TRANSITION_EVENT_MISSING:*` 로 fail-closed 된다
13. reference replay fixture는 `TRAIL_EXIT_PASS`, `SL_EXIT_PASS`, `EXTERNAL_CLOSE_PASS`, `MANUAL_CLOSE_PASS` 4개 episode로 확장됐다. 각 episode는 canonical transition, projection, exchange evidence, outbox link, protection runtime evidence, watchdog no-issue를 같이 검증한다
14. deploy gate도 `pass:true` 만 있는 stale replay report를 더 이상 신뢰하지 않는다. `transition_event_coverage` 가 없으면 `REPLAY:REPLAY_TRANSITION_EVENT_COVERAGE_REQUIRED` 로 차단한다
15. mock promotion artifact 생성기도 더 이상 손으로 만든 1-episode report를 쓰지 않고, 실제 `evaluateReplayFixtureSet(buildReferenceReplayFixtureSet(...))` 경로를 호출한다. 이로써 테스트용 mock과 실제 replay gate 사이의 V1식 drift 위험을 줄였다
16. 아직 실제 production Firestore artifact 수집과 장기 운영 증거가 부족하므로 `완료` 대신 `완료에 가까운 부분완료` 로 보는 것이 맞다

V1 약점 재발 위험:

1. 이 축 자체는 현재 가장 잘 막고 있다
2. 다만 실제 artifact를 production runtime에서 꾸준히 뽑아보지 않으면 "테스트 통과 = 운영 통과" 착시가 생길 수 있다
3. submit 차단 메시지를 실제 외부 채널이 공용 포맷터 대신 자체 문자열로 다시 만들기 시작하면, V1처럼 운영 해석 기준이 다시 갈라질 수 있다
4. replay fixture가 전 계열을 요구하더라도, production collector가 실제 Binance fill/protection evidence를 같은 schema로 수집하지 못하면 paper evidence와 live evidence가 다시 분리될 수 있다

### 단계 8. Paper / Shadow / Canary

증거:

1. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
2. `scripts/run-v2-promotion-canary-flow.js`
3. `scripts/run-v2-promotion-cloudbuild.js`
4. `scripts/submit-v2-promotion-cloudbuild.js`

판정:

1. 운영 절차와 승격 차단 문서는 있다
2. 하지만 V2 본체가 실제 paper/shadow/live runtime을 안정적으로 태우는 실운영 증거는 아직 부족하다
3. 즉, canary를 안전하게 막는 계층은 있어도 canary를 실제로 태워 돈 버는 본체는 아직 미완이다

## 현재 가장 큰 격차

1. pure module과 production orchestration 사이 간극
2. single writer 원칙이 V2 본체 실제 runtime에 관통됐는지에 대한 증거 부족
3. entry -> protection -> fill -> reducer -> tick -> alert -> watchdog -> repair 가 V2 단일 경로로 이어진 실증 부족
4. promotion tooling은 강하지만, 본체가 그만큼 강하지는 않음

## V1 약점이 다시 생길 수 있는 지점

1. V2 reducer가 있어도 production fill sync가 다른 truth를 쓰면 다시 분산된다
2. V2 protection writer가 있어도 entry bootstrap commit이 원자적으로 묶이지 않으면 half-baked active cycle이 생긴다
3. V2 tick worker가 있어도 native stop refresh 성공과 canonical trail activation이 single writer로 안 묶이면 다시 어긋난다
4. V2 alert worker가 있어도 실제 운영 outbox/telegram path가 canonical transition 하나만 보면 안 된다
5. promotion gate가 강해도, 본체 runtime이 약하면 "승격 검증만 강한 시스템"이 된다

## 다음 개발 우선순위

1. V2 entry orchestration 실체화
   `entryExecutor` + `entryProtectionHandoff` + `protectionWriter` + `storage` 를 단일 runtime 경로로 묶기
2. V2 fill -> reducer single writer 실체화
   실제 fill ingestion이 `canonicalExitReducer` 만 통하게 만들기
3. V2 tick -> protection refresh -> trail activation 실체화
   tick 평가와 native stop refresh 성공을 하나의 writer 경로로 고정하기
4. V2 alert outbox 실제 후행 worker 실체화
5. Firestore-backed paper canary를 launchd/cron opt-in으로 붙여 24시간 이상 `watchdog-generated request -> queue -> completion ledger` history를 누적
6. `check-v2-repair-queue-firestore-canary-streak` 가 통과하면 `check-v2-repair-live-cutover-readiness` 로 LIVE 전환 env plan을 산출하고, `DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED=1` 과 `DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED=1` 을 기본 운영 preflight 조건으로 승격
7. 그 다음 live repair queue service 확대

## 2026-04-21 추가 품질 게이트

1. `scripts/check-v2-repair-live-cutover-readiness.js` 를 추가했다
2. 이 스크립트는 Firestore-backed repair canary 24시간 streak artifact를 읽고 LIVE repair preflight로 전환 가능한지 판정한다
3. 준비가 안 됐으면 `V2_REPAIR_FIRESTORE_CANARY_NOT_READY_FOR_LIVE_PREFLIGHT` 와 원본 streak blocker를 그대로 남긴다
4. 준비가 됐으면 `DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED=1`, `DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED=1`, `DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED=1`, `DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED=1` 를 명시 env plan으로 산출한다
5. 중요한 제약은 `auto_apply=false`, `mutates_environment=false` 다. 즉 이 단계는 환경을 바꾸지 않고, 사람이 승인해야 하는 적용 계획만 만든다
6. runbook checklist `20` 은 이 non-mutating cutover plan을 검토하는 항목이고, `SUBMIT_CHK_11` 과 양방향으로 연결된다
7. V1 약점 재발 관점에서, "streak가 통과되면 어떤 env를 켜야 하는지 사람이 기억한다" 는 운영 의존성을 제거했다
8. `run-v2-promotion-cloudbuild` 는 LIVE deploy decision 승인 후 runbook review 전에 `v2_repair_live_cutover_readiness_latest.json` 을 자동 생성한다
9. 따라서 LIVE runbook review는 readiness artifact가 없으면 `CHK_20` 으로 실패하고, 통과해도 env는 자동 적용되지 않는다
10. `promotion-cloudbuild-context.json` 도 `live_cutover_readiness_summary` 와 `live_cutover_readiness_file` 을 상단에 보존하므로, 최상위 context만 봐도 LIVE cutover 상태를 확인할 수 있다

## 2026-04-21 Entry Boundary Deploy Gate

추가 증거:

1. `src/v2/entryBoundaryAudit.js`
2. `scripts/check-v2-entry-boundary.js`
3. `scripts/check-v2-promotion-deploy-decision.js`
4. `scripts/submit-v2-promotion-cloudbuild.js`
5. `scripts/lib/v2-promotion-submit-trace.js`
6. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`

판정:

1. V2 entry raw Binance market order write는 `src/v2/binanceEntryOrderTransport.js` 밖에서 금지된다
2. V2 protection activation direct call은 `src/v2/entrySubmitter.js` 경로 밖에서 금지된다
3. 이 검사는 이제 독립 스크립트에만 머물지 않고 `promotion-deploy-decision.json.entry_boundary_audit` 로 보존된다
4. CANARY/LIVE deploy decision은 `entry_boundary_audit.reason=V2_ENTRY_BOUNDARY_AUDIT_PASS` 가 아니면 `DEPLOY_DECISION:V2_ENTRY_BOUNDARY_AUDIT_REQUIRED` 로 fail-closed 된다
5. submit wrapper는 같은 조건을 `SUBMIT_CHK_13` 으로 다시 검증하며, runbook checklist `21` 과 양방향 trace-back 된다

V1 약점 재발 방지:

1. V1에서는 "검사는 있는데 배포 경로에서 빠지는" 우회가 반복됐다
2. 이번 단계에서는 entry boundary audit를 deploy decision, submit contract, runbook reverse index까지 연결했다
3. 따라서 V2 entry 소유권이 깨지면 배포 판단과 submit 판단 양쪽에서 동시에 드러난다
4. 남은 한계는 이 경계가 현재 `src/v2` 내부를 잠근다는 점이다. V1 legacy runtime을 실제로 내리는 cutover 전에는 production route/scheduler 차단이 별도 필요하다

## 2026-04-21 Production Cutover Guard

추가 증거:

1. `src/v2/productionCutoverGuard.js`
2. `src/v2/productionCutoverAudit.js`
3. `scripts/check-v2-production-cutover.js`
4. `src/routes/webhook.routes.js`
5. `src/tests/v2-production-cutover-guard.test.js`
6. `src/tests/v2-production-cutover-audit.test.js`

판정:

1. 기본 운영값에서는 legacy `/webhook/signal` 을 막지 않는다
2. `DONBEOLJA_V2_ENABLED=1`, `DONBEOLJA_V2_DRY_RUN=0`, `DONBEOLJA_V2_CANARY_ONLY=0` 이 되면 legacy webhook signal route는 기본적으로 `V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED` 로 차단된다
3. 차단은 단순 403/409 응답으로 끝나지 않고 기존 webhook outcome ledger 경로에 `decision=DROP`, `reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED`, `event=V2_CUTOVER_GUARD_BLOCK` 으로 남는다
4. `DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=1` 이 켜진 상태에서 V2가 disabled/dry-run/canary-only면 각각 별도 blocker reason으로 실패한다
5. 긴급 운영 override는 `DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL=1` 하나로만 허용된다
6. `npm run check:v2-production-cutover` 는 static contract를 검사하고, `DONBEOLJA_V2_PRODUCTION_CUTOVER_READINESS_CHECK=1` 이면 실제 env readiness까지 검사한다

V1 약점 재발 방지:

1. V1에서는 새 경로를 만들고도 기존 webhook/scheduler가 살아 있어 두 entry authority가 동시에 존재할 위험이 있었다
2. 이번 단계에서는 full V2 cutover 조건에서 legacy webhook 자체가 opt-out 되지 않는 한 실행되지 않는다
3. route 코드, guard module, audit script, 단위 테스트가 같은 reason code를 보므로 "문서상 cutover" 와 "실제 runtime route" 가 분리되는 위험을 줄였다
4. 남은 한계는 Cloud Scheduler / Cloud Run env 배포 설정에 아직 이 readiness check를 기본 fail-closed로 강제하지 않았다는 점이다
5. 다음 단계는 promotion deploy decision 또는 Cloud Build submit contract에 production cutover readiness evidence를 연결하는 것이다

## 2026-04-21 Production Cutover Deploy/Submit Gate

추가 증거:

1. `scripts/check-v2-promotion-deploy-decision.js`
2. `scripts/submit-v2-promotion-cloudbuild.js`
3. `scripts/lib/v2-promotion-submit-trace.js`
4. `scripts/check-v2-canary-runbook.js`
5. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
6. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. deploy decision artifact는 이제 `production_cutover_audit` 를 top-level 증거로 보존한다
2. CANARY/LIVE deploy decision은 `production_cutover_audit.reason=V2_PRODUCTION_CUTOVER_AUDIT_PASS` 가 아니면 `DEPLOY_DECISION:V2_PRODUCTION_CUTOVER_AUDIT_REQUIRED` 로 fail-closed 된다
3. submit wrapper의 bounded approval contract는 `approval_contract.production_cutover_audit_required=true` 를 요구한다
4. submit verification은 `SUBMIT_CHK_14` 로 `promotion-deploy-decision.json.production_cutover_audit` 를 다시 읽는다
5. runbook checklist `22` 는 같은 증거를 문서에서 역추적한다
6. submit trace index도 `SUBMIT_CHK_14 -> runbook 22` 로 연결됐다

V1 약점 재발 방지:

1. V1에서는 새 안전장치를 만들어도 배포/submit 경로가 그 안전장치를 요구하지 않으면 우회가 가능했다
2. 이번 단계에서는 production cutover guard가 route에 실제로 연결돼 있는지 deploy decision, submit verification, runbook review가 모두 같은 증거로 확인한다
3. 테스트 fixture도 `production_cutover_audit` 를 넣지 않으면 CHK_22에서 실패하므로, 느슨한 테스트가 실제 계약을 숨기는 문제가 줄었다
4. 이 단계의 남은 한계였던 full LIVE env readiness submit 증거는 다음 섹션의 `SUBMIT_CHK_15` 로 보강했다
5. 따라서 production cutover guard는 static audit와 LIVE env readiness audit 두 층으로 분리돼 검증된다

## 2026-04-21 LIVE Production Cutover Readiness Gate

추가 증거:

1. `scripts/run-v2-promotion-cloudbuild.js`
2. `scripts/submit-v2-promotion-cloudbuild.js`
3. `scripts/check-v2-canary-runbook.js`
4. `scripts/lib/v2-promotion-operator-summary.js`
5. `scripts/lib/v2-promotion-submit-operator-alert.js`
6. `scripts/lib/v2-promotion-submit-trace.js`
7. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
8. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. LIVE cloudbuild wrapper는 deploy decision 승인 후 runbook review 전에 `v2_production_cutover_readiness_latest.json` 을 생성한다
2. 같은 결과는 `promotion-cloudbuild-context.json.production_cutover_readiness_summary` 와 `production_cutover_readiness_file` 로 상단 보존된다
3. LIVE submit은 `approval_contract.production_cutover_readiness_summary_required=true` 를 요구한다
4. submit verification은 `SUBMIT_CHK_15` 로 `reason=V2_PRODUCTION_CUTOVER_READINESS_PASS`, `guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED`, `legacy_webhook_blocked=true` 를 다시 검증한다
5. runbook checklist `23` 과 submit trace index `SUBMIT_CHK_15 -> runbook 23` 이 같은 증거를 역추적한다
6. operator summary와 alert preview는 `production_cutover_ready`, `production_cutover_legacy_blocked`, `production_cutover_guard_reason`, `production_cutover_file` 을 같은 line set으로 노출한다

V1 약점 재발 방지:

1. V1에서는 "새 경로가 준비됐다" 와 "기존 경로가 실제로 닫혔다" 가 별도 증거 없이 섞였다
2. 이번 단계에서는 LIVE 승격 직전에 V2 full env 조건과 legacy webhook 차단 결과를 submit/runbook/alert까지 같은 증거로 연결한다
3. 따라서 full LIVE 모드에서 legacy `/webhook/signal` 이 살아 있으면 배포 제출 전에 `SUBMIT_CHK_15`/runbook 23으로 드러난다
4. 남은 한계였던 Scheduler traffic 전환 증거는 다음 섹션의 `SUBMIT_CHK_16` 으로 보강했다

## 2026-04-21 Production Runtime Config Contract

추가 증거:

1. `src/v2/productionRuntimeConfigAudit.js`
2. `scripts/check-v2-production-runtime-config.js`
3. `src/tests/v2-production-runtime-config-audit.test.js`
4. `cloudbuild.yaml`
5. `package.json`
6. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
7. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. `cloudbuild.yaml` 은 이제 V2 cutover용 substitution을 가진다
2. 기본값은 `DONBEOLJA_V2_ENABLED=0`, `DONBEOLJA_V2_DRY_RUN=1`, `DONBEOLJA_V2_CANARY_ONLY=1`, `DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=0` 이라서 실수로 LIVE 전환되지 않는다
3. main Cloud Run 서비스와 exit-worker 서비스 모두 `DONBEOLJA_V2_*` cutover env를 substitution에서 받는다
4. `DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=OPENCLAW_CRON` 과 `SCHEDULER_AUTOSTART=0` 도 같은 계약에 포함된다
5. Cloud Build promotion runtime은 `_DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON` 을 `DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON` 으로 전달할 수 있어야 한다
6. Cloud Build validation step은 deploy 전에 `npm run check:v2-production-runtime-config` 를 실행한다
7. Cloud Build promotion runtime은 `gcloud` 와 `node/npm` 을 같은 step에서 사용할 수 있어야 하며, 이 조건은 `CLOUDBUILD_PROMOTION_RUNTIME_HAS_GCLOUD_AND_NODE` 로 검증된다
8. 이 검사가 실패하면 "submit readiness는 pass인데 실제 Cloud Run env에는 값이 안 들어가는" V1식 설정 drift와 "collector는 붙였지만 Cloud Build 컨테이너에서 gcloud가 없어 LIVE에서만 실패하는" 환경 drift를 배포 전에 차단한다

V1 약점 재발 방지:

1. V1에서는 코드/문서/운영 env가 별도 변경면으로 움직여서 "어제와 오늘 무엇이 달라졌는지"를 한 번에 증명하기 어려웠다
2. 이번 단계에서는 V2 cutover env 통로 자체를 코드 감사 대상으로 만들었다
3. 따라서 LIVE readiness가 의미 있으려면 Cloud Build deploy env도 같은 값을 받을 수 있어야 한다는 전제가 기계 검증된다
4. 서버 내장 scheduler는 `SCHEDULER_AUTOSTART=0` 으로 고정하고, scheduler 정본은 `OPENCLAW_CRON` 으로 표시한다
5. Cloud Scheduler/traffic 상태 자체는 `scheduler_traffic_cutover_readiness` artifact로 들어왔지만, 아직 이 상태 JSON을 자동 수집하는 GCP collector는 다음 단계로 남아 있다

## 2026-04-21 Scheduler Traffic Cutover Readiness Gate

추가 증거:

1. `src/v2/schedulerTrafficCutoverAudit.js`
2. `scripts/check-v2-scheduler-traffic-cutover.js`
3. `src/v2/schedulerTrafficStateCollector.js`
4. `scripts/collect-v2-scheduler-traffic-state.js`
5. `scripts/run-v2-promotion-cloudbuild.js`
6. `scripts/submit-v2-promotion-cloudbuild.js`
7. `scripts/check-v2-canary-runbook.js`
8. `scripts/lib/v2-promotion-submit-trace.js`
9. `scripts/lib/v2-promotion-operator-summary.js`
10. `scripts/lib/v2-promotion-submit-operator-alert.js`
11. `src/tests/v2-scheduler-traffic-cutover-audit.test.js`
12. `src/tests/v2-scheduler-traffic-state-collector.test.js`

판정:

1. LIVE cloudbuild wrapper는 deploy decision 승인 후 `v2_scheduler_traffic_cutover_readiness_latest.json` 을 생성할 수 있다
2. readiness는 `scheduler_sot=OPENCLAW_CRON`, 필수 OpenClaw cron job enabled, legacy scheduler tick inactive, main/exit-worker Cloud Run env와 traffic readiness를 검사한다
3. LIVE submit은 `approval_contract.scheduler_traffic_cutover_readiness_summary_required=true` 를 요구한다
4. submit verification은 `SUBMIT_CHK_16` 으로 같은 summary를 다시 검증하고, runbook checklist `24` 로 역추적한다
5. operator summary와 alert preview는 `scheduler_traffic_ready`, `scheduler_traffic_sot`, `scheduler_traffic_legacy_active`, `scheduler_traffic_file` 을 같은 line set으로 노출한다
6. `collect-v2-scheduler-traffic-state` 는 GCP Cloud Run service/env/traffic, Cloud Scheduler job 목록, OpenClaw cron manifest를 모아 readiness 입력 상태를 생성한다
7. `check-v2-scheduler-traffic-cutover` 와 LIVE cloudbuild wrapper는 inline state JSON이 없으면 collector를 통해 상태를 자동 수집한다
8. `check-v2-scheduler-traffic-collector-prereq` 는 collector 실행 주체가 project resolve, Cloud Scheduler jobs list, Cloud Run service describe 권한을 갖는지 별도 fail-closed로 검증한다
9. `promotion-cloudbuild-context.json` 은 이제 `scheduler_traffic_collector_preflight_summary` 와 `scheduler_traffic_cutover_readiness_summary` 를 분리 보존한다
10. LIVE submit trace/operator alert는 `scheduler_collector_preflight`, `scheduler_collector_project`, `scheduler_collector_file` 을 별도 라인으로 노출하므로, 권한/환경 실패와 scheduler 상태 실패를 운영자가 한 화면에서 구분할 수 있다
11. `SUBMIT_CHK_17` 은 `SCHEDULER_COLLECTOR_BLOCKER`, `SUBMIT_CHK_16` 은 `SCHEDULER_TRAFFIC_BLOCKER` 로 분리되며 더 이상 `PRODUCTION_CUTOVER_BLOCKER` 로 뭉개지지 않는다
12. LIVE cloudbuild wrapper는 scheduler collector preflight 실패 시에도 `promotion-cloudbuild-context.json` 을 다시 써서 `scheduler_traffic_collector_preflight_summary.ok=false`, `failed_check_ids`, collector artifact 경로를 보존한다
13. LIVE cloudbuild wrapper는 live cutover readiness 또는 production cutover readiness 실패 시에도 `promotion-cloudbuild-context.json` 을 다시 써서 해당 summary의 `ok=false`, 실패 reason/check id, artifact 경로를 보존한다
14. bounded wrapper는 runbook review 성공/실패 모두 `promotion-cloudbuild-context.json` 에 `runbook_review_summary` 로 보존하며, 실패 시 `failed_check_ids` 와 `top_failed_checks[]` 로 문서 -> 코드 trace-back을 유지한다
15. runbook review 생성 전 throw도 synthetic `CHK_RUNBOOK_REVIEW_THROWN` 으로 변환해 context에 남기므로 artifact 누락/파싱 실패가 스택트레이스에만 갇히지 않는다
16. submit wrapper의 operator summary와 Telegram preview trace는 runbook review 결과를 `runbook_review`, `runbook_review_failures`, `runbook_review_failed_checks`, `runbook_review_file` 로 같이 노출한다

V1 약점 재발 방지:

1. V1에서는 scheduler/traffic 상태가 코드 설정과 분리되어, 코드상 안전해도 실제 tick source가 살아 있으면 다시 중복 실행될 수 있었다
2. 이번 단계에서는 LIVE 승격 직전에 실제 scheduler/traffic state 증거가 없으면 submit이 fail-closed 된다
3. collector가 `gcloud` 기반이라는 한계는 남아 있지만, 이제 권한 부족은 readiness 오판이 아니라 `SCHED_TRAFFIC_COLLECTOR_PREREQ_*` 및 `SUBMIT_CHK_17` 로 분리되어 드러난다
4. 실패 중단 시에도 최종 context artifact가 원인을 보존하므로, V1처럼 “실패했지만 operator가 어느 계열을 봐야 하는지 모르는 상태”로 떨어지지 않는다
5. LIVE 승격 중단은 live cutover, production cutover, scheduler collector, scheduler traffic 중 어느 단계든 같은 context artifact 관측 규칙을 따른다
6. 마지막 runbook review 단계도 같은 관측 규칙을 따르므로, 모든 readiness가 통과한 뒤 최종 checklist에서 막혀도 실패한 checklist id/file/field가 context에 남는다
7. runbook review 파일 자체가 만들어지지 못하는 경우도 `CHK_RUNBOOK_REVIEW_THROWN` 으로 정규화되어, operator가 어떤 artifact 누락/파싱 오류인지 context에서 바로 볼 수 있다
8. context에 남은 runbook review 원인은 submit request와 operator alert preview까지 전파되어, 파일을 별도로 열지 않아도 마지막 실패 계열을 즉시 볼 수 있다

## 2026-04-21 Fill Sync Canonical Boundary Gate

추가 증거:

1. `src/v2/fillSyncCanonicalBoundaryAudit.js`
2. `scripts/check-v2-fill-sync-canonical-boundary.js`
3. `src/tests/v2-fill-sync-canonical-boundary-audit.test.js`
4. `src/tests/check-v2-promotion-deploy-decision.test.js`
5. `cloudbuild.yaml`
6. `package.json`

판정:

1. fill sync canonical boundary audit는 `binanceFuturesFillsSync` 가 V2 `exitFillIngestion` 을 연결하고 있는지 검사한다
2. legacy canonical transition 기록은 `recordCanonicalExitTransitionsForFill` wrapper 한 곳으로 제한되어야 한다
3. TP1 / SL-TRAIL / EXTERNAL-MANUAL legacy gate는 모두 `validateV2ShadowCanonicalBatchWrite` 를 호출해야 한다
4. `ok=true, written=true` 만으로는 부족하고, `write_mode=BATCH` 와 `CANONICAL_EXIT_TRANSITIONS`, `EXIT_RUNTIME_PROJECTIONS`, `TRADE_ALERT_OUTBOX` write evidence가 있어야 한다
5. deploy decision artifact는 이제 `fill_sync_canonical_boundary_audit` 를 top-level 증거로 보존한다
6. CANARY/LIVE deploy decision은 이 audit가 통과하지 않으면 `DEPLOY_DECISION:V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_REQUIRED` 로 fail-closed 된다
7. Cloud Build validation step은 promotion cloudbuild wrapper 전에 `npm run check:v2-fill-sync-canonical-boundary` 를 실행한다

V1 약점 재발 방지:

1. V1에서는 fill sync 내부에 stage 추론, canonical transition 기록, alert/stage hint가 얽혀 있어서 나중에 작은 fallback 하나가 전체 정본을 우회할 수 있었다
2. 이번 단계에서는 최소한 legacy fill sync가 V2 batch 정본 증거 없이 canonical 기록을 전진시키는 회귀를 static audit와 deploy decision 양쪽에서 막는다
3. 아직 legacy canonical 기록 자체를 완전히 제거한 것은 아니므로, 최종 목표는 production fill path를 `exitFillIngestion -> canonical reducer -> V2 batch writer` 한 경로로 수렴시키는 것이다

## 2026-04-21 Submit Trace-Back for Fill Sync Boundary

추가 증거:

1. `scripts/submit-v2-promotion-cloudbuild.js`
2. `scripts/lib/v2-promotion-submit-trace.js`
3. `scripts/check-v2-canary-runbook.js`
4. `scripts/check-v2-promotion-submit-contract.js`
5. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
6. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
7. `src/tests/submit-v2-promotion-cloudbuild.test.js`
8. `src/tests/check-v2-canary-runbook.test.js`

판정:

1. submit approval contract는 이제 `approval_contract.fill_sync_canonical_boundary_audit_required=true` 를 요구한다
2. submit evidence source는 `approval_evidence_sources.fill_sync_canonical_boundary_audit` 로 `promotion-deploy-decision.json` 의 top-level field를 가리킨다
3. submit verification은 `SUBMIT_CHK_18` 로 `fill_sync_canonical_boundary_audit` 를 다시 검증한다
4. `SUBMIT_CHK_18` 실패는 `FILL_SYNC_CANONICAL_BOUNDARY_BLOCKER` 로 분류되고, 권장 조치는 `FIX_V2_FILL_SYNC_CANONICAL_BOUNDARY_AND_RECHECK_DEPLOY_DECISION` 이다
5. runbook checklist `25` 는 같은 artifact/field/expected value를 문서에서 직접 역추적한다
6. runbook reverse index는 `SUBMIT_CHK_18 -> 25` 를 제공하므로 submit 차단에서 operator가 다시 봐야 할 항목이 한 번에 드러난다
7. canary runbook automated review도 `CHK_25` 로 같은 artifact를 검사한다
8. submit contract checker는 runbook, artifact contract, submit wrapper가 모두 `SUBMIT_CHK_18` 경계를 참조하는지 확인한다

V1 약점 재발 방지:

1. V1에서는 “검사 스크립트는 있는데 최종 submit 경로가 그 결과를 보지 않는” 단절이 반복됐다
2. 이번 단계에서는 fill sync canonical boundary audit가 deploy decision에만 머물지 않고 submit approval contract, submit verification, runbook checklist, reverse index까지 연결된다
3. 따라서 legacy fill sync가 V2 batch canonical evidence 없이 canonical 기록을 전진시키는 회귀는 승격 직전 `SUBMIT_CHK_18` 로 fail-closed 된다

## 2026-04-21 Reduced Fill Writer Boundary

추가 증거:

1. `src/v2/openclawShadowExitWriter.js`
2. `src/v2/exitFillIngestion.js`
3. `src/v2/fillSyncCanonicalBoundaryAudit.js`
4. `src/tests/v2-openclaw-shadow-exit-writer.test.js`
5. `src/tests/v2-openclaw-shadow-stop-exit-writer.test.js`
6. `src/tests/v2-exit-fill-ingestion.test.js`
7. `src/tests/v2-fill-sync-canonical-boundary-audit.test.js`

판정:

1. TP1, SL/TRAIL final exit, EXTERNAL/MANUAL close shadow writer는 이제 `commitReducedExitFillArtifacts` 경계를 거친다
2. 이 경계는 `reduceV2ExitFill` 을 호출해 canonical transition, next projection, prepared alert를 한 번에 산출한다
3. 산출된 transition/projection/outbox는 `commitCanonicalExitArtifacts -> putV2DocsBatch` 로 한 배치에 기록된다
4. STOP/EXTERNAL/MANUAL source exchange evidence는 `exitFill.raw_payload` 로 보존되어 transition의 `source_exchange_evidence.raw_payload` 에 복원된다
5. TP1 writer도 transition에 `source_exchange_evidence.evidence_kind=TP1_FILL` 을 남긴다
6. fill sync canonical boundary audit는 이제 shadow writer가 `reduceV2ExitFill` 과 `commitReducedExitFillArtifacts` 를 쓰는지도 검사한다

V1 약점 재발 방지:

1. V1에서는 TP1, stop, external close가 서로 다른 코드 조각에서 canonical reducer와 alert/write를 따로 구성했다
2. 그 결과 TP1 알림 누락, native protection 불일치, legacy fill sync fallback 같은 문제가 서로 다른 레이어에서 반복됐다
3. 이번 단계에서는 fill 기반 exit는 공통 reducer 경계를 통과해야 하므로, transition/projection/outbox 계산이 다시 갈라질 가능성을 줄였다
4. 아직 TRAIL_ACTIVATED 는 fill event가 아니라 stop refresh confirmation 성격이라 `reduceCanonicalExit` 직접 호출을 유지한다
5. 다음 목표는 legacy fill sync의 `recordCanonicalExitTransitionsForFill` 자체를 최종적으로 read-only/backfill 성격으로 낮추고, V2 reduced writer 결과를 본선 canonical source로 승격하는 것이다

## 2026-04-21 Legacy Canonical Backfill Downgrade

추가 증거:

1. `src/services/binanceFuturesFillsSync.js`
2. `src/v2/fillSyncCanonicalBoundaryAudit.js`
3. `src/tests/binance-fills-canonical-lineage-guard.test.js`
4. `src/tests/v2-fill-sync-canonical-boundary-audit.test.js`

판정:

1. `resolveLegacyCanonicalWriteDecision` 을 추가해 legacy canonical transition/stage-hint write 여부를 한 곳에서 결정한다
2. V2 shadow writer가 `V2_SHADOW_TP1_BATCH_WRITTEN`, `V2_SHADOW_STOP_EXIT_BATCH_WRITTEN`, `V2_SHADOW_EXTERNAL_CLOSE_BATCH_WRITTEN` 중 하나를 증명하면 legacy canonical write는 기본적으로 `V2_BATCH_CANONICAL_ALREADY_WRITTEN` 으로 skip 된다
3. V2 disabled/dry-run/shadow-write-disabled/canary-filtered 상태에서는 기존 legacy canonical write가 `LEGACY_CANONICAL_WRITE_ALLOWED` 로 유지된다
4. 의도적 backfill은 `DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED=1` 일 때만 `LEGACY_CANONICAL_BACKFILL_ENABLED` 로 허용된다
5. legacy canonical write가 skip 되면 `promotePositionStageHintsFromExternalExit` 도 같이 skip 되어 V1 stage hint가 V2 canonical projection과 다시 경쟁하지 않는다
6. fill sync canonical boundary audit는 이제 legacy canonical이 V2 batch 이후 기본 skip 되는지 검사한다

V1 약점 재발 방지:

1. V1의 핵심 문제는 canonical transition, stage hint, alert outbox가 서로 다른 writer에서 동시에 진실처럼 행동한 것이다
2. 이번 단계에서는 V2 batch canonical write가 성공한 fill에 대해 legacy canonical/stage-hint write를 기본적으로 중단한다
3. 따라서 운영 중 같은 체결이 V2 projection과 V1 stage hint를 동시에 전진시키며 서로 다른 상태를 만드는 위험을 줄였다
4. 완전 제거가 아니라 backfill env로만 열어둔 이유는 과거 데이터 복구와 V2 off fallback을 보존하기 위함이다

## 2026-04-21 Canonical Outbox Evidence Lock

추가 증거:

1. `src/v2/fillSyncCanonicalBoundaryAudit.js`
2. `src/tests/v2-fill-sync-canonical-boundary-audit.test.js`
3. `src/tests/v2-openclaw-shadow-exit-writer.test.js`
4. `src/tests/v2-openclaw-shadow-stop-exit-writer.test.js`
5. `src/tests/v2-openclaw-shadow-trail-writer.test.js`

판정:

1. TP1, SL/TRAIL final, EXTERNAL/MANUAL, TRAIL_ACTIVATED writer 결과는 `write_mode=BATCH` 를 반환해야 한다
2. writer 결과의 `canonical_transition_id` 는 persisted transition doc id와 같아야 한다
3. writer 결과의 `alert_outbox_id` 는 persisted outbox doc id와 같아야 한다
4. persisted outbox의 `canonical_transition_id`, `prepared_payload.canonical_transition_id`, `delivery_request.dedupeFingerprint` 는 모두 같은 transition id여야 한다
5. batch write evidence에는 `CANONICAL_EXIT_TRANSITIONS`, `EXIT_RUNTIME_PROJECTIONS`, `TRADE_ALERT_OUTBOX` 가 반드시 포함되어야 한다
6. fill sync canonical boundary audit는 reduced fill writer가 `canonical_transition_id`, `alert_outbox_id`, `write_mode`, `writes` 를 operator evidence로 반환하지 않으면 fail-closed 된다

V1 약점 재발 방지:

1. V1에서는 실제 상태 전이와 알림/운영 증거가 서로 다른 레이어에서 만들어져 TP1 처리 후 알림만 사라지는 문제가 발생했다
2. 이번 단계에서는 operator가 보는 outbox, delivery fingerprint, batch write evidence가 canonical transition id 하나로 묶여야 한다
3. 따라서 상태는 전진했는데 알림/outbox가 다른 이벤트를 가리키거나, 운영자가 어떤 transition이 알림을 만들었는지 추적하지 못하는 회귀를 테스트와 static audit에서 동시에 막는다

## 2026-04-21 Runtime Chain Promotion Evidence

추가 증거:

1. `scripts/export-v2-promotion-runtime-snapshot.js`
2. `scripts/generate-v2-unified-promotion-report.js`
3. `scripts/check-v2-promotion-deploy-decision.js`
4. `scripts/check-v2-canary-runbook.js`
5. `src/tests/export-v2-promotion-runtime-snapshot.test.js`
6. `src/tests/generate-v2-unified-promotion-report.test.js`
7. `src/tests/check-v2-promotion-deploy-decision.test.js`
8. `src/tests/check-v2-canary-runbook.test.js`

판정:

1. runtime snapshot exporter는 `snapshot_meta.runtime_chain_audit_summary` 또는 `runtime_chain_audits[]` 를 `promotion-runtime-manifest.json.snapshot_meta.runtime_chain_audit_summary` 로 정규화한다
2. unified promotion report는 이 값을 `bounded_runtime_summary.runtime_chain_audit_summary` 로 보존한다
3. CANARY/LIVE deploy decision은 `runtime_chain_audit_summary.ok=true`, `check_n > 0`, `fail_n=0`, `failed_check_ids=[]` 가 아니면 `DEPLOY_DECISION:RUNTIME_CHAIN_AUDIT_REQUIRED` 로 fail-closed 된다
4. canary runbook review는 `CHK_26` 으로 같은 필드를 직접 확인한다
5. runbook matrix에는 `SUBMIT_CHK_04B -> 14A` 역추적을 추가했다

V1 약점 재발 방지:

1. V1에서는 runtime chain 검사가 코드/테스트에 있어도 최종 승격 산출물에서 빠지면 배포 차단력이 없었다
2. 이번 단계에서는 entry/protection/reducer/alert chain 감사 결과가 `promotion-runtime-manifest -> unified report -> deploy decision -> runbook` 으로 이어져야 한다
3. 따라서 “테스트는 통과했지만 실제 승격 artifact에는 chain 증거가 없는” 상태를 CANARY/LIVE에서 차단한다

## 2026-04-21 Runtime Candidate Replay Scope Separation

추가 증거:

1. `src/v2/replayGate.js`
2. `src/v2/deployGate.js`
3. `scripts/export-v2-promotion-runtime-snapshot.js`
4. `scripts/collect-v2-promotion-runtime-snapshot.js`
5. `src/tests/v2-replay-gate.test.js`
6. `src/tests/v2-deploy-gate.test.js`
7. `src/tests/export-v2-promotion-runtime-snapshot.test.js`
8. `src/tests/run-v2-promotion-pipeline.test.js`

판정:

1. reference replay는 계속 `TP1_REACHED`, `TRAIL_ACTIVATED`, `SL_HIT`, `TRAIL_HIT`, `EXTERNAL_CLOSE_SYNC`, `MANUAL_CLOSE_SYNC` 전체 event family coverage를 요구한다
2. runtime candidate replay는 `replay_context.scope=RUNTIME_CANDIDATE` 와 `require_transition_event_coverage=false` 를 명시해 단일 실거래 canary cycle에 전체 terminal family를 요구하지 않는다
3. runtime candidate가 coverage를 생략하더라도 episode 자체의 entry/protection/reducer/projection/outbox/watchdog 무결성 검사는 그대로 유지한다
4. deploy gate는 `transition_event_coverage_required=false` 인 replay report에 대해 stale full-coverage blocker만 생략하고, episode blocker와 runtime chain audit blocker는 계속 차단한다
5. collector는 단일 collected episode에 대해 runtime chain audit summary를 같이 만들고, exporter/unified/deploy decision 경로로 보존한다

V1 약점 재발 방지:

1. V1에서는 서로 다른 목적의 gate가 한 기준으로 섞여 실제 운영 가능한 단일 이벤트를 false-block 하거나, 반대로 넓은 회귀 테스트를 운영 증거처럼 오해할 수 있었다
2. 이번 단계에서는 full reference replay와 single runtime candidate replay의 책임을 분리했다
3. 따라서 “단일 canary cycle이 모든 종료 계열을 한 번에 보여야 한다” 는 불가능한 요구로 승격이 막히는 문제를 제거하면서도, reference replay의 전 계열 회귀 방어는 유지한다

## 2026-04-21 TP1 Repair Target Contract

추가 증거:

1. `src/v2/contracts.js`
2. `src/v2/entryBootstrap.js`
3. `src/v2/repairExecutor.js`
4. `src/v2/watchdog.js`
5. `src/tests/v2-entry-bootstrap.test.js`
6. `src/tests/v2-repair-delegated-executor.test.js`
7. `src/tests/v2-repair-queue-worker.test.js`
8. `src/tests/v2-repair-queue-live-worker.test.js`
9. `src/tests/v2-watchdog-repair-runtime.test.js`

판정:

1. `exit_runtime_projection_v2` 는 이제 `tp1_target_price` 와 `tp1_target_qty_abs` 를 분리 보존한다
2. entry bootstrap은 initial protection plan의 `tp1_trigger_price` 를 projection의 `tp1_target_price` 로 같이 고정한다
3. canonical reducer와 tick worker는 projection을 재작성할 때 `tp1_target_price` 를 보존한다
4. watchdog가 `TP1_ORDER_MISSING` repair request를 만들 때 `tp1_target_price` 와 `tp1_qty_abs` 를 detail에 같이 싣는다
5. repair executor는 `TP1_ORDER_MISSING` 을 `PLACE_OR_REPLACE_TP1` 로 바꿀 때 가격과 수량을 별도 필드로 요구한다
6. 가격이 없고 수량만 있는 TP1 repair는 `TP1_REPAIR_TARGET_PRICE_REQUIRED` 로 fail-closed 된다

V1 약점 재발 방지:

1. V1의 반복 장애 중 하나는 TP1 주문이 없을 때 각 레이어가 “무엇을 얼마에, 몇 개 걸어야 하는지”를 다시 추론했다는 점이다
2. 이번 단계에서는 TP1 목표 가격과 TP1 절대 수량을 runtime projection/repair command에서 분리했다
3. 따라서 실제 TP1 repair transport가 붙을 때 가격 자리에 수량이 들어가는 치명적 오류를 사전에 차단한다

## 2026-04-21 TP1 Repair Execution Path

추가 증거:

1. `src/v2/protectionWriter.js`
2. `src/v2/watchdogRepairRuntime.js`
3. `src/v2/repairDelegatedExecutor.js`
4. `src/v2/binanceProtectionTransport.js`
5. `scripts/run-v2-repair-queue-service.js`
6. `src/tests/v2-protection-writer.test.js`
7. `src/tests/v2-watchdog-repair-runtime.test.js`
8. `src/tests/v2-repair-delegated-executor.test.js`
9. `src/tests/v2-binance-protection-transport.test.js`
10. `src/tests/run-v2-repair-queue-service.test.js`

판정:

1. `TP1_ORDER_MISSING` repair는 이제 generic callback으로만 남지 않고 `PLACE_OR_REPLACE_TP1` writer command를 만든다
2. writer command는 `symbol`, `position_side`, `close_side`, `trigger_price`, `quantity_abs`, `client_order_key` 를 명시한다
3. `repairDelegatedExecutor` 는 `PLACE_OR_REPLACE_TP1` 을 별도 분기로 처리하고, `placeOrReplaceTp1` transport ack를 `finalizeTp1RepairPlacement` 로 닫는다
4. `finalizeTp1RepairPlacement` 는 기존 SL/native stop evidence를 보존하면서 TP1 order evidence만 갱신한다
5. TP1 repair 성공 시 `TP1_ORDER_MISSING` issue가 제거되고, 남은 issue가 없으면 `HEALTHY / ok=true` 가 된다
6. TP1 repair 실패 시 `TP1_REPAIR_FAILED`, `TP1_ORDER_MISSING`, `requires_repair=true` 로 남는다
7. Binance transport는 `TAKE_PROFIT_MARKET`, `reduceOnly=true`, `closePosition=false`, `workingType=MARK_PRICE`, `priceProtect=true` 계약으로 TP1 repair order를 제출한다
8. repair queue service의 Binance binding은 이제 `refreshNativeStop` 과 `placeOrReplaceTp1` 을 같은 delegated executor에 제공한다

V1 약점 재발 방지:

1. V1에서는 watchdog가 `TP1_ORDER_MISSING` 을 감지해도 실패 처리나 수동 청산으로 흐르기 쉬웠다
2. 이번 단계에서는 `TP1_ORDER_MISSING` 이 repair request -> writer delegation -> Binance TP1 transport -> protection runtime finalize 로 이어지는 명시 경로를 갖는다
3. 따라서 “실패를 청산으로 처리”하는 대신 “복구 가능한 보호주문 결함은 복구 경로로 보낸다”는 V2 원칙에 더 가까워졌다

## 냉정한 결론

현재 V2는 "안전한 승격 검증 프레임" 으로는 많이 왔다.

하지만 "V1를 내려도 되는 실전 본체" 라고 말하기에는 아직 이르다.

가장 위험한 착시는 아래 두 가지다.

1. 테스트가 많으니 본체도 거의 됐다고 착각하는 것
2. promotion tooling이 강하니 runtime도 강할 것이라고 착각하는 것

지금은 둘 다 아니다.

정확한 표현은 아래가 맞다.

1. V2 contract/promotion/gate 계층: 강함
2. V2 production execution kernel 계층: 아직 중반 이하

## 2026-04-21 Full Protection Repair Execution Path

추가 증거:

1. `src/v2/repairExecutor.js`
2. `src/v2/protectionWriter.js`
3. `src/v2/watchdogRepairRuntime.js`
4. `src/v2/repairDelegatedExecutor.js`
5. `src/v2/binanceProtectionTransport.js`
6. `scripts/run-v2-repair-queue-service.js`
7. `src/tests/v2-protection-writer.test.js`
8. `src/tests/v2-watchdog-repair-runtime.test.js`
9. `src/tests/v2-repair-delegated-executor.test.js`
10. `src/tests/v2-binance-protection-transport.test.js`

판정:

1. `UNPROTECTED_ACTIVE_POSITION / ENSURE_FULL_PROTECTION` 은 더 이상 generic fallback action으로만 남지 않는다
2. repair executor는 runtime 상태를 보고 필요한 leg만 선택한다
3. SL/native stop이 이미 정상이고 TP1만 없으면 SL을 재발행하지 않고 TP1만 복구한다
4. SL/native stop이 없거나 가격 증거가 없으면 `PLACE_OR_REPLACE_SL` 을 포함한다
5. PRE_TP1에서 TP1 주문이 없으면 `PLACE_OR_REPLACE_TP1` 을 포함한다
6. full protection command는 `PLACE_OR_REPLACE_FULL_PROTECTION` 으로 writer delegation 된다
7. delegated executor는 full protection 전용 transport 결과를 `finalizeFullProtectionRepairPlacement` 로 닫는다
8. Binance transport는 SL을 `STOP_MARKET closePosition=true`, TP1을 `TAKE_PROFIT_MARKET reduceOnly=true closePosition=false` 로 제출한다
9. dry-run 또는 transport 누락은 성공처럼 삼키지 않고 `requires_repair=true` 로 남긴다

V1 약점 재발 방지:

1. V1에서는 보호 주문 누락 경고가 있어도 실제 복구 주체와 복구 범위가 불명확했다
2. 이번 단계에서는 full protection repair도 `watchdog -> repair request -> writer delegation -> Binance transport -> protection runtime finalize` 경로를 갖는다
3. 이미 정상인 SL을 불필요하게 취소/재발행하지 않으므로 무보호 구간을 줄인다
4. 실패는 청산이나 조용한 통과가 아니라 `FULL_PROTECTION_REPAIR_FAILED` 또는 `FULL_PROTECTION_PARTIAL` 로 관측된다
5. 이로써 V1에서 반복된 `TP1_ORDER_MISSING`, `NATIVE_REFRESH_UNHEALTHY`, `UNPROTECTED_ACTIVE_POSITION` 계열이 같은 repair framework 안에서 처리된다

## 2026-04-21 Repair Evidence Summary + Runbook Binding

추가 증거:

1. `src/v2/repairExecutionLedger.js`
2. `scripts/check-v2-repair-queue-canary-preflight.js`
3. `src/tests/v2-repair-execution-ledger.test.js`
4. `src/tests/v2-repair-execution-completion.test.js`
5. `src/tests/check-v2-repair-queue-canary-preflight.test.js`
6. `src/tests/v2-repair-queue-canary.test.js`
7. `src/tests/v2-repair-queue-operational-canary.test.js`
8. `src/tests/v2-repair-queue-firestore-canary.test.js`

판정:

1. repair completion ledger의 `result_snapshot` 은 이제 `runbook_refs` 를 직접 보존한다
2. `result_snapshot.repair_evidence_summary` 는 issue code, requested action, command type, runtime write reason, health status, runbook refs를 포함한다
3. repair evidence summary는 SL/TP1 leg별 `order_id`, `order_status`, `trigger_price`, `ack_at`, requested trigger/quantity를 복원 가능하게 남긴다
4. `UNPROTECTED_ACTIVE_POSITION / PLACE_OR_REPLACE_FULL_PROTECTION` 은 `RQ_RBK_03` 으로 연결된다
5. `TP1_ORDER_MISSING / PLACE_OR_REPLACE_TP1` 은 `RQ_RBK_01` 로 연결된다
6. `TRAIL_STOP_MISSING`, `NATIVE_REFRESH_UNHEALTHY`, `REFRESH_NATIVE_STOP` 은 `RQ_RBK_02` 로 연결된다
7. repair canary preflight는 `RQ_CANARY_CHK_26`, `RQ_CANARY_CHK_27` 로 completion ledger의 evidence summary와 runbook refs 존재를 강제한다

V1 약점 재발 방지:

1. V1에서는 watchdog 경고 이후 실제 주문 증거와 운영자가 봐야 할 runbook이 분리되어 있었다
2. 이번 단계에서는 repair 완료 ledger 자체가 “무엇이 깨졌고, 어느 주문 leg가 복구됐고, 실패하면 어떤 runbook을 볼지”를 포함한다
3. 따라서 보호주문 계열 장애가 다시 발생해도 artifact만으로 SL/TP1 각각의 상태와 다음 운영 절차를 추적할 수 있다
4. canary preflight가 evidence summary 누락을 차단하므로, 증거 없는 repair queue 승격을 막는다

## 2026-04-21 Promotion Repair Evidence Surfacing

추가 증거:

1. `scripts/collect-v2-promotion-runtime-snapshot.js`
2. `scripts/export-v2-promotion-runtime-snapshot.js`
3. `scripts/generate-v2-unified-promotion-report.js`
4. `scripts/check-v2-promotion-deploy-decision.js`
5. `scripts/run-v2-promotion-cloudbuild.js`
6. `src/tests/collect-v2-promotion-runtime-snapshot.test.js`
7. `src/tests/export-v2-promotion-runtime-snapshot.test.js`
8. `src/tests/generate-v2-unified-promotion-report.test.js`
9. `src/tests/check-v2-promotion-deploy-decision.test.js`
10. `src/tests/run-v2-promotion-pipeline.test.js`
11. `src/tests/run-v2-promotion-cloudbuild.test.js`

판정:

1. runtime collector는 이제 `REPAIR_EXECUTION_LEDGER` 를 `position_cycle_id` 기준으로 bounded query 한다
2. query budget에는 `repair_execution_ledgers` count와 `repairExecutionLedgersLimit` 가 남는다
3. `snapshotMeta.repair_evidence_summary` 는 repair request 수, execution ledger 수, completion ledger 수, completion evidence 수, missing evidence 수를 집계한다
4. repair request가 없으면 `ok=true` 로 명시된다
5. repair request가 있는데 completion evidence가 없으면 `ok=false` 가 된다
6. exporter는 이 summary를 `promotion-runtime-manifest.json.snapshot_meta.repair_evidence_summary` 로 보존한다
7. unified report는 이를 `bounded_runtime_summary.repair_evidence_summary` 로 승격한다
8. deploy decision은 CANARY/LIVE에서 summary 누락 또는 repair request 대비 completion evidence 누락을 `DEPLOY_DECISION:REPAIR_EVIDENCE_SUMMARY_REQUIRED` 로 fail-closed 한다
9. Cloud Build context의 deploy decision summary도 `bounded_runtime_summary.repair_evidence_summary` 를 보존한다

V1 약점 재발 방지:

1. V1에서는 repair가 발생해도 promotion 승인 화면에서 실제 복구 증거가 바로 보이지 않았다
2. 이번 단계부터는 repair request가 있는 cycle은 completion ledger의 `repair_evidence_summary` 가 promotion 상단까지 올라와야 한다
3. 따라서 보호주문 누락/복구 계열이 다시 발생했을 때 “복구를 했는지, 어떤 주문 leg 증거가 있는지, runbook refs가 있는지”를 배포 판단에서 바로 볼 수 있다
4. 증거가 없으면 deploy decision이 막히므로, V1식 “경고를 보긴 했지만 증거 없이 다음 단계로 진행”하는 실패 모드를 줄인다

## 2026-04-21 Collected Runtime Chain Evidence Gate

추가 증거:

1. `scripts/collect-v2-promotion-runtime-snapshot.js`
2. `scripts/export-v2-promotion-runtime-snapshot.js`
3. `scripts/generate-v2-unified-promotion-report.js`
4. `scripts/check-v2-promotion-deploy-decision.js`
5. `src/tests/collect-v2-promotion-runtime-snapshot.test.js`
6. `src/tests/export-v2-promotion-runtime-snapshot.test.js`
7. `src/tests/generate-v2-unified-promotion-report.test.js`
8. `src/tests/check-v2-promotion-deploy-decision.test.js`
9. `src/tests/check-v2-canary-runbook.test.js`
10. `src/tests/run-v2-promotion-pipeline.test.js`
11. `src/tests/run-v2-promotion-cloudbuild.test.js`

판정:

1. promotion collector의 runtime chain audit가 더 이상 `replayGate.validateEpisode()` 하나를 `check_n=1` 로 요약하지 않는다
2. collector는 실제 수집된 `positionCycle`, `projection`, `protectionRuntime`, `canonical transitions`, `alert outboxes` 를 같은 `position_cycle_id` 와 `entry_event_id` 로 교차검사한다
3. 필수 check id는 `COLLECTED_POSITION_CYCLE_ID_PRESENT`, `COLLECTED_ENTRY_EVENT_ID_PRESENT`, `COLLECTED_PROJECTION_POSITION_CYCLE_MATCH`, `COLLECTED_PROTECTION_RUNTIME_POSITION_CYCLE_MATCH`, `COLLECTED_OUTBOX_TRANSITION_LINKS_COMPLETE`, `REPLAY_GATE_EPISODE_VALID` 등을 포함한다
4. exporter와 unified report는 `runtime_chain_audit_summary.check_ids`, `passed_check_ids`, `failed_check_ids` 를 보존한다
5. deploy decision은 CANARY/LIVE에서 단순 `ok=true` 가 아니라 모든 필수 runtime chain check id가 `passed_check_ids` 에 존재해야 승인한다
6. runbook review는 같은 deploy decision helper를 재사용하므로, runbook과 deploy gate의 runtime chain 판정이 갈라지지 않는다
7. outbox의 `position_cycle_id` 가 transition과 다른 drift 케이스는 `COLLECTED_OUTBOX_POSITION_CYCLE_MATCH` 로 fail-closed 된다

V1 약점 재발 방지:

1. V1에서는 “replay는 통과했지만 실제 운영 Firestore chain이 같은 lineage인지”가 충분히 드러나지 않았다
2. 이번 단계에서는 promotion 승인 상단에 실제 수집 chain check id가 올라와야 하므로, replay/promotion tooling만 강하고 본체 runtime chain이 약한 착시를 줄인다
3. transition/projection/outbox/protection runtime이 다시 분리 writer처럼 어긋나면 deploy decision이 `DEPLOY_DECISION:RUNTIME_CHAIN_AUDIT_REQUIRED` 로 막힌다
4. 남은 한계는 이 검사가 아직 collected runtime evidence 기반이라는 점이다. 다음 단계는 실제 V2 entry orchestration runner가 이 chain을 직접 생산하도록 하는 것이다

## 2026-04-21 Entry Submitter Protection Evidence Hardening

추가 증거:

1. `src/v2/entrySubmitter.js`
2. `src/tests/v2-entry-submitter.test.js`
3. `src/tests/v2-entry-protection-runner.test.js`
4. `src/tests/v2-entry-protection-storage.test.js`
5. `src/tests/v2-protection-writer.test.js`
6. `src/tests/v2-binance-entry-order-transport.test.js`
7. `src/tests/v2-runtime-chain-audit.test.js`

판정:

1. `runV2EntrySubmitter` 는 더 이상 `protectionResult.ok === true` 만으로 `ENTRY_SUBMITTED_AND_PROTECTED` 를 반환하지 않는다
2. submitter는 `activationCommit.ok=true`, `position_cycle_status=ACTIVE_PROTECTED`, `activationCommit.chainAudit.ok=true`, `protectionWriteResult.writeDecision.ok=true`, `runtimeDoc.health_status=HEALTHY`, `sl_order_id`, `tp1_order_id` 를 모두 확인한다
3. 보호 활성화 함수가 실수로 `{ ok: true }` 만 반환하면 `ENTRY_SUBMITTED_PROTECTION_BLOCKED` 로 떨어지고 `protectionEvidence.failed_check_ids` 에 깨진 조건이 남는다
4. 진입 체결 이후 Firestore/protection activation이 throw 되어도 성공으로 포장하지 않고, fill lineage와 structured failure를 같이 반환한다
5. 정상 경로는 기존처럼 entry fill 이후 protection activation을 거쳐 `ENTRY_SUBMITTED_AND_PROTECTED` 로 끝난다

V1 약점 재발 방지:

1. V1에서는 “보호 주문을 시도했다” 와 “보호 주문이 실제로 활성화됐고 position이 ACTIVE_PROTECTED가 됐다” 가 운영상 섞였다
2. 이번 단계에서는 submitter 최상단 성공 조건이 실제 activation batch와 runtime chain audit 증거에 의존한다
3. 따라서 보호 주문이 없는데도 상위 entry path가 성공으로 끝나는 half-active 상태를 줄인다
4. 남은 한계는 이 submitter가 production scheduler/native signal runner에 본선으로 연결되는 단계가 아직 남아 있다는 점이다

## 2026-04-21 Entry Execution Kernel Evidence Gate

추가 증거:

1. `src/v2/entryExecutionKernel.js`
2. `src/v2/entryBoundaryAudit.js`
3. `src/tests/v2-entry-execution-kernel.test.js`
4. `src/tests/v2-entry-boundary-audit.test.js`
5. `docs/DONBEOLJA_V2_ENTRY_ARCHITECTURE_2026-04-20.md`

판정:

1. V2 production entry route의 최상단 계약을 `runV2EntrySubmitter` 직접 호출에서 `runV2EntryExecutionKernel` 호출로 승격했다
2. execution kernel은 submitter 결과를 다시 감사해서 `ENTRY_SUBMITTED_AND_PROTECTED` 문자열만으로 성공 처리하지 않는다
3. kernel은 `FILLED` entry receipt, `entry_event_id`, `position_cycle_id`, `PROTECTION_PENDING` bootstrap, `ACTIVE_PROTECTED` activation commit, chain audit, write decision, `HEALTHY` protection runtime, SL/TP1 order id를 모두 요구한다
4. fake `{ ok: true }`, dry-run fill, protection runtime의 `position_cycle_id` drift는 `V2_ENTRY_EXECUTION_KERNEL_BLOCKED` 로 차단된다
5. submitter throw는 `V2_ENTRY_EXECUTION_KERNEL_THROWN` 으로 구조화되어, 상위 runner가 예외를 성공처럼 삼키지 못한다
6. entry boundary audit는 `runV2EntrySubmitter` 직접 호출을 `src/v2/entryExecutionKernel.js` 밖에서 금지한다

V1 약점 재발 방지:

1. V1에서는 entry/protection/tick/watchdog 계층이 “성공처럼 보이는 값”을 서로 다른 의미로 해석했다
2. 이번 단계부터 V2 상위 runner는 submitter를 직접 신뢰하지 않고, 실행 커널의 증거 감사 결과만 신뢰해야 한다
3. 보호주문이 실제로 없거나 runtime chain이 다른 position cycle에 붙으면 entry success가 아니라 차단 이벤트가 된다
4. 남은 한계는 production scheduler/native signal runner를 실제로 `runV2EntryExecutionKernel` 로 연결하고, 배포 gate가 이 경로 외 submit을 차단하는 단계다

## 2026-04-21 Production Entry Route Kernel Wiring

추가 증거:

1. `src/v2/productionEntryRoute.js`
2. `src/v2/entryBoundaryAudit.js`
3. `src/v2/productionCutoverAudit.js`
4. `src/tests/v2-production-entry-route.test.js`
5. `src/tests/v2-entry-boundary-audit.test.js`
6. `src/tests/v2-production-cutover-audit.test.js`
7. `docs/DONBEOLJA_V2_ENTRY_ARCHITECTURE_2026-04-20.md`

판정:

1. V2 production entry 최상단 route가 `runV2ProductionEntryRoute` 로 추가됐다
2. route는 `DONBEOLJA_V2_ENABLED=0` 또는 `DONBEOLJA_V2_DRY_RUN=1` 이면 execution kernel을 호출하지 않는다
3. OpenClaw/router가 blocked이면 execution kernel을 호출하지 않는다
4. `DONBEOLJA_V2_CANARY_ONLY=1` 에서 `LIVE` decision이 들어오면 execution kernel을 호출하지 않는다
5. 실행은 `runV2EntryExecutionKernel` 을 통해서만 진행된다
6. kernel 결과의 executed entry는 다시 `openclawExecutionSeparationAudit` 로 OpenClaw/router lineage와 비교된다
7. kernel이 blocked면 route도 `V2_PRODUCTION_ENTRY_KERNEL_BLOCKED` 로 blocked다
8. kernel이 다른 `signal_intent_id` / `openclaw_decision_id` / `entry_intent_id` 를 실행한 흔적이 있으면 `V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED` 로 blocked다
9. audit ledger write가 throw되면 `V2_PRODUCTION_ENTRY_AUDIT_LEDGER_FAILED` 로 반환되어 성공처럼 보이지 않는다
10. entry boundary audit는 `runV2EntryExecutionKernel` 직접 호출을 `src/v2/productionEntryRoute.js` 밖에서 금지한다
11. production cutover audit는 route module 존재, execution kernel 호출, disabled/dry-run block, OpenClaw separation audit, kernel bypass boundary rule을 같이 검사한다

V1 약점 재발 방지:

1. V1에서는 scheduler/native signal/runner가 서로 다른 성공 조건을 가질 수 있었다
2. 이번 단계부터 V2 production entry의 최상단 성공 조건은 runtime guard, deterministic router, execution kernel, OpenClaw separation audit, audit ledger result를 모두 통과해야 한다
3. 따라서 OpenClaw 승인만 있거나, kernel이 fake success를 내거나, 실행 lineage가 다른 경우가 entry success로 포장되지 않는다
4. cutover audit가 route/kernel wiring 계약을 검사하므로, route를 만들고도 deploy gate가 모르는 V1식 문서-코드 단절을 줄였다
5. 남은 한계는 실제 Cloud Run scheduler/OpenClaw cron handler가 `runV2ProductionEntryRoute` 를 호출하도록 연결하고, 그 호출 증거를 24시간 canary에서 수집하는 단계다

## 2026-04-21 Production Entry Route Canary Hook

추가 증거:

1. `src/v2/productionEntryRouteCanary.js`
2. `scripts/run-v2-production-entry-route-canary.js`
3. `src/routes/openclaw.cron.routes.js`
4. `scripts/lib/openclaw-cron-manifest.js`
5. `src/tests/v2-production-entry-route-canary.test.js`
6. `src/tests/run-v2-production-entry-route-canary.test.js`
7. `src/tests/openclaw-cron-routes.test.js`
8. `src/tests/openclaw-cron-manifest.test.js`

판정:

1. OpenClaw Cloud Scheduler가 호출할 수 있는 `/api/openclaw/cron/v2-production-entry-route-canary` endpoint가 추가됐다
2. endpoint는 `SCHEDULER_TOKEN` 인증을 통과해야 하고, 기존 OpenClaw cron timeout wrapper를 재사용한다
3. canary script는 `runV2ProductionEntryRoute` 를 호출하되 거래소 write를 하지 않는다
4. artifact에는 `canary_mode=NO_EXCHANGE_ROUTE_PROOF` 와 `exchange_write_performed=false` 가 고정된다
5. canary는 runtime guard, deterministic router, route-level execution kernel result, OpenClaw separation audit, audit ledger skip evidence를 모두 검사한다
6. audit ledger write는 의도적으로 `PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED` 로 skip 하며, 이 skip evidence가 없으면 pass가 아니다
7. Cloud Scheduler manifest에 `v2_production_entry_route_canary` job이 추가되어 endpoint와 manifest가 분리되지 않는다
8. static route test가 endpoint, script binding, `_ping` route list, blocked canary HTTP 500 mapping을 검사한다

V1 약점 재발 방지:

1. V1에서는 cron/scheduler가 어느 runtime 경로를 실제로 타는지 운영자가 artifact만 보고 복원하기 어려웠다
2. 이번 단계에서는 OpenClaw cron이 V2 production entry route까지 도달했다는 증거가 별도 artifact로 남는다
3. 다만 이 canary는 실주문/실보호주문 증거가 아니다. 의도적으로 `NO_EXCHANGE_ROUTE_PROOF` 에 머물러서 scheduler 연결 증거와 live exchange write 증거를 섞지 않는다
4. 다음 단계는 이 canary가 24시간 동안 누락 없이 생성되는지 수집한 뒤, 실제 canary entry transport 연결로 승격하는 것이다

## 2026-04-21 Production Entry Route Canary 24h Streak Gate

추가 증거:

1. `scripts/run-v2-production-entry-route-canary.js`
2. `scripts/check-v2-production-entry-route-canary-streak.js`
3. `src/tests/check-v2-production-entry-route-canary-streak.test.js`
4. `scripts/generate-v2-unified-promotion-report.js`
5. `scripts/check-v2-promotion-deploy-decision.js`
6. `scripts/submit-v2-promotion-cloudbuild.js`
7. `scripts/lib/v2-promotion-submit-trace.js`
8. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`

판정:

1. production entry route canary는 이제 latest artifact뿐 아니라 `v2_production_entry_route_canary_history.jsonl` 에도 append 된다
2. streak checker는 최근 24시간 history에서 `V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS`, `NO_EXCHANGE_ROUTE_PROOF`, `exchange_write_performed=false`, route success, kernel called, ledger skip evidence를 모두 확인한다
3. 단일 최신 파일만 있는 상태는 `PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:MIN_RUN_COUNT` 및 `COVERAGE_INSUFFICIENT` 로 차단된다
4. unhealthy row, stale latest, 긴 gap, invalid JSONL도 모두 fail-closed 로 드러난다
5. unified promotion report는 `bounded_runtime_summary.production_entry_route_canary_streak` 를 포함한다
6. deploy decision은 LIVE에서 이 streak가 없으면 `DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRED` 로 차단하고, CANARY에서는 warning으로만 둔다
7. submit wrapper는 같은 조건을 `SUBMIT_CHK_19` 로 다시 검사하며 runbook checklist `26` 으로 역추적된다

V1 약점 재발 방지:

1. V1에서는 scheduler 연결 증거와 실제 주문 성공 증거가 운영상 섞일 수 있었다
2. 이번 단계는 route 도달 증거를 거래소 write와 분리해 검증하므로, live entry transport를 붙이기 전에 scheduler/control-plane 경로가 충분히 안정적인지 먼저 본다
3. LIVE 승격은 이제 repair Firestore canary streak뿐 아니라 production entry route canary streak도 통과해야 하므로, route가 한 번 성공한 착시로 live cutover를 진행하는 위험을 줄인다
4. 이 단계의 한계는 Cloud Run 로컬 파일시스템이 24시간 영속 증거로 충분하지 않다는 점이었다. 바로 다음 단계에서 Firestore-backed history로 보강한다

## 2026-04-21 Production Entry Route Canary Firestore History

추가 증거:

1. `src/v2/productionEntryRouteCanaryHistory.js`
2. `src/v2/constants.js`
3. `src/v2/storage.js`
4. `scripts/run-v2-production-entry-route-canary.js`
5. `scripts/check-v2-production-entry-route-canary-streak.js`
6. `src/tests/v2-production-entry-route-canary-history.test.js`
7. `src/tests/run-v2-production-entry-route-canary.test.js`
8. `src/tests/check-v2-production-entry-route-canary-streak.test.js`
9. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`

판정:

1. production entry route canary history는 `PRODUCTION_ENTRY_ROUTE_CANARIES` collection key로 V2 storage 계층에 등록됐다
2. 실제 collection suffix는 `production_entry_route_canaries_v2` 이고, runtime prefix는 `DONBEOLJA_V2_COLLECTION_PREFIX` 를 따른다
3. canary runner는 `DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED=1` 일 때만 Firestore history를 쓴다
4. 기본값은 `PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_DISABLED` 이며, 이 경우 로컬 artifact/JSONL만 남기는 개발 fallback이다
5. Firestore history doc은 `ok`, `reason`, `exchange_write_performed`, route/kernel/persist 호출 여부, fail list, route summary, sanitized artifact snapshot을 저장한다
6. artifact snapshot에 `apiKey`, `apiSecret`, `BINANCE_SECRET`, `BINANCE_API`, `SECRET_KEY`, `PRIVATE_KEY` 문자열이 포함되면 `PRODUCTION_ENTRY_ROUTE_CANARY_SECRET_LEAK_GUARD` 로 저장을 차단한다
7. streak checker는 `DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE=firestore` 또는 `DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED=1` 일 때 Firestore history를 읽는다
8. Firestore source의 `history_file` 필드는 파일 경로가 아니라 실제 V2 collection name으로 기록되어, submit 차단 시 어떤 durable evidence를 봤는지 역추적할 수 있다
9. LIVE deploy/submit 판단은 `history_source=FIRESTORE` 와 non-empty `history_file` 을 요구하므로, JSONL streak는 개발 fallback으로만 통과한다
10. `cloudbuild.yaml` 과 `productionRuntimeConfigAudit` 는 canary Firestore write/read/source env 전달을 검사하므로, 코드가 Firestore evidence를 요구하면서 Cloud Run env가 빠지는 단절을 막는다

V1 약점 재발 방지:

1. V1에서는 latest artifact 또는 임시 로컬 상태만 보고 운영 판단을 내리면 Cloud Run 재시작/인스턴스 교체로 증거가 사라질 수 있었다
2. 이번 단계는 production entry route canary의 24시간 coverage를 Firestore durable evidence로도 남기므로, LIVE 승격 판단이 ephemeral filesystem에만 의존하지 않는다
3. Firestore write/read는 명시 env opt-in이 필요하므로, V1의 exit-integrity cycle처럼 감시 기능이 갑자기 full-scan 비용 폭발로 바뀌지 않는다
4. 쿼리는 `generated_at_ms >= sinceMs` 와 bounded limit만 사용하므로, 긴 collection full-scan을 promotion gate 안에 넣지 않는다
5. 이 증거는 여전히 `NO_EXCHANGE_ROUTE_PROOF` 이다. 실거래소 write 증거와 scheduler route 증거를 섞지 않아, V1식 성공 조건 혼선을 줄인다

## 2026-04-21 Production Entry Route Canary Collection Bootstrap

추가 증거:

1. `scripts/submit-v2-promotion-cloudbuild.js`
2. `src/tests/submit-v2-promotion-cloudbuild.test.js`
3. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`

판정:

1. bounded CANARY/LIVE 제출 request는 이제 production entry route canary Firestore write/read/source env를 자동으로 `1/1/FIRESTORE` 로 설정한다
2. CANARY에서도 이 durable history 수집을 켜는 이유는 LIVE 승격 직전에 24시간 Firestore streak가 필요하기 때문이다
3. LIVE deploy decision은 여전히 `history_source=FIRESTORE` 를 요구하므로, JSONL fallback으로 LIVE를 통과할 수 없다
4. MOCK/GATE 계열은 기본 `0/0/JSONL` 로 남아, 로컬 개발이나 단순 gate 실행이 Firestore write를 만들지 않는다

V1 약점 재발 방지:

1. V1에서는 운영 증거를 요구하면서 그 증거를 만드는 scheduler/env가 먼저 켜져 있는지 별도였다
2. 이번 단계는 CANARY 제출 시점부터 durable canary history 수집 env를 같이 전달해, LIVE 직전에 “필수 증거가 없어서 다시 수동 설정해야 하는” chicken-and-egg를 줄인다
3. Firestore write는 production entry route canary의 bounded single-doc history에 한정되며, V1 exit-integrity full-scan 같은 비용 폭발 경로가 아니다

## 2026-04-21 Promotion Pipeline Production Route Streak Refresh

추가 증거:

1. `scripts/run-v2-promotion-pipeline.js`
2. `scripts/run-v2-promotion-cloudbuild.js`
3. `src/tests/run-v2-promotion-pipeline.test.js`
4. `src/tests/run-v2-promotion-cloudbuild.test.js`
5. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`

판정:

1. promotion pipeline은 이제 `generate-v2-unified-promotion-report` 를 실행하기 직전에 `v2_production_entry_route_canary_streak_latest.json` 를 현재 artifact dir에 새로 쓴다
2. CANARY/LIVE 모드만 refresh 대상이며, SHADOW/MOCK 계열은 production route canary streak를 요구하지 않는다
3. streak read 실패는 프로세스 예외로 묻히지 않고 `V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_THROWN` artifact로 남는다
4. unified report와 deploy decision은 외부 `ops/daily` fallback보다 같은 artifact dir에 방금 생성된 streak artifact를 우선 읽는다
5. cloudbuild context summary도 `bounded_runtime_summary.production_entry_route_canary_streak` 를 노출하므로 submit 차단 원인을 context에서 바로 추적할 수 있다

V1 약점 재발 방지:

1. V1에서는 gate가 요구하는 증거가 실제 승격 wrapper 바깥에서 생성되어 stale latest artifact를 믿는 구조가 반복됐다
2. 이번 단계는 production route streak refresh를 promotion pipeline 내부로 끌어와 “검사는 있는데 이번 배포 실행이 만든 증거인지 모르는” 단절을 줄였다
3. LIVE에서는 여전히 `history_source=FIRESTORE` 가 아니면 deploy/submit에서 차단되므로, JSONL fallback이 운영 증거로 승격되지 않는다
4. CANARY에서는 streak 부족을 warning으로 노출해 24시간 evidence를 누적할 수 있고, LIVE에서는 같은 결함이 blocker로 승격된다

## 2026-04-21 Promotion Pipeline Repair Streak Refresh

추가 증거:

1. `scripts/run-v2-promotion-pipeline.js`
2. `src/tests/run-v2-promotion-pipeline.test.js`
3. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`

판정:

1. promotion pipeline은 이제 `generate-v2-unified-promotion-report` 를 실행하기 직전에 `v2_repair_queue_firestore_canary_streak_latest.json` 도 현재 artifact dir에 새로 쓴다
2. repair canary의 원천은 장기 수집 JSONL history이며, 기본 history fallback은 `ops/daily/v2_repair_queue_firestore_canary_history.jsonl` 이다
3. history read 실패는 `V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_THROWN` artifact로 남고, CANARY에서는 warning, LIVE에서는 blocker로 이어진다
4. unified report와 deploy decision은 같은 artifact dir에 방금 생성된 repair streak artifact를 우선 읽는다

V1 약점 재발 방지:

1. V1에서는 장기 canary가 별도 job에서 만든 latest verdict만 보고 승격 판단을 할 수 있었다
2. 이번 단계는 장기 history 자체는 유지하되, 승격 판단에 들어가는 verdict JSON은 promotion pipeline이 직접 재계산한다
3. 따라서 과거 latest verdict가 남아 있거나 collector가 최근 history를 반영하지 못한 상태가 LIVE submit 승인으로 이어지는 위험을 줄였다
4. production route streak와 repair streak가 모두 같은 방식으로 artifact-dir-local refresh를 거치므로, 승격 evidence 생성 방식이 일관된다

## 2026-04-21 Warning Classifier End-to-End Contract

추가 증거:

1. `scripts/run-v2-promotion-cloudbuild.js`
2. `scripts/submit-v2-promotion-cloudbuild.js`
3. `scripts/check-v2-canary-runbook.js`
4. `scripts/check-v2-promotion-submit-contract.js`
5. `src/tests/run-v2-promotion-cloudbuild.test.js`
6. `src/tests/submit-v2-promotion-cloudbuild.test.js`
7. `src/tests/check-v2-canary-runbook.test.js`
8. `src/tests/check-v2-promotion-submit-contract.test.js`

판정:

1. repair streak warning과 production entry route streak warning은 모두 `has_live_readiness_warning` 으로 분류된다
2. repair streak warning은 `has_repair_firestore_canary_streak_warning=true` 와 runbook 19로 추적된다
3. production entry route streak warning은 `has_production_entry_route_canary_streak_warning=true` 와 runbook 26으로 추적된다
4. `promotion-cloudbuild-context.json` 생성 경로는 production route warning classifier를 실제 artifact에 남기는 테스트를 가진다
5. `promotion-runbook-review` 의 `CHK_13B` 는 warning count/top warning/final status뿐 아니라 세 classifier boolean까지 일치해야 PASS한다
6. submit contract는 classifier 필드, runbook 19/26 매핑, operator summary/alert preview 보존을 모두 필수 조건으로 검사한다
7. warning이 0건이어도 `warning_summary` 와 세 classifier false 값이 있어야 하며, 생략되면 `CHK_13B` 가 실패한다
8. `promotion-cloudbuild-context.json.submit_trace` 도 `deploy_warning_attention_required`, `deploy_warning_summary`, `deploy_warning_runbook_checklist` 를 남겨 submit wrapper 전 단계에서 runbook 19/26을 바로 복원한다
9. `CHK_13B` 는 `deploy_decision_summary.warning_summary` 와 `submit_trace.deploy_warning_summary` 가 서로 다른 값을 가리키면 실패한다

V1 약점 재발 방지:

1. V1에서는 warning 문구만 있고 운영자가 어떤 runbook 또는 증거 파일을 봐야 하는지 코드로 강제되지 않았다
2. 이번 단계는 warning 생성자, cloudbuild context, runbook review, submit request, operator alert가 같은 classifier 스키마를 공유하도록 잠갔다
3. classifier 누락은 단순 문서 drift가 아니라 `promotion-runbook-review` 또는 `check:v2-promotion-submit-contract` 실패로 드러난다
4. no-warning 상태도 동일 스키마를 유지하므로, “문제가 없을 때는 필드가 없고 문제가 있을 때만 필드가 생기는” V1식 조건부 artifact drift를 줄인다
5. submit request 생성 전에도 context artifact만 보고 warning 계열과 runbook 번호를 확인할 수 있어, 중간 단계 artifact의 관측성 공백을 줄인다
6. 같은 context 안의 summary와 trace가 서로 다르면 runbook review가 실패하므로, 중복 요약 필드 간 drift를 조기에 차단한다
7. 따라서 “최종 알림은 떴지만 정확히 어떤 계열 문제인지 모르는” V1식 모호한 운영 상태를 줄인다

## 2026-04-22 Cloudbuild Context Submit Trace Contract

추가 증거:

1. `scripts/check-v2-canary-runbook.js`
2. `src/tests/check-v2-canary-runbook.test.js`
3. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`

판정:

1. `promotion-cloudbuild-context.json.submit_trace` 는 이제 warning trace뿐 아니라 context submit 차단 핵심축인 `SUBMIT_CHK_06`, `SUBMIT_CHK_07`, `SUBMIT_CHK_08` 을 runbook review에서 직접 검증한다
2. `CHK_13C` 는 relevant submit checks, failed submit checks, failed runbook checklist, blocker families, primary blocker family, reason code, checks 배열이 context와 일치하지 않으면 실패한다
3. 따라서 submit wrapper 단계까지 가지 않아도 context artifact만으로 “무엇이 깨졌는가 / 어느 SUBMIT_CHK인가 / runbook 몇 번인가 / 어느 계열인가”를 복원할 수 있어야 한다

V1 약점 재발 방지:

1. V1에서는 마지막 제출 전 context와 submit wrapper가 서로 다른 기준으로 blocker를 해석할 수 있었다
2. 이번 단계는 context-level trace를 runbook checker가 fail-closed로 검증하므로, 문서상 trace-back이 실제 artifact와 어긋나는 상태를 조기에 차단한다
3. warning trace와 blocker trace를 분리 검증해, “경고는 맞지만 실제 submit 차단 원인은 다른데도 통과하는” 운영 drift를 줄인다

## 2026-04-22 TP1 Protection Runtime Gate

추가 증거:

1. `src/v2/canonicalExitReducer.js`
2. `src/v2/exitFillIngestion.js`
3. `src/v2/openclawShadowExitWriter.js`
4. `src/tests/v2-canonical-exit-reducer.test.js`
5. `src/tests/v2-exit-fill-ingestion.test.js`
6. `src/tests/v2-openclaw-shadow-exit-writer.test.js`

판정:

1. V2 TP1 fill ingestion은 이제 `TP1_REACHED` reducer 호출 전에 `ACTIVE_PROTECTED` position cycle과 `HEALTHY/OK` protection runtime을 요구한다
2. SL native order와 TP1 native order evidence가 없거나 order status가 `PLACED` 가 아니면 `TP1_REACHED` 가 생성되지 않는다
3. OpenClaw shadow exit writer의 기존 TP1 runtime gate와 low-level ingestion gate가 같은 보호 조건을 공유한다
4. TP1 경로에서는 protection runtime을 검증 입력으로만 쓰고, 의미 없는 runtime 재쓰기는 하지 않는다

V1 약점 재발 방지:

1. V1에서는 TP1 체결 알림/상태 전이가 native TP1 주문 부재와 분리되어 `TP1_ORDER_MISSING` 이 반복됐다
2. 이번 단계는 TP1 fill이 들어와도 보호 runtime이 완전하지 않으면 canonical transition을 쓰지 않아, “보호주문 없는 TP1 성공 처리”를 차단한다
3. reducer/ingestion 경계에서 막기 때문에 상위 writer 하나가 실수해도 동일 조건을 다시 검사한다

## 2026-04-22 Stop Exit Native Protection Gate

추가 증거:

1. `src/v2/openclawShadowExitWriter.js`
2. `src/tests/v2-openclaw-shadow-stop-exit-writer.test.js`
3. `src/tests/v2-openclaw-shadow-exit-writer.test.js`
4. `src/tests/v2-openclaw-shadow-trail-writer.test.js`

판정:

1. V2 `SL_HIT` / `TRAIL_HIT` shadow writer는 이제 position cycle이 `ACTIVE_PROTECTED` 가 아니면 terminal transition을 쓰지 않는다
2. protection runtime 문서가 없거나 cycle id가 맞지 않거나 이미 terminal이면 stop exit를 skip한다
3. placed SL/native stop evidence가 없으면 `SL_HIT` / `TRAIL_HIT` 를 만들지 않고 `V2_SHADOW_STOP_EXIT_*` reason과 issue code로 관측 가능하게 남긴다
4. manual/external close는 stop fill과 다른 경로로 유지해, 사용자 수동 정리와 native stop 체결을 섞지 않는다

V1 약점 재발 방지:

1. V1에서는 stop event 문자열만 보고 SL/TRAIL terminal을 쓰는 경로가 남아 native stop 실제 근거와 projection이 어긋날 수 있었다
2. 이번 단계는 terminal stop transition을 “활성 보호 포지션 + native stop evidence” 뒤에만 허용한다
3. 따라서 보호주문 없이 들어간 포지션이 뒤늦게 stop/terminal 성공처럼 보이는 V1식 착시를 줄인다

## 2026-04-22 Stop Exit Full Fill Evidence Gate

추가 증거:

1. `src/v2/openclawShadowExitWriter.js`
2. `src/tests/v2-openclaw-shadow-stop-exit-writer.test.js`

판정:

1. V2 `SL_HIT` / `TRAIL_HIT` shadow writer는 이제 stop fill을 terminal로 쓰기 전에 `fullExit=true` 또는 거래소 evidence의 position-after zero 근거를 요구한다
2. `execution_type=TRADE` 와 stop event/order/stop price 근거가 없으면 terminal transition을 쓰지 않고 `V2_SHADOW_STOP_EXIT_STOP_FILL_EVIDENCE_MISSING` 으로 skip한다
3. partial stop fill은 `V2_SHADOW_STOP_EXIT_STOP_FULL_EXIT_NOT_CONFIRMED` 으로 skip되어 `SL_HIT` / `TRAIL_HIT` 가 조기 확정되지 않는다
4. runtime/native stop evidence gate와 fill evidence gate가 모두 통과해야만 protection runtime을 `TERMINAL_EXITED` 로 바꾼다

V1 약점 재발 방지:

1. V1에서는 stop 계열 이벤트가 들어오면 실제 전체 종료인지와 stop 체결인지가 분리 검증되지 않아 partial/ambiguous fill이 terminal처럼 보일 수 있었다
2. 이번 단계는 final stop fill 완료 기준인 `fullExit=true` + 실제 stop fill 근거를 코드 레벨에서 강제한다
3. 따라서 `ACTIVE_PROTECTED` 이더라도 단순 이벤트 문자열이나 약한 fill payload만으로 종료 상태가 확정되는 V1식 silent corruption을 줄인다

## 2026-04-22 Stop Exit Upstream Evidence Propagation

추가 증거:

1. `src/services/binanceFuturesFillsSync.js`
2. `src/tests/binance-fills-canonical-lineage-guard.test.js`
3. `src/tests/fills-sync-alert-aggregation.test.js`

판정:

1. Binance fill sync의 `maybeWriteV2ShadowStopExit` 는 이제 `fullExit` 를 V2 stop writer까지 그대로 전달한다
2. fetched Binance order meta의 `order_type`, `order_status`, `close_position`, `reduce_only`, `stop_price`, `avg_price` 가 `exchangeEvidence` 로 전달된다
3. upstream wrapper가 `fullExit` 를 선검사만 하고 writer에 넘기지 않아 정상 stop terminal이 gate에서 막히는 drift를 제거했다
4. order meta normalize 단계에서 stop/avg price를 보존해, writer가 “실제 stop fill 근거”를 raw evidence로 복원할 수 있다

V1 약점 재발 방지:

1. V1에서는 하위 gate는 엄격해졌지만 upstream payload가 비어 있어 정상 이벤트가 skip되거나, 반대로 legacy 경로가 이를 우회할 위험이 있었다
2. 이번 단계는 fill sync wrapper와 V2 writer 사이의 계약을 테스트로 고정해, `fullExit` 와 Binance native order evidence가 중간에서 유실되면 회귀 테스트가 실패한다
3. 따라서 “writer는 안전하지만 ingress가 증거를 전달하지 않는” V1식 계층 간 계약 불일치를 줄인다

## 2026-04-22 Stop Full Exit Classifier Tightening

추가 증거:

1. `src/services/binanceFuturesFillsSync.js`
2. `src/tests/fills-sync-alert-aggregation.test.js`
3. `src/tests/binance-fills-canonical-lineage-guard.test.js`

판정:

1. `resolveFillSyncAlertFullExit` 는 더 이상 `EXIT_SL_*` 이벤트명만으로 `fullExit=true` 를 만들지 않는다
2. SL/stop 계열 full exit는 native `closePosition=true` 또는 close ratio `>= 0.999` 근거가 있어야 한다
3. `EXIT_SL_*` + `closePosition=false` + partial ratio는 partial로 남아 V2 stop writer의 terminal 승격 조건을 통과하지 못한다
4. native `STOP_MARKET closePosition=true` 는 계속 full exit로 인정되어 정상 SL 종료는 막지 않는다

V1 약점 재발 방지:

1. V1에서는 이벤트 라벨이 상태 사실처럼 쓰여 partial stop이나 애매한 sync fill이 terminal alert/status로 승격될 수 있었다
2. 이번 단계는 `SL` 라벨과 “포지션 전량 종료” 사실을 분리했다
3. 따라서 V2 terminal 상태는 라벨이 아니라 closePosition/수량 근거로만 확정되는 방향으로 더 단순하고 검증 가능해졌다

## 2026-04-22 Full Exit Label Fallback Removal

추가 증거:

1. `src/services/binanceFuturesFillsSync.js`
2. `src/tests/fills-sync-alert-aggregation.test.js`
3. `src/tests/binance-fills-canonical-lineage-guard.test.js`
4. `src/tests/trade-execution-alert.test.js`

판정:

1. `resolveFillSyncAlertFullExit` 는 이제 어떤 exit event label도 단독으로 `fullExit=true` 를 만들지 않는다
2. `EXIT_TIME_STOP_*`, `EXIT_EXTERNAL_SYNC`, `EXIT_OPPOSITE_SIGNAL`, `EXIT_LIQUIDATION_RISK` 도 native `closePosition=true` 또는 close ratio `>= 0.999` 가 없으면 partial/unknown 상태로 남는다
3. TP1은 기존처럼 항상 full exit classifier에서 제외된다
4. user-facing alert payload는 기존 fullExit 값을 렌더링할 수 있지만, fill sync classifier는 라벨 기반 전량 종료 추론을 하지 않는다

V1 약점 재발 방지:

1. V1에서는 이벤트명이 “전량 종료 사실”과 섞여 상태/알림/쿨다운이 조용히 틀어질 수 있었다
2. 이번 단계는 full exit classifier의 입력을 `closePosition` 과 수량 비율로 축소해, 이벤트 라벨이 사실처럼 전파되는 경로를 제거했다
3. 따라서 V2는 terminal 판단을 더 늦게 하더라도, 증거 없는 전량 종료 확정보다 복구/감사 가능한 partial 상태를 우선한다

## 2026-04-22 Full Exit Batch Recompute Contract

추가 증거:

1. `src/services/binanceFuturesFillsSync.js`
2. `src/tests/fills-sync-alert-aggregation.test.js`
3. `src/tests/binance-fills-canonical-lineage-guard.test.js`
4. `src/tests/trade-execution-alert.test.js`

판정:

1. `queueFillSyncAlertBatch` 는 더 이상 `current.fullExit || payload.fullExit` 로 full exit를 병합하지 않는다
2. 신규 batch와 병합 batch 모두 `resolveFillSyncAlertFullExit` 로 `event + orderMeta.closePosition + closeRatio` 를 다시 평가한다
3. partial fill payload가 실수로 `fullExit=true` 를 들고 와도, 병합 close ratio가 1 미만이고 native closePosition 근거가 없으면 merged payload는 `fullExit=false` 로 정정된다
4. split opposite-signal처럼 여러 partial이 합쳐져 close ratio가 1이 되는 경우에는 최종 batch만 `fullExit=true` 로 승격된다

V1 약점 재발 방지:

1. V1에서는 한 번 잘못 들어온 `fullExit=true` 가 alert batch 병합을 거치며 계속 보존될 수 있었다
2. 이번 단계는 batch boundary에서도 full exit를 파생값으로 취급해, upstream payload 오염이 장기 전파되는 경로를 끊었다
3. 따라서 V2는 “상태 사실은 매 단계 재계산한다”는 원칙을 fill sync alert aggregation에도 적용한다

## 2026-04-22 Same Direction Trail Cooldown Full Exit Gate

추가 증거:

1. `src/services/binanceFuturesFillsSync.js`
2. `src/tests/fills-sync-alert-aggregation.test.js`
3. `src/tests/same-direction-profit-trail-cooldown.test.js`
4. `src/tests/binance-fills-canonical-lineage-guard.test.js`

판정:

1. Binance fill sync의 same-direction trail profit cooldown 저장 함수는 이제 함수 내부에서도 `fullExit=true` 를 요구한다
2. 호출부가 `looksLikeExit && fullExit` 를 검사하더라도, 저장 함수 자체가 같은 gate를 한 번 더 강제한다
3. `EXIT_TRAIL + realizedPnl>0` 이더라도 partial fill이면 cooldown observation을 쓰지 않는다
4. terminal profitable trail fill만 same-direction cooldown을 무장한다

V1 약점 재발 방지:

1. V1에서는 호출부 조건과 저장 함수 조건이 분리되어, 나중에 다른 호출부가 생기면 partial trail profit도 cooldown을 무장할 수 있었다
2. 이번 단계는 cooldown observation writer를 self-contained gate로 만들어 호출부 drift를 줄였다
3. 따라서 V2는 “운영 제약을 거는 side-effect writer는 자기 입력 불변식을 직접 검증한다”는 원칙을 적용한다

## 2026-04-22 External Close Full Exit Evidence Gate

추가 증거:

1. `src/v2/openclawShadowExitWriter.js`
2. `src/services/binanceFuturesFillsSync.js`
3. `src/tests/v2-openclaw-shadow-stop-exit-writer.test.js`
4. `src/tests/binance-fills-canonical-lineage-guard.test.js`

판정:

1. V2 `EXTERNAL_CLOSE_SYNC` / `MANUAL_CLOSE_SYNC` writer는 이제 `fullExit=true` 또는 position-after zero evidence가 없으면 terminal transition을 쓰지 않는다
2. Binance fill sync의 `maybeWriteV2ShadowExternalClose` 는 partial external/manual close에서 writer를 호출하지 않고 `V2_SHADOW_EXTERNAL_CLOSE_NOT_FULL_EXIT` 로 skip한다
3. full external close는 order type/status/closePosition/reduceOnly/fullExit evidence를 writer raw payload로 전달한다
4. manual close도 terminal sync를 쓰려면 full close evidence를 요구한다

V1 약점 재발 방지:

1. V1에서는 external/manual close가 stop과 다른 경로로 terminal projection을 쓸 수 있어 partial close가 전량 종료처럼 보일 위험이 있었다
2. 이번 단계는 stop terminal과 external/manual terminal 모두 full-exit evidence gate를 공유하는 방향으로 정렬했다
3. 따라서 V2 terminal 상태는 close origin이 stop이든 manual/external이든 “전량 종료 근거 없이는 terminal write 금지” 원칙을 유지한다

## 2026-04-22 Replay Terminal Evidence Gate

추가 증거:

1. `src/v2/replayGate.js`
2. `src/v2/replayFixtureFactory.js`
3. `src/v2/openclawShadowExitWriter.js`
4. `src/tests/v2-replay-gate.test.js`
5. `src/tests/v2-openclaw-shadow-stop-exit-writer.test.js`
6. `src/tests/generate-v2-replay-artifact.test.js`

판정:

1. replay gate는 이제 `SL_HIT`, `TRAIL_HIT`, `EXTERNAL_CLOSE_SYNC`, `MANUAL_CLOSE_SYNC` terminal transition마다 `full_exit=true` 또는 position-after zero evidence를 요구한다
2. `SL_HIT` / `TRAIL_HIT` 는 추가로 raw exchange payload 안의 `execution_type=TRADE` 와 stop order type / stop price / stop event evidence 중 하나를 요구한다
3. reference replay fixture는 terminal stop, external close, manual close 모두 production writer가 요구하는 full-exit evidence shape를 포함한다
4. stop writer도 canonical event 문자열만으로 stop fill을 인정하지 않고 raw exchange evidence에서 stop 근거를 확인한다
5. terminal evidence가 빠진 replay fixture는 `TERMINAL_FULL_EXIT_EVIDENCE_MISSING:*` 또는 `STOP_TERMINAL_FILL_EVIDENCE_MISSING:*` 로 fail-closed 된다

V1 약점 재발 방지:

1. V1에서는 replay fixture가 “객체 존재”만 만족해도 통과할 수 있어, 실제 terminal 판단 계약보다 약한 증거로 배포 게이트가 초록불이 될 수 있었다
2. 이번 단계는 production writer 계약과 replay/deploy gate 계약을 같은 방향으로 맞춰, 코드가 강해져도 테스트 fixture가 약해서 회귀를 놓치는 착시를 줄였다
3. 따라서 V2 terminal exit는 코드 실행과 배포 전 replay 양쪽에서 “전량 종료 근거 + stop 체결 근거”를 요구한다

## 2026-04-22 Runtime Snapshot Terminal Evidence Chain

추가 증거:

1. `scripts/collect-v2-promotion-runtime-snapshot.js`
2. `scripts/export-v2-promotion-runtime-snapshot.js`
3. `scripts/generate-v2-unified-promotion-report.js`
4. `scripts/check-v2-promotion-deploy-decision.js`
5. `src/tests/collect-v2-promotion-runtime-snapshot.test.js`
6. `src/tests/export-v2-promotion-runtime-snapshot.test.js`
7. `src/tests/run-v2-promotion-pipeline.test.js`

판정:

1. collector runtime chain audit는 이제 `COLLECTED_TERMINAL_FULL_EXIT_EVIDENCE_PRESENT` 와 `COLLECTED_STOP_TERMINAL_FILL_EVIDENCE_PRESENT` 를 별도 check id로 산출한다
2. runtime snapshot exporter는 terminal transition / terminal full-exit evidence / stop terminal fill evidence 개수를 manifest에 보존한다
3. unified promotion report는 이 terminal evidence summary 필드를 더 이상 누락하지 않고 bounded runtime summary까지 전달한다
4. deploy decision은 stale evidence summary가 새 필드를 갖지 않으면 `evidence_snapshot_summary` 를 통과시키지 않는다
5. 약한 terminal evidence fixture는 collector audit, replay gate, deploy decision 계층에서 모두 fail-closed 된다

V1 약점 재발 방지:

1. V1에서는 생산 코드, replay, 운영 snapshot, 통합 보고서 사이에서 evidence schema가 조금씩 달라져 게이트가 실제 운영 결함을 놓칠 수 있었다
2. 이번 단계는 terminal evidence 계약을 collector -> exporter -> unified report -> deploy decision 전체 체인에 관통시켰다
3. 따라서 V2는 “운영 증거가 실제로 수집되고 보고서/배포판정까지 보존되는가”를 배포 전 품질 조건으로 본다

## 2026-04-22 Canary Preflight Runtime Chain Contract

추가 증거:

1. `scripts/check-v2-promotion-canary-preflight.js`
2. `scripts/select-v2-promotion-canary-candidate.js`
3. `scripts/generate-v2-unified-promotion-report.js`
4. `scripts/check-v2-promotion-deploy-decision.js`
5. `src/tests/check-v2-promotion-canary-preflight.test.js`
6. `src/tests/select-v2-promotion-canary-candidate.test.js`
7. `src/tests/check-v2-promotion-deploy-decision.test.js`

판정:

1. canary preflight는 collector의 `runtime_chain_audits`가 없으면 `PREFLIGHT:RUNTIME_CHAIN_AUDIT_REQUIRED` 로 ready가 아니다
2. collector가 요구하는 runtime chain check id 중 누락된 항목은 `PREFLIGHT:RUNTIME_CHAIN_CHECKS_MISSING:*` 로 fail-closed 된다
3. terminal full-exit evidence 또는 stop terminal fill evidence가 약하면 `PREFLIGHT:RUNTIME_CHAIN_AUDIT_FAILED:*` 로 후보 선택 전에 탈락한다
4. candidate selection contract는 이제 `selected_runtime_chain_ok=true` 를 요구한다
5. unified promotion report와 deploy decision도 `selected_runtime_chain_ok` 를 보존하고 필수 조건으로 본다

V1 약점 재발 방지:

1. V1에서는 약한 증거가 selector/preflight를 통과하고 deploy gate나 운영 알림에서 뒤늦게 깨질 수 있었다
2. 이번 단계는 terminal evidence 결함을 candidate selection 이전에 제거해서 late-fail을 줄인다
3. preflight, selector, unified report, deploy decision이 같은 runtime chain 계약을 보게 되어 계층별 schema drift를 줄인다
4. 따라서 V2 canary 승격 후보는 “최근 cycle이고 snapshot 수가 맞다”만으로는 부족하며, 실제 terminal evidence chain까지 통과해야 한다

## 2026-04-22 Canary Runbook Runtime Chain Trace-Back

추가 증거:

1. `scripts/check-v2-canary-runbook.js`
2. `scripts/run-v2-promotion-cloudbuild.js`
3. `scripts/check-v2-promotion-submit-contract.js`
4. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
5. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
6. `src/tests/check-v2-canary-runbook.test.js`
7. `src/tests/run-v2-promotion-cloudbuild.test.js`

판정:

1. automated runbook verifier의 `CHK_15` 는 이제 `selection_contract.selected_runtime_chain_ok=true` 를 필수로 요구한다
2. Cloud Build context의 `candidate_selection_summary.selection_contract` 는 `selected_runtime_chain_ok` 를 운영자 요약에 보존한다
3. canary runbook checklist 15와 submit reverse index `SUBMIT_CHK_09` 는 runtime chain 계약까지 역추적 가능하게 문서화됐다
4. promotion artifact contract는 `selection_contract` 최소 요구 항목을 8개에서 9개로 확장했다
5. submit contract는 runbook과 Cloud Build context가 `selected_runtime_chain_ok` 를 누락하면 실패한다

V1 약점 재발 방지:

1. V1에서는 코드 게이트가 강해져도 runbook/operator context가 오래된 필드 목록을 보여줘 사람이 잘못 승인할 수 있었다
2. 이번 단계는 deploy decision, runbook verifier, Cloud Build context, 문서, submit contract가 같은 candidate selection 계약을 보게 맞췄다
3. 따라서 V2에서는 “코드는 차단했지만 문서/운영 요약은 통과처럼 보이는” 관측성 drift를 줄인다

## 2026-04-22 Submit Runtime Chain Audit Gate

추가 증거:

1. `scripts/submit-v2-promotion-cloudbuild.js`
2. `scripts/lib/v2-promotion-submit-trace.js`
3. `scripts/check-v2-promotion-submit-contract.js`
4. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
5. `src/tests/submit-v2-promotion-cloudbuild.test.js`

판정:

1. submit approval contract는 이제 `runtime_chain_audit_summary_required=true` 를 직접 포함한다
2. submit evidence source는 `bounded_runtime_summary.runtime_chain_audit_summary` 를 `approval_evidence_sources.runtime_chain_audit_summary` 로 가리킨다
3. submit approval verification은 `SUBMIT_CHK_04B` 로 runtime chain audit를 검사하고 runbook checklist `14A` 로 역추적한다
4. runtime chain audit가 누락되면 submit은 `REGENERATE_BOUNDED_RUNTIME_ARTIFACTS_AND_RECHECK_DEPLOY_DECISION` 으로 fail-closed 된다
5. submit contract는 `SUBMIT_CHK_04B`, `hasRuntimeChainAuditCoverage`, runbook reverse index가 누락되면 실패한다

V1 약점 재발 방지:

1. V1에서는 deploy gate와 최종 submit wrapper의 필수 증거 목록이 달라 마지막 제출 경로가 더 약해질 수 있었다
2. 이번 단계는 deploy decision, runbook, submit trace, submit wrapper가 모두 같은 runtime chain audit 필수 조건을 보게 맞췄다
3. 따라서 V2는 “배포 판정은 막았지만 제출 wrapper가 통과시키는” 마지막 단계 계약 불일치를 줄인다

## 2026-04-22 Submit Auto-Select Contract Completeness

추가 증거:

1. `scripts/submit-v2-promotion-cloudbuild.js`
2. `scripts/check-v2-promotion-submit-contract.js`
3. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
4. `src/tests/submit-v2-promotion-cloudbuild.test.js`

판정:

1. submit approval contract completeness는 이제 `candidate_selection_ready_required` 와 `selected_preflight_required` 타입을 필수로 검증한다
2. artifact contract는 두 auto-select 조건 필드를 bounded approval contract 최소 항목에 포함한다
3. auto-select submit request에서 `candidate_selection_ready_required` 가 누락되면 `SUBMIT_CHK_01` 이 fail-closed 된다
4. submit contract는 두 필드가 wrapper와 artifact contract에서 빠지면 실패한다

V1 약점 재발 방지:

1. V1에서는 auto-select/explicit-cycle 경로가 계약상 다르게 동작해도 최종 submit contract가 그 차이를 충분히 검증하지 못했다
2. 이번 단계는 auto-select 조건 자체를 approval contract completeness에 포함해 “선택 경로가 자동인지 명시인지”가 제출 직전에 흐려지는 문제를 줄인다
3. 따라서 V2에서는 auto-select 경로가 후보 선택/preflight 계약을 반드시 요구한다는 사실이 request, verification, 문서에 동시에 남는다

## 2026-04-22 Submit Resolved Artifact Dir Coherence

추가 증거:

1. `scripts/submit-v2-promotion-cloudbuild.js`
2. `scripts/lib/v2-promotion-submit-trace.js`
3. `scripts/check-v2-promotion-submit-contract.js`
4. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
5. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
6. `src/tests/submit-v2-promotion-cloudbuild.test.js`

판정:

1. submit approval verification은 이제 `SUBMIT_CHK_01A` 로 request `artifact_dir`, context `artifact_dir`, context `resolved_artifact_dir` 가 같은 최종 bounded dir인지 직접 검증한다
2. 같은 체크는 `promotion-deploy-decision.json.position_cycle_id`, `promotion-preflight.json.position_cycle_id`, `promotion-runtime-manifest.json.snapshot_meta.selector_meta.position_cycle_id`, `promotion-cloudbuild-context.json.position_cycle_id` 도 같은 cycle로 고정됐는지 확인한다
3. 실패하면 provenance blocker로 분류되어 `DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT` 로 fail-closed 된다
4. runbook reverse index는 `SUBMIT_CHK_01A -> 1,5,9` 를 제공하므로 submit 차단에서 artifact dir/cycle mismatch를 바로 추적할 수 있다
5. submit contract는 `SUBMIT_CHK_01A`, `hasResolvedArtifactDirCoherence`, `approval_evidence_sources.resolved_artifact_dir`, runbook reverse index가 누락되면 실패한다

V1 약점 재발 방지:

1. V1에서는 selector, deploy decision, context, submit wrapper가 서로 다른 artifact/cycle 축을 보더라도 마지막 제출 경로에서 명시적으로 드러나지 않을 수 있었다
2. 이번 단계는 최종 submit wrapper가 runbook PASS에만 의존하지 않고, artifact dir와 selected cycle coherence를 자체 검증하게 만든다
3. 따라서 V2에서는 auto-select finalize 이후 staging dir와 final dir가 섞이거나, 사람이 오래된 artifact dir를 재사용하는 provenance drift를 마지막 제출 전에 차단한다

## 2026-04-22 Runbook Resolved Artifact Dir Coherence

추가 증거:

1. `scripts/check-v2-canary-runbook.js`
2. `scripts/check-v2-promotion-submit-contract.js`
3. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
4. `src/tests/check-v2-canary-runbook.test.js`

판정:

1. automated runbook verifier는 이제 `CHK_01A` 로 `promotion-cloudbuild-context.json.artifact_dir`, `resolved_artifact_dir`, `position_cycle_id` 를 현재 최종 artifact dir와 expected cycle에 맞춰 검증한다
2. 같은 체크는 `promotion-preflight.json.position_cycle_id`, `promotion-runtime-manifest.json.snapshot_meta.selector_meta.position_cycle_id`, `promotion-deploy-decision.json.position_cycle_id` 도 같은 cycle인지 확인한다
3. runbook 단계에서 `resolved_artifact_dir` 가 다른 cycle/dir를 가리키면 submit wrapper까지 가지 않고 `promotion-runbook-review.json` 에 `CHK_01A=FAIL` 로 남는다
4. submit contract는 runbook verifier와 runbook 문서가 `CHK_01A` 를 모두 참조하지 않으면 실패한다

V1 약점 재발 방지:

1. V1에서는 runbook이 PASS처럼 보였지만 최종 submit wrapper가 다른 artifact 축을 보는 식의 운영 drift가 늦게 드러날 수 있었다
2. 이번 단계는 같은 provenance 조건을 runbook review와 submit wrapper 양쪽에서 중복 검증하게 만들어, 사람 승인 전에 먼저 깨진 축을 보여준다
3. 따라서 V2에서는 final dir/staging dir 혼선이 한 단계 늦게 발견되는 구조를 줄이고, artifact dir 폐기 후 preflight 재실행이라는 대응을 더 빨리 유도한다

## 2026-04-22 CloudBuild Context Artifact Dir Self-Check

추가 증거:

1. `scripts/run-v2-promotion-cloudbuild.js`
2. `scripts/check-v2-promotion-submit-contract.js`
3. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
4. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
5. `src/tests/run-v2-promotion-cloudbuild.test.js`

판정:

1. CloudBuild context writer는 이제 `artifact_dir_coherence` 를 생성 시점에 기록한다
2. 이 self-check는 `artifact_dir`, `resolved_artifact_dir`, `position_cycle_id`, deploy decision cycle id가 같은 final bounded dir를 설명하는지 즉시 보여준다
3. `resolved_artifact_dir` 가 stale/final dir와 어긋나면 context artifact 자체에 `ok=false`, `reason=ARTIFACT_DIR_RESOLVED_DIR_MISMATCH` 가 남는다
4. submit contract는 wrapper, runbook, artifact contract가 `artifact_dir_coherence` 를 모두 요구하지 않으면 실패한다

V1 약점 재발 방지:

1. V1에서는 잘못된 산출물 축이 뒤쪽 gate에서만 드러나거나 운영자가 로그를 여러 파일에서 역추적해야 했다
2. 이번 단계는 context를 쓰는 순간부터 self-check 결과를 같이 저장해, runbook/submit 이전에도 provenance drift를 단일 JSON에서 확인할 수 있게 한다
3. 따라서 V2에서는 “생성은 됐지만 어느 cycle의 산출물인지 불명확한 context”가 조용히 다음 단계로 넘어가는 위험을 줄인다

## 2026-04-22 Runbook Enforces Context Artifact Dir Self-Check

추가 증거:

1. `scripts/check-v2-canary-runbook.js`
2. `scripts/check-v2-promotion-submit-contract.js`
3. `src/tests/check-v2-canary-runbook.test.js`

판정:

1. runbook verifier `CHK_01A` 는 이제 `promotion-cloudbuild-context.json.artifact_dir_coherence.ok=true` 를 직접 요구한다
2. self-check의 `artifact_dir`, `resolved_artifact_dir`, `position_cycle_id`, `deploy_decision_position_cycle_id` 가 runbook expected cycle과 다르면 `CHK_01A=FAIL` 이다
3. self-check boolean flag 중 `artifact_dir_matches_resolved_artifact_dir`, `artifact_dir_contains_position_cycle_id`, `resolved_artifact_dir_contains_position_cycle_id`, `context_cycle_matches_deploy_decision` 중 하나라도 false면 runbook이 실패한다
4. submit contract는 runbook verifier가 `artifact_dir_coherence` 를 실제로 참조하지 않으면 실패한다

V1 약점 재발 방지:

1. V1에서는 “진단 필드가 존재하지만 gate가 읽지 않는” 장식성 관측값이 운영 판단을 흐릴 수 있었다
2. 이번 단계는 context self-check를 runbook fail-closed 조건에 연결해, 관측값과 게이트 판단이 분리되는 문제를 줄인다
3. 따라서 V2에서는 final artifact dir drift가 context에 기록만 되고 승격 검토를 통과하는 경로를 차단한다

## 2026-04-22 Submit Enforces Context Artifact Dir Self-Check

추가 증거:

1. `scripts/submit-v2-promotion-cloudbuild.js`
2. `scripts/check-v2-promotion-submit-contract.js`
3. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
4. `src/tests/submit-v2-promotion-cloudbuild.test.js`

판정:

1. submit wrapper `SUBMIT_CHK_01A` 는 이제 `promotion-cloudbuild-context.json.artifact_dir_coherence.ok=true` 를 직접 요구한다
2. self-check의 `artifact_dir`, `resolved_artifact_dir`, `position_cycle_id`, `deploy_decision_position_cycle_id` 가 submit request artifact dir와 deploy/preflight/manifest cycle에 맞지 않으면 provenance blocker다
3. `approval_evidence_sources.resolved_artifact_dir.field` 는 `artifact_dir_coherence` 를 포함해 운영자에게 어떤 필드를 봐야 하는지 노출한다
4. submit contract는 submit wrapper가 `artifact_dir_coherence` 를 실제로 참조하지 않으면 실패한다

V1 약점 재발 방지:

1. V1에서는 runbook과 최종 실행 wrapper가 서로 다른 증거 집합을 읽어 마지막 단계에서 판단이 갈라질 수 있었다
2. 이번 단계는 runbook `CHK_01A` 와 submit `SUBMIT_CHK_01A` 가 동일한 context self-check를 요구하도록 맞췄다
3. 따라서 V2에서는 context self-check가 false인데도 최종 submit만 통과하는 운영 drift를 차단한다

## 2026-04-22 Context Submit Trace Includes Artifact Dir Self-Check

추가 증거:

1. `scripts/run-v2-promotion-cloudbuild.js`
2. `scripts/check-v2-canary-runbook.js`
3. `scripts/check-v2-promotion-submit-contract.js`
4. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
5. `src/tests/run-v2-promotion-cloudbuild.test.js`
6. `src/tests/check-v2-canary-runbook.test.js`

판정:

1. `promotion-cloudbuild-context.json.submit_trace.relevant_submit_check_ids` 는 이제 `SUBMIT_CHK_01A` 를 포함한다
2. `artifact_dir_coherence.ok=false` 이면 context submit trace의 `failed_submit_check_ids` 에 `SUBMIT_CHK_01A` 가 남고, runbook refs `1,5,9` 로 역추적된다
3. 같은 경우 context top-level `recommended_next_action` 도 `DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT` 로 바뀐다
4. runbook verifier `CHK_13C` 는 context submit trace가 `SUBMIT_CHK_01A` 를 누락하거나 blocker family/reason code와 어긋나면 실패한다

V1 약점 재발 방지:

1. V1에서는 산출물 본문과 운영자용 trace가 같은 실패를 다르게 표현해 원인 추적이 늦어질 수 있었다
2. 이번 단계는 context 본문, submit trace, runbook verifier가 같은 artifact dir self-check 결과를 공유하게 만든다
3. 따라서 V2에서는 final dir drift가 발생했을 때 “무엇이 깨졌는지, runbook 몇 번을 봐야 하는지, 다음 행동이 무엇인지”가 context 하나에서 동시에 드러난다

## 2026-04-22 Submit Operator Trace Exposes Artifact Dir Self-Check

추가 증거:

1. `scripts/submit-v2-promotion-cloudbuild.js`
2. `scripts/lib/v2-promotion-operator-summary.js`
3. `scripts/lib/v2-promotion-submit-operator-alert.js`
4. `scripts/check-v2-promotion-submit-contract.js`
5. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
6. `src/tests/submit-v2-promotion-cloudbuild.test.js`
7. `src/tests/v2-promotion-submit-operator-alert.test.js`

판정:

1. submit wrapper는 `promotion-cloudbuild-context.json.artifact_dir_coherence` 를 `approval_verification.artifact_dir_coherence_summary` 로 승격한다
2. 같은 summary는 `submit_trace_summary.artifact_dir_coherence_summary` 로 이어져 operator summary와 alert preview가 재사용한다
3. operator line set은 `artifact_dir_coherence`, `artifact_dir_coherence_reason`, `artifact_dir_coherence_flags`, `artifact_dir_coherence_file` 을 노출한다
4. alert preview trace section도 같은 네 줄을 노출하므로 Telegram/CLI preview에서만 self-check 원인이 사라지지 않는다
5. submit contract `SUBMIT_CONTRACT_CHK_38` 은 이 노출 경로와 문서 계약을 fail-closed 로 검사한다

V1 약점 재발 방지:

1. V1에서는 gate가 차단해도 운영자가 raw JSON 여러 개를 열어야 실제 원인을 확인하는 경우가 있었다
2. 이번 단계는 `SUBMIT_CHK_01A` 차단 시 어느 self-check flag가 깨졌는지를 운영자 메시지 첫 화면에 올린다
3. 따라서 V2에서는 provenance blocker가 단순한 `BLOCKED` 문구로 뭉개지지 않고, final dir drift / cycle drift / context self-check 실패가 같은 trace에서 분리된다

## 2026-04-22 Submit Lineage Consistency Trace

추가 증거:

1. `scripts/submit-v2-promotion-cloudbuild.js`
2. `scripts/lib/v2-promotion-operator-summary.js`
3. `scripts/lib/v2-promotion-submit-operator-alert.js`
4. `scripts/check-v2-promotion-submit-contract.js`
5. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
6. `src/tests/submit-v2-promotion-cloudbuild.test.js`

판정:

1. submit wrapper `SUBMIT_CHK_08` 은 이제 bounded artifact hash 일치, CloudBuild context와 deploy decision hash 일치, context `lineage_consistency_summary` 를 모두 요구한다
2. `approval_verification.lineage_consistency_summary` 는 `bounded_lineage_ok`, `context_hash_matches_deploy_decision`, `context_lineage_ok` 를 분리해 보존한다
3. 같은 summary는 `submit_trace_summary.lineage_consistency_summary` 로 이어지고, operator summary / alert preview trace에 `lineage_consistency`, `lineage_consistency_reason`, `lineage_bounded_ok`, `lineage_context_hash_match`, `lineage_context_ok` 로 노출된다
4. submit contract는 이 노출 경로를 `SUBMIT_CONTRACT_CHK_46` 로 fail-closed 검사한다

V1 약점 재발 방지:

1. V1에서는 provenance mismatch가 단순 hash mismatch나 generic blocker로만 보이면 어느 레이어가 틀어졌는지 바로 알기 어려웠다
2. 이번 단계는 context trace와 최종 submit wrapper의 `SUBMIT_CHK_08` 의미를 실제 lineage consistency로 맞췄다
3. 따라서 V2에서는 preflight/runtime/deploy는 맞는데 CloudBuild context만 stale인 경우, 또는 context 내부 summary만 틀어진 경우를 운영자 메시지에서 분리해 볼 수 있다

## 2026-04-22 Production Live Entry Request Sizing Lock

추가 증거:

1. `src/v2/productionEntryLiveRequest.js`
2. `src/v2/productionEntryLiveTransports.js`
3. `src/v2/productionCutoverAudit.js`
4. `scripts/check-v2-promotion-deploy-decision.js`
5. `src/tests/v2-production-entry-live-request.test.js`
6. `src/tests/v2-production-entry-live-transports.test.js`
7. `src/tests/v2-production-cutover-audit.test.js`

판정:

1. V2 LIVE entry request는 이제 `buildV2ProductionEntryLiveRequest` 를 통해 OpenClaw bundle에 approved `entrySizingDecision` 을 먼저 내장할 수 있다
2. sizing이 budget/min-order/step-size 계약을 통과하지 못하면 endpoint body 자체를 만들지 않고 `V2_PRODUCTION_ENTRY_LIVE_SIZING_NOT_APPROVED` 로 fail-closed 한다
3. live transport는 body-level sizing과 bundle-level sizing이 동시에 존재하면서 다르면 `V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_CONFLICT` 로 route 호출 전 차단한다
4. production cutover audit는 `V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REJECT_SIZING_CONFLICT` 와 `V2_PRODUCTION_ENTRY_LIVE_REQUEST_BUILDER_EMBEDS_SIZING` 을 새 필수 계약으로 본다
5. deploy decision의 `SUBMIT_CHK_20` 계열 필수 check 목록도 같은 두 항목을 요구한다
6. `test:v2-promotion` 은 live request builder 테스트를 포함한다

V1 약점 재발 방지:

1. V1에서는 entry decision, runtime qty, 보호주문 qty가 서로 다른 레이어에서 다시 계산되며 TP/보호주문 drift가 반복됐다
2. 이번 단계는 LIVE 요청 생성 시점부터 OpenClaw bundle과 sizing evidence를 하나로 묶고, 서로 다른 sizing source가 섞이면 transport 생성 전 차단한다
3. 따라서 “결정은 A인데 수량은 B”인 요청이 Binance transport까지 내려가는 경로를 줄였다

## 2026-04-22 Production Protected Entry Canary

추가 증거:

1. `src/v2/productionEntryProtectedCanary.js`
2. `scripts/run-v2-production-entry-protected-canary.js`
3. `src/tests/v2-production-entry-protected-canary.test.js`
4. `src/tests/run-v2-production-entry-protected-canary.test.js`
5. `package.json`
6. `docs/DONBEOLJA_V2_ENTRY_ARCHITECTURE_2026-04-20.md`
7. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`

판정:

1. protected canary는 `buildV2ProductionEntryLiveRequest` 에서 approved sizing을 먼저 만든다
2. canary는 `runV2ProductionEntryRoute` 의 기본 kernel/submitter/protection activation을 우회하지 않는다
3. 거래소 write transport만 no-exchange fake로 바꾸고, Firestore write boundary는 memory batch adapter로 통과시킨다
4. 성공 artifact는 route success, kernel audit ok, `ACTIVE_PROTECTED`, SL/TP1 order id, batch commit count, no-exchange flag를 모두 보존한다
5. `test:v2-promotion` 은 protected canary 테스트를 포함한다

V1 약점 재발 방지:

1. V1에서는 게이트/라우터와 보호주문 activation이 분리되어, 진입 후 TP1/SL native 주문 누락이 늦게 발견됐다
2. 이번 단계는 LIVE 전환 전 no-exchange 환경에서 “요청 -> 라우터 -> 커널 -> submitter -> protection activation -> runtime doc” 체인을 한 번에 증명한다
3. 따라서 V2는 route만 통과하고 보호주문 체인이 깨지는 회귀를 promotion 테스트에서 먼저 잡을 수 있다

## 2026-04-22 Protected Entry Canary Promotion Gate

추가 증거:

1. `scripts/run-v2-promotion-pipeline.js`
2. `scripts/generate-v2-unified-promotion-report.js`
3. `scripts/check-v2-promotion-deploy-decision.js`
4. `scripts/submit-v2-promotion-cloudbuild.js`
5. `scripts/lib/v2-promotion-submit-trace.js`
6. `src/tests/run-v2-promotion-pipeline.test.js`
7. `src/tests/check-v2-promotion-deploy-decision.test.js`
8. `src/tests/submit-v2-promotion-cloudbuild.test.js`
9. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
10. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. promotion pipeline은 CANARY/LIVE 실행마다 `v2_production_entry_protected_canary_latest.json` 를 현재 artifact dir에 fresh 생성한다
2. unified promotion report는 이를 `bounded_runtime_summary.production_entry_protected_canary` 로 승격한다
3. deploy decision은 CANARY/LIVE에서 protected canary가 없거나 실패하면 `DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED` 로 차단한다
4. submit request는 `approval_contract.production_entry_protected_canary_required=true` 와 `approval_evidence_sources.production_entry_protected_canary` 를 노출한다
5. submit verification은 `SUBMIT_CHK_20A` 로 이 필드를 다시 검사하고 runbook checklist `27A` 로 역추적한다

V1 약점 재발 방지:

1. V1에서는 route/gate 통과와 보호주문 실제 활성화가 분리되어, 진입 후 보호주문 누락을 watchdog 경고로 뒤늦게 발견했다
2. 이번 단계는 promotion 실행마다 no-exchange 방식으로 submitter/protection activation/runtime write 체인을 실제로 통과시킨다
3. 따라서 V2에서는 route만 정상이고 SL/TP1 보호주문 체인이 깨진 상태로 CANARY/LIVE 제출되는 경로를 fail-closed 한다

## 2026-04-22 Protected Entry Canary Blocker Family

추가 증거:

1. `scripts/run-v2-promotion-cloudbuild.js`
2. `scripts/submit-v2-promotion-cloudbuild.js`
3. `scripts/lib/v2-promotion-operator-summary.js`
4. `scripts/lib/v2-promotion-submit-operator-alert.js`
5. `src/tests/run-v2-promotion-cloudbuild.test.js`
6. `src/tests/submit-v2-promotion-cloudbuild.test.js`
7. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
8. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. `DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED` 는 이제 `has_production_entry_protected_canary_blocker=true` 로 별도 분류된다
2. `SUBMIT_CHK_20A` 실패는 `PROTECTED_ENTRY_CANARY` family로 먼저 노출되고, bounded runtime family는 보조 신호로만 남는다
3. recommended action은 `FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION` 으로 고정된다
4. operator summary와 Telegram preview trace는 `protected_entry_canary_blocker=YES` 를 표시한다
5. runbook checklist `27A` 는 submit trace, artifact contract, operator summary가 같은 문제를 가리키는지 확인한다

V1 약점 재발 방지:

1. V1에서는 보호주문 누락이 일반 TP/stop 상태 오류와 섞여 원인 판독이 늦었다
2. 이번 단계는 보호주문 체인 실패를 별도 blocker family로 승격해 운영자가 “SL/TP1 보호주문 증명 실패”를 즉시 읽게 만든다
3. 따라서 보호주문 문제를 bounded runtime 재생성으로만 처리하다가 실제 원인 수정을 놓치는 경로를 줄인다

## 2026-04-22 Protected Entry Canary Context Trace

추가 증거:

1. `scripts/run-v2-promotion-cloudbuild.js`
2. `scripts/check-v2-canary-runbook.js`
3. `src/tests/run-v2-promotion-cloudbuild.test.js`
4. `src/tests/check-v2-canary-runbook.test.js`
5. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
6. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. CloudBuild context submit trace는 보호주문 canary blocker가 있을 때 `SUBMIT_CHK_20A` 를 relevant/failed check에 포함한다
2. 해당 실패는 runbook checklist `27A` 로 즉시 역추적된다
3. runbook verifier도 같은 조건을 검사하므로 context trace와 submit wrapper trace가 서로 다른 문제 분류를 만들 수 없다
4. 일반 context trace는 기존 `SUBMIT_CHK_01A/06/07/08` 경로를 유지한다

V1 약점 재발 방지:

1. V1에서는 보호주문 누락 원인이 watchdog/TP 상태 오류로 늦게 드러났다
2. 이번 단계는 deploy decision이 보호주문 canary 실패를 보는 즉시 CloudBuild context에서 `SUBMIT_CHK_20A -> 27A` 로 연결한다
3. 따라서 submit wrapper를 열기 전에도 운영자가 “보호주문 체인 실패”를 정확히 판단할 수 있다

## 2026-04-22 Protected Entry Canary Final Status Line

추가 증거:

1. `scripts/run-v2-promotion-cloudbuild.js`
2. `scripts/check-v2-canary-runbook.js`
3. `src/tests/run-v2-promotion-cloudbuild.test.js`
4. `src/tests/check-v2-canary-runbook.test.js`
5. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
6. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. `promotion-cloudbuild-context.json.final_status_line` 은 보호주문 canary blocker가 있으면 `protected_entry_canary=BLOCKED` 를 포함한다
2. runbook verifier는 보호주문 canary blocker와 final status line의 표기가 서로 어긋나면 실패한다
3. 따라서 operator가 context 파일 첫 줄만 봐도 보호주문 체인 실패를 즉시 식별할 수 있다

V1 약점 재발 방지:

1. V1에서는 보호주문 누락이 TP/stop/lineage 오류와 섞여 한 줄 상태에서 원인 계열을 읽기 어려웠다
2. 이번 단계는 최종 상태 라인, submit trace, runbook 27A를 같은 보호주문 canary 의미로 묶는다
3. 따라서 보호주문 실패를 단순 bounded runtime 재생성 문제로 오판하는 경로를 줄인다

## 2026-04-22 Protected Entry Canary Fresh Artifact Provenance

추가 증거:

1. `scripts/generate-v2-unified-promotion-report.js`
2. `scripts/check-v2-promotion-deploy-decision.js`
3. `src/tests/generate-v2-unified-promotion-report.test.js`
4. `src/tests/check-v2-promotion-deploy-decision.test.js`
5. `src/tests/run-v2-promotion-pipeline.test.js`
6. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
7. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. unified report는 protected canary를 읽을 때 `artifact_file`, `artifact_dir`, `artifact_filename`, `artifact_current_dir_match` 를 같이 승격한다
2. deploy decision은 CANARY/LIVE에서 `artifact_filename=v2_production_entry_protected_canary_latest.json` 및 `artifact_current_dir_match=true` 가 아니면 `DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED` 로 차단한다
3. promotion pipeline 통합 테스트는 실제 artifact dir에 생성된 fresh canary가 deploy decision까지 그대로 연결되는지 확인한다

V1 약점 재발 방지:

1. V1에서는 latest 계열 artifact가 존재해도 “이번 실행에서 생성된 증거인가”가 불명확해 stale 상태를 정상으로 오판할 여지가 있었다
2. 이번 단계는 보호주문 canary pass 자체와 artifact provenance를 같은 승인 조건으로 묶는다
3. 따라서 오래된 `ops/daily` 또는 다른 cycle의 protected canary를 가져와 CANARY/LIVE 승격을 통과시키는 경로를 차단한다

## 2026-04-22 Repair And Route Streak Fresh Artifact Provenance

추가 증거:

1. `scripts/generate-v2-unified-promotion-report.js`
2. `scripts/check-v2-promotion-deploy-decision.js`
3. `src/tests/check-v2-promotion-deploy-decision.test.js`
4. `src/tests/generate-v2-unified-promotion-report.test.js`
5. `src/tests/run-v2-promotion-pipeline.test.js`
6. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
7. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. unified report는 repair firestore streak와 production route streak에도 `artifact_file`, `artifact_dir`, `artifact_filename`, `artifact_current_dir_match` 를 같이 승격한다
2. LIVE deploy decision은 repair streak의 `artifact_filename=v2_repair_queue_firestore_canary_streak_latest.json` 및 `artifact_current_dir_match=true` 를 요구한다
3. LIVE deploy decision은 production route streak의 `artifact_filename=v2_production_entry_route_canary_streak_latest.json`, `artifact_current_dir_match=true`, `history_source=FIRESTORE` 를 동시에 요구한다
4. CANARY에서는 readiness warning으로 남기되, LIVE 승격은 stale streak를 정상 증거로 인정하지 않는다

V1 약점 재발 방지:

1. V1에서는 비용 절감/감사 artifact가 많아지면서 latest 파일과 현재 실행 cycle의 경계가 흐려졌다
2. 이번 단계는 보호주문 canary뿐 아니라 repair/route streak도 “현재 artifact dir에서 방금 생성된 증거”인지 확인한다
3. 따라서 과거 streak pass 파일을 재사용해 LIVE 승격 조건을 만족한 것처럼 보이는 경로를 차단한다

## 2026-04-22 Stale Artifact Provenance Blocker Family

추가 증거:

1. `scripts/check-v2-promotion-deploy-decision.js`
2. `scripts/run-v2-promotion-cloudbuild.js`
3. `scripts/submit-v2-promotion-cloudbuild.js`
4. `scripts/check-v2-canary-runbook.js`
5. `src/tests/check-v2-promotion-deploy-decision.test.js`
6. `src/tests/run-v2-promotion-cloudbuild.test.js`
7. `src/tests/submit-v2-promotion-cloudbuild.test.js`
8. `docs/DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md`
9. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`

판정:

1. deploy decision은 current artifact dir과 맞지 않는 repair streak, production route streak, protected canary를 `DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:*` 로 별도 차단한다
2. CloudBuild context는 `has_stale_artifact_provenance_blocker=true`, `STALE_ARTIFACT_PROVENANCE` family, `STALE_ARTIFACT_PROVENANCE_BLOCKER` reason code를 노출한다
3. final status line은 `stale_artifact=BLOCKED` 를 포함해 첫 판독 지점에서 stale artifact 문제를 드러낸다
4. submit verification도 stale artifact provenance를 bounded runtime 누락보다 먼저 `DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE` 로 안내한다

V1 약점 재발 방지:

1. V1에서는 “증거 없음”과 “증거는 있지만 오래됨”이 같은 운영 조치로 묶여 원인 판독이 늦었다
2. 이번 단계는 stale artifact를 독립 family로 승격해, 보호주문/route/repair 본체가 아니라 artifact cycle을 다시 만드는 문제임을 분리한다
3. 따라서 stale latest 파일 때문에 실제 시스템 품질을 잘못 평가하거나 엉뚱한 본체 수정을 반복하는 경로를 줄인다

## 2026-04-22 Stale Artifact Operator Trace

추가 증거:

1. `scripts/lib/v2-promotion-operator-summary.js`
2. `scripts/lib/v2-promotion-submit-operator-alert.js`
3. `scripts/check-v2-promotion-submit-contract.js`
4. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
5. `src/tests/v2-promotion-submit-operator-alert.test.js`

판정:

1. `STALE_ARTIFACT_PROVENANCE` blocker family 또는 `STALE_ARTIFACT_PROVENANCE_BLOCKER` reason code가 있으면 operator summary는 `stale_artifact_provenance_blocker=YES` 를 표시한다
2. Telegram/CLI preview trace section도 같은 `stale_artifact_provenance_blocker=YES` 라인을 표시한다
3. submit contract는 이 라인이 formatter, alert preview, artifact contract 문서에 모두 남아 있는지 `SUBMIT_CONTRACT_CHK_39` 로 fail-closed 검사한다
4. 기존 contract check id는 한 칸씩 뒤로 밀려 lineage consistency trace 검사는 `SUBMIT_CONTRACT_CHK_46` 이 됐다

V1 약점 재발 방지:

1. V1에서는 stale latest artifact와 실제 runtime 결함이 같은 bounded blocker처럼 보여 원인 판독이 늦었다
2. 이번 단계는 최종 운영 메시지에서 stale artifact provenance를 별도 라인으로 올려, 본체 수정이 아니라 fresh promotion pipeline 재실행이 필요한 상황을 즉시 구분하게 한다
3. 따라서 오래된 evidence 때문에 보호주문/route/repair 본체를 잘못 수정하는 운영 낭비와 원인 혼선을 줄인다

## 2026-04-22 Approval Verification Stale Blocker Contract

추가 증거:

1. `docs/DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md`
2. `scripts/check-v2-promotion-submit-contract.js`
3. `scripts/submit-v2-promotion-cloudbuild.js`

판정:

1. `approval_verification.blocker_summary` 의 최소 필드에 `has_stale_artifact_provenance_blocker` 를 추가했다
2. stale artifact provenance 실패의 운영 조치를 `DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE` 로 artifact contract에 고정했다
3. submit contract checker는 operator summary, alert preview, artifact contract, submit wrapper가 같은 stale blocker 필드를 유지하는지 fail-closed로 검사한다

V1 약점 재발 방지:

1. V1에서는 최종 submit artifact와 operator 메시지가 서로 다른 blocker 언어를 써서 원인 판독이 늦었다
2. 이번 단계는 stale artifact provenance를 `approval_verification` 최소 계약에 넣어, 문서-코드-운영 메시지가 같은 필드를 보도록 강제한다
3. 따라서 stale latest 증거를 runtime 결함으로 오진하거나 fresh promotion 재실행 대신 본체 수정을 반복하는 경로를 차단한다
