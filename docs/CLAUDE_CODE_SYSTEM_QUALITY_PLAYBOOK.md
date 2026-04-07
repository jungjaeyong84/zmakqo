# Claude Code System Quality Playbook

## 목적

이 문서는 Claude Code가 `donbeolja` 전체 시스템을 한 번에 뭉뚱그려 보지 않고, 작은 감사 단위로 분해해서 이해하고, 품질 검사를 수행하고, 근거 기반 리뷰를 남길 수 있게 만드는 운영 기준서다.

대상 범위:

- Pine 전략 코드
- 웹훅 수신과 신호 정규화
- 단계별 필터링과 품질 게이트
- paper/live 실행 엔진
- 저장소/ledger/관측성
- 스케줄러와 자동화
- 대시보드/UX/UI
- Electron 데스크톱 포장
- 테스트 체계
- 운영/보안/권한/배포 위험

이 문서의 목표는 Claude Code가 아래 3가지를 안정적으로 수행하게 하는 것이다.

1. 시스템을 빠르게 맵핑한다.
2. 부작용 없는 품질 점검 경로와 위험한 경로를 구분한다.
3. 결과를 "발견 사항 중심"으로 정리한다.

---

## 시스템 한 줄 요약

`donbeolja`는 Pine에서 생성된 LONG/SHORT 계열 신호를 웹훅으로 받아, 서버에서 단계별 필터와 정책을 적용하고, paper/live 실행과 exit worker, 자동화 거버넌스, 대시보드와 일일/주간 리포트까지 연결한 Node.js 기반 자율 트레이딩 운영 시스템이다.

기술 스택 핵심:

- Node.js CommonJS
- Express + EJS
- Firestore
- Electron 데스크톱 래퍼
- Cloud Run 운영 전제
- Binance Futures 중심 설계

---

## 가장 먼저 읽을 문서

Claude Code는 전체 감사를 시작하기 전에 아래 문서를 먼저 읽는다.

1. `docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md`
2. `docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md`
3. `docs/CLAUDE_FULL_SYSTEM_QUALITY_AUDIT_PROMPT.md`
4. `docs/SIGNAL_TIER_DEFINITION.md`
5. `docs/PINE_AND_FILTER_STAGE_ROLES.md`
6. `docs/FILTER_STAGE_POLICY.md`
7. `docs/OBJECTIVE_RETROSPECTIVE_POLICY.md`
8. `docs/SCHEDULER_ENV_POLICY.md`
9. `docs/AI_ALLOCATION_POLICY.md`
10. `docs/BINANCE_FUTURES_SPEC.md`

특정 패치 배치나 감사 주차를 검토하는 경우에는 위 문서 다음에 해당 handoff 문서를 바로 읽는다.

- 2026W13 후속 패치 검토: `docs/CLAUDE_CODE_PATCH_HANDOFF_2026W13.md`

이 순서가 중요한 이유:

- `SIGNAL_TIER_DEFINITION`이 LONG/SHORT/EARLY/CORE 의미의 SSOT다.
- `PINE_AND_FILTER_STAGE_ROLES`와 `FILTER_STAGE_POLICY`가 Pine와 서버 단계 책임 경계를 정한다.
- `OBJECTIVE_RETROSPECTIVE_POLICY`와 `SCHEDULER_ENV_POLICY`는 자동화와 운영 판정 규칙을 정한다.
- `AI_ALLOCATION_POLICY`와 `BINANCE_FUTURES_SPEC`는 실행 제약과 운영 맥락을 보강한다.

---

## 전체 시스템 분해 지도

### 1. Pine Source Layer

역할:

- 차트에서 LONG/SHORT 계열 신호를 만든다.
- 품질, wave, posterior, EV, stat-physics 메타를 payload에 넣는다.

핵심 경로:

- `code/donbeolja_v6.0.3.0.pine.txt`
- `code/donbeolja.pine.txt`
- `code/donbeolja_latest_generated.pine.txt`

