# DONBEOLJA V2 Build Roadmap

## 원칙

V2는 한 번에 완성하지 않는다.

각 단계는 아래 세 조건을 만족해야 다음 단계로 간다.

1. 코드 구현 완료
2. 시니어급 품질검사 체크리스트 통과
3. replay 또는 simulation 증거 확보

## 단계 0. 착수 준비

### 목표

V2 작업 공간과 운영 경계를 분리한다.

### 작업

1. V2 runtime namespace 결정
2. V2 Firestore collection prefix 결정
3. V2 env contract 문서화
4. V2 service boundary 고정
5. V1 freeze policy 문서화
6. OpenClaw supreme control boundary 문서화
7. ML+AI signal authority boundary 문서화

### 완료 기준

1. V1과 V2가 같은 collection을 쓰지 않는다
2. live write 권한 서비스가 명시된다
3. rollback 경로가 문서화된다
4. OpenClaw가 최상위 의사결정권자이고, deterministic kernel과 권한이 분리됨이 문서로 고정된다

## 단계 1. Data Contract

### 목표

코드보다 먼저 데이터 계약을 고정한다.

### 구현물

1. `position_cycles_v2`
2. `canonical_exit_transitions_v2`
3. `exit_runtime_projection_v2`
4. `protection_runtime_v2`
5. `trade_alert_outbox_v2`
6. `signal_intents_v2`
7. `ml_ai_evidence_ledger_v2`

### 품질검사

1. 각 문서의 필수 필드 null 금지 목록 점검
2. `position_cycle_id` 생성 규칙 중복성 점검
3. `entry_event_id` 누락 시 write reject 테스트

### 완료 기준

1. schema fixtures 생성
2. validator 통과 테스트 존재
3. null lineage active position 생성 불가
4. signal source mode 누락 intent 생성 불가

## 단계 2. Entry + Native Protection

### 목표

진입 직후 보호주문을 안정적으로 형성한다.

### 구현물

1. entry executor
2. protection writer
3. entry fill persistence
4. native SL order placement
5. native TP1 order placement
6. signal authority router skeleton

### 품질검사

1. SL만 성공한 경우
2. TP1만 성공한 경우
3. 둘 다 성공한 경우
4. 둘 다 실패한 경우
5. cancel-first gap이 얼마인지 측정 가능한지

### 완료 기준

1. `position_cycle_id` 없는 active position 0
2. 보호주문 결과가 projection에 반영
3. `TP1_ORDER_MISSING` 재현 테스트 존재
4. `SERVER_NATIVE_ML_AI`도 동일 entry contract를 사용

## 단계 3. Canonical Exit Reducer

### 목표

exit 판단 권한을 한 reducer로 모은다.

### 구현물

1. canonical transition reducer
2. stage enum 고정
3. transition event enum 고정
4. absolute qty ledger

### 품질검사

1. TP1 fill -> `TP1_REACHED`
2. split TP1 fills -> aggregate close 전까지 transition write 금지
3. trail activate -> `TRAIL_ACTIVATED`
4. SL fill -> `SL_HIT`
5. manual close -> `MANUAL_CLOSE_SYNC`
6. 중복 fill -> idempotent 처리
7. final stop fill은 `fullExit=true` + 실제 stop fill 근거 없으면 terminal transition write 금지

### 완료 기준

1. transition event writer가 하나
2. TP1/TRAIL lineage 누락 시 reducer reject
3. ledger mismatch hard fail
4. `binanceFuturesFillsSync` shadow writer는 alert/stage 추정 없이 실제 fill과 누적 수량 근거로만 `TP1_REACHED`를 기록
5. stop exit는 event 문자열보다 projection 현재 stage를 우선해 `SL_HIT` / `TRAIL_HIT`를 결정

## 단계 4. Tick Exit Worker

### 목표

TP1 이후 trail만 단순하게 관리한다.

### 구현물

1. trail watermark updater
2. trail stop calculator
3. protection writer refresh request
4. trail observation store

