# DROP VALIDATION SPEC

## 목적

드롭된 신호를 단순 폐기 로그로 보지 않고, `드롭하지 않았으면 어떤 결과가 났는지`를 반사실 기준으로 검증해서 OpenClaw가 학습 입력으로 사용하도록 만든다.

## 핵심 원칙

1. `signals_dropped`는 버린 데이터가 아니라 학습 후보군이다.
2. 드롭 reason별로 `TP1 우선`, `SL 우선`, `horizon 수익`, `승률`을 본다.
3. 판단 기준은 `드롭 규칙 유지`가 아니라 `일간/주간/월간 목표 달성에 도움이 되는가`다.
4. 서버-파인 parity와 별개로, 드롭 검증은 독립적인 운영 판단 축이다.

## 입력

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/cache/firestore_recent/signals_dropped.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json`

## 산출물

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_drop_validation_latest.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_drop_validation_latest.md`

## 분류 체계

드롭 reason은 아래 family로 정규화한다.

1. `EV_POLICY`
2. `COOLDOWN_POLICY`
3. `STRATEGY_GATE`
4. `ENTRY_QUALITY`
5. `LIVE_RESCUE`
6. `OTHER`

## 판정

반사실 표본이 충분히 쌓인 reason/family에 대해 아래 verdict를 부여한다.

1. `FAVOR_RESCUE`
   - 드롭하지 않았으면 더 나았을 가능성이 높다.
2. `KEEP_DROP`
   - 드롭 유지가 맞다.
3. `MIXED`
   - 승/패가 혼재되어 추가 샘플이 필요하다.
4. `HOLD_SAMPLE`
   - 표본이 아직 부족하다.

## OpenClaw 연결

OpenClaw는 이 artifact를 읽어 아래를 수행한다.

1. `EV_POLICY`가 `FAVOR_RESCUE`면 EV threshold 완화 검토
2. `COOLDOWN_POLICY`가 `FAVOR_RESCUE`면 WAIT/COOLDOWN 완화 검토
3. `ENTRY_QUALITY`가 `FAVOR_RESCUE`면 score/conf/regime gate 재검토
4. `KEEP_DROP`는 유지 근거로 사용
5. `MIXED`, `HOLD_SAMPLE`는 모니터링 대상으로 유지

## 운영 우선순위

1. 월간 목표 달성
2. 주간 회복
3. 일간 제어
4. 드롭 검증
5. parity drift

드롭 검증은 parity보다 우선하지만, 최상위 목표는 아니다.