감사 질문:

- `LONG/SHORT`가 현재 라이브 단일 진입 경로인지
- `EARLY/CORE` 의미가 문서와 일치하는지
- Pine payload에 서버가 기대하는 필드가 실제로 들어가는지
- stat-physics 구조량이 payload까지 실려 나오는지

중요 위험:

- Pine 화면 표시와 서버 이벤트 이름이 어긋나는 문제
- stage 의미 drift
- payload 필드명 drift

### 2. Webhook Ingress and Normalization

역할:

- Pine webhook을 받아 표준 이벤트로 정규화한다.
- 허용 TF, provider, strategy id, AI guard, immediate process를 처리한다.

핵심 경로:

- `src/routes/webhook.routes.js`
- `src/services/signalMapping.js`
- `src/services/signalStandard.js`
- `src/services/signalTaxonomy.js`
- `src/utils/liveEntryTaxonomy.js`
- `src/utils/alignBarCloseMs.js`

감사 질문:

- Pine event가 canonical event로 안정적으로 매핑되는지
- strategy id gate와 provider normalization이 안전한지
- bar close time 보정이 TF와 일치하는지
- immediate process timeout/fallback 경로가 드롭 없이 안전한지

중요 위험:

- TF mismatch
- strategy id mismatch
- stale bar 처리 오류
- reverse exception 오판

### 3. Filter and Decision Layer

역할:

- 1차 상태/무결성, 2차 진입 품질, 3차 상태 기반 Soft Sizing, 4차 EV/시간가치층, 5차 WAIT 타이밍층 정책을 적용한다.
- legacy 문서에 남은 `3차 시황`, `4차 EV`, `5차 WAIT`는 각각 `3차 상태 기반 Soft Sizing`, `4차 EV/시간가치층`, `5차 WAIT 타이밍층`으로 해석한다.

핵심 경로:

- `src/services/aiSignalGuard.js`
- `src/services/evTp1Probability.js`
- `src/services/waitOneBarPolicy.js`
- `src/services/costGuardService.js`
- `src/services/webhookReverseException.js`
- `src/utils/filterFeatureBuckets.js`
- `src/utils/statPhysFeatures.js`
- `src/utils/signalReasonView.js`

감사 질문:

- 드롭 사유가 stage 정책 문서와 일치하는지
- stage별로 "block / reduce / allow"가 의도대로 동작하는지
- stat-physics가 실제 gating에 반영되는지
- null/undefined 값이 0으로 오인되지 않는지

중요 위험:

- stage drift
- null coercion
- AI timeout fallback 불안정
- EV/WAIT가 의도보다 강하게 전체 신호를 막는 문제

### 4. Execution Layer

역할:

- paper/live 포지션 반영, intent 생성, exit 규칙 적용, tick 기반 청산을 수행한다.

핵심 경로:

- `src/engine/signalEngine.js`
- `src/engine/paperExecution.js`
- `src/engine/paperUpbitRunner.js`
- `src/paper/engine.js`
- `src/paper/paperBroker.js`
- `src/worker/tickExitWorker.js`
- `src/services/binanceTickExit.js`
- `src/services/exitIntegrityAudit.js`
- `src/services/tradeExecutionAlert.js`

감사 질문:

- ENTRY/ADD/DROP/REVERSE 정책이 포지션 상태와 일관되는지
- 보호주문이 누락되지 않는지
- tick exit loop와 worker가 중복 실행되지 않는지
- qty normalization과 cost shield가 실제로 적용되는지

중요 위험:

- 보호주문 누락
- idempotency 실패
- reverse cooldown 위반
- tick exit fast-lane와 일반 exit 경로 충돌

### 5. Storage and Ledger Layer

역할:

- signal, drop, fills, trades, positions, gate, run, webhook ingress/outcome를 저장한다.

핵심 경로:

