# SERVER_SIGNAL_AUTHORITY_SPEC

- 기준일: 2026-04-01
- 상태: DRAFT
- 목적:
  - `서버 = 신호 생성 정본`, `Pine = 시각화 전용 shadow` 구조를 돈벌자 시스템의 다음 정본 목표로 고정한다.
  - `UI / Telegram / execution / self-evolution / deployment authority`가 모두 서버 신호를 기준으로 동작하도록 책임 경계를 명확히 한다.
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SERVER_CANONICAL_ENGINE_MIGRATION_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_V6_1_1_0_TV_IMPORT_AND_CONSUMER_CONTRACT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md`

## 1. 한 줄 정의

돈벌자의 최종 신호 시스템은 `서버 canonical engine이 RE/RC/SE/SC를 직접 생성하고`, `Pine는 그 결과를 차트에 시각화하는 shadow display`로만 남는 구조다.

## 2. 왜 바꾸는가

현재 구조는 아래 경계를 가진다.

1. `Pine -> webhook ingest`
2. `webhook save -> server consume`
3. `server consume -> intent/fill/trade`

이 구조는 아래 문제를 만든다.

1. Pine에서는 신호가 보이는데 서버 정본에는 없을 수 있다.
2. webhook 수신 성공이 실제 실행 성공과 다르다.
3. Pine 버전과 서버 버전이 drift 날 수 있다.
4. self-evolution이 서버를 개선해도 Pine가 여전히 실질 신호 정본이면 authority/deployment의 의미가 약해진다.

따라서 최종 구조는 `신호 생성 정본을 서버로 일원화`해야 한다.

## 3. 최종 책임 분리

### 3.1 서버가 책임지는 것

1. OHLCV / TF 기준 정렬
2. 시장 상태 계산
3. `RE / RC / SE / SC` 생성
4. signal drop / defer / downgrade 판단
5. order intent 생성
6. execution / fill / trade 기록
7. Telegram 알림
8. replay / canary / self-evolution 연결

### 3.2 Pine가 책임지는 것

1. 차트 상태 패널
2. EMA / 구조선 / 보조 마커
3. shadow parity visualization
4. 사용자가 차트에서 전략 상태를 읽기 쉽게 보여주는 일

### 3.3 Pine가 더 이상 책임지지 않는 것

1. 운영 정본 signal generation
2. Telegram 발송 기준
3. execution entry authority
4. strategy version authority
5. deploy/rollback authority

## 4. 정본 규칙

### 4.1 신호 정본 규칙

아래를 모두 만족해야 `authoritative server signal`이다.

1. `source = SERVER`
2. `authoritative = true`
3. `strategy_id`가 현재 applied runtime과 일치
4. `engine_version`이 현재 runtime engine과 일치
5. `bar_close_time_utc_ms`가 server bar snapshot 기준으로 생성

### 4.2 Pine shadow 규칙

아래는 `shadow signal`이다.

1. `source = PINE_SHADOW`
2. `authoritative = false`
3. execution / order intent를 만들지 않음
4. parity drift 계산에만 사용

## 5. 데이터 계약

### 5.1 authoritative signals

컬렉션 또는 artifact 기준 필수 필드:

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
15. `signal_quality_score`
16. `trigger_type`
17. `risk_gate_status`

### 5.2 pine shadow signals

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
12. `parity_status = MATCH | MISSING_SERVER | EXTRA_PINE | TIMING_DRIFT | FEATURE_DRIFT`

## 6. UI 규칙

### 6.1 홈 / 거래 / 수익

사용자 화면은 서버 정본만 보여준다.

1. `최근 신호`
2. `최근 실행`
3. `최근 체결`
4. `최근 수익`

여기서 Pine shadow는 직접 노출하지 않는다.

### 6.2 전략상태 화면

전략상태는 아래를 보여준다.

1. `서버 신호 정본 상태`
2. `Pine shadow parity 상태`
3. `최근 drift 요약`
4. `최근 authoritative signal 수`

### 6.3 디버그/감사 화면

여기서만 아래를 노출한다.

1. `Pine shadow signal`
2. `server signal`
3. `mismatch reason`
4. `bar alignment issue`

## 7. Telegram 규칙

최종 Telegram 기준은 아래 두 가지다.

1. `SERVER_SIGNAL_CREATED`
2. `ORDER_EXECUTED / ORDER_FAILED`

선택적으로 아래만 추가 허용한다.

3. `PINE_SHADOW_DRIFT_ALERT`

금지:

1. Pine 자체 alert를 운영 신호 알림으로 직접 보내는 것
2. Pine webhook 수신만으로 운영 알림을 보내는 것

## 8. self-evolution 연결 규칙

self-evolution은 authoritative server signal 기준으로만 평가한다.

1. dataset attribution
2. objective score
3. canary quality
4. deployment candidate
5. rollback decision

Pine shadow mismatch는 성과 평가의 정본이 아니라 `diagnostic evidence`로만 쓴다.

## 9. 전환 단계

### Phase 1. 서버 정본 선언

1. UI에 `source = SERVER`만 운영 신호로 표시
2. Pine webhook은 `shadow ingress`로 표기
3. Telegram received alert를 server-authoritative 기준으로 재배선

### Phase 2. 서버 신호 생성 artifact 추가

필수 artifact:

1. `server_signal_generation_latest.json`
2. `server_signal_parity_latest.json`
3. `server_signal_quality_latest.json`
4. `server_signal_authority_latest.json`

### Phase 3. 서버가 RE/RC/SE/SC 직접 생성

1. bar close마다 authoritative signal 생성
2. signals에 직접 기록
3. order intent와 같은 run 안에서 연결

### Phase 4. Pine webhook shadow 강등

1. Pine webhook은 execution chain에 직접 연결하지 않음
2. `signals_shadow_pine` 또는 동급 shadow artifact로만 저장
3. mismatch measurement만 수행

### Phase 5. Pine alert 제거

1. Pine는 `alert()`를 운영 신호용으로 더 이상 사용하지 않음
2. Pine는 차트 상태와 shadow marker만 남김

## 10. acceptance 기준

서버 정본 전환 완료 판정은 아래 모두 충족해야 한다.

1. `authoritative signals source = SERVER` 100%
2. Telegram 운영 알림이 server source 기준으로만 발송
3. Pine webhook 미사용 또는 shadow-only
4. UI 기본 화면에 Pine source 직접 노출 없음
5. self-evolution dataset이 server source 기준으로만 점수화
6. parity artifact가 최소 2주 이상 drift 추세를 안정적으로 기록

## 11. 비목표

아래는 이 전환의 목표가 아니다.

1. TradingView 차트와 서버 시각이 완벽히 동일하게 보이는 것
2. Pine를 완전히 삭제하는 것
3. 사용자에게 Pine 내부 계산식을 계속 노출하는 것

## 12. 결론

돈벌자의 최종 자동화 목표를 닫으려면, `신호 생성 authority`는 반드시 서버가 가져야 한다.

Pine는 앞으로도 유용하지만, 역할은 `전략 실행 정본`이 아니라 `차트 시각화 shadow`다.
