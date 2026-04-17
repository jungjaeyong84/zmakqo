# Donbeolja Full-System Quality Audit Prompt For Claude

아래 프롬프트를 그대로 Claude에 넣어라.

```text
너는 실전 자동매매/퀀트/거래 인프라를 오래 운영한 매우 냉정한 Staff+ / Principal 수준의 시스템 감사자다.
목표는 “돈벌자(donbeolja) 시스템”을 현재 코드 기준으로 전수 품질 검사하고, 실제로 돈을 잃게 만들 수 있는 약점과 운영 리스크를 찾아내는 것이다.

중요:
- 절대 추정으로 결론 내리지 말고, 반드시 코드/테스트/스크립트/설정 파일을 읽고 근거를 제시하라.
- 문서보다 코드를 신뢰하라. 문서와 코드가 다르면 “문서가 틀린 것”으로 취급하라.
- 칭찬, 격려, 추상적 총평보다 “구체적 결함, 재현 조건, 파급 영향, 우선순위”를 우선하라.
- 리뷰 스타일은 시니어 코드리뷰/운영감사 방식으로 하라.
- 가장 중요한 것은 “실전에서 어떤 방식으로 깨지는가”를 설명하는 것이다.

작업 대상 저장소:
- /Users/jeongjaeyong/Projects/donbeolja

현재 감사의 배경:
- 이 시스템은 Binance Futures 기반의 자동매매/청산/알림/감시/배포 게이트/운영 자동화가 뒤섞인 상태다.
- 최근 가장 큰 문제는 다음과 같았다:
  1. TP0 / TP1 / TRAIL / SL 로직 불안정
  2. canonical exit stage authority가 여러 레이어에 분산
  3. native stop / trailing writer가 중복될 위험
  4. simplified exit v2 전환 중 기존 로직 잔존 가능성
  5. Firestore 비용 폭증
  6. exit integrity cycle이 운영 감시와 배포 게이트를 동시에 떠안아 과도하게 무거워짐
- 최근 비용 대응으로 다음 변화가 들어갔다:
  - exit integrity cron이 분당에서 4시간 단위로 축소됨
  - exit integrity cycle에 ops / gate profile 분리 로직이 추가됨
  - 여러 report 스크립트에 lookback / where(created_at >= ...) / select() projection이 추가됨
- 하지만 이 변경이 “실제로 안전한지”, “사이드이펙트가 없는지”, “여전히 남은 구조적 결함이 무엇인지”는 아직 독립 감사가 필요하다.

감사 목표:
1. 시스템 전반의 구조적 품질 수준을 냉정하게 평가
2. 실손실, 오체결, 미청산, 중복청산, 알림 불일치, 상태 불일치, 배포 사고, 비용 폭증을 유발할 수 있는 지점을 식별
3. “지금 당장 고쳐야 할 것 / 곧 고쳐야 할 것 / 나중에 개선할 것”으로 우선순위화
4. 테스트가 있어도 놓치고 있는 blind spot을 찾기
5. 운영비/배포/관측성/롤백/설정 거버넌스 관점에서 약점 지적

반드시 검사할 축:

[A] 거래 상태기계 / 청산 권한 / 수량 계약
- stage authority가 진짜 한 곳에만 있는가
- TP0 / TP1 / TRAIL / FINAL EXIT가 raw fill, alert, watchdog, tick exit, repair 서비스 등에서 다시 추론되고 있지 않은가
- absolute qty contract ledger가 실제로 퍼센트 런타임 계산을 대체했는가
- entry_qty_abs / tp1_allowed_abs / runner_remaining_abs / consumed_abs 관련 불변식이 깨질 수 있는 경로가 있는가
- post-TP1 이후 TP0/TP1 재소비 가능성이 남아있는가
- simplified exit v2와 legacy flow가 섞여서 이중 동작하는 경로가 없는가

[B] TP1 / trailing / stop 실제 동작 신뢰성
- TP1이 “작도만 되고 실제 체결은 안 되는” 경로가 있는가
- trailing activation 이후 stop writer가 단일 권한자로 유지되는가
- native protection과 internal state가 어긋나도 자동 복구 가능한가
- trail floor / r-based trail / final effective stop 구분이 실제 코드상 일관적인가
- long / short 비대칭 버그가 있는가
- partial fill, split fill, websocket 누락, reconcile 지연 시 망가지는 흐름이 있는가

[C] 알림 / evidence / canonical transition layer
- 알림이 fill/raw event를 보고 직접 판단하지 않고 canonical transition만 보고 생성되는가
- alert와 state가 1:1로 맞는가
- duplicate suppression이 실제로 강한가
- alert outbox / runtime audit / fill evidence / canonical transitions 간 상호 모순 가능성이 없는가

[D] 운영 감시 / integrity cycle / 비용 구조
- Firestore read/egress를 여전히 과도하게 태우는 스크립트가 남아 있는가
- recent patch 이후에도 full-scan 위험이 남아 있는가
- ops profile과 gate profile이 정말 역할 분리가 됐는가
- 배포 게이트가 약해졌거나, 반대로 ops 감시가 여전히 너무 무거운가
- select()가 read cost는 못 줄이고 egress만 줄인다는 점을 감안할 때, 여전히 비용 hotspot은 무엇인가

[E] 엔트리 / 예산 / 드롭사유 / 실행권한
- MIN_ORDER_EXCEEDS_BUDGET, ALPHA_CONTEXT_BLOCK, ALLOCATOR_QUARANTINE 등 드롭 사유가 실제로 운영자가 해석 가능한 체계인지
- 예산/최소주문/레버리지/사이징 정책이 전 코인에 대해 현실적인지
- 신호는 살아 있는데 실행이 막히는 hidden gate가 너무 많은지
- 웹훅 없이 서버-native signal 경로가 실제로 자립 가능한 구조인지

[F] 배포 / 설정 / 스케줄 / 롤백
- cloudbuild, cron, launchd/openclaw cron, env, firestore settings, secrets, runtime wrapper가 서로 어긋날 수 있는가
- 스케줄 변경이 코드와 manifest에 동시에 반영되지 않을 가능성이 있는가
- rollback discipline이 충분한가
- fail-closed가 필요한 곳이 fail-open인지, 반대인지

[G] 테스트 품질
- 테스트가 실제 production risk를 잡는지, 아니면 happy-path 위주인지
- replay / integration / race condition / duplicate / stale merge / restart recovery / reconcile recovery / min-order / cost guard 케이스가 부족한 곳이 어디인지
- 테스트가 코드 구조 변경에 과적합돼 의미 없는 snapshot 수준으로 전락한 곳이 있는지

반드시 우선 열어볼 파일/영역:

핵심 서비스:
- src/services/positionStateMachine.js
- src/services/binanceTickExit.js
- src/services/binanceFuturesFillsSync.js
- src/services/tradeExecutionAlert.js
- src/services/liveTrailingStageRepair.js
- src/services/binanceActiveExitWatchdog.js
- src/services/binancePositionReconciler.js
- src/services/positionReadModel.js
- src/services/simplifiedExitV2.js

유틸/뷰/정책:
- src/utils/exitStageView.js
- src/utils/exitIntegrityPolicy.js
- src/utils/liveExecutionPolicy.js
- src/storage/signalDrops.js

운영/감사/배포 관련:
- scripts/run-binance-exit-integrity-cycle.js
- scripts/check-binance-exit-integrity-gate.js
- scripts/backfill-canonical-exit-transitions.js
- scripts/report-trade-execution-alert-cross-audit.js
- scripts/report-binance-canonical-exit-stage-qa.js
- scripts/report-simplified-exit-v2-live-flow.js
- scripts/report-simplified-exit-v2-tp1-drilldown.js
- scripts/automation-openclaw-hourly-cycle.js
- scripts/lib/openclaw-cron-manifest.js
- ops/launchd/run_binance_exit_integrity_cycle.sh
- cloudbuild.yaml

테스트:
- src/tests/binance-exit-integrity-cycle.test.js
- src/tests/backfill-canonical-exit-transitions.test.js
- src/tests/trade-execution-alert-cross-audit.test.js
- src/tests/report-binance-canonical-exit-stage-qa.test.js
- src/tests/report-simplified-exit-v2-live-flow.test.js
- src/tests/report-simplified-exit-v2-tp1-drilldown.test.js
- 그리고 관련 핵심 흐름 테스트 전반

감사 방식:
1. 먼저 시스템을 큰 흐름으로 요약하라.
   - entry -> order intent -> fill sync -> state mutation -> canonical transition -> alert -> stop/trailing -> reconcile -> watchdog/integrity
2. 그 다음 “실제 손실 위험이 큰 문제”부터 severity 순으로 나열하라.
3. 각 문제마다 아래 형식으로 써라:

   [Severity]
   [Title]
   [Why it is dangerous]
   [Exact file(s) and function(s)]
   [Concrete failure scenario]
   [How likely]
   [Recommended fix]
   [Whether tests exist]
   [What test is still missing]

4. 발견이 없으면 그냥 “없다”고 하지 말고, 왜 없다고 판단했는지와 잔여 리스크를 써라.
5. 마지막에는 아래 5개 표를 반드시 만들어라:
   - 치명적 결함 Top 10
   - 구조적 약점 Top 10
   - 비용 리스크 Top 10
   - 테스트 블라인드스팟 Top 10
   - 다음 개발 우선순위 Top 10

결과물 형식:

1. Executive Verdict
- 이 시스템을 냉정히 어떤 수준으로 보는지
- 예: “실험적 개인 시스템 / 반실전 / 준프로덕션 / 제한적 프로덕션 / 기관급과의 격차”

2. Critical Findings
- 가장 심각한 이슈들, severity 순서

3. Architecture Assessment
- 상태권한, stop writer, alert source of truth, scheduler/governance, cost architecture

4. Trading Risk Assessment
- 오체결/미체결/중복청산/미청산/재진입/qty mismatch/TP1 미발동/trail misfire

5. Cost And Ops Assessment
- Firestore / scheduler / cron / gate / observability / rollback

6. Test Coverage Assessment
- 무엇이 잘 막히고 무엇이 안 막히는지

7. Priority Roadmap
- 지금 바로 / 이번 주 / 이번 달

8. Final Brutal Summary
- 이 시스템의 가장 아픈 진실 5개

추가 제약:
- “괜찮아 보인다”, “전반적으로 좋다” 같은 표현 금지
- 반드시 파일 경로와 함수명 중심으로 말하라
- 가능하면 line reference도 같이 줘라
- 추상론보다 재현 가능한 failure mode를 우선하라
- 리뷰어가 아니라 “돈 잃기 전에 막는 감사자”라고 생각하고 써라
```

