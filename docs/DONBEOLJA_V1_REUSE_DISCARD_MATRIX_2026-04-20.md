# DONBEOLJA V1 Reuse / Discard Matrix

## 기준

V1의 최대 장점은 구현의 아름다움이 아니라 실전에서 축적된 운영 지식이다.

따라서 이 문서의 목적은 "어떤 파일을 복사할까"가 아니라, "어떤 운영 자산을 V2로 승계할까"를 판정하는 데 있다.

분류는 네 가지로 나눈다.

1. `REUSE`
2. `REWRITE_WITH_REFERENCE`
3. `WRAP_ONLY`
4. `DISCARD`

판정 기준은 아래다.

1. 단일 책임이 분명한가
2. V2 원칙과 충돌하지 않는가
3. recovery와 본경로가 섞여 있지 않은가
4. 테스트가 재사용 가능한가

## 핵심 매트릭스

| 영역 | 현재 파일 | 판정 | 이유 |
|---|---|---|---|
| Exit state machine | `src/services/positionStateMachine.js` | `REWRITE_WITH_REFERENCE` | 규칙과 invariant 지식은 좋지만, lineage gate, legacy early-partial-exit compatibility, stage remap, fallback가 너무 많다 |
| Main runtime engine | `src/engine/paperBinanceRunner.js` | `DISCARD` | 역할이 너무 많다. entry, exit, repair, alert, lineage, cooldown, native protection이 섞여 있다 |
| Tick trail worker | `src/services/binanceTickExit.js` | `REWRITE_WITH_REFERENCE` | break-even/trail observability는 좋다. 하지만 V2는 책임을 더 줄여야 한다 |
| Binance fill sync | `src/services/binanceFuturesFillsSync.js` | `REWRITE_WITH_REFERENCE` | exchange sync 지식은 재사용 가치가 크다. 하지만 canonical exit authority를 같이 가지면 안 된다 |
| Active watchdog | `src/services/binanceActiveExitWatchdog.js` | `WRAP_ONLY` | issue taxonomy와 비교 로직은 참고 가치가 높다. V2에서는 read-only watchdog으로 축소 |
| Position writer storage | `src/storage/positionsPaper.js` | `REWRITE_WITH_REFERENCE` | lease, single writer 지식은 좋다. 하지만 V2 cycle model과 맞지 않는다 |
| Runtime observations | `src/storage/positionRuntimeObservations.js` | `REUSE` | trail/floor/native stop 분리 저장 방향이 V2와 맞다 |
| Canonical transition storage | `src/storage/canonicalExitTransitions.js` | `REUSE` | 문서 단위와 책임이 비교적 깨끗하다 |
| Alert formatter / sender | `src/services/tradeExecutionAlert.js` | `REWRITE_WITH_REFERENCE` | 출력 메시지 자산은 참고 가능. 그러나 gate, formatter, delivery가 과하게 결합 |
| Alert transport | `src/utils/alerts.js` | `REUSE` | 채널 전송 계층은 별도 모듈로 유지 가치가 있다 |
| Alert outbox | `src/storage/tradeAlertOutbox.js` | `REWRITE_WITH_REFERENCE` | outbox 개념은 유지. dedupe seed는 transition 중심으로 단순화 필요 |
| Native stop writer constant | `src/utils/binanceNativeProtectionWriter.js` | `REUSE` | single writer contract 자체는 V2에도 그대로 필요 |
| Egress proxy | `src/utils/egressProxy.js` | `REUSE` | recent RCA와 retry-reset 로직이 분명하고 테스트도 있다 |
| Exit integrity gate | `scripts/check-binance-exit-integrity-gate.js` | `REWRITE_WITH_REFERENCE` | fail-closed 철학은 유지. 하지만 V2 gate 항목으로 다시 정의해야 한다 |

## 상세 판정

### REUSE

#### `src/storage/canonicalExitTransitions.js`

유지 이유:

1. transition document 책임이 명확하다
2. `fill_id + transition_event` 식별자가 단순하다
3. unified event timeline 연계가 분명하다

주의:

1. V2에서는 `position_cycle_id`를 추가해야 한다

#### `src/storage/positionRuntimeObservations.js`

유지 이유:

1. floor / R / chosen / native 구분 방향이 맞다
2. V2 trail projection의 기반으로 쓰기 좋다

#### `src/utils/alerts.js`

유지 이유:

1. transport 계층이 비교적 독립적이다
2. OpenClaw -> Telegram API fallback은 운영적으로 유용하다

주의:

1. V2에서는 delivery result를 durable하게 기록해야 한다

#### `src/utils/binanceNativeProtectionWriter.js`

유지 이유:

1. 단일 writer contract는 V2 핵심 원칙과 일치한다

#### `src/utils/egressProxy.js`

유지 이유:

1. 최근 half-open RCA 반영
2. retry-reset 구조와 테스트가 맞물린다

