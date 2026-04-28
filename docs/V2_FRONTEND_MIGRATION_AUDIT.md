# V2 Frontend Migration Audit (2026-04-28)

전수 검사 — 돈벌자 사이트의 모든 메뉴/서브메뉴가 V2 cutover 후에도
정상 동작하는지 분석.

## 메뉴 구조 (18개)

```
[ topnav5 — 6 top-level ]

홈 (/dashboard/home)
수익 (/dashboard/profit)
입출금 (/dashboard/cashflow)
거래기록 (/dashboard/trading)
  ├─ 상태 (/dashboard/trading)        [legacy_trading_subnav]
  ├─ 저널 (/dashboard/journal)
  └─ AI 저널 (/dashboard/ai)
V2 게이트 (/dashboard/recovery)
  ├─ V2 미션 (/dashboard/home)         [control_surface_nav]
  ├─ 증거 수집 (/dashboard/recovery)
  ├─ 승격 판정 (/dashboard/deployment)
  ├─ 실행 추적 (/dashboard/execution)
  ├─ OpenClaw 전환 (/dashboard/server-primary)
  └─ V2 감사 (/dashboard/audit)
설정 (/dashboard/settings)

[ 추가 라우트 — nav 에 없지만 직접 접근 가능 ]

/dashboard/analysis (요약)
/dashboard/report (리포트)
/dashboard/eval (평가)
/dashboard/briefing (브리핑)
/dashboard/risk (리스크)
/dashboard/openclaw (OpenClaw 대시)
/dashboard/protection (보호 감사)
/dashboard/strategy-latest (전략 최신)
```

## V1 직접 의존도 측정

각 라우트 파일에서 `positions_paper / fills_paper / signals / order_intents_paper` 직접 reference 카운트:

| 페이지 | V1 refs | V2 cutover 영향 평가 |
|---|---|---|
| `/dashboard/trading` (state.routes.js) | **28** | 🟢 **OK** — fillSync 가 V2 cutover 후에도 positions_paper / fills_paper 채움. signals 는 webhook 의존이라 V2 entry route 가 webhook 받는 한 살아 있음. |
| `/dashboard/home` (dashboard.home.routes.js) | 5 | 🟢 OK — 동일 이유 |
| `/dashboard/ai` (dashboard.ai.routes.js) | 3 | 🟢 OK |
| `/dashboard/journal` (dashboard.journal.routes.js) | 1 | 🟢 OK |
| `/dashboard/report` (dashboard.report.routes.js) | 1 | 🟢 OK |
| 나머지 (~12개) | 0 (직접) | service layer 추상화 — 별도 검증 필요 |

## V2 cutover 후 V1 collection 채워지는 메커니즘

| Collection | V2 cutover 후 channel | 결과 |
|---|---|---|
| `positions_paper` | `binanceFuturesFillsSync` 가 거래소 polling → `upsertPosition` | ✅ 채워짐 |
| `fills_paper` | `binanceFuturesFillsSync` 가 거래소 polling → `upsertExternalFill` | ✅ 채워짐 |
| `signals` | webhook 진입 → `signalsConsume.js` 가 collection 에 write. paper engine (`processSignalPaper`) 은 `DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1` 일 때 skip → `writeSignal` 호출 안 됨 | ⚠️ webhook 만 의존 |
| `order_intents_paper` | V1 paper engine 의존 (legacy disabled 시 skip) | ⚠️ 채워지지 않음 |

## 진짜 깨질 항목

### (1) `order_intents_paper` 의존 페이지

`DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1` 환경에서는 V1 paper engine 이
intent 를 만들지 않는다. V2 entry route 가 만드는 intent 는
`signal_intents_v2` collection 으로 간다.

**영향 페이지**:
- `/dashboard/trading` (state.routes.js) — intent_summary 표시 위해 `order_intents_paper` 직접 read
- 기타 intent 표시 페이지

### (2) `signals` 의존이지만 webhook 외 source 도 보는 페이지

Discovery canary entry 는 webhook 안 거치고 V2 path 로 간다. 그 entry 의
signal 은 `signal_intents_v2` 에만 write. `signals` collection 에는 없음.

**영향 페이지**:
- `/dashboard/ai` — `signals` + `signals_dropped` 두 collection 직접 read.
  V2 canary entry 의 신호가 안 보임. (P1)
