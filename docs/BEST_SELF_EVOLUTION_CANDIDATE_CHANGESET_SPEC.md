# BEST_SELF_EVOLUTION_CANDIDATE_CHANGESET_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: Pine/WAIT/EV/ML/AI 변경 후보를 하나의 schema로 통일

## 1. candidate_change_set 필수 필드

1. `candidate_id`
2. `scope`
   - `PINE`, `WAIT`, `EV`, `ML`, `AI`, `MULTI`
3. `markets`
4. `tf`
5. `changes`
6. `objective_delta`
7. `count_guard_effect`
8. `replacement_effect`
9. `risk_flags`
10. `rollback_target`

## 2. changes 형식

각 change는 아래를 가진다.

1. `key`
2. `current`
3. `next`
4. `direction`
   - `TIGHTEN`, `LOOSEN`, `SHIFT`, `DISABLE`, `ENABLE`
5. `reason`

## 3. 금지 조건

1. allowlist 밖 파라미터 자동 변경 금지
2. 동시에 2개 초과 leverage 자동 변경 금지
3. count floor를 깨는 multi-layer hardening 금지