### 품질검사

1. TP1 전에는 trail 실행 금지
2. watermark 0 bootstrap jam 없음
3. chosen stop source와 native stop 일치
4. runner floor 미보장 시 issue 발생
5. `TRAIL_ACTIVATED`는 tick worker의 실제 native stop refresh 성공과 `chosen_stop_source=TRAIL`일 때만 기록

### 완료 기준

1. `TRAIL_STOP_MISSING` 자동 검출
2. `chosen_stop_source` 저장
3. `final_effective_stop` 저장
4. trail activation은 tick metadata 추정이 아니라 stop refresh evidence로만 canonical write

## 단계 5. Alert Pipeline

### 목표

alert를 canonical transition 후행 처리로 단순화한다.

### 구현물

1. alert outbox v2
2. transition 기반 telegram formatter
3. dedupe key = `canonical_transition_id`

### 품질검사

1. TP1 alert silent drop 0
2. retry 시 중복 방지
3. channel fail 시 durable failure 남김

### 완료 기준

1. alert source가 fill이 아니라 transition
2. outbox prep fail도 durable 기록
3. operator가 transition과 alert를 1:1 매핑 가능

## 단계 6. Watchdog + Repair Queue

### 목표

감시와 수리를 분리한다.

### 구현물

1. active exit watchdog v2
2. repair queue
3. repair executor

### 품질검사

1. TP1_ORDER_MISSING
2. NATIVE_REFRESH_UNHEALTHY
3. TRAIL_STOP_MISSING
4. UNPROTECTED_ACTIVE_POSITION
5. 거래소는 flat인데 projection이 terminal이 아니면 `TERMINAL_TRANSITION_MISSING`
6. latest transition은 terminal인데 projection stage가 남아 있으면 `TERMINAL_PROJECTION_MISMATCH`
7. projection은 terminal인데 거래소 active position이 남아 있으면 `TERMINAL_STAGE_WITH_ACTIVE_POSITION`

### 완료 기준