- `src/storage/signals.js`
- `src/storage/signalDrops.js`
- `src/storage/orderIntentsPaper.js`
- `src/storage/fillsPaper.js`
- `src/storage/tradesPaper.js`
- `src/storage/positionsPaper.js`
- `src/storage/webhookLedger.js`
- `src/storage/gateEvents.js`
- `src/storage/runLedger.js`
- `src/storage/observability.js`
- `src/storage/settings.js`
- `src/storage/firestore.js`

감사 질문:

- key/idempotency key가 안정적인지
- 동일 이벤트가 여러 컬렉션에서 서로 모순되지 않는지
- signals, drops, intents, fills 연결이 가능한지
- settings cache invalidate가 누락되지 않는지

중요 위험:

- doc id drift
- cross-collection mismatch
- stale cache
- provider별 settings 병합 오류

### 6. Scheduler and Automation Layer

역할:

- 운영 점검, 리포트, 튜닝, governance, autopilot, watchdog를 주기적으로 실행한다.

대표 스크립트 그룹:

- 운영 감시:
  - `scripts/automation-hourly-guard.js`
  - `scripts/automation-automation-watchdog.js`
  - `scripts/daily-system-ops-check.js`
- 품질/거버넌스:
  - `scripts/automation-weekly-filter-governance.js`
  - `scripts/automation-objective-retrospective.js`
  - `scripts/automation-objective-supervisor.js`
  - `scripts/automation-stage-autopilot.js`
  - `scripts/automation-filter-shadow-canary.js`
- 튜닝:
  - `scripts/automation-ml-filter-policy.js`
  - `scripts/automation-ev-tp1-threshold-tune.js`
  - `scripts/automation-wait-one-bar-tune.js`
  - `scripts/automation-exit-optimization-engine.js`
- 시스템 오케스트레이션:
  - `scripts/system-autonomous-cycle.js`
  - `scripts/system-dev-autonomous-cycle.js`

감사 질문:

- 자동화가 단순 리포트인지, 실제 settings를 바꾸는지 구분되어 있는지
- report freshness와 blocker logic이 objective와 일치하는지
- autopilot이 change budget과 cooldown을 지키는지
- Telegram/Slack 류 알림이 과도하거나 누락되지 않는지

중요 위험:

- side-effect script를 무심코 실행하는 것
- stale report 기반 auto-apply
- objective 미충족 상태에서 자동 승격
- watchdog이 중요 장애를 정상으로 간주

### 7. API and Dashboard Layer

역할:

- 운영자 UI, 리포트, 분석, 설정 변경, health endpoint를 제공한다.

핵심 경로:

- `src/server/app.js`
- `server.js`
- `src/routes/*.routes.js`
- `src/views/*.ejs`
- `src/views/partials/*.ejs`

중요 라우트 군:

- health: `/health`, `/health/firestore`, `/health/keys`
- dashboard: `/dashboard/*`
- settings and risk budget UI compat: `src/routes/ui.routes.js`
- reports/briefing/eval/scheduler routes

감사 질문:

- 인증 우회가 로컬 전용인지
- 공개 UI와 보호 API가 섞여 있지 않은지
- stale data 표시가 있는지
- 중요한 화면이 Firestore/network failure에서 무너지는지

중요 위험:

- local no-auth 옵션의 production 오남용
- UI는 정상인데 underlying API는 실패하는 문제
- legacy redirect와 새 경로 불일치

### 8. Desktop Wrapper Layer

역할:

- Electron이 로컬 내장 서버를 띄워 desktop HQ 형태로 감싼다.

핵심 경로:

- `desktop/main.js`

감사 질문:

- 앱 부팅 시 embedded/local server가 정상 기동하는지
- packaged/dev mode가 서로 다른 cwd 문제 없이 동작하는지
- desktop mode에서 `PUBLIC_UI_NO_AUTH=1`이 의도된 범위에서만 동작하는지

중요 위험:

- packaged app cwd/asar 문제
- 데스크톱에서 서버 죽음 감지 실패
- desktop-only env drift

### 9. Test Layer

역할:

