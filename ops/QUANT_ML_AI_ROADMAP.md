# Quant ML+AI Roadmap

기준: 2026-04-12

## 목표

현재 시스템을 "운영 가능한 방어형 실거래 엔진"에서 "실행 우위 + 데이터 우위 + 자동 개선 루프"를 갖춘 상위 퀀트 ML+AI 시스템으로 끌어올린다.

## 우선순위 10개

1. execution latency / partial fill / slippage 개선
2. realized 대비 fee 비율 KPI 고정
3. OpenClaw를 최상위 실행 결정자로 승격
4. 실거래 alpha 검증 체계 고정
5. event truth only feature/label pipeline 고정
6. portfolio cluster / correlation risk 모델 직접 반영
7. promotion / rollback 자동화 강화
8. 실패 사례 자동 학습 루프 구축
9. 전략별 / 심볼별 동적 자본배분 ML화
10. 운영 대시보드 의사결정 중심 재편

## Phase 1

- execution quality artifact를 runtime guard보다 선행 생성
- signal lineage health를 같은 주기로 갱신
- OpenClaw policy authority를 hourly / daily 운영 루프로 승격
- fee_to_abs_realized_ratio를 운영 리포트의 핵심 KPI로 사용

## Phase 2

- 실거래 alpha 검증 윈도우를 DAILY / 7D / 14D / MONTHLY / YEARLY 기준으로 promotion gate에 반영
- event truth only dataset source 고정
- shadow / canary / rollback evidence를 serving actuation과 직접 연결

## Phase 3

- correlation / same-side exposure 기반 size control 고도화
- 실패 사례 분류를 정책 재튜닝 입력으로 자동 반영
- 운영 대시보드를 "왜 진입/감소/차단됐는가" 중심으로 재구성

## 이번 변경

- execution quality stale 재발 방지를 위해 운영 자동화가 execution quality / lineage health / OpenClaw policy authority를 선행 생성하도록 연결
- system runtime guard와 system ops가 stale artifact 없이 최신 상태를 소비하도록 정렬

