# AI_ALLOCATION_POLICY

- 업데이트: 2026-04-02 KST
- 상태: ACTIVE
- 검수 SSOT:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-02.md`

## 1. 목적

AI Allocation은 `시장 모드/예산 배분`을 조정하는 정책 계층이다.
최종 주문 수량은 아래 순서로 결정한다.

1. 신호 엔진 기본 `qty_pct`
2. AI/리스크 정책 조정
3. live execution policy(`execution_quality + allocator + quarantine + policy_parameter_plan`) 보정

즉 AI Allocation은 단독 실행기가 아니라 `상류 배분 정책`이다.

## 2. 동작 순서

1. 뉴스/시장 컨텍스트 수집
2. 모델 기반 시장 모드 결정(예: aggressive/neutral/conservative)
3. 변동성/성과 기반 자산 배분 계산
4. 주간 변경폭/최대최소 비중/거래소 제약 적용
5. 조건 만족 시 `settings/risk_budget` 갱신

## 3. 안전장치

1. 코인별 최소/최대 비중
2. 주간 변경폭 제한
3. live 적용 조건:
   - `live_enabled=true`
   - `live_confirm_required=false`
   - 운영 가드 PASS
4. 모델 실패 시 안전 fallback:
   - 마지막 유효 모드 재사용
   - 없으면 neutral

## 4. 실행 경로

1. 설정 API
   - `GET /api/settings/ai-allocation`
   - `POST /api/settings/ai-allocation`
2. 스케줄러
   - `POST /scheduler/ai-allocation`
   - body: `{ "dry_run": "1" }` 또는 생략

## 5. 환경 변수

필수:

1. `OPENAI_API_KEY` 또는 `ANTHROPIC_API_KEY` (운영 모델 구성에 따라)
2. `NEWS_PROVIDER`
3. `NEWS_API_KEY` (`NEWS_PROVIDER=newsapi`일 때)

운영에서 함께 보는 핵심:

1. `AI_ALLOC_CLAUDE_MODEL`
2. `AI_ALLOC_CLAUDE_MODEL_CANARY`
3. `AI_ALLOC_CLAUDE_CANARY_PCT`
4. `AI_ALLOC_CLAUDE_TIMEOUT_MS`

## 6. 현재 운영 메모

1. 배분 정책은 `실주문 하드 가드`를 우회하지 못한다.
2. `QUARANTINE/WATCH_ONLY` 시장은 live execution policy에서 차단될 수 있다.
3. 정책 파라미터 자동 진화 리포트(`policy_parameter_plan_latest`)가 활성화되면 글로벌/마켓 scale이 추가 반영된다.