- smoke, guard, automation, policy, taxonomy, integrity, routing을 검증한다.

핵심 경로:

- `src/tests/run-tests.js`
- `src/tests/*.test.js`

특징:

- smoke test는 app boot + 주요 렌더 + scheduler status + 404를 본다.
- 개별 테스트 파일이 정책 단위로 매우 잘게 쪼개져 있다.

감사 질문:

- 새 정책 변경이 해당 테스트에 반영되었는지
- "테스트 없음"이 아니라 "테스트가 틀린 가정을 하고 있지 않은지"
- side-effect 없이 재현 가능한 regression test가 있는지

---

## Claude Code가 따라야 할 감사 순서

### Phase 1. Orientation

다음만 먼저 읽고 전체 그림을 잡는다.

1. `server.js`
2. `src/server/app.js`
3. `docs/SIGNAL_TIER_DEFINITION.md`
4. `docs/PINE_AND_FILTER_STAGE_ROLES.md`
5. `src/routes/webhook.routes.js`
6. `src/engine/signalEngine.js`
7. `scripts/system-autonomous-cycle.js`
8. `desktop/main.js`

결과물:

- 진입점 목록
- 외부 입력원 목록
- side-effect를 내는 경로 목록

### Phase 2. Static Contract Audit

점검 대상:

- Pine payload 필드
- webhook parser
- signal/drop/intents/fills/trades 저장 구조
- taxonomy 및 reason code

반드시 확인할 것:

- event 이름 drift
- tier 의미 drift
- provider/tf normalization drift
- stat-physics field drift

결과물:

- 계약 불일치 목록
- 문서와 구현의 차이

### Phase 3. Runtime Safety Audit

점검 대상:

- qty, add, reverse, cooldown, exit, idempotency, protection

반드시 확인할 것:

- 보호주문 누락 가능성
- same-direction ADD 과진입
- reverse 예외 경로
- stale bar 처리
- timeout fallback

결과물:

- 치명적 실행 위험
- replay 또는 test 필요 포인트

### Phase 4. Automation Governance Audit

점검 대상:

- hourly guard
- weekly governance
- objective supervisor
- stage autopilot
- watchdog

반드시 확인할 것:

- freshness guard
- objective blocker
- canary/coverage block
- auto-apply side effect
- telegram dedupe

결과물:

- 자동 승격/롤백의 잘못된 조건
- stale artifact 의존성

### Phase 5. UX/UI Audit

점검 대상:

- dashboard routes
- views
- settings/risk compat route
- desktop wrapper

반드시 확인할 것:

- 읽기 전용/변경성 UI 구분
- stale or missing data UX
- route fallback/redirect
- auth guard

결과물:

- 사용자 오판 유발 UI
- 운영자가 잘못된 상태를 믿게 만드는 뷰

### Phase 6. Test Audit

점검 대상:

- smoke tests
- policy/unit tests
- automation tests

반드시 확인할 것:

- 새 정책에 대한 테스트 존재 여부
- 틀린 기대값을 고정한 stale test
- 실행 비용이 낮은 targeted test 세트

결과물:

- 부족한 테스트 목록
- 잘못된 테스트 가정 목록

---

## 안전한 명령과 위험한 명령

### 기본적으로 안전한 작업

- `rg`, `find`, `sed`, `cat`, `node --check`
- 개별 unit test 실행
- smoke test 실행
- Markdown/문서 작성
- report JSON/MD 읽기

예시:

```bash
rg -n "LONG|SHORT|CORE|EARLY" code src docs
node --check src/routes/webhook.routes.js
node src/tests/run-tests.js
node src/tests/pine-signal-quality.test.js
node src/tests/objective-supervisor.test.js
```

### 기본적으로 위험한 작업

아래는 명시적 승인 없이는 실행하지 않는다.

- `scripts/automation-stage-autopilot.js`
- `scripts/system-recovery-actions.js`
- `scripts/sync-*.js`
- `scripts/backfill-*.js`
- `scripts/migrate-*.js`
- `scripts/purge_*.js`
- production service update/deploy
- 실제 거래소 private API를 치는 스크립트

