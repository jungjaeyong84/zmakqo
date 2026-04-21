# DONBEOLJA V2 Rebuild Principles

## 목적

이 문서는 기존 DONBEOLJA 선물 자동매매 시스템을 그대로 연장하지 않고, 현재 운영에서 확인된 실패 패턴을 반영해 V2를 별도 엔진으로 다시 설계할 때 따라야 할 원칙을 정의한다.

핵심 목표는 세 가지다.

1. 코드가 단순해야 한다.
2. 실패 시 상태가 증명 가능해야 한다.
3. 운영자가 "무슨 일이 일어났는지"를 로그, Firestore, 거래소 상태로 재구성할 수 있어야 한다.

이 문서의 V2는 exit 엔진만 뜻하지 않는다.

상위에는 아래 control plane이 포함된다.

1. `OpenClaw 최상위 의사결정 모드`
2. `ML+AI 독자 신호 생성 모드`

여기서 `ML+AI 독자 신호 생성 모드`는 OpenClaw 바깥 별도 주체가 아니라, 궁극적으로 OpenClaw가 사용하는 하위 판단 엔진이다.

## 결론

완전 중단 후 올리라이트는 하지 않는다.

대신 아래 방식으로 간다.

1. V1 신규 기능 개발 중단
2. V1은 리스크 최소 모드로 축소 운영
3. V2를 별도 엔진으로 새로 구축
4. V2는 replay, paper, shadow, canary 순으로 승격
5. V2가 exit 전 경로를 증명하면 V1을 단계적으로 퇴역

즉, 전략은 `rewrite`가 아니라 `parallel replacement`다.

## 왜 V2를 별도로 만들어야 하는가

현재 V1의 가장 큰 문제는 기능 부족이 아니라 경로 다중화다.

1. exit stage 판단 레이어가 여러 군데 있다.
2. TP1, TRAIL, alert, fill sync가 서로 다른 전제를 가진다.
3. recovery와 본경로가 섞여 있다.
4. operator alert와 canonical transition의 진실 원천이 분리돼 있다.
5. 보호주문 누락 시 복구는 있지만, 예방이 아니다.

이 상태에서 같은 코드베이스를 계속 고치면 결과보다 연결점이 더 늘어난다.

## V1의 최대 장점

V1의 최대 장점은 코드 구조가 아니라 실전 운영에서 이미 검증된 거래소 적응력과 실패 데이터다.

구체적으로는 아래 네 가지다.

1. Binance 실거래에서 실제로 터진 edge case와 race를 이미 많이 밟아봤다
2. 보호주문 누락, fill sync 지연, 외부 수동 개입, alert 누락 같은 사고 패턴이 운영 기록으로 남아 있다
3. break-even, trail, watchdog, repair, transport 계층에서 무엇이 자주 망가지는지 경험적으로 알고 있다
4. replay gate, audit script, 운영 경고 체계처럼 "문제가 났을 때 어디를 봐야 하는가"가 축적돼 있다

즉, V1은 구현체로서는 복잡하지만, 운영 지식 베이스로서는 매우 강하다.

V2는 V1의 코드를 그대로 계승하지 않고, V1이 실전에서 축적한 아래 자산은 반드시 계승해야 한다.

1. 실제 장애 taxonomy
2. 거래소 응답 이상과 네트워크 이상에 대한 방어 경험
3. 운영 로그와 사후 재구성 포인트
4. 배포 전 replay / gate 문화

따라서 V1을 폐기 대상으로만 보면 안 된다.

V1은 "버그 많은 구형 엔진"이면서 동시에 "가장 가치 있는 운영 교과서"다.

## V2에서 반드시 지켜야 할 설계 원칙

### 1. Exit state machine single authority

exit stage는 오직 한 reducer만 결정한다.

허용 stage:

1. `PRE_TP1`
2. `TP1_DONE`
3. `TRAIL_ACTIVE`
4. `EXITED_SL`
5. `EXITED_TRAIL`
6. `EXITED_EXTERNAL`
7. `EXITED_MANUAL`

