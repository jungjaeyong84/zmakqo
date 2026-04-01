# SERVER_SIGNAL_AUTHORITY_SPEC

- 기준일: 2026-04-01
- 상태: ACTIVE
- 목적:
  - `서버 = 신호 생성 정본`, `Pine = 시각화 전용 shadow` 구조를 돈벌자 시스템의 현재 전환 기준으로 고정한다.
  - `UI / Telegram / execution / self-evolution / deployment authority`가 모두 서버 신호를 기준으로 동작하도록 책임 경계를 명확히 한다.
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_MIGRATION_CHECKLIST.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_VS_PINE_SHADOW_COMPARISON_RUNBOOK.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_V6_1_1_0_TV_IMPORT_AND_CONSUMER_CONTRACT.md`

## 1. 한 줄 정의

돈벌자의 최종 신호 시스템은 `서버 canonical engine이 RE/RC/SE/SC를 직접 생성하고`, `Pine는 그 결과를 차트에 비교/시각화하는 shadow display`로만 남는 구조다.

## 2. 왜 바꾸는가

과거 구조는 아래 경계를 가졌다.

1. `Pine -> webhook ingest`
2. `webhook save -> server consume`
3. `server consume -> intent/fill/trade`

이 구조는 아래 문제를 만든다.

1. Pine에서는 신호가 보이는데 서버 정본에는 없을 수 있다.
2. webhook 수신 성공이 실제 실행 성공과 다르다.
3. Pine 버전과 서버 버전이 drift 날 수 있다.
4. self-evolution이 서버를 개선해도 Pine가 실질 정본이면 authority/deployment의 의미가 약해진다.

따라서 최종 구조는 `신호 생성 정본을 서버로 일원화`해야 한다.

## 3. 현재 책임 분리

### 3.1 서버가 책임지는 것

1. OHLCV / TF 기준 정렬
2. 시장 상태 계산
3. `RE / RC / SE / SC` 생성
4. signal drop / defer / downgrade 판단
5. order intent 생성
6. execution / fill / trade 기록
7. Telegram 운영 알림
8. replay / canary / self-evolution 연결

### 3.2 Pine가 책임지는 것

1. 차트 상태 패널
2. EMA / 구조선 / 보조 마커
3. shadow parity visualization
4. 사용자가 차트에서 전략 상태를 읽기 쉽게 보여주는 일
5. 서버 신호 체계 변경이 있을 때 최신 규칙을 차트에서 확인할 수 있는 동반 산출물 역할

### 3.3 Pine가 더 이상 책임지지 않는 것

1. 운영 정본 signal generation
2. Telegram 운영 발송 기준
3. execution entry authority
4. strategy version authority
5. deploy/rollback authority

## 4. 정본 규칙

### 4.1 authoritative server signal

아래를 모두 만족해야 `authoritative server signal`이다.

1. `source = SERVER`
2. `authoritative = true`
3. `strategy_id`가 현재 applied runtime과 일치
4. `engine_version`이 현재 runtime engine과 일치
5. `bar_close_time_utc_ms`가 server bar snapshot 기준으로 생성

### 4.2 Pine shadow signal

아래는 `shadow signal`이다.

1. `source = PINE_SHADOW`
2. `authoritative = false`
3. execution / order intent를 만들지 않음
4. parity drift 계산에만 사용

## 5. 데이터 계약

### 5.1 authoritative signals

필수 필드:

1. `signal_id`
2. `source = SERVER`
3. `authoritative = true`
4. `exchange`
5. `symbol`
6. `tf`
7. `event = LONG | SHORT`
8. `entry_grade = EARLY | CORE`
9. `side = BUY | SELL`
10. `reason_code`
11. `strategy_id`
12. `engine_version`
13. `bar_close_time_utc_ms`
14. `feature_snapshot`
15. `trigger_type`
16. `risk_gate_status`

### 5.2 Pine shadow signals

필수 필드:

1. `signal_id`
2. `source = PINE_SHADOW`
3. `authoritative = false`
4. `exchange`
5. `symbol`
6. `tf`
7. `event`
8. `entry_grade`
9. `strategy_id`
10. `bar_close_time_utc_ms`
11. `matched_server_signal_id`
12. `parity_status`

## 5.3 Pine 동반 산출물 규칙

신호 체계가 자동진화나 운영 튜닝으로 바뀌면, 서버 설정 변경만으로 완료로 보지 않는다.

같은 변경 묶음에서 아래 Pine 산출물이 함께 갱신돼야 한다.

1. `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_SIGNAL_REDESIGN.pine.txt`
2. `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_PRODUCTION_CANDIDATE.pine.txt`
3. `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt`

의미:

1. 서버는 정본 실행을 담당한다.
2. Pine는 비교/시각화 shadow를 담당한다.
3. 사용자는 최신 전략을 차트에 붙여넣어 직접 확인할 수 있어야 한다.

## 6. 현재 artifact 규칙

현재 전환 상태를 읽는 핵심 artifact는 아래 4개다.

1. `server_signal_runtime_latest.json`
2. `server_signal_authority_latest.json`
3. `server_signal_quality_latest.json`
4. `server_signal_cutover_readiness_latest.json`

역할:

1. `runtime`
   - 실제 source mode, TF, 활성 마켓 수
2. `authority`
   - 정본/그림자 수, parity 규모, mismatch rate
3. `quality`
   - entry -> intent -> fill 품질
4. `cutover readiness`
   - 승격 blocker, dominant mismatch family, recommended action

## 7. UI 규칙

### 7.1 홈 / 수익 / 거래기록

사용자 화면은 서버 정본만 보여준다.

1. `최근 신호`
2. `최근 실행`
3. `최근 체결`
4. `최근 수익`

여기서 Pine shadow는 직접 노출하지 않는다.

### 7.2 전략상태 화면

전략상태는 아래를 보여준다.

1. `서버 신호 정본 상태`
2. `Pine shadow parity 상태`
3. `최근 drift 요약`
4. `최근 authoritative signal 수`
5. `서버 우선 전환 진행률`

### 7.3 디버그/감사 화면

여기서만 아래를 노출한다.

1. `Pine shadow signal`
2. `server signal`
3. `mismatch reason`
4. `bar alignment issue`

## 8. Telegram 규칙

최종 Telegram 기준은 아래 두 가지다.

1. `SERVER_SIGNAL_CREATED`
2. `ORDER_EXECUTED / ORDER_FAILED`

선택적으로 아래만 추가 허용한다.

3. `PINE_SHADOW_DRIFT_ALERT`

금지:

1. Pine 자체 alert를 운영 신호 알림으로 직접 보내는 것
2. Pine webhook 수신만으로 운영 알림을 보내는 것

## 9. self-evolution 연결 규칙

self-evolution은 authoritative server signal 기준으로만 평가한다.

1. dataset attribution
2. objective score
3. canary quality
4. deployment candidate
5. rollback decision

Pine shadow mismatch는 성과 평가의 정본이 아니라 `diagnostic evidence`로만 쓴다.

## 10. 전환 단계와 현재 판정

### Phase 1. 서버 정본 선언

상태: 완료

1. UI가 `SERVER`를 운영 신호로 본다.
2. Pine webhook은 `shadow ingress`로 표기된다.
3. Telegram 수신 기준은 server-authoritative로 재배선됐다.

### Phase 2. artifact 추가

상태: 완료

1. `server_signal_runtime_latest.json`
2. `server_signal_authority_latest.json`
3. `server_signal_quality_latest.json`
4. `server_signal_cutover_readiness_latest.json`

### Phase 3. 서버 직접 signal generation

상태: 진행 중

1. 서버가 authoritative signal을 생성한다.
2. signals에 `source=SERVER`, `authoritative=true`로 기록한다.
3. 다만 아직 source mode는 `PINE_PRIMARY`다.

### Phase 4. Pine shadow 강등

상태: 대부분 완료

1. Pine webhook은 execution chain에 직접 연결하지 않는다.
2. Pine payload는 shadow 저장/비교 용도로만 남는다.
3. 운영 정본 판단은 서버 기준으로 이동했다.

### Phase 5. Pine 운영 의존 제거

상태: 진행 중

1. 구조상 shadow-only로 거의 내려왔다.
2. 최종 완료는 `SERVER_PRIMARY` 승격과 2주 비교 운영 종료 이후로 본다.
3. 다만 신호 체계 변경 시 Pine 동반 산출물 생성 의무는 유지한다.

## 11. acceptance 기준

서버 정본 전환 완료 판정은 아래 모두 충족해야 한다.

1. `canonical_engine_source_mode = SERVER_PRIMARY`
2. `promotion_ready = true`
3. `source_parity_mismatch_n = 0`
4. `EV_POLICY`, `COOLDOWN_POLICY` drift가 blocker에서 빠짐
5. `authoritative_entry_signal -> intent -> fill` 경로가 안정 유지
6. Pine는 shadow-only로만 사용

## 12. 현재 결론

돈벌자의 정본 전환은 이미 구조적으로 상당 부분 끝났다.

현재 남은 것은 `서버가 신호를 만들 수 있느냐`가 아니라,
`서버 정본 품질 drift를 줄여 SERVER_PRIMARY 승격을 닫는 것`이다.
