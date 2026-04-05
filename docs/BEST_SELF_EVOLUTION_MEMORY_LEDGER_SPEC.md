# BEST_SELF_EVOLUTION_MEMORY_LEDGER_SPEC

- 제정: 2026-03-29
- 업데이트: 2026-04-05
- 상태: ACTIVE
- 목적: 과거 패치와 결과를 기억해 실패 후보의 반복을 막는 ledger 규격

## 0. 현재 SSOT

1. latest artifact
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_memory_latest.json`
2. current summary
   - `blocked_candidate_ids`
   - `top_success_candidate_id`
   - `top_failed_candidate_id`
   - `recent_failed_fingerprints`
3. current use
   - 감독관 summary
   - Codex weekly patch engine prompt
   - repeated fail fingerprint 차단

## 1. ledger key

1. `candidate_id`
2. `applied_week_key`
3. `scope`
4. `markets`
5. `change_fingerprint`

## 2. 필수 결과

1. `objective_delta`
2. `count_delta`
3. `replacement_delta`
4. `avg_ret_net_delta`
5. `verdict`
   - `SUCCESS`, `NEUTRAL`, `FAIL`, `ROLLED_BACK`
6. `rollback_reason`
7. `verification_sample_n`
8. `memory_verdict`
   - `SUCCESS`, `NEUTRAL`, `PROVISIONAL_FAIL`, `FAIL`, `ROLLED_BACK`

## 3. 사용 규칙

1. 최근 `FAIL` fingerprint와 유사한 후보 자동 재시도 금지
2. 시장별로 성공 패치 우선 재사용
3. ledger는 Codex 후보 프롬프트에 반드시 주입
4. `blocked_candidate_ids`는 감독관과 patch engine이 그대로 소비할 수 있어야 한다
5. `verification_sample_n`이 부족한 EV remediation 실패는 즉시 `FAIL`로 확정하지 않는다.
6. 저표본 EV remediation 실패는 `PROVISIONAL_FAIL`로 기록하고, 동일 fingerprint 2주 block을 바로 걸지 않는다.
7. 실행 미세구조 계열 후보(`FAST_TP0`, `TRAIL_DELAY`, `PORTFOLIO_CLUSTER_CAP`, `EXTERNAL_FLAT_SYNC_GRACE`)는 EV calibration 후보와 분리해 fingerprint를 만든다.
8. `FAST_TP0` 계열 후보는 최소 아래 KPI를 함께 기록한다.
   - `tp0_hit_rate`
   - `tp0_to_tp1_conversion_rate`
   - `pre_tp1_stop_rate`
   - `fee_adjusted_avg_ret_net`