### 2. Entry cycle identity mandatory

모든 포지션은 진입 시점에 아래 키를 반드시 가진다.

1. `position_cycle_id`
2. `entry_event_id`
3. `entry_order_id`
4. `entry_fill_id` 또는 `entry_fill_group_id`

이 키가 없으면 포지션 write 자체를 거부한다.

### 3. Native protection first

진입 이후 바로 아래 두 주문이 거래소에 있어야 한다.

1. `STOP_MARKET closePosition=true`
2. `TAKE_PROFIT_MARKET reduceOnly quantity=entry_qty * 0.5`

V2의 기본 계약은 아래다.

1. `TP1 = 1.68%`
2. `TP1 qty = 50%`
3. `SL = 기본 계약값`
4. `Trail = TP1 달성 후에만 활성`

### 4. Single writer for exchange protection

거래소 보호주문 생성, 취소, 재발행은 한 서비스만 수행한다.

다른 레이어는 오직 아래만 할 수 있다.

1. 상태 조회
2. repair request 발행
3. alert 발행

### 5. Canonical transition first, alert second

alert는 fill이나 inferred event에서 바로 만들지 않는다.

반드시 아래 순서를 지킨다.

1. reducer가 canonical transition 생성
2. transition이 저장됨
3. alert worker가 transition을 읽어 알림 생성

alert는 transition의 부산물이어야지, 독립 판단이어서는 안 된다.

### 6. Absolute quantity ledger only

V2는 퍼센트 후행 계산을 runtime에서 하지 않는다.

필수 절대수량 필드:

1. `entry_qty_abs`
2. `tp1_target_qty_abs`
3. `tp1_filled_qty_abs`
4. `runner_remaining_qty_abs`
5. `final_exit_qty_abs`

모든 청산은 절대수량 ledger와 exchange fill을 동시에 통과해야 한다.

### 7. Stop model separation

아래 값은 분리 저장한다.

1. `runner_floor_stop`
2. `trail_stop_by_r`
3. `chosen_stop_source`
4. `chosen_stop_price`
5. `final_effective_stop`
6. `native_stop_price`

V2는 "현재 stop이 얼마냐"만 저장하는 것을 금지한다.

### 8. Repair is explicit, not implicit

repair는 본 경로와 분리된 명시적 상태여야 한다.

필수 상태:

1. `HEALTHY`
2. `DEGRADED_REPAIRABLE`
3. `DEGRADED_UNPROTECTED`
4. `TERMINAL_EXITED`

repair request는 transition을 바꾸지 않는다.

### 9. Fail-safe precedence

V2는 "복구되겠지"를 가정하지 않는다.

우선순위는 아래와 같다.

1. 보호주문 유지
2. 상태 일관성 유지
3. alert 유지
4. 보조 관측성 유지

### 10. Replay before deploy

배포 전에는 항상 replay gate를 통과해야 한다.

필수 replay 시나리오:

1. entry success + native protection success
2. TP1 fill -> trail activation
3. trail watermark update -> stop raise
4. stop hit -> final exit
5. external manual close -> external sync exit
6. stop missing -> repair request
7. cancel succeeded + place failed -> unprotected detection

### 11. OpenClaw is the supreme decision plane

V2에서 OpenClaw는 운영 부가 기능이 아니라 최상위 의사결정 시스템이다.

OpenClaw는 아래를 최종 결정한다.

1. 어떤 신호 모드를 활성화할지
2. 어떤 시장/전략/예산 정책을 사용할지
3. 어떤 신호를 진입 후보로 승인할지
4. 어떤 repair 정책을 적용할지
5. 어떤 배포 / 롤백 결정을 내릴지
6. 어떤 ML+AI 판단을 신뢰할지

즉, OpenClaw는 `supreme control plane`이다.

다만 OpenClaw가 직접 해서는 안 되는 일은 여전히 분리해야 한다.

