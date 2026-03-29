# DONBEOLJA Pine Code Update Rules (영구 규칙)

- 제정: 2026-03-01
- 제정자: 재용 (CEO)
- 적용 대상: pine_dev 및 파인스크립트를 수정하는 모든 역할
- 상태: **시행 중 (ACTIVE)**

---

## 규칙 1: 버전 번호 필수 변경

파인스크립트 코드를 수정하여 새 파일로 저장할 때, **반드시 버전 번호를 올려야 한다.**

### 변경 위치 (2곳 모두 필수)

1. **라인 2 indicator() 이름** 내 버전 문자열
   - 예: `v5.5.8.0` → `v5.5.9.0`
2. **STRATEGY_ID 상수** 값
   - 예: `"donbeolja_v5.5.8.0"` → `"donbeolja_v5.5.9.0"`

### 버전 번호 체계

`vA.B.C.D` 형식:
- A.B: 메이저 버전 (큰 구조 변경 시)
- C: 마이너 버전 (기능 추가/변경 시 +1)
- D: 패치 버전 (파라미터 튜닝/버그 수정 시 +1)

일반적인 코드 업데이트 시 C를 +1 한다. (예: v5.5.8.0 → v5.5.9.0)
파라미터 값만 변경하는 경우 D를 +1 할 수 있다. (예: v5.5.8.0 → v5.5.8.1)

---

## 규칙 2: PATCH CHANGELOG 필수 기입

코드를 1줄이라도 변경하면, **반드시 PATCH CHANGELOG에 해당 변경 내용을 기록해야 한다.**

### 기입 위치

파인스크립트 상단 `00. PATCH CHANGELOG` 섹션, 마지막 PATCH 항목 바로 아래.

### 기입 형식

```pine
// [PATCH-번호] 카테고리: 구체적 변경 내용 요약(변경 전 값 → 변경 후 값)
```

### 기입 규칙

1. **1:1 대응**: 코드에서 변경한 각 항목이 PATCH 항목과 1:1로 대응해야 한다.
2. **값 명시**: 파라미터 변경 시 변경 전/후 값을 반드시 포함한다.
3. **복수 변경**: 변경 사항이 여러 개면 PATCH 번호를 나눠서 각각 기입한다.
4. **금지**: 실제로 변경하지 않은 내용을 PATCH에 적지 않는다.
5. **금지**: 코드를 변경하고 PATCH를 기입하지 않는 것은 금지한다.

---

## 규칙 2-A: Tier 정의 문서 선확인

외부 라이브 엔트리 `LONG / SHORT`와 현재 라이브 source band `EARLY / CORE` 관련 조건, 이름, 설명, 임계값, 게이트를 수정하기 전에는
아래 문서를 먼저 읽고 그 의미를 유지해야 한다.

- SSOT 문서:
  - [`/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_TIER_DEFINITION.md`](/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_TIER_DEFINITION.md)
  - [`/Users/jeongjaeyong/Projects/donbeolja/docs/FILTER_STAGE_POLICY.md`](/Users/jeongjaeyong/Projects/donbeolja/docs/FILTER_STAGE_POLICY.md)
  - [`/Users/jeongjaeyong/Projects/donbeolja/docs/PINE_AND_FILTER_STAGE_ROLES.md`](/Users/jeongjaeyong/Projects/donbeolja/docs/PINE_AND_FILTER_STAGE_ROLES.md)
  - [`/Users/jeongjaeyong/Projects/donbeolja/docs/OBJECTIVE_RETROSPECTIVE_POLICY.md`](/Users/jeongjaeyong/Projects/donbeolja/docs/OBJECTIVE_RETROSPECTIVE_POLICY.md)

필수 원칙:

1. 외부 라이브 엔트리는 `LONG / SHORT`만 사용한다.
2. `LONG / SHORT` source timing은 `EARLY / CORE`다.
3. `LONG / SHORT` quantity profile은 `FIXED`다.
4. `PRE_REAL / REAL`은 legacy diagnostic band로만 유지하고, 현재 라이브 source band는 `EARLY / CORE`만 유지한다.
5. 뒤 밴드가 항상 더 좋은 가격의 진입을 뜻한다고 가정하면 안 된다.

tier 관련 수정 완료 보고에는 아래를 반드시 포함한다.

1. 위 SSOT 문서를 확인했다는 명시
2. 변경이 어떤 tier 의미를 건드리는지
3. Pine와 서버가 같은 의미를 유지하는지

## 규칙 2-B: 필터 단계 조정 주기 준수

필터 단계 변경은 아래 주기를 기본으로 한다.

1. 1차 품질: 일요일 주 1회 추천/검토
2. 2차 AI 판단: 일요일 주 1회 추천/검토
3. 3차 시황(롱숏우위): 일요일 주 1회 추천/검토
4. 4차 EV: 서버 단독 3일 자동 튜닝

