# 돈벌자 시스템 개요

- 업데이트: 2026-04-02 KST
- 현재 엔진: `6.1.1.0`
- 현재 전략 ID: `donbeolja_v6.1.1.0`
- 기본 실행 환경: `BINANCEFUT / 15m / 7 markets`
- 현재 source mode: `SERVER_PRIMARY`
- 현재 전환 상태: `구조 전환 완료, acceptance 샘플/후단 drift 정리 단계`

## 0. 검수 SSOT

Claude/Codex/OpenClaw 품질 검수는 아래 문서를 최우선 기준으로 사용한다.

- [DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02](/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md)

## 1. 한 줄 정의

돈벌자는 `바이낸스 선물 15분 봉`을 기준으로 자동 전략을 실행하고, 자산·수익·거래 결과를 사용자 화면과 운영 자동화에 함께 연결하는 시스템이다.

현재는 `서버가 정본 신호 생성기`이며, `Pine`은 `비교/시각화 shadow` 역할을 담당한다.

## 2. 현재 운영 상태

1. `서버 내부 신호 = 정본`
   - 내부에서 생성된 신호는 `source=SERVER`, `authoritative=true`로 저장한다.
2. `Pine webhook = 그림자`
   - Pine로 들어온 신호는 `source=PINE_SHADOW`, `authoritative=false`로 저장하며 실행 체인에는 기본 진입하지 않는다.
3. `UI 기본값 = 서버 정본 우선`
   - 홈/거래/전략상태는 기본적으로 서버 정본 기준으로 읽는다.
4. `Telegram = 서버 정본 기준`
   - 운영 수신 알림은 서버 정본 신호를 기준으로 보낸다.
5. `self-evolution = 서버 정본 품질까지 관측`
   - authority, quality, runtime, cutover readiness가 loop monitor / supervisor / autopilot에 연결돼 있다.

## 3. 지금 남은 핵심 blocker

현재 latest artifact 기준 핵심 blocker는 아래 3개다.

1. `EV_POLICY_DRIFT_ACTIVE`
2. `COOLDOWN_POLICY_DRIFT_ACTIVE`
3. `SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT`

참고:
- `STRATEGY_GATE`는 현재 `historical_only`로 분류돼 실질 blocker에서 빠졌다.

## 4. 사용자 화면 구조

현재 최상위 메뉴는 아래 기준이다.

1. `홈`
2. `수익`
3. `입출금`
4. `거래기록`
5. `전략상태`
6. `설정`

의도:
- 홈은 `자산/수익/거래`를 먼저 보여준다.
- 복잡한 운영 artifact는 `전략상태`에서 읽는다.
- 수익과 입출금은 별도 카테고리로 분리한다.

## 5. 문서 우선순위

### 5.1 가장 먼저 볼 문서

1. [시스템 맵](/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PINE_TO_SELF_EVOLUTION_SYSTEM_MAP.md)
2. [서버 신호 정본 규격](/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_SPEC.md)
3. [전환 체크리스트](/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_MIGRATION_CHECKLIST.md)
4. [서버 vs Pine 비교 운영안](/Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_VS_PINE_SHADOW_COMPARISON_RUNBOOK.md)
5. [OpenClaw 자율 계약](/Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md)

### 5.2 신호 관련 문서

1. [v6.1.1.0 리디자인 규격](/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_V6_1_1_0_REDESIGN_SPEC.md)
2. [TradingView import / consumer 계약](/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_V6_1_1_0_TV_IMPORT_AND_CONSUMER_CONTRACT.md)
3. [canary 적용 체크리스트](/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_V6_1_1_0_CANARY_APPLY_CHECKLIST.md)

### 5.3 self-evolution / 운영 문서

1. [BEST self-evolution master spec](/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md)
2. [deployment autopilot spec](/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DEPLOYMENT_AUTOPILOT_SPEC.md)
3. [운영 가드](/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_OPERATIONAL_GUARDS.md)

## 6. 현재 판정

구조적으로는 `서버 정본 전환`이 완료됐다.

다만 아직 아래는 진행 중이다.

1. `SERVER_PRIMARY acceptance sample` 충족
2. `EV / COOLDOWN drift` 축소
3. `objective recovery`와 실행 품질 회복

즉 현재 돈벌자는 `서버가 봉을 읽고 신호를 만들고 실행하는` 정본 구조이며, 남은 과제는 `후단 정책/품질 병목`을 줄여 승격 조건을 닫는 것이다.
