# SERVER_SIGNAL_AUTHORITY_MIGRATION_CHECKLIST

- 기준일: 2026-04-01
- 상태: DRAFT
- 상위 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_SPEC.md`

## 1. 목표

이 체크리스트는 `Pine 신호 정본 -> 서버 신호 정본` 전환을 실제 구현 순서로 나눈 실행 문서다.

## 2. Phase 1. 정본 선언

완료 기준:

1. UI 기본 화면이 `SERVER` source만 운영 신호로 본다.
2. 전략상태 화면에 `PINE_SHADOW`가 diagnostic으로만 표시된다.
3. Telegram 수신 알림은 `SERVER_SIGNAL_CREATED` 기준으로 재정의된다.

작업:

1. `signals` 표시용 serializer에 `source`, `authoritative` 필드 추가
2. `signals`/`signals_shadow` 구분 표시 추가
3. Telegram 템플릿에 `source` 표시 추가

## 3. Phase 2. server signal artifact 추가

완료 기준:

1. `server_signal_generation_latest.json` 생성
2. `server_signal_parity_latest.json` 생성
3. `server_signal_quality_latest.json` 생성
4. `server_signal_authority_latest.json` 생성

작업:

1. run cycle 마지막에 latest artifact writer 추가
2. authoritative count / shadow count / match rate 기록
3. drift reason taxonomy 정의

## 4. Phase 3. 서버 직접 signal generation

완료 기준:

1. 서버가 bar close마다 `RE/RC/SE/SC` 생성
2. generated signal이 바로 `signals`에 authoritative source로 기록
3. order intent 생성과 같은 cycle에 연결

작업:

1. `signalEngine` 또는 canonical engine 내부에 authoritative generator 추가
2. `event = LONG|SHORT`, `entry_grade = EARLY|CORE` 직접 생성
3. `reason_code`, `trigger_type`, `feature_snapshot` 같이 저장

## 5. Phase 4. Pine shadow 강등

완료 기준:

1. Pine webhook은 execution path를 만들지 않음
2. Pine payload는 shadow artifact로만 저장
3. Pine mismatch가 objective score 정본에 직접 들어가지 않음

작업:

1. webhook source를 `PINE_SHADOW`로 강등하는 path 추가
2. `order_intents` 경로에서 Pine source 차단
3. parity comparison artifact 생성

## 6. Phase 5. UI 정리

완료 기준:

1. 홈/수익/거래 화면에서 Pine 용어 제거
2. 전략상태에서만 shadow 정보 노출
3. 사용자 화면은 server result 중심으로 고정

작업:

1. 홈 최근신호 카드 정본 source 고정
2. 거래현황 표에 `server authoritative` badge 추가
3. 디버그 화면에만 Pine shadow mismatch 노출

## 7. Phase 6. Telegram 정리

완료 기준:

1. 운영 수신 알림이 server source 기준만 사용
2. drop/warn/drift 알림 taxonomy가 분리됨

작업:

1. `SERVER_SIGNAL_CREATED`
2. `ORDER_EXECUTED`
3. `ORDER_FAILED`
4. `PINE_SHADOW_DRIFT_ALERT`
만 남기기

## 8. acceptance 테스트

1. 실제 서버 생성 신호 1건이 `signals`에 `source=SERVER`로 기록된다.
2. 같은 신호에 대해 Telegram이 1회만 간다.
3. 같은 bar에 Pine shadow가 와도 intent는 server source만 만든다.
4. UI 최근신호 카드가 server source만 보여준다.
5. parity artifact가 match/mismatch를 기록한다.

## 9. rollback 조건

아래 중 하나면 전환 rollback:

1. server signal generation이 2개 연속 cycle에서 0건
2. parity drift가 threshold 초과
3. authoritative signal이 order intent로 연결되지 않음
4. Telegram이 server signal을 누락

## 10. 구현 순서 추천

1. artifact + UI source 구분
2. Telegram source 구분
3. server signal generator 추가
4. Pine shadow 강등
5. Pine alert 제거

## 11. 현재 판단

현재 돈벌자는 아직 `Pine ingress + server consume` 구조다.

최종 자동진화 시스템으로 가려면 다음 정본 경계는 반드시 바뀌어야 한다.

- `Pine = display shadow`
- `Server = signal authority`
