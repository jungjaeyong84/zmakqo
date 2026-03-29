# BEST_PHILOSOPHY

- 제정: 2026-03-29
- 상태: PROPOSED
- 상위 개념:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md`

## 선언

`BEST`는 단순한 필터 묶음이 아니다.

`BEST`는 아래 목표를 동시에 만족시키기 위한 철학과 논리 체계다.

1. 승인 시장군에서 `승률 60%+`를 목표로 한다.
2. baseline 대비 `신호 수 감소`를 목표로 하지 않는다.
3. 차트에 보이는 신호가 실제 체결 품질로 이어져야 한다.

즉 `BEST`는 "나쁜 신호를 줄이는 철학"이 아니라, "같은 수의 신호를 더 좋은 위치로 재배치하는 철학"이다.

## 목표 정의

`BEST`의 핵심 목표는 아래처럼 정의한다.

1. `Win Rate Floor`
   - 승인 시장군에서 `60%+`
2. `Signal Count Floor`
   - baseline 대비 `1.00x 이상`
3. `Expectancy Floor`
   - 평균 순손익 non-inferior
4. `Execution Floor`
   - 브리지 지연/거절/중복까지 포함한 실체결 품질 유지

## 현실 제약

아래는 반드시 인정해야 한다.

1. 전 시장, 전 레짐, 전 시간대에서 동시에 `60%+`와 `신호 수 유지`를 보장하는 것은 비현실적이다.
2. 따라서 `BEST`는 먼저 `승인 시장군`, `승인 시간대`, `승인 레짐`을 명시해야 한다.
3. 목표는 무한 일반화가 아니라, 운영 가능한 우세 영역에서의 안정적 우위다.

## BEST의 법칙 10개

### 1. Signal Conservation Law

새 이론은 신호를 무조건 줄이면 안 된다.

1. 늦은 신호를 막았다면
2. 더 이른 유효 신호를 복구하거나
3. 같은 신호를 더 나은 시점으로 재배치해야 한다.

### 2. Regret Minimization Law

목표는 가장 빠른 진입이 아니다.

1. 너무 이른 진입
2. 너무 늦은 추격
3. 둘 사이에서 `후회 비용`이 가장 낮은 신호가 목표다.

### 3. Non-Redundancy Law

각 층은 같은 의미를 반복하면 안 된다.

1. 상태층은 상태만 본다.
2. 구조층은 구조만 본다.
3. 시간가치층은 시간가치만 본다.
4. 타이밍층은 타이밍만 본다.
5. 행동층은 최종 행동만 고른다.

### 4. No-Bypass Law

어느 층도 활성 상위 필터를 우회하면 안 된다.

1. Pine timing verdict가
2. 상태/구조/시간가치/행동결정의 활성 규칙을 silent override하면 안 된다.

### 5. Execution Reality Law

좋은 차트 신호라도 실제 체결이 늦으면 좋은 신호가 아니다.

1. alert
2. webhook
3. intent
4. fill

이 전체 브리지 위에서 유효한 신호여야 한다.

### 6. Asymmetric Error Law

두 종류의 오류를 따로 본다.

1. 좋은 신호를 놓친 오류
2. 나쁜 신호를 허용한 오류

이 둘은 같은 비용이 아니다.

### 7. Replace-Not-Only-Block Law

새 이론은 hard block만 늘리면 실패다.

1. block보다
2. `re-time`, `re-rank`, `re-place`
가 우선이다.

### 8. Symmetry Law

롱과 숏은 대칭 설계가 원칙이다.

1. 한쪽만 특별 취급하는 것은 허용하되
2. 이유와 근거를 문서화해야 한다.

### 9. Explainability Law

각 신호는 왜 떴는지, 왜 막혔는지 설명 가능해야 한다.

1. state
2. structure
3. hold value
4. timing
5. action

이 다섯 층의 이유가 남아야 한다.

### 10. Continuous Falsification Law

`BEST`는 믿음이 아니라 반증 가능한 체계여야 한다.

1. overlap matrix
2. saved loss / missed gain
3. latency budget
4. drift
5. phase precision

이걸 자동화가 계속 검증해야 한다.

## 철학적 결론

`BEST`는 "엄격하게 걸러서 신호를 적게 만드는 체계"가 아니다.

`BEST`는

1. 신호 수를 줄이지 않고
2. 너무 빠른 것과 너무 늦은 것을 동시에 줄이며
3. 실제 체결 기준으로 더 높은 승률과 더 나은 후회 구조를 만드는 체계

여야 한다.

## 운영 해석

실무적으로는 아래처럼 읽는다.

1. `60%+`만 보고 신호 수가 반토막 나면 실패
2. 신호 수만 유지하고 승률이 흐려지면 실패
3. 차트상 개선인데 실체결 수익이 나빠지면 실패
4. 설명 불가능한 블랙박스면 실패

## 한 줄 결론

`BEST`의 철학은 "덜 쏘는 신호"가 아니라 "같은 발수로 더 잘 맞히는 신호"다.
