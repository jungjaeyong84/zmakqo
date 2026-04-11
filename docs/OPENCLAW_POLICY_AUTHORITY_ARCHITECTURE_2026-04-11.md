# OpenClaw Policy Authority Architecture

기준일: 2026-04-11
대상: Binance Futures 실거래 경로

## 목적

OpenClaw를 단순 감독관이 아니라 상위 정책 권한으로 올린다. 다만 주문/포지션 실체는 기존 canonical engine, exchange truth, read-model authority가 맡는다.

정리하면 권한은 다음처럼 분리한다.

- OpenClaw: allow / block / reduce / aggressive exit-profile 정책 결정
- Canonical engine: 실제 signal -> intent -> order/fill 실행
- Exchange truth + read model: 실제 포지션 상태 authority

즉 OpenClaw는 "무엇을 얼마나 공격적으로 실행할지"를 결정하고, 엔진은 "어떻게 안전하게 실행할지"를 담당한다.

## 설계 원칙

1. OpenClaw는 positions_paper를 직접 쓰지 않는다.
2. OpenClaw 결정은 append-only audit 경로에 반드시 남긴다.
3. 실행 차단보다 비용 절감과 리스크 축소를 우선한다.
4. 정책 결정은 실거래 결과와 다시 연결돼야 한다.
5. promotion/rollback은 shadow evidence 없이 승격하지 않는다.

## 데이터 경로

### 입력

- signal / intent / event context
- 최근 동일 심볼 재진입 이력
- 동시 포지션 same-side / correlated cluster 노출
- cohort 정보
- confidence / posterior / quality feature

### 결정

OpenClaw executor는 다음 중 하나를 만든다.

- `BLOCK`
- `REDUCE`
- `ALLOW`
- `AGGRESSIVE`

부가적으로 다음 값을 낸다.

- 최종 `qty_pct_final`
- `exit_profile_mode`
- `reason`
- `features_patch`

### 감사 저장

결정은 세 군데에 남긴다.

- `openclaw_policy_decisions`
- `unified_event_timeline`
- `shadow_evaluations`

이렇게 해야 "왜 막았는지 / 왜 줄였는지 / 왜 aggressive로 올렸는지"를 사후 감사할 수 있다.

## 기간별 운영 평가

정책 권한 평가는 다음 6개 기간을 기본으로 본다.

- 일간
- 주간
- 최근 7일
- 최근 14일
- 월간
- 연간

평가 항목은 다음이다.

- block / reduce / aggressive 비율
- 실현손익 대비 수수료 비율
- aggressive exit 성과
- shadow evidence 충분성
- promotion gate 상태

아티팩트는 `ops/daily/openclaw_policy_authority_latest.json` 및 `.md`에 남긴다.

## 승격 규칙

OpenClaw는 상위 정책 권한이지만 무제한 권한이 아니다.

- evidence가 부족하면 `WARN`
- 비용 비율이 과도하면 `BLOCK`
- aggressive 프로파일이 손익 악화면 `BLOCK`
- 충분한 sample과 안정된 비용 구조가 확인될 때만 promotion-ready

## 현재 구현 범위

- Binance execution path 진입 전 OpenClaw executor 적용
- OpenClaw 결정 append-only 저장
- unified event timeline 연동
- shadow evaluation 연동
- ML ops pipeline 내 OpenClaw policy authority report 포함
- 6개 기간 집계 리포트 생성

## 남은 후속

1. OpenClaw shadow decision과 실제 fill outcome 차이를 자동 gate로 더 강하게 연결
2. 최근 14일 실거래 기반 threshold auto-tuning loop 고도화
3. dashboard/control-plane에서 OpenClaw authority 리포트를 직접 노출
4. promotion action을 live serving swap evidence와 더 강하게 결합
