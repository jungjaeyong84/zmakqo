# DONBEOLJA UIUX CONTROL SURFACE PLAN

- 제정: 2026-03-31
- 업데이트: 2026-04-01
- 상태: IN_PROGRESS
- 목적:
  - 현재 `bundle-based hybrid canonical + OpenClaw ops substrate + autonomy governor` 구조에 맞게 운영 UI를 다시 설계한다.
  - 기존 `대시보드/거래/리포트/설정` 중심 IA를 `goal/authority/deployment/execution/audit` 중심 control surface로 재편한다.

## 1. 한 줄 정의

새 UI/UX의 목표는 "운영자가 예쁜 그래프를 보는 화면"이 아니라, `OpenClaw governor`가 현재 무엇을 목표로 보고 있고, 왜 HOLD/PROMOTE/ROLLBACK인지, 현재 engine/policy bundle과 source mode가 무엇인지 5초 안에 읽을 수 있는 운영 정본 화면을 만드는 것이다.

## 2. 현재 구조 진단

현재 화면은 다음 특성이 강하다.

1. `home.ejs`에 예산/KPI/AI/리포트 성격이 과도하게 섞여 있다.
2. 상단 네비가 아직 `대시보드 / 거래 / 리포트 센터 / 설정` 중심이다.
3. 최신 운영 정본인 아래 artifact 체인이 첫 화면에 정렬되어 있지 않다.
   - `openclaw_autonomy_contract`
   - `objective_recovery_governor`
   - `self_evolution_authority`
   - `deployment_plan`
   - `deployment_probe`
   - `bundle_activation`
   - `server_primary_acceptance_watch`
4. 현재 라우트 구조는 기능 중심이고, 운영 판단 중심이 아니다.

즉 UI의 문제는 "디자인이 촌스럽다"보다 "운영 정본 구조와 화면 정보구조가 어긋난다"는 점이다.

## 2.1 구현 진행 현황

2026-04-01 기준 구현 상태는 아래와 같다.

1. `Phase 1. IA Fix`
   - 완료
   - 상단 네비를 `Mission / Recovery / Deployment / Execution / Audit / Settings` 기준으로 재편했다.
2. `Phase 2. Serializer Layer`
   - 완료
   - `/Users/jeongjaeyong/Projects/donbeolja/src/utils/controlPlaneViewModels.js`에서 control-plane view model을 정본으로 사용한다.
3. `Phase 3. Mission Control 교체`
   - 완료
   - `/dashboard/home`는 Mission Control이 정본이며, home cache hit 시에도 latest artifact 기준으로 `mission_control`을 재생성한다.
4. `Phase 4. Recovery / Deployment`
   - 완료
   - `/dashboard/recovery`와 `/dashboard/deployment`는 operator strip, evidence chain, drill-down을 포함한다.
5. `Phase 5. Execution / Server-Primary / Audit 정교화`
   - 대부분 완료
   - `/dashboard/execution`, `/dashboard/server-primary`, `/dashboard/audit`에 operator strip, runtime preview, artifact timeline, focus drill-through가 들어갔다.
6. `Phase 6. Legacy Screen Demotion`
   - 진행 중
   - legacy report/trading 화면은 새 IA 아래의 보조 화면으로 강등했고, control surface로 복귀하는 bridge CTA를 추가했다.
   - 남은 일은 중복 CTA 제거와 일부 legacy wording 정리다.

## 3. 상위 원칙

1. `Control Surface First`
   - 첫 화면은 KPI 모음이 아니라 운영 제어면이어야 한다.
2. `Artifact SSOT`
   - 화면 상태는 Firestore 파편이 아니라 latest artifact chain을 기준으로 읽는다.
3. `Bundle Over File`
   - file path보다 `engine_bundle / policy_bundle / activation / authority`를 먼저 보여준다.
4. `Goal Before Metrics`
   - 숫자보다 먼저 `goal_state`, `authority_state`, `deployment_state`, `phase_d_status`를 보여준다.
5. `Evidence Behind Status`
   - 각 상태는 근거 artifact drill-down으로 이어져야 한다.
6. `No Framework Rewrite First`
   - 1차 개편은 `Express + EJS` 위에서 정보구조와 partial system을 재정의한다.

## 4. 최상위 IA

상단 네비의 정본은 아래로 재편한다.

1. `Mission`
   - 시스템 전체 상태, goal, authority, deployment, phase D를 한 화면에서 본다.
2. `Recovery`
   - objective recovery candidate, replay, canary, guards, blockers를 본다.
3. `Deployment`
   - active/prepared/rollback bundle, probe, activation, approval 상태를 본다.
