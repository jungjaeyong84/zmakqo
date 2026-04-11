# Claude Code Patch Handoff 2026W13

## 목적

이 문서는 2026W13 품질 감사 후 실제로 적용된 후속 패치를 Claude Code가 빠르게 이해하고, 남은 설계 판단 포인트를 근거 기반으로 검토할 수 있게 만드는 handoff 문서다.

이 문서는 `docs/CLAUDE_CODE_SYSTEM_QUALITY_PLAYBOOK.md`의 보조 문서다.

Claude가 이 문서를 읽으면 아래 4가지를 바로 판단할 수 있어야 한다.

1. 이번 패치에서 실제로 무엇이 바뀌었는지
2. 어떤 동작은 의도적으로 유지했는지
3. 어떤 항목은 dual-write / hardening 수준으로만 넣었는지
4. 다음 단계에서 무엇을 설계 판단 대상으로 봐야 하는지

---

## 범위

이번 handoff는 아래 후속 변경을 다룬다.

1. TP_P1 pending race guard
2. bar close alignment policy
3. shared position side normalization
4. Intent-Fill-Trade linkage dual-write
5. Home route error sanitization
6. EV TP1 component weight externalization
7. watchdog detect / report / recover 분리

---

## 적용된 변경

### 1. TP_P1 pending race guard

목적:

- tick exit worker가 stale pending을 지울 때, intent fill 쪽 업데이트와 충돌해서 잘못 clear하지 않게 한다.

적용:

- `src/storage/positionsPaper.js`
  - `matchesTpP1PendingSnapshot()`
  - `buildTpP1PendingClearedMeta()`
  - `clearTpP1PendingIfUnchanged()`
- `src/services/binanceTickExit.js`
  - stale clear를 blind update에서 compare-and-set transaction 경로로 전환

의도:

- `tp_p1_pending` 자체를 스키마 교체하지는 않았다.
- 먼저 stale clear 경로만 원자적으로 고정했다.

의미:

- 이번 변경은 full lock manager가 아니라 `stale clear CAS guard`다.
- 동시성 위험을 줄였지만, TP1 pending lifecycle 전체를 재설계한 것은 아니다.

### 2. bar close alignment policy

목적:

- `Math.round()` 기반 정렬이 다음 봉으로 밀릴 수 있는 문제를 줄인다.

적용:

- `src/utils/alignBarCloseMs.js`
  - `normalizeAlignMode()`
  - `resolveAlignMode()`
  - `alignWithMode()`
  - 기본 mode를 보수적으로 `FLOOR`로 사용

의도:

- 기존 호출부를 많이 바꾸지 않고 helper 내부 정책만 분리했다.
- exchange별 override를 나중에 줄 수 있게 환경변수 경로를 열어뒀다.

새 env:

- `BAR_ALIGN_MODE`
- `BAR_ALIGN_MODE_BINANCEFUT`

현재 기본:

- 명시값이 없으면 `FLOOR`

### 3. shared position side normalization

목적:

- `LONG/SHORT/BUY/SELL` 해석 중복을 줄이고, 포지션 방향 해석 drift를 막는다.

적용:

- 새 helper: `src/utils/positionSide.js`
  - `normalizePositionSide()`
  - `sideToPositionDir()`
  - `resolvePositionSide()`
  - `resolvePositionSideFromPosition()`
  - `resolveCloseSide()`

주요 적용 지점:

- `src/services/webhookReverseException.js`
- `src/services/aiSignalGuard.js`
- `src/services/exitIntegrityAudit.js`
- `src/engine/paperBinanceRunner.js`
- `src/engine/signalEngine.js`
- `src/services/binanceFuturesFillsSync.js`
- `src/services/binanceTickExit.js`

의도:

- 이번 배치는 핵심 runtime path 위주다.
- repo 전체의 모든 raw side 해석을 완전히 제거한 것은 아니다.

### 4. Intent-Fill-Trade linkage dual-write

목적:

- `intent -> fill -> trade` lineage를 doc id 추론에만 의존하지 않게 만든다.

적용:

- `src/storage/fillsPaper.js`
  - `trade_id` 저장
- `src/storage/tradesPaper.js`
  - `buildTradeId()` export
  - `intent_id`, `fill_id`, `entry_event_id`, `entry_signal_type`, `exec_ms` 저장
- `src/engine/paperBinanceRunner.js`
  - fill write와 trade write에 동일 `trade_id` 연결
- `src/services/binanceFuturesFillsSync.js`
  - external fill에도 `trade_id` 연결
- `src/services/kiwoomWsSync.js`
  - websocket fill에도 `trade_id` 연결