이유:

- settings 변경
- 외부 상태 변경
- Firestore 대량 쓰기
- Telegram 발송
- Cloud Run/worker 영향

### 주의가 필요한 자동화 스크립트

다음은 읽기 전용이 아닐 수 있으므로 `node --check` 또는 코드 읽기만 우선한다.

- `scripts/automation-*.js`
- `scripts/system-autonomous-cycle.js`
- `scripts/daily-system-ops-check.js`
- `scripts/build-improvement-pack-local.js`

---

## Claude Code용 품질 감사 체크리스트

아래 체크리스트는 "모든 영역을 잘게 쪼개 검사"하기 위한 최소 단위다.

### A. Pine and Payload

- [ ] 현재 live source band 의미가 문서와 일치한다.
- [ ] Pine payload의 event, side, qty, confidence, stat-physics 필드가 서버 기대와 일치한다.
- [ ] chart 표시 로직과 실제 webhook 발행 로직이 같은 조건을 쓴다.

### B. Webhook and Stage Filters

- [ ] canonical event mapping이 유일하다.
- [ ] provider/tf/bar close normalization이 일관된다.
- [ ] AI/EV/WAIT 정책이 서로 중복 block 하지 않는다.
- [ ] drop reason code가 stage 정책 문서와 합치한다.

### C. Execution and Risk

- [ ] ENTRY/ADD/DROP/REVERSE 상태 전이가 모순되지 않는다.
- [ ] 보호주문 누락 가능성이 없다.
- [ ] cooldown과 reverse exception이 동시 충돌하지 않는다.
- [ ] qty cap / cost shield / exit profile이 실행 경로에 실제 적용된다.

### D. Storage Integrity

- [ ] signals ↔ drops ↔ intents ↔ fills ↔ trades를 같은 event lineage로 추적할 수 있다.
- [ ] idempotency key가 중복 저장을 막는다.
- [ ] cache invalidation과 snapshot refresh가 누락되지 않는다.

### E. Automation and Governance

- [ ] governance/objective/autopilot/watchdog가 같은 objective truth를 본다.
- [ ] stale artifact가 blocker 없이 auto-apply로 이어지지 않는다.
- [ ] 통계물리학/coverage/canary가 실제 blocker로 연결되어 있다.
- [ ] 리포트가 side-effect와 관측용 출력을 구분한다.

### F. UX/UI and Desktop

- [ ] 주요 대시보드가 로컬/무OAuth 모드에서 깨지지 않는다.
- [ ] 운영자 화면이 stale/partial failure를 숨기지 않는다.
- [ ] desktop wrapper가 server boot 실패를 명확히 보여준다.

### G. Tests

- [ ] 변경된 정책마다 대응 테스트가 있다.
- [ ] smoke test가 여전히 핵심 route를 덮는다.
- [ ] flaky하거나 잘못된 전제의 테스트가 없다.

---

## Claude Code가 남겨야 하는 결과 형식

품질 감사 결과는 아래 순서를 따른다.

1. Findings
2. Open questions or assumptions
3. Coverage summary
4. Commands run
5. Tests run / not run
6. Recommended next patch set

Finding 형식:

- Severity: `P0`, `P1`, `P2`, `P3`
- Area: `pine`, `webhook`, `filters`, `execution`, `storage`, `automation`, `ui`, `desktop`, `tests`
- Symptom
- Root cause
- Evidence
- Fix direction

예시:

```text
[P1][automation] objective supervisor can auto-promote on stale governance artifact
- Symptom: ...
- Root cause: ...
- Evidence: scripts/automation-objective-supervisor.js:...
- Fix direction: ...
```

---

## 권장 감사 명령 세트

### 1. 구조 파악

```bash
find . -maxdepth 2 -type d | sort
rg --files docs src scripts code desktop | sed -n '1,300p'
```

### 2. 문법 체크