1. watchdog는 read-only
2. protection writer만 exchange writer이고 repair executor는 delegate-only
3. repair queue consumer는 bounded batch / duplicate suppression / terminal skip 기준으로 delegate-only 동작
4. repair queue worker는 Firestore queue fetch와 `POSITION_CYCLES` / projection / protection runtime context hydrate를 bounded하게 수행
5. repair execution ledger가 delegated / skipped 결과를 durable하게 남김
6. repair completion ledger가 protection writer handoff 결과를 `COMPLETED_SUCCESS` / `COMPLETED_FAILED` 로 durable하게 남김
7. live worker shell은 executor throw도 `COMPLETED_FAILED` 로 durable하게 남김
8. live service entrypoint는 `HEALTHY` / `DEGRADED` / `DISABLED` verdict와 fail-closed blocker reason을 같은 정본 summary로 제공해야 함
9. CLI / job entrypoint도 same verdict artifact를 남기고, executor가 미구현이면 `V2_REPAIR_QUEUE_EXECUTOR_NOT_IMPLEMENTED` 로 fail-closed 해야 함
10. delegated repair executor adapter는 protection writer delegation만 소비하고, transport 미주입은 `REPAIR_TRANSPORT_MISSING` 으로 completion ledger에 닫아야 함
11. Binance transport adapter는 명시적 context resolver 없이는 symbol / liveCfg / side를 추론하지 않고, `BINANCE_TICK_EXIT` writer source만 주입해야 함
12. Binance repair context resolver는 `position_cycle_id` 문자열 파싱을 금지하고, delegated envelope의 `position_cycle_snapshot` 에서만 symbol / side / entry price를 복원해야 함
13. live Binance cfg는 V2 repair live cfg resolver를 통해서만 들어오며, key missing / live disabled / non-Binance exchange는 fail-closed 해야 함
14. repair queue service는 기존 scheduler SSOT인 `OPENCLAW_CRON` manifest에만 등록되고, 별도 cron/source-of-truth를 만들면 안 됨
15. repair queue service scheduler는 `v2_repair_queue_service_latest.json` artifact를 남기고 automation watchdog freshness check에 연결되어야 함
16. terminal transition / projection / exchange state 셋 중 하나라도 어긋나면 issue code로 즉시 관측 가능
17. collector -> replay artifact -> unified report -> deploy decision 까지 같은 terminal mismatch blocker가 유지됨
18. canary candidate selector / preflight 단계에서도 terminal mismatch cycle은 후보군에서 제외됨
19. canary flow orchestration도 terminal mismatch cycle을 `PREFLIGHT_BLOCKED` 로 종료함
20. canary flow auto-select 모드도 candidate artifact를 남기고 terminal mismatch를 `CANDIDATE_BLOCKED` 로 종료함
21. cloudbuild / submit 경로도 auto-select canary env와 candidate exchange state를 그대로 전달하고, deploy decision에 선택된 `position_cycle_id` 가 없으면 fail-closed 해야 함
22. repair queue dry-run canary는 Firestore emulator와 Binance 없이 메모리 fixture만으로 queue -> `POSITION_CYCLES` context hydrate -> delegated executor -> Binance transport adapter -> completion ledger까지 통과해야 하며, artifact에 `exchange_write_performed=false` 와 `BINANCE_TICK_EXIT` writer source 증거를 남겨야 함
23. live repair enable 전 preflight는 repair queue canary artifact의 freshness, dry-run mode, no exchange write, `BINANCE_TICK_EXIT` writer source, completion ledger, secret 미노출을 모두 검사하고 하나라도 깨지면 fail-closed 해야 함
24. repair queue service entrypoint와 scheduler wrapper는 canary preflight 없이 Binance transport binding을 실행할 수 없어야 하며, watchdog는 service artifact뿐 아니라 canary/preflight artifact freshness도 같이 감시해야 함
25. paper/shadow 운영 canary는 repair request를 fixture로 미리 심지 않고 watchdog가 `TRAIL_STOP_MISSING` 을 감지해 생성한 request를 queue가 소비하고 completion ledger까지 닫는 증거를 남겨야 함
26. live repair enable preflight는 dry-run canary뿐 아니라 paper/shadow 운영 canary의 watchdog-generated request, no exchange write, completion success, secret 미노출도 필수로 검사해야 함
27. service entrypoint를 wrapper 밖에서 직접 실행해도 Binance transport binding이 켜져 있으면 operational canary preflight가 자동 강제되어야 함
28. Firestore-backed paper canary는 isolated collection prefix에 fixture를 실제 write한 뒤, 같은 Firestore adapter로 `status=PENDING` repair request를 읽고 queue -> completion ledger까지 닫아야 함
29. repair queue fetch는 stale/completed request가 새 복구를 가로막지 않도록 `status=PENDING` 만 bounded scan 해야 함
30. Firestore-backed canary를 24시간 증거 수집에 붙일 때는 수동 `cp && launchctl` 이 아니라 setup script가 source plist, target plist, loaded_before/after, enable/kickstart 결과를 artifact로 남겨야 함
31. Firestore-backed canary launchd collector는 active cron SSOT에는 기본 등록하지 않고, opt-in 등록 절차와 streak gate 통과 증거가 있을 때만 live repair preflight 필수 조건으로 승격해야 함

## 단계 6A. OpenClaw Supreme Control Plane

### 목표

OpenClaw를 V2의 최상위 의사결정 시스템으로 붙이되, deterministic execution kernel과 분리한다.

### 구현물

1. OpenClaw decision input schema
2. canonical evidence summary builder
3. signal mode / policy decision contract
4. repair recommendation formatter
5. deploy / rollback recommendation contract

### 품질검사

1. OpenClaw가 canonical transition 없는 exit를 임의로 단정하지 않는가
2. OpenClaw가 exchange writer 없이도 최상위 결정을 내릴 수 있는가
3. issue summary가 watchdog / projection / transition과 일치하는가
4. OpenClaw decision과 실제 execution evidence가 사후 비교 가능한가