- `src/services/tradesFromFills.js`
  - built trade row에 `source_trade_id`, `source_intent_id` 노출

의도:

- migration/backfill 없이 `new write path`부터 lineage를 남긴다.
- read path는 legacy/new 둘 다 수용한다.
- 즉, full FK schema migration이 아니라 `dual-write scaffold`다.

중요:

- 기존 데이터에는 `trade_id` / `intent_id` / `fill_id`가 비어 있을 수 있다.
- Claude는 이 변경을 "lineage 강화 1단계"로 이해해야 한다.

### 5. Home route error sanitization

목적:

- dashboard home 500 응답에서 raw message가 사용자에게 그대로 보이지 않게 한다.

적용:

- 새 helper: `src/utils/routeErrors.js`
  - `buildRouteErrorRef()`
  - `sanitizeRouteError()`
  - `logRouteError()`
- 적용: `src/routes/dashboard.home.routes.js`

의도:

- 사용자 응답과 서버 로그를 분리했다.
- 광범위한 error middleware 리팩토링까지는 하지 않았다.

### 6. EV TP1 component weight externalization

목적:

- TP1 probability component weight를 코드에 박아두지 않고, partial override 가능하게 만든다.

적용:

- `src/services/evTp1Probability.js`
  - `DEFAULT_TP1_COMPONENT_WEIGHTS`
  - `resolveTp1ProbabilityWeights()`
  - `sanitizeWeight()`
  - `parseWeightsOverride()`
- `estimateTp1ReachProbability()`가 `componentWeights`를 받도록 확장

새 env:

- `EV_TP1_COMPONENT_WEIGHTS_JSON`

예시:

```json
{
  "target_ease": 2.0,
  "chase_safety": 0.7
}
```

의도:

- 기본값은 기존과 동일하다.
- override는 partial만 가능하고, invalid 값은 fallback된다.
- settings 문서/Firestore config까지 연결한 것은 아니다.

### 7. watchdog detect / report / recover 분리

목적:

- auto recovery가 pre-recovery failure를 가려버리는 문제를 막는다.

적용:

- `scripts/automation-automation-watchdog.js`
  - `normalizeRecoveryMode()`
  - `isRecoveryExecutionAllowed()`
  - `buildSnapshot()`
  - report에 `pre_recovery`, `post_recovery`, `issues_post_recovery`, `recovery_mode` 추가
  - 최종 `verdict`와 `issues`는 `pre_recovery`를 기준으로 유지

새 env:

- `AUTOMATION_WATCHDOG_RECOVERY_MODE`
  - `DETECT_ONLY`
  - `REPORT_ONLY`
  - `RECOVER_AND_REPORT`
- `AUTOMATION_WATCHDOG_ALLOW_RECOVERY`
  - `1/true/yes/on`일 때만 실제 recovery 실행 허용

현재 기본:

- `REPORT_ONLY`
- recovery 실행 비허용

의도:

- recovery가 성공해도 원래 실패 원인은 보고서에서 사라지지 않는다.
- 운영 승인이 없는 환경에서는 recovery를 실행하지 않는다.

---

## 이번 패치의 운영 의미

이번 변경은 아래처럼 읽어야 한다.

### hardening

- TP_P1 stale clear CAS
- Home route sanitization
- position side helper 공통화

### policy clarification

- bar align 기본 `FLOOR`
- watchdog 기본 `REPORT_ONLY`

### lineage scaffolding

- fill/trade/intent linkage dual-write

### controlled configurability

- EV TP1 component weight override

즉, 이번 배치는 "운영 의미를 문서와 코드에서 더 분명히 만들고, 다음 migration/정책 변경의 기반을 만드는 배치"다.

---

## 2026-03-29 계층 재정렬 메모

후속 배치에서 필터를 새로 추가한 것이 아니라, 기존 판단을 아래 계층으로 재정렬했다.

1. `1차 상태/무결성`
2. `2차 진입 품질`
3. `3차 상태 기반 Soft Sizing`
4. `4차 EV/시간가치층`
5. `5차 WAIT 타이밍층`

legacy 용어 매핑:

1. `1차 무결성 가드` -> `1차 상태/무결성`
2. `3차 시황(롱숏우위)` -> `3차 상태 기반 Soft Sizing`
3. `4차 EV` -> `4차 EV/시간가치층`
4. `5차 WAIT_ONE_BAR` -> `5차 WAIT 타이밍층`

Claude가 이 배치를 볼 때 중요한 점:

1. 새 필터가 추가된 것이 아니라 `중복 판단 레이어를 정리한 것`이다.
2. objective supervisor와 Codex weekly patch engine은 위 계층명을 우선 기준으로 읽어야 한다.
3. 아직 일부 legacy 문구가 남아 있어도, 의미를 옛 구조로 되돌려 해석하면 안 된다.

---

## 검증 결과

실행한 검증:

1. `node --check server.js`
2. `node --check src/server/app.js`
3. `node --check src/routes/webhook.routes.js`
4. `node --check src/routes/dashboard.home.routes.js`
5. `node --check src/engine/signalEngine.js`
6. `node --check src/storage/positionsPaper.js`
7. `node --check src/storage/fillsPaper.js`
8. `node --check src/storage/tradesPaper.js`
9. `node --check src/services/binanceTickExit.js`
10. `node --check src/services/binanceFuturesFillsSync.js`
11. `node --check src/services/evTp1Probability.js`
12. `node --check src/services/tradesFromFills.js`
13. `node --check scripts/automation-automation-watchdog.js`
14. `node src/tests/webhook-reverse-exception.test.js`
15. `node src/tests/positions-paper.test.js`
16. `node src/tests/position-side.test.js`
17. `node src/tests/align-bar-close.test.js`
18. `node src/tests/route-errors.test.js`
19. `node src/tests/trades-paper.test.js`
20. `node src/tests/trade-linkage.test.js`
21. `node src/tests/ev-tp1-probability.test.js`
22. `node src/tests/automation-watchdog.test.js`
23. `node src/tests/tick-exit-cooldown.test.js`
24. `node src/tests/binance-fills-qty-pct.test.js`
25. `node src/tests/signal-data-integrity.test.js`
26. `node src/tests/pine-signal-quality.test.js`
27. `node src/tests/run-tests.js`

결과:

- syntax check PASS
- targeted tests PASS
- smoke PASS

---

## Claude가 판단해야 하는 남은 포인트

아래는 "적용 완료"가 아니라 "다음 판단 대상"이다.

### A. TP_P1 pending lifecycle을 boolean에서 state machine으로 올릴지

현재:

- stale clear만 CAS guard

판단 질문:

1. `tp_p1_pending`을 boolean으로 유지해도 충분한가
2. `pending_owner`, `pending_version`, `pending_source` 같은 필드가 추가로 필요한가
3. `tick exit`, `intent fill`, `external fill sync` 3경로가 같은 상태 머신을 써야 하는가

### B. bar align default를 전 거래소 `FLOOR`로 둘지

현재:

- helper는 mode 지원
- 기본은 `FLOOR`

판단 질문:

1. Binance Futures는 `FLOOR`가 맞는가
2. webhook ingress와 evaluation이 완전히 같은 정렬 의미를 쓰는가
3. non-binance path가 다시 활성화되면 exchange별 mode를 따로 줘야 하는가

### C. position side helper rollout을 더 넓힐지

현재:

- 핵심 runtime path는 helper 적용
- 여전히 일부 raw read가 repo에 남아 있을 수 있음

판단 질문:

1. side 해석이 남아 있는 곳이 실제 runtime critical path인가
2. helper rollout을 한 번 더 넓혀도 안전한가
3. `BUY/SELL -> LONG/SHORT` canonical form을 storage write 시점에도 강제할지

### D. Intent-Fill-Trade linkage backfill이 필요한지

현재:

- 신규 write 경로만 linkage 기록
- legacy row는 비어 있을 수 있음

판단 질문:

1. 현재 read path만으로 legacy/new 공존이 충분한가
2. backfill이 필요한 시점이 언제인가
3. `fills_paper.trade_id`만으로 충분한가, 아니면 `trades_paper.primary_intent_id`, `entry_fill_id`, `exit_fill_id`까지 확장해야 하는가

### E. EV TP1 weights를 env 수준에 둘지 settings 수준으로 올릴지

현재:

- env JSON partial override만 지원

판단 질문:

1. 실험 빈도가 높아 settings/Firestore override가 필요한가
2. `POLICY_VERSION`을 결과 payload나 report에 넣어야 하는가
3. 지금 clamp 범위가 운영적으로 적절한가

### F. watchdog 기본 모드를 `REPORT_ONLY`로 유지할지

현재:

- recovery는 explicit allow 없이는 실행 안 함
- report는 pre-recovery 기준 유지

판단 질문:

1. 운영 기본이 `REPORT_ONLY`가 맞는가
2. 특정 환경만 `RECOVER_AND_REPORT`로 열어야 하는가
3. Telegram 문구에 pre/post 상태를 더 강하게 드러내야 하는가

