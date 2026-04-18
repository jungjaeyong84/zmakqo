# DONBEOLJA Cloud Build Deploy Rules (영구 규칙)

- 제정: 2026-04-18
- 제정자: 재용 (CEO)
- 적용 대상: deploy, ops, system_dev, 모든 워커
- 상태: **시행 중 (ACTIVE)**

---

## 배경

2026-04-18 이전까지 Cloud Build 트리거 `db7cd873-8927-419d-a232-855648b727f5`
(name: `rmgpgab-donbeolja-asia-northeast3-jungjaeyong84-zmakqo--mawpc`)는
자동 생성된 "Deploy to Cloud Run" 인라인 설정만 사용하여 `cloudbuild.yaml`을 **무시**했다.

결과:
- 트리거가 수행한 배포는 `gcloud run services update donbeolja --image=... --labels=... --region=... --quiet` 한 줄뿐.
- `--set-env-vars` / `--set-secrets` / `--memory` / `--max-instances` / `--timeout` 등 옵션이 전부 누락.
- 4개 서비스 중 메인 `donbeolja`만 배포되고 `donbeolja-egress`, `donbeolja-egress-private`, `donbeolja-exit-worker`는 **배포되지 않음**.
- env 변수 변경을 repo에 commit해도 live에 반영되지 않아, 매번 수동으로 `gcloud run services update --set-env-vars ...` 실행하여 복구해야 했음.
- 예: commit `2e2d82a2` 기반 build `4675754f-3c9e-4090-acd6-1dd437b24e44` 배포 후 `ENTRY_MAKER_FIRST_ENABLED=1` 등 누락 → 수동 복구.

## 변경 사항 (2026-04-18)

트리거를 `cloudbuild.yaml` 모드로 전환:

```yaml
# /tmp/dbj-trigger-backup/trigger-new.yaml (적용 완료)
filename: cloudbuild.yaml
# (기존 build: 블록 제거, 기존 substitutions: 제거)
```

적용 명령:

```bash
gcloud beta builds triggers export db7cd873-8927-419d-a232-855648b727f5 \
  --project=donbeolja-dev \
  --destination=/tmp/trigger-backup.yaml  # 백업

# 편집: build: 블록 삭제 → filename: cloudbuild.yaml 추가, substitutions: 삭제

gcloud beta builds triggers import \
  --project=donbeolja-dev \
  --source=/path/to/edited.yaml
```

---

## 규칙 1: env 변수 변경은 `cloudbuild.yaml`로만 한다

**2026-04-18부터 Cloud Run env 변수 변경은 반드시 `cloudbuild.yaml`을 git commit → trigger 실행으로 반영한다.**

### 금지 행위

- `gcloud run services update --set-env-vars=...` 를 **production 복구 목적 외에는** 직접 실행하지 말 것.
- 수동 `set-env-vars`로 복구한 경우, **즉시** 동일 변경을 `cloudbuild.yaml`에 commit하여 drift를 제거할 것 (다음 빌드에서 덮어쓰이지 않도록).

### 권장 흐름

1. `cloudbuild.yaml`의 해당 서비스 `--set-env-vars` 블록을 편집.
2. PR → review → merge.
3. 자동 또는 수동 트리거로 build 실행:
   ```bash
   gcloud beta builds triggers run db7cd873-8927-419d-a232-855648b727f5 \
     --project=donbeolja-dev --branch=<target-branch>
   ```
4. build 성공 후 4개 서비스 env 값 확인:
   ```bash
   for s in donbeolja donbeolja-egress donbeolja-egress-private donbeolja-exit-worker; do
     echo "=== $s ==="
     gcloud run services describe $s --region=asia-northeast3 \
       --project=donbeolja-dev --format="value(spec.template.spec.containers[0].env)"
   done
   ```

---

## 규칙 2: `master` 브랜치 `cloudbuild.yaml` 최신화 의무