OpenClaw가 직접 해서는 안 되는 일:

1. canonical exit stage 직접 덮어쓰기
2. 거래소 보호주문 직접 write
3. 전략 필터를 여러 개 누적해서 진입 경로를 불투명하게 만들기

OpenClaw decision 문서는 아래 근거를 durable하게 남겨야 한다.

1. signal intent 요약
2. 하드 가드 결과
3. 전략 필터 결과
4. ML+AI evidence 참조
5. 최종 승인 또는 차단 rationale

`SERVER_NATIVE_ML_AI` 경로에서는 여기에 더해 immutable feature snapshot이 반드시 있어야 한다.

즉, V2는 "모델이 뭘 보고 판단했는지"가 문서 id 수준에서 재구성되지 않으면 승인 근거가 완전하다고 보지 않는다.

그리고 native ML 경로는 snapshot만 남기고 끝나면 안 된다.

반드시 아래 제안 계약도 함께 남겨야 한다.

1. `proposal_verdict`
2. `rank_score`
3. `size_ratio`
4. `risk_band`

즉, V2는 "모델이 무엇을 봤는가"와 "그래서 무엇을 제안했는가"를 분리 저장한다.

그리고 운영 승격 전에는 shadow/live 비교 리포트가 있어야 한다.

이 리포트는 최소한 아래를 분리해 보여줘야 한다.

1. 구조적 blocker
2. 수치 drift warning
3. proposal verdict 차이
4. decision approval 차이

승격 정책은 아래처럼 fail-closed 여야 한다.

1. `SHADOW`는 comparison warning 허용 가능
2. `CANARY`는 comparison warning도 차단
3. `LIVE`는 comparison blocker와 warning 모두 차단

여기서 comparison은 shadow/live만 뜻하지 않는다.

초기 V2에서는 아래 두 비교가 같은 수준으로 관리돼야 한다.

1. `SHADOW vs LIVE`
2. `WEBHOOK_ASSISTED vs SERVER_NATIVE_ML_AI`

그리고 운영자는 최종적으로 비교 리포트들을 따로 읽지 않아야 한다.

최종 승격 판단은 아래를 묶은 `unified promotion report` 하나로 끝나야 한다.

1. replay 결과
2. shadow/live 비교 결과
3. webhook/native 비교 결과
4. deploy gate 결과

그리고 CI는 이 보고서를 직접 조립하지 않는다.

CI는 단일 wrapper script를 호출하고, 그 wrapper가 fail-closed JSON 결과를 반환해야 한다.

wrapper의 기본 입력은 표준 artifact 디렉터리여야 한다.

즉, V2 승격 계약은 결국 아래 파일 3종으로 귀결된다.

1. `replay-report.json`
2. `shadow-live-comparison.json`
3. `source-mode-comparison.json`

### 12. One strategy filter only at bootstrap

V2 초기 운영에서는 전략 필터를 하나만 둔다.

그 하나는 `HTF_DIRECTION_ALIGNMENT` 이다.

정의는 단순하다.

1. 진입 시그널 방향과 상위 타임프레임 방향이 같아야 한다
2. 상위 타임프레임 confidence가 최소 기준 이상이어야 한다
3. 위 둘 중 하나라도 만족하지 못하면 진입을 차단한다

여기서 중요한 것은 `하드 가드`와 `전략 필터`를 섞지 않는 것이다.

하드 가드는 항상 켜져 있어야 하는 생존 계약이다.

V2 기본 하드 가드는 아래 세 가지다.

1. `BUDGET_MIN_ORDER`
2. `ENTRY_LINEAGE_REQUIRED`
3. `EXCHANGE_PROTECTION_HEALTH`

반면 전략 필터는 "지금 이 시장을 들어갈지"만 결정한다.

전략 필터는 아래를 절대 해서는 안 된다.

1. exit stage 변경
2. 보호주문 가격 계산
3. 절대수량 ledger 수정
4. repair request 생성

