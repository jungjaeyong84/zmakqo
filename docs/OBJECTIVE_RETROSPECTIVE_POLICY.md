# OBJECTIVE_RETROSPECTIVE_POLICY

- 제정: 2026-03-28
- 업데이트: 2026-04-05
- 상태: ACTIVE
- 목적:
  - 데일리/주간/월간 성과를 하나의 공통 목표 함수로 회고한다.
  - 목표 미달 시 원인과 반성문을 남겨, 이후 서버 신호 및 downstream policy 수정의 공통 근거로 사용한다.
- 검수 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md`

## 공통 목표

모든 서버 신호/정책 수정은 아래 목표를 동시에 바라본다.

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
   - `BINANCEFUT`는 quote PnL을 그대로 KRW로 표기하지 않는다.
   - `BINANCEFUT` retrospective는 `USDT -> KRW` 환산 후 목표와 비교한다.
2. entry cohort 활동
   - signals_n
   - executed_n
   - execution_rate
3. 드롭 구조
   - QUALITY / AI / MARKET / EV / TIMING / OPS
   - top reasons
4. 서버 신호 follow-through
   - tier별 executed / avg_ret_net
5. 최신 운영 문맥
   - objective supervisor
   - stage autopilot
   - change-result attribution
   - server signal authority / quality / cutover
   - policy parameter plan (`best_self_evolution_policy_parameter_plan_latest`)
   - live execution policy canary 상태 (`LIVE_EXEC_POLICY_POLICY_PLAN_*`)
6. 실행 미세구조 KPI
   - `tp0_hit_rate`
   - `tp1_hit_rate`
   - `tp0_to_tp1_conversion_rate`
   - `pre_tp1_stop_rate`
   - `pre_tp1_time_stop_rate`
   - `portfolio_cluster_reduce_n`
   - `portfolio_cluster_block_n`

## 반성문 규칙

1. 데일리/주간/월간 중 하나라도 목표 미달이면 반성문을 작성한다.
2. 반성문은 감상문이 아니라 수정 근거 문서다.
3. 반성문에는 최소 아래가 들어가야 한다.
   - 무엇이 미달이었는가
   - 무거래/0원이었는가
   - 주요 차단 단계는 어디였는가
   - 서버 신호가 부족했는가, 드롭이 과했는가, 실행 품질이 나빴는가
   - `TP1 이전 생존력`이 부족했는가 (`FAST_TP0`, chase reject, delayed trail, time stop, cluster risk)
   - 다음날 먼저 수정할 서버 정책 축은 무엇인가

## 회고 작성자

1. 회고 작성 주체는 `OpenClaw`다.
2. 회고는 `당일 전체 거래 평가`, `반성문`, `내일 전략`을 모두 포함한다.
3. 회고는 `일간 / 주간 / 월간` 세 축을 한 번에 쓴다.
4. 기준은 `Pine`이 아니라 `서버 신호`다.

## 수정 시 사용 규칙

1. OpenClaw 변경 전 최신 회고 문서를 먼저 읽는다.
2. OpenClaw는 회고의 `내일 전략`을 다음 objective action의 입력으로 읽는다.
3. 회고에서 `무거래/0원`이 반복되면, 단순 보수화가 아니라 `과차단/무활동` 가능성을 함께 본다.
4. 단, 롱/숏은 항상 대칭으로 수정한다.
5. Pine 수정은 운영 우선순위가 아니며, 비교용 shadow 유지 목적일 때만 수행한다.

## 산출물

1. 최신 JSON:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.json`
2. 최신 Markdown:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.md`
3. 텔레그램:
   - 데일리 실행마다 당일/주간/월간 상태와 반성문 요약을 발송한다.

## 통화 정규화 규칙

1. 목표 통화는 운영 정본상 `KRW`다.
2. `UPBIT`, `KIWOOM` 실현 손익은 원래 `KRW`로 기록한다.
3. `BINANCEFUT` 실현 손익은 기본 quote currency가 `USDT`이므로 retrospective에서 `KRW`로 환산한다.
4. retrospective artifact는 최소 아래 메타를 같이 남긴다.
   - `quote_currency`
   - `display_currency`
   - `usd_krw_rate`
   - `usd_krw_rate_source`
5. 목표 비교는 항상 `display_currency=KRW` 기준으로 수행한다.