주의:

1. V2 deploy gate에서 env disable 여부를 추가 검증해야 한다

### REWRITE_WITH_REFERENCE

#### `src/services/positionStateMachine.js`

참고할 것:

1. absolute qty ratio 계약
2. chain-key confidence 개념
3. blocked invariant 개념

버릴 것:

1. legacy early-partial-exit compatibility layer
2. stage remap 다중 경로
3. lineage 누락 시 transition empty 처리

#### `src/services/binanceTickExit.js`

참고할 것:

1. break-even stop observability
2. trail observation write 필드
3. retry context logging

버릴 것:

1. TP1 상태와 trail 상태를 동시에 다루는 부분
2. 과거 호환 분기

#### `src/services/binanceFuturesFillsSync.js`

참고할 것:

1. order meta fetch 보강
2. external close 분류 지식
3. user trades 실시간 동기화 구조

버릴 것:

1. canonical exit authority 직접 수행
2. alert payload 구성
3. fallback stage confidence 운영 의존

#### `src/storage/positionsPaper.js`

참고할 것:

1. lease
2. single writer queue
3. snapshot transition validation 개념

버릴 것:

1. 기존 `positions_paper` 스냅샷 모델
2. V1 메타 필드 누적 방식

#### `src/services/tradeExecutionAlert.js`

참고할 것:

1. exit message template
2. operator-friendly line 구성

버릴 것:

1. canonical requirement gate와 formatter 결합
2. exit truth 판단
3. buildMessage null skip 의존

#### `src/storage/tradeAlertOutbox.js`

참고할 것:

1. outbox 상태 머신
2. `PENDING/SENT/FAILED/SKIPPED`

버릴 것:

1. payload fallback hash 중심 dedupe
2. sourceFillId 없는 exit dedupe 허용

#### `scripts/check-binance-exit-integrity-gate.js`

참고할 것:

1. fail-closed 문화
2. summary 기반 차단 구조

버릴 것:

1. V1 issue taxonomy를 그대로 복사

### WRAP_ONLY

#### `src/services/binanceActiveExitWatchdog.js`

판정 이유:

1. 현재 watchdog 자체는 read-only repair-request emitter라 V2 방향과 맞는다
2. 다만 내부 stage 해석과 issue 분류는 V1 projection에 종속된다

따라서 V2에서는 아래만 참고한다.

1. issue code naming
2. compare-exchange-vs-projection 패턴

### DISCARD

#### `src/engine/paperBinanceRunner.js`

폐기 이유:

1. 단일 파일에 너무 많은 책임이 있다
2. TP1 recovery, native protection, alert dispatch, cooldown, lineage recovery가 섞여 있다
3. V2의 "작은 핵심"과 정면 충돌한다

재사용 금지 원칙:

1. 함수 단위 복붙 금지
2. 로직은 문서화 후 재구현

## 테스트 재사용 판정

### 그대로 가져갈 만한 테스트 개념

1. `break-even-stop-refresh-observability.test.js`
2. `egress-proxy-stale-pool-retry.test.js`
3. `egress-proxy-dispatcher-required.test.js`
4. `active-position-repair-stop-missing-escalation.test.js`
5. `unprotected-active-position-reason.test.js`
6. `same-direction-profit-trail-cooldown.test.js`

### 이름만 참고하고 다시 짜야 할 테스트

1. `trade-execution-alert.test.js`
2. `position-state-machine.test.js`
3. `binance-active-exit-watchdog.test.js`
4. `binance-exit-integrity-cycle.test.js`

이유:

1. V2에서는 transition, cycle id, projection 구조가 달라진다

## 구현 우선순위에 따른 재사용 전략

### 먼저 가져올 것

1. egress transport
2. alert transport
3. canonical transition storage
4. runtime observation field set

### 나중에 참고할 것

1. watchdog issue taxonomy
2. cooldown logic
3. gate summary 항목

### 아예 끊고 시작할 것

1. `paperBinanceRunner` 기반 orchestration
2. legacy multi-stage partial take-profit contract
3. V1 positions snapshot meta 누적 방식

## 최종 원칙

V2는 V1 코드의 "구현"을 재사용하는 것이 아니라, V1의 "사고 보고서"와 "운영 교훈"을 재사용해야 한다.

여기서 가장 중요한 승계 대상은 아래다.

1. Binance 실전 edge case 대응 경험
2. 보호주문/체결/외부개입 불일치가 실제로 어떻게 나타나는지에 대한 운영 증거
3. 어떤 로그, 어떤 Firestore 문서, 어떤 audit가 사고 복원에 유효한지에 대한 검증된 관측성 지식
4. 배포 전에 replay와 integrity gate로 차단해야 한다는 문화

즉, V1의 최대 장점은 코드가 아니라 "실전에서 이미 지불한 수업료"다.

재사용 기준은 코드 양이 아니라 책임의 선명도다.
