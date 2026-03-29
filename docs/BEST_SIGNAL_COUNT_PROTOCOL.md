# BEST_SIGNAL_COUNT_PROTOCOL

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `신호 수 감소 금지` 원칙을 실제 운영 규칙과 회계 방식으로 정의
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PHILOSOPHY.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_REPLACEMENT_MEASUREMENT_SPEC.md`

## 목적

`신호 수 감소 금지`는 철학 문장으로는 불충분하다.

이 문서는 아래를 운영 규칙으로 바꾼다.

1. baseline이 무엇인가
2. count floor가 얼마인가
3. 어떤 차단이 `정당한 re-time`으로 인정되는가
4. 어떤 차단은 단순 `signal loss`인가

## baseline 정의

`baseline`은 아래로 고정한다.

1. 대상:
   - 승인 시장군 x 승인 시간대
2. 기간:
   - 최근 `56d`
3. 비교 기준:
   - 현행 production `1~5차` 체계

기본 baseline 지표:

1. `baseline_signal_count`
2. `baseline_signal_count_by_market`
3. `baseline_signal_count_by_market_tf`
4. `baseline_signal_count_by_side`
5. `baseline_signal_count_by_tier`

## 핵심 용어

### blocked signal

기존 baseline에서는 발생했지만 새 체계에서는 막힌 신호

### recovered signal

막힌 신호를 더 좋은 타이밍으로 대체한 신호

### unrecovered loss

막힌 신호가 대체 없이 사라진 경우

### replacement accounting

`blocked -> recovered` 대응표를 만들어 순감소가 아닌 `재배치`인지 계산하는 방식

## recovered signal 인정 조건

`recovered signal`은 아래를 모두 만족해야 한다.

1. 같은 `symbol`
2. 같은 `side`
3. 같은 `tier`
4. 같은 `approved timeframe`
5. baseline blocked signal 후 `max 2 bars` 안에 발생
6. `avg_ret_net` 또는 `MFE/MAE structure`가 baseline보다 동등 이상

위 조건을 못 맞추면 단순 `signal recovery`로 인정하지 않는다.

세부 비교 규칙:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_REPLACEMENT_MEASUREMENT_SPEC.md`

## count floor

### global hard floor

1. `count_ratio_global >= 1.00`

### approved market soft floor

1. 각 승인 시장 `count_ratio_market >= 0.95`

### market-timeframe alert floor

1. 각 승인 `market x timeframe >= 0.90`

원칙:

1. `global hard floor` 미달이면 실패
2. 시장별/시간대별 바닥은 alert와 drill-down 대상

## replacement ratio

필수 지표:

1. `blocked_count`
2. `recovered_count`
3. `unrecovered_count`
4. `replacement_ratio = recovered_count / blocked_count`
5. `net_count_delta = new_signal_count - baseline_signal_count`

최소 기준:

1. `replacement_ratio >= 0.80` before `SOFT`
2. `replacement_ratio >= 0.90` before `HARD`

## 신호 과다 방지

`신호 수 감소 금지`는 `신호 폭증 허용`을 뜻하지 않는다.

경보 기준:

1. `count_ratio_global > 1.25`
2. `count_ratio_market > 1.35`

이 경우:

1. 품질 저하 가능성 점검
2. 중복 신호/retime 과잉 여부 점검
3. `FEBT SOFT -> SHADOW` 일시 복귀 후보로 본다.

## 우선순위 규칙

### 1. block-first 금지

1. 먼저 `더 좋은 bar로 재배치` 가능한지 본다.
2. 그 다음에 `차단`을 고려한다.

### 2. replacement-first

1. `LATE` 신호를 차단했다면
2. 같은 구조에서 더 이른 `FIRE` 또는 더 좋은 `ARMED->FIRE`가 있는지 추적한다.

### 3. naked drop 금지

1. recovered signal 없이 hard drop만 늘어나면 실패로 본다.

## 산출물

필수 리포트:

1. `best_count_floor_report.md/json`
2. `best_replacement_accounting.md/json`
3. `best_signal_loss_report.md/json`

필수 컬럼:

1. `baseline_signal_id`
2. `new_signal_id`
3. `replacement_status`
4. `bars_delta`
5. `ret_net_delta`
6. `mfe_delta`
7. `mae_delta`

## 승인 기준

### SOFT 전환 전

1. `count_ratio_global >= 1.00`
2. `replacement_ratio >= 0.80`
3. `unrecovered_count`가 승률 개선 이익을 잠식하지 않음

### HARD 전환 전

1. `count_ratio_global >= 1.00`
2. `replacement_ratio >= 0.90`
3. `approved market`별 severe deficit 없음

## 실패 조건

1. 승률은 오르지만 `count_ratio_global < 1.00`
2. 차단 신호 대부분이 unrecovered
3. 신호 과다 증가로 품질이 희석
4. replacement가 같은 구조가 아니라 무관한 신호 복제에 가까움

## 한 줄 결론

`신호 수 감소 금지`는 추상 원칙이 아니라, `blocked`, `recovered`, `replacement_ratio`, `count floor`를 숫자로 관리하는 회계 규칙이어야 한다.
