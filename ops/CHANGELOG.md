# DONBEOLJA Ω CHANGELOG

## v1.0.3 (2026-02-07)
- profits: apply actual Binance funding fees (income history) with fallback to estimate
- improvement-pack: trade ledger funding_paid uses actual funding when available
- binance fills sync: mark TP_P1 as done on external user trades to enable trailing and prevent repeated P1 exits
- binance fills sync: seed trail state from TP_P1 fill (trail_active + trail_high/low) to start trailing right away
- AI guard: optional Claude ensemble (weighted decision + skip on high GPT confidence) with meta fields
- settings: add Claude API key field under risk settings (stored in settings/ai_guard)
- settings: add ensemble allow/reduce thresholds under risk settings (settings/ai_guard)
- settings: add Claude model selector under risk settings (settings/ai_guard)
- fix: remove duplicate eventUpper declaration in paperUpbitRunner (prevents runtime SyntaxError)
- AI guard: ignore pro action/risk text for short signals (only checked on long)
- engine: drop repeated TP_P1 exit signals after tp_p1_done to prevent duplicate P1 orders
- dashboard: add cashflow tab with Binance wallet deposit/withdraw summary
- dashboard: include Binance wallet transfer history (spot↔futures) in cashflow
- dashboard: add custom date range modal for cashflow
- dashboard: show USDT KRW approximation using historical 1h rates in cashflow




## v1.0.3 (2026-01-02)
- filters_drop sync: eval_weekly decisions 배열 호환 + 필드 정합(symbol_or_pair_id, ev_dir_ret_pct)
- signalsQuery: drop filter 조회 시 symbol_or_pair_id/symbol 동시 지원(하위 호환)
- scheduler: stateMachine getState() 반환 구조(state) 반영 + createScheduler 인자 형태 하위 호환
- webhook: symbol/시간 파싱 정리, 중복 함수 제거
- SMOKE: multi-market loop (UPBIT_MARKETS)
- multi-market release (BTC/ETH/XRP)

## v1.0.2 (2025-12-23)
- multi-market support via UPBIT_MARKETS (KRW-BTC, KRW-ETH, KRW-XRP)
- SMOKE: multi-market loop + unique events per market

## v1.0.1 (2025-12-23)
- signals 상태머신 필드 추가(state/consumed/claim/exec) + top-level price
- scheduler CLAIM 원자화 + EXECUTED/FAILED finalize + exec_result compact
- 동일 봉 다중 신호 선택 규칙 고정(SELL>BUY, latest wins + revision tie-break)
- SIGNAL 로그 표준(JSON 1줄)
- ops: SMOKE/DIAG 추가

## v1.0.0 (2025-12-23)
- ops 기반 현장 배포 고정본(PM2 + launchd)
- Firestore 증거 레이어 + report/latest 저장
- signals 업서트 트랜잭션 + consumed 보호 + 로그 표준
- REQUIRE_SIGNAL_PRICE=1 가드레일
- tick에서 IDEMPOTENCY여도 미소비 신호 자동 소비(SELL 우선)
- 포지션 스키마 불변조건: BUY 시 exit_* clear, SELL 시 entry_* 유지