```bash
node --check server.js
node --check src/server/app.js
node --check src/routes/webhook.routes.js
node --check src/engine/signalEngine.js
node --check scripts/automation-weekly-filter-governance.js
node --check scripts/automation-objective-supervisor.js
node --check scripts/automation-hourly-guard.js
```

### 3. 기본 smoke

```bash
node src/tests/run-tests.js
```

### 4. 핵심 정책 테스트

```bash
node src/tests/pine-signal-quality.test.js
node src/tests/filter-feature-buckets.test.js
node src/tests/stat-phys-features.test.js
node src/tests/wait-one-bar-policy.test.js
node src/tests/objective-supervisor.test.js
node src/tests/weekly-filter-governance.test.js
node src/tests/stage-autopilot.test.js
node src/tests/signal-data-integrity.test.js
```

### 5. 실행 안정성 테스트

```bash
node src/tests/signals-fallback-guard.test.js
node src/tests/tick-exit-cooldown.test.js
node src/tests/tick-exit-fastlane.test.js
node src/tests/native-protection-alert-guard.test.js
node src/tests/native-protection-trigger-skip.test.js
node src/tests/binance-fills-qty-pct.test.js
```

### 6. UI/UX 관련 테스트

```bash
node src/tests/run-tests.js
node src/tests/telegram-alert-korean.test.js
node src/tests/json-display-fields.test.js
```

중요:

- side-effect 가능성이 있는 `scripts/automation-*.js`는 직접 실행하지 말고, 우선 `node --check`와 코드 읽기, 대응 test 확인으로 감사한다.

---

## Claude Code 전용 감사 프롬프트 템플릿

아래 프롬프트를 Claude Code에 그대로 주고 시작하면 된다.

```text
이 저장소를 전체 시스템 품질 감사 관점으로 점검해라.

반드시 아래 순서를 지켜라.
1. docs/CLAUDE_CODE_SYSTEM_QUALITY_PLAYBOOK.md 를 먼저 읽고 감사 계획을 세운다.
2. 시스템을 pine / webhook / filters / execution / storage / automation / ui / desktop / tests 로 분해한다.
3. 각 영역에서 치명도 높은 버그, 정책 불일치, side-effect 위험, stale 문서/테스트를 찾는다.
4. Findings를 우선순위대로 제시한다.
5. 각 finding마다 재현 경로, 근거 파일, 수정 방향, 필요한 테스트를 적는다.
6. 명시적 승인 없이는 배포, settings 변경, autopilot 실행, sync/backfill/migrate/purge 계열 스크립트를 실행하지 않는다.
7. 가능하면 node --check 와 관련 unit test로 근거를 검증한다.

결과 형식:
- Findings
- Open questions
- Coverage summary
- Commands run
- Tests run / not run
- Recommended patch set
```

---

## Definition of Done

Claude Code 품질 감사가 끝났다고 볼 수 있는 조건:

1. 시스템 전체를 위의 8개 감사 단위로 나눠 커버했다.
2. side-effect 경로와 read-only 경로를 구분했다.
3. findings가 파일 근거와 함께 제시되었다.
4. 실행한 명령과 실행하지 않은 이유가 기록되었다.
5. 테스트 공백과 문서 공백이 함께 식별되었다.
6. 필요한 경우 바로 다음 patch set까지 제안되었다.

---

## 운영 메모

- 이 저장소는 테스트 파일이 풍부하므로, Claude Code는 "추측"보다 "targeted test + node --check + 코드 경로 확인"을 우선해야 한다.
- Pine 의미 체계와 server stage 역할은 문서 SSOT를 우선한다.
- Binance Futures가 현재 핵심 운영 경로다. 다른 시장 경로는 legacy 또는 부분 운영 상태일 수 있으므로, live-critical 판단은 실제 활성 경로 기준으로 한다.
- UI는 단순 장식이 아니라 운영자 의사결정 도구다. 따라서 UI 감사도 기능 감사와 같은 우선순위로 본다.
