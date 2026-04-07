# 시스템 상태 리포트

- 최종 업데이트: 2026-04-02 KST
- 엔진 버전: `6.1.1.0`
- 전략 ID: `donbeolja_v6.1.1.0`
- 기본 실행: `BINANCEFUT / 15m / 7 markets`
- 현재 source mode: `SERVER_PRIMARY`
- 서버 정본 전환 진행률: `100% (전환 완료, acceptance 단계)`

검수 공통 SSOT:
- [/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md](/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md)

## 1. 현재 운영 기준

1. 정본 신호: `SERVER`
2. 그림자 신호: `PINE_SHADOW`
3. 외부 엔트리 이벤트: `LONG / SHORT`
4. entry grade: `EARLY / CORE`
5. quantity profile: `FIXED`
6. 실행 정본: `SERVER_CANONICAL`
7. Telegram 정본: `서버 정본 신호`

## 2. 최신 artifact 기준 상태

### 2.1 server signal runtime (`2026-04-02 16:07:30 KST`)

- `runtime_status = READY`
- `canonical_engine_source_mode = SERVER_PRIMARY`
- `exec_tf = 15m`
- `market_count = 7`
- `pine_shadow_transition_status = COMPLETE`
- `pine_shadow_transition_progress_pct = 100`

### 2.2 server signal authority (`2026-04-02 16:07:30 KST`)

- `authoritative_server_24h_n = 2`
- `pine_shadow_24h_n = 43`
- `parity_mismatch_rate = 0.5714`
- `source_parity_mismatch_n = 0`
- `authority_status = PARITY_DRIFT`

### 2.3 server signal quality (`2026-04-02 16:07:30 KST`)

- `authoritative_entry_signal_24h_n = 1`
- `order_intent_24h_n = 1`
- `fill_24h_n = 3`
- `quality_status = WATCH_PARITY_DRIFT`
- `top_drop_reason_family = EV_POLICY`

### 2.4 server signal cutover readiness (`2026-04-02 16:07:31 KST`)

- `promotion_ready = false`
- `readiness_status = SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`
- `blockers = [EV_POLICY_DRIFT_ACTIVE, COOLDOWN_POLICY_DRIFT_ACTIVE, SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT]`
- `dominant_mismatch_family = EV_POLICY`
- `recommended_action = LOWER_EV_TP1_MIN_REVIEW`
- `strategy_gate_historical_only = true`

### 2.5 openclaw autonomy contract (`2026-04-02 16:11:30 KST`)

- `goal_state = OBJECTIVE_RECOVERY_REQUIRED`
- `authority_state = PENDING`
- `phase_d_status = SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`
- `ops_status = PASS`
- `server_signal_transition_status = COMPLETE`
- `server_signal_transition_progress_pct = 100`

### 2.6 policy parameter plan (P2)

- `status = HOLD`
- `mode = ADVISORY_ONLY`
- `global_qty_scale = 0.55`
- `ev_policy_action = PRIORITIZE_EV_TP1_THRESHOLD_TUNE`
- `blockers = [GOVERNOR_BLOCKED, DEGRADED_AUTHORITY_NOT_ELIGIBLE]`

## 3. 현재 핵심 해석

1. 서버는 이미 15분 봉을 읽고 내부 정본 신호를 생성할 수 있다.
2. Pine 신호는 저장/비교용 그림자 경로로 강등됐다.
3. UI와 Telegram, self-evolution은 대부분 서버 정본 기준으로 정렬됐다.
4. `SERVER_PRIMARY`는 활성 source mode지만 acceptance 조건은 아직 hold 상태다.
5. 남은 실질 blocker는 `EV_POLICY`, `COOLDOWN_POLICY` 두 계열이다.

## 4. 사용자 화면 구조

현재 사용자 화면은 아래 우선순위로 본다.

1. `홈`: 자산/수익/거래 요약
2. `수익`: 기간별 손익과 구조
3. `입출금`: 순유입/유출
4. `거래기록`: 최근 신호/주문/실행
5. `전략상태`: 서버 정본 전환 상태와 운영 artifact

## 5. 지금 당장 보면 되는 문서

1. [README](/Users/jeongjaeyong/Projects/donbeolja/README.md)
2. [시스템 맵](/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md)
3. [서버 정본 규격](/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_SPEC.md)
4. [비교 운영안](/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_VS_PINE_SHADOW_COMPARISON_RUNBOOK.md)
5. [OpenClaw autonomy contract](/Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md)