---

## Claude용 안전한 검증 경로

Claude는 아래 경로로 먼저 점검한다.

1. `node --check` on touched files
2. targeted unit tests
3. `node src/tests/run-tests.js`

직접 실행하지 말 것:

- `scripts/automation-*.js`
- `scripts/sync-*`
- `scripts/backfill-*`
- `scripts/migrate-*`
- `scripts/purge_*`

이유:

- Firestore write
- Telegram 발송
- 운영 상태 변경

---

## Claude가 읽어야 할 파일

먼저:

1. `docs/CLAUDE_CODE_SYSTEM_QUALITY_PLAYBOOK.md`
2. `ops/daily/system_quality_audit_2026W13.md`
3. `docs/CLAUDE_CODE_PATCH_HANDOFF_2026W13.md`

그 다음 변경 파일:

1. `src/storage/positionsPaper.js`
2. `src/services/binanceTickExit.js`
3. `src/utils/alignBarCloseMs.js`
4. `src/utils/positionSide.js`
5. `src/routes/dashboard.home.routes.js`
6. `src/storage/fillsPaper.js`
7. `src/storage/tradesPaper.js`
8. `src/engine/paperBinanceRunner.js`
9. `src/services/binanceFuturesFillsSync.js`
10. `src/services/tradesFromFills.js`
11. `src/services/evTp1Probability.js`
12. `scripts/automation-automation-watchdog.js`

---

## Claude용 판단 프롬프트

아래 프롬프트를 Claude Code에 그대로 주면 된다.

```text
이 저장소에서 2026W13 후속 패치가 적용된 상태를 감사해라.

먼저 아래 문서를 순서대로 읽어라.
1. docs/CLAUDE_CODE_SYSTEM_QUALITY_PLAYBOOK.md
2. ops/daily/system_quality_audit_2026W13.md
3. docs/CLAUDE_CODE_PATCH_HANDOFF_2026W13.md

이번 감사의 목적은 "이미 적용된 후속 패치가 설계 의도대로 안전하게 들어갔는지"를 판단하는 것이다.

중점 대상은 아래 6개다.
1. TP_P1 pending stale clear CAS guard
2. bar close alignment default FLOOR
3. shared position side normalization rollout
4. Intent-Fill-Trade linkage dual-write
5. EV TP1 component weight externalization
6. watchdog detect/report/recover 분리와 recovery opt-in 정책

반드시 아래 원칙을 지켜라.
- 변경 의도와 실제 구현이 일치하는지 본다.
- legacy read path를 깨뜨렸는지 본다.
- side-effect 스크립트는 실행하지 않는다.
- Findings를 최우선으로 쓴다.
- 근거 없는 추측은 가설로 표기한다.

우선 읽을 파일:
- src/storage/positionsPaper.js
- src/services/binanceTickExit.js
- src/utils/alignBarCloseMs.js
- src/utils/positionSide.js
- src/routes/dashboard.home.routes.js
- src/storage/fillsPaper.js
- src/storage/tradesPaper.js
- src/engine/paperBinanceRunner.js
- src/services/binanceFuturesFillsSync.js
- src/services/tradesFromFills.js
- src/services/evTp1Probability.js
- scripts/automation-automation-watchdog.js

안전한 검증만 수행하라.
- node --check
- 관련 unit tests
- node src/tests/run-tests.js

직접 실행 금지:
- scripts/automation-*.js
- scripts/sync-*
- scripts/backfill-*
- scripts/migrate-*
- scripts/purge_*

특히 아래 판단을 내려라.
1. TP_P1 pending은 지금 수준의 CAS guard로 충분한가, 아니면 state machine 설계가 필요한가
2. FLOOR align default가 Binance Futures 운영 의도와 맞는가
3. position side helper rollout이 더 필요한가
4. Intent-Fill-Trade linkage는 지금 dual-write만으로 충분한가, backfill이 필요한가
5. EV weight override를 env가 아니라 settings/Firestore로 올려야 하는가
6. watchdog default를 REPORT_ONLY로 유지하는 것이 맞는가

출력 형식:
1. Findings
2. Open questions
3. Safe validations run
4. Decision recommendations
5. Optional next patch set
```

---

## 이 문서의 해석 원칙

Claude는 이 문서를 "완료 보고서"가 아니라 "적용된 변경과 남은 판단 포인트를 함께 설명하는 운영 handoff"로 읽어야 한다.

즉,

- 바뀐 것과
- 일부러 안 바꾼 것과
- 다음에 바꿔야 할지 판단해야 하는 것을

구분해서 읽는 것이 중요하다.