즉, 필터는 `entry admit / block` 만 담당한다.
3. fill evidence 없이 체결 결과를 사실로 선언
4. 하위 deterministic kernel을 우회한 체결 상태 변경

즉, OpenClaw는 최상위 의사결정권자지만, 실행과 사실기록은 하위 deterministic kernel이 맡아야 한다.

### 12. ML+AI belongs under OpenClaw

V2는 웹훅 의존 모드만 갖고 있으면 안 된다.

반드시 아래 두 신호 모드를 동시에 지원해야 한다.

1. `WEBHOOK_ASSISTED`
2. `SERVER_NATIVE_ML_AI`

`SERVER_NATIVE_ML_AI` 모드에서 ML+AI는 OpenClaw의 하위 판단 엔진으로 아래를 수행한다.

1. 시장 상태 해석
2. 후보 진입 신호 생성
3. 신호 품질 점수화
4. 예산/최소주문/군집 리스크 사전 검증
5. OpenClaw evidence ledger 기록

단, ML+AI도 독립 주권자가 아니므로 아래 권한은 가지면 안 된다.

1. exit stage 재분류
2. 보호주문 writer 우회
3. risk guard 우회

## V2 범위 제한

초기 V2는 아래만 구현한다.

1. Binance Futures live
2. one-way or current production mode only
3. 단일 TP1
4. 단일 trail
5. 단일 stop writer
6. Firestore state store
7. OpenClaw supervisory integration
8. server-native ML+AI signal mode의 최소 골격

초기 V2에서 제외한다.

1. legacy multi-stage partial take-profit contract
2. 다단 ladder
3. 전략별 복수 exit contract
4. adaptive exit profile
5. ML-driven exit mutation
6. multi-exchange abstraction

여기서 제외의 의미는 아래다.

1. ML+AI 자체를 빼는 것이 아니다
2. live 중에 exit 계약을 실시간으로 바꾸는 adaptive mutation만 제외한다
3. 즉, V2 초기 ML+AI는 OpenClaw 아래에서 `entry / block / rank / size proposal`까지만 가진다

## 운영 원칙

### V1 운영 모드

V1은 아래 조건으로만 유지한다.

1. 신규 기능 금지
2. 긴급 버그 수정만 허용
3. 운영 cost guard 유지
4. active issue board 유지
5. V2 비교 기준선 역할만 수행

### V2 승격 순서

1. replay
2. local simulation
3. paper
4. shadow alert only
5. micro canary live
6. partial traffic shift
7. full cutover

상위 제어면 승격 순서는 OpenClaw 중심으로 따로 둔다.

1. OpenClaw shadow supervision
2. OpenClaw signal authority shadow
3. OpenClaw repair recommendation
4. OpenClaw + ML shadow scoring
5. OpenClaw limited live authority
6. OpenClaw primary live authority

## 성공 기준

V2가 성공했다고 말하려면 아래를 동시에 만족해야 한다.

1. active live position에 `TP1_ORDER_MISSING`가 0건
2. active live position에 `NATIVE_REFRESH_UNHEALTHY`가 0건
3. TP1 alert silent drop 0건
4. `entry_event_id` missing active position 0건
5. unprotected window가 측정 가능하고 SLA 내
6. replay gate fail-closed 적용
7. operator가 각 exit를 Firestore doc 3종으로 재구성 가능
8. OpenClaw가 active issue를 canonical evidence 기준으로 요약 가능
9. `SERVER_NATIVE_ML_AI` shadow 결과가 `WEBHOOK_ASSISTED` 대비 비교 가능

필수 doc 3종:

1. position cycle doc
2. canonical transition doc
3. alert outbox doc

## 최종 판단

V2는 해야 한다.

하지만 "처음부터 다시"의 의미는 코드만 새로 쓰는 것이 아니라, 실패 계약을 먼저 새로 정의하는 것이다.

V1의 실전 실패 패턴을 버리지 말고, 그 실패를 사양으로 승격한 뒤 V2를 만들어야 한다.
