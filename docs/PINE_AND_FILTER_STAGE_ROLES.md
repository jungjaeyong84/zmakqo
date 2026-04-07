# PINE_AND_FILTER_STAGE_ROLES

- 제정: 2026-03-28
- 상태: ACTIVE
- 목적:
  - Pine와 서버 1~5차 필터의 역할, 입력, 출력, 수정 원칙을 현재 운영 구조 기준으로 고정한다.
  - 이 문서는 `Pine -> 1차 -> 2차 -> 3차 -> 4차 -> 5차` 체인의 역할 SSOT다.
- 상위 지도:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md`

## 핵심 원칙

1. `Pine`는 신호 품질 판단의 SSOT다.
2. 외부 라이브 엔트리 택소노미는 `LONG / SHORT`만 사용한다.
3. 현재 라이브 source timing band는 `EARLY / CORE`만 사용한다.
4. 현재 라이브 quantity profile은 `FIXED`다.
5. `1차`는 서버 무결성/안전 가드다.
6. `2차`는 AI 사용 가능/기본 허용 여부를 본다.
7. `3차`는 시황 방향 prior와 sizing을 본다.
8. `4차`는 TP1 도달 확률 기반 final sizing과 kill-switch를 본다.
9. `5차`는 늦은 진입을 다음 봉으로 연기할지 본다.
10. 롱/숏 변경은 항상 대칭이다.

## 전체 흐름

1. `Pine`
   - regime / score / confidence / posterior / wave / EV를 계산한다.
   - 품질을 통과한 신호만 `LONG / SHORT` 웹훅/표시를 만든다.
   - 현재 라이브 source band는 `EARLY` 또는 `CORE`다.
   - 현재 라이브 quantity profile은 `FIXED`다.
2. `1차`
   - Pine 품질 번들이 정상인지 확인한다.
   - payload 무결성, 파싱, 대칭성, stale/integrity를 본다.
3. `2차`
   - AI missing / AI block / AI usable 여부를 본다.
4. `3차`
   - AI bias 기반으로 방향 prior와 sizing을 정한다.
5. `4차`
   - 최근 봉 기반 TP1 도달 확률로 final sizing과 kill-switch를 정한다.
6. `5차`
   - 현재 봉이 과열 추격이면 진입을 한 봉 연기한다.

## v6.0.3.0 LONG/SHORT 기준선

1. 기준 Pine 파일은 `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.0.pine.txt`다.
2. 외부 `LONG / SHORT`는 `long_alert_pulse / short_alert_pulse`를 기준으로 차트와 웹훅이 동일하게 렌더링된다.
3. `EARLY / CORE`만 live source timing band로 해석한다.
4. `DIAG_B / DIAG_C`는 외부 band가 아니라 내부 품질·선행 상태다.
5. `EMO / SS / TD9P / ICHI_BELL`은 보조 이벤트이며, 메인 `LONG / SHORT`를 덮어쓰지 않는다.
6. `RS` 롱 차단은 gap, `_p54`, `last_*_bar` 기록보다 먼저 적용돼야 한다.
7. `binance_diag_c_block_eff`가 켜지면 `diag_c`뿐 아니라 `diag_b`와 해당 pulse도 같이 내려가야 한다.
8. `EMO` 신호 정의와 `emo_*_label_fire`는 분리 유지한다.

## 단계별 역할 표

| 단계 | 소유권 | 핵심 질문 | 주요 입력 | 주요 출력 | 수정 주기 |
| --- | --- | --- | --- | --- | --- |
| Pine | Pine | 이 신호 자체가 구조적으로 좋은가 | regime, score, confidence, posterior, wave, EV | 웹훅/표시 생성 여부, 품질 번들 메타 | 주간 |
| 1차 | Server | 이 신호가 정상적인 형식/무결성인가 | Pine 품질 번들, payload 필드, event/side, parse 상태 | drop or pass | 주간 |
| 2차 | Server | AI 기준으로 이 거래를 할 수 있는가 | AI usable, AI block, AI missing | drop or pass | 주간 |
| 3차 | Server | 지금 시장은 어느 방향이 우위인가 | AI bias direction, confidence, neutral/opposite policy | market_bias_mult, 강한 반대시 drop | 주간 |
| 4차 | Server | 지금 들어가면 TP1에 도달할 확률이 충분한가 | 최근 봉, TP1/SL 구조, EV ledger | ev_mult, kill-switch | 3일 |
| 5차 | Server | 지금 봉이 너무 늦은 추격인가 | open/close, wick, streak, 확장도 | wait/enter | 5일 |

## Pine 역할

### Pine가 하는 일

1. 외부 라이브 엔트리 정의
   - `LONG / SHORT`
   - source timing = `EARLY / CORE`
   - quantity profile = `FIXED`
2. 품질 판단 본체
   - `regime / score / confidence / posterior / wave / EV`
3. 웹훅/표시 생성 전 선판단
4. Pine 품질 번들 메타 발행

### Pine가 하지 않는 일

1. AI usable 여부
2. 시황 방향 prior sizing
3. 서버단 TP 복합 기대값 sizing
4. 늦은 진입 연기 판단

## 1차 역할

### 1차가 하는 일

1. Pine 품질 번들 신뢰 여부 확인
2. 필수 필드 누락 차단
3. malformed payload 차단
4. event/side 불일치 차단
5. parse failure 차단
6. impossible numeric range 차단
7. stale/integrity mismatch 차단
8. 롱/숏 대칭 위반 차단

### 1차가 하지 않는 일

1. Pine와 같은 의미의 regime 재판단
2. Pine와 같은 의미의 score 재판단
3. Pine와 같은 의미의 confidence 재판단
4. Pine와 같은 의미의 posterior/wave/EV 재판단

## 수정 원칙

1. Pine와 1차는 연동 수정한다.
2. Pine 품질 묶음은 부분 이관 금지다.
3. Pine 품질 이관은 항상 `regime / score / confidence / posterior / wave / EV`를 같이 본다.
4. 1차는 장기적으로 무결성/안전 가드만 남긴다.
5. 주간 Pine 수정은 이 문서와 `FILTER_STAGE_POLICY.md`를 먼저 확인하고 진행한다.
6. 자동화 산출물의 `patch candidates`는 Pine full-quality bundle 후보를 뜻한다.
7. 자동화 산출물의 `change control`은 Pine 품질 변경과 1차 guard 승격/롤백 제어를 뜻한다.
8. 주간 수정 전 최신 `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.md`를 읽고, 데일리/주간/월간 목표 미달과 반성문을 함께 반영한다.
