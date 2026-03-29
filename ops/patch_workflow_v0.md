# DONBEOLJA Patch Workflow v0 (Manual Approval)

목표:
- 자동은 "제안"까지만 수행한다.
- 적용(코드 변경/배포)은 항상 수동 승인 후에만 진행한다.

---

## 주기
- 주 1회 (Weekly Pack 생성 직후)

---

## 입력물
- /tmp/donbeolja_patch_pack.zip
- /tmp/donbeolja_patch_candidates.json

---

## 승인 단계 (Gate)

### Gate-1: 적합성 검토
- 후보(trigger_id)가 ops/patch_rules_v0.md(T1~T5)에 포함되는가?
- 증거(evidence)가 report.json에서 재현 가능한가?

통과 기준:
- YES 2/2

---

### Gate-2: 영향 범위 평가
- proposed_patch가 단일 파일/단일 모듈인가?
- 롤백 조건(rollback_condition)이 측정 가능 지표인가?

통과 기준:
- 변경 파일 ≤ 3
- 롤백 지표 명시

---

### Gate-3: 안전성 체크
- 상태 머신/거래 실행 경로에 직접 영향이 없는가?
- LIVE 자금에 영향이 없는 PAPER/분석 경로인가?

통과 기준:
- PAPER/리포트/집계 경로만 변경

---

## 승인 산출물
- 승인 메모 1건 (Markdown)
  - 승인 일시
  - trigger_id
  - 변경 파일 목록
  - 롤백 기준

---

## 실행 규칙
- 승인 없이 커밋 금지
- 승인 커밋은 단일 커밋
- 태그 부여: patch-YYYYWW-<trigger_id>

---

## 거부 규칙
- Gate 중 하나라도 실패 시 거부
- 다음 주기로 이월 가능