4. `Execution`
   - source mode, signals/drops/intents/fills, canonical provenance, downstream mismatch를 본다.
5. `Audit`
   - cycle consistency, freshness, authority ensemble, watchdog, wrapper/raw artifact를 본다.
6. `Settings`
   - 변경성 화면만 둔다.

하위/보조 화면:

1. `Trading`
2. `Reports`
3. `Journal`
4. `AI Journal`
5. `Profit`
6. `Cashflow`

즉 기존 기능은 지우지 않고, 우선순위를 낮춘다.

## 5. 페이지 트리

### 5.1 Mission

- route: `/dashboard/home`
- 새 이름: `Mission Control`
- 핵심 질문:
  - 지금 목표 상태가 무엇인가
  - 지금 막는 blocker는 무엇인가
  - 지금 active bundle이 무엇인가
  - 지금 source mode와 phase D는 어떤 상태인가

첫 화면 카드:

1. `Goal State`
2. `Authority`
3. `Deployment`
4. `Source Mode`
5. `Phase D Acceptance`
6. `Ops Substrate`

### 5.2 Recovery

- route: `/dashboard/recovery`
- 핵심 질문:
  - 현재 회복 대상으로 무엇을 밀고 있는가
  - replay/canary/guards는 모두 닫혔는가
  - 아직 왜 promote가 안 되는가

핵심 모듈:

1. `objective_recovery_governor`
2. `recovery candidate`
3. `replay verdict`
4. `canary readiness`
5. `deployment guards`
6. `blocker ladder`

### 5.3 Deployment

- route: `/dashboard/deployment`
- 핵심 질문:
  - 지금 실제 active bundle이 무엇인가
  - probe/activation은 닫혔는가
  - authority는 approved인가 pending인가
  - rollback bundle은 무엇인가

핵심 모듈:

1. `engine bundle`
2. `policy bundle`
3. `deployment probe`
4. `bundle activation`
5. `authority verdict`
6. `shadow_pine`

### 5.4 Execution

- route: `/dashboard/execution`
- 핵심 질문:
  - 현재 시장별 source mode는 무엇인가
  - 서버 canonical 판단이 실제 row에 어떻게 남았는가
  - 왜 실행/드롭/미체결이 났는가

핵심 모듈:

1. `source mode by market`
2. `canonical provenance`
3. `signals / signals_dropped / intents / fills`
4. `downstream mismatch families`
5. `pine shadow drift`

### 5.5 Server-Primary

- route: `/dashboard/server-primary`
- 핵심 질문:
  - Phase D acceptance가 어디까지 왔는가
  - 확대 가능한 시장이 있는가

핵심 모듈:

1. `configured server-primary markets`
2. `observed / executed / realized`
3. `disagreement rate`
4. `rollback triggers`
5. `next expansion readiness`

### 5.6 Audit

- route: `/dashboard/audit`
- 핵심 질문:
  - latest artifact chain이 같은 cycle인가
  - freshness와 wrapper/raw 구조는 안전한가
  - watchdog / OpenClaw / authority가 정상인가

핵심 모듈:

1. `cycle consistency`
2. `artifact freshness`
3. `authority ensemble`
4. `objective supervisor`
5. `loop monitor`
6. `watchdog`

## 6. 라우트 전략

1. 기존 route 유지
   - 깨지는 링크를 만들지 않는다.
2. 새 control routes 추가
   - `/dashboard/recovery`
   - `/dashboard/deployment`
   - `/dashboard/execution`
   - `/dashboard/server-primary`
   - `/dashboard/audit`
3. 기존 route alias 유지
   - `/dashboard/trading`
   - `/dashboard/report`
   - `/dashboard/settings`
4. 점진적 nav migration
   - 1차: 새 nav 추가
   - 2차: 기존 "리포트 센터"를 하위로 내림

## 7. View Model SSOT

새 UI는 page template가 artifact를 직접 해석하지 않도록, route layer에서 page-specific serializer를 만들어야 한다.

필수 view model:

1. `buildMissionControlViewModel()`
2. `buildRecoveryViewModel()`
3. `buildDeploymentViewModel()`
4. `buildExecutionViewModel()`
5. `buildServerPrimaryViewModel()`
6. `buildAuditViewModel()`

공통 규칙:

1. `display` 우선
2. 없으면 `raw`
3. wrapper/raw 여부를 serializer에서 숨긴다
4. status line은 한글 설명 + raw code를 같이 준다
5. cycle/source/evaluation id를 명시적으로 분리한다

## 8. 컴포넌트 시스템

EJS partial을 아래 기준으로 재조직한다.

새 partial 후보:

1. `partials/control_hero.ejs`
2. `partials/status_tile.ejs`
3. `partials/blocker_ladder.ejs`
4. `partials/bundle_state_card.ejs`
5. `partials/authority_card.ejs`
6. `partials/source_mode_table.ejs`
7. `partials/acceptance_watch_card.ejs`
8. `partials/evidence_strip.ejs`
9. `partials/artifact_drilldown.ejs`
10. `partials/page_tabs_control_plane.ejs`

현재 `topnav5.ejs`는 1차 개편에서 교체 대상이다.

## 9. 시각 방향

### 9.1 톤

`consumer trading dashboard`가 아니라 `operations control console` 톤으로 간다.

### 9.2 타이포

1. main:
   - `IBM Plex Sans` 또는 `Manrope`
2. mono:
   - `IBM Plex Mono`

### 9.3 색 시스템

색은 의미에만 쓴다.

1. `PASS / ACTIVE / APPROVED`
   - deep green
2. `WATCH / PENDING / DEGRADED`
   - amber
3. `BLOCK / FAIL / TIMEOUT`
   - red
4. `INFO / SHADOW / EVIDENCE`
   - blue-gray

### 9.4 화면 구조

1. `hero`
2. `top rail`
3. `two-column evidence`
4. `bottom artifact strip`

즉 카드 벽돌형 나열보다, 상태 위계가 드러나는 구조를 쓴다.

## 10. 페이지별 핵심 wireframe 규칙

### 10.1 Mission

상단:

1. `OBJECTIVE_RECOVERY_REQUIRED` 또는 `OBJECTIVE_ON_TRACK`
2. `authority_state`
3. `deployment plan_status`

중단:

1. `Why blocked`
2. `Next autonomous action`

하단:

1. `active engine bundle`
2. `active policy bundle`
3. `phase D`
4. `ops substrate`

### 10.2 Recovery

좌:

1. `recovery candidate`
2. `candidate delta`
3. `target deploy unit`

우:

1. `replay`
2. `canary`
3. `guards`
4. `authority`

### 10.3 Deployment

상단:

1. `active / prepared / rollback`

중단:

1. `probe`
2. `activation`
3. `approval`

하단:

1. `shadow_pine`
2. `candidate origin`

### 10.4 Execution

상단:

1. `market source mode matrix`

중단:

1. `latest signal flow`
2. `drop reasons`

하단:

1. `provenance completeness`
2. `downstream mismatch`

### 10.5 Audit

상단:

1. `cycle`
2. `freshness`
3. `watchdog`

중단:

1. `authority`
2. `supervisor`
3. `loop monitor`

하단:

1. `artifact path drilldown`

## 11. 단계별 구현 순서

### Phase 1. IA Fix

1. 새 nav 설계
2. route map 확정
3. legacy alias 유지

### Phase 2. Serializer Layer

1. Mission/Recovery/Deployment/Audit serializer 추가
2. wrapper/raw 흡수
3. artifact status normalize

### Phase 3. Mission Control 교체

1. `/dashboard/home`를 Mission Control로 재설계
2. top hero + blocker ladder + bundle state 도입

### Phase 4. Recovery / Deployment 신설

1. `/dashboard/recovery`
2. `/dashboard/deployment`

### Phase 5. Execution / Server-Primary / Audit 신설

1. `/dashboard/execution`
2. `/dashboard/server-primary`
3. `/dashboard/audit`

### Phase 6. Legacy Screen Demotion

1. 기존 report/trading/profit/cashflow는 하위로 이동
2. settings만 변경성 화면으로 유지

## 12. 완료 기준

아래가 닫히면 UI/UX 1차 개편 완료로 본다.

1. 첫 화면 5초 내에 다음을 읽을 수 있다.
   - `goal_state`
   - `authority_state`
   - `deployment_state`
   - `source_mode`
   - `phase_d_status`
2. objective blocker와 authority blocker를 혼동하지 않는다.
3. file path보다 bundle state가 먼저 보인다.
4. stage/evaluation cycle과 main cycle을 혼동하지 않는다.
5. OpenClaw / watchdog / Telegram substrate 상태가 운영 표면에 드러난다.

## 13. 지금 기준 최우선 구현

가장 먼저 해야 할 것은 아래다.

1. `/dashboard/home`를 `Mission Control`로 재정의
2. `topnav5.ejs`를 control-plane IA에 맞게 교체
3. `buildMissionControlViewModel()` 추가
4. `Recovery`와 `Deployment` 전용 화면 신설

한 줄 결론:

지금 donbeolja UI의 핵심 과제는 "디자인 개선"이 아니라, `OpenClaw governor + bundle deployment + server-primary acceptance`를 운영자가 즉시 읽을 수 있는 control surface로 바꾸는 것이다.