트리거의 push 필터는 `^master$`이다. 2026-04-18 기준 `origin/master`의 `cloudbuild.yaml`은 **74줄 구버전**이며, 현재 운영 중인 `cloudbuild.yaml` (120줄)과 크게 다르다 (`donbeolja-egress-private` 서비스 누락, OPENCLAW/OTEL/ENTRY_MAKER 등 env 변수 다수 누락).

### 경고

- **`master` 에 직접 push하면** 낡은 `cloudbuild.yaml` 로 배포되어 env 변수 누락 + egress-private 미배포 발생.
- **해결책**: 최신 `cloudbuild.yaml`을 `master`에 PR/merge하여 동기화할 것.

### 잠정 운영 방식 (master 동기화 전까지)

- 자동 push 배포 금지. 수동 트리거만 사용:
  ```bash
  gcloud beta builds triggers run db7cd873-8927-419d-a232-855648b727f5 \
    --project=donbeolja-dev --branch=<good-branch>
  ```
- `<good-branch>`는 최신 `cloudbuild.yaml`이 있는 브랜치여야 한다.

---

## 규칙 3: 트리거 설정 변경 시 반드시 백업

```bash
# 변경 전
gcloud beta builds triggers export <TRIGGER_ID> \
  --project=donbeolja-dev \
  --destination=/tmp/trigger-backup-$(date +%Y%m%d-%H%M%S).yaml
```

롤백은 `gcloud beta builds triggers import --source=<backup>` 으로 즉시 가능.

---

## 참고 build ID (전환 검증)

- 전환 전 마지막 auto-gen build: `4675754f-3c9e-4090-acd6-1dd437b24e44` (env 누락, gate 우회하고 배포)
- 전환 후 첫 검증 build: `f9afd1fa-1998-4a7d-94f9-a3683eacf711` (branch `codex/google-grade-ml-cutover-20260411` @ `2e2d82a2`) → **gate 차단으로 배포 미진행**

---

## ⚠️ 중대 발견: gate가 처음으로 활성화됨 (2026-04-18)

전환 직후 첫 검증 빌드에서 `npm run check:binance-exit-integrity-gate`가 다음 이유로 배포를 block:

```
reason: EXIT_INTEGRITY_DEPLOY_GATE_BLOCKED
reasons:
  - STATUS_NOT_OK:WARN
  - LIVE_GATE_BLOCKED
  - EXIT_QTY_LIVE_ISSUE_CHAIN (2건)
  - AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION (2건)

summary:
  live_issue_count: 4
  actionable_live_issue_count: 4
  exit_qty_live_issue_chain_n: 2
  authority_actionable_live_issue_position_n: 2
  stage_issue_symbol_n: 1
  skipped_validation_families: [EXCHANGE_IO]  # EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1 때문
```

### 해석

- 이전 auto-gen 트리거에선 `npm test` / `check:*gate` 가 아예 실행되지 않았다 → 이 gate들은 **처음부터 완전히 우회되고 있었음**.
- 따라서 위 live 이슈들은 최소 2025-12-17 이후 누적되어 온 것일 수 있음 (트리거 createTime 기준).
- `cloudbuild.yaml` 트리거 전환 후부터는 **Firestore 상의 live 상태가 건강해야 배포 가능**.

### 2026-04-18 검증 빌드 시점 live 이슈 상세

#### (A) BTCUSDT 체인 qty 이슈 2건 (`EXIT_QTY_LIVE_ISSUE_CHAIN`)
- 2026-04-17 15:45 UTC TP1 fill에서 **외부(EXTERNAL) fill 2개가 동일 event/price로 각각 50%씩** TP1에 분류되어 `tp1_qty=1.0` (chain 1), `tp1_qty=1.1667` (chain 2) — 예상 ≤ 0.53.
- issue codes: `TP1_ABS_OVER`, `TP_CHAIN_ABS_OVER`, `TOTAL_EXIT_OVER_100`
- 현재 BTCUSDT 포지션(qty_base 0.004 SHORT, 2026-04-18 새 엔트리)과는 별개의 **히스토리 감사 기록**이나, `binance_exit_qty_live_separation` 로직이 live로 분류 중.
- 관련 파일:
  - `ops/daily/binance_exit_qty_contract_audit_latest.json` — 체인 상세
  - `ops/daily/binance_exit_qty_live_separation_latest.json` — live/historical 분리
