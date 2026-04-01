# SERVER_SIGNAL_AUTHORITY_MIGRATION_CHECKLIST

- 기준일: 2026-04-01
- 상태: ACTIVE
- 상위 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_SPEC.md`

## 1. 목표

이 체크리스트는 `Pine 신호 정본 -> 서버 신호 정본` 전환을 실제 구현 순서와 현재 남은 작업 기준으로 정리한 실행 문서다.

## 2. 완료된 단계

### Phase 1. 정본 선언

완료:

1. UI 기본 화면이 `SERVER` source를 운영 신호로 본다.
2. 전략상태 화면에 `PINE_SHADOW`가 diagnostic으로만 표시된다.
3. Telegram 수신 알림은 `SERVER_SIGNAL_CREATED` 기준으로 재정의됐다.

### Phase 2. artifact 추가

완료:

1. `server_signal_runtime_latest.json`
2. `server_signal_authority_latest.json`
3. `server_signal_quality_latest.json`
4. `server_signal_cutover_readiness_latest.json`

### Phase 3. Pine shadow 강등

대부분 완료:

1. Pine webhook은 execution path를 만들지 않는다.
2. Pine payload는 shadow artifact로 저장된다.
3. Pine mismatch는 진단 evidence로만 쓴다.

## 3. 진행 중인 단계

### Phase 4. 서버 직접 signal generation 안정화

현재 상태:

1. 서버는 authoritative signal을 생성할 수 있다.
2. signal은 `source=SERVER`, `authoritative=true`로 저장된다.
3. 다만 아직 `SERVER_PRIMARY` 승격 전 마지막 drift 조정이 남아 있다.

남은 완료 조건:

1. `EV_POLICY_DRIFT_ACTIVE` 해소
2. `COOLDOWN_POLICY_DRIFT_ACTIVE` 해소
3. `promotion_ready = true`
4. `canonical_engine_source_mode = SERVER_PRIMARY`

### Phase 5. Pine 최종 shadow 마감

남은 완료 조건:

1. Pine는 비교/시각화로만 사용
2. 운영 의사결정이 Pine 없이 닫힘
3. 2주 비교 운영 기준 충족
4. 신호 체계 변경 시 Pine 동반 산출물 3종이 항상 같이 갱신됨

## 4. 현재 blocker

현재 cutover readiness 기준 실질 blocker는 아래 2개다.

1. `EV_POLICY_DRIFT_ACTIVE`
   - 권장 조치: `LOWER_EV_TP1_MIN_REVIEW`
2. `COOLDOWN_POLICY_DRIFT_ACTIVE`
   - 권장 조치: `RELAX_OPPOSITE_COOLDOWN_REVIEW`

참고:

1. `STRATEGY_GATE`는 `historical_only`로 현재 blocker에서 빠졌다.

## 5. 현재 acceptance 테스트

계속 봐야 하는 기준:

1. `source_parity_mismatch_n = 0`
2. `authoritative_entry_signal_24h_n > 0`
3. `order_intent_24h_n > 0`
4. `fill_24h_n > 0`
5. `server_signal_cutover_readiness.summary.blockers` 감소 추세
6. 최신 서버 신호 체계 변경마다 아래 3개가 같이 갱신됨
   - `SIGNAL_REDESIGN.pine.txt`
   - `PRODUCTION_CANDIDATE.pine.txt`
   - `TV_IMPORT_FINAL.pine.txt`

## 6. rollback 조건

아래 중 하나면 승격을 hold 또는 rollback한다.

1. `source_parity_mismatch_n > 0`
2. `authoritative_entry_signal_24h_n = 0`이 연속 발생
3. `SERVER_SIGNAL_NOT_REACHING_EXECUTION`
4. `intent_conversion_rate` 급락과 `fill_24h_n = 0` 동시 발생
5. `promotion_ready` 없이 `SERVER_PRIMARY` 승격 시도

## 7. 남은 실제 순서

1. `EV_POLICY` drift 축소
2. `COOLDOWN_POLICY` drift 축소
3. `SERVER_PRIMARY` 승격 acceptance 재평가
4. Pine shadow 비교 운영 2주 유지
5. Pine 완전 shadow 마감 선언

## 8. Pine 동반 산출물 규칙

신호 체계 변경은 아래를 같은 묶음으로 본다.

1. 서버 설정/정책 변경
2. Pine shadow source 갱신
3. TradingView import final 갱신

즉 `서버 신호 체계만 바뀌고 Pine가 안 바뀐 상태`는 완료로 보지 않는다.

## 9. 현재 판단

현재 돈벌자는 더 이상 단순 `Pine ingress + server consume` 구조로 설명하면 정확하지 않다.

현재 더 정확한 판단은 아래다.

1. `Server = signal authority (in progress)`
2. `Pine = display/comparison shadow`
3. 남은 것은 구조 구현보다 `drift 제거와 승격 마감`
