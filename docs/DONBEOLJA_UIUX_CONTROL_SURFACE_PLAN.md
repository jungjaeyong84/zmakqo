# DONBEOLJA UIUX PLAN

- 제정: 2026-03-31
- 업데이트: 2026-04-01
- 상태: COMPLETE
- 목적:
  - 사용자 중심 화면과 운영 artifact 화면을 분리한다.
  - 자산/수익/거래를 먼저 보여주고, 자동 전략 상태는 별도 카테고리로 정리한다.

## 1. 현재 한 줄 정의

현재 UI/UX는 `사용자 중심 홈 + 별도 수익/입출금 + 전략상태 운영 화면` 구조로 마감됐다.

초기 목표는 control surface 중심 재편이었지만, 최종 구현은 `사용자가 먼저 이해하는 구조`로 다시 정렬했다.

## 2. 최종 정보구조

상단 메뉴 정본:

1. `홈`
2. `수익`
3. `입출금`
4. `거래기록`
5. `전략상태`
6. `설정`

구조 원칙:

1. `홈`
   - 현재 자산, 손익, 최근 거래를 먼저 보여준다.
2. `수익`
   - 기간별 손익을 별도 카테고리로 본다.
3. `입출금`
   - 입금/출금/순유입을 별도로 본다.
4. `거래기록`
   - 최근 신호/주문/실행을 시간순으로 본다.
5. `전략상태`
   - 서버 정본 전환 상태와 운영 artifact를 본다.

## 3. 완료된 UI/UX 변경

### 3.1 홈

완료:

1. 사용자 첫 문장을 추가
   - 자동 전략으로 거래하고 자산·수익·거래 결과를 한 화면에서 본다는 설명
2. 홈 상단을 `자산/손익/거래` 중심으로 재배치
3. `쉬운 수익 카테고리` 복원
4. `오늘 / 최근 7일 / 최근 30일 / 최근 6개월 / 총 손익` 복원
5. `자동 전략` 세부 운영 화면은 홈에서 전면 노출하지 않고 요약만 유지

### 3.2 수익 / 입출금

완료:

1. `수익`, `입출금`을 보조 화면이 아니라 메인 카테고리로 복원
2. 예전처럼 기간별 손익을 직관적으로 읽게 정리
3. 사용자가 돈 흐름을 먼저 이해하도록 wording 단순화

### 3.3 거래기록

완료:

1. 실행/신호/주문 결과를 사용자 기준 `거래기록`으로 묶음
2. 기본 화면은 서버 정본 신호를 우선 보여줌
3. shadow는 디버그성 컨텍스트로만 노출

### 3.4 전략상태

완료:

1. 예전 control surface/operator artifact를 이 카테고리로 이동
2. `서버 우선 전환 진행률` 카드 추가
3. `정본 신호 수`, `그림자 수`, `drift`, `실행 품질`을 한 화면에서 읽게 함

## 4. 현재 화면 철학

### 4.1 사용자 화면

사용자 화면은 아래 질문에 바로 답해야 한다.

1. 지금 자산이 얼마인가
2. 손익이 어떻게 변했는가
3. 최근 거래가 어땠는가
4. 자동 전략이 정상인지 아닌지

### 4.2 운영 화면

운영 artifact는 아래 질문에 답해야 한다.

1. 서버 정본 전환이 어디까지 왔는가
2. 왜 아직 `SERVER_PRIMARY`가 아닌가
3. 어떤 drift family가 blocker인가
4. 다음 조치가 무엇인가

## 5. 현재 구현 기준 파일

핵심 파일:

1. `/Users/jeongjaeyong/Projects/donbeolja/src/views/home.ejs`
2. `/Users/jeongjaeyong/Projects/donbeolja/src/views/profit.ejs`
3. `/Users/jeongjaeyong/Projects/donbeolja/src/views/cashflow.ejs`
4. `/Users/jeongjaeyong/Projects/donbeolja/src/views/state.ejs`
5. `/Users/jeongjaeyong/Projects/donbeolja/src/views/partials/topnav5.ejs`
6. `/Users/jeongjaeyong/Projects/donbeolja/src/views/partials/app_start.ejs`
7. `/Users/jeongjaeyong/Projects/donbeolja/src/utils/controlPlaneViewModels.js`

## 6. 현재 판정

이 UI/UX 작업은 구조적으로 완료다.

남은 것은 신규 기능이 늘어날 때의 유지보수 수준이다.

1. copy 미세조정
2. 새 artifact 카드 추가
3. 거래기록 / 전략상태 세부 polish

즉 지금 UI는 더 이상 `개발자만 이해하는 control surface`가 아니라,
`사용자가 돈과 결과를 먼저 보고, 필요할 때 전략 상태를 파고드는 구조`다.