### 완료 기준

1. OpenClaw가 supreme control plane으로 고정
2. operator summary가 canonical evidence에서 재현 가능
3. signal/policy/repair/deploy decision 근거가 durable하게 남음
4. OpenClaw 승인만으로 entry execution이 진행되지 않고, deterministic router와 entry execution kernel이 같은 signal/openclaw lineage를 다시 확인해야 함
5. shadow / hard-guard-blocked / non-approved decision이 임의 router bypass나 실행 객체 주입으로 entry까지 진행되면 audit가 fail-closed 해야 함

## 단계 6B. ML+AI Native Signal Plane

### 목표

웹훅 없이도 서버가 독자적으로 신호를 만들 수 있는 최소 골격을 만든다.

### 구현물

1. feature snapshot contract
2. ML+AI signal proposal interface
3. OpenClaw approval integration
4. signal authority router integration
5. evidence ledger writer
6. OpenClaw shadow signal writer
7. shadow/live comparison report
8. webhook-assisted vs server-native comparison report
9. unified promotion report
10. cloudbuild bounded promotion wrapper
11. deploy decision artifact
12. cloudbuild submit request artifact

### 품질검사

1. 동일 시장에서 webhook vs native signal 비교 가능성 존재
2. native signal이 budget / min-order / cluster risk를 사전에 통과하는가
3. ML unavailable 시 OpenClaw가 fail-closed 또는 shadow-only 정책을 명확히 적용하는가
4. shadow/live drift가 blocker와 warning으로 분리 집계되는가
5. webhook-assisted vs server-native 차이가 blocker와 warning으로 분리 집계되는가
6. operator가 replay/comparison/gate를 하나의 보고서로 읽을 수 있는가
7. 표준 artifact 3종을 mock producer로 자동 생성해 wrapper와 CI를 재현 가능한가
8. selector가 골라준 bounded 축을 collector가 다시 교차검증하는가
9. shadow writer failure가 V1 decision return을 바꾸지 않는가
10. shadow writer가 signal intent / decision 증적만 남기고 exchange write는 하지 않는가
11. entry bootstrap가 opening fill + full protection confirmed 조건에서만 active cycle을 쓰는가
12. webhook 시점과 fill 시점의 signal lineage가 같은 deterministic 축으로 재계산되는가

### 완료 기준

1. `SERVER_NATIVE_ML_AI` shadow mode 동작
2. native signal evidence가 durable하게 남음
3. OpenClaw 승인/차단 근거가 durable하게 남음
4. live authority 승격 전 비교 리포트 산출 가능
5. webhook-assisted shadow path에서 `signal_intents_v2` / `openclaw_decisions_v2` 가 실제 런타임에서 채워짐
6. opening fill + full protection confirmed 조건에서 `position_cycles_v2` / `protection_runtime_v2` / `exit_runtime_projection_v2` 가 실제 shadow runtime에서 채워짐
7. half-baked active cycle은 금지되며, protection incomplete 상태에서는 bootstrap write가 skip 되어야 함
8. 다음 단계는 entry 이후가 아니라 TP1/trail/live sync 쪽 runtime 갱신 writer를 붙이는 것이다
5. feature snapshot id 없이 ML+AI evidence 생성 불가
6. collector가 selector meta / projection / protection runtime / webhook policy scope 불일치를 즉시 fail-closed로 차단
6. ML+AI signal proposal 없이 native signal live/canary 경로 진행 불가
7. shadow/live proposal drift가 durable report로 산출 가능
8. webhook-assisted vs server-native 승인 차이가 durable report로 산출 가능
9. replay/comparison/gate 최종 판정이 단일 artifact로 고정됨
10. cloudbuild가 bounded canary/live mode에서 `position_cycle_id` 없는 승격 경로를 막음
11. `SHADOW` 결과가 deploy approve로 승격되지 않음
12. 실제 제출 substitutions가 artifact로 남아 사후 재현 가능
13. CANARY/LIVE 승격은 `openclaw_execution_separation_summary.ok=true`, `audit_n>0`, `fail_n=0` 없이는 fail-closed 해야 함
14. runtime snapshot collector/exporter/unified report/deploy decision이 같은 OpenClaw execution separation evidence를 끊김 없이 전달해야 함
15. OpenClaw execution separation audit는 artifact에만 남기지 말고 `openclaw_execution_audits_v2` durable ledger에 opt-in write 가능해야 하며, 기본값은 side-effect 방지를 위해 write disabled여야 함
16. CANARY/LIVE deploy decision은 `openclaw_execution_audit_ledger_write.reason=OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN`, `skipped=false`, `doc_id` 존재 증거가 없으면 fail-closed 해야 함
17. Cloud Build bounded CANARY/LIVE 경로는 `DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=1` 을 자동 전달하고, submit wrapper는 같은 증거를 `SUBMIT_CHK_10` / runbook checklist `18` 로 역추적 가능해야 함
18. LIVE deploy decision은 24시간 Firestore-backed repair queue canary streak pass 없이는 fail-closed 해야 하고, CANARY deploy decision은 같은 증거가 없으면 warning만 남겨 개발 진행성을 보존해야 함

