# DONBEOLJA_OPERATIONAL_ACCELERATION_PLAN_2026-04-02

- 제정: 2026-04-02
- 상태: IN_PROGRESS
- 검수 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md`
- 목적:
  - `claw-code`의 운영 구조 장점을 `돈벌자`에 맞게 이식해 `수익 + 안정성 + 회복속도`를 동시에 끌어올린다.
  - 코드 대규모 재작성보다 `정책 계층`, `실행 가드`, `품질 기반 sizing`을 우선 적용한다.

## 1. 핵심 결론

가장 큰 효과를 내는 축은 아래 3개다.

1. 실행 전/후 Hook 기반의 강제 가드
2. 권한/행동 레지스트리 기반의 명시적 실행 정책
3. `objective + execution quality`를 실주문 `qty_pct`에 즉시 반영하는 자기 진화 루프

## 2. 현재 상태 재평가

### 2.1 강점

아래 핵심 모듈은 이미 존재한다.

1. 의사결정/실행
  - `/Users/jeongjaeyong/Projects/donbeolja/src/services/aiSignalGuard.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/src/engine/signalEngine.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/src/engine/paperBinanceRunner.js`
2. 무결성/감사
  - `/Users/jeongjaeyong/Projects/donbeolja/src/services/exitIntegrityAudit.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/src/services/binanceTickExit.js`
3. 실행품질/자본배분/격리
  - `/Users/jeongjaeyong/Projects/donbeolja/src/utils/executionQuality.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/src/utils/serverMarketCapitalAllocator.js`
  - `/Users/jeongjaeyong/Projects/donbeolja/src/utils/serverMarketQuarantine.js`

### 2.2 갭

1. 계산 결과가 실주문 경로에 하드 게이트로 강제되지 않는다.
2. intent 실패 상태가 `CANCELED`로 뭉쳐 원인학습 데이터 품질이 낮다.
3. `objective/execution quality`가 `qty_pct`에 즉시/강하게 연결되지 않는다.

## 3. 목표 아키텍처 (돈벌자 버전)

### 3.1 Layer 정의

1. `Decision Layer`
  - 신호 판단, EV 게이트, 리스크 게이트
  - 주 모듈: `paperBinanceRunner`, `evTp1Probability`
2. `Policy Layer` (신규 핵심)
  - `Action Registry + Permission Mode + Pre/Post Hook`
  - 권한 분리: `READ`, `PLAN`, `EXECUTE_LIVE`
  - 주문/취소/포지션 변경은 `EXECUTE_LIVE`만 허용
3. `Execution Layer`
  - `intent -> fill -> trade`
  - 실패 상태 세분화: `REJECTED_PROVIDER`, `TIMEOUT_PROVIDER`, `FAILED_INTERNAL`
4. `Evolution/Governance Layer`
  - `objective + execution quality + reverse policy + quarantine` 합성
  - 시장별 `INCREASE/HOLD/REDUCE/QUARANTINE`를 다음 사이클 sizing에 반영

## 4. 도입 우선순위

## 4.1 P0 (즉시, 1주)

1. `executionQuality + quarantine` 실주문 하드 게이트
  - 적용: `src/routes/webhook.routes.js`, `src/engine/paperBinanceRunner.js`
  - 실패 시 원칙: `fail-closed` + 표준 reason code 기록
2. `allocation_score`를 `qty_pct`에 직접 반영
  - 적용: `src/services/aiAllocation.js`, `src/engine/paperBinanceRunner.js`
  - 목표: 품질 불량 시장 자동 감속, 고품질 시장 점진 증량

## 4.2 P1 (2~3주)

1. Intent 상태 체계 분리
  - 적용: `src/storage/orderIntentsPaper.js`
  - 변경: `CANCELED` 집계를 세분화 상태로 대체
2. Pre/Post Hook 공통 계층
  - Pre: drawdown, latency, reject-rate, quarantine, objective floor
  - Post: lineage 기록, reason code 표준화, alert
  - 적용: `src/routes/trading.actions.routes.js`, `src/services/binanceTickExit.js`

## 4.3 P2 (4~6주)

1. 코드 변경보다 정책 파라미터 자동진화를 우선
  - 예: cooldown, EV threshold, qty scale, market enable/disable
2. 승격 기준 미달 시 자동 롤백
3. 정책/환경/인덱스 드리프트 감사 자동화
  - 적용: 스크립트 신규 추가 (`scripts/`), 결과는 `ops/daily/` 산출물로 고정

## 5. 즉시 반영할 운영 규칙

1. 승률 단독 최적화 금지, `expectancy + execution quality` 동시 통과만 허용
2. 신규 후보는 시장 단위 canary 후 점진 승격
3. `REJECT/TIMEOUT` 임계 초과 시 자동 감속
4. objective 미달 + 실행품질 불량이면 확장 금지
5. 자동 진화는 `가드 강화` 우선, `공격적 증량` 후순위

## 6. 구현 체크리스트

### 6.1 Policy Layer

1. `src/policy/actionPolicy.js` (신규)
  - `assertPermission(mode, actionType)`
  - `isLiveMutation(actionType)`
  - `isKillSwitchOn()`
2. `src/policy/actionRegistry.js` (신규)
  - 액션별 `risk_level`, `exec_mode_allowed`, `owner_module` 선언
3. `src/server/app.js`
  - 보호 라우트 auth 정책과 permission mode 연결

### 6.2 Hook Layer

1. `src/policy/preTradeHooks.js` (신규)
2. `src/policy/postTradeHooks.js` (신규)
3. `src/routes/trading.actions.routes.js`, `src/services/binanceTickExit.js`
  - 실행 경로에 pre/post 강제 삽입

### 6.3 Event Envelope

1. 공통 필드 표준
  - `schema_version`
  - `run_id`
  - `request_id`
  - `signal_id`
  - `intent_id`
  - `event`
  - `ts`
  - `exchange`
  - `symbol`
  - `tf`
  - `decision_reason`
  - `idempotency_key`
2. 적용
  - `webhook -> intent -> execution -> ledger -> alert` 전 구간

## 7. 수용 기준 (Acceptance Criteria)

1. 권한
  - `READ/PLAN`에서 live mutation API 호출 시 100% 차단
  - `EXECUTE_LIVE`에서도 kill switch ON이면 100% 차단
2. 게이트
  - quarantine 시장 진입 차단률 100%
  - execution-quality 임계 초과 시 자동 감속/차단 적용
3. 관측성
  - 표준 이벤트 엔벨로프 누락률 0%
  - intent 실패 reason code 미분류 비율 < 5%
4. 목표 연계
  - `allocation_score -> qty_pct` 반영이 매 사이클 기록되고 재현 가능

## 8. 테스트 시나리오

1. 권한 테스트
  - mode별 live mutation 허용/차단 단위 테스트
2. Hook 테스트
  - pre 실패 시 주문 미실행 확인
  - post 실패 시 ledger/alert/integrity fallback 확인
3. 품질 게이트 테스트
  - slippage/reject/timeout 가짜 입력으로 차단 및 감속 검증
4. 회귀 테스트
  - 기존 서버 신호 생성/드롭/텔레그램 알림 경로 회귀 검증

## 9. 배포/롤백 계획

1. 배포 순서
  - `P0` 기능 플래그 ON(모니터링) -> 제한 시장 canary -> 전체 적용
2. 롤백 트리거
  - reject_rate, timeout_rate, missing_alert_rate 임계 초과
3. 롤백 방식
  - 정책 플래그 즉시 OFF
  - 코드 롤백보다 운영 플래그 롤백 우선

## 10. 운영 SSOT 문서 연결

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md`
2. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md`
3. `/Users/jeongjaeyong/Projects/donbeolja/docs/OBJECTIVE_RETROSPECTIVE_POLICY.md`
4. `/Users/jeongjaeyong/Projects/donbeolja/docs/AI_ALLOCATION_POLICY.md`

## 11. 실행 결정

즉시 실행은 아래 2개를 먼저 적용한다.

1. `executionQuality/quarantine` 실주문 하드 게이트화
2. `allocation_score` 기반 `qty_pct` 자동 반영

이 두 항목이 목표 회복 속도에 가장 큰 기여를 한다.

## 12. 진행 현황 (2026-04-02 19:00 KST 기준)

### 12.1 완료

1. `executionQuality/quarantine` 실주문 게이트 연결 완료
  - `src/routes/webhook.routes.js`
  - `src/engine/paperBinanceRunner.js`
  - `src/utils/liveExecutionPolicy.js`
2. 공통 pre/post action hook 연결 완료
  - `src/routes/trading.actions.routes.js`
  - `src/services/binanceTickExit.js`
  - `src/utils/actionExecutionHooks.js`
3. 공통 이벤트 엔벨로프 적용 완료
  - `src/utils/eventEnvelope.js`
  - `src/storage/orderIntentsPaper.js`
  - `src/storage/fillsPaper.js`
  - `src/storage/tradesPaper.js`
4. Lineage 조회/가시화 완료
  - API: `GET /api/state/lineage`
  - 화면: `src/views/home.ejs`, `src/views/state.ejs`

### 12.2 검증 결과

1. `src/tests/live-execution-policy.test.js` 통과
2. `src/tests/action-execution-hooks.test.js` 통과
3. `src/tests/event-envelope.test.js` 통과
4. `src/tests/trade-trace-meta.test.js` 통과
5. `src/tests/run-tests.js` 스모크 통과

### 12.3 다음 스텝

1. `allocation_score -> qty_pct` 반영 강도 보정 `완료`
  - `src/utils/liveExecutionPolicy.js`
  - 스케일 프로파일(`RISK_GUARD_V2`) 및 환경변수 기반 튜닝 포인트 추가
2. intent 실패 상태(`CANCELED` 집계) 세분화 마무리 `완료`
  - `src/routes/state.routes.js` (`intent_summary`에 상태별 카운트 추가)
  - `src/routes/dashboard.home.routes.js` (`intent_failures.by_status` 추가)
  - `src/views/state.ejs`, `src/views/home.ejs` (운영 화면 노출)
3. 운영 모드 단일화(`launchctl` 기준 유지, PM2와 이중 실행 금지) `완료`
  - `ops/launchd/enforce_single_runtime.sh` 추가
  - 검증: `node server.js` 단일 PID 유지 + `health` 정상 + PM2 앱 미기동
4. 정책 파라미터 자동 진화 리포트(P2 1차) `완료`
  - `src/utils/policyParameterEvolutionPlan.js` 추가
  - `scripts/report-best-self-evolution-policy-parameter-plan.js` 추가
  - `scripts/automation-self-evolution-loop.js`에 `policy_parameter_plan` 단계 연결
  - 산출물: `ops/daily/best_self_evolution_policy_parameter_plan_latest.json|md`
5. 정책 리포트 기반 실주문 정책 canary 연동(P2 2차) `완료`
  - `src/utils/liveExecutionPolicy.js`가 `best_self_evolution_policy_parameter_plan_latest.json`을 읽어 글로벌/마켓 scale 참조
  - 기본값은 report-only 유지: `LIVE_EXEC_POLICY_POLICY_PLAN_APPLY=0`
  - canary 적용 플래그: `LIVE_EXEC_POLICY_POLICY_PLAN_APPLY=1` (watch-only는 기본 차단)
  - 테스트: `src/tests/live-execution-policy.test.js`
6. 로컬/클라우드 canary 적용 및 런타임 검증 `완료`
  - 로컬(launchd): `LIVE_EXEC_POLICY_POLICY_PLAN_ENABLED=1`, `LIVE_EXEC_POLICY_POLICY_PLAN_APPLY=1`, `LIVE_EXEC_POLICY_POLICY_PLAN_WATCH_ONLY_BLOCK=1`
  - 클라우드런: 리비전 `donbeolja-01132-2cg` 100% 트래픽, 동일 canary env 3종 반영
  - 상태 확인: 서비스 health 정상, 부팅 로그 정상
  - 참고: `LIVE_POLICY_PLAN_*` 실행 로그는 신규 진입 이벤트 유입 후 관측 가능

### 12.4 마무리 판정 (2026-04-02)

1. 개발/배포 마무리: `완료`
  - 정책 파라미터 자동 진화 리포트 생성 경로 완료
  - live execution policy canary 연동 완료
  - 로컬/클라우드 canary env 반영 완료
2. 운영 acceptance 마무리: `진행 중`
  - `SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`
  - `EV_POLICY_DRIFT_ACTIVE`
  - `COOLDOWN_POLICY_DRIFT_ACTIVE`
  - `RECOVERY_CANARY_BLOCKED`
3. 결론
  - 코드 변경/배포 관점 마무리는 완료됐고,
  - 남은 항목은 운영 샘플 축적과 objective 회복 확인이 필요한 관측 단계다.
