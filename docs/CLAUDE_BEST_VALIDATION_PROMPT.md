# CLAUDE_BEST_VALIDATION_PROMPT

아래 프롬프트를 그대로 Claude Code에 전달한다.

```text
이 저장소에서 BEST/FEBT 신호 학문 문서를 설계 감사 관점으로 검증해라.

먼저 반드시 아래 문서를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_MASTER_SPEC.md

그 다음 필요 시 아래 세부 문서를 읽어라.
1. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PHILOSOPHY.md
3. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_IMPLEMENTATION_FRAMEWORK.md
4. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_INTERFACE_SPEC.md
5. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md
6. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SIGNAL_COUNT_PROTOCOL.md
7. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_OPERATIONAL_GUARDS.md
8. /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_REPLACEMENT_MEASUREMENT_SPEC.md
9. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md
10. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md
11. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md
12. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PINE_INTRODUCTION_PLAN.md
13. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_MICROSTRUCTURE_INPUT_SPEC.md
14. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md
15. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_THRESHOLD_CALIBRATION_PROTOCOL.md
16. /Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_FAILSAFE_POLICY.md

검증 목적은 아래 5개다.
1. BEST가 상위 통합 신호 이론으로 논리적으로 성립하는가
2. FEBT가 BEST 내부의 timing core로서 과도하지 않고 적절한가
3. 목표인 "승률 60%+"와 "신호 수 감소 금지"가 현실적이고 검증 가능하게 정의되었는가
4. Pine / 서버 / 자동화 역할 경계가 충분히 명확한가
5. live 운영 승인 전에 빠진 운영 가드나 정량 기준이 무엇인가

중요 규칙:
- Findings를 최우선으로 제시해라.
- 개념 칭찬보다 결함, 모호성, 운영 리스크를 먼저 적어라.
- 문서에 없는 구현 사실을 지어내지 말아라.
- 추측은 "가설"로 표시해라.
- 아직 코드 구현이 없다는 점을 전제로, 문서 품질과 운영 승인 가능성만 평가해라.

반드시 아래를 판단해라.
1. 개념적 일관성
2. 기존 1~5차 계층과의 충돌 여부
3. 정량 검증 가능성
4. count floor / replacement accounting의 실효성
5. live Binance Futures 운영 승인 가능 여부
6. 다음 문서 단계에서 반드시 추가해야 할 것

출력 형식은 반드시 아래 순서를 따른다.
1. Findings
2. Open questions
3. Approval assessment
4. Required next documents or specs
5. Optional implementation notes

Finding 형식:
- [P0/P1/P2/P3][area] 짧은 제목
- 문제 설명
- 왜 문제인지
- 근거 문서
- 수정 방향

approval assessment는 아래 셋 중 하나로 명시해라.
- APPROVE
- HOLD
- REJECT

특히 아래 항목은 반드시 따로 언급해라.
1. BEST ↔ FEBT 인터페이스가 충분한지
2. 승률 60%+ 프로토콜이 충분한지
3. 신호 수 감소 금지 규칙이 실제 운영 규칙으로 닫혔는지
4. duplicate/reject/partial fill/drawdown 가드가 충분한지
5. 문서만으로 SOFT 또는 HARD 승격이 가능한지
6. FEBT score 계산식과 threshold seed가 구현 가능할 만큼 닫혔는지
7. microstructure 입력 OHLCV 공식과 phase precedence가 구현 가능할 만큼 닫혔는지
```
