# OBJECTIVE_RETROSPECTIVE_POLICY

- 제정: 2026-03-28
- 상태: ACTIVE
- 목적:
  - 데일리/주간/월간 성과를 하나의 공통 목표 함수로 회고한다.
  - 목표 미달 시 원인과 반성문을 남겨, 이후 Pine 및 1~5차 필터 수정의 공통 근거로 사용한다.

## 공통 목표

모든 Pine/필터 수정은 아래 목표를 동시에 바라본다.

1. 승률 `60% 이상`
2. 순수익 `양수`
3. 기대값(`expectancy / EV`) `양수`
4. 월간 순수익 `1,500,000 KRW 이상`

## 무거래 원칙

1. 당일 `0원`은 문제다.
2. 신규 진입이 `0건`이면 `NO_TRADE_ACTIVITY`로 실패 처리한다.
3. 실현 순수익이 `0 KRW`면 `ZERO_KRW_IDLE`로 실패 처리한다.
4. 즉, `손실만 실패`가 아니라 `무거래/0원`도 실패다.

## 회고 주기

1. 데일리:
   - 매일 `23:30 KST`
   - 당일 실현손익 + 당일 진입 활동 + 당일 드롭 구조를 평가한다.
2. 주간:
   - 같은 데일리 회고 안에서 최근 `7일`을 동시에 평가한다.
3. 월간:
   - 같은 데일리 회고 안에서 최근 `30일`을 동시에 평가한다.

즉, 단일 자동화가 매일 돌면서 `일간/주간/월간`을 함께 기록한다.

## 기간별 목표

1. 일간 목표:
   - 월간 `1,500,000 KRW` 기준 일환산 목표를 사용한다.
2. 주간 목표:
   - 월간 `1,500,000 KRW` 기준 주환산 목표를 사용한다.
3. 월간 목표:
   - `1,500,000 KRW`

## 회고 입력

반드시 아래를 같이 본다.

1. 실현 손익 기준 거래 성과
   - trade count
   - win rate
   - avg_ret_net
   - net_pnl_quote
2. entry cohort 활동
   - signals_n
   - executed_n
   - execution_rate
3. 드롭 구조
   - QUALITY / AI / MARKET / EV / TIMING / OPS
   - top reasons
4. Pine follow-through
   - tier별 executed / avg_ret_net
5. 최신 운영 문맥
   - weekly governance
   - objective supervisor
   - stage autopilot

## 반성문 규칙

1. 데일리/주간/월간 중 하나라도 목표 미달이면 반성문을 작성한다.
2. 반성문은 감상문이 아니라 수정 근거 문서다.
3. 반성문에는 최소 아래가 들어가야 한다.
   - 무엇이 미달이었는가
   - 무거래/0원이었는가
   - 주요 차단 단계는 어디였는가
   - Pine follow-through가 약한 tier는 무엇이었는가
   - 다음 수정에서 먼저 볼 축은 무엇인가

## 수정 시 사용 규칙

1. 주간 Pine 수정 전 최신 회고 문서를 먼저 읽는다.
2. Codex 주간 패치 엔진도 최신 회고 문서를 입력으로 읽는다.
3. 회고에서 `무거래/0원`이 반복되면, 단순 보수화가 아니라 `과차단/무활동` 가능성을 함께 본다.
4. 단, 롱/숏은 항상 대칭으로 수정한다.
5. 1차는 integrity guard만 남기고, 품질 의미 수정은 Pine 중심으로 판단한다.

## 산출물

1. 최신 JSON:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.json`
2. 최신 Markdown:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.md`
3. 텔레그램:
   - 데일리 실행마다 당일/주간/월간 상태와 반성문 요약을 발송한다.