### 현재 진행 상태

완료된 항목:

1. runtime snapshot collector
2. runtime snapshot exporter
3. replay artifact generator
4. comparison artifact generator
5. promotion gate
6. mock artifact generator
7. `position_cycle_id` 기준 bounded selector
8. selector -> collector -> exporter -> evaluator pipeline 연결
9. canary dry-run preflight
10. canary/live provenance + count fail-closed gate

남은 핵심:

1. 실제 Firestore production data로 canary artifact 1세트 수집
2. 실제 Firestore production data에서 preflight ready cycle 자동 선택 경로 고정
3. Cloud Build에서 selector 입력을 사용한 bounded promotion run 1회 실행
4. artifact provenance와 deploy decision을 묶는 운영 runbook 문서화
5. unified promotion report 하나로 승격 판정 가능
6. mock producer로 artifact 디렉터리 계약을 smoke 검증 가능

## 단계 7. Replay Gate

### 목표

배포 전 replay 없이는 통과 못 하게 한다.

### 구현물

1. replay fixture set
2. invariant runner
3. native ML evidence completeness check
4. deploy gate
5. CI wrapper script
6. artifact directory contract
7. mock artifact producer
8. replay artifact producer
9. comparison artifact producer
10. unified real promotion pipeline
11. runtime snapshot exporter
12. firestore runtime collector
13. bounded runtime selector guard
14. bounded canary candidate selector guard

### 품질검사

1. stage sequence mismatch 차단
2. missing transition 차단
3. native gap 초과 차단
4. alert missing 차단
5. comparison blocker 존재 시 승격 차단
6. canary/live에서 comparison warning 존재 시 승격 차단
7. unified promotion report가 replay/comparison/gate를 누락 없이 집계하는가
8. mock profile `CLEAN/WARN/BLOCKED` 가 gate 결과와 정확히 대응하는가
9. replay fixture profile이 reducer/watchdog/alert 무결성을 실제로 반영하는가
10. comparison fixture profile이 blocker/warning 정책을 실제로 반영하는가
11. real pipeline과 mock/gate-only가 상호배타적으로 강제되는가
12. runtime snapshot이 fixture와 manifest로 표준화되어 같은 evaluator를 타는가
13. collector가 explicit position cycle 축으로만 문서를 수집하는가
14. collector query row 수가 limit에 닿으면 truncation 위험으로 즉시 fail-closed 되는가
15. exporter가 oversized snapshot / 과다 pair count를 조용히 통과시키지 않는가
16. runtime selector가 recent window 밖 cycle과 limit 접촉 query를 조용히 통과시키지 않는가
17. candidate selector가 active universe scan limit 접촉과 stale cycle 평가를 조용히 통과시키지 않는가
18. unified promotion report가 selector/collector/exporter bounded summary와 candidate selection summary를 단일 artifact로 노출하는가

