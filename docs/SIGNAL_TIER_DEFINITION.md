# SIGNAL_TIER_DEFINITION

- 제정: 2026-03-25
- 상태: ACTIVE
- 적용 범위:
  - PineScript signal band 로직
  - 서버 엔진의 band 해석
  - EV threshold / 진입 비중 / add / reverse / alert / UI 표기

## 목적

현재 운영에서 쓰는 live source band의 의미를 한 문서로 고정한다.
외부 라이브 엔트리 택소노미는 `LONG / SHORT`만 사용한다.
이 문서는 band 관련 해석의 SSOT(single source of truth)다.

## 현재 운영 기준

1. 외부 라이브 엔트리는 `LONG / SHORT`만 사용한다.
2. 현재 라이브 source band는 `EARLY / CORE`만 사용한다.
3. 현재 라이브 quantity profile은 `FIXED`다.
4. Pine가 품질 SSOT이고 서버 1차는 무결성 가드다.

## v6.0.3.0 기준선

- 기준 파일:
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.0.pine.txt`
- 기준일:
  - `2026-03-29`
- 기준 목적:
  - 이후 LONG/SHORT 관련 수정은 이 버전의 의미를 보존한 상태에서만 진행한다.

### LONG / SHORT live 의미

1. 차트 표시와 웹훅 외부 엔트리의 최종 기준은 `long_alert_pulse / short_alert_pulse`다.
2. 외부 `LONG / SHORT`의 entry grade는 `EARLY` 또는 `CORE`만 허용한다.
3. `DIAG_B / DIAG_C / EMO / SS / TD9P`는 내부 품질 상태 또는 보조 이벤트다.
4. 내부 상태를 새 라이브 source band로 승격하려면 이 문서와 `/Users/jeongjaeyong/Projects/donbeolja/docs/PINE_AND_FILTER_STAGE_ROLES.md`를 같이 갱신해야 한다.

### v6.0.3.0 불변식

1. `CORE` 승격과 `EARLY` fallback은 통계물리학 gate(`sp_core_promote_ok / sp_live_allow_ok / hard block`)를 거친다.
2. `RS` 이후 롱 차단은 `_p54_last_*`와 `last_*_bar` 기록보다 먼저 적용한다.
3. `diag_c`가 block되면 `diag_b`와 관련 pulse 경로도 함께 꺼져야 한다.
4. `EMO`는 조건 정의와 라벨 표시를 분리하되, 신호 조건 본체는 단일 정의만 유지한다.
5. 현재 운영은 `Binance-only runtime` 기준이며, 비코인 경로 재활성화는 별도 SSOT 변경으로 본다.

## 최종 목표 함수

band 관련 변경도 아래 목표 함수를 공통으로 따른다.

1. 승률: 최소 `60% 이상`
2. 수익:
   - 순수익(`net`) `양수`
   - 기대값(`expectancy / EV`) `양수`
   - 월간 순수익 `1,500,000 KRW 이상`

## 활성 라이브 band

### EARLY

- 정의:
  - 시장이 막 기울기 시작하는 초입 신호
- 의도:
  - 속도와 가격 메리트를 우선한다
- 운영 해석:
  - 선점형 기본 진입

### CORE

- 정의:
  - 노이즈를 더 걷어낸 주력 진입 source band
- 의도:
  - 현재 라이브 경로에서 EARLY보다 강한 품질 source를 제공한다
- 운영 해석:
  - `LONG / SHORT`의 코어 진입 source

## 변경 원칙

1. `EARLY / CORE`는 현재 라이브 source band다.
2. 현재 라이브 quantity profile은 항상 `FIXED`다.
3. Pine와 서버가 같은 band 의미를 유지해야 한다.
4. band 관련 수정 전에는 반드시 이 문서와 `/Users/jeongjaeyong/Projects/donbeolja/docs/PINE_AND_FILTER_STAGE_ROLES.md`를 먼저 읽는다.
5. band 조정은 항상 `승률 60% 이상 + 순수익 양수 + 기대값 양수 + 월간 순수익 1,500,000 KRW 이상` 목표와 함께 검토한다.
