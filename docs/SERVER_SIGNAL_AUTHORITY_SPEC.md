# SERVER_SIGNAL_AUTHORITY_SPEC

- 기준일: 2026-04-03
- 상태: ACTIVE
- 검수 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03.md`

## 1. 한 줄 정의

돈벌자의 최종 신호 시스템은 `서버 canonical engine이 직접 신호를 생성`하고, `Pine는 shadow display`로만 남는 구조다.

## 2. 정본 규칙

### 2.1 authoritative server signal

아래를 모두 만족해야 한다.

1. `source = SERVER`
2. `authoritative = true`
3. runtime strategy/engine과 일치
4. server bar snapshot 기준 `bar_close_time_utc_ms`

### 2.2 Pine shadow signal

1. `source = PINE_SHADOW`
2. `authoritative = false`
3. execution authority를 만들지 않음
4. parity/visualization에만 사용

## 3. 현재 운영 truth (as-of 2026-04-03 14:11 KST)

1. `server_signal_runtime_latest`
   - `runtime_status=READY`
   - `canonical_engine_source_mode=SERVER_PRIMARY`
   - `watchdog_verdict=PASS`
2. `server_signal_cutover_readiness_latest`
   - `readiness_status=SERVER_PRIMARY_ACTIVE`
   - `promotion_gate_status=BLOCKED`
   - `promotion_block_reasons=[ARTIFACT_GENERATED_AT_SKEW_EXCEEDED]`
   - `artifact_coherence_status=BLOCKED`
3. `server_signal_quality_latest`
   - `quality_status=WATCH_PARITY_DRIFT`
   - `parity_mismatch_n=15`
   - `final_downstream_mismatch_n=15`
   - `other_server_policy_mismatch_n=3`
4. `automation_watchdog_latest`
   - `scheduler_mode=OPENCLAW_CRON`
   - `verdict=PASS`

## 4. 해석 규칙

1. `SERVER_PRIMARY_ACTIVE`는 source-mode truth다.
2. promotion 판정은 `promotion_gate_status`로 읽는다.
3. `artifact_coherence_status!=READY`면 cutover promotion은 cleared로 읽지 않는다.
4. Pine 관련 판정은 `PINE_SHADOW/SHADOW_ONLY` 유지 여부만 본다.
5. 운영 정본 판단에는 Pine를 포함하지 않는다.

## 5. 데이터 계약 보강

### 5.1 lineage

1. `signals -> intents -> fills -> trades`
2. `signals -> drops`
3. drop write는 가능하면 `signal_id`, `signal_doc_id`, `canonical_event_id`를 남긴다.

### 5.2 live execution policy trace

intent/fill/drop에는 아래 top-level trace가 관측 가능해야 한다.

1. `live_exec_policy_reason`
2. `live_exec_policy_plan_status`
3. `live_exec_policy_plan_mode`
4. `live_exec_policy_global_qty_scale`
5. `live_exec_policy_market_qty_scale`
6. `live_exec_policy_blocked`

## 6. 현재 결론

1. server is the only execution authority
2. Pine is still shadow-only
3. source-mode cutover는 운영 기준으로 완료
4. promotion gate는 artifact skew 때문에 아직 blocked
