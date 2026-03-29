# BEST_SELF_EVOLUTION_WORK_BREAKDOWN

- 제정: 2026-03-29
- 상태: ACTIVE
- 목적: 자기 진화 시스템 구현을 작업 단위로 쪼개고 우선순위를 고정

## P0 Dataset

1. unified learning row 생성기
2. drops / fallback / reject / partial 포함
3. daily latest artifact 생성

## P1 Objective

1. global objective score 계산
2. market objective score 계산
3. supervisor contract에 score 포함

## P2 Attribution

1. drop attribution
2. late loss attribution
3. fallback cost attribution

## P3 Candidate

1. candidate_change_set 공통 schema
2. Pine / WAIT / EV / ML / AI 후보 통일

## P4 Replay

1. offline replay validator
2. candidate_objective_delta 산출

## P5 Canary

1. 시장별 canary state
2. canary 확대/차단/rollback 자동화

## P6 Autorollback

1. self-evolution rollback ready 감지
2. auto rollback adverse loop 연결
3. stage autopilot 차단/복귀 자동화

## P7 Memory

1. patch memory ledger
2. 실패 fingerprint 차단

## P8 Deployment Handoff

1. replay/canary/memory/deployment guards를 handoff plan으로 통합
2. Pine 수동 붙여넣기 직전 준비 상태를 정형화
3. Codex authority를 supervisor SSOT로 승격

## P9 Loop Monitor

1. 모든 자기 진화 루프의 freshness/blocker/ready 상태를 한 장으로 요약
2. stale artifact와 manual paste ready를 동시에 감시
3. Codex가 전체 루프 health를 기준으로 판단

## 구현 순서

1. P0
2. P1
3. P2
4. P3
5. P4
6. P5
7. P6
8. P7
9. P8
10. P9