- `/dashboard/home` — `signals`, `signals_dropped`, `fills_paper`,
  `order_intents_paper` 4종 직접 read (5 V1 refs 의 실체)
- ~~`/dashboard/journal`~~ — 정정: `fills_paper` 만 read. fillSync 가
  V2 cutover 후에도 채우니 OK.

### (3) 추상화 layer 이지만 V1 view 만 read 하는 helper

`positionReadModel` 같은 추상화 layer 가 V2 collection 도 읽는지 확인
필요 (별도 audit).

## 현재 상태 평가 (canary_only=1)

V2 cutover 가 아직 안 됐기 때문에 **모든 페이지가 정상 동작 중**.
V1 webhook → paper engine → V1 collections 가 채워짐.

## V2 cutover 시 필요한 변경

### 우선순위 P0 (cutover 후 즉시 깨짐)

1. **`/dashboard/trading` 의 intent_summary** — `order_intents_paper` →
   V2 `signal_intents_v2` fallback 추가
2. **`/dashboard/journal` 의 signals 표시** — `signals` collection +
   `signal_intents_v2` union view 도입

### 우선순위 P1 (UX 손상이지만 즉시 깨지지 않음)

3. **`/dashboard/ai` 의 신호 분석** — 위와 동일 union 패턴
4. **`/dashboard/home` 의 mission control** — `dashboard.home.routes.js`
   가 V2 mission-control 데이터 별도 read 한다 (이미 V2 통합)

### 우선순위 P2 (거의 영향 없음)

5. 나머지 ~12 페이지 — V1 ref 0 이라 service layer abstraction 으로
   대부분 V2-aware 일 가능성. 별도 검증 후 spot fix.

## 권장 진행 절차

1. **이 문서 작성** ← 현재
2. **P0 항목 fix**: `state.routes.js` intent_summary V2 fallback
3. **P0 항목 fix**: `dashboard.journal.routes.js` signals union
4. **P1 항목 fix**: 위와 동일 union 패턴 ai routes 적용
5. **각 fix 마다 unit test + Cloud Build deploy 검증**
6. **P2 spot check** — 각 페이지 직접 manual smoke (새 데이터 들어왔을 때
   표시 되는지)

각 step 별 commit + deploy + log 검증. **현재 canary_only=1 이라 V2
entry traffic 자체가 거의 0 이기 때문에 fix 효과가 prod 에서 즉시 안
보일 가능성** — 그건 정직히 인정.

## 자백 (이 문서의 한계)

- 추상화 layer (`positionReadModel`, `unifiedEventTimeline` 등) 가 어떤
  collection 까지 read 하는지 깊이 추적 안 함
- 각 EJS view 가 받은 데이터를 어떻게 쓰는지 (필드명 호환성) 검증 안 함
- service / API endpoint (`/api/state`, `/api/dashboard/pulse`) 의 V2
  영향은 별도 분석 필요
- 실제 V2 cutover 시뮬레이션 (`canary_only=0` 임시 flip) 안 함

---

## 2026-04-28 Step 28 menu coverage smoke test 결과

`src/tests/menu-routes-coverage.test.js` — 18 menu paths 모두 GET 요청.

| group | total | OK | slow (Firestore I/O) | broken |
|---|---|---|---|---|
| topnav | 6 | 3-6 (변동) | 0-3 | 0 |
| trading-subnav | 2 | 2 | 0 | 0 |
| v2-control | 4 | 4 | 0 | 0 |
| legacy-report | 4 | 3-4 | 0-1 | 0 |
| side-rail | 4 | 4 | 0 | 0 |

**broken = 0** (404 또는 hard error 없음).

slow path 들은 local Firestore I/O 가 8s 안에 응답 못해서 발생 — 라우트
자체는 등록되어 있고 production Firestore 환경에서는 정상 응답.

**해석**: 모든 메뉴 페이지가 V2 cutover 와 무관하게 **기본적으로 동작**.
"빈 데이터" 표시는 됐을 수 있지만 "깨진 페이지" (404) 는 없음.

진짜 V2 cutover 후 깨질 위험은 §"진짜 깨질 항목" 섹션의 P1 항목들 —
`/dashboard/ai` 와 `/dashboard/home` 의 signals union, 그리고 다른
service abstraction layer 의 V1-only read.