- **조치 방향 (CEO/operator 판단 필요)**:
  - 해당 체인을 historical로 이관하거나 `backfilled: true` 마킹
  - 또는 `binance_exit_qty_live_separation` 기준 재검토

#### (B) DOGEUSDT RUNNER_MIN_GUARANTEE_MISSED 1건 (`AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION`)
- 현재 SHORT 포지션 `qty_base=10112`, `avg_price=0.0984`
- stage `TRAIL`, `tp_p1_done=true`, `trail_active=true`
- `native_stop_order_id=4000001112563983` @ 0.09825
- `chosen_stop_source=RUNNER_FLOOR` @ 0.0975882
- `min_guaranteed_profit_pct=0.0165`, **`current_guaranteed_profit_pct=0.00305`** → 미달
- **조치 방향 (실제 trading action, CEO/operator 판단 필요)**:
  - native stop을 1.65% 보장 가능 수준으로 이동
  - 또는 해당 포지션 수동 청산
  - 또는 RUNNER_FLOOR 로직 자체 재검토 (최소 보장이 왜 깨졌는지)

#### (C) BTCUSDT artifact 1건 (`EXIT_QTY_LIVE_ISSUE_ARTIFACT`)
- 위 (A)가 clear 되면 자동 해제됨

### 배포 재개 경로

다음 중 택일:

1. **(권장) live 이슈 해결 후 재배포**
   - 위 (A)(B) 해결 (operator action)
   - 재검증: `EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1 node scripts/check-binance-exit-integrity-gate.js`
   - 빌드: `gcloud beta builds triggers run db7cd873-8927-419d-a232-855648b727f5 --project=donbeolja-dev --branch=<branch>`

2. **(긴급용) gate 단계만 임시 완화**
   - `cloudbuild.yaml` Step 1 args에서 `&& npm run check:binance-exit-integrity-gate` 만 임시 제거 → 빌드 → 즉시 git revert
   - **반드시 동일 영업일 내 revert 필수**

3. **(비권장) 트리거 롤백**
   ```bash
   gcloud beta builds triggers import \
     --project=donbeolja-dev \
     --source=/tmp/dbj-trigger-backup/trigger-original-20260418-175332.yaml
   ```
   → gate 우회로 되돌아가지만 env 전파도 다시 끊어짐.

### 상태 확인 명령

```bash
# 4개 서비스가 아직 갱신 안 됐는지 확인 (generation 번호 변동 없으면 미배포)
for s in donbeolja donbeolja-egress donbeolja-egress-private donbeolja-exit-worker; do
  gcloud run services describe $s --region=asia-northeast3 --project=donbeolja-dev \
    --format="value(metadata.generation,status.latestReadyRevisionName)"
done
```

### 2026-04-18 전환 직후 상태 스냅샷

- `donbeolja` gen=1439, revision=`donbeolja-01437-mbj` (전환 전 값 그대로)
- `donbeolja-egress` gen=656, revision=`donbeolja-egress-00656-gjc` (변동 없음)
- `donbeolja-egress-private` gen=202, revision=`donbeolja-egress-private-00202-8vb` (변동 없음)
- `donbeolja-exit-worker` gen=881, revision=`donbeolja-exit-worker-00762-hj5` (변동 없음)
- `ENTRY_MAKER_FIRST_ENABLED=1` 등 2026-04-18 수동 복구 env 값 보존됨
