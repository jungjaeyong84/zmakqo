# Position Cycle ID Throw-Graduation Cutover Runbook

2026-04-27 — Stage 4 (prod 격상). Stage 3a/3b-1/3b-2/3b-3 가 코드 레벨에서
`meta.position_cycle_id` 의 stamp · observe · throw 를 모두 마련했다. 본 런북은
**prod 환경**에서 throw 를 enable 하기 위한 운영 절차다.

## Goal
- `meta.position_cycle_id` 부재로 라이브 ACTIVE 가 다시 생성되는 경로를
  prod 에서도 영구 차단.
- 차단 전에 라이브 잔재(backfill 미완료 상태)를 정리해 정상 트래픽이
  block 되지 않도록 보장.

## Preconditions
1. master 의 빌드가 SUCCESS 이며 prod Cloud Run 에 배포된 상태.
   - Stage 3a (`c93bcd1` 이상): write boundary stamp.
   - Stage 3b-1 (`cdb1f3c` 이상): warn-only observer.
   - Stage 3b-2 (`d759b2f` 이상): backfill 스크립트 + npm wiring.
   - Stage 3b-3 (`f72249b` 이상): throw enforcement 코드 + env gate.
2. `POSITION_INVARIANT_THROW_ENABLED` 가 prod 에서 어떤 상태여도 무방
   (별도 cutover). 본 cutover 는 `POSITION_CYCLE_ID_THROW_ENABLED` 만 다룸.
3. `npm test` 통과한 릴리즈 후보.
4. Cloud Logging 에서 `position_cycle_id_missing` 이벤트의 24h 카운트를
   조회 가능해야 함.

## 실행 순서

### 1. dry-run 으로 백필 후보 식별

```bash
GOOGLE_CLOUD_PROJECT="<PROD_PROJECT>" \
npm run backfill:position-cycle-id
```

산출물:
- 콘솔: `[DRY] <exchange> <symbol> pos=<pos_id> entry=<entry_event_id>` 라인.
- 감사 로그: `ops/runtime/position-cycle-id-backfill-<YYYY-MM-DD>.jsonl`.

체크:
- 후보 수가 합리적인 범위 (보통 한 자릿수 ~ 수십 개).
  비정상적으로 많으면(예: 수백 개) 라이브 분리 사고 가능 → 작업 보류.
- `seeded_from_entry_event_id=true` 비율 확인. false 가 많으면
  `entry_event_id` 도 같이 비어 있다는 뜻 → Stage 1 invariant 위반.
  prod 에 별도 데이터 정리 필요.

### 2. apply 로 stamp 실행

```bash
GOOGLE_CLOUD_PROJECT="<PROD_PROJECT>" \
npm run backfill:position-cycle-id -- --apply
```

처리량 조절이 필요하면 `--limit N` 으로 단계 분할.
환경변수:
- `POSITION_CYCLE_BACKFILL_PAGE_SIZE` (default 500)
- `POSITION_CYCLE_BACKFILL_THROTTLE_MS` (default 25)

산출물:
- 콘솔: `[APPLY] <exchange> <symbol> pos=<pos_id> cycle=<cycle_id>` 라인.
- 감사 로그: 같은 파일에 `backfill_stamp_ok` / `backfill_stamp_fail` event 추가.
- Firestore `positions_paper` 도큐먼트: `meta.position_cycle_id` 채워짐.

체크:
- `stats.failed === 0`. 실패 행이 있으면 audit 의 `error_code` /
  `error_message` 로 root cause 분석. (예: `POSITION_INVARIANT_VIOLATION`
  은 entry_event_id 등 다른 invariant 위반 — Stage 1 cutover 와 충돌)
- backfill 직후 동일 dry-run 을 다시 실행해 후보 0 임을 확인.

### 3. Soak — observer warn 카운트 0 으로 수렴 확인

Cloud Logging query:

```
resource.type="cloud_run_revision"
jsonPayload.event="position_cycle_id_missing"
```

- 24h 동안 카운트가 0 인지 확인.
- 0 이 아니면: 어떤 writer 가 cycle_id 를 빠뜨리고 있다는 뜻.
  `writer_scope` / `mutation_kind` / `source` 필드로 origin 식별.
  Stage 3a 의 stamp 가 누락된 경로일 가능성 → 코드 패치 후 다시 step 1.
- soak 권장 1–2일. 운영 일정에 따라 단축 가능 (최소 6시간).

### 4. throw enable

Cloud Run 환경변수 추가:

```bash
gcloud run services update <SERVICE> \
  --project "<PROD_PROJECT>" \
  --region "<REGION>" \
  --update-env-vars POSITION_CYCLE_ID_THROW_ENABLED=1
```

다음 revision 부터:
- `meta.position_cycle_id` 가 빠진 ACTIVE 쓰기 시도가 `POSITION_CYCLE_ID_VIOLATION`
  코드의 typed error 로 차단됨 (transaction 시작 *이전*).
- structuredLog `position_cycle_id_missing` 은 throw 와 함께 그대로 발화 → 운영자
  가 차단 원인을 즉시 인지.

### 5. 사후 모니터링

- 첫 1시간:
  - `POSITION_CYCLE_ID_VIOLATION` 카운트 (Cloud Logging error 레벨) 확인.
  - **갑자기 폭증하면** 정상 트래픽까지 차단됐다는 뜻. step 6 (kill switch)
    으로 즉시 복구.
  - 0 또는 한 자릿수면 정상.
- 24h 후:
  - 차단된 case 의 root cause 가 모두 식별됐는지 확인.

### 6. Kill switch (이상 시)

```bash
gcloud run services update <SERVICE> \
  --project "<PROD_PROJECT>" \
  --region "<REGION>" \
  --update-env-vars POSITION_CYCLE_ID_THROW_ENABLED=0
```

→ throw 가 다시 warn-only 로 복귀. Stage 3b-1 상태와 동일.
이후 root cause 패치하고 step 3 부터 재시작.

## 참고

- Stage 1 의 `POSITION_INVARIANT_THROW_ENABLED` 와는 **독립** cutover. 두 플래그를 같이 켜거나 끌 필요 없음.
- 본 throw 는 `observePositionCycleIdPresence` 의 *pre-commit* 체크에서
  발생 — Firestore write 가 시작되기 전. corruption 자체가 일어나지 않음.
- 백필 실패 audit 가 한 건이라도 있으면 step 4 진행 금지. (실패 도큐먼트가
  여전히 cycle_id 없는 채로 라이브에 떠 있어, throw enable 시 다음 META
  write 가 차단됨.)
