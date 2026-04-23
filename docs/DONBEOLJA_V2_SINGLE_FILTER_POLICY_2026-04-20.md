# DONBEOLJA V2 Single Filter Policy

## 목적

V1에서 반복된 약점 중 하나는 필터가 계속 늘어나면서, 왜 진입했고 왜 막혔는지 운영자가 다시 설명하기 어려워진 점이다.

V2는 이 문제를 초기부터 막는다.

초기 운영의 전략 필터는 딱 하나만 둔다.

1. `HTF_DIRECTION_ALIGNMENT`

## 왜 하나만 남기는가

필터를 많이 두면 얼핏 정교해 보이지만 실제로는 아래 문제가 생긴다.

1. 진입 차단 사유가 분산된다
2. OpenClaw 승인과 필터 차단이 충돌한다
3. 전략 판단과 리스크 가드가 섞인다
4. 나중에 성과 분석을 해도 어떤 필터가 실제로 기여했는지 분리하기 어렵다

초기 V2는 예측력보다 설명 가능성과 복구 가능성을 우선한다.

## 남길 필터

`HTF_DIRECTION_ALIGNMENT`

판단 규칙:

1. LONG 시그널이면 상위 타임프레임 방향도 LONG이어야 한다
2. SHORT 시그널이면 상위 타임프레임 방향도 SHORT이어야 한다
3. 상위 타임프레임 방향이 `NEUTRAL` 이면 진입 차단
4. 상위 타임프레임 confidence가 기준 미만이면 진입 차단

기본 confidence 기준:

1. `min_confidence = 0.60`

## 남기지 않을 것

아래는 초기 V2 전략 필터로 넣지 않는다.

1. 다단계 점수 합성 필터
2. 과도한 cooldown 기반 방향 차단
3. 시장별 예외 화이트리스트
4. 복수 모델 voting 필터
5. 진입 직전 chase reject 스택

이 항목들은 나중에 연구 트랙으로만 남긴다.

## 하드 가드는 필터가 아니다

아래는 항상 켜진 하드 가드이며 전략 필터 개수에 포함하지 않는다.

1. `BUDGET_MIN_ORDER`
2. `ENTRY_LINEAGE_REQUIRED`
3. `EXCHANGE_PROTECTION_HEALTH`

하드 가드는 생존 계약이고, 전략 필터는 진입 선택 계약이다.

## 구현 계약

전략 필터 출력은 아래 필드만 가져야 한다.

1. `filter_name`
2. `verdict`
3. `reason`
4. `signal_side`
5. `htf_direction`
6. `htf_confidence`
7. `min_confidence`
8. `evaluated_at`

전략 필터는 아래 필드를 가져서는 안 된다.

1. exit stage
2. stop price
3. absolute quantity ledger
4. exchange order id
5. repair action

## OpenClaw와의 관계

OpenClaw는 최상위 의사결정 평면이지만, 전략 필터를 무제한으로 늘리는 주체가 되어서는 안 된다.

초기 V2에서 OpenClaw는 아래 원칙을 따른다.

1. 전략 필터는 하나만 사용한다
2. 하드 가드는 우회하지 않는다
3. 필터 통과 여부를 evidence와 함께 기록한다
4. 필터가 차단한 진입은 승인하지 않는다

이 evidence는 OpenClaw decision 문서 안에 durable하게 남아야 하며, 라우터 임시 인자로만 존재해서는 안 된다.

또한 `SERVER_NATIVE_ML_AI` 경로에서는 필터 evidence만으로 충분하지 않다.

아래 입력 snapshot도 함께 남아야 한다.

1. timeframe
2. feature schema version
3. feature vector hash
4. feature values

## 품질 감사 체크포인트

아래 질문에 모두 `예`라고 답할 수 있어야 한다.

1. 필터가 하나뿐인가
2. 하드 가드와 전략 필터가 코드상 분리돼 있는가
3. 필터가 entry admit / block 외의 책임을 가지지 않는가
4. 필터 실패가 canonical exit, protection writer, repair path에 영향을 주지 않는가
5. replay와 단위 테스트에서 필터 통과 / 차단이 재현 가능한가