원칙:

1. 1~3차는 Pine 의미와 연결되므로 주간 Pine 수정 주기를 따른다.
2. 4차 EV는 Pine 의미를 직접 바꾸지 않으므로 서버 자동 조정을 허용한다.
3. 1~3차 필터를 일중 자동 반영하는 변경은 금지한다. 먼저 일요일 주간 추천 보고로 제안해야 한다.

## 규칙 2-C: 공통 목표 함수 준수

Pine 수정부터 4차 EV 관련 변경까지 모든 변경은 아래 목표 함수를 공통으로 따른다.

1. 승률: `최소 60% 이상`
2. 순수익(`net`): `양수`
3. 기대값(`EV / expectancy`): `양수`
4. 월간 순수익: `최소 1,500,000 KRW 이상`

원칙:

1. 승률만 높고 순수익이 음수인 수정은 금지한다.
2. 순수익만 양수인데 구조적으로 승률이 60% 미만으로 무너지는 수정도 금지한다.
3. 월간 순수익이 `1,500,000 KRW` 미만으로 악화되는 수정도 금지한다.
4. 파인 수정안 보고에는 반드시 이번 변경이 위 목표들에 어떤 영향을 주는지 포함해야 한다.
5. 데이터가 부족해 위 목표를 동시에 방어하지 못하면 `hold`가 기본이다.
6. 당일 `0원`과 `무거래`도 실패로 본다. 최신 `objective_retrospective_latest.md`의 반성문을 수정 근거에 포함해야 한다.

## 규칙 2-D: 1차 품질 이관은 묶음으로 수행

서버 1차 품질 의미를 Pine로 이관해야 할 때는 아래를 하나의 품질 묶음으로 같이 다룬다.

1. `regime`
2. `confidence`
3. `score`
4. `posterior`
5. `wave`
6. `EV`

원칙:

1. `regime`만 먼저 옮기고 `confidence`나 `score`를 서버 1차에 남기는 부분 이관은 금지한다.
2. `posterior`/`wave`/`EV`를 Pine가 계산하는데 서버가 다시 같은 의미를 재판단하는 구조도 금지한다.
3. `confidence`만 완화/강화하고 `regime`/`score`는 서버에 남기는 구조도 금지한다.
4. Pine와 서버 1차가 같은 품질 의미를 각각 다시 판단하는 중복 상태를 장기 유지하면 안 된다.
5. 품질 이관은 항상 롱/숏 대칭으로 한 번에 수행한다.
6. 이관 후 서버 1차에는 무결성/안전 가드만 남기는 방향이어야 한다.

### 카테고리 예시

- `COOLDOWN_TUNE`: 쿨다운 파라미터 변경
- `QUALITY_GATE`: 품질 게이트 임계값 변경
- `ALERT_FIX`: 알림 로직 수정
- `VERSION_BUMP`: 버전 변경 (다른 PATCH와 함께 사용)
- `BUGFIX`: 버그 수정
- `REFACTOR`: 코드 구조 변경 (동작 동일)
- `NEW_FEATURE`: 신규 기능 추가

---

## 규칙 3: 파일 복사 금지

원본 파일을 이름만 바꿔서 복사하는 것은 **절대 금지**한다.
저장된 파일의 MD5 해시가 원본과 반드시 달라야 한다.

---

## 규칙 4: 저장 파일명

새 버전 파일명: `donbeolja_v{버전}.pine.txt`
- 예: `donbeolja_v5.5.9.0.pine.txt`

---

## 규칙 5: 완료 보고 필수 항목

파인 코드 업데이트 완료 시 아래 내용을 반드시 보고한다:

1. 새 파일 경로
2. 새 파일 MD5 해시 (원본과 다른지 확인)
3. 변경 전 버전 → 변경 후 버전
4. 추가한 PATCH 항목 전체 목록
5. 각 PATCH별 변경 라인 (라인 번호 + 변경 전 → 변경 후)

---

## 규칙 6: 버전 적용 완료 시 시스템 전체 동기화

재용이 **"버전 적용 완료"** 라고 말하면, 해당 버전에 맞춰 시스템 전체를 동기화한다.

상세 절차: [`ops/version_sync_rules.md`](version_sync_rules.md) 참조

### 동기화 대상 (요약)
1. `cloudbuild.yaml` - ENGINE_VERSION + WEBHOOK_ALLOWED_STRATEGY_IDS
2. `ecosystem.config.js` - ENGINE_VERSION + WEBHOOK_ALLOWED_STRATEGY_IDS
3. `SYSTEM_STATE_REPORT.md` - 버전 정보
4. 로컬 PM2 재시작 (`pm2 restart donbeolja --update-env`)
5. Cloud Run 재배포 (Cloud Build 트리거)

---

## 위반 시

위 규칙을 위반한 파일은 **업데이트 미완료로 간주**하며, 재작업을 지시한다.
