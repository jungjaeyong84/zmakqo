# BEST_SELF_EVOLUTION_CANARY_SPEC

- 제정: 2026-03-29
- 상태: ACTIVE
- 목적: 후보 변경을 shadow 이후 시장별 canary로 적용하고 실패 시 자동 rollback하는 규격

## 0. 현재 SSOT

1. latest artifact
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canary_latest.json`
2. stage source
   - `SHADOW -> SOFT -> HARD`
3. rollout wave
   - `WAVE_1`: `BTCUSDT`, `SOLUSDT`
   - `WAVE_2`: `ETHUSDT`, `BNBUSDT`, `XRPUSDT`
   - `WAVE_3`: `DOGEUSDT`, `AXSUSDT`
4. current auto action
   - `PROMOTE_SOFT`
   - `PROMOTE_HARD`
   - `AUTO_ROLLBACK`
   - `KEEP`
5. scale fields
   - `current_open_wave`
   - `open_wave`
   - `next_wave_candidate`
   - `scale_allowed`
   - `scale_block_reason`

## 1. canary 단위

1. `market`
2. `tf`
3. `candidate_id`
4. `stage`
   - `SHADOW`, `SOFT`, `HARD`

## 2. canary 확대 규칙

1. BTCUSDT, SOLUSDT부터 시작
2. DOGEUSDT, AXSUSDT는 뒤로
3. `objective_score`와 `count_ratio_global`이 유지될 때만 확대
4. `replay.validation_verdict = PASS` 여야 한다
5. `global_canary_pass = true` 여야 한다
6. 시장 계약이 `COUNT_GUARD_ACTIVE` 또는 `RECOVERY_FIRST`면 tighten 승격을 막는다
7. 이전 canary wave가 건강하고 memory가 실패 우세가 아닐 때만 다음 wave를 연다

## 3. rollback 조건

1. `count_ratio_global < 1.00`
2. `replacement_ratio` 붕괴
3. `avg_ret_net` 열화
4. `latency_penalty` 초과
5. `duplicate/reject/stale` 급증

## 4. rollback 출력

1. `rollback_reason`
2. `rollback_target`
3. `rollback_scope`
4. `rollback_triggered_at`

## 5. 감독관/자동 적용 연동

1. 감독관은 `self_evolution_canary`를 읽고
   - `SELF_EVOLUTION_CANARY_BLOCK`
   - `SELF_EVOLUTION_CANARY_ROLLBACK_READY`
   를 차단 사유로 올린다
2. `stage_autopilot`은
   - `apply_pass = false`면 promotion apply를 막고
   - `rollback_ready_n > 0`면 auto rollback adverse 조건으로 본다
