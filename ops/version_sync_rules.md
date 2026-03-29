# DONBEOLJA Version Sync Rules (영구 규칙)

- 제정: 2026-03-01
- 제정자: 재용 (CEO)
- 적용 대상: 지혜 (CEO), system_dev, 모든 워커
- 상태: **시행 중 (ACTIVE)**

---

## 트리거

재용이 **"버전 적용 완료"** 라고 말하면, 지혜 시스템이 해당 버전에 맞춰 모든 시스템 설정을 자동 업데이트한다.

---

## 입력

- 새 버전 번호: 파인스크립트 파일에서 추출 (예: `v5.5.9.0`)
- 전략 ID: `donbeolja_v{버전}` (예: `donbeolja_v5.5.9.0`)
- ENGINE_VERSION: `{버전}` (예: `5.5.9.0`)

---

## 업데이트 대상 파일 및 항목

### 1. `cloudbuild.yaml`

#### 1-1. 메인 서비스 (`$_SERVICE`) 배포 블록
- `ENGINE_VERSION`: 새 버전으로 변경
- `WEBHOOK_ALLOWED_STRATEGY_IDS`: 새 전략 ID 추가 (기존 허용 목록 유지, 맨 앞에 추가)

#### 1-2. Egress 서비스 (`$_EGRESS_SERVICE`) 배포 블록
- `ENGINE_VERSION`: 새 버전으로 변경

#### 1-3. Exit Worker 서비스 (`$_EXIT_SERVICE`) 배포 블록
- `ENGINE_VERSION`: 새 버전으로 변경

### 2. `ecosystem.config.js`

- `ENGINE_VERSION`: 새 버전으로 변경
- `WEBHOOK_ALLOWED_STRATEGY_IDS`: 새 전략 ID 추가 (기존 허용 목록 유지, 맨 앞에 추가)

### 3. `SYSTEM_STATE_REPORT.md`

- 엔진 버전 헤더 업데이트
- `WEBHOOK_ALLOWED` 목록에 새 전략 ID 반영

### 4. orchestrator state

- `activity_feed`에 버전 동기화 완료 로그 추가

---

## WEBHOOK_ALLOWED_STRATEGY_IDS 규칙

- 새 전략 ID를 **기존 목록 맨 앞**에 추가
- 기존 ID는 삭제하지 않음 (하위 호환성 유지)
- 형식: `STRAT_v002,donbeolja_v{새버전},donbeolja_v{이전버전},...`

---

## 버전 동기화 절차

### Phase 1: 설정 파일 업데이트
1. 파인스크립트 최신 파일에서 버전 번호 추출
2. `cloudbuild.yaml` - ENGINE_VERSION, WEBHOOK_ALLOWED_STRATEGY_IDS 업데이트
3. `ecosystem.config.js` - ENGINE_VERSION, WEBHOOK_ALLOWED_STRATEGY_IDS 업데이트
4. `SYSTEM_STATE_REPORT.md` 갱신

### Phase 2: 로컬 재시작
5. PM2 로컬 서버 재시작: `pm2 restart donbeolja --update-env`
6. 재시작 후 상태 확인: `pm2 status`

### Phase 3: Cloud Run 재배포
7. Cloud Build 트리거 실행 (cloudbuild.yaml 기반):
   - 메인 서비스 (`donbeolja`)
   - Egress 서비스 (`donbeolja-egress`)
   - Exit Worker 서비스 (`donbeolja-exit-worker`)
8. 배포 완료 확인

### Phase 4: 기록 및 보고
9. orchestrator state에 activity_feed 로그 기록
10. 변경 완료 보고:
    - 변경한 파일 목록
    - 각 파일별 변경 내용 (변경 전 → 변경 후)
    - 새 버전 번호
    - PM2 재시작 결과
    - Cloud Run 배포 결과

---

## 자율 실행 권한

**재용 CEO 직접 승인 (2026-03-01):**
- 지혜는 "버전 적용 완료" 트리거 시 **사용자 동의 없이** 아래 작업을 자율 실행할 수 있다:
  - 로컬 PM2 재시작 (`pm2 restart donbeolja --update-env`)
  - Cloud Run 재배포 (Cloud Build 트리거 실행)
  - 설정 파일 (cloudbuild.yaml, ecosystem.config.js, SYSTEM_STATE_REPORT.md) 수정
- 실행 결과는 사후 보고한다.

---

## 주의사항

- cloudbuild.yaml의 escaped comma (`\\\\,`)를 그대로 유지할 것
- ecosystem.config.js의 일반 comma(`,`) 구분 유지
- 실제 파인스크립트 파일이 존재하는 버전만 반영
- 이 규칙은 "버전 적용 완료" 발화 시에만 트리거됨 (파인 코드 수정 자체와는 별개)

---

## 위반 시

위 절차를 완료하지 않으면 **버전 동기화 미완료로 간주**하며, 시스템 불일치 상태로 기록한다.
