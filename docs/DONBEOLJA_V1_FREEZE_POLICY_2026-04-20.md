# DONBEOLJA V1 Freeze Policy

## 목적

V2를 병행 구축하는 동안 V1이 계속 변형되면 비교 기준선이 사라진다.

이 문서는 V1을 "운영 기준선"으로 유지하기 위한 동결 규칙을 정의한다.

## 적용 범위

아래 경로는 기본적으로 V1 핵심 경로로 본다.

1. `src/engine/paperBinanceRunner.js`
2. `src/services/binanceTickExit.js`
3. `src/services/binanceFuturesFillsSync.js`
4. `src/services/tradeExecutionAlert.js`
5. `src/services/positionStateMachine.js`
6. `src/storage/positionsPaper.js`
7. `src/storage/canonicalExitTransitions.js`
8. `src/storage/tradeAlertOutbox.js`

## 허용되는 변경

1. live outage를 막는 긴급 버그 수정
2. 보안 수정
3. 운영 비용 폭증을 막는 제한적 수정
4. 로그 추가
5. replay 또는 gate용 관측성 추가

## 금지되는 변경

1. 신규 exit feature 추가
2. stage 의미 변경
3. alert contract 변경
4. TP 계약 변경
5. native protection 권한자 추가
6. V2 기능을 V1에 역주입하는 변경

## 운영 원칙

1. V1은 primary live 기준선이다
2. V2는 별도 namespace에서만 개발한다
3. V1/V2는 Firestore collection을 공유하지 않는다
4. V1/V2는 alert outbox를 공유하지 않는다
5. V1/V2는 repair queue를 공유하지 않는다

## 승인 규칙

V1 핵심 경로 수정은 아래를 모두 만족해야 한다.

1. 긴급성 명시
2. 영향 범위 명시
3. replay 또는 단위 테스트 추가
4. rollback 경로 명시

## 종료 조건

아래를 만족하면 V1 freeze를 해제하는 대신 V1 퇴역 절차로 전환한다.

1. V2 canary live pass
2. V2 replay gate pass
3. V2 active protection issue 0건 유지
4. V2 alert silent drop 0건 유지