### 완료 기준

1. fail-closed
2. CI에서 실행
3. live deploy dependency로 연결
4. shadow/canary/live warning policy가 명시됨
5. CI가 호출하는 단일 fail-closed wrapper 존재
6. artifact 파일명 규약이 문서와 코드에서 동일함
7. mock producer로 opt-in CI smoke 재현 가능
8. replay-report가 실제 replay fixture evaluation 결과로 생성됨
9. comparison report 2종이 실제 comparison evaluation 결과로 생성됨
10. unified promotion report 하나만으로 provenance, bounded budget, candidate selection, gate 결과를 함께 검토 가능
10. CI가 real pipeline 한 경로로 artifact 생성과 gate를 묶어 실행 가능
11. runtime snapshot 입력이 replay/comparison fixture와 manifest로 export 가능
12. collector가 V2 firestore docs에서 runtime snapshot을 직접 생성 가능
13. collector query budget(limit/count)이 snapshot meta로 복원 가능
14. exporter manifest에 snapshot size bytes가 남고, oversize는 fail-closed 됨
15. runtime selector meta에 query limit / recent cutoff가 복원 가능
16. candidate selection artifact에 scan limit / recent window / active-recent count가 복원 가능

## 단계 8. Paper / Shadow / Canary

### 목표

V2를 실제 환경에 서서히 붙인다.

### 순서

1. local replay
2. paper runtime
3. shadow alert
4. micro live canary
5. OpenClaw shadow control
6. ML+AI shadow signal
7. OpenClaw primary canary
8. ML+AI micro canary

### canary 차단 조건

1. TP1 missing 1건 이상
2. native unhealthy 1건 이상
3. silent alert drop 1건 이상
4. unprotected gap SLA 초과
5. ML+AI evidence lineage 누락 1건 이상
6. OpenClaw recommendation과 canonical evidence 충돌 1건 이상

## 4주 로드맵

### Week 1

1. 단계 0 완료
2. 단계 1 완료
3. 단계 2 착수

산출물:

1. schema
2. validators
3. entry/protection skeleton

### Week 2

1. 단계 2 완료
2. 단계 3 완료

산출물:

1. entry + native protection pass
2. canonical reducer pass
3. replay fixtures 1차

### Week 3

1. 단계 4 완료
2. 단계 5 완료

산출물:

1. trail runtime pass
2. alert pipeline pass
3. watchdog issue taxonomy 초안

### Week 4

1. 단계 6 완료
2. 단계 6A 착수
3. 단계 6B 착수

산출물:

1. repair queue pass
2. OpenClaw supervision schema
3. ML+AI native signal schema

### Week 5

1. 단계 6A 완료
2. 단계 6B 완료
3. 단계 7 완료
4. 단계 8 paper 시작

산출물:

1. OpenClaw supervisory pass
2. ML+AI shadow signal pass
3. replay gate pass
4. paper shadow 운영 시작

## 단계별 시니어 품질검사 질문

매 단계마다 아래 질문에 예로 답할 수 있어야 한다.

1. 이 단계의 단일 writer는 누구인가
2. 실패 시 어떤 문서가 남는가
3. operator는 어디서 증거를 읽는가
4. 중복 이벤트는 어떻게 막는가
5. null lineage는 어디서 차단되는가
6. 잘못된 stage 승격은 어디서 차단되는가
7. 거래소와 projection이 불일치하면 누가 repair를 요청하는가
8. OpenClaw와 ML+AI는 어떤 권한이 없도록 막혀 있는가

## 절대 하지 말아야 할 일

1. V2 초기에 legacy early partial-take-profit contract 부활
2. V1 helper 무비판 복사
3. stage 판단을 service별로 재분산
4. alert에서 exit truth를 역추론
5. live에서 first-write 검증
